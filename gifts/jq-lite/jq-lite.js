#!/usr/bin/env node
/* jq-lite.js — a tiny jq-style query language for JSON, in one dependency-free file.
   Deterministic, pure, MIT. Runs in Node or a browser.

   WHAT IT IS. A TRANSFORM: it takes JSON in and emits JSON out, reshaped by a filter
   expression you write in a small, well-defined query language. It is the "reach for jq"
   move without installing jq — the mini-language that lets you pull `.user.name` out of a
   blob, iterate `.items[]`, index `.[0]`, and pipe one step into the next, over a single
   JSON value or a JSONL stream of them:

     echo '{"user":{"name":"ada"}}' | node jq-lite.js '.user.name'   ->  "ada"
     printf '{"a":1}\n{"a":2}\n' | node jq-lite.js '.a'             ->  1 \n 2

   It is the adapter between "a JSON blob" and "the one field/element you actually want",
   at the front or middle of a pipe: `line-source access.log | ... | jq-lite '.status'`.

   THE QUIET FAILURES IT FIXES. Everyone reaches for `obj.a.b.c` and everyone gets it
   subtly wrong, in ways that only bite on the input you didn't test:

     1. THE MISSING-KEY CRASH. `obj.a.b` throws the moment `obj.a` is absent
        (`Cannot read properties of undefined`). jq-lite follows jq's rule: a missing
        object key yields `null`, not an exception — `.a.b.c` on `{}` is `null`, quietly
        and correctly. You opt INTO strictness, you are never ambushed by it.

     2. THE TYPE-CONFUSION. Indexing a string or a number as if it were an object/array
        (`.foo` on `"hi"`, `.[0]` on `42`) is a real error you WANT surfaced — but only
        when you meant it. jq-lite errors loudly on a genuine type mismatch, and gives you
        the `?` operator (`.foo?`, `.[0]?`) to say "skip it if it doesn't fit" — so one
        ragged record in a stream doesn't abort the whole run.

     3. THE STREAM FAN-OUT. `.[]` turns one input into MANY outputs (each array element
        or object value), and a pipe must thread that correctly: `.items[] | .id` runs
        `.id` over EACH item, not over the array. Hand-rolled `.map(x => x.id)` forgets
        the empty-array case, the object case, and the compose-with-a-later-`[]` case.
        jq-lite treats every filter as value -> stream and composes streams properly.

   THE LANGUAGE (this is the whole of it — the "lite" is the point):

     .                 identity — the input value, unchanged
     .foo  .foo.bar    field access (missing key -> null; non-object -> error unless ?)
     .["a b"]          bracketed string key (for keys that aren't bare identifiers)
     .[2]  .foo[0]     array index (negative counts from the end: .[-1] is the last)
     .[]               iterate — emit each array element, or each object VALUE, as a stream
     a | b             pipe — run b over every output of a
     .foo?  .[0]?  .[]?  optional — on a type mismatch, emit nothing instead of erroring

   Values are standard JSON. Output is one JSON value per result; with --jsonl-out (the
   default for stream input) each result is a line. A filter is applied to EACH input
   value independently; a JSONL input runs the filter per line.

     --raw-output    if a result is a JSON string, print it without quotes (jq -r)
     --slurp         read the whole input as ONE JSON value (an array of the inputs) before
                     filtering, instead of per-value (jq -s)
     --compact       (default) one-line JSON per result

   DETERMINISM. run(value, filter) is a pure function — no clock, no randomness, no I/O
   beyond the value you pass, no ambient state. The same value and filter yield
   byte-identical output on every run and every machine. Object VALUE iteration (`.[]`)
   emits values in the object's own key insertion order (JSON parse order), which is
   stable for a given input.

   USAGE
     echo '{"a":{"b":2}}' | node jq-lite.js '.a.b'
     echo '[1,2,3]'       | node jq-lite.js '.[]'
     echo '{"xs":[10,20]}'| node jq-lite.js '.xs[] '
     printf '{"n":1}\n{"n":2}\n' | node jq-lite.js '.n'
     echo '{"name":"ada"}' | node jq-lite.js --raw-output '.name'
     node jq-lite.js --help

   Exit codes: 0 success · 2 usage error (no filter, bad option, malformed filter syntax,
   or invalid JSON input) · 3 a runtime type error the filter did not mark optional. A
   clean one-line message on stderr, never a stack trace.

   Released under MIT. Its edge is printed in the README: jq-lite implements a SMALL
   subset of jq — identity, field/index/bracket access, `.[]` iteration, the pipe, and the
   `?` optional. It has NO functions, NO arithmetic, NO object/array construction, NO
   select/map/comparison, NO recursion (`..`). For those, use jq itself. It is a reach
   tool for the common "pull this out / walk this stream" case, not a jq replacement.
*/
"use strict";

