#!/usr/bin/env node
/*
 * heatmap-sink — turn (x,y,v) cells into one standalone, deterministic heatmap SVG, no deps.
 * MIT · zero-dependency · standalone gift · lane: sink (consumes data, emits an artifact).
 *
 * THE PRINTED EDGE (read before trusting the output):
 *   This is a GRID-OF-RECTS heatmap primitive, not a plotting library. It draws GEOMETRY
 *   ONLY — one <rect> per (x,y) grid cell inside a plain <svg> frame. It renders NO axes,
 *   tick marks, tick labels, legend, colorbar, title, or interactivity, and it embeds NO
 *   fonts, NO CSS, and NO <script>. It takes NUMBERS ONLY — (x,y,v) triples — so no caller
 *   text ever reaches the output, and there is no text-escaping surface to get wrong.
 *   Colors are NOT free-form input: each cell is painted from a fixed, named, DISCRETE color
 *   scale (value → one of N buckets across the data's [min,max]), and missing cells take a
 *   fixed empty fill — so the output can never carry an attacker-chosen attribute string.
 *   Because there are only N buckets, two values in the same band draw the SAME color: it
 *   shows the FIELD, not the exact magnitude, and it is not a substitute for the number. A
 *   non-finite v, a non-integer or negative coordinate, a duplicate (x,y), or a cell outside
 *   a pinned grid is a HARD ERROR, never silently dropped or guessed. Output is a PURE
 *   FUNCTION of the input, independent of cell ORDER: same cells in → byte-identical SVG out.
 *
 * USAGE:
 *   printf '[0,0,0]\n[1,0,1]\n[0,1,2]\n[1,1,3]\n' | node heatmap-sink.js       # 2x2 heatmap
 *   printf '{"x":0,"y":0,"v":9}\n'                | node heatmap-sink.js       # object cells
 *   printf '[0,0,5]\n[1,0,5]\n' | node heatmap-sink.js --palette cool --min 0 --max 10
 *   echo '{"cells":[[0,0,1],[1,1,9]],"palette":"mono"}' | node heatmap-sink.js  # spec object
 *   node heatmap-sink.js --help
 *
 * INPUT (stdin): either
 *   - JSONL — one cell per line, each `[x,y,v]` or `{"x":X,"y":Y,"v":V}`  (the streaming form)
 *   - a single JSON spec object { cells, min, max, palette, cell, cols, rows, empty }
 *   x,y are NON-NEGATIVE INTEGER grid coordinates (column, row); v is a finite number.
 *   CLI flags (--palette --cell --min --max --cols --rows --empty) OVERRIDE object fields.
 *
 * OUTPUT (stdout): one SVG document string (UTF-8), trailing newline. No cells → an empty frame.
 *
 * DETERMINISM: integer grid coordinates, integer cell size, INTEGER color buckets, cells drawn
 *   in row-major order regardless of input order, 3-decimal coordinate precision, stable
 *   attribute order. No wall-clock, no randomness. Same cells → same bytes, in Node or a browser.
 * PORTABILITY: pure JS on plain arrays/strings — identical in Node and the browser.
 */
'use strict';

// ---- color scales (the ONLY source of cell color; no free-form color input) -----
// Named, closed sets of N=5 discrete colors, low value → high value. A value v is painted
// SCALES[name][level(v)]; level is an integer bucket, so no float ever reaches the output.
var N_BUCKETS = 5;
var SCALES = {
  heat: ['#ffffcc', '#fed976', '#fd8d3c', '#e31a1c', '#800026'], // light yellow → deep red
  cool: ['#f7fbff', '#c6dbef', '#6baed6', '#2171b5', '#08306b'], // light → deep blue
  mono: ['#f7f7f7', '#cccccc', '#969696', '#636363', '#252525'], // light → dark gray
  viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'] // dark purple → yellow
};
// Empty (missing) cells: a closed choice, never caller free-form. 'none' omits the rect.
var EMPTY_FILLS = { light: '#eeeeee', dark: '#333333', none: null };
var DEFAULTS = { palette: 'heat', cell: 16, empty: 'light' };

