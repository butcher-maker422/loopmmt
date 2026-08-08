/* forest/app/public/shell/compose-dock.js — the app-shell MINIMIZE → DOCK, generalized.
 *
 * The reusable half of L3 (C1-c). A compose pane is a bottom-right docked overlay a Tree opens
 * to author a record (a mail message, a calendar event, a contact). SL-3 already gave every such
 * pane a top-× to DISMISS it (throw the draft away). This gives every such pane a MINIMIZE — set
 * the draft aside without losing it: the overlay is HIDDEN (its DOM + typed state preserved), and
 * a small docked TAB arrives at the bottom-right of the page carrying the draft's title + a way
 * back (click to RESTORE) and a × (discard, the pane's own teardown). Gmail's minimized-compose,
 * as one shell-level affordance every Tree inherits.
 *
 * WHY A SHELL SINGLETON (the generalization, C1-c): the dock lives on document.body, NOT inside
 * any app's left column. So a minimized draft survives (1) the compose overlay being hidden and
 * (2) an APP-SWITCH — you can minimize a mail draft, hop to Calendar, and the mail draft's tab is
 * still there waiting. A future Tree gets minimize-to-dock for free by calling minimize() — the
 * same way SL-3's × generalized as a shape law: the pattern binds every Tree, not just mail.
 *
 * OWNERSHIP: this is a DUMB VIEW. It knows nothing about mail, calendars, contacts, drafts, or
 * form state. It owns only the docked-tab chrome and where it sits. The CALLER owns the pane: it
 * hands minimize() a title to show, an onRestore (show your overlay again), and an onClose (tear
 * the pane down — the same teardown the × / Cancel run). The dock never reaches INTO the pane.
 *
 * K-rule (kin to the undo-dock's K1): the tab shows only the title the caller CHOOSES to pass —
 * typically the record kind ("New message", "New event") or a short subject. It is the owner's
 * own draft label, shown to the owner; the dock never extracts a recipient, body, or token from
 * the pane. A caller that wants a bare kind-label passes one; the dock does not decide.
 *
 * Calm by rule: fade in / fade out, no flash, no motion louder than the rest of the Grove.
 * Cold-safe: no document / no body -> minimize() returns an inert handle whose methods no-op, so a
 * caller can feature-detect the dock and fall back to plain dismiss when this module is absent.
 *
 * Attaches to window.ForestShell.composeDock. Depends on nothing else in the shell.
 */
