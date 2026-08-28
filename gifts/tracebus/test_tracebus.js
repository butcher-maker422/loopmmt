#!/usr/bin/env node
/* test_tracebus.js — proves the bus is honest: nothing moves without a receipt,
   no path travels that wasn't declared, and a bad subscriber can't take the bus down.

   The six properties that ARE the tool:
     1. No delivery without a receipt — every emit() appends exactly one ledger record.
     2. No undeclared path — an unrouted packet is refused (and the refusal is recorded).
     3. A wrong-bus packet is refused — routed to A, cannot be emitted on B.
     4. A throwing subscriber can't break the emitter — error caught, recorded, delivery continues.
     5. Registered routes are frozen — the declared topology stays declared.
     6. A trace is reconstructable — queryByTraceId returns every hop in order.
   Plus the generalizations this strip added over its origin (tested hardest, per the
   "a ported core gets its OWN validation" rule): request() gated by a per-bus flag,
   not a hardcoded bus name. Ends with a mutation bite so a vacuous green fails loud.
   stdlib only, no dependencies. Exit 0 = all pass, exit 1 = a failure (loud). */
"use strict";
var tb = require("./tracebus.js");

var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; } else { fail++; console.error("FAIL " + name); }
}
function eq(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.error("FAIL " + name + "\n  got:  " + g + "\n  want: " + w); }
}
function threws(fn) { try { fn(); return false; } catch (e) { return true; } }

// A fresh, wired-up bus system for a test to use.
function fixture(busOpts) {
  var routing = tb.createRoutingTable();
  var ledger = tb.createLedger();
  var bus = tb.createBus("DATA", routing, ledger, busOpts);
  return { routing: routing, ledger: ledger, bus: bus };
}

// ── createPacket: shape + validation ─────────────────────────────────────────
(function () {
  var p = tb.createPacket("user.created", { id: 7 });
  ok("packet has packetId", typeof p.packetId === "string" && p.packetId.length === 36);
  ok("packet has traceId", typeof p.traceId === "string" && p.traceId.length === 36);
  ok("packet keeps type", p.packetType === "user.created");
  ok("packet keeps payload", p.payload.id === 7);
  ok("packet source defaults null", p.source === null);
  ok("packetId !== traceId by default", p.packetId !== p.traceId);

  var threaded = tb.createPacket("user.updated", { id: 7 }, { traceId: "trace-abc", source: "svc" });
  ok("traceId threads through opts", threaded.traceId === "trace-abc");
  ok("source threads through opts", threaded.source === "svc");

  ok("empty packetType throws", threws(function () { tb.createPacket("", {}); }));
  ok("non-string packetType throws", threws(function () { tb.createPacket(42, {}); }));
  ok("null payload throws", threws(function () { tb.createPacket("t", null); }));
  ok("non-object payload throws", threws(function () { tb.createPacket("t", "nope"); }));
})();

// ── generateId: v4 shape + uniqueness ────────────────────────────────────────
(function () {
  var a = tb.generateId(), b = tb.generateId();
  ok("id is 36 chars", a.length === 36);
  ok("id version nibble is 4", a[14] === "4");
  ok("id variant nibble in 8,9,a,b", /[89ab]/.test(a[19]));
  ok("dashes at 8,13,18,23", a[8] === "-" && a[13] === "-" && a[18] === "-" && a[23] === "-");
  ok("ids are unique", a !== b);
  // 500 draws, no collision
  var seen = {}, collision = false;
  for (var i = 0; i < 500; i++) { var id = tb.generateId(); if (seen[id]) collision = true; seen[id] = 1; }
  ok("500 ids, no collision", !collision);
})();

// ── PROPERTY 1: no delivery without a receipt ────────────────────────────────
(function () {
  var f = fixture();
  f.routing.register({ packetType: "e", source: "src", bus: "DATA", destinations: ["sink"] });
  f.bus.subscribe("sink", function () {});
  ok("ledger starts empty", f.ledger.count() === 0);
  f.bus.emit("src", tb.createPacket("e", { n: 1 }));
  ok("one emit -> one record", f.ledger.count() === 1);
  f.bus.emit("src", tb.createPacket("e", { n: 2 }));
  ok("two emits -> two records", f.ledger.count() === 2);
  ok("delivered status recorded", f.ledger.all()[0].status === "delivered");

  // even a REJECTED emit leaves exactly one record
  var g = fixture();
  var before = g.ledger.count();
  threws(function () { g.bus.emit("nobody", tb.createPacket("unrouted", {})); });
  ok("rejected emit still records once", g.ledger.count() === before + 1);
  ok("rejection status is unrouted", g.ledger.all()[0].status === "rejected:unrouted");
})();

