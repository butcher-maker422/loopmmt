#!/usr/bin/env node
/* grid-source.js — generate a bounded 2-D grid as a deterministic JSONL stream of cells.
   Dependency-free, deterministic, MIT. Runs in Node (the CLI) or a browser (the pure core).

   WHAT IT IS. A SOURCE: it takes grid dimensions in and emits a JSONL stream out — one record
   per cell, in a stable row-major order — the front of a pipe that lets the fold/filter/
   transform/sink gifts work on a 2-D coordinate space:

     node grid-source.js --rows 3 --cols 3 | node grid-sink.js
     node grid-source.js --rows 9 --cols 9 --index | node schema-filter.js ...

   Each record is a fixed, portable shape: {"row":0,"col":0} — plus "value" when a value mode
   is chosen. The coordinate shape is exactly what grid-sink consumes ({row,col,...}), so
   `grid-source | grid-sink` composes into a render pipe; it is the input substrate the spatial
   apps (a sudoku board, a spreadsheet range, a graphing lattice, a Mandelbrot plane, a game
   board) all lean on — a bounded, reproducible coordinate space with no supply in the corpus.

   THE QUIET FAILURES IT FIXES. Everyone hand-rolls a nested `for (r) for (c)` and everyone gets
   it wrong in ways that only bite on the input they didn't test:

     1. NON-DETERMINISTIC / AMBIGUOUS ORDER. Ad-hoc grid loops emit in whatever order the code
        happened to nest (row-major here, column-major there), so two callers' streams don't
        line up and can't be diffed or pinned. grid-source emits a STABLE ROW-MAJOR pre-order
        (row 0 left-to-right, then row 1, ...), the same stream on every machine and every run.

     2. OFF-BY-ONE / UNBOUNDED DIMENSIONS. A grid built from an unchecked `--rows`/`--cols` (a
        float, a negative, a zero, a non-number) silently produces a wrong or infinite stream.
        grid-source requires POSITIVE INTEGER dimensions and fails CLOSED (exit 2, one-line
        message) on anything else — a 0×0 grid is the empty stream, not an error, but a
        fractional or negative dimension is refused up front.

     3. COORDINATE/VALUE CONFUSION. Hand loops mix the cell's POSITION with its CONTENT, so a
        downstream sink can't tell which field is which. grid-source keeps them separate and
        named: `row`/`col` are always the position; `value` (only when a value mode is asked
        for) is the content — a constant `--fill`, or the cell's row-major `--index`.

   THE MODEL. The PURE CORE is `grid(opts)`: it takes options (rows, cols, value mode) and returns
   the sorted, deterministic array of cell records. There is no I/O in the core — a grid is fully
   determined by its dimensions, so unlike a filesystem or a stream source there is no provider to
   inject; the core is pure by construction. The CLI parses argv into opts and renders JSONL; a
   browser calls `grid(opts)` directly.

     --rows R         number of rows (positive integer; required unless --cols implies a square via --size)
     --cols C         number of columns (positive integer; required unless --size)
     --size N         shorthand for --rows N --cols N (a square grid)
     --index          add a "value" field: the cell's 0-based row-major index (0..rows*cols-1)
     --fill V         add a "value" field: the constant V (a JSON scalar: number, string, true/false/null)
     --origin-one     number rows/cols from 1 instead of 0 (1..rows, 1..cols)
     --transpose      emit in COLUMN-major order instead of row-major (col 0 top-to-bottom, then col 1)

   DETERMINISM. grid(opts) is a pure function of opts. Given the same opts, the output is byte-
   identical on every run and every machine: cells in stable row-major (or, with --transpose,
   column-major) order, coordinates and value separated, no clock, no randomness. --index and
   --fill are mutually exclusive (a cell has at most one value).

   USAGE
     node grid-source.js --rows 3 --cols 4
     node grid-source.js --size 9 --index
     node grid-source.js --rows 2 --cols 2 --fill 0 | node grid-sink.js
     node grid-source.js --help

   Exit codes: 0 success (including an empty grid -> empty stream) · 2 usage error (unknown
   option, missing/duplicate/invalid dimension, --index with --fill, bad --fill scalar). A clean
   one-line message on stderr, never a stack trace.

   Released under MIT. Its edge is printed in the README: grid-source emits a bounded, row-major
   (or --transpose column-major) stream of {row,col[,value]} cells. It does NOT lay out or render
   (pipe into grid-sink for that), does NOT read any input (dimensions come from flags, not stdin),
   does NOT do sparse/irregular grids (every cell in the rectangle is emitted), and does NOT carry
   per-cell data (use --fill for a constant or pipe through a transform to attach real values).
*/
"use strict";

