#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""gap-extract -- bind a spec's declared gaps to their witnesses, as a standalone gift.

Give it a spec's declared `gaps[]`, a primitive map, and a witness map, and it
emits one record per gap: which primitive it is, its covenant class and role,
the witness that covers it (or `null` for a derive-first gap), and a resolved
`status` of "witnessed" or "derive-first". It's the bookkeeping step that turns
"here are the holes" into "here is exactly what covers each hole, and what
doesn't yet".

    printf '{"spine": {...}, "prim": {...}, "witness_map": {...}}' | python3 gap_extract.py

USAGE
    printf '<json>' | python3 gap_extract.py     (stdin -> stdout)
    python3 gap_extract.py --help
    python3 gap_extract.py --selftest

INPUT CONTRACT
    One JSON object on stdin whose keys are the fold's keyword arguments:
      spine        {"gaps": [{"primitive": <id>, "covenant_class": <cls?>}, ...]}
      prim         {<primitive_id>: {"class": <cls>, "role": <role>}, ...}
      witness_map  {<primitive_id>: <witness_slug_or_null>, ...}
    A primitive present in witness_map with a null value is a derive-first gap;
    a non-null value marks it witnessed.

OUTPUT
    A JSON array of gap records, in the spine's declared gap order.

EDGE (printed, honest)
    It REPORTS coverage from the maps you hand it -- it does not VERIFY that a
    named witness actually covers the primitive. A witness_map that lies (points
    a gap at a gift that doesn't cover it) produces a "witnessed" record that is
    wrong; the fold trusts its inputs. It resolves status, it does not audit truth.

PROVENANCE
    The fold body is extracted verbatim from a recipe-compiler's gap-binding loop.
    This gift wraps that pure fold in a stdin->stdout CLI; the wrapper adds only
    I/O, so the gift's determinism is exactly the fold's.

Zero dependencies (Python 3 stdlib only), offline, deterministic.
"""

import argparse
import json
import sys


def gap_extract(spine, prim, witness_map):
    """spine.gaps[] + oracle primitives + witness map -> manifest gap records.

    prim: {primitive_id: {"class","subverb","role"}} (verifier._oracle_primitives)
    witness_map: {primitive_id: witness_gift_slug_or_None} (verifier.witnesses_of)
    """
    gaps = []
    for g in spine.get("gaps", []):
        pid = g["primitive"]
        gaps.append({
            "primitive": pid,
            "covenant_class": g.get("covenant_class", prim.get(pid, {}).get("class")),
            "witness": witness_map.get(pid),  # None => derive-first gap
            "status": "derive-first" if witness_map.get(pid) is None else "witnessed",
            "role": prim.get(pid, {}).get("role"),
            "note": "a pure-kernel (not a pipe stage); derive-first (gifts-8-reference-apps line) if null-witness.",
        })
    return gaps


def _die(msg, code=2):
    sys.stderr.write("gap-extract: " + msg + "\n")
    sys.exit(code)


def _read_stdin_object():
    """Read one JSON object from stdin -> a dict of kwargs. Crash-clean on bad
    or empty input: a nonzero exit and a one-line message, never a traceback."""
    data = sys.stdin.read()
    if not data.strip():
        _die("no input on stdin -- pipe a JSON object with keys "
             "spine, prim, witness_map", 2)
    try:
        obj = json.loads(data)
    except json.JSONDecodeError as e:
        _die("stdin is not valid JSON: %s" % e, 2)
    if not isinstance(obj, dict):
        _die("stdin JSON must be an object mapping kwargs "
             "(spine, prim, witness_map), got a %s" % type(obj).__name__, 2)
    return obj


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--selftest" in argv:
        return 0 if _selftest() else 1

    p = argparse.ArgumentParser(
        prog="gap_extract.py", add_help=True,
        description="Bind a spec's declared gaps to their witnesses. Reads a JSON "
                    "object {\"spine\":..., \"prim\":..., \"witness_map\":...} from stdin.",
        epilog="example:  printf '{\"spine\": {\"gaps\": [{\"primitive\": \"a.k1\"}]}, "
               "\"prim\": {\"a.k1\": {\"class\": \"pure-kernel\", \"role\": \"fold\"}}, "
               "\"witness_map\": {\"a.k1\": null}}' | python3 gap_extract.py")
    p.parse_args(argv)

    obj = _read_stdin_object()
    try:
        result = gap_extract(**obj)
    except TypeError as e:
        _die("stdin object keys must be exactly the fold's args "
             "(spine, prim, witness_map): %s" % e, 2)
    except (KeyError, AttributeError) as e:
        _die("malformed input structure: %s" % e, 2)
    sys.stdout.write(json.dumps(result, indent=2, sort_keys=True, ensure_ascii=False) + "\n")
    return 0


def _selftest():
    """Prove: derive-first vs witnessed status resolves from the witness map;
    folds-twice-identical; empty gaps[] -> [];."""
    spine = {"gaps": [
        {"primitive": "a.k1", "covenant_class": "pure-kernel"},
        {"primitive": "a.k2", "covenant_class": "pure-kernel"},
    ]}
    prim = {"a.k1": {"class": "pure-kernel", "role": "fold"},
            "a.k2": {"class": "pure-kernel", "role": "source"}}
    wmap = {"a.k1": None, "a.k2": "some-gift"}
    out = gap_extract(spine, prim, wmap)
    assert out[0]["status"] == "derive-first" and out[0]["witness"] is None, out
    assert out[1]["status"] == "witnessed" and out[1]["witness"] == "some-gift", out
    assert out[0]["role"] == "fold" and out[1]["role"] == "source", out
    # folds-twice-identical
    assert gap_extract(spine, prim, wmap) == out
    # empty
    assert gap_extract({"gaps": []}, {}, {}) == []
    assert gap_extract({}, {}, {}) == []
    print("gap-extract selftest: status/witness/role bind; folds-twice-identical; empty-safe.")
    return True


if __name__ == "__main__":
    sys.exit(main())
