#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""mint.py — hand out IDs that are never reused, and prove it before returning.

A mint stamps a coin once and never stamps that number again. This does the same
for identifiers: every ID it issues is strictly above every ID it has ever issued
before, so a number that was retired can never be pointed at a second thing. That
"never reused" property is not checked after the fact — it is **structural, and
transactional**: the mint keeps a single **high-water mark** and only ever hands
out `high_water + 1`, advancing the mark *inside a database transaction that
commits before any ID is emitted*. A crash right after issuing cannot re-issue
the same number, because the mark already moved and the move was durable.

Why you'd want that: any time an ID collision would let one record be mistaken for
another — a retired user's ID reassigned to a new user, a recycled trace ID
threading two unrelated events — monotonic allocation makes the mistake
impossible rather than merely unlikely. Retirement is recorded (so you can audit
what was let go) but a retired ID is **never** returned to the pool: silent
recycling is the whole failure this refuses, so there is no recycle switch.

STATE lives in a SQLite database at `<root>/mint.db` (Python stdlib `sqlite3`):
    meta.high_water : the last ID issued (or floor-1 when empty), one row
    retired         : an append-only table of IDs recorded retired
    the rule        : the free pool is [high_water+1 ..]; nothing lowers the mark.
SQLite gives atomic commit, crash recovery, schema enforcement, and cross-process
serialization for free (`BEGIN IMMEDIATE` lets only one allocator advance the mark
at a time), which is exactly the indivisible decision "allocate and persist" is.
Invalid, missing, downgraded, or out-of-range state is **refused** (exit 2), never
silently reset to the floor. A legacy `mint-state.json` is imported once on first
run — and refused loudly if it is corrupt — so an upgrade never reissues an old ID.

THE GATE, checked at allocation time, before an ID is returned:
    in range         floor <= id <= ceil
    monotonic        id > high_water            (structural: id = high_water + 1)
    not live         id not in --live SET       (not held right now)
A gate failure is a refusal with a reason, never a silent second-best.

------------------------------------------------------------------------------
The JSON-lines contract (so this composes in a pipe):
  - `mint alloc` / `mint peek` / `mint retire` emit ONE JSON object per line on
    stdout — a record you can pipe into the next tool.
  - `mint alloc -n K` emits K lines, one per freshly-minted ID, in order.
  - `--live -` reads a set of currently-held IDs from stdin, one JSON object or
    bare integer per line (field `--live-field`, default "id").
  - errors go to stderr; stdout stays clean JSON-lines.

Exit codes:
    0   the operation succeeded
    1   a gate refusal (out of range / not monotonic / id live)
    2   state could not be read, is invalid/out-of-range, or could not be written
    3   usage / bad input
