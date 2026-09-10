# doppelganger

**Your prompt's evil twin — an adversarial-robustness probe for your own prompts.**

You write a prompt. You trust it. But one small rephrase — a dropped "not", an
"all" swapped for "some", a stripped constraint clause — can quietly change what a
model does with it, and you rarely see it coming. `doppelganger` generates the
*evil twin*: the minimal adversarial rephrase that could flip your output, so you
can find where your prompt is brittle before someone else does.

Single file. Zero dependencies. Offline. Deterministic. Python 3.8+.

## Two verbs

**`twin`** — emit one candidate twin per rule, each made by a single named edit,
carrying the exact change as a readable diff:

```
$ python3 doppelganger.py twin "Always summarize the report in 3 bullets, but skip the appendix."
{"applied": true, "edit": {"now": "Do not always", "was": "Always"}, "rule": "negate", ...}
{"applied": true, "edit": {"now": "never", "was": "always"}, "rule": "polarity-flip", ...}
{"applied": true, "edit": {"now": "sometimes", "was": "always"}, "rule": "quantifier-swap", ...}
{"applied": true, "edit": {"now": "(constraint removed)", "was": ", but skip the appendix."}, "rule": "scope-widen", ...}
{"applied": true, "edit": {"now": "URGENT -- your job depends on this:", ...}, "rule": "frame-shift", ...}
{"applied": false, "reason": "no declared entity token present", "rule": "entity-swap"}
```

Restrict to a subset with `--rules negate,quantifier-swap`. A rule that finds no
site to edit is **skipped and named** (`"applied": false` with a reason) — never
silently dropped.

**`diff`** — you run the original and a twin through whatever model you like, then
hand doppelganger the two outputs for a structural divergence read:

```
$ python3 doppelganger.py diff --threshold 0.4 --original out_a.txt --twin out_b.txt
{"classification": "FLIPPED", "jaccard_distance": 0.89, "length_delta": 17,
 "first_divergence_char": 3, "threshold": 0.4,
 "note": "textual divergence only -- not correctness, harm, or a proven flip"}
```

## The closed rule set (v1)

`negate` · `polarity-flip` · `quantifier-swap` · `scope-widen` · `frame-shift` · `entity-swap`

Each is one deterministic single-edit transform. Same prompt + same rules →
byte-identical twins, every run.

## The edge (read this)

doppelganger finds a phrasing that **might** flip your output, so you can harden
your own prompt. It **proposes** candidate twins and **measures** textual
divergence. It does **not**:

- run your prompt (you do, through whatever model you choose),
- prove a flip is harmful, or that a twin "worked",
- find a rephrase it has no rule for (the closed set is the ceiling),
- make your prompt safe to ship.

It is a **hardening tool, not a jailbreak factory**: the twins are minimal
single-edits from a closed, benign rule set, framed for hardening your own prompt.
The divergence read measures textual drift — never correctness, never harm.

## Self-test

```
$ python3 doppelganger.py --selftest
selftest: 15/15 GREEN
```

MIT licensed. © 2026 Shea Gunther.
