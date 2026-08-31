#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""
Mutation-bitten test for the declare gift.

GOLDEN — the behavior contract: the fold is deterministic, stages keep their
order (never sorted), the key order is fixed, note is conditional, shape
validation catches the real problems, and a canonical score is a fixpoint.

MUTATION BATTERY — each load-bearing predicate is flipped in a copy of the
module; a correct suite turns at least one golden check RED for each. A mutation
nothing catches is a test hole (this file fails loud on it). Predicates are
isolated on purpose — the sibling typecheck gift taught this line that a golden
set which only checks the aggregate lets endpoint/conjunct mutations escape.
"""
import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODPATH = HERE / "declare.py"


def _load_module(src_text=None):
    spec = importlib.util.spec_from_file_location("declare_under_test", MODPATH)
    mod = importlib.util.module_from_spec(spec)
    if src_text is None:
        spec.loader.exec_module(mod)
    else:
        exec(compile(src_text, str(MODPATH), "exec"), mod.__dict__)
    return mod


def golden_checks(m):
    out = []

    # Determinism: same inputs -> same bytes.
    a = m.score_to_bytes(m.canonical_score("p", ["gitlog", "vclock", "cairn"]))
    b = m.score_to_bytes(m.canonical_score("p", ["gitlog", "vclock", "cairn"]))
    out.append(("fold is deterministic (same bytes)", a == b))

    # Stages preserve order — isolated: a reversed input stays reversed.
    s = m.canonical_score("p", ["cairn", "gitlog", "vclock"])
    out.append(("stages NOT sorted (order preserved)", s["stages"] == ["cairn", "gitlog", "vclock"]))

    # A distinct order test that WOULD pass if stages were sorted — pins it hard.
    s2 = m.canonical_score("p", ["b", "a"])
    out.append(("stages ['b','a'] stay ['b','a'] not ['a','b']", s2["stages"] == ["b", "a"]))

    # Fixed key order.
    out2 = m.score_to_bytes(m.canonical_score("p", ["a", "b"]))
    out.append(("key order kind<name<stages",
                out2.index('"kind"') < out2.index('"name"') < out2.index('"stages"')))

    # Note conditional — isolate both directions.
    out.append(("note omitted when empty", "note" not in m.canonical_score("p", ["a"])))
    out.append(("note present when given", m.canonical_score("p", ["a"], "hi").get("note") == "hi"))

    # Shape validation — isolate EACH problem so a disabled clause is caught.
    out.append(("empty stages -> problem", m.validate_shape("p", []) != []))
    out.append(("no name -> problem", m.validate_shape("", ["a"]) != []))
    out.append(("empty stage slug -> problem", m.validate_shape("p", ["a", ""]) != []))
    out.append(("good score -> no problem", m.validate_shape("p", ["a", "b"]) == []))

    # Canonical fixpoint.
    canon = m.score_to_bytes(m.canonical_score("p", ["a", "b"], "n"))
    import json as _j
    out.append(("canonical score is a fixpoint", canon == m.score_to_bytes(_j.loads(canon))))

    # kind is always the gift-score tag.
    out.append(("kind is 'gift-score'", m.canonical_score("p", ["a"])["kind"] == "gift-score"))

    return out


MUTATIONS = [
    ("stages sorted (order destroyed)", '"stages": list(stages),', '"stages": sorted(stages),'),
    ("name validation disabled", 'if not name or not str(name).strip():', 'if False:'),
    ("empty-stages check disabled", 'if not stages:', 'if False:'),
    ("empty-stage-slug check disabled",
     'if not s or not str(s).strip():', 'if False:'),
    ("note always included",
     'if note:\n        score["note"] = note', 'score["note"] = note'),
    ("kind tag wrong", '        "kind": "gift-score",', '        "kind": "wrong",'),
    ("key order broken (name before kind)",
     'for k in ("kind", "name", "stages", "note"):',
     'for k in ("name", "kind", "stages", "note"):'),
]


def run():
    show = "--show" in sys.argv
    src = MODPATH.read_text()

    base = _load_module()
    gold = golden_checks(base)
    gold_ok = all(ok for _, ok in gold)
    if show or not gold_ok:
        for name, ok in gold:
            print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    print(f"GOLDEN: {sum(ok for _, ok in gold)}/{len(gold)} passed")
    if not gold_ok:
        print("GOLDEN FAILED — the gift is broken, not the test.")
        return 1

    all_caught = True
    for name, find, repl in MUTATIONS:
        if find not in src:
            print(f"  BITE-BROKEN  {name}: anchor not found — test is stale")
            all_caught = False
            continue
        mutated = src.replace(find, repl, 1)
        try:
            res = golden_checks(_load_module(mutated))
            caught = any(not ok for _, ok in res)
        except Exception:
            caught = True
        mark = "caught" if caught else "ESCAPED"
        if show or not caught:
            print(f"  {mark:8s} mutation: {name}")
        if not caught:
            all_caught = False

    print(f"MUTATIONS: {sum(1 for n, f, r in MUTATIONS if f in src)}/{len(MUTATIONS)} biteable; "
          f"{'ALL CAUGHT' if all_caught else 'SOME ESCAPED'}")
    return 0 if (gold_ok and all_caught) else 1


if __name__ == "__main__":
    sys.exit(run())
