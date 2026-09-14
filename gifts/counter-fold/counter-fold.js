#!/usr/bin/env node
/**
 * counter-fold — a hand-built binary counter, one increment as a FOLD, in a trace loop.
 *
 * WHAT
 *   Reads the STATE of a binary counter -- the SET of its set bits, one non-negative
 *   integer bit-index per line (JSON Lines) -- and folds it into the counter's NEXT
 *   value by adding ONE, using a hand-built RIPPLE CARRY (clear the trailing run of
 *   set low bits, set the next clear bit). Output is the same shape as input: the new
 *   set of set bits, one index per line, sorted. So the gift is CLOSED UNDER ITS OWN
 *   I/O -- its output pipes straight back into itself:
 *       counter-fold < s0 | counter-fold | counter-fold   ==   counter-fold --steps 3 < s0
 *   That feedback -- the counter's state circulating through its own output channel,
 *   each pass advancing it by one tick -- is Shea's mercury delay line as a COUNTER
 *   (Loop 1.0's loop-line memory generalized): a register that counts by feeding its
 *   own state back. It is the Tier-B property: the reducer transition stays the `fold`
 *   atom; the loop (↻) is only wrapped around it, no new primitive. --steps N
 *   internalizes that loop (adds N).
 *
 * THE INCREMENT (a hand-built ripple carry, not native +1)
 *   The counter's value is the sparse binary number whose set bits are the input:
 *   value = sum of 2**i over the set bits i. Adding one is a ripple carry: starting
 *   at bit 0, clear each set bit in the trailing run of ones, then set the first clear
 *   bit reached. {0,1,3} (value 11) -> clear 0, clear 1, set 2 -> {2,3} (value 12).
 *   The counter is UNBOUNDED and SPARSE: only set bits are represented, and a bit
 *   index is a position (small even when the value is astronomical), so the counter
 *   counts past 2**53 with no loss -- it never holds the value as a native number.
 *
 * USAGE
 *   node counter-fold.js [--steps N] [FILE]        # stdin if no FILE
 *   printf '%s\n' 0 1 | node counter-fold.js        # counter = 3, +1 -> 4
 *     -> 2
 *   --steps N   add N in-process (default 1). N=0 canonicalises the input (dedups +
 *               sorts the bit set) without incrementing.
 *   --help
 *
 * EXIT CODES
 *   0  success
 *   2  input error: a line that is not a FINITE, NON-NEGATIVE INTEGER (a bit index);
 *      a bad --steps (non-integer or < 0); a missing file or a directory. Always a
 *      clean one-line message on stderr, never a stack trace.
 *
 * EDGE (what this is NOT)
 *   ONE deterministic binary counter incremented N times -- NOT a general adder (it
 *   adds ONE per step, via --steps N; it does not add two counters), NOT a bounded
 *   register (it is sparse and unbounded, so it never overflows), and NOT a value
 *   printer (it emits the SET of set bits, the counter's state -- value = sum of 2**i).
 *   Bits are unordered on input (a SET -- duplicates collapse, order is irrelevant)
 *   and SORTED on output (ascending), so the same counter value is a byte-identical
 *   record regardless of input order.
 *
 * Zero dependencies. Node builtin `require('fs')` for file reads only; runs in a
 * browser with no require (attaches `counterFold` to window.ForestGifts). MIT.
 */
"use strict";

/* one +1 ripple-carry step over a Set of bit indices -> a new Set of bit indices */
function step(bits) {
  var next = new Set(bits);
  var i = 0;
  while (next.has(i)) { next.delete(i); i++; } // clear the trailing run of set low bits
  next.add(i);                                 // set the first clear bit (the carry lands)
  return next;
}

/* parse JSONL bit indices -> Set of ints; throws on a non-negative-integer line */
function parse(text) {
  var bits = new Set();
  var lines = String(text).split("\n");
  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i];
    if (raw.charCodeAt(raw.length - 1) === 13) raw = raw.slice(0, -1); // CRLF
    if (raw.length === 0) continue; // blank line skipped
    var v;
    try { v = JSON.parse(raw); }
    catch (e) { throw new Error("line " + (i + 1) + ": not valid JSON: " + raw); }
    if (typeof v !== "number" || !isFinite(v) || Math.floor(v) !== v || v < 0) {
      throw new Error("line " + (i + 1) + ": bit index must be a finite non-negative integer: " + raw);
    }
    bits.add(v);
  }
  return bits;
}

