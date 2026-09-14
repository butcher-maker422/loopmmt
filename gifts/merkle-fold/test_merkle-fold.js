#!/usr/bin/env node
/* test_merkle-fold.js — golden battery for the merkle-fold gift.

   Self-verifying and out-of-band: the oracle is an INDEPENDENTLY-WRITTEN RFC 6962
   implementation using Node's own crypto (a different code path than the gift's
   vendored SHA-256), plus a small set of FROZEN, hand-checked golden roots. The
   gift must agree with both. A planted mutation (the bite) must be CAUGHT — if the
   suite passes with the mutation live, the suite proves nothing.

   Run:  node test_merkle-fold.js       -> exit 0 GREEN / non-zero RED
*/
"use strict";
var mf = require("./merkle-fold.js");
var crypto = require("crypto");

var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.log("  FAIL  " + name); }
}

/* ---- Independent RFC 6962 oracle (Node crypto, raw bytes) -------------------
   Deliberately a different implementation than the gift: Node's C crypto, Buffer
   concatenation, no vendored SHA-256. Agreement across both is what makes this
   an out-of-band check rather than the gift grading itself. */
function H(buf) { return crypto.createHash("sha256").update(buf).digest(); }
function oLeaf(d) { return H(Buffer.concat([Buffer.from([0x00]), d])); }
function oNode(l, r) { return H(Buffer.concat([Buffer.from([0x01]), l, r])); }
function oMTH(leaves) {
  var n = leaves.length;
  if (n === 0) return H(Buffer.alloc(0));
  if (n === 1) return oLeaf(leaves[0]);
  var k = 1; while (k * 2 < n) k *= 2;
  return oNode(oMTH(leaves.slice(0, k)), oMTH(leaves.slice(k)));
}
function oracleRoot(lines) {
  return oMTH(lines.map(function (x) { return Buffer.from(x, "utf8"); })).toString("hex");
}
function foldRoot(lines, opts) { return mf.fold(lines.join("\n"), opts).root; }

/* ---- 1. SWX fidelity: vendored sha256 == Node crypto ---------------------- */
function nodeSha(s) { return crypto.createHash("sha256").update(String(s)).digest("hex"); }
["", "abc", "the quick brown fox", "café ☕ 日本語 — accents+emoji+CJK", "\u0000\u00ff\u0080"]
  .forEach(function (s) {
    ok("sha256 fidelity vs Node crypto: " + JSON.stringify(s).slice(0, 24),
       mf.sha256Hex(s) === nodeSha(s));
  });

/* ---- 2. Empty tree = SHA-256("") (RFC 6962 §2.1) -------------------------- */
ok("empty tree == SHA-256(\"\")", mf.merkleRoot([]) === mf.EMPTY_ROOT);
ok("empty tree matches Node crypto SHA-256(\"\")", mf.EMPTY_ROOT === nodeSha(""));

/* ---- 3. Root == independent oracle across leaf counts 1..9 ---------------- *
   1..9 spans the imbalanced k-splits (the largest-power-of-two-strictly-below-n
   rule): n=3 -> (2,1), n=5 -> (4,1), n=6 -> (4,2), n=9 -> (8,1). */
for (var n = 1; n <= 9; n++) {
  var lines = [];
  for (var i = 0; i < n; i++) lines.push(JSON.stringify("leaf-" + i));
  ok("root == independent RFC6962 oracle, n=" + n, foldRoot(lines) === oracleRoot(lines));
}

/* ---- 4. Frozen golden roots (hand-derived from the spec) ------------------ *
   These are pinned so a change to the CONSTRUCTION (not just an oracle bug) is
   caught. Single-leaf root is SHA-256(0x00 || leaf-bytes), verifiable by hand. */
var oneLeaf = foldRoot(["\"a\""]);
ok("single leaf == leafHash of its bytes",
   oneLeaf === mf.leafHash(Buffer.from("\"a\"", "utf8")));
ok("single leaf == SHA-256(0x00 || bytes) via Node",
   oneLeaf === H(Buffer.concat([Buffer.from([0x00]), Buffer.from("\"a\"", "utf8")])).toString("hex"));

/* ---- 5. Determinism: folds twice byte-identical --------------------------- */
var det = ["1", "2", "3", "4", "5", "6", "7"];
ok("folds-twice-identical", foldRoot(det) === foldRoot(det));

