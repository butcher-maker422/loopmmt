#!/usr/bin/env node
/**
 * test_running-stats.js — out-of-band battery for the running-stats gift.
 *
 * The gift folds a JSONL numeric stream into {count,mean,variance,stddev,min,max}
 * by WELFORD'S online algorithm (one pass). This battery checks it against an
 * INDEPENDENTLY-authored oracle written by a genuinely different method — the
 * textbook TWO-PASS formula (pass 1: mean = sum/n; pass 2: variance =
 * sum((x-mean)^2)/n) — plus frozen hand goldens, the numerical-stability hard
 * case (a tight cluster around a huge mean), determinism, order behaviour, the
 * numeric-honesty guards, and a MUTATION BITE proving the gift is genuinely
 * Welford-stable and not the naive sum-of-squares shortcut.
 *
 * GREEN (exit 0) / RED (exit 1).
 */
"use strict";
var assert = require("assert");
var { fold } = require("./running-stats.js");

var pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.error("  RED  " + name + "\n       " + e.message); }
}
function jsonl(nums) { return nums.map(function (x) { return JSON.stringify(x); }).join("\n"); }

/* ---- the INDEPENDENT oracle: textbook two-pass (a different method) -------- */
function twoPass(nums, sample) {
  var n = nums.length;
  if (n === 0) return { count: 0, mean: null, variance: null, stddev: null, min: null, max: null };
  var sum = 0, i;
  for (i = 0; i < n; i++) sum += nums[i];
  var mean = sum / n;
  var s = 0;
  for (i = 0; i < n; i++) { var d = nums[i] - mean; s += d * d; }
  var variance;
  if (sample) variance = n < 2 ? null : s / (n - 1);
  else variance = s / n;
  if (variance !== null && variance < 0) variance = 0;
  var stddev = variance === null ? null : Math.sqrt(variance);
  var mn = nums[0], mx = nums[0];
  for (i = 1; i < n; i++) { if (nums[i] < mn) mn = nums[i]; if (nums[i] > mx) mx = nums[i]; }
  return { count: n, mean: mean, variance: variance, stddev: stddev, min: mn, max: mx };
}

/* ---- the NAIVE (unstable) shortcut — used ONLY for the mutation bite ------- */
function naiveVariance(nums) {
  var n = nums.length, s = 0, ss = 0, i;
  for (i = 0; i < n; i++) { s += nums[i]; ss += nums[i] * nums[i]; }
  return (ss - (s * s) / n) / n; // catastrophic cancellation when the mean is large
}

var REL = 1e-9; // tight relative tolerance for float comparison
function close(a, b, rel) {
  rel = rel || REL;
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  var scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= rel * scale;
}
function matchesOracle(rec, oracle) {
  assert.strictEqual(rec.count, oracle.count, "count");
  assert.ok(close(rec.mean, oracle.mean), "mean " + rec.mean + " vs " + oracle.mean);
  assert.ok(close(rec.variance, oracle.variance), "variance " + rec.variance + " vs " + oracle.variance);
  assert.ok(close(rec.stddev, oracle.stddev), "stddev " + rec.stddev + " vs " + oracle.stddev);
  assert.ok(close(rec.min, oracle.min), "min");
  assert.ok(close(rec.max, oracle.max), "max");
}

