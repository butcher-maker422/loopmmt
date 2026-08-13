#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""smoke_test.py — hermetic proof that plumb.py holds the line. No network, no
state outside a tmpdir. Each scenario writes a board + evidence, runs plumb.py as
a subprocess, and checks the exit code and the verdict text — the real CLI
contract, mirroring the durability claims:

  1  a satisfied witness renders HELD and the run is clean (exit 0)
  2  a claim asserting PASS with a MISSING witness is caught BROKEN (exit 1)  <- the headline
  3  a claim asserting PASS with NO witness is UNWITNESSED (exit 1)
  4  contains: HELD when the text is present, BROKEN when absent
  5  absent: HELD when the path is gone, BROKEN when it is present
  6  cmd: exit 0 -> HELD, non-zero -> BROKEN
  7  a malformed witness is BLOCKED, not silently passed (exit 2)
  8  a todo claim never renders green: unsatisfied -> TODO, satisfied -> READY,
     and neither fails the run (exit 0)

Run:  python3 smoke_test.py    (expect: 8/8 passed)
"""
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PLUMB = os.path.join(HERE, "plumb.py")
PASS = 0
FAIL = 0


def ok(msg):
    global PASS
    PASS += 1
    print(f"ok  {msg}")


def bad(msg, why):
    global FAIL
    FAIL += 1
    print(f"FAIL {msg}: {why}")


def run_plumb(board_text, cwd):
    """Write board.plumb into cwd, run plumb.py against it, return (rc, stdout)."""
    board = os.path.join(cwd, "board.plumb")
    with open(board, "w", encoding="utf-8") as f:
        f.write(board_text)
    p = subprocess.run([sys.executable, PLUMB, board],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return p.returncode, p.stdout


def write(cwd, name, text=""):
    with open(os.path.join(cwd, name), "w", encoding="utf-8") as f:
        f.write(text)


def t1(d):
    write(d, "artifact.txt", "built")
    rc, out = run_plumb("build shipped | exists artifact.txt\n", d)
    if rc == 0 and "HELD" in out:
        ok("satisfied witness renders HELD, run is clean")
    else:
        bad("held", f"rc={rc} out=[{out.strip()}]")


def t2(d):
    # assert PASS but the witness file does not exist -> green on hope, caught
    rc, out = run_plumb("build shipped | exists nope.txt\n", d)
    if rc == 1 and "BROKEN" in out:
        ok("asserted PASS with a missing witness is caught BROKEN (exit 1)")
    else:
        bad("green-on-hope", f"expected rc=1 + BROKEN, got rc={rc} out=[{out.strip()}]")


def t3(d):
    rc, out = run_plumb("migration done | none\n", d)
    if rc == 1 and "UNWITNESSED" in out:
        ok("asserted PASS with no witness is UNWITNESSED (exit 1)")
    else:
        bad("unwitnessed", f"expected rc=1 + UNWITNESSED, got rc={rc} out=[{out.strip()}]")


def t4(d):
    write(d, "README.md", "# thing\n\nMIT licensed.\n")
    rc, out = run_plumb("readme licensed | contains README.md ~ MIT\n", d)
    if not (rc == 0 and "HELD" in out):
        bad("contains-present", f"rc={rc} out=[{out.strip()}]")
        return
    rc2, out2 = run_plumb("readme gpl | contains README.md ~ GPL\n", d)
    if rc2 == 1 and "BROKEN" in out2:
        ok("contains: HELD when text present, BROKEN when absent")
    else:
        bad("contains-absent", f"rc={rc2} out=[{out2.strip()}]")


def t5(d):
    rc, out = run_plumb("no secret | absent .env\n", d)
    if not (rc == 0 and "HELD" in out):
        bad("absent-gone", f"rc={rc} out=[{out.strip()}]")
        return
    write(d, ".env", "SECRET=x")
    rc2, out2 = run_plumb("no secret | absent .env\n", d)
    if rc2 == 1 and "BROKEN" in out2:
        ok("absent: HELD when path gone, BROKEN when present")
    else:
        bad("absent-present", f"rc={rc2} out=[{out2.strip()}]")


def t6(d):
    rc, out = run_plumb("truthy | cmd true\n", d)
    if not (rc == 0 and "HELD" in out):
        bad("cmd-zero", f"rc={rc} out=[{out.strip()}]")
        return
    rc2, out2 = run_plumb("falsy | cmd false\n", d)
    if rc2 == 1 and "BROKEN" in out2:
        ok("cmd: exit 0 -> HELD, non-zero -> BROKEN")
    else:
        bad("cmd-nonzero", f"rc={rc2} out=[{out2.strip()}]")


def t7(d):
    # 'contains' with no ' ~ ' separator is malformed -> BLOCKED, not a silent pass
    rc, out = run_plumb("bad witness | contains README.md MIT\n", d)
    if rc == 2 and "BLOCKED" in out:
        ok("a malformed witness is BLOCKED, not silently passed (exit 2)")
    else:
        bad("blocked", f"expected rc=2 + BLOCKED, got rc={rc} out=[{out.strip()}]")


def t8(d):
    # todo claims never go green, and never fail the run
    board = (
        "later feature | todo | exists notyet.txt\n"      # unsatisfied -> TODO
        "already built | todo | cmd true\n"               # satisfied  -> READY
    )
    rc, out = run_plumb(board, d)
    if rc == 0 and "TODO" in out and "READY" in out and "HELD" not in out:
        ok("todo never renders green: TODO / READY, run stays clean (exit 0)")
    else:
        bad("todo", f"expected rc=0, TODO+READY, no HELD; rc={rc} out=[{out.strip()}]")


def main():
    for t in (t1, t2, t3, t4, t5, t6, t7, t8):
        with tempfile.TemporaryDirectory() as d:
            t(d)
    print()
    print(f"{PASS}/{PASS + FAIL} passed")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
