#!/usr/bin/env node
/* seq-source.js — emit a deterministic arithmetic sequence as a JSONL record stream.
   Dependency-free, deterministic, pure. Runs in Node or a browser. MIT.

   WHAT IT IS. A SOURCE: it takes no input stream — it GENERATES one. Give it a count
   (and optionally a start, a step, and a field name) and it emits that many JSON
   objects, one per line (JSONL), each holding the next term of an integer arithmetic
   sequence: start, start+step, start+2*step, ... It is the front of a pipe — a
   deterministic generator you feed INTO the fold/filter/transform gifts, so you can
   produce a known stream to test or drive them without hand-writing a file.

       seq-source --count 5                     -> {"n":0}..{"n":4}
       seq-source --count 5 --start 10 --step 5 -> {"n":10} {"n":15} .. {"n":30}
       seq-source --count 3 --field id --start 100 -> {"id":100} {"id":101} {"id":102}

   INTEGERS ONLY (the honesty axis). count, start, and step must be INTEGERS. This is
   deliberate, not a limitation to apologize for: a floating-point sequence drifts —
   0 + 0.1 + 0.1 + 0.1 is not 0.3 — so its output would not be byte-deterministic, and
   a "source" that emits subtly different bytes on different machines is not a source
   you can pin. seq-source REFUSES a non-integer count/start/step (exit 2) rather than
   emit a drifting sequence. Every emitted term is an exact integer; the sequence is
   byte-identical on every machine and every run. (Terms are exact while they stay
   within +/-2^53, JavaScript's exact-integer range; a run that would cross it is a
   caller asking for more than a JSON number can hold honestly — keep counts sane.)

   THE MODEL
     --count N     REQUIRED. How many terms to emit. An integer >= 0 (0 emits nothing,
                   exit 0 — an empty stream is a valid stream, not an error).
     --start S     The first term. An integer, default 0.
     --step  D     The common difference. An integer, default 1 (may be 0 or negative).
     --field NAME  The object key each term is emitted under. Default "n". Non-empty.

   Each term i (0-based) is emitted as the single-key object { NAME: S + i*D }, one per
   line. The output is a stream the JSONL gifts consume: `seq-source --count 100 |
   range-filter --num n 10 20` produces exactly the records 10..20.

   DETERMINISM. generate(opts) is a pure function — no clock, no randomness, no files,
   no stdin — so the same options yield byte-identical output every run.

   USAGE
     node seq-source.js --count 10
     node seq-source.js --count 5 --start 100 --step -1 --field seq
     node seq-source.js --help

   Exit codes: 0 success (including an empty stream) · 2 input error (missing/non-integer
   count, non-integer start/step, negative count, empty field name, unknown option).
   Always a clean one-line message on stderr, never a stack trace.

   Released under MIT. Its edge is printed in the README: seq-source emits an INTEGER
   arithmetic sequence only — it does not do geometric or floating-point sequences, does
   not read any input, and does not randomize. It is a deterministic generator; a source
   you can pin, not a fixture you have to store.
*/
"use strict";

/* ---- the pure core ------------------------------------------------ */

function isInt(x) { return typeof x === "number" && isFinite(x) && Math.floor(x) === x; }

// Generate the sequence as an array of single-key records. Throws a clean Error on
// any invalid option — the CLI turns that into exit 2. Pure; no side effects.
function generate(opts) {
  opts = opts || {};
  var count = opts.count;
  var start = opts.start === undefined ? 0 : opts.start;
  var step = opts.step === undefined ? 1 : opts.step;
  var field = opts.field === undefined ? "n" : opts.field;

  if (!isInt(count)) throw new Error("--count must be an integer (got " + JSON.stringify(count) + ")");
  if (count < 0) throw new Error("--count must be >= 0 (got " + count + ")");
  if (!isInt(start)) throw new Error("--start must be an integer (got " + JSON.stringify(start) + ")");
  if (!isInt(step)) throw new Error("--step must be an integer (got " + JSON.stringify(step) + ")");
  if (typeof field !== "string" || field.length === 0) throw new Error("--field must be a non-empty name");

  var out = [];
  for (var i = 0; i < count; i++) {
    var rec = {};
    rec[field] = start + i * step;
    out.push(rec);
  }
  return out;
}

// Render the records as JSONL text (one JSON object per line, trailing newline if any).
function toJSONL(records) {
  var s = "";
  for (var i = 0; i < records.length; i++) s += JSON.stringify(records[i]) + "\n";
  return s;
}

/* ---- exports (browser + Node) ------------------------------------ */
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.seqSource = { generate: generate, toJSONL: toJSONL };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { generate: generate, toJSONL: toJSONL };
}

/* ---- CLI (runs only when invoked directly, never on require) ------ */

function parseArgs(args) {
  var opts = {};
  var i = 0;
  while (i < args.length) {
    var a = args[i];
    if (a === "--count" || a === "--start" || a === "--step") {
      var raw = args[i + 1];
      if (raw === undefined) throw new Error(a + " requires an integer value");
      var n = Number(raw);
      if (raw === "" || !isFinite(n)) throw new Error(a + " must be an integer (got " + JSON.stringify(raw) + ")");
      opts[a.slice(2)] = n;
      i += 2;
    } else if (a === "--field") {
      var f = args[i + 1];
      if (f === undefined) throw new Error("--field requires a name");
      opts.field = f;
      i += 2;
    } else if (a.charAt(0) === "-") {
      throw new Error("unknown option " + a);
    } else {
      throw new Error("unexpected argument " + JSON.stringify(a) + " (seq-source takes no positional input)");
    }
  }
  if (opts.count === undefined) throw new Error("--count is required");
  return opts;
}

function main(argv) {
  var args = argv.slice(2);
  if (args.indexOf("--help") !== -1 || args.indexOf("-h") !== -1) {
    process.stdout.write(
      "seq-source.js — emit a deterministic integer arithmetic sequence as JSONL.\n\n" +
      "  node seq-source.js --count 10\n" +
      "  node seq-source.js --count 5 --start 100 --step -1 --field seq\n" +
      "  node seq-source.js --help\n\n" +
      "  --count N     REQUIRED. number of terms to emit (integer >= 0)\n" +
      "  --start S     first term (integer, default 0)\n" +
      "  --step  D     common difference (integer, default 1; may be 0 or negative)\n" +
      "  --field NAME  object key each term is emitted under (default \"n\")\n\n" +
      "Emits N objects, one per line: { NAME: S + i*D } for i in 0..N-1.\n\n" +
      "Edge: an INTEGER arithmetic sequence only. It does not do geometric or\n" +
      "floating-point sequences (those drift and would not be byte-deterministic),\n" +
      "reads no input, and does not randomize. A deterministic generator you can pin.\n"
    );
    return 0;
  }
  var opts;
  try { opts = parseArgs(args); }
  catch (e) { process.stderr.write("seq-source: " + e.message + "\n"); return 2; }
  var records;
  try { records = generate(opts); }
  catch (e) { process.stderr.write("seq-source: " + e.message + "\n"); return 2; }
  process.stdout.write(toJSONL(records));
  return 0;
}

if (typeof require !== "undefined" && require.main === module) {
  process.exitCode = main(process.argv);
}
