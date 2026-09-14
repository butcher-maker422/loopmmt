#!/usr/bin/env node
/* test_seq-source.js — out-of-band battery for the seq-source gift.

   Cross-checks generate() against an INDEPENDENT oracle — a from-spec second builder
   that constructs each term with an explicit accumulator loop (start += step) rather
   than the gift's `start + i*step` closed form, so the two routes agree only if the
   arithmetic is right — plus hand goldens and every documented honesty edge.
   Node only; no dependencies. Exit 0 all-pass / 1 fail.
*/
"use strict";
var ss = require("./seq-source.js");

var pass = 0, fail = 0;
function check(name, cond) { if (cond) pass++; else { fail++; console.log("  FAIL  " + name); } }
function J(v) { return JSON.stringify(v); }

/* ---- independent oracle: accumulator route (not the closed form) --------- */
function oracle(opts) {
  var count = opts.count, start = opts.start === undefined ? 0 : opts.start;
  var step = opts.step === undefined ? 1 : opts.step, field = opts.field === undefined ? "n" : opts.field;
  var out = [], acc = start;
  for (var i = 0; i < count; i++) { var r = {}; r[field] = acc; out.push(r); acc += step; }
  return out;
}
function giftJSONL(opts) { return ss.toJSONL(ss.generate(opts)); }
function oracleJSONL(opts) { return ss.toJSONL(oracle(opts)); }

/* ---- gift == independent oracle across a grid ---------------------------- */
var grid = [
  { count: 5 },
  { count: 5, start: 10, step: 5 },
  { count: 3, start: 100, step: -1, field: "id" },
  { count: 1, start: -7 },
  { count: 4, start: 0, step: 0 },       // constant sequence
  { count: 10, start: -5, step: 2 },
  { count: 0 },                           // empty stream
  { count: 6, step: -3 }
];
grid.forEach(function (o) {
  check("gift == oracle [" + J(o) + "]", giftJSONL(o) === oracleJSONL(o));
});

/* ---- hand goldens -------------------------------------------------------- */
check("golden: count 5 default == {n:0}..{n:4}",
  giftJSONL({ count: 5 }) === '{"n":0}\n{"n":1}\n{"n":2}\n{"n":3}\n{"n":4}\n');
check("golden: count 3 start 10 step 5",
  giftJSONL({ count: 3, start: 10, step: 5 }) === '{"n":10}\n{"n":15}\n{"n":20}\n');
check("golden: count 3 field id start 100",
  giftJSONL({ count: 3, start: 100, field: "id" }) === '{"id":100}\n{"id":101}\n{"id":102}\n');
check("golden: negative step counts down",
  giftJSONL({ count: 4, start: 3, step: -1 }) === '{"n":3}\n{"n":2}\n{"n":1}\n{"n":0}\n');

/* ---- count 0 emits empty, is a valid stream ------------------------------ */
check("count 0 -> empty string", giftJSONL({ count: 0 }) === "");
check("count 0 -> generate returns []", J(ss.generate({ count: 0 })) === J([]));

/* ---- single-key records + correct field ---------------------------------- */
(function () {
  var recs = ss.generate({ count: 2, field: "x", start: 9, step: 3 });
  check("records single-key with declared field", J(recs) === J([{ x: 9 }, { x: 12 }]));
})();

/* ---- determinism --------------------------------------------------------- */
check("deterministic across two generate() calls",
  giftJSONL({ count: 20, start: -3, step: 7 }) === giftJSONL({ count: 20, start: -3, step: 7 }));

/* ---- honesty: flag-don't-fake (throw on bad opts) ------------------------ */
function throws(opts) { try { ss.generate(opts); return false; } catch (e) { return true; } }
check("missing count throws", throws({ start: 5 }));
check("non-integer count throws", throws({ count: 2.5 }));
check("negative count throws", throws({ count: -1 }));
check("non-integer start throws", throws({ count: 3, start: 1.5 }));
check("non-integer step throws", throws({ count: 3, step: 0.1 }));
check("empty field throws", throws({ count: 3, field: "" }));
check("string count throws (no coercion at the API)", throws({ count: "5" }));
check("valid opts do NOT throw", !throws({ count: 3, start: 0, step: 1, field: "n" }));

console.log("");
var verdict = fail === 0 ? "PASS" : "FAIL";
console.log(verdict + ": " + pass + " checks passed, " + fail + " failed  [test_seq-source]");
process.exit(fail === 0 ? 0 : 1);
