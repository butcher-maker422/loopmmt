# confessional

**Your prompt goes to confession — it admits what it does NOT constrain.**

Every prompt is a set of things you told the model to do. But the gaps — the
dimensions you never pinned down — are where its behavior drifts. You asked for a
summary but never said how long; you named a task but never what to refuse; you set
the content but never the format. `confessional` reads a prompt and emits its
**honest ceilings**: the constrainable dimensions your prompt left open, each named,
each with the evidence.

Single file. Zero dependencies. Offline. Deterministic. Python 3.8+.

## Two verbs

**`confess`** — read one prompt; emit what it **closes** (with the phrase that closed
it) and what it leaves **open** (with the absence that left it open):

```
$ python3 confessional.py confess "Summarize the quarterly report in 3 bullets, in a formal tone, and cite your sources."
CONFESSION
============================================================
CLOSED (4) -- what this prompt DOES constrain:
  [x] output-format   (3 bullets)
  [x] length          (3 bullets)
  [x] tone            (formal tone)
  [x] grounding       (cite)

OPEN (4) -- what it does NOT constrain:
  [ ] audience        no reader named (no audience/for-a-... spec)
  [ ] refusal         no refusal/fallback behavior stated (no if-you-can't clause)
  [ ] edge-cases      no edge-case handling stated (empty/malformed/ambiguous input unaddressed)
  [ ] scope-boundary  no scope boundary stated (nothing said to leave OUT)
```

Restrict to a subset with `--dimensions output-format,length,refusal`. An unknown
dimension name is **surfaced** (`skipped_unknown`), never silently dropped. Add
`--json` for machine output.

**`chain`** — accumulate two or more confessions to see what **none** of them
constrained. A dimension is closed in the chain iff *some* link closed it, so the
residual open set is the intersection of every link's open set:

```
$ python3 confessional.py confess --json "Answer in 3 bullets." > a.json
$ python3 confessional.py confess --json "Use a formal tone." | python3 confessional.py chain a.json
CHAIN CONFESSION  (2 links)
============================================================
closed by SOME link (3): length, output-format, tone

open in EVERY link (5) -- what NONE of them constrained:
  [ ] audience
  [ ] edge-cases
  [ ] grounding
  [ ] refusal
  [ ] scope-boundary
```

The chain is order-independent and idempotent — chaining a confession with itself
changes nothing.

## The closed dimension set (v1)

`output-format` · `length` · `tone` · `audience` · `refusal` · `edge-cases` ·
`scope-boundary` · `grounding`

Each has one deterministic detector that reports a dimension CLOSED **only** on a
nameable positive match; otherwise it is OPEN with a stated reason. Same prompt →
byte-identical confession, every run.

## The edge (read this)

confessional surfaces the constrainable dimensions your prompt left open, from a
**declared checklist**. It **confesses**; it does not **audit**. It does **not**:

- find a gap **outside** its checklist (a dimension it has no detector for is
  invisible, by construction — the closed set is the ceiling),
- tell you whether an open dimension **matters** for your task (an open axis is a
  fact about the prompt's text, not a verdict — some prompts *should* leave a
  dimension open),
- make your prompt **complete** (a clean board over the checklist proves coverage of
  the *declared* axes, not completeness).

Its deepest edge, printed on every run: **it cannot find the gap you never named.**

## Install

There is nothing to install. Copy `confessional.py` anywhere and run it with
Python 3.8 or newer. Prove it works in your tree:

```
python3 smoke_test.py
```

Released under the MIT License. © 2026 Shea Gunther.
