#!/usr/bin/env python3
"""test_callsigns.py — the certifying properties of the callsigns gift.

Run:  python3 test_callsigns.py         (exit 0 = all pass, 1 = a failure)

The tests are chosen to be MUTATION-BITTEN: each one is here because a plausible
mutation of callsigns.py makes it fail loud. In particular the determinism test
pins a GOLDEN sha256 of a seeded batch rather than checking self-equality — a
weak self-equality test passes benign reorders (the Loop MMT sudoku lesson), a
pinned golden does not.
"""
import hashlib
import random
import sys

import callsigns as c

# --- pinned golden: a seeded batch must reproduce this exact signature -------
# Regenerate ONLY on an intentional change:
#   python3 -c "import hashlib,random,callsigns as c; \
#     rng=random.Random(1234); p=c.load_pools(); \
#     b=[c.draw(rng=rng,pools=p) for _ in range(50)]; \
#     print(hashlib.sha256('\n'.join(b).encode()).hexdigest())"
GOLDEN_SEED = 1234
GOLDEN_N = 50
GOLDEN_SHA256 = "815a0dc83fa371ebb1df70e9a82961aeeea11cd3ad05b80e9e73a90c2e10448f"

_FAILURES: list[str] = []
_PASSES = 0


def check(cond: bool, msg: str) -> None:
    global _PASSES
    if cond:
        _PASSES += 1
    else:
        _FAILURES.append(msg)


def _batch(seed: int, n: int) -> list[str]:
    rng = random.Random(seed)
    pools = c.load_pools()
    return [c.draw(rng=rng, pools=pools) for _ in range(n)]


# --- 1. determinism: seeded draw reproduces the pinned golden ----------------
def test_golden_signature():
    batch = _batch(GOLDEN_SEED, GOLDEN_N)
    sig = hashlib.sha256("\n".join(batch).encode()).hexdigest()
    check(
        sig == GOLDEN_SHA256,
        f"golden signature drifted: got {sig[:16]}... expected {GOLDEN_SHA256[:16]}...",
    )
    # kills a mutation that drops the redraw and lets equal-word pairs through:
    for tok in batch:
        a, b, _ = tok.split("-")
        check(a != b, f"golden batch contains a degenerate equal-word pair: {tok}")


# --- 2. same seed => same first token; different seed => (almost surely) not --
def test_seed_repeatability():
    r1 = random.Random(7)
    r2 = random.Random(7)
    p = c.load_pools()
    check(c.draw(rng=r1, pools=p) == c.draw(rng=r2, pools=p), "same seed produced different tokens")
    r3 = random.Random(8)
    # different seeds SHOULD differ (namespace ~4.4e12, collision astronomically rare)
    p2 = c.load_pools()
    check(
        c.draw(rng=random.Random(7), pools=p) != c.draw(rng=r3, pools=p2),
        "different seeds produced identical tokens (namespace or seeding is broken)",
    )


# --- 3. shape: exactly three dash-parts, word-word-hash ----------------------
def test_shape():
    for tok in _batch(99, 200):
        parts = tok.split("-")
        check(len(parts) == 3, f"token is not word-word-hash: {tok!r}")


# --- 4. every char of the words is in the safe allowlist ---------------------
def test_words_safe():
    for tok in _batch(101, 200):
        a, b, _ = tok.split("-")
        check(all(ch in c.SAFE for ch in a), f"word 1 has an unsafe char: {a!r}")
        check(all(ch in c.SAFE for ch in b), f"word 2 has an unsafe char: {b!r}")


# --- 5. the hash never contains a confusable (i/l/o/u) or an out-of-alphabet char
def test_hash_alphabet():
    banned = set("ilou")
    for tok in _batch(202, 300):
        h = tok.split("-")[2]
        check(len(h) == c.HASH_LEN, f"hash wrong length: {h!r}")
        check(all(ch in c.HASH_ALPHABET for ch in h), f"hash has out-of-alphabet char: {h!r}")
        check(not (set(h) & banned), f"hash contains a confusable char (i/l/o/u): {h!r}")
    # kills a mutation that swaps HASH_ALPHABET for a plain base32 including i/l/o/u
    check(not (set(c.HASH_ALPHABET) & banned), "HASH_ALPHABET must not contain i/l/o/u")


# --- 6. no degenerate equal-word pair, ever, across a large sample -----------
def test_no_equal_pairs():
    for tok in _batch(303, 500):
        a, b, _ = tok.split("-")
        check(a != b, f"degenerate equal-word pair produced: {tok}")


# --- 7. empty-pool wordlist is a loud failure, not a silent empty draw -------
def test_empty_pool_is_loud():
    import json
    import os
    import tempfile

    with tempfile.TemporaryDirectory() as d:
        bad = os.path.join(d, "wordlist.json")
        with open(bad, "w") as fh:
            json.dump({"pool_one": [], "pool_two": ["x"]}, fh)
        raised = False
        try:
            c.load_pools(bad)
        except ValueError:
            raised = True
        check(raised, "empty pool did not raise ValueError (silent-empty-draw regression)")


# --- 8. namespace math is the stated exact number ---------------------------
def test_namespace_is_exact():
    p1, p2 = c.load_pools()
    total = len(p1) * len(p2) * len(c.HASH_ALPHABET) ** c.HASH_LEN
    check(len(p1) == 64 and len(p2) == 64, f"pools not 64x64: {len(p1)}x{len(p2)}")
    check(len(c.HASH_ALPHABET) == 32, f"hash alphabet not 32 chars: {len(c.HASH_ALPHABET)}")
    check(total == 64 * 64 * 32 ** 6, f"namespace math changed: {total}")


# --- 9. draw_many honors count and reuses one pool --------------------------
def test_draw_many():
    got = c.draw_many(0, rng=random.Random(1))
    check(got == [], "draw_many(0) should be empty")
    got5 = c.draw_many(5, rng=random.Random(1))
    check(len(got5) == 5, f"draw_many(5) returned {len(got5)}")


# --- 10. demo is deterministic under a seed ---------------------------------
def test_demo_deterministic():
    d1 = c.demo(rng=random.Random(42))
    d2 = c.demo(rng=random.Random(42))
    check(d1 == d2, "demo(seed=42) is not reproducible")


def run() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
    total = _PASSES + len(_FAILURES)
    if _FAILURES:
        print(f"FAIL — {len(_FAILURES)} of {total} checks failed:")
        for f in _FAILURES:
            print(f"  ✗ {f}")
        return 1
    print(f"OK — {_PASSES}/{total} checks passed ({len(tests)} tests).")
    return 0


if __name__ == "__main__":
    sys.exit(run())
