#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""lead_in.py — The Lead-In: read a piece of text into a declared vocabulary of kinds,
and show the words that led there.

Spec: the Lead-In Blueprint (B3 is what this file implements); its design record lives with the Blueprint.

The engine knows nothing about any domain. A VOCABULARY (JSON) declares kinds; each kind carries lead-in
cues, a plain sentence, examples and counterexamples. A vocabulary that cannot read its own examples does
not load (the self-certifying load). A READING is pure and total: same text + same vocabulary -> the same
bytes, no network, no clock, no randomness, no model call.

The self-test is a FLOOR, not a certificate (Gold Wash V4a, the Witness Ceiling): a vocabulary passing its own
examples is grading its own homework, so `check` also reports how many cues its examples actually exercise
(non-vacuity) and `heldout_score.py` reports recall on sentences it never saw (liveness).

Consumer class (pattern 3.13, the Fail-Direction Split): a vocabulary declares `consumer` horizon (default; a reading
shapes attention and fails SAFE — no kind is a SKIP with a door back) or gate (a decision hangs on it; no kind is
REFUSED, fail CLOSED). A reading carries its consumer class so a downstream reader cannot mistake one for the other.

Printed edge (honest ceiling): it reads words, not meaning. A text that names its subject in words no
vocabulary lists reads as no kind. A model or a person may PROPOSE a kind for such a text (`stray`);
proposals become cues only through `fold`, a decidable, monotone bar — never by judgment alone.

HOW IT LEARNS (the witness rule; its decision record lives with the Blueprint). The witness rule, verbatim: "A cue joins the vocabulary when two
sessions, on two different texts, have seen it lead to the same kind, and a third session blesses it." Mechanically:
  stray   the cue's tokens must occur, in order, in the text (a proposal names words the text actually has); a text
          under MIN_STRAY_TOKENS tokens is refused; each row records its `proposer` (the session id) and, when known,
          its `source` (who wrote the text).
  fold    a (kind, cue) is promoted only when its witnesses are >= 2 distinct texts from >= 2 distinct proposer
          sessions; with --write, the blessing DECIDED is looked up in the events directory and its session must not be any
          witness's session. A row with no proposer counts as a text, never as a session.
Ceiling, verbatim: "Two sessions are two occasions, not two minds." Recall is reported only against an independent
panel; every same-author number says so.

Verbs:
  read  <vocab.json> [TEXT|-] [--json] [--stray-log PATH]   read one text
  check <vocab.json>... [--json]                            lint + self-test + targets + collisions
  list  [DIR]                                               the vocabulary registry view
  stray <vocab.json> --kind K --cue C --log PATH --proposer SID [--source WHO] TEXT
                                                            record "this text is K; C should have led there"
  fold  <vocab.json> --log PATH [--write --decided ID]      promote eligible strays (dry run unless --write;
                                                            --write needs the recorded DECIDED id — the bless)

Exit (The Verdict classes): 0 OK or SKIP · 3 FLAG · 4 REFUSED · 2 ERROR.

