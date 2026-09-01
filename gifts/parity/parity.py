#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""parity.py — compare N sibling things against a shared checklist.

Give it several things that are *supposed* to match — three services that should
all expose the same endpoints, four config files that should carry the same keys,
five components that should each implement the same set of features — and parity
folds them into one table: rows are the checklist items, columns are the things,
each cell says HAS or LACKS. The rows where they *don't* all agree fall out for
free as the gap list, which is the whole reason you ran it.

WHAT IT IS, HONESTLY
--------------------
parity reads a small JSON description of your things and the marks each one
declares, and it joins them on a **normalized key** so trivial spelling
differences (``Compose`` / ``compose`` / ``compose-btn``) collapse to one row
instead of three. The checklist is not hand-kept: it is the **union of every mark
any thing declares**, so a capability that exists on even one thing becomes a row,
and the things that lack it show up LACKS in that row. That is the gap you came
for.

THE ONE HONEST LIMIT, TYPED INTO THE OUTPUT
-------------------------------------------
HAS means exactly one thing: *a mark that normalizes to this key was declared for
this thing.* It does **not** mean the feature works, or behaves the same as the
next column's. parity is a **presence** fold, not a behavior test — every cell
carries that in ``predicate: "declared-present"`` so a fact copied out of the
table still says what it does and does not establish. A row where two or more
things HAS is flagged ``needs-behavior-check`` — a *candidate* for you to verify,
never a claim that they match.

PURE FOLD
---------
Deterministic order, no wall-clock: fold twice, the bytes are identical
(``--check``, exit 3 on drift). Rows sort by key, columns by declared order then
name, so the table is stable across runs and machines.

