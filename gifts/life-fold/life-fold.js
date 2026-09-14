#!/usr/bin/env node
/**
 * life-fold — Conway's Game of Life, one step as a FOLD, in a trace loop.
 *
 * WHAT
 *   Reads a set of LIVE CELLS -- one `[x,y]` integer pair per line (JSON Lines) --
 *   and folds it into the NEXT generation's live cells by Conway's rule (B3/S23).
 *   Output is the same shape as input: `[x,y]` pairs, one per line, sorted. So the
 *   gift is CLOSED UNDER ITS OWN I/O -- its output pipes straight back into itself:
 *       life-fold < gen0 | life-fold | life-fold   ==   life-fold --steps 3 < gen0
 *   That feedback -- the fold circulating through its own output channel, each pass
 *   confirming the last -- is Shea's mercury delay line, Loop 1.0 generalized. It is
 *   the Tier-B property: the reducer transition stays the `fold` atom; the loop (↻)
 *   is only wrapped around it, no new primitive. --steps N internalizes that loop.
 *
 * THE RULE (Conway B3/S23, on an unbounded sparse grid)
 *   A live cell with 2 or 3 live neighbours survives; a dead cell with exactly 3
 *   live neighbours is born; every other cell is dead next generation. Neighbours
 *   are the 8 surrounding cells. The grid is infinite and sparse: only live cells
 *   are represented, so patterns may grow without a bounding box.
 *
 * USAGE
 *   node life-fold.js [--steps N] [FILE]        # stdin if no FILE
 *   printf '%s\n' '[0,0]' '[1,0]' '[2,0]' | node life-fold.js      # blinker, 1 step
 *     -> [1,-1]
 *        [1,0]
 *        [1,1]
 *   --steps N   run N generations in-process (default 1). N=0 canonicalises the
 *               input (dedups + sorts the live set) without stepping.
 *   --help
 *
 * EXIT CODES
 *   0  success
 *   2  input error: a line that is not a JSON array of exactly two FINITE INTEGERS;
 *      a bad --steps (non-integer or < 0); a missing file or a directory. Always a
 *      clean one-line message on stderr, never a stack trace.
 *
 * EDGE (what this is NOT)
 *   ONE deterministic Life implementation stepped N times -- NOT a renderer (it
 *   emits the live-cell SET, not a picture), NOT a bounded grid (it is sparse and
 *   unbounded, so gliders travel forever), and NOT a variant rule (it is exactly
 *   B3/S23). Cells are unordered on input (a SET -- duplicates collapse, order is
 *   irrelevant) and SORTED on output (x then y), so the same generation is a
 *   byte-identical record regardless of input order.
 *
 * Zero dependencies. Node builtin `require('fs')` for file reads only; runs in a
 * browser with no require (attaches `lifeFold` to window.ForestGifts). MIT.
 */
"use strict";

function key(x, y) { return x + "," + y; }

/* one Conway step over a Set of "x,y" keys -> a new Set of "x,y" keys */
function step(live) {
  var counts = Object.create(null); // "x,y" -> live-neighbour count
  live.forEach(function (k) {
    var c = k.split(","), x = +c[0], y = +c[1];
    for (var dx = -1; dx <= 1; dx++) {
      for (var dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        var nk = key(x + dx, y + dy);
        counts[nk] = (counts[nk] || 0) + 1;
      }
    }
  });
  var next = new Set();
  for (var k in counts) {
    var n = counts[k];
    if (n === 3 || (n === 2 && live.has(k))) next.add(k); // B3 / S23
  }
  return next;
}

/* parse JSONL live cells -> Set of "x,y"; throws on a non-integer-pair line */
function parse(text) {
  var live = new Set();
  var lines = String(text).split("\n");
  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i];
    if (raw.charCodeAt(raw.length - 1) === 13) raw = raw.slice(0, -1); // CRLF
    if (raw.length === 0) continue; // blank line skipped
    var v;
    try { v = JSON.parse(raw); }
    catch (e) { throw new Error("line " + (i + 1) + ": not valid JSON: " + raw); }
    if (!Array.isArray(v) || v.length !== 2) {
      throw new Error("line " + (i + 1) + ": expected a [x,y] pair: " + raw);
    }
    var x = v[0], y = v[1];
    if (typeof x !== "number" || typeof y !== "number" || !isFinite(x) || !isFinite(y) ||
        Math.floor(x) !== x || Math.floor(y) !== y) {
      throw new Error("line " + (i + 1) + ": coordinates must be finite integers: " + raw);
    }
    live.add(key(x, y));
  }
  return live;
}

