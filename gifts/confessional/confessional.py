#!/usr/bin/env python3
"""confessional.py -- your prompt goes to confession, and admits what it does NOT constrain.

WHY THIS EXISTS. Every prompt is a set of things you told the model to do. But the
gaps -- the things you *didn't* pin down -- are where its behavior drifts. You asked
for a summary but never said how long; you named a tone but never a format; you set a
task but never what to refuse. confessional reads a prompt and emits its honest
ceilings: the constrainable dimensions a well-formed prompt of this kind *could* have
pinned down, that yours left open. It turns the collection's own signature -- an honest
edge on everything -- into a tool you point at your own prompts.

THE ONE DISCIPLINE (the whole reason to trust it -- I1). confessional reports the gaps
it can NAME. It reads what your prompt DECLARES and what a standard checklist of
constrainable dimensions would EXPECT, and confesses the difference. It never claims to
have found every gap, never claims a gap is a bug, never claims your prompt is complete
when it stays silent. Its deepest, printed edge: it cannot find the gap you never named
-- a dimension outside its declared checklist is invisible to it, by construction. It
confesses; it does not audit.

TWO VERBS, both honest:

  confess  -- read one prompt; emit its open dimensions (the ones it does NOT constrain)
              and its closed dimensions (the ones it does), each named, each with the
              evidence (the phrase that closed it, or the absence that left it open).
              A dimension it has no detector for is NEVER reported closed on a guess:
              undetectable -> reported OPEN with reason "no declared detector matched",
              a named uncertainty, never a silent claim. Same prompt -> byte-identical
              confession, every run.

  chain    -- read TWO OR MORE confessions (this gift's own JSON output, piped or by
              file) and ACCUMULATE them: a dimension is closed in the chain iff SOME
              link closed it; the residual open set is the intersection of every link's
              open set. This is the cumulative property -- confess prompt A, confess
              prompt B, chain them, and you see what NEITHER prompt constrained. The
              chain is order-independent and idempotent (chaining a confession with
              itself changes nothing).

THE CLOSED DIMENSION SET (v1) -- each a constrainable axis with a deterministic detector:
  output-format   is the shape of the answer pinned? (bullets, JSON, table, prose, ...)
  length          is the size bounded? (N words/sentences/paragraphs, "brief", "detailed")
  tone            is the register named? (formal, casual, technical, ...)
  audience        is the reader named? (for a child, for an expert, ...)
  refusal         is the out-of-scope / refusal behavior stated? (if you can't, say ...)
  edge-cases      are empty / malformed / ambiguous inputs addressed?
  scope-boundary  is what to leave OUT stated? (only X, do not cover Y)
  grounding       is the source-of-truth / citation requirement stated?

Each detector fails closed: it reports a dimension CLOSED only on a positive textual
match it can name; otherwise the dimension is OPEN with a stated reason. It never
infers "probably constrained".

Pure function of its inputs. No dependencies. Offline. Same input -> byte-identical
output, every run. Python 3.8+, standard library only.

USAGE
  python3 confessional.py confess "Summarize the report in 3 bullets."
  python3 confessional.py confess < prompt.txt
  python3 confessional.py confess --dimensions output-format,length,refusal "..."
  python3 confessional.py confess prompt_a.txt | python3 confessional.py chain prompt_b_confession.json
  python3 confessional.py chain conf_a.json conf_b.json
  python3 confessional.py --selftest
  python3 confessional.py --help

Released under MIT. Its edge is printed in the README and repeated here: confessional
surfaces the constrainable dimensions your prompt left open, from a DECLARED checklist.
It cannot find a gap outside that checklist, cannot tell you whether an open dimension
matters for your task, and cannot make your prompt complete. It reports declared and
detectable gaps; the gap you never named stays hidden.
"""

import sys
import json
import re

VERSION = "1.0"

