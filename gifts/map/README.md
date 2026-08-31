# map

**Show what-composes-with-what across a folder of small JSONL tools.**

You have a set of little command-line tools that each read JSON-lines on stdin
and write JSON-lines on stdout. Some can be piped together; some can't. `map`
folds the whole set into a composition map: who can feed whom, how densely the
set composes, and which tools light up the most pipelines.

```
$ python3 map.py text --manifest gifts-manifest.json
Composition map — 30 tool(s) with a declared port-verb
========================================================
composable ordered pairs (A can feed B): 701 / 870
composition density: 80.6%
closed-form check |E|*|A|-|E∩A| = 701  (matches: True)
verb census: {'sink': 1, 'source': 5, 'filter': 6, 'transform': 13, 'fold': 5}
...
```

## The model

Every tool declares one **port-verb** — the type-level shape of its stdin/stdout
contract on the shared JSON-lines interface. Five verbs, and only five:

| verb        | contract                       | meaning                                  |
|-------------|--------------------------------|------------------------------------------|
| `source`    | nothing → JSONL                | emits; no meaningful stdin               |
| `transform` | JSONL → JSONL                  | record in, record out                    |
| `filter`    | JSONL → JSONL′ (output ⊆ input)| record in, a subset out                  |
| `fold`      | JSONL → JSONL_agg              | records in, an aggregate/narrower record |
| `sink`      | JSONL → nothing                | terminal side effect, no pipeable stdout |

The composition rule at the type level is one line:

> **A can feed B** ⇔ A **emits** (A.verb ≠ `sink`) **and** B **accepts** (B.verb ≠ `source`).

`map` counts every ordered pair (A, B), A ≠ B, that passes it, and reports the
density: composable pairs over total possible pairs.

## It reads declarations, it does not guess

`map` does not keep its own hardcoded list of which tool has which verb. It
**reads** each tool's declared `port_verb` from the manifest — the same field the
companion `port` tool reads and checks. A tool that declares no port-verb is
reported as **undeclared** and excluded from the map, with a count. It is never
silently assigned a verb. The map is only ever as honest as the declarations
beneath it, and it says so.

## The honest ceiling

`map` renders the **type**-level answer: can the pipe carry data at all. It does
**not** assert that the **records** fit. A `transform` that emits `{event}` records
type-checks clean into a `filter` that expects `{file}` records — and fails at
runtime. That finer, record-shape question the uniform JSONL type cannot settle,
and `map` never claims it can. It flags the semantic layer as *unproven* in every
rendering.

`map`'s own port-verb is `fold`: a set of gift declarations in, one aggregate
composition-map record out.

## Usage

```
map read    --manifest FILE   # JSONL: one {"kind":"pair",...} per composable pair, then a {"kind":"summary",...}
map summary --manifest FILE   # just the summary record (the aggregate)
map text    --manifest FILE   # human-readable rendering (not JSONL)
map --port                    # print map's own port-verb (fold)
```

The manifest may be a bare JSON list of entries, or an object with a
`gifts` / `tools` / `entries` list. Each entry needs a `slug` and (to appear on
the map) a `port_verb`.

## Requirements

Python 3, standard library only. No dependencies.

## License

MIT. See `LICENSE`.