Declared effect (its own tool-decl block: the author's claim, checked by parity):
```tool-decl
writes = read-only
writes.read = writes-tree
writes.stray = writes-tree
writes.fold = writes-tree
network = none
secrets = none
reads = the vocabulary JSON files named, their target_registry JSON, and the stray log named by --log
cold = loud
```
`read` writes only with --stray-log (one appended line); `fold` writes only with --write.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import unicodedata

TOP_KEYS = {"vocabulary", "version", "title", "provenance", "source", "mode", "consumer", "min_score", "tie_margin",
            "target_registry", "kinds", "na", "history"}
REQUIRED_TOP = {"vocabulary", "version", "title", "provenance", "mode", "kinds"}
KIND_KEYS = {"id", "label", "plain", "cues", "negative", "targets", "examples", "counterexamples"}
REQUIRED_KIND = {"id", "label", "plain", "cues", "examples"}
NA_KEYS = {"plain", "cues", "examples"}
PROVENANCES = ("authored", "derived", "folded")
MODES = ("multi", "single")
CONSUMERS = ("horizon", "gate")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
TOKEN_RE = re.compile(r"[a-z0-9]+")
CUE_TOKEN_RE = re.compile(r"^[a-z0-9]+\*?$")
PLAIN_MAX_WORDS = 25
STOP = {"a", "an", "the", "of", "in", "on", "to", "and", "or", "for", "by", "with", "over", "at", "as", "is"}

EXIT = {"OK": 0, "SKIP": 0, "FLAG": 3, "REFUSED": 4, "ERROR": 2}


class Refused(Exception):
    """Input outside the contract (The Verdict class REFUSED). The message names why."""


class LoadError(Exception):
    """A file that cannot be read (The Verdict class ERROR)."""


# ---------------------------------------------------------------- normalization and cues

def normalize(text):
    """NFKC, lowercase, tokens = maximal runs of [a-z0-9]. The one rule for text and cues alike."""
    return TOKEN_RE.findall(unicodedata.normalize("NFKC", str(text)).lower())


def parse_cue(cue, where):
    """-> (display, tokens, weight). A cue is a string or {"cue": str, "w": int}; `*` ends a token only."""
    weight = None
    if isinstance(cue, dict):
        if set(cue) - {"cue", "w"} or "cue" not in cue:
            raise Refused(f"{where}: a cue object takes only 'cue' and 'w'")
        weight = cue.get("w")
        if weight is not None and (not isinstance(weight, int) or isinstance(weight, bool) or weight < 1):
            raise Refused(f"{where}: cue weight must be an integer >= 1")
        cue = cue["cue"]
    if not isinstance(cue, str):
        raise Refused(f"{where}: a cue must be a string")
    raw = unicodedata.normalize("NFKC", cue).lower()
    pieces = re.sub(r"[^a-z0-9*]+", " ", raw).split()
    if not pieces:
        raise Refused(f"{where}: empty cue")
    for piece in pieces:
        if not CUE_TOKEN_RE.match(piece):
            raise Refused(f"{where}: cue '{cue}' — '*' may only end a token")
    display = " ".join(pieces)
    return display, tuple(pieces), weight if weight is not None else len(pieces)


def _token_hit(cue_token, token):
    if cue_token.endswith("*"):
        return token.startswith(cue_token[:-1])
    return token == cue_token


def first_match(cue_tokens, tokens):
    """Index of the first contiguous match of cue_tokens in tokens, else None."""
    n = len(cue_tokens)
    for i in range(len(tokens) - n + 1):
        if all(_token_hit(cue_tokens[j], tokens[i + j]) for j in range(n)):
            return i
    return None


# ---------------------------------------------------------------- the vocabulary

class Kind:
    def __init__(self, raw, where):
        self.raw = raw
        self.id = raw["id"]
        self.label = raw["label"]
        self.plain = raw["plain"]
        self.cues = [parse_cue(c, f"{where}.cues[{i}]") for i, c in enumerate(raw["cues"])]
        self.negative = [parse_cue(c, f"{where}.negative[{i}]") for i, c in enumerate(raw.get("negative", []))]
        self.targets = list(raw.get("targets", []))
        self.examples = list(raw["examples"])
        self.counterexamples = list(raw.get("counterexamples", []))


class Vocabulary:
    def __init__(self, raw, path):
        self.raw = raw
        self.path = path
        self.id = raw["vocabulary"]
        self.version = raw["version"]
        self.provenance = raw["provenance"]
        self.mode = raw["mode"]
        self.consumer = raw.get("consumer", "horizon")
        self.min_score = raw.get("min_score", 1)
        self.tie_margin = raw.get("tie_margin", 0)
        self.kinds = [Kind(k, f"kinds[{i}]") for i, k in enumerate(raw["kinds"])]
        na = raw.get("na") or {}
        self.na_plain = na.get("plain", "")
        self.na_cues = [parse_cue(c, f"na.cues[{i}]") for i, c in enumerate(na.get("cues", []))]
        self.na_examples = list(na.get("examples", []))
        self.registry_ids = None  # set by _resolve_targets when a target_registry is declared


def _need(cond, msg):
    if not cond:
        raise Refused(msg)


def _lint(raw):
    _need(isinstance(raw, dict), "a vocabulary is a JSON object")
    unknown = set(raw) - TOP_KEYS
    _need(not unknown, f"unknown top-level key(s): {sorted(unknown)}")
    missing = REQUIRED_TOP - set(raw)
    _need(not missing, f"missing top-level key(s): {sorted(missing)}")
    _need(isinstance(raw["vocabulary"], str) and ID_RE.match(raw["vocabulary"]), "vocabulary: bad id")
    _need(isinstance(raw["version"], int) and not isinstance(raw["version"], bool) and raw["version"] >= 1,
          "version: an integer >= 1")
    _need(raw["provenance"] in PROVENANCES, f"provenance: one of {PROVENANCES}")
    _need(raw["provenance"] != "derived" or isinstance(raw.get("source"), str), "a derived vocabulary names its source")
    _need(raw["mode"] in MODES, f"mode: one of {MODES}")
    _need(raw.get("consumer", "horizon") in CONSUMERS, f"consumer: one of {CONSUMERS}")
    for key in ("min_score", "tie_margin"):
        if key in raw:
            _need(isinstance(raw[key], int) and not isinstance(raw[key], bool) and raw[key] >= 0, f"{key}: an integer >= 0")
    _need(isinstance(raw["kinds"], list) and raw["kinds"], "kinds: a non-empty list")
    seen = set()
    for i, k in enumerate(raw["kinds"]):
        where = f"kinds[{i}]"
        _need(isinstance(k, dict), f"{where}: an object")
        unknown = set(k) - KIND_KEYS
        _need(not unknown, f"{where}: unknown key(s) {sorted(unknown)}")
        missing = REQUIRED_KIND - set(k)
        _need(not missing, f"{where}: missing key(s) {sorted(missing)}")
        _need(isinstance(k["id"], str) and ID_RE.match(k["id"]), f"{where}.id: bad id")
        _need(k["id"] not in seen, f"{where}.id: duplicate kind id '{k['id']}'")
        seen.add(k["id"])
        _need(isinstance(k["cues"], list) and k["cues"], f"{where}.cues: at least one cue")
        _need(isinstance(k["examples"], list) and k["examples"], f"{where}.examples: at least one example")
        for field in ("examples", "counterexamples", "targets", "negative"):
            _need(isinstance(k.get(field, []), list), f"{where}.{field}: a list")
        _need(all(isinstance(t, str) for t in k["examples"] + k.get("counterexamples", [])),
              f"{where}: examples and counterexamples are strings")
        plain = k["plain"]
        _need(isinstance(plain, str) and plain.strip(), f"{where}.plain: a sentence")
        words = normalize(plain)
        _need(len(words) <= PLAIN_MAX_WORDS, f"{where}.plain: at most {PLAIN_MAX_WORDS} words (has {len(words)})")
        label_words = {w for w in normalize(k["label"]) if w not in STOP}
        named = sorted(label_words & set(words))
        _need(not named, f"{where}.plain: explain it without naming it — uses label word(s) {named}")
    na = raw.get("na")
    if na is not None:
        _need(isinstance(na, dict), "na: an object")
        unknown = set(na) - NA_KEYS
        _need(not unknown, f"na: unknown key(s) {sorted(unknown)}")
        _need(isinstance(na.get("cues", []), list) and isinstance(na.get("examples", []), list), "na: cues/examples are lists")
    reg = raw.get("target_registry")
    if reg is not None:
        _need(isinstance(reg, dict) and set(reg) == {"path", "records_key", "id_field"},
              "target_registry: exactly {path, records_key, id_field}")


def _resolve_targets(vocab):
    reg = vocab.raw.get("target_registry")
    referenced = sorted({t for k in vocab.kinds for t in k.targets})
    if reg is None:
        _need(not referenced, "kinds declare targets but no target_registry")
        return
    path = reg["path"]
    if not os.path.isabs(path):
        path = os.path.join(os.path.dirname(os.path.abspath(vocab.path)), path)
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError) as error:
        raise Refused(f"target_registry unreadable: {path}: {error}")
    records = data.get(reg["records_key"]) if reg["records_key"] else data
    _need(isinstance(records, list), "target_registry: records is not a list")
    ids = {r.get(reg["id_field"]) for r in records if isinstance(r, dict)}
    ids.discard(None)
    vocab.registry_ids = ids
    unresolved = [t for t in referenced if t not in ids]
    _need(not unresolved, f"targets that do not resolve in {reg['path']}: {unresolved}")


