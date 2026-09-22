# harness-fold

Compute a pipeline's wiring topology as data.

Give it an ordered list of pipe stages (and, optionally, one parallel fork), and
it emits the wiring topology: the sequential (∘) edge-list connecting consecutive
stages, plus the one parallel (⊗) fork/join describing which sources run
independently and where they rejoin the chain. It's the *how does this pipeline
actually wire together* step, computed rather than drawn.

## Use

Reads one JSON object from stdin whose keys are the arguments:

```
printf '{"pipe_stages": [{"primitive": "s0"}, {"primitive": "s1"}], "fork": null}' | python3 harness_fold.py
```

```
[
  [ { "from": "s0", "op": "∘", "to": "s1" } ],
  null
]
```

- `pipe_stages` — `[{"primitive": <id>}, ...]`, ordered, in data-flow order
- `fork` — `{"members": [{"primitive": <id>}, ...], "reason": <s?>, "feeds": <id?>}`,
  or `null` for a pipeline with no fork

Output is a two-element array `[harness_edges, fork_join]`. A fork feeds its
declared `feeds` target, falling back to the pipe head only when none is declared.

Other commands:

```
python3 harness_fold.py --help
python3 harness_fold.py --selftest
python3 smoke_test.py
```

## Edge (the honest limit)

It computes the topology it is **handed** — it does not check that the stage
order is correct or that a declared `feeds` target exists in the chain. Give it a
wrong order and it faithfully wires the wrong pipeline. It renders the graph, it
does not validate the plan.

Bad or empty stdin, or a stdin object with the wrong keys, exits nonzero with a
one-line message and no traceback.

## What it is

The fold body is extracted verbatim from a recipe-compiler's harness-plan block.
This gift wraps that pure fold in a stdin→stdout CLI; the wrapper adds only I/O,
so the gift's determinism is exactly the fold's.

## Stack

Python 3 standard library only. No dependencies. Offline. Deterministic
(folds-twice-identical).

## License

MIT — see `LICENSE`.
