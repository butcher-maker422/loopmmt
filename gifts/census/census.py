#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""census.py — walk a tree, find your markers, and say which ones are BURIED.

You leave markers in a codebase all the time: TODO, FIXME, "you write this", a
tag that says a section is a stub. A visual pass catches the ones you can see.
The dangerous one is the marker **buried inside a comment** — it never renders,
so scanning the file by eye sails right past it. Census walks a file tree, finds
every marker you name, and for each one says whether it sits in **visible** text
or is **buried** inside a comment. The buried ones are the report: those are the
spots a human pass will miss.

It is deliberately dumb about *meaning* — a marker is a marker. What it is precise
about is **visibility**: does this thing render where a person would see it, or is
it hidden in a `<!-- -->` / `/* */` / `#` comment where only a grep will find it.

    python3 census.py <tree-root> [options]

By default it looks for `TODO`, `FIXME`, `XXX`, `HACK`, and `STUB` in the common
source extensions. Point it at your own markers with `--marker` (repeatable) and
your own file types with `--ext`.

------------------------------------------------------------------------------
The JSON-lines contract (so this composes in a pipe):
  `--json` emits ONE JSON object per hit on stdout —
     {"path","line","marker","visible":true|false,"excerpt"}
  so you can pipe the census into the next tool (count them, filter to buried,
  feed the paths onward). Without `--json` it prints a grouped human report.

Exit codes:
    0   ran clean (hits or none — a census is a report, not a gate)
    1   at least one BURIED marker AND --strict was given (gate mode)
    3   usage / unreadable root
