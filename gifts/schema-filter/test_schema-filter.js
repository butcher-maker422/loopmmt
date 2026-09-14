#!/usr/bin/env node
/* test_schema-filter.js — out-of-band battery for the schema-filter gift.

   Exercises the exported pure core (filter / satisfies / matchType) against an
   INDEPENDENTLY authored oracle — a second, from-spec type checker written with a
   different route (a typeof/predicate map, not the gift's switch) — plus hand goldens
   and every documented edge. Node only; no dependencies. Exit 0 all-pass / 1 fail.
*/
"use strict";
var sf = require("./schema-filter.js");

var pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.log("  FAIL  " + name); }
}
function J(v) { return JSON.stringify(v); }

/* ---- independent oracle: a second, from-spec type checker ---------------- */
// Different route than the gift's switch: an explicit predicate table.
var ORACLE = {
  string:  function (v) { return typeof v === "string"; },
  number:  function (v) { return typeof v === "number" && v === v && v !== Infinity && v !== -Infinity; },
  integer: function (v) { return typeof v === "number" && v === v && v !== Infinity && v !== -Infinity && parseInt(v, 10) === v && v % 1 === 0; },
  boolean: function (v) { return v === true || v === false; },
  object:  function (v) { return typeof v === "object" && v !== null && !(v instanceof Array); },
  array:   function (v) { return v instanceof Array; },
  "null":  function (v) { return v === null; }
};
function oracleSatisfies(rec, c) {
  var has = Object.prototype.hasOwnProperty.call(rec, c.field);
  if (!has) return !!c.optional;
  return ORACLE[c.type](rec[c.field]);
}
function oracleSurvivors(recs, constraints) {
  return recs.filter(function (r) {
    return constraints.every(function (c) { return oracleSatisfies(r, c); });
  }).map(function (r) { return JSON.stringify(r); });
}
// Drive the gift's pure filter over a JSONL rendering of the records.
function giftSurvivors(recs, constraints) {
  var text = recs.map(function (r) { return JSON.stringify(r); }).join("\n") + "\n";
  return sf.filter(text, constraints).map(function (s) { return s.line; });
}

/* ---- matchType: every type, positive + negative ------------------------- */
var typeVectors = [
  ["string",  "hi", true], ["string", 5, false], ["string", null, false],
  ["number",  5, true], ["number", 5.5, true], ["number", "5", false], ["number", true, false],
  ["integer", 5, true], ["integer", 5.0, true], ["integer", 5.5, false], ["integer", "5", false],
  ["boolean", true, true], ["boolean", false, true], ["boolean", 0, false], ["boolean", "true", false],
  ["object",  {}, true], ["object", { a: 1 }, true], ["object", [], false], ["object", null, false],
  ["array",   [], true], ["array", [1, 2], true], ["array", {}, false], ["array", "x", false],
  ["null",    null, true], ["null", 0, false], ["null", "", false], ["null", {}, false]
];
typeVectors.forEach(function (v) {
  check("matchType(" + J(v[1]) + ", " + v[0] + ") === " + v[2], sf.matchType(v[1], v[0]) === v[2]);
  // cross-check against the independent oracle
  check("matchType == oracle [" + v[0] + ", " + J(v[1]) + "]", sf.matchType(v[1], v[0]) === ORACLE[v[0]](v[1]));
});

/* ---- the integer/number honesty distinction (the gift's sharp edge) ------ */
check("3.5 is number, NOT integer", sf.matchType(3.5, "number") === true && sf.matchType(3.5, "integer") === false);
check("3.0 IS integer (no fractional part)", sf.matchType(3.0, "integer") === true);
check("string \"3\" is NEITHER number nor integer (no coercion)",
  sf.matchType("3", "number") === false && sf.matchType("3", "integer") === false);

