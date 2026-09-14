# ppm-raster

Rasterize a JSONL stream of primitives into **one standalone PPM image**, with zero dependencies.

A **sink**: it consumes a stream and commits an artifact. Feed it a header line and a sequence of drawing primitives; it writes a plain [PPM (Netpbm)](https://en.wikipedia.org/wiki/Netpbm) image — P3 ASCII by default, P6 binary with `--binary`. Same input bytes, same output bytes, every run.

## Use it

```sh
# one red pixel on a 4×3 black canvas, printed as P3 ASCII
printf '{"w":4,"h":3}\n{"kind":"pixel","x":0,"y":0,"rgb":[255,0,0]}\n' | node ppm-raster.js

# a black filled rectangle on a white 8×8 canvas, committed to a file as binary P6
printf '{"w":8,"h":8,"bg":[255,255,255]}\n{"kind":"rect","x":1,"y":1,"w":4,"h":3,"rgb":[0,0,0]}\n' \
  | node ppm-raster.js --binary --out box.ppm

node ppm-raster.js --help
```

## Input (stdin, JSON Lines)

One JSON object per line; blank lines are ignored.

- **Line 1 — the header:** `{ "w": INT, "h": INT, "bg"?: [r,g,b] }`
  Canvas width and height in pixels (`1..8192`). `bg` is the background fill (default black `[0,0,0]`).
- **Each further line — a primitive:**
  | kind | fields | draws |
  |---|---|---|
  | `pixel` | `x, y, rgb` | one pixel |
  | `rect` | `x, y, w, h, rgb` | a filled `w`×`h` rectangle, top-left at `(x,y)` |
  | `hline` | `x, y, len, rgb` | a horizontal run of `len` pixels right from `(x,y)` |
  | `vline` | `x, y, len, rgb` | a vertical run of `len` pixels down from `(x,y)` |

Coordinates and sizes are integers; the origin is **top-left** (`x` right, `y` down). `rgb` channels are integers `0..255`.

## Output

A single PPM document on stdout, or written to `--out FILE` (the sink's commit boundary). `--binary` selects P6 (raw bytes); the default is P3 (ASCII text you can read and diff).

## The edge, said plainly

`ppm-raster` is a **raster primitive, not a graphics library.** It has no anti-aliasing, no alpha or blending (every draw is an opaque overwrite), no sub-pixel coordinates, no diagonal lines, no curves, no text, and no color names — colors are integer `[r,g,b]` triples only. Later primitives paint **over** earlier ones, in stream order. A primitive that falls outside the canvas is **clipped**, never an error; but a malformed record — bad `kind`, non-integer coordinate, out-of-range channel, non-finite number — is a **hard error that names the offending line**, never a silently-dropped or guessed pixel. The output is a pure function of the input: the same header and stream always produce byte-identical PPM.

## Determinism

No wall-clock, no randomness, fixed raster order, one space between samples, a newline per pixel-row in P3. A `ppm-raster` image is diffable and hashable — the same input always hashes to the same bytes.

## License

MIT © 2026 Shea Gunther. Zero dependencies. Single file. Runs in Node or the browser (the core is pure over plain arrays).
