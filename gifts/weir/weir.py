#!/usr/bin/env python3
"""weir — run a pipeline under a declared budget, in real units, never tokens.

You have a prompt-pipeline — a command that reads JSON-lines records on stdin and
writes them on stdout, the kind the `declare`/`conductor` gifts drive. You want to
run it under a ceiling: "stop after 10,000 rows", "stop after 30 seconds", "stop
after 5 MB". `weir` is that gate. You declare the budget in units you can actually
meter — rows, wall-time, bytes — and weir runs the command, counting as records
flow, and cuts the flow clean the instant a ceiling is crossed: it names which
budget was exceeded, how far, and exits non-zero so it fails a pipeline. A weir on
a river holds the water back to a measured level; this one holds a run back to a
measured cost.

THE ONE RULE THAT MAKES IT A WEIR, NOT A THROTTLE:
  A budget is rows, wall-time, or bytes. NEVER tokens. If you ask weir for a token
  budget (--max-tokens) it refuses — by construction, with a reason — and exits 2.
  Tokens are a model-internal proxy: you cannot meter them deterministically,
  offline, without the model's own tokenizer, and two tokenizers disagree on the
  same text. A budget you cannot meter is not a budget, it is a hope. weir meters
  the real resource the tokens were standing in for — the rows you process, the
  seconds you spend, the bytes you move — and declines the proxy out loud. This is
  Dara's principle from the room where weir was designed: name the token want, and
  decline it.

WHAT IT DOES, in order:
  1. Read the declared budget. A budget is one or more of --max-rows N,
     --max-seconds S, --max-bytes B. At least one real ceiling is required; a run
     with no ceiling is refused (exit 2) — a weir with no wall holds nothing.
  2. Run the command, feeding it stdin if you gave --input, and read its stdout as
     a stream of JSON-lines records.
  3. Count as it flows: rows (records emitted), bytes (of stdout), and wall-time
     (seconds since the run began). Pass each record through to weir's stdout
     until a ceiling is crossed.
  4. Cut clean at the ceiling. The record that would cross a ceiling is NOT
     emitted — weir stops at the wall, not past it — records the breach (which
     budget, the limit, the count at the cut), writes a receipt to an append-only
     ledger, and exits 3. Under budget to the end: exit 0.

THE BUDGET MODEL. Three real units, one refused proxy:

  rows       : records emitted on stdout             (deterministic; exact count)
  bytes      : bytes emitted on stdout                (deterministic; exact count)
  wall-time  : seconds of real time since run start   (environment-dependent)
  tokens     : REFUSED — a model-internal proxy, not a meterable real resource

  rows and bytes give a byte-identical verdict for a given input on any machine —
  the same records in yield the same cut every run. wall-time is the one honest
  exception: it depends on the machine and the load, so a wall-time cut is real
  but not reproducible, and weir says so. The deterministic core is rows+bytes;
  the selftest proves THAT core is byte-identical across runs. Never trust a
  wall-time cut to reproduce; trust a rows or bytes cut to reproduce exactly.

WHY A LEDGER, NOT JUST AN EXIT CODE. A pipeline that stops at a budget answers
"did it finish?" with a bare non-zero. It does not say which wall it hit, or how
close the others were. weir's receipt does: the budget that cut it, the ceiling,
the counts of all three axes at the cut, and the trace-id — so "why did this run
stop?" has an answer you can read back and replay by trace-id. This is
conductor's trace-id-and-ledger idea applied to a budget cut instead of a stage
failure: the same honesty about leaving a receipt.

THE COMMAND FORMAT. weir runs the argv you give it after `--`, exactly as a shell
would, e.g. `weir run --max-rows 1000 -- python3 emit.py`. The command's stdout is
read as JSON-lines: one record per line. A line that is not valid JSON still
counts as a row and its bytes still count — weir meters flow, it does not validate
records (that is the `contract` gift's job). weir is a governor, not a linter.

HONEST CEILING. weir cuts the flow it can see: the command's stdout, line by line.
It does not cap the command's OWN internal resource use — a command that reads a
10 GB file into memory before emitting its first row is past weir's reach until
that first row appears. It does not sandbox the command; it is exactly as safe as
the command you give it. And a wall-time cut is real but not reproducible — the
same input can cut at a different row on a slower machine. weir proves the rows
and bytes cuts reproduce; the wall-time cut it reports honestly as environment-
dependent. It meters flow at the pipe, and it refuses to pretend a token is a
resource it can meter.

MIT licensed. Python 3 standard library only. Offline. Deterministic core.
"""

