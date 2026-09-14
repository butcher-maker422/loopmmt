#!/usr/bin/env node
/* test_topk-fold.js — external battery for the topk-fold gift.
 *
 *   node test_topk-fold.js   ->  exit 0 GREEN / non-zero RED
 *
 * Proves the gift against an INDEPENDENT full-sort-then-slice oracle (a genuinely
 * different method than the gift's one-pass bounded heap), plus frozen hand goldens,
 * BYTE-IDENTICAL order-independence (the record is a fact about the multiset, not the
 * arrival order), ties at the k-th boundary, k > n, --min (bottom-k), determinism,
 * numeric-honesty hard errors, and invalid-k guards.
 */
"use strict";
var assert = require("assert");
var fold = require("./topk-fold.js").fold;

var pass = 0, fail = 0;
function ok(name, cond) {
  try { assert.ok(cond, name); pass++; }
  catch (e) { fail++; console.error("  RED  " + name); }
}
function throws(name, fn) {
  try { fn(); fail++; console.error("  RED  " + name + " (did not throw)"); }
  catch (e) { pass++; }
}
function J(v) { return JSON.stringify(v); }
function jsonl(arr) { return arr.map(String).join("\n"); }

/* ---- independent oracle: sort the whole stream, slice k (a different method) -- */
function oracle(vals, k, min) {
  var s = vals.slice().sort(function (a, b) { return min ? a - b : b - a; });
  return { count: vals.length, k: k, top: s.slice(0, k) };
}
function giftRec(vals, k, min) { return fold(jsonl(vals), { k: k, min: min }); }

/* ---- frozen hand goldens --------------------------------------------------- */
ok("golden top-3 of [5,1,9,3,7,2] == [9,7,5]",
  J(giftRec([5, 1, 9, 3, 7, 2], 3, false)) === J({ count: 6, k: 3, top: [9, 7, 5] }));
ok("golden bottom-3 (--min) of [5,1,9,3,7,2] == [1,2,3]",
  J(giftRec([5, 1, 9, 3, 7, 2], 3, true)) === J({ count: 6, k: 3, top: [1, 2, 3] }));
ok("golden top-1 of [5,1,9,3,7,2] == [9]",
  J(giftRec([5, 1, 9, 3, 7, 2], 1, false).top) === J([9]));
ok("golden min-1 of [5,1,9,3,7,2] == [1]",
  J(giftRec([5, 1, 9, 3, 7, 2], 1, true).top) === J([1]));

/* ---- agreement with the independent full-sort oracle ----------------------- */
var vectors = [
  [5, 1, 9, 3, 7, 2],
  [-3, -1, 0, 2, 4],
  [10, 20, 30, 40, 50, 60],
  [42],
  [1.5, 2.5, 0.5, 3.5],
  [7, 7, 7, 7],
  [100, -100, 0]
];
[1, 2, 3].forEach(function (k) {
  vectors.forEach(function (v) {
    ok("top-" + k + " == oracle " + J(v), J(giftRec(v, k, false)) === J(oracle(v, k, false)));
    ok("min-" + k + " == oracle " + J(v), J(giftRec(v, k, true)) === J(oracle(v, k, true)));
  });
});

/* ---- k > n : all values, still sorted -------------------------------------- */
ok("k>n top: k=10 of [3,1,2] == [3,2,1], count 3",
  J(giftRec([3, 1, 2], 10, false)) === J({ count: 3, k: 10, top: [3, 2, 1] }));
ok("k>n min: k=10 of [3,1,2] == [1,2,3], count 3",
  J(giftRec([3, 1, 2], 10, true)) === J({ count: 3, k: 10, top: [1, 2, 3] }));

/* ---- count is n even when k < n -------------------------------------------- */
ok("count == n even when k<n", giftRec([9, 8, 7, 6, 5], 2, false).count === 5);

/* ---- ties at the k-th boundary (resolved by value) ------------------------- */
ok("ties: top-2 of [5,3,3,3] == [5,3]", J(giftRec([5, 3, 3, 3], 2, false).top) === J([5, 3]));
ok("ties: top-2 of [5,5,5,1] == [5,5]", J(giftRec([5, 5, 5, 1], 2, false).top) === J([5, 5]));
ok("ties: min-2 of [1,1,1,9] == [1,1]", J(giftRec([1, 1, 1, 9], 2, true).top) === J([1, 1]));

/* ---- BYTE-IDENTICAL order-independence (stronger than a float summary) ------ */
var base = [5, 1, 9, 3, 7, 2, 8, 4, 6, 0];
var shuffled = [8, 0, 5, 9, 1, 6, 3, 2, 7, 4];
var reversed = base.slice().reverse();
ok("order-independent: shuffled == base (byte-identical)",
  J(giftRec(base, 4, false)) === J(giftRec(shuffled, 4, false)));
ok("order-independent: reversed == base (byte-identical)",
  J(giftRec(base, 4, false)) === J(giftRec(reversed, 4, false)));
ok("order-independent --min: shuffled == base (byte-identical)",
  J(giftRec(base, 4, true)) === J(giftRec(shuffled, 4, true)));

/* ---- determinism: folds twice identical ------------------------------------ */
ok("folds twice identical", J(giftRec(base, 5, false)) === J(giftRec(base, 5, false)));

/* ---- empty stream ---------------------------------------------------------- */
ok("empty stream -> {count:0,k:3,top:[]}",
  J(fold("", { k: 3 })) === J({ count: 0, k: 3, top: [] }));

/* ---- blank lines skipped, CRLF trimmed ------------------------------------- */
ok("blank lines skipped", J(fold("5\n\n1\n\n9\n", { k: 2 }).top) === J([9, 5]));
ok("CRLF trimmed", J(fold("5\r\n1\r\n9\r\n", { k: 2 }).top) === J([9, 5]));

/* ---- numeric honesty: hard errors ------------------------------------------ */
throws("NaN -> throw", function () { fold("1\nNaN\n2", { k: 2 }); });
throws("1e999 (Infinity) -> throw", function () { fold("1\n1e999\n2", { k: 2 }); });
throws("string -> throw", function () { fold('1\n"x"\n2', { k: 2 }); });
throws("bad JSON -> throw", function () { fold("1\nabc\n2", { k: 2 }); });

/* ---- invalid k guards ------------------------------------------------------ */
throws("k=0 -> throw", function () { fold("1\n2\n3", { k: 0 }); });
throws("k=-1 -> throw", function () { fold("1\n2\n3", { k: -1 }); });
throws("k=1.5 -> throw", function () { fold("1\n2\n3", { k: 1.5 }); });
throws("k absent -> throw", function () { fold("1\n2\n3", {}); });

/* ---- negatives + mixed correctness ----------------------------------------- */
ok("negatives top-2 of [-5,-1,-9,-3] == [-1,-3]", J(giftRec([-5, -1, -9, -3], 2, false).top) === J([-1, -3]));
ok("negatives min-2 of [-5,-1,-9,-3] == [-9,-5]", J(giftRec([-5, -1, -9, -3], 2, true).top) === J([-9, -5]));

console.log((fail === 0 ? "GREEN" : "RED") + ": " + pass + " assertions passed, " + fail + " failed  [test_topk-fold]");
process.exit(fail === 0 ? 0 : 1);
