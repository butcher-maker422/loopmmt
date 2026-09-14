#!/usr/bin/env node
/* range-filter.js — pass only the JSONL records whose fields fall inside declared windows.
   Dependency-free, deterministic, one pass, order-stable. Runs in Node or a browser. MIT.

   WHAT IT IS. Give it a stream of records — one JSON object per line (JSONL) — and a
   set of WINDOWS you declare on named fields, and it emits, verbatim and in input
   order, exactly the records that fall inside EVERY declared window. Everything else
   is dropped. It is a SUBSET filter: the output is a subset of the input, byte-for-byte
   per surviving record, so `range-filter` in a pipe never invents or reshapes a record —
   it only decides which ones pass.

   A WINDOW is a numeric or ISO-date range on one field:

       --num  FIELD MIN MAX     keep records whose FIELD is a finite number in [MIN, MAX]
       --date FIELD MIN MAX     keep records whose FIELD is an ISO-8601 date in [MIN, MAX]

   Both bounds are INCLUSIVE, both edges are required, and either edge may be given as
   a bare `.` to mean "unbounded on this side":

       --num age 18 .           age >= 18            (no upper bound)
       --num score . 100        score <= 100         (no lower bound)
       --date ts 2026-01-01 2026-12-31   ts within the year 2026, inclusive

   Declare more than one window and they AND together: a record survives only if it is
   inside all of them. Declare none and every well-formed record passes (the identity
   filter) — a deliberate, documented default, not an error.

   THE MISSING-FIELD POLICY (the whole honesty story). A window tests a field. What if
   the record does not HAVE that field? The default is DROP: a record missing a windowed
   field cannot be shown to be inside the window, so it does not pass. This is fail-closed
   — a window is a claim the record must satisfy, and absence is not satisfaction. Pass
   `--keep-missing` to invert it (a missing windowed field is treated as passing THAT
   window), for the "filter the records that have a date, leave the rest alone" shape.
   The policy is one global flag, stated once, so a stream is filtered under one rule.

   DETERMINISM. Records are tested and emitted in input order; a surviving record is
   written back byte-for-byte as it arrived (the original line, trailing \r trimmed), so
   the same stream and the same windows yield byte-identical output on every machine and
   every run. Numeric comparison is IEEE-754 double `<=`; date comparison is on the
   calendar instant parsed from an ISO-8601 string (see below), never on the raw text.

   NUMERIC / DATE HONESTY. A filter is only trustworthy if it refuses to guess:
     - Every non-blank line must be a JSON OBJECT. A line that is not valid JSON, or is
       valid JSON but not an object (a number, string, array, null), is a HARD ERROR
       (exit 2) naming the line — never a silent skip.
     - A `--num` window requires the field's value to BE a finite number to be tested.
       A non-number value in a numbered field is OUT OF the window (it fails the test),
       never coerced (the string "18" is not the number 18 here).
     - A `--date` window parses BOTH the record's value and the two bounds as ISO-8601
       via Date; an unparseable record value fails the window (it is not in range), and
       an unparseable BOUND is a hard configuration error (exit 2) at startup, before any
       record is read.
     - MIN must be <= MAX for every window, or it is a hard error (exit 2). An impossible
       window is a bug in the caller's declaration, surfaced loudly, not an empty result
       that hides the mistake.

   USAGE
     cat people.jsonl | node range-filter.js --num age 18 65
     node range-filter.js --num score 0 100 --date ts 2026-01-01 2026-12-31 in.jsonl
     node range-filter.js --num age 18 . --keep-missing < people.jsonl
     node range-filter.js --help

   Each non-blank line is one JSON object. Blank lines are skipped. A trailing \r
   (CRLF files) is trimmed. Surviving records are emitted one per line, verbatim.

   Exit codes: 0 success (with or without survivors) · 2 input error (missing file, a
   directory, a malformed window declaration, an unparseable bound, MIN>MAX, or a line
   that is not a JSON object). Always a clean one-line message on stderr, never a stack
   trace.

   Released under MIT. Its edge is printed in the README: this is a SUBSET filter over
   DECLARED windows. It filters on the fields and ranges YOU name — it does not infer a
   schema, does not reshape or reformat surviving records, does not sort, and does not
   de-duplicate. A record inside every window passes even if its content is wrong: the
   window tests a value's RANGE, never its truth.
*/
"use strict";

/* ---- the pure core ------------------------------------------------ */

// A parsed window: { field, kind: "num"|"date", min, max } where min/max are
// numbers (num) or epoch-ms integers (date), or null for an unbounded side.
// keepMissing: does a record LACKING the field pass this window?

// Parse an ISO-8601 string to an epoch-ms integer, or null if unparseable.
function parseDate(v) {
  if (typeof v !== "string" || v.length === 0) return null;
  var t = Date.parse(v);
  return isFinite(t) ? t : null;
}

// Does one record satisfy one window? Returns true/false.
function inWindow(rec, w, keepMissing) {
  var has = Object.prototype.hasOwnProperty.call(rec, w.field);
  if (!has) return keepMissing; // missing-field policy
  var raw = rec[w.field];
  var val;
  if (w.kind === "num") {
    if (typeof raw !== "number" || !isFinite(raw)) return false; // non-number is out, never coerced
    val = raw;
  } else { // date
    val = parseDate(raw);
    if (val === null) return false; // unparseable record value is out
  }
  if (w.min !== null && val < w.min) return false;
  if (w.max !== null && val > w.max) return false;
  return true;
}

