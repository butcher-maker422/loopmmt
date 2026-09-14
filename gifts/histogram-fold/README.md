# histogram-fold

**Fold a JSONL numeric stream into one bucketed histogram.**

A tiny, dependency-free tool that reads a stream of numbers — one JSON number per line ([JSON Lines](https://jsonlines.org/)) — and folds them into one aggregate record: a contiguous list of fixed-width buckets with a count in each, plus the total count and the observed min and max. Same stream in, byte-identical record out, on every machine and every run.

```
printf '%s\n' 1 2 2 5 | node histogram-fold.js
```

It is a **fold, not a chart** — the output is a JSON record you hand to a plotter, a test, or a diff.

## How the buckets are defined

Buckets are **fixed-width** with a fixed origin, so a value's bucket never depends on the rest of the stream — which is what makes the fold **one pass**. For a value `x`:

```
bucket index  i = floor((x - origin) / width)
bucket range  [ origin + i*width , origin + (i+1)*width )   (lower-closed, upper-open)
```

The default `origin` is `0` and the default `width` is `1`, so a bare stream of numbers buckets into unit integer bins. Override with `--width` and `--origin`. The output bins are **contiguous** from the lowest occupied bucket to the highest, with any empty interior bucket carried as a count of `0` (a histogram has no holes). Each bin's `hi` equals the next bin's `lo` exactly. An empty stream folds to `{"bins":[],"count":0,"min":null,"max":null}`.

## Usage

```
usage: histogram-fold.js [--width W] [--origin O] [FILE]
  (no FILE)     read numbers from stdin
  FILE          read numbers from a file
  --width W     bucket width (default 1; must be a finite number > 0)
  --origin O    bucket origin (default 0; must be finite)
  --help
```

Each **non-blank line is one finite JSON number**. Blank lines are skipped. A trailing `\r` (CRLF files) is trimmed. Output is one line of compact JSON.

Example:

```
$ printf '%s\n' 5 12 13 27 | node histogram-fold.js --width 10
{"bins":[{"lo":0,"hi":10,"count":1},{"lo":10,"hi":20,"count":2},{"lo":20,"hi":30,"count":1}],"width":10,"origin":0,"count":4,"min":5,"max":27}
```

Exit codes: `0` success, `2` input error (missing file, a directory, a bad `--width`/`--origin`, a line that is not a finite JSON number, or a bucket range so large it would exhaust memory), always a clean one-line message, never a stack trace.

## Numeric honesty

Every line must be a **finite** JSON number. A line that is not valid JSON, is not a number, or is a number that overflows to `±Infinity` (`JSON.parse("1e999")` yields `Infinity`) or is `NaN` is a **hard error** — never a silent skip. Counts are integers and stay integers.

The bucket index is `Math.floor((x - origin) / width)` in IEEE-754 double, and the float boundary is a **documented, pinned** behavior: with `width` `0.1` the value `0.3` lands in bucket index 2 (`[0.2, 0.3)`), because `(0.3 - 0) / 0.1 === 2.9999999999999996` and `floor` of that is 2, not 3. histogram-fold does not epsilon-fudge this — it states the rule. For clean boundaries, use an exactly-representable width (1, 2, 5, 10, 0.5, 0.25).

## Runs in a browser too

`histogram-fold.js` is zero-dependency and side-effect-free on load. In a browser it attaches `histogramFold` to `window.ForestGifts`; under Node it exports `fold` via `module.exports`.

```js
const { fold } = require("./histogram-fold.js");
fold("1\n2\n2\n5").bins; // -> [{lo:1,hi:2,count:1}, ...]
```

## The edge — what this does NOT do

This **counts values into fixed-width buckets**. It is **not density estimation** — no smoothing, no kernel density. It is **not a quantile/percentile summary** — it keeps no per-value order statistics beyond min and max. And it does **not** choose data-driven "nice" bin edges: the buckets are fixed-width by a fixed origin, because letting the data pick the edges would make a value's bin depend on the whole stream and cost the one-pass property.

## License

MIT.
