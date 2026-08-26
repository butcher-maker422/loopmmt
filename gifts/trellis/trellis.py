#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# SPDX-License-Identifier: CC-BY-NC-4.0
"""
The Trellis -- a 2-D consistency localizer + generator.
Loop MMT(tm) - Phase 1 of the Trellis V1 plan (S12.1337 -> built S12.1423).

WHAT IT IS (honest claim, post-teardown A1)
  A double word square laid over system objects: every cell sits in exactly two
  orthogonal words (its ROW and its COLUMN). The whole holds iff every row reads
  valid AND every column reads valid. Constraint propagation (arc-consistency,
  AC-3) sorts every open cell into exactly one verdict, and any inconsistency
  localizes to the single cell where the failing row crosses the failing column.

  It is a *consistency localizer + generator*, NOT a global-consistency prover
  (A1): a *detected* break localizes uniquely; *silence* is necessary-not-
  sufficient (the rectangular alias -- co-drift that leaves every row and column
  valid is, by construction, a different valid square and is invisible). State
  the bound; do not oversell.

THE THREE VERDICTS (per open cell)
  FORCED <v>     one value satisfies both crossing words  -> derive it (no choice)
  FREE   {set}   several satisfy both                     -> bounded search = slack
  CONTRADICTORY  none satisfies both                      -> dead cell, called loud + located
  (A fixed cell that violates its words is also CONTRADICTORY -- fixed != skipped.)

CONSTRAINT TYPES (V1 -- decidable facets only: versions, hashes, lease-state, letters)
  equal     : every cell on the line must be equal. With a spec-level
              `reference_col`, non-reference cells must equal the reference
              cell -> an equality break localizes to the single deviating cell
              (the product-code property: failing row x off-canonical col).
  wordlist  : the line's cells, read in order, must form one of a list of
              allowed words/tuples (the literal crossword / allowed-combos case).

FAIL-CLOSED (A5): any CONTRADICTORY cell -> overall verdict CONTRADICTORY and a
  non-zero exit (3). FREE picks are reported + counted; there is no ungraded
  override. A spec error fails closed too (exit 2), never silently "consistent".

DETERMINISM: the `result` object on stdout is a pure function of the spec --
  fold the same spec twice, get byte-identical bytes (sorted keys, sorted sets,
  no timestamps in the result). The append-only proof chain (--log) carries a
  timestamp for provenance and is a side effect, never part of the result bytes.

FACET-AUDIT (A4 -- Test by Removal): `audit` drops each constraint in turn and
  re-solves. A constraint whose removal changes the result is ACTIVE (unique
  work in this spec); otherwise REDUNDANT (its work is shared by others).
  REDUNDANT is not a defect -- a double word square is over-determined by
  design, and that overlap IS the product code's error-correction power. The
  real A4 failure is a Trellis with NO ACTIVE AXIS (every constraint passes
  trivially -> it can never carry a catch, e.g. a version-only square that reads
  v36==v36 everywhere and goes blind). That, and only that, is REJECTED.

FIVE RULES (ecosystem tool): single file - one command - zero external deps
  (stdlib only) - JSON storage - append-only proof chain.

USAGE
  trellis.py solve <spec.json> [--log]      # solve/check a square
  trellis.py audit <spec.json>              # Test-by-Removal on every constraint
  trellis.py verify-chain <chain.jsonl>     # re-walk a --log proof chain (Pull R5)
  exit 0 = held (consistent / all open cells FORCED|FREE) -- or a clean proof chain
  exit 3 = CONTRADICTORY (held-fail, localized) -- or a DETECTED proof-chain break (located)
  exit 2 = spec error / unreadable proof chain (fail-closed) -- never silently "consistent"
"""

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

RUNS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_runs")

# ----------------------------------------------------------------------------- 
# spec model
# -----------------------------------------------------------------------------

def _cellkey(r, c):
    return "%s|%s" % (r, c)


def load_spec(path):
    with open(path, "r", encoding="utf-8") as fh:
        spec = json.load(fh)
    return validate_spec(spec)


