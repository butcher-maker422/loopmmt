#!/usr/bin/env node
/* schema-filter.js — pass only the JSONL records that match a declared JSON shape.
   Dependency-free, deterministic, one pass, order-stable. Runs in Node or a browser. MIT.

   WHAT IT IS. Give it a stream of records — one JSON object per line (JSONL) — and a
   SHAPE you declare as a set of typed fields, and it emits, verbatim and in input
   order, exactly the records that match EVERY declared field. Everything else is
   dropped. It is a SUBSET filter: the output is a subset of the input, byte-for-byte
   per surviving record, so `schema-filter` in a pipe never invents or reshapes a
   record — it only decides which ones pass.

   A FIELD CONSTRAINT names one field and the JSON TYPE it must hold:

       --field    NAME TYPE     require NAME present AND of TYPE (fail-closed if absent)
       --optional NAME TYPE     if NAME is present it must be TYPE; if absent, it passes

   TYPE is one of a documented, closed set of seven JSON types:

       string   a JSON string
       number   a finite JSON number (integer or fractional)
       integer  a finite JSON number with no fractional part
       boolean  true or false
       object   a JSON object (not an array, not null)
       array    a JSON array
       null     the JSON literal null

   Declare more than one field and they AND together: a record survives only if it
   matches all of them. Declare none and every well-formed record passes (the identity
   filter) — a deliberate, documented default, not an error.

   THE MISSING-FIELD POLICY (the whole honesty story). A `--field` constraint is a
   claim the record must satisfy, and a record that LACKS that field cannot be shown to
   satisfy it, so it is DROPPED. This is fail-closed — absence is not a match. Use
   `--optional` for the "if this field is present it must be a date, otherwise leave the
   record alone" shape: an optional field that is absent passes; an optional field that
   is present but the WRONG type still fails. The choice is per field, declared once, so
   a stream is filtered under one explicit shape.

   TYPE, NOT VALUE. schema-filter tests a value's TYPE, never its meaning. A record with
   the right types passes even if the values are nonsense: `{"age": -999}` matches
   `--field age integer`. It does not coerce (the string "5" does NOT match `number`),
   does not infer a schema from the data, does not reshape, sort, or de-duplicate
   surviving records. `number` excludes non-finite values by construction (valid JSON
   cannot carry NaN or Infinity, so this only ever matters for a hostile embedder).
   `integer` is a type test (no fractional part), never a rounding.

   DETERMINISM. Records are tested and emitted in input order; a surviving record is
   written back byte-for-byte as it arrived (the original line, trailing \r trimmed), so
   the same stream and the same shape yield byte-identical output on every machine and
   every run.

   STRICTNESS. A filter is only trustworthy if it refuses to guess:
     - Every non-blank line must be a JSON OBJECT. A line that is not valid JSON, or is
       valid JSON but not an object (a number, string, array, null), is a HARD ERROR
       (exit 2) naming the line — never a silent skip.
     - An unknown TYPE token in a `--field`/`--optional` declaration is a hard error
       (exit 2) at startup, before any record is read — a shape you cannot express is a
       bug in the caller's declaration, surfaced loudly, not an empty result.

   USAGE
     cat people.jsonl | node schema-filter.js --field name string --field age integer
     node schema-filter.js --field id string --optional email string in.jsonl
     node schema-filter.js --field tags array < items.jsonl
     node schema-filter.js --help

   Each non-blank line is one JSON object. Blank lines are skipped. A trailing \r
   (CRLF files) is trimmed. Surviving records are emitted one per line, verbatim.

   Exit codes: 0 success (with or without survivors) · 2 input error (missing file, a
   directory, a malformed constraint, an unknown type, or a line that is not a JSON
   object). Always a clean one-line message on stderr, never a stack trace.

   Released under MIT. Its edge is printed in the README: this is a SUBSET filter over a
   DECLARED shape. It filters on the fields and types YOU name — it does not infer a
   schema, does not reshape or reformat surviving records, does not sort, and does not
   de-duplicate. A record matching every declared type passes even if its values are
   wrong: the constraint tests a value's TYPE, never its truth.
*/
"use strict";

/* ---- the pure core ------------------------------------------------ */

// The closed set of declarable JSON types. A shape you cannot express is refused.
var TYPES = {
  string: 1, number: 1, integer: 1, boolean: 1, object: 1, array: 1, "null": 1
};

// Does one JSON value match one declared type? Total over the seven types;
// an out-of-set type never matches (the CLI refuses those before this runs).
function matchType(val, type) {
  switch (type) {
    case "string":  return typeof val === "string";
    case "number":  return typeof val === "number" && isFinite(val);
    case "integer": return typeof val === "number" && isFinite(val) && Math.floor(val) === val;
    case "boolean": return typeof val === "boolean";
    case "object":  return val !== null && typeof val === "object" && !Array.isArray(val);
    case "array":   return Array.isArray(val);
    case "null":    return val === null;
  }
  return false;
}

