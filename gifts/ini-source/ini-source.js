#!/usr/bin/env node
/* ini-source.js — parse INI / .gitconfig-style sectioned config text into a uniform
   JSONL record stream. Dependency-free, deterministic, pure. Runs in Node or a browser. MIT.

   WHAT IT IS. A SOURCE: it turns non-JSONL sectioned config text (an .ini, a
   .gitconfig-style file, an editorconfig-shaped file) into the front of a pipe — one JSON
   object per line (JSONL) that the fold/filter/transform gifts consume. Give it a file (or
   pipe text on stdin) and it emits one uniform record per assignment, tagged with the
   section it lives under:

       [server]              ->  (sets the current section)
       host = localhost      ->  {"section":"server","key":"host","value":"localhost"}
       port = 8080           ->  {"section":"server","key":"port","value":"8080"}
       ; a comment           ->  (skipped)
       [client]
       host = 10.0.0.1       ->  {"section":"client","key":"host","value":"10.0.0.1"}

   Every record has the same three string fields, so it drops straight into a generic
   filter or fold:  ini-source app.ini | range-filter ...  /  ini-source app.ini | pluck ...

   THE SHAPE (the design decision that makes it compose). One record per key-assignment,
   the FLAT uniform triple {section, key, value} — NOT one nested record per section. A
   nested {section, entries:{...}} record would carry the section's structure but would not
   compose with the flat fold/filter/transform gifts (they cannot reach into a per-record
   sub-object with a generic --field). The flat triple lets a downstream gift filter by
   section, pluck the key/value, or fold across sections without knowing the file's shape.
   Keys that appear BEFORE any [section] header (a global preamble, as in .gitconfig) are
   emitted with section "" — the honest "no section" marker, never an invented default name.

   STRINGS ONLY (inherited honesty axis). Values are emitted as LITERAL STRINGS —
   ini-source does not guess types. "8080" stays the string "8080"; "true" stays "true".
   The moment a parser coerces (is 08 octal? is 1e3 a number? is TRUE a boolean?) the SAME
   file parses to different bytes under different tools, and a source you cannot pin is not
   a source. For the same reason it does NOT interpolate ${VAR}/%VAR%, does NOT honor inline
   (trailing) comments, and does NOT process backslash escapes inside a quoted value — each
   is a context-dependent guess that would break byte determinism. It parses the grammar it
   was given and REFUSES the rest, loudly.

   THE HONESTY AXIS THAT IS ITS OWN (fail-closed on a duplicated key). A key that appears
   TWICE within the same section is a HARD ERROR (exit 2), naming the line, the key, and the
   section. This is the whole reason ini-source exists as its own gift rather than a flag on
   kv-source: the common INI-parser behaviour is to silently keep the last (or the first) of
   a duplicated key — which changes the caller's data without telling them. ini-source
   refuses. The same key in DIFFERENT sections is fine (that is what sections are for); a
   key repeated in the global preamble (section "") is a duplicate. A repeated [section]
   HEADER is likewise refused (exit 2): merging or overriding two blocks of the same name is
   the same silent guess one level up.

   THE GRAMMAR (declared, so it is pinnable)
     * A leading UTF-8 BOM on the first line is stripped (Windows INI files often carry one).
     * Lines split on newline; a trailing CR (CRLF files) is stripped, so a file parses
       identically whether it uses LF or CRLF.
     * A whitespace-only line emits nothing.
     * A line whose first non-whitespace character is ';' or '#' is a full-line COMMENT and
       emits nothing. (There are no inline/trailing comments — a ';' inside a value is part
       of the value.)
     * A line that, trimmed, is [ NAME ] — begins with '[' and ends with ']' — is a SECTION
       HEADER. NAME is the inner text trimmed; it must be non-empty and contain no '[' or
       ']'. An empty [] or a malformed header is a hard error (exit 2). The section it names
       becomes the current section. A section name may appear only once.
     * Any other non-blank line MUST be KEY=VALUE. It is split on the FIRST '='; everything
       before is the key, everything after is the value.
         - KEY is trimmed and MUST match [A-Za-z_][A-Za-z0-9_.-]* — a non-empty name. An
           empty key, or a key with spaces/illegal characters, is a hard error (exit 2).
         - VALUE is trimmed. If, after trimming, it both begins and ends with a matching
           '"' or "'" (length >= 2), those OUTER quotes are stripped and the inner text is
           the literal value (no escape processing). Otherwise the trimmed remainder is the
           literal value.
     * A non-blank, non-comment, non-header line with no '=' is a MALFORMED line (exit 2).

   THE MODEL
     [FILE]                The INI file to parse. If omitted, read stdin.
     --section-field NAME  The object key the SECTION is emitted under. Default "section".
     --key-field NAME      The object key the parsed KEY is emitted under. Default "key".
     --value-field NAME    The object key the parsed VALUE is emitted under. Default "value".
                           The three field names must be pairwise distinct (else the record
                           would collapse) — a collision is exit 2.
     --global NAME         The section name given to keys that appear before any header.
                           Default "" (empty string).

   DETERMINISM. parse(text, opts) is a pure function — no clock, no randomness, no network —
   so the same text yields byte-identical output every run and every machine.

   USAGE
     node ini-source.js app.ini
     cat app.ini | node ini-source.js
     node ini-source.js app.ini --section-field s --key-field k --value-field v
     node ini-source.js --help

   Exit codes: 0 success (including an empty stream from empty input) · 2 input error
   (malformed line, illegal/empty key, empty/malformed header, DUPLICATE key in a section,
   REPEATED section header, field-name collision, empty field name, unknown option,
   unreadable file). Always a clean one-line message on stderr, never a stack trace.

   Released under MIT.
*/
"use strict";

