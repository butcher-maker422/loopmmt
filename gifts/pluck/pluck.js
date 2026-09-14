#!/usr/bin/env node
/* pluck.js — keep only the named fields from each record in a JSONL stream.
   Dependency-free, deterministic, one pass. Runs in Node or a browser. MIT.

   WHAT IT IS. Give it a stream of records — one JSON object per line (JSONL) —
   and a list of field names, and it emits each record reduced to just those
   fields. It is the SELECT of the JSONL toolkit: narrow a wide record down to
   the columns you asked for, before you fold, diff, or sink it. Same stream and
   same field list in, byte-identical stream out, on every machine and every run.
   It is a FILTER on the field axis: every emitted object is a subset of its input
   object's fields — nothing is added, renamed, computed, or reordered by content.

   THE FIELD ORDER IS THE DECLARED ORDER (the whole determinism story). The output
   object's keys appear in the order you named them in --fields, NOT the order they
   happened to sit in the input record. So `--fields b,a` emits {"b":...,"a":...}
   regardless of how the input was written. Declaring the order — rather than
   inheriting the input's — is what makes the output a pure function of (record,
   field-list): two records that carry the same requested values, written in any
   key-order, pluck to byte-identical lines. A field named twice in --fields is
   emitted once, at its first position (duplicates in the request are idempotent).

   WHAT HAPPENS TO A MISSING FIELD (default vs --strict).
     - DEFAULT: a requested field the record does not carry is simply OMITTED from
       that record's output object. A missing field is not a value — it is not
       emitted as null, not as "", not as the literal key with nothing after it. A
       record that carries none of the requested fields emits an empty object {}.
       This is the honest default: pluck what is there, say nothing about what is
       not.
     - --strict: a record missing ANY requested field is a HARD ERROR (exit 2)
       naming the line and the first missing field. For callers who need every
       column present and want the stream to stop rather than emit a thin record.

   INPUT HONESTY (the character of this gift). A field-selector is only trustworthy
   if it refuses to quietly mishandle a line:
     - Every non-blank line must be valid JSON. A line that is not valid JSON is a
       HARD ERROR (exit 2) naming the line — never a silent skip, never passed
       through as raw text.
     - Every record must be a JSON OBJECT. You cannot pluck fields from a bare
       number, string, boolean, null, or array — there are no fields to select. A
       non-object record is a HARD ERROR (exit 2) naming the line. This is the
       deliberate divergence from a row-dropping filter: pluck's whole contract is
       field-selection, so a record with no field axis is a stop, not a passthrough.
     - --fields names TOP-LEVEL fields only (no dotted paths, no array indices).
       Selecting a nested value is out of scope by construction (see the edge).
     - Blank lines are skipped (not emitted, not counted). A trailing \r (CRLF
       files) is trimmed before parsing.

   THE OUTPUT IS CANONICAL. Each emitted object is re-serialized with its keys in
   the declared field order and its values canonicalized (nested object keys sorted
   recursively, array order kept), so the same requested values always serialize to
   the same bytes. Values are copied through verbatim in meaning — pluck selects,
   it never transforms a value.

   USAGE
     printf '%s\n' '{"a":1,"b":2,"c":3}' | node pluck.js --fields a,c
        -> {"a":1,"c":3}
     node pluck.js --fields id,name events.jsonl
     node pluck.js --fields id,name --strict < in.jsonl > out.jsonl
     node pluck.js --help

   Each non-blank line is one JSON object. Output is the plucked objects, one per
   line, each terminated by a newline, in input order.

   Exit codes: 0 success · 2 input error (missing/empty --fields, missing file, a
   directory, an unknown option, a line that is not valid JSON, a non-object
   record, or --strict on a record missing a requested field). Always a clean
   one-line message on stderr, never a stack trace.

   Released under MIT. Its edge is printed in the README: this selects TOP-LEVEL
   fields by exact name. It does NOT reach into nested paths (no dotted keys, no
   a.b.c), does NOT rename fields, does NOT compute or default missing values, and
   does NOT reorder by content — the output key order is exactly the --fields order.
*/
"use strict";

// Canonical JSON: object keys sorted recursively so a value serializes to the same
// bytes regardless of how its (nested) object keys were written. Arrays keep order.
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

// De-duplicate the requested field list, preserving first-seen order. A field
// named twice is kept once at its first position (idempotent request).
function normalizeFields(fields) {
  var seen = Object.create(null);
  var out = [];
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    if (!seen[f]) { seen[f] = true; out.push(f); }
  }
  return out;
}

// Serialize a plucked object with keys in the DECLARED field order and values
// canonicalized. `present` is the list of requested fields this record actually
// carries, already in declared order.
function serializePlucked(rec, present) {
  var parts = [];
  for (var i = 0; i < present.length; i++) {
    var f = present[i];
    parts.push(JSON.stringify(f) + ":" + canon(rec[f]));
  }
  return "{" + parts.join(",") + "}";
}