/* ==================================================================
   THE PARSER — filter string -> a list of STEP objects.
   Each step is one of:
     { op: "identity" }
     { op: "field",  key: <string>, optional: <bool> }
     { op: "index",  idx: <int>,    optional: <bool> }
     { op: "iterate",              optional: <bool> }
   A PIPE ( a | b ) concatenates the two step lists — piping is just
   sequential application, so the compiled program is one flat list of
   steps run left to right, each step mapping a stream to a stream.
   ================================================================== */

// Parse one pipeline segment (no top-level '|') into steps, starting at position `pos`
// in `src`. Returns { steps, pos }. Throws a clean Error on malformed syntax.
function parseSegment(src, pos) {
  var steps = [];
  var n = src.length;

  function skipWs() { while (pos < n && isWs(src.charCodeAt(pos))) pos++; }
  function isWs(c) { return c === 32 || (c >= 9 && c <= 13); }
  function isIdentStart(c) {
    return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95; // A-Z a-z _
  }
  function isIdentPart(c) {
    return isIdentStart(c) || (c >= 48 && c <= 57); // + 0-9
  }

  skipWs();
  if (pos >= n) throw new Error("empty filter segment");

  // A segment must begin with '.'
  if (src.charAt(pos) !== ".") {
    throw new Error("filter must begin with '.' at position " + pos);
  }
  pos++; // consume the leading '.'

  // A bare '.' (identity) is legal if nothing accessor-like follows.
  // Otherwise a chain of .field / [..] / [] accessors follows, each optionally '?'.
  var sawAccessor = false;

  // Handle an immediate identifier right after the leading dot: .foo
  function tryField() {
    var c = src.charCodeAt(pos);
    if (pos < n && isIdentStart(c)) {
      var start = pos;
      while (pos < n && isIdentPart(src.charCodeAt(pos))) pos++;
      var key = src.slice(start, pos);
      var optional = consumeOptional();
      steps.push({ op: "field", key: key, optional: optional });
      sawAccessor = true;
      return true;
    }
    return false;
  }

  function consumeOptional() {
    if (pos < n && src.charAt(pos) === "?") { pos++; return true; }
    return false;
  }

  // .["key"]  or  .[2]  or  .[]  — the leading '.' is already consumed for the FIRST
  // accessor; subsequent bracket accessors do not need a dot.
  function tryBracket() {
    if (pos >= n || src.charAt(pos) !== "[") return false;
    pos++; // '['
    skipWs();
    if (pos < n && src.charAt(pos) === "]") {
      pos++; // ']'
      var opt0 = consumeOptional();
      steps.push({ op: "iterate", optional: opt0 });
      sawAccessor = true;
      return true;
    }
    var c = src.charAt(pos);
    if (c === '"') {
      var str = parseJSONString();
      skipWs();
      expect("]");
      var opt1 = consumeOptional();
      steps.push({ op: "field", key: str, optional: opt1 });
      sawAccessor = true;
      return true;
    }
    // numeric index (optionally negative)
    if (c === "-" || (src.charCodeAt(pos) >= 48 && src.charCodeAt(pos) <= 57)) {
      var start = pos;
      if (src.charAt(pos) === "-") pos++;
      var digits = 0;
      while (pos < n && src.charCodeAt(pos) >= 48 && src.charCodeAt(pos) <= 57) { pos++; digits++; }
      if (digits === 0) throw new Error("expected an array index inside [ ]");
      var idx = parseInt(src.slice(start, pos), 10);
      skipWs();
      expect("]");
      var opt2 = consumeOptional();
      steps.push({ op: "index", idx: idx, optional: opt2 });
      sawAccessor = true;
      return true;
    }
    throw new Error("unexpected character inside [ ]: " + JSON.stringify(c));
  }

  function expect(ch) {
    if (pos >= n || src.charAt(pos) !== ch) {
      throw new Error("expected '" + ch + "' at position " + pos);
    }
    pos++;
  }

  // Minimal JSON string parser for bracket keys: assumes src.charAt(pos) === '"'.
  function parseJSONString() {
    var start = pos;
    pos++; // opening quote
    var out = "";
    while (pos < n) {
      var ch = src.charAt(pos);
      if (ch === '"') { pos++; return out; }
      if (ch === "\\") {
        pos++;
        if (pos >= n) break;
        var e = src.charAt(pos);
        if (e === "n") out += "\n";
        else if (e === "t") out += "\t";
        else if (e === "r") out += "\r";
        else if (e === '"') out += '"';
        else if (e === "\\") out += "\\";
        else if (e === "/") out += "/";
        else if (e === "u") {
          var hex = src.slice(pos + 1, pos + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error("bad \\u escape in filter string");
          out += String.fromCharCode(parseInt(hex, 16));
          pos += 4;
        } else {
          throw new Error("bad escape \\" + e + " in filter string");
        }
        pos++;
      } else {
        out += ch;
        pos++;
      }
    }
    throw new Error("unterminated string starting at position " + start);
  }

  // First accessor after the leading '.': either a field, a bracket, or nothing (identity).
  if (!tryField()) { tryBracket(); }
  // Subsequent accessors: .field  or  [..]
  for (;;) {
    skipWs();
    if (pos < n && src.charAt(pos) === ".") {
      // a following .field  (dotted). The dot must be followed by an identifier or bracket.
      pos++;
      if (!tryField()) {
        if (!tryBracket()) throw new Error("expected a field name or [ after '.' at position " + pos);
      }
      continue;
    }
    if (pos < n && src.charAt(pos) === "[") { tryBracket(); continue; }
    break;
  }

  if (steps.length === 0) {
    // just '.' — identity
    steps.push({ op: "identity" });
  }
  return { steps: steps, pos: pos };
}

// Parse a full filter (with top-level pipes) into a flat step list.
// Pure: depends only on `src`. Throws a clean Error on malformed input.
function parse(src) {
  if (typeof src !== "string") throw new Error("filter must be a string");
  var n = src.length;
  var pos = 0;
  var all = [];

  function skipWs() { while (pos < n && (src.charCodeAt(pos) === 32 || (src.charCodeAt(pos) >= 9 && src.charCodeAt(pos) <= 13))) pos++; }

  skipWs();
  if (pos >= n) throw new Error("empty filter");
  for (;;) {
    var seg = parseSegment(src, pos);
    pos = seg.pos;
    for (var i = 0; i < seg.steps.length; i++) all.push(seg.steps[i]);
    skipWs();
    if (pos >= n) break;
    if (src.charAt(pos) === "|") { pos++; skipWs(); continue; }
    throw new Error("unexpected character " + JSON.stringify(src.charAt(pos)) + " at position " + pos + " (expected '|' or end of filter)");
  }
  return all;
}

/* ==================================================================
   THE EVALUATOR — apply a compiled step list to a value.
   Each step maps a value to a STREAM (array) of values; the program
   threads the stream through the steps left to right. This is what
   makes `.[]` fan-out and the pipe compose correctly.
   ================================================================== */

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Apply ONE step to ONE value, returning an array of result values.
// Throws a TypeError-tagged Error on a genuine, non-optional type mismatch.
function applyStep(step, value) {
  switch (step.op) {
    case "identity":
      return [value];

    case "field": {
      if (value === null || value === undefined) return [null]; // missing -> null (jq)
      if (isPlainObject(value)) {
        return [Object.prototype.hasOwnProperty.call(value, step.key) ? value[step.key] : null];
      }
      if (step.optional) return [];
      throw typeErr("cannot index " + typeName(value) + ' with "' + step.key + '"');
    }

    case "index": {
      if (value === null || value === undefined) return [null];
      if (Array.isArray(value)) {
        var i = step.idx < 0 ? value.length + step.idx : step.idx;
        return [(i >= 0 && i < value.length) ? value[i] : null];
      }
      if (step.optional) return [];
      throw typeErr("cannot index " + typeName(value) + " with number " + step.idx);
    }

    case "iterate": {
      if (Array.isArray(value)) return value.slice();
      if (isPlainObject(value)) {
        var out = [];
        for (var k in value) if (Object.prototype.hasOwnProperty.call(value, k)) out.push(value[k]);
        return out;
      }
      if (step.optional) return [];
      throw typeErr("cannot iterate over " + typeName(value));
    }

    default:
      throw new Error("internal: unknown step op " + step.op);
  }
}

function typeName(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "object") return "object";
  return typeof v; // string | number | boolean
}

