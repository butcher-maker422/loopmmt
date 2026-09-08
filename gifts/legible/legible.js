#!/usr/bin/env node
/* legible.js — a pure, dependency-free, HONEST gauge that guesses whether a
   string is human-readable text or machine-drawn rubble, and says how sure it is.

   WHY THIS EXISTS. A text extractor (ratchet-pdf-text, ratchet-png-text,
   exif-parser, a MIME part decoder) hands you a `.text` field and, by design,
   cannot tell you whether that text is *readable*. The classic failure: a PDF
   whose glyphs are drawn through a subsetted CID font. The extractor pulls the
   string operands honestly, but each glyph is a 2-byte CID index, and decoded
   one-byte-at-a-time it comes back as control-character rubble that merely
   *looks* like a populated string. You get a confident `.text` that no human
   can read. `legible` reads the delta the extractor can't: it scores the string
   and returns readable / suspect / likely-binary / empty, with the raw score
   and the signal counts exposed so you can see exactly why.

   THE SIGNAL (the whole reason to trust it, and its whole limit). Human-readable
   text — in ANY script — almost never contains C0 control characters (0x00–0x1F,
   excluding the ordinary text whitespace tab/LF/CR/FF) or the Unicode
   replacement character U+FFFD. CID glyph indices decoded as Latin-1 land in
   exactly that band disproportionately (the high byte of a low subset index is
   0x00–0x1F, and half the bytes are often 0x00). So the SCORED gauge is the
   density of those "text-never-contains-this" characters — C0 controls plus
   U+FFFD, nothing else. This is deliberately NOT the printable-ratio: a UTF-8
   é / 안 / я decoded byte-wise lands in 0x80–0xFF, which OVERLAPS the C1-control
   band (0x80–0x9F) AND the UTF-8 continuation-byte band — so scoring C1 would
   flag legitimate multibyte text as binary (the CJK false-positive). We report
   C1/DEL and NUL counts as *signals* for your inspection, but we do NOT score
   them, precisely so multibyte-as-Latin1 does not read as rubble.

   WHAT IT DOES NOT DO (printed edge — present here and in the README):
     legible is a HEURISTIC, not a verdict, and it detects control-character
     rubble — NOT wrong encoding. Text decoded with the wrong charset (mojibake:
     UTF-8 read as Latin-1, æ—¥æœ¬èªž) is still printable characters, so it reads
     as `readable` even though no human can read it — a `readable` means "not
     control-char rubble," never "correctly decoded." It does not decode,
     validate, or understand the text, and never proves it correct, meaningful,
     or safe. It is a gauge you read, never a gate you route on.

   API
     legible(input[, options]) — dispatches on the shape of `input`:
       • a string                -> assess(string)  -> { label, score, signals }
       • a record with `.text`   -> { ...record, legibility: assess(record.text) }
       • an array of either      -> input.map(legible)
     assess(text[, options]) -> { label, score, signals }
       label   one of "readable" | "suspect" | "likely-binary" | "empty"
       score   the binary-character ratio in [0,1], rounded to 4 places
       signals { length, control, c1, nul, replacement, binaryRatio }
     options.readableMax  (default 0.05) score <= this => readable
     options.binaryMin    (default 0.30) score >= this => likely-binary
                          (between the two bounds => suspect)

   Pure function of its input. No dependencies, no randomness, no clock, no I/O
   in the core — the same input always yields the same output (the determinism
   lint is trivial). Same code in a browser (window.LoopGifts.legible) or Node
   (this CLI / require()).

   USAGE
     node legible.js "some text"        # assess an argument, print JSON
     cat streams.jsonl | node legible.js  # annotate each JSONL record's .text
     node legible.js --port             # print this tool's port-verb (transform)
     node legible.js --help

   Released under MIT.
*/
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window !== "undefined") {
    window.LoopGifts = window.LoopGifts || {};
    window.LoopGifts.legible = api.legible;
    window.LoopGifts.assessLegibility = api.assess;
  }
  root.__legible = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DEFAULTS = { readableMax: 0.05, binaryMin: 0.30 };

  // The ordinary text whitespace inside the C0 band — legitimate in readable
  // text, so NOT counted as a binary signal.
  function isTextWhitespace(c) {
    return c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d;
  }
  // C0 control (0x00–0x1F) that is NOT text whitespace.
  function isC0Control(c) {
    return c >= 0x00 && c <= 0x1f && !isTextWhitespace(c);
  }
  // DEL + C1 controls (0x7F, 0x80–0x9F). Reported as a signal but DELIBERATELY
  // NOT scored: 0x80–0x9F overlaps the UTF-8 continuation-byte band, so scoring
  // it would flag legitimate multibyte-as-Latin1 text as binary (the CJK
  // false-positive). Exposed for inspection; never drives the label.
  function isC1orDel(c) {
    return c === 0x7f || (c >= 0x80 && c <= 0x9f);
  }

  function assess(text, options) {
    var opt = options || {};
    var readableMax = typeof opt.readableMax === "number" ? opt.readableMax : DEFAULTS.readableMax;
    var binaryMin = typeof opt.binaryMin === "number" ? opt.binaryMin : DEFAULTS.binaryMin;

    // No signal to judge: null/undefined, empty, or whitespace-only.
    if (text === null || text === undefined) {
      return emptyResult();
    }
    var s = String(text);
    if (s.length === 0 || /^\s*$/.test(s)) {
      return emptyResult(s.length);
    }

    var control = 0, c1 = 0, nul = 0, replacement = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c === 0x00) nul++;
      if (c === 0xfffd) { replacement++; continue; }
      if (isC0Control(c)) { control++; continue; }
      if (isC1orDel(c)) { c1++; continue; }
    }
    var n = s.length;
    // SCORED signal: C0 controls + replacement only. c1/nul are reported below
    // for inspection but NOT scored (see isC1orDel — the CJK false-positive).
    var binaryRatio = (control + replacement) / n;
    var score = round4(binaryRatio);

    var label;
    if (score <= readableMax) label = "readable";
    else if (score >= binaryMin) label = "likely-binary";
    else label = "suspect";

    return {
      label: label,
      score: score,
      signals: {
        length: n,
        control: control,   // C0 controls, excluding text whitespace
        c1: c1,             // DEL + C1 controls
        nul: nul,           // count of 0x00 (a strong binary tell)
        replacement: replacement, // U+FFFD (botched decode)
        binaryRatio: score
      }
    };
  }

  function emptyResult(length) {
    return {
      label: "empty",
      score: 0,
      signals: { length: length || 0, control: 0, c1: 0, nul: 0, replacement: 0, binaryRatio: 0 }
    };
  }

  function round4(x) { return Math.round(x * 1e4) / 1e4; }

  // The composition joint: dispatch on the shape of the input.
  function legible(input, options) {
    if (Array.isArray(input)) {
      return input.map(function (x) { return legible(x, options); });
    }
    if (input && typeof input === "object") {
      // A record carrying a `.text` field (e.g. ratchet's .streams[] entries).
      var out = {};
      for (var k in input) if (Object.prototype.hasOwnProperty.call(input, k)) out[k] = input[k];
      out.legibility = assess(input.text, options);
      return out;
    }
    // A bare string (or anything String()-able).
    return assess(input, options);
  }

  return { legible: legible, assess: assess };
});

