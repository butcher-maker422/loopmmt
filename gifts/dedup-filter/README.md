# dedup-filter

**Drop duplicate records from a JSONL stream — first one wins, order stable.**

A tiny, dependency-free tool that reads a stream of records — one JSON value per line ([JSON Lines](https://jsonlines.org/)) — and passes them through, dropping every record it has already seen. The output is a **subset** of the input in the **original order**: the first occurrence of each record is kept, every later duplicate is dropped. Same stream in, byte-identical stream out, on every machine and every run.

```
printf '%s\n' '{"id":1}' '{"id":1}' '{"id":2}' | node dedup-filter.js
```

It is a **filter** — output ⊆ input. Nothing is added, reordered, or rewritten; the kept lines are emitted exactly as they arrived.

## What counts as a duplicate

Two modes, and the identity key is the only thing that differs.

**Default — whole-record identity.** A record's key is its **canonical JSON form**: re-serialized with object keys sorted, recursively. So `{"a":1,"b":2}` and `{"b":2,"a":1}` are the **same** record (key-order in an object is not meaningful) and the second is dropped — but `[1,2]` and `[2,1]` are **different** (array order *is* meaningful). Canonicalizing the *key*, not the *line*, is what makes "same record written two ways" deduplicate while still emitting the original line untouched.

**`--key FIELD` — dedup by one field.** The record's key is the value of the named top-level field, canonicalized the same way. The **first** record carrying a given field value is kept; later records with that same value are dropped even if the rest of the record differs. A record that **lacks** the field is passed through and never dedups against anything — a missing key is not a value.

## First wins, order stable

The kept record for any key is always the **first** one seen; the relative order of the kept records is exactly their input order. This is a deliberate, pinned choice (not "last wins", not "sorted"): it makes the filter one-pass and the output a stable, re-derivable subset of the input.

## Usage

```
usage: dedup-filter.js [--key FIELD] [--count] [FILE]
  (no FILE)     read records from stdin
  FILE          read records from a file
  --key FIELD   dedup by one top-level field instead of the whole record
  --count       write the number of dropped duplicates to stderr
  --help
```

Each **non-blank line is one JSON record** (object, array, string, number, bool, or null). Blank lines are skipped. A trailing `\r` (CRLF files) is trimmed. Output is the kept records, one per line, in input order.

Example:

```
$ printf '%s\n' '{"id":1,"v":"a"}' '{"id":1,"v":"b"}' '{"id":2,"v":"c"}' | node dedup-filter.js --key id
{"id":1,"v":"a"}
{"id":2,"v":"c"}
```

Exit codes: `0` success, `2` input error (missing file, a directory, an unknown option, or a line that is not valid JSON), always a clean one-line message, never a stack trace. `--count` writes the drop tally to stderr; it never changes the exit code or the emitted stream — so it is safe in a pipe.

## Input honesty

Every non-blank line must be **valid JSON**. A line that is not valid JSON is a **hard error** — never a silent skip, and never passed through as raw text. Blank lines are skipped (not emitted, not counted). `--key` names a **top-level field only** (no dotted paths) and is meaningful only for records that are JSON objects; applied to a bare number, string, or array it means "no such field", so that record passes through and never dedups.

## Runs in a browser too

`dedup-filter.js` is zero-dependency and side-effect-free on load. In a browser it attaches `dedupFilter` (and the `dedupCanon` helper) to `window.ForestGifts`; under Node it exports `filter` and `canon` via `module.exports`.

```js
const { filter } = require("./dedup-filter.js");
filter('{"id":1}\n{"id":1}\n{"id":2}').lines; // -> ['{"id":1}', '{"id":2}']
```

## The edge — what this does NOT do

This drops **exact** duplicates (by canonical record, or by one field). It is **not** a fuzzy or near-duplicate detector — no similarity scoring, no value normalization. It does **not** collapse or merge the records it drops — it keeps the first verbatim and discards the rest. And it keeps **first, not last** — it is not a "latest wins" upsert.

## License

MIT.
