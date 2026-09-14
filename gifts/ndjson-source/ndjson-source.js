#!/usr/bin/env node
/* ndjson-source.js — validate and normalize an NDJSON stream into canonical JSONL.
   Dependency-free, deterministic, pure. Runs in Node or a browser. MIT.

   WHAT IT IS. A SOURCE: it turns NDJSON — newline-delimited JSON, one JSON value per
   line, the shape a log, an export, or a `jq -c` stream so often arrives in — into the
   front of a pipe: one canonical compact JSON value per line (JSONL), ready to feed INTO
   the fold/filter/transform gifts. Give it a file (or pipe text on stdin) and it parses
   each line as its own JSON value and re-emits it canonically:

       {"id":1}                   ->  {"id":1}
       {"id":2}                       {"id":2}

       { "a": 1e3 }               ->  {"a":1000}     (whitespace + number tokens normalized)
       [1, 2, 3]                      [1,2,3]

   WHERE IT SITS NEXT TO json-source (the honest complement). json-source streams a
   TOP-LEVEL JSON ARRAY — one `[ ... ]` document — and REFUSES a non-array top-level,
   because a single value is not a stream. NDJSON is exactly the OTHER shape: a stream is
   already spelled out, one value per line, no enclosing array. ndjson-source is the honest
   reader for that shape. json-source unwraps an array into a stream; ndjson-source
   validates and canonicalizes a stream that is already line-delimited. It reads NDJSON,
   not a JSON array (use json-source) and not JSON5.

   PER-LINE HONESTY (the honesty axis). Each non-blank line MUST be exactly one valid JSON
   value. A line that is malformed JSON — or that carries a second value after the first —
   is a HARD ERROR (exit 2), naming the 1-based line number, never a skipped line and never
   a partial or repaired parse. ndjson-source does not quietly drop the bad record and keep
   going (that silently changes your data); it stops and tells you which line. Blank lines
   (empty or whitespace-only) carry no record and are skipped — that is not a guess, a
   blank line is unambiguously not a value. CRLF and LF line endings are both accepted (a
   trailing carriage return is stripped before parsing).

   CANONICAL RE-SERIALIZATION (declared, so it is pinnable). Each value is emitted via
   canonical compact JSON.stringify — object key order is preserved from the input, but
   input WHITESPACE and NUMBER TOKENS are normalized to canonical JSON form (`1e3` -> 1000,
   `1.0` -> 1, `{ "a" : 1 }` -> {"a":1}). This is the JSON *value*, losslessly; it is not
   the input line's exact bytes. So ndjson-source is a VALIDATOR and NORMALIZER: valid but
   sloppy NDJSON comes out as canonical JSONL, byte-identical every run and every machine.

   THE MODEL
     [FILE]   The NDJSON file to read. If omitted, read stdin. One JSON value per line;
              blank lines are skipped; each non-blank line becomes one output line.

   DETERMINISM. parse(text) is a pure function — no clock, no randomness, no network — so
   the same text yields byte-identical output every run.

   USAGE
     node ndjson-source.js data.ndjson
     cat data.ndjson | node ndjson-source.js
     node ndjson-source.js --help

   Exit codes: 0 success (including an empty stream from empty or all-blank input) · 2 input
   error (a malformed JSON line, an unknown option, a second positional file, or an
   unreadable file). Always a clean one-line message on stderr, never a stack trace.

   Released under MIT. Its edge is printed in the README: ndjson-source reads NDJSON (one
   JSON value per line) — NOT a JSON array (use json-source) and NOT JSON5. Blank lines are
   skipped; a malformed line is refused (exit 2) with its 1-based line number, never skipped
   or repaired. Each value is re-serialized to canonical compact JSON (number tokens and
   whitespace normalized, key order preserved), so it validates and normalizes; it reads the
   whole input, not an incremental stream.
*/
"use strict";

/* ---- the pure core ------------------------------------------------ */

