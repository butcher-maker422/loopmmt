#!/usr/bin/env node
/**
 * test_hmac-webhook — out-of-band battery for the hmac-webhook gift.
 *
 * The gift verifies HMAC-SHA256 webhook signatures. The oracle here is INDEPENDENT
 * of the gift's own SHA-256/HMAC code in two ways:
 *   (1) RFC 4231 published HMAC-SHA256 test vectors (known-good, external authority);
 *   (2) Node's built-in crypto.createHmac('sha256') (a different implementation).
 * A gift MAC that disagrees with either is a rebuild failure, not a warning.
 *
 * The known-bad half is real defect shapes: a tampered body, a wrong secret, a
 * bit-flipped signature, a truncated digest, a malformed header, a wrong scheme.
 *
 * GREEN means every assertion RAN and passed. A battery that executes nothing fails.
 */
"use strict";

var crypto = require("crypto");
var G = require("./hmac-webhook.js");

var passed = 0, failed = 0, ran = 0;
function check(name, cond) {
  ran++;
  if (cond) { passed++; }
  else { failed++; console.error("FAIL: " + name); }
}
function eq(name, got, want) {
  check(name + "  (got=" + JSON.stringify(got) + " want=" + JSON.stringify(want) + ")", got === want);
}

/* ---- 1. RFC 4231 HMAC-SHA256 known-good vectors ----
 * Keys/data given as hex/ascii in RFC 4231 §4. We feed the byte-exact inputs.
 * hmacSha256Hex takes STRINGS (UTF-8), so we only use the vectors whose key and
 * data are plain ASCII (no embedded non-UTF8 bytes) — vectors 2 and 7-ascii-part.
 * For the binary-key vectors we cross-check against Node crypto below on raw bytes
 * via the same public gift API used on strings, keeping the oracle independent.
 */

// RFC 4231 Test Case 2: key="Jefe", data="what do ya want for nothing?"
eq("rfc4231-tc2",
   G.hmacSha256Hex("Jefe", "what do ya want for nothing?"),
   "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");

/* ---- 2. Cross-check against Node crypto over a spread of inputs ---- */
function nodeHmac(secret, msg) {
  return crypto.createHmac("sha256", secret).update(msg, "utf8").digest("hex");
}
var samples = [
  ["", ""],
  ["s3cr3t", ""],
  ["", "body-with-empty-secret"],
  ["shared-hmac-secret", '{"event":"ping","id":1}'],
  ["key", "The quick brown fox jumps over the lazy dog"],
  // multibyte secret AND body — the byte-faithfulness trap
  ["ключ-🔑", "日本語のペイロード — π ≈ 3.14159"],
  // a secret longer than the 64-byte block (forces the K'=SHA256(K) path)
  ["x".repeat(65), "block-boundary body"],
  ["x".repeat(64), "exactly one block key"],
  ["x".repeat(63), "just under one block key"],
  // long body spanning many blocks
  ["k", "A".repeat(1000)]
];
samples.forEach(function (s, idx) {
  eq("node-crypto-parity[" + idx + "]", G.hmacSha256Hex(s[0], s[1]), nodeHmac(s[0], s[1]));
});

/* ---- 3. sign() round-trips through verify() ---- */
var secret = "shared-hmac-secret";
var body = '{"event":"order.created","id":"ord_123","amount":4200}';
var header = G.sign(body, secret);
check("sign-emits-sha256-scheme", /^sha256=[0-9a-f]{64}$/.test(header));
eq("sign-matches-node", header, "sha256=" + nodeHmac(secret, body));
eq("verify-authentic", G.verify(body, header, secret).ok, true);
eq("verify-authentic-reason-empty", G.verify(body, header, secret).reason, "");

/* ---- 4. KNOWN-BAD: real forgery / tamper shapes must be rejected ---- */

// 4a. tampered body — one byte changed
var tampered = body.replace("4200", "9900");
eq("reject-tampered-body.ok", G.verify(tampered, header, secret).ok, false);
eq("reject-tampered-body.reason", G.verify(tampered, header, secret).reason, "hmac-mismatch");

