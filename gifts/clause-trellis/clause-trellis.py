#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""clause-trellis.py -- lay a mega-prompt's clauses on a grid, find WHICH TWO contradict.

You wrote a big prompt. Over time it grew clauses -- "answer in under 200 words",
"be exhaustive", "output JSON", "write a friendly paragraph". Somewhere in there two
of those clauses pull against each other, and the model quietly obeys one and drops
the other. clause-trellis lays your clauses on a grid where every clause crosses every
other clause, and localizes a contradiction to the single CELL where two clauses meet
-- it names the pair, not just "something's wrong".

THE SHAPE (borrowed from the `trellis` gift, redesigned for clauses)
  trellis lays objects on a double word square and localizes an inconsistency to the
  cell where a failing row crosses a failing column. clause-trellis reuses that SHAPE
  -- localize a failure to the single cell where two things cross -- but the grid is
  the N x N matrix of clause-against-clause, and the crossing test is a decidable
  conflict oracle over DECLARED dimensions, not arc-consistency over letters.

WHAT A CLAUSE IS (the declared form)
  A clause names a DIMENSION and constrains it. Two shapes of constraint, both decidable:
    - a bounded numeric range on a dimension:   {"dim": "length", "min": 500}
                                                {"dim": "length", "max": 200}
    - a categorical value (or allowed set) on a dimension:
                                                {"dim": "format", "is": "json"}
                                                {"dim": "format", "in": ["prose","markdown"]}
  A clause also carries an "id" (yours, for the receipt) and its original "text"
  (the human sentence it came from -- carried, never parsed).

THE CONFLICT ORACLE (decidable, per cell)
  Two clauses on the SAME dimension conflict iff their constraints cannot both hold:
    - two ranges conflict iff they do not overlap  (min_a > max_b, or min_b > max_a)
    - two categoricals conflict iff their allowed sets are disjoint
    - a range vs a categorical never conflict (different constraint kinds -- reported
      CROSS-KIND, an honest "cannot decide with declared data", never a false OK)
  Clauses on DIFFERENT dimensions never conflict -- they are orthogonal by construction.

THE VERDICT
  CLEAR          no cell contradicts               -> exit 0
  CONTRADICTORY  >=1 cell contradicts, each pair    -> exit 3, every conflicting
                 named and located (row id x col id)   pair listed, sorted, deduped

HONEST CEILING (the printed edge -- what it does NOT do)
  clause-trellis finds contradictions you DECLARED, over a closed set of decidable
  dimensions (numeric ranges + categorical values). It does not read intent, meaning,
  tone, or the natural-language text of a clause -- if two sentences contradict in
  spirit but you did not declare the shared dimension, it will not see it. Silence
  means "no DECLARED contradiction", which is necessary, not sufficient. It finds the
  conflicts you wrote down; it does not understand the prompt.

  python3 clause-trellis.py solve <clauses.json>   # find contradicting pairs
  python3 clause-trellis.py demo                    # a small worked prompt
  python3 clause-trellis.py --selftest              # deterministic core, byte-identical
  python3 clause-trellis.py --help

Python 3 stdlib only, no dependencies, offline, deterministic core.
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict, List, Optional, Tuple

__all__ = [
    "Clause",
    "ClauseTrellisError",
    "conflict",
    "solve",
    "Result",
]


class ClauseTrellisError(ValueError):
    """A malformed clause set -- missing dim, no constraint, or contradictory shape in one clause."""


# ----------------------------------------------------------------------------
# The clause model
# ----------------------------------------------------------------------------

