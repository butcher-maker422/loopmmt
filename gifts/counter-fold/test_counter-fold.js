#!/usr/bin/env node
/* test_counter-fold.js — external battery for the counter-fold gift.
 *
 *   node test_counter-fold.js   ->  exit 0 GREEN / non-zero RED
 *
 * Proves ripple-carry correctness on known counter values (0->1, 3->4 through a run
 * of ones, 11->12), agreement with an INDEPENDENT value-arithmetic method (decode the
 * bit set to a BigInt = sum of 2**i, add N, re-encode -- a different method than the
 * hand-built ripple carry), the TIER-B closure property (--steps N equals piping the
 * fold into itself N times -- the trace ↻ loop), UNBOUNDEDNESS past 2**53, plus
 * determinism, order-independence, empty/steps-0, dedup, and numeric-honesty errors.
 */
"use strict";
var m = require("./counter-fold.js");
var fold = m.fold;

var pass = 0, fail = 0;
function ok(name, cond) { if (cond) pass++; else { fail++; console.error("  RED  " + name); } }
function throws(name, fn) { try { fn(); fail++; console.error("  RED  " + name + " (did not throw)"); } catch (e) { pass++; } }
function J(v) { return JSON.stringify(v); }
function jsonl(bits) { return bits.map(function (b) { return J(b); }).join("\n"); }
function toJSONL(rec) { return rec.bits.map(function (b) { return J(b); }).join("\n"); }

/* ---- independent method: bit set <-> BigInt value (NOT a ripple carry) ------ */
function bitsToVal(bits) { var v = 0n; for (var i = 0; i < bits.length; i++) v += (1n << BigInt(bits[i])); return v; }
function valToBits(v) { var b = [], i = 0n; while (v > 0n) { if (v & 1n) b.push(Number(i)); v >>= 1n; i++; } return b; }
function expectPlus(bits, n) { return valToBits(bitsToVal(bits) + BigInt(n)); }

/* ---- ripple carry on known counter values ---------------------------------- */
ok("0 -> 1 : {} +1 == {0}", J(fold("", { steps: 1 }).bits) === J([0]));
ok("1 -> 2 : {0} +1 == {1}", J(fold(jsonl([0]), { steps: 1 }).bits) === J([1]));
ok("3 -> 4 : {0,1} +1 == {2} (carry through a run of ones)", J(fold(jsonl([0, 1]), { steps: 1 }).bits) === J([2]));
ok("11 -> 12 : {0,1,3} +1 == {2,3}", J(fold(jsonl([0, 1, 3]), { steps: 1 }).bits) === J([2, 3]));
ok("5 -> 6 : {0,2} +1 == {1,2} (gap stops the carry)", J(fold(jsonl([0, 2]), { steps: 1 }).bits) === J([1, 2]));
ok("7 -> 8 : {0,1,2} +1 == {3}", J(fold(jsonl([0, 1, 2]), { steps: 1 }).bits) === J([3]));

/* ---- agreement with the INDEPENDENT value-arithmetic method, over vectors x N */
var vectors = [[], [0], [1], [0, 1], [0, 2], [0, 1, 2, 3], [5], [3, 7], [0, 1, 2, 3, 4, 5]];
var Ns = [1, 2, 3, 7, 16];
var allAgree = true;
vectors.forEach(function (v) {
  Ns.forEach(function (n) {
    if (J(fold(jsonl(v), { steps: n }).bits) !== J(expectPlus(v, n))) allAgree = false;
  });
});
ok("agrees with independent BigInt value-arithmetic across vectors x steps", allAgree);

/* ---- TIER-B closure: --steps N == piping the fold N times ------------------- */
var seed = [0, 2, 5];                 // value 37
function piped(text, n) { var t = text; for (var i = 0; i < n; i++) t = toJSONL(fold(t, { steps: 1 })); return t; }
[2, 3, 4, 8].forEach(function (n) {
  ok("closed under I/O: --steps " + n + " == piped " + n,
    toJSONL(fold(jsonl(seed), { steps: n })) === piped(jsonl(seed), n));
});

/* ---- UNBOUNDED: counts past 2**53 with no loss ----------------------------- */
ok("unbounded: {60} (2**60) +1 == {0,60}", J(fold(jsonl([60]), { steps: 1 }).bits) === J([0, 60]));
ok("unbounded: all ones 0..59 (2**60 - 1) +1 == {60}",
  J(fold(jsonl([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59]), { steps: 1 }).bits) === J([60]));
ok("unbounded: {100} +1 stays exact (value > Number.MAX_SAFE_INTEGER)",
  J(fold(jsonl([100]), { steps: 1 }).bits) === J([0, 100]));

/* ---- determinism + order-independence (a SET; shuffled == base) ------------- */
var shuffled = [5, 0, 2];
ok("order-independent: shuffled seed == sorted seed (1 step, byte-identical)",
  J(fold(jsonl(shuffled), { steps: 1 }).bits) === J(fold(jsonl(seed), { steps: 1 }).bits));
ok("determinism: folds twice identical", J(fold(jsonl(seed), { steps: 3 })) === J(fold(jsonl(seed), { steps: 3 })));

/* ---- dedup: duplicate set bits collapse (a set) ---------------------------- */
ok("duplicate bits collapse (steps 0 canonicalises)",
  J(fold("0\n0\n2\n", { steps: 0 }).bits) === J([0, 2]));
ok("steps 0 sorts + dedups", J(fold("3\n0\n3\n", { steps: 0 }).bits) === J([0, 3]));

/* ---- empty stream + record shape ------------------------------------------- */
ok("empty +0 -> {steps:0,count:0,bits:[]}", J(fold("", { steps: 0 })) === J({ steps: 0, count: 0, bits: [] }));
ok("count is the number of set bits (popcount)", fold(jsonl([0, 1, 2, 3]), { steps: 0 }).count === 4);
ok("blank lines skipped", J(fold("0\n\n2\n\n", { steps: 0 }).bits) === J([0, 2]));
ok("CRLF trimmed", J(fold("0\r\n1\r\n", { steps: 1 }).bits) === J([2]));

/* ---- numeric / shape honesty: hard errors ---------------------------------- */
throws("negative bit index -> throw", function () { fold("-1\n", { steps: 1 }); });
throws("non-integer bit index -> throw", function () { fold("0.5\n", { steps: 1 }); });
throws("non-finite bit index -> throw", function () { fold("1e999\n", { steps: 1 }); });
throws("non-number line -> throw", function () { fold("\"x\"\n", { steps: 1 }); });
throws("bad JSON line -> throw", function () { fold("0\nabc\n", { steps: 1 }); });

/* ---- bad steps guards ------------------------------------------------------ */
throws("steps=-1 -> throw", function () { fold("0", { steps: -1 }); });
throws("steps=1.5 -> throw", function () { fold("0", { steps: 1.5 }); });

console.log((fail === 0 ? "GREEN" : "RED") + ": " + pass + " assertions passed, " + fail + " failed  [test_counter-fold]");
process.exit(fail === 0 ? 0 : 1);
