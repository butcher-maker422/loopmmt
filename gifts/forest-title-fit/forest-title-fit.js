#!/usr/bin/env node
// SPDX-License-Identifier: MIT
"use strict";
/* forest-title-fit.js — shrink-to-fit-never-clip title sizing.

   The sign-painter's problem: a title must fit a fixed width, at the largest size
   that still fits, and it must NEVER clip and NEVER get an ellipsis — if it can't
   fit on one line even at the floor size, it wraps or the caller is told, but a
   character is never silently cut. This is a general UI primitive: a card title, a
   nav label, a chart caption, a poster headline.

   THE SEAM. Measuring rendered text needs a font engine, which lives in the DOM
   (`canvas.getContext('2d').measureText`). To keep this primitive PURE and testable
   without a browser, the measuring function is INJECTED, not imported: every entry
   point takes a `measure(text, fontSize) -> width` callback. In a browser you pass
   a one-line canvas-backed measurer (see makeCanvasMeasure below, guarded so it is
   defined only when a DOM exists); in a test you pass a deterministic stub. The
   fitting LOGIC — the binary search for the largest fitting size, the floor, the
   never-clip guarantee — is the same pure function in both worlds.

   No DOM access in the core, no filesystem, no network. Node (module.exports) or
   browser (window.LoopGifts.titleFit). */

/* fitFontSize(text, width, opts) -> {fontSize, fits, width: measuredWidth, floored}
   Find the largest integer font size in [min, max] whose single-line measured width
   is <= the available width.
     text    : the string to fit
     width   : available width in the same unit measure() returns
     opts.measure : REQUIRED (text, fontSize) -> width. The seam.
     opts.min : floor font size (default 8). Never returns below this.
     opts.max : ceiling font size (default 96).
   Return:
     fontSize : the chosen size (>= min always — never clips by shrinking past floor)
     fits     : true iff the text fits at the returned size (false => it overflows
                even at the floor; the caller decides to wrap — see wrapToWidth)
     width    : measured width at the returned size
     floored  : true iff the search bottomed out at min without fitting */
function fitFontSize(text, width, opts) {
  opts = opts || {};
  var measure = opts.measure;
  if (typeof measure !== "function")
    throw new Error("fitFontSize: opts.measure(text, fontSize) is required (the seam)");
  var min = (opts.min === undefined) ? 8 : opts.min;
  var max = (opts.max === undefined) ? 96 : opts.max;
  if (min > max) throw new Error("fitFontSize: min > max");
  if (typeof width !== "number" || width <= 0) throw new Error("fitFontSize: width must be > 0");

  // Largest size whose width <= available. Binary search over integer sizes.
  var lo = min, hi = max, best = null;
  while (lo <= hi) {
    var mid = Math.floor((lo + hi) / 2);
    var w = measure(text, mid);
    if (w <= width) { best = mid; lo = mid + 1; }  // fits — try bigger
    else { hi = mid - 1; }                          // too wide — go smaller
  }
  if (best !== null) {
    return { fontSize: best, fits: true, width: measure(text, best), floored: false };
  }
  // Nothing fit, not even min. Never clip: return the floor and report !fits.
  return { fontSize: min, fits: false, width: measure(text, min), floored: true };
}

/* wrapToWidth(text, width, fontSize, measure) -> [line, line, ...]
   Greedy word-wrap so no line's measured width exceeds `width` at `fontSize`.
   The never-clip fallback when fitFontSize reports !fits: instead of cutting or
   ellipsizing, break on spaces. A single word wider than `width` is placed on its
   own line intact (still never clipped — overflow is visible, not hidden). */
