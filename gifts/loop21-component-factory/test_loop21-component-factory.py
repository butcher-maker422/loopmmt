#!/usr/bin/env python3
"""test_loop21-component-factory.py — the certifying properties of the factory gift.

Run:  python3 test_loop21-component-factory.py    (exit 0 = all pass, 1 = failure)

MUTATION-BITTEN: each test is here because a plausible mutation of the tool makes
it fail loud. The determinism test pins a GOLDEN sha256 of a seeded batch rather
than checking self-equality — a weak self-equality test passes benign reorders
(the Loop MMT sudoku lesson), a pinned golden does not.
"""
import hashlib
import importlib.util
import io
import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "lcf", os.path.join(_HERE, "loop21-component-factory.py")
)
lcf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(lcf)

# --- pinned goldens: regenerate ONLY on an intentional change ----------------
DEMO_GOLDEN_SHA256 = "ba304b3fd40715875b8298b68dd6281d64844f641263bc7121ce27c35da00a08"
BATCH_GOLDEN_SHA256 = "566171366bffaa9bcfd9001523666585fafe7547f11e3f2851b0cf36288680fe"
CATALOG_KIND_COUNT = 5

_FAILURES: list[str] = []
_PASSES = 0


def check(cond: bool, msg: str) -> None:
    global _PASSES
    if cond:
        _PASSES += 1
    else:
        _FAILURES.append(msg)


def _sha(block: str) -> str:
    return hashlib.sha256(block.encode()).hexdigest()


# --- determinism -------------------------------------------------------------
def test_seeded_demo_reproduces_pinned_golden():
    """The seeded demo output is byte-identical to a pinned sha256, forever."""
    block = lcf.demo(seed=42)
    check(_sha(block) == DEMO_GOLDEN_SHA256,
          f"demo golden drift: got {_sha(block)}")


def test_seeded_batch_reproduces_pinned_golden():
    """A seeded produce() batch is byte-identical to a pinned sha256."""
    reqs = [
        {"kind": "counter", "params": {"start": "5", "step": "3"}},
        {"kind": "accumulator", "params": {"op": "max", "seed": "0"}},
        {"kind": "clamp", "params": {"lo": "-10", "hi": "10"}},
    ]
    specs = lcf.produce(reqs, seed=100)
    block = "\n".join(json.dumps(s, sort_keys=True, ensure_ascii=False) for s in specs)
    check(_sha(block) == BATCH_GOLDEN_SHA256,
          f"batch golden drift: got {_sha(block)}")


def test_same_seed_twice_is_identical():
    """Two runs with the same seed produce identical specs (self-consistency)."""
    reqs = [{"kind": "counter", "params": {}}, {"kind": "toggle", "params": {}}]
    a = lcf.produce(reqs, seed=7)
    b = lcf.produce(reqs, seed=7)
    check(a == b, "same-seed runs diverged")


# --- catalog is a closed, named set ------------------------------------------
def test_catalog_is_the_declared_five_kinds():
    """The catalog holds exactly the five declared component kinds."""
    check(len(lcf.CATALOG) == CATALOG_KIND_COUNT,
          f"catalog size changed: {sorted(lcf.CATALOG)}")
    check(set(lcf.CATALOG) == {"counter", "toggle", "clamp", "accumulator", "pattern-match"},
          f"catalog kinds changed: {sorted(lcf.CATALOG)}")


def test_every_catalog_kind_declares_a_valid_port():
    """Every kind's port is one of the five composition-algebra verbs."""
    valid = {"source", "transform", "filter", "fold", "sink"}
    for kind, entry in lcf.CATALOG.items():
        check(entry["port"] in valid, f"{kind}: bad port {entry['port']!r}")


# --- validation at the door --------------------------------------------------
def test_unknown_kind_refuses():
    """An unknown component kind raises FactoryError, never emits a spec."""
    try:
        lcf.build_spec("frobnicate", "x", {})
        check(False, "unknown kind did not raise")
    except lcf.FactoryError:
        check(True, "")


def test_missing_required_param_refuses():
    """A missing required param (clamp.hi) raises, never emits a spec."""
    try:
        lcf.build_spec("clamp", "c", {"lo": 0})
        check(False, "missing required param did not raise")
    except lcf.FactoryError:
        check(True, "")


