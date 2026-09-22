# shell-scaffold

Name each interactive lane's reducer gift and its UX seam.

Give it a spec's interactive functor and the set of gift slugs you've shipped,
and for each interactive sub-lane it names the deterministic reducer gift that
covers it, flags whether that reducer is served, and emits a UX-seam string that
says, in plain words: *wire this reducer in — the reducer is deterministic and
shipped; the pointer/render/history UX around it is yours.* It names the seam; it
never writes the UX.

## Use

Reads one JSON object from stdin whose keys are the arguments:

```
printf '{"spine": {"interactive_functor": {"covenant_spec": "spec.md", "sub_lanes": [{"primitive": "a.click", "covenant_subverb": "input-handling"}]}}, "served": ["input-event-router"]}' | python3 shell_scaffold.py
```

- `spine` — `{"interactive_functor": {"covenant_spec": <s>, "sub_lanes": [{"primitive": <id>, "covenant_subverb": <subverb>}, ...]}}`
- `served` — `[<gift_slug>, ...]` — the set of slugs you've shipped
- `sublane_reducer` *(optional)* — `{<subverb>: <reducer_slug>, ...}` to override
  the built-in default map; omit it to use the default.

Other commands:

```
python3 shell_scaffold.py --help
python3 shell_scaffold.py --selftest
python3 smoke_test.py
```

## Edge (the honest limit)

It **names** the seam and the reducer — it does not **write** the UX, and it does
not check that the named reducer actually exists or is correct for the lane. The
reducer binding comes from a fixed subverb→gift map; a lane with an unmapped
subverb gets a `null` reducer and a seam that says so. It scaffolds; you build.

Bad or empty stdin, or a stdin object with the wrong keys, exits nonzero with a
one-line message and no traceback.

## What it is

The fold body (and its default subverb→reducer map) is extracted verbatim from a
recipe-compiler's shell-scaffold block. This gift wraps that pure fold in a
stdin→stdout CLI; the wrapper adds only I/O, so the gift's determinism is exactly
the fold's.

## Stack

Python 3 standard library only. No dependencies. Offline. Deterministic
(folds-twice-identical).

## License

MIT — see `LICENSE`.