// ── PROPERTY 2: no undeclared path ───────────────────────────────────────────
(function () {
  var f = fixture();
  ok("unrouted resolve throws", threws(function () { f.routing.resolve("x", "y"); }));
  ok("has() is false before register", f.routing.has("x", "y") === false);
  f.routing.register({ packetType: "x", source: "y", bus: "DATA", destinations: ["d"] });
  ok("has() is true after register", f.routing.has("x", "y") === true);
  ok("emit of unrouted throws", threws(function () { f.bus.emit("z", tb.createPacket("x", {})); }));
  // register validation
  ok("register without bus throws", threws(function () { f.routing.register({ packetType: "a", source: "b", destinations: ["d"] }); }));
  ok("register with empty destinations throws", threws(function () { f.routing.register({ packetType: "a", source: "b", bus: "DATA", destinations: [] }); }));
  ok("register with non-array destinations throws", threws(function () { f.routing.register({ packetType: "a", source: "b", bus: "DATA", destinations: "d" }); }));
})();

// ── PROPERTY 3: a wrong-bus packet is refused ────────────────────────────────
(function () {
  var routing = tb.createRoutingTable();
  var ledger = tb.createLedger();
  var dataBus = tb.createBus("DATA", routing, ledger);
  var ctrlBus = tb.createBus("CONTROL", routing, ledger);
  // route says this packet belongs on CONTROL
  routing.register({ packetType: "cmd", source: "op", bus: "CONTROL", destinations: ["worker"] });
  var landed = false;
  dataBus.subscribe("worker", function () { landed = true; });
  ok("emit on wrong bus throws", threws(function () { dataBus.emit("op", tb.createPacket("cmd", {})); }));
  ok("wrong-bus packet not delivered", landed === false);
  ok("wrong-bus rejection recorded", ledger.all().some(function (e) { return e.status === "rejected:wrong_bus"; }));
})();

// ── PROPERTY 4: a throwing subscriber can't break the emitter ────────────────
(function () {
  var f = fixture();
  f.routing.register({ packetType: "fan", source: "src", bus: "DATA", destinations: ["good", "bad", "also"] });
  var goodHits = 0, alsoHits = 0;
  f.bus.subscribe("good", function () { goodHits++; });
  f.bus.subscribe("bad", function () { throw new Error("boom"); });
  f.bus.subscribe("also", function () { alsoHits++; });
  var result;
  ok("emit with a throwing subscriber does not throw", !threws(function () {
    result = f.bus.emit("src", tb.createPacket("fan", {}));
  }));
  ok("good subscriber ran", goodHits === 1);
  ok("subscriber AFTER the thrower still ran", alsoHits === 1);
  ok("throwing dest counted as delivered", result.delivered.indexOf("bad") !== -1);
  ok("subscriber error recorded", f.ledger.all().some(function (e) { return /error:subscriber/.test(e.status); }));

  // a declared destination with NO subscriber -> reported missing, not an error
  var g = fixture();
  g.routing.register({ packetType: "e", source: "s", bus: "DATA", destinations: ["present", "absent"] });
  g.bus.subscribe("present", function () {});
  var r2 = g.bus.emit("s", tb.createPacket("e", {}));
  ok("present delivered", r2.delivered.indexOf("present") !== -1);
  ok("absent reported missing", r2.missing.indexOf("absent") !== -1);
  ok("partial status recorded", g.ledger.all().some(function (e) { return /delivered:partial/.test(e.status); }));
})();

// ── PROPERTY 5: registered routes are frozen ─────────────────────────────────
(function () {
  var routing = tb.createRoutingTable();
  routing.register({ packetType: "e", source: "s", bus: "DATA", destinations: ["d"] });
  var entry = routing.resolve("e", "s")[0];
  ok("resolved entry is frozen", Object.isFrozen(entry));
  ok("entry.destinations is frozen", Object.isFrozen(entry.destinations));
  // mutating a frozen entry is a silent no-op in non-strict, throws in strict — either way it must not change
  var beforeBus = entry.bus;
  try { entry.bus = "HACKED"; } catch (e) { /* strict-mode throw is fine */ }
  ok("frozen entry.bus unchanged", entry.bus === beforeBus);
  try { entry.destinations.push("injected"); } catch (e) { /* fine */ }
  ok("frozen destinations unchanged", entry.destinations.length === 1);

  // deepFreeze on a nested object
  var nested = tb.deepFreeze({ a: { b: { c: 1 } } });
  ok("deepFreeze freezes root", Object.isFrozen(nested));
  ok("deepFreeze freezes nested", Object.isFrozen(nested.a.b));
})();

// ── PROPERTY 6: a trace is reconstructable ───────────────────────────────────
(function () {
  var f = fixture();
  f.routing.register({ packetType: "step1", source: "a", bus: "DATA", destinations: ["b"] });
  f.routing.register({ packetType: "step2", source: "a", bus: "DATA", destinations: ["b"] });
  f.bus.subscribe("b", function () {});
  var trace = "journey-1";
  f.bus.emit("a", tb.createPacket("step1", {}, { traceId: trace }));
  f.bus.emit("a", tb.createPacket("step2", {}, { traceId: trace }));
  f.bus.emit("a", tb.createPacket("step1", {}, { traceId: "other" }));
  var hops = f.ledger.queryByTraceId(trace);
  ok("trace has exactly its two hops", hops.length === 2);
  ok("trace hops in emission order", hops[0].packetType === "step1" && hops[1].packetType === "step2");
  ok("other trace excluded", hops.every(function (h) { return h.traceId === trace; }));
  // query by packetType
  ok("queryByPacketType finds all step1", f.ledger.queryByPacketType("step1").length === 2);
})();

