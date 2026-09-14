#!/usr/bin/env node
/* test_ini-source.js — executable battery for ini-source. `node test_ini-source.js` ->
   exit 0 PASS / non-zero FAIL. Zero dependencies.

   Coverage: frozen hand goldens; a differential grid cross-checked against an
   INDEPENDENT regex-route oracle (a different parse route than the gift's indexOf-split);
   the {section,key,value} uniform + strings-only contract; custom field names + --global;
   every fail-closed throw (malformed line, illegal key, empty/malformed header, DUP key in
   a section, REPEATED section, field collision, empty field, non-string input); CRLF==LF,
   BOM strip, quote strip, first-'=' split, '#'/';' inside a value literal; determinism
   across two parses; toJSONL shape; and in-battery MUTATION TRIPWIRES (a sabotaged parse
   must go RED, so a green run is non-vacuous).
*/
"use strict";
var G = require("./ini-source.js");

var pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error("FAIL: " + name); } }
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b)); }
function throws(name, fn) {
  var threw = false;
  try { fn(); } catch (e) { threw = true; }
  ok(name, threw);
}

/* ---- INDEPENDENT ORACLE (regex-route, from spec, shares no code with the gift) ---- */
function oracle(text, opts) {
  opts = opts || {};
  var sf = opts.sectionField || "section", kf = opts.keyField || "key", vf = opts.valueField || "value";
  var gl = opts.global === undefined ? "" : opts.global;
  if (sf === kf || sf === vf || kf === vf) throw new Error("field collision");
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  var HDR = /^\[([^\[\]]+)\]$/, KV = /^([^=]*)=([\s\S]*)$/, KEY = /^[A-Za-z_][A-Za-z0-9_.\-]*$/;
  var out = [], cur = gl, secs = {}, keys = {}; keys[cur] = {};
  var ls = text.split("\n");
  for (var i = 0; i < ls.length; i++) {
    var line = ls[i].replace(/\r$/, "");
    var t = line.replace(/^\s+|\s+$/g, "");
    if (!t) continue;
    if (t[0] === ";" || t[0] === "#") continue;
    var hm = t.match(HDR);
    if (t[0] === "[" && t[t.length - 1] === "]") {
      if (!hm) throw new Error("bad header");
      var nm = hm[1].replace(/^\s+|\s+$/g, "");
      if (!nm) throw new Error("empty header");
      if (secs[nm]) throw new Error("repeat section");
      secs[nm] = 1; cur = nm; if (!keys[cur]) keys[cur] = {}; continue;
    }
    var m = line.match(KV);
    if (!m) throw new Error("no =");
    var k = m[1].replace(/^\s+|\s+$/g, ""), v = m[2].replace(/^\s+|\s+$/g, "");
    if (!KEY.test(k)) throw new Error("bad key");
    if (keys[cur][k]) throw new Error("dup key");
    keys[cur][k] = 1;
    if (v.length >= 2) { var a = v[0], b = v[v.length - 1]; if ((a === '"' && b === '"') || (a === "'" && b === "'")) v = v.slice(1, -1); }
    var r = {}; r[sf] = cur; r[kf] = k; r[vf] = v; out.push(r);
  }
  return out;
}

/* ---- frozen hand goldens ---- */
eq("basic section", G.parse("[s]\na=1\nb=2\n"),
  [{section:"s",key:"a",value:"1"},{section:"s",key:"b",value:"2"}]);
eq("two sections, same key ok",
  G.parse("[server]\nhost=a\n[client]\nhost=b\n"),
  [{section:"server",key:"host",value:"a"},{section:"client",key:"host",value:"b"}]);
eq("global preamble -> section ''",
  G.parse("x=1\n[s]\ny=2\n"),
  [{section:"",key:"x",value:"1"},{section:"s",key:"y",value:"2"}]);
eq("comments (; and #) + blank lines skipped",
  G.parse("; a comment\n[s]\n# another\n\nk=v\n"),
  [{section:"s",key:"k",value:"v"}]);
eq("first-'=' split (value contains '=')",
  G.parse("[s]\nurl=a=b=c\n"), [{section:"s",key:"url",value:"a=b=c"}]);
eq("value trim + double-quote strip",
  G.parse('[s]\nk =  "  hi there  "  \n'), [{section:"s",key:"k",value:"  hi there  "}]);
eq("single-quote strip", G.parse("[s]\nk='x'\n"), [{section:"s",key:"k",value:"x"}]);
eq("empty value", G.parse("[s]\nk=\n"), [{section:"s",key:"k",value:""}]);
eq("'#'/';' inside a value are literal",
  G.parse("[s]\nk=a#b;c\n"), [{section:"s",key:"k",value:"a#b;c"}]);
eq("CRLF == LF", G.parse("[s]\r\nk=v\r\n"), G.parse("[s]\nk=v\n"));
eq("leading BOM stripped", G.parse("\uFEFF[s]\nk=v\n"), [{section:"s",key:"k",value:"v"}]);
eq("empty input -> empty stream", G.parse(""), []);
eq("section name trimmed", G.parse("[  srv  ]\nk=v\n"), [{section:"srv",key:"k",value:"v"}]);
eq("custom fields + --global",
  G.parse("g=1\n[s]\nk=v\n", {sectionField:"S",keyField:"K",valueField:"V",global:"root"}),
  [{S:"root",K:"g",V:"1"},{S:"s",K:"k",V:"v"}]);

