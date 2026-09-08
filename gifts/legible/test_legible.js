#!/usr/bin/env node
/* test_legible.js — known-answer battery for legible.

   The oracle is OUT OF BAND: every expected label/score below is a fact computed
   BY HAND from the definition (C0-control + U+FFFD density), never the output of
   a second scorer. The two load-bearing fixtures are drawn from real behaviour,
   not invented:
     • the KNOWN-BAD: a 2-byte CID glyph-index run decoded as Latin-1 — the exact
       shape ratchet-pdf-text surfaces for a subsetted CID font.
     • the REGRESSION GUARD: Japanese ("日本語") UTF-8 bytes read as Latin-1 — the
       CJK false-positive that a naive C1-inclusive score would mislabel; this
       test fails if anyone re-adds the C1 band (0x80–0x9F) to the score.

   Run: node test_legible.js   (exit 0 = all pass, nonzero = failure)
*/
"use strict";
var assert = require("assert");
var cp = require("child_process");
var path = require("path");
var { legible, assess } = require("./legible.js");

var pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + " — " + e.message); }
}
function cc() { return String.fromCharCode.apply(null, arguments); }

// --- readable ---------------------------------------------------------------
ok("plain ASCII is readable, score 0", function () {
  var r = assess("Hello, world! This is plain readable text.");
  assert.strictEqual(r.label, "readable");
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.signals.control, 0);
});

ok("accented Latin-1 (single-byte é) stays readable", function () {
  // 0xE9 (é) is printable Latin-1, not a control char.
  var r = assess("caf" + cc(0xe9) + " au lait");
  assert.strictEqual(r.label, "readable");
  assert.strictEqual(r.signals.control, 0);
});

// --- empty (no signal) ------------------------------------------------------
ok("empty string is empty, not readable", function () {
  assert.strictEqual(assess("").label, "empty");
});
ok("whitespace-only is empty", function () {
  assert.strictEqual(assess("  \n\t  ").label, "empty");
});
ok("null text is empty (via record)", function () {
  var r = legible({ index: 0, text: null });
  assert.strictEqual(r.legibility.label, "empty");
});
ok("undefined text is empty", function () {
  assert.strictEqual(assess(undefined).label, "empty");
});

// --- likely-binary: the KNOWN-BAD (CID glyph indices as Latin-1) -------------
ok("KNOWN-BAD: 2-byte CID index run is likely-binary, score 1.0", function () {
  // Low subset glyph indices 0x0001..0x0005 as bytes: every char is 0x00–0x1F.
  var cid = cc(0, 1, 0, 2, 0, 3, 0, 4, 0, 5);
  var r = assess(cid);
  assert.strictEqual(r.label, "likely-binary");
  assert.strictEqual(r.score, 1);
  assert.strictEqual(r.signals.nul, 5);   // five 0x00 high bytes
  assert.strictEqual(r.signals.control, 10);
});

// --- the REGRESSION GUARD: CJK-as-Latin1 must NOT be likely-binary -----------
ok("REGRESSION: Japanese UTF-8 bytes as Latin-1 read as readable (C1 not scored)", function () {
  // "日本語" UTF-8 = E6 97 A5 E6 9C AC E8 AA 9E. Bytes 0x97/0x9C/0x9E are C1
  // controls AND UTF-8 continuation bytes. If C1 were scored, this is 3/9=0.33
  // => likely-binary (the CJK false-positive). C0-only scoring => 0 => readable.
  var mojibake = cc(0xe6, 0x97, 0xa5, 0xe6, 0x9c, 0xac, 0xe8, 0xaa, 0x9e);
  var r = assess(mojibake);
  assert.strictEqual(r.label, "readable", "CJK-as-Latin1 must not be flagged binary");
  assert.strictEqual(r.score, 0);
  assert.ok(r.signals.c1 >= 3, "c1 IS reported (just not scored)"); // 0x97,0x9C,0x9E
});

// --- suspect: the mixed stream (half readable, half rubble) ------------------
ok("mixed readable + a little rubble is suspect", function () {
  // 15 readable chars + 2 control chars => 2/17 = 0.1176 -> suspect.
  var mixed = "Hello World Foo" + cc(1, 2);
  var r = assess(mixed);
  assert.strictEqual(r.label, "suspect");
  assert.ok(r.score > 0.05 && r.score < 0.30, "score " + r.score + " in suspect band");
});

