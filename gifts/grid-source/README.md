# grid-source

**Generate a bounded 2-D grid as a deterministic, portable JSONL stream of cells — in one dependency-free file.**

Give `grid-source` the dimensions of a grid and it emits one JSON record per cell, in a stable row-major order that is byte-identical on every machine. It is the "give me this coordinate space as data" substrate — the front of a pipe that lets the fold/filter/transform/sink tools work on a 2-D lattice: a sudoku board, a spreadsheet range, a graphing plane, a game board.

```
node grid-source.js --rows 3 --cols 4                 ->  one JSONL record per cell, row-major
node grid-source.js --size 9 --index                  ->  a 9x9 grid, each cell tagged with its index
node grid-source.js --rows 2 --cols 2 --cells | node grid-sink.js   ->  renders a real SVG
```

Each record is a fixed, portable shape:

```
{"row":0,"col":0}
{"row":0,"col":1}
```

## The quiet failures it fixes

Everyone hand-rolls a nested `for (r) for (c)`, and everyone gets it wrong in three ways that only bite on the input they didn't test:

1. **Non-deterministic / ambiguous order.** Ad-hoc grid loops emit in whatever order the code happened to nest — row-major here, column-major there — so two callers' streams don't line up and can't be diffed or pinned. grid-source emits a stable **row-major** pre-order (row 0 left-to-right, then row 1, …), the same stream on every machine and every run. (`--transpose` gives a column-major emission when you want one — a chosen mode, not an accident.)

2. **Off-by-one / unbounded dimensions.** A grid built from an unchecked `--rows`/`--cols` — a float, a negative, a zero-vs-empty confusion, a non-number — silently produces a wrong or unbounded stream. grid-source requires **positive integer** dimensions and fails **closed** (exit 2, one-line message) on anything else. A `0×0` grid is the honest empty stream, not an error.

3. **Coordinate / value confusion.** Hand loops mix a cell's *position* with its *content*, so a downstream sink can't tell which field is which. grid-source keeps them separate and named: `row`/`col` are always the position; `value` — only when you ask for it — is the content, either a constant `--fill` or the cell's row-major `--index`.

## The model

The pure core is `grid(opts)`. Unlike a filesystem or a stream source, there is **no provider to inject** — a grid is fully determined by its dimensions, so the core has *no I/O at all*. It is pure by construction, which is a stronger determinism guarantee than confining impurity to a boundary: the same `opts` always yield byte-identical output, so the core can be tested and pinned directly, with no fixture. The CLI parses `argv` into `opts` and renders JSONL; a browser calls `grid(opts)` directly.

## Options

```
--rows R         number of rows (positive integer; required unless --size)
--cols C         number of columns (positive integer; required unless --size)
--size N         shorthand for --rows N --cols N (a square grid)
--index          add a "value" field: the cell's 0-based row-major index (0..rows*cols-1)
--fill V         add a "value" field: the constant V (a JSON scalar: number, string, true/false/null)
--origin-one     number rows/cols from 1 instead of 0
--transpose      emit in column-major order (col 0 top-to-bottom, then col 1)
--cells          emit {row,col,w:1,h:1} unit blocks — grid-sink's input shape
```

`--index` and `--fill` are mutually exclusive (a cell carries at most one value). `--index` is a **row-major property**: a cell's index value is the same even under `--transpose`.

## Composes with grid-sink

grid-source generates coordinates; **grid-sink** renders them. `--cells` emits the `{row, col, w, h}` unit-block shape grid-sink consumes, so the two compose into a render pipe:

```
node grid-source.js --rows 8 --cols 8 --cells | node grid-sink.js   ->  an 8x8 SVG grid
```

## Determinism

`grid(opts)` is a pure function of `opts` — no clock, no randomness, no ambient state. Given the same `opts`, the output is byte-identical on every run and every machine: cells in stable row-major (or, with `--transpose`, column-major) order, coordinates and value separated.

## Exit codes

`0` success (including a `0×0` grid, which yields an empty stream) · `2` usage error (a non-integer/negative/missing dimension, `--index` with `--fill`, an unknown option, or a non-scalar `--fill`). Always a clean one-line message on stderr, never a stack trace.

## In a browser

The core is pure and I/O-free. Load `grid-source.js` and call `window.ForestGifts.gridSource.grid(opts)` with your options, then render the records however you like.

## The edge

grid-source emits a **bounded, row-major** stream of `{row, col}` cells (`value` only under `--index`/`--fill`). It is a coordinate **source**, not a renderer (pipe `--cells` into `grid-sink` to draw), does **not** read stdin (dimensions are flags), does **not** do sparse grids, and does **not** carry data beyond a constant `--fill` or the row-major `--index`. Dimensions must be non-negative integers; `0×0` is the empty stream.

## License

MIT. Zero dependencies. Runs in Node or a browser.