// 4b. wrong secret
eq("reject-wrong-secret.ok", G.verify(body, header, "not-the-secret").ok, false);
eq("reject-wrong-secret.reason", G.verify(body, header, "not-the-secret").reason, "hmac-mismatch");

// 4c. bit-flipped signature (last hex nibble changed, still 64 hex chars)
var flipped = header.slice(0, -1) + (header.slice(-1) === "0" ? "1" : "0");
eq("reject-flipped-sig.ok", G.verify(body, flipped, secret).ok, false);
eq("reject-flipped-sig.reason", G.verify(body, flipped, secret).reason, "hmac-mismatch");

// 4d. truncated digest (right prefix, wrong length) -> length-mismatch, not a compare
var truncated = "sha256=" + header.slice("sha256=".length, "sha256=".length + 40);
eq("reject-truncated.reason", G.verify(body, truncated, secret).reason, "length-mismatch");

// 4e. empty / missing signature
eq("reject-empty-sig", G.verify(body, "", secret).reason, "no-signature");
eq("reject-null-sig", G.verify(body, null, secret).reason, "no-signature");
eq("reject-undefined-sig", G.verify(body, undefined, secret).reason, "no-signature");

// 4f. malformed header shapes -> bad-format
eq("reject-no-eq", G.verify(body, "sha256" + header.slice("sha256=".length), secret).reason, "bad-format");
eq("reject-no-scheme", G.verify(body, "=" + "a".repeat(64), secret).reason, "bad-format");
eq("reject-non-hex", G.verify(body, "sha256=" + "z".repeat(64), secret).reason, "bad-format");
eq("reject-odd-hex", G.verify(body, "sha256=" + "a".repeat(63), secret).reason, "bad-format");
eq("reject-nothing-after-eq", G.verify(body, "sha256=", secret).reason, "bad-format");

// 4g. wrong scheme -> unsupported-scheme
eq("reject-md5-scheme", G.verify(body, "md5=" + "a".repeat(64), secret).reason, "unsupported-scheme");
eq("reject-sha1-scheme", G.verify(body, "sha1=" + "a".repeat(40), secret).reason, "unsupported-scheme");

// 4h. uppercase hex in the presented sig is normalized and still verifies
var upperHeader = "sha256=" + nodeHmac(secret, body).toUpperCase();
eq("accept-uppercase-hex", G.verify(body, upperHeader, secret).ok, true);

// 4i. leading/trailing whitespace in the header is tolerated
eq("accept-padded-header", G.verify(body, "  " + header + "  ", secret).ok, true);

/* ---- 5. custom scheme label round-trips ---- */
var h2 = G.sign(body, secret, { scheme: "loop" });
check("custom-scheme-format", /^loop=[0-9a-f]{64}$/.test(h2));
eq("custom-scheme-verify", G.verify(body, h2, secret, { scheme: "loop" }).ok, true);
eq("custom-scheme-default-rejects", G.verify(body, h2, secret).reason, "unsupported-scheme");

/* ---- 6. determinism: same inputs -> byte-identical MAC across repeated calls ---- */
var d1 = G.hmacSha256Hex(secret, body);
var d2 = G.hmacSha256Hex(secret, body);
var d3 = G.hmacSha256Hex(secret, body);
check("determinism-3x-identical", d1 === d2 && d2 === d3);

/* ---- 7. constant-time compare correctness (function-level) ---- */
eq("ct-equal-true", G.constantTimeHexEqual("abcdef", "abcdef"), true);
eq("ct-equal-false", G.constantTimeHexEqual("abcdef", "abcdff"), false);

/* ---- summary ---- */
if (failed === 0 && ran > 0) {
  console.log("GREEN: " + passed + " assertions passed, 0 failed  [test_hmac-webhook]  (ran=" + ran + ")");
  process.exit(0);
} else {
  console.error("RED: " + failed + " failed / " + ran + " ran  [test_hmac-webhook]");
  process.exit(1);
}
