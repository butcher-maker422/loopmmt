#!/usr/bin/env node
/* test_jq-lite.js — battery for the jq-lite gift.
   `node test_jq-lite.js` -> exit 0 PASS / non-zero FAIL.

   THE ORACLE IS INDEPENDENT AND TAKES A DIFFERENT ROUTE than the gift. The gift compiles
   the filter into a FLAT LIST OF STEP OBJECTS and threads a stream through them. The
   oracle here re-tokenizes the filter with a REGEX SCANNER and interprets it by RECURSIVE
   DESCENT directly over the value — no compiled step list, no shared parser, no shared
   evaluator. Two routes that share no code — agreement is evidence, not tautology. Plus
   frozen hand goldens for each quiet-failure case the gift exists to fix (missing-key,
   type-confusion, stream fan-out).
*/
"use strict";

var G = require("./jq-lite.js");
var assert = require("assert");

var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error("FAIL: " + name); }
}
function eq(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.error("FAIL: " + name + "\n  got:  " + g + "\n  want: " + w); }
}

/* ==================================================================
   INDEPENDENT ORACLE — regex-token scanner + recursive-descent walk.
   Tokens: DOT-FIELD (.name), BRACKET ([..] contents), PIPE (|),
           OPTIONAL (?), IDENTITY (a lone .).
   The oracle interprets tokens directly against the value, producing a
   stream (array). It shares NO code with the gift's step compiler.
   ================================================================== */

// Tokenize into an array of { kind, value, optional } accessor tokens and PIPE markers.
function oracleTokens(src) {
  var toks = [];
  var re = /\s*(\||\.(?:[A-Za-z_][A-Za-z0-9_]*)?|\[\s*(?:"(?:[^"\\]|\\.)*"|-?\d+|)\s*\])(\?)?/g;
  var i = 0;
  // Validate the whole string is consumed by our token grammar; else it's a syntax error.
  var consumed = 0;
  var m;
  re.lastIndex = 0;
  while ((m = re.exec(src)) !== null) {
    if (m.index !== consumed) throw new Error("oracle: gap at " + consumed);
    consumed = re.lastIndex;
    var raw = m[1];
    var optional = m[2] === "?";
    if (raw === "|") { toks.push({ kind: "pipe" }); continue; }
    if (raw === ".") { toks.push({ kind: "identity", optional: optional }); continue; }
    if (raw.charAt(0) === ".") { toks.push({ kind: "field", value: raw.slice(1), optional: optional }); continue; }
    if (raw.charAt(0) === "[") {
      var inner = raw.slice(1, -1).trim();
      if (inner === "") { toks.push({ kind: "iterate", optional: optional }); continue; }
      if (inner.charAt(0) === '"') { toks.push({ kind: "field", value: JSON.parse(inner), optional: optional }); continue; }
      toks.push({ kind: "index", value: parseInt(inner, 10), optional: optional }); continue;
    }
    throw new Error("oracle: unrecognized token " + raw);
  }
  if (consumed !== src.replace(/\s+$/, "").length && consumed !== src.length) {
    // allow trailing whitespace
    var tail = src.slice(consumed);
    if (tail.trim() !== "") throw new Error("oracle: trailing " + JSON.stringify(tail));
  }
  return toks;
}

function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }

// Apply one accessor token to one value -> array of values (recursive-descent semantics).
function oracleApply(tok, v) {
  switch (tok.kind) {
    case "identity": return [v];
    case "field":
      if (v === null || v === undefined) return [null];
      if (isObj(v)) return [Object.prototype.hasOwnProperty.call(v, tok.value) ? v[tok.value] : null];
      if (tok.optional) return [];
      throw tagged("type");
    case "index":
      if (v === null || v === undefined) return [null];
      if (Array.isArray(v)) { var k = tok.value < 0 ? v.length + tok.value : tok.value; return [(k >= 0 && k < v.length) ? v[k] : null]; }
      if (tok.optional) return [];
      throw tagged("type");
    case "iterate":
      if (Array.isArray(v)) return v.slice();
      if (isObj(v)) { var o = []; for (var kk in v) if (Object.prototype.hasOwnProperty.call(v, kk)) o.push(v[kk]); return o; }
      if (tok.optional) return [];
      throw tagged("type");
    default: throw new Error("oracle: bad token kind");
  }
}
function tagged(t) { var e = new Error(t); e.jqType = true; return e; }

// Interpret the whole token list over a value -> stream. Pipes just continue the thread.
function oracleRun(value, filter) {
  var toks = oracleTokens(filter);
  var stream = [value];
  for (var t = 0; t < toks.length; t++) {
    if (toks[t].kind === "pipe") continue; // sequential thread; pipe is a no-op separator
    var next = [];
    for (var i = 0; i < stream.length; i++) {
      var r = oracleApply(toks[t], stream[i]);
      for (var j = 0; j < r.length; j++) next.push(r[j]);
    }
    stream = next;
  }
  return stream;
}

/* ==================================================================
   GRID — gift == oracle across many (value, filter) pairs
   ================================================================== */
var VALUES = [
  {}, { a: 1 }, { a: { b: { c: 3 } } }, { a: null }, { "weird key": 9 },
  [], [1, 2, 3], [{ id: 1 }, { id: 2 }, { id: 3 }],
  { items: [{ id: 10 }, { id: 20 }] }, { xs: [], ys: [5] },
  { a: 1, b: 2, c: 3 }, [[1], [2, 3]], null, "hi", 42, true,
  { nested: { list: [{ v: 1 }, { v: 2 }] } }
];
var FILTERS = [
  ".", ".a", ".a.b", ".a.b.c", ".a?", ".missing", ".missing.deep",
  ".[]", ".[0]", ".[1]", ".[-1]", ".[2]", ".[5]",
  ".items[]", ".items[] | .id", ".[] | .id", ".xs[]", ".ys[]",
  '.["weird key"]', ".nested.list[] | .v", ".a.b?", ".[]?", ".[0]?"
];

