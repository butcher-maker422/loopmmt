#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""plumb.py — a status board that refuses to show green on hope.

A plumb line tells the truth about vertical no matter how the wall *feels*. This
does the same for a status board: every claim you assert PASS must carry a
WITNESS beneath it — a real, checkable piece of evidence — and the claim is only
rendered green if that witness actually agrees. A "done" typed by a hopeful hand
is not evidence. Plumb will not paint it green.

The board file (`.plumb`) is one claim per line. Blank lines and lines starting
with '#' are ignored. Each claim is 2 or 3 pipe-separated fields:

    NAME | WITNESS                 # status defaults to 'assert'
    NAME | STATUS | WITNESS        # STATUS is 'assert' or 'todo'

WITNESS is one of:

    exists PATH                    # PATH must exist
    absent PATH                    # PATH must NOT exist  (e.g. "no secret committed")
    contains PATH ~ TEXT           # PATH exists and contains the literal substring TEXT
    cmd SHELL COMMAND ...          # the command must exit 0
    none                           # NO witness at all  (the honesty case)

Verdicts:

    HELD          assert + witness satisfied            -> green, and clean
    BROKEN        assert + witness NOT satisfied         -> the green-on-hope catch
    UNWITNESSED   assert + witness 'none'                -> you claimed PASS with nothing beneath it
    BLOCKED       witness could not be evaluated         -> don't trust the reading
    TODO          todo  + witness not (yet) satisfied    -> honest not-done (never green)
    READY         todo  + witness satisfied              -> it's actually done; promote it

Exit codes:
    0   every asserted claim is HELD   (todo/ready present is fine)
    1   at least one BROKEN or UNWITNESSED claim   (a definite green-on-hope)
    2   no broken assertions, but at least one BLOCKED claim  (couldn't measure — don't trust green)
    3   usage / unreadable board

