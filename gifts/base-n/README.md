# base-n

**Convert an integer between bases 2–36 — exactly, at any size — and refuse (naming the digit) on an out-of-range digit.**

`base-n` is a single file, zero dependencies, MIT. It runs on Node (CLI or `require()`) and in a browser (`window.ForestGifts.baseN`). Same input → byte-identical output, every run.

## Why it exists

Base conversion looks solved — `parseInt(s, 16)`, `n.toString(2)` — until you hit its three quiet failures:

1. **Size.** JavaScript's `Number` is exact only to 2⁵³. `parseInt` on a long hash silently rounds and hands you a wrong number that *looks* right.
2. **Silent truncation.** `parseInt("12", 2)` does not reject the `2` — it returns `1`, no error.
3. **Alphabet drift.** Is base-16 `A` the same as `a`? Where does base-36 stop? Tools disagree.

`base-n` fixes all three by construction: it computes on **BigInt** (a 300-digit value is exact), it **fails closed** the instant a digit is illegal for its declared base — naming the digit, the base, and the character offset — and it uses one canonical alphabet (`0-9` then `a-z`, case-insensitive in, lowercase out) for bases 2–36.

## The one discipline

Every digit is proven legal for its base *before* any arithmetic runs. No best-effort parse, no skipped or coerced digit. An illegal digit is a non-zero exit, not a warning. That refusal is the feature.

**Closed under round-trip:** to base *B* and back is the identity on the value, at any size —
`base-n --to 16 | base-n --from 16 --to 10` returns what you started with. That invariant is what the conformance battery checks, and it is why the gift can be trusted on inputs no one hand-verified.

## Usage

```sh
node base-n.js --from 16 --to 10 ff          # -> 255
node base-n.js --to 2 255                     # --from defaults to 10 -> 11111111
node base-n.js --from 2 --to 16 11111111      # -> ff
printf 'ff\n10\n' | node base-n.js --from 16 --to 10          # one record per line
echo '{"value":"ff","from":16}' | node base-n.js --to 10      # JSON record (per-record base)
```

- `--from B` — input base 2–36 (default 10)
- `--to B` — output base 2–36 (default 10)
- Values may carry a leading `-`; `_` separators and surrounding whitespace are ignored.
- On stdin, each line is a bare numeral (uses `--from`) or a `{"value":"...","from":N}` object. The stream fails closed on the first bad record — it never emits some-good-some-dropped.

## What it does *not* do

Integers only. It does **not** parse decimals, fractions, floats, scientific notation, or bases outside 2–36. It decides that a numeral is a legal integer in its declared base and re-expresses it — nothing more.

## License

MIT © 2026 Shea Gunther.
