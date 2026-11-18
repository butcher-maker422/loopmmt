#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""
water-oracle — where does the water settle? Exact fill-and-spill on a height grid.

Give it a grid of ground heights and the water standing on each cell (both whole numbers, in one unit of depth per
cell). It runs every drop downhill, fills each hollow to its brim, spills what a full hollow cannot hold over its
lowest rim, merges hollows whose water meets, and sends what reaches the grid's edge out. It returns where every unit
ended up: each lake's cells, its whole stock, its exact (fractional) waterline and whether it stands at its rim, and how much
left over the edge. A lake is a connected body of wet cells — the water, never the bookkeeping that filled it.

It exists to be the OTHER code — the truth a game's water router is checked against (The Plat, plan §3.16: "the water
oracle is separate code", written from the terrain and the stocks alone, never from the router). Its answer depends
only on the heights and the water: route the drops in any order and the result is byte-identical.

WHAT IT IS (and is not)
    Integer in, integer out. Stocks are whole units and conserve exactly: water in = lake stock + out, always (checked
    on every run). A waterline is the exact rational level whose storage equals the stock (storage(h) = sum over the
    lake's cells of max(0, h - ground)) — never a float. Four-neighbour grid; the grid's edge cells are its outlets
    (water on an edge cell leaves). Water runs to the lowest lower neighbour. Where there are equally low ways out it
    is dealt round-robin (Plumb v3, The Plat tie rule): each tie keeps a pointer over its ways in (height, row, column)
    order and each unit takes the pointed way, so over n units a k-way tie gives way i (0-based) (n + k - 1 - i) // k.
    The same holds at a full hollow's equally low spill cells and at a level flat's exits (a flat of touching pits is
    one hollow with one pointer over all its exits). Only the total through a tie decides its split, so parcels may be
    routed in any order and in any sizes and the answer is the same (the rotor-router's abelian property).

DAY AFTER DAY (Plumb v4, the tie note v1.3)
    Pass `pointers` (a JSON object, possibly empty) and the tie pointers carry from one settle to the next, so splitting
    water across days never changes where it rests. The answer then also gives `pointers`: the day's water routed once
    more, parcel by parcel, through the network the settle ended with (every lake at its final region, every merge
    made), from the pointers carried in. A tie whose ways come to rest in more than one place on that network carries the
    pointer that pass leaves it; any other node keeps the pointer it came in with. Names are the terrain's:
    "cell r,c|w;w" (a cell and its equally low ways) and "lake r,c|s;s" (a full hollow by its lowest cell, and its spill
    cells). Without `pointers` the answer is v3's, byte for byte, save its version.

OUTLETS (Plumb v5)
    Pass `outlets` (a list of [row, column] cells) and each named cell drains exactly as an edge cell does: water that
    reaches it leaves and is counted in `out`, it is never part of a lake, and a hollow whose lowest rim touches it
    spills into it. A sea is the usual case: name its cells and every river that reaches it leaves the land. Without
    `outlets` (or with an empty list) the answer is v4's, byte for byte, save its version.

USAGE
    water-oracle.py settle CASE.json        the settled state as canonical JSON (exit 0; 2 a malformed case)
    water-oracle.py --selftest              the built-in battery (exit 0 all pass)
    CASE.json: {"heights": [[int, ...], ...], "water": [[int >= 0, ...], ...]}  (same rectangular shape)
               optional "pointers": {"cell r,c|w;w": int, "lake r,c|s;s": int, ...}  (v4: carried pointers)
               optional "outlets": [[row, column], ...]  (v5: interior cells that drain like the edge)

THE PRINTED EDGE
    water-oracle says where still water comes to rest on a grid of heights; it does not model flow over time, rain
    rates, soaking into the ground, evaporation or ice, and it does not say how fast anything happens — only where the
    water ends up once everything has run.

MIT License. Python 3 standard library only. No network, no randomness, no clock.
"""
import json
import sys
from fractions import Fraction

PRINTED_EDGE = ("water-oracle says where still water comes to rest on a grid of heights; it does not model flow over "
                "time, rain rates, soaking into the ground, evaporation or ice, and it does not say how fast anything "
                "happens — only where the water ends up once everything has run.")
VERSION = "v5"
EDGE = "edge"
STEP_BUDGET = 8          # parcel steps per cell per unit (+1): measured worst 0.074 over 3,000 grids — a guard, not a proof


class CaseError(ValueError):
    pass


def _whole(x):
    return isinstance(x, int) and not isinstance(x, bool)


def _check(heights, water):
    if not (isinstance(heights, list) and heights and all(isinstance(r, list) and r for r in heights)):
        raise CaseError("heights is a non-empty list of non-empty rows")
    cols = len(heights[0])
    if any(len(r) != cols for r in heights):
        raise CaseError("heights is rectangular: every row the same length")
    if not all(_whole(x) for r in heights for x in r):
        raise CaseError("every height is a whole number (not a boolean)")
    if not (isinstance(water, list) and len(water) == len(heights) and all(isinstance(r, list) and len(r) == cols
                                                                            for r in water)):
        raise CaseError("water has the same shape as heights")
    if not all(_whole(x) and x >= 0 for r in water for x in r):
        raise CaseError("every water amount is a whole number >= 0")


def storage(level, ground):
    """Water held over cells of ground heights `ground` when it stands at `level`."""
    return sum(level - g for g in ground if level > g)


def waterline(stock, ground):
    """The exact level whose storage equals `stock` (a Fraction): with the k lowest cells under water,
    (stock + their heights) / k for the k whose span holds it."""
    hs = sorted(ground)
    if stock <= 0:
        return Fraction(hs[0])
    run = 0
    for k in range(1, len(hs) + 1):
        run += hs[k - 1]
        w = Fraction(stock + run, k)
        if k == len(hs) or w <= hs[k]:
            return w


class _Rotor(dict):
    """Tie pointers that remember which nodes a deal wrote this settle (v4): a carried pointer no deal touched passes
    through the lot-day unchanged."""
    def __init__(self, start=()):
        super().__init__(start)
        self.touched = set()

    def __setitem__(self, node, p):
        self.touched.add(node)
        super().__setitem__(node, p)


class _Settle:
    def __init__(self, heights, outlets=frozenset()):
        self.h = heights
        self.outlets = outlets   # v5: interior cells that drain like the grid's edge (a sea, a sink); empty by default
        self.R, self.C = len(heights), len(heights[0])
        self.owner = {}          # cell -> lake id (cells under a lake's water or draining into it)
        self.lakes = {}          # id -> {"region": set, "stock": int, "brim": int | None, "spills": [cell] | None}
        self.alias = {}          # merged lake id -> the id it merged into
        self.rotor = _Rotor()    # tie node -> its pointer (v4: carried in from the last lot-day only when asked)
        self.next_id = 0
        self.lowc = {}           # lake id -> its lowest cell in key order (a pit: the name every Gift agrees on)
        self.out = 0
        self.steps = 0
        self.budget = STEP_BUDGET

    def g(self, c):
        return self.h[c[0]][c[1]]

    def key(self, c):
        return (self.g(c), c[0], c[1])

    def edge(self, c):
        return c[0] in (0, self.R - 1) or c[1] in (0, self.C - 1) or c in self.outlets

    def nbrs(self, c):
        r, k = c
        for dr, dk in ((-1, 0), (0, -1), (0, 1), (1, 0)):
            if 0 <= r + dr < self.R and 0 <= k + dk < self.C:
                yield (r + dr, k + dk)

    def find(self, lid):
        while lid in self.alias:
            lid = self.alias[lid]
        return lid

    def lake_at(self, c):
        lid = self.owner.get(c)
        return None if lid is None else self.find(lid)

    def ways(self, c, exclude=frozenset()):
        """The equally lowest strictly lower neighbours of c (outside `exclude`), in key order; [] for none."""
        lower = [n for n in self.nbrs(c) if n not in exclude and self.g(n) < self.g(c)]
        if not lower:
            return []
        m = min(self.g(n) for n in lower)
        return sorted((n for n in lower if self.g(n) == m), key=self.key)

    def deal(self, node, ways, v):
        """Deal v units over `ways` round-robin from the node's pointer; advance it. -> [(way, units > 0)]."""
        k = len(ways)
        if k == 1:
            return [(ways[0], v)]
        p = self.rotor.get(node, 0)
        self.rotor[node] = (p + v) % k
        return [(w, n) for i, w in enumerate(ways) for n in ((v + k - 1 - (i - p) % k) // k,) if n]

    def lake_node(self, lid, spills):
        """A lake's spill tie, named by its lowest cell and its spills (v4): the terrain's name for it, the same in
        every Gift and every lot-day, where a lake id is only a construction number."""
        if lid not in self.lowc:
            self.lowc[lid] = min(self.lakes[lid]["region"], key=self.key)
        return ("lake", self.lowc[lid], tuple(spills))

    def decides(self, node, memo):
        """Is `node` a tie on this settle's network (a dry cell's equally low ways, a full lake's spill cells, or a
        spill cell's ways outside its lake) whose ways come to rest in more than one place?"""
        kind, c, ws = node
        if kind == "lake":
            lid = self.lake_at(c)
            if lid is None or not self.full(lid) or self.lake_node(lid, self.lakes[lid]["spills"]) != node:
                return False
        elif self.lake_at(c) is None:
            if tuple(self.ways(c)) != ws and not any(
                    c in (L["spills"] or ()) and tuple(self.ways(c, L["region"])) == ws for L in self.lakes.values()):
                return False
        else:
            return False
        return len(self.places(node, memo)) > 1

    def places(self, node, memo):
        """Where the ways of a tie node come to rest on this settle's network: a tie DECIDES only if more than one."""
        if node[0] == "lake":
            lid = self.lake_at(node[1])
            out = set()
            for s in node[2]:
                if self.edge(s):
                    out.add(EDGE)
                elif self.lake_at(s) is not None:
                    out.add(self.lake_at(s))
                else:
                    for w in self.ways(s, self.lakes[lid]["region"] if lid is not None else frozenset()):
                        out |= self.terminals(w, memo)
            return out
        return set().union(*(self.terminals(w, memo) for w in node[2]))

    def seed(self):
        """Every flat of touching pits (cells with no lower neighbour) is one lake from the start, fixed by the
        terrain: a lake that rises to it spills into it, never swallows it, so no tie changes hands with the water."""
        for c in sorted((r, k) for r in range(self.R) for k in range(self.C)):
            if self.edge(c) or c in self.owner or self.ways(c):
                continue
            lid, todo = self.new_lake(c), [c]
            while todo:
                x = todo.pop()
                for n in self.nbrs(x):
                    if n not in self.owner and not self.edge(n) and not self.ways(n):
                        self.lakes[lid]["region"].add(n)
                        self.owner[n] = lid
                        todo.append(n)

    def new_lake(self, c):
        lid = self.next_id
        self.next_id += 1
        self.lakes[lid] = {"region": {c}, "stock": 0, "brim": None, "spills": None}
        self.owner[c] = lid
        return lid

    def merge(self, ids):
        """A trapped ring of full lakes becomes one new lake (a new id, so no tie pointer carries over)."""
        lid = self.next_id
        self.next_id += 1
        M = {"region": set(), "stock": 0, "brim": None, "spills": None}
        for other in sorted(self.find(i) for i in ids):
            O = self.lakes.pop(other)
            M["region"] |= O["region"]
            M["stock"] += O["stock"]
            self.alias[other] = lid
        for c in M["region"]:
            self.owner[c] = lid
        self.lakes[lid] = M
        return lid

    def fill(self, lid):
        """Grow lake lid until its stock fits under its lowest rim. -> (excess, spill cells) or (0, []).
        At the rim height every rim cell that drains only into this lake is taken in (it holds nothing at that level),
        so the spill set is every rim cell at that height that is an edge cell, has a strictly lower way out, or is
        another lake's cell (a flat this lake has risen to). No way out leads back into this lake: such a path would
        need a rim cell lower than the rim."""
        L = self.lakes[lid]
        while True:
            frontier = {n for c in L["region"] for n in self.nbrs(c)} - L["region"]
            rim_h = min(self.g(b) for b in frontier)
            cap = storage(rim_h, [self.g(c) for c in L["region"]])
            if L["stock"] < cap:
                L["brim"], L["spills"] = None, None
                return 0, []
            rim = [b for b in frontier if self.g(b) == rim_h]
            grow = [b for b in rim if not self.edge(b) and self.lake_at(b) is None and self.ways(b)
                    and not self.ways(b, L["region"])]   # drains into this lake and nowhere else: its catchment
            if grow:
                for b in grow:
                    L["region"].add(b)
                    self.owner[b] = lid
                continue
            excess, L["stock"], L["brim"] = L["stock"] - cap, cap, rim_h
            L["spills"] = sorted(rim, key=self.key)
            return excess, L["spills"]

    def full(self, lid):
        return self.lakes[lid]["spills"] is not None

    def terminals(self, c, memo):
        """Where water set down at c can come to rest first, over every branch of every tie."""
        if c in memo:
            return memo[c]
        if self.edge(c):
            t = {EDGE}
        elif self.lake_at(c) is not None:
            t = {self.lake_at(c)}
        else:
            ws = self.ways(c)
            t = {("pit", c)} if not ws else set().union(*(self.terminals(w, memo) for w in ws))
        memo[c] = t
        return t

    def after(self, lid, memo):
        """Where a full lake's excess can come to rest first."""
        L, out = self.lakes[lid], set()
        for s in L["spills"]:
            if self.edge(s):
                out.add(EDGE)
            elif self.lake_at(s) is not None:
                out.add(self.lake_at(s))
            else:
                for w in self.ways(s, L["region"]):
                    out |= self.terminals(w, memo)
        return out

    def trapped(self, lid):
        """The ring a full lake is trapped in — the set of full lakes reachable from it, when none of them has a way
        to anything but each other and each can reach lid back — else None (its water leaves by the rotors)."""
        if not self.full(lid):
            return None
        memo, reach, todo, succ = {}, {lid}, [lid], {}
        while todo:
            x = todo.pop()
            succ[x] = self.after(x, memo)
            for y in succ[x]:
                if y == EDGE or isinstance(y, tuple) or not self.full(y):
                    return None
                if y not in reach:
                    reach.add(y)
                    todo.append(y)
        back, todo = {lid}, [lid]
        while todo:
            y = todo.pop()
            for x in reach:
                if x not in back and y in succ[x]:
                    back.add(x)
                    todo.append(x)
        return reach if back == reach else None

    def route(self, c, v):
        stack = [(c, v, ())]                              # parcels still running: (cell, units, full lakes passed)
        while stack:
            c, v, path = stack.pop()
            while v > 0:
                self.steps += 1
                if self.steps > self.budget:              # fail loud, never spin: water that does not settle
                    raise AssertionError("water that never settles (step budget spent)")
                if self.edge(c):
                    self.out += v
                    break
                lid = self.lake_at(c)
                if lid is None:
                    ws = self.ways(c)
                    if len(ws) == 1:
                        c = ws[0]
                        continue
                    if ws:                                # a fork: deal the parcel over its equal ways
                        stack.extend((w, n, path) for w, n in self.deal(("cell", c, tuple(ws)), ws, v))
                        break
                    lid = self.new_lake(c)
                path = tuple(self.find(x) for x in path)
                if lid in path:                           # back at a full lake: a ring, if nothing gets out of it
                    ring = self.trapped(lid)
                    if ring and len(ring) > 1:
                        lid = self.merge(ring)
                        path = tuple(x for x in path if x not in ring)
                self.lakes[lid]["stock"] += v
                v, spills = self.fill(lid)
                if v == 0:
                    break
                path = path + (lid,)
                region = self.lakes[lid]["region"]
                for s, n in self.deal(self.lake_node(lid, spills), spills, v):
                    if self.edge(s):
                        self.out += n
                    elif self.lake_at(s) is not None:     # the rim reaches another lake (a flat): into it
                        stack.append((s, n, path))
                    else:                                 # the tie is the cell and its ways, whoever spilled
                        ws = self.ways(s, region)
                        stack.extend((w, m, path) for w, m in self.deal(("cell", s, tuple(ws)), ws, n))
                break


def _outlets(heights, outlets):
    """v5: the outlet cells as a frozenset of (row, column); None or [] for none. Each is a [row, column] pair of whole
    numbers inside the grid; a repeated cell is one outlet."""
    if outlets is None:
        return frozenset()
    if not isinstance(outlets, list):
        raise CaseError("outlets is a list of [row, column] cells")
    out = set()
    for c in outlets:
        if not (isinstance(c, list) and len(c) == 2 and all(_whole(x) for x in c)):
            raise CaseError("each outlet is a [row, column] pair of whole numbers")
        if not (0 <= c[0] < len(heights) and 0 <= c[1] < len(heights[0])):
            raise CaseError("every outlet is a cell inside the grid")
        out.add((c[0], c[1]))
    return frozenset(out)


def settle(heights, water, order=None, parcels=None, pointers=None, outlets=None):
    """-> the settled state (a dict of plain JSON types). `order` (a permutation of the cells) and `parcels` (a list of
    (row, column, units) whose units sum to each cell's water) are for the battery's order- and batching-independence
    checks; the answer must depend on neither. `pointers` (v4) carries the tie pointers in from the last lot-day: the
    answer then also carries them out (`pointers`), by the tie note v1.3's statement; without it the answer is v3's.
    `outlets` (v5) names interior cells that drain like the grid's edge: water reaching one leaves, and a lake that
    meets one at its rim spills into it. Without it (or with []) the answer is v4's."""
    _check(heights, water)
    outs = _outlets(heights, outlets)
    s = _Settle(heights, outs)
    cells = [(r, c) for r in range(s.R) for c in range(s.C)]
    if parcels is None:
        parcels = [(r, c, water[r][c]) for r, c in (order or cells)]
    else:
        given = [[0] * s.C for _ in range(s.R)]
        for r, c, v in parcels:
            given[r][c] += v
        if given != water:
            raise CaseError("the parcels do not add up to the water")
    if pointers is not None:
        s.rotor = _Rotor(_rotor_in(pointers))
    s.seed()
    s.budget = STEP_BUDGET * s.R * s.C * (sum(map(sum, water)) + 1)
    for r, c, v in parcels:
        s.route((r, c), v)
    res = _answer(s, water)
    if pointers is None:
        return res
    # The carry (v4, the tie note v1.3): route the day's water again, parcel by parcel in key order, through the network
    # this settle ended with — every merge it made fixed from the start — from the pointers carried in. The pointers
    # that pass leaves at every tie that DECIDES on that network are the day's carried pointers.
    t = _Settle(heights, outs)
    t.rotor = _Rotor(_rotor_in(pointers))
    t.seed()
    for lid in sorted(s.lakes):                          # the network the settle ended with: every wet lake at its
        L = s.lakes[lid]                                 # final region, every merge made, before any water moves
        if not L["stock"]:
            continue
        ids = sorted({t.lake_at(c) for c in L["region"] if t.lake_at(c) is not None})
        tid = t.new_lake(min(L["region"])) if not ids else ids[0] if len(ids) == 1 else t.merge(ids)
        for c in L["region"]:
            t.lakes[tid]["region"].add(c)
            t.owner[c] = tid
    t.budget = s.budget
    for r, c in cells_in_order(t):
        t.route((r, c), water[r][c])
    if _answer(t, water) != res:
        raise AssertionError("the carry pass does not land the water where the settle did")
    memo, out, start = {}, {}, _rotor_in(pointers)
    for node in set(start) | t.rotor.touched:            # a tie that decides today carries today's pointer; any other
        p = t.rotor[node] if t.decides(node, memo) else start.get(node, 0)    # keeps the one it came in with
        if p:
            out[_node_name(node)] = p
    res["pointers"] = dict(sorted(out.items()))
    return res


def cells_in_order(s):
    return [(r, c) for r in range(s.R) for c in range(s.C)]


def _cell(x):
    return f"{x[0]},{x[1]}"


def _node_name(node):
    """'cell r,c|w;w' for a cell's tie (a spill cell's included: the cell and its ways, whoever spilled), 'lake r,c|s;s'
    for a lake's spill tie by its lowest cell. Plain strings, so the carried state is JSON and Gift-neutral."""
    return f"{node[0]} {_cell(node[1])}|" + ";".join(_cell(w) for w in node[2])


def _rotor_key(name):
    try:
        kind, rest = name.split(" ", 1)
        head, tail = rest.split("|", 1)
        cell = tuple(int(x) for x in head.split(","))
        ways = tuple(tuple(int(x) for x in w.split(",")) for w in tail.split(";"))
    except (ValueError, AttributeError):
        raise CaseError(f"a carried pointer's name that is not one: {name!r}")
    if kind not in ("cell", "lake"):
        raise CaseError(f"a carried pointer's name that is not one: {name!r}")
    return (kind, cell, ways)


def _rotor_in(pointers):
    rotor = {}
    for name, p in pointers.items():
        key = _rotor_key(name)
        if not isinstance(p, int) or isinstance(p, bool) or not 0 <= p < len(key[2]):
            raise CaseError(f"a carried pointer that is not one: {name!r}: {p!r}")
        rotor[key] = p
    return rotor


def _answer(s, water):
    total = sum(map(sum, water))
    depth = [["0"] * s.C for _ in range(s.R)]
    level_at = {}                                        # wet cell -> its water's level
    for L in s.lakes.values():
        if L["stock"] == 0:
            continue
        ground = [s.g(c) for c in L["region"]]
        level = Fraction(L["brim"]) if L["brim"] is not None else waterline(L["stock"], ground)
        assert storage(level, ground) == L["stock"], "a waterline that does not hold its stock"
        for c in L["region"]:
            if level > s.g(c):
                assert c not in level_at, "one cell under two lakes"
                level_at[c] = level
    # The answer is the WATER, not the bookkeeping: a lake is a 4-connected body of wet cells. Two bodies standing at
    # one level and meeting only at a dry sill exactly at that level are two lakes, however the fill reached them
    # (S06.1927: 31 of 20,000 random grids told the two merges apart only in how they grouped such bodies).
    lakes, seen = [], set()
    for start in sorted(level_at):
        if start in seen:
            continue
        body, stack = [], [start]
        seen.add(start)
        while stack:
            c = stack.pop()
            body.append(c)
            for n in s.nbrs(c):
                if n in level_at and n not in seen:
                    assert level_at[n] == level_at[c], "touching water at two levels"
                    seen.add(n)
                    stack.append(n)
        body.sort()
        level = level_at[start]
        stock = Fraction(storage(level, [s.g(c) for c in body]))
        assert stock.denominator == 1, "a lake of fractional stock"
        rim = any(n not in level_at and s.g(n) == level for c in body for n in s.nbrs(c))
        for c in body:
            depth[c[0]][c[1]] = str(level - s.g(c))
        lakes.append({"cells": [list(c) for c in body], "stock": int(stock), "level": str(level), "at_rim": rim})
    held = sum(x["stock"] for x in lakes)
    assert held + s.out == total, "water was made or lost"
    return {"oracle": "water-oracle", "version": VERSION, "water_in": total, "out": s.out, "lakes": lakes,
            "depth": depth}


def canonical(result):
    return json.dumps(result, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


SELFTEST = [
    # (name, heights, water, expected out, expected [(stock, level)] by lake)
    ("a one-cell hollow holds what fits below its rim",
     [[9, 9, 9], [9, 0, 9], [9, 9, 9]], [[0, 0, 0], [0, 5, 0], [0, 0, 0]], 0, [(5, "5")]),
    ("at the brim exactly, nothing leaves",
     [[9, 9, 9], [9, 0, 9], [9, 9, 9]], [[0, 0, 0], [0, 9, 0], [0, 0, 0]], 0, [(9, "9")]),
    ("over the brim, exactly the excess leaves",
     [[9, 9, 9], [9, 0, 9], [9, 9, 9]], [[0, 0, 0], [0, 12, 0], [0, 0, 0]], 3, [(9, "9")]),
    ("water on an edge cell leaves", [[0, 0], [0, 0]], [[1, 2], [3, 4]], 10, []),
    ("a shelf inside a hollow goes under once the water rises past it",
     [[9, 9, 9, 9], [9, 0, 2, 9], [9, 0, 9, 9], [9, 9, 9, 9]], [[0, 0, 0, 0], [0, 6, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
     0, [(6, "8/3")]),
]


def selftest():
    bad = 0
    for name, h, w, out, lakes in SELFTEST:
        r = settle(h, w)
        got = (r["out"], [(x["stock"], x["level"]) for x in r["lakes"]])
        ok = got == (out, lakes)
        cells = [(i, j) for i in range(len(h)) for j in range(len(h[0]))]
        ok = ok and canonical(settle(h, w, list(reversed(cells)))) == canonical(r)
        print(("PASS " if ok else "FAIL ") + name + ("" if ok else f" — got {got}"))
        bad += not ok
    print(f"water-oracle selftest: {len(SELFTEST) - bad}/{len(SELFTEST)}")
    return 0 if bad == 0 else 1


def main(argv=None):
    a = sys.argv[1:] if argv is None else argv
    if a[:1] == ["--selftest"]:
        return selftest()
    if a[:1] in (["--help"], ["-h"]):
        print(__doc__.strip())
        return 0
    if len(a) != 2 or a[0] != "settle":
        print(__doc__.split("USAGE")[1].split("THE PRINTED EDGE")[0].strip(), file=sys.stderr)
        return 2
    try:
        with open(a[1], encoding="utf-8") as fh:
            case = json.load(fh)
        if not isinstance(case, dict):
            raise CaseError("a case is a JSON object with heights and water")
        ptr = case.get("pointers")
        if ptr is not None and not isinstance(ptr, dict):
            raise CaseError("pointers is a JSON object of carried tie pointers")
        print(canonical(settle(case.get("heights"), case.get("water"), pointers=ptr, outlets=case.get("outlets"))))
    except (OSError, ValueError, CaseError, AttributeError) as e:
        print(f"water-oracle: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
