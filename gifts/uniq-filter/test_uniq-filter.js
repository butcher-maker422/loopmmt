#!/usr/bin/env node
/* test_uniq-filter.js — golden battery for the uniq-filter gift.

   Out-of-band and self-verifying. The oracle is TWO independent things, neither a
   copy of the gift's canonical-string comparison:

     (1) A NAIVE reference — walk the records in order, keeping a record only if it
         is NOT structurally deep-equal to the PREVIOUS kept record (default mode),
         or does not share the previous kept record's key-field value (--key mode).
         deepEqual is written independently here (recursive, key-set compare); it
         does NOT canonicalize to a string, so it is a genuinely different way to
         decide "same record" than the gift's canon(). The two must agree on which
         lines survive.

     (2) FROZEN hand-picked golden outputs pinned from the spec — the
         adjacent-vs-global case (§1: A A B A -> A B A), object-key-order (§2),
         array-order sensitivity (§3), --key adjacency first-of-run (§4), and the
         missing-key breaks-the-run passthrough (§5).

   A planted mutation (the bite, §9) MUST be caught — if the suite passes with the
   mutation live, the suite proves nothing.

   Run:  node test_uniq-filter.js   -> exit 0 GREEN / non-zero RED
*/
"use strict";
var uf = require("./uniq-filter.js");

var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.log("  FAIL  " + name); }
}
function J(v) { return JSON.stringify(v); }
function keptLines(records, opts) { return uf.filter(records.join("\n"), opts).lines; }

/* ---- independent recursive deep-equal (NOT canon-string) ------------------ */
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object" || typeof b !== "object") return a === b;
  var aArr = Array.isArray(a), bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  var ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (var j = 0; j < ak.length; j++) {
    if (!Object.prototype.hasOwnProperty.call(b, ak[j])) return false;
    if (!deepEqual(a[ak[j]], b[ak[j]])) return false;
  }
  return true;
}

// naive adjacent-collapse oracle: returns the kept lines (strings), comparing only
// to the previous KEPT record. A missing --key field always breaks the run.
var MISSING = {};
function fieldKey(rec, keyField) {
  if (keyField === undefined) return { kind: "rec", val: rec };
  if (rec !== null && typeof rec === "object" && !Array.isArray(rec) &&
      Object.prototype.hasOwnProperty.call(rec, keyField)) {
    return { kind: "val", val: rec[keyField] };
  }
  return { kind: "missing", val: MISSING };
}
function oracleKept(records, keyField) {
  var out = [];
  var havePrev = false, prevKind = null, prevVal = null;
  for (var i = 0; i < records.length; i++) {
    var line = records[i];
    if (line.length === 0) continue;
    var rec = JSON.parse(line);
    var fk = fieldKey(rec, keyField);
    var same = false;
    if (havePrev && fk.kind !== "missing" && prevKind !== "missing" && fk.kind === prevKind) {
      same = deepEqual(fk.val, prevVal);
    }
    if (same) continue; // collapse into the current run
    out.push(line);
    havePrev = true; prevKind = fk.kind; prevVal = fk.val;
  }
  return out;
}

function agree(name, records, opts) {
  var got = keptLines(records, opts);
  var want = oracleKept(records, opts && opts.key);
  ok(name + " [gift==oracle]", J(got) === J(want));
}

/* ===================== §1 adjacent, not global ============================== */
// A A B A  ->  A B A  (the trailing A is a NEW run: a B broke it)
(function () {
  var r = ['{"v":"a"}', '{"v":"a"}', '{"v":"b"}', '{"v":"a"}'];
  ok("§1 adjacent collapse, far-apart kept",
     J(keptLines(r)) === J(['{"v":"a"}', '{"v":"b"}', '{"v":"a"}']));
  agree("§1 vs oracle", r);
  // collapsed count = 1 (only the immediate repeat)
  ok("§1 collapsed count", uf.filter(r.join("\n")).collapsed === 1);
})();

/* ===================== §2 object key-order ignored ========================== */
(function () {
  var r = ['{"a":1,"b":2}', '{"b":2,"a":1}', '{"a":1,"b":3}'];
  // first two are the same record (key-order); third differs
  ok("§2 key-order collapse", J(keptLines(r)) === J(['{"a":1,"b":2}', '{"a":1,"b":3}']));
  agree("§2 vs oracle", r);
})();

