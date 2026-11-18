#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""
flow-route — The Plat's water router. Where does the rain go, and which moves took it there?

Give it a grid of ground heights and the water standing on each cell (whole numbers, one unit of depth per cell). It
finds every hollow in the land first — from the heights alone — then pours all the water through them: each drop runs
down to its hollow or off the edge, each hollow fills to its spill, a full hollow passes what it cannot hold on from
its lowest rim, and hollows that spill round into each other become one. You get the settled water (each lake's cells,
whole stock, exact level, whether it stands at its rim; what left; each cell's depth) and the count of transfers, and
with `trace` the transfers themselves.

HOW (two passes; the terrain pass knows nothing about water)
    1. Terrain. A cell's ways are its equally lowest strictly lower neighbours. Interior cells with none are pits;
       touching pits are one flat, one sink. From each sink a heap Priority-Flood takes in its catchment (cells whose
       every lower neighbour is already inside) in (height, row, column) order, up to the first height h with a rim
       cell that is not catchment: every such rim cell at h (an edge cell, a cell with a lower way out, another sink's
       pit) is a spill cell. h caps the depression.
    2. Water. Every cell and depression is a node; water waits at a node as a total and a node passes its total on
       when its turn comes, in any order. A tie deals its total round-robin from its own pointer (the tie rule: over
       n units a k-way tie gives way i, in (height, row, column) order, (n + k - 1 - i) // k) — dealing a total is
       dealing its parts in turn, so totals may be dealt at once. A full depression deals its excess over its spill
       cells. A set of full depressions with no way out but each other is one depression, flooded afresh from the
       union. The settled answer is the same in every order (held to the water oracle, Plumb v3).
    3. Replay. All the water runs once more through the settled network, its depressions fixed, in one canonical
       schedule: the trace, the ticks and the passing water are read off the replay, so they too are the same in every
       order; the replay must land every unit where the settle did.

THE TRACE speaks the journal chart's flow words (The Plat, plan §3.18): `route` (downhill to a sink), `pond-fill`
(into a depression), `spill` (out of a full one at its spill cell), `runoff-out` (off the edge). Each posting is one
tick; a tick counts transfers, never time.

USAGE
    flow-route.py settle CASE.json      the settled state as canonical JSON (exit 0; 2 a malformed case)
    flow-route.py trace CASE.json       the same with every transfer, in order
    flow-route.py --selftest            the built-in battery (exit 0 all pass)
    CASE.json: {"heights": [[int, ...], ...], "water": [[int >= 0, ...], ...]}  (same rectangular shape)
               optional "pointers": {...} (v3: carried tie pointers) · optional "outlets": [[row, column], ...]
               (v4: interior cells that drain like the edge, as water-oracle Plumb v5)
               optional "pointers": {"cell r,c|w;w": int, "lake r,c|s;s": int, ...}  (v3: carried tie pointers; the
               answer then carries them out for the next lot-day, read off the replay through the settled network —
               the same names and the same rule as water-oracle Plumb v4, held to it by conformance)

THE PRINTED EDGE
    flow-route says where still water comes to rest on a grid of heights and which transfers took it there; it does
    not model how fast water moves, rain rates, soaking into the ground, evaporation or ice, and its ticks count
    transfers, not time.

MIT License. Python 3 standard library only. No network, no randomness, no clock.
"""
import heapq
import json
import sys
from fractions import Fraction

PRINTED_EDGE = ("flow-route says where still water comes to rest on a grid of heights and which transfers took it "
                "there; it does not model how fast water moves, rain rates, soaking into the ground, evaporation or "
                "ice, and its ticks count transfers, not time.")
VERSION = "v4"
OFF = "edge"


class CaseError(ValueError):
    pass


def validate(heights, water):
    def whole(x):
        return type(x) is int

    if not isinstance(heights, list) or not heights:
        raise CaseError("heights is a non-empty list of rows")
    width = len(heights[0]) if isinstance(heights[0], list) else 0
    for row in heights:
        if not isinstance(row, list) or not row or len(row) != width:
            raise CaseError("heights is rectangular: non-empty rows, all one length")
        if not all(whole(x) for x in row):
            raise CaseError("every height is a whole number (not a boolean)")
    if not isinstance(water, list) or len(water) != len(heights):
        raise CaseError("water has the same shape as heights")
    for row in water:
        if not isinstance(row, list) or len(row) != width:
            raise CaseError("water has the same shape as heights")
        if not all(whole(x) and x >= 0 for x in row):
            raise CaseError("every water amount is a whole number >= 0")


# ── the terrain ─────────────────────────────────────────────────────────────────────────────────────────────────────

class Land:
    """The heights, read only. Cells are (row, column)."""

    def __init__(self, heights, outlets=frozenset()):
        self.h = heights
        self.rows, self.cols = len(heights), len(heights[0])
        self.outlets = outlets    # v4: interior cells that drain like the edge (a sea); empty by default
        self.ways_memo = {}       # a cell's unrestricted ways: the heights never change, so each is found once

    def z(self, c):
        return self.h[c[0]][c[1]]

    def rank(self, c):
        return (self.h[c[0]][c[1]], c[0], c[1])

    def on_edge(self, c):
        return c[0] == 0 or c[1] == 0 or c[0] == self.rows - 1 or c[1] == self.cols - 1 or c in self.outlets

    def around(self, c):
        r, k = c
        out = []
        if r > 0:
            out.append((r - 1, k))
        if k > 0:
            out.append((r, k - 1))
        if k + 1 < self.cols:
            out.append((r, k + 1))
        if r + 1 < self.rows:
            out.append((r + 1, k))
        return out

    def cells(self):
        return [(r, k) for r in range(self.rows) for k in range(self.cols)]


def ways(land, c, outside=frozenset()):
    """The equally lowest strictly lower neighbours of c (not in `outside`), in rank order; [] for none. With nothing
    left outside, the answer is the land's own and is kept on it (callers read it, never change it)."""
    if not outside:
        w = land.ways_memo.get(c)
        if w is None:
            w = land.ways_memo[c] = _ways(land, c, outside)
        return w
    return _ways(land, c, outside)


def _ways(land, c, outside):
    lower = [n for n in land.around(c) if n not in outside and land.z(n) < land.z(c)]
    if not lower:
        return []
    low = min(land.z(n) for n in lower)
    return sorted((n for n in lower if land.z(n) == low), key=land.rank)


def sinks(land):
    """Interior cells with no lower neighbour (pits), grouped into sinks: touching pits stand at one height and are one
    flat. -> [sorted cell list], ordered by each sink's least cell."""
    pits = {c for c in land.cells() if not land.on_edge(c) and not ways(land, c)}
    seen, out = set(), []
    for p in sorted(pits):
        if p in seen:
            continue
        group, todo = [p], [p]
        seen.add(p)
        while todo:
            c = todo.pop()
            for n in land.around(c):
                if n in pits and n not in seen:
                    seen.add(n)
                    group.append(n)
                    todo.append(n)
        out.append(sorted(group))
    return out, pits


def flood(land, region, pits):
    """Grow `region` (a set, in place) by heap Priority-Flood until the first height h at which a cell on its rim is
    not its own catchment. A rim cell is catchment when it is interior, no pit, and every strictly lower neighbour is
    already in the region; at h every catchment cell is taken in, and every other rim cell at h (an edge cell, a cell
    with a lower way out, or a pit of another sink) is a spill cell. -> (h, spill cells in rank order)."""
    heap, queued = [], set(region)
    for c in region:
        for n in land.around(c):
            if n not in queued:
                queued.add(n)
                heapq.heappush(heap, (land.rank(n), n))

    def catchment(b):
        return not land.on_edge(b) and b not in pits and not ways(land, b, region)

    while heap:
        _, b = heapq.heappop(heap)
        if catchment(b):
            region.add(b)
            for n in land.around(b):
                if n not in queued:
                    queued.add(n)
                    heapq.heappush(heap, (land.rank(n), n))
            continue
        h, rim = land.z(b), [b]
        while heap and heap[0][0][0] == h:                 # the rest of the rim at this height
            _, b = heapq.heappop(heap)
            if catchment(b):
                region.add(b)
                for n in land.around(b):
                    if n not in queued:
                        queued.add(n)
                        heapq.heappush(heap, (land.rank(n), n))
            else:
                rim.append(b)
        rim = [b for b in rim if not catchment(b)]         # a later catchment can have made an earlier one so
        return h, sorted(rim, key=land.rank)
    raise AssertionError("a depression with no way out")        # unreachable: every grid has an edge


def held_at(level, grounds):
    return sum(level - g for g in grounds if level > g)


def level_for(stock, grounds):
    """The exact level at which `grounds` hold `stock`: with the n lowest under water, (stock + their sum) / n."""
    hs = sorted(grounds)
    total = 0
    for n, g in enumerate(hs, 1):
        total += g
        level = Fraction(stock + total, n)
        if n == len(hs) or level <= hs[n]:
            return level
    raise AssertionError("no level")


class Depression:
    __slots__ = ("id", "name", "region", "spill_z", "spills", "cap", "stock", "passed")

    def __init__(self, did, region, land, pits):
        self.id, self.region, self.stock, self.passed = did, region, 0, 0
        self.name = _name(min(region))
        self.spill_z, self.spills = flood(land, region, pits)
        self.cap = held_at(self.spill_z, [land.z(c) for c in region])


class _Rotor(dict):
    """Tie pointers that remember which nodes a deal wrote this run (v3): a carried pointer no deal touched passes
    through the lot-day unchanged."""
    def __init__(self, start=()):
        super().__init__(start)
        self.touched = set()

    def __setitem__(self, node, p):
        self.touched.add(node)
        super().__setitem__(node, p)


def deal(rotor, node, outs, v):
    """Round-robin: v units over `outs` from the node's pointer; the pointer advances. Dealing a total equals dealing
    its parts in turn, so totals may be dealt at once. -> [(out, units > 0)]."""
    k = len(outs)
    if k == 1:
        return [(outs[0], v)]
    p = rotor.get(node, 0)
    rotor[node] = (p + v) % k
    return [(o, n) for i, o in enumerate(outs) for n in ((v + k - 1 - (i - p) % k) // k,) if n]


def depressions(heights, outlets=None):
    """The terrain pass alone: {depression name: (sorted region cells, spill height, spill cells, capacity)}."""
    land = Land(heights, _outlets(heights, outlets))
    groups, pits = sinks(land)
    out = {}
    for g in groups:
        d = Depression(0, set(g), land, pits)
        out[d.name] = (sorted(d.region), d.spill_z, d.spills, d.cap)
    return out


# ── the water ───────────────────────────────────────────────────────────────────────────────────────────────────────

def _name(x):
    return x if x == OFF else f"{x[0]},{x[1]}"


class Router:
    def __init__(self, heights, keep_trace, order=None, outlets=frozenset()):
        self.land = Land(heights, outlets)
        groups, self.pits = sinks(self.land)
        self.dep, self.owner, self.into = {}, {}, {}
        for i, g in enumerate(groups):
            d = Depression(i, set(g), self.land, self.pits)
            self.dep[i] = d
            for c in d.region:
                self.owner[c] = i
        self.next_id = len(groups)
        self.order = {c: i for i, c in enumerate(order)} if order else None
        self.rotor = {}
        self.out = 0
        self.keep = keep_trace
        self.ticks = 0
        self.trace = []
        self.merges = []
        self.arrivals = []                                 # (depression id, cell it arrived at, units)
        self.emitted = []                                  # (depression id, spill cell, units)
        self.crossed = {}                                  # dry cell -> units it passed on while routing
        self.replaying = False
        self.start = {}                                    # v3: carried pointers, by Gift-neutral node name
        self.ends_memo = {}                                # trapped()'s _ends, between merges
        self.next_memo = {}                                # trapped()'s _next per depression, between merges
        self.spill_memo = {}                               # (depression id, spill cell) -> its ways out

    def replay(self, water):
        """Re-run all the water through the SETTLED network (its depressions final and fixed) in one canonical
        schedule. With every processor fixed the rotor network is abelian, so what the replay records — the trace,
        the ticks, the passing water — is the same whatever order the settle ran in. It must land every unit where
        the settle did, and it may never find water trapped (the settle merged every trap)."""
        settled = {i: d.stock for i, d in self.dep.items()}
        out = self.out
        for d in self.dep.values():
            d.stock, d.passed = 0, 0
        self.rotor, self.order, self.out, self.ticks, self.trace = self._carried_in(), None, 0, 0, []
        self.arrivals, self.emitted, self.crossed, self.replaying = [], [], {}, True
        self.run(water)
        if {i: d.stock for i, d in self.dep.items()} != settled or self.out != out:
            raise AssertionError("the replay does not land the water where the settle did")

    def post(self, flow, frm, to, amount):
        self.ticks += 1
        if self.keep:
            self.trace.append({"tick": self.ticks, "flow": flow, "from": frm, "to": to, "amount": amount})

    def live(self, did):
        while did in self.into:
            did = self.into[did]
        return did

    def full(self, did):
        return self.dep[did].stock >= self.dep[did].cap

    def _ends(self, c, memo):
        """Where water set down at c can come to rest first, over every branch of every tie: OFF or depression ids."""
        if c not in memo:
            if self.land.on_edge(c):
                memo[c] = {OFF}
            elif c in self.owner:
                memo[c] = {self.live(self.owner[c])}
            else:
                memo[c] = set().union(*(self._ends(w, memo) for w in ways(self.land, c)))
        return memo[c]

    def _next(self, d, memo):
        out = set()
        for s in d.spills:
            if self.land.on_edge(s):
                out.add(OFF)
            elif s in self.owner:
                out.add(self.live(self.owner[s]))
            else:
                for w in self._spill_ways(d, s):
                    out |= self._ends(w, memo)
        return out

    def _spill_ways(self, d, s):
        """A spill cell's ways out of its depression. A depression's region never changes under its id (a merge makes
        a new one), so each is found once."""
        key = (d.id, s)
        w = self.spill_memo.get(key)
        if w is None:
            w = self.spill_memo[key] = ways(self.land, s, d.region)
        return w

    def trapped(self, did):
        """The terminal class a full depression sits in — the full depressions it can reach, every one of which can
        reach it back and none of which has a way to anything else — else None. Where water first comes to rest from a
        cell (_ends) reads only the heights and each cell's live depression, which change only at a merge: the memo is
        kept between calls and cleared by merge."""
        memo, nxt, todo, reach = self.ends_memo, {}, [did], {did}
        while todo:
            x = todo.pop()
            nx = self.next_memo.get(x)                         # _next reads what only a merge changes
            if nx is None:
                nx = self.next_memo[x] = self._next(self.dep[x], memo)
            nxt[x] = nx
            for y in nxt[x]:
                if y == OFF or not self.full(y):
                    return None
                if y not in reach:
                    reach.add(y)
                    todo.append(y)
        for x in reach:                                    # strongly connected: did reaches x and x reaches did
            seen, todo = {x}, [x]
            while todo and did not in seen:
                for y in nxt[todo.pop()]:
                    if y not in seen:
                        seen.add(y)
                        todo.append(y)
            if did not in seen:
                return None
        return reach if len(reach) > 1 else None

    def merge(self, ids):
        self.ends_memo, self.next_memo = {}, {}            # the live depressions change: trapped() re-reads them
        region, stock = set(), 0
        for i in sorted(ids):
            region |= self.dep[i].region
            stock += self.dep[i].stock
        names = sorted(self.dep[i].name for i in ids)
        m = Depression(self.next_id, region, self.land, self.pits)
        m.stock = stock
        for i in ids:
            self.into[i] = m.id
            m.passed += self.dep[i].passed
            del self.dep[i]
        self.dep[m.id] = m
        self.next_id += 1
        for c in m.region:
            self.owner[c] = m.id
        self.merges.append(names)
        p = self.start.get(self.node_name(("dep", m.id)))
        if p:
            self.rotor[("dep", m.id)] = p
        return m.id

    # ── the carry (v3, the tie note v1.3): pointers between lot-days, by the terrain's names ─────────────────────────
    def node_name(self, key):
        """Gift-neutral: 'cell r,c|w;w' for a cell's tie (a spill cell's too: the cell and its ways), 'lake r,c|s;s' for
        a depression's spill tie by its lowest cell in (height, row, column) order — a pit, which every Gift agrees on."""
        cell = lambda x: f"{x[0]},{x[1]}"
        if key[0] == "dep":
            d = self.dep[key[1]]
            low = min(d.region, key=self.land.rank)
            return f"lake {cell(low)}|" + ";".join(cell(s) for s in d.spills)
        return f"cell {cell(key[0])}|" + ";".join(cell(w) for w in key[1])

    def _carried_in(self):
        rotor = {}
        if not self.start:
            return _Rotor()
        for i in self.dep:
            p = self.start.get(self.node_name(("dep", i)))
            if p:
                rotor[("dep", i)] = p
        for name, p in self.start.items():
            if name.startswith("cell ") and p:
                head, tail = name[5:].split("|", 1)
                c = tuple(int(x) for x in head.split(","))
                ws = tuple(tuple(int(x) for x in w.split(",")) for w in tail.split(";"))
                rotor[(c, ws)] = p
        return _Rotor(rotor)

    def carried_out(self):
        """After the replay, by the oracle's rule: a tie that decides on the settled network (its ways come to rest in
        more than one place) carries its pointer after the day's water; any other node keeps the pointer it came in
        with, unchanged — nothing it did today decided anything, so a merged lake, or a tie under its water, resumes."""
        memo, out, here = {}, {}, {}                       # here: the settled network's ties, name -> (key, its ways)
        for c in self.land.cells():
            if not self.land.on_edge(c) and c not in self.owner:
                ws = tuple(ways(self.land, c))
                if len(ws) > 1:
                    here[self.node_name((c, ws))] = ((c, ws), None)
        for i, d in self.dep.items():
            if d.stock >= d.cap:                          # full: a flat of pits holds nothing and is full at once
                if len(d.spills) > 1:
                    here[self.node_name(("dep", i))] = (("dep", i), d)
                for sp in d.spills:
                    if not self.land.on_edge(sp) and sp not in self.owner:
                        ws = tuple(ways(self.land, sp, d.region))
                        if len(ws) > 1:
                            here[self.node_name((sp, ws))] = ((sp, ws), None)

        def decides(name):
            if name not in here:
                return False
            key, d = here[name]
            places = self._next(d, memo) if d is not None else set().union(*(self._ends(w, memo) for w in key[1]))
            return len(places) > 1

        for name in set(self.start) | {self.node_name(k) for k in self.rotor.touched}:
            p = self.rotor.get(here[name][0], 0) if decides(name) else self.start.get(name, 0)
            if p:
                out[name] = p
        return dict(sorted(out.items()))

    def _cell_key(self):
        """The cells' order for this pass, as one function. Cells before depressions, depressions by id. The settle
        takes its cells high to low (water gathers on its way down, so each cell passes it on about once, not once per
        parcel); every cell finishes before a depression moves, so a depression meets the same totals in any cell
        order and merges in the same order under the same ids. The replay keeps low to high: the dry flats' passing
        water is read off its order (S18.0926, region 64: 6.3M postings for 65,536 cells low to high)."""
        h, order = self.land.h, self.order
        if order:
            return lambda x: (0, order.get(x, 0), (h[x[0]][x[1]], x[0], x[1]))
        if self.replaying:
            return lambda x: (0, 0, (h[x[0]][x[1]], x[0], x[1]))
        return lambda x: (0, 0, (-h[x[0]][x[1]], x[0], x[1]))

    def _key(self, node):
        kind, x = node
        if kind == "cell":
            return self._cell_key()(x)
        return (1, x, (0, 0, 0))

    def run(self, water):
        """Settle the water: every node passes on what waits at it, in any order. Each waiting total carries the cell
        it set out from (where it fell, or the spill cell it left a lake by), dealt origin by origin with the same
        pointers (exact: dealing a total is dealing its parts), so the trace stays one posting per parcel arriving
        somewhere — never one per hop (R-ST.2)."""
        self.water = water
        if not self.replaying:
            self.rotor = self._carried_in()
        pending, heap = {}, []
        push, ck = heapq.heappush, self._cell_key()        # _key, read once per pass
        land, owner, crossed, wm = self.land, self.owner, self.crossed, self.land.ways_memo

        def give(node, v, origin):
            if v <= 0:
                return
            p = pending.get(node)
            if p is None:
                push(heap, (ck(node[1]) if node[0] == "cell" else (1, node[1], (0, 0, 0)), node))
                pending[node] = {origin: v}
            else:
                p[origin] = p.get(origin, 0) + v

        def arrive(x, o, v):
            if o != x:
                self.post("route", _name(o), _name(x), v)

        for c in self.land.cells():
            give(("cell", c), water[c[0]][c[1]], c)
        while heap:
            _, node = heapq.heappop(heap)
            parts = pending.pop(node)
            kind, x = node
            if kind == "dep" and x not in self.dep:        # merged away while it waited: its water joins the merge
                for o, v in parts.items():
                    give(("dep", self.live(x)), v, o)
                continue
            if kind == "cell":
                for o in (parts if len(parts) == 1 else sorted(parts, key=land.rank)):
                    v = parts[o]
                    if land.on_edge(x):
                        crossed[x] = crossed.get(x, 0) + v              # the edge cell it leaves by carries it
                        arrive(x, o, v)
                        self.post("runoff-out", _name(x), OFF, v)
                        self.out += v
                    elif x in owner:
                        did = self.live(owner[x])
                        arrive(x, o, v)
                        self.post("pond-fill", _name(x), "lake@" + self.dep[did].name, v)
                        self.arrivals.append((did, x, v))
                        give(("dep", did), v, x)
                    else:
                        ws = wm.get(x)
                        if ws is None:
                            ws = ways(land, x)
                        crossed[x] = crossed.get(x, 0) + v
                        if len(ws) == 1:                               # one way: deal() would give it all
                            give(("cell", ws[0]), v, o)
                        else:
                            for w, n in deal(self.rotor, (x, tuple(ws)), ws, v):
                                give(("cell", w), n, o)
                continue
            v = sum(parts.values())
            d = self.dep[x]
            d.stock += v
            if d.stock <= d.cap:
                continue
            excess = d.stock - d.cap
            d.stock = d.cap
            ring = self.trapped(x)
            if ring and self.replaying:
                raise AssertionError("water trapped on the replay through the settled network")
            if ring:                                       # a terminal class of full depressions: one depression
                m = self.merge(ring)
                give(("dep", m), excess, ("lake", m))
                continue
            d.passed += excess
            for s, n in deal(self.rotor, ("dep", x), d.spills, excess):
                self.post("spill", "lake@" + d.name, _name(s), n)
                self.emitted.append((x, s, n))
                if land.on_edge(s):
                    crossed[s] = crossed.get(s, 0) + n
                    self.post("runoff-out", _name(s), OFF, n)
                    self.out += n
                elif s in owner:
                    did = self.live(owner[s])
                    self.post("pond-fill", _name(s), "lake@" + self.dep[did].name, n)
                    self.arrivals.append((did, s, n))
                    give(("dep", did), n, s)
                else:
                    ws = self._spill_ways(d, s)
                    crossed[s] = crossed.get(s, 0) + n
                    if len(ws) == 1:
                        give(("cell", ws[0]), n, s)
                    else:
                        for w, m in deal(self.rotor, (s, tuple(ws)), ws, n):
                            give(("cell", w), m, s)

    # ── the passing water (plan R-ST.2): where water ran, read off the run and the settled state ─────────────────
    def passing(self, level_at):
        """Per dry cell, the water that ran over it while settling (a wet cell is a lake). Water routed over dry ground
        counts where it ran; water that arrives on a depression's dry ground runs down it to the lake; water a full
        depression spills crosses its dry shelf from the lake to the spill cell it was dealt to; water crossing a dry
        flat runs from where it landed to the exit the flat dealt it, breadth-first. Ties along these walks are dealt
        by their own pointers. Checked: every depression receives what it holds plus what it passed on; the edge
        gets `out`."""
        land, cells = self.land, {}
        for c, v in self.crossed.items():
            cells[c] = cells.get(c, 0) + v
        rot = {}
        into = {}
        dry_flat_out = {}                                  # dry depression -> [(spill cell, units)] in the order dealt
        for did, s, n in self.emitted:
            dry_flat_out.setdefault(self.live(did), []).append((did, s, n))
        for did, x, v in self.arrivals:
            live = self.live(did)
            d = self.dep[live]
            into[live] = into.get(live, 0) + v
            wet = [c for c in d.region if c in level_at]
            if wet:                                        # down the dry ground to the water
                todo = [(x, v)]
                while todo:
                    c, u = todo.pop()
                    if c in level_at:
                        continue
                    cells[c] = cells.get(c, 0) + u
                    ws = [w for w in ways(land, c) if w in d.region] or [w for w in land.around(c) if w in d.region]
                    todo.extend(deal(rot, ("down", c, tuple(ws)), ws, u))
            else:                                          # across a dry flat to the exit it is dealt
                cells[x] = cells.get(x, 0) + v
                spills = d.spills
                for s, n in deal(rot, ("flat", live), spills, v):
                    for c in self._toward(d.region, x, s)[1:]:
                        cells[c] = cells.get(c, 0) + n
        for did, s, n in self.emitted:
            d = self.dep[self.live(did)]
            if any(c in level_at for c in d.region):
                for c in self._shelf(d, s, level_at):
                    cells[c] = cells.get(c, 0) + n
        for d in self.dep.values():
            if into.get(d.id, 0) != d.stock + d.passed:
                raise AssertionError("a depression that does not balance its passing water")
        grid = [[0] * land.cols for _ in range(land.rows)]
        for (r, k), v in cells.items():
            if (r, k) not in level_at:
                grid[r][k] = v
        return grid

    def _toward(self, region, start, target):
        """The breadth-first path inside `region` from `start` to the region cell beside `target` (ties by rank)."""
        land = self.land
        goal = {c for c in region if target in land.around(c)}
        prev, ring = {start: None}, [start]
        while ring and not any(c in goal for c in ring):
            nxt = []
            for c in ring:
                for n in sorted(land.around(c), key=land.rank):
                    if n in region and n not in prev:
                        prev[n] = c
                        nxt.append(n)
            ring = sorted(nxt, key=land.rank)
        end = min((c for c in ring if c in goal), key=land.rank, default=start)
        path = []
        while end is not None:
            path.append(end)
            end = prev[end]
        return path[::-1]

    def _shelf(self, d, s, level_at):
        """The dry cells a full depression's water crosses to reach spill cell s: from the dry cell beside the lake
        nearest s, along the dry shelf, to the region cell beside s."""
        land = self.land
        # only this depression's own water (Outside Read plat-line-tool/2, F7, S16.1250): a different lake touching the
        # spill cell switched the walk off, and the shelf the flood crosses read no passing water
        own = {c for c in d.region if c in level_at}
        dry = d.region - own if isinstance(d.region, (set, frozenset)) else {c for c in d.region if c not in own}
        if any(n in own for n in land.around(s)):
            return []
        starts = sorted((c for c in dry if any(n in own for n in land.around(c))), key=land.rank)
        best = None
        for c in starts:
            p = self._toward(dry, c, s)
            if s in land.around(p[-1]) and (best is None or len(p) < len(best)):
                best = p
        if best is None:
            raise AssertionError("a full depression with no dry way to its spill cell")
        return best

    def answer(self, total, passing=True):
        land = self.land
        level_at = {}
        for d in self.dep.values():
            if d.stock == 0:
                continue
            grounds = [land.z(c) for c in d.region]
            level = Fraction(d.spill_z) if d.stock == d.cap else level_for(d.stock, grounds)
            if held_at(level, grounds) != d.stock:
                raise AssertionError("a level that does not hold its stock")
            for c in d.region:
                if level > land.z(c):
                    if c in level_at:
                        raise AssertionError("one cell under two depressions")
                    level_at[c] = level
        depth = [["0"] * land.cols for _ in range(land.rows)]
        lakes, done = [], set()
        for start in sorted(level_at):
            if start in done:
                continue
            level = level_at[start]
            body, todo = [], [start]
            done.add(start)
            while todo:
                c = todo.pop()
                body.append(c)
                for n in land.around(c):
                    if n in level_at and n not in done:
                        if level_at[n] != level:
                            raise AssertionError("touching water at two levels")
                        done.add(n)
                        todo.append(n)
            body.sort()
            stock = held_at(level, [land.z(c) for c in body])
            if Fraction(stock).denominator != 1:
                raise AssertionError("a lake of fractional stock")
            rim = any(n not in level_at and land.z(n) == level for c in body for n in land.around(c))
            for c in body:
                depth[c[0]][c[1]] = str(level - land.z(c))
            lakes.append({"cells": [[c[0], c[1]] for c in body], "stock": int(stock), "level": str(level),
                          "at_rim": rim})
        held = sum(x["stock"] for x in lakes)
        if held + self.out != total:
            raise AssertionError("water was made or lost")
        if self.keep:
            fill = sum(p["amount"] for p in self.trace if p["flow"] == "pond-fill")
            spill = sum(p["amount"] for p in self.trace if p["flow"] == "spill")
            gone = sum(p["amount"] for p in self.trace if p["flow"] == "runoff-out")
            if fill - spill != held or gone != self.out:
                raise AssertionError("the trace does not balance")
        res = {"router": "flow-route", "version": VERSION, "water_in": total, "out": self.out, "lakes": lakes,
               "depth": depth, "ticks": self.ticks}
        if passing:                                    # most of a big settle's time (88% of a 364-day pour): skipped
            res["passing"] = self.passing(level_at)    # only when the caller says it never reads it
        if self.keep:
            res["trace"] = self.trace
            res["merges"] = sorted(self.merges)
        return res


def _outlets(heights, outlets):
    """v4: the outlet cells as a frozenset of (row, column); None or [] for none. Each is a [row, column] pair of whole
    numbers inside the grid; a repeated cell is one outlet (the same rule as water-oracle Plumb v5)."""
    if outlets is None:
        return frozenset()
    if not isinstance(outlets, list):
        raise CaseError("outlets is a list of [row, column] cells")
    out = set()
    for c in outlets:
        if not (isinstance(c, list) and len(c) == 2 and all(type(x) is int for x in c)):
            raise CaseError("each outlet is a [row, column] pair of whole numbers")
        if not (0 <= c[0] < len(heights) and 0 <= c[1] < len(heights[0])):
            raise CaseError("every outlet is a cell inside the grid")
        out.add((c[0], c[1]))
    return frozenset(out)


def settle(heights, water, trace=False, order=None, pointers=None, outlets=None, passing=True):
    """-> the settled state (plain JSON types). With trace=True, also every transfer in order and every merge.
    `order` (depression ids) is for the battery's order-independence check; the answer must not depend on it.
    `pointers` (v3) carries the tie pointers in from the last lot-day; the answer then carries them out (`pointers`),
    read off the replay through the settled network (the tie note v1.3); without it the answer is v2's.
    `outlets` (v4) names interior cells that drain like the grid's edge, as water-oracle Plumb v5 does; without it (or
    with []) the answer is v3's.
    `passing=False` leaves the passing water out of the answer and never computes it, for a caller that reads only
    the lakes, the trace or `out` (it is most of a big pour's time); every other field is the same bytes."""
    validate(heights, water)
    if type(passing) is not bool:                     # 0 and 1 compare equal to False and True: the type decides
        raise CaseError(f"passing is True or False, not {passing!r}")
    r = Router(heights, trace, order, _outlets(heights, outlets))
    if pointers is not None:
        for name, p in pointers.items():
            if not isinstance(p, int) or isinstance(p, bool) or p < 0 or not isinstance(name, str):
                raise CaseError(f"a carried pointer that is not one: {name!r}: {p!r}")
        r.start = dict(pointers)
    r.run(water)
    r.replay(water)
    res = r.answer(sum(map(sum, water)), passing)
    if pointers is not None:
        res["pointers"] = r.carried_out()
    return res


def canonical(result):
    return json.dumps(result, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


SELFTEST = [
    # (name, heights, water, expected out, expected [(stock, level)])
    ("a hollow below its lip holds everything (the below-lip control)",
     [[9, 9, 9], [9, 0, 9], [9, 9, 9]], [[0, 0, 0], [0, 7, 0], [0, 0, 0]], 0, [(7, "7")]),
    ("at the spill exactly the excess leaves (the at-spill case)",
     [[9, 9, 9], [9, 0, 9], [9, 9, 9]], [[0, 0, 0], [0, 12, 0], [0, 0, 0]], 3, [(9, "9")]),
    ("rain on the edge leaves", [[1, 1], [1, 1]], [[2, 0], [0, 3]], 5, []),
    ("two hollows over a sill fill as one", [[9] * 5, [9, 0, 5, 0, 9], [9] * 5],
     [[0] * 5, [0, 20, 0, 0, 0], [0] * 5], 0, [(20, "25/3")]),
    ("a perched pond spills down into a lower one",
     [[9, 9, 9, 9, 9], [9, 6, 4, 0, 9], [9, 9, 9, 9, 9]], [[0] * 5, [0, 3, 0, 0, 0], [0] * 5], 0, [(3, "3")]),
]


def selftest():
    bad = 0
    for name, h, w, out, lakes in SELFTEST:
        r = settle(h, w, trace=True)
        got = (r["out"], [(x["stock"], x["level"]) for x in r["lakes"]])
        ok = got == (out, lakes) and canonical(settle(h, w)) == canonical(settle(h, w))
        print(("PASS " if ok else "FAIL ") + name + ("" if ok else f" — got {got}"))
        bad += not ok
    print(f"flow-route selftest: {len(SELFTEST) - bad}/{len(SELFTEST)}")
    return 0 if bad == 0 else 1


def main(argv=None):
    a = sys.argv[1:] if argv is None else argv
    if a[:1] == ["--selftest"]:
        return selftest()
    if a[:1] in (["--help"], ["-h"]):
        print(__doc__.strip())
        return 0
    if len(a) != 2 or a[0] not in ("settle", "trace"):
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
        print(canonical(settle(case.get("heights"), case.get("water"), trace=(a[0] == "trace"), pointers=ptr,
                                outlets=case.get("outlets"))))
    except (OSError, ValueError, CaseError) as e:
        print(f"flow-route: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
