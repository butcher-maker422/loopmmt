#!/usr/bin/env node
/* kv-source.js — parse plain KEY=VALUE text into a uniform JSONL record stream.
   Dependency-free, deterministic, pure. Runs in Node or a browser. MIT.

   WHAT IT IS. A SOURCE: it turns non-JSONL text (a .env / .properties / a plain
   key=value config) into the front of a pipe — one JSON object per line (JSONL) that
   the fold/filter/transform gifts consume. Give it a file (or pipe text on stdin) and
   it emits one uniform record per assignment:

       PORT=8080          ->  {"key":"PORT","value":"8080"}
       # a comment        ->  (skipped)
       HOST = localhost   ->  {"key":"HOST","value":"localhost"}
       GREETING="hi there"->  {"key":"GREETING","value":"hi there"}

   Every record has the same two string fields, so it drops straight into a generic
   filter or fold:  kv-source .env | range-filter ...  /  kv-source .env | dedup-filter.

   STRINGS ONLY (the honesty axis). Values are emitted as LITERAL STRINGS — kv-source
   does not guess types. "8080" stays the string "8080"; "true" stays "true"; "" stays
   "". This is deliberate, not a limitation to apologize for: the moment a parser starts
   coercing (is 08 octal? is 1e3 a number? is TRUE a boolean?) the SAME file parses to
   different bytes under different tools, and a source you cannot pin is not a source.
   kv-source emits strings and lets a downstream typed gift decide. For the same reason
   it does NOT interpolate ${VAR}/$VAR, does NOT strip an `export ` prefix, does NOT
   honor inline (trailing) comments, and does NOT process backslash escapes inside a
   quoted value — each of those is a context-dependent guess that would break byte
   determinism. It parses the grammar it was given and REFUSES the rest, loudly.

   THE GRAMMAR (declared, so it is pinnable)
     * Lines split on newline; a trailing CR (CRLF files) is stripped, so a file parses
       identically whether it uses LF or CRLF.
     * A whitespace-only line emits nothing.
     * A line whose first non-whitespace character is `#` is a full-line COMMENT and
       emits nothing. (There are no inline/trailing comments — a `#` inside a value is
       part of the value.)
     * Any other line MUST be KEY=VALUE. It is split on the FIRST `=`; everything before
       is the key, everything after is the value.
         - KEY is trimmed and MUST match [A-Za-z_][A-Za-z0-9_.-]* — a non-empty name.
           An empty key, or a key with spaces/illegal characters (e.g. `export FOO`), is
           a hard error (exit 2), not a silent guess.
         - VALUE is trimmed. If, after trimming, it both begins and ends with a matching
           `"` or `'` (length >= 2), those OUTER quotes are stripped and the inner text
           is the literal value (no escape processing). Otherwise the trimmed remainder
           is the literal value.
     * A non-blank, non-comment line with no `=` is a MALFORMED line (exit 2).

   THE MODEL
     [FILE]              The key=value file to parse. If omitted, read stdin.
     --key-field NAME    The object key the parsed KEY is emitted under. Default "key".
     --value-field NAME  The object key the parsed VALUE is emitted under. Default
                         "value". Must differ from --key-field (else the record would
                         collapse) — a collision is exit 2.

   Duplicate keys across lines are NOT merged or de-duplicated — each line emits its own
   record, in file order. De-duplication (last-wins, first-wins) is dedup-filter's job
   downstream; kv-source's job is an honest, order-faithful parse.

   DETERMINISM. parse(text, opts) is a pure function — no clock, no randomness, no
   network — so the same text yields byte-identical output every run and every machine.

   USAGE
     node kv-source.js config.env
     cat .env | node kv-source.js
     node kv-source.js .env --key-field name --value-field val
     node kv-source.js --help

   Exit codes: 0 success (including an empty stream from empty input) · 2 input error
   (malformed line, illegal/empty key, key-field==value-field, empty field name, unknown
   option, unreadable file). Always a clean one-line message on stderr, never a stack
   trace.

   Released under MIT. Its edge is printed in the README: kv-source parses PLAIN
   KEY=VALUE text into uniform string records only — it does not coerce types, does not
   interpolate ${VAR}, does not strip an `export ` prefix, does not honor inline
   comments, and does not process escapes inside quotes. An honest, pinnable parse.
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

// Parse KEY=VALUE text into an array of uniform two-field records. Throws a clean Error
// on any malformed input — the CLI turns that into exit 2. Pure; no side effects.
function parse(text, opts) {
  opts = opts || {};
  var keyField = opts.keyField === undefined ? "key" : opts.keyField;
  var valueField = opts.valueField === undefined ? "value" : opts.valueField;

  if (typeof keyField !== "string" || keyField.length === 0) throw new Error("--key-field must be a non-empty name");
  if (typeof valueField !== "string" || valueField.length === 0) throw new Error("--value-field must be a non-empty name");
  if (keyField === valueField) throw new Error("--key-field and --value-field must differ (both \"" + keyField + "\")");
  if (typeof text !== "string") throw new Error("input must be text");

  var out = [];
  var lines = text.split("\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    // strip a trailing CR so CRLF parses identically to LF
    if (line.charAt(line.length - 1) === "\r") line = line.slice(0, line.length - 1);

    var trimmed = line.replace(/^\s+/, "").replace(/\s+$/, "");
    if (trimmed.length === 0) continue;            // blank line
    if (trimmed.charAt(0) === "#") continue;       // full-line comment

    var eq = line.indexOf("=");
    if (eq === -1) throw new Error("malformed line " + (i + 1) + " (no '='): " + JSON.stringify(line));

    var key = line.slice(0, eq).replace(/^\s+/, "").replace(/\s+$/, "");
    var value = line.slice(eq + 1).replace(/^\s+/, "").replace(/\s+$/, "");

    if (!KEY_RE.test(key)) throw new Error("illegal key on line " + (i + 1) + ": " + JSON.stringify(key) + " (keys must match [A-Za-z_][A-Za-z0-9_.-]*)");

    value = stripQuotes(value);

    var rec = {};
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
  window.ForestGifts.kvSource = { parse: parse, toJSONL: toJSONL };
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
    if (a === "--key-field") {
      if (args[i + 1] === undefined) throw new Error("--key-field requires a name");
      opts.keyField = args[i + 1];
      i += 2;
    } else if (a === "--value-field") {
      if (args[i + 1] === undefined) throw new Error("--value-field requires a name");
      opts.valueField = args[i + 1];
      i += 2;
    } else if (a.charAt(0) === "-" && a !== "-") {
      throw new Error("unknown option " + a);
    } else {
      if (file !== undefined) throw new Error("only one input file may be given (got a second: " + JSON.stringify(a) + ")");
      file = a;
      i += 1;
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
    "kv-source.js — parse plain KEY=VALUE text into a uniform JSONL record stream.\n\n" +
    "  node kv-source.js config.env\n" +
    "  cat .env | node kv-source.js\n" +
    "  node kv-source.js .env --key-field name --value-field val\n" +
    "  node kv-source.js --help\n\n" +
    "  [FILE]              key=value file to parse (default: read stdin)\n" +
    "  --key-field NAME    field the parsed KEY is emitted under (default \"key\")\n" +
    "  --value-field NAME  field the parsed VALUE is emitted under (default \"value\")\n\n" +
    "Emits one JSON object per assignment: { key: NAME, value: VALUE }, one per line.\n" +
    "Full-line # comments and blank lines are skipped; lines split on the first '='.\n\n" +
    "Edge: PLAIN KEY=VALUE only, values are literal STRINGS. It does not coerce types,\n" +
    "does not interpolate ${VAR}, does not strip an `export ` prefix, does not honor\n" +
    "inline comments, and does not process escapes inside quotes. An honest, pinnable parse.\n"
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
  catch (e) { process.stderr.write("kv-source: " + e.message + "\n"); return Promise.resolve(2); }

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
    process.stderr.write("kv-source: " + e.message + "\n");
    return 2;
  });
}

if (typeof require !== "undefined" && require.main === module) {
  main(process.argv).then(function (code) { process.exitCode = code; });
}
