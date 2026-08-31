#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/* test_forest-title-fit.js — proves the title-fit primitive implements its contract.

   THE ORACLE. There is no stdlib that says "is this the largest font that fits?" —
   so the oracle is CURATED VECTORS against a DETERMINISTIC injected measurer
   (width = chars * fontSize * k), which makes the expected size exactly computable:
   the largest integer size s with len*s*k <= width is floor(width/(len*k)). We
   assert: (1) fitFontSize returns exactly that size and reports fits=true; (2) it
   picks the LARGEST fitting size (size+1 would overflow); (3) when nothing fits even
   at the floor it returns the floor with fits=false and floored=true — it NEVER
   returns below min (never clips by shrinking past the floor); (4) wrapToWidth never
   emits a line wider than width, breaks on spaces, and keeps a too-long single word
   intact on its own line (never clips); (5) fitTitle wraps at the floor instead of
   ellipsizing. Plus determinism and a mutation-bite (a constant-size core fails).
   Exit 0 = all pass; exit 1 = failure. stdlib only. */
"use strict";
var m = require("./forest-title-fit.js");

var pass = 0, fail = 0;
function ok(label, cond) { if (cond) { pass++; } else { fail++; console.error("FAIL  " + label); } }
function eq(label, a, b) { ok(label + " (=" + JSON.stringify(b) + ")", a === b); }
function threw(label, fn) { var d = false; try { fn(); } catch (e) { d = true; } ok(label + " (throws)", d); }

// deterministic measurer: width = chars * fontSize * k
var K = 0.6;
function measure(text, fontSize) { return String(text).length * fontSize * K; }
function largestFit(len, width) { return Math.floor(width / (len * K)); }

// ---- 1. fitFontSize returns exactly the largest fitting size ---------------
var r1 = m.fitFontSize("ABCD", 300, { measure: measure, min: 8, max: 96 });
var expect1 = largestFit(4, 300); // floor(300/2.4) = 125 -> capped at max 96
expect1 = Math.min(expect1, 96);
eq("largest fitting size (capped at max)", r1.fontSize, expect1);
ok("reports fits", r1.fits === true);

// a case where the true optimum is below the cap
var r2 = m.fitFontSize("ABCDEFGHIJ", 300, { measure: measure, min: 8, max: 96 });
var expect2 = largestFit(10, 300); // floor(300/6) = 50
eq("largest fitting size (uncapped)", r2.fontSize, expect2);
// and prove it's the LARGEST: size+1 overflows
ok("size+1 overflows (it's truly largest)", measure("ABCDEFGHIJ", r2.fontSize + 1) > 300);
ok("chosen size fits", measure("ABCDEFGHIJ", r2.fontSize) <= 300);

// ---- 2. never clips: floor when nothing fits -------------------------------
var r3 = m.fitFontSize("aVeryLongUnbreakableTitleString", 30, { measure: measure, min: 8, max: 96 });
ok("floored size == min", r3.fontSize === 8);
ok("reports !fits when even floor overflows", r3.fits === false);
ok("reports floored", r3.floored === true);
ok("NEVER returns below min", r3.fontSize >= 8);

// ---- 3. input guards -------------------------------------------------------
threw("requires measure seam", function () { m.fitFontSize("x", 100, {}); });
threw("rejects non-positive width", function () { m.fitFontSize("x", 0, { measure: measure }); });
threw("rejects min > max", function () { m.fitFontSize("x", 100, { measure: measure, min: 50, max: 10 }); });

// ---- 4. wrapToWidth: never a line wider than width, never clips -------------
var lines = m.wrapToWidth("one two three four five six", 60, 10, measure); // each word small
for (var i = 0; i < lines.length; i++)
  ok("wrap line " + i + " within width", measure(lines[i], 10) <= 60 || lines[i].split(/\s+/).length === 1);
ok("wrap breaks into multiple lines", lines.length > 1);
ok("wrap preserves all words", lines.join(" ").split(/\s+/).sort().join(",") ===
   "five,four,one,six,three,two");

// a single oversized word goes on its own line, intact (never clipped)
var wl = m.wrapToWidth("tiny enormouslylongwordthatcannotfit tiny", 40, 10, measure);
ok("oversized word kept intact", wl.indexOf("enormouslylongwordthatcannotfit") !== -1);

// ---- 5. fitTitle: wraps at floor instead of ellipsizing --------------------
var t1 = m.fitTitle("Short", 300, { measure: measure, min: 8, max: 72 });
ok("short title fits on one line", t1.fits === true && t1.lines.length === 1);
var t2 = m.fitTitle("several words that will not fit on one single line here", 60,
                    { measure: measure, min: 8, max: 72 });
ok("overflowing title wraps, does not ellipsize", t2.lines.length > 1);
ok("no ellipsis introduced", t2.lines.join(" ").indexOf("\u2026") === -1 &&
   t2.lines.join(" ").indexOf("...") === -1);

// ---- 6. determinism --------------------------------------------------------
ok("fitFontSize is deterministic",
   m.fitFontSize("ABCDE", 200, { measure: measure }).fontSize ===
   m.fitFontSize("ABCDE", 200, { measure: measure }).fontSize);

// ---- 7. mutation-bite ------------------------------------------------------
// A degenerate core that returned a constant size regardless of text/width would
// give the same size for a short title in a wide box and a long title in a narrow
// box. Prove they DIFFER.
var wide = m.fitFontSize("Hi", 400, { measure: measure, min: 8, max: 96 }).fontSize;
var narrow = m.fitFontSize("A much longer title", 80, { measure: measure, min: 8, max: 96 }).fontSize;
ok("MUTATION-BITE: size responds to text length and width", wide !== narrow && wide > narrow);

// ---- report ----------------------------------------------------------------
console.log((fail === 0 ? "PASS" : "FAIL") + "  " + pass + "/" + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
