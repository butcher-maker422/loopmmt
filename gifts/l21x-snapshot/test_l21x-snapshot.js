#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/* test_l21x-snapshot.js — proves the persistence layer implements its contract.

   THE ORACLE. There is no stdlib that says "is this catalog persisted right?" — so
   the oracle is CURATED VECTORS expressed directly against what the functions
   promise: (1) snapshot encode->decode round-trips an arbitrary document, including
   full multibyte UTF-8; (2) decodeSnapshot REJECTS a foreign/garbage string rather
   than half-parsing; (3) catalogSave returns a NEW catalog, replaces by id, and
   never mutates its input; (4) catalogLoad returns the doc or null; (5)
   catalogValidate reports duplicate-id and bad-snapshot honestly; (6) catalogSort
   is stable, nulls-last, and leaves its input untouched; (7) archiveExport/Import
   round-trips a whole catalog exactly. Plus determinism (encode is a pure function)
   and a mutation-bite so a degenerate core (constant output / ignores input) fails.
   Exit 0 = all pass; exit 1 = a failure (loud). stdlib only. */
"use strict";
var m = require("./l21x-snapshot.js");

var pass = 0, fail = 0;
function ok(label, cond) { if (cond) { pass++; } else { fail++; console.error("FAIL  " + label); } }
function eq(label, a, b) { ok(label + " (=" + JSON.stringify(b) + ")", a === b); }
function threw(label, fn) {
  var did = false;
  try { fn(); } catch (e) { did = true; }
  ok(label + " (throws)", did);
}
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// ---- 1. snapshot codec round-trip (incl. multibyte) ------------------------
var doc1 = { title: "Café ☕ — 日本語", n: 42, list: [1, 2, { deep: true }], nil: null };
var snap1 = m.encodeSnapshot(doc1, { title: "t", schema: "note" });
var back1 = m.decodeSnapshot(snap1);
ok("snapshot round-trips the doc", deepEq(back1.doc, doc1));
eq("snapshot carries title", back1.title, "t");
eq("snapshot carries schema", back1.schema, "note");
ok("snapshot is base64-ish (no raw braces)", snap1.indexOf("{") === -1);

// primitive & array docs also round-trip
ok("string doc round-trips", m.decodeSnapshot(m.encodeSnapshot("hi")).doc === "hi");
ok("array doc round-trips", deepEq(m.decodeSnapshot(m.encodeSnapshot([1, "two", 3])).doc, [1, "two", 3]));

// ---- 2. decode REJECTS foreign / malformed input ---------------------------
threw("decode rejects empty string", function () { m.decodeSnapshot(""); });
threw("decode rejects non-string", function () { m.decodeSnapshot(null); });
threw("decode rejects garbage base64->json", function () { m.decodeSnapshot("bm90IGpzb24="); }); // "not json"
threw("decode rejects a foreign-fmt envelope", function () {
  // valid base64 of a JSON object whose fmt is wrong
  var foreign = Buffer ? Buffer.from(JSON.stringify({ fmt: "other", v: 1, doc: 1 })).toString("base64")
                       : m.encodeSnapshot({}); // fallback; still non-l21x-fmt below
  m.decodeSnapshot(foreign);
});
threw("encode rejects undefined doc", function () { m.encodeSnapshot(undefined); });

// ---- 3. catalogSave: new catalog, replace-by-id, no mutation ---------------
var cat0 = [];
var cat1 = m.catalogSave(cat0, "a", { v: 1 }, { title: "A", updated: "2026-01-01" });
eq("save grows the catalog", cat1.length, 1);
eq("save does not mutate input", cat0.length, 0);
ok("saved returns a NEW array", cat1 !== cat0);
var cat2 = m.catalogSave(cat1, "b", { v: 2 }, { title: "B", updated: "2026-03-01" });
eq("second save grows", cat2.length, 2);
var cat2b = m.catalogSave(cat2, "a", { v: 99 }, { title: "A2", updated: "2026-02-01" });
eq("replace keeps length", cat2b.length, 2);
eq("replace updates in place by id", m.catalogLoad(cat2b, "a").doc.v, 99);
eq("replace does not mutate prior catalog", m.catalogLoad(cat2, "a").doc.v, 1);
threw("save rejects empty id", function () { m.catalogSave([], "", {}); });

