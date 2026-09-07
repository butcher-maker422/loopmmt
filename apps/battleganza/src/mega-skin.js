'use strict';
/* battleganza/mega-skin.js — the MEGA PAINTER, extracted.
 *
 * WHAT THIS IS, AND WHY IT IS A FILE INSTEAD OF A BLOCK IN A PAGE.
 *
 * Until this file existed, the only code that could paint the nine-board mega
 * view lived inline inside `battleganza/index.html` (~508-580), inside the same
 * `try` that ran the boot pipeline. It ran ONCE, on load, and there was no way
 * to run it again — `viewModel` appeared exactly once in the page and there was
 * no `repaintMega` anywhere. So the mega stayed a static picture of the canned
 * territory for the life of the page while the real match moved underneath it.
 * That is owed `battleganza-mega-view-never-repaints` (seq 255), and the owed
 * says in its own words that it "needs the painter extracted to a function
 * first." This is that function.
 *
 * ── THE SEAM, and it is the SAME seam board-skin.js already cut ──────────────
 *
 *     mega-render.js    state -> PLAN      (pure, no DOM)        ALREADY EXISTED
 *     mega-skin.js      PLAN  -> DOM       (no engine, no wire)  <- THIS FILE
 *     the host          state -> PLAN call (recompute, repaint)  STAYS IN THE HOST
 *
 * This is deliberately not a new design. `board-render.js` -> `board-skin.js`
 * is the identical cut one surface over, made at S0 for D-39 (one painter, two
 * hosts). The mega side was left half-cut: the pure half shipped as
 * `mega-render.js` and the DOM half never left the page. Matching the existing
 * seam is the point — a second, differently-shaped painter contract would be a
 * new thing to learn for no gain.
 *
 * The painter is handed a plan that is ALREADY COMPUTED. It never asks the
 * match anything, never reaches for a replica, never runs the solver and never
 * decides what a board is worth. It cannot: it has no handle on any of them.
 *
 * ── WHY THE HOST FACTS ARE INJECTED ─────────────────────────────────────────
 *
 * The inline block read three things that are NOT in the plan: `readyKeys` (the
 * host's 81-box solver sweep, owed 866 option B), `sweepMs` (that sweep's cost)
 * and `PAGE_VERSION` (the host's own stamp). A painter that reached for those
 * would be reaching into host state, which is exactly the coupling that stops
 * one painter serving two hosts. They arrive through `opts`, the same way
 * `board-skin.js` takes `linkState`. The `ready` cue is a plain map the host
 * owns; this file only asks whether a key is present.
 *
 * ── CLEAR BEFORE PAINT — THIS IS THE DEFECT, NOT A STYLE CHOICE ─────────────
 *
 * The inline block ended in `mega.appendChild(cell)` with no clear, because it
 * only ever ran once and a one-shot painter cannot tell the difference. Called
 * twice, it produced eighteen boards. Every region here sets `innerHTML = ''`
 * first, so `paint` is IDEMPOTENT: painting the same plan twice leaves the same
 * DOM, and painting a new plan REPLACES the old one rather than growing under
 * it. `test-mega-skin.js` §A asserts this against a mutant that removes the
 * clear, because "it looks right on screen once" is how the append survived.
 *
 * ── WHY THIS FILE CARRIES ITS OWN `kv` ──────────────────────────────────────
 *
 * `board-skin.js` exports a `kv` that does the same ten lines. Sharing it would
 * make one painter un-loadable without its sibling — a host that wants the mega
 * and not the board would have to load both, and the class-token independence
 * board-skin's header argues for would be gone. The duplication is a rendering
 * idiom with NO cross-host invariant: if the two drift, the tables look
 * different and nothing is silently wrong. That is the test that distinguishes
 * cheap duplication from the `enterSharedMatch()` class, where two copies of a
 * clearing rule DID have an invariant and desynced two live hosts (S31.1336).
 * Named here so a later reader does not "fix" it into a coupling.
 *
 * ── NO CACHED NODES ─────────────────────────────────────────────────────────
 *
 * The host re-queries its elements on EVERY repaint and hands them in fresh. A
 * node held across a repaint is a node from a past version of the page — the
 * scar in calendar-scope-split.test.js, carried forward here verbatim from
 * board-skin.js. This file holds NO module-level element state. It is a
 * function of (els, plan, opts), not an object with a lifecycle.
 */
