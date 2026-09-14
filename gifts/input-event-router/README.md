# input-event-router — turn raw input into a validated, replay-safe event stream

A dependency-free, deterministic reducer that takes a raw input-event log and
turns it into a **typed, schema-validated event stream** — folding it the way an
interactive app needs, with **replay-determinism** as the contract, not an
accident.

## Why this exists

Every interactive app re-hand-rolls the same first step: take raw, untrusted
pointer/key input and turn it into something a reducer can safely fold.
Hand-rolled, that step is where the bugs and the attack surface live — an
unvalidated event coerced instead of rejected, a wall-clock read that quietly
breaks replay, a field the reducer trusts that the input never actually carried.

This is that step, done once, correctly: a pure reducer over an input-event log.
Raw events in, a validated typed stream out, plus a tiny O(1) fold-state
(sequence integrity + a monotonic logical tick). It is the input surface the
other interactive pieces (a render loop, an undo stack) sit behind — they fold
the *validated* stream this emits, never raw input.

## The strip-clean rule (the whole reason to trust it)

State at any point is a pure fold of the initial state and the ordered event log.
**Replaying the same log yields byte-identical state, stream, and render.** The
router holds no clock, no network, and no entropy it did not receive as an event
— logical time enters *only* as the event field `t`, supplied by the caller as
data. So the same log replays identically forever, in a browser or headless on
Node.

## The envelope

One event per line (JSONL):

```json
{ "seq": 0, "t": 0, "type": "pointer", "payload": { "x": 10, "y": 20 } }
```

- `seq` — monotonic sequence, strictly `+1` from `0`. A gap or repeat is a
  rejection (the log is a total order, not a set).
- `t` — a **logical tick** you supply as data, non-decreasing. The router never
  reads a wall-clock; time is an input, so replay is total.
- `type` — one of your **declared accepted types** (default: `pointer`, `key`,
  `select`, `edit`, `commit`; supply your own via `cfg.acceptedTypes`). An
  unknown type is rejected, never invented.
- `payload` — an object (opaque cargo). The router checks it is an object; it
  does not interpret its contents — that's your reducer's job.

## Usage

```bash
node input-event-router.js < events.jsonl   # fold a JSONL log -> render + summary
node input-event-router.js --help
```

In the browser, `window.ForestGifts.inputEventRouter` exposes
`{ route, foldLog, render, state0, validate, ACCEPTED_TYPES }`. In Node,
`require('./input-event-router.js')` returns the same. Drive it per event with
`route(state, event, cfg)`, or fold a whole log with `foldLog(events, cfg)`.

By default a hostile or corrupt log **halts** at the first integrity violation
(a rejected event is surfaced, not silently dropped); pass
`{ rejectPolicy: "skip" }` for best-effort input.

## The edge (what this is NOT)

This **normalizes and validates** input events against a declared schema, folding
them into a deterministic typed stream. It does **not** sanitize application
semantics, it does **not** persist, it holds **no** clock/network/entropy, and it
trusts no event it did not schema. Retaining event history is a separate concern
(an undo stack, under its own declared bound) — this deliberately keeps O(1)
state so it cannot be made to grow without limit by log length.

## License

MIT — see `LICENSE`. Zero dependencies. Single file.
