# running-stats

**Fold a JSONL numeric stream into one running-statistics record.**

A tiny, dependency-free tool that reads a stream of numbers — one JSON number per line ([JSON Lines](https://jsonlines.org/)) — and folds them in **one pass** into a single aggregate record: `{count, mean, variance, stddev, min, max}`. Same stream in, byte-identical record out, on every machine and every run.

```
printf '%s\n' 2 4 4 4 5 5 7 9 | node running-stats.js
  ->  {"count":8,"mean":5,"variance":4,"stddev":2,"min":2,"max":9}
```

It is a **fold, not a chart** — the output is a JSON record you hand to a test, a diff, or a dashboard.

## How mean and variance are computed

By **Welford's online algorithm**, which updates a running mean and sum-of-squared-deviations in one pass:

```
for each x:  n += 1;  d = x - mean;  mean += d / n;  M2 += d * (x - mean)
population variance = M2 / n        (default)
sample variance     = M2 / (n - 1)  (with --sample, Bessel-corrected)
stddev = sqrt(variance)
```

Welford is used because the textbook one-pass shortcut — sum of squares minus square of sum, `(Σx² − (Σx)²/n)/n` — **catastrophically cancels** when the values cluster tightly around a large mean (say `1e9`), returning garbage. Welford stays honest there.

**What Welford does *not* claim.** It is not "the most accurate" way to compute a variance. A careful **two-pass** computation (mean first, then sum the squared deviations) can be *more* accurate — near `1e12` the two-pass mean can be exactly representable while Welford drifts by ~`1.5e-5`. The honest guarantee is: **one pass, numerically stable, bounded non-catastrophic error — strictly better than the naive one-pass shortcut, not a claim to beat a careful two-pass.**

## Determinism (and what it is *not*)

The record is a **pure function of the input sequence** — no clock, no randomness, no files written — so folding the same stream twice yields a **byte-identical** record. But `mean`/`variance` are IEEE-754 doubles, and float addition is not associative, so **reordering the same values can move the low-order bits**. This tool is deterministic **for a given input order**; it is **not** an exact order-independent fingerprint of the multiset (that is [`histogram-fold`](../histogram-fold/)'s job, with integer counts).

## Usage

```
usage: running-stats.js [--sample] [FILE]
  (no FILE)   read numbers from stdin
  FILE        read numbers from a file
  --sample    sample (n-1) variance/stddev instead of population (n)
  --help
```

Each **non-blank line is one finite JSON number**. Blank lines are skipped. A trailing `\r` (CRLF files) is trimmed. Output is one line of compact JSON in a fixed field order.

A line that is not valid JSON, is not a number, or is a number that overflows to `±Infinity` (`1e999`) or is `NaN` is a **hard error (exit 2)** naming the line — never a silent skip. `--sample` with fewer than 2 values is exit 2 (sample variance is undefined at `n < 2`). An empty stream folds to `{"count":0,"mean":null,"variance":null,"stddev":null,"min":null,"max":null}`.

## What this is *not*

Not a median/percentile/quantile summary (it keeps no order statistics beyond `min` and `max`), and not a mode or histogram (see [`histogram-fold`](../histogram-fold/)).

## License

MIT. Zero dependencies — Node builtin `require('fs')` for file reads only; runs in a browser with no `require` at all (attaches `runningStats` to `window.ForestGifts`).