/* BATTLEGANZA-DUAL-EXPRESSION — node: module.exports · browser: root.Battleganza.MegaSkin */
(function (root) {

  /** kv(el, rows) — the two-column readout. textContent on both columns, never
   *  innerHTML, so a value containing markup is shown rather than executed. */
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

  /** The nine box chips of ONE board — the tic-tac-toe territory face.
   *  Every class token traces to exactly one plan field; this file invents
   *  none of them and fuses none of them (mega-render.js's honesty contract
   *  is worth nothing if the paint layer re-collapses the channels). */
  function paintFace(face, b, ready) {
    b.boxes.forEach(function (box) {
      var d = document.createElement('div');
      var cls = ['box'];
      if (box.owner)      cls.push('box--' + box.owner);
      if (box.openThreat) cls.push('box--threat');
      if (box.minesolved) cls.push('box--mine');
      if (box.viaReveal)  cls.push('box--revealed');
      var isReady = ready[b.board + ':' + box.box] === true;
      if (isReady) cls.push('box--ready');
      d.className = cls.join(' ');
      d.textContent = box.owner || '';
      d.title = 'box ' + box.box +
        (box.owner ? ' — owned by ' + box.owner : ' — unclaimed') +
        (box.openThreat ? ' — open threat for ' + box.openThreat : '') +
        (box.minesolved ? ' — solved by you' : '') +
        (box.viaReveal ? ' — revealed to you' : '') +
        (isReady ? ' — SOLVED, NOT YET CLAIMED' : '');
      face.appendChild(d);
    });
  }

  /** One mega cell: head, face, fill bar, label. */
  function paintCell(b, ready) {
    var cell = document.createElement('div');
    cell.className = b.tokens.join(' ');

    var head = document.createElement('div');
    head.className = 'board-head';
    head.innerHTML = '<span></span><span class="board-state"></span>';
    head.children[0].textContent = 'board ' + b.board;
    head.children[1].textContent = b.state;
    cell.appendChild(head);

    var face = document.createElement('div');
    face.className = 'face';
    paintFace(face, b, ready);
    cell.appendChild(face);

    /* `fill` is a PASS-THROUGH of the view-model's density. It is not
     * re-derived and not weighted — own-progress has its own channel and must
     * not leak into the territory channel. */
    var bar = document.createElement('div');
    bar.className = 'fill';
    var i = document.createElement('i');
    i.style.width = Math.round(b.fill * 100) + '%';
    bar.appendChild(i);
    cell.appendChild(bar);

    var lab = document.createElement('div');
    lab.className = 'label';
    lab.textContent = b.label;
    cell.appendChild(lab);

    return cell;
  }

  /** The nine mega cells, in BOARD ORDER — never sorted here. mega-render.js's
   *  contract rule 3 is that boards come out 1..9; a painter that reordered
   *  them would break the game board's own geometry. */
  function paintMega(el, plan, ready) {
    if (!el) return;
    el.innerHTML = '';                    // <- the defect, closed. See header.
    plan.boards.forEach(function (b) { el.appendChild(paintCell(b, ready)); });
  }

  /**
   * paint(els, plan, opts) — the whole contract a host needs.
   *
   * @param els  {mega, territory} — any subset. Re-queried by the host every
   *             repaint and handed in fresh; never cached here.
   * @param plan a megaPlan from `mega-render.js`. ALREADY COMPUTED — this file
   *             does not derive it, because deriving it needs a replica, a
   *             claim log and a config.
   * @param opts {ready: {"b:x": true}, pageVersion: string, sweepMs: number}
   *             — the host facts the plan does not carry. All optional.
   */
  function paint(els, plan, opts) {
    if (!els || !plan || !plan.boards) return;
    var o = opts || {};
    var ready = o.ready || {};

    paintMega(els.mega, plan, ready);

    kv(els.territory, [
      ['page _version',    o.pageVersion === undefined ? '—' : String(o.pageVersion)],
      ['boards painted',   String(plan.boards.length)],
      ['megaLine owner',   plan.megaLine || '(none)'],
      ['matchOver',        String(plan.matchOver)],
      ['winner',           plan.winner || '(none)'],
      ['readyToClaim',     String(Object.keys(ready).length) + ' box(es)'],
      ['sweep (81 boxes)', o.sweepMs === undefined || o.sweepMs === null
                             ? '—' : Number(o.sweepMs).toFixed(2) + ' ms']
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
    root.Battleganza.MegaSkin = __api;
  }

})(typeof window !== 'undefined' ? window : this);
