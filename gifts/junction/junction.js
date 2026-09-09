#!/usr/bin/env node
/* junction.js — merge declared branch-records into one, under a REQUIRED policy.

   WHY THIS EXISTS. It is the close half of a parallel-independent compose (the ⊗
   product): `fanout` splits one input into N declared branches; `junction` folds
   those branch-records back into a single record. The pair gives a pipeline the
   parallel product to sit beside sequential (`|`) composition, so `fanout | junction`
   round-trips.

   THE ONE DISCIPLINE (the whole reason to trust it). HOW branches recombine is a
   decision the caller must make EXPLICITLY. There is no default policy. junction
   takes the labeled records and a DECLARED policy from a closed set, and emits one
   merged record — and it FAILS CLOSED the instant it is asked to merge with no
   policy, an unknown policy, malformed input, or a conflict the policy declares
   fatal (an `agree` disagreement). It never silently picks a winner.

   THE CLOSED POLICY SET (v1):
     concat  -> {"policy":"concat","of":n,"merged":[input_0,...,input_{n-1}]}
     agree   -> require every branch input identical; {"policy":"agree","of":n,"value":input}
                (fails closed, naming the two branches, on any disagreement)
     first   -> {"policy":"first","of":n,"value":input_0}
     map     -> {"policy":"map","of":n,"by_branch":{branch:input,...}}

   Pure function of its inputs. No dependencies. Same records + same policy ->
   byte-identical merged output, every run. Records are folded in `seq` order, so
   input line-order never leaks into the result. Runs in a browser (attach junction
   to your namespace) or on Node (this CLI / require()).

   USAGE
     node fanout.js --branches a,b,c "p" | node junction.js --policy concat   # the braid
     node junction.js --policy agree < records.jsonl
     node junction.js --policy map --input records.jsonl
     node junction.js --help

   Released under MIT. Its edge is printed in the README: junction merges declared
   branch-records into one under a declared policy; it does not choose the policy for
   you, run the branches, or resolve a value conflict the policy leaves ambiguous — it
   refuses when no policy is declared or the policy cannot merge cleanly.
*/

"use strict";

var POLICIES = ["concat", "agree", "first", "map"];

function JunctionError(message) {
  var e = new Error(message);
  e.name = "JunctionError";
  return e;
}

/* parseRecords(text) -> array of fanout records, validated and sorted by seq.
   Fails closed on: no records, a non-record line, an `of` that disagrees with the
   count, a missing/duplicate/out-of-range seq. The corrupted-fan cases are real
   defects (a fan mangled in transit), not warnings. */
function parseRecords(text) {
  var lines = String(text).split("\n").filter(function (l) { return l.trim().length > 0; });
  if (lines.length === 0) {
    throw JunctionError("no input records (junction folds a fanout's output; it needs at least one record)");
  }
  var recs = [];
  for (var i = 0; i < lines.length; i++) {
    var obj;
    try { obj = JSON.parse(lines[i]); }
    catch (e) { throw JunctionError("input line " + i + " is not valid JSON: " + lines[i]); }
    if (obj === null || typeof obj !== "object" ||
        typeof obj.branch !== "string" ||
        !("input" in obj) ||
        typeof obj.seq !== "number" ||
        typeof obj.of !== "number") {
      throw JunctionError("input line " + i + " is not a fanout record {branch,input,seq,of}: " + lines[i]);
    }
    recs.push(obj);
  }
  var of = recs[0].of;
  if (recs.length !== of) {
    throw JunctionError("record count " + recs.length + " disagrees with declared of=" + of +
      " (the fan was truncated or padded in transit)");
  }
  var seenSeq = Object.create(null);
  for (var j = 0; j < recs.length; j++) {
    var r = recs[j];
    if (r.of !== of) {
      throw JunctionError("record for branch " + JSON.stringify(r.branch) +
        " has of=" + r.of + ", expected " + of + " (mixed fans cannot be merged)");
    }
    if (r.seq < 0 || r.seq >= of || (r.seq | 0) !== r.seq) {
      throw JunctionError("record for branch " + JSON.stringify(r.branch) +
        " has out-of-range seq=" + r.seq + " (expected 0.." + (of - 1) + ")");
    }
    if (seenSeq[r.seq]) {
      throw JunctionError("duplicate seq=" + r.seq + " (the fan is ambiguous — two records claim the same position)");
    }
    seenSeq[r.seq] = true;
  }
  // Fold in declared order: sort by seq (input line-order must not leak).
  recs.sort(function (a, b) { return a.seq - b.seq; });
  return recs;
}

