#!/usr/bin/env python3
"""loop-sudoku — Block C: the four faces (plan §3 / §5).

The certifying solver (Block A) emits ONE trace. Everything the player touches
is a readout of that one trace — never a second engine. This module is the four
readouts, each a pure `fold(trace) -> readout`:

    grade(result)      -> the trace CEILING: the hardest tier any rung was
                          forced to use, mapped to a difficulty band.
    hint(result, k)    -> replay ONE step (step k) + show its SYNDROME
                          (which technique fired, on which cell, and WHY).
    teach(result)      -> WALK the whole trace: the ordered guided replay.
    validate(result)   -> does the trace terminate UNIQUE (not broken)? —
                          the fair/unfair reading (solved without guessing).

Design invariant (Tamar): four folds of one trace, or they lie. Two separate
engines for `hint` and `grade` are guaranteed to disagree — that is the
four-times-solved storage bug one level up. Here every face reads the SAME
`trace`, and no face reads another face.

Test by removal (independence): delete any one face and the other three still
stand — the proof that these are folds, not engines (see tests/test_faces.py).

The difficulty model is DATA, not code: `TIER_OF` is derived from the solver's
`LADDER`, so reordering / appending a rung (the ladder-as-data design) re-grades
every puzzle with no change here. HARD RULES: stdlib only · headless · a face
never mutates the result and never re-solves.

Design of record: projects/loop-sudoku/plan/loop-sudoku-v1-design-plan-v1.md §3.
"""
from __future__ import annotations

from typing import Dict, List, Optional

from solver import (LADDER, SolveResult, TechniqueApplication, _placed_digit,
                    _is_placement)


def _step_move(step: TechniqueApplication) -> dict:
    """The move fields for one step, honest about its KIND.

    A PLACEMENT step reports the cell it filled and the digit it placed. An
    ELIMINATION step places nothing — it reports `digit: None` and the
    candidates it pruned, so hint/teach never fabricate a placed digit out of
    an elimination reason (the `_placed_digit` regex would otherwise grab a
    stray numeral from the reason text and lie)."""
    if _is_placement(step):
        r, c = step.cells_affected[0]
        return {"kind": "placement", "cell": [r + 1, c + 1],
                "digit": _placed_digit(step), "eliminates": None}
    return {
        "kind": "elimination",
        "cell": None,
        "digit": None,
        "eliminates": [[[r + 1, c + 1], d]
                       for (r, c), d in step.candidates_eliminated],
    }

# ── The difficulty scale is DERIVED from the ladder, never hard-coded ────────
# The ladder is the one live research object (plan §3); its `tier` column IS
# the definition of "difficulty". Reorder/append a rung there and the whole
# grade face moves with it — no edit here.
TIER_OF: Dict[str, int] = {name: tier for name, tier, _rung in LADDER}

# tier -> human band, DERIVED from the ladder's tier column (naked=1, hidden=2,
# locked-candidates=3, pairs=4, x-wing=5). A tier above the current ladder
# ceiling reads as the FRONTIER band — the L21 DR-2 / "#99, The One That Isn't
# Here Yet" precedent (SWX-F2), the honest surfacing of "harder than V1 can
# grade" rather than a hidden failure. A rung appended to LADDER needs a band
# here (else it correctly falls to FRONTIER — a loud gap, not a silent wrong).
_BAND_BY_TIER: Dict[int, str] = {1: "easy", 2: "medium", 3: "hard",
                                 4: "expert", 5: "master"}
FRONTIER_BAND = "beyond the V1 ladder"


def _cellname(step: TechniqueApplication) -> str:
    r, c = step.cells_affected[0]
    return f"r{r + 1}c{c + 1}"


# ── Face 1 — grade (the trace CEILING) ──────────────────────────────────────
def grade(result: SolveResult) -> dict:
    """Difficulty = the hardest technique the trace was FORCED to use.

    Fold: max `tier` over the applied rungs. A `ceiling-hit` trace stalled the
    V1 ladder, so its true difficulty is past what V1 can grade -> the frontier
    band (honest, not "broken"). A `broken` puzzle has no honest grade — that
    is `validate`'s call, not grade's.
    """
    if result.status == "broken":
        return {
            "gradeable": False,
            "band": None,
            "ceiling_tier": None,
            "ceiling_technique": None,
            "note": "no honest grade — the puzzle is broken (validate reports "
                    "no unique solution).",
        }

    tiers = [TIER_OF[s.technique] for s in result.trace if s.technique in TIER_OF]
    ceiling_tier = max(tiers) if tiers else 0
    ceiling_tech = None
    if ceiling_tier:
        # the (first) rung that set the ceiling — for the "why this band" line
        for s in result.trace:
            if TIER_OF.get(s.technique) == ceiling_tier:
                ceiling_tech = s.technique
                break

    if result.status == "ceiling-hit":
        band = FRONTIER_BAND
        note = ("the V1 ladder cannot finish this puzzle — it needs a technique "
                "above the current rungs, so it grades past V1 (the frontier "
                "band, honestly surfaced).")
    else:  # solved-unique
        band = _BAND_BY_TIER.get(ceiling_tier, FRONTIER_BAND)
        note = (f"the hardest technique the solve was forced to use was "
                f"'{ceiling_tech}' (tier {ceiling_tier})." if ceiling_tech
                else "the puzzle was already solved with no technique needed.")

    return {
        "gradeable": True,
        "band": band,
        "ceiling_tier": ceiling_tier,
        "ceiling_technique": ceiling_tech,
        "note": note,
    }


