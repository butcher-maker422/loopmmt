#!/usr/bin/env node
/* merkle-fold.js — fold a JSONL leaf stream into ONE tamper-evident Merkle root.
   Dependency-free, deterministic, runs in Node or a browser. MIT.

   WHAT IT IS. Give it a stream of leaves — one JSON value per line (JSONL) — and
   it folds them into a single 64-char hex Merkle root. Change any one leaf, add a
   leaf, drop a leaf, or reorder two leaves, and the root changes. The root is a
   fingerprint of the WHOLE ORDERED sequence: publish it once, and anyone can later
   recompute it from the same leaves and prove nothing was altered.

   HOW THE TREE IS BUILT (RFC 6962, the Certificate Transparency construction).
   Two rules, and the domain separation between them is the whole security story:

       leaf hash      MTH({d})   = SHA-256(0x00 || d)
       internal hash  MTH(D[n])  = SHA-256(0x01 || MTH(left) || MTH(right))
                                   where the split point k is the largest power of
                                   two strictly smaller than n.

   The one-byte prefixes (0x00 for a leaf, 0x01 for an internal node) are NOT
   decoration — they are what gives the tree second-preimage resistance: without
   them an attacker could present an internal node's two children as if they were
   a pair of leaves and forge a different tree with the same root. RFC 6962 §2.1.

   WHY NOT THE BITCOIN SHAPE. Bitcoin duplicates the last node when a level has an
   odd count. That re-hashing of a node against itself is the source of a known
   ambiguity (CVE-2012-2459 class): two different leaf lists can collide to one
   root. RFC 6962 instead PROMOTES an odd node unchanged to the next level, so the
   tree may be imbalanced but its shape is uniquely determined by the leaf count —
   no duplication, no ambiguity. We follow RFC 6962. That choice is printed on the
   README edge on purpose.

   THE EMPTY TREE. Zero leaves folds to SHA-256 of the empty byte string,
   e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 (RFC 6962 §2.1).

   REUSE (SWX). The SHA-256 block machinery is the shipped `sha256` gift's
   FIPS-180-4 core, vendored here byte-faithfully so this gift stays single-file and
   zero-dependency. The one addition this gift needs — and the reason it is not a
   one-line require — is a RAW-BYTES entry (`sha256HexBytes`): a Merkle tree hashes
   byte concatenations (a 0x00 prefix in front of leaf bytes; two 32-byte digests
   glued behind a 0x01), never re-encoded text. Hashing those through a string API
   would re-UTF-8-encode the digest bytes and silently compute the wrong root — the
   exact char-code trap the sha256 gift's own README warns about. So the core here
   hashes a Uint8Array directly; the string wrapper is a thin call on top and stays
   byte-identical to the shipped atom for text input (the battery checks that).

   USAGE
     printf '%s\n' '"a"' '"b"' '"c"' | node merkle-fold.js     # root of 3 leaves
     node merkle-fold.js leaves.jsonl                          # root of a file
     node merkle-fold.js --json  < leaves.jsonl                # {root, leaves} JSON
     node merkle-fold.js --help

   Each input LINE is one leaf. A leaf's bytes are the UTF-8 bytes of the line's
   text AS WRITTEN (after trimming a trailing \r), so two byte-identical files
   always fold to the same root. Blank lines are skipped (they are not leaves).
   With --canon, each line is parsed as JSON and re-serialized canonically (object
   keys sorted, array order kept) before hashing, so a key-reordered or
   whitespace-different-but-equal record folds to the SAME root; without --canon the
   raw line bytes are the leaf and any byte difference changes the root. --canon
   fails closed (exit 2) on a line that is not valid JSON.

   Exit codes: 0 success · 2 input error (missing file, a directory, or — under
   --canon — a line that is not valid JSON), always a clean one-line message on
   stderr, never a stack trace.

   Released under MIT. Its edge is printed in the README: this proves an ORDERED
   sequence of leaves is intact. It is NOT a set hash (reorder two leaves and the
   root changes — that is the point, not a bug), NOT a signature (it keeps no
   secret; anyone who has the leaves can recompute it), and NOT encryption.
*/
"use strict";

