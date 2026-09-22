# sign-fold — the signed three-way residual over a declared budget

One file. MIT. Zero dependencies. Node or the browser. Feed it a stream of
`{declared, actual}` records and it tells you, per record, how far `actual` landed
from what you `declared` — and on which side of the line.

```
$ node sign-fold.js < budget.jsonl
{"label":"api-latency","declared":200,"actual":248,"residual":48,"sign":"over"}
{"label":"bundle-kb","declared":150,"actual":150,"residual":0,"sign":"at"}
{"label":"error-rate","declared":5,"actual":2,"residual":-3,"sign":"under"}
{"roll":{"over":1,"at":1,"under":1,"count":3}}
```

## What it does

You **declare** a number and record the **actual**. `sign-fold` emits the
`residual = actual - declared` and its `sign`:

- **`over`** — `actual > declared`
- **`at`**   — `actual == declared`
- **`under`** — `actual < declared`

Input is JSONL: one `{"declared":D,"actual":A}` object per line, with an optional
`"label"`. Output is one record per input line — `{label, declared, actual,
residual, sign}` — in file order, followed by a final roll-up
`{"roll":{over, at, under, count}}`.

## Usage

```
node sign-fold.js < records.jsonl     # read stdin
node sign-fold.js records.jsonl       # or one FILE argument
node sign-fold.js --help
```

As a library:

```js
const { fold, computeRecord, signOf } = require('./sign-fold.js');
const { lines, roll } = fold('{"declared":3,"actual":5}\n');
// lines[0] -> { label:null, declared:3, actual:5, residual:2, sign:"over" }
// roll     -> { over:1, at:0, under:0, count:1 }
```

In a browser the same functions hang off `window.ForestGifts.signFold`.

## The edge — what it reports, and what it will not

**It reports the SIGN, never the VIRTUE.** `actual >= declared` means the count
relation holds — it does **not** mean the work is good, or the budget was right.
The floor is only as honest as the number you declared.

- **Exact equality, no epsilon.** `at` means `actual === declared` to the number.
  A caller who wants a tolerance band computes it off `residual` themselves —
  baking one tolerance into the tool would be a policy choice you should own.
- **Finite numbers only.** A record whose `declared` or `actual` is missing,
  non-numeric, `NaN`, or `Infinity` is a thrown error naming the line — it does
  not guess a zero.
- **Malformed input throws, it never repairs.** A line that isn't valid JSON, or a
  record that isn't a JSON object, stops the fold with the line number. Blank lines
  are skipped.

## Guarantees

- **Zero dependencies.** Imports nothing but Node's `fs` for CLI I/O; the core
  (`fold` / `computeRecord` / `signOf`) touches no I/O and runs unchanged in a
  browser.
- **Deterministic.** No clock, no randomness, order-preserving. The same bytes in
  always produce byte-identical bytes out.

## Tests

`node test_sign-fold.js` — a drift-check battery with hand-computed oracles
(over / at / under / zero / negative / label-null / order / roll-up /
determinism / malformed-input honesty), plus a mutation bite that proves the
battery fails on a deliberately-wrong copy (a build cannot certify itself).
