# scrub — catch a secret before it ships, from shapes not luck

**scrub** reads text and finds the things that should never have been in it — a GitHub
token, an AWS key, a PEM private-key block, a Slack token, a JWT, a password in a URL —
by matching them on **shape**. It can **report** them, **redact** them, or **refuse**
(a non-zero exit if any secret is present, so it drops into a pre-commit hook or a CI gate).

Zero dependencies. Runs identically in a browser (`window`/`require`) or on Node. The scan
is deterministic — same text yields the same findings, every run — and it **never echoes a
secret**: a finding carries the secret's kind, its line and column, and a masked preview
(`gith…(54)`), never the value.

## Use

```
node scrub.js --scan   FILE      # report findings: kind:line:col + masked preview  [default]
node scrub.js --scrub  FILE      # emit the text with every secret replaced
node scrub.js --check  FILE      # exit 1 if any secret is present, 0 if clean (the gate)
node scrub.js --list             # list the secret shapes it knows
node scrub.js --selftest         # run the golden-corpus selftest
echo -n "text" | node scrub.js --check    # reads stdin when no FILE is given
```

`--check` is the gate: `git diff | node scrub.js --check` refuses (exit 1) the moment a
known secret shape appears. `--scrub` replaces each secret span with a fixed per-kind
placeholder — `‹redacted:github-pat›` — and its output is idempotent and always passes
`--check` clean (no secret survives a scrub).

## The allow marker

A single line may opt out by carrying the marker **`scrub-allow`** anywhere on it (in a
comment). That line is skipped — for a README that documents a token shape, or a test
fixture that must contain a planted example:

```
export EXAMPLE_TOKEN=github_pat_<your-token-here>   # scrub-allow (doc example)
```

The carve-out is **line-scoped and explicit**: you cannot silence the scanner globally, only
annotate the one line you vouched for. (This tool's own test fixtures are assembled from
parts at runtime for the same reason a secret-scanner's fixtures must never be literal
secrets — including for its own siblings.)

## The edge (what it does NOT do)

> scrub matches **known** secret shapes. A clean result means no known shape was found here —
> it is **not** proof the text is secret-free. A novel token format, a secret split across
> lines, a home-rolled scheme, or a value with no distinguishing shape will pass clean. scrub
> is a **smoke alarm, not a vault**: a hit is real; a clean scan is the absence of a known
> shape, never a certificate.

Because it matches shapes, it also flags **example** secrets — AWS's own `AKIA…EXAMPLE`
placeholder, a documented token in a README, its own test fixtures. It cannot tell a real key
from a fake one; that is the honest ceiling working, not a bug. Use the `scrub-allow` marker
to vouch for a line you know is safe, and keep your other controls: `scrub` is one cheap,
deterministic layer, not the whole defense.

## Shapes it knows

`github-pat` · `github-token` · `aws-access-key-id` · `google-api-key` · `slack-token` ·
`stripe-key` · `openai-key` · `jwt` · `private-key-block` · `basic-auth-url` · `hex-40-token` ·
`secret-assignment` *(heuristic — a generic `secret = …` assignment; drop it with
`--no-heuristic` if it is too eager)*.

## Provenance

Stripped from the Loop MMT band gate's exit-9 credential scan — the check that refuses to
seal a session bundle if a token is in it. The general kernel (scan for a secret shape, fail
loud, carve out a vouched-for line) is universal; the methodology-specific patterns stayed
home. MIT-licensed, © 2026 Shea Gunther.
