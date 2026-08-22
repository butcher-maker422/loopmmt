# Ward

**A self-verifying integrity badge that will not go solid on hope.** ~200 lines,
Python standard library only, no dependencies, deterministic, MIT licensed.

> Every filled cell on the badge carries a witness beneath it — real, checkable
> evidence — or Ward leaves it a hollow ring.

## The idea in one paragraph

A status badge is a grid of cells, one per claim you want to show as "done." The
temptation with any badge is to fill a cell in because you *believe* the thing is
finished. Ward refuses to. Each cell names a **witness** — a file that must exist,
a file that must contain a string, or a command that must exit 0 — and a cell
renders **solid** only when its witness actually agrees right now. Any claim whose
witness is missing, disagrees, is malformed, or is simply absent renders as a
**hollow ring** — never a silent solid. The badge's own honesty is the feature:
you cannot make a cell lie by asserting harder. Green always means something,
because green is the only thing a real witness can produce.

## Install

Copy `ward.py`. That's it. Python 3.8+.

## Use

Write a badge spec — a JSON list of cells, each with a `label` and a `witness`:

```json
[
  { "label": "README present", "witness": "file:README.md" },
  { "label": "license is MIT",  "witness": "contains:LICENSE::MIT" },
  { "label": "tests pass",      "witness": "cmd:python3 smoke_test.py" },
  { "label": "not done yet",    "witness": "" }
]
```

```bash
python3 ward.py badge.json --root .              # a 3x3 grid of glyphs + a legend
python3 ward.py badge.json --root . --cols 2     # any grid width you like
python3 ward.py badge.json --format html         # an HTML fragment (cells carry data-state)
python3 ward.py badge.json --format json         # the resolved cells, for piping
python3 ward.py --selftest                       # prove the coerce weld
```

Witnesses:

| Witness | Cell goes solid when |
|---|---|
| `file:PATH` | `PATH` exists |
| `contains:PATH::TEXT` | `PATH` exists **and** contains the literal substring `TEXT` |
| `cmd:SHELL` | the command exits `0` |
| *(empty)* | never — a declared-only cell, shown as a ring on purpose |

The glyphs: `◉` solid (witness agrees) · `○` ring (unearned). Exit `0` only when
every cell is solid; any ring exits `1`, by design — an unearned badge is a
failure, not a decoration.

## The coerce weld — the one load-bearing rule

Every cell state is routed through a single gate, and an unknown, missing, or
errored witness result can only ever become a **ring**. There is deliberately no
code path from a bad witness to a solid cell. That is what makes the badge worth
trusting: not that it is always full, but that a filled cell always has something
true beneath it. The self-test enumerates the ways a witness can fail — missing
file, failing command, malformed spec, unknown kind, no witness at all — and
proves each one lands on a ring.

## What it's good for (graded honestly)

- **A README / release badge that can't lie to you — its reason to exist.** Drop
  the HTML fragment into a page or the text grid into a README and the badge is
  wired to the actual evidence, not to whoever last edited the markup.
- **A pre-ship glance.** Nine cells, one look: what is genuinely earned and what
  is still hollow. Run it in CI and a badge that isn't fully earned fails the
  build instead of shipping green.
- **Making "declared, not done" visible.** A cell with no witness renders as a
  ring flagged *declared only* — the badge shows the gap instead of hiding it.
- **A tiny, dependency-free status glyph anywhere.** One stdlib script, a plain
  JSON spec, `--format json` for a pipeline. No server, no framework.

## What it is **not** good for — read this before you trust the solid

- **Proving the witness is the *right* witness.** Ward checks that the evidence
  **exists and agrees**, never that it is **correct**. Point a cell at the wrong
  file and it will happily go solid — choosing a witness that actually means what
  the claim says is your job, and the whole craft. Presence is not proof of
  substance.
- **Untrusted specs.** A `cmd:` witness runs your shell. Treat a badge spec like
  a Makefile — don't run one you didn't write. (Want a badge with no execution?
  Use only `file:` and `contains:` witnesses.)
- **Continuous monitoring.** Ward is a **point-in-time** reading — it tells the
  truth at the moment you run it, not a second later. Wire it to the moments that
  matter (a pre-merge gate, a pre-deploy step); it is not a watchdog.

The tool prints its honest ceiling as part of every run. Shipping the limits
*with* the tool is the point.

## Sibling

Ward is the **badge**-shaped member of a small family. Its board-shaped sibling,
`plumb`, applies the same principle — *a claim is only as green as its witness* —
to a full status board with named verdicts. Ward renders the compact nine-cell
glyph; plumb renders the itemized board. Same honesty, two surfaces. Use whichever
fits where you need to show the truth.

## Provenance

Extracted and generalized from the integrity check that keeps a private
methodology's session-close badge honest — a nine-cell status glyph whose rule is
that no cell may render solid unless the committed evidence beneath it actually
agrees. The badge's specific spec-coupling stayed home; this is the general kernel
— *a cell is only as solid as its witness* — given away.

## License

MIT. See `LICENSE`.