/* ---- the pure core ------------------------------------------------ */

var KEY_RE = /^[A-Za-z_][A-Za-z0-9_.\-]*$/;

// Strip one pair of matching outer quotes from an already-trimmed value, if present.
function stripQuotes(v) {
  if (v.length >= 2) {
    var a = v.charAt(0), b = v.charAt(v.length - 1);
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
      return v.slice(1, v.length - 1);
    }
  }
  return v;
}

function trim(s) { return s.replace(/^\s+/, "").replace(/\s+$/, ""); }

// Parse INI text into an array of uniform three-field records. Throws a clean Error on any
// malformed input — the CLI turns that into exit 2. Pure; no side effects.
function parse(text, opts) {
  opts = opts || {};
  var sectionField = opts.sectionField === undefined ? "section" : opts.sectionField;
  var keyField = opts.keyField === undefined ? "key" : opts.keyField;
  var valueField = opts.valueField === undefined ? "value" : opts.valueField;
  var globalName = opts.global === undefined ? "" : opts.global;

  if (typeof sectionField !== "string" || sectionField.length === 0) throw new Error("--section-field must be a non-empty name");
  if (typeof keyField !== "string" || keyField.length === 0) throw new Error("--key-field must be a non-empty name");
  if (typeof valueField !== "string" || valueField.length === 0) throw new Error("--value-field must be a non-empty name");
  if (sectionField === keyField || sectionField === valueField || keyField === valueField) {
    throw new Error("--section-field, --key-field and --value-field must be pairwise distinct");
  }
  if (typeof globalName !== "string") throw new Error("--global must be a string");
  if (typeof text !== "string") throw new Error("input must be text");

  // strip a leading UTF-8 BOM on the whole document
  if (text.charAt(0) === "\uFEFF") text = text.slice(1);

  var out = [];
  var current = globalName;
  var seenSections = {};          // section name -> true (a section may appear once)
  var seenKeys = {};              // section name -> { key -> true } (dup key in a section)
  seenKeys[current] = {};

  var lines = text.split("\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.charAt(line.length - 1) === "\r") line = line.slice(0, line.length - 1);  // CRLF==LF

    var t = trim(line);
    if (t.length === 0) continue;                 // blank line
    var c0 = t.charAt(0);
    if (c0 === ";" || c0 === "#") continue;       // full-line comment

    // section header?
    if (c0 === "[" && t.charAt(t.length - 1) === "]") {
      var name = trim(t.slice(1, t.length - 1));
      if (name.length === 0) throw new Error("empty section header on line " + (i + 1) + ": " + JSON.stringify(line));
      if (name.indexOf("[") !== -1 || name.indexOf("]") !== -1) {
        throw new Error("malformed section header on line " + (i + 1) + " (name contains '[' or ']'): " + JSON.stringify(line));
      }
      if (seenSections[name]) throw new Error("repeated section header [" + name + "] on line " + (i + 1) + " (a section may appear only once)");
      seenSections[name] = true;
      current = name;
      if (seenKeys[current] === undefined) seenKeys[current] = {};
      continue;
    }

    // key = value
    var eq = line.indexOf("=");
    if (eq === -1) throw new Error("malformed line " + (i + 1) + " (not a comment, section header, or KEY=VALUE): " + JSON.stringify(line));

    var key = trim(line.slice(0, eq));
    var value = trim(line.slice(eq + 1));

    if (!KEY_RE.test(key)) throw new Error("illegal key on line " + (i + 1) + ": " + JSON.stringify(key) + " (keys must match [A-Za-z_][A-Za-z0-9_.-]*)");

    if (seenKeys[current][key]) {
      throw new Error("duplicate key " + JSON.stringify(key) + " in section [" + current + "] on line " + (i + 1) + " (a key may appear once per section; refusing to silently overwrite)");
    }
    seenKeys[current][key] = true;

    value = stripQuotes(value);

    var rec = {};
    rec[sectionField] = current;
    rec[keyField] = key;
    rec[valueField] = value;
    out.push(rec);
  }
  return out;
}

