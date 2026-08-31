#!/usr/bin/env node
/* isvalidcsscolor.js — a pure, dependency-free "is this string a valid CSS color?"
   checker that returns a boolean and runs identically in a browser and in Node.

   WHY THIS EXISTS. You take a color from a human — a theme field, a config file,
   a query param — and before you write it into a stylesheet or a canvas you want
   to know: is this actually a color? The browser's honest oracle,
   CSS.supports('color', str), only exists in a browser and needs the DOM. On a
   Node server, in a build step, or in a test, there is no built-in answer. This
   is a small, pure function of its input — no DOM, no dependencies — that decides
   the question against a DEFINED, DOCUMENTED SUBSET of the CSS Color spec: the
   colors people actually type.

   WHAT IT ACCEPTS (the whole contract — a validator that hides its scope lies):
     • named colors — the 148 CSS Color Module Level 4 names, plus `transparent`
       and the `currentColor` keyword (case-insensitive).
     • hex — #RGB, #RGBA, #RRGGBB, #RRGGBBAA (3/4/6/8 hex digits).
     • rgb() / rgba() — both the legacy comma form `rgb(255, 0, 0)` /
       `rgba(255,0,0,.5)` (all-number OR all-percent, no mixing; optional alpha)
       AND the modern space form `rgb(255 0 0 / 50%)` (number|percent|none per
       channel, mixing allowed, optional `/ alpha`).
     • hsl() / hsla() — legacy `hsl(120, 50%, 50%)` (hue then two percentages,
       optional alpha) AND modern `hsl(120deg 50% 50% / .5)`. Hue may be a bare
       number (degrees) or an <angle> (deg/grad/rad/turn).
   Out-of-range numeric channels are ACCEPTED, because CSS accepts and clamps them
   (`rgb(300 -10 0)` is a valid color that renders as red) — validity is about
   grammar, not range.

   WHAT IT DOES NOT ACCEPT (stated on purpose — see the README's "edge"):
     hwb(), lab(), lch(), oklab(), oklch(), color(), color-mix(), the relative-
     color syntax (`rgb(from …)`), and system colors (Canvas, ButtonText, …). The
     CSS-wide keywords `inherit`, `initial`, `unset`, `revert` are NOT colors and
     are rejected. If you need the newer color functions, use a browser's
     CSS.supports — this gift trades breadth for a tiny, dependency-free core you
     can read in one sitting.

   Pure function of its input. Same code in a browser (window.LoopGifts.isValidCSSColor)
   or Node (this CLI / require()).

   USAGE
     node isvalidcsscolor.js "rebeccapurple"     # prints "true" or "false", exits 0/1
     node isvalidcsscolor.js "#0f0" "not-a-color" # one verdict per argument
     node isvalidcsscolor.js --help

   Released under MIT.
*/
"use strict";

// The 148 CSS Color Module Level 4 named colors, plus `transparent` and the
// `currentcolor` keyword. All lowercase; input is lowercased before lookup.
var NAMED = ("aliceblue antiquewhite aqua aquamarine azure beige bisque black " +
  "blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate " +
  "coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod " +
  "darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange " +
  "darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray " +
  "darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey " +
  "dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold " +
  "goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory " +
  "khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral " +
  "lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink " +
  "lightsalmon lightseagreen lightskyblue lightslategray lightslategrey " +
  "lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine " +
  "mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue " +
  "mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream " +
  "mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered " +
  "orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff " +
  "peru pink plum powderblue purple rebeccapurple red rosybrown royalblue " +
  "saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue " +
  "slategray slategrey snow springgreen steelblue tan teal thistle tomato " +
  "turquoise violet wheat white whitesmoke yellow yellowgreen " +
  "transparent currentcolor").split(/\s+/);

var NAMED_SET = Object.create(null);
for (var n = 0; n < NAMED.length; n++) { NAMED_SET[NAMED[n]] = true; }

// A CSS <number>: optional sign, digits with an optional fractional part, or a
// leading-dot fraction, with optional scientific notation. Rejects a trailing
// bare dot ("5." is NOT a valid CSS number).
var NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
var PERCENT = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?%$/;
var ANGLE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?(?:deg|grad|rad|turn)$/;
var HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/;

function isNumber(t) { return NUMBER.test(t); }
function isPercent(t) { return PERCENT.test(t); }
function isHue(t) { return NUMBER.test(t) || ANGLE.test(t); }        // bare number = degrees
function isAlphaLegacy(t) { return NUMBER.test(t) || PERCENT.test(t); }
function isAlphaModern(t) { return NUMBER.test(t) || PERCENT.test(t) || t === "none"; }

