# contract

**Assert your JSONL records match a declared schema — at runtime, deterministically.**

A tiny, dependency-free schema check for [JSON Lines](https://jsonlines.org/) (one JSON value per line). Give it a stream of records and a schema you declare, and it walks the records in order and stops at the **first** one that breaks the contract — naming the record's line, the field, and what was wrong. Same records + same schema → the same first failure, byte-identical, every run. It drops straight into a CI gate on a model's output.

```
node contract.js --schema schema.json records.jsonl
```

## The schema is data, never code

A schema is a plain JSON object naming the fields a record must carry and the structure each must have. Nothing is executed or `eval`'d, so a schema is safe to accept from an untrusted source.

```json
{
  "id":   { "type": "number",  "required": true },
  "name": { "type": "string",  "required": true },
  "tags": { "type": "array",   "required": false },
  "meta": { "type": "object" }
}
```

- **`type`** — one of `string` `number` `boolean` `object` `array` `null` `any`. `object` means a non-array, non-null object; `array` means a JSON array; `null` means the JSON `null`; `any` accepts any present value.
- **`required`** — `true` (default) means the field must be present; `false` means it may be absent, but if present it must match `type`.
- **Shorthand** — a bare string is sugar for a required field of that type: `"id": "number"` === `"id": {"type":"number","required":true}`.

By default a record may carry extra fields the schema does not mention. Pass `--closed` to reject the first unexpected field instead.

## Usage

```
usage:
  contract --schema <schema.json> [<records.jsonl>] [--closed]
  contract --selftest
  contract --help | --list

reads records from the file argument or stdin.
  exit 0  every record satisfies the schema
  exit 1  the FIRST record that violates it (line + field + reason on stderr)
  exit 2  unusable input or an ill-formed schema
```

Example:

```
$ printf '{"id":1,"name":"a"}\n{"id":2}\n' | contract --schema schema.json
contract: stdin:2: field "name": missing required field
$ echo $?
1
```

## The line it will not cross

`contract` checks **structure** — which fields are present, at which types — not **meaning**. A record that is structurally perfect and semantically nonsense passes: `"age": -3` is a valid number; an email that is not an email is a valid string. A human owns whether the values are *right*; `contract` only makes the declared shape enforceable and names the first record that breaks it.

Runs identically in Node and in a browser (`window.ForestGifts.contract`). Zero dependencies. MIT.
