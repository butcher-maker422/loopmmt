#!/usr/bin/env node
/* interval-math.js — interval arithmetic (+ - * /) over a JSONL stream of operations.
   Dependency-free, deterministic. Runs in Node or a browser. MIT.

   WHAT IT IS. Give it a stream of operations — one JSON record per line (JSONL),
   each naming two intervals and an operator — and it computes the resulting interval
   and emits it. An interval [lo, hi] stands for "some real number between lo and hi,
   inclusive"; interval arithmetic computes the tightest interval GUARANTEED to
   contain the true result whatever the inputs actually were. Same stream in,
   byte-identical stream out, on every machine and every run. It is a TRANSFORM: one
   record in, one record out, in the same order.

   THE OPERATION RECORD. Each non-blank line is one JSON object:

       {"op": "+", "a": [1, 2], "b": [3, 4]}   -> {"lo":4,"hi":6}
       {"op": "*", "a": [-1, 2], "b": [3, 4]}  -> {"lo":-4,"hi":8}
       {"op": "/", "a": [1, 1], "b": [2, 4]}   -> {"lo":0.25,"hi":0.5}

   "op" is one of "+", "-", "*", "/". "a" and "b" are each a two-element array
   [lo, hi] of finite JSON numbers with lo <= hi. The output is {"lo":L, "hi":H}.

   THE CONTAINMENT GUARANTEE (the whole point). For every operation the result [L,H]
   is computed so that for ALL x in a and ALL y in b, (x op y) lies in [L, H]. This
   is the load-bearing invariant: interval arithmetic is only correct if it never
   loses a possible result.

     +   [a,b] + [c,d] = [a+c, b+d]
     -   [a,b] - [c,d] = [a-d, b-c]              (subtract the OTHER interval flipped)
     *   [a,b] * [c,d] = [min(P), max(P)]  where P = {a*c, a*d, b*c, b*d}
                                            (ALL FOUR corner products — a naive
                                             [a*c, b*d] is WRONG whenever a sign
                                             crosses zero)
     /   [a,b] / [c,d] = [a,b] * [1/d, 1/c]      (multiply by the reciprocal interval)
                                            ONLY when [c,d] does NOT contain 0 —

   DIVISION BY AN INTERVAL SPANNING ZERO IS A HARD ERROR. If b = [c,d] has c <= 0 <= d
   the reciprocal interval is unbounded (the result would be (-inf, +inf) or a split),
   so this gift REFUSES it (exit 2) rather than emit a bound it cannot honor. Dividing
   by an interval strictly on one side of zero (c>0 or d<0) is fine.

   NUMERIC HONESTY. Bounds are IEEE-754 doubles. Every endpoint must be a FINITE JSON
   number; a NaN/Infinity/overflow (e.g. 1e999 -> Infinity) or an interval with
   lo > hi is a HARD ERROR (exit 2) naming the line — never a silent skip. See the
   printed edge for the rounding caveat: this is EXACT for representable endpoints and
   representable results, but does NOT do outward-directed rounding, so a result whose
   true endpoint is not exactly representable in a double is stored as the nearest
   double (which may be a hair inside the mathematically-guaranteed bound). For
   verified/certified interval arithmetic use a rational or a directed-rounding
   library; this gift is the honest zero-dep representation, not a proof engine.

   USAGE
     printf '%s\n' '{"op":"+","a":[1,2],"b":[3,4]}' | node interval-math.js
     printf '%s\n' '{"op":"*","a":[-1,2],"b":[3,4]}' | node interval-math.js
     node interval-math.js ops.jsonl
     node interval-math.js --help

   Each non-blank line is one operation record; blank lines are skipped; a trailing
   \r (CRLF files) is trimmed. Output is one compact JSON object ({"lo":L,"hi":H})
   per record, one per line, in input order.

   Exit codes: 0 success · 2 input error (a line that is not a valid operation record,
   an unknown op, a non-finite or mis-ordered interval, or a division by an interval
   spanning zero). Always a clean one-line message on stderr, never a stack trace.

   Released under MIT. Its edge is printed in the README: this does the four
   arithmetic ops (+ - * /) on real intervals. It is NOT a full interval library — no
   power/exponent, roots, or transcendental functions (sin/exp/log), no interval
   union/intersection/hull, and NO outward-directed rounding (bounds are plain
   doubles). Division by an interval containing zero is refused, not split.
*/
"use strict";

var OPS = { "+": true, "-": true, "*": true, "/": true };

// Validate an interval value: a 2-element array of finite numbers with lo <= hi.
function checkInterval(v, which, lineNo) {
  if (!Array.isArray(v) || v.length !== 2) {
    throw new Error("line " + lineNo + " field " + JSON.stringify(which) +
      " must be a two-element [lo,hi] array");
  }
  var lo = v[0], hi = v[1];
  if (typeof lo !== "number" || typeof hi !== "number" || !isFinite(lo) || !isFinite(hi)) {
    throw new Error("line " + lineNo + " field " + JSON.stringify(which) +
      " endpoints must be finite numbers");
  }
  if (lo > hi) {
    throw new Error("line " + lineNo + " field " + JSON.stringify(which) +
      " has lo > hi (" + lo + " > " + hi + ")");
  }
  return [lo, hi];
}

