#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""test_dwell.py -- proves the router is pure, total, and free-hold.

The claims that ARE the tool:
  1. FREE-HOLD: adding a full lap (n ticks) to the reversal leaves the exit
     unchanged -- deferring is free. This is the whole idea; it gets the most tests.
  2. The exit is exactly (phase * k) // n, integer, in [0, k).
  3. replay(Mark) == the exit that produced it (an audit record, re-derived).
  4. Malformed calls REFUSE (raise DwellError), they don't silently guess.
Plus a mutation bite so a vacuously-green run fails loud. stdlib only.
Exit 0 = all pass, exit 1 = a failure (loud).
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dwell import phase, winding, exit_segment, Mark, replay, DwellError

_pass = 0
_fail = 0


def eq(name, got, want):
    global _pass, _fail
    if got == want:
        _pass += 1
    else:
        _fail += 1
        print(f"FAIL {name}\n  got:  {got!r}\n  want: {want!r}")


def ok(name, cond):
    global _pass, _fail
    if cond:
        _pass += 1
    else:
        _fail += 1
        print(f"FAIL {name}")


def raises(name, fn):
    global _pass, _fail
    try:
        fn()
        _fail += 1
        print(f"FAIL {name} -- expected DwellError, none raised")
    except DwellError:
        _pass += 1
    except Exception as e:  # noqa: BLE001
        _fail += 1
        print(f"FAIL {name} -- wrong exception {type(e).__name__}: {e}")


# --- 1. FREE-HOLD: an extra full lap never changes the exit ---------------------------------
n, k = 12, 4
for reverse in range(0, 12):
    base = exit_segment(0, reverse, n, k)
    eq(f"free-hold +1 lap @rev={reverse}", exit_segment(0, reverse + n, n, k), base)
    eq(f"free-hold +2 laps @rev={reverse}", exit_segment(0, reverse + 2 * n, n, k), base)
    eq(f"free-hold +7 laps @rev={reverse}", exit_segment(0, reverse + 7 * n, n, k), base)

# winding counts the laps that routing discards
eq("winding 0 laps", winding(0, 5, 12), 0)
eq("winding 1 lap", winding(0, 17, 12), 1)
eq("winding 7 laps", winding(0, 84, 12), 7)
eq("phase folds winding out", phase(0, 84, 12), phase(0, 0, 12))

# --- 2. the routing law is exactly (phase*k)//n, in range ----------------------------------
eq("phase 0 -> exit 0", exit_segment(0, 0, 12, 4), 0)
eq("phase 3 -> exit 1", exit_segment(0, 3, 12, 4), 1)   # (3*4)//12 = 1
eq("phase 5 -> exit 1", exit_segment(0, 5, 12, 4), 1)   # (5*4)//12 = 1
eq("phase 6 -> exit 2", exit_segment(0, 6, 12, 4), 2)   # (6*4)//12 = 2
eq("phase 11 -> exit 3", exit_segment(0, 11, 12, 4), 3)  # (11*4)//12 = 3
# boundary tie-break is floor by construction
eq("boundary floor phase 2->0", exit_segment(0, 2, 12, 4), 0)  # (2*4)//12 = 0

# entry offset only matters via the difference
eq("entry offset invariance", exit_segment(100, 105, 12, 4), exit_segment(0, 5, 12, 4))

# every exit stays in [0, k) across a whole lap
for reverse in range(0, n):
    e = exit_segment(0, reverse, n, k)
    ok(f"exit in range @rev={reverse}", 0 <= e < k)

# k == n: each tick is its own exit (bijective)
for reverse in range(0, 8):
    eq(f"k==n bijection @rev={reverse}", exit_segment(0, reverse, 8, 8), reverse)

# k == 1: everything routes to the single exit 0
for reverse in range(0, 12):
    eq(f"k==1 single exit @rev={reverse}", exit_segment(0, reverse, 12, 1), 0)

# --- 3. replay(Mark) == the exit that produced it -------------------------------------------
m = Mark(entry_tick=3, reverse_tick=20)
eq("replay == exit_segment", replay(m, 12, 4), exit_segment(3, 20, 12, 4))
# an audit record survives a re-derivation on any machine (pure)
eq("replay deterministic", replay(m, 12, 4), replay(m, 12, 4))

# --- 4. malformed calls REFUSE, never guess ------------------------------------------------
raises("n<1 refused", lambda: exit_segment(0, 0, 0, 1))
raises("k<1 refused", lambda: exit_segment(0, 0, 12, 0))
raises("k>n refused (the wall)", lambda: exit_segment(0, 0, 4, 5))
raises("reverse<entry refused", lambda: exit_segment(5, 3, 12, 4))
raises("bool is not int", lambda: exit_segment(0, True, 12, 4))
raises("float refused", lambda: phase(0, 5.0, 12))

# --- mutation bite: prove free-hold has teeth ----------------------------------------------
# If routing (wrongly) depended on winding, +1 lap WOULD change the exit for some reversal.
# Assert there EXISTS a reversal where phase differs from phase+lap yet exits still match --
# i.e. the invariant is non-vacuous (the exits are not all identical anyway).
distinct_exits = {exit_segment(0, r, n, k) for r in range(n)}
ok("mutation bite: exits are genuinely varied", len(distinct_exits) == k)
ok("mutation bite: +lap holds AND base varies",
   exit_segment(0, 3, n, k) == exit_segment(0, 3 + n, n, k)
   and exit_segment(0, 3, n, k) != exit_segment(0, 6, n, k))

print(("PASS" if _fail == 0 else "FAIL") + f" -- {_pass} passed, {_fail} failed")
sys.exit(0 if _fail == 0 else 1)
