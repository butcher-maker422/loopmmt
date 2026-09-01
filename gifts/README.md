# Gifts

**Forty-four small tools, given away. Take them.**

Most of what Loop MMT built is shared here to *read* and *run* — the apps under their
copyleft license, the corpus under its non-commercial one. These forty-four are different.
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

## [`ward/`](ward/) — a status badge that can't lie about being done

A status badge is a grid of cells, one per claim you want to show as "done." The temptation
with any badge is to fill a cell because you *believe* the thing is finished. Ward refuses:
each cell names a **witness** — a file that must exist, a file that must contain a string, or
a command that must pass — and renders **solid** only when its witness agrees right now.
Anything else rings **hollow**, never a silent solid.

**Honest edge:** the badge is only as honest as the witnesses you write — it proves each
cell's witness agrees, never that the witness captures what "done" really means. Python
stdlib only. `python3 ward.py badge.json --root .` · tests: `python3 smoke_test.py`.

## [`excavation/`](excavation/) — coverage you can check, not a confident skim

Hand an AI (or yourself) a large site and get back *proof of complete coverage* instead of
a confident skim. It folds your site into a typed **manifest**, splits it into shards, and
writes a **reckoning** — and its honesty invariant is decidable: the manifest node-set must
equal the site node-set, or it fails loud. When nothing is left uncovered, coverage is
*demonstrated*, not asserted.

**Honest edge:** it proves *coverage*, not comprehension — that every page was seen, never
that it was understood. Not a crawler, not SEO. Run by an AI only when a human explicitly
asks. Python stdlib only. `python3 excavate.py --check`.

## [`census/`](census/) — finds the markers a visual pass sails past

You leave markers in a codebase all the time — `TODO`, `FIXME`, a tag that says a section
is a stub. The ones that render where you look, a visual pass catches. The dangerous one is
the marker **buried inside a comment**: it never renders, so the eye sails right past it and
the thing it flagged ships anyway. Census tells the two apart and counts what you'd miss.

**Honest edge:** it finds *declared* markers, not undeclared problems — it catches the stub
you flagged and forgot, never the bug you never labeled. Python stdlib only.
`python3 census.py` · tests: `python3 smoke_test.py`.

## [`gitlog/`](gitlog/) — your git history as JSON lines

`git log` is where a project's real history lives — every commit dated, authored, immutable —
but it prints for human eyes, not for a program. `gitlog` reads the log and emits **JSON
lines**: one object per commit, newest first. Once history is a stream of records, the
querying, counting, and folding you couldn't do over formatted text becomes trivial.

**Honest edge:** it reports what the log records, faithfully — added/deleted line counts are
`null` for a binary-only commit, because there's no honest number to give. Python stdlib +
git. `python3 gitlog.py --repo .`.

## [`mint/`](mint/) — IDs that are never reused, and it proves it before returning

A mint stamps a coin once and never stamps that number again. Mint does the same for
identifiers: it keeps a single **high-water mark** and only ever hands out `high_water + 1`,
persisting the bumped mark **before** it returns — so a crash right after issuing cannot
re-issue the same number. Uniqueness is a structural property, not an after-the-fact check.

**Honest edge:** it guarantees *no reuse*, not *no gaps* — a crash can burn a number, and
that's the correct trade (a skipped ID is safe, a reused one is a bug). Python stdlib only.
`python3 mint.py` · tests: `python3 test_mint.py`.

## [`trellis/`](trellis/) — a consistency checker that tells you *where* it broke

Most consistency checks give you a yes/no: it holds, or it doesn't — and when it doesn't,
you go hunting. The Trellis, built on the double-word-square puzzle (every letter valid
across *and* down at once) generalized off letters onto any grid of constraints, instead
**localizes**: each cell reads **FORCED** (one value survives), **FREE** (several fit), or
**CONTRADICTORY** (none), so a failure points at itself.

**Honest edge:** it localizes over the constraints *you declare* — it finds where your
stated rules collide, never a rule you forgot to state. Python stdlib only.
`python3 trellis.py`.

## [`vclock/`](vclock/) — vector clocks: did this happen-before, or concurrently?

Give every actor its own counter and carry the whole *vector* on each record. Now two
records compare: if every one of A's counters is ≤ B's (and they differ), A **happened
before** B; if neither dominates, they are **concurrent**. It answers the one question a
wall-clock timestamp can never honestly express — *could this have known about that?*

**Honest edge:** it captures *causal potential*, not actual causation — that A *could have*
influenced B, never that it did. Python stdlib only. `python3 vclock.py` · tests:
`python3 test_vclock.py`.

## [`verify/`](verify/) — cheap re-check of a fact you already established

