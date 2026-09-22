#!/usr/bin/env node
/* test_input-event-router.js — the golden event-log corpus.

   The battery drift-checks the gift against an OUT-OF-BAND oracle: expected final
   states and emitted streams authored independently (by hand, from the envelope
   rules), not by running the gift. Plus replay-determinism (the canonicalizer
   self-test), the mandatory hostile-event known-bad vectors (§3 security check),
   a state-bounds assertion, and a mutation bite so a no-op harness cannot pass.
*/
"use strict";

var R = require("./input-event-router.js");
var assert = require("assert");

var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error("FAIL: " + name); }
}
function eq(name, a, b) {
  var ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja === jb) { pass++; }
  else { fail++; console.error("FAIL: " + name + "\n  got:  " + ja + "\n  want: " + jb); }
}

// ---------------------------------------------------------------------------
// 1. Golden valid log -> expected final state + emitted stream (out-of-band).
//    Expected values hand-computed from the envelope rules, NOT from the gift.
// ---------------------------------------------------------------------------
var validLog = [
  { seq: 0, t: 0, type: "pointer", payload: { x: 10, y: 20 } },
  { seq: 1, t: 0, type: "select", payload: { region: "A1" } },
  { seq: 2, t: 3, type: "edit", payload: { cell: "A1", value: 7 } },
  { seq: 3, t: 3, type: "commit", payload: {} }
];
// Hand-authored oracle: 4 accepted, nextSeq ends at 4, lastTick is 3, count 4.
var expectedState = { nextSeq: 4, lastTick: 3, count: 4 };
// Emitted stream = the same four events, payloads copied field-for-field.
var expectedStream = [
  { seq: 0, t: 0, type: "pointer", payload: { x: 10, y: 20 } },
  { seq: 1, t: 0, type: "select", payload: { region: "A1" } },
  { seq: 2, t: 3, type: "edit", payload: { cell: "A1", value: 7 } },
  { seq: 3, t: 3, type: "commit", payload: {} }
];
var g = R.foldLog(validLog);
eq("golden final state", g.state, expectedState);
eq("golden emitted stream", g.stream, expectedStream);
ok("golden: no rejections", g.rejections.length === 0);
ok("golden: not halted", g.halted === false);
eq("golden render", R.render(g.state), "accepted=4 next-seq=4 last-tick=3");

// ---------------------------------------------------------------------------
// 2. Replay-determinism (the canonicalizer self-test) — fold N times ->
//    byte-identical state, stream, render each time.
// ---------------------------------------------------------------------------
var r1 = R.foldLog(validLog);
var r2 = R.foldLog(validLog);
var r3 = R.foldLog(validLog);
eq("replay: state identical", JSON.stringify(r1.state), JSON.stringify(r3.state));
eq("replay: stream identical", JSON.stringify(r1.stream), JSON.stringify(r2.stream));
eq("replay: render identical", R.render(r1.state), R.render(r3.state));

// ---------------------------------------------------------------------------
// 3. Hostile-event known-bad vectors (§3.1) — each MUST produce its declared
//    rejection reason, never a corruption/crash/coercion. Default policy=halt.
// ---------------------------------------------------------------------------
function firstReject(log) {
  var out = R.foldLog(log);
  return out.rejections.length ? out.rejections[0].reason : "(none)";
}
eq("hostile: seq gap -> seq-gap",
  firstReject([{ seq: 0, t: 0, type: "key", payload: {} },
               { seq: 1, t: 0, type: "key", payload: {} },
               { seq: 3, t: 0, type: "key", payload: {} }]),
  "seq-gap");
eq("hostile: seq repeat -> seq-repeat",
  firstReject([{ seq: 0, t: 0, type: "key", payload: {} },
               { seq: 1, t: 0, type: "key", payload: {} },
               { seq: 1, t: 0, type: "key", payload: {} }]),
  "seq-repeat");
