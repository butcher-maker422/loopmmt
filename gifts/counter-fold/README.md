# counter-fold

**A hand-built binary counter — one increment as a fold — that counts by feeding its own state back.**

A tiny, dependency-free tool that reads the **state of a binary counter** — the set of its set bits, one JSON non-negative integer bit-index per line ([JSON Lines](https://jsonlines.org/)) — and folds it into the **next value** by adding **one**, using a **hand-built ripple carry**. The output is the same shape as the input, so it pipes straight back into itself:

```
printf '%s\n' 0 1 | node counter-fold.js        # counter = 1+2 = 3, +1 -> 4
  ->  2                                          # 4 = 2**2, so bit {2}
printf '%s\n' 0 2 | node counter-fold.js | node counter-fold.js
  ->  0
      1
      2                                          # 5 -> 6 -> 7 = {0,1,2}
```

Because output format equals input format, `counter-fold | counter-fold` adds two and `--steps N` internalises that loop: **`counter-fold | counter-fold == counter-fold --steps 2`**. That closed-under-its-own-I/O loop is the point — the counter's state circulating through its own output channel, each pass advancing it by one tick: Shea's mercury delay line, made into a **counter**.

## The increment (a ripple carry, not `+1`)

The counter's value is the sparse binary number whose set bits are the input: `value = Σ 2**i`. Adding one is a **ripple carry**: starting at bit 0, clear each set bit in the trailing run of ones, then set the first clear bit reached.

```
{0,1,3}  (value 11)  +1  ->  {2,3}   (value 12)   # carry ripples through the run of ones
{0,2}    (value 5)   +1  ->  {1,2}   (value 6)     # a gap stops the carry
```

The carry is built from the bit primitive by hand — it is **not** delegated to native `+1`. That is the litmus: build the counter from parts.

## Unbounded and sparse

Only set bits are represented, and a bit index is a **position** — small even when the value is astronomical. A counter at `2**100` is just bit `{100}`. So the counter counts **past 2\*\*53 with no loss** — it never holds the value as a native number. The set bits are unordered on input (a **set** — duplicates collapse, order is irrelevant) and **sorted** on output, so the same counter value is a byte-identical record regardless of how the input was written.

## Usage

```
usage: counter-fold.js [--steps N] [FILE]
  --steps N   add N in-process (default 1; N=0 canonicalises)
  (no FILE)   read the counter's set bits from stdin
  FILE        read the counter's set bits from a file
  --help
```

Each **non-blank line is one set bit as a JSON non-negative integer**. Blank lines are skipped; a trailing `\r` (CRLF files) is trimmed. Output is the next value's set bits, same shape, one per line, sorted. `--steps 0` canonicalises (dedup + sort) without incrementing.

A line that is not a **finite non-negative integer**, or a `--steps` that is negative or non-integer, is a **hard error (exit 2)** naming the problem — never a silent skip. An empty stream is the counter at value 0; `+1` makes it `{0}`.

## What this is *not*

Not a general adder (it adds **one** per step — `--steps N` — it does not add two counters), not a bounded register (it is sparse and unbounded, so it never overflows), and not a value printer (it emits the **set of set bits**, the counter's state — `value = Σ2**i`).

## License

MIT. Zero dependencies — Node builtin `require('fs')` for file reads only; runs in a browser with no `require` at all (attaches `counterFold` to `window.ForestGifts`).
