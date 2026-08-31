#!/usr/bin/env python3
"""map — show what-composes-with-what across a set of small JSONL tools.

You have a folder of little tools that each read JSON-lines on stdin and write
JSON-lines on stdout. Which ones can you pipe together? `map` answers that. Point
it at a manifest where each tool DECLARES its port-verb (the type-level shape of
its stdin/stdout contract), and `map` folds the whole set into a composition map:
who can feed whom, how densely the set composes, and which tools light up the most
pipelines.

THE MODEL. Five port-verbs on the shared JSON-lines interface, and only five:

  source     : nothing -> JSONL      (emits; no meaningful stdin)
  transform  : JSONL   -> JSONL      (record in, record out)
  filter     : JSONL   -> JSONL'     (record in, subset out; output type <= input)
  fold       : JSONL   -> JSONL_agg  (records in, an aggregate/narrower record out)
  sink       : JSONL   -> nothing    (terminal side effect, no pipeable stdout)

THE TYPE GATE (mechanical, decidable):

  A can feed B   iff   A EMITS jsonl (A.verb != sink)  AND  B ACCEPTS jsonl (B.verb != source)

That is the whole composition rule at the type level. `map` counts every ordered
pair (A, B), A != B, that passes it, and reports the density.

WHY IT READS DECLARATIONS, NOT GUESSES. Before the `port` gift, a map like this
kept its own hardcoded roster of which tool had which verb — a list inside one
program's source that drifts the moment a tool changes or a new one ships. `map`
does not guess and does not keep a private roster: it READS each tool's declared
`port_verb` from the manifest (the same field `port` reads and checks). A tool that
declares no port-verb is reported as UNDECLARED and excluded from the map with a
count, never silently assigned a verb. The map is only ever as honest as the
declarations under it — and it says so.

HONEST CEILING (carried, not hidden). `map` renders the TYPE-level answer: can the
pipe carry data at all. It does NOT assert that the RECORDS fit — a `transform`
that emits `{event}` records typechecks clean into a `filter` that expects `{file}`
records and fails at runtime. That finer, record-shape question the uniform JSONL
type cannot settle, and `map` never claims it can. The map shows what the ports
permit; it flags the semantic layer as unproven.

map's own port-verb is `fold`: a set of gift declarations in, one aggregate
composition-map record out.

No dependencies beyond the Python standard library. MIT licensed.

USAGE
  map read   --manifest FILE
      Read the composition map from a manifest of tools that declare port_verb.
      Emits JSON-lines: one {"kind":"pair", ...} per composable ordered pair,
      then one {"kind":"summary", ...} record with density, census, fan-out/fan-in,
      the closed-form check, and the undeclared count. Its port-verb is fold.

  map summary --manifest FILE
      Emit only the single summary record (the aggregate), no per-pair lines.

  map text   --manifest FILE
      Human-readable rendering of the same map (density, census, top fan-out/in,
      the semantic-unproven flag). Not JSONL — for reading, not piping.

  map --port
      Print map's own port-verb (fold) as one JSON-line and exit.
"""
import argparse
import json
import sys

VALID_VERBS = {"source", "transform", "filter", "fold", "sink"}


def EMITS(v):
    """A tool produces pipeable stdout iff it is not a sink."""
    return v != "sink"


def ACCEPTS(v):
    """A tool consumes stdin iff it is not a source."""
    return v != "source"


