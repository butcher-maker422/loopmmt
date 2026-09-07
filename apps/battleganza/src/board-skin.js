'use strict';
/* battleganza/board-skin.js — S0. The BOARD PAINTER, extracted.
 *
 * WHAT THIS IS, AND WHY IT IS A FILE INSTEAD OF A BLOCK IN A PAGE.
 *
 * Until this file existed, the only code that could paint a PLAYABLE board lived
 * inline inside `battleganza/index.html`. V5 called that block "the code to port"
 * and nobody ported it, so the Forest tab's skin — which is real, and paints the
 * top view honestly — had no cell grid, no digit entry and no click wiring, and
 * the game was playable on exactly one surface. D-39 (tab-and-standalone parity)
 * cannot be satisfied by a second copy of a painter; it is satisfied by one
 * painter with two hosts. This is that painter.
 *
 * ── THE SEAM, and it is the whole design ─────────────────────────────────────
 *
 *     board-render.js   state -> PLAN      (pure, no DOM)        ALREADY EXISTED
 *     board-skin.js     PLAN  -> DOM       (no engine, no wire)  <- THIS FILE
 *     the host          events -> engine   (write, claim, send)  STAYS IN THE HOST
 *
 * The painter is handed a plan that is ALREADY COMPUTED and a bag of host
 * elements. It never asks the match anything, never reaches for a replica, never
 * touches a courier and never decides whether a move is legal. It cannot: it has
 * no handle on any of them. That is not politeness, it is the reason two hosts
 * can share it — a painter that reached into engine state would have to agree
 * with its host about how that state is held, and the two hosts do not agree.
 *
 * Events are INJECTED, not owned. The painter wires `on.board`, `on.cell` and
 * `on.digit` onto the nodes it creates, and has no idea what they do. The
 * standalone routes `on.digit` into `M.write` and surfaces the engine's throw;
 * a future host may route it somewhere else entirely. The painter is unchanged
 * either way, which is the test that the seam is in the right place.
 *
 * ── WHY NOT A SHARED STYLESHEET ──────────────────────────────────────────────
 *
 * Because §4 of the V6 plan and `skin.js`'s own header both say the same thing on
 * the bytes: the Forest palette is LIGHT and the standalone is DARK, and one
 * stylesheet would force one of them to be wrong. So this file emits the SAME
 * class tokens to both hosts (they come off the plan, from `board-render.js`,
 * which is where they have always come from) and emits NO colour. Each host
 * styles those tokens in its own CSS. Two faces, one body — the split is
 * deliberate and this file is what makes it cheap.
 *
 * ── PAINT ONLY WHAT THE HOST OFFERED ─────────────────────────────────────────
 *
 * Every region is guarded on the element being present, the same idiom the
 * Forest skin already uses (`if (els.grid)`). A host that offers a grid and no
 * digit pad gets a grid and no digit pad rather than a thrown error. This is
 * what lets the tab adopt the painter one region at a time instead of needing
 * all six hosts on the first day.
 *
 * ── THE NODE-CACHING SCAR, CARRIED FORWARD VERBATIM ──────────────────────────
 *
 * The host re-queries its elements on EVERY repaint and hands them in fresh. A
 * node held across a repaint is a node from a past version of the page — the
 * scar written into calendar-scope-split.test.js. This file therefore holds NO
 * module-level element state. It is a function of (els, plan), not an object
 * with a lifecycle.
 */