def validate_spec(spec):
    """Structural validation -- fail closed (raise) on any malformed spec."""
    if not isinstance(spec, dict):
        raise SpecError("spec must be a JSON object")
    for key in ("rows", "cols"):
        if key not in spec or not isinstance(spec[key], list) or not spec[key]:
            raise SpecError("spec.%s must be a non-empty list" % key)
    rows = [str(r) for r in spec["rows"]]
    cols = [str(c) for c in spec["cols"]]
    if len(set(rows)) != len(rows):
        raise SpecError("duplicate row id")
    if len(set(cols)) != len(cols):
        raise SpecError("duplicate col id")
    cells = spec.get("cells", {})
    if not isinstance(cells, dict):
        raise SpecError("spec.cells must be an object")
    valid_keys = {_cellkey(r, c) for r in rows for c in cols}
    for k in cells:
        if k not in valid_keys:
            raise SpecError("cell key %r is not a row|col of this square" % k)
    ref = spec.get("reference_col")
    if ref is not None and str(ref) not in cols:
        raise SpecError("reference_col %r is not a column" % ref)
    rc = spec.get("row_constraints", {})
    cc = spec.get("col_constraints", {})
    if not isinstance(rc, dict) or not isinstance(cc, dict):
        raise SpecError("row_constraints/col_constraints must be objects")
    for line_id, con in list(rc.items()) + list(cc.items()):
        _validate_constraint(line_id, con)
    spec["rows"], spec["cols"] = rows, cols
    if ref is not None:
        spec["reference_col"] = str(ref)
    return spec


def _validate_constraint(line_id, con):
    if not isinstance(con, dict) or "type" not in con:
        raise SpecError("constraint on %r needs a type" % line_id)
    t = con["type"]
    if t == "equal":
        return
    if t == "wordlist":
        words = con.get("words")
        if not isinstance(words, list) or not words:
            raise SpecError("wordlist on %r needs a non-empty words list" % line_id)
        for w in words:
            if not isinstance(w, list):
                raise SpecError("each word on %r must be a list (a tuple of cell values)" % line_id)
        return
    raise SpecError("unknown constraint type %r on %r" % (t, line_id))


class ChainError(Exception):
    """The proof-chain artifact could not be read/verified at all (fail-closed, exit 2).
    Distinct from a *detected break* in a readable chain (exit 3) -- 'cannot read' is
    never a pass."""
    pass


class SpecError(Exception):
    pass


# ----------------------------------------------------------------------------- 
# domains + lines
# -----------------------------------------------------------------------------

def init_domains(spec):
    """cellkey -> sorted list of candidate values.
    fixed cell  -> singleton {value}; open cell -> the global/per-axis domain."""
    rows, cols = spec["rows"], spec["cols"]
    cells = spec.get("cells", {})
    gdomain = spec.get("domain")  # optional global open-cell domain
    domains = {}
    for r in rows:
        for c in cols:
            k = _cellkey(r, c)
            if k in cells and cells[k] is not None:
                domains[k] = [cells[k]]
            else:
                if gdomain is None:
                    # open cell with no domain -> derive domain from the union of
                    # values that any wordlist on its lines permits at its slot;
                    # if it has only `equal` lines and no global domain, that is a
                    # spec gap -> fail closed.
                    dom = _derived_open_domain(spec, r, c)
                    if dom is None:
                        raise SpecError(
                            "open cell %s has no domain (no global `domain`, no wordlist on "
                            "its row or column)" % k)
                    domains[k] = sorted(dom, key=_skey)
                else:
                    domains[k] = sorted(list(gdomain), key=_skey)
    return domains


def _derived_open_domain(spec, r, c):
    """Union of slot-values a wordlist on this cell's row or column allows."""
    vals = set()
    found = False
    rc = spec.get("row_constraints", {}).get(r)
    if rc and rc.get("type") == "wordlist":
        idx = spec["cols"].index(c)
        for w in rc["words"]:
            if idx < len(w):
                vals.add(w[idx]); found = True
    cc = spec.get("col_constraints", {}).get(c)
    if cc and cc.get("type") == "wordlist":
        idx = spec["rows"].index(r)
        for w in cc["words"]:
            if idx < len(w):
                vals.add(w[idx]); found = True
    return vals if found else None


