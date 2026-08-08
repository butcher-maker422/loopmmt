// Jamie's Garden — gen.js  [Build order §8 step 2: The Unfold generator + validator]
// The rule is a first-class serializable object (§3C):
//   unfold({ seed, rule, stepBudget }) -> { board, queue0, queue1, witness, meta }
//
// THE UNFOLD grows the WITNESS, not the surface (§4 / §MS Bone #2a): a solution
// TRACE is constructed ALONGSIDE the board, so the board is solvable BY
// CONSTRUCTION — verify << search, no rejection sampling (V4a). The witness IS the
// constructive certificate; the §6 growth-reveal replays it.
//
// The validator (IsSolved? / replay) is the DIFFICULTY METER (§MS Bone #6) + an
// independent belt-and-suspenders check — NOT a solvability gate.
//
// No universality-class vocabulary in this file (§MS Bone #4 build rule).

'use strict';
const S = (typeof require !== 'undefined' && require) ? require('./sim.js') : (typeof window !== 'undefined' ? window.Sim : undefined);

// ── The witness-trace schema — PINNED here (BS2). ───────────────────────────
// RT2-B (V9.1 / Red Team): FW7 (the couple's shared-garden comparison, v1.1)
// will read shared fields off the witness. Per RT2-B we RESERVE those fields now
// rather than force a v1.1 schema migration. They are present-but-null in v1 and
// named, so a future FW7 populates them without a breaking schema change.
const WITNESS_SCHEMA = 'jg-witness/1';
function emptyWitness(seed, rule) {
  return {
    schema: WITNESS_SCHEMA,
    seed: seed >>> 0,
    rule,                       // the first-class rule object (serializable)
    // growth: the order blooms grew, each from its seed-origin — replayed by the
    // §6 growth-reveal. No wall-clock anywhere (determinism §3A).
    growth: [],                 // [ { step, x, y, type, fromSeedCol } ]
    // solution: the constructive certificate — the moves that clear every target.
    solution: [],               // [ { step, column, orient, types:[t,t] } ]
    // RESERVED for FW7 (v1.1 couple's shared comparison) — RT2-B discharge by
    // reservation. Present-but-null in v1; FW7 populates without a migration.
    compare: {
      reservedFor: 'FW7/v1.1',
      // field NAMES FW7's shared comparison will read (reserved, unused in v1):
      fields: ['playerId', 'finalSerialize', 'movesCount', 'clearOrder'],
      data: null,
    },
  };
}

// ── The Unfold ──────────────────────────────────────────────────────────────
// Construction (provably solvable, witness-as-certificate): independent vertical
// harvests. For each harvest h in a distinct column c with type t, plant 3 targets
// of type t at the bottom of column c; the solution drops one vertical seed-pair
// (both halves t) into column c -> a vertical run of 5 -> the column harvests. The
// columns are independent, so replaying every recorded drop clears every target —
// solvable BY CONSTRUCTION (verified by replay in the validator, not by search).
//
// Modest by design for v1: one harvest per column, no engineered cascades. Richer
// topology (stacked/horizontal harvests, cascades) is a QUALITY pass (owed) — it
// raises the §6a(b) grown-vs-random signal, it does not change the contract.
function unfold(opts = {}) {
  const seed = (opts.seed ?? 1) >>> 0;
  const stepBudget = opts.stepBudget ?? 64;
  const rule = opts.rule ?? { kind: 'vertical-harvest', planted: 3, version: 1 };
  const targetCount = opts.targetCount ?? 15;
  const planted = rule.planted ?? 3;

  const rng = S.makeRng(seed);
  const board = S.emptyBoard();
  const witness = emptyWitness(seed, rule);
  const queue0 = [];
  const queue1 = [];

  // distinct columns, shuffled deterministically
  const cols = [];
  for (let c = 0; c < S.COLS; c++) cols.push(c);
  for (let i = cols.length - 1; i > 0; i--) {
    const j = S.randInt(rng, i + 1);
    const tmp = cols[i]; cols[i] = cols[j]; cols[j] = tmp;
  }

  const harvests = Math.min(cols.length, Math.max(1, Math.round(targetCount / planted)));
  let step = 0;
  for (let h = 0; h < harvests && step < stepBudget; h++) {
    const c = cols[h];
    const t = S.randInt(rng, S.TYPES);
    // plant `planted` targets at the bottom of column c
    let placedHere = 0;
    for (let k = 0; k < planted; k++) {
      const y = S.ROWS - 1 - k;
      if (y < 0 || board[y][c]) break;
      board[y][c] = { type: t, target: true };
      witness.growth.push({ step: step++, x: c, y, type: t, fromSeedCol: c });
      placedHere++;
    }
    if (placedHere === 0) continue;
    // the solution move: a vertical seed-pair (both halves t) into column c
    witness.solution.push({ step: witness.solution.length, column: c, orient: 3, types: [t, t] });
    queue0.push(t);
    queue1.push(t);
  }
  // pad the queue with deterministic filler so a game can keep dealing after the
  // witness solution is spent (a real player won't play the exact witness path)
  for (let i = 0; i < 64; i++) { queue0.push(S.randInt(rng, S.TYPES)); queue1.push(S.randInt(rng, S.TYPES)); }

  const meta = {
    seed, harvests: witness.solution.length,
    targets: witness.growth.length,
    schema: WITNESS_SCHEMA,
  };
  return { board, queue0, queue1, witness, meta };
}