"""

import argparse
import json
import os
import re
import sys

DEFAULT_MARKERS = ["TODO", "FIXME", "XXX", "HACK", "STUB"]
DEFAULT_EXTS = [
    ".py", ".js", ".cjs", ".mjs", ".ts", ".jsx", ".tsx",
    ".c", ".h", ".cpp", ".cc", ".java", ".go", ".rs", ".rb",
    ".html", ".htm", ".css", ".md", ".sh", ".yaml", ".yml",
]

# Comment spans, by the syntaxes that actually bury text. These cover the vast
# majority of source files without a per-language parser (which would be the wrong
# amount of machinery for "is this in a comment").
#
# GIFT-012: the openers are recognised by a SINGLE-PASS, STRING-AWARE scanner, not
# by raw regexes. The old regexes (`#[^\n]*`, `//[^\n]*`) matched a comment opener
# even INSIDE a string literal, so `label = "widget # TODO"` or `url = "http://x/TODO"`
# opened a false comment span and a LIVE marker read as buried-in-a-comment — the
# exact inversion census exists to catch. The scanner walks the text once, tracking
# whether it is inside a quote ('...' "..." `...`, with \ escapes); a comment opener
# is only honoured OUTSIDE a string. It is quote-state + comment-state, NOT a parser.
_LINE_OPENERS = ("//", "#")               # run to end of line
_BLOCK_OPENERS = (("<!--", "-->"), ("/*", "*/"))  # run to their closer
_QUOTES = ("'", '"', "`")


def _comment_spans(text):
    spans = []
    i, n = 0, len(text)
    in_str = None  # the open quote char, or None when outside any string
    while i < n:
        ch = text[i]
        if in_str is not None:
            # inside a string: consume escapes, look only for the matching close
            if ch == "\\":
                i += 2
                continue
            if ch == in_str:
                in_str = None
            i += 1
            continue
        # not in a string — a block comment opener?
        matched = False
        for open_tok, close_tok in _BLOCK_OPENERS:
            if text.startswith(open_tok, i):
                end = text.find(close_tok, i + len(open_tok))
                end = (end + len(close_tok)) if end != -1 else n
                spans.append((i, end))
                i = end
                matched = True
                break
        if matched:
            continue
        # a line comment opener?
        for open_tok in _LINE_OPENERS:
            if text.startswith(open_tok, i):
                end = text.find("\n", i)
                end = end if end != -1 else n
                spans.append((i, end))
                i = end
                matched = True
                break
        if matched:
            continue
        # a quote opening a string region?
        if ch in _QUOTES:
            in_str = ch
        i += 1
    return spans


def _buried(pos, spans):
    for a, b in spans:
        if a <= pos < b:
            return True
    return False


def _line_index(text):
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


def scan_file(path, markers, word_boundary):
    """Return list of {line, marker, visible, excerpt} for one file."""
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    except OSError:
        return []
    spans = _comment_spans(text)
    starts = _line_index(text)
    hits = []
    seen = set()  # (line, marker) — one hit per marker per line
    for marker in markers:
        pat = r"\b" + re.escape(marker) + r"\b" if word_boundary else re.escape(marker)
        for m in re.finditer(pat, text, re.IGNORECASE):
            ln = _lineno(m.start(), starts)
            key = (ln, marker.lower())
            if key in seen:
                continue
            seen.add(key)
            excerpt = text[starts[ln - 1]:].split("\n", 1)[0].strip()
            if len(excerpt) > 110:
                excerpt = excerpt[:107] + "..."
            hits.append({
                "line": ln,
                "marker": marker,
                "visible": not _buried(m.start(), spans),
                "excerpt": excerpt,
            })
    hits.sort(key=lambda h: h["line"])
    return hits


def scan_tree(root, markers, exts, word_boundary):
    exts_l = tuple(e.lower() for e in exts)
    out = []
    for dp, dns, fns in os.walk(root):
        # never descend into VCS / dependency dirs
        for skip in (".git", "node_modules", ".hg", ".svn", "__pycache__"):
            if skip in dns:
                dns.remove(skip)
        for fn in sorted(fns):
            if fn.lower().endswith(exts_l):
                full = os.path.join(dp, fn)
                for h in scan_file(full, markers, word_boundary):
                    h = dict(h)
                    h["path"] = os.path.relpath(full, root)
                    out.append(h)
    return out


def main(argv=None):
    p = argparse.ArgumentParser(
        prog="census",
        description="walk a tree, find your markers, say which are buried in comments.",
    )
    p.add_argument("root", help="the directory to walk")
    p.add_argument("--marker", action="append", metavar="TEXT",
                   help="a marker to look for (repeatable; default: TODO FIXME XXX HACK STUB)")
    p.add_argument("--ext", action="append", metavar=".EXT",
                   help="a file extension to include (repeatable; default: common source types)")
    p.add_argument("--no-word-boundary", action="store_true",
                   help="match a marker as a raw substring, not a whole word "
                        "(needed for glyph/punctuation markers like '<!--WRITE-->')")
    p.add_argument("--buried-only", action="store_true",
                   help="report only markers buried in comments (the miss-risk set)")
    p.add_argument("--json", action="store_true",
                   help="emit one JSON object per hit on stdout (the pipe contract)")
    p.add_argument("--strict", action="store_true",
                   help="exit 1 if any buried marker is found (gate mode)")
    args = p.parse_args(argv)

    if not os.path.isdir(args.root):
        sys.stderr.write("census: not a directory: %s\n" % args.root)
        return 3

    markers = args.marker if args.marker else DEFAULT_MARKERS
    exts = args.ext if args.ext else DEFAULT_EXTS
    word_boundary = not args.no_word_boundary

    hits = scan_tree(args.root, markers, exts, word_boundary)
    if args.buried_only:
        hits = [h for h in hits if not h["visible"]]

    buried = sum(1 for h in hits if not h["visible"])

    if args.json:
        for h in hits:
            sys.stdout.write(json.dumps({
                "path": h["path"], "line": h["line"], "marker": h["marker"],
                "visible": h["visible"], "excerpt": h["excerpt"],
            }, sort_keys=True) + "\n")
        return 1 if (args.strict and buried) else 0

    if not hits:
        print("census: no markers found under %s" % args.root)
        return 0

    by_path = {}
    for h in hits:
        by_path.setdefault(h["path"], []).append(h)
    print("# census — %d marker(s) across %d file(s)  (%d buried in comments)\n"
          % (len(hits), len(by_path), buried))
    for path in sorted(by_path):
        hs = by_path[path]
        nb = sum(1 for h in hs if not h["visible"])
        flag = "  \u26a0 %d BURIED" % nb if nb else ""
        print("## %s  (%d marker%s)%s" % (path, len(hs), "" if len(hs) == 1 else "s", flag))
        for h in hs:
            tag = "buried " if not h["visible"] else "visible"
            print("    L%4d  [%s]  %s  %s" % (h["line"], tag, h["marker"], h["excerpt"]))
        print()
    if buried:
        print("\u2192 %d marker(s) are BURIED in comments \u2014 a visual pass will miss them." % buried)
    else:
        print("\u2192 every marker is in visible text \u2014 nothing is buried.")
    return 1 if (args.strict and buried) else 0


if __name__ == "__main__":
    sys.exit(main())