def build(raw, path="<memory>"):
    """Lint, compile, resolve targets, self-test. REFUSED on any failure."""
    _lint(raw)
    vocab = Vocabulary(raw, path)
    _resolve_targets(vocab)
    st = self_test(vocab)
    if not st.ok:
        raise Refused(f"{vocab.id}: does not read its own examples — " + " | ".join(st.failures))
    return vocab


def load(path):
    try:
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
    except OSError as error:
        raise LoadError(f"cannot read {path}: {error}")
    except ValueError as error:
        raise Refused(f"{path}: not valid JSON: {error}")
    return build(raw, path)


# ---------------------------------------------------------------- reading

class KindReading:
    def __init__(self, kind, score, evidence):
        self.id = kind.id
        self.label = kind.label
        self.plain = kind.plain
        self.targets = list(kind.targets)
        self.score = score
        self.evidence = evidence

    def to_json(self):
        return {"id": self.id, "label": self.label, "score": self.score, "plain": self.plain,
                "targets": self.targets, "evidence": [[c, i] for c, i in self.evidence]}


class Reading:
    def __init__(self, vocab, verdict, reason, kinds, na_score, na_evidence, scores):
        self.vocabulary = vocab.id
        self.consumer = vocab.consumer
        self.version = vocab.version
        self.verdict = verdict
        self.reason = reason
        self.kinds = kinds
        self.na_score = na_score
        self.na_evidence = na_evidence
        self.scores = scores

    def to_json(self):
        return {"vocabulary": self.vocabulary, "version": self.version, "consumer": self.consumer,
                "verdict": self.verdict,
                "reason": self.reason, "kinds": [k.to_json() for k in self.kinds],
                "na_score": self.na_score, "na_evidence": [[c, i] for c, i in self.na_evidence],
                "advisory": "a reading informs; it never gates (reads words, not meaning)"}

    def line(self):
        head = f"[read {self.vocabulary}: "
        if self.verdict == "OK":
            parts = [f"{_named(k)} ({', '.join(c for c, _ in k.evidence)})" for k in self.kinds]
            return head + " · ".join(parts) + "]"
        if self.reason == "plumbing":
            return head + f"n/a — plumbing ({', '.join(c for c, _ in self.na_evidence)})]"
        if self.reason == "gate-no-kind":
            return head + "REFUSED — gate vocabulary, no kind read; deciding nothing]"
        if self.reason == "ambiguous":
            tops = sorted(self.scores.items(), key=lambda kv: (-kv[1], kv[0]))[:2]
            return head + "ambiguous — " + " · ".join(f"{k} {s}" for k, s in tops) + "]"
        return head + "no kind]"


