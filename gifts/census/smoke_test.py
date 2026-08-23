#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""smoke_test.py — non-vacuous tests for census.py.

The load-bearing claim is the visible/buried distinction. The suite plants a
marker in visible code AND the same marker inside a comment and asserts census
tells them apart — a census that called everything visible (or everything
buried) would fail. Run: python3 smoke_test.py
"""

import io
import json
import os
import sys
import tempfile

import census

FAIL = 0


def ok(cond, msg):
    global FAIL
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        FAIL += 1


def run(root, *args):
    old = sys.stdout
    sys.stdout = io.StringIO()
    try:
        code = census.main([root] + list(args))
        out = sys.stdout.getvalue()
    finally:
        sys.stdout = old
    return code, out


def main():
    with tempfile.TemporaryDirectory() as d:
        # a python file: one visible TODO (a whole word in a string), one buried
        # in a # comment. NB the visible one must be a WHOLE word — `TODO_x` has
        # no word boundary after TODO and correctly would not match.
        with open(os.path.join(d, "a.py"), "w") as fh:
            fh.write("x = 1  # TODO buried in a comment\n")
            fh.write('label = \"TODO\"  # visible marker in a string literal\n')
        # an html file: a marker buried in an html comment
        with open(os.path.join(d, "b.html"), "w") as fh:
            fh.write("<p>hello</p>\n<!-- FIXME buried html marker -->\n")
        # a js file: a visible marker (whole word) and a block-comment-buried one
        with open(os.path.join(d, "c.js"), "w") as fh:
            fh.write('const label = \"XXX\";\n/* HACK buried in a block comment */\n')
        # a file type NOT in defaults — must be ignored
        with open(os.path.join(d, "ignore.log"), "w") as fh:
            fh.write("TODO this should never be seen (.log not scanned)\n")

        # 1. JSON-lines contract + the core visible/buried distinction.
        code, out = run(d, "--json")
        recs = [json.loads(l) for l in out.splitlines() if l.strip()]
        ok(code == 0, "json run exits 0")
        # a.py: line1 TODO buried, line2 TODO visible
        a_todos = sorted([r for r in recs if r["path"] == "a.py"], key=lambda r: r["line"])
        ok(len(a_todos) == 2 and a_todos[0]["visible"] is False and a_todos[1]["visible"] is True,
           "a.py: the # -comment TODO is BURIED, the code TODO is VISIBLE (the distinction bites)")

        # 2. html comment burial.
        b = [r for r in recs if r["path"] == "b.html"]
        ok(len(b) == 1 and b[0]["marker"] == "FIXME" and b[0]["visible"] is False,
           "b.html: FIXME inside <!-- --> is BURIED")

        # 3. js: visible XXX + block-comment-buried HACK.
        c = sorted([r for r in recs if r["path"] == "c.js"], key=lambda r: r["line"])
        ok([(r["marker"], r["visible"]) for r in c] == [("XXX", True), ("HACK", False)],
           "c.js: XXX visible, HACK buried in /* */ block comment")

        # 4. the .log file is never scanned (extension filter).
        ok(not any(r["path"] == "ignore.log" for r in recs),
           ".log is not in default extensions — never scanned")

        # 5. --buried-only drops the visible ones.
        code, out = run(d, "--json", "--buried-only")
        recs2 = [json.loads(l) for l in out.splitlines() if l.strip()]
        ok(all(r["visible"] is False for r in recs2) and len(recs2) == 3,
           "--buried-only reports exactly the 3 buried markers, no visible ones")

        # 6. --strict exits 1 when a buried marker exists.
        code, _ = run(d, "--json", "--strict")
        ok(code == 1, "--strict exits 1 because buried markers are present")

        # 7. custom --marker finds a non-default token; word boundary respected.
        with open(os.path.join(d, "d.py"), "w") as fh:
            fh.write("WRITEME = 1\n")
            fh.write("REWRITEMEN = 2  # a longer token, no whole-word hit here\n")
        code, out = run(d, "--json", "--marker", "WRITEME")
        recs3 = [json.loads(l) for l in out.splitlines() if l.strip()]
        dhits = [r for r in recs3 if r["path"] == "d.py"]
        ok(len(dhits) == 1 and dhits[0]["line"] == 1,
           "custom --marker WRITEME matches the whole word only, not the substring in REWRITEMEN")

        # 8. --no-word-boundary lets a glyph/substring marker match.
        with open(os.path.join(d, "e.html"), "w") as fh:
            fh.write("<!--WRITE--> visible? no, it's in a comment\n")
        code, out = run(d, "--json", "--marker", "<!--WRITE-->", "--no-word-boundary", "--ext", ".html")
        recs4 = [json.loads(l) for l in out.splitlines() if l.strip()]
        ehits = [r for r in recs4 if r["path"] == "e.html"]
        ok(len(ehits) == 1, "--no-word-boundary matches a punctuation marker like <!--WRITE-->")

        # 9. MUTATION CHECK — a census that called everything visible would fail
        #    test 1/2/3. Prove the buried-detector is not vacuous by asserting the
        #    two populations are genuinely non-empty and disjoint.
        vis = [r for r in recs if r["visible"]]
        bur = [r for r in recs if not r["visible"]]
        ok(len(vis) >= 2 and len(bur) >= 3,
           "mutation check: both visible (>=2) and buried (>=3) populations are non-empty "
           "(an all-visible or all-buried classifier could not produce this)")

    print("\n" + ("CENSUS: %d FAILED" % FAIL if FAIL else "CENSUS: ALL GREEN"))
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
