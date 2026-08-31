#!/usr/bin/env node
/* test_ratchet-png-text.js — proves the strict PNG text extractor implements its
   stated contract correctly.

   THE ORACLE. There is no PNG-text parser in the Node stdlib to diff against, so
   the oracle is the PNG spec expressed as CURATED, REAL PNG BYTE FIXTURES built
   in-test: each fixture is an actual PNG byte stream (8-byte signature + chunks
   with correct CRC-32 + IEND), so a "valid" vector is a genuine file the parser
   must read to a KNOWN set of entries, and an "invalid" vector is a genuine
   malformation the parser must THROW on. Every branch is exercised: tEXt,
   uncompressed iTXt (UTF-8, language tag, translated keyword), zTXt and compressed
   iTXt, the no-text case, and the malformations (bad signature, CRC mismatch,
   truncation, missing IEND, missing separators, bad length, non-buffer input).

   THE LIVE-REFERENCE BACKSTOP. The compressed path (zTXt / compressed iTXt) is
   built with Node's own zlib.deflateSync and decoded through the parser with
   zlib.inflateSync passed as the `inflate` option — so the zero-dependency core is
   cross-checked against a live reference implementation, sha256-style.

   Plus determinism (same bytes -> same entries, twice) and a mutation-bite (a
   text-carrying PNG and a no-text PNG must not share a result, so a degenerate
   core that returns a constant can't pass green). Exit 0 = all pass; exit 1 =
   a failure (loud). stdlib only. */
"use strict";
var assert = require("assert");
var zlib = require("zlib");
var parsePngText = require("./ratchet-png-text.js").parsePngText;

var pass = 0, fail = 0;
function ok(label, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.error("FAIL  " + label + "\n  " + (e && e.message ? e.message : e)); }
}

// ---- PNG fixture builder (a tiny, correct reference encoder) ----------------
var SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

var CRC_TABLE = (function () {
  var t = new Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) { c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); }
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  var c = 0xffffffff;
  for (var i = 0; i < buf.length; i++) { c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); }
  return (c ^ 0xffffffff) >>> 0;
}
function u32(n) { var b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; }

// One PNG chunk: length + type + data + CRC(type+data).
function chunk(type, data) {
  data = data || Buffer.alloc(0);
  var typeBuf = Buffer.from(type, "latin1");
  var body = Buffer.concat([typeBuf, data]);
  return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
}
// A minimal, real IHDR (1x1, 8-bit grayscale) — for fixture realism.
var IHDR = chunk("IHDR", Buffer.concat([u32(1), u32(1), Buffer.from([8, 0, 0, 0, 0])]));
var IEND = chunk("IEND");

function png(chunks) { return Buffer.concat([SIG].concat(chunks).concat([IEND])); }

// tEXt data = keyword + \0 + text (Latin-1)
function tEXt(keyword, text) {
  return chunk("tEXt", Buffer.concat([Buffer.from(keyword, "latin1"), Buffer.from([0]), Buffer.from(text, "latin1")]));
}
// zTXt data = keyword + \0 + method(0) + zlib(text)
function zTXt(keyword, text) {
  return chunk("zTXt", Buffer.concat([Buffer.from(keyword, "latin1"), Buffer.from([0, 0]), zlib.deflateSync(Buffer.from(text, "latin1"))]));
}
// iTXt data = keyword + \0 + cflag + cmethod + lang + \0 + transKeyword + \0 + text(UTF-8, maybe deflated)
function iTXt(keyword, lang, trans, text, compressed) {
  var body = compressed ? zlib.deflateSync(Buffer.from(text, "utf8")) : Buffer.from(text, "utf8");
  return chunk("iTXt", Buffer.concat([
    Buffer.from(keyword, "utf8"), Buffer.from([0]),
    Buffer.from([compressed ? 1 : 0, 0]),
    Buffer.from(lang, "latin1"), Buffer.from([0]),
    Buffer.from(trans, "utf8"), Buffer.from([0]),
    body
  ]));
}

var INFLATE = { inflate: function (b) { return zlib.inflateSync(Buffer.from(b)); } };

// ===========================================================================
// VALID vectors — each must parse to a KNOWN result.
// ===========================================================================
ok("single tEXt decodes keyword+text", function () {
  var out = parsePngText(png([IHDR, tEXt("Title", "A Quiet Loop")]));
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0], { kind: "tEXt", keyword: "Title", text: "A Quiet Loop", compressed: false });
});

ok("multiple tEXt chunks preserved in file order", function () {
  var out = parsePngText(png([IHDR, tEXt("Author", "Shea"), tEXt("Software", "Loop MMT")]));
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].keyword, "Author");
  assert.strictEqual(out[0].text, "Shea");
  assert.strictEqual(out[1].keyword, "Software");
  assert.strictEqual(out[1].text, "Loop MMT");
});

ok("tEXt with empty text is valid (keyword, empty value)", function () {
  var out = parsePngText(png([IHDR, tEXt("Comment", "")]));
  assert.strictEqual(out[0].text, "");
});

ok("no text chunks -> empty array (not an error)", function () {
  var out = parsePngText(png([IHDR]));
  assert.deepStrictEqual(out, []);
});

