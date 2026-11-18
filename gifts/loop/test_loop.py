#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""test_loop.py — the loop gift's battery. Standard library only.

Each test name is the behavior sentence. The life-fold cases use an independent implementation as the oracle
(life-fold --steps N), so loop is checked against something it did not write. They need `node`; without it they are
reported as skipped by name, never silently passed.

Run: python3 test_loop.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
LOOP = os.path.join(HERE, "loop.py")
LIFE = os.path.normpath(os.path.join(HERE, "..", "life-fold", "life-fold.js"))
NODE = shutil.which("node")
GLIDER = b"[0,1]\n[1,2]\n[2,0]\n[2,1]\n[2,2]\n"
BLINKER = b"[0,0]\n[1,0]\n[2,0]\n"
BLOCK = b"[0,0]\n[0,1]\n[1,0]\n[1,1]\n"
# A deterministic transform written in Python so the core battery needs nothing but Python: each record's "n" goes up
# by one, until it reaches 3 and stays there (so the loop has a fixed point to find).
STEP = [sys.executable, "-c",
        "import sys,json\n"
        "for l in sys.stdin:\n"
        "  l=l.strip()\n"
        "  if l:\n"
        "    r=json.loads(l); r['n']=min(r['n']+1,3); print(json.dumps(r,sort_keys=True))"]


def run(*args, data=b"", cwd=None):
    proc = subprocess.run([sys.executable, LOOP, *args], input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          cwd=cwd)
    return proc.returncode, proc.stdout, proc.stderr


def stage(slug, verb, argv):
    return "%s:%s:%s" % (slug, verb, " ".join(_quote(a) for a in argv))


def _quote(arg):
    import shlex
    return shlex.quote(arg)


