# conform — does this JSONL output match the schema you declared?

**conform** reads JSONL — one JSON value per line, the shape a model or any producer
emits — against a **record schema you write**, and the moment a record does not match,
it **refuses**: it names the line, the field, and what was wrong, and stops. A clean run
means every record matched the declared **structure** — never that the content is correct.

**Structural, not semantic.** conform checks that a field is present and is the declared
**type** — `string`, `number`, `integer`, `boolean`, `enum`, `array`, `object` — optionally
in range, one of a fixed set, or matching a pattern. It does **not** check that a value is
true, sensible, or what the model *should* have said. A well-typed lie conforms.

Zero dependencies. Runs identically in Node or a browser (`window.GiftConform`). The verdict
is **deterministic** — the same stream and schema yield the same result, every run — and it is
**fail-closed and fail-first**: the first non-conforming record is the verdict, so it drops
straight into a CI gate on a model's output.

## Use

```
node conform.js --schema schema.json data.jsonl   # exit 0 clean, 1 on first bad record
cat data.jsonl | node conform.js --schema schema.json
node conform.js --selftest                          # run the golden-corpus selftest
node conform.js --help
```

A clean stream exits **0** and prints `CLEAN: N record(s) conform`. The first record that
does not conform exits **1** and prints `REFUSE line L field "F": reason` — so a CI job can
gate on the exit code and a human gets the exact line and field to fix.

## The schema

A plain object mapping **field name → a small type spec**:

```json
{
  "id":    { "type": "integer", "min": 0, "required": true },
  "name":  { "type": "string", "maxLen": 40, "required": true },
  "score": { "type": "number", "min": 0, "max": 1 },
  "kind":  { "type": "enum", "values": ["a", "b", "c"] },
  "email": { "type": "string", "pattern": "@" },
  "tags":  { "type": "array", "minItems": 1 }
}
```

- `required: true` makes a missing field an error (default: optional — absent is OK).
- Fields are checked in **sorted order**, so when a record breaks two rules the reported
  field is deterministic (alphabetically first), not order-of-definition.
- A line that is **not valid JSON** is itself a conformance failure at that line — never a
  crash and never a skip. Blank lines are skipped (a blank line is not a record).

## The edge (what it does NOT do)

> conform proves **structure, not truth**. A clean pass means every record has the declared
> fields at the declared types — it is **not** a certificate that the model's answer is right,
> complete, or meaningful. It validates the schema **you** declared: declare too loose a schema
> and it passes records you'd have rejected; declare the wrong schema and it faithfully passes
> the wrong records. Choosing a schema that captures what you actually require is your job.

It is a **gate, not an oracle**: it tells you a record has the right shape, never that it has
the right content. Pair it with a semantic check when meaning matters — conform is the cheap,
deterministic structural layer beneath that, not the whole of it.

## Types it knows

`string` (with `maxLen`, `pattern`) · `number` (with `min`, `max`) · `integer` (with `min`,
`max`) · `boolean` · `enum` (with `values[]`) · `array` (with `minItems`) · `object`.
