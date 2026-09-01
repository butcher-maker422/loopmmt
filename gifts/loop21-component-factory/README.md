# loop21-component-factory — declare small logic components as composable data

A **source** in the composition algebra (∅ → JSONL): you name the logic
primitives you want — a counter, a toggle, a clamp, an accumulator, a
pattern-matcher — give each a small config, and the factory emits one
fully-specified component **spec** per line of JSONL. Nothing runs here; the
factory *declares* components as portable data that a downstream transform,
fold, or runner consumes.

```
spec = {"component": "<kind>", "name": "<id>", "params": {...},
        "port": "transform"|"filter"|..., "spec_version": 1}
```

```
$ python3 loop21-component-factory.py --make counter:start=0,step=2
{"component": "counter", "name": "counter-0000", "params": {"start": 0, "step": 2}, "port": "transform", "spec_version": 1}

$ python3 loop21-component-factory.py --make clamp:lo=0,hi=100 --make toggle:initial=false
{"component": "clamp", "name": "clamp-0000", "params": {"hi": 100, "lo": 0}, "port": "transform", "spec_version": 1}
{"component": "toggle", "name": "toggle-0000", "params": {"initial": false}, "port": "transform", "spec_version": 1}

$ python3 loop21-component-factory.py --demo        # a short, reproducible run
```

## Why it's a factory, not a library

A library hands you a function bound to the process that imported it. This hands
you a **description** of a component — kind, name, parameters, and the
composition port it fills — as a line of JSON. That description travels: pipe it,
store it, diff it, hash it, or feed it to any consumer that knows the five
built-in kinds. The factory is the front door to a small, closed catalog of logic
primitives, emitted as a stream.

## The catalog

Five component kinds ship, each with a declared parameter schema and a declared
composition port:

| kind | port | what it declares |
|---|---|---|
| `counter` | transform | advances a running integer by a fixed step |
| `toggle` | transform | flips a boolean on each item |
| `clamp` | transform | constrains a numeric field to `[lo, hi]` |
| `accumulator` | fold | reduces a stream under `sum`/`product`/`min`/`max`/`count` |
| `pattern-match` | filter | passes items whose field matches a literal or set |

```
python3 loop21-component-factory.py --catalog   # the catalog itself, as JSONL
```

## Why it's honest

- **A closed, named catalog.** Ask for a kind that isn't in the catalog and the
  factory refuses loudly (non-zero exit, message on stderr) — it never emits a
  spec it can't stand behind.

- **Validated at the door.** Every requested component is checked against its
  kind's schema *before* a spec is emitted: a missing required parameter, an
  out-of-range value, an unknown parameter, or a bad type is a reported error,
  never a silently emitted spec a downstream consumer will choke on.

- **Deterministic by construction.** The emitted stream is a pure function of the
  requested specs. Auto-generated names use a seeded, reproducible counter, so
  `--seed 42` yields byte-identical JSONL on any machine, forever. Keys are
  sorted; there is no wall-clock and no unseeded RNG.

- **The spec is the whole contract.** A consumer needs nothing from this tool but
  the JSONL. `spec_version` pins the shape so a consumer can reject a spec it
  doesn't understand rather than mis-read it.

## The honest edge

The factory **declares** components; it does not **run** them. An emitted spec is
a validated description, not a live object — turning a spec into behavior is the
consumer's job, and this tool makes no claim about whether any downstream runner
implements a kind correctly. It guarantees the spec is well-formed and
catalog-valid, not that anyone honors it.

## Use it

```
python3 loop21-component-factory.py --make counter:start=0,step=2   # one component
python3 loop21-component-factory.py --make counter --make toggle    # several at once
python3 loop21-component-factory.py --batch request.json            # a JSON batch file
python3 loop21-component-factory.py --catalog                       # list the catalog
python3 loop21-component-factory.py --seed 42 --make counter        # deterministic names
python3 loop21-component-factory.py --demo                          # reproducible demo
```

A `--batch` file is a JSON array of requests:

```json
[
  {"kind": "counter", "name": "tick", "params": {"start": 0, "step": 1}},
  {"kind": "pattern-match", "params": {"field": "status", "equals": "open"}}
]
```

As a library:

```python
import importlib.util, json
spec = importlib.util.spec_from_file_location("lcf", "loop21-component-factory.py")
lcf = importlib.util.module_from_spec(spec); spec.loader.exec_module(lcf)

lcf.build_spec("counter", "tick", {"start": 0, "step": 2})   # one validated spec
lcf.produce([{"kind": "toggle", "params": {}}], seed=42)      # a deterministic batch
lcf.catalog_lines()                                          # the catalog as dicts
```

Python standard library only. Deterministic under `--seed`. Headless.

## Tests

```
python3 test_loop21-component-factory.py
```

Mutation-bitten: the determinism test pins a **golden sha256** of a seeded batch
rather than checking self-equality, because a self-equality test passes benign
reorders (the Loop MMT sudoku lesson). Each test is here because a plausible
mutation makes it fail loud.

MIT licensed. © 2026 Shea Gunther.
