# Loop MMT

**A methodology for building software with an AI, and the things it built.**

You probably got here from [loopmmt.com](https://loopmmt.com). The site is the gallery —
the story, told in order, with the good frames up front. This repository is the archive
behind it: the apps you can actually run and read, and the corpus you can actually study.
Nothing here is a pitch. It's the work, laid out so you can go through it yourself.

If the site made you curious, this is where you dig in.

---

## What Loop MMT is, in four sentences

One person builds software by working with Claude across many separate sessions. The
model doesn't remember anything between sessions, so all the long-term memory lives in a
git repository instead — every session reads itself up to speed, does real work, and
writes the result back, and the next session picks up clean. On top of that sits a
thinking tool: a cast of named perspectives argued a problem from several angles instead
of one. The result is this: real apps, a real corpus, built in a one-room place in Maine.

---

## Four ways in

**Run something.** Every app in [`apps/`](apps/) has a working example and its full
source. Start with [`apps/loop21/`](apps/loop21/) — an 18,000-line flow computer in a
single HTML file with zero dependencies — or open [`apps/README.md`](apps/README.md) for
the whole shelf, with one honest line each on what it proves and how to run it.

**Read the corpus.** Everything the site shares in writing is in [`corpus/`](corpus/), in
the same form the site shares it. The Creed across its versions, the protocol registry,
the glossary, the curated knowledge packs, the four foundational documents, the build
standards. Start with [`corpus/README.md`](corpus/README.md) — it's a map, not a stub.

**See how it's made.** [`corpus/receipts/`](corpus/receipts/) holds the paperwork the
system produces on its own at the end of every session — a handoff, a near-miss log, a
close bundle, a work timesheet derived from the git record. They prove the work is real
by being honest, including about the mistakes.

**Take something.** Three small tools in [`gifts/`](gifts/) — a structure-vs-random smell
test, self-healing multi-store git redundancy, and a status board that won't go green on
hope. Standalone, no methodology inside, released **MIT** so you can use them in anything,
including something you sell. Each one prints its own honest limits. They're yours.

---

## The map

```
README.md            you are here
apps/                every app: full source, a per-app README, a working example
gifts/               three standalone tools, MIT-licensed, yours to use anywhere
corpus/              the shared corpus, in the same form the site shares it
site/                the built website, exactly as it's served
LICENSE-corpus       the writing is CC BY-NC 4.0
LICENSE-apps         the code is AGPLv3
LICENSE-gifts        the gifts are MIT
index.json           the machine-readable map of everything here
```

Every directory you can walk into carries its own `README.md`. The tree follows the
reading order: the front door, then the apps you can run, then the corpus you can study.

---

## Two honest notes, because they matter

**Same form as the site — on purpose.** Some documents are shared in a shortened form.
Where the site publishes the protocol registry as a *funnel* rather than the whole map,
or the glossary at milestone versions rather than all of them, the copy here is *that*
shortened form — not a fuller one. The repository ships the site's bytes, not a private
re-export. What you read here is exactly what the site offers, no more and no less, so the
two can never quietly disagree.

**What isn't here, and why.** This is the *image*, not the *generator*. The methodology's
own engine — the composition rules, the session floor's internals, the orchestration that
decides which piece composes with which — stays private, and there are no links from here
that reach it. That's a deliberate air-gap, not an oversight. You can see clearly that the
machine runs, and study a great deal of what it produces, without being handed the plans
to the machine itself. Everything shared here was cleared for release, on purpose, by hand.

---

## License

The **writing** in `corpus/` — the methodology, the documents, the knowledge packs — is
released under **Creative Commons Attribution-NonCommercial 4.0** (`LICENSE-corpus`). Read
it, quote it, build on it, teach with it; just don't sell it, and say where it came from.

The **code** in `apps/` is released under the **GNU Affero General Public License v3**
(`LICENSE-apps`). Use it, change it, run it; keep it open.

The three tools in `gifts/` are released under the **MIT License** (`LICENSE-gifts`) — the
most permissive of the three, on purpose. The apps are shared but copyleft; the gifts are
simply given away. Use them in anything, commercial included, no strings.

---

## Who made this

Shea Gunther, in a one-room place on fifty acres in New Gloucester, Maine — with Claude,
across a lot of nights and weekends. If you're reading this closely enough to have made it
to the bottom of a README, you're exactly the person it was left out for.

*Loop MMT™ · © 2026 Shea Gunther · New Gloucester, Maine*
