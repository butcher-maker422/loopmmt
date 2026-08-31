# ratchet-pdf-text

A pure, dependency-free, **strict** extractor of the text drawn by a PDF's
content streams. Same code runs in a browser (`window.LoopGifts.parsePdfText`)
and in Node (`require`, or the CLI). No DOM, no dependencies.

You have a PDF's bytes — an upload, a fetch, a Buffer — and you want the visible
text without pulling in a full PDF engine that also parses fonts, xref tables,
encryption, and page trees you don't care about.

```js
const { parsePdfText } = require("./ratchet-pdf-text.js");
const zlib = require("zlib");
const res = parsePdfText(fs.readFileSync("doc.pdf"), { inflate: zlib.inflateSync });
console.log(res.text);        // the extracted text
console.log(res.streams);     // per-stream provenance
```

## Why "ratchet"

It advances one structure at a time and **refuses to move past anything
malformed**. It validates the `%PDF-` header. For every `stream … endstream`
object it checks the delimiter shape; a declared `/Length` is honoured and a run
past the end of the buffer is a thrown `Error`, never a silently-truncated read.
A parser that hands you text out of a stream it never validated is lying about
what the file says; this one won't.

## What it extracts

The operands of the text-showing operators — `Tj`, `TJ`, `'`, `"` — inside each
content stream, in stream order. Literal strings `( … )` (with `\` escapes and
`\ddd` octal) and hex strings `< … >` are both decoded. `TJ` arrays keep their
string elements and drop the numeric kerning adjustments (they carry no glyphs).

## The compression boundary

Almost every real PDF content stream is **FlateDecode**-compressed, and zlib
inflate is not in the browser's synchronous, dependency-free surface. So the core
stays zero-dependency and **surfaces** each compressed stream as raw bytes; the
text inside is decoded only if you pass an `inflate` function:

- Node: `{ inflate: require("zlib").inflateSync }` — the CLI wires this for you.
- Browser: `{ inflate: pako.inflate }` or any `(Uint8Array) => Uint8Array`.

Without an inflater, a FlateDecode stream is reported with its compressed bytes
on the entry and `text: null` / `needsInflate: true` — never faked. An
**uncompressed** content stream is decoded directly, inflater or not.

## The edge

This gift is honest about its scope — a parser that hides its edges is not a gift:

- It returns the **string operands as written**. It does **not** map character
  codes through a font's `/Encoding` or `/ToUnicode` CMap. That is correct plain
  text for the common WinAnsi / standard-font case, and it is honestly **wrong**
  for a subsetted CID font, where the bytes are glyph indices, not characters.
  If your text comes out as mojibake, that PDF needs CMap mapping this gift does
  not do.
- It gives you drawn strings **in stream order**, not a visual reflow — no
  positional layout, no column detection, no reading-order reconstruction.
- It does not decode object streams (`/ObjStm`), cross-reference streams,
  encrypted PDFs, or images (`DCTDecode` streams are surfaced as raw bytes,
  never guessed).
- It does not inflate on its own (pass `inflate`), and it does not repair a
  broken file — malformed structure throws.

## Run it

```
node ratchet-pdf-text.js doc.pdf            # print the extracted text
node ratchet-pdf-text.js --streams doc.pdf  # one provenance line per stream
node ratchet-pdf-text.js --help
```

## Tests

`test_ratchet-pdf-text.js` — 18 known-answer cases with **out-of-band oracles**
(every expected value is a literal fact, never a second parser's output): Tj / TJ
/ hex / octal / nested-paren / escape decoding, a FlateDecode round-trip decoded
via Node's zlib, the without-inflater surfacing path, ArrayBuffer input, and four
ratchet-refusal cases (bad header, lying `/Length`, missing `endstream`,
unterminated string).

```
node test_ratchet-pdf-text.js
```

## License

MIT. See `LICENSE`.
