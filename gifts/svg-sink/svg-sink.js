#!/usr/bin/env node
/*
 * svg-sink — turn numeric series into a standalone, deterministic SVG chart, no deps.
 * MIT · zero-dependency · standalone gift · lane: sink (consumes data, emits an artifact).
 *
 * THE PRINTED EDGE (read before trusting the output):
 *   This is a CHART PRIMITIVE, not a charting library. It draws GEOMETRY ONLY — a
 *   <polyline> per series (line), a <rect> per value (bar), or a <circle> per value
 *   (scatter) inside a plain <svg> frame. It renders NO axes, gridlines, tick marks,
 *   tick labels, legend, title, or interactivity, and it embeds NO fonts, NO CSS, and
 *   NO <script>. It takes NUMBERS ONLY — no caller text ever reaches the output, so
 *   there is no text-escaping surface to get wrong. Colors are NOT free-form input:
 *   series are painted from a fixed, named palette (index = series order), so the
 *   output can never carry an attacker-chosen attribute string. A non-finite value
 *   (NaN / Infinity) is a hard error, never a silently-dropped or guessed point.
 *   Output is a PURE FUNCTION of the input: same spec in → byte-identical SVG out.
 *
 * USAGE:
 *   echo '[3,1,4,1,5,9,2,6]' | node svg-sink.js                 # line chart, defaults
 *   echo '[3,1,4,1,5,9]'     | node svg-sink.js --kind bar
 *   echo '[[1,2,3],[3,2,1]]' | node svg-sink.js --kind scatter  # two series
 *   echo '{"series":[1,2,3],"kind":"line","width":400,"height":120}' | node svg-sink.js
 *   node svg-sink.js --help
 *
 * INPUT (stdin, JSON): either
 *   - a bare array of numbers            -> one series, e.g. [1,2,3]
 *   - a bare array of arrays of numbers  -> many series, e.g. [[1,2],[3,4]]
 *   - a spec object { series, kind, width, height, pad, min, max, palette }
 *     where `series` is either of the two array forms above.
 *   CLI flags (--kind --width --height --pad --palette) OVERRIDE object fields.
 *
 * OUTPUT (stdout): one SVG document string (UTF-8), trailing newline.
 *
 * DETERMINISM: no wall-clock, no randomness, fixed 3-decimal coordinate precision,
 *   stable attribute order, palette indexed by series position. Same spec → same bytes.
 * PORTABILITY: pure JS on plain arrays/strings — identical in Node and the browser.
 */
'use strict';

// ---- palettes (the ONLY source of color; no free-form color input) --------------
// Named, closed sets. A series at index i is painted PALETTES[name][i % len].
var PALETTES = {
  loop:  ['#2f6f8f', '#c25b3a', '#4a8a52', '#8a6d3b', '#6d4a8a', '#3b6d8a'],
  mono:  ['#111111', '#555555', '#999999', '#bbbbbb'],
  warm:  ['#c25b3a', '#d98a3a', '#b23b3b', '#8a5a2b'],
  cool:  ['#2f6f8f', '#4a8a8a', '#3b5a8a', '#5a6d8a']
};
var DEFAULTS = { kind: 'line', width: 300, height: 100, pad: 6, palette: 'loop' };
var KINDS = { line: 1, bar: 1, scatter: 1 };

// ---- deterministic number formatting -------------------------------------------
// Round to 3 decimals, strip trailing zeros (and a bare trailing dot), normalize -0.
// The whole determinism guarantee of a coordinate emitter rests on this one function:
// float arithmetic that fed toString() directly would leak platform-dependent digits.
var PRECISION = 3, SCALE = 1000; // 10 ** 3
function num(x) {
  var r = Math.round(x * SCALE) / SCALE;
  var s = r.toFixed(PRECISION);            // always has a '.' and PRECISION digits
  s = s.replace(/\.?0+$/, '');             // "12.300"->"12.3", "10.000"->"10"
  return (s === '' || s === '-0') ? '0' : s;
}

