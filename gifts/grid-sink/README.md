# grid-sink — placed blocks → one fixed-grid SVG, zero dependencies

One file. MIT. Pipe a stream of placed blocks in, get one deterministic grid SVG out.

```
$ printf '[0,0,1,1]\n[1,1,2,1]\n' | node grid-sink.js
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 44" width="64" height="44">
<rect x="2" y="2" width="20" height="20" fill="#2f6f8f" />
<rect x="22" y="22" width="40" height="20" fill="#c25b3a" />
</svg>
```

One `<rect>` per block, placed at integer `(row, col)` spanning `(w, h)` cells, painted from a fixed
palette by index — a dashboard tile layout, a bin-packing result, a schedule matrix — dropped straight
into a README, a report, or a CI comment, with no layout framework and no runtime.

## Input

Stdin, one of:

- **JSONL** — one block per line, each `[row,col,w,h]` or `{"row":R,"col":C,"w":W,"h":H}`
- **a single spec object** — `{ "blocks": [[row,col,w,h],…], "cols": N, "rows": N, "cell": N, "pad": N, "palette": "…", "overflow": "…" }`

`row`,`col` are non-negative integers; `w`,`h` are positive integers. CLI flags (`--cols` · `--rows` ·
`--cell` · `--pad` · `--palette` · `--overflow`) override object fields. Empty input → an empty `<svg>`
frame.

## The one thing it does that a coordinate loop won't — the declared overflow policy

Give it a **pinned** grid (`--cols`/`--rows`) and a block that doesn't fit, and grid-sink handles it the
way **you declared**, never however the code happened to behave:

```
$ echo '{"blocks":[[0,0,3,1]],"cols":2,"rows":2,"overflow":"clip"}' | node grid-sink.js   # clipped to 2 cells
$ echo '{"blocks":[[0,0,3,1]],"cols":2,"rows":2,"overflow":"skip"}' | node grid-sink.js   # block omitted
$ echo '{"blocks":[[0,0,3,1]],"cols":2,"rows":2}' | node grid-sink.js                     # overflow "error" (default): throws
```

- **error** (default) — refuse the layout, throwing and naming the offending block and the grid bounds.
  This is Fit-by-Construction: you asserted the layout fits; if it doesn't, you hear about it.
- **clip** — draw only the in-grid portion of the block.
- **skip** — omit the block entirely.

An **auto-fit** grid (no `--cols`/`--rows`) sizes itself to the blocks, so nothing ever overflows.

## What it does NOT do — the printed edge

**This is a grid-placement primitive, not a layout engine.** It draws one rect per block and renders
**no axes, labels, gridlines, or legend**, and **no text at all** — it takes **numbers only** (integer
coordinates and spans), so there is **no text-escaping surface**. Colors come from a **fixed named
palette** by block index, never caller input. A **non-finite/negative/non-integer coordinate, a
non-positive span, an unknown palette, or an unknown overflow policy is a hard error**.

## Guarantees

- **Zero dependencies.** Imports nothing.
- **Deterministic.** Integer cell coordinates (no float in the output), a fixed palette by index, blocks
  in input order — the same blocks + grid + policy always yield **byte-identical** SVG.
- **Numbers only.** No caller string reaches the output; there is no escaping surface.
- **Honest overflow.** Overflow is never handled silently by accident — it is always the policy you named.

Palettes: `loop` (default), `mono`, `warm`, `cool`. Blocks draw in input order (a later block overlaps an
earlier one).

## Use it as a library

```js
const { grid } = require('./grid-sink.js');
const svg = grid({ blocks: [[0,0,1,1],[1,1,2,1]] });                      // auto-fit
const svg2 = grid({ blocks: [[0,0,3,1]], cols: 2, rows: 2, overflow: 'clip' });
```

In a browser it attaches to `window.LoopGifts['grid-sink']` — `grid(input, flags)` is a pure function.

## Test

```
$ node test_grid-sink.js
```

The battery's oracle is **out-of-band**: the exact expected SVG for each input is hand-computed from the
documented geometry and the overflow rules, written independently of the emitter — a build cannot certify
itself. All three overflow branches (error/clip/skip) are pinned explicitly.

---

MIT © 2026 Shea Gunther. A Loop MMT gift. The sixth and final render-sink — the one whose core is a fit
decision: what happens to a block that doesn't fit is the policy you declared.
