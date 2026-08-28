# tracebus — a message bus that leaves a receipt

A tiny, dependency-free publish/subscribe bus with two rules most buses skip:
**every legal path is declared up front, and every emission is written to a log
you can replay.**

```
packet ──emit(source)──▶ routingTable.resolve ──▶ subscribers
                    │                              │
                    └────────▶ ledger.record ◀─────┘
```

The point isn't "another event emitter." It's that a packet **can't reach a
subscriber the routing table doesn't permit**, and **nothing is delivered
without leaving a receipt** — so when you ask "what happened to this request?"
the bus can actually tell you, hop by hop.

## The six things it guarantees

1. **No delivery without a receipt.** Every `emit()` — delivered, partial,
   rejected, or errored — appends exactly one ledger record.
2. **No undeclared path.** `resolve()` throws on an unrouted `(packetType,
   source)` pair; `emit()` records the rejection and rethrows. A packet with
   nowhere legal to go is a fault, not a silent drop.
3. **A wrong-bus packet is refused.** A packet routed to bus A cannot be
   emitted on bus B, even if a subscriber is listening on B.
4. **A throwing subscriber can't break the emitter.** Handler errors are
   caught, recorded against that destination, and delivery continues to the
   rest — one bad listener never takes the bus down.
5. **Registered routes are frozen.** A route, once registered, is deep-frozen,
   so the declared topology stays declared — no code path can edit it later.
6. **A trace is reconstructable.** `queryByTraceId` returns every hop a packet
   took, in emission order. Thread one `traceId` through a chain and you can
   read the whole journey back out of the ledger.

## The pieces

- **`createPacket(type, payload, opts)`** — a typed envelope with a `packetId`,
  a `traceId` (pass one in `opts` to thread a chain), a timestamp, and an
  optional `source`.
- **`createRoutingTable()`** — declare legal paths with `register(...)`; look
  them up with `resolve(...)` (throws if unrouted) or `has(...)` (doesn't).
- **`createLedger()`** — the append-only receipt log. Query by `traceId` or by
  `packetType`; nothing is ever removed.
- **`createBus(name, routing, ledger, opts)`** — `subscribe(dest, handler)` and
  `emit(source, packet)`. Pass `{ requestResponse: true }` to enable
  `request(source, packet)`, which delivers to one destination and returns its
  handler's value.

## Use it

Node or a browser, no build step, no install.

```bash
node tracebus.js --demo    # wire a tiny bus, emit a packet, print the receipt trail
```

As a library:

```js
const { createPacket, createRoutingTable, createLedger, createBus } = require("./tracebus.js");

const routing = createRoutingTable();
const ledger  = createLedger();
const bus     = createBus("DATA", routing, ledger);

// declare the only legal path for this packet type + source
routing.register({ packetType: "order.placed", source: "checkout", bus: "DATA",
                   destinations: ["fulfillment", "email"] });

bus.subscribe("fulfillment", pkt => ship(pkt.payload));
bus.subscribe("email",       pkt => notify(pkt.payload));

bus.emit("checkout", createPacket("order.placed", { id: 1001 }, { source: "checkout" }));
// -> { delivered: ["fulfillment", "email"], missing: [] }

ledger.queryByTraceId(/* the packet's traceId */);   // every hop, in order
```

In the browser, drop the file in and use `window.tracebus` (same API).

## Test it

```bash
node test_tracebus.js     # 72 checks: receipt-per-emit, routing enforcement,
                          # wrong-bus refusal, error isolation, frozen routes,
                          # trace reconstruction, + a mutation bite
```

Deterministic in behavior; the ledger reads back exactly what was emitted.
(IDs are v4-shaped for correlation, not cryptographic — they use `Math.random`.)

## Where it came from

Stripped out of a shipped order-management system's internal message fabric —
the "one bus, many handlers, every packet traced" core — and generalized for
standalone use. The one change worth naming: request/response was hardwired to a
single bus name in the original; here it's a per-bus `{ requestResponse }` flag,
so any bus can be an RPC bus and the bus's *name* carries no special meaning.

MIT licensed. Take the folder.
