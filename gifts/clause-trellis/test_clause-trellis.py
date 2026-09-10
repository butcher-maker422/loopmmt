#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""External test battery for clause-trellis.py.

Run:  python3 test_clause-trellis.py
Exit: 0 = all pass, 1 = a failure (with the first failing assertion named).

These tests are the golden corpus. Their known-bad half is drawn from the real defect
this gift exists to catch: a prompt that grew two clauses pulling against each other on
the same dimension. Each test is a claim whose name IS the behavior it proves.
"""
import importlib.util
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_SPEC = importlib.util.spec_from_file_location(
    "clause_trellis", os.path.join(_HERE, "clause-trellis.py"))
ct = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(ct)

_failures = []


def check(name, cond):
    if cond:
        print(f"  ok   {name}")
    else:
        print(f"  FAIL {name}")
        _failures.append(name)


def check_raises(name, fn):
    try:
        fn()
    except ct.ClauseTrellisError:
        print(f"  ok   {name}")
    except Exception as exc:  # noqa: BLE001
        print(f"  FAIL {name} (wrong error: {type(exc).__name__})")
        _failures.append(name)
    else:
        print(f"  FAIL {name} (no error raised)")
        _failures.append(name)


# --- CLEAR cases -------------------------------------------------------------

def test_empty_prompt_is_clear():
    r = ct.solve([])
    check("empty clause set is CLEAR", r.verdict == "CLEAR" and r.clause_count == 0)


def test_single_clause_is_clear():
    r = ct.solve([{"id": "only", "dim": "length", "max": 100}])
    check("a single clause cannot contradict itself", r.verdict == "CLEAR")


def test_compatible_ranges_are_clear():
    r = ct.solve([
        {"id": "floor", "dim": "length", "min": 100},
        {"id": "ceil", "dim": "length", "max": 500},
    ])
    check("a min below a max on one dimension is CLEAR", r.verdict == "CLEAR")


def test_orthogonal_dimensions_never_conflict():
    r = ct.solve([
        {"id": "len", "dim": "length", "max": 50},
        {"id": "fmt", "dim": "format", "is": "json"},
        {"id": "tone", "dim": "tone", "is": "curt"},
    ])
    check("clauses on different dimensions never conflict", r.verdict == "CLEAR")


# --- CONTRADICTORY cases (the real defect) -----------------------------------

def test_brevity_vs_thoroughness_localizes():
    r = ct.solve([
        {"id": "brief", "dim": "length", "max": 200},
        {"id": "full", "dim": "length", "min": 500},
    ])
    check("disjoint length ranges are CONTRADICTORY", r.verdict == "CONTRADICTORY")
    check("the contradiction is located to the (brief, full) cell",
          len(r.conflicts) == 1 and r.conflicts[0]["row"] == "brief"
          and r.conflicts[0]["col"] == "full")


def test_format_categoricals_localize():
    r = ct.solve([
        {"id": "json", "dim": "format", "is": "json"},
        {"id": "prose", "dim": "format", "in": ["prose", "markdown"]},
    ])
    check("disjoint format categoricals are CONTRADICTORY", r.verdict == "CONTRADICTORY")
    check("the format conflict names its dimension", r.conflicts[0]["dim"] == "format")


def test_multiple_contradictions_all_reported():
    r = ct.solve([
        {"id": "brief", "dim": "length", "max": 200},
        {"id": "full", "dim": "length", "min": 500},
        {"id": "json", "dim": "format", "is": "json"},
        {"id": "prose", "dim": "format", "is": "prose"},
    ])
    check("two independent contradictions are both reported", len(r.conflicts) == 2)


def test_three_way_clash_reports_each_pair():
    # length constrained three ways: <=100, >=200, exactly [50,60] -> two disjoint pairs vs the >=200
    r = ct.solve([
        {"id": "a", "dim": "length", "max": 100},
        {"id": "b", "dim": "length", "min": 200},
        {"id": "c", "dim": "length", "min": 50, "max": 60},
    ])
    pairs = {(x["row"], x["col"]) for x in r.conflicts}
    check("a x b clash reported", ("a", "b") in pairs)
    check("b x c clash reported", ("b", "c") in pairs)
    check("a x c (both small) do NOT clash", ("a", "c") not in pairs)


# --- boundary behavior -------------------------------------------------------

def test_touching_ranges_do_not_conflict():
    r = ct.solve([
        {"id": "lo", "dim": "n", "min": 200},
        {"id": "hi", "dim": "n", "max": 200},
    ])
    check("ranges that touch at a single point overlap (no conflict)", r.verdict == "CLEAR")


def test_gap_of_one_conflicts():
    r = ct.solve([
        {"id": "lo", "dim": "n", "min": 201},
        {"id": "hi", "dim": "n", "max": 200},
    ])
    check("ranges separated by a gap conflict", r.verdict == "CONTRADICTORY")


def test_cross_kind_is_its_own_bucket():
    r = ct.solve([
        {"id": "r", "dim": "length", "max": 100},
        {"id": "k", "dim": "length", "is": "short"},
    ])
    check("range vs categorical on same dim is NOT a conflict", r.verdict == "CLEAR")
    check("range vs categorical is reported as cross-kind", len(r.cross_kind) == 1)


# --- determinism -------------------------------------------------------------

def test_result_is_deterministic():
    import json
    spec = [
        {"id": "z", "dim": "format", "is": "json"},
        {"id": "a", "dim": "format", "is": "prose"},
        {"id": "m", "dim": "length", "max": 10},
        {"id": "n", "dim": "length", "min": 20},
    ]
    a = json.dumps(ct.solve(spec).to_dict(), sort_keys=True)
    b = json.dumps(ct.solve(spec).to_dict(), sort_keys=True)
    check("two folds of one spec are byte-identical", a == b)


def test_conflicts_sorted_canonically():
    # inputs given out of order; conflicts must come back sorted by (row, col)
    r = ct.solve([
        {"id": "zeta", "dim": "x", "min": 500},
        {"id": "alpha", "dim": "x", "max": 100},
        {"id": "mu", "dim": "y", "is": "p"},
        {"id": "beta", "dim": "y", "is": "q"},
    ])
    rows = [(c["row"], c["col"]) for c in r.conflicts]
    check("conflicts are emitted in canonical sorted order", rows == sorted(rows))
    check("each pair is stored low-id-first",
          all(c["row"] <= c["col"] for c in r.conflicts))


# --- fail-closed spec errors -------------------------------------------------

def test_missing_dim_fails_closed():
    check_raises("a clause with no dim is a spec error", lambda: ct.solve([{"min": 5}]))


def test_no_constraint_fails_closed():
    check_raises("a clause with no constraint is a spec error", lambda: ct.solve([{"dim": "x"}]))


def test_mixed_kinds_fails_closed():
    check_raises("a clause mixing range and categorical is a spec error",
                 lambda: ct.solve([{"dim": "x", "min": 5, "is": "y"}]))


def test_self_contradictory_range_fails_closed():
    check_raises("a clause with min > max is a spec error",
                 lambda: ct.solve([{"dim": "x", "min": 10, "max": 5}]))


def test_duplicate_id_fails_closed():
    check_raises("duplicate clause ids are a spec error",
                 lambda: ct.solve([{"id": "d", "dim": "a", "is": 1},
                                   {"id": "d", "dim": "b", "is": 2}]))


def test_non_array_fails_closed():
    check_raises("a non-array clause set is a spec error",
                 lambda: ct.solve({"not": "a list"}))


def test_behavioral_asserts_on_return_state():
    # Bare asserts on solve()'s RETURN OBJECT (not stdout prose) -- these bite the
    # load-bearing behavior directly: delete the behavior and these fail.
    r = ct.solve([{"id": "a", "dim": "length", "max": 100},
                  {"id": "b", "dim": "length", "min": 500}])
    assert r.verdict == "CONTRADICTORY", r.verdict
    assert r.conflicts[0]["row"] == "a" and r.conflicts[0]["col"] == "b", r.conflicts
    assert r.clause_count == 2, r.clause_count
    clear = ct.solve([{"id": "x", "dim": "n", "max": 10}])
    assert clear.verdict == "CLEAR", clear.verdict
    assert clear.conflicts == [], clear.conflicts
    cross = ct.solve([{"id": "r", "dim": "d", "max": 5},
                      {"id": "k", "dim": "d", "is": "s"}])
    assert cross.verdict == "CLEAR" and len(cross.cross_kind) == 1, cross.to_dict()
    print("  ok   behavioral asserts on solve() return state")


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    print(f"clause-trellis: running {len(tests)} tests")
    for t in tests:
        t()
    print()
    if _failures:
        print(f"FAILED: {len(_failures)} check(s): {', '.join(_failures)}")
        return 1
    print("ALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
