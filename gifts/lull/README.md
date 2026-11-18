# lull — rest on one gesture or a quiet span, wake on any touch

A dependency-free, deterministic reducer that decides when an app lays its tools down and when it picks them back up.
Feed it the typed event stream [input-event-router](../input-event-router/) emits (`{seq, t, type, payload}`, one per
line) and it answers three things: is the app resting, why, and should the app act on this event.

- **Rest by gesture.** One accepted event whose type is a declared gesture (default `rest`) puts the app to rest.
- **Rest by quiet.** Once a declared quiet span of logical ticks has passed since the last touch, the app is at rest.
  lull never reads a clock: ask `at(state, t)` with a tick you supply, or schedule your own check at `restsAt(state)`.
- **Wake by touch.** While resting, any event wakes the app, and that waking event is **consumed** (`passThrough:
  false`): a tap meant to wake the screen never also places, deletes or commits anything. A gesture is consumed too.
- **Quiet can be off.** `quietTicks: null` rests by gesture only, for a person who pauses long and wants no surprise.

State is five fields, never a buffer, and the same stream folds byte-identically every time.

```
node lull.js --quiet 60 --at 300 < events.jsonl     # one JSON emit per event, the render, then the mode at tick 300
node lull.js --help
node test_lull.js                                   # the battery
```

In a browser: `window.ForestGifts.lull = { step, at, restsAt, foldLog, render, state0, checkConfig }`.
In Node: `require("./lull.js")`.

**Edge.** lull decides resting and waking from a typed event stream and logical ticks; it does NOT draw anything, does
NOT read a clock or schedule a timer, does NOT validate the stream's order or schema (input-event-router does), and does
NOT decide what a consumed waking touch would have done.

MIT. Zero dependencies.
