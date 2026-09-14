# heatmap-sink — (x,y,v) cells → one standalone heatmap SVG, zero dependencies

One file. MIT. Pipe a stream of `(x, y, value)` cells in, get one deterministic heatmap SVG out.

```
$ printf '[0,0,0]\n[1,0,1]\n[0,1,2]\n[1,1,3]\n' | node heatmap-sink.js
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
<rect x="0" y="0" width="16" height="16" fill="#ffffcc" />
<rect x="16" y="0" width="16" height="16" fill="#fed976" />
<rect x="0" y="16" width="16" height="16" fill="#e31a1c" />
<rect x="16" y="16" width="16" height="16" fill="#800026" />
</svg>
```

Each cell is painted from a fixed 5-bucket color scale across the data's range, drawn as one
`<rect>` in a grid — a spatial field you can drop straight into a README, a report, or a CI
comment, with no plotting library and no runtime.

## Input

Stdin, one of:

- **JSONL** — one cell per line, each `[x,y,v]` or `{"x":X,"y":Y,"v":V}` (the streaming form)
- **a single spec object** — `{ "cells": [[x,y,v],…], "min": N, "max": N, "palette": "…", "cell": N, "cols": N, "rows": N, "empty": "…" }`

`x`,`y` are non-negative integer grid coordinates (column, row); `v` is a finite number. CLI
flags (`--palette` · `--cell` · `--min` · `--max` · `--cols` · `--rows` · `--empty`) override
object fields. Empty input → a valid, empty `<svg>` frame.

```
$ printf '[0,0,5]\n[1,0,5]\n' | node heatmap-sink.js --palette cool --min 0 --max 10
```

## What it does NOT do — the printed edge

**This is a grid-of-rects heatmap primitive, not a plotting library.** It draws one `<rect>` per
cell in a plain `<svg>` frame and renders **no axes, tick labels, legend, colorbar, or title**,
and embeds **no fonts, CSS, or `<script>`**. It takes **numbers only** — `(x,y,v)` triples — so
**no caller text ever reaches the output**, and there is no escaping surface to get wrong. Colors
are **not** free-form input: cells are painted from a **fixed, named, 5-bucket scale**, and
missing cells take a **fixed empty fill** — so the output can never carry an attacker-chosen
attribute string. Because there are only 5 buckets, **two values in the same band draw the same
color**: it shows the **field, not the exact magnitude**, and it is not a substitute for the
number. A **non-finite `v`, a bad coordinate, or a duplicate `(x,y)` is a hard error**, never
silently dropped or guessed.

If you need axes, a colorbar, or per-cell numbers, reach for a plotting library — `svg-sink` and
`sparkline-sink` are the sibling render-sink gifts for line/bar/scatter and inline sparklines.

## Guarantees

- **Zero dependencies.** Imports nothing, shells out to nothing.
- **Deterministic, and order-independent.** Integer grid coordinates, an integer cell size, and
  **integer color buckets** mean no float noise reaches the output; cells are drawn **row-major
  regardless of input order**, so the same *set* of cells always yields **byte-identical** SVG —
  committable, diffable, cacheable.
- **Closed color scale.** Every `fill` is one of the named scale's 5 colors or the fixed empty
  fill — nothing caller-supplied ever appears.
- **Honest framing.** A non-finite `v` throws naming its cell (`cell (1,0) value is not a finite
  number`); a negative/non-integer coordinate, a duplicate `(x,y)`, a cell outside a pinned grid,
  or an unknown palette all throw rather than mis-rendering.

Palettes: `heat` (default, light→deep red), `cool` (light→deep blue), `mono` (light→dark gray),
`viridis` (dark purple→yellow). Empty: `light` (default), `dark`, `none` (omit the rect).

## Use it as a library

```js
const { heatmap } = require('./heatmap-sink.js');
const svg = heatmap({ cells: [[0,0,0],[1,0,1],[0,1,2],[1,1,3]] });   // "<svg …>…</svg>\n"
```

In a browser it attaches to `window.LoopGifts['heatmap-sink']` — `heatmap(input, flags)` is a
pure function, safe to call in a render loop.

## Test

```
$ node test_heatmap-sink.js
```

The battery's oracle is **out-of-band**: the exact expected SVG for each sample input is
hand-computed from the documented level/domain math, written independently of the emitter — a
build cannot certify itself.

---

MIT © 2026 Shea Gunther. A Loop MMT gift. Third in the render-sink cluster, after `svg-sink` and
`sparkline-sink`.
