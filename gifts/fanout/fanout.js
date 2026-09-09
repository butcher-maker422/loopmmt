#!/usr/bin/env node
/* fanout.js — split one input into a fixed, DECLARED set of named branches.

   WHY THIS EXISTS. When one base prompt (or any payload) must go to several
   named destinations — models, variants, personas, test conditions — the set
   of destinations should be EXPLICIT and CLOSED, decided up front, not
   discovered at runtime. The usual ad-hoc answer builds the branch list on the
   fly from whatever keys happen to be present, and the day a typo or an
   unhandled case introduces a branch nobody declared, the payload fans to a
   destination no one signed off on — silently. fanout refuses that. You declare
   the branches; it emits exactly one labeled record per declared branch, in
   declared order, and it FAILS CLOSED the instant it is asked to emit to a
   branch that was not declared, is empty, is duplicated, or is ill-formed.

   It is the OPEN half of a parallel-independent compose (the ⊗ product): fanout
   splits, its pair `junction` merges. Together they give a pipeline the
   parallel product to sit beside sequential (`|`) composition.

   THE ONE DISCIPLINE (the whole reason to trust it). It emits ONLY to branches
   you declared (the ⊢ rule: claim only what you can prove). There is no default
   branch and no inferred branch. An undeclared, empty, duplicate, or
   charset-invalid branch is not a warning to absorb — it is a non-zero exit with
   the offending branch named. That refusal is the feature.

   Pure function of its inputs. No dependencies. Same input + same branch list
   -> byte-identical JSONL, every run, every seed. Order is DECLARED order,
   never hash/set order. Runs in a browser (attach fanout to your namespace) or
   on Node (this CLI / require()).

   USAGE
     node fanout.js --branches a,b,c "the prompt"        # payload as argument
     echo -n "the prompt" | node fanout.js --branches a,b,c  # payload from stdin (exact bytes)
     node fanout.js --branches-file branches.txt "the prompt" # one branch per line
     node fanout.js --help

   OUTPUT (JSONL, one record per declared branch, in declared order):
     {"branch":"a","input":"the prompt","seq":0,"of":3}
     {"branch":"b","input":"the prompt","seq":1,"of":3}
     {"branch":"c","input":"the prompt","seq":2,"of":3}

   Released under MIT. Its edge is printed in the README: fanout splits one
   input into declared branches; it does not RUN them, order them by any policy
   but declared order, or judge whether a branch NAME is meaningful — it only
   refuses an undeclared, empty, duplicate, or ill-formed branch.
*/

"use strict";

// The one charset rule: a branch name is a non-empty token of [A-Za-z0-9._-].
// (The callsign-safe alphabet — reuse the charset rule, do not re-invent it.)
var BRANCH_RE = /^[A-Za-z0-9._-]+$/;

// A structured refusal. The CLI turns this into a non-zero exit with the
// message; require() callers get a thrown Error they can catch.
function FanoutError(message) {
  var e = new Error(message);
  e.name = "FanoutError";
  return e;
}

/* parseBranches(spec) -> array of validated branch names, in declared order.
   `spec` is an array of raw tokens (already split from a CSV or a file). Fails
   closed on: empty list, an empty/whitespace token, a duplicate, a
   charset-invalid token. The offending branch is always named. */
function parseBranches(spec) {
  if (!Array.isArray(spec)) {
    throw FanoutError("branches: expected a list of branch names");
  }
  var branches = [];
  var seen = Object.create(null);
  for (var i = 0; i < spec.length; i++) {
    var raw = spec[i];
    var name = (typeof raw === "string") ? raw.trim() : String(raw).trim();
    if (name.length === 0) {
      throw FanoutError("branches: empty branch name at position " + i +
        " (an undeclared/blank destination is exactly what fanout refuses)");
    }
    if (!BRANCH_RE.test(name)) {
      throw FanoutError("branches: ill-formed branch name " + JSON.stringify(name) +
        " (allowed: letters, digits, dot, underscore, hyphen)");
    }
    if (seen[name]) {
      throw FanoutError("branches: duplicate branch name " + JSON.stringify(name) +
        " (an ambiguous fan is refused; each declared branch must be unique)");
    }
    seen[name] = true;
    branches.push(name);
  }
  if (branches.length === 0) {
    throw FanoutError("branches: no branches declared " +
      "(fanout has no default branch — declare at least one)");
  }
  return branches;
}

/* fanout(input, branches) -> array of records, one per declared branch, in
   declared order. Pure: no I/O, no clock, no randomness. `input` is coerced via
   String() exactly like the shipped sha256 gift, so a caller passing a number
   or boolean gets deterministic behavior rather than a surprise. */