function typeErr(msg) {
  var e = new Error(msg);
  e.jqType = true; // tag for exit-code 3 routing
  return e;
}

// Run a compiled program (step list) over one input value -> array of results.
// Pure: depends only on `steps` and `value`.
function evalSteps(steps, value) {
  var stream = [value];
  for (var s = 0; s < steps.length; s++) {
    var next = [];
    for (var i = 0; i < stream.length; i++) {
      var results = applyStep(steps[s], stream[i]);
      for (var j = 0; j < results.length; j++) next.push(results[j]);
    }
    stream = next;
  }
  return stream;
}

// Parse `filter` and run it over `value` -> array of result values.
// The one-call entry point. Throws a clean Error on parse or type failure.
function run(value, filter) {
  var steps = parse(filter);
  return evalSteps(steps, value);
}

/* ==================================================================
   JSON I/O helpers (pure)
   ================================================================== */

// Parse a JSONL / concatenated-JSON text into an array of values.
// A blank line yields no value. Throws on malformed JSON.
function parseInputs(text) {
  if (typeof text !== "string") text = String(text == null ? "" : text);
  var out = [];
  var lines = text.split(/\r\n|\n|\r/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.replace(/[\s]/g, "").length === 0) continue; // skip blank/whitespace-only
    out.push(JSON.parse(line));
  }
  return out;
}

