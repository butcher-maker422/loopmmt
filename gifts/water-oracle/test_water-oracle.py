# SPDX-License-Identifier: MIT
"""test_water-oracle.py — the external battery for the water-oracle gift. Each test's name is the behaviour it holds.

    python3 -m unittest test_water-oracle      (from this folder; WATER_ORACLE_UNDER_TEST points it at a mutant copy)
"""
import importlib.util
import os
import random
import unittest
from fractions import Fraction

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "water_oracle", os.environ.get("WATER_ORACLE_UNDER_TEST") or os.path.join(HERE, "water-oracle.py"))
W = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(W)


def ring(n, inside):
    """An n x n grid of 9s with the given interior heights (a dict (r, c) -> h)."""
    h = [[9] * n for _ in range(n)]
    for (r, c), v in inside.items():
        h[r][c] = v
    return h


def wet(n, at):
    w = [[0] * n for _ in range(n)]
    for (r, c), v in at.items():
        w[r][c] = v
    return w


def summary(res):
    return res["out"], [(x["stock"], x["level"], x["at_rim"]) for x in res["lakes"]]


def grid(rng, rows, cols, lo=0, hi=6, water=4):
    return ([[rng.randint(lo, hi) for _ in range(cols)] for _ in range(rows)],
            [[rng.choice([0, 0, rng.randint(0, water)]) for _ in range(cols)] for _ in range(rows)])


