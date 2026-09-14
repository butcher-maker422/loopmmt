#!/usr/bin/env node
/* test_csv-source.js — out-of-band battery for the csv-source gift.

   Cross-checks parse() against an INDEPENDENT oracle — a from-spec second parser that
   walks the text as a small explicit state machine written a different way (a
   two-state {FIELD, QUOTED} scanner accumulating rows, no shared code with the gift's
   tokenizer) — plus hand goldens and every documented honesty edge (ragged rows,
   duplicate/empty headers, quotes, CRLF, embedded commas/newlines, --no-header,
   --fill, --delim). Node only; no dependencies. Exit 0 all-pass / 1 fail.
*/
"use strict";
var cs = require("./csv-source.js");

var pass = 0, fail = 0;
function check(name, cond) { if (cond) pass++; else { fail++; console.log("  FAIL  " + name); } }
function J(v) { return JSON.stringify(v); }
function threw(fn) { try { fn(); return false; } catch (e) { return true; } }

/* ---- independent oracle: a differently-written state machine -------------
   Rows of string fields, then keyed the same way parse() keys them. This scanner
   is deliberately structured unlike the gift (explicit state enum, different quote
   handling, different newline normalisation) so agreement means the grammar is right,
   not that one copy was pasted into two files. */
function oracleRows(text, delim) {
  var FIELD = 0, QUOTED = 1;
  var state = FIELD;
  var rows = [], cur = [], buf = "";
  // normalise CRLF/CR -> LF up front (a different route than the gift's inline swallow)
  var t = text.replace(/\r\n?/g, "\n");
  var used = false;
  for (var i = 0; i < t.length; i++) {
    var ch = t[i];
    if (state === QUOTED) {
      if (ch === '"') {
        if (t[i + 1] === '"') { buf += '"'; i++; }
        else state = FIELD;
      } else buf += ch;
      continue;
    }
    // FIELD
    if (ch === '"') {
      if (buf.length !== 0) throw new Error("oracle: stray quote");
      state = QUOTED; used = true;
    } else if (ch === delim) { cur.push(buf); buf = ""; used = true; }
    else if (ch === "\n") { cur.push(buf); buf = ""; rows.push(cur); cur = []; used = false; }
    else { buf += ch; used = true; }
  }
  if (state === QUOTED) throw new Error("oracle: unterminated quote");
  if (used || buf.length !== 0 || cur.length !== 0) { cur.push(buf); rows.push(cur); }
  return rows;
}
function oracleParse(text, opts) {
  opts = opts || {};
  var header = opts.header === undefined ? true : !!opts.header;
  var fill = opts.fill;
  var delim = opts.delim === undefined ? "," : opts.delim;
  var rows = oracleRows(text, delim);
  if (rows.length === 0) return [];
  var names, start;
  if (header) {
    names = rows[0].slice(); start = 1;
    var seen = {};
    names.forEach(function (nm, idx) {
      if (nm === "") throw new Error("oracle: empty header");
      if (seen[nm]) throw new Error("oracle: dup header"); seen[nm] = true;
    });
  } else {
    names = rows[0].map(function (_, k) { return "c" + k; }); start = 0;
  }
  var w = names.length, out = [];
  for (var r = start; r < rows.length; r++) {
    var cells = rows[r].slice();
    if (cells.length > w) throw new Error("oracle: too many");
    while (cells.length < w) { if (fill === undefined) throw new Error("oracle: too few"); cells.push(fill); }
    var rec = {};
    for (var c = 0; c < w; c++) rec[names[c]] = cells[c];
    out.push(rec);
  }
  return out;
}
function giftJSONL(text, opts) { return cs.toJSONL(cs.parse(text, opts)); }
function oracleJSONL(text, opts) { return cs.toJSONL(oracleParse(text, opts)); }

/* ---- gift == independent oracle across a grid ---------------------------- */
var grid = [
  { t: "name,age\nada,36\ngrace,41\n" },
  { t: "name,age\nada,36\ngrace,41" },                          // no trailing newline
  { t: "a,b,c\n1,2,3\n4,5,6\n" },
  { t: "q\n\"hello, world\"\n\"line\none\"\n" },                // embedded comma + newline
  { t: "q\n\"she said \"\"hi\"\"\"\n" },                        // escaped quotes
  { t: "x,y\r\n1,2\r\n3,4\r\n" },                               // CRLF
  { t: "only\nrow\n" },                                          // single column
  { t: "name,age\nada,36\n", o: { header: true } },
  { t: "ada,36\ngrace,41\n", o: { header: false } },            // --no-header
  { t: "a;b\n1;2\n", o: { delim: ";" } },                       // custom delim
  { t: "name,age\nada,\n,41\n" },                               // empty values
  { t: "" },                                                     // empty input
  { t: "\n" }                                                    // one empty line
];
function settle(fn) { try { return { ok: true, v: fn() }; } catch (e) { return { ok: false, e: String(e.message) }; } }
grid.forEach(function (g) {
  var o = g.o;
  var gi = settle(function () { return giftJSONL(g.t, o); });
  var or = settle(function () { return oracleJSONL(g.t, o); });
  // Agreement = both produced the same bytes, OR both refused (a structural error on
  // both routes is the same verdict — the gift and the oracle agree the input is bad).
  var agree = (gi.ok && or.ok && gi.v === or.v) || (!gi.ok && !or.ok);
  check("gift == oracle [" + J(g.t.slice(0, 24)) + (g.t.length > 24 ? "..." : "") + "]", agree);
});

