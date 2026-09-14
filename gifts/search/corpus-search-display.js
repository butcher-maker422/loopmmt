/* loopmmt.com — the group-by-coverage DISPLAY layer over the ranked adapter · loop-search slot 03.

   ─────────────────────────────────────────────────────────────────────────────
   ONE HONEST RANK, GROUPED FOR THE EYE. createSiteSearch (slot 02, ranked mode)
   emits ONE flat group whose items are in the single earned order (rankKey =
   item.score, descending, arrival-ordinal tie-break). This layer is the HUMAN
   DOOR's display transform: it re-buckets that one ranked list into coverage
   sections *for the eye* — a pure PARTITION, never a re-rank.
   ─────────────────────────────────────────────────────────────────────────────

   THE DISPLAY-HONESTY INVARIANT (slot 03; the display-layer sibling of the
   score-honesty invariant 36). A group-by-coverage view is HONEST iff it is a
   pure partition-and-preserve of the ranked list. Five decidable bites:

     I1 · PARTITION       — every ranked item lands in exactly one group; none
                            dropped, none duplicated. multiset(⋃ groups) = input.
     I2 · WITHIN-GROUP    — each group's items are the input items of that coverage
          RANK-PRESERVING   in INPUT ORDER (an order-preserving filter). Grouping
                            never re-sorts a section by coverage or by anything.
     I3 · GROUP ORDER     — the group ORDER follows the RANK, not a coverage
          RANK-FAITHFUL     privilege: the group holding the higher-ranked item
                            leads. The section order is a pure function of (rank,
                            coverage label for tie-break), never "core always first."
     I4 · NO SCORE MUTATION— each output item is the input item, score untouched.
                            No per-coverage bonus can enter (coverage is DISPLAY,
                            never a scoring input — 36 already forbids it upstream).
     I5 · COVERAGE-PURE    — every item in a group carries that group's coverage.

   Why I3 is not "core → standard → deep → optional": a fixed coverage order is a
   per-coverage DISPLAY privilege — it would show `core` above a far-more-relevant
   `optional` hit, hiding the earned rank behind fake sections (the exact dishonesty
   federation-core.js §mode warns of). Deriving group order FROM the rank keeps the
   grouping downstream of the one honest rank: buckets for the eye, rank untouched.

   Deterministic: a pure function of the ranked list. No wall-clock, no random, no
   network, no DOM — same input, same grouping, byte-reproducible. stdlib JS only.
   The panel (the DOM: sections, node-links, the input->search->render wiring) is
   the thin layer built on top of this, next slice.

   Plain script (no ES module): attaches to window.LoopSearch.corpusDisplay AND
   sets module.exports for node/tests. */
(function () {
  "use strict";

  /* coverageOf(item) -> a stable string bucket key. A missing/blank coverage is
     its own honest bucket ("") — never silently merged into another, never dropped
     (that would break I1). Content-only read; touches no identity field. */
  function coverageOf(item) {
    var c = item && item.coverage;
    return (c == null) ? "" : String(c);
  }

  /* groupByCoverage(items) -> { groups: [{ coverage, items:[...] }, ...] }
     items: the ranked flat list from createSiteSearch (model.groups[ranked].items),
            already in the single earned order. This function reorders NOTHING in
            that list; it only partitions it. See the five invariants above. */
  function groupByCoverage(items) {
    var list = items || [];
    var order = [];        // coverage keys in first-appearance (= best-rank) order
    var bucket = {};       // coverage key -> items[] (input order preserved)
    var firstIdx = {};     // coverage key -> input index of its first (best-rank) item

    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var key = coverageOf(it);
      if (!bucket.hasOwnProperty(key)) {
        bucket[key] = [];
        firstIdx[key] = i;   // the group's best-ranked member is its first appearance
        order.push(key);
      }
      bucket[key].push(it);  // push preserves input (rank) order -> I2
    }

    // I3: group order = ascending by each group's best member's input index (the
    // group with the higher-ranked item leads), tie-break by coverage label so the
    // order is TOTAL and deterministic. Pure function of (rank, coverage) — no
    // per-coverage privilege. (firstIdx never ties in practice since two groups
    // cannot share one input position, but the label tie-break makes it total.)
    order.sort(function (a, b) {
      if (firstIdx[a] !== firstIdx[b]) return firstIdx[a] - firstIdx[b];
      return a < b ? -1 : (a > b ? 1 : 0);
    });

    return {
      groups: order.map(function (key) {
        return { coverage: key, items: bucket[key] };
      })
    };
  }

  /* flatten(view) -> items[]  — read the grouped view back in DISPLAY order
     (groups in order, items within each group in order). The inverse of the
     partition: used by the test to prove the round-trip and by any consumer that
     wants the display order as a flat stream. */
  function flatten(view) {
    var out = [];
    ((view && view.groups) || []).forEach(function (g) {
      (g.items || []).forEach(function (it) { out.push(it); });
    });
    return out;
  }

  var api = {
    coverageOf: coverageOf,
    groupByCoverage: groupByCoverage,
    flatten: flatten,
    _version: "1.0"
  };

  if (typeof window !== "undefined") {
    (window.LoopSearch = window.LoopSearch || {}).corpusDisplay = api;
  }
  if (typeof module !== "undefined" && module && module.exports) {
    module.exports = api;
  }
})();
