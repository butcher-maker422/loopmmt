# timeline

**A standalone, zero-dependency validator for a timeline artifact.**
MIT licensed · one file · no dependencies · runs in Node and the browser.

You have events you want to place on a timeline — a project history, a log, a
story, a schedule. Before you *render* them, `timeline` checks that the
*declaration* is sound. It reads one JSON object and returns a verdict.

## What it checks

Given `{ frame, events }`, it runs eight decidable checks:

| Check | What it catches |
|---|---|
| **C0 well-formed** | an event that isn't an object with an `id` |
| **C1 real-order** | a cycle in the `parents` edges, or a parent that resolves to nothing |
| **C2 scale-declared** | no `frame.scale` (an implicit gauge), or a scale that isn't a Stevens level |
| **C3 stevens-legal** | an operation illegal for the scale — ordering on a `nominal` axis, or a `duration` below `interval` |
| **C4 instant/duration** | a `duration` with no anchoring instant (a length, not a point) |
| **C5 no-collision** | two events on the same track at the same instant, with nothing to order them |
| **C6 fold-safety** | a sort key that's nondeterministic (`now`, `random`, `index`, …) or carried by no event |
| **C7 leak-safety** | a per-event baked day bucket (`dayKey`, `day`, …) — day buckets belong to the render, per frame |
| **C8 cyclic-topology** | a declared circular axis (`S1` + `period`) whose coordinates aren't reduced mod the period |

## The artifact

```json
{
  "frame": {
    "scale": "nominal" | "ordinal" | "interval" | "ratio",
    "grain": null,
    "topology": "S1", "period": 1440,
    "foliation": { "key": "t", "dir": "asc" }
  },
  "events": [
    { "id": "a", "t": 0, "parents": [], "track": "main", "duration": 50, "label": "start" }
  ]
}
```

`frame.scale` is required; everything else is optional.

## Usage

```sh
node timeline.js artifact.json        # lint a file
cat artifact.json | node timeline.js  # lint stdin
node timeline.js --help
```

Exit codes: `0` CLEAN · `3` FLAG (findings printed) · `2` USAGE (malformed input).

In a browser: `window.ForestGifts.timelineLint(artifactObject)`.
In Node code: `require('./timeline.js').timelineLint(artifactObject)`.

## The edge (what this is NOT)

`timeline` is a **presence checker, not a correctness oracle.** It confirms a
scale is *declared* and self-consistent with the operations you use — it never
decides whether the declared level is the *right* one for your data, and it does
not prove your renderer is a pure fold (that's a runtime property a static check
can't reach). It reports the trajectory; choosing the true scale, and proving the
render pure, stay yours.

## Why Stevens' levels?

Not every axis supports every operation. On a **nominal** axis (categories) there
is no order, so a "happened-before" edge is meaningless. On an **ordinal** axis
you can order but not subtract, so a *duration* (a difference of two points) is
undefined. Only at **interval** and above is a duration a real quantity. `timeline`
makes those rules mechanical: declare your scale, and it tells you which of your
operations the scale can't actually bear.