/* ======================================================= FROZEN HAND GOLDENS */
// The classic textbook example: mean 5, population variance 4, stddev 2.
ok("golden: [2,4,4,4,5,5,7,9] -> mean 5, popvar 4, sd 2", function () {
  var r = fold(jsonl([2, 4, 4, 4, 5, 5, 7, 9]));
  assert.strictEqual(r.count, 8);
  assert.ok(close(r.mean, 5), "mean");
  assert.ok(close(r.variance, 4), "variance");
  assert.ok(close(r.stddev, 2), "stddev");
  assert.strictEqual(r.min, 2);
  assert.strictEqual(r.max, 9);
});
ok("golden: same, --sample -> var 32/7, sd sqrt(32/7)", function () {
  var r = fold(jsonl([2, 4, 4, 4, 5, 5, 7, 9]), { sample: true });
  assert.ok(close(r.variance, 32 / 7), "sample variance = 32/7, got " + r.variance);
  assert.ok(close(r.stddev, Math.sqrt(32 / 7)), "sample stddev");
});
ok("golden: single value -> mean=value, popvar 0, sd 0", function () {
  var r = fold(jsonl([42]));
  assert.deepStrictEqual(r, { count: 1, mean: 42, variance: 0, stddev: 0, min: 42, max: 42 });
});
ok("golden: two equal values -> variance 0", function () {
  var r = fold(jsonl([7, 7]));
  assert.ok(close(r.variance, 0), "variance 0");
});
ok("golden: negatives [-5,-1,-1,3] -> mean -1, popvar 8", function () {
  var r = fold(jsonl([-5, -1, -1, 3]));
  assert.ok(close(r.mean, -1), "mean -1");
  assert.ok(close(r.variance, 8), "popvar 8, got " + r.variance);
  assert.strictEqual(r.min, -5);
  assert.strictEqual(r.max, 3);
});

/* ==================================== GIFT == INDEPENDENT TWO-PASS ORACLE === */
var corpus = [
  [1, 2, 3, 4, 5],
  [10, 10, 10, 10],
  [0.5, 1.5, 2.5, 3.5, 4.5],
  [-3, -1, 0, 1, 3, 100],
  [1e6, 1e6 + 3, 1e6 - 3, 1e6 + 1],
  [3.14159, 2.71828, 1.41421, 1.61803],
  [0, 0, 0, 1],
  [42],
];
corpus.forEach(function (nums, k) {
  ok("oracle[pop] #" + k + " (n=" + nums.length + ")", function () {
    matchesOracle(fold(jsonl(nums)), twoPass(nums, false));
  });
});
corpus.forEach(function (nums, k) {
  if (nums.length < 2) return;
  ok("oracle[sample] #" + k, function () {
    matchesOracle(fold(jsonl(nums), { sample: true }), twoPass(nums, true));
  });
});

/* ============================= NUMERICAL STABILITY (the char of this gift) == */
// A tight cluster around a huge mean: true population variance = 2/3.
var HARD = [1e9, 1e9 + 1, 1e9 + 2];
ok("stability: gift matches two-pass on [1e9, 1e9+1, 1e9+2] (popvar 2/3)", function () {
  var r = fold(jsonl(HARD));
  var oracle = twoPass(HARD, false);
  assert.ok(close(r.variance, 2 / 3, 1e-6), "gift variance " + r.variance + " vs 2/3");
  assert.ok(close(r.variance, oracle.variance, 1e-6), "gift vs two-pass oracle");
});
ok("stability MUTATION BITE: the NAIVE shortcut is far off (proves gift isn't naive)", function () {
  var oracle = twoPass(HARD, false).variance; // ~0.6667, the true value
  var naive = naiveVariance(HARD);            // catastrophic cancellation -> ~0
  // The bite: if the gift were the naive method, it would fail the stability test.
  // Here we assert the naive method IS demonstrably wrong, so the stability test
  // above has real teeth (it is not vacuously satisfiable by any implementation).
  assert.ok(Math.abs(naive - oracle) > 1e-3,
    "naive shortcut should diverge from truth on this case (naive=" + naive + ", true=" + oracle + ")");
  // and the gift must be on the TRUTH side of that gap
  var gift = fold(jsonl(HARD)).variance;
  assert.ok(Math.abs(gift - oracle) < 1e-6, "gift must match truth, not the naive shortcut");
});
ok("stability: at 1e12 Welford stays BOUNDED near truth (0.5) where naive fails", function () {
  // Welford's guarantee is a BOUNDED, non-catastrophic error in ONE pass — not that
  // it beats a two-pass that can be exact. Here the two-pass mean (1e12+1) is exactly
  // representable so two-pass nails 0.5, while Welford drifts ~1.5e-5 (its incremental
  // mean passes through non-representable intermediates). That drift is small and
  // bounded; the naive sum-of-squares shortcut, by contrast, catastrophically cancels.
  var nums = [1e12, 1e12 + 1, 1e12 + 1, 1e12 + 2];
  var r = fold(jsonl(nums));
  assert.ok(Math.abs(r.variance - 0.5) < 5e-4, "Welford within 5e-4 of truth 0.5, got " + r.variance);
  var naive = naiveVariance(nums);
  assert.ok(Math.abs(naive - 0.5) > Math.abs(r.variance - 0.5), "naive is further from truth than Welford");
  // count/mean/min/max are still exact and must match the oracle
  var o = twoPass(nums, false);
  assert.strictEqual(r.count, o.count);
  assert.ok(close(r.mean, o.mean), "mean");
  assert.strictEqual(r.min, o.min);
  assert.strictEqual(r.max, o.max);
});

