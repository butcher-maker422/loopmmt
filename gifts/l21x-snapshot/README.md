# l21x-snapshot

A zero-dependency browser document persistence layer — a save-file, catalog, and
archive layer for apps that hold documents in memory and need to persist, list,
and move them without a backend.

## What it does

Three tiers, all pure functions over values you already hold — no DOM, no
filesystem, no network:

1. **Snapshot codec** — `encodeSnapshot(doc)` turns any JSON-serializable document
   into a self-describing base64 string (an `.l21x` snapshot); `decodeSnapshot(str)`
   gives it back, verified. The snapshot stamps its own format tag and version, so
   it names its own shape and refuses to decode a foreign string.
2. **Catalog** — an in-memory list of snapshot entries with pure
   `catalogSave` / `catalogLoad` / `catalogValidate` / `catalogSort`. Save returns
   a *new* catalog keyed by an id you supply and never mutates its input; validate
   reports honest structural errors; sort orders by a named field, stably.
3. **Archive** — `archiveExport(catalog)` collapses a whole catalog into *one*
   base64 blob (download one file, paste into another tab); `archiveImport(blob)`
   round-trips it back exactly.

## Example

```js
var l21x = require("./l21x-snapshot.js");   // browser: window.LoopGifts.l21x

// snapshot one document
var snap = l21x.encodeSnapshot({ title: "Notes", body: "hello" }, { title: "Notes" });
var back = l21x.decodeSnapshot(snap);       // { title, schema, doc, v }

// build a catalog (each call returns a NEW catalog)
var cat = [];
cat = l21x.catalogSave(cat, "note-1", { body: "first" },  { title: "First",  updated: "2026-08-01" });
cat = l21x.catalogSave(cat, "note-2", { body: "second" }, { title: "Second", updated: "2026-08-15" });

l21x.catalogLoad(cat, "note-1").doc;        // { body: "first" }
l21x.catalogSort(cat, "updated", true);     // newest first
l21x.catalogValidate(cat);                  // { ok: true, errors: [] }

// move the whole catalog as one string
var archive = l21x.archiveExport(cat);      // one base64 blob
var restored = l21x.archiveImport(archive); // deep-equal to cat
```

## Contract

- `encodeSnapshot(doc, meta?)` → base64 string. Throws if `doc` is `undefined` or
  not JSON-serializable.
- `decodeSnapshot(str)` → `{ title, schema, doc, v }`. Throws on an empty, foreign,
  or malformed string (it never returns a half-parsed value).
- `catalogSave(catalog, id, doc, meta?)` → a **new** catalog; replaces by `id`.
  Throws on an empty `id`. Never mutates its input.
- `catalogLoad(catalog, id)` → the decoded `{ title, schema, doc, v }`, or `null`.
- `catalogValidate(catalog)` → `{ ok, errors[] }`; reports every problem
  (missing/duplicate id, undecodable snapshot), not just the first.
- `catalogSort(catalog, key, desc?)` → a **new** sorted catalog. Stable; missing
  values sort **last** in both directions.
- `archiveExport(catalog)` → one base64 blob. Refuses to export an invalid catalog.
- `archiveImport(blob)` → the catalog array. Throws on a foreign/malformed blob.

## Edge & scope (honest)

- It persists **structure**, not identity: it does not generate ids, timestamps, or
  hashes — you pass the `id` and any `updated` value. Sorting by `updated` is only as
  meaningful as the values you record.
- Snapshots are base64, **not compressed and not encrypted** — smaller than raw JSON
  only incidentally, and readable by anyone who has the string.
- It is a *layer*, not a store: it produces strings for you to hand to
  `localStorage`, a file download, or a text field. It does not itself touch
  `localStorage`, the DOM, or the disk.
- `decodeSnapshot` verifies the format tag and version; it does **not** validate the
  *shape* of your document — that is your schema's job.

## Run it

```
node l21x-snapshot.js --demo     # build a sample catalog, archive + round-trip it
node l21x-snapshot.js '{"a":1}'  # encode one JSON document as an .l21x snapshot
node test_l21x-snapshot.js       # the oracle: 41 behavioral checks + a mutation-bite
```

MIT © 2026 Shea Gunther.