class HandCases(unittest.TestCase):
    def test_below_the_brim_nothing_spills(self):
        self.assertEqual(summary(W.settle(ring(3, {(1, 1): 0}), wet(3, {(1, 1): 8}))), (0, [(8, "8", False)]))

    def test_at_the_spill_exactly_the_excess_leaves(self):
        self.assertEqual(summary(W.settle(ring(3, {(1, 1): 0}), wet(3, {(1, 1): 10}))), (1, [(9, "9", True)]))

    def test_a_lowered_lip_holds_less_and_spills_the_difference(self):
        h = ring(3, {(1, 1): 0})
        h[0][1] = 6                                       # the lip edit: one rim cell lowered from 9 to 6
        self.assertEqual(summary(W.settle(h, wet(3, {(1, 1): 8}))), (2, [(6, "6", True)]))
        self.assertEqual(summary(W.settle(h, wet(3, {(1, 1): 6}))), (0, [(6, "6", True)]))

    def test_two_hollows_meeting_at_a_sill_become_one_lake(self):
        h = [[9] * 5, [9, 0, 5, 0, 9], [9] * 5]
        w = [[0] * 5, [0, 20, 0, 0, 0], [0] * 5]
        self.assertEqual(summary(W.settle(h, w)), (0, [(20, "25/3", False)]))

    def test_a_perched_hollow_spills_into_a_lower_one_that_drains_out(self):
        h = [[9] * 5, [9, 0, 4, 0, 2], [9] * 5]
        w = [[0] * 5, [0, 20, 0, 0, 0], [0] * 5]
        self.assertEqual(summary(W.settle(h, w)), (14, [(4, "4", True), (2, "2", True)]))

    def test_two_bodies_at_one_level_meeting_at_a_dry_sill_are_two_lakes(self):
        # found S06.1927 by searching 20,000 random grids: the fill reaches these as one lake or two depending on
        # which merge fires; the answer is the water, and the water is two bodies at level 2 with a dry sill between
        h = [[4, 3, 2, 1], [6, 1, 2, 2], [2, 3, 2, 8], [0, 4, 0, 3], [1, 1, 5, 0], [4, 0, 1, 1], [1, 4, 1, 4]]
        w = [[0, 0, 0, 0], [0, 8, 0, 0], [1, 12, 6, 0], [0, 8, 8, 0], [0, 0, 0, 0], [7, 0, 2, 0], [11, 0, 0, 0]]
        self.assertEqual(summary(W.settle(h, w)), (59, [(1, "2", True), (2, "2", True), (1, "1", True)]))

    def test_water_on_a_flat_interior_runs_off_the_edge(self):
        self.assertEqual(summary(W.settle([[5] * 3] * 3, wet(3, {(1, 1): 7}))), (7, []))

    def test_water_on_a_slope_runs_down_into_the_hollow(self):
        h = [[9, 9, 9, 9], [9, 0, 3, 9], [9, 9, 9, 9]]
        w = [[0, 0, 0, 0], [0, 0, 2, 0], [0, 0, 0, 0]]
        self.assertEqual(summary(W.settle(h, w)), (0, [(2, "2", False)]))

    def test_a_negative_hollow_below_the_datum_holds_water(self):
        self.assertEqual(summary(W.settle(ring(3, {(1, 1): -4}), wet(3, {(1, 1): 3}))), (0, [(3, "-1", False)]))

    def test_the_waterline_is_exact_and_holds_its_stock(self):
        res = W.settle(ring(4, {(1, 1): 0, (1, 2): 1, (2, 1): 1, (2, 2): 2}), wet(4, {(1, 1): 5}))
        lv = Fraction(res["lakes"][0]["level"])
        self.assertEqual(W.storage(lv, [0, 1, 1, 2]), 5)

    def test_each_wet_cell_s_depth_is_the_level_less_its_ground(self):
        h = ring(4, {(1, 1): 0, (1, 2): 1, (2, 1): 1, (2, 2): 2})
        res = W.settle(h, wet(4, {(1, 1): 5}))
        lv = Fraction(res["lakes"][0]["level"])
        for r, c in res["lakes"][0]["cells"]:
            self.assertEqual(Fraction(res["depth"][r][c]), lv - h[r][c])
        self.assertEqual(res["depth"][0][0], "0")

    def test_a_malformed_case_is_refused(self):
        for h, w in (([[1, 2], [3]], [[0, 0], [0]]), ([[1]], [[-1]]), ([[True]], [[0]]), ([[1]], [[0, 0]])):
            with self.assertRaises(W.CaseError):
                W.settle(h, w)

    def test_help_starts_clean_and_prints_the_edge(self):
        import subprocess, sys
        r = subprocess.run([sys.executable, _spec.origin, "--help"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0)
        self.assertIn("THE PRINTED EDGE", r.stdout)

    def test_the_printed_edge_ships_in_the_file(self):
        with open(_spec.origin, encoding="utf-8") as fh:
            self.assertIn(W.PRINTED_EDGE[:60], " ".join(fh.read().split()))


def fork(units):
    """A trunk running east into a cell with two equally low ways out (north, south), each to its own deep hollow."""
    h = ring(7, {(3, 1): 6, (3, 2): 5, (3, 3): 4, (2, 3): 2, (4, 3): 2, (1, 3): -20, (5, 3): -20})
    return h, wet(7, {(3, 1): units})


def stocks_at(res, *cells):
    return [next((x["stock"] for x in res["lakes"] if x["cells"] == [list(c)]), 0) for c in cells]


class Ties(unittest.TestCase):
    """The tie rule (the Plat's tie rule): equally low ways out share the water round-robin."""

    def test_at_a_fork_the_water_divides_evenly(self):
        self.assertEqual(stocks_at(W.settle(*fork(12)), (1, 3), (5, 3)), [6, 6])

    def test_at_a_fork_the_odd_unit_takes_the_first_way_in_key_order(self):
        self.assertEqual(stocks_at(W.settle(*fork(13)), (1, 3), (5, 3)), [7, 6])

    def test_a_full_hollow_divides_its_excess_between_equally_low_spill_cells(self):
        h = ring(7, {(3, 3): 0, (2, 3): 3, (4, 3): 3, (1, 3): -20, (5, 3): -20})
        self.assertEqual(stocks_at(W.settle(h, wet(7, {(3, 3): 7})), (1, 3), (5, 3)), [2, 2])

    def test_a_level_flat_divides_its_water_between_its_exits_wherever_it_lands(self):
        # a flat at 5 in row 3 (two pits between two exit cells); an exit at each end into its own deep hollow
        inside = {(3, c): 5 for c in range(2, 6)}
        inside.update({(3, 1): 4, (3, 6): 4, (2, 1): -20, (2, 6): -20})
        h = ring(8, inside)
        for land in ((3, 3), (3, 4)):                  # the two pits: one flat, one pointer over both exits
            res = W.settle(h, wet(8, {land: 10}))
            self.assertEqual(stocks_at(res, (2, 1), (2, 6)), [5, 5], land)
        res = W.settle(h, wet(8, {(3, 2): 10}))       # an exit cell is no pit: its water runs down its own way
        self.assertEqual(stocks_at(res, (2, 1), (2, 6)), [10, 0])

    def test_a_tie_into_a_ring_that_has_a_way_out_does_not_merge_the_ring(self):
        # S06.2347, shrunk from a 20,000-grid search: lake A (around 2,3) spills over two equally low rim cells at 4 —
        # (1,5) into hollow C (1,6), whose only spill runs back into A, and (4,4) down into hollow D. A and C are a ring
        # with a way out, so nothing is trapped: the rotors drain the excess to D, A and C stay full at 4 over their
        # shared sill, and D holds the rest. Merging A and C (as if trapped) gets all three lakes wrong.
        T = 10
        h = [[T] * 8,
             [T, T, T, T, 3, 4, 2, T],
             [T, T, T, 0, 2, T, T, T],
             [T, T, T, T, 3, T, T, T],
             [T, T, 1, 0, 4, T, T, T],
             [T, T, 0, T, T, T, T, T],
             [T] * 8, [T] * 8]
        res = W.settle(h, wet(8, {(1, 4): 6, (2, 3): 7}))
        self.assertEqual(summary(res), (0, [(8, "4", True), (2, "4", True), (3, "4/3", False)]))


    def test_a_lake_rising_to_a_flat_spills_into_it_and_never_swallows_it(self):
        # S06.2347, shrunk from the confluence battery (seed 1233): the flat (1,2) deals its water two ways — off the
        # edge at (1,1) and down into hollow P at (2,3). If P, risen to 4, swallowed the flat, water landing there
        # would meet P's pointer instead of the flat's, and the answer would hang on how full P was when it came.
        T = 99
        h = [[T] * 7, [1, 4, 4, 4, T, T, T], [T, T, T, 2, T, T, T], [T, T, T, 3, 4, T, T], [T, T, T, T, 0, T, T]] + [[T] * 7] * 3
        w = [[0] * 7 for _ in range(8)]
        w[1][2], w[1][4] = 4, 2
        base = W.canonical(W.settle(h, w))
        for units in ([(1, 2, 1), (1, 4, 1), (1, 4, 1), (1, 2, 1), (1, 2, 1), (1, 2, 1)],
                      [(1, 4, 2), (1, 2, 4)], [(1, 2, 4), (1, 4, 2)]):
            self.assertEqual(W.canonical(W.settle(h, w, parcels=units)), base, units)


class Properties(unittest.TestCase):
    """Over 300 seeded random grids — each a property the answer must have whatever the terrain."""
    CASES = [grid(random.Random(seed), 2 + seed % 5, 2 + (seed * 7) % 6) for seed in range(300)]

    def test_water_is_never_made_or_lost(self):
        for h, w in self.CASES:
            r = W.settle(h, w)
            self.assertEqual(sum(x["stock"] for x in r["lakes"]) + r["out"], sum(map(sum, w)))

    def test_one_parcel_of_n_settles_as_n_parcels_of_one_in_any_order(self):
        # the property the tie rule exists for: only the total through a tie decides its split
        for i, (h, w) in enumerate(self.CASES[:150]):
            base = W.canonical(W.settle(h, w))
            units = [(r, c, 1) for r in range(len(h)) for c in range(len(h[0])) for _ in range(w[r][c])]
            random.Random(7 * i).shuffle(units)
            self.assertEqual(W.canonical(W.settle(h, w, parcels=units)), base, (h, w))

    def test_any_split_of_the_water_into_parcels_settles_the_same(self):
        for i, (h, w) in enumerate(self.CASES[150:]):
            base, rng, parcels = W.canonical(W.settle(h, w)), random.Random(11 * i), []
            for r in range(len(h)):
                for c in range(len(h[0])):
                    left = w[r][c]
                    while left:
                        take = rng.randint(1, left)
                        parcels.append((r, c, take))
                        left -= take
            rng.shuffle(parcels)
            self.assertEqual(W.canonical(W.settle(h, w, parcels=parcels)), base, (h, w))

    def test_parcels_that_do_not_add_up_to_the_water_are_refused(self):
        with self.assertRaises(W.CaseError):
            W.settle([[1, 1, 1]] * 3, wet(3, {(1, 1): 2}), parcels=[(1, 1, 1)])

    def test_the_answer_does_not_depend_on_the_order_the_water_is_routed(self):
        for i, (h, w) in enumerate(self.CASES[:120]):
            base = W.canonical(W.settle(h, w))
            cells = [(r, c) for r in range(len(h)) for c in range(len(h[0]))]
            for k in range(4):
                random.Random(i * 31 + k).shuffle(cells)
                self.assertEqual(W.canonical(W.settle(h, w, list(cells))), base, (h, w))

    def test_no_lake_stands_above_a_dry_neighbour(self):
        for h, w in self.CASES:
            for lake in W.settle(h, w)["lakes"]:
                lv, mine = Fraction(lake["level"]), {tuple(c) for c in lake["cells"]}
                for r, c in mine:
                    for n in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
                        if n not in mine and 0 <= n[0] < len(h) and 0 <= n[1] < len(h[0]):
                            self.assertGreaterEqual(h[n[0]][n[1]], lv, (h, w, lake))

    def test_every_lake_cell_is_wet_and_off_the_edge(self):
        for h, w in self.CASES:
            for lake in W.settle(h, w)["lakes"]:
                for r, c in lake["cells"]:
                    self.assertLess(h[r][c], Fraction(lake["level"]))
                    self.assertFalse(r in (0, len(h) - 1) or c in (0, len(h[0]) - 1))

    def test_each_lake_holds_exactly_the_storage_of_its_cells_at_its_level(self):
        for h, w in self.CASES:
            for lake in W.settle(h, w)["lakes"]:
                self.assertEqual(W.storage(Fraction(lake["level"]), [h[r][c] for r, c in lake["cells"]]), lake["stock"])

    def test_a_lake_is_one_connected_body_of_water(self):
        for h, w in self.CASES:
            for lake in W.settle(h, w)["lakes"]:
                cells = {tuple(c) for c in lake["cells"]}
                seen, stack = set(), [next(iter(cells))]
                while stack:
                    r, c = stack.pop()
                    if (r, c) in seen:
                        continue
                    seen.add((r, c))
                    stack += [n for n in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)) if n in cells]
                self.assertEqual(seen, cells)

    def test_more_water_never_leaves_less_anywhere(self):
        for i, (h, w) in enumerate(self.CASES[:150]):
            r0 = W.settle(h, w)
            w2 = [row[:] for row in w]
            w2[i % len(h)][(i * 3) % len(h[0])] += 1 + i % 4
            r1 = W.settle(h, w2)
            self.assertGreaterEqual(r1["out"], r0["out"])
            self.assertGreaterEqual(sum(x["stock"] for x in r1["lakes"]), sum(x["stock"] for x in r0["lakes"]))

    def test_the_same_case_gives_the_same_bytes(self):
        for h, w in self.CASES[:50]:
            self.assertEqual(W.canonical(W.settle(h, w)), W.canonical(W.settle(h, w)))