// ---- CLI (Node only) ------------------------------------------------------
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  var api = (typeof globalThis !== "undefined" ? globalThis : this).__legible;

  function main(argv) {
    var args = argv.slice(2);
    if (args.indexOf("--port") !== -1) { process.stdout.write("transform\n"); return 0; }
    if (args.indexOf("--help") !== -1 || (args.length === 0 && process.stdin.isTTY)) {
      process.stdout.write(
        "legible — a heuristic gauge: is this string readable text or machine-drawn rubble?\n" +
        "  node legible.js \"some text\"        assess an argument, print JSON\n" +
        "  cat streams.jsonl | node legible.js  annotate each JSONL record's .text\n" +
        "  node legible.js --port             print the port-verb (transform)\n" +
        "  node legible.js --help\n"
      );
      return 0;
    }
    // Argument form: assess the first non-flag argument.
    var textArg = null;
    for (var i = 0; i < args.length; i++) { if (args[i].indexOf("--") !== 0) { textArg = args[i]; break; } }
    if (textArg !== null) {
      process.stdout.write(JSON.stringify(api.assess(textArg)) + "\n");
      return 0;
    }
    // stdin JSONL form: one record (or raw line) per line -> annotate -> emit JSONL.
    var input = "";
    try { input = require("fs").readFileSync(0, "utf8"); } catch (e) { input = ""; }
    var lines = input.split("\n");
    for (var j = 0; j < lines.length; j++) {
      var line = lines[j];
      if (line === "" && j === lines.length - 1) continue; // trailing newline
      var rec;
      try {
        var parsed = JSON.parse(line);
        rec = api.legible(parsed);
      } catch (e) {
        // Not JSON — treat the raw line as a text string to assess.
        rec = { text: line, legibility: api.assess(line) };
      }
      process.stdout.write(JSON.stringify(rec) + "\n");
    }
    return 0;
  }

  process.exitCode = main(process.argv);
}
