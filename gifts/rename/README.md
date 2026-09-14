# rename

**Rename fields in each record of a JSONL stream, by a declared map — the field-relabel of the JSONL toolkit.**

A tiny, dependency-free tool that reads a stream of records — one JSON object per line ([JSON Lines](https://jsonlines.org/)) — and a mapping of old field names to new ones, and emits each record with those fields relabeled. Every value is kept; only a mapped field's **key** changes. Same stream and same map in, byte-identical stream out, on every machine and every run.

```
printf '%s\n' '{"a":1,"b":2}' | node rename.js --map a=x
{"x":1,"b":2}
```

It is a **transform** on the field axis — the companion to [`pluck`](../pluck/): `pluck` **selects** fields, `rename` **relabels** them.

## The map is old=new pairs

`--map old1=new1,old2=new2` declares, for each pair, "wherever a record has the field `old1`, emit it under the name `new1` instead." A field the map does not mention passes through **unchanged**, under its original name.

```
$ printf '%s\n' '{"user_id":7,"ts":"2026-09-12","note":"hi"}' | node rename.js --map user_id=id,ts=timestamp
{"id":7,"timestamp":"2026-09-12","note":"hi"}
```

## Renaming keeps the field's position

Renaming a field does **not** move it. `{"a":1,"b":2}` under `--map a=x` emits `{"x":1,"b":2}` — `x` stays first, it is not shuffled to the end. The record's own field order is preserved; only the mapped keys' names change. This is what makes `rename` a faithful transform: it relabels, it never reorders. (Values are canonicalized for byte-stability — a nested object's inner keys are sorted, array order is kept.)

## Collisions are refused, never overwritten

If a rename would make two fields share a name — the target name already exists in the record and is not itself being renamed away, or two different source fields map to the same target — that record is a **hard error** (exit 2) naming the line and the colliding name. `rename` never silently drops or overwrites a value to resolve a clash. A clean **swap** (`--map a=b,b=a`) is fine — each name is vacated before it is claimed.

## Missing source fields

**Default — skip.** A mapped source field the record does not carry is simply not renamed (there is nothing to rename); the record passes through with its other fields intact. A record that has none of the mapped fields is emitted unchanged.

**`--strict` — stop.** A record missing **any** mapped source field is a hard error (exit 2) naming the line and the first missing source field.

## Usage

```
usage: rename.js --map OLD=NEW,... [--strict] [FILE]
  --map LIST     comma-separated old=new TOP-LEVEL field renames (required)
  --strict       a record missing any mapped source field is a hard error
  (no FILE)      read records from stdin
  FILE           read records from a file
  --help
```

Each **non-blank line is one JSON object**. Blank lines are skipped. A trailing `\r` (CRLF files) is trimmed. Output is the relabeled objects, one per line, in input order.

Exit codes: `0` success, `2` input error (missing / empty / malformed `--map`, missing file, a directory, an unknown option, a line that is not valid JSON, a non-object record, a rename collision, or `--strict` on a record missing a mapped source field), always a clean one-line message, never a stack trace.

## Input honesty

Every non-blank line must be **valid JSON**, and every record must be a **JSON object** — you cannot rename a field of a bare number, string, boolean, null, or array, so a non-object record is a **hard error** naming the line. `--map` names **top-level fields only** (no dotted paths); both sides of every pair must be non-empty, a source may not appear twice, and a malformed pair is a hard error at map-parse time.

## Runs in a browser too

`rename.js` is zero-dependency and side-effect-free on load. In a browser it attaches `rename` (and the `renameCanon` helper) to `window.ForestGifts`; under Node it exports `rename`, `canon`, and `parseMap` via `module.exports`.

```js
const { rename } = require("./rename.js");
rename('{"a":1,"b":2}', { map: "a=x" }).lines; // -> ['{"x":1,"b":2}']
```

## The edge — what this does NOT do

This renames **top-level** fields by exact name. It does **not** reach into nested paths — no dotted keys (`a.b.c`). It does **not** move fields — a renamed field keeps its position, names are swapped in place. It does **not** drop or transform a value — only the key changes. And it **refuses** a rename that would collide two fields onto one name rather than silently overwriting.

## License

MIT.