// ---- input normalization -------------------------------------------------------
// Accept: number[] | number[][] | {series, ...}. Return a validated spec.
function normalize(input, flags) {
  var spec = {};
  var seriesRaw;
  if (input && !Array.isArray(input) && typeof input === 'object') {
    seriesRaw = input.series;
    if (input.kind    != null) spec.kind    = input.kind;
    if (input.width   != null) spec.width   = input.width;
    if (input.height  != null) spec.height  = input.height;
    if (input.pad     != null) spec.pad     = input.pad;
    if (input.min     != null) spec.min     = input.min;
    if (input.max     != null) spec.max     = input.max;
    if (input.palette != null) spec.palette = input.palette;
  } else {
    seriesRaw = input;
  }
  // CLI flags override object fields.
  flags = flags || {};
  for (var k in flags) if (flags[k] != null) spec[k] = flags[k];

  // series -> number[][]
  if (!Array.isArray(seriesRaw)) throw new Error('input has no numeric series (expected an array or a {series:...} object)');
  var series;
  if (seriesRaw.length > 0 && Array.isArray(seriesRaw[0])) {
    series = seriesRaw.map(function (s, i) {
      if (!Array.isArray(s)) throw new Error('series ' + i + ' is not an array');
      return s.map(function (v, j) { return finite(v, i, j); });
    });
  } else {
    series = [seriesRaw.map(function (v, j) { return finite(v, 0, j); })];
  }

  spec.series  = series;
  spec.kind    = (spec.kind    != null) ? String(spec.kind)     : DEFAULTS.kind;
  spec.width   = int(spec.width,   DEFAULTS.width,  'width');
  spec.height  = int(spec.height,  DEFAULTS.height, 'height');
  spec.pad     = int(spec.pad,     DEFAULTS.pad,    'pad');
  spec.palette = (spec.palette != null) ? String(spec.palette) : DEFAULTS.palette;

  if (!KINDS[spec.kind]) throw new Error('unknown kind "' + spec.kind + '" (expected line | bar | scatter)');
  if (!PALETTES[spec.palette]) throw new Error('unknown palette "' + spec.palette + '" (expected ' + Object.keys(PALETTES).join(' | ') + ')');
  if (spec.width <= 2 * spec.pad || spec.height <= 2 * spec.pad) throw new Error('width/height too small for pad (need width,height > 2*pad)');
  return spec;
}
function finite(v, i, j) {
  if (typeof v !== 'number' || !isFinite(v)) throw new Error('series ' + i + '[' + j + '] is not a finite number: ' + JSON.stringify(v));
  return v;
}
function int(v, dflt, name) {
  if (v == null) return dflt;
  var n = Number(v);
  if (!isFinite(n) || Math.floor(n) !== n || n < 0) throw new Error(name + ' must be a non-negative integer, got ' + JSON.stringify(v));
  return n;
}

// ---- scale (shared y-domain across all series) ---------------------------------
function domain(series, min, max) {
  var lo = (min != null) ? Number(min) : Infinity;
  var hi = (max != null) ? Number(max) : -Infinity;
  if (min == null || max == null) {
    for (var i = 0; i < series.length; i++)
      for (var j = 0; j < series[i].length; j++) {
        var v = series[i][j];
        if (min == null && v < lo) lo = v;
        if (max == null && v > hi) hi = v;
      }
  }
  if (!isFinite(lo)) lo = 0;
  if (!isFinite(hi)) hi = 0;
  if (lo === hi) { lo -= 1; hi += 1; } // flat series -> a unit window, drawn mid-frame
  return { lo: lo, hi: hi };
}

// ---- core: renderSVG(spec) -> string  (pure, the whole gift) --------------------
function renderSVG(input, flags) {
  var spec = normalize(input, flags);
  var W = spec.width, H = spec.height, pad = spec.pad;
  var series = spec.series;
  var dom = domain(series, spec.min, spec.max);
  // Bar charts baseline at zero: extend an AUTO-computed domain to include 0 so the
  // zero line is on-canvas and bar heights read value-proportional (the bar convention).
  // An explicit min/max is honored as-is — the caller's window wins.
  if (spec.kind === 'bar') {
    if (spec.min == null) dom.lo = Math.min(dom.lo, 0);
    if (spec.max == null) dom.hi = Math.max(dom.hi, 0);
  }
  var pal = PALETTES[spec.palette];
  var innerW = W - 2 * pad, innerH = H - 2 * pad;

  // index i (0..n-1) -> x within [pad, W-pad]; value v -> y (inverted) within [pad, H-pad]
  function X(i, n) { return n <= 1 ? pad + innerW / 2 : pad + (i / (n - 1)) * innerW; }
  function Y(v)    { return (H - pad) - ((v - dom.lo) / (dom.hi - dom.lo)) * innerH; }

  var body = [];
  if (spec.kind === 'line')    body = lineBody(series, pal, X, Y);
  else if (spec.kind === 'bar')     body = barBody(series, pal, X, Y, W, pad, dom);
  else if (spec.kind === 'scatter') body = scatterBody(series, pal, X, Y);

  // Fixed attribute order; xmlns first so the fragment is a valid standalone document.
  var open = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '">';
  return open + '\n' + (body.length ? body.join('\n') + '\n' : '') + '</svg>\n';
}

