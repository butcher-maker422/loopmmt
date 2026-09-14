#!/usr/bin/env node
/* test_ndjson-source.js — battery for the ndjson-source gift.
   node test_ndjson-source.js  ->  exit 0 PASS / non-zero FAIL. Zero dependencies.

   Cross-checks the gift against an INDEPENDENT reduce-route oracle (a different route than
   the gift's index loop — regex line-split + reduce), frozen hand goldens, the
   canonical-re-serialization contract, blank-line skipping, CRLF handling, determinism,
   and every fail-closed edge (a malformed line, refused with its line number). */
"use strict";
var ns = require("./ndjson-source.js");

var pass = 0, fail = 0;
function ok(name, cond) { if (cond) pass++; else { fail++; console.log("  FAIL  " + name); } }
function eqS(name, a, b) {
  if (a === b) pass++;
  else { fail++; console.log("  FAIL  " + name + "\n    exp " + JSON.stringify(b) + "\n    got " + JSON.stringify(a)); }
}
function throws(name, fn) {
  var threw = false; try { fn(); } catch (e) { threw = true; }
  if (threw) pass++; else { fail++; console.log("  FAIL  " + name + " (expected a throw)"); }
}

/* ---- independent oracle: regex-split + reduce route (different than the gift's loop) ---- */
function oracle(text) {
  return text.split(/\r?\n/).reduce(function (acc, line) {
    if (line.trim() === "") return acc;              // blank lines carry no record
    return acc + JSON.stringify(JSON.parse(line)) + "\n";  // may throw -> caller counts as error
  }, "");
}

/* ---- 1. differential grid: gift == oracle on every good vector ---- */
var good = [
  "",                                          // empty -> empty stream
  "\n\n\n",                                     // all blank -> empty stream
  '{"id":1}\n{"id":2}',                         // objects, no trailing nl
  '{"id":1}\n{"id":2}\n',                       // objects, trailing nl
  "1\n2\n3",                                    // scalars
  '"x"\n"y"\n"z"',                              // string scalars
  "true\nfalse\nnull",                          // literals
  '{"a":1,"b":2}\n{"a":3,"b":4}',              // multi-field records
  '{ "a" : 1 }\n[ 1 , 2 ]',                     // whitespace normalized
  '{"n":1e3}\n[1.0, 100]',                      // number tokens normalized
  '{"b":2,"a":1}',                              // key order preserved from input
  '{"a":1}\n\n{"b":2}\n\n',                     // interior + trailing blank lines skipped
  '{"a":1}\r\n{"b":2}\r\n',                     // CRLF accepted
  '{"nested":{"k":[1,2]}}',                     // nested value verbatim-as-value
  '  {"a":1}  \n\t{"b":2}\t',                   // leading/trailing whitespace on a value line
];
for (var i = 0; i < good.length; i++) {
  eqS("differential[" + i + "] gift==oracle", ns.toJSONL(ns.parse(good[i])), oracle(good[i]));
}

/* ---- 2. hand goldens (frozen) ---- */
eqS("golden: empty -> empty stream", ns.toJSONL(ns.parse("")), "");
eqS("golden: all-blank -> empty stream", ns.toJSONL(ns.parse("\n \n\t\n")), "");
eqS("golden: objects", ns.toJSONL(ns.parse('{"id":1}\n{"id":2}')), '{"id":1}\n{"id":2}\n');
eqS("golden: scalars", ns.toJSONL(ns.parse("1\n2\n3")), "1\n2\n3\n");
eqS("golden: whitespace normalized", ns.toJSONL(ns.parse('{ "a" : 1 }')), '{"a":1}\n');
eqS("golden: number token 1e3 -> 1000", ns.toJSONL(ns.parse("[1e3]")), "[1000]\n");
eqS("golden: number token 1.0 -> 1", ns.toJSONL(ns.parse("[1.0]")), "[1]\n");
eqS("golden: key order preserved", ns.toJSONL(ns.parse('{"b":2,"a":1}')), '{"b":2,"a":1}\n');
eqS("golden: blank lines skipped", ns.toJSONL(ns.parse('{"a":1}\n\n{"b":2}')), '{"a":1}\n{"b":2}\n');
eqS("golden: CRLF stripped", ns.toJSONL(ns.parse('{"a":1}\r\n{"b":2}\r\n')), '{"a":1}\n{"b":2}\n');
eqS("golden: trailing nl same as no trailing nl", ns.toJSONL(ns.parse('{"a":1}\n')), ns.toJSONL(ns.parse('{"a":1}')));

