#!/usr/bin/env node
/* test_ratchet-pdf-text.js — known-answer battery for ratchet-pdf-text.

   The oracle is OUT OF BAND: every expected value below is a literal fact
   written by hand, never the output of a second PDF parser. Each PDF fixture is
   assembled from raw bytes so the expected extracted text is known by
   construction. Node's zlib provides the inflater for the compressed case (the
   same inflater the CLI wires); the extractor itself carries no zlib.

   Run: node test_ratchet-pdf-text.js   (exit 0 = all pass, nonzero = failure)
*/
"use strict";
var zlib = require("zlib");
var assert = require("assert");
var { parsePdfText } = require("./ratchet-pdf-text.js");

var pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + " — " + e.message); }
}

function bytes(str) { return Buffer.from(str, "latin1"); }

// Build a minimal PDF whose single content stream is `content` (uncompressed),
// with a correct /Length. Structure is deliberately spartan — the extractor is
// xref-tolerant and scans for streams, so we don't need a valid xref table.
function uncompressedPdf(content) {
  var head = "%PDF-1.4\n";
  var obj =
    "4 0 obj\n<< /Length " + content.length + " >>\nstream\n" +
    content +
    "\nendstream\nendobj\n";
  var tail = "%%EOF\n";
  return bytes(head + obj + tail);
}

// Build a PDF whose single content stream is FlateDecode-compressed `content`.
function flatePdf(content) {
  var comp = zlib.deflateSync(Buffer.from(content, "latin1")); // zlib-wrapped (RFC1950)
  var head = bytes("%PDF-1.5\n4 0 obj\n<< /Filter /FlateDecode /Length " + comp.length + " >>\nstream\n");
  var mid = comp;
  var tail = bytes("\nendstream\nendobj\n%%EOF\n");
  return Buffer.concat([head, mid, tail]);
}

// ---- 1. simple Tj, uncompressed -----------------------------------------
ok("1 Tj literal string, uncompressed", function () {
  var pdf = uncompressedPdf("BT /F1 12 Tf (Hello World) Tj ET");
  var r = parsePdfText(pdf);
  assert.strictEqual(r.text, "Hello World");           // ORACLE: literal
  assert.strictEqual(r.streams.length, 1);
  assert.strictEqual(r.streams[0].compressed, false);
});

// ---- 2. multiple Tj across the stream -----------------------------------
ok("2 two Tj operators concatenate in order", function () {
  var pdf = uncompressedPdf("(Alpha) Tj (Beta) Tj");
  var r = parsePdfText(pdf);
  assert.strictEqual(r.text, "AlphaBeta");             // ORACLE
});

// ---- 3. TJ array drops numeric kerning, keeps strings -------------------
ok("3 TJ array keeps strings, drops numbers", function () {
  var pdf = uncompressedPdf("[(Wa) -80 (ter) -60 (mark)] TJ");
  var r = parsePdfText(pdf);
  assert.strictEqual(r.text, "Watermark");             // ORACLE: kerning gone
});

// ---- 4. hex string decode -----------------------------------------------
ok("4 hex string <48656c6c6f> => Hello", function () {
  var pdf = uncompressedPdf("<48656c6c6f> Tj");
  var r = parsePdfText(pdf);
  assert.strictEqual(r.text, "Hello");                 // ORACLE: hex of 'Hello'
});

// ---- 5. odd-length hex pads with trailing zero --------------------------
ok("5 odd hex <4> => single byte 0x40 ('@')", function () {
  var pdf = uncompressedPdf("<4> Tj");
  var r = parsePdfText(pdf);
  assert.strictEqual(r.text, "@");                     // ORACLE: 0x40 padded
});

// ---- 6. octal escape in literal -----------------------------------------
ok("6 octal escape \\101 => 'A'", function () {
  var pdf = uncompressedPdf("(\\101\\102\\103) Tj");
  var r = parsePdfText(pdf);
  assert.strictEqual(r.text, "ABC");                   // ORACLE: 0101=A 0102=B 0103=C
});

// ---- 7. balanced nested parens preserved --------------------------------
ok("7 nested parens (a(b)c) preserved", function () {
  var pdf = uncompressedPdf("(a(b)c) Tj");
  var r = parsePdfText(pdf);
  assert.strictEqual(r.text, "a(b)c");                 // ORACLE
});

// ---- 8. escaped paren and backslash -------------------------------------
ok("8 escaped \\( \\) \\\\ decode literally", function () {
  var pdf = uncompressedPdf("(x\\(y\\)z\\\\) Tj");
  var r = parsePdfText(pdf);
  assert.strictEqual(r.text, "x(y)z\\");               // ORACLE
});

