#!/usr/bin/env node
/* base-n.js — convert an integer from one base to another, exactly, at any size,
   and REFUSE — naming the offending digit — when a digit is out of range for the
   base it was declared in.

   WHY THIS EXISTS. Base conversion looks like a solved problem — parseInt(s, 16),
   n.toString(2) — until you hit its three quiet failures. (1) SIZE: JavaScript's
   Number carries integers exactly only up to 2^53; parseInt("...", 16) on a long
   hash silently rounds, and you get a wrong number that LOOKS fine. (2) SILENT
   TRUNCATION: parseInt("12", 2) does not reject the "2" — it stops at the first
   bad digit and returns 1, no error. (3) ALPHABET DRIFT: is base 16's "A" the
   same as "a"? Does base 36 stop at "z"? Different tools answer differently. base-n
   fixes all three by construction: it computes on BigInt so a 300-digit value is
   exact; it FAILS CLOSED the instant a digit is not legal for its declared base,
   naming the digit and its position; and it uses ONE canonical alphabet
   (0-9 then a-z, case-insensitive on input, lowercase on output) for bases 2..36.

   THE ONE DISCIPLINE (the whole reason to trust it). Every digit is proven legal
   for its base before any arithmetic runs (the ⊢ rule: claim only what you can
   prove). There is no "best effort" parse and no digit is ever skipped or
   coerced. An illegal digit is not a warning to absorb — it is a non-zero exit
   naming the digit, the base, and the character offset. That refusal is the
   feature.

   CLOSED UNDER ROUND-TRIP. Converting to base B and back to base 10 returns the
   original value, exactly, at any size:  base-n --to 16 | base-n --from 16 --to 10
   is the identity on the value. This is the invariant the conformance oracle
   checks, and it is why the gift can be trusted on inputs no one hand-verified.

   Pure function of its inputs. No dependencies. Same input -> byte-identical
   output, every run. Runs in a browser (window.ForestGifts.baseN) or on Node
   (this CLI / require()).

   USAGE
     node base-n.js --from 16 --to 10 ff            # one value on argv -> "255"
     node base-n.js --to 2 255                       # --from defaults to 10 -> "11111111"
     echo '{"value":"ff","from":16}' | node base-n.js --to 10   # JSONL stream in
     printf 'ff\n10\n' | node base-n.js --from 16 --to 10        # bare-value lines in
     node base-n.js --from 2 --to 16 11111111        # -> "ff"
     node base-n.js --help

   INPUT
     A value may come from a positional arg, or from stdin. On stdin, each line is
     one record: either a bare numeral (uses --from) or a JSON object
     {"value": "...", "from": N} (per-record base overrides --from). A leading '-'
     marks a negative value. Underscores and surrounding whitespace in a numeral
     are ignored (1_000 == 1000); everything else must be a legal digit.

   BASES
     --from and --to are integers 2..36. Digits are 0-9 then a-z (a=10 .. z=35),
     case-insensitive on input. Output digits are lowercase. Base 10 is the
     default input base.

   OUTPUT
     The converted numeral on stdout, one per input record, each on its own line
     (single trailing newline). On an illegal digit or a bad base: nothing for
     that failure on stdout, a named error on stderr, non-zero exit.

   Released under MIT. Its edge is printed in the README and this header:
   base-n converts an integer between bases 2..36 exactly (BigInt, any size) and
   refuses (naming the digit) on an out-of-range digit; it does NOT parse decimals,
   fractions, floats, scientific notation, or bases outside 2..36 — integers only.
*/

"use strict";

// The one canonical alphabet: index i is the digit of value i. 0-9 then a-z.
// Bases 2..36 use the first `base` characters of this string.
var ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
var MIN_BASE = 2;
var MAX_BASE = 36;

// A structured refusal. The CLI turns this into a non-zero exit with the
// message; require() callers get a thrown Error they can catch. Extra fields
// (digit, base, offset) let a caller react programmatically.
function BaseNError(message, extra) {
  var e = new Error(message);
  e.name = "BaseNError";
  if (extra) {
    if (extra.digit !== undefined) e.digit = extra.digit;
    if (extra.base !== undefined) e.base = extra.base;
    if (extra.offset !== undefined) e.offset = extra.offset;
  }
  return e;
}

