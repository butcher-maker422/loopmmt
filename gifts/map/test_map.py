#!/usr/bin/env python3
"""Mutation-bitten tests for map.py.

Each test asserts a specific behavior; the suite is proven to go RED under a
planted mutation (see test_mutation_is_detected) so a no-op test can't pass green.
Run: python3 test_map.py
"""
import io
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import map as M  # noqa: E402


def _manifest(entries):
    fd, path = tempfile.mkstemp(suffix=".json")
    with os.fdopen(fd, "w") as f:
        json.dump({"gifts": entries}, f)
    return path


class TestPortGate(unittest.TestCase):
    def test_emits_gate(self):
        # everything but sink emits
        self.assertTrue(M.EMITS("source"))
        self.assertTrue(M.EMITS("transform"))
        self.assertTrue(M.EMITS("filter"))
        self.assertTrue(M.EMITS("fold"))
        self.assertFalse(M.EMITS("sink"))

    def test_accepts_gate(self):
        # everything but source accepts
        self.assertFalse(M.ACCEPTS("source"))
        self.assertTrue(M.ACCEPTS("transform"))
        self.assertTrue(M.ACCEPTS("filter"))
        self.assertTrue(M.ACCEPTS("fold"))
        self.assertTrue(M.ACCEPTS("sink"))


class TestComposeMap(unittest.TestCase):
    def setUp(self):
        # 1 of each of 4 verbs; hand-computed answer = 7 composable ordered pairs
        self.decl = [("s", "source"), ("t", "transform"), ("f", "filter"), ("k", "sink")]

    def test_pair_count_hand_computed(self):
        cm = M.compose_map(self.decl)
        self.assertEqual(len(cm["pairs"]), 7)

    def test_closed_form_matches_enumeration(self):
        cm = M.compose_map(self.decl)
        self.assertEqual(cm["closed_form"], len(cm["pairs"]))
        self.assertTrue(cm["closed_form_matches"])

    def test_source_feeds_all_acceptors_no_fan_in(self):
        cm = M.compose_map(self.decl)
        self.assertEqual(cm["fan_out"]["s"], 3)   # feeds t, f, k
        self.assertNotIn("s", cm["fan_in"])        # source is fed by nobody

    def test_sink_fed_by_all_emitters_no_fan_out(self):
        cm = M.compose_map(self.decl)
        self.assertEqual(cm["fan_in"]["k"], 3)     # fed by s, t, f
        self.assertNotIn("k", cm["fan_out"])       # sink feeds nobody

    def test_no_self_pairs(self):
        cm = M.compose_map(self.decl)
        for a, b in cm["pairs"]:
            self.assertNotEqual(a, b)

    def test_density(self):
        cm = M.compose_map(self.decl)
        # 7 composable / 12 ordered = 0.5833...
        self.assertAlmostEqual(cm["density"], 7 / 12, places=4)


class TestDeclarationHonesty(unittest.TestCase):
    def test_undeclared_excluded_not_guessed(self):
        path = _manifest([
            {"slug": "a", "port_verb": "source"},
            {"slug": "b"},                       # no port_verb
            {"slug": "c", "port_verb": "bogus"},  # invalid
        ])
        declared, undeclared = M.load_declared(path)
        os.unlink(path)
        self.assertEqual([d[0] for d in declared], ["a"])
        self.assertEqual(set(undeclared), {"b", "c"})

    def test_summary_reports_undeclared_count(self):
        path = _manifest([
            {"slug": "a", "port_verb": "source"},
            {"slug": "b"},
        ])
        declared, undeclared = M.load_declared(path)
        os.unlink(path)
        cm = M.compose_map(declared)
        rec = M.summary_record(cm, undeclared)
        self.assertEqual(rec["undeclared_count"], 1)
        self.assertIn("b", rec["undeclared"])

    def test_summary_carries_semantic_unproven_flag(self):
        cm = M.compose_map([("a", "source"), ("b", "sink")])
        rec = M.summary_record(cm, [])
        self.assertIn("UNPROVEN", rec["semantic_layer"])


class TestReadEmitsJSONL(unittest.TestCase):
    def test_read_emits_pairs_then_summary(self):
        cm = M.compose_map([("s", "source"), ("k", "sink")])
        buf = io.StringIO()
        M.emit_read(cm, [], buf)
        lines = [json.loads(x) for x in buf.getvalue().strip().split("\n")]
        self.assertEqual(lines[0]["kind"], "pair")
        self.assertEqual(lines[0]["from"], "s")
        self.assertEqual(lines[0]["to"], "k")
        self.assertEqual(lines[-1]["kind"], "summary")

    def test_own_port_is_fold(self):
        out = io.StringIO()
        saved = sys.stdout
        try:
            sys.stdout = out
            M.main(["--port"])
        finally:
            sys.stdout = saved
        self.assertEqual(json.loads(out.getvalue())["port_verb"], "fold")


class TestManifestShapes(unittest.TestCase):
    def test_bare_list_manifest(self):
        fd, path = tempfile.mkstemp(suffix=".json")
        with os.fdopen(fd, "w") as f:
            json.dump([{"slug": "a", "port_verb": "source"}], f)
        declared, _ = M.load_declared(path)
        os.unlink(path)
        self.assertEqual(declared, [("a", "source")])

    def test_no_entry_list_raises(self):
        fd, path = tempfile.mkstemp(suffix=".json")
        with os.fdopen(fd, "w") as f:
            json.dump({"nope": 1}, f)
        with self.assertRaises(ValueError):
            M.load_declared(path)
        os.unlink(path)


class TestMutationIsDetected(unittest.TestCase):
    """Prove the suite is not a no-op: a planted mutation must break a test."""
    def test_mutation_is_detected(self):
        decl = [("s", "source"), ("t", "transform"), ("f", "filter"), ("k", "sink")]
        # Mutate EMITS to always-True (sink wrongly counted as an emitter).
        saved = M.EMITS
        try:
            M.EMITS = lambda v: True
            cm = M.compose_map(decl)
            # Under always-True EMITS: emitters=4, acceptors=3, both={t,f,k}=3,
            # so pairs = |E|*|A| - |E∩A| = 4*3 - 3 = 9, NOT the correct 7.
            self.assertNotEqual(len(cm["pairs"]), 7,
                                "mutation did not change the result — suite is a no-op")
            self.assertEqual(len(cm["pairs"]), 9)
        finally:
            M.EMITS = saved
        # Confirm restoration: the real function gives 7 again.
        self.assertEqual(len(M.compose_map(decl)["pairs"]), 7)


if __name__ == "__main__":
    unittest.main(verbosity=2)
