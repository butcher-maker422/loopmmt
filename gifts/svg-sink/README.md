# svg-sink — numbers → a standalone SVG chart, zero dependencies

One file. MIT. Pipe a numeric series in, get a self-contained SVG chart out.

```
$ echo '[3,1,4,1,5,9,2,6]' | node svg-sink.js
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100" width="300" height="100">
<polyline fill="none" stroke="#2f6f8f" stroke-width="1.5" points="6,64 47.143,88 ..." />
</svg>
```

Three chart kinds, one or many series:

```
$ echo '[3,1,4,1,5,9]'       | node svg-sink.js --kind bar
$ echo '[[1,2,3],[3,2,1]]'   | node svg-sink.js --kind scatter        # two series
$ echo '{"series":[1,2,3],"kind":"line","width":400,"height":120}' | node svg-sink.js
```

## Input

JSON on stdin, one of:

- **a bare array of numbers** — one series: `[1,2,3]`
- **a bare array of arrays** — many series: `[[1,2],[3,4]]`
- **a spec object** — `{ "series": …, "kind": …, "width": …, "height": …, "pad": …, "min": …, "max": …, "palette": … }`

CLI flags (`--kind` · `--width` · `--height` · `--pad` · `--palette`) override object
fields. `--kind` is `line` \| `bar` \| `scatter`; `--palette` is `loop` \| `mono` \|
`warm` \| `cool`.

Bar charts baseline at **zero** (heights read value-proportional). Line and scatter
share one y-domain across all series, auto-fit to the data unless you pass `min`/`max`.

## What it does NOT do — the printed edge

**This is a chart *primitive*, not a charting library. It draws geometry only** — a
polyline, bars, or dots inside a plain `<svg>` frame. It renders **no axes, gridlines,
tick labels, legend, title, or interactivity**, and embeds **no fonts, no CSS, and no
`<script>`**. It takes **numbers only** — no caller text ever reaches the output, so
there is no text-escaping surface to get wrong. Colors are **not** free-form input:
each series is painted from a fixed, named palette by its index, so the SVG can never
carry an attacker-chosen attribute string. A **non-finite value (NaN / Infinity) is a
hard error**, never a silently-dropped or guessed point.

If you need axes, labels, or a legend, wrap this — it gives you the clean geometry to
build on.

## Guarantees

- **Zero dependencies.** Imports nothing, shells out to nothing.
- **Deterministic.** Same spec in → **byte-identical** SVG out. Coordinates are held to
  a fixed 3-decimal precision and attribute order is stable, so there is no float noise
  and no platform drift.
- **Contained.** Every coordinate the emitter produces lies inside the `viewBox`.
- **Honest framing.** A bad `kind` or `palette` throws; a non-finite value throws and
  names its position (`series 0[2] is not a finite number`).

## Use it as a library

```js
const { renderSVG } = require('./svg-sink.js');
const svg = renderSVG([3, 1, 4, 1, 5], { kind: 'bar', width: 200, height: 60 });
```

In a browser it attaches to `window.LoopGifts['svg-sink']` — `renderSVG(series, flags)`
is a pure function, safe to call in a render loop.

## Test

```
$ node test_svg-sink.js
```

The battery's oracle is **out-of-band**: the exact expected SVG for the sample inputs is
hand-computed from the scale math, written independently of the emitter — a build cannot
certify itself.

---

MIT © 2026 Shea Gunther. A Loop MMT gift.