def _skey(v):
    """Stable sort key across heterogeneous JSON scalars."""
    return (type(v).__name__, v if isinstance(v, (int, float)) else json.dumps(v, sort_keys=True))


def row_cells(spec, r):
    return [_cellkey(r, c) for c in spec["cols"]]


def col_cells(spec, c):
    return [_cellkey(r, c) for r in spec["rows"]]


# ----------------------------------------------------------------------------- 
# arc-consistency (AC-3)
# -----------------------------------------------------------------------------

def _supported_wordlist(value, idx, line_keys, domains, words):
    """value at position idx is supported iff some allowed word places `value`
    at idx and every other position is still achievable in its cell's domain."""
    for w in words:
        if idx >= len(w) or w[idx] != value:
            continue
        ok = True
        for j, k in enumerate(line_keys):
            if j == idx:
                continue
            if j >= len(w) or w[j] not in domains[k]:
                ok = False
                break
        if ok:
            return True
    return False


def arc_consistency(spec):
    """Run AC-3 to a fixpoint. Returns (domains, trace) where trace maps a
    cellkey that emptied -> {'axis','line','reason'} naming the constraint that
    killed it (the localization witness)."""
    domains = init_domains(spec)
    ref = spec.get("reference_col")
    rcons = spec.get("row_constraints", {})
    ccons = spec.get("col_constraints", {})
    trace = {}

    # Build the arc worklist: (cell, axis, line_id). A cell is revised against
    # each constraint it participates in.
    def lines_for(k):
        r, c = k.split("|", 1)
        out = []
        if r in rcons:
            out.append(("row", r))
        if c in ccons:
            out.append(("col", c))
        return out

    work = []
    for r in spec["rows"]:
        for c in spec["cols"]:
            k = _cellkey(r, c)
            for axis, line in lines_for(k):
                work.append((k, axis, line))

    # deterministic order
    work.sort()
    qi = 0
    # use an index-based queue but re-add neighbours on change
    queue = list(work)
    while queue:
        k, axis, line = queue.pop(0)
        if not domains[k]:
            continue  # already dead
        changed, killed = _revise(spec, domains, ref, k, axis, line, rcons, ccons)
        if killed and k not in trace:
            trace[k] = killed
        if changed:
            # re-enqueue every other cell that shares a line with k
            r, c = k.split("|", 1)
            neighbours = set()
            if r in rcons or True:
                for cc in spec["cols"]:
                    nk = _cellkey(r, cc)
                    if nk != k:
                        for ax, ln in lines_for(nk):
                            neighbours.add((nk, ax, ln))
            for rr in spec["rows"]:
                nk = _cellkey(rr, c)
                if nk != k:
                    for ax, ln in lines_for(nk):
                        neighbours.add((nk, ax, ln))
            for item in sorted(neighbours):
                queue.append(item)
    return domains, trace


def _revise(spec, domains, ref, k, axis, line, rcons, ccons):
    """Prune domain[k] against one constraint. Returns (changed, killed_info)."""
    r, c = k.split("|", 1)
    con = rcons[line] if axis == "row" else ccons[line]
    before = list(domains[k])
    keep = []

    if con["type"] == "equal":
        line_keys = row_cells(spec, line) if axis == "row" else col_cells(spec, line)
        if axis == "row" and ref is not None:
            ref_key = _cellkey(line, ref)
            if k == ref_key:
                keep = list(before)  # reference defers to no one
            else:
                ref_dom = domains[ref_key]
                keep = [v for v in before if v in ref_dom]
        else:
            # plain mutual equality: v survives iff every line-mate can still take v
            for v in before:
                ok = True
                for nk in line_keys:
                    if nk == k:
                        continue
                    if v not in domains[nk]:
                        ok = False
                        break
                if ok:
                    keep.append(v)
    elif con["type"] == "wordlist":
        line_keys = row_cells(spec, line) if axis == "row" else col_cells(spec, line)
        idx = line_keys.index(k)
        keep = [v for v in before if _supported_wordlist(v, idx, line_keys, domains, con["words"])]

    changed = len(keep) != len(before)
    domains[k] = keep
    killed = None
    if not keep:
        killed = {
            "axis": axis,
            "line": line,
            "type": con["type"],
            "lost": before,
            "reason": _kill_reason(spec, domains, ref, k, axis, line, con, before),
        }
    return changed, killed