// ---- deterministic number formatting (verbatim from svg-sink) -------------------
// Round to 3 decimals, strip trailing zeros (and a bare trailing dot), normalize -0.
var PRECISION = 3, SCALE = 1000;
function num(x) {
  var r = Math.round(x * SCALE) / SCALE;
  var s = r.toFixed(PRECISION);
  s = s.replace(/\.?0+$/, '');
  return (s === '' || s === '-0') ? '0' : s;
}

// ---- validation helpers --------------------------------------------------------
function finiteV(v, x, y) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('cell (' + x + ',' + y + ') value is not a finite number: ' + JSON.stringify(v));
  }
  return v;
}
function coord(c, which, cellRepr) {
  if (typeof c !== 'number' || !isFinite(c) || Math.floor(c) !== c) {
    throw new Error(which + ' coordinate must be a non-negative integer, got ' + JSON.stringify(c) + ' in cell ' + cellRepr);
  }
  if (c < 0) throw new Error(which + ' coordinate must be a non-negative integer, got ' + JSON.stringify(c) + ' in cell ' + cellRepr);
  return c;
}
function posInt(v, dflt, name) {
  if (v == null) return dflt;
  var n = Number(v);
  if (!isFinite(n) || Math.floor(n) !== n || n <= 0) throw new Error(name + ' must be a positive integer, got ' + JSON.stringify(v));
  return n;
}
function nonNegIntOrNull(v, name) {
  if (v == null) return null;
  var n = Number(v);
  if (!isFinite(n) || Math.floor(n) !== n || n < 0) throw new Error(name + ' must be a non-negative integer, got ' + JSON.stringify(v));
  return n;
}

// ---- one cell -> {x,y,v}  (accepts [x,y,v] or {x,y,v}) --------------------------
function asCell(raw) {
  var repr = JSON.stringify(raw);
  var x, y, v;
  if (Array.isArray(raw)) {
    if (raw.length !== 3) throw new Error('cell array must be [x,y,v] (3 numbers), got ' + repr);
    x = raw[0]; y = raw[1]; v = raw[2];
  } else if (raw && typeof raw === 'object') {
    if (!('x' in raw) || !('y' in raw) || !('v' in raw)) throw new Error('cell object must have x,y,v, got ' + repr);
    x = raw.x; y = raw.y; v = raw.v;
  } else {
    throw new Error('cell must be [x,y,v] or {x,y,v}, got ' + repr);
  }
  coord(x, 'x', repr); coord(y, 'y', repr); finiteV(v, x, y);
  return { x: x, y: y, v: v };
}

// ---- scale (shared value-domain across all cells; shape from svg-sink/sparkline) --
function domain(values, min, max) {
  var lo = (min != null) ? Number(min) : Infinity;
  var hi = (max != null) ? Number(max) : -Infinity;
  if (min == null || max == null) {
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (min == null && v < lo) lo = v;
      if (max == null && v > hi) hi = v;
    }
  }
  if (!isFinite(lo)) lo = 0;
  if (!isFinite(hi)) hi = 0;
  if (lo === hi) { lo -= 1; hi += 1; } // flat field -> unit window, painted mid-scale
  return { lo: lo, hi: hi };
}
function level(v, lo, hi) {
  var k = Math.floor(((v - lo) / (hi - lo)) * N_BUCKETS);
  if (k < 0) k = 0;
  if (k >= N_BUCKETS) k = N_BUCKETS - 1; // v == hi -> N clamps to N-1
  return k;
}

