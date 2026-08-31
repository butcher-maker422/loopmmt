#!/usr/bin/env node
/* ratchet-png-text.js — a pure, dependency-free, STRICT extractor of the textual
   metadata chunks (tEXt, zTXt, iTXt) from a PNG byte stream. Runs identically in
   a browser and in Node (no DOM, no dependencies).

   WHY THIS EXISTS. A PNG can carry human-readable metadata — Title, Author,
   Description, Software, Copyright, an XMP packet — in tEXt/zTXt/iTXt chunks. You
   have the file's bytes (an upload, a fetch, a buffer) and you want those key/value
   pairs without pulling in a full image decoder. The usual answer is a heavy
   library that parses pixels you don't care about, or a hand-rolled loop that
   trusts the file and hands you text out of a chunk whose CRC doesn't even match.

   WHAT "RATCHET" MEANS HERE. This is a ratchet parser: it advances one chunk at a
   time and REFUSES to move past anything malformed. It validates the 8-byte PNG
   signature, and for EVERY chunk it recomputes the CRC-32 over (type + data) and
   rejects a mismatch. A length that runs past the end of the buffer, a stream that
   ends before IEND, a text chunk missing its null separator — each is a thrown
   Error, never a silently-truncated string. A parser that hands you text from a
   corrupt chunk is lying about what the file says; this one won't.

   WHAT IT EXTRACTS (the whole contract — a parser that hides its scope lies):
     • tEXt — uncompressed Latin-1 keyword + text. Decoded directly.
     • iTXt (uncompressed) — UTF-8 keyword, language tag, translated keyword, and
       text. Decoded directly.
     • zTXt and COMPRESSED iTXt — the keyword and metadata are decoded, and the
       raw zlib-compressed text bytes are surfaced on the entry as
       `compressedText`. The text itself is decoded ONLY if you pass an
       `inflate` function in the options (see below). This is deliberate: zlib
       inflate is not in the browser's synchronous, dependency-free surface, so
       the core stays DOM-free and zero-dependency and lets the CALLER decide the
       inflater (Node: `require("zlib").inflateSync`; browser: pako, etc.).

   WHAT IT DOES NOT DO (stated on purpose — see the README's "edge"):
     It does not decode pixels, IHDR geometry, palettes, gamma, or any non-text
     chunk — it walks the chunk stream to find text and validates the CRC of every
     chunk it steps over, but returns only the text entries. It does not inflate
     compressed text on its own (pass `inflate`). It does not repair a bad file.

   API
     parsePngText(bytes[, options]) -> Array<Entry>
       `bytes`   a Uint8Array (a Node Buffer is a Uint8Array) or an ArrayBuffer.
       `options.inflate`  optional (compressedBytes: Uint8Array) => Uint8Array,
                          used to decode zTXt / compressed-iTXt text.
       Returns the text entries in file order (possibly empty). THROWS an Error on
       any malformed input (bad signature, bad CRC, truncation, bad chunk shape).

     Entry shape (all entries carry `kind` and `keyword`):
       tEXt : { kind:"tEXt", keyword, text, compressed:false }
       zTXt : { kind:"zTXt", keyword, compressed:true, text:<string|null>,
                compressedText:Uint8Array }
       iTXt : { kind:"iTXt", keyword, compressed:<bool>, languageTag,
                translatedKeyword, text:<string|null>,
                compressedText?:Uint8Array }   // compressedText only when compressed

   Pure function of its input. Same code in a browser
   (window.LoopGifts.parsePngText) or Node (this CLI / require()).

   USAGE
     node ratchet-png-text.js cover.png          # prints "keyword\ttext" per entry
     node ratchet-png-text.js --help
   The CLI (Node only) supplies Node's zlib as the inflater so compressed text is
   decoded; the shipped core stays dependency-free.

   Released under MIT.
*/
"use strict";

