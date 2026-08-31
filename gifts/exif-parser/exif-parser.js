#!/usr/bin/env node
/* exif-parser.js — a pure, dependency-free EXIF reader that walks the TIFF IFD
   structure inside a JPEG (or a bare TIFF/EXIF block) and returns the tags as
   named key/value entries. Runs identically in a browser and in Node (no DOM,
   no dependencies).

   WHY THIS EXISTS. A photo carries its camera metadata — Make, Model, DateTime,
   Orientation, ExposureTime, FNumber, ISO, focal length, and (if present) GPS —
   in an EXIF block, which is itself a little-endian-or-big-endian TIFF stream of
   Image File Directories (IFDs). You have the file's bytes and you want those
   fields without pulling in a full image library that decodes pixels you don't
   care about. The usual answer is a heavy dependency, or a hand-rolled loop that
   trusts the file and reads a value off the end of the buffer.

   WHAT "RATCHET" MEANS HERE (same discipline as the png-text gift). This parser
   validates structure before it trusts it: the JPEG SOI marker, the "Exif\0\0"
   app1 signature, the TIFF byte-order marker (II / MM) and the 42 magic, and every
   IFD-entry offset before it dereferences it. A count/offset that runs past the end
   of the buffer, a byte-order marker that is neither II nor MM, an IFD that points
   outside the block — each is a thrown Error, never a value read from nowhere. A
   parser that hands you a tag value out of a truncated buffer is lying about what
   the file says; this one won't.

   WHAT IT EXTRACTS (the whole contract — a parser that hides its scope lies):
     • The primary IFD (IFD0) and the Exif sub-IFD (tag 0x8769), merged.
     • The GPS sub-IFD (tag 0x8825) when present, under gps:*.
     • Each entry is decoded by TIFF type: BYTE/ASCII/SHORT/LONG/RATIONAL and
       their signed variants, plus UNDEFINED (surfaced as raw bytes). ASCII is
       trimmed of its trailing NUL. RATIONAL is surfaced as { num, den } AND a
       numeric `value` (num/den) for convenience.
     • Tag numbers are mapped to human names for the common set; an unknown tag is
       surfaced under its hex id (e.g. "0x9999") so nothing is silently dropped.

   WHAT IT DOES NOT DO (stated on purpose — see the README's "edge"):
     It does not decode pixels, thumbnails, or the MakerNote blob (vendor-specific,
     undocumented — surfaced as raw UNDEFINED bytes, never guessed). It does not
     rewrite or strip EXIF. It follows IFD0 -> Exif-IFD -> GPS-IFD; it does not
     chase IFD1 (the thumbnail directory) or interoperability IFDs. It does not
     repair a bad file — malformed input throws.

   API
     parseExif(bytes) -> { <name>: value, ..., gps?: { <name>: value, ... } }
       `bytes`  a Uint8Array (a Node Buffer is a Uint8Array) or an ArrayBuffer.
                May be a whole JPEG, or a bare TIFF/EXIF block starting at "II"/"MM".
       Returns a flat object of decoded tags (possibly empty if the file carries no
       EXIF app1). THROWS an Error on any malformed input.

   Pure function of its input. Same code in a browser
   (window.LoopGifts.parseExif) or Node (this CLI / require()).

   USAGE
     node exif-parser.js photo.jpg     # prints "name\tvalue" per tag
     node exif-parser.js --help
*/

'use strict';

/* ---- input coercion (Buffer/ArrayBuffer/Uint8Array -> Uint8Array) ---- */
function toU8(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (input && input.buffer instanceof ArrayBuffer) {
    return new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength);
  }
  throw new Error('exif-parser: input must be a Uint8Array or ArrayBuffer');
}

