# Plumb

**A status board that refuses to show green on hope.** ~300 lines, Python
standard library only, no dependencies, deterministic, MIT licensed.

> Every "PASS" on your board must carry a witness beneath it — real, checkable
> evidence — or Plumb won't paint it green.

## The idea in one paragraph

A status dashboard is only as honest as the moment someone typed "done." Plumb
severs the claim from the hope: you list the things that must be true, and each
one names a **witness** — a file that must exist, a file that must contain a
string, a path that must be *absent*, or a command that must exit 0. Plumb checks
every witness and renders the board. A claim you assert as PASS is shown green
**only** if its witness actually agrees; a claim asserted PASS with a missing,
failing, or *entirely absent* witness is caught, marked, and fails the run. A
plumb line tells the truth about vertical no matter how the wall feels — this
tells the truth about "done" no matter how confident the board is. The one thing
it will never do is show a green cell with nothing true beneath it.

## Install

Copy `plumb.py`. That's it. Python 3.8+.

## Use

Write a board file — one claim per line, 2 or 3 pipe-separated fields:

```
# release.plumb — NAME | [STATUS] | WITNESS   (status defaults to 'assert')
readme has a license  | contains README.md ~ MIT
build artifact exists | exists dist/app.tar.gz
no secret committed   | absent .env
tests pass            | cmd make -s test
docs site             | todo | exists site/index.html
```

```bash
python3 plumb.py release.plumb          # human table + summary; exit != 0 if anything is off
python3 plumb.py release.plumb --json   # machine-readable, on stdout
python3 plumb.py - < release.plumb      # read the board from stdin
```

Witnesses:

| Witness | Satisfied when |
|---|---|
| `exists PATH` | `PATH` exists |
| `absent PATH` | `PATH` does **not** exist |
| `contains PATH ~ TEXT` | `PATH` exists and contains the literal substring `TEXT` |
| `cmd SHELL ...` | the command exits `0` |
| `none` | never — an explicit "no evidence" (the honesty case) |

Verdicts:

| Verdict | Meaning | Green? | Run |
|---|---|---|---|
| `HELD` | asserted, witness satisfied | yes | clean |
| `BROKEN` | asserted, witness **not** satisfied | no | **fails (exit 1)** |
| `UNWITNESSED` | asserted with **no** witness | no | **fails (exit 1)** |
| `BLOCKED` | witness couldn't be evaluated (bad spec) | no | **fails (exit 2)** |
| `TODO` | `todo` claim, not yet satisfied | no | clean |
| `READY` | `todo` claim that **is** satisfied — promote it | no | clean |

Relative paths and commands resolve from the board file's own directory (override
with `--cwd`). Exit `0` only when every asserted claim is `HELD`.

## What it's good for (graded honestly)

- **A release / ship checklist that can't lie to you — its reason to exist.**
  "Ready to ship" stops being a feeling and becomes a set of witnesses that either
  hold or don't. The board is the gate; run it in CI and a green-on-hope cell
  fails the build instead of shipping.
- **Catching the "we said it was done" gap.** The most valuable verdict is
  `UNWITNESSED`: a claim someone asserted with nothing beneath it. Plumb makes
  that impossible to hide — an asserted PASS with no witness is a failure, not a
  green cell.
- **A promotion signal for in-progress work.** Mark not-yet-done items `todo`;
  they show honestly and never fail the run. When a todo's witness starts holding,
  it flips to `READY` — the board tells you it's actually done and you can promote
  the claim.
- **A tiny, dependency-free status surface anywhere.** One stdlib script, a plain
  text board, `--json` for a pipeline. No server, no database, no framework.

## What it is **not** good for — read this before you trust the green

- **Proving the witness is the *right* witness.** Plumb checks that the evidence
  **exists / agrees**, never that it is **correct**. A claim can point `exists` at
  the wrong file, or `cmd` at a command that exits 0 for a reason unrelated to
  what you meant — and Plumb will pass it. It catches *green on hope*; it does not
  catch *green on the wrong witness*. Choosing a witness that actually means what
  the claim says is your job, and the whole craft.
- **Untrusted board files.** A `cmd` witness runs your shell. Treat a `.plumb`
  file like a Makefile — don't run one you didn't write. (If you want a board with
  no execution, use only `exists` / `absent` / `contains` witnesses.)
- **Continuous monitoring.** Plumb is a **point-in-time** reading — it tells the
  truth at the moment you run it, not a second later. Wire it to run at the moments
  that matter (a pre-merge gate, a pre-deploy step); it is not a watchdog.
- **Rich conditions.** `contains` is a literal substring, not a regex; there is no
  numeric compare, no "at least N of these." That is deliberate — a witness you
  can't read at a glance is a witness you can't trust. Reach for a real test
  behind a `cmd` witness when you need more.

The tool prints its honest ceiling as part of every run. Shipping the limits
*with* the tool is the point.

## The knobs

- `--cwd DIR` — base directory for relative witness paths and commands. Defaults
  to the board file's own directory (`.` when reading from stdin).
- `--json` — machine-readable output on stdout (the ceiling still prints on
  stderr, so a `--json` pipe stays clean).
- `--quiet` — print only the one-line summary.

## Provenance

Extracted and generalized from the integrity check that keeps a private
methodology's session-close badge honest — a nine-cell status glyph whose rule is
that no cell may render solid unless the committed evidence beneath it actually
agrees ("no green on hope"). The badge's specific cell geometry stayed home; this
is the general kernel — *a claim is only as green as its witness* — given away.

## License

MIT. See `LICENSE`.
