# render-loop-harness

A dependency-free, deterministic, **bounded** reducer that drives a pure `state → frame` render loop off an inherited input-event log.

## What it does

Every interactive app with a live view re-hand-rolls the same step: take a stream of validated events and drive a `state → frame` render loop off them. Hand-rolled, that step is where the resource-exhaustion bugs live — a `requestAnimationFrame` busy-spin with no budget, a loop that reads `Date.now()` to pace itself (which breaks replay), a frame function that is not pure so the same log renders differently on replay.

This is that step done once, correctly, as a **bounded deterministic reducer** over an input-event log: validated events in, a sequence of pure frames out, advanced on each event's **logical tick `t`**, and bounded by a declared per-fold **tick budget the harness refuses to exceed**.

## The edge (what it does NOT do)

> This drives a pure `state → frame` render loop off an inherited event log, advancing on the event's logical tick `t` and never a wall-clock; it refuses to exceed its declared per-fold tick budget; it does **not** render pixels (the frame is deterministic text), it does **not** persist, it holds **no** clock/network/entropy, and it schedules nothing it cannot bound.

Retaining event history is a different gift's job (`undo-stack-kernel`), under its own declared bound — this harness keeps a bounded, fixed-shape render view.

## Usage

```
node render-loop-harness.js < events.jsonl               # fold -> final frame + summary
node render-loop-harness.js --budget 500 < events.jsonl  # set the per-fold tick budget
node render-loop-harness.js --help
```

Browser: `window.ForestGifts.renderLoopHarness = { advance, foldLoop, render, state0, DEFAULT_BUDGET, ACCEPTED_TYPES }`.
Node: `require("./render-loop-harness.js")` exports the same.

## The envelope (inherited)

One JSON object per line — the schema `input-event-router` fixed:

```
{ "seq": <int, monotonic +1 from 0>, "t": <int, non-decreasing logical tick>,
  "type": <accepted string>, "payload": <object> }
```

`t` is **logical time, supplied as data** — the harness never reads a wall-clock. The render advance is driven by `t`, so folding the same log reproduces the same frames at the same ticks.

## Composition

The emitted typed stream of `input-event-router` **is** this harness's input log — the covenant's reducer algebra (the emitted stream of one reducer is the input log of the next). You can pipe the router's output straight into the harness in a headless test and prove the composition.

## The bound

The fold produces at most `budget` frames and **refuses to exceed it**: a log longer than the budget halts at exactly `budget` frames with reject-reason `tick-budget-exceeded` — never a busy-spin, never an OOM. The bound is a frame-**count** per fold (not a wall-clock rate), so it is decidable, adversarially checkable, and replay-stable — the same log halts at the same frame every run.

## Tests

```
node test_render-loop-harness.js
```

A golden event-log corpus checked against an **out-of-band** expected state (hand-computed, not the gift restating itself), replay-determinism, the budget-exceeding known-bad vector (the primary security check), the inherited input-validation vectors, a prototype-pollution guard, a live composition proof against `input-event-router`, and two mutation bites.

## License

MIT — see LICENSE.
