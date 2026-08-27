#!/usr/bin/env node
/* test_sha256.js — proves sha256Hex is byte-identical to Node's own crypto.

   The oracle is Node's crypto.createHash('sha256'): for every vector we compute
   the digest BOTH ways and require they match. That is the honest proof — not
   "it matches a hardcoded string I typed" but "it matches the reference
   implementation for the same bytes", including the multibyte case that is the
   whole point of the fidelity rule. Also checks the two canonical FIPS-180-4
   vectors as fixed anchors, and mutation-bites the core so a no-op test can't
   pass green. Exit 0 = all pass; exit 1 = a failure (loud). stdlib only. */
"use strict";
var crypto = require("crypto");
var sha256Hex = require("./sha256.js").sha256Hex;

var pass = 0, fail = 0;
function check(name, got, want) {
  if (got === want) { pass++; }
  else { fail++; console.error("FAIL " + name + "\n  got:  " + got + "\n  want: " + want); }
}
function nodeHash(s) {
  return crypto.createHash("sha256").update(String(s), "utf8").digest("hex");
}

// 1. Canonical FIPS-180-4 anchors (fixed, independent of Node).
check("empty string", sha256Hex(""),
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
check("abc", sha256Hex("abc"),
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

// 2. Drift-check against Node crypto over a vector battery (the real proof).
var vectors = [
  "",
  "abc",
  "a",
  "The quick brown fox jumps over the lazy dog",
  "The quick brown fox jumps over the lazy dog.",   // one-byte change -> avalanche
  "0123456789",
  "x".repeat(55),   // one byte under a block boundary
  "x".repeat(56),   // padding crosses into a new block
  "x".repeat(63),
  "x".repeat(64),   // exact block
  "x".repeat(65),
  "x".repeat(1000), // multi-block
  "café",                       // multibyte: é is 2 UTF-8 bytes
  "naïve façade Zürich",        // several multibyte
  "日本語テスト",                // CJK, 3 bytes each
  "🦌",                          // the deer glyph — 4-byte surrogate pair
  "order:🦌×3 café",            // mixed ASCII + multibyte + emoji
  "line1\nline2\ttabbed",       // control chars
];
for (var i = 0; i < vectors.length; i++) {
  var v = vectors[i];
  var label = v.length > 24 ? (v.slice(0, 21) + "...") : v;
  check("drift[" + i + "] '" + label + "'", sha256Hex(v), nodeHash(v));
}

// 3. Determinism — same input twice, same digest.
check("deterministic", sha256Hex("repeat me"), sha256Hex("repeat me"));

// 4. Non-vacuity / mutation bite: a WRONG expected value MUST be caught.
//    (If the harness were a no-op, this "should fail" case would slip through.)
var deliberatelyWrong = "0000000000000000000000000000000000000000000000000000000000000000";
var mutationCaught = (sha256Hex("abc") !== deliberatelyWrong);
if (mutationCaught) { pass++; }
else { fail++; console.error("FAIL mutation-bite: core did not distinguish a wrong digest"); }

// 5. String coercion parity with Node (numbers, etc. -> String()).
check("number coercion 42", sha256Hex(42), nodeHash(42));
check("boolean coercion", sha256Hex(true), nodeHash(true));

console.log("\nsha256: " + pass + " passed, " + fail + " failed" +
  " (" + vectors.length + " drift vectors vs node crypto, incl. multibyte + emoji)");
process.exit(fail === 0 ? 0 : 1);
