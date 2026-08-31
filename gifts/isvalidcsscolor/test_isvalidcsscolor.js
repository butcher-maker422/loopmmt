#!/usr/bin/env node
/* test_isvalidcsscolor.js — proves the validator implements its stated CSS-color
   subset correctly.

   THE ORACLE. sha256 could check itself against Node's crypto — a live reference
   implementation. CSS-color validity has no Node stdlib oracle (CSS.supports is
   browser-only and needs the DOM). So the oracle here is the CSS Color spec
   expressed as CURATED VECTORS: a VALID set (every one must pass) and an INVALID
   set (every one must fail), chosen to exercise every branch of the grammar —
   named / hex(3,4,6,8) / rgb legacy+modern / hsl legacy+modern / angles /
   out-of-range-clamps / the documented exclusions. Plus determinism, non-string
   coercion, and a mutation-bite so a degenerate core (constant true/false) can't
   pass green. Exit 0 = all pass; exit 1 = a failure (loud). stdlib only. */
"use strict";
var isValidCSSColor = require("./isvalidcsscolor.js").isValidCSSColor;

var pass = 0, fail = 0;
function expect(input, want) {
  var got = isValidCSSColor(input);
  if (got === want) { pass++; }
  else {
    fail++;
    console.error("FAIL  isValidCSSColor(" + JSON.stringify(input) + ")\n" +
      "  got:  " + got + "\n  want: " + want);
  }
}

// ---- VALID: every one must return true --------------------------------------
var VALID = [
  // named + keywords (case-insensitive, trimmed)
  "red", "RebeccaPurple", "AliceBlue", "transparent", "currentColor", "  teal  ",
  // hex 3/4/6/8
  "#000", "#0f0", "#ABCDEF", "#00ff00", "#0f08", "#00ff0080",
  // rgb legacy — numbers, percents, out-of-range (clamps), optional alpha
  "rgb(255, 0, 0)", "rgb(0,0,0)", "rgb( 12 , 34 , 56 )", "rgb(100%, 0%, 50%)",
  "rgb(300, -10, 0)", "rgba(0,0,0,0.5)", "rgba(0,0,0,50%)", "rgb(0,0,0,0.5)",
  // rgb modern — space form, mixing, none, /alpha with and without spaces
  "rgb(255 0 0)", "rgb(255 0 0 / 0.5)", "rgb(255 0 0 / 50%)",
  "rgb(100% 0% 0% / none)", "rgb(none 0 0)", "rgb(255 0 0/.5)",
  // hsl legacy — number hue, angle hue, negative hue, optional alpha
  "hsl(120, 50%, 50%)", "hsla(120, 50%, 50%, 0.3)", "hsl(120deg, 50%, 50%)",
  "hsl(-30, 100%, 50%)",
  // hsl modern — angles, number S/L, none, /alpha
  "hsl(120 50% 50%)", "hsl(120deg 50% 50% / .5)", "hsl(0.5turn 50% 50%)",
  "hsl(200grad 50% 50%)", "hsl(3.14rad 50% 50%)", "hsl(120 50 50)",
  "hsl(none 50% 50%)", "hsl(120 50% 50% / none)"
];

// ---- INVALID: every one must return false -----------------------------------
var INVALID = [
  // empties & nonsense
  "", "   ", "notacolor", "reddish",
  // CSS-wide keywords are NOT colors
  "inherit", "initial", "unset", "revert",
  // malformed hex
  "#12", "#12345", "#1234567", "#gggggg", "#",
  // arity / structure
  "rgb()", "rgb(1,2)", "rgb(1,2,3,4,5)", "rgb(1 2)", "rgb(1 2 3 4)",
  // legacy channel-type mixing (number + percent) is illegal
  "rgb(1, 2, 50%)",
  // comma + slash mixed, none in legacy, empty/missing alpha
  "rgb(1,2,3 / .5)", "rgb(none, 0, 0)", "rgb(1,2,3,)", "rgb(1 2 3 /)",
  "rgb(1 2 3 / / .5)",
  // hsl: hue can't be a percent; legacy S/L must be percent
  "hsl(50%, 50%, 50%)", "hsl(120, 50, 50)",
  // spacing / number-shape faults
  "rgb (1,2,3)", "rgb(5., 0, 0)",
  // documented exclusions (out of this gift's scope, on purpose)
  "hwb(0 0% 0%)", "lab(50% 40 59)", "oklch(0.7 0.15 30)",
  "color(display-p3 1 0 0)", "rgb(from red r g b)", "Canvas"
];

for (var i = 0; i < VALID.length; i++) { expect(VALID[i], true); }
for (var j = 0; j < INVALID.length; j++) { expect(INVALID[j], false); }

// ---- Non-string coercion: a color is a string; nothing else is --------------
var NON_STRINGS = [42, 0, true, false, null, undefined, {}, ["red"], NaN];
for (var k = 0; k < NON_STRINGS.length; k++) { expect(NON_STRINGS[k], false); }

// ---- Determinism: same input, same verdict, twice ---------------------------
if (isValidCSSColor("rgb(1 2 3 / .5)") === isValidCSSColor("rgb(1 2 3 / .5)")) { pass++; }
else { fail++; console.error("FAIL determinism: same input gave two verdicts"); }

// ---- Mutation-bite: the core must actually discriminate ---------------------
// A degenerate `return true` fails every INVALID case above; a degenerate
// `return false` fails every VALID case. This explicit bite additionally catches
// a core that ignores its input entirely: a valid and an invalid string must not
// share a verdict.
if (isValidCSSColor("red") !== isValidCSSColor("zzz-not-a-color")) { pass++; }
else { fail++; console.error("FAIL mutation-bite: core did not distinguish valid from invalid"); }

console.log("\nisvalidcsscolor: " + pass + " passed, " + fail + " failed" +
  " (" + VALID.length + " valid + " + INVALID.length + " invalid vectors, " +
  "plus coercion, determinism, mutation-bite)");
process.exit(fail === 0 ? 0 : 1);
