#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""test_cruise.py — mutation-bitten tests for the cruise gift.

Self-contained: builds its own fixture tree in a tempdir, runs cruise over it, and
asserts on the ledger. Includes a PINNED GOLDEN wire string — the exact deterministic
JSON-lines output for the fixture — so a change in extraction, ordering, or the
proves/does-not-prove text is caught as a byte diff.

Mutation bite (proven with teeth in the build):
  - remove the sort in scan_tree()            -> ordering tests + golden fail
  - drop the server-receiver guard in routes  -> a client call double-counts as a route
  - omit proves/does_not_prove from a fact     -> the "every fact carries proves" test fails
  - break the headless grade set-difference    -> the grade tests fail

Run:  python3 test_cruise.py      (prints "N/N passed" and exits 0 on all-green)
"""

import io
import json
import os
import sys
import tempfile
import contextlib

import cruise

# --- fixture -----------------------------------------------------------------

FIXTURE = {
    "server/api.js": (
        'app.get("/api/users")\n'
        'app.post("/api/login")\n'
        'router.delete("/api/users/:id")\n'
        'app.get("/api/orphan")\n'
    ),
    "client/ui.js": (
        'fetch("/api/users")\n'
        'axios.post("/api/login")\n'
        '// nobody calls /api/orphan\n'
    ),
    "client/page.html": (
        "<button>Save Changes</button>\n"
        '<a aria-label="Delete account">x</a>\n'
    ),
    "__tests__/api.test.js": (
        'it("returns users on GET /api/users")\n'
        'test("rejects bad login")\n'
    ),
}

# The PINNED GOLDEN: the exact --json output over the fixture, one object per line.
# Regenerate deliberately (never silently) if the contract changes.
GOLDEN = [
    {"does_not_prove": "that the control is enabled, wired to anything, or reachable", "line": 1, "path": "client/page.html", "plot": "affordance", "proves": "the markup contains this user-visible control label", "value": "Save Changes"},
    {"does_not_prove": "that the control is enabled, wired to anything, or reachable", "line": 2, "path": "client/page.html", "plot": "affordance", "proves": "the markup contains this user-visible control label", "value": "Delete account"},
    {"does_not_prove": "that the control is enabled, wired to anything, or reachable", "line": 2, "path": "client/page.html", "plot": "affordance", "proves": "the markup contains this user-visible control label", "value": "x"},
    {"does_not_prove": "that the request succeeds or that a server serves this path", "line": 1, "path": "client/ui.js", "plot": "call", "proves": "the client source issues a request naming this URL", "value": "/api/users"},
    {"does_not_prove": "that the request succeeds or that a server serves this path", "line": 2, "path": "client/ui.js", "plot": "call", "proves": "the client source issues a request naming this URL", "value": "/api/login"},
    {"does_not_prove": "that the test executes, or that it passes", "line": 1, "path": "__tests__/api.test.js", "plot": "claim", "proves": "a test file contains this assertion description string", "value": "returns users on GET /api/users"},
    {"does_not_prove": "that the test executes, or that it passes", "line": 2, "path": "__tests__/api.test.js", "plot": "claim", "proves": "a test file contains this assertion description string", "value": "rejects bad login"},
    {"does_not_prove": "that the route works, is reachable, is authorized, or is tested", "line": 1, "path": "server/api.js", "plot": "route", "proves": "the server source declares this path literal in a route/handler", "value": "/api/users"},
    {"does_not_prove": "that the route works, is reachable, is authorized, or is tested", "line": 2, "path": "server/api.js", "plot": "route", "proves": "the server source declares this path literal in a route/handler", "value": "/api/login"},
    {"does_not_prove": "that the route works, is reachable, is authorized, or is tested", "line": 3, "path": "server/api.js", "plot": "route", "proves": "the server source declares this path literal in a route/handler", "value": "/api/users/:id"},
    {"does_not_prove": "that the route works, is reachable, is authorized, or is tested", "line": 4, "path": "server/api.js", "plot": "route", "proves": "the server source declares this path literal in a route/handler", "value": "/api/orphan"},
    {"detail": "served but no client call names it \u2014 built, unreached by the client source scanned", "grade": "HEADLESS-ROUTE", "value": "/api/orphan"},
    {"detail": "served but no client call names it \u2014 built, unreached by the client source scanned", "grade": "HEADLESS-ROUTE", "value": "/api/users/:id"},
]


def build_fixture(root):
    for rel, body in FIXTURE.items():
        full = os.path.join(root, rel)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as fh:
            fh.write(body)


def run_json(root, extra=None):
    argv = [root, "--json"] + (extra or [])
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = cruise.main(argv)
    lines = [json.loads(l) for l in buf.getvalue().splitlines() if l.strip()]
    return rc, lines


# --- tests -------------------------------------------------------------------

RESULTS = []


def check(name, cond):
    RESULTS.append((name, bool(cond)))


def main():
    with tempfile.TemporaryDirectory() as root:
        build_fixture(root)
        rc, facts = run_json(root)

        # 1. pinned golden — exact deterministic ledger
        check("golden: ledger matches pinned wire objects exactly", facts == GOLDEN)

        # 2. determinism — same tree, byte-identical twice
        _, again = run_json(root)
        check("determinism: two runs byte-identical", facts == again)

        only_facts = [f for f in facts if "plot" in f]
        grades = [f for f in facts if "grade" in f]

        # 3. plot tallies
        routes = [f for f in only_facts if f["plot"] == "route"]
        calls = [f for f in only_facts if f["plot"] == "call"]
        affs = [f for f in only_facts if f["plot"] == "affordance"]
        claims = [f for f in only_facts if f["plot"] == "claim"]
        check("routes: exactly the 4 server declarations", len(routes) == 4)
        check("calls: exactly the 2 client requests", len(calls) == 2)
        check("affordances: exactly the 3 labels", len(affs) == 3)
        check("claims: exactly the 2 test descriptions", len(claims) == 2)

        # 4. the server-receiver guard — axios.post is a CALL, never a route (double-count bite)
        route_vals = {r["value"] for r in routes if r["path"] == "client/ui.js"}
        check("guard: no client-file value counted as a route", route_vals == set())

        # 5. every fact carries proves + does_not_prove (the honesty bite)
        check("honesty: every fact has proves", all(f.get("proves") for f in only_facts))
        check("honesty: every fact has does_not_prove", all(f.get("does_not_prove") for f in only_facts))

        # 6. headless grade — orphan (never called) is graded; users (called) is not
        hv = {g["value"] for g in grades if g["grade"] == "HEADLESS-ROUTE"}
        check("grade: /api/orphan is HEADLESS (never called)", "/api/orphan" in hv)
        check("grade: /api/users is NOT headless (it is called)", "/api/users" not in hv)

        # 7. ordering — sorted by (plot, path, line, value)
        keys = [(f["plot"], f["path"], f["line"], f["value"]) for f in only_facts]
        check("ordering: facts sorted by (plot,path,line,value)", keys == sorted(keys))

        # 8. --plot filter narrows to one plot
        _, ro = run_json(root, ["--plot", "route"])
        rof = [f for f in ro if "plot" in f]
        check("filter: --plot route yields only routes", all(f["plot"] == "route" for f in rof) and len(rof) == 4)

        # 9. --strict returns exit 1 when a headless route exists
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc_strict = cruise.main([root, "--json", "--strict"])
        check("strict: exit 1 with a headless route present", rc_strict == 1)

        # 10. non-strict default is exit 0 (report, not gate)
        check("default: exit 0 (a cruise is a report)", rc == 0)

        # 11. usage: non-directory root -> exit 3
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            rc_bad = cruise.main([os.path.join(root, "nope"), "--json"])
        check("usage: missing root -> exit 3", rc_bad == 3)

        # 12. empty tree -> no facts, exit 0
        with tempfile.TemporaryDirectory() as empty:
            rc_e, fe = run_json(empty)
            check("empty: no facts, exit 0", fe == [] and rc_e == 0)

    passed = sum(1 for _, ok in RESULTS if ok)
    total = len(RESULTS)
    for name, ok in RESULTS:
        print("%s  %s" % ("ok  " if ok else "FAIL", name))
    print("\n%d/%d passed" % (passed, total))
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
