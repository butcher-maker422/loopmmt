#!/usr/bin/env node
/* input-event-router.js — a dependency-free, deterministic reducer that turns a
   raw input-event log into a validated, typed event stream.

   WHY THIS EXISTS. Every interactive app re-hand-rolls the same first step: take
   raw, untrusted pointer/key input and turn it into something a reducer can
   safely fold. Hand-rolled, that step is where the bugs and the attack surface
   live — an unvalidated event coerced instead of rejected, a wall-clock read
   that breaks replay, a field the reducer trusts that the input never carried.
   This is that step done once, correctly, as a DETERMINISTIC REDUCER over an
   input-event log: raw events in, a typed schema-validated stream out, plus a
   tiny O(1) fold-state (sequence integrity + monotonic tick).

   THE STRIP-CLEAN RULE (the whole reason to trust it). state_t is a pure fold of
   state_0 and the ordered event log up to t. Replaying the same log yields
   byte-identical state, stream, and render. The router holds NO clock, NO
   network, and NO entropy it did not receive as an event — logical time enters
   ONLY as the event field `t`, supplied by the caller as data. So the same log
   replays identically forever, in a browser or headless on Node.

   THE ENVELOPE (this gift authors the interactive lane's event schema). One
   event per JSONL line:
     { "seq": <int>=0, monotonic +1 >, "t": <int>=0, non-decreasing logical tick >,
       "type": <one of the declared accepted types>, "payload": <object> }
   seq is the total order (a gap or repeat is a rejection). t is logical time as
   DATA (never a clock read). type must be in the declared accepted set. payload
   is opaque cargo (checked to be an object; its contents are the downstream
   reducer's business, not this gift's).

   USAGE
     node input-event-router.js < events.jsonl     # fold a JSONL event log -> render + summary
     node input-event-router.js --help

   Released under MIT. Its edge, printed in the README and --help: this
   NORMALIZES and VALIDATES input events against a declared schema, folding them
   into a deterministic typed stream. It does NOT sanitize application semantics,
   it does NOT persist, it holds NO clock/network/entropy, and it trusts no event
   it did not schema. (Retaining event history is the undo-stack-kernel's job,
   under its own declared bound — this gift deliberately keeps O(1) state.)
*/
"use strict";

// The default accepted event-type vocabulary. The vocabulary is CONFIG, not
// frozen (covenant §2/§5 U2 — sub-lanes/types by contract, not by a fixed list):
// what the gift enforces is that the vocabulary is DECLARED and CLOSED, which is
// the decidable security property. An app supplies its own set via cfg.acceptedTypes.
var DEFAULT_ACCEPTED_TYPES = ["pointer", "key", "select", "edit", "commit"];

// The initial fold-state. O(1) by contract: three integers, never a buffer.
function state0() {
  return { nextSeq: 0, lastTick: -1, count: 0 };
}

// isPlainObject — an object, not null, not an array, not a scalar. payload must
// be an object; we do NOT walk its contents (depth-1 check => bounded work,
// resource-bounds clause §3.3).
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isInt(v) {
  return typeof v === "number" && isFinite(v) && Math.floor(v) === v;
}

/* validate(state, event, cfg) -> { ok: true } | { ok: false, reason: <string> }
   Pure. Checks the envelope against the schema BEFORE the fold sees it. Every
   failure is a DECLARED rejection reason; nothing is coerced. */
function validate(state, event, cfg) {
  var accepted = (cfg && cfg.acceptedTypes) || DEFAULT_ACCEPTED_TYPES;

  if (!isPlainObject(event)) return { ok: false, reason: "event-not-object" };

  // seq: present, int >= 0, exactly the next expected (total order, no gap/repeat).
  if (!isInt(event.seq) || event.seq < 0) return { ok: false, reason: "seq-not-int" };
  if (event.seq < state.nextSeq) return { ok: false, reason: "seq-repeat" };
  if (event.seq > state.nextSeq) return { ok: false, reason: "seq-gap" };

  // t: present, int >= 0, non-decreasing (logical tick as data; never a clock).
  if (!isInt(event.t) || event.t < 0) return { ok: false, reason: "tick-not-int" };
  if (event.t < state.lastTick) return { ok: false, reason: "tick-decrease" };

  // type: non-empty string in the declared accepted set.
  if (typeof event.type !== "string" || event.type.length === 0) {
    return { ok: false, reason: "type-not-string" };
  }
  if (accepted.indexOf(event.type) === -1) return { ok: false, reason: "type-not-accepted" };

  // payload: an object (opaque cargo). A scalar/null/array payload is rejected.
  if (!isPlainObject(event.payload)) return { ok: false, reason: "payload-not-object" };

  return { ok: true };
}

/* route(state, event, cfg) -> { state, emit, reject }
   The pure reducer. On a valid event: emit the normalized typed event and
   advance state. On an invalid event: emit null, record the rejection, and DO
   NOT advance the fold into a corrupt place. The whole log is folded by reduce. */
