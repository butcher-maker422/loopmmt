# l21x-snapshot — portable browser document persistence

A dependency-free layer for the three things every small browser app ends up
needing: turn a document into a **portable snapshot string**, keep a **named
catalog** of them in the browser, and **export/import the whole catalog** as one
file. One file, zero dependencies, runs in a browser or on Node.

## Why this exists

Every browser app eventually rewrites the same three things, badly, from
scratch: serialize the current document to a string you can drop in a URL or a
text field; keep a handful of them under names the user picked; and get all of
it *out* — a backup, a transfer to another machine, a copy to a friend — as one
portable blob. Done casually that's a pile of `localStorage` calls with no
validation, no determinism, and no way to move the data. This is that layer,
done once and honestly.

## The three verbs

- **snapshot** — `encodeSnapshot(doc)` → base64 string; `decodeSnapshot(b64)` →
  doc. A snapshot is a self-contained, portable string. It round-trips exactly,
  including multibyte text (accented names, emoji, non-Latin scripts) — the
  encoder goes through the UTF-8 byte stream, never char codes, so nothing
  corrupts silently.
- **catalog** — a named store of documents in the browser, with
  `catalogSave / catalogLoad / catalogRemove / catalogList` and name validation.
  The store is *injected* (a tiny `{getItem, setItem, removeItem}`), so in a
  browser you pass `window.localStorage`, and in a test you pass an in-memory
  object. The logic is pure and testable off-browser.
- **archive** — `archiveExport(catalog)` → one string; `archiveImport(str)` →
  catalog. The whole catalog as a single portable file: back it up, move it,
  restore it. Import validates the envelope and every entry name, and rejects a
  malformed or foreign archive loudly rather than half-restoring.

## The one fidelity rule

A snapshot is **deterministic**: `encodeSnapshot` sorts object keys at every
level before encoding, so the same document always produces the same base64
string. That is what makes a snapshot **diffable, hashable, and cache-keyable** —
two snapshots are equal iff the documents are equal. The test battery carries a
key-order vector and a pinned golden string precisely to keep this honest.

## Use it

In a browser:

```html
<script src="l21x-snapshot.js"></script>
<script>
  const snap = L21X.encodeSnapshot({ title: "draft", body: "café ☕" });
  L21X.catalogSave(localStorage, "my-app:docs", "draft-1", { title: "draft" }, Date.now());
  const doc = L21X.catalogLoad(localStorage, "my-app:docs", "draft-1");
  const backup = L21X.archiveExport(JSON.parse(localStorage.getItem("my-app:docs")));
</script>
```

On the command line (operates on snapshot strings):

```
echo '{"b":2,"a":1}' | node l21x-snapshot.js encode     # doc (JSON) -> snapshot
node l21x-snapshot.js decode <base64>                   # snapshot -> doc (JSON)
node l21x-snapshot.js roundtrip '{"a":1}'               # prove decode(encode(x)) == x
```

## Its edge (a gift that hides its edges is not a gift)

This **persists and moves** documents. It does **not encrypt** them and it does
**not resolve merge conflicts**. A snapshot is plaintext base64 — anyone who has
the string has the document, so do not put a secret in one and treat the string
as safe. And if two devices edit the same catalog entry independently, the last
`catalogSave` wins; this layer has no notion of a conflict, only of the most
recent write.

## Test

```
node test_l21x-snapshot.js
```

The oracle is round-trip equality against a battery (multibyte, nesting, arrays,
edge values), plus a determinism check and a pinned golden wire string. The core
is mutation-bitten: removing the key-sort or corrupting the encoder turns the
suite red, so a no-op test cannot pass green.

## License

MIT — see [LICENSE](./LICENSE). © 2026 Shea Gunther.
