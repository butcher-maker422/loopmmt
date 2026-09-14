#!/usr/bin/env node
/**
 * hmac-webhook — verify an HMAC-signed webhook before you trust its body.
 *
 * WHAT
 *   A webhook sender (GitHub, Stripe, Shopify, a Loop module) signs each request
 *   body with a shared secret and puts the signature in a header, conventionally
 *       X-Signature: sha256=<hex>
 *   hmac-webhook recomputes HMAC-SHA256(secret, rawBody) and checks it against the
 *   signature the sender sent. It answers ONE question — is this body authentic and
 *   unmodified, from someone who holds the secret? — and answers it in CONSTANT TIME
 *   so a forger cannot learn the right signature one byte at a time from timing.
 *
 *       verify(rawBody, signatureHeader, secret) -> { ok, reason }
 *
 *   ok:true  the body is authentic (the computed MAC equals the presented one).
 *   ok:false reason names WHY it failed — never a partial match, never a maybe:
 *       "no-signature"    the header is empty / missing.
 *       "bad-format"      the header is not "<scheme>=<hex>" with an even-length
 *                         lowercase-normalizable hex body.
 *       "unsupported-scheme" a scheme other than the one asked for (default sha256).
 *       "length-mismatch" the presented digest is not 64 hex chars (32 bytes).
 *       "hmac-mismatch"   well-formed, right length, but the MAC does not match —
 *                         the body was altered, the secret is wrong, or it is a forgery.
 *
 * HOW
 *   HMAC-SHA256 is RFC 2104 exactly: with block size B=64 and the SHA-256 core
 *   vendored from the shipped `sha256` gift (FIPS 180-4, byte-faithful),
 *       K'   = key            if len(key) <= B,   else SHA-256(key)   then zero-padded to B
 *       HMAC = SHA-256( (K' XOR opad) || SHA-256( (K' XOR ipad) || message ) )
 *   ipad is 0x36 repeated B times, opad is 0x5c repeated B times. Everything runs on
 *   RAW BYTES — the message and the key are UTF-8 encoded once — so a multibyte secret
 *   or body is hashed byte-for-byte the same as Node's crypto.createHmac('sha256').
 *   The comparison is a fixed-time XOR-accumulate over the full digest width: it looks
 *   at every byte regardless of where the first difference is, so the pass/fail timing
 *   carries no information about the correct signature.
 *
 *   Pure function of (body, header, secret). No clock, no randomness, no files, no
 *   network. Same three inputs -> same verdict, every run, in Node or a browser.
 *
 * USAGE
 *   node hmac-webhook.js --secret SECRET --signature "sha256=<hex>" [FILE]   # body from FILE or stdin
 *   node hmac-webhook.js --secret SECRET --sign [FILE]     # PRINT the signature for a body (sender side)
 *     printf '%s' '{"event":"ping"}' | node hmac-webhook.js --secret s3cr3t --sign
 *       -> sha256=<hex>
 *     printf '%s' '{"event":"ping"}' | node hmac-webhook.js --secret s3cr3t --signature "sha256=<hex>"
 *       -> exits 0 (authentic) and prints "ok"; exits 1 and prints the reason otherwise.
 *   --scheme NAME   signature scheme label to require/emit (default "sha256").
 *   --help
 *
 *   In a browser: window.ForestGifts.hmacWebhook.{verify, sign, hmacSha256Hex}.
 *
 * EXIT CODES (CLI)
 *   0  verify: authentic.            (--sign always exits 0 on success.)
 *   1  verify: NOT authentic — the reason is printed on stdout (one word) + stderr.
 *   2  usage / input error: missing --secret, missing --signature (without --sign),
 *      a file that is a directory or cannot be read. One clean line on stderr.
 *
 * EDGE (what this is NOT)
 *   NOT a signer's secret store — you supply the secret; it is never persisted.
 *   NOT a replay defender — it proves authenticity of THIS body, not that the body
 *   is fresh; pair it with a timestamp/nonce check if you need replay protection.
 *   NOT a TLS or transport check, NOT an authorization system (authentic != allowed),
 *   and NOT a multi-algorithm negotiator — it verifies ONE scheme (sha256) you name.
 *
 * Zero dependencies. Node builtin `require('fs')` for file reads only; runs in a
 * browser with no require. MIT.
 */
"use strict";

/* ------------------------------------------------------------------ *
 * SHA-256 core — vendored from the `sha256` gift (FIPS 180-4),        *
 * byte-faithful, with the raw-bytes entry HMAC needs. The block       *
 * machinery is IDENTICAL to the shipped sha256 gift and to            *
 * Node crypto's sha256; a mismatch here is a rebuild failure.         *
 * ------------------------------------------------------------------ */