/* ==================================================================
   THE PURE CORE — grid(opts) -> [cell, ...]
   No I/O, no provider: a grid is fully determined by its dimensions.
     opts.rows / opts.cols  — positive integers (0 allowed -> empty stream)
     opts.originOne         — number from 1 instead of 0
     opts.transpose         — column-major instead of row-major
     opts.valueMode         — undefined | 'index' | 'fill'
     opts.fill              — the constant value when valueMode === 'fill'
   Returns an array of { row, col [, value] } in stable order.
   ================================================================== */
function grid(opts) {
  opts = opts || {};
  var rows = opts.rows;
  var cols = opts.cols;
  if (!isNonNegInt(rows) || !isNonNegInt(cols)) {
    throw new Error("grid: rows and cols must be non-negative integers");
  }
  var base = opts.originOne ? 1 : 0;
  var transpose = !!opts.transpose;
  var valueMode = opts.valueMode; // undefined | 'index' | 'fill'
  var fill = opts.fill;

  var out = [];
  // The row-major index is ALWAYS assigned in row-major order (r*cols + c), independent of
  // emission order, so --index is a stable property of the cell, not of the traversal. This
  // means --transpose changes the ORDER cells are emitted but NOT a cell's --index value.
  var asBlocks = !!opts.cells; // --cells: emit unit blocks {row,col,w,h} that grid-sink consumes
  function pushCell(r, c) {
    var rec = { row: base + r, col: base + c };
    if (asBlocks) { rec.w = 1; rec.h = 1; }
    if (valueMode === "index") rec.value = r * cols + c;
    else if (valueMode === "fill") rec.value = fill;
    out.push(rec);
  }

  if (!transpose) {
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) pushCell(r, c);
    }
  } else {
    for (var cc = 0; cc < cols; cc++) {
      for (var rr = 0; rr < rows; rr++) pushCell(rr, cc);
    }
  }
  return out;
}

// A non-negative integer (0 allowed): the dimension guard.
function isNonNegInt(n) {
  return typeof n === "number" && isFinite(n) && Math.floor(n) === n && n >= 0;
}

// Render cell records as JSONL text (one JSON object per line, trailing newline per record).
function toJSONL(records) {
  var s = "";
  for (var i = 0; i < records.length; i++) s += JSON.stringify(records[i]) + "\n";
  return s;
}

/* ==================================================================
   EXPORTS (browser + Node)
   ================================================================== */
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.gridSource = { grid: grid, toJSONL: toJSONL };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { grid: grid, toJSONL: toJSONL, isNonNegInt: isNonNegInt };
}

/* ==================================================================
   CLI (runs only when invoked directly, never on require)
   ================================================================== */

// Parse a --fill value as a JSON scalar (number, string, true/false/null). A bare token that
// isn't valid JSON is treated as a string (so `--fill x` -> "x"), but an explicitly malformed
// JSON literal (`--fill [1,`) is a usage error — we only accept SCALARS, never structures.
function parseFillScalar(tok) {
  var v;
  try { v = JSON.parse(tok); }
  catch (e) { return tok; } // not JSON -> a plain string
  if (v === null || typeof v === "number" || typeof v === "boolean" || typeof v === "string") return v;
  throw new Error("--fill must be a scalar (number, string, true, false, or null), not a structure");
}

function parseIntStrict(v, name) {
  var n = Number(v);
  if (String(v).trim() === "" || !isFinite(n) || Math.floor(n) !== n || n < 0) {
    throw new Error(name + " must be a non-negative integer");
  }
  return n;
}

