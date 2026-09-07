// SWX-F1 — the Plumb's `verify_uniqueness`, ported to the Jamie's-Garden
// verify-*.cjs jig: ONE invariant per file, an `ok(cond,msg)` accumulator, a
// GREEN/FAIL summary, exit 0/1. Like reason-holds (its sibling), this invariant
// is pure trace-logic, so it runs headless on `node` alone and reads the render
// half's OWN serialized output (app/traces.json).
//
// The invariant: the render's stated terminal status must agree with the TRUE
// solution count. We prove that count with an INDEPENDENT plain-backtracking
// counter — a DIFFERENT algorithm from the propagation solver (it shares no code
// path with it), capped at 2 because 0 / 1 / 2+ is all a uniqueness verdict
// needs. A bug in the propagation solver cannot hide in a matching bug here,
// because this counter does not propagate at all — it just brute-searches.
//   solved-unique  → the independent search must find exactly 1 solution.
//   broken         → the independent search must NOT find exactly 1 (0 or 2+).
//   ceiling-hit    → the V1 ladder stopped short; the count is INFORMATION,
//                    never a failure (a difficulty read, not a uniqueness verdict).
//
// Port of record: projects/loop-sudoku/src/plumb.py::verify_uniqueness
//                 (+ its _count_solutions independent counter).
'use strict';
const fs = require('fs');
const path = require('path');

const N = 9;

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

// ── an INDEPENDENT solver (plain backtracking) — a DIFFERENT algorithm ──────
// Mirrors plumb.py::_count_solutions exactly: first-empty-cell scan, try 1..9
// under a from-scratch legality test, cap the count so a multi-solution puzzle
// bails at the 2nd rather than enumerating billions.
function countSolutions(givens, cap = 2) {
  const grid = givens.map(row => row.slice());

  function legal(r, c, d) {
    for (let k = 0; k < N; k++) {
      if (grid[r][k] === d || grid[k][c] === d) return false;
    }
    const br = 3 * Math.floor(r / 3), bc = 3 * Math.floor(c / 3);
    for (let dr = 0; dr < 3; dr++) {
      for (let dc = 0; dc < 3; dc++) {
        if (grid[br + dr][bc + dc] === d) return false;
      }
    }
    return true;
  }

  let count = 0;

  function bt() {
    if (count >= cap) return;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (grid[r][c] === 0) {
          for (let d = 1; d <= 9; d++) {
            if (legal(r, c, d)) {
              grid[r][c] = d;
              bt();
              grid[r][c] = 0;
              if (count >= cap) return;
            }
          }
          return;                    // this empty cell had no option — dead branch
        }
      }
    }
    count += 1;                      // no empty cell left — a full solution
  }

  bt();
  return count;
}

// ── the invariant: verify_uniqueness (plumb.py) ─────────────────────────────
// Returns [ok, message].
function uniqueness(givens, result) {
  const n = countSolutions(givens, 2);
  const many = n === 0 ? '0' : (n === 1 ? '1' : '2+');

  if (result.status === 'solved-unique') {
    if (n === 1) return [true, 'uniqueness: independent search confirms exactly one solution.'];
    return [false, `claimed solved-unique but independent search found ${many === '1' ? '1' : (n === 0 ? '0' : '2+')} solutions.`];
  }
  if (result.status === 'broken') {
    if (n !== 1) return [true, `broken confirmed: independent search found ${n === 0 ? '0' : '2+'} solutions (not a proper puzzle).`];
    return [false, 'claimed broken but the puzzle has exactly one solution.'];
  }
  // ceiling-hit: the V1 ladder stopped short — a difficulty read, not a verdict
  // on uniqueness. Report the independent count as information, never a failure.
  return [true, `ceiling-hit: V1 ladder stopped short; independent search sees ${many} solution(s).`];
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
    console.log('\nUNIQUENESS: 1 FAILED');
    process.exit(1);
  }

  const puzzles = data.puzzles || [];
  ok(puzzles.length > 0, `traces.json carries ${puzzles.length} puzzle(s) to certify`);

  for (const p of puzzles) {
    let verdict, msg;
    try {
      const givens = fromString(p.givens);
      [verdict, msg] = uniqueness(givens, p.result);
    } catch (e) {
      verdict = false; msg = 'threw: ' + e.message;
    }
    ok(verdict, `[${p.id}] ${msg}`);
  }

  console.log(failures === 0 ? '\nUNIQUENESS: GREEN' : '\nUNIQUENESS: ' + failures + ' FAILED');
  process.exit(failures === 0 ? 0 : 1);
})();
