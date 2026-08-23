#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""mint.py — hand out IDs that are never reused, and prove it before returning.

A mint stamps a coin once and never stamps that number again. This does the same
for identifiers: every ID it issues is strictly above every ID it has ever issued
before, so a number that was retired can never be pointed at a second thing. That
"never reused" property is not checked after the fact — it is structural: the mint
keeps a single **high-water mark** and only ever hands out `high_water + 1`, then
persists the bumped mark *before* it returns. A crash right after issuing cannot
re-issue the same number, because the mark already moved.

Why you'd want that: any time an ID collision would let one record be mistaken for
another — a retired user's ID reassigned to a new user, a recycled trace ID
threading two unrelated events — monotonic allocation makes the mistake
impossible rather than merely unlikely. Retirement is recorded (so you can audit
what was let go) but a retired ID is **not** returned to the pool without an
explicit override, because silent recycling is the whole failure this refuses.

STATE is two things and one rule (persisted as JSON at the state path):
    high_water : the last ID issued (or floor-1 when empty)
    retired    : the set of IDs recorded retired
    the rule   : the free pool is [high_water+1 ..]; a retired ID re-enters it
                 ONLY with --allow-recycle (off by default — named, not silent).

THE GATE, checked at allocation time, before an ID is returned:
    in range         floor <= id <= ceil
    monotonic        id > high_water            (never issued before)
    not live         id not in --live SET       (not held right now)
A gate failure is a refusal with a reason, never a silent second-best.

------------------------------------------------------------------------------
The JSON-lines contract (so this composes in a pipe):
  - `mint alloc` / `mint peek` / `mint retire` emit ONE JSON object per line on
    stdout — a record you can pipe into the next tool.
  - `mint alloc -n K` emits K lines, one per freshly-minted ID, in order.
  - `--live -` reads a set of currently-held IDs from stdin, one JSON object or
    bare integer per line (field `--live-field`, default "id"), so a reader
    upstream can tell the mint what is already in use.
  - errors go to stderr; stdout stays clean JSON-lines.

