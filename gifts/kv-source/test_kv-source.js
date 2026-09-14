#!/usr/bin/env node
/* test_kv-source.js — battery for the kv-source gift.
   node test_kv-source.js  ->  exit 0 PASS / non-zero FAIL. Zero dependencies.

   Cross-checks the gift against an INDEPENDENT regex-route oracle (a different parse
   route than the gift's indexOf-split), frozen hand goldens, the uniform-record and
   strings-only contract, determinism, and every fail-closed edge. */
"use strict";
var kv = require("./kv-source.js");

var pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.log("  FAIL  " + name); } }
function eq(name, a, b) {
  var same = JSON.stringify(a) === JSON.stringify(b);
  if (!same) console.log("  FAIL  " + name + "\n    exp " + JSON.stringify(b) + "\n    got " + JSON.stringify(a));
  else pass++;
  if (!same) fail++;
}
function throws(name, fn) {
  var threw = false;
  try { fn(); } catch (e) { threw = true; }
  if (threw) pass++; else { fail++; console.log("  FAIL  " + name + " (expected a throw)"); }
}

/* ---- independent oracle: regex-route (different route than the gift) ---- */
function oracle(text, opts) {
  opts = opts || {};
  var kf = opts.keyField === undefined ? "key" : opts.keyField;
  var vf = opts.valueField === undefined ? "value" : opts.valueField;
  if (!kf || !vf || kf === vf) throw new Error("bad fields");
  var out = [];
  var lines = text.split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i];
    if (/^\s*$/.test(ln)) continue;
    if (/^\s*#/.test(ln)) continue;
    var m = ln.match(/^\s*([A-Za-z_][A-Za-z0-9_.\-]*)\s*=([\s\S]*)$/);
    if (!m) throw new Error("bad line " + (i + 1));
    var val = m[2].replace(/^\s+/, "").replace(/\s+$/, "");
    if (val.length >= 2) {
      var a = val.charAt(0), b = val.charAt(val.length - 1);
      if ((a === '"' && b === '"') || (a === "'" && b === "'")) val = val.slice(1, val.length - 1);
    }
    var r = {}; r[kf] = m[1]; r[vf] = val; out.push(r);
  }
  return out;
}

/* ---- 1. differential grid: gift == oracle on every good vector ---- */
var goodVectors = [
  "PORT=8080",
  "A=1\nB=2\nC=3",
  "# a comment\nHOST=localhost\n\n# another\nPORT=80",
  "  SPACED  =  value here  ",              // trim both sides
  'GREETING="hi there"',                     // double-quoted, embedded space
  "MSG='single quoted'",
  "URL=http://example.com/path?a=b&c=d",     // first-= split; value keeps later '='
  "EMPTY=",                                  // empty value -> ""
  "HASHVAL=a#b#c",                           // '#' inside a value is literal (no inline comments)
  "K.dotted=1\nk-dashed=2\n_under=3",        // legal key charset
  "Q=\"with = and # inside\"",               // quotes protect nothing special but are stripped
  "CRLF=one\r\nSECOND=two\r\n",              // CRLF parses same as LF
  "",                                        // empty input -> empty stream
  "\n\n   \n# only comments and blanks\n",   // -> empty stream
  "EQ====",                                  // key EQ, value "===" (first '=' splits)
];
for (var gi = 0; gi < goodVectors.length; gi++) {
  var t = goodVectors[gi];
  eq("differential[" + gi + "] gift==oracle", kv.parse(t), oracle(t));
}

/* ---- 2. hand goldens (frozen) ---- */
eq("golden: basic", kv.parse("PORT=8080"), [{ key: "PORT", value: "8080" }]);
eq("golden: three", kv.parse("A=1\nB=2\nC=3"),
   [{ key: "A", value: "1" }, { key: "B", value: "2" }, { key: "C", value: "3" }]);
eq("golden: comment+blank skipped", kv.parse("# c\n\nHOST=localhost"), [{ key: "HOST", value: "localhost" }]);
eq("golden: trim both sides", kv.parse("  K  =  v  "), [{ key: "K", value: "v" }]);
eq("golden: double-quote stripped", kv.parse('G="hi there"'), [{ key: "G", value: "hi there" }]);
eq("golden: single-quote stripped", kv.parse("G='hi there'"), [{ key: "G", value: "hi there" }]);
eq("golden: first-= split keeps rest", kv.parse("U=a=b=c"), [{ key: "U", value: "a=b=c" }]);
eq("golden: empty value", kv.parse("E="), [{ key: "E", value: "" }]);
eq("golden: hash in value literal", kv.parse("H=a#b"), [{ key: "H", value: "a#b" }]);
eq("golden: CRLF == LF", kv.parse("A=1\r\nB=2\r\n"), kv.parse("A=1\nB=2\n"));
eq("golden: empty input empty stream", kv.parse(""), []);
eq("golden: only comments/blanks empty", kv.parse("\n#x\n   \n"), []);

