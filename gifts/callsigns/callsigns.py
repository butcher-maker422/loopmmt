#!/usr/bin/env python3
"""callsigns — memorable IDs that are safe by construction.

A random unique identifier you can read aloud, remember for the length of a
standup, and paste anywhere without escaping. Every token has the shape

    word-word-hash          e.g.  sunny-champion-8h3kq7

Two human-readable words drawn from a curated pool, then a six-character
disambiguating hash. The point is that all three parts are *ref-, path-, URL-,
and shell-safe by construction* — not "usually fine," but safe as a proven
property of the alphabet each part draws from, so a callsign drops straight into
a git branch name, a directory name, a URL segment, or a shell argument with no
quoting and no surprises.

WHY IT'S HONEST

- **Safe by construction, not by hope.** The words pass a lowercase-ASCII
  allowlist; the hash draws from a confusable-free, case-safe base32 alphabet
  (digits + a-z minus i/l/o/u). Every character clears git refs, Windows and
  macOS filenames, RFC-3986 URL segments, and the shell. There is no escaping
  step to forget because there is nothing to escape.

- **No case-fold collisions.** Everything is lowercase, so two callsigns can
  never collide only because a filesystem folded their case.

- **The namespace is a stated number, not a vibe.** 64 x 64 word-pairs = 4096
  memorable prefixes; the six-char hash adds 32^6 (~1.07e9) per prefix, for
  ~4.4e12 total. You can reason about collision odds because the size is exact.

- **No degenerate pairs.** A token is never `word-word` with the two words
  equal; the draw rejects and redraws, so every callsign reads as two distinct
  words.

- **Seed it and it's deterministic.** Pass a seed and the same seed yields the
  same callsign on any machine, forever — so a demo, a test, or a reproducible
  fixture is byte-identical. Leave the seed off and it draws from the system CSPRNG.

THE HONEST EDGE

A callsign is a *memorable, safe* identifier, not a *guaranteed-unique* one.
The hash makes an accidental collision astronomically unlikely, but "unlikely"
is not "impossible": if your system's correctness depends on uniqueness, pair a
callsign with a real uniqueness source (a timestamp prefix, a sequence, a
registry that rejects duplicates) — exactly as the Loop MMT session floor does,
joining a callsign to a UTC timestamp. Callsigns buy you memorability and
paste-safety; they do not replace a uniqueness authority.

USAGE
    python3 callsigns.py                 # one callsign
    python3 callsigns.py --n 5           # five callsigns, one per line
    python3 callsigns.py --seed 42       # deterministic: same seed, same token
    python3 callsigns.py --demo          # a short, reproducible demonstration

MIT licensed. Python standard library only. Deterministic under --seed; headless.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WORDLIST = os.path.join(HERE, "wordlist.json")

# A drawn word must be ref-/path-/URL-/shell-safe by construction.
SAFE = frozenset("abcdefghijklmnopqrstuvwxyz")

# Hash field: confusable-free, case-safe base32 — digits + a-z minus i,l,o,u.
# Lowercase-only (no case-fold collision); every char clears git refs,
# Windows/macOS filenames, RFC-3986 unreserved URL chars, and the shell.
# Length is the lever, not the alphabet: 32^6 ~= 1.07e9 per word-pair.
HASH_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"  # 32 chars: a-z drop i,l,o,u
HASH_LEN = 6

_MAX_REDRAW = 64  # attempts to avoid a degenerate equal-word pair before forcing


def _is_safe(word: str) -> bool:
    """True iff word is non-empty and every char is in the safe allowlist."""
    return bool(word) and all(c in SAFE for c in word)


def draw_hash(rng: random.Random, length: int = HASH_LEN) -> str:
    """Draw a `length`-char hash from the case-safe base32 alphabet."""
    if length < 0:
        raise ValueError("hash length must be non-negative")
    return "".join(rng.choice(HASH_ALPHABET) for _ in range(length))


def load_pools(path: str = WORDLIST) -> tuple[list[str], list[str]]:
    """Load and safety-filter the two word pools from the wordlist JSON.

    Raises ValueError if either pool is empty after the safety filter — a
    wordlist that can't produce a safe word is a loud failure, never a silent
    empty draw.
    """
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    pool_one = [w for w in data["pool_one"] if _is_safe(w)]
    pool_two = [w for w in data["pool_two"] if _is_safe(w)]
    if not pool_one or not pool_two:
        raise ValueError("wordlist pools are empty after the safety filter")
    return pool_one, pool_two


def draw(
    rng: random.Random | None = None,
    path: str = WORDLIST,
    pools: tuple[list[str], list[str]] | None = None,
) -> str:
    """Draw one callsign: `word-word-hash`, the two words always distinct.

    `rng`   — a random.Random (seed it for determinism); defaults to the CSPRNG.
    `pools` — optional pre-loaded (pool_one, pool_two); loaded from `path` if omitted.
    """
    rng = rng or random.SystemRandom()
    pool_one, pool_two = pools if pools is not None else load_pools(path)
    # Reject the degenerate identical-word pair and redraw.
    for _ in range(_MAX_REDRAW):
        a, b = rng.choice(pool_one), rng.choice(pool_two)
        if a != b:
            return f"{a}-{b}-{draw_hash(rng)}"
    # Vanishingly unlikely fallthrough: force a distinct pair.
    a = rng.choice(pool_one)
    alt = [w for w in pool_two if w != a]
    if not alt:
        raise ValueError("cannot form a distinct word pair from these pools")
    b = rng.choice(alt)
    return f"{a}-{b}-{draw_hash(rng)}"


def draw_many(
    count: int,
    rng: random.Random | None = None,
    path: str = WORDLIST,
) -> list[str]:
    """Draw `count` callsigns, reusing one loaded pool and one RNG."""
    if count < 0:
        raise ValueError("count must be non-negative")
    rng = rng or random.SystemRandom()
    pools = load_pools(path)
    return [draw(rng=rng, pools=pools) for _ in range(count)]


def demo(rng: random.Random | None = None) -> str:
    """A short, reproducible demonstration rendered as text.

    Deterministic when `rng` is seeded — the same seed prints the same block.
    """
    rng = rng or random.Random(42)
    pools = load_pools()
    lines = [
        "callsigns — memorable IDs safe by construction",
        "",
        "Five draws (seed=42):",
    ]
    for _ in range(5):
        lines.append("  " + draw(rng=rng, pools=pools))
    lines += [
        "",
        "Same seed, same tokens — reproducible anywhere.",
        f"Namespace: {len(pools[0])} x {len(pools[1])} pairs x {len(HASH_ALPHABET)}^{HASH_LEN}"
        f" ~= {len(pools[0]) * len(pools[1]) * len(HASH_ALPHABET) ** HASH_LEN:.2e} total.",
    ]
    return "\n".join(lines)


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="callsigns",
        description="Draw memorable, safe-by-construction identifiers (word-word-hash).",
    )
    p.add_argument("--n", type=int, default=1, help="how many callsigns to draw (default 1)")
    p.add_argument("--seed", type=int, default=None, help="seed for deterministic output")
    p.add_argument("--demo", action="store_true", help="print a short reproducible demonstration")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_arg_parser().parse_args(argv)
    try:
        if args.demo:
            rng = random.Random(args.seed) if args.seed is not None else random.Random(42)
            sys.stdout.write(demo(rng=rng) + "\n")
            return 0
        if args.n < 0:
            sys.stderr.write("callsigns: FATAL: --n must be non-negative\n")
            return 1
        rng = random.Random(args.seed) if args.seed is not None else random.SystemRandom()
        pools = load_pools()
        for _ in range(args.n):
            sys.stdout.write(draw(rng=rng, pools=pools) + "\n")
        return 0
    except Exception as exc:  # loud, never silent
        sys.stderr.write(f"callsigns: FATAL: {exc}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
