#!/usr/bin/env node
/* lull.js — a dependency-free, deterministic reducer that decides when an app
   lays its tools down and when it picks them back up.

   WHY THIS EXISTS. Every app with a resting view (a game's idle camera, a
   kiosk's attract screen, a viewer's "just look" mode) re-hand-rolls the same
   three rules: rest after a while of no touching, rest on one gesture, wake on
   any touch. Hand-rolled, those rules read a wall clock (so replay breaks), fire
   in the middle of an edit (so the player is yanked away), and let the touch
   that wakes the screen also act on it (so a tap meant to wake places a
   building). This is those rules done once, as a pure fold over a typed event
   stream, with logical ticks as data.

   THE RULES (the whole contract).
     * Rest by gesture: an accepted event whose type is a declared gesture puts
       the app to rest. One event: "one gesture" is exactly one such event.
     * Rest by quiet: when a declared quiet span of logical ticks has passed
       since the last touch, the app is at rest. lull never reads a clock: the
       caller asks `at(state, t)` with a tick it supplies, or schedules its own
       check at `restsAt(state)`.
     * Wake by touch: while at rest, ANY accepted event wakes the app, and that
       waking event is CONSUMED: passThrough is false, so the app must not act
       on it. A gesture is also consumed: it is lull's, not the app's.
     * Quiet can be off: quietTicks null means the app rests only by gesture.

   THE INPUT. The typed stream input-event-router emits ({seq, t, type,
   payload}); lull reads only `t` (a non-decreasing logical tick) and `type`.
   Ordering and schema are the router's job; lull refuses an event whose tick
   goes backwards or whose type is not a string, and never looks at payload.

   USAGE
     node lull.js [--quiet N] [--gesture TYPE]... [--no-gestures] [--at T] < events.jsonl
     node lull.js --help

   Released under MIT. Its edge, printed in the README and --help: this decides
   resting and waking from a typed event stream and logical ticks; it does NOT
   draw anything, does NOT read a clock or schedule a timer, does NOT validate
   the stream's order or schema (input-event-router does), and does NOT decide
   what a consumed waking touch would have done.
*/
"use strict";

var EDGE = "lull decides resting and waking from a typed event stream and logical ticks; it does NOT draw " +
  "anything, does NOT read a clock or schedule a timer, does NOT validate the stream's order or schema " +
  "(input-event-router does), and does NOT decide what a consumed waking touch would have done.";

var DEFAULT_CONFIG = { gestures: ["rest"], quietTicks: null };

function isInt(v) {
  return typeof v === "number" && isFinite(v) && Math.floor(v) === v;
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/* checkConfig(cfg) -> { ok: true, cfg } | { ok: false, reason }
   gestures: an array of distinct non-empty strings (may be empty: rest by quiet only).
   quietTicks: null (rest by gesture only) or an integer >= 1. */
function checkConfig(cfg) {
  var c = cfg === undefined ? DEFAULT_CONFIG : cfg;
  if (!isPlainObject(c)) return { ok: false, reason: "config-not-object" };
  var g = c.gestures === undefined ? DEFAULT_CONFIG.gestures : c.gestures;
  if (!Array.isArray(g)) return { ok: false, reason: "gestures-not-list" };
  for (var i = 0; i < g.length; i++) {
    if (typeof g[i] !== "string" || g[i].length === 0) return { ok: false, reason: "gesture-not-string" };
    if (g.indexOf(g[i]) !== i) return { ok: false, reason: "gesture-repeated" };
  }
  var q = c.quietTicks === undefined ? DEFAULT_CONFIG.quietTicks : c.quietTicks;
  if (q !== null && !(isInt(q) && q >= 1)) return { ok: false, reason: "quiet-not-positive-int" };
  if (g.length === 0 && q === null) return { ok: false, reason: "no-way-to-rest" };
  return { ok: true, cfg: { gestures: g.slice(), quietTicks: q } };
}

/* state0(startTick) — the fold's first state. O(1) by contract: five fields, never a buffer.
   mode: "awake" | "resting"; since: the tick the quiet span counts from (the last touch, or the start);
   lastTick: the last tick seen (-1 before any); cause: why it rests ("gesture"), else null; count: events folded. */
function state0(startTick) {
  var s = startTick === undefined ? 0 : startTick;
  return { mode: "awake", since: isInt(s) && s >= 0 ? s : 0, lastTick: -1, cause: null, count: 0 };
}

/* at(state, t, cfg) -> { mode, cause, reject }
   Pure: the mode at logical tick t, with no event at t. A stored rest stays a rest; an awake state is at rest
   once quietTicks have passed since `since`. A tick before the last one seen is refused, never answered. */
function at(state, t, cfg) {
  var c = checkConfig(cfg);
  if (!c.ok) return { mode: null, cause: null, reject: c.reason };
  if (!isInt(t) || t < 0) return { mode: null, cause: null, reject: "tick-not-int" };
  if (t < state.lastTick) return { mode: null, cause: null, reject: "tick-decrease" };
  if (state.mode === "resting") return { mode: "resting", cause: state.cause, reject: null };
  var q = c.cfg.quietTicks;
  if (q !== null && t - state.since >= q) return { mode: "resting", cause: "quiet", reject: null };
  return { mode: "awake", cause: null, reject: null };
}

/* restsAt(state, cfg) -> the first tick at which quiet alone puts an awake state to rest, or null
   (already resting, or quiet is off). The app schedules its own check there; lull holds no timer. */
function restsAt(state, cfg) {
  var c = checkConfig(cfg);
  if (!c.ok || state.mode === "resting" || c.cfg.quietTicks === null) return null;
  return state.since + c.cfg.quietTicks;
}

/* step(state, event, cfg) -> { state, emit, reject }
   The pure reducer. emit = { t, was, mode, cause, passThrough }: passThrough is true only for an ordinary touch
   while awake; a gesture and a waking touch are consumed. A refused event leaves the state exactly as it was. */
function step(state, event, cfg) {
  var c = checkConfig(cfg);
  if (!c.ok) return { state: state, emit: null, reject: { reason: c.reason } };
  if (!isPlainObject(event)) return { state: state, emit: null, reject: { reason: "event-not-object" } };
  if (typeof event.type !== "string" || event.type.length === 0) {
    return { state: state, emit: null, reject: { reason: "type-not-string" } };
  }
  var now = at(state, event.t, c.cfg);
  if (now.reject) return { state: state, emit: null, reject: { reason: now.reject } };
  var t = event.t;
  var next, emit;
  if (now.mode === "resting") {
    next = { mode: "awake", since: t, lastTick: t, cause: null, count: state.count + 1 };
    emit = { t: t, was: "resting", mode: "awake", cause: null, passThrough: false };
  } else if (c.cfg.gestures.indexOf(event.type) !== -1) {
    next = { mode: "resting", since: t, lastTick: t, cause: "gesture", count: state.count + 1 };
    emit = { t: t, was: "awake", mode: "resting", cause: "gesture", passThrough: false };
  } else {
    next = { mode: "awake", since: t, lastTick: t, cause: null, count: state.count + 1 };
    emit = { t: t, was: "awake", mode: "awake", cause: null, passThrough: true };
  }
  return { state: next, emit: emit, reject: null };
}

/* foldLog(events, cfg, startTick) -> { state, emits, reject } — folds in order, halting at the first refusal. */
function foldLog(events, cfg, startTick) {
  var s = state0(startTick);
  var emits = [];
  for (var i = 0; i < events.length; i++) {
    var r = step(s, events[i], cfg);
    if (r.reject) return { state: s, emits: emits, reject: { index: i, reason: r.reject.reason } };
    s = r.state;
    emits.push(r.emit);
  }
  return { state: s, emits: emits, reject: null };
}

/* render(state) -> a deterministic one-line text frame (the headless surface). */
function render(state) {
  return "lull mode=" + state.mode + " cause=" + (state.cause === null ? "-" : state.cause) +
    " since=" + state.since + " last=" + state.lastTick + " count=" + state.count;
}

var api = { step: step, at: at, restsAt: restsAt, foldLog: foldLog, render: render, state0: state0,
  checkConfig: checkConfig, DEFAULT_CONFIG: DEFAULT_CONFIG, EDGE: EDGE };

if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.lull = api;
}