class Clause:
    """One declared constraint on one dimension.

    Exactly one constraint KIND per clause:
      range       -- has 'min' and/or 'max' (numbers)
      categorical -- has 'is' (one value) or 'in' (a non-empty list of values)

    A clause with neither, or both kinds at once, is a spec error (fail-closed).
    """

    __slots__ = ("id", "dim", "text", "kind", "cmin", "cmax", "allowed")

    def __init__(self, raw: Dict[str, Any], index: int) -> None:
        if not isinstance(raw, dict):
            raise ClauseTrellisError(f"clause #{index} is not an object")
        dim = raw.get("dim")
        if not isinstance(dim, str) or not dim:
            raise ClauseTrellisError(f"clause #{index} missing a string 'dim'")
        self.dim = dim
        # id defaults to a stable positional handle so a receipt is always addressable.
        cid = raw.get("id")
        self.id = cid if isinstance(cid, str) and cid else f"c{index}"
        text = raw.get("text")
        self.text = text if isinstance(text, str) else ""

        has_range = ("min" in raw) or ("max" in raw)
        has_cat = ("is" in raw) or ("in" in raw)
        if has_range and has_cat:
            raise ClauseTrellisError(
                f"clause '{self.id}' mixes a range (min/max) and a categorical (is/in) -- pick one"
            )
        if not has_range and not has_cat:
            raise ClauseTrellisError(
                f"clause '{self.id}' declares no constraint (need min/max or is/in)"
            )

        self.cmin: Optional[float] = None
        self.cmax: Optional[float] = None
        self.allowed: Optional[frozenset] = None

        if has_range:
            self.kind = "range"
            if "min" in raw:
                self.cmin = _as_number(raw["min"], self.id, "min")
            if "max" in raw:
                self.cmax = _as_number(raw["max"], self.id, "max")
            if self.cmin is not None and self.cmax is not None and self.cmin > self.cmax:
                raise ClauseTrellisError(
                    f"clause '{self.id}' is self-contradictory: min {self.cmin} > max {self.cmax}"
                )
        else:
            self.kind = "categorical"
            if "in" in raw:
                vals = raw["in"]
                if not isinstance(vals, list) or not vals:
                    raise ClauseTrellisError(
                        f"clause '{self.id}' 'in' must be a non-empty list"
                    )
                self.allowed = frozenset(_hashable(v, self.id) for v in vals)
            else:
                self.allowed = frozenset([_hashable(raw["is"], self.id)])

    def constraint_str(self) -> str:
        if self.kind == "range":
            lo = "-inf" if self.cmin is None else _numstr(self.cmin)
            hi = "+inf" if self.cmax is None else _numstr(self.cmax)
            return f"{self.dim} in [{lo}, {hi}]"
        vals = ", ".join(_valstr(v) for v in sorted(self.allowed, key=lambda x: str(x)))
        return f"{self.dim} in {{{vals}}}"


def _as_number(v: Any, cid: str, field: str) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise ClauseTrellisError(f"clause '{cid}' {field} must be a number, got {v!r}")
    return float(v)


def _hashable(v: Any, cid: str) -> Any:
    if isinstance(v, (str, int, float, bool)) or v is None:
        return v
    raise ClauseTrellisError(f"clause '{cid}' categorical value must be scalar, got {v!r}")


def _numstr(x: float) -> str:
    # Render 5.0 as "5", keep real fractions -- so the result bytes are stable and readable.
    return str(int(x)) if x == int(x) else repr(x)


def _valstr(v: Any) -> str:
    return json.dumps(v)


# ----------------------------------------------------------------------------
# The conflict oracle (the crossing test for one cell)
# ----------------------------------------------------------------------------

def conflict(a: Clause, b: Clause) -> Optional[str]:
    """Return a reason string iff clauses a and b cannot both hold, else None.

    Same dimension is required for any conflict; different dimensions are orthogonal.
    Cross-kind (range vs categorical) is NOT a conflict -- it is undecidable with the
    declared data and reported separately by solve(), never silently called OK here.
    """
    if a.dim != b.dim:
        return None
    if a.kind != b.kind:
        return None  # cross-kind handled by solve() as its own bucket
    if a.kind == "range":
        # No overlap iff one lower bound exceeds the other's upper bound.
        if a.cmin is not None and b.cmax is not None and a.cmin > b.cmax:
            return f"{a.constraint_str()} vs {b.constraint_str()}: ranges do not overlap"
        if b.cmin is not None and a.cmax is not None and b.cmin > a.cmax:
            return f"{a.constraint_str()} vs {b.constraint_str()}: ranges do not overlap"
        return None
    # categorical: conflict iff allowed sets are disjoint
    if a.allowed.isdisjoint(b.allowed):
        return f"{a.constraint_str()} vs {b.constraint_str()}: no shared allowed value"
    return None


