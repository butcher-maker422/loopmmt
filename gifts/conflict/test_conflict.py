#!/usr/bin/env python3
"""test_conflict.py — the certifying properties of the conflict gift.

Run:  python3 test_conflict.py    (exit 0 = all pass, 1 = a failure)

The load-bearing property is the TRIAD RULE: a lone `=======` (a legal line) must
NOT fire, while the full marker triad must. Each test is MUTATION-BITTEN — it is
here because a plausible mutation of conflict.py makes it fail loud. The core is
pure (marker_lines / has_conflict / is_ignored), so it's tested directly; the
git-facing shell is exercised in a throwaway repo.
"""
import os
import subprocess
import sys

import conflict as c

_FAILURES: list[str] = []
_PASSES = 0


def check(cond: bool, msg: str) -> None:
    global _PASSES
    if cond:
        _PASSES += 1
    else:
        _FAILURES.append(msg)


CONFLICTED = """\
line before
<<<<<<< HEAD
ours
=======
theirs
>>>>>>> origin/main
line after
"""

# a lone `=======` in legal, innocent company — MUST NOT fire
INNOCENT_RULE = """\
Section One
=======
Section Two

Some prose under a Markdown setext rule.
"""

INNOCENT_BANNER = """\
# ============================================================
# a decorative comment banner, not a conflict
# ============================================================
def f(): pass
"""


# --- 1. the triad fires; a lone middle does not (the core property) ----------
def test_triad_rule():
    check(c.has_conflict(CONFLICTED), "the full marker triad must be detected")
    check(not c.has_conflict(INNOCENT_RULE), "a lone ======= (Markdown rule) must NOT fire")
    check(not c.has_conflict(INNOCENT_BANNER), "a ==== banner must NOT fire")
    # a triad that is missing one leg must NOT fire
    missing_close = CONFLICTED.replace(">>>>>>> origin/main\n", "")
    check(not c.has_conflict(missing_close), "two-of-three markers must NOT fire (needs the triad)")


# --- 2. golden: marker_lines reports the exact line numbers ------------------
def test_marker_lines_golden():
    found = c.marker_lines(CONFLICTED)
    check(found["<<<<<<< "] == [2], f"open marker line wrong: {found['<<<<<<< ']}")
    check(found["======="] == [4], f"middle marker line wrong: {found['=======']}")
    check(found[">>>>>>> "] == [6], f"close marker line wrong: {found['>>>>>>> ']}")
    # the three exact line-number asserts above ARE the golden: they pin the
    # detected positions, not merely the count.


# --- 3. only a line that STARTS with a marker counts ------------------------
def test_startswith_only():
    # a single marker mid-line (e.g. inside a string) is not a line-start conflict
    embedded = 'x = "<<<<<<< not a real marker"\n'
    check(not c.has_conflict(embedded), "a marker mid-line must not count as a conflict")
    # the discriminating case: ALL THREE markers mid-line. Under startswith this
    # is clean (no line STARTS with a marker); a naive `m in ln` would flag it.
    triad_midline = "a <<<<<<< b\nc ======= d\ne >>>>>>> f\n"
    check(
        not c.has_conflict(triad_midline),
        "three markers mid-line must NOT fire (startswith, not substring)",
    )


# --- 4. is_ignored honors substrings ----------------------------------------
def test_is_ignored():
    check(c.is_ignored("a/_snapshots/x.txt", ("_snapshots/",)), "ignore substring should match")
    check(not c.is_ignored("a/src/x.txt", ("_snapshots/",)), "non-matching path must not be ignored")
    check(not c.is_ignored("anything", ()), "empty ignore never ignores")


# --- 5. arg parse: --ref, --ignore (repeatable), unknown ---------------------
def test_parse_args():
    ref, ig = c._parse_args(["--ref", "main", "--ignore", "a/", "--ignore", "b/"])
    check(ref == "main", f"--ref not parsed: {ref}")
    check(ig == ("a/", "b/"), f"--ignore not repeatable: {ig}")
    raised = False
    try:
        c._parse_args(["--bogus"])
    except ValueError:
        raised = True
    check(raised, "unknown arg must raise")


# --- 6. END-TO-END against a throwaway repo ---------------------------------
def _run_git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True)


def test_end_to_end():
    import tempfile
    with tempfile.TemporaryDirectory() as repo:
        _run_git(repo, "init", "-q")
        _run_git(repo, "config", "user.email", "t@t")
        _run_git(repo, "config", "user.name", "t")
        # one clean file, one conflicted file
        with open(os.path.join(repo, "clean.py"), "w") as fh:
            fh.write("def ok(): pass\n")
        with open(os.path.join(repo, "broken.py"), "w") as fh:
            fh.write(CONFLICTED)
        _run_git(repo, "add", "-A")
        _run_git(repo, "commit", "-qm", "with a conflict")

        cwd0 = os.getcwd()
        os.chdir(repo)
        try:
            hits = c.scan(ref=None)
        finally:
            os.chdir(cwd0)
        paths = sorted(f for f, _ in hits)
        check(paths == ["broken.py"], f"end-to-end should flag only broken.py: {paths}")


# --- 7. ignore actually excludes a conflicted file --------------------------
def test_end_to_end_ignore():
    import tempfile
    with tempfile.TemporaryDirectory() as repo:
        _run_git(repo, "init", "-q")
        _run_git(repo, "config", "user.email", "t@t")
        _run_git(repo, "config", "user.name", "t")
        os.makedirs(os.path.join(repo, "_snapshots"))
        with open(os.path.join(repo, "_snapshots", "past.txt"), "w") as fh:
            fh.write(CONFLICTED)  # a deliberate record of a past conflict
        _run_git(repo, "add", "-A")
        _run_git(repo, "commit", "-qm", "snapshot")
        cwd0 = os.getcwd()
        os.chdir(repo)
        try:
            with_ignore = c.scan(ref=None, ignore=("_snapshots/",))
            without = c.scan(ref=None)
        finally:
            os.chdir(cwd0)
        check(with_ignore == [], f"ignored path should not be flagged: {with_ignore}")
        check(len(without) == 1, f"without ignore the file should flag: {without}")


def run() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        try:
            t()
        except Exception as exc:
            _FAILURES.append(f"{t.__name__} raised: {exc!r}")
    total = _PASSES + len(_FAILURES)
    if _FAILURES:
        print(f"FAIL — {len(_FAILURES)} of {total} checks failed:")
        for f in _FAILURES:
            print(f"  ✗ {f}")
        return 1
    print(f"OK — {_PASSES}/{total} checks passed ({len(tests)} tests).")
    return 0


if __name__ == "__main__":
    sys.exit(run())
