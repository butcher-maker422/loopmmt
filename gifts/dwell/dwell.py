#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""dwell.py -- reversal-indexed routing: the WHEN you commit IS the WHAT you choose.

A cart circles a loop of `n` ticks. Holding is free -- it can circle forever, and
an extra full lap changes nothing. It leaves only when you REVERSE, and which of
`k` exits it leaves on is a pure function of the PHASE at the instant of reversal:

    phase(entry, reverse, n)        = (reverse - entry) mod n     # where on the loop, in [0, n)
    exit_segment(entry, reverse, n, k) = (phase * k) // n         # which of k exits, in [0, k)

The choice is carried entirely by the timing. There is no separate "pick" step:
deferring is free, and the moment you stop deferring is itself the decision. That
is the whole idea -- a decision structure where latency is not lost time but the
signal.

Integer-exact by construction (no float), so the map is total, pure, and
byte-replayable -- the same (entry, reverse, n, k) always yields the same exit,
on any machine, forever. The WINDING number (how many full laps were circled) is
DISCARDED for routing; that discard IS the free-hold property:

    exit_segment(entry, reverse, n, k) == exit_segment(entry, reverse + n, n, k)

A `Mark` records a routing decision as two integers, and `replay(mark, n, k)`
recomputes the exit from them -- so a decision is an audit record you can re-derive,
never a stored opinion you have to trust.

HONEST CEILING. This is the fully-deterministic ROUTER: given (entry, reverse, n, k)
the exit is a fact. It does NOT decide *when* to stop deferring -- that single
judgment (the reversal itself) is yours. The router turns your timing into a choice;
it does not make the choice for you.

    python3 dwell.py route <entry> <reverse> <n> <k>   # -> the exit segment [0, k)
    python3 dwell.py phase <entry> <reverse> <n>       # -> phase [0, n) + winding
    python3 dwell.py demo                              # a small routing table
    python3 dwell.py --help

Python 3 stdlib only, no dependencies.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass
from typing import NamedTuple

__all__ = ["phase", "winding", "exit_segment", "Mark", "replay", "DwellError"]


class DwellError(ValueError):
    """A malformed Dwell call -- bad resolution, exit count, or tick order."""


def _validate(entry_tick: int, reverse_tick: int, n: int, k: int) -> None:
    for name, val in (("entry_tick", entry_tick), ("reverse_tick", reverse_tick),
                      ("n", n), ("k", k)):
        if not isinstance(val, int) or isinstance(val, bool):
            raise DwellError(f"{name} must be a plain int, got {val!r}")
    if n < 1:
        raise DwellError(f"n (loop resolution) must be >= 1, got {n}")
    if k < 1:
        raise DwellError(f"k (exit count) must be >= 1, got {k}")
    if k > n:
        # You cannot quantize a loop of n ticks into more than n distinguishable exits.
        raise DwellError(f"k must be <= n (k<=n is a wall), got k={k} n={n}")
    if reverse_tick < entry_tick:
        # Ticks are a monotone clock; the cart enters, then circles, then reverses.
        raise DwellError(
            f"reverse_tick ({reverse_tick}) must be >= entry_tick ({entry_tick})")


def phase(entry_tick: int, reverse_tick: int, n: int) -> int:
    """Where on the loop the cart sits at reversal, in [0, n). Winding is folded out."""
    _validate(entry_tick, reverse_tick, n, k=1)
    return (reverse_tick - entry_tick) % n


def winding(entry_tick: int, reverse_tick: int, n: int) -> int:
    """
    How many FULL laps were circled before reversal (the coordinate the router
    discards). Read-only: routing never depends on it, and that independence IS the
    free-hold property -- a decision deferred through extra laps is not penalized.
    """
    _validate(entry_tick, reverse_tick, n, k=1)
    return (reverse_tick - entry_tick) // n


def exit_segment(entry_tick: int, reverse_tick: int, n: int, k: int) -> int:
    """
    The router. Returns the exit segment in [0, k) the cart leaves on when reversed
    at `reverse_tick`, having entered at `entry_tick`, on a loop of resolution `n`
    with `k` exits.

    Pure, total, integer-exact. Tie-break at a segment boundary is floor, by
    construction (`(phase*k)//n`). Free-hold holds by the same construction: adding
    a full lap (n ticks) to reverse_tick leaves the exit unchanged.
    """
    _validate(entry_tick, reverse_tick, n, k)
    return ((reverse_tick - entry_tick) % n * k) // n


class Mark(NamedTuple):
    """An audit record of one routing decision -- two integers, nothing else."""
    entry_tick: int
    reverse_tick: int


@dataclass(frozen=True)
class DwellSpec:
    """The static shape of a loop: its resolution and its exit count."""
    n: int
    k: int


def replay(mark: Mark, n: int, k: int) -> int:
    """
    Recompute the exit a Mark produced, from the Mark plus the loop spec. Because the
    router is pure, replay(mark, n, k) == the exit_segment that produced it -- so the
    Mark is an audit record you re-derive, never an opinion you have to trust.
    """
    return exit_segment(mark.entry_tick, mark.reverse_tick, n, k)


# ---- CLI ---------------------------------------------------------------------------------------------
_USAGE = """dwell.py -- reversal-indexed routing: when you commit is what you choose.

  python3 dwell.py route <entry> <reverse> <n> <k>   the exit segment in [0, k)
  python3 dwell.py phase <entry> <reverse> <n>       phase in [0, n) + winding (laps)
  python3 dwell.py demo                              a small routing table
  python3 dwell.py --help

n = loop resolution (ticks per lap), k = number of exits (k <= n).
An extra full lap never changes the exit -- deferring is free.
"""


def _demo() -> None:
    n, k = 12, 4
    print(f"loop n={n} ticks, k={k} exits; entry at tick 0")
    print("reverse | phase winding -> exit")
    for reverse in range(0, 25):
        p = phase(0, reverse, n)
        w = winding(0, reverse, n)
        e = exit_segment(0, reverse, n, k)
        print(f"  {reverse:5d} | {p:5d} {w:6d} ->  {e}")
    print("(note tick 12 and tick 24 -- a full/second lap -- route identically to tick 0: free-hold)")


def main(argv) -> int:
    args = argv[1:]
    if not args or args[0] in ("--help", "-h", "help"):
        sys.stdout.write(_USAGE)
        return 0 if args else 1
    cmd = args[0]
    try:
        if cmd == "route":
            if len(args) != 5:
                raise DwellError("route needs: <entry> <reverse> <n> <k>")
            entry, reverse, n, k = (int(x) for x in args[1:5])
            sys.stdout.write(str(exit_segment(entry, reverse, n, k)) + "\n")
            return 0
        if cmd == "phase":
            if len(args) != 4:
                raise DwellError("phase needs: <entry> <reverse> <n>")
            entry, reverse, n = (int(x) for x in args[1:4])
            sys.stdout.write(f"phase={phase(entry, reverse, n)} winding={winding(entry, reverse, n)}\n")
            return 0
        if cmd == "demo":
            _demo()
            return 0
    except DwellError as e:
        sys.stderr.write(f"dwell: {e}\n")
        return 2
    except ValueError:
        sys.stderr.write("dwell: ticks, n, and k must be integers\n")
        return 2
    sys.stderr.write(f"dwell: unknown command {cmd!r}\n")
    sys.stderr.write(_USAGE)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