function parseArgs(args) {
  var opts = {};
  var rows, cols, size;
  var i = 0;
  while (i < args.length) {
    var a = args[i];
    if (a === "--rows") { rows = parseIntStrict(args[i + 1], "--rows"); i += 2; }
    else if (a === "--cols") { cols = parseIntStrict(args[i + 1], "--cols"); i += 2; }
    else if (a === "--size") { size = parseIntStrict(args[i + 1], "--size"); i += 2; }
    else if (a === "--index") { opts.__indexSeen = true; i++; }
    else if (a === "--fill") {
      if (args[i + 1] === undefined) throw new Error("--fill requires a value");
      opts.__fillTok = args[i + 1]; i += 2;
    }
    else if (a === "--origin-one") { opts.originOne = true; i++; }
    else if (a === "--transpose") { opts.transpose = true; i++; }
    else if (a === "--cells") { opts.cells = true; i++; }
    else if (a.charAt(0) === "-") { throw new Error("unknown option " + a); }
    else { throw new Error("unexpected argument " + JSON.stringify(a) + " (grid-source takes flags, not positionals)"); }
  }
  // --size is shorthand for a square; it must not be combined with --rows/--cols
  if (size !== undefined) {
    if (rows !== undefined || cols !== undefined) throw new Error("--size cannot be combined with --rows/--cols");
    rows = size; cols = size;
  }
  if (rows === undefined || cols === undefined) throw new Error("both --rows and --cols are required (or use --size N)");
  // Resolve the value mode from the independently-tracked flags, guarding mutual exclusion in
  // EITHER order (--index --fill or --fill --index both refused).
  var indexSeen = !!opts.__indexSeen, fillSeen = opts.__fillTok !== undefined;
  if (indexSeen && fillSeen) throw new Error("--index and --fill are mutually exclusive");
  if (indexSeen) opts.valueMode = "index";
  else if (fillSeen) { opts.valueMode = "fill"; opts.fill = parseFillScalar(opts.__fillTok); }
  delete opts.__indexSeen; delete opts.__fillTok;
  opts.rows = rows; opts.cols = cols;
  return opts;
}

var HELP =
  "grid-source.js — generate a bounded 2-D grid as a deterministic JSONL stream of cells.\n\n" +
  "  node grid-source.js --rows 3 --cols 4\n" +
  "  node grid-source.js --size 9 --index\n" +
  "  node grid-source.js --rows 2 --cols 2 --fill 0 | node grid-sink.js\n" +
  "  node grid-source.js --help\n\n" +
  "  --rows R        number of rows (non-negative integer)\n" +
  "  --cols C        number of columns (non-negative integer)\n" +
  "  --size N        shorthand for --rows N --cols N (a square)\n" +
  "  --index         add a \"value\" field: the cell's 0-based row-major index\n" +
  "  --fill V        add a \"value\" field: the constant JSON scalar V\n" +
  "  --origin-one    number rows/cols from 1 instead of 0\n" +
  "  --transpose     emit in column-major order instead of row-major\n" +
  "  --cells         emit each cell as a unit block {row,col,w:1,h:1} (grid-sink input)\n\n" +
  "Emits one JSON object per cell: { row, col[, value] }, cells in stable ROW-MAJOR order\n" +
  "(or column-major with --transpose). The {row,col} shape is what grid-sink consumes, so\n" +
  "`grid-source --cells | grid-sink` composes. --index and --fill are mutually exclusive.\n\n" +
  "Edge: grid-source does NOT render (pipe into grid-sink), does NOT read stdin (dimensions\n" +
  "are flags), does NOT do sparse/irregular grids (every cell is emitted), and carries no\n" +
  "per-cell data (use --fill or a downstream transform).\n";

function main(argv) {
  var args = argv.slice(2);
  if (args.indexOf("--help") !== -1 || args.indexOf("-h") !== -1) {
    process.stdout.write(HELP);
    return 0;
  }
  var opts;
  try { opts = parseArgs(args); }
  catch (e) { process.stderr.write("grid-source: " + e.message + "\n"); return 2; }

  var records;
  try { records = grid(opts); }
  catch (e) { process.stderr.write("grid-source: " + e.message + "\n"); return 2; }

  process.stdout.write(toJSONL(records));
  return 0;
}

if (typeof require !== "undefined" && require.main === module) {
  process.exitCode = main(process.argv);
}