// A parsed constraint: { field, type, optional }. Does one record satisfy it?
function satisfies(rec, c) {
  var has = Object.prototype.hasOwnProperty.call(rec, c.field);
  if (!has) return !!c.optional;            // missing: required -> fail, optional -> pass
  return matchType(rec[c.field], c.type);   // present: must match the declared type
}

// The public filter: JSONL text + parsed constraints -> the surviving records,
// in input order, each as { line, record }.
//   constraints: [ {field, type, optional}, ... ]
// Throws a clean, line-named Error on a line that is not a JSON object.
function filter(text, constraints) {
  var lines = String(text).split("\n");
  var out = [];
  var i, line, rec;

  for (i = 0; i < lines.length; i++) {
    line = lines[i];
    if (line.charCodeAt(line.length - 1) === 0x0d) line = line.slice(0, -1); // trim \r
    if (line.length === 0) continue; // blank line is not a record

    try { rec = JSON.parse(line); }
    catch (e) {
      throw new Error("line " + (i + 1) + " is not valid JSON: " +
        JSON.stringify(line.slice(0, 40)));
    }
    if (rec === null || typeof rec !== "object" || Array.isArray(rec)) {
      throw new Error("line " + (i + 1) + " is not a JSON object (got " +
        (rec === null ? "null" : Array.isArray(rec) ? "array" : typeof rec) + "): " +
        JSON.stringify(line.slice(0, 40)));
    }

    var pass = true;
    for (var k = 0; k < constraints.length; k++) {
      if (!satisfies(rec, constraints[k])) { pass = false; break; }
    }
    if (pass) out.push({ line: line, record: rec });
  }
  return out;
}

/* ---- exports (browser + Node) ------------------------------------ */
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.schemaFilter = filter;
  window.ForestGifts.schemaFilterMatchType = matchType;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { filter: filter, satisfies: satisfies, matchType: matchType };
}

/* ---- CLI (runs only when invoked directly, never on require) ------ */

// Parse argv into { constraints, files }. Throws a clean Error on a bad declaration.
function parseArgs(args) {
  var constraints = [];
  var files = [];
  var i = 0;
  while (i < args.length) {
    var a = args[i];
    if (a === "--field" || a === "--optional") {
      var optional = a === "--optional";
      var field = args[i + 1], type = args[i + 2];
      if (field === undefined || type === undefined || field.charAt(0) === "-") {
        throw new Error(a + " requires FIELD TYPE (e.g. " + a + " age integer)");
      }
      if (!Object.prototype.hasOwnProperty.call(TYPES, type)) {
        throw new Error(a + " " + field + ": unknown type " + JSON.stringify(type) +
          " (declare one of: string number integer boolean object array null)");
      }
      constraints.push({ field: field, type: type, optional: optional });
      i += 3;
    } else if (a.charAt(0) === "-") {
      throw new Error("unknown option " + a);
    } else {
      files.push(a); i += 1;
    }
  }
  return { constraints: constraints, files: files };
}

function run(text, constraints) {
  var survivors = filter(text, constraints);
  var s = "";
  for (var i = 0; i < survivors.length; i++) s += survivors[i].line + "\n";
  return s;
}

function main(argv) {
  var args = argv.slice(2);
  if (args.indexOf("--help") !== -1 || args.indexOf("-h") !== -1) {
    process.stdout.write(
      "schema-filter.js — pass only the JSONL records that match a declared JSON shape.\n\n" +
      "  cat people.jsonl | node schema-filter.js --field name string --field age integer\n" +
      "  node schema-filter.js --field id string --optional email string in.jsonl\n" +
      "  node schema-filter.js --field tags array < items.jsonl\n" +
      "  node schema-filter.js --help\n\n" +
      "  --field    NAME TYPE   require NAME present AND of TYPE (fail-closed if absent)\n" +
      "  --optional NAME TYPE   if NAME is present it must be TYPE; if absent, it passes\n\n" +
      "TYPE is one of: string number integer boolean object array null\n" +
      "Multiple fields AND together. No fields = every well-formed record passes.\n" +
      "Surviving records are emitted VERBATIM, in input order.\n\n" +
      "Edge: this is a SUBSET filter over a DECLARED shape. It tests a value's TYPE,\n" +
      "never its meaning; it does not coerce, infer a schema, reshape, sort, or\n" +
      "de-duplicate. Absence fails a --field and passes an --optional. A non-object\n" +
      "line or an unknown type is a hard error (exit 2).\n"
    );
    return 0;
  }

  var parsed;
  try { parsed = parseArgs(args); }
  catch (e) { process.stderr.write("schema-filter: " + e.message + "\n"); return 2; }

  function emit(text) {
    try { process.stdout.write(run(text, parsed.constraints)); return 0; }
    catch (e) { process.stderr.write("schema-filter: " + e.message + "\n"); return 2; }
  }

  if (parsed.files.length > 0) {
    var fs = require("fs");
    var text;
    try { text = fs.readFileSync(parsed.files[0], "utf8"); }
    catch (e) {
      process.stderr.write("schema-filter: cannot read " + parsed.files[0] +
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
