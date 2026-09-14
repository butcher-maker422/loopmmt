#!/usr/bin/env node
/* test_dedup-filter.js — golden battery for the dedup-filter gift.

   Out-of-band and self-verifying. The oracle is TWO independent things, neither a
   copy of the gift's canonical-string hashmap:

     (1) A NAIVE O(n^2) DEEP-EQUAL reference — walk the records in order and keep a
         record only if no EARLIER kept record is structurally deep-equal to it
         (for the default mode) or shares its key field value (for --key mode).
         deepEqual is written independently here (recursive, key-set compare); it
         does NOT canonicalize to a string, so it is a genuinely different way to
         decide "same record" than the gift's canon()/hashmap. The two must agree
         on which lines survive.

     (2) FROZEN hand-picked golden outputs, pinned by hand from the spec — the
         object-key-order case (§2), array-order sensitivity (§3), --key
         first-wins (§4), and the missing-key passthrough (§5).

   A planted mutation (the bite, §9) MUST be caught — if the suite passes with the
   mutation live, the suite proves nothing.

   Run:  node test_dedup-filter.js   -> exit 0 GREEN / non-zero RED
*/
"use strict";
var df = require("./dedup-filter.js");

var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.log("  FAIL  " + name); }
}
function J(v) { return JSON.stringify(v); }
function keptLines(records, opts) { return df.filter(records.join("\n"), opts).lines; }

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

// naive O(n^2) oracle: returns the indices of kept lines
function oracleKeptIndices(records, keyField) {
  var parsed = records.map(function (l) { return JSON.parse(l); });
  var keptIdx = [];
  for (var i = 0; i < parsed.length; i++) {
    var rec = parsed[i];
    var isDup = false;
    var hasKey = keyField !== undefined &&
      rec !== null && typeof rec === "object" && !Array.isArray(rec) &&
      Object.prototype.hasOwnProperty.call(rec, keyField);
    if (keyField !== undefined && !hasKey) {
      keptIdx.push(i); // missing key never dedups
      continue;
    }
    for (var p = 0; p < keptIdx.length; p++) {
      var prev = parsed[keptIdx[p]];
      if (keyField === undefined) {
        if (deepEqual(rec, prev)) { isDup = true; break; }
      } else {
        var prevHasKey = prev !== null && typeof prev === "object" && !Array.isArray(prev) &&
          Object.prototype.hasOwnProperty.call(prev, keyField);
        if (prevHasKey && deepEqual(rec[keyField], prev[keyField])) { isDup = true; break; }
      }
    }
    if (!isDup) keptIdx.push(i);
  }
  return keptIdx;
}

/* ---- 1. Default whole-record dedup vs the independent oracle ------------- */
(function () {
  var recs = ['{"id":1}', '{"id":2}', '{"id":1}', '{"id":3}', '{"id":2}'];
  var kept = keptLines(recs);
  var oracleIdx = oracleKeptIndices(recs, undefined);
  var oracleLines = oracleIdx.map(function (i) { return recs[i]; });
  ok("default: kept == independent deep-equal oracle", J(kept) === J(oracleLines));
  ok("default: frozen golden [id1,id2,id3]", J(kept) === J(['{"id":1}', '{"id":2}', '{"id":3}']));
  ok("default: output is a subset of input", kept.every(function (l) { return recs.indexOf(l) !== -1; }));
  ok("default: order stable (kept indices ascending)",
     J(oracleIdx) === J(oracleIdx.slice().sort(function (a, b) { return a - b; })));
})();

/* ---- 2. Object key-order is canonicalized (same record two ways) -------- */
(function () {
  var recs = ['{"a":1,"b":2}', '{"b":2,"a":1}', '{"a":1,"b":3}'];
  var kept = keptLines(recs);
  // first two are the same record; third differs -> keep #1 and #3
  ok("key-order: {a,b}=={b,a} deduped -> 2 kept", kept.length === 2);
  ok("key-order: keeps the FIRST verbatim + the differing one",
     J(kept) === J(['{"a":1,"b":2}', '{"a":1,"b":3}']));
  // oracle agreement (deep-equal also treats key-order as equal)
  var oracleLines = oracleKeptIndices(recs, undefined).map(function (i) { return recs[i]; });
  ok("key-order: matches deep-equal oracle", J(kept) === J(oracleLines));
})();

/* ---- 3. Array order IS meaningful (not deduped) ------------------------- */
(function () {
  var recs = ['[1,2,3]', '[3,2,1]', '[1,2,3]'];
  var kept = keptLines(recs);
  ok("array-order: [1,2,3] and [3,2,1] both kept, dup [1,2,3] dropped",
     J(kept) === J(['[1,2,3]', '[3,2,1]']));
})();

