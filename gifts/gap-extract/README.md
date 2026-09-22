# gap-extract

Bind a spec's declared gaps to their witnesses.

Give it a spec's declared `gaps[]`, a primitive map, and a witness map, and it
emits one record per gap: which primitive it is, its covenant class and role,
the witness that covers it (or `null`), and a resolved `status` of `"witnessed"`
or `"derive-first"`. It turns *"here are the holes"* into *"here is exactly what
covers each hole, and what doesn't yet"*.

## Use

Reads one JSON object from stdin whose keys are the arguments:

```
printf '{"spine": {"gaps": [{"primitive": "a.k1", "covenant_class": "pure-kernel"}]}, "prim": {"a.k1": {"class": "pure-kernel", "role": "fold"}}, "witness_map": {"a.k1": null}}' | python3 gap_extract.py
```

```
[
  {
    "covenant_class": "pure-kernel",
    "note": "...",
    "primitive": "a.k1",
    "role": "fold",
    "status": "derive-first",
    "witness": null
  }
]
```

- `spine` — `{"gaps": [{"primitive": <id>, "covenant_class": <cls?>}, ...]}`
- `prim` — `{<primitive_id>: {"class": <cls>, "role": <role>}, ...}`
- `witness_map` — `{<primitive_id>: <witness_slug_or_null>, ...}` — a `null`
  value marks a derive-first gap; a slug marks it witnessed.

Other commands:

```
python3 gap_extract.py --help
python3 gap_extract.py --selftest
python3 smoke_test.py
```

## Edge (the honest limit)

It **reports** coverage from the maps you hand it — it does not **verify** that a
named witness actually covers the primitive. A `witness_map` that lies (points a
gap at a gift that doesn't cover it) produces a `"witnessed"` record that is
wrong; the fold trusts its inputs. It resolves status, it does not audit truth.

Bad or empty stdin, or a stdin object with the wrong keys, exits nonzero with a
one-line message and no traceback.

## What it is

The fold body is extracted verbatim from a recipe-compiler's gap-binding loop.
This gift wraps that pure fold in a stdin→stdout CLI; the wrapper adds only I/O,
so the gift's determinism is exactly the fold's.

## Stack

Python 3 standard library only. No dependencies. Offline. Deterministic
(folds-twice-identical).

## License

MIT — see `LICENSE`.
