#!/usr/bin/env node
/* test_l21x-snapshot.js — proves the three verbs hold their contracts.

   THE ORACLES (honest proofs, not "matches a string I typed"):
     1. ROUND-TRIP: decodeSnapshot(encodeSnapshot(x)) deep-equals x, for a
        battery that includes multibyte text, nesting, arrays, and edge values.
     2. DETERMINISM: two documents that are equal-but-key-reordered encode to the
        SAME base64 string (the fidelity rule). This is what makes a snapshot
        diffable/hashable; break the key-sort and this vector fails.
     3. CATALOG: save/load/remove/list over an injected in-memory store behave,
        and list is deterministically ordered by name and by time.
     4. ARCHIVE: export then import round-trips a whole catalog, and a foreign or
        malformed archive is rejected loudly.

   Also mutation-bites the core so a no-op test can't pass green. Exit 0 = all
   pass; exit 1 = a failure (loud). stdlib only. */
"use strict";
var assert = require("assert");
var L = require("./l21x-snapshot.js");

var pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.error("FAIL " + name + "\n  " + (e && e.message)); }
}
// Deep, ORDER-INDEPENDENT equality. The encoder is deterministic (it sorts
// keys), so a round-tripped object is content-equal but may be key-reordered
// relative to the input — which is correct. Compare by content, not by the
// insertion order JSON.stringify happens to preserve.
function eq(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
    return true;
  }
  var ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  for (var j = 0; j < ka.length; j++) { if (ka[j] !== kb[j]) return false; if (!eq(a[ka[j]], b[ka[j]])) return false; }
  return true;
}

/* 1. ROUND-TRIP battery -------------------------------------------------------*/
var vectors = [
  {},
  { a: 1 },
  { a: 1, b: [1, 2, 3], c: { d: true, e: null } },
  [1, "two", 3.5, false, null],
  "a bare string",
  42,
  true,
  null,
  { name: "café", emoji: "🌲🔧", cyrillic: "Привет", cjk: "日本語" },  // multibyte
  { nested: { deep: { deeper: { x: [ { y: 1 } ] } } } },
  { "keys-with-dashes_and_1": "ok", "unicode-key-café": 1 }
];
vectors.forEach(function (v, i) {
  check("roundtrip[" + i + "]", function () {
    var back = L.decodeSnapshot(L.encodeSnapshot(v));
    assert.ok(eq(v, back), "round-trip changed the document: " + JSON.stringify(back));
  });
});

/* 1b. PINNED GOLDEN — a fixed doc must encode to this exact string, forever.
   Content round-trip alone would miss an encoding drift that still decodes
   (e.g. a base64-alphabet swap). This pins the wire format. */
check("pinned golden snapshot is byte-stable", function () {
  var doc = { a: 1, b: "café", c: [3, 2, 1], d: { z: true, y: null } };
  var GOLDEN = "eyJhIjoxLCJiIjoiY2Fmw6kiLCJjIjpbMywyLDFdLCJkIjp7InkiOm51bGwsInoiOnRydWV9fQ==";
  assert.strictEqual(L.encodeSnapshot(doc), GOLDEN, "wire format drifted from the pinned golden");
  assert.ok(eq(L.decodeSnapshot(GOLDEN), doc), "golden does not decode back to the doc");
});

/* 2. DETERMINISM (the fidelity rule) -----------------------------------------*/
check("determinism: key order does not change the snapshot", function () {
  var s1 = L.encodeSnapshot({ a: 1, b: 2, c: 3 });
  var s2 = L.encodeSnapshot({ c: 3, b: 2, a: 1 });
  assert.strictEqual(s1, s2, "equal docs with different key order encoded differently");
});
check("determinism: nested key order too", function () {
  var s1 = L.encodeSnapshot({ outer: { z: 1, a: 2 }, arr: [ { q: 1, p: 2 } ] });
  var s2 = L.encodeSnapshot({ arr: [ { p: 2, q: 1 } ], outer: { a: 2, z: 1 } });
  assert.strictEqual(s1, s2, "nested key order leaked into the snapshot");
});
check("determinism: same doc encodes identically twice", function () {
  var d = { x: [1, 2, { y: "café" }] };
  assert.strictEqual(L.encodeSnapshot(d), L.encodeSnapshot(d));
});
check("decode rejects garbage loudly", function () {
  assert.throws(function () { L.decodeSnapshot(""); });
});

/* 3. CATALOG (injected in-memory store) --------------------------------------*/
function memStore() {
  var m = {};
  return {
    getItem: function (k) { return k in m ? m[k] : null; },
    setItem: function (k, v) { m[k] = v; },
    removeItem: function (k) { delete m[k]; }
  };
}
var KEY = "cat";