class WideProperties(unittest.TestCase):
    """The widened generator (heights to 20, sides to 14): where a differential reads clean at small heights, widen."""
    CASES = [grid(random.Random(1000 + s), 3 + s % 12, 3 + (s * 5) % 12, hi=[6, 10, 20][s % 3], water=6)
             for s in range(120)]

    def test_wide_grids_settle_the_same_in_any_order_and_any_batching(self):
        for i, (h, w) in enumerate(self.CASES):
            base = W.canonical(W.settle(h, w))
            cells = [(r, c) for r in range(len(h)) for c in range(len(h[0]))]
            random.Random(i).shuffle(cells)
            self.assertEqual(W.canonical(W.settle(h, w, list(cells))), base, (h, w))
            units = [(r, c, 1) for r, c in cells for _ in range(w[r][c])]
            random.Random(i + 1).shuffle(units)
            self.assertEqual(W.canonical(W.settle(h, w, parcels=units)), base, (h, w))

    def test_wide_grids_balance_and_more_water_never_leaves_less(self):
        for i, (h, w) in enumerate(self.CASES):
            r0 = W.settle(h, w)
            self.assertEqual(sum(x["stock"] for x in r0["lakes"]) + r0["out"], sum(map(sum, w)))
            w2 = [row[:] for row in w]
            w2[i % len(h)][(i * 3) % len(h[0])] += 1 + i % 5
            r1 = W.settle(h, w2)
            self.assertGreaterEqual(r1["out"], r0["out"])
            self.assertGreaterEqual(sum(x["stock"] for x in r1["lakes"]), sum(x["stock"] for x in r0["lakes"]))



