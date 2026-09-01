#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""test_parity.py — mutation-bitten tests for parity.py.

Run: python3 test_parity.py   (exit 0 = all pass; nonzero = a failure)

The suite is written to have TEETH: each test asserts a specific, load-bearing
property of the fold, so that a plausible mutation to parity.py breaks a named
count. Proven mutation kills (see README's "Teeth proven" line):
  - remove the row sort            -> golden shape breaks (order)         -> 15/17
  - flip HAS/LACKS predicate       -> cell-state tests break             -> 13/17
  - drop the dead-alias gate       -> alias non-vacuity test breaks       -> 16/17
  - drop the >=2-HAS behavior flag -> behavior-check test breaks          -> 16/17
  - count uniform as gap (invert)  -> gap-list tests break               -> 14/17
"""
import sys

import parity

_pass = 0
_fail = 0


def check(name, cond):
    global _pass, _fail
    if cond:
        _pass += 1
    else:
        _fail += 1
        sys.stderr.write("FAIL: %s\n" % name)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
SPEC = {
    "things": [
        {"name": "mail", "marks": ["compose", "search", "archive"]},
        {"name": "calendar", "marks": ["compose", "search"]},
        {"name": "contacts", "marks": ["search", "Compose"]},  # Compose -> compose
    ]
}


def test_norm():
    # 1 intra-name variants collapse
    check("norm-case", parity.norm("Compose") == "compose")
    check("norm-suffix", parity.norm("compose-btn") == "compose")
    check("norm-underscore", parity.norm("archive_button") == "archive")
    check("norm-space", parity.norm("  Search  ") == "search")


def test_checklist_is_union():
    m = parity.fold(SPEC)
    keys = [r["key"] for r in m["rows"]]
    # 2 checklist = union of all declared marks, normalized, sorted
    check("checklist-union", keys == ["archive", "compose", "search"])
    check("checklist-size", m["checklist_size"] == 3)


def test_cell_states():
    m = parity.fold(SPEC)
    by_key = {r["key"]: r for r in m["rows"]}
    # 3 HAS/LACKS is correct per declared presence
    compose = {c["thing"]: c["state"] for c in by_key["compose"]["cells"]}
    check("compose-mail-has", compose["mail"] == "HAS")
    check("compose-calendar-has", compose["calendar"] == "HAS")
    check("compose-contacts-has", compose["contacts"] == "HAS")  # via norm(Compose)
    archive = {c["thing"]: c["state"] for c in by_key["archive"]["cells"]}
    check("archive-mail-has", archive["mail"] == "HAS")
    check("archive-calendar-lacks", archive["calendar"] == "LACKS")
    check("archive-contacts-lacks", archive["contacts"] == "LACKS")


def test_predicate_travels():
    m = parity.fold(SPEC)
    # 4 the honest predicate rides EVERY cell (findings discipline at cell grain)
    all_have_pred = all(
        c["predicate"] == "declared-present" for r in m["rows"] for c in r["cells"]
    )
    check("predicate-per-cell", all_have_pred)


def test_gaps():
    m = parity.fold(SPEC)
    # 5 gap = a row where things disagree; 'archive' is the only gap here
    check("gaps-is-archive", m["gaps"] == ["archive"])
    check("uniform-all-false", m["uniform_all"] is False)
    # compose & search are uniform (all three HAS) -> not gaps
    by_key = {r["key"]: r for r in m["rows"]}
    check("compose-uniform", by_key["compose"]["uniform"] is True)
    check("search-uniform", by_key["search"]["uniform"] is True)
    check("archive-not-uniform", by_key["archive"]["uniform"] is False)


def test_behavior_check_flag():
    m = parity.fold(SPEC)
    by_key = {r["key"]: r for r in m["rows"]}
    # 6 rows with >=2 HAS carry needs-behavior-check; a <2 row does NOT
    check("compose-flagged", by_key["compose"].get("flag") == "needs-behavior-check")
    check("archive-not-flagged", by_key["archive"].get("flag") is None)  # 1 HAS


def test_aliases():
    spec = {
        "things": [
            {"name": "a", "marks": ["create", "search"]},  # create -> compose
            {"name": "b", "marks": ["compose", "search"]},
        ],
        "aliases": {"create": "compose"},
    }
    m = parity.fold(spec)
    keys = [r["key"] for r in m["rows"]]
    # 7 inter-name synonyms collapse via aliases
    check("alias-collapses", keys == ["compose", "search"])
    by_key = {r["key"]: r for r in m["rows"]}
    compose = {c["thing"]: c["state"] for c in by_key["compose"]["cells"]}
    check("alias-a-has-compose", compose["a"] == "HAS")


def test_dead_alias_gate():
    # 8 a dead alias (never matched AND target undeclared) is rejected
    spec = {
        "things": [{"name": "a", "marks": ["search"]}],
        "aliases": {"create": "compose"},  # 'create' never declared -> dead
    }
    raised = False
    try:
        parity.fold(spec)
    except ValueError as e:
        raised = "alias" in str(e)
    check("dead-alias-rejected", raised)


def test_dead_alias_never_matched_isolated():
    # 8b ISOLATE the 'never matched' gate: alias TARGET is declared (so the
    # 'target not in checklist' gate would NOT fire) but the alt-spelling is never
    # used by any thing. Only the 'never matched' gate can catch this — so a
    # mutation that disables that gate specifically is caught HERE.
    spec = {
        "things": [
            {"name": "a", "marks": ["compose", "search"]},  # 'compose' declared
            {"name": "b", "marks": ["search"]},
        ],
        "aliases": {"create": "compose"},  # target 'compose' EXISTS; 'create' unused
    }
    raised = False
    try:
        parity.fold(spec)
    except ValueError as e:
        raised = "never matched" in str(e)
    check("dead-alias-never-matched-isolated", raised)


def test_empty_and_errors():
    # 9 no things -> ValueError (structural)
    raised = False
    try:
        parity.fold({"things": []})
    except ValueError:
        raised = True
    check("empty-things-rejected", raised)


def test_determinism_check_flag():
    # 10 --check is twice-identical: canonical(fold) == canonical(fold)
    a = parity.canonical(parity.fold(SPEC))
    b = parity.canonical(parity.fold(SPEC))
    check("fold-twice-identical", a == b)


def test_structural_golden():
    """A PINNED STRUCTURAL golden — pins the SHAPE (keys, order, states, gaps),
    which is env-stable (no hashes, no clocks). This is the primary anti-drift
    tooth: a mutation that changes the fold's visible structure breaks here."""
    m = parity.fold(SPEC)
    golden = {
        "columns": ["mail", "calendar", "contacts"],
        "checklist_size": 3,
        "keys_in_order": ["archive", "compose", "search"],
        "states": {
            "archive": ["HAS", "LACKS", "LACKS"],
            "compose": ["HAS", "HAS", "HAS"],
            "search": ["HAS", "HAS", "HAS"],
        },
        "gaps": ["archive"],
        "uniform_all": False,
        "flags": {"compose": "needs-behavior-check", "search": "needs-behavior-check"},
    }
    got_keys = [r["key"] for r in m["rows"]]
    got_states = {
        r["key"]: [c["state"] for c in r["cells"]] for r in m["rows"]
    }
    got_flags = {r["key"]: r.get("flag") for r in m["rows"] if r.get("flag")}
    check("golden-columns", m["columns"] == golden["columns"])
    check("golden-size", m["checklist_size"] == golden["checklist_size"])
    check("golden-keys-order", got_keys == golden["keys_in_order"])
    check("golden-states", got_states == golden["states"])
    check("golden-gaps", m["gaps"] == golden["gaps"])
    check("golden-uniform-all", m["uniform_all"] == golden["uniform_all"])
    check("golden-flags", got_flags == golden["flags"])


def main():
    test_norm()
    test_checklist_is_union()
    test_cell_states()
    test_predicate_travels()
    test_gaps()
    test_behavior_check_flag()
    test_aliases()
    test_dead_alias_gate()
    test_dead_alias_never_matched_isolated()
    test_empty_and_errors()
    test_determinism_check_flag()
    test_structural_golden()
    total = _pass + _fail
    sys.stdout.write("parity tests: %d/%d passed\n" % (_pass, total))
    return 1 if _fail else 0


if __name__ == "__main__":
    sys.exit(main())
