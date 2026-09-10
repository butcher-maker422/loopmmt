# jsonl-diff

**What changed between two JSONL files — deterministically.**

A tiny, dependency-free diff for [JSON Lines](https://jsonlines.org/) (one JSON value per line). Point it at an OLD file and a NEW file and it tells you what was **added**, **removed**, and — when you name a key — **changed**. The output is sorted and canonical, so it is byte-identical on every run and drops straight into a CI gate or a code review.

```
node jsonl-diff.js --key id old.jsonl new.jsonl
```

## Two modes

- **Set-diff (default).** Records are keyed by their own canonical form: a record either matches exactly or it is added / removed. A record whose content changed shows up as one removed line and one added line. Good for "did this set of records change at all?"
- **Keyed diff (`--key FIELD`).** Records are keyed by the value of `FIELD` (for example `id`). A record present on both sides with the same key but different content is a **change**, reported with its per-field deltas. Good for "which records changed, and how?"

## Usage

```
usage: jsonl-diff.js [--key FIELD] [--out text|json] OLD.jsonl NEW.jsonl
  --key FIELD   key records by FIELD; a same-key record that differs is a CHANGE
                (default: key by the whole record — changes show as remove + add)
  --out text    - removed, + added, ~ changed, then a summary   [default]
  --out json    a canonical JSON result object
  --selftest    run the built-in checks (exit 0 GREEN, 1 RED)
```

Example:

```
$ printf '{"id":1,"v":"a"}\n{"id":2,"v":"b"}\n' > old.jsonl
$ printf '{"id":2,"v":"B"}\n{"id":3,"v":"c"}\n' > new.jsonl
$ node jsonl-diff.js --key id old.jsonl new.jsonl
- 1
+ 3
~ 2
    ~ v: "b" -> "B"
# 1 added, 1 removed, 1 changed
```

The text format is line-oriented on purpose: `-` removed, `+` added, `~` changed (with indented field deltas), and a trailing `# summary`. `--out json` gives a canonical result object (`added` / `removed` / `changed` / `summary`) for a downstream tool.

## Exit codes

Like `diff(1)`, so it works as a gate:

| code | meaning |
|------|---------|
| `0` | the two files are identical (under the chosen mode) |
| `1` | they differ (added / removed / changed present) |
| `2` | the input could not be used — a missing file, a directory, an unreadable file, a bad JSON line, a duplicate key, or a missing `--key` field. Always a clean one-line message, never a stack trace. |

## Determinism

Comparison and output both run over a **canonical form** — object keys sorted, whitespace normalized, no ordering luck — and the result is sorted by key. `--selftest` proves the canonicalizer is idempotent and order-faithful and that the render is byte-stable, so the output is a pure function of the two inputs.

## The line it will not cross

jsonl-diff compares **structure, not meaning**. It tells you two records differ; it cannot tell you the difference matters, is correct, or is safe. Semantic equivalences it will miss (`1` vs `1.0`, `"a,b"` vs `["a","b"]`) count as differences here. A human reads the diff; the tool only makes the change **visible and exact**.

## Install

One file, zero dependencies, Node.js or a browser.

```
node jsonl-diff.js --selftest
```

MIT licensed. Copy it anywhere.
