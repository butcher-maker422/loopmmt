/* board-render.js — the PURE render plan for ONE 9x9 board.
 *
 * WHAT THIS IS. mega-render.js paints the nine boards as summary TILES. This is
 * its sibling one level down: the plan for a single board's eighty-one CELLS —
 * the surface a human actually plays on. Same contract, same shape, same seam:
 * a pure fold in, a plan out, and the host does the painting.
 *
 * WHY IT EXISTS. Until S26.1938 nothing in this tree painted a cell. The
 * transport stack (W1–W4) was green, the host (W5-b) was live, the Forest tab
 * (W5-c/d) was built — and `M.write` / `M.attemptClaim` were called from no host
 * and no skin. Two humans could link, ping and pass envelopes; neither could
 * enter a digit. That gap sat INSIDE S1's definition and OUTSIDE every leg,
 * which is how three registries missed it at once.
 *
 * WHAT THIS FILE DOES NOT DO, AND WHY EACH REFUSAL HAS AN ADDRESS:
 *
 *   - IT DOES NOT CALL THE SOLVER. `M.boxIsSolved` is a solve, measured at
 *     ~0.045 ms per box. The seam this line defends everywhere else — the
 *     timer is the host's (link.js:72), the probe id is the host's (net.js:93),
 *     the 81-box sweep is the host's (owed 866, option B) — puts expensive and
 *     situational work on the HOST. So `solved` arrives as an INPUT here. This
 *     file stays a cheap read, exactly as view-model.js was ratified to be.
 *     Pushing the solve down into the renderer is the just-widen-WIRE_TYPES
 *     reflex one layer over.
 *
 *   - IT DOES NOT INVENT AN EDIT RULE. `editable` mirrors what `M.write`
 *     ACTUALLY permits — not a given — and nothing else. A box someone already
 *     owns is marked `dead` on the BOX, as a separate flag, so a skin can gray
 *     it without this file having quietly legislated a rule the engine does not
 *     hold. If a renderer and an engine disagree about what is legal, the
 *     renderer is wrong by construction; the only safe move is to not have an
 *     opinion. (The readyToClaim sweep already uses the same reading of a taken
 *     box — "gone, and cueing it would send the player at a dead square" — but
 *     it uses it to withhold a CUE, not to forbid a WRITE.)
 *
 *   - IT DOES NOT READ THE CLAIM LOG. `owners` arrives as an input, because the
 *     claim log is the view-model's business and re-deriving territory here
 *     would give the page two sources of truth for who holds what.
 *
 * TOKEN ORDER IS A CONTRACT. Tokens lead with the base class, then modifiers —
 * `cell`, then `cell--<mod>`; `box`, then `box--<mod>` — the same fixed order
 * test-w5b-fixture.js §D8 pins on mega-render's board tokens. A skin may key off
 * position, so re-ordering them is a behaviour change, not a style change.
 */

