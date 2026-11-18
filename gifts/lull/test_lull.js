#!/usr/bin/env node
/* test_lull.js — the battery for the lull gift. stdlib only (node:assert).
   Every expected state and emit below was written out BY HAND from the rules in lull.js's header, before the gift
   was run (the out-of-band oracle); the gift is never asked to grade itself.
   Run: node test_lull.js   (exit 0 all pass · 1 a failure) */
"use strict";
var assert = require("node:assert");
var path = require("node:path");
var child = require("node:child_process");
var L = require(path.join(__dirname, "lull.js"));

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; process.stdout.write("FAIL " + name + "\n  " + e.message + "\n"); }
}
function ev(t, type) { return { seq: 0, t: t, type: type, payload: {} }; }
var PLAT = { gestures: ["rest"], quietTicks: 60 };

// ---- 1. the golden log, by hand ---------------------------------------------------------------------------------
// quiet 60, gesture "rest". Ticks: 5 key (touch) · 40 pointer (touch) · 150 key (quiet rest since 40+60=100: wakes,
// consumed) · 151 rest (gesture: rests) · 152 pointer (wakes, consumed) · 153 key (touch, passes).
var GOLD = [ev(5, "key"), ev(40, "pointer"), ev(150, "key"), ev(151, "rest"), ev(152, "pointer"), ev(153, "key")];
var GOLD_EMITS = [
  { t: 5, was: "awake", mode: "awake", cause: null, passThrough: true },
  { t: 40, was: "awake", mode: "awake", cause: null, passThrough: true },
  { t: 150, was: "resting", mode: "awake", cause: null, passThrough: false },
  { t: 151, was: "awake", mode: "resting", cause: "gesture", passThrough: false },
  { t: 152, was: "resting", mode: "awake", cause: null, passThrough: false },
  { t: 153, was: "awake", mode: "awake", cause: null, passThrough: true }];
var GOLD_STATE = { mode: "awake", since: 153, lastTick: 153, cause: null, count: 6 };

test("golden log folds to the hand-written emits and state", function () {
  var r = L.foldLog(GOLD, PLAT);
  assert.strictEqual(r.reject, null);
  assert.deepStrictEqual(r.emits, GOLD_EMITS);
  assert.deepStrictEqual(r.state, GOLD_STATE);
});

test("the mutation bite: a wrong expected state is caught", function () {
  var wrong = Object.assign({}, GOLD_STATE, { count: 5 });
  assert.throws(function () { assert.deepStrictEqual(L.foldLog(GOLD, PLAT).state, wrong); });
});

// ---- 2. quiet, read at a tick (no event) -------------------------------------------------------------------------
test("quiet: awake one tick before the span, resting at it", function () {
  var s = L.foldLog([ev(10, "key")], PLAT).state;
  assert.deepStrictEqual(L.at(s, 69, PLAT), { mode: "awake", cause: null, reject: null });
  assert.deepStrictEqual(L.at(s, 70, PLAT), { mode: "resting", cause: "quiet", reject: null });
  assert.strictEqual(L.restsAt(s, PLAT), 70);
});

test("quiet counts from the start tick before any event", function () {
  assert.deepStrictEqual(L.at(L.state0(0), 60, PLAT).mode, "resting");
  assert.deepStrictEqual(L.at(L.state0(20), 60, PLAT).mode, "awake");
  assert.strictEqual(L.restsAt(L.state0(20), PLAT), 80);
});

test("quiet off: never rests by time, only by gesture", function () {
  var cfg = { gestures: ["rest"], quietTicks: null };
  var s = L.foldLog([ev(1, "key")], cfg).state;
  assert.strictEqual(L.at(s, 1e9, cfg).mode, "awake");
  assert.strictEqual(L.restsAt(s, cfg), null);
  assert.strictEqual(L.foldLog([ev(1, "key"), ev(2, "rest")], cfg).state.mode, "resting");
});

test("a stored rest has no quiet tick to wait for", function () {
  var s = L.foldLog([ev(1, "rest")], PLAT).state;
  assert.strictEqual(L.restsAt(s, PLAT), null);
  assert.deepStrictEqual(L.at(s, 1, PLAT), { mode: "resting", cause: "gesture", reject: null });
});

