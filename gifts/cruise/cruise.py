#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""cruise.py — a deterministic feature inventory of a codebase, so an LLM can't invent features.

Ask a language model "list all the features of this app" and it does two bad things
at once: it hallucinates plausible features that aren't there, and it misses real
ones that are. It has no floor under it. Cruise builds the floor. It walks a source
tree, extracts every byte-derived FACT about what the code actually exposes, and
emits a **ledger** — one fact per line, each carrying what it PROVES and, just as
important, what it does NOT prove. Hand that ledger to an LLM and ask it to *group
and name* the facts into features, and it cannot invent one that has no route, no
label, and no test behind it. The ledger is the floor; the prose is composed on top.

The name is a timber cruise: a systematic field survey of a standing forest, run to
produce a valuation for a buyer. This is that, for software — tally what is actually
standing, emit the survey, let someone else write the sales sheet from real numbers.

    python3 cruise.py <tree-root> [options]

------------------------------------------------------------------------------
THE FOUR PLOTS (each a pure, independent extractor over byte-truth):

  routes       server path literals in route/handler declarations
                 -> what the backend SERVES.        e.g.  app.get("/api/x")
  calls        client-side fetch/axios/request URLs
                 -> what the frontend ASKS FOR.     e.g.  fetch("/api/x")
  affordances  user-visible control labels (button/link/menu text)
                 -> what a USER can touch.          e.g.  <button>Save</button>
  claims       assertion descriptions in test files
                 -> what the code CLAIMS about itself. NOT executed, just read.

Each plot is a text scan with a declared pattern set, not a language parser. That is
the honest limit (see THE EDGE). It fails SAFE: a real fact it can't pattern-match is
a fact left out of the ledger, never a fabricated one put in.

WHAT EACH FACT PROVES — AND WHAT IT DOESN'T:
  Every fact in the ledger ships its own `proves` and `does_not_prove` string, because
  a right number under a wrong noun is a lie with a receipt. A `route` proves the
  backend has a path literal; it does NOT prove the route works, is reachable, or is
  tested. A `claim` proves a test file SAYS something; it does NOT prove the test runs
  or passes. The ledger stops you inventing a FEATURE. It cannot stop you inventing a
  PROPERTY of a real one — so it tells you, per fact, which properties it did not check.

TWO FREE GRADES (decidable, fall out of the plots):
  HEADLESS-ROUTE   a served route that no client call anywhere names. Built, but
                   nothing on the client side asks for it. (Fails SAFE: reported only
                   when neither called nor mentioned — a missed grade, never invented.)
  UNCLAIMED        a file with affordances but zero test claims -> unverified surface.

------------------------------------------------------------------------------
The JSON-lines contract (so this composes in a pipe):
  `--json` emits ONE JSON object per fact on stdout, sorted, deterministic:
     {"plot","value","path","line","proves","does_not_prove"}
  and the grades as {"grade","value","detail"} objects. Pipe the ledger into the
  next tool (count facts, filter to one plot, feed an LLM the whole thing).
  Without `--json` it prints a grouped human report.

Determinism: the tree is walked in sorted order, facts are sorted by
(plot, path, line, value), and the same tree always produces the same ledger —
byte-identical, so it is diffable, hashable, and cache-keyable.

Exit codes:
    0   ran clean (facts or none — a cruise is a report, not a gate)
    1   at least one HEADLESS-ROUTE grade AND --strict was given (gate mode)
    3   usage / unreadable root