Exit codes (the fold-family contract):
  0  folded (and with --check, byte-identical to the input's own re-fold)
  2  usage / input error (bad path, malformed JSON, no things)
  3  --check drift (the output would not reproduce), or an empty checklist

INPUT SHAPE (a small JSON file, or stdin with ``-``)
----------------------------------------------------
    {
      "things": [
        {"name": "mail",     "marks": ["compose", "search", "archive"]},
        {"name": "calendar", "marks": ["compose", "search"]},
        {"name": "contacts", "marks": ["search", "Compose"]}
      ],
      "aliases": {"create": "compose", "new": "compose"}
    }

``aliases`` is optional: it maps an alternate spelling to a canonical key BEFORE
normalization, so genuine synonyms (``create`` → ``compose``) collapse too. An
alias whose target is never declared by any thing is a dead alias and fails the
non-vacuity gate (exit 3) — a checklist keyed on an invented item is worthless.
"""
import argparse
import json
import re
import sys

_WS = re.compile(r"[\s_-]+")


def norm(mark):
    """Collapse an INTRA-name variant to a comparison key.

    Lowercase, strip a trailing role suffix (``-btn`` / ``_button`` etc. via the
    separator split), and squeeze whitespace/underscore/hyphen runs to a single
    space. ``Compose`` / ``compose`` / ``compose-btn`` -> ``compose``. Deliberately
    dumb: it collapses spelling, never meaning (meaning is what ``aliases`` is for).
    """
    s = str(mark).strip().lower()
    # drop a common trailing UI-role suffix so 'compose-btn' keys as 'compose'
    s = re.sub(r"[\s_-](btn|button|link|icon|field|input)$", "", s)
    s = _WS.sub(" ", s).strip()
    return s


def _apply_aliases(key, alias_index):
    """Map a canonical-key through the alias table (one hop, INTER-name synonyms)."""
    return alias_index.get(key, key)


def fold(spec):
    """The parity fold. spec -> a deterministic matrix dict. Pure; no I/O.

    Raises ValueError on an empty thing-set, a dead alias, or an empty checklist —
    each the caller turns into the right exit code.
    """
    things = spec.get("things") or []
    if not things:
        raise ValueError("no things to compare (need >= 1 in 'things')")

    # aliases: alt-spelling -> canonical, both normalized. Dead-alias gate below.
    raw_aliases = spec.get("aliases") or {}
    alias_index = {norm(k): norm(v) for k, v in raw_aliases.items()}

    # Column order: declared order first (stable), name as the tiebreak.
    columns = []
    seen_cols = set()
    for t in things:
        name = str(t.get("name", "")).strip()
        if not name:
            raise ValueError("a thing has no 'name'")
        if name in seen_cols:
            raise ValueError("duplicate thing name: %r" % name)
        seen_cols.add(name)
        columns.append(name)

    # Build each thing's declared key-set, alias-mapped.
    declared = {}  # name -> set(keys)
    all_keys = set()
    alias_targets_hit = set()
    for t in things:
        name = str(t.get("name", "")).strip()
        keys = set()
        for m in (t.get("marks") or []):
            k0 = norm(m)
            k = _apply_aliases(k0, alias_index)
            if k != k0:
                alias_targets_hit.add(k0)  # the alternate spelling was used
            keys.add(k)
        declared[name] = keys
        all_keys |= keys

    # Non-vacuity gate: every alias must have fired on some declared mark, and its
    # target must exist in the checklist. A dead alias means the checklist is keyed
    # on something nobody declared.
    for alt, target in alias_index.items():
        if alt not in alias_targets_hit:
            raise ValueError("dead alias %r: never matched any declared mark" % alt)
        if target not in all_keys:
            raise ValueError(
                "dead alias target %r: not declared by any thing" % target
            )

    if not all_keys:
        raise ValueError("empty checklist: no marks declared by any thing")

    # The checklist rows, sorted (deterministic).
    rows = []
    for key in sorted(all_keys):
        cells = []
        has_count = 0
        for name in columns:
            present = key in declared[name]
            if present:
                has_count += 1
            cells.append(
                {
                    "thing": name,
                    "state": "HAS" if present else "LACKS",
                    # the honest predicate travels WITH the cell (findings discipline)
                    "predicate": "declared-present",
                }
            )
        uniform = has_count == 0 or has_count == len(columns)
        row = {
            "key": key,
            "cells": cells,
            "has_count": has_count,
            "uniform": uniform,
        }
        # >=2 HAS on a non-uniform... actually behavior-check applies to ANY row
        # with >=2 HAS: they *look* shared but presence != behavior.
        if has_count >= 2:
            row["flag"] = "needs-behavior-check"
        rows.append(row)

    gaps = [r["key"] for r in rows if not r["uniform"]]

    return {
        "columns": columns,
        "checklist_size": len(rows),
        "rows": rows,
        "gaps": gaps,
        "uniform_all": len(gaps) == 0,
        "note": "HAS = a mark declared for this thing normalizes to this key; "
        "it does NOT assert the capability works or matches across columns.",
    }


def canonical(obj):
    """Stable JSON text for --check twice-identical + --json emit."""
    return json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def render_human(matrix):
    """A readable grid. Rows = checklist keys, columns = things. ✓ / · per cell."""
    cols = matrix["columns"]
    keywidth = max([len("capability")] + [len(r["key"]) for r in matrix["rows"]])
    colwidth = max([3] + [len(c) for c in cols])
    header = "  ".join([f"{'capability':<{keywidth}}"] + [f"{c:<{colwidth}}" for c in cols])
    lines = [header, "-" * len(header)]
    for r in matrix["rows"]:
        marks = []
        for cell in r["cells"]:
            marks.append(f"{('✓' if cell['state']=='HAS' else '·'):<{colwidth}}")
        flag = "  <- gap" if not r["uniform"] else ""
        lines.append("  ".join([f"{r['key']:<{keywidth}}"] + marks) + flag)
    lines.append("")
    if matrix["gaps"]:
        lines.append("gaps (things do not all agree): " + ", ".join(matrix["gaps"]))
    else:
        lines.append("no gaps: every thing declares every checklist item.")
    lines.append(matrix["note"])
    return "\n".join(lines) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Compare N sibling things against a shared checklist -> a "
        "HAS/LACKS parity matrix. Presence fold, not a behavior test."
    )
    ap.add_argument("input", help="JSON spec file, or '-' for stdin")
    ap.add_argument("--json", action="store_true", help="emit the matrix as JSON")
    ap.add_argument(
        "--check",
        action="store_true",
        help="fold twice; exit 3 unless byte-identical (drift gate)",
    )
    ap.add_argument(
        "--gaps-only",
        action="store_true",
        help="print only the gap keys (rows where things disagree), one per line",
    )
    args = ap.parse_args(argv)

    try:
        if args.input == "-":
            spec = json.load(sys.stdin)
        else:
            with open(args.input, encoding="utf-8") as fh:
                spec = json.load(fh)
    except (OSError, json.JSONDecodeError) as e:
        sys.stderr.write("input error: %s\n" % e)
        return 2

    try:
        matrix = fold(spec)
    except ValueError as e:
        # empty checklist / dead alias -> fold-family exit 3; structural input
        # problems (no things, no name) -> exit 2.
        msg = str(e)
        if "checklist" in msg or "alias" in msg:
            sys.stderr.write("fold gate: %s\n" % msg)
            return 3
        sys.stderr.write("input error: %s\n" % msg)
        return 2

    if args.check:
        # A fold is a fold: re-fold the same spec, require byte-identical canonical.
        again = fold(spec)
        if canonical(again) != canonical(matrix):
            sys.stderr.write("--check drift: the fold did not reproduce\n")
            return 3
        sys.stdout.write("check: OK (fold is twice-identical)\n")
        return 0

    if args.gaps_only:
        sys.stdout.write("".join(k + "\n" for k in matrix["gaps"]))
        return 0

    if args.json:
        sys.stdout.write(canonical(matrix))
    else:
        sys.stdout.write(render_human(matrix))
    return 0


if __name__ == "__main__":
    sys.exit(main())
