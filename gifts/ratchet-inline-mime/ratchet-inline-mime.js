#!/usr/bin/env node
// SPDX-License-Identifier: MIT
"use strict";
/* ratchet-inline-mime.js — a zero-dependency MIME message parser.

   Hand it a raw RFC 822 / MIME message (an .eml, a saved email, a raw HTTP
   multipart body) and it returns a structured tree: unfolded headers, a parsed
   Content-Type with its parameters, and — for each leaf — a body decoded per its
   Content-Transfer-Encoding (base64 / quoted-printable / 7bit / 8bit / binary)
   and charset (utf-8 / ascii / latin1). multipart/* bodies are split on their
   boundary and each part parsed recursively, to any depth. RFC 2047 encoded
   words in header values (=?utf-8?B?..?= / =?..?Q?..?=) are decoded too.

   Pure functions, no dependencies, no filesystem, no DOM — the same code runs in
   Node (module.exports) or a browser (window.LoopGifts.parseMime). It parses a
   message you already hold as text; it does not fetch, connect, or read files. */

// ---- base64 (pure; tolerates whitespace and missing padding) ---------------
var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function decodeBase64(str) {
  var lut = decodeBase64._lut;
  if (!lut) { lut = decodeBase64._lut = {}; for (var i = 0; i < B64.length; i++) lut[B64.charAt(i)] = i; }
  var out = [], buffer = 0, bits = 0;
  for (var j = 0; j < str.length; j++) {
    var c = str.charAt(j);
    if (c === "=") break;
    var v = lut[c];
    if (v === undefined) continue; // skip newlines/whitespace/stray chars
    buffer = (buffer << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buffer >> bits) & 0xff); }
  }
  return out;
}

// ---- quoted-printable (=XX bytes, soft line breaks) ------------------------
function decodeQuotedPrintable(str) {
  var out = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charAt(i);
    if (c === "=") {
      if (str.charAt(i + 1) === "\r" && str.charAt(i + 2) === "\n") { i += 2; continue; } // soft break
      if (str.charAt(i + 1) === "\n") { i += 1; continue; }                                // soft break (LF)
      var hex = str.substr(i + 1, 2);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) { out.push(parseInt(hex, 16)); i += 2; continue; }
      out.push(0x3d); // stray '=' kept literal
    } else {
      out.push(c.charCodeAt(0) & 0xff);
    }
  }
  return out;
}

// ---- bytes -> string, honest about the charsets it actually decodes ---------
function utf8Decode(bytes) {
  var out = "", i = 0, n = bytes.length;
  while (i < n) {
    var b = bytes[i++];
    if (b < 0x80) { out += String.fromCharCode(b); }
    else if (b >= 0xc0 && b < 0xe0) { out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f)); }
    else if (b >= 0xe0 && b < 0xf0) { var c1 = bytes[i++] & 0x3f, c2 = bytes[i++] & 0x3f; out += String.fromCharCode(((b & 0x0f) << 12) | (c1 << 6) | c2); }
    else if (b >= 0xf0) {
      var d1 = bytes[i++] & 0x3f, d2 = bytes[i++] & 0x3f, d3 = bytes[i++] & 0x3f;
      var cp = (((b & 0x07) << 18) | (d1 << 12) | (d2 << 6) | d3) - 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    } else { out += "\ufffd"; }
  }
  return out;
}
function bytesToString(bytes, charset) {
  charset = (charset || "utf-8").toLowerCase();
  if (charset === "us-ascii" || charset === "ascii" || charset === "latin1" ||
      charset === "iso-8859-1" || charset === "iso8859-1" ||
      charset === "windows-1252" || charset === "cp1252") {
    var s = "";
    for (var k = 0; k < bytes.length; k++) s += String.fromCharCode(bytes[k]); // byte-preserving
    return s;
  }
  return utf8Decode(bytes); // default and any unknown charset: utf-8 (see README edge)
}

