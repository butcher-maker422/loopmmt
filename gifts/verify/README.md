# Verify

**A cheap re-check of a fact you already established — freshness, never truth.**
~700 lines, Python standard library only, no dependencies, deterministic, MIT
licensed.

> Establishing a fact is expensive. Re-checking that it still holds is cheap —
> *if you kept the right certificate.* Verify keeps the certificate and does the
> cheap check. It tells you the ground hasn't moved; it never claims the fact is
> true.

## The idea in one paragraph

"Don't trust, verify" is good advice that gets ignored because verifying is
expensive. Establishing that some fact holds — `X implies Y`, `this config is
correct`, `these two files agree` — can take twenty minutes of real work.
Re-checking, later, whether that same conclusion *still* holds is cheap **if you
kept the right certificate** — and the right certificate is a content hash of the
byte-truth inputs the conclusion stood on. That is the same NP asymmetry a build
cache lives on (Nix, Bazel, ccache, git's own Merkle tree): finding the answer is
hard, checking a kept answer against unchanged inputs is a hash compare. Verify
gives that asymmetry a tiny CLI. You `register` a fact with the input paths its
derivation consumed; Verify hashes them and keeps the certificate. Later you
`verify` it: if every input still hashes to what it hashed, the fact is **FRESH**;
if an input moved, it is **STALE** and must be re-derived; if an input is gone or
the fact was retired, it is **DEAD**. The one thing it will never do is tell you a
fact is *true* — only that the ground under it has not moved.

## Install

Copy `verify.py`. That's it. Python 3.8+. The fact store lives in a `.verify/`
directory under your working directory (like `.git/`); override the location with
the `VERIFY_REPO_ROOT` environment variable.

## Use

```bash
# register a fact's certificate after the expensive derivation
python3 verify.py register --fact-id cfg-ok --claim "prod config matches schema" \
        --edge "schema.json + config.yaml -> valid" --inputs schema.json config.yaml

# later — the cheap re-check
python3 verify.py verify --fact-id cfg-ok            # FRESH / STALE / DEAD, exit-coded
python3 verify.py verify --fact-id cfg-ok --json     # machine verdict on stdout

python3 verify.py list                               # the derived registry (a pure fold)
```

Verdicts and exit codes:

| Verdict | Meaning | Exit |
|---|---|---|
| `FRESH` | every input still hashes to what it hashed — the ground is unchanged | `0` |
| `STALE` | an input **moved** — re-derive and re-register | `3` |
| `DEAD` | a required input is **missing**, or the fact was retired — the ground is gone | `5` |
| `UNREGISTERED` | no certificate on file — a cache miss, re-derive and register | `4` |
| `ASSUMED` | the id is an assumption, not a fact — surfaced, never certified | `6` |

For a claim you are *leaning on* but have **not** grounded yet, use `assume` (it
takes no `--inputs` by design — its defeater is a human-judged expiry, not a
hash):

```bash
python3 verify.py assume --fact-id price --claim "vendor price current" \
        --path "re-fetch the price page" --expiry "2026-12-01"
python3 verify.py verify --fact-id price      # ASSUMED — surfaced, not faked FRESH
python3 verify.py discharge --fact-id price --inputs price-snapshot.json  # promote to a fact
```

There is also `decide` (record "A beats B" plus the premise fact-ids it rested on;
verifying it folds the premises' freshness), `retire` (call a fact dead), and
`fold --check` (prove the registry projection is fold-twice-identical).

## What it's good for (graded honestly)

- **Cheap re-validation of an expensive conclusion.** The whole point: you paid
  once to establish `X -> Y`; you pay a hash compare to know it still stands. Wire
  `verify` into a pre-merge or pre-deploy step and a moved input turns a silent
  stale assumption into a loud STALE.
- **Catching cache-invalidation-by-hope.** The dangerous fact is the one you
  established months ago and never re-checked because re-checking felt expensive.
  Verify makes the re-check a one-second command, so "is this still true?" stops
  being a thing you skip.
- **Separating grounded facts from leaned-on assumptions.** `assume` refuses to
  fake a freshness verdict on a claim whose defeater is a human judgment (a date,
  an external event). It surfaces the assumption, its path, and its expiry — and
  makes you judge — instead of painting it green.
- **A tiny, dependency-free provenance ledger.** One stdlib script, an append-only
  `.verify/verified.jsonl`, `--json` for a pipeline. No server, no database.

## What it is **not** good for — read this before you trust the green

- **Proving a fact is TRUE.** This is the ceiling, and it is the whole honesty of
  the tool: `FRESH` means the byte-truth inputs are **unchanged since you kept the
  certificate** — it does **not** re-run the judgment that made the fact true in
  the first place. In proof-theory terms the verdict is `⊢`, never `⊨`: the
  derivation still holds on unchanged premises; whether the premises match reality
  is a separate question Verify does not touch. Calling `FRESH` "true" is the
  mistake the tool exists to prevent. It prints this ceiling on stderr on every
  run — reading it *with* the tool is the point.
- **Live or external facts.** "The current price," "who is CEO now" — their input
  set is the world, which you cannot cheaply re-hash. Verify is for the
  **byte-truth-derivable** fact class only: facts whose inputs are finite,
  content-addressable, and stable when nothing changes. For live facts, re-acquire
  from the source; do not pretend a cache can certify them.
- **Choosing the right inputs.** Verify hashes the inputs *you name*. Name too few
  and a real dependency can move without tripping STALE — a false FRESH. Naming the
  inputs that actually ground the fact is your job, and the craft.
- **A decision staying *right*.** `decide` checks that a choice's premises still
  hold (`decision-fresh`); it never re-runs the choice. A brand-new option could
  beat your pick with no premise moving. Premise-stability is not
  still-the-best-choice — the tool says so, in the verdict.

## The knobs

- `VERIFY_REPO_ROOT` (env) — where the `.verify/` fact store lives. Defaults to the
  current working directory.
- `--json` (on `verify`) — machine-readable verdict on stdout; the CEILING still
  prints on stderr, so the pipe stays clean.
- `--provenance internal|external` (on `register`) — tags whether the fact is
  byte-truth-derivable (the cache class) or live (route to re-acquire).

## Provenance

Extracted from the verification primitive of a private methodology — a
content-hash certificate re-check that keeps the methodology's "don't trust,
verify" discipline cheap enough to actually run. The internal copy is licensed
AGPL-3.0-or-later; this standalone gift copy is released **MIT** by the copyright
holder (dual-licensing one's own original, stdlib-only work — no third-party code
is incorporated). The internal store path and repo coupling stayed home; this is
the general kernel — *a fact is only as fresh as its certificate* — given away.

## License

MIT. See `LICENSE`. Copyright (c) 2026 Shea Gunther.
