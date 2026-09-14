# topk-fold

**Fold a JSONL numeric stream into its top-k values, one pass.**

A tiny, dependency-free tool that reads a stream of numbers — one JSON number per line ([JSON Lines](https://jsonlines.org/)) — and keeps only the **k largest** (or, with `--min`, the k smallest), in one pass and O(k) space. It never holds the whole stream.

```
printf '%s\n' 5 1 9 3 7 2 | node topk-fold.js --k 3
  ->  {"count":6,"k":3,"top":[9,7,5]}
printf '%s\n' 5 1 9 3 7 2 | node topk-fold.js --k 3 --min
  ->  {"count":6,"k":3,"top":[1,2,3]}
```

It is a **fold, not a sort** — the output is a small JSON record you hand to a test, a diff, or a dashboard.

## How it keeps only k

A **bounded heap of size k**. For top-k, a min-heap: push each value, and whenever the heap holds more than k, pop the smallest — so it always retains the k largest seen. (`--min` mirrors it with a max-heap for the k smallest.) That is **O(n log k)** time and **O(k)** space, versus sorting the whole stream at O(n) space. At the end the heap is drained and sorted: top-k **largest-first**, bottom-k **smallest-first**.

If fewer than k values are seen, `top` holds all of them (still sorted) and `count < k` — **k > n is not an error**.

## Determinism (and it's the strong kind)

The record is a **pure function of the input multiset** — no clock, no randomness, no files written — so the same values in **any order** fold to a **byte-identical** record. Unlike a floating-point summary (see [`running-stats`](../running-stats/), whose reorder-agreement is only *within tolerance*), topk-fold selects by comparison and emits a sorted array carrying input values verbatim, so it earns **full, byte-identical order-independence**. Ties at the k-th boundary are resolved **by value**: `[5,3,3,3]` top-2 is `[5,3]`.

## Usage

```
usage: topk-fold.js --k N [--min] [FILE]
  --k N       REQUIRED; number of extreme values to keep (integer >= 1)
  --min       keep the k SMALLEST (bottom-k) instead of the k largest
  (no FILE)   read numbers from stdin
  FILE        read numbers from a file
  --help
```

Each **non-blank line is one finite JSON number**. Blank lines are skipped. A trailing `\r` (CRLF files) is trimmed. Output is one line of compact JSON in a fixed field order.

An absent/non-integer/`< 1` `--k`, a line that is not valid JSON, a non-number, or a number that overflows to `±Infinity` (`1e999`) or is `NaN` is a **hard error (exit 2)** naming the problem — never a silent skip or default. An empty stream folds to `{"count":0,"k":K,"top":[]}`.

## What this is *not*

Not a full sort of the stream (it keeps only k, in O(k) space), not a median/percentile/quantile (it keeps no interior order statistics), and not a histogram or a running mean (see [`histogram-fold`](../histogram-fold/) / [`running-stats`](../running-stats/)).

## License

MIT. Zero dependencies — Node builtin `require('fs')` for file reads only; runs in a browser with no `require` at all (attaches `topkFold` to `window.ForestGifts`).
