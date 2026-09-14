# schema-filter

**Pass only the JSONL records that match a declared JSON shape.**

A tiny, dependency-free tool that reads a stream of records — one JSON object per line ([JSON Lines](https://jsonlines.org/)) — and emits, verbatim and in input order, exactly the records that match **every** field you declare. Everything else is dropped. Same stream and shape in, byte-identical subset out, on every machine and every run.

```
cat people.jsonl | node schema-filter.js --field name string --field age integer
```

It is a **subset filter** — the output is a subset of the input, byte-for-byte per surviving record. It never invents, reshapes, or reorders a record; it only decides which ones pass.

## What a constraint is

A constraint names one field and the JSON **type** it must hold:

```
--field    NAME TYPE     require NAME present AND of TYPE (fail-closed if absent)
--optional NAME TYPE     if NAME is present it must be TYPE; if absent, it passes
```

`TYPE` is one of a documented, closed set of seven JSON types:

```
string    a JSON string
number    a finite JSON number (integer or fractional)
integer   a finite JSON number with no fractional part
boolean   true or false
object    a JSON object (not an array, not null)
array     a JSON array
null      the JSON literal null
```

Declare more than one field and they **AND** together — a record survives only if it matches all of them. Declare none and every well-formed record passes (the identity filter).

## The missing-field policy

A `--field` constraint is a claim the record must satisfy, and a record that **lacks** that field cannot satisfy it, so it is **dropped**. This is fail-closed. Use `--optional` for the "if this field is present it must be a string, otherwise leave the record alone" shape: an optional field that is absent passes; an optional field that is present but the wrong type still fails.

## Usage

```
usage: schema-filter.js [--field NAME TYPE]... [--optional NAME TYPE]... [FILE]
  (no FILE)           read records from stdin
  FILE                read records from a file
  --field    N TYPE   require N present and of TYPE (fail-closed if absent)
  --optional N TYPE   if N is present it must be TYPE; if absent, it passes
  --help
```

Each **non-blank line is one JSON object**. Blank lines are skipped. A trailing `\r` (CRLF files) is trimmed. Surviving records are emitted one per line, verbatim.

Example:

```
$ printf '%s\n' '{"name":"a","age":30}' '{"name":"b","age":30.5}' '{"age":40}' \
    | node schema-filter.js --field name string --field age integer
{"name":"a","age":30}
```

`{"name":"b","age":30.5}` is dropped (`30.5` is a number, not an integer); `{"age":40}` is dropped (no `name`).

## Exit codes

`0` success (with or without survivors) · `2` input error (missing file, a directory, a malformed constraint, an unknown type, or a line that is not a JSON object). Always a clean one-line message on stderr, never a stack trace.

## In a browser

The core is a pure function with no Node dependencies. Load `schema-filter.js` and call `window.ForestGifts.schemaFilter(text, constraints)`, where `constraints` is an array of `{field, type, optional}` (`type` one of the seven names above; `optional` a boolean).

## The edge

This is a **subset filter over a declared shape**. It filters on the fields and types **you** name — it does not infer a schema from the data, does not reshape or reformat surviving records, does not sort, and does not de-duplicate. A record matching every declared type passes even if its values are wrong: **it tests a value's type, never its truth.** The string `"5"` is **not** the number `5` (no coercion); `3.5` is a `number` but not an `integer`; a required field's absence drops the record while an optional field's absence passes.

## License

MIT. Zero dependencies. Runs in Node or a browser.
