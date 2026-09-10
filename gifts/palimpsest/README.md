# palimpsest

Layer every version of a text and see what showed through every rewrite.

A palimpsest is a manuscript written over an erased earlier one, where the old
writing still shows through. Give `palimpsest` the successive versions of a
prompt — or any text — in order, and it shows you the lines that survived
revision after revision (the load-bearing **core**) versus the lines that came
and went (**churn**).

## What it measures

For each distinct line, its **survival rate** = (number of versions the line
appears in) / (number of versions). A line present in every version has
survival `1.0`; a line in one version of five has survival `0.2`. The **core**
is every line whose survival meets a threshold (default `1.0` — present in
*every* version); **churn** is the rest.

## Usage

```
node palimpsest.js v1.txt v2.txt v3.txt
```

```
palimpsest — 3 versions layered

CORE (load-bearing — survived the threshold):
  100%  You are a helpful assistant.

CHURN (came and went):
   66%  Always cite sources.
   66%  Be concise.
   33%  Use bullet points.
```

Loosen "load-bearing" with `--core`:

```
node palimpsest.js --core 0.5 v1.txt v2.txt v3.txt   # in at least half the versions
```

## Exit codes

- `0` — ran clean; a survival map was produced.
- `2` — input could not be used (no version files, an unreadable/missing path, a
  directory, or a `--core` outside `[0,1]`). Always a clean one-line message,
  never a stack trace.

## Determinism

A line is keyed by its canonical form (trailing whitespace trimmed, interior
preserved; blank lines dropped). Output is totally ordered — survival
descending, then first-appearance, then the line itself — so the result is a
pure function of the inputs. `--selftest` proves the canon is idempotent and the
layering is stable: same versions, same bytes, every run.

## The line it will not cross

palimpsest measures **survival, not quality**. A line that survived every draft
is load-bearing *to the author* — it is not thereby correct, good, or necessary.
A mistake copied faithfully through every version survives with rate `1.0` and
lands in the core. Persistence is evidence of intent, never of merit. A human
reads the core and decides what it means; the tool only makes survival visible
and exact.

## Install

One file, no dependencies. Copy `palimpsest.js` anywhere Node runs (or import
`{ layer, canonLine, render }` in a browser — no DOM used). MIT licensed.