function fanout(input, branches) {
  var validated = parseBranches(branches);
  var payload = (typeof input === "string") ? input : String(input);
  var of = validated.length;
  var records = [];
  for (var i = 0; i < of; i++) {
    records.push({ branch: validated[i], input: payload, seq: i, of: of });
  }
  return records;
}

/* fanoutJSONL(input, branches) -> the canonical serialized form: one JSON
   object per line, keys in fixed order (branch,input,seq,of), in declared
   branch order, terminated by a single trailing newline. This string IS the
   gift's canonical output — same input + same branches yields byte-identical
   text every run. */
function fanoutJSONL(input, branches) {
  var records = fanout(input, branches);
  var lines = [];
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    // Fixed key order, JSON.stringify per-field to get correct escaping.
    lines.push(
      "{" +
        "\"branch\":" + JSON.stringify(r.branch) + "," +
        "\"input\":" + JSON.stringify(r.input) + "," +
        "\"seq\":" + r.seq + "," +
        "\"of\":" + r.of +
      "}"
    );
  }
  return lines.join("\n") + "\n";
}

// Browser: attach to a namespace. Node/require: export. CLI: run below.
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.fanout = fanout;
  window.ForestGifts.fanoutJSONL = fanoutJSONL;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { fanout: fanout, fanoutJSONL: fanoutJSONL, parseBranches: parseBranches };
}

// ---- CLI (runs only when invoked directly, never on require) ----------------
function readBranchesArg(args) {
  var iCsv = args.indexOf("--branches");
  var iFile = args.indexOf("--branches-file");
  if (iCsv !== -1 && iFile !== -1) {
    throw FanoutError("choose one of --branches or --branches-file, not both");
  }
  if (iCsv !== -1) {
    var csv = args[iCsv + 1];
    if (csv === undefined) throw FanoutError("--branches needs a comma-separated value");
    return csv.split(",");
  }
  if (iFile !== -1) {
    var path = args[iFile + 1];
    if (path === undefined) throw FanoutError("--branches-file needs a path");
    var fs = require("fs");
    var text = fs.readFileSync(path, "utf8");
    // One branch per line; blank lines are dropped before validation so a
    // trailing newline in the file is not itself an "empty branch".
    return text.split("\n").map(function (s) { return s.replace(/\r$/, ""); })
               .filter(function (s) { return s.trim().length > 0; });
  }
  throw FanoutError("no branches declared: pass --branches a,b,c or --branches-file <path>");
}

function positionalPayload(args) {
  // The payload is the first argument that is not a flag and not a flag's value.
  var flagsWithValue = { "--branches": true, "--branches-file": true };
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
      "fanout.js — split one input into a fixed, DECLARED set of named branches.\n\n" +
      "  node fanout.js --branches a,b,c \"the prompt\"        payload as argument\n" +
      "  echo -n \"the prompt\" | node fanout.js --branches a,b,c  payload from stdin (exact bytes)\n" +
      "  node fanout.js --branches-file branches.txt \"the prompt\"  one branch per line\n" +
      "  node fanout.js --help\n\n" +
      "Emits one JSONL record per DECLARED branch, in declared order. Fails closed\n" +
      "(non-zero exit, branch named) on an undeclared, empty, duplicate, or ill-formed\n" +
      "branch. There is no default branch.\n\n" +
      "Edge: fanout SPLITS; it does not run the branches, order them by any policy but\n" +
      "declared order, or judge whether a branch name is meaningful.\n"
    );
    return 0;
  }

  var branchSpec;
  try {
    branchSpec = readBranchesArg(args);
  } catch (e) {
    process.stderr.write("fanout: " + e.message + "\n");
    return 2;
  }

  var payload = positionalPayload(args);

  function emit(input) {
    try {
      process.stdout.write(fanoutJSONL(input, branchSpec));
      return 0;
    } catch (e) {
      process.stderr.write("fanout: " + e.message + "\n");
      return 2;
    }
  }

  if (payload !== null) {
    return emit(payload);
  }

  // stdin: use the exact bytes received (no trailing-newline munging).
  var chunks = [];
  process.stdin.on("data", function (d) { chunks.push(d); });
  process.stdin.on("end", function () {
    var buf = Buffer.concat(chunks);
    process.exitCode = emit(buf.toString("utf8"));
  });
  return 0;
}

if (typeof require !== "undefined" && require.main === module) {
  process.exitCode = main(process.argv);
}
