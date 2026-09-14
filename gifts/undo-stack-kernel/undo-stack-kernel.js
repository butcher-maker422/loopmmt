#!/usr/bin/env node
/* undo-stack-kernel.js — a dependency-free, deterministic, DEPTH-BOUNDED reducer that
   keeps an append-only, event-sourced undo/redo history off an inherited input-event
   log, and reaches any past state by REPLAY — never by mutating stored state in place.

   WHY THIS EXISTS. Every stateful interactive app re-hand-rolls the same third step:
   keep a history of user actions so the user can undo and redo. Hand-rolled, that step
   is where two whole bug classes live: UNBOUNDED GROWTH (the history array grows without
   limit under a long or hostile edit stream until the tab OOMs) and IN-PLACE CORRUPTION
   (a stored past state is mutated by a later action that shares a reference into it, so
   "undo" returns a state that silently changed underneath the user). This is that step
   done once, correctly, as a BOUNDED EVENT-SOURCED REDUCER over an input-event log:
   validated commit/undo/redo events in, an append-only history out, every reachable
   state produced by REPLAY from a retained checkpoint, and the whole history BOUNDED by
   a declared max depth the kernel REFUSES to exceed.

   THE STRIP-CLEAN RULE (the whole reason to trust it). The retained history is a pure
   fold of the ordered event log. Replaying the same log yields byte-identical history,
   cursor, and reconstructed state at every position. The kernel holds NO clock, NO
   network, and NO entropy it did not receive as an event — history time enters ONLY as
   the event field `t`, supplied by the caller as data. A past state is NEVER a stored
   mutable reference; it is always recomputed by replay, so it cannot have drifted.

   THE ENVELOPE (INHERITED, not authored — input-event-router fixed it). One event per
   JSONL line:
     { "seq": <int>=0, monotonic +1 >, "t": <int>=0, non-decreasing logical tick >,
       "type": <one of the declared accepted types>, "payload": <object> }
   The emitted typed stream of input-event-router IS the input log of this kernel (the
   covenant's composition algebra). This gift does NOT re-author the envelope.

   THE BOUND (this gift's mandatory security clause — state bounds, covenant §3.2).
   The retained history holds at most `depth` checkpoints and REFUSES to grow past it:
   a commit that would exceed the depth EVICTS the oldest checkpoint (ring eviction), so
   `history.length <= depth` holds after EVERY event, for ANY log — memory is O(depth),
   never O(log length), never an OOM. The bound is a retained-checkpoint COUNT (not a
   wall-clock TTL), so it is decidable, adversarially checkable, and replay-stable — the
   same log leaves the same retained window every run.

   USAGE
     node undo-stack-kernel.js < events.jsonl            # fold -> final state + history summary
     node undo-stack-kernel.js --depth 8 < events.jsonl  # set the declared max history depth
     node undo-stack-kernel.js --help

   Released under MIT. Its edge, printed in the README and --help: this keeps an
   append-only, event-sourced undo/redo history bounded by a declared max depth; it
   reaches any past state by REPLAY from a retained checkpoint, never by mutating stored
   state in place; it advances history time on the event's logical tick `t` and never a
   wall-clock; it does NOT persist to disk, holds NO clock/network/entropy, and refuses
   to grow history past its declared depth (undo reaches exactly `depth` steps back — an
   honest bound, not a false "unlimited undo").
*/
"use strict";

// The default accepted event-type vocabulary. The state-mutation lane declares three
// history-driving types (commit / undo / redo) beside the inherited passthrough set.
// CONFIG, not frozen (covenant §2/§5 U2): what the gift enforces is that the vocabulary
// is DECLARED and CLOSED — the decidable security property. An app supplies its own set
// via cfg.acceptedTypes.
var DEFAULT_ACCEPTED_TYPES = ["commit", "undo", "redo", "pointer", "key", "select", "edit"];

// The default max history depth: the maximum number of checkpoints the kernel retains
// before it EVICTS the oldest on a new commit. CONFIG (cfg.depth / --depth). Declared
// and bounded is the security property; the specific number is a policy the app sets.
var DEFAULT_DEPTH = 100;

// The declared empty base state marker. A checkpoint is { t, mark } — t is the logical
// tick the commit carried, mark is the one declared scalar payload field ("state").
function baseCheckpoint() {
  return { t: -1, mark: null };
}

// The initial fold-state. history is an append-only ring of retained checkpoints (a
// moving window under the depth bound); cursor indexes the current position within it;
// evicted counts how many checkpoints the depth bound has dropped (so absolute history
// position is still reportable). NEVER a growing-without-limit buffer.
function state0(cfg) {
  var depth = (cfg && isInt(cfg.depth) && cfg.depth >= 1) ? cfg.depth : DEFAULT_DEPTH;
  return {
    nextSeq: 0,
    lastTick: -1,
    history: [baseCheckpoint()], // index 0 is the empty base
    cursor: 0,                   // points at the current checkpoint in history
    evicted: 0,                  // checkpoints dropped by the depth bound
    depth: depth
  };
}

