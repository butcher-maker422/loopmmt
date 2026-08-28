# conflict — refuse to commit a file that no longer parses

A merge that goes wrong leaves `<<<<<<<`, `=======`, `>>>>>>>` markers wedged into
a file. Once committed, that file no longer parses — it isn't "a merge in
progress," it's **broken source that landed**. And it hides: the failure surfaces
only when something tries to read the file, so a conflicted file can sit on your
main branch for days while everything downstream of it silently degrades.

`conflict` is the one-command gate that catches it. Wire it into a pre-commit
hook or CI and a broken file simply cannot land.

```
$ python3 conflict.py
conflict: 1 file(s) in the working tree carry an UNRESOLVED MERGE.
  config/settings.json:14  <<<<<<< / ======= / >>>>>>>  (1 conflict block(s))

A conflict marker on a branch is not a merge in progress — it is a FILE THAT NO
LONGER PARSES, landed. Resolve it. Do not commit over it.
```

## Why it's honest

- **The triad, never the lone middle.** `=======` on its own is a legal line — a
  Markdown horizontal rule, a Python separator comment, an ASCII banner.
  `conflict` fires only on the full triad (`<<<<<<<` **and** `=======` **and**
  `>>>>>>>`) within one file. A lint that cries wolf on a legal line gets
  disabled, and a disabled lint is worse than none.

- **Decidable from bytes.** A conflict marker on a branch needs no judgment — it's
  arithmetic. `conflict` reports the finding as an **exit code**, not a paragraph:
  exit codes don't decay, don't need finding, and cost nothing to re-run.

- **Line-start only.** A marker mid-line (inside a string, say) doesn't count —
  only a line that *starts* with a marker. Three markers embedded in prose won't
  false-fire.

- **It is read-only.** It reads blobs out of git (or off disk) and compares. It
  writes nothing and fixes nothing.

## The honest edge

This is a check, not an immunity — it protects you only when it is **run**. Wire
it into a hook or CI so "run it" isn't something a human has to remember. And it
detects the standard git marker triad; a tool using different markers needs a
different pattern. Visibility, not immunity.

## Use it

```
python3 conflict.py                              # scan the working tree
python3 conflict.py --ref main                   # scan any committed tree by ref
python3 conflict.py --ignore _snapshots/ --ignore vendor/
                                                 # skip path substrings (repeatable)
```

As a pre-commit hook (`.git/hooks/pre-commit`):

```sh
#!/bin/sh
python3 path/to/conflict.py || exit 1
```

As a library, the marker core is pure and git-free:

```python
import conflict
conflict.has_conflict(text)      # -> True if the file carries the marker triad
conflict.marker_lines(text)      # -> {marker: [1-based line numbers]}
```

**Exit codes:** `0` clean · `3` unresolved merge found (the alarm) · `2` error.

Python standard library only. Read-only. Deterministic.

## Tests

```
python3 test_conflict.py
```

Mutation-bitten: the tests pin the triad rule (a lone `=======` must not fire),
the line-start rule (three markers mid-line must not fire), and an end-to-end run
against a throwaway repo. Each test is here because a plausible mutation makes it
fail loud.

MIT licensed. © 2026 Shea Gunther.
