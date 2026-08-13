# Grain

**A self-calibrating structure & drift smell test for any corpus.** ~250 lines,
Python standard library only, no dependencies, deterministic, MIT licensed.

> Does this text or relation have *grain* — real structure — or is it slurry?

## The idea in one paragraph

Compress your data with `zlib` (a Kolmogorov *upper* bound: DEFLATE finds
repeated substructure). Then compress a size-matched **random null model** drawn
from your own data's own alphabet, many times, and take its mean and spread. If
your data compresses **clearly more** than the random baseline of its own size,
it carries structure a random arrangement does not — a rule, a template, a hub, a
repetition. The threshold is drawn **live** from the null model, so there is no
magic number to hand-tune as your data grows. That self-calibration is the whole
trick.

Output is a `z_score`: how many standard deviations the real compression ratio
sits **below** the random baseline. Strongly negative → structured.

## Install

Copy `grain.py`. That's it. Python 3.8+.

## Use

```bash
# a relation / dependency graph (one edge per line: a->b or a<TAB>b)
python3 grain.py edges.txt --relation

# prose (word-level; needs real volume to be meaningful — see limits)
python3 grain.py corpus.txt --words

# staleness / drift alarm: save a baseline now, compare later
python3 grain.py corpus.txt --relation --save baseline.json --json
# ...time passes, corpus changes...
python3 grain.py corpus.txt --relation --drift baseline.json

# machine-readable
python3 grain.py edges.txt --relation --json
```

## What it's good for (graded honestly)

- **Corpus staleness / homogenization drift — its best fit.** Snapshot the grain
  signature over time; a drift is a near-free staleness/homogenization alarm. No
  labels, no model, no training.
- **A generating rule leaking into a published relation** (a hub, label reuse) —
  the validated path this was extracted from. Strong here.
- **"AI slop" smell — yes, as a *smell*, not a classifier.** Machine-generated
  text trends more templated and redundant; rising structure against the null is
  a cheap smoke alarm. A smoke alarm, not an arson investigator.

## What it is **not** good for — read this before you trust a reading

- **Data rot.** Dead links, broken references, bit-decay — *wrong tool.* That's a
  reference-integrity problem; Grain measures structure, not reachability.
- **A proof of anything.** It is a **lower-bound smell.** `zlib` is an upper bound
  on complexity, so a low ratio proves compressibility, not a specific cause.
- **Chain-shaped rules.** A chain reuses each symbol ~twice, like a sparse random
  graph — Grain is weak on these, so a clean reading is *not* a certificate of
  "no rule."
- **Tiny inputs.** The signal needs volume. At a few dozen words the null's spread
  swamps the signal and readings are noise. Relation mode is the robust path;
  word-level text mode is honestly **experimental** and wants real corpus size.

The tool prints its own honest ceiling as part of every run. Shipping the limits
*with* the tool is the point.

## The one knob

`Z_CUT = 2.0` — flag `STRUCTURED` when the real ratio is more than 2 sd below the
null mean. Everything else self-calibrates from your data.

## Provenance

Extracted and generalized from the "non-compressibility gate" in the Loop MMT
corpus-map builder, where it catches a generator leak in a published edge graph.
The specific application stayed home; this is the general kernel, given away.

## License

MIT. See `LICENSE`.
