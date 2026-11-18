#!/usr/bin/env node
/* test_sha256_bytes.js — the raw-bytes entry point (sha256Bytes, added S28.0232), held to Node's crypto as the oracle.
   Every byte value; every length across the padding boundaries (0..200: 55/56/63/64/119/120 are where SHA-256's padding
   changes shape); seeded random binary; a digest joined to new bytes (the hash-chain use); and sha256Hex unchanged by the
   refactor (it is now sha256Bytes over the UTF-8 of its input). Run: node test_sha256_bytes.js */
"use strict";
var crypto = require("crypto");
var G = require("./sha256.js");
var pass = 0, fail = 0;
function eq(name, got, want) { if (got === want) pass++; else { fail++; console.log("FAIL " + name + "\n  got  " + got + "\n  want " + want); } }
var hex = function (u8) { return Buffer.from(u8).toString("hex"); };
var oracle = function (bytes) { return crypto.createHash("sha256").update(Buffer.from(bytes)).digest("hex"); };
var all = []; for (var b = 0; b < 256; b++) all.push(b);
eq("all 256 byte values", hex(G.sha256Bytes(Uint8Array.from(all))), oracle(all));
for (var n = 0; n <= 200; n++) {
  var x = []; for (var i = 0; i < n; i++) x.push((i * 131 + 7) & 0xff);
  eq("length " + n, hex(G.sha256Bytes(Uint8Array.from(x))), oracle(x));
}
var s = 0x2545f491;
for (var k = 0; k < 50; k++) {
  var len = (s >>> 3) % 1000, r = [];
  for (var j = 0; j < len; j++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; r.push(s & 0xff); }
  eq("seeded binary " + k, hex(G.sha256Bytes(Uint8Array.from(r))), oracle(r));
}
eq("a plain array of 0..255 is accepted as bytes", hex(G.sha256Bytes([0, 255, 128])), oracle([0, 255, 128]));
var head = G.sha256Bytes(new TextEncoder().encode("genesis")), tick = new TextEncoder().encode('{"t":0}');
var joined = new Uint8Array(head.length + tick.length); joined.set(head, 0); joined.set(tick, head.length);
eq("a digest joined to new bytes (a hash chain's step)", hex(G.sha256Bytes(joined)), oracle(joined));
eq("the digest is 32 bytes", String(G.sha256Bytes([]).length), "32");
["", "abc", "Zoë 😀 Lúcia", "x".repeat(1000)].forEach(function (str) {
  eq("sha256Hex unchanged: " + JSON.stringify(str).slice(0, 20), G.sha256Hex(str), crypto.createHash("sha256").update(str).digest("hex"));
});
console.log("\nsha256 bytes: " + pass + " passed, " + fail + " failed (oracle: node crypto)");
process.exit(fail === 0 ? 0 : 1);
