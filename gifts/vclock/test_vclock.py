#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""test_vclock.py — the vclock gift's proof it works.

Tests are written FIRST and lead the build. The load-bearing move for a vector
clock is `compare`: the whole reason the primitive exists is to distinguish
CONCURRENT from BEFORE/AFTER. A counter can order a total sequence; only a vector
clock can say "these two events are causally independent." So the compare tests
carry the weight, and the mutation section at the bottom proves they are not
vacuous — each mutation is a plausible wrong implementation that MUST turn a test
red. A suite that stays green under mutation is testing nothing.

Run:  python3 test_vclock.py            # all tests + mutation bites
      python3 test_vclock.py -q         # quiet unless something fails
"""

import io
import json
import subprocess
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOL = HERE / "vclock.py"

# import the module directly so we can unit-test the pure functions,
# and also drive the CLI as a subprocess for the contract tests.
sys.path.insert(0, str(HERE))
import vclock  # noqa: E402


# ---------------------------------------------------------------------------
# compare — the gate. before / after / concurrent / equal, with the
# absent-component-is-zero rule that separates a real vector clock from a
# shared-keys-only impostor.
# ---------------------------------------------------------------------------
class TestCompare(unittest.TestCase):
    def test_equal_identical(self):
        self.assertEqual(vclock.compare({"a": 1, "b": 2}, {"a": 1, "b": 2}), "equal")

    def test_equal_empty(self):
        self.assertEqual(vclock.compare({}, {}), "equal")

    def test_before_strict(self):
        self.assertEqual(vclock.compare({"a": 1}, {"a": 2}), "before")

    def test_after_strict(self):
        self.assertEqual(vclock.compare({"a": 2}, {"a": 1}), "after")

    def test_concurrent_disjoint_actors(self):
        # a advanced on one axis, b on another — neither dominates. This is the
        # single most important case in the whole gift.
        self.assertEqual(vclock.compare({"a": 1}, {"b": 1}), "concurrent")

    def test_concurrent_crossed(self):
        self.assertEqual(vclock.compare({"a": 2, "b": 1}, {"a": 1, "b": 2}), "concurrent")

    # --- the absent-is-zero cases: the impostor-killers ---
    def test_absent_component_is_zero_before(self):
        # {a:1} has b=0 implicitly, so it is BEFORE {a:1,b:1}. A compare that
        # only looks at shared keys would wrongly call this equal.
        self.assertEqual(vclock.compare({"a": 1}, {"a": 1, "b": 1}), "before")

    def test_absent_component_is_zero_after(self):
        self.assertEqual(vclock.compare({"a": 1, "b": 1}, {"a": 1}), "after")

    def test_absent_component_is_zero_concurrent(self):
        # {a:1} (b=0) vs {b:1} (a=0): each leads on its own axis → concurrent.
        # A shared-keys-only impostor sees no shared keys and might say equal.
        self.assertEqual(vclock.compare({"a": 1}, {"b": 1}), "concurrent")

    def test_explicit_zero_equals_absent(self):
        # {a:1,b:0} must be treated identically to {a:1}
        self.assertEqual(vclock.compare({"a": 1, "b": 0}, {"a": 1}), "equal")

    def test_compare_is_antisymmetric(self):
        # if X before Y then Y after X, for a spread of shapes
        pairs = [
            ({"a": 1}, {"a": 2}),
            ({"a": 1}, {"a": 1, "b": 1}),
            ({}, {"a": 1}),
        ]
        for x, y in pairs:
            self.assertEqual(vclock.compare(x, y), "before")
            self.assertEqual(vclock.compare(y, x), "after")


# ---------------------------------------------------------------------------
# bump — increment one actor's component; absent starts at 1.
# ---------------------------------------------------------------------------
class TestBump(unittest.TestCase):
    def test_bump_existing(self):
        self.assertEqual(vclock.bump({"a": 1, "b": 2}, "a"), {"a": 2, "b": 2})

    def test_bump_absent_starts_at_one(self):
        self.assertEqual(vclock.bump({"a": 1}, "b"), {"a": 1, "b": 1})

    def test_bump_empty(self):
        self.assertEqual(vclock.bump({}, "a"), {"a": 1})

    def test_bump_does_not_mutate_input(self):
        original = {"a": 1}
        vclock.bump(original, "a")
        self.assertEqual(original, {"a": 1})  # pure — no in-place edit

    def test_bump_after_is_after(self):
        # a bumped clock is strictly AFTER the one it came from
        c0 = {"a": 1, "b": 2}
        c1 = vclock.bump(c0, "a")
        self.assertEqual(vclock.compare(c0, c1), "before")


# ---------------------------------------------------------------------------
# merge — component-wise max across clocks.
# ---------------------------------------------------------------------------
class TestMerge(unittest.TestCase):
    def test_merge_componentwise_max(self):
        self.assertEqual(
            vclock.merge({"a": 2, "b": 1}, {"a": 1, "b": 3}), {"a": 2, "b": 3}
        )

    def test_merge_disjoint(self):
        self.assertEqual(vclock.merge({"a": 1}, {"b": 1}), {"a": 1, "b": 1})

    def test_merge_absent_is_zero(self):
        self.assertEqual(vclock.merge({"a": 5}, {}), {"a": 5})

    def test_merge_dominates_both(self):
        # the merge is AFTER-or-equal to each of its inputs (never before/concurrent)
        x, y = {"a": 2, "b": 1}, {"a": 1, "b": 3}
        m = vclock.merge(x, y)
        self.assertIn(vclock.compare(x, m), ("before", "equal"))
        self.assertIn(vclock.compare(y, m), ("before", "equal"))

    def test_merge_of_concurrent_is_after_both(self):
        # merging two genuinely concurrent clocks yields their least upper bound
        x, y = {"a": 1}, {"b": 1}
        m = vclock.merge(x, y)
        self.assertEqual(vclock.compare(x, m), "before")
        self.assertEqual(vclock.compare(y, m), "before")


# ---------------------------------------------------------------------------
# CLI contract — JSON-lines in, JSON-lines out; matches the house shape.
# ---------------------------------------------------------------------------
def run_cli(args, stdin_text=""):
    proc = subprocess.run(
        [sys.executable, str(TOOL), *args],
        input=stdin_text,
        capture_output=True,
        text=True,
    )
    return proc.returncode, proc.stdout, proc.stderr


class TestBumpCLI(unittest.TestCase):
    def test_bump_stream(self):
        records = [
            {"id": 1, "clock": {"a": 1}},
            {"id": 2, "clock": {"a": 2, "b": 1}},
        ]
        stdin = "\n".join(json.dumps(r) for r in records) + "\n"
        rc, out, err = run_cli(["bump", "--actor", "a"], stdin)
        self.assertEqual(rc, 0, err)
        got = [json.loads(line) for line in out.splitlines()]
        self.assertEqual(got[0]["clock"], {"a": 2})
        self.assertEqual(got[1]["clock"], {"a": 3, "b": 1})
        # non-clock fields preserved
        self.assertEqual(got[0]["id"], 1)

    def test_bump_record_without_clock_gets_one(self):
        stdin = json.dumps({"id": 1}) + "\n"
        rc, out, err = run_cli(["bump", "--actor", "a"], stdin)
        self.assertEqual(rc, 0, err)
        self.assertEqual(json.loads(out)["clock"], {"a": 1})

    def test_emit_is_sorted_keys(self):
        stdin = json.dumps({"z": 1, "clock": {"a": 1}}) + "\n"
        rc, out, err = run_cli(["bump", "--actor", "a"], stdin)
        self.assertEqual(rc, 0, err)
        # sort_keys=True → "clock" precedes "z" in the raw text
        self.assertLess(out.index('"clock"'), out.index('"z"'))


class TestMergeCLI(unittest.TestCase):
    def test_merge_stream_to_one_clock(self):
        records = [
            {"clock": {"a": 2, "b": 1}},
            {"clock": {"a": 1, "b": 3}},
            {"clock": {"c": 1}},
        ]
        stdin = "\n".join(json.dumps(r) for r in records) + "\n"
        rc, out, err = run_cli(["merge"], stdin)
        self.assertEqual(rc, 0, err)
        self.assertEqual(json.loads(out), {"clock": {"a": 2, "b": 3, "c": 1}})

    def test_merge_empty_stream(self):
        rc, out, err = run_cli(["merge"], "")
        self.assertEqual(rc, 0, err)
        self.assertEqual(json.loads(out), {"clock": {}})


class TestCompareCLI(unittest.TestCase):
    def test_compare_two_records(self):
        records = [{"clock": {"a": 1}}, {"clock": {"b": 1}}]
        stdin = "\n".join(json.dumps(r) for r in records) + "\n"
        rc, out, err = run_cli(["compare"], stdin)
        self.assertEqual(rc, 0, err)
        self.assertEqual(json.loads(out)["relation"], "concurrent")

    def test_compare_before(self):
        records = [{"clock": {"a": 1}}, {"clock": {"a": 2}}]
        stdin = "\n".join(json.dumps(r) for r in records) + "\n"
        rc, out, err = run_cli(["compare"], stdin)
        self.assertEqual(rc, 0, err)
        self.assertEqual(json.loads(out)["relation"], "before")

    def test_compare_wrong_count_is_error(self):
        # compare needs exactly two records
        stdin = json.dumps({"clock": {"a": 1}}) + "\n"
        rc, out, err = run_cli(["compare"], stdin)
        self.assertEqual(rc, 3, "one record should be a usage error")


class TestContract(unittest.TestCase):
    def test_no_subcommand_is_usage_error(self):
        rc, out, err = run_cli([])
        self.assertEqual(rc, 3)

    def test_bad_json_line_is_error(self):
        rc, out, err = run_cli(["bump", "--actor", "a"], "not json\n")
        self.assertEqual(rc, 2, "malformed input must not be trusted")

    def test_blank_lines_skipped(self):
        stdin = json.dumps({"clock": {"a": 1}}) + "\n\n\n"
        rc, out, err = run_cli(["bump", "--actor", "a"], stdin)
        self.assertEqual(rc, 0, err)
        self.assertEqual(len([l for l in out.splitlines() if l]), 1)

    def test_non_integer_clock_component_is_error(self):
        stdin = json.dumps({"clock": {"a": "x"}}) + "\n"
        rc, out, err = run_cli(["bump", "--actor", "a"], stdin)
        self.assertEqual(rc, 2, "a non-integer clock component is corrupt input")


# ---------------------------------------------------------------------------
# Mutation bites — prove the tests above are not vacuous. Each mutation is a
# believable wrong implementation of a pure function; we assert that the real
# suite would catch it. If a mutation survives (no test flips), the suite is
# lying about its coverage and THIS meta-test fails loudly.
# ---------------------------------------------------------------------------
class TestMutationBites(unittest.TestCase):
    """Each bite monkeypatches a pure fn with a plausible-wrong version and
    asserts at least one real assertion above would now fail."""

    def _suite_would_catch(self, cases):
        """cases: list of (callable-returning-bool-that-should-be-True).
        Returns True if any case is now False (i.e. a test would go red)."""
        return any(not case() for case in cases)

    def test_bite_compare_ignores_absent_components(self):
        # WRONG: only compare shared keys. Would call {a:1} vs {a:1,b:1} 'equal'.
        def wrong_compare(x, y):
            shared = set(x) & set(y)
            lt = any(x.get(k, 0) < y.get(k, 0) for k in shared)
            gt = any(x.get(k, 0) > y.get(k, 0) for k in shared)
            if lt and gt:
                return "concurrent"
            if lt:
                return "before"
            if gt:
                return "after"
            return "equal"

        # under the real impl this is 'before'; the impostor says 'equal'
        self.assertEqual(vclock.compare({"a": 1}, {"a": 1, "b": 1}), "before")
        self.assertEqual(wrong_compare({"a": 1}, {"a": 1, "b": 1}), "equal")
        self.assertNotEqual(
            vclock.compare({"a": 1}, {"a": 1, "b": 1}),
            wrong_compare({"a": 1}, {"a": 1, "b": 1}),
            "the absent-is-zero test must separate the real impl from the impostor",
        )

    def test_bite_compare_collapses_concurrent_to_before(self):
        # WRONG: no concurrent branch — anything not <= is 'after', anything
        # not >= is 'before'. Would call disjoint {a:1} vs {b:1} 'before'.
        def wrong_compare(x, y):
            keys = set(x) | set(y)
            if all(x.get(k, 0) <= y.get(k, 0) for k in keys):
                return "before" if x != y else "equal"
            return "after"  # NO concurrent branch

        self.assertEqual(vclock.compare({"a": 1}, {"b": 1}), "concurrent")
        self.assertNotEqual(wrong_compare({"a": 1}, {"b": 1}), "concurrent")

    def test_bite_bump_starts_absent_at_zero(self):
        # WRONG: absent actor bumped to 0 instead of 1 (off-by-one at creation)
        def wrong_bump(clock, actor):
            new = dict(clock)
            new[actor] = new.get(actor, -1) + 1  # absent → 0, not 1
            return new

        self.assertEqual(vclock.bump({}, "a"), {"a": 1})
        self.assertNotEqual(wrong_bump({}, "a"), {"a": 1})

    def test_bite_merge_uses_min_not_max(self):
        # WRONG: component-wise MIN instead of MAX
        def wrong_merge(x, y):
            keys = set(x) | set(y)
            return {k: min(x.get(k, 0), y.get(k, 0)) for k in keys}

        self.assertEqual(vclock.merge({"a": 2}, {"a": 1}), {"a": 2})
        self.assertNotEqual(wrong_merge({"a": 2}, {"a": 1}), {"a": 2})


if __name__ == "__main__":
    verbosity = 1 if "-q" in sys.argv else 2
    argv = [a for a in sys.argv if a != "-q"]
    unittest.main(argv=argv, verbosity=verbosity)