/* sorted array of [x,y] from a Set of "x,y" (x asc, then y asc) -> canonical order */
function sortedCells(live) {
  var arr = [];
  live.forEach(function (k) { var c = k.split(","); arr.push([+c[0], +c[1]]); });
  arr.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
  return arr;
}

/**
 * Fold a JSONL live-cell set forward N generations.
 * @param {string} text  JSONL of [x,y] live cells
 * @param {{steps?:number}} opts  steps N (integer >= 0; default 1)
 * @returns {{steps:number, count:number, cells:number[][]}}
 * @throws {Error} on a bad line or a bad steps value.
 */
function fold(text, opts) {
  opts = opts || {};
  var steps = opts.steps === undefined ? 1 : opts.steps;
  if (typeof steps !== "number" || !isFinite(steps) || Math.floor(steps) !== steps || steps < 0) {
    throw new Error("steps must be an integer >= 0 (got " + steps + ")");
  }
  var live = parse(text);
  for (var s = 0; s < steps; s++) live = step(live);
  var cells = sortedCells(live);
  return { steps: steps, count: cells.length, cells: cells };
}

/* ------------------------------------------------------------------ exports */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { fold: fold, step: step, parse: parse, sortedCells: sortedCells };
}
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.lifeFold = fold;
}

/* ----------------------------------------------------------------- CLI main */
function main(argv) {
  var args = argv.slice(2);
  var steps = 1, file = null;
  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    if (a === "--help" || a === "-h") {
      process.stdout.write(
        "usage: life-fold.js [--steps N] [FILE]\n" +
          "  --steps N   run N generations in-process (default 1; N=0 canonicalises)\n" +
          "  (no FILE)   read live cells from stdin\n" +
          "  FILE        read live cells from a file\n" +
          "  --help\n" +
          "Each non-blank line is one live cell as a JSON [x,y] integer pair. Output is\n" +
          "the next generation's live cells, same shape, one [x,y] per line, sorted --\n" +
          "so `life-fold | life-fold` steps two generations (closed under its own I/O).\n"
      );
      process.exit(0);
    } else if (a === "--steps") {
      var nx = args[i + 1];
      if (nx === undefined) { process.stderr.write("life-fold: --steps requires a value\n"); process.exit(2); }
      steps = Number(nx); i += 1;
    } else if (a.indexOf("--steps=") === 0) {
      steps = Number(a.slice(8));
    } else if (a.charAt(0) === "-" && a !== "-") {
      process.stderr.write("life-fold: unknown option: " + a + "\n"); process.exit(2);
    } else {
      if (file !== null) { process.stderr.write("life-fold: more than one FILE given\n"); process.exit(2); }
      file = a;
    }
  }

  function run(text) {
    var rec;
    try { rec = fold(text, { steps: steps }); }
    catch (e) { process.stderr.write("life-fold: " + e.message + "\n"); process.exit(2); return; }
    // closed under I/O: emit the live-cell SET as JSONL [x,y] (one per line)
    var out = "";
    for (var i = 0; i < rec.cells.length; i++) out += JSON.stringify(rec.cells[i]) + "\n";
    process.stdout.write(out);
  }

  if (file === null || file === "-") {
    var chunks = [];
    process.stdin.on("data", function (c) { chunks.push(c); });
    process.stdin.on("end", function () { run(Buffer.concat(chunks).toString("utf8")); });
  } else {
    var fs = require("fs");
    var text;
    try {
      var st = fs.statSync(file);
      if (st.isDirectory()) { process.stderr.write("life-fold: is a directory: " + file + "\n"); process.exit(2); return; }
      text = fs.readFileSync(file, "utf8");
    } catch (e) {
      process.stderr.write("life-fold: cannot read file: " + file + "\n"); process.exit(2); return;
    }
    run(text);
  }
}

if (typeof require !== "undefined" && require.main === module) {
  main(process.argv);
}
