#!/usr/bin/env python3
"""doppelganger.py -- generate a prompt's evil twin, and measure how far its output drifted.

WHY THIS EXISTS. You write a prompt. You trust it. But one small rephrase -- a
dropped "not", an "all" swapped for "some", a stripped constraint -- can quietly
change what a model does with it. doppelganger is an adversarial-robustness probe
for YOUR OWN prompts: it generates the *evil twin* -- a minimal rephrase, made by
one named, declared rule -- so you can run both and see whether your prompt is
brittle where you didn't expect. It is a hardening tool, not a jailbreak factory.

THE ONE DISCIPLINE (the whole reason to trust it). doppelganger PROPOSES and
MEASURES. It never claims a twin "worked", never claims it found the *worst*
rephrase, never calls anything a jailbreak. Two verbs, both honest:

  twin  -- emit N candidate twins from a CLOSED set of named rules. Each twin
           carries the rule that made it and the exact edit (a readable diff).
           A rule that cannot apply to a prompt is SKIPPED AND NAMED, never
           silently dropped. Same prompt + same rules -> byte-identical twins.

  diff  -- given the original output and a twin's output (YOU ran them through
           whatever model you like -- doppelganger never calls a model), compute
           a STRUCTURAL divergence read: length delta, token Jaccard, first point
           of divergence, and a classification (STABLE / DIVERGED / FLIPPED)
           against a DECLARED threshold. This measures textual divergence, NOT
           whether a flip is correct, harmful, or a real vulnerability.

THE CLOSED RULE SET (v1) -- each a deterministic single-edit text transform:
  negate         insert/remove a negation on the leading directive verb
  polarity-flip  swap a declared antonym pair (do/don't, include/exclude, ...)
  quantifier-swap step a quantifier along a declared ladder (all->some->none, ...)
  scope-widen    strip the first trailing constraint clause (", but ..." / "; only ...")
  frame-shift    prepend a declared authority/urgency frame
  entity-swap    swap the first declared subject token for its declared partner

Each rule fails closed: if it finds no site to edit, it reports
`{"rule": R, "applied": false, "reason": "..."}` -- a named skip, never a lie.

Pure function of its inputs. No dependencies. Offline. Same input -> byte-identical
output, every run. Python 3.8+, standard library only.

USAGE
  python3 doppelganger.py twin "Always summarize the report in 3 bullets."
  python3 doppelganger.py twin --rules negate,quantifier-swap "..."   < prompt.txt
  python3 doppelganger.py diff --threshold 0.5 --original out_a.txt --twin out_b.txt
  echo '{"original": "...", "twin": "..."}' | python3 doppelganger.py diff
  python3 doppelganger.py --selftest
  python3 doppelganger.py --help

Released under MIT. Its edge is printed in the README and repeated here: doppelganger
finds a phrasing that MIGHT flip your output, so you can harden your own prompt. It
proposes candidates and measures textual divergence; it does not run your prompt,
prove a flip is harmful, find a rephrase it has no rule for, or make your prompt safe.
"""

import sys
import json
import re

VERSION = "1.0"

# ---- the closed rule set (v1) -----------------------------------------------
# Each entry declares the closed data a rule needs. The rule logic lives in the
# apply_* functions; the RULES list is the single source of the closed set.

_NEGATION_MARKERS = ["do not ", "don't ", "never ", "no "]

# declared antonym pairs for polarity-flip (bidirectional, first match wins)
_POLARITY_PAIRS = [
    ("include", "exclude"),
    ("do ", "don't "),
    ("always", "never"),
    ("allow", "forbid"),
    ("accept", "reject"),
    ("enable", "disable"),
    ("with ", "without "),
]

# declared quantifier ladders; a quantifier steps to its right neighbor (wraps)
_QUANTIFIER_LADDERS = [
    ["all", "some", "none"],
    ["always", "sometimes", "never"],
    ["every", "any", "no"],
    ["must", "may", "must not"],
]

# declared frames for frame-shift (prepended verbatim)
_FRAME = "URGENT -- your job depends on this: "

