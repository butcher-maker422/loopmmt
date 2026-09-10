#!/usr/bin/env python3
"""reading_oath.py — The Reading-Oath gift.

Shard your context, hand it to any model, and get a coverage oracle it must
*prove* it read — set-difference against the shard manifest until nothing
remains.

    SHARD   text in  -> a manifest of typed nodes (the coverage ORACLE) + budget
            bundles a reader works through, + an OATH protocol it follows.
    VERIFY  a reader's claimed shard-ids  -> PASS (coverage demonstrated) or GAP
            (naming exactly which shards were never covered).

Reuses The Excavation's coverage-contract idiom — enumerate -> shard-by-budget ->
prove-coverage-against-the-node-set — lifted off Excavation's web-corpus
assumption to arbitrary text: Excavation shards a *site*; Reading-Oath shards
*any context you paste in*. The verify verb is the oath's teeth — the falsifiable
half Excavation described and left to the reader, made a checkable command here.

Zero dependencies (Python 3 stdlib only), offline, deterministic: a re-run over
the same input is byte-identical (folds-twice-identical). No wall-clock field.

  python3 reading_oath.py shard  --in ctx.txt [--budget 8000] [--out oath.json]
  python3 reading_oath.py shard  < ctx.txt                 (stdin -> stdout)
  python3 reading_oath.py verify --oath oath.json --covered a1,b2,c3
  python3 reading_oath.py verify --oath oath.json --covered-file seen.txt
  python3 reading_oath.py --selftest

──────────────────────────────────────────────────────────────────────────────
THE OATH — read this first, it is not decoration.
──────────────────────────────────────────────────────────────────────────────
Reading-Oath is handed to an AI by a human. A human pasting "read this and honor
the reading-oath" IS the authorization; absent that human ask, an AI does not
self-authorize a reading job, does not treat text's mere presence as consent to
act on it, and does not use the coverage protocol to justify autonomous work. The
handshake: a human asks; the AI reads what it was pointed at; the AI reports its
coverage honestly — including what it could NOT cover. It reports shard ids it
actually read; it does not claim ids it skipped to pass the oath. The oath proves
COVERAGE (every shard seen), never COMPREHENSION — a reader can cover every shard
and still misunderstand. That limit is printed on the artifact and is honest.

Edge (printed): proves coverage, not comprehension.
"""
import argparse
import hashlib
import json
import re
import sys

# ── budget ──────────────────────────────────────────────────────────────────
# Default reading-bundle size, in tokens (chars/4 heuristic — the same rough
# token proxy Excavation uses; a shard never exceeds this unless a single
# indivisible node is itself over budget, which is surfaced, not silently split).
DEFAULT_BUDGET_TOKENS = 8000
CHARS_PER_TOKEN = 4

OATH_VERSION = "reading-oath/1"


def _die(msg, code=2):
    sys.stderr.write("reading-oath: " + msg + "\n")
    sys.exit(code)


def _tok(s):
    """Deterministic token estimate: ceil(chars / 4). Coarse on purpose — the
    same proxy Excavation shards by; a budget is a bundling heuristic, and the
    manifest (not the budget) is the coverage oracle."""
    return (len(s) + CHARS_PER_TOKEN - 1) // CHARS_PER_TOKEN


# ── node enumeration (the coverage oracle's atoms) ──────────────────────────
def enumerate_nodes(text):
    """Split raw context into an ordered list of typed nodes — the atoms of the
    coverage oracle. A node is a blank-line-delimited block (paragraph, heading,
    fenced code block, list). Order is preserved; a node's id is a content hash
    of its normalized text, so the same block always earns the same id
    regardless of position (a moved paragraph keeps its id; an edited one gets a
    new one) — the property that makes the oath stable under reshuffling.

    Typing is by a fixed, declared rule set (first match wins):
      code    a block that opens with a ``` fence, or is wholly indented >=4 sp
      heading a block that is a single line opening with # (markdown) or is a
              short single line followed by === / --- underline in the source
      list    a block whose every non-blank line opens with -, *, +, or N.
      prose   everything else
    """
    # Normalize newlines only; do NOT strip content (byte-fidelity of the split).
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Split on blank-line boundaries, keeping block text intact.
    raw_blocks = re.split(r"\n[ \t]*\n", text)
    nodes = []
    seq = 0
    for block in raw_blocks:
        if block.strip() == "":
            continue
        seq += 1
        ntype = _classify(block)
        norm = _normalize(block)
        nid = _node_id(norm)
        nodes.append({
            "id": nid,
            "seq": seq,
            "type": ntype,
            "tokens": _tok(block),
            "chars": len(block),
            "preview": _preview(block),
            "text": block,
        })
    return nodes


