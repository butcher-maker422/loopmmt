# Gifts

**Three small tools, given away. Take them.**

Most of what Loop MMT built is shared here to *read* and *run* — the apps under their
copyleft license, the corpus under its non-commercial one. These three are different.
They're standalone, they carry no methodology, and they're released under the **MIT
license** — the most permissive one there is. Use them in anything, including something
you sell. No attribution required, though it's always kind.

Each one was pulled out of the working system because it does one honest thing well, and
because the thing it does is useful to anyone, not just to us. Each ships with its limits
**printed on it** — the tool tells you what it does *not* catch, because a tool that hides
its edges is the opposite of a gift.

---

## [`grain/`](grain/) — a structure-vs-random smell test

Compress your data with a stdlib compressor, compare the ratio against a size-matched,
deterministically-seeded random null model drawn live, and get back a self-calibrating
reading of *how much structure vs. noise* — no hand-set threshold. Snapshot it over time
and it becomes a cheap drift alarm for a corpus going stale or homogenizing.

**Honest edge:** it's a *smell*, not a proof. Great for staleness and homogenization
drift; a smoke alarm, not an arson investigator. Not a data-rot / dead-link checker —
wrong tool for that. Python stdlib only. `python3 grain.py --help` · tests: `python3 test_grain.py` (5/5).

## [`cairn/`](cairn/) — self-healing multi-store git redundancy

Priority-ordered failover clone + a host-aware credential helper + redundant push across
*distinct-class* git stores, so your canonical history survives any one store going away.
The load-bearing idea is the **independence class**: two mirrors on the same provider
aren't redundancy. Describe your stores once; a push succeeds only when enough *distinct
classes* confirm it.

**Honest edge:** it survives store loss, not corruption you push yourself — if you push a
bad commit, every mirror faithfully keeps your mistake. Bash + git. Ships with an example
config carrying **no real hosts or credentials.** `./cairn.sh` · tests: `./smoke_test.sh` (5/5).

## [`plumb/`](plumb/) — a status board that refuses to go green on hope

A tiny audit pattern for anyone whose dashboards turn green on *intention* instead of
*evidence*. Each claim names a **witness** — a file that must exist, text that must be
present, a command that must pass — and the claim only renders green if its witness
actually agrees. Assert done with nothing beneath it and you get `UNWITNESSED`, not a pass.

**Honest edge:** it checks the witness *exists and agrees*, never that the witness is the
*right* one. Point it at the wrong file and it'll happily pass — choosing a meaningful
witness is your job. Python stdlib only. `python3 plumb.py --help` · tests: `python3 smoke_test.py` (8/8).

---

## License

All three are **MIT** (see each folder's `LICENSE`, and `../LICENSE-gifts`). That's the
whole point — they're yours.

*Loop MMT™ · © 2026 Shea Gunther · New Gloucester, Maine*
