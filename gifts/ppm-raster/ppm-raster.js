#!/usr/bin/env node
/*
 * ppm-raster — rasterize a JSONL stream of primitives into ONE standalone PPM image, no deps.
 * MIT · zero-dependency · standalone gift · lane: sink (consumes a stream, emits an artifact).
 *
 * THE PRINTED EDGE (read before trusting the output):
 *   This is a RASTER PRIMITIVE, not a graphics library. It fills a fixed integer pixel
 *   grid from four primitive kinds — `pixel`, `rect`, `hline`, `vline` — and writes a
 *   plain PPM (Netpbm) image. It has NO anti-aliasing, NO blending/alpha (every draw is
 *   an opaque overwrite), NO sub-pixel coordinates, NO diagonal lines, NO curves, NO
 *   text, and NO color names — colors are integer [r,g,b] triples in 0..255 only. Later
 *   primitives paint OVER earlier ones (painter's order, stream order). Coordinates are
 *   integers with the ORIGIN AT TOP-LEFT (x right, y down); a primitive that falls
 *   wholly or partly outside the canvas is CLIPPED, never an error, but a malformed
 *   record (bad kind, non-integer coord, out-of-range channel, non-finite number) is a
 *   HARD ERROR naming the offending line — never a silently-dropped or guessed pixel.
 *   Output is a PURE FUNCTION of (header + stream): same input → byte-identical PPM out.
 *
 * USAGE:
 *   printf '{"w":4,"h":3}\n{"kind":"pixel","x":0,"y":0,"rgb":[255,0,0]}\n' | node ppm-raster.js
 *   printf '{"w":8,"h":8,"bg":[255,255,255]}\n{"kind":"rect","x":1,"y":1,"w":4,"h":3,"rgb":[0,0,0]}\n' | node ppm-raster.js
 *   node ppm-raster.js --help
 *
 * INPUT (stdin, JSON Lines — one JSON object per line, blank lines ignored):
 *   - LINE 1 is the HEADER: { "w": <int>, "h": <int>, "bg"?: [r,g,b] }
 *       w,h are the canvas size in pixels (1..8192). bg is the fill color (default black [0,0,0]).
 *   - EACH FURTHER LINE is a PRIMITIVE, one of:
 *       { "kind":"pixel", "x":X, "y":Y, "rgb":[r,g,b] }
 *       { "kind":"rect",  "x":X, "y":Y, "w":W, "h":H, "rgb":[r,g,b] }   // filled, W×H, top-left at (X,Y)
 *       { "kind":"hline", "x":X, "y":Y, "len":L, "rgb":[r,g,b] }        // horizontal run, L px right
 *       { "kind":"vline", "x":X, "y":Y, "len":L, "rgb":[r,g,b] }        // vertical run, L px down
 *   Coordinates/sizes are integers; rgb channels are integers 0..255.
 *
 * OUTPUT (stdout): one PPM document (UTF-8 text; P3 ASCII by default, P6 binary with --binary).
 *   `--out FILE` writes the artifact to FILE instead of stdout (the sink's commit boundary).
 *
 * DETERMINISM: no wall-clock, no randomness, fixed row/column raster order, one space between
 *   samples, newline per pixel-row in P3. Same input bytes → same output bytes, every run,
 *   in Node or the browser (the core is pure over plain arrays).
 */
'use strict';

var MAXDIM = 8192;

// ---- validation helpers (a bad record is a HARD ERROR, never a guessed pixel) --------
function isInt(x) { return typeof x === 'number' && isFinite(x) && Math.floor(x) === x; }
function intAt(rec, key, where) {
  var v = rec[key];
  if (!isInt(v)) throw new Error(where + ': "' + key + '" must be an integer (got ' + JSON.stringify(v) + ')');
  return v;
}
function chan(v, where, i) {
  if (!isInt(v) || v < 0 || v > 255) throw new Error(where + ': rgb[' + i + '] must be an integer 0..255 (got ' + JSON.stringify(v) + ')');
  return v;
}
function rgbAt(rec, where) {
  var c = rec.rgb;
  if (!Array.isArray(c) || c.length !== 3) throw new Error(where + ': "rgb" must be a [r,g,b] array of three integers');
  return [chan(c[0], where, 0), chan(c[1], where, 1), chan(c[2], where, 2)];
}