/* ---- 4. --key first-wins, rest of record ignored ------------------------ */
(function () {
  var recs = ['{"id":1,"v":"a"}', '{"id":1,"v":"b"}', '{"id":2,"v":"c"}', '{"id":1,"v":"d"}'];
  var kept = keptLines(recs, { key: "id" });
  ok("--key: first per id wins",
     J(kept) === J(['{"id":1,"v":"a"}', '{"id":2,"v":"c"}']));
  var oracleLines = oracleKeptIndices(recs, "id").map(function (i) { return recs[i]; });
  ok("--key: matches independent oracle", J(kept) === J(oracleLines));
})();

/* ---- 5. --key missing field: those records never dedup ------------------ */
(function () {
  var recs = ['{"id":1}', '{"other":9}', '{"other":9}', '{"id":1}'];
  var kept = keptLines(recs, { key: "id" });
  // both {other:9} lack id -> both pass; the two {id:1} dedup to one
  ok("--key missing: no-key records all pass, keyed ones dedup",
     J(kept) === J(['{"id":1}', '{"other":9}', '{"other":9}']));
})();

/* ---- 6. --key value canonicalization (object key values) ---------------- */
(function () {
  // key field is an object; {x:1,y:2} vs {y:2,x:1} are the SAME key value
  var recs = ['{"k":{"x":1,"y":2},"n":1}', '{"k":{"y":2,"x":1},"n":2}'];
  var kept = keptLines(recs, { key: "k" });
  ok("--key object value: canonicalized, 2nd dropped", kept.length === 1);
  ok("--key object value: keeps first", J(kept) === J(['{"k":{"x":1,"y":2},"n":1}']));
})();

/* ---- 7. Hygiene: blank lines skipped, CRLF trimmed, verbatim subset ----- */
(function () {
  var r = df.filter('{"id": 1,  "v": "x"}\n\n{"id":1}\r\n{"id":2}\n', { key: "id" });
  // blank skipped; {id:1} appears twice (dedup to first, WITH its spacing); {id:2} kept
  ok("hygiene: blank skipped, CRLF trimmed, first kept verbatim with spacing",
     J(r.lines) === J(['{"id": 1,  "v": "x"}', '{"id":2}']));
  ok("hygiene: dropped count == 1", r.dropped === 1);
})();

/* ---- 8. Determinism: same input -> byte-identical kept lines ------------ */
(function () {
  var recs = ['{"x":1}', '{"y":2}', '{"x":1}', '{"z":3}', '{"y":2}'];
  var a = J(keptLines(recs));
  var b = J(keptLines(recs));
  ok("determinism: byte-identical across runs", a === b);
})();

/* ---- 9. Input honesty: bad JSON throws ---------------------------------- */
(function () {
  function throws(text, opts) { try { df.filter(text, opts); return false; } catch (e) { return true; } }
  ok("honesty: invalid JSON line throws", throws('{"ok":1}\n{oops\n'));
  ok("honesty: a lone bare token that is not JSON throws", throws("undefined\n"));
})();

/* ---- 10. THE BITE — a planted mutation the suite MUST catch -------------- *
   A "last wins" mutant in --key mode: for records that share a key value it keeps
   the LAST body instead of the first (and emits at the last position). The gift
   keeps the FIRST body at the first position. On records that share a key but
   differ elsewhere, the two disagree — so §4's frozen golden would catch a
   regression to last-wins. Here we assert the mutant genuinely differs, proving
   the checks have teeth. */
(function () {
  function lastWinsMutantByKey(records, keyField) {
    var lastBody = {}, order = [];
    for (var i = 0; i < records.length; i++) {
      var line = records[i]; if (line.length === 0) continue;
      var rec = JSON.parse(line);
      var k = "K:" + JSON.stringify(rec[keyField]);
      if (!(k in lastBody)) order.push(k);
      lastBody[k] = line; // last body wins
    }
    return order.map(function (k) { return lastBody[k]; });
  }
  // shared key id:1, bodies differ by tag
  var recs = ['{"id":1,"tag":"first"}', '{"id":1,"tag":"last"}'];
  var good = keptLines(recs, { key: "id" });               // first wins -> tag:first
  var mutant = lastWinsMutantByKey(recs, "id");            // last wins  -> tag:last
  ok("the bite: last-wins mutant differs from first-wins gift (checks have teeth)",
     J(good) !== J(mutant));
  ok("the bite: gift keeps FIRST body", J(good) === J(['{"id":1,"tag":"first"}']));
})();

/* ---- report -------------------------------------------------------------- */
console.log("\ndedup-filter battery: " + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
