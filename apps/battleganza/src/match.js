/* battleganza/match.js — S1/B2. The nine replica boards.
 *
 * The layer between the pure Sudoku engine (`play-engine.js`, reused DIRECTLY per
 * §5.2 rank 5) and the wire (`boundary.js`). It owns exactly one idea, §3.3:
 *
 *   Every player holds their own copy of every board. Boards never share writes.
 *   The one and only cross-player event is a CLAIM.
 *
 * So there is no authoritative shared game state here and there is no solver
 * arbitration. A replica is private. A deal is public. A claim is the seam.
 *
 * VOCABULARY (§3.2 — the line's two naming collisions, both live in this file):
 *   grid  = a whole 9x9. NEVER the 3x3.
 *   box   = one of nine 3x3 regions, numbered 1..9 READING ORDER (box 5 = centre).
 *   board = position on the mega grid, also 1..9 reading order.
 * play-engine numbers its boxes 0..8 (`boxOf` returns 0-based). Battleganza
 * numbers 1..9. That off-by-one is the single most likely defect on this seam,
 * so it is crossed in exactly ONE place -- `engineBox()` -- and asserted by test.
 *
 * PURE by contract, same as the engine it wraps: no DOM, no window, no fetch, no
 * I/O, no clock. `t` is passed in, never read from Date.now() -- a match must be
 * replayable from its deal + claim log or a playtest bug is not reproducible
 * (§5.2 rank 7).
 */

'use strict';

