#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""
ward — a self-verifying integrity badge that will not go solid on hope.

THE IDEA.
  A status badge is a grid of cells, one per claim you want to show as "done".
  The temptation with any badge is to colour a cell in because you BELIEVE the
  thing is finished. `ward` refuses to. A cell renders SOLID only when its claim
  is backed by a witness that actually agrees right now; any claim whose witness
  is missing, disagrees, or is malformed renders as a HOLLOW RING — never a
  silent solid. The badge's own honesty is the feature: you cannot make a cell
  lie by asserting harder.

  It is the badge-shaped sibling of a "status board that won't go green on hope":
  same principle (a claim needs a witness), rendered as a compact grid you can
  drop into a README, a terminal, or an HTML page.

WITNESS KINDS (per cell).
  file:PATH            solid iff PATH exists
  contains:PATH::TEXT  solid iff PATH exists AND contains TEXT
  cmd:SHELL            solid iff `SHELL` exits 0
  (no witness)         a cell with no witness is DECLARED-only -> renders as a
                       ring, because a claim with nothing beneath it is exactly
                       what this tool exists to expose.

THE COERCE WELD (the load-bearing honesty rule).
  Every cell state is routed through one gate: an unknown, missing, or errored
  witness result can only ever become a RING. There is no code path from a bad
  witness to a solid cell. That is what makes the badge trustworthy — not that
  it is always green, but that green always means something.

OUTPUT.
  --format text   a 3x3 (or NxM) grid of glyphs + a legend + a presence caveat
  --format html   an HTML fragment (cells carry data-state so you can style them)
  --format json   the resolved cells, for piping

EXIT CODES.
  0  every declared claim resolved SOLID (a fully-earned badge)
  1  at least one claim rendered as a RING (unearned) -- LOUD, by design
  2  usage / IO error

HONEST EDGE.
  `ward` checks that a witness EXISTS AND AGREES, never that it is the RIGHT
  witness. Point a cell at the wrong file and it will happily go solid — choosing
  a meaningful witness is your job. Presence is not proof of substance. Python
  stdlib only, offline, deterministic.