// ---- input normalization -------------------------------------------------------
// Accept: [[x,y,v],...] | [{x,y,v},...] | {cells, ...}. Return a validated spec.
function normalize(input, flags) {
  var spec = {};
  var cellsRaw;
  if (input && !Array.isArray(input) && typeof input === 'object') {
    cellsRaw = input.cells;
    if (input.min     != null) spec.min     = input.min;
    if (input.max     != null) spec.max     = input.max;
    if (input.palette != null) spec.palette = input.palette;
    if (input.cell    != null) spec.cell    = input.cell;
    if (input.cols    != null) spec.cols    = input.cols;
    if (input.rows    != null) spec.rows    = input.rows;
    if (input.empty   != null) spec.empty   = input.empty;
  } else {
    cellsRaw = input;
  }
  flags = flags || {};
  for (var k in flags) if (flags[k] != null) spec[k] = flags[k];

  if (cellsRaw == null) cellsRaw = [];
  if (!Array.isArray(cellsRaw)) throw new Error('input has no cells (expected [[x,y,v],...] or a {cells:...} object)');

  var cells = cellsRaw.map(asCell);

  spec.palette = (spec.palette != null) ? String(spec.palette) : DEFAULTS.palette;
  spec.empty   = (spec.empty   != null) ? String(spec.empty)   : DEFAULTS.empty;
  spec.cell    = posInt(spec.cell, DEFAULTS.cell, 'cell');
  spec.pinCols = nonNegIntOrNull(spec.cols, 'cols');
  spec.pinRows = nonNegIntOrNull(spec.rows, 'rows');
  if (spec.min != null) spec.min = numOrThrow(spec.min, 'min');
  if (spec.max != null) spec.max = numOrThrow(spec.max, 'max');
  if (spec.min != null && spec.max != null && spec.min >= spec.max) {
    throw new Error('min must be < max (got min=' + spec.min + ', max=' + spec.max + ')');
  }
  if (!SCALES[spec.palette]) throw new Error('unknown palette "' + spec.palette + '" (expected ' + Object.keys(SCALES).join(' | ') + ')');
  if (!(spec.empty in EMPTY_FILLS)) throw new Error('unknown empty "' + spec.empty + '" (expected ' + Object.keys(EMPTY_FILLS).join(' | ') + ')');

  // build the cell map; a duplicate (x,y) is a HARD error (ambiguous cell, no silent last-wins)
  var mapKey = {}, maxX = -1, maxY = -1;
  for (var i = 0; i < cells.length; i++) {
    var c = cells[i], key = c.x + ',' + c.y;
    if (Object.prototype.hasOwnProperty.call(mapKey, key)) {
      throw new Error('duplicate cell at (' + c.x + ',' + c.y + ') — each grid position may appear at most once');
    }
    mapKey[key] = c.v;
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
  }
  var cols = (spec.pinCols != null) ? spec.pinCols : maxX + 1;
  var rows = (spec.pinRows != null) ? spec.pinRows : maxY + 1;
  if (spec.pinCols != null && maxX >= spec.pinCols) throw new Error('cell x=' + maxX + ' is outside the pinned grid cols=' + spec.pinCols);
  if (spec.pinRows != null && maxY >= spec.pinRows) throw new Error('cell y=' + maxY + ' is outside the pinned grid rows=' + spec.pinRows);
  if (cols < 0) cols = 0;
  if (rows < 0) rows = 0;

  spec.cellMap = mapKey;
  spec.cols = cols;
  spec.rows = rows;
  spec.values = cells.map(function (c) { return c.v; });
  return spec;
}
function numOrThrow(v, name) {
  var n = Number(v);
  if (typeof n !== 'number' || !isFinite(n)) throw new Error(name + ' must be a finite number, got ' + JSON.stringify(v));
  return n;
}

// ---- core: renderHeatmap(spec) -> string  (pure, the whole gift) ----------------
function heatmap(input, flags) {
  var spec = normalize(input, flags);
  var cell = spec.cell, cols = spec.cols, rows = spec.rows;
  var W = cols * cell, H = rows * cell;
  var scale = SCALES[spec.palette];
  var emptyFill = EMPTY_FILLS[spec.empty]; // may be null (omit empty rects)
  var dom = domain(spec.values, spec.min, spec.max);

  var body = [];
  // row-major order — INPUT-ORDER-INDEPENDENT and deterministic.
  for (var y = 0; y < rows; y++) {
    for (var x = 0; x < cols; x++) {
      var key = x + ',' + y;
      var fill;
      if (Object.prototype.hasOwnProperty.call(spec.cellMap, key)) {
        fill = scale[level(spec.cellMap[key], dom.lo, dom.hi)];
      } else if (emptyFill == null) {
        continue; // 'none' -> omit the rect entirely
      } else {
        fill = emptyFill;
      }
      body.push('<rect x="' + num(x * cell) + '" y="' + num(y * cell) +
                '" width="' + num(cell) + '" height="' + num(cell) + '" fill="' + fill + '" />');
    }
  }

  // Fixed attribute order; xmlns first so the fragment is a valid standalone document.
  var open = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '">';
  return open + '\n' + (body.length ? body.join('\n') + '\n' : '') + '</svg>\n';
}