// Parse NDJSON text and return the array of its per-line JSON values. Blank (empty or
// whitespace-only) lines are skipped. A malformed line throws a clean Error naming the
// 1-based line number — the CLI turns that into exit 2. Pure.
function parse(text) {
  if (typeof text !== "string") throw new Error("input must be text");
  var lines = text.split("\n");
  var values = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    // CRLF -> LF: strip a single trailing carriage return left by the split.
    if (line.charAt(line.length - 1) === "\r") line = line.slice(0, -1);
    if (line.trim() === "") continue;      // blank line carries no record — skip, don't guess
    var value;
    try {
      value = JSON.parse(line);
    } catch (e) {
      throw new Error("line " + (i + 1) + " is not valid JSON: " + e.message);
    }
    values.push(value);
  }
  return values;
}

// Render values as JSONL text (one canonical compact JSON value per line, trailing newline
// if any). Same canonical serializer as the source-lane siblings.
function toJSONL(values) {
  var s = "";
  for (var i = 0; i < values.length; i++) s += JSON.stringify(values[i]) + "\n";
  return s;
}

/* ---- exports (browser + Node) ------------------------------------ */
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.ndjsonSource = { parse: parse, toJSONL: toJSONL };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { parse: parse, toJSONL: toJSONL };
}

/* ---- CLI (runs only when invoked directly, never on require) ------ */

function parseArgs(args) {
  var file;
  var i = 0;
  while (i < args.length) {
    var a = args[i];
    if (a.charAt(0) === "-" && a !== "-") {
      throw new Error("unknown option " + a);
    } else {
      if (file !== undefined) throw new Error("only one input file may be given (got a second: " + JSON.stringify(a) + ")");
      file = a;
      i += 1;
    }
  }
  return { file: file };
}

function readAll(stream) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    stream.on("data", function (c) { chunks.push(c); });
    stream.on("end", function () { resolve(Buffer.concat(chunks).toString("utf8")); });
    stream.on("error", reject);
  });
}

function helpText() {
  return (
    "ndjson-source.js — validate and normalize an NDJSON stream into canonical JSONL.\n\n" +
    "  node ndjson-source.js data.ndjson\n" +
    "  cat data.ndjson | node ndjson-source.js\n" +
    "  node ndjson-source.js --help\n\n" +
    "  [FILE]   NDJSON file to read (default: read stdin). One JSON value per line.\n\n" +
    "Emits one canonical compact JSON line per non-blank input line.\n\n" +
    "Edge: reads NDJSON (one JSON value per line) — NOT a JSON array (use json-source) and\n" +
    "NOT JSON5. Blank lines are skipped; a malformed line is refused (exit 2) with its\n" +
    "1-based line number, never skipped or repaired. Each value is re-serialized to canonical\n" +
    "compact JSON (number tokens and whitespace normalized, key order preserved). Reads the\n" +
    "whole input, not an incremental stream.\n"
  );
}

function main(argv) {
  var args = argv.slice(2);
  if (args.indexOf("--help") !== -1 || args.indexOf("-h") !== -1) {
    process.stdout.write(helpText());
    return Promise.resolve(0);
  }
  var parsed;
  try { parsed = parseArgs(args); }
  catch (e) { process.stderr.write("ndjson-source: " + e.message + "\n"); return Promise.resolve(2); }

  var getText;
  if (parsed.file !== undefined) {
    getText = new Promise(function (resolve, reject) {
      require("fs").readFile(parsed.file, "utf8", function (err, data) {
        if (err) reject(new Error("cannot read " + JSON.stringify(parsed.file) + ": " + err.code));
        else resolve(data);
      });
    });
  } else {
    getText = readAll(process.stdin);
  }

  return getText.then(function (text) {
    var values = parse(text);   // throws -> caught below
    process.stdout.write(toJSONL(values));
    return 0;
  }).catch(function (e) {
    process.stderr.write("ndjson-source: " + e.message + "\n");
    return 2;
  });
}

if (typeof require !== "undefined" && require.main === module) {
  main(process.argv).then(function (code) { process.exitCode = code; });
}
