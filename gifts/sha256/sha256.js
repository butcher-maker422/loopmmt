#!/usr/bin/env node
/* sha256.js — a dependency-free, synchronous SHA-256 (hex out) that is
   byte-identical to your backend's hash for the same string.

   WHY THIS EXISTS. The usual browser answer, crypto.subtle.digest, is
   ASYNCHRONOUS — it returns a Promise, so the moment you need a hash inside an
   otherwise-synchronous verify path (parse an envelope, check an integrity
   field, decide tamper/no-tamper), it forces that whole path to go async and
   ripple through everything that calls it. This is a small, pure, sync
   FIPS-180-4 SHA-256 that returns the SAME 64-char hex as Node's
   crypto.createHash('sha256').update(String(x)).digest('hex') — so a browser
   can mirror a Node integrity check without turning the call site async.

   THE ONE FIDELITY RULE (the whole reason to trust it). Node hashes the UTF-8
   BYTES of String(input). This encodes with the same UTF-8 byte stream, so the
   digest is identical — including for multibyte characters (accented names,
   emoji, non-Latin scripts). Never hash char codes: multibyte input would
   diverge silently and a tamper check would read a FALSE verdict. The test
   battery carries a multibyte vector precisely to catch that, checked against
   Node's own crypto as the oracle.

   Pure function of its input. No dependencies. Same code runs in a browser
   (attach sha256Hex to your namespace) or on Node (this CLI / require()).

   USAGE
     node sha256.js "the string to hash"      # hash an argument
     echo -n "the string" | node sha256.js    # hash stdin (exact bytes, no newline added)
     node sha256.js --help

   Released under MIT. Its edge is printed in the README: this is a HASH, not
   an HMAC and not encryption — it proves two inputs match, it does not keep a
   secret and it is not a password-storage KDF.
*/
"use strict";

// SHA-256 round constants — FIPS 180-4 §4.2.2 (first 32 bits of the fractional
// parts of the cube roots of the first 64 primes).
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

// Encode a JS string to its UTF-8 bytes — the SAME bytes Node's
// .update(String(s)) hashes. TextEncoder is present in every modern browser and
// in Node; the manual fallback (surrogate-pair aware) produces the same stream.
function utf8Bytes(str) {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(str);
  }
  var out = [], i, c, lo;
  for (i = 0; i < str.length; i++) {
    c = str.charCodeAt(i);
    if (c < 0x80) { out.push(c); }
    else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
    else if (c >= 0xd800 && c <= 0xdbff) { // high surrogate
      lo = str.charCodeAt(++i);
      c = 0x10000 + ((c & 0x3ff) << 10) + (lo & 0x3ff);
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
  }
  return out;
}

function toHex8(x) {
  var h = (x >>> 0).toString(16);
  return "00000000".slice(h.length) + h;
}

// sha256Hex(input) -> 64-char lowercase hex, byte-identical to Node's
// crypto.createHash('sha256').update(String(input)).digest('hex').
function sha256Hex(input) {
  var bytes = utf8Bytes(String(input));
  var len = bytes.length;

  // Padding: append 0x80, then 0x00s, then the 64-bit big-endian bit length,
  // rounding up to a multiple of 64 bytes.
  var bitLenHi = Math.floor(len / 0x20000000); // high 32 bits of (len*8)
  var bitLenLo = (len * 8) >>> 0;              // low 32 bits of (len*8)
  var withOne = len + 1;
  var padded = (withOne + 8 + 63) & ~63;
  var msg = new Uint8Array(padded);
  var i;
  for (i = 0; i < len; i++) msg[i] = bytes[i];
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

  return toHex8(h0) + toHex8(h1) + toHex8(h2) + toHex8(h3) +
         toHex8(h4) + toHex8(h5) + toHex8(h6) + toHex8(h7);
}

// Browser: attach to a namespace. Node/require: export. CLI: run below.
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.sha256Hex = sha256Hex;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { sha256Hex: sha256Hex };
}

// ---- CLI (runs only when invoked directly, never on require) ----------------
function main(argv) {
  var args = argv.slice(2);
  if (args.indexOf("--help") !== -1 || args.indexOf("-h") !== -1) {
    process.stdout.write(
      "sha256.js — dependency-free sync SHA-256, hex out (byte-identical to Node crypto).\n\n" +
      "  node sha256.js \"a string\"          hash the argument\n" +
      "  echo -n \"a string\" | node sha256.js  hash stdin (exact bytes, no newline added)\n" +
      "  node sha256.js --help\n\n" +
      "Edge: this is a hash, not an HMAC and not encryption. It proves two inputs\n" +
      "match; it keeps no secret and is not a password KDF.\n"
    );
    return 0;
  }
  if (args.length > 0) {
    process.stdout.write(sha256Hex(args[0]) + "\n");
    return 0;
  }
  // stdin: hash the exact bytes received (no trailing newline added).
  var chunks = [];
  process.stdin.on("data", function (d) { chunks.push(d); });
  process.stdin.on("end", function () {
    var buf = Buffer.concat(chunks);
    // Hash the exact received bytes: decode as UTF-8 back to the string whose
    // UTF-8 bytes are these bytes (round-trips for valid UTF-8 input).
    process.stdout.write(sha256Hex(buf.toString("utf8")) + "\n");
  });
  return 0;
}

if (typeof require !== "undefined" && require.main === module) {
  process.exitCode = main(process.argv);
}
