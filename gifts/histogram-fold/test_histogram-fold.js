#!/usr/bin/env node
/* test_histogram-fold.js — golden battery for the histogram-fold gift.

   Out-of-band and self-verifying. The oracle is TWO independent things, neither a
   copy of the gift's streaming floor-and-tally loop:

     (1) RANGE-MEMBERSHIP counting — for a bin [lo, hi), the count is
         values.filter(x => x >= lo && x < hi).length. This is a genuinely
         different algorithm (predicate over the whole set per bin, O(bins*n))
         than the gift's one-pass Map tally, and it uses NO floor-index math. It
         is valid where the bin edges are exact (integer widths), where
         floor-index and range-membership provably agree.

     (2) FROZEN hand-computed golden records, pinned by hand from the spec —
         including the deliberate IEEE-754 float-boundary case, where floor-index
         and range-membership DIVERGE (see §7). That divergence is the documented
         numeric-honesty invariant, not a bug, so the pin is checked against the
         hand golden, never against the range oracle.

   A planted mutation (the bite, §9) MUST be caught — if the suite passes with the
   mutation live, the suite proves nothing.

   Run:  node test_histogram-fold.js   -> exit 0 GREEN / non-zero RED
*/
"use strict";
var hf = require("./histogram-fold.js");

var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.log("  FAIL  " + name); }
}
function foldRec(nums, opts) { return hf.fold(nums.join("\n"), opts); }
function J(v) { return JSON.stringify(v); }

/* ---- independent range-membership oracle (no floor-index math) ------------ */
function rangeCount(values, lo, hi) {
  var n = 0, i;
  for (i = 0; i < values.length; i++) if (values[i] >= lo && values[i] < hi) n++;
  return n;
}

/* ---- 1. Frozen hand golden: unit bins, cross-checked by range membership -- *
   values [1,2,2,5], width 1, origin 0.
   floor: 1->1, 2->2, 2->2, 5->5 ; occupied 1..5 ; contiguous with empty 3,4. */
(function () {
  var vals = [1, 2, 2, 5];
  var rec = foldRec(vals);
  var goldenBins = [
    { lo: 1, hi: 2, count: 1 },
    { lo: 2, hi: 3, count: 2 },
    { lo: 3, hi: 4, count: 0 },
    { lo: 4, hi: 5, count: 0 },
    { lo: 5, hi: 6, count: 1 }
  ];
  ok("unit bins == frozen hand golden", J(rec.bins) === J(goldenBins));
  ok("unit bins: count/min/max", rec.count === 4 && rec.min === 1 && rec.max === 5);
  // independent cross-check: every golden bin count == range membership count
  var allMatch = goldenBins.every(function (b) { return b.count === rangeCount(vals, b.lo, b.hi); });
  ok("unit bins == independent range-membership oracle", allMatch);
})();

/* ---- 2. width/origin override, cross-checked by range membership ---------- *
   values [5,12,13,27], width 10, origin 0 -> floor 0,1,1,2 ; occupied 0..2. */
(function () {
  var vals = [5, 12, 13, 27], opts = { width: 10, origin: 0 };
  var rec = foldRec(vals, opts);
  var golden = [
    { lo: 0, hi: 10, count: 1 },
    { lo: 10, hi: 20, count: 2 },
    { lo: 20, hi: 30, count: 1 }
  ];
  ok("width-10 bins == frozen hand golden", J(rec.bins) === J(golden));
  ok("width-10 == range-membership oracle",
     golden.every(function (b) { return b.count === rangeCount(vals, b.lo, b.hi); }));
  // origin shift: same values, origin 5, width 10 -> floor((x-5)/10): 0,0,0,2
  var rec2 = foldRec(vals, { width: 10, origin: 5 });
  ok("origin shift changes bucketing",
     J(rec2.bins) === J([
       { lo: 5, hi: 15, count: 3 },
       { lo: 15, hi: 25, count: 0 },
       { lo: 25, hi: 35, count: 1 }
     ]));
})();

/* ---- 3. Empty stream folds to the empty record --------------------------- */
(function () {
  var rec = foldRec([]);
  ok("empty stream -> empty record",
     J(rec) === J({ bins: [], width: 1, origin: 0, count: 0, min: null, max: null }));
})();

/* ---- 4. Order-independence: a histogram is a MULTISET fold --------------- *
   This is THE fold-lane invariant that separates histogram from an ordered fold
   (merkle): shuffle the stream and the record is byte-identical. */
(function () {
  var base = [5, 1, 9, 2, 5, 5, 1, 8, 3, 2, 9, 1];
  var shuffled = [9, 1, 2, 5, 8, 1, 5, 3, 2, 9, 5, 1];
  var reversed = base.slice().reverse();
  ok("order-independent: shuffled == base", J(foldRec(shuffled)) === J(foldRec(base)));
  ok("order-independent: reversed == base", J(foldRec(reversed)) === J(foldRec(base)));
})();

/* ---- 5. Determinism: folds twice byte-identical -------------------------- */
(function () {
  var vals = [1, 2, 3, 4, 5, 6, 7];
  ok("folds-twice-identical", J(foldRec(vals)) === J(foldRec(vals)));
})();

/* ---- 6. Contiguity + exact shared edges ---------------------------------- *
   No holes: empty interior buckets are carried as count 0, and bin[i].hi is
   byte-exactly bin[i+1].lo (both edges are origin + k*width, never lo+width). */
