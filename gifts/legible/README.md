# legible

**A heuristic gauge: is this string readable text, or machine-drawn rubble?**

A text extractor — `ratchet-pdf-text`, `ratchet-png-text`, `exif-parser`, a MIME
part decoder — hands you a `.text` field and, by design, cannot tell you whether
that text is *readable*. The classic failure is a PDF whose glyphs are drawn
through a subsetted CID font: the extractor pulls the string operands honestly,
but each glyph is a 2-byte CID index, and decoded one byte at a time it comes
back as control-character rubble that merely *looks* like a populated string.
You get a confident `.text` no human can read.

`legible` reads the gap the extractor can't. Give it a string (or any record
with a `.text` field) and it returns a label — `readable`, `suspect`,
`likely-binary`, or `empty` — with the raw score and the signal counts exposed
so you can see exactly why.

```
$ node legible.js "Hello, world!"
{"label":"readable","score":0,"signals":{"length":13,"control":0,"c1":0,"nul":0,"replacement":0,"binaryRatio":0}}
```

## The signal

Human-readable text — in **any** script — almost never contains C0 control
characters (`0x00–0x1F`, excluding the ordinary text whitespace tab/LF/CR/FF) or
the Unicode replacement character `U+FFFD`. CID glyph indices decoded as Latin-1
land in exactly that band disproportionately. So the **scored** gauge is the
density of those "text-never-contains-this" characters — C0 controls plus
`U+FFFD`, nothing else.

This is deliberately **not** the printable ratio. A UTF-8 `é` / `안` / `я`
decoded byte-wise lands in `0x80–0xFF`, which overlaps the C1-control band
(`0x80–0x9F`) and the UTF-8 continuation-byte band. Scoring C1 would flag
legitimate multibyte text as binary — the CJK false-positive. `legible` reports
C1/DEL and NUL counts as **signals** for your inspection, but does **not** score
them, so multibyte-as-Latin1 does not read as rubble.

The three bands (all overridable):

| label | condition (default) | means |
|---|---|---|
| `readable` | score ≤ 0.05 | almost no control-character density |
| `suspect` | 0.05 < score < 0.30 | some rubble mixed in — inspect |
| `likely-binary` | score ≥ 0.30 | mostly control characters (the CID case) |
| `empty` | null / "" / whitespace-only | no text to judge |

## Composition

`legible` post-composes onto any extractor's output. Annotate every stream a PDF
draws with a readability read:

```js
const { parsePdfText } = require("../ratchet-pdf-text/ratchet-pdf-text.js");
const { legible } = require("./legible.js");
const zlib = require("zlib");

const { streams } = parsePdfText(pdfBytes, { inflate: zlib.inflateSync });
const judged = streams.map(legible);
// each entry now carries { ..., legibility: { label, score, signals } }
const suspect = judged.filter(s => s.legibility.label !== "readable");
```

Or as a pipe, over JSONL records that each carry a `.text` field:

```
… produce one JSON record per line with a .text field … | node legible.js
```

## What it does NOT do (the edge)

`legible` is a **heuristic, not a verdict**, and it detects control-character
rubble — **not wrong encoding**. Text decoded with the wrong charset (mojibake:
UTF-8 read as Latin-1, `æ—¥æœ¬èªž`) is still printable characters, so it reads as
`readable` even though no human can read it — a `readable` means *"not
control-char rubble,"* never *"correctly decoded."* It does not decode, validate,
or understand the text, and never proves it correct, meaningful, or safe. It is a
gauge you read, never a gate you route on.

## Run

```
node legible.js "some text"          # assess an argument, print JSON
cat streams.jsonl | node legible.js  # annotate each JSONL record's .text
node legible.js --port               # print the port-verb (transform)
node legible.js --help
```

Zero dependencies, Node or browser (`window.LoopGifts.legible`). MIT.
