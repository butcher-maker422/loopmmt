#!/usr/bin/env node
/* rename.js — rename fields in each record of a JSONL stream, by a declared map.
   Dependency-free, deterministic, one pass. Runs in Node or a browser. MIT.

   WHAT IT IS. Give it a stream of records — one JSON object per line (JSONL) — and
   a mapping of old field names to new ones, and it emits each record with those
   fields relabeled. It is a TRANSFORM on the field axis: every record keeps all
   its values, but a mapped field's KEY is replaced with its new name. Same stream
   and same map in, byte-identical stream out, on every machine and every run. It
   is the field-rename of the JSONL toolkit — the companion to pluck (which drops
   fields): pluck SELECTS, rename RELABELS.

   THE MAP IS old=new PAIRS (the whole determinism story). --map old1=new1,old2=new2
   declares, for each pair, "wherever a record has the field old1, emit it under the
   name new1 instead." A field the map does not mention is passed through UNCHANGED,
   under its original name. A mapped field the record does not have is simply not
   renamed (there is nothing to rename) — see --strict.

   THE OUTPUT KEY ORDER IS THE INPUT ORDER, WITH NAMES SWAPPED IN PLACE. Renaming a
   field does NOT move it: {"a":1,"b":2} under --map a=x emits {"x":1,"b":2}, not
   {"b":2,"x":1}. The record's own field order is preserved; only the mapped keys'
   names change. This is what makes rename a faithful transform — it relabels, it
   never reorders. (Values are canonicalized for byte-stability: a mapped or
   unmapped field's VALUE, if a nested object, has its inner keys sorted; array
   order is kept.)

   COLLISIONS ARE A HARD ERROR (fail closed). If a rename would make two fields
   share a name — either the target name already exists in the record and is not
   itself being renamed away, or two different source fields map to the same target
   — that record is a HARD ERROR (exit 2) naming the line and the colliding name.
   rename never silently drops or overwrites a value to resolve a name clash.

   MISSING SOURCE FIELDS (default vs --strict).
     - DEFAULT: a mapped source field the record does not carry is simply skipped —
       there is nothing to rename, and the record passes through with its other
       fields intact. A record that has none of the mapped fields is emitted
       unchanged.
     - --strict: a record missing ANY mapped source field is a HARD ERROR (exit 2)
       naming the line and the first missing source field. For callers who require
       every declared field to be present before relabeling.

   INPUT HONESTY (the character of this gift).
     - Every non-blank line must be valid JSON. A line that is not valid JSON is a
       HARD ERROR (exit 2) naming the line — never a silent skip, never a raw
       passthrough.
     - Every record must be a JSON OBJECT. You cannot rename a field of a bare
       number, string, boolean, null, or array — there are no fields. A non-object
       record is a HARD ERROR (exit 2) naming the line.
     - --map names TOP-LEVEL fields only (no dotted paths). Both sides of a pair
       must be non-empty; a malformed pair (no '=', empty old, empty new) is a hard
       error at map-parse time.
     - Blank lines are skipped. A trailing \r (CRLF files) is trimmed.

   USAGE
     printf '%s\n' '{"a":1,"b":2}' | node rename.js --map a=x
        -> {"x":1,"b":2}
     node rename.js --map user_id=id,ts=timestamp events.jsonl
     node rename.js --map a=x --strict < in.jsonl > out.jsonl
     node rename.js --help

   Each non-blank line is one JSON object. Output is the relabeled objects, one per
   line, each terminated by a newline, in input order.

   Exit codes: 0 success · 2 input error (missing/empty/malformed --map, missing
   file, a directory, an unknown option, a line that is not valid JSON, a non-object
   record, a rename collision, or --strict on a record missing a mapped source
   field). Always a clean one-line message on stderr, never a stack trace.

   Released under MIT. Its edge is printed in the README: this renames TOP-LEVEL
   fields by exact name. It does NOT reach into nested paths (no dotted keys), does
   NOT move fields (order is preserved, names swapped in place), does NOT drop or
   transform values, and REFUSES a rename that would collide two fields onto one
   name rather than silently overwriting.
*/
"use strict";

// Canonical JSON for VALUES: object keys sorted recursively so a value serializes
// to the same bytes regardless of its (nested) key order. Arrays keep order.
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

function parseRecord(line, lineNo) {
  try { return JSON.parse(line); }
  catch (e) {
    throw new Error("line " + lineNo + " is not valid JSON: " + JSON.stringify(line.slice(0, 40)));
  }
}

// Parse "old1=new1,old2=new2" into an ordered [ [old,new], ... ] with validation.
// Throws on a malformed pair. A source named twice is an error (ambiguous map).
function parseMap(spec) {
  var pairs = [];
  var seenOld = Object.create(null);
  var pieces = String(spec).split(",");
  for (var i = 0; i < pieces.length; i++) {
    var piece = pieces[i].trim();
    if (piece.length === 0) continue; // tolerate trailing comma
    var eq = piece.indexOf("=");
    if (eq <= 0 || eq === piece.length - 1) {
      throw new Error("malformed --map pair " + JSON.stringify(piece) + " (expected old=new)");
    }
    var oldName = piece.slice(0, eq).trim();
    var newName = piece.slice(eq + 1).trim();
    if (oldName.length === 0 || newName.length === 0) {
      throw new Error("malformed --map pair " + JSON.stringify(piece) + " (empty field name)");
    }
    if (seenOld[oldName]) {
      throw new Error("--map names source field " + JSON.stringify(oldName) + " more than once");
    }
    seenOld[oldName] = true;
    pairs.push([oldName, newName]);
  }
  if (pairs.length === 0) throw new Error("--map lists no rename pairs");
  return pairs;
}

