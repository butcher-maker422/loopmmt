/* Shea's Forest — the App Shell · shell/the-clearing.js
   The Clearing — delight #1 of the Seven (V6 · FWW(C) feature set).

   THE MOMENT. Her inbox reaches zero. The list resolves into a quiet clearing —
   a still, soft arrival, no confetti, no count, no praise. This is the client's
   most load-bearing moment (Jamie's eye at her inbox, 11pm, tired): the app's one
   job here is to be calm and honest.

   WHAT IT IS (the wiring, not new machinery). The Clearing is the THIN render that
   binds two shipped/built pieces:

     • completion-fire-gate.js (U3 · SC-2) — the honest-state predicate. The
       Clearing fires ONLY on a VERIFIED known-zero. If the sync is down / the
       count is unknown / the state can't be reached, the gate returns
       fire:false — and the Clearing renders NOTHING (silence), never a false
       "all clear" over an inbox it couldn't actually verify. This is SC-2's
       state-lie guard made the Clearing's behaviour: silence on `unreachable`.

     • completion-settle.js (JT-2 · block^3) — the shared settle primitive. On a
       real fire, the Clearing draws the settle at VIEW scale. The Rest reuses the
       same primitive at record scale; the Broom-at-zero flows into this same
       fire+settle (JP-1 co-fire) — which is why building the Clearing first was
       the highest-leverage render: it lit the shared primitive.

   THE FOUR LAWS IT INHERITS:
     SM-3 — states nothing, counts nothing (the settle carries no number; the
            Clearing passes it none).
     SC-2 — fires iff coerce(state)==="known" AND a real zero; silence otherwise.
     SC-7 — the egress floor: this module makes ZERO network calls (it is pure
            gate-delegation + render). The delight layer phones home about nothing;
            delight-egress-guard.test.js is the standing proof over the whole layer.
     Constraint 2 — calm, not casino (no motion, no payout; inherited from settle).

   SEPARATION. The Clearing does not read the mailbox itself — it is HANDED the
   honest (state, count) by its host (the mail view, which knows both). So the
   render has no path to invent a completion: no count source, no network, only
   the gate and the settle. `mount()` is the one host affordance — idempotent,
   cold-safe — so wiring the mail view to it is a single call, not a tangle.

   Plain script (no ES module, no deps) — attaches to window.ForestShell.theClearing.
   Cold-safe throughout. Depends on window.ForestShell.completionFireGate +
   window.ForestShell.completionSettle. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  /* EVALUATE — the honest-state decision, delegated whole to the shipped gate.
     Returns { fire, reachable, state, reason } (see completion-fire-gate.js).
     Cold-safe: if the gate is not loaded, degrade to the honest-absent verdict —
     NEVER invent a fire (Real-or-Made; mirrors the gate's own coerce fallback). */
  function evaluate(state, count) {
    var g = root.completionFireGate;
    if (g && typeof g.completionFireGate === "function") {
      return g.completionFireGate(state, count);
    }
    return { fire: false, reachable: false, state: "unreachable", reason: "gate-not-loaded" };
  }

  /* RENDER — the settle node on a real fire, else null (silence).
       render(doc, state, count, opts) -> Node | null
     fire (verified known-zero) -> the completion-settle at VIEW scale.
     anything else               -> null. The Clearing shows NOTHING rather than a
                                    comforting lie (SC-2 silence-on-unreachable).
     opts is passed through to the settle (e.g. {word:""} for the mark-only form).
     Cold-safe: no document / settle not loaded -> null; never throws. */
  function render(doc, state, count, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    var decision = evaluate(state, count);
    if (!decision.fire) return null;                 // SC-2: silence, never a false clear

    var cs = root.completionSettle;
    if (!cs || typeof cs.render !== "function") return null;   // cold-safe

    // SM-3 — The Clearing STATES NOTHING (counts nothing): by default it is the
    // mark-only settle. The soft mark + the cleared space carry the arrival (the
    // Higgins ideal — communicates without text); the settle's aria-label still
    // announces the honest state for a screen reader. The primitive keeps the word
    // capability for The Rest — only The Clearing defaults it off. A caller may
    // still pass an explicit word to override (rare).
    var o = {};
    if (opts) for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
    if (o.word === undefined) o.word = "";           // states nothing (SM-3)
    return cs.render(doc, "view", o);
  }

  /* MOUNT — the one host affordance. Idempotent: it owns a single settle child of
     the pane (marked data-clearing), so calling it repeatedly with the same state
     is a no-op paint, and a state change flips it cleanly.
       mount(paneEl, { state, count, opts }) -> the settle Node | null
     On a real fire: ensure exactly one Clearing settle is present in the pane.
     On not-fire: ensure NO Clearing settle is present (remove a stale one — so an
     inbox that fills back up above zero, or a sync that drops to `unreachable`,
     retracts the clearing honestly rather than leaving a stale "all clear").
     Cold-safe: no pane / no document -> null; never throws. */
  function mount(paneEl, ctx) {
    if (!paneEl || typeof paneEl.querySelector !== "function") return null;
    ctx = ctx || {};
    var doc = paneEl.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return null;

    // remove any prior Clearing settle (idempotent / honest retraction)
    var prior = paneEl.querySelector('[data-clearing="1"]');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    var node = render(doc, ctx.state, ctx.count, ctx.opts);
    if (!node) return null;                          // not-fire -> silence (prior already removed)

    node.setAttribute("data-clearing", "1");         // the single-child marker mount owns
    paneEl.appendChild(node);
    return node;
  }

  root.theClearing = {
    evaluate: evaluate,
    render: render,
    mount: mount,
    _version: "1.0"
  };
})();
