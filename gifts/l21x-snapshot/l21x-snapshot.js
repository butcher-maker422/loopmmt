#!/usr/bin/env node
// SPDX-License-Identifier: MIT
"use strict";
/* l21x-snapshot.js — a zero-dependency browser document persistence layer.

   A save-file / catalog / archive layer for browser apps that hold documents in
   memory and need to persist, list, and move them without a backend. Three tiers,
   all pure functions over values you already hold — no DOM, no filesystem, no fetch:

     1. SNAPSHOT CODEC. encodeSnapshot(doc) -> a self-describing base64 string
        (an ".l21x" snapshot); decodeSnapshot(str) -> the document back, verified.
        A document is any JSON-serializable object; the codec stamps a format tag
        and a version so a snapshot names its own shape.

     2. CATALOG. An in-memory list of snapshot entries with pure save/load/validate/
        sort operations. catalogSave returns a NEW catalog (never mutates its input),
        keyed by a caller-supplied id; catalogLoad decodes an entry back to a doc;
        catalogValidate reports honest structural errors; catalogSort orders by a
        named field without touching the input.

     3. ARCHIVE. archiveExport(catalog) -> ONE base64 blob (a whole catalog as a
        single portable string, for a download-one-file / paste-into-another-tab
        move); archiveImport(blob) -> the catalog back. Round-trips exactly.

   The same code runs in Node (module.exports) or a browser
   (window.LoopGifts.l21x). It persists data you already hold as objects; it does
   not fetch, connect, read files, or touch the DOM. Base64 is computed in pure JS
   so the behavior is identical in both runtimes (no atob/btoa, no Buffer needed). */

// ---- UTF-8 <-> bytes (pure; full multibyte) --------------------------------
function utf8Encode(str) {
  var out = [], i, c;
  for (i = 0; i < str.length; i++) {
    c = str.charCodeAt(i);
    if (c < 0x80) { out.push(c); }
    else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      // surrogate pair -> full code point
      var c2 = str.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f),
                 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        i++;
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return out;
}
function utf8Decode(bytes) {
  var out = "", i = 0, b, cp, n;
  while (i < bytes.length) {
    b = bytes[i];
    if (b < 0x80) { out += String.fromCharCode(b); i += 1; continue; }
    else if ((b & 0xe0) === 0xc0) { cp = b & 0x1f; n = 1; }
    else if ((b & 0xf0) === 0xe0) { cp = b & 0x0f; n = 2; }
    else if ((b & 0xf8) === 0xf0) { cp = b & 0x07; n = 3; }
    else { out += "\ufffd"; i += 1; continue; }
    if (i + n >= bytes.length + 1 && i + n > bytes.length) { out += "\ufffd"; break; }
    var ok = true;
    for (var k = 1; k <= n; k++) {
      var cont = bytes[i + k];
      if (cont === undefined || (cont & 0xc0) !== 0x80) { ok = false; break; }
      cp = (cp << 6) | (cont & 0x3f);
    }
    if (!ok) { out += "\ufffd"; i += 1; continue; }
    if (cp > 0xffff) {
      cp -= 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    } else {
      out += String.fromCharCode(cp);
    }
    i += n + 1;
  }
  return out;
}

// ---- base64 (pure; url-safe-tolerant on decode) ----------------------------
var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64FromBytes(bytes) {
  var out = "", i;
  for (i = 0; i < bytes.length; i += 3) {
    var b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    var t = (b0 << 16) | ((b1 || 0) << 8) | (b2 || 0);
    out += B64.charAt((t >> 18) & 0x3f) + B64.charAt((t >> 12) & 0x3f);
    out += (i + 1 < bytes.length) ? B64.charAt((t >> 6) & 0x3f) : "=";
    out += (i + 2 < bytes.length) ? B64.charAt(t & 0x3f) : "=";
  }
  return out;
}
function bytesFromBase64(str) {
  var lut = bytesFromBase64._lut;
  if (!lut) {
    lut = bytesFromBase64._lut = {};
    for (var i = 0; i < B64.length; i++) lut[B64.charAt(i)] = i;
    lut["-"] = 62; lut["_"] = 63; // tolerate url-safe alphabet
  }
  var out = [], buffer = 0, bits = 0;
  for (var j = 0; j < str.length; j++) {
    var c = str.charAt(j);
    if (c === "=") break;
    var v = lut[c];
    if (v === undefined) continue; // skip whitespace/newlines
    buffer = (buffer << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buffer >> bits) & 0xff); }
  }
  return out;
}

