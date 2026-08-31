# port

**Declare a composition tool's port-verb, and read it back honestly.**

A pipeline of small tools that pass JSON-lines to each other only holds together
if each tool knows — and *declares* — its own **port-verb**: the type-level shape
of its input/output contract. There are exactly five:

| verb | contract | in one line |
|---|---|---|
| `source` | `∅ → JSONL` | emits records; takes no meaningful input |
| `transform` | `JSONL → JSONL` | one record in, one record out |
| `filter` | `JSONL → JSONL'` | record in, a subset out (output type ⊆ input) |
| `fold` | `JSONL → JSONL_agg` | records in, one aggregate/narrower record out |
| `sink` | `JSONL → ∅` | terminal side effect; nothing pipeable comes out |

## The problem it solves

A tool that wants to draw a map of *what composes with what*, or to typecheck a
pipeline *before* running it, needs each tool's port-verb. The tempting shortcut
is to **guess** it — from a one-line description, or from a hand-kept list buried
in one program's source. A guess that a tool *emits* when it actually *sinks* is
a quiet lie: it draws a pipe that cannot carry data.

`port` removes the guess. Every tool **declares** its port-verb, in one of two
honest places:

1. a `port_verb` field in a JSON manifest of tool entries, or
2. a `--port` flag the tool answers for itself.

And then — the load-bearing part — `port check` **verifies the two against each
other**. If a manifest says `filter` while the tool's own `--port` says `source`,
the declaration has drifted from the thing it describes, and `port check` makes
that a decidable non-zero exit instead of something a human notices later. A
declaration you can verify beats a description you have to trust.

## Usage

```
port verbs
    Print the five port-verbs and their type contracts (one JSON-line each).

port read --manifest FILE [--slug SLUG]
    Read declared port_verb(s) from a manifest. A tool with no port_verb is
    reported status="undeclared" with a null verb — flagged, never guessed.

port check --manifest FILE --flag-cmd 'CMD {slug}'
    For every tool that declares a port_verb in the manifest, run its own
    --port flag ({slug} is substituted) and compare. Exit 0 iff every checked
    tool AGREES; exit 3 on any drift or missing answer.

port emit --slug SLUG --port-verb VERB
    Emit a single declaration line for a tool that has no manifest yet.
```

### Example

```
$ port read --manifest tools.json --slug cairn
{"slug": "cairn", "port_verb": "sink", "source": "manifest", "status": "declared"}

$ port check --manifest tools.json --flag-cmd './tools/{slug} --port'
{"slug": "cairn", "manifest": "sink", "flag": "sink", "status": "agree"}
```

`port`'s own port-verb is `source`: it emits declarations and takes no
meaningful stdin.

## The honest edge

`port` verifies that a declaration is *consistent with itself* — that a tool's
manifest entry and its own `--port` flag agree. It does **not** verify that the
declared verb is *true of the tool's actual behavior*: a tool can honestly declare
`filter` in both places and still, in its code, behave like a `transform`. Proving
a verb against real behavior is a deeper, undecidable-in-general question this tool
does not claim to answer. What `port` gives you is the thing that *is* decidable:
no tool in a composition is described by two declarations that disagree.

## Install & run

Pure Python standard library. No dependencies.

```
python3 port.py verbs
python3 port.py --help
```

## Tests

```
python3 test_port.py
```

15 tests; mutation-bitten (proven to go red when the checker is broken).

## License

MIT © 2026 Shea Gunther
