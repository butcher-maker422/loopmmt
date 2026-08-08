/* Shea's Forest — the App Shell · shell/the-broom.js
   The Broom — delight #3 of the Seven (V6 · FWW(C) feature set).

   THE MOMENT. A bulk sweep completes — she selects a batch and archives it, and
   the work comes to rest. Unhurried follow-through: the swept selection settles
   with the same quiet mark the Clearing and the Rest draw. No confetti, no count,
   no praise — the batch is handled and the inbox is tidier.

   THE CO-FIRE RULE (JP-1 — one celebration per completion; the crux of #3). A
   sweep can end in two ways, and only ONE thing celebrates each:
     • the sweep empties the inbox (terminal count == 0) -> the CLEARING fires
       (inbox-zero) and ABSORBS the Broom's signature; the Broom is SILENT.
     • the sweep leaves the inbox non-empty (terminal count > 0) -> the BROOM
       fires ALONE — the swept batch came to rest, but the inbox is not "clear".
   So the Broom fires ONLY on a NON-ZERO-TERMINAL sweep. This is not a second
   policy bolted on: it falls out of the shared gate — the Broom silences on a
   real-zero terminal exactly where the Clearing fires, so the two can never
   double-fire on the same completion.

   WHAT IT IS (the wiring, not new machinery). The third and last consumer of the
   pieces the Clearing lit — reused, not forked:

     • completion-fire-gate.js (U3 · SC-2) — the honest-state SOURCE. The Broom
       reuses the gate's `coerce` (never invents "known") and `isRealZero` (a real
       terminal zero is the number 0, not null/"0"/NaN) so its honesty is the same
       honesty the Clearing and Rest run on. No false sweep-complete on
       `unreachable`: an unverified terminal state silences the Broom.

     • completion-settle.js (JT-2 · block^3) — the shared settle primitive, drawn
       at RECORD scale (a compact coda) with the swept word, so the confirmation
       is calm and small — it sits by the just-swept selection, it does not take
       the pane (the inbox still has mail; a view-scale settle would lie about
       that).

   THE FELT LAW (SM-5, carried verbatim): "unhurried follow-through." The settle
   faces the WORK (the swept batch), never the worker — the word "Swept" is a fact
   about the selection, not a "Great job." A count can never be the word (the
   primitive rejects it).

   THE OTHER LAWS IT INHERITS:
     SC-2 — fires iff coerce(state)==="known" AND a real, non-zero terminal AND a
            real sweep happened; silence otherwise (never a false "swept" on an
            unverified or empty-inbox terminal).
     SC-7 — the egress floor: ZERO network calls. delight-egress-guard covers it.
     Constraint 2 — calm, not casino (no motion, no payout; inherited from settle).

   SEPARATION (mirrors the Clearing/Rest). The Broom does not read the mailbox — it
   is HANDED the honest (state, terminalCount, sweptCount) by its host (mail-renderer,
   which knows all three at the moment the batch resolves). No count source, no
   network — only the gate and the settle.

   Plain script (no ES module, no deps) — attaches to window.ForestShell.theBroom.
   Cold-safe throughout. Depends on window.ForestShell.completionFireGate +
   window.ForestShell.completionSettle. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  /* the honest coercion + real-zero test, reused from the shipped gate so the
     Broom's honesty IS the Clearing's honesty (never a second predicate). Cold-safe:
     no gate loaded -> honest-absent ("unreachable"), never an invented "known". */
  function coerce(state) {
    var g = root.completionFireGate;
    if (g && typeof g.coerce === "function") return g.coerce(state);
    return "unreachable";
  }
  function isRealZero(count) {
    var g = root.completionFireGate;
    if (g && typeof g.isRealZero === "function") return g.isRealZero(count);
    return typeof count === "number" && isFinite(count) && count === 0;
  }
  function isRealPositive(count) {
    return typeof count === "number" && isFinite(count) && count > 0;
  }

  /* EVALUATE — the Broom decision, with the co-fire rule built in.
       evaluate(state, terminalCount, sweptCount) -> { fire, reachable, reason }
     fire === true IFF:
       coerce(state) === "known"                (verified terminal state; R5/R9)
       AND isRealPositive(sweptCount)           (a real sweep happened)
       AND isRealPositive(terminalCount)        (NON-ZERO terminal — inbox not empty)
     The co-fire absorption is the real-zero branch: a real-zero terminal returns
     fire:false, reason "co-fire-clearing-owns-zero" — the Clearing fires there, so
     the Broom yields (JP-1). reachable is false only for an unreachable state. */
  function evaluate(state, terminalCount, sweptCount) {
    var s = coerce(state);
    var reachable = (s !== "unreachable");
    if (!reachable) return { fire: false, reachable: false, reason: "unreachable" };
    if (!isRealPositive(sweptCount)) return { fire: false, reachable: true, reason: "nothing-swept" };
    if (isRealZero(terminalCount)) return { fire: false, reachable: true, reason: "co-fire-clearing-owns-zero" };
    if (!isRealPositive(terminalCount)) return { fire: false, reachable: true, reason: "terminal-count-unknown" };
    return { fire: (s === "known"), reachable: true, reason: (s === "known" ? "swept-nonzero-terminal" : "state-not-clear") };
  }

  /* RENDER — the settle node on a real fire, else null (silence).
       render(doc, state, terminalCount, sweptCount, opts) -> Node | null
     fire (verified non-zero-terminal sweep) -> the completion-settle at RECORD
       scale, with the swept word (SM-5, faces the batch). anything else -> null.
     Cold-safe: no document / settle not loaded -> null; never throws. */
  var SWEPT_WORD = "Swept";
  var SWEPT_ARIA = "Selection swept";
  function render(doc, state, terminalCount, sweptCount, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    var decision = evaluate(state, terminalCount, sweptCount);
    if (!decision.fire) return null;                   // SC-2 / co-fire: silence

    var cs = root.completionSettle;
    if (!cs || typeof cs.render !== "function") return null;   // cold-safe

    // record-scale compact coda, worded for a sweep (faces the batch, SM-5). A
    // caller may override; a count word is rejected by the primitive.
    var o = { word: SWEPT_WORD, aria: SWEPT_ARIA };
    if (opts) for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
    return cs.render(doc, "record", o);
  }

  /* MOUNT — the one host affordance (mirrors the Clearing/Rest). Idempotent: owns a
     single data-broom child of the host; on not-fire removes any stale one (so a
     re-open / undo that changes the terminal picture retracts honestly).
       mount(hostEl, { state, terminalCount, sweptCount, opts }) -> Node | null
     Cold-safe: no host / no document -> null; never throws. */
  function mount(hostEl, ctx) {
    if (!hostEl || typeof hostEl.querySelector !== "function") return null;
    ctx = ctx || {};
    var doc = hostEl.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return null;

    var prior = hostEl.querySelector('[data-broom="1"]');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    var node = render(doc, ctx.state, ctx.terminalCount, ctx.sweptCount, ctx.opts);
    if (!node) return null;

    node.setAttribute("data-broom", "1");
    hostEl.appendChild(node);
    return node;
  }

  root.theBroom = {
    evaluate: evaluate,
    render: render,
    mount: mount,
    _version: "1.0"
  };
})();
