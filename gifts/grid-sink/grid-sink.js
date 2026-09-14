#!/usr/bin/env node
/*
 * grid-sink — place blocks into a FIXED grid and render it as a deterministic SVG, no deps.
 * MIT · zero-dependency · standalone gift · lane: sink (consumes placed blocks, emits an SVG).
 *
 * THE PRINTED EDGE (read before trusting the output):
 *   This is a grid-placement primitive, not a layout engine. Each input is a block placed at an
 *   integer (row,col) spanning (w,h) cells; the gift draws one <rect> per block into a fixed grid,
 *   painting from a fixed named palette by block index. It renders NO axes, labels, gridlines,
 *   legend, or text — NUMBERS ONLY, so there is no text-escaping surface. Its ONE distinguishing
 *   decision is the DECLARED OVERFLOW POLICY: when the grid is pinned (fixed cols/rows) and a block
 *   would extend past it, the caller declares up front how that is handled — "error" (the default:
 *   refuse the layout, Fit-by-Construction), "clip" (draw only the in-grid portion), or "skip"
 *   (omit the block). Overflow is never handled silently by accident; it is always the policy the
 *   caller named. Blocks draw in INPUT ORDER (painter's order — a later block overlaps an earlier
 *   one). A non-finite/negative/non-integer coordinate, a non-positive span, an unknown palette, or
 *   an unknown overflow policy is a HARD ERROR. Same blocks + same grid + same policy in →
 *   byte-identical SVG out.
 *
 * USAGE:
 *   printf '[0,0,1,1]\n[1,1,2,1]\n' | node grid-sink.js                          # auto-fit grid
 *   echo '{"blocks":[[0,0,3,1]],"cols":2,"rows":2,"overflow":"clip"}' | node grid-sink.js
 *   node grid-sink.js --help
 *
 * INPUT (stdin): either
 *   - JSONL — one block per line, each [row,col,w,h] or {"row":R,"col":C,"w":W,"h":H}
 *   - a single JSON spec object { blocks, cols, rows, cell, pad, palette, overflow }
 *   row,col are non-negative integers; w,h are positive integers.
 *   CLI flags (--cols --rows --cell --pad --palette --overflow) OVERRIDE object fields.
 *
 * OUTPUT (stdout): one SVG document string (UTF-8), trailing newline. No blocks → an empty frame.
 *
 * DETERMINISM: integer cell coordinates (no float in the output), stable attribute order, blocks in
 *   input order, fixed palette by index. Same blocks + grid + policy → same bytes, Node or browser.
 */
'use strict';

// ---- palettes (the ONLY source of block color; no free-form color input) --------
var PALETTES = {
  loop: ['#2f6f8f', '#c25b3a', '#4a8a52', '#8a6d3b', '#6d4a8a', '#3b6d8a'],
  mono: ['#111111', '#555555', '#999999', '#bbbbbb'],
  warm: ['#c25b3a', '#d98a3a', '#b23b3b', '#8a5a2b'],
  cool: ['#2f6f8f', '#4a8a8a', '#3b5a8a', '#5a6d8a']
};
var OVERFLOW = ['error', 'clip', 'skip'];   // the DECLARED policy set (closed)
var DEFAULTS = { cell: 20, pad: 2, palette: 'loop', overflow: 'error' };

// ---- validation helpers --------------------------------------------------------
function nonNegInt(v, i, name) {
  if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v || v < 0) {
    throw new Error('block[' + i + '] ' + name + ' must be a non-negative integer, got ' + JSON.stringify(v));
  }
  return v;
}
function posInt(v, i, name) {
  if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v || v <= 0) {
    throw new Error('block[' + i + '] ' + name + ' must be a positive integer, got ' + JSON.stringify(v));
  }
  return v;
}
function posIntOpt(v, dflt, name) {
  if (v == null) return dflt;
  var n = Number(v);
  if (!isFinite(n) || Math.floor(n) !== n || n <= 0) throw new Error(name + ' must be a positive integer, got ' + JSON.stringify(v));
  return n;
}
function nonNegIntOpt(v, name) {
  if (v == null) return null;
  var n = Number(v);
  if (!isFinite(n) || Math.floor(n) !== n || n < 0) throw new Error(name + ' must be a non-negative integer, got ' + JSON.stringify(v));
  return n;
}

