#!/usr/bin/env python3
"""test_hunkhole.py — the certifying properties of the hunkhole gift.

Run:  python3 test_hunkhole.py    (exit 0 = all pass, 1 = a failure)

hunkhole's git-facing shell is exercised end-to-end in a throwaway repo; its
symbol-diff CORE (symbols / vanished_symbols / is_code / render) is pure and is
tested directly on fixtures. Each test is MUTATION-BITTEN: it is here because a
plausible mutation of hunkhole.py makes it fail loud. The core-diff test pins a
GOLDEN sorted vanished-set — a rename reading identically to a revert is the
exact property that must hold, and a golden proves the set, not just its size.
"""
import hashlib
import os
import subprocess
import sys
import tempfile

import hunkhole as h

_FAILURES: list[str] = []
_PASSES = 0


def check(cond: bool, msg: str) -> None:
    global _PASSES
    if cond:
        _PASSES += 1
    else:
        _FAILURES.append(msg)


# ---- fixtures: before/after source blobs -----------------------------------
BEFORE_JS = """\
function alpha() { return 1; }
const beta = () => 2;
gamma: function () { return 3; }
exports.delta = function () {};
function survivor() {
  let innerReverted = 9;     // a hunk inside a surviving body (not def-shaped)
  return innerReverted;
}
"""
AFTER_JS = """\
const beta = () => 2;
exports.delta = function () {};
function survivor() {
  return 0;                  // innerReverted hunk reverted, name survives
}
"""

BEFORE_PY = """\
def one(): pass
def two(): pass
def three(): pass
"""
AFTER_PY = """\
def one(): pass
def three(): pass
"""


# ---- 1. the core diff: vanished top-level names, pinned golden --------------
def test_vanished_golden():
    gone_js = h.vanished_symbols(BEFORE_JS, AFTER_JS)
    # alpha (function) and gamma (obj-method) vanished; beta/delta/survivor stayed.
    check(gone_js == ["alpha", "gamma"], f"JS vanished set wrong: {gone_js}")
    # the hunk INSIDE survivor() is invisible — survivor is not reported gone
    check("survivor" not in gone_js, "survivor should NOT be flagged (in-body hunk is invisible)")
    # pin a golden signature over a combined fixture run
    gone_py = h.vanished_symbols(BEFORE_PY, AFTER_PY)
    check(gone_py == ["two"], f"PY vanished set wrong: {gone_py}")
    sig = hashlib.sha256(("|".join(gone_js) + "#" + "|".join(gone_py)).encode()).hexdigest()
    golden = "72e9237f911294dc57a66b67e296fb888a0d43373cbb485118d4f73a4df09f8b"
    check(sig == golden, f"golden vanished-set signature drifted: got {sig[:16]}...")


# ---- 2. a rename reads the same as a revert (the honest-edge property) ------
def test_rename_reads_as_revert():
    before = "def compute(): pass\n"
    after = "def calculate(): pass\n"  # renamed
    gone = h.vanished_symbols(before, after)
    check(gone == ["compute"], f"rename should surface old name as gone: {gone}")
    # kills a mutation that tried to be 'smart' and suppress renames


# ---- 3. no false hole when nothing vanished --------------------------------
def test_no_false_hole():
    same = "def a(): pass\ndef b(): pass\n"
    check(h.vanished_symbols(same, same) == [], "identical source must yield no vanished names")
    # a purely ADDED symbol is not a hole
    added = "def a(): pass\ndef b(): pass\ndef c(): pass\n"
    check(h.vanished_symbols(same, added) == [], "an added symbol must not read as vanished")


# ---- 4. symbols() sees each definition form; kills a dropped alternative ----
def test_symbol_forms():
    src = "function f(){}\nconst g=1\nh: function(){}\nexports.i=1\ndef j(): pass\n"
    got = h.symbols(src)
    for name in ("f", "g", "h", "i", "j"):
        check(name in got, f"symbol form not detected: {name} (pattern lost an alternative)")


# ---- 5. is_code gate: symbols probed only on code suffixes -----------------
def test_is_code():
    for ok in ("x.js", "y.py", "z.sh", "a.mjs", "b.cjs"):
        check(h.is_code(ok), f"{ok} should be code")
    for no in ("data.json", "notes.md", "image.png", "LICENSE"):
        check(not h.is_code(no), f"{no} should NOT be treated as code")


# ---- 6. render marks a clean run as NOT a clean bill ------------------------
def test_render_clean_caveat():
    out = h.render("abc123def", "HEAD", None, files=["a.py"], holes=[], absent=[])
    check("NOT a clean bill" in out, "clean render must carry the not-a-clean-bill caveat")
    check("0 finding(s)" in out, "clean render must report 0 findings")


# ---- 7. render shows holes and absent files distinctly ---------------------
def test_render_findings():
    out = h.render(
        "abc123def", "HEAD", None,
        files=["a.py", "b.py"],
        holes=[("a.py", ["gone_one", "gone_two"])],
        absent=["b.py"],
    )
    check("HOLE          a.py" in out, "hole line missing")
    check("gone: gone_one()" in out, "vanished symbol not rendered")
    check("FILE ABSENT   b.py" in out, "absent-file line missing")
    check("2 finding(s)" in out, "finding count wrong (1 hole + 1 absent = 2)")
    check("QUESTION, not a verdict" in out, "the question-not-verdict disclaimer must render")


# ---- 8. END-TO-END against a real throwaway git repo -----------------------
def _run_git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True)


def test_end_to_end_reverted_hunk():
    with tempfile.TemporaryDirectory() as repo:
        _run_git(repo, "init", "-q")
        _run_git(repo, "config", "user.email", "t@t")
        _run_git(repo, "config", "user.name", "t")
        p = os.path.join(repo, "mod.py")
        with open(p, "w") as fh:
            fh.write("def keeper(): pass\ndef doomed(): pass\n")
        _run_git(repo, "add", "mod.py")
        _run_git(repo, "commit", "-qm", "before")
        before_sha = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True
        ).stdout.strip()
        # revert the 'doomed' definition, keep the file
        with open(p, "w") as fh:
            fh.write("def keeper(): pass\n")
        _run_git(repo, "commit", "-aqm", "after (doomed reverted)")

        cwd0 = os.getcwd()
        os.chdir(repo)
        try:
            files, holes, absent = h.scan(before_sha, "HEAD")
        finally:
            os.chdir(cwd0)
        check(holes == [("mod.py", ["doomed"])], f"end-to-end hole not found: {holes}")
        check(absent == [], f"nothing should be absent: {absent}")


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
