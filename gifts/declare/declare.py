#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""
declare — save a named, reusable pipeline as a "gift score".

You keep retyping the same chain of little JSONL tools: `gitlog | vclock | cairn`.
`declare` turns that ad-hoc shell pipe into a saved, named, shareable artifact —
a *score* — that you (or anyone you hand it to) can keep, read, and re-run later
instead of remembering the exact sequence. It is the one durable noun in the
compose set: `port` labels a tool, `map` shows what chains, `typecheck` checks a
chain, and `declare` writes a chain down so it survives the shell session.

WHAT A SCORE IS (a small, canonical JSON object)
    {
      "kind": "gift-score",
      "name": "commit-causality",
      "stages": ["gitlog", "vclock", "cairn"],
      "note": "git history -> causal order -> durable store"   (optional)
    }
    Just a name and an ordered list of gift slugs. No DAG, no branching, no
    executor — a linear pipeline, which is what a shell `A | B | C` actually is.
    (A future version could grow branches; the format leaves room, the seam is
    the `stages` list. Kept flat on purpose — the gift is the atom, not the IDE.)

WHAT THIS IS A STRIP OF
    An internal composition architecture (CC-BY-NC) frames saved composition
    trees as programs: apps are the instruction set, the tree is the machine, and
    a user wires apps into a graph they keep and re-run. This gift is the
    gift-scale strip of exactly that idea — "a saved composition is a program you
    keep" — reduced to its atom: a named LINEAR pipeline of standalone tools,
    minus the app-suite, the executor, and the DAG machinery. Net-new code
    (nothing is lifted), re-licensed MIT, standard library only.

DETERMINISTIC BY CONSTRUCTION
    The emitted score is a canonical fold of (name, stages, note): keys in a
    fixed order, `stages` in the order you gave them (never sorted — order is the
    pipeline), and `declare check` re-emits and byte-compares so a saved score
    can be proven current. Same score in, same bytes out, every time.

WHAT IT DELIBERATELY DOES NOT DO (the honesty boundary)
    declare SAVES a pipeline. It does not VALIDATE it and it does not RUN it.
      - It does not check that the stages typecheck (that a stage emits what the
        next accepts) — that is `typecheck`'s job; run `typecheck` on the score.
      - It does not execute the pipeline — that is a runner's job.
    declare will happily write down a score that does not typecheck; it makes no
    claim that a saved score is runnable, only that it is faithfully recorded.
    It does one honest structural check: every stage slug is non-empty and the
    score has at least one stage. It does NOT confirm the slugs name real tools
    (it has no manifest by default) — pass `--manifest` to have it flag any slug
    that is not a declared tool, still saving the score and flagging, never
    silently dropping.

USAGE
    declare write --name NAME --stages A,B,C [--note "..."] [--manifest F]
        Emit a canonical gift-score (JSON) on stdout. With --manifest, annotate
        any stage slug absent from the manifest as unknown (flagged, not dropped).
    declare check --score score.json
        Re-emit the score canonically and byte-compare against the file.
        Exit 0 if the file is already canonical, 3 if it differs (and print the
        canonical form), 2 on a malformed score.
    declare --port
        Print declare's own port-verb (source) as one JSON-line and exit.
    declare --selftest
        Run the built-in checks and exit 0/1.

