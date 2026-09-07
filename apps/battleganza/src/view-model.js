'use strict';
/* battleganza/view-model.js — S1/B5. What the mega view renders.
 *
 * A PURE function of (replica, claimLog, config). No DOM, no bus, no clock, no
 * network, and — the newly-true one — NO DEAL. The solution-free wire (S25.1647)
 * is what buys that: every fact below reads either the player's own replica or
 * the public claim log, and neither carries a solution. This file is a CLIENT
 * surface and could not have been written before the wire was split.
 *
 * ── THERE IS NO `pressure` FIELD, AND THAT IS THE DESIGN ─────────────────────
 *
 * The predecessor handoff reserved a per-board `pressure` scalar and left its
 * definition as an open operator call — contested boxes? recent claim rate?
 * proximity to a board line? A Parallax (S25.1714, three beams, fresh draws)
 * dissolved the question instead of answering it, and the operator took the
 * result. Two findings did the work:
 *
 *   1. A scalar is LOSSY IN THE DIMENSION THAT MATTERS. Threat, my own progress,
 *      and territory are independent signals. Two boards can score identically
 *      and demand opposite moves — go finish the one I nearly own, versus go
 *      block the one about to fall. A value that maps opposite actions to the
 *      same number is not a measurement.
 *   2. Hardcoding a weighting HERE violates the discipline rules.js states in
 *      its own header: "a dial is a FIELD IN A MATCH CONFIG OBJECT READ BY ONE
 *      EVALUATOR -- never a branch in game code." A pressure definition baked
 *      into the view layer is exactly that branch.
 *
 * So this returns orthogonal, individually falsifiable FACTS and lets the render
 * fuse them. If a single ranking is ever wanted it arrives as `config.attention`
 * — a dial read by an evaluator, the way `winRule` and `ladder` already are —
 * and the components make that nearly free to add. Nothing here has to change.
 *
 * `pressure` is ABSENT rather than null, deliberately, exactly as
 * `serializePuzzles` omits `solution`: a stray read is `undefined` and fails
 * loudly instead of comparing plausibly against a zero. Make the joint
 * impossible to misuse; don't police it.
 *
 * ── WHAT IS DELEGATED, NOT REIMPLEMENTED ─────────────────────────────────────
 *
 *   territory  <- rules.js :: evaluate(config, claimLog), VERBATIM. That fold
 *                 already computes boxOwner, boardWinner, megaLineOwner, the
 *                 ladder tiers and the totals, and it is idempotent on replay
 *                 because the bus is at-least-once. Reimplementing it was the
 *                 obvious trap and the Cistern flagged it as a tank.
 *   density    <- match.js :: density(replica), which already existed. The
 *                 Cistern listed it as net-new work; it was not.
 *   threats    <- rules.js :: LINES, the same eight-line table the evaluator
 *                 folds over. Boards and boxes share 1-9 reading-order
 *                 addressing (§3.2), so one table serves both scales.
 *
 * No rules.js change is needed for any of it — LINES and evaluate are both
 * already exported. Byte-probed before this file was written, not assumed.
 */