def _kill_reason(spec, domains, ref, k, axis, line, con, before):
    r, c = k.split("|", 1)
    if con["type"] == "equal":
        if axis == "row" and ref is not None and c != ref:
            ref_key = _cellkey(line, ref)
            rv = domains[ref_key][0] if domains[ref_key] else "<empty>"
            mine = before[0] if len(before) == 1 else before
            return ("row %r requires equality to reference col %r (=%r); this cell holds %r"
                    % (line, ref, rv, mine))
        return "%s %r requires all cells equal; this cell could not agree" % (axis, line)
    return "%s %r (wordlist) admits no value for this cell consistent with its crossing word" % (axis, line)


# ----------------------------------------------------------------------------- 
# classify + localize
# -----------------------------------------------------------------------------

def classify(spec, domains):
    rows, cols = spec["rows"], spec["cols"]
    cells = spec.get("cells", {})
    out = {}
    for r in rows:
        for c in cols:
            k = _cellkey(r, c)
            dom = domains[k]
            fixed = k in cells and cells[k] is not None
            if len(dom) == 0:
                out[k] = {"verdict": "CONTRADICTORY"}
            elif len(dom) == 1:
                if fixed:
                    out[k] = {"verdict": "CONSISTENT", "value": dom[0]}
                else:
                    out[k] = {"verdict": "FORCED", "value": dom[0]}
            else:
                out[k] = {"verdict": "FREE", "domain": sorted(dom, key=_skey)}
    return out


def localize(spec, domains, trace):
    """For every CONTRADICTORY cell, name the crossing -- (row R x col C) plus
    BOTH failing words (the row-word and the col-word)."""
    rcons = spec.get("row_constraints", {})
    ccons = spec.get("col_constraints", {})
    out = []
    for r in spec["rows"]:
        for c in spec["cols"]:
            k = _cellkey(r, c)
            if domains[k]:
                continue
            killed = trace.get(k, {})
            row_word = _word_render(spec, "row", r, rcons.get(r))
            col_word = _word_render(spec, "col", c, ccons.get(c))
            out.append({
                "cell": k,
                "row": r,
                "col": c,
                "killed_by": {kk: killed[kk] for kk in ("axis", "line", "type") if kk in killed},
                "reason": killed.get("reason", "no support under its crossing words"),
                "row_word": row_word,
                "col_word": col_word,
            })
    out.sort(key=lambda d: (d["row"], d["col"]))
    return out


def _word_render(spec, axis, line, con):
    if con is None:
        return {"line": line, "type": None, "note": "no constraint on this %s (advisory)" % axis}
    if con["type"] == "equal":
        ref = spec.get("reference_col")
        d = {"line": line, "type": "equal"}
        if axis == "row" and ref is not None:
            d["reference_col"] = ref
        return d
    return {"line": line, "type": "wordlist", "n_words": len(con["words"])}


# ----------------------------------------------------------------------------- 
# solve + result
# -----------------------------------------------------------------------------

def solve(spec):
    """Pure function of the spec. Returns the deterministic result object."""
    domains, trace = arc_consistency(spec)
    cells = classify(spec, domains)
    contradictions = localize(spec, domains, trace)
    counts = {"FORCED": 0, "FREE": 0, "CONTRADICTORY": 0, "CONSISTENT": 0}
    for v in cells.values():
        counts[v["verdict"]] += 1
    held = counts["CONTRADICTORY"] == 0
    result = {
        "name": spec.get("name", "<unnamed>"),
        "rows": spec["rows"],
        "cols": spec["cols"],
        "reference_col": spec.get("reference_col"),
        "verdict": "HELD" if held else "CONTRADICTORY",
        "counts": counts,
        "cells": cells,
        "contradictions": contradictions,
        "free_picks": sorted(
            [k for k, v in cells.items() if v["verdict"] == "FREE"]),
        "spec_sha256": spec_sha(spec),
    }
    return result