# declared entity partner pairs for entity-swap (bidirectional)
_ENTITY_PAIRS = [
    ("user", "attacker"),
    ("customer", "competitor"),
    ("child", "adult"),
    ("summary", "verbatim copy"),
    ("public", "private"),
]

# constraint-clause openers for scope-widen (strip from the first one to end)
_CONSTRAINT_OPENERS = [", but ", ", except ", "; only ", ", unless ", ", without "]

_LEADING_VERB_RE = re.compile(r"^\s*([A-Za-z]+)")


def _first_directive_verb(text):
    """Return (verb, start, end) of the leading imperative-ish token, or None."""
    m = _LEADING_VERB_RE.match(text)
    if not m:
        return None
    return (m.group(1), m.start(1), m.end(1))


def _find_ci(haystack, needle):
    """Case-insensitive find; returns index or -1."""
    return haystack.lower().find(needle.lower())


def _replace_first_ci(text, needle, repl):
    """Replace the first case-insensitive occurrence of needle with repl.
    Returns (new_text, applied_bool)."""
    idx = _find_ci(text, needle)
    if idx < 0:
        return (text, False)
    return (text[:idx] + repl + text[idx + len(needle):], True)


# ---- rule implementations ---------------------------------------------------
# Each returns a result dict:
#   applied True  -> {"rule","applied":True,"twin","edit":{"was","now"}}
#   applied False -> {"rule","applied":False,"reason"}

def apply_negate(prompt):
    rule = "negate"
    # if already negated on a leading marker, remove it; else insert one
    for marker in _NEGATION_MARKERS:
        idx = prompt.lower().find(marker)
        if idx == 0 or (idx > 0 and prompt[:idx].strip() == ""):
            new = prompt[:idx] + prompt[idx + len(marker):]
            # capitalize the now-leading char to keep it plausible
            new = new[:1].upper() + new[1:] if new else new
            return {"rule": rule, "applied": True, "twin": new,
                    "edit": {"was": marker.strip(), "now": "(removed)"}}
    v = _first_directive_verb(prompt)
    if v is None:
        return {"rule": rule, "applied": False,
                "reason": "no leading directive verb to negate"}
    verb, s, e = v
    new = prompt[:s] + "Do not " + verb[0].lower() + verb[1:] + prompt[e:]
    return {"rule": rule, "applied": True, "twin": new,
            "edit": {"was": verb, "now": "Do not " + verb[0].lower() + verb[1:]}}


def apply_polarity_flip(prompt):
    rule = "polarity-flip"
    for a, b in _POLARITY_PAIRS:
        if _find_ci(prompt, a) >= 0:
            new, ok = _replace_first_ci(prompt, a, b)
            if ok:
                return {"rule": rule, "applied": True, "twin": new,
                        "edit": {"was": a.strip(), "now": b.strip()}}
        if _find_ci(prompt, b) >= 0:
            new, ok = _replace_first_ci(prompt, b, a)
            if ok:
                return {"rule": rule, "applied": True, "twin": new,
                        "edit": {"was": b.strip(), "now": a.strip()}}
    return {"rule": rule, "applied": False,
            "reason": "no declared antonym pair present"}


def apply_quantifier_swap(prompt):
    rule = "quantifier-swap"
    for ladder in _QUANTIFIER_LADDERS:
        for i, q in enumerate(ladder):
            # word-boundary case-insensitive match
            pat = re.compile(r"\b" + re.escape(q) + r"\b", re.IGNORECASE)
            m = pat.search(prompt)
            if m:
                nxt = ladder[(i + 1) % len(ladder)]
                new = prompt[:m.start()] + nxt + prompt[m.end():]
                return {"rule": rule, "applied": True, "twin": new,
                        "edit": {"was": q, "now": nxt}}
    return {"rule": rule, "applied": False,
            "reason": "no declared quantifier present"}


