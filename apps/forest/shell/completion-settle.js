/* Shea's Forest — the App Shell · shell/completion-settle.js
   JT-2 · block^3 — the COMPLETION-SETTLE primitive (V6 · The Seven Delights).

   WHAT THIS IS. The single, shared render primitive for the completion cluster —
   the quiet visual that a bounded surface has come to rest. It is built ONCE here
   and reused at two scales by three delights:

     • The Clearing (view-scale)  — the whole inbox reached zero.
     • The Rest      (record-scale)— a long thread finished.
     • The Broom-at-zero          — a sweep that reached zero flows into the
                                     Clearing's settle (co-fire; JP-1).

   That reuse is the point: JT-2 named it "the completion-settle primitive at
   view-scale," and the Jointer's block^3 finding is that Clearing<->Rest share
   ONE primitive across scales. Building it here is why The Clearing was the
   highest-leverage first render — one primitive, three delights.

   THE THREE LAWS IT IS DRAWN UNDER (from the feature-set plan, carried verbatim):

     SM-3 (the felt) — STATES NOTHING, COUNTS NOTHING. No praise ("Great job!"),
       no tally ("47 cleared!"), no streak. It faces the WORK (SM-0: the state of
       her inbox), never the worker. A bare number as the word is REJECTED (Theo's
       rule, mirroring honest-badge.render): the settle never wears a count.

     Constraint 2 (calm, not casino) — no confetti, no badge, no slot-payout. A
       still, soft arrival. No motion here (Chaos/JT-7 is a separate, deferred
       axis); a settle that animates a payout is the casino this forbids.

     JT-0 (one alphabet) — every visible piece is a WORD of the Block Alphabet
       , built by the ONE shared el from block.js and spelled in the
       token-keyed .settle classes (block.css). No raw hex, no bespoke skin — the
       Ink Law holds by construction (the colors live in tokens.css, not here).

   HIGGINS. With the word stripped, the settle still reads as "at rest": the mark
   (`.settle__mark`) carries the arrival, the word is a quiet caption. Pass
   word:"" for the mark-only, text-free form (the Higgins Test at view-scale).

   NOTE ON HONEST STATE. This primitive is the RENDER only — it does not decide
   WHETHER to fire. The honest-state decision (fire iff a VERIFIED known-zero,
   silence on `unreachable`) belongs to completion-fire-gate.js (SC-2), which the
   delights call before reaching this render. Keeping the gate and the render in
   separate modules is deliberate: the render can never manufacture a completion,
   because it has no path to a count or a sync-state — it only draws the settle it
   is told to draw.

   Plain script (no ES module, no deps) — attaches to
   window.ForestShell.completionSettle. Cold-safe: no document / bad input -> null,
   never an exception into the boot. Depends on window.ForestShell.block.el. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  /* The two legal scales. `view` = a whole surface at rest (the Clearing);
     `record` = a single record at rest (the Rest). Anything else coerces to
     `view` (the safe, most-general scale) — never throws. */
  var SCALES = { "view": 1, "record": 1 };

  /* The calm default caption per scale — a word about the WORK (the inbox / the
     thread), never about the worker, never a count. Callers may override with
     their own calm word, or pass "" for the mark-only Higgins form. */
  var DEFAULT_WORD = { "view": "Clear", "record": "Read" };

  /* The calm default announcement per scale — what an assistive reader hears
     once, politely. Faces the work; carries no number. */
  var DEFAULT_ARIA = { "view": "Inbox clear", "record": "Thread read" };

  function scaleOf(scope) {
    return (typeof scope === "string" && Object.prototype.hasOwnProperty.call(SCALES, scope))
      ? scope : "view";
  }

  /* A bare number can never be the settle's word (Theo's rule: no count). Mirror
     honest-badge.render's exact guard so the two components reject counts the same
     way. An empty string is a legal, deliberate choice (mark-only). */
  function wordIsACount(w) {
    return /^\s*\d[\d.,\s]*$/.test(w);
  }

  /* The settle SPEC — pure, DOM-free, the single source of truth for both the DOM
     render and the test's assertions. `word === ""` means mark-only.
       opts.word — override the calm caption (a bare-number word is ignored -> the
                   scale default is used instead; "" is honored as mark-only).
       opts.aria — override the calm announcement (never forced to a number). */
  function specFor(scope, opts) {
    opts = opts || {};
    var scale = scaleOf(scope);

    var word = DEFAULT_WORD[scale];
    if (typeof opts.word === "string" && !wordIsACount(opts.word)) {
      word = opts.word;                              // "" honored (mark-only); a count rejected above
    }

    var aria = DEFAULT_ARIA[scale];
    if (typeof opts.aria === "string" && opts.aria && !wordIsACount(opts.aria)) {
      aria = opts.aria;
    }

    return {
      scale: scale,
      word: word,                                    // "" -> mark-only
      hasWord: word !== "",
      aria: aria
    };
  }

  /* THE RENDER. Returns a <div class="settle settle--<scale>"> built from the one
     Block Alphabet el(). Structure:
        .settle.settle--<scale>            (role=status, polite live region,
                                            announced ONCE, calmly)
          .settle__mark                    (the soft arrival mark — the Higgins
                                            carrier; a text-free node)
          .settle__word                    (the quiet caption; omitted when word "")
     No count node exists anywhere in the tree (SM-3, by construction). Cold-safe:
     no document / no block.el -> null; never throws. */
  function render(doc, scope, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    var block = root.block;
    if (!block || typeof block.el !== "function") return null;   // cold-safe: alphabet not loaded
    var el = block.el;

    var spec = specFor(scope, opts);

    var settle = el(doc, "div", "settle settle--" + spec.scale, {
      "data-settle": spec.scale,             // the test / host hook
      "role": "status",                      // a polite status arrival (announced once)
      "aria-live": "polite",
      "aria-label": spec.aria                // faces the work; no number
    });

    // The mark — the Higgins carrier. A text-free node (aria-hidden: the word/label
    // already carry meaning; the mark is decorative reinforcement, not a 2nd read).
    var mark = el(doc, "span", "settle__mark", { "aria-hidden": "true" });
    settle.appendChild(mark);

    // CHAOS (JT-7 · the separate axis this settle reserved above). A hair of static,
    // render-local-seeded micro-variance on the DECORATIVE mark only — the hand-made
    // vs machine-stamped difference. Cold-safe (chaos absent -> base mark). STATIC by
    // construction (Constraint 2: no motion here); bounded (SC-6/JP-5 live in chaos).
    // Keyed on the SCALE only (positional) — never the word, count, or state.
    if (root.chaos && typeof root.chaos.applyMark === "function") {
      root.chaos.applyMark(mark, "settle:" + spec.scale);
    }

    // The quiet caption — omitted entirely when word is "" (mark-only Higgins form).
    if (spec.hasWord) {
      var word = el(doc, "span", "settle__word", { "text": spec.word });
      settle.appendChild(word);
    }

    return settle;
  }

  root.completionSettle = {
    SCALES: SCALES,
    specFor: specFor,
    render: render,
    _version: "1.0"
  };
})();