/* BATTLEGANZA-DUAL-EXPRESSION — node: module.exports · browser: root.Battleganza.ViewModel */
(function (root) {
const M = (typeof require === 'function') ? require('./match.js') : root.Battleganza.Match;
const R = (typeof require === 'function') ? require('./rules.js') : root.Battleganza.Rules;

const BOARDS = 9;
const BOXES = 9;

class ViewModelError extends Error {}

/**
 * The boxes of `board` inside a "board:box" key Set, ascending.
 *
 * `replica.solvedByMe` and `replica.revealed` are flat Sets of "board:box"
 * strings spanning all nine boards, so every per-board read is a filter-and-
 * split on ':'. Sorted so two evaluations of the same state are deep-equal —
 * Set iteration order is insertion order, which is claim order, which is not
 * stable across replays of the same match.
 */
function boxesOn(keySet, board) {
  const out = [];
  for (const k of keySet) {
    const cut = k.indexOf(':');
    if (cut < 0) continue;
    if (Number(k.slice(0, cut)) !== board) continue;
    out.push(Number(k.slice(cut + 1)));
  }
  return out.sort((a, b) => a - b);
}

/**
 * Lines on one board that are two-thirds taken by a single mark with the third
 * box still open. This is the surviving half of the sealed model's Option B —
 * demoted from THE definition of urgency to ONE fact among several, which is
 * the whole point of the change. Under the sealed model a board with no live
 * threat scored zero and effectively vanished from the map even when the player
 * was most of the way through solving it; as a component it cannot vanish,
 * because own-progress is a separate field.
 *
 * A board already won can still carry threats — later lines complete, they just
 * no longer move tier 2, which awards once per board. Reported as the fact it
 * is; whether to paint it on a decided board is the render's call.
 */
function threatsOn(boxOwner) {
  const out = [];
  for (const line of R.LINES) {
    const marks = line.map((box) => boxOwner[box]);
    const taken = marks.filter(Boolean);
    if (taken.length !== 2) continue;
    if (taken[0] !== taken[1]) continue;
    out.push(Object.freeze({ mark: taken[0], open: line[marks.findIndex((m) => !m)] }));
  }
  return Object.freeze(out);
}

/**
 * viewModel(replica, claimLog, config) -> the mega view's whole read.
 *
 *   {
 *     territory: <rules.evaluate output, verbatim>,
 *     boards: { 1..9: {
 *       filled, empty, density,     // my copy's progress (private)
 *       mine, revealed,             // which boxes, and how they got there (private)
 *       owned, unclaimed,           // territory on this board (public)
 *       threats, won,               // how close this board is to falling (public)
 *     } },
 *   }
 *
 * PRIVATE fields read the replica; PUBLIC fields read the claim log. That split
 * is §3.3's public/private line showing up as a function signature, and it is
 * why `evaluate` alone could never have produced this view: it takes a claim
 * log and never a replica, so it structurally cannot see half of it.
 *
 * `mine` and `revealed` MAY OVERLAP. A box the player solved themself and which
 * was then claimed by someone else lands in both — that is §3.5's hold, the
 * reveal being worth nothing to a player who already had it. Recorded rather
 * than inferred later; do not treat these as a partition.
 *
 * `mine` MEANS SOLVED **AND CLAIMED**, NOT SOLVED. `replica.solvedByMe` is
 * populated by `attemptClaim`, never by writing digits, so a player who has
 * genuinely finished a box and not yet banked it does not appear here. That is
 * the replica's semantic, faithfully surfaced — not a bug in this file — but it
 * leaves a real signal uncovered: *boxes you have already earned and not yet
 * claimed*, which is arguably the sharpest attention cue the mega view could
 * carry. It is computable today (`M.boxIsSolved` per box; a full 81-box sweep
 * measures 2.02 ms, since unfilled boxes early-out before the solver runs) and
 * is deliberately NOT shipped here: it is the only candidate component that is
 * not a cheap read, and adding it silently would spend a ratification the
 * operator gave for a cheaper contract. Carried as owed
 * `battleganza-viewmodel-ready-to-claim-component`.
 */
/**
 * teammateBoardsOf(presence, replica, config) -> { [board]: [player, ...] }.
 *
 * The S2 teammate-highlight channel (dial 9, D-17). PRESENCE is a THIRD input
 * category, orthogonal to the replica (private) / claim-log (public) split: it
 * is each player's LIVE FOCUS -- which board they are working RIGHT NOW, which
 * is neither in their replica nor in the public claim log (a claim tells you
 * where someone last ACTED, not where they are). The wire delivers it the way
 * the bus delivers claimLog; here it enters as a pure input.
 *
 * BOARD-LEVEL ONLY, BY CONSTRUCTION. This reads exactly `.player`, `.team`,
 * `.board` off each presence record and emits ONLY the player id under a board.
 * Any cell / digit / value / deduction / within-board position a record might
 * carry is never read and never surfaced -- D-17's "WHERE, never WHAT" is a
 * property of this function's shape, not a discipline someone has to remember.
 *
 * FILTERS: dial 9 must be ON; only SAME-TEAM records (rec.team === my team);
 * SELF excluded (you are not your own teammate); board must be an integer 1..9.
 * A 1v1 match, or Scale 1, or the dial OFF -> {} (the channel is dark), so the
 * dial is "dormant until teams land" without a single branch in game code.
 */
function teammateBoardsOf(presence, replica, config) {
  const out = {};
  if (!config || config.teammateBoards !== true) return Object.freeze(out);
  if (!Array.isArray(presence)) return Object.freeze(out);
  const myTeam = replica.team;
  const me = replica.player;
  for (const rec of presence) {
    if (!rec || rec.team !== myTeam) continue;      // opponents never appear
    if (rec.player === me) continue;                 // self is not a teammate
    const board = rec.board;
    if (!Number.isInteger(board) || board < 1 || board > BOARDS) continue;
    (out[board] || (out[board] = [])).push(rec.player);   // player id ONLY
  }
  for (const b of Object.keys(out)) {
    out[b] = Object.freeze(out[b].slice().sort());   // deterministic order
  }
  return Object.freeze(out);
}

function viewModel(replica, claimLog, config, presence) {
  if (!replica || !replica.grids || !replica.givens) {
    throw new ViewModelError('not a replica');
  }
  if (!config || !config.ladder) throw new ViewModelError('not a match config');

  // Pre-flight every board BEFORE anything reads a grid. `M.density` walks all
  // nine and would throw a bare TypeError on a holed replica — a wrong error
  // class at the wrong layer, which reads as an engine bug rather than bad
  // input. Validate first so the failure names its own cause.
  for (let b = 1; b <= BOARDS; b++) {
    if (!replica.grids[b]) throw new ViewModelError('replica is missing board ' + b);
  }

  const territory = R.evaluate(config, claimLog);
  const dens = M.density(replica);

  const boards = {};
  for (let b = 1; b <= BOARDS; b++) {
    const grid = replica.grids[b];

    let filled = 0;
    for (let i = 0; i < 81; i++) if (grid[i] !== 0) filled++;

    const boxOwner = territory.boxOwner[b];
    const owned = {};
    for (const mark of R.MARKS) owned[mark] = 0;
    let taken = 0;
    for (let box = 1; box <= BOXES; box++) {
      const m = boxOwner[box];
      if (!m) continue;
      owned[m]++;
      taken++;
    }

    boards[b] = Object.freeze({
      filled,
      empty: 81 - filled,
      density: dens[b],
      mine: Object.freeze(boxesOn(replica.solvedByMe, b)),
      revealed: Object.freeze(boxesOn(replica.revealed, b)),
      owned: Object.freeze(owned),
      unclaimed: BOXES - taken,
      threats: threatsOn(boxOwner),
      won: territory.boardWinner[b] || null,
    });
  }

  return Object.freeze({
    territory,
    boards: Object.freeze(boards),
    // dial 9 / D-17: which SAME-TEAM teammates are working which board, RIGHT
    // NOW. Board-level, player-id only. Empty {} when the dial is off, presence
    // is absent, or there are no teammates (1v1 / Scale 1) -- an orthogonal
    // channel that never fuses into the territory/threat/progress fields above.
    teammateBoards: teammateBoardsOf(presence, replica, config),
  });
}

const __api = {
  BOARDS, BOXES, ViewModelError,
  boxesOn, threatsOn, teammateBoardsOf, viewModel,
  _version: '1.2',
};

  if (typeof module !== 'undefined' && module.exports) module.exports = __api;
  else {
    root.Battleganza = root.Battleganza || {};
    root.Battleganza.ViewModel = __api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