def _named(k):
    """The id, plus the label when the id alone would not tell a person what the kind is (Theo's rule)."""
    return k.id if "-".join(normalize(k.label)) == k.id else f"{k.id} «{k.label}»"


def _score(cues, negative, tokens):
    evidence, total = [], 0
    for display, toks, weight in cues:
        at = first_match(toks, tokens)
        if at is not None:
            evidence.append((display, at))
            total += weight
    for display, toks, weight in negative:
        if first_match(toks, tokens) is not None:
            total -= weight
    evidence.sort(key=lambda e: (e[1], e[0]))
    return max(total, 0), evidence


def read(text, vocab, stray_log=None):
    """Pure and total (the optional stray_log append is the one side effect, opt-in)."""
    tokens = normalize(text)
    scored = []
    for kind in vocab.kinds:
        score, evidence = _score(kind.cues, kind.negative, tokens)
        scored.append((kind, score, evidence))
    na_score, na_evidence = _score(vocab.na_cues, [], tokens)
    scores = {k.id: s for k, s, _ in scored}
    best = max(scores.values()) if scores else 0
    hits = [KindReading(k, s, e) for k, s, e in scored if s >= max(vocab.min_score, 1)]
    hits.sort(key=lambda r: (-r.score, r.id))
    if na_score > 0 and na_score > best:
        reading = Reading(vocab, "SKIP", "plumbing", [], na_score, na_evidence, scores)
    elif not hits:
        reading = Reading(vocab, "SKIP", "none", [], na_score, na_evidence, scores)
    elif vocab.mode == "single" and len(hits) > 1 and hits[0].score - hits[1].score <= vocab.tie_margin:
        reading = Reading(vocab, "FLAG", "ambiguous", hits, na_score, na_evidence, scores)
    else:
        kept = hits[:1] if vocab.mode == "single" else hits
        reading = Reading(vocab, "OK", "", kept, na_score, na_evidence, scores)
    if vocab.consumer == "gate" and reading.verdict == "SKIP" and reading.reason == "none":
        reading = Reading(vocab, "REFUSED", "gate-no-kind", [], na_score, na_evidence, scores)
    if stray_log and reading.reason in ("none", "gate-no-kind"):
        _append(stray_log, {"event": "miss", "vocabulary": vocab.id, "version": vocab.version,
                            "text": " ".join(tokens), "sha": _sha(tokens)})
    return reading