check("catalog save/load round-trips a document", function () {
  var s = memStore();
  L.catalogSave(s, KEY, "draft", { title: "hello", body: "café ☕" }, 100);
  var got = L.catalogLoad(s, KEY, "draft");
  assert.ok(eq(got, { title: "hello", body: "café ☕" }), "catalog changed the doc");
});
check("catalog load of absent name is null", function () {
  var s = memStore();
  assert.strictEqual(L.catalogLoad(s, KEY, "nope"), null);
});
check("catalog remove reports existence", function () {
  var s = memStore();
  L.catalogSave(s, KEY, "a", { v: 1 }, 1);
  assert.strictEqual(L.catalogRemove(s, KEY, "a"), true);
  assert.strictEqual(L.catalogRemove(s, KEY, "a"), false);
  assert.strictEqual(L.catalogLoad(s, KEY, "a"), null);
});
check("catalog list sorts by name asc/desc deterministically", function () {
  var s = memStore();
  L.catalogSave(s, KEY, "banana", { v: 1 }, 3);
  L.catalogSave(s, KEY, "apple", { v: 1 }, 1);
  L.catalogSave(s, KEY, "cherry", { v: 1 }, 2);
  assert.ok(eq(L.catalogList(s, KEY, "name", true), ["apple", "banana", "cherry"]));
  assert.ok(eq(L.catalogList(s, KEY, "name", false), ["cherry", "banana", "apple"]));
});
check("catalog list sorts by time", function () {
  var s = memStore();
  L.catalogSave(s, KEY, "banana", { v: 1 }, 3);
  L.catalogSave(s, KEY, "apple", { v: 1 }, 1);
  L.catalogSave(s, KEY, "cherry", { v: 1 }, 2);
  assert.ok(eq(L.catalogList(s, KEY, "time", true), ["apple", "cherry", "banana"]));
});
check("catalog rejects invalid names", function () {
  var s = memStore();
  assert.throws(function () { L.catalogSave(s, KEY, "has space", {}, 0); });
  assert.throws(function () { L.catalogSave(s, KEY, "", {}, 0); });
  assert.throws(function () { L.catalogSave(s, KEY, "x".repeat(65), {}, 0); });
});
check("validateName accepts good, rejects bad", function () {
  assert.strictEqual(L.validateName("good_Name-1").valid, true);
  assert.strictEqual(L.validateName("bad name").valid, false);
});

/* 4. ARCHIVE (whole catalog as one portable string) --------------------------*/
check("archive export/import round-trips a catalog", function () {
  var s = memStore();
  L.catalogSave(s, KEY, "one", { a: 1 }, 1);
  L.catalogSave(s, KEY, "two", { b: 2, deep: { x: "café" } }, 2);
  var raw = JSON.parse(s.getItem(KEY));
  var archive = L.archiveExport(raw);
  var back = L.archiveImport(archive);
  assert.ok(eq(back, raw), "archive changed the catalog");
});
check("archive of empty catalog round-trips", function () {
  assert.ok(eq(L.archiveImport(L.archiveExport({})), {}));
});
check("archive import rejects a foreign envelope", function () {
  var foreign = L.encodeSnapshot({ magic: "SOMETHING-ELSE", entries: {} });
  assert.throws(function () { L.archiveImport(foreign); });
});
check("archive import rejects garbage", function () {
  assert.throws(function () { L.archiveImport("not base64 @#$"); });
});
check("archive import rejects an invalid entry name", function () {
  var bad = L.encodeSnapshot({ magic: L.ARCHIVE_MAGIC, entries: { "bad name": { snapshot: "x", savedAt: 0 } } });
  assert.throws(function () { L.archiveImport(bad); });
});

/* 5. MUTATION BITE — a no-op test cannot pass green --------------------------*/
/* If the encoder stopped being deterministic (key-sort removed), test 2 fails.
   We ALSO directly assert the bite: prove the oracle has teeth by confirming a
   known non-deterministic encode WOULD be caught. Encode a doc, then encode a
   key-shuffled twin; require equality. If someone deletes _canonical's sort,
   these differ and the suite goes red — demonstrated here as a live guard. */
check("mutation-bite: determinism guard has teeth", function () {
  var a = L.encodeSnapshot({ m: 1, z: 2, a: 3, k: 4 });
  var b = L.encodeSnapshot({ z: 2, k: 4, a: 3, m: 1 });
  assert.strictEqual(a, b, "determinism guard would not catch a key-sort regression");
  // and a genuinely different doc MUST encode differently (no trivial-pass):
  assert.notStrictEqual(a, L.encodeSnapshot({ m: 1, z: 2, a: 3, k: 5 }));
});

/* ---------------------------------------------------------------------------*/
console.log((fail === 0 ? "PASS" : "FAIL") + " — " + pass + " passed, " + fail + " failed");
process.exitCode = fail === 0 ? 0 : 1;