// Compute one interval operation. Throws (clean, line-named) on divide-by-spanning-0.
function apply(op, a, b, lineNo) {
  var al = a[0], ah = a[1], bl = b[0], bh = b[1];
  switch (op) {
    case "+":
      return [al + bl, ah + bh];
    case "-":
      return [al - bh, ah - bl];
    case "*": {
      var p = [al * bl, al * bh, ah * bl, ah * bh];
      return [Math.min(p[0], p[1], p[2], p[3]), Math.max(p[0], p[1], p[2], p[3])];
    }
    case "/": {
      if (bl <= 0 && bh >= 0) {
        throw new Error("line " + lineNo +
          " divides by an interval spanning zero [" + bl + "," + bh + "] (unbounded result; refused)");
      }
      // reciprocal of [bl,bh] (which does not contain 0) is [1/bh, 1/bl]
      var rl = 1 / bh, rh = 1 / bl;
      var q = [al * rl, al * rh, ah * rl, ah * rh];
      return [Math.min(q[0], q[1], q[2], q[3]), Math.max(q[0], q[1], q[2], q[3])];
    }
    default:
      throw new Error("line " + lineNo + " unknown op " + JSON.stringify(op) +
        " (expected + - * /)");
  }
}

// Convert one parsed record -> {lo,hi}. Throws on a malformed record.
function computeRecord(rec, lineNo) {
  if (rec === null || typeof rec !== "object" || Array.isArray(rec)) {
    throw new Error("line " + lineNo + " is not an operation object");
  }
  var op = rec.op;
  if (typeof op !== "string" || !OPS[op]) {
    throw new Error("line " + lineNo + " has a missing or unknown op " +
      JSON.stringify(op) + " (expected + - * /)");
  }
  var a = checkInterval(rec.a, "a", lineNo);
  var b = checkInterval(rec.b, "b", lineNo);
  var r = apply(op, a, b, lineNo);
  return { lo: r[0], hi: r[1] };
}

// The public transform: JSONL text -> { lines: [json per record..], count }.
function transform(text) {
  var rawLines = String(text).split("\n");
  var out = [];
  var i, line, rec, result;
  for (i = 0; i < rawLines.length; i++) {
    line = rawLines[i];
    if (line.charCodeAt(line.length - 1) === 0x0d) line = line.slice(0, -1); // trim \r
    if (line.length === 0) continue; // blank line

    try { rec = JSON.parse(line); }
    catch (e) {
      throw new Error("line " + (i + 1) + " is not valid JSON: " + JSON.stringify(line.slice(0, 40)));
    }
    result = computeRecord(rec, i + 1);
    out.push(JSON.stringify(result));
  }
  return { lines: out, count: out.length };
}

/* ---- exports (browser + Node) ------------------------------------ */
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.intervalMath = transform;
  window.ForestGifts.intervalOp = function (op, a, b) { return apply(op, checkInterval(a, "a", 1), checkInterval(b, "b", 1), 1); };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { transform: transform, apply: apply, computeRecord: computeRecord, checkInterval: checkInterval };
}

/* ---- CLI (runs only when invoked directly, never on require) ------ */
function run(text) {
  var r = transform(text);
  var body = r.lines.length ? r.lines.join("\n") + "\n" : "";
  return { out: body, count: r.count };
}

function main(argv) {
  var args = argv.slice(2);
  if (args.indexOf("--help") !== -1 || args.indexOf("-h") !== -1) {
    process.stdout.write(
      "interval-math.js — interval arithmetic (+ - * /) over a JSONL stream.\n\n" +
      "  printf '%s\\n' '{\"op\":\"+\",\"a\":[1,2],\"b\":[3,4]}' | node interval-math.js   -> {\"lo\":4,\"hi\":6}\n" +
      "  printf '%s\\n' '{\"op\":\"*\",\"a\":[-1,2],\"b\":[3,4]}' | node interval-math.js  -> {\"lo\":-4,\"hi\":8}\n" +
      "  node interval-math.js ops.jsonl\n" +
      "  node interval-math.js --help\n\n" +
      "Each non-blank line is one operation object {op, a:[lo,hi], b:[lo,hi]}. The\n" +
      "result [L,H] is guaranteed to contain every (x op y) for x in a, y in b. Output\n" +
      "is one {\"lo\":L,\"hi\":H} per record, in input order.\n\n" +
      "Edge: the four arithmetic ops on real intervals. NOT a full interval library\n" +
      "(no powers/roots/transcendentals, no union/intersection, no outward rounding).\n" +
      "Division by an interval spanning zero is a hard error, not split.\n"
    );
    return 0;
  }

  var files = [];
  var i;
  try {
    for (i = 0; i < args.length; i++) {
      if (args[i].charAt(0) === "-" && args[i] !== "-") { throw new Error("unknown option " + args[i]); }
      else { files.push(args[i]); }
    }
  } catch (e) {
    process.stderr.write("interval-math: " + e.message + "\n");
    return 2;
  }

  function emit(text) {
    try {
      var r = run(text);
      process.stdout.write(r.out);
      return 0;
    } catch (e) {
      process.stderr.write("interval-math: " + e.message + "\n");
      return 2;
    }
  }

  if (files.length > 0) {
    var fs = require("fs");
    var text;
    try { text = fs.readFileSync(files[0], "utf8"); }
    catch (e) {
      process.stderr.write("interval-math: cannot read " + files[0] +
        " (" + (e.code === "EISDIR" ? "is a directory" : (e.code || "read error")) + ")\n");
      return 2;
    }
    return emit(text);
  }

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