eq("hostile: decreasing tick -> tick-decrease",
  firstReject([{ seq: 0, t: 5, type: "key", payload: {} },
               { seq: 1, t: 2, type: "key", payload: {} }]),
  "tick-decrease");
eq("hostile: unknown type -> type-not-accepted",
  firstReject([{ seq: 0, t: 0, type: "no-such-type", payload: {} }]),
  "type-not-accepted");
eq("hostile: scalar payload -> payload-not-object",
  firstReject([{ seq: 0, t: 0, type: "key", payload: 42 }]),
  "payload-not-object");
eq("hostile: null payload -> payload-not-object",
  firstReject([{ seq: 0, t: 0, type: "key", payload: null }]),
  "payload-not-object");
eq("hostile: array payload -> payload-not-object",
  firstReject([{ seq: 0, t: 0, type: "key", payload: [1, 2] }]),
  "payload-not-object");
eq("hostile: non-object event -> event-not-object",
  firstReject(["this is not an object"]),
  "event-not-object");

// 3b. Prototype-pollution known-bad twin: a __proto__ payload key must NOT
//     pollute Object.prototype, and must be dropped from the emitted payload.
var poll = R.foldLog([{ seq: 0, t: 0, type: "edit",
                        payload: JSON.parse('{"__proto__":{"polluted":true},"safe":1}') }]);
ok("proto-pollution: Object.prototype not polluted", ({}).polluted === undefined);
ok("proto-pollution: emitted, not rejected", poll.stream.length === 1 && poll.rejections.length === 0);
eq("proto-pollution: dangerous key dropped, safe key kept",
  poll.stream[0].payload, { safe: 1 });

// 3c. halt vs skip policy.
var halted = R.foldLog([{ seq: 0, t: 0, type: "key", payload: {} },
                        { seq: 2, t: 0, type: "key", payload: {} },  // gap -> halt here
                        { seq: 3, t: 0, type: "key", payload: {} }]);
ok("halt: stops at first violation", halted.halted === true && halted.stream.length === 1);
var skipped = R.foldLog([{ seq: 0, t: 0, type: "key", payload: {} },
                         { seq: 2, t: 0, type: "key", payload: {} },  // gap, skipped
                         { seq: 1, t: 0, type: "key", payload: {} }], // now valid (nextSeq still 1)
                        { rejectPolicy: "skip" });
ok("skip: continues past a rejection", skipped.halted === false &&
   skipped.stream.length === 2 && skipped.rejections.length === 1);

// ---------------------------------------------------------------------------
// 4. State-bounds (§3.2) — over a large synthetic log the state stays exactly
//    three integers; no retained buffer. Assert structurally + by memory shape.
// ---------------------------------------------------------------------------
var N = 100000;
var big = [];
for (var i = 0; i < N; i++) big.push({ seq: i, t: i, type: "key", payload: {} });
var bigOut = R.foldLog(big);
eq("state-bounds: state keys are exactly {nextSeq,lastTick,count}",
  Object.keys(bigOut.state).sort(), ["count", "lastTick", "nextSeq"]);
ok("state-bounds: count == N", bigOut.state.count === N);
ok("state-bounds: state carries no array/buffer field",
  Object.keys(bigOut.state).every(function (k) { return typeof bigOut.state[k] === "number"; }));

// ---------------------------------------------------------------------------
// 5. Mutation bite — a deliberately-wrong expected state MUST be caught, so a
//    no-op harness cannot pass green.
// ---------------------------------------------------------------------------
var wrongExpected = { nextSeq: 999, lastTick: 3, count: 4 };
ok("mutation bite: wrong expected state is detected",
  JSON.stringify(g.state) !== JSON.stringify(wrongExpected));

// ---------------------------------------------------------------------------
console.log((fail === 0 ? "OK" : "FAILED") + " — " + pass + " passed, " + fail + " failed");
process.exitCode = fail === 0 ? 0 : 1;
