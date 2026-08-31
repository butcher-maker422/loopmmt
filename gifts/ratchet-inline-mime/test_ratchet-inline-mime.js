#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/* test_ratchet-inline-mime.js — proves the parser implements its stated contract.

   THE ORACLE. There is no Node stdlib that says "is this MIME parsed right?" — the
   RFCs are the spec, so the oracle is CURATED VECTORS expressed directly against
   what parseMime promises: (1) header unfolding + case-insensitive access,
   (2) Content-Type value + parameter parsing (quoted params), (3) body decode per
   Content-Transfer-Encoding (base64, quoted-printable incl. soft breaks, identity),
   (4) charset decode (utf-8 multibyte, latin1 byte-preserving), (5) multipart split
   with preamble/epilogue discarded, (6) recursive nested multipart, (7) RFC 2047
   encoded words in headers (B and Q). Plus determinism and a mutation-bite so a
   degenerate core (ignores input / constant verdict) cannot pass green.
   Exit 0 = all pass; exit 1 = a failure (loud). stdlib only. */
"use strict";
var m = require("./ratchet-inline-mime.js");
var parseMime = m.parseMime;

var pass = 0, fail = 0;
function ok(label, cond) { if (cond) { pass++; } else { fail++; console.error("FAIL  " + label); } }
function eq(label, a, b) { ok(label + " (=" + JSON.stringify(b) + ")", a === b); }
function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

var CRLF = "\r\n";
function msg(lines) { return lines.join(CRLF); }

// ---- 1. headers: unfolding + case-insensitive map --------------------------
var h = parseMime(msg([
  "Subject: a very long subject that the",
  "\tsender folded across two lines",
  "X-Mixed-Case: Value",
  "Content-Type: text/plain",
  "",
  "body"
]));
eq("unfolded subject", h.headers.subject, "a very long subject that the sender folded across two lines");
eq("case-insensitive header key", h.headers["x-mixed-case"], "Value");
eq("leaf body plain", h.body, "body");
eq("plain is not multipart", h.isMultipart, false);

// ---- 2. Content-Type value + params (quoted) -------------------------------
var ct = parseMime(msg([ "Content-Type: text/plain; charset=\"UTF-8\"; format=flowed", "", "x" ]));
eq("content-type lowercased", ct.contentType, "text/plain");
eq("param charset (unquoted)", ct.contentTypeParams.charset, "UTF-8");
eq("param format", ct.contentTypeParams.format, "flowed");

// ---- 3. transfer-encodings -------------------------------------------------
var b64 = parseMime(msg([ "Content-Type: text/plain", "Content-Transfer-Encoding: base64", "", "SGVsbG8sIHdvcmxk" ]));
eq("base64 decoded", b64.body, "Hello, world");
eq("encoding recorded", b64.encoding, "base64");

var qp = parseMime(msg([ "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: quoted-printable", "", "Price: 5=E2=82=AC end" ]));
eq("quoted-printable euro", qp.body, "Price: 5\u20ac end");

var qpSoft = parseMime(msg([ "Content-Transfer-Encoding: quoted-printable", "", "soft=", "wrap" ]));
eq("qp soft line break joins", qpSoft.body, "softwrap");

var seven = parseMime(msg([ "Content-Type: text/plain", "", "plain 7bit text" ]));
eq("7bit identity", seven.body, "plain 7bit text");

// ---- 4. charset ------------------------------------------------------------
// utf-8 multibyte: e2 98 83 = snowman U+2603
var utf = parseMime(msg([ "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", "4piD" ]));
eq("utf-8 multibyte snowman", utf.body, "\u2603");
// latin1: byte 0xE9 = é (byte-preserving, not utf-8)
var latin = parseMime(msg([ "Content-Type: text/plain; charset=iso-8859-1", "Content-Transfer-Encoding: quoted-printable", "", "caf=E9" ]));
eq("latin1 byte-preserving", latin.body, "caf\u00e9");

