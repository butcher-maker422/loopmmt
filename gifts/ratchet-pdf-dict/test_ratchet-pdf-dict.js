#!/usr/bin/env node
/* test_ratchet-pdf-dict.js — known-answer battery for ratchet-pdf-dict.

   The oracle is OUT OF BAND: every expected value below is a literal fact written
   by hand, never the output of a second PDF parser. Each PDF fixture is assembled
   from raw bytes so the expected records are known by construction. No zlib, no
   dependencies — dictionary text is not compressed, so no inflater is needed.

   Run: node test_ratchet-pdf-dict.js   (exit 0 = all pass, nonzero = failure)
*/
"use strict";
var assert = require("assert");
var { parsePdfDict } = require("./ratchet-pdf-dict.js");

var pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + " — " + e.message); }
}
function bytes(str) { return Buffer.from(str, "latin1"); }

// Wrap a set of object bodies into a minimal, header-correct PDF. Structure is
// spartan on purpose — the extractor is xref-free and scans for `N M obj`.
function pdf(objs) { return bytes("%PDF-1.7\n" + objs.join("\n") + "\n%%EOF\n"); }

// ---- 1. a text field: /V value paired with its /T name -------------------
ok("1 text field /V + /T name", function () {
  var doc = pdf(["12 0 obj\n<< /FT /Tx /T (fullname) /V (John Smith) >>\nendobj"]);
  var r = parsePdfDict(doc);
  assert.strictEqual(r.records.length, 1);                 // ORACLE: exactly one
  assert.strictEqual(r.records[0].kind, "field");
  assert.strictEqual(r.records[0].key, "V");
  assert.strictEqual(r.records[0].name, "fullname");
  assert.strictEqual(r.records[0].text, "John Smith");
  assert.strictEqual(r.records[0].encoding, "literal");
  assert.strictEqual(r.malformed.length, 0);
});

// ---- 2. an annotation: /Contents string ----------------------------------
ok("2 annotation /Contents string", function () {
  var doc = pdf(["5 0 obj\n<< /Type /Annot /Subtype /Text /Contents (A sticky note) >>\nendobj"]);
  var r = parsePdfDict(doc);
  assert.strictEqual(r.records.length, 1);
  assert.strictEqual(r.records[0].kind, "annotation");
  assert.strictEqual(r.records[0].key, "Contents");
  assert.strictEqual(r.records[0].name, null);
  assert.strictEqual(r.records[0].text, "A sticky note");
});

// ---- 3. the /Contents disambiguation: a PAGE content ref is NOT text ------
ok("3 page /Contents ref is skipped (not annotation text)", function () {
  var doc = pdf([
    "3 0 obj\n<< /Type /Page /Contents 4 0 R /MediaBox [0 0 612 792] >>\nendobj",
    "4 0 obj\n<< /Length 20 >>\nstream\nBT (drawn) Tj ET\nendstream\nendobj"
  ]);
  var r = parsePdfDict(doc);
  // Neither object yields a dictionary-text record: obj 3's /Contents is a ref
  // (page content pointer), obj 4 has no /V or string /Contents.
  assert.strictEqual(r.records.length, 0);                 // ORACLE: the trap
  assert.strictEqual(r.malformed.length, 0);
});

// ---- 4. an indirect /V reference is resolved one level -------------------
ok("4 indirect /V ref resolved to a string object", function () {
  var doc = pdf([
    "12 0 obj\n<< /FT /Tx /T (comment) /V 9 0 R >>\nendobj",
    "9 0 obj\n(deferred value)\nendobj"
  ]);
  var r = parsePdfDict(doc);
  assert.strictEqual(r.records.length, 1);
  assert.strictEqual(r.records[0].text, "deferred value");
  assert.strictEqual(r.records[0].encoding, "ref");        // provenance is honest
  assert.strictEqual(r.records[0].name, "comment");
});

// ---- 5. a hex-string value decodes ---------------------------------------
ok("5 hex-string /V value", function () {
  var doc = pdf(["7 0 obj\n<< /T (code) /V <48656C6C6F> >>\nendobj"]); // "Hello"
  var r = parsePdfDict(doc);
  assert.strictEqual(r.records.length, 1);
  assert.strictEqual(r.records[0].text, "Hello");
  assert.strictEqual(r.records[0].encoding, "hex");
});