// ---- 3. the porch's guarantees ----------------------------------------------------------------------------------
test("one gesture: from every awake state, one gesture event rests", function () {
  var logs = [[], [ev(3, "key")], [ev(3, "rest"), ev(4, "key")], [ev(3, "key"), ev(500, "pointer")]];
  logs.forEach(function (log) {
    var s = L.foldLog(log, PLAT).state;
    var t = Math.max(s.lastTick, 0);
    if (L.at(s, t, PLAT).mode !== "awake") return;
    var r = L.step(s, ev(t, "rest"), PLAT);
    assert.strictEqual(r.state.mode, "resting");
    assert.strictEqual(r.emit.cause, "gesture");
  });
});

test("a waking touch is consumed, whatever its type", function () {
  ["key", "pointer", "commit", "rest"].forEach(function (type) {
    var s = L.foldLog([ev(1, "rest")], PLAT).state;
    var r = L.step(s, ev(2, type), PLAT);
    assert.strictEqual(r.emit.passThrough, false, type);
    assert.strictEqual(r.state.mode, "awake", type);
  });
});

test("a touch after a quiet rest wakes and is consumed (the wake is never also a place)", function () {
  var r = L.foldLog([ev(1, "key"), ev(1000, "commit")], PLAT);
  assert.deepStrictEqual(r.emits[1], { t: 1000, was: "resting", mode: "awake", cause: null, passThrough: false });
});

test("passThrough is true exactly for a non-gesture touch while awake", function () {
  var r = L.foldLog([ev(1, "key"), ev(2, "rest"), ev(3, "key"), ev(4, "key")], PLAT);
  assert.deepStrictEqual(r.emits.map(function (e) { return e.passThrough; }), [true, false, false, true]);
});

test("a touch at exactly the quiet tick finds the app at rest", function () {
  var r = L.foldLog([ev(0, "key"), ev(60, "key")], PLAT);
  assert.strictEqual(r.emits[1].was, "resting");
});

test("empty gestures: rest by quiet only", function () {
  var cfg = { gestures: [], quietTicks: 5 };
  var r = L.foldLog([ev(0, "rest"), ev(1, "key")], cfg);
  assert.deepStrictEqual(r.emits.map(function (e) { return e.passThrough; }), [true, true]);
  assert.strictEqual(L.at(r.state, 6, cfg).mode, "resting");
});

// ---- 4. hostile vectors: each refused by name, the state untouched -----------------------------------------------
test("hostile events are refused with their declared reason and change nothing", function () {
  var s = L.foldLog([ev(10, "key")], PLAT).state;
  var frozen = JSON.stringify(s);
  [[null, "event-not-object"], [[], "event-not-object"], [5, "event-not-object"],
   [{ t: 11 }, "type-not-string"], [{ t: 11, type: "" }, "type-not-string"], [{ t: 11, type: 7 }, "type-not-string"],
   [{ t: "11", type: "key" }, "tick-not-int"], [{ t: 1.5, type: "key" }, "tick-not-int"],
   [{ t: -1, type: "key" }, "tick-not-int"], [{ t: 9, type: "key" }, "tick-decrease"],
   [{ t: Infinity, type: "key" }, "tick-not-int"]].forEach(function (pair) {
    var r = L.step(s, pair[0], PLAT);
    assert.deepStrictEqual(r.reject, { reason: pair[1] }, JSON.stringify(pair[0]));
    assert.strictEqual(r.emit, null);
    assert.strictEqual(JSON.stringify(r.state), frozen);
  });
});

test("a hostile payload is never read or copied", function () {
  var e = JSON.parse('{"seq":0,"t":1,"type":"key","payload":{"__proto__":{"polluted":1}}}');
  var r = L.step(L.state0(), e, PLAT);
  assert.strictEqual(r.reject, null);
  assert.strictEqual(({}).polluted, undefined);
  assert.deepStrictEqual(Object.keys(r.emit).sort(), ["cause", "mode", "passThrough", "t", "was"]);
});

test("bad configs are refused by name", function () {
  [[null, "config-not-object"], [{ gestures: "rest" }, "gestures-not-list"], [{ gestures: [""] }, "gesture-not-string"],
   [{ gestures: ["a", "a"] }, "gesture-repeated"], [{ quietTicks: 0 }, "quiet-not-positive-int"],
   [{ quietTicks: 2.5 }, "quiet-not-positive-int"], [{ gestures: [], quietTicks: null }, "no-way-to-rest"]
  ].forEach(function (pair) {
    assert.deepStrictEqual(L.checkConfig(pair[0]), { ok: false, reason: pair[1] }, JSON.stringify(pair[0]));
    assert.deepStrictEqual(L.step(L.state0(), ev(1, "key"), pair[0]).reject, { reason: pair[1] });
  });
});