# ---------------------------------------------------------------- self-test, collisions, coverage

class SelfTest:
    def __init__(self):
        self.examples_total = self.examples_right = 0
        self.counter_total = self.counter_right = 0
        self.na_total = self.na_right = 0
        self.failures = []

    @property
    def ok(self):
        return not self.failures


def self_test(vocab):
    st = SelfTest()
    for kind in vocab.kinds:
        for text in kind.examples:
            st.examples_total += 1
            r = read(text, vocab)
            ids = [k.id for k in r.kinds] if r.verdict == "OK" else []
            good = (ids == [kind.id]) if vocab.mode == "single" else (kind.id in ids)
            if good:
                st.examples_right += 1
            else:
                st.failures.append(f"example of {kind.id} misread: \"{text}\" -> {r.line()}")
        for text in kind.counterexamples:
            st.counter_total += 1
            r = read(text, vocab)
            if kind.id in [k.id for k in r.kinds]:
                st.failures.append(f"counterexample of {kind.id} reads {kind.id}: \"{text}\" -> {r.line()}")
            else:
                st.counter_right += 1
    for text in vocab.na_examples:
        st.na_total += 1
        r = read(text, vocab)
        if (r.verdict, r.reason) == ("SKIP", "plumbing"):
            st.na_right += 1
        else:
            st.failures.append(f"n/a example does not read plumbing: \"{text}\" -> {r.line()}")
    return st


def collisions(vocab):
    """Cue strings owned by more than one kind -> [(cue, [kind ids])], sorted."""
    owners = {}
    for kind in vocab.kinds:
        for display, _toks, _w in kind.cues:
            owners.setdefault(display, [])
            if kind.id not in owners[display]:
                owners[display].append(kind.id)
    return sorted((c, sorted(ks)) for c, ks in owners.items() if len(ks) > 1)


def cues_tested(vocab):
    """-> (cues fired by at least one of their own kind's examples, all cues). Non-vacuity (the Chalk Line rule)."""
    tested = total = 0
    for kind in vocab.kinds:
        example_tokens = [normalize(e) for e in kind.examples]
        for _display, toks, _w in kind.cues:
            total += 1
            if any(first_match(toks, ex) is not None for ex in example_tokens):
                tested += 1
    return tested, total


def target_coverage(vocab):
    """-> (registry ids some kind leads to, registry ids), or None without a registry."""
    if vocab.registry_ids is None:
        return None
    led = {t for k in vocab.kinds for t in k.targets} & vocab.registry_ids
    return len(led), len(vocab.registry_ids)


def check_line(vocab):
    st = self_test(vocab)
    cov = target_coverage(vocab)
    circ = "yes (derived — not evidence)" if vocab.provenance == "derived" else "no"
    parts = [f"{vocab.id} v{vocab.version}", f"{len(vocab.kinds)} kinds",
             f"{st.examples_right}/{st.examples_total} examples",
             f"{st.counter_right}/{st.counter_total} counterexamples",
             "cues tested {}/{}".format(*cues_tested(vocab))]
    if st.na_total:
        parts.append(f"n/a {st.na_right}/{st.na_total}")
    parts += [f"consumer: {vocab.consumer}", f"circular: {circ}", f"collisions: {len(collisions(vocab))}",
              f"targets: {cov[0]}/{cov[1]}" if cov else "targets: —"]
    return " · ".join(parts)


# ---------------------------------------------------------------- strays and fold

def _sha(tokens):
    return hashlib.sha256(" ".join(tokens).encode("utf-8")).hexdigest()[:16]


