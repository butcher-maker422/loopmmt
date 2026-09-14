/* test_gifts_search_facet.js — seals the seq-245 gift-count fix.
 *
 * The bug: facetCounts._all counted index.nodes.length, which includes the gifts HUB
 * node (/gifts/) that rides in the search set to stay text-searchable. So a 95-gift
 * cabinet reported "All gifts 96". The fix: _all counts only GIFT nodes (isGift), which
 * mirrors the builder's counts.gift_pages. The hub stays searchable; it is not counted.
 *
 * Run: node test_gifts_search_facet.js   (exit 0 = all pass, exit 1 = a failure)
 * Pure/deterministic: no network, no wall-clock. Uses a small synthetic index AND, when
 * present, the committed live index as a belt-and-suspenders reality check.
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const FACET = require("./gifts-search-facet.js");

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("  ok  " + name); }

// --- isGift: the leaf-vs-hub predicate (mirrors the builder's _gift_slug) ---
ok("isGift accepts a leaf gift url", () => {
  assert.strictEqual(FACET.isGift({ url: "https://loopmmt.com/gifts/amber/" }), true);
});
ok("isGift rejects the gifts hub", () => {
  assert.strictEqual(FACET.isGift({ url: "https://loopmmt.com/gifts/" }), false);
});
ok("isGift rejects the reserved search feature page", () => {
  // /gifts/search/ is the search FEATURE, not a gift — it is url-depth-2 like a gift,
  // so this guards the dormant miscount where the sitemap walk counts it as gift 96.
  assert.strictEqual(FACET.isGift({ url: "https://loopmmt.com/gifts/search/" }), false);
});
ok("isGift rejects a non-gift url", () => {
  assert.strictEqual(FACET.isGift({ url: "https://loopmmt.com/site/about/" }), false);
});
ok("isGift is total on a missing/odd url", () => {
  assert.strictEqual(FACET.isGift({}), false);
  assert.strictEqual(FACET.isGift(null), false);
});

// --- facetCounts._all counts gifts, not nodes (the seq-245 regression) ---
ok("_all excludes the hub node", () => {
  const index = {
    contract: { facet: { port_verb: { order: ["source", "transform", "filter", "fold", "sink"] } } },
    nodes: [
      { url: "https://loopmmt.com/gifts/", port_verb: null },          // hub — NOT a gift
      { url: "https://loopmmt.com/gifts/amber/", port_verb: null },    // gift, unfaceted
      { url: "https://loopmmt.com/gifts/fanout/", port_verb: "fold" }, // gift, faceted
    ],
  };
  const c = FACET.facetCounts(index);
  assert.strictEqual(c._all, 2, "two gifts, hub excluded");
  assert.strictEqual(c._unclassified, 1, "one unfaceted GIFT (hub is not an unclassified gift)");
  assert.strictEqual(c.fold, 1);
});

// --- reality check against the committed live index, if present ---
const LIVE = path.join(__dirname, "..", "..", "gifts-search-index.json");
if (fs.existsSync(LIVE)) {
  ok("live index: _all == counts.gift_pages (not counts.nodes)", () => {
    const index = JSON.parse(fs.readFileSync(LIVE, "utf8"));
    const c = FACET.facetCounts(index);
    assert.strictEqual(c._all, index.counts.gift_pages,
      `_all (${c._all}) must equal builder gift_pages (${index.counts.gift_pages})`);
    assert.notStrictEqual(index.counts.nodes, index.counts.gift_pages,
      "sanity: nodes != gift_pages, i.e. the hub is present (else this test proves nothing)");
  });
} else {
  console.log("  --  live index not adjacent; synthetic assertions only");
}

console.log(`\ntest_gifts_search_facet: ${passed}/${passed} passed`);
