// SWX-F1 — the Plumb's `verify_reason_holds`, ported to the Jamie's-Garden
// verify-*.cjs jig: ONE invariant per file, an `ok(cond,msg)` accumulator, a
// GREEN/FAIL summary, exit 0/1. Unlike the Garden family (Playwright, DOM
// black-box), this invariant is pure trace-logic, so it runs headless on `node`
// alone and reads the render half's OWN serialized output (app/traces.json).
//
// This IS the owed render-half JS test (DEBT b): it re-certifies the render's
// trace INDEPENDENTLY of the Python solver — a fresh JS grid, candidates
// re-derived from scratch, every step's stated technique confirmed to hold at
// that board. Python computes the trace; JS proves it honest. A bug in the
// Python solver cannot hide in a matching JS bug, because the two share no code.
//
// Port of record: projects/loop-sudoku/src/plumb.py::verify_reason_holds.
'use strict';
const fs = require('fs');
const path = require('path');

// ── geometry mirrored from solver.py (_peers / compute_candidates) ──────────
const N = 9;
const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function fromString(s) {                                   // solver.from_string
  s = s.replace(/\s/g, '');
  if (s.length !== 81) throw new Error(`expected 81 cells, got ${s.length}`);
  const g = [];
  for (let r = 0; r < N; r++) {
    const row = [];
    for (let c = 0; c < N; c++) {
      const ch = s[r * N + c];
      row.push(ch === '.' || ch === '0' ? 0 : Number(ch));
    }
    g.push(row);
  }
  return g;
}

function peers(r, c) {                                     // solver._peers
  const out = new Set();
  for (let k = 0; k < N; k++) { out.add(r + ',' + k); out.add(k + ',' + c); }
  const br = 3 * Math.floor(r / 3), bc = 3 * Math.floor(c / 3);
  for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) out.add((br + dr) + ',' + (bc + dc));
  out.delete(r + ',' + c);
  return out;
}

// candidates as a Map "r,c" -> Set(digits); mirrors compute_candidates
function computeCandidates(grid) {
  const cands = new Map();
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (grid[r][c] !== 0) continue;
    const seen = new Set();
    for (const key of peers(r, c)) {
      const [pr, pc] = key.split(',').map(Number);
      if (grid[pr][pc] !== 0) seen.add(grid[pr][pc]);
    }
    cands.set(r + ',' + c, new Set(DIGITS.filter(d => !seen.has(d))));
  }
  return cands;
}

// units: 9 rows, 9 cols, 9 boxes — as "r,c" key lists (mirrors solver._units)
const UNITS = (() => {
  const u = [];
  for (let r = 0; r < N; r++) u.push(Array.from({ length: N }, (_, c) => r + ',' + c));
  for (let c = 0; c < N; c++) u.push(Array.from({ length: N }, (_, r) => r + ',' + c));
  for (let br = 0; br < N; br += 3) for (let bc = 0; bc < N; bc += 3) {
    const box = [];
    for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) box.push((br + dr) + ',' + (bc + dc));
    u.push(box);
  }
  return u;
})();

function placedDigit(step) {                              // solver._placed_digit
  const m = /\b([1-9])\b/.exec(step.reason || '');
  if (!m) throw new Error('no digit in step reason: ' + JSON.stringify(step.reason));
  return Number(m[1]);
}

// UNITS layout mirrors solver._units: 9 rows, 9 cols, 9 boxes.
const LINE_UNITS = UNITS.slice(0, 18).map(u => new Set(u));
const BOX_UNITS = UNITS.slice(18).map(u => new Set(u));

// a step is a PLACEMENT iff it eliminates nothing (mirrors solver._is_placement)
function isPlacement(step) {
  return !step.candidates_eliminated || step.candidates_eliminated.length === 0;
}

// independent locked-candidates re-derivation (mirrors plumb._locked_candidates_holds):
// digit d is eliminable from `targets` iff an intersecting (box, line) pair A,B
// has all of A's d-candidates confined to A∩B and every target in B\A.
function lockedCandidatesHolds(cands, digit, targets) {
  if (!targets.length) return false;
  if (!targets.every(t => cands.has(t) && cands.get(t).has(digit))) return false;
  const pairs = [];
  for (const a of BOX_UNITS) for (const b of LINE_UNITS) pairs.push([a, b]);
  for (const a of LINE_UNITS) for (const b of BOX_UNITS) pairs.push([a, b]);
  for (const [a, b] of pairs) {
    const inter = new Set([...a].filter(k => b.has(k)));
    if (!inter.size) continue;
    const dA = [...a].filter(k => cands.has(k) && cands.get(k).has(digit));
    if (!dA.length || !dA.every(k => inter.has(k))) continue;
    const elim = new Set([...b].filter(k => !a.has(k) && cands.has(k) && cands.get(k).has(digit)));
    if (targets.every(t => elim.has(t))) return true;
  }
  return false;
}

