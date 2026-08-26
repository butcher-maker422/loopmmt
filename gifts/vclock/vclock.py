#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""vclock.py — reason about the causal order of a stream of records, on a pipe.

A vector clock answers a question a timestamp cannot: given two events, did one
happen *before* the other, or are they *concurrent* — causally independent,
neither one able to have known about the other? Wall-clock time can't tell you
that (clocks drift, and "later" is not "caused by"). A vector clock can, by
giving every actor its own counter and carrying the whole vector on each record.

This is a *transform*: it reads JSON lines on stdin and writes JSON lines on
stdout, so it sits in the middle of a pipe. Each input record may carry a
`clock` field — an object mapping actor names to integer counts, e.g.
`{"a": 3, "b": 1}`. An absent actor is read as 0 (it simply hasn't been seen).

Three operations, each a subcommand:

    bump --actor A      increment actor A's component on every record's clock
                        (A absent → starts at 1). "A observed/produced this."
                        record in → record out, clock advanced.

    merge               fold every record's clock into ONE clock by taking the
                        component-wise maximum, and emit that single clock.
                        This is "receive": the least clock that dominates all
                        inputs. Emits one line: {"clock": {...}}.

    compare             read exactly two records and report their causal
                        relation. Emits one line: {"relation": R} where R is
                        one of before / after / concurrent / equal.

The causal relation (X, Y), with any absent component read as 0:
    equal       X[a] == Y[a] for every actor a
    before      X[a] <= Y[a] for every a, and X != Y      (X causally precedes Y)
    after       Y before X                                 (X causally follows Y)
    concurrent  neither before nor after                   (causally independent)

The absent-is-zero rule is the whole game: {"a":1} is BEFORE {"a":1,"b":1}
because the first has b=0 implicitly. A comparison that only looked at shared
keys would miss this — and missing it is the difference between a real vector
clock and a counter wearing its coat.

------------------------------------------------------------------------------
The JSON-lines contract (so this composes in a pipe):
  - reads ONE JSON object per line on stdin; blank lines are skipped.
  - `bump` emits one record per input record (order preserved), clock advanced.
  - `merge` / `compare` emit exactly one summary line.
  - non-clock fields on a record are passed through untouched by `bump`.
  - errors go to stderr; stdout stays clean JSON-lines.

Exit codes:
    0   ran and emitted
    2   malformed input / corrupt clock (don't trust the stream)
    3   usage / wrong record count for compare
"""

import argparse
import json
import sys


# ---------------------------------------------------------------------------
# pure operations — no I/O, fully unit-testable. These are the gift's core.
# ---------------------------------------------------------------------------

def _normalize(clock):
    """Drop explicit-zero components so equality is canonical ({a:1,b:0}=={a:1}).
    Validates that every component is an int; raises ValueError otherwise."""
    out = {}
    for actor, count in clock.items():
        if isinstance(count, bool) or not isinstance(count, int):
            raise ValueError(f"clock component {actor!r} is not an integer: {count!r}")
        if count < 0:
            raise ValueError(
                f"clock component {actor!r} is negative: {count!r} "
                "(vector-clock counts are event tallies and are never < 0)")
        if count != 0:
            out[actor] = count
    return out


def bump(clock, actor):
    """Return a NEW clock with `actor`'s component incremented by 1.
    An absent actor starts at 1. Input is not mutated."""
    new = dict(_normalize(clock))
    new[actor] = new.get(actor, 0) + 1
    return new


def merge(*clocks):
    """Component-wise maximum across all given clocks. Absent = 0."""
    out = {}
    for clock in clocks:
        for actor, count in _normalize(clock).items():
            if count > out.get(actor, 0):
                out[actor] = count
    return out


def compare(x, y):
    """Causal relation of clock x to clock y: before / after / concurrent / equal.
    An absent component is read as 0 (the actor simply hasn't been seen)."""
    x = _normalize(x)
    y = _normalize(y)
    actors = set(x) | set(y)
    x_le_y = all(x.get(a, 0) <= y.get(a, 0) for a in actors)  # x <= y everywhere
    y_le_x = all(y.get(a, 0) <= x.get(a, 0) for a in actors)  # y <= x everywhere
    if x_le_y and y_le_x:
        return "equal"          # <= both ways ⇒ componentwise equal
    if x_le_y:
        return "before"         # x dominated by y, not equal
    if y_le_x:
        return "after"
    return "concurrent"         # neither dominates ⇒ causally independent


# ---------------------------------------------------------------------------
# I/O — the JSON-lines seam.
# ---------------------------------------------------------------------------

def _read_records(stream):
    """Yield one parsed object per non-blank stdin line. Raises ValueError on a
    line that isn't a JSON object (caller maps to exit 2)."""
    for lineno, raw in enumerate(stream, start=1):
        line = raw.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as e:
            raise ValueError(f"line {lineno}: not valid JSON: {e}")
        if not isinstance(obj, dict):
            raise ValueError(f"line {lineno}: expected a JSON object, got {type(obj).__name__}")
        yield obj


def _emit(record, out):
    out.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


def _clock_of(record):
    """Pull the clock object off a record, defaulting to empty. Validates shape."""
    clock = record.get("clock", {})
    if not isinstance(clock, dict):
        raise ValueError(f"'clock' must be an object, got {type(clock).__name__}")
    return clock


# ---------------------------------------------------------------------------
# subcommands
# ---------------------------------------------------------------------------

def cmd_bump(args, stdin, stdout):
    for record in _read_records(stdin):
        record = dict(record)
        record["clock"] = bump(_clock_of(record), args.actor)
        _emit(record, stdout)
    return 0


def cmd_merge(args, stdin, stdout):
    clocks = [_clock_of(r) for r in _read_records(stdin)]
    _emit({"clock": merge(*clocks) if clocks else {}}, stdout)
    return 0


def cmd_compare(args, stdin, stdout):
    records = list(_read_records(stdin))
    if len(records) != 2:
        sys.stderr.write(
            f"compare: expected exactly 2 records on stdin, got {len(records)}\n"
        )
        return 3
    relation = compare(_clock_of(records[0]), _clock_of(records[1]))
    _emit({"relation": relation}, stdout)
    return 0


def build_parser():
    p = argparse.ArgumentParser(
        prog="vclock",
        description="Reason about the causal order of a stream of records (vector clock).",
    )
    sub = p.add_subparsers(dest="cmd")

    b = sub.add_parser("bump", help="increment one actor's component on each record")
    b.add_argument("--actor", required=True, help="the actor whose component to increment")
    b.set_defaults(func=cmd_bump)

    m = sub.add_parser("merge", help="component-wise max of every record's clock → one clock")
    m.set_defaults(func=cmd_merge)

    c = sub.add_parser("compare", help="causal relation of exactly two records' clocks")
    c.set_defaults(func=cmd_compare)

    return p


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "cmd", None):
        parser.print_usage(sys.stderr)
        sys.stderr.write("vclock: a subcommand is required (bump / merge / compare)\n")
        return 3
    try:
        return args.func(args, sys.stdin, sys.stdout)
    except ValueError as e:
        sys.stderr.write(f"vclock: {e}\n")
        return 2
    except BrokenPipeError:
        # a downstream reader (e.g. `| head`) closed the pipe early. This is
        # normal for a well-behaved stream tool — exit quietly, don't traceback.
        try:
            sys.stdout.close()
        except Exception:
            pass
        return 0


if __name__ == "__main__":
    sys.exit(main())