// ---- CRC-32 (PNG / IEEE 802.3, polynomial 0xEDB88320) ----------------------
// Table built once. Pure; no dependencies. This is the parser's teeth: every
// chunk's stored CRC is recomputed over (type-bytes + data-bytes) and compared.
var CRC_TABLE = (function () {
  var t = new Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes, start, end) {
  var c = 0xffffffff;
  for (var i = start; i < end; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ---- byte helpers -----------------------------------------------------------
var PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function u32be(b, i) {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}

// Latin-1 (ISO-8859-1): byte value === Unicode code point. Zero-dependency and
// correct for tEXt keyword/text and iTXt language tags.
function latin1(bytes, start, end) {
  var s = "";
  for (var i = start; i < end; i++) { s += String.fromCharCode(bytes[i]); }
  return s;
}

// UTF-8 via the platform TextDecoder — present in both Node (>=11, global) and
// browsers. Used for iTXt (UTF-8 by spec).
var UTF8 = (typeof TextDecoder !== "undefined") ? new TextDecoder("utf-8") : null;
function utf8(bytes, start, end) {
  var slice = bytes.subarray ? bytes.subarray(start, end) : bytes.slice(start, end);
  if (UTF8) { return UTF8.decode(slice); }
  // Fallback (no TextDecoder): decode UTF-8 by hand. Kept minimal.
  var s = "", i = 0;
  while (i < slice.length) {
    var b0 = slice[i++];
    if (b0 < 0x80) { s += String.fromCharCode(b0); }
    else if (b0 < 0xe0) { s += String.fromCharCode(((b0 & 0x1f) << 6) | (slice[i++] & 0x3f)); }
    else if (b0 < 0xf0) { s += String.fromCharCode(((b0 & 0x0f) << 12) | ((slice[i++] & 0x3f) << 6) | (slice[i++] & 0x3f)); }
    else {
      var cp = ((b0 & 0x07) << 18) | ((slice[i++] & 0x3f) << 12) | ((slice[i++] & 0x3f) << 6) | (slice[i++] & 0x3f);
      cp -= 0x10000;
      s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return s;
}

// Find the index of the first null byte in [start, end); -1 if none.
function indexOfNull(bytes, start, end) {
  for (var i = start; i < end; i++) { if (bytes[i] === 0) { return i; } }
  return -1;
}

function toU8(input) {
  if (input instanceof Uint8Array) { return input; }
  if (typeof ArrayBuffer !== "undefined" && input instanceof ArrayBuffer) { return new Uint8Array(input); }
  if (input && input.buffer instanceof ArrayBuffer && typeof input.byteLength === "number") {
    // other typed-array / DataView view over a buffer
    return new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength);
  }
  throw new TypeError("parsePngText: expected a Uint8Array / Buffer / ArrayBuffer");
}

// ---- text-chunk decoders ----------------------------------------------------
function decodeTEXt(data) {
  var nul = indexOfNull(data, 0, data.length);
  if (nul === -1) { throw new Error("tEXt chunk: missing null separator"); }
  if (nul < 1 || nul > 79) { throw new Error("tEXt chunk: keyword must be 1-79 bytes"); }
  return {
    kind: "tEXt",
    keyword: latin1(data, 0, nul),
    text: latin1(data, nul + 1, data.length),
    compressed: false
  };
}

function decodeZTXt(data, inflate) {
  var nul = indexOfNull(data, 0, data.length);
  if (nul === -1) { throw new Error("zTXt chunk: missing null separator"); }
  if (nul < 1 || nul > 79) { throw new Error("zTXt chunk: keyword must be 1-79 bytes"); }
  if (nul + 1 >= data.length) { throw new Error("zTXt chunk: missing compression method"); }
  var method = data[nul + 1];
  if (method !== 0) { throw new Error("zTXt chunk: unknown compression method " + method); }
  var comp = data.subarray ? data.subarray(nul + 2) : data.slice(nul + 2);
  var entry = {
    kind: "zTXt",
    keyword: latin1(data, 0, nul),
    compressed: true,
    text: null,
    compressedText: comp
  };
  if (inflate) { entry.text = latin1(inflate(comp), 0, inflate(comp).length); }
  return entry;
}

function decodeITXt(data, inflate) {
  var n = data.length;
  var k = indexOfNull(data, 0, n);
  if (k === -1) { throw new Error("iTXt chunk: missing keyword null separator"); }
  if (k < 1 || k > 79) { throw new Error("iTXt chunk: keyword must be 1-79 bytes"); }
  if (k + 2 >= n) { throw new Error("iTXt chunk: truncated header"); }
  var compFlag = data[k + 1];
  var compMethod = data[k + 2];
  if (compFlag !== 0 && compFlag !== 1) { throw new Error("iTXt chunk: bad compression flag " + compFlag); }
  if (compFlag === 1 && compMethod !== 0) { throw new Error("iTXt chunk: unknown compression method " + compMethod); }
  var langStart = k + 3;
  var langNul = indexOfNull(data, langStart, n);
  if (langNul === -1) { throw new Error("iTXt chunk: missing language-tag null separator"); }
  var transStart = langNul + 1;
  var transNul = indexOfNull(data, transStart, n);
  if (transNul === -1) { throw new Error("iTXt chunk: missing translated-keyword null separator"); }
  var textStart = transNul + 1;

  var entry = {
    kind: "iTXt",
    keyword: utf8(data, 0, k),
    compressed: compFlag === 1,
    languageTag: latin1(data, langStart, langNul),
    translatedKeyword: utf8(data, transStart, transNul),
    text: null
  };
  var body = data.subarray ? data.subarray(textStart) : data.slice(textStart);
  if (compFlag === 0) {
    entry.text = utf8(body, 0, body.length);
  } else {
    entry.compressedText = body;
    if (inflate) { var raw = inflate(body); entry.text = utf8(raw, 0, raw.length); }
  }
  return entry;
}

/**
 * parsePngText(input[, options]) -> Array<Entry>
 * Strictly walk a PNG byte stream and return its tEXt/zTXt/iTXt entries in file
 * order. Validates the signature and every chunk's CRC-32; throws on any
 * malformed input. See the file header for the Entry shapes and the `inflate`
 * option (used to decode zTXt / compressed iTXt text).
 */
function parsePngText(input, options) {
  var bytes = toU8(input);
  var inflate = options && options.inflate;
  var len = bytes.length;

  if (len < 8) { throw new Error("not a PNG: shorter than the 8-byte signature"); }
  for (var s = 0; s < 8; s++) {
    if (bytes[s] !== PNG_SIG[s]) { throw new Error("not a PNG: bad signature"); }
  }

  var entries = [];
  var off = 8;
  var sawIEND = false;

  while (off < len) {
    if (off + 8 > len) { throw new Error("truncated PNG: incomplete chunk header at offset " + off); }
    var dataLen = u32be(bytes, off);
    var typeStart = off + 4;
    var dataStart = off + 8;
    var dataEnd = dataStart + dataLen;
    var crcEnd = dataEnd + 4;
    if (crcEnd > len) { throw new Error("truncated PNG: chunk data/CRC runs past end at offset " + off); }

    var type = latin1(bytes, typeStart, typeStart + 4);
    var storedCrc = u32be(bytes, dataEnd);
    var actualCrc = crc32(bytes, typeStart, dataEnd);
    if (storedCrc !== actualCrc) {
      throw new Error("CRC mismatch in " + type + " chunk at offset " + off +
        ": stored 0x" + storedCrc.toString(16) + " != computed 0x" + actualCrc.toString(16));
    }

    var data = bytes.subarray ? bytes.subarray(dataStart, dataEnd) : bytes.slice(dataStart, dataEnd);
    if (type === "tEXt") { entries.push(decodeTEXt(data)); }
    else if (type === "zTXt") { entries.push(decodeZTXt(data, inflate)); }
    else if (type === "iTXt") { entries.push(decodeITXt(data, inflate)); }
    else if (type === "IEND") { sawIEND = true; off = crcEnd; break; }

    off = crcEnd;
  }

  if (!sawIEND) { throw new Error("truncated PNG: stream ended before the IEND chunk"); }
  return entries;
}

// ---- Dual-runtime export: browser namespace + Node module ------------------
if (typeof window !== "undefined") {
  window.LoopGifts = window.LoopGifts || {};
  window.LoopGifts.parsePngText = parsePngText;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { parsePngText: parsePngText };
}

// ---- CLI: print "keyword\ttext" per text entry; Node supplies the inflater ---
if (typeof require !== "undefined" && require.main === module) {
  var args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    process.stdout.write(
      "ratchet-png-text — extract tEXt/zTXt/iTXt metadata from a PNG (strict)\n\n" +
      "  node ratchet-png-text.js cover.png     one line per text entry: keyword<TAB>text\n\n" +
      "Validates the PNG signature and every chunk's CRC-32; refuses malformed input.\n" +
      "Decodes tEXt and uncompressed iTXt directly; zTXt and compressed iTXt are\n" +
      "inflated here with Node's zlib (the shipped core is dependency-free).\n");
    process.exit(args.length === 0 ? 1 : 0);
  }
  var fs = require("fs");
  var zlib = require("zlib");
  var inflate = function (b) { return zlib.inflateSync(Buffer.from(b)); };
  var exitCode = 0;
  for (var a = 0; a < args.length; a++) {
    try {
      var buf = fs.readFileSync(args[a]);
      var list = parsePngText(buf, { inflate: inflate });
      if (args.length > 1) { process.stdout.write("== " + args[a] + " ==\n"); }
      for (var e = 0; e < list.length; e++) {
        var en = list[e];
        var t = (en.text === null) ? "[" + en.kind + ", compressed, no inflater]" : en.text;
        process.stdout.write(en.keyword + "\t" + t + "\n");
      }
      if (list.length === 0) { process.stdout.write("(no text chunks)\n"); }
    } catch (err) {
      process.stderr.write("ratchet-png-text: " + args[a] + ": " + err.message + "\n");
      exitCode = 1;
    }
  }
  process.exit(exitCode);
}