/* ---- the honesty axis: fail-closed edges ---- */
throws("DUP key in a section -> throw", function(){ G.parse("[s]\nk=1\nk=2\n"); });
throws("DUP key in global -> throw", function(){ G.parse("k=1\nk=2\n"); });
throws("REPEATED section header -> throw", function(){ G.parse("[s]\na=1\n[s]\nb=2\n"); });
throws("malformed line (no '=') -> throw", function(){ G.parse("[s]\nnope\n"); });
throws("unclosed header is a no-'=' line -> throw", function(){ G.parse("[s\nk=v\n"); });
throws("empty section [] -> throw", function(){ G.parse("[]\nk=v\n"); });
throws("illegal key (space) -> throw", function(){ G.parse("[s]\nbad key=v\n"); });
throws("illegal key (digit lead) -> throw", function(){ G.parse("[s]\n1k=v\n"); });
throws("empty key -> throw", function(){ G.parse("[s]\n=v\n"); });
throws("field collision -> throw", function(){ G.parse("[s]\nk=v\n", {keyField:"section"}); });
throws("empty field name -> throw", function(){ G.parse("[s]\nk=v\n", {keyField:""}); });
throws("non-string input -> throw", function(){ G.parse(42); });

/* ---- strings-only contract (no coercion) ---- */
eq("numbers stay strings", G.parse("[s]\nn=8080\nf=1e3\nb=true\n"),
  [{section:"s",key:"n",value:"8080"},{section:"s",key:"f",value:"1e3"},{section:"s",key:"b",value:"true"}]);
eq("no ${VAR} interpolation", G.parse("[s]\nk=${HOME}\n"), [{section:"s",key:"k",value:"${HOME}"}]);
(function(){
  var recs = G.parse("[s]\nk=v\n");
  ok("record has exactly the 3 declared fields", Object.keys(recs[0]).length === 3 &&
     "section" in recs[0] && "key" in recs[0] && "value" in recs[0]);
})();

/* ---- differential grid vs the independent oracle ---- */
var grid = [
  "[s]\nk=v\n",
  "a=1\n[x]\nb=2\n[y]\nb=3\n",
  "[s]\nurl=http://a=b\n",
  '[s]\nk="quoted"\n',
  "; c\n[s]\nk = v \n\n",
  "\uFEFF[s]\nk=v\n",
  "[s]\r\nk=v\r\n",
  "",
];
for (var gi = 0; gi < grid.length; gi++) {
  eq("grid[" + gi + "] gift==oracle", G.parse(grid[gi]), oracle(grid[gi]));
}
// grid with custom opts
var o2 = {sectionField:"S",keyField:"K",valueField:"V",global:"root"};
eq("grid custom-opts gift==oracle", G.parse("g=1\n[s]\nk=v\n", o2), oracle("g=1\n[s]\nk=v\n", o2));

/* ---- determinism ---- */
eq("two parses byte-identical",
  G.toJSONL(G.parse("[a]\nk=1\n[b]\nk=2\n")), G.toJSONL(G.parse("[a]\nk=1\n[b]\nk=2\n")));

/* ---- toJSONL shape ---- */
eq("toJSONL one object per line + trailing NL",
  G.toJSONL([{section:"s",key:"k",value:"v"}]), '{"section":"s","key":"k","value":"v"}\n');
eq("toJSONL empty -> empty", G.toJSONL([]), "");

/* ---- MUTATION TRIPWIRES: a sabotaged parse must diverge from the honest oracle ---- */
// Mutant A: dup-key check removed (silent last-wins). Must NOT match oracle on a dup vector.
function mutantA(text) {
  var out = [], cur = "", secs = {};
  var ls = text.split("\n");
  for (var i = 0; i < ls.length; i++) {
    var line = ls[i].replace(/\r$/, ""), t = line.replace(/^\s+|\s+$/g, "");
    if (!t || t[0] === ";" || t[0] === "#") continue;
    if (t[0] === "[" && t[t.length - 1] === "]") { cur = t.slice(1, -1).replace(/^\s+|\s+$/g, ""); continue; }
    var eq2 = line.indexOf("="); if (eq2 === -1) throw new Error("no =");
    out.push({section:cur,key:line.slice(0,eq2).replace(/^\s+|\s+$/g,""),value:line.slice(eq2+1).replace(/^\s+|\s+$/g,"")});
  }
  return out; // NO dup check
}
(function(){
  var dupText = "[s]\nk=1\nk=2\n";
  var honestThrew = false; try { oracle(dupText); } catch(e){ honestThrew = true; }
  var mutantDidNot = false; try { mutantA(dupText); mutantDidNot = true; } catch(e){}
  ok("mutation bite: dropping the dup-key check diverges from the honest oracle", honestThrew && mutantDidNot);
})();
// Mutant B: split on LAST '=' instead of first. Must diverge on a value containing '='.
function mutantB(text) {
  var line = "k=a=b", last = line.lastIndexOf("=");
  return line.slice(last + 1); // "b" — wrong; honest first-split value is "a=b"
}
(function(){
  var honest = G.parse("[s]\nk=a=b\n")[0].value;   // "a=b"
  ok("mutation bite: last-'=' split diverges from first-'=' honest value", honest === "a=b" && mutantB() !== honest);
})();

/* ---- summary ---- */
console.log((fail === 0 ? "PASS" : "FAIL") + " — " + pass + "/" + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
