# order-walk

Split a batch order into its ∘ pipe chain and ⊗ fork.

Give it a spec's batch order, a primitive map, a witness map, your served-gift
set, and a slug→port_verb map, and it walks the order for pipe-class nodes only,
splits the sequential (∘) pipe chain from the parallel (⊗) fork members (skipping
pure-kernels, which are handled as gaps elsewhere), and resolves each stage's
witness gift, port verb, and served flag. It's the structural walk that turns a
flat order into the two-part topology a harness planner then wires.

## Use

Reads one JSON object from stdin whose keys are the arguments:

```
printf '{"spine": {"batch_core": {"order": ["a.read", "a.filt"], "parallel_join": null}}, "prim": {"a.read": {"class": "pipe"}, "a.filt": {"class": "pipe"}}, "witness_map": {"a.read": "json-source", "a.filt": "schema-filter"}, "served": ["json-source"], "verb_of": {"json-source": "source", "schema-filter": "filter"}}' | python3 order_walk.py
```

- `spine` — `{"batch_core": {"order": [<id>, ...], "parallel_join": {"members": [<id>, ...], "reason": <s?>, "feeds": <id?>}|null}}`
- `prim` — `{<id>: {"class": "pipe"|"pure-kernel"|...}, ...}`
- `witness_map` — `{<id>: <witness_slug_or_null>, ...}`
- `served` — `[<gift_slug>, ...]`
- `verb_of` — `{<gift_slug>: <port_verb>, ...}`

Output is a two-element array `[pipe_stages, fork]`; `fork` is `null` for an app
with no parallel read.

Other commands:

```
python3 order_walk.py --help
python3 order_walk.py --selftest
python3 smoke_test.py
```

## Edge (the honest limit)

It walks the order it is **handed** and trusts the maps — it does not check that
the order is a valid data-flow, that a witness covers its primitive, or that a
port_verb is right. Pure-kernels are skipped by design (they're gaps, not
stages); if your primitive map miscategorises a node, it's skipped or included
wrongly. It resolves structure, it does not verify it.

Bad or empty stdin, or a stdin object with the wrong keys, exits nonzero with a
one-line message and no traceback.

## What it is

The fold body is extracted verbatim from a recipe-compiler's order-walk loop.
This gift wraps that pure fold in a stdin→stdout CLI; the wrapper adds only I/O,
so the gift's determinism is exactly the fold's.

## Stack

Python 3 standard library only. No dependencies. Offline. Deterministic
(folds-twice-identical).

## License

MIT — see `LICENSE`.
