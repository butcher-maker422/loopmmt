#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""
rook-line — the cells a straight line passes through on a square grid, stepping only along rows and columns.

Give it two cells. It gives back every cell from the first to the second that a straight line between their centres
runs through, in order, each one sharing a whole side with the one before — the way a rook moves, never the way a
bishop does. Four-connected lines matter wherever something has to get through: water does not pass between two cells
that touch only at a corner, so a ditch drawn on the diagonal with corner steps is a row of puddles. The Plat's line
tool (a channel, a road, a wall) draws through this.

HOW (whole numbers only; no square roots, no floats)
    The line always runs from the end that sorts first by (row, column), so a line drawn backwards is the same cells.
    It takes |rows| + |columns| steps. Before each step it asks which boundary the ideal segment crosses next — the
    next row boundary or the next column boundary — by comparing (2i + 1) * columns with (2j + 1) * rows, and steps
    across that one. When both are crossed at once the segment passes exactly through a cell corner, and either cell
    beside the corner will do. Those ties are dealt round-robin, the house tie rule (The Plat's water deals its ties
    the same way): the first corner goes to the cell that sorts first by (row, column), the next to the other one,
    and so on. A long diagonal therefore hugs both sides of the ideal line evenly instead of always leaning one way.

USAGE
    rook-line.py R0 C0 R1 C1        the cells as one JSON line: [[r, c], ...]   (exit 0; 2 a malformed cell)
    rook-line.py -                  JSON lines on stdin, {"from": [r, c], "to": [r, c]}, one answer line each:
                                    {"cells": [[r, c], ...], "from": [r, c], "to": [r, c]}
    rook-line.py --selftest         the built-in battery (exit 0 and SELFTEST PASS n/n)
    rook-line.py --help             this text
    In Python: cells((r0, c0), (r1, c1)) -> [(r, c), ...];  count(a, b) -> how many cells, without listing them.

THE PRINTED EDGE
    rook-line gives the cells of one straight line between two cell centres, stepping only along rows and columns; it
    does not draw curves, thick lines or anti-aliasing, and it does not join several lines into a path.

