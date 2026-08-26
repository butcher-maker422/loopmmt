#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""smoke_test.py — hermetic proof that trellis.py holds the line. No network, no
state outside a tmpdir. Each scenario writes a spec, runs trellis.py as a
subprocess, and checks the exit code and verdict text — the real CLI contract:

  1  a solvable square renders and reports FORCED/FREE cells (exit 0)
  2  a genuine double word square holds with the expected FORCED/FREE split
  3  an over-constrained square localizes the clash to CONTRADICTORY cells
  4  --json emits parseable result JSON with the cell verdicts
  5  a malformed spec is rejected loud, not silently passed (nonzero exit)
  6  --help exits 0 (the gift contract: a stranger can discover the tool)

Run:  python3 smoke_test.py    (expect: 6/6 passed)
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TRELLIS = os.path.join(HERE, "trellis.py")
PASS = 0
FAIL = 0


def ok(msg):
    global PASS
    PASS += 1
    print(f"ok  {msg}")


def bad(msg):
    global FAIL
    FAIL += 1
    print(f"FAIL {msg}")


def run(args, **kw):
    return subprocess.run([sys.executable, TRELLIS] + args,
                          capture_output=True, text=True, **kw)


def write(d, name, obj):
    p = os.path.join(d, name)
    with open(p, "w") as fh:
        json.dump(obj, fh)
    return p


# A small solvable 2x2 square: rows and columns are two-letter wordlists that
# share letters at the crossings.
SOLVABLE = {
    "rows": ["r0", "r1"], "cols": ["c0", "c1"],
    "cells": {"r0|c0": "A"},
    "row_constraints": {
        "r0": {"type": "wordlist", "words": [["A", "T"], ["A", "N"]]},
        "r1": {"type": "wordlist", "words": [["T", "O"], ["N", "O"]]},
    },
    "col_constraints": {
        "c0": {"type": "wordlist", "words": [["A", "T"], ["A", "N"]]},
        "c1": {"type": "wordlist", "words": [["T", "O"], ["N", "O"]]},
    },
}

# The literal double word square seed, top row fixed.
WORD_SQUARE = {
    "rows": ["r0", "r1", "r2", "r3"], "cols": ["c0", "c1", "c2", "c3"],
    "cells": {"r0|c0": "S", "r0|c1": "T", "r0|c2": "A", "r0|c3": "R"},
    "row_constraints": {
        "r0": {"type": "wordlist", "words": [["S", "T", "A", "R"], ["S", "T", "A", "B"], ["S", "C", "A", "R"]]},
        "r1": {"type": "wordlist", "words": [["P", "A", "G", "E"], ["P", "A", "V", "E"], ["P", "A", "C", "E"]]},
        "r2": {"type": "wordlist", "words": [["O", "P", "E", "N"], ["O", "V", "E", "N"]]},
        "r3": {"type": "wordlist", "words": [["T", "E", "S", "T"], ["T", "E", "N", "T"], ["T", "E", "X", "T"]]},
    },
    "col_constraints": {
        "c0": {"type": "wordlist", "words": [["S", "P", "O", "T"], ["S", "P", "A", "T"]]},
        "c1": {"type": "wordlist", "words": [["T", "A", "P", "E"], ["C", "A", "P", "E"]]},
        "c2": {"type": "wordlist", "words": [["A", "G", "E", "S"], ["A", "V", "E", "S"], ["A", "C", "E", "S"]]},
        "c3": {"type": "wordlist", "words": [["R", "E", "N", "T"], ["R", "U", "N", "T"]]},
    },
}

# Over-constrained: a fixed cell that no row/column word allows.
CLASH = {
    "rows": ["r0"], "cols": ["c0", "c1"],
    "cells": {"r0|c0": "Z"},
    "row_constraints": {"r0": {"type": "wordlist", "words": [["A", "T"], ["A", "N"]]}},
    "col_constraints": {
        "c0": {"type": "wordlist", "words": [["A"], ["B"]]},
        "c1": {"type": "wordlist", "words": [["T"], ["N"]]},
    },
}


def t1(d):
    r = run(["solve", write(d, "s.json", SOLVABLE)])
    if r.returncode == 0 and "FORCED" in r.stdout:
        ok("1 solvable square renders with FORCED cells")
    else:
        bad(f"1 solvable square: rc={r.returncode} out={r.stdout!r} err={r.stderr!r}")


def t2(d):
    r = run(["solve", write(d, "w.json", WORD_SQUARE)])
    if r.returncode == 0 and "FORCED=11" in r.stdout and "FREE=1" in r.stdout:
        ok("2 word square holds with FORCED=11 FREE=1")
    else:
        bad(f"2 word square: rc={r.returncode} out={r.stdout!r}")


def t3(d):
    r = run(["solve", write(d, "c.json", CLASH)])
    if "CONTRADICTORY" in r.stdout and "CONTRADICTORY=0" not in r.stdout:
        ok("3 over-constrained square localizes to CONTRADICTORY")
    else:
        bad(f"3 clash not localized: out={r.stdout!r}")


def t4(d):
    r = run(["solve", write(d, "j.json", SOLVABLE), "--json"])
    try:
        obj = json.loads(r.stdout)
        if r.returncode == 0 and isinstance(obj, dict):
            ok("4 --json emits parseable result JSON")
            return
    except Exception:
        pass
    bad(f"4 --json not parseable: out={r.stdout!r}")


def t5(d):
    p = os.path.join(d, "bad.json")
    with open(p, "w") as fh:
        fh.write("{ this is not json ")
    r = run(["solve", p])
    if r.returncode != 0:
        ok("5 malformed spec rejected loud (nonzero exit)")
    else:
        bad(f"5 malformed spec silently passed: rc={r.returncode}")


def t6(_d):
    r = run(["--help"])
    if r.returncode == 0 and "Trellis" in r.stdout:
        ok("6 --help exits 0 (discoverable)")
    else:
        bad(f"6 --help: rc={r.returncode}")


def main():
    for t in (t1, t2, t3, t4, t5):
        with tempfile.TemporaryDirectory() as d:
            t(d)
    t6(None)
    print()
    print(f"{PASS}/{PASS + FAIL} passed")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
