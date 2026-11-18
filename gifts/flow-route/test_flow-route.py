# SPDX-License-Identifier: MIT
"""test_flow-route.py — the external battery for the flow-route gift. Each test's name is the behaviour it holds.

    python3 -m unittest test_flow-route      (from this folder; FLOW_ROUTE_UNDER_TEST points it at a mutant copy)

The differential tests load the water oracle from its design home beside this one; it is the truth this router is
checked against (The Plat, plan §3.16), never a library the router uses.
"""
import importlib.util
import json
import os
import random
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


R = _load("flow_route", os.environ.get("FLOW_ROUTE_UNDER_TEST") or os.path.join(HERE, "flow-route.py"))
ORACLE_PATH = os.path.join(HERE, "..", "water-oracle", "water-oracle.py")
O = _load("water_oracle", ORACLE_PATH) if os.path.exists(ORACLE_PATH) else None


def _stream():
    h = [[9] * 20 for _ in range(5)]
    for k in range(1, 19):
        h[2][k] = 4 - (k - 1) // 6
    h[2][19] = 0
    w = [[0] * 20 for _ in range(5)]
    w[2][1] = 10
    return h, w


def _dam():
    h, w = _stream()
    h[2][10] = 6
    return h, w


def _ponds():
    h = [[9] * 11 for _ in range(5)]
    for k in (1, 2):
        h[1][k] = h[2][k] = h[3][k] = 4
    h[2][3] = 6
    for k in range(4, 7):
        h[2][k] = 10 - k
    for k in (7, 8, 9):
        h[1][k] = h[2][k] = h[3][k] = 0
    w = [[0] * 11 for _ in range(5)]
    w[2][1] = 30
    return h, w


def _rock(rows):
    h = [[9] * 10 for _ in range(rows)]
    for r in range(1, rows - 1):
        for k in range(1, 10):
            h[r][k] = 5 - k // 2
    mid = rows // 2
    h[mid][5] = 7
    w = [[0] * 10 for _ in range(rows)]
    w[mid][1] = 8
    return h, w


def _fork():
    h = [[9] * 9 for _ in range(7)]
    for k in range(1, 4):
        h[3][k] = 7 - k
    h[3][4] = 3
    for r, k, z in ((2, 4, 2), (1, 4, 2), (1, 5, 1), (1, 6, 1), (1, 7, 0), (4, 4, 2), (5, 4, 2), (5, 5, 1), (5, 6, 1),
                    (5, 7, 0)):
        h[r][k] = z
    h[1][8] = h[5][8] = 0
    w = [[0] * 9 for _ in range(7)]
    w[3][1] = 12
    return h, w


def _flat():
    h = [[0, 2, 0, 0, 2, 3, 1, 3], [3, 0, 2, 1, 0, 0, 1, 1], [2, 1, 1, 1, 1, 0, 0, 3], [2, 0, 3, 3, 3, 2, 2, 1],
         [2, 0, 0, 0, 0, 1, 1, 1], [3, 1, 0, 2, 3, 2, 3, 2]]
    w = [[0, 0, 0, 0, 0, 0, 0, 4], [0, 0, 0, 2, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0, 4, 0], [2, 5, 0, 0, 1, 0, 2, 0],
         [0, 0, 0, 1, 0, 0, 0, 4], [0, 0, 2, 0, 4, 0, 0, 0]]
    return h, w


CASES = {"gentle-stream": _stream, "dam-across-stream": _dam, "pond-channel-pond": _ponds,
         "rock-narrow-channel": lambda: _rock(3), "rock-wide-channel": lambda: _rock(5), "equal-fork": _fork,
         "flat-two-exits": _flat}
CORPUS = os.path.join(HERE, "plumb", "corpus")


def case(name):
    """The battery carries its own cases, so it runs in the served home too; the Plumb's corpus holds the same grids
    (checked by HandCases.test_the_plumb_corpus_holds_the_battery_s_own_cases wherever the corpus is present)."""
    return CASES[name]()


def ring(n, inside):
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


def projection(res):
    return json.dumps({k: res[k] for k in ("water_in", "out", "lakes", "depth")}, sort_keys=True,
                      separators=(",", ":"))


