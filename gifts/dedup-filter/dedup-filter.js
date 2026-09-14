#!/usr/bin/env node
/* dedup-filter.js — drop duplicate records from a JSONL stream, first one wins.
   Dependency-free, deterministic, one pass. Runs in Node or a browser. MIT.

   WHAT IT IS. Give it a stream of records — one JSON value per line (JSONL) — and
   it passes them through, dropping every record it has already seen. The output is
   a SUBSET of the input in the ORIGINAL ORDER: the first occurrence of each record
   is kept, every later duplicate is dropped. Same stream in, byte-identical stream
   out, on every machine and every run. It is a FILTER: output ⊆ input, nothing is
   added, reordered, or rewritten — the kept lines are emitted exactly as they
   arrived.

   WHAT COUNTS AS A DUPLICATE (the whole determinism story). Two modes, and the
   identity key is the only thing that differs:

     - DEFAULT (whole-record identity). A record's key is its CANONICAL JSON form:
       the value re-serialized with object keys sorted, recursively. So
       {"a":1,"b":2} and {"b":2,"a":1} are the SAME record (key-order in an object
       is not meaningful) and the second is dropped — but [1,2] and [2,1] are
       DIFFERENT (array order IS meaningful). Canonicalizing the key, not the line,
       is what makes "same record written two ways" deduplicate while still
       emitting the original line untouched.

     - --key FIELD (dedup by one field). The record's key is the value of the named
       top-level field, canonicalized the same way. The FIRST record carrying a
       given field value is kept; later records with that same field value are
       dropped even if the rest of the record differs. A record that LACKS the
       field is passed through unchanged and never dedups against anything (a
       missing key is not a value — it is not "the same" as another missing key).

   FIRST WINS, ORDER STABLE. The kept record for any key is always the FIRST one
   seen; the relative order of the kept records is exactly their input order. This
   is a deliberate, pinned choice (not "last wins", not "sorted"): it makes the
   fold one-pass and the output a stable, re-derivable subset of the input.

   INPUT HONESTY (the character of this gift). A filter is only trustworthy if it
   refuses to quietly mishandle a line:
     - Every non-blank line must be valid JSON (any JSON value: object, array,
       string, number, bool, null). A line that is not valid JSON is a HARD ERROR
       (exit 2) naming the line — never a silent skip and never passed through as
       raw text.
     - Blank lines are skipped (not emitted, not counted as records). A trailing
       \r (CRLF files) is trimmed before parsing; the emitted line preserves the
       original body without the trailing \r.
     - --key names a TOP-LEVEL field only (no dotted paths); it is meaningful only
       for records that are JSON objects. A --key applied to a non-object record
       (a bare number, string, array) means "no such field" -> that record is
       passed through and never dedups.

   USAGE
     printf '%s\n' '{"id":1}' '{"id":1}' '{"id":2}' | node dedup-filter.js
     node dedup-filter.js --key id events.jsonl        # dedup by the id field
     node dedup-filter.js --count < in.jsonl > out.jsonl   # report drops on stderr
     node dedup-filter.js --help

   Each non-blank line is one JSON record. Output is the kept records, one per line,
   each terminated by a newline, in input order.

   Exit codes: 0 success · 2 input error (missing file, a directory, an unknown
   option, or a line that is not valid JSON). Always a clean one-line message on
   stderr, never a stack trace. --count writes the drop tally to stderr; it never
   changes the exit code or the emitted stream.

   Released under MIT. Its edge is printed in the README: this drops EXACT
   duplicates (by canonical record, or by one field). It is NOT a fuzzy/near-dedup
   (no similarity, no normalization of values), does NOT collapse or merge the
   records it drops (it keeps the first verbatim and discards the rest), and keeps
   FIRST not last — it is not a "latest wins" upsert.
*/
"use strict";

// Canonical JSON: object keys sorted recursively, so key-order in objects does not
// make two equal records look different. Arrays keep their order (order IS data).
function canon(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) {
    var parts = [];
    for (var i = 0; i < v.length; i++) parts.push(canon(v[i]));
    return "[" + parts.join(",") + "]";
  }
  var keys = Object.keys(v).sort();
  var out = [];
  for (var k = 0; k < keys.length; k++) {
    out.push(JSON.stringify(keys[k]) + ":" + canon(v[keys[k]]));
  }
  return "{" + out.join(",") + "}";
}

// Parse one input line into a JSON value, or throw a clean, line-named Error.
function parseRecord(line, lineNo) {
  try { return JSON.parse(line); }
  catch (e) {
    throw new Error("line " + lineNo + " is not valid JSON: " + JSON.stringify(line.slice(0, 40)));
  }
}