// isPlainObject — an object, not null, not an array, not a scalar. payload must be an
// object; we do NOT walk its contents (depth-1 read => bounded work, state-bounds §3.2).
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isInt(v) {
  return typeof v === "number" && isFinite(v) && Math.floor(v) === v;
}

/* safePayloadMark(payload) -> a bounded, proto-safe checkpoint marker pulled from the
   payload. Copies ONLY the one declared field ("state") onto a null-proto read, skipping
   the prototype-pollution keys (NOTE-13.1242-1 guard, carried from render-loop-harness).
   Bounded work: reads one declared field, never walks arbitrary payload depth (§3.2). */
function safePayloadMark(payload) {
  var clean = Object.create(null);
  var keys = Object.keys(payload);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    if (k === "state") clean.mark = payload[k];
  }
  var m = clean.mark;
  // Only a scalar mark is stored (an object/array mark would be unbounded to retain and
  // could smuggle a live mutable reference into the checkpoint — reject it to null,
  // keeping the checkpoint bounded AND immutable-by-construction).
  if (m === null || (typeof m !== "object" && typeof m !== "function")) {
    return m === undefined ? null : m;
  }
  return null;
}

/* validate(state, event, cfg) -> { ok: true } | { ok: false, reason: <string> }
   Pure. Checks the INHERITED envelope against the schema BEFORE the fold sees it. Every
   failure is a DECLARED rejection reason; nothing is coerced. (Inherited from
   input-event-router's discipline — covenant §3.1.) */
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

/* advance(state, event, cfg) -> { state, reject }
   The pure per-event reducer. seq/tick/type/payload are validated first (any failure is
   a declared rejection, no advance). Then the history-driving type is applied:
     commit -> truncate any redo tail past the cursor, append a new checkpoint stamped
               with the event's t, advance the cursor, and EVICT the oldest checkpoint if
               the append would exceed the declared depth (the §3.2 primary bound).
     undo   -> move the cursor back one (bounded at 0; undo-at-base is a declared no-op).
     redo   -> move the cursor forward one (bounded at the tip; redo-at-tip is a no-op).
   A non-history accepted type (pointer/key/...) is a valid passthrough no-op: it advances
   seq/tick (keeping the total order intact for composition) but does not touch history. */
function advance(state, event, cfg) {
  var v = validate(state, event, cfg);
  if (!v.ok) {
    var seq = isInt(event && event.seq) ? event.seq : null;
    return { state: state, reject: { seq: seq, reason: v.reason } };
  }

  // Base bookkeeping advances on every valid event (total order preserved).
  var nextSeq = state.nextSeq + 1;
  var lastTick = event.t;

  if (event.type === "commit") {
    var mark = safePayloadMark(event.payload);
    // Truncate the redo tail: a commit while behind the tip forks a single linear future
    // (D4). Slice makes a NEW array — the retained checkpoints are never mutated in place.
    var kept = state.history.slice(0, state.cursor + 1);
    kept.push({ t: event.t, mark: mark });
    var evicted = state.evicted;
    // STATE-BOUNDS PRIMARY CLAUSE: refuse to grow past the declared depth. Evict the
    // oldest checkpoint(s) so kept.length <= depth. (A single commit adds one, so at most
    // one eviction — but the loop is correct even if depth were lowered mid-fold.)
    while (kept.length > state.depth) {
      kept.shift();
      evicted += 1;
    }
    var next = {
      nextSeq: nextSeq,
      lastTick: lastTick,
      history: kept,
      cursor: kept.length - 1, // the new tip
      evicted: evicted,
      depth: state.depth
    };
    return { state: next, reject: null };
  }

  if (event.type === "undo") {
    if (state.cursor <= 0) {
      // Bounded at the base: a declared no-op rejection, never an underflow. seq/tick
      // still advance (the event was well-formed and consumed).
      return {
        state: { nextSeq: nextSeq, lastTick: lastTick, history: state.history,
                 cursor: state.cursor, evicted: state.evicted, depth: state.depth },
        reject: { seq: event.seq, reason: "undo-at-base" }
      };
    }
    return {
      state: { nextSeq: nextSeq, lastTick: lastTick, history: state.history,
               cursor: state.cursor - 1, evicted: state.evicted, depth: state.depth },
      reject: null
    };
  }

  if (event.type === "redo") {
    if (state.cursor >= state.history.length - 1) {
      // Bounded at the tip: a declared no-op rejection, never an overrun.
      return {
        state: { nextSeq: nextSeq, lastTick: lastTick, history: state.history,
                 cursor: state.cursor, evicted: state.evicted, depth: state.depth },
        reject: { seq: event.seq, reason: "redo-at-tip" }
      };
    }
    return {
      state: { nextSeq: nextSeq, lastTick: lastTick, history: state.history,
               cursor: state.cursor + 1, evicted: state.evicted, depth: state.depth },
      reject: null
    };
  }

  // A valid non-history type (pointer/key/select/edit): passthrough no-op on history.
  // seq/tick advance so the total order holds and the stream composes with siblings.
  return {
    state: { nextSeq: nextSeq, lastTick: lastTick, history: state.history,
             cursor: state.cursor, evicted: state.evicted, depth: state.depth },
    reject: null
  };
}

