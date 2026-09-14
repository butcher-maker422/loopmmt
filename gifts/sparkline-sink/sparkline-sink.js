#!/usr/bin/env node
/*
 * sparkline-sink — turn a numeric series into one inline unicode sparkline, no deps.
 * MIT · zero-dependency · standalone gift · lane: sink (consumes data, emits an artifact).
 *
 * THE PRINTED EDGE (read before trusting the output):
 *   This is a GLYPH sparkline, not a chart. It emits ONE line of unicode block
 *   characters (▁▂▃▄▅▆▇█), one glyph per value, mapping each value to one of
 *   EXACTLY 8 discrete levels across the data's [min,max] range. It renders NO
 *   axis, labels, numbers, color, or scale markers — only the shape. Because there
 *   are only 8 levels, two values in the same eighth of the range draw the SAME
 *   glyph: it shows TREND, not magnitude, and it is not a substitute for the number.
 *   It takes NUMBERS ONLY — no caller text ever reaches the output, so there is no
 *   escaping surface. A non-finite value (NaN / Infinity) is a hard error, never a
 *   silently-dropped or guessed point. Output is a PURE FUNCTION of the input: same
 *   series in → byte-identical line out.
 *
 * USAGE:
 *   echo '[3,1,4,1,5,9,2,6]'          | node sparkline-sink.js     # ▃▁▄▁▅█▂▆  (+ newline)
 *   echo '[0,1,2,3,4,5,6,7]'          | node sparkline-sink.js     # ▁▂▃▄▅▆▇█
 *   echo '{"series":[5],"min":0,"max":10}' | node sparkline-sink.js
 *   node sparkline-sink.js --help
 *
 * INPUT (stdin, JSON): either
 *   - a bare array of numbers                 -> [1,2,3]
 *   - a spec object { series, min, max }      -> pin the domain instead of auto-fit
 *   CLI flags (--min --max) OVERRIDE object fields.
 *
 * OUTPUT (stdout): one line of block glyphs (UTF-8), trailing newline. Empty series -> a bare newline.
 *
 * DETERMINISM: each value maps to an INTEGER level (a bucket), so no float noise or
 *   platform drift can reach the output. Same series → same bytes, in Node or a browser.
 * PORTABILITY: pure JS on a plain array — identical in Node and the browser.
 */
'use strict';

// The ONLY output alphabet: 8 block levels, low to high. U+2581 .. U+2588.
var LEVELS = ['\u2581', '\u2582', '\u2583', '\u2584', '\u2585', '\u2586', '\u2587', '\u2588'];

function finite(v, j) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('series[' + j + '] is not a finite number: ' + JSON.stringify(v));
  }
  return v;
}

// Shared shape with svg-sink's domain(): auto-fit [min(data),max(data)] unless pinned;
// a flat series opens to a unit window so every value lands mid-scale (never a divide-by-0).
function domain(series, min, max) {
  var lo = (min != null) ? Number(min) : Infinity;
  var hi = (max != null) ? Number(max) : -Infinity;
  if (min == null || max == null) {
    for (var j = 0; j < series.length; j++) {
      var v = series[j];
      if (min == null && v < lo) lo = v;
      if (max == null && v > hi) hi = v;
    }
  }
  if (!isFinite(lo)) lo = 0;
  if (!isFinite(hi)) hi = 0;
  if (lo === hi) { lo -= 1; hi += 1; }   // flat series -> unit window, drawn mid-scale
  return { lo: lo, hi: hi };
}

function level(v, lo, hi) {
  var k = Math.floor(((v - lo) / (hi - lo)) * LEVELS.length);
  if (k < 0) k = 0;
  if (k >= LEVELS.length) k = LEVELS.length - 1;   // v == hi -> 8 clamps to 7
  return k;
}