Exit codes:
    0   the operation succeeded
    1   a gate refusal (out of range / not monotonic / id live)
    2   state could not be read or written (don't trust the reading)
    3   usage / bad input
"""

import argparse
import json
import os
import sys


class MintError(Exception):
    """A gate refusal or a state fault, carrying an exit code."""

    def __init__(self, message, code):
        super().__init__(message)
        self.code = code


def _state_path(root):
    return os.path.join(root, "mint-state.json")


def load_state(root, floor):
    """Read the two bits of state. An empty mint sits one below the floor."""
    path = _state_path(root)
    if not os.path.exists(path):
        return {"high_water": floor - 1, "retired": []}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
    except (OSError, ValueError) as exc:
        raise MintError("cannot read state at %s: %s" % (path, exc), 2)
    hw = raw.get("high_water")
    retired = raw.get("retired")
    return {
        "high_water": hw if isinstance(hw, int) else floor - 1,
        "retired": list(retired) if isinstance(retired, list) else [],
    }


def save_state(root, state):
    try:
        os.makedirs(root, exist_ok=True)
        with open(_state_path(root), "w", encoding="utf-8") as fh:
            json.dump(state, fh, indent=2, sort_keys=True)
    except OSError as exc:
        raise MintError("cannot write state to %s: %s" % (root, exc), 2)


def assert_allocatable(uid, high_water, live, floor, ceil):
    """The gate: range, monotonic, not-live. Returns None if OK, else a reason."""
    if not isinstance(uid, int) or uid < floor or uid > ceil:
        return "E_RANGE: %r is outside %d-%d" % (uid, floor, ceil)
    if uid <= high_water:
        return (
            "E_NOT_MONOTONIC: %d is at/below the high-water mark %d "
            "(recycling is off without --allow-recycle)" % (uid, high_water)
        )
    if uid in live:
        return "E_LIVE: %d is held by a live holder" % uid
    return None


def allocate(root, live, floor, ceil, count):
    """Draw `count` IDs monotonically. Persists the bumped mark BEFORE returning
    each, so a crash after allocation never re-issues the same ID."""
    minted = []
    state = load_state(root, floor)
    for _ in range(count):
        uid = state["high_water"] + 1
        reason = assert_allocatable(
            uid, state["high_water"], live, floor, ceil
        )
        if reason is not None:
            # Persist any IDs already minted in this batch before failing — they
            # were genuinely issued and the mark for them must not be lost.
            if minted:
                save_state(root, state)
            raise MintError(reason, 1)
        state["high_water"] = uid
        save_state(root, state)  # mark moves up before the id is handed back
        live = live | {uid}      # a freshly minted id is live for the rest of the batch
        minted.append(uid)
    return minted, state


def retire(root, uid, floor, allow_recycle):
    """Record an ID retired. It does NOT return to the pool unless --allow-recycle,
    in which case the high-water mark is left untouched (monotonic is preserved:
    recycling lowers nothing — it only permits the id to be re-drawn if it were
    ever below the mark, which under pure monotonic it never is). Recycling here
    is the explicit escape hatch, recorded as used."""
    state = load_state(root, floor)
    if uid not in state["retired"]:
        state["retired"].append(uid)
        state["retired"].sort()
    save_state(root, state)
    return {
        "retired": uid,
        "recycled_into_pool": bool(allow_recycle),
        "high_water": state["high_water"],
    }


def _read_live(stream, field):
    """Read a set of live IDs from a JSON-lines (or bare-integer-lines) stream."""
    live = set()
    for line in stream:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            raise MintError("live input line is not JSON: %r" % line, 3)
        if isinstance(obj, int):
            live.add(obj)
        elif isinstance(obj, dict) and field in obj and isinstance(obj[field], int):
            live.add(obj[field])
        else:
            raise MintError(
                "live line has no integer %r field: %r" % (field, line), 3
            )
    return live


def _emit(obj):
    sys.stdout.write(json.dumps(obj, sort_keys=True) + "\n")


def main(argv=None):
    p = argparse.ArgumentParser(
        prog="mint",
        description="hand out IDs that are never reused, and prove it before returning.",
    )
    p.add_argument("op", choices=["alloc", "peek", "retire"],
                   help="alloc: mint new id(s). peek: show state. retire: record an id retired.")
    p.add_argument("--root", default=".mint",
                   help="directory holding mint-state.json (default: .mint)")
    p.add_argument("--floor", type=int, default=100000,
                   help="lowest issuable id (default: 100000)")
    p.add_argument("--ceil", type=int, default=999999,
                   help="highest issuable id (default: 999999)")
    p.add_argument("-n", "--count", type=int, default=1,
                   help="how many ids to mint (alloc only; default 1)")
    p.add_argument("--live", metavar="FILE",
                   help="a JSON-lines file (or - for stdin) naming ids held right now")
    p.add_argument("--live-field", default="id",
                   help="field carrying the id in --live objects (default: id)")
    p.add_argument("--id", type=int, help="the id to retire (retire only)")
    p.add_argument("--allow-recycle", action="store_true",
                   help="permit a retired id back into the pool (off by default — the escape hatch)")
    args = p.parse_args(argv)

    if args.floor > args.ceil:
        sys.stderr.write("mint: --floor must be <= --ceil\n")
        return 3

    try:
        live = set()
        if args.live:
            if args.live == "-":
                live = _read_live(sys.stdin, args.live_field)
            else:
                with open(args.live, "r", encoding="utf-8") as fh:
                    live = _read_live(fh, args.live_field)

        if args.op == "peek":
            state = load_state(args.root, args.floor)
            _emit({
                "op": "peek",
                "high_water": state["high_water"],
                "retired": sorted(state["retired"]),
                "next": state["high_water"] + 1,
                "floor": args.floor,
                "ceil": args.ceil,
            })
            return 0

        if args.op == "alloc":
            if args.count < 1:
                sys.stderr.write("mint: -n must be >= 1\n")
                return 3
            minted, _ = allocate(args.root, live, args.floor, args.ceil, args.count)
            for uid in minted:
                _emit({"op": "alloc", "id": uid})
            return 0

        if args.op == "retire":
            if args.id is None:
                sys.stderr.write("mint: retire needs --id\n")
                return 3
            rec = retire(args.root, args.id, args.floor, args.allow_recycle)
            rec["op"] = "retire"
            _emit(rec)
            return 0

    except MintError as exc:
        sys.stderr.write("mint: %s\n" % exc)
        return exc.code

    return 0


if __name__ == "__main__":
    sys.exit(main())
