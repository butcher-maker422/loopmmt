/* forest/app/public/shell/mail-undo-dock.js — email-app undo-send, the DOCK.
 *
 * The reconsideration window used to count down INSIDE the compose overlay, holding the
 * fields disabled while the owner watched a timer and wondered whether to close the window.
 * This moves it OUT: on a queued send, compose closes, a quiet "Sent" flash reassures, and a
 * small dock arrives at the BOTTOM-LEFT of the page carrying the Undo action + a dual
 * countdown (numeric seconds + a shrinking ring). Undo -> the owner's callback (mail cancels
 * the queued send and reopens compose repopulated). No undo -> the dock fades at 0, quietly.
 *
 * OWNERSHIP: this is a DUMB VIEW. It knows nothing about sending, cancelling, or Gmail. It runs
 * a COSMETIC countdown (the runtime is the source of truth and dispatches at dispatchAt on its
 * own, even if this tab closes) and calls back on Undo / expiry. Mail owns the logic; the dock
 * owns only the chrome and where it sits. Shell-level singleton: it lives on document.body, so
 * it survives the compose overlay closing AND app-switches (the left column's content swaps per
 * app; the dock does not live in it).
 *
 * K1 (inherited from the in-compose toast): the dock shows only a countdown + Undo. It NEVER
 * shows the composed body, a recipient, a subject, or a token. Non-secret chrome only.
 *
 * Calm by rule: fade in / fade out, no flash, no motion louder than the rest of the Grove.
 * Cold-safe: no document / no body -> every call is a silent no-op (mail feature-detects the
 * dock and falls back to the in-compose countdown when this module is absent).
 *
 * Attaches to window.ForestShell.undoDock. Depends on nothing else in the shell.
 */
