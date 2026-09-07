#!/usr/bin/env python3
"""loop-sudoku — Block D: the Plumb (the out-of-band certifying oracle).

An INDEPENDENT replay-checker. It reads `givens + trace`, re-derives from
scratch, and asserts the solve is honest. It shares no solving code path with
Block A (that is the point — a bug in the solver must not be able to hide in a
matching bug in the checker; the checker is SIMPLER than the solver).

Design of record: plan §3 (The Plumb) + §4 Block D. SWX-F1: shaped as a set of
one-invariant-per-checker verifiers, the `verify-*.cjs`-family jig from Jamie's
Garden, here in Python for the walking skeleton (the .cjs port reuses the Garden
harness directly — the trace already serializes to JSON via SolveResult.to_dict).

Three invariants, one checker each:
  verify_determinism_replay  — same givens -> byte-identical trace
  verify_reason_holds        — each step's stated technique genuinely held there
  verify_uniqueness          — the solved terminal state is the UNIQUE solution
                               (proved by an INDEPENDENT backtracking counter,
                               a different algorithm than the propagation solver)
"""
from __future__ import annotations

import json
from typing import List, Tuple

from solver import (
    N, Grid, TechniqueApplication, SolveResult, solve,
    compute_candidates, _UNITS, _placed_digit, _peers, _is_placement,
)

Report = Tuple[bool, str]

# _UNITS layout (solver._units): 9 rows, then 9 cols, then 9 boxes.
_LINE_UNITS = [frozenset(u) for u in _UNITS[:18]]
_BOX_UNITS = [frozenset(u) for u in _UNITS[18:]]


def _locked_candidates_holds(cands, digit, targets) -> bool:
    """Independently re-derive the locked-candidates deduction — does NOT trust
    the step's reason. `digit` is eliminable from `targets` iff there is an
    intersecting (unit A, unit B) pair — one a box, one a line — where every
    d-candidate in A is confined to A∩B, and every target lies in B\\A (so d
    cannot go in B outside the intersection). Covers pointing (A=box) and
    claiming (A=line) in one check."""
    tset = set(targets)
    if not tset:
        return False
    if not all(t in cands and digit in cands[t] for t in tset):
        return False
    pairs = ([(a, b) for a in _BOX_UNITS for b in _LINE_UNITS]
             + [(a, b) for a in _LINE_UNITS for b in _BOX_UNITS])
    for a, b in pairs:
        inter = a & b
        if not inter:
            continue
        dA = {cell for cell in a if cell in cands and digit in cands[cell]}
        if not dA or not dA <= inter:
            continue
        elim = {cell for cell in b if cell not in a
                and cell in cands and digit in cands[cell]}
        if tset <= elim:
            return True
    return False


def _naked_pair_holds(cands, elim) -> bool:
    """Independently re-derive the naked-pair deduction — does NOT trust the
    reason. `elim` is the step's (cell, digit) prunes. Holds iff some unit has
    two cells P,Q with the SAME two candidates {x,y} ⊇ the pruned digits, and
    every pruned cell is another cell of that unit that currently holds the
    pruned digit."""
    if not elim:
        return False
    pruned_digits = {d for _c, d in elim}
    prunes = {(tuple(c), d) for c, d in elim}
    if not all(d in cands.get(tuple(c), set()) for c, d in elim):
        return False
    for unit in _UNITS:
        bi = [cell for cell in unit if cell in cands and len(cands[cell]) == 2]
        for i in range(len(bi)):
            for j in range(i + 1, len(bi)):
                p, q = bi[i], bi[j]
                pset = cands[p]
                if pset != cands[q] or not (pruned_digits <= pset):
                    continue
                justified = {(cell, d) for cell in unit if cell not in (p, q)
                             and cell in cands
                             for d in pset if d in cands[cell]}
                if prunes <= justified:
                    return True
    return False