def _append(path, row):
    parent = os.path.dirname(os.path.abspath(path))
    os.makedirs(parent, exist_ok=True)
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, sort_keys=True) + "\n")


HELDOUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "heldout")


def heldout_shas(heldout_dir=None):
    """{sha of normalized text} over every held-out set. A held-out text filed as a stray or folded into a vocabulary
    would grade the reader on its own homework, so it is refused at both doors (the contamination guard)."""
    import glob as _glob
    shas = set()
    for path in _glob.glob(os.path.join(heldout_dir or HELDOUT_DIR, "*.json")):
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        for item in data.get("items", []):
            shas.add(_sha(normalize(item.get("text", ""))))
    return shas


MIN_STRAY_TOKENS = 6
MIN_WITNESS_TEXTS = 2
MIN_WITNESS_SESSIONS = 2


def record_stray(vocab, kind_id, cue, text, log, proposer, source=None, heldout_dir=None):
    """A judgment-rung assertion: this text is kind_id, and cue should have led there. Proposes only.
    Refused unless the cue's words occur in order in the text, the text has MIN_STRAY_TOKENS tokens, and the
    proposing session is named (P1 item 2)."""
    if kind_id not in {k.id for k in vocab.kinds}:
        raise Refused(f"stray: no kind '{kind_id}' in {vocab.id}")
    if not str(proposer or "").strip():
        raise Refused("stray: --proposer <session id> is required (the witness rule counts sessions)")
    display, toks, _w = parse_cue(cue, "stray.cue")
    tokens = normalize(text)
    if len(tokens) < MIN_STRAY_TOKENS:
        raise Refused(f"stray: the text has {len(tokens)} token(s); a proposal needs at least {MIN_STRAY_TOKENS}")
    if first_match(toks, tokens) is None:
        raise Refused(f"stray: the cue '{display}' does not occur, in order, in the text — a cue must name words "
                      "the text actually has")
    if _sha(tokens) in heldout_shas(heldout_dir):
        raise Refused("stray: this text is in a held-out set; filing it would contaminate the measure")
    row = {"event": "assert", "vocabulary": vocab.id, "kind": kind_id, "cue": display,
           "text": " ".join(tokens), "sha": _sha(tokens), "proposer": str(proposer).strip()}
    if source:
        row["source"] = str(source)
    _append(log, row)
    return row


