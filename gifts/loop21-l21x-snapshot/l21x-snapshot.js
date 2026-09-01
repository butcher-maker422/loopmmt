#!/usr/bin/env node
/* l21x-snapshot.js — a dependency-free browser document-persistence layer:
   turn any JSON-able document into a portable snapshot string, keep a named
   catalog of them in the browser, and export/import the whole catalog as one
   file. Same code runs in a browser (attach L21X to your namespace) or on Node
   (this CLI / require()).

   WHY THIS EXISTS. Every small browser app eventually needs the same three
   things and rewrites them badly each time: (1) serialize the current document
   to a string you can put in a URL, a text field, or a file; (2) keep a few of
   them around under names the user picked; (3) get all of that OUT — a backup,
   a transfer to another machine, a copy to a friend — as one portable blob.
   Done casually this is a pile of localStorage calls with no validation, no
   determinism, and no way to move the data. This is that layer, done once,
   zero-dependency, and honest about its edges.

   THE THREE VERBS.
     SNAPSHOT — encodeSnapshot(doc) -> base64 string ; decodeSnapshot(b64) -> doc.
       A snapshot is a self-contained, portable string. It round-trips exactly:
       decodeSnapshot(encodeSnapshot(x)) deep-equals x, including multibyte text
       (accented names, emoji, non-Latin scripts) — the encoder goes through the
       UTF-8 byte stream, never char codes, so nothing corrupts silently.
     CATALOG — a named store of documents in the browser (localStorage), with
       save / load / remove / list / sortBy and name validation. The store is
       INJECTED (a tiny {getItem,setItem,removeItem} object), so the logic is
       pure and testable off-browser; in a browser you pass window.localStorage.
     ARCHIVE — archiveExport(catalog) -> one string ; archiveImport(str) -> catalog.
       The whole catalog as a single portable file: back it up, move it, restore
       it. Import validates every entry name and rejects a malformed archive
       loudly rather than half-restoring.

   THE ONE FIDELITY RULE (the whole reason to trust it). A snapshot is
   DETERMINISTIC: encodeSnapshot sorts object keys at every level before
   encoding, so the same document always produces the same base64 string — which
   means two snapshots are equal iff the documents are equal, and a snapshot is
   diffable, hashable, and cache-keyable. Break the key-sort and equal documents
   would encode differently; the test battery carries a key-order vector
   precisely to catch that.

   USAGE (CLI — operates on snapshot strings via stdin/args)
     echo '{"b":2,"a":1}' | node l21x-snapshot.js encode   # doc (JSON) -> snapshot
     node l21x-snapshot.js decode <base64>                 # snapshot -> doc (JSON)
     node l21x-snapshot.js roundtrip '{"a":1}'             # prove decode(encode(x)) == x
     node l21x-snapshot.js --help

   Released under MIT. Its edge is printed in the README: this PERSISTS and MOVES
   documents; it does not encrypt them and it does not resolve merge conflicts.
   A snapshot is plaintext base64 — anyone who has the string has the document.
*/
"use strict";

/* ---------- UTF-8-safe base64 (browser btoa/atob choke on multibyte) -------- */

function _utf8ToBytes(str) {
  // Deterministic UTF-8 encoding, no dependencies.
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
  // Node / older-runtime fallback.
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(str, "utf8"));
  // Minimal hand-rolled UTF-8 (last resort).
  var out = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
    else if (c >= 0xd800 && c <= 0xdbff) {
      var c2 = str.charCodeAt(++i);
      var cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f),
               0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
  }
  return new Uint8Array(out);
}

