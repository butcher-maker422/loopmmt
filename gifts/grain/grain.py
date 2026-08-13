#!/usr/bin/env python3
"""
grain.py — a self-calibrating structure & drift smell test for any corpus.

Does this text/relation have *grain* — real structure — or is it slurry?

WHAT IT DOES
  It compresses your data with zlib (a Kolmogorov UPPER bound: DEFLATE finds
  repeated substructure) and compares the compression ratio against a
  size-matched, deterministically-seeded RANDOM NULL MODEL built from your own
  data's own symbols. If your data compresses clearly *more* than random
  arrangements of the same symbols, it carries structure a random baseline does
  not — a rule, a template, a hub, a repetition. The threshold is drawn LIVE
  from the null model, so there is no magic number to hand-tune as your data
  grows. That self-calibration is the whole trick.

WHAT IT IS GOOD FOR (graded honestly)
  * Corpus staleness / homogenization drift  — its BEST fit. Snapshot the grain
    signature over time; a drift is a near-free staleness/homogenization alarm.
    No labels, no model, no training. (see: --drift)
  * "AI slop" smell                          — YES, as a SMELL, not a classifier.
    Machine-generated text trends more templated/redundant; rising structure
    against the null is a cheap smoke alarm. A smoke alarm, not an investigator.
  * Detecting a generating rule leaking into a published relation (hub / label
    reuse) — the original use this was extracted from. (see: --relation)

WHAT IT IS *NOT* GOOD FOR
  * Data rot (dead links, broken references, bit-decay). Wrong tool — that is a
    reference-integrity problem; this measures structure, not reachability.
  * A proof of anything. It is a lower-bound SMELL. zlib is an upper bound on
    complexity, so a low ratio proves compressibility, not a specific cause; and
    it is WEAK on chain-shaped rules (a chain reuses each symbol ~twice, like a
    sparse random graph), so a clean reading is not a certificate of "no rule."

Stdlib only. Deterministic (seeded). No dependencies. MIT licensed.

Origin: extracted and generalized from the "non-compressibility gate" in the
Loop MMT corpus-map builder. The specific application (generator-leak detection
in a published edge graph) stayed home; this is the general kernel, given away.
"""
from __future__ import annotations

import argparse
import json
import random
import statistics
import sys
import zlib

# --- the one documented knob ------------------------------------------------
Z_CUT = 2.0           # flag STRUCTURED when the real ratio is > Z sd below the
#                       null MEAN — more compressible than random arrangements of
#                       its own symbols, beyond normal variation. Self-calibrating
#                       (mean+sd drawn live); no absolute number to drift.
NULL_TRIALS = 64      # deterministic sample size of the random baseline
NULL_SEED = 0xC0DE    # fixed seed => folds-twice-identical (reproducible)
MIN_SD = 1e-6         # sd-floor: below this the baseline is degenerate and the
#                       z-cut is meaningless, so fall back to a coarse fraction.
DEGENERATE_FRACTION = 0.5  # backstop only when the null baseline has ~no spread


def _zlib_ratio(raw: bytes) -> float:
    """rho = compressed_len / raw_len at max level. LOW rho => compressible => structure."""
    if not raw:
        return 1.0
    return len(zlib.compress(raw, 9)) / len(raw)


def _serialize(tokens) -> bytes:
    """
    Canonical bytes for a token sequence: newline-joined, real symbols kept.
    We keep the REAL tokens (never remap to a dense integer alphabet): structure
    manifests as repeated real tokens, and that reuse is exactly the compressible
    signal to catch. The null is serialized identically, so any per-token length
    effect cancels between actual and null.
    """
    return "\n".join(tokens).encode("utf-8")


def _null_stats(n_tokens, null_draw):
    """
    zlib-ratio DISTRIBUTION of `NULL_TRIALS` size-matched RANDOM draws from the
    data's own alphabet — NOT a permutation of the same multiset. Drawing fresh
    from the alphabet is what lets a real rule stand out: the actual reuses a hub
    label (`x -> glossary` many times) far more than a uniform draw over the
    alphabet does, so the actual compresses more and its z_score drops. (A
    same-multiset permutation would hold that reuse INSIDE the null and detect
    nothing — the exact bug this replaced.) Deterministic (seeded). Returns
    (mean, population_sd) over the draws.

    `null_draw(rng, n)` returns one random size-n token list from the alphabet.
    """
    if n_tokens < 2:
        return 1.0, 0.0
    rng = random.Random(NULL_SEED)
    ratios = [_zlib_ratio(_serialize(null_draw(rng, n_tokens)))
              for _ in range(NULL_TRIALS)]
    return statistics.mean(ratios), statistics.pstdev(ratios)


def _alphabet_draw(alphabet):
    """Default null: draw n symbols uniformly (with replacement) from `alphabet`."""
    pool = list(alphabet)
    return lambda rng, n: [rng.choice(pool) for _ in range(n)]


