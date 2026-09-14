#!/usr/bin/env node
/* render-loop-harness.js — a dependency-free, deterministic, BOUNDED reducer that
   drives a pure state -> frame render loop off an inherited input-event log.

   WHY THIS EXISTS. Every interactive app with a live view re-hand-rolls the same
   second step: take a stream of validated events and drive a state -> frame
   render loop off them. Hand-rolled, that step is where the resource-exhaustion
   bugs live — a requestAnimationFrame busy-spin with no budget, a loop that reads
   Date.now() to pace itself (which breaks replay the moment it ships), a frame
   function that is not pure so the same log renders differently on replay. This is
   that step done once, correctly, as a BOUNDED DETERMINISTIC REDUCER over an
   input-event log: validated events in, a sequence of pure frames out, advanced on
   each event's LOGICAL tick `t`, and bounded by a declared per-fold tick budget the
   harness REFUSES to exceed.

   THE STRIP-CLEAN RULE (the whole reason to trust it). state_t is a pure fold of
   state_0 and the ordered event log up to t. Replaying the same log yields
   byte-identical state, frame sequence, and render. The harness holds NO clock, NO
   network, and NO entropy it did not receive as an event — the render clock enters
   ONLY as the event field `t`, supplied by the caller as data. So the same log
   replays identically forever, in a browser or headless on Node.

   THE ENVELOPE (INHERITED, not authored — input-event-router fixed it). One event
   per JSONL line:
     { "seq": <int>=0, monotonic +1 >, "t": <int>=0, non-decreasing logical tick >,
       "type": <one of the declared accepted types>, "payload": <object> }
   The emitted typed stream of input-event-router IS the input log of this harness
   (the covenant's composition algebra). This gift does NOT re-author the envelope;
   it folds the validated stream its sibling emits.

   THE BOUND (this gift's mandatory security clause — resource bounds, covenant §3.3).
   The fold produces at most `budget` frames and REFUSES to exceed it: a log longer
   than the budget HALTS at exactly `budget` frames with reject-reason
   "tick-budget-exceeded", never a busy-spin, never an OOM. The bound is a
   frame-COUNT per fold (not a wall-clock rate), so it is decidable, adversarially
   checkable, and replay-stable — the same log halts at the same frame every run.

   USAGE
     node render-loop-harness.js < events.jsonl              # fold -> final frame + summary
     node render-loop-harness.js --budget 500 < events.jsonl # set the per-fold tick budget
     node render-loop-harness.js --help

   Released under MIT. Its edge, printed in the README and --help: this drives a pure
   state -> frame render loop off an inherited event log, advancing on the event's
   logical tick `t` and never a wall-clock; it refuses to exceed its declared per-fold
   tick budget; it does NOT render pixels (the frame is deterministic text), it does
   NOT persist, it holds NO clock/network/entropy, and it schedules nothing it cannot
   bound. (Retaining event history is the undo-stack-kernel's job, under its own
   declared bound — this harness keeps a bounded, fixed-shape render view.)
*/
"use strict";

// The default accepted event-type vocabulary (INHERITED shape; the render lane adds
// a render-driving `tick` type). CONFIG, not frozen (covenant §2/§5 U2): what the
// gift enforces is that the vocabulary is DECLARED and CLOSED — the decidable
// security property. An app supplies its own set via cfg.acceptedTypes.
var DEFAULT_ACCEPTED_TYPES = ["tick", "pointer", "key", "select", "edit", "commit"];

// The default per-fold tick budget: the maximum number of frames a single fold will
// produce before it REFUSES to continue. CONFIG (cfg.budget / --budget). Declared and
// bounded is the security property; the specific number is a policy the app sets.
var DEFAULT_BUDGET = 1000;

// The initial fold-state. Bounded, fixed-shape by contract: five scalars + a
// bounded declared-shape `view` (NEVER a growing history buffer — that is the
// undo-stack-kernel's job under its own bound).
function state0() {
  return { nextSeq: 0, lastTick: -1, frameCount: 0, tickBudgetSpent: 0, view: view0() };
}