// ---- the canvas: a flat Uint-like array of r,g,b bytes, row-major, origin top-left -----
function makeCanvas(w, h, bg) {
  var n = w * h * 3, buf = new Array(n), i;
  for (i = 0; i < n; i += 3) { buf[i] = bg[0]; buf[i + 1] = bg[1]; buf[i + 2] = bg[2]; }
  return { w: w, h: h, buf: buf };
}
// opaque overwrite; out-of-bounds is a silent clip (per the printed edge), never an error
function put(cv, x, y, rgb) {
  if (x < 0 || y < 0 || x >= cv.w || y >= cv.h) return;
  var o = (y * cv.w + x) * 3;
  cv.buf[o] = rgb[0]; cv.buf[o + 1] = rgb[1]; cv.buf[o + 2] = rgb[2];
}

// ---- primitive dispatch (closed, named set; anything else is a hard error) ------------
function draw(cv, rec, where) {
  var x, y, w, h, len, rgb, dx, dy;
  switch (rec.kind) {
    case 'pixel':
      x = intAt(rec, 'x', where); y = intAt(rec, 'y', where); rgb = rgbAt(rec, where);
      put(cv, x, y, rgb);
      break;
    case 'rect':
      x = intAt(rec, 'x', where); y = intAt(rec, 'y', where);
      w = intAt(rec, 'w', where); h = intAt(rec, 'h', where); rgb = rgbAt(rec, where);
      if (w < 0 || h < 0) throw new Error(where + ': rect w,h must be >= 0');
      for (dy = 0; dy < h; dy++) for (dx = 0; dx < w; dx++) put(cv, x + dx, y + dy, rgb);
      break;
    case 'hline':
      x = intAt(rec, 'x', where); y = intAt(rec, 'y', where);
      len = intAt(rec, 'len', where); rgb = rgbAt(rec, where);
      if (len < 0) throw new Error(where + ': hline len must be >= 0');
      for (dx = 0; dx < len; dx++) put(cv, x + dx, y, rgb);
      break;
    case 'vline':
      x = intAt(rec, 'x', where); y = intAt(rec, 'y', where);
      len = intAt(rec, 'len', where); rgb = rgbAt(rec, where);
      if (len < 0) throw new Error(where + ': vline len must be >= 0');
      for (dy = 0; dy < len; dy++) put(cv, x, y + dy, rgb);
      break;
    default:
      throw new Error(where + ': unknown kind ' + JSON.stringify(rec.kind) +
        ' (expected pixel|rect|hline|vline)');
  }
}

// ---- header normalization -------------------------------------------------------------
function normalizeHeader(rec, where) {
  var w = intAt(rec, 'w', where), h = intAt(rec, 'h', where);
  if (w < 1 || w > MAXDIM || h < 1 || h > MAXDIM)
    throw new Error(where + ': canvas w,h must be integers in 1..' + MAXDIM);
  var bg = [0, 0, 0];
  if (rec.bg != null) { var t = { rgb: rec.bg }; bg = rgbAt(t, where + ' (bg)'); }
  return { w: w, h: h, bg: bg };
}

// ---- PPM emitters (the deterministic commit) ------------------------------------------
// P3 ASCII: header "P3\n<w> <h>\n255\n" then one line per row, samples space-separated.
function toP3(cv) {
  var out = 'P3\n' + cv.w + ' ' + cv.h + '\n255\n';
  var rows = [], x, y, o, cells;
  for (y = 0; y < cv.h; y++) {
    cells = [];
    for (x = 0; x < cv.w; x++) {
      o = (y * cv.w + x) * 3;
      cells.push(cv.buf[o] + ' ' + cv.buf[o + 1] + ' ' + cv.buf[o + 2]);
    }
    rows.push(cells.join(' '));
  }
  return out + rows.join('\n') + '\n';
}
// P6 binary: header "P6\n<w> <h>\n255\n" then raw r,g,b bytes, row-major. Returned as a
// latin1 string so the CLI can write it byte-for-byte; the browser export returns bytes.
function toP6Bytes(cv) {
  var head = 'P6\n' + cv.w + ' ' + cv.h + '\n255\n';
  var body = new Array(cv.w * cv.h * 3), i;
  for (i = 0; i < body.length; i++) body[i] = cv.buf[i];
  return { head: head, body: body };
}

