# uniq-filter

**Collapse adjacent duplicate records in a JSONL stream — first of each run wins, order stable.**

A tiny, dependency-free tool that reads a stream of records — one JSON value per line ([JSON Lines](https://jsonlines.org/)) — and passes them through, collapsing every maximal run of **consecutive** equal records down to its first member. The output is a **subset** of the input in the **original order**: the first line of each adjacent run is kept verbatim, every immediately-following equal line is dropped. This is the `uniq` half of `sort | uniq`. Same stream in, byte-identical stream out, on every machine and every run.

```
printf '%s\n' '{"v":"a"}' '{"v":"a"}' '{"v":"b"}' '{"v":"a"}' | node uniq-filter.js
{"v":"a"}
{"v":"b"}
{"v":"a"}
```

Notice the trailing `{"v":"a"}` survives — it is a **new run**, because a `{"v":"b"}` interrupted it. That is the whole point: uniq-filter is **adjacent**, not global.

It is a **filter** — output ⊆ input. Nothing is added, reordered, or rewritten; the kept lines are emitted exactly as they arrived.

## Adjacent, not global (and O(1) memory)

uniq-filter remembers only the **previous** record's key — constant memory, whatever the stream size. It does **not** build a whole-stream seen-set and it does **not** sort. A far-apart duplicate is kept, because the run was already broken. If you want whole-stream, first-wins, order-stable dedup instead, that is a different tool: **dedup-filter**. uniq-filter will not silently do that for you.

## What counts as equal

Two modes, and the identity key is the only thing that differs.

**Default — whole-record identity.** A record's key is its **canonical JSON form**: re-serialized with object keys sorted, recursively. So `{"a":1,"b":2}` and `{"b":2,"a":1}` are the **same** record (object key-order is not meaningful) and an adjacent second one collapses — but `[1,2]` and `[2,1]` are **different** (array order *is* meaningful). Canonicalizing the *key*, not the *line*, is what makes "same record written two ways" collapse while still emitting the original line untouched.

**`--key FIELD` — compare by one field.** The run key is the value of the named top-level field, canonicalized the same way. Adjacent records carrying the same field value collapse even if the rest of the record differs (the first is kept verbatim). A record that **lacks** the field breaks the run and is always kept — a missing key is not a value, so it never counts as "equal" to anything, including another missing key.

## First of run wins, order stable

The kept record for any run is always the **first** one seen in that run; the relative order of the kept records is exactly their input order. A deliberate, pinned choice (not "last of run", not "sorted"): it keeps the filter one-pass, constant-memory, and the output a stable, re-derivable subset of the input.

## Usage

```
usage: uniq-filter.js [--key FIELD] [--count] [FILE]
  (no FILE)     read records from stdin
  FILE          read records from a file
  --key FIELD   collapse adjacent runs by one top-level field instead of the whole record
  --count       write the number of collapsed lines to stderr
  --help
```

Each **non-blank line is one JSON record** (object, array, string, number, bool, or null). Blank lines are skipped. A trailing `\r` (CRLF files) is trimmed. Output is the kept records (first of each adjacent run), one per line, in input order.

Example:

```
$ printf '%s\n' '{"id":1,"v":"a"}' '{"id":1,"v":"b"}' '{"id":2}' '{"id":1}' | node uniq-filter.js --key id
{"id":1,"v":"a"}
{"id":2}
{"id":1}
```

Exit codes: `0` success, `2` input error (missing file, a directory, an unknown option, or a line that is not valid JSON), always a clean one-line message, never a stack trace. `--count` writes the collapsed tally to stderr; it never changes the exit code or the emitted stream — so it is safe in a pipe.

## Input honesty

Every non-blank line must be **valid JSON**. A line that is not valid JSON is a **hard error** — never a silent skip, and never passed through as raw text. Blank lines are skipped (not emitted, not counted). `--key` names a **top-level field only** (no dotted paths) and is meaningful only for records that are JSON objects; applied to a bare number, string, or array it means "no such field", so that record breaks the run and is kept.

## Pairs with sort

The classic pipeline is `sort | uniq`. If your duplicates are not already adjacent, sort the stream first (by the same field) and then collapse. uniq-filter deliberately stays constant-memory and does the collapse only; sorting is a separate concern it will not silently take on.

## Runs in a browser too

`uniq-filter.js` is zero-dependency and side-effect-free on load. In a browser it attaches `uniqFilter` (and the `uniqCanon` helper) to `window.ForestGifts`; under Node it exports `filter` and `canon` via `module.exports`.

```js
const { filter } = require("./uniq-filter.js");
filter('{"v":1}\n{"v":1}\n{"v":2}\n{"v":1}').lines; // -> ['{"v":1}', '{"v":2}', '{"v":1}']
```

## The edge — what this does NOT do

This collapses **ADJACENT runs only** (constant memory). It does **not** global-dedup — a duplicate that is not next to its twin is kept. It does **not** sort the stream for you to make far-apart duplicates adjacent. It is **not** fuzzy or near-duplicate matching — no similarity scoring, no value normalization. For whole-stream first-wins dedup, use **dedup-filter**; sort first if your runs are not already adjacent.

## License

MIT.
