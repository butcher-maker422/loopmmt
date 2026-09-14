#!/usr/bin/env node
/* test_life-fold.js — external battery for the life-fold gift.
 *
 *   node test_life-fold.js   ->  exit 0 GREEN / non-zero RED
 *
 * Proves Conway B3/S23 correctness on known patterns (blinker oscillator, block
 * still-life, glider translation on an unbounded grid), the TIER-B closure property
 * (--steps N equals piping the fold into itself N times -- the trace ↻ loop), plus
 * determinism, order-independence, empty/steps-0, dedup, and numeric-honesty errors.
 */
"use strict";
var assert = require("assert");
var m = require("./life-fold.js");
var fold = m.fold;

var pass = 0, fail = 0;
function ok(name, cond) { if (cond) pass++; else { fail++; console.error("  RED  " + name); } }
function throws(name, fn) { try { fn(); fail++; console.error("  RED  " + name + " (did not throw)"); } catch (e) { pass++; } }
function J(v) { return JSON.stringify(v); }
function jsonl(cells) { return cells.map(function (c) { return J(c); }).join("\n"); }

/* re-serialize a fold result back to JSONL (to feed it into itself) */
function toJSONL(rec) { return rec.cells.map(function (c) { return J(c); }).join("\n"); }

/* ---- blinker: 3 in a row oscillates with period 2 -------------------------- */
var blinkerH = [[0, 0], [1, 0], [2, 0]];
var blinkerV = [[1, -1], [1, 0], [1, 1]];
ok("blinker horizontal -> vertical (1 step)", J(fold(jsonl(blinkerH), { steps: 1 }).cells) === J(blinkerV));
ok("blinker vertical -> horizontal (1 step)", J(fold(jsonl(blinkerV), { steps: 1 }).cells) === J(blinkerH));
ok("blinker period 2 (2 steps == identity)", J(fold(jsonl(blinkerH), { steps: 2 }).cells) === J(blinkerH));

/* ---- block: 2x2 still-life is unchanged forever ---------------------------- */
var block = [[0, 0], [0, 1], [1, 0], [1, 1]];
ok("block still-life unchanged (1 step)", J(fold(jsonl(block), { steps: 1 }).cells) === J(block));
ok("block still-life unchanged (5 steps)", J(fold(jsonl(block), { steps: 5 }).cells) === J(block));

/* ---- TIER-B closure: --steps N == piping the fold N times ------------------ */
var seed = [[0, 0], [1, 0], [2, 0], [5, 5], [5, 6], [6, 5], [6, 6]]; // blinker + block
function piped(text, n) { var t = text; for (var i = 0; i < n; i++) t = toJSONL(fold(t, { steps: 1 })); return t; }
[2, 3, 4].forEach(function (n) {
  ok("closed under I/O: --steps " + n + " == piped " + n,
    toJSONL(fold(jsonl(seed), { steps: n })) === piped(jsonl(seed), n));
});

/* ---- glider: population 5 conserved, and it TRANSLATES on an unbounded grid - */
var glider = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];
ok("glider population 5 conserved through 4 steps",
  [1, 2, 3, 4].every(function (n) { return fold(jsonl(glider), { steps: n }).count === 5; }));
function normalize(cells) {
  var minx = Math.min.apply(null, cells.map(function (c) { return c[0]; }));
  var miny = Math.min.apply(null, cells.map(function (c) { return c[1]; }));
  return cells.map(function (c) { return [c[0] - minx, c[1] - miny]; })
    .sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
}
var g0 = fold(jsonl(glider), { steps: 0 }).cells;
var g4 = fold(jsonl(glider), { steps: 4 }).cells;
ok("glider after 4 steps is the same shape, translated (not identical position)",
  J(normalize(g4)) === J(normalize(g0)) && J(g4) !== J(g0));

/* ---- determinism + order-independence (a SET; shuffled == base) ------------ */
var shuffled = [[6, 6], [1, 0], [5, 5], [2, 0], [6, 5], [0, 0], [5, 6]];
ok("order-independent: shuffled seed == sorted seed (1 step, byte-identical)",
  J(fold(jsonl(shuffled), { steps: 1 }).cells) === J(fold(jsonl(seed), { steps: 1 }).cells));
ok("determinism: folds twice identical", J(fold(jsonl(seed), { steps: 3 })) === J(fold(jsonl(seed), { steps: 3 })));

/* ---- dedup: duplicate live cells collapse (a set) -------------------------- */
ok("duplicate cells collapse (steps 0 canonicalises)",
  J(fold("[0,0]\n[0,0]\n[1,1]\n", { steps: 0 }).cells) === J([[0, 0], [1, 1]]));
ok("steps 0 sorts + dedups", J(fold("[2,2]\n[0,0]\n[2,2]\n", { steps: 0 }).cells) === J([[0, 0], [2, 2]]));

/* ---- empty stream ---------------------------------------------------------- */
ok("empty -> {steps:1,count:0,cells:[]}", J(fold("", { steps: 1 })) === J({ steps: 1, count: 0, cells: [] }));
ok("blank lines skipped", J(fold("[0,0]\n\n[1,0]\n\n[2,0]\n", { steps: 0 }).cells) === J([[0, 0], [1, 0], [2, 0]]));
ok("CRLF trimmed", J(fold("[0,0]\r\n[1,0]\r\n[2,0]\r\n", { steps: 1 }).cells) === J(blinkerV));

/* ---- numeric / shape honesty: hard errors ---------------------------------- */
throws("non-array line -> throw", function () { fold("[0,0]\n5\n", { steps: 1 }); });
throws("wrong-length pair -> throw", function () { fold("[0,0,0]\n", { steps: 1 }); });
throws("non-integer coord -> throw", function () { fold("[0.5,0]\n", { steps: 1 }); });
throws("non-finite coord -> throw", function () { fold("[1e999,0]\n", { steps: 1 }); });
throws("bad JSON line -> throw", function () { fold("[0,0]\nabc\n", { steps: 1 }); });

/* ---- bad steps guards ------------------------------------------------------ */
throws("steps=-1 -> throw", function () { fold("[0,0]", { steps: -1 }); });
throws("steps=1.5 -> throw", function () { fold("[0,0]", { steps: 1.5 }); });

console.log((fail === 0 ? "GREEN" : "RED") + ": " + pass + " assertions passed, " + fail + " failed  [test_life-fold]");
process.exit(fail === 0 ? 0 : 1);
