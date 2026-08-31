#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""
Mutation-bitten test for the typecheck gift.

Two halves:
  1. GOLDEN — the behavior contract: clean pipelines pass, broken pipelines
     fail at the right hop/stage, unresolved slugs are flagged not guessed,
     conformsTo is flat at seed.
  2. MUTATION BATTERY — each load-bearing predicate is flipped in a copy of the
     module and the golden checks are re-run; the suite is only meaningful if
     every mutation is CAUGHT (turns some golden check RED). A mutation that
     nothing catches is a hole in the test, and this file fails loud on it.

Run:  python3 test_typecheck.py        (asserts golden green + every bite caught)
      python3 test_typecheck.py --show (verbose)
"""
import copy
import importlib.util
import sys
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODPATH = HERE / "typecheck.py"


def _load_module(src_text=None):
    """Load typecheck.py fresh (optionally from mutated source text)."""
    spec = importlib.util.spec_from_file_location("typecheck_under_test", MODPATH)
    mod = importlib.util.module_from_spec(spec)
    if src_text is None:
        spec.loader.exec_module(mod)
    else:
        code = compile(src_text, str(MODPATH), "exec")
        exec(code, mod.__dict__)
    return mod


VERBS = {
    "src": "source", "xf": "transform", "flt": "filter",
    "fold": "fold", "snk": "sink",
}


def golden_checks(m):
    """Return a list of (name, bool) — the behavior contract, evaluated on module m."""
    out = []

    hops, ok = m.typecheck_pipeline(["src", "xf", "snk"], VERBS)
    out.append(("clean src->xf->snk typechecks", ok is True))

    hops, ok = m.typecheck_pipeline(["src", "snk", "xf"], VERBS)
    out.append(("sink-in-middle fails", ok is False))

    hops, ok = m.typecheck_pipeline(["src", "src", "snk"], VERBS)
    out.append(("source-in-middle fails", ok is False))

    hops, ok = m.typecheck_pipeline(["src", "snk", "xf"], VERBS)
    bad = [h for h in hops if h["kind"] == "hop" and not h["typechecks"]]
    out.append(("bad hop is exactly snk->xf",
                len(bad) == 1 and bad[0]["from"] == "snk" and bad[0]["to"] == "xf"))

    hops, ok = m.typecheck_pipeline(["src", "ghost", "snk"], VERBS)
    stage = [h for h in hops if h["kind"] == "stage" and h["slug"] == "ghost"][0]
    out.append(("unresolved slug fails and verb is None",
                ok is False and stage["verb"] is None))

    hops, ok = m.typecheck_pipeline(["xf", "flt", "fold"], VERBS)
    out.append(("all-middle-legal xf->flt->fold typechecks", ok is True))

    hops, ok = m.typecheck_pipeline(["snk", "xf"], VERBS)
    out.append(("sink as FIRST stage fails (emits nothing downstream)", ok is False))

    hops, ok = m.typecheck_pipeline(["xf", "src"], VERBS)
    out.append(("source as LAST stage fails (ignores its input)", ok is False))

    # Isolate the STAGE-ROLE verdict (not just the aggregate ok) — a sink in the
    # middle must set role_ok False on that stage, independent of the hop gate.
    hops, ok = m.typecheck_pipeline(["src", "snk", "xf"], VERBS)
    snk_stage = [h for h in hops if h["kind"] == "stage" and h["slug"] == "snk"][0]
    out.append(("sink-middle stage role_ok is False (endpoint EMITS rule)", snk_stage["role_ok"] is False))

    # And a source in the middle must set role_ok False on THAT stage (endpoint
    # ACCEPTS rule) — isolated the same way.
    hops, ok = m.typecheck_pipeline(["src", "src", "snk"], VERBS)
    mid_src = [h for h in hops if h["kind"] == "stage" and h["pos"] == 1][0]
    out.append(("source-middle stage role_ok is False (endpoint ACCEPTS rule)", mid_src["role_ok"] is False))

    # A hop that is bad ONLY on the ACCEPTS side: xf (emits) -> src (a source in
    # a non-first slot ignores stdin). The HOP itself must fail on accept, which
    # pins the ACCEPTS conjunct in the gate independently of the emit side.
    hops, ok = m.typecheck_pipeline(["xf", "src", "snk"], VERBS)
    accept_hop = [h for h in hops if h["kind"] == "hop" and h["from"] == "xf" and h["to"] == "src"][0]
    out.append(("hop bad only on ACCEPTS side (xf->src) fails the gate", accept_hop["typechecks"] is False))

    out.append(("conformsTo flat: nominal only",
                m.conformsTo("transform", "transform") and not m.conformsTo("filter", "transform")))
    out.append(("conformsTo empty-required True", m.conformsTo("x", "") is True))

    out.append(("EMITS(sink) False / EMITS(source) True", (m.EMITS("sink") is False) and (m.EMITS("source") is True)))
    out.append(("ACCEPTS(source) False / ACCEPTS(sink) True", (m.ACCEPTS("source") is False) and (m.ACCEPTS("sink") is True)))

    return out


# Each mutation is a (name, find, replace) source edit that BREAKS a load-bearing
# predicate. A correct test suite turns at least one golden check RED for each.
MUTATIONS = [
    ("EMITS always True", 'return v != "sink"', "return True"),
    ("ACCEPTS always True", 'return v != "source"', "return True"),
    ("EMITS inverted", 'return v != "sink"', 'return v == "sink"'),
    ("conformsTo always True", "return candidate in subtypes(required)", "return True"),
    ("endpoint ACCEPTS check disabled",
     'if pos in ("middle", "last") and not ACCEPTS(verb):',
     'if False and pos in ("middle", "last") and not ACCEPTS(verb):'),
    ("endpoint EMITS check disabled",
     'if pos in ("first", "middle") and not EMITS(verb):',
     'if False and pos in ("first", "middle") and not EMITS(verb):'),
    ("unresolved slug silently guessed transform",
     "verb = verbs.get(slug)",
     'verb = verbs.get(slug) or "transform"'),
    ("gate ignores ACCEPTS", "passes = emits and accepts", "passes = emits"),
]


def run():
    show = "--show" in sys.argv
    src = MODPATH.read_text()

    # Half 1 — golden must be all-green on the real module.
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

    # Half 2 — every mutation must be caught (turn >=1 golden check RED).
    all_caught = True
    for name, find, repl in MUTATIONS:
        if find not in src:
            print(f"  BITE-BROKEN  {name}: anchor not found in source — test is stale")
            all_caught = False
            continue
        mutated = src.replace(find, repl, 1)
        try:
            mut_mod = _load_module(mutated)
            res = golden_checks(mut_mod)
            caught = any(not ok for _, ok in res)
        except Exception:
            # A mutation that makes the module explode is also 'caught'.
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