def grid(rng):
    rows, cols, hi = rng.randint(3, 9), rng.randint(3, 9), rng.choice([3, 6, 10])
    return ([[rng.randint(0, hi) for _ in range(cols)] for _ in range(rows)],
            [[rng.choice([0, 0, rng.randint(0, 5)]) for _ in range(cols)] for _ in range(rows)])


class HandCases(unittest.TestCase):
    def test_below_the_lip_a_hollow_holds_everything(self):
        self.assertEqual(summary(R.settle(ring(3, {(1, 1): 0}), wet(3, {(1, 1): 8}))), (0, [(8, "8", False)]))

    def test_at_the_spill_exactly_the_excess_leaves(self):
        self.assertEqual(summary(R.settle(ring(3, {(1, 1): 0}), wet(3, {(1, 1): 10}))), (1, [(9, "9", True)]))

    def test_a_lowered_lip_holds_less_and_spills_the_difference(self):
        h = ring(3, {(1, 1): 0})
        h[0][1] = 6
        self.assertEqual(summary(R.settle(h, wet(3, {(1, 1): 8}))), (2, [(6, "6", True)]))

    def test_two_hollows_meeting_at_a_sill_become_one_lake(self):
        h = [[9] * 5, [9, 0, 5, 0, 9], [9] * 5]
        self.assertEqual(summary(R.settle(h, [[0] * 5, [0, 20, 0, 0, 0], [0] * 5])), (0, [(20, "25/3", False)]))

    def test_a_full_pond_passes_its_excess_on_to_the_next(self):
        h, w = case("pond-channel-pond")
        res = R.settle(h, w)
        self.assertEqual([(x["stock"], x["level"]) for x in res["lakes"]], [(12, "6"), (18, "2")])

    def test_a_gentle_stream_rests_nowhere_and_passes_the_whole_way(self):
        h, w = case("gentle-stream")
        res = R.settle(h, w)
        self.assertEqual((res["out"], res["lakes"]), (10, []))
        self.assertEqual(res["passing"][2][1:], [10] * 19)

    def test_the_stream_between_two_ponds_is_the_water_that_passed_the_channel(self):
        h, w = case("pond-channel-pond")
        self.assertEqual(R.settle(h, w)["passing"][2], [0, 0, 0, 18, 18, 18, 18, 0, 0, 0, 0])

    def test_a_wet_cell_carries_no_passing_water(self):
        h, w = case("pond-channel-pond")
        res = R.settle(h, w)
        for r, row in enumerate(res["depth"]):
            for c, d in enumerate(row):
                if d != "0":
                    self.assertEqual(res["passing"][r][c], 0)

    def test_a_dam_across_a_stream_makes_a_pond_behind_it(self):
        h, w = case("dam-across-stream")
        self.assertEqual(summary(R.settle(h, w)), (0, [(10, "43/9", False)]))

    def test_a_rock_dams_a_narrow_channel_and_is_bypassed_in_a_wide_one(self):
        self.assertEqual(R.settle(*case("rock-narrow-channel"))["out"], 0)
        self.assertEqual(R.settle(*case("rock-wide-channel"))["out"], 8)

    def test_cells_touching_only_at_a_corner_do_not_carry_water(self):
        h = [[9] * 5 for _ in range(5)]
        h[1][1], h[2][2], h[3][3] = 3, 2, 1                # a diagonal "ditch"
        self.assertEqual(summary(R.settle(h, wet(5, {(1, 1): 4}))), (0, [(4, "7", False)]))   # it stays in its pit

    def test_at_an_equal_fork_the_stream_divides_evenly(self):
        h, w = case("equal-fork")
        p = R.settle(h, w)["passing"]
        self.assertEqual((p[2][4], p[4][4]), (6, 6))       # the tie rule (Plumb v2 of flow-route; oracle Plumb v3)

    def test_a_level_flat_of_touching_pits_is_one_lake_with_one_pointer_over_its_exits(self):
        h, w = case("flat-two-exits")
        self.assertEqual([(x["stock"], x["level"]) for x in R.settle(h, w)["lakes"]], [(4, "1")])

    def test_a_ring_with_a_way_out_is_not_merged_and_its_excess_drains_on(self):
        # the water oracle's shrunk witness (S06.2347): lake A spills over two equal rim cells, into C (whose only
        # spill returns to A) and down into D; nothing is trapped, so A and C stay full at 4 and D takes the rest
        T = 10
        h = [[T] * 8, [T, T, T, T, 3, 4, 2, T], [T, T, T, 0, 2, T, T, T], [T, T, T, T, 3, T, T, T],
             [T, T, 1, 0, 4, T, T, T], [T, T, 0, T, T, T, T, T], [T] * 8, [T] * 8]
        self.assertEqual(summary(R.settle(h, wet(8, {(1, 4): 6, (2, 3): 7}))),
                         (0, [(8, "4", True), (2, "4", True), (3, "4/3", False)]))

    def test_two_hollows_spilling_into_each_other_with_a_way_out_stay_two_and_the_sill_carries_the_stream(self):
        # S06.2347, shrunk from a 30,000-grid search for the wrongful merge: B (3,4) spills over two equal rim cells —
        # the sill (1,4) into A (1,3), whose only spill returns to B, and (2,5) off the edge. A and B are a ring with a
        # way out: no merge, both full at 2, and the sill carries the water that went round
        T = 99
        h = [[T] * 7, [T, T, T, 1, 2, T, T], [T, T, T, T, 1, 2, 0], [T, T, T, T, 0, T, T]] + [[T] * 7] * 3
        w = [[0] * 7 for _ in range(7)]
        w[3][5] = 6
        res = R.settle(h, w, trace=True)
        self.assertEqual((summary(res), res["merges"], res["passing"][1][4]), ((2, [(1, "2", True), (3, "2", True)]), [], 3))

    def test_a_lake_risen_to_a_flat_spills_into_it(self):
        # the water oracle's shrunk witness (seed 1233): the flat deals off the edge and down into P; P's excess
        # crosses back over the flat, whose pointer sends it off the edge too
        T = 99
        h = [[T] * 7, [1, 4, 4, 4, T, T, T], [T, T, T, 2, T, T, T], [T, T, T, 3, 4, T, T],
             [T, T, T, T, 0, T, T]] + [[T] * 7] * 3
        w = [[0] * 7 for _ in range(8)]
        w[1][2], w[1][4] = 4, 2
        self.assertEqual(summary(R.settle(h, w)), (3, [(3, "4", True)]))

    def test_a_total_through_a_tie_divides_as_its_parts_would(self):
        # dealing n at once equals dealing its parts in turn — why the router may deal totals
        rot_a, rot_b = {}, {}
        whole = dict(R.deal(rot_a, "t", ["a", "b", "c"], 11))
        parts = {}
        for v in (1, 4, 2, 4):
            for o, n in R.deal(rot_b, "t", ["a", "b", "c"], v):
                parts[o] = parts.get(o, 0) + n
        self.assertEqual((whole, rot_a), (parts, rot_b))

    @unittest.skipUnless(os.path.isdir(CORPUS), "the Plumb's corpus lives in the design home")
    def test_the_plumb_corpus_holds_the_battery_s_own_cases(self):
        for name, build in CASES.items():
            with open(os.path.join(CORPUS, name + ".json"), encoding="utf-8") as fh:
                c = json.load(fh)
            self.assertEqual((c["heights"], c["water"]), build(), name)

    def test_rain_on_the_edge_leaves(self):
        self.assertEqual(R.settle([[1, 1], [1, 1]], [[2, 0], [0, 3]])["out"], 5)

    def test_the_trace_speaks_only_the_chart_s_flow_words_and_balances(self):
        res = R.settle(*case("pond-channel-pond"), trace=True)
        self.assertTrue({p["flow"] for p in res["trace"]} <= {"route", "pond-fill", "spill", "runoff-out"})
        self.assertEqual(res["ticks"], len(res["trace"]))

    def test_a_malformed_case_is_refused(self):
        for h, w in (([], []), ([[1, 2], [3]], [[0, 0], [0]]), ([[1]], [[-1]]), ([[True]], [[0]]),
                     ([[1, 1]], [[0, 0], [0, 0]])):
            with self.assertRaises(R.CaseError):
                R.settle(h, w)

    def test_the_printed_edge_ships_in_the_header_and_the_readme(self):
        with open(os.path.join(HERE, "flow-route.py"), encoding="utf-8") as fh:
            src = fh.read()
        with open(os.path.join(HERE, "README.md"), encoding="utf-8") as fh:
            readme = fh.read()
        self.assertIn(R.PRINTED_EDGE, " ".join(src.split()))
        self.assertIn(R.PRINTED_EDGE, " ".join(readme.split()))


