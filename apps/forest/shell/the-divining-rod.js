/* the-divining-rod.js — Delight #4 of the Seven Delights (FWW(C) feature set).
   Auto-covered by delight-egress-guard.test.js (SC-7); unit test the-divining-rod.test.js.

   THE DIVINING ROD — the empty-search tip (V6 partition #4).
     Trigger  : an all-corpus search that turns up nothing new (mail-renderer
                renderServerHits, the `!fresh.length` branch).
     Felt (SM-2): the joke DECAYS its own performance. A divining rod is folk-magic
                nonsense and half-knows it — the FIRST empty search gets a little charm;
                every one after drops the act and says the plain, honest thing. It faces
                the SEARCH (it came up dry), never the searcher (SM-0 — never "you found
                nothing wrong").
     Form (JT-3): an empty `record` + one `line`, a VOICE not a drawing (the mascot was
                chiseled in the Jointer pass). Built from the one shared el() / Block
                Alphabet : a `.record` card holding a single `.line--empty`
                (muted-italic voice). No head, no body rows — "an empty record."
     Security (SC-5): the tip is STATIC / templated and NEVER echoes the query. render()
                takes NO query argument — the query string cannot reach this module by
                construction, so the surveil/echo edge is closed structurally, not by
                discipline. And it makes zero network calls (SC-7 auto-covers it: not on
                the egress allowlist).

   Plain script (no ES module, no deps) — attaches to window.ForestShell.diviningRod.
   Cold-safe throughout: no document / no alphabet -> null, never throws. No network,
   no store, no query. Depends only on window.ForestShell.block.el. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  /* The STATIC tip set — the ONLY strings this module can render. No query, no user
     data, no interpolation ever reaches here (SC-5, by construction). Index 0 is the
     one bit of charm, spent once; index 1 is the decayed, plain, honest voice (SM-2).
     Both say the same TRUE thing (the whole corpus was searched, nothing else is out
     there) so the delight never trades honesty for the joke. */
  var TIPS = [
    "The rod dipped, then went still. Nothing else is hiding out in your mail.",
    "Searched all of your mail \u2014 there\u2019s nothing else to find."
  ];

  /* render-local decay counter: how many times the Rod has spoken this session. Keyed on
     NOTHING but its own count — never the query, never the user (no covert channel). */
  var _spoken = 0;

  /* tip(n) — PURE. The static line for the n-th empty search (0-based): n<=0 -> the charm
     (spent once), n>=1 -> the decayed plain voice. Contains no query (there is no query
     parameter to contain). Testable in isolation. */
  function tip(n) {
    return TIPS[(typeof n === "number" && n >= 1) ? 1 : 0];
  }

  /* render(doc, opts) -> the Rod's Node | null.
       opts.n (optional): force the decay index (deterministic paints / tests). Absent ->
         the module's own render-local counter drives the decay and advances by one.
     JT-3: an empty `.record` card holding one `.line--empty` voice. Cold-safe. */
  function render(doc, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;   // cold-safe
    var block = root.block;
    if (!block || typeof block.el !== "function") return null;          // cold-safe: alphabet not loaded
    var el = block.el;

    var forced = opts && typeof opts.n === "number";
    var n = forced ? opts.n : _spoken;
    var line = tip(n);
    if (!forced) _spoken++;   // advance the decay on real paints only

    var card = el(doc, "div", "divining record", { role: "note", "aria-label": "Search came up empty" });
    var voice = el(doc, "div", "divining__voice line line--empty");
    voice.appendChild(el(doc, "span", "line__value", { text: line }));
    card.appendChild(voice);
    return card;
  }

  root.diviningRod = {
    tip: tip,
    render: render,
    _reset: function () { _spoken = 0; }   // test hook: reset the render-local decay
  };
})();