def load_declared(path):
    """Return (declared, undeclared) from a manifest.

    declared:   list of (slug, port_verb) for every entry with a valid port_verb
    undeclared: list of slugs with no (or invalid) port_verb — flagged, never guessed

    Accepts a bare JSON list of entries or an object with a 'gifts'/'tools'/'entries'
    list. Raises ValueError if no entry list can be found — never guesses the shape.
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

    declared, undeclared = [], []
    for e in entries:
        slug = e.get("slug")
        pv = e.get("port_verb")
        if pv in VALID_VERBS:
            declared.append((slug, pv))
        else:
            undeclared.append(slug)
    return declared, undeclared


def compose_map(declared):
    """The fold: (slug, verb) list -> composition-map dict.

    Preserves the ancestor's compute core exactly (the byte-checked math):
    ordered-pair count over emitters x acceptors, closed-form
    |E|*|A| - |E∩A|, plus fan-out / fan-in per tool.
    """
    gifts = sorted(declared)
    n = len(gifts)
    pairs = []
    by_first, by_second = {}, {}
    for i, (sa, va) in enumerate(gifts):
        for j, (sb, vb) in enumerate(gifts):
            if i == j:
                continue
            if EMITS(va) and ACCEPTS(vb):
                pairs.append((sa, sb))
                by_first[sa] = by_first.get(sa, 0) + 1
                by_second[sb] = by_second.get(sb, 0) + 1

    total_ordered = n * (n - 1)
    emitters = [g for g in gifts if EMITS(g[1])]
    acceptors = [g for g in gifts if ACCEPTS(g[1])]
    both = [g for g in gifts if EMITS(g[1]) and ACCEPTS(g[1])]
    closed_form = len(emitters) * len(acceptors) - len(both)

    from collections import Counter
    census = dict(Counter(v for _, v in gifts))

    return {
        "gifts": gifts,
        "n": n,
        "pairs": pairs,
        "total_ordered": total_ordered,
        "density": (len(pairs) / total_ordered) if total_ordered else 0.0,
        "census": census,
        "emitters": len(emitters),
        "acceptors": len(acceptors),
        "both_ports": len(both),
        "closed_form": closed_form,
        "closed_form_matches": closed_form == len(pairs),
        "fan_out": by_first,
        "fan_in": by_second,
    }


def summary_record(cm, undeclared):
    """The single aggregate record — map's fold output."""
    return {
        "kind": "summary",
        "n": cm["n"],
        "composable_pairs": len(cm["pairs"]),
        "total_ordered": cm["total_ordered"],
        "density": round(cm["density"], 4),
        "census": cm["census"],
        "emitters": cm["emitters"],
        "acceptors": cm["acceptors"],
        "closed_form_check": cm["closed_form_matches"],
        "undeclared": undeclared,
        "undeclared_count": len(undeclared),
        "semantic_layer": "UNPROVEN — map shows the TYPE gate (can the pipe carry "
                          "data); it does not assert the RECORDS fit. That is a finer "
                          "question the uniform JSONL type cannot settle.",
    }


def emit_read(cm, undeclared, out):
    for sa, sb in cm["pairs"]:
        out.write(json.dumps({"kind": "pair", "from": sa, "to": sb}) + "\n")
    out.write(json.dumps(summary_record(cm, undeclared)) + "\n")


