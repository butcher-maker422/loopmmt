# undo-stack-kernel

A dependency-free, deterministic, **depth-bounded** reducer that keeps an append-only, event-sourced undo/redo history off an inherited input-event log — and reaches any past state by **replay**, never by mutating stored state in place.

## What it does

Every stateful interactive app re-hand-rolls the same step: keep a history of user actions so the user can undo and redo. Hand-rolled, that step is where two whole bug classes live — **unbounded growth** (the history array grows without limit until the tab OOMs) and **in-place corruption** (a stored past state is mutated by a later action that shares a reference into it, so "undo" returns a state that silently changed underneath the user).

This is that step done once, correctly, as a **bounded event-sourced reducer** over an input-event log: validated `commit`/`undo`/`redo` events in, an append-only history out, every reachable state produced by **replay** from a retained checkpoint, and the whole history **bounded by a declared max depth the kernel refuses to exceed**.

## The edge (what it does NOT do)

> This keeps an append-only, event-sourced undo/redo history bounded by a declared max depth; it reaches any past state by **replay** from a retained checkpoint, never by mutating stored state in place; it advances history time on the event's logical tick `t` and never a wall-clock; it does **not** persist to disk, holds **no** clock/network/entropy, and refuses to grow history past its declared depth (undo reaches exactly `depth` steps back — an honest bound, not a false "unlimited undo").

## Usage

```
node undo-stack-kernel.js < events.jsonl            # fold -> final state + history summary
node undo-stack-kernel.js --depth 8 < events.jsonl  # set the declared max history depth
node undo-stack-kernel.js --help
```

Browser: `window.ForestGifts.undoStackKernel = { advance, foldLog, reconstruct, state0, DEFAULT_DEPTH, ACCEPTED_TYPES }`.
Node: `require("./undo-stack-kernel.js")` exports the same.

## The envelope (inherited)

One JSON object per line — the schema `input-event-router` fixed:

```
{ "seq": <int, monotonic +1 from 0>, "t": <int, non-decreasing logical tick>,
  "type": <accepted string: commit|undo|redo|...>, "payload": <object> }
```

`t` is **logical time, supplied as data** — the kernel never reads a wall-clock. Each committed checkpoint is stamped with `t`, so folding the same log reproduces the same history at the same ticks.

A `commit` reads one declared payload field, `state` (a scalar marker), copied proto-safe. `undo`/`redo` need no payload. A valid non-history type (`pointer`, `key`, …) is a passthrough no-op that preserves the total order — so a mixed router stream composes.

## Composition

The emitted typed stream of `input-event-router` **is** a valid input log for this kernel — the covenant's reducer algebra (the emitted stream of one reducer is the input log of the next). You can pipe the router's output straight into the kernel in a headless test and prove the composition.

## The bound

The retained history holds at most `depth` checkpoints and **refuses to grow past it**: a commit that would exceed the depth evicts the oldest checkpoint (ring eviction), so `history.length ≤ depth` holds after **every** event, for **any** log — memory is O(depth), never O(log length), never an OOM. The bound is a retained-checkpoint **count** (not a wall-clock TTL), so it is decidable, adversarially checkable, and replay-stable — the same log leaves the same retained window every run. Eviction is a real semantic: undo reaches exactly `depth` steps back, and the edge says so.

## Replay-only reachability

A past state is reached **only** by replay from a retained immutable checkpoint — never a live mutable reference. So a stored checkpoint cannot be mutated in place by a later commit: `undo` returns a value that provably could not have drifted. The conformance vector proves it — commit A, commit B, undo to A, commit C (forking the future); replaying to A reproduces A byte-identically.

## Tests

```
node test_undo-stack-kernel.js               # golden log corpus (27 checks, 3 mutation bites)
node plumb/conform_undo-stack-kernel.cjs     # out-of-band conformance vs an independent oracle
```

Released under MIT. Zero dependencies. Single file.