// ---- exports (browser attach · require · direct run) ---------------------------
if (typeof window !== 'undefined') {
  window.LoopGifts = window.LoopGifts || {};
  window.LoopGifts['heatmap-sink'] = { heatmap: heatmap, SCALES: SCALES, EMPTY_FILLS: EMPTY_FILLS };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { heatmap: heatmap, num: num, normalize: normalize, domain: domain, SCALES: SCALES, EMPTY_FILLS: EMPTY_FILLS, N_BUCKETS: N_BUCKETS };
}

// ---- cli -----------------------------------------------------------------------
var HELP =
'heatmap-sink — (x,y,v) cells -> a standalone, deterministic heatmap SVG, zero deps.\n\n' +
"  printf '[0,0,0]\\n[1,0,1]\\n[0,1,2]\\n[1,1,3]\\n' | node heatmap-sink.js\n" +
"  printf '{\"x\":0,\"y\":0,\"v\":9}\\n'                | node heatmap-sink.js\n" +
"  printf '[0,0,5]\\n[1,0,5]\\n' | node heatmap-sink.js --palette cool --min 0 --max 10\n" +
"  echo '{\"cells\":[[0,0,1],[1,1,9]]}' | node heatmap-sink.js --cell 24\n\n" +
'INPUT (stdin): JSONL of [x,y,v] or {x,y,v} cells (one per line), OR a {cells,...} spec object.\n' +
'Flags (override object fields): --palette heat|cool|mono|viridis  --cell N  --min N  --max N\n' +
'                                --cols N  --rows N  --empty light|dark|none\n\n' +
'Geometry only: one <rect> per cell, no axes/labels/legend/fonts/CSS/script. Numbers in, a\n' +
'grid out. Colors come from a fixed named 5-bucket scale (not caller input). A non-finite v,\n' +
'a bad coordinate, or a duplicate (x,y) -> error.\n';

function parseFlags(argv) {
  var f = {};
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--palette')   f.palette = argv[++i];
    else if (a === '--cell') f.cell    = Number(argv[++i]);
    else if (a === '--min')  f.min     = Number(argv[++i]);
    else if (a === '--max')  f.max     = Number(argv[++i]);
    else if (a === '--cols') f.cols    = Number(argv[++i]);
    else if (a === '--rows') f.rows    = Number(argv[++i]);
    else if (a === '--empty') f.empty  = argv[++i];
  }
  return f;
}

// Parse stdin: a single JSON spec object {cells:...} passes through; otherwise treat the
// input as JSONL — one cell per non-empty line. Blank lines are skipped.
function parseStdin(raw) {
  var trimmed = raw.trim();
  if (trimmed === '') return { cells: [] };
  // single-object spec form?
  if (trimmed.charAt(0) === '{') {
    try {
      var obj = JSON.parse(trimmed);
      if (obj && !Array.isArray(obj) && typeof obj === 'object' && 'cells' in obj) return obj;
    } catch (e) { /* fall through to JSONL (multi-line objects) */ }
  }
  var cells = [];
  var lines = trimmed.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i].trim();
    if (ln === '') continue;
    var cell;
    try { cell = JSON.parse(ln); }
    catch (e) { throw new Error('line ' + (i + 1) + ' is not valid JSON: ' + e.message); }
    cells.push(cell);
  }
  return { cells: cells };
}

function main() {
  var argv = process.argv.slice(2);
  if (argv.indexOf('--help') !== -1 || argv.indexOf('-h') !== -1) { process.stdout.write(HELP); return; }
  var flags = parseFlags(argv);
  var chunks = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (d) { chunks += d; });
  process.stdin.on('end', function () {
    var input;
    try { input = parseStdin(chunks); }
    catch (e) { process.stderr.write('heatmap-sink: ' + e.message + '\n'); process.exitCode = 1; return; }
    var svg;
    try { svg = heatmap(input, flags); }
    catch (e) { process.stderr.write('heatmap-sink: ' + e.message + '\n'); process.exitCode = 1; return; }
    process.stdout.write(svg);
  });
}
if (typeof require !== 'undefined' && require.main === module) { main(); }
