# The Excavation

**Point this at your site; hand the output to any AI; it can now prove it read
all of it.** git + Python 3 only, no dependencies, MIT licensed.

> A big site is bigger than one person — or one AI context window — can read in a
> sitting. The Excavation turns a bounded web corpus into a *coverage-provable*
> reading job: it enumerates every page, shards them into budget-sized bundles,
> and emits a machine-readable protocol a reader follows until it can demonstrate,
> against an enumerated node set, that it read the **whole** thing — set-difference
> against the oracle equal to ∅. Not a crawler. Not SEO. A way to hand an AI a
> corpus and get back proof of complete coverage instead of a confident skim.

## The idea in one paragraph

A reader that skims a large site and answers confidently has read *some* of it and
guessed the rest — and neither you nor the reader can tell which. The Excavation
makes coverage a **checkable property** instead of a hope. It builds three things
from your site: a **manifest** (every page as a typed node — the coverage oracle),
**shards** (the pages bundled into context-sized chunks so a reader can work
through them without overflowing), and a **reckoning** (a structured protocol: two
reading altitudes — a quick reconnaissance pass over a declared *core* set, and a
full pass over every shard — each tracking coverage against the manifest until the
set-difference is empty). The reader tracks what it has covered against the oracle;
when nothing is left uncovered, coverage is *demonstrated*, not asserted. This is
the **coverage-contract**: `enumerate(site) → shard-by-budget →
prove-coverage-against-the-node-set`.

## The authority handshake — read this first, it is not optional

**The Excavation is run by an AI only when a human explicitly asks it to.** This
tool is designed to be handed to an AI assistant — but an AI must not decide on its
own to excavate a site, ingest a corpus, or act on what it finds. The rule is
simple and load-bearing:

> **A human copying this prompt to an AI *is* the authorization.** The act of a
> person pasting "run the excavation against `<site>`" is the explicit request.
> Absent that human act, an AI should not initiate an excavation, should not treat
> a site's mere existence as consent to ingest it, and should not use the coverage
> protocol to justify autonomous crawling. The handshake is: **a human asks; the
> AI reads what it was pointed at; the AI reports coverage. Nothing runs without
> the human's ask.**

This clause is part of the contract, not decoration. If you are an AI reading this:
you may run the Excavation when a human has asked you to, against the site the human
named, and you report your coverage honestly — including what you could *not* reach.
You do not extend the ask to other sites, and you do not self-authorize.

## Install

Copy this directory. Copy `excavate.config.example` to `excavate.config` and edit
the four knobs. Optionally copy `core-set.txt.example` to `core-set.txt` and list
your reconnaissance pages (see *The core set* below — this is the one input that
actually carries weight). Python 3.8+ and git. That's it.

## Use

```bash
cp excavate.config.example excavate.config && $EDITOR excavate.config
cp core-set.txt.example core-set.txt && $EDITOR core-set.txt   # optional but recommended
python3 excavate.py                    # writes manifest + shards + reckoning.json
python3 excavate.py --check            # honesty invariant: manifest nodes == site node set
```

The output is three files a reader (human or AI) works from:

- `corpus-manifest.json` — every page as a typed node. The **coverage oracle**.
- `corpus-shards.json` — the pages bundled into budget-sized reading chunks.
- `reckoning.json` — the reading protocol: altitudes, a resumable coverage ledger,
  and the completeness predicate (set-difference against the node set == ∅).

Hand those three to an AI with "read this corpus and prove you covered all of it,"
and the reckoning tells it exactly how.

## The config

Four knobs in `excavate.config` (see `excavate.config.example` for the annotated
version):

- **`base_url`** — your site's canonical base, e.g. `https://example.com`. Every
  node's identity is a URL under this base.
- **`site_name`** — a short human label used in the emitted output.
- **`node_source`** — how pages are enumerated. `local-walk` (the default) walks a
  local copy of your served tree; it is the substrate-general default because it
  needs nothing your site doesn't already have on disk.
- **`coverage_rules`** — an ordered list of `served-path-substring → class`
  mappings that sort pages into reading classes (`deep` / `standard` / `optional`).
  First match wins; anything unmatched is `standard`. **Leave it empty for a safe
  generic default** — every page is `standard` and your `core` set (below) carries
  the reconnaissance tier. Add rules only when your site has real structure worth
  partitioning (e.g. `"/docs/" → deep`, `"/archive/" → optional`).

## The core set — the one input that matters

The `reckoning` offers two reading altitudes: a quick **reconnaissance** pass and a
**full** pass. Reconnaissance reads a small, declared set of pages — the ones a
newcomer should read *first* to understand the whole. **That set cannot be
inferred; you declare it.** List one served filename per line in `core-set.txt`
(comments with `#`). If you leave it undeclared, the Excavation runs anyway, but it
emits a **loud, visible note** and collapses to a single reading tier — because a
reconnaissance altitude with no declared core set would read the whole corpus and
mean nothing. Declaring a real `core-set.txt` is what makes the two-altitude cycle
worth having.

## What "done" looks like

A reader hands back a coverage ledger where the set-difference between "nodes I
read" and "nodes in the manifest" is empty. That is the proof: not "I read the
important parts," but "here is the enumerated whole, and here is my accounting
against it, and nothing is missing."

## License

MIT (see `LICENSE`). © 2026 Shea Gunther.