// Render records as JSONL text (one JSON object per line, trailing newline if any).
function toJSONL(records) {
  var s = "";
  for (var i = 0; i < records.length; i++) s += JSON.stringify(records[i]) + "\n";
  return s;
}

/* ---- exports (browser + Node) ------------------------------------ */
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.iniSource = { parse: parse, toJSONL: toJSONL };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { parse: parse, toJSONL: toJSONL };
}

/* ---- CLI (runs only when invoked directly, never on require) ------ */

function parseArgs(args) {
  var opts = {};
  var file;
  var i = 0;
  while (i < args.length) {
    var a = args[i];
    if (a === "--section-field") {
      if (args[i + 1] === undefined) throw new Error("--section-field requires a name");
      opts.sectionField = args[i + 1]; i += 2;
    } else if (a === "--key-field") {
      if (args[i + 1] === undefined) throw new Error("--key-field requires a name");
      opts.keyField = args[i + 1]; i += 2;
    } else if (a === "--value-field") {
      if (args[i + 1] === undefined) throw new Error("--value-field requires a name");
      opts.valueField = args[i + 1]; i += 2;
    } else if (a === "--global") {
      if (args[i + 1] === undefined) throw new Error("--global requires a name");
      opts.global = args[i + 1]; i += 2;
    } else if (a.charAt(0) === "-" && a !== "-") {
      throw new Error("unknown option " + a);
    } else {
      if (file !== undefined) throw new Error("only one input file may be given (got a second: " + JSON.stringify(a) + ")");
      file = a; i += 1;
    }
  }
  return { file: file, opts: opts };
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
    "ini-source.js — parse INI / .gitconfig-style sectioned config into a uniform JSONL stream.\n\n" +
    "  node ini-source.js app.ini\n" +
    "  cat app.ini | node ini-source.js\n" +
    "  node ini-source.js app.ini --section-field s --key-field k --value-field v\n" +
    "  node ini-source.js --help\n\n" +
    "  [FILE]                INI file to parse (default: read stdin)\n" +
    "  --section-field NAME  field the SECTION is emitted under (default \"section\")\n" +
    "  --key-field NAME      field the parsed KEY is emitted under (default \"key\")\n" +
    "  --value-field NAME    field the parsed VALUE is emitted under (default \"value\")\n" +
    "  --global NAME         section name for keys before any header (default \"\")\n\n" +
    "Emits one JSON object per assignment: { section: S, key: K, value: V }, one per line.\n" +
    "Full-line ; and # comments and blank lines are skipped; lines split on the first '='.\n\n" +
    "Edge: STRINGS ONLY — no type coercion, no ${VAR} interpolation, no inline comments, no\n" +
    "escapes. A duplicate key within a section, or a repeated [section], is REFUSED (exit 2) —\n" +
    "ini-source never silently overwrites. An honest, pinnable parse.\n"
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
  catch (e) { process.stderr.write("ini-source: " + e.message + "\n"); return Promise.resolve(2); }

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
    var records = parse(text, parsed.opts);   // throws -> caught below
    process.stdout.write(toJSONL(records));
    return 0;
  }).catch(function (e) {
    process.stderr.write("ini-source: " + e.message + "\n");
    return 2;
  });
}

if (typeof require !== "undefined" && require.main === module) {
  main(process.argv).then(function (code) { process.exitCode = code; });
}