// ---- the whole pipeline: JSONL text -> PPM string (P3) --------------------------------
function rasterize(jsonlText, opts) {
  opts = opts || {};
  var lines = String(jsonlText).split('\n');
  var cv = null, i, raw, rec, ln;
  for (i = 0; i < lines.length; i++) {
    raw = lines[i].trim();
    if (raw === '') continue;                 // blank lines ignored
    ln = 'line ' + (i + 1);
    try { rec = JSON.parse(raw); }
    catch (e) { throw new Error(ln + ': not valid JSON (' + e.message + ')'); }
    if (rec === null || typeof rec !== 'object' || Array.isArray(rec))
      throw new Error(ln + ': each line must be a JSON object');
    if (cv === null) {
      var hd = normalizeHeader(rec, ln);      // first non-blank line is the header
      cv = makeCanvas(hd.w, hd.h, hd.bg);
    } else {
      draw(cv, rec, ln);
    }
  }
  if (cv === null) throw new Error('empty input: expected a header line {"w":..,"h":..} first');
  if (opts.binary) return toP6Bytes(cv);
  return toP3(cv);
}

// ---- CLI ------------------------------------------------------------------------------
var HELP =
'ppm-raster — rasterize a JSONL primitive stream into one standalone PPM image, no deps.\n\n' +
'USAGE:\n' +
'  printf \'{"w":4,"h":3}\\n{"kind":"pixel","x":0,"y":0,"rgb":[255,0,0]}\\n\' | node ppm-raster.js\n' +
'  printf \'{"w":8,"h":8,"bg":[255,255,255]}\\n{"kind":"rect","x":1,"y":1,"w":4,"h":3,"rgb":[0,0,0]}\\n\' | node ppm-raster.js\n' +
'  ... | node ppm-raster.js --binary --out image.ppm\n\n' +
'INPUT (stdin, JSONL): line 1 is the header {"w":INT,"h":INT,"bg"?:[r,g,b]}; each further\n' +
'line is a primitive: pixel{x,y,rgb} · rect{x,y,w,h,rgb} · hline{x,y,len,rgb} · vline{x,y,len,rgb}.\n' +
'Integers only; rgb channels 0..255; origin top-left; later primitives paint over earlier.\n\n' +
'FLAGS:\n' +
'  --binary     emit P6 (raw bytes) instead of P3 (ASCII text)\n' +
'  --out FILE   write the image to FILE instead of stdout (the sink commit)\n\n' +
'Raster primitive, not a graphics library: no anti-aliasing, alpha, curves, diagonals,\n' +
'text, or color names. Out-of-canvas draws clip; a malformed record is a hard error.\n';

function parseFlags(argv) {
  var f = { binary: false, out: null };
  for (var i = 0; i < argv.length; i++) {
    if (argv[i] === '--binary') f.binary = true;
    else if (argv[i] === '--out') f.out = argv[++i];
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
    var result;
    try { result = rasterize(chunks, { binary: flags.binary }); }
    catch (e) { process.stderr.write('ppm-raster: ' + e.message + '\n'); process.exitCode = 1; return; }
    var fs = require('fs');
    if (flags.binary) {
      var buf = Buffer.concat([Buffer.from(result.head, 'ascii'), Buffer.from(result.body)]);
      if (flags.out) fs.writeFileSync(flags.out, buf);
      else process.stdout.write(buf);
    } else {
      if (flags.out) fs.writeFileSync(flags.out, result, 'utf8');
      else process.stdout.write(result);
    }
  });
}

// ---- triple export (browser attach · require · direct run) ----------------------------
if (typeof window !== 'undefined') {
  window.LoopGifts = window.LoopGifts || {};
  window.LoopGifts['ppm-raster'] = { rasterize: rasterize };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { rasterize: rasterize, toP3: toP3, toP6Bytes: toP6Bytes,
                     makeCanvas: makeCanvas, draw: draw, normalizeHeader: normalizeHeader };
}
if (typeof require !== 'undefined' && require.main === module) {
  main();
}