def read_strays(log):
    rows = []
    try:
        with open(log, encoding="utf-8") as fh:
            for n, line in enumerate(fh, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    raise Refused(f"{log}:{n}: not a JSON line")
    except FileNotFoundError:
        return []
    return rows


class FoldResult:
    def __init__(self, vocabulary, promoted, refused, waiting):
        self.vocabulary = vocabulary
        self.promoted = promoted
        self.refused = refused
        self.waiting = waiting


def _owner_of(vocab, cue_tokens, kind_id):
    """Another kind whose cue would match this cue's words, or whose words this cue would match."""
    bare = [t.rstrip("*") for t in cue_tokens]
    for kind in vocab.kinds:
        if kind.id == kind_id:
            continue
        for display, toks, _w in kind.cues:
            if first_match(toks, bare) is not None or first_match(cue_tokens, [t.rstrip("*") for t in toks]) is not None:
                return kind.id, display
    return None


def fold(vocab, strays, decided=None, decided_session=None, heldout_dir=None):
    """Promote (kind, cue) pairs whose witnesses are >= 2 distinct texts from >= 2 distinct proposer sessions (the
    witness rule, P1 item 3), one at a time, in sorted order. When `decided_session` is given (the session that
    recorded the blessing DECIDED), a pair that session witnessed is refused: the bless must come from a third
    session.

    Each promotion must be monotone (every prior example and counterexample still reads right), collision-free
    (no other kind owns the cue) and must make its own texts read the kind. Returns the new vocabulary
    (unchanged if nothing promoted) — the caller decides whether to write it.
    """
    groups = {}
    held = heldout_shas(heldout_dir)
    contaminated = []
    for row in strays:
        if row.get("event") != "assert" or row.get("vocabulary") != vocab.id:
            continue
        if row.get("sha") in held or _sha(normalize(row.get("text", ""))) in held:
            contaminated.append({"kind": row.get("kind"), "cue": row.get("cue"),
                                 "why": "a held-out text was filed as a stray; it is never folded"})
            continue
        groups.setdefault((row["kind"], row["cue"]), {}).setdefault(row["sha"], [row["text"], set()])
        if row.get("proposer"):
            groups[(row["kind"], row["cue"])][row["sha"]][1].add(row["proposer"])
    current = vocab
    promoted, refused, waiting = [], list(contaminated), []
    for (kind_id, cue), witnessed in sorted(groups.items()):
        texts = {sha: entry[0] for sha, entry in witnessed.items()}
        sessions = sorted(set().union(*(entry[1] for entry in witnessed.values())))
        kind = next((k for k in current.kinds if k.id == kind_id), None)
        if kind is None:
            refused.append({"kind": kind_id, "cue": cue, "why": "no such kind"})
            continue
        if cue in [d for d, _t, _w in kind.cues]:
            continue
        if len(texts) < MIN_WITNESS_TEXTS or len(sessions) < MIN_WITNESS_SESSIONS:
            waiting.append({"kind": kind_id, "cue": cue, "count": len(texts), "sessions": len(sessions)})
            continue
        if decided_session and decided_session in sessions:
            refused.append({"kind": kind_id, "cue": cue, "why": f"the blessing session {decided_session} is one of "
                            "its witnesses; the bless must come from a third session"})
            continue
        _d, toks, _w = parse_cue(cue, "fold")
        owner = _owner_of(current, toks, kind_id)
        if owner:
            refused.append({"kind": kind_id, "cue": cue, "why": f"cue owned by {owner[0]} ('{owner[1]}')"})
            continue
        raw = json.loads(json.dumps(current.raw))
        k_raw = next(k for k in raw["kinds"] if k["id"] == kind_id)
        k_raw["cues"].append(cue)
        new_texts = [texts[s] for s in sorted(texts)]
        k_raw["examples"].extend(t for t in new_texts if t not in k_raw["examples"])
        raw["version"] = current.version + 1
        if raw["provenance"] == "authored":
            raw["provenance"] = "folded"
        entry = {"version": raw["version"], "event": "fold", "note": f"{kind_id} += '{cue}' from {len(texts)} strays",
                 "witnesses": sessions}
        if decided:
            entry["decided"] = decided
        raw.setdefault("history", []).append(entry)
        try:
            current = build(raw, current.path)
        except Refused as error:
            why = str(error)
            if "counterexample" in why:
                why = "non-monotone: a counterexample would read the kind — " + why
            refused.append({"kind": kind_id, "cue": cue, "why": why})
            continue
        promoted.append({"kind": kind_id, "cue": cue, "texts": new_texts, "sessions": sessions})
    return FoldResult(current, promoted, refused, waiting)


def write_vocabulary(vocab, path):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(vocab.raw, fh, indent=1, ensure_ascii=False)
        fh.write("\n")


# ---------------------------------------------------------------- CLI

def _cmd_read(args):
    vocab = load(args.vocab)
    text = sys.stdin.read() if args.text in (None, "-") else args.text
    reading = read(text, vocab, stray_log=args.stray_log)
    print(json.dumps(reading.to_json(), sort_keys=True, ensure_ascii=False) if args.json else reading.line())
    return EXIT[reading.verdict]


def _cmd_check(args):
    worst = 0
    for path in args.vocab:
        try:
            vocab = load(path)
        except Refused as error:
            print(f"REFUSED {path}: {error}", file=sys.stderr)
            worst = max(worst, 4)
            continue
        except LoadError as error:
            print(f"ERROR {error}", file=sys.stderr)
            worst = 2 if worst == 0 else worst
            continue
        if args.json:
            st = self_test(vocab)
            print(json.dumps({"vocabulary": vocab.id, "version": vocab.version, "provenance": vocab.provenance,
                              "kinds": len(vocab.kinds), "examples": [st.examples_right, st.examples_total],
                              "counterexamples": [st.counter_right, st.counter_total], "na": [st.na_right, st.na_total],
                              "collisions": collisions(vocab), "targets": target_coverage(vocab)}, sort_keys=True))
        else:
            print(check_line(vocab))
            for cue, owners in collisions(vocab):
                print(f"  collision: '{cue}' owned by {', '.join(owners)}")
    return worst


def _cmd_list(args):
    directory = args.dir or os.path.join(os.path.dirname(os.path.abspath(__file__)), "vocabularies")
    try:
        names = sorted(os.listdir(directory))
    except OSError as error:
        raise LoadError(f"no vocabulary directory: {directory} ({error.strerror})")
    worst = 0
    for name in names:
        if not name.endswith(".json"):
            continue
        path = os.path.join(directory, name)
        try:
            vocab = load(path)
            print(f"{check_line(vocab)} · provenance {vocab.provenance}")
        except (Refused, LoadError) as error:
            print(f"REFUSED {name}: {error}")
            worst = 4
    return worst


def _cmd_stray(args):
    vocab = load(args.vocab)
    row = record_stray(vocab, args.kind, args.cue, args.text, args.log, args.proposer, args.source)
    print(f"stray recorded: {row['kind']} <- '{row['cue']}' ({row['sha']})")
    return 0


EVENTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "core", "_events")