// The public filter: JSONL text + {fields, strict} -> { lines: [plucked lines] }.
// Each emitted object carries the requested fields the record has, in declared
// order. In strict mode a record missing any requested field throws.
function pluck(text, opts) {
  opts = opts || {};
  var fields = normalizeFields(opts.fields || []);
  var strict = !!opts.strict;

  var lines = String(text).split("\n");
  var out = [];
  var i, line, rec, j, f, present;

  for (i = 0; i < lines.length; i++) {
    line = lines[i];
    if (line.charCodeAt(line.length - 1) === 0x0d) line = line.slice(0, -1); // trim \r
    if (line.length === 0) continue; // blank line is not a record

    rec = parseRecord(line, i + 1);

    // A record must be a JSON object to have a field axis to select on.
    if (rec === null || typeof rec !== "object" || Array.isArray(rec)) {
      throw new Error("line " + (i + 1) + " is not a JSON object (cannot pluck fields from " +
        (rec === null ? "null" : (Array.isArray(rec) ? "an array" : typeof rec)) + ")");
    }

    present = [];
    for (j = 0; j < fields.length; j++) {
      f = fields[j];
      if (Object.prototype.hasOwnProperty.call(rec, f)) {
        present.push(f);
      } else if (strict) {
        throw new Error("line " + (i + 1) + " is missing required field " + JSON.stringify(f));
      }
    }

    out.push(serializePlucked(rec, present));
  }

  return { lines: out };
}

/* ---- exports (browser + Node) ------------------------------------ */
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.pluck = pluck;
  window.ForestGifts.pluckCanon = canon;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { pluck: pluck, canon: canon };
}

/* ---- CLI (runs only when invoked directly, never on require) ------ */
function run(text, opts) {
  var r = pluck(text, opts);
  var body = r.lines.length ? r.lines.join("\n") + "\n" : "";
  return { out: body };
}

function main(argv) {
  var args = argv.slice(2);
  if (args.indexOf("--help") !== -1 || args.indexOf("-h") !== -1) {
    process.stdout.write(
      "pluck.js — keep only the named fields from each record in a JSONL stream.\n\n" +
      "  printf '%s\\n' '{\"a\":1,\"b\":2,\"c\":3}' | node pluck.js --fields a,c\n" +
      "  node pluck.js --fields id,name events.jsonl\n" +
      "  node pluck.js --fields id,name --strict < in > out\n" +
      "  node pluck.js --help\n\n" +
      "Each non-blank line is one JSON object. --fields is a comma-separated list of\n" +
      "TOP-LEVEL field names to keep; the output key order is exactly that order. A\n" +
      "missing field is OMITTED by default, or a hard error under --strict. A record\n" +
      "that is not a JSON object is a hard error.\n\n" +
      "Edge: selects TOP-LEVEL fields by exact name. NOT nested paths (no a.b.c), does\n" +
      "NOT rename or compute fields, and does NOT reorder by content. Invalid JSON and\n" +
      "non-object records are hard errors, never a silent skip.\n"
    );
    return 0;
  }

  var opts = { fields: [] };
  var files = [];
  var i, raw;
  try {
    for (i = 0; i < args.length; i++) {
      if (args[i] === "--fields") {
        raw = args[++i];
        if (raw === undefined || raw === "" || raw.charAt(0) === "-") {
          throw new Error("--fields requires a comma-separated list of field names");
        }
        // split on comma, trim each, drop empties (so trailing commas are tolerated)
        var wanted = [];
        var pieces = raw.split(",");
        for (var p = 0; p < pieces.length; p++) {
          var name = pieces[p].trim();
          if (name.length > 0) wanted.push(name);
        }
        if (wanted.length === 0) throw new Error("--fields lists no field names");
        opts.fields = wanted;
      }
      else if (args[i] === "--strict") { opts.strict = true; }
      else if (args[i].charAt(0) === "-") { throw new Error("unknown option " + args[i]); }
      else { files.push(args[i]); }
    }
    if (!opts.fields || opts.fields.length === 0) {
      throw new Error("--fields is required (a comma-separated list of field names to keep)");
    }
  } catch (e) {
    process.stderr.write("pluck: " + e.message + "\n");
    return 2;
  }

  function emit(text) {
    try {
      var r = run(text, opts);
      process.stdout.write(r.out);
      return 0;
    } catch (e) {
      process.stderr.write("pluck: " + e.message + "\n");
      return 2;
    }
  }

  if (files.length > 0) {
    var fs = require("fs");
    var text;
    try { text = fs.readFileSync(files[0], "utf8"); }
    catch (e) {
      process.stderr.write("pluck: cannot read " + files[0] +
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
