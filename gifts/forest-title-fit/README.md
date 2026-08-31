# forest-title-fit

Shrink-to-fit-never-clip title sizing — pick the largest font size at which a title
still fits a fixed width, and **never** clip or ellipsize. A general UI primitive: a
card title, a nav label, a chart caption, a poster headline.

## What it does

- `fitFontSize(text, width, opts)` — binary-searches the largest integer font size
  in `[min, max]` whose measured width fits. Returns the size, whether it `fits`, and
  a `floored` flag when it bottoms out at the floor without fitting. It never returns
  below `min`, so it never clips by shrinking past a readable floor.
- `wrapToWidth(text, width, fontSize, measure)` — the never-clip fallback: greedy
  word-wrap so no line exceeds the width. A single word wider than the box goes on
  its own line **intact** (overflow is visible, never cut).
- `fitTitle(text, width, opts)` — the convenience entry: fit on one line at the
  largest size, and if it can't fit even at the floor, wrap at the floor instead of
  ellipsizing.

## The seam

Measuring rendered text needs a font engine, which lives in the DOM. To keep this
primitive **pure and testable without a browser**, the measuring function is
*injected*, not imported — every entry point takes a `measure(text, fontSize) ->
width` callback:

```js
var tf = require("./forest-title-fit.js");     // browser: window.LoopGifts.titleFit

// browser: a real canvas-backed measurer
var measure = tf.makeCanvasMeasure("Inter, sans-serif");
var r = tf.fitTitle("My Card Title", 240, { measure: measure, min: 12, max: 48 });
// -> { fontSize, lines: [...], fits, floored } — render r.lines at r.fontSize px

// test / Node: a deterministic stub, no DOM needed
var stub = function (t, s) { return t.length * s * 0.6; };
tf.fitFontSize("ABCD", 300, { measure: stub, min: 8, max: 96 }).fontSize; // exact + testable
```

The fitting *logic* is identical in both worlds; only the `measure` you inject
changes. `makeCanvasMeasure()` supplies the browser one and is defined only when a
DOM exists (in Node it throws if called, so the seam stays explicit).

## Contract

- `fitFontSize(text, width, opts)` → `{ fontSize, fits, width, floored }`. `opts.measure`
  is **required**. Throws on a missing measure, a non-positive width, or `min > max`.
- `wrapToWidth(text, width, fontSize, measure)` → `[line, ...]`. Never a line wider
  than `width` except a lone oversized word (kept intact). Throws on a missing measure
  or non-positive width.
- `fitTitle(text, width, opts)` → `{ fontSize, lines, fits, floored }`.
- `makeCanvasMeasure(fontFamily?)` → a `measure` (browser only).

## Edge & scope (honest)

- It sizes to the `measure` you give it — the result is only as accurate as your
  measurer. `makeCanvasMeasure` measures the font the canvas actually has; a webfont
  still loading will measure as its fallback until it lands.
- It searches **integer** sizes. If you need sub-pixel sizing, scale your unit.
- `wrapToWidth` breaks on whitespace only — it does not hyphenate. A single word wider
  than the box overflows visibly (by design: never clip, never ellipsize).
- It computes sizes and lines; it does **not** render — the caller applies the result
  to their element. No DOM is touched by the core.

## Run it

```
node forest-title-fit.js --demo              # fit sample titles to a fixed width
node forest-title-fit.js 'My Title' 240      # fit one title (monospace-ish model)
node test_forest-title-fit.js                # the oracle: 23 checks + a mutation-bite
```

MIT © 2026 Shea Gunther.