/* ---- 3. uniform 2-field, strings-only ---- */
var recs = kv.parse("N=8080\nB=true\nF=1.5\nZ=");
ok("uniform: every record has exactly 2 keys", recs.every(function (r) { return Object.keys(r).length === 2; }));
ok("uniform: fields are key+value", recs.every(function (r) { return "key" in r && "value" in r; }));
ok("strings-only: numbers stay strings", recs[0].value === "8080" && typeof recs[0].value === "string");
ok("strings-only: bool stays string", recs[1].value === "true" && typeof recs[1].value === "string");
ok("strings-only: float stays string (no coercion/drift)", recs[2].value === "1.5" && typeof recs[2].value === "string");

/* ---- 4. custom field names ---- */
eq("fields: custom names", kv.parse("A=1", { keyField: "name", valueField: "val" }), [{ name: "A", val: "1" }]);
eq("fields: order key then value", Object.keys(kv.parse("A=1", { keyField: "k2", valueField: "v2" })[0]), ["k2", "v2"]);

/* ---- 5. no interpolation / no export / no inline comment ---- */
eq("no interpolation: ${VAR} literal", kv.parse("A=${HOME}/bin"), [{ key: "A", value: "${HOME}/bin" }]);
eq("no inline comment: trailing # kept", kv.parse("A=v # not a comment"), [{ key: "A", value: "v # not a comment" }]);
throws("no export: `export FOO` is an illegal key", function () { kv.parse("export FOO=bar"); });

/* ---- 6. fail-closed (exit-2 class) ---- */
throws("bad: line with no '='", function () { kv.parse("JUST_A_LINE"); });
throws("bad: empty key", function () { kv.parse("=value"); });
throws("bad: key with space", function () { kv.parse("bad key=1"); });
throws("bad: key starts with digit", function () { kv.parse("9key=1"); });
throws("bad: key with illegal char", function () { kv.parse("k!=1"); });
throws("bad: key-field == value-field", function () { kv.parse("A=1", { keyField: "x", valueField: "x" }); });
throws("bad: empty key-field", function () { kv.parse("A=1", { keyField: "" }); });
throws("bad: empty value-field", function () { kv.parse("A=1", { valueField: "" }); });
throws("bad: non-string input", function () { kv.parse(123); });

/* ---- 7. determinism: parse twice -> byte-identical JSONL ---- */
var big = "";
for (var k = 0; k < 50; k++) big += "K" + k + "=v" + k + "\n";
ok("determinism: two parses byte-identical", kv.toJSONL(kv.parse(big)) === kv.toJSONL(kv.parse(big)));

/* ---- 8. toJSONL shape ---- */
ok("toJSONL: one object per line + trailing nl", kv.toJSONL([{ key: "A", value: "1" }]) === '{"key":"A","value":"1"}\n');
ok("toJSONL: empty records -> empty string", kv.toJSONL([]) === "");

/* ---- 9. mutation tripwire: a LAST-'=' split must diverge on a value containing '=' ---- */
(function () {
  function mutantLastEq(text) {
    var out = [], lines = text.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.charAt(line.length - 1) === "\r") line = line.slice(0, -1);
      var tr = line.replace(/^\s+|\s+$/g, "");
      if (!tr || tr.charAt(0) === "#") continue;
      var eqp = line.lastIndexOf("=");                 // BUG: last instead of first
      if (eqp === -1) throw new Error("no =");
      var key = line.slice(0, eqp).replace(/^\s+|\s+$/g, "");
      var val = line.slice(eqp + 1).replace(/^\s+|\s+$/g, "");
      var r = {}; r.key = key; r.value = val; out.push(r);
    }
    return out;
  }
  var v = "U=a=b";
  ok("mutation: last-= split is CAUGHT (diverges from gift)",
     JSON.stringify(mutantLastEq(v)) !== JSON.stringify(kv.parse(v)));
})();

console.log((fail === 0 ? "PASS" : "FAIL") + "  " + pass + "/" + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
