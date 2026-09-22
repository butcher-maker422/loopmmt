# manifest-emit

Canonicalize a record to byte-stable JSON.

Hand it any JSON value and it re-serializes it canonically — keys sorted,
two-space indent, unicode preserved. The point is **byte-stability**: the same
data always emits the same bytes, regardless of the order its keys arrived in.
So two runs — or two machines, or a value before and after a round-trip through
a dict — produce a file you can hash, diff, or commit and trust to be equal
*iff the data is equal*.

## Use

Reads one JSON object from stdin whose keys are the arguments. This tool takes
one argument, `record`:

```
printf '{"record": {"b": 1, "a": 2}}' | python3 manifest_emit.py
```

```
{
  "a": 2,
  "b": 1
}
```

`record` may be any JSON value — object, array, string, number, bool, or null:

```
printf '{"record": [3, 1, 2]}' | python3 manifest_emit.py
printf '{"record": "hello"}'   | python3 manifest_emit.py
```

Other commands:

```
python3 manifest_emit.py --help
python3 manifest_emit.py --selftest
python3 smoke_test.py
```

## Edge (the honest limit)

It **canonicalizes — it does not validate.** It will faithfully emit whatever
record you hand it, including one that is malformed for your downstream schema.
Canonical bytes are a guarantee about *determinism* (same data → same bytes),
never about *correctness* of the data itself.

Bad or empty stdin, or a stdin object missing the `record` key, exits nonzero
with a one-line message and no traceback.

## What it is

The fold body is extracted verbatim from a recipe-compiler's terminal serialize
step (`json.dumps(record, indent=2, sort_keys=True, ensure_ascii=False)`) and is
proven byte-identical to that compiler's own output. This gift wraps that pure
fold in a stdin→stdout CLI; the wrapper adds only I/O, so the gift's determinism
is exactly the fold's.

## Stack

Python 3 standard library only. No dependencies. Offline. Deterministic
(folds-twice-identical).

## License

MIT — see `LICENSE`.