/* sorted array of bit indices from a Set (ascending) -> canonical order */
function sortedBits(bits) {
  var arr = [];
  bits.forEach(function (b) { arr.push(b); });
  arr.sort(function (a, b) { return a - b; });
  return arr;
}

/**
 * Fold a JSONL bit-set forward N increments (+N).
 * @param {string} text  JSONL of non-negative integer bit indices (the counter's set bits)
 * @param {{steps?:number}} opts  steps N (integer >= 0; default 1)
 * @returns {{steps:number, count:number, bits:number[]}}  count = number of set bits
 * @throws {Error} on a bad line or a bad steps value.
 */
function fold(text, opts) {
  opts = opts || {};
  var steps = opts.steps === undefined ? 1 : opts.steps;
  if (typeof steps !== "number" || !isFinite(steps) || Math.floor(steps) !== steps || steps < 0) {
    throw new Error("steps must be an integer >= 0 (got " + steps + ")");
  }
  var bits = parse(text);
  for (var s = 0; s < steps; s++) bits = step(bits);
  var arr = sortedBits(bits);
  return { steps: steps, count: arr.length, bits: arr };
}

/* ------------------------------------------------------------------ exports */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { fold: fold, step: step, parse: parse, sortedBits: sortedBits };
}
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.counterFold = fold;
}

/* ----------------------------------------------------------------- CLI main */
function main(argv) {
  var args = argv.slice(2);
  var steps = 1, file = null;
  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    if (a === "--help" || a === "-h") {
      process.stdout.write(
        "usage: counter-fold.js [--steps N] [FILE]\n" +
          "  --steps N   add N in-process (default 1; N=0 canonicalises)\n" +
          "  (no FILE)   read the counter's set bits from stdin\n" +
          "  FILE        read the counter's set bits from a file\n" +
          "  --help\n" +
          "Each non-blank line is one set bit as a JSON non-negative integer. Output is\n" +
          "the next value's set bits, same shape, one index per line, sorted -- so\n" +
          "`counter-fold | counter-fold` adds two (closed under its own I/O).\n"
      );
      process.exit(0);
    } else if (a === "--steps") {
      var nx = args[i + 1];
      if (nx === undefined) { process.stderr.write("counter-fold: --steps requires a value\n"); process.exit(2); }
      steps = Number(nx); i += 1;
    } else if (a.indexOf("--steps=") === 0) {
      steps = Number(a.slice(8));
    } else if (a.charAt(0) === "-" && a !== "-") {
      process.stderr.write("counter-fold: unknown option: " + a + "\n"); process.exit(2);
    } else {
      if (file !== null) { process.stderr.write("counter-fold: more than one FILE given\n"); process.exit(2); }
      file = a;
    }
  }

  function run(text) {
    var rec;
    try { rec = fold(text, { steps: steps }); }
    catch (e) { process.stderr.write("counter-fold: " + e.message + "\n"); process.exit(2); return; }
    // closed under I/O: emit the SET of set bits as JSONL (one index per line)
    var out = "";
    for (var i = 0; i < rec.bits.length; i++) out += JSON.stringify(rec.bits[i]) + "\n";
    process.stdout.write(out);
  }

  if (file === null || file === "-") {
    var chunks = [];
    process.stdin.on("data", function (c) { chunks.push(c); });
    process.stdin.on("end", function () { run(Buffer.concat(chunks).toString("utf8")); });
  } else {
    var fs = require("fs");
    var text;
    try {
      var st = fs.statSync(file);
      if (st.isDirectory()) { process.stderr.write("counter-fold: is a directory: " + file + "\n"); process.exit(2); return; }
      text = fs.readFileSync(file, "utf8");
    } catch (e) {
      process.stderr.write("counter-fold: cannot read file: " + file + "\n"); process.exit(2); return;
    }
    run(text);
  }
}

if (typeof require !== "undefined" && require.main === module) {
  main(process.argv);
}