def decided_session_of(decision_id, events_dir=None):
    """The session that recorded DECIDED `decision_id` in the events directory (the bless must be on record, not named).
    Refused when no such event exists."""
    import glob as _glob
    for path in sorted(_glob.glob(os.path.join(events_dir or EVENTS_DIR, "*.jsonl"))):
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                if decision_id not in line:
                    continue
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                if event.get("verb") == "DECIDED" and event.get("decision_id") == decision_id:
                    return event.get("session") or ""
    raise Refused(f"fold --write: no DECIDED '{decision_id}' is recorded in the events directory (--events) — record the bless first")


def _cmd_fold(args):
    vocab = load(args.vocab)
    if args.write and not args.decided:
        raise Refused("fold --write needs --decided <decision_id>: a fold rewrites the vocabulary from its own misses, "
                      "so it needs a recorded bless (derive-bless-enforce; V4a). Dry-run without --write first.")
    decided_session = decided_session_of(args.decided, args.events) if args.write else None
    result = fold(vocab, read_strays(args.log), decided=args.decided, decided_session=decided_session)
    for p in result.promoted:
        print(f"PROMOTE {p['kind']} += '{p['cue']}' ({len(p['texts'])} strays)")
    for r in result.refused:
        print(f"REFUSE  {r['kind']} '{r['cue']}': {r['why']}")
    for w in result.waiting:
        print(f"WAIT    {w['kind']} '{w['cue']}' ({w['count']} of {MIN_WITNESS_TEXTS} texts, {w.get('sessions', 0)} of "
              f"{MIN_WITNESS_SESSIONS} sessions)")
    if result.promoted and args.write:
        write_vocabulary(result.vocabulary, args.vocab)
        print(f"wrote {args.vocab} v{result.vocabulary.version}")
    elif result.promoted:
        print("dry run — pass --write to fold")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="lead_in.py", description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="verb", required=True)
    p = sub.add_parser("read"); p.add_argument("vocab"); p.add_argument("text", nargs="?")
    p.add_argument("--json", action="store_true"); p.add_argument("--stray-log")
    p = sub.add_parser("check"); p.add_argument("vocab", nargs="+"); p.add_argument("--json", action="store_true")
    p = sub.add_parser("list"); p.add_argument("dir", nargs="?")
    p = sub.add_parser("stray"); p.add_argument("vocab"); p.add_argument("text")
    p.add_argument("--kind", required=True); p.add_argument("--cue", required=True); p.add_argument("--log", required=True)
    p.add_argument("--proposer", required=True); p.add_argument("--source")
    p = sub.add_parser("fold"); p.add_argument("vocab"); p.add_argument("--log", required=True)
    p.add_argument("--write", action="store_true"); p.add_argument("--decided"); p.add_argument("--events")
    args = ap.parse_args(argv)
    handler = {"read": _cmd_read, "check": _cmd_check, "list": _cmd_list, "stray": _cmd_stray, "fold": _cmd_fold}[args.verb]
    try:
        return handler(args)
    except Refused as error:
        print(f"REFUSED: {error}", file=sys.stderr)
        return 4
    except LoadError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BrokenPipeError:            # `lead_in.py read … | head` closed the pipe: a quiet exit, never a traceback
        try:
            sys.stdout = open(os.devnull, "w")
        except OSError:
            pass
        sys.exit(0)