function _bytesToUtf8(bytes) {
  if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(bytes);
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("utf8");
  var s = "", i = 0;
  while (i < bytes.length) {
    var b = bytes[i++];
    if (b < 0x80) s += String.fromCharCode(b);
    else if (b < 0xe0) s += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (b < 0xf0) s += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    else {
      var cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      cp -= 0x10000;
      s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return s;
}

var _B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function _bytesToB64(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  var out = "", i;
  for (i = 0; i + 2 < bytes.length; i += 3) {
    var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += _B64[(n >> 18) & 63] + _B64[(n >> 12) & 63] + _B64[(n >> 6) & 63] + _B64[n & 63];
  }
  var rem = bytes.length - i;
  if (rem === 1) {
    var n1 = bytes[i] << 16;
    out += _B64[(n1 >> 18) & 63] + _B64[(n1 >> 12) & 63] + "==";
  } else if (rem === 2) {
    var n2 = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += _B64[(n2 >> 18) & 63] + _B64[(n2 >> 12) & 63] + _B64[(n2 >> 6) & 63] + "=";
  }
  return out;
}

function _b64ToBytes(b64) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  var lookup = {}; for (var k = 0; k < _B64.length; k++) lookup[_B64[k]] = k;
  var clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
  var bytes = [], i;
  for (i = 0; i + 3 < clean.length; i += 4) {
    var n = (lookup[clean[i]] << 18) | (lookup[clean[i + 1]] << 12) |
            (lookup[clean[i + 2]] << 6) | lookup[clean[i + 3]];
    bytes.push((n >> 16) & 255, (n >> 8) & 255, n & 255);
  }
  var rem = clean.length - i;
  if (rem === 2) { var a = (lookup[clean[i]] << 18) | (lookup[clean[i + 1]] << 12); bytes.push((a >> 16) & 255); }
  else if (rem === 3) { var b = (lookup[clean[i]] << 18) | (lookup[clean[i + 1]] << 12) | (lookup[clean[i + 2]] << 6); bytes.push((b >> 16) & 255, (b >> 8) & 255); }
  return new Uint8Array(bytes);
}

/* ---------- deterministic canonical JSON (sorted keys, every level) --------- */

function _canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(_canonical).join(",") + "]";
  var keys = Object.keys(value).sort();
  var parts = [];
  for (var i = 0; i < keys.length; i++) {
    parts.push(JSON.stringify(keys[i]) + ":" + _canonical(value[keys[i]]));
  }
  return "{" + parts.join(",") + "}";
}

/* ---------- SNAPSHOT --------------------------------------------------------- */

// Encode a JSON-able document as a deterministic, portable base64 snapshot.
function encodeSnapshot(doc) {
  var json = _canonical(doc);            // sorted keys -> same doc, same string
  return _bytesToB64(_utf8ToBytes(json));
}

// Decode a base64 snapshot back into the document. Throws on a malformed string.
function decodeSnapshot(b64) {
  if (typeof b64 !== "string" || b64.length === 0) {
    throw new Error("decodeSnapshot: expected a non-empty base64 string");
  }
  var json = _bytesToUtf8(_b64ToBytes(b64));
  return JSON.parse(json);
}

/* ---------- CATALOG (store is injected: {getItem,setItem,removeItem}) -------- */

var NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Validate a catalog entry name (allowed chars, length). Returns {valid,error}.
function validateName(name) {
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    return { valid: false, error: "Invalid name — A-Z a-z 0-9 - _ only, 1-64 chars" };
  }
  return { valid: true, error: null };
}

function _readCatalog(store, key) {
  try { var raw = store.getItem(key); return raw ? JSON.parse(raw) : {}; }
  catch (e) { return {}; }
}
function _writeCatalog(store, key, catalog) {
  store.setItem(key, JSON.stringify(catalog));
}

// Save a document under a name. Stores {snapshot, savedAt}. Throws on bad name.
function catalogSave(store, key, name, doc, now) {
  var v = validateName(name);
  if (!v.valid) throw new Error(v.error);
  var catalog = _readCatalog(store, key);
  catalog[name] = { snapshot: encodeSnapshot(doc), savedAt: (now == null ? 0 : now) };
  _writeCatalog(store, key, catalog);
  return catalog[name];
}

// Load a document by name, or null if absent.
function catalogLoad(store, key, name) {
  var catalog = _readCatalog(store, key);
  var entry = catalog[name];
  return entry ? decodeSnapshot(entry.snapshot) : null;
}

// Remove a document by name. Returns true if it existed.
function catalogRemove(store, key, name) {
  var catalog = _readCatalog(store, key);
  if (!(name in catalog)) return false;
  delete catalog[name];
  _writeCatalog(store, key, catalog);
  return true;
}