// ---- 4. catalogLoad --------------------------------------------------------
ok("load returns null for missing id", m.catalogLoad(cat2b, "zzz") === null);
ok("load decodes the stored doc", deepEq(m.catalogLoad(cat2b, "b").doc, { v: 2 }));

// ---- 5. catalogValidate: honest errors -------------------------------------
var good = m.catalogValidate(cat2b);
ok("valid catalog validates ok", good.ok === true && good.errors.length === 0);
var dupe = cat2b.concat([{ id: "a", snapshot: cat2b[0].snapshot }]);
var dupeRes = m.catalogValidate(dupe);
ok("duplicate id is reported", dupeRes.ok === false &&
   dupeRes.errors.join("|").indexOf("duplicate") !== -1);
var badSnap = [{ id: "x", snapshot: "@@not-base64-json@@" }];
ok("bad snapshot is reported", m.catalogValidate(badSnap).ok === false);
var missingId = [{ snapshot: cat2b[0].snapshot }];
ok("missing id is reported", m.catalogValidate(missingId).ok === false);

// ---- 6. catalogSort: stable, nulls-last, input untouched -------------------
var sortSrc = [
  { id: "c", title: "Cherry", updated: "2026-03" },
  { id: "a", title: "Apple", updated: null },
  { id: "b", title: "Banana", updated: "2026-01" }
];
var byTitle = m.catalogSort(sortSrc, "title");
eq("sort by title asc first", byTitle[0].id, "a");
eq("sort by title asc last", byTitle[2].id, "c");
ok("sort does not mutate input", sortSrc[0].id === "c");
var byUpdated = m.catalogSort(sortSrc, "updated");
eq("nulls sort last on updated", byUpdated[2].id, "a");
var byUpdatedDesc = m.catalogSort(sortSrc, "updated", true);
eq("desc reverses order", byUpdatedDesc[0].id, "c");
// stability: equal keys keep input order
var ties = [{ id: "p", k: 1 }, { id: "q", k: 1 }, { id: "r", k: 1 }];
var tied = m.catalogSort(ties, "k");
ok("sort is stable on ties", tied[0].id === "p" && tied[1].id === "q" && tied[2].id === "r");

// ---- 7. archive round-trip -------------------------------------------------
var arch = m.archiveExport(cat2b);
ok("archive is one string", typeof arch === "string" && arch.length > 0);
var imported = m.archiveImport(arch);
ok("archive round-trips the catalog", deepEq(imported, cat2b));
eq("imported catalog is usable", m.catalogLoad(imported, "a").doc.v, 99);
threw("archiveExport refuses an invalid catalog", function () { m.archiveExport(dupe); });
threw("archiveImport rejects garbage", function () { m.archiveImport("bm90IGFuIGFyY2hpdmU="); });
threw("archiveImport rejects a snapshot-as-archive", function () { m.archiveImport(snap1); });

// ---- 8. determinism (encode is a pure function of its input) ---------------
ok("encode is deterministic", m.encodeSnapshot(doc1, { title: "t", schema: "note" }) === snap1);
ok("archive is deterministic", m.archiveExport(cat2b) === arch);

// ---- 9. mutation-bite ------------------------------------------------------
// A degenerate encode that ignored its input (constant output) would make two
// different docs encode identically. Prove they DON'T.
ok("MUTATION-BITE: different docs encode differently",
   m.encodeSnapshot({ a: 1 }) !== m.encodeSnapshot({ a: 2 }));
// A degenerate catalogLoad that returned a constant would fail id discrimination.
ok("MUTATION-BITE: load discriminates by id",
   m.catalogLoad(cat2b, "a").doc.v !== m.catalogLoad(cat2b, "b").doc.v);

// ---- report ----------------------------------------------------------------
console.log((fail === 0 ? "PASS" : "FAIL") + "  " + pass + "/" + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
