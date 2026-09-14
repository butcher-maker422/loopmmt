#!/usr/bin/env node
/* test_grid-source.js — battery for the grid-source gift.
   node test_grid-source.js  ->  exit 0 PASS / non-zero FAIL.

   The oracle is INDEPENDENT: the gift walks two nested loops (for row / for col); the oracle
   generates cells from a FLAT index (0..rows*cols-1) and maps each index back to (row,col) by
   division/modulo — a different route to the same set, so agreement proves the gift's ordering
   and coordinates rather than re-running its own logic. Plus frozen hand goldens for each of the
   three quiet failures and the fail-closed dimension edges.
*/
"use strict";
var G = require("./grid-source.js");
var grid = G.grid, toJSONL = G.toJSONL;

var pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.log("  FAIL  " + name); } }
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b)); }

/* ---- INDEPENDENT ORACLE: flat-index -> (row,col), a different route than nested loops ---- */
function oracle(opts) {
  var rows = opts.rows, cols = opts.cols;
  var base = opts.originOne ? 1 : 0;
  var n = rows * cols;
  var cells = [];
  for (var k = 0; k < n; k++) {
    // row-major flat index -> coordinates
    var r = Math.floor(k / cols);
    var c = k % cols;
    var rec = { row: base + r, col: base + c };
    if (opts.valueMode === "index") rec.value = r * cols + c; // == k in row-major
    else if (opts.valueMode === "fill") rec.value = opts.fill;
    cells.push(rec);
  }
  if (opts.transpose) {
    // re-sort into column-major order WITHOUT recomputing index (index stays row-major)
    cells.sort(function (a, b) {
      var ac = a.col, bc = b.col, ar = a.row, br = b.row;
      if (ac !== bc) return ac - bc;
      return ar - br;
    });
  }
  return cells;
}

/* ---- grid == oracle across a dimension grid ---------------------------- */
var DIMS = [[1, 1], [1, 5], [5, 1], [3, 3], [3, 4], [9, 9], [2, 7], [0, 0], [0, 3], [4, 0]];
var MODES = [
  {},
  { valueMode: "index" },
  { valueMode: "fill", fill: 0 },
  { valueMode: "fill", fill: "x" },
  { originOne: true },
  { transpose: true },
  { transpose: true, valueMode: "index" },
  { originOne: true, valueMode: "index", transpose: true }
];
for (var d = 0; d < DIMS.length; d++) {
  for (var m = 0; m < MODES.length; m++) {
    var opts = Object.assign({ rows: DIMS[d][0], cols: DIMS[d][1] }, MODES[m]);
    var got = grid(opts);
    var want = oracle(opts);
    eq("grid==oracle dims=" + DIMS[d] + " mode#" + m, got, want);
  }
}

/* ---- QUIET FAILURE 1: stable row-major order (not column-major by accident) ---- */
(function () {
  var g = grid({ rows: 2, cols: 3 });
  // row-major: (0,0)(0,1)(0,2)(1,0)(1,1)(1,2)
  eq("QF1 row-major order", g.map(function (x) { return [x.row, x.col]; }),
     [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]]);
  var t = grid({ rows: 2, cols: 3, transpose: true });
  // column-major: (0,0)(1,0)(0,1)(1,1)(0,2)(1,2)
  eq("QF1 --transpose column-major order", t.map(function (x) { return [x.row, x.col]; }),
     [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]]);
})();

/* ---- QUIET FAILURE 2: bounded/valid dimensions (guard is in the CLI; core guards too) ---- */
(function () {
  var threw = false;
  try { grid({ rows: 2.5, cols: 2 }); } catch (e) { threw = true; }
  ok("QF2 core throws on fractional rows", threw);
  threw = false;
  try { grid({ rows: -1, cols: 2 }); } catch (e) { threw = true; }
  ok("QF2 core throws on negative rows", threw);
  // 0x0 is the empty stream, NOT an error
  eq("QF2 0x0 is the empty grid", grid({ rows: 0, cols: 0 }), []);
  eq("QF2 0xN is empty", grid({ rows: 0, cols: 5 }), []);
})();

/* ---- QUIET FAILURE 3: coordinate/value separation ---- */
(function () {
  var plain = grid({ rows: 1, cols: 2 });
  ok("QF3 no value field when no value mode", plain.every(function (x) { return x.value === undefined; }));
  var idx = grid({ rows: 2, cols: 2, valueMode: "index" });
  eq("QF3 --index is row-major 0-based", idx.map(function (x) { return x.value; }), [0, 1, 2, 3]);
  var idxT = grid({ rows: 2, cols: 2, valueMode: "index", transpose: true });
  // transpose changes ORDER but index stays row-major property: (0,0)=0 (1,0)=2 (0,1)=1 (1,1)=3
  eq("QF3 --index stable under --transpose (order changes, value does not)",
     idxT.map(function (x) { return [x.row, x.col, x.value]; }),
     [[0, 0, 0], [1, 0, 2], [0, 1, 1], [1, 1, 3]]);
  var fill = grid({ rows: 1, cols: 3, valueMode: "fill", fill: 7 });
  ok("QF3 --fill is the constant", fill.every(function (x) { return x.value === 7; }));
})();

/* ---- composition: {row,col} shape, and --cells emits grid-sink's {row,col,w,h} block ---- */
(function () {
  var g = grid({ rows: 2, cols: 2 });
  ok("composition: every record has row and col (coordinate substrate)",
     g.every(function (x) { return typeof x.row === "number" && typeof x.col === "number"; }));
  var cells = grid({ rows: 2, cols: 2, cells: true });
  ok("composition: --cells emits unit blocks {row,col,w:1,h:1} (grid-sink input)",
     cells.every(function (x) { return x.w === 1 && x.h === 1 && typeof x.row === "number" && typeof x.col === "number"; }));
  eq("composition: --cells first block", cells[0], { row: 0, col: 0, w: 1, h: 1 });
})();

/* ---- --origin-one ---- */
(function () {
  var g = grid({ rows: 2, cols: 2, originOne: true });
  eq("--origin-one numbers from 1", g.map(function (x) { return [x.row, x.col]; }),
     [[1, 1], [1, 2], [2, 1], [2, 2]]);
})();

/* ---- determinism: two calls byte-identical ---- */
ok("deterministic across two grid() calls",
   toJSONL(grid({ rows: 5, cols: 5, valueMode: "index" })) === toJSONL(grid({ rows: 5, cols: 5, valueMode: "index" })));

/* ---- toJSONL surface ---- */
eq("toJSONL renders one line per cell with trailing newline",
   toJSONL([{ row: 0, col: 0 }, { row: 0, col: 1 }]),
   '{"row":0,"col":0}\n{"row":0,"col":1}\n');

/* ---- report ---- */
console.log("grid-source battery: " + pass + " passed, " + fail + " failed");
process.exitCode = fail === 0 ? 0 : 1;
