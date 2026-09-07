'use strict';
/* battleganza/mega-render.js — S1/B6. The PURE paint model of the mega view.
 *
 * The house pattern, reused by name rather than reinvented: this is the sibling
 * of `projects/dual-expression/core/app/render-model.js`, which exists so a
 * headless Node test can prove the render is HONEST about something specific.
 * Same job here, same reason. NO DOM. It turns one view-model into exactly what
 * the nine mega cells show, and nothing else.
 *
 * ── THE HONESTY CONTRACT ─────────────────────────────────────────────────────
 *
 * The prior art's contract was "an elimination step must not paint a solved
 * digit." Ours is the S25.1714 Parallax result, enforced one layer down:
 *
 *     THE RENDER MUST NOT RE-FUSE THE COMPONENTS INTO A RANK.
 *
 * The view-model deliberately ships no `pressure` scalar, because threat, own
 * progress and territory are independent signals and collapsing them loses the
 * one thing the player needs — WHICH of them moved. That result is worth
 * nothing if the paint layer quietly re-collapses them: a `heat` float here, a
 * sort by weighted score there, and the architecture is back to where it was
 * with a different variable name. So the contract is structural and asserted:
 *
 *   1. Every emitted field traces to EXACTLY ONE view-model component.
 *   2. No field combines two components into a number or an ordering.
 *   3. Boards come out in board order (1..9), never sorted by anything.
 *
 * Test B6 proves 1 and 2 by INDEPENDENCE: perturb one component of one board
 * and assert only that component's fields move. A fusion cannot survive it.
 *
 * The nine cells are painted with tokens and left un-ranked ON PURPOSE. The eye
 * fuses them, differently for different players, which is the point (Wes, Beam
 * 3: minimaps paint layers in separate channels and let the eye do the work).
 */

/* BATTLEGANZA-DUAL-EXPRESSION — node: module.exports · browser: root.Battleganza.MegaRender */
(function (root) {
const V = (typeof require === 'function') ? require('./view-model.js') : root.Battleganza.ViewModel;

const BOARDS = 9;
const BOXES = 9;

class RenderError extends Error {}

/**
 * The board's coarse state. Derived from `won` and `owned` ONLY — never from
 * density, never from threats. A board the player has barely touched and a
 * board they have nearly filled read the same here, deliberately: own-progress
 * has its own channel (`fill`) and must not leak into the territory channel.
 */
function boardState(read) {
  if (read.won) return 'won-' + read.won;
  const taken = BOXES - read.unclaimed;
  if (taken === 0) return 'open';
  return 'contested';
}

/**
 * The CSS class tokens for one board cell, in a FIXED order so two paints of
 * the same state are byte-identical strings.
 *
 * Each token names its own source component. A token that would require reading
 * two components to decide is a contract violation and does not belong here.
 */
function tokensFor(read) {
  const t = ['board', 'board--' + boardState(read)];          // <- won / owned
  if (read.threats.length) t.push('board--threatened');       // <- threats
  if (read.mine.length) t.push('board--has-mine');            // <- mine
  if (read.revealed.length) t.push('board--has-revealed');    // <- revealed
  return Object.freeze(t);
}

/**
 * The nine mini-cells of one board's territory layer — the tic-tac-toe face.
 *
 * `openThreat` marks the ONE box that completes a line for a mark, so the paint
 * layer can ring it without recomputing geometry it was already handed. It is
 * threat data on a box, not a fusion: it reads `threats` and nothing else.
 */
function boxesFor(read) {
  const mine = new Set(read.mine);
  const revealed = new Set(read.revealed);
  const openThreats = new Map();
  for (const th of read.threats) openThreats.set(th.open, th.mark);

  const out = [];
  for (let box = 1; box <= BOXES; box++) {
    out.push(Object.freeze({
      box,
      // `owner` is public territory. It is NOT derivable from mine/revealed --
      // a box can be solved by this player and claimed by someone else first.
      owner: null,
      minesolved: mine.has(box),
      viaReveal: revealed.has(box),
      openThreat: openThreats.has(box) ? openThreats.get(box) : null,
    }));
  }
  return out;
}

/**
 * A one-line human-readable label per board. Screen-reader text and the thing a
 * playtester says out loud, which is the legibility Kira argued for in Beam 3:
 * "that board is nearly his and you have barely started" is a sentence; "that
 * board is 0.72" is not.
 *
 * It NAMES the components in sequence; it does not weigh them against each
 * other. Reading two facts aloud in order is not ranking them.
 */
function labelFor(read) {
  const parts = ['board ' + read.board];
  if (read.won) parts.push(read.won + ' has taken it');
  else if (read.threats.length) {
    const marks = [...new Set(read.threats.map((t) => t.mark))].sort();
    parts.push(marks.join(' and ') + ' one box from taking it');
  }
  parts.push(Math.round(read.density * 100) + '% filled on your copy');
  if (read.mine.length) parts.push(read.mine.length + ' box(es) claimed by you');
  if (read.revealed.length) parts.push(read.revealed.length + ' revealed to you');
  return parts.join(' — ');
}

/**
 * megaPlan(vm) -> everything the nine mega cells paint.
 *
 * Boards come out as an ARRAY IN BOARD ORDER. Not sorted, not scored, not
 * ranked — see the honesty contract at the top of this file. If a future
 * `config.attention` dial is added it produces an ORDERING ALONGSIDE this plan;
 * it never reorders this array, because the mega grid's positions are the game
 * board's geometry and are not the renderer's to permute.
 */
function megaPlan(vm) {
  if (!vm || !vm.boards || !vm.territory) throw new RenderError('not a view-model');

  // dial 9 / D-17 -- the teammate-presence channel. May be absent on a view-
  // model produced before S2 (old callers pass no presence) -> treat as {}.
  const teammates = vm.teammateBoards || {};

  const boards = [];
  for (let b = 1; b <= BOARDS; b++) {
    const read = vm.boards[b];
    if (!read) throw new RenderError('view-model is missing board ' + b);

    const boxOwner = vm.territory.boxOwner[b] || {};
    const boxes = boxesFor(Object.assign({}, read, { board: b })).map((cell) =>
      Object.freeze(Object.assign({}, cell, { owner: boxOwner[cell.box] || null })));

    // `here` is the ONE component this token and this field trace to: which
    // SAME-TEAM teammates are on this board. Player ids only -- WHERE, never
    // WHAT (D-17). It combines with nothing; the eye reads it as its own layer.
    const here = teammates[b] || [];
    const tokens = here.length
      ? Object.freeze(tokensFor(read).concat(['board--teammate-here']))
      : tokensFor(read);

    boards.push(Object.freeze({
      board: b,
      state: boardState(read),
      tokens,
      fill: read.density,                 // pass-through. NOT re-derived, NOT weighted.
      boxes: Object.freeze(boxes),
      teammates: Object.freeze(here.slice()),   // board-level; no cell/digit data
      label: labelFor(Object.assign({}, read, { board: b })),
    }));
  }

  return Object.freeze({
    boards: Object.freeze(boards),
    megaLine: vm.territory.megaLineOwner,
    matchOver: vm.territory.matchOver,
    winner: vm.territory.winner,
  });
}

const __api = {
  BOARDS, BOXES, RenderError,
  boardState, tokensFor, boxesFor, labelFor, megaPlan,
  _version: '1.2',
};

  if (typeof module !== 'undefined' && module.exports) module.exports = __api;
  else {
    root.Battleganza = root.Battleganza || {};
    root.Battleganza.MegaRender = __api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
