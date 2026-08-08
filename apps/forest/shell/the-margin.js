/* the-margin.js — Delight #6 of the Seven Delights (FWW(C) feature set).
   Auto-covered by delight-egress-guard.test.js (SC-7); unit test the-margin.test.js.

   THE MARGIN — the compose-side shape reflection (V6 partition #6).
     Trigger  : during compose (mail-renderer composeView, on the body input stream).
     Felt (SM-1, the sharpest felt): SHAPE / RHYTHM, never sentiment. A quiet margin
                beside the draft that echoes its GEOMETRY — coarse strata for the line
                rhythm, a settled/active pulse — and settles in the pauses. Calm, not
                casino (constraint 2): no judgment, no score, no meter; it reflects the
                shape of the writing, it never grades the writing.
     Form (JT-1, the sharpest design): STRATA keyed to *structure* — layered coarse
                marks, one per line, bucketed to a few widths so the margin is a
                gestural echo, not a pixel-exact readout (a precise bar-chart of line
                lengths would read as measurement/surveillance — the opposite of calm).
                Built from the one shared el / Block Alphabet.
     Security (SC-1, THE SHARPEST SECURITY): the raw draft NEVER crosses into this
                module. render(doc, digest) takes the compose-margin DIGEST — a
                content-free number/enum lattice from composeMargin.marginDigest() — and
                has NO draft parameter, so content is UN-REACHABLE here, not merely
                un-drawable (JT-1 -> SC-1). The module reads ONLY the digest's known
                numeric/enum fields; any unexpected free-form field is ignored, never
                rendered. The timing side-channel is already closed upstream (the digest
                carries only coarse settled/active + slow/medium/fast enums, never raw
                intervals). (SC-7): zero network — auto-covered by the derived egress guard.

   Plain script (no ES module, no deps) — attaches to window.ForestShell.margin.
   Cold-safe throughout: no document / no alphabet -> null, never throws. No network,
   no store, no draft (there is no draft parameter to hold). Depends only on
   window.ForestShell.block.el. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  var MAX_STRATA = 40;   // cap the mark count — a long draft echoes coarsely, never 1:1

  /* the coarse width lattice for a line — the ONLY thing a line's length becomes.
     A length is not content (SC-1), but a per-pixel echo would read as measurement;
     bucketing keeps the margin a gestural shape, calm not clinical (SM-1). */
  var WIDTHS = ["empty", "short", "medium", "long", "full"];

  /* widthBucket(len) — PURE. A line's char count -> a coarse width keyword.
     Boundaries kept coarse on purpose (the calm-not-casino intent). */
  function widthBucket(len) {
    var n = (typeof len === "number" && isFinite(len) && len > 0) ? len : 0;
    if (n === 0) return "empty";
    if (n <= 12) return "short";
    if (n <= 40) return "medium";
    if (n <= 72) return "long";
    return "full";
  }

  /* strata(digest) — PURE. The coarse width lattice for the draft's lines, capped.
     Reads ONLY digest.lineLengths (an integer array); returns width keywords, never
     any length value or any content. Absent/!array -> []. */
  function strata(digest) {
    var lens = (digest && Array.isArray(digest.lineLengths)) ? digest.lineLengths : [];
    var out = [];
    for (var i = 0; i < lens.length && i < MAX_STRATA; i++) out.push(widthBucket(lens[i]));
    return out;
  }

  /* the state / cadence enums, defensively clamped to the known set (an unexpected
     value falls back to the calm resting form — never rendered as free text). */
  function stateOf(digest) {
    var s = digest && digest.rhythm && digest.rhythm.state;
    return (s === "active") ? "active" : "settled";   // default settled (the calm pole)
  }
  function cadenceOf(digest) {
    var c = digest && digest.rhythm && digest.rhythm.cadence;
    return (c === "slow" || c === "medium" || c === "fast") ? c : "none";
  }

  /* render(doc, digest, opts) -> the Margin's Node | null.
       digest: the composeMargin.marginDigest() output — a content-free number/enum
         lattice. THERE IS NO DRAFT PARAMETER (SC-1 by construction). An empty draft
         (no lines with length) -> null (nothing to echo; the wiring clears the slot).
     JT-1: a `.margin` container carrying state + cadence modifiers, holding one
     `.margin__stratum` per line at a coarse width. Ambient ornament — aria-hidden, it
     is not content for a screen reader to read out. Cold-safe. */
  function render(doc, digest, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;   // cold-safe
    var block = root.block;
    if (!block || typeof block.el !== "function") return null;          // cold-safe: alphabet not loaded
    var el = block.el;

    var bars = strata(digest);
    // nothing but empty lines -> nothing to echo (calm blank, not a lone empty mark)
    var anyInk = false;
    for (var b = 0; b < bars.length; b++) { if (bars[b] !== "empty") { anyInk = true; break; } }
    if (!anyInk) return null;

    var state = stateOf(digest);
    var cadence = cadenceOf(digest);
    var wrap = el(doc, "div", "margin is-" + state + " cadence-" + cadence, { "aria-hidden": "true", role: "presentation" });
    for (var i = 0; i < bars.length; i++) {
      var stratum = el(doc, "div", "margin__stratum stratum--" + bars[i]);
      // CHAOS (JT-7): a hair of static, render-local micro-variance so the ambient
      // strata read as hand-drawn, not machine-ruled. Keyed on POSITION (the stratum
      // index) — never the bar's width/content, so no covert channel (SC-6). Cold-safe;
      // static (Constraint 2); bounded (JP-5) — all in chaos.
      if (root.chaos && typeof root.chaos.applyMark === "function") {
        root.chaos.applyMark(stratum, "margin:stratum:" + i);
      }
      wrap.appendChild(stratum);
    }
    return wrap;
  }

  root.margin = {
    widthBucket: widthBucket,
    strata: strata,
    render: render
  };
})();