"""
import argparse
import json
import os
import subprocess
import sys
import html

RING = "ring"          # hollow — unearned; the only state a bad witness can reach
SOLID = "solid"        # filled — witness exists and agrees

_GLYPH = {SOLID: "\u25c9", RING: "\u25cb"}   # ◉ solid ring-dot / ○ hollow ring


def _resolve_witness(spec, root):
    """Return True (earn SOLID) only on a clean, agreeing witness. Any error,
    miss, or malformed spec returns False -> the coerce weld renders a RING.
    There is deliberately no path here that returns True on uncertainty."""
    if not spec:
        return False
    try:
        if spec.startswith("file:"):
            path = spec[len("file:"):]
            return os.path.exists(os.path.join(root, path))
        if spec.startswith("contains:"):
            body = spec[len("contains:"):]
            if "::" not in body:
                return False
            path, text = body.split("::", 1)
            full = os.path.join(root, path)
            if not os.path.exists(full):
                return False
            with open(full, encoding="utf-8", errors="replace") as fh:
                return text in fh.read()
        if spec.startswith("cmd:"):
            shell = spec[len("cmd:"):]
            r = subprocess.run(shell, shell=True, cwd=root,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return r.returncode == 0
    except Exception:
        return False   # the weld: any error is a RING, never a solid
    return False       # unknown witness kind -> RING


def resolve(cells, root):
    """cells: list of {label, witness}. Returns list of {label, state, witness}.
    The coerce weld lives here: state is SOLID iff the witness cleanly agreed."""
    out = []
    for c in cells:
        earned = _resolve_witness(c.get("witness", ""), root)
        out.append({
            "label": c.get("label", ""),
            "witness": c.get("witness", ""),
            "state": SOLID if earned else RING,
        })
    return out


def _grid(resolved, cols):
    rows = []
    for i in range(0, len(resolved), cols):
        rows.append(resolved[i:i + cols])
    return rows


def render_text(resolved, cols):
    lines = []
    for row in _grid(resolved, cols):
        lines.append("  " + "  ".join(_GLYPH[c["state"]] for c in row))
    legend = f"\n  {_GLYPH[SOLID]} earned (witness agrees)   {_GLYPH[RING]} unearned (ring \u2014 no green on hope)"
    caveat = "\n  note: a solid cell means its witness EXISTS AND AGREES, not that the witness is the RIGHT one."
    labels = "\n".join(
        f"  {_GLYPH[c['state']]} {c['label']}" + ("" if c["witness"] else "   [no witness \u2014 declared only]")
        for c in resolved
    )
    return "\n".join(lines) + "\n" + labels + legend + caveat


def render_html(resolved, cols):
    out = ['<div class="ward" role="img" aria-label="integrity badge">']
    for row in _grid(resolved, cols):
        out.append('  <div class="ward__row">')
        for c in row:
            out.append(
                f'    <span class="ward__cell" data-state="{c["state"]}" '
                f'title="{html.escape(str(c["label"]), quote=True)}">{_GLYPH[c["state"]]}</span>'
            )
        out.append('  </div>')
    out.append('  <p class="ward__caveat">A solid cell means its witness exists and agrees, '
               'never that the witness is the right one.</p>')
    out.append('</div>')
    return "\n".join(out)


def load_cells(path):
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    if isinstance(data, dict):
        data = data.get("cells", [])
    if not isinstance(data, list):
        raise ValueError("badge spec must be a list of cells, or {\"cells\": [...]}")
    return data


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]
    ap = argparse.ArgumentParser(
        prog="ward",
        description="A self-verifying integrity badge that will not go solid on hope.")
    ap.add_argument("spec", nargs="?", help="path to a JSON badge spec (list of {label, witness})")
    ap.add_argument("--root", default=".", help="root the witnesses resolve against (default: .)")
    ap.add_argument("--cols", type=int, default=3, help="grid columns (default: 3 -> a 3x3 ward)")
    ap.add_argument("--format", choices=("text", "html", "json"), default="text")
    ap.add_argument("--selftest", action="store_true", help="prove the coerce weld (no bad witness -> solid)")
    args = ap.parse_args(argv)

    if args.selftest:
        return _selftest()
    if not args.spec:
        ap.print_help()
        return 2
    try:
        cells = load_cells(args.spec)
    except Exception as e:
        print(f"ward: cannot read spec: {e}", file=sys.stderr)
        return 2

    resolved = resolve(cells, args.root)
    if args.format == "json":
        print(json.dumps(resolved, indent=2))
    elif args.format == "html":
        print(render_html(resolved, args.cols))
    else:
        print(render_text(resolved, args.cols))

    unearned = [c for c in resolved if c["state"] == RING]
    return 1 if unearned else 0


def _selftest():
    """Non-vacuity: the weld must hold. A missing file, a failing command, a
    malformed witness, and an absent witness must ALL render RING; only a real,
    agreeing witness earns SOLID."""
    import tempfile
    ok = True
    with tempfile.TemporaryDirectory() as d:
        with open(os.path.join(d, "present.txt"), "w") as f:
            f.write("the witness text is here")
        cases = [
            ("real file",            "file:present.txt",                  SOLID),
            ("missing file",         "file:nope.txt",                     RING),
            ("contains hit",         "contains:present.txt::witness",     SOLID),
            ("contains miss",        "contains:present.txt::absent",      RING),
            ("cmd pass",             "cmd:true",                          SOLID),
            ("cmd fail",             "cmd:false",                         RING),
            ("malformed contains",   "contains:present.txt",              RING),
            ("unknown kind",         "wat:present.txt",                   RING),
            ("no witness",           "",                                  RING),
        ]
        cells = [{"label": lbl, "witness": w} for lbl, w, _ in cases]
        resolved = resolve(cells, d)
        for (lbl, _w, want), got in zip(cases, resolved):
            good = got["state"] == want
            ok = ok and good
            print(f"  [selftest] {lbl:18s} -> {got['state']:5s} (want {want}) -> {'PASS' if good else 'FAIL'}")
    # the weld, stated as an assertion: NOTHING but a clean witness reaches SOLID
    print(f"\nward selftest: {'ALL PASS' if ok else 'FAILURE'} (the coerce weld holds)" if ok
          else "\nward selftest: FAILURE")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
