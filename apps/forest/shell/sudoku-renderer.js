/* Shea's Forest — the App Shell · shell/sudoku-renderer.js
   The Sudoku app pane (kind sudoku:*) — a PLAYABLE game, the fourth app pane.

   THE PLAY FOLD (S20). This renderer paints the forest-tab FACE of the dual-expression
   body's PLAY engine. It holds NO sudoku rule-logic (SWX / TC-1): generate, candidates,
   conflicts, win-detection, and the "why?" all come from window.SudokuPlay
   (projects/dual-expression/internal, purity_lint PURE), served under
   /sudoku/. This file is a SKIN — it owns the pane DOM, the input, and the Forest-token
   paint; the board reasoning stays in the guarded core. The Garden phone view is the same
   engine under a Canvas skin (the second face — the dual-expression thesis, on play).
   See projects/loop-sudoku/plan/loop-sudoku-PLAY-fold-decision-v1.md.

   New-Game affordance = Forest's New-Item pattern (New Email / New Contact / New Event):
   a LEFT-RAIL primary action (.rail__compose / Create) opens an OVERLAY form (head + inline
   × dismiss + genesisDock.wire minimize) carrying the game settings (difficulty); its submit
   ("Start game") pops a fresh game into the MAIN pane. Same joint, new content.

   Persistence: givens + user moves (the plan's requirement) via a fail-safe localStorage
   wrapper (the persist.js idiom) — unavailable storage degrades to no-resume, never a throw.

   Cold-safe: a missing engine or pane registry degrades to an honest note, never a throw. */
