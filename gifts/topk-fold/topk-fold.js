#!/usr/bin/env node
/**
 * topk-fold — fold a JSONL numeric stream into its TOP-K values, one pass.
 *
 * WHAT
 *   Reads a stream of numbers — one JSON number per line (JSON Lines) — and folds
 *   them in ONE PASS into a single aggregate record:
 *       { count, k, top }
 *   `top` is the k LARGEST values seen, sorted DESCENDING (largest first). With
 *   --min it is the k SMALLEST, sorted ASCENDING (smallest first). `count` is the
 *   total number of values read; `k` is the requested size. If fewer than k values
 *   are seen, `top` holds all of them (still sorted) and count < k.
 *
 * HOW
 *   A BOUNDED HEAP of size k. For top-k a MIN-heap: push each value, and whenever
 *   the heap holds more than k, pop the SMALLEST — so the heap always retains the k
 *   largest seen. (For --min the mirror: a MAX-heap that pops the largest, retaining
 *   the k smallest.) One pass, O(n log k) time and O(k) space — it never holds the
 *   whole stream. At the end the heap is drained and sorted for output.
 *
 *   DETERMINISM (stronger than a float summary like running-stats): the emitted
 *   record is sorted, and numbers are indistinguishable under ties, so the SAME
 *   values in ANY order fold to a BYTE-IDENTICAL record. topk-fold is a partial
 *   order-statistic — the k largest are a fact about the multiset, not the arrival
 *   order. Pure: no clock, no randomness, no files written.
 *
 * USAGE
 *   node topk-fold.js --k N [--min] [FILE]        # stdin if no FILE
 *   printf '%s\n' 5 1 9 3 7 2 | node topk-fold.js --k 3
 *     -> {"count":6,"k":3,"top":[9,7,5]}
 *   printf '%s\n' 5 1 9 3 7 2 | node topk-fold.js --k 3 --min
 *     -> {"count":6,"k":3,"top":[1,2,3]}
 *   --k N   REQUIRED; the number of extreme values to keep (integer >= 1)
 *   --min   keep the k SMALLEST (bottom-k) instead of the k largest
 *   --help
 *
 * EXIT CODES
 *   0  success
 *   2  input error: missing/invalid --k (absent, non-integer, < 1); missing file /
 *      a directory; a line that is not a finite JSON number (incl. a value that
 *      overflows to +/-Infinity, e.g. 1e999) or NaN. Always a clean one-line message
 *      on stderr, never a stack trace.
 *
 * EDGE (what this is NOT)
 *   NOT a sort of the whole stream (keeps only k, in O(k) space), NOT a median or
 *   percentile (keeps no interior order statistics), and NOT a histogram or a
 *   running mean (see histogram-fold / running-stats). Ties at the k-th boundary
 *   are resolved BY VALUE: with duplicates, the k slots are filled by value, so
 *   [5,3,3,3] top-2 is [5,3] — the record is a multiset of values, never tagged by
 *   which arrival a tied value came from.
 *
 * Zero dependencies. Node builtin `require('fs')` for file reads only; runs in a
 * browser with no require (attaches `topkFold` to window.ForestGifts). MIT.
 */
"use strict";

/* ---- a bounded binary heap over numbers (min or max by `keepLargest`) ------
 * For top-k we keep the k LARGEST, so we evict the SMALLEST -> a MIN-heap.
 * For bottom-k (--min) we keep the k SMALLEST, so we evict the LARGEST -> a MAX-heap.
 * `worseThan(a,b)` is true when a should sit ABOVE b at the root (i.e. a is the one
 * we would evict): for a min-heap the smaller value is at the root; for a max-heap
 * the larger value is at the root. */
function BoundedHeap(k, keepLargest) {
  this.k = k;
  this.keepLargest = keepLargest;
  this.a = [];
}
// root should hold the eviction candidate: min-heap when keepLargest (evict smallest),
// max-heap when !keepLargest (evict largest).
BoundedHeap.prototype._rootFirst = function (x, y) {
  return this.keepLargest ? x < y : x > y;
};
BoundedHeap.prototype._swap = function (i, j) {
  var t = this.a[i]; this.a[i] = this.a[j]; this.a[j] = t;
};
BoundedHeap.prototype._up = function (i) {
  while (i > 0) {
    var p = (i - 1) >> 1;
    if (this._rootFirst(this.a[i], this.a[p])) { this._swap(i, p); i = p; } else break;
  }
};
BoundedHeap.prototype._down = function (i) {
  var n = this.a.length;
  for (;;) {
    var l = 2 * i + 1, r = 2 * i + 2, best = i;
    if (l < n && this._rootFirst(this.a[l], this.a[best])) best = l;
    if (r < n && this._rootFirst(this.a[r], this.a[best])) best = r;
    if (best === i) break;
    this._swap(i, best); i = best;
  }
};
BoundedHeap.prototype.offer = function (v) {
  this.a.push(v);
  this._up(this.a.length - 1);
  if (this.a.length > this.k) {
    // evict the root (the eviction candidate), keeping the desired k
    this.a[0] = this.a[this.a.length - 1];
    this.a.pop();
    if (this.a.length) this._down(0);
  }
};

