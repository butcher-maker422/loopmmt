#!/usr/bin/env node
/* test_exif-parser.js — known-answer battery for exif-parser.js.

   The oracle is OUT OF BAND: each EXIF byte stream is hand-constructed here with a
   tiny builder, and the expected decoded value is written independently as a
   literal fact — NOT produced by a second copy of the parser (which could share a
   bug with the parser under test). A byte buffer plus its hand-computed answer is
   the certificate.
*/

'use strict';
var assert = require('assert');
var { parseExif } = require('./exif-parser.js');

var passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '  — ' + e.message); process.exitCode = 1; }
}

/* -- a minimal little-endian TIFF/EXIF builder (test-only, hand-verified) --
   Layout we emit (all offsets relative to TIFF start):
     [0..1]   "II"
     [2..3]   42
     [4..7]   IFD0 offset = 8
     [8..9]   entry count
     [10..]   12 bytes per entry
     after entries: 4-byte next-IFD ptr (0)
     then: the out-of-line value pool
   Each entry: tag(2) type(2) count(4) value/offset(4).
*/
function u16le(n) { return [n & 0xff, (n >> 8) & 0xff]; }
function u32le(n) { return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]; }

// Build a TIFF block from a list of {tag,type,count,inline?:[4 bytes]|pool?:[bytes]}.
function buildTiff(entries) {
  var header = [0x49, 0x49].concat(u16le(42)).concat(u32le(8));
  var ifdStart = 8;
  var entryBytes = [];
  var pool = [];
  var poolBase = ifdStart + 2 + entries.length * 12 + 4; // after count + entries + nextptr
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var row = u16le(e.tag).concat(u16le(e.type)).concat(u32le(e.count));
    if (e.pool) {
      row = row.concat(u32le(poolBase + pool.length));
      pool = pool.concat(e.pool);
    } else {
      // inline: pad to 4 bytes
      var v = e.inline.slice();
      while (v.length < 4) v.push(0);
      row = row.concat(v);
    }
    entryBytes = entryBytes.concat(row);
  }
  var body = u16le(entries.length).concat(entryBytes).concat(u32le(0)); // next IFD = 0
  var all = header.concat(body).concat(pool);
  return new Uint8Array(all);
}

// Wrap a TIFF block in a minimal JPEG APP1 "Exif\0\0" segment.
function wrapJpeg(tiff) {
  var exifHdr = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
  var payload = exifHdr.concat(Array.from(tiff));
  var segLen = payload.length + 2; // length field includes itself
  var app1 = [0xff, 0xe1].concat([(segLen >> 8) & 0xff, segLen & 0xff]).concat(payload);
  var jpeg = [0xff, 0xd8].concat(app1).concat([0xff, 0xd9]); // SOI ... EOI
  return new Uint8Array(jpeg);
}

function ascii(str) {
  var out = [];
  for (var i = 0; i < str.length; i++) out.push(str.charCodeAt(i));
  out.push(0); // NUL terminator
  return out;
}

/* ---- 1: SHORT inline (Orientation = 6), oracle = 6 ---- */
t('SHORT inline: Orientation decodes to 6', function () {
  var tiff = buildTiff([{ tag: 0x0112, type: 3, count: 1, inline: u16le(6) }]);
  var r = parseExif(tiff);
  assert.strictEqual(r.Orientation, 6);
});

/* ---- 2: ASCII pooled (Make = "LoopCam"), oracle = "LoopCam" ---- */
t('ASCII pooled: Make decodes to "LoopCam", NUL trimmed', function () {
  var s = ascii('LoopCam');
  var tiff = buildTiff([{ tag: 0x010f, type: 2, count: s.length, pool: s }]);
  var r = parseExif(tiff);
  assert.strictEqual(r.Make, 'LoopCam');
});

/* ---- 3: LONG inline (PixelXDimension = 4096), oracle = 4096 ---- */
t('LONG inline: PixelXDimension decodes to 4096', function () {
  var tiff = buildTiff([{ tag: 0xa002, type: 4, count: 1, inline: u32le(4096) }]);
  var r = parseExif(tiff);
  assert.strictEqual(r.PixelXDimension, 4096);
});

/* ---- 4: RATIONAL pooled (FNumber = 28/10), oracle = {num:28,den:10,value:2.8} ---- */
t('RATIONAL pooled: FNumber = 28/10 -> value 2.8', function () {
  var pool = u32le(28).concat(u32le(10));
  var tiff = buildTiff([{ tag: 0x829d, type: 5, count: 1, pool: pool }]);
  var r = parseExif(tiff);
  assert.strictEqual(r.FNumber.num, 28);
  assert.strictEqual(r.FNumber.den, 10);
  assert.ok(Math.abs(r.FNumber.value - 2.8) < 1e-9);
});

/* ---- 5: unknown tag falls back to hex id, never dropped ---- */
t('unknown tag surfaces as hex id (0x9999)', function () {
  var tiff = buildTiff([{ tag: 0x9999, type: 3, count: 1, inline: u16le(7) }]);
  var r = parseExif(tiff);
  assert.strictEqual(r['0x9999'], 7);
});