(function () {
  "use strict";
  var root = (window.ForestShell = window.ForestShell || {});

  var ASSET = "sudoku/";
  var SCRIPTS = [ASSET + "internal"]; // sets window.SudokuPlay

  var STORE_KEY = "forest:sudoku:v1";
  var STYLE_ID = "sudoku-pane-styles";

  /* ---- tiny DOM helper (the renderers' el() shape, verbatim behavior) -------- */
  function el(doc, tag, cls, attrs) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) {
      if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]);
    }
    return n;
  }

  /* ---- fail-safe storage (persist.js idiom) --------------------------------- */
  function makeStore(win) {
    try {
      var ls = win.localStorage, probe = "__sk_probe__";
      ls.setItem(probe, "1"); ls.removeItem(probe);
      return {
        get: function () { try { return ls.getItem(STORE_KEY); } catch (e) { return null; } },
        set: function (v) { try { ls.setItem(STORE_KEY, v); } catch (e) {} },
        del: function () { try { ls.removeItem(STORE_KEY); } catch (e) {} }
      };
    } catch (e) { return { get: function () { return null; }, set: function () {}, del: function () {} }; }
  }

  /* =========================================================================== */
  var PANE_CSS = [
    '[data-kind="sudoku"] .sk-app{--sk-mono:ui-monospace,"SF Mono",Menlo,monospace;',
    '  display:flex;gap:20px;align-items:flex-start;max-width:820px;margin:0 auto;padding:22px;',
    '  color:var(--ink,#0d1116);font-family:-apple-system,system-ui,"Segoe UI",sans-serif}',
    '[data-kind="sudoku"] .sk-rail{flex:0 0 168px;display:flex;flex-direction:column;gap:14px}',
    '[data-kind="sudoku"] .rail__compose{width:100%;font:inherit;font-weight:600;font-size:14px;',
    '  padding:11px 12px;border:1px solid var(--accent,#1e6fe0);border-radius:9px;cursor:pointer;',
    '  background:var(--accent,#1e6fe0);color:var(--on-accent,#fff);text-align:center}',
    '[data-kind="sudoku"] .rail__compose:hover{filter:brightness(1.06)}',
    '[data-kind="sudoku"] .sk-meta{display:flex;flex-direction:column;gap:8px;font-size:13px;',
    '  color:var(--ink-soft,#45536a);border-top:1px solid var(--line,#cfdbeb);padding-top:12px}',
    '[data-kind="sudoku"] .sk-meta .row{display:flex;justify-content:space-between}',
    '[data-kind="sudoku"] .sk-meta b{color:var(--ink,#0d1116);font-weight:600;font-family:var(--sk-mono)}',
    '[data-kind="sudoku"] .sk-main{position:relative;flex:1 1 auto;min-width:0;max-width:520px}',
    '[data-kind="sudoku"] .sk-empty{padding:40px 8px;text-align:center;color:var(--ink-soft,#45536a);font-size:15px;line-height:1.6}',
    '[data-kind="sudoku"] .sk-board{display:grid;grid-template-columns:repeat(9,1fr);aspect-ratio:1/1;width:100%;',
    '  border:2.5px solid var(--line-strong,#8896ad);border-radius:6px;overflow:hidden;',
    '  background:var(--surface,#fff);user-select:none;touch-action:manipulation}',
    '[data-kind="sudoku"] .sk-cell{position:relative;display:flex;align-items:center;justify-content:center;',
    '  border-right:1px solid var(--line,#cfdbeb);border-bottom:1px solid var(--line,#cfdbeb);',
    '  font:500 clamp(17px,4.6vw,26px)/1 var(--sk-mono);color:var(--accent,#1e6fe0);cursor:pointer}',
    '[data-kind="sudoku"] .sk-cell.given{color:var(--ink,#0d1116);font-weight:700}',
    '[data-kind="sudoku"] .sk-cell.br{border-right:2.5px solid var(--line-strong,#8896ad)}',
    '[data-kind="sudoku"] .sk-cell.bb{border-bottom:2.5px solid var(--line-strong,#8896ad)}',
    '[data-kind="sudoku"] .sk-cell:nth-child(9n){border-right:0}',
    '[data-kind="sudoku"] .sk-cell.peer{background:var(--surface-2,#eef3fb)}',
    '[data-kind="sudoku"] .sk-cell.same{background:var(--accent-dim,rgba(30,111,224,.16))}',
    '[data-kind="sudoku"] .sk-cell.sel{background:var(--accent-dim,rgba(30,111,224,.28))}',
    '[data-kind="sudoku"] .sk-cell.conflict{color:var(--danger,#c0392b)}',
    '[data-kind="sudoku"] .sk-cell.conflict::after{content:"";position:absolute;inset:0;background:var(--danger,#c0392b);opacity:.12}',
    '[data-kind="sudoku"] .sk-cell.hint{box-shadow:inset 0 0 0 3px var(--accent,#1e6fe0)}',
    '[data-kind="sudoku"] .sk-cell:focus-visible{outline:3px solid var(--accent,#1e6fe0);outline-offset:-3px}',
    '[data-kind="sudoku"] .sk-notes{position:absolute;inset:0;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);padding:2px}',
    '[data-kind="sudoku"] .sk-notes span{display:flex;align-items:center;justify-content:center;font:400 clamp(7px,1.8vw,10px)/1 var(--sk-mono);color:var(--ink-soft,#45536a)}',
    '[data-kind="sudoku"] .sk-pad{display:grid;grid-template-columns:repeat(9,1fr);gap:5px;margin-top:12px}',
    '[data-kind="sudoku"] .sk-pad button{position:relative;font:500 clamp(16px,4vw,20px)/1 var(--sk-mono);padding:11px 0;',
    '  border:1px solid var(--line,#cfdbeb);border-radius:8px;background:var(--surface-2,#eef3fb);color:var(--ink,#0d1116);cursor:pointer}',
    '[data-kind="sudoku"] .sk-pad button:hover{border-color:var(--accent,#1e6fe0)}',
    '[data-kind="sudoku"] .sk-pad button.done{opacity:.32;pointer-events:none}',
    '[data-kind="sudoku"] .sk-pad button .lo{position:absolute;top:2px;right:4px;font-size:9px;color:var(--ink-soft,#45536a)}',
    '[data-kind="sudoku"] .sk-acts{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-top:8px}',
    '[data-kind="sudoku"] .sk-acts button{font:inherit;font-size:13px;padding:10px 4px;border:1px solid var(--line,#cfdbeb);border-radius:8px;background:var(--surface-2,#eef3fb);color:var(--ink,#0d1116);cursor:pointer}',
    '[data-kind="sudoku"] .sk-acts button:hover{border-color:var(--accent,#1e6fe0)}',
    '[data-kind="sudoku"] .sk-acts button[aria-pressed="true"]{background:var(--accent,#1e6fe0);color:var(--on-accent,#fff);border-color:var(--accent,#1e6fe0)}',
    '[data-kind="sudoku"] .sk-why{margin-top:10px;min-height:0;background:var(--accent-dim,rgba(30,111,224,.12));border:1px solid var(--accent,#1e6fe0);border-radius:9px;padding:0 13px;max-height:0;overflow:hidden;transition:max-height .16s,padding .16s}',
    '[data-kind="sudoku"] .sk-why.open{max-height:180px;padding:11px 13px}',
    '[data-kind="sudoku"] .sk-why .t{font:600 12px var(--sk-mono);letter-spacing:.04em;text-transform:uppercase;color:var(--accent,#1e6fe0);margin-bottom:3px}',
    '[data-kind="sudoku"] .sk-why .r{font-size:14px;line-height:1.45;color:var(--ink,#0d1116)}',
    '[data-kind="sudoku"] .sk-win{margin-top:12px;text-align:center;padding:16px;border:1px solid var(--accent,#1e6fe0);border-radius:10px;background:var(--surface-2,#eef3fb)}',
    '[data-kind="sudoku"] .sk-win h3{margin:0 0 4px;font-size:18px;color:var(--ink,#0d1116)}',
    '[data-kind="sudoku"] .sk-win p{margin:0;font:13px var(--sk-mono);color:var(--ink-soft,#45536a)}',
    '[data-kind="sudoku"] .sudoku-record{position:absolute;left:50%;top:12px;transform:translateX(-50%);z-index:40;width:min(360px,94%);',
    '  background:var(--surface,#fff);border:1px solid var(--line,#cfdbeb);border-radius:12px;box-shadow:0 18px 48px rgba(0,0,0,.28);padding:18px 20px}',
    '[data-kind="sudoku"] .sudoku-record__head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}',
    '[data-kind="sudoku"] .sudoku-record__title{margin:0;font-size:17px;font-weight:600;color:var(--ink,#0d1116)}',
    '[data-kind="sudoku"] .sudoku-record__dismiss{font:inherit;font-size:18px;line-height:1;background:none;border:0;color:var(--ink-soft,#45536a);cursor:pointer;padding:2px 6px}',
    '[data-kind="sudoku"] .sudoku-record__label{font-size:13px;color:var(--ink-soft,#45536a);margin-bottom:8px}',
    '[data-kind="sudoku"] .sk-diff{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:16px}',
    '[data-kind="sudoku"] .sk-diff button{font:inherit;font-size:14px;padding:10px 0;border:1px solid var(--line,#cfdbeb);border-radius:8px;background:var(--surface-2,#eef3fb);color:var(--ink,#0d1116);cursor:pointer}',
    '[data-kind="sudoku"] .sk-diff button[aria-pressed="true"]{background:var(--accent,#1e6fe0);color:var(--on-accent,#fff);border-color:var(--accent,#1e6fe0)}',
    '[data-kind="sudoku"] .sudoku-record__go{width:100%;font:inherit;font-weight:600;font-size:15px;padding:12px;border:0;border-radius:9px;background:var(--accent,#1e6fe0);color:var(--on-accent,#fff);cursor:pointer}',
    '@media (max-width:560px){[data-kind="sudoku"] .sk-app{flex-direction:column}[data-kind="sudoku"] .sk-rail{flex-basis:auto;flex-direction:row;align-items:center}[data-kind="sudoku"] .sk-meta{border-top:0;border-left:1px solid var(--line,#cfdbeb);padding:0 0 0 12px;flex-direction:row;gap:12px}}'
  ].join("\n");

  function ensureStyles(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    var st = doc.createElement("style"); st.id = STYLE_ID; st.textContent = PANE_CSS;
    (doc.head || doc.documentElement).appendChild(st);
  }

  function loadScriptsThen(doc, i, done) {
    if (i >= SCRIPTS.length) return done(null);
    var src = SCRIPTS[i];
    if (window.SudokuPlay) return done(null);
    if (doc.querySelector('script[data-sudoku-src="' + src + '"]')) return loadScriptsThen(doc, i + 1, done);
    var s = doc.createElement("script");
    s.src = src; s.async = false; s.setAttribute("data-sudoku-src", src);
    s.onload = function () { loadScriptsThen(doc, i + 1, done); };
    s.onerror = function () { done(new Error("sudoku engine failed to load: " + src)); };
    (doc.head || doc.body).appendChild(s);
  }

  /* =========================================================================== */
  /* One game controller per pane. Holds state; paints; wires input.             */
  function makeGame(paneEl, doc, store) {
    var P = window.SudokuPlay;
    var S = {
      board: null, solution: null, givens: null, notes: null,
      sel: -1, notesMode: false, mistakes: 0, seconds: 0, difficulty: "medium",
      hintCell: -1, done: false, history: [], timer: null
    };
    var refs = {};

    function fmt(sec) { var m = (sec / 60) | 0, s = sec % 60; return m + ":" + (s < 10 ? "0" : "") + s; }
    function bit(n) { return 1 << n; }

    function persist() {
      if (!S.board) return;
      try {
        store.set(JSON.stringify({
          difficulty: S.difficulty, puzzle: S.givens, solution: S.solution,
          board: S.board, notes: S.notes, mistakes: S.mistakes, seconds: S.seconds, done: S.done
        }));
      } catch (e) {}
    }

    function startTimer() {
      if (S.timer) clearInterval(S.timer);
      tickMeta();
      S.timer = setInterval(function () { if (!S.done) { S.seconds++; tickMeta(); if (S.seconds % 5 === 0) persist(); } }, 1000);
    }

    function tickMeta() {
      if (refs.time) refs.time.textContent = fmt(S.seconds);
      if (refs.slips) refs.slips.textContent = String(S.mistakes);
      if (refs.diffLabel) refs.diffLabel.textContent = S.difficulty;
    }

    function loadGame(g, restored) {
      S.board = g.board.slice();
      S.solution = g.solution.slice();
      S.givens = g.puzzle.slice();
      S.notes = g.notes ? g.notes.slice() : (function () { var a = []; for (var i = 0; i < 81; i++) a.push(0); return a; })();
      S.difficulty = g.difficulty || "medium";
      S.mistakes = g.mistakes || 0; S.seconds = g.seconds || 0; S.done = !!g.done;
      S.sel = -1; S.hintCell = -1; S.history = [];
      buildMain();
      render();
      startTimer();
      if (!restored) persist();
    }

    function newGame(diff) {
      var g = P.generate(diff);
      loadGame({ board: g.puzzle.slice(), solution: g.solution, puzzle: g.puzzle, difficulty: diff, notes: null, mistakes: 0, seconds: 0, done: false }, false);
    }

    function isGiven(i) { return S.givens[i] !== 0; }
    function snapshot() { S.history.push({ board: S.board.slice(), notes: S.notes.slice(), mistakes: S.mistakes }); if (S.history.length > 150) S.history.shift(); }
    function select(i) { S.sel = i; S.hintCell = -1; render(); var c = refs.cells[i]; if (c) c.focus({ preventScroll: true }); }

    function enter(n) {
      if (S.done || S.sel < 0 || isGiven(S.sel)) return;
      snapshot();
      if (S.notesMode) {
        if (S.board[S.sel] !== 0) { S.history.pop(); return; }
        S.notes[S.sel] ^= bit(n);
      } else {
        if (S.board[S.sel] === n) { S.board[S.sel] = 0; }
        else {
          S.board[S.sel] = n; S.notes[S.sel] = 0;
          if (S.solution[S.sel] && n !== S.solution[S.sel]) S.mistakes++;
          var pr = (S.sel / 9) | 0, pc = S.sel % 9, pb = P.boxOf(S.sel);
          for (var j = 0; j < 81; j++) {
            if (S.board[j] !== 0) continue;
            if (((j / 9) | 0) === pr || j % 9 === pc || P.boxOf(j) === pb) S.notes[j] &= ~bit(n);
          }
        }
      }
      S.hintCell = -1; render(); persist(); checkWin();
    }

    function erase() { if (S.done || S.sel < 0 || isGiven(S.sel)) return; snapshot(); S.board[S.sel] = 0; S.notes[S.sel] = 0; S.hintCell = -1; render(); persist(); }
    function undo() { var s = S.history.pop(); if (!s) return; S.board = s.board; S.notes = s.notes; S.mistakes = s.mistakes; S.hintCell = -1; render(); persist(); }
    function toggleNotes() { S.notesMode = !S.notesMode; if (refs.notesBtn) refs.notesBtn.setAttribute("aria-pressed", S.notesMode ? "true" : "false"); }

    function why() {
      if (S.done) return;
      var bad = P.conflicts(S.board);
      if (bad.length) { openWhy("Fix a conflict first", "A number on the board breaks the rules (shown in red). Clear it, and the reasoning will work on a legal board."); return; }
      var h = P.findHint(S.board);
      if (!h) { openWhy("No simple next move", "No cell resolves by a basic technique right now. This build teaches naked and hidden singles on your live board; harder chains come next."); return; }
      S.sel = h.cell; S.hintCell = h.cell; render();
      var c = refs.cells[h.cell]; if (c) c.focus({ preventScroll: true });
      openWhy(h.technique, h.reason + "  You place it.");
    }
    function openWhy(t, r) { if (!refs.why) return; refs.whyT.textContent = t; refs.whyR.textContent = r; refs.why.classList.add("open"); }

    function checkWin() {
      if (!P.isComplete(S.board)) return;
      S.done = true; if (S.timer) clearInterval(S.timer); persist();
      if (refs.win) {
        refs.win.hidden = false; refs.win.innerHTML = "";
        refs.win.appendChild(el(doc, "h3", null, { text: "Solved" }));
        refs.win.appendChild(el(doc, "p", null, { text: S.difficulty + " · " + fmt(S.seconds) + " · " + S.mistakes + " slip" + (S.mistakes === 1 ? "" : "s") }));
      }
    }

    function render() {
      if (!S.board || !refs.cells) return;
      var bad = {}; var badArr = P.conflicts(S.board); for (var q = 0; q < badArr.length; q++) bad[badArr[q]] = 1;
      var selVal = S.sel >= 0 ? S.board[S.sel] : 0;
      var sr = S.sel >= 0 ? (S.sel / 9) | 0 : -1, sc = S.sel >= 0 ? S.sel % 9 : -1, sb = S.sel >= 0 ? P.boxOf(S.sel) : -1;
      for (var i = 0; i < 81; i++) {
        var elc = refs.cells[i], v = S.board[i], cls = "sk-cell";
        if (i % 9 === 2 || i % 9 === 5) cls += " br";
        if (((i / 9) | 0) === 2 || ((i / 9) | 0) === 5) cls += " bb";
        if (isGiven(i)) cls += " given";
        if (S.sel >= 0 && i !== S.sel && (((i / 9) | 0) === sr || i % 9 === sc || P.boxOf(i) === sb)) cls += " peer";
        if (v && selVal && v === selVal && i !== S.sel) cls += " same";
        if (i === S.sel) cls += " sel";
        if (bad[i]) cls += " conflict";
        if (i === S.hintCell) cls += " hint";
        elc.className = cls;
        elc.innerHTML = "";
        if (v) { elc.textContent = String(v); }
        else if (S.notes[i]) {
          var g = el(doc, "div", "sk-notes");
          for (var n = 1; n <= 9; n++) g.appendChild(el(doc, "span", null, { text: (S.notes[i] & bit(n)) ? String(n) : "" }));
          elc.appendChild(g);
        }
      }
      if (refs.pad) {
        var counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        for (var z = 0; z < 81; z++) if (S.board[z]) counts[S.board[z]]++;
        for (var d = 1; d <= 9; d++) {
          var b = refs.pad[d]; if (!b) continue;
          if (counts[d] >= 9) b.classList.add("done"); else b.classList.remove("done");
          if (refs.padLo[d]) refs.padLo[d].textContent = counts[d] >= 9 ? "" : String(9 - counts[d]);
        }
      }
      tickMeta();
    }

    function buildMain() {
      refs.main.innerHTML = "";
      var board = el(doc, "div", "sk-board", { "aria-label": "Sudoku board" });
      refs.cells = [];
      for (var i = 0; i < 81; i++) {
        var c = el(doc, "div", "sk-cell", { tabindex: "0" });
        (function (idx, node) { node.addEventListener("click", function () { select(idx); }); })(i, c);
        board.appendChild(c); refs.cells.push(c);
      }
      refs.main.appendChild(board);

      var pad = el(doc, "div", "sk-pad"); refs.pad = {}; refs.padLo = {};
      for (var n = 1; n <= 9; n++) {
        var b = el(doc, "button", null, { type: "button", text: String(n) });
        var lo = el(doc, "span", "lo"); b.appendChild(lo);
        (function (num) { b.addEventListener("click", function () { enter(num); }); })(n);
        pad.appendChild(b); refs.pad[n] = b; refs.padLo[n] = lo;
      }
      refs.main.appendChild(pad);

      var acts = el(doc, "div", "sk-acts");
      refs.notesBtn = el(doc, "button", null, { type: "button", "aria-pressed": "false", text: "✎ Notes" });
      refs.notesBtn.addEventListener("click", toggleNotes);
      var eraseBtn = el(doc, "button", null, { type: "button", text: "⌫ Erase" }); eraseBtn.addEventListener("click", erase);
      var undoBtn = el(doc, "button", null, { type: "button", text: "↶ Undo" }); undoBtn.addEventListener("click", undo);
      var whyBtn = el(doc, "button", null, { type: "button", text: "? Why" }); whyBtn.addEventListener("click", why);
      acts.appendChild(refs.notesBtn); acts.appendChild(eraseBtn); acts.appendChild(undoBtn); acts.appendChild(whyBtn);
      refs.main.appendChild(acts);

      refs.why = el(doc, "div", "sk-why", { "aria-live": "polite" });
      refs.whyT = el(doc, "div", "t"); refs.whyR = el(doc, "div", "r");
      refs.why.appendChild(refs.whyT); refs.why.appendChild(refs.whyR);
      refs.main.appendChild(refs.why);

      refs.win = el(doc, "div", "sk-win"); refs.win.hidden = true;
      refs.main.appendChild(refs.win);
    }

    function showEmpty() {
      refs.main.innerHTML = "";
      var e = el(doc, "div", "sk-empty");
      e.appendChild(el(doc, "div", null, { text: "No game yet." }));
      e.appendChild(el(doc, "div", null, { text: "Tap + New game to start." }));
      refs.main.appendChild(e);
    }

    function openNewGameForm() {
      var existing = refs.main.querySelector(".sudoku-record");
      if (existing) existing.parentNode.removeChild(existing);
      var overlay = el(doc, "div", "sudoku-record");
      var head = el(doc, "div", "sudoku-record__head");
      head.appendChild(el(doc, "h2", "sudoku-record__title", { text: "New game" }));
      var dismiss = el(doc, "button", "sudoku-record__dismiss", { type: "button", "aria-label": "Close", text: "×" });
      function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
      dismiss.addEventListener("click", close);
      head.appendChild(dismiss);            // × stays IN the pane body (SL-1)
      overlay.appendChild(head);

      overlay.appendChild(el(doc, "div", "sudoku-record__label", { text: "Difficulty" }));
      var diffWrap = el(doc, "div", "sk-diff");
      var chosen = S.difficulty || "medium";
      var diffBtns = {};
      ["easy", "medium", "hard"].forEach(function (d) {
        var b = el(doc, "button", null, { type: "button", "aria-pressed": d === chosen ? "true" : "false", text: d.charAt(0).toUpperCase() + d.slice(1) });
        b.addEventListener("click", function () {
          chosen = d;
          for (var k in diffBtns) if (diffBtns.hasOwnProperty(k)) diffBtns[k].setAttribute("aria-pressed", k === d ? "true" : "false");
        });
        diffBtns[d] = b; diffWrap.appendChild(b);
      });
      overlay.appendChild(diffWrap);

      var go = el(doc, "button", "sudoku-record__go", { type: "button", text: "Start game" });
      go.addEventListener("click", function () { close(); newGame(chosen); });
      overlay.appendChild(go);

      if (root.genesisDock && typeof root.genesisDock.wire === "function") {
        root.genesisDock.wire(doc, { container: overlay, kind: "sudoku-record", title: "New game", close: close, root: root });
      }
      refs.main.appendChild(overlay);
      var first = diffBtns[chosen]; if (first) first.focus({ preventScroll: true });
    }

    function onKey(e) {
      if (!refs.main || !refs.main.isConnected) return;
      if (e.key >= "1" && e.key <= "9") { enter(+e.key); e.preventDefault(); return; }
      if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") { erase(); e.preventDefault(); return; }
      if (e.key === "n" || e.key === "N") { toggleNotes(); return; }
      if (e.key === "z" || e.key === "Z") { undo(); return; }
      if (S.sel < 0) return;
      var r = (S.sel / 9) | 0, c = S.sel % 9;
      if (e.key === "ArrowUp") r = (r + 8) % 9; else if (e.key === "ArrowDown") r = (r + 1) % 9;
      else if (e.key === "ArrowLeft") c = (c + 8) % 9; else if (e.key === "ArrowRight") c = (c + 1) % 9; else return;
      e.preventDefault(); select(r * 9 + c);
    }

    function mount() {
      paneEl.innerHTML = "";
      var appDiv = el(doc, "div", "sk-app");
      var rail = el(doc, "div", "sk-rail");
      var newBtn = el(doc, "button", "rail__compose", { type: "button", text: "+ New game" });
      newBtn.addEventListener("click", openNewGameForm);
      rail.appendChild(newBtn);
      var meta = el(doc, "div", "sk-meta");
      function metaRow(label) { var row = el(doc, "div", "row"); row.appendChild(el(doc, "span", null, { text: label })); var v = el(doc, "b"); row.appendChild(v); meta.appendChild(row); return v; }
      refs.diffLabel = metaRow("level");
      refs.time = metaRow("time");
      refs.slips = metaRow("slips");
      rail.appendChild(meta);
      appDiv.appendChild(rail);

      refs.main = el(doc, "div", "sk-main");
      appDiv.appendChild(refs.main);
      paneEl.appendChild(appDiv);

      doc.addEventListener("keydown", onKey);

      var restored = false;
      try {
        var raw = store.get();
        if (raw) {
          var g = JSON.parse(raw);
          if (g && g.board && g.solution && g.puzzle) { loadGame(g, true); restored = true; }
        }
      } catch (e) {}
      if (!restored) { showEmpty(); refs.diffLabel.textContent = "—"; refs.time.textContent = "0:00"; refs.slips.textContent = "0"; }
    }

    return { mount: mount };
  }

  /* =========================================================================== */
  function renderHonestNote(paneEl, doc, msg) {
    paneEl.innerHTML = "";
    paneEl.appendChild(el(doc, "p", "sk-empty", { text: msg }));
  }

  function render(paneEl, ctx) {
    var doc = paneEl.ownerDocument || document;
    if (paneEl.__sudokuMounted) return; // keep-alive pane: mount once
    ensureStyles(doc);
    paneEl.innerHTML = ""; paneEl.appendChild(el(doc, "p", "sk-empty", { text: "Loading Sudoku…" }));
    loadScriptsThen(doc, 0, function (err) {
      if (err || !window.SudokuPlay) { renderHonestNote(paneEl, doc, "Couldn’t load the Sudoku engine on this runtime."); return; }
      try {
        var store = makeStore(window);
        var game = makeGame(paneEl, doc, store);
        paneEl.__sudokuMounted = true;
        game.mount();
      } catch (e) { renderHonestNote(paneEl, doc, "The Sudoku game failed to start."); }
    });
  }

  root.sudokuRenderer = { render: render, _version: "1.2" };
  if (root.pane && typeof root.pane.registerRenderer === "function") root.pane.registerRenderer("sudoku", render);
})();