function normalize(input, flags) {
  var spec = {};
  var seriesRaw;
  if (input && !Array.isArray(input) && typeof input === 'object') {
    seriesRaw = input.series;
    if (input.min != null) spec.min = input.min;
    if (input.max != null) spec.max = input.max;
  } else {
    seriesRaw = input;
  }
  flags = flags || {};
  if (flags.min != null) spec.min = flags.min;       // CLI flags override object fields
  if (flags.max != null) spec.max = flags.max;

  if (!Array.isArray(seriesRaw)) {
    throw new Error('input has no numeric series (expected an array or a {series:...} object)');
  }
  if (seriesRaw.length > 0 && Array.isArray(seriesRaw[0])) {
    throw new Error('sparkline-sink takes ONE series (a flat array of numbers), not nested arrays');
  }
  spec.series = seriesRaw.map(function (v, j) { return finite(v, j); });
  if (spec.min != null) { spec.min = numOrThrow(spec.min, 'min'); }
  if (spec.max != null) { spec.max = numOrThrow(spec.max, 'max'); }
  if (spec.min != null && spec.max != null && spec.min >= spec.max) {
    throw new Error('min must be < max (got min=' + spec.min + ', max=' + spec.max + ')');
  }
  return spec;
}
function numOrThrow(v, name) {
  var n = Number(v);
  if (typeof n !== 'number' || !isFinite(n)) throw new Error(name + ' must be a finite number, got ' + JSON.stringify(v));
  return n;
}

// ---- the gift: series -> one line of block glyphs -------------------------------
function sparkline(input, flags) {
  var spec = normalize(input, flags);
  var d = domain(spec.series, spec.min, spec.max);
  var out = '';
  for (var j = 0; j < spec.series.length; j++) {
    out += LEVELS[level(spec.series[j], d.lo, d.hi)];
  }
  return out + '\n';
}

// ---- exports (Node require + browser attach) ------------------------------------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sparkline: sparkline, normalize: normalize, domain: domain, LEVELS: LEVELS };
}
if (typeof window !== 'undefined') {
  window.LoopGifts = window.LoopGifts || {};
  window.LoopGifts['sparkline-sink'] = { sparkline: sparkline, LEVELS: LEVELS };
}

// ---- CLI ------------------------------------------------------------------------
function main() {
  var argv = process.argv.slice(2);
  if (argv.indexOf('--help') !== -1 || argv.indexOf('-h') !== -1) {
    process.stdout.write(
      'sparkline-sink — numbers -> one inline unicode sparkline (' + LEVELS.join('') + '), zero deps.\n\n' +
      'USAGE:\n' +
      "  echo '[3,1,4,1,5,9,2,6]' | node sparkline-sink.js [--min N] [--max N]\n\n" +
      'INPUT (stdin, JSON): a bare array of numbers, or { "series": [...], "min": N, "max": N }.\n' +
      'OUTPUT: one line of 8-level block glyphs, trailing newline. Numbers only; non-finite is a hard error.\n' +
      'EDGE: 8 discrete levels — shows shape, not magnitude; no axis/labels/color.\n');
    return;
  }
  var flags = {};
  for (var i = 0; i < argv.length; i++) {
    if (argv[i] === '--min') flags.min = Number(argv[++i]);
    else if (argv[i] === '--max') flags.max = Number(argv[++i]);
  }
  var chunks = [];
  process.stdin.on('data', function (c) { chunks.push(c); });
  process.stdin.on('end', function () {
    var raw = chunks.join('').trim();
    if (!raw) { process.stdout.write('\n'); return; }   // empty stdin -> empty sparkline
    var input;
    try { input = JSON.parse(raw); }
    catch (e) { process.stderr.write('sparkline-sink: input is not valid JSON: ' + e.message + '\n'); process.exit(1); }
    try { process.stdout.write(sparkline(input, flags)); }
    catch (e) { process.stderr.write('sparkline-sink: ' + e.message + '\n'); process.exit(1); }
  });
}
if (typeof require !== 'undefined' && require.main === module) { main(); }
