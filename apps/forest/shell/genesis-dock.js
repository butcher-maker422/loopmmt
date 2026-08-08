/* Shea's Forest — the App Shell · shell/genesis-dock.js
   THE ONE MODULE ROUTE the Chalk Line's Parity Report emitted over the three-app suite (§4,
   `genesis` → MODULE), corrected to its true seam by the Cruise's SL-1 audit.

   THE INVARIANT. Calendar renderNewForm, contacts createForm, and mail openCompose each hand-rolled
   the SAME minimize→composeDock block — a `record__minimize` button that, on click, docks the pane
   (adds `record--docked`) and hands a restorable tab to the shell-level composeDock (onRestore un-docks,
   onClose runs the pane's teardown). Feature-detected on composeDock; cold-safe when absent. That
   ~20-line block is the real triplication. THIS module extracts exactly it — the dock affordance — and
   nothing else.

   WHY NOT THE ×. An earlier cut of this module also pulled the top-× dismiss (record__dismiss) out of
   the pane bodies. The Cruise SL-1 audit (law_sl1 grades the GENESIS FUNCTION's OWN body for the ×)
   BREACHed calendar + contacts — correctly: SL-1 wants the escape hatch IN the pane, and moving it into
   a module made it (a) invisible to the intra-function checker and (b) load-conditional (a failed module
   load would drop the ×, turning the pane into the trap SL-1 forbids). The × is 3 trivial lines worth
   ~nothing to dedup and everything to keep in-body. So the × STAYS INLINE in each host; this module is
   the dock-minimize ONLY. (mail is a separate non-adoption: its dock closure is entangled with its
   composeOpen poll state — see the plan §1a.)

   SL-1 SAFE BY CONSTRUCTION: this module never creates or wipes the container (the host owns the mount)
   and never touches the ×. It only appends the minimize control onto a container the host hands in.

   API. window.ForestShell.genesisDock.wire(doc, {
     container,   // the host's already-created pane node (overlay | box). REQUIRED.
     kind,        // the app's class prefix, e.g. "calendar-record" / "contacts-create".
     title,       // the docked-tab label, e.g. "New event" / "New contact".
     close,       // the pane's teardown fn (done/close) — the dock's onClose runs it. REQUIRED.
     root,        // optional override of window.ForestShell (test seam; composeDock lives here).
     el           // optional el() override (test seam).
   }) -> { minimize } | { minimize: null }.
   COLD-SAFE: absent/incapable composeDock -> no minimize control, the prior ×-only pane, byte-for-byte.

   TC-1 / thin discipline: NO app logic — no field, no submit, no container creation, no fetch.
*/
(function () {
  "use strict";
  var root = (typeof window !== "undefined")
    ? (window.ForestShell = window.ForestShell || {})
    : (typeof globalThis !== "undefined" ? (globalThis.ForestShell = globalThis.ForestShell || {}) : {});

  // The renderers' el() fallback, verbatim — so a control built here is byte-identical to one built
  // inline in the host it replaces (same className, same attr/text handling).
  function defaultEl(doc, tag, cls, attrs) {
    var n = doc.createElement(tag); if (cls) n.className = cls;
    if (attrs) for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) {
      if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]);
    }
    return n;
  }

  function wire(doc, opts) {
    opts = opts || {};
    var R = opts.root || root;
    var el = opts.el || (R && R.block && R.block.el) || defaultEl;
    var container = opts.container;
    var kind = opts.kind || "record";
    var title = opts.title != null ? opts.title : "";
    var close = typeof opts.close === "function" ? opts.close : function () {};

    if (!container || typeof container.appendChild !== "function") {
      return { minimize: null };
    }

    // L3: MINIMIZE -> the shell-level composeDock (feature-detected). Hides this pane (its DOM + typed
    // state preserved) and hands a restorable tab to the dock; restore re-shows it, discard runs the full
    // teardown (close()). record__minimize is its OWN family (NOT the record__dismiss × the SL-3 audits).
    // Cold-safe: no dock -> no minimize control, the prior ×-only pane.
    var cdock = (R && R.composeDock) || null;
    if (!(cdock && typeof cdock.minimize === "function")) {
      return { minimize: null };
    }

    var minimize = el(doc, "button", kind + "__minimize record__minimize",
      { type: "button", "aria-label": "Minimize", text: "\u2013" });
    minimize.addEventListener("click", function () {
      if (container.classList && container.classList.add) container.classList.add("record--docked");
      else container.className = (container.className || "") + " record--docked";
      cdock.minimize({
        title: title, _doc: doc,
        onRestore: function () {
          if (container.classList && container.classList.remove) container.classList.remove("record--docked");
          else container.className = String(container.className || "").replace(/\s*record--docked/g, "");
        },
        onClose: function () { close(); }
      });
    });
    container.appendChild(minimize);
    return { minimize: minimize };
  }

  root.genesisDock = { wire: wire };
  if (typeof module !== "undefined" && module.exports) module.exports = { wire: wire };
})();