ok("uncompressed iTXt decodes UTF-8 text, lang, translated keyword", function () {
  var out = parsePngText(png([IHDR, iTXt("Description", "en", "Descripción", "a café at dawn — \u2728", false)]));
  assert.strictEqual(out.length, 1);
  var e = out[0];
  assert.strictEqual(e.kind, "iTXt");
  assert.strictEqual(e.keyword, "Description");
  assert.strictEqual(e.compressed, false);
  assert.strictEqual(e.languageTag, "en");
  assert.strictEqual(e.translatedKeyword, "Descripción");
  assert.strictEqual(e.text, "a café at dawn — \u2728");
});

ok("zTXt: without inflater -> compressed entry, raw bytes, text null", function () {
  var out = parsePngText(png([IHDR, zTXt("XML:com.adobe.xmp", "the quick brown fox")]));
  var e = out[0];
  assert.strictEqual(e.kind, "zTXt");
  assert.strictEqual(e.keyword, "XML:com.adobe.xmp");
  assert.strictEqual(e.compressed, true);
  assert.strictEqual(e.text, null);
  assert.ok(e.compressedText && e.compressedText.length > 0, "compressedText surfaced");
});

ok("zTXt: WITH live zlib inflater -> text decoded (live-reference backstop)", function () {
  var out = parsePngText(png([IHDR, zTXt("Copyright", "© 2026 Shea Gunther")]), INFLATE);
  assert.strictEqual(out[0].text, "© 2026 Shea Gunther");
});

ok("compressed iTXt: WITH inflater -> UTF-8 text decoded", function () {
  var out = parsePngText(png([IHDR, iTXt("Story", "en", "", "compressed unicode: ✓ café", true)]), INFLATE);
  var e = out[0];
  assert.strictEqual(e.compressed, true);
  assert.strictEqual(e.text, "compressed unicode: ✓ café");
});

ok("mixed chunk types collected in order", function () {
  var out = parsePngText(png([IHDR, tEXt("A", "1"), iTXt("B", "en", "", "2", false), zTXt("C", "3")]), INFLATE);
  assert.deepStrictEqual(out.map(function (e) { return e.keyword; }), ["A", "B", "C"]);
  assert.strictEqual(out[2].text, "3");
});

ok("accepts an ArrayBuffer as well as a Buffer", function () {
  var buf = png([IHDR, tEXt("Title", "AB")]);
  var ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  assert.strictEqual(parsePngText(ab)[0].text, "AB");
});

// ===========================================================================
// INVALID vectors — each must THROW (the ratchet refuses to advance).
// ===========================================================================
function throws(label, buildBadBytes) {
  ok(label, function () { assert.throws(function () { parsePngText(buildBadBytes()); }); });
}

throws("bad PNG signature", function () {
  var b = png([IHDR, tEXt("Title", "x")]); b[0] = 0x00; return b;
});
throws("CRC mismatch (a data byte flipped after CRC was written)", function () {
  var b = png([IHDR, tEXt("Title", "hello")]);
  // flip the last byte of the tEXt text; its stored CRC no longer matches
  b[b.length - 5] ^= 0xff; return b;
});
throws("truncated mid-chunk", function () {
  var b = png([IHDR, tEXt("Title", "hello")]); return b.subarray(0, b.length - 10);
});
throws("stream ends before IEND", function () {
  // signature + IHDR + a tEXt, but no IEND appended
  return Buffer.concat([SIG, IHDR, tEXt("Title", "x")]);
});
throws("tEXt missing its null separator", function () {
  var bad = chunk("tEXt", Buffer.from("NoNullHere", "latin1")); // no \0 in the data
  return Buffer.concat([SIG, IHDR, bad, IEND]);
});
throws("chunk length runs past end of buffer", function () {
  var b = png([IHDR, tEXt("Title", "x")]);
  // corrupt the tEXt length field to claim a huge data size
  var off = SIG.length + IHDR.length;
  b.writeUInt32BE(0x7fffffff, off); return b;
});
throws("zTXt with unknown compression method", function () {
  var data = Buffer.concat([Buffer.from("K", "latin1"), Buffer.from([0, 9]), zlib.deflateSync(Buffer.from("x"))]);
  return Buffer.concat([SIG, IHDR, chunk("zTXt", data), IEND]);
});
throws("shorter than the 8-byte signature", function () { return Buffer.from([0x89, 0x50, 0x4e]); });

// non-buffer inputs throw a TypeError
ok("non-buffer inputs are rejected", function () {
  ["a string", 42, null, undefined, {}].forEach(function (bad) {
    assert.throws(function () { parsePngText(bad); });
  });
});

// ===========================================================================
// Determinism + mutation-bite
// ===========================================================================
ok("determinism: same bytes -> identical entries, twice", function () {
  var b = png([IHDR, tEXt("Title", "same"), zTXt("Z", "twice")]);
  assert.deepStrictEqual(parsePngText(b, INFLATE), parsePngText(b, INFLATE));
});

ok("mutation-bite: a text PNG and a no-text PNG do not share a result", function () {
  var withText = parsePngText(png([IHDR, tEXt("Title", "real")]));
  var without = parsePngText(png([IHDR]));
  // a constant-returning core would make these equal; they must not be.
  assert.notDeepStrictEqual(withText, without);
  assert.strictEqual(withText[0].text, "real"); // and the value is the input's, not a constant
});

console.log("\nratchet-png-text: " + pass + " passed, " + fail + " failed" +
  " (real-PNG-byte vectors: tEXt/iTXt/zTXt/compressed-iTXt/no-text, malformed-rejection set, " +
  "live-zlib backstop, coercion, determinism, mutation-bite)");
process.exit(fail === 0 ? 0 : 1);
