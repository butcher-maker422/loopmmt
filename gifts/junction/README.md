# junction — merge declared branch-records into one, under a required policy

**junction** takes the labeled records a `fanout` produced and a **declared** merge policy, and
emits a single merged record. It is the **close half of a parallel-independent compose** (the ⊗
product): `fanout` splits, `junction` merges — together they give a pipeline the parallel
product to sit beside sequential (`|`) composition, and `fanout | junction` round-trips.

Zero dependencies. Pure fold — same records + same policy yields byte-identical output, every
run. Records are folded in `seq` order, so their arrival order never leaks. Runs in a browser
(`window.ForestGifts.junction`) or on Node.

## Use

```
node fanout.js --branches a,b,c "p" | node junction.js --policy concat   # the braid
node junction.js --policy agree < records.jsonl
node junction.js --policy map --input records.jsonl
node junction.js --help
```

Policies (closed set, **no default**):

- **`concat`** — an ordered list of the branch inputs.
- **`agree`** — require every branch identical, emit the value; **refuses** a disagreement,
  naming the two branches (it never picks a winner).
- **`first`** — the `seq:0` branch's input.
- **`map`** — a `branch → input` object.

It **fails closed** — non-zero exit, the cause named — on no policy, an unknown policy,
malformed input (a non-record line, an `of` that disagrees with the count, a duplicate `seq`),
or an `agree` conflict.

## The edge (what it does NOT do)

> junction merges declared branch-records into one under a declared policy; it does not choose
> the policy for you, run the branches, or resolve a value conflict the policy leaves ambiguous
> — it refuses when no policy is declared or the policy cannot merge cleanly.

## Test

```
node test_junction.js   # GREEN/RED: golden corpus + determinism + non-vacuity
node test_braid.js      # GREEN/RED: the fanout|junction ⊗ braid (the pair's done-gate)
```

Released under the MIT License (see `LICENSE`).

<!-- keel: gift -->