(function () {
  "use strict";
  var root = (typeof window !== "undefined")
    ? (window.ForestShell = window.ForestShell || {})
    : (typeof global !== "undefined" ? (global.window = global.window || {}, global.window.ForestShell = global.window.ForestShell || {}) : {});

  var VERSION = "1.1.0";

  function doc_() { return (typeof document !== "undefined") ? document : (root.__doc || null); }

  // Minimal element helper — the dock builds its own DOM (does not borrow mail-renderer's `el`).
  function el(doc, tag, cls, opts) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    opts = opts || {};
    for (var k in opts) {
      if (!Object.prototype.hasOwnProperty.call(opts, k)) continue;
      if (k === "text") { n.textContent = opts[k]; }
      else { n.setAttribute(k, String(opts[k])); }
    }
    return n;
  }
  function clear(n) { if (n) while (n.firstChild) n.removeChild(n.firstChild); }

  // ---- the SENT flash (a brief, quiet confirmation where the compose was) -----------------
  // A self-dismissing toast: "Sent". It reassures that the send went (and compose closed
  // correctly) without asking for attention. The DOCK carries the undo; this only reassures.
  function flashSent(opts) {
    opts = opts || {};
    var doc = opts._doc || doc_();
    if (!doc || !doc.body) return null;
    var setT = opts._setTimeout || (typeof setTimeout === "function" ? setTimeout : null);
    var node = el(doc, "div", "mail-sent-flash", { role: "status", "aria-live": "polite" });
    node.appendChild(el(doc, "span", "mail-sent-flash__mark", { "aria-hidden": "true", text: "\u2713" }));
    node.appendChild(el(doc, "span", "mail-sent-flash__text", { text: opts.text || "Message sent" }));
    doc.body.appendChild(node);
    // reveal on the next frame so the fade-in transition catches (cold-safe if no rAF)
    if (typeof node.setAttribute === "function") node.setAttribute("data-shown", "1");
    if (setT) {
      setT(function () {
        node.setAttribute("data-leaving", "1");
        setT(function () { if (node.parentNode) node.parentNode.removeChild(node); }, opts.fadeMs || 320);
      }, opts.holdMs || 2200);
    }
    return node;
  }

  // ---- the DOCK (persistent, bottom-left, dual countdown) ---------------------------------
  var RING_R = 9;                    // ring radius (px) — small, quiet
  var RING_C = 2 * Math.PI * RING_R; // circumference, for stroke-dasharray/offset

  var state = null;   // { node, ring, ringPath, num, iv, onUndo, onExpire, total, remaining, clrIv }

  function ensureNode(doc) {
    if (state && state.node && state.node.parentNode) return state;
    if (!doc || !doc.body) return null;
    var node = el(doc, "div", "mail-undo-dock", { role: "status", "aria-live": "polite" });

    // heading: the "message sent" line lives IN the dock too, so the affordance and the
    // confirmation are one calm element (K1: no recipient/subject/body).
    var head = el(doc, "div", "mail-undo-dock__head");
    head.appendChild(el(doc, "span", "mail-undo-dock__label", { text: "Message sent" }));
    node.appendChild(head);

    var row = el(doc, "div", "mail-undo-dock__row");

    // the visual countdown: an SVG ring that empties over the window
    var ns = "http://www.w3.org/2000/svg";
    var ring = doc.createElementNS ? doc.createElementNS(ns, "svg") : el(doc, "svg", "");
    ring.setAttribute("class", "mail-undo-dock__ring");
    ring.setAttribute("viewBox", "0 0 24 24");
    ring.setAttribute("aria-hidden", "true");
    var track = doc.createElementNS ? doc.createElementNS(ns, "circle") : el(doc, "circle", "");
    track.setAttribute("class", "mail-undo-dock__ring-track");
    track.setAttribute("cx", "12"); track.setAttribute("cy", "12"); track.setAttribute("r", String(RING_R));
    var arc = doc.createElementNS ? doc.createElementNS(ns, "circle") : el(doc, "circle", "");
    arc.setAttribute("class", "mail-undo-dock__ring-arc");
    arc.setAttribute("cx", "12"); arc.setAttribute("cy", "12"); arc.setAttribute("r", String(RING_R));
    arc.setAttribute("stroke-dasharray", String(RING_C));
    arc.setAttribute("stroke-dashoffset", "0");
    if (ring.appendChild) { ring.appendChild(track); ring.appendChild(arc); }

    // the numeric countdown, centered in the ring
    var num = el(doc, "span", "mail-undo-dock__num", { "aria-hidden": "true", text: "" });

    var gauge = el(doc, "span", "mail-undo-dock__gauge");
    gauge.appendChild(ring);
    gauge.appendChild(num);
    row.appendChild(gauge);

    // the Undo action — a real primary button (the chrome makes it read as buttony; see shell.css)
    var undo = el(doc, "button", "mail-undo-dock__undo", { type: "button", "aria-label": "Undo send" });
    undo.appendChild(el(doc, "span", "mail-undo-dock__undo-label", { text: "Undo send" }));
    row.appendChild(undo);

    node.appendChild(row);

    // the settings link — a small, quiet text button UNDER the primary action. This is the moment
    // the owner decides whether the window was too short/long, so the affordance to change it sits
    // right where that thought happens. It calls back to mail (the owner opens its Undo settings);
    // the dock stays a dumb view. Hidden until show() is given an onEditSettings callback, so the
    // dock never advertises an action the owner didn't wire (cold-safe).
    var settings = el(doc, "button", "mail-undo-dock__settings", { type: "button", hidden: "hidden", "aria-hidden": "true" });
    settings.appendChild(el(doc, "span", "", { text: "Edit Undo Settings" }));
    node.appendChild(settings);

    doc.body.appendChild(node);

    if (typeof undo.addEventListener === "function") {
      undo.addEventListener("click", function () {
        var cb = state && state.onUndo;
        // stop the clock immediately; the callback decides what the dock shows next.
        stopIv();
        if (typeof cb === "function") cb();
      });
    }
    if (typeof settings.addEventListener === "function") {
      settings.addEventListener("click", function () {
        var cb = state && state.onEditSettings;
        if (typeof cb === "function") cb();   // the dock does NOT stop the clock — editing settings doesn't cancel the send
      });
    }

    state = { node: node, ring: arc, num: num, undo: undo, settings: settings, iv: null, clrIv: null,
              onUndo: null, onExpire: null, onEditSettings: null, total: 0, remaining: 0 };
    return state;
  }

  function stopIv() {
    if (state && state.iv != null && state.clrIv) { state.clrIv(state.iv); state.iv = null; }
  }

  function paint() {
    if (!state) return;
    var r = Math.max(0, state.remaining);
    if (state.num) state.num.textContent = r + "s";
    // ring empties as time runs out: offset grows from 0 (full) to C (empty)
    if (state.ring && state.total > 0) {
      var elapsedFrac = 1 - (r / state.total);
      state.ring.setAttribute("stroke-dashoffset", String((elapsedFrac * RING_C).toFixed(2)));
    }
  }

  // show(o): reveal the dock and start the cosmetic countdown.
  //   o.total       window length in seconds (required, > 0)
  //   o.remaining   seconds left now (optional; defaults to total) — lets a resumed dock start mid-window
  //   o.onUndo      called when the owner clicks Undo (mail cancels + reopens compose)
  //   o.onExpire    called when the countdown reaches 0 (mail may no-op; the dock fades either way)
  //   o._doc / o._setInterval / o._clearInterval  test seams
  function show(o) {
    o = o || {};
    var doc = o._doc || doc_();
    var s = ensureNode(doc);
    if (!s) return null;
    var setIv = o._setInterval || (typeof setInterval === "function" ? setInterval : null);
    s.clrIv = o._clearInterval || (typeof clearInterval === "function" ? clearInterval : null);
    s._setTimeout = o._setTimeout || (typeof setTimeout === "function" ? setTimeout : null);   // done-state hold seam
    stopIv();
    s.total = Math.max(0, Number(o.total) || 0);
    s.remaining = (o.remaining != null) ? Math.max(0, Number(o.remaining) || 0) : s.total;
    s.onUndo = (typeof o.onUndo === "function") ? o.onUndo : null;
    s.onExpire = (typeof o.onExpire === "function") ? o.onExpire : null;
    s.onEditSettings = (typeof o.onEditSettings === "function") ? o.onEditSettings : null;
    // reveal the "Edit Undo Settings" link only when the owner wired it (cold-safe: no wire, no link)
    if (s.settings) {
      if (s.onEditSettings) { s.settings.removeAttribute("hidden"); s.settings.removeAttribute("aria-hidden"); }
      else { s.settings.setAttribute("hidden", "hidden"); s.settings.setAttribute("aria-hidden", "true"); }
    }
    // restore the resting look (a prior landed()/dismiss()/done() may have left it in a leaving/done state)
    s.node.removeAttribute("data-leaving");
    s.node.removeAttribute("data-landed");
    s.node.removeAttribute("data-done");
    s.node.setAttribute("data-shown", "1");   // triggers the fade-in transition
    paint();
    if (s.remaining <= 0) { expire(); return s.node; }
    if (setIv) {
      s.iv = setIv(function () {
        s.remaining -= 1;
        if (s.remaining <= 0) { paint(); expire(); }
        else { paint(); }
      }, 1000);
    }
    return s.node;
  }

  function expire() {
    if (!state) return;
    stopIv();
    var cb = state.onExpire;
    if (typeof cb === "function") { try { cb(); } catch (e) { /* the done-state still runs */ } }
    // note #3: don't yank the dock at 0. Show a short, calm "on its way" confirmation — the window
    // closed and the runtime is dispatching — then fade gracefully. Honest by construction: the
    // dock is cosmetic and the runtime dispatches on its own at dispatchAt, so "on its way" is true.
    done("Message sent \u2014 on its way");
  }

  // done(msg): the graceful close after the window expires. Swap to a single calm line (the countdown
  // and Undo are gone — the moment to reconsider has passed), hold briefly, then fade. Distinct from
  // landed() (the 409 too-late case) so the copy stays honest: this window simply ran its course.
  function done(msg) {
    if (!state || !state.node) return;
    stopIv();
    var doc = state.node.ownerDocument;
    var head = state.node.firstChild;      // the .mail-undo-dock__head
    if (head) {
      clear(head);
      head.appendChild(el(doc, "span", "mail-undo-dock__done-mark", { "aria-hidden": "true", text: "\u2713" }));
      head.appendChild(el(doc, "span", "mail-undo-dock__label", { text: msg || "Message sent \u2014 on its way" }));
    }
    // the actions are spent — hide the countdown row and the settings link so the done-state reads clean
    if (state.node.childNodes) {
      for (var i = 0; i < state.node.childNodes.length; i++) {
        var c = state.node.childNodes[i];
        if (c !== head && c.setAttribute) c.setAttribute("hidden", "hidden");
      }
    }
    state.node.setAttribute("data-done", "1");
    var setT = (state && state._setTimeout) || ((typeof setTimeout === "function") ? setTimeout : null);
    if (setT) setT(function () { dismiss({ fade: true }); }, 1500);
    else dismiss({ fade: true });
  }

  // landed(msg): the too-late case (409 — the send already dispatched). Show a brief calm note,
  // then fade. Distinct from expire() so mail can report "Already sent" honestly on a late Undo.
  function landed(msg) {
    if (!state || !state.node) return;
    stopIv();
    var head = state.node.firstChild;
    if (head) { clear(head); head.appendChild(el(state.node.ownerDocument, "span", "mail-undo-dock__label", { text: msg || "Already sent" })); }
    state.node.setAttribute("data-landed", "1");
    var setT = (typeof setTimeout === "function") ? setTimeout : null;
    if (setT) setT(function () { dismiss({ fade: true }); }, 1600);
    else dismiss({ fade: true });
  }

  function dismiss(o) {
    o = o || {};
    if (!state || !state.node) return;
    stopIv();
    var node = state.node;
    var setT = o._setTimeout || (typeof setTimeout === "function" ? setTimeout : null);
    if (o.fade !== false && node.setAttribute) {
      node.setAttribute("data-leaving", "1");
      node.removeAttribute("data-shown");
      if (setT) { setT(function () { if (node.parentNode) node.parentNode.removeChild(node); state = null; }, o.fadeMs || 360); return; }
    }
    if (node.parentNode) node.parentNode.removeChild(node);
    state = null;
  }

  root.undoDock = {
    version: VERSION,
    show: show,
    dismiss: dismiss,
    landed: landed,
    flashSent: flashSent,
    _RING_C: RING_C,
    _state: function () { return state; }   // test-only inspector
  };

  if (typeof module !== "undefined" && module.exports) module.exports = root.undoDock;
})();