class Properties(unittest.TestCase):
    N = 400

    def test_water_is_never_made_or_lost(self):
        rng = random.Random(1)
        for _ in range(self.N):
            h, w = grid(rng)
            res = R.settle(h, w)
            self.assertEqual(res["water_in"], res["out"] + sum(x["stock"] for x in res["lakes"]))

    def test_the_answer_the_passing_water_and_the_trace_do_not_depend_on_the_order_water_is_routed(self):
        rng = random.Random(2)
        for _ in range(self.N):
            h, w = grid(rng)
            a = R.settle(h, w, trace=True)
            cells = [(r, c) for r in range(len(h)) for c in range(len(h[0]))]
            rng.shuffle(cells)
            self.assertEqual(R.canonical(R.settle(h, w, trace=True, order=cells)), R.canonical(a))

    def test_every_lake_is_off_the_edge_and_wet(self):
        rng = random.Random(3)
        for _ in range(self.N):
            h, w = grid(rng)
            res = R.settle(h, w)
            for x in res["lakes"]:
                for r, c in x["cells"]:
                    self.assertFalse(r in (0, len(h) - 1) or c in (0, len(h[0]) - 1))
                    self.assertNotEqual(res["depth"][r][c], "0")

    def test_the_trace_balances_against_the_answer(self):
        rng = random.Random(4)
        for _ in range(self.N):
            h, w = grid(rng)
            res = R.settle(h, w, trace=True)
            amt = {}
            for p in res["trace"]:
                amt[p["flow"]] = amt.get(p["flow"], 0) + p["amount"]
            self.assertEqual(amt.get("pond-fill", 0) - amt.get("spill", 0), sum(x["stock"] for x in res["lakes"]))
            self.assertEqual(amt.get("runoff-out", 0), res["out"])

    def test_the_same_case_gives_the_same_bytes(self):
        rng = random.Random(5)
        for _ in range(50):
            h, w = grid(rng)
            self.assertEqual(R.canonical(R.settle(h, w, trace=True)), R.canonical(R.settle(h, w, trace=True)))


