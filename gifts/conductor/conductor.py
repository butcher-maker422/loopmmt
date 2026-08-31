#!/usr/bin/env python3
"""conductor — run a declared pipeline of small JSONL tools, with a record.

You have a saved "score" — an ordered pipeline of little JSON-lines tools, the
kind the `declare` gift writes. You could run it by hand with a shell pipe. What
the shell won't do: check the pipeline typechecks *before* it runs, thread one
trace-id through the whole run, and hand you back a record of what each stage
actually did — its exit code, how many bytes it read and wrote, whether it was
the stage that broke. `conductor` does that. It is a provenance-runner, not a
shell wrapper: every run leaves a receipt you can read back, and a run that fails
tells you *which stage* failed, in order, not just that the pipe collapsed.

WHAT IT DOES, in order:
  1. Typecheck first. conductor carries its own copy of the five-verb composition
     gate (the same rule the `typecheck` and `declare` gifts use) and refuses to
     run a pipeline that does not compose — a sink that isn't last, a source that
     isn't first. You never watch a broken pipeline half-run; it is stopped at
     the desk (exit 3), before a single stage is launched.
  2. Run the stages in order, piping each stage's stdout into the next stage's
     stdin, exactly as a shell pipe would — but under one trace-id.
  3. Record every stage to an append-only ledger: trace-id, stage index, slug,
     command, exit code, bytes in, bytes out, and a verdict (ok / failed /
     skipped-after-failure). The ledger is JSON-lines you can replay by trace-id.
  4. Fail clean. If a stage exits non-zero, conductor stops the run, records that
     stage as failed and every later stage as skipped, and exits non-zero itself
     — naming the stage that broke. No later stage runs on a broken input.

THE MODEL. Five port-verbs on the shared JSON-lines interface, and only five
(the same five the `port`, `map`, `typecheck`, and `declare` gifts use):

  source     : nothing -> JSONL      (emits; no meaningful stdin)
  transform  : JSONL   -> JSONL      (record in, record out)
  filter     : JSONL   -> JSONL'     (record in, subset out; output type <= input)
  fold       : JSONL   -> JSONL_agg  (records in, an aggregate/narrower record out)
  sink       : JSONL   -> nothing    (terminal side effect, no pipeable stdout)

A pipeline composes iff every adjacent join A -> B has A EMITS (A.verb != sink)
and B ACCEPTS (B.verb != source). conductor carries its own copy of that gate so
it stands alone — a gift is single-file and zero-dependency by covenant, so it
agrees with `typecheck` and `declare` by sharing the RULE, not by importing them.

WHY A RECORD, NOT JUST A PIPE. A shell pipe answers "did it work?" with a single
combined exit status and a jumble of interleaved stderr. When a five-stage
pipeline produces nothing, the shell won't tell you *which* stage went dark.
conductor's ledger does: one record per stage, in order, so "what happened to
this run?" has an answer. This is tracebus's trace-id-and-ledger idea (the
`tracebus` gift is a routed message bus with a replayable ledger) applied to a
LINEAR ordered run instead of a fanned-out bus — a different shape, the same
honesty about leaving a receipt.

THE SCORE / STAGE FORMAT. A stage is `{"slug": ..., "port_verb": ..., "cmd": [...]}`
— the port-verb for the typecheck, and `cmd` the argv list conductor executes for
that stage (e.g. ["python3", "census.py"]). Stages come from `--stage` flags, or
piped in on stdin as JSON-lines (the shape `declare show` emits, with a `cmd`
added), or read from a declare score file with `--score` when the score carries
per-stage `cmd`s. A stage with a port-verb but no `cmd` can be typechecked but
not run (conductor says so and exits 2 on a run).

HONEST CEILING. conductor runs the commands you give it — it is exactly as safe
as the commands in the score, and it does not sandbox them. Its typecheck is the
TYPE-level gate (ports line up so data can flow), NOT a proof the RECORDS fit or
that a stage is correct; a pipeline can typecheck clean, run to completion, and
still have done the wrong thing. conductor proves the run happened, in order,
with a receipt — it never proves the run was right.

conductor's own port-verb is `sink`: it consumes a pipeline (and the data flowing
through it) and produces side effects — the stages' work and the ledger — with no
pipeable JSONL on its own stdout. The run record goes to the ledger; conductor's
stdout is the final stage's stdout, passed through.

No dependencies beyond the Python standard library. MIT licensed.

USAGE
  conductor verbs
      Print the five port-verbs and their contracts (JSON-lines).

  conductor check --stage census:source:'python3 census.py' --stage map:fold:'python3 map.py'
      Typecheck the pipeline WITHOUT running it. Exit 0 if it composes, 3 if not,
      4 if a verb is undeclared. (Stage token: slug:verb:cmd, cmd shell-split.)

  conductor run --stage census:source:'python3 census.py' --stage map:fold:'python3 map.py' \
                [--ledger FILE] [--input FILE]
      Typecheck, then run the stages in order under one trace-id, piping
      stdout->stdin. --input seeds the first stage's stdin (default: empty).
      Appends one record per stage to --ledger (default: conductor.ledger.jsonl).
      Final stage's stdout goes to conductor's stdout. Exit 0 if every stage
      succeeded, 5 if a stage failed (naming it), 3/4 if the pipeline doesn't
      typecheck.

  conductor replay --ledger FILE --trace TRACE_ID
      Print every stage record for a trace-id, in run order (JSON-lines).

EXIT CODES
  0  ok (composed / ran clean / replayed)
  3  the pipeline does not typecheck — not run
  4  a stage's port-verb is undeclared or not one of the five
  5  a stage failed at runtime (the run stopped; the ledger names it)
  2  usage error (bad arguments, a stage with no cmd on a run, unreadable file)
"""
import argparse
import json
import os
import shlex
import subprocess
import sys
import uuid