# ---------------------------------------------------------------------------
# The closed dimension set. Each entry: a name, a human gloss, and a detector.
# A detector returns (closed: bool, evidence: str). closed=True ONLY on a
# positive, nameable textual match; otherwise closed=False with a reason.
# Detectors are pure functions of the lowercased prompt text.
# ---------------------------------------------------------------------------

def _find(patterns, text):
    """Return the first matching phrase (the matched span) or None."""
    for pat in patterns:
        m = re.search(pat, text)
        if m:
            return m.group(0).strip()
    return None


def _d_output_format(text):
    hit = _find([
        r"\b\d+\s+bullet(s)?\b",
        r"\bbullet(ed|s|-point| point)\b",
        r"\bas (a )?(json|table|list|markdown|csv|xml|yaml)\b",
        r"\bin (json|table|list|markdown|csv|xml|yaml) format\b",
        r"\b(json|markdown|csv|xml|yaml)-?formatted\b",
        r"\bnumbered list\b",
        r"\bone (sentence|paragraph|word)\b",
        r"\bin prose\b",
        r"\bplain text\b",
        r"\bformat(ted)? as\b",
    ], text)
    if hit:
        return True, hit
    return False, "no output-shape phrase found (no bullets/JSON/table/list/prose spec)"


def _d_length(text):
    hit = _find([
        r"\b\d+\s+(word|sentence|paragraph|bullet|line|character)s?\b",
        r"\b(under|no more than|at most|fewer than|less than|up to|max(imum)?)\s+\d+\b",
        r"\b(brief|briefly|concise|concisely|short|terse|succinct)\b",
        r"\b(detailed|in-depth|comprehensive|thorough|exhaustive|at length)\b",
        r"\bone-?liner\b",
        r"\btl;dr\b",
        r"\bkeep it (short|brief|to)\b",
    ], text)
    if hit:
        return True, hit
    return False, "no length bound found (no count, no brief/detailed cue)"


def _d_tone(text):
    hit = _find([
        r"\b(formal|informal|casual|professional|technical|academic|conversational|friendly|neutral|playful|serious|clinical)\s+(tone|voice|register|style|language)\b",
        r"\bin a (formal|casual|professional|technical|friendly|neutral|playful) (tone|voice|way|manner)\b",
        r"\btone[:=]\s*\w+",
        r"\b(sound|be|write|respond)\s+(formal|casual|professional|friendly|technical)\b",
        r"\bplain(-| )?english\b",
    ], text)
    if hit:
        return True, hit
    return False, "no register named (no formal/casual/technical tone spec)"


def _d_audience(text):
    hit = _find([
        r"\bfor (a |an )?(child|kid|beginner|expert|layperson|layman|novice|five[- ]year[- ]old|5[- ]year[- ]old|student|developer|engineer|doctor|nurse|manager|executive|non-?technical|technical) (audience|reader)?",
        r"\bexplain like i'?m\b",
        r"\beli5\b",
        r"\bassume (the reader|they|no|the audience)\b",
        r"\btarget audience[:=]",
        r"\bwrite for\b",
        r"\byour audience is\b",
    ], text)
    if hit:
        return True, hit
    return False, "no reader named (no audience/for-a-... spec)"


def _d_refusal(text):
    hit = _find([
        r"\bif you (can'?t|cannot|don'?t know|are unsure|are not sure|aren'?t sure)\b",
        r"\b(refuse|decline|do not answer|don'?t answer|say (you )?(can'?t|cannot))\b",
        r"\bif (the (answer|information)|there) is (no|not|none|unknown|unclear)\b.{0,40}\b(say|respond|reply|return|state)\b",
        r"\bif (you|it) (is|are) (not )?(unclear|uncertain|unknown|unsure|out of scope)\b",
        r"\bwhen unsure\b",
        r"\bif unable\b",
        r"\bout[- ]of[- ]scope\b",
        r"\bif you don'?t have (enough )?(the )?(information|context|data)\b",
        r"\bonly (answer|respond) if\b",
    ], text)
    if hit:
        return True, hit
    return False, "no refusal/fallback behavior stated (no if-you-can't clause)"