@unittest.skipIf(O is None, "the water oracle's design home is not beside this one")
class Differential(unittest.TestCase):
    GOLDEN = os.path.join(HERE, "..", "water-oracle", "plumb", "golden-v2.json")

    @unittest.skipUnless(os.path.exists(GOLDEN), "the oracle's blessed Plumb lives in its design home")
    def test_the_settled_water_equals_the_oracle_s_on_its_blessed_corpus(self):
        with open(os.path.join(HERE, "..", "water-oracle", "plumb", "golden-v2.json"), encoding="utf-8") as fh:
            golden = json.load(fh)
        for name, ans in golden.items():
            with open(os.path.join(HERE, "..", "water-oracle", "plumb", "corpus", name), encoding="utf-8") as fh:
                c = json.load(fh)
            h, w = c["heights"], c["water"]
            self.assertEqual(projection(R.settle(h, w)), projection(ans), name)

    def test_the_settled_water_equals_the_oracle_s_on_seeded_grids(self):
        rng = random.Random(61106)
        for _ in range(600):
            h, w = grid(rng)
            self.assertEqual(projection(R.settle(h, w)), projection(O.settle(h, w)))



CFORK = [[9, 9, 9, 9, 9, 9, 9], [9, 9, 9, -20, 9, 9, 9], [9, 9, 9, 2, 9, 9, 9], [9, 6, 5, 4, 9, 9, 9],
         [9, 9, 9, 2, 9, 9, 9], [9, 9, 9, -20, 9, 9, 9], [9, 9, 9, 9, 9, 9, 9]]
