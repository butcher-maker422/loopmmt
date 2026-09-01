# worklog

**Turn a git history into a readable worklog over a span of time.**

`git log` is a firehose. What you usually want is the human question underneath it:
*what got done last week?* — grouped by day or by person, summarized, countable.
`worklog` is that. Point it at a git repo and a time span and it emits a grouped
worklog: commits collected over the span, bucketed by day (default) or by author,
each bucket a count and its commit subjects.

```
python3 worklog.py [<repo>] [--since ...] [--until ...] [--by day|author] [--json]
```

It reads the repository through `git log` only. It never writes to the repo, never
touches your working tree, and never needs network — a read-only fold over history
you already have.

## Spans

- `--since <when>` — only commits at or after this date (any git date: `2026-08-01`, `"2 weeks ago"`).
- `--until <when>` — only commits at or before this date.
- `--last <N>` — shorthand for the last N days.
- no span — the whole history reachable from `--ref` (default `HEAD`).

## Grouping

- `--by day` *(default)* — one bucket per calendar day, newest day first.
- `--by author` — one bucket per author, most commits first (ties broken by name).

## The pipe contract

`--json` emits one sorted JSON object per bucket on stdout:

```
{"group":"day"|"author", "key":..., "count":N,
 "commits":[{"hash","date","author","subject"}, ...]}
```

so you can pipe the worklog onward — sum counts, filter to one author, or hand the
whole thing to a summarizer. Without `--json` it prints a grouped human report.

Determinism: for a fixed repo + span + grouping, the output is byte-identical across
runs. Commits are ordered by `(committer-date, hash)`; day buckets are newest-first;
author buckets are most-commits-first then name-ascending. So the worklog is diffable
and hashable.

## The edge — what this does not do

- It reports the **commit record**, not the work. A worklog reflects what was
  committed and when, not effort, difficulty, or lines changed. A day with one large
  commit and a day with ten trivial ones both read as "commits."
- Grouping is by **committer date** and **author name as git records it**. If your
  history has skewed dates (rebases, imported commits, wrong clocks) or the same person
  under two names/emails, the buckets reflect that — `worklog` reports what git says,
  it does not reconcile identities or fix clocks.
- It excludes **merge commits** (`--no-merges`) so the worklog is the work, not the
  plumbing. If you want merges too, that is a deliberate change, not the default.
- It is a **report, not a gate** — it always exits 0 on a valid repo, whether the span
  has commits or none. (Exit 2 means the path isn't a git repo or git failed.)

MIT licensed. Python standard library only (calls your local `git`). No dependencies.
