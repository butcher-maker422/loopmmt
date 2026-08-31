#!/usr/bin/env python3
"""test_derived.py — mutation-bitten behavior proof for the derived gift.

stdlib only. Each test asserts a distinct BEHAVIOR, so deleting the behavior
from derived.py makes a test fail (that is the "mutation bite"). Run:

    python3 test_derived.py            # prints N/N and exits 0 on all-green
"""
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GIFT = os.path.join(HERE, "derived.py")

CURRENT, USAGE, STALE, BUILD_FAILED = 0, 2, 3, 4


def _scratch():
    d = tempfile.mkdtemp(prefix="derived-test.")
    return d


def _run(cwd, *args):
    """Run the gift with cwd set so repo-relative paths resolve there."""
    p = subprocess.run(
        [sys.executable, GIFT, *args],
        cwd=cwd, capture_output=True, text=True, timeout=120,
    )
    return p.returncode, p.stdout, p.stderr


# A build command that writes "1\n2\n3\n" to out.txt, deterministically.
GEN = 'python3 -c "open(\'out.txt\',\'w\').write(\'1\\n2\\n3\\n\')"'

results = []


def check(name, cond):
    results.append((name, bool(cond)))
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}")


def t_current_when_committed_matches_fresh_build():
    """A committed file equal to a fresh build reads CURRENT (exit 0)."""
    d = _scratch()
    try:
        with open(os.path.join(d, "out.txt"), "w") as f:
            f.write("1\n2\n3\n")  # matches GEN
        rc, out, _ = _run(d, "--build-cmd", GEN, "--derived", "out.txt")
        check("current when committed == fresh build", rc == CURRENT and "CURRENT" in out)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def t_stale_when_committed_differs():
    """A committed file that differs from the fresh build reads STALE (exit 3)."""
    d = _scratch()
    try:
        with open(os.path.join(d, "out.txt"), "w") as f:
            f.write("1\n2\n")  # stale: build emits three lines
        rc, out, _ = _run(d, "--build-cmd", GEN, "--derived", "out.txt")
        check("stale when committed != fresh build", rc == STALE and "STALE" in out)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def t_non_mutating_leaves_committed_file_untouched():
    """Running the check never edits the working tree's committed file."""
    d = _scratch()
    try:
        stale_content = "1\n2\n"
        with open(os.path.join(d, "out.txt"), "w") as f:
            f.write(stale_content)
        _run(d, "--build-cmd", GEN, "--derived", "out.txt")
        after = open(os.path.join(d, "out.txt")).read()
        check("non-mutating: committed file unchanged after a check", after == stale_content)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def t_build_failed_when_command_errors():
    """A build command that exits non-zero yields BUILD-FAILED (exit 4), never a verdict."""
    d = _scratch()
    try:
        with open(os.path.join(d, "out.txt"), "w") as f:
            f.write("anything\n")
        rc, out, _ = _run(d, "--build-cmd", "python3 -c \"import sys; sys.exit(1)\"",
                          "--derived", "out.txt")
        check("build-failed on non-zero build command", rc == BUILD_FAILED and "BUILD-FAILED" in out)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def t_usage_when_derived_missing():
    """A missing derived file is a usage error (exit 2), not STALE/CURRENT."""
    d = _scratch()
    try:
        rc, out, err = _run(d, "--build-cmd", GEN, "--derived", "nope.txt")
        check("usage error when derived file is absent", rc == USAGE and "USAGE" in (out + err))
    finally:
        shutil.rmtree(d, ignore_errors=True)


def t_stdout_mode_compares_captured_output():
    """--stdout compares the build's stdout, not a file on disk."""
    d = _scratch()
    try:
        with open(os.path.join(d, "cur.txt"), "w") as f:
            f.write("hello\n")
        rc, out, _ = _run(d, "--build-cmd", 'python3 -c "print(\'hello\')"',
                          "--derived", "cur.txt", "--stdout")
        check("--stdout compares captured stdout", rc == CURRENT and "CURRENT" in out)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def t_stdout_mode_detects_stale():
    """--stdout still detects a mismatch as STALE."""
    d = _scratch()
    try:
        with open(os.path.join(d, "cur.txt"), "w") as f:
            f.write("goodbye\n")
        rc, out, _ = _run(d, "--build-cmd", 'python3 -c "print(\'hello\')"',
                          "--derived", "cur.txt", "--stdout")
        check("--stdout detects stale", rc == STALE and "STALE" in out)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def t_deterministic_same_verdict_across_runs():
    """The same inputs yield the same verdict every run (byte-oracle determinism)."""
    d = _scratch()
    try:
        with open(os.path.join(d, "out.txt"), "w") as f:
            f.write("1\n2\n3\n")
        verdicts = set()
        for _ in range(3):
            rc, _, _ = _run(d, "--build-cmd", GEN, "--derived", "out.txt")
            verdicts.add(rc)
        check("deterministic: identical verdict across 3 runs", verdicts == {CURRENT})
    finally:
        shutil.rmtree(d, ignore_errors=True)


def t_json_mode_emits_status():
    """--json emits a parseable object carrying the status."""
    d = _scratch()
    try:
        import json as _json
        with open(os.path.join(d, "out.txt"), "w") as f:
            f.write("1\n2\n3\n")
        rc, out, _ = _run(d, "--build-cmd", GEN, "--derived", "out.txt", "--json")
        obj = _json.loads(out)
        check("--json emits status object", obj.get("status") == "current")
    finally:
        shutil.rmtree(d, ignore_errors=True)


def t_edge_is_present_and_printed():
    """The printed edge exists in the artifact and prints on demand."""
    d = _scratch()
    src = open(GIFT).read()
    rc, out, _ = _run(d, "--edge", "--build-cmd", "x", "--derived", "y")
    check("printed edge present in source AND on --edge",
          "STALENESS" in src and "not CORRECTNESS" in src and "STALENESS" in out)


def t_diff_summary_names_the_difference():
    """On STALE, the output names WHERE/HOW it differs (not just 'differ')."""
    d = _scratch()
    try:
        with open(os.path.join(d, "out.txt"), "w") as f:
            f.write("1\n2\n")  # shorter than fresh
        rc, out, _ = _run(d, "--build-cmd", GEN, "--derived", "out.txt")
        check("stale output names the difference (length/offset)",
              rc == STALE and ("length differs" in out or "offset" in out))
    finally:
        shutil.rmtree(d, ignore_errors=True)


def main():
    print("test_derived.py")
    for fn in [
        t_current_when_committed_matches_fresh_build,
        t_stale_when_committed_differs,
        t_non_mutating_leaves_committed_file_untouched,
        t_build_failed_when_command_errors,
        t_usage_when_derived_missing,
        t_stdout_mode_compares_captured_output,
        t_stdout_mode_detects_stale,
        t_deterministic_same_verdict_across_runs,
        t_json_mode_emits_status,
        t_edge_is_present_and_printed,
        t_diff_summary_names_the_difference,
    ]:
        fn()
    passed = sum(1 for _, ok in results if ok)
    total = len(results)
    print(f"\n{passed}/{total} passing")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