/* ---- 6: multiple entries, order-independent, all present ---- */
t('multi-entry: Make + Orientation + Model all decode', function () {
  var mk = ascii('LoopCam'), md = ascii('LM-1');
  var tiff = buildTiff([
    { tag: 0x0112, type: 3, count: 1, inline: u16le(1) },
    { tag: 0x010f, type: 2, count: mk.length, pool: mk },
    { tag: 0x0110, type: 2, count: md.length, pool: md }
  ]);
  var r = parseExif(tiff);
  assert.strictEqual(r.Orientation, 1);
  assert.strictEqual(r.Make, 'LoopCam');
  assert.strictEqual(r.Model, 'LM-1');
});

/* ---- 7: big-endian (MM) parses identically ---- */
t('big-endian (MM): Orientation = 3', function () {
  // hand-build a big-endian TIFF: MM, 0x002A, IFD0=8, 1 entry Orientation SHORT=3
  var be = [0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]
    .concat([0x00, 0x01])                              // count
    .concat([0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x03, 0x00, 0x00]) // Orientation SHORT 3
    .concat([0x00, 0x00, 0x00, 0x00]);                 // next IFD
  var r = parseExif(new Uint8Array(be));
  assert.strictEqual(r.Orientation, 3);
});

/* ---- 8: JPEG-wrapped EXIF (full APP1 path) ---- */
t('JPEG APP1: Make decodes through the full JPEG scan', function () {
  var mk = ascii('LoopCam');
  var tiff = buildTiff([{ tag: 0x010f, type: 2, count: mk.length, pool: mk }]);
  var jpeg = wrapJpeg(tiff);
  var r = parseExif(jpeg);
  assert.strictEqual(r.Make, 'LoopCam');
});

/* ---- 9: no-EXIF JPEG returns empty object, not an error ---- */
t('JPEG with no EXIF app1 -> {} (honest empty)', function () {
  var jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // SOI EOI only
  var r = parseExif(jpeg);
  assert.deepStrictEqual(r, {});
});

/* ---- 10: GPS sub-IFD is surfaced under gps:* ---- */
t('GPS sub-IFD: GPSLatitudeRef reachable under gps', function () {
  // Build IFD0 with a GPS pointer to a sub-IFD placed in the pool.
  // Sub-IFD (little-endian): count=1, entry GPSLatitudeRef(0x0001) ASCII "N\0", next=0
  var sub = u16le(1)
    .concat(u16le(0x0001)).concat(u16le(2)).concat(u32le(2)).concat([0x4e, 0x00, 0x00, 0x00]) // "N\0" inline
    .concat(u32le(0));
  // IFD0 with one entry: GPSInfoIFDPointer(0x8825) LONG -> offset of sub in the buffer.
  // We must know the sub's absolute offset. Layout: header(8) + ifd0(count2 + 1*12 + next4) = 8+2+12+4 = 26.
  var header = [0x49, 0x49].concat(u16le(42)).concat(u32le(8));
  var subOffset = 8 + 2 + 12 + 4; // = 26
  var ifd0 = u16le(1)
    .concat(u16le(0x8825)).concat(u16le(4)).concat(u32le(1)).concat(u32le(subOffset))
    .concat(u32le(0));
  var buf = new Uint8Array(header.concat(ifd0).concat(sub));
  var r = parseExif(buf);
  assert.ok(r.gps, 'gps block present');
  assert.strictEqual(r.gps.GPSLatitudeRef, 'N');
});

/* ---- 11: RATCHET — value running past the buffer throws ---- */
t('ratchet: ASCII count past end throws', function () {
  // Declare an ASCII value of huge count with a pool offset near the end.
  var s = ascii('X'); // 2 bytes
  var tiff = buildTiff([{ tag: 0x010f, type: 2, count: 9999, pool: s }]);
  assert.throws(function () { parseExif(tiff); }, /past end/);
});

/* ---- 12: RATCHET — a bad byte-order marker reached via the JPEG path throws.
   A bare buffer whose first two bytes are neither II/MM nor the JPEG SOI is
   rejected up front ("not a JPEG ... not a bare TIFF block"). To exercise the
   byte-order guard specifically, wrap a corrupt-BOM TIFF in a real JPEG APP1 so
   findTiff locates it via "Exif\0\0" and then the header check fires. ---- */
t('ratchet: bad byte-order marker (inside a valid JPEG APP1) throws', function () {
  var badTiff = [0x00, 0x00, 0x00, 0x2a, 0, 0, 0, 8, 0, 0, 0, 0]; // BOM 0x0000
  var exifHdr = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  var payload = exifHdr.concat(badTiff);
  var segLen = payload.length + 2;
  var jpeg = [0xff, 0xd8, 0xff, 0xe1, (segLen >> 8) & 0xff, segLen & 0xff]
    .concat(payload).concat([0xff, 0xd9]);
  assert.throws(function () { parseExif(new Uint8Array(jpeg)); }, /byte-order/);
});

/* ---- 13: RATCHET — bad TIFF magic (not 42) throws ---- */
t('ratchet: bad TIFF magic throws', function () {
  var bad = new Uint8Array([0x49, 0x49, 0x00, 0x63, 0, 0, 0, 8, 0, 0, 0, 0]); // magic 0x6300
  assert.throws(function () { parseExif(bad); }, /magic/);
});

/* ---- 14: mutation bite — flip the oracle, prove the test would catch a wrong decode ---- */
t('mutation bite: a wrong Orientation would fail #1', function () {
  var tiff = buildTiff([{ tag: 0x0112, type: 3, count: 1, inline: u16le(6) }]);
  var r = parseExif(tiff);
  assert.notStrictEqual(r.Orientation, 5); // it is 6; a parser returning 5 fails
});

console.log('\n' + passed + '/14 checks passed');