// The public filter: JSONL text + {key} -> { lines: [kept lines], dropped: N }.
// First occurrence of each key wins; kept lines are the ORIGINAL bodies, in order.
// A sentinel object identity is used for "record has no --key field" so that such
// records never collide with each other or with a real value.
var NO_KEY = { noKey: true };

function filter(text, opts) {
  opts = opts || {};
  var keyField = opts.key; // undefined => whole-record identity

  var lines = String(text).split("\n");
  var seen = Object.create(null);
  var kept = [];
  var dropped = 0;
  var i, line, rec, keyVal, k;

  for (i = 0; i < lines.length; i++) {
    line = lines[i];
    if (line.charCodeAt(line.length - 1) === 0x0d) line = line.slice(0, -1); // trim \r
    if (line.length === 0) continue; // blank line is not a record

    rec = parseRecord(line, i + 1);

    if (keyField === undefined) {
      k = canon(rec); // whole-record identity
    } else {
      // dedup by one top-level field; a record lacking it never dedups
      if (rec !== null && typeof rec === "object" && !Array.isArray(rec) &&
          Object.prototype.hasOwnProperty.call(rec, keyField)) {
        keyVal = rec[keyField];
        k = "K:" + canon(keyVal);
      } else {
        k = NO_KEY; // object identity => unique per line, never a duplicate
      }
    }

    if (k !== NO_KEY && seen[k]) { dropped += 1; continue; }
    if (k !== NO_KEY) seen[k] = true;
    kept.push(line);
  }

  return { lines: kept, dropped: dropped };
}

/* ---- exports (browser + Node) ------------------------------------ */
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.dedupFilter = filter;
  window.ForestGifts.dedupCanon = canon;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { filter: filter, canon: canon };
}

/* ---- CLI (runs only when invoked directly, never on require) ------ */
function run(text, opts) {
  var r = filter(text, opts);
  var body = r.lines.length ? r.lines.join("\n") + "\n" : "";
  return { out: body, dropped: r.dropped };
}

function main(argv) {
  var args = argv.slice(2);
  if (args.indexOf("--help") !== -1 || args.indexOf("-h") !== -1) {
    process.stdout.write(
      "dedup-filter.js — drop duplicate records from a JSONL stream, first one wins.\n\n" +
      "  printf '%s\\n' '{\"id\":1}' '{\"id\":1}' | node dedup-filter.js\n" +
      "  node dedup-filter.js --key id events.jsonl       dedup by the id field\n" +
      "  node dedup-filter.js --count < in > out          report drops on stderr\n" +
      "  node dedup-filter.js --help\n\n" +
      "Each non-blank line is one JSON record. By DEFAULT a duplicate is a record\n" +
      "with the same CANONICAL form (object key-order ignored, array order kept);\n" +
      "--key FIELD dedups by one top-level field instead. FIRST occurrence wins and\n" +
      "output is a stable SUBSET of the input in original order.\n\n" +
      "Edge: this drops EXACT duplicates. It is NOT fuzzy/near-dedup, does NOT merge\n" +
      "the records it drops, and keeps FIRST not last. Invalid JSON is a hard error,\n" +
      "never a silent skip.\n"
    );
    return 0;
  }

  var opts = {};
  var files = [];
  var countMode = false;
  var i;
  try {
    for (i = 0; i < args.length; i++) {
      if (args[i] === "--key") {
        opts.key = args[++i];
        if (opts.key === undefined || opts.key === "" || opts.key.charAt(0) === "-") {
          throw new Error("--key requires a field name");
        }
      }
      else if (args[i] === "--count") { countMode = true; }
      else if (args[i].charAt(0) === "-") { throw new Error("unknown option " + args[i]); }
      else { files.push(args[i]); }
    }
  } catch (e) {
    process.stderr.write("dedup-filter: " + e.message + "\n");
    return 2;
  }

  function emit(text) {
    try {
      var r = run(text, opts);
      process.stdout.write(r.out);
      if (countMode) process.stderr.write("dedup-filter: dropped " + r.dropped + " duplicate(s)\n");
      return 0;
    } catch (e) {
      process.stderr.write("dedup-filter: " + e.message + "\n");
      return 2;
    }
  }

  if (files.length > 0) {
    var fs = require("fs");
    var text;
    try { text = fs.readFileSync(files[0], "utf8"); }
    catch (e) {
      process.stderr.write("dedup-filter: cannot read " + files[0] +
        " (" + (e.code === "EISDIR" ? "is a directory" : (e.code || "read error")) + ")\n");
      return 2;
    }
    return emit(text);
  }

  // stdin
  var chunks = [];
  process.stdin.on("data", function (d) { chunks.push(d); });
  process.stdin.on("end", function () {
    process.exitCode = emit(Buffer.concat(chunks).toString("utf8"));
  });
  return 0;
}

if (typeof require !== "undefined" && require.main === module) {
  process.exitCode = main(process.argv);
}