def spec_sha(spec):
    payload = {k: spec[k] for k in spec if not k.startswith("_")}
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def result_bytes(result):
    """Canonical, deterministic serialization of a result (the byte-truth)."""
    return json.dumps(result, sort_keys=True, ensure_ascii=False, indent=2).encode("utf-8")


# ----------------------------------------------------------------------------- 
# facet audit -- Test by Removal (A4)
# -----------------------------------------------------------------------------

def facet_audit(spec):
    """Test by Removal (A4). Drop each constraint in turn and re-solve; a
    constraint whose removal changes the result is ACTIVE (it does unique work
    in this spec), otherwise REDUNDANT (its work is also done by other
    constraints).

    REDUNDANT is NOT a defect: a double word square is over-determined by
    design, and that redundancy IS the error-correction / localization power of
    a product code. The genuine A4 failure -- the false-comfort axis Phase 0
    named -- is a Trellis with NO ACTIVE AXIS: every constraint passes trivially
    and removing any changes nothing, so it can never carry a catch (a
    version-only Trellis reads v36==v36 everywhere and goes blind). That, and
    only that, is REJECTED here.

    BOUND (do not oversell): Test-by-Removal sees only the PRESENT constraints.
    It tells you which present facets carry the catch (ACTIVE) vs are redundant
    (REDUNDANT) against a spec that contains a real deviation -- it CANNOT detect
    a *missing* facet (the catch you never modelled). And on a fully-pinned,
    fully-consistent square there is no slack and no break, so every axis is
    trivially redundant -> REJECT fires benignly. Run the audit on a spec with a
    present deviation or open cells for it to mean what it says.
    """
    base = solve(spec)
    base_sig = _result_sig(base)
    findings = []
    rcons = spec.get("row_constraints", {})
    ccons = spec.get("col_constraints", {})
    for axis, cons in (("row", rcons), ("col", ccons)):
        for line in sorted(cons):
            trial = json.loads(json.dumps({k: spec[k] for k in spec if not k.startswith("_")}))
            key = "row_constraints" if axis == "row" else "col_constraints"
            trial[key] = dict(trial.get(key, {}))
            trial[key].pop(line, None)
            try:
                tspec = validate_spec(trial)
                tres = solve(tspec)
                changed = sorted(_result_diff(base, tres))
                active = base_sig != _result_sig(tres)
            except SpecError as e:
                # removing it makes the spec ill-formed (an open cell loses its
                # only domain source) -> it WAS doing work.
                changed = ["<spec-gap:%s>" % e]
                active = True
            findings.append({
                "axis": axis,
                "line": line,
                "type": cons[line].get("type"),
                "active": active,
                "changed_if_removed": changed,
            })
    active_axes = [f for f in findings if f["active"]]
    redundant = [f for f in findings if not f["active"]]
    no_active = len(active_axes) == 0 and len(findings) > 0
    return {
        "name": spec.get("name", "<unnamed>"),
        "verdict": "REJECT-NO-ACTIVE-AXIS" if no_active else "OK",
        "active_count": len(active_axes),
        "redundant_count": len(redundant),
        "redundant": [{"axis": f["axis"], "line": f["line"]} for f in redundant],
        "findings": findings,
    }


def _result_sig(result):
    """A hashable signature of the result's solution content (no spec_sha)."""
    return json.dumps(
        {"cells": result["cells"], "contradictions": result["contradictions"]},
        sort_keys=True, ensure_ascii=False)


def _result_diff(a, b):
    """Cell keys whose verdict/value/domain differs between two results."""
    out = set()
    keys = set(a["cells"]) | set(b["cells"])
    for k in keys:
        if a["cells"].get(k) != b["cells"].get(k):
            out.add(k)
    return out