class Loop(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.ledger = os.path.join(self.dir, "ledger.jsonl")

    def tearDown(self):
        shutil.rmtree(self.dir)

    def rows(self, trace=None):
        with open(self.ledger, encoding="utf-8") as handle:
            rows = [json.loads(l) for l in handle if l.strip()]
        return [r for r in rows if trace is None or r["trace"] == trace]

    # --- the check: what may be looped, and the bound -------------------------------------------------------
    def test_verbs_names_the_five_and_which_can_loop(self):
        code, out, _ = run("verbs")
        rows = [json.loads(l) for l in out.decode().splitlines()]
        self.assertEqual(code, 0)
        self.assertEqual([r["port_verb"] for r in rows], ["source", "transform", "filter", "fold", "sink"])
        self.assertEqual(rows[1]["loop"], "loopable")
        self.assertEqual(rows[3]["loop"], "loopable only with --closed")
        self.assertEqual(rows[0]["loop"], "never loopable")

    def test_a_transform_with_a_bound_checks(self):
        code, out, _ = run("check", "--stage", stage("step", "transform", STEP), "--max-passes", "5")
        self.assertEqual(code, 0)
        self.assertTrue(json.loads(out)["loopable"])

    def test_a_loop_takes_on_its_stages_verb(self):
        _, out, _ = run("check", "--stage", stage("step", "filter", STEP), "--max-passes", "2")
        self.assertEqual(json.loads(out)["loop_port_verb"], "filter")

    def test_a_loop_with_no_bound_is_refused(self):
        code, _, err = run("check", "--stage", stage("step", "transform", STEP))
        self.assertEqual(code, 3)
        self.assertIn(b"unbounded", err)

    def test_a_zero_or_oversized_bound_is_refused(self):
        for bad in ("0", "-1", "1000001"):
            code, _, _ = run("check", "--stage", stage("step", "transform", STEP), "--max-passes", bad)
            self.assertEqual(code, 3, bad)

    def test_a_source_or_sink_can_never_be_looped(self):
        for verb in ("source", "sink"):
            code, _, _ = run("check", "--stage", stage("x", verb, ["cat"]), "--max-passes", "3")
            self.assertEqual(code, 3, verb)

    def test_a_fold_is_refused_unless_declared_closed(self):
        code, _, _ = run("check", "--stage", stage("f", "fold", ["cat"]), "--max-passes", "3")
        self.assertEqual(code, 3)
        code, _, _ = run("check", "--stage", stage("f", "fold", ["cat"]), "--max-passes", "3", "--closed")
        self.assertEqual(code, 0)

    def test_an_undeclared_verb_is_exit_4(self):
        code, _, _ = run("check", "--stage", stage("x", "mangle", ["cat"]), "--max-passes", "3")
        self.assertEqual(code, 4)

    def test_a_refused_loop_runs_no_pass(self):
        code, _, _ = run("run", "--stage", stage("x", "sink", STEP), "--max-passes", "3", "--ledger", self.ledger,
                         data=b'{"n":0}\n')
        self.assertEqual(code, 3)
        self.assertFalse(os.path.exists(self.ledger))

    # --- the run: passes, stop rules, the record ------------------------------------------------------------
    def test_each_pass_feeds_the_last_output_back_in(self):
        code, out, _ = run("run", "--stage", stage("step", "transform", STEP), "--max-passes", "2",
                           "--ledger", self.ledger, data=b'{"n":0}\n')
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out), {"n": 2})

    def test_until_fixed_stops_on_the_first_pass_that_repeats_its_input(self):
        code, out, _ = run("run", "--stage", stage("step", "transform", STEP), "--max-passes", "50",
                           "--until", "fixed", "--ledger", self.ledger, data=b'{"n":0}\n')
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out), {"n": 3})
        summary = self.rows()[-1]
        self.assertEqual((summary["stopped"], summary["passes"]), ("fixed", 4))

    def test_until_fixed_that_hits_the_bound_says_so_with_exit_6(self):
        code, out, _ = run("run", "--stage", stage("step", "transform", STEP), "--max-passes", "2",
                           "--until", "fixed", "--ledger", self.ledger, data=b'{"n":0}\n')
        self.assertEqual(code, 6)
        self.assertEqual(json.loads(out), {"n": 2})
        self.assertEqual(self.rows()[-1]["stopped"], "bound")

    def test_every_pass_is_a_row_and_one_summary_closes_the_run(self):
        run("run", "--stage", stage("step", "transform", STEP), "--max-passes", "3", "--ledger", self.ledger,
            data=b'{"n":0}\n')
        rows = self.rows()
        self.assertEqual([r["kind"] for r in rows], ["pass", "pass", "pass", "summary"])
        self.assertEqual([r["pass"] for r in rows[:3]], [1, 2, 3])
        self.assertTrue(all(r["verdict"] == "ok" for r in rows[:3]))

    def test_a_failing_pass_stops_the_loop_prints_nothing_and_names_the_pass(self):
        code, out, err = run("run", "--stage", stage("bad", "transform", [sys.executable, "-c", "raise SystemExit(7)"]),
                             "--max-passes", "5", "--ledger", self.ledger, data=b'{"n":0}\n')
        self.assertEqual(code, 5)
        self.assertEqual(out, b"")
        self.assertIn(b"pass 1", err)
        rows = self.rows()
        self.assertEqual([r["kind"] for r in rows], ["pass", "summary"])
        self.assertEqual((rows[0]["verdict"], rows[0]["exit"], rows[1]["stopped"]), ("failed", 7, "failed"))

    def test_replay_returns_a_traces_rows_in_pass_order(self):
        run("run", "--stage", stage("step", "transform", STEP), "--max-passes", "2", "--ledger", self.ledger,
            "--trace", "t-1", data=b'{"n":0}\n')
        code, out, _ = run("replay", "--ledger", self.ledger, "--trace", "t-1")
        rows = [json.loads(l) for l in out.decode().splitlines()]
        self.assertEqual(code, 0)
        self.assertEqual([r.get("pass") for r in rows], [1, 2, None])

    def test_replay_of_an_unknown_trace_is_a_usage_error(self):
        run("run", "--stage", stage("step", "transform", STEP), "--max-passes", "1", "--ledger", self.ledger,
            data=b'{"n":0}\n')
        code, _, _ = run("replay", "--ledger", self.ledger, "--trace", "nope")
        self.assertEqual(code, 2)

    # --- determinism ----------------------------------------------------------------------------------------
    def test_the_same_loop_on_the_same_input_writes_byte_identical_rows(self):
        other = os.path.join(self.dir, "other.jsonl")
        for path in (self.ledger, other):
            run("run", "--stage", stage("step", "transform", STEP), "--max-passes", "3", "--ledger", path,
                data=b'{"n":0}\n')
        with open(self.ledger, "rb") as a, open(other, "rb") as b:
            self.assertEqual(a.read(), b.read())

    def test_a_different_input_gets_a_different_trace(self):
        run("run", "--stage", stage("step", "transform", STEP), "--max-passes", "1", "--ledger", self.ledger,
            data=b'{"n":0}\n')
        run("run", "--stage", stage("step", "transform", STEP), "--max-passes", "1", "--ledger", self.ledger,
            data=b'{"n":1}\n')
        self.assertEqual(len({r["trace"] for r in self.rows()}), 2)

    # --- the oracle: an independent implementation ----------------------------------------------------------
    @unittest.skipUnless(NODE and os.path.isfile(LIFE), "needs node and the life-fold gift beside this one (../life-fold/life-fold.js)")
    def test_looping_life_fold_n_times_equals_life_fold_steps_n(self):
        for n in (1, 2, 4, 17):
            code, out, _ = run("run", "--stage", stage("life", "fold", [NODE, LIFE]), "--closed",
                               "--max-passes", str(n), "--ledger", self.ledger, data=GLIDER)
            want = subprocess.run([NODE, LIFE, "--steps", str(n)], input=GLIDER, stdout=subprocess.PIPE).stdout
            self.assertEqual((code, out), (0, want), "n=%d" % n)

    @unittest.skipUnless(NODE and os.path.isfile(LIFE), "needs node and the life-fold gift beside this one (../life-fold/life-fold.js)")
    def test_a_still_life_is_a_fixed_point_on_the_first_pass(self):
        code, out, _ = run("run", "--stage", stage("life", "fold", [NODE, LIFE]), "--closed", "--max-passes", "10",
                           "--until", "fixed", "--ledger", self.ledger, data=BLOCK)
        self.assertEqual((code, out), (0, BLOCK))
        self.assertEqual(self.rows()[-1]["passes"], 1)

    @unittest.skipUnless(NODE and os.path.isfile(LIFE), "needs node and the life-fold gift beside this one (../life-fold/life-fold.js)")
    def test_a_blinker_never_repeats_its_input_so_until_fixed_runs_to_the_bound(self):
        code, _, _ = run("run", "--stage", stage("life", "fold", [NODE, LIFE]), "--closed", "--max-passes", "10",
                         "--until", "fixed", "--ledger", self.ledger, data=BLINKER)
        self.assertEqual(code, 6)


if __name__ == "__main__":
    result = unittest.main(exit=False, verbosity=1).result
    skipped = [str(t[0]).split(" ")[0] for t in result.skipped]
    if skipped:
        sys.stderr.write("SKIPPED (named, not passed): %s\n" % ", ".join(skipped))
    sys.exit(0 if result.wasSuccessful() else 1)