for (var vi = 0; vi < VALUES.length; vi++) {
  for (var fi = 0; fi < FILTERS.length; fi++) {
    var val = VALUES[vi], filt = FILTERS[fi];
    var giftOut, giftErr = null, oracleOut, oracleErr = null;
    try { giftOut = G.run(val, filt); } catch (e) { giftErr = !!e.jqType ? "type" : "err"; }
    try { oracleOut = oracleRun(val, filt); } catch (e) { oracleErr = !!e.jqType ? "type" : "err"; }
    var name = "grid v" + vi + " f[" + filt + "]";
    if (giftErr || oracleErr) {
      ok(name + " (both error, same kind)", giftErr === oracleErr);
    } else {
      eq(name, giftOut, oracleOut);
    }
  }
}

/* ==================================================================
   FROZEN HAND GOLDENS — the three quiet failures, pinned exactly
   ================================================================== */

// 1. Missing-key crash -> null (not an exception)
eq("golden: missing key yields null",        G.run({}, ".a.b.c"), [null]);
eq("golden: missing on populated -> null",   G.run({ a: {} }, ".a.b"), [null]);
eq("golden: null propagates",                G.run({ a: null }, ".a.b"), [null]);
// TYPE-STRICT: a missing key must yield an actual JSON null, never `undefined` (which
// serializes to null but is a leaking JS artifact — the mutation-bite proves this matters).
ok("golden: missing key is real null not undefined", G.run({}, ".a")[0] === null && typeof G.run({}, ".a")[0] === "object");
ok("golden: missing deep is real null not undefined", G.run({ a: {} }, ".a.b")[0] === null);
ok("golden: no undefined ever leaks a stream", G.run({ a: { b: 1 } }, ".a.z")[0] === null);

// 2. Type confusion -> loud error, but ? suppresses to empty stream
ok("golden: .foo on string throws (type)",   (function () { try { G.run("hi", ".foo"); return false; } catch (e) { return !!e.jqType; } })());
eq("golden: .foo? on string -> empty",       G.run("hi", ".foo?"), []);
ok("golden: .[0] on number throws (type)",   (function () { try { G.run(42, ".[0]"); return false; } catch (e) { return !!e.jqType; } })());
eq("golden: .[]? on number -> empty",        G.run(42, ".[]?"), []);

// 3. Stream fan-out: .[] then pipe runs over EACH element
eq("golden: fan-out over array",             G.run([1, 2, 3], ".[]"), [1, 2, 3]);
eq("golden: fan-out then field",             G.run({ items: [{ id: 1 }, { id: 2 }] }, ".items[] | .id"), [1, 2]);
eq("golden: fan-out over empty array",       G.run([], ".[]"), []);
eq("golden: fan-out over object values",     G.run({ a: 1, b: 2 }, ".[]"), [1, 2]);
eq("golden: object value order = key order", G.run({ z: 1, a: 2, m: 3 }, ".[]"), [1, 2, 3]);

/* ==================================================================
   DIRECT UNIT CHECKS
   ================================================================== */
eq("identity returns input",                 G.run({ a: 1 }, "."), [{ a: 1 }]);
eq("negative index last element",            G.run([10, 20, 30], ".[-1]"), [30]);
eq("index out of range -> null",             G.run([1, 2], ".[9]"), [null]);
eq("bracket key with space",                 G.run({ "a b": 5 }, '.["a b"]'), [5]);
eq("chained field then index",               G.run({ xs: [7, 8, 9] }, ".xs[1]"), [8]);
eq("deep pipe",                              G.run({ a: { b: [{ c: 1 }, { c: 2 }] } }, ".a.b[] | .c"), [1, 2]);

// parse() surfaces
eq("parse identity",                         G.parse("."), [{ op: "identity" }]);
ok("parse field",                            G.parse(".a")[0].op === "field" && G.parse(".a")[0].key === "a");
ok("parse iterate",                          G.parse(".[]")[0].op === "iterate");
ok("parse pipe flattens",                    G.parse(".a | .b").length === 2);

// parseInputs
eq("parseInputs JSONL",                      G.parseInputs('{"a":1}\n{"a":2}\n'), [{ a: 1 }, { a: 2 }]);
eq("parseInputs skips blank lines",          G.parseInputs('1\n\n2\n'), [1, 2]);
eq("parseInputs empty -> []",                G.parseInputs(""), []);

/* ==================================================================
   DETERMINISM
   ================================================================== */
var d1 = JSON.stringify(G.run({ a: [1, 2, 3], b: { c: 4 } }, ".a[] "));
var d2 = JSON.stringify(G.run({ a: [1, 2, 3], b: { c: 4 } }, ".a[] "));
ok("deterministic across two runs", d1 === d2);

/* ==================================================================
   FAIL-CLOSED / SYNTAX
   ================================================================== */
function throws(fn) { try { fn(); return false; } catch (e) { return true; } }
ok("empty filter throws",                    throws(function () { G.parse(""); }));
ok("filter not starting with . throws",      throws(function () { G.parse("foo"); }));
ok("dangling pipe throws",                   throws(function () { G.parse(".a |"); }));
ok("unterminated bracket throws",            throws(function () { G.parse(".["); }));
ok("bad char after dot throws",              throws(function () { G.parse(".a.|"); }));
ok("non-string filter throws",               throws(function () { G.run({}, 5); }));

/* ---- report ------------------------------------------------------ */
console.log("jq-lite battery: " + pass + " passed, " + fail + " failed");
process.exitCode = fail === 0 ? 0 : 1;