/* BATTLEGANZA-DUAL-EXPRESSION — node: module.exports · browser: root.Battleganza.Match */
(function (root) {
const engine = (typeof require === 'function') ? require('../projects/dual-expression/core/app/play-engine.js') : root.SudokuPlay;
const { claim: encodeClaim } = (typeof require === 'function') ? require('./boundary.js') : root.Battleganza.Boundary;

const BOARDS = 9;
const BOXES = 9;
const MARKS = Object.freeze(['X', 'O']);

class MatchError extends Error {}

// ------------------------------------------------------------ the box seam ---

/** Battleganza box (1..9, reading order) -> play-engine box (0..8). The ONE crossing. */
function engineBox(box) {
  if (!Number.isInteger(box) || box < 1 || box > BOXES) {
    throw new MatchError('box out of range (1..9): ' + String(box));
  }
  return box - 1;
}

/** The 9 flat cell indices of a battleganza box, in reading order. */
function cellsOfBox(box) {
  const eb = engineBox(box);
  const br = 3 * ((eb / 3) | 0);
  const bc = 3 * (eb % 3);
  const out = [];
  for (let dr = 0; dr < 3; dr++) {
    for (let dc = 0; dc < 3; dc++) out.push((br + dr) * 9 + (bc + dc));
  }
  return out;
}

/** Which battleganza box (1..9) a flat cell index falls in. Inverse of cellsOfBox. */
function boxOfCell(i) {
  if (!Number.isInteger(i) || i < 0 || i > 80) {
    throw new MatchError('cell out of range (0..80): ' + String(i));
  }
  return engine.boxOf(i) + 1;
}

// ------------------------------------------------------------------ the deal --

/** Bound on redraws for ONE board. Deliberately loud on exhaustion -- an
 *  unbounded silent retry loop is worse than the property it filters out.
 *  Sized against the measured per-board rate (~2.2% on easy, the worst
 *  difficulty): 200 consecutive rejections is not a slow draw, it is a broken
 *  generator, and it should say so. Mirrors test-support.js MAX_DEALS. */
const MAX_BOARD_DRAWS = 200;

/**
 * boxIsGivenComplete(puzzle, box) -> are all nine of this box's cells GIVENS?
 *
 * NOTE THE ARGUMENT: a dealt `puzzle` (length-81, 0 = empty), NOT a replica.
 * `givens` is overloaded on this seam and the two meanings are different types:
 *   deal.boards[i].givens  = a COUNT   (engine.generate returns a number)
 *   replica.givens[board]  = a MASK    (createReplica derives puzzle[i] !== 0)
 * At deal time only the puzzle exists, so the mask is read off it directly.
 *
 * WHY NO SOLVER CALL. `boxIsSolved` needs one because a player-filled box can
 * be full and WRONG. A given cannot: engine.generate digs holes out of a
 * completed solution and only keeps a removal that preserves uniqueness, so
 * every surviving given IS the solution's digit. All-givens therefore implies
 * full-and-correct, and the mask read is sufficient. This is the cheap check
 * that is unsound at claim time and sound at deal time -- the asymmetry is the
 * point, and it is why this predicate is separate from `boxIsSolved` rather
 * than sharing its body.
 */
function boxIsGivenComplete(puzzle, box) {
  for (const i of cellsOfBox(box)) if (puzzle[i] === 0) return false;
  return true;
}

/** Does ANY of the nine boxes come complete from the deal? */
function anyBoxGivenComplete(puzzle) {
  for (let x = 1; x <= BOXES; x++) if (boxIsGivenComplete(puzzle, x)) return true;
  return false;
}

/**
 * dealMatch(opts) -> the PUBLIC deal: nine puzzles + their solutions.
 *
 * This is server responsibility #1 (§5.1): deal the same nine puzzles to
 * everyone. It is plain data by construction so it can be serialized, shipped,
 * and REPLAYED -- determinism is bought here, not by seeding the engine (the
 * engine is a shared surface with the Forest sudoku app and is not edited).
 *
 * THE GIVEN-COMPLETE FILTER (owed 1145, ruled S26.2335 under the conn).
 *   A generated board can ship with one of its nine boxes already complete from
 *   its givens. `boxIsSolved` then reads true on a box nobody touched, the host
 *   sweep cues it READY, and `attemptClaim` succeeds -- a free P1 off the deal.
 *   Measured over 1,200 deals: 18.3% of easy deals, 1.3% medium, 0.0% hard;
 *   never more than one such box on a board, never a free board line.
 *
 *   The ruling is REGENERATE, not exclude. Excluding it inside `boxIsSolved`
 *   would have made the box permanently unclaimable by ANYONE -- an all-givens
 *   box has no player-placeable cells, so "not solved" there means "dead square
 *   for the whole match." Filtering at the deal keeps the board whole: all 81
 *   boxes stay live, and no difficulty quietly loses territory.
 *
 *   Per-BOARD, not per-deal: the nine generates are already independent, so one
 *   offending board costs one redraw, not nine. ~2.2% of easy boards, so ~1
 *   extra generate per 5 easy deals.
 *
 *   `opts.allowGivenCompleteBox: true` restores the pre-ruling behaviour. It
 *   exists so the filter can be CUT and demanded red (the §P anti-decoration
 *   pattern this line already uses), and so measure-free-claims.js can still
 *   measure the unfiltered distribution. It is not a game setting.
 */
function dealMatch(opts) {
  const o = opts || {};
  const difficulty = o.difficulty === undefined ? 'medium' : o.difficulty;
  const allowGivenCompleteBox = o.allowGivenCompleteBox === true;
  const boards = [];
  for (let b = 1; b <= BOARDS; b++) {
    let g = null;
    for (let draws = 1; draws <= MAX_BOARD_DRAWS; draws++) {
      const cand = engine.generate(difficulty);
      if (allowGivenCompleteBox || !anyBoxGivenComplete(cand.puzzle)) { g = cand; break; }
    }
    if (g === null) {
      throw new MatchError(
        `dealMatch: no board free of a givens-complete box in ${MAX_BOARD_DRAWS} draws ` +
        `at difficulty "${difficulty}". Measured rate is ~2% -- this is a broken generator, ` +
        'not a slow draw. (owed 1145; pass allowGivenCompleteBox:true to bypass the filter.)'
      );
    }
    boards.push(Object.freeze({
      board: b,
      puzzle: Object.freeze(g.puzzle.slice()),
      solution: Object.freeze(g.solution.slice()),
      givens: g.givens,
    }));
  }
  return Object.freeze({ difficulty, boards: Object.freeze(boards) });
}

function boardOfDeal(deal, board) {
  if (!Number.isInteger(board) || board < 1 || board > BOARDS) {
    throw new MatchError('board out of range (1..9): ' + String(board));
  }
  return deal.boards[board - 1];
}

/**
 * SERVER-INTERNAL round-trippable form of a deal (JSON-safe). Carries solutions.
 *
 * NOT THE WIRE FORM. This was documented as "the wire form" through S25.1631 and
 * that is exactly the leak B4 caught: it ships 729 solution digits, so a client
 * holding it holds every answer at match start and the fog is cosmetic. Use it
 * for server persistence and for replay. To send a deal to a CLIENT, use
 * `serializePuzzles` below -- which is the only form that crosses (§5.1 resp. 1:
 * the server deals the same nine PUZZLES to everyone; resp. 2 keeps solution
 * lookup on the server).
 */
function serializeDeal(deal) {
  return {
    difficulty: deal.difficulty,
    boards: deal.boards.map((b) => ({
      board: b.board,
      puzzle: b.puzzle.slice(),
      solution: b.solution.slice(),
      givens: b.givens,
    })),
  };
}

function deserializeDeal(raw) {
  if (!raw || !Array.isArray(raw.boards) || raw.boards.length !== BOARDS) {
    throw new MatchError('malformed deal');
  }
  return Object.freeze({
    difficulty: raw.difficulty,
    boards: Object.freeze(raw.boards.map((b) => Object.freeze({
      board: b.board,
      puzzle: Object.freeze(b.puzzle.slice()),
      solution: Object.freeze(b.solution.slice()),
      givens: b.givens,
    }))),
  });
}

/**
 * serializePuzzles(deal) -> THE CLIENT WIRE FORM. Puzzles only. No solutions.
 *
 * The only form that crosses to a player. The returned boards carry NO
 * `solution` key at all -- deliberately absent rather than nulled, so a stray
 * read is `undefined` and fails loudly instead of comparing plausibly against
 * an empty array (the Block Principle: make the joint impossible to misuse,
 * don't police it).
 *
 * `createReplica` already read `puzzle` only, so a puzzles-only deal drives the
 * whole client. The claim pre-flight no longer takes a deal at all -- see
 * `boxIsSolved`.
 */
function serializePuzzles(deal) {
  return {
    difficulty: deal.difficulty,
    boards: deal.boards.map((b) => ({
      board: b.board,
      puzzle: b.puzzle.slice(),
      givens: b.givens,
    })),
  };
}

function deserializePuzzles(raw) {
  if (!raw || !Array.isArray(raw.boards) || raw.boards.length !== BOARDS) {
    throw new MatchError('malformed puzzles');
  }
  return Object.freeze({
    difficulty: raw.difficulty,
    boards: Object.freeze(raw.boards.map((b) => Object.freeze({
      board: b.board,
      puzzle: Object.freeze(b.puzzle.slice()),
      givens: b.givens,
    }))),
  });
}

// --------------------------------------------------------------- the replica --

/**
 * createReplica(deal, identity) -> ONE player's private copy of all nine boards.
 *
 * `grids[board]` is a mutable length-81 array. `givens[board]` is the immutable
 * dealt mask -- a given can never be overwritten, which is what makes "you must
 * genuinely solve to claim" structural rather than policed.
 *
 * `solvedByMe` is the §3.5 hold: boxes this player completed under their own
 * power. A reveal into a box already in this set is worth ZERO to them.
 */
function createReplica(deal, identity) {
  const id = identity || {};
  if (!MARKS.includes(id.mark)) {
    throw new MatchError('mark must be X or O, got: ' + String(id.mark));
  }
  const grids = {};
  const givens = {};
  for (let b = 1; b <= BOARDS; b++) {
    const d = boardOfDeal(deal, b);
    grids[b] = d.puzzle.slice();
    givens[b] = d.puzzle.map((v) => v !== 0);
  }
  return {
    player: id.player,
    team: id.team,
    mark: id.mark,
    grids,
    givens,
    solvedByMe: new Set(),   // "board:box" keys
    revealed: new Set(),     // "board:box" keys landed from someone else's claim
  };
}

function key(board, box) { return board + ':' + box; }

/**
 * write(replica, board, cell, digit) -> the replica, mutated in place.
 * A LOCAL write. It crosses nothing. Digit 0 clears. A dealt given is immovable.
 */
function write(replica, board, cell, digit) {
  const grid = replica.grids[board];
  if (!grid) throw new MatchError('no such board: ' + String(board));
  if (!Number.isInteger(cell) || cell < 0 || cell > 80) {
    throw new MatchError('cell out of range (0..80): ' + String(cell));
  }
  if (replica.givens[board][cell]) {
    throw new MatchError('cannot overwrite a dealt given at cell ' + cell);
  }
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
    throw new MatchError('digit out of range (0..9): ' + String(digit));
  }
  grid[cell] = digit;
  return replica;
}

/** The nine values in a box on this replica, reading order. 0 = empty. */
function boxValues(replica, board, box) {
  const grid = replica.grids[board];
  if (!grid) throw new MatchError('no such board: ' + String(board));
  return cellsOfBox(box).map((i) => grid[i]);
}

/**
 * boxIsSolved(replica, board, box) -> is the box full AND right?
 *
 * SOLUTION-FREE, and REPLICA-ONLY -- it takes no deal. This is what lets the
 * client wire form drop solutions (§5.1 resp. 1/2) while keeping "you must
 * genuinely solve to claim" (§3.3) STRUCTURAL on the client rather than
 * demoted to a server round-trip.
 *
 * HOW, and why the obvious cheaper check is WRONG:
 *
 *   The S25.1631 handoff proposed checking the box with the engine's conflict
 *   detection instead of the solution. THAT IS UNSOUND. `conflicts()` only sees
 *   filled cells, so a box can be internally legal and still contradict the
 *   unique solution -- a full, zero-conflict, WRONG box turns up within a
 *   couple of generated deals (`probe-preflight-soundness.js`, and asserted
 *   below by K8/K8b in test-s1-b4.js). Shipping it would have moved genuinely-solve from structural
 *   to server-policed, silently.
 *
 *   The sound check is the SOLVER: a uniquely-solvable puzzle admits NO
 *   completion once you contradict it, so `solveCount(puzzle + your nine
 *   digits, 1) >= 1` iff those nine digits are the solution's. Measured at
 *   0.045 ms -- free on a keystroke path.
 *
 * ISOLATION (this is why the probe is puzzle+box, not the whole replica grid):
 *   the dealt puzzle is reconstructed from `replica.givens` -- a given can never
 *   be overwritten (`write` throws) and `applyReveal` never touches the mask, so
 *   the mask IS the deal. Only the box's own nine cells are overlaid. A wrong
 *   guess the player left on some OTHER box therefore cannot make this box read
 *   unsolved, which is the behaviour the solution-comparison had.
 */
function boxIsSolved(replica, board, box) {
  const grid = replica.grids[board];
  const mask = replica.givens[board];
  if (!grid || !mask) throw new MatchError('no such board: ' + String(board));
  const cells = cellsOfBox(box);

  const probe = new Array(81);
  for (let i = 0; i < 81; i++) probe[i] = mask[i] ? grid[i] : 0;
  for (const i of cells) {
    if (grid[i] === 0) return false;   // not full
    probe[i] = grid[i];
  }
  // Cheap early-out: an internally-illegal box is definitely wrong.
  if (engine.conflicts(probe).length > 0) return false;
  // The discriminating check. 0 completions => at least one of the nine
  // contradicts the unique solution.
  return engine.solveCount(probe, 1) >= 1;
}

// ----------------------------------------------------------------- the claim --

/**
 * attemptClaim(replica, board, box, t) -> a frozen CLAIM envelope.
 *
 * Takes NO deal (S25.1647): the pre-flight is replica-only, so the client never
 * needs a solution to know it earned the claim. Server `validateClaim` below is
 * still the authority and is UNCHANGED -- the split of §5.1 is intact.
 *
 * Throws unless the box is genuinely solved on THIS replica. This is where
 * "contribution decoupled from reward" is dissolved (§3.3): the only path to a
 * mark is having actually filled the nine cells correctly on your own copy.
 *
 * The payload leaves through `boundary.claim`, so the wire allowlist -- not this
 * function's discipline -- is what stops replica state from leaking (C-7, D-18).
 */
function attemptClaim(replica, board, box, t) {
  if (!boxIsSolved(replica, board, box)) {
    throw new MatchError('box ' + board + '-' + box + ' is not solved on this replica');
  }
  replica.solvedByMe.add(key(board, box));
  return encodeClaim({
    player: replica.player,
    team: replica.team,
    board,
    box,
    mark: replica.mark,
    values: boxValues(replica, board, box),
    t,
  });
}

/**
 * validateClaim(deal, envelope) -> boolean. Server responsibility #2 (§5.1):
 * "validate an incoming claim against the dealt solution -- A LOOKUP, NOT A
 * SOLVE." Nine array reads. The server never runs the solver.
 */
function validateClaim(deal, envelope) {
  // The envelope is FLAT -- `{ type, player, team, board, box, mark, values, t }`.
  // (Verified against boundary.encode at S25.1544; an earlier draft of this file
  // assumed a nested `.payload` and B2's own suite caught it on first run.)
  const p = envelope;
  if (!p || p.type !== 'CLAIM') return false;
  if (!MARKS.includes(p.mark)) return false;
  if (!Number.isInteger(p.board) || p.board < 1 || p.board > BOARDS) return false;
  if (!Number.isInteger(p.box) || p.box < 1 || p.box > BOXES) return false;
  if (!Array.isArray(p.values) || p.values.length !== 9) return false;
  const sol = boardOfDeal(deal, p.board).solution;
  const cells = cellsOfBox(p.box);
  for (let k = 0; k < 9; k++) {
    if (p.values[k] !== sol[cells[k]]) return false;
  }
  return true;
}

/**
 * verifyClaim(replica, envelope) -> boolean. THE PEER-SIDE AUTHORITY (S26.2024).
 *
 * `validateClaim` above is server responsibility #2 and needs the dealt
 * SOLUTION. In a 1v1 with no server, only whoever generated the deal would hold
 * solutions -- so making the deal cross puzzles-only would have left the
 * receiving side structurally unable to check anything, and `applyReveal` writes
 * `values` into the grid unconditionally. An unchecked claim is not a rudeness;
 * it is arbitrary digits landing permanently on your board over work you did.
 *
 * This closes it WITHOUT shipping a single solution digit, on the same theorem
 * `boxIsSolved` already rests on: a uniquely-solvable puzzle admits NO
 * completion once you contradict it, so `solveCount(dealtPuzzle + the nine
 * claimed digits, 1) >= 1` iff those digits ARE the solution's. The receiver
 * holds the dealt puzzle -- that is exactly what DEAL gave them -- so the
 * receiver can check the claim. No server, no solutions on the wire.
 *
 * TWO THINGS THIS GETS RIGHT THAT THE OBVIOUS VERSION DOES NOT:
 *
 *   1. ISOLATION. The probe is rebuilt from `replica.givens` -- the DEALT mask
 *      -- not from the receiver's working grid. My own wrong guess on some other
 *      box must never make YOUR correct claim read false. (Same reasoning, same
 *      construction as `boxIsSolved`.)
 *
 *   2. THE GIVEN GUARD. A claim whose values disagree with a dealt given is
 *      rejected BEFORE the overlay. Without this, overlaying the claim would
 *      REPLACE the given -- and then the solver is asked whether a DIFFERENT
 *      puzzle has a completion, which it very often does. That is a forged claim
 *      validating itself by quietly editing the question. Asserted by test, not
 *      by this comment (test-w5f-deal.js V3/P3).
 *
 * Sound only where the deal is uniquely solvable, which is `engine.generate`'s
 * contract. Where that contract breaks, this degrades to the same weaker
 * property `boxIsSolved` degrades to -- named here so the shared assumption is
 * visible in one place rather than rediscovered twice.
 */
function verifyClaim(replica, envelope) {
  const p = envelope;
  if (!p || p.type !== 'CLAIM') return false;
  if (!MARKS.includes(p.mark)) return false;
  if (!Number.isInteger(p.board) || p.board < 1 || p.board > BOARDS) return false;
  if (!Number.isInteger(p.box) || p.box < 1 || p.box > BOXES) return false;
  if (!Array.isArray(p.values) || p.values.length !== 9) return false;
  for (let k = 0; k < 9; k++) {
    if (!Number.isInteger(p.values[k]) || p.values[k] < 1 || p.values[k] > 9) return false;
  }

  const grid = replica.grids[p.board];
  const mask = replica.givens[p.board];
  if (!grid || !mask) return false;

  const cells = cellsOfBox(p.box);
  const probe = new Array(81);
  for (let i = 0; i < 81; i++) probe[i] = mask[i] ? grid[i] : 0;

  for (let k = 0; k < 9; k++) {
    const i = cells[k];
    if (mask[i] && probe[i] !== p.values[k]) return false;   // the given guard
    probe[i] = p.values[k];
  }

  if (engine.conflicts(probe).length > 0) return false;      // cheap early-out
  return engine.solveCount(probe, 1) >= 1;                   // the discriminator
}

/**
 * applyReveal(replica, envelope) -> a receipt.
 *
 * The claim is a gift (§3.3). Nine values land on THIS replica and the receipt
 * counts what they were worth HERE -- which is a per-recipient, per-board
 * quantity (§3.4, the decay is not global and not monotone).
 *
 *   { board, box, mark, filled, unlocked, worthless }
 *
 *   filled     -- cells that were empty and now hold a value.
 *   unlocked   -- F-2: candidate-space collapsed elsewhere on the grid by those
 *                 nine values. THIS is the gift's size; `filled` is only its
 *                 face value.
 *   worthless  -- §3.5, the hold: this player had already solved the box, so the
 *                 receipt is worth zero to them. Recorded, not inferred later.
 *
 * The mark always lands, even when the values are worthless -- territory is
 * public (§3.6) and does not depend on what the recipient already knew.
 */
function applyReveal(replica, envelope) {
  const p = envelope;   // flat envelope -- see validateClaim's note
  const grid = replica.grids[p.board];
  if (!grid) throw new MatchError('no such board: ' + String(p.board));
  const k = key(p.board, p.box);
  const worthless = replica.solvedByMe.has(k);

  const before = candidateCount(grid);
  const cells = cellsOfBox(p.box);
  let filled = 0;
  for (let n = 0; n < 9; n++) {
    if (grid[cells[n]] === 0) filled++;
    grid[cells[n]] = p.values[n];   // a reveal is TRUE, so it overwrites a guess
  }
  const after = candidateCount(grid);

  replica.revealed.add(k);
  return Object.freeze({
    board: p.board, box: p.box, mark: p.mark,
    filled,
    unlocked: before - after - filled,   // collapse BEYOND the nine cells themselves
    worthless,
  });
}

/** Total candidates across every empty cell of a grid. The denominator for F-2. */
function candidateCount(grid) {
  let n = 0;
  for (let i = 0; i < 81; i++) {
    if (grid[i] !== 0) continue;
    let m = engine.candidatesFor(grid, i);
    while (m) { n += m & 1; m >>>= 1; }
  }
  return n;
}

// ------------------------------------------------------------- the mega view --

/**
 * density(replica) -> the nine-number read the mega view paints (§5.3).
 * Per board: how filled it is. Under total fog this is the ONLY thing the Meta
 * level (§3.1) has to allocate attention against on your own copies.
 */
function density(replica) {
  const out = {};
  for (let b = 1; b <= BOARDS; b++) {
    const grid = replica.grids[b];
    let filled = 0;
    for (let i = 0; i < 81; i++) if (grid[i] !== 0) filled++;
    out[b] = filled / 81;
  }
  return Object.freeze(out);
}

const __api = {
  BOARDS, BOXES, MARKS, MatchError,
  engineBox, cellsOfBox, boxOfCell,
  dealMatch, boardOfDeal, serializeDeal, deserializeDeal,
  serializePuzzles, deserializePuzzles,
  createReplica, write, boxValues, boxIsSolved,
  boxIsGivenComplete, anyBoxGivenComplete, MAX_BOARD_DRAWS,
  attemptClaim, validateClaim, verifyClaim, applyReveal,
  candidateCount, density,
  _version: '1.3',
};

  if (typeof module !== 'undefined' && module.exports) module.exports = __api;
  else {
    root.Battleganza = root.Battleganza || {};
    root.Battleganza.Match = __api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