"Don't trust, verify" gets ignored because verifying is expensive — establishing that
`X implies Y`, or that two files agree, can take twenty minutes of real work. Verify
records the *inputs* to that conclusion once; re-checking later whether the fact **still
holds** is then a cheap hash-compare. It tells you the ground hasn't moved.

**Honest edge:** it certifies *freshness, never truth* — that the inputs you pinned haven't
changed, never that the original conclusion was correct. `⊢`, not `⊨`. Python stdlib only.
`python3 verify.py`.

## [`reltime/`](reltime/) — a relative-time label that refuses to lie

Turn a timestamp into a short human "when" — `3h ago`, `Jun 20` — where the whole point is
what it **won't** do. No stamp, an empty stamp, or an unparseable value returns `null`: the
caller shows nothing rather than a guessed time. A future stamp (clock skew, a bad record)
also returns `null` rather than `-2h ago` — you can't say how long ago something happened if
it hasn't yet.

**Honest edge:** it refuses to fabricate a "when," which means it shows *nothing* where a
lesser helper would show a wrong label — that silence is the feature. Dependency-free
JavaScript. `reltime(stamp)`.

## [`sha256/`](sha256/) — a browser hash that matches your backend, synchronously

A dependency-free SHA-256 (hex out) that returns the **same 64-character digest as Node's
`crypto.createHash('sha256')`** for the same string — and does it **synchronously**. The
browser's built-in `crypto.subtle.digest` is async; the moment you need a hash in the
middle of an otherwise synchronous check, it forces the whole call chain async and ripples
outward. This one doesn't.

**Honest edge:** it hashes UTF-8 bytes of a string, matching your backend exactly — it is a
correctness-and-ergonomics tool, not a constant-time / side-channel-hardened primitive.
Dependency-free JavaScript. `window.ForestGifts.sha256Hex(str)`.

## [`sudoku/`](sudoku/) — a solver that shows its work

Most Sudoku solvers hand you the answer. This one hands you the **reasoning** — it solves
the way a person does, applying the *lowest* technique that makes progress and recording, at
every step, what it did and why, so the answer is the last line of an argument you can check
by hand. Python stdlib only. `python3 sudoku.py --demo`.

## [`dwell/`](dwell/) — the *when* you commit is the *what* you choose

A cart circles a loop of `n` ticks. Holding is free — an extra full lap changes nothing — and
it leaves only when you **reverse**; which of `k` exits it takes is a pure function of the
phase at the instant of reversal. A tiny, exact model of reversal-indexed routing. Python
stdlib only. `python3 dwell.py route 0 6 12 4`.

## [`conflict/`](conflict/) — refuse to commit a file that no longer parses

A bad merge leaves `<<<<<<<`, `=======`, `>>>>>>>` markers wedged into a file — broken source
that landed, and it hides, because the failure only surfaces when something reads the file.
This scans the working tree and refuses the ones carrying unresolved markers. Python stdlib
only. `python3 conflict.py`.

## [`hunkhole/`](hunkhole/) — find the change git's own tools hide

Git tells you which **files** changed; it does not tell you when a stale tree or a clumsy
restore quietly **reverted** part of a file while leaving the file in place. A presence check
reads that as clean recovery; `hunkhole` reads the hole. Python stdlib only.
`python3 hunkhole.py <BEFORE>`.

## [`markdown/`](markdown/) — one Markdown source, two honest shadows

A tiny, dependency-free Markdown compiler with a single root and pure emitters
(`source → parse() → AST → { toHTML, toPlainText }`), so the HTML and the plain-text
rendering are two honest views of the same parse — never two drifting hand-writes.
Dependency-free JavaScript. `echo "# Hello" | node markdown.js`.

## [`callsigns/`](callsigns/) — memorable IDs that are safe by construction

A random identifier you can read aloud, remember for the length of a standup, and paste
anywhere without escaping — `word-word-hash` (e.g. `sunny-champion-8h3kq7`), confusable-free
by construction, with a hash tail that keeps it near-unique at scale. Python stdlib only.
`python3 callsigns.py`.

## [`tracebus/`](tracebus/) — a message bus that leaves a receipt

A tiny, dependency-free publish/subscribe bus with two rules most buses skip: **every legal
path is declared up front, and every emission is written to a log you can replay.** A bus you
can audit after the fact instead of guessing what fired. Dependency-free JavaScript.
`node tracebus.js --demo`.

---

## License

All forty-four are **MIT** (see each folder's `LICENSE`, and `../LICENSE-gifts`). That's the
whole point — they're yours.

*Loop MMT™ · © 2026 Shea Gunther · New Gloucester, Maine*