// Render one result value as output text.
function renderValue(v, rawOutput) {
  if (rawOutput && typeof v === "string") return v;
  return JSON.stringify(v);
}

/* ==================================================================
   EXPORTS (browser + Node)
   ================================================================== */
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.jqLite = { run: run, parse: parse, evalSteps: evalSteps, parseInputs: parseInputs };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { run: run, parse: parse, evalSteps: evalSteps, parseInputs: parseInputs, renderValue: renderValue };
}

/* ==================================================================
   CLI (runs only when invoked directly, never on require)
   ================================================================== */

function parseArgs(args) {
  var opts = { rawOutput: false, slurp: false };
  var filter = null;
  var i = 0;
  while (i < args.length) {
    var a = args[i];
    if (a === "--raw-output" || a === "-r") { opts.rawOutput = true; i++; }
    else if (a === "--slurp" || a === "-s") { opts.slurp = true; i++; }
    else if (a === "--compact" || a === "-c") { i++; } // default; accepted for familiarity
    else if (a.charAt(0) === "-" && a !== "-") { throw new Error("unknown option " + a); }
    else {
      if (filter !== null) throw new Error("unexpected extra argument " + JSON.stringify(a) + " (only one filter is allowed)");
      filter = a;
      i++;
    }
  }
  if (filter === null) throw new Error("no filter given (usage: jq-lite '<filter>')");
  opts.filter = filter;
  return opts;
}

