#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""order-walk -- split a batch order into its ∘ pipe chain and ⊗ fork, as a standalone gift.

Give it a spec's batch order, a primitive map, a witness map, your served-gift
set, and a slug->port_verb map, and it walks the order for pipe-class nodes only,
splits the sequential (∘) pipe chain from the parallel (⊗) fork members (skipping
pure-kernels, which are handled as gaps elsewhere), and resolves each stage's
witness gift, port verb, and served flag. It's the structural walk that turns a
flat order into the two-part topology a harness planner then wires.

    printf '{"spine": {...}, "prim": {...}, "witness_map": {...}, "served": [...], "verb_of": {...}}' | python3 order_walk.py

USAGE
    printf '<json>' | python3 order_walk.py     (stdin -> stdout)
    python3 order_walk.py --help
    python3 order_walk.py --selftest

INPUT CONTRACT
    One JSON object on stdin whose keys are the fold's keyword arguments:
      spine        {"batch_core": {"order": [<id>, ...],
                      "parallel_join": {"members": [<id>, ...],
                                        "reason": <s?>, "feeds": <id?>}|null}}
      prim         {<id>: {"class": "pipe"|"pure-kernel"|...}, ...}
      witness_map  {<id>: <witness_slug_or_null>, ...}
      served       [<gift_slug>, ...]
      verb_of      {<gift_slug>: <port_verb>, ...}

OUTPUT
    A JSON array [pipe_stages, fork]:
      pipe_stages  the ∘ chain, in order, pipe-class only, each with witness_gift,
                   port_verb, served
      fork         the one ⊗ fork ({op, members, reason, feeds}), or null for an
                   app with no parallel read

EDGE (printed, honest)
    It walks the order it is HANDED and trusts the maps -- it does not check that
    the order is a valid data-flow, that a witness covers its primitive, or that a
    port_verb is right. Pure-kernels are skipped by design (they're gaps, not
    stages); if your primitive map miscategorises a node, it's skipped or included
    wrongly. It resolves structure, it does not verify it.

PROVENANCE
    The fold body is extracted verbatim from a recipe-compiler's order-walk loop.
    This gift wraps that pure fold in a stdin->stdout CLI; the wrapper adds only
    I/O, so the gift's determinism is exactly the fold's.