// Round constants — FIPS 180-4 §4.2.2.
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

// UTF-8 encode a JS string to a byte array — the SAME bytes Node's
// .update(String(s)) hashes (surrogate-pair aware fallback matches TextEncoder).
function utf8Bytes(str) {
  if (typeof TextEncoder !== "undefined") {
    return Array.prototype.slice.call(new TextEncoder().encode(str));
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

// sha256 of RAW BYTES (array-like of 0..255) -> a 32-byte Array digest.
function sha256Digest(bytes) {
  var len = bytes.length;
  var bitLenHi = Math.floor(len / 0x20000000);
  var bitLenLo = (len * 8) >>> 0;
  var withOne = len + 1;
  var padded = (withOne + 8 + 63) & ~63;
  var msg = new Array(padded);
  var i;
  for (i = 0; i < padded; i++) msg[i] = 0;
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

  var out = new Array(32), words = [h0, h1, h2, h3, h4, h5, h6, h7], wi;
  for (wi = 0; wi < 8; wi++) {
    out[wi * 4]     = (words[wi] >>> 24) & 0xff;
    out[wi * 4 + 1] = (words[wi] >>> 16) & 0xff;
    out[wi * 4 + 2] = (words[wi] >>> 8) & 0xff;
    out[wi * 4 + 3] = words[wi] & 0xff;
  }
  return out;
}

function byteToHex(b) {
  var h = (b & 0xff).toString(16);
  return h.length === 1 ? "0" + h : h;
}
function bytesToHex(bytes) {
  var s = "", i;
  for (i = 0; i < bytes.length; i++) s += byteToHex(bytes[i]);
  return s;
}

/* ------------------------------------------------------------------ *
 * HMAC-SHA256 — RFC 2104.                                             *
 * ------------------------------------------------------------------ */

var BLOCK = 64;   // SHA-256 block size in bytes (RFC 2104 "B").

// key: byte array. Returns the B-byte K' (hashed-if-long, zero-padded).
function normalizeKey(keyBytes) {
  var k = keyBytes;
  if (k.length > BLOCK) k = sha256Digest(k);   // K longer than a block -> hash it first.
  var out = new Array(BLOCK), i;
  for (i = 0; i < BLOCK; i++) out[i] = (i < k.length ? (k[i] & 0xff) : 0);
  return out;
}

// HMAC-SHA256 over raw byte arrays -> 32-byte digest array.
function hmacSha256Bytes(keyBytes, msgBytes) {
  var kp = normalizeKey(keyBytes);
  var ipad = new Array(BLOCK), opad = new Array(BLOCK), i;
  for (i = 0; i < BLOCK; i++) {
    ipad[i] = kp[i] ^ 0x36;
    opad[i] = kp[i] ^ 0x5c;
  }
  var inner = sha256Digest(ipad.concat(msgBytes));       // H((K' ^ ipad) || m)
  return sha256Digest(opad.concat(inner));               // H((K' ^ opad) || inner)
}

// HMAC-SHA256 hex of (secret string, message string), UTF-8 encoded — byte-identical
// to Node crypto.createHmac('sha256', secret).update(message).digest('hex').
function hmacSha256Hex(secret, message) {
  return bytesToHex(hmacSha256Bytes(utf8Bytes(String(secret)), utf8Bytes(String(message))));
}

/* ------------------------------------------------------------------ *
 * The verifier.                                                       *
 * ------------------------------------------------------------------ */

var HEX_RE = /^[0-9a-f]+$/;

// Constant-time equality of two equal-length lowercase-hex strings. Looks at every
// character; the running OR of per-char differences carries no early-exit timing.
// Caller MUST have already checked the lengths match (a length difference is not a
// secret — it is public structure — so it is decided before this point).
function constantTimeHexEqual(a, b) {
  var diff = 0, i;
  for (i = 0; i < a.length; i++) diff |= (a.charCodeAt(i) ^ b.charCodeAt(i));
  return diff === 0;
}

// Parse "<scheme>=<hex>" -> { scheme, hex } or null if it is not that shape.
function parseSignatureHeader(header) {
  if (typeof header !== "string") return null;
  var s = header.trim();
  var eq = s.indexOf("=");
  if (eq <= 0 || eq === s.length - 1) return null;   // no scheme, or nothing after '='
  var scheme = s.slice(0, eq);
  var hex = s.slice(eq + 1).toLowerCase();
  if (!HEX_RE.test(hex) || (hex.length % 2) !== 0) return null;   // must be even-length hex
  return { scheme: scheme, hex: hex };
}

/**
 * Verify a signed webhook body.
 * @param {string} rawBody   the exact bytes the sender signed (a string; UTF-8 hashed).
 * @param {string} signatureHeader   e.g. "sha256=abcd..." from the request header.
 * @param {string} secret   the shared secret.
 * @param {{scheme?: string}} [opts]   scheme to require (default "sha256").
 * @returns {{ok: boolean, reason: string}}   reason is "" on success.
 */
function verify(rawBody, signatureHeader, secret, opts) {
  opts = opts || {};
  var wantScheme = opts.scheme || "sha256";
  if (signatureHeader === undefined || signatureHeader === null || String(signatureHeader).trim() === "") {
    return { ok: false, reason: "no-signature" };
  }
  var parsed = parseSignatureHeader(String(signatureHeader));
  if (!parsed) return { ok: false, reason: "bad-format" };
  if (parsed.scheme !== wantScheme) return { ok: false, reason: "unsupported-scheme" };
  // A SHA-256 digest is exactly 32 bytes = 64 hex chars. Length is public structure,
  // decided before the constant-time compare (which requires equal lengths).
  if (parsed.hex.length !== 64) return { ok: false, reason: "length-mismatch" };
  var expected = hmacSha256Hex(secret, rawBody);   // always 64 lowercase hex chars
  if (constantTimeHexEqual(expected, parsed.hex)) return { ok: true, reason: "" };
  return { ok: false, reason: "hmac-mismatch" };
}

/**
 * Produce the signature header a sender would send for a body (the sender side).
 * @returns {string} e.g. "sha256=abcd..."
 */
function sign(rawBody, secret, opts) {
  opts = opts || {};
  var scheme = opts.scheme || "sha256";
  return scheme + "=" + hmacSha256Hex(secret, rawBody);
}

/* ---- exports ---- */
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.hmacWebhook = {
    verify: verify, sign: sign, hmacSha256Hex: hmacSha256Hex,
    parseSignatureHeader: parseSignatureHeader
  };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    verify: verify, sign: sign, hmacSha256Hex: hmacSha256Hex,
    parseSignatureHeader: parseSignatureHeader, constantTimeHexEqual: constantTimeHexEqual
  };
}