"""

import argparse
import json
import os
import sqlite3
import sys

SCHEMA_VERSION = 1


class MintError(Exception):
    """A gate refusal or a state fault, carrying an exit code."""

    def __init__(self, message, code):
        super().__init__(message)
        self.code = code


def _db_path(root):
    return os.path.join(root, "mint.db")


def _legacy_seed(root, floor, ceil):
    """One-time seed from a legacy mint-state.json, if present. Returns the mark.
    Refuses (exit 2) rather than resetting: a corrupt or out-of-range legacy mark
    is a fault to surface, never a silent fall back to the floor (the fail-open
    this store exists to kill). An absent legacy file seeds the empty sentinel."""
    legacy = os.path.join(root, "mint-state.json")
    if not os.path.exists(legacy):
        return floor - 1
    try:
        with open(legacy, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
    except (OSError, ValueError) as exc:
        raise MintError(
            "legacy mint-state.json is unreadable; refusing to reset (import by hand): %s"
            % exc, 2)
    hw = raw.get("high_water") if isinstance(raw, dict) else None
    if isinstance(hw, bool) or not isinstance(hw, int):
        raise MintError(
            "legacy mint-state.json high_water is not an integer (%r); refusing to reset"
            % (hw,), 2)
    if hw < floor - 1 or hw > ceil:
        raise MintError(
            "legacy high_water %d is out of range [%d, %d]; refusing to reset"
            % (hw, floor - 1, ceil), 2)
    return hw


def _connect(root, floor, ceil):
    """Open (creating + seeding on first use) the SQLite store. Validates the
    persisted mark on every open; a downgraded schema or non-int/out-of-range
    mark is a loud refusal, never a silent default."""
    try:
        os.makedirs(root, exist_ok=True)
        conn = sqlite3.connect(_db_path(root), timeout=30.0, isolation_level=None)
    except (OSError, sqlite3.Error) as exc:
        raise MintError("cannot open mint store at %s: %s" % (root, exc), 2)
    try:
        conn.execute("PRAGMA busy_timeout=30000")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS meta ("
            " id INTEGER PRIMARY KEY CHECK(id = 1),"
            " high_water INTEGER NOT NULL,"
            " schema_version INTEGER NOT NULL)")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS retired ("
            " id INTEGER PRIMARY KEY,"
            " retired_at TEXT NOT NULL DEFAULT (datetime('now')))")
        row = conn.execute(
            "SELECT high_water, schema_version FROM meta WHERE id = 1").fetchone()
        if row is None:
            seed = _legacy_seed(root, floor, ceil)
            conn.execute(
                "INSERT INTO meta (id, high_water, schema_version) VALUES (1, ?, ?)",
                (seed, SCHEMA_VERSION))
        else:
            hw, sv = row
            if not isinstance(hw, int) or isinstance(hw, bool):
                raise MintError("persisted high_water is not an integer (%r)" % (hw,), 2)
            if sv != SCHEMA_VERSION:
                raise MintError(
                    "mint store schema %r != supported %d (downgraded/upgraded); refusing"
                    % (sv, SCHEMA_VERSION), 2)
            if hw < floor - 1 or hw > ceil:
                raise MintError(
                    "persisted high_water %d is out of range [%d, %d]; refusing"
                    % (hw, floor - 1, ceil), 2)
    except sqlite3.Error as exc:
        conn.close()
        raise MintError("mint store is unusable: %s" % exc, 2)
    except MintError:
        conn.close()
        raise
    return conn


def _read_hw(conn):
    return conn.execute("SELECT high_water FROM meta WHERE id = 1").fetchone()[0]


def assert_allocatable(uid, high_water, live, floor, ceil):
    """The gate: range, monotonic, not-live. Returns None if OK, else a reason."""
    if not isinstance(uid, int) or uid < floor or uid > ceil:
        return "E_RANGE: %r is outside %d-%d" % (uid, floor, ceil)
    if uid <= high_water:
        return ("E_NOT_MONOTONIC: %d is at/below the high-water mark %d"
                % (uid, high_water))
    if uid in live:
        return "E_LIVE: %d is held by a live holder" % uid
    return None


def allocate(root, live, floor, ceil, count):
    """Draw `count` IDs monotonically inside one transaction. The bumped mark is
    committed BEFORE any ID is emitted, so a crash never re-issues. On a gate
    failure mid-batch the successfully-minted prefix is committed (never lost),
    then the reason is raised."""
    conn = _connect(root, floor, ceil)
    minted = []
    reason = None
    try:
        conn.execute("BEGIN IMMEDIATE")
        hw = _read_hw(conn)
        for _ in range(count):
            uid = hw + 1
            reason = assert_allocatable(uid, hw, live, floor, ceil)
            if reason is not None:
                break
            hw = uid
            live = live | {uid}
            minted.append(uid)
        if minted:
            conn.execute("UPDATE meta SET high_water = ? WHERE id = 1", (hw,))
        conn.commit()
    except sqlite3.Error as exc:
        conn.rollback()
        conn.close()
        raise MintError("allocation could not persist: %s" % exc, 2)
    conn.close()
    if reason is not None and not minted:
        raise MintError(reason, 1)
    return minted, reason


def retire(root, uid, floor, ceil):
    """Record an ID retired (append-only). It does NOT return to the pool — the
    mark is never lowered, so nothing this records is ever re-issued."""
    conn = _connect(root, floor, ceil)
    try:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("INSERT OR IGNORE INTO retired (id) VALUES (?)", (uid,))
        hw = _read_hw(conn)
        conn.commit()
    except sqlite3.Error as exc:
        conn.rollback()
        conn.close()
        raise MintError("retire could not persist: %s" % exc, 2)
    conn.close()
    return {"retired": uid, "high_water": hw}


def peek(root, floor, ceil):
    conn = _connect(root, floor, ceil)
    hw = _read_hw(conn)
    retired = [r[0] for r in conn.execute("SELECT id FROM retired ORDER BY id")]
    conn.close()
    return {"high_water": hw, "retired": retired, "next": hw + 1,
            "floor": floor, "ceil": ceil}


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
        if isinstance(obj, bool):
            raise MintError("live line is a boolean, not an id: %r" % line, 3)
        if isinstance(obj, int):
            live.add(obj)
        elif isinstance(obj, dict) and field in obj and isinstance(obj[field], int) \
                and not isinstance(obj[field], bool):
            live.add(obj[field])
        else:
            raise MintError(
                "live line has no integer %r field: %r" % (field, line), 3)
    return live


def _emit(obj):
    sys.stdout.write(json.dumps(obj, sort_keys=True) + "\n")


def main(argv=None):
    p = argparse.ArgumentParser(
        prog="mint",
        description="hand out IDs that are never reused, and prove it before returning.")
    p.add_argument("op", choices=["alloc", "peek", "retire"],
                   help="alloc: mint new id(s). peek: show state. retire: record an id retired.")
    p.add_argument("--root", default=".mint",
                   help="directory holding mint.db (default: .mint)")
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
            state = peek(args.root, args.floor, args.ceil)
            state["op"] = "peek"
            _emit(state)
            return 0

        if args.op == "alloc":
            if args.count < 1:
                sys.stderr.write("mint: -n must be >= 1\n")
                return 3
            minted, reason = allocate(args.root, live, args.floor, args.ceil, args.count)
            for uid in minted:
                _emit({"op": "alloc", "id": uid})
            if reason is not None:
                sys.stderr.write("mint: %s\n" % reason)
                return 1
            return 0

        if args.op == "retire":
            if args.id is None:
                sys.stderr.write("mint: retire needs --id\n")
                return 3
            rec = retire(args.root, args.id, args.floor, args.ceil)
            rec["op"] = "retire"
            _emit(rec)
            return 0

    except MintError as exc:
        sys.stderr.write("mint: %s\n" % exc)
        return exc.code

    return 0


if __name__ == "__main__":
    sys.exit(main())
