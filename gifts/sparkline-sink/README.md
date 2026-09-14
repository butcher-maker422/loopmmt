# sparkline-sink — numbers → one inline unicode sparkline, zero dependencies

One file. MIT. Pipe a numeric series in, get a single line of block glyphs out.

```
$ echo '[3,1,4,1,5,9,2,6]' | node sparkline-sink.js
▃▁▄▁▅█▂▆
$ echo '[0,1,2,3,4,5,6,7]' | node sparkline-sink.js
▁▂▃▄▅▆▇█
```

Eight levels, low to high: `▁▂▃▄▅▆▇█`. Each value maps to one of the 8 across the data's
range, and you get one glyph per value — a trend you can drop inline in a README, a commit
message, a log line, or a terminal.

## Input

JSON on stdin, one of:

- **a bare array of numbers** — `[1,2,3]`
- **a spec object** — `{ "series": [...], "min": N, "max": N }` to pin the domain instead
  of auto-fitting `[min(data), max(data)]`

CLI flags (`--min` · `--max`) override object fields. Empty input → a bare newline.

## What it does NOT do — the printed edge

**This is a glyph sparkline, not a chart.** It emits one line of block characters, one per
value, mapping each to **exactly 8 discrete levels** across the range. It renders **no axis,
labels, numbers, color, or scale markers** — only the shape. Because there are only 8 levels,
**two values in the same eighth of the range draw the same glyph**: it shows **trend, not
magnitude**, and it is not a substitute for the number. It takes **numbers only** — no caller
text reaches the output, so there is no escaping surface. A **non-finite value (NaN / Infinity)
is a hard error**, never a silently-dropped or guessed point.

If you need magnitude, axes, or labels, reach for a chart — `svg-sink` is the sibling gift for
geometry-precise SVG output.

## Guarantees

- **Zero dependencies.** Imports nothing, shells out to nothing.
- **Deterministic.** Each value maps to an **integer level** (a bucket), so no float noise or
  platform drift can reach the output. Same series in → **byte-identical** line out.
- **Closed alphabet.** The output is only the 8 block glyphs plus a trailing newline — nothing
  caller-supplied ever appears.
- **Honest framing.** A non-finite value throws and names its position (`series[1] is not a
  finite number`); a nested array or an inverted `min ≥ max` throws rather than mis-rendering.

## Use it as a library

```js
const { sparkline } = require('./sparkline-sink.js');
const line = sparkline([3, 1, 4, 1, 5, 9, 2, 6]);   // "▃▁▄▁▅█▂▆\n"
```

In a browser it attaches to `window.LoopGifts['sparkline-sink']` — `sparkline(series, flags)`
is a pure function, safe to call in a render loop.

## Test

```
$ node test_sparkline-sink.js
```

The battery's oracle is **out-of-band**: the exact expected glyph line for each sample input is
hand-computed from the documented level math, written independently of the emitter — a build
cannot certify itself.

---

MIT © 2026 Shea Gunther. A Loop MMT gift. Sibling of `svg-sink` in the render-sink cluster.
