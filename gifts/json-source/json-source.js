#!/usr/bin/env node
/* json-source.js — stream the elements of a JSON array as a JSONL record stream.
   Dependency-free, deterministic, pure. Runs in Node or a browser. MIT.

   WHAT IT IS. A SOURCE: it turns a JSON array — the shape an API response, an export,
   or a `[ ... ]` file so often arrives in — into the front of a pipe: one element per
   line (JSONL), ready to feed INTO the fold/filter/transform gifts. Give it a file (or
   pipe text on stdin) and it emits each top-level array element as one compact JSON line:

       [{"id":1},{"id":2}]        ->  {"id":1}
                                      {"id":2}
       [1, 2, 3]                  ->  1
                                      2
                                      3

   When the elements are objects, they are records the consuming gifts read directly:
   `json-source users.json | dedup-filter --key id`. When they are scalars, you get a
   stream of scalars — still valid JSONL.

   TOP-LEVEL ARRAY ONLY (the honesty axis). The input's top-level value MUST be a JSON
   array — that is the only thing that IS a stream. A bare object, a number, a string, a
   boolean, or null is a single value, not a stream, so json-source REFUSES it (exit 2)
   rather than guess how to "streamify" it (wrap it? emit its entries? emit it as one
   line?). Each guess is a different tool; refusing keeps json-source one honest thing.
   Malformed JSON is likewise a hard error (exit 2), never a partial or repaired parse.

   CANONICAL RE-SERIALIZATION (declared, so it is pinnable). Each element is emitted via
   canonical compact JSON.stringify — object key order is preserved from the input, but
   input WHITESPACE and NUMBER TOKENS are normalized to canonical JSON form (`1e3` -> 1000,
   `1.0` -> 1, `[ 1 ,2 ]` -> [1,2]). This is the JSON *value*, losslessly; it is not the
   input's exact bytes. The result is deterministic: the same input yields byte-identical
   output every run and every machine.

   THE MODEL
     [FILE]   The JSON file to stream. If omitted, read stdin. Its top-level value must
              be an array; each element becomes one output line.

   DETERMINISM. parse(text) is a pure function — no clock, no randomness, no network — so
   the same text yields byte-identical output every run.

   USAGE
     node json-source.js data.json
     cat data.json | node json-source.js
     node json-source.js --help

   Exit codes: 0 success (including an empty stream from `[]`) · 2 input error (malformed
   JSON, a top-level value that is not an array, an unknown option, a second positional
   file, or an unreadable file). Always a clean one-line message on stderr, never a stack
   trace.

   Released under MIT. Its edge is printed in the README: json-source streams the elements
   of a TOP-LEVEL JSON ARRAY only — it refuses a non-array top-level and malformed JSON
   (exit 2), and it re-serializes each element to canonical compact JSON (normalizing
   number tokens and whitespace, preserving key order). It reads JSON, not JSON5/NDJSON,
   and does not stream incrementally (it parses the whole document).
*/
"use strict";

/* ---- the pure core ------------------------------------------------ */

// Parse JSON text and return its top-level array of elements. Throws a clean Error on
// malformed JSON or a non-array top-level — the CLI turns that into exit 2. Pure.
function parse(text) {
  if (typeof text !== "string") throw new Error("input must be text");
  var value;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw new Error("input is not valid JSON: " + e.message);
  }
  if (!Array.isArray(value)) {
    var kind = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    throw new Error("top-level JSON must be an array (got " + kind + ") — a non-array value is not a stream");
  }
  return value;
}

// Render elements as JSONL text (one canonical compact JSON value per line, trailing
// newline if any).
function toJSONL(elements) {
  var s = "";
  for (var i = 0; i < elements.length; i++) s += JSON.stringify(elements[i]) + "\n";
  return s;
}

/* ---- exports (browser + Node) ------------------------------------ */
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.jsonSource = { parse: parse, toJSONL: toJSONL };
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
    "json-source.js — stream the elements of a JSON array as a JSONL record stream.\n\n" +
    "  node json-source.js data.json\n" +
    "  cat data.json | node json-source.js\n" +
    "  node json-source.js --help\n\n" +
    "  [FILE]   JSON file to stream (default: read stdin). Top-level must be an array.\n\n" +
    "Emits one canonical compact JSON line per top-level array element.\n\n" +
    "Edge: streams a TOP-LEVEL JSON ARRAY only — a non-array top-level or malformed JSON\n" +
    "is refused (exit 2). Each element is re-serialized to canonical compact JSON (number\n" +
    "tokens and whitespace normalized, key order preserved). Reads JSON, not JSON5/NDJSON,\n" +
    "and parses the whole document (not an incremental stream).\n"
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
  catch (e) { process.stderr.write("json-source: " + e.message + "\n"); return Promise.resolve(2); }

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
    var elements = parse(text);   // throws -> caught below
    process.stdout.write(toJSONL(elements));
    return 0;
  }).catch(function (e) {
    process.stderr.write("json-source: " + e.message + "\n");
    return 2;
  });
}

if (typeof require !== "undefined" && require.main === module) {
  main(process.argv).then(function (code) { process.exitCode = code; });
}