PORT_VERBS = {
    "source":    "nothing -> JSONL      (emits; no meaningful stdin)",
    "transform": "JSONL   -> JSONL      (record in, record out)",
    "filter":    "JSONL   -> JSONL'     (record in, subset out; output type <= input)",
    "fold":      "JSONL   -> JSONL_agg  (records in, an aggregate/narrower record out)",
    "sink":      "JSONL   -> nothing    (terminal side effect, no pipeable stdout)",
}


def emits(verb):
    """True iff a stage with this verb produces pipeable stdout (can feed right)."""
    return verb != "sink"


def accepts(verb):
    """True iff a stage with this verb consumes stdin (can be fed from the left)."""
    return verb != "source"


def typecheck_stages(stages):
    """Decide a pipeline of (slug, verb, cmd) or (slug, verb) tuples.

    Returns (ok, broken). Raises ValueError on an undeclared/unknown verb. The
    same gate `typecheck`/`declare` carry — copied, per the single-file covenant."""
    for st in stages:
        slug, verb = st[0], st[1]
        if verb not in PORT_VERBS:
            raise ValueError(
                "stage '%s' declares port_verb '%s', not one of the five (%s) — "
                "cannot decide" % (slug, verb, ", ".join(sorted(PORT_VERBS)))
            )
    broken = []
    for i in range(len(stages) - 1):
        a_slug, a_verb = stages[i][0], stages[i][1]
        b_slug, b_verb = stages[i + 1][0], stages[i + 1][1]
        reasons = []
        if not emits(a_verb):
            reasons.append({"side": "from", "slug": a_slug, "verb": a_verb,
                            "why": "a sink emits nothing to feed the next stage — "
                                   "a sink is only legal as the last stage"})
        if not accepts(b_verb):
            reasons.append({"side": "to", "slug": b_slug, "verb": b_verb,
                            "why": "a source accepts nothing from the previous stage — "
                                   "a source is only legal as the first stage"})
        if reasons:
            broken.append({"index": i, "from": a_slug, "to": b_slug, "reasons": reasons})
    return (len(broken) == 0, broken)


def _emit(obj):
    """Print one JSON-line, deterministically (sorted keys, compact separators)."""
    sys.stdout.write(json.dumps(obj, sort_keys=True, separators=(",", ":")) + "\n")


