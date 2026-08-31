#!/usr/bin/env python3
"""test_gauntlet.py — mutation-bitten behavior proof for the gauntlet gift.

stdlib only. Each test asserts a distinct BEHAVIOR so deleting the behavior
makes a test fail. Run:  python3 test_gauntlet.py
"""
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GIFT = os.path.join(HERE, "gauntlet.py")

HELD, USAGE, ESCAPED, NO_FAULT = 0, 2, 3, 4

# A check that PASSES (exit 0) only if the file is exactly the 200-byte original.
# Deterministic, stdlib-only, written per-test into the sandbox.
STRICT_CHECK = (
    "python3 -c \"import sys; d=open(sys.argv[1],'rb').read(); "
    "sys.exit(0 if len(d)==200 and d==b'A'*200 else 1)\" {}"
)
# A weak check that ALWAYS passes — used to prove ESCAPED detection.
WEAK_CHECK = "python3 -c \"import sys; sys.exit(0)\" {}"

results = []


def check(name, cond):
    results.append((name, bool(cond)))
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}")


def _scratch_target(content=b"A" * 200):
    d = tempfile.mkdtemp(prefix="gauntlet-test.")
    p = os.path.join(d, "data.bin")
    with open(p, "wb") as f:
        f.write(content)
    return d, p


def _run(*args):
    p = subprocess.run([sys.executable, GIFT, *args],
                       capture_output=True, text=True, timeout=120)
    return p.returncode, p.stdout, p.stderr


def t_held_when_strict_check_catches_truncation():
    """A strict check that rejects a truncated file => HELD (exit 0)."""
    d, p = _scratch_target()
    try:
        rc, out, _ = _run("--target", p, "--fault", "truncate", "--check", STRICT_CHECK)
        check("HELD when strict check catches truncation", rc == HELD and "HELD" in out)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def t_escaped_when_weak_check_misses():
    """A check that always passes => ESCAPED (exit 3): the hole is detected."""
    d, p = _scratch_target()
    try:
        rc, out, _ = _run("--target", p, "--fault", "truncate", "--check", WEAK_CHECK)
        check("ESCAPED when weak check misses the fault", rc == ESCAPED and "ESCAPED" in out)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def t_original_never_modified():
    """The original target file is byte-identical after a run (sandbox only)."""
    d, p = _scratch_target()
    try:
        before = open(p, "rb").read()
        _run("--target", p, "--fault", "bitflip", "--check", WEAK_CHECK)
        after = open(p, "rb").read()
        check("original file untouched after a run", before == after)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def t_bitflip_held_by_strict_check():
    """A single-byte flip is caught by the strict check => HELD."""
    d, p = _scratch_target()
    try:
        rc, out, _ = _run("--target", p, "--fault", "bitflip", "--check", STRICT_CHECK)
        check("HELD on bitflip caught by strict check", rc == HELD and "byte flipped" in out)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def t_replace_regression_held():
    """A find/replace regression the check rejects => HELD; note names the swap."""
    d = tempfile.mkdtemp(prefix="gauntlet-test.")
    p = os.path.join(d, "cfg.txt")
    open(p, "w").write("version: 3\n")
    # check passes only if it still says 'version: 3'
    chk = "python3 -c \"import sys; sys.exit(0 if 'version: 3' in open(sys.argv[1]).read() else 1)\" {}"
    try:
        rc, out, _ = _run("--target", p, "--fault", "replace",
                          "--from", "version: 3", "--to", "version: 2", "--check", chk)
        check("HELD on replace regression + note names swap",
              rc == HELD and "version: 3" in out and "version: 2" in out)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def t_no_fault_when_replace_string_absent():
    """--replace with a --from that isn't present => NO-FAULT (exit 4), not a verdict."""
    d = tempfile.mkdtemp(prefix="gauntlet-test.")
    p = os.path.join(d, "cfg.txt")
    open(p, "w").write("hello\n")
    try:
        rc, out, _ = _run("--target", p, "--fault", "replace",
                          "--from", "not-here", "--to", "x", "--check", WEAK_CHECK)
        check("NO-FAULT when --from absent", rc == NO_FAULT and "NO-FAULT" in out)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def t_usage_when_target_missing():
    """A missing target file is a usage error (exit 2)."""
    rc, out, err = _run("--target", "/no/such/file", "--fault", "truncate", "--check", WEAK_CHECK)
    check("USAGE when target file missing", rc == USAGE and "USAGE" in (out + err))


def t_usage_when_required_arg_missing():
    """Missing --check is a usage error, not a crash."""
    d, p = _scratch_target()
    try:
        rc, out, err = _run("--target", p, "--fault", "truncate")
        check("USAGE when --check missing", rc == USAGE and "USAGE" in (out + err))
    finally:
        shutil.rmtree(d, ignore_errors=True)


def t_verdict_inversion_is_correct():
    """The inversion holds: check-fails => HELD, check-passes => ESCAPED, same fault."""
    d, p = _scratch_target()
    try:
        rc_strict, _, _ = _run("--target", p, "--fault", "truncate", "--check", STRICT_CHECK)
        rc_weak, _, _ = _run("--target", p, "--fault", "truncate", "--check", WEAK_CHECK)
        check("inversion: strict->HELD(0), weak->ESCAPED(3)",
              rc_strict == HELD and rc_weak == ESCAPED)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def t_deterministic_verdict():
    """Same target+fault+check => same verdict every run."""
    d, p = _scratch_target()
    try:
        verdicts = set()
        for _ in range(3):
            rc, _, _ = _run("--target", p, "--fault", "bitflip", "--check", STRICT_CHECK)
            verdicts.add(rc)
        check("deterministic: identical verdict across 3 runs", verdicts == {HELD})
    finally:
        shutil.rmtree(d, ignore_errors=True)


def t_json_mode_emits_status():
    """--json emits a parseable object with the status and check_exit."""
    import json as _json
    d, p = _scratch_target()
    try:
        rc, out, _ = _run("--target", p, "--fault", "truncate", "--check", STRICT_CHECK, "--json")
        obj = _json.loads(out)
        check("--json emits status + check_exit",
              obj.get("status") == "held" and obj.get("check_exit") is not None)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def t_edge_present_and_printed():
    """The printed edge is in the artifact and prints on --edge."""
    src = open(GIFT).read()
    rc, out, _ = _run("--edge")
    check("edge present in source AND on --edge",
          "never modifies your original" in src and "never modifies your original" in out)


def main():
    print("test_gauntlet.py")
    for fn in [
        t_held_when_strict_check_catches_truncation,
        t_escaped_when_weak_check_misses,
        t_original_never_modified,
        t_bitflip_held_by_strict_check,
        t_replace_regression_held,
        t_no_fault_when_replace_string_absent,
        t_usage_when_target_missing,
        t_usage_when_required_arg_missing,
        t_verdict_inversion_is_correct,
        t_deterministic_verdict,
        t_json_mode_emits_status,
        t_edge_present_and_printed,
    ]:
        fn()
    passed = sum(1 for _, ok in results if ok)
    total = len(results)
    print(f"\n{passed}/{total} passing")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