import argparse
import json
import subprocess
import sys
import time
import uuid

# ---------------------------------------------------------------------------
# The budget model. Three real units; one refused proxy. Named once, here.
# ---------------------------------------------------------------------------

REAL_UNITS = ("rows", "bytes", "seconds")   # meterable, real resources
REFUSED_PROXIES = ("tokens", "token")       # model-internal, not meterable offline

REFUSAL_REASON = (
    "a budget is rows, wall-time, or bytes -- never tokens. tokens are a "
    "model-internal proxy: you cannot meter them deterministically, offline, "
    "without the model's own tokenizer, and two tokenizers disagree on the same "
    "text. meter the real resource instead: --max-rows, --max-seconds, or "
    "--max-bytes."
)


def budget_model():
    """The declared budget model as a plain record (for `weir budget`)."""
    return {
        "real_units": list(REAL_UNITS),
        "refused_proxies": list(REFUSED_PROXIES),
        "deterministic_core": ["rows", "bytes"],
        "environment_dependent": ["seconds"],
        "refusal_reason": REFUSAL_REASON,
        "cut_rule": "the record that would cross a ceiling is not emitted; weir "
                    "stops at the wall, not past it.",
    }


def _emit(obj):
    sys.stdout.write(json.dumps(obj, sort_keys=True, separators=(",", ":")) + "\n")


# ---------------------------------------------------------------------------
# Budget validation — the token refusal lives here, by construction.
# ---------------------------------------------------------------------------

class BudgetError(Exception):
    """A declared budget is refused (token proxy) or empty (no ceiling)."""


def build_budget(max_rows, max_seconds, max_bytes, token_asked):
    """Turn declared ceilings into a validated budget, or refuse.

    Raises BudgetError with a readable reason when the budget is a token proxy
    or carries no real ceiling. This is the load-bearing gate: an off-covenant
    budget cannot be constructed.
    """
    if token_asked:
        raise BudgetError(REFUSAL_REASON)
    budget = {}
    if max_rows is not None:
        if max_rows < 0:
            raise BudgetError("--max-rows must be >= 0")
        budget["rows"] = max_rows
    if max_seconds is not None:
        if max_seconds < 0:
            raise BudgetError("--max-seconds must be >= 0")
        budget["seconds"] = max_seconds
    if max_bytes is not None:
        if max_bytes < 0:
            raise BudgetError("--max-bytes must be >= 0")
        budget["bytes"] = max_bytes
    if not budget:
        raise BudgetError(
            "no ceiling declared -- a weir with no wall holds nothing. declare at "
            "least one of --max-rows, --max-seconds, --max-bytes."
        )
    return budget


def _breach(budget, rows, byts, elapsed):
    """Return the (unit, limit, count) of the FIRST budget crossed, or None.

    Order is deterministic: rows, then bytes, then seconds. A wall-time breach is
    the only environment-dependent one; rows and bytes are exact. When a record
    would cross more than one ceiling at once, the row/bytes breach is reported
    first so the reproducible axis is the named cut whenever one applies.
    """
    if "rows" in budget and rows > budget["rows"]:
        return ("rows", budget["rows"], rows)
    if "bytes" in budget and byts > budget["bytes"]:
        return ("bytes", budget["bytes"], byts)
    if "seconds" in budget and elapsed > budget["seconds"]:
        return ("seconds", budget["seconds"], round(elapsed, 3))
    return None


