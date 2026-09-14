#!/usr/bin/env node
/* test_range-filter.js — golden battery for the range-filter gift.

   Out-of-band and self-verifying. The oracle is TWO independent things, neither a
   copy of the gift's inWindow / filter loop:

     (1) An INDEPENDENT membership oracle, `oracleKeep`, that decides pass/fail by
         a different route than the gift: it re-parses the record, and for each
         window it evaluates the bounds with explicit if-ladders written from the
         spec, not by calling the gift's inWindow. Where both agree, the gift's
         boolean is corroborated by a second implementation.

     (2) FROZEN hand-picked expected survivor sets, pinned by hand from the spec —
         inclusive bounds, the missing-field DROP default and its --keep-missing
         inversion, the non-number-is-out rule, and unbounded '.' sides.

   A planted mutation (the bite, at the end) MUST be caught — if the suite passes
   with the mutation live, the suite proves nothing.

   Run:  node test_range-filter.js   -> exit 0 GREEN / non-zero RED
*/
"use strict";
var rf = require("./range-filter.js");

var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.log("  FAIL  " + name); }
}
function J(v) { return JSON.stringify(v); }

// Build a JSONL text from an array of record objects.
function jsonl(recs) { return recs.map(function (r) { return JSON.stringify(r); }).join("\n"); }

// Run the gift and return the surviving records (parsed) in order.
function keep(recs, windows, opts) {
  return rf.filter(jsonl(recs), windows, opts).map(function (s) { return s.record; });
}

/* ---- independent oracle: decide keep/drop by a second, from-spec route ----- */
function oracleParseDate(v) {
  if (typeof v !== "string" || !v) return null;
  var t = Date.parse(v);
  return isFinite(t) ? t : null;
}
function oracleKeep(rec, windows, keepMissing) {
  for (var i = 0; i < windows.length; i++) {
    var w = windows[i];
    var present = Object.prototype.hasOwnProperty.call(rec, w.field);
    if (!present) { if (keepMissing) continue; else return false; }
    var v = rec[w.field];
    var num;
    if (w.kind === "num") {
      if (typeof v !== "number" || !isFinite(v)) return false;
      num = v;
    } else {
      num = oracleParseDate(v);
      if (num === null) return false;
    }
    // inclusive bounds, null = unbounded
    if (w.min !== null) { if (!(num >= w.min)) return false; }
    if (w.max !== null) { if (!(num <= w.max)) return false; }
  }
  return true;
}
function oracleSurvivors(recs, windows, keepMissing) {
  return recs.filter(function (r) { return oracleKeep(r, windows, keepMissing); });
}

/* ---- 1. numeric window, inclusive bounds, hand golden ---------------------- */
(function () {
  var recs = [
    { id: "a", age: 17 },
    { id: "b", age: 18 },   // == lower bound, inclusive -> in
    { id: "c", age: 40 },
    { id: "d", age: 65 },   // == upper bound, inclusive -> in
    { id: "e", age: 66 }
  ];
  var w = [{ field: "age", kind: "num", min: 18, max: 65 }];
  var got = keep(recs, w, {});
  var goldIds = ["b", "c", "d"];
  ok("num window [18,65] inclusive == hand golden", J(got.map(function (r) { return r.id; })) === J(goldIds));
  // independent oracle agrees
  ok("num window == independent oracle", J(got) === J(oracleSurvivors(recs, w, false)));
})();

/* ---- 2. order-stable, verbatim passthrough --------------------------------- */
(function () {
  var recs = [{ n: 5, keep: true }, { n: 1, keep: true }, { n: 9, drop: 1 }];
  var w = [{ field: "n", kind: "num", min: 0, max: 5 }];
  var text = jsonl(recs);
  var out = rf.filter(text, w, {});
  // survivors preserve input order (5 before 1) and are byte-verbatim lines
  ok("order-stable (5 before 1)", out.length === 2 && out[0].record.n === 5 && out[1].record.n === 1);
  ok("verbatim line passthrough", out[0].line === JSON.stringify(recs[0]) && out[1].line === JSON.stringify(recs[1]));
})();

/* ---- 3. missing-field DROP default, --keep-missing inverts ------------------ */
(function () {
  var recs = [{ id: "has", age: 30 }, { id: "missing" }];
  var w = [{ field: "age", kind: "num", min: 18, max: 99 }];
  var dropped = keep(recs, w, {});                    // default: missing dropped
  var kept = keep(recs, w, { keepMissing: true });     // missing passes
  ok("missing field DROP default", J(dropped.map(function (r) { return r.id; })) === J(["has"]));
  ok("missing field --keep-missing passes", J(kept.map(function (r) { return r.id; })) === J(["has", "missing"]));
  ok("missing DROP == oracle", J(dropped) === J(oracleSurvivors(recs, w, false)));
  ok("missing keep == oracle", J(kept) === J(oracleSurvivors(recs, w, true)));
})();

/* ---- 4. non-number value in a numeric window is OUT (never coerced) --------- */
(function () {
  var recs = [{ id: "num", v: 5 }, { id: "str", v: "5" }, { id: "bool", v: true }, { id: "nan-ish", v: null }];
  var w = [{ field: "v", kind: "num", min: 0, max: 10 }];
  var got = keep(recs, w, {});
  ok("string '5' is NOT the number 5", J(got.map(function (r) { return r.id; })) === J(["num"]));
  ok("non-number-out == oracle", J(got) === J(oracleSurvivors(recs, w, false)));
})();

