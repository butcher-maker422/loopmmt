# seq-source

**Emit a deterministic arithmetic sequence as a JSONL record stream.**

A tiny, dependency-free tool that takes no input — it *generates* one. Give it a count (and optionally a start, a step, and a field name) and it emits that many JSON objects, one per line ([JSON Lines](https://jsonlines.org/)), each holding the next term of an integer arithmetic sequence. It's the front of a pipe: a deterministic generator you feed *into* other stream tools, so you can produce a known stream without hand-writing a file.

```
node seq-source.js --count 5                     ->  {"n":0} {"n":1} {"n":2} {"n":3} {"n":4}
node seq-source.js --count 5 --start 10 --step 5 ->  {"n":10} {"n":15} {"n":20} {"n":25} {"n":30}
node seq-source.js --count 3 --field id --start 100 -> {"id":100} {"id":101} {"id":102}
```

## The model

```
--count N     REQUIRED. how many terms to emit (integer >= 0; 0 emits nothing)
--start S     the first term (integer, default 0)
--step  D     the common difference (integer, default 1; may be 0 or negative)
--field NAME  the object key each term is emitted under (default "n")
```

Each term `i` (0-based) is emitted as the single-key object `{ NAME: S + i*D }`, one per line — so the output drops straight into the stream tools:

```
node seq-source.js --count 100 | node range-filter.js --num n 10 20
```

## Integers only (the honesty axis)

`count`, `start`, and `step` must be **integers**. This is deliberate: a floating-point sequence *drifts* — `0 + 0.1 + 0.1 + 0.1` is not `0.3` — so its output would not be byte-deterministic, and a source that emits subtly different bytes on different machines is not one you can pin. seq-source **refuses** a non-integer count/start/step (exit `2`) rather than emit a drifting sequence. Every emitted term is exact; the stream is byte-identical on every machine and every run.

## Exit codes

`0` success (including an empty stream from `--count 0`) · `2` input error (missing, non-integer, or negative count; non-integer start/step; empty field name; an unknown option; or a positional argument — seq-source reads no input). Always a clean one-line message on stderr, never a stack trace.

## In a browser

The core is a pure function. Load `seq-source.js` and call `window.ForestGifts.seqSource.generate({count, start, step, field})` for an array of records, or `window.ForestGifts.seqSource.toJSONL(records)` for the JSONL text.

## The edge

seq-source emits an **integer arithmetic sequence only**. It does not do geometric or floating-point sequences, reads no input, and does not randomize. It is a deterministic generator — a source you can pin, not a fixture you have to store. Terms are exact within JavaScript's exact-integer range (±2^53); keep counts and magnitudes sane.

## License

MIT. Zero dependencies. Runs in Node or a browser.
