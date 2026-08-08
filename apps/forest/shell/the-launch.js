/* the-launch.js — Delight #2 of the Seven Delights (FWW(C) feature set).
   Auto-covered by delight-egress-guard.test.js (SC-7); unit test the-launch.test.js.

   THE LAUNCH — the two-phase send gesture (V6 partition #2).
     Trigger  : a message on the send path (mail-renderer composeView -> doSend).
     Felt (SM-4): TWO true beats over one gesture. Beat one = the message LEFT
                (in flight — honest, matches the shipped "Sending…" present-progressive,
                claims departure never arrival). Beat two = it LANDED (delivered —
                bound to the API-confirmed send). Calm, not casino (constraint 2 / SM-3):
                a quiet voice, one line per beat — no confetti, no badge, no payout.
     Form (JT-5): ONE gesture, TWO phases, `#523`-gated between. Built from the one
                shared el / Block Alphabet : a `.record` card holding a single
                `.line` voice. No head, no body rows. The phase is passed IN — the module
                renders the beat it is told, it cannot self-advance.
     Security (SC-2): phase two ("landed") binds to the send path's shipped `res.ok`
                discipline BY CONSTRUCTION — render() cannot reach "landed" on its own;
                only doSend, inside its `res.ok` branch, passes phase="landed". On the
                `#523` send-timeout the caller passes phase="waiting" (honest uncertainty),
                NEVER a fabricated "landed" (Real-or-Made, constraint 1). The `res.ok`
                gate IS the enforcement — reused, not re-invented.
                (SC-7): zero network calls — not on the egress allowlist, so the derived
                guard auto-covers this file the moment it would reach out.

   Plain script (no ES module, no deps) — attaches to window.ForestShell.launch.
   Cold-safe throughout: no document / no alphabet -> null, never throws. No network,
   no store, no message content (it renders a phase word, never the draft). Depends
   only on window.ForestShell.block.el. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  /* The STATIC beat set — the ONLY strings this module can render, keyed by PHASE.
     No message content, no recipient, no interpolation ever reaches here (the draft
     never crosses into the delight — the caller passes a phase word, nothing more).
       leaving : beat one — the message is in flight. Honest in-flight voice; claims
                 departure ("on its way"), never arrival — it does not yet know it
                 landed, and says so by not saying "landed."
       landed  : beat two — API-confirmed delivery. Reachable ONLY when doSend passes
                 phase="landed" from inside its res.ok branch (SC-2, by construction).
       waiting : the #523 send-timeout voice — we have not heard back. Honest
                 uncertainty; NEVER a fabricated "landed" (Real-or-Made). */
  var BEATS = {
    leaving: "On its way\u2026",
    landed:  "Delivered \u2014 it reached them.",
    waiting: "Still on its way \u2014 no word back yet."
  };

  /* the phase-name -> line__value modifier, so a skin can style the three beats
     distinctly (a quiet lift on "landed", a held breath on "waiting") without the
     module ever deciding tone — the class is derived from the phase, nothing else. */
  var PHASE_CLS = { leaving: "is-leaving", landed: "is-landed", waiting: "is-waiting" };

  /* beat(phase) — PURE. The static line for a phase; an unknown/absent phase falls
     back to the honest in-flight voice (never to "landed" — the safe default is the
     one that claims the least). Testable in isolation, no DOM. */
  function beat(phase) {
    return Object.prototype.hasOwnProperty.call(BEATS, phase) ? BEATS[phase] : BEATS.leaving;
  }

  /* render(doc, phase, opts) -> the Launch's Node | null.
       phase: "leaving" | "landed" | "waiting" (see BEATS). Passed IN by doSend; the
         module cannot self-advance to "landed" — that is the SC-2 structural gate.
     JT-5: a `.record` card holding one `.line` voice for the current beat. Calm — one
     quiet line, no drawing. Cold-safe. */
  function render(doc, phase, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;   // cold-safe
    var block = root.block;
    if (!block || typeof block.el !== "function") return null;          // cold-safe: alphabet not loaded
    var el = block.el;

    var line = beat(phase);
    var cls = PHASE_CLS[phase] || PHASE_CLS.leaving;

    var card = el(doc, "div", "launch record", { role: "status", "aria-live": "polite", "aria-label": "Send status" });
    var voice = el(doc, "div", "launch__voice line line--quiet");
    voice.appendChild(el(doc, "span", "launch__value line__value " + cls, { text: line }));
    card.appendChild(voice);
    return card;
  }

  root.launch = {
    beat: beat,
    render: render
  };
})();
