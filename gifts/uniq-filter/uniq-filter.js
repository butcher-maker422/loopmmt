#!/usr/bin/env node
/* uniq-filter.js — collapse ADJACENT duplicate records in a JSONL stream.
   Dependency-free, deterministic, one pass, O(1) memory. Runs in Node or a
   browser. MIT.

   WHAT IT IS. Give it a stream of records — one JSON value per line (JSONL) — and
   it passes them through, collapsing every maximal run of CONSECUTIVE equal
   records down to its FIRST member. The output is a SUBSET of the input in the
   ORIGINAL ORDER: the first line of each adjacent run is kept verbatim, every
   immediately-following equal line is dropped. A record equal to one earlier in
   the stream but NOT adjacent to it is kept — the run was already broken. This is
   the `uniq` half of `sort | uniq`. Same stream in, byte-identical stream out, on
   every machine and every run. It is a FILTER: output ⊆ input, nothing is added,
   reordered, or rewritten — the kept lines are emitted exactly as they arrived.

   ADJACENT, NOT GLOBAL (the whole point). uniq-filter remembers only the PREVIOUS
   record's key — O(1) memory, whatever the stream size. It does not build a
   whole-stream seen-set and it does NOT sort. So a stream like
     A A B A
   collapses to
     A B A
   — the trailing A is a new run because a B interrupted it. If you want the
   whole-stream, first-wins, order-stable dedup instead (drop the second A too),
   that is a different tool: dedup-filter. This gift will not silently do that
   for you, and it will not sort your stream to make far-apart duplicates
   adjacent. Adjacency is the contract.

   WHAT COUNTS AS EQUAL (same key story as its sibling). Two modes, and the
   identity key is the only thing that differs:

     - DEFAULT (whole-record identity). A record's key is its CANONICAL JSON form:
       re-serialized with object keys sorted, recursively. So {"a":1,"b":2} and
       {"b":2,"a":1} are the SAME record (object key-order is not meaningful) and
       an adjacent second one is dropped — but [1,2] and [2,1] are DIFFERENT
       (array order IS meaningful). Canonicalizing the KEY, not the LINE, is what
       makes "same record written two ways" collapse while still emitting the
       original line untouched.

     - --key FIELD (compare by one field). The run key is the value of the named
       top-level field, canonicalized the same way. Adjacent records carrying the
       same field value collapse even if the rest of the record differs (the FIRST
       is kept verbatim). A record that LACKS the field breaks the run and is
       always kept — a missing key is not a value, so it never counts as "equal"
       to anything, including another missing key.

   FIRST-OF-RUN WINS, ORDER STABLE. The kept record for any run is always the
   FIRST one seen in that run; the relative order of the kept records is exactly
   their input order. A deliberate, pinned choice (not "last of run", not
   "sorted"): it keeps the filter one-pass, O(1), and the output a stable,
   re-derivable subset of the input.

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
       (a bare number, string, array) means "no such field" -> that record breaks
       the run and is kept.

   USAGE
     printf '%s\n' '{"id":1}' '{"id":1}' '{"id":2}' '{"id":1}' | node uniq-filter.js
     node uniq-filter.js --key id events.jsonl        # collapse adjacent by id
     node uniq-filter.js --count < in.jsonl > out.jsonl   # run tally on stderr
     node uniq-filter.js --help

   Each non-blank line is one JSON record. Output is the kept records (first of
   each adjacent run), one per line, each terminated by a newline, in input order.

   Exit codes: 0 success · 2 input error (missing file, a directory, an unknown
   option, or a line that is not valid JSON). Always a clean one-line message on
   stderr, never a stack trace. --count writes the tally of collapsed lines to
   stderr; it never changes the exit code or the emitted stream, so it is safe in
   a pipe.

   Released under MIT. Its edge is printed in the README: this collapses ADJACENT
   runs only (O(1) memory). It does NOT global-dedup (far-apart duplicates are
   kept), does NOT sort the stream for you, and is NOT fuzzy/near matching. For
   whole-stream first-wins dedup, use dedup-filter; sort first if your duplicates
   are not already adjacent.
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

// The public filter: JSONL text + {key} -> { lines: [kept lines], collapsed: N }.
// Only the PREVIOUS record's key is remembered (O(1)): a line whose key equals the
// previous kept run's key is dropped; any other line starts a new run and is kept.
// A record with no --key field can never be "equal" to the previous key, so it
// always breaks the run: each such record gets a FRESH object identity, which is
// never === any earlier key (string keys or other fresh objects included).

function filter(text, opts) {
  opts = opts || {};
  var keyField = opts.key; // undefined => whole-record identity

  var lines = String(text).split("\n");
  var kept = [];
  var collapsed = 0;
  var havePrev = false;
  var prevKey = null;
  var i, line, rec, k;

  for (i = 0; i < lines.length; i++) {
    line = lines[i];
    if (line.charCodeAt(line.length - 1) === 0x0d) line = line.slice(0, -1); // trim \r
    if (line.length === 0) continue; // blank line is not a record

    rec = parseRecord(line, i + 1);

    if (keyField === undefined) {
      k = canon(rec); // whole-record identity
    } else {
      // compare by one top-level field; a record lacking it never matches
      if (rec !== null && typeof rec === "object" && !Array.isArray(rec) &&
          Object.prototype.hasOwnProperty.call(rec, keyField)) {
        k = "K:" + canon(rec[keyField]);
      } else {
        k = {}; // fresh object identity => never equal to the previous key
      }
    }

    // A run continues only when the key is a real (string) key equal to the
    // previous one. A fresh {} (missing-field record) is never === a string key
    // or another {}, so a missing-field record always breaks the run and is kept.
    if (havePrev && k === prevKey) { collapsed += 1; continue; }

    kept.push(line);
    prevKey = k;
    havePrev = true;
  }

  return { lines: kept, collapsed: collapsed };
}

/* ---- exports (browser + Node) ------------------------------------ */
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.uniqFilter = filter;
  window.ForestGifts.uniqCanon = canon;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { filter: filter, canon: canon };
}

