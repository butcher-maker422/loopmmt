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


# --- bounded loops (the trace): slug*N tokens and JSON "loop" objects ------------------------------------------
SEED = "%s -c \"print('{\\\"n\\\": 0}')\"" % PY
STEP = ("%s -c \"import sys,json\nfor l in sys.stdin:\n  l=l.strip()\n  if l:\n    r=json.loads(l); "
        "r['n']=min(r['n']+1,3); print(json.dumps(r,sort_keys=True))\"" % PY)


def loop_records(ledger, index):
    return [r for r in read_ledger(ledger) if r.get("index") == index and r["kind"] in ("stage", "loop-end")]


class TestLoops(TmpCase):
    def test_a_token_loop_feeds_each_pass_the_last_output(self):
        code, out, _ = run(["run", "--stage", "seed:source:" + SEED, "--stage", "step*2:transform:" + STEP,
                            "--ledger", self.ledger, "--trace", "L1"])
        self.assertEqual(code, 0)
        self.assertEqual(out[-1], {"n": 2})
        recs = loop_records(self.ledger, 1)
        self.assertEqual([r.get("pass") for r in recs], [1, 2, None])
        self.assertEqual((recs[-1]["kind"], recs[-1]["stopped"], recs[-1]["passes"]), ("loop-end", "bound", 2))

    def test_until_fixed_stops_at_the_first_repeat_and_says_settled(self):
        stdin = json.dumps({"slug": "step", "port_verb": "transform", "cmd": cd.shlex.split(STEP),
                            "loop": {"passes": 50, "until": "fixed"}})
        seed = os.path.join(self.d, "seed.jsonl")
        with open(seed, "w") as f:
            f.write('{"n": 0}\n')
        code, out, _ = run(["run", "--stdin", "--input", seed, "--ledger", self.ledger, "--trace", "L2"],
                           stdin_text=stdin)
        self.assertEqual(code, 0)
        self.assertEqual(out[-1], {"n": 3})
        end = loop_records(self.ledger, 0)[-1]
        self.assertEqual((end["stopped"], end["passes"], end["settled"]), ("fixed", 4, True))

    def test_until_fixed_that_hits_the_bound_is_recorded_unsettled_not_failed(self):
        stdin = json.dumps({"slug": "step", "port_verb": "transform", "cmd": cd.shlex.split(STEP),
                            "loop": {"passes": 2, "until": "fixed"}})
        seed = os.path.join(self.d, "seed.jsonl")
        with open(seed, "w") as f:
            f.write('{"n": 0}\n')
        code, out, _ = run(["run", "--stdin", "--input", seed, "--ledger", self.ledger, "--trace", "L3"],
                           stdin_text=stdin)
        self.assertEqual(code, 0)
        end = loop_records(self.ledger, 0)[-1]
        self.assertEqual((end["stopped"], end["settled"]), ("bound", False))

    def test_a_zero_or_oversized_bound_is_refused_before_any_stage_runs(self):
        for bad in ("step*0", "step*1000001"):
            code, out, _ = run(["run", "--stage", "seed:source:" + SEED, "--stage", bad + ":transform:" + STEP,
                                "--ledger", self.ledger, "--trace", "L4"])
            self.assertEqual(code, 3, bad)
            self.assertEqual(out[0]["reason"], "loop refused")
        self.assertEqual([r for r in read_ledger(self.ledger) if r["kind"] == "stage"], [])

    def test_a_malformed_bound_is_a_usage_error(self):
        code, _, _ = run(["check", "--stage", "step*two:transform:" + STEP])
        self.assertEqual(code, 2)

    def test_a_source_or_sink_can_never_be_looped(self):
        code, _, _ = run(["check", "--stage", "seed*2:source:" + SEED, "--stage", "s:sink:" + SINK])
        self.assertEqual(code, 3)
        code, _, _ = run(["check", "--stage", "seed:source:" + SEED, "--stage", "s*2:sink:" + SINK])
        self.assertEqual(code, 3)

    def test_a_fold_loops_only_when_declared_closed(self):
        open_fold = json.dumps({"slug": "c", "port_verb": "fold", "cmd": cd.shlex.split(COUNT), "loop": {"passes": 2}})
        code, _, _ = run(["check", "--stdin"], stdin_text=open_fold)
        self.assertEqual(code, 3)
        closed = json.dumps({"slug": "c", "port_verb": "fold", "cmd": cd.shlex.split(COUNT),
                             "loop": {"passes": 2, "closed": True}})
        code, _, _ = run(["check", "--stdin"], stdin_text=closed)
        self.assertEqual(code, 0)

    def test_a_malformed_loop_object_is_a_usage_error(self):
        for bad in ({"passes": "2"}, {"passes": 2, "until": "forever"}, "loop"):
            stdin = json.dumps({"slug": "x", "port_verb": "transform", "cmd": cd.shlex.split(PASS), "loop": bad})
            code, _, _ = run(["check", "--stdin"], stdin_text=stdin)
            self.assertEqual(code, 2, bad)

    def test_a_failing_pass_stops_the_loop_and_skips_later_stages(self):
        code, _, err = run(["run", "--stage", "seed:source:" + SEED, "--stage", "boom*3:transform:" + BOOM,
                            "--stage", "s:sink:" + SINK, "--ledger", self.ledger, "--trace", "L5"])
        self.assertEqual(code, 5)
        recs = loop_records(self.ledger, 1)
        self.assertEqual((recs[0]["pass"], recs[0]["verdict"], recs[-1]["stopped"]), (1, "failed", "failed"))
        later = [r for r in read_ledger(self.ledger) if r.get("index") == 2]
        self.assertEqual(later[0]["verdict"], "skipped")


if __name__ == "__main__":
    unittest.main()