/* ===================== §3 array order IS meaningful ========================= */
(function () {
  var r = ['[1,2]', '[2,1]', '[2,1]'];
  // [1,2] != [2,1]; the two [2,1] are adjacent-equal -> collapse
  ok("§3 array order kept", J(keptLines(r)) === J(['[1,2]', '[2,1]']));
  agree("§3 vs oracle", r);
})();

/* ===================== §4 --key adjacency, first-of-run ===================== */
(function () {
  var r = ['{"id":1,"v":"a"}', '{"id":1,"v":"b"}', '{"id":2,"v":"c"}', '{"id":1,"v":"d"}'];
  // by id: run of id=1 (first kept verbatim), then id=2, then a NEW id=1 run
  ok("§4 --key first-of-run + adjacency",
     J(keptLines(r, { key: "id" })) === J(['{"id":1,"v":"a"}', '{"id":2,"v":"c"}', '{"id":1,"v":"d"}']));
  agree("§4 vs oracle", r, { key: "id" });
})();

/* ===================== §5 missing --key breaks the run ====================== */
(function () {
  var r = ['{"id":1}', '{"x":9}', '{"x":9}', '{"id":1}'];
  // by id: id=1 kept; {"x":9} has no id -> kept (breaks run); next {"x":9} also
  // missing -> a missing key is never equal to another missing key -> kept; id=1 kept.
  ok("§5 missing-key never collapses",
     J(keptLines(r, { key: "id" })) === J(['{"id":1}', '{"x":9}', '{"x":9}', '{"id":1}']));
  agree("§5 vs oracle", r, { key: "id" });
})();

/* ===================== §6 blank lines / CRLF / verbatim ===================== */
(function () {
  var text = '{"v":1}\r\n{"v":1}\r\n\r\n{"v":2}\r\n';
  var got = uf.filter(text).lines;
  // CRLF trimmed before parse; blank skipped; kept bodies have no trailing \r
  ok("§6 crlf+blank", J(got) === J(['{"v":1}', '{"v":2}']));
})();

/* ===================== §7 non-object with --key passes ====================== */
(function () {
  var r = ['5', '5', '"x"', '"x"'];
  // --key on bare values: no field -> every record breaks the run -> all kept
  ok("§7 --key on non-objects keeps all",
     J(keptLines(r, { key: "id" })) === J(['5', '5', '"x"', '"x"']));
  // default mode: adjacent equal bare values DO collapse
  ok("§7 default collapses bare values", J(keptLines(r)) === J(['5', '"x"']));
})();

/* ===================== §8 input honesty: invalid JSON throws ================ */
(function () {
  var threw = false;
  try { uf.filter('{"v":1}\nnot json\n'); } catch (e) { threw = /line 2/.test(e.message); }
  ok("§8 invalid JSON is a hard error naming the line", threw);
})();

/* ===================== §9 the bite (non-vacuity) =========================== */
// Re-implement the gift's core with a GLOBAL seen-set (the classic wrong turn:
// making uniq behave like dedup). The battery MUST reject it, or it proves nothing.
(function () {
  function canonLocal(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(canonLocal).join(",") + "]";
    var ks = Object.keys(v).sort();
    return "{" + ks.map(function (k) { return JSON.stringify(k) + ":" + canonLocal(v[k]); }).join(",") + "}";
  }
  function globalFilter(text) { // MUTANT: global dedup, not adjacent
    var seen = Object.create(null), kept = [];
    String(text).split("\n").forEach(function (line) {
      if (line.charCodeAt(line.length - 1) === 0x0d) line = line.slice(0, -1);
      if (line.length === 0) return;
      var k = canonLocal(JSON.parse(line));
      if (seen[k]) return;
      seen[k] = true; kept.push(line);
    });
    return kept;
  }
  var r = ['{"v":"a"}', '{"v":"a"}', '{"v":"b"}', '{"v":"a"}'];
  var mutant = globalFilter(r.join("\n"));            // -> a,b (drops the far A) : WRONG
  var real = keptLines(r);                            // -> a,b,a
  ok("§9 bite: adjacent != global (mutant caught)", J(mutant) !== J(real));
})();

/* ===================== summary ============================================= */
console.log((fail === 0 ? "GREEN" : "RED") + "  uniq-filter  " + pass + "/" + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
