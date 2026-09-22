#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""manifest-emit -- canonicalize a record to byte-stable JSON, as a standalone gift.

Give it a record (any JSON object), and it emits that record as canonical JSON:
keys sorted, two-space indent, unicode preserved. The point is byte-stability --
the same record ALWAYS emits the same bytes, no matter what order its keys came
in, so two runs (or two machines) produce an identical file you can hash, diff,
or commit and trust to be equal iff the data is equal.

    printf '{"record": {"b": 1, "a": 2}}' | python3 manifest_emit.py
      -> {\n  "a": 2,\n  "b": 1\n}

USAGE
    printf '{"record": <your record>}' | python3 manifest_emit.py   (stdin -> stdout)
    python3 manifest_emit.py --help
    python3 manifest_emit.py --selftest

INPUT CONTRACT
    One JSON object on stdin whose keys are the fold's keyword arguments. This
    fold takes exactly one argument, `record`, so the stdin object is:
        {"record": <the record to canonicalize>}
    `record` may be any JSON value (object, array, string, number, bool, null).

OUTPUT
    The record re-serialized canonically: json.dumps(record, indent=2,
    sort_keys=True, ensure_ascii=False). No trailing structure is added.

EDGE (printed, honest)
    It canonicalizes -- it does not validate. It will faithfully emit whatever
    record you hand it, including one that is malformed for your downstream
    schema. Canonical bytes are a guarantee about DETERMINISM (same data ->
    same bytes), never about CORRECTNESS of the data itself.

PROVENANCE
    The fold body is extracted verbatim from compile_recipe_spine.py's terminal
    serialize step and is proven byte-identical to the compiler's own output.
    This gift wraps that pure fold in a stdin->stdout CLI; the CLI adds only I/O,
    so the gift's determinism is exactly the fold's.

Zero dependencies (Python 3 stdlib only), offline, deterministic.
"""

import argparse
import json
import sys


def manifest_emit(record):
    """record -> sorted-keys canonical JSON string (no trailing newline).

    Byte-canonical: sort_keys=True, indent=2, ensure_ascii=False -- the exact
    triple compile_recipe_spine.py emits, so the composed fold is byte-identical
    to the compiler's own output."""
    return json.dumps(record, indent=2, sort_keys=True, ensure_ascii=False)


def _die(msg, code=2):
    sys.stderr.write("manifest-emit: " + msg + "\n")
    sys.exit(code)


def _read_stdin_object():
    """Read one JSON object from stdin -> a dict of kwargs. Crash-clean on bad
    or empty input: a nonzero exit and a one-line message, never a traceback."""
    data = sys.stdin.read()
    if not data.strip():
        _die("no input on stdin -- pipe a JSON object, e.g. "
             "printf '{\"record\": {...}}' | manifest_emit.py", 2)
    try:
        obj = json.loads(data)
    except json.JSONDecodeError as e:
        _die("stdin is not valid JSON: %s" % e, 2)
    if not isinstance(obj, dict):
        _die("stdin JSON must be an object mapping kwargs (expected key: "
             "'record'), got a %s" % type(obj).__name__, 2)
    return obj


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--selftest" in argv:
        return _selftest()

    p = argparse.ArgumentParser(
        prog="manifest_emit.py", add_help=True,
        description="Canonicalize a record to byte-stable JSON (sorted keys, "
                    "2-space indent, unicode preserved). Reads a JSON object "
                    "{\"record\": <your record>} from stdin.",
        epilog="example:  printf '{\"record\": {\"b\":1,\"a\":2}}' | "
               "python3 manifest_emit.py")
    p.parse_args(argv)  # accepts only -h/--help; a stray arg exits 2 cleanly

    obj = _read_stdin_object()
    try:
        result = manifest_emit(**obj)
    except TypeError as e:
        _die("stdin object must have exactly the key 'record' (the record to "
             "canonicalize): %s" % e, 2)
    sys.stdout.write(result + "\n")
    return 0


def _selftest():
    ok = 0
    total = 0

    def check(name, cond):
        nonlocal ok, total
        total += 1
        if cond:
            ok += 1
        else:
            sys.stderr.write("  FAIL: %s\n" % name)

    # same data, different key order -> identical bytes (canonical)
    a = {"b": 1, "a": 2, "op": "\u2297", "nested": {"z": [3, 2, 1], "y": "\u2218"}}
    b = {"nested": {"y": "\u2218", "z": [3, 2, 1]}, "op": "\u2297", "a": 2, "b": 1}
    ta, tb = manifest_emit(a), manifest_emit(b)
    check("key-order-independent (canonical)", ta == tb)
    # top-level keys are sorted
    check("top-level keys sorted",
          ta.index('"a"') < ta.index('"b"') < ta.index('"nested"') < ta.index('"op"'))
    # unicode preserved, not \\u-escaped
    check("unicode preserved (not escaped)", "\u2297" in ta and "\u2218" in ta)
    # folds-twice-identical
    check("folds-twice-identical", manifest_emit(a) == ta)
    # two-space indent
    check("two-space indent", '\n  "a": 2' in ta)
    # non-dict records round-trip too (array / scalar)
    check("array record", manifest_emit([3, 1, 2]) == "[\n  3,\n  1,\n  2\n]")
    check("scalar record", manifest_emit("hi") == '"hi"')

    sys.stdout.write("manifest-emit selftest: %d/%d passed\n" % (ok, total))
    return 0 if ok == total else 1


if __name__ == "__main__":
    sys.exit(main())
