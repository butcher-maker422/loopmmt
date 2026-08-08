/* Shea's Forest — the App Shell · shell/compose-margin-digest.js
   U2 · SC-1 — the STRUCTURAL-DIGEST MEMBRANE (V6 SC-1 / JT-1 "shape not sentiment").

   WHAT THIS IS. A pure, DOM-free membrane between a compose DRAFT (the raw text the
   operator is typing, plus the raw keystroke TIMING) and the Margin — the delight-
   layer surface that wants to reflect the *shape* of what's being written (line
   rhythm, paragraph blocks, a coarse "settling vs. actively typing" pulse) WITHOUT
   ever seeing the words. The membrane computes a GEOMETRY-ONLY digest and exposes
   ONLY that. The raw draft string and the raw inter-keystroke intervals never cross
   this boundary — so the Margin cannot log them, render from them, or egress them.

   THE PROPERTY IT ENFORCES (SC-1, turned from ASSERTED into ENFORCED by the test):
     • CONTENT IS UN-REACHABLE. The digest is BUILT by MEASURING — line lengths,
       break offsets, a paragraph count, a total char count — and by QUANTIZING
       timing into coarse enums. It is never built by copying, slicing, or spreading
       any part of the draft. So no substring of the content can appear downstream:
       the projection cannot leak content it never received (the same discipline as
       the shipped connector-items K1 core — PICK/COMPUTE, never spread).
     • TIMING IS A CLOSED SIDE-CHANNEL. Raw inter-keystroke intervals are a
       fingerprint (they can betray hesitation, word boundaries, even identity).
       They enter `rhythm()` and are collapsed to a coarse bucket — settled/active +
       slow/medium/fast — before anything escapes. No raw interval value is ever in
       the output. Two very different keystroke streams that fall in the same bucket
       produce the SAME rhythm (the side-channel is closed by quantization, SC-1).

   THE AIRTIGHT LEG. `leavesAreContentFree(digest)` walks any digest and asserts
   every leaf is a finite NUMBER or one of a FIXED set of enum keywords (or the
   digits-and-dots version tag). No free-form string can be present — so a digest is
   content-free *by construction*, provable over arbitrary drafts, not just spot
   checks. The test rides this over randomized drafts (SC-1's byte-disjoint proof).

   RIDES U1. This is a delight-layer module (NOT on U1's egress allowlist), so it
   makes zero network calls — U1's guard bites the moment it ever tries. The test
   requires U1's `scanSourceForEgress` and re-proves it here, chaining the floor.

   Plain script (no ES module, no deps) — attaches to window.ForestShell.composeMargin. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  /* ---- the FIXED output alphabet for the rhythm field ----------------------- *
   * Coarse, quantized enums ONLY. Nothing raw (no interval, no content) is ever  *
   * represented here — the digest's ability to be content-free rests on this     *
   * set staying closed. leavesAreContentFree() checks membership against it.      */
  var RHYTHM_STATE = { SETTLED: "settled", ACTIVE: "active" };
  var CADENCE      = { SLOW: "slow", MEDIUM: "medium", FAST: "fast", NONE: "none" };

  var RHYTHM_STATES = [RHYTHM_STATE.SETTLED, RHYTHM_STATE.ACTIVE];
  var CADENCES      = [CADENCE.SLOW, CADENCE.MEDIUM, CADENCE.FAST, CADENCE.NONE];

  /* Quantization boundaries (ms). Kept coarse ON PURPOSE — a fine bucket would
   * re-open the side-channel. mean < FAST_MAX -> fast; < MED_MAX -> medium; else
   * slow. A trailing gap >= SETTLE_GAP means the operator has paused ("settled"). */
  var FAST_MAX   = 150;    // sub-150ms mean cadence reads as fast typing
  var MED_MAX    = 400;    // 150–400ms reads as medium
  var SETTLE_GAP = 1500;   // a >=1.5s trailing pause reads as "settled"

  /* ---- geometry: MEASURE structure, never copy content ---------------------- *
   * Splits on newlines and reads only LENGTHS and BREAK POSITIONS — integers, no *
   * character of the draft is retained. `breakOffsets` are the char index of each *
   * newline (running sums of the line lengths); `paragraphCount` counts runs of   *
   * non-blank lines separated by >=1 blank line. Every field is a number.        */
  function geometry(draftText) {
    var s = String(draftText == null ? "" : draftText);
    var lines = s.split("\n");

    var lineLengths = [];
    for (var i = 0; i < lines.length; i++) lineLengths.push(lines[i].length);

    var breakOffsets = [];
    var off = 0;
    for (var j = 0; j < lines.length - 1; j++) {
      off += lines[j].length;   // advance to just before the break
      breakOffsets.push(off);   // the newline sits at this char index
      off += 1;                 // step over the "\n" itself
    }

    var paragraphCount = 0, inPara = false;
    for (var k = 0; k < lines.length; k++) {
      var nonEmpty = lines[k].trim().length > 0;
      if (nonEmpty && !inPara) { paragraphCount++; inPara = true; }
      else if (!nonEmpty) { inPara = false; }
    }

    return {
      charCount: s.length,            // total length (a number, not the text)
      lineCount: lines.length,        // number of lines
      lineLengths: lineLengths,       // per-line char counts (integers)
      breakOffsets: breakOffsets,     // char index of each newline (integers)
      paragraphCount: paragraphCount  // count of non-blank runs (integer)
    };
  }

  /* ---- rhythm: QUANTIZE raw timing to coarse enums -------------------------- *
   * `timingSamples` is the raw inter-keystroke interval array (ms). It is read,   *
   * a mean + a trailing-gap are computed, and then DISCARDED — only the bucket    *
   * (an enum) escapes. No raw interval value appears in the return.               *
   *   state:   settled | active   (settled == a >=SETTLE_GAP trailing pause)      *
   *   cadence: slow | medium | fast | none  (none == no usable samples)           */
  function rhythm(timingSamples) {
    var arr = Array.isArray(timingSamples) ? timingSamples : [];
    var sum = 0, n = 0;
    for (var i = 0; i < arr.length; i++) {
      var v = Number(arr[i]);
      if (isFinite(v) && v >= 0) { sum += v; n++; }
    }
    if (n === 0) return { state: RHYTHM_STATE.SETTLED, cadence: CADENCE.NONE };

    var mean = sum / n;                                   // computed, then dropped
    var last = Number(arr[arr.length - 1]);               // trailing gap
    var state = (isFinite(last) && last >= SETTLE_GAP)
      ? RHYTHM_STATE.SETTLED : RHYTHM_STATE.ACTIVE;
    var cadence = mean < FAST_MAX ? CADENCE.FAST
                : (mean < MED_MAX ? CADENCE.MEDIUM : CADENCE.SLOW);

    return { state: state, cadence: cadence };            // enums only — raw values gone
  }

  /* ---- the membrane: the ONLY thing the Margin ever receives ---------------- */
  function marginDigest(draftText, timingSamples) {
    var g = geometry(draftText);
    var r = rhythm(timingSamples);
    return {
      charCount: g.charCount,
      lineCount: g.lineCount,
      lineLengths: g.lineLengths,
      breakOffsets: g.breakOffsets,
      paragraphCount: g.paragraphCount,
      rhythm: r,
      _version: "1.0"
    };
  }

  /* ---- the airtight leg: prove a digest is content-free BY CONSTRUCTION ------ *
   * Walks the digest; every leaf must be a finite number, a member of the fixed   *
   * enum set (checked by its key), or the digits-and-dots version tag. ANY other  *
   * string is a content leak -> false. This is what makes SC-1 provable over      *
   * arbitrary drafts: if the shape is a number/enum lattice, content cannot ride. */
  function leafOK(val, key) {
    if (typeof val === "number") return isFinite(val);
    if (typeof val === "string") {
      if (key === "_version") return /^[0-9.]+$/.test(val);
      if (key === "state")    return RHYTHM_STATES.indexOf(val) !== -1;
      if (key === "cadence")  return CADENCES.indexOf(val) !== -1;
      return false;   // any other free-form string is content
    }
    return false;     // null/undefined/boolean/function are not valid digest leaves
  }
  function leavesAreContentFree(digest) {
    var ok = true;
    function walk(node, key) {
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i++) if (!walk(node[i], key)) ok = false;
        return ok;
      }
      if (node && typeof node === "object") {
        for (var k in node) {
          if (Object.prototype.hasOwnProperty.call(node, k)) if (!walk(node[k], k)) ok = false;
        }
        return ok;
      }
      if (!leafOK(node, key)) ok = false;
      return ok;
    }
    walk(digest, null);
    return ok;
  }

  /* ---- export -------------------------------------------------------------- */
  root.composeMargin = {
    marginDigest: marginDigest,
    geometry: geometry,
    rhythm: rhythm,
    leavesAreContentFree: leavesAreContentFree,
    _RHYTHM_STATE: RHYTHM_STATE,
    _CADENCE: CADENCE,
    _bounds: { FAST_MAX: FAST_MAX, MED_MAX: MED_MAX, SETTLE_GAP: SETTLE_GAP },
    _version: "1.0"
  };
})();
