#!/usr/bin/env python3
"""conflict — refuse to commit a file that no longer parses.

A merge that goes wrong leaves `<<<<<<<`, `=======`, `>>>>>>>` markers wedged
into a file. Once committed, that file no longer parses — it isn't "a merge in
progress," it's broken source that landed. Worse, it hides: the failure surfaces
only when something tries to read the file, and if that read happens in a quiet
place, it can sit on your main branch for days while everything downstream of it
silently degrades.

`conflict` is the one-command gate that catches it. It scans a git tree for the
merge-marker triad and exits non-zero if any file carries an unresolved merge, so
you can wire it into a pre-commit hook or CI and a broken file simply cannot land.

WHY IT'S HONEST

- **The triad, never the lone middle.** `=======` on its own is a legal line — a
  Markdown horizontal rule, a Python separator comment, an ASCII banner. It is a
  conflict marker ONLY in the company of `<<<<<<<` and `>>>>>>>` in the same
  file. `conflict` fires on the *triad within one file*, never on a bare
  `=======`. A lint that cries wolf on a legal line gets disabled, and a disabled
  lint is worse than none.

- **Decidable from bytes.** A conflict marker on a branch needs no judgment, no
  review, no discussion — it is arithmetic. `conflict` reports the finding as an
  exit code, not a paragraph: exit codes don't decay, don't need finding, and
  cost nothing to re-run.

- **It is read-only.** It reads blobs out of git (or off disk) and compares. It
  writes nothing and fixes nothing.

THE HONEST EDGE

This is a check, not an immunity — it protects you only when it is RUN. Wire it
into a hook or CI so "run it" isn't something a human has to remember. And it
detects the standard git marker triad; a tool that uses different markers needs a
different pattern. Visibility, not immunity.

USAGE
    python3 conflict.py                 # scan the working tree (tracked files)
    python3 conflict.py --ref main      # scan any committed tree by ref
    python3 conflict.py --ignore _snapshots/ --ignore vendor/
                                        # skip path substrings (repeatable)

EXIT  0 = clean · 3 = unresolved merge found (the alarm) · 2 = error/usage

MIT licensed. Python standard library only. Read-only. Deterministic.
"""
from __future__ import annotations

import subprocess
import sys

# The three markers git leaves on a conflicted merge. `=======` is only a marker
# in the company of the other two — see the triad rule in main().
MARKERS = ("<<<<<<< ", "=======", ">>>>>>> ")


def git_files(ref: str | None) -> list[str]:
    """List tracked files at `ref` (committed tree) or in the working tree."""
    if ref:
        out = subprocess.run(
            ["git", "ls-tree", "-r", "--name-only", ref],
            capture_output=True, text=True,
        ).stdout
    else:
        out = subprocess.run(["git", "ls-files"], capture_output=True, text=True).stdout
    return out.split()


def read_blob(f: str, ref: str | None) -> bytes:
    """Read a file's bytes at `ref` or from the working tree."""
    if ref:
        return subprocess.run(["git", "show", f"{ref}:{f}"], capture_output=True).stdout
    with open(f, "rb") as fh:
        return fh.read()


def marker_lines(text: str) -> dict[str, list[int]]:
    """Map each marker to the 1-based line numbers where a line STARTS with it."""
    lines = text.split("\n")
    return {m: [i + 1 for i, ln in enumerate(lines) if ln.startswith(m)] for m in MARKERS}


def has_conflict(text: str) -> bool:
    """True iff `text` contains the full marker TRIAD (not a lone `=======`)."""
    found = marker_lines(text)
    return all(found[m] for m in MARKERS)


def is_ignored(path: str, ignore: tuple[str, ...]) -> bool:
    """True iff `path` contains any ignore substring (skip it)."""
    return any(ig in path for ig in ignore)


def scan(ref: str | None = None, ignore: tuple[str, ...] = ()) -> list[tuple[str, dict]]:
    """Return [(path, marker_lines)] for every tracked file carrying the triad."""
    hits: list[tuple[str, dict]] = []
    for f in git_files(ref):
        if is_ignored(f, ignore):
            continue
        try:
            raw = read_blob(f, ref)
        except (OSError, FileNotFoundError):
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            continue  # a binary blob has no markers to read
        if has_conflict(text):
            hits.append((f, marker_lines(text)))
    return hits


def _parse_args(argv: list[str]) -> tuple[str | None, tuple[str, ...]]:
    ref: str | None = None
    ignore: list[str] = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--ref":
            if i + 1 >= len(argv):
                raise ValueError("--ref needs a git ref")
            ref = argv[i + 1]
            i += 2
        elif a == "--ignore":
            if i + 1 >= len(argv):
                raise ValueError("--ignore needs a path substring")
            ignore.append(argv[i + 1])
            i += 2
        elif a in ("-h", "--help"):
            raise ValueError("__help__")
        else:
            raise ValueError(f"unknown argument: {a}")
    return ref, tuple(ignore)


def main(argv: list[str]) -> int:
    try:
        ref, ignore = _parse_args(argv)
    except ValueError as exc:
        if str(exc) == "__help__":
            sys.stdout.write(__doc__)
            return 2
        sys.stderr.write(f"conflict: {exc}\n")
        return 2

    hits = scan(ref, ignore)
    where = f"`{ref}`" if ref else "the working tree"

    if not hits:
        sys.stdout.write(f"conflict: clean — no unresolved merge in {where}.\n")
        return 0

    sys.stderr.write(
        f"conflict: {len(hits)} file(s) in {where} carry an UNRESOLVED MERGE.\n"
    )
    for f, found in hits:
        ln = found["<<<<<<< "][0]
        sys.stderr.write(
            f"  {f}:{ln}  <<<<<<< / ======= / >>>>>>>  "
            f"({len(found['<<<<<<< '])} conflict block(s))\n"
        )
    sys.stderr.write(
        "\nA conflict marker on a branch is not a merge in progress — it is a "
        "FILE THAT NO LONGER PARSES, landed. Resolve it. Do not commit over it.\n"
    )
    return 3


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