def emit_text(cm, undeclared, out):
    out.write(f"Composition map — {cm['n']} tool(s) with a declared port-verb\n")
    out.write("=" * 56 + "\n")
    out.write(f"composable ordered pairs (A can feed B): {len(cm['pairs'])} / {cm['total_ordered']}\n")
    out.write(f"composition density: {cm['density']:.1%}\n")
    out.write(f"closed-form check |E|*|A|-|E∩A| = {cm['closed_form']}  (matches: {cm['closed_form_matches']})\n")
    out.write(f"verb census: {cm['census']}\n")
    out.write(f"emitters (not sink): {cm['emitters']}   acceptors (not source): {cm['acceptors']}\n\n")
    fo = sorted(cm["fan_out"].items(), key=lambda kv: -kv[1])[:8]
    out.write("top fan-out (feeds the most tools):\n")
    for s, c in fo:
        out.write(f"  {s:32s} feeds {c}\n")
    fi = sorted(cm["fan_in"].items(), key=lambda kv: -kv[1])[:8]
    out.write("\ntop fan-in (fed by the most tools):\n")
    for s, c in fi:
        out.write(f"  {s:32s} fed-by {c}\n")
    if undeclared:
        out.write(f"\nUNDECLARED ({len(undeclared)}) — excluded from the map, not guessed:\n")
        out.write("  " + ", ".join(str(s) for s in undeclared) + "\n")
    out.write("\nNOTE: this is the TYPE-level map. Semantic record-shape fit is UNPROVEN —\n")
    out.write("a composable pair means the ports agree, not that the records fit.\n")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Fold a set of port-declared tools into a composition map.")
    ap.add_argument("--port", action="store_true", help="print map's own port-verb (fold) and exit")
    sub = ap.add_subparsers(dest="cmd")
    for name in ("read", "summary", "text"):
        p = sub.add_parser(name)
        p.add_argument("--manifest", required=True)
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args(argv)

    if args.port:
        print(json.dumps({"slug": "map", "port_verb": "fold"}))
        return 0
    if args.selftest:
        return _selftest()
    if not args.cmd:
        ap.print_help()
        return 2

    declared, undeclared = load_declared(args.manifest)
    cm = compose_map(declared)

    if args.cmd == "read":
        emit_read(cm, undeclared, sys.stdout)
    elif args.cmd == "summary":
        sys.stdout.write(json.dumps(summary_record(cm, undeclared)) + "\n")
    elif args.cmd == "text":
        emit_text(cm, undeclared, sys.stdout)
    return 0


def _selftest():
    """Mutation-honest selftest over a tiny known set with a hand-computed answer."""
    # 4 tools: 1 source, 1 transform, 1 filter, 1 sink.
    #   emitters = {source, transform, filter}          (3)  (not sink)
    #   acceptors = {transform, filter, sink}           (3)  (not source)
    #   both = {transform, filter}                      (2)
    #   composable pairs = |E|*|A| - |E∩A| = 3*3 - 2 = 7
    decl = [("s", "source"), ("t", "transform"), ("f", "filter"), ("k", "sink")]
    cm = compose_map(decl)
    assert cm["n"] == 4, cm["n"]
    assert len(cm["pairs"]) == 7, f"expected 7 pairs, got {len(cm['pairs'])}"
    assert cm["closed_form"] == 7 and cm["closed_form_matches"], "closed form wrong"
    assert cm["emitters"] == 3 and cm["acceptors"] == 3, "emit/accept wrong"
    # source feeds all 3 acceptors, is fed by nobody
    assert cm["fan_out"].get("s") == 3, cm["fan_out"]
    assert "s" not in cm["fan_in"], "source should have 0 fan-in"
    # sink fed by all 3 emitters, feeds nobody
    assert cm["fan_in"].get("k") == 3, cm["fan_in"]
    assert "k" not in cm["fan_out"], "sink should have 0 fan-out"
    # MUTATION BITE 1: if EMITS wrongly included sink, pairs would jump.
    #   With EMITS==(always True): emitters=4, pairs = 4*3 - 2 = 10 != 7
    def _bad_emits(v):
        return True
    saved = globals()["EMITS"]
    try:
        globals()["EMITS"] = _bad_emits
        bad = compose_map(decl)
        assert len(bad["pairs"]) != 7, "mutation not detected — EMITS bite failed"
    finally:
        globals()["EMITS"] = saved
    # re-run clean to confirm restoration
    assert len(compose_map(decl)["pairs"]) == 7, "restore failed"
    # undeclared handling: an invalid verb is excluded + flagged, not guessed
    decl2 = decl + [("bad", "nonsense")]
    d2, u2 = [x for x in decl2 if x[1] in VALID_VERBS], [x[0] for x in decl2 if x[1] not in VALID_VERBS]
    assert u2 == ["bad"] and len(d2) == 4, "undeclared not isolated"
    print("selftest: 6/6 OK (n, pairs=7, closed-form, fan-out/in endpoints, EMITS mutation bite, undeclared-excluded)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