// The public transform: JSONL text + {map, strict} -> { lines: [renamed lines] }.
// Each record keeps its own field order; a mapped key's NAME is swapped in place.
// A collision (two fields would share a name) is a hard error.
function rename(text, opts) {
  opts = opts || {};
  var pairs = opts.pairs || (opts.map ? parseMap(opts.map) : []);
  var strict = !!opts.strict;

  // old -> new lookup
  var mapOf = Object.create(null);
  for (var p = 0; p < pairs.length; p++) mapOf[pairs[p][0]] = pairs[p][1];

  var lines = String(text).split("\n");
  var out = [];
  var i, line, rec, keys, j, key, outName, present;

  for (i = 0; i < lines.length; i++) {
    line = lines[i];
    if (line.charCodeAt(line.length - 1) === 0x0d) line = line.slice(0, -1); // trim \r
    if (line.length === 0) continue;

    rec = parseRecord(line, i + 1);
    if (rec === null || typeof rec !== "object" || Array.isArray(rec)) {
      throw new Error("line " + (i + 1) + " is not a JSON object (cannot rename fields of " +
        (rec === null ? "null" : (Array.isArray(rec) ? "an array" : typeof rec)) + ")");
    }

    // strict: every mapped source field must be present
    if (strict) {
      for (j = 0; j < pairs.length; j++) {
        if (!Object.prototype.hasOwnProperty.call(rec, pairs[j][0])) {
          throw new Error("line " + (i + 1) + " is missing required source field " + JSON.stringify(pairs[j][0]));
        }
      }
    }

    // Build the output object's (name -> value) in the record's OWN key order,
    // swapping mapped names in place. Detect collisions on the OUTPUT names.
    keys = Object.keys(rec);
    var outNames = [];        // output names, in input order
    var outVals = [];         // canonicalized values, parallel to outNames
    var claimed = Object.create(null);
    for (j = 0; j < keys.length; j++) {
      key = keys[j];
      outName = Object.prototype.hasOwnProperty.call(mapOf, key) ? mapOf[key] : key;
      if (claimed[outName]) {
        throw new Error("line " + (i + 1) + " rename collision: two fields map to " + JSON.stringify(outName));
      }
      claimed[outName] = true;
      outNames.push(outName);
      outVals.push(canon(rec[key]));
    }

    var parts = [];
    for (j = 0; j < outNames.length; j++) {
      parts.push(JSON.stringify(outNames[j]) + ":" + outVals[j]);
    }
    out.push("{" + parts.join(",") + "}");
  }

  return { lines: out };
}

/* ---- exports (browser + Node) ------------------------------------ */
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.rename = rename;
  window.ForestGifts.renameCanon = canon;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { rename: rename, canon: canon, parseMap: parseMap };
}

/* ---- CLI (runs only when invoked directly, never on require) ------ */
function run(text, opts) {
  var r = rename(text, opts);
  var body = r.lines.length ? r.lines.join("\n") + "\n" : "";
  return { out: body };
}

function main(argv) {
  var args = argv.slice(2);
  if (args.indexOf("--help") !== -1 || args.indexOf("-h") !== -1) {
    process.stdout.write(
      "rename.js — rename fields in each record of a JSONL stream, by a declared map.\n\n" +
      "  printf '%s\\n' '{\"a\":1,\"b\":2}' | node rename.js --map a=x\n" +
      "  node rename.js --map user_id=id,ts=timestamp events.jsonl\n" +
      "  node rename.js --map a=x --strict < in > out\n" +
      "  node rename.js --help\n\n" +
      "--map is a comma-separated list of old=new TOP-LEVEL field renames. A field not\n" +
      "in the map passes through unchanged; a renamed field keeps its POSITION (names\n" +
      "are swapped in place, not moved). A missing source field is skipped (or a hard\n" +
      "error under --strict). A rename that would collide two fields onto one name is a\n" +
      "hard error.\n\n" +
      "Edge: renames TOP-LEVEL fields by exact name. NOT nested paths (no a.b.c), does\n" +
      "NOT move fields, does NOT drop or transform values, and REFUSES a collision\n" +
      "rather than overwriting. Invalid JSON and non-object records are hard errors.\n"
    );
    return 0;
  }

  var opts = {};
  var files = [];
  var i;
  try {
    for (i = 0; i < args.length; i++) {
      if (args[i] === "--map") {
        var spec = args[++i];
        if (spec === undefined || spec === "" || spec.charAt(0) === "-") {
          throw new Error("--map requires a comma-separated list of old=new renames");
        }
        opts.pairs = parseMap(spec);
      }
      else if (args[i] === "--strict") { opts.strict = true; }
      else if (args[i].charAt(0) === "-") { throw new Error("unknown option " + args[i]); }
      else { files.push(args[i]); }
    }
    if (!opts.pairs || opts.pairs.length === 0) {
      throw new Error("--map is required (a comma-separated list of old=new field renames)");
    }
  } catch (e) {
    process.stderr.write("rename: " + e.message + "\n");
    return 2;
  }

  function emit(text) {
    try {
      var r = run(text, opts);
      process.stdout.write(r.out);
      return 0;
    } catch (e) {
      process.stderr.write("rename: " + e.message + "\n");
      return 2;
    }
  }

  if (files.length > 0) {
    var fs = require("fs");
    var text;
    try { text = fs.readFileSync(files[0], "utf8"); }
    catch (e) {
      process.stderr.write("rename: cannot read " + files[0] +
        " (" + (e.code === "EISDIR" ? "is a directory" : (e.code || "read error")) + ")\n");
      return 2;
    }
    return emit(text);
  }

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
