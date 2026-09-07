#!/usr/bin/env node
/* verify-render.cjs — the render half's honesty gate.
 *
 * The engine gates (plumb.py, verify-reason-holds.cjs, verify-uniqueness.cjs)
 * certify the SOLVE. This certifies the RENDER MODEL: that index.html shows an
 * elimination step as an elimination — places no digit, marks the pruned cells,
 * and never renders `= null`. It replays every fixture's trace through the pure
 * render model (render-model.js) against the REAL emitted traces (traces.json)
 * and asserts the honesty contract at every step.
 *
 * This is the test the render bug slipped past because there was none: the loop
 * emitted `kind=elimination` for 4 sessions before any surface consumed it. A
 * shipped render behavior leaves a claim, and this is it.
 *
 * Run:  node verify-render.cjs        (from projects/loop-sudoku/app/)
 * Exit: 0 all fixtures honest · 1 a violation (printed) · 2 harness error.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const RM = require("./render-model.js");

const HERE = __dirname;
let fails = 0;
const fail = (msg) => { console.error("  FAIL " + msg); fails++; };
const ok = (msg) => console.log("  ok   " + msg);

function boardsEqual(a, b) {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) if (a[r][c] !== b[r][c]) return false;
  return true;
}
function filledCount(b) {
  let n = 0;
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (b[r][c] !== 0) n++;
  return n;
}
const isElimRaw = (step) =>
  !!(step.candidates_eliminated && step.candidates_eliminated.length);

function checkFixture(p) {
  const label = p.label || p.id;
  const trace = (p.result && p.result.trace) || [];
  const teach = (p.faces && p.faces.teach) || [];
  let elimStepsSeen = 0;
  let placeStepsSeen = 0;

  // 1) Replay the board step by step; assert placement vs elimination effect.
  for (let step = 1; step <= trace.length; step++) {
    const prev = RM.boardAtStep(p, step - 1);
    const cur = RM.boardAtStep(p, step);
    const raw = trace[step - 1];

    if (isElimRaw(raw)) {
      elimStepsSeen++;
      // an elimination places NOTHING: the board is unchanged from the prior step
      if (!boardsEqual(prev.board, cur.board))
        return fail(`${label} step ${step}: elimination changed the grid (must place nothing)`);
      if (filledCount(cur.board) !== filledCount(prev.board))
        return fail(`${label} step ${step}: elimination changed the filled count`);
      if (cur.justCell !== null)
        return fail(`${label} step ${step}: elimination set a justCell (must be null)`);
      if (!cur.isElimStep)
        return fail(`${label} step ${step}: elimination not flagged isElimStep`);
      if (!cur.prunedCells.length)
        return fail(`${label} step ${step}: elimination marked no pruned cells`);
    } else {
      placeStepsSeen++;
      // a placement fills exactly one new cell and marks it just
      if (filledCount(cur.board) !== filledCount(prev.board) + 1)
        return fail(`${label} step ${step}: placement did not fill exactly one cell`);
      if (cur.justCell === null)
        return fail(`${label} step ${step}: placement set no justCell`);
      if (cur.isElimStep)
        return fail(`${label} step ${step}: placement flagged isElimStep`);
    }
  }

  // 2) Every teach step's rendered move-suffix is honest: never "null"/"undefined",
  //    elimination suffixes name the pruned candidates, placements name a digit.
  for (const h of teach) {
    const suffix = RM.moveSuffix(h);
    if (/null|undefined/.test(suffix))
      return fail(`${label} teach n=${h.n}: move-suffix leaked null/undefined -> "${suffix}"`);
    if (h.kind === "elimination") {
      if (!/eliminates/.test(suffix))
        return fail(`${label} teach n=${h.n}: elimination suffix missing "eliminates" -> "${suffix}"`);
      if (/=/.test(suffix))
        return fail(`${label} teach n=${h.n}: elimination suffix fabricated a placement "=" -> "${suffix}"`);
    } else {
      if (suffix && !/=/.test(suffix))
        return fail(`${label} teach n=${h.n}: placement suffix missing "= digit" -> "${suffix}"`);
    }
  }

  ok(`${label}: ${placeStepsSeen} placements + ${elimStepsSeen} eliminations rendered honestly`);
  return elimStepsSeen;
}

// The honest-badge claim (SWX-F6): the status chip renders each of the three
// real terminal states HONESTLY — a fabricated "success" over a non-success
// state is the exact Real-or-Made violation the Forest honest-badge grammar
// forbids. This is the render behavior's claim; without it the chip is a
// shipped surface with no test (the gap that let the elimination render lie).
function checkBadges() {
  const before = fails;
  const clear = "known";           // the ONE clear/attested tone
  const alarmy = /red|error|fail|danger|alert/i;   // Theo's rule: no red vocabulary

  // 1) solved-unique is the ONLY status that earns the clear tone.
  if (RM.badgeFor("solved-unique").tone !== clear)
    fail(`badge: solved-unique must be the clear tone "${clear}"`);

  // 2) a non-solved state NEVER renders as clear (no fabricated green).
  for (const s of ["ceiling-hit", "broken"]) {
    if (RM.badgeFor(s).tone === clear)
      fail(`badge: ${s} rendered as the clear/solved tone — fabricated success`);
  }

  // 3) ceiling-hit carries NO FILL — the FORM carries "unreachable", it does
  //    not paint a result it does not have.
  if (RM.badgeFor("ceiling-hit").form !== "dashed")
    fail(`badge: ceiling-hit must be form "dashed" (no fill) — the form carries the state`);

  // 4) no tone is an alarm/red word (calm vocabulary).
  for (const s of ["solved-unique", "ceiling-hit", "broken"]) {
    const b = RM.badgeFor(s);
    if (alarmy.test(b.tone) || alarmy.test(b.label))
      fail(`badge: ${s} uses an alarm/red word ("${b.tone}"/"${b.label}") — Theo's rule`);
  }

  // 5) every real state produces a non-empty human label.
  for (const s of ["solved-unique", "ceiling-hit", "broken"]) {
    if (!RM.badgeFor(s).label) fail(`badge: ${s} produced no label`);
  }

  if (fails === before) ok("honest-badge: 3 states map honestly (only solved is clear; ceiling-hit is no-fill; no red)");
}

function main() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(HERE, "traces.json"), "utf8"));
  } catch (e) {
    console.error("HARNESS ERROR: cannot read traces.json — run emit_traces.py first.");
    console.error("  " + e.message);
    return 2;
  }
  const puzzles = (data && data.puzzles) || [];
  if (!puzzles.length) {
    console.error("HARNESS ERROR: no puzzles in traces.json");
    return 2;
  }

  console.log("verify-render — render-model honesty over emitted traces\n");
  let totalElim = 0;
  for (const p of puzzles) {
    const r = checkFixture(p);
    if (typeof r === "number") totalElim += r;
  }

  // the honest-badge claim (state -> chip), a pure check independent of fixtures.
  checkBadges();

  // Non-vacuity: the corpus MUST contain at least one elimination step, or this
  // gate proved nothing (the plot-returns-zero / blind-extractor trap).
  if (totalElim === 0 && fails === 0) {
    console.error("\nHARNESS ERROR: zero elimination steps across all fixtures — " +
                  "the honesty gate exercised nothing. Add an elimination fixture.");
    return 2;
  }

  console.log(`\n${fails === 0 ? "PASS" : "FAIL"} — ${totalElim} elimination step(s) exercised across ${puzzles.length} fixtures` +
              (fails ? `, ${fails} violation(s)` : ""));
  return fails === 0 ? 0 : 1;
}

process.exit(main());
