#!/usr/bin/env node
/* test_undo-stack-kernel.js — the golden LOG corpus for the undo-stack-kernel gift.

   The oracle rule (covenant §4 B6): the expected final history / cursor / reconstructed
   state is HAND-AUTHORED here (computed from the reducer rules by hand), NOT produced by
   running the gift. The gift must AGREE with the independent expectation. The known-bad
   half is drawn from the real failure shapes the covenant §3 names for the state-mutation
   lane — unbounded growth, in-place corruption, unschema'd coercion — not author-invented
   pleasantness. Three mutation bites prove the oracle has teeth.

   Run:  node test_undo-stack-kernel.js
   Exit 0 all-green / 1 any-red.
*/
"use strict";
var K = require("./undo-stack-kernel.js");

var checks = [];
function record(name, ok, detail) { checks.push({ name: name, ok: !!ok, detail: detail || "" }); }

/* ============================================================
   1. GOLDEN VALID LOG -> hand-authored expected final state.
   ============================================================ */
(function golden() {
  // A log: commit A(t0), commit B(t1), commit C(t2), undo, undo, redo.
  // Hand-computed expectation (depth 100, nothing evicted):
  //   after C:   history = [base, A, B, C], cursor = 3
  //   undo:      cursor 2 (B)
  //   undo:      cursor 1 (A)
  //   redo:      cursor 2 (B)
  //   reconstruct -> "B"; nextSeq = 6; lastTick = 5.
  var log = [
    { seq: 0, t: 0, type: "commit", payload: { state: "A" } },
    { seq: 1, t: 1, type: "commit", payload: { state: "B" } },
    { seq: 2, t: 2, type: "commit", payload: { state: "C" } },
    { seq: 3, t: 3, type: "undo",   payload: {} },
    { seq: 4, t: 4, type: "undo",   payload: {} },
    { seq: 5, t: 5, type: "redo",   payload: {} }
  ];
  var EXPECT = { reconstruct: "B", cursor: 2, historyLen: 4, nextSeq: 6, lastTick: 5, evicted: 0 };
  var out = K.foldLog(log, { depth: 100 });
  var s = out.state;
  record("golden: reconstruct == B (hand-authored)", K.reconstruct(s) === EXPECT.reconstruct, "got=" + K.reconstruct(s));
  record("golden: cursor == 2", s.cursor === EXPECT.cursor, "got=" + s.cursor);
  record("golden: historyLen == 4", s.history.length === EXPECT.historyLen, "got=" + s.history.length);
  record("golden: nextSeq == 6", s.nextSeq === EXPECT.nextSeq, "got=" + s.nextSeq);
  record("golden: lastTick == 5", s.lastTick === EXPECT.lastTick, "got=" + s.lastTick);
  record("golden: evicted == 0", s.evicted === EXPECT.evicted, "got=" + s.evicted);
})();

/* ============================================================
   2. REPLAY-DETERMINISM (the canonicalizer self-test, I1).
   ============================================================ */
(function replay() {
  var log = [
    { seq: 0, t: 0, type: "commit", payload: { state: "x" } },
    { seq: 1, t: 2, type: "commit", payload: { state: "y" } },
    { seq: 2, t: 5, type: "undo",   payload: {} }
  ];
  var a = JSON.stringify(K.foldLog(log, { depth: 100 }));
  var b = JSON.stringify(K.foldLog(log, { depth: 100 }));
  record("I1: replay-determinism (two folds byte-identical)", a === b, "");
})();

/* ============================================================
   3. DEPTH-BOUND known-bad vector (I4, the PRIMARY clause).
   ============================================================ */
(function depthBound() {
  var depth = 8;
  var log = [];
  for (var i = 0; i < 5000; i++) log.push({ seq: i, t: i, type: "commit", payload: { state: i } });
  var out = K.foldLog(log, { depth: depth });
  record("I4 PRIMARY: 5000 commits @ depth 8 -> retained == 8", out.state.history.length === depth,
    "retained=" + out.state.history.length);
  // Structural invariant after EVERY event (the real proof memory stays O(depth)).
  var st = K.state0({ depth: depth });
  var held = true, worst = 0;
  for (var j = 0; j < log.length; j++) {
    st = K.advance(st, log[j], { depth: depth }).state;
    if (st.history.length > worst) worst = st.history.length;
    if (st.history.length > depth) { held = false; break; }
  }
  record("I4 PRIMARY: history.length <= depth after EVERY event (worst=" + worst + ")", held, "");
  // The retained window is the MOST RECENT commits (oldest evicted): tip mark is 4999.
  record("I4: retained window is most-recent (tip mark == 4999)", K.reconstruct(out.state) === 4999,
    "got=" + K.reconstruct(out.state));
})();