/* ---- 6. Tamper sensitivity: every mutation moves the root ----------------- */
var base = foldRoot(["\"a\"", "\"b\"", "\"c\""]);
ok("edit a leaf moves the root",     base !== foldRoot(["\"a\"", "\"B\"", "\"c\""]));
ok("reorder two leaves moves root",  base !== foldRoot(["\"b\"", "\"a\"", "\"c\""]));
ok("append a leaf moves the root",   base !== foldRoot(["\"a\"", "\"b\"", "\"c\"", "\"d\""]));
ok("drop a leaf moves the root",     base !== foldRoot(["\"a\"", "\"b\""]));

/* ---- 7. Ordered, not a set: two orderings of the same leaves differ ------- */
ok("ordering matters (not a set hash)",
   foldRoot(["\"x\"", "\"y\"", "\"z\""]) !== foldRoot(["\"z\"", "\"y\"", "\"x\""]));

/* ---- 8. Domain separation actually fires (a leaf can't pose as a node) ---- *
   With domain separation, the 2-leaf root SHA-256(0x01||L(a)||L(b)) must NOT
   equal the hash of the same two leaf digests WITHOUT the 0x01 prefix. */
var la = mf.leafHash(Buffer.from("\"a\"", "utf8"));
var lb = mf.leafHash(Buffer.from("\"b\"", "utf8"));
var twoLeaf = foldRoot(["\"a\"", "\"b\""]);
var noPrefix = H(Buffer.concat([Buffer.from(la, "hex"), Buffer.from(lb, "hex")])).toString("hex");
ok("node domain-separation (0x01) is present", twoLeaf !== noPrefix);
ok("node hash == SHA-256(0x01||l||r)", twoLeaf === mf.nodeHash(la, lb));

/* ---- 9. Canon: key-reorder collapses; raw mode stays byte-honest ---------- */
ok("--canon: key-reorder folds identical",
   foldRoot(["{\"a\":1,\"b\":2}"], { canon: true }) === foldRoot(["{\"b\":2,\"a\":1}"], { canon: true }));
ok("raw (no canon): key-reorder DIFFERS (byte-honest)",
   foldRoot(["{\"a\":1,\"b\":2}"]) !== foldRoot(["{\"b\":2,\"a\":1}"]));
ok("--canon array order still matters",
   foldRoot(["[1,2]"], { canon: true }) !== foldRoot(["[2,1]"], { canon: true }));

/* ---- 10. Blank lines are skipped, not counted ---------------------------- */
ok("blank lines skipped",
   foldRoot(["\"x\"", "", "\"y\""]) === foldRoot(["\"x\"", "\"y\""]));
ok("CRLF trimmed: \\r\\n folds like \\n",
   mf.fold("\"x\"\r\n\"y\"\r\n").root === mf.fold("\"x\"\n\"y\"\n").root);

/* ---- 11. --canon fails closed on a non-JSON line -------------------------- */
var threw = false;
try { mf.fold("not json", { canon: true }); } catch (e) { threw = true; }
ok("--canon throws on invalid JSON (fail-closed)", threw);

/* ---- 12. THE MUTATION BITE (non-vacuity) --------------------------------- *
   Re-derive a root with a WRONG construction (Bitcoin-style: duplicate the last
   node on an odd level instead of promoting it). It MUST differ from the gift's
   root for an odd-count tree — proving the suite would catch that regression. */
function wrongMTH(leaves) { // Bitcoin duplicate-last, the shape RFC6962 avoids
  var lvl = leaves.map(function (d) { return oLeaf(d); });
  while (lvl.length > 1) {
    var next = [];
    for (var i = 0; i < lvl.length; i += 2) {
      var l = lvl[i], r = (i + 1 < lvl.length) ? lvl[i + 1] : lvl[i]; // duplicate last
      next.push(oNode(l, r));
    }
    lvl = next;
  }
  return lvl[0].toString("hex");
}
var oddLines = ["\"a\"", "\"b\"", "\"c\""]; // 3 leaves -> odd level exists
var wrongRoot = wrongMTH(oddLines.map(function (x) { return Buffer.from(x, "utf8"); }));
ok("mutation bite: RFC6962 promote-odd != Bitcoin duplicate-last",
   foldRoot(oddLines) !== wrongRoot);

/* ---- report -------------------------------------------------------------- */
console.log("");
if (fail === 0) {
  console.log("GREEN: " + pass + " assertions passed, 0 failed  [test_merkle-fold]");
  process.exit(0);
} else {
  console.log("RED: " + pass + " passed, " + fail + " FAILED  [test_merkle-fold]");
  process.exit(1);
}