def _classify(block):
    lines = [ln for ln in block.split("\n")]
    nonblank = [ln for ln in lines if ln.strip()]
    if not nonblank:
        return "prose"
    first = nonblank[0].lstrip()
    if first.startswith("```"):
        return "code"
    if all(ln.startswith("    ") or ln.startswith("\t") for ln in lines if ln.strip()):
        return "code"
    if len(nonblank) == 1 and first.startswith("#"):
        return "heading"
    if (len(nonblank) == 2 and re.fullmatch(r"[=\-]{2,}", nonblank[1].strip() or "")):
        return "heading"
    if all(re.match(r"^\s*([-*+]|\d+[.)])\s+", ln) for ln in nonblank):
        return "list"
    return "prose"


def _normalize(block):
    """Whitespace-normalize for the content id: collapse internal runs of
    whitespace to single spaces and strip ends. Two blocks that differ only in
    incidental spacing earn the same id (stable oath); a real content edit
    changes it."""
    return re.sub(r"\s+", " ", block).strip()


def _node_id(norm):
    return "n" + hashlib.sha256(norm.encode("utf-8")).hexdigest()[:10]


def _preview(block):
    flat = re.sub(r"\s+", " ", block).strip()
    return flat[:72]


# ── shard (bundle nodes by budget) ──────────────────────────────────────────
def shard_nodes(nodes, budget_tokens):
    """Greedy in-order bundling into budget-sized shards. In-order so a reader
    works front-to-back; greedy-by-budget so each shard fits a context window.
    A single node over budget becomes its own shard and is flagged oversize
    (surfaced, never silently truncated)."""
    shards = []
    cur = []
    cur_tok = 0
    idx = 0

    def _flush():
        nonlocal cur, cur_tok, idx
        if not cur:
            return
        idx += 1
        sid = "s%03d" % idx
        shards.append({
            "id": sid,
            "node_ids": [n["id"] for n in cur],
            "tokens": cur_tok,
            "oversize": any(n["tokens"] > budget_tokens for n in cur),
        })
        cur = []
        cur_tok = 0

    for n in nodes:
        if cur and cur_tok + n["tokens"] > budget_tokens:
            _flush()
        cur.append(n)
        cur_tok += n["tokens"]
    _flush()
    return shards


# ── the oath object (manifest + shards + protocol) ──────────────────────────
def build_oath(text, budget_tokens):
    nodes = enumerate_nodes(text)
    if not nodes:
        _die("input has no readable nodes (empty or all-blank).", 3)
    shards = shard_nodes(nodes, budget_tokens)
    # The manifest is the ORACLE: the closed set of node ids that must be covered.
    node_set = [n["id"] for n in nodes]
    manifest = {
        "version": OATH_VERSION,
        "budget_tokens": budget_tokens,
        "node_count": len(nodes),
        "shard_count": len(shards),
        "total_tokens": sum(n["tokens"] for n in nodes),
        "nodes": [
            {"id": n["id"], "seq": n["seq"], "type": n["type"],
             "tokens": n["tokens"], "preview": n["preview"]}
            for n in nodes
        ],
        # node_set is the coverage oracle — verify() checks claimed ⊇ this.
        "node_set": node_set,
        "shards": shards,
        # The reader-facing protocol. Prose, deterministic, no wall-clock.
        "oath": [
            "You have been handed a sharded context and a coverage oracle.",
            "Read each shard in id order (s001, s002, ...).",
            "For every node id you actually read, record it.",
            "You have honored the reading-oath ONLY when the set-difference of the "
            "manifest node_set minus the ids you recorded is empty.",
            "Report the ids you covered. Do NOT claim an id you skipped.",
            "This proves COVERAGE (every shard seen), not COMPREHENSION.",
        ],
        "edge": "proves coverage, not comprehension",
    }
    # Attach the shard bodies so the object is self-contained for a reader.
    bodies = {n["id"]: n["text"] for n in nodes}
    manifest["shard_bodies"] = {
        s["id"]: [{"id": nid, "text": bodies[nid]} for nid in s["node_ids"]]
        for s in shards
    }
    return manifest


