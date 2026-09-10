# clause-trellis — lay a mega-prompt's clauses on a grid, find WHICH TWO contradict

You wrote a big prompt. Over time it grew clauses — *"answer in under 200 words"*,
*"be exhaustive"*, *"output JSON"*, *"write a friendly paragraph"*. Somewhere in there
two of those clauses pull against each other, and the model quietly obeys one and drops
the other. **clause-trellis lays your clauses on a grid where every clause crosses every
other clause, and localizes a contradiction to the single cell where two clauses meet —
it names the pair, not just "something's wrong".**

The shape is borrowed from the [`trellis`](../trellis/) gift — localize a failure to the
single cell where two things cross — but the grid here is the *N × N matrix of
clause-against-clause*, and the crossing test is a decidable conflict oracle over
**declared dimensions**, not arc-consistency over letters. It reuses the shape; it is not
`trellis` renamed.

## What a clause is

A clause names a **dimension** and constrains it. Two decidable shapes of constraint:

```json
[
  { "id": "brevity",      "dim": "length", "max": 200,  "text": "Answer in under 200 words." },
  { "id": "thoroughness", "dim": "length", "min": 500,  "text": "Be exhaustive." },
  { "id": "as-json",      "dim": "format", "is": "json", "text": "Return JSON." },
  { "id": "as-prose",     "dim": "format", "in": ["prose", "markdown"], "text": "Write a paragraph." }
]
```

- a **range** on a dimension: `min` and/or `max` (numbers)
- a **categorical** on a dimension: `is` (one value) or `in` (a non-empty allowed set)

The `id` is yours (it addresses the cell in the receipt). The `text` is the human
sentence the clause came from — **carried, never parsed**.

## The conflict oracle

Two clauses on the **same dimension** contradict iff their constraints cannot both hold:

- two **ranges** conflict iff they do not overlap
- two **categoricals** conflict iff their allowed sets are disjoint
- a **range vs a categorical** on the same dimension is *not decidable* from declared
  data — reported separately as `cross_kind`, never as a false OK
- clauses on **different dimensions** never conflict — they are orthogonal by construction

## The honest edge

clause-trellis finds contradictions you **declared**, over a closed set of decidable
dimensions (numeric ranges + categorical values). **It does not read intent, meaning,
tone, or the natural-language text of a clause** — if two sentences contradict in spirit
but you did not declare the shared dimension, it will not see it. Silence means *"no
declared contradiction"*, which is necessary, not sufficient. It finds the conflicts you
wrote down; it does not understand the prompt.

## Use it

```bash
python3 clause-trellis.py solve clauses.json   # find contradicting pairs; exit 3 if any
python3 clause-trellis.py demo                  # a small worked prompt
python3 clause-trellis.py --selftest           # deterministic core, byte-identical
```

Exit `0` = CLEAR (no declared contradiction) · `3` = CONTRADICTORY (each pair named and
located) · `2` = spec error (fail-closed — never silently "clear").

As a library:

```python
import importlib.util
spec = importlib.util.spec_from_file_location("clause_trellis", "clause-trellis.py")
ct = importlib.util.module_from_spec(spec); spec.loader.exec_module(ct)

r = ct.solve([{"id": "a", "dim": "length", "max": 100},
              {"id": "b", "dim": "length", "min": 200}])
r.verdict       # 'CONTRADICTORY'
r.conflicts     # [{'row': 'a', 'col': 'b', 'dim': 'length', 'reason': '...'}]
```

## Test it

```bash
python3 clause-trellis.py --selftest      # 8 checks: determinism, localization, boundaries,
                                          # cross-kind, fail-closed spec errors
python3 test_clause-trellis.py            # 19 tests / 25 checks, + a mutation bite that
                                          # proves the teeth (2 mutations caught)
```

Python 3 stdlib only, no dependencies, offline. MIT licensed. Take the folder.
