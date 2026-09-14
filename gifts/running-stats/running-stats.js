#!/usr/bin/env node
/**
 * running-stats — fold a JSONL numeric stream into ONE running-statistics record.
 *
 * WHAT
 *   Reads a stream of numbers — one JSON number per line (JSON Lines) — and folds
 *   them in ONE PASS into a single aggregate record:
 *       { count, mean, variance, stddev, min, max }
 *   mean and variance are computed by WELFORD'S online algorithm, which is
 *   numerically stable where the textbook one-pass shortcut (sum of squares minus
 *   square of sum) catastrophically cancels — e.g. a tight cluster around a huge
 *   mean like 1e9. By default `variance`/`stddev` are POPULATION (divide by n);
 *   with --sample they are the Bessel-corrected SAMPLE statistics (divide by n-1).
 *
 * HOW
 *   Welford: for each x:  n += 1;  d = x - mean;  mean += d / n;  M2 += d * (x - mean).
 *   Then population variance = M2 / n, sample variance = M2 / (n - 1).
 *   The record is a PURE function of the input sequence — no clock, no randomness,
 *   no files written — so the same stream folds to a byte-identical record every
 *   run. NOTE: mean and variance are IEEE-754 doubles, so reordering the SAME values
 *   can change the low-order bits (float addition is not associative). running-stats
 *   is a summary statistic, deterministic for a given input order — NOT an exact
 *   multiset fingerprint (that is histogram-fold's job, with integer counts).
 *
 * USAGE
 *   node running-stats.js [--sample] [FILE]      # stdin if no FILE
 *   printf '%s\n' 2 4 4 4 5 5 7 9 | node running-stats.js
 *     -> {"count":8,"mean":5,"variance":4,"stddev":2,"min":2,"max":9}
 *   --sample   sample (n-1) variance/stddev instead of population (n)
 *   --help
 *
 * EXIT CODES
 *   0  success
 *   2  input error: missing file / a directory / a line that is not a finite JSON
 *      number (incl. a value that overflows to +/-Infinity, e.g. 1e999) or NaN /
 *      --sample with fewer than 2 values (sample variance is undefined). Always a
 *      clean one-line message on stderr, never a stack trace.
 *
 * EDGE (what this is NOT)
 *   NOT a median/percentile summary (keeps no order statistics beyond min & max),
 *   NOT a mode or histogram (see histogram-fold), and its mean/variance are floats:
 *   deterministic for a given input order, but reordering can move the low-order bits.
 *
 * Zero dependencies. Node builtin `require('fs')` for file reads only; runs in a
 * browser with no require (attaches `runningStats` to window.ForestGifts). MIT.
 */
"use strict";

/**
 * Fold a JSONL numeric stream into a running-statistics record.
 * @param {string} text  the whole input (newline-separated JSON numbers)
 * @param {{sample?: boolean}} [opts]
 * @returns {{count:number, mean:number, variance:number|null, stddev:number|null, min:number|null, max:number|null}}
 * @throws {Error} on a non-finite / non-number line, or --sample with count < 2.
 */
function fold(text, opts) {
  opts = opts || {};
  var sample = !!opts.sample;
  var n = 0;
  var mean = 0;
  var M2 = 0;
  var min = null;
  var max = null;

  var lines = String(text).split("\n");
  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i];
    if (raw.charCodeAt(raw.length - 1) === 13) raw = raw.slice(0, -1); // trim trailing \r (CRLF)
    if (raw.length === 0) continue; // blank line: skipped, not a value
    var v;
    try {
      v = JSON.parse(raw);
    } catch (e) {
      throw new Error("line " + (i + 1) + ": not valid JSON: " + raw);
    }
    if (typeof v !== "number") {
      throw new Error("line " + (i + 1) + ": not a number: " + raw);
    }
    if (!isFinite(v)) {
      // catches NaN and +/-Infinity (incl. 1e999, which JSON.parse yields as Infinity)
      throw new Error("line " + (i + 1) + ": not a finite number: " + raw);
    }
    // Welford online update
    n += 1;
    var delta = v - mean;
    mean += delta / n;
    var delta2 = v - mean;
    M2 += delta * delta2;
    if (min === null || v < min) min = v;
    if (max === null || v > max) max = v;
  }

  if (n === 0) {
    return { count: 0, mean: null, variance: null, stddev: null, min: null, max: null };
  }

  var variance, stddev;
  if (sample) {
    if (n < 2) {
      throw new Error("--sample: need at least 2 values for a sample variance (got " + n + ")");
    }
    variance = M2 / (n - 1);
  } else {
    variance = M2 / n;
  }
  // M2 is a sum of squares -> variance is >= 0 mathematically; clamp a tiny negative
  // float artifact (e.g. -1e-13 from cancellation) to exactly 0 so stddev is real.
  if (variance < 0) variance = 0;
  stddev = Math.sqrt(variance);

  return { count: n, mean: mean, variance: variance, stddev: stddev, min: min, max: max };
}

/* ------------------------------------------------------------------ exports */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { fold: fold };
}
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.runningStats = fold;
}

/* ----------------------------------------------------------------- CLI main */
function main(argv) {
  var args = argv.slice(2);
  var sample = false;
  var file = null;
  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    if (a === "--help" || a === "-h") {
      process.stdout.write(
        "usage: running-stats.js [--sample] [FILE]\n" +
          "  (no FILE)   read numbers from stdin\n" +
          "  FILE        read numbers from a file\n" +
          "  --sample    sample (n-1) variance/stddev instead of population (n)\n" +
          "  --help\n" +
          "Each non-blank line is one finite JSON number. Output is one line of compact JSON:\n" +
          '  {"count":N,"mean":..,"variance":..,"stddev":..,"min":..,"max":..}\n'
      );
      process.exit(0);
    } else if (a === "--sample") {
      sample = true;
    } else if (a.charAt(0) === "-" && a !== "-") {
      process.stderr.write("running-stats: unknown option: " + a + "\n");
      process.exit(2);
    } else {
      if (file !== null) {
        process.stderr.write("running-stats: more than one FILE given\n");
        process.exit(2);
      }
      file = a;
    }
  }

  function run(text) {
    var rec;
    try {
      rec = fold(text, { sample: sample });
    } catch (e) {
      process.stderr.write("running-stats: " + e.message + "\n");
      process.exit(2);
      return;
    }
    process.stdout.write(JSON.stringify(rec) + "\n");
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
      if (st.isDirectory()) {
        process.stderr.write("running-stats: is a directory: " + file + "\n");
        process.exit(2);
        return;
      }
      text = fs.readFileSync(file, "utf8");
    } catch (e) {
      process.stderr.write("running-stats: cannot read file: " + file + "\n");
      process.exit(2);
      return;
    }
    run(text);
  }
}

if (typeof require !== "undefined" && require.main === module) {
  main(process.argv);
}