// ---- structured header values ("text/plain; charset=utf-8; name=\"a b\"") ---
function splitSemicolons(s) {
  var out = [], cur = "", inq = false;
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (c === '"') { inq = !inq; cur += c; }
    else if (c === ";" && !inq) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
function unquote(v) {
  v = v.replace(/^[ \t]+|[ \t]+$/g, "");
  if (v.length >= 2 && v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') {
    return v.substring(1, v.length - 1).replace(/\\(.)/g, "$1");
  }
  return v;
}
function parseStructured(value) {
  var parts = splitSemicolons(value);
  var main = (parts.shift() || "").replace(/^[ \t]+|[ \t]+$/g, "");
  var params = {};
  for (var i = 0; i < parts.length; i++) {
    var eq = parts[i].indexOf("=");
    if (eq === -1) continue;
    var k = parts[i].substring(0, eq).replace(/^[ \t]+|[ \t]+$/g, "").toLowerCase();
    if (k) params[k] = unquote(parts[i].substring(eq + 1));
  }
  return { value: main, params: params };
}

// ---- RFC 2047 encoded words in header text ---------------------------------
function decodeEncodedWords(str) {
  return str.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, function (m, charset, enc, text) {
    var bytes = (enc === "B" || enc === "b")
      ? decodeBase64(text)
      : decodeQuotedPrintable(text.replace(/_/g, " ")); // Q: '_' is space
    return bytesToString(bytes, charset);
  });
}

// ---- headers ---------------------------------------------------------------
function splitHeadersBody(raw) {
  var norm = String(raw).replace(/\r\n/g, "\n");
  var idx = norm.indexOf("\n\n");
  if (idx === -1) return { headerBlock: norm, body: "" };
  return { headerBlock: norm.substring(0, idx), body: norm.substring(idx + 2) };
}
function unfoldHeaders(headerBlock) {
  var lines = headerBlock.split("\n"), headers = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line === "") continue;
    if ((line.charAt(0) === " " || line.charAt(0) === "\t") && headers.length) {
      headers[headers.length - 1][1] += " " + line.replace(/^[ \t]+/, ""); // unfold
    } else {
      var ci = line.indexOf(":");
      if (ci === -1) continue; // not a header line — skip
      headers.push([line.substring(0, ci).replace(/[ \t]+$/, ""), line.substring(ci + 1).replace(/^[ \t]+/, "")]);
    }
  }
  return headers;
}
function getRawHeader(rawHeaders, name) {
  name = name.toLowerCase();
  for (var i = 0; i < rawHeaders.length; i++) {
    if (rawHeaders[i][0].toLowerCase() === name) return rawHeaders[i][1];
  }
  return null;
}

// ---- multipart split -------------------------------------------------------
function splitMultipart(body, boundary) {
  var delim = "--" + boundary, close = delim + "--";
  var lines = body.split("\n"), parts = [], cur = null;
  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].replace(/\r$/, "");
    if (t === delim) { if (cur !== null) parts.push(cur.join("\n")); cur = []; }
    else if (t === close) { if (cur !== null) parts.push(cur.join("\n")); cur = null; break; }
    else if (cur !== null) cur.push(lines[i]);
    // lines before the first delim are the preamble (cur === null) — ignored
  }
  if (cur !== null) parts.push(cur.join("\n")); // unterminated: keep what we have
  return parts;
}

// ---- body decode -----------------------------------------------------------
function decodeBody(body, cte, charset) {
  var bytes;
  if (cte === "base64") bytes = decodeBase64(body);
  else if (cte === "quoted-printable") bytes = decodeQuotedPrintable(body);
  else { bytes = []; for (var i = 0; i < body.length; i++) bytes.push(body.charCodeAt(i) & 0xff); }
  return bytesToString(bytes, charset);
}

// ---- the parser ------------------------------------------------------------
function parseMime(raw) {
  var sb = splitHeadersBody(raw);
  var rawHeaders = unfoldHeaders(sb.headerBlock);
  var headers = {};
  for (var i = 0; i < rawHeaders.length; i++) {
    var name = rawHeaders[i][0].toLowerCase();
    if (headers[name] === undefined) headers[name] = decodeEncodedWords(rawHeaders[i][1]); // last raw kept; first decoded value wins for the map
  }
  var ct = parseStructured(getRawHeader(rawHeaders, "content-type") || "text/plain");
  var cte = (getRawHeader(rawHeaders, "content-transfer-encoding") || "7bit").replace(/^[ \t]+|[ \t]+$/g, "").toLowerCase();
  var node = {
    headers: headers,
    rawHeaders: rawHeaders,
    contentType: ct.value.toLowerCase(),
    contentTypeParams: ct.params,
    encoding: cte,
    isMultipart: false
  };
  if (node.contentType.indexOf("multipart/") === 0 && ct.params.boundary) {
    node.isMultipart = true;
    node.parts = [];
    var raws = splitMultipart(sb.body, ct.params.boundary);
    for (var p = 0; p < raws.length; p++) node.parts.push(parseMime(raws[p]));
  } else {
    node.bodyRaw = sb.body;
    node.body = decodeBody(sb.body, cte, ct.params.charset);
  }
  return node;
}

