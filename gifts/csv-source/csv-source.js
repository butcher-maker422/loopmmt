#!/usr/bin/env node
/* csv-source.js — turn CSV text into a JSONL record stream, one object per row.
   Dependency-free, deterministic, pure. Runs in Node or a browser. MIT.

   WHAT IT IS. A SOURCE for the JSONL gift lane: it reads CSV text (a file, or
   stdin) and emits one JSON object per data row — the front of a pipe you feed
   INTO the fold/filter/transform gifts. CSV is the most common shape real tabular
   data arrives in; csv-source is the on-ramp that turns it into the one-object-per-
   line stream every other gift here consumes.

       name,age            ->  {"name":"ada","age":"36"}
       ada,36                  {"name":"grace","age":"41"}
       grace,41

       cat people.csv | csv-source | range-filter --num age 30 40   (needs --cast first for real >)

   RFC 4180, honestly. It parses the real grammar, not a comma-split: fields may be
   quoted with " ", a quote inside a quoted field is written "" (doubled), and a
   quoted field may contain commas and newlines. Both LF and CRLF line endings are
   accepted; a trailing newline is optional. Unquoted fields are taken verbatim
   (leading/trailing spaces kept — CSV does not trim).

   VALUES ARE STRINGS (the honesty axis). Every emitted value is a STRING, exactly as
   it appeared in the file. csv-source does NOT guess types — "36" stays "36", not 36;
   "true" stays "true"; "" is the empty string, not null. This is deliberate: CSV has
   no type information, so a source that inferred types would be inventing data the
   file never carried, and the same file could parse differently on different guessers.
   Type it downstream on purpose (a --cast transform), never by accident here.

   RAGGED ROWS FAIL CLOSED. With a header, every data row MUST have exactly as many
   fields as the header. A row with too few or too many is a hard error (exit 2) naming
   the row — never silently padded or truncated. If you actually want padding, opt in
   with --fill VALUE (short rows are filled with VALUE, long rows are still an error).

   THE MODEL
     (positional)  FILE   Optional path to a .csv file. With no path, reads stdin.
     --no-header          Treat row 1 as data, not names. Keys become c0, c1, c2, ...
     --fill VALUE         Pad short rows to the header width with VALUE (string).
                          Without it, a short row is a hard error.
     --delim CH           Field delimiter, a single character. Default "," (comma).

   With a header, each row emits { name0: v0, name1: v1, ... } under the header names
   (a duplicate header name is a hard error — it would silently drop a column). Empty
   header names are permitted only under an explicit design choice? No: an empty header
   name is a hard error too (it would collide and hide a column). Under --no-header the
   keys are c0..c{n-1} by column index, so the stream is always well-keyed.

   DETERMINISM. parse(text, opts) is a pure function — no clock, no randomness — so the
   same text and options yield byte-identical output every run and every machine. (CLI
   file/stdin reads are the impure edge; the core that decides the bytes is pure.)

   USAGE
     node csv-source.js people.csv
     cat people.csv | node csv-source.js --no-header
     node csv-source.js data.csv --delim ";" --fill ""
     node csv-source.js --help

   Exit codes: 0 success (including an empty file -> empty stream) · 2 input error
   (ragged row, duplicate/empty header name, unterminated quote, bad --delim, unknown
   option, unreadable file). Always a clean one-line message on stderr, never a stack.

   Released under MIT. Its edge is printed in the README: csv-source emits STRING values
   only — it never infers types (numbers, booleans, null stay as their text), never
   trims unquoted whitespace, and fails closed on a ragged row rather than padding it.
   A parser you can pin, not a comma-split you have to babysit.
*/
"use strict";

/* ---- the pure core ------------------------------------------------ */

// Tokenize CSV text into an array of rows, each an array of string fields, per
// RFC 4180. Throws a clean Error on an unterminated quoted field. Pure.
//   delim: single-character field delimiter.
function tokenize(text, delim) {
  var rows = [];
  var field = "";
  var row = [];
  var inQuotes = false;
  var i = 0;
  var n = text.length;
  var sawAny = false; // did we see any character at all on the current logical row?

  function endField() { row.push(field); field = ""; }
  function endRow() { row.push(field); field = ""; rows.push(row); row = []; sawAny = false; }

  while (i < n) {
    var c = text.charAt(i);
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < n && text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    // not in quotes
    if (c === '"') {
      // A quote opens a quoted field only at the field start; a quote mid-field is a
      // hard error (RFC 4180 does not allow a bare quote inside an unquoted field).
      if (field.length !== 0) throw new Error("stray quote in unquoted field (row " + (rows.length + 1) + ")");
      inQuotes = true; sawAny = true; i += 1; continue;
    }
    if (c === delim) { endField(); sawAny = true; i += 1; continue; }
    if (c === "\n") { endRow(); i += 1; continue; }
    if (c === "\r") {
      // CRLF or lone CR both end the row; swallow a following LF.
      endRow();
      if (i + 1 < n && text.charAt(i + 1) === "\n") i += 2; else i += 1;
      continue;
    }
    field += c; sawAny = true; i += 1;
  }
  if (inQuotes) throw new Error("unterminated quoted field at end of input");
  // Flush a final row unless the input ended exactly on a row terminator with nothing after.
  if (sawAny || field.length !== 0 || row.length !== 0) endRow();
  return rows;
}