function wrapToWidth(text, width, fontSize, measure) {
  if (typeof measure !== "function")
    throw new Error("wrapToWidth: measure(text, fontSize) is required");
  if (typeof width !== "number" || width <= 0) throw new Error("wrapToWidth: width must be > 0");
  var words = String(text).split(/\s+/).filter(function (w) { return w.length > 0; });
  var lines = [], cur = "";
  for (var i = 0; i < words.length; i++) {
    var candidate = cur ? (cur + " " + words[i]) : words[i];
    if (measure(candidate, fontSize) <= width || cur === "") {
      // fits, OR the line is empty (a too-long single word goes on its own line intact)
      if (measure(candidate, fontSize) <= width) { cur = candidate; }
      else { lines.push(words[i]); cur = ""; }     // lone oversized word: own line
    } else {
      lines.push(cur); cur = words[i];
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

/* fitTitle(text, width, opts) -> {fontSize, lines, fits, floored}
   The convenience entry: try to fit on ONE line at the largest size; if it can't
   fit even at the floor, keep the floor size and WRAP (never clip, never ellipsize).
   Returns the chosen size and the line array to render. */
function fitTitle(text, width, opts) {
  var f = fitFontSize(text, width, opts);
  if (f.fits) return { fontSize: f.fontSize, lines: [String(text)], fits: true, floored: false };
  var measure = (opts || {}).measure;
  return {
    fontSize: f.fontSize,
    lines: wrapToWidth(text, width, f.fontSize, measure),
    fits: false,
    floored: f.floored
  };
}

/* makeCanvasMeasure(fontFamily) -> measure(text, fontSize) using a real canvas.
   Defined only in a browser (guarded); this is the DOM half kept OUT of the pure
   core. In Node it is a no-op that throws if called, so the seam stays explicit. */
function makeCanvasMeasure(fontFamily) {
  fontFamily = fontFamily || "sans-serif";
  if (typeof document === "undefined")
    return function () { throw new Error("makeCanvasMeasure: no DOM (pass your own measure in Node)"); };
  var ctx = document.createElement("canvas").getContext("2d");
  return function (text, fontSize) {
    ctx.font = fontSize + "px " + fontFamily;
    return ctx.measureText(String(text)).width;
  };
}

// ---- dual-runtime export ---------------------------------------------------
if (typeof window !== "undefined") {
  window.LoopGifts = window.LoopGifts || {};
  window.LoopGifts.titleFit = {
    fitFontSize: fitFontSize, wrapToWidth: wrapToWidth,
    fitTitle: fitTitle, makeCanvasMeasure: makeCanvasMeasure
  };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    fitFontSize: fitFontSize, wrapToWidth: wrapToWidth,
    fitTitle: fitTitle, makeCanvasMeasure: makeCanvasMeasure
  };
}

// ---- CLI (value-arg + --demo; reads NO files) ------------------------------
if (typeof require !== "undefined" && require.main === module) {
  var args = process.argv.slice(2);
  // A deterministic demo measurer: width = chars * fontSize * 0.6 (a monospace-ish model).
  function demoMeasure(text, fontSize) { return String(text).length * fontSize * 0.6; }

  function printDemo() {
    var width = 300;
    var cases = ["OK", "A Longer Title Here", "SupercalifragilisticexpialidociousUnbreakableWord"];
    process.stdout.write("# forest-title-fit demo (available width = " + width + ", monospace-ish model)\n");
    for (var i = 0; i < cases.length; i++) {
      var r = fitTitle(cases[i], width, { measure: demoMeasure, min: 8, max: 72 });
      process.stdout.write(
        JSON.stringify(cases[i]) + " -> size " + r.fontSize +
        ", " + r.lines.length + " line(s), fits=" + r.fits +
        (r.floored ? " (floored)" : "") + "\n");
      for (var k = 0; k < r.lines.length; k++)
        process.stdout.write("    | " + r.lines[k] + "\n");
    }
    process.exit(0);
  }

  if (args[0] === "--help" || args[0] === "-h") {
    process.stdout.write(
      "forest-title-fit — shrink-to-fit-never-clip title sizing\n\n" +
      "  node forest-title-fit.js --demo           fit a few sample titles to a fixed width\n" +
      "  node forest-title-fit.js '<title>' [width] fit one title (uses a monospace-ish model)\n\n" +
      "Library: fitFontSize / fitTitle / wrapToWidth, each taking an injected\n" +
      "measure(text, fontSize) seam. makeCanvasMeasure() supplies the browser one.\n" +
      "Pure — no DOM in the core, no files, no network. Exit 0.\n");
    process.exit(0);
  }
  if (args[0] === "--demo" || args.length === 0) { printDemo(); }
  else {
    var w = args[1] ? parseInt(args[1], 10) : 300;
    var res = fitTitle(args[0], w, { measure: demoMeasure, min: 8, max: 72 });
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    process.exit(0);
  }
}