// validateBase(b) -> the integer base, or throws. Accepts a number or a numeric
// string; must be an integer in [2, 36]. This is a base, not a value, so it is
// deliberately NOT run through the BigInt digit machinery.
function validateBase(b) {
  var n;
  if (typeof b === "number") {
    n = b;
  } else if (typeof b === "string" && /^[0-9]+$/.test(b.trim())) {
    n = parseInt(b.trim(), 10);
  } else {
    throw BaseNError("base must be an integer 2..36, got " + JSON.stringify(b));
  }
  if (!Number.isInteger(n) || n < MIN_BASE || n > MAX_BASE) {
    throw BaseNError("base must be an integer 2..36, got " + JSON.stringify(b), { base: n });
  }
  return n;
}

// digitValue(ch, base, offset) -> the integer value of one digit character in
// `base`, or throws BaseNError naming the digit and its position. Case-folded.
function digitValue(ch, base, offset) {
  var lower = ch.toLowerCase();
  var v = ALPHABET.indexOf(lower);
  if (v < 0 || v >= base) {
    throw BaseNError(
      "illegal digit " + JSON.stringify(ch) + " for base " + base + " at offset " + offset,
      { digit: ch, base: base, offset: offset }
    );
  }
  return v;
}

/* toBigInt(numeral, from) -> a BigInt equal to the value of `numeral` read in
   base `from`. Handles an optional leading '-', ignores '_' separators and
   surrounding whitespace, and FAILS CLOSED (naming the digit + offset) on any
   character that is not a legal digit of `from`. An empty numeral (after
   stripping sign/underscores/space) is an error — there is no "empty is zero". */
function toBigInt(numeral, from) {
  var base = validateBase(from);
  if (typeof numeral !== "string") numeral = String(numeral);
  var s = numeral.trim();
  var neg = false;
  var start = 0;
  if (s.charAt(0) === "-") { neg = true; start = 1; }
  else if (s.charAt(0) === "+") { start = 1; }

  var bigBase = BigInt(base);
  var acc = 0n;
  var sawDigit = false;
  for (var i = start; i < s.length; i++) {
    var ch = s.charAt(i);
    if (ch === "_") continue;          // grouping separator, ignored
    var dv = digitValue(ch, base, i);  // throws on illegal digit, names offset
    acc = acc * bigBase + BigInt(dv);
    sawDigit = true;
  }
  if (!sawDigit) {
    throw BaseNError("empty numeral (no digits) in base " + base + ": " + JSON.stringify(numeral));
  }
  return neg ? -acc : acc;
}

/* fromBigInt(n, to) -> the string numeral for BigInt `n` in base `to`, using the
   canonical lowercase alphabet, with a leading '-' for negatives and "0" for
   zero. Pure repeated-division; exact at any size. */
function fromBigInt(n, to) {
  var base = validateBase(to);
  if (typeof n !== "bigint") n = BigInt(n);
  if (n === 0n) return "0";
  var neg = n < 0n;
  if (neg) n = -n;
  var bigBase = BigInt(base);
  var out = "";
  while (n > 0n) {
    var rem = n % bigBase;
    out = ALPHABET.charAt(Number(rem)) + out;
    n = n / bigBase;
  }
  return neg ? "-" + out : out;
}

/* convert(numeral, from, to) -> the numeral of `numeral` (read in base `from`)
   re-expressed in base `to`. The composition the gift exists for; also the thing
   the round-trip oracle exercises. */
function convert(numeral, from, to) {
  return fromBigInt(toBigInt(numeral, from), to);
}

// ---- CLI ----------------------------------------------------------------

