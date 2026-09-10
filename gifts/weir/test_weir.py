#!/usr/bin/env python3
"""Tests for the weir gift — an independent oracle, mutation-bitten.

Each load-bearing behavior is asserted so that DELETING the behavior would fail a
test. weir is invoked as a real subprocess so its actual stdout/stderr/exit are
exercised end to end (not the in-process selftest, which is the tool's own copy).

The load-bearing behaviors:
  * token budget is REFUSED by construction (exit 2, reason names tokens);
  * empty budget is REFUSED (exit 2);
  * a rows cut emits exactly the ceiling count, stops AT the wall (exit 3);
  * a bytes cut stops at or under the byte ceiling (exit 3);
  * an under-budget run passes everything through (exit 0);
  * a rows/bytes cut is reproducible (byte-identical stdout across runs);
  * the ledger records the cut with the exceeded budget and count;
  * replay returns exactly the records for a trace-id;
  * weir gates the BUDGET, not the command: a command exiting non-zero while
    under budget does not make weir's own exit non-zero.

Run: python3 -m unittest test_weir -v   (stdlib only, no deps)
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
WEIR = os.path.join(HERE, "weir.py")
PY = sys.executable

# An emitter that prints N json-lines and ignores stdin.
EMIT_SRC = "import sys\nn=int(sys.argv[1])\nfor i in range(n):\n    print('{\"i\": %d}' % i)\n"
# A command that exits non-zero after emitting a few lines (under budget).
FAIL_SRC = "print('{\"a\":1}')\nprint('{\"a\":2}')\nimport sys; sys.exit(7)\n"


def _write(tmp, name, src):
    p = os.path.join(tmp, name)
    with open(p, "w") as f:
        f.write(src)
    return p


def run_weir(argv, cwd):
    """Invoke weir as a subprocess; return (exit, stdout_bytes, stderr_text)."""
    proc = subprocess.run([PY, WEIR] + argv, cwd=cwd,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return proc.returncode, proc.stdout, proc.stderr.decode("utf-8", "replace")


class WeirTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.emit = _write(self.tmp, "emit.py", EMIT_SRC)
        self.fail = _write(self.tmp, "fail.py", FAIL_SRC)

    # --- the covenant invariant: no token budgets --------------------------

    def test_token_budget_refused(self):
        code, _out, err = run_weir(["check", "--max-tokens", "5000"], self.tmp)
        self.assertEqual(code, 2, "a token budget must be refused")
        self.assertIn("never tokens", err)

    def test_token_budget_refused_on_run(self):
        code, _out, err = run_weir(
            ["run", "--max-tokens", "10", "--", PY, self.emit, "5"], self.tmp)
        self.assertEqual(code, 2, "a token budget must be refused even on run")
        self.assertIn("never tokens", err)

    def test_empty_budget_refused(self):
        code, _out, err = run_weir(["check"], self.tmp)
        self.assertEqual(code, 2, "a budget with no ceiling must be refused")
        self.assertIn("no ceiling", err)

    def test_real_budget_ok(self):
        code, out, _err = run_weir(["check", "--max-rows", "10"], self.tmp)
        self.assertEqual(code, 0)
        rec = json.loads(out.decode())
        self.assertEqual(rec["kind"], "budget-ok")
        self.assertEqual(rec["budget"], {"rows": 10})

    # --- the cut: stop AT the wall -----------------------------------------

    def test_rows_cut_stops_at_wall(self):
        code, out, err = run_weir(
            ["run", "--max-rows", "10", "--trace", "R", "--ledger",
             os.path.join(self.tmp, "l.jsonl"), "--", PY, self.emit, "100"],
            self.tmp)
        self.assertEqual(code, 3, "a rows cut exits 3")
        lines = [l for l in out.decode().splitlines() if l.strip()]
        self.assertEqual(len(lines), 10,
                         "emits exactly the ceiling count, not one past it")
        summary = json.loads(err.strip().splitlines()[-1])
        self.assertEqual(summary["budget"], "rows")
        self.assertEqual(summary["limit"], 10)
        self.assertTrue(summary["reproducible"])

    def test_bytes_cut_stays_under_ceiling(self):
        code, out, err = run_weir(
            ["run", "--max-bytes", "50", "--trace", "B", "--ledger",
             os.path.join(self.tmp, "l.jsonl"), "--", PY, self.emit, "100"],
            self.tmp)
        self.assertEqual(code, 3, "a bytes cut exits 3")
        self.assertLessEqual(len(out), 50,
                             "never emits more than the byte ceiling")
        summary = json.loads(err.strip().splitlines()[-1])
        self.assertEqual(summary["budget"], "bytes")
        self.assertTrue(summary["reproducible"])

    def test_under_budget_passes_through(self):
        code, out, _err = run_weir(
            ["run", "--max-rows", "100", "--ledger",
             os.path.join(self.tmp, "l.jsonl"), "--", PY, self.emit, "5"],
            self.tmp)
        self.assertEqual(code, 0, "under budget exits 0")
        lines = [l for l in out.decode().splitlines() if l.strip()]
        self.assertEqual(len(lines), 5, "passes every record through")

    # --- determinism: a rows/bytes cut is byte-identical -------------------

    def test_rows_cut_is_reproducible(self):
        outs = []
        for t in ("a", "b", "c"):
            _c, out, _e = run_weir(
                ["run", "--max-rows", "7", "--trace", t, "--ledger",
                 os.path.join(self.tmp, "l%s.jsonl" % t), "--", PY,
                 self.emit, "100"], self.tmp)
            outs.append(out)
        self.assertEqual(outs[0], outs[1])
        self.assertEqual(outs[1], outs[2])
        self.assertEqual(len([l for l in outs[0].decode().splitlines() if l.strip()]), 7)

    # --- the ledger + replay -----------------------------------------------

    def test_ledger_records_the_cut(self):
        ledger = os.path.join(self.tmp, "led.jsonl")
        run_weir(["run", "--max-rows", "3", "--trace", "L", "--ledger", ledger,
                  "--", PY, self.emit, "100"], self.tmp)
        with open(ledger) as f:
            recs = [json.loads(l) for l in f if l.strip()]
        cut = [r for r in recs if r.get("kind") == "cut"]
        self.assertEqual(len(cut), 1, "exactly one cut record")
        self.assertEqual(cut[0]["budget"], "rows")
        self.assertEqual(cut[0]["limit"], 3)
        self.assertEqual(cut[0]["count_at_cut"], 4)

    def test_replay_returns_only_the_trace(self):
        ledger = os.path.join(self.tmp, "led.jsonl")
        run_weir(["run", "--max-rows", "2", "--trace", "X", "--ledger", ledger,
                  "--", PY, self.emit, "50"], self.tmp)
        run_weir(["run", "--max-rows", "2", "--trace", "Y", "--ledger", ledger,
                  "--", PY, self.emit, "50"], self.tmp)
        code, out, _err = run_weir(
            ["replay", "--ledger", ledger, "--trace", "X"], self.tmp)
        self.assertEqual(code, 0)
        recs = [json.loads(l) for l in out.decode().splitlines() if l.strip()]
        self.assertTrue(recs)
        self.assertTrue(all(r["trace_id"] == "X" for r in recs),
                        "replay returns only the asked trace")

    # --- weir gates the BUDGET, not the command ----------------------------

    def test_command_nonzero_under_budget_is_weir_zero(self):
        code, _out, err = run_weir(
            ["run", "--max-rows", "100", "--ledger",
             os.path.join(self.tmp, "l.jsonl"), "--", PY, self.fail],
            self.tmp)
        self.assertEqual(code, 0,
                         "weir gates the budget; the command's own exit is reported, "
                         "not adopted")
        summary = json.loads(err.strip().splitlines()[-1])
        self.assertEqual(summary["verdict"], "under-budget")
        self.assertEqual(summary["cmd_exit"], 7)

    # --- the selftest itself runs green (guards against a broken core) -----

    def test_selftest_green(self):
        code, _out, err = run_weir(["--selftest"], self.tmp)
        self.assertEqual(code, 0)
        self.assertIn("13/13", err)


if __name__ == "__main__":
    unittest.main(verbosity=2)
