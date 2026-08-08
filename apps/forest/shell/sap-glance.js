/* Shea's Forest — the App Shell · shell/sap-glance.js
   P3 — THE GLANCE. The client half of the Sap read surface.

   ┌─ UNMOUNTED — READ THIS BEFORE "FIXING" ANYTHING BELOW ────────────┐
   │ This module is NOT LOADED by index.html. Its top-bar slot                  │
   │ ([data-forest-sap]) and its <script> include were both removed by          │
   │ OPERATOR DIRECTIVE. The code is correct and is kept deliberately; it is    │
   │ not dead-by-rot, it is parked.                                            │
   │                                                                            │
   │ WHY: the `known-due` fold rendered the literal text "needs you" in the     │
   │ top bar, and the staleness alarm directly below it reports the SAME fact   │
   │ in a sentence that also names the source and the right button. The         │
   │ operator looked at his own screen and called the second copy redundant.    │
   │                                                                            │
   │ WHY THE WHOLE DOT: removing only the amber state would leave this same     │
   │ read painting `known` — a solid "clear" chip while a connector is dead.    │
   │ That is the fabricated all-clear L1 and H3 exist to forbid. There was no   │
   │ honest half-measure, so the mount went and the module stayed.              │
   │                                                                            │
   │ TO RESTORE: re-add the [data-forest-sap] slot + this script include to     │
   │ index.html. Nothing in here needs to change. sap-glance.test.js still      │
   │ runs green — it drives the module directly and never needed the mount.     │
   └────────────────────────────────────────────────────────────────────────────┘

   THE FAULT THIS CLOSES. The runtime learned to fold its own health into a bounded
   projection (sap-fold.foldFromDisk) and to SERVE it, ungated, at GET /sap (P3
   runtime half). AND NOTHING PAINTED IT. The whole point of the Sap is legibility
   in the keyless-after-restart state — the one moment the daemon can prove nothing
   else about itself — and a projection nobody renders is a fact with no surface,
   the campaign's own confident-silence defect one layer up. This is the dot.

   IT SKINS THE HONEST-BADGE GRAMMAR — IT DOES NOT INVENT A SECOND ONE (PX: reuse
   the shape, don't re-solve it). honest-badge.js owns the four render states and
   the H3 law; this module's only job is the FOLD from the /sap projection to one
   of those states. The badge does the rendering; we choose the state honestly.

   THE THREE LAWS, each a bug that would otherwise ship (siblings of
   connector-freshness.js's L1–L3, and honest-badge.js's H3):

   L1 — THE HONESTY GATE. YOU CANNOT GET "clear" OUT OF NOTHING.
        An absent, failed, malformed, non-2xx, or un-run /sap read folds to
        `unreachable` — the hollow ring — NEVER to `known`. A dot that shows green
        when it could not reach the runtime is the exact lie the Sap exists to end
        (an app that reads "fine" when it has not looked). fetchSap NEVER rejects
        and EVERY failure path lands on glanceFrom(null) === unreachable.

   L2 — WE RECOMPUTE THE ATTENTION COUNT FROM THE ROWS WE FOLD.
        The projection ships `connectors_needing_attention` (one folded number) AND
        `connectors` (the rows it folded it from). We recompute needing-attention
        from the rows (a connector is needy iff ready === false) and render off OUR
        count, setting agrees:false on a divergence so it is visible, never silently
        absorbed. Rendering the number while ignoring the rows is how "1,511
        assertion strings" shipped as "1,511 passing tests" — a wrong noun on a
        right number is a lie that arrives holding a receipt (the Cruise,).

   L3 — GREEN IS EARNED. amber != green != ring, and the three mean three things.
        · reachable, zero needing attention          -> `known`     (solid, clear)
        · reachable, one+ needing attention / re-auth -> `known-due` (solid amber)
        · could not reach the projection at all       -> `unreachable` (the ring)
        The amber sub-case is honest-badge's `known-due` ("verified, needs you"),
        NOT a red alarm (Theo's rule: never red, never a count in the glyph).

   Plain script (no ES module) — attaches to window.ForestShell.sapGlance.
   DOM-free and pure (the render is honest-badge.js's / the caller's). Cold-safe:
   every entry point takes garbage and returns a safe value, never an exception
   into the boot. Maps to: forest/runtime/forest-runtime.js (GET /sap) +
   forest/sap/sap-fold.js + shell/honest-badge.js. */
