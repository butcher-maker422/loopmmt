#!/usr/bin/env python3
"""Tests for the conductor gift.

Mutation-bitten. The load-bearing behaviors, each asserted so that deleting the
behavior would fail the test:
  * typecheck-first: a broken pipeline must NOT launch any stage (assert no
    ledger records for stages, exit 3);
  * fail-clean: a failing stage stops the run, is recorded 'failed', and every
    later stage is recorded 'skipped' (assert both, exit 5);
  * the ledger records every stage in order with exit/bytes;
  * replay returns exactly the records for a trace-id.

Uses tiny real python subprocess stages so execution is genuinely exercised.
Run: python3 -m unittest test_conductor -v   (stdlib only, no deps)
"""
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr

import conductor as cd

PY = sys.executable

# tiny real stages (as shell-quotable command strings for slug:verb:cmd tokens)
# emit: prints two json-lines, ignores stdin (a source)
EMIT = "%s -c \"print('{\\\"a\\\":1}');print('{\\\"a\\\":2}')\"" % PY
# pass: echoes stdin to stdout unchanged (a transform)
PASS = "%s -c \"import sys;sys.stdout.write(sys.stdin.read())\"" % PY
# count: reads stdin, prints one summary line (a fold)
COUNT = "%s -c \"import sys;n=len([l for l in sys.stdin if l.strip()]);print('{\\\"n\\\":%%d}'%%n)\"" % PY
# boom: exits 1 after reading stdin (a failing stage)
BOOM = "%s -c \"import sys;sys.stdin.read();sys.exit(1)\"" % PY
# sink: reads stdin, writes nothing to stdout, exit 0
SINK = "%s -c \"import sys;sys.stdin.read()\"" % PY


def run(argv, stdin_text=None):
    obuf, ebuf = io.StringIO(), io.StringIO()
    old_stdin = sys.stdin
    if stdin_text is not None:
        sys.stdin = io.StringIO(stdin_text)
    # conductor.run writes final stdout via sys.stdout.buffer; capture that too
    old_stdout_buffer = getattr(sys.stdout, "buffer", None)
    try:
        with redirect_stdout(obuf), redirect_stderr(ebuf):
            # give the redirected StringIO a .buffer that tees to bytes
            class _B:
                def __init__(self, s): self.s = s
                def write(self, b): self.s.write(b.decode("utf-8", "replace"))
            sys.stdout.buffer = _B(obuf)
            code = cd.main(argv)
    finally:
        sys.stdin = old_stdin
    out_recs = [json.loads(l) for l in obuf.getvalue().splitlines() if l.strip().startswith("{")]
    err_recs = [json.loads(l) for l in ebuf.getvalue().splitlines() if l.strip().startswith("{")]
    return code, out_recs, err_recs


def read_ledger(path):
    recs = []
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line:
                    recs.append(json.loads(line))
    return recs


