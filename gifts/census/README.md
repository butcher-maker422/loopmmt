# Census

**Walk a tree, find your markers, and say which ones are buried in comments.**
~200 lines, Python standard library only, no dependencies, deterministic, MIT
licensed.

> The marker you leave in visible code, a visual pass catches. The one buried
> inside a comment, it doesn't. Census tells them apart.

## The idea in one paragraph

You leave markers in a codebase all the time — `TODO`, `FIXME`, a tag that says a
section is a stub. Scanning by eye catches the ones that render where you look.
The dangerous one is the marker **buried inside a comment**: it never renders, so
a visual pass sails right past it and the thing it flagged never gets done.
Census walks a file tree, finds every marker you name, and for each one says
whether it sits in **visible** text or is **buried** in an HTML / block / line
comment. It is deliberately dumb about what a marker *means* — a marker is a
marker — and precise about the one thing that causes misses: visibility. Point it
at your own markers and file types; pipe the result into whatever comes next.

## Install

Copy `census.py`. That's it. Python 3.8+.

## Use

```bash
python3 census.py src/                          # default markers, human report
python3 census.py src/ --marker TODO --marker WRITEME   # your own markers
python3 census.py src/ --buried-only            # only the miss-risk set
python3 census.py src/ --strict                 # exit 1 if any marker is buried
```

Defaults: markers `TODO FIXME XXX HACK STUB`; the common source extensions. Add
your own with `--marker` (repeatable) and `--ext` (repeatable). Markers match as
whole words by default; use `--no-word-boundary` for glyph/punctuation markers
like `<!--WRITE-->`.

"Buried" means the marker sits inside one of: an HTML comment `<!-- -->`, a
C/JS/CSS block comment `/* */`, a `//` line comment, or a `#` line comment.
`.git`, `node_modules`, `.hg`, `.svn`, and `__pycache__` are never descended.

### Composing in a pipe (JSON-lines)

`--json` emits one JSON object per hit on stdout, so Census drops into a pipeline
as a **source**:

```bash
# count buried vs visible
python3 census.py src/ --json | your-counter

# feed only the files that carry a buried marker onward
python3 census.py src/ --json --buried-only | your-next-tool
```

Each line is `{"path", "line", "marker", "visible", "excerpt"}`.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | ran clean (a census is a report, not a gate) |
| 1 | a buried marker was found **and** `--strict` was given |
| 3 | usage / unreadable root |

## Test

```bash
python3 smoke_test.py
```

Nine checks, including a mutation check: an all-visible or all-buried classifier
could not produce the mixed populations the suite asserts.

## License

MIT — see `LICENSE`. Copyright (c) 2026 Shea Gunther.
