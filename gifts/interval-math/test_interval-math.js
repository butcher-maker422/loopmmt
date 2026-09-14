#!/usr/bin/env node
/* test_interval-math.js — golden battery for the interval-math gift.

   Out-of-band and self-verifying. The oracle here is not an external library — it is
   the CONTAINMENT INVARIANT, which is self-witnessing:

     (1) CONTAINMENT. For each op and interval pair, sample a dense grid of x in a and
         y in b, compute (x op y) directly, and assert EVERY sampled result lies
         within the gift's returned [lo,hi]. A correct interval result cannot fail
         this; an under-wide (buggy) result will. This needs no external authority —
         the definition of interval arithmetic IS the test.

     (2) TIGHTNESS (a companion, so containment isn't passed by returning [-inf,inf]).
         For + - * / on continuous inputs the true result range endpoints are attained
         at interval corners, so the gift's [lo,hi] must EQUAL [min,max] of the sampled
         direct results to within a small epsilon — i.e. the interval is not just
         containing but tight.

     (3) FROZEN hand goldens — the sign-crossing multiply (the corner case), the
         subtraction flip, reciprocal division, and the division-spanning-zero refusal.

   A planted mutation (the bite, §BITE) MUST be caught: the naive multiply
   [a*c, b*d] (only two corners) is WRONG on a sign-crossing interval; the oracle
   (containment) must reject it.

   Run:  node test_interval-math.js   -> exit 0 GREEN / non-zero RED
*/
"use strict";
var im = require("./interval-math.js");

var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.log("  FAIL  " + name); }
}
function J(v) { return JSON.stringify(v); }
function giftOp(op, a, b) {
  var r = im.transform(J({ op: op, a: a, b: b }) + "\n");
  return JSON.parse(r.lines[0]); // {lo,hi}
}

// direct scalar op
function scalar(op, x, y) {
  if (op === "+") return x + y;
  if (op === "-") return x - y;
  if (op === "*") return x * y;
  if (op === "/") return x / y;
  throw new Error("bad op");
}
// sample N points across [lo,hi] inclusive
function grid(lo, hi, n) {
  if (lo === hi) return [lo];
  var out = [];
  for (var i = 0; i <= n; i++) out.push(lo + (hi - lo) * i / n);
  return out;
}

/* ---- (1)+(2) containment AND tightness over a spread of ops+intervals ----- */
(function () {
  var cases = [
    ["+", [1, 2], [3, 4]],
    ["-", [1, 2], [3, 4]],
    ["*", [-1, 2], [3, 4]],       // sign-crossing a
    ["*", [-3, -1], [-4, -2]],    // both negative
    ["*", [-2, 3], [-5, 4]],      // both sign-crossing (the hard corner case)
    ["*", [0, 5], [2, 3]],
    ["/", [1, 1], [2, 4]],
    ["/", [-6, 6], [2, 3]],       // numerator spans 0, denom positive
    ["/", [1, 2], [-4, -2]],      // denom strictly negative
    ["+", [-5, -5], [5, 5]],      // degenerate (points)
  ];
  var containFail = 0, tightFail = 0;
  cases.forEach(function (c) {
    var op = c[0], a = c[1], b = c[2];
    var got = giftOp(op, a, b);
    var xs = grid(a[0], a[1], 20), ys = grid(b[0], b[1], 20);
    var minR = Infinity, maxR = -Infinity, allIn = true;
    for (var i = 0; i < xs.length; i++) for (var j = 0; j < ys.length; j++) {
      var v = scalar(op, xs[i], ys[j]);
      if (v < minR) minR = v;
      if (v > maxR) maxR = v;
      if (v < got.lo - 1e-9 || v > got.hi + 1e-9) allIn = false;
    }
    if (!allIn) { containFail++; console.log("    CONTAIN " + op + " " + J(a) + J(b) + " -> " + J(got)); }
    // tightness: the gift's bounds equal the sampled extremes to epsilon
    if (Math.abs(got.lo - minR) > 1e-6 || Math.abs(got.hi - maxR) > 1e-6) {
      tightFail++; console.log("    TIGHT " + op + " " + J(a) + J(b) + " gift=" + J(got) + " sampled=[" + minR + "," + maxR + "]");
    }
  });
  ok("containment: every sampled x∘y lies in the gift interval (" + cases.length + " cases)", containFail === 0);
  ok("tightness: gift bounds == sampled extremes (" + cases.length + " cases)", tightFail === 0);
})();