/**
 * Fold a JSONL numeric stream into a top-k record.
 * @param {string} text  the whole input (newline-separated JSON numbers)
 * @param {{k:number, min?:boolean}} opts  k (integer >= 1); min => bottom-k
 * @returns {{count:number, k:number, top:number[]}}
 * @throws {Error} on an invalid k or a non-finite / non-number line.
 */
function fold(text, opts) {
  opts = opts || {};
  var k = opts.k;
  if (typeof k !== "number" || !isFinite(k) || Math.floor(k) !== k || k < 1) {
    throw new Error("k must be an integer >= 1 (got " + k + ")");
  }
  var keepLargest = !opts.min; // default top-k keeps largest; --min keeps smallest
  var heap = new BoundedHeap(k, keepLargest);
  var count = 0;

  var lines = String(text).split("\n");
  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i];
    if (raw.charCodeAt(raw.length - 1) === 13) raw = raw.slice(0, -1); // trim trailing \r
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
      throw new Error("line " + (i + 1) + ": not a finite number: " + raw);
    }
    count += 1;
    heap.offer(v);
  }

  // Drain and sort for a deterministic, order-independent output:
  //   top-k    -> descending (largest first)
  //   bottom-k -> ascending  (smallest first)
  var top = heap.a.slice();
  if (keepLargest) top.sort(function (a, b) { return b - a; });
  else top.sort(function (a, b) { return a - b; });

  return { count: count, k: k, top: top };
}

/* ------------------------------------------------------------------ exports */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { fold: fold };
}
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.topkFold = fold;
}

/* ----------------------------------------------------------------- CLI main */
function main(argv) {
  var args = argv.slice(2);
  var k = null;
  var min = false;
  var file = null;
  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    if (a === "--help" || a === "-h") {
      process.stdout.write(
        "usage: topk-fold.js --k N [--min] [FILE]\n" +
          "  --k N       REQUIRED; number of extreme values to keep (integer >= 1)\n" +
          "  --min       keep the k SMALLEST (bottom-k) instead of the k largest\n" +
          "  (no FILE)   read numbers from stdin\n" +
          "  FILE        read numbers from a file\n" +
          "  --help\n" +
          "Each non-blank line is one finite JSON number. Output is one line of compact JSON:\n" +
          '  {"count":N,"k":K,"top":[..]}   (top sorted largest-first, or smallest-first with --min)\n'
      );
      process.exit(0);
    } else if (a === "--min") {
      min = true;
    } else if (a === "--k") {
      var next = args[i + 1];
      if (next === undefined) { process.stderr.write("topk-fold: --k requires a value\n"); process.exit(2); }
      k = Number(next);
      i += 1;
    } else if (a.indexOf("--k=") === 0) {
      k = Number(a.slice(4));
    } else if (a.charAt(0) === "-" && a !== "-") {
      process.stderr.write("topk-fold: unknown option: " + a + "\n");
      process.exit(2);
    } else {
      if (file !== null) { process.stderr.write("topk-fold: more than one FILE given\n"); process.exit(2); }
      file = a;
    }
  }
  if (k === null) { process.stderr.write("topk-fold: --k N is required (integer >= 1)\n"); process.exit(2); }

  function run(text) {
    var rec;
    try {
      rec = fold(text, { k: k, min: min });
    } catch (e) {
      process.stderr.write("topk-fold: " + e.message + "\n");
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
      if (st.isDirectory()) { process.stderr.write("topk-fold: is a directory: " + file + "\n"); process.exit(2); return; }
      text = fs.readFileSync(file, "utf8");
    } catch (e) {
      process.stderr.write("topk-fold: cannot read file: " + file + "\n");
      process.exit(2);
      return;
    }
    run(text);
  }
}

if (typeof require !== "undefined" && require.main === module) {
  main(process.argv);
}