function readStdin() {
  try {
    var fs = require("fs");
    return fs.readFileSync(0, "utf8");
  } catch (e) {
    return "";
  }
}

var HELP =
  "jq-lite.js — a tiny jq-style query language for JSON, in one dependency-free file.\n\n" +
  "  echo '{\"a\":{\"b\":2}}' | node jq-lite.js '.a.b'\n" +
  "  echo '[1,2,3]'       | node jq-lite.js '.[]'\n" +
  "  printf '{\"n\":1}\\n{\"n\":2}\\n' | node jq-lite.js '.n'\n" +
  "  echo '{\"name\":\"ada\"}' | node jq-lite.js --raw-output '.name'\n" +
  "  node jq-lite.js --help\n\n" +
  "The language:\n" +
  "  .              identity\n" +
  "  .foo .foo.bar  field access (missing key -> null; non-object -> error unless ?)\n" +
  "  .[\"a b\"]       bracketed string key\n" +
  "  .[2] .foo[0]   array index (negative counts from the end: .[-1] is last)\n" +
  "  .[]            iterate: emit each array element, or each object value, as a stream\n" +
  "  a | b          pipe: run b over every output of a\n" +
  "  .foo? .[]?     optional: emit nothing on a type mismatch instead of erroring\n\n" +
  "  --raw-output   print string results without quotes (jq -r)\n" +
  "  --slurp        read the whole input as one JSON array before filtering (jq -s)\n\n" +
  "Reads JSON (one value or a JSONL stream) from stdin; applies the filter to each value\n" +
  "and prints one JSON result per output.\n\n" +
  "Edge: jq-lite is a SMALL subset of jq — no functions, no arithmetic, no construction,\n" +
  "no select/map/comparison, no recursion (..). For those, use jq itself.\n";

function main(argv) {
  var args = argv.slice(2);
  if (args.indexOf("--help") !== -1 || args.indexOf("-h") !== -1) {
    process.stdout.write(HELP);
    return 0;
  }
  var opts;
  try { opts = parseArgs(args); }
  catch (e) { process.stderr.write("jq-lite: " + e.message + "\n"); return 2; }

  // Pre-parse the filter so a syntax error is a usage error (exit 2), before reading input.
  var steps;
  try { steps = parse(opts.filter); }
  catch (e) { process.stderr.write("jq-lite: " + e.message + "\n"); return 2; }

  var text = readStdin();
  var inputs;
  try { inputs = parseInputs(text); }
  catch (e) { process.stderr.write("jq-lite: invalid JSON input: " + e.message + "\n"); return 2; }

  if (opts.slurp) inputs = [inputs];

  var out = "";
  for (var i = 0; i < inputs.length; i++) {
    var results;
    try { results = evalSteps(steps, inputs[i]); }
    catch (e) {
      if (e && e.jqType) { process.stderr.write("jq-lite: " + e.message + "\n"); return 3; }
      process.stderr.write("jq-lite: " + e.message + "\n"); return 3;
    }
    for (var j = 0; j < results.length; j++) {
      out += renderValue(results[j], opts.rawOutput) + "\n";
    }
  }
  process.stdout.write(out);
  return 0;
}

if (typeof require !== "undefined" && require.main === module) {
  process.exitCode = main(process.argv);
}