// independent naked-pair re-derivation (mirrors plumb._naked_pair_holds): some
// unit has two cells P,Q with the SAME two candidates {x,y} ⊇ the pruned digits,
// and every pruned (cell,digit) is another cell of that unit holding that digit.
function nakedPairHolds(cands, elim) {                     // elim: [[ "r,c", d ], ...]
  if (!elim.length) return false;
  const prunedDigits = new Set(elim.map(([, d]) => d));
  if (!elim.every(([k, d]) => cands.has(k) && cands.get(k).has(d))) return false;
  const prunes = elim.map(([k, d]) => k + '#' + d);
  for (const unit of UNITS) {
    const bi = unit.filter(k => cands.has(k) && cands.get(k).size === 2);
    for (let i = 0; i < bi.length; i++) for (let j = i + 1; j < bi.length; j++) {
      const p = bi[i], q = bi[j];
      const ps = cands.get(p);
      if (ps.size !== 2 || [...cands.get(q)].some(d => !ps.has(d))) continue;
      if (![...prunedDigits].every(d => ps.has(d))) continue;
      const justified = new Set();
      for (const k of unit) {
        if (k === p || k === q || !cands.has(k)) continue;
        for (const d of ps) if (cands.get(k).has(d)) justified.add(k + '#' + d);
      }
      if (prunes.every(x => justified.has(x))) return true;
    }
  }
  return false;
}

// independent x-wing re-derivation (mirrors plumb._x_wing_holds): two BASE lines
// (both rows or both cols) each confine `digit` to the SAME two CROSS lines;
// every target is a cell on one of those cross lines, outside the base lines,
// currently holding `digit`. Covers the row fish and its column transpose.
function xWingHolds(cands, digit, targets) {           // targets: [ "r,c", ... ]
  if (!targets.length) return false;
  if (!targets.every(t => cands.has(t) && cands.get(t).has(digit))) return false;
  const tset = new Set(targets);
  for (const base of ['row', 'col']) {
    const basePos = new Map();                          // line index -> [x1, x2]
    for (let i = 0; i < N; i++) {
      const cross = [];
      for (let k = 0; k < N; k++) {
        const key = base === 'row' ? (i + ',' + k) : (k + ',' + i);
        if (cands.has(key) && cands.get(key).has(digit)) cross.push(k);
      }
      if (cross.length === 2) basePos.set(i, cross);
    }
    const bases = [...basePos.keys()].sort((a, b) => a - b);
    for (let a = 0; a < bases.length; a++) for (let b = a + 1; b < bases.length; b++) {
      const p1 = basePos.get(bases[a]), p2 = basePos.get(bases[b]);
      if (p1[0] !== p2[0] || p1[1] !== p2[1]) continue;
      const justified = new Set();
      for (const x of p1) for (let k = 0; k < N; k++) {
        if (k === bases[a] || k === bases[b]) continue;
        const cell = base === 'row' ? (k + ',' + x) : (x + ',' + k);
        if (cands.has(cell) && cands.get(cell).has(digit)) justified.add(cell);
      }
      if ([...tset].every(t => justified.has(t))) return true;
    }
  }
  return false;
}

