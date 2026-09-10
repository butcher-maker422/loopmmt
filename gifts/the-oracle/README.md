# the-oracle — a reproducible seeded-decision engine for prompt A/B

You are testing prompt variants (or any `k` options) and you want the assignment to
be a **fact you can reproduce**, not a hidden coin-flip that quietly contaminates the
experiment. the-oracle turns the decision into an audit record: name your variants,
commit a **seed** at a **moment**, and it deterministically picks one — writing a
replayable receipt so the exact same pick can be re-derived on any machine, forever.

The pick is *reversal-indexed*, the shape borrowed from the `dwell` gift — the seed
and the moment define a phase, and the chosen variant is a pure function of that phase:

```
phase(seed, moment, n)          = (moment - seed) mod n     # where on the loop, in [0, n)
pick_index(seed, moment, n, k)  = (phase * k) // n          # which of k variants, in [0, k)
```

There is no separate randomness step. Given `(seed, moment, n, k)` the chosen variant
is **determined** — integer-exact, no float, byte-replayable. The default resolution is
`n = k`, so each unit of `moment` advances the pick by one variant and an extra full
lap (`+k`) changes nothing.

## Why it's honest

- **Reproducible by construction.** The same `(variants, seed, moment)` yields the same
  pick on any machine, forever — the property that makes a prompt A/B trustworthy.
- **A decision is an audit record, not an opinion.** Every `cast` emits a receipt (the
  variant list plus the two integers that made the pick); `replay` re-derives the pick
  from the receipt alone. You re-check a decision by recomputing it, never by trusting a
  stored verdict. A `--ledger` collects a batch of assignments into one replayable file.
- **Free-hold.** The *winding* number (how many full laps passed between seed and moment)
  is discarded for the pick, so waiting a full lap is never penalized:

  ```
  pick_index(seed, moment, n, k) == pick_index(seed, moment + n, n, k)
  ```

## The honest edge

the-oracle makes an assignment **reproducible and auditable**; it does **not** make it
fair, uniform, or unbiased — a chosen `(seed, moment, n)` can skew which variant wins,
and reproducing a skewed pick reproduces the skew. It does **not** run your prompts, call
any model, score a variant, or tell you which one is better. It decides *which* variant,
reproducibly; it does not decide whether the experiment was sound. **Reproducible, not
random.**

## Use it

```bash
python3 the-oracle.py pick  --seed 7 --moment 19 --variants A,B,C     # -> the chosen variant
python3 the-oracle.py pick  --seed 7 --moment 22 --variants A,B,C     # +1 full lap (k=3) -> same pick
python3 the-oracle.py cast  --seed 7 --moment 19 --variants A,B --trace EXPT1 --ledger runs.jsonl
python3 the-oracle.py replay --ballot ballot.json                     # re-derive a recorded pick
python3 the-oracle.py demo                                            # a small decision table
```

As a library:

```python
from importlib import import_module
oracle = import_module("the-oracle")           # module name has a hyphen

oracle.cast(["A", "B", "C"], seed=7, moment=19)   # {'pick': 'A', 'pick_index': 0, ...}
oracle.replay({"variants": ["A","B","C"], "seed": 7, "moment": 19, "n": 3})  # 'A'
```

## Test it

```bash
python3 the-oracle.py --selftest        # 14 checks: determinism, free-hold, in-range,
                                        # replay-matches, the guards, byte-identical receipt
python3 test_the-oracle.py              # 16 assertions, subprocess-invoked independent
                                        # oracle, + a mutation bite that proves the teeth
```

Python 3 stdlib only, no dependencies, offline. MIT licensed. Take the folder.