var HELP =
  "base-n — convert an integer between bases 2..36, exactly (BigInt), fail-closed.\n\n" +
  "  node base-n.js --from B1 --to B2 VALUE     convert one value on argv\n" +
  "  node base-n.js --to B2 VALUE               --from defaults to 10\n" +
  "  <stream> | node base-n.js --to B2          one record per line on stdin\n\n" +
  "A stdin line is a bare numeral (uses --from) or a JSON object\n" +
  '{"value":"...","from":N} (per-record base overrides --from).\n\n' +
  "  --from B    input base 2..36 (default 10)\n" +
  "  --to B      output base 2..36 (default 10)\n" +
  "  --help      this text\n";

function parseArgs(argv) {
  var args = argv.slice(2);
  var opt = { from: "10", to: "10", positional: null, help: false };
  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    if (a === "--help" || a === "-h") { opt.help = true; }
    else if (a === "--from") { opt.from = args[++i]; }
    else if (a === "--to") { opt.to = args[++i]; }
    else if (a.indexOf("--from=") === 0) { opt.from = a.slice(7); }
    else if (a.indexOf("--to=") === 0) { opt.to = a.slice(5); }
    else if (opt.positional === null) { opt.positional = a; }
    else { throw BaseNError("unexpected extra argument: " + JSON.stringify(a)); }
  }
  return opt;
}

// One stdin line -> { value, from } (JSON object form or bare numeral form).
function recordFromLine(line, defaultFrom) {
  var t = line.trim();
  if (t === "") return null;
  if (t.charAt(0) === "{") {
    var obj = JSON.parse(t); // JSON.parse throws on malformed -> caught by caller
    if (obj === null || typeof obj !== "object" || !("value" in obj)) {
      throw BaseNError("stdin JSON record needs a \"value\" field: " + t);
    }
    var from = ("from" in obj) ? obj.from : defaultFrom;
    return { value: String(obj.value), from: from };
  }
  return { value: t, from: defaultFrom };
}

function main(argv) {
  var opt;
  try { opt = parseArgs(argv); }
  catch (e) { process.stderr.write("base-n: " + e.message + "\n"); return 2; }

  if (opt.help) { process.stdout.write(HELP); return 0; }

  // Validate bases once up front (a bad base is a startup error, not a per-record one).
  var toBase, fromBase;
  try { toBase = validateBase(opt.to); fromBase = validateBase(opt.from); }
  catch (e) { process.stderr.write("base-n: " + e.message + "\n"); return 2; }

  if (opt.positional !== null) {
    try {
      process.stdout.write(convert(opt.positional, fromBase, toBase) + "\n");
      return 0;
    } catch (e) {
      process.stderr.write("base-n: " + e.message + "\n");
      return 2;
    }
  }

  // stdin stream: one record per line, each converted, fail-closed on the first
  // bad record (so a partial stream never silently emits some-good-some-dropped).
  var chunks = [];
  process.stdin.on("data", function (d) { chunks.push(d); });
  process.stdin.on("end", function () {
    var text = Buffer.concat(chunks).toString("utf8");
    var lines = text.split("\n");
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var rec;
      try { rec = recordFromLine(lines[i], fromBase); }
      catch (e) { process.stderr.write("base-n: line " + (i + 1) + ": " + e.message + "\n"); process.exitCode = 2; return; }
      if (rec === null) continue;
      try {
        var recFrom = validateBase(rec.from);
        out.push(convert(rec.value, recFrom, toBase));
      } catch (e) {
        process.stderr.write("base-n: line " + (i + 1) + ": " + e.message + "\n");
        process.exitCode = 2;
        return;
      }
    }
    if (out.length) process.stdout.write(out.join("\n") + "\n");
    process.exitCode = 0;
  });
  return 0;
}

// ---- exports (dual-home) -------------------------------------------------

var api = {
  convert: convert,
  toBigInt: toBigInt,
  fromBigInt: fromBigInt,
  validateBase: validateBase,
  digitValue: digitValue,
  BaseNError: BaseNError,
  ALPHABET: ALPHABET
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.baseN = api;
}

if (typeof require !== "undefined" && require.main === module) {
  process.exitCode = main(process.argv);
}