CNODE = "cell 3,3|2,3;4,3"


def _one(r, c, n=1, R=7, C=7):
    w = [[0] * C for _ in range(R)]
    w[r][c] = n
    return w


def _held(h, res, rain, keep=4):
    w = [row[:] for row in rain]
    for L in res["lakes"]:
        cells = [tuple(c) for c in L["cells"]]
        low = min(cells, key=lambda c: (h[c[0]][c[1]], c[0], c[1]))
        w[low[0]][low[1]] += L["stock"] * keep // 4
    return w


class Carry(unittest.TestCase):
    """Plumb v3 (the tie note v1.3): pointers carry between lot-days, off the replay, by the oracle's rule."""

    def test_without_pointers_the_answer_carries_none(self):
        self.assertNotIn("pointers", R.settle(CFORK, _one(3, 1)))

    def test_one_unit_a_day_through_a_fork_alternates_its_ways(self):
        d1 = R.settle(CFORK, _one(3, 1), pointers={})
        d2 = R.settle(CFORK, _one(3, 1), pointers=d1["pointers"])
        self.assertEqual((d1["pointers"], d2["pointers"]), ({CNODE: 1}, {}))
        self.assertNotEqual(d1["lakes"][0]["cells"], d2["lakes"][0]["cells"])

    def test_a_pointer_nothing_touched_passes_through_unchanged(self):
        self.assertEqual(R.settle(CFORK, [[0] * 7 for _ in range(7)], pointers={CNODE: 1})["pointers"], {CNODE: 1})

    def test_a_tie_whose_ways_end_in_one_lake_carries_nothing(self):
        h = [[9, 9, 9, 9, 9], [9, 3, 5, 3, 9], [9, 2, 9, 2, 9], [9, 1, 0, 1, 9], [9, 9, 9, 9, 9]]
        w = [[0] * 5 for _ in range(5)]
        w[1][2] = 3
        self.assertEqual(R.settle(h, w, pointers={})["pointers"], {})
        high = [[9, 9, 9, 9, 9], [9, 7, 8, 7, 9], [9, 6, 9, 6, 9], [9, 5, 0, 5, 9], [9, 9, 1, 9, 9]]   # above a low spill
        self.assertEqual(R.settle(high, w, pointers={})["pointers"], {})

    def test_a_tie_that_decides_nothing_keeps_the_pointer_it_came_in_with(self):
        high = [[9, 9, 9, 9, 9], [9, 7, 8, 7, 9], [9, 6, 9, 6, 9], [9, 5, 0, 5, 9], [9, 9, 1, 9, 9]]
        w = [[0] * 5 for _ in range(5)]
        w[1][2] = 3
        self.assertEqual(R.settle(high, w, pointers={"cell 1,2|1,1;1,3": 1})["pointers"], {"cell 1,2|1,1;1,3": 1})

    def test_a_carried_pointer_that_is_not_one_is_refused(self):
        for bad in ({CNODE: -1}, {CNODE: True}, {CNODE: "1"}):
            with self.assertRaises(R.CaseError):
                R.settle(CFORK, _one(3, 1), pointers=bad)

    def test_splitting_water_across_two_days_never_changes_where_it_rests(self):
        rng = random.Random(5471)
        for _ in range(120):
            Rr, C = rng.randint(3, 7), rng.randint(3, 7)
            h = [[rng.randint(0, 6) for _ in range(C)] for _ in range(Rr)]
            A = [[rng.choice([0, 0, rng.randint(0, 3)]) for _ in range(C)] for _ in range(Rr)]
            B = [[rng.choice([0, 0, rng.randint(0, 3)]) for _ in range(C)] for _ in range(Rr)]
            AB = [[A[i][j] + B[i][j] for j in range(C)] for i in range(Rr)]
            d1 = R.settle(h, A, pointers={})
            d2 = R.settle(h, _held(h, d1, B), pointers=d1["pointers"])
            one = R.settle(h, AB, pointers={})
            self.assertEqual((d2["lakes"], d1["out"] + d2["out"]), (one["lakes"], one["out"]))

    @unittest.skipIf(O is None, "the oracle's home is not beside this one")
    def test_the_carry_agrees_with_the_oracle_on_water_and_pointers_day_after_day(self):
        rng = random.Random(5472)
        for _ in range(80):
            Rr, C = rng.randint(3, 7), rng.randint(3, 7)
            h = [[rng.randint(0, 6) for _ in range(C)] for _ in range(Rr)]
            po = pr = O.settle(h, [[rng.randint(0, 2) for _ in range(C)] for _ in range(Rr)], pointers={})["pointers"]
            res = None
            for d in range(3):
                rain = [[rng.choice([0, 0, 0, rng.randint(0, 3)]) for _ in range(C)] for _ in range(Rr)]
                water = rain if res is None else _held(h, res, rain, keep=rng.randint(0, 3))
                ro, rr = O.settle(h, water, pointers=po), R.settle(h, water, pointers=pr)
                self.assertEqual((rr["out"], rr["lakes"], rr["pointers"]), (ro["out"], ro["lakes"], ro["pointers"]))
                po, pr, res = ro["pointers"], rr["pointers"], ro