(function () {
  "use strict";

  var root = (typeof window !== "undefined" ? window : globalThis);
  root.ForestShell = root.ForestShell || {};

  /* The three honest-badge states this glance can resolve to. `overdue` is not in
     range — the Sap projection has no past-due obligation, only reachable-and-clear,
     reachable-and-needy, or unreachable. */
  var KNOWN = "known", KNOWN_DUE = "known-due", UNREACHABLE = "unreachable";

  /* countNeedy(payload) — recompute needing-attention from the connector rows (L2).
     A connector is needy iff its verdict says it is not ready. Returns a Number, or
     null when there are no rows to fold (an unknown read has no count — never 0). */
  function countNeedy(payload) {
    var rows = (payload && Array.isArray(payload.connectors)) ? payload.connectors : null;
    if (!rows) return null;
    return rows.filter(function (c) { return c && c.ready === false; }).length;
  }

  /* glanceFrom(payload) — THE FOLD, and the home of L1.
   *
   *   payload : the parsed GET /sap body (sap-fold/v1), or NULL/garbage when the
   *             read failed, 401'd after a restart, timed out, or never ran.
   *
   * Returns:
   *   { read    : "ok" | "unknown"    -- did we actually reach the projection?
   *     state   : "known" | "known-due" | "unreachable"   -- the honest-badge state
   *     needy   : Number | null       -- connectors needing attention (OUR fold).
   *                                      NULL on an unknown read (L1) — never 0.
   *     reAuth   : [ String ]          -- connectors asking for re-auth (from the fold)
   *     served   : Number | null       -- the server's folded count, for the check
   *     agrees   : Boolean             -- server's count === ours?
   *     label    : String              -- a calm word for the badge (never a count) }
   */
  function glanceFrom(payload) {
    var p = (payload && typeof payload === "object") ? payload : null;

    // L1 — the gate. A projection that did not arrive (or a fold that reported an
    // explicit error) is the honest ring, never a fabricated clear.
    if (!p || p.ok === false || !Array.isArray(p.connectors) || p.schema !== "sap-fold/v1") {
      return { read: "unknown", state: UNREACHABLE, needy: null, reAuth: [],
               served: null, agrees: true, label: "unreachable" };
    }

    var needy = countNeedy(p);                          // OUR fold (L2)
    var reAuth = Array.isArray(p.re_auth_required) ? p.re_auth_required.slice() : [];
    var served = (typeof p.connectors_needing_attention === "number"
                  && isFinite(p.connectors_needing_attention))
      ? p.connectors_needing_attention : null;

    // A connector wanting re-auth is, by definition, needing attention — count it
    // even if the runtime's per-row `ready` flag lagged (belt and suspenders; the
    // re_auth list is the sharper signal for the amber call).
    var attention = Math.max(needy || 0, reAuth.length);
    var state = attention > 0 ? KNOWN_DUE : KNOWN;

    return {
      read: "ok",
      state: state,
      needy: needy,
      reAuth: reAuth,
      served: served,
      agrees: (served === null) ? false : (served === needy),
      label: state === KNOWN_DUE ? "needs you" : "clear"
    };
  }

  /* renderDot(doc, glance) -> the honest-badge node for this glance, or null.
     Delegates the whole render to honest-badge.js (skin, don't re-solve): the badge
     owns the H3 form (solid chip vs hollow ring) and the ink tokens; we hand it the
     honestly-chosen state + a calm label. Cold-safe: no document, no honestBadge, or
     a bad glance -> null, never an exception into the boot. */
  function renderDot(doc, glance) {
    var hb = root.ForestShell && root.ForestShell.honestBadge;
    if (!doc || !hb || typeof hb.render !== "function") return null;
    var g = (glance && typeof glance === "object") ? glance : glanceFrom(null);
    return hb.render(doc, g.state, { label: g.label });
  }

  /* fetchSap(fetchImpl, base) -> Promise<glance>
     Cold-safe by construction: EVERY failure path (no fetch, non-2xx, unparseable
     body, network refusal, a 401 after a restart) lands on glanceFrom(null), which
     is the honest `unreachable` ring — never a fabricated clear dot. The promise
     NEVER rejects, so a boot that wires this can never be broken by a dead runtime. */
  function fetchSap(fetchImpl, base) {
    var f = fetchImpl || (typeof root.fetch === "function" ? root.fetch.bind(root) : null);
    if (!f) return Promise.resolve(glanceFrom(null));
    var url = String(base == null ? "" : base) + "/sap";
    return f(url, { cache: "no-store", credentials: "include" })
      .then(function (r) {
        if (!r || !r.ok) return null;                   // 401 / 404 / 502 -> unreachable, not "clear"
        return r.json();
      })
      .then(function (body) { return glanceFrom(body); })
      .catch(function () { return glanceFrom(null); });  // the runtime is down -> unreachable, not "clear"
  }

  /* mount(opts) -> Promise<glance>. The boot reader (the runtime-version.js pattern):
     fetch /sap, fold it, and (re)place the honest dot into [data-forest-sap] in the
     top bar. Idempotent — replaces the slot's child in place, so a refresh never
     stacks dots. Cold-safe and HONEST in that order: no document, no slot, a dead
     runtime, a 401 after restart — every one renders the hollow ring (or leaves the
     slot untouched if there is no slot), NEVER a fabricated clear. opts._fetch is
     the injectable network seam (the test drives it); production uses window.fetch. */
  function mount(opts) {
    opts = opts || {};
    var doc = opts.doc || root.document;
    return fetchSap(opts._fetch, opts.base == null ? "" : opts.base).then(function (glance) {
      if (!doc || typeof doc.querySelector !== "function") return glance;
      var slot = opts.slot || doc.querySelector("[data-forest-sap]");
      if (!slot) return glance;
      var dot = renderDot(doc, glance);
      if (!dot) return glance;                            // no honest-badge grammar -> leave the slot as-is
      while (slot.firstChild) slot.removeChild(slot.firstChild);
      slot.appendChild(dot);
      // announce the state on the slot for assistive tech + the refresh signature
      if (typeof slot.setAttribute === "function") slot.setAttribute("data-sap-state", glance.state);
      return glance;
    });
  }

  root.ForestShell.sapGlance = {
    glanceFrom: glanceFrom,
    countNeedy: countNeedy,
    renderDot: renderDot,
    fetchSap: fetchSap,
    mount: mount,
    _version: "1.0"
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.ForestShell.sapGlance;
  }

  /* Auto-mount once the DOM is up, then refresh on a modest cadence (health wants to
     be current, but a glance dot is not a monitor — 30s is plenty). Guarded so tests
     (window with no document) and an explicit opt-out never fire it. */
  function noAuto() { return root.FOREST_NO_AUTO_SAP_GLANCE === true; }
  if (root.document && !noAuto()) {
    var kick = function () {
      mount();
      if (typeof root.setInterval === "function") root.setInterval(function () { mount(); }, 30000);
    };
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", kick);
    } else {
      kick();
    }
  }
})();