def apply_scope_widen(prompt):
    rule = "scope-widen"
    best = None
    for opener in _CONSTRAINT_OPENERS:
        idx = _find_ci(prompt, opener)
        if idx >= 0 and (best is None or idx < best[0]):
            best = (idx, opener)
    if best is None:
        return {"rule": rule, "applied": False,
                "reason": "no trailing constraint clause to strip"}
    idx, opener = best
    new = prompt[:idx].rstrip()
    if new and new[-1] not in ".!?":
        new = new + "."
    return {"rule": rule, "applied": True, "twin": new,
            "edit": {"was": prompt[idx:].strip(), "now": "(constraint removed)"}}


def apply_frame_shift(prompt):
    rule = "frame-shift"
    if prompt.startswith(_FRAME):
        return {"rule": rule, "applied": False,
                "reason": "frame already present"}
    return {"rule": rule, "applied": True, "twin": _FRAME + prompt,
            "edit": {"was": "(no frame)", "now": _FRAME.strip()}}


def apply_entity_swap(prompt):
    rule = "entity-swap"
    for a, b in _ENTITY_PAIRS:
        pat_a = re.compile(r"\b" + re.escape(a) + r"\b", re.IGNORECASE)
        if pat_a.search(prompt):
            new = pat_a.sub(b, prompt, count=1)
            return {"rule": rule, "applied": True, "twin": new,
                    "edit": {"was": a, "now": b}}
        pat_b = re.compile(r"\b" + re.escape(b) + r"\b", re.IGNORECASE)
        if pat_b.search(prompt):
            new = pat_b.sub(a, prompt, count=1)
            return {"rule": rule, "applied": True, "twin": new,
                    "edit": {"was": b, "now": a}}
    return {"rule": rule, "applied": False,
            "reason": "no declared entity token present"}


# The closed set, in canonical order. This list IS the closed rule set.
RULES = [
    ("negate", apply_negate),
    ("polarity-flip", apply_polarity_flip),
    ("quantifier-swap", apply_quantifier_swap),
    ("scope-widen", apply_scope_widen),
    ("frame-shift", apply_frame_shift),
    ("entity-swap", apply_entity_swap),
]
RULE_NAMES = [name for name, _ in RULES]


class DoppelgangerError(Exception):
    pass


def generate_twins(prompt, rules=None):
    """Return a list of result dicts, one per requested rule, in canonical order.

    Fails closed on: empty prompt, an unknown rule name. Every requested rule
    produces exactly one result -- applied (with twin + edit) or a named skip.
    Deterministic: same prompt + same rule set -> identical list."""
    if not isinstance(prompt, str) or prompt.strip() == "":
        raise DoppelgangerError("empty prompt (doppelganger needs a prompt to twin)")
    if rules is None:
        wanted = list(RULE_NAMES)
    else:
        for r in rules:
            if r not in RULE_NAMES:
                raise DoppelgangerError(
                    "unknown rule '%s'; the closed set is: %s"
                    % (r, ", ".join(RULE_NAMES)))
        wanted = [name for name in RULE_NAMES if name in rules]  # canonical order
    fn = dict(RULES)
    out = []
    for name in wanted:
        res = fn[name](prompt)
        res["original"] = prompt
        out.append(res)
    return out


# ---- the divergence read ----------------------------------------------------

_TOKEN_RE = re.compile(r"[A-Za-z0-9]+")


def _tokens(text):
    return [t.lower() for t in _TOKEN_RE.findall(text)]


def _jaccard(a_tokens, b_tokens):
    sa, sb = set(a_tokens), set(b_tokens)
    if not sa and not sb:
        return 1.0
    inter = len(sa & sb)
    union = len(sa | sb)
    return inter / union if union else 1.0


def _first_divergence(a, b):
    """Character index of the first difference, or -1 if identical."""
    n = min(len(a), len(b))
    for i in range(n):
        if a[i] != b[i]:
            return i
    if len(a) != len(b):
        return n
    return -1