(function () {
  "use strict";
  var root = (typeof window !== "undefined")
    ? (window.ForestShell = window.ForestShell || {})
    : (typeof global !== "undefined" ? (global.window = global.window || {}, global.window.ForestShell = global.window.ForestShell || {}) : {});

  var VERSION = "1.0.0";

  function doc_() { return (typeof document !== "undefined") ? document : (root.__doc || null); }

  // Minimal element helper — the dock builds its own DOM (does not borrow a renderer's `el`).
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

  // activate: click + keyboard (Enter/Space) for a role=button element (kept local, cold-safe).
  function activate(node, fn) {
    if (!node || typeof node.addEventListener !== "function") return;
    node.addEventListener("click", function () { fn(); });
    node.addEventListener("keydown", function (ev) {
      var key = ev && (ev.key || ev.keyCode);
      if (key === "Enter" || key === " " || key === 13 || key === 32) {
        if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
        fn();
      }
    });
  }

  var state = null;   // { strip, tabs: [ { id, node, title, onRestore, onClose } ] }
  var seq = 0;

  // the strip is created lazily and REMOVED when the last tab closes (keeps the DOM clean,
  // exactly as mail-undo-dock does with its node). Bottom-RIGHT, where the compose overlay sat.
  function ensureStrip(doc) {
    if (state && state.strip && state.strip.parentNode) return state;
    if (!doc || !doc.body) return null;
    var strip = el(doc, "div", "compose-dock", { role: "list", "aria-label": "Minimized drafts" });
    doc.body.appendChild(strip);
    if (typeof strip.setAttribute === "function") strip.setAttribute("data-shown", "1");
    state = { strip: strip, tabs: [] };
    return state;
  }

  function removeStripIfEmpty() {
    if (state && state.strip && state.tabs.length === 0) {
      if (state.strip.parentNode) state.strip.parentNode.removeChild(state.strip);
      state = null;
    }
  }

  function removeTab(rec) {
    if (!state) return;
    var i = state.tabs.indexOf(rec);
    if (i !== -1) state.tabs.splice(i, 1);
    if (rec.node && rec.node.parentNode) rec.node.parentNode.removeChild(rec.node);
    removeStripIfEmpty();
  }

  // an inert handle for the cold-safe path (no doc/body). Every method is a silent no-op so a
  // caller never crashes minimizing into a dock that could not mount.
  function inertHandle() {
    return { id: null, node: null, restore: function () {}, close: function () {}, setTitle: function () {} };
  }

  // minimize(o): hide-the-caller's-pane is the CALLER's job; this raises the docked tab that
  // brings it back. Returns a handle the caller keeps.
  //   o.title      the label to show on the tab (required; the caller's chosen draft label)
  //   o.onRestore  called when the owner clicks the tab / restore — the caller re-shows its overlay
  //   o.onClose    called when the owner clicks the tab's × — the caller tears the pane down
  //   o._doc       test seam
  function minimize(o) {
    o = o || {};
    var doc = o._doc || doc_();
    var s = ensureStrip(doc);
    if (!s) return inertHandle();

    var id = "compose-dock-tab-" + (++seq);
    var onRestore = (typeof o.onRestore === "function") ? o.onRestore : null;
    var onClose = (typeof o.onClose === "function") ? o.onClose : null;

    var tab = el(doc, "div", "compose-dock__tab", { role: "listitem", "data-tab-id": id });

    // the title is a restore affordance (role=button): click / Enter / Space brings the pane back.
    var titleBtn = el(doc, "span", "compose-dock__title", {
      role: "button", tabindex: "0",
      "aria-label": "Restore draft: " + (o.title || "draft"),
      text: (o.title != null ? String(o.title) : "Draft")
    });

    // the × — discard the minimized draft (runs the pane's teardown, same as SL-3's dismiss).
    var x = el(doc, "button", "compose-dock__x record__dismiss", { type: "button", "aria-label": "Discard draft", text: "\u00d7" });

    tab.appendChild(titleBtn);
    tab.appendChild(x);
    s.strip.appendChild(tab);

    var rec = { id: id, node: tab, title: (o.title != null ? String(o.title) : "Draft"),
                onRestore: onRestore, onClose: onClose };
    s.tabs.push(rec);

    activate(titleBtn, function () {
      removeTab(rec);
      if (typeof rec.onRestore === "function") { try { rec.onRestore(); } catch (e) { /* restore is the caller's; never let it break the dock */ } }
    });
    if (typeof x.addEventListener === "function") {
      x.addEventListener("click", function () {
        removeTab(rec);
        if (typeof rec.onClose === "function") { try { rec.onClose(); } catch (e) { /* teardown is the caller's */ } }
      });
    }

    return {
      id: id,
      node: tab,
      restore: function () {
        removeTab(rec);
        if (typeof rec.onRestore === "function") { try { rec.onRestore(); } catch (e) {} }
      },
      close: function () {
        removeTab(rec);
        if (typeof rec.onClose === "function") { try { rec.onClose(); } catch (e) {} }
      },
      // setTitle: the caller may relabel a live tab (e.g. subject typed after minimize).
      setTitle: function (t) {
        rec.title = (t != null ? String(t) : "Draft");
        if (titleBtn) { titleBtn.textContent = rec.title; titleBtn.setAttribute("aria-label", "Restore draft: " + rec.title); }
      }
    };
  }

  function count() { return state ? state.tabs.length : 0; }

  function clear() {
    if (!state) return;
    // copy — removeTab mutates the array as it goes
    state.tabs.slice().forEach(function (rec) { removeTab(rec); });
  }

  root.composeDock = {
    VERSION: VERSION,
    minimize: minimize,
    count: count,
    clear: clear
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.composeDock;
  }
})();