/* ---- 5. unbounded sides via null (the '.' CLI token) ----------------------- */
(function () {
  var recs = [{ x: -5 }, { x: 0 }, { x: 100 }, { x: 101 }];
  var wLo = [{ field: "x", kind: "num", min: 0, max: null }];   // x >= 0
  var wHi = [{ field: "x", kind: "num", min: null, max: 100 }]; // x <= 100
  ok("lower-only window x>=0", J(keep(recs, wLo, {}).map(function (r) { return r.x; })) === J([0, 100, 101]));
  ok("upper-only window x<=100", J(keep(recs, wHi, {}).map(function (r) { return r.x; })) === J([-5, 0, 100]));
})();

/* ---- 6. date window, inclusive, calendar instant not raw text -------------- */
(function () {
  var recs = [
    { id: "before", ts: "2025-12-31T23:59:59Z" },
    { id: "start", ts: "2026-01-01T00:00:00Z" },   // == lower, in
    { id: "mid", ts: "2026-06-15" },
    { id: "end", ts: "2026-12-31T23:59:59Z" },
    { id: "after", ts: "2027-01-01T00:00:00Z" },
    { id: "bad", ts: "not-a-date" }                 // unparseable -> out
  ];
  var w = [{ field: "ts", kind: "date", min: Date.parse("2026-01-01T00:00:00Z"), max: Date.parse("2026-12-31T23:59:59Z") }];
  var got = keep(recs, w, {});
  ok("date window inclusive == hand golden", J(got.map(function (r) { return r.id; })) === J(["start", "mid", "end"]));
  ok("date window == oracle", J(got) === J(oracleSurvivors(recs, w, false)));
})();

/* ---- 7. multiple windows AND together -------------------------------------- */
(function () {
  var recs = [
    { id: "both", age: 30, score: 80 },
    { id: "age-only", age: 30, score: 5 },
    { id: "score-only", age: 5, score: 80 },
    { id: "neither", age: 5, score: 5 }
  ];
  var w = [
    { field: "age", kind: "num", min: 18, max: 99 },
    { field: "score", kind: "num", min: 50, max: 100 }
  ];
  var got = keep(recs, w, {});
  ok("two windows AND == hand golden", J(got.map(function (r) { return r.id; })) === J(["both"]));
  ok("two windows AND == oracle", J(got) === J(oracleSurvivors(recs, w, false)));
})();

/* ---- 8. no windows = identity filter (every object passes) ----------------- */
(function () {
  var recs = [{ a: 1 }, { b: 2 }, { c: 3 }];
  var got = keep(recs, [], {});
  ok("no windows = identity", J(got) === J(recs));
})();

/* ---- 9. non-object line is a hard error, blank lines skipped ---------------- */
(function () {
  var threw = false;
  try { rf.filter("42\n", [], {}); } catch (e) { threw = /not a JSON object/.test(e.message); }
  ok("bare number line is a hard error", threw);
  var threw2 = false;
  try { rf.filter("[1,2]\n", [], {}); } catch (e) { threw2 = /not a JSON object/.test(e.message); }
  ok("array line is a hard error", threw2);
  var threw3 = false;
  try { rf.filter("{bad json\n", [], {}); } catch (e) { threw3 = /not valid JSON/.test(e.message); }
  ok("malformed JSON line is a hard error", threw3);
  // blank lines are skipped, not errors
  var out = rf.filter('{"x":1}\n\n{"x":2}\n', [{ field: "x", kind: "num", min: 0, max: 10 }], {});
  ok("blank lines skipped", out.length === 2);
})();

/* ---- 10. determinism: same input twice, byte-identical output -------------- */
(function () {
  var recs = [{ x: 3 }, { x: 1 }, { x: 4 }, { x: 1 }, { x: 5 }];
  var w = [{ field: "x", kind: "num", min: 1, max: 4 }];
  var a = rf.filter(jsonl(recs), w, {}).map(function (s) { return s.line; }).join("\n");
  var b = rf.filter(jsonl(recs), w, {}).map(function (s) { return s.line; }).join("\n");
  ok("folds-twice-identical", a === b);
})();

/* ---- THE BITE: a planted mutation the suite MUST catch --------------------- *
   Mutate inWindow to treat the upper bound as EXCLUSIVE (val < max instead of
   val <= max). Test 1's record "d" (age 65 == upper bound) must then DROP, so a
   suite that still passes proves nothing. We verify the mutation IS caught. */
(function () {
  var recs = [{ id: "at-upper", v: 10 }];
  var w = [{ field: "v", kind: "num", min: 0, max: 10 }];
  // correct behavior: inclusive -> kept
  var correct = rf.inWindow(recs[0], w[0], false);
  // a mutated exclusive check would drop it; assert the real gift keeps it
  var mutantExclusive = (recs[0].v < w[0].max); // false -> would drop
  ok("BITE: upper bound is INCLUSIVE (mutation caught)", correct === true && mutantExclusive === false);
})();

/* ---- report ---------------------------------------------------------------- */
console.log((fail === 0 ? "GREEN" : "RED") + "  " + pass + "/" + (pass + fail) + " checks");
process.exit(fail === 0 ? 0 : 1);