// Validate an rgb()/rgba()/hsl()/hsla() body. `fn` is one of rgb|rgba|hsl|hsla,
// `inner` is the text between the parentheses (already lowercased).
function validFunction(fn, inner) {
  inner = inner.trim();
  if (inner === "") { return false; }
  var isRgb = (fn === "rgb" || fn === "rgba");

  if (inner.indexOf(",") !== -1) {
    // ---- Legacy comma syntax: no `none`, no `/`, exactly 3 or 4 parts --------
    if (inner.indexOf("/") !== -1) { return false; }
    var parts = inner.split(",");
    for (var i = 0; i < parts.length; i++) { parts[i] = parts[i].trim(); }
    if (parts.length !== 3 && parts.length !== 4) { return false; }
    var c = [parts[0], parts[1], parts[2]];
    if (c[0] === "none" || c[1] === "none" || c[2] === "none") { return false; }
    if (isRgb) {
      var allNum = isNumber(c[0]) && isNumber(c[1]) && isNumber(c[2]);
      var allPct = isPercent(c[0]) && isPercent(c[1]) && isPercent(c[2]);
      if (!(allNum || allPct)) { return false; }
    } else {
      if (!isHue(c[0])) { return false; }
      if (!(isPercent(c[1]) && isPercent(c[2]))) { return false; }
    }
    if (parts.length === 4) {
      if (parts[3] === "none" || !isAlphaLegacy(parts[3])) { return false; }
    }
    return true;
  }

  // ---- Modern space syntax: `none` allowed, optional `/ alpha`, mixing ok -----
  var slash = inner.split("/");
  if (slash.length > 2) { return false; }
  var comps = slash[0].trim().split(/\s+/).filter(Boolean);
  var alpha = slash.length === 2 ? slash[1].trim() : null;
  if (comps.length !== 3) { return false; }
  if (isRgb) {
    for (var j = 0; j < 3; j++) {
      var v = comps[j];
      if (!(isNumber(v) || isPercent(v) || v === "none")) { return false; }
    }
  } else {
    if (!(isHue(comps[0]) || comps[0] === "none")) { return false; }
    for (var k = 1; k < 3; k++) {
      var w = comps[k];
      if (!(isPercent(w) || isNumber(w) || w === "none")) { return false; }
    }
  }
  if (alpha !== null) {
    if (alpha === "" || !isAlphaModern(alpha)) { return false; }
  }
  return true;
}

/**
 * isValidCSSColor(input) -> boolean
 * True iff `input` is a string naming a color in this gift's supported subset of
 * the CSS Color spec (see the file header for the exact contract). Non-strings
 * return false — a color is a string token, not a number or object. Surrounding
 * whitespace is trimmed before checking.
 */
function isValidCSSColor(input) {
  if (typeof input !== "string") { return false; }
  var s = input.trim();
  if (s === "") { return false; }
  var lower = s.toLowerCase();

  if (NAMED_SET[lower] === true) { return true; }
  if (HEX.test(lower)) { return true; }

  var m = /^(rgba?|hsla?)\((.*)\)$/.exec(lower);
  if (m) { return validFunction(m[1], m[2]); }

  return false;
}

// ---- Dual-runtime export: browser namespace + Node module ------------------
if (typeof window !== "undefined") {
  window.LoopGifts = window.LoopGifts || {};
  window.LoopGifts.isValidCSSColor = isValidCSSColor;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { isValidCSSColor: isValidCSSColor };
}

// ---- CLI: one verdict per argument; exit 0 iff every argument is valid -------
if (typeof require !== "undefined" && require.main === module) {
  var args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    process.stdout.write(
      "isvalidcsscolor — is a string a valid CSS color? (defined subset)\n\n" +
      "  node isvalidcsscolor.js \"rebeccapurple\"      one verdict, exit 0 if valid\n" +
      "  node isvalidcsscolor.js \"#0f0\" \"nope\"        one line per argument\n\n" +
      "Accepts: named colors, transparent, currentColor, hex 3/4/6/8,\n" +
      "rgb()/rgba() and hsl()/hsla() in legacy and modern syntax.\n" +
      "Does NOT accept hwb()/lab()/lch()/oklab()/oklch()/color()/color-mix()/\n" +
      "relative-color syntax/system colors. See the README for the full edge.\n");
    process.exit(args.length === 0 ? 1 : 0);
  }
  var allValid = true;
  for (var a = 0; a < args.length; a++) {
    var ok = isValidCSSColor(args[a]);
    if (!ok) { allValid = false; }
    process.stdout.write((args.length > 1 ? args[a] + "\t" : "") + (ok ? "true" : "false") + "\n");
  }
  process.exit(allValid ? 0 : 1);
}
