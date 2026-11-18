#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""loop — feed a small JSONL tool's output back into its own input, a bounded number of times, with a record.

You have a little JSON-lines tool whose output has the same shape as its input — a Game of Life step, a smoothing
pass, a "tidy this list once more" filter. A shell pipe can run it twice (`A | A`), or ten times if you type it ten
times. What the shell won't do: run it N times from one command, stop early when the output stops changing, refuse a
tool that can't be fed its own output, and hand you a receipt of every pass. `loop` does that. It is the loop around a
stage — the feedback arrow — and nothing more.

WHAT IT DOES, in order:
  1. Check first. A stage can be looped only if it accepts the records it emits: a `transform`, a `filter`, or a
     `fold` you declare closed under its own I/O (`--closed`; e.g. life-fold, whose next generation has the same shape
     as the last). A `source` or a `sink` can never be looped. The bound is required: 1 <= --max-passes <= 1,000,000.
     A loop that does not check is refused at the desk (exit 3) before a single pass runs.
  2. Run the stage on your input (stdin, or --input). Its output becomes the next pass's input — exactly one pass of
     delay, which is what makes a loop a computation and not an equation.
  3. Stop when the bound is reached, or — with `--until fixed` — as soon as a pass returns its own input byte for byte
     (a fixed point: nothing left to change).
  4. Record every pass to an append-only ledger (JSON-lines): trace id, pass number, bytes in, bytes out, the sha256 of
     the output, the stage's exit code and a verdict; then one summary row saying why it stopped.
  5. Fail clean. If a pass exits non-zero, `loop` stops, records that pass as failed, prints nothing on stdout, and
     exits 5 naming the pass. No later pass runs on a broken input.

THE MODEL. The same five port-verbs every composition gift here uses (`typecheck`, `declare`, `conductor`):
source, transform, filter, fold, sink. A loop takes on its stage's verb — a loop around a transform is a transform, a
loop around a closed fold is a fold — so it drops into any pipeline that stage could join. It is not a new kind of
thing; it is the feedback arrow (↻) around one that already exists.

DETERMINISM. `loop` adds nothing that varies: no clock, no random id, no timestamp in the ledger. The trace id is
derived from the stage, the bound, the stop rule and the input bytes unless you pass --trace, so the same loop on the
same input writes the same ledger rows, byte for byte. If your stage is deterministic, the whole loop is.

HONEST CEILING. loop runs the command you give it, as often as you allow — it is exactly as safe as that command and
does not sandbox it. Its check is the TYPE-level gate (the stage can be fed its own output) and the bound; it does not
prove the records really fit, that the loop converges, or that the answer is right. `--until fixed` stops on an exact
byte repeat only; a loop that cycles (a blinker) never repeats its own input and runs to the bound, which loop
reports (exit 6) rather than hides.

No dependencies beyond the Python standard library. MIT licensed.

USAGE
  loop verbs
      Print the five port-verbs and whether each can be looped (JSON-lines).

  loop check --stage life:fold:'node life-fold.js' --closed --max-passes 200
      Decide the loop WITHOUT running it. Exit 0 if it can be looped, 3 if not, 4 if the verb is undeclared.

  loop run --stage life:fold:'node life-fold.js' --closed --max-passes 200 [--until passes|fixed]
           [--input FILE] [--ledger FILE] [--trace ID]
      Check, then run up to --max-passes passes. stdout is the last pass's output. Appends one row per pass and one
      summary row to --ledger (default: loop.ledger.jsonl).

  loop replay --ledger FILE --trace TRACE_ID
      Print every row for a trace id, in pass order (JSON-lines).

EXIT CODES
  0  ok (can loop / ran to its stop rule / replayed)
  2  usage error (bad arguments, unreadable file, unknown trace on replay)
  3  the loop does not check — not run (a source or sink, an unclosed fold, or a missing or out-of-range bound)
  4  the stage's port-verb is undeclared or not one of the five
  5  a pass failed at runtime (the loop stopped; the ledger names the pass)
  6  --until fixed was asked for and the bound was reached first (the output of the last pass is still printed)
