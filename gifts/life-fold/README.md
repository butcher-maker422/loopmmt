# life-fold

**Fold a set of live cells forward one step of Conway's Game of Life — and pipe it back into itself.**

A tiny, dependency-free tool that reads a set of live cells — one JSON `[x,y]` integer pair per line ([JSON Lines](https://jsonlines.org/)) — and folds it into the **next generation** by Conway's rule (B3/S23), on a **sparse, unbounded** grid. The output is the same shape as the input, so it pipes straight back into itself:

```
printf '%s\n' '[0,0]' '[1,0]' '[2,0]' | node life-fold.js
  ->  [1,-1]
      [1,0]
      [1,1]
printf '%s\n' '[0,0]' '[1,0]' '[2,0]' | node life-fold.js | node life-fold.js
  ->  [0,0]
      [1,0]
      [2,0]                       # a blinker: back to horizontal after two steps
```

Because output format equals input format, `life-fold | life-fold` steps two generations and `--steps N` internalises that loop: **`life-fold | life-fold == life-fold --steps 2`**. That closed-under-its-own-I/O loop is the point — it is a fold circulating through its own output channel, each pass confirming the last: a mercury delay line made of live cells.

## The rule

One Conway step, **B3/S23**: a **dead** cell with exactly **3** live neighbours is **born**; a **live** cell with **2 or 3** live neighbours **survives**; everything else is dead next generation. Neighbours are the 8 surrounding cells. The grid is **infinite and sparse** — only live cells are represented, so a glider travels forever and patterns grow without a bounding box.

## It's a fold, not a renderer

The output is the live-cell **set**, not a picture. Cells are a set on input — **duplicates collapse and order is irrelevant** — and **sorted** on output (x then y), so the same generation is a **byte-identical** record no matter how the input was written. That makes it deterministic and re-derivable: a record you hand to a test, a diff, or the next fold.

## Usage

```
usage: life-fold.js [--steps N] [FILE]
  --steps N   run N generations in-process (default 1; N=0 canonicalises)
  (no FILE)   read live cells from stdin
  FILE        read live cells from a file
  --help
```

Each **non-blank line is one live cell as a JSON `[x,y]` integer pair**. Blank lines are skipped. A trailing `\r` (CRLF files) is trimmed. Output is the next generation, same shape, one `[x,y]` per line, sorted. `--steps 0` canonicalises (dedup + sort) without stepping.

A line that is not a JSON array of exactly two **finite integers**, or a `--steps` that is negative or non-integer, is a **hard error (exit 2)** naming the problem — never a silent skip. An empty stream folds to an empty generation.

## What this is *not*

Not a renderer (it emits the live-cell set, not an image), not a bounded grid (it is sparse and unbounded, so gliders travel off any fixed region forever), and not a variant rule (it is exactly B3/S23).

## License

MIT. Zero dependencies — Node builtin `require('fs')` for file reads only; runs in a browser with no `require` at all (attaches `lifeFold` to `window.ForestGifts`).
