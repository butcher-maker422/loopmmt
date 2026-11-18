# matroska-header

**Read a Matroska or WebM file's header — running time, tracks with codec and language, the six track flags, editions of ordered chapters — with no dependencies, in Node or the browser, without decoding a frame and without reading the whole file.**

A film in `.mkv` keeps the facts you shelve it by in its first few kilobytes: how long it runs, which video and audio streams it holds, in which codecs and languages, which subtitle track is forced, which audio track is the original or the audio description, and whether the one file holds several cuts of the film as editions of ordered chapters. You want those facts without a media framework, a decoder or a gigabyte read.

`readMatroskaHeader(bytes)` is a pure function of the bytes it is handed. Give it the whole file, or give it windows of one file (its head and its tail), and it walks the EBML tree over exactly those bytes.

```js
const { readMatroskaHeader, readFileWindows } = require("./matroska-header.js");

readMatroskaHeader(readFileWindows(require("fs"), "film.mkv"));
// -> { doc_type: "matroska", duration_ns: 5400000000000, title: "The Lantern Coast",
//      tracks: [ { number: 1, kind: "video", codec_id: "V_MPEGH/ISO/HEVC", video: { width: 3840, height: 1600 }, ... },
//                { number: 3, kind: "audio", codec_id: "A_AAC", language: "pt-BR", language_iso639_2: "por",
//                  flags: { default: false, forced: false, hearing_impaired: null, visual_impaired: true,
//                           descriptions: true, original: null } }, ... ],
//      editions: [ { uid: "200", ordered: true, chapters: [ { start_ns: 120000000000, end_ns: 180000000000,
//                    titles: [ { title: "Extended scene", language: "en-GB" } ] } ] } ],
//      unreached: [] }
```

## What it reads

- **Running time**: the header's Duration × TimestampScale, in nanoseconds. Absent Duration is `null`, never zero.
- **Tracks**: number, UID (a decimal string, because a UID is any 64-bit value), kind, codec id, name, video size or audio rate and channels.
- **Language**: the BCP 47 tag when the file has one, else the three-letter code, else the spec's default `eng` (marked `language_defaulted`). Both raw values come back too.
- **The six flags**: `default` and `forced` take the spec's defaults when absent. `hearing_impaired`, `visual_impaired`, `descriptions` and `original` have no default in the spec, so an absent one is `null`: unknown, not false.
- **Editions and chapters**: each edition's default, ordered and hidden flags; its chapters in stored order with start and end in nanoseconds and their titles with languages; nested chapters.
- **What it could not reach**: `unreached` names any of Info, Tracks or Chapters that the windows did not hold whole. It is never filled in by a guess.

## Checked before trusted

A media file is untrusted bytes. The EBML magic, the doc type (`matroska` or `webm`), every variable-length integer, every child against its parent, an unknown size only where the spec allows one, a nesting bound, a string bound and a work bound are all checked first. Anything malformed throws `MatroskaError`. It never reads inside a Cluster, where the frames are.

## What it does not do

It reads the container's header, never the media: no frame is decoded, nothing checks that a stream matches what its header says, and Tags (titles, artists, ratings) and Attachments (cover art, fonts) are not read. It reads only the windows it is handed and names every header element it could not reach whole, never guessing. The running time is the header's Duration, which a muxer can write wrong: it is read, not measured.

Three element IDs (LanguageBCP47, FlagTextDescriptions, ChapLanguageBCP47) follow RFC 9559 but were not read back by the ffprobe 6.1 the tests run against, which ignores them; every other ID was.

## Run it

```
node matroska-header.js film.mkv        # JSON; reads the first 4 MiB and the last 1 MiB
node test_matroska-header.js            # the tests (ffprobe checks run when ffmpeg is installed)
```

MIT licensed. One file, zero dependencies, Node and browser.
