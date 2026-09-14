#!/usr/bin/env node
/* test_line-source.js — battery for the line-source gift.
   `node test_line-source.js` -> exit 0 PASS / non-zero FAIL.

   The oracle is INDEPENDENT and takes a DIFFERENT ROUTE than the gift: the gift scans
   char codes and slices; the oracle normalizes terminators with a regex then splits and
   drops one trailing empty. Two routes that share no code — agreement is evidence, not
   tautology. Plus frozen hand goldens for each of the three quiet-failure cases the gift
   exists to fix (phantom empty record, CRLF, BOM).
*/
"use strict";

var G = require("./line-source.js");
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

/* ---- independent oracle: regex-normalize route ------------------- */
// Normalize every terminator to \n, strip a leading BOM, then split on \n and drop a
// single trailing empty caused by a final terminator. A different route than the gift's
// char-scan; shares no code with it.
function oracleSplit(text) {
  if (typeof text !== "string") text = String(text == null ? "" : text);
  if (text.length === 0) return [];
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.length === 0) return [];
  var norm = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  var parts = norm.split("\n");
  // a trailing terminator produces a final "" — drop exactly one (terminator, not separator)
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}
function oracleTrim(s) { return s.replace(/^[\s]+|[\s]+$/g, ""); }
function oracleRecords(text, opts) {
  opts = opts || {};
  var field = opts.field === undefined ? "line" : opts.field;
  var index = opts.index === undefined ? "n" : opts.index;
  var raw = oracleSplit(text);
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var v = opts.trim ? oracleTrim(raw[i]) : raw[i];
    if (opts.skipBlank && v.length === 0) continue;
    var rec = {};
    rec[field] = v;
    if (index.length > 0) rec[index] = i;
    out.push(rec);
  }
  return out;
}

/* ---- grid: gift == oracle across many inputs --------------------- */
var inputs = [
  "",
  "\n",
  "a\n",
  "a",
  "a\nb\nc\n",
  "a\nb\nc",
  "a\r\nb\r\nc\r\n",       // CRLF
  "a\rb\rc\r",             // classic-mac lone CR
  "a\r\nb\nc\r",           // mixed
  "\ufeffhello\nworld\n",  // BOM
  "line one\n\nline three\n", // blank in the middle
  "  padded  \n\ttabbed\t\n",
  "no-newline-at-all",
  "\n\n\n",                // three blank lines (terminators only)
  "trailing space \nx",
];
var optsets = [
  {},
  { field: "text" },
  { index: "" },
  { index: "row" },
  { skipBlank: true },
  { trim: true },
  { skipBlank: true, trim: true },
  { field: "L", index: "i", trim: true },
];
for (var a = 0; a < inputs.length; a++) {
  for (var b = 0; b < optsets.length; b++) {
    var got = G.lines(inputs[a], optsets[b]);
    var want = oracleRecords(inputs[a], optsets[b]);
    eq("grid input#" + a + " opts#" + b, got, want);
  }
}

/* ---- hand goldens: the three quiet failures ---------------------- */
// 1. phantom empty record: a trailing newline is a terminator, not a separator
eq("golden: trailing newline -> 2 records not 3",
   G.lines("abc\ndef\n"),
   [{ line: "abc", n: 0 }, { line: "def", n: 1 }]);
eq("golden: no final newline -> still 2 records",
   G.lines("abc\ndef"),
   [{ line: "abc", n: 0 }, { line: "def", n: 1 }]);

// 2. CRLF: terminator stripped, no trailing \r glued on
eq("golden: CRLF stripped clean",
   G.lines("abc\r\ndef\r\n"),
   [{ line: "abc", n: 0 }, { line: "def", n: 1 }]);
ok("golden: no lingering CR in CRLF line",
   G.lines("x\r\ny\r\n")[0].line.indexOf("\r") === -1);

// 3. BOM stripped from first line
eq("golden: leading BOM stripped",
   G.lines("\ufeffalpha\nbeta\n"),
   [{ line: "alpha", n: 0 }, { line: "beta", n: 1 }]);
ok("golden: first line has no BOM char",
   G.lines("\ufeffalpha\n")[0].line.charCodeAt(0) !== 0xfeff);

/* ---- feature goldens --------------------------------------------- */
eq("empty input -> empty stream", G.lines(""), []);
eq("single blank line (just a terminator)", G.lines("\n"), [{ line: "", n: 0 }]);
eq("--index disabled emits no index key",
   G.lines("a\nb\n", { index: "" }),
   [{ line: "a" }, { line: "b" }]);
eq("--skip-blank drops blanks but n keeps source position",
   G.lines("a\n\nc\n", { skipBlank: true }),
   [{ line: "a", n: 0 }, { line: "c", n: 2 }]);
eq("--trim strips surrounding whitespace",
   G.lines("  hi  \n\tbye\t\n", { trim: true }),
   [{ line: "hi", n: 0 }, { line: "bye", n: 1 }]);
eq("without --trim bytes are preserved",
   G.lines("  hi  \n", {}),
   [{ line: "  hi  ", n: 0 }]);
eq("custom field + index names",
   G.lines("x\n", { field: "text", index: "row" }),
   [{ text: "x", row: 0 }]);

// JSONL rendering
ok("toJSONL ends every record with newline",
   G.toJSONL([{ line: "a", n: 0 }]) === '{"line":"a","n":0}\n');
ok("toJSONL of empty is empty string", G.toJSONL([]) === "");

/* ---- determinism ------------------------------------------------- */
var d1 = G.toJSONL(G.lines("a\nb\r\nc\r", {}));
var d2 = G.toJSONL(G.lines("a\nb\r\nc\r", {}));
ok("deterministic across two runs", d1 === d2);

/* ---- fail-closed edges ------------------------------------------- */
function throws(fn) { try { fn(); return false; } catch (e) { return true; } }
ok("empty --field throws", throws(function () { G.lines("a\n", { field: "" }); }));
ok("non-string --index throws", throws(function () { G.lines("a\n", { index: 5 }); }));

/* ---- report ------------------------------------------------------ */
console.log("line-source battery: " + pass + " passed, " + fail + " failed");
process.exitCode = fail === 0 ? 0 : 1;
