# fanout — split one input into a fixed, declared set of named branches

**fanout** takes one payload and a **declared, closed** list of branch names, and emits one
labeled JSONL record per declared branch, in declared order. It is the **open half of a
parallel-independent compose** (the ⊗ product): `fanout` splits, its pair `junction` merges.
Together they give a pipeline the parallel product to sit beside sequential (`|`) composition.

Zero dependencies. Pure function of its inputs — same payload + same branch list yields
byte-identical output, every run. Runs in a browser (`window.ForestGifts.fanout`) or on Node.

## Use

```
node fanout.js --branches a,b,c "the prompt"          # payload as argument
echo -n "the prompt" | node fanout.js --branches a,b,c  # payload from stdin (exact bytes)
node fanout.js --branches-file branches.txt "the prompt"  # one branch per line
node fanout.js --help
```

Output (JSONL, one record per declared branch, in declared order):

```
{"branch":"a","input":"the prompt","seq":0,"of":3}
{"branch":"b","input":"the prompt","seq":1,"of":3}
{"branch":"c","input":"the prompt","seq":2,"of":3}
```

It **fails closed** — non-zero exit, the offending branch named — on an empty branch list, an
empty/whitespace branch, a duplicate branch, or a charset-invalid branch (allowed:
letters, digits, `.` `_` `-`). There is no default branch. That refusal is the feature: it
emits **only** to branches you declared, never to one it inferred.

## The edge (what it does NOT do)

> fanout splits one input into declared branches; it does not **run** them, order them by any
> policy but declared order, or judge whether a branch **name** is meaningful — it only
> refuses an *undeclared*, empty, duplicate, or ill-formed branch.

Running the branches is a conductor's job. Merging them back is `junction`'s. Checking that
branches agree is `quorum`'s.

## Test

```
node test_fanout.js    # GREEN (exit 0) / RED (exit 3): golden corpus + determinism + non-vacuity
```

Released under the MIT License (see `LICENSE`).

<!-- keel: gift -->