/* ------------------------------------------------------------------ *
 * SHA-256 core — vendored from the `sha256` gift (FIPS 180-4), with a *
 * raw-bytes entry added for the Merkle byte concatenations.           *
 * ------------------------------------------------------------------ */

// Round constants — FIPS 180-4 §4.2.2 (first 32 bits of the fractional parts of
// the cube roots of the first 64 primes).
var K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

function toHex8(x) {
  var h = (x >>> 0).toString(16);
  return "00000000".slice(h.length) + h;
}

// UTF-8 encode a JS string to a byte array — the SAME bytes Node's
// .update(String(s)) hashes (surrogate-pair aware fallback matches TextEncoder).
function utf8Bytes(str) {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(str);
  }
  var out = [], i, c, lo;
  for (i = 0; i < str.length; i++) {
    c = str.charCodeAt(i);
    if (c < 0x80) { out.push(c); }
    else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
    else if (c >= 0xd800 && c <= 0xdbff) {
      lo = str.charCodeAt(++i);
      c = 0x10000 + ((c & 0x3ff) << 10) + (lo & 0x3ff);
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
  }
  return out;
}

// sha256 of RAW BYTES (array-like of 0..255) -> a 32-byte Uint8Array digest.
// This is the primitive the Merkle construction needs: it hashes the bytes it is
// given, verbatim, with no text re-encoding.
function sha256Digest(bytes) {
  var len = bytes.length;
  var bitLenHi = Math.floor(len / 0x20000000);
  var bitLenLo = (len * 8) >>> 0;
  var withOne = len + 1;
  var padded = (withOne + 8 + 63) & ~63;
  var msg = new Uint8Array(padded);
  var i;
  for (i = 0; i < len; i++) msg[i] = bytes[i] & 0xff;
  msg[len] = 0x80;
  msg[padded - 8] = (bitLenHi >>> 24) & 0xff;
  msg[padded - 7] = (bitLenHi >>> 16) & 0xff;
  msg[padded - 6] = (bitLenHi >>> 8) & 0xff;
  msg[padded - 5] = bitLenHi & 0xff;
  msg[padded - 4] = (bitLenLo >>> 24) & 0xff;
  msg[padded - 3] = (bitLenLo >>> 16) & 0xff;
  msg[padded - 2] = (bitLenLo >>> 8) & 0xff;
  msg[padded - 1] = bitLenLo & 0xff;

  var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
      h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  var w = new Array(64), t, blk;
  for (blk = 0; blk < padded; blk += 64) {
    for (t = 0; t < 16; t++) {
      w[t] = (msg[blk + t * 4] << 24) | (msg[blk + t * 4 + 1] << 16) |
             (msg[blk + t * 4 + 2] << 8) | (msg[blk + t * 4 + 3]);
    }
    for (t = 16; t < 64; t++) {
      var s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      var s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, hh = h7;
    for (t = 0; t < 64; t++) {
      var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      var ch = (e & f) ^ (~e & g);
      var temp1 = (hh + S1 + ch + K[t] + w[t]) >>> 0;
      var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var temp2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + hh) >>> 0;
  }

  var out = new Uint8Array(32), words = [h0, h1, h2, h3, h4, h5, h6, h7], wi;
  for (wi = 0; wi < 8; wi++) {
    out[wi * 4]     = (words[wi] >>> 24) & 0xff;
    out[wi * 4 + 1] = (words[wi] >>> 16) & 0xff;
    out[wi * 4 + 2] = (words[wi] >>> 8) & 0xff;
    out[wi * 4 + 3] = words[wi] & 0xff;
  }
  return out;
}

function bytesToHex(bytes) {
  var s = "", i;
  for (i = 0; i < bytes.length; i++) s += toHex8ByteNibble(bytes[i]);
  return s;
}
function toHex8ByteNibble(b) {
  var h = (b & 0xff).toString(16);
  return h.length === 1 ? "0" + h : h;
}

// sha256 hex of raw bytes.
function sha256HexBytes(bytes) { return bytesToHex(sha256Digest(bytes)); }

// sha256 hex of a string's UTF-8 bytes — byte-identical to the shipped sha256
// gift and to Node's crypto.createHash('sha256').update(String(s)).digest('hex').
function sha256Hex(input) { return sha256HexBytes(utf8Bytes(String(input))); }

/* ------------------------------------------------------------------ *
 * The Merkle fold — RFC 6962.                                         *
 * ------------------------------------------------------------------ */

var LEAF_PREFIX = 0x00;   // RFC 6962 §2.1 — leaf domain separator
var NODE_PREFIX = 0x01;   // RFC 6962 §2.1 — internal-node domain separator
var EMPTY_ROOT =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"; // SHA-256("")

// Concatenate byte arrays into one Uint8Array.
function concatBytes(parts) {
  var total = 0, i;
  for (i = 0; i < parts.length; i++) total += parts[i].length;
  var out = new Uint8Array(total), off = 0, j, p;
  for (i = 0; i < parts.length; i++) {
    p = parts[i];
    for (j = 0; j < p.length; j++) out[off + j] = p[j] & 0xff;
    off += p.length;
  }
  return out;
}

// Hex string (64 chars) -> 32-byte array. Used to glue two child digests.
function hexToBytes(hex) {
  var out = new Uint8Array(hex.length / 2), i;
  for (i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// leafHash(bytes) = SHA-256(0x00 || bytes)  (RFC 6962)
function leafHash(leafBytes) {
  return sha256HexBytes(concatBytes([new Uint8Array([LEAF_PREFIX]), leafBytes]));
}

// nodeHash(leftHex, rightHex) = SHA-256(0x01 || left || right)  (RFC 6962)
function nodeHash(leftHex, rightHex) {
  return sha256HexBytes(concatBytes([
    new Uint8Array([NODE_PREFIX]), hexToBytes(leftHex), hexToBytes(rightHex)
  ]));
}

// The RFC 6962 Merkle Tree Hash over a list of leaf-byte arrays.
//   n == 0 -> SHA-256("")           (the empty tree)
//   n == 1 -> leafHash(D[0])
//   n  > 1 -> nodeHash(MTH(D[0:k]), MTH(D[k:n])), k = largest power of two < n
function merkleRoot(leaves) {
  var n = leaves.length;
  if (n === 0) return EMPTY_ROOT;
  if (n === 1) return leafHash(leaves[0]);
  var k = 1;
  while (k * 2 < n) k *= 2;         // largest power of two strictly smaller than n
  return nodeHash(merkleRoot(leaves.slice(0, k)), merkleRoot(leaves.slice(k)));
}

// Canonical JSON: sort object keys recursively, keep array order.
function canon(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  var keys = Object.keys(v).sort(), i, parts = [];
  for (i = 0; i < keys.length; i++) {
    parts.push(JSON.stringify(keys[i]) + ":" + canon(v[keys[i]]));
  }
  return "{" + parts.join(",") + "}";
}

// Split JSONL text into leaf-byte arrays. Blank lines are skipped. A trailing \r
// (CRLF files) is trimmed so a file's line endings never change the root. Under
// {canon:true} each line is parsed as JSON and re-serialized canonically; a line
// that is not valid JSON throws a clean Error (surfaced as exit 2 at the CLI).
function leavesFromText(text, opts) {
  opts = opts || {};
  var rawLines = String(text).split("\n"), out = [], i, line;
  for (i = 0; i < rawLines.length; i++) {
    line = rawLines[i];
    if (line.charCodeAt(line.length - 1) === 0x0d) line = line.slice(0, -1); // trim \r
    if (line.length === 0) continue; // blank line is not a leaf
    if (opts.canon) {
      var parsed;
      try { parsed = JSON.parse(line); }
      catch (e) { throw new Error("line " + (i + 1) + " is not valid JSON (--canon requires JSON per line)"); }
      out.push(utf8Bytes(canon(parsed)));
    } else {
      out.push(utf8Bytes(line));
    }
  }
  return out;
}

// The public fold: JSONL text -> { root, leaves } (leaves = count).
function fold(text, opts) {
  var leaves = leavesFromText(text, opts);
  return { root: merkleRoot(leaves), leaves: leaves.length };
}

/* ---- exports (browser + Node) ------------------------------------ */
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.merkleFold = fold;
  window.ForestGifts.merkleRoot = merkleRoot;
  window.ForestGifts.sha256Hex = sha256Hex;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    fold: fold, merkleRoot: merkleRoot, leafHash: leafHash, nodeHash: nodeHash,
    leavesFromText: leavesFromText, canon: canon,
    sha256Hex: sha256Hex, sha256HexBytes: sha256HexBytes, EMPTY_ROOT: EMPTY_ROOT
  };
}

/* ---- CLI (runs only when invoked directly, never on require) ------ */
function run(text, opts) {
  var res = fold(text, opts);
  if (opts.json) return JSON.stringify(res) + "\n";
  return res.root + "\n";
}

function main(argv) {
  var args = argv.slice(2);
  if (args.indexOf("--help") !== -1 || args.indexOf("-h") !== -1) {
    process.stdout.write(
      "merkle-fold.js — fold a JSONL leaf stream into one tamper-evident Merkle root.\n\n" +
      "  printf '%s\\n' '\"a\"' '\"b\"' | node merkle-fold.js   root of leaves on stdin\n" +
      "  node merkle-fold.js leaves.jsonl                    root of a file\n" +
      "  node merkle-fold.js --json  < leaves.jsonl          {root, leaves} as JSON\n" +
      "  node merkle-fold.js --canon < leaves.jsonl          hash canonical JSON per line\n" +
      "  node merkle-fold.js --help\n\n" +
      "Each non-blank line is one leaf (RFC 6962: leaf=SHA-256(0x00||d), node=\n" +
      "SHA-256(0x01||l||r), odd node promoted not duplicated). The root fingerprints\n" +
      "the WHOLE ORDERED sequence: reorder, add, drop, or edit a leaf and it changes.\n\n" +
      "Edge: this proves an ordered sequence is intact. It is NOT a set hash\n" +
      "(order matters, by design), NOT a signature (no secret; anyone can recompute),\n" +
      "and NOT encryption.\n"
    );
    return 0;
  }
  var opts = { json: args.indexOf("--json") !== -1, canon: args.indexOf("--canon") !== -1 };
  var files = args.filter(function (a) { return a.charAt(0) !== "-"; });

  function emit(text) {
    try { process.stdout.write(run(text, opts)); return 0; }
    catch (e) { process.stderr.write("merkle-fold: " + e.message + "\n"); return 2; }
  }

  if (files.length > 0) {
    var fs = require("fs");
    var text;
    try { text = fs.readFileSync(files[0], "utf8"); }
    catch (e) {
      process.stderr.write("merkle-fold: cannot read " + files[0] +
        " (" + (e.code === "EISDIR" ? "is a directory" : (e.code || "read error")) + ")\n");
      return 2;
    }
    return emit(text);
  }

  // stdin
  var chunks = [];
  process.stdin.on("data", function (d) { chunks.push(d); });
  process.stdin.on("end", function () {
    var buf = Buffer.concat(chunks);
    process.exitCode = emit(buf.toString("utf8"));
  });
  return 0;
}

if (typeof require !== "undefined" && require.main === module) {
  process.exitCode = main(process.argv);
}