def _is_cross_kind(a: Clause, b: Clause) -> bool:
    return a.dim == b.dim and a.kind != b.kind


# ----------------------------------------------------------------------------
# The trellis solve
# ----------------------------------------------------------------------------

class Result:
    """The pure result of a solve -- a plain, JSON-serializable, deterministic object."""

    __slots__ = ("verdict", "clause_count", "conflicts", "cross_kind")

    def __init__(self, verdict: str, clause_count: int,
                 conflicts: List[Dict[str, str]], cross_kind: List[Dict[str, str]]) -> None:
        self.verdict = verdict
        self.clause_count = clause_count
        self.conflicts = conflicts
        self.cross_kind = cross_kind

    def to_dict(self) -> Dict[str, Any]:
        return {
            "verdict": self.verdict,
            "clause_count": self.clause_count,
            "conflicts": self.conflicts,
            "cross_kind": self.cross_kind,
        }


def solve(clauses_raw: List[Dict[str, Any]]) -> Result:
    """Lay the clauses on the pairwise trellis and localize every contradiction to a cell.

    Deterministic: the result is a pure function of the input. Conflicts are emitted in
    a canonical order (sorted by the pair of clause ids) so folding the same input twice
    yields byte-identical bytes.
    """
    if not isinstance(clauses_raw, list):
        raise ClauseTrellisError("clauses must be a JSON array")
    clauses = [Clause(c, i) for i, c in enumerate(clauses_raw)]

    # Guard against duplicate ids -- a receipt that cannot address a cell is useless.
    seen_ids: Dict[str, int] = {}
    for c in clauses:
        if c.id in seen_ids:
            raise ClauseTrellisError(f"duplicate clause id '{c.id}' (ids must be unique)")
        seen_ids[c.id] = 1

    conflicts: List[Dict[str, str]] = []
    cross_kind: List[Dict[str, str]] = []
    n = len(clauses)
    for i in range(n):
        for j in range(i + 1, n):
            a, b = clauses[i], clauses[j]
            reason = conflict(a, b)
            if reason is not None:
                lo, hi = _ordered(a.id, b.id)
                conflicts.append({
                    "row": lo,
                    "col": hi,
                    "dim": a.dim,
                    "reason": reason,
                })
            elif _is_cross_kind(a, b):
                lo, hi = _ordered(a.id, b.id)
                cross_kind.append({
                    "row": lo,
                    "col": hi,
                    "dim": a.dim,
                    "note": "range vs categorical on the same dimension -- not decidable from declared data",
                })

    conflicts.sort(key=lambda d: (d["row"], d["col"]))
    cross_kind.sort(key=lambda d: (d["row"], d["col"]))
    verdict = "CONTRADICTORY" if conflicts else "CLEAR"
    return Result(verdict, n, conflicts, cross_kind)


def _ordered(x: str, y: str) -> Tuple[str, str]:
    return (x, y) if x <= y else (y, x)


# ----------------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------------

def _emit(result: Result) -> None:
    sys.stdout.write(json.dumps(result.to_dict(), indent=2, sort_keys=True) + "\n")


_DEMO_CLAUSES = [
    {"id": "brevity", "dim": "length", "max": 200,
     "text": "Answer in under 200 words."},
    {"id": "thoroughness", "dim": "length", "min": 500,
     "text": "Be exhaustive; leave nothing out."},
    {"id": "as-json", "dim": "format", "is": "json",
     "text": "Return the result as a JSON object."},
    {"id": "as-prose", "dim": "format", "in": ["prose", "markdown"],
     "text": "Write a friendly paragraph."},
    {"id": "tone-warm", "dim": "tone", "is": "friendly",
     "text": "Be warm and encouraging."},
]


def cmd_solve(path: str) -> int:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        sys.stderr.write(f"clause-trellis: cannot read {path}: {exc}\n")
        return 2
    try:
        result = solve(data)
    except ClauseTrellisError as exc:
        sys.stderr.write(f"clause-trellis: spec error: {exc}\n")
        return 2
    _emit(result)
    return 3 if result.verdict == "CONTRADICTORY" else 0