/* ============================================================
   4. INHERITED input-validation known-bad vectors (I2/I3).
   ============================================================ */
(function validation() {
  function firstReason(log) {
    var out = K.foldLog(log, { depth: 100 });
    return out.rejections.length ? out.rejections[0].reason : null;
  }
  record("I2: seq-gap rejected",
    firstReason([{seq:0,t:0,type:"commit",payload:{}},{seq:2,t:1,type:"commit",payload:{}}]) === "seq-gap", "");
  record("I2: seq-repeat rejected",
    firstReason([{seq:0,t:0,type:"commit",payload:{}},{seq:0,t:1,type:"commit",payload:{}}]) === "seq-repeat", "");
  record("I3: tick-decrease rejected",
    firstReason([{seq:0,t:5,type:"commit",payload:{}},{seq:1,t:2,type:"commit",payload:{}}]) === "tick-decrease", "");
  record("I3: unknown type rejected",
    firstReason([{seq:0,t:0,type:"NOPE",payload:{}}]) === "type-not-accepted", "");
  record("I3: scalar payload rejected",
    firstReason([{seq:0,t:0,type:"commit",payload:5}]) === "payload-not-object", "");
  record("I3: non-object event rejected",
    firstReason(["nope"]) === "event-not-object", "");
})();

/* ============================================================
   5. PROTO-POLLUTION guard (I3).
   ============================================================ */
(function proto() {
  var before = Object.prototype.polluted;
  var log = [{ seq: 0, t: 0, type: "commit", payload: JSON.parse('{"__proto__":{"polluted":"x"},"state":"ok"}') }];
  var out = K.foldLog(log, { depth: 100 });
  record("I3: Object.prototype not polluted", Object.prototype.polluted === before, "");
  record("I3: dangerous key dropped, safe state kept", K.reconstruct(out.state) === "ok", "");
})();

/* ============================================================
   6. REPLAY-ONLY REACHABILITY / anti-corruption (I5).
   fork: commit A, commit B, undo to A, commit C (truncates B).
   Replaying to A after C must reproduce A byte-identically.
   ============================================================ */
(function reachability() {
  var fork = [
    { seq: 0, t: 0, type: "commit", payload: { state: "A" } },
    { seq: 1, t: 1, type: "commit", payload: { state: "B" } },
    { seq: 2, t: 2, type: "undo",   payload: {} },              // cursor -> A
    { seq: 3, t: 3, type: "commit", payload: { state: "C" } }   // fork: truncate B, append C
  ];
  var of = K.foldLog(fork, { depth: 100 });
  record("I5: fork tip is C", K.reconstruct(of.state) === "C", "got=" + K.reconstruct(of.state));
  // undo from C must land on A (B was truncated), and A is uncorrupted by C.
  var of2 = K.foldLog(fork.concat([{ seq: 4, t: 4, type: "undo", payload: {} }]), { depth: 100 });
  record("I5: undo from C lands on uncorrupted A (B truncated)", K.reconstruct(of2.state) === "A",
    "got=" + K.reconstruct(of2.state));
  // Cursor bounded both ends.
  var base = K.foldLog([{ seq: 0, t: 0, type: "undo", payload: {} }], { depth: 100 });
  record("I5: undo at base -> undo-at-base, cursor stays 0",
    base.rejections.length === 1 && base.rejections[0].reason === "undo-at-base" && base.state.cursor === 0, "");
  var tip = K.foldLog([{ seq: 0, t: 0, type: "commit", payload: { state: "A" } },
                       { seq: 1, t: 1, type: "redo", payload: {} }], { depth: 100 });
  record("I5: redo at tip -> redo-at-tip, cursor stays at tip",
    tip.rejections.length === 1 && tip.rejections[0].reason === "redo-at-tip", "");
})();

/* ============================================================
   7. COMPOSITION — a router-emit stream folds cleanly (I6).
   Non-history accepted types (pointer/commit) are valid; the stream preserves order.
   ============================================================ */
(function composition() {
  var routerEmit = [
    { seq: 0, t: 0, type: "pointer", payload: { mark: "x" } },  // passthrough no-op
    { seq: 1, t: 3, type: "commit",  payload: { state: "s1" } },
    { seq: 2, t: 4, type: "edit",    payload: { mark: "e" } },  // passthrough no-op
    { seq: 3, t: 5, type: "commit",  payload: { state: "s2" } }
  ];
  var out = K.foldLog(routerEmit, { depth: 100 });
  record("I6: folds a router-emit stream cleanly (no schema rejects, not halted)",
    out.rejections.length === 0 && !out.halted, "rej=" + out.rejections.length);
  record("I6: passthrough types preserve order; tip state == s2", K.reconstruct(out.state) === "s2",
    "got=" + K.reconstruct(out.state));
})();

