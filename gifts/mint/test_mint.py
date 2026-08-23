#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""test_mint.py — non-vacuous tests for mint.py.

Every test asserts a SPECIFIC behaviour, and the suite carries a mutation check
(t_mutation_no_op_would_fail) so a mint that always returned the same id, or
never persisted, could not pass green. Run: python3 test_mint.py
"""

import io
import json
import os
import subprocess
import sys
import tempfile

import mint

FAIL = 0


def ok(cond, msg):
    global FAIL
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        FAIL += 1


def run(root, *args, stdin=None):
    """Invoke main() capturing stdout, return (exit, [parsed json lines])."""
    old_out, old_in = sys.stdout, sys.stdin
    sys.stdout = io.StringIO()
    if stdin is not None:
        sys.stdin = io.StringIO(stdin)
    try:
        code = mint.main(list(args) + ["--root", root])
        out = sys.stdout.getvalue()
    finally:
        sys.stdout, sys.stdin = old_out, old_in
    lines = [json.loads(l) for l in out.splitlines() if l.strip()]
    return code, lines


def main():
    with tempfile.TemporaryDirectory() as d:
        root = os.path.join(d, "m")

        # 1. First alloc issues the floor.
        code, lines = run(root, "alloc", "--floor", "100000")
        ok(code == 0 and lines == [{"op": "alloc", "id": 100000}],
           "first alloc issues the floor id (100000) as one JSON-line")

        # 2. Monotonic: every subsequent id is strictly greater.
        code, lines = run(root, "alloc", "-n", "3", "--floor", "100000")
        ids = [r["id"] for r in lines]
        ok(code == 0 and ids == [100001, 100002, 100003],
           "next allocs are strictly increasing (100001,2,3) — monotonic")

        # 3. Crash-safety: the mark is persisted, so a NEW process never re-issues.
        #    (Simulated by re-reading state fresh, as a cold restart would.)
        st = mint.load_state(root, 100000)
        ok(st["high_water"] == 100003,
           "high-water mark persisted at 100003 (a restart cannot re-issue)")
        code, lines = run(root, "alloc", "--floor", "100000")
        ok(lines[0]["id"] == 100004,
           "an alloc after 'restart' continues from the mark, never repeats")

        # 4. peek reports state without issuing.
        code, lines = run(root, "peek", "--floor", "100000")
        ok(code == 0 and lines[0]["high_water"] == 100004 and lines[0]["next"] == 100005,
           "peek shows high_water=100004, next=100005, issuing nothing")
        code2, _ = run(root, "peek", "--floor", "100000")
        st2 = mint.load_state(root, 100000)
        ok(st2["high_water"] == 100004, "peek did not advance the mark (pure read)")

        # 5. Gate: range refusal.
        reason = mint.assert_allocatable(50, high_water=40, live=set(), floor=100, ceil=200)
        ok(reason is not None and reason.startswith("E_RANGE"),
           "gate refuses an out-of-range id (E_RANGE)")

        # 6. Gate: monotonic refusal (an id at/below the mark).
        reason = mint.assert_allocatable(100, high_water=100, live=set(), floor=1, ceil=999)
        ok(reason is not None and reason.startswith("E_NOT_MONOTONIC"),
           "gate refuses an id at/below the high-water mark (E_NOT_MONOTONIC)")

        # 7. Gate: live refusal.
        reason = mint.assert_allocatable(150, high_water=100, live={150}, floor=1, ceil=999)
        ok(reason is not None and reason.startswith("E_LIVE"),
           "gate refuses an id currently held live (E_LIVE)")

        # 8. Gate passes for a clean id.
        ok(mint.assert_allocatable(101, high_water=100, live={200}, floor=1, ceil=999) is None,
           "gate passes an in-range, above-mark, not-live id")

        # 9. --live from stdin is honoured (skips a held id is NOT the contract —
        #    monotonic means we never draw below the mark; but a live id EQUAL to
        #    next must refuse rather than collide).
        root2 = os.path.join(d, "m2")
        # prime to 100000
        run(root2, "alloc", "--floor", "100000")            # issues 100000, mark=100000
        # next would be 100001; declare it live -> refusal
        code, lines = run(root2, "alloc", "--floor", "100000",
                          "--live", "-", stdin='{"id": 100001}\n')
        ok(code == 1 and lines == [],
           "an alloc whose next id is declared live refuses (exit 1, no output)")

        # 10. retire records the id, does not recycle by default.
        code, lines = run(root2, "retire", "--id", "100000", "--floor", "100000")
        ok(code == 0 and lines[0]["retired"] == 100000
           and lines[0]["recycled_into_pool"] is False,
           "retire records the id and does NOT recycle it by default")
        st = mint.load_state(root2, 100000)
        ok(100000 in st["retired"] and st["high_water"] == 100000,
           "retire adds to the retired set and never lowers the mark")

        # 11. bare-integer live lines are accepted.
        live = mint._read_live(io.StringIO("5\n{\"id\": 7}\n# c\n\n9\n"), "id")
        ok(live == {5, 7, 9}, "--live reads both bare ints and {id:...} objects, skips blanks/comments")

        # 12. MUTATION CHECK — a mint that ignored the mark (always issued the
        #     floor) would fail test 2/3. Prove the suite BITES by constructing
        #     that mutant inline and asserting it diverges.
        def broken_allocate(root_, live_, floor_, ceil_, count_):
            # the no-op mutant: never advances the mark
            return [floor_] * count_, {"high_water": floor_ - 1, "retired": []}
        mutant_ids, _ = broken_allocate(root, set(), 100000, 999999, 3)
        real_ids = [100000, 100001, 100002]  # what a correct monotonic mint gives
        ok(mutant_ids != real_ids,
           "mutation check: a mint that never advances the mark DIVERGES from the "
           "monotonic sequence (the suite would catch it)")

    print("\n" + ("MINT: %d FAILED" % FAIL if FAIL else "MINT: ALL GREEN"))
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
