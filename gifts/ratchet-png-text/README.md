# ratchet-png-text

**Extract the text metadata (tEXt / zTXt / iTXt) from a PNG — strictly, with no dependencies, in a browser or in Node.**

A PNG can carry human-readable metadata — `Title`, `Author`, `Description`, `Software`, `Copyright`, an XMP packet — in its `tEXt`, `zTXt`, and `iTXt` chunks. You have the file's bytes and you want those key/value pairs without pulling in a full image decoder that parses pixels you don't care about.

`parsePngText(bytes)` is a pure function of its input: no DOM, no dependencies. It walks the PNG chunk stream and returns the text entries in file order.

## Why "ratchet"

It's a ratchet parser: it advances one chunk at a time and **refuses to move past anything malformed**. It validates the 8-byte PNG signature, and for **every** chunk it recomputes the CRC-32 over `(type + data)` and rejects a mismatch. A length that runs past the end of the buffer, a stream that ends before `IEND`, a text chunk missing its null separator — each is a thrown `Error`, never a silently-truncated string. A parser that hands you text out of a corrupt chunk is lying about what the file says; this one won't.

## What it extracts

- **tEXt** — uncompressed Latin-1 keyword + text. Decoded directly.
- **iTXt (uncompressed)** — UTF-8 keyword, language tag, translated keyword, and text. Decoded directly.
- **zTXt and compressed iTXt** — the keyword and metadata are decoded, and the raw zlib-compressed text bytes are surfaced on the entry as `compressedText`. The text itself is decoded **only if you pass an `inflate` function** in the options.

```js
const { parsePngText } = require("./ratchet-png-text.js");

// tEXt / uncompressed iTXt: text is decoded with zero dependencies
parsePngText(bytes);
// -> [ { kind: "tEXt", keyword: "Title", text: "A Quiet Loop", compressed: false } ]

// zTXt / compressed iTXt: pass an inflater to decode the text
const zlib = require("zlib");
parsePngText(bytes, { inflate: (b) => zlib.inflateSync(Buffer.from(b)) });
```

## The edge

This gift is honest about its scope — a parser that hides its edges is not a gift:

- It **does not decode pixels, IHDR geometry, palettes, gamma, or any non-text chunk.** It walks the whole chunk stream (validating every CRC it steps over) but returns only the text entries.
- It **does not inflate compressed text on its own.** `zlib` inflate is not part of the browser's synchronous, dependency-free surface, so the core stays DOM-free and zero-dependency and lets *you* choose the inflater — Node's `zlib.inflateSync`, `pako`, a `DecompressionStream` wrapper. Without one, a `zTXt`/compressed-`iTXt` entry comes back with `compressed: true`, `text: null`, and its raw `compressedText` bytes.
- It **does not repair a bad file.** Malformed input throws; it doesn't guess.

If you need pixels, palettes, or built-in decompression, use a full PNG library. This trades that breadth for a tiny, dependency-free core you can read in one sitting.

## Run it

```
node ratchet-png-text.js cover.png     # one line per text entry: keyword<TAB>text
node ratchet-png-text.js --help
```

The CLI (Node only) supplies Node's `zlib` as the inflater so compressed text is decoded on the command line; the shipped core stays dependency-free.

## Tests

```
node test_ratchet-png-text.js
```

The oracle is the PNG spec expressed as **curated, real PNG byte fixtures** built in-test (genuine signature + chunks with correct CRC-32 + `IEND`), covering `tEXt`, uncompressed `iTXt`, `zTXt`, compressed `iTXt`, the no-text case, and the malformation set (bad signature, CRC mismatch, truncation, missing `IEND`, missing separators, bad length, non-buffer input). The compressed path is cross-checked against Node's own `zlib` as a **live-reference backstop**, plus determinism and a mutation-bite.

## License

MIT — copy it, modify it, ship it. The full text is in `LICENSE`.