# ── Face 2 — hint (replay ONE step + its syndrome) ──────────────────────────
def hint(result: SolveResult, step_index: int = 0) -> dict:
    """One replayed step + the SYNDROME: which technique fired, where, and WHY.

    `step_index` is the player's cursor — how many certified steps they have
    already made. Fold: return trace[step_index] as a readout. Past the end,
    the honest terminal message for the puzzle's status (never a fabricated
    move).
    """
    if step_index < 0:
        step_index = 0

    if step_index < len(result.trace):
        step = result.trace[step_index]
        move = _step_move(step)
        return {
            "available": True,
            "step_index": step_index,
            "technique": step.technique,
            "tier": TIER_OF.get(step.technique),
            "kind": move["kind"],
            "cell": move["cell"],            # 1-indexed placement cell, or None
            "digit": move["digit"],          # placed digit, or None (elimination)
            "eliminates": move["eliminates"],  # pruned [[cell,digit],...] or None
            "reason": step.reason,           # the syndrome, in the app's voice
        }

    # exhausted the trace — say the honest thing for the terminal state
    if result.status == "solved-unique":
        msg = "the puzzle is solved — no hint needed."
    elif result.status == "ceiling-hit":
        msg = ("no V1 technique applies from here — this puzzle is past the V1 "
               "ladder (a difficulty reading, not a dead end).")
    else:  # broken
        msg = "this puzzle is broken — there is no move to hint."
    return {
        "available": False,
        "step_index": step_index,
        "technique": None,
        "tier": None,
        "kind": None,
        "cell": None,
        "digit": None,
        "eliminates": None,
        "reason": msg,
    }


# ── Face 3 — teach (WALK the whole trace) ───────────────────────────────────
def teach(result: SolveResult) -> List[dict]:
    """The guided replay: the ordered trace as human-readable steps.

    Fold: map each step -> {n, technique, tier, cell, digit, reason}. This is
    `hint` walked from 0 to the end (independence holds: teach folds the trace
    directly, it does not call hint).
    """
    steps: List[dict] = []
    for i, step in enumerate(result.trace):
        move = _step_move(step)
        steps.append({
            "n": i + 1,
            "technique": step.technique,
            "tier": TIER_OF.get(step.technique),
            "kind": move["kind"],
            "cell": move["cell"],
            "digit": move["digit"],
            "eliminates": move["eliminates"],
            "reason": step.reason,
        })
    return steps


# ── Face 4 — validate (does the trace terminate UNIQUE?) ────────────────────
def validate(result: SolveResult) -> dict:
    """Fair puzzle? — solved to a unique solution WITHOUT guessing.

    Fold over the terminal status:
      solved-unique -> fair (the certifying solver reached one solution with
                       only logic, no backtracking).
      broken        -> unfair (no solution, or more than one).
      ceiling-hit   -> unproven by V1 — the honest middle: not shown fair, not
                       shown unfair; the V1 ladder simply cannot certify it.
    """
    if result.status == "solved-unique":
        return {
            "verdict": "fair",
            "solvable_without_guessing": True,
            "note": "solved to a single solution using only logic — no guessing.",
        }
    if result.status == "broken":
        return {
            "verdict": "unfair",
            "solvable_without_guessing": False,
            "note": "no unique solution — this puzzle has zero or multiple "
                    "solutions.",
        }
    # ceiling-hit
    return {
        "verdict": "unproven-by-v1",
        "solvable_without_guessing": None,
        "note": "the V1 ladder cannot finish this puzzle, so fairness is not "
                "certified either way — it needs a technique above the current "
                "rungs.",
    }


# ── convenience: all four faces at once (for the JSON boundary / render) ─────
def all_faces(result: SolveResult, hint_at: int = 0) -> dict:
    """Fold the trace into all four readouts in one pass — the shape the render
    half serializes (grid consumes JSON, never re-derives the solve)."""
    return {
        "grade": grade(result),
        "hint": hint(result, hint_at),
        "teach": teach(result),
        "validate": validate(result),
    }