/* ---- scenario battery: gift filter == independent oracle ----------------- */
var scenarios = [
  {
    name: "single --field integer",
    recs: [{ n: 1 }, { n: 2.5 }, { n: "3" }, { n: 4 }],
    constraints: [{ field: "n", type: "integer", optional: false }]
  },
  {
    name: "two --field AND (name string + age integer)",
    recs: [
      { name: "a", age: 30 }, { name: "b", age: 30.5 }, { name: 5, age: 30 },
      { name: "c" }, { age: 40 }, { name: "d", age: 40 }
    ],
    constraints: [
      { field: "name", type: "string", optional: false },
      { field: "age", type: "integer", optional: false }
    ]
  },
  {
    name: "--field required missing DROPS",
    recs: [{ id: "has", x: "y" }, { id: "missing" }],
    constraints: [{ field: "x", type: "string", optional: false }]
  },
  {
    name: "--optional absent PASSES, present-wrong FAILS",
    recs: [{ id: "absent" }, { id: "ok", email: "e" }, { id: "wrong", email: 5 }],
    constraints: [{ field: "email", type: "string", optional: true }]
  },
  {
    name: "array + object + boolean + null types",
    recs: [
      { tags: [], meta: {}, active: true, deleted: null },
      { tags: {}, meta: {}, active: true, deleted: null },
      { tags: [], meta: [], active: true, deleted: null },
      { tags: [], meta: {}, active: 1, deleted: null },
      { tags: [], meta: {}, active: true, deleted: 0 }
    ],
    constraints: [
      { field: "tags", type: "array", optional: false },
      { field: "meta", type: "object", optional: false },
      { field: "active", type: "boolean", optional: false },
      { field: "deleted", type: "null", optional: false }
    ]
  },
  {
    name: "no constraints = identity",
    recs: [{ a: 1 }, { b: 2 }, { c: 3 }],
    constraints: []
  }
];
scenarios.forEach(function (s) {
  check("gift == oracle [" + s.name + "]", J(giftSurvivors(s.recs, s.constraints)) === J(oracleSurvivors(s.recs, s.constraints)));
});

/* ---- hand goldens (independent of the oracle) ---------------------------- */
check("golden: integer keeps [1,4], drops 2.5 and \"3\"",
  J(giftSurvivors([{ n: 1 }, { n: 2.5 }, { n: "3" }, { n: 4 }], [{ field: "n", type: "integer", optional: false }]))
  === J([JSON.stringify({ n: 1 }), JSON.stringify({ n: 4 })]));
check("golden: optional absent kept, wrong-type dropped",
  J(giftSurvivors([{ id: "absent" }, { id: "wrong", email: 5 }], [{ field: "email", type: "string", optional: true }]))
  === J([JSON.stringify({ id: "absent" })]));

/* ---- verbatim passthrough + order-stability ------------------------------ */
(function () {
  var text = '{"z":1,"a":2}\n{"b":3}\n';  // key order preserved verbatim, not re-serialized
  var got = sf.filter(text, [{ field: "z", type: "integer", optional: false }]).map(function (s) { return s.line; });
  check("verbatim: original line returned (key order preserved)", J(got) === J(['{"z":1,"a":2}']));
})();
(function () {
  var recs = [{ n: 5 }, { n: 1 }, { n: 9 }, { n: 2 }];
  var got = giftSurvivors(recs, [{ field: "n", type: "integer", optional: false }]);
  check("order-stable (5,1,9,2 preserved)",
    J(got) === J([JSON.stringify({ n: 5 }), JSON.stringify({ n: 1 }), JSON.stringify({ n: 9 }), JSON.stringify({ n: 2 })]));
})();

/* ---- CRLF + blank lines -------------------------------------------------- */
(function () {
  var text = '{"n":1}\r\n\r\n{"n":2}\r\n';
  var got = sf.filter(text, [{ field: "n", type: "integer", optional: false }]).map(function (s) { return s.line; });
  check("CRLF trimmed, blank lines skipped", J(got) === J(['{"n":1}', '{"n":2}']));
})();

/* ---- strictness: non-object lines throw --------------------------------- */
function throws(text, constraints) {
  try { sf.filter(text, constraints); return false; } catch (e) { return true; }
}
check("bare number line throws", throws("42\n", []));
check("array line throws", throws("[1,2]\n", []));
check("string line throws", throws('"hi"\n', []));
check("null line throws", throws("null\n", []));
check("malformed JSON throws", throws("{bad\n", []));
check("well-formed object does NOT throw", !throws('{"a":1}\n', []));

/* ---- determinism: two runs identical ------------------------------------ */
(function () {
  var recs = scenarios[1].recs, cs = scenarios[1].constraints;
  check("deterministic across two filter() calls", J(giftSurvivors(recs, cs)) === J(giftSurvivors(recs, cs)));
})();

console.log("");
var verdict = fail === 0 ? "PASS" : "FAIL";
console.log(verdict + ": " + pass + " checks passed, " + fail + " failed  [test_schema-filter]");
process.exit(fail === 0 ? 0 : 1);