test("foldLog halts at the first refusal and keeps what came before", function () {
  var r = L.foldLog([ev(5, "key"), ev(3, "key"), ev(9, "key")], PLAT);
  assert.deepStrictEqual(r.reject, { index: 1, reason: "tick-decrease" });
  assert.strictEqual(r.emits.length, 1);
  assert.strictEqual(r.state.lastTick, 5);
});

// ---- 5. state bounds and replay ----------------------------------------------------------------------------------
test("state stays five fields over a long log", function () {
  var log = [];
  for (var i = 0; i < 100000; i++) log.push(ev(i, i % 97 === 0 ? "rest" : "key"));
  var s = L.foldLog(log, PLAT).state;
  assert.deepStrictEqual(Object.keys(s).sort(), ["cause", "count", "lastTick", "mode", "since"]);
  assert.strictEqual(s.count, 100000);
});

test("replay: the same log folds byte-identically every time (the canonicalizer self-test)", function () {
  var a = JSON.stringify(L.foldLog(GOLD, PLAT)) + L.render(L.foldLog(GOLD, PLAT).state);
  for (var i = 0; i < 5; i++) assert.strictEqual(JSON.stringify(L.foldLog(GOLD, PLAT)) + L.render(L.foldLog(GOLD, PLAT).state), a);
});

test("render is the hand-written frame", function () {
  assert.strictEqual(L.render(GOLD_STATE), "lull mode=awake cause=- since=153 last=153 count=6");
});

// ---- 6. the CLI (the AI People and headless surface) -------------------------------------------------------------
test("CLI folds stdin, prints emits, render and the mode at a tick", function () {
  var input = GOLD.map(function (e) { return JSON.stringify(e); }).join("\n") + "\n";
  var out = child.execFileSync("node", [path.join(__dirname, "lull.js"), "--quiet", "60", "--at", "300"], { input: input }).toString();
  var lines = out.trim().split("\n");
  assert.strictEqual(lines.length, 8);
  assert.deepStrictEqual(JSON.parse(lines[2]), GOLD_EMITS[2]);
  assert.strictEqual(lines[6], "lull mode=awake cause=- since=153 last=153 count=6");
  assert.strictEqual(lines[7], "at 300 mode=resting cause=quiet");
});

test("CLI --help prints the edge; a refusal exits 3; a bad config exits 2", function () {
  var help = child.execFileSync("node", [path.join(__dirname, "lull.js"), "--help"]).toString();
  assert.ok(help.indexOf(L.EDGE) !== -1);
  var r = child.spawnSync("node", [path.join(__dirname, "lull.js")], { input: '{"t":5,"type":"key"}\n{"t":2,"type":"key"}\n' });
  assert.strictEqual(r.status, 3);
  assert.ok(r.stdout.toString().indexOf("refused 1 tick-decrease") !== -1);
  var b = child.spawnSync("node", [path.join(__dirname, "lull.js"), "--quiet", "0"], { input: "" });
  assert.strictEqual(b.status, 2);
});

test("CLI --no-gestures rests by quiet only; with --gesture it is a usage error", function () {
  var input = '{"t":0,"type":"rest"}\n{"t":1,"type":"key"}\n';
  var out = child.execFileSync("node", [path.join(__dirname, "lull.js"), "--no-gestures", "--quiet", "5", "--at", "6"], { input: input }).toString();
  var lines = out.trim().split("\n");
  assert.strictEqual(JSON.parse(lines[0]).passThrough, true);
  assert.strictEqual(lines[3], "at 6 mode=resting cause=quiet");
  var both = child.spawnSync("node", [path.join(__dirname, "lull.js"), "--no-gestures", "--gesture", "rest", "--quiet", "5"], { input: "" });
  assert.strictEqual(both.status, 2);
  var neither = child.spawnSync("node", [path.join(__dirname, "lull.js"), "--no-gestures"], { input: "" });
  assert.strictEqual(neither.status, 2);
});

process.stdout.write("lull battery: " + passed + " passed, " + failed + " failed\n");
process.exit(failed ? 1 : 0);