class TmpCase(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.ledger = os.path.join(self.d, "l.jsonl")

    def tearDown(self):
        import shutil
        shutil.rmtree(self.d, ignore_errors=True)


class TestGate(unittest.TestCase):
    def test_emits_accepts(self):
        self.assertFalse(cd.emits("sink"))
        self.assertFalse(cd.accepts("source"))
        self.assertTrue(cd.emits("source"))
        self.assertTrue(cd.accepts("sink"))


class TestCheck(unittest.TestCase):
    def test_check_valid(self):
        code, out, _ = run(["check", "--stage", "a:source", "--stage", "b:fold"])
        self.assertEqual(code, 0)
        self.assertTrue(out[-1]["typechecks"])

    def test_check_broken_is_3(self):
        code, out, _ = run(["check", "--stage", "a:sink", "--stage", "b:transform"])
        self.assertEqual(code, 3)
        self.assertEqual(out[-1]["kind"], "refused")

    def test_check_undeclared_is_4(self):
        code, out, _ = run(["check", "--stage", "a:source", "--stage", "b:emits"])
        self.assertEqual(code, 4)


class TestTypecheckFirstNoLaunch(TmpCase):
    """THE typecheck-first guarantee: a broken pipeline must NOT run any stage.
    Assert exit 3 AND zero stage records in the ledger — deleting the pre-run
    typecheck would let a stage launch and write a record."""

    def test_broken_pipeline_launches_nothing(self):
        code, out, err = run(["run",
                              "--stage", "a:sink:%s" % SINK,      # sink not last
                              "--stage", "b:transform:%s" % PASS,
                              "--ledger", self.ledger])
        self.assertEqual(code, 3)
        led = read_ledger(self.ledger)
        stage_recs = [r for r in led if r.get("kind") == "stage"]
        self.assertEqual(stage_recs, [], "a broken pipeline launched a stage — typecheck-first failed")


class TestRunCleanRecords(TmpCase):
    def test_full_run_records_every_stage_in_order(self):
        code, out, err = run(["run",
                              "--stage", "emit:source:%s" % EMIT,
                              "--stage", "pass:transform:%s" % PASS,
                              "--stage", "count:fold:%s" % COUNT,
                              "--ledger", self.ledger, "--trace", "T1"])
        self.assertEqual(code, 0)
        led = read_ledger(self.ledger)
        stage_recs = [r for r in led if r.get("kind") == "stage"]
        self.assertEqual([r["index"] for r in stage_recs], [0, 1, 2])
        self.assertEqual([r["slug"] for r in stage_recs], ["emit", "pass", "count"])
        self.assertTrue(all(r["verdict"] == "ok" for r in stage_recs))
        # bytes flow: emit produces >0, count reads what pass passed
        self.assertGreater(stage_recs[0]["bytes_out"], 0)
        self.assertEqual(stage_recs[1]["bytes_in"], stage_recs[0]["bytes_out"])
        # run-summary on stderr says ok
        self.assertTrue(err[-1]["ok"])


class TestFailClean(TmpCase):
    """A failing stage stops the run: it is recorded 'failed', every LATER stage
    'skipped', exit 5, and the summary names the failed stage. Deleting the
    fail-stop would let a later stage run on broken input."""

    def test_failure_stops_and_marks_skipped(self):
        code, out, err = run(["run",
                              "--stage", "emit:source:%s" % EMIT,
                              "--stage", "boom:transform:%s" % BOOM,   # fails
                              "--stage", "count:fold:%s" % COUNT,      # must be skipped
                              "--ledger", self.ledger, "--trace", "T2"])
        self.assertEqual(code, 5)
        led = read_ledger(self.ledger)
        by_slug = {r["slug"]: r for r in led if r.get("kind") == "stage"}
        self.assertEqual(by_slug["boom"]["verdict"], "failed")
        self.assertEqual(by_slug["count"]["verdict"], "skipped")
        # summary names the failed stage
        summ = err[-1]
        self.assertFalse(summ["ok"])
        self.assertEqual(summ["failed_stage"]["slug"], "boom")

    def test_missing_cmd_on_run_is_exit2(self):
        code, out, err = run(["run", "--stage", "a:source", "--ledger", self.ledger])
        self.assertEqual(code, 2)


class TestReplay(TmpCase):
    def test_replay_returns_only_that_trace(self):
        run(["run", "--stage", "emit:source:%s" % EMIT, "--stage", "sink:sink:%s" % SINK,
             "--ledger", self.ledger, "--trace", "TA"])
        run(["run", "--stage", "emit:source:%s" % EMIT, "--stage", "sink:sink:%s" % SINK,
             "--ledger", self.ledger, "--trace", "TB"])
        code, out, _ = run(["replay", "--ledger", self.ledger, "--trace", "TA"])
        self.assertEqual(code, 0)
        self.assertTrue(out)
        self.assertTrue(all(r["trace_id"] == "TA" for r in out))
        # TB records are NOT in TA's replay
        self.assertFalse(any(r["trace_id"] == "TB" for r in out))

    def test_replay_unknown_trace_is_exit2(self):
        run(["run", "--stage", "emit:source:%s" % EMIT, "--stage", "sink:sink:%s" % SINK,
             "--ledger", self.ledger, "--trace", "TA"])
        code, _, _ = run(["replay", "--ledger", self.ledger, "--trace", "NOPE"])
        self.assertEqual(code, 2)


class TestStdinStages(TmpCase):
    def test_stages_from_stdin_run(self):
        stdin = "\n".join([
            json.dumps({"slug": "emit", "port_verb": "source", "cmd": cd.shlex.split(EMIT)}),
            json.dumps({"slug": "sink", "port_verb": "sink", "cmd": cd.shlex.split(SINK)}),
        ])
        code, out, err = run(["run", "--stdin", "--ledger", self.ledger, "--trace", "TS"],
                             stdin_text=stdin)
        self.assertEqual(code, 0)


class TestVerbs(unittest.TestCase):
    def test_verbs_five_in_order(self):
        code, out, _ = run(["verbs"])
        self.assertEqual(code, 0)
        self.assertEqual([r["port_verb"] for r in out],
                         ["source", "transform", "filter", "fold", "sink"])


if __name__ == "__main__":
    unittest.main()