// ---- one block -> {row,col,w,h}  (accepts [row,col,w,h] or {row,col,w,h}) --------
function asBlock(raw, i) {
  var row, col, w, h;
  if (Array.isArray(raw)) {
    if (raw.length !== 4) throw new Error('block[' + i + '] array must be [row,col,w,h] (4 fields), got ' + JSON.stringify(raw));
    row = raw[0]; col = raw[1]; w = raw[2]; h = raw[3];
  } else if (raw && typeof raw === 'object') {
    if (!('row' in raw) || !('col' in raw) || !('w' in raw) || !('h' in raw)) {
      throw new Error('block[' + i + '] object must have row,col,w,h, got ' + JSON.stringify(raw));
    }
    row = raw.row; col = raw.col; w = raw.w; h = raw.h;
  } else {
    throw new Error('block[' + i + '] must be [row,col,w,h] or {row,col,w,h}, got ' + JSON.stringify(raw));
  }
  nonNegInt(row, i, 'row'); nonNegInt(col, i, 'col'); posInt(w, i, 'w'); posInt(h, i, 'h');
  return { row: row, col: col, w: w, h: h };
}

// ---- input normalization -------------------------------------------------------
function normalize(input, flags) {
  var spec = {};
  var blocksRaw;
  if (input && !Array.isArray(input) && typeof input === 'object') {
    blocksRaw = input.blocks;
    if (input.cols     != null) spec.cols     = input.cols;
    if (input.rows     != null) spec.rows     = input.rows;
    if (input.cell     != null) spec.cell     = input.cell;
    if (input.pad      != null) spec.pad      = input.pad;
    if (input.palette  != null) spec.palette  = input.palette;
    if (input.overflow != null) spec.overflow = input.overflow;
  } else {
    blocksRaw = input;
  }
  flags = flags || {};
  for (var k in flags) if (flags[k] != null) spec[k] = flags[k];

  if (blocksRaw == null) blocksRaw = [];
  if (!Array.isArray(blocksRaw)) throw new Error('input has no blocks (expected [[row,col,w,h],...] or a {blocks:...} object)');
  spec.blocks   = blocksRaw.map(asBlock);
  spec.cell     = posIntOpt(spec.cell, DEFAULTS.cell, 'cell');
  spec.pad      = (spec.pad != null) ? nonNegIntOpt(spec.pad, 'pad') : DEFAULTS.pad;
  spec.palette  = (spec.palette != null) ? String(spec.palette) : DEFAULTS.palette;
  spec.overflow = (spec.overflow != null) ? String(spec.overflow) : DEFAULTS.overflow;
  spec.cols     = nonNegIntOpt(spec.cols, 'cols');   // null => auto-fit
  spec.rows     = nonNegIntOpt(spec.rows, 'rows');
  if (!PALETTES[spec.palette]) throw new Error('unknown palette "' + spec.palette + '" (expected ' + Object.keys(PALETTES).join(' | ') + ')');
  if (OVERFLOW.indexOf(spec.overflow) === -1) throw new Error('unknown overflow policy "' + spec.overflow + '" (expected ' + OVERFLOW.join(' | ') + ')');
  return spec;
}

// ---- grid dimensions: pinned (declared) or auto-fit to the blocks ---------------
function gridDims(spec) {
  var cols = spec.cols, rows = spec.rows;
  if (cols == null || rows == null) {
    var mc = 0, mr = 0;
    for (var i = 0; i < spec.blocks.length; i++) {
      var b = spec.blocks[i];
      if (b.col + b.w > mc) mc = b.col + b.w;
      if (b.row + b.h > mr) mr = b.row + b.h;
    }
    if (cols == null) cols = mc;
    if (rows == null) rows = mr;
  }
  return { cols: cols, rows: rows };
}

// ---- apply the DECLARED overflow policy to one block ----------------------------
// returns a {row,col,w,h} to draw, or null to omit — or throws (policy "error").
function fit(b, i, cols, rows, policy) {
  var overRight = b.col + b.w > cols;
  var overBottom = b.row + b.h > rows;
  var outside = b.col >= cols || b.row >= rows;
  if (!overRight && !overBottom) return b;                 // fits — nothing to decide
  if (policy === 'error') {
    throw new Error('block[' + i + '] at (row ' + b.row + ', col ' + b.col + ') size ' + b.w + 'x' + b.h +
      ' exceeds the fixed ' + cols + 'x' + rows + ' grid (overflow policy "error")');
  }
  if (policy === 'skip') return null;                      // omit the whole block
  // policy === 'clip': draw only the in-grid portion.
  if (outside) return null;                                // entirely outside -> nothing to draw
  var w = Math.min(b.w, cols - b.col);
  var h = Math.min(b.h, rows - b.row);
  if (w <= 0 || h <= 0) return null;
  return { row: b.row, col: b.col, w: w, h: h };
}

