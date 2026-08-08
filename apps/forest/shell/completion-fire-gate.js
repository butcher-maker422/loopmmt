/* Shea's Forest — the App Shell · shell/completion-fire-gate.js
   U3 · SC-2 — the HONEST-STATE COMPLETION FIRE-GATE (V6 SC-2 / JT-5 · kills R5+R9).

   WHAT THIS IS. The single predicate the completion delights (Clearing, Rest,
   Broom-at-zero) and the Launch's phase-two "landed" beat call BEFORE they fire.
   It exists so a celebration ("all clear!", "landed!") can only happen on a state
   we actually VERIFIED — never on a hopeful read, a stale green, or an
   absence-of-bad-news that merely looks clear.

   THE TWO RUSTS IT KILLS (turned from ASSERTED into ENFORCED, and TRACE-checked):

     R9 · enforcement-command-not-read-path-weld — "a stale-state read is forbidden
       only if the re-check is WELDED into the read path; a runnable checker the
       read never invokes leaves the stale read reachable." KILL: the honesty
       re-check (honestBadge.coerce) is welded INTO the fire predicate itself —
       `fire` is computed FROM the coerced state, in the same expression. There is
       no fire path that does not run the re-check first; a caller cannot reach a
       fire decision without the coerce having happened. The checker is not a
       separate command you must remember to run — it is the gate.

     R5 · unreconstructable-reads-blessed — "'cannot run' is a distinct state from
       'passed'; an artifact that cannot be reconstructed is recorded healthy
       because 'no failure' is conflated with 'pass'." KILL: the gate's outcome
       vocabulary NAMES a distinct cannot-reach state — `unreachable` — for the
       UNRECONSTRUCTABLE read (sync down, absent, or an illegal/unknown state).
       That read is NEVER blessed as "clear": an `unreachable` state SILENCES the
       celebration even when the count is a real zero (the state-lie guard — no
       false "all clear" while the truth is out of reach). And `fire` is gated on a
       POSITIVE verified condition (`known` AND real-zero), never on the ABSENCE of
       a failure signal — so there is no "not-failed -> fire" fall-through for the
       disease to relocate behind.

   THE SEAMS IT BINDS TO (read-only, both shipped + enforced):
     • honest-badge.js `coerce()` (H3: never a stale value dressed as fresh; you
       cannot coerce your way to `known`) — the completion gate's honesty source.
     • the send path's `res.ok` confirm (mail-renderer.js: "never invents
       unconfirmed state") — the Launch gate's honesty source; on the `#523`
       send-timeout, `res` is absent / not-ok, so the beat shows honest uncertainty.

   Plain script (no ES module, no deps) — attaches to window.ForestShell.completionFireGate.
   Cold-safe: honest-degrade if honest-badge is not loaded (never invents `known`). */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  /* The welded honesty re-check. Delegates to the shipped honestBadge.coerce
     (read-only). If honest-badge is NOT loaded, the ONLY safe coercion is the
     honest-absent state — NEVER invent `known` out of nothing (Real-or-Made,
     mirroring coerce()'s own fallback). So a missing honesty module degrades to
     "cannot reach the truth", never to a false "clear". */
  function coerce(state) {
    var hb = root.honestBadge;
    if (hb && typeof hb.coerce === "function") return hb.coerce(state);
    return "unreachable";
  }

  /* A real zero is the NUMBER 0 — not null/undefined (unknown count), not "0"
     (a string that never came from a real count), not NaN. An unknown count can
     never manufacture an "all clear" (absence-of-signal is not success). */
  function isRealZero(count) {
    return typeof count === "number" && isFinite(count) && count === 0;
  }

  /* THE COMPLETION FIRE-GATE.
     completionFireGate(state, count) ->
       { fire, reachable, state, reason }
     fire === true  IFF  coerce(state) === "known"  AND  count is a real zero.
     Everything else silences with an honest reason. Critically, an `unreachable`
     coercion silences EVEN at count 0 — the state-lie guard (R5).
       reachable — did we reach the truth at all? false only for `unreachable`.
                   (Lets the delight show the honest RING instead of nothing —
                   the distinct cannot-reach state, not a silent "cleared".)
       state     — the coerced honest-badge state (the delight renders from it).
       reason    — clear-zero | unreachable | count-not-zero-or-unknown | state-not-clear */
  function completionFireGate(state, count) {
    var s = coerce(state);                              // <- welded re-check (R9)
    var reachable = (s !== "unreachable");
    var realZero = isRealZero(count);
    var fire = (s === "known" && realZero);            // POSITIVE verified condition only (R5)
    var reason = fire ? "clear-zero"
               : (!reachable ? "unreachable"           // unreconstructable read — never blessed (R5)
               : (!realZero ? "count-not-zero-or-unknown"
               : "state-not-clear"));                  // known-due / overdue: reached, but not clear
    return { fire: fire, reachable: reachable, state: s, reason: reason };
  }

  /* THE LAUNCH "LANDED" GATE (phase two of the Launch delight).
     launchLandedGate(res) -> { fire, reachable, state, reason }
     fire === true IFF res && res.ok === true (the send path's confirmed result).
     On a #523 send-timeout, `res` is absent or not-ok -> honest uncertainty (the
     ring form, state `unreachable`), NEVER a fabricated "landed". `res.ok` must be
     STRICTLY true (not a truthy coercion) — the confirm is the truth, welded into
     the fire (R9); the timeout is the distinct cannot-confirm state (R5).
     state is a fixed honest-badge-vocabulary literal the delight renders from. */
  function launchLandedGate(res) {
    var confirmed = !!(res && res.ok === true);        // <- welded confirm (R9)
    return {
      fire: confirmed,
      reachable: confirmed,
      state: confirmed ? "known" : "unreachable",      // known == landed (solid); else ring (R5)
      reason: confirmed ? "res-ok-confirmed" : "unconfirmed-or-timeout"
    };
  }

  root.completionFireGate = {
    completionFireGate: completionFireGate,
    launchLandedGate: launchLandedGate,
    coerce: coerce,
    isRealZero: isRealZero,
    _version: "1.0"
  };
})();