// ---- snapshot codec --------------------------------------------------------
var FORMAT = "l21x";
var FORMAT_VERSION = 1;

/* encodeSnapshot(doc[, meta]) -> base64 string.
   doc: any JSON-serializable value (the document body).
   meta: optional {title, schema} recorded alongside. */
function encodeSnapshot(doc, meta) {
  if (doc === undefined) throw new Error("encodeSnapshot: doc is required");
  meta = meta || {};
  var envelope = {
    fmt: FORMAT,
    v: FORMAT_VERSION,
    title: (meta.title === undefined) ? null : String(meta.title),
    schema: (meta.schema === undefined) ? null : String(meta.schema),
    doc: doc
  };
  var json;
  try { json = JSON.stringify(envelope); }
  catch (e) { throw new Error("encodeSnapshot: doc is not JSON-serializable (" + e.message + ")"); }
  return base64FromBytes(utf8Encode(json));
}

/* decodeSnapshot(str) -> {title, schema, doc, v}. Throws on a malformed or
   foreign-format snapshot rather than returning a half-parsed value. */
function decodeSnapshot(str) {
  if (typeof str !== "string" || str.length === 0)
    throw new Error("decodeSnapshot: expected a non-empty base64 string");
  var json = utf8Decode(bytesFromBase64(str));
  var env;
  try { env = JSON.parse(json); }
  catch (e) { throw new Error("decodeSnapshot: not a valid l21x snapshot (bad base64/JSON)"); }
  if (!env || env.fmt !== FORMAT)
    throw new Error("decodeSnapshot: not an l21x snapshot (fmt=" + (env && env.fmt) + ")");
  if (typeof env.v !== "number" || env.v > FORMAT_VERSION)
    throw new Error("decodeSnapshot: unsupported snapshot version " + (env && env.v));
  return { title: env.title, schema: env.schema, doc: env.doc, v: env.v };
}

// ---- catalog (pure; never mutates its input) -------------------------------
/* A catalog is an array of entries: {id, title, schema, updated, snapshot}.
   snapshot is the base64 string; updated is a caller-supplied sortable value. */

/* catalogSave(catalog, id, doc[, meta]) -> a NEW catalog with id saved/replaced.
   meta.updated (optional) is recorded for sorting; defaults to null. */
function catalogSave(catalog, id, doc, meta) {
  if (!isArray(catalog)) throw new Error("catalogSave: catalog must be an array");
  if (id === undefined || id === null || String(id) === "")
    throw new Error("catalogSave: id is required");
  meta = meta || {};
  var entry = {
    id: String(id),
    title: (meta.title === undefined) ? null : String(meta.title),
    schema: (meta.schema === undefined) ? null : String(meta.schema),
    updated: (meta.updated === undefined) ? null : meta.updated,
    snapshot: encodeSnapshot(doc, meta)
  };
  var out = [], replaced = false, i;
  for (i = 0; i < catalog.length; i++) {
    if (catalog[i] && catalog[i].id === entry.id) { out.push(entry); replaced = true; }
    else { out.push(catalog[i]); }
  }
  if (!replaced) out.push(entry);
  return out;
}

/* catalogLoad(catalog, id) -> the decoded {title, schema, doc, v}, or null if
   the id is not present. */