def cmd_demo() -> int:
    result = solve(_DEMO_CLAUSES)
    _emit(result)
    return 3 if result.verdict == "CONTRADICTORY" else 0


def _selftest() -> int:
    # 1. determinism: same input -> byte-identical result bytes, twice.
    a = json.dumps(solve(_DEMO_CLAUSES).to_dict(), indent=2, sort_keys=True)
    b = json.dumps(solve(_DEMO_CLAUSES).to_dict(), indent=2, sort_keys=True)
    assert a == b, "determinism: two folds differ"

    # 2. the demo has exactly two contradictions (length + format), located to the right pairs.
    r = solve(_DEMO_CLAUSES)
    assert r.verdict == "CONTRADICTORY", r.verdict
    pairs = {(c["row"], c["col"]) for c in r.conflicts}
    assert ("brevity", "thoroughness") in pairs, pairs
    assert ("as-json", "as-prose") in pairs, pairs
    assert len(r.conflicts) == 2, r.conflicts

    # 3. a clean set is CLEAR, exit-0 shape.
    clean = solve([
        {"id": "a", "dim": "length", "max": 300},
        {"id": "b", "dim": "length", "min": 100},
        {"id": "c", "dim": "format", "is": "json"},
    ])
    assert clean.verdict == "CLEAR", clean.verdict
    assert clean.conflicts == [], clean.conflicts

    # 4. orthogonal dimensions never conflict.
    assert conflict(Clause({"dim": "length", "max": 10}, 0),
                    Clause({"dim": "tone", "is": "formal"}, 1)) is None

    # 5. touching ranges (min == max) overlap, do NOT conflict.
    assert conflict(Clause({"dim": "x", "min": 200}, 0),
                    Clause({"dim": "x", "max": 200}, 1)) is None
    # ...but a gap of one does.
    assert conflict(Clause({"dim": "x", "min": 201}, 0),
                    Clause({"dim": "x", "max": 200}, 1)) is not None

    # 6. categorical: disjoint sets conflict, overlapping sets do not.
    assert conflict(Clause({"dim": "f", "is": "json"}, 0),
                    Clause({"dim": "f", "in": ["prose", "md"]}, 1)) is not None
    assert conflict(Clause({"dim": "f", "in": ["json", "md"]}, 0),
                    Clause({"dim": "f", "in": ["prose", "md"]}, 1)) is None

    # 7. cross-kind (range vs categorical, same dim) is a separate bucket, never a false conflict.
    rk = solve([
        {"id": "r", "dim": "length", "max": 100},
        {"id": "k", "dim": "length", "is": "short"},
    ])
    assert rk.verdict == "CLEAR", rk.verdict
    assert len(rk.cross_kind) == 1, rk.cross_kind

    # 8. fail-closed spec errors.
    for bad in (
        [{"dim": "x"}],                                   # no constraint
        [{"dim": "x", "min": 5, "is": "y"}],              # mixed kinds
        [{"dim": "x", "min": 10, "max": 5}],              # self-contradictory range
        [{"id": "dup", "dim": "a", "is": 1},
         {"id": "dup", "dim": "b", "is": 2}],             # duplicate id
        [{"min": 5}],                                     # missing dim
    ):
        try:
            solve(bad)
        except ClauseTrellisError:
            pass
        else:
            raise AssertionError(f"expected spec error for {bad!r}")

    sys.stdout.write("clause-trellis selftest: OK (8 checks)\n")
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="clause-trellis",
        description="Lay a prompt's clauses on a grid; find WHICH TWO contradict.",
    )
    parser.add_argument("--selftest", action="store_true",
                        help="run the deterministic self-test and exit")
    sub = parser.add_subparsers(dest="cmd")

    ps = sub.add_parser("solve", help="find contradicting clause pairs in a clauses.json")
    ps.add_argument("clauses", help="path to a JSON array of clauses")

    sub.add_parser("demo", help="solve a small worked prompt")

    args = parser.parse_args(argv)

    if args.selftest:
        return _selftest()
    if args.cmd == "solve":
        return cmd_solve(args.clauses)
    if args.cmd == "demo":
        return cmd_demo()
    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