/* ---- CLI (runs only when invoked directly, never on require) ------ */
function run(text, opts) {
  var r = filter(text, opts);
  var body = r.lines.length ? r.lines.join("\n") + "\n" : "";
  return { out: body, collapsed: r.collapsed };
}

function main(argv) {
  var args = argv.slice(2);
  if (args.indexOf("--help") !== -1 || args.indexOf("-h") !== -1) {
    process.stdout.write(
      "uniq-filter.js — collapse ADJACENT duplicate records in a JSONL stream.\n\n" +
      "  printf '%s\\n' '{\"id\":1}' '{\"id\":1}' '{\"id\":2}' | node uniq-filter.js\n" +
      "  node uniq-filter.js --key id events.jsonl        collapse adjacent by id\n" +
      "  node uniq-filter.js --count < in > out           run tally on stderr\n" +
      "  node uniq-filter.js --help\n\n" +
      "Each non-blank line is one JSON record. A maximal run of CONSECUTIVE equal\n" +
      "records collapses to its FIRST member (kept verbatim). By DEFAULT equality is\n" +
      "the CANONICAL record form (object key-order ignored, array order kept);\n" +
      "--key FIELD compares one top-level field instead. Output is a stable SUBSET of\n" +
      "the input in original order.\n\n" +
      "Edge: ADJACENT runs only, O(1) memory. It does NOT global-dedup (far-apart\n" +
      "duplicates are kept), does NOT sort for you, and is NOT fuzzy matching. Use\n" +
      "dedup-filter for whole-stream dedup; sort first if runs aren't adjacent.\n" +
      "Invalid JSON is a hard error, never a silent skip.\n"
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
    process.stderr.write("uniq-filter: " + e.message + "\n");
    return 2;
  }

  function emit(text) {
    try {
      var r = run(text, opts);
      process.stdout.write(r.out);
      if (countMode) process.stderr.write("uniq-filter: collapsed " + r.collapsed + " adjacent duplicate(s)\n");
      return 0;
    } catch (e) {
      process.stderr.write("uniq-filter: " + e.message + "\n");
      return 2;
    }
  }

  if (files.length > 0) {
    var fs = require("fs");
    var text;
    try { text = fs.readFileSync(files[0], "utf8"); }
    catch (e) {
      process.stderr.write("uniq-filter: cannot read " + files[0] +
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
