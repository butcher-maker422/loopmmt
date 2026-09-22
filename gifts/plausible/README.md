# plausible

**A heuristic gauge: does this string look like plausible natural-language text, or clean-but-wrong output?**

The sibling of [`legible`](../legible/), on the orthogonal axis. `legible` asks
*"is this control-character rubble?"* — it catches byte-level garbage. But a
whole class of extraction failure produces clean, fully printable output and is
still wrong, and `legible` reads every one of them as `readable`, because none of
them touch the C0/`U+FFFD` band:

- **mojibake** — the wrong charset, so `Müller` arrives as `MÃ¼ller`
- **custom glyph-to-ASCII encodings** with no ToUnicode CMap
- **missing word boundaries** — glyphs positioned without spaces, so `thewordsallruntogether`
- **hyphenation artifacts** at PDF line breaks

`plausible` reads the delta `legible` can't: *does this look like language at
all?* Give it a string (or any record with a `.text` field) and it returns a
label — `prose`, `suspect`, `garbled`, or `empty` — with the raw score and the
signal counts exposed so you can see exactly why.

```
$ node plausible.js "The quick brown fox jumps over the lazy dog."
{"label":"prose","score":0,"signals":{"length":44,"mojibake":0,"mojibakeRatio":0, ... }}
$ node plausible.js "MÃ¼ller went to the cafÃ©"
{"label":"suspect","score":...,"signals":{"mojibake":2, ... }}
```

## The load-bearing rule — the same move `legible` makes, one axis over

`legible` **reports** the C1 band but refuses to **score** it, because scoring it
would false-positive on Cyrillic/CJK decoded as Latin-1. `plausible` makes the
identical cut, and the line is **language-dependence**:

**Scored** — structural, language-agnostic signals only:

- **the mojibake fingerprint** — a byte-structural decode artifact, not a
  language stat. When UTF-8 bytes are shown through a single-byte codec, a
  multibyte sequence renders as a lead char (`0xC2–0xF4`) followed by a
  continuation char — the raw Latin-1 range (`0x80–0xBF`) *or* a Windows-1252
  remap of it (curly quotes, dashes, `€`, `™`). Both are counted, so the
  fingerprint catches both common confusions, not just the textbook one. This is
  the strongest signal, and it carries the label.
- **space / word-boundary density, SCRIPT-GATED** — it is suppressed (and merely
  exposed) when the string is a non-spaced script (CJK, Thai, Lao, Khmer,
  Myanmar), which legitimately has no spaces. It will **not** call Japanese
  garbled. (Korean is deliberately *not* gated — Hangul uses spaces.)
- **trailing-hyphen-before-linebreak rate** — a structural artifact of PDF line
  hyphenation, meaningful across ≥3 lines.

**Exposed, never scored** — language-specific signals:

- **`letterFreqDevEn`** — deviation from English letter frequencies. Scoring it
  would punish Finnish, Turkish, Welsh — every language that isn't the reference.
  Surfaced raw so a caller who knows their language can weigh it.
- **`meanWordLength`** — skews hard by language; same treatment.

Only the mojibake fingerprint can drive the label to `garbled` on its own; the
boundary and hyphen signals are bounded so they reach `suspect`, not `garbled` —
the label leans where it is grounded.

| label | condition (default) | means |
|---|---|---|
| `prose` | score ≤ 0.05 | looks like plausible natural-language text |
| `suspect` | 0.05 < score < 0.30 | some tell present — read the signals |
| `garbled` | score ≥ 0.30 | dense mojibake (or bounded boundary/hyphen) |
| `empty` | null / "" / whitespace-only | no text to judge |

## Composition

`plausible` post-composes onto any extractor's output, exactly like `legible` —
and the two are meant to run together: `legible` on the rubble axis, `plausible`
on the plausibility axis, both feeding a downstream policy router.

```js
const { plausible } = require("./plausible.js");
const { legible }   = require("../legible/legible.js");

const judged = streams.map(s => plausible(legible(s)));
// each entry now carries both { legibility: {...}, plausibility: {...} }
const trust = judged.filter(s =>
  s.legibility.label === "readable" && s.plausibility.label === "prose");
```

Or as a pipe, over JSONL records that each carry a `.text` field:

```
… produce one JSON record per line with a .text field … | node plausible.js
```

## What it does NOT do (the edge)

`plausible` is a **heuristic, not a verdict**. *"Implausible as prose"* is **not**
*"wrong extraction"*: code, tables, log lines, base64, URLs, poetry, and
non-spaced scripts all read implausible and can be perfectly correct — it flags a
smell, you read it. It is **language-agnostic by design**, so deliberately weaker
than a real per-language model — the price of not lying about languages it does
not know. The mojibake fingerprint targets the two common confusions (UTF-8 shown
as Latin-1 and as Windows-1252); it will not catch every charset mixup. It reads
**shape, not intent** — plausible prose can still be a well-formed prompt
injection. It never decodes, corrects, or understands the text. It is a gauge you
read, never a gate you route on.

## Run

```
node plausible.js "some text"          # assess an argument, print JSON
cat streams.jsonl | node plausible.js  # annotate each JSONL record's .text
node plausible.js --port               # print the port-verb (transform)
node plausible.js --help
```

Zero dependencies, Node or browser (`window.LoopGifts.plausible`). MIT.
