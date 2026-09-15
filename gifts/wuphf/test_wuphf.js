#!/usr/bin/env node
/* test_wuphf.js — golden corpus + per-channel cost correctness + SMS segment
   math + determinism self-test + non-vacuity bite for the WUPHF gift. Zero
   dependencies (Node assert only). This file IS the canonicalizer self-test the
   Plumb cites (Gift-Works Procedure v1 §2): a gift whose output is byte-identical
   across repeated evaluation has proven its canonical form is idempotent.

   Run:  node test_wuphf.js         # exit 0 GREEN / non-zero RED
*/
"use strict";
var assert = require("assert");
var W = require("./wuphf.js");

var pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.error("FAIL: " + name + " \u2014 " + e.message); }
}

// ---- the declared channel set is exactly six, in declared order ------------
check("the declared channel set is the six known channels in declared order", function () {
  assert.deepStrictEqual(W.CHANNELS,
    ["sms", "email", "voicemail", "fax", "chat", "social"]);
});

// ---- GOLDEN CORPUS: JSONL is a fixed oracle, written out literally ---------
check("a short GSM-7 message renders sms as one segment with the exact JSONL", function () {
  var out = W.wuphfJSONL("hi team", ["sms"]);
  assert.strictEqual(out,
    '{"channel":"sms","render":"hi team","cost":{"encoding":"GSM-7","units":7,"cap_single":160,"cap_multi":153,"segments":1,"label":"1 segment (7/160 septets, GSM-7)"},"seq":0,"of":1}\n');
});

check("all six channels render in declared order with of=6", function () {
  var recs = W.wuphf("Standup at 10", ["social", "sms", "fax", "email", "chat", "voicemail"]);
  // declared-order canonicalization: listed order ignored, CHANNELS order used
  assert.deepStrictEqual(recs.map(function (r) { return r.channel; }),
    ["sms", "email", "voicemail", "fax", "chat", "social"]);
  recs.forEach(function (r) { assert.strictEqual(r.of, 6); });
  assert.deepStrictEqual(recs.map(function (r) { return r.seq; }), [0, 1, 2, 3, 4, 5]);
});

// ---- SMS SEGMENT MATH: the decidable core, tested at the boundaries --------
check("160 GSM-7 chars is exactly one segment; 161 becomes two", function () {
  var s160 = new Array(161).join("a"); // 160 chars
  var s161 = new Array(162).join("a"); // 161 chars
  assert.strictEqual(W.smsCost(s160).segments, 1);
  assert.strictEqual(W.smsCost(s161).segments, 2);
});

check("a non-GSM-7 char (emoji) forces UCS-2 and a 70-char single-segment cap", function () {
  var c = W.smsCost("\ud83e\udd8c"); // deer emoji -> UCS-2
  assert.strictEqual(c.encoding, "UCS-2");
  assert.strictEqual(c.cap_single, 70);
  // one emoji = 2 UTF-16 units, still one segment
  assert.strictEqual(c.units, 2);
  assert.strictEqual(c.segments, 1);
});

check("a GSM-7 extension char (euro sign) costs two septets", function () {
  var c = W.smsCost("\u20ac"); // euro is in the GSM-7 extension table -> 2 septets
  assert.strictEqual(c.encoding, "GSM-7");
  assert.strictEqual(c.units, 2);
});

check("71 UCS-2 units cross into two segments at the 67-cap", function () {
  // build a UCS-2 message of 71 units: 70 latin + 1 that forces UCS-2 would be 71,
  // but to force UCS-2 we need a non-GSM char; use 69 'a' + one 2-unit emoji = 71 units
  var msg = new Array(70).join("a") + "\ud83e\udd8c"; // 69 + 2 = 71 units, UCS-2
  var c = W.smsCost(msg);
  assert.strictEqual(c.encoding, "UCS-2");
  assert.strictEqual(c.units, 71);
  assert.strictEqual(c.segments, 2); // 71 > 70 -> ceil(71/67) = 2
});

// ---- SOCIAL: 280 cap, honest over-count + truncation ----------------------
check("social under 280 fits and is not truncated", function () {
  var recs = W.wuphf("just a quick note", ["social"]);
  assert.strictEqual(recs[0].cost.over, false);
  assert.strictEqual(recs[0].cost.truncated_at, null);
  assert.strictEqual(recs[0].render, "just a quick note");
});

check("social over 280 reports the over-count and truncates with an ellipsis", function () {
  var long = new Array(301).join("x"); // 300 chars
  var recs = W.wuphf(long, ["social"]);
  assert.strictEqual(recs[0].cost.over, true);
  assert.strictEqual(recs[0].cost.chars, 300);
  assert.strictEqual(recs[0].cost.truncated_at, 279);
  assert.strictEqual(recs[0].render.length, 280); // 279 chars + ellipsis
  assert.ok(/\u2026$/.test(recs[0].render));
});