/* ---- 3. one line per non-blank input line ---- */
var recs = ns.parse('{"a":1}\n\n{"a":2}\n{"a":3}\n');
ok("count: 3 values (2 blanks skipped)", recs.length === 3);
ok("lines: JSONL has 3 lines", ns.toJSONL(recs).split("\n").filter(Boolean).length === 3);

/* ---- 4. fail-closed (exit-2 class): a malformed line, with its line number ---- */
throws("bad: malformed line (unterminated)", function () { ns.parse('{"a":1}\n{"a":2'); });
throws("bad: bare word", function () { ns.parse("hello"); });
throws("bad: trailing garbage after a value", function () { ns.parse('{"a":1} oops'); });
throws("bad: two values on one line", function () { ns.parse('{"a":1} {"b":2}'); });
throws("bad: a JSON array top-level is not per-line NDJSON of that array — but a single [..] line IS one value; a broken one throws", function () { ns.parse("[1,2,"); });
throws("bad: non-string input", function () { ns.parse(123); });
// the error names the 1-based line number of the offending line
(function () {
  var msg = "";
  try { ns.parse('{"a":1}\n{"a":2}\nnope'); } catch (e) { msg = e.message; }
  ok("error names the 1-based line number (line 3)", /line 3\b/.test(msg));
})();
// a blank line before the bad line does NOT shift the reported number (line counts raw lines)
(function () {
  var msg = "";
  try { ns.parse('{"a":1}\n\nnope'); } catch (e) { msg = e.message; }
  ok("blank line counted in the line number (line 3)", /line 3\b/.test(msg));
})();

/* ---- 5. determinism: parse twice -> byte-identical JSONL ---- */
var buf = "";
for (var k = 0; k < 50; k++) buf += JSON.stringify({ n: k, s: "v" + k }) + "\n";
ok("determinism: two parses byte-identical", ns.toJSONL(ns.parse(buf)) === ns.toJSONL(ns.parse(buf)));

/* ---- 6. toJSONL shape ---- */
ok("toJSONL: one value per line + trailing nl", ns.toJSONL([{ a: 1 }]) === '{"a":1}\n');
ok("toJSONL: empty -> empty string", ns.toJSONL([]) === "");

/* ---- 7. mutation tripwire A: a canonicalization-dropping mutant must diverge ---- */
(function () {
  // mutant: emits the raw trimmed line instead of the re-serialized value; must diverge on
  // a non-canonical input (whitespace / number token).
  function mutant(text) {
    return text.split("\n").reduce(function (acc, line) {
      if (line.charAt(line.length - 1) === "\r") line = line.slice(0, -1);
      if (line.trim() === "") return acc;
      return acc + line.trim() + "\n";     // raw line, NOT canonical value
    }, "");
  }
  var v = '{ "a" : 1e3 }';
  ok("mutation A: raw-passthrough (skips canonicalization) is CAUGHT",
     mutant(v) !== ns.toJSONL(ns.parse(v)));
})();

/* ---- 8. mutation tripwire B: a skip-the-bad-line mutant must diverge (honesty axis) ---- */
(function () {
  // mutant: silently drops a malformed line instead of throwing; on a bad-line input the
  // gift throws (-> exit 2) while the mutant succeeds. The behavioral divergence is the bite.
  function mutantSkipBad(text) {
    return text.split("\n").reduce(function (acc, line) {
      if (line.trim() === "") return acc;
      try { return acc + JSON.stringify(JSON.parse(line)) + "\n"; }
      catch (e) { return acc; }            // swallow the bad record — dishonest
    }, "");
  }
  var v = '{"a":1}\nBROKEN\n{"b":2}';
  var giftThrew = false;
  try { ns.parse(v); } catch (e) { giftThrew = true; }
  ok("mutation B: skip-bad-line is CAUGHT (gift throws where mutant survives)",
     giftThrew === true && mutantSkipBad(v) === '{"a":1}\n{"b":2}\n');
})();

console.log((fail === 0 ? "PASS" : "FAIL") + "  " + pass + "/" + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
