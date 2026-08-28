# hunkhole — find the change git's own tools hide

Git tells you which **files** changed. It does not tell you when a stale working
tree, a bad merge, or a clumsy restore quietly **reverted** part of a file while
leaving the file itself in place. A file-presence check reads that as a clean
recovery — the file is there, so nothing looks wrong — while a load-bearing
definition that used to live inside it is simply gone.

hunkhole is the one command that catches it. It diffs the **set of named
top-level definitions** between two git revisions and reports the ones that
vanished.

```
$ python3 hunkhole.py <BEFORE> [AFTER]
hunkhole: 6a2bef5bd -> HEAD  ·  38 file(s) swept
------------------------------------------------------------------------------
HOLE          shell/router.js
                 gone: resolveRoute()
                 gone: buildTable()
------------------------------------------------------------------------------
1 finding(s). Each is a QUESTION, not a verdict — a rename reads the same as a revert.
```

## The probe

Not "did this file change" (forward work changes files constantly) but "is a
named, top-level definition that existed at **BEFORE** absent at **AFTER**." A
symbol present in the old revision and gone in the new one, with nothing renamed
to take its place, is the reverted-hunk shape.

## Why it's honest — read this before trusting a clean run

- **Every hit is a QUESTION, not a verdict.** A symbol you deliberately renamed
  or retired reads exactly like one that was reverted away. hunkhole hands you
  the finite list; you rule on each.

- **A clean run is NOT a clean bill.** hunkhole sees *named top-level*
  definitions (`function` / `const` / `exports.x` / `def`). A hunk reverted
  *inside* a surviving function body is invisible to it — the function name is
  still there. Absence of a finding is not proof of a clean restore, and the
  tool says so in its own output.

- **It is read-only.** It writes nothing, changes nothing, fixes nothing. It
  reads two revisions out of git and compares symbol sets.

Visibility, not immunity. You are the witness.

## Use it

```
python3 hunkhole.py <BEFORE>                     # compare BEFORE to HEAD
python3 hunkhole.py <BEFORE> <AFTER>             # compare two revisions
python3 hunkhole.py <BEFORE> <AFTER> --against <CLOBBER>
        # limit the sweep to files one suspect commit touched
```

`BEFORE` / `AFTER` / `CLOBBER` are anything git resolves — a sha, tag, or branch.

As a library, the symbol-diff core is pure and git-free:

```python
import hunkhole
hunkhole.vanished_symbols(before_text, after_text)   # -> sorted list of gone names
hunkhole.symbols(source_text)                        # -> set of defined names
```

**Exit codes:** `0` no vanished symbols · `3` findings (the alarm) · `2` error.

Python standard library only. Read-only. Deterministic.

## Tests

```
python3 test_hunkhole.py
```

Mutation-bitten: the core-diff test pins a **golden** vanished-set signature, and
an end-to-end test builds a throwaway git repo, reverts one definition, and
proves hunkhole finds exactly that hole. Each test is here because a plausible
mutation makes it fail loud.

MIT licensed. © 2026 Shea Gunther.