def _d_edge_cases(text):
    hit = _find([
        r"\b(empty|blank|missing|null|malformed|invalid|ambiguous|unclear|incomplete|contradictory)\s+(input|prompt|data|request|file|field|value)\b",
        r"\bif (the )?(input|data|request|field) is (empty|blank|missing|invalid|malformed|ambiguous)\b",
        r"\bedge case(s)?\b",
        r"\bcorner case(s)?\b",
        r"\bhandle .{0,30}\b(empty|missing|invalid|malformed|ambiguous)\b",
        r"\bif nothing\b",
    ], text)
    if hit:
        return True, hit
    return False, "no edge-case handling stated (empty/malformed/ambiguous input unaddressed)"


def _d_scope_boundary(text):
    hit = _find([
        r"\b(do not|don'?t|never|avoid)\b.{0,40}\b(include|cover|mention|discuss|add|address)\b",
        r"\bonly (cover|include|discuss|address|answer|focus on)\b",
        r"\bexclud(e|ing)\b",
        r"\bleave out\b",
        r"\bnothing (else|more|about)\b",
        r"\bstrictly\b.{0,20}\b(about|on|to)\b",
        r"\blimit(ed)? (yourself )?to\b",
        r"\bstay on\b",
    ], text)
    if hit:
        return True, hit
    return False, "no scope boundary stated (nothing said to leave OUT)"


def _d_grounding(text):
    hit = _find([
        r"\b(cite|citation|source|sources|reference|references)\b",
        r"\bbased (only )?on (the|this|these|provided)\b",
        r"\bfrom the (document|text|context|passage|data)\b",
        r"\bdo not (make up|invent|fabricate|hallucinate)\b",
        r"\bdon'?t (make up|invent|fabricate|hallucinate)\b",
        r"\bonly use (the|information)\b",
        r"\bquote\b",
        r"\bground(ed)? in\b",
    ], text)
    if hit:
        return True, hit
    return False, "no grounding requirement stated (no cite/source/no-fabrication rule)"


DIMENSIONS = [
    ("output-format",  "is the shape of the answer pinned?",              _d_output_format),
    ("length",         "is the size bounded?",                            _d_length),
    ("tone",           "is the register named?",                          _d_tone),
    ("audience",       "is the reader named?",                            _d_audience),
    ("refusal",        "is out-of-scope / refusal behavior stated?",      _d_refusal),
    ("edge-cases",     "are empty/malformed/ambiguous inputs addressed?", _d_edge_cases),
    ("scope-boundary", "is what to leave OUT stated?",                    _d_scope_boundary),
    ("grounding",      "is the source-of-truth / citation rule stated?",  _d_grounding),
]

DIM_NAMES = [d[0] for d in DIMENSIONS]


# ---------------------------------------------------------------------------
# confess
# ---------------------------------------------------------------------------

def confess(prompt, dimensions=None):
    """Return the confession dict for one prompt.

    dimensions: optional list of dimension names to restrict to. Unknown names
    are reported in 'skipped_unknown', never silently dropped (fail-loud).
    """
    if dimensions is None:
        selected = DIMENSIONS
        skipped_unknown = []
    else:
        want = list(dimensions)
        selected = [d for d in DIMENSIONS if d[0] in want]
        skipped_unknown = [n for n in want if n not in DIM_NAMES]

    text = prompt.lower()
    closed = []
    opend = []
    for name, gloss, detector in selected:
        is_closed, evidence = detector(text)
        rec = {"dimension": name, "gloss": gloss, "evidence": evidence}
        if is_closed:
            closed.append(rec)
        else:
            opend.append(rec)

    return {
        "gift": "confessional",
        "version": VERSION,
        "kind": "confession",
        "prompt": prompt,
        "closed": closed,
        "open": opend,
        "open_dimensions": [r["dimension"] for r in opend],
        "closed_dimensions": [r["dimension"] for r in closed],
        "skipped_unknown": skipped_unknown,
        "edge": ("declared/detectable dimensions only; a gap outside the checklist "
                 "is invisible, and an open dimension is not necessarily one that "
                 "matters for your task."),
    }