# ----------------------------------------------------------------------------- 
# proof chain (append-only) -- a side effect, never part of the result bytes
# -----------------------------------------------------------------------------

def log_run(result, spec_name):
    os.makedirs(RUNS_DIR, exist_ok=True)
    safe = "".join(ch if (ch.isalnum() or ch in "-_.") else "_" for ch in spec_name)[:80] or "run"
    path = os.path.join(RUNS_DIR, safe + ".jsonl")
    prev = "0" * 64
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            lines = [ln for ln in fh if ln.strip()]
        if lines:
            try:
                prev = json.loads(lines[-1])["sha256"]
            except Exception:
                prev = "0" * 64
    event = {
        "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "spec_sha256": result["spec_sha256"],
        "verdict": result["verdict"],
        "counts": result["counts"],
        "contradiction_cells": [c["cell"] for c in result["contradictions"]],
        "prev_sha256": prev,
    }
    event["sha256"] = hashlib.sha256(
        (prev + json.dumps(event, sort_keys=True, ensure_ascii=False)).encode("utf-8")
    ).hexdigest()
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(event, sort_keys=True, ensure_ascii=False) + "\n")
    return path


# ----------------------------------------------------------------------------- 
# CLI
# -----------------------------------------------------------------------------

def verify_chain(path):
    """Re-walk an append-only proof chain (as written by `solve --log`) and verify,
    for every record in order: (1) the link is continuous (this record's prev_sha256
    equals the previous record's sha256; genesis prev = 64 zeros), and (2) the record
    is intact (recomputing the hash exactly as log_run wrote it -- sha256 over
    prev_sha256 + the record's other fields, sorted -- reproduces the stored sha256).

    Returns (ok: bool, n_records: int, problem: str | None).
      - A clean chain returns (True, n, None) -- silent-ok.
      - A *detected* break returns (False, idx, located-reason) -- the caller exits 3, loud.
    Raises ChainError when the artifact cannot be read at all (missing / empty) -- the
    caller exits 2. 'Cannot verify' is never a pass: a localizer that stays silent on a
    chain it could not read would be the exact A1 oversell the Trellis refuses."""
    if not os.path.exists(path):
        raise ChainError("no such chain file: %s" % path)
    with open(path, "r", encoding="utf-8") as fh:
        raw = [ln for ln in fh if ln.strip()]
    if not raw:
        raise ChainError("empty chain (0 records) at %s -- nothing to verify" % path)
    prev = "0" * 64
    for i, ln in enumerate(raw):
        try:
            ev = json.loads(ln)
        except ValueError as e:
            # a corrupted/truncated record is a *detected* break, not a can't-read:
            # the chain was readable to here and is broken at record i.
            return (False, i, "record %d: malformed JSON (chain corrupt): %s" % (i, e))
        if not isinstance(ev, dict) or "sha256" not in ev or "prev_sha256" not in ev:
            return (False, i, "record %d: missing sha256/prev_sha256 (chain corrupt)" % i)
        if ev["prev_sha256"] != prev:
            return (False, i, "record %d: BROKEN LINK -- prev_sha256 %s.. does not chain "
                    "to the previous record's hash %s.." % (i, ev["prev_sha256"][:12], prev[:12]))
        body = {k: v for k, v in ev.items() if k != "sha256"}
        recomputed = hashlib.sha256(
            (ev["prev_sha256"] + json.dumps(body, sort_keys=True, ensure_ascii=False)).encode("utf-8")
        ).hexdigest()
        if recomputed != ev["sha256"]:
            return (False, i, "record %d: HASH MISMATCH (record tampered) -- stored %s.. "
                    "but its contents hash to %s.." % (i, ev["sha256"][:12], recomputed[:12]))
        prev = ev["sha256"]
    return (True, len(raw), None)