# ---------------------------------------------------------------------------
# The ledger — an append-only receipt, replayable by trace-id.
# ---------------------------------------------------------------------------

def _append_ledger(ledger_path, record):
    with open(ledger_path, "a") as f:
        f.write(json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n")


# ---------------------------------------------------------------------------
# Subcommands.
# ---------------------------------------------------------------------------

def cmd_budget(args):
    """Print the budget model — the three real units and the refused proxy."""
    _emit(budget_model())
    return 0


def cmd_check(args):
    """Validate a declared budget without running anything.

    exit 0 = a real, non-empty budget; exit 2 = refused (token) or empty.
    """
    try:
        budget = build_budget(args.max_rows, args.max_seconds, args.max_bytes,
                              args.max_tokens is not None)
    except BudgetError as exc:
        sys.stderr.write("weir: %s\n" % exc)
        return 2
    _emit({"kind": "budget-ok", "budget": budget})
    return 0


def _meter_stream(proc, budget, trace_id, ledger_path, clock):
    """Read proc.stdout line by line, meter flow, cut at the first ceiling.

    Returns (breach_or_None, rows, bytes, elapsed). Pure with respect to the
    declared budget: for a given byte stream and a rows/bytes budget the cut is
    byte-identical (clock is injected so the deterministic core is testable).
    """
    start = clock()
    rows = 0
    byts = 0
    out = sys.stdout.buffer
    for raw in proc.stdout:
        # raw includes the trailing newline; that is real emitted bytes.
        next_rows = rows + 1
        next_bytes = byts + len(raw)
        elapsed = clock() - start
        breach = _breach(budget, next_rows, next_bytes, elapsed)
        if breach is not None:
            # Stop AT the wall: do not emit the record that crosses it.
            return breach, rows, byts, elapsed
        out.write(raw)
        rows = next_rows
        byts = next_bytes
    out.flush()
    return None, rows, byts, (clock() - start)


def cmd_run(args):
    """Run a command under the declared budget, cutting flow at the ceiling."""
    if not args.command:
        sys.stderr.write("weir: run needs a command after `--`, e.g. "
                         "`weir run --max-rows 100 -- python3 emit.py`\n")
        return 2
    try:
        budget = build_budget(args.max_rows, args.max_seconds, args.max_bytes,
                              args.max_tokens is not None)
    except BudgetError as exc:
        sys.stderr.write("weir: %s\n" % exc)
        return 2

    ledger_path = args.ledger or "weir.ledger.jsonl"
    trace_id = args.trace or str(uuid.uuid4())

    data = b""
    if args.input:
        try:
            with open(args.input, "rb") as f:
                data = f.read()
        except OSError as exc:
            sys.stderr.write("weir: cannot read --input %s: %s\n" % (args.input, exc))
            return 2

    _append_ledger(ledger_path, {"kind": "run-start", "trace_id": trace_id,
                                 "budget": budget, "cmd": args.command})
    try:
        proc = subprocess.Popen(args.command, stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except (OSError, ValueError) as exc:
        sys.stderr.write("weir: cannot launch command: %s\n" % exc)
        _append_ledger(ledger_path, {"kind": "run-end", "trace_id": trace_id,
                                     "verdict": "launch-failed", "error": str(exc)})
        return 2

    # Feed input, then meter the output stream.
    try:
        if data:
            proc.stdin.write(data)
        proc.stdin.close()
    except (BrokenPipeError, OSError):
        pass

    breach, rows, byts, elapsed = _meter_stream(proc, budget, trace_id,
                                                ledger_path, time.monotonic)

    if breach is not None:
        # Cut the command off at the wall.
        try:
            proc.terminate()
        except OSError:
            pass
        unit, limit, count = breach
        rec = {"kind": "cut", "trace_id": trace_id, "budget": unit,
               "limit": limit, "count_at_cut": count,
               "rows": rows, "bytes": byts, "seconds": round(elapsed, 3),
               "reproducible": unit in ("rows", "bytes")}
        _append_ledger(ledger_path, rec)
        _append_ledger(ledger_path, {"kind": "run-end", "trace_id": trace_id,
                                     "verdict": "cut", "budget": unit})
        summary = {"kind": "run-summary", "trace_id": trace_id, "ledger": ledger_path,
                   "verdict": "cut", "budget": unit, "limit": limit,
                   "count_at_cut": count, "reproducible": unit in ("rows", "bytes")}
        sys.stderr.write(json.dumps(summary, sort_keys=True, separators=(",", ":")) + "\n")
        return 3

    proc.wait()
    _append_ledger(ledger_path, {"kind": "run-end", "trace_id": trace_id,
                                 "verdict": "under-budget", "rows": rows,
                                 "bytes": byts, "seconds": round(elapsed, 3),
                                 "exit": proc.returncode})
    summary = {"kind": "run-summary", "trace_id": trace_id, "ledger": ledger_path,
               "verdict": "under-budget", "rows": rows, "bytes": byts,
               "seconds": round(elapsed, 3), "cmd_exit": proc.returncode}
    sys.stderr.write(json.dumps(summary, sort_keys=True, separators=(",", ":")) + "\n")
    # weir's own verdict is under-budget (0); the command's own non-zero exit is
    # reported in the summary but does not become weir's verdict — weir gates the
    # budget, not the command's correctness.
    return 0


def cmd_replay(args):
    """Print every ledger record for a trace-id."""
    if not args.ledger or not args.trace:
        sys.stderr.write("weir: replay needs --ledger and --trace\n")
        return 2
    try:
        f = open(args.ledger)
    except OSError as exc:
        sys.stderr.write("weir: cannot read ledger %s: %s\n" % (args.ledger, exc))
        return 2
    found = False
    with f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            if rec.get("trace_id") == args.trace:
                found = True
                _emit(rec)
    return 0 if found else 2


# ---------------------------------------------------------------------------
# Selftest — proves the deterministic core (rows + bytes) is byte-identical.
# ---------------------------------------------------------------------------

def _selftest():
    """In-process checks of the deterministic core and the token refusal.

    Returns (passed, total). The clock is frozen so the deterministic axes are
    proven independent of wall-time.
    """
    checks = []

    def ok(name, cond):
        checks.append((name, bool(cond)))

    # 1. token budget is refused, by construction.
    try:
        build_budget(None, None, None, token_asked=True)
        ok("token budget refused", False)
    except BudgetError as e:
        ok("token budget refused", "never tokens" in str(e))

    # 2. an empty budget is refused.
    try:
        build_budget(None, None, None, token_asked=False)
        ok("empty budget refused", False)
    except BudgetError as e:
        ok("empty budget refused", "no ceiling" in str(e))

    # 3. a real budget builds.
    try:
        b = build_budget(10, None, 1000, token_asked=False)
        ok("real budget builds", b == {"rows": 10, "bytes": 1000})
    except BudgetError:
        ok("real budget builds", False)

    # 4. rows breach is exact and reported first.
    ok("rows breach at N+1", _breach({"rows": 3}, 4, 0, 0.0) == ("rows", 3, 4))
    ok("no breach under rows", _breach({"rows": 3}, 3, 0, 0.0) is None)

    # 5. bytes breach is exact.
    ok("bytes breach", _breach({"bytes": 100}, 0, 101, 0.0) == ("bytes", 100, 101))
    ok("no breach under bytes", _breach({"bytes": 100}, 0, 100, 0.0) is None)

    # 6. rows reported before bytes when both cross (reproducible axis wins).
    ok("rows before bytes", _breach({"rows": 1, "bytes": 1}, 2, 2, 0.0)[0] == "rows")

    # 7. seconds is only breached when no exact axis is, and is env-dependent.
    ok("seconds breach", _breach({"seconds": 1.0}, 0, 0, 1.5) == ("seconds", 1.0, 1.5))

    # 8. deterministic core: meter a fixed stream twice under a rows budget,
    #    with a frozen clock -> byte-identical cut both times.
    class _FakeProc:
        def __init__(self, lines):
            self.stdout = iter(lines)
    frozen = lambda: 0.0
    lines = [b'{"r":1}\n', b'{"r":2}\n', b'{"r":3}\n', b'{"r":4}\n']

    import io
    def meter_once():
        # capture emitted bytes without touching real stdout
        buf = io.BytesIO()
        real = sys.stdout
        class _W:
            buffer = buf
            def flush(self_inner):
                pass
        sys.stdout = _W()
        try:
            res = _meter_stream(_FakeProc(list(lines)), {"rows": 2}, "t",
                                None, frozen)
        finally:
            sys.stdout = real
        return res, buf.getvalue()

    (res1, emitted1) = meter_once()
    (res2, emitted2) = meter_once()
    ok("core cut is deterministic", res1 == res2)
    ok("core emitted bytes deterministic", emitted1 == emitted2)
    ok("core cut at rows ceiling", res1[0] == ("rows", 2, 3))
    ok("core emitted exactly 2 rows", emitted1 == b'{"r":1}\n{"r":2}\n')

    passed = sum(1 for _, c in checks if c)
    total = len(checks)
    for name, c in checks:
        sys.stderr.write("  [%s] %s\n" % ("PASS" if c else "FAIL", name))
    sys.stderr.write("weir selftest: %d/%d\n" % (passed, total))
    return passed, total


def build_parser():
    p = argparse.ArgumentParser(
        prog="weir",
        description="run a pipeline under a declared budget -- rows, wall-time, "
                    "or bytes, never tokens.")
    p.add_argument("--selftest", action="store_true",
                   help="run in-process checks of the deterministic core and exit")
    sub = p.add_subparsers(dest="cmd")

    sp_budget = sub.add_parser("budget", help="print the budget model (real units + refused proxy)")
    sp_budget.set_defaults(func=cmd_budget)

    def add_budget_flags(sp):
        sp.add_argument("--max-rows", type=int, default=None, help="ceiling: records emitted")
        sp.add_argument("--max-seconds", type=float, default=None,
                        help="ceiling: wall-time seconds (environment-dependent)")
        sp.add_argument("--max-bytes", type=int, default=None, help="ceiling: bytes emitted")
        sp.add_argument("--max-tokens", type=int, default=None,
                        help="REFUSED -- tokens are not a meterable real resource (exit 2)")

    sp_check = sub.add_parser("check", help="validate a declared budget without running")
    add_budget_flags(sp_check)
    sp_check.set_defaults(func=cmd_check)

    sp_run = sub.add_parser("run", help="run a command under the budget, cutting flow at the ceiling")
    add_budget_flags(sp_run)
    sp_run.add_argument("--input", help="file fed to the command's stdin")
    sp_run.add_argument("--ledger", help="ledger path (default weir.ledger.jsonl)")
    sp_run.add_argument("--trace", help="trace-id for this run (default: a fresh uuid)")
    sp_run.add_argument("command", nargs=argparse.REMAINDER,
                        help="the command to run, after `--`")
    sp_run.set_defaults(func=cmd_run)

    sp_replay = sub.add_parser("replay", help="print every ledger record for a trace-id")
    sp_replay.add_argument("--ledger", help="ledger path")
    sp_replay.add_argument("--trace", help="trace-id to replay")
    sp_replay.set_defaults(func=cmd_replay)

    return p


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    parser = build_parser()
    # `run`'s REMAINDER swallows the command after `--`; strip a leading `--`.
    args = parser.parse_args(argv)
    if getattr(args, "selftest", False):
        passed, total = _selftest()
        return 0 if passed == total else 1
    if not getattr(args, "cmd", None):
        parser.print_help(sys.stderr)
        return 2
    # For `run`, drop a leading "--" left by REMAINDER.
    if args.cmd == "run" and args.command and args.command[0] == "--":
        args.command = args.command[1:]
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