# ---------------------------------------------------------------------------
# chain -- accumulate confessions (and chains)
# ---------------------------------------------------------------------------

def _open_set(link):
    """The open-dimension set of a confession OR a chain link."""
    if link.get("kind") == "chain":
        return set(link.get("open_dimensions", []))
    return set(link.get("open_dimensions", []))


def _closed_set(link):
    if link.get("kind") == "chain":
        return set(link.get("closed_dimensions", []))
    return set(link.get("closed_dimensions", []))


def _universe(link):
    """Every dimension this link considered (open + closed)."""
    return _open_set(link) | _closed_set(link)


def chain(links):
    """Accumulate >=1 confessions/chains.

    A dimension is CLOSED in the chain iff SOME link closed it.
    The residual OPEN set is: (dimensions considered by every link) minus the
    union of everything any link closed. Restricting to the common universe keeps
    the property honest -- a dimension no link even looked at is not reported open.
    """
    if not links:
        raise ValueError("chain requires at least one confession")

    universes = [_universe(l) for l in links]
    common_universe = set.intersection(*universes) if universes else set()

    closed_union = set()
    for l in links:
        closed_union |= _closed_set(l)

    residual_open = sorted(common_universe - closed_union)
    chained_closed = sorted(common_universe & closed_union)

    sources = []
    for l in links:
        sources.append({
            "kind": l.get("kind"),
            "prompt": l.get("prompt") if l.get("kind") == "confession" else None,
            "links": len(l.get("sources", [])) if l.get("kind") == "chain" else 1,
        })

    return {
        "gift": "confessional",
        "version": VERSION,
        "kind": "chain",
        "n_links": len(links),
        "open_dimensions": residual_open,
        "closed_dimensions": chained_closed,
        "sources": sources,
        "edge": ("chain shows what NO link constrained, over the dimensions common "
                 "to all links; a dimension some link never considered is left out "
                 "rather than guessed."),
    }


# ---------------------------------------------------------------------------
# rendering
# ---------------------------------------------------------------------------

def render_confession(c):
    lines = []
    lines.append("CONFESSION")
    lines.append("=" * 60)
    p = c["prompt"]
    show = p if len(p) <= 200 else p[:197] + "..."
    lines.append("prompt: " + show)
    lines.append("")
    lines.append("CLOSED (%d) -- what this prompt DOES constrain:" % len(c["closed"]))
    if c["closed"]:
        for r in c["closed"]:
            lines.append("  [x] %-14s  (%s)" % (r["dimension"], r["evidence"]))
    else:
        lines.append("  (none)")
    lines.append("")
    lines.append("OPEN (%d) -- what it does NOT constrain:" % len(c["open"]))
    if c["open"]:
        for r in c["open"]:
            lines.append("  [ ] %-14s  %s" % (r["dimension"], r["evidence"]))
    else:
        lines.append("  (none)")
    if c["skipped_unknown"]:
        lines.append("")
        lines.append("skipped (unknown dimension names): " + ", ".join(c["skipped_unknown"]))
    lines.append("")
    lines.append("edge: " + c["edge"])
    return "\n".join(lines)