def _sea(rng, rows, cols):
    inner = [[r, c] for r in range(1, rows - 1) for c in range(1, cols - 1)]
    rng.shuffle(inner)
    return sorted(inner[:rng.randint(1, max(1, len(inner) // 4))]) if inner else []


class Outlets(unittest.TestCase):
    """Plumb v4: interior cells named as outlets drain exactly as the grid's edge does (water-oracle Plumb v5)."""

    def test_without_outlets_the_answer_is_v3_s(self):
        rng = random.Random(81)
        for _ in range(150):
            h, w = grid(rng)
            base = R.canonical(R.settle(h, w))
            self.assertEqual(R.canonical(R.settle(h, w, outlets=None)), base)
            self.assertEqual(R.canonical(R.settle(h, w, outlets=[])), base)

    def test_water_on_an_outlet_leaves(self):
        h = ring(3, {(1, 1): 0})
        self.assertEqual(summary(R.settle(h, wet(3, {(1, 1): 4}), outlets=[[1, 1]])), (4, []))
        self.assertEqual(summary(R.settle(h, wet(3, {(1, 1): 4}))), (0, [(4, "4", False)]))

    def test_a_river_reaches_the_sea_and_leaves(self):
        h = [[9] * 7, [9] * 7, [9, 5, 4, 3, 2, 0, 9], [9] * 7, [9] * 7]
        w = [[0] * 7 for _ in range(5)]
        w[2][1] = 6
        self.assertEqual(summary(R.settle(h, w, outlets=[[2, 5]])), (6, []))
        self.assertEqual(summary(R.settle(h, w)), (0, [(6, "11/3", False)]))

    def test_a_hollow_whose_lowest_rim_falls_to_an_outlet_spills_into_it(self):
        h = [[9] * 6, [9, 5, 5, 5, 9, 9], [9, 5, 0, 3, 1, 9], [9, 5, 5, 5, 9, 9], [9] * 6]
        w = [[0] * 6 for _ in range(5)]
        w[2][2] = 10
        self.assertEqual(summary(R.settle(h, w, outlets=[[2, 4]])), (7, [(3, "3", True)]))

    def test_water_is_never_made_or_lost_and_no_outlet_is_under_a_lake(self):
        rng = random.Random(82)
        for _ in range(200):
            h, w = grid(rng)
            sea = _sea(rng, len(h), len(h[0]))
            r = R.settle(h, w, outlets=sea)
            self.assertEqual(sum(x["stock"] for x in r["lakes"]) + r["out"], sum(map(sum, w)))
            for lake in r["lakes"]:
                self.assertFalse({tuple(c) for c in lake["cells"]} & {tuple(c) for c in sea})

    @unittest.skipIf(O is None, "the water oracle is not beside this home")
    def test_the_router_agrees_with_the_oracle_on_a_sea(self):
        rng = random.Random(83)
        for _ in range(300):
            h, w = grid(rng)
            sea = _sea(rng, len(h), len(h[0]))
            self.assertEqual(projection(R.settle(h, w, outlets=sea)), projection(O.settle(h, w, outlets=sea)),
                             (h, w, sea))

    def test_the_command_line_reads_outlets(self):
        import subprocess, sys, tempfile
        h = [[9] * 7, [9] * 7, [9, 5, 4, 3, 2, 0, 9], [9] * 7, [9] * 7]
        w = [[0] * 7 for _ in range(5)]
        w[2][1] = 6
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            json.dump({"heights": h, "water": w, "outlets": [[2, 5]]}, fh)
        try:
            path = os.environ.get("FLOW_ROUTE_UNDER_TEST") or os.path.join(HERE, "flow-route.py")
            r = subprocess.run([sys.executable, path, "settle", fh.name], capture_output=True, text=True)
        finally:
            os.unlink(fh.name)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(summary(json.loads(r.stdout)), (6, []))

    def test_a_malformed_outlet_is_refused(self):
        h, w = ring(3, {(1, 1): 0}), wet(3, {})
        for bad in ([[3, 0]], [[0, -1]], [[1]], [[1, 1.0]], [[True, 1]], "1,1", [(1, 1)], {"1": 1}):
            with self.assertRaises(R.CaseError, msg=repr(bad)):
                R.settle(h, w, outlets=bad)


class ShelfBesideAnotherLake(unittest.TestCase):
    """Outside Read plat-line-tool/2, finding 7 (S16.1250): a pool's flood crosses a dry shelf to its spill cell, and a
    DIFFERENT lake touches that spill cell. The shelf walk asked whether any wet cell touched the spill cell, so the
    receiving lake switched the walk off and the shelf's passing read 0. Only the emitting pool's own water counts."""

    def test_the_shelf_a_flood_crosses_carries_it_though_another_lake_touches_the_spill_cell(self):
        g = [[9] * 5 for _ in range(5)]
        g[1], g[2] = [9, 9, 9, 1, 2], [9, 0, 5, 5, 9]
        w = [[0] * 5 for _ in range(5)]
        w[2][1] = 30
        res = R.settle(g, w)
        self.assertEqual(res["passing"][2][2], 25)
        self.assertEqual(res["passing"][2][3], 25)
        self.assertEqual(res["out"], 24)



class PassingLeftOut(unittest.TestCase):
    """v4 `passing=False` (S17.1309, owed flow-route-settle-skip-passing): the passing water is most of a big settle's
    time and a check that reads only the lakes, the trace and `out` never needs it. Left out, every other field is the
    same bytes."""

    def test_without_passing_every_other_field_is_the_same_bytes_over_seeded_grids(self):
        rng = random.Random(1709)
        for _ in range(300):
            rows, cols = rng.randint(2, 7), rng.randint(2, 7)
            h = [[rng.randint(0, 9) for _ in range(cols)] for _ in range(rows)]
            w = [[rng.choice((0, 0, 1, 3, 12)) for _ in range(cols)] for _ in range(rows)]
            for kw in ({}, {"trace": True}, {"trace": True, "pointers": {}}):
                full = R.settle(h, w, **kw)
                lean = R.settle(h, w, passing=False, **kw)
                self.assertNotIn("passing", lean)
                full.pop("passing")
                self.assertEqual(R.canonical(lean), R.canonical(full), (h, w, kw))

    def test_by_default_the_answer_still_carries_passing(self):
        self.assertIn("passing", R.settle([[9, 9, 9], [9, 0, 9], [9, 9, 9]], [[0, 0, 0], [0, 7, 0], [0, 0, 0]]))

    def test_passing_is_true_or_false(self):
        for bad in (0, 1, None, "no"):
            with self.assertRaises(R.CaseError, msg=repr(bad)):
                R.settle([[1, 1], [1, 1]], [[0, 0], [0, 0]], passing=bad)


class SpeedPath(unittest.TestCase):
    """S18.0926 (owed dikw-drainage-fast-path): the settle takes its cells high to low, keeps its depressions in id
    order, and remembers a cell's ways, a spill cell's ways out of its depression, and trapped()'s reach between
    merges; the replay keeps its cells low to high. Every answer is the same bytes as before (witnessed old against
    new at region 64). These hold the three things the speed rests on: the replay's order (a dry flat's passing water
    is read off it), a merge forgetting what trapped() remembered, and a spill cell's ways belonging to its own
    depression (one spill cell can serve two)."""

    def test_a_dry_flat_s_passing_water_follows_the_replay_s_order(self):
        # a flat of pits at height 0 (cells 2,3 / 3,2 / 3,3) with no capacity and several spills: its arrivals are
        # dealt over the spills by one pointer, so which cell's water walks to which spill follows the replay's
        # order. Pinned from the Gift as it stood before S18.0926; replayed high to low the flat reads 2, 2, 3.
        h = [[2, 1, 0, 2, 3], [0, 1, 2, 2, 3], [1, 0, 3, 0, 0], [2, 1, 0, 0, 0], [3, 2, 0, 2, 0]]
        w = [[2, 2, 1, 0, 1], [0, 1, 1, 1, 0], [0, 1, 0, 0, 0], [1, 0, 2, 2, 2], [0, 1, 0, 1, 1]]
        res = R.settle(h, w)
        self.assertEqual(res["passing"], [[2, 2, 2, 0, 1], [1, 1, 1, 1, 0], [0, 0, 0, 3, 2], [1, 0, 3, 5, 4],
                                          [0, 1, 1, 1, 1]])
        self.assertEqual(res["out"], 19)

    @unittest.skipUnless(os.path.isdir(CORPUS), "the Plumb's corpus and golden live in the design home")
    def test_merges_and_shared_spill_cells_answer_their_golden_trace_in_time(self):
        # the corpus cases a stale memo or a misordered replay moves: merges (a memo a merge must clear), a spill cell
        # two depressions share (whose ways out differ by depression: shared, the water runs back in for ever), and
        # the cases whose trace the replay's order writes. Driven through the command line under a deadline, so a
        # build that never finishes fails here instead of hanging the battery.
        import subprocess, sys
        path = os.environ.get("FLOW_ROUTE_UNDER_TEST") or os.path.join(HERE, "flow-route.py")
        with open(os.path.join(HERE, "plumb", "golden-v4.json"), encoding="utf-8") as fh:
            golden = json.load(fh)
        for name in ("sill-merge.json", "tie-ring-with-exit.json", "tie-sill-stream.json", "dry-sill-two-lakes.json",
                     "flat-two-exits.json", "bowl-terraces.json", "outlet-tie-sea-or-pit.json"):
            case = os.path.join(HERE, "plumb", "corpus", name)
            try:
                r = subprocess.run([sys.executable, path, "trace", case], capture_output=True, text=True, timeout=30)
            except subprocess.TimeoutExpired:
                self.fail("%s did not settle in 30 s" % name)
            self.assertEqual(r.returncode, 0, "%s: %s" % (name, r.stderr[-300:]))
            self.assertEqual(json.loads(r.stdout), golden[name], name)

    def test_the_settle_order_is_free_and_the_answer_is_the_same(self):
        # the Gift's order= is the battery's handle on the settle's cell order; high to low (the default now) and
        # every cell reversed must give the same bytes, merges included
        rng = random.Random(180926)
        for _ in range(200):
            n = rng.randint(3, 7)
            h = [[rng.randint(0, 4) for _ in range(n)] for _ in range(n)]
            w = [[rng.randint(0, 3) for _ in range(n)] for _ in range(n)]
            cells = [(r, c) for r in range(n) for c in range(n)]
            try:
                a = R.settle(h, w, trace=True)
                b = R.settle(h, w, trace=True, order=cells[::-1])
            except Exception as e:                         # a crash is a failed reading here, never a pass
                self.fail("settle raised %r on %r" % (e, (h, w)))
            self.assertEqual(R.canonical(a), R.canonical(b), (h, w))


if __name__ == "__main__":
    unittest.main()
