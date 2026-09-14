# interval-math

**Interval arithmetic (`+ − × ÷`) over a JSONL stream — the guaranteed-containing result.**

A tiny, dependency-free tool that reads a stream of operations — one JSON record per line ([JSON Lines](https://jsonlines.org/)) — each naming two intervals and an operator, and emits the resulting interval. An interval `[lo, hi]` stands for "some real number between `lo` and `hi`, inclusive"; interval arithmetic computes the interval **guaranteed to contain** the true result whatever the inputs actually were. Same stream in, byte-identical stream out, on every machine and every run. It is a **transform**: one record in, one record out, in the same order.

```
printf '%s\n' '{"op":"+","a":[1,2],"b":[3,4]}' | node interval-math.js     # -> {"lo":4,"hi":6}
printf '%s\n' '{"op":"*","a":[-1,2],"b":[3,4]}' | node interval-math.js    # -> {"lo":-4,"hi":8}
```

## The operation record

Each non-blank line is one JSON object with an `op` (`"+"`, `"-"`, `"*"`, `"/"`) and two intervals `a` and `b`, each a two-element `[lo, hi]` array of finite numbers with `lo ≤ hi`:

```json
{"op": "/", "a": [1, 1], "b": [2, 4]}
```

The output is `{"lo": L, "hi": H}` — one per record, in input order.

## The containment guarantee

For every operation, the result `[L, H]` is computed so that for **all** `x` in `a` and **all** `y` in `b`, `(x op y)` lies in `[L, H]`. This is the load-bearing property — interval arithmetic is only correct if it never loses a possible result.

| op | rule |
|---|---|
| `+` | `[a,b] + [c,d] = [a+c, b+d]` |
| `−` | `[a,b] − [c,d] = [a−d, b−c]` (subtract the *other* interval flipped) |
| `×` | `[a,b] × [c,d] = [min, max]` of the **four** corner products `{ac, ad, bc, bd}` |
| `÷` | `[a,b] ÷ [c,d] = [a,b] × [1/d, 1/c]`, **only** when `[c,d]` does not contain 0 |

The four-corner multiply matters: a naive `[a·c, b·d]` is **wrong** whenever a sign crosses zero (e.g. `[-2,3] × [-5,4]` is `[-15, 12]`, not `[10, 12]`).

## Division by an interval spanning zero is refused

If the divisor `[c, d]` has `c ≤ 0 ≤ d`, the reciprocal is unbounded and the true result would be `(−∞, +∞)` or a split — so this gift **refuses it** (exit 2) rather than emit a bound it cannot honor. Dividing by an interval strictly on one side of zero (`c > 0` or `d < 0`) is fine.

## Usage

```
usage: interval-math.js [FILE]
  (no FILE)   read operation records from stdin
  FILE        read from a file
  --help
```

Each non-blank line is one operation record; blank lines are skipped; a trailing `\r` (CRLF files) is trimmed. Output is one compact `{"lo":L,"hi":H}` per record, in input order.

Exit codes: `0` success, `2` input error (a line that is not a valid operation record, an unknown op, a non-finite or mis-ordered interval, or a division by an interval spanning zero), always a clean one-line message, never a stack trace.

## The edge — what this does NOT do

interval-math does the **four arithmetic ops** on real intervals. It is **not**:

- a **full interval library** — no power/exponent, roots (`√`), or transcendental functions (`sin`, `exp`, `log`);
- an **interval set** tool — no union, intersection, or hull;
- and it does **no outward-directed rounding** — bounds are plain **IEEE-754 doubles**, so a result whose true endpoint is not exactly representable is stored as the nearest double (which may be a hair *inside* the mathematically-guaranteed bound). For verified/certified interval arithmetic use a rational or directed-rounding library; this is the honest zero-dependency **representation**, not a proof engine.

Division by an interval containing zero is **refused, not split** — if you need multi-interval (extended) division, this is the wrong tool.

## License

MIT © 2026 Shea Gunther. Zero dependencies. Runs in Node (`node interval-math.js`) or a browser (attaches `window.ForestGifts.intervalMath`).