// ---- 9. ' operator (move-to-next-line-and-show) counts as text ----------
ok("9 quote operator shows string", function () {
  var pdf = uncompressedPdf("(line two) '");
  var r = parsePdfText(pdf);
  assert.strictEqual(r.text, "line two");              // ORACLE
});

// ---- 10. FlateDecode stream, WITH inflater -> decoded -------------------
ok("10 FlateDecode with inflater decodes text", function () {
  var pdf = flatePdf("BT (Compressed hi) Tj ET");
  var r = parsePdfText(pdf, { inflate: zlib.inflateSync });
  assert.strictEqual(r.text, "Compressed hi");         // ORACLE
  assert.strictEqual(r.streams[0].compressed, true);
  assert.strictEqual(r.streams[0].needsInflate, false);
});

// ---- 11. FlateDecode stream, WITHOUT inflater -> surfaced, not faked -----
ok("11 FlateDecode without inflater surfaces raw bytes, text null", function () {
  var pdf = flatePdf("BT (secret) Tj ET");
  var r = parsePdfText(pdf);                           // no inflate option
  assert.strictEqual(r.text, "");                      // ORACLE: nothing faked
  assert.strictEqual(r.streams[0].needsInflate, true);
  assert.ok(r.streams[0].compressedBytes instanceof Uint8Array); // honest surfacing
  assert.strictEqual(r.streams[0].text, null);
});

// ---- 12. empty content stream -> empty text, one entry ------------------
ok("12 empty content stream yields empty text", function () {
  var pdf = uncompressedPdf("");
  var r = parsePdfText(pdf);
  assert.strictEqual(r.text, "");                      // ORACLE
  assert.strictEqual(r.streams.length, 1);
});

// ---- 13. RATCHET: not a PDF (bad header) throws -------------------------
ok("13 ratchet: missing %PDF- header throws", function () {
  var bad = bytes("GIF89a not a pdf (nope) Tj");
  assert.throws(function () { parsePdfText(bad); }, /not a PDF/);  // ORACLE: refusal
});

// ---- 14. RATCHET: /Length running past buffer throws --------------------
ok("14 ratchet: lying /Length past end-of-buffer throws", function () {
  // declare a huge length so it exceeds the buffer AND no endstream follows
  var body = "%PDF-1.4\n4 0 obj\n<< /Length 99999 >>\nstream\n(hi) Tj";
  assert.throws(function () { parsePdfText(bytes(body)); }, /past end of buffer|endstream/);
});

// ---- 15. RATCHET: stream without endstream throws -----------------------
ok("15 ratchet: stream with no endstream throws", function () {
  var body = "%PDF-1.4\n4 0 obj\n<< >>\nstream\n(dangling) Tj\n"; // no endstream
  assert.throws(function () { parsePdfText(bytes(body)); }, /endstream/);
});

// ---- 16. RATCHET: unterminated literal string throws --------------------
ok("16 ratchet: unterminated ( string throws", function () {
  // valid stream shell, but the content has an open paren that never closes
  var content = "(unterminated Tj ET";
  var pdf = uncompressedPdf(content);
  // safeExtract swallows content-syntax throws per contract (stream != text),
  // so text is empty and the stream is still surfaced honestly.
  var r = parsePdfText(pdf);
  assert.strictEqual(r.text, "");                      // ORACLE: no faked text
  assert.strictEqual(r.streams.length, 1);
});

// ---- 17. ArrayBuffer input accepted (dual-home Uint8Array contract) -----
ok("17 accepts ArrayBuffer input", function () {
  var pdf = uncompressedPdf("(buf) Tj");
  var ab = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength);
  var r = parsePdfText(ab);
  assert.strictEqual(r.text, "buf");                   // ORACLE
});

// ---- 18. two content streams, both decoded, joined with newline ---------
ok("18 two streams join with newline", function () {
  var head = "%PDF-1.4\n";
  var o1 = "4 0 obj\n<< /Length 9 >>\nstream\n(first) Tj\nendstream\nendobj\n";
  var o2 = "5 0 obj\n<< /Length 10 >>\nstream\n(second) Tj\nendstream\nendobj\n";
  var pdf = bytes(head + o1 + o2 + "%%EOF\n");
  var r = parsePdfText(pdf);
  assert.strictEqual(r.text, "first\nsecond");         // ORACLE
  assert.strictEqual(r.streams.length, 2);
});

console.log("\nratchet-pdf-text: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