function lineBody(series, pal, X, Y) {
  var out = [];
  for (var s = 0; s < series.length; s++) {
    var pts = series[s];
    var n = pts.length;
    if (n === 0) continue;
    var coords = [];
    for (var i = 0; i < n; i++) coords.push(num(X(i, n)) + ',' + num(Y(pts[i])));
    var color = pal[s % pal.length];
    if (n === 1) {
      // a single point is drawn as a dot so it is not invisible
      var p = coords[0].split(',');
      out.push('<circle cx="' + p[0] + '" cy="' + p[1] + '" r="1.5" fill="' + color + '" />');
    } else {
      out.push('<polyline fill="none" stroke="' + color + '" stroke-width="1.5" points="' + coords.join(' ') + '" />');
    }
  }
  return out;
}

function scatterBody(series, pal, X, Y) {
  var out = [];
  for (var s = 0; s < series.length; s++) {
    var pts = series[s], n = pts.length, color = pal[s % pal.length];
    for (var i = 0; i < n; i++)
      out.push('<circle cx="' + num(X(i, n)) + '" cy="' + num(Y(pts[i])) + '" r="2" fill="' + color + '" />');
  }
  return out;
}

function barBody(series, pal, X, Y, W, pad, dom) {
  var out = [];
  var nSeries = series.length;
  // baseline: 0 if the domain straddles it, else the domain floor.
  var baseV = (dom.lo <= 0 && dom.hi >= 0) ? 0 : dom.lo;
  var baseY = Y(baseV);
  // slot = horizontal room per index; bars for multiple series subdivide the slot.
  var maxN = 0;
  for (var s = 0; s < nSeries; s++) if (series[s].length > maxN) maxN = series[s].length;
  if (maxN === 0) return out;
  var innerW = W - 2 * pad;
  var slot = innerW / maxN;
  var groupW = slot * 0.8;             // 20% gap between index groups
  var barW = groupW / nSeries;
  for (var si = 0; si < nSeries; si++) {
    var pts = series[si], color = pal[si % pal.length];
    for (var i = 0; i < pts.length; i++) {
      var v = pts[i];
      var y = Y(v);
      var top = Math.min(y, baseY), h = Math.abs(y - baseY);
      var x = pad + i * slot + (slot - groupW) / 2 + si * barW;
      out.push('<rect x="' + num(x) + '" y="' + num(top) + '" width="' + num(barW) + '" height="' + num(h) + '" fill="' + color + '" />');
    }
  }
  return out;
}

// ---- cli -----------------------------------------------------------------------
var HELP =
'svg-sink — numeric series -> a standalone, deterministic SVG chart, zero deps.\n\n' +
'  echo \'[3,1,4,1,5]\'     | node svg-sink.js                line chart (default)\n' +
'  echo \'[3,1,4,1,5]\'     | node svg-sink.js --kind bar\n' +
'  echo \'[[1,2,3],[3,2,1]]\' | node svg-sink.js --kind scatter   two series\n' +
'  echo \'{"series":[1,2,3],"width":400,"height":120}\' | node svg-sink.js\n\n' +
'Flags (override object fields): --kind line|bar|scatter  --width N  --height N\n' +
'                                --pad N  --palette loop|mono|warm|cool\n\n' +
'Geometry only: no axes, labels, legend, fonts, CSS, or script. Numbers in, shapes\n' +
'out. Colors come from a fixed named palette (not caller input). Non-finite -> error.\n';

function parseFlags(argv) {
  var f = {};
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--kind')    f.kind    = argv[++i];
    else if (a === '--width')   f.width   = argv[++i];
    else if (a === '--height')  f.height  = argv[++i];
    else if (a === '--pad')     f.pad     = argv[++i];
    else if (a === '--palette') f.palette = argv[++i];
  }
  return f;
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
    try { input = JSON.parse(chunks); }
    catch (e) { process.stderr.write('svg-sink: input is not valid JSON: ' + e.message + '\n'); process.exitCode = 1; return; }
    var svg;
    try { svg = renderSVG(input, flags); }
    catch (e) { process.stderr.write('svg-sink: ' + e.message + '\n'); process.exitCode = 1; return; }
    process.stdout.write(svg);
  });
}

// ---- triple export (browser attach · require · direct run) ---------------------
if (typeof window !== 'undefined') {
  window.LoopGifts = window.LoopGifts || {};
  window.LoopGifts['svg-sink'] = { renderSVG: renderSVG };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderSVG: renderSVG, num: num, normalize: normalize, PALETTES: PALETTES };
}
if (typeof require !== 'undefined' && require.main === module) {
  main();
}