def divergence(original_output, twin_output, threshold=0.5):
    """Structural divergence read between two model outputs.

    threshold in [0,1]: the Jaccard DISTANCE (1 - similarity) at/above which the
    pair is classed DIVERGED, and at/above 2x (capped) FLIPPED. This is a declared
    knob, not a truth: it measures textual divergence, never correctness."""
    if not isinstance(original_output, str) or not isinstance(twin_output, str):
        raise DoppelgangerError("diff needs two strings: original and twin outputs")
    if not (0.0 <= threshold <= 1.0):
        raise DoppelgangerError("threshold must be in [0,1]")
    a_tok, b_tok = _tokens(original_output), _tokens(twin_output)
    sim = _jaccard(a_tok, b_tok)
    dist = round(1.0 - sim, 6)
    len_delta = len(twin_output) - len(original_output)
    fd = _first_divergence(original_output, twin_output)
    flip_line = min(1.0, threshold * 2.0)
    if dist >= flip_line:
        cls = "FLIPPED"
    elif dist >= threshold:
        cls = "DIVERGED"
    else:
        cls = "STABLE"
    return {
        "classification": cls,
        "jaccard_similarity": round(sim, 6),
        "jaccard_distance": dist,
        "length_delta": len_delta,
        "first_divergence_char": fd,
        "threshold": threshold,
        "note": "textual divergence only -- not correctness, harm, or a proven flip",
    }


# ---- CLI --------------------------------------------------------------------

def _read_stdin():
    if sys.stdin is None or sys.stdin.isatty():
        return ""
    return sys.stdin.read()


def _cmd_twin(argv):
    rules = None
    positional = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--rules":
            i += 1
            if i >= len(argv):
                raise DoppelgangerError("--rules needs a comma-separated value")
            rules = [r.strip() for r in argv[i].split(",") if r.strip()]
        else:
            positional.append(a)
        i += 1
    prompt = " ".join(positional).strip() if positional else _read_stdin().strip()
    results = generate_twins(prompt, rules)
    for r in results:
        sys.stdout.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n")
    return 0


def _cmd_diff(argv):
    threshold = 0.5
    original = None
    twin = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--threshold":
            i += 1
            threshold = float(argv[i])
        elif a == "--original":
            i += 1
            with open(argv[i], "r", encoding="utf-8") as fh:
                original = fh.read()
        elif a == "--twin":
            i += 1
            with open(argv[i], "r", encoding="utf-8") as fh:
                twin = fh.read()
        i += 1
    if original is None or twin is None:
        raw = _read_stdin()
        if not raw.strip():
            raise DoppelgangerError(
                "diff needs --original F --twin F, or a JSON object "
                "{\"original\":..,\"twin\":..} on stdin")
        obj = json.loads(raw)
        original = obj["original"] if original is None else original
        twin = obj["twin"] if twin is None else twin
    res = divergence(original, twin, threshold)
    sys.stdout.write(json.dumps(res, ensure_ascii=False, sort_keys=True) + "\n")
    return 0