function catalogLoad(catalog, id) {
  if (!isArray(catalog)) throw new Error("catalogLoad: catalog must be an array");
  for (var i = 0; i < catalog.length; i++) {
    if (catalog[i] && catalog[i].id === String(id)) return decodeSnapshot(catalog[i].snapshot);
  }
  return null;
}

/* catalogValidate(catalog) -> {ok, errors[]}. Honest structural check: each entry
   has a non-empty id, ids are unique, and every snapshot decodes. Reports every
   problem it finds rather than throwing on the first. */
function catalogValidate(catalog) {
  var errors = [];
  if (!isArray(catalog)) return { ok: false, errors: ["catalog is not an array"] };
  var seen = {};
  for (var i = 0; i < catalog.length; i++) {
    var e = catalog[i];
    if (!e || typeof e !== "object") { errors.push("entry " + i + ": not an object"); continue; }
    if (e.id === undefined || e.id === null || String(e.id) === "")
      errors.push("entry " + i + ": missing id");
    else if (seen[e.id]) errors.push("entry " + i + ": duplicate id '" + e.id + "'");
    else seen[e.id] = true;
    if (typeof e.snapshot !== "string") { errors.push("entry " + i + ": snapshot is not a string"); }
    else { try { decodeSnapshot(e.snapshot); } catch (err) { errors.push("entry " + i + ": " + err.message); } }
  }
  return { ok: errors.length === 0, errors: errors };
}

/* catalogSort(catalog, key[, desc]) -> a NEW sorted catalog. key is an entry
   field ('title'|'id'|'updated'|'schema'). Stable, input untouched. */
function catalogSort(catalog, key, desc) {
  if (!isArray(catalog)) throw new Error("catalogSort: catalog must be an array");
  key = key || "id";
  var indexed = [], i;
  for (i = 0; i < catalog.length; i++) indexed.push([catalog[i], i]);
  indexed.sort(function (a, b) {
    var av = a[0] ? a[0][key] : undefined, bv = b[0] ? b[0][key] : undefined;
    var aNull = (av === null || av === undefined), bNull = (bv === null || bv === undefined);
    // nulls ALWAYS last, independent of sort direction
    if (aNull && bNull) return a[1] - b[1];
    if (aNull) return 1;
    if (bNull) return -1;
    var cmp;
    if (av === bv) cmp = a[1] - b[1];                    // stable on ties
    else cmp = (av < bv) ? -1 : 1;
    if (cmp === 0) return 0;
    return desc ? -cmp : cmp;
  });
  var out = [];
  for (i = 0; i < indexed.length; i++) out.push(indexed[i][0]);
  return out;
}

// ---- archive (whole catalog <-> one base64 blob) ---------------------------
var ARCHIVE_FORMAT = "l21x-archive";

/* archiveExport(catalog) -> ONE base64 blob carrying the whole catalog. */
function archiveExport(catalog) {
  if (!isArray(catalog)) throw new Error("archiveExport: catalog must be an array");
  var v = catalogValidate(catalog);
  if (!v.ok) throw new Error("archiveExport: refusing to export an invalid catalog (" + v.errors[0] + ")");
  var envelope = { fmt: ARCHIVE_FORMAT, v: FORMAT_VERSION, entries: catalog };
  return base64FromBytes(utf8Encode(JSON.stringify(envelope)));
}

/* archiveImport(blob) -> the catalog array. Throws on a foreign/malformed blob. */
function archiveImport(blob) {
  if (typeof blob !== "string" || blob.length === 0)
    throw new Error("archiveImport: expected a non-empty base64 string");
  var env;
  try { env = JSON.parse(utf8Decode(bytesFromBase64(blob))); }
  catch (e) { throw new Error("archiveImport: not a valid l21x archive (bad base64/JSON)"); }
  if (!env || env.fmt !== ARCHIVE_FORMAT)
    throw new Error("archiveImport: not an l21x archive (fmt=" + (env && env.fmt) + ")");
  if (!isArray(env.entries)) throw new Error("archiveImport: archive has no entries array");
  var v = catalogValidate(env.entries);
  if (!v.ok) throw new Error("archiveImport: archive failed validation (" + v.errors[0] + ")");
  return env.entries;
}