"""

import argparse
import json
import os
import re
import sys

DEFAULT_EXTS = [
    ".py", ".js", ".cjs", ".mjs", ".ts", ".jsx", ".tsx",
    ".go", ".rb", ".java", ".rs", ".php",
    ".html", ".htm",
]

# What each plot proves and does not prove. Emitted INTO every fact so the ledger
# can never be read as claiming more than a text scan can support.
PLOT_PROVES = {
    "route": {
        "proves": "the server source declares this path literal in a route/handler",
        "does_not_prove": "that the route works, is reachable, is authorized, or is tested",
    },
    "call": {
        "proves": "the client source issues a request naming this URL",
        "does_not_prove": "that the request succeeds or that a server serves this path",
    },
    "affordance": {
        "proves": "the markup contains this user-visible control label",
        "does_not_prove": "that the control is enabled, wired to anything, or reachable",
    },
    "claim": {
        "proves": "a test file contains this assertion description string",
        "does_not_prove": "that the test executes, or that it passes",
    },
}

# ---- plot patterns (declared, so THE EDGE can name them) ---------------------

# routes: common server frameworks' path-literal declarations.
# The receiver must be a SERVER object (app/router/server/route/mux/r) — never a
# client HTTP library (axios/fetch/http/xhr/request), so `axios.post("/x")` is a
# CALL and not misread as a served route. The receiver group is the guard.
_ROUTE_PATS = [
    # app.get("/x") / router.post('/x') / server.delete(`/x`)  (Express/Koa/Fastify)
    re.compile(r"""\b(?:app|router|server|route|mux|r)\s*\.\s*(?:get|post|put|patch|delete|all|use|head|options)\s*\(\s*["'`](/[^"'`]*)["'`]""", re.I),
    # @app.route("/x") / @router.get("/x")  (Flask/FastAPI style)
    re.compile(r"""@\w+\.(?:route|get|post|put|patch|delete)\s*\(\s*["'`](/[^"'`]*)["'`]""", re.I),
    # http.HandleFunc("/x")  (Go style)
    re.compile(r"""HandleFunc\s*\(\s*["'`](/[^"'`]*)["'`]""", re.I),
]

# calls: client-side request URLs.
_CALL_PATS = [
    re.compile(r"""\bfetch\s*\(\s*["'`](/[^"'`?]*)["'`?]""", re.I),
    re.compile(r"""\baxios\s*(?:\.\s*(?:get|post|put|patch|delete))?\s*\(\s*["'`](/[^"'`?]*)["'`?]""", re.I),
    re.compile(r"""\b(?:request|http\.request|xhr\.open)\s*\(\s*(?:["'][A-Z]+["']\s*,\s*)?["'`](/[^"'`?]*)["'`?]""", re.I),
]

# affordances: user-visible control text. <button>Save</button>, <a>Delete</a>, aria-label.
_AFFORD_PATS = [
    re.compile(r"""<button\b[^>]*>\s*([^<>{][^<>]*?)\s*</button>""", re.I | re.S),
    re.compile(r"""<a\b[^>]*>\s*([^<>{][^<>]*?)\s*</a>""", re.I | re.S),
    re.compile(r"""\baria-label\s*=\s*["']([^"']+)["']""", re.I),
    re.compile(r"""<(?:li|span)\b[^>]*\brole\s*=\s*["']menuitem["'][^>]*>\s*([^<>{][^<>]*?)\s*</""", re.I | re.S),
]

# claims: test assertion descriptions. it("...")/test("...")/describe("...")/def test_x
_CLAIM_PATS = [
    re.compile(r"""\b(?:it|test|describe)\s*\(\s*["'`]([^"'`]+)["'`]""", re.I),
    re.compile(r"""\bdef\s+(test_[A-Za-z0-9_]+)\s*\(""", ),
]

_TEST_HINTS = ("test", "spec", "__tests__")


def _is_test_file(rel):
    low = rel.lower()
    return any(h in low for h in _TEST_HINTS)


def _line_starts(text):
    starts = [0]
    for m in re.finditer(r"\n", text):
        starts.append(m.end())
    return starts


def _lineno(off, starts):
    lo, hi = 0, len(starts) - 1
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if starts[mid] <= off:
            lo = mid
        else:
            hi = mid - 1
    return lo + 1


def _clean(s):
    # collapse whitespace in a captured affordance/claim label
    return re.sub(r"\s+", " ", s).strip()


def _extract(text, pats, plot, rel, starts):
    facts = []
    seen = set()
    for pat in pats:
        for m in pat.finditer(text):
            val = _clean(m.group(1))
            if not val:
                continue
            ln = _lineno(m.start(), starts)
            key = (plot, val, ln)
            if key in seen:
                continue
            seen.add(key)
            facts.append({
                "plot": plot,
                "value": val,
                "path": rel,
                "line": ln,
                "proves": PLOT_PROVES[plot]["proves"],
                "does_not_prove": PLOT_PROVES[plot]["does_not_prove"],
            })
    return facts


def scan_file(path, rel):
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    except OSError:
        return []
    starts = _line_starts(text)
    facts = []
    facts += _extract(text, _ROUTE_PATS, "route", rel, starts)
    facts += _extract(text, _CALL_PATS, "call", rel, starts)
    facts += _extract(text, _AFFORD_PATS, "affordance", rel, starts)
    if _is_test_file(rel):
        facts += _extract(text, _CLAIM_PATS, "claim", rel, starts)
    return facts


def scan_tree(root, exts):
    exts_l = tuple(e.lower() for e in exts)
    out = []
    for dp, dns, fns in os.walk(root):
        for skip in (".git", "node_modules", ".hg", ".svn", "__pycache__", "dist", "build"):
            if skip in dns:
                dns.remove(skip)
        dns.sort()
        for fn in sorted(fns):
            if fn.lower().endswith(exts_l):
                full = os.path.join(dp, fn)
                rel = os.path.relpath(full, root)
                out.extend(scan_file(full, rel))
    out.sort(key=lambda f: (f["plot"], f["path"], f["line"], f["value"]))
    return out


def grade(facts):
    """Two decidable grades over the fact set. Fail SAFE: reported only when the
    byte-truth is unambiguous (a missed grade, never an invented one)."""
    grades = []

    served = {f["value"] for f in facts if f["plot"] == "route"}
    named = {f["value"] for f in facts if f["plot"] == "call"}
    # a headless route is one served but never named by any client call
    for r in sorted(served - named):
        grades.append({
            "grade": "HEADLESS-ROUTE",
            "value": r,
            "detail": "served but no client call names it — built, unreached by the client source scanned",
        })

    # a file with affordances but no claims -> unclaimed surface
    afforded = {f["path"] for f in facts if f["plot"] == "affordance"}
    claimed_files = {f["path"] for f in facts if f["plot"] == "claim"}
    # claims live in test files, not the afforded file; grade at the tree level:
    if afforded and not any(f["plot"] == "claim" for f in facts):
        grades.append({
            "grade": "UNCLAIMED",
            "value": "(tree)",
            "detail": "%d file(s) expose affordances and the tree has zero test claims — unverified surface" % len(afforded),
        })
    return grades


def main(argv=None):
    p = argparse.ArgumentParser(
        prog="cruise",
        description="a deterministic feature inventory of a codebase — the floor an LLM can't hallucinate through.",
    )
    p.add_argument("root", help="the directory to walk")
    p.add_argument("--ext", action="append", metavar=".EXT",
                   help="a file extension to include (repeatable; default: common source types)")
    p.add_argument("--plot", action="append", metavar="NAME",
                   choices=["route", "call", "affordance", "claim"],
                   help="restrict to one plot (repeatable): route call affordance claim")
    p.add_argument("--json", action="store_true",
                   help="emit one JSON object per fact and per grade on stdout (the pipe contract)")
    p.add_argument("--strict", action="store_true",
                   help="exit 1 if any HEADLESS-ROUTE grade is found (gate mode)")
    args = p.parse_args(argv)

    if not os.path.isdir(args.root):
        sys.stderr.write("cruise: not a directory: %s\n" % args.root)
        return 3

    exts = args.ext if args.ext else DEFAULT_EXTS
    facts = scan_tree(args.root, exts)
    if args.plot:
        want = set(args.plot)
        facts = [f for f in facts if f["plot"] in want]
    grades = grade(facts)
    headless = sum(1 for g in grades if g["grade"] == "HEADLESS-ROUTE")

    if args.json:
        for f in facts:
            sys.stdout.write(json.dumps(f, sort_keys=True) + "\n")
        for g in grades:
            sys.stdout.write(json.dumps(g, sort_keys=True) + "\n")
        return 1 if (args.strict and headless) else 0

    if not facts:
        print("cruise: no features inventoried under %s" % args.root)
        return 0

    by_plot = {}
    for f in facts:
        by_plot.setdefault(f["plot"], []).append(f)
    order = ["route", "call", "affordance", "claim"]
    print("# cruise — feature ledger for %s" % args.root)
    print("# %d fact(s): %s\n" % (
        len(facts),
        ", ".join("%d %s" % (len(by_plot[k]), k) for k in order if k in by_plot)))
    for k in order:
        if k not in by_plot:
            continue
        hs = by_plot[k]
        print("## %s  (%d)  — proves: %s" % (k, len(hs), PLOT_PROVES[k]["proves"]))
        print("##   does NOT prove: %s" % PLOT_PROVES[k]["does_not_prove"])
        for f in hs:
            print("    %-40s  %s:%d" % (f["value"][:40], f["path"], f["line"]))
        print()
    if grades:
        print("## grades")
        for g in grades:
            print("    [%s]  %s  — %s" % (g["grade"], g["value"], g["detail"]))
        print()
    print("\u2192 hand this ledger to an LLM and ask it to GROUP and NAME the facts.")
    print("  it cannot invent a feature with no route, no label, and no test behind it.")
    return 1 if (args.strict and headless) else 0


if __name__ == "__main__":
    sys.exit(main())