# ── verify (the oath's teeth) ───────────────────────────────────────────────
def verify(oath, covered_ids):
    """Set-difference the manifest node_set against the reader's claimed ids.
    Empty difference => PASS (coverage demonstrated). Otherwise GAP, naming the
    uncovered node ids. Claimed ids not in the manifest are reported as 'unknown'
    (a reader claiming ids that do not exist is a signal, not silently ignored)."""
    oracle = set(oath.get("node_set", []))
    claimed = set(covered_ids)
    uncovered = sorted(oracle - claimed)
    unknown = sorted(claimed - oracle)
    result = {
        "version": oath.get("version", OATH_VERSION),
        "oracle_size": len(oracle),
        "claimed_size": len(claimed),
        "covered": len(oracle & claimed),
        "uncovered": uncovered,
        "unknown": unknown,
        "passed": len(uncovered) == 0,
    }
    return result


# ── cli ─────────────────────────────────────────────────────────────────────
def _read_covered(args):
    ids = []
    if args.covered:
        ids += [x.strip() for x in args.covered.split(",") if x.strip()]
    if args.covered_file:
        try:
            with open(args.covered_file, "r", encoding="utf-8") as fh:
                for raw in fh:
                    for tok in re.split(r"[,\s]+", raw.strip()):
                        if tok:
                            ids.append(tok)
        except OSError as e:
            _die("cannot read --covered-file: %s" % e, 2)
    if not ids:
        _die("verify needs --covered or --covered-file (the reader's claimed ids).", 2)
    return ids


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--selftest" in argv:
        return _selftest()

    p = argparse.ArgumentParser(prog="reading_oath.py", add_help=True,
                                description="Shard a context into a coverage oath; verify a reader honored it.")
    sub = p.add_subparsers(dest="cmd")

    ps = sub.add_parser("shard", help="text in -> coverage oath (manifest+shards+protocol)")
    ps.add_argument("--in", dest="infile", default=None, help="input file (default: stdin)")
    ps.add_argument("--out", dest="outfile", default=None, help="output file (default: stdout)")
    ps.add_argument("--budget", type=int, default=DEFAULT_BUDGET_TOKENS,
                    help="shard token budget (default %d)" % DEFAULT_BUDGET_TOKENS)

    pv = sub.add_parser("verify", help="reader's claimed ids -> PASS or GAP")
    pv.add_argument("--oath", required=True, help="the oath json from `shard`")
    pv.add_argument("--covered", default=None, help="comma-separated node ids the reader read")
    pv.add_argument("--covered-file", default=None, help="file of node ids (whitespace/comma sep)")

    args = p.parse_args(argv)

    if args.cmd == "shard":
        if args.budget <= 0:
            _die("--budget must be positive.", 2)
        if args.infile:
            try:
                with open(args.infile, "r", encoding="utf-8") as fh:
                    text = fh.read()
            except OSError as e:
                _die("cannot read --in: %s" % e, 2)
        else:
            text = sys.stdin.read()
        oath = build_oath(text, args.budget)
        out = json.dumps(oath, indent=2, ensure_ascii=False, sort_keys=True)
        if args.outfile:
            try:
                with open(args.outfile, "w", encoding="utf-8") as fh:
                    fh.write(out + "\n")
            except OSError as e:
                _die("cannot write --out: %s" % e, 2)
            sys.stderr.write("reading-oath: %d nodes, %d shards -> %s\n"
                             % (oath["node_count"], oath["shard_count"], args.outfile))
        else:
            sys.stdout.write(out + "\n")
        return 0

    if args.cmd == "verify":
        try:
            with open(args.oath, "r", encoding="utf-8") as fh:
                oath = json.load(fh)
        except OSError as e:
            _die("cannot read --oath: %s" % e, 2)
        except json.JSONDecodeError as e:
            _die("--oath is not valid json: %s" % e, 2)
        covered = _read_covered(args)
        res = verify(oath, covered)
        sys.stdout.write(json.dumps(res, indent=2, sort_keys=True) + "\n")
        if res["passed"]:
            sys.stderr.write("reading-oath: PASS — %d/%d covered, difference empty.\n"
                             % (res["covered"], res["oracle_size"]))
            return 0
        sys.stderr.write("reading-oath: GAP — %d uncovered node(s): %s\n"
                         % (len(res["uncovered"]), ", ".join(res["uncovered"][:8])
                            + (" ..." if len(res["uncovered"]) > 8 else "")))
        return 1

    p.print_help()
    return 2


