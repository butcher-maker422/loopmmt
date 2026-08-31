# ratchet-inline-mime

A pure, dependency-free **MIME message parser**. Hand it the raw text of an email
or any RFC 822 / MIME document and it returns a structured tree: unfolded headers,
a parsed `Content-Type` with its parameters, and — for every leaf — a body decoded
per its `Content-Transfer-Encoding` and charset. `multipart/*` bodies are split on
their boundary and each part parsed recursively, to any depth. Same code in a
browser (`window.LoopGifts.parseMime`) or Node — no DOM, no dependencies, and it
never touches the filesystem.

```js
const { parseMime } = require("./ratchet-inline-mime.js");

const node = parseMime(
  "Subject: =?utf-8?B?SGVsbG8sIOKCrA==?=\r\n" +
  "Content-Type: text/plain; charset=utf-8\r\n" +
  "Content-Transfer-Encoding: quoted-printable\r\n\r\n" +
  "Coffee costs 5=E2=82=AC.\r\n"
);
// node.headers.subject === "Hello, €"      (RFC 2047 encoded word decoded)
// node.contentType     === "text/plain"
// node.body            === "Coffee costs 5€.\n"  (quoted-printable + utf-8)
```

## The contract

`parseMime(raw) -> node`, where a **node** is either a leaf or a multipart:

- `headers` — a `{ lower-cased-name: value }` map; folded headers are unfolded and
  RFC 2047 encoded words in the value are decoded. `rawHeaders` keeps the ordered,
  undecoded `[name, value]` list.
- `contentType` — the lower-cased `type/subtype`; `contentTypeParams` — its
  parameters (`charset`, `boundary`, `name`, …), unquoted.
- `encoding` — the `Content-Transfer-Encoding` (default `7bit`).
- **leaf:** `body` (decoded string) and `bodyRaw` (the undecoded body).
- **multipart:** `isMultipart: true` and `parts` — an array of child nodes; no
  `body` of its own.

Also exported: `decodeBase64`, `decodeQuotedPrintable`, `decodeEncodedWords`,
`bytesToString`, `parseStructured`, `summarize`.

## What it decodes (stated so the scope can't hide)

- **Transfer-encodings:** `base64`, `quoted-printable` (including `=` soft line
  breaks), and `7bit` / `8bit` / `binary` (identity). An unknown encoding is
  treated as identity.
- **Charsets:** `utf-8` (full multibyte, incl. surrogate pairs) and the
  byte-preserving `ascii` / `iso-8859-1` / `windows-1252` family. **Any other
  charset falls back to utf-8** — it is not transcoded from its native encoding,
  because that would require code tables this stays free of. It decodes structure
  faithfully; exotic legacy charsets are the honest edge.
- It parses; it does not validate. A malformed message is parsed as far as it
  reasonably can (missing closing boundary, headers with no body) rather than
  thrown at — the tree reflects what was there.

## Run it

```
node ratchet-inline-mime.js --demo
node ratchet-inline-mime.js '<raw mime message>'
cat message.eml | node ratchet-inline-mime.js
node test_ratchet-inline-mime.js
```

MIT © 2026 Shea Gunther.