The score is plain JSON: pipe it into `typecheck` via its stages, keep it in a
repo, hand it to a friend. It is yours the moment it is written down.
"""
import argparse
import json
import sys


VALID_VERBS = {"source", "transform", "filter", "fold", "sink"}


def canonical_score(name, stages, note=None):
    """The pure fold: (name, stages, note) -> a canonical score dict.

    Fixed key order, stages preserved in given order (never sorted — order IS
    the pipeline), note omitted when empty. Deterministic: same inputs, same
    dict, always.
    """
    score = {
        "kind": "gift-score",
        "name": name,
        "stages": list(stages),
    }
    if note:
        score["note"] = note
    return score


def score_to_bytes(score):
    """Canonical serialization — sort_keys False (we control order), stable
    separators, trailing newline. The byte form `check` compares against."""
    # Emit keys in our fixed order by rebuilding in that order.
    ordered = {}
    for k in ("kind", "name", "stages", "note"):
        if k in score:
            ordered[k] = score[k]
    # Any extra keys (forward-compat) appended in sorted order, after ours.
    for k in sorted(score):
        if k not in ordered:
            ordered[k] = score[k]
    return json.dumps(ordered, ensure_ascii=False, indent=2) + "\n"


def validate_shape(name, stages):
    """Structural check only — returns a list of problems (empty = ok).

    Not a typecheck, not a runnability claim. Just: a score needs a name, at
    least one stage, and every stage slug non-empty.
    """
    problems = []
    if not name or not str(name).strip():
        problems.append("score has no name")
    if not stages:
        problems.append("score has no stages (a pipeline needs at least one)")
    for i, s in enumerate(stages):
        if not s or not str(s).strip():
            problems.append(f"stage {i} is empty")
    return problems


def load_manifest_slugs(path):
    """Return the set of slugs declared in a manifest (for the optional
    unknown-stage flag). Never guesses shape; raises ValueError if it can't
    find an entry list."""
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
    return {e.get("slug") for e in entries if e.get("slug")}


def parse_stages(s):
    parts = [p.strip() for p in s.split(",")]
    parts = [p for p in parts if p]
    if not parts:
        raise ValueError("--stages needs at least one slug (comma-separated)")
    return parts


def cmd_write(args):
    stages = parse_stages(args.stages)
    problems = validate_shape(args.name, stages)
    if problems:
        for p in problems:
            sys.stderr.write(f"declare: {p}\n")
        return 2

    score = canonical_score(args.name, stages, args.note)

    unknown = []
    if args.manifest:
        try:
            known = load_manifest_slugs(args.manifest)
        except (ValueError, OSError, json.JSONDecodeError) as e:
            sys.stderr.write(f"declare: {e}\n")
            return 2
        unknown = [s for s in stages if s not in known]
        if unknown:
            # Annotate — flagged in the score, never silently dropped.
            score["unknown_stages"] = unknown

    sys.stdout.write(score_to_bytes(score))
    if unknown:
        sys.stderr.write(
            "declare: NOTE — these stages are not declared tools in the manifest "
            "(saved anyway, flagged): " + ", ".join(unknown) + "\n"
        )
    return 0


def cmd_check(args):
    try:
        with open(args.score) as f:
            raw = f.read()
        data = json.loads(raw)
    except (OSError, json.JSONDecodeError) as e:
        sys.stderr.write(f"declare: {e}\n")
        return 2

    name = data.get("name")
    stages = data.get("stages")
    if not isinstance(stages, list):
        sys.stderr.write("declare: score has no 'stages' list\n")
        return 2
    problems = validate_shape(name, stages)
    if problems:
        for p in problems:
            sys.stderr.write(f"declare: {p}\n")
        return 2

    # Rebuild canonically from the score's own fields, preserving any extras.
    rebuilt = dict(data)
    canon = score_to_bytes(rebuilt)
    if canon == raw:
        return 0
    sys.stdout.write(canon)
    sys.stderr.write("declare: score is NOT canonical — the canonical form is above.\n")
    return 3


def _selftest():
    checks = []

    # 1. write is deterministic — same inputs, same bytes.
    a = score_to_bytes(canonical_score("p", ["gitlog", "vclock", "cairn"]))
    b = score_to_bytes(canonical_score("p", ["gitlog", "vclock", "cairn"]))
    checks.append(("write is deterministic (same bytes)", a == b))

    # 2. stages are NEVER reordered (order is the pipeline).
    s = canonical_score("p", ["cairn", "gitlog", "vclock"])
    checks.append(("stages preserve order, not sorted", s["stages"] == ["cairn", "gitlog", "vclock"]))

    # 3. key order is fixed: kind, name, stages.
    out = score_to_bytes(canonical_score("p", ["a", "b"]))
    checks.append(("canonical key order kind<name<stages",
                   out.index('"kind"') < out.index('"name"') < out.index('"stages"')))

    # 4. note omitted when empty, present when given.
    no_note = canonical_score("p", ["a"])
    with_note = canonical_score("p", ["a"], "hi")
    checks.append(("note omitted when empty", "note" not in no_note))
    checks.append(("note present when given", with_note.get("note") == "hi"))

    # 5. shape validation catches empty stages and no name.
    checks.append(("empty stages list is a problem", validate_shape("p", []) != []))
    checks.append(("no name is a problem", validate_shape("", ["a"]) != []))
    checks.append(("empty stage slug is a problem", validate_shape("p", ["a", ""]) != []))
    checks.append(("good score has no problems", validate_shape("p", ["a", "b"]) == []))

    # 6. round-trip: a canonical score re-canonicalizes to itself (check == 0 path).
    canon = score_to_bytes(canonical_score("p", ["a", "b"], "n"))
    reparsed = json.loads(canon)
    recanon = score_to_bytes(reparsed)
    checks.append(("canonical score is a fixpoint of the fold", canon == recanon))

    # 7. a non-canonical byte form differs from the fold (check would flip to 3).
    messy = '{"stages": ["a","b"], "name": "p", "kind": "gift-score"}\n'
    reparsed2 = json.loads(messy)
    checks.append(("non-canonical bytes differ from canonical",
                   score_to_bytes(reparsed2) != messy))

    passed = sum(1 for _, ok in checks if ok)
    for name_, ok in checks:
        print(f"  {'PASS' if ok else 'FAIL'}  {name_}")
    print(f"{passed}/{len(checks)} checks passed")
    return passed == len(checks)


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Save a named, reusable pipeline of small JSONL tools as a canonical 'gift score'."
    )
    ap.add_argument("--port", action="store_true", help="print declare's own port-verb (source) and exit")
    ap.add_argument("--selftest", action="store_true", help="run built-in checks and exit")
    sub = ap.add_subparsers(dest="cmd")

    pw = sub.add_parser("write", help="emit a canonical gift-score")
    pw.add_argument("--name", required=True)
    pw.add_argument("--stages", required=True, help="comma-separated slugs in pipeline order")
    pw.add_argument("--note", default=None)
    pw.add_argument("--manifest", default=None, help="optional: flag stages not declared in this manifest")

    pc = sub.add_parser("check", help="re-emit a score canonically and byte-compare")
    pc.add_argument("--score", required=True)

    args = ap.parse_args(argv)

    if args.port:
        print(json.dumps({"slug": "declare", "port_verb": "source"}))
        return 0
    if args.selftest:
        return 0 if _selftest() else 1
    if args.cmd == "write":
        return cmd_write(args)
    if args.cmd == "check":
        return cmd_check(args)
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
