// Beam Wizards — B3c-2: the JS puzzle layer (a port of B3 `puzzle.py`'s contract).
//
// The browser LOADS + PLAYS + VALIDATES; it does not generate (B3-FINDINGS: the
// generator stays Python). This module parses a puzzle exported by
// `export_puzzles.py`, builds the lit-field for a player placement on the proven
// `engine.js`, and answers IsSolved? exactly as Python `is_solved` does — pinned
// by `conformance/run_solve_conformance.mjs` against the Python oracle.
//
// The contract, matched line-for-line to puzzle.py:
//   * grid = fixed elements OVERLAID with the player's reflectors (fresh per call);
//     emitters are cast SOURCES, never grid elements (so a beam is not blocked by
//     its own emitter) — exactly _grid_with + lit_field_of.
//   * is_solved is EXACT by default: a target is met iff the lit-field AT that
//     cell EQUALS the required color (merge=OR makes exact the meaningful goal).
//     exact=false accepts a superset (all required bands present).
//   * a puzzle with no targets is never solved.

import {
  BLACK, makeBounds, makeGrid, elementFromJson, cast, dirFromVec, cellKey,
} from "./engine.js";

// ── Parse a raw puzzle (the JSON schema from export_puzzles.py) into a working
//    form: emitter dirs become engine Direction objects; everything else stays
//    plain so the render skin can read cells/colors directly. ──
export function parsePuzzle(raw) {
  return {
    id: raw.id,
    meta: raw.meta || {},
    bounds: { lo: raw.bounds.lo.slice(), hi: raw.bounds.hi.slice() },
    // cast sources: {cell, dir (Direction), color}
    emitters: raw.emitters.map((e) => ({
      cell: e.cell.slice(),
      dir: dirFromVec(e.dir),
      color: e.color,
    })),
    // fixed grid elements: each carries its cell + an engine element spec
    fixed: raw.fixed.map((f) => ({ cell: f.cell.slice(), spec: stripCell(f) })),
    targets: raw.targets.map((t) => ({ cell: t.cell.slice(), color: t.color })),
    slots: raw.slots.map((c) => c.slice()),
    canonicalSolution: (raw.canonical_solution || []).map((p) => ({
      cell: p.cell.slice(), kind: p.kind,
    })),
  };
}

function stripCell(obj) {
  const { cell, ...spec } = obj; // engine elementFromJson wants {kind, ...}, no cell
  return spec;
}

export function loadPuzzles(rawBatch) {
  return rawBatch.puzzles.map(parsePuzzle);
}

// A placement is a Map: slot cellKey "x,y,z" -> reflector kind string.
export function placementFromList(list) {
  const m = new Map();
  for (const p of list) m.set(cellKey(p.cell), p.kind);
  return m;
}

function cellFromKey(key) {
  return key.split(",").map(Number);
}

// Build the engine grid for a placement: fixed elements overlaid with the
// player's reflectors. Emitters are NOT placed here (they are cast sources).
function gridForPlacement(puzzle, placement) {
  const grid = makeGrid(makeBounds(puzzle.bounds.lo, puzzle.bounds.hi));
  for (const f of puzzle.fixed) grid.place(f.cell, elementFromJson(f.spec));
  for (const [key, kind] of placement.entries()) {
    grid.place(cellFromKey(key), elementFromJson({ kind }));
  }
  return grid;
}

// The marched lit-field for a placement — the raw flood the validator reads and
// the render skin draws at true magnitude (M12). Returns the engine cast field
// ({colors: Map cellKey->color, cells: Map cellKey->cell, contributions: Map}).
export function litFieldOf(puzzle, placement) {
  const grid = gridForPlacement(puzzle, placement);
  return cast(grid, puzzle.emitters);
}

// Per-target met-predicate — the SINGLE source of truth for "does this target
// read its required color?". Both isSolved (the reduce over every target) and
// the render skin's per-target visual (index.html updateTargets) call THIS, so
// the on-screen target state can never silently diverge from the win condition.
// exact (default): the lit-field at the cell EQUALS the required color (merge=OR
// makes exact the meaningful goal). exact=false: accepts a superset (all required
// bands present). (B3c-2 Pull F1 — de-duplicates the met-predicate.)
export function targetMet(field, target, { exact = true } = {}) {
  const got = field.colors.get(cellKey(target.cell)) ?? BLACK;
  return exact ? got === target.color : (got & target.color) === target.color;
}

// IsSolved? — every target receives its required color. (Port of puzzle.is_solved.)
export function isSolved(puzzle, placement, { exact = true } = {}) {
  if (puzzle.targets.length === 0) return false; // no goal is never solved
  const field = litFieldOf(puzzle, placement);
  return puzzle.targets.every((t) => targetMet(field, t, { exact }));
}