def render_chain(c):
    lines = []
    lines.append("CHAIN CONFESSION  (%d links)" % c["n_links"])
    lines.append("=" * 60)
    lines.append("closed by SOME link (%d): %s" % (
        len(c["closed_dimensions"]),
        ", ".join(c["closed_dimensions"]) or "(none)"))
    lines.append("")
    lines.append("open in EVERY link (%d) -- what NONE of them constrained:" % len(c["open_dimensions"]))
    if c["open_dimensions"]:
        for d in c["open_dimensions"]:
            lines.append("  [ ] " + d)
    else:
        lines.append("  (none -- together the links close every common dimension)")
    lines.append("")
    lines.append("edge: " + c["edge"])
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _read_stdin():
    if sys.stdin is not None and not sys.stdin.isatty():
        return sys.stdin.read()
    return ""


def _load_json_arg(arg):
    """arg is a path OR a raw JSON string."""
    try:
        with open(arg, "r") as f:
            return json.load(f)
    except (FileNotFoundError, IsADirectoryError, OSError):
        return json.loads(arg)


def _cmd_confess(argv):
    dims = None
    as_json = False
    rest = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--dimensions":
            i += 1
            dims = [d.strip() for d in argv[i].split(",") if d.strip()]
        elif a == "--json":
            as_json = True
        else:
            rest.append(a)
        i += 1

    if rest:
        # a single arg may be a prompt string OR a file path
        joined = " ".join(rest)
        try:
            with open(joined, "r") as f:
                prompt = f.read()
        except (FileNotFoundError, IsADirectoryError, OSError):
            prompt = joined
    else:
        prompt = _read_stdin()

    prompt = prompt.strip()
    if not prompt:
        sys.stderr.write("confessional: no prompt given (arg, file, or stdin)\n")
        return 2

    c = confess(prompt, dimensions=dims)
    if as_json:
        print(json.dumps(c, indent=2, sort_keys=True))
    else:
        print(render_confession(c))
    return 0


def _cmd_chain(argv):
    as_json = False
    args = []
    for a in argv:
        if a == "--json":
            as_json = True
        else:
            args.append(a)

    links = []
    # stdin may carry the first confession (piped)
    piped = _read_stdin().strip()
    if piped:
        try:
            links.append(json.loads(piped))
        except json.JSONDecodeError:
            sys.stderr.write("confessional: stdin was not a valid confession JSON\n")
            return 2
    for a in args:
        try:
            links.append(_load_json_arg(a))
        except (json.JSONDecodeError, ValueError) as e:
            sys.stderr.write("confessional: could not load confession '%s': %s\n" % (a, e))
            return 2

    if len(links) < 1:
        sys.stderr.write("confessional: chain needs >=1 confession (stdin and/or file args)\n")
        return 2

    for l in links:
        if l.get("gift") != "confessional" or l.get("kind") not in ("confession", "chain"):
            sys.stderr.write("confessional: a chain input is not a confessional confession/chain\n")
            return 2

    result = chain(links)
    if as_json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(render_chain(result))
    return 0


# ---------------------------------------------------------------------------
# selftest
# ---------------------------------------------------------------------------