// Parse CSV text into an array of records (objects). Pure; throws a clean Error on
// any structural problem — the CLI turns that into exit 2.
//   opts.header  : boolean (default true) — row 1 is names.
//   opts.fill    : string | undefined — pad short rows to header width if set.
//   opts.delim   : single-char delimiter (default ",").
function parse(text, opts) {
  opts = opts || {};
  var header = opts.header === undefined ? true : !!opts.header;
  var fill = opts.fill; // undefined => ragged short row is an error
  var delim = opts.delim === undefined ? "," : opts.delim;

  if (typeof delim !== "string" || delim.length !== 1) {
    throw new Error("--delim must be a single character");
  }
  if (delim === '"' || delim === "\n" || delim === "\r") {
    throw new Error("--delim must not be a quote or a line terminator");
  }

  var rows = tokenize(text, delim);
  if (rows.length === 0) return []; // empty input -> empty stream

  var names;
  var dataStart;
  if (header) {
    names = rows[0].slice();
    dataStart = 1;
    // Duplicate or empty header names would silently hide a column -> hard error.
    var seen = {};
    for (var h = 0; h < names.length; h++) {
      var nm = names[h];
      if (nm.length === 0) throw new Error("empty header name in column " + h + " (would hide a column)");
      if (Object.prototype.hasOwnProperty.call(seen, nm)) {
        throw new Error("duplicate header name " + JSON.stringify(nm) + " (would hide a column)");
      }
      seen[nm] = true;
    }
  } else {
    // Keys are c0..c{width-1}; width is taken from the first row.
    var width0 = rows[0].length;
    names = [];
    for (var k = 0; k < width0; k++) names.push("c" + k);
    dataStart = 0;
  }

  var width = names.length;
  var out = [];
  for (var r = dataStart; r < rows.length; r++) {
    var cells = rows[r];
    if (cells.length > width) {
      throw new Error("row " + (r + 1) + " has " + cells.length + " fields, expected " + width + " (too many)");
    }
    if (cells.length < width) {
      if (fill === undefined) {
        throw new Error("row " + (r + 1) + " has " + cells.length + " fields, expected " + width + " (too few; use --fill to pad)");
      }
      cells = cells.slice();
      while (cells.length < width) cells.push(fill);
    }
    var rec = {};
    for (var c = 0; c < width; c++) rec[names[c]] = cells[c];
    out.push(rec);
  }
  return out;
}

// Render the records as JSONL text (one JSON object per line, trailing newline if any).
function toJSONL(records) {
  var s = "";
  for (var i = 0; i < records.length; i++) s += JSON.stringify(records[i]) + "\n";
  return s;
}

/* ---- exports (browser + Node) ------------------------------------ */
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.csvSource = { parse: parse, tokenize: tokenize, toJSONL: toJSONL };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { parse: parse, tokenize: tokenize, toJSONL: toJSONL };
}

/* ---- CLI (runs only when invoked directly, never on require) ------ */

function parseArgs(args) {
  var opts = { header: true };
  var file;
  var i = 0;
  while (i < args.length) {
    var a = args[i];
    if (a === "--no-header") { opts.header = false; i += 1; }
    else if (a === "--fill") {
      var v = args[i + 1];
      if (v === undefined) throw new Error("--fill requires a value");
      opts.fill = v; i += 2;
    }
    else if (a === "--delim") {
      var d = args[i + 1];
      if (d === undefined) throw new Error("--delim requires a single character");
      opts.delim = d; i += 2;
    }
    else if (a.charAt(0) === "-" && a !== "-") { throw new Error("unknown option " + a); }
    else {
      if (file !== undefined) throw new Error("only one FILE may be given (got a second: " + JSON.stringify(a) + ")");
      file = a; i += 1;
    }
  }
  return { opts: opts, file: file };
}

function readAll(file) {
  var fs = require("fs");
  if (file === undefined || file === "-") return fs.readFileSync(0, "utf8"); // stdin
  return fs.readFileSync(file, "utf8");
}

function main(argv) {
  var args = argv.slice(2);
  if (args.indexOf("--help") !== -1 || args.indexOf("-h") !== -1) {
    process.stdout.write(
      "csv-source.js — turn CSV text into a JSONL record stream (one object per row).\n\n" +
      "  node csv-source.js people.csv\n" +
      "  cat people.csv | node csv-source.js --no-header\n" +
      "  node csv-source.js data.csv --delim \";\" --fill \"\"\n" +
      "  node csv-source.js --help\n\n" +
      "  FILE          optional .csv path; with none, reads stdin\n" +
      "  --no-header   row 1 is data, not names; keys become c0, c1, c2, ...\n" +
      "  --fill VALUE  pad short rows to the header width with VALUE (else a short row errors)\n" +
      "  --delim CH    field delimiter, one character (default \",\")\n\n" +
      "Emits one JSON object per data row. Values are STRINGS, verbatim.\n\n" +
      "Edge: STRING values only — it never infers types (numbers, booleans, null stay\n" +
      "as text), never trims unquoted whitespace, and fails closed on a ragged row\n" +
      "rather than padding it. A parser you can pin, not a comma-split you babysit.\n"
    );
    return 0;
  }
  var parsed;
  try { parsed = parseArgs(args); }
  catch (e) { process.stderr.write("csv-source: " + e.message + "\n"); return 2; }

  var text;
  try { text = readAll(parsed.file); }
  catch (e) { process.stderr.write("csv-source: cannot read " + (parsed.file === undefined ? "stdin" : JSON.stringify(parsed.file)) + ": " + e.message + "\n"); return 2; }

  var records;
  try { records = parse(text, parsed.opts); }
  catch (e) { process.stderr.write("csv-source: " + e.message + "\n"); return 2; }

  process.stdout.write(toJSONL(records));
  return 0;
}

if (typeof require !== "undefined" && require.main === module) {
  process.exitCode = main(process.argv);
}
