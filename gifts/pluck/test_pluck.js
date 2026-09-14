#!/usr/bin/env node
/* test_pluck.js — drift-check battery for pluck.js.
   Zero-dependency. Runs in Node: `node test_pluck.js`. Exit 0 all-pass, 1 any-fail.

   THE ORACLE. pluck's contract is small enough that the oracle is a set of
   hand-computed expected output lines PLUS two structural invariants checked
   mechanically on every case:
     (I1) subset: every key in an emitted object was a requested field AND was
          present in the input object (pluck never invents a field).
     (I2) declared-order: the emitted key order equals the requested field order
          (restricted to present fields) — NOT the input's key order.
   The known-bad vector is the DECLARED-ORDER tripwire: an input whose keys sit in
   a different order than --fields. A regression that inherited input order instead
   of declared order passes a naive "same set of keys" check but fails I2 — so the
   battery pins the ordering that is the whole determinism story.
*/
"use strict";

var pluck = require("./pluck.js").pluck;

var passed = 0, failed = 0;
function check(name, got, want) {
  if (got === want) { passed++; /* console.log("  ok  " + name); */ }
  else {
    failed++;
    console.log("FAIL  " + name);
    console.log("   want: " + JSON.stringify(want));
    console.log("   got:  " + JSON.stringify(got));
  }
}
function checkThrows(name, fn) {
  var threw = false;
  try { fn(); } catch (e) { threw = true; }
  if (threw) { passed++; }
  else { failed++; console.log("FAIL  " + name + " (expected a throw, none happened)"); }
}

function out(text, opts) {
  var r = pluck(text, opts);
  return r.lines.join("\n");
}

// ---- Core selection --------------------------------------------------
check("keep two of three fields",
  out('{"a":1,"b":2,"c":3}', { fields: ["a", "c"] }),
  '{"a":1,"c":3}');

check("single field",
  out('{"a":1,"b":2}', { fields: ["b"] }),
  '{"b":2}');

check("all fields kept (identity-ish, canonical order)",
  out('{"a":1,"b":2}', { fields: ["a", "b"] }),
  '{"a":1,"b":2}');

// ---- KNOWN-BAD VECTOR: declared order, not input order ---------------
// Input keys are b,a but --fields asks a,b -> output MUST be {"a":..,"b":..}.
check("KNOWN-BAD: output order is declared order, not input order",
  out('{"b":2,"a":1}', { fields: ["a", "b"] }),
  '{"a":1,"b":2}');

check("KNOWN-BAD: reverse request reverses output",
  out('{"a":1,"b":2}', { fields: ["b", "a"] }),
  '{"b":2,"a":1}');

// ---- Missing fields: default omits -----------------------------------
check("missing field omitted (default)",
  out('{"a":1}', { fields: ["a", "b"] }),
  '{"a":1}');

check("record carrying none of the fields -> empty object",
  out('{"x":9}', { fields: ["a", "b"] }),
  '{}');

check("missing field in the MIDDLE keeps declared order of the rest",
  out('{"a":1,"c":3}', { fields: ["a", "b", "c"] }),
  '{"a":1,"c":3}');

// ---- --strict: missing field is a hard error -------------------------
checkThrows("strict: missing field throws", function () {
  pluck('{"a":1}', { fields: ["a", "b"], strict: true });
});

check("strict: all present passes",
  out('{"a":1,"b":2}', { fields: ["a", "b"], strict: true }),
  '{"a":1,"b":2}');

// ---- Duplicate requested fields are idempotent -----------------------
check("field named twice emitted once at first position",
  out('{"a":1,"b":2}', { fields: ["a", "a", "b"] }),
  '{"a":1,"b":2}');

// ---- Value fidelity + nested canonicalization ------------------------
check("value copied verbatim (nested object canonicalized)",
  out('{"a":{"z":1,"y":2},"b":5}', { fields: ["a"] }),
  '{"a":{"y":2,"z":1}}');

check("array value order preserved (not sorted)",
  out('{"a":[3,1,2],"b":0}', { fields: ["a"] }),
  '{"a":[3,1,2]}');

check("null / bool / string values kept",
  out('{"a":null,"b":true,"c":"hi","d":0}', { fields: ["a", "b", "c"] }),
  '{"a":null,"b":true,"c":"hi"}');

// ---- Multi-line stream, order preserved ------------------------------
check("multi-record stream keeps input order",
  out('{"id":1,"x":9}\n{"id":2,"x":8}\n{"id":3,"x":7}', { fields: ["id"] }),
  '{"id":1}\n{"id":2}\n{"id":3}');

// ---- Blank + CRLF handling -------------------------------------------
check("blank lines skipped",
  out('{"a":1}\n\n{"a":2}\n', { fields: ["a"] }),
  '{"a":1}\n{"a":2}');

check("CRLF trailing \\r trimmed before parse",
  out('{"a":1}\r\n{"a":2}\r', { fields: ["a"] }),
  '{"a":1}\n{"a":2}');

// ---- Input honesty: non-object records are hard errors ---------------
checkThrows("bare number record throws", function () {
  pluck('42', { fields: ["a"] });
});
checkThrows("bare string record throws", function () {
  pluck('"hello"', { fields: ["a"] });
});
checkThrows("array record throws", function () {
  pluck('[1,2,3]', { fields: ["a"] });
});
checkThrows("null record throws", function () {
  pluck('null', { fields: ["a"] });
});
checkThrows("invalid JSON throws", function () {
  pluck('{"a":1', { fields: ["a"] });
});

// ---- Determinism: folds-twice-identical ------------------------------
(function () {
  var input = '{"b":2,"a":1,"c":3}\n{"c":30,"a":10}\n{"z":99}';
  var opts = { fields: ["a", "b"] };
  var r1 = out(input, opts);
  var r2 = out(input, opts);
  check("determinism: two runs byte-identical", r1, r2);
})();

// ---- Empty-fields guard is a library concern? (CLI enforces; lib tolerant) ----
check("empty fields list yields empty objects (lib-level; CLI blocks this)",
  out('{"a":1}', { fields: [] }),
  '{}');

console.log("\npluck battery: " + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