// The render view: a small, fixed-shape accumulator the frame renders. Declared
// shape, bounded size — it does not grow with the log. Here: a running fold of the
// render-relevant fields (a count of applied ticks and the last applied payload
// marker), enough to prove a pure state -> frame projection without pretending to
// paint pixels (Real-or-Made: the frame is honest text).
function view0() {
  return { applied: 0, lastType: null, lastMark: null };
}

// isPlainObject — an object, not null, not an array, not a scalar. payload must be
// an object; we do NOT walk its contents (depth-1 check => bounded work,
// resource-bounds clause §3.3).
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isInt(v) {
  return typeof v === "number" && isFinite(v) && Math.floor(v) === v;
}

/* validate(state, event, cfg) -> { ok: true } | { ok: false, reason: <string> }
   Pure. Checks the INHERITED envelope against the schema BEFORE the fold sees it.
   Every failure is a DECLARED rejection reason; nothing is coerced. (Inherited from
   input-event-router's discipline — §3.3 clause 2.) */
function validate(state, event, cfg) {
  var accepted = (cfg && cfg.acceptedTypes) || DEFAULT_ACCEPTED_TYPES;

  if (!isPlainObject(event)) return { ok: false, reason: "event-not-object" };

  // seq: present, int >= 0, exactly the next expected (total order, no gap/repeat).
  if (!isInt(event.seq) || event.seq < 0) return { ok: false, reason: "seq-not-int" };
  if (event.seq < state.nextSeq) return { ok: false, reason: "seq-repeat" };
  if (event.seq > state.nextSeq) return { ok: false, reason: "seq-gap" };

  // t: present, int >= 0, non-decreasing (LOGICAL tick as data; never a clock).
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

// safePayloadMark(payload) -> a bounded, proto-safe render marker pulled from the
// payload. Copies ONLY the one declared render-relevant field ("mark") onto a
// null-proto read, skipping the prototype-pollution keys (NOTE-13.1242-1 guard,
// carried from input-event-router). Bounded work: reads one declared field, never
// walks arbitrary payload depth (resource-bounds clause §3.3).
function safePayloadMark(payload) {
  // A hostile __proto__/constructor/prototype key must not reach anything. We read a
  // single declared field via a null-proto copy so a malicious key cannot pollute
  // Object.prototype and cannot be mistaken for the field we want.
  var clean = Object.create(null);
  var keys = Object.keys(payload);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    if (k === "mark") clean.mark = payload[k];
  }
  var m = clean.mark;
  // Only a scalar mark is rendered (an object/array mark would be unbounded to
  // stringify — reject it to null, keeping the frame bounded).
  if (m === null || (typeof m !== "object" && typeof m !== "function")) return m === undefined ? null : m;
  return null;
}

/* advance(state, event, cfg) -> { state, frame, reject }
   The pure per-tick reducer. On a valid event, IF spending a tick would not exceed
   the declared budget: fold the event into `view`, spend one budget unit, and
   produce a pure frame. If spending would exceed the budget: HALT with
   "tick-budget-exceeded" (the harness REFUSES to run past its declared bound —
   the §3 clause-1 decidable check). On an invalid event: reject, do not advance
   into a corrupt place. */
function advance(state, event, cfg) {
  var budget = (cfg && isInt(cfg.budget)) ? cfg.budget : DEFAULT_BUDGET;

  var v = validate(state, event, cfg);
  if (!v.ok) {
    var seq = isInt(event && event.seq) ? event.seq : null;
    return { state: state, frame: null, reject: { seq: seq, reason: v.reason } };
  }

  // RESOURCE BOUND (primary clause): refuse to exceed the declared budget. If this
  // frame would be the (budget+1)-th, HALT rather than produce it.
  if (state.tickBudgetSpent >= budget) {
    return { state: state, frame: null, reject: { seq: event.seq, reason: "tick-budget-exceeded" } };
  }

  // Fold the event into the bounded render view (pure). Reads only declared,
  // proto-safe, bounded fields.
  var mark = safePayloadMark(event.payload);
  var nextView = { applied: state.view.applied + 1, lastType: event.type, lastMark: mark };
  var next = {
    nextSeq: state.nextSeq + 1,
    lastTick: event.t,
    frameCount: state.frameCount + 1,
    tickBudgetSpent: state.tickBudgetSpent + 1,
    view: nextView
  };
  var frame = render(next);
  return { state: next, frame: frame, reject: null };
}

