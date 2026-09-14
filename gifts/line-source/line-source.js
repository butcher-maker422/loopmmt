#!/usr/bin/env node
/* line-source.js — turn a plain-text file into a JSONL record stream, one record per line.
   Dependency-free, deterministic, pure. Runs in Node or a browser. MIT.

   WHAT IT IS. A SOURCE: it takes text in and emits a JSONL stream out — the front of a
   pipe. Hand it the contents of a log file, a word list, a CSV-without-structure, any
   line-oriented text, and it emits one JSON object per line: {"line":"...","n":0}. It is
   the adapter that lets the JSONL fold/filter/transform gifts consume ordinary text
   files: `line-source access.log | range-filter ...`, `line-source names.txt | dedup-filter`.

   THE THREE QUIET FAILURES IT FIXES. Everyone "knows" how to split a file into lines —
   text.split("\n") — and everyone gets it subtly wrong, in three ways that only bite
   later:

     1. THE PHANTOM EMPTY RECORD. A well-formed text file ends with a newline. Naive
        "abc\ndef\n".split("\n") yields ["abc","def",""] — a trailing empty string that
        becomes a bogus final record. line-source treats a single trailing newline as the
        line TERMINATOR it is (POSIX: a line is text followed by a newline), not a
        separator, so "abc\ndef\n" is exactly two lines. A file with NO final newline
        ("abc\ndef") is also two lines — the last line is still a line. The difference
        between "ends with newline" and "does not" never changes the record count.

     2. CRLF. Files authored on Windows end lines with "\r\n". Splitting on "\n" alone
        leaves a trailing "\r" glued to every record — invisible, and a silent mismatch
        the moment you compare or key on that field. line-source recognizes "\r\n", "\n",
        and a lone "\r" (classic-Mac) as line endings and strips them, so the emitted
        "line" value is the text WITHOUT its terminator, whatever the file's convention.

     3. THE BOM. A UTF-8 file may open with a byte-order mark (U+FEFF). Left in, it glues
        an invisible character to the first record. line-source strips a single leading
        BOM before splitting, so the first line is clean.

   THE MODEL. Input is the whole text (stdin on the CLI, or a string to lines()). Each
   line becomes { line: <text-without-terminator>, n: <0-based index> }, emitted in file
   order, one JSON object per line of output.

     --field NAME    the key holding the line text (default "line"). Non-empty.
     --index NAME    the key holding the 0-based line number (default "n"). Empty string
                     disables the index entirely (emit { line: ... } only).
     --skip-blank    do not emit a record for a line that is empty after its terminator
                     is stripped. Index numbering still follows ORIGINAL line position, so
                     n stays a faithful pointer into the source file (a dropped blank
                     leaves a gap in n — that is the honest behavior, not a bug).
     --trim          strip leading/trailing ASCII whitespace from each line's text before
                     emitting. Off by default: a source should preserve bytes unless told.

   DETERMINISM. lines(text, opts) is a pure function — no clock, no randomness, no files
   beyond the text you pass, no ambient state — so the same text and options yield
   byte-identical output on every run and every machine.

   USAGE
     node line-source.js < access.log
     printf 'a\nb\nc\n' | node line-source.js --skip-blank
     node line-source.js --field text --index "" < names.txt
     node line-source.js --help

   Exit codes: 0 success (including empty input -> empty stream) · 2 input error (empty
   --field name, unknown option, unexpected positional). Always a clean one-line message
   on stderr, never a stack trace.

   Released under MIT. Its edge is printed in the README: line-source splits on line
   TERMINATORS (\r\n, \n, \r) and emits one record per line — it does not parse CSV
   fields (use csv-source), does not parse JSON (the lines are emitted as verbatim
   strings), does not read the file itself (you pipe text in), and does not sort or
   deduplicate. It preserves line bytes (minus the terminator, and minus a leading BOM);
   with --trim it strips surrounding whitespace, and never otherwise.
*/
"use strict";

/* ---- the pure core ------------------------------------------------ */

// Split text into its lines, honoring \r\n / \n / \r terminators, treating a final
// terminator as a terminator (not a separator that spawns a phantom empty line), and
// stripping a single leading BOM. Returns an array of line strings (terminators removed).
// Pure: depends only on `text`.
function splitLines(text) {
  if (typeof text !== "string") text = String(text == null ? "" : text);
  if (text.length === 0) return [];
  // strip a single leading UTF-8 BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.length === 0) return [];
  var lines = [];
  var start = 0;
  var i = 0;
  var len = text.length;
  while (i < len) {
    var c = text.charCodeAt(i);
    if (c === 10 /* \n */) {
      lines.push(text.slice(start, i));
      i += 1;
      start = i;
    } else if (c === 13 /* \r */) {
      lines.push(text.slice(start, i));
      if (i + 1 < len && text.charCodeAt(i + 1) === 10) i += 2; // \r\n
      else i += 1;                                              // lone \r
      start = i;
    } else {
      i += 1;
    }
  }
  // trailing text with no final terminator is still a line
  if (start < len) lines.push(text.slice(start, len));
  return lines;
}

