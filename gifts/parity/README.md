# Parity

**Compare N sibling things against a shared checklist, and see exactly where they disagree.**
~250 lines, Python standard library only, no dependencies, deterministic, MIT
licensed.

> Three services that should expose the same endpoints. Four config files that
> should carry the same keys. Five components that should each implement the same
> features. Parity lines them up in one table and shows you the rows where they
> *don't* all match — which is the whole reason you looked.

## The idea in one paragraph

You have several things that are supposed to be alike, and drift creeps in — one
service quietly loses an endpoint, one config forgets a key, one component never
implemented a feature the others have. Parity reads a small JSON description of
your things and the marks each one declares, joins them on a **normalized key** so
trivial spelling differences (`Compose` / `compose` / `compose-btn`) collapse to a
single row, and folds the whole thing into a grid: rows are the checklist, columns
are your things, each cell is HAS or LACKS. The **checklist builds itself** — it is
the union of every mark any thing declares — so a capability that exists on even
one thing becomes a row, and the things missing it show up in that row. The rows
where they disagree fall out as the **gap list**, which is what you came for.

## The one honest limit

`HAS` means exactly one thing: *a mark that normalizes to this key was declared for
this thing.* It does **not** mean the feature works, or that it behaves the same as
the next column's. Parity is a **presence** fold, not a behavior test — every cell
carries `predicate: "declared-present"` so a fact copied out of the table still
says what it does and doesn't establish. Any row where two or more things HAS is
flagged `needs-behavior-check`: a candidate for you to verify by hand, never a
claim that they actually match. Parity finds where to look; it does not tell you
the things behind the marks are truly the same.

## Install

Copy `parity.py`. That's it. Python 3.8+.

## Use

```bash
python3 parity.py spec.json                 # human grid
python3 parity.py spec.json --gaps-only      # just the disagreeing keys, one per line
python3 parity.py spec.json --json           # the full matrix as JSON, to pipe onward
python3 parity.py spec.json --check           # fold twice; exit 3 if it wouldn't reproduce
python3 parity.py - < spec.json               # read the spec from stdin
```

### The spec

```json
{
  "things": [
    {"name": "mail",     "marks": ["compose", "search", "archive"]},
    {"name": "calendar", "marks": ["compose", "search"]},
    {"name": "contacts", "marks": ["search", "Compose"]}
  ],
  "aliases": {"create": "compose", "new": "compose"}
}
```

`aliases` is optional. It maps an alternate spelling to a canonical key before the
matrix is built, so genuine synonyms (`create` → `compose`) collapse into one row
too. An alias that never matches a declared mark, or whose target no thing
declares, is a **dead alias** and fails the check (exit 3) — a checklist keyed on
an item nobody has is worthless.

### What that spec prints

```
capability  mail      calendar  contacts
----------------------------------------
archive     ✓         ·         ·          <- gap
compose     ✓         ✓         ✓
search      ✓         ✓         ✓

gaps (things do not all agree): archive
```

## Exit codes

- `0` — folded (and with `--check`, byte-identical to its own re-fold)
- `2` — usage or input error (bad path, malformed JSON, a thing with no name)
- `3` — `--check` drift, or an empty checklist / dead alias

## Tests

```bash
python3 test_parity.py     # 33/33, mutation-bitten, pinned structural golden
```

The golden pins the **shape** — keys, order, cell states, gap list — not any hash
or clock, so it is stable on every machine. The suite is mutation-bitten: removing
the row sort, flipping the HAS/LACKS predicate, dropping either dead-alias gate, or
dropping the behavior-check flag each breaks a named count.

## The edge, said plainly

Parity compares **what each thing declares**, not what it does. You hand it the
marks; if a thing is missing a mark it actually has (you didn't list it) or lists
one it doesn't really implement, parity reflects your list, faithfully and
dumbly. It normalizes spelling and collapses the synonyms you name, and it will
tell you where your things disagree on paper — but whether two `HAS` cells behave
the same is a question it hands back to you, flagged, never answered. It reports
the parity of your checklist; it does not certify the things behind it.

MIT licensed. Python standard library only. No dependencies. Deterministic.