(function () {
  var rec = foldRec([0, 30], { width: 10, origin: 0 }); // occupied 0 and 3; 1,2 empty
  ok("contiguous incl. empty interior bins (count 0)",
     rec.bins.length === 4 && rec.bins[1].count === 0 && rec.bins[2].count === 0);
  var sharedEdges = true, i;
  for (i = 0; i + 1 < rec.bins.length; i++) if (rec.bins[i].hi !== rec.bins[i + 1].lo) sharedEdges = false;
  ok("adjacent bins share an exact edge (hi[i] === lo[i+1])", sharedEdges);
})();

/* ---- 7. The pinned IEEE-754 float boundary (numeric-honesty invariant) ---- *
   With width 0.1, origin 0, the value 0.3 lands in bin index 2 ([0.2,0.3)),
   because (0.3 - 0) / 0.1 === 2.9999999999999996 and floor of that is 2, NOT 3.
   This is the DOCUMENTED behavior, not a bug: the gift does not epsilon-fudge it.
   Checked against the hand golden (index 2), NOT the range oracle — range
   membership would put 0.3 in bin 3, and that divergence IS the trap being
   pinned. A single value -> a single-bin record whose lone bin is index 2. */
(function () {
  var rec = foldRec([0.3], { width: 0.1, origin: 0 });
  ok("float-boundary pin: 0.3 @ width 0.1 -> bin index 2 (lo≈0.2)",
     rec.bins.length === 1 && Math.abs(rec.bins[0].lo - 0.2) < 1e-12);
  // sanity: the arithmetic really does floor to 2 here (documents the trap)
  ok("float-boundary: floor((0.3-0)/0.1) === 2 (the IEEE-754 fact)",
     Math.floor((0.3 - 0) / 0.1) === 2);
})();

/* ---- 8. Numeric honesty: non-finite / non-number / bad JSON are hard errors */
(function () {
  function throws(fn) { try { fn(); return false; } catch (e) { return true; } }
  ok("1e999 (overflows to Infinity) is a hard error",
     throws(function () { hf.fold("1e999"); }));
  ok("a string line is a hard error", throws(function () { hf.fold("\"12\""); }));
  ok("a null line is a hard error", throws(function () { hf.fold("null"); }));
  ok("a bool line is a hard error", throws(function () { hf.fold("true"); }));
  ok("an object line is a hard error", throws(function () { hf.fold("{\"v\":1}"); }));
  ok("invalid JSON line is a hard error", throws(function () { hf.fold("not-a-number"); }));
  ok("width <= 0 is a hard error", throws(function () { hf.fold("1\n2", { width: 0 }); }));
  ok("non-finite width is a hard error", throws(function () { hf.fold("1\n2", { width: Infinity }); }));
  ok("non-finite origin is a hard error", throws(function () { hf.fold("1", { origin: NaN }); }));
})();

/* ---- 9. Blank lines skipped, CRLF trimmed -------------------------------- */
(function () {
  ok("blank lines skipped (not a value)", J(hf.fold("1\n\n2\n")) === J(hf.fold("1\n2")));
  ok("CRLF trimmed: \\r\\n folds like \\n", J(hf.fold("1\r\n2\r\n")) === J(hf.fold("1\n2")));
  ok("integer counts stay integers",
     hf.fold("1\n1\n1").bins[0].count === 3 && Number.isInteger(hf.fold("1\n1\n1").bins[0].count));
})();

/* ---- 10. THE MUTATION BITE (non-vacuity) --------------------------------- *
   A WRONG construction: upper-closed bins (lo, hi] via ceil-1 instead of the
   spec's lower-closed [lo, hi) via floor. On a value exactly on an integer edge
   (10, width 10, origin 0) the two disagree: floor-spec -> bin index 1 ([10,20));
   the wrong upper-closed construction -> bin index 0 ((0,10]). The gift's record
   MUST NOT match the wrong one, proving the suite would catch that regression. */
(function () {
  function wrongFold(vals, width, origin) {
    // upper-closed (lo, hi]: index = ceil((x-origin)/width) - 1
    var counts = {}, minI = null, maxI = null;
    vals.forEach(function (x) {
      var idx = Math.ceil((x - origin) / width) - 1;
      counts[idx] = (counts[idx] || 0) + 1;
      if (minI === null || idx < minI) minI = idx;
      if (maxI === null || idx > maxI) maxI = idx;
    });
    var bins = [];
    for (var i = minI; i <= maxI; i++) bins.push({ lo: origin + i * width, hi: origin + (i + 1) * width, count: counts[i] || 0 });
    return bins;
  }
  var vals = [10, 10, 5];
  var gift = foldRec(vals, { width: 10, origin: 0 }).bins;
  var wrong = wrongFold(vals, 10, 0);
  ok("mutation bite: lower-closed [lo,hi) != upper-closed (lo,hi] on an edge value",
     J(gift) !== J(wrong));
})();

/* ---- report -------------------------------------------------------------- */
console.log("");
if (fail === 0) {
  console.log("GREEN: " + pass + " assertions passed, 0 failed  [test_histogram-fold]");
  process.exit(0);
} else {
  console.log("RED: " + pass + " passed, " + fail + " FAILED  [test_histogram-fold]");
  process.exit(1);
}
