#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""
verify.py — the Verification System's one net-new primitive: a cheap re-check of
a learned fact, keyed on a kept certificate.

The idea (Kindling deliberate, S16.1613, verification-system line):
  "Don't trust, verify" is cardinal — but verify CHEAPLY. Establishing a fact
  X -> Y is expensive (~20 min). Re-checking that a claimed X -> Y still holds is
  cheap (~1s) IF you kept the right certificate. That is the NP / certificate-
  checking asymmetry, and the certificate is a CONTENT HASH of the derivation's
  byte-truth inputs. A fact is FRESH iff its inputs still hash to what they
  hashed when the certificate was kept; if an input moved, it is STALE and must
  be re-derived; if the derivation's ground is gone (a required input missing) or
  the fact was retired, it is DEAD.

  This is content-addressed cache invalidation over a derivation DAG — the build-
  cache primitive (Nix/Bazel/ccache), git's own Merkle tree, Certificate
  Transparency — the primitive the floor already grew independently
  (`git hash-object`, Amber blob-SHA fixity, the Loop-Line content-address) but
  never generalized into a cheap fact-re-check. This is that generalization, and
  nothing more (Constraint drive: a spine + one primitive + the taxonomy, no
  engine).

THE HONEST CEILING (Wren's binding cut, deliberate C2):
  The verdict is CERTIFICATE-FRESHNESS, NEVER TRUTH. `fresh` means the byte-truth
  inputs the derivation stood on are UNCHANGED — it does NOT re-run the judgment
  that made X -> Y true. The claim was judged true when it was ESTABLISHED; this
  tool proves the ground under it has not moved. Calling `fresh` "true" is the
  Cruise's "1,511 passing tests" lie one level up (Match != Prevention, borrowed
  from Wobble RECALL). A verification cache is VISIBILITY, NOT IMMUNITY: it cannot
  force re-derivation on a miss; the operator/floor stays the witness.

THE FORMAL LIMIT (deliberate C5, Shannon Corollary — named, not relabeled around):
  Cheap verification holds ONLY for the byte-truth-derivable fact class — facts
  whose input set is finite, content-addressable, and stable-when-nothing-changes.
  Live/external facts ("current price", "who is CEO now") cannot be cheaply
  certified — their input set is the world, which you cannot cheaply re-hash — and
  route to the Customs House re-acquire path (fail-closed), NOT this cache. The
  `provenance_class` field carries that split (C4: internal fails open to
  re-derive; external fails closed).

Reuse map (C6 — composition, not duplication):
  - `git hash-object`          -> the content-address primitive (the certificate)
  - the Lode's append-only fold -> the registry shape (verified.jsonl -> fold)
  - the Loop-Line content-addr  -> the re-check-on-pull mechanic
  - Amber blob-SHA fixity       -> snapshot certs

THE ASSUMPTION CELL (S16.1707, claim-grounding line — the family's second species):
  A FACT is a claim whose ground you CHECKED and PINNED (the certificate = the
  input hashes). An ASSUMPTION is a claim you are leaning on whose ground you have
  NOT checked — you DEFERRED the check. Same claim; different grounding-state. They
  are ONE register at two points of one lifecycle:

      assume --(discharge: run the path, pin the inputs)--> verified (a fact)
      verified --(an input moves)--> STALE --(re-derive)--> verified
      (STALE is a fact fallen back to assumption-status: leaned-on, un-recertified.)

  FORMAL GROUND (why this is not a bolt-on):
    - Promotion assume->fact IS natural-deduction DISCHARGE: an assumption is an
      undischarged hypothesis [A]; `discharge` closes it by pinning its ground.
      Mechanized for free by the fold's latest-wins (a `verified` event with the
      same fact_id supersedes the `assumed` one).
    - A fact's verdict is derivability: `fresh` means the derivation still holds
      on unchanged premises (|-), NEVER that the claim is true in the world (|=).
      `fresh != true` IS `|- != |=`. The assumption razor is the same gap one
      species over:  `UNEXPIRED != true`  — an assumption whose expiry has not
      tripped is only NOT-YET-KNOWN-STALE, never verified.
    - The species boundary is DECIDABILITY (Shannon Corollary). A fact's check is
      a decidable, cheap hash-compare over a finite pinned input set. An
      assumption's ground is NOT in that class yet (that is WHY it is deferred),
      so its defeater is an EXPIRY CONDITION, not a hash-watch.

  THE DECIDABLE-COLLAPSE RULE (the one that keeps this honest & minimal):
    If your expiry condition is "when file X changes", that is BYTE-WATCHABLE —
    it is a FACT, not an assumption: `register` it with X as an input. `assume`
    is deliberately for the NON-byte-watchable case (a date, an external event, a
    human judgement), and therefore takes NO --inputs. Its defeater cannot be
    auto-checked, so `verify` on an assumption does NOT fake a freshness verdict —
    it SURFACES the claim, its verification path, its expiry, and the razor, and
    hands the judgement to the human (visibility, not immunity; Nyx: hope is not a
    control, so the tool does not pretend to be one).

