#!/usr/bin/env node
/* histogram-fold.js — fold a JSONL numeric stream into ONE bucketed histogram.
   Dependency-free, deterministic, one pass. Runs in Node or a browser. MIT.

   WHAT IT IS. Give it a stream of numbers — one JSON number per line (JSONL) —
   and it folds them into a single aggregate record: a contiguous list of
   fixed-width buckets with a count in each, plus the total count and the observed
   min and max. Same stream in, byte-identical record out, on every machine and
   every run. It is a FOLD, not a chart: the output is a JSON aggregate, not a
   picture — hand it to a plotter, a test, or a diff.

   HOW THE BUCKETS ARE DEFINED (the whole determinism story). Buckets are
   FIXED-WIDTH with a fixed origin, so a value's bucket never depends on the rest
   of the stream — which is exactly what makes the fold ONE PASS (no need to see
   every value first to learn a min/max range). For a value x:

       bucket index  i = floor((x - origin) / width)
       bucket range  [ origin + i*width , origin + (i+1)*width )   (lower-closed,
                                                                    upper-open)

   The default origin is 0 and the default width is 1, so a bare stream of numbers
   buckets into unit integer bins. Override with --width and --origin.

   The output bins are CONTIGUOUS from the lowest occupied bucket to the highest,
   with any empty interior bucket carried as a count of 0 — a histogram has no
   holes. Each bin's `hi` equals the next bin's `lo` exactly, because both edges
   are computed as origin + k*width for an integer k (never lo + width, which could
   round differently). An empty stream folds to `{bins:[], count:0, min:null,
   max:null}`.

   NUMERIC HONESTY (the character of this gift). A fold over numbers is only
   trustworthy if it refuses to quietly mishandle a number:
     - Every line must be a FINITE JSON number. A line that is not valid JSON, is
       not a number (a string, object, bool, null), or is a number that overflows
       to +/-Infinity (e.g. 1e999, which `JSON.parse` yields as Infinity) or is NaN
       is a HARD ERROR (exit 2) naming the line — never a silent skip.
     - Counts are integers and stay integers.
     - The bucket index is `Math.floor((x - origin) / width)` in IEEE-754 double.
       This is a DELIBERATE, PINNED specification, not an accident: on a float
       boundary the double arithmetic decides the bin, so with width 0.1 the value
       0.3 lands in bin 2 ([0.2,0.3)), because (0.3 - 0) / 0.1 === 2.9999999999996
       in IEEE-754, not 3. The gift does not paper this over with an epsilon (which
       would trade one surprise for a subtler one) — it states the rule, and the
       battery pins the 0.3-with-width-0.1 case so the behavior is a documented
       invariant. For clean boundaries, use an integer or exactly-representable
       width (1, 2, 5, 10, 0.5, 0.25).

   USAGE
     printf '%s\n' 1 2 2 5 | node histogram-fold.js            # unit integer bins
     node histogram-fold.js --width 10 nums.jsonl              # width-10 buckets
     node histogram-fold.js --width 10 --origin 5 < nums.jsonl # origin at 5
     node histogram-fold.js --help

   Each non-blank line is one number. Blank lines are skipped. A trailing \r
   (CRLF files) is trimmed. Output is one line of compact JSON (the aggregate
   record) followed by a newline.

   Exit codes: 0 success · 2 input error (missing file, a directory, a bad
   --width/--origin, a line that is not a finite JSON number, or a bucket range so
   large it would exhaust memory). Always a clean one-line message on stderr,
   never a stack trace.

   Released under MIT. Its edge is printed in the README: this COUNTS values into
   fixed-width buckets. It is NOT a density estimate (no smoothing, no KDE), NOT a
   quantile/percentile summary (it keeps no per-value order statistics beyond min
   and max), and the buckets are fixed-width by a fixed origin — it does NOT choose
   "nice" bin edges from the data (that would make a value's bin depend on the
   whole stream and cost the one-pass property).
*/
"use strict";

var MAX_BINS = 10000000; // guard: a range/width so large it would exhaust memory

// Parse one input line into a finite number, or throw a clean, line-named Error.
// (JSON.parse("1e999") === Infinity, so the finite check is load-bearing, not
// redundant with the parse.)
function parseNumber(line, lineNo) {
  var v;
  try { v = JSON.parse(line); }
  catch (e) {
    throw new Error("line " + lineNo + " is not valid JSON: " + JSON.stringify(line.slice(0, 40)));
  }
  if (typeof v !== "number") {
    throw new Error("line " + lineNo + " is not a number (got " +
      (v === null ? "null" : Array.isArray(v) ? "array" : typeof v) + "): " +
      JSON.stringify(line.slice(0, 40)));
  }
  if (!isFinite(v)) {
    throw new Error("line " + lineNo + " is not a finite number (" + String(v) + ")");
  }
  return v;
}