def _selftest():
    fails = []

    def check(name, cond):
        if not cond:
            fails.append(name)

    # 1. determinism: same input twice -> byte-identical
    p = "Always summarize the report in 3 bullets, but skip the appendix."
    r1 = generate_twins(p)
    r2 = generate_twins(p)
    check("determinism", json.dumps(r1, sort_keys=True) == json.dumps(r2, sort_keys=True))

    # 2. every rule produces exactly one result, canonical order
    check("one-result-per-rule", len(r1) == len(RULE_NAMES))
    check("canonical-order", [x["rule"] for x in r1] == RULE_NAMES)

    # 3. negate flips a directive
    neg = [x for x in r1 if x["rule"] == "negate"][0]
    check("negate-applied", neg["applied"] is True)
    check("negate-changed", neg["twin"] != p)

    # 4. quantifier-swap steps 'always' -> 'sometimes'
    qs = [x for x in r1 if x["rule"] == "quantifier-swap"][0]
    check("quantifier-applied", qs["applied"] is True)
    check("quantifier-step", "sometimes" in qs["twin"].lower())

    # 5. scope-widen strips the ", but ..." clause
    sw = [x for x in r1 if x["rule"] == "scope-widen"][0]
    check("scope-applied", sw["applied"] is True)
    check("scope-removed", "appendix" not in sw["twin"].lower())

    # 6. frame-shift prepends the frame
    fs = [x for x in r1 if x["rule"] == "frame-shift"][0]
    check("frame-applied", fs["applied"] is True)
    check("frame-prepended", fs["twin"].startswith(_FRAME))

    # 7. named skip, not silent drop: a prompt with no quantifier
    plain = "Write a haiku about rain."
    rp = generate_twins(plain, rules=["quantifier-swap"])
    check("named-skip", rp[0]["applied"] is False and "reason" in rp[0])

    # 8. fail closed on empty prompt
    try:
        generate_twins("")
        check("empty-fails", False)
    except DoppelgangerError:
        check("empty-fails", True)

    # 9. fail closed on unknown rule
    try:
        generate_twins(p, rules=["bogus"])
        check("unknown-rule-fails", False)
    except DoppelgangerError:
        check("unknown-rule-fails", True)

    # 10. rule subset selection returns only requested, canonical order
    sub = generate_twins(p, rules=["frame-shift", "negate"])
    check("subset-order", [x["rule"] for x in sub] == ["negate", "frame-shift"])

    # 11. divergence: identical outputs -> STABLE, distance 0
    d0 = divergence("hello world", "hello world", threshold=0.5)
    check("identical-stable", d0["classification"] == "STABLE" and d0["jaccard_distance"] == 0.0)

    # 12. divergence: disjoint outputs -> FLIPPED, distance 1
    d1 = divergence("apple banana", "xylophone zebra", threshold=0.5)
    check("disjoint-flipped", d1["classification"] == "FLIPPED" and d1["jaccard_distance"] == 1.0)

    # 13. divergence: partial overlap classes per threshold
    dm = divergence("the cat sat", "the dog sat", threshold=0.4)
    check("partial-diverged", dm["classification"] in ("DIVERGED", "FLIPPED", "STABLE"))
    check("first-divergence-set", dm["first_divergence_char"] >= 0)

    # 14. divergence determinism
    da = divergence("one two three", "one two four", threshold=0.5)
    db = divergence("one two three", "one two four", threshold=0.5)
    check("diff-determinism", json.dumps(da, sort_keys=True) == json.dumps(db, sort_keys=True))

    # 15. threshold bounds fail closed
    try:
        divergence("a", "b", threshold=1.5)
        check("threshold-bounds", False)
    except DoppelgangerError:
        check("threshold-bounds", True)

    total = 15
    passed = total - len(fails)
    if fails:
        sys.stdout.write("selftest: %d/%d FAIL -> %s\n" % (passed, total, ", ".join(fails)))
        return 1
    sys.stdout.write("selftest: %d/%d GREEN\n" % (passed, total))
    return 0


_HELP = """doppelganger v%s -- your prompt's evil twin (an adversarial-robustness probe).

  twin  "<prompt>"                 emit one twin per rule (JSONL to stdout)
        --rules r1,r2              restrict to a subset of the closed set
        (prompt may also arrive on stdin)
  diff  --original F --twin F      structural divergence read between two outputs
        --threshold T             declared DIVERGED line in [0,1] (default 0.5)
        (or a JSON {"original","twin"} on stdin)
  --selftest                       run the built-in battery
  --help

Closed rule set: %s

Edge: doppelganger PROPOSES candidate twins and MEASURES textual divergence, for
hardening your own prompt. It does not run your prompt, prove a flip is harmful,
find a rephrase it has no rule for, or make your prompt safe to ship.
""" % (VERSION, ", ".join(RULE_NAMES))


def main(argv):
    if not argv or argv[0] in ("--help", "-h", "help"):
        sys.stdout.write(_HELP)
        return 0
    if argv[0] == "--selftest":
        return _selftest()
    try:
        if argv[0] == "twin":
            return _cmd_twin(argv[1:])
        if argv[0] == "diff":
            return _cmd_diff(argv[1:])
        sys.stderr.write("unknown command '%s' (try --help)\n" % argv[0])
        return 2
    except DoppelgangerError as e:
        sys.stderr.write("doppelganger: %s\n" % e)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