// ---- core: grid(input, flags) -> string  (pure, the whole gift) -----------------
function grid(input, flags) {
  var spec = normalize(input, flags);
  var cell = spec.cell, pad = spec.pad, pal = PALETTES[spec.palette];
  var dims = gridDims(spec);
  var W = 2 * pad + dims.cols * cell;
  var H = 2 * pad + dims.rows * cell;

  var body = [];
  for (var i = 0; i < spec.blocks.length; i++) {   // painter's order = input order
    var drawn = fit(spec.blocks[i], i, dims.cols, dims.rows, spec.overflow);
    if (drawn == null) continue;
    var x = pad + drawn.col * cell, y = pad + drawn.row * cell;
    var w = drawn.w * cell, h = drawn.h * cell;
    var color = pal[i % pal.length];
    body.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + color + '" />');
  }

  var open = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '">';
  return open + '\n' + (body.length ? body.join('\n') + '\n' : '') + '</svg>\n';
}

// ---- exports -------------------------------------------------------------------
if (typeof window !== 'undefined') {
  window.LoopGifts = window.LoopGifts || {};
  window.LoopGifts['grid-sink'] = { grid: grid, PALETTES: PALETTES, OVERFLOW: OVERFLOW };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { grid: grid, normalize: normalize, gridDims: gridDims, fit: fit, PALETTES: PALETTES, OVERFLOW: OVERFLOW };
}

// ---- cli -----------------------------------------------------------------------
var HELP =
'grid-sink — place blocks into a FIXED grid -> a standalone, deterministic SVG, zero deps.\n\n' +
"  printf '[0,0,1,1]\\n[1,1,2,1]\\n' | node grid-sink.js\n" +
"  echo '{\"blocks\":[[0,0,3,1]],\"cols\":2,\"rows\":2,\"overflow\":\"clip\"}' | node grid-sink.js\n\n" +
'INPUT (stdin): JSONL of [row,col,w,h] or {row,col,w,h} blocks (one per line), OR a {blocks,...}\n' +
'spec object. Flags (override object fields): --cols N  --rows N  --cell N  --pad N\n' +
'                                             --palette loop|mono|warm|cool  --overflow error|clip|skip\n\n' +
'One <rect> per block, painted from a fixed palette by index; NUMBERS ONLY (no text surface). With a\n' +
'PINNED grid, a block that exceeds it is handled by the DECLARED overflow policy: error (default) |\n' +
'clip | skip. Auto-fit grid (no --cols/--rows) never overflows. Bad coord/span, unknown palette, or\n' +
'unknown overflow policy -> hard error.\n';

function parseFlags(argv) {
  var f = {};
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--cols')      f.cols     = Number(argv[++i]);
    else if (a === '--rows') f.rows     = Number(argv[++i]);
    else if (a === '--cell') f.cell     = Number(argv[++i]);
    else if (a === '--pad')  f.pad      = Number(argv[++i]);
    else if (a === '--palette')  f.palette  = argv[++i];
    else if (a === '--overflow') f.overflow = argv[++i];
  }
  return f;
}

function parseStdin(raw) {
  var trimmed = raw.trim();
  if (trimmed === '') return { blocks: [] };
  if (trimmed.charAt(0) === '{') {
    try {
      var obj = JSON.parse(trimmed);
      if (obj && !Array.isArray(obj) && typeof obj === 'object' && 'blocks' in obj) return obj;
    } catch (e) { /* fall through to JSONL */ }
  }
  var blocks = [];
  var lines = trimmed.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i].trim();
    if (ln === '') continue;
    var b;
    try { b = JSON.parse(ln); }
    catch (e) { throw new Error('line ' + (i + 1) + ' is not valid JSON: ' + e.message); }
    blocks.push(b);
  }
  return { blocks: blocks };
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
    catch (e) { process.stderr.write('grid-sink: ' + e.message + '\n'); process.exitCode = 1; return; }
    var svg;
    try { svg = grid(input, flags); }
    catch (e) { process.stderr.write('grid-sink: ' + e.message + '\n'); process.exitCode = 1; return; }
    process.stdout.write(svg);
  });
}
if (typeof require !== 'undefined' && require.main === module) { main(); }