ok("replacement chars (U+FFFD) count toward the score", function () {
  var r = assess("abc" + cc(0xfffd) + cc(0xfffd) + "d"); // 6 chars, 2 replacement = 0.3333
  assert.strictEqual(r.signals.replacement, 2);
  assert.strictEqual(r.label, "likely-binary"); // 0.3333 >= 0.30
});

// --- band boundaries (the thresholds are exact) -----------------------------
ok("score exactly at readableMax (0.05) is readable (<=)", function () {
  // 1 control in 20 chars = 0.05.
  var r = assess("abcdefghijklmnopqrs" + cc(1));
  assert.strictEqual(r.score, 0.05);
  assert.strictEqual(r.label, "readable");
});
ok("score exactly at binaryMin (0.30) is likely-binary (>=)", function () {
  // 3 control in 10 chars = 0.30.
  var r = assess("abcdefg" + cc(1, 2, 3));
  assert.strictEqual(r.score, 0.3);
  assert.strictEqual(r.label, "likely-binary");
});

// --- options override -------------------------------------------------------
ok("options can widen the readable band", function () {
  var s = "aa" + cc(1); // 1/3 = 0.3333
  assert.strictEqual(assess(s).label, "likely-binary");
  assert.strictEqual(assess(s, { readableMax: 0.5 }).label, "readable");
});

// --- the composition joint --------------------------------------------------
ok("record passthrough preserves fields and adds .legibility", function () {
  var rec = { index: 2, filter: "FlateDecode", text: "readable content" };
  var out = legible(rec);
  assert.strictEqual(out.index, 2);
  assert.strictEqual(out.filter, "FlateDecode");
  assert.strictEqual(out.text, "readable content");
  assert.strictEqual(out.legibility.label, "readable");
});
ok("array input maps element-wise", function () {
  var out = legible(["hello", cc(0, 1, 2, 3)]);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].label, "readable");
  assert.strictEqual(out[1].label, "likely-binary");
});
ok("a ratchet .streams-shaped record annotates cleanly", function () {
  // Mirrors the real join: ratchet-pdf-text emits entries like this.
  var stream = { index: 0, filter: "FlateDecode", compressed: true, needsInflate: false, text: cc(0,1,0,2,0,3), rawLength: 6 };
  var out = legible(stream);
  assert.strictEqual(out.legibility.label, "likely-binary");
  assert.strictEqual(out.rawLength, 6); // original fields intact
});

// --- determinism (the canonicalizer self-test) ------------------------------
ok("determinism: same input yields byte-identical JSON across runs", function () {
  var inputs = ["Hello", cc(0,1,2), "日本語 as latin1: " + cc(0xe6,0x97,0xa5), "", "  "];
  for (var i = 0; i < inputs.length; i++) {
    var a = JSON.stringify(assess(inputs[i]));
    var b = JSON.stringify(assess(inputs[i]));
    assert.strictEqual(a, b, "run 2 differs for input " + i);
  }
});

// --- the CLI contract -------------------------------------------------------
ok("CLI --port prints the port-verb (transform)", function () {
  var out = cp.execSync("node " + path.join(__dirname, "legible.js") + " --port").toString().trim();
  assert.strictEqual(out, "transform");
});
ok("CLI argument form prints the assessment JSON", function () {
  var out = cp.execSync("node " + path.join(__dirname, "legible.js") + " 'plain text'").toString().trim();
  var r = JSON.parse(out);
  assert.strictEqual(r.label, "readable");
});
ok("CLI stdin JSONL form annotates each record", function () {
  var jsonl = JSON.stringify({ index: 0, text: "readable" }) + "\n" +
              JSON.stringify({ index: 1, text: cc(0,1,2,3) }) + "\n";
  var out = cp.execSync("node " + path.join(__dirname, "legible.js"), { input: jsonl }).toString().trim().split("\n");
  var a = JSON.parse(out[0]), b = JSON.parse(out[1]);
  assert.strictEqual(a.legibility.label, "readable");
  assert.strictEqual(b.legibility.label, "likely-binary");
  assert.strictEqual(b.index, 1);
});

// --- report -----------------------------------------------------------------
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