// ---- a small human summary for the CLI -------------------------------------
function summarize(node, depth) {
  depth = depth || 0;
  var pad = new Array(depth + 1).join("  ");
  var line = pad + node.contentType + (node.encoding && node.encoding !== "7bit" ? " [" + node.encoding + "]" : "");
  var lines = [line];
  if (depth === 0) {
    var interesting = ["from", "to", "subject", "date"];
    for (var i = 0; i < interesting.length; i++) {
      if (node.headers[interesting[i]] !== undefined) lines.push(pad + "  " + interesting[i] + ": " + node.headers[interesting[i]]);
    }
  }
  if (node.isMultipart) {
    for (var p = 0; p < node.parts.length; p++) lines = lines.concat(summarize(node.parts[p], depth + 1));
  } else {
    var body = node.body || "";
    var preview = body.length > 200 ? body.substring(0, 200) + "\u2026" : body;
    lines.push(pad + "  body(" + body.length + "): " + JSON.stringify(preview));
  }
  return lines;
}

// ---- dual-runtime export ---------------------------------------------------
if (typeof window !== "undefined") {
  window.LoopGifts = window.LoopGifts || {};
  window.LoopGifts.parseMime = parseMime;
  window.LoopGifts.decodeEncodedWords = decodeEncodedWords;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseMime: parseMime,
    decodeBase64: decodeBase64,
    decodeQuotedPrintable: decodeQuotedPrintable,
    decodeEncodedWords: decodeEncodedWords,
    bytesToString: bytesToString,
    parseStructured: parseStructured,
    summarize: summarize
  };
}

// ---- CLI (value-arg or stdin; never touches the filesystem) ----------------
var DEMO = [
  "From: Alice <alice@example.com>",
  "To: Bob <bob@example.com>",
  "Subject: =?utf-8?B?SGVsbG8sIOKCrA==?=",
  "MIME-Version: 1.0",
  "Content-Type: multipart/alternative; boundary=\"b0undary\"",
  "",
  "This preamble is ignored by MIME readers.",
  "--b0undary",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "Coffee costs 5=E2=82=AC. This line is soft-wrapped mid-wo=",
  "rd.",
  "--b0undary",
  "Content-Type: text/html; charset=utf-8",
  "Content-Transfer-Encoding: base64",
  "",
  "PGI+SGk8L2I+",
  "--b0undary--",
  ""
].join("\r\n");

if (typeof require !== "undefined" && require.main === module) {
  var args = process.argv.slice(2);
  function run(raw, label) {
    var node = parseMime(raw);
    if (label) process.stdout.write(label + "\n");
    process.stdout.write(summarize(node).join("\n") + "\n");
    process.exit(0);
  }
  if (args[0] === "--help" || args[0] === "-h") {
    process.stdout.write(
      "ratchet-inline-mime — parse a raw MIME message into a decoded tree\n\n" +
      "  node ratchet-inline-mime.js --demo        parse a built-in sample and print its tree\n" +
      "  node ratchet-inline-mime.js '<raw mime>'  parse the message given as one argument\n" +
      "  cat message.eml | node ratchet-inline-mime.js   parse a message piped on stdin\n\n" +
      "Prints the content-type tree with decoded leaf bodies. Exit 0. No files are read.\n");
    process.exit(0);
  }
  if (args[0] === "--demo") { run(DEMO, "# demo message"); }
  else if (args.length >= 1) { run(args[0]); }
  else {
    var chunks = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", function (d) { chunks += d; });
    process.stdin.on("end", function () { run(chunks || DEMO); });
  }
}