FORK = [[9, 9, 9, 9, 9, 9, 9], [9, 9, 9, -20, 9, 9, 9], [9, 9, 9, 2, 9, 9, 9], [9, 6, 5, 4, 9, 9, 9],
        [9, 9, 9, 2, 9, 9, 9], [9, 9, 9, -20, 9, 9, 9], [9, 9, 9, 9, 9, 9, 9]]
FORK_NODE = "cell 3,3|2,3;4,3"


def _one_at(r, c, n=1, R=7, C=7):
    w = [[0] * C for _ in range(R)]
    w[r][c] = n
    return w


def _held_next(h, res, rain, keep=4):
    w = [row[:] for row in rain]
    for L in res["lakes"]:
        cells = [tuple(c) for c in L["cells"]]
        low = min(cells, key=lambda c: (h[c[0]][c[1]], c[0], c[1]))
        w[low[0]][low[1]] += L["stock"] * keep // 4
    return w


class Carry(unittest.TestCase):
    """Plumb v4 (the tie note v1.3): the pointers carry from one lot-day to the next."""

    def test_without_pointers_the_answer_carries_none(self):
        self.assertNotIn("pointers", W.settle(FORK, _one_at(3, 1)))

    def test_one_unit_a_day_through_a_fork_alternates_its_ways(self):
        d1 = W.settle(FORK, _one_at(3, 1), pointers={})
        self.assertEqual(d1["pointers"], {FORK_NODE: 1})
        d2 = W.settle(FORK, _one_at(3, 1), pointers=d1["pointers"])
        self.assertEqual(d2["pointers"], {})
        north = [L["stock"] for L in d1["lakes"]]
        south = [L["stock"] for L in d2["lakes"]]
        self.assertEqual((north, south), ([1], [1]))
        self.assertNotEqual(d1["lakes"][0]["cells"], d2["lakes"][0]["cells"])

    def test_a_pointer_nothing_touched_passes_through_unchanged(self):
        dry = [[0] * 7 for _ in range(7)]
        self.assertEqual(W.settle(FORK, dry, pointers={FORK_NODE: 1})["pointers"], {FORK_NODE: 1})

    def test_a_tie_whose_ways_end_in_one_lake_carries_nothing(self):
        h = [[9, 9, 9, 9, 9], [9, 3, 5, 3, 9], [9, 2, 9, 2, 9], [9, 1, 0, 1, 9], [9, 9, 9, 9, 9]]
        w = [[0] * 5 for _ in range(5)]
        w[1][2] = 3
        self.assertEqual(W.settle(h, w, pointers={})["pointers"], {})
        high = [[9, 9, 9, 9, 9], [9, 7, 8, 7, 9], [9, 6, 9, 6, 9], [9, 5, 0, 5, 9], [9, 9, 1, 9, 9]]   # above a low spill
        self.assertEqual(W.settle(high, w, pointers={})["pointers"], {})

    def test_a_tie_that_decides_nothing_keeps_the_pointer_it_came_in_with(self):
        high = [[9, 9, 9, 9, 9], [9, 7, 8, 7, 9], [9, 6, 9, 6, 9], [9, 5, 0, 5, 9], [9, 9, 1, 9, 9]]
        w = [[0] * 5 for _ in range(5)]
        w[1][2] = 3
        self.assertEqual(W.settle(high, w, pointers={"cell 1,2|1,1;1,3": 1})["pointers"], {"cell 1,2|1,1;1,3": 1})

    def test_a_carried_pointer_that_is_not_one_is_refused(self):
        for bad in ({FORK_NODE: 2}, {FORK_NODE: -1}, {FORK_NODE: True}, {"cell 3,3": 0}, {"pond 3,3|2,3;4,3": 0}):
            with self.assertRaises(W.CaseError):
                W.settle(FORK, _one_at(3, 1), pointers=bad)

    def test_splitting_water_across_two_days_never_changes_where_it_rests(self):
        rng = random.Random(4471)
        for _ in range(150):
            R, C = rng.randint(3, 7), rng.randint(3, 7)
            h = [[rng.randint(0, 6) for _ in range(C)] for _ in range(R)]
            A = [[rng.choice([0, 0, rng.randint(0, 3)]) for _ in range(C)] for _ in range(R)]
            B = [[rng.choice([0, 0, rng.randint(0, 3)]) for _ in range(C)] for _ in range(R)]
            AB = [[A[i][j] + B[i][j] for j in range(C)] for i in range(R)]
            d1 = W.settle(h, A, pointers={})
            d2 = W.settle(h, _held_next(h, d1, B), pointers=d1["pointers"])
            one = W.settle(h, AB, pointers={})
            self.assertEqual((d2["lakes"], d1["out"] + d2["out"]), (one["lakes"], one["out"]))

    def test_the_carried_pointers_do_not_depend_on_routing_order_over_days(self):
        rng = random.Random(4472)
        for _ in range(60):
            R, C = rng.randint(3, 7), rng.randint(3, 7)
            h = [[rng.randint(0, 6) for _ in range(C)] for _ in range(R)]
            cells = [(i, j) for i in range(R) for j in range(C)]
            ptr, res = {}, None
            for d in range(3):
                rain = [[rng.choice([0, 0, 0, rng.randint(0, 3)]) for _ in range(C)] for _ in range(R)]
                water = rain if res is None else _held_next(h, res, rain, keep=rng.randint(0, 3))
                outs = []
                for k in range(3):
                    o = cells[:]
                    random.Random(d * 7 + k).shuffle(o)
                    outs.append(W.settle(h, water, order=o, pointers=ptr))
                self.assertTrue(all(x == outs[0] for x in outs))
                ptr, res = outs[0]["pointers"], outs[0]


    def test_where_merges_make_the_settles_own_pointers_order_dependent_the_carry_is_not(self):
        """Two grids found S07.1103 by searching with the mutant that carries the settle's own pointers: there the
        pointers a settle ends with depend on routing order (merges timed by the water); the carry must not."""
        grids = [
            ([[0, 1, 5, 5, 4], [4, 4, 0, 3, 3], [3, 6, 3, 1, 4], [2, 4, 2, 4, 4], [1, 2, 3, 3, 2], [2, 2, 5, 3, 2],
              [6, 5, 6, 4, 3]],
             [[0, 0, 4, 0, 0], [5, 0, 0, 0, 0], [2, 0, 0, 6, 0], [0, 0, 0, 1, 0], [0, 1, 0, 0, 0], [4, 6, 0, 1, 1],
              [0, 6, 0, 0, 0]]),
            ([[5, 1, 1, 3, 6, 5, 3, 6], [2, 4, 6, 4, 2, 5, 4, 4], [1, 5, 5, 1, 4, 5, 6, 2], [3, 4, 5, 4, 5, 1, 4, 1],
              [0, 4, 6, 6, 3, 5, 1, 6], [0, 4, 5, 2, 5, 1, 0, 6], [2, 1, 5, 3, 2, 2, 0, 4]],
             [[0, 0, 0, 0, 1, 0, 5, 0], [0, 0, 0, 5, 0, 6, 0, 6], [0, 2, 0, 0, 5, 1, 0, 0], [5, 4, 2, 1, 3, 5, 5, 4],
              [0, 1, 5, 0, 0, 0, 0, 5], [0, 0, 0, 0, 0, 1, 0, 0], [1, 4, 0, 2, 3, 4, 0, 0]]),
        ]
        for h, w in grids:
            cells = [(i, j) for i in range(len(h)) for j in range(len(h[0]))]
            seen = set()
            for k in range(24):
                o = cells[:]
                random.Random(k).shuffle(o)
                seen.add(W.canonical(W.settle(h, w, order=o, pointers={})))
            self.assertEqual(len(seen), 1)


