#!/usr/bin/env node
/* template.js — fill a prompt template's {{variables}} from a data record,
   and REFUSE — naming the blank — if a required variable is missing.

   WHY THIS EXISTS. Every prompt engineer reaches for mail-merge: a base prompt
   with {{slots}}, filled from a record of values, so one template becomes many
   concrete prompts. The usual ad-hoc answer — a string .replace() per key, or a
   framework's silent templating — has one quiet, expensive failure: when the
   record is missing a value the template asked for, the slot is left as literal
   "{{name}}" text, or blanked, or filled with "undefined" — and the broken
   prompt goes to the model looking fine. You do not find out until the output is
   wrong. template refuses that. It fills EXACTLY the slots your template
   declares, from EXACTLY the record you pass, and it FAILS CLOSED the instant
   the template asks for a variable the record does not supply — naming every
   missing variable, so the blank is a loud stop, never a silent lie.

   THE ONE DISCIPLINE (the whole reason to trust it). It fills only slots it can
   prove a value for (the ⊢ rule: claim only what you can prove). There is no
   default value and no inferred value. A referenced-but-unsupplied variable is
   not a warning to absorb — it is a non-zero exit with every missing name
   listed. That refusal is the feature: "the mail-merge that won't lie."

   Pure function of its inputs. No dependencies. Same template + same record ->
   byte-identical output, every run, every seed. Slots are filled left-to-right
   as they appear; a variable used twice is filled the same both times. Runs in a
   browser (attach to your namespace) or on Node (this CLI / require()).

   USAGE
     node template.js --record '{"name":"Ada","topic":"looms"}' "Hi {{name}}, about {{topic}}."
     echo -n "Hi {{name}}." | node template.js --record '{"name":"Ada"}'   # template from stdin
     node template.js --record-file rec.json "Hi {{name}}."                 # record from a file
     node template.js --list "Hi {{name}}, re {{topic}}."                   # list the variables, fill nothing
     node template.js --help

   SLOT SYNTAX
     A slot is {{ name }} — double braces around a variable name. A name is a
     non-empty token of [A-Za-z0-9._-] (the callsign-safe alphabet — the same
     charset fanout uses for branch names). Whitespace inside the braces is
     trimmed, so {{ name }} and {{name}} are the same slot. To emit a literal
     "{{" that is NOT a slot, there is no escape — the printed edge says so: this
     gift fills declared slots, it is not a general template language.

   OUTPUT
     The filled template on stdout (exact bytes, single trailing newline only if
     your template had one). On a missing variable: nothing on stdout, the list
     of missing names on stderr, non-zero exit.

   Released under MIT. Its edge is printed in the README and this header:
   template fills the {{variables}} your template declares from the record you
   give it, and refuses (naming the blank) when a required variable is missing;
   it does NOT judge whether the FILLED prompt is correct, meaningful, or safe —
   only that every declared slot had a value.
*/

"use strict";

// The one charset rule: a variable name is a non-empty token of [A-Za-z0-9._-].
// Reuse the callsign-safe alphabet fanout uses for branch names — do not
// re-invent the charset rule.
var NAME_RE = /^[A-Za-z0-9._-]+$/;

// The slot grammar: {{ optional-ws name optional-ws }}. The captured group is
// the raw inner text; we trim and charset-check it in the fill step, so a
// malformed inner (e.g. "{{ a b }}") is NOT treated as a slot and is left as
// literal text — template fills declared, well-formed slots and nothing else.
var SLOT_RE = /\{\{\s*([^}]*?)\s*\}\}/g;

// A structured refusal. The CLI turns this into a non-zero exit with the
// message; require() callers get a thrown Error they can catch. `missing` (when
// present) is the array of unsupplied variable names, so a caller can react
// programmatically rather than parsing the message.
function TemplateError(message, missing) {
  var e = new Error(message);
  e.name = "TemplateError";
  if (missing) e.missing = missing;
  return e;
}

/* variablesOf(template) -> array of the DECLARED, well-formed variable names in
   the template, in first-appearance order, de-duplicated. A "{{ ... }}" whose
   inner text is empty or charset-invalid is NOT a variable (it is left as
   literal text by fill), so it does not appear here. Pure, no I/O. */
function variablesOf(template) {
  var text = (typeof template === "string") ? template : String(template);
  var names = [];
  var seen = Object.create(null);
  var m;
  SLOT_RE.lastIndex = 0;
  while ((m = SLOT_RE.exec(text)) !== null) {
    var inner = m[1];
    // Empty inner ("{{}}" / "{{  }}") or charset-invalid inner is not a slot.
    if (inner.length === 0 || !NAME_RE.test(inner)) continue;
    if (!seen[inner]) {
      seen[inner] = true;
      names.push(inner);
    }
  }
  return names;
}

/* fill(template, record) -> the filled string. Pure: no I/O, no clock, no
   randomness. `record` is a plain object of name -> value. Every value is
   coerced via String() exactly like the shipped sha256/fanout gifts, so a
   caller passing a number or boolean gets deterministic behavior rather than a
   surprise. FAILS CLOSED: if the template declares a variable the record does
   not supply (own-property, not inherited), it throws a TemplateError naming
   EVERY missing variable — the whole reason the gift exists. */