def _parse_stage_token(tok):
    """Parse 'slug:verb' or 'slug:verb:cmd' -> (slug, verb, cmd_list_or_None).

    Only the first two colons split slug/verb; the remainder is the command
    (shell-split), so a cmd may itself contain colons."""
    parts = tok.split(":", 2)
    if len(parts) < 2:
        raise ValueError("stage token '%s' must be slug:verb[:cmd]" % tok)
    slug, verb = parts[0], parts[1]
    cmd = shlex.split(parts[2]) if len(parts) == 3 and parts[2] else None
    return (slug, verb, cmd)


def _collect_stages(args):
    """Collect stages from --stage tokens or stdin JSON-lines. Returns (stages, err)."""
    stages = []
    if getattr(args, "stage", None):
        for tok in args.stage:
            try:
                stages.append(_parse_stage_token(tok))
            except ValueError as exc:
                sys.stderr.write("conductor: %s\n" % exc)
                return None, 2
    if getattr(args, "from_stdin", False):
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except ValueError:
                sys.stderr.write("conductor: stdin line is not JSON: %s\n" % line)
                return None, 2
            slug = obj.get("slug")
            if slug is None:
                sys.stderr.write("conductor: stdin record has no 'slug': %s\n" % line)
                return None, 2
            stages.append((slug, obj.get("port_verb", ""), obj.get("cmd")))
    if not stages:
        sys.stderr.write("conductor: no stages (use --stage, or --stdin with JSON-lines)\n")
        return None, 2
    return stages, None


def _typecheck_or_report(stages):
    """Run the gate; emit a report on failure. Returns exit code (0 ok, 3/4 fail)."""
    try:
        ok, broken = typecheck_stages(stages)
    except ValueError as exc:
        _emit({"kind": "error", "status": "undeclared", "detail": str(exc)})
        return 4
    if not ok:
        _emit({"kind": "refused", "reason": "pipeline does not typecheck", "broken_joins": broken})
        return 3
    return 0


def cmd_verbs(args):
    for name in ["source", "transform", "filter", "fold", "sink"]:
        _emit({"port_verb": name, "contract": PORT_VERBS[name]})
    return 0


def cmd_check(args):
    stages, err = _collect_stages(args)
    if err is not None:
        return err
    code = _typecheck_or_report(stages)
    if code == 0:
        _emit({"kind": "check", "typechecks": True, "n_stages": len(stages)})
    return code