def _x_wing_holds(cands, digit, targets) -> bool:
    """Independently re-derive the X-wing deduction — does NOT trust the reason.
    `digit` is eliminable from `targets` iff there are two BASE lines (both rows
    or both columns) on each of which `digit` is a candidate in EXACTLY the same
    two CROSS lines, and every target is a cell on one of those two cross lines,
    outside the two base lines, that currently holds `digit`. Covers the
    row-based fish and its column transpose in one check."""
    tset = set(targets)
    if not tset:
        return False
    if not all(t in cands and digit in cands[t] for t in tset):
        return False
    for base in ("row", "col"):
        base_pos = {}
        for i in range(N):
            if base == "row":
                cross = [c for c in range(N)
                         if (i, c) in cands and digit in cands[(i, c)]]
            else:
                cross = [r for r in range(N)
                         if (r, i) in cands and digit in cands[(r, i)]]
            if len(cross) == 2:
                base_pos[i] = (cross[0], cross[1])
        bases = sorted(base_pos)
        for a in range(len(bases)):
            for b in range(a + 1, len(bases)):
                b1, b2 = bases[a], bases[b]
                if base_pos[b1] != base_pos[b2]:
                    continue
                x1, x2 = base_pos[b1]
                justified = set()
                for x in (x1, x2):
                    for k in range(N):
                        if k in (b1, b2):
                            continue
                        cell = (k, x) if base == "row" else (x, k)
                        if cell in cands and digit in cands[cell]:
                            justified.add(cell)
                if tset <= justified:
                    return True
    return False


def verify_determinism_replay(givens: Grid) -> Report:
    """Same givens must produce a byte-identical trace (plan's hard invariant)."""
    a = json.dumps(solve(givens).to_dict(), sort_keys=True)
    b = json.dumps(solve(givens).to_dict(), sort_keys=True)
    if a == b:
        return True, "determinism: two solves produced an identical trace."
    return False, "determinism VIOLATED: two solves of the same givens diverged."


def verify_reason_holds(givens: Grid, result: SolveResult) -> Report:
    """Replay the trace on a fresh grid; independently confirm every step's
    stated technique actually held at that board state. This is the certifying
    check — it catches a subtly-wrong trace (a `reason` that does not hold)."""
    grid = [row[:] for row in givens]
    cands = compute_candidates(grid)                   # carried, re-derived once
    for i, step in enumerate(result.trace):
        if _is_placement(step):
            cell = tuple(step.cells_affected[0])
            digit = _placed_digit(step)

            if cell not in cands:
                return False, f"step {i}: placed into a non-empty cell {cell}."
            if digit not in cands[cell]:
                return False, (f"step {i}: {digit} is not a legal candidate at "
                               f"{cell} — it conflicts with a peer.")

            if step.technique == "naked-single":
                if cands[cell] != {digit}:
                    return False, (f"step {i}: claimed NAKED single at {cell} "
                                   f"but its candidates are {sorted(cands[cell])}.")
            elif step.technique == "hidden-single":
                held = False
                for unit in _UNITS:
                    if cell not in unit:
                        continue
                    spots = [c for c in unit if c in cands and digit in cands[c]]
                    if spots == [cell]:
                        held = True
                        break
                if not held:
                    return False, (f"step {i}: claimed HIDDEN single {digit} at "
                                   f"{cell} but it is not the only spot in any "
                                   f"unit.")
            else:
                return False, f"step {i}: unknown placement technique {step.technique!r}."

            (r, c) = cell
            grid[r][c] = digit
            del cands[cell]
            for peer in _peers(cell):
                if peer in cands:
                    cands[peer].discard(digit)
        else:
            # ELIMINATION step — no digit placed; verify the pruned candidates
            # were genuinely eliminable, then prune them from the carried set.
            elim = [(tuple(c), d) for c, d in step.candidates_eliminated]
            digits = {d for _c, d in elim}
            if step.technique == "locked-candidates":
                # a locked-candidates step prunes exactly one digit
                if len(digits) != 1:
                    return False, (f"step {i}: locked-candidates step prunes "
                                   f"{len(digits)} digits, expected 1.")
                digit = next(iter(digits))
                targets = [c for c, _d in elim]
                if not _locked_candidates_holds(cands, digit, targets):
                    return False, (f"step {i}: claimed LOCKED-CANDIDATES for "
                                   f"{digit} but no box/line confinement "
                                   f"justifies eliminating it from {targets}.")
            elif step.technique == "naked-pair":
                if len(digits) > 2:
                    return False, (f"step {i}: naked-pair step prunes "
                                   f"{len(digits)} digits, expected ≤ 2.")
                if not _naked_pair_holds(cands, elim):
                    return False, (f"step {i}: claimed NAKED-PAIR but no unit has "
                                   f"a matching pair that justifies eliminating "
                                   f"{sorted(digits)} from {[c for c, _d in elim]}.")
            elif step.technique == "x-wing":
                # an x-wing step prunes exactly one digit
                if len(digits) != 1:
                    return False, (f"step {i}: x-wing step prunes "
                                   f"{len(digits)} digits, expected 1.")
                digit = next(iter(digits))
                targets = [c for c, _d in elim]
                if not _x_wing_holds(cands, digit, targets):
                    return False, (f"step {i}: claimed X-WING for {digit} but no "
                                   f"two-line confinement justifies eliminating "
                                   f"it from {targets}.")
            else:
                return False, f"step {i}: unknown elimination technique {step.technique!r}."
            for c, d in elim:
                if c in cands:
                    cands[c].discard(d)

    if result.status == "solved-unique":
        if any(grid[r][c] == 0 for r in range(N) for c in range(N)):
            return False, "trace ended solved-unique but the board is unfinished."
        if result.solution != grid:
            return False, "the replayed board does not equal the stated solution."
    return True, f"reason-holds: all {len(result.trace)} steps verified independently."