function fill(template, record) {
  var text = (typeof template === "string") ? template : String(template);
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    throw TemplateError("record: expected a JSON object of name -> value " +
      "(got " + (Array.isArray(record) ? "an array" : typeof record) + ")");
  }

  var declared = variablesOf(text);

  // Fail closed BEFORE filling: collect every declared variable the record does
  // not supply, in declared order, and refuse naming all of them. Checking
  // first (rather than per-slot) means the refusal lists every blank at once,
  // not just the first — you fix the record in one pass, not N.
  var missing = [];
  for (var i = 0; i < declared.length; i++) {
    var name = declared[i];
    // Own-property only: an inherited property (e.g. "toString") is NOT a
    // supplied value — treating it as one is exactly the silent-lie class.
    if (!Object.prototype.hasOwnProperty.call(record, name)) {
      missing.push(name);
    }
  }
  if (missing.length > 0) {
    throw TemplateError(
      "missing " + missing.length + " required variable" +
        (missing.length === 1 ? "" : "s") + ": " + missing.join(", ") +
        " (template declared " + declared.length + "; the record supplies none of the missing" +
        " — template refuses to leave a slot blank or literal)",
      missing);
  }

  // Every declared variable has a value. Fill left-to-right. A well-formed slot
  // is replaced by String(record[name]); a malformed/empty "{{ ... }}" is left
  // exactly as it appeared (it was never a slot).
  return text.replace(SLOT_RE, function (whole, inner) {
    if (inner.length === 0 || !NAME_RE.test(inner)) return whole; // not a slot
    return String(record[inner]);
  });
}

// Browser: attach to a namespace. Node/require: export. CLI: run below.
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.template = fill;
  window.ForestGifts.templateVariables = variablesOf;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { fill: fill, variablesOf: variablesOf };
}

// ---- CLI (runs only when invoked directly, never on require) ----------------
function readRecordArg(args) {
  var iRec = args.indexOf("--record");
  var iFile = args.indexOf("--record-file");
  if (iRec !== -1 && iFile !== -1) {
    throw TemplateError("choose one of --record or --record-file, not both");
  }
  if (iRec !== -1) {
    var json = args[iRec + 1];
    if (json === undefined) throw TemplateError("--record needs a JSON object");
    return parseRecordJSON(json, "--record");
  }
  if (iFile !== -1) {
    var path = args[iFile + 1];
    if (path === undefined) throw TemplateError("--record-file needs a path");
    var fs = require("fs");
    var text = fs.readFileSync(path, "utf8");
    return parseRecordJSON(text, path);
  }
  // No record given: default to the empty record. A template with no variables
  // fills fine; a template WITH variables then fails closed, naming them all —
  // which is the correct, honest behavior for "you gave me slots but no values."
  return {};
}

function parseRecordJSON(text, where) {
  var obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw TemplateError("record (" + where + "): not valid JSON — " + e.message);
  }
  return obj;
}

function positionalTemplate(args) {
  // The template is the first argument that is not a flag and not a flag's value.
  var flagsWithValue = { "--record": true, "--record-file": true };
  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    if (a.charAt(0) === "-") { // a flag; skip it and its value if it takes one
      if (flagsWithValue[a]) i++;
      continue;
    }
    return a;
  }
  return null; // no positional -> read stdin
}

function main(argv) {
  var args = argv.slice(2);
  if (args.indexOf("--help") !== -1 || args.indexOf("-h") !== -1) {
    process.stdout.write(
      "template.js — fill a prompt template's {{variables}} from a record, and\n" +
      "REFUSE (naming the blank) if a required variable is missing.\n\n" +
      "  node template.js --record '{\"name\":\"Ada\"}' \"Hi {{name}}.\"   record as arg\n" +
      "  echo -n \"Hi {{name}}.\" | node template.js --record '{\"name\":\"Ada\"}'  template from stdin\n" +
      "  node template.js --record-file rec.json \"Hi {{name}}.\"        record from a file\n" +
      "  node template.js --list \"Hi {{name}}, re {{topic}}.\"          list variables, fill nothing\n" +
      "  node template.js --help\n\n" +
      "Fills the {{variables}} the template declares from the record. Fails closed\n" +
      "(non-zero exit, every missing variable named) when the record is missing a\n" +
      "required variable. There is no default value.\n\n" +
      "Edge: template FILLS declared slots; it does not judge whether the filled\n" +
      "prompt is correct, meaningful, or safe — only that every slot had a value.\n"
    );
    return 0;
  }

  var wantList = args.indexOf("--list") !== -1;

  var record;
  try {
    record = readRecordArg(args);
  } catch (e) {
    process.stderr.write("template: " + e.message + "\n");
    return 2;
  }

  var tmpl = positionalTemplate(args);

  function run(templateText) {
    if (wantList) {
      var vars = variablesOf(templateText);
      process.stdout.write(vars.join("\n") + (vars.length ? "\n" : ""));
      return 0;
    }
    try {
      process.stdout.write(fill(templateText, record));
      return 0;
    } catch (e) {
      process.stderr.write("template: " + e.message + "\n");
      return 2;
    }
  }

  if (tmpl !== null) {
    return run(tmpl);
  }

  // stdin: use the exact bytes received (no trailing-newline munging).
  var chunks = [];
  process.stdin.on("data", function (d) { chunks.push(d); });
  process.stdin.on("end", function () {
    var buf = Buffer.concat(chunks);
    process.exitCode = run(buf.toString("utf8"));
  });
  return 0;
}

if (typeof require !== "undefined" && require.main === module) {
  process.exitCode = main(process.argv);
}