/* foldLoop(events, cfg) -> { state, frames, rejections, halted }
   Folds an ordered array of inherited events under the tick budget. reject-policy
   default is HALT: a hostile/corrupt log (INCLUDING one that exceeds the budget)
   STOPS at the first violation rather than folding into an ambiguous frame
   sequence. cfg.rejectPolicy = "skip" is available for genuinely best-effort input
   (but a tick-budget-exceeded is ALWAYS a halt — a bound is not skippable). */
function foldLoop(events, cfg) {
  var policy = (cfg && cfg.rejectPolicy) || "halt";
  var state = state0();
  var frames = [];
  var rejections = [];
  var halted = false;
  for (var i = 0; i < events.length; i++) {
    var r = advance(state, events[i], cfg);
    if (r.reject) {
      rejections.push(r.reject);
      // The budget bound is never skippable — exceeding it always halts.
      if (r.reject.reason === "tick-budget-exceeded" || policy === "halt") {
        halted = true;
        break;
      }
      // skip: record the rejection, do not advance, continue to the next event.
      continue;
    }
    state = r.state;
    frames.push(r.frame);
  }
  return { state: state, frames: frames, rejections: rejections, halted: halted };
}

/* render(state) -> string. Pure state -> frame projection. An interactive gift is
   still pipe-testable headless: the frame is deterministic TEXT, never a live
   canvas (Real-or-Made: this does not pretend to paint pixels). */
function render(state) {
  return (
    "frame#" + state.frameCount +
    " t=" + state.lastTick +
    " applied=" + state.view.applied +
    " type=" + (state.view.lastType === null ? "-" : state.view.lastType) +
    " mark=" + (state.view.lastMark === null || state.view.lastMark === undefined ? "-" : String(state.view.lastMark))
  );
}

var API = {
  DEFAULT_ACCEPTED_TYPES: DEFAULT_ACCEPTED_TYPES,
  ACCEPTED_TYPES: DEFAULT_ACCEPTED_TYPES,
  DEFAULT_BUDGET: DEFAULT_BUDGET,
  state0: state0,
  validate: validate,
  advance: advance,
  foldLoop: foldLoop,
  render: render
};

// Browser attach.
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.renderLoopHarness = API;
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
      "render-loop-harness.js — bounded deterministic reducer: inherited event log -> pure frame sequence.\n\n" +
      "  node render-loop-harness.js < events.jsonl              fold -> final frame + summary\n" +
      "  node render-loop-harness.js --budget <int> < events.jsonl  set the per-fold tick budget\n" +
      "  node render-loop-harness.js --help\n\n" +
      "Envelope (INHERITED from input-event-router; one JSON object per line):\n" +
      "  { \"seq\": <int, monotonic +1>, \"t\": <int, non-decreasing logical tick>,\n" +
      "    \"type\": <accepted type>, \"payload\": <object> }\n\n" +
      "Edge: this drives a pure state -> frame render loop off an inherited event log,\n" +
      "advancing on the event's logical tick t and never a wall-clock; it refuses to\n" +
      "exceed its declared per-fold tick budget; it does not render pixels (the frame is\n" +
      "deterministic text), does not persist, holds no clock/network/entropy, and\n" +
      "schedules nothing it cannot bound.\n"
    );
    return 0;
  }
  var budget = DEFAULT_BUDGET;
  var bi = args.indexOf("--budget");
  if (bi !== -1 && args[bi + 1] !== undefined) {
    var b = parseInt(args[bi + 1], 10);
    if (isFinite(b) && b >= 0) budget = b;
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
        // A non-JSON line is itself a rejectable event: push a sentinel the schema
        // will reject as event-not-object (a string is not an object).
        events.push(line);
      }
    }
    var out = foldLoop(events, { budget: budget });
    process.stdout.write((out.frames.length ? out.frames[out.frames.length - 1] : "frame#0 (no frames)") + "\n");
    process.stdout.write(
      "frames=" + out.frames.length +
      " budget=" + budget +
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
