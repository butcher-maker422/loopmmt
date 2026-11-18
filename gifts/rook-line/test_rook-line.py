# SPDX-License-Identifier: MIT
"""test_rook-line.py — the external battery for the rook-line gift. Each test's name is the behaviour it holds.

    python3 -m unittest test_rook-line      (from this folder; it tests the rook-line.py beside it)

The oracle below is a second method, not a second copy: it never walks a line. It looks at every cell in the box the
two ends span and asks, in exact fractions, whether the ideal segment between the two cell centres passes through the
cell's open square (the cell must be taken), only touches one of its corners (the cell is a corner candidate), or
misses it. The walk must take every must-cell, never a missed one, and exactly one of the two cells at each corner.
"""
import importlib.util
import os
import random
import subprocess
import sys
import unittest
from fractions import Fraction as F

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, "rook-line.py")   # the build beside this file, always: a mutant is planted AS this file in a
#                                             sandbox folder (known-bad-rook-line.json), so the shipped test loads no
#                                             path an environment variable chose (the genesis clearance's dynamic-import)

_spec = importlib.util.spec_from_file_location("rook_line", PATH)   # a path the clearance folds statically
R = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R)


# ---------------------------------------------------------------- the oracle (exact geometry, no walking)
def _seg_hits_open_square(a, b, cell):
    """Does the closed segment a->b (cell centres) meet the OPEN unit square centred on cell? Liang-Barsky clip in
    exact fractions against the open box: a positive-length overlap, or the segment's single point strictly inside."""
    (r0, c0), (r1, c1) = a, b
    lo_r, hi_r = F(cell[0]) - F(1, 2), F(cell[0]) + F(1, 2)
    lo_c, hi_c = F(cell[1]) - F(1, 2), F(cell[1]) + F(1, 2)
    t0, t1 = F(0), F(1)
    for p0, d, lo, hi in ((F(r0), F(r1 - r0), lo_r, hi_r), (F(c0), F(c1 - c0), lo_c, hi_c)):
        if d == 0:
            if not (lo < p0 < hi):
                return False
            continue
        ta, tb = (lo - p0) / d, (hi - p0) / d
        if ta > tb:
            ta, tb = tb, ta
        t0, t1 = max(t0, ta), min(t1, tb)
    if t0 < t1:
        return True
    if t0 == t1:                       # a single parameter: strictly inside only if the point is interior on both axes
        pr, pc = F(r0) + t0 * (r1 - r0), F(c0) + t0 * (c1 - c0)
        return lo_r < pr < hi_r and lo_c < pc < hi_c
    return False


def oracle(a, b):
    """-> (must, corners): the set of cells the segment passes through the inside of, and the list of corner ties in
    order along the segment from the canonical start, each the two candidate cells in (row, column) order."""
    s, e = (a, b) if a <= b else (b, a)
    rs, re_ = sorted((s[0], e[0]))
    cs, ce = sorted((s[1], e[1]))
    must = {(r, c) for r in range(rs, re_ + 1) for c in range(cs, ce + 1) if _seg_hits_open_square(s, e, (r, c))}
    corners = []
    nr, nc = e[0] - s[0], e[1] - s[1]
    if nr and nc:
        # lattice corners (r + 1/2, c + 1/2) on the segment, strictly between its ends
        pts = set()
        for i in range(0, 2 * abs(nr) + 1):
            # row coordinate s0 + (2i+1)/2 * sign: half-integers strictly between the ends
            hr = F(2 * i + 1, 2) * (1 if nr > 0 else -1)
            t = hr / nr
            if not (0 < t < 1):
                continue
            hc = t * nc
            if hc.denominator == 2:     # the column coordinate is a half-integer too: a corner
                pts.add(t)
        for t in sorted(pts):
            pr, pc = F(s[0]) + t * nr, F(s[1]) + t * nc
            cand = []
            for dr in (F(-1, 2), F(1, 2)):
                for dc in (F(-1, 2), F(1, 2)):
                    cell = (int(pr + dr), int(pc + dc))
                    if cell not in must:
                        cand.append(cell)
            corners.append(tuple(sorted(cand)))
    return must, corners


