#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""the-oracle.py -- a reproducible seeded-decision engine for prompt A/B (and A/B/C/...).

You are testing prompt variants and you want the assignment to be a FACT you can
reproduce, not a hidden coin-flip that quietly contaminates the experiment. the-oracle
turns a decision into an audit record: you name your variants, you commit a seed at a
moment, and it deterministically picks one -- writing a replayable receipt so the exact
same pick can be re-derived on any machine, forever.

The pick is reversal-indexed, the shape borrowed from `dwell` (the pure router gift):
the seed and the moment define a phase, and the variant is a pure function of that phase.

    phase(seed, moment, n)              = (moment - seed) mod n      # in [0, n)
    pick_index(seed, moment, n, k)      = (phase * k) // n           # in [0, k), one of k variants

There is no separate randomness step. Given (seed, moment, n, k) the chosen variant is
determined -- integer-exact, no float, byte-replayable. A `Ballot` records a decision as
the variant list plus the two integers that produced it, and `replay(ballot)` recomputes
the pick from them, so a decision is an audit record you re-derive, never an opinion you
have to trust. Every decision also carries a run/trace id and lands in a JSONL ledger, so
a batch of A/B assignments is a replayable receipt file.

HONEST CEILING. the-oracle makes an assignment REPRODUCIBLE and AUDITABLE; it does not
make it fair, uniform, or unbiased -- a chosen (seed, moment, n) can skew which variant
wins, and reproducing a skewed pick reproduces the skew. It does not run your prompts,
call any model, score a variant, or tell you which variant is better. It decides WHICH
variant, reproducibly; it does not decide whether the experiment was sound. Reproducible,
not random.

    python3 the-oracle.py pick  --seed 7 --moment 19 --variants A,B,C          # -> the chosen variant
    python3 the-oracle.py cast  --seed 7 --moment 19 --variants A,B --trace RUN # -> pick + ledger receipt
    python3 the-oracle.py replay --ballot ballot.json                           # -> re-derive a recorded pick
    python3 the-oracle.py --selftest                                            # deterministic core, byte-identical
    python3 the-oracle.py --help

Python 3 stdlib only, no dependencies, offline, deterministic core.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from typing import List, NamedTuple

__all__ = ["phase", "winding", "pick_index", "Ballot", "cast", "replay", "OracleError"]

_LEDGER_DEFAULT = "the-oracle-ledger.jsonl"


class OracleError(ValueError):
    """A malformed oracle call -- bad resolution, empty variant list, or moment before seed."""


def _validate(seed: int, moment: int, n: int, k: int) -> None:
    for name, val in (("seed", seed), ("moment", moment), ("n", n), ("k", k)):
        if not isinstance(val, int) or isinstance(val, bool):
            raise OracleError(f"{name} must be a plain int, got {val!r}")
    if n < 1:
        raise OracleError(f"n (loop resolution) must be >= 1, got {n}")
    if k < 1:
        raise OracleError(f"k (variant count) must be >= 1, got {k}")
    if k > n:
        # You cannot quantize a loop of n ticks into more than n distinguishable picks.
        raise OracleError(f"k must be <= n (k<=n is a wall), got k={k} n={n}")
    if moment < seed:
        # Seed is committed first; the moment of decision follows it on a monotone clock.
        raise OracleError(f"moment ({moment}) must be >= seed ({seed})")


def phase(seed: int, moment: int, n: int) -> int:
    """Where on the loop the decision sits, in [0, n). Winding (full laps) is folded out."""
    _validate(seed, moment, n, k=1)
    return (moment - seed) % n


def winding(seed: int, moment: int, n: int) -> int:
    """
    How many full laps passed between seed and moment -- the coordinate the pick discards.
    Read-only: the pick never depends on it, so waiting a full lap changes nothing (free-hold).
    """
    _validate(seed, moment, n, k=1)
    return (moment - seed) // n


def pick_index(seed: int, moment: int, n: int, k: int) -> int:
    """
    The engine. Returns the chosen variant index in [0, k), a pure function of the phase.
    Integer-exact, total, byte-replayable. Adding a full lap (n) to the moment is a no-op.
    """
    _validate(seed, moment, n, k)
    return ((moment - seed) % n * k) // n


