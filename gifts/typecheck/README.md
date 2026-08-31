# typecheck

**Validate a pipeline of small JSONL tools before you run it.**

You have a set of little command-line tools that each read JSON-lines on stdin
and write JSON-lines on stdout. You want to chain some of them — `A | B | C` —
but not every chain makes sense: pipe a tool that produces no output into one
that expects input, and you get a confusing empty result three stages deep.
`typecheck` tells you, *before you run anything and with no side effects*,
whether a chain is well-formed: does each stage emit what the next one accepts.

```
$ python3 typecheck.py text --pipeline gitlog,vclock,cairn --manifest gifts-manifest.json
typecheck — gitlog -> vclock -> cairn
========================================================
   stage 0: gitlog [source] (first) — ok
   stage 1: vclock [transform] (middle) — ok
   stage 2: cairn [sink] (last) — ok
ok hop   gitlog -> vclock  [source -> transform] — ok — emitter feeds an acceptor
ok hop   vclock -> cairn  [transform -> sink] — ok — emitter feeds an acceptor
--------------------------------------------------------
RESULT: TYPECHECKS
```

Break it — put a sink in the middle — and it says exactly which hop fails, and
exits non-zero so you can gate on it:

```
$ python3 typecheck.py check --pipeline gitlog,cairn,vclock --manifest gifts-manifest.json
...
{"kind": "hop", "from": "cairn", "to": "vclock", ... "typechecks": false,
 "reason": "cairn is a sink — it emits no stdout, so vclock has nothing to read"}
$ echo $?
3
```

## The model

Every tool declares one **port-verb** — the type-level shape of its
stdin/stdout contract on the shared JSON-lines interface. Five verbs, and only
five:

| verb        | contract          | meaning                              |
|-------------|-------------------|--------------------------------------|
| `source`    | nothing → JSONL   | emits; ignores stdin                 |
| `transform` | JSONL → JSONL     | record in, record out                |
| `filter`    | JSONL → JSONL′    | record in, a subset/derivative out   |
| `fold`      | JSONL → aggregate | many records in, a summary out       |
| `sink`      | JSONL → nothing   | accepts; produces no pipeable stdout |

The rule for whether **A can feed B** is one line:

```
A can feed B   iff   EMITS(A) and ACCEPTS(B)
EMITS(v)   = v != "sink"      # a sink produces no pipeable stdout
ACCEPTS(v) = v != "source"    # a source ignores its stdin
```

`typecheck` walks the adjacent pairs of your pipeline and applies that gate to
each hop. It also checks the endpoints: a `source` anywhere but first would
ignore the stream handed to it, and a `sink` anywhere but last would swallow the
stream the next stage needs — both are errors it names.

## The manifest

The port-verbs come from a manifest — any JSON list of entries (or an object
with a `gifts` / `tools` / `entries` list), where each entry has a `slug` and a
`port_verb`. A slug you name in the pipeline that isn't in the manifest, or has
no valid port-verb, is reported as **UNRESOLVED** and fails the check — it is
never guessed.

## What it does not do — read this

`typecheck` validates the **port type**, not the **record shape**. Two tools can
both speak JSON-lines (so the ports agree) while the *records* one emits are not
the records the other expects. That pipeline typechecks clean here and still
fails at runtime. `typecheck` is honest about this: it tells you the ports agree,
and it explicitly flags that the record-shape fit is **unproven**. It never
claims the deeper semantic compatibility it cannot decide.

## Usage

```
typecheck check --pipeline A,B,C --manifest gifts-manifest.json   # JSONL verdict, exit 3 if bad
typecheck text  --pipeline A,B,C --manifest gifts-manifest.json   # human-readable
typecheck --port                                                  # print own port-verb (filter)
typecheck --selftest                                              # built-in checks
```

Exit codes: `0` the pipeline typechecks · `3` it does not · `2` a usage or input
error.

## Design

One file, Python 3, standard library only. No dependencies, no network, no
config, no state. The subtype relation is seeded flat (nominal equality), left
as a seam so a future variance edge can be added without rewriting the gate.

MIT licensed. Take it, change it, ship it.
