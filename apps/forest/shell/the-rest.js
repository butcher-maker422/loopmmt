/* Shea's Forest — the App Shell · shell/the-rest.js
   The Rest — delight #7 of the Seven (V6 · FWW(C) feature set).

   THE MOMENT. A long conversation is finished — every message in the thread is
   read. The read-through comes to rest: the same quiet settle the Clearing draws
   at inbox-zero, now at RECORD scale, at the foot of the conversation you just
   read to the end. No confetti, no count, no praise. The thread is handled.

   WHAT IT IS (the wiring, not new machinery). The Rest is the THIN render that
   binds the two pieces The Clearing already lit — reused, not forked:

     • completion-fire-gate.js (U3 · SC-2) — the honest-state predicate. The Rest
       fires ONLY on a VERIFIED all-messages-read: coerce(state)==="known" AND a
       real zero unread. If any message's read-state is unknowable, or the sync is
       down, the gate returns fire:false and The Rest renders NOTHING (silence),
       never a false "done" over a thread it couldn't actually verify. Same
       state-lie guard as the Clearing, pointed at ONE thread's read-count.

     • completion-settle.js (JT-2 · block^3) — the shared settle primitive, drawn
       here at RECORD scale (the Clearing draws it at VIEW scale). Building the
       Clearing first is why this is a ~lay-up: the primitive already exists;
       The Rest is the second consumer, at the sibling scale.

   THE FELT LAW (SM-7, carried verbatim from the plan): "about the thread, never
   to the reader." The settle keeps the primitive's record default word "Read"
   (the state of the THREAD — it has been read), aria "Thread read." That faces
   the work (SM-0), not the worker: it is a fact about the conversation, never a
   "Great job." A bare number can never be the word (the primitive rejects counts
   by construction). Only a LONG thread earns it — the settle is for finishing a
   conversation, so the host fires it on count > 1 (see mail-renderer's
   appendThreadRecord); a lone message is not a thread finished.

   THE OTHER LAWS IT INHERITS:
     SC-2 — fires iff coerce(state)==="known" AND unread is a real zero; silence
            on unreachable EVEN at zero (never a false "done" on an unverified
            thread). Delegated whole to the shipped gate — no second predicate.
     SC-7 — the egress floor: this module makes ZERO network calls (pure
            gate-delegation + render). delight-egress-guard.test.js auto-covers it.
     Constraint 2 — calm, not casino (no motion, no payout; inherited from settle).

   SEPARATION (mirrors the Clearing). The Rest does not read the mailbox. It is
   HANDED the honest (state, count) by its host, so the render has no path to
   invent a completion — no count source, no network, only the gate and the
   settle. `threadState(rec)` is offered as a PURE convenience for a host that has
   a thread record in hand: it derives the honest (state, count) DETERMINISTICALLY
   from the record's own messages (no I/O), so the honesty rule lives in one place
   and the host just forwards it to the gate.

   Plain script (no ES module, no deps) — attaches to window.ForestShell.theRest.
   Cold-safe throughout. Depends on window.ForestShell.completionFireGate +
   window.ForestShell.completionSettle. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  /* THREAD-STATE — the honest (state, count) for one thread record, PURE.
       threadState(rec) -> { state, count }
     Reads only the record's own `messages[]` — no network, no store. The honesty
     rule (mirrors the row render's `m.unread === true` binding — a null read-state
     is UNKNOWABLE, never dressed as read/unread):
       • every message has a DETERMINATE read-state (unread is true or false)
           -> state "known", count = number still unread (fire iff that is 0).
       • ANY message's read-state is unknowable (unread == null/undefined)
           -> state "unreachable": completion cannot be verified, so the gate
              silences and The Rest never claims a false "done".
     A record with no messages -> unreachable (nothing to verify). This is the ONE
     place thread-completion is judged; the gate does the fire/silence from it. */
  function threadState(rec) {
    var msgs = rec && rec.messages;
    if (!msgs || typeof msgs.length !== "number" || msgs.length === 0) {
      return { state: "unreachable", count: null };   // nothing to verify -> never a false done
    }
    var unread = 0;
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i] || {};
      if (m.unread === true) { unread++; continue; }
      if (m.unread === false) { continue; }
      return { state: "unreachable", count: null };    // an unknowable member -> not verifiable
    }
    return { state: "known", count: unread };          // all determinate -> fire iff unread === 0
  }

  /* EVALUATE — the honest-state decision, delegated whole to the shipped gate.
     Returns { fire, reachable, state, reason } (see completion-fire-gate.js).
     Cold-safe: gate not loaded -> the honest-absent verdict, NEVER an invented
     fire (Real-or-Made; mirrors the Clearing's own fallback). */
  function evaluate(state, count) {
    var g = root.completionFireGate;
    if (g && typeof g.completionFireGate === "function") {
      return g.completionFireGate(state, count);
    }
    return { fire: false, reachable: false, state: "unreachable", reason: "gate-not-loaded" };
  }

  /* RENDER — the settle node on a real fire, else null (silence).
       render(doc, state, count, opts) -> Node | null
     fire (verified all-read) -> the completion-settle at RECORD scale (default
                                 word "Read"; SM-7 keeps the caption — it faces the
                                 thread). anything else -> null (SC-2 silence).
     opts is passed through to the settle (a caller may override the word, rare).
     Cold-safe: no document / settle not loaded -> null; never throws. */
  function render(doc, state, count, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    var decision = evaluate(state, count);
    if (!decision.fire) return null;                   // SC-2: silence, never a false done

    var cs = root.completionSettle;
    if (!cs || typeof cs.render !== "function") return null;   // cold-safe

    // Unlike the Clearing (SM-3, mark-only), The Rest keeps the record default
    // word "Read" — SM-7 faces the thread, and "Read" is a fact about the thread,
    // not praise to the reader. A caller may still override; a count is rejected
    // by the primitive.
    return cs.render(doc, "record", opts || {});
  }

  /* MOUNT — the one host affordance, mirroring the Clearing's mount so a host that
     PERSISTS its container (rather than fully re-painting) gets idempotence +
     honest retraction for free.
       mount(hostEl, { state, count, opts }) -> the settle Node | null
     On a real fire: ensure exactly one Rest settle (data-rest="1") is present in
     the host. On not-fire: ensure NONE is present (remove a stale one — so a
     thread whose member is later marked UNREAD retracts the "read" settle honestly
     instead of leaving a false "done"). Cold-safe: no host / no document -> null.
     (mail-renderer's list re-paints wholesale, so its wiring can also just append
     render()'s node; mount is here for persistent hosts + test parity.) */
  function mount(hostEl, ctx) {
    if (!hostEl || typeof hostEl.querySelector !== "function") return null;
    ctx = ctx || {};
    var doc = hostEl.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return null;

    var prior = hostEl.querySelector('[data-rest="1"]');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    var node = render(doc, ctx.state, ctx.count, ctx.opts);
    if (!node) return null;                            // not-fire -> silence (prior already removed)

    node.setAttribute("data-rest", "1");               // the single-child marker mount owns
    hostEl.appendChild(node);
    return node;
  }

  root.theRest = {
    threadState: threadState,
    evaluate: evaluate,
    render: render,
    mount: mount,
    _version: "1.0"
  };
})();