class Ballot(NamedTuple):
    """An audit record of one decision: the variant list plus the two integers that made it."""
    variants: List[str]
    seed: int
    moment: int
    n: int


def _resolution(n: int, k: int) -> int:
    """Default loop resolution. If the caller gave an explicit n we honor it (a coarser loop
    lets you dial finer moments before the pick moves). The default is n=k -- the finest
    useful resolution, where each unit of `moment` advances the pick by exactly one variant
    (pick = (moment-seed) mod k) and free-hold still holds (adding k to the moment is a no-op)."""
    return n if n is not None else k


def cast(variants: List[str], seed: int, moment: int, n: int = None) -> dict:
    """
    Decide which variant, reproducibly, and return a full receipt dict (a Ballot + the pick).
    `n` defaults to k*12 so the phase has room; the pick is exact regardless of n's value.
    """
    if not variants:
        raise OracleError("variants must be a non-empty list")
    if len(set(variants)) != len(variants):
        raise OracleError(f"variants must be distinct, got {variants!r}")
    k = len(variants)
    nn = _resolution(n, k)
    idx = pick_index(seed, moment, nn, k)
    return {
        "variants": list(variants),
        "seed": seed,
        "moment": moment,
        "n": nn,
        "k": k,
        "phase": phase(seed, moment, nn),
        "winding": winding(seed, moment, nn),
        "pick_index": idx,
        "pick": variants[idx],
    }


def replay(ballot: dict) -> str:
    """
    Recompute the variant a recorded ballot produced, from the ballot alone. Because the
    engine is pure, replay(ballot) == the pick that produced it -- an audit record you
    re-derive, never an opinion to trust.
    """
    variants = ballot["variants"]
    k = len(variants)
    idx = pick_index(int(ballot["seed"]), int(ballot["moment"]), int(ballot["n"]), k)
    return variants[idx]


def _append_ledger(path: str, record: dict) -> None:
    """Append one decision as a sorted-keys compact JSON line -- byte-stable across runs."""
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n")


# ---- CLI ---------------------------------------------------------------------------------------------
def _parse_variants(s: str) -> List[str]:
    parts = [p.strip() for p in s.split(",")]
    parts = [p for p in parts if p != ""]
    if not parts:
        raise OracleError("--variants must list at least one non-empty label, comma-separated")
    return parts


def _cmd_pick(args) -> int:
    r = cast(_parse_variants(args.variants), args.seed, args.moment, args.n)
    print(r["pick"])
    return 0


def _cmd_cast(args) -> int:
    r = cast(_parse_variants(args.variants), args.seed, args.moment, args.n)
    record = {"trace": args.trace, **r}
    if args.ledger:
        _append_ledger(args.ledger, record)
    # human line to stdout, receipt shape to the ledger
    sys.stderr.write(
        f"[the-oracle] trace={args.trace} phase={r['phase']} pick_index={r['pick_index']} "
        f"-> {r['pick']}  (ledger: {args.ledger or 'none'})\n"
    )
    print(json.dumps(record, sort_keys=True, separators=(",", ":"), ensure_ascii=True))
    return 0


def _cmd_replay(args) -> int:
    with open(args.ballot, encoding="utf-8") as fh:
        ballot = json.load(fh)
    print(replay(ballot))
    return 0


def _cmd_demo(args) -> int:
    variants = ["A", "B", "C"]
    print(f"variants={variants}, seed=7")
    print("moment | phase winding -> pick")
    for moment in range(7, 7 + 13):
        r = cast(variants, 7, moment, None)
        print(f"{moment:6d} | {r['phase']:5d} {r['winding']:7d} -> {r['pick']}")
    return 0


