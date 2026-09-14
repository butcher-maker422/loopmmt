# range-filter

**Pass only the JSONL records whose fields fall inside declared windows.**

A tiny, dependency-free tool that reads a stream of records — one JSON object per line ([JSON Lines](https://jsonlines.org/)) — and emits, verbatim and in input order, exactly the records that fall inside **every** window you declare. Everything else is dropped. Same stream and windows in, byte-identical subset out, on every machine and every run.

```
cat people.jsonl | node range-filter.js --num age 18 65
```

It is a **subset filter** — the output is a subset of the input, byte-for-byte per surviving record. It never invents, reshapes, or reorders a record; it only decides which ones pass.

## What a window is

A window is a numeric or ISO-date range on one field:

```
--num  FIELD MIN MAX     keep records whose FIELD is a finite number in [MIN, MAX]
--date FIELD MIN MAX     keep records whose FIELD is an ISO-8601 date in [MIN, MAX]
```

Both bounds are **inclusive**, both edges are required, and either edge may be a bare `.` meaning "unbounded on this side":

```
--num age 18 .                     age >= 18            (no upper bound)
--num score . 100                  score <= 100         (no lower bound)
--date ts 2026-01-01 2026-12-31    ts within the year 2026, inclusive
```

Declare more than one window and they **AND** together — a record survives only if it is inside all of them. Declare none and every well-formed record passes (the identity filter).

## The missing-field policy

A window tests a field. If a record does not **have** that field, the default is **DROP**: absence is not "inside the window," so the record does not pass. This is fail-closed. Pass `--keep-missing` to invert it — a record lacking a windowed field then passes that window, for the "filter the records that have a date, leave the rest alone" shape.

## Usage

```
usage: range-filter.js [--num FIELD MIN MAX]... [--date FIELD MIN MAX]... [--keep-missing] [FILE]
  (no FILE)         read records from stdin
  FILE              read records from a file
  --num  F MIN MAX  numeric window on field F (inclusive; '.' = unbounded)
  --date F MIN MAX  ISO-8601 date window on field F (inclusive; '.' = unbounded)
  --keep-missing    a record LACKING a windowed field passes that window
  --help
```

Each **non-blank line is one JSON object**. Blank lines are skipped. A trailing `\r` (CRLF files) is trimmed. Surviving records are emitted one per line, verbatim.

Example:

```
$ printf '%s\n' '{"id":"a","age":17}' '{"id":"b","age":30}' '{"id":"c","age":70}' \
    | node range-filter.js --num age 18 65
{"id":"b","age":30}
```

## Exit codes

`0` success (with or without survivors) · `2` input error (missing file, a directory, a malformed window declaration, an unparseable bound, `MIN > MAX`, or a line that is not a JSON object). Always a clean one-line message on stderr, never a stack trace.

## In a browser

The core is a pure function with no Node dependencies. Load `range-filter.js` and call `window.ForestGifts.rangeFilter(text, windows, opts)`, where `windows` is an array of `{field, kind, min, max}` (kind `"num"` or `"date"`; `min`/`max` numbers, epoch-ms for dates, or `null` for unbounded) and `opts` is `{keepMissing}`.

## The edge

This is a **subset filter over declared windows**. It filters on the fields and ranges **you** name — it does not infer a schema, does not reshape or reformat surviving records, does not sort, and does not de-duplicate. A record inside every window passes even if its content is wrong: **the window tests a value's range, never its truth.** A `--num` field holding the string `"18"` is not the number `18` — a non-number value is out of the window, never coerced. An unparseable date value is out; an unparseable *bound* is a startup error, so a typo in a window is caught loudly rather than silently matching nothing.

## License

MIT. Zero dependencies. Runs in Node or a browser.
