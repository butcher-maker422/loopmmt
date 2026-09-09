# ratchet-pdf-dict

A pure, dependency-free, **strict** extractor of the text a PDF carries in its
object **dictionaries** rather than its content streams — AcroForm field values
(`/V`) and annotation notes (`/Contents`). Same code runs in a browser
(`window.LoopGifts.parsePdfDict`) and in Node (`require`, or the CLI). No DOM, no
dependencies.

It is the companion to [`ratchet-pdf-text`](../ratchet-pdf-text/). That tool pulls
the text a PDF **draws** (the operands of `Tj`/`TJ` inside content streams). This
one pulls the text a PDF **stores but never draws**: what a user typed into a
form field, and the note behind a sticky annotation. Together they cover every
text surface in a PDF.

```js
const { parsePdfDict } = require("./ratchet-pdf-dict.js");
const res = parsePdfDict(fs.readFileSync("form.pdf"));
console.log(res.text);        // the dictionary text, records joined by "\n"
console.log(res.records);     // per-record provenance (obj, kind, key, name, encoding)
console.log(res.malformed);   // per-object values that failed to decode
```

## Why "ratchet"

Same posture as the twin, applied at the right scale. `ratchet-pdf-text` reads
one content stream as a whole, so any malformed byte is a thrown `Error`. This
tool walks **many** indirect objects, so the contract is split across two levels
on purpose:

- **Document level — throws.** Input that isn't a `Uint8Array`/`ArrayBuffer`, or
  a buffer with no `%PDF-` header, is a thrown `Error`. If it isn't a PDF, you
  get told, not a guess.
- **Object level — records, does not throw.** One malformed value (an
  unterminated string, a bad hex byte) does **not** abort the walk and lose the
  200 good fields after it. It is emitted as an explicit
  `{ malformed: true, reason }` record and the walk continues. This keeps
  ratchet's real vow — *never hand back a guess as if it were clean text* —
  because a malformed value is **stamped** malformed, never returned as clean.

## What it extracts

- **Field values** — a `/V` entry whose value is a string, paired with the
  field's `/T` partial name as the record `name`. Literal strings `( … )` (with
  `\` escapes and `\ddd` octal) and hex strings `< … >` are both decoded. A `/V`
  given as an indirect reference to a string object is resolved one level and
  reported with `encoding: "ref"`.
- **Annotation text** — a `/Contents` entry whose value is a string.
- **Field labels** — a `/TU` entry, **only** when you pass `{ labels: true }`.
  Off by default: the covenant is field values and notes; labels are an opt-in
  surface, named here so their absence isn't a surprise.

Each record: `{ obj, kind: "field"|"annotation"|"label", key, name, text, encoding }`.

## The `/Contents` disambiguation

`/Contents` names two unrelated things: an annotation's text (a string) **and** a
page's content-stream pointer (an indirect reference, `12 0 R`). This tool pulls
`/Contents` **only when its value is a string**, and skips it when the value is a
reference — so a page's content pointer is never mistaken for annotation text.
The disambiguation is by **value type**, not by classifying the object.

## The edge

This gift is honest about its scope — a parser that hides its edges is not a gift:

- It reads the **top-level dictionary** of each indirect object. A `/V` or
  `/Contents` buried in a nested sub-dictionary is not a target.
- It does **not** resolve field hierarchies through `/Kids` — it reads `/V` where
  it sits, not values inherited from a parent field.
- It resolves an indirect `/V` **one level** (to a bare string object). A chain
  of references, or a `/V` pointing at a stream, is out of scope.
- It returns the **string as written**. It does **not** map character codes
  through a font's `/Encoding` or `/ToUnicode` CMap — correct for the common
  WinAnsi case, honestly wrong for a subsetted CID font.
- It does **not** decrypt encrypted PDFs, decode object streams (`/ObjStm`) or
  compressed cross-reference streams, or repair a broken file.

## Run it

```
node ratchet-pdf-dict.js form.pdf            # print the dictionary text
node ratchet-pdf-dict.js --records form.pdf  # one provenance line per record
node ratchet-pdf-dict.js --labels form.pdf   # also include /TU field labels
node ratchet-pdf-dict.js --help
```

## Tests

`test_ratchet-pdf-dict.js` — 14 known-answer cases with **out-of-band oracles**
(every expected value is a literal fact, never a second parser's output): a text
field with its `/T` name, an annotation string, the `/Contents` page-ref
disambiguation, one-level indirect-ref resolution, hex and escaped-literal
decoding, the malformed-value-recorded-walk-continues path, the `/TU` opt-in
flag, a widget carrying both surfaces, and two ratchet-refusal cases (missing
header, non-buffer input).

```
node test_ratchet-pdf-dict.js
```

## The composition

`ratchet-pdf-text` reads a PDF's content streams. `ratchet-pdf-dict` reads its
dictionaries — the form values and annotation notes the streams never carried.
[`legible`](../legible/) grades either for readability. Together: every text
surface in a PDF, honestly — and each one records what's broken instead of
guessing.

## License

MIT. See `LICENSE`.