/* ---- (3) frozen hand goldens --------------------------------------------- */
function G(name, op, a, b, lo, hi) {
  var g = giftOp(op, a, b);
  ok(name, g.lo === lo && g.hi === hi);
}
G("add", "+", [1, 2], [3, 4], 4, 6);
G("sub flips the other interval", "-", [1, 2], [3, 4], -3, -1);
G("mul sign-crossing (all four corners)", "*", [-1, 2], [3, 4], -4, 8);
G("mul both negative", "*", [-3, -1], [-4, -2], 2, 12);
G("mul both sign-crossing", "*", [-2, 3], [-5, 4], -15, 12);
G("div by positive interval", "/", [1, 1], [2, 4], 0.25, 0.5);
G("div numerator spans zero", "/", [-6, 6], [2, 3], -3, 3);
G("div by strictly-negative interval", "/", [1, 2], [-4, -2], -1, -0.25);

/* ---- (4) division-by-spanning-zero is a HARD ERROR ------------------------ */
function throws(name, fn) {
  var t = false;
  try { fn(); } catch (e) { t = true; }
  ok(name, t);
}
throws("div by [-1,1] (spans 0) refused", function () { giftOp("/", [1, 2], [-1, 1]); });
throws("div by [0,2] (touches 0 at lo) refused", function () { giftOp("/", [1, 2], [0, 2]); });
throws("div by [-2,0] (touches 0 at hi) refused", function () { giftOp("/", [1, 2], [-2, 0]); });
throws("div by [0,0] refused", function () { giftOp("/", [1, 2], [0, 0]); });

/* ---- (5) transform shape + input honesty --------------------------------- */
(function () {
  var text = '{"op":"+","a":[1,2],"b":[3,4]}\n{"op":"*","a":[0,1],"b":[2,2]}\n';
  var r = im.transform(text);
  ok("one output per input, in order", J(r.lines) === J(['{"lo":4,"hi":6}', '{"lo":0,"hi":2}']));
  ok("count == records", r.count === 2);
})();
ok("blank lines skipped", im.transform('{"op":"+","a":[1,1],"b":[1,1]}\n\n').count === 1);
ok("CRLF trimmed", J(im.transform('{"op":"+","a":[1,1],"b":[2,2]}\r\n').lines) === J(['{"lo":3,"hi":3}']));
(function () {
  var t = '{"op":"*","a":[-2,3],"b":[-5,4]}\n';
  ok("determinism: two runs identical", im.transform(t).lines.join() === im.transform(t).lines.join());
})();

throws("unknown op is a hard error", function () { giftOp("^", [1, 2], [3, 4]); });
throws("missing op is a hard error", function () { im.transform('{"a":[1,2],"b":[3,4]}\n'); });
throws("interval not a 2-array", function () { im.transform('{"op":"+","a":[1,2,3],"b":[3,4]}\n'); });
throws("interval lo>hi is a hard error", function () { im.transform('{"op":"+","a":[2,1],"b":[3,4]}\n'); });
throws("non-finite endpoint (1e999->Infinity) is a hard error", function () { im.transform('{"op":"+","a":[1e999,1e999],"b":[3,4]}\n'); });
throws("non-object record is a hard error", function () { im.transform('[1,2]\n'); });
throws("non-JSON line is a hard error", function () { im.transform('not json\n'); });
ok("hard error names the line", (function () {
  try { im.transform('{"op":"+","a":[1,1],"b":[2,2]}\n{"op":"?","a":[1,1],"b":[2,2]}\n'); return false; }
  catch (e) { return /line 2/.test(e.message); }
})());

/* ---- §BITE — the naive-multiply mutation must be caught ------------------- */
/* The classic wrong build is mul = [a*c, b*d] (only 2 corners). It agrees with the
   correct gift when signs don't cross, but is WRONG on a sign-crossing interval. We
   build that mutant and assert containment (the oracle) rejects it on a crossing
   case — so a regression to naive-corners fails test (1). */
(function () {
  function naiveMul(a, b) { return { lo: a[0] * b[0], hi: a[1] * b[1] }; }
  var a = [-2, 3], b = [-5, 4];
  var gift = giftOp("*", a, b);            // correct: [-15, 12]
  var mutant = naiveMul(a, b);             // naive: [10, 12]  (WRONG, misses -15 and lower)
  // containment check on the mutant: does a sampled product escape it?
  var xs = grid(a[0], a[1], 20), ys = grid(b[0], b[1], 20);
  var mutantEscapes = false, giftContains = true;
  for (var i = 0; i < xs.length; i++) for (var j = 0; j < ys.length; j++) {
    var v = xs[i] * ys[j];
    if (v < mutant.lo - 1e-9 || v > mutant.hi + 1e-9) mutantEscapes = true;
    if (v < gift.lo - 1e-9 || v > gift.hi + 1e-9) giftContains = false;
  }
  ok("BITE: naive-corners mutant fails containment where the gift holds",
     mutantEscapes === true && giftContains === true &&
     gift.lo === -15 && gift.hi === 12);
})();

/* ---- report --------------------------------------------------------------- */
console.log("");
console.log("interval-math battery: " + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
