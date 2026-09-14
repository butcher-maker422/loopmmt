#!/usr/bin/env node
/* test_base-n.js — the external battery for base-n.

   The conformance discipline for this gift (the pattern-to-law trap this line
   keeps getting bitten by): the oracle must come from the COMMISSION — what a
   base-N numeral physically IS — NOT from the gift's own implementation re-run.

   So the oracle here is an INDEPENDENT positional-value computation:
     value(numeral, base) = Σ digit_i * base^(position_i)
   written from scratch with a hand-rolled digit table, and a repeated-division
   formatter written from scratch, neither of which imports base-n's internals.
   The round-trip invariant (to B then from B is the identity on the value) is the
   falsifier: it holds only if BOTH directions are correct, at any size.

   Zero deps. Run: node test_base-n.js   (exit 0 = all pass, 1 = a failure).
*/

"use strict";

var bn = require("./base-n.js");

var passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error("FAIL: " + name); }
}
function eq(name, got, want) {
  if (got === want) { passed++; }
  else { failed++; console.error("FAIL: " + name + "  got=" + JSON.stringify(got) + " want=" + JSON.stringify(want)); }
}
function throws(name, fn, checkField) {
  try { fn(); failed++; console.error("FAIL: " + name + "  (expected throw, none)"); }
  catch (e) {
    if (checkField && !checkField(e)) { failed++; console.error("FAIL: " + name + "  (wrong error shape): " + e.message); }
    else { passed++; }
  }
}

// ---- INDEPENDENT ORACLE (from the commission, not from base-n) ----------

var ORACLE_DIGITS = {};
(function () {
  var chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  for (var i = 0; i < chars.length; i++) ORACLE_DIGITS[chars[i]] = i;
})();

// oracleValue: numeral (in base `from`) -> BigInt, by Horner's positional rule,
// written independently. Mirrors ONLY the mathematical definition, no base-n code.
function oracleValue(numeral, from) {
  var s = String(numeral).trim();
  var neg = false, start = 0;
  if (s[0] === "-") { neg = true; start = 1; }
  else if (s[0] === "+") { start = 1; }
  var B = BigInt(from);
  var acc = 0n, saw = false;
  for (var i = start; i < s.length; i++) {
    var ch = s[i];
    if (ch === "_") continue;
    var lc = ch.toLowerCase();
    if (!(lc in ORACLE_DIGITS) || ORACLE_DIGITS[lc] >= from) {
      throw new Error("oracle: illegal digit " + ch);
    }
    acc = acc * B + BigInt(ORACLE_DIGITS[lc]);
    saw = true;
  }
  if (!saw) throw new Error("oracle: empty");
  return neg ? -acc : acc;
}

// oracleFormat: BigInt -> numeral in base `to`, independent repeated division.
function oracleFormat(n, to) {
  n = BigInt(n);
  if (n === 0n) return "0";
  var neg = n < 0n; if (neg) n = -n;
  var B = BigInt(to);
  var chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  var out = "";
  while (n > 0n) { out = chars[Number(n % B)] + out; n = n / B; }
  return neg ? "-" + out : out;
}

// ---- 1. Known literals (hand-checked, small, unambiguous) ---------------

eq("dec 255 -> hex", bn.convert("255", 10, 16), "ff");
eq("hex ff -> dec", bn.convert("ff", 16, 10), "255");
eq("dec 255 -> bin", bn.convert("255", 10, 2), "11111111");
eq("bin 11111111 -> hex", bn.convert("11111111", 2, 16), "ff");
eq("dec 0 -> any base is 0", bn.convert("0", 10, 7), "0");
eq("base36 z -> dec 35", bn.convert("z", 36, 10), "35");
eq("dec 35 -> base36 z", bn.convert("35", 10, 36), "z");
eq("uppercase input folds", bn.convert("FF", 16, 10), "255");
eq("output is lowercase", bn.convert("255", 10, 16), "ff");
eq("negative preserved", bn.convert("-255", 10, 16), "-ff");
eq("plus sign accepted", bn.convert("+ff", 16, 10), "255");
eq("underscore separators ignored", bn.convert("1_000", 10, 2), bn.convert("1000", 10, 2));
eq("leading/trailing ws trimmed", bn.convert("  ff  ", 16, 10), "255");

// ---- 2. ORACLE agreement over a matrix of values x bases ----------------

var testVals = [0n, 1n, 2n, 9n, 10n, 15n, 16n, 35n, 36n, 255n, 256n, 1023n, 1000000n,
                123456789012345678901234567890n, -1n, -255n, -1000000n];