// ---- small helper ----------------------------------------------------------
function isArray(x) { return Object.prototype.toString.call(x) === "[object Array]"; }

// ---- dual-runtime export ---------------------------------------------------
if (typeof window !== "undefined") {
  window.LoopGifts = window.LoopGifts || {};
  window.LoopGifts.l21x = {
    encodeSnapshot: encodeSnapshot, decodeSnapshot: decodeSnapshot,
    catalogSave: catalogSave, catalogLoad: catalogLoad,
    catalogValidate: catalogValidate, catalogSort: catalogSort,
    archiveExport: archiveExport, archiveImport: archiveImport
  };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    encodeSnapshot: encodeSnapshot, decodeSnapshot: decodeSnapshot,
    catalogSave: catalogSave, catalogLoad: catalogLoad,
    catalogValidate: catalogValidate, catalogSort: catalogSort,
    archiveExport: archiveExport, archiveImport: archiveImport,
    FORMAT: FORMAT, FORMAT_VERSION: FORMAT_VERSION
  };
}

// ---- CLI (value-arg + --demo; reads NO files) ------------------------------
if (typeof require !== "undefined" && require.main === module) {
  var args = process.argv.slice(2);
  var DEMO_CATALOG = catalogSave(
    catalogSave([], "note-1", { title: "Groceries", items: ["milk", "eggs"] },
                { title: "Groceries", updated: "2026-08-01" }),
    "note-2", { title: "Ideas — café ☕", body: "persistence without a backend" },
    { title: "Ideas", updated: "2026-08-15" });

  function printDemo() {
    var archive = archiveExport(DEMO_CATALOG);
    var back = archiveImport(archive);
    var sorted = catalogSort(back, "updated", true);
    process.stdout.write("# l21x-snapshot demo\n");
    process.stdout.write("catalog entries: " + back.length + "\n");
    process.stdout.write("archive blob length (base64): " + archive.length + "\n");
    process.stdout.write("sorted by updated (desc): " +
      sorted.map(function (e) { return e.id; }).join(", ") + "\n");
    var loaded = catalogLoad(back, "note-2");
    process.stdout.write("loaded note-2 title: " + loaded.doc.title + "\n");
    process.stdout.write("round-trip ok: " +
      (archiveExport(archiveImport(archive)) === archive) + "\n");
    process.exit(0);
  }

  if (args[0] === "--help" || args[0] === "-h") {
    process.stdout.write(
      "l21x-snapshot — a zero-dependency browser document persistence layer\n\n" +
      "  node l21x-snapshot.js --demo            build a sample catalog, archive it,\n" +
      "                                          round-trip it, and print the result\n" +
      "  node l21x-snapshot.js '<json doc>'      encode one JSON document as an .l21x\n" +
      "                                          snapshot and print the base64\n\n" +
      "Library: encodeSnapshot/decodeSnapshot, catalogSave/Load/Validate/Sort,\n" +
      "archiveExport/archiveImport. Pure functions over values — no files, no DOM,\n" +
      "no network. Exit 0.\n");
    process.exit(0);
  }
  if (args[0] === "--demo" || args.length === 0) { printDemo(); }
  else {
    // value-arg: treat the argument as a literal JSON document, encode it.
    var doc;
    try { doc = JSON.parse(args[0]); }
    catch (e) { process.stdout.write("not valid JSON; wrapping as a string document\n"); doc = args[0]; }
    process.stdout.write(encodeSnapshot(doc, { title: "cli" }) + "\n");
    process.exit(0);
  }
}