/* mergeRecords(records, policy) -> the merged object (not yet serialized).
   `records` may be raw fanout records (already validated) in any input order;
   they are sorted by seq here. Fails closed on an unknown policy or an
   `agree` disagreement. */
function mergeRecords(records, policy) {
  if (POLICIES.indexOf(policy) === -1) {
    throw JunctionError("unknown merge policy " + JSON.stringify(policy) +
      " (declared set: " + POLICIES.join(", ") + "; there is no default)");
  }
  var recs = records.slice().sort(function (a, b) { return a.seq - b.seq; });
  var of = recs.length;
  if (policy === "concat") {
    return { policy: "concat", of: of, merged: recs.map(function (r) { return r.input; }) };
  }
  if (policy === "first") {
    return { policy: "first", of: of, value: recs[0].input };
  }
  if (policy === "map") {
    var by = {};
    for (var i = 0; i < recs.length; i++) { by[recs[i].branch] = recs[i].input; }
    return { policy: "map", of: of, by_branch: by };
  }
  // agree: every branch input must be identical (compared by canonical JSON).
  var ref = JSON.stringify(recs[0].input);
  for (var k = 1; k < recs.length; k++) {
    if (JSON.stringify(recs[k].input) !== ref) {
      throw JunctionError("agree conflict: branch " + JSON.stringify(recs[0].branch) +
        " and branch " + JSON.stringify(recs[k].branch) +
        " disagree (agree refuses a disagreement; it never picks a winner)");
    }
  }
  return { policy: "agree", of: of, value: recs[0].input };
}

/* junction(text, policy) -> the canonical serialized merged record: one JSON
   object, keys in the policy's fixed insertion order, single trailing newline.
   This string IS the gift's canonical output. */
function junction(text, policy) {
  var recs = parseRecords(text);
  var merged = mergeRecords(recs, policy);
  return JSON.stringify(merged) + "\n";
}

// Browser / Node exports.
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.junction = junction;
  window.ForestGifts.mergeRecords = mergeRecords;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { junction: junction, mergeRecords: mergeRecords, parseRecords: parseRecords, POLICIES: POLICIES };
}

// ---- CLI --------------------------------------------------------------------
function readPolicy(args) {
  var i = args.indexOf("--policy");
  if (i === -1) {
    throw JunctionError("no merge policy declared: pass --policy <" + POLICIES.join("|") +
      "> (there is no default policy)");
  }
  var p = args[i + 1];
  if (p === undefined) throw JunctionError("--policy needs a value (" + POLICIES.join("|") + ")");
  return p;
}

function main(argv) {
  var args = argv.slice(2);
  if (args.indexOf("--help") !== -1 || args.indexOf("-h") !== -1) {
    process.stdout.write(
      "junction.js — merge declared branch-records into one, under a REQUIRED policy.\n\n" +
      "  node fanout.js --branches a,b,c \"p\" | node junction.js --policy concat   the braid\n" +
      "  node junction.js --policy agree < records.jsonl\n" +
      "  node junction.js --policy map --input records.jsonl\n" +
      "  node junction.js --help\n\n" +
      "Policies (closed set, no default): " + POLICIES.join(", ") + "\n" +
      "  concat  ordered list of branch inputs\n" +
      "  agree   require all branches identical (refuses a disagreement, naming the two)\n" +
      "  first   the seq:0 branch's input\n" +
      "  map     a branch->input object\n\n" +
      "Fails closed (non-zero exit) on no policy, unknown policy, malformed input, or an\n" +
      "agree conflict. It never silently picks a winner.\n\n" +
      "Edge: junction MERGES under a declared policy; it does not choose the policy, run\n" +
      "the branches, or resolve a conflict the policy leaves ambiguous.\n"
    );
    return 0;
  }

  var policy;
  try { policy = readPolicy(args); }
  catch (e) { process.stderr.write("junction: " + e.message + "\n"); return 2; }

  function emit(text) {
    try { process.stdout.write(junction(text, policy)); return 0; }
    catch (e) { process.stderr.write("junction: " + e.message + "\n"); return 2; }
  }

  var iInput = args.indexOf("--input");
  if (iInput !== -1) {
    var path = args[iInput + 1];
    if (path === undefined) { process.stderr.write("junction: --input needs a path\n"); return 2; }
    var fs = require("fs");
    return emit(fs.readFileSync(path, "utf8"));
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
