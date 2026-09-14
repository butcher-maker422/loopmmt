# seance

**Channel a deleted prompt from git history — safely.**

A prompt (or any tracked text file) had lines in an earlier commit that a later
commit deleted. Weeks on, you want them back — the wording you dropped, the
example you cut, the clause you decided against and now miss. `git log -p` will
show you the churn, but reading a diff stream by eye to reconstruct *what did the
file say at commit X, and what exactly did version X+1 remove* is slow and
error-prone. `seance` channels it: name a file and a commit, and it returns the
file as it stood there — and, told two commits, exactly the spans one version
dropped that the next never restored.

It shows you **what** a version dropped. It does not tell you **why** — the reason
lives in the commit message and the head that wrote it, not in the bytes. seance
is a medium, not an oracle.

```
$ seance.py seances prompt.txt
a1b2c3d4e5f6  2026-09-08  tighten the system prompt
9f8e7d6c5b4a  2026-09-07  first draft

$ seance.py channel prompt.txt --at 9f8e7d6c5b4a
You are a helpful assistant.
key = ‹redacted:aws-access-key-id›
Be concise.
# stderr: {"channel": "prompt.txt", "at": "9f8e...", "masked_spans": 1, ...}

$ seance.py dropped prompt.txt --from 9f8e7d6c5b4a --to a1b2c3d4e5f6
--- dropped L2 (as it stood at 9f8e7d6c5b4a) ---
key = ‹redacted:aws-access-key-id›
```

## The one rule that makes it safe — scrub-bound by construction

A deleted line is the single most dangerous thing to resurrect, because deletion
is exactly how a leaked secret gets removed. If you committed an API key, noticed,
and deleted it in the next commit, **the key is still in history** — and a naive
"recover the deleted lines" tool would hand it right back, on screen, in a paste
you might ship.

That is the whole reason seance is its own gift and not a one-line `git show`:
**every span seance channels passes through a secret scanner first, and any span
carrying a known secret shape is masked before it is ever displayed.** The
redaction happens inside seance, before output — the channel cannot leak what
history buried. It is not a flag you can turn off; a seance that showed you a live
secret it recovered would be the exact hazard it exists to prevent.

The scanner matches by **shape**, not semantics — a `github_pat_` prefix, an
`AKIA…` access-key id, a `-----BEGIN … PRIVATE KEY-----` header, a Slack `xoxb-`
token, a Stripe `sk_live_` key, and (with `--heuristic`) the dot-form of a JWT and
bare 40-hex strings.

## Commands

- `seance.py channel <file> --at <rev>` — the file's content as it stood at `<rev>`, secret shapes masked.
- `seance.py dropped <file> --from <rev> --to <rev>` — the spans `<from>`→`<to>` dropped and did not restore, each masked (`--json` for structured output).
- `seance.py seances <file>` — commits that touched `<file>`, newest first, as rev anchors.
- `seance.py check` — print the shape set and the edge, and self-test.

## Determinism & dependencies

The core is a pure function of two content blobs: the same two versions yield the
same dropped spans and the same masked output on any machine, every run. The one
environment-dependent surface is git itself — which commits exist, what a rev
resolves to — and seance never invents around it: a missing rev or an untracked
file is reported plainly and exits non-zero.

**Zero dependencies** — Python standard library only. It shells out to the `git`
binary (git is the substrate it reads, not a package it imports); the diff / scan
/ mask core is pure and git-free and self-tested without a repo.

## The edge

**seance recovers text a version *dropped* and masks known secret *shapes* in it;
it does not explain *why* a line was removed, and it cannot catch a secret that
has no known shape — a clean channel means no known shape survived, not that the
recovered text is safe.**

## License

MIT. © 2026 Shea Gunther.