// List entry names, sorted by "name" (default) or "time" (savedAt), asc/desc.
function catalogList(store, key, sortKey, ascending) {
  var catalog = _readCatalog(store, key);
  var names = Object.keys(catalog);
  var asc = ascending !== false;
  names.sort(function (a, b) {
    var av, bv;
    if (sortKey === "time") { av = catalog[a].savedAt || 0; bv = catalog[b].savedAt || 0; }
    else { av = a; bv = b; }
    if (av < bv) return asc ? -1 : 1;
    if (av > bv) return asc ? 1 : -1;
    // stable tiebreak by name so the order is fully deterministic
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return names;
}

/* ---------- ARCHIVE (the whole catalog as one portable string) -------------- */

var ARCHIVE_MAGIC = "L21X-ARCHIVE-1";

// Export a whole catalog object as one portable, deterministic string.
function archiveExport(catalog) {
  return encodeSnapshot({ magic: ARCHIVE_MAGIC, entries: catalog || {} });
}

// Import an archive string back into a catalog object. Validates the envelope
// and every entry name; throws loudly on a malformed or foreign archive.
function archiveImport(str) {
  var obj;
  try { obj = decodeSnapshot(str); }
  catch (e) { throw new Error("archiveImport: not a valid archive (decode failed)"); }
  if (!obj || obj.magic !== ARCHIVE_MAGIC || typeof obj.entries !== "object" || obj.entries === null) {
    throw new Error("archiveImport: not an l21x archive (bad envelope)");
  }
  var names = Object.keys(obj.entries);
  for (var i = 0; i < names.length; i++) {
    if (!validateName(names[i]).valid) {
      throw new Error("archiveImport: archive contains an invalid entry name: " + names[i]);
    }
  }
  return obj.entries;
}

/* ---------- exports (browser namespace OR node require) ---------------------- */

var L21X = {
  encodeSnapshot: encodeSnapshot,
  decodeSnapshot: decodeSnapshot,
  validateName: validateName,
  catalogSave: catalogSave,
  catalogLoad: catalogLoad,
  catalogRemove: catalogRemove,
  catalogList: catalogList,
  archiveExport: archiveExport,
  archiveImport: archiveImport,
  ARCHIVE_MAGIC: ARCHIVE_MAGIC
};

if (typeof module !== "undefined" && module.exports) module.exports = L21X;
if (typeof window !== "undefined") window.L21X = L21X;

/* ---------- CLI ------------------------------------------------------------- */

function _cli(argv) {
  var args = argv.slice(2);
  var cmd = args[0];
  if (!cmd || cmd === "--help" || cmd === "-h") {
    process.stdout.write(
      "l21x-snapshot — portable browser document persistence\n\n" +
      "  echo '<json>' | node l21x-snapshot.js encode    doc (JSON) -> snapshot (base64)\n" +
      "  node l21x-snapshot.js decode <base64>           snapshot -> doc (JSON)\n" +
      "  node l21x-snapshot.js roundtrip '<json>'        prove decode(encode(x)) deep-equals x\n" +
      "  node l21x-snapshot.js --help\n"
    );
    return 0;
  }
  function readStdin(cb) {
    var chunks = [];
    process.stdin.on("data", function (d) { chunks.push(d); });
    process.stdin.on("end", function () { cb(Buffer.concat(chunks).toString("utf8")); });
  }
  if (cmd === "encode") {
    readStdin(function (input) {
      try { process.stdout.write(encodeSnapshot(JSON.parse(input)) + "\n"); }
      catch (e) { process.stderr.write("encode: invalid JSON on stdin\n"); process.exitCode = 1; }
    });
    return 0;
  }
  if (cmd === "decode") {
    if (!args[1]) { process.stderr.write("decode: need a base64 argument\n"); return 1; }
    try { process.stdout.write(JSON.stringify(decodeSnapshot(args[1])) + "\n"); return 0; }
    catch (e) { process.stderr.write("decode: " + e.message + "\n"); return 1; }
  }
  if (cmd === "roundtrip") {
    if (!args[1]) { process.stderr.write("roundtrip: need a JSON argument\n"); return 1; }
    try {
      var doc = JSON.parse(args[1]);
      var back = decodeSnapshot(encodeSnapshot(doc));
      var ok = _canonical(doc) === _canonical(back);
      process.stdout.write((ok ? "OK round-trip: " : "FAIL round-trip: ") + JSON.stringify(back) + "\n");
      return ok ? 0 : 1;
    } catch (e) { process.stderr.write("roundtrip: " + e.message + "\n"); return 1; }
  }
  process.stderr.write("unknown command: " + cmd + " (try --help)\n");
  return 1;
}

if (typeof require !== "undefined" && require.main === module) {
  process.exitCode = _cli(process.argv);
}
