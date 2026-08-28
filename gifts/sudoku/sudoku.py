#!/usr/bin/env python3
"""sudoku — a Sudoku solver that shows its work.

Most solvers hand you the answer. This one hands you the *reasoning*: it solves
the way a person does — applying the lowest technique that makes progress and
recording WHAT it did and WHY at every step, as a single ordered trace. The
answer is just the last line of an argument you can read.

    from sudoku import solve, from_string
    result = solve(from_string("53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79"))
    result.status            # 'solved-unique' | 'ceiling-hit' | 'broken'
    for step in result.trace:
        print(step.reason)   # "naked single: 4 is the only candidate left for r1c3 ..."

Five techniques, applied lowest-first (so the explanation reads like a human
tutor, easiest move first):
    1. naked single      — a cell with only one candidate left
    2. hidden single     — a digit that fits only one cell in a unit
    3. locked candidates — pointing / claiming (an elimination technique)
    4. naked pair        — two cells locking two digits to themselves
    5. x-wing            — the basic fish

Three honest terminal states:
    solved-unique  — solved by these techniques alone; `solution` is filled in.
    ceiling-hit    — consistent but needs a technique above the ladder (a
                     DIFFICULTY read, not a failure — this puzzle is "harder
                     than x-wing", which is useful information).
    broken         — a cell ran out of candidates; the givens contradict.

Properties (see test_sudoku.py):
    - Deterministic: the same givens always produce the byte-identical trace.
    - Certifying: every placement/elimination carries a human sentence saying
      why it is forced. The trace is a proof you can check by hand.
    - Never guesses: it only makes forced moves. It will say "ceiling-hit"
      before it will backtrack — it does not search, it reasons.

Zero dependencies (Python standard library only). Headless: givens in, a
SolveResult out — no I/O in the solver, no globals, no randomness.

Origin: the reasoning core of a self-explaining Sudoku teaching app, stripped to
stand alone. MIT licensed — take the folder.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, asdict
from typing import Callable, Dict, List, Optional, Set, Tuple

Cell = Tuple[int, int]          # (row, col), 0-indexed
Grid = List[List[int]]          # 9x9, 0 = empty
Candidates = Dict[Cell, Set[int]]

N = 9
DIGITS = frozenset(range(1, 10))


# ── The trace (the spine — everything folds from this) ──────────────────────
@dataclass
class TechniqueApplication:
    technique: str                                   # rung name
    cells_affected: List[Cell]                       # coordinates touched
    candidates_eliminated: List[Tuple[Cell, int]]    # what this step ruled out
    reason: str                                      # the human sentence: WHY

    def to_dict(self) -> dict:
        d = asdict(self)
        d["cells_affected"] = [list(c) for c in self.cells_affected]
        d["candidates_eliminated"] = [
            [list(c), dg] for c, dg in self.candidates_eliminated
        ]
        return d


@dataclass
class SolveResult:
    status: str                                      # solved-unique|ceiling-hit|broken
    trace: List[TechniqueApplication]
    solution: Optional[Grid] = None                  # present iff solved-unique

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "trace": [t.to_dict() for t in self.trace],
            "solution": self.solution,
        }


# ── Geometry (units: rows, cols, boxes) ─────────────────────────────────────
def _peers(cell: Cell) -> Set[Cell]:
    r, c = cell
    peers: Set[Cell] = set()
    for k in range(N):
        peers.add((r, k))
        peers.add((k, c))
    br, bc = 3 * (r // 3), 3 * (c // 3)
    for dr in range(3):
        for dc in range(3):
            peers.add((br + dr, bc + dc))
    peers.discard(cell)
    return peers


def _units() -> List[List[Cell]]:
    units: List[List[Cell]] = []
    for r in range(N):
        units.append([(r, c) for c in range(N)])          # rows
    for c in range(N):
        units.append([(r, c) for r in range(N)])          # cols
    for br in range(0, N, 3):
        for bc in range(0, N, 3):
            units.append([(br + dr, bc + dc)
                          for dr in range(3) for dc in range(3)])  # boxes
    return units


_UNITS = _units()
_UNIT_NAME = (
    ["row " + str(i + 1) for i in range(N)]
    + ["column " + str(i + 1) for i in range(N)]
    + ["box " + str(i + 1) for i in range(N)]
)


def compute_candidates(grid: Grid) -> Candidates:
    """For every empty cell, the digits not already used by one of its peers.

    Deterministic and total — the fixed point recomputes this each step.
    """
    cands: Candidates = {}
    for r in range(N):
        for c in range(N):
            if grid[r][c] != 0:
                continue
            seen = {grid[pr][pc] for pr, pc in _peers((r, c)) if grid[pr][pc] != 0}
            cands[(r, c)] = set(DIGITS) - seen
    return cands


# ── The ladder (reorderable DATA — the one live research object) ────────────
# A rung: given the candidate grid, return the ONE lowest-rung, row-major-first
# applicable move as a TechniqueApplication, or None. Rungs never mutate.
#
# Two KINDS of rung share this signature, and the loop tells them apart by ONE
# schema-stable signal — `candidates_eliminated`:
#   PLACEMENT rung (naked/hidden-single): places a digit; `candidates_eliminated`
#       is [] and the placed digit is the first [1-9] in `reason`.
#   ELIMINATION rung (locked-candidates, pairs, x-wing): places NOTHING; it
#       prunes candidates, so `candidates_eliminated` is non-empty and there is
#       no placed digit. `cells_affected` are the cells it pruned FROM.
# Invariant: `candidates_eliminated` non-empty  <=>  elimination step. A rung
# that would eliminate nothing returns None (no progress -> the loop would spin).
Rung = Callable[[Grid, Candidates], Optional[TechniqueApplication]]


def _rowmajor(cells) -> list:
    """The within-rung tie-break: smallest (row, col) first."""
    return sorted(cells)


def _box_of(cell: Cell) -> Tuple[int, int]:
    r, c = cell
    return (3 * (r // 3), 3 * (c // 3))


def _box_cells(br: int, bc: int) -> List[Cell]:
    return [(br + dr, bc + dc) for dr in range(3) for dc in range(3)]


def _box_num(br: int, bc: int) -> int:
    return (br // 3) * 3 + (bc // 3) + 1


# Row/column units in a fixed order (rows 1-9 then cols 1-9), for the line-based
# rungs; digit names within a reason are 1-indexed to match the singles' voice.
_ROWS: List[List[Cell]] = [[(r, c) for c in range(N)] for r in range(N)]
_COLS: List[List[Cell]] = [[(r, c) for r in range(N)] for c in range(N)]
_BOXES: List[Tuple[int, int]] = [(br, bc) for br in range(0, N, 3)
                                 for bc in range(0, N, 3)]


def rung_naked_single(grid: Grid, cands: Candidates) -> Optional[TechniqueApplication]:
    for cell in _rowmajor(cands):
        opts = cands[cell]
        if len(opts) == 1:
            d = next(iter(opts))
            r, c = cell
            return TechniqueApplication(
                technique="naked-single",
                cells_affected=[cell],
                candidates_eliminated=[],
                reason=(f"naked single: {d} is the only candidate left for "
                        f"r{r + 1}c{c + 1} — every other digit is already used "
                        f"by one of its peers."),
            )
    return None


def rung_hidden_single(grid: Grid, cands: Candidates) -> Optional[TechniqueApplication]:
    # Units in a fixed order; within a unit, digits ascending; first hit wins.
    for ui, unit in enumerate(_UNITS):
        empties = [cell for cell in unit if cell in cands]
        for d in range(1, 10):
            spots = [cell for cell in empties if d in cands[cell]]
            if len(spots) == 1:
                cell = spots[0]
                # Skip if a naked single would already place it (lower rung wins).
                if len(cands[cell]) == 1:
                    continue
                r, c = cell
                # The placed digit MUST be the first numeral in the reason:
                # _placed_digit greps the first \b[1-9]\b, so leading with a
                # unit number would make it place the unit's number, not {d}.
                return TechniqueApplication(
                    technique="hidden-single",
                    cells_affected=[cell],
                    candidates_eliminated=[],
                    reason=(f"hidden single: {d} can only go in r{r + 1}c{c + 1} "
                            f"— within {_UNIT_NAME[ui]} it fits nowhere else."),
                )
    return None


def rung_locked_candidates(grid: Grid, cands: Candidates) -> Optional[TechniqueApplication]:
    """Locked candidates (pointing + claiming). An ELIMINATION rung.

    Pointing: within a box, if every candidate for a digit lies in one line
    (row or col), that digit is eliminated from the rest of that line.
    Claiming: within a line, if every candidate for a digit lies in one box,
    that digit is eliminated from the rest of that box.
    """
    # ── Pointing: box -> line ───────────────────────────────────────────────
    for br, bc in _BOXES:
        cells = _box_cells(br, bc)
        for d in range(1, 10):
            spots = [cell for cell in cells if cell in cands and d in cands[cell]]
            if len(spots) < 2:
                continue
            rows = {r for r, _c in spots}
            cols = {c for _r, c in spots}
            if len(rows) == 1:
                r = next(iter(rows))
                targets = _rowmajor(cell for cell in _ROWS[r]
                                    if cell not in cells
                                    and cell in cands and d in cands[cell])
                if targets:
                    return TechniqueApplication(
                        technique="locked-candidates",
                        cells_affected=targets,
                        candidates_eliminated=[(cell, d) for cell in targets],
                        reason=(f"locked candidates: in box {_box_num(br, bc)}, "
                                f"{d} can only go in row {r + 1}, so {d} is "
                                f"eliminated from the rest of row {r + 1}."),
                    )
            if len(cols) == 1:
                c = next(iter(cols))
                targets = _rowmajor(cell for cell in _COLS[c]
                                    if cell not in cells
                                    and cell in cands and d in cands[cell])
                if targets:
                    return TechniqueApplication(
                        technique="locked-candidates",
                        cells_affected=targets,
                        candidates_eliminated=[(cell, d) for cell in targets],
                        reason=(f"locked candidates: in box {_box_num(br, bc)}, "
                                f"{d} can only go in column {c + 1}, so {d} is "
                                f"eliminated from the rest of column {c + 1}."),
                    )
    # ── Claiming: line -> box ───────────────────────────────────────────────
    for name, unit in ([(f"row {i + 1}", u) for i, u in enumerate(_ROWS)]
                       + [(f"column {i + 1}", u) for i, u in enumerate(_COLS)]):
        for d in range(1, 10):
            spots = [cell for cell in unit if cell in cands and d in cands[cell]]
            if len(spots) < 2:
                continue
            boxes = {_box_of(cell) for cell in spots}
            if len(boxes) == 1:
                br, bc = next(iter(boxes))
                box = _box_cells(br, bc)
                targets = _rowmajor(cell for cell in box
                                    if cell not in unit
                                    and cell in cands and d in cands[cell])
                if targets:
                    return TechniqueApplication(
                        technique="locked-candidates",
                        cells_affected=targets,
                        candidates_eliminated=[(cell, d) for cell in targets],
                        reason=(f"locked candidates: in {name}, {d} can only go "
                                f"in box {_box_num(br, bc)}, so {d} is eliminated "
                                f"from the rest of box {_box_num(br, bc)}."),
                    )
    return None


def rung_naked_pair(grid: Grid, cands: Candidates) -> Optional[TechniqueApplication]:
    """Naked pair. Two cells in a unit sharing the SAME two candidates {x, y}
    lock those digits to themselves, eliminating x and y from every other cell
    in that unit."""
    for ui, unit in enumerate(_UNITS):
        bi = _rowmajor(cell for cell in unit
                       if cell in cands and len(cands[cell]) == 2)
        for i in range(len(bi)):
            for j in range(i + 1, len(bi)):
                a, b = bi[i], bi[j]
                if cands[a] != cands[b]:
                    continue
                pair = sorted(cands[a])                        # [x, y]
                elim: List[Tuple[Cell, int]] = []
                for cell in unit:
                    if cell in (a, b) or cell not in cands:
                        continue
                    for d in pair:
                        if d in cands[cell]:
                            elim.append((cell, d))
                if elim:
                    elim.sort()
                    affected = _rowmajor({c for c, _d in elim})
                    ar, ac = a
                    br_, bc_ = b
                    return TechniqueApplication(
                        technique="naked-pair",
                        cells_affected=affected,
                        candidates_eliminated=elim,
                        reason=(f"naked pair: {pair[0]} and {pair[1]} are locked "
                                f"to r{ar + 1}c{ac + 1} and r{br_ + 1}c{bc_ + 1} "
                                f"in {_UNIT_NAME[ui]}, so both are eliminated from "
                                f"the rest of that unit."),
                    )
    return None


def rung_x_wing(grid: Grid, cands: Candidates) -> Optional[TechniqueApplication]:
    """X-wing (basic fish). If two rows each have digit d as a candidate in
    EXACTLY the same two columns, d is eliminated from those columns in every
    other row (and the column-based transpose)."""
    # ── Row-based: base = two rows, cross = two columns ─────────────────────
    for d in range(1, 10):
        rowcols: Dict[int, Tuple[int, int]] = {}
        for r in range(N):
            cols = [c for c in range(N)
                    if (r, c) in cands and d in cands[(r, c)]]
            if len(cols) == 2:
                rowcols[r] = (cols[0], cols[1])
        bases = sorted(rowcols)
        for i in range(len(bases)):
            for j in range(i + 1, len(bases)):
                r1, r2 = bases[i], bases[j]
                if rowcols[r1] != rowcols[r2]:
                    continue
                c1, c2 = rowcols[r1]
                targets = _rowmajor(
                    (r, c) for r in range(N) if r not in (r1, r2)
                    for c in (c1, c2)
                    if (r, c) in cands and d in cands[(r, c)])
                if targets:
                    return TechniqueApplication(
                        technique="x-wing",
                        cells_affected=targets,
                        candidates_eliminated=[(cell, d) for cell in targets],
                        reason=(f"X-wing: {d} in rows {r1 + 1} and {r2 + 1} is "
                                f"confined to columns {c1 + 1} and {c2 + 1}, so "
                                f"{d} is eliminated from those columns in every "
                                f"other row."),
                    )
    # ── Column-based (transpose): base = two columns, cross = two rows ──────
    for d in range(1, 10):
        colrows: Dict[int, Tuple[int, int]] = {}
        for c in range(N):
            rows = [r for r in range(N)
                    if (r, c) in cands and d in cands[(r, c)]]
            if len(rows) == 2:
                colrows[c] = (rows[0], rows[1])
        bases = sorted(colrows)
        for i in range(len(bases)):
            for j in range(i + 1, len(bases)):
                c1, c2 = bases[i], bases[j]
                if colrows[c1] != colrows[c2]:
                    continue
                r1, r2 = colrows[c1]
                targets = _rowmajor(
                    (r, c) for c in range(N) if c not in (c1, c2)
                    for r in (r1, r2)
                    if (r, c) in cands and d in cands[(r, c)])
                if targets:
                    return TechniqueApplication(
                        technique="x-wing",
                        cells_affected=targets,
                        candidates_eliminated=[(cell, d) for cell in targets],
                        reason=(f"X-wing: {d} in columns {c1 + 1} and {c2 + 1} is "
                                f"confined to rows {r1 + 1} and {r2 + 1}, so "
                                f"{d} is eliminated from those rows in every "
                                f"other column."),
                    )
    return None


# ORDER IS DATA — reorder to change the difficulty model, never hard-code it.
# New techniques (wings, chains) append here; the solve loop never changes.
LADDER: List[Tuple[str, int, Rung]] = [
    ("naked-single", 1, rung_naked_single),
    ("hidden-single", 2, rung_hidden_single),
    ("locked-candidates", 3, rung_locked_candidates),
    ("naked-pair", 4, rung_naked_pair),
    ("x-wing", 5, rung_x_wing),
]


def _is_contradiction(grid: Grid, cands: Candidates) -> bool:
    for cell, opts in cands.items():
        if not opts:               # an empty cell with no candidate = broken
            return True
    return False


def _complete(grid: Grid) -> bool:
    return all(grid[r][c] != 0 for r in range(N) for c in range(N))


def _placed_digit(step: TechniqueApplication) -> int:
    # CONTRACT: a PLACEMENT reason MUST lead with the placed digit — it is the
    # first \b[1-9]\b in the string, before any row/col/unit numeral. Both
    # placement rungs honor this. Never call this on an elimination step
    # (candidates_eliminated non-empty); use its structured (cell, digit) pairs.
    m = re.search(r"\b([1-9])\b", step.reason)
    return int(m.group(1))


def _is_placement(step: TechniqueApplication) -> bool:
    """A step is a PLACEMENT iff it eliminates no candidates (it places a digit);
    otherwise it is an ELIMINATION (it prunes candidates, places nothing)."""
    return not step.candidates_eliminated


def solve(givens: Grid) -> SolveResult:
    """solve(givens) -> SolveResult. Prefer-lowest-rung fixed point.

    Candidates are CARRIED, not recomputed each step: a placement prunes the
    placed digit from the placed cell's peers; an elimination prunes the pruned
    (cell, digit) pairs. Recomputing from the grid alone would lose every
    elimination-rung deduction (they don't live in the grid), so the persistent
    candidate set is what lets a later single depend on an earlier elimination.
    """
    grid = [row[:] for row in givens]
    cands = compute_candidates(grid)
    trace: List[TechniqueApplication] = []

    while True:
        if _is_contradiction(grid, cands):
            return SolveResult(status="broken", trace=trace, solution=None)

        if _complete(grid):
            return SolveResult(status="solved-unique", trace=trace,
                               solution=[row[:] for row in grid])

        # walk the ladder bottom-up; apply the LOWEST rung that makes progress
        step: Optional[TechniqueApplication] = None
        for _name, _tier, rung in LADDER:
            step = rung(grid, cands)
            if step is not None:
                break

        if step is None:
            # no rung progresses, board consistent but unfinished — a
            # DIFFICULTY read, not a failure.
            return SolveResult(status="ceiling-hit", trace=trace, solution=None)

        if _is_placement(step):
            (r, c) = step.cells_affected[0]
            d = _placed_digit(step)
            grid[r][c] = d
            del cands[(r, c)]
            for peer in _peers((r, c)):
                if peer in cands:
                    cands[peer].discard(d)
        else:
            for cell, dig in step.candidates_eliminated:
                if cell in cands:
                    cands[cell].discard(dig)
        trace.append(step)


# ── convenience: parse / print an 81-char string ("." or "0" = empty) ───────
def from_string(s: str) -> Grid:
    s = "".join(ch for ch in s if not ch.isspace())
    if len(s) != 81:
        raise ValueError(f"expected 81 cells, got {len(s)}")
    g: Grid = []
    for r in range(N):
        row = []
        for c in range(N):
            ch = s[r * N + c]
            row.append(0 if ch in ".0" else int(ch))
        g.append(row)
    return g


def to_string(grid: Grid) -> str:
    return "".join(str(grid[r][c]) for r in range(N) for c in range(N))


def render(grid: Grid) -> str:
    """A human-readable 9x9 grid with box separators (for the CLI)."""
    lines = []
    for r in range(N):
        if r in (3, 6):
            lines.append("------+-------+------")
        cells = []
        for c in range(N):
            if c in (3, 6):
                cells.append("|")
            cells.append(str(grid[r][c]) if grid[r][c] else ".")
        lines.append(" ".join(cells))
    return "\n".join(lines)


# ── CLI: read an 81-char puzzle, print the reasoning, then the answer ───────
def _main(argv: List[str]) -> int:
    demo = "53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79"
    if argv and argv[0] in ("-h", "--help"):
        print("usage: python3 sudoku.py [81-char-puzzle | --demo]")
        print("  cells 1-9; '.' or '0' = empty; whitespace ignored")
        print("  prints the step-by-step reasoning, then the solution")
        return 0
    arg = argv[0] if argv else "--demo"
    puzzle = demo if arg in ("", "--demo") else arg
    try:
        grid = from_string(puzzle)
    except ValueError as e:
        print(f"bad puzzle: {e}")
        return 2

    print("puzzle:")
    print(render(grid))
    print()
    result = solve(grid)
    print(f"status: {result.status}  ({len(result.trace)} steps)\n")
    for i, step in enumerate(result.trace, 1):
        print(f"  {i:>2}. {step.reason}")
    if result.solution is not None:
        print("\nsolution:")
        print(render(result.solution))
    elif result.status == "ceiling-hit":
        print("\n(consistent, but needs a technique above this solver's ladder — "
              "a difficulty read, not a failure.)")
    return 0


if __name__ == "__main__":
    import sys
    raise SystemExit(_main(sys.argv[1:]))
