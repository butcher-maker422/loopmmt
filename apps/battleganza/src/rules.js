'use strict';
/**
 * Battleganza — S1/B1: the match config + the one evaluator.
 * DP-025 v4 §3.7 (rules engine + match config), §5.3 (slice 1, dials 1 and 2).
 *
 * THE LOAD-BEARING DISCIPLINE (§3.7): a dial is a FIELD IN A MATCH CONFIG OBJECT
 * READ BY ONE EVALUATOR -- never a branch in game code. N dials cost one schema
 * and one evaluator, not 2^n code paths.
 *
 * Slice 1 ships exactly two live dials (N-4):
 *   dial 1  winRule  -- instant-win | bonus-end (DEFAULT, ratified D-19) | bonus-continue
 *   dial 2  ladder   -- { P1, P2, P3 }, P1 < P2 < P3; P3 IS dial 1's bonus (N-3)
 *
 * The evaluator is a PURE FOLD over the ordered claim log. Folding twice is
 * byte-identical (the fold-family contract). It reads public state only.
 *
 * Vocabulary is §3.2 and is enforced by naming: grid = a whole 9x9, box = one
 * of nine 3x3 regions, board 1-9 = position on the mega grid, tier = a scoring
 * scale (never "level").
 */

// ---------------------------------------------------------------- geometry --
// Boxes within a board, and boards within the mega grid, share the same 1-9
// reading-order addressing (§3.2), so they share one line table.
/* BATTLEGANZA-DUAL-EXPRESSION — node: module.exports · browser: root.Battleganza.Rules */
(function (root) {
const LINES = Object.freeze([
  [1, 2, 3], [4, 5, 6], [7, 8, 9],   // rows
  [1, 4, 7], [2, 5, 8], [3, 6, 9],   // columns
  [1, 5, 9], [3, 5, 7],              // diagonals
].map(Object.freeze));

// ------------------------------------------------------------ dial 1 table --
// Definitions-as-data + one evaluator (§5.2 rank 3, reused by name from
// Loop 2.1's CHALL / challSetScoringMode). Each row supplies DATA and a
// resolver FUNCTION. There is no `if (config.winRule === ...)` anywhere below:
// the evaluator has one call site per behaviour and the row fills it.
const WIN_RULES = Object.freeze({
  // The points layer is decoration; territory play matters only as a route.
  'instant-win': Object.freeze({
    endsMatch: true,
    resolve: (ctx) => ctx.megaLineOwner,
  }),
  // RATIFIED DEFAULT (D-19, Fold 03 R-15). A big territory lead survives
  // losing the line -- checkable via N-3, not aspirational.
  'bonus-end': Object.freeze({
    endsMatch: true,
    resolve: (ctx) => leader(ctx.totals),
  }),
  // The line is a milestone, not a climax. The licensed stall response (§3.7).
  'bonus-continue': Object.freeze({
    endsMatch: false,
    resolve: () => null,
  }),
});

const MARKS = Object.freeze(['X', 'O']);

// ------------------------------------------------------------------ config --
class ConfigError extends Error {}

/**
 * Build a match config. Frozen after creation -- the second §4.1 PREVENTED row.
 * A match declares its ruleset at creation; nothing may re-declare it mid-match.
 */
function createMatchConfig(input) {
  const src = input || {};
  const winRule = src.winRule === undefined ? 'bonus-end' : src.winRule;
  if (!Object.prototype.hasOwnProperty.call(WIN_RULES, winRule)) {
    throw new ConfigError('unknown winRule: ' + String(winRule));
  }
  const l = src.ladder || {};
  // Tuned placeholders, never settled values (§3.7, N-3).
  const P1 = l.P1 === undefined ? 1 : l.P1;
  const P2 = l.P2 === undefined ? 5 : l.P2;
  const P3 = l.P3 === undefined ? 20 : l.P3;
  for (const [k, v] of [['P1', P1], ['P2', P2], ['P3', P3]]) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new ConfigError('ladder.' + k + ' must be a finite number');
    }
  }
  if (!(P1 < P2 && P2 < P3)) {
    throw new ConfigError('ladder must satisfy P1 < P2 < P3');
  }
  // dial 9 -- teammate board visibility (D-17, V6 dial table row 9; S2 thicken).
  // A VISIBILITY dial read by the VIEW-MODEL, not the scoring evaluator -- but it
  // is still a config FIELD read by a consumer, never a branch in game code, so
  // the §3.7 discipline holds. Default ON (V6). "Dormant until teams land" is
  // structural, not a branch: with no same-team teammate in presence the channel
  // emits nothing, so a 1v1 match with the dial ON still shows no teammate boards.
  // Board-level ONLY downstream (D-17: WHERE a teammate works, never WHAT).
  const teammateBoards = src.teammateBoards === undefined ? true : src.teammateBoards;
  if (typeof teammateBoards !== 'boolean') {
    throw new ConfigError('teammateBoards must be a boolean');
  }
  // dial 11 -- the wrong-guess lockout schedule (D-43, §3.5a; V6 dial table row
  // 11, "live · new"). Constants only -- SCOPE is NOT a dial (per-board is
  // ruled). A config FIELD read by the lockout CONSUMER (lockout.js, client-
  // local), never by the evaluator below: `evaluate` folds PUBLIC state only,
  // so this dial leaves the evaluator's fold byte-identical (asserted in
  // test-lockout.js). Default is §3.5a's schedule: 0 free / 5s / ×3 / 90s.
  const l2 = src.lockout || {};
  const freeStrikes = l2.freeStrikes === undefined ? 1 : l2.freeStrikes;
  const baseMs = l2.baseMs === undefined ? 5000 : l2.baseMs;
  const factor = l2.factor === undefined ? 3 : l2.factor;
  const decayMs = l2.decayMs === undefined ? 90000 : l2.decayMs;
  for (const [k, v] of [['freeStrikes', freeStrikes], ['baseMs', baseMs], ['factor', factor], ['decayMs', decayMs]]) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new ConfigError('lockout.' + k + ' must be a finite number');
    }
  }
  if (freeStrikes < 0 || !Number.isInteger(freeStrikes)) {
    throw new ConfigError('lockout.freeStrikes must be a non-negative integer');
  }
  if (baseMs < 0) throw new ConfigError('lockout.baseMs must be non-negative');
  if (decayMs <= 0) throw new ConfigError('lockout.decayMs must be positive');
  // factor <= 1 would escalate arithmetically or not at all -- the exact defect
  // §3.5a proves fatal (search cost grows factorially; the escalation must be
  // at least geometric or the schedule is decorative).
  if (!(factor > 1)) throw new ConfigError('lockout.factor must be > 1 (escalation must be at least geometric, §3.5a)');
  return Object.freeze({
    winRule,
    ladder: Object.freeze({ P1, P2, P3 }),
    teammateBoards,
    lockout: Object.freeze({ freeStrikes, baseMs, factor, decayMs }),
  });
}

