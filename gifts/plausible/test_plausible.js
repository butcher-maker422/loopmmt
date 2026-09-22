#!/usr/bin/env node
/* test_plausible.js — drift-check battery for the plausible gauge.
   Each case is an out-of-band expectation (a label a human assigns by reading
   the string), not a value the gauge produced. Run: node test_plausible.js

   The load-bearing cases, called out:
     • MOJIBAKE POSITIVE   — the whole reason the gift exists; must not read prose.
     • CJK REGRESSION GUARD — real spaceless Japanese must NOT read garbled
       (the script-gate; the equity false-positive the design refuses to make).
     • BOUNDARY case        — run-together Latin flags via the space signal.
     • LEAN CHECK           — mojibake can reach `garbled` alone; boundary/hyphen
       are bounded to `suspect`. The label leans on the byte-structural signal.
*/
"use strict";
var P = require("./plausible.js");
var assess = P.assess, plausible = P.plausible;

var pass = 0, fail = 0, failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; failures.push(name + (detail ? "  [" + detail + "]" : "")); }
}
function labelOf(t, opts) { return assess(t, opts).label; }

// 1. clean English prose -> prose
check("clean-english-prose", labelOf("The quick brown fox jumps over the lazy dog and the rain falls softly.") === "prose");

// 2. clean prose, different content -> prose (not English-frequency-dependent)
check("clean-prose-varied", labelOf("She sold seventeen blue kites at the market before noon on a windy Tuesday.") === "prose");

// 3. MOJIBAKE POSITIVE (Latin-1): scattered mojibake in clean text -> not prose, mojibake signal present
var m1 = assess("MÃ¼ller went to the cafÃ© and ordered a piÃ±a colada.");
check("mojibake-latin1-not-prose", m1.label !== "prose", "label=" + m1.label);
check("mojibake-latin1-signal", m1.signals.mojibake >= 3, "mojibake=" + m1.signals.mojibake);

// 4. MOJIBAKE POSITIVE (dense, CJK-as-latin1) -> garbled
var m2 = assess("æ—¥æœ¬èªžã®ãƒ†ã‚­ã‚¹ãƒˆ");
check("mojibake-dense-garbled", m2.label === "garbled", "label=" + m2.label + " ratio=" + m2.signals.mojibakeRatio);

// 5. MOJIBAKE POSITIVE (CP1252 remap: em-dash/curly-quote family) -> mojibake signal present
var m3 = assess("theâ€œsmartâ€\u009d quotes and emâ€”dashes are Ã¡ll wrong here now");
check("mojibake-cp1252-signal", m3.signals.mojibake >= 2, "mojibake=" + m3.signals.mojibake);

// 6. CJK REGRESSION GUARD: real, correctly-decoded spaceless Japanese -> NOT garbled
var jp = assess("日本語のテキストです。これは正しくデコードされた文章。");
check("cjk-regression-not-garbled", jp.label !== "garbled", "label=" + jp.label);
check("cjk-regression-space-gated", jp.signals.spaceScored === false, "spaceScored=" + jp.signals.spaceScored);
check("cjk-regression-no-mojibake", jp.signals.mojibake === 0, "mojibake=" + jp.signals.mojibake);

// 7. Chinese (spaceless) regression guard -> NOT garbled
var zh = assess("这是一段正确解码的中文文本用来测试脚本门控是否正常工作。");
check("chinese-regression-not-garbled", zh.label !== "garbled", "label=" + zh.label);

// 8. BOUNDARY case: run-together Latin (no spaces) -> flagged (suspect+), boundaryPenalty fires
var rt = assess("thequickbrownfoxjumpsoverthelazydogandtherainfallssoftlyonthefields");
check("runtogether-flagged", rt.label !== "prose", "label=" + rt.label);
check("runtogether-boundary", rt.signals.boundaryPenalty > 0, "bp=" + rt.signals.boundaryPenalty);

// 9. LEAN CHECK: boundary alone is bounded to suspect, never garbled (higher false-positive surface)
check("boundary-bounded-to-suspect", rt.label === "suspect", "label=" + rt.label);

// 10. HYPHENATION: several lines ending in hyphens -> hyphen signal fires, exposed
var hy = assess("this is a para-\ngraph that has been hy-\nphenated at every line-\nbreak by a pdf ex-\ntractor here now");
check("hyphenation-signal", hy.signals.hyphenLines >= 3, "hyphenLines=" + hy.signals.hyphenLines);
check("hyphenation-rate-scored", hy.signals.hyphenRate > 0, "hyphenRate=" + hy.signals.hyphenRate);

// 11. empty / whitespace -> empty
check("empty-string", labelOf("") === "empty");
check("whitespace-only", labelOf("   \t  \n ") === "empty");
check("null-input", labelOf(null) === "empty");

// 12. EXPOSED-not-scored: letter-freq deviation is exposed but NEVER moves the label.
//     A non-English clean string (skewed letter freq) must still read prose.
var eu = assess("Kääntäjä pyysi ystävällisesti lisää aikaa ennen kuin jatkoi työtä.");
check("nonenglish-still-prose", eu.label === "prose", "label=" + eu.label);
check("letterfreq-exposed", typeof eu.signals.letterFreqDevEn === "number" || eu.signals.letterFreqDevEn === null);

// 13. determinism: same input -> byte-identical output (the canonicalizer self-test)
var d1 = JSON.stringify(assess("The quick brown fox jumps over the lazy dog again."));
var d2 = JSON.stringify(assess("The quick brown fox jumps over the lazy dog again."));
check("determinism-byte-identical", d1 === d2);

// 14. dispatch joint: array -> map; record.text -> annotate .plausibility
var arr = plausible(["clean sentence here friend", "MÃ¼ller cafÃ©"]);
check("dispatch-array", Array.isArray(arr) && arr.length === 2 && arr[0].label === "prose");
var rec = plausible({ id: 7, text: "æ—¥æœ¬èªžã®ãƒ†ã‚­ã‚¹ãƒˆ" });
check("dispatch-record", rec.id === 7 && rec.plausibility && rec.plausibility.label === "garbled");

// 15. options: caller can move the bounds (like legible's readableMax/binaryMin)
check("options-bounds", assess("MÃ¼ller cafÃ© piÃ±a colada", { garbledMin: 0.05 }).label === "garbled");

// --- report ---------------------------------------------------------------
var total = pass + fail;
process.stdout.write("plausible: " + pass + "/" + total + " passed\n");
if (fail > 0) {
  process.stdout.write("FAILURES:\n  - " + failures.join("\n  - ") + "\n");
  process.exitCode = 1;
}