/* BATTLEGANZA-DUAL-EXPRESSION — node: module.exports · browser: root.Battleganza.BoardRender */
(function (root) {
const M = (typeof require === 'function') ? require('./match.js') : root.Battleganza.Match;

const BOARDS = 9;
const BOXES = 9;
const CELLS = 81;

class BoardRenderError extends Error {}

function key(board, box) { return board + ':' + box; }

/**
 * cellPlan(i, digit, given, selected, selBox) -> one cell's paint record.
 *
 * `peer` means "shares the selected cell's BOX". It is deliberately box-peer and
 * not row/column-peer: this game's unit of ownership is the box, so the box is
 * the thing worth lighting up. A sudoku trainer would want row+column too; this
 * is not one, and adding highlight channels a player has no use for is noise
 * dressed as help.
 */
function cellPlan(i, digit, given, selected, selBox) {
  if (!Number.isInteger(i) || i < 0 || i >= CELLS) {
    throw new BoardRenderError('cell out of range (0..80): ' + String(i));
  }
  const row = Math.floor(i / 9);
  const col = i % 9;
  const box = Math.floor(row / 3) * 3 + Math.floor(col / 3) + 1;

  const isSel = selected === i;
  const isPeer = !isSel && selBox !== null && box === selBox;

  const tokens = ['cell'];
  if (given) tokens.push('cell--given');
  if (!given && digit !== 0) tokens.push('cell--written');
  if (digit === 0) tokens.push('cell--empty');
  if (isSel) tokens.push('cell--selected');
  if (isPeer) tokens.push('cell--peer');

  return Object.freeze({
    i, row, col, box,
    digit,
    given,
    editable: !given,      // EXACTLY what M.write permits. No more.
    selected: isSel,
    peer: isPeer,
    tokens: Object.freeze(tokens),
  });
}

/**
 * boxPlan(box, values, board, owners, solved, mine, revealed) -> one box record.
 *
 * `claimable` is the whole point of this surface: solved on MY replica, owned by
 * nobody, and not already banked by me. All three clauses are load-bearing —
 * drop the third and the page offers to re-claim a box the player already took.
 */
function boxPlan(box, values, board, owners, solved, mine, revealed) {
  const k = key(board, box);
  const owner = owners[k] || null;
  const isSolved = solved[k] === true;
  const isMine = mine.has(k);
  const isRevealed = revealed.has(k);
  const filled = values.filter((v) => v !== 0).length;

  const claimable = isSolved && !owner && !isMine;

  const tokens = ['box'];
  if (owner) tokens.push('box--' + owner);
  if (claimable) tokens.push('box--claimable');
  if (isMine) tokens.push('box--mine');
  if (isRevealed) tokens.push('box--revealed');
  if (owner) tokens.push('box--dead');

  return Object.freeze({
    box,
    filled,
    full: filled === 9,
    solved: isSolved,
    owner,
    mine: isMine,
    revealed: isRevealed,
    claimable,
    dead: owner !== null,
    tokens: Object.freeze(tokens),
  });
}

/**
 * boardPlan(replica, board, opts) -> everything one 9x9 surface paints.
 *
 * opts: { owners: {"b:x" -> mark}, solved: {"b:x" -> true}, selected: 0..80|null }
 * Every one of those is supplied BY THE HOST. See the header for why.
 */
function boardPlan(replica, board, opts) {
  if (!replica || !replica.grids) {
    throw new BoardRenderError('boardPlan needs a replica');
  }
  if (!Number.isInteger(board) || board < 1 || board > BOARDS) {
    throw new BoardRenderError('board out of range (1..9): ' + String(board));
  }
  const grid = replica.grids[board];
  const mask = replica.givens[board];
  if (!grid || !mask) throw new BoardRenderError('no such board: ' + String(board));

  const o = opts || {};
  const owners = o.owners || {};
  const solved = o.solved || {};
  let selected = Number.isInteger(o.selected) ? o.selected : null;
  if (selected !== null && (selected < 0 || selected >= CELLS)) {
    throw new BoardRenderError('selected out of range (0..80): ' + String(selected));
  }

  const selBox = selected === null
    ? null
    : Math.floor(Math.floor(selected / 9) / 3) * 3 + Math.floor((selected % 9) / 3) + 1;

  const cells = [];
  for (let i = 0; i < CELLS; i++) {
    cells.push(cellPlan(i, grid[i], mask[i] === true, selected, selBox));
  }

  const mine = replica.solvedByMe || new Set();
  const revealed = replica.revealed || new Set();
  const boxes = [];
  for (let b = 1; b <= BOXES; b++) {
    boxes.push(boxPlan(b, M.boxValues(replica, board, b), board, owners, solved, mine, revealed));
  }

  const written = cells.filter((c) => !c.given && c.digit !== 0).length;
  const empty = cells.filter((c) => c.digit === 0).length;

  return Object.freeze({
    board,
    cells: Object.freeze(cells),
    boxes: Object.freeze(boxes),
    selected,
    selectedBox: selBox,
    counts: Object.freeze({
      given: cells.filter((c) => c.given).length,
      written,
      empty,
      claimable: boxes.filter((b) => b.claimable).length,
      owned: boxes.filter((b) => b.owner).length,
    }),
  });
}

const __api = {
  BOARDS, BOXES, CELLS, BoardRenderError,
  cellPlan, boxPlan, boardPlan,
  _version: '1.0',
};

  if (typeof module !== 'undefined' && module.exports) module.exports = __api;
  else {
    root.Battleganza = root.Battleganza || {};
    root.Battleganza.BoardRender = __api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