// The public fold: JSONL text + {width, origin} -> the aggregate record.
//   { bins: [ {lo, hi, count}, ... ],  // contiguous, lowest..highest occupied
//     width, origin,
//     count,                            // total values folded
//     min, max }                        // observed value extremes, null if empty
function fold(text, opts) {
  opts = opts || {};
  var width = opts.width === undefined ? 1 : opts.width;
  var origin = opts.origin === undefined ? 0 : opts.origin;
  if (typeof width !== "number" || !isFinite(width) || width <= 0) {
    throw new Error("width must be a finite number greater than 0 (got " + String(width) + ")");
  }
  if (typeof origin !== "number" || !isFinite(origin)) {
    throw new Error("origin must be a finite number (got " + String(origin) + ")");
  }

  var lines = String(text).split("\n");
  var counts = Object.create(null); // bucket index -> count
  var total = 0, min = null, max = null, minIdx = null, maxIdx = null;
  var i, line, x, idx;

  for (i = 0; i < lines.length; i++) {
    line = lines[i];
    if (line.charCodeAt(line.length - 1) === 0x0d) line = line.slice(0, -1); // trim \r
    if (line.length === 0) continue; // blank line is not a value

    x = parseNumber(line, i + 1);
    idx = Math.floor((x - origin) / width); // IEEE-754; boundary behavior is pinned

    counts[idx] = (counts[idx] || 0) + 1;
    total += 1;
    if (min === null || x < min) min = x;
    if (max === null || x > max) max = x;
    if (minIdx === null || idx < minIdx) minIdx = idx;
    if (maxIdx === null || idx > maxIdx) maxIdx = idx;
  }

  var bins = [];
  if (total > 0) {
    var span = maxIdx - minIdx + 1;
    if (span > MAX_BINS) {
      throw new Error("bucket range too large (" + span + " bins > " + MAX_BINS +
        "): widen --width or narrow the input range");
    }
    for (idx = minIdx; idx <= maxIdx; idx++) {
      bins.push({
        lo: origin + idx * width,
        hi: origin + (idx + 1) * width,
        count: counts[idx] || 0
      });
    }
  }

  return { bins: bins, width: width, origin: origin, count: total, min: min, max: max };
}

/* ---- exports (browser + Node) ------------------------------------ */
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.histogramFold = fold;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { fold: fold, MAX_BINS: MAX_BINS };
}

/* ---- CLI (runs only when invoked directly, never on require) ------ */
function run(text, opts) {
  return JSON.stringify(fold(text, opts)) + "\n";
}

// Parse a numeric CLI option value; throw a clean Error on a bad value.
function numOpt(name, raw) {
  var v = Number(raw);
  if (raw === undefined || raw === "" || !isFinite(v)) {
    throw new Error(name + " requires a finite number (got " + JSON.stringify(raw) + ")");
  }
  return v;
}

function main(argv) {
  var args = argv.slice(2);
  if (args.indexOf("--help") !== -1 || args.indexOf("-h") !== -1) {
    process.stdout.write(
      "histogram-fold.js — fold a JSONL numeric stream into one bucketed histogram.\n\n" +
      "  printf '%s\\n' 1 2 2 5 | node histogram-fold.js        unit integer bins\n" +
      "  node histogram-fold.js --width 10 nums.jsonl          width-10 buckets\n" +
      "  node histogram-fold.js --width 10 --origin 5 < in     origin at 5\n" +
      "  node histogram-fold.js --help\n\n" +
      "Each non-blank line is one FINITE JSON number. A value x lands in bucket\n" +
      "floor((x - origin) / width); buckets are [lo, hi) (lower-closed). Output is\n" +
      "one line of JSON: {bins:[{lo,hi,count}..], width, origin, count, min, max},\n" +
      "bins contiguous from the lowest to the highest occupied bucket.\n\n" +
      "Edge: this COUNTS into fixed-width buckets. It is NOT density estimation,\n" +
      "NOT a quantile summary, and it does NOT pick 'nice' data-driven bin edges\n" +
      "(that would cost the one-pass property). Non-finite or non-number input is\n" +
      "a hard error, never a silent skip.\n"
    );
    return 0;
  }

  var opts = {};
  var files = [];
  var i;
  try {
    for (i = 0; i < args.length; i++) {
      if (args[i] === "--width") { opts.width = numOpt("--width", args[++i]); }
      else if (args[i] === "--origin") { opts.origin = numOpt("--origin", args[++i]); }
      else if (args[i].charAt(0) === "-") { throw new Error("unknown option " + args[i]); }
      else { files.push(args[i]); }
    }
  } catch (e) {
    process.stderr.write("histogram-fold: " + e.message + "\n");
    return 2;
  }

  function emit(text) {
    try { process.stdout.write(run(text, opts)); return 0; }
    catch (e) { process.stderr.write("histogram-fold: " + e.message + "\n"); return 2; }
  }

  if (files.length > 0) {
    var fs = require("fs");
    var text;
    try { text = fs.readFileSync(files[0], "utf8"); }
    catch (e) {
      process.stderr.write("histogram-fold: cannot read " + files[0] +
        " (" + (e.code === "EISDIR" ? "is a directory" : (e.code || "read error")) + ")\n");
      return 2;
    }
    return emit(text);
  }

  // stdin
  var chunks = [];
  process.stdin.on("data", function (d) { chunks.push(d); });
  process.stdin.on("end", function () {
    process.exitCode = emit(Buffer.concat(chunks).toString("utf8"));
  });
  return 0;
}

if (typeof require !== "undefined" && require.main === module) {
  process.exitCode = main(process.argv);
}