// -------------------------------------------------------------- the fold ----
// The step sequence is FIXED. Every evaluation runs all six, in this order,
// whatever the config says. `trace` records it so a test can assert it.
const STEPS = Object.freeze([
  'INGEST', 'BOXES', 'BOARD_LINES', 'MEGA_LINES', 'TERMINAL', 'TOTALS',
]);

function emptyTotals() {
  const t = {};
  for (const m of MARKS) t[m] = 0;
  return t;
}

function leader(totals) {
  let best = null;
  let bestScore = -Infinity;
  let tied = false;
  for (const m of MARKS) {
    if (totals[m] > bestScore) { bestScore = totals[m]; best = m; tied = false; }
    else if (totals[m] === bestScore) { tied = true; }
  }
  return tied ? null : best;
}

/** First mark on the ordered log to complete a line of `owner` over 1-9. */
function firstLineOwner(owner, order) {
  // `order` is the claim index at which each cell was taken; a line completes
  // at the max of its three indices. Earliest completion wins the board.
  let bestMark = null;
  let bestAt = Infinity;
  for (const line of LINES) {
    const marks = line.map((i) => owner[i]);
    const m = marks[0];
    if (!m || marks[1] !== m || marks[2] !== m) continue;
    const at = Math.max(order[line[0]], order[line[1]], order[line[2]]);
    if (at < bestAt) { bestAt = at; bestMark = m; }
  }
  return bestMark === null ? null : { mark: bestMark, at: bestAt };
}

