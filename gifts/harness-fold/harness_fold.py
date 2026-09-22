#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""harness-fold -- compute a pipeline's wiring topology as data, as a standalone gift.

Give it an ordered list of pipe stages (and, optionally, one parallel fork), and
it emits the wiring topology: the sequential (∘) edge-list connecting consecutive
stages, plus the one parallel (⊗) fork/join describing which sources run
independently and where they rejoin the chain. It's the "how does this pipeline
actually wire together" step, computed rather than drawn.

    printf '{"pipe_stages": [...], "fork": {...}|null}' | python3 harness_fold.py

USAGE
    printf '<json>' | python3 harness_fold.py     (stdin -> stdout)
    python3 harness_fold.py --help
    python3 harness_fold.py --selftest

INPUT CONTRACT
    One JSON object on stdin whose keys are the fold's keyword arguments:
      pipe_stages  [{"primitive": <id>}, ...]  ordered, in data-flow order
      fork         {"members": [{"primitive": <id>}, ...], "reason": <s?>,
                     "feeds": <id?>}  -- or null for a pipeline with no fork

OUTPUT
    A JSON array [harness_edges, fork_join]:
      harness_edges  the ∘ chain: {"from","to","op":"∘"} for each consecutive pair
      fork_join      the one ⊗ fork, or null when there's no fork (or no chain to
                     feed). A fork feeds its declared "feeds" target, falling back
                     to the pipe head only when none is declared.

EDGE (printed, honest)
    It computes the topology it is HANDED -- it does not check that the stage
    order is correct or that a declared "feeds" target exists in the chain. Give
    it a wrong order and it faithfully wires the wrong pipeline. It renders the
    graph, it does not validate the plan.

PROVENANCE
    The fold body is extracted verbatim from a recipe-compiler's harness-plan
    block. This gift wraps that pure fold in a stdin->stdout CLI; the wrapper adds
    only I/O, so the gift's determinism is exactly the fold's.

Zero dependencies (Python 3 stdlib only), offline, deterministic.
"""

import argparse
import json
import sys


def harness_fold(pipe_stages, fork):
    """ordered pipe_stages (+ optional ⊗ fork) -> (harness_edges[], fork_join)."""
    harness_edges = []
    for i in range(len(pipe_stages) - 1):
        harness_edges.append({
            "from": pipe_stages[i]["primitive"],
            "to": pipe_stages[i + 1]["primitive"],
            "op": "\u2218",
        })
    fork_join = None
    if fork and pipe_stages:
        # feeds: the spine's DECLARED join target (threaded in via fork["feeds"]),
        # falling back to the pipe head only when a fork declares none. The head
        # is right for a head-feeding fork (photoshop's pixel stream) and WRONG
        # for a fork that rejoins deeper (the compiler's fork -> harness-plan).
        feeds = fork.get("feeds") or pipe_stages[0]["primitive"]
        note = (
            "parallel-independent reads: none of the \u2297 sources consumes another's "
            f"output, so they run independently and rejoin the \u2218 chain at {feeds}. "
            "Order-independent (a trivial braid)."
        )
        fork_join = {
            "op": "\u2297",
            "sources": [st["primitive"] for st in fork["members"]],
            "feeds": feeds,
            # the spine's own ⊗-justification, carried verbatim (honest, per-spine).
            "reason": fork.get("reason", ""),
            "note": note,
        }
    return harness_edges, fork_join


def _die(msg, code=2):
    sys.stderr.write("harness-fold: " + msg + "\n")
    sys.exit(code)


def _read_stdin_object():
    """Read one JSON object from stdin -> a dict of kwargs. Crash-clean on bad
    or empty input: a nonzero exit and a one-line message, never a traceback."""
    data = sys.stdin.read()
    if not data.strip():
        _die("no input on stdin -- pipe a JSON object with keys pipe_stages, fork", 2)
    try:
        obj = json.loads(data)
    except json.JSONDecodeError as e:
        _die("stdin is not valid JSON: %s" % e, 2)
    if not isinstance(obj, dict):
        _die("stdin JSON must be an object mapping kwargs "
             "(pipe_stages, fork), got a %s" % type(obj).__name__, 2)
    return obj


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--selftest" in argv:
        return 0 if _selftest() else 1

    p = argparse.ArgumentParser(
        prog="harness_fold.py", add_help=True,
        description="Compute a pipeline's wiring topology (\u2218 edge-list + one \u2297 "
                    "fork/join). Reads a JSON object {\"pipe_stages\":[...], \"fork\":{...}|null} "
                    "from stdin.",
        epilog="example:  printf '{\"pipe_stages\": [{\"primitive\": \"s0\"}, "
               "{\"primitive\": \"s1\"}], \"fork\": null}' | python3 harness_fold.py")
    p.parse_args(argv)

    obj = _read_stdin_object()
    try:
        result = harness_fold(**obj)
    except TypeError as e:
        _die("stdin object keys must be exactly the fold's args "
             "(pipe_stages, fork): %s" % e, 2)
    except (KeyError, AttributeError) as e:
        _die("malformed input structure: %s" % e, 2)
    sys.stdout.write(json.dumps(result, indent=2, sort_keys=True, ensure_ascii=False) + "\n")
    return 0


def _selftest():
    """Prove: ∘ edge-list is n-1 consecutive edges; fork_join feeds the chain
    head; fork_join=None with no fork or no chain; folds-twice-identical."""
    stages = [{"primitive": "s0"}, {"primitive": "s1"}, {"primitive": "s2"}]
    fork = {"op": "\u2297", "members": [{"primitive": "f0"}, {"primitive": "f1"}], "reason": "r"}

    edges, fj = harness_fold(stages, fork)
    assert [(e["from"], e["to"]) for e in edges] == [("s0", "s1"), ("s1", "s2")], edges
    assert all(e["op"] == "\u2218" for e in edges)
    # no declared feeds -> fall back to the pipe head (s0)
    assert fj["sources"] == ["f0", "f1"] and fj["feeds"] == "s0", fj
    assert "s0" in fj["note"], fj                        # the note names the real join target
    # folds-twice-identical
    assert harness_fold(stages, fork) == (edges, fj)

    # DECLARED join target: fork["feeds"] overrides the pipe-head fallback.
    fork_declared = {"op": "\u2297", "members": [{"primitive": "f0"}], "reason": "r2", "feeds": "s2"}
    _, fjd = harness_fold(stages, fork_declared)
    assert fjd["feeds"] == "s2", fjd                     # declared target wins, NOT head s0
    assert fjd["reason"] == "r2", fjd                    # spine's ⊗-reason carried verbatim

    # no fork -> fork_join None, edges still computed
    e2, fj2 = harness_fold(stages, None)
    assert fj2 is None and len(e2) == 2, (e2, fj2)
    # fork but empty chain -> fork_join None (nothing to feed), no edges
    e3, fj3 = harness_fold([], fork)
    assert e3 == [] and fj3 is None, (e3, fj3)
    # single stage -> 0 edges
    e4, _ = harness_fold([{"primitive": "only"}], None)
    assert e4 == [], e4
    print("harness-fold selftest: \u2218 edge-list (n-1); \u2297 fork/join feeds declared "
          "target (falls back to head), reason carried; degenerate None cases; "
          "folds-twice-identical.")
    return True


if __name__ == "__main__":
    sys.exit(main())