Zero dependencies (Python 3 stdlib only), offline, deterministic.
"""

import argparse
import json
import sys


def order_walk(spine, prim, witness_map, served, verb_of):
    """batch_core.order + parallel_join.members -> (pipe_stages ∘ chain, ⊗ fork).

    served:  set of served gift slugs (compile_recipe_spine._served_gifts()).
    verb_of: {slug: port_verb} from the gifts manifest (verifier.dc.load_gifts).
    """
    batch = spine.get("batch_core", {})
    order = batch.get("order", [])
    pj = batch.get("parallel_join") or {}          # null-safe: no ⊗ fork => {}
    parallel_members = set(pj.get("members", []))

    pipe_stages = []   # the ∘ chain, in data-flow order, pipe-class only
    fork = None        # the one ⊗ fork (None for an app with no parallel read)
    for pid in order:
        m = prim.get(pid, {})
        if m.get("class") != "pipe":
            continue   # pure-kernels handled as gaps; interactive not in batch order
        witness = witness_map.get(pid)
        stage = {
            "primitive": pid,
            "witness_gift": witness,
            "port_verb": verb_of.get(witness) if witness else None,
            "served": witness in served if witness else False,
        }
        if pid in parallel_members:
            if fork is None:
                # feeds: the spine's DECLARED join target (parallel_join.feeds) --
                # the stage that consumes the fork's outputs. NOT inferred as
                # pipe_stages[0]; that is only right when the fork feeds the head.
                # None when undeclared -> harness_fold falls back to the head.
                fork = {"op": "\u2297", "members": [], "reason": pj.get("reason", ""),
                        "feeds": pj.get("feeds")}
            fork["members"].append(stage)
        else:
            pipe_stages.append(stage)
    return pipe_stages, fork


def _die(msg, code=2):
    sys.stderr.write("order-walk: " + msg + "\n")
    sys.exit(code)


def _read_stdin_object():
    """Read one JSON object from stdin -> a dict of kwargs. Crash-clean on bad
    or empty input: a nonzero exit and a one-line message, never a traceback."""
    data = sys.stdin.read()
    if not data.strip():
        _die("no input on stdin -- pipe a JSON object with keys "
             "spine, prim, witness_map, served, verb_of", 2)
    try:
        obj = json.loads(data)
    except json.JSONDecodeError as e:
        _die("stdin is not valid JSON: %s" % e, 2)
    if not isinstance(obj, dict):
        _die("stdin JSON must be an object mapping kwargs "
             "(spine, prim, witness_map, served, verb_of), got a %s" % type(obj).__name__, 2)
    return obj


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--selftest" in argv:
        return 0 if _selftest() else 1

    p = argparse.ArgumentParser(
        prog="order_walk.py", add_help=True,
        description="Split a batch order into its \u2218 pipe chain and \u2297 fork. Reads a "
                    "JSON object with keys spine, prim, witness_map, served, verb_of from stdin.",
        epilog="example:  printf '{\"spine\": {\"batch_core\": {\"order\": [\"a.read\", "
               "\"a.filt\"], \"parallel_join\": null}}, \"prim\": {\"a.read\": {\"class\": "
               "\"pipe\"}, \"a.filt\": {\"class\": \"pipe\"}}, \"witness_map\": {\"a.read\": "
               "\"json-source\"}, \"served\": [\"json-source\"], \"verb_of\": {\"json-source\": "
               "\"source\"}}' | python3 order_walk.py")
    p.parse_args(argv)

    obj = _read_stdin_object()
    try:
        result = order_walk(**obj)
    except TypeError as e:
        _die("stdin object keys must be exactly the fold's args "
             "(spine, prim, witness_map, served, verb_of): %s" % e, 2)
    except (KeyError, AttributeError) as e:
        _die("malformed input structure: %s" % e, 2)
    sys.stdout.write(json.dumps(result, indent=2, sort_keys=True, ensure_ascii=False) + "\n")
    return 0


def _selftest():
    """Prove: pipe-class split, ⊗ fork membership, pure-kernels skipped,
    port_verb+served resolution, fork=None on no-fork, folds-twice-identical."""
    spine = {"batch_core": {
        "order": ["a.read", "a.filt", "a.left", "a.right", "a.kernel"],
        "parallel_join": {"members": ["a.left", "a.right"], "reason": "two independent reads"},
    }}
    prim = {
        "a.read": {"class": "pipe"}, "a.filt": {"class": "pipe"},
        "a.left": {"class": "pipe"}, "a.right": {"class": "pipe"},
        "a.kernel": {"class": "pure-kernel"},   # skipped
    }
    wmap = {"a.read": "json-source", "a.filt": "schema-filter",
            "a.left": "gL", "a.right": "gR"}
    served = {"json-source", "gL"}
    verb_of = {"json-source": "source", "schema-filter": "filter", "gL": "fold", "gR": "fold"}

    stages, fork = order_walk(spine, prim, wmap, served, verb_of)
    stage_ids = [s["primitive"] for s in stages]
    assert stage_ids == ["a.read", "a.filt"], stage_ids          # ∘ chain, in order
    assert "a.kernel" not in stage_ids                            # pure-kernel skipped
    assert fork is not None and {m["primitive"] for m in fork["members"]} == {"a.left", "a.right"}, fork
    assert stages[0]["port_verb"] == "source" and stages[0]["served"] is True, stages[0]
    assert stages[1]["served"] is False, stages[1]               # schema-filter not in served set
    assert fork["members"][0]["port_verb"] == "fold", fork
    # folds-twice-identical
    assert order_walk(spine, prim, wmap, served, verb_of) == (stages, fork)
    # served may arrive as a list (JSON has no sets); membership still resolves
    assert order_walk(spine, prim, wmap, ["json-source", "gL"], verb_of) == (stages, fork)

    # no-fork degenerate (parallel_join null) -> fork is None
    spine2 = {"batch_core": {"order": ["a.read", "a.filt"], "parallel_join": None}}
    st2, fk2 = order_walk(spine2, prim, wmap, served, verb_of)
    assert fk2 is None and [s["primitive"] for s in st2] == ["a.read", "a.filt"], (st2, fk2)

    print("order-walk selftest: pipe/\u2297 split, pure-kernel skip, port_verb+served bind, "
          "list-or-set served, fork=None degenerate; folds-twice-identical.")
    return True


if __name__ == "__main__":
    sys.exit(main())
