#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""
typecheck — validate a composition before you run it.

You have a pipeline in mind: A | B | C. Before you run it, this tells you —
decidably, with no side effects — whether it typechecks: does each stage EMIT
what the next one ACCEPTS. It catches "you piped a sink into a transform" at
declare-time, as a clear per-hop verdict, instead of as a confusing runtime
error three stages deep.

THE TYPE MODEL (flat, five verbs)
    source    ∅ -> JSONL      emits, never accepts   (ignores stdin)
    transform JSONL -> JSONL   emits and accepts
    filter    JSONL -> JSONL'  emits and accepts
    fold      JSONL -> agg     emits and accepts
    sink      JSONL -> ∅       accepts, never emits   (no pipeable stdout)

THE GATE (decidable, total)
    A can feed B  iff  EMITS(A) and ACCEPTS(B)
    EMITS(v)   = v != "sink"       (a sink produces no pipeable stdout)
    ACCEPTS(v) = v != "source"     (a source ignores its stdin)
Plus the endpoint rule: a mid-pipeline stage that does not ACCEPT (a source in
a non-first position) is an error — it ignores the stream handed to it; and a
mid-pipeline stage that does not EMIT (a sink before the end) is an error — it
swallows the stream the downstream stage needs.

WHAT THIS IS A STRIP OF
    An internal tree-spec validator (AGPL-3.0) carried a subtype relation `<:` +
    type lattice + conformance check (conformsTo, seeded FLAT: SUBTYPE_EDGES={},
    so it is nominal equality on day one) and an emit/accept edge-compatibility
    gate. This gift keeps conformsTo as the flat lattice SEAM — a
    future variance edge slots into SUBTYPE_EDGES without rewriting the gate —
    and keeps the emit/accept gate, applied to the ADJACENT pairs of one linear
    pipeline (the walk A->B->C) rather than to a whole DAG. Re-licensed MIT,
    stdlib-only (the ancestor's yaml dep and tree-YAML machinery are dropped).
    It re-states the ~3-line gate rather than importing `map`: gifts are
    standalone — pipes all the way down, MIT, zero-dep — so they never import
    each other; the canonical port-verb roster keeps them consistent.

WHAT IT DELIBERATELY DOES NOT DO (the honesty flag — a build requirement)
    typecheck validates the PORT type, NOT the record shape. An {event}-emitting
    stage piped into a {file}-expecting stage typechecks CLEAN here and still
    fails at runtime, because the ports agree (both JSONL) even though the
    records don't fit. The ancestor's V17/V18 schema-affinity heuristic (which
    only ever WARNed) is exactly that record-shape layer, and it is DROPPED on
    purpose: this gift claims port-compatibility and flags record-shape as
    UNPROVEN — it never asserts semantic fit.

USAGE
    typecheck check --pipeline A,B,C --manifest gifts-manifest.json
        Walk the declared pipeline; per-hop verdict JSONL + a summary line.
        Exit 3 if any hop (or endpoint) is bad, 0 if the whole pipeline is clean.
    typecheck text  --pipeline A,B,C --manifest gifts-manifest.json
        The same check, human-readable.
    typecheck --port
        Print typecheck's own port-verb (filter) as one JSON-line and exit.
    typecheck --selftest
        Run the built-in checks and exit 0/1.

The manifest is any JSON list of entries (or an object with a
'gifts'/'tools'/'entries' list); each entry carries a 'slug' and a 'port_verb'
— the same shape `map` and `port` read. A slug named in the pipeline but absent
from the manifest, or present with no valid port_verb, is reported as
UNRESOLVED and fails the check — never guessed.
"""
import argparse
import json
import sys

VALID_VERBS = {"source", "transform", "filter", "fold", "sink"}

# -------------------------------------------------------------------
# THE SUBTYPE RELATION (<:), seeded FLAT — the kept lattice seam.
# Zero edges at seed, so conformsTo is bit-for-bit nominal equality on day one.
# Variance is added LATER by adding edges here — never by rewriting the gate.
# -------------------------------------------------------------------
SUBTYPE_EDGES = {}  # requiredVerb -> set(subVerbs). EMPTY at seed (discrete order).


def subtypes(required):
    """Declared subtypes of `required`. Empty at seed."""
    return SUBTYPE_EDGES.get(required, set())


def conformsTo(candidate, required):
    """Total, decidable subtype operator. At seed (no edges) this is exactly
    nominal equality:
        required == ""                  -> True   (no constraint)
        candidate == required           -> True   (nominal match)
        candidate in subtypes(required) -> True   (lattice edge; none at seed)
    """
    if required == "":
        return True
    if candidate == required:
        return True
    return candidate in subtypes(required)


def EMITS(v):
    """A stage produces pipeable stdout iff it is not a sink."""
    return v != "sink"


def ACCEPTS(v):
    """A stage consumes stdin iff it is not a source."""
    return v != "source"


def load_verbs(path):
    """Return {slug: port_verb} for every manifest entry with a valid port_verb.

    Accepts a bare JSON list of entries or an object with a
    'gifts'/'tools'/'entries' list. Raises ValueError if no entry list can be
    found — never guesses the shape. An entry with no valid port_verb is simply
    absent from the map, so a pipeline naming it reports UNRESOLVED.
    """
    with open(path) as f:
        data = json.load(f)
    if isinstance(data, list):
        entries = data
    elif isinstance(data, dict):
        entries = None
        for k in ("gifts", "tools", "entries"):
            if isinstance(data.get(k), list):
                entries = data[k]
                break
        if entries is None:
            raise ValueError(f"{path}: no entry list ('gifts'/'tools'/'entries') found")
    else:
        raise ValueError(f"{path}: not a JSON list or object")

    verbs = {}
    for e in entries:
        slug = e.get("slug")
        pv = e.get("port_verb")
        if pv in VALID_VERBS:
            verbs[slug] = pv
    return verbs


def typecheck_pipeline(pipeline, verbs):
    """Walk a declared pipeline and check every adjacent pair + the endpoints.

    pipeline : ordered list of slugs [A, B, C]
    verbs    : {slug: port_verb} resolved from the manifest

    Returns (hops, ok):
      hops : list of per-hop verdict dicts, in pipeline order. Two kinds:
             - {"kind": "stage", ...}  one per stage: its resolved verb, its
               endpoint role, and whether that role is valid at its position.
             - {"kind": "hop", ...}    one per adjacent pair (A->B): the gate.
      ok   : True iff every stage resolved AND every endpoint role is valid AND
             every hop passes the emit/accept gate.
    """
    n = len(pipeline)
    hops = []
    ok = True

    # Resolve every stage first; an unresolved stage is a hard fail (never guessed).
    resolved = []
    for i, slug in enumerate(pipeline):
        verb = verbs.get(slug)
        pos = "first" if i == 0 else ("last" if i == n - 1 else "middle")
        if verb is None:
            ok = False
            hops.append({
                "kind": "stage", "pos": i, "slug": slug, "verb": None,
                "role": pos, "role_ok": False,
                "reason": "UNRESOLVED — slug not in manifest, or no valid port_verb; not guessed",
            })
            resolved.append(None)
            continue

        # Endpoint rule. A stage in a non-first position must ACCEPT (else it
        # ignores the stream handed to it); a stage in a non-last position must
        # EMIT (else it swallows the stream the next stage needs).
        role_ok = True
        reason = "ok"
        if pos in ("middle", "last") and not ACCEPTS(verb):
            role_ok = False
            reason = f"a {verb} accepts no stdin, but it is not the first stage — it would ignore its input"
        if pos in ("first", "middle") and not EMITS(verb):
            role_ok = False
            reason = f"a {verb} emits no stdout, but it is not the last stage — downstream gets nothing"
        if not role_ok:
            ok = False
        hops.append({
            "kind": "stage", "pos": i, "slug": slug, "verb": verb,
            "role": pos, "role_ok": role_ok, "reason": reason,
        })
        resolved.append(verb)

    # The gate on each adjacent pair.
    for i in range(n - 1):
        a_slug, b_slug = pipeline[i], pipeline[i + 1]
        a_verb, b_verb = resolved[i], resolved[i + 1]
        if a_verb is None or b_verb is None:
            hops.append({
                "kind": "hop", "pos": i, "from": a_slug, "to": b_slug,
                "from_verb": a_verb, "to_verb": b_verb,
                "typechecks": False,
                "reason": "UNRESOLVED — one endpoint has no resolved port_verb",
            })
            ok = False
            continue
        emits = EMITS(a_verb)
        accepts = ACCEPTS(b_verb)
        passes = emits and accepts
        if not passes:
            ok = False
        if not emits:
            reason = f"{a_slug} is a {a_verb} — it emits no stdout, so {b_slug} has nothing to read"
        elif not accepts:
            reason = f"{b_slug} is a {b_verb} — it ignores stdin, so {a_slug}'s output is dropped"
        else:
            reason = "ok — emitter feeds an acceptor (TYPE gate only; record shape unproven)"
        hops.append({
            "kind": "hop", "pos": i, "from": a_slug, "to": b_slug,
            "from_verb": a_verb, "to_verb": b_verb,
            "typechecks": passes, "reason": reason,
        })

    return hops, ok


SEMANTIC_FLAG = (
    "UNPROVEN — typecheck validates the PORT type (can the pipe carry data), "
    "NOT the RECORD shape. A pipeline can typecheck clean here and still fail at "
    "runtime because the records don't fit. That semantic layer is a finer "
    "question the uniform JSONL type cannot settle, and this gift never asserts it."
)


def summary_record(pipeline, hops, ok):
    bad_hops = [h for h in hops if h["kind"] == "hop" and not h["typechecks"]]
    bad_stages = [h for h in hops if h["kind"] == "stage" and not h["role_ok"]]
    return {
        "kind": "summary",
        "pipeline": list(pipeline),
        "stages": len(pipeline),
        "hops": sum(1 for h in hops if h["kind"] == "hop"),
        "typechecks": ok,
        "bad_hops": len(bad_hops),
        "bad_stages": len(bad_stages),
        "semantic_layer": SEMANTIC_FLAG,
    }


def emit_jsonl(pipeline, hops, ok, out):
    for h in hops:
        out.write(json.dumps(h) + "\n")
    out.write(json.dumps(summary_record(pipeline, hops, ok)) + "\n")


def emit_text(pipeline, hops, ok, out):
    out.write("typecheck — " + " -> ".join(pipeline) + "\n")
    out.write("=" * 56 + "\n")
    for h in hops:
        if h["kind"] == "stage":
            mark = "  " if h["role_ok"] else "!!"
            verb = h["verb"] if h["verb"] is not None else "?"
            out.write(f"{mark} stage {h['pos']}: {h['slug']} [{verb}] ({h['role']}) — {h['reason']}\n")
        else:
            mark = "ok" if h["typechecks"] else "XX"
            out.write(f"{mark} hop   {h['from']} -> {h['to']}  "
                      f"[{h['from_verb']} -> {h['to_verb']}] — {h['reason']}\n")
    out.write("-" * 56 + "\n")
    out.write(f"RESULT: {'TYPECHECKS' if ok else 'DOES NOT TYPECHECK'}\n")
    out.write("\nNOTE: this is the TYPE-level check. Record-shape fit is UNPROVEN —\n")
    out.write("a clean result means the ports agree, not that the records fit.\n")


def parse_pipeline(s):
    parts = [p.strip() for p in s.split(",")]
    parts = [p for p in parts if p]
    if len(parts) < 2:
        raise ValueError("a pipeline needs at least two stages (A,B)")
    return parts


def _selftest():
    # A tiny fixed manifest covering all five verbs.
    verbs = {
        "src":  "source",
        "xf":   "transform",
        "flt":  "filter",
        "fold": "fold",
        "snk":  "sink",
    }
    checks = []

    # 1. A clean pipeline: source -> transform -> sink.
    hops, ok = typecheck_pipeline(["src", "xf", "snk"], verbs)
    checks.append(("clean src->xf->snk typechecks", ok is True))

    # 2. A sink in the middle must fail (it emits nothing downstream).
    hops, ok = typecheck_pipeline(["src", "snk", "xf"], verbs)
    checks.append(("sink-in-middle fails", ok is False))

    # 3. A source in the middle must fail (it ignores its stdin).
    hops, ok = typecheck_pipeline(["src", "src", "snk"], verbs)
    checks.append(("source-in-middle fails", ok is False))

    # 4. The bad HOP is identified: src -> snk is fine, snk -> xf is the break.
    hops, ok = typecheck_pipeline(["src", "snk", "xf"], verbs)
    bad = [h for h in hops if h["kind"] == "hop" and not h["typechecks"]]
    checks.append(("bad hop is snk->xf", len(bad) == 1 and bad[0]["from"] == "snk" and bad[0]["to"] == "xf"))

    # 5. An unresolved slug fails and is never guessed.
    hops, ok = typecheck_pipeline(["src", "ghost", "snk"], verbs)
    stage = [h for h in hops if h["kind"] == "stage" and h["slug"] == "ghost"][0]
    checks.append(("unresolved slug fails, verb is None", ok is False and stage["verb"] is None))

    # 6. transform->filter->fold is all-middle-legal and clean.
    hops, ok = typecheck_pipeline(["xf", "flt", "fold"], verbs)
    checks.append(("xf->flt->fold typechecks", ok is True))

    # 6a. The stage-role verdict is isolated (not just the aggregate): a sink in
    # the middle sets role_ok False on that stage (endpoint EMITS rule).
    hops, ok = typecheck_pipeline(["src", "snk", "xf"], verbs)
    snk_stage = [h for h in hops if h["kind"] == "stage" and h["slug"] == "snk"][0]
    checks.append(("sink-middle stage role_ok False", snk_stage["role_ok"] is False))

    # 6b. A hop bad ONLY on the accept side (xf -> src) fails the gate — pins the
    # ACCEPTS conjunct independently of the emit side.
    hops, ok = typecheck_pipeline(["xf", "src", "snk"], verbs)
    accept_hop = [h for h in hops if h["kind"] == "hop" and h["from"] == "xf" and h["to"] == "src"][0]
    checks.append(("accept-only-bad hop xf->src fails", accept_hop["typechecks"] is False))

    # 7. conformsTo is nominal equality at seed (flat lattice).
    checks.append(("conformsTo flat: transform~transform, not transform~filter",
                   conformsTo("transform", "transform") and not conformsTo("filter", "transform")))

    # 8. conformsTo empty-required is the no-constraint path.
    checks.append(("conformsTo empty-required is True", conformsTo("anything", "") is True))

    passed = sum(1 for _, ok_ in checks if ok_)
    for name, ok_ in checks:
        print(f"  {'PASS' if ok_ else 'FAIL'}  {name}")
    print(f"{passed}/{len(checks)} checks passed")
    return passed == len(checks)


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Validate a declared gift pipeline before you run it — the TYPE gate, not the record shape."
    )
    ap.add_argument("--port", action="store_true", help="print typecheck's own port-verb (filter) and exit")
    ap.add_argument("--selftest", action="store_true", help="run built-in checks and exit")
    sub = ap.add_subparsers(dest="cmd")
    for name in ("check", "text"):
        p = sub.add_parser(name)
        p.add_argument("--pipeline", required=True, help="comma-separated slugs, e.g. gitlog,vclock,cairn")
        p.add_argument("--manifest", required=True, help="path to the gifts manifest JSON")
    args = ap.parse_args(argv)

    if args.port:
        print(json.dumps({"slug": "typecheck", "port_verb": "filter"}))
        return 0

    if args.selftest:
        return 0 if _selftest() else 1

    if args.cmd not in ("check", "text"):
        ap.print_help()
        return 2

    try:
        pipeline = parse_pipeline(args.pipeline)
        verbs = load_verbs(args.manifest)
    except (ValueError, OSError, json.JSONDecodeError) as e:
        sys.stderr.write(f"typecheck: {e}\n")
        return 2

    hops, ok = typecheck_pipeline(pipeline, verbs)
    if args.cmd == "check":
        emit_jsonl(pipeline, hops, ok, sys.stdout)
    else:
        emit_text(pipeline, hops, ok, sys.stdout)
    return 0 if ok else 3


if __name__ == "__main__":
    sys.exit(main())