def _render_human(result):
    lines = []
    v = result["verdict"]
    mark = "HELD" if v == "HELD" else ">>> CONTRADICTORY <<<"
    lines.append("Trellis: %s  [%s]" % (result["name"], mark))
    cnt = result["counts"]
    lines.append("  cells: FORCED=%d FREE=%d CONTRADICTORY=%d CONSISTENT=%d"
                 % (cnt["FORCED"], cnt["FREE"], cnt["CONTRADICTORY"], cnt["CONSISTENT"]))
    for fk in result["free_picks"]:
        dom = result["cells"][fk]["domain"]
        lines.append("  FREE   %s -> {%s}" % (fk, ", ".join(str(x) for x in dom)))
    for c in result["contradictions"]:
        lines.append("  >>> CONTRADICTORY at cell (%s x %s):" % (c["row"], c["col"]))
        lines.append("        %s" % c["reason"])
        lines.append("        failing row-word: %s   |   failing col-word: %s"
                     % (json.dumps(c["row_word"], sort_keys=True),
                        json.dumps(c["col_word"], sort_keys=True)))
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="trellis.py", description="The Trellis -- 2-D consistency localizer + generator")
    sub = ap.add_subparsers(dest="cmd")
    ps = sub.add_parser("solve", help="solve/check a square")
    ps.add_argument("spec")
    ps.add_argument("--log", action="store_true", help="append to the proof chain")
    ps.add_argument("--json", action="store_true", help="emit the raw result JSON")
    pa = sub.add_parser("audit", help="Test-by-Removal on every constraint (A4)")
    pa.add_argument("spec")
    pa.add_argument("--json", action="store_true")
    pv = sub.add_parser("verify-chain", help="re-walk a --log proof chain; loud + located on a break (Pull R5)")
    pv.add_argument("chain", help="path to the proof chain .jsonl (as written by `solve --log` under _runs/)")
    args = ap.parse_args(argv)

    if args.cmd == "solve":
        try:
            spec = load_spec(args.spec)
        except SpecError as e:
            sys.stderr.write("SPEC ERROR (fail-closed): %s\n" % e)
            return 2
        except (OSError, ValueError) as e:
            sys.stderr.write("SPEC ERROR (fail-closed): %s\n" % e)
            return 2
        result = solve(spec)
        if args.log:
            log_run(result, result["name"])
        if args.json:
            sys.stdout.buffer.write(result_bytes(result) + b"\n")
        else:
            print(_render_human(result))
        return 3 if result["verdict"] == "CONTRADICTORY" else 0

    if args.cmd == "audit":
        try:
            spec = load_spec(args.spec)
        except SpecError as e:
            sys.stderr.write("SPEC ERROR (fail-closed): %s\n" % e)
            return 2
        audit = facet_audit(spec)
        if args.json:
            sys.stdout.buffer.write(
                json.dumps(audit, sort_keys=True, ensure_ascii=False, indent=2).encode("utf-8") + b"\n")
        else:
            ok = audit["verdict"] == "OK"
            head = ("OK -- %d active / %d redundant" % (audit["active_count"], audit["redundant_count"])
                    if ok else ">>> REJECT: no active axis (carries no catch -- A4) <<<")
            print("Facet audit: %s  [%s]" % (audit["name"], head))
            for f in audit["findings"]:
                tag = "ACTIVE" if f["active"] else "redundant"
                print("  %-4s %-24s %-9s %s" % (f["axis"], f["line"], f["type"], tag))
            if audit["redundant_count"] and ok:
                print("  (redundant != defect: in a product code the overlap IS the error-correction power)")
        return 0 if audit["verdict"] == "OK" else 3

    if args.cmd == "verify-chain":
        try:
            ok, n, problem = verify_chain(args.chain)
        except ChainError as e:
            sys.stderr.write("CHAIN ERROR (fail-closed): %s\n" % e)
            return 2
        except (OSError, ValueError) as e:
            sys.stderr.write("CHAIN ERROR (fail-closed): %s\n" % e)
            return 2
        if ok:
            print("Proof chain OK: %s  [%d record%s -- links + hashes verified]"
                  % (args.chain, n, "" if n == 1 else "s"))
            return 0
        sys.stderr.write(">>> PROOF CHAIN BROKEN <<<\n        %s\n" % problem)
        return 3

    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