/* ---- hand goldens -------------------------------------------------------- */
check("golden: simple header",
  giftJSONL("name,age\nada,36\ngrace,41\n") ===
  '{"name":"ada","age":"36"}\n{"name":"grace","age":"41"}\n');
check("golden: values stay strings (no type inference)",
  giftJSONL("v\n36\ntrue\n\n") === '{"v":"36"}\n{"v":"true"}\n{"v":""}\n');
check("golden: embedded comma in quotes",
  giftJSONL("a,b\n\"x,y\",z\n") === '{"a":"x,y","b":"z"}\n');
check("golden: embedded newline in quotes",
  giftJSONL("a\n\"one\ntwo\"\n") === '{"a":"one\\ntwo"}\n');
check("golden: escaped quote \"\" -> \"",
  giftJSONL("a\n\"he said \"\"hi\"\"\"\n") === '{"a":"he said \\"hi\\""}\n');
check("golden: --no-header keys c0,c1",
  giftJSONL("ada,36\n", { header: false }) === '{"c0":"ada","c1":"36"}\n');
check("golden: --delim ;",
  giftJSONL("a;b\n1;2\n", { delim: ";" }) === '{"a":"1","b":"2"}\n');
check("golden: --fill pads short row",
  giftJSONL("a,b,c\n1,2\n", { fill: "" }) === '{"a":"1","b":"2","c":""}\n');
check("golden: whitespace NOT trimmed",
  giftJSONL("a,b\n x , y \n") === '{"a":" x ","b":" y "}\n');
check("golden: CRLF handled == LF",
  giftJSONL("a,b\r\n1,2\r\n") === giftJSONL("a,b\n1,2\n"));

/* ---- empty input -> empty stream ----------------------------------------- */
check("empty input -> empty string", giftJSONL("") === "");
check("empty input -> parse returns []", J(cs.parse("")) === J([]));
check("header only, no data rows -> empty stream", giftJSONL("a,b,c\n") === "");

/* ---- ragged rows fail closed --------------------------------------------- */
check("ragged: too few fields throws (no --fill)", threw(function () { cs.parse("a,b,c\n1,2\n"); }));
check("ragged: too many fields throws", threw(function () { cs.parse("a,b\n1,2,3\n"); }));
check("ragged: too many still throws even with --fill", threw(function () { cs.parse("a,b\n1,2,3\n", { fill: "" }); }));
check("ragged: --fill rescues short row (no throw)", !threw(function () { cs.parse("a,b,c\n1,2\n", { fill: "" }); }));

/* ---- header honesty ------------------------------------------------------ */
check("duplicate header name throws", threw(function () { cs.parse("a,a\n1,2\n"); }));
check("empty header name throws", threw(function () { cs.parse("a,,c\n1,2,3\n"); }));
check("--no-header allows duplicate-looking data (keys are positional)",
  !threw(function () { cs.parse("1,1\n2,2\n", { header: false }); }));

/* ---- quote honesty ------------------------------------------------------- */
check("unterminated quoted field throws", threw(function () { cs.parse("a\n\"open\n"); }));
check("stray quote in unquoted field throws", threw(function () { cs.parse("a\nx\"y\n"); }));

/* ---- delimiter honesty --------------------------------------------------- */
check("--delim multi-char throws", threw(function () { cs.parse("a,b\n1,2\n", { delim: ",," }); }));
check("--delim quote throws", threw(function () { cs.parse("a\n1\n", { delim: '"' }); }));
check("--delim newline throws", threw(function () { cs.parse("a\n1\n", { delim: "\n" }); }));

/* ---- determinism --------------------------------------------------------- */
(function () {
  var text = "name,age,city\nada,36,london\ngrace,41,\"new york, ny\"\n";
  check("deterministic across two parse() calls", giftJSONL(text) === giftJSONL(text));
})();

/* ---- single-object-per-row shape (composition contract) ------------------ */
(function () {
  var recs = cs.parse("k,v\nx,1\ny,2\n");
  check("one object per data row", recs.length === 2);
  check("objects keyed by header", J(recs) === J([{ k: "x", v: "1" }, { k: "y", v: "2" }]));
})();

/* ---- report -------------------------------------------------------------- */
console.log((fail === 0 ? "PASS" : "FAIL") + "  csv-source battery: " + pass + "/" + (pass + fail));
process.exitCode = fail === 0 ? 0 : 1;