// ── THE GENERALIZATION (tested hardest — the ported core's OWN validation) ────
// In the origin, request() was hardwired to a bus literally named 'VAULT'. The strip
// replaced that with a per-bus { requestResponse } flag. These prove the new gate.
(function () {
  var routing = tb.createRoutingTable();
  var ledger = tb.createLedger();
  routing.register({ packetType: "q", source: "asker", bus: "RPC", destinations: ["answerer"] });

  // a bus WITHOUT the flag refuses request(), regardless of its name
  var plain = tb.createBus("RPC", routing, ledger); // note: named RPC, not VAULT — name must NOT matter
  plain.subscribe("answerer", function () { return 99; });
  ok("request refused without flag (name irrelevant)", threws(function () {
    plain.request("asker", tb.createPacket("q", {}));
  }));

  // a bus WITH the flag answers — and the answer is the handler's return value
  var routing2 = tb.createRoutingTable();
  var ledger2 = tb.createLedger();
  routing2.register({ packetType: "q", source: "asker", bus: "RPC", destinations: ["answerer"] });
  var rpc = tb.createBus("RPC", routing2, ledger2, { requestResponse: true });
  rpc.subscribe("answerer", function (pkt) { return pkt.payload.a + pkt.payload.b; });
  var answer = rpc.request("asker", tb.createPacket("q", { a: 2, b: 3 }));
  ok("request returns handler value", answer === 5);
  ok("request_response status recorded", ledger2.all().some(function (e) { return /request_response/.test(e.status); }));

  // request to an unregistered destination -> error, recorded
  var routing3 = tb.createRoutingTable();
  var ledger3 = tb.createLedger();
  routing3.register({ packetType: "q", source: "asker", bus: "RPC", destinations: ["ghost"] });
  var rpc3 = tb.createBus("RPC", routing3, ledger3, { requestResponse: true });
  ok("request to unregistered dest throws", threws(function () { rpc3.request("asker", tb.createPacket("q", {})); }));
  ok("unregistered-dest error recorded", ledger3.all().some(function (e) { return /destination_not_registered/.test(e.status); }));

  // a throwing request handler propagates (unlike emit) but still records
  var routing4 = tb.createRoutingTable();
  var ledger4 = tb.createLedger();
  routing4.register({ packetType: "q", source: "asker", bus: "RPC", destinations: ["answerer"] });
  var rpc4 = tb.createBus("RPC", routing4, ledger4, { requestResponse: true });
  rpc4.subscribe("answerer", function () { throw new Error("handler failed"); });
  ok("request handler error propagates", threws(function () { rpc4.request("asker", tb.createPacket("q", {})); }));
  ok("request handler error recorded", ledger4.all().some(function (e) { return /error:handler/.test(e.status); }));
})();

// ── constructor validation (the ported core's own guards) ────────────────────
(function () {
  var routing = tb.createRoutingTable();
  var ledger = tb.createLedger();
  ok("createBus without name throws", threws(function () { tb.createBus("", routing, ledger); }));
  ok("createBus without routing throws", threws(function () { tb.createBus("B", null, ledger); }));
  ok("createBus without ledger throws", threws(function () { tb.createBus("B", routing, null); }));
  ok("createBus with non-table routing throws", threws(function () { tb.createBus("B", {}, ledger); }));

  var f = fixture();
  ok("subscribe non-function throws", threws(function () { f.bus.subscribe("d", "not a fn"); }));
  ok("subscribe empty dest throws", threws(function () { f.bus.subscribe("", function () {}); }));
  ok("ledger.record without packet throws", threws(function () { f.ledger.record({ bus: "DATA" }); }));

  // diagnostics
  f.bus.subscribe("x", function () {});
  ok("hasSubscriber true for x", f.bus.hasSubscriber("x") === true);
  ok("hasSubscriber false for y", f.bus.hasSubscriber("y") === false);
  ok("subscriberCount is 1", f.bus.subscriberCount() === 1);
})();

// ── MUTATION BITE: prove the receipt invariant is not vacuously green ─────────
// If the ledger silently dropped records, property 1's counts would still be
// "consistent" at zero. This bite asserts the ledger actually grows AND that a
// real emit produces a record whose fields tie back to the packet — so a no-op
// record() (the plausible mutation) fails loud here.
(function () {
  var f = fixture();
  f.routing.register({ packetType: "bite", source: "s", bus: "DATA", destinations: ["d"] });
  f.bus.subscribe("d", function () {});
  var pkt = tb.createPacket("bite", { proof: true });
  f.bus.emit("s", pkt);
  var rec = f.ledger.all()[0];
  ok("mutation bite: ledger actually grew", f.ledger.count() === 1);
  ok("mutation bite: record ties to the packet", rec && rec.packetId === pkt.packetId && rec.traceId === pkt.traceId);
  ok("mutation bite: record carries real status", rec && typeof rec.status === "string" && rec.status.length > 0);
})();

console.log((fail === 0 ? "PASS" : "FAIL") + " — " + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
