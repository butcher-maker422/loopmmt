#!/usr/bin/env node
/* plausible.js — a pure, dependency-free, HONEST gauge that guesses whether a
   string looks like plausible natural-language text, or clean-but-wrong output,
   and says how sure it is. The sibling of `legible`, on the orthogonal axis.

   WHY THIS EXISTS. `legible` detects control-character rubble: a string is
   `readable` when it is NOT byte-level garbage. But there is a whole class of
   extraction failure that produces clean, fully printable output and is still
   wrong — and legible reads every one of them as `readable`, because none of
   them touch the C0/U+FFFD band:
     • mojibake — the wrong charset, so "Müller" arrives as "MÃ¼ller"
     • custom glyph-to-ASCII encodings with no ToUnicode CMap
     • missing word boundaries — glyphs positioned without spaces, so
       thewordsallruntogether
     • hyphenation artifacts at PDF line breaks
   `plausible` reads the delta legible can't: does this look like language at
   all? It returns prose / suspect / garbled / empty with the raw score and the
   signal counts exposed, so you can see exactly why.

   THE LOAD-BEARING RULE (the same move legible makes with the C1 band, one axis
   over). legible REPORTS the C1 band but refuses to SCORE it, because scoring it
   would false-positive on Cyrillic/CJK decoded as Latin-1. `plausible` makes the
   identical cut, and the line is LANGUAGE-DEPENDENCE:
     • SCORED — structural, language-agnostic signals only:
         - the mojibake fingerprint (a byte-structural decode artifact, not a
           language stat — the strongest signal, and it carries the label),
         - space / word-boundary density, SCRIPT-GATED (suppressed and merely
           exposed when the string is a non-spaced script — CJK, Thai — which
           legitimately has no spaces; it will NOT call Japanese garbled),
         - trailing-hyphen-before-linebreak rate.
     • EXPOSED, NEVER SCORED — language-specific signals:
         - letter-frequency deviation from English (`letterFreqDevEn`),
         - mean word length (`meanWordLength`).
       Scoring these would punish every language that is not the reference one
       (Finnish, Turkish, Welsh). They are surfaced raw so a caller who knows
       their language can weigh them; they never drive the label.

   WHAT IT DOES NOT DO (printed edge — present here and in the README):
     plausible is a HEURISTIC, not a verdict. "Implausible as prose" is NOT
     "wrong extraction": code, tables, log lines, base64, URLs, poetry, and
     non-spaced scripts all read implausible and can be perfectly correct — it
     flags a smell, you read it. It is language-agnostic BY DESIGN, so
     deliberately weaker than a real per-language model — the price of not lying
     about languages it does not know. The mojibake fingerprint targets the two
     common confusions (UTF-8 shown as Latin-1 and as Windows-1252); it will not
     catch every charset mixup. It reads SHAPE, not intent — plausible prose can
     still be a well-formed prompt injection. It never decodes, corrects, or
     understands the text. It is a gauge you read, never a gate you route on.

   API
     plausible(input[, options]) — dispatches on the shape of `input`:
       • a string                -> assess(string)  -> { label, score, signals }
       • a record with `.text`   -> { ...record, plausibility: assess(record.text) }
       • an array of either      -> input.map(plausible)
     assess(text[, options]) -> { label, score, signals }
       label   one of "prose" | "suspect" | "garbled" | "empty"
       score   the implausibility ratio in [0,1], rounded to 4 places
       signals { length, mojibake, mojibakeRatio, spaceRate, spaceScored,
                 boundaryPenalty, lines, hyphenLines, hyphenRate,
                 nonSpacedFraction, letterFreqDevEn, meanWordLength,
                 implausibility }
     options.proseMax    (default 0.05) score <= this => prose
     options.garbledMin  (default 0.30) score >= this => garbled
                         (between the two bounds => suspect)
   Only the mojibake fingerprint can drive the label to `garbled` on its own;
   the boundary and hyphen signals are bounded so they reach `suspect`, not
   `garbled` — the label leans where it is grounded.

   Pure function of its input. No dependencies, no randomness, no clock, no I/O
   in the core — the same input always yields the same output (the determinism
   lint is trivial). Same code in a browser (window.LoopGifts.plausible) or Node
   (this CLI / require()).

   USAGE
     node plausible.js "some text"          # assess an argument, print JSON
     cat streams.jsonl | node plausible.js  # annotate each JSONL record's .text
     node plausible.js --port               # print this tool's port-verb (transform)
     node plausible.js --help

   Released under MIT.
*/
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window !== "undefined") {
    window.LoopGifts = window.LoopGifts || {};
    window.LoopGifts.plausible = api.plausible;
    window.LoopGifts.assessPlausibility = api.assess;
  }
  root.__plausible = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DEFAULTS = { proseMax: 0.05, garbledMin: 0.30 };

  // --- the SCORED signals (structural, language-agnostic) -------------------

  // Mojibake fingerprint. When UTF-8 bytes are decoded through a single-byte
  // codec, a multibyte sequence renders as a LEAD char immediately followed by
  // a CONTINUATION char. The lead is a UTF-8 lead byte shown as Latin-1
  // (0xC2–0xF4). The continuation is either the raw Latin-1 range (0x80–0xBF)
  // OR — the common real-world case — a Windows-1252 remap of the 0x80–0x9F
  // band (curly quotes, dashes, €, ™, …). We count both so the fingerprint
  // catches both the Latin-1 and the CP1252 confusion, not only the textbook one.
  function isUtf8LeadAsLatin1(c) { return c >= 0xc2 && c <= 0xf4; }
  // CP1252's printable remaps of bytes 0x80–0x9F (the 27 codepoints it defines).
  var CP1252_C1 = {};
  [0x20ac,0x201a,0x0192,0x201e,0x2026,0x2020,0x2021,0x02c6,0x2030,0x0160,
   0x2039,0x0152,0x017d,0x2018,0x2019,0x201c,0x201d,0x2022,0x2013,0x2014,
   0x02dc,0x2122,0x0161,0x203a,0x0153,0x017e,0x0178].forEach(function (cp) { CP1252_C1[cp] = 1; });
  function isMojibakeCont(c) {
    return (c >= 0x80 && c <= 0xbf) || CP1252_C1[c] === 1;
  }

  // Non-spaced scripts: scripts that legitimately write without spaces between
  // words. When a string is substantially one of these, the space signal is a
  // false tell, so we GATE it out of the score (exposed, never scored). Korean
  // (Hangul) is DELIBERATELY not here — Korean uses spaces, so its boundary
  // signal is meaningful.
  function isNonSpacedScript(c) {
    return (c >= 0x4e00 && c <= 0x9fff)   // CJK Unified Ideographs (Chinese, Kanji)
        || (c >= 0x3040 && c <= 0x30ff)   // Hiragana + Katakana (Japanese)
        || (c >= 0x3400 && c <= 0x4dbf)   // CJK Extension A
        || (c >= 0xf900 && c <= 0xfaff)   // CJK Compatibility Ideographs
        || (c >= 0x0e00 && c <= 0x0e7f)   // Thai
        || (c >= 0x0e80 && c <= 0x0eff)   // Lao
        || (c >= 0x1780 && c <= 0x17ff)   // Khmer
        || (c >= 0x1000 && c <= 0x109f);  // Myanmar
  }

  function isAsciiLetter(c) {
    return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
  }

  // --- the EXPOSED-not-scored signals (language-specific) -------------------

  // English letter frequencies (%). Used ONLY to expose a raw deviation number;
  // NEVER folded into the score — that would malign every non-English language.
  var EN_FREQ = {
    a:8.2,b:1.5,c:2.8,d:4.3,e:12.7,f:2.2,g:2.0,h:6.1,i:7.0,j:0.15,k:0.77,
    l:4.0,m:2.4,n:6.7,o:7.5,p:1.9,q:0.095,r:6.0,s:6.3,t:9.1,u:2.8,v:0.98,
    w:2.4,x:0.15,y:2.0,z:0.074
  };

  function assess(text, options) {
    var opt = options || {};
    var proseMax = typeof opt.proseMax === "number" ? opt.proseMax : DEFAULTS.proseMax;
    var garbledMin = typeof opt.garbledMin === "number" ? opt.garbledMin : DEFAULTS.garbledMin;

    if (text === null || text === undefined) return emptyResult();
    var s = String(text);
    if (s.length === 0 || /^\s*$/.test(s)) return emptyResult(s.length);

    var n = s.length;
    var mojibake = 0, spaces = 0, nonSpaced = 0, asciiLetters = 0;
    var freq = {};
    for (var i = 0; i < n; i++) {
      var c = s.charCodeAt(i);
      if (c === 0x20 || c === 0x09) spaces++;
      if (isNonSpacedScript(c)) nonSpaced++;
      if (isAsciiLetter(c)) {
        asciiLetters++;
        var ch = String.fromCharCode(c | 0x20); // lowercase
        freq[ch] = (freq[ch] || 0) + 1;
      }
      if (i + 1 < n && isUtf8LeadAsLatin1(c) && isMojibakeCont(s.charCodeAt(i + 1))) {
        mojibake++;
      }
    }

    var mojibakeRatio = round4(mojibake / Math.max(1, n - 1));
    var spaceRate = round4(spaces / n);
    var nonSpacedFraction = round4(nonSpaced / n);

    // Script-gate: only score the space signal when the string is NOT mostly a
    // non-spaced script AND there is enough Latin content for missing boundaries
    // to be meaningful.
    var spaceScored = nonSpacedFraction < 0.15 && n >= 24 && (asciiLetters / n) > 0.5;
    // Boundary penalty: how far below a generous prose space-floor we are.
    var SPACE_FLOOR = 0.08; // prose runs ~0.12–0.18; below the floor = boundaries missing
    var boundaryPenalty = spaceScored
      ? round4(clamp((SPACE_FLOOR - spaceRate) / SPACE_FLOOR, 0, 1))
      : 0;

    // Trailing-hyphen-before-linebreak rate. Only meaningful across several
    // lines — a single trailing hyphen is nothing; PDF hyphenation shows as many.
    var lines = s.split("\n");
    var totalLines = lines.length;
    var hyphenLines = 0;
    for (var j = 0; j < totalLines; j++) {
      if (/[-\u00ad]\s*$/.test(lines[j]) && /\w/.test(lines[j])) hyphenLines++;
    }
    var hyphenRate = totalLines >= 3 ? round4(hyphenLines / totalLines) : 0;

    // The score: mojibake dominant (can reach garbled alone); boundary and
    // hyphen bounded so they reach suspect, not garbled — the label leans on
    // the byte-structural signal.
    var implausibility = round4(clamp(
      mojibakeRatio * 1.0 +
      boundaryPenalty * 0.25 +
      hyphenRate * 0.20,
      0, 1));

    var label;
    if (implausibility <= proseMax) label = "prose";
    else if (implausibility >= garbledMin) label = "garbled";
    else label = "suspect";

    // EXPOSED-not-scored language stats.
    var letterFreqDevEn = asciiLetters >= 20 ? englishDeviation(freq, asciiLetters) : null;
    var meanWordLength = meanWord(s);

    return {
      label: label,
      score: implausibility,
      signals: {
        length: n,
        mojibake: mojibake,               // count of mojibake bigrams
        mojibakeRatio: mojibakeRatio,     // SCORED (dominant)
        spaceRate: spaceRate,
        spaceScored: spaceScored,         // was the space signal scored, or script-gated out?
        boundaryPenalty: boundaryPenalty, // SCORED when spaceScored, else 0
        lines: totalLines,
        hyphenLines: hyphenLines,
        hyphenRate: hyphenRate,           // SCORED when >= 3 lines, else 0
        nonSpacedFraction: nonSpacedFraction,
        letterFreqDevEn: letterFreqDevEn, // EXPOSED, never scored (English-referenced)
        meanWordLength: meanWordLength,   // EXPOSED, never scored
        implausibility: implausibility
      }
    };
  }

  // Sum of absolute deviations (percentage points) of a-z frequency from
  // English. English-referenced by construction — a raw signal, never scored.
  function englishDeviation(freq, letters) {
    var dev = 0;
    for (var k in EN_FREQ) {
      var obs = ((freq[k] || 0) / letters) * 100;
      dev += Math.abs(obs - EN_FREQ[k]);
    }
    return round4(dev);
  }

  function meanWord(s) {
    var words = s.split(/\s+/).filter(function (w) { return w.length > 0; });
    if (words.length === 0) return 0;
    var total = 0;
    for (var i = 0; i < words.length; i++) total += words[i].length;
    return round4(total / words.length);
  }

  function emptyResult(length) {
    return {
      label: "empty",
      score: 0,
      signals: {
        length: length || 0, mojibake: 0, mojibakeRatio: 0, spaceRate: 0,
        spaceScored: false, boundaryPenalty: 0, lines: 0, hyphenLines: 0,
        hyphenRate: 0, nonSpacedFraction: 0, letterFreqDevEn: null,
        meanWordLength: 0, implausibility: 0
      }
    };
  }

  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function round4(x) { return Math.round(x * 1e4) / 1e4; }

  // The composition joint: dispatch on the shape of the input (mirrors legible).
  function plausible(input, options) {
    if (Array.isArray(input)) {
      return input.map(function (x) { return plausible(x, options); });
    }
    if (input && typeof input === "object") {
      var out = {};
      for (var k in input) if (Object.prototype.hasOwnProperty.call(input, k)) out[k] = input[k];
      out.plausibility = assess(input.text, options);
      return out;
    }
    return assess(input, options);
  }

  return { plausible: plausible, assess: assess };
});