// The public filter: JSONL text + parsed windows + options -> the surviving
// records, in input order, each as { line, record }.
//   windows: [ {field, kind, min, max}, ... ]   (min/max already normalized)
//   opts: { keepMissing: bool }
// Throws a clean, line-named Error on a line that is not a JSON object.
function filter(text, windows, opts) {
  opts = opts || {};
  var keepMissing = !!opts.keepMissing;
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
    for (var k = 0; k < windows.length; k++) {
      if (!inWindow(rec, windows[k], keepMissing)) { pass = false; break; }
    }
    if (pass) out.push({ line: line, record: rec });
  }
  return out;
}

/* ---- exports (browser + Node) ------------------------------------ */
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.rangeFilter = filter;
  window.ForestGifts.rangeFilterInWindow = inWindow;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { filter: filter, inWindow: inWindow, parseDate: parseDate };
}

/* ---- CLI (runs only when invoked directly, never on require) ------ */

// Normalize one raw bound token for a window kind. "." -> null (unbounded).
// num: must be a finite number. date: must parse to an instant. Throws on bad.
function normBound(kind, field, side, raw) {
  if (raw === ".") return null;
  if (kind === "num") {
    var n = Number(raw);
    if (raw === undefined || raw === "" || !isFinite(n)) {
      throw new Error("--num " + field + ": " + side + " bound must be a finite number or '.' (got " +
        JSON.stringify(raw) + ")");
    }
    return n;
  }
  // date
  var t = parseDate(raw);
  if (t === null) {
    throw new Error("--date " + field + ": " + side + " bound must be an ISO-8601 date or '.' (got " +
      JSON.stringify(raw) + ")");
  }
  return t;
}

// Parse argv into { windows, opts, files }. Throws a clean Error on a bad declaration.
function parseArgs(args) {
  var windows = [];
  var opts = { keepMissing: false };
  var files = [];
  var i = 0;
  while (i < args.length) {
    var a = args[i];
    if (a === "--num" || a === "--date") {
      var kind = a === "--num" ? "num" : "date";
      var field = args[i + 1], rawMin = args[i + 2], rawMax = args[i + 3];
      if (field === undefined || rawMin === undefined || rawMax === undefined ||
          field.charAt(0) === "-") {
        throw new Error(a + " requires FIELD MIN MAX (use '.' for an unbounded side)");
      }
      var min = normBound(kind, field, "lower", rawMin);
      var max = normBound(kind, field, "upper", rawMax);
      if (min !== null && max !== null && min > max) {
        throw new Error(a + " " + field + ": lower bound is greater than upper bound (impossible window)");
      }
      windows.push({ field: field, kind: kind, min: min, max: max });
      i += 4;
    } else if (a === "--keep-missing") {
      opts.keepMissing = true; i += 1;
    } else if (a.charAt(0) === "-") {
      throw new Error("unknown option " + a);
    } else {
      files.push(a); i += 1;
    }
  }
  return { windows: windows, opts: opts, files: files };
}

function run(text, windows, opts) {
  var survivors = filter(text, windows, opts);
  var s = "";
  for (var i = 0; i < survivors.length; i++) s += survivors[i].line + "\n";
  return s;
}

function main(argv) {
  var args = argv.slice(2);
  if (args.indexOf("--help") !== -1 || args.indexOf("-h") !== -1) {
    process.stdout.write(
      "range-filter.js — pass only the JSONL records whose fields fall inside declared windows.\n\n" +
      "  cat people.jsonl | node range-filter.js --num age 18 65\n" +
      "  node range-filter.js --num score 0 100 --date ts 2026-01-01 2026-12-31 in.jsonl\n" +
      "  node range-filter.js --num age 18 . --keep-missing < people.jsonl\n" +
      "  node range-filter.js --help\n\n" +
      "  --num  FIELD MIN MAX   keep records whose FIELD is a finite number in [MIN, MAX]\n" +
      "  --date FIELD MIN MAX   keep records whose FIELD is an ISO-8601 date in [MIN, MAX]\n" +
      "  --keep-missing         a record LACKING a windowed field passes that window\n\n" +
      "Bounds are INCLUSIVE; either bound may be '.' for unbounded on that side.\n" +
      "Multiple windows AND together. No windows = every well-formed record passes.\n" +
      "Surviving records are emitted VERBATIM, in input order.\n\n" +
      "Edge: this is a SUBSET filter over DECLARED windows. It does not infer a schema,\n" +
      "reshape records, sort, or de-duplicate. The default missing-field policy is DROP\n" +
      "(fail-closed); --keep-missing inverts it. A non-object line is a hard error.\n"
    );
    return 0;
  }

  var parsed;
  try { parsed = parseArgs(args); }
  catch (e) { process.stderr.write("range-filter: " + e.message + "\n"); return 2; }

  function emit(text) {
    try { process.stdout.write(run(text, parsed.windows, parsed.opts)); return 0; }
    catch (e) { process.stderr.write("range-filter: " + e.message + "\n"); return 2; }
  }

  if (parsed.files.length > 0) {
    var fs = require("fs");
    var text;
    try { text = fs.readFileSync(parsed.files[0], "utf8"); }
    catch (e) {
      process.stderr.write("range-filter: cannot read " + parsed.files[0] +
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
