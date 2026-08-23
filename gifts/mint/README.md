# Mint

**Hand out IDs that are never reused — and prove it before returning.** ~230
lines, Python standard library only, no dependencies, deterministic, MIT
licensed.

> Every ID a mint issues is strictly greater than every ID it has ever issued.
> A number that was retired can never be pointed at a second thing.

## The idea in one paragraph

A mint stamps a coin once and never stamps that number again. Mint does the same
for identifiers. It keeps a single **high-water mark** and only ever hands out
`high_water + 1`, persisting the bumped mark **before** it returns — so a crash
right after issuing cannot re-issue the same number. That makes "never reused" a
structural property, not an after-the-fact check: a retired ID cannot be
reassigned to a new thing, because the mint never counts backward. Retirement is
recorded so you can audit what was let go, but a retired ID does **not** return
to the pool without an explicit `--allow-recycle` — silent recycling is exactly
the failure this refuses. Reach for it anywhere an ID collision would let one
record be mistaken for another: a retired user's ID handed to a new user, a
recycled trace ID threading two unrelated events.

## Install

Copy `mint.py`. That's it. Python 3.8+.

## Use

```bash
python3 mint.py alloc --root ./ids          # mint one id -> {"id": 100000, "op": "alloc"}
python3 mint.py alloc -n 5 --root ./ids      # mint five, one JSON-line each, in order
python3 mint.py peek --root ./ids            # show state (high_water, next, retired) — issues nothing
python3 mint.py retire --id 100000 --root ./ids   # record 100000 retired (not recycled)
```

State lives in `<root>/mint-state.json` — two bits (`high_water`, `retired[]`)
and one rule: the free pool is `[high_water+1 ..]`, and a retired ID re-enters it
only with `--allow-recycle`.

### The gate (checked before any id is returned)

| Refusal | When |
|---|---|
| `E_RANGE` | the id is outside `--floor`..`--ceil` |
| `E_NOT_MONOTONIC` | the id is at/below the high-water mark (already issued) |
| `E_LIVE` | the id is in the `--live` set (held right now) |

A gate failure is a refusal with a reason and a non-zero exit — never a silent
second-best.

### Composing in a pipe (JSON-lines)

Every command emits one JSON object per line on stdout, so Mint drops into a
pipeline as a **source** — the thing that *begins* one:

```bash
# feed freshly minted ids into the next tool
python3 mint.py alloc -n 100 --root ./ids | your-next-tool

# tell the mint what's already in use, from an upstream reader
your-inventory --json | python3 mint.py alloc --root ./ids --live -
```

`--live -` reads currently-held ids from stdin: one JSON object per line (the id
in field `--live-field`, default `id`) or a bare integer per line. If the next id
the mint would draw is declared live, it refuses rather than collide.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | the operation succeeded |
| 1 | a gate refusal (out of range / not monotonic / id live) |
| 2 | state could not be read or written (don't trust the reading) |
| 3 | usage / bad input |

## Test

```bash
python3 test_mint.py
```

Fifteen checks, including a mutation check that proves the suite bites: a mint
that never advanced the mark (always issued the floor) would fail.

## License

MIT — see `LICENSE`. Copyright (c) 2026 Shea Gunther.