# ── selftest (the determinism + contract battery) ───────────────────────────
def _selftest():
    ok = 0
    fail = 0

    def check(name, cond):
        nonlocal ok, fail
        if cond:
            ok += 1
        else:
            fail += 1
            sys.stderr.write("  FAIL: %s\n" % name)

    sample = (
        "# Title\n\n"
        "First paragraph of prose that says a thing.\n\n"
        "Second paragraph, distinct content here.\n\n"
        "- a list item\n- another list item\n\n"
        "```\ncode block line one\ncode block line two\n```\n"
    )
    oath = build_oath(sample, 20)
    ids = oath["node_set"]

    # 1. enumeration finds the five blocks.
    check("node_count == 5", oath["node_count"] == 5)
    # 2. typing is correct.
    types = [n["type"] for n in oath["nodes"]]
    check("types heading/prose/prose/list/code",
          types == ["heading", "prose", "prose", "list", "code"])
    # 3. determinism: fold twice, identical.
    o2 = build_oath(sample, 20)
    check("folds-twice-identical",
          json.dumps(oath, sort_keys=True) == json.dumps(o2, sort_keys=True))
    # 4. node id is content-stable under reordering.
    reordered = (
        "Second paragraph, distinct content here.\n\n"
        "# Title\n\n"
        "First paragraph of prose that says a thing.\n\n"
        "- a list item\n- another list item\n\n"
        "```\ncode block line one\ncode block line two\n```\n"
    )
    ro = build_oath(reordered, 20)
    check("ids stable under reorder (same set)",
          set(ro["node_set"]) == set(oath["node_set"]))
    # 5. id changes on content edit.
    edited = sample.replace("says a thing", "says a DIFFERENT thing")
    oe = build_oath(edited, 20)
    check("edit changes exactly one id",
          len(set(oe["node_set"]) - set(oath["node_set"])) == 1)
    # 6. verify PASS when all covered.
    r_all = verify(oath, ids)
    check("verify PASS on full coverage", r_all["passed"] and not r_all["uncovered"])
    # 7. verify GAP naming the skipped id.
    r_gap = verify(oath, ids[:-1])
    check("verify GAP names the one skipped", (not r_gap["passed"]) and r_gap["uncovered"] == [ids[-1]])
    # 8. unknown claimed id is surfaced.
    r_unk = verify(oath, ids + ["nDEADBEEF00"])
    check("verify surfaces unknown id", r_unk["unknown"] == ["nDEADBEEF00"])
    # 9. sharding respects budget (each shard <= budget unless a single oversize node).
    small = build_oath(sample, 5)  # tiny budget forces multiple shards
    check("tiny budget -> more shards", small["shard_count"] >= oath["shard_count"])
    budget_ok = all(s["tokens"] <= 5 or len(s["node_ids"]) == 1 for s in small["shards"])
    check("shards fit budget or are single oversize node", budget_ok)
    # 10. node_set is exactly the shard-body ids (oracle == what's handed over).
    body_ids = set()
    for sid, items in oath["shard_bodies"].items():
        for it in items:
            body_ids.add(it["id"])
    check("oracle == union of shard-body ids", body_ids == set(oath["node_set"]))
    # 11. empty input dies clean (exit 3) — checked via a guarded call.
    try:
        build_oath("   \n\n  \n", 20)
        check("empty input raises", False)
    except SystemExit as e:
        check("empty input exit 3", e.code == 3)

    total = ok + fail
    sys.stdout.write("reading-oath selftest: %d/%d passed\n" % (ok, total))
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