"""
import argparse
import hashlib
import json
import os
import shlex
import subprocess
import sys

PORT_VERBS = {
    "source":    "nothing -> JSONL      (emits; no meaningful stdin)",
    "transform": "JSONL   -> JSONL      (record in, record out)",
    "filter":    "JSONL   -> JSONL'     (record in, subset out; output type <= input)",
    "fold":      "JSONL   -> JSONL_agg  (records in, an aggregate/narrower record out)",
    "sink":      "JSONL   -> nothing    (terminal side effect, no pipeable stdout)",
}
MAX_PASSES_CEILING = 1_000_000
UNTIL = ("passes", "fixed")


def loopable(verb, closed):
    """-> (ok, reason). A stage can be fed its own output only if it accepts what it emits."""
    if verb not in PORT_VERBS:
        raise ValueError("port_verb '%s' is not one of the five (%s) — cannot decide"
                         % (verb, ", ".join(sorted(PORT_VERBS))))
    if verb == "source":
        return False, "a source takes no input, so its output has nowhere to go back to"
    if verb == "sink":
        return False, "a sink emits nothing, so there is nothing to feed back"
    if verb == "fold" and not closed:
        return False, ("a fold narrows its input to an aggregate; loop it only if it is closed under its own I/O "
                       "(declare --closed, as life-fold is)")
    return True, ""


def check_bound(max_passes):
    """-> (ok, reason). The bound is mandatory and finite."""
    if max_passes is None:
        return False, "--max-passes is required: an unbounded loop is refused"
    if not isinstance(max_passes, int) or max_passes < 1 or max_passes > MAX_PASSES_CEILING:
        return False, "--max-passes must be an integer from 1 to %d" % MAX_PASSES_CEILING
    return True, ""


def parse_stage(token):
    """slug:verb:cmd (cmd shell-split) -> (slug, verb, argv). The same token form conductor uses."""
    parts = token.split(":", 2)
    if len(parts) < 2 or not parts[0] or not parts[1]:
        raise ValueError("a stage is slug:verb:cmd, got %r" % token)
    slug, verb = parts[0], parts[1]
    argv = shlex.split(parts[2]) if len(parts) == 3 and parts[2].strip() else []
    return slug, verb, argv


def sha256(buf):
    return hashlib.sha256(buf).hexdigest()


def derive_trace(slug, verb, argv, max_passes, until, data):
    """A trace id that is a pure function of the loop and its input — no clock, no randomness."""
    key = json.dumps([slug, verb, argv, max_passes, until, sha256(data)], separators=(",", ":"))
    return "loop-" + sha256(key.encode("utf-8"))[:16]


def emit(handle, row):
    handle.write(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n")
    handle.flush()


def run_loop(slug, verb, argv, max_passes, until, data, ledger_path, trace):
    """Run the loop. -> (exit_code, final_output_bytes_or_None, stopped)."""
    with open(ledger_path, "a", encoding="utf-8") as ledger:
        current = data
        for n in range(1, max_passes + 1):
            try:
                proc = subprocess.run(argv, input=current, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            except OSError as exc:
                emit(ledger, {"trace": trace, "kind": "pass", "pass": n, "slug": slug, "bytes_in": len(current),
                              "bytes_out": 0, "sha256_out": None, "exit": None, "verdict": "failed",
                              "error": "could not start the stage: %s" % exc.strerror})
                emit(ledger, {"trace": trace, "kind": "summary", "passes": n, "stopped": "failed",
                              "sha256_out": None})
                sys.stderr.write("loop: pass %d failed to start (%s)\n" % (n, exc.strerror))
                return 5, None, "failed"
            out = proc.stdout
            if proc.returncode != 0:
                emit(ledger, {"trace": trace, "kind": "pass", "pass": n, "slug": slug, "bytes_in": len(current),
                              "bytes_out": len(out), "sha256_out": sha256(out), "exit": proc.returncode,
                              "verdict": "failed"})
                emit(ledger, {"trace": trace, "kind": "summary", "passes": n, "stopped": "failed",
                              "sha256_out": None})
                sys.stderr.write("loop: pass %d of '%s' exited %d — stopped\n" % (n, slug, proc.returncode))
                return 5, None, "failed"
            fixed = out == current
            emit(ledger, {"trace": trace, "kind": "pass", "pass": n, "slug": slug, "bytes_in": len(current),
                          "bytes_out": len(out), "sha256_out": sha256(out), "exit": 0,
                          "verdict": "fixed" if fixed else "ok"})
            current = out
            if until == "fixed" and fixed:
                emit(ledger, {"trace": trace, "kind": "summary", "passes": n, "stopped": "fixed",
                              "sha256_out": sha256(current)})
                return 0, current, "fixed"
        stopped = "bound"
        emit(ledger, {"trace": trace, "kind": "summary", "passes": max_passes, "stopped": stopped,
                      "sha256_out": sha256(current)})
        return (6 if until == "fixed" else 0), current, stopped


def replay(ledger_path, trace):
    rows = []
    with open(ledger_path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            if row.get("trace") == trace:
                rows.append(row)
    return rows


def main(argv=None):
    parser = argparse.ArgumentParser(prog="loop", description="feed a JSONL stage its own output, bounded, with a record")
    sub = parser.add_subparsers(dest="verb", required=True)
    sub.add_parser("verbs")
    for name in ("check", "run"):
        sp = sub.add_parser(name)
        sp.add_argument("--stage", required=True, help="slug:verb:cmd")
        sp.add_argument("--closed", action="store_true", help="the fold is closed under its own I/O")
        sp.add_argument("--max-passes", type=int, default=None)
        sp.add_argument("--until", choices=UNTIL, default="passes")
        if name == "run":
            sp.add_argument("--input")
            sp.add_argument("--ledger", default="loop.ledger.jsonl")
            sp.add_argument("--trace")
    rp = sub.add_parser("replay")
    rp.add_argument("--ledger", required=True)
    rp.add_argument("--trace", required=True)
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return 2 if exc.code not in (0, None) else 0

    if args.verb == "verbs":
        for verb in ("source", "transform", "filter", "fold", "sink"):
            can = verb in ("transform", "filter")
            note = "loopable" if can else ("loopable only with --closed" if verb == "fold" else "never loopable")
            print(json.dumps({"port_verb": verb, "contract": PORT_VERBS[verb], "loop": note},
                             separators=(",", ":")))
        return 0

    if args.verb == "replay":
        if not os.path.isfile(args.ledger):
            sys.stderr.write("loop: no ledger at %s\n" % args.ledger)
            return 2
        rows = replay(args.ledger, args.trace)
        if not rows:
            sys.stderr.write("loop: no rows for trace %s\n" % args.trace)
            return 2
        for row in rows:
            print(json.dumps(row, sort_keys=True, separators=(",", ":")))
        return 0

    try:
        slug, verb, cmd = parse_stage(args.stage)
        ok, why = loopable(verb, args.closed)
    except ValueError as exc:
        sys.stderr.write("loop: %s\n" % exc)
        return 4 if "port_verb" in str(exc) else 2
    if not ok:
        sys.stderr.write("loop: '%s' cannot be looped — %s\n" % (slug, why))
        return 3
    ok, why = check_bound(args.max_passes)
    if not ok:
        sys.stderr.write("loop: %s\n" % why)
        return 3
    if args.verb == "check":
        print(json.dumps({"slug": slug, "port_verb": verb, "loop_port_verb": verb, "max_passes": args.max_passes,
                          "until": args.until, "loopable": True}, sort_keys=True, separators=(",", ":")))
        return 0

    if not cmd:
        sys.stderr.write("loop: stage '%s' has no command to run\n" % slug)
        return 2
    try:
        if args.input:
            with open(args.input, "rb") as handle:
                data = handle.read()
        else:
            data = sys.stdin.buffer.read()
    except OSError as exc:
        sys.stderr.write("loop: cannot read input (%s)\n" % exc.strerror)
        return 2
    trace = args.trace or derive_trace(slug, verb, cmd, args.max_passes, args.until, data)
    try:
        code, out, _stopped = run_loop(slug, verb, cmd, args.max_passes, args.until, data, args.ledger, trace)
    except OSError as exc:
        sys.stderr.write("loop: cannot write the ledger (%s)\n" % exc.strerror)
        return 2
    if out is not None:
        sys.stdout.buffer.write(out)
        sys.stdout.flush()
    return code


if __name__ == "__main__":
    sys.exit(main())
