/* gifts-search-facet.js — the port-verb facet block for the gifts search UI (SR-2).

   ONE job: turn (the gifts search index, an active port-verb) into a filtered index
   the ranked adapter (corpus-search-federation.js `createSiteSearch`) consumes UNCHANGED.
   The facet FILTERS the node set; it NEVER ranks and NEVER writes a score — the adapter
   still computes rank at query time from (query x {title, description, body}), so the
   score-honesty invariant (doc 36 §4: no static score column) is preserved by construction:
   this module reads no score, writes no score, and touches only the `port_verb` identity field.

   Contract with the index (byte-truth oracle — read, never hardcode):
     - facet order lives at  index.contract.facet.port_verb.order  (source/transform/filter/fold/sink).
       `facetOrder(index)` reads it FROM the index so there is one copy of the order, not two.
     - a node's classification is  node.port_verb  (a verb string, or null == not yet classified,
       VERIFY-gated — NOTE-13.1337-1). null nodes are text-searchable ALWAYS; they leave the
       result set ONLY when a specific verb chip is active.

   Determinism-first: `filterByPortVerb` and `facetOrder` are total pure functions of their
   inputs — no wall-clock, no random, no network, no DOM. order-in == order-out. That is what
   makes them node-testable adjacent to their creation (the verify-weld) without a browser.

   Plain script (no ES module): attaches to window.GiftsSearchFacet for the page AND sets
   module.exports for node/tests. Mirrors the shell scripts' dual-export shape. */
(function () {
  "use strict";

  /* The sentinel for "no chip active". Kept as a named constant so the page and the
     test agree on the same value rather than each spelling their own null/"" . */
  var ALL = null;

  /* facetOrder(index) -> [verb, ...] in the index's declared pipeline order, or [] if the
     index carries no facet contract. The index is the single oracle for the order — a chip
     bar built from this can never drift from the classification the builder joined. */
  function facetOrder(index) {
    var f = index && index.contract && index.contract.facet && index.contract.facet.port_verb;
    return (f && Array.isArray(f.order)) ? f.order.slice() : [];
  }

  /* isGift(node) -> true iff the node is a GIFT page, not the gifts hub or a reserved
     gifts-branch feature page. A gift's served url is /gifts/<slug>/ (two path segments:
     "gifts" + slug); the hub is /gifts/ (one segment); and RESERVED_GIFT_SLUGS names
     depth-2 pages under /gifts/ that are features, not gifts (the search page itself lives
     at /gifts/search/). This mirrors the builder's _gift_slug + RESERVED_GIFT_SLUGS
     (build_gifts_search_index.py) EXACTLY — the two layers share one rule so a gift count
     computed at either layer equals the manifest N. Pure, total: a function of the url alone.
     Without this, `_all` counted the hub (was 96) and would count the search page too. */
  var RESERVED_GIFT_SLUGS = { search: true };
  function isGift(node) {
    var url = node && node.url;
    if (typeof url !== "string") { return false; }
    var tail = url.replace(/^https?:\/\/[^/]+\//, "").replace(/\/+$/, "").split("/");
    if (tail.length !== 2 || tail[0] !== "gifts" || tail[1] === "") { return false; }
    return !Object.prototype.hasOwnProperty.call(RESERVED_GIFT_SLUGS, tail[1]);
  }

  /* filterByPortVerb(index, verb) -> a new index object with `nodes` narrowed to the active
     facet. verb === ALL (null) or "" returns the index UNCHANGED-BY-VALUE (all nodes, incl.
     the 65 null-facet gifts and the hub). A specific verb returns ONLY nodes whose port_verb
     strictly equals it — so the null-facet nodes correctly drop out under an active chip and
     reappear the moment the chip clears. Every other index field (site, url, contract,
     description, counts) is carried through untouched so the adapter sees the same envelope. */
  function filterByPortVerb(index, verb) {
    var nodes = (index && Array.isArray(index.nodes)) ? index.nodes : [];
    if (verb === ALL || verb === "") {
      return shallowWithNodes(index, nodes);
    }
    var kept = nodes.filter(function (n) { return n && n.port_verb === verb; });
    return shallowWithNodes(index, kept);
  }

  /* facetCounts(index) -> { verb: n, ... } over the DECLARED order only, plus `_all` (total)
     and `_unclassified` (null port_verb). Pure; used by the page to label chips and by the
     test to assert the split. Reads identity only; never a score. */
  function facetCounts(index) {
    var order = facetOrder(index);
    var nodes = (index && Array.isArray(index.nodes)) ? index.nodes : [];
    // `_all` counts GIFTS, not nodes: the hub (/gifts/) rides in the node set to stay
    // text-searchable but is not a gift, so it must not inflate the "All gifts" tally.
    // isGift is the same leaf-vs-hub test the builder applies (counts.gift_pages).
    var out = { _all: 0, _unclassified: 0 };
    order.forEach(function (v) { out[v] = 0; });
    nodes.forEach(function (n) {
      if (isGift(n)) { out._all += 1; }
      var v = n && n.port_verb;
      if (v == null) { return; }
      if (Object.prototype.hasOwnProperty.call(out, v)) { out[v] += 1; }
    });
    // _unclassified: gifts with no port-verb (the hub is excluded — it is not an
    // unclassified gift, it is not a gift). Kept consistent with _all's gift-only basis.
    out._unclassified = nodes.reduce(function (acc, n) {
      return acc + ((isGift(n) && (n.port_verb == null)) ? 1 : 0);
    }, 0);
    return out;
  }

  function shallowWithNodes(index, nodes) {
    var copy = {};
    for (var k in index) {
      if (Object.prototype.hasOwnProperty.call(index, k) && k !== "nodes") { copy[k] = index[k]; }
    }
    copy.nodes = nodes;
    return copy;
  }

  var api = {
    ALL: ALL,
    facetOrder: facetOrder,
    filterByPortVerb: filterByPortVerb,
    facetCounts: facetCounts,
    isGift: isGift,
    _version: "1.0"
  };

  if (typeof window !== "undefined") {
    window.GiftsSearchFacet = api;
  }
  if (typeof module !== "undefined" && module && module.exports) {
    module.exports = api;
  }
})();
