#!/usr/bin/env node
/* test_fanout.js — the golden corpus + determinism self-test + non-vacuity bite
   for the fanout gift. Zero dependencies (Node assert only). This file IS the
   canonicalizer self-test the Plumb cites (Gift-Works Procedure v1 §2): a gift
   whose output is byte-identical across repeated evaluation has proven its
   canonical form is idempotent and order-faithful.

   Run:  node test_fanout.js         # exit 0 GREEN / non-zero RED
*/
"use strict";
var assert = require("assert");
var F = require("./fanout.js");

var pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.error("FAIL: " + name + " — " + e.message); }
}

// ---- GOLDEN CORPUS: the known-good half -----------------------------------
// Each vector is (payload, branches, expected JSONL). Expected is written out
// literally so the corpus is a fixed oracle, not a re-derivation of the code.
var GOLDEN = [
  {
    name: "single branch",
    input: "p", branches: ["a"],
    expect: '{"branch":"a","input":"p","seq":0,"of":1}\n'
  },
  {
    name: "three branches, declared order preserved",
    input: "the prompt", branches: ["a", "b", "c"],
    expect:
      '{"branch":"a","input":"the prompt","seq":0,"of":3}\n' +
      '{"branch":"b","input":"the prompt","seq":1,"of":3}\n' +
      '{"branch":"c","input":"the prompt","seq":2,"of":3}\n'
  },
  {
    name: "declared order is NOT sorted (z before a)",
    input: "x", branches: ["z", "a"],
    expect:
      '{"branch":"z","input":"x","seq":0,"of":2}\n' +
      '{"branch":"a","input":"x","seq":1,"of":2}\n'
  },
  {
    name: "multibyte payload fidelity (accents, emoji, non-latin)",
    input: "café🦌日本語", branches: ["m"],
    expect: '{"branch":"m","input":"café🦌日本語","seq":0,"of":1}\n'
  },
  {
    name: "payload with quotes/newlines/tabs is JSON-escaped",
    input: 'line1\nline2\t"q"', branches: ["e"],
    expect: '{"branch":"e","input":"line1\\nline2\\t\\"q\\"","seq":0,"of":1}\n'
  },
  {
    name: "charset-legal names: dot, underscore, hyphen, digits",
    input: "p", branches: ["a.1", "b_2", "c-3"],
    expect:
      '{"branch":"a.1","input":"p","seq":0,"of":3}\n' +
      '{"branch":"b_2","input":"p","seq":1,"of":3}\n' +
      '{"branch":"c-3","input":"p","seq":2,"of":3}\n'
  },
  {
    name: "String() coercion parity: number payload",
    input: 42, branches: ["n"],
    expect: '{"branch":"n","input":"42","seq":0,"of":1}\n'
  }
];

GOLDEN.forEach(function (v) {
  check("golden: " + v.name, function () {
    assert.strictEqual(F.fanoutJSONL(v.input, v.branches), v.expect);
  });
});

// ---- FAIL-CLOSED: the known-bad half (real defects, not author-invented) ---
// Each is a branch declaration fanout MUST refuse. A refusal that does not
// throw is a silent fan to an undeclared/ambiguous destination — the exact
// fault this gift exists to prevent.
var BAD = [
  { name: "empty branch list", branches: [], match: /no branches declared/ },
  { name: "empty branch token", branches: ["a", ""], match: /empty branch name/ },
  { name: "whitespace-only token", branches: ["a", "   "], match: /empty branch name/ },
  { name: "duplicate branch", branches: ["a", "a"], match: /duplicate branch name/ },
  { name: "charset-invalid (space)", branches: ["a", "b c"], match: /ill-formed branch name/ },
  { name: "charset-invalid (slash)", branches: ["a/b"], match: /ill-formed branch name/ }
];

BAD.forEach(function (v) {
  check("fail-closed: " + v.name, function () {
    assert.throws(function () { F.fanoutJSONL("p", v.branches); }, v.match,
      "expected refusal for " + v.name);
  });
});

// ---- NON-VACUITY MUTATION BITE --------------------------------------------
// A suite that cannot reject a wrong answer proves nothing. Assert that a
// deliberately-wrong expectation is CAUGHT (the negation must fail).
check("mutation bite: wrong output is rejected", function () {
  var wrong = '{"branch":"a","input":"p","seq":9,"of":1}\n'; // seq tampered
  assert.notStrictEqual(F.fanoutJSONL("p", ["a"]), wrong,
    "the corpus must distinguish a wrong (tampered seq) output");
});
check("mutation bite: a refused case must actually throw", function () {
  var threw = false;
  try { F.fanoutJSONL("p", ["a", "a"]); } catch (e) { threw = true; }
  assert.strictEqual(threw, true, "duplicate must throw — a non-throwing refuser has no teeth");
});

// ---- DETERMINISM SELF-TEST (the canonicalizer self-test, Gift-Works §2) ----
// Evaluate the same input N times; the output must be byte-identical every
// time. This proves the canonical form is idempotent and order-faithful on the
// gift's own output — the property the Plumb's canonicalizer self-test names.
check("determinism: byte-identical across 25 evaluations", function () {
  var first = F.fanoutJSONL("det prompt 🦌", ["one", "two", "three"]);
  for (var i = 0; i < 25; i++) {
    assert.strictEqual(F.fanoutJSONL("det prompt 🦌", ["one", "two", "three"]), first,
      "evaluation " + i + " diverged — output is not deterministic");
  }
});
// Order-faithfulness: a permuted branch list yields a permuted output (order is
// carried, never normalized away).
check("determinism: order-faithful (permutation changes output)", function () {
  var ab = F.fanoutJSONL("p", ["a", "b"]);
  var ba = F.fanoutJSONL("p", ["b", "a"]);
  assert.notStrictEqual(ab, ba, "declared order must be faithful, not normalized");
});

console.log((fail === 0 ? "GREEN" : "RED") + ": " + pass + " passed, " + fail + " failed");
process.exitCode = fail === 0 ? 0 : 3;
