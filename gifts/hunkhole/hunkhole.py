#!/usr/bin/env python3
"""hunkhole — find the change that git's own tools hide: a reverted hunk.

THE HOLE THIS FILLS

Git tells you which *files* changed. It does not tell you when a stale working
tree, a bad merge, or a clumsy restore quietly *reverted* part of a file while
leaving the file itself in place. A file-presence check reads that as a clean
recovery — the file is there, so nothing looks wrong — while a load-bearing
definition that used to live inside it is simply gone.

That failure is real and it hides well: a stale tree can revert tens of
thousands of lines across dozens of files, a later restore returns every *file*,
and because every file is present, no one notices the definitions that never
came back. hunkhole is the one command that would have found it.

THE PROBE

Not "did this file change" (forward work changes files constantly) but "is a
named, top-level definition that existed at BEFORE absent at AFTER." A symbol
present in the old revision and gone in the new one, with nothing renamed to
take its place, is the reverted-hunk shape. hunkhole diffs the *set of defined
names* between two git revisions and reports the ones that vanished.

WHY IT'S HONEST — read this before trusting a clean run

- **Every hit is a QUESTION, not a verdict.** A symbol you deliberately renamed
  or retired reads exactly like one that was reverted away. hunkhole hands you
  the finite list of vanished names; you rule on each. It never claims a symbol
  "should" still be there.

- **A clean run is NOT a clean bill.** hunkhole sees *named top-level*
  definitions (function / const / exports / def). A hunk reverted *inside* a
  surviving function body is invisible to it — the function name is still there.
  Absence of a finding is not proof of a clean restore, and the tool says so in
  its own output.

- **It is read-only.** It writes nothing, changes nothing, fixes nothing. It
  reads two revisions out of git and compares symbol sets.

Visibility, not immunity. You are the witness.

USAGE
    python3 hunkhole.py <BEFORE> [AFTER]
        BEFORE   a git revision (sha, tag, branch) — the "known-good" side
        AFTER    a git revision to compare against (default: HEAD)

    python3 hunkhole.py <BEFORE> <AFTER> --against <CLOBBER>
        --against   limit the sweep to files touched by one suspect commit,
                    instead of every file that differs between BEFORE and AFTER

EXIT  0 = no vanished symbols · 3 = findings (the alarm) · 2 = error/usage

MIT licensed. Python standard library only. Read-only. Deterministic.
"""
from __future__ import annotations

import re
import subprocess
import sys

# Named top-level definitions across the common scripting languages.
# JS: function foo / const foo = / foo: function / exports.foo   ·   Python: def foo
_DEF_PATTERN = re.compile(
    r"^\s*(?:"
    r"function\s+(\w+)"
    r"|const\s+(\w+)\s*="
    r"|(\w+)\s*:\s*function"
    r"|exports\.(\w+)"
    r"|def\s+(\w+)"
    r")",
    re.M,
)
_CODE_SUFFIXES = (".js", ".py", ".sh", ".mjs", ".cjs")


def git(*args: str) -> str | None:
    """Run a git command; return stdout on success, None on failure."""
    r = subprocess.run(["git", *args], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def symbols(text: str) -> set[str]:
    """The set of named top-level definitions found in a blob of source text."""
    return {name for groups in _DEF_PATTERN.findall(text) for name in groups if name}


def vanished_symbols(before_text: str, after_text: str) -> list[str]:
    """Names defined in `before_text` but not in `after_text`, sorted."""
    return sorted(symbols(before_text) - symbols(after_text))


def is_code(path: str) -> bool:
    """True iff the path has a suffix hunkhole probes for symbols."""
    return path.endswith(_CODE_SUFFIXES)


def scan(before: str, after: str = "HEAD", against: str | None = None):
    """Compare two revisions; return (files_swept, holes, absent).

    holes  — list of (path, [vanished names]) for surviving code files.
    absent — list of paths present at `before` and absent at `after`
             (a whole-file drop; reported alongside hunk holes).
    Returns (None, None, None) if the underlying diff can't be produced.
    """
    listing = git("diff", "--name-only", before, against or after)
    if listing is None:
        return None, None, None
    files = sorted(listing.split())

    holes: list[tuple[str, list[str]]] = []
    absent: list[str] = []
    for f in files:
        a = git("show", f"{before}:{f}")
        if a is None:
            continue  # born after BEFORE — not hunkhole's business
        b = git("show", f"{after}:{f}")
        if b is None:
            absent.append(f)  # whole-file drop — reported, not hunkhole's core probe
            continue
        if not is_code(f):
            continue  # symbols are a code probe; data files need a different lens
        gone = vanished_symbols(a, b)
        if gone:
            holes.append((f, gone))
    return files, holes, absent


def render(before: str, after: str, against: str | None, files, holes, absent) -> str:
    """Render a scan result as the human-readable report text."""
    header = f"hunkhole: {before[:9]} -> {after}"
    if against:
        header += f"  (files touched by {against[:9]})"
    header += f"  ·  {len(files)} file(s) swept"
    lines = [header, "-" * 78]
    for f in absent:
        lines.append(f"FILE ABSENT   {f}")
    for f, gone in holes:
        lines.append(f"HOLE          {f}")
        for s in gone:
            lines.append(f"                 gone: {s}()")
    if not holes and not absent:
        lines.append("no named definition present at BEFORE is missing at AFTER.")
        lines.append("(NOT a clean bill — a hunk inside a surviving function body is invisible here.)")
    lines.append("-" * 78)
    n = len(holes) + len(absent)
    lines.append(
        f"{n} finding(s). Each is a QUESTION, not a verdict — a rename reads the same as a revert."
    )
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help"):
        sys.stdout.write(__doc__)
        return 2
    before = argv[0]
    after = argv[1] if len(argv) > 1 and not argv[1].startswith("--") else "HEAD"
    against = None
    if "--against" in argv:
        i = argv.index("--against")
        if i + 1 >= len(argv):
            sys.stderr.write("hunkhole: --against needs a revision\n")
            return 2
        against = argv[i + 1]

    files, holes, absent = scan(before, after, against)
    if files is None:
        sys.stderr.write(f"hunkhole: cannot diff {before}..{against or after}\n")
        return 2

    sys.stdout.write(render(before, after, against, files, holes, absent) + "\n")
    return 3 if (holes or absent) else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
