#!/usr/bin/env node
/* test_junction.js — the golden corpus + determinism self-test + non-vacuity
   bites for the junction gift. Zero dependencies (Node assert only). This file
   IS the canonicalizer self-test the Plumb cites (Gift-Works Procedure v1 §2).

   Run:  node test_junction.js        # exit 0 GREEN / 3 RED
*/
"use strict";
var assert = require("assert");
var J = require("./junction.js");

var pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.error("FAIL: " + name + " — " + e.message); }
}

// A 3-branch fan, as fanout would emit it (records in declared order).
var FAN3 =
  '{"branch":"a","input":"the prompt","seq":0,"of":3}\n' +
  '{"branch":"b","input":"the prompt","seq":1,"of":3}\n' +
  '{"branch":"c","input":"the prompt","seq":2,"of":3}\n';

// ---- GOLDEN CORPUS: known-good half (one per policy) -----------------------
var GOLDEN = [
  {
    name: "concat: ordered list of inputs",
    text: FAN3, policy: "concat",
    expect: '{"policy":"concat","of":3,"merged":["the prompt","the prompt","the prompt"]}\n'
  },
  {
    name: "agree: identical branches collapse to the value",
    text: FAN3, policy: "agree",
    expect: '{"policy":"agree","of":3,"value":"the prompt"}\n'
  },
  {
    name: "first: the seq:0 branch's input",
    text: FAN3, policy: "first",
    expect: '{"policy":"first","of":3,"value":"the prompt"}\n'
  },
  {
    name: "map: branch->input object",
    text: FAN3, policy: "map",
    expect: '{"policy":"map","of":3,"by_branch":{"a":"the prompt","b":"the prompt","c":"the prompt"}}\n'
  },
  {
    name: "concat carries DECLARED order faithfully (distinct inputs)",
    text:
      '{"branch":"a","input":"A","seq":0,"of":3}\n' +
      '{"branch":"b","input":"B","seq":1,"of":3}\n' +
      '{"branch":"c","input":"C","seq":2,"of":3}\n',
    policy: "concat",
    expect: '{"policy":"concat","of":3,"merged":["A","B","C"]}\n'
  },
  {
    name: "input line-order does NOT leak (seq-sorted, not line-sorted)",
    // records delivered OUT of seq order; concat must restore seq order.
    text:
      '{"branch":"c","input":"C","seq":2,"of":3}\n' +
      '{"branch":"a","input":"A","seq":0,"of":3}\n' +
      '{"branch":"b","input":"B","seq":1,"of":3}\n',
    policy: "concat",
    expect: '{"policy":"concat","of":3,"merged":["A","B","C"]}\n'
  },
  {
    name: "multibyte payload fidelity through the merge",
    text: '{"branch":"m","input":"café🦌日本語","seq":0,"of":1}\n',
    policy: "agree",
    expect: '{"policy":"agree","of":1,"value":"café🦌日本語"}\n'
  }
];

GOLDEN.forEach(function (v) {
  check("golden: " + v.name, function () {
    assert.strictEqual(J.junction(v.text, v.policy), v.expect);
  });
});

// ---- FAIL-CLOSED: known-bad half (real defects) ---------------------------
var BAD = [
  { name: "no policy (unknown)", text: FAN3, policy: "", match: /unknown merge policy/ },
  { name: "unknown policy name", text: FAN3, policy: "bogus", match: /unknown merge policy/ },
  { name: "empty input", text: "", policy: "concat", match: /no input records/ },
  { name: "non-record line", text: "not a record\n", policy: "concat", match: /not valid JSON|not a fanout record/ },
  {
    name: "of disagrees with count",
    text: '{"branch":"a","input":"A","seq":0,"of":3}\n', // says of:3 but only 1 record
    policy: "concat", match: /disagrees with declared of/
  },
  {
    name: "duplicate seq",
    text:
      '{"branch":"a","input":"A","seq":0,"of":2}\n' +
      '{"branch":"b","input":"B","seq":0,"of":2}\n',
    policy: "concat", match: /duplicate seq/
  },
  {
    name: "agree conflict names the two branches",
    text:
      '{"branch":"a","input":"A","seq":0,"of":2}\n' +
      '{"branch":"b","input":"DIFFERENT","seq":1,"of":2}\n',
    policy: "agree", match: /agree conflict.*"a".*"b"/
  }
];

BAD.forEach(function (v) {
  check("fail-closed: " + v.name, function () {
    assert.throws(function () { J.junction(v.text, v.policy); }, v.match,
      "expected refusal for " + v.name);
  });
});

// ---- NON-VACUITY MUTATION BITES -------------------------------------------
check("mutation bite: a wrong merged value is rejected", function () {
  var wrong = '{"policy":"agree","of":3,"value":"WRONG"}\n';
  assert.notStrictEqual(J.junction(FAN3, "agree"), wrong,
    "the corpus must distinguish a wrong merged value");
});
check("mutation bite: agree must actually throw on a disagreement", function () {
  var threw = false;
  try {
    J.junction('{"branch":"a","input":"A","seq":0,"of":2}\n{"branch":"b","input":"B","seq":1,"of":2}\n', "agree");
  } catch (e) { threw = true; }
  assert.strictEqual(threw, true, "agree must refuse a disagreement — a non-throwing refuser has no teeth");
});

// ---- DETERMINISM SELF-TEST (the canonicalizer self-test, Gift-Works §2) ----
check("determinism: byte-identical across 25 evaluations", function () {
  var first = J.junction(FAN3, "map");
  for (var i = 0; i < 25; i++) {
    assert.strictEqual(J.junction(FAN3, "map"), first,
      "evaluation " + i + " diverged — merged output is not deterministic");
  }
});
check("determinism: input line-order is not faithful, seq order IS", function () {
  // Two line-orderings of the same fan must yield the SAME merged output
  // (the fold is over seq, so line-order is normalized away).
  var forward =
    '{"branch":"a","input":"A","seq":0,"of":2}\n' +
    '{"branch":"b","input":"B","seq":1,"of":2}\n';
  var reversed =
    '{"branch":"b","input":"B","seq":1,"of":2}\n' +
    '{"branch":"a","input":"A","seq":0,"of":2}\n';
  assert.strictEqual(J.junction(forward, "concat"), J.junction(reversed, "concat"),
    "line-order must not leak — the fold is over seq");
});

console.log((fail === 0 ? "GREEN" : "RED") + ": " + pass + " passed, " + fail + " failed");
process.exitCode = fail === 0 ? 0 : 3;