def _orth(p, q):
    return abs(p[0] - q[0]) + abs(p[1] - q[1]) == 1


def _rand_pair(rng, span):
    return ((rng.randint(-span, span), rng.randint(-span, span)), (rng.randint(-span, span), rng.randint(-span, span)))


# ---------------------------------------------------------------- the battery
class HandCases(unittest.TestCase):
    def test_a_single_cell_line_is_that_cell(self):
        self.assertEqual(R.cells((3, 4), (3, 4)), [(3, 4)])

    def test_a_line_along_a_row_is_every_cell_between_the_ends(self):
        self.assertEqual(R.cells((2, 1), (2, 5)), [(2, c) for c in range(1, 6)])

    def test_a_line_down_a_column_is_every_cell_between_the_ends(self):
        self.assertEqual(R.cells((5, 0), (1, 0)), [(r, 0) for r in range(5, 0, -1)])

    def test_a_diagonal_steps_only_along_rows_and_columns(self):
        line = R.cells((0, 0), (4, 4))
        self.assertEqual(len(line), 9)
        for p, q in zip(line, line[1:]):
            self.assertTrue(_orth(p, q), f"{p} -> {q} touches only at a corner")

    def test_a_two_by_two_diagonal_deals_its_two_corners_one_each_way(self):
        # first corner to the cell that sorts first (0,1), the second to the other way (2,1): no lean
        self.assertEqual(R.cells((0, 0), (2, 2)), [(0, 0), (0, 1), (1, 1), (2, 1), (2, 2)])

    def test_a_shallow_line_with_no_corner_rides_the_nearer_cells(self):
        self.assertEqual(R.cells((0, 0), (1, 4)), [(0, 0), (0, 1), (0, 2), (1, 2), (1, 3), (1, 4)])

    def test_the_ends_are_always_the_first_and_last_cells(self):
        self.assertEqual(R.cells((7, -3), (-2, 9))[0], (7, -3))
        self.assertEqual(R.cells((7, -3), (-2, 9))[-1], (-2, 9))

    def test_a_malformed_end_is_refused(self):
        for bad in ((1.5, 2), (1, "2"), (1,), (True, 2), None):
            with self.assertRaises(ValueError):
                R.cells(bad, (0, 0))


class Laws(unittest.TestCase):
    def test_drawn_backwards_it_is_the_same_cells_in_reverse(self):
        rng = random.Random(16_1250)
        for _ in range(3000):
            a, b = _rand_pair(rng, 40)
            self.assertEqual(R.cells(b, a), list(reversed(R.cells(a, b))), (a, b))

    def test_every_step_is_one_cell_along_a_row_or_a_column_and_never_back(self):
        rng = random.Random(7)
        for _ in range(3000):
            a, b = _rand_pair(rng, 40)
            line = R.cells(a, b)
            self.assertEqual(len(line), abs(a[0] - b[0]) + abs(a[1] - b[1]) + 1, (a, b))
            self.assertEqual(len(set(line)), len(line), (a, b))
            for p, q in zip(line, line[1:]):
                self.assertTrue(_orth(p, q), (a, b, p, q))

    def test_moved_across_the_grid_the_line_moves_with_it(self):
        rng = random.Random(11)
        for _ in range(1000):
            a, b = _rand_pair(rng, 30)
            t = (rng.randint(-500, 500), rng.randint(-500, 500))
            sh = lambda p: (p[0] + t[0], p[1] + t[1])
            self.assertEqual(R.cells(sh(a), sh(b)), [sh(p) for p in R.cells(a, b)], (a, b, t))

    def test_whole_numbers_only_so_huge_lines_are_exact(self):
        a, b = (0, 0), (10 ** 12, 10 ** 12 + 1)        # far too long to list; its length is read without walking
        self.assertEqual(R.count(a, b), 2 * 10 ** 12 + 2)
        far = (10 ** 15, 3 * 10 ** 15)
        self.assertEqual(R.cells(far, (far[0] + 3, far[1] + 9)),
                         [(far[0] + p[0], far[1] + p[1]) for p in R.cells((0, 0), (3, 9))])


