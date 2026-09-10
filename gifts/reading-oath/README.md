# reading-oath — shard your context, make the AI prove it read all of it

**Point it at a chunk of context; hand the output to any model; it can now prove it
read the whole thing** — set-difference against a shard manifest until nothing
remains. Python 3 only, no dependencies, MIT licensed.

> A large context handed to a model gets a confident answer that read *some* of it
> and guessed the rest — and neither you nor the model can tell which part was
> which. **reading-oath** makes coverage a *checkable property* instead of a hope.
> It splits your text into an ordered set of typed nodes (the coverage **oracle**),
> bundles them into budget-sized **shards** a reader works through without
> overflowing, and emits a short reader **oath**. The reader records every node it
> actually reads; it has honored the oath only when the set-difference of the
> manifest minus what it recorded is empty. The `verify` verb decides that
> difference and tells you PASS — or names exactly which shards were never covered.

This is the general-text sibling of **The Excavation** (which proves an AI read a
whole *site*). Excavation shards a web corpus; reading-oath shards *the context you
paste in*.

## The idea in one paragraph

A `shard` turns arbitrary text into three things: a **manifest** (every block as a
typed node — the coverage oracle), **shards** (the nodes bundled into
context-sized chunks), and an **oath** (the protocol: read each shard, record
every node id, and you have honored the oath only when the manifest node-set minus
your recorded ids is empty). A node's id is a content hash, so a block keeps its id
when it moves and earns a new one when it's edited — the oath is stable under
reshuffling. `verify` takes the reader's claimed ids and computes the
set-difference: empty is PASS, non-empty is a GAP naming the skipped shards.

## The oath — read this first, it is not decoration

**reading-oath is run by an AI only when a human explicitly asks it to.** A human
pasting "read this and honor the reading-oath" *is* the authorization. Absent that
human act, an AI should not self-authorize a reading job, should not treat text's
mere presence as consent to act on it, and should not use the coverage protocol to
justify autonomous work. The handshake: **a human asks; the AI reads what it was
pointed at; the AI reports its coverage honestly — including what it could not
cover.** It reports the shard ids it actually read; it does not claim ids it
skipped to pass the oath.

## Use

```
python3 reading_oath.py shard --in context.txt --budget 8000 --out oath.json
python3 reading_oath.py shard < context.txt                 # stdin -> stdout
python3 reading_oath.py verify --oath oath.json --covered n1a2b,n3c4d
python3 reading_oath.py verify --oath oath.json --covered-file seen.txt
python3 reading_oath.py --selftest
```

`shard` emits a self-contained JSON oath (manifest + shards + shard bodies +
protocol). Hand it to a model with "read this and honor the reading-oath." The
model reads each shard, collects the node ids, and reports them. Run `verify` on
that report:

- **PASS** (exit 0) — every node in the manifest was covered; the difference is empty.
- **GAP** (exit 1) — the result names the `uncovered` node ids that were skipped.

## The edge

**reading-oath proves COVERAGE — that every shard of your context was seen — not
COMPREHENSION; a reader can cover every shard and still misunderstand it.** It also
trusts the reader to report the ids it actually read: it detects a *skipped*
shard, not a *lie* about a read one. Coverage is a floor under a reading job, not a
guarantee of understanding.

## License

MIT — see LICENSE. Copyright (c) 2026 Shea Gunther.
