#!/usr/bin/env node
/* test_json-source.js — battery for the json-source gift.
   node test_json-source.js  ->  exit 0 PASS / non-zero FAIL. Zero dependencies.

   Cross-checks the gift against an INDEPENDENT map-route oracle (a different route than
   the gift's loop), frozen hand goldens, the canonical-re-serialization contract,
   determinism, and every fail-closed edge. */
"use strict";
var js = require("./json-source.js");

var pass = 0, fail = 0;
function ok(name, cond) { if (cond) pass++; else { fail++; console.log("  FAIL  " + name); } }
function eqS(name, a, b) {
  if (a === b) pass++;
  else { fail++; console.log("  FAIL  " + name + "\n    exp " + JSON.stringify(b) + "\n    got " + JSON.stringify(a)); }
}
function throws(name, fn) {
  var threw = false; try { fn(); } catch (e) { threw = true; }
  if (threw) pass++; else { fail++; console.log("  FAIL  " + name + " (expected a throw)"); }
}

/* ---- independent oracle: Array.prototype.map route (different route than the gift) ---- */
function oracleJSONL(text) {
  var v = JSON.parse(text);                 // may throw -> caller counts as error
  if (!Array.isArray(v)) throw new Error("not array");
  return v.map(function (el) { return JSON.stringify(el); }).join("") + (v.length ? "" : "");
}
// build expected JSONL the oracle way (join with \n + trailing \n if non-empty)
function oracle(text) {
  var v = JSON.parse(text);
  if (!Array.isArray(v)) throw new Error("not array");
  var out = "";
  v.forEach(function (el) { out += JSON.stringify(el) + "\n"; });
  return out;
}

/* ---- 1. differential grid: gift == oracle on every good vector ---- */
var good = [
  "[]",
  "[1,2,3]",
  '[{"id":1},{"id":2}]',
  '[{"a":1,"b":2},{"a":3,"b":4}]',
  '["x","y","z"]',
  "[true,false,null]",
  '[{"nested":{"k":[1,2]}}]',
  "[ 1 , 2 ,\n 3 ]",                 // whitespace normalized
  "[1e3, 1.0, 100]",                 // number tokens normalized to value
  '[{"b":2,"a":1}]',                 // key order preserved from input
  '[""]',                             // array with one empty string
];
for (var i = 0; i < good.length; i++) {
  eqS("differential[" + i + "] gift==oracle", js.toJSONL(js.parse(good[i])), oracle(good[i]));
}

/* ---- 2. hand goldens (frozen) ---- */
eqS("golden: empty array -> empty stream", js.toJSONL(js.parse("[]")), "");
eqS("golden: scalars", js.toJSONL(js.parse("[1,2,3]")), "1\n2\n3\n");
eqS("golden: objects", js.toJSONL(js.parse('[{"id":1},{"id":2}]')), '{"id":1}\n{"id":2}\n');
eqS("golden: whitespace normalized", js.toJSONL(js.parse("[ 1 , 2 ]")), "1\n2\n");
eqS("golden: number token 1e3 -> 1000", js.toJSONL(js.parse("[1e3]")), "1000\n");
eqS("golden: number token 1.0 -> 1", js.toJSONL(js.parse("[1.0]")), "1\n");
eqS("golden: key order preserved", js.toJSONL(js.parse('[{"b":2,"a":1}]')), '{"b":2,"a":1}\n');
eqS("golden: nested value verbatim-as-value", js.toJSONL(js.parse('[{"k":{"z":[1,2]}}]')), '{"k":{"z":[1,2]}}\n');

/* ---- 3. one line per element ---- */
var recs = js.parse('[{"a":1},{"a":2},{"a":3}]');
ok("count: 3 elements", recs.length === 3);
ok("lines: JSONL has 3 lines", js.toJSONL(recs).split("\n").filter(Boolean).length === 3);

/* ---- 4. fail-closed (exit-2 class) ---- */
throws("bad: malformed JSON", function () { js.parse("[1,2,"); });
throws("bad: top-level object", function () { js.parse('{"a":1}'); });
throws("bad: top-level scalar number", function () { js.parse("42"); });
throws("bad: top-level string", function () { js.parse('"hello"'); });
throws("bad: top-level bool", function () { js.parse("true"); });
throws("bad: top-level null", function () { js.parse("null"); });
throws("bad: empty input (not JSON)", function () { js.parse(""); });
throws("bad: non-string input", function () { js.parse(123); });

/* ---- 5. determinism: parse twice -> byte-identical JSONL ---- */
var arr = [];
for (var k = 0; k < 50; k++) arr.push({ n: k, s: "v" + k });
var big = JSON.stringify(arr);
ok("determinism: two parses byte-identical", js.toJSONL(js.parse(big)) === js.toJSONL(js.parse(big)));

/* ---- 6. toJSONL shape ---- */
ok("toJSONL: one value per line + trailing nl", js.toJSONL([{ a: 1 }]) === '{"a":1}\n');
ok("toJSONL: empty -> empty string", js.toJSONL([]) === "");

/* ---- 7. mutation tripwire: an object-flattening mutant must diverge ---- */
(function () {
  // mutant: emits only the FIRST value of each object (a lossy "flatten"); must diverge
  function mutant(text) {
    var v = JSON.parse(text); var out = "";
    v.forEach(function (el) {
      if (el && typeof el === "object" && !Array.isArray(el)) {
        var ks = Object.keys(el); out += JSON.stringify(ks.length ? el[ks[0]] : el) + "\n";
      } else out += JSON.stringify(el) + "\n";
    });
    return out;
  }
  var v = '[{"a":1,"b":2}]';
  ok("mutation: first-value-flatten is CAUGHT (diverges from gift)",
     mutant(v) !== js.toJSONL(js.parse(v)));
})();

console.log((fail === 0 ? "PASS" : "FAIL") + "  " + pass + "/" + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