class Differential(unittest.TestCase):
    def _check(self, a, b):
        line = R.cells(a, b)
        must, corners = oracle(a, b)
        got = set(line)
        self.assertTrue(must <= got, f"{a}->{b}: misses a cell the line passes through: {sorted(must - got)}")
        extra = sorted(got - must)
        self.assertEqual(len(extra), len(corners), f"{a}->{b}: extra {extra} vs corners {corners}")
        for k, (lo, hi) in enumerate(corners):
            took = [c for c in (lo, hi) if c in got]
            self.assertEqual(len(took), 1, f"{a}->{b}: corner {k} took {took}")
            # round-robin from the canonical start: even corners to the cell that sorts first, odd to the other
            self.assertEqual(took[0], lo if k % 2 == 0 else hi, f"{a}->{b}: corner {k} {lo},{hi} took {took}")
        # Order, not only membership (Outside Read plat-line-tool/1, GPT F6: a mutant reversing every 7 x 9 path passed
        # a set comparison). On a monotone four-connected path each cell's Manhattan distance from the requested start
        # is its index, so the list must be the expected cells sorted by that distance, starting at a and ending at b.
        sa, sb = (int(a[0]), int(a[1])), (int(b[0]), int(b[1]))
        dist = [abs(r - sa[0]) + abs(c - sa[1]) for r, c in line]
        self.assertEqual(dist, list(range(len(line))), f"{a}->{b}: out of order from the start: {line}")
        self.assertEqual((line[0], line[-1]), (sa, sb), f"{a}->{b}: ends {line[0]},{line[-1]}")

    def test_the_cells_are_exactly_the_ones_the_segment_passes_through_plus_one_per_corner(self):
        rng = random.Random(1250)
        for _ in range(2500):
            self._check(*_rand_pair(rng, 12))

    def test_every_line_in_a_small_box_agrees_with_the_oracle(self):
        pts = [(r, c) for r in range(-3, 4) for c in range(-3, 4)]
        for a in pts:
            for b in pts:
                self._check(a, b)

    def test_lines_through_many_corners_deal_them_evenly(self):
        for n in range(1, 30):
            for (dr, dc) in ((n, n), (n, -n), (-n, n), (2 * n, 4 * n), (3 * n, -n)):
                self._check((0, 0), (dr, dc))
                line = R.cells((0, 0), (dr, dc))
                _, corners = oracle((0, 0), (dr, dc))
                firsts = sum(1 for lo, hi in corners if lo in line)
                self.assertLessEqual(abs(firsts - (len(corners) - firsts)), 1)


class Surface(unittest.TestCase):
    def _run(self, *args, stdin=None):
        p = subprocess.run([sys.executable, PATH, *args], input=stdin, capture_output=True, text=True)
        return p.returncode, p.stdout, p.stderr

    def test_the_command_line_prints_the_cells_as_one_json_line(self):
        rc, out, _ = self._run("0", "0", "2", "2")
        self.assertEqual(rc, 0)
        self.assertEqual(out, "[[0,0],[0,1],[1,1],[2,1],[2,2]]\n")

    def test_a_stream_of_pairs_gets_one_answer_line_each(self):
        rc, out, _ = self._run("-", stdin='{"from":[0,0],"to":[0,2]}\n{"from":[1,1],"to":[1,1]}\n')
        self.assertEqual(rc, 0)
        self.assertEqual(out, '{"cells":[[0,0],[0,1],[0,2]],"from":[0,0],"to":[0,2]}\n'
                              '{"cells":[[1,1]],"from":[1,1],"to":[1,1]}\n')

    def test_a_malformed_request_exits_2_and_says_why(self):
        rc, _, err = self._run("0", "0", "x", "2")
        self.assertEqual(rc, 2)
        self.assertIn("whole number", err)

    def test_the_printed_edge_is_in_the_help(self):
        rc, out, _ = self._run("--help")
        self.assertEqual(rc, 0)
        self.assertIn(R.PRINTED_EDGE, out.replace("\n    ", " ").replace("\n", " "))

    def test_the_selftest_passes(self):
        rc, out, _ = self._run("--selftest")
        self.assertEqual(rc, 0, out)
        self.assertRegex(out, r"^SELFTEST PASS \d+/\d+$", "a silent exit 0 is no reading")


if __name__ == "__main__":
    unittest.main()