def signature(tokens, null_draw=None):
    """
    The grain signature of a token sequence, self-calibrated against a size-matched
    uniform draw from its own alphabet. `z_score` is sigma below (negative) / above
    the null mean: strongly negative => structured (compresses more than a random
    draw of its size does). Pass `null_draw` to supply a domain-specific null (see
    the relation path); default is a uniform draw over the distinct tokens.
    """
    tokens = list(tokens)
    if null_draw is None:
        null_draw = _alphabet_draw(set(tokens) or {""})
    rho_actual = _zlib_ratio(_serialize(tokens))
    mean_null, sd_null = _null_stats(len(tokens), null_draw)
    rel = (rho_actual / mean_null) if mean_null else 1.0
    z = ((rho_actual - mean_null) / sd_null) if sd_null > MIN_SD else 0.0
    degenerate = sd_null <= MIN_SD
    if not tokens:
        structured = False
    elif degenerate:
        structured = rho_actual < DEGENERATE_FRACTION * mean_null
    else:
        structured = z < -Z_CUT
    return {
        "tokens": len(tokens),
        "rho_actual": round(rho_actual, 4),
        "mean_null": round(mean_null, 4),
        "sd_null": round(sd_null, 4),
        "rel_to_null": round(rel, 4),
        "z_score": round(z, 3),
        "z_cut": Z_CUT,
        "null_trials": NULL_TRIALS,
        "degenerate_baseline": degenerate,
        "verdict": "STRUCTURED" if structured else "IDIOSYNCRATIC",
    }


# --- input modes ------------------------------------------------------------

def tokens_from_text(text, mode="lines"):
    if mode == "lines":
        return [ln for ln in text.splitlines() if ln.strip()]
    if mode == "words":
        return text.split()
    raise ValueError(f"unknown text mode: {mode}")


def tokens_from_relation(text):
    """Each non-empty line is an edge `a->b` or `a<TAB>b`; kept as a real token."""
    out = []
    for ln in text.splitlines():
        ln = ln.strip()
        if not ln:
            continue
        if "->" in ln:
            a, b = ln.split("->", 1)
        elif "\t" in ln:
            a, b = ln.split("\t", 1)
        else:
            a, b = ln, ""
        out.append(f"{a.strip()}->{b.strip()}")
    return sorted(out)  # canonical order, like the original relation serializer


def relation_null_draw(edge_tokens):
    """
    Faithful relation null (from the original gate): the alphabet is the NODE set,
    and each null draw is `n` random DISTINCT directed pairs from it. A rule-leak
    (a hub reusing one target node across many edges) sits far below this uniform-
    pair baseline; a genuinely idiosyncratic dependency graph sits inside it.
    """
    nodes = set()
    for tok in edge_tokens:
        if "->" in tok:
            a, b = tok.split("->", 1)
            nodes.add(a.strip())
            nodes.add(b.strip())
    nodes = sorted(nodes)
    all_pairs = [(a, b) for a in nodes for b in nodes if a != b]

    def draw(rng, n):
        k = min(n, len(all_pairs))
        return [f"{a}->{b}" for a, b in sorted(rng.sample(all_pairs, k))] if k > 0 else []

    return draw


def _read(path):
    if path == "-":
        return sys.stdin.read()
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        return fh.read()


HONEST_CEILING = (
    "note: a lower-bound SMELL, never a proof. zlib is an upper bound on "
    "complexity, so a low ratio proves compressibility, not a specific cause; "
    "it is weak on chain-shaped rules; and it says nothing about data rot "
    "(broken references) — that is a different tool."
)


def main(argv=None):
    p = argparse.ArgumentParser(
        description="Self-calibrating structure & drift smell test for any corpus.",
        epilog=HONEST_CEILING,
    )
    p.add_argument("path", help="file to read, or '-' for stdin")
    p.add_argument("--relation", action="store_true",
                   help="treat each line as an edge (a->b) instead of prose")
    p.add_argument("--words", action="store_true",
                   help="tokenize prose by words instead of lines")
    p.add_argument("--drift", metavar="BASELINE.json",
                   help="compare this input's signature against a saved baseline "
                        "and report the change (the staleness alarm)")
    p.add_argument("--save", metavar="OUT.json",
                   help="write this input's signature to OUT.json as a baseline")
    p.add_argument("--json", action="store_true", help="machine-readable output")
    args = p.parse_args(argv)

    text = _read(args.path)
    if args.relation:
        toks = tokens_from_relation(text)
        sig = signature(toks, null_draw=relation_null_draw(toks))
    else:
        toks = tokens_from_text(text, "words" if args.words else "lines")
        sig = signature(toks)

    if args.save:
        with open(args.save, "w", encoding="utf-8") as fh:
            json.dump(sig, fh, indent=2, sort_keys=True)

    if args.drift:
        with open(args.drift, "r", encoding="utf-8") as fh:
            base = json.load(fh)
        delta_z = round(sig["z_score"] - base.get("z_score", 0.0), 3)
        delta_rel = round(sig["rel_to_null"] - base.get("rel_to_null", 1.0), 4)
        drift = {
            "baseline_z": base.get("z_score"),
            "current_z": sig["z_score"],
            "delta_z": delta_z,
            "delta_rel_to_null": delta_rel,
            # more structure than before => drift toward homogenization/staleness
            "reading": ("MORE STRUCTURED than baseline (homogenizing/staling)"
                        if delta_z < -0.5 else
                        "LESS STRUCTURED than baseline (diversifying)"
                        if delta_z > 0.5 else
                        "stable (within noise)"),
        }
        if args.json:
            print(json.dumps({"signature": sig, "drift": drift}, indent=2, sort_keys=True))
        else:
            print(f"grain drift: {drift['reading']}  (delta_z={delta_z})")
            print(HONEST_CEILING)
        return 0

    if args.json:
        print(json.dumps(sig, indent=2, sort_keys=True))
    else:
        print(f"grain: {sig['verdict']}  "
              f"(z={sig['z_score']} vs cut -{sig['z_cut']}; "
              f"{sig['tokens']} tokens; rho={sig['rho_actual']} vs null {sig['mean_null']})")
        print(HONEST_CEILING)
    return 0


if __name__ == "__main__":
    sys.exit(main())