function isWs(code) {
  // ASCII whitespace: space, \t, \n, \v, \f, \r
  return code === 32 || (code >= 9 && code <= 13);
}

function trimAscii(s) {
  var a = 0, b = s.length;
  while (a < b && isWs(s.charCodeAt(a))) a++;
  while (b > a && isWs(s.charCodeAt(b - 1))) b--;
  return s.slice(a, b);
}

// Turn text into an array of records. Throws a clean Error on invalid options — the CLI
// turns that into exit 2. Pure; no side effects.
//   opts.field       key for the line text (default "line"; non-empty)
//   opts.index       key for the 0-based line number (default "n"; "" disables)
//   opts.skipBlank   drop lines empty after terminator strip (index still tracks source pos)
//   opts.trim        strip surrounding ASCII whitespace from each line's text
function lines(text, opts) {
  opts = opts || {};
  var field = opts.field === undefined ? "line" : opts.field;
  var index = opts.index === undefined ? "n" : opts.index;
  var skipBlank = !!opts.skipBlank;
  var trim = !!opts.trim;

  if (typeof field !== "string" || field.length === 0) throw new Error("--field must be a non-empty name");
  if (typeof index !== "string") throw new Error("--index must be a string name (or empty to disable)");

  var raw = splitLines(text);
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var value = trim ? trimAscii(raw[i]) : raw[i];
    if (skipBlank && value.length === 0) continue;
    var rec = {};
    rec[field] = value;
    // index reflects the ORIGINAL 0-based line position (i), so a skipped blank leaves a
    // faithful gap rather than renumbering — n stays a pointer into the source file.
    if (index.length > 0) rec[index] = i;
    out.push(rec);
  }
  return out;
}

// Render records as JSONL text (one JSON object per line, trailing newline per record).
function toJSONL(records) {
  var s = "";
  for (var i = 0; i < records.length; i++) s += JSON.stringify(records[i]) + "\n";
  return s;
}

/* ---- exports (browser + Node) ------------------------------------ */
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.lineSource = { lines: lines, splitLines: splitLines, toJSONL: toJSONL };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { lines: lines, splitLines: splitLines, toJSONL: toJSONL };
}

/* ---- CLI (runs only when invoked directly, never on require) ------ */

function parseArgs(args) {
  var opts = {};
  var i = 0;
  while (i < args.length) {
    var a = args[i];
    if (a === "--field") {
      var f = args[i + 1];
      if (f === undefined) throw new Error("--field requires a name");
      opts.field = f;
      i += 2;
    } else if (a === "--index") {
      var x = args[i + 1];
      if (x === undefined) throw new Error("--index requires a name (or \"\" to disable)");
      opts.index = x;
      i += 2;
    } else if (a === "--skip-blank") {
      opts.skipBlank = true;
      i += 1;
    } else if (a === "--trim") {
      opts.trim = true;
      i += 1;
    } else if (a.charAt(0) === "-") {
      throw new Error("unknown option " + a);
    } else {
      throw new Error("unexpected argument " + JSON.stringify(a) + " (line-source reads text from stdin)");
    }
  }
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

function main(argv) {
  var args = argv.slice(2);
  if (args.indexOf("--help") !== -1 || args.indexOf("-h") !== -1) {
    process.stdout.write(
      "line-source.js — turn a plain-text file into a JSONL record stream, one record per line.\n\n" +
      "  node line-source.js < access.log\n" +
      "  printf 'a\\nb\\nc\\n' | node line-source.js --skip-blank\n" +
      "  node line-source.js --field text --index \"\" < names.txt\n" +
      "  node line-source.js --help\n\n" +
      "  --field NAME   key holding the line text (default \"line\")\n" +
      "  --index NAME   key holding the 0-based line number (default \"n\"; \"\" disables)\n" +
      "  --skip-blank   drop lines empty after the terminator is stripped (n keeps source position)\n" +
      "  --trim         strip surrounding ASCII whitespace from each line's text\n\n" +
      "Reads text from stdin; emits one JSON object per line: { line: <text>, n: <index> }.\n" +
      "Splits on \\r\\n, \\n, or \\r; a final terminator is a terminator (no phantom empty\n" +
      "record); a leading UTF-8 BOM is stripped.\n\n" +
      "Edge: it splits on line terminators and emits one record per line. It does not parse\n" +
      "CSV fields (use csv-source), does not parse JSON (lines are verbatim strings), does\n" +
      "not read the file itself (pipe text in), and does not sort or deduplicate.\n"
    );
    return 0;
  }
  var opts;
  try { opts = parseArgs(args); }
  catch (e) { process.stderr.write("line-source: " + e.message + "\n"); return 2; }
  var text = readStdin();
  var records;
  try { records = lines(text, opts); }
  catch (e) { process.stderr.write("line-source: " + e.message + "\n"); return 2; }
  process.stdout.write(toJSONL(records));
  return 0;
}

if (typeof require !== "undefined" && require.main === module) {
  process.exitCode = main(process.argv);
}