// ---- 5. multipart split, preamble/epilogue discarded -----------------------
var mp = parseMime(msg([
  "Content-Type: multipart/alternative; boundary=\"BND\"",
  "",
  "PREAMBLE — must be ignored",
  "--BND",
  "Content-Type: text/plain",
  "",
  "first part",
  "--BND",
  "Content-Type: text/html",
  "",
  "<p>second</p>",
  "--BND--",
  "EPILOGUE — must be ignored"
]));
eq("multipart flagged", mp.isMultipart, true);
eq("part count (preamble/epilogue dropped)", mp.parts.length, 2);
eq("part 0 body", mp.parts[0].body, "first part");
eq("part 0 type", mp.parts[0].contentType, "text/plain");
eq("part 1 body", mp.parts[1].body, "<p>second</p>");
eq("part 1 type", mp.parts[1].contentType, "text/html");
ok("multipart leaf has no body field", mp.body === undefined);

// ---- 6. nested multipart (mixed containing alternative) --------------------
var nested = parseMime(msg([
  "Content-Type: multipart/mixed; boundary=OUT",
  "",
  "--OUT",
  "Content-Type: multipart/alternative; boundary=IN",
  "",
  "--IN",
  "Content-Type: text/plain",
  "",
  "inner text",
  "--IN--",
  "--OUT",
  "Content-Type: application/octet-stream",
  "Content-Transfer-Encoding: base64",
  "",
  "QUJD",
  "--OUT--"
]));
eq("outer multipart", nested.isMultipart, true);
eq("outer part count", nested.parts.length, 2);
eq("inner is multipart", nested.parts[0].isMultipart, true);
eq("inner leaf body", nested.parts[0].parts[0].body, "inner text");
eq("sibling base64 leaf", nested.parts[1].body, "ABC");

// ---- 7. RFC 2047 encoded words in headers ----------------------------------
var ew = parseMime(msg([
  "Subject: =?utf-8?B?SGVsbG8sIOKCrA==?=",
  "From: =?utf-8?Q?Andr=C3=A9?= <a@x.io>",
  "Content-Type: text/plain",
  "",
  "x"
]));
eq("encoded-word B subject", ew.headers.subject, "Hello, \u20ac");
eq("encoded-word Q from", ew.headers.from, "Andr\u00e9 <a@x.io>");
eq("Q underscore is space", m.decodeEncodedWords("=?utf-8?Q?a_b?="), "a b");

// ---- direct codec probes ---------------------------------------------------
eq("decodeBase64 -> bytes", m.bytesToString(m.decodeBase64("QUJD"), "ascii"), "ABC");
eq("base64 tolerates newlines", m.bytesToString(m.decodeBase64("QU\nJD"), "ascii"), "ABC");
eq("base64 missing padding", m.bytesToString(m.decodeBase64("QUJDRA"), "ascii"), "ABCD");

// ---- determinism -----------------------------------------------------------
ok("parse is deterministic", deepEqual(parseMime(mp === mp ? msg([
  "Content-Type: multipart/mixed; boundary=Z", "", "--Z", "Content-Type: text/plain", "", "a", "--Z--"
]) : ""), parseMime(msg([
  "Content-Type: multipart/mixed; boundary=Z", "", "--Z", "Content-Type: text/plain", "", "a", "--Z--"
]))));

// ---- mutation-bite: the core must actually discriminate --------------------
// A parser that ignored its input, or hard-coded a verdict, would collapse these.
ok("bite: multipart vs simple differ", parseMime("Content-Type: multipart/x; boundary=b\r\n\r\n--b\r\n\r\nq\r\n--b--").isMultipart !==
                                        parseMime("Content-Type: text/plain\r\n\r\nq").isMultipart);
ok("bite: base64 body != its raw", (function () {
  var n = parseMime("Content-Transfer-Encoding: base64\r\n\r\nSGk=");
  return n.body === "Hi" && n.bodyRaw !== "Hi";
})());
ok("bite: distinct headers -> distinct values",
   parseMime("Subject: one\r\n\r\n").headers.subject !== parseMime("Subject: two\r\n\r\n").headers.subject);

console.log("\nratchet-inline-mime: " + pass + " passed, " + fail + " failed" +
  " (header unfold + params + base64/QP/7bit + utf-8/latin1 + multipart split + " +
  "nested + RFC2047 B/Q + codec probes + determinism + mutation-bite)");
process.exit(fail === 0 ? 0 : 1);