def test_unknown_param_refuses():
    """An unknown param raises rather than being silently dropped or emitted."""
    try:
        lcf.build_spec("counter", "c", {"bogus": 5})
        check(False, "unknown param did not raise")
    except lcf.FactoryError:
        check(True, "")


def test_bad_type_refuses():
    """A non-int for an int param raises rather than coercing to garbage."""
    try:
        lcf.build_spec("counter", "c", {"step": "abc"})
        check(False, "bad-type param did not raise")
    except lcf.FactoryError:
        check(True, "")


def test_out_of_choice_refuses():
    """An accumulator op outside the declared choices raises."""
    try:
        lcf.build_spec("accumulator", "a", {"op": "divide"})
        check(False, "out-of-choice op did not raise")
    except lcf.FactoryError:
        check(True, "")


def test_pattern_match_requires_exactly_one_selector():
    """pattern-match with neither equals nor in raises; with both raises."""
    try:
        lcf.build_spec("pattern-match", "p", {"field": "s"})
        check(False, "pattern-match with no selector did not raise")
    except lcf.FactoryError:
        check(True, "")
    try:
        lcf.build_spec("pattern-match", "p", {"field": "s", "equals": "a", "in": "b"})
        check(False, "pattern-match with both selectors did not raise")
    except lcf.FactoryError:
        check(True, "")


# --- spec shape --------------------------------------------------------------
def test_spec_carries_version_and_port():
    """Every emitted spec pins spec_version and declares its port."""
    s = lcf.build_spec("counter", "c", {"start": 0})
    check(s["spec_version"] == lcf.SPEC_VERSION, "spec_version missing/wrong")
    check(s["port"] == "transform", "counter port wrong")
    check(s["component"] == "counter", "component field wrong")


def test_number_type_canonicalizes_integer_floats():
    """A number param given as 3.0 canonicalizes to 3 so JSONL stays stable."""
    s = lcf.build_spec("clamp", "c", {"lo": "0.0", "hi": "100"})
    check(s["params"]["lo"] == 0 and isinstance(s["params"]["lo"], int),
          f"number did not canonicalize: {s['params']['lo']!r}")


def test_bool_coercion_accepts_words_and_refuses_garbage():
    """bool params accept true/false words; garbage raises."""
    s = lcf.build_spec("toggle", "t", {"initial": "true"})
    check(s["params"]["initial"] is True, "bool 'true' not coerced")
    try:
        lcf.build_spec("toggle", "t", {"initial": "maybe"})
        check(False, "garbage bool did not raise")
    except lcf.FactoryError:
        check(True, "")


# --- CLI exit codes ----------------------------------------------------------
def test_cli_bad_request_exits_2():
    """The CLI returns 2 (not 0, not a traceback) on a bad request."""
    rc = lcf.main(["--make", "counter:step=abc"])
    check(rc == 2, f"bad CLI request returned {rc}, want 2")


def test_cli_catalog_and_demo_exit_0():
    """--catalog and --demo both succeed (exit 0)."""
    check(lcf.main(["--catalog"]) == 0, "--catalog did not exit 0")
    check(lcf.main(["--demo"]) == 0, "--demo did not exit 0")


def test_auto_names_are_ordinal_and_seeded():
    """Auto-generated names increment per-kind from the seed, deterministically."""
    specs = lcf.produce(
        [{"kind": "counter", "params": {}}, {"kind": "counter", "params": {}}],
        seed=10,
    )
    check(specs[0]["name"] == "counter-0010", f"first name {specs[0]['name']!r}")
    check(specs[1]["name"] == "counter-0011", f"second name {specs[1]['name']!r}")


def _run() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        try:
            t()
        except Exception as exc:  # a test itself throwing is a failure
            _FAILURES.append(f"{t.__name__} raised {exc!r}")
    total = _PASSES + len(_FAILURES)
    if _FAILURES:
        print(f"FAIL — {_PASSES}/{total} checks passed; {len(_FAILURES)} failure(s):")
        for f in _FAILURES:
            print(f"  ✗ {f}")
        return 1
    print(f"OK — {_PASSES}/{total} checks passed across {len(tests)} tests.")
    return 0


if __name__ == "__main__":
    raise SystemExit(_run())
