#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""test_the-oracle.py -- independent mutation-bitten oracle for the-oracle gift.

Invokes the tool as a SUBPROCESS (never imports it), so each check bites a load-bearing
behavior: deleting the behavior from the tool makes a check fail. The reference picks are
recomputed here from first principles ((moment-seed) mod k for the default n=k), so this
file is an independent oracle, not an echo of the implementation.
"""
import json
import subprocess
import sys
import os
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(HERE, "the-oracle.py")

_checks = []


def ck(name, cond):
    _checks.append((name, bool(cond)))


def run(args, expect_exit=0):
    r = subprocess.run([sys.executable, TOOL] + args, capture_output=True, text=True)
    if r.returncode != expect_exit:
        return None, r
    return r.stdout.strip(), r


def ref_pick(variants, seed, moment):
    """Independent reference: default resolution n=k, pick = (moment-seed) mod k."""
    k = len(variants)
    return variants[((moment - seed) % k * k) // k]


# 1. pick prints the chosen variant, matching the independent reference
for seed, moment, variants in [(7, 19, ["A", "B", "C"]), (0, 5, ["x", "y"]), (3, 3, ["only-a", "b", "c", "d"])]:
    out, r = run(["pick", "--seed", str(seed), "--moment", str(moment),
                  "--variants", ",".join(variants)])
    ck(f"pick {seed},{moment},{variants}", out == ref_pick(variants, seed, moment))

# 2. free-hold: adding a full lap (k) to the moment yields the same pick
out_a, _ = run(["pick", "--seed", "1", "--moment", "4", "--variants", "A,B,C"])
out_b, _ = run(["pick", "--seed", "1", "--moment", "7", "--variants", "A,B,C"])  # 7 = 4 + k(3)
ck("free-hold (lap invariant)", out_a is not None and out_a == out_b)

# 3. determinism: same call twice -> identical output
o1, _ = run(["pick", "--seed", "9", "--moment", "31", "--variants", "P,Q,R,S"])
o2, _ = run(["pick", "--seed", "9", "--moment", "31", "--variants", "P,Q,R,S"])
ck("determinism", o1 is not None and o1 == o2)

# 4. cast emits a valid JSON receipt on stdout, and it round-trips through replay
out, r = run(["cast", "--seed", "7", "--moment", "20", "--variants", "A,B,C", "--trace", "T1"])
receipt = None
try:
    receipt = json.loads(out)
except Exception:
    receipt = None
ck("cast emits json receipt", receipt is not None and receipt.get("pick") == ref_pick(["A", "B", "C"], 7, 20))
ck("cast stamps trace", receipt is not None and receipt.get("trace") == "T1")

# 5. cast receipt is byte-identical across runs (deterministic serialization)
c1, _ = run(["cast", "--seed", "2", "--moment", "6", "--variants", "A,B"])
c2, _ = run(["cast", "--seed", "2", "--moment", "6", "--variants", "A,B"])
ck("cast byte-identical", c1 is not None and c1 == c2)

# 6. replay re-derives the recorded pick from a ballot file alone
if receipt is not None:
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump(receipt, fh)
        ballot_path = fh.name
    out, r = run(["replay", "--ballot", ballot_path])
    ck("replay reproduces cast", out == receipt["pick"])
    os.unlink(ballot_path)
else:
    ck("replay reproduces cast", False)

# 7. ledger receives an appended receipt line when --ledger is given
with tempfile.TemporaryDirectory() as td:
    ledger = os.path.join(td, "led.jsonl")
    run(["cast", "--seed", "1", "--moment", "5", "--variants", "A,B", "--trace", "L1", "--ledger", ledger])
    run(["cast", "--seed", "1", "--moment", "6", "--variants", "A,B", "--trace", "L2", "--ledger", ledger])
    lines = [l for l in open(ledger).read().splitlines() if l.strip()]
    ck("ledger appends per cast", len(lines) == 2)
    ck("ledger lines are json", all(json.loads(l).get("trace") in ("L1", "L2") for l in lines))

# 8. moment < seed is refused with exit 2 (the monotone-clock guard)
out, r = run(["pick", "--seed", "10", "--moment", "3", "--variants", "A,B"], expect_exit=2)
ck("moment<seed refused (exit 2)", r.returncode == 2 and "moment" in r.stderr)

# 9. distinct-variant guard: duplicate labels refused
out, r = run(["pick", "--seed", "0", "--moment", "0", "--variants", "A,A"], expect_exit=2)
ck("duplicate variants refused", r.returncode == 2)

# 10. --selftest runs and reports GREEN
out, r = run(["--selftest"])
ck("selftest green", r.returncode == 0 and "GREEN" in r.stdout)

# 11. empty variants refused
out, r = run(["pick", "--seed", "0", "--moment", "0", "--variants", ",,"], expect_exit=2)
ck("empty variants refused", r.returncode == 2)

# 12. pick is always in the variant set (property over a range)
allin = True
for m in range(5, 25):
    o, _ = run(["pick", "--seed", "5", "--moment", str(m), "--variants", "A,B,C,D"])
    if o not in ("A", "B", "C", "D"):
        allin = False
        break
ck("pick always in set", allin)

passed = sum(1 for _, ok in _checks if ok)
failed = len(_checks) - passed
for name, ok in _checks:
    if not ok:
        print(f"  FAIL: {name}")
tag = "GREEN" if failed == 0 else "RED"
print(f"{tag}: {passed} assertions passed, {failed} failed  [test_the-oracle]")
sys.exit(0 if failed == 0 else 1)