/* ------------------------------------------------------------------ *
 * CLI.                                                                *
 * ------------------------------------------------------------------ */

function readAll(stream, cb) {
  var chunks = [];
  stream.on("data", function (d) { chunks.push(d); });
  stream.on("end", function () { cb(Buffer.concat(chunks).toString("utf8")); });
}

function usage() {
  return "usage: hmac-webhook.js --secret SECRET (--sign | --signature 'sha256=<hex>') [--scheme NAME] [FILE]";
}

function main(argv) {
  var args = argv.slice(2);
  var secret = null, signature = null, scheme = "sha256", doSign = false, file = null, i;
  for (i = 0; i < args.length; i++) {
    var a = args[i];
    if (a === "--help" || a === "-h") { process.stdout.write(usage() + "\n"); process.exit(0); }
    else if (a === "--secret") { secret = args[++i]; }
    else if (a === "--signature") { signature = args[++i]; }
    else if (a === "--scheme") { scheme = args[++i]; }
    else if (a === "--sign") { doSign = true; }
    else if (a.slice(0, 2) === "--") { process.stderr.write("hmac-webhook: unknown option " + a + "\n" + usage() + "\n"); process.exit(2); }
    else { file = a; }
  }
  if (secret === null || secret === undefined) { process.stderr.write("hmac-webhook: --secret is required\n" + usage() + "\n"); process.exit(2); }
  if (!doSign && (signature === null || signature === undefined)) {
    process.stderr.write("hmac-webhook: --signature is required (or use --sign to produce one)\n" + usage() + "\n");
    process.exit(2);
  }

  function run(body) {
    if (doSign) {
      process.stdout.write(sign(body, secret, { scheme: scheme }) + "\n");
      process.exit(0);
    }
    var r = verify(body, signature, secret, { scheme: scheme });
    if (r.ok) { process.stdout.write("ok\n"); process.exit(0); }
    process.stdout.write(r.reason + "\n");
    process.stderr.write("hmac-webhook: verification failed (" + r.reason + ")\n");
    process.exit(1);
  }

  if (file) {
    var fs = require("fs");
    var stat;
    try { stat = fs.statSync(file); } catch (e) { process.stderr.write("hmac-webhook: cannot read " + file + "\n"); process.exit(2); }
    if (stat.isDirectory()) { process.stderr.write("hmac-webhook: " + file + " is a directory\n"); process.exit(2); }
    run(fs.readFileSync(file, "utf8"));
  } else {
    readAll(process.stdin, run);
  }
}

if (typeof require !== "undefined" && require.main === module) {
  main(process.argv);
}