// Maneuver the active piece to (targetCol, targetOrient) and hard-drop. Fresh
// pieces spawn at orientation 0; one rotateCCW reaches orient 3 (second half below)
// cleanly at the top row. Deterministic; used by replayWitness.
function maneuverAndDrop(state, targetCol, targetOrient) {
  let guard = 0;
  while (state.piece && state.piece.o !== targetOrient && guard++ < 6) {
    S.applyInput(state, 'rotateCCW');
    if (state.piece && state.piece.o !== targetOrient) S.applyInput(state, 'rotateCW');
    if (guard > 4) break;
  }
  guard = 0;
  while (state.piece && state.piece.x !== targetCol && guard++ < S.COLS * 2) {
    const before = state.piece.x;
    S.applyInput(state, state.piece.x < targetCol ? 'right' : 'left');
    if (state.piece.x === before) break; // wall — can't get closer
  }
  S.applyInput(state, 'hardDrop');
}

// Replay the witness's solution over a freshly created game. Returns the run record
// (the belt-and-suspenders check + the difficulty measurement source). Cheap: O(moves).
function replayWitness(unfoldResult) {
  const { board, queue0, queue1, witness } = unfoldResult;
  // deep-copy the board so the source isn't mutated
  const b2 = board.map(row => row.map(c => (c ? { type: c.type, target: c.target } : null)));
  const state = S.createGameFrom(b2, queue0, queue1, { seed: witness.seed });
  const clearOrder = [];
  for (const mv of witness.solution) {
    if (state.status !== 'playing') break;
    const before = state.targetsRemaining;
    maneuverAndDrop(state, mv.column, mv.orient);
    const chain = state.cascadesLastLock || 0;   // real chain depth on this drop
    if (state.targetsRemaining < before) {
      clearOrder.push({ column: mv.column, cleared: before - state.targetsRemaining, chain });
    }
  }
  return { state, clearOrder, finalStatus: state.status, targetsRemaining: state.targetsRemaining };
}

// ── The validator ───────────────────────────────────────────────────────────
// (1) belt-and-suspenders: the witness must clear EVERY target (solvable by
//     construction) and never crash — valid from any seed.
// (2) the difficulty meter (§MS Bone #6): metrics ALONG THE WITNESS PATH (no
//     from-scratch search — verify << search). Pre-registered (§6a(b)):
//       depth   = solution length (moves to clear)
//       cascades= count of moves whose single drop cleared more than one harvest
//       forcedRatio = forced/(forced+free) moves; a forced move is one that clears
//                     on this drop, a free move sets up — v1's construction is all
//                     forced (one drop per harvest), reported honestly.
function validate(unfoldResult) {
  const run = replayWitness(unfoldResult);
  const solvable = run.finalStatus !== 'lost' && run.targetsRemaining === 0;
  const moves = unfoldResult.witness.solution.length;
  // a real cascade is a CHAIN (resolution looped >= 2), not a multi-cell clear.
  // v1's independent-column construction has none — reported honestly (it can come
  // back zero/negative; that is the §6a(b) honesty, not a failure).
  const cascades = run.clearOrder.filter(c => (c.chain || 0) >= 2).length;
  const forced = run.clearOrder.length;          // every successful drop is a forced clear here
  const forcedRatio = moves > 0 ? forced / moves : 0;
  return {
    solvable,
    clearedAll: run.targetsRemaining === 0,
    finalStatus: run.finalStatus,
    difficulty: { depth: moves, cascades, forcedRatio },
  };
}

// ── §6a(b) measurement — the SEED-NEIGHBOURHOOD run (cheap, done this session). ──
// The same difficulty machinery over seed ± small perturbations measures
// quality-ROBUSTNESS directly (Bone #2b OWED-route): low variance = empirical
// stability (a measured-law, never Sable's `topology_stability` theorem).
// Pre-registered metric: variance of solution depth across the neighbourhood.
// (The grown-vs-RANDOM comparison — the other §6a(b) arm — needs a bounded
// random-control solver and is staged for the next tank; not faked here.)
function measureNeighborhood(seed, opts = {}) {
  const radius = opts.radius ?? 4;
  const depths = [];
  const cascades = [];
  for (let d = -radius; d <= radius; d++) {
    const u = unfold({ ...opts, seed: (seed + d) >>> 0 });
    const v = validate(u);
    depths.push(v.difficulty.depth);
    cascades.push(v.difficulty.cascades);
    if (!v.solvable) return { ok: false, failedSeed: (seed + d) >>> 0 };
  }
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const variance = a => { const m = mean(a); return mean(a.map(x => (x - m) ** 2)); };
  return {
    ok: true,
    n: depths.length,
    depthMean: mean(depths), depthVar: variance(depths),
    cascadeMean: mean(cascades),
    allSolvable: true,
  };
}

var API = {
  WITNESS_SCHEMA, emptyWitness,
  unfold, replayWitness, validate, measureNeighborhood, maneuverAndDrop,
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.Gen = API;
