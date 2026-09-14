# merkle-fold

**Fold a JSONL leaf stream into one tamper-evident Merkle root.**

A tiny, dependency-free tool that reads a stream of leaves — one JSON value per line ([JSON Lines](https://jsonlines.org/)) — and folds them into a single 64-character hex Merkle root. Publish the root once; anyone with the same leaves can recompute it and prove nothing was altered. Change any one leaf, add a leaf, drop a leaf, or reorder two leaves, and the root changes.

```
printf '%s\n' '"a"' '"b"' '"c"' | node merkle-fold.js
```

## How the tree is built (RFC 6962)

merkle-fold uses the [RFC 6962](https://www.rfc-editor.org/rfc/rfc6962) Certificate Transparency construction — two rules, and the one-byte prefix between them is the whole security story:

```
leaf hash      = SHA-256(0x00 || leaf-bytes)
internal hash  = SHA-256(0x01 || left-hash || right-hash)
```

The `0x00` / `0x01` prefixes are **domain separation**: they are what give the tree second-preimage resistance. Without them, an attacker could present an internal node's two children as if they were a pair of leaves and forge a different tree with the same root.

When a level has an odd number of nodes, RFC 6962 **promotes the odd node unchanged** to the next level rather than duplicating it. That is deliberately *not* the Bitcoin shape: Bitcoin duplicates the last node, which is the source of a known root-collision ambiguity (the CVE-2012-2459 class). Promoting instead of duplicating means the tree may be imbalanced, but its shape is uniquely determined by the leaf count. An empty stream folds to `SHA-256("")`.

## Usage

```
usage: merkle-fold.js [--json] [--canon] [FILE]
  (no FILE)     read leaves from stdin
  FILE          read leaves from a file
  --json        emit {"root": "...", "leaves": N} instead of the bare root
  --canon       parse each line as JSON and hash its CANONICAL form (object keys
                sorted, array order kept), so a key-reordered record folds to the
                same root; fails closed (exit 2) on a line that is not valid JSON
  --help
```

Each **non-blank line is one leaf**. Blank lines are skipped. A trailing `\r` (CRLF files) is trimmed, so a file's line endings never change the root. By default a leaf's bytes are the UTF-8 bytes of the line **as written**, so two byte-identical files always fold to the same root. With `--canon`, equal-but-differently-written JSON records (key order, insignificant whitespace) fold to the same root.

Example:

```
$ printf '%s\n' '{"id":1}' '{"id":2}' '{"id":3}' | node merkle-fold.js
fe6e9d4604f578602851a2c15ef3894ca07b9517f7d5f7dedc28179ca888580d

$ printf '%s\n' '{"id":1}' '{"id":2}' '{"id":3}' | node merkle-fold.js --json
{"root":"fe6e9d4604...","leaves":3}
```

Exit codes: `0` success, `2` input error (missing file, a directory, or — under `--canon` — a line that is not valid JSON), always a clean one-line message, never a stack trace.

## Runs in a browser too

`merkle-fold.js` is zero-dependency and side-effect-free on load. In a browser it attaches `merkleFold`, `merkleRoot`, and `sha256Hex` to `window.ForestGifts`; under Node it exports the same via `module.exports`.

```js
const { fold } = require("./merkle-fold.js");
fold('"a"\n"b"\n"c"').root; // -> a 64-char hex root
```

## The edge — what this does NOT do

This proves an **ordered sequence of leaves is intact**. It is **not a set hash** — reorder two leaves and the root changes, which is the point, not a bug. It is **not a signature** — it keeps no secret, so anyone who has the leaves can recompute the root (it proves *integrity*, not *authorship*). It is **not encryption** — the leaves are not hidden. And a Merkle root proves the *whole set* is intact; producing a compact inclusion proof for a single leaf is a related but separate tool this gift does not ship.

## License

MIT. The SHA-256 core is vendored from the companion `sha256` gift (FIPS 180-4), so this stays a single, dependency-free file.