/**
 * evaluate(config, claimLog) -> public match state.
 *
 * claimLog: ordered array of CLAIM events (see boundary.js):
 *   { player, mark: 'X'|'O', board: 1-9, box: 1-9 }
 * Later claims on an already-claimed box are ignored (idempotent replay);
 * the bus is at-least-once, so the fold must be.
 */
function evaluate(config, claimLog) {
  const rule = WIN_RULES[config.winRule];
  const trace = [];
  const ctx = {};

  // 1 ---------------------------------------------------------------- INGEST
  trace.push('INGEST');
  const log = Array.isArray(claimLog) ? claimLog : [];

  // 2 ----------------------------------------------------------------- BOXES
  trace.push('BOXES');
  // boxOwner[board][box] = mark ; boxAt[board][box] = claim index
  const boxOwner = {};
  const boxAt = {};
  for (let b = 1; b <= 9; b++) { boxOwner[b] = {}; boxAt[b] = {}; }
  const tier1 = emptyTotals();
  const claims = [];
  for (let i = 0; i < log.length; i++) {
    const c = log[i];
    if (!c || !MARKS.includes(c.mark)) continue;
    if (!(c.board >= 1 && c.board <= 9) || !(c.box >= 1 && c.box <= 9)) continue;
    if (boxOwner[c.board][c.box]) continue;      // already claimed: no-op
    boxOwner[c.board][c.box] = c.mark;
    boxAt[c.board][c.box] = claims.length;
    claims.push(c);
    tier1[c.mark] += config.ladder.P1;
  }

  // 3 ----------------------------------------------------------- BOARD_LINES
  trace.push('BOARD_LINES');
  const boardWinner = {};
  const boardAt = {};
  const tier2 = emptyTotals();
  for (let b = 1; b <= 9; b++) {
    const won = firstLineOwner(boxOwner[b], boxAt[b]);
    if (!won) continue;
    boardWinner[b] = won.mark;
    boardAt[b] = won.at;
    tier2[won.mark] += config.ladder.P2;         // once per board won
  }

  // 4 ------------------------------------------------------------ MEGA_LINES
  trace.push('MEGA_LINES');
  const mega = firstLineOwner(boardWinner, boardAt);
  const tier3 = emptyTotals();
  if (mega) tier3[mega.mark] += config.ladder.P3;  // P3 IS dial 1's bonus (N-3)
  ctx.megaLineOwner = mega ? mega.mark : null;

  // 5 -------------------------------------------------------------- TERMINAL
  trace.push('TERMINAL');
  const totals = emptyTotals();
  for (const m of MARKS) totals[m] = tier1[m] + tier2[m] + tier3[m];
  ctx.totals = totals;
  const matchOver = ctx.megaLineOwner !== null && rule.endsMatch;
  const winner = matchOver ? rule.resolve(ctx) : null;

  // 6 ---------------------------------------------------------------- TOTALS
  trace.push('TOTALS');
  // N-3's falsifier input, computed every evaluation so a playtest logs it
  // without a second code path: the accumulated T1+T2 spread against P3.
  const spread = Math.abs(
    (tier1.X + tier2.X) - (tier1.O + tier2.O)
  );

  return Object.freeze({
    boxOwner, boardWinner,
    megaLineOwner: ctx.megaLineOwner,
    tiers: Object.freeze({ T1: tier1, T2: tier2, T3: tier3 }),
    totals: Object.freeze(totals),
    matchOver, winner,
    claimCount: claims.length,
    n3: Object.freeze({ spread, P3: config.ladder.P3, collapses: spread <= config.ladder.P3 }),
    trace: Object.freeze(trace),
  });
}

const __api = {
  LINES, WIN_RULES, MARKS, STEPS, ConfigError,
  createMatchConfig, evaluate,
  /* First stamp (S27.1103). 2-part MAJOR.MINOR per the software versioning
   * convention -- no patch component, no trailing .0 beyond the minor. */
  _version: '1.1',
};

  if (typeof module !== 'undefined' && module.exports) module.exports = __api;
  else {
    root.Battleganza = root.Battleganza || {};
    root.Battleganza.Rules = __api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