/* The CLI: fold a JSONL stream from stdin; print each emit, the final render and, with --at, the mode at T. */
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  var argv = process.argv.slice(2);
  var HELP = "usage: node lull.js [--quiet N] [--gesture TYPE]... [--no-gestures] [--at T] < events.jsonl\n" +
    "  folds a typed event stream (input-event-router's output: one {seq,t,type,payload} per line)\n" +
    "  --quiet N     rest after N logical ticks with no event (default: off)\n" +
    "  --gesture T   an event type that puts the app to rest (repeatable; default: rest)\n" +
    "  --no-gestures rest by quiet only (needs --quiet)\n" +
    "  --at T        after the fold, print the mode at logical tick T\n" +
    "  prints one JSON emit per event, then the render; refusals print 'refused <index> <reason>'\n" +
    "  exit 0 folded · 3 refused · 2 usage\n\n" + EDGE + "\n";
  var gestures = [], quiet = null, atT = null, bad = null, none = false;
  for (var a = 0; a < argv.length; a++) {
    if (argv[a] === "--help" || argv[a] === "-h") { process.stdout.write(HELP); process.exit(0); }
    else if (argv[a] === "--quiet") { quiet = Number(argv[++a]); }
    else if (argv[a] === "--gesture") { gestures.push(String(argv[++a])); }
    else if (argv[a] === "--no-gestures") { none = true; }
    else if (argv[a] === "--at") { atT = Number(argv[++a]); }
    else { bad = argv[a]; }
  }
  if (bad !== null) { process.stderr.write("lull: unknown argument " + bad + "\n" + HELP); process.exit(2); }
  if (none && gestures.length) { process.stderr.write("lull: --no-gestures and --gesture together\n" + HELP); process.exit(2); }
  var cfg = { gestures: none ? [] : (gestures.length ? gestures : DEFAULT_CONFIG.gestures), quietTicks: quiet };
  var cc = checkConfig(cfg);
  if (!cc.ok) { process.stderr.write("lull: config refused: " + cc.reason + "\n"); process.exit(2); }
  var chunks = [];
  process.stdin.on("data", function (d) { chunks.push(d); });
  process.stdin.on("end", function () {
    var lines = Buffer.concat(chunks).toString("utf8").split("\n").filter(function (l) { return l.trim() !== ""; });
    var events = [];
    for (var i = 0; i < lines.length; i++) {
      try { events.push(JSON.parse(lines[i])); } catch (e) { events.push(null); }
    }
    var r = foldLog(events, cfg);
    for (var j = 0; j < r.emits.length; j++) process.stdout.write(JSON.stringify(r.emits[j]) + "\n");
    process.stdout.write(render(r.state) + "\n");
    if (r.reject) { process.stdout.write("refused " + r.reject.index + " " + r.reject.reason + "\n"); process.exit(3); }
    if (atT !== null) {
      var m = at(r.state, atT, cfg);
      if (m.reject) { process.stdout.write("refused at " + m.reject + "\n"); process.exit(3); }
      process.stdout.write("at " + atT + " mode=" + m.mode + " cause=" + (m.cause === null ? "-" : m.cause) + "\n");
    }
    process.exit(0);
  });
}