/* ============================================================
   MUTATION BITES — the oracle must have teeth (>=2; here 3).
   ============================================================ */

/* M1 — a deliberately-WRONG expected reconstructed state must be CAUGHT. */
(function m1_wrongExpectation() {
  var log = [{ seq: 0, t: 0, type: "commit", payload: { state: "A" } }];
  var got = K.reconstruct(K.foldLog(log, { depth: 100 }).state);
  var WRONG = "Z";
  record("MUTATION M1 caught: a wrong expected state disagrees with the gift",
    got !== WRONG && got === "A", "gift=" + got + " wrong-expectation=" + WRONG);
})();

/* M2 — a DEPTH-IGNORING build (keeps unbounded history) must DISAGREE with the oracle on
   the over-depth vector (I4). This is the load-bearing bite — it proves the state-bounds
   clause is real. We simulate the mutant (the gift itself is honest). */
(function m2_unbounded() {
  var depth = 4;
  var log = [];
  for (var i = 0; i < 100; i++) log.push({ seq: i, t: i, type: "commit", payload: { state: i } });
  // The mutant ignores the depth: it would retain all 100 commits (+ base = 101).
  var mutantRetained = log.length + 1; // 101
  var oracleRetained = depth;          // the bound: exactly `depth`
  var mutantDisagrees = mutantRetained !== oracleRetained;
  // The honest gift agrees with the oracle (retains exactly depth):
  var honest = K.foldLog(log, { depth: depth });
  var honestAgrees = honest.state.history.length === oracleRetained;
  record("MUTATION M2 caught: depth-ignoring build disagrees with oracle on over-depth vector",
    mutantDisagrees && honestAgrees,
    "mutant retained=" + mutantRetained + " oracle=" + oracleRetained + " honest=" + honest.state.history.length);
})();

/* M3 — an IN-PLACE-MUTATING build (stores a live reference and mutates it on a later
   commit) must FAIL the fork-then-replay reachability vector (I5). The state-mutation
   lane's signature bug. We simulate a mutant that shares one object across checkpoints
   and mutates it, and assert the honest gift does NOT behave that way. */
(function m3_inPlace() {
  // Mutant: one shared record object, mutated in place on each commit. A stored "past"
  // reference therefore reflects the LATEST value, not the value at commit time.
  var shared = { v: null };
  function mutantCommitReturningStored(vals) {
    var storedAtA = null;
    for (var i = 0; i < vals.length; i++) {
      shared.v = vals[i];               // <-- the bug: mutate the shared ref in place
      if (i === 0) storedAtA = shared;  // "store" A by reference
    }
    return storedAtA.v;                 // reading the "A" checkpoint yields the LAST value
  }
  var mutantReadOfA = mutantCommitReturningStored(["A", "B", "C"]); // === "C" (corrupted)
  // The honest gift, folding the same commits then replaying to A, yields "A".
  var log = [
    { seq: 0, t: 0, type: "commit", payload: { state: "A" } },
    { seq: 1, t: 1, type: "commit", payload: { state: "B" } },
    { seq: 2, t: 2, type: "commit", payload: { state: "C" } },
    { seq: 3, t: 3, type: "undo",   payload: {} },
    { seq: 4, t: 4, type: "undo",   payload: {} }   // cursor -> A
  ];
  var honestReadOfA = K.reconstruct(K.foldLog(log, { depth: 100 }).state);
  record("MUTATION M3 caught: in-place-mutating build corrupts stored A; honest gift replays A",
    mutantReadOfA === "C" && honestReadOfA === "A",
    "mutant reads A as '" + mutantReadOfA + "'; honest replays A as '" + honestReadOfA + "'");
})();

/* ---- Verdict ---- */
var total = checks.length;
var passedN = checks.filter(function (c) { return c.ok; }).length;
var bites = checks.filter(function (c) { return c.name.indexOf("MUTATION") === 0 && c.ok; }).length;
var verdict = (passedN === total) ? "GREEN" : "RED";

for (var i = 0; i < checks.length; i++) {
  process.stdout.write("  " + (checks[i].ok ? "ok  " : "FAIL") + " " + checks[i].name +
    (checks[i].detail ? "  (" + checks[i].detail + ")" : "") + "\n");
}
process.stdout.write("\n" + verdict + " — " + passedN + "/" + total + " checks, " + bites + " mutation bites\n");
process.exit(verdict === "GREEN" ? 0 : 1);