var testBases = [2, 3, 8, 10, 16, 36];
for (var vi = 0; vi < testVals.length; vi++) {
  for (var bi = 0; bi < testBases.length; bi++) {
    var v = testVals[vi], B = testBases[bi];
    // base-n's format vs the independent oracle's format
    var got = bn.fromBigInt(v, B);
    var want = oracleFormat(v, B);
    eq("fromBigInt " + v + " base " + B + " == oracle", got, want);
    // base-n's parse vs the independent oracle's value
    var parsed = bn.toBigInt(want, B);
    ok("toBigInt(oracleFormat(" + v + "," + B + ")) == " + v, parsed === v);
  }
}

// ---- 3. ROUND-TRIP invariant (the falsifier): to B then from B = identity

var rtVals = ["0", "1", "255", "4294967295", "18446744073709551615",
              "340282366920938463463374607431768211455",  // 2^128 - 1
              "-987654321987654321"];
for (var ri = 0; ri < rtVals.length; ri++) {
  for (var rbi = 0; rbi < testBases.length; rbi++) {
    var dec = rtVals[ri], TB = testBases[rbi];
    var encoded = bn.convert(dec, 10, TB);
    var back = bn.convert(encoded, TB, 10);
    // canonicalize the input decimal through the oracle so "0"/"-0" etc. match
    eq("round-trip " + dec + " via base " + TB, back, oracleFormat(oracleValue(dec, 10), 10));
  }
}

// ---- 4. Cross-base composition round-trip (any B1 -> B2 -> B1) -----------

var comboVals = [42n, 65535n, 999999999999n, 0n, 7n];
for (var ci = 0; ci < comboVals.length; ci++) {
  for (var f = 0; f < testBases.length; f++) {
    for (var t = 0; t < testBases.length; t++) {
      var val = comboVals[ci], F = testBases[f], T = testBases[t];
      var inF = bn.fromBigInt(val, F);
      var inT = bn.convert(inF, F, T);
      var backF = bn.convert(inT, T, F);
      eq("compose " + val + " " + F + "->" + T + "->" + F, backF, inF);
    }
  }
}

// ---- 5. Fail-closed: illegal digit, bad base, empty ---------------------

throws("digit 2 illegal in base 2", function () { bn.convert("12", 2, 10); },
  function (e) { return e.name === "BaseNError" && e.digit === "2" && e.base === 2 && e.offset === 1; });
throws("digit g illegal in base 16", function () { bn.convert("fg", 16, 10); },
  function (e) { return e.name === "BaseNError" && e.digit === "g"; });
throws("base 1 rejected (from)", function () { bn.convert("1", 1, 10); },
  function (e) { return e.name === "BaseNError"; });
throws("base 37 rejected (to)", function () { bn.convert("1", 10, 37); },
  function (e) { return e.name === "BaseNError"; });
throws("base 0 rejected", function () { bn.convert("1", 10, 0); },
  function (e) { return e.name === "BaseNError"; });
throws("non-integer base rejected", function () { bn.validateBase(2.5); },
  function (e) { return e.name === "BaseNError"; });
throws("empty numeral rejected", function () { bn.toBigInt("   ", 10); },
  function (e) { return e.name === "BaseNError"; });
throws("sign only, no digits, rejected", function () { bn.toBigInt("-", 10); },
  function (e) { return e.name === "BaseNError"; });
throws("underscore only, no digits, rejected", function () { bn.toBigInt("__", 10); },
  function (e) { return e.name === "BaseNError"; });

// The offset in the error names the RIGHT position (0-indexed into the raw string)
throws("offset names the right character", function () { bn.convert("ff!", 16, 10); },
  function (e) { return e.name === "BaseNError" && e.offset === 2 && e.digit === "!"; });

// ---- 6. Determinism: same input, byte-identical output, repeated --------

(function () {
  var a = bn.convert("123456789012345678901234567890", 10, 36);
  var b = bn.convert("123456789012345678901234567890", 10, 36);
  eq("deterministic (run 1 == run 2)", a, b);
  // And the value survives a full round trip losslessly
  eq("big value lossless round trip", bn.convert(a, 36, 10), "123456789012345678901234567890");
})();

// ---- 7. Boundary values around Number's exact-integer ceiling -----------

// 2^53 and 2^53+1 are where Number silently loses precision; BigInt must not.
eq("2^53 exact to hex", bn.convert("9007199254740992", 10, 16), "20000000000000");
eq("2^53+1 exact to hex", bn.convert("9007199254740993", 10, 16), "20000000000001");
ok("2^53 and 2^53+1 differ after round trip",
   bn.convert("9007199254740992", 10, 16) !== bn.convert("9007199254740993", 10, 16));

// ---- report -------------------------------------------------------------

console.log("base-n battery: " + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