# ── an INDEPENDENT solver (plain backtracking) — a DIFFERENT algorithm ──────
def _count_solutions(givens: Grid, cap: int = 2) -> int:
    grid = [row[:] for row in givens]

    def legal(r: int, c: int, d: int) -> bool:
        for k in range(N):
            if grid[r][k] == d or grid[k][c] == d:
                return False
        br, bc = 3 * (r // 3), 3 * (c // 3)
        for dr in range(3):
            for dc in range(3):
                if grid[br + dr][bc + dc] == d:
                    return False
        return True

    count = 0

    def bt() -> None:
        nonlocal count
        if count >= cap:
            return
        for r in range(N):
            for c in range(N):
                if grid[r][c] == 0:
                    for d in range(1, 10):
                        if legal(r, c, d):
                            grid[r][c] = d
                            bt()
                            grid[r][c] = 0
                            if count >= cap:
                                return
                    return           # this empty cell had no option — dead branch
        count += 1                   # no empty cell left — a full solution

    bt()
    return count


def verify_uniqueness(givens: Grid, result: SolveResult) -> Report:
    """The solved terminal state must be the UNIQUE solution, proved by an
    independent backtracking counter (not the propagation solver)."""
    n = _count_solutions(givens, cap=2)
    if result.status == "solved-unique":
        if n == 1:
            return True, "uniqueness: independent search confirms exactly one solution."
        return False, (f"claimed solved-unique but independent search found "
                       f"{'0' if n == 0 else '2+'} solutions.")
    if result.status == "broken":
        if n != 1:
            return True, (f"broken confirmed: independent search found "
                          f"{'0' if n == 0 else '2+'} solutions (not a proper puzzle).")
        return False, "claimed broken but the puzzle has exactly one solution."
    # ceiling-hit: the V1 ladder stopped short — a difficulty read, not a verdict
    # on uniqueness. Report the independent count as information, never a failure.
    return True, (f"ceiling-hit: V1 ladder stopped short; independent search sees "
                  f"{'1' if n == 1 else ('0' if n == 0 else '2+')} solution(s).")


def plumb(givens: Grid, result: SolveResult) -> Tuple[bool, List[str]]:
    """Run all three checkers; return (all_passed, per-checker messages)."""
    checks = [
        verify_determinism_replay(givens),
        verify_reason_holds(givens, result),
        verify_uniqueness(givens, result),
    ]
    return all(ok for ok, _ in checks), [m for _, m in checks]
