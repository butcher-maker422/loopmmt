# pluck

**Keep only the named fields from each record in a JSONL stream — the SELECT of the JSONL toolkit.**

A tiny, dependency-free tool that reads a stream of records — one JSON object per line ([JSON Lines](https://jsonlines.org/)) — and emits each record reduced to just the fields you asked for. Narrow a wide record down to the columns you want before you fold, diff, or sink it. Same stream and same field list in, byte-identical stream out, on every machine and every run.

```
printf '%s\n' '{"a":1,"b":2,"c":3}' | node pluck.js --fields a,c
{"a":1,"c":3}
```

It is a **filter on the field axis** — every emitted object's fields are a subset of its input object's fields. Nothing is added, renamed, computed, or reordered by content.

## The field order is the declared order

The output object's keys appear in the order you named them in `--fields`, **not** the order they happened to sit in the input record. So `--fields b,a` emits `{"b":...,"a":...}` regardless of how the input was written:

```
$ printf '%s\n' '{"a":1,"b":2}' | node pluck.js --fields b,a
{"b":2,"a":1}
```

Declaring the order — rather than inheriting the input's — is what makes the output a pure function of `(record, field-list)`: two records that carry the same requested values, written in any key-order, pluck to byte-identical lines. A field named twice in `--fields` is emitted once, at its first position.

## What happens to a missing field

**Default — omit.** A requested field the record does not carry is simply left out of that record's output object. A missing field is not a value; it is not emitted as `null`, not as `""`, not as a bare key. A record that carries none of the requested fields emits an empty object `{}`. Pluck what is there; say nothing about what is not.

**`--strict` — stop.** A record missing **any** requested field is a hard error (exit 2) naming the line and the first missing field. For callers who need every column present and want the stream to halt rather than emit a thin record.

## Usage

```
usage: pluck.js --fields A,B,C [--strict] [FILE]
  --fields LIST  comma-separated TOP-LEVEL field names to keep (required)
  --strict       a record missing any requested field is a hard error
  (no FILE)      read records from stdin
  FILE           read records from a file
  --help
```

Each **non-blank line is one JSON object**. Blank lines are skipped. A trailing `\r` (CRLF files) is trimmed. Output is the plucked objects, one per line, in input order, each with its keys in the declared field order.

Example:

```
$ printf '%s\n' '{"id":1,"name":"a","t":9}' '{"id":2,"name":"b","t":8}' | node pluck.js --fields id,name
{"id":1,"name":"a"}
{"id":2,"name":"b"}
```

Exit codes: `0` success, `2` input error (missing or empty `--fields`, missing file, a directory, an unknown option, a line that is not valid JSON, a non-object record, or `--strict` on a record missing a requested field), always a clean one-line message, never a stack trace.

## Input honesty

Every non-blank line must be **valid JSON**, and every record must be a **JSON object** — you cannot pluck fields from a bare number, string, boolean, null, or array, so a non-object record is a **hard error** naming the line, never a silent passthrough. A line that is not valid JSON is a hard error too. `--fields` names **top-level fields only** (no dotted paths, no array indices).

## Runs in a browser too

`pluck.js` is zero-dependency and side-effect-free on load. In a browser it attaches `pluck` (and the `pluckCanon` helper) to `window.ForestGifts`; under Node it exports `pluck` and `canon` via `module.exports`.

```js
const { pluck } = require("./pluck.js");
pluck('{"a":1,"b":2,"c":3}', { fields: ["a", "c"] }).lines; // -> ['{"a":1,"c":3}']
```

## The edge — what this does NOT do

This selects **top-level** fields by exact name. It does **not** reach into nested paths — there are no dotted keys (`a.b.c`) and no array indices. It does **not** rename fields, and it does **not** compute or default a missing value — a field that is absent is simply omitted (or, under `--strict`, an error). And it does **not** reorder by content: the output key order is exactly the `--fields` order you declared.

## License

MIT.