// ---- 6. literal escapes: balanced parens and \( \) ------------------------
ok("6 literal escapes decode", function () {
  var doc = pdf(["8 0 obj\n<< /T (note) /V (a \\(b\\) c) >>\nendobj"]);
  var r = parsePdfDict(doc);
  assert.strictEqual(r.records[0].text, "a (b) c");        // ORACLE by hand
});

// ---- 7. a malformed value is RECORDED, and the walk CONTINUES -------------
ok("7 malformed /V is recorded, walk continues (two-level contract)", function () {
  var doc = pdf([
    "1 0 obj\n<< /T (bad) /V (unterminated string >>\nendobj",   // no closing )
    "2 0 obj\n<< /T (good) /V (survivor) >>\nendobj"
  ]);
  var r = parsePdfDict(doc);
  // The good field after the bad one is still extracted — the walk did NOT abort.
  var texts = r.records.map(function (x) { return x.text; });
  assert.ok(texts.indexOf("survivor") !== -1, "good field survived the malformed one");
  assert.strictEqual(r.malformed.length, 1);               // the bad one is stamped
  assert.strictEqual(r.malformed[0].obj, "1 0");
  assert.ok(/unterminated/.test(r.malformed[0].reason));
});

// ---- 8. NOT a PDF throws (document-level, ratchet parity) -----------------
ok("8 missing %PDF- header throws", function () {
  assert.throws(function () { parsePdfDict(bytes("<< /V (x) >>")); }, /not a PDF/);
});

// ---- 9. bad input type throws --------------------------------------------
ok("9 non-buffer input throws", function () {
  assert.throws(function () { parsePdfDict("a string, not bytes"); }, /Uint8Array or ArrayBuffer/);
});

// ---- 10. an empty/field-less PDF yields no records, no throw --------------
ok("10 no dictionary text -> empty records, no throw", function () {
  var doc = pdf(["1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj"]);
  var r = parsePdfDict(doc);
  assert.strictEqual(r.records.length, 0);
  assert.strictEqual(r.text, "");
});

// ---- 11. /TU labels are OFF by default, ON with {labels:true} -------------
ok("11 /TU label gated behind options.labels", function () {
  var doc = pdf(["4 0 obj\n<< /T (dob) /TU (Date of birth) /V (1978) >>\nendobj"]);
  var off = parsePdfDict(doc);
  assert.strictEqual(off.records.length, 1);               // only /V, not /TU
  assert.strictEqual(off.records[0].text, "1978");
  var on = parsePdfDict(doc, { labels: true });
  var labels = on.records.filter(function (x) { return x.kind === "label"; });
  assert.strictEqual(labels.length, 1);
  assert.strictEqual(labels[0].text, "Date of birth");
  assert.strictEqual(labels[0].name, "dob");
});

// ---- 12. one object with BOTH /V and /Contents yields two records ---------
ok("12 widget with /V and /Contents -> field + annotation records", function () {
  var doc = pdf(["6 0 obj\n<< /Subtype /Widget /T (sig) /V (signed) /Contents (tooltip) >>\nendobj"]);
  var r = parsePdfDict(doc);
  var kinds = r.records.map(function (x) { return x.kind; }).sort();
  assert.deepStrictEqual(kinds, ["annotation", "field"]);  // both surfaces pulled
  assert.strictEqual(r.records.length, 2);
});

// ---- 13. .text joins record texts in order --------------------------------
ok("13 .text joins records with newline, in object order", function () {
  var doc = pdf([
    "1 0 obj\n<< /T (a) /V (one) >>\nendobj",
    "2 0 obj\n<< /Subtype /Text /Contents (two) >>\nendobj"
  ]);
  var r = parsePdfDict(doc);
  assert.strictEqual(r.text, "one\ntwo");                  // ORACLE by construction
});

// ---- 14. /VE (a longer key) is NOT mistaken for /V ------------------------
ok("14 key match is a full token, /VE does not match /V", function () {
  var doc = pdf(["1 0 obj\n<< /VE [ (a) ] /V (real) >>\nendobj"]);
  var r = parsePdfDict(doc);
  // Only the real /V string is pulled; /VE (an array) is not a /V match.
  assert.strictEqual(r.records.length, 1);
  assert.strictEqual(r.records[0].text, "real");
});

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
