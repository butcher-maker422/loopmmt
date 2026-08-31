# exif-parser

**Read a photo's EXIF metadata — Make, Model, DateTime, Orientation, exposure, GPS — with no dependencies, in a browser or in Node.**

A photo carries its camera metadata in an EXIF block, which is a little-endian-or-big-endian TIFF stream of Image File Directories (IFDs). You have the file's bytes and you want those fields without pulling in a full image library that decodes pixels you don't care about.

`parseExif(bytes)` is a pure function of its input: no DOM, no dependencies. It finds the EXIF `APP1` segment in a JPEG (or reads a bare TIFF/EXIF block directly), walks the IFD structure, and returns the tags as a flat object of decoded key/value pairs — GPS tags under `gps`.

```js
const { parseExif } = require("./exif-parser.js");

parseExif(bytes);
// -> { Make: "LoopCam", Model: "LM-1", Orientation: 6,
//      FNumber: { num: 28, den: 10, value: 2.8 },
//      gps: { GPSLatitudeRef: "N", GPSLatitude: [ ... ] } }
```

## Why "ratchet"

Like its sibling `ratchet-png-text`, this parser validates structure before it trusts it: the JPEG `SOI` marker, the `Exif\0\0` APP1 signature, the TIFF byte-order marker (`II`/`MM`), the `42` magic, and every IFD-entry offset before it dereferences it. A count or offset that runs past the end of the buffer, a byte-order marker that is neither `II` nor `MM`, an IFD that points outside the block — each is a thrown `Error`, never a value read from nowhere. A parser that hands you a tag value out of a truncated buffer is lying about what the file says; this one won't.

## What it extracts

- **IFD0** (the primary directory) and the **Exif sub-IFD** (tag `0x8769`), merged into one object.
- **GPS sub-IFD** (tag `0x8825`) when present, under `gps:*`.
- Each entry decoded by its TIFF type — `BYTE`, `ASCII`, `SHORT`, `LONG`, `RATIONAL`, and their signed variants, plus `UNDEFINED` (surfaced as raw bytes). `ASCII` is trimmed of its trailing NUL; `RATIONAL` is surfaced as `{ num, den, value }`.
- Common tags are mapped to human names; an unknown tag is surfaced under its hex id (e.g. `0x9999`) so **nothing is silently dropped**.

## The edge

This gift is honest about its scope — a parser that hides its edges is not a gift:

- It **does not decode pixels, thumbnails, or the MakerNote blob** — the MakerNote is vendor-specific and undocumented, so it comes back as raw `UNDEFINED` bytes, never guessed.
- It **follows IFD0 → Exif-IFD → GPS-IFD.** It does not chase IFD1 (the thumbnail directory) or interoperability IFDs.
- It **does not rewrite or strip EXIF**, and it **does not repair a bad file** — malformed input throws, it never guesses.
- GPS is surfaced as raw rational components (`GPSLatitude` as three `RATIONAL`s + a `GPSLatitudeRef`). It does **not** collapse them into a signed decimal degree — that's a presentation choice, and pushing it into the parser would bake one interpretation into the bytes. You compose the decimal yourself.

If you need pixels, thumbnails, or MakerNote decoding, use a full EXIF library. This trades that breadth for a tiny, dependency-free core you can read in one sitting.

## Run it

```
node exif-parser.js photo.jpg      # prints "name<TAB>value" per tag
node exif-parser.js < photo.jpg
```

MIT licensed. One file, zero dependencies, node + browser.
