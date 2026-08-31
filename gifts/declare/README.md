# declare

**Save a named, reusable pipeline of small JSONL tools as a "gift score".**

You keep retyping the same chain of little command-line tools:

```
gitlog | vclock | cairn
```

`declare` turns that ad-hoc shell pipe into a saved, named, shareable
artifact — a *score* — that you (or anyone you hand it to) can keep, read, and
re-run later, instead of remembering the exact sequence.

```
$ python3 declare.py write --name commit-causality --stages gitlog,vclock,cairn \
      --note "git history -> causal order -> durable store"
{
  "kind": "gift-score",
  "name": "commit-causality",
  "stages": [
    "gitlog",
    "vclock",
    "cairn"
  ],
  "note": "git history -> causal order -> durable store"
}
```

That JSON is the whole score: a name and an ordered list of tool slugs. Keep it
in a repo, pipe it around, hand it to a friend — it is yours the moment it is
written down.

## The score is deterministic

The same inputs always produce the same bytes: fixed key order, `stages` in the
order you gave them (never sorted — the order *is* the pipeline), and a note only
when you supply one. `declare check` re-emits a saved score and byte-compares, so
you can prove a stored score is still in canonical form:

```
$ python3 declare.py check --score commit-causality.json
$ echo $?
0     # already canonical
```

## What it does — and does not — do

`declare` **saves** a pipeline. It deliberately does not **validate** it and does
not **run** it:

- It does not check that the stages typecheck — that each stage emits what the
  next accepts. That is `typecheck`'s job. Run `typecheck` on the score's stages.
- It does not execute the pipeline. That is a runner's job.

`declare` will happily write down a score that would not typecheck; it makes no
claim that a saved score is runnable, only that it is faithfully recorded. It
does one honest structural check — every stage slug is non-empty and there is at
least one stage. Pass `--manifest` and it will additionally flag any stage that
is not a declared tool in that manifest, **saving the score anyway and flagging
it**, never silently dropping a stage.

This is the compose set working together, each piece standalone:

```
declare  — write the pipeline down        (this tool)
typecheck — check it emits/accepts cleanly  (a separate tool)
map      — show what can chain at all       (a separate tool)
port     — label each tool's shape          (a separate tool)
```

They share a file format, not a codebase. A score written here feeds straight
into `typecheck`; none of them import each other.

## Usage

```
declare write --name NAME --stages A,B,C [--note "..."] [--manifest F]
declare check --score score.json      # re-emit canonically, byte-compare; exit 3 if it differs
declare --port                        # print own port-verb (source)
declare --selftest                    # built-in checks
```

Exit codes: `0` ok · `3` (check) the file is not canonical · `2` a malformed
score or usage error.

## Design

One file, Python 3, standard library only. No dependencies, no network, no
state. The format is a flat, named, linear pipeline on purpose — the atom of
"a saved composition is a program you keep." The `stages` list is the seam a
future version could grow branches on, without changing the tools that already
read a score.

MIT licensed. Take it, change it, ship it.
