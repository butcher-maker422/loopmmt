# gitlog

**Turn a git history into one JSON object per commit, on stdout.** ~250 lines,
Python standard library only, no dependencies, MIT licensed.

> A git repository already holds the truth about what happened and when. This
> gets that truth out from behind `git log`'s human format and onto a pipe, as
> records you can fold, filter, count, or chart.

## The idea in one paragraph

`git log` is where a project's real history lives — every commit is a dated,
authored, immutable record — but it prints for human eyes, not for a program.
`gitlog` reads the log and emits **JSON lines**: one object per commit, newest
first by default. Once the history is a stream of records, the questions you
actually have become one pipe away — "how many commits touched this file", "who
authored what last week", "what was the churn per day" — instead of re-parsing
git's text yourself each time. It emits and consumes nothing on stdin, so it sits
at the *start* of a pipeline: `gitlog | your-fold`.

## Install

Copy `gitlog.py`. That's it. Python 3.8+ and `git` on your PATH.

## Use

```bash
python3 gitlog.py --repo .                       # every commit, newest first
python3 gitlog.py --repo . -n 20                 # the 20 most recent
python3 gitlog.py --repo . --reverse             # oldest first
python3 gitlog.py --repo . --path src/app.py     # only commits touching a path
python3 gitlog.py --repo . --since "2 weeks ago" # git date filters pass through
python3 gitlog.py --repo . --author ada          # filter by author
python3 gitlog.py --repo . --churn               # add files/added/deleted per commit
python3 gitlog.py --repo . --ref v1.0..v2.0      # a range instead of HEAD
```

Each line is one commit:

```json
{"authored":"2026-01-03T09:00:00-05:00","author":"Ada Lovelace","committed":"2026-01-03T09:00:00-05:00","email":"ada@example.com","hash":"9f3c...","short":"9f3c1a2","subject":"third: extend a.txt"}
```

With `--churn`, three more fields per commit — `files`, `added`, `deleted`
(the last two are `null` for a binary-only commit, where line counts don't
apply).

## Fields

| field | git source | meaning |
|-------|-----------|---------|
| `hash` | `%H` | full 40-char commit SHA |
| `short` | `%h` | abbreviated SHA |
| `committed` | `%cI` | committer date, ISO-8601 strict |
| `authored` | `%aI` | author date, ISO-8601 strict |
| `author` | `%an` | author name |
| `email` | `%ae` | author email |
| `subject` | `%s` | first line of the message |
| `files` | numstat | files changed *(with `--churn`)* |
| `added` | numstat | lines inserted *(with `--churn`, `null` if binary)* |
| `deleted` | numstat | lines deleted *(with `--churn`, `null` if binary)* |

## Exit codes

| code | meaning |
|------|---------|
| `0` | the log was read and emitted (an empty range is also `0`) |
| `2` | git failed / not a repository / git not found — don't trust the reading |
| `3` | usage / bad input |

Errors go to stderr; stdout stays clean JSON-lines, so a partial failure never
poisons the stream feeding the next tool.

## License

MIT — see `LICENSE`.