def _append_ledger(ledger_path, record):
    with open(ledger_path, "a") as f:
        f.write(json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n")


def cmd_run(args):
    stages, err = _collect_stages(args)
    if err is not None:
        return err
    # 1. Typecheck first — never launch a stage of a broken pipeline.
    code = _typecheck_or_report(stages)
    if code != 0:
        return code
    # Every stage must carry a cmd to be run.
    for slug, verb, cmd in stages:
        if not cmd:
            sys.stderr.write("conductor: stage '%s' has no cmd — cannot run "
                             "(use slug:verb:cmd)\n" % slug)
            return 2
    ledger_path = args.ledger or "conductor.ledger.jsonl"
    trace_id = args.trace or str(uuid.uuid4())
    # Seed input.
    if args.input:
        try:
            with open(args.input, "rb") as f:
                data = f.read()
        except OSError as exc:
            sys.stderr.write("conductor: cannot read --input %s: %s\n" % (args.input, exc))
            return 2
    else:
        data = b""
    _append_ledger(ledger_path, {"kind": "run-start", "trace_id": trace_id,
                                 "n_stages": len(stages)})
    failed_index = None
    for i, (slug, verb, cmd) in enumerate(stages):
        if failed_index is not None:
            _append_ledger(ledger_path, {"kind": "stage", "trace_id": trace_id,
                                         "index": i, "slug": slug, "cmd": cmd,
                                         "verdict": "skipped", "reason": "an earlier stage failed"})
            continue
        try:
            proc = subprocess.run(cmd, input=data, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE)
        except (OSError, ValueError) as exc:
            _append_ledger(ledger_path, {"kind": "stage", "trace_id": trace_id,
                                         "index": i, "slug": slug, "cmd": cmd,
                                         "verdict": "failed", "exit": None,
                                         "error": str(exc)})
            failed_index = i
            continue
        rec = {"kind": "stage", "trace_id": trace_id, "index": i, "slug": slug,
               "cmd": cmd, "exit": proc.returncode,
               "bytes_in": len(data), "bytes_out": len(proc.stdout),
               "verdict": "ok" if proc.returncode == 0 else "failed"}
        if proc.returncode != 0:
            rec["stderr_tail"] = proc.stderr.decode("utf-8", "replace")[-500:]
        _append_ledger(ledger_path, rec)
        if proc.returncode != 0:
            failed_index = i
            continue
        data = proc.stdout
    if failed_index is None:
        # Final stage's stdout is conductor's stdout (a sink typically emits none).
        sys.stdout.buffer.write(data)
        _append_ledger(ledger_path, {"kind": "run-end", "trace_id": trace_id, "verdict": "ok"})
        _emit_run_summary(trace_id, ledger_path, ok=True, failed_index=None, stages=stages)
        return 0
    _append_ledger(ledger_path, {"kind": "run-end", "trace_id": trace_id, "verdict": "failed",
                                 "failed_index": failed_index})
    _emit_run_summary(trace_id, ledger_path, ok=False, failed_index=failed_index, stages=stages)
    return 5


def _emit_run_summary(trace_id, ledger_path, ok, failed_index, stages):
    summary = {"kind": "run-summary", "trace_id": trace_id, "ledger": ledger_path,
               "n_stages": len(stages), "ok": ok}
    if not ok:
        summary["failed_stage"] = {"index": failed_index, "slug": stages[failed_index][0]}
    # summary goes to stderr so it never pollutes the passed-through final stdout
    sys.stderr.write(json.dumps(summary, sort_keys=True, separators=(",", ":")) + "\n")


def cmd_replay(args):
    if not args.ledger or not args.trace:
        sys.stderr.write("conductor: replay needs --ledger and --trace\n")
        return 2
    try:
        with open(args.ledger, "r") as f:
            lines = f.readlines()
    except OSError as exc:
        sys.stderr.write("conductor: cannot read ledger %s: %s\n" % (args.ledger, exc))
        return 2
    found = False
    for line in lines:
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
    if not found:
        sys.stderr.write("conductor: no records for trace-id %s in %s\n" % (args.trace, args.ledger))
        return 2
    return 0


def build_parser():
    p = argparse.ArgumentParser(prog="conductor",
                                description="Run a declared pipeline of JSONL tools, with a record.")
    sub = p.add_subparsers(dest="cmd", required=True)

    sp_verbs = sub.add_parser("verbs", help="print the five port-verbs and contracts")
    sp_verbs.set_defaults(func=cmd_verbs)

    sp_check = sub.add_parser("check", help="typecheck the pipeline without running it")
    sp_check.add_argument("--stage", action="append", help="slug:verb[:cmd] (repeatable, in order)")
    sp_check.add_argument("--stdin", dest="from_stdin", action="store_true", help="read stages as JSON-lines on stdin")
    sp_check.set_defaults(func=cmd_check)

    sp_run = sub.add_parser("run", help="typecheck then run the stages in order, with a record")
    sp_run.add_argument("--stage", action="append", help="slug:verb:cmd (repeatable, in order)")
    sp_run.add_argument("--stdin", dest="from_stdin", action="store_true", help="read stages as JSON-lines on stdin")
    sp_run.add_argument("--ledger", help="append per-stage records here (default: conductor.ledger.jsonl)")
    sp_run.add_argument("--input", help="file to seed the first stage's stdin (default: empty)")
    sp_run.add_argument("--trace", help="use this trace-id (default: a fresh uuid4)")
    sp_run.set_defaults(func=cmd_run)

    sp_replay = sub.add_parser("replay", help="print every stage record for a trace-id")
    sp_replay.add_argument("--ledger", required=True)
    sp_replay.add_argument("--trace", required=True)
    sp_replay.set_defaults(func=cmd_replay)

    return p


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