/* ---- endian-aware readers over a byte view; every read bounds-checks ---- */
function rd16(b, i, le) {
  if (i + 2 > b.length) throw new Error('exif-parser: read past end (u16 @' + i + ')');
  return le ? (b[i] | (b[i + 1] << 8)) : ((b[i] << 8) | b[i + 1]);
}
function rd32(b, i, le) {
  if (i + 4 > b.length) throw new Error('exif-parser: read past end (u32 @' + i + ')');
  return le
    ? ((b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0)
    : (((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0);
}

/* ---- locate the TIFF block: whole JPEG (find APP1/Exif) or bare TIFF ---- */
function findTiff(b) {
  // Bare TIFF/EXIF block?
  if (b.length >= 2 && ((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d))) {
    return 0;
  }
  // JPEG? must start with SOI (FFD8).
  if (!(b.length >= 2 && b[0] === 0xff && b[1] === 0xd8)) {
    throw new Error('exif-parser: not a JPEG (no SOI) and not a bare TIFF block');
  }
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new Error('exif-parser: bad JPEG marker @' + i);
    const marker = b[i + 1];
    // Standalone markers with no length (RSTn, SOI, EOI) — shouldn't appear here.
    if (marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const segLen = rd16(b, i + 2, false); // JPEG segment lengths are big-endian
    if (segLen < 2) throw new Error('exif-parser: bad JPEG segment length @' + i);
    if (marker === 0xe1) { // APP1
      const start = i + 4;
      // "Exif\0\0"
      if (start + 6 <= b.length &&
          b[start] === 0x45 && b[start + 1] === 0x78 && b[start + 2] === 0x69 &&
          b[start + 3] === 0x66 && b[start + 4] === 0x00 && b[start + 5] === 0x00) {
        return start + 6; // TIFF header begins right after "Exif\0\0"
      }
    }
    if (marker === 0xda) break; // SOS — pixel data follows; stop scanning.
    i += 2 + segLen;
  }
  return -1; // no EXIF app1 present
}

/* ---- TIFF type sizes ---- */
var TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8 };

/* ---- decode one IFD entry's value(s) ---- */
function decodeValue(b, type, count, valOff, tiff, le) {
  var size = TYPE_SIZE[type];
  if (!size) return { raw: null, note: 'unknown-type-' + type };
  var total = size * count;
  // Values <= 4 bytes are inline in the 4-byte value field; else valOff is an offset from tiff.
  var at = total <= 4 ? valOff : (tiff + rd32(b, valOff, le));
  if (at + total > b.length) throw new Error('exif-parser: value runs past end (@' + at + ' len ' + total + ')');

  if (type === 2) { // ASCII
    var end = at;
    while (end < at + count && b[end] !== 0) end++;
    var s = '';
    for (var k = at; k < end; k++) s += String.fromCharCode(b[k]);
    return s;
  }
  if (type === 7 || type === 1 || type === 6) { // UNDEFINED / BYTE / SBYTE -> raw bytes
    return b.slice(at, at + total);
  }
  var out = [];
  for (var j = 0; j < count; j++) {
    var p = at + j * size;
    if (type === 3) out.push(rd16(b, p, le));                 // SHORT
    else if (type === 8) { var u = rd16(b, p, le); out.push(u > 0x7fff ? u - 0x10000 : u); } // SSHORT
    else if (type === 4) out.push(rd32(b, p, le));            // LONG
    else if (type === 9) { var v = rd32(b, p, le); out.push(v > 0x7fffffff ? v - 0x100000000 : v); } // SLONG
    else if (type === 5 || type === 10) {                     // RATIONAL / SRATIONAL
      var num = rd32(b, p, le), den = rd32(b, p + 4, le);
      if (type === 10) { if (num > 0x7fffffff) num -= 0x100000000; if (den > 0x7fffffff) den -= 0x100000000; }
      out.push({ num: num, den: den, value: den === 0 ? null : num / den });
    }
  }
  return count === 1 ? out[0] : out;
}

/* ---- common EXIF + GPS tag names (the mapped set; unknowns fall back to hex) ---- */
var TAGS = {
  0x010f: 'Make', 0x0110: 'Model', 0x0112: 'Orientation', 0x011a: 'XResolution',
  0x011b: 'YResolution', 0x0128: 'ResolutionUnit', 0x0131: 'Software',
  0x0132: 'DateTime', 0x013b: 'Artist', 0x8298: 'Copyright',
  0x8769: 'ExifIFDPointer', 0x8825: 'GPSInfoIFDPointer',
  0x829a: 'ExposureTime', 0x829d: 'FNumber', 0x8827: 'ISOSpeedRatings',
  0x9003: 'DateTimeOriginal', 0x9004: 'DateTimeDigitized', 0x920a: 'FocalLength',
  0xa002: 'PixelXDimension', 0xa003: 'PixelYDimension', 0x9209: 'Flash',
  0x9207: 'MeteringMode', 0xa405: 'FocalLengthIn35mmFilm', 0x927c: 'MakerNote',
  0xa430: 'CameraOwnerName', 0xa433: 'LensMake', 0xa434: 'LensModel'
};
var GPS_TAGS = {
  0x0000: 'GPSVersionID', 0x0001: 'GPSLatitudeRef', 0x0002: 'GPSLatitude',
  0x0003: 'GPSLongitudeRef', 0x0004: 'GPSLongitude', 0x0005: 'GPSAltitudeRef',
  0x0006: 'GPSAltitude', 0x0007: 'GPSTimeStamp', 0x001d: 'GPSDateStamp'
};

/* ---- walk one IFD, returning { entries:{name:value}, exifPtr, gpsPtr } ---- */
function walkIFD(b, ifd, tiff, le, names) {
  if (ifd + 2 > b.length) throw new Error('exif-parser: IFD offset past end (@' + ifd + ')');
  var n = rd16(b, ifd, le);
  var out = {}, exifPtr = 0, gpsPtr = 0;
  for (var e = 0; e < n; e++) {
    var ent = ifd + 2 + e * 12;
    if (ent + 12 > b.length) throw new Error('exif-parser: IFD entry past end (#' + e + ')');
    var tag = rd16(b, ent, le);
    var type = rd16(b, ent + 2, le);
    var count = rd32(b, ent + 4, le);
    var valFieldOff = ent + 8;
    if (tag === 0x8769) { exifPtr = tiff + rd32(b, valFieldOff, le); continue; }
    if (tag === 0x8825) { gpsPtr = tiff + rd32(b, valFieldOff, le); continue; }
    var name = names[tag] || ('0x' + tag.toString(16).padStart(4, '0'));
    out[name] = decodeValue(b, type, count, valFieldOff, tiff, le);
  }
  return { entries: out, exifPtr: exifPtr, gpsPtr: gpsPtr };
}

/* ---- the public entry point ---- */
function parseExif(input) {
  var b = toU8(input);
  var tiff = findTiff(b);
  if (tiff < 0) return {}; // no EXIF app1 — an honest empty, not an error

  // TIFF header: byte-order marker, 42 magic, IFD0 offset.
  var bo = rd16(b, tiff, false);
  var le;
  if (bo === 0x4949) le = true;       // "II"
  else if (bo === 0x4d4d) le = false; // "MM"
  else throw new Error('exif-parser: bad TIFF byte-order marker');
  var magic = rd16(b, tiff + 2, le);
  if (magic !== 42) throw new Error('exif-parser: bad TIFF magic (expected 42, got ' + magic + ')');
  var ifd0 = tiff + rd32(b, tiff + 4, le);

  var r0 = walkIFD(b, ifd0, tiff, le, TAGS);
  var result = r0.entries;

  if (r0.exifPtr) {
    var rExif = walkIFD(b, r0.exifPtr, tiff, le, TAGS);
    for (var k in rExif.entries) result[k] = rExif.entries[k];
    if (rExif.gpsPtr && !r0.gpsPtr) r0.gpsPtr = rExif.gpsPtr;
  }
  if (r0.gpsPtr) {
    var rGps = walkIFD(b, r0.gpsPtr, tiff, le, GPS_TAGS);
    result.gps = rGps.entries;
  }
  return result;
}

/* ---- render helpers (deterministic; used by the CLI) ---- */
function renderText(obj, prefix) {
  prefix = prefix || '';
  var lines = [];
  var keys = Object.keys(obj).sort();
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i], v = obj[key];
    if (key === 'gps' && v && typeof v === 'object' && !(v instanceof Uint8Array)) {
      lines.push(renderText(v, 'gps:'));
      continue;
    }
    lines.push(prefix + key + '\t' + renderScalar(v));
  }
  return lines.join('\n');
}
function renderScalar(v) {
  if (v instanceof Uint8Array) return '<' + v.length + ' bytes>';
  if (Array.isArray(v)) return v.map(renderScalar).join(', ');
  if (v && typeof v === 'object' && 'num' in v) return v.num + '/' + v.den;
  return String(v);
}

/* ---- dual home ---- */
if (typeof window !== 'undefined') {
  window.LoopGifts = window.LoopGifts || {};
  window.LoopGifts.parseExif = parseExif;
  window.LoopGifts['exif-parser'] = { parseExif: parseExif };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseExif: parseExif, renderText: renderText };
}

/* ---- CLI ---- */
if (typeof require !== 'undefined' && require.main === module) {
  var args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    process.stderr.write('usage: node exif-parser.js <photo.jpg>\n' +
      '       node exif-parser.js < photo.jpg\n' +
      'Prints "name\\tvalue" per EXIF tag (gps:* for GPS). Zero deps.\n');
    process.exit(args.length === 0 ? 2 : 0);
  }
  var fs = require('fs');
  try {
    var data = args[0] === '-' ? fs.readFileSync(0) : fs.readFileSync(args[0]);
    var tags = parseExif(new Uint8Array(data));
    var txt = renderText(tags);
    process.stdout.write(txt + (txt ? '\n' : ''));
  } catch (err) {
    // Clean, single-line failure — no raw Node stack — on bad I/O or malformed input.
    process.stderr.write('exif-parser: ' + err.message + '\n');
    process.exit(1);
  }
}