// ---- CLI (Node only) ------------------------------------------------------
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  var api = (typeof globalThis !== "undefined" ? globalThis : this).__plausible;

  function main(argv) {
    var args = argv.slice(2);
    if (args.indexOf("--port") !== -1) { process.stdout.write("transform\n"); return 0; }
    if (args.indexOf("--help") !== -1 || (args.length === 0 && process.stdin.isTTY)) {
      process.stdout.write(
        "plausible — a heuristic gauge: does this string look like plausible natural-language text?\n" +
        "  node plausible.js \"some text\"        assess an argument, print JSON\n" +
        "  cat streams.jsonl | node plausible.js  annotate each JSONL record's .text\n" +
        "  node plausible.js --port             print the port-verb (transform)\n" +
        "  node plausible.js --help\n"
      );
      return 0;
    }
    var textArg = null;
    for (var i = 0; i < args.length; i++) { if (args[i].indexOf("--") !== 0) { textArg = args[i]; break; } }
    if (textArg !== null) {
      process.stdout.write(JSON.stringify(api.assess(textArg)) + "\n");
      return 0;
    }
    var input = "";
    try { input = require("fs").readFileSync(0, "utf8"); } catch (e) { input = ""; }
    var lines = input.split("\n");
    for (var j = 0; j < lines.length; j++) {
      var line = lines[j];
      if (line === "" && j === lines.length - 1) continue;
      var rec;
      try {
        var parsed = JSON.parse(line);
        rec = api.plausible(parsed);
      } catch (e) {
        rec = { text: line, plausibility: api.assess(line) };
      }
      process.stdout.write(JSON.stringify(rec) + "\n");
    }
    return 0;
  }

  process.exitCode = main(process.argv);
}