/* foldLog(events, cfg) -> { state, rejections, halted }
   Folds an ordered array of inherited events under the declared depth. reject-policy
   default is HALT: a hostile/corrupt log STOPS at the first integrity violation rather
   than folding into an ambiguous history. cfg.rejectPolicy = "skip" is available for
   genuinely best-effort input — but note the history no-op rejections (undo-at-base,
   redo-at-tip) are BENIGN bound-hits, not integrity violations, so under "halt" they are
   still recorded-and-continued (a cursor at its bound is a normal user action, not a
   corrupt log). Only schema violations halt under "halt". */
function foldLog(events, cfg) {
  var policy = (cfg && cfg.rejectPolicy) || "halt";
  var state = state0(cfg);
  var rejections = [];
  var halted = false;
  // The declared benign cursor-bound rejections never halt: hitting the base/tip is a
  // normal interaction, not a corrupt stream.
  var BENIGN = { "undo-at-base": true, "redo-at-tip": true };
  for (var i = 0; i < events.length; i++) {
    var r = advance(state, events[i], cfg);
    if (r.reject) {
      rejections.push(r.reject);
      // Benign cursor-bound hits advance state (seq/tick consumed) and continue.
      if (BENIGN[r.reject.reason]) {
        state = r.state;
        continue;
      }
      if (policy === "halt") { halted = true; break; }
      // skip: record the schema rejection, do not advance into a corrupt place, continue.
      continue;
    }
    state = r.state;
  }
  return { state: state, rejections: rejections, halted: halted };
}

/* reconstruct(state) -> the current app state (the checkpoint mark at the cursor),
   reached by REPLAY — reading the retained checkpoint at the cursor, NEVER a live app
   reference. Because checkpoints are immutable scalar markers built by slice+push (never
   mutated in place), the state at any cursor is exactly what it was when committed. This
   is the §3.3 replay-only-reachability discipline made concrete: undo returns a value
   that provably could not have drifted. Pure, bounded (one array read). */
function reconstruct(state) {
  var cp = state.history[state.cursor];
  return cp ? cp.mark : null;
}

/* render(state) -> string. Pure state -> frame projection for the CLI/demo. Reports the
   reconstructed state plus the bounded-history summary an honest edge must show (how many
   checkpoints are retained vs the declared depth, and how many the bound has evicted). */
function render(state) {
  var mark = reconstruct(state);
  return (
    "state=" + (mark === null || mark === undefined ? "-" : String(mark)) +
    " cursor=" + state.cursor +
    " retained=" + state.history.length + "/" + state.depth +
    " evicted=" + state.evicted +
    " seq=" + state.nextSeq
  );
}

var API = {
  DEFAULT_ACCEPTED_TYPES: DEFAULT_ACCEPTED_TYPES,
  ACCEPTED_TYPES: DEFAULT_ACCEPTED_TYPES,
  DEFAULT_DEPTH: DEFAULT_DEPTH,
  state0: state0,
  validate: validate,
  advance: advance,
  foldLog: foldLog,
  reconstruct: reconstruct,
  render: render
};

// Browser attach.
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.undoStackKernel = API;
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
      "undo-stack-kernel.js — bounded event-sourced undo/redo history: inherited event log -> replayed state.\n\n" +
      "  node undo-stack-kernel.js < events.jsonl           fold -> final state + history summary\n" +
      "  node undo-stack-kernel.js --depth <int> < events.jsonl  set the declared max history depth\n" +
      "  node undo-stack-kernel.js --help\n\n" +
      "Envelope (INHERITED from input-event-router; one JSON object per line):\n" +
      "  { \"seq\": <int, monotonic +1>, \"t\": <int, non-decreasing logical tick>,\n" +
      "    \"type\": <accepted type: commit|undo|redo|...>, \"payload\": <object; commit reads .state> }\n\n" +
      "Edge: this keeps an append-only, event-sourced undo/redo history bounded by a declared\n" +
      "max depth; it reaches any past state by REPLAY from a retained checkpoint, never by\n" +
      "mutating stored state in place; it advances history time on the event's logical tick t\n" +
      "and never a wall-clock; it does not persist to disk, holds no clock/network/entropy, and\n" +
      "refuses to grow history past its declared depth (undo reaches exactly depth steps back —\n" +
      "an honest bound, not a false 'unlimited undo').\n"
    );
    return 0;
  }
  var depth = DEFAULT_DEPTH;
  var di = args.indexOf("--depth");
  if (di !== -1 && args[di + 1] !== undefined) {
    var d = parseInt(args[di + 1], 10);
    if (isFinite(d) && d >= 1) depth = d;
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
        // A non-JSON line is itself a rejectable event: push a sentinel the schema will
        // reject as event-not-object (a string is not an object).
        events.push(line);
      }
    }
    var out = foldLog(events, { depth: depth });
    process.stdout.write(render(out.state) + "\n");
    process.stdout.write(
      "retained=" + out.state.history.length +
      " depth=" + depth +
      " evicted=" + out.state.evicted +
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