function route(state, event, cfg) {
  var v = validate(state, event, cfg);
  if (!v.ok) {
    // A rejected event does not advance nextSeq/lastTick — the fold's integrity
    // point is preserved. reject carries the offending seq when it was an int.
    var seq = isInt(event && event.seq) ? event.seq : null;
    return { state: state, emit: null, reject: { seq: seq, reason: v.reason } };
  }
  // Build the normalized typed event WITHOUT trusting the raw object's prototype
  // or extra keys: copy only the four envelope fields onto a null-proto object,
  // so a hostile __proto__/constructor payload key cannot pollute anything.
  var payloadCopy = Object.create(null);
  var keys = Object.keys(event.payload);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    payloadCopy[k] = event.payload[k];
  }
  var emit = { seq: event.seq, t: event.t, type: event.type, payload: payloadCopy };
  var next = { nextSeq: state.nextSeq + 1, lastTick: event.t, count: state.count + 1 };
  return { state: next, emit: emit, reject: null };
}

/* foldLog(events, cfg) -> { state, stream, rejections, halted }
   Folds an ordered array of raw events. reject-policy default is HALT: a hostile
   or corrupt log STOPS at the first integrity violation rather than silently
   dropping bad events and continuing into an ambiguous stream. cfg.rejectPolicy
   = "skip" is available for genuinely best-effort input. */
function foldLog(events, cfg) {
  var policy = (cfg && cfg.rejectPolicy) || "halt";
  var state = state0();
  var stream = [];
  var rejections = [];
  var halted = false;
  for (var i = 0; i < events.length; i++) {
    var r = route(state, events[i], cfg);
    if (r.reject) {
      rejections.push(r.reject);
      if (policy === "halt") { halted = true; break; }
      // skip: record the rejection, do not advance, continue to the next event.
      continue;
    }
    state = r.state;
    stream.push(r.emit);
  }
  return { state: state, stream: stream, rejections: rejections, halted: halted };
}

/* render(state) -> string. Pure state -> frame projection. An interactive gift
   is still pipe-testable headless: the frame is deterministic text, never a live
   canvas. */
function render(state) {
  return (
    "accepted=" + state.count +
    " next-seq=" + state.nextSeq +
    " last-tick=" + state.lastTick
  );
}

var API = {
  DEFAULT_ACCEPTED_TYPES: DEFAULT_ACCEPTED_TYPES,
  ACCEPTED_TYPES: DEFAULT_ACCEPTED_TYPES,
  state0: state0,
  validate: validate,
  route: route,
  foldLog: foldLog,
  render: render
};

// Browser attach.
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.inputEventRouter = API;
}

// Node require.
if (typeof module !== "undefined" && module.exports) {
  module.exports = API;
}

// CLI.
function main(argv) {
  var args = argv.slice(2);
  if (args.indexOf("--help") !== -1 || args.indexOf("-h") !== -1) {
    process.stdout.write(
      "input-event-router.js — deterministic reducer: raw input-event log -> validated typed stream.\n\n" +
      "  node input-event-router.js < events.jsonl   fold a JSONL event log -> render + summary\n" +
      "  node input-event-router.js --help\n\n" +
      "Envelope (one JSON object per line):\n" +
      "  { \"seq\": <int, monotonic +1>, \"t\": <int, non-decreasing logical tick>,\n" +
      "    \"type\": <accepted type>, \"payload\": <object> }\n\n" +
      "Edge: this normalizes and validates input events against a declared schema,\n" +
      "folding them into a deterministic typed stream. It does not sanitize\n" +
      "application semantics, does not persist, holds no clock/network/entropy, and\n" +
      "trusts no event it did not schema.\n"
    );
    return 0;
  }
  var chunks = [];
  process.stdin.on("data", function (d) { chunks.push(d); });
  process.stdin.on("end", function () {
    var text = Buffer.concat(chunks).toString("utf8");
    var lines = text.split("\n");
    var events = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.length === 0) continue;
      try {
        events.push(JSON.parse(line));
      } catch (e) {
        // A non-JSON line is itself a rejectable event: push a sentinel the
        // schema will reject as event-not-object (a string is not an object).
        events.push(line);
      }
    }
    var out = foldLog(events);
    process.stdout.write(render(out.state) + "\n");
    process.stdout.write(
      "emitted=" + out.stream.length +
      " rejected=" + out.rejections.length +
      (out.halted ? " HALTED" : "") + "\n"
    );
    for (var j = 0; j < out.rejections.length; j++) {
      var rj = out.rejections[j];
      process.stdout.write("  reject seq=" + rj.seq + " reason=" + rj.reason + "\n");
    }
  });
  return 0;
}

if (typeof require !== "undefined" && require.main === module) {
  process.exitCode = main(process.argv);
}