THE DECISION CELL (S16.1822, claim-grounding line — the family's THIRD species):
  A FACT is a claim whose ground you CHECKED and PINNED (its input hashes). An
  ASSUMPTION is a claim whose ground you DEFERRED. A DECISION is a claim of the
  form "A beats B" whose ground is neither a set of input files nor a deferred
  expiry — it is the set of PREMISES the choice rested on, and each premise is
  itself a register entry (a fact-id or an assume-id). So a decision's certificate
  is a COMPOSITE, and its grounding-state is DERIVED from its premises':

      decide --decision-id D --claim "A beats B" --options "A;B;C" --chose A
             --premises fact-1 assume-2 ...        (premises = existing entry ids)
      verify --fact-id D    folds the premises' grounding-states:
        FRESH    iff every premise-FACT is FRESH  ∧ no premise is a live assumption
        STALE    iff any premise-FACT moved       (named — that is the defeater)
        DEAD     iff any premise was retired or is not on file (the ground is gone)
        ASSUMED  iff the decision rests on a live assumption (surfaced — you judge)

  Trap 1 avoided — NO NEW ENGINE: `decided` is a third `kind` in the SAME
  register, the SAME append-only log, the SAME latest-wins fold, composing the
  fact + assumption cells. Not a decision engine; a third grounding-state.
  Trap 2 avoided — the decision does NOT re-hash its premises' input files. It
  DEFERS to each premise's OWN certificate (its `verify`), recursing for a nested
  decision-premise. Hashing them directly would duplicate the fact cell and lose
  an assumption-premise's human-judged defeater.

  THE RAZOR, ONE LEVEL UP (the honest ceiling — get this exactly right):
      decision-fresh != decision-still-right.
  The premises holding does NOT mean A still beats B: a NEW option F could beat A
  with no premise moving. `verify(decision)` checks PREMISE-STABILITY — it never
  re-runs the choice. Same |- vs |= shape as the fact cell: premises-unchanged
  (|-) is not conclusion-still-optimal (|=). Composed with the assumption razor:
  a decision is only as grounded as its WEAKEST premise, and even all-fresh
  premises do not re-decide the question.

  Decidable-collapse analog: a decision whose premises are all byte-watchable
  FACTS has a fully decidable re-check (verify each premise fact); one resting on
  an ASSUMPTION inherits that assumption's human-judged defeater and SURFACES.

The use-case taxonomy (deliberate C3, the operator's explicit ask):
  REGISTER  a fact after an expensive, re-encounterable derivation (not everything)
  ASSUME    a claim you are leaning on but have NOT yet grounded (deferred check)
  DECIDE    record a choice "A beats B" + the premises it rested on (grounds keyed)
  ASK       (verify) before a load-bearing move / at check-before-build
  DISCHARGE run an assumption's verification path, pin its inputs -> it becomes a fact
  RE-DERIVE on stale or a cache miss
  CALL DEAD (retire) when the DERIVATION is retired, not just an input moved
  SUPERSEDE re-derive to a different value -> old cert superseded, not deleted
  QUARANTINE external facts fail closed (provenance_class)

Verbs:
  register    --fact-id ID --claim "..." [--edge "X->Y"] --inputs f1 [f2 ...]
                                       [--provenance internal|external]
  assume      --fact-id ID --claim "..." --path "how to discharge" --expiry "the defeater"
                                       [--evidence "the weak signal leaned on"]
  decide      --decision-id ID --claim "A beats B" --options "A;B;C" --chose A
                                       --premises f1 [f2 ...]   (refs to existing entries)
  verify      --fact-id ID          re-check (fact) / SURFACE (assumption) / FOLD (decision)
  discharge   --fact-id ID --inputs f1 [f2 ...]   run the path, pin the ground -> a fact
  retire      --fact-id ID --reason "..."   call it dead (Wren)
  list                              the derived registry (pure fold, latest-wins)
  fold --check                      fold-twice-identical invariant (the Lode contract)

  A decision-id lives in the SAME keyspace as fact-ids (one register). Verify one
  with `verify --fact-id <decision-id>` — there is no separate decision verify.

Exit codes (verify):
  0  fresh   — every input hash unchanged (a fact) / every premise fresh (a decision).
               CERTIFICATE FRESH, not "true".
  3  stale   — at least one input hash / premise-fact moved -> re-derive
  5  dead     — a required input missing, a premise not on file, OR retired
  4  unregistered — no certificate on file for that fact_id
  6  assumed  — the id is an ASSUMPTION (or a decision resting on a live assumption):
               SURFACED with path + expiry + the razor (UNEXPIRED != true).
  2  error / usage (includes a decision certificate that references itself — a cycle)
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

# Standalone default: the store lives under the current working directory (like .git/).
# Override with VERIFY_REPO_ROOT to point the fact store somewhere else.
REPO_ROOT = os.getcwd()
FACTS_RELDIR = ".verify"
EVENTS_BASENAME = "verified.jsonl"

FRESH, STALE, DEAD, UNREGISTERED, ERROR = 0, 3, 5, 4, 2
ASSUMED = 6  # the assumption cell: the id is ungrounded — surfaced, not verified
# The decision cell (S16.1822) is a third grounding-state that REUSES these codes,
# no new taxonomy: a decision folds to FRESH/STALE/DEAD, or ASSUMED when it rests
# on a live assumption-premise. ERROR covers a self-referential (cyclic) certificate.


# ── The certificate primitive: content-address a byte-truth input ──────

def blob_sha(path):
    """The git blob SHA-1 of a file's bytes — the SAME primitive the floor uses
    (`git hash-object`, Amber, the Loop-Line). Computed directly so the tool works
    on any path with no subprocess and no git-checkout dependency, and returns the
    identical value `git hash-object <path>` would. Returns None if the file is
    absent from disk (the DEAD signal: the derivation's ground is gone)."""
    if not os.path.isfile(path):
        return None
    with open(path, "rb") as fh:
        data = fh.read()
    header = b"blob " + str(len(data)).encode() + b"\0"
    return hashlib.sha1(header + data).hexdigest()


def events_path(repo_root):
    return os.path.join(repo_root, FACTS_RELDIR, EVENTS_BASENAME)


def read_events(repo_root):
    """Read the append-only event log (JSONL). Absent log = empty set (cold-safe)."""
    p = events_path(repo_root)
    if not os.path.isfile(p):
        return []
    events = []
    with open(p, "r", encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{EVENTS_BASENAME}:{lineno}: bad JSON: {exc}")
            events.append(ev)
    return events


def append_event(repo_root, ev):
    """Append-only write (the Lode / Strike-Log contract: never rewrite a row)."""
    p = events_path(repo_root)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    existing = read_events(repo_root)
    same_day = [e for e in existing if e.get("date") == ev["date"]]
    ev["seq"] = 1 + max([e.get("seq", 0) for e in same_day], default=0)
    with open(p, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(ev, sort_keys=True) + "\n")
    return ev


# ── The pure fold: events -> the derived registry (latest-wins per fact) ──

def fold(events):
    """Pure, deterministic fold over the append-only log -> the registry projection.
    Latest event per fact_id wins (register / retire). Folding the same events twice
    yields a byte-identical projection (the Lode's fold-twice-identical contract)."""
    order = sorted(range(len(events)), key=lambda i: (
        events[i].get("date", ""), events[i].get("seq", 0), i))
    latest = {}
    for i in order:
        ev = events[i]
        fid = ev.get("fact_id")
        if fid is None:
            continue
        latest[fid] = ev  # last write wins in deterministic order
    registry = []
    for fid in sorted(latest):
        registry.append(latest[fid])
    return registry


def render_registry(registry):
    """Deterministic markdown-ish text render of the derived registry (for `list`)."""
    lines = ["# The Verification Registry (derived — do not hand-edit)",
             f"# facts: {len(registry)}", ""]
    for rec in registry:
        kind = rec.get("kind")
        if kind == "retired":
            state = "RETIRED (dead)"
        elif kind == "assumed":
            state = "ASSUMED (ungrounded)"
        elif kind == "decided":
            state = "DECIDED (premise-grounded)"
        else:
            state = rec.get("provenance_class", "internal")
        lines.append(f"- {rec['fact_id']}  [{state}]")
        lines.append(f"    claim: {rec.get('claim', '')}")
        if rec.get("edge"):
            lines.append(f"    edge:  {rec['edge']}")
        if kind == "retired":
            lines.append(f"    retired: {rec.get('reason', '')}")
        elif kind == "assumed":
            lines.append(f"    verification-path: {rec.get('verification_path', '')}")
            lines.append(f"    expiry (defeater):  {rec.get('expiry', '')}")
            if rec.get("evidence"):
                lines.append(f"    evidence: {rec['evidence']}")
        elif kind == "decided":
            opts = rec.get("options", [])
            prem = rec.get("premises", [])
            lines.append(f"    chose:    {rec.get('chose', '')}  (of {', '.join(opts)})")
            lines.append(f"    premises: {len(prem)} entry-ref(s) — {', '.join(prem)}")
        else:
            lines.append(f"    inputs: {len(rec.get('input_refs', []))} content-hashed @ {rec.get('established_at', '')}")
    return "\n".join(lines) + "\n"


# ── The verbs ──────────────────────────────────────────────────────────

def cmd_register(args, repo_root):
    inputs = args.inputs or []
    if not inputs:
        print("verify register: --inputs is required (a fact with no byte-truth "
              "inputs has no certificate)", file=sys.stderr)
        return ERROR
    input_hashes = []
    for ref in inputs:
        h = blob_sha(ref if os.path.isabs(ref) else os.path.join(repo_root, ref))
        if h is None:
            print(f"verify register: input not found on disk: {ref}", file=sys.stderr)
            return ERROR
        input_hashes.append(h)
    now = datetime.now(timezone.utc)
    ev = {
        "kind": "verified",
        "fact_id": args.fact_id,
        "claim": args.claim,
        "edge": args.edge or "",
        "input_refs": inputs,
        "input_hashes": input_hashes,
        "provenance_class": args.provenance,
        "established_at": now.isoformat(timespec="seconds"),
        "date": now.strftime("%d.%H%M"),
    }
    ev = append_event(repo_root, ev)
    print(f"REGISTERED {args.fact_id}  ({len(inputs)} input(s) content-hashed, "
          f"provenance={args.provenance})")
    print(f"  certificate kept @ {ev['established_at']}")
    print(f"  NOTE: registers the CERTIFICATE (the ground), not a truth guarantee.")
    return 0


def latest_for(events, fact_id):
    recs = [e for e in events if e.get("fact_id") == fact_id]
    if not recs:
        return None
    recs.sort(key=lambda e: (e.get("date", ""), e.get("seq", 0)))
    return recs[-1]


# ── The certificate re-check core (shared by the fact + decision cells) ──

def fact_verdict(rec, repo_root):
    """For a kind=verified rec: re-check its kept certificate against disk.
    Returns (code, moved, missing) — the ONE hash-compare both cmd_verify and a
    decision's premise-fold call, so the two cells share a verdict, never fork one."""
    refs = rec.get("input_refs", [])
    kept = rec.get("input_hashes", [])
    moved, missing = [], []
    for ref, k in zip(refs, kept):
        cur = blob_sha(ref if os.path.isabs(ref) else os.path.join(repo_root, ref))
        if cur is None:
            missing.append(ref)
        elif cur != k:
            moved.append(ref)
    if missing:
        return DEAD, moved, missing
    if moved:
        return STALE, moved, missing
    return FRESH, moved, missing


def premise_state(events, repo_root, pid, seen):
    """Resolve ONE premise id to its grounding-state CODE — the decision cell's
    Trap-2 discipline made mechanical: it DEFERS to the premise's OWN certificate
    (never re-hashes the premise's files as the decision's inputs), recursing for a
    nested decision-premise and guarding cycles. A premise not on file -> DEAD (the
    ground is gone); retired -> DEAD; a live assumption -> ASSUMED; a fact -> its
    fact_verdict; a decision -> its folded verdict."""
    if pid in seen:
        return ERROR  # a self-referential (cyclic) decision certificate
    rec = latest_for(events, pid)
    if rec is None:
        return DEAD
    kind = rec.get("kind")
    if kind == "retired":
        return DEAD
    if kind == "assumed":
        return ASSUMED
    if kind == "decided":
        return decision_verdict(events, repo_root, rec, seen | {pid})[0]
    return fact_verdict(rec, repo_root)[0]


def decision_verdict(events, repo_root, rec, seen):
    """Fold a decision's premises' grounding-states -> (code, breakdown).
    The decision's ground is DERIVED from its premises', not hashed. Precedence:
    DEAD > STALE > ASSUMED > FRESH (a gone premise is worse than a moved one is
    worse than an un-grounded one); ERROR on a cycle. `breakdown` is [(pid, code)]."""
    premises = rec.get("premises", [])
    breakdown = [(pid, premise_state(events, repo_root, pid, seen)) for pid in premises]
    codes = [c for _, c in breakdown]
    if ERROR in codes:
        return ERROR, breakdown
    if not premises:
        # a decision with no premises has no ground — treat as DEAD (defensive;
        # `decide` refuses to author one, so this is only reachable via a hand-edit)
        return DEAD, breakdown
    for worst in (DEAD, STALE, ASSUMED):
        if worst in codes:
            return worst, breakdown
    return FRESH, breakdown


def _code_word(code):
    return {FRESH: "FRESH", STALE: "STALE", DEAD: "DEAD",
            ASSUMED: "ASSUMED", ERROR: "CYCLE", UNREGISTERED: "UNREGISTERED"}.get(code, str(code))


_CODE_NAME = {FRESH: "fresh", STALE: "stale", DEAD: "dead",
              UNREGISTERED: "unregistered", ASSUMED: "assumed", ERROR: "error"}


def _verify_json(args, repo_root, events, rec):
    """Machine-readable verdict on stdout (the CEILING still prints on stderr, so a
    --json pipe stays clean). Reuses fact_verdict / decision_verdict, so the JSON
    verdict and exit code are identical to the human path."""
    out = {"fact_id": args.fact_id}
    if rec is None:
        out.update(verdict="unregistered", code=UNREGISTERED)
        print(json.dumps(out, sort_keys=True)); return UNREGISTERED
    kind = rec.get("kind")
    if kind == "retired":
        out.update(verdict="dead", code=DEAD, reason=rec.get("reason", ""))
        print(json.dumps(out, sort_keys=True)); return DEAD
    if kind == "assumed":
        out.update(verdict="assumed", code=ASSUMED, claim=rec.get("claim", ""),
                   verification_path=rec.get("verification_path", ""),
                   expiry=rec.get("expiry", ""))
        print(json.dumps(out, sort_keys=True)); return ASSUMED
    if kind == "decided":
        code, breakdown = decision_verdict(events, repo_root, rec, {args.fact_id})
        out.update(verdict=_CODE_NAME.get(code, "error"), code=code,
                   chose=rec.get("chose", ""),
                   premises=[{"id": pid, "state": _CODE_NAME.get(c, "error")}
                             for pid, c in breakdown])
        print(json.dumps(out, sort_keys=True)); return code
    code, moved, missing = fact_verdict(rec, repo_root)
    out.update(verdict=_CODE_NAME.get(code, "error"), code=code,
               moved=moved, missing=missing,
               provenance=rec.get("provenance_class", "internal"))
    print(json.dumps(out, sort_keys=True)); return code


def cmd_verify(args, repo_root):
    events = read_events(repo_root)
    rec = latest_for(events, args.fact_id)
    if getattr(args, "json", False):
        return _verify_json(args, repo_root, events, rec)
    if rec is None:
        print(f"UNREGISTERED {args.fact_id} — no certificate on file. "
              f"This is a cache MISS: re-derive the fact and register it.")
        return UNREGISTERED
    if rec.get("kind") == "retired":
        print(f"DEAD {args.fact_id} — the derivation was retired "
              f"({rec.get('reason', 'no reason given')}). Do not re-check a corpse.")
        return DEAD
    if rec.get("kind") == "assumed":
        # An assumption has NO pinned inputs to hash — surfacing it is the whole
        # point. Do NOT fake a freshness verdict on a human-judged defeater
        # (Nyx: hope is not a control; the tool does not pretend to be one).
        print(f"ASSUMED {args.fact_id} — this is an ASSUMPTION, not a fact. You are "
              f"about to lean on UNGROUNDED ground.")
        print(f"  claim: {rec.get('claim', '')}")
        print(f"  verification-path (run this to DISCHARGE it -> fact): "
              f"{rec.get('verification_path', '')}")
        print(f"  expiry (the defeater — YOU judge whether it has tripped): "
              f"{rec.get('expiry', '')}")
        if rec.get("evidence"):
            print(f"  evidence leaned on: {rec['evidence']}")
        print(f"  RAZOR: UNEXPIRED != true. An assumption whose expiry has not "
              f"tripped is only NOT-YET-KNOWN-STALE — never verified.")
        print(f"  If the expiry is really 'a file changed', this is a FACT: "
              f"register it with that file as an input instead.")
        return ASSUMED
    if rec.get("kind") == "decided":
        # A decision's ground is its premises. Fold their grounding-states —
        # DEFER to each premise's own certificate (Trap 2), never re-hash them.
        code, breakdown = decision_verdict(events, repo_root, rec, {args.fact_id})
        chose = rec.get("chose", "?")
        claim = rec.get("claim", "")
        if code == ERROR:
            cyc = [p for p, c in breakdown if c == ERROR]
            print(f"CYCLE {args.fact_id} — this decision certificate references "
                  f"itself (premise(s): {', '.join(cyc)}). A decision cannot ground "
                  f"itself; the certificate is malformed.")
            return ERROR
        # Name every premise in each failing class — the operator sees the whole
        # ground, then the single worst verdict.
        dead = [p for p, c in breakdown if c == DEAD]
        stale = [p for p, c in breakdown if c == STALE]
        assumed = [p for p, c in breakdown if c == ASSUMED]
        if code == DEAD:
            print(f"DEAD {args.fact_id} — the decision '{claim}' (chose {chose}) rests "
                  f"on premise(s) whose ground is GONE: {', '.join(dead)} "
                  f"(retired or not on file). The choice is no longer grounded.")
        elif code == STALE:
            print(f"STALE {args.fact_id} — the decision '{claim}' (chose {chose}) rests "
                  f"on premise-fact(s) that MOVED: {', '.join(stale)}. "
                  f"Re-derive the premise(s), then this decision may need re-deciding.")
        elif code == ASSUMED:
            print(f"ASSUMED {args.fact_id} — the decision '{claim}' (chose {chose}) rests "
                  f"on LIVE assumption(s): {', '.join(assumed)}. Its ground is only as "
                  f"grounded as those — YOU judge whether they still hold.")
        else:
            print(f"FRESH {args.fact_id} — the decision '{claim}' (chose {chose}): all "
                  f"{len(breakdown)} premise(s) still hold "
                  f"({', '.join(p for p, _ in breakdown)}).")
        # THE RAZOR, one level up — printed on EVERY decision verdict (honest ceiling).
        print(f"  RAZOR: decision-fresh != decision-still-right. Premises holding does "
              f"NOT mean {chose} still wins — a NEW option could beat it with no premise "
              f"moving. This checks PREMISE-STABILITY, it never re-runs the choice.")
        return code
    code, moved, missing = fact_verdict(rec, repo_root)
    if code == DEAD:
        print(f"DEAD {args.fact_id} — required input(s) missing from disk: "
              f"{', '.join(missing)}. The derivation's ground is gone.")
        return DEAD
    if code == STALE:
        print(f"STALE {args.fact_id} — input(s) moved since the certificate was "
              f"kept: {', '.join(moved)}. Re-derive and re-register.")
        return STALE
    refs = rec.get("input_refs", [])
    prov = rec.get("provenance_class", "internal")
    print(f"FRESH {args.fact_id} — certificate re-checks: all {len(refs)} input(s) "
          f"unchanged since {rec.get('established_at', '?')} (provenance={prov}).")
    print(f"  Cheap re-check passed. This asserts the GROUND is unchanged, "
          f"NOT that the claim was re-judged true.")
    if rec.get("edge"):
        print(f"  provenance: {rec['edge']}")
    return FRESH


def cmd_assume(args, repo_root):
    """Register an ASSUMPTION — a claim leaned on but NOT yet grounded. Takes no
    --inputs by design: an assumption has no pinned ground (that is what makes it
    an assumption). Its defeater is a human-judged expiry, not a hash-watch."""
    now = datetime.now(timezone.utc)
    ev = {
        "kind": "assumed",
        "fact_id": args.fact_id,
        "claim": args.claim,
        "verification_path": args.path,
        "expiry": args.expiry,
        "evidence": args.evidence or "",
        "provenance_class": "internal",
        "established_at": now.isoformat(timespec="seconds"),
        "date": now.strftime("%d.%H%M"),
    }
    append_event(repo_root, ev)
    print(f"ASSUMED {args.fact_id} — logged as an UNGROUNDED claim (deferred check).")
    print(f"  verification-path: {args.path}")
    print(f"  expiry (defeater): {args.expiry}")
    print(f"  NOTE: this is NOT a fact. `verify` will SURFACE it (exit 6), not "
          f"certify it. Run `discharge` to promote it once the path is run.")
    return 0


def cmd_discharge(args, repo_root):
    """Discharge an assumption -> a fact. Runs the verification path's RESULT: the
    caller pins the byte-truth inputs the (now-run) derivation stood on, and we
    append a `verified` event with the SAME fact_id. The fold's latest-wins makes
    it a fact (natural-deduction discharge, mechanized). `verify` then returns FRESH."""
    events = read_events(repo_root)
    rec = latest_for(events, args.fact_id)
    if rec is None:
        print(f"verify discharge: {args.fact_id} is not on file — nothing to "
              f"discharge (assume it first, or register it directly as a fact).",
              file=sys.stderr)
        return ERROR
    if rec.get("kind") != "assumed":
        print(f"verify discharge: {args.fact_id} is not an open assumption "
              f"(kind={rec.get('kind')}). Discharge only promotes an assumption.",
              file=sys.stderr)
        return ERROR
    inputs = args.inputs or []
    if not inputs:
        print("verify discharge: --inputs is required (discharge PINS the ground "
              "the verification path stood on — that is the certificate).",
              file=sys.stderr)
        return ERROR
    input_hashes = []
    for ref in inputs:
        h = blob_sha(ref if os.path.isabs(ref) else os.path.join(repo_root, ref))
        if h is None:
            print(f"verify discharge: input not found on disk: {ref}", file=sys.stderr)
            return ERROR
        input_hashes.append(h)
    now = datetime.now(timezone.utc)
    ev = {
        "kind": "verified",
        "fact_id": args.fact_id,
        "claim": rec.get("claim", ""),
        "edge": (args.edge or rec.get("verification_path", "")),
        "input_refs": inputs,
        "input_hashes": input_hashes,
        "provenance_class": rec.get("provenance_class", "internal"),
        "established_at": now.isoformat(timespec="seconds"),
        "date": now.strftime("%d.%H%M"),
    }
    append_event(repo_root, ev)
    print(f"DISCHARGED {args.fact_id} — assumption promoted to FACT "
          f"({len(inputs)} input(s) now content-hashed). Natural-deduction "
          f"discharge: the hypothesis is closed.")
    print(f"  `verify` now returns FRESH while the ground holds — and STALE the "
          f"moment it moves (a fact can fall back to assumption-status).")
    return 0


def cmd_decide(args, repo_root):
    """Record a DECISION — a choice 'A beats B' + the premises it rested on. The
    premises are REFERENCES to existing register entries (fact-ids / assume-ids),
    not fresh inputs (Trap 2): the decision's ground is COMPOSITE, and `verify`
    defers to each premise's own certificate. A decision-id lives in the same
    keyspace as fact-ids (one register)."""
    options = [o.strip() for o in (args.options or "").replace(";", ",").split(",") if o.strip()]
    if len(options) < 2:
        print("verify decide: --options needs at least two choices (a decision is "
              "'A beats B'); separate with ';' or ','.", file=sys.stderr)
        return ERROR
    if args.chose not in options:
        print(f"verify decide: --chose {args.chose!r} is not among --options "
              f"({', '.join(options)}). The chosen option must be one of the options.",
              file=sys.stderr)
        return ERROR
    premises = args.premises or []
    if not premises:
        print("verify decide: --premises is required (a decision with no premises has "
              "no ground). Reference the fact-ids / assume-ids the choice rested on.",
              file=sys.stderr)
        return ERROR
    events = read_events(repo_root)
    # A premise must already be on file — you cannot ground a decision on an entry
    # that does not exist. This also structurally forecloses self/forward cycles
    # (append-only + premises-must-exist), backstopped by the verify-time cycle guard.
    missing = [p for p in premises if latest_for(events, p) is None]
    if missing:
        print(f"verify decide: premise(s) not on file: {', '.join(missing)}. Register "
              f"or assume them first (a decision grounds on EXISTING entries).",
              file=sys.stderr)
        return ERROR
    if args.decision_id in premises:
        print(f"verify decide: a decision cannot list itself as a premise "
              f"({args.decision_id}). A decision cannot ground itself.", file=sys.stderr)
        return ERROR
    now = datetime.now(timezone.utc)
    ev = {
        "kind": "decided",
        "fact_id": args.decision_id,   # one keyspace: a decision-id IS a fact-id
        "claim": args.claim,
        "options": options,
        "chose": args.chose,
        "premises": premises,
        "provenance_class": "internal",
        "established_at": now.isoformat(timespec="seconds"),
        "date": now.strftime("%d.%H%M"),
    }
    append_event(repo_root, ev)
    kinds = {p: latest_for(events, p).get("kind") for p in premises}
    print(f"DECIDED {args.decision_id} — '{args.claim}' chose {args.chose} "
          f"(of {', '.join(options)}), grounded on {len(premises)} premise(s):")
    for p in premises:
        print(f"    {p}  [{kinds[p]}]")
    print(f"  `verify --fact-id {args.decision_id}` folds these premises' grounding-"
          f"states. RAZOR: decision-fresh != decision-still-right — it checks premise-"
          f"stability, it never re-runs the choice.")
    return 0


def cmd_retire(args, repo_root):
    events = read_events(repo_root)
    if latest_for(events, args.fact_id) is None:
        print(f"verify retire: {args.fact_id} is not registered.", file=sys.stderr)
        return ERROR
    now = datetime.now(timezone.utc)
    ev = {
        "kind": "retired",
        "fact_id": args.fact_id,
        "reason": args.reason,
        "date": now.strftime("%d.%H%M"),
        "established_at": now.isoformat(timespec="seconds"),
    }
    append_event(repo_root, ev)
    print(f"RETIRED {args.fact_id} — called dead ({args.reason}). "
          f"verify now returns DEAD; the corpse is not re-checked.")
    return 0


def cmd_list(args, repo_root):
    registry = fold(read_events(repo_root))
    sys.stdout.write(render_registry(registry))
    return 0


def cmd_fold(args, repo_root):
    events = read_events(repo_root)
    once = render_registry(fold(events))
    twice = render_registry(fold(events))
    if once != twice:
        print("FOLD CHECK FAILED — projection is not fold-twice-identical.", file=sys.stderr)
        return STALE  # exit 3, the projection-invariant breach code (Lode contract)
    print(f"FOLD OK — {len(fold(events))} fact(s), fold-twice-identical.")
    return 0


def build_parser():
    p = argparse.ArgumentParser(prog="verify", description="The Verification System — cheap certificate re-check of a learned fact.")
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("register", help="register a fact's certificate (after an expensive, re-encounterable derivation)")
    r.add_argument("--fact-id", required=True)
    r.add_argument("--claim", required=True)
    r.add_argument("--edge", default="", help="the derivation provenance, e.g. 'X -> Y'")
    r.add_argument("--inputs", nargs="+", required=True, help="the byte-truth input paths the derivation consumed")
    r.add_argument("--provenance", choices=["internal", "external"], default="internal")

    a = sub.add_parser("assume", help="register an ungrounded claim (a deferred check); takes NO --inputs by design")
    a.add_argument("--fact-id", required=True)
    a.add_argument("--claim", required=True)
    a.add_argument("--path", required=True, help="the verification path — how to discharge this to a fact")
    a.add_argument("--expiry", required=True, help="the defeater — the condition under which this stops holding")
    a.add_argument("--evidence", default="", help="the weak signal being leaned on (optional)")

    v = sub.add_parser("verify", help="cheap re-check: fresh / stale / dead (or SURFACE an assumption)")
    v.add_argument("--fact-id", required=True)
    v.add_argument("--json", action="store_true", help="machine-readable verdict on stdout (pipeline source)")

    d = sub.add_parser("discharge", help="run an assumption's path, pin its ground -> promote to a fact")
    d.add_argument("--fact-id", required=True)
    d.add_argument("--inputs", nargs="+", required=True, help="the byte-truth inputs the now-run derivation stood on")
    d.add_argument("--edge", default="", help="the derivation provenance (defaults to the assumption's path)")

    dc = sub.add_parser("decide", help="record a decision 'A beats B' + the premises it rested on (refs to existing entries)")
    dc.add_argument("--decision-id", required=True, help="the decision's id (shares the fact-id keyspace)")
    dc.add_argument("--claim", required=True, help="the choice, e.g. 'A beats B'")
    dc.add_argument("--options", required=True, help="the options considered, ';'- or ','-separated, e.g. 'A;B;C'")
    dc.add_argument("--chose", required=True, help="the option chosen (must be one of --options)")
    dc.add_argument("--premises", nargs="+", required=True, help="the fact-ids / assume-ids the choice rested on")

    t = sub.add_parser("retire", help="call the fact dead (the derivation is retired)")
    t.add_argument("--fact-id", required=True)
    t.add_argument("--reason", required=True)

    sub.add_parser("list", help="the derived registry (pure fold, latest-wins)")

    f = sub.add_parser("fold", help="fold-twice-identical invariant check")
    f.add_argument("--check", action="store_true")

    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    # THE HONEST CEILING — printed to stderr on EVERY run so the tool states its own
    # limit out loud (and a --json stdout pipe stays clean). `fresh` is derivability,
    # not truth: it proves the byte-truth ground is unchanged, never that the claim was
    # re-judged true. |- != |=.
    print("CEILING: verify reports certificate-FRESHNESS, never TRUTH. `fresh` means the "
          "derivation's byte-truth inputs are unchanged since the certificate was kept, "
          "NOT that the claim is true in the world. |- != |=.", file=sys.stderr)
    repo_root = os.environ.get("VERIFY_REPO_ROOT", REPO_ROOT)
    try:
        return {
            "register": cmd_register,
            "assume": cmd_assume,
            "decide": cmd_decide,
            "verify": cmd_verify,
            "discharge": cmd_discharge,
            "retire": cmd_retire,
            "list": cmd_list,
            "fold": cmd_fold,
        }[args.cmd](args, repo_root)
    except ValueError as exc:
        print(f"verify: {exc}", file=sys.stderr)
        return ERROR


if __name__ == "__main__":
    sys.exit(main())