def _selftest() -> int:
    checks = []

    def ck(name, cond):
        checks.append((name, bool(cond)))

    # 1. pure + total: same inputs -> same pick, always
    ck("deterministic", pick_index(7, 19, 12, 3) == pick_index(7, 19, 12, 3))
    # 2. free-hold: adding a full lap (n) to moment never changes the pick
    ck("free-hold", pick_index(7, 19, 12, 3) == pick_index(7, 19 + 12, 12, 3))
    # 3. pick in range [0, k)
    ck("in-range", all(0 <= pick_index(3, m, 12, 4) < 4 for m in range(3, 40)))
    # 4. phase in [0, n)
    ck("phase-range", all(0 <= phase(0, m, 10) < 10 for m in range(0, 30)))
    # 5. replay reproduces cast
    r = cast(["A", "B", "C"], 7, 19, None)
    ck("replay-matches", replay(r) == r["pick"])
    # 6. k==1 always picks the sole variant
    ck("k1", cast(["only"], 5, 99, None)["pick"] == "only")
    # 7. integer-exact boundary: (phase*k)//n is floor at a segment edge
    ck("floor-boundary", pick_index(0, 4, 12, 3) == (4 * 3) // 12)
    # 8. distinct-variant guard
    try:
        cast(["A", "A"], 0, 0, None); ck("distinct-guard", False)
    except OracleError:
        ck("distinct-guard", True)
    # 9. moment<seed refused
    try:
        pick_index(10, 3, 12, 2); ck("moment-order-guard", False)
    except OracleError:
        ck("moment-order-guard", True)
    # 10. k>n refused
    try:
        pick_index(0, 0, 3, 4); ck("k-le-n-wall", False)
    except OracleError:
        ck("k-le-n-wall", True)
    # 11. bool rejected as int (True is not a plain int here)
    try:
        pick_index(True, 0, 12, 2); ck("no-bool", False)
    except OracleError:
        ck("no-bool", True)
    # 12. byte-identical receipt across two casts (deterministic serialization)
    a = json.dumps(cast(["A", "B"], 1, 5, None), sort_keys=True, separators=(",", ":"))
    b = json.dumps(cast(["A", "B"], 1, 5, None), sort_keys=True, separators=(",", ":"))
    ck("byte-identical-receipt", a == b)
    # 13. winding discarded from routing but readable
    ck("winding-readable", winding(0, 25, 12) == 2 and pick_index(0, 25, 12, 3) == pick_index(0, 1, 12, 3))
    # 14. empty variants refused
    try:
        cast([], 0, 0, None); ck("empty-guard", False)
    except OracleError:
        ck("empty-guard", True)

    passed = sum(1 for _, ok in checks if ok)
    failed = len(checks) - passed
    for name, ok in checks:
        if not ok:
            print(f"  FAIL: {name}")
    tag = "GREEN" if failed == 0 else "RED"
    print(f"{tag}: {passed} checks passed, {failed} failed  [the-oracle]")
    return 0 if failed == 0 else 1


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--selftest" in argv:
        return _selftest()
    p = argparse.ArgumentParser(
        prog="the-oracle.py",
        description="a reproducible seeded-decision engine for prompt A/B (reversal-indexed pick)",
    )
    sub = p.add_subparsers(dest="cmd")

    pp = sub.add_parser("pick", help="print the chosen variant")
    pp.add_argument("--seed", type=int, required=True)
    pp.add_argument("--moment", type=int, required=True)
    pp.add_argument("--variants", required=True, help="comma-separated labels, e.g. A,B,C")
    pp.add_argument("--n", type=int, default=None, help="loop resolution (default k*12)")
    pp.set_defaults(fn=_cmd_pick)

    pc = sub.add_parser("cast", help="pick + emit a replayable receipt (optionally to a ledger)")
    pc.add_argument("--seed", type=int, required=True)
    pc.add_argument("--moment", type=int, required=True)
    pc.add_argument("--variants", required=True)
    pc.add_argument("--n", type=int, default=None)
    pc.add_argument("--trace", default="RUN", help="a run/trace id stamped on the receipt")
    pc.add_argument("--ledger", default=None, help="append the receipt to this JSONL ledger")
    pc.set_defaults(fn=_cmd_cast)

    pr = sub.add_parser("replay", help="re-derive a recorded pick from a ballot json")
    pr.add_argument("--ballot", required=True, help="a receipt json (from cast)")
    pr.set_defaults(fn=_cmd_replay)

    pd = sub.add_parser("demo", help="a small decision table")
    pd.set_defaults(fn=_cmd_demo)

    args = p.parse_args(argv)
    if not getattr(args, "fn", None):
        p.print_help()
        return 0
    try:
        return args.fn(args)
    except OracleError as e:
        sys.stderr.write(f"the-oracle: {e}\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