A `todo` claim can NEVER render green. That is deliberate: the one thing this tool
exists to make impossible is a green cell with nothing true beneath it.
"""

import argparse
import json
import os
import subprocess
import sys

CEILING = (
    "note: Plumb checks that each claim's witness EXISTS / AGREES — not that the "
    "witness is CORRECT. A claim can point at the wrong evidence (a file that "
    "exists but proves nothing, a command that exits 0 for the wrong reason) and "
    "Plumb will pass it. It catches GREEN ON HOPE (a claim asserted PASS with no "
    "satisfied witness); it does NOT catch GREEN ON THE WRONG WITNESS. The witness "
    "is only as honest as you write it, and the board file runs its `cmd` witnesses "
    "with your shell — trust it like a Makefile."
)

# Verdicts
HELD = "HELD"
BROKEN = "BROKEN"
UNWITNESSED = "UNWITNESSED"
BLOCKED = "BLOCKED"
TODO = "TODO"
READY = "READY"

# Which verdicts drive which exit code.
_FAIL_1 = (BROKEN, UNWITNESSED)   # a definite green-on-hope
_FAIL_2 = (BLOCKED,)              # couldn't measure


def _eprint(*a):
    print(*a, file=sys.stderr)


# --- witness parsing --------------------------------------------------------

def parse_witness(expr):
    """expr -> ((kind, arg), None) on success, or (None, error_string).

    kind is one of exists/absent/contains/cmd/none.
    arg is a string (path or command), a (path, pattern) tuple for contains, or
    None for 'none'.
    """
    expr = expr.strip()
    if expr == "" or expr.lower() == "none":
        return ("none", None), None
    head, _, rest = expr.partition(" ")
    kind = head.lower()
    rest = rest.strip()
    if kind in ("exists", "absent"):
        if not rest:
            return None, f"{kind} needs a path"
        return (kind, rest), None
    if kind == "contains":
        if " ~ " not in rest:
            return None, "contains needs the form:  contains <path> ~ <text>"
        path, _, pattern = rest.partition(" ~ ")
        path = path.strip()
        if not path or pattern == "":
            return None, "contains needs both a path and a non-empty text"
        return ("contains", (path, pattern)), None
    if kind == "cmd":
        if not rest:
            return None, "cmd needs a command"
        return ("cmd", rest), None
    return None, f"unknown witness kind {kind!r} (want exists/absent/contains/cmd/none)"


# --- board parsing ----------------------------------------------------------

def parse_board(text):
    """Return a list of claim dicts (name, status, witness kind/arg, parse_error, line)."""
    claims = []
    for lineno, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        # GIFT-009: parse NAME-first with a bounded left split, so a `cmd:` witness
        # that legitimately contains shell pipes (`... | wc -l`) is NOT torn apart.
        # The old `line.split("|")` counted every pipe as a field boundary, so a
        # piped command produced 4+ fields and hit the "2 or 3 fields" error — the
        # command was lost purely for containing a pipe. The grammar is unchanged
        # for the reader (name | [status] | witness); only the SPLIT is bounded:
        # field 0 is the name, an optional bare-status field 1, and EVERYTHING after
        # is the witness, rejoined verbatim (interior pipes preserved).
        head = [f.strip() for f in line.split("|", 2)]
        if len(head) == 2:
            name, status, wexpr = head[0], "assert", head[1]
        elif len(head) == 3:
            # 3 raw segments: field 1 is the status ONLY if it's a bare status
            # keyword; otherwise it belongs to a 2-field claim whose witness itself
            # carried a pipe, so fold field 1 back into the witness.
            if head[1].lower() in ("assert", "todo"):
                name, status, wexpr = head[0], head[1].lower(), head[2]
            else:
                name, status, wexpr = head[0], "assert", head[1] + " | " + head[2]
        else:
            claims.append({"name": line, "status": "assert", "line": lineno,
                           "parse_error": "a claim needs a name and a witness "
                                          "(name | witness  or  name | status | witness)"})
            continue
        if not name:
            claims.append({"name": "(unnamed)", "status": status, "line": lineno,
                           "parse_error": "claim has no name"})
            continue
        if status not in ("assert", "todo"):
            claims.append({"name": name, "status": "assert", "line": lineno,
                           "parse_error": f"unknown status {status!r} (want assert|todo)"})
            continue
        parsed, err = parse_witness(wexpr)
        if err:
            claims.append({"name": name, "status": status, "line": lineno,
                           "parse_error": err})
            continue
        kind, arg = parsed
        claims.append({"name": name, "status": status, "witness_kind": kind,
                       "witness_arg": arg, "line": lineno, "parse_error": None})
    return claims


# --- witness evaluation -----------------------------------------------------

def eval_witness(kind, arg, cwd):
    """Return (satisfied, detail). satisfied is True/False, or None = could-not-evaluate."""
    if kind == "exists":
        ok = os.path.exists(os.path.join(cwd, arg))
        return ok, ("present" if ok else "MISSING") + f": {arg}"
    if kind == "absent":
        ok = not os.path.exists(os.path.join(cwd, arg))
        return ok, ("absent" if ok else "PRESENT") + f": {arg}"
    if kind == "contains":
        path, pattern = arg
        full = os.path.join(cwd, path)
        try:
            with open(full, "r", encoding="utf-8", errors="replace") as f:
                text = f.read()
        except Exception as ex:
            return None, f"unreadable {path}: {ex.__class__.__name__}"
        ok = pattern in text
        return ok, (f"found {pattern!r}" if ok else f"NOT found {pattern!r}") + f" in {path}"
    if kind == "cmd":
        try:
            rc = subprocess.call(arg, shell=True, cwd=cwd,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as ex:
            return None, f"could not launch: {ex.__class__.__name__}"
        return (rc == 0), f"exit {rc}"
    return None, f"unknown witness kind {kind!r}"


def evaluate(claim, cwd):
    """A parsed claim -> (verdict, detail)."""
    if claim.get("parse_error"):
        return BLOCKED, claim["parse_error"]
    status = claim["status"]
    kind = claim["witness_kind"]
    arg = claim["witness_arg"]
    if kind == "none":
        if status == "todo":
            return TODO, "no witness yet (todo)"
        return UNWITNESSED, "asserted PASS with no witness beneath it"
    satisfied, detail = eval_witness(kind, arg, cwd)
    if satisfied is None:
        return BLOCKED, detail
    if status == "todo":
        return (READY if satisfied else TODO), detail
    return (HELD if satisfied else BROKEN), detail


# --- run / render -----------------------------------------------------------

def run(board_text, cwd):
    rows = []
    for c in parse_board(board_text):
        verdict, detail = evaluate(c, cwd)
        rows.append({"name": c["name"], "status": c["status"], "verdict": verdict,
                     "detail": detail, "line": c["line"]})
    return rows


def exit_code(rows):
    verdicts = {r["verdict"] for r in rows}
    if verdicts & set(_FAIL_1):
        return 1
    if verdicts & set(_FAIL_2):
        return 2
    return 0


_MARK = {HELD: "ok ", BROKEN: "XX ", UNWITNESSED: "XX ", BLOCKED: "?? ",
         TODO: " . ", READY: ">> "}


def render_table(rows):
    if not rows:
        return "(no claims)"
    w = max(len(r["name"]) for r in rows)
    out = []
    for r in rows:
        out.append(f"  {_MARK.get(r['verdict'], '   ')} {r['name']:<{w}}  "
                   f"{r['verdict']:<11}  {r['detail']}")
    return "\n".join(out)


def summary(rows):
    counts = {}
    for r in rows:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
    order = [HELD, BROKEN, UNWITNESSED, BLOCKED, TODO, READY]
    parts = [f"{counts[v]} {v.lower()}" for v in order if counts.get(v)]
    return "plumb: " + (" · ".join(parts) if parts else "no claims")


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="plumb.py",
        description="A status board that refuses to show green on hope.")
    ap.add_argument("board", help="path to a .plumb board file, or - for stdin")
    ap.add_argument("--cwd", default=None,
                    help="base dir for relative witness paths and commands "
                         "(default: the board file's directory; '.' for stdin)")
    ap.add_argument("--json", action="store_true",
                    help="machine-readable output on stdout")
    ap.add_argument("--quiet", action="store_true",
                    help="print only the summary line (+ ceiling on stderr)")
    args = ap.parse_args(argv)

    if args.board == "-":
        board_text = sys.stdin.read()
        default_cwd = "."
    else:
        try:
            with open(args.board, "r", encoding="utf-8") as f:
                board_text = f.read()
        except Exception as ex:
            _eprint(f"plumb: cannot read board {args.board!r}: {ex}")
            return 3
        default_cwd = os.path.dirname(os.path.abspath(args.board)) or "."
    cwd = args.cwd or default_cwd

    rows = run(board_text, cwd)
    code = exit_code(rows)

    if args.json:
        print(json.dumps({"rows": rows, "exit": code}, indent=2))
    else:
        if not args.quiet:
            print(render_table(rows))
            print()
        print(summary(rows))

    _eprint(CEILING)
    return code


if __name__ == "__main__":
    sys.exit(main())
