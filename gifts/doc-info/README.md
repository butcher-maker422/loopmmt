# doc-info

**Read what a PDF, a Word, PowerPoint or Excel file, or an OpenDocument file says about itself — its title, its author and last editor, its page count — with no dependencies, in Node or the browser, without rendering a page and without trusting a single offset it has not checked.**

A shelf of documents is shelved by what each says about itself: a title and a length. Those facts sit in a PDF's information dictionary and page tree, and in a few small XML parts inside an office file's zip. Reading them should need neither a PDF engine nor an office suite, nor a network.

`readDocInfo(bytes, {inflate, inflateRaw})` is a pure function of the bytes and the decompressor you hand it. In Node, `nodeInflaters(require("zlib"))` gives you both.

```js
const { readDocInfo, nodeInflaters } = require("./doc-info.js");

readDocInfo(require("fs").readFileSync("ledger.pdf"), nodeInflaters(require("zlib")));
// -> { format: "pdf", title: "The Mill Pond Ledger & Notes", creator: "Ada Quill", last_modified_by: null,
//      pages: 3, encrypted: false, unreached: [] }

readDocInfo(require("fs").readFileSync("ledger.docx"), {});          // no decompressor handed
// -> { format: "ooxml", title: null, ..., unreached: ["creator:needs-inflate", "last_modified_by:needs-inflate",
//      "pages:needs-inflate", "title:needs-inflate"] }
```

## What it reads

- **PDF**: the newest revision's information dictionary (`/Title`, `/Author`) and the page tree's `/Count`, through classic cross-reference tables, cross-reference streams (with the PNG predictor), hybrid files, linearized files, incremental updates and compressed object streams. Strings in PDFDocEncoding, UTF-16BE or UTF-8.
- **OOXML** (`.docx`, `.pptx`, `.xlsx`): `[Content_Types].xml`, the package relationships, and the core and extended properties parts they name: title, creator, last editor, and `Pages` for a document or `Slides` for a deck. A sheet has no page count.
- **ODF** (`.odt`, `.odp`, `.ods`): `meta.xml` (title, initial creator, last editor, the page count a text document states) and the manifest's encryption marks.
- **What it could not read, and why**: `unreached` lists `field:reason` — `encrypted`, `needs-inflate`, `unsupported-filter`, `malformed`, `xmp-only` or `budget`. A property the document simply does not state is `null` with no reason.

## Checked before trusted

A document is untrusted bytes. Every cross-reference offset, object header, stream length, object-stream slot, zip directory record, local header, data descriptor, declared size and CRC-32 is checked before it is used; relationship targets are resolved inside the package and their content types checked; XML is read by a bounded tokenizer that refuses any DTD and expands each reference once. One budget bounds the whole read: 8 MiB of decoded bytes, 4,096 objects, a million tokens, nesting 32, 64 revisions. Anything malformed throws `DocInfoError` with a code (`format`, `structure`, `budget`, `inflate`) and a reason.

## What it does not do

It reads only the metadata a document states about itself and the structure needed to find it — its title, its people and its page count — and never renders a page, extracts content or runs code.

It never decrypts: an encrypted PDF's title and author come back `null` with the reason `encrypted`. It does not read XMP metadata, Zip64 archives, legacy binary Office files or flat single-XML ODF. A decompressor you hand it must honour the output bound it is given; the result's length is checked again either way.

## Run it

```
node doc-info.js ledger.pdf          # sorted-key JSON; exit 3 on a malformed file
node test_doc-info.js                # the tests (pdfinfo and python3 checks run when installed, with fixtures/ beside them)
```

MIT licensed. One file, zero dependencies, Node and browser.