def _sea(rng, h, k):
    """k distinct interior cells of h as outlets (a scattered sea), in a fixed order."""
    R, C = len(h), len(h[0])
    inner = [[r, c] for r in range(1, R - 1) for c in range(1, C - 1)]
    rng.shuffle(inner)
    return sorted(inner[:k])


def _sea_case(seed):
    rng = random.Random(9000 + seed)
    h, w = grid(rng, 3 + seed % 5, 3 + (seed * 5) % 6)
    return h, w, _sea(rng, h, rng.randint(1, 3))


class Outlets(unittest.TestCase):
    """Plumb v5: interior cells named as outlets drain exactly as the grid's edge does."""
    CASES = [_sea_case(seed) for seed in range(240)]

    def test_without_outlets_the_answer_is_v4_s(self):
        for h, w in Properties.CASES[:120]:
            self.assertEqual(W.canonical(W.settle(h, w, outlets=None)), W.canonical(W.settle(h, w)))
            self.assertEqual(W.canonical(W.settle(h, w, outlets=[])), W.canonical(W.settle(h, w)))

    def test_an_outlet_on_the_grid_s_edge_changes_nothing(self):
        for h, w in Properties.CASES[:120]:
            self.assertEqual(W.canonical(W.settle(h, w, outlets=[[0, 0], [len(h) - 1, 0]])),
                             W.canonical(W.settle(h, w)))

    def test_a_repeated_outlet_is_one_outlet(self):
        for h, w, sea in self.CASES[:60]:
            self.assertEqual(W.canonical(W.settle(h, w, outlets=sea + sea)), W.canonical(W.settle(h, w, outlets=sea)))

    def test_water_on_an_outlet_leaves(self):
        h = ring(3, {(1, 1): 0})
        self.assertEqual(summary(W.settle(h, wet(3, {(1, 1): 4}), outlets=[[1, 1]])), (4, []))
        self.assertEqual(summary(W.settle(h, wet(3, {(1, 1): 4}))), (0, [(4, "4", False)]))

    def test_a_hollow_whose_lowest_rim_falls_to_an_outlet_spills_into_it(self):
        h = [[9] * 6, [9, 5, 5, 5, 9, 9], [9, 5, 0, 3, 1, 9], [9, 5, 5, 5, 9, 9], [9] * 6]
        w = [[0] * 6 for _ in range(5)]
        w[2][2] = 10
        self.assertEqual(summary(W.settle(h, w, outlets=[[2, 4]])), (7, [(3, "3", True)]))

    def test_water_is_never_made_or_lost(self):
        for h, w, sea in self.CASES:
            r = W.settle(h, w, outlets=sea)
            self.assertEqual(sum(x["stock"] for x in r["lakes"]) + r["out"], sum(map(sum, w)))

    def test_no_outlet_is_ever_under_a_lake(self):
        for h, w, sea in self.CASES:
            for lake in W.settle(h, w, outlets=sea)["lakes"]:
                self.assertFalse({tuple(c) for c in lake["cells"]} & {tuple(c) for c in sea}, (h, w, sea))

    def test_an_outlet_never_leaves_more_water_on_the_land(self):
        for h, w, sea in self.CASES:
            self.assertGreaterEqual(W.settle(h, w, outlets=sea)["out"], W.settle(h, w)["out"], (h, w, sea))

    def test_the_answer_does_not_depend_on_order_or_batching(self):
        for i, (h, w, sea) in enumerate(self.CASES[:120]):
            base = W.canonical(W.settle(h, w, outlets=sea))
            cells = [(r, c) for r in range(len(h)) for c in range(len(h[0]))]
            random.Random(i).shuffle(cells)
            self.assertEqual(W.canonical(W.settle(h, w, list(cells), outlets=sea)), base, (h, w, sea))
            units = [(r, c, 1) for r in range(len(h)) for c in range(len(h[0])) for _ in range(w[r][c])]
            random.Random(i + 1).shuffle(units)
            self.assertEqual(W.canonical(W.settle(h, w, parcels=units, outlets=sea)), base, (h, w, sea))

    def test_splitting_water_across_two_days_with_a_sea_never_changes_where_it_rests(self):
        rng = random.Random(5171)
        for _ in range(120):
            R, C = rng.randint(3, 7), rng.randint(3, 7)
            h = [[rng.randint(0, 6) for _ in range(C)] for _ in range(R)]
            sea = _sea(rng, h, rng.randint(1, 2))
            A = [[rng.choice([0, 0, rng.randint(0, 3)]) for _ in range(C)] for _ in range(R)]
            B = [[rng.choice([0, 0, rng.randint(0, 3)]) for _ in range(C)] for _ in range(R)]
            AB = [[A[i][j] + B[i][j] for j in range(C)] for i in range(R)]
            d1 = W.settle(h, A, pointers={}, outlets=sea)
            d2 = W.settle(h, _held_next(h, d1, B), pointers=d1["pointers"], outlets=sea)
            one = W.settle(h, AB, pointers={}, outlets=sea)
            self.assertEqual((d2["lakes"], d1["out"] + d2["out"]), (one["lakes"], one["out"]))

    def test_the_command_line_reads_outlets(self):
        import json, subprocess, sys, tempfile
        h = [[9] * 7, [9] * 7, [9, 5, 4, 3, 2, 0, 9], [9] * 7, [9] * 7]
        w = [[0] * 7 for _ in range(5)]
        w[2][1] = 6
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            json.dump({"heights": h, "water": w, "outlets": [[2, 5]]}, fh)
        try:
            r = subprocess.run([sys.executable, _spec.origin, "settle", fh.name], capture_output=True, text=True)
        finally:
            os.unlink(fh.name)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(summary(json.loads(r.stdout)), (6, []))

    def test_a_malformed_outlet_is_refused(self):
        h, w = ring(3, {(1, 1): 0}), wet(3, {})
        for bad in ([[3, 0]], [[0, -1]], [[1]], [[1, 1.0]], [[True, 1]], "1,1", [(1, 1)], {"1": 1}):
            with self.assertRaises(W.CaseError, msg=repr(bad)):
                W.settle(h, w, outlets=bad)


if __name__ == "__main__":
    unittest.main()