MIT License. Python 3 standard library only. No network, no randomness, no clock.
"""
import json
import sys

PRINTED_EDGE = ("rook-line gives the cells of one straight line between two cell centres, stepping only along rows "
                "and columns; it does not draw curves, thick lines or anti-aliasing, and it does not join several "
                "lines into a path.")
VERSION = "v1"


def _cell(p):
    """A cell is two whole numbers (row, column). Booleans are not numbers here."""
    if not isinstance(p, (tuple, list)) or len(p) != 2:
        raise ValueError(f"a cell is two whole numbers (row, column), not {p!r}")
    if not all(isinstance(v, int) and not isinstance(v, bool) for v in p):
        raise ValueError(f"a cell is two whole numbers (row, column), not {p!r}")
    return (p[0], p[1])


def _walk(s, e):
    """The cells from s to e, s sorting first. Yields each cell in order."""
    r, c = s
    nr, nc = abs(e[0] - s[0]), abs(e[1] - s[1])
    sr = 1 if e[0] > s[0] else -1
    sc = 1 if e[1] > s[1] else -1
    i = j = 0                 # row steps and column steps taken
    turn = 0                  # the corner pointer: 0 deals the next corner to the cell that sorts first
    yield (r, c)
    while i < nr or j < nc:
        if i == nr:
            step = "c"
        elif j == nc:
            step = "r"
        else:
            row_next, col_next = (2 * i + 1) * nc, (2 * j + 1) * nr
            if row_next < col_next:
                step = "r"
            elif col_next < row_next:
                step = "c"
            else:             # a corner: the cell across the row boundary vs the cell across the column boundary
                by_row, by_col = (r + sr, c), (r, c + sc)
                first = "r" if by_row < by_col else "c"
                step = first if turn == 0 else ("c" if first == "r" else "r")
                turn ^= 1
        if step == "r":
            r += sr
            i += 1
        else:
            c += sc
            j += 1
        yield (r, c)


def cells(a, b):
    """The ordered cells of the four-connected line from cell a to cell b, both ends included."""
    a, b = _cell(a), _cell(b)
    if a <= b:
        return list(_walk(a, b))
    return list(_walk(b, a))[::-1]


def count(a, b):
    """How many cells the line from a to b has, without listing them."""
    a, b = _cell(a), _cell(b)
    return abs(a[0] - b[0]) + abs(a[1] - b[1]) + 1


# ---------------------------------------------------------------- the built-in battery
def _selftest():
    cases = [
        (((3, 4), (3, 4)), [(3, 4)]),
        (((2, 1), (2, 4)), [(2, 1), (2, 2), (2, 3), (2, 4)]),
        (((0, 0), (2, 2)), [(0, 0), (0, 1), (1, 1), (2, 1), (2, 2)]),
        (((2, 2), (0, 0)), [(2, 2), (2, 1), (1, 1), (0, 1), (0, 0)]),
        (((0, 0), (1, 4)), [(0, 0), (0, 1), (0, 2), (1, 2), (1, 3), (1, 4)]),
        (((0, 0), (-2, 2)), [(0, 0), (0, 1), (-1, 1), (-2, 1), (-2, 2)]),
    ]
    ok = 0
    for (a, b), want in cases:
        got = cells(a, b)
        if got == want:
            ok += 1
        else:
            print(f"FAIL {a} -> {b}: {got} != {want}")
    laws = 0
    for r0 in range(-3, 4):
        for c0 in range(-3, 4):
            for r1 in range(-3, 4):
                for c1 in range(-3, 4):
                    line = cells((r0, c0), (r1, c1))
                    good = (line[0] == (r0, c0) and line[-1] == (r1, c1)
                            and len(line) == count((r0, c0), (r1, c1))
                            and all(abs(p[0] - q[0]) + abs(p[1] - q[1]) == 1 for p, q in zip(line, line[1:]))
                            and cells((r1, c1), (r0, c0)) == line[::-1])
                    laws += 1 if good else 0
                    if not good:
                        print(f"FAIL law {(r0, c0)} -> {(r1, c1)}: {line}")
    total, passed = len(cases) + 7 ** 4, ok + laws
    print(f"SELFTEST {'PASS' if passed == total else 'FAIL'} {passed}/{total}")
    return 0 if passed == total else 1


def _dump(obj):
    return json.dumps(obj, separators=(",", ":"), sort_keys=True)


def _int(s):
    try:
        if s.strip() != s or not s.lstrip("-").isdigit():
            raise ValueError
        return int(s)
    except ValueError:
        raise ValueError(f"{s!r} is not a whole number") from None


def main(argv=None):
    a = sys.argv[1:] if argv is None else argv
    try:
        if a in (["--help"], ["-h"]):
            print(__doc__.strip())
            return 0
        if a == ["--selftest"]:
            return _selftest()
        if a == ["-"]:
            for n, line in enumerate(sys.stdin, 1):
                if not line.strip():
                    continue
                try:
                    req = json.loads(line)
                    src, dst = req["from"], req["to"]
                except (ValueError, KeyError, TypeError):
                    raise ValueError(f"line {n}: expected {{\"from\": [r, c], \"to\": [r, c]}}") from None
                got = cells(tuple(src) if isinstance(src, list) else src, tuple(dst) if isinstance(dst, list) else dst)
                print(_dump({"cells": [list(p) for p in got], "from": list(src), "to": list(dst)}))
            return 0
        if len(a) == 4:
            r0, c0, r1, c1 = (_int(x) for x in a)
            print(_dump([list(p) for p in cells((r0, c0), (r1, c1))]))
            return 0
        raise ValueError("usage: rook-line.py R0 C0 R1 C1 | - | --selftest | --help")
    except ValueError as err:
        print(f"rook-line: {err}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