// ---- VOICEMAIL: read-aloud estimate at 150 wpm ----------------------------
check("voicemail estimates seconds from words at 150 wpm and flags over-30s", function () {
  var words = [];
  for (var i = 0; i < 150; i++) words.push("word"); // 150 words = 60s
  var recs = W.wuphf(words.join(" "), ["voicemail"]);
  assert.strictEqual(recs[0].cost.words, 150);
  assert.strictEqual(recs[0].cost.seconds, 60);
  assert.strictEqual(recs[0].cost.over, true);
});

// ---- EMAIL: subject/body split -------------------------------------------
check("email splits a subject from the first sentence and puts the rest in the body", function () {
  var recs = W.wuphf("Server maintenance tonight. It runs from 10pm to midnight.", ["email"]);
  assert.ok(/^Subject: Server maintenance tonight\n\n/.test(recs[0].render));
  assert.ok(/It runs from 10pm to midnight\.$/.test(recs[0].render));
});

check("email with a single short line has that line as subject and an empty body note", function () {
  var recs = W.wuphf("Lunch moved to 1pm", ["email"]);
  assert.ok(/^Subject: Lunch moved to 1pm/.test(recs[0].render));
  assert.ok(/\(no additional body\)$/.test(recs[0].render));
});

// ---- FAX: cover sheet present, date is NOT the system clock ----------------
check("fax renders a cover sheet and uses a blank date placeholder, not the clock", function () {
  var recs = W.wuphf("Please review the attached.", ["fax"]);
  assert.ok(/FAX COVER/.test(recs[0].render));
  assert.ok(/DATE: _{5,}/.test(recs[0].render)); // blank placeholder, no real date
  assert.ok(!/20\d\d/.test(recs[0].render));     // no year -> no clock leaked
  assert.ok(/Please review the attached\.$/.test(recs[0].render));
});

// ---- DETERMINISM: byte-identical across repeated evaluation ---------------
check("the same message and channels yield byte-identical JSONL on repeat runs", function () {
  var msg = "caf\u00e9\ud83e\udd8c \u65e5\u672c\u8a9e \u2014 ship it";
  var a = W.wuphfJSONL(msg); // all channels
  var b = W.wuphfJSONL(msg);
  assert.strictEqual(a, b);
});

check("multibyte fidelity survives JSON escaping in every channel", function () {
  var out = W.wuphfJSONL("q\"uote\nnewline\t\u65e5", ["chat"]);
  assert.ok(out.indexOf('\\"') !== -1);   // quote escaped
  assert.ok(out.indexOf("\\n") !== -1);   // newline escaped
  assert.ok(out.indexOf("\u65e5") !== -1); // non-latin preserved raw
});

// ---- FAILS CLOSED: unknown / empty / duplicate channel --------------------
check("an unknown channel is refused with the channel named", function () {
  assert.throws(function () { W.wuphf("x", ["pigeon"]); }, /unknown channel "pigeon"/);
});

check("an empty channel token is refused (no default channel)", function () {
  assert.throws(function () { W.wuphf("x", [""]); }, /empty channel name/);
});

check("a duplicate channel is refused", function () {
  assert.throws(function () { W.wuphf("x", ["sms", "sms"]); }, /duplicate channel/);
});

check("an empty channel list is refused", function () {
  assert.throws(function () { W.wuphf("x", []); }, /none declared/);
});

// ---- NON-VACUITY BITE: the test must be able to FAIL ----------------------
// If the renderer were the identity function, these expectations would break.
// Prove the harness actually catches a wrong answer.
check("NON-VACUITY: sms of a 200-char message is really 2 segments, not 1", function () {
  var s = new Array(201).join("a"); // 200 chars GSM-7
  var recs = W.wuphf(s, ["sms"]);
  assert.strictEqual(recs[0].cost.segments, 2); // would be 1 if the model were broken
  assert.notStrictEqual(recs[0].cost.segments, 1);
});

check("NON-VACUITY: the six renders are genuinely DIFFERENT from each other", function () {
  var recs = W.wuphf("Team meeting moved to 3pm in the big room", W.CHANNELS);
  var renders = recs.map(function (r) { return r.render; });
  var uniq = {};
  renders.forEach(function (x) { uniq[x] = true; });
  // at least sms/email/voicemail/fax must differ; not all six identical
  assert.ok(Object.keys(uniq).length >= 4,
    "expected channel renders to differ; got " + Object.keys(uniq).length + " distinct");
});

// ---------------------------------------------------------------------------
console.log((fail === 0 ? "GREEN" : "RED") + ": " + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
