#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""shell-scaffold -- name each interactive lane's reducer + UX seam, as a standalone gift.

Give it a spec's interactive functor and the set of gift slugs you've shipped,
and for each interactive sub-lane it names the deterministic reducer gift that
covers it, flags whether that reducer is served, and emits a UX-seam string that
says, in plain words, "wire this reducer in -- the reducer is deterministic and
shipped; the pointer/render/history UX around it is yours." It names the seam;
it never writes the UX.

    printf '{"spine": {...}, "served": [...]}' | python3 shell_scaffold.py

USAGE
    printf '<json>' | python3 shell_scaffold.py     (stdin -> stdout)
    python3 shell_scaffold.py --help
    python3 shell_scaffold.py --selftest

INPUT CONTRACT
    One JSON object on stdin whose keys are the fold's keyword arguments:
      spine            {"interactive_functor": {"covenant_spec": <s>,
                          "sub_lanes": [{"primitive": <id>,
                                         "covenant_subverb": <subverb>}, ...]}}
      served           [<gift_slug>, ...]  (the set of slugs you've shipped)
      sublane_reducer  optional {<subverb>: <reducer_slug>, ...} override; omit
                       it to use the built-in default map.

OUTPUT
    A JSON array of shell records, one per interactive sub-lane.

EDGE (printed, honest)
    It NAMES the seam and the reducer -- it does not WRITE the UX, and it does not
    check that the named reducer actually exists or is correct for the lane. The
    reducer binding comes from a fixed subverb->gift map; a lane with an unmapped
    subverb gets a null reducer and a seam that says so. It scaffolds; you build.

PROVENANCE
    The fold body (and its default subverb->reducer map) is extracted verbatim
    from a recipe-compiler's shell-scaffold block. This gift wraps that pure fold
    in a stdin->stdout CLI; the wrapper adds only I/O, so the gift's determinism
    is exactly the fold's.

Zero dependencies (Python 3 stdlib only), offline, deterministic.
"""

import argparse
import json
import sys

# The interactive covenant sub-lane -> shipped reducer gift, carried here as the
# default so the fold is self-contained; the harness passes the compiler's own
# SUBLANE_REDUCER to keep a single source of truth (DX: no forked copy in use).
DEFAULT_SUBLANE_REDUCER = {
    "input-handling": "input-event-router",
    "render-loop": "render-loop-harness",
    "state-mutation": "undo-stack-kernel",
}


def shell_scaffold(spine, served, sublane_reducer=None):
    """interactive_functor.sub_lanes -> interactive_shells[] (reducer bind + seam)."""
    reducer_map = DEFAULT_SUBLANE_REDUCER if sublane_reducer is None else sublane_reducer
    shells = []
    for lane in spine.get("interactive_functor", {}).get("sub_lanes", []):
        pid = lane["primitive"]
        subverb = lane.get("covenant_subverb")
        reducer = reducer_map.get(subverb)
        shells.append({
            "primitive": pid,
            "covenant_subverb": subverb,
            "reducer_gift": reducer,
            "reducer_served": reducer in served if reducer else False,
            "ux_seam": f"YOUR JUDGMENT HERE: wire {reducer or '<no reducer gift>'} into the app's "
                       f"{subverb} shell -- the reducer is deterministic and shipped; the pointer/render/"
                       f"history UX around it is yours.",
            "reducer_spec": spine.get("interactive_functor", {}).get("covenant_spec"),
        })
    return shells


def _die(msg, code=2):
    sys.stderr.write("shell-scaffold: " + msg + "\n")
    sys.exit(code)


def _read_stdin_object():
    """Read one JSON object from stdin -> a dict of kwargs. Crash-clean on bad
    or empty input: a nonzero exit and a one-line message, never a traceback."""
    data = sys.stdin.read()
    if not data.strip():
        _die("no input on stdin -- pipe a JSON object with keys "
             "spine, served [, sublane_reducer]", 2)
    try:
        obj = json.loads(data)
    except json.JSONDecodeError as e:
        _die("stdin is not valid JSON: %s" % e, 2)
    if not isinstance(obj, dict):
        _die("stdin JSON must be an object mapping kwargs "
             "(spine, served [, sublane_reducer]), got a %s" % type(obj).__name__, 2)
    return obj


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--selftest" in argv:
        return 0 if _selftest() else 1

    p = argparse.ArgumentParser(
        prog="shell_scaffold.py", add_help=True,
        description="Name each interactive lane's reducer gift and UX seam. Reads a "
                    "JSON object {\"spine\":..., \"served\":[...][, \"sublane_reducer\":{...}]} "
                    "from stdin.",
        epilog="example:  printf '{\"spine\": {\"interactive_functor\": {\"covenant_spec\": "
               "\"spec.md\", \"sub_lanes\": [{\"primitive\": \"a.click\", \"covenant_subverb\": "
               "\"input-handling\"}]}}, \"served\": [\"input-event-router\"]}' | "
               "python3 shell_scaffold.py")
    p.parse_args(argv)

    obj = _read_stdin_object()
    try:
        result = shell_scaffold(**obj)
    except TypeError as e:
        _die("stdin object keys must be the fold's args "
             "(spine, served [, sublane_reducer]): %s" % e, 2)
    except (KeyError, AttributeError) as e:
        _die("malformed input structure: %s" % e, 2)
    sys.stdout.write(json.dumps(result, indent=2, sort_keys=True, ensure_ascii=False) + "\n")
    return 0


def _selftest():
    """Prove: reducer bind from the closed map, served flag, seam string, spec
    carry; zero-lane app -> []; folds-twice-identical."""
    spine = {"interactive_functor": {
        "covenant_spec": "spec.md",
        "sub_lanes": [
            {"primitive": "a.click", "covenant_subverb": "input-handling"},
            {"primitive": "a.draw", "covenant_subverb": "render-loop"},
        ],
    }}
    served = {"input-event-router"}
    out = shell_scaffold(spine, served)
    assert out[0]["reducer_gift"] == "input-event-router" and out[0]["reducer_served"] is True, out
    assert out[1]["reducer_gift"] == "render-loop-harness" and out[1]["reducer_served"] is False, out
    assert out[0]["ux_seam"].startswith("YOUR JUDGMENT HERE"), out
    assert out[0]["reducer_spec"] == "spec.md", out
    # folds-twice-identical
    assert shell_scaffold(spine, served) == out
    # served may arrive as a list (JSON has no sets); membership still resolves
    assert shell_scaffold(spine, ["input-event-router"]) == out
    # zero-lane (identity functor -- the compiler) -> []
    assert shell_scaffold({"interactive_functor": {"sub_lanes": []}}, served) == []
    assert shell_scaffold({}, served) == []
    print("shell-scaffold selftest: reducer bind + served flag + seam + spec; "
          "list-or-set served; zero-lane degenerate -> []; folds-twice-identical.")
    return True


if __name__ == "__main__":
    sys.exit(main())