// ── the invariant: verify_reason_holds (plumb.py) ───────────────────────────
// Returns [ok, message]. Replays the trace on a fresh grid, re-derives
// candidates each step, and confirms the STATED technique genuinely held there.
function reasonHolds(givens, result) {
  const grid = givens.map(row => row.slice());
  const trace = result.trace || [];
  // candidates are CARRIED (init once, pruned per step) — a fresh recompute each
  // step would lose every elimination-rung deduction (they don't live in the
  // grid). Mirrors solver.solve / plumb.verify_reason_holds.
  const cands = computeCandidates(grid);
  for (let i = 0; i < trace.length; i++) {
    const step = trace[i];

    if (isPlacement(step)) {
      const [cr, cc] = step.cells_affected[0];
      const key = cr + ',' + cc;
      const digit = placedDigit(step);

      if (!cands.has(key)) return [false, `step ${i}: placed into a non-empty cell (${cr},${cc}).`];
      if (!cands.get(key).has(digit)) return [false, `step ${i}: ${digit} is not a legal candidate at (${cr},${cc}) — it conflicts with a peer.`];

      if (step.technique === 'naked-single') {
        const opts = cands.get(key);
        if (!(opts.size === 1 && opts.has(digit)))
          return [false, `step ${i}: claimed NAKED single at (${cr},${cc}) but its candidates are ${[...opts].sort()}.`];
      } else if (step.technique === 'hidden-single') {
        let held = false;
        for (const unit of UNITS) {
          if (!unit.includes(key)) continue;
          const spots = unit.filter(k => cands.has(k) && cands.get(k).has(digit));
          if (spots.length === 1 && spots[0] === key) { held = true; break; }
        }
        if (!held) return [false, `step ${i}: claimed HIDDEN single ${digit} at (${cr},${cc}) but it is not the only spot in any unit.`];
      } else {
        return [false, `step ${i}: unknown placement technique ${JSON.stringify(step.technique)}.`];
      }

      grid[cr][cc] = digit;
      cands.delete(key);
      for (const p of peers(cr, cc)) if (cands.has(p)) cands.get(p).delete(digit);
    } else {
      // ELIMINATION step — places nothing; independently confirm the prune, then apply it.
      const elim = step.candidates_eliminated.map(([c, d]) => [c[0] + ',' + c[1], d]);
      const digits = new Set(elim.map(([, d]) => d));
      if (step.technique === 'locked-candidates') {
        if (digits.size !== 1) return [false, `step ${i}: locked-candidates step prunes ${digits.size} digits, expected 1.`];
        const digit = [...digits][0];
        const targets = elim.map(([k]) => k);
        if (!lockedCandidatesHolds(cands, digit, targets))
          return [false, `step ${i}: claimed LOCKED-CANDIDATES for ${digit} but no box/line confinement justifies eliminating it from ${JSON.stringify(targets)}.`];
      } else if (step.technique === 'naked-pair') {
        if (digits.size > 2) return [false, `step ${i}: naked-pair step prunes ${digits.size} digits, expected <= 2.`];
        if (!nakedPairHolds(cands, elim))
          return [false, `step ${i}: claimed NAKED-PAIR but no unit has a matching pair that justifies the eliminations.`];
      } else if (step.technique === 'x-wing') {
        if (digits.size !== 1) return [false, `step ${i}: x-wing step prunes ${digits.size} digits, expected 1.`];
        const digit = [...digits][0];
        const targets = elim.map(([k]) => k);
        if (!xWingHolds(cands, digit, targets))
          return [false, `step ${i}: claimed X-WING for ${digit} but no two-line confinement justifies eliminating it from ${JSON.stringify(targets)}.`];
      } else {
        return [false, `step ${i}: unknown elimination technique ${JSON.stringify(step.technique)}.`];
      }
      for (const [k, d] of elim) if (cands.has(k)) cands.get(k).delete(d);
    }
  }

  if (result.status === 'solved-unique') {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++)
      if (grid[r][c] === 0) return [false, 'trace ended solved-unique but the board is unfinished.'];
    if (result.solution) {
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++)
        if (grid[r][c] !== result.solution[r][c])
          return [false, 'the replayed board does not equal the stated solution.'];
    }
  }
  return [true, `all ${trace.length} steps verified independently.`];
}

// ── harness (the Garden jig shape: ok() accumulator, GREEN/FAIL, exit 0/1) ──
(() => {
  const TRACES = path.resolve(__dirname, 'traces.json');
  let failures = 0;
  const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) failures++; };

  let data;
  try {
    data = JSON.parse(fs.readFileSync(TRACES, 'utf8'));
  } catch (e) {
    console.log('  FAIL  could not read/parse app/traces.json — run app/emit_traces.py first: ' + e.message);
    console.log('\nREASON-HOLDS: 1 FAILED');
    process.exit(1);
  }

  const puzzles = data.puzzles || [];
  ok(puzzles.length > 0, `traces.json carries ${puzzles.length} puzzle(s) to certify`);

  for (const p of puzzles) {
    let verdict, msg;
    try {
      const givens = fromString(p.givens);
      [verdict, msg] = reasonHolds(givens, p.result);
    } catch (e) {
      verdict = false; msg = 'threw: ' + e.message;
    }
    ok(verdict, `[${p.id}] ${msg}`);
  }

  console.log(failures === 0 ? '\nREASON-HOLDS: GREEN' : '\nREASON-HOLDS: ' + failures + ' FAILED');
  process.exit(failures === 0 ? 0 : 1);
})();