def _selftest():
    checks = []

    def ok(name, cond):
        checks.append((name, bool(cond)))

    # 1. a bare prompt closes nothing much and opens most dimensions
    c1 = confess("Summarize the report.")
    ok("bare prompt opens output-format", "output-format" in c1["open_dimensions"])
    ok("bare prompt opens length", "length" in c1["open_dimensions"])

    # 2. a well-specified prompt closes the dimension it names
    c2 = confess("Summarize the report in 3 bullets.")
    ok("3 bullets closes output-format", "output-format" in c2["closed_dimensions"])
    ok("3 bullets closes length", "length" in c2["closed_dimensions"])

    # 3. determinism -- byte-identical on re-run
    a = json.dumps(confess("Explain X briefly for a beginner."), sort_keys=True)
    b = json.dumps(confess("Explain X briefly for a beginner."), sort_keys=True)
    ok("confess is deterministic", a == b)

    # 4. detectors fire on their targets
    ok("tone detector", "tone" in confess("Answer in a formal tone.")["closed_dimensions"])
    ok("audience detector", "audience" in confess("Explain like I'm five.")["closed_dimensions"])
    ok("refusal detector", "refusal" in confess("If you can't find it, say so.")["closed_dimensions"])
    ok("edge-case detector", "edge-cases" in confess("If the input is empty, return nothing.")["closed_dimensions"])
    ok("scope detector", "scope-boundary" in confess("Only cover the summary; do not add opinions.")["closed_dimensions"])
    ok("grounding detector", "grounding" in confess("Cite your sources; do not make up facts.")["closed_dimensions"])

    # 5. fail-closed: an unmatched dimension is OPEN, never guessed closed
    c5 = confess("Write something.")
    ok("unmatched -> open (grounding)", "grounding" in c5["open_dimensions"])
    ok("open+closed partition the set",
       sorted(c5["open_dimensions"] + c5["closed_dimensions"]) == sorted(DIM_NAMES))

    # 6. --dimensions restriction + unknown-name is surfaced, not dropped
    c6 = confess("Summarize.", dimensions=["length", "made-up-dim"])
    ok("restricted to known dims", set(c6["open_dimensions"] + c6["closed_dimensions"]) <= {"length"})
    ok("unknown dim surfaced", "made-up-dim" in c6["skipped_unknown"])

    # 7. chain: a dim closed by SOME link is closed in the chain
    ca = confess("Answer in 3 bullets.")           # closes output-format(+length)
    cb = confess("Use a formal tone.")             # closes tone
    ch = chain([ca, cb])
    ok("chain closes union (output-format)", "output-format" in ch["closed_dimensions"])
    ok("chain closes union (tone)", "tone" in ch["closed_dimensions"])
    ok("chain residual open = intersection of opens",
       "grounding" in ch["open_dimensions"])  # neither closed grounding

    # 8. chain idempotent: chaining a confession with itself == its own open set
    ci = chain([ca, ca])
    ok("chain idempotent open set", set(ci["open_dimensions"]) == set(ca["open_dimensions"]))

    # 9. chain order-independent
    o1 = set(chain([ca, cb])["open_dimensions"])
    o2 = set(chain([cb, ca])["open_dimensions"])
    ok("chain order-independent", o1 == o2)

    # 10. chain over common universe: restricted confession doesn't leak a dim
    cr = confess("Summarize.", dimensions=["length"])      # universe={length}
    cf = confess("Summarize in 5 words.")                  # full universe
    chr_ = chain([cr, cf])
    ok("chain restricts to common universe", set(chr_["open_dimensions"] + chr_["closed_dimensions"]) == {"length"})

    passed = sum(1 for _, v in checks if v)
    total = len(checks)
    for name, v in checks:
        print("  %s  %s" % ("ok  " if v else "FAIL", name))
    print("selftest: %d/%d" % (passed, total))
    return 0 if passed == total else 1


HELP = """confessional -- your prompt admits what it does NOT constrain.

usage:
  confessional confess [--dimensions a,b,c] [--json] ["prompt" | file]
  confessional confess < prompt.txt
  confessional chain [--json] [confession.json ...]      (stdin may carry one)
  confessional --selftest
  confessional --help

dimensions (v1): output-format, length, tone, audience, refusal,
                 edge-cases, scope-boundary, grounding

edge: reports declared/detectable gaps from a closed checklist; cannot find a
gap outside it, cannot say whether an open dimension matters for your task, and
cannot make your prompt complete.
"""


def main(argv):
    if not argv or argv[0] in ("-h", "--help", "help"):
        sys.stdout.write(HELP)
        return 0
    if argv[0] == "--selftest":
        return _selftest()
    if argv[0] == "--version":
        print("confessional " + VERSION)
        return 0
    if argv[0] == "confess":
        return _cmd_confess(argv[1:])
    if argv[0] == "chain":
        return _cmd_chain(argv[1:])
    sys.stderr.write("confessional: unknown command '%s' (try --help)\n" % argv[0])
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