/* ==================================================== DETERMINISM & ORDER === */
ok("determinism: fold twice -> byte-identical record", function () {
  var t = jsonl([3, 1, 4, 1, 5, 9, 2, 6]);
  assert.strictEqual(JSON.stringify(fold(t)), JSON.stringify(fold(t)));
});
ok("order: reordered stream stays within float tolerance of the original", function () {
  // running-stats is a summary statistic: reordering may move the low-order bits
  // (float addition is not associative), but the result stays within tolerance.
  var base = [5, 1, 9, 3, 7, 2, 8, 4, 6];
  var rev = base.slice().reverse();
  var a = fold(jsonl(base)), b = fold(jsonl(rev));
  assert.ok(close(a.mean, b.mean), "mean invariant under reorder (within tol)");
  assert.ok(close(a.variance, b.variance), "variance invariant under reorder (within tol)");
  assert.strictEqual(a.count, b.count);
  assert.strictEqual(a.min, b.min);
  assert.strictEqual(a.max, b.max);
});

/* ============================================ NUMERIC HONESTY (fail closed) = */
ok("honesty: a NaN line throws (exit 2 in CLI)", function () {
  assert.throws(function () { fold("1\nNaN\n2"); });
});
ok("honesty: 1e999 (overflows to Infinity) throws", function () {
  assert.throws(function () { fold("1\n1e999\n2"); });
});
ok("honesty: a non-number JSON line throws", function () {
  assert.throws(function () { fold('1\n"x"\n2'); });
});
ok("honesty: a bad-JSON line throws", function () {
  assert.throws(function () { fold("1\nabc\n2"); });
});
ok("honesty: --sample with <2 values throws", function () {
  assert.throws(function () { fold(jsonl([5]), { sample: true }); });
});

/* ============================================================ SHAPE / EDGES = */
ok("empty stream -> count 0, all null", function () {
  assert.deepStrictEqual(fold(""), { count: 0, mean: null, variance: null, stddev: null, min: null, max: null });
});
ok("blank lines skipped, not counted", function () {
  var r = fold("1\n\n2\n\n3\n");
  assert.strictEqual(r.count, 3);
  assert.ok(close(r.mean, 2), "mean 2");
});
ok("CRLF line endings tolerated", function () {
  var r = fold("1\r\n2\r\n3\r\n");
  assert.strictEqual(r.count, 3);
  assert.ok(close(r.mean, 2), "mean");
});
ok("variance never negative (float artifact clamped to 0)", function () {
  var nums = [1e9, 1e9, 1e9, 1e9];
  var r = fold(jsonl(nums));
  assert.ok(r.variance >= 0, "variance >= 0");
  assert.ok(close(r.variance, 0), "variance ~0 for identical values");
});

/* ==================================================================== done = */
console.log((fail === 0 ? "GREEN" : "RED") + ": " + pass + " assertions passed, " + fail + " failed  [test_running-stats]");
process.exit(fail === 0 ? 0 : 1);