/* BATTLEGANZA-DUAL-EXPRESSION — node: module.exports · browser: root.Battleganza.BoardSkin */
(function (root) {

  var BOARDS = 9;

  /** kv(el, rows) — the two-column readout. Pure DOM, no engine.
   *  textContent on both columns, never innerHTML, so a value that happens to
   *  contain markup is shown rather than executed. */
  function kv(el, rows) {
    if (!el) return;
    el.innerHTML = '';
    rows.forEach(function (row) {
      var d = document.createElement('div');
      d.innerHTML = '<b></b><span></span>';
      d.children[0].textContent = row[0];
      d.children[1].textContent = row[1];
      el.appendChild(d);
    });
  }

  /** The board picker: nine buttons, the current one flagged `on`. */
  function paintPicker(el, bp, on) {
    if (!el) return;
    el.innerHTML = '';
    for (var n = 1; n <= BOARDS; n++) {
      (function (b) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'board ' + b;
        if (b === bp.board) btn.className = 'on';
        if (on && on.board) {
          btn.addEventListener('click', function () { on.board(b); });
        }
        el.appendChild(btn);
      })(n);
    }
  }

  /** The nine box chips — the claimable cue, at box granularity. */
  function paintChips(el, bp) {
    if (!el) return;
    el.innerHTML = '';
    bp.boxes.forEach(function (bx) {
      var c = document.createElement('span');
      var cls = ['chip'];
      if (bx.claimable) cls.push('chip--claimable');
      if (bx.owner) cls.push('chip--owned');
      c.className = cls.join(' ');
      c.textContent = 'box ' + bx.box + ' · ' +
        (bx.owner ? 'held by ' + bx.owner
                  : bx.claimable ? 'CLAIMABLE'
                  : bx.mine ? 'banked'
                  : bx.filled + '/9');
      el.appendChild(c);
    });
  }

  /** The 9x9. Class tokens come off the PLAN — this file invents none of them. */
  function paintGrid(el, bp, on) {
    if (!el) return;
    el.innerHTML = '';
    bp.cells.forEach(function (c) {
      var d = document.createElement('div');
      var cls = c.tokens.slice();
      if (c.row === 3) cls.push('r3');
      if (c.row === 6) cls.push('r6');
      var bx = bp.boxes[c.box - 1];
      if (bx.dead) cls.push('cell--dead');
      if (bx.claimable) cls.push('cell--won');
      d.className = cls.join(' ');
      d.textContent = c.digit === 0 ? '' : String(c.digit);
      d.title = 'r' + (c.row + 1) + 'c' + (c.col + 1) + ' · box ' + c.box +
                (c.given ? ' · given (immovable)' : '');
      if (on && on.cell) {
        d.addEventListener('click', function () { on.cell(c.i); });
      }
      el.appendChild(d);
    });
  }

  /** The digit pad — the same path a keystroke takes, for touch and mouse. */
  function paintPad(el, on) {
    if (!el) return;
    el.innerHTML = '';
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 0].forEach(function (dg) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = dg === 0 ? 'clear' : String(dg);
      if (on && on.digit) {
        b.addEventListener('click', function () { on.digit(dg); });
      }
      el.appendChild(b);
    });
  }

  /** The claim button. It reads the PLAN's `claimable`, so the button and the
   *  cue can never disagree — they are the same computation. The painter sets
   *  its LABEL and its DISABLED state and nothing else; what a click DOES is the
   *  host's business, because it crosses the wire and this file does not know
   *  there is a wire. */
  function paintClaim(el, bp) {
    if (!el) return;
    var selBox = bp.selectedBox === null ? null : bp.boxes[bp.selectedBox - 1];
    el.disabled = !(selBox && selBox.claimable);
    el.textContent = selBox
      ? (selBox.claimable ? 'claim box ' + selBox.box
         : selBox.owner ? 'box ' + selBox.box + ' is held by ' + selBox.owner
         : 'box ' + selBox.box + ' — ' + selBox.filled + '/9 filled')
      : 'select a cell first';
  }

  /**
   * paint(els, bp, opts) — the whole contract a host needs.
   *
   * @param els  {grid, chips, picker, pad, claim, kv} — any subset. Re-queried
   *             by the host every repaint and handed in fresh; never cached here.
   * @param bp   a boardPlan from `board-render.js`. ALREADY COMPUTED — this file
   *             does not derive it, because deriving it needs a replica.
   * @param opts {linkState: string, on: {board(b), cell(i), digit(d)}}
   */
  function paint(els, bp, opts) {
    if (!els || !bp) return;
    var o = opts || {};
    var on = o.on || {};

    paintPicker(els.picker, bp, on);
    paintChips(els.chips, bp);
    paintGrid(els.grid, bp, on);
    paintPad(els.pad, on);
    paintClaim(els.claim, bp);

    kv(els.kv, [
      ['board', String(bp.board)],
      ['given / written / empty',
        bp.counts.given + ' / ' + bp.counts.written + ' / ' + bp.counts.empty],
      ['claimable boxes', String(bp.counts.claimable)],
      ['boxes held', String(bp.counts.owned)],
      ['link', o.linkState || 'unavailable']
    ]);
  }

  var __api = {
    paint: paint,
    kv: kv,
    _version: '1.0'
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = __api;
  else {
    root.Battleganza = root.Battleganza || {};
    root.Battleganza.BoardSkin = __api;
  }

})(typeof window !== 'undefined' ? window : this);
