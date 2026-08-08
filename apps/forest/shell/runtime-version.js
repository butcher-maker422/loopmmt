/* Shea's Forest — the App Shell · shell/runtime-version.js ·
   ----------------------------------------------------------------------------
   THE HOLE. Every version number this UI has ever shown — FOREST_SHELL_VERSION in
   the top bar; the per-app stamp under each pane name is DERIVED from the renderer
   module's own `_version` (pane.js appVersion,) — is published by the
   STATIC deploy (version.js). A RUNTIME deploy ships forest-runtime.js and its
   closure to a different repo and does not touch version.js at all. So a runtime
   push moved NOTHING a browser could see. On 2026-07-12 three real runtime changes
   went to the box — the K1 validatorError redaction, the calendar FTS outage lock,
   and the owed-412 death posture — and every number in this interface stayed put.

   The operator's own convention is that a visible number confirms the
   current code is the one that's live. It had no runtime half. This is the runtime
   half: one fetch of GET /api/version, whose payload comes from the deploy marker
   the box already had on disk beside the daemon.

   WHY NOT /status. /status carries owner_set and is loopback-only for that reason
   (owed 652 — and it cannot simply be exposed without trimming the payload AND a
   box paste, which is blocked behind owed 536). /api/version rides the nginx
   `location /api/` block that ALREADY exists, so this needed no box access at all.

   COLD-SAFE AND HONEST, in that order. No fetch, a 401, an offline box, a garbage
   body — every one of them leaves the tooltip EXACTLY as it read before this file
   existed. We never paint a commit we do not have. A version display that guesses
   is strictly worse than none: it is /health returning 200 on a dead Forest, one
   layer up, and this line keeps meeting that shape.
   ============================================================================ */
(function () {
  "use strict";
  var root = (typeof window !== "undefined" ? window : this);
  root.ForestShell = root.ForestShell || {};

  /* Re-stamp any viewer-version element already painted. The tabstrip's render()
     short-circuits on an unchanged signature, and runtimeLabel() now rides that
     signature — but a live element may still predate the fetch, so we also stamp
     in place. Belt and braces, both idempotent. */
  function apply(doc) {
    var ta = root.ForestShell && root.ForestShell.tabstripActions;
    if (!ta || typeof ta.stampRuntime !== "function") return 0;
    var d = doc || root.document;
    if (!d || typeof d.querySelectorAll !== "function") return 0;
    // : the stamp moved from the actions cluster (.tsa-ver) to the brand slot
    // (.app-ver, under the Loop World wordmark). BOTH selectors are queried so a late
    // /api/version arrival re-stamps whichever seat the shell is running -- and so this
    // reader needs no coordinated deploy with tabstrip-actions.js.
    var els = d.querySelectorAll(".tsa-ver, .app-ver");
    for (var i = 0; i < els.length; i++) ta.stampRuntime(els[i]);
    return els.length;
  }

  /* opts._fetch is the injectable network seam (the test drives it; production uses
     window.fetch). Resolves to the payload, or null on ANY failure — never throws,
     never rejects. This route is instrumentation: it must never be the thing that
     breaks the Forest. That is the lesson applied to its own telemetry. */
  function load(opts) {
    opts = opts || {};
    var doc = opts.doc || root.document;
    var f = opts._fetch || (typeof root.fetch === "function" ? root.fetch.bind(root) : null);
    if (!f) return Promise.resolve(null);

    return Promise.resolve()
      .then(function () { return f("/api/version", { credentials: "same-origin" }); })
      .then(function (r) {
        if (!r || r.ok !== true) return null;              // 401 before sign-in is NORMAL, not an error
        return r.json();
      })
      .then(function (j) {
        if (!j || typeof j !== "object" || j.ok !== true) return null;
        root.FOREST_RUNTIME_VERSION = j;
        apply(doc);
        return j;
      })
      .catch(function () { return null; });                // offline / torn body / anything: stay silent
  }

  root.ForestShell.runtimeVersion = {
    load: load,
    apply: apply,
    _version: "1.0"
  };

  /* Auto-load once the DOM is up. Deferred script + this guard covers both orders. */
  if (root.document && !opts_noAuto()) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", function () { load(); });
    } else {
      load();
    }
  }
  function opts_noAuto() { return root.FOREST_NO_AUTO_RUNTIME_VERSION === true; }
})();
