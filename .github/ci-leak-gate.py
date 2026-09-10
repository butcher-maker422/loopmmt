#!/usr/bin/env python3
"""
ci-leak-gate.py — the PUBLIC-CI independent air-gap re-gate (isolated-push §5.3).

This file lives in the PUBLIC repo (butcher-maker422/loopmmt) under .github/, NOT
in the private methodology repo. It is the second, independent trust context of the
air-gap leak gate: the session's own predeploy_gate.sh runs first (private side),
then this runs in clean CI over the `staging` tree before any flip to `main`.

WHY A HARDCODED BASELINE, OWNED HERE (the weakening-attack fix, §5.3):
  A re-gate that trusted a signature list the SESSION exports has a weakening
  attack — a compromised session could ship a list with a signature REMOVED and
  sail its own leak straight past the check meant to catch it, destroying the
  independence the re-gate exists for. So the integrity-critical negative list is
  HARDCODED HERE, in the public repo, changed rarely and only by a public-repo
  commit the operator reviews. The session can never subtract from it.

  The session MAY layer on additional signatures (belt-and-suspenders) via an
  optional `<tree>/.ci-extra-signatures.txt`, but those are ADDITIVE-ONLY and are
  matched as FIXED STRINGS (never regex — no ReDoS, no code-exec from session
  input). Extras can only make the gate STRICTER, never weaker.

WHAT'S IN THE BASELINE (and what is deliberately NOT):
  Only the §7 non-negotiables that have ZERO legitimate presence in the public
  site — credentials, the mount cred, session-ID shape, private/mirror
  infrastructure URLs, private-repo refs, cairn routing. These need no allowlist
  and cannot false-positive. The NUANCED private-path rules (core/ and design/
  with public-shipping allowlists) stay SESSION-SIDE in predeploy_gate.sh — the
  session-side gate owns the subtlety; the CI side owns the un-weakenable floor.
  This is defense-in-depth: the same class of gate in two trust contexts, with the
  checking side owning its own floor.

Usage:  python3 ci-leak-gate.py <tree-root>
Exit:   0 = clean (safe to flip to main) · 3 = signature(s) found (DO NOT flip)
        · 2 = usage/IO error.

stdlib only, offline, deterministic. Mirrors the private redact.py signature set
(04-air-gap-plan §3/§7) but carries its own copy on purpose — the checking side
must not import the checked side.
"""
import os
import re
import sys

# --- The HARDCODED baseline (§7 non-negotiables; owned by the public repo) ----
# Each entry: (class_name, compiled_regex). ALL are REFUSE-class (fail the run).
# Kept explicit and readable so the operator can audit the rules on review.
_BASELINE = [
    # Credentials — the whole credscan.CRED_RES set, carried by value (the
    # checking side must not import the checked side's credscan.py).
    ("credential-github-pat", re.compile(r"github_pat_[A-Za-z0-9_]{20,}")),
    ("credential-classic-pat", re.compile(r"\bghp_[A-Za-z0-9]{30,}")),
    ("credential-oauth", re.compile(r"\bgh[ous]_[A-Za-z0-9]{30,}")),
    ("credential-aws", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("credential-slack", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}")),
    ("credential-private-key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),

    # 40-hex secret in an assignment (codeberg/ionos mirror tokens live this way).
    ("hex40-assignment", re.compile(r"[A-Za-z0-9_]+\s*=\s*[0-9a-f]{40}\b")),

    # The mount cred file + its env var.
    ("mount-cred", re.compile(r"_cred-[A-Za-z0-9]|LOOPMMT_CRED")),

    # Session-ID shape (DD.HHMM-word-word-hash).
    ("session-id", re.compile(r"\b\d{2}\.\d{4}-[a-z]+-[a-z]+-[a-z0-9]{6}\b")),

    # Private / mirror infrastructure URLs.
    ("internal-url", re.compile(
        r"74-208-208-185\.sslip\.io|forest\.74-208-208-185|"
        r"codeberg\.org/maineoperator42|/loopOperator/"
    )),

    # The private canonical repo, by name.
    ("private-repo-ref", re.compile(
        r"sheagunther/loopmmt-maturemaple|loopmmt-maturemaple\.git"
    )),

    # Cairn routing to private infrastructure.
    ("cairn-routing", re.compile(r"the-cairn-(?:seed|manifest)|CAIRN-SEED|cairn_seed")),
]

# --- The scrub-gift fixture sanction (operator ruling S09.2057 option B) --------
# The `scrub` gift is a secret-scanner whose PUBLIC PURPOSE is to display
# credential SHAPES so a person can see what the scanner catches. It therefore
# ships fake-by-design credential fixtures. The operator RULED these shippable.
# The session-side gate (redact.py) already knows this sanction; this is its
# INDEPENDENT, HARDCODED, PUBLIC-OWNED mirror. It stays inside the anti-weakening
# design (§5.3): the session can never widen it — it is owned HERE, and it is
# pinned THREE ways so a real leak can never ride the waiver:
#
#   1. PATH-scoped   — only files under `gifts/scrub/` are eligible.
#   2. CLASS-scoped  — only the credential-demo classes are waivable; a
#      path/infra/session-id/private-repo/cairn hit inside gifts/scrub/ still
#      REFUSES (a scrubber gift may demo a fake cred, never leak real infra).
#   3. STRING-pinned — the waived hit's exact text must be one of the KNOWN fake
#      fixtures. An UNKNOWN credential shape in a scrub file (a real key smuggled
#      in) matches no pin and still REFUSES. This is stronger than a bare
#      path+class waiver and is what makes the sanction safe to own publicly.
#
# All three must hold for a hit to be dropped. Changed only by an operator-
# reviewed public-repo commit (like the baseline above).
_SCRUB_SANCTION_PATH_PREFIX = "gifts/scrub/"
_SCRUB_SANCTION_CLASSES = frozenset({
    "credential-aws",
    "credential-slack",
    "credential-private-key",
    "hex40-assignment",
})
# The exact fake fixtures scrub ships (assembled from fragments so THIS gate file
# carries no literal credential-shape that would self-flag a whole-repo scan).
_SCRUB_SANCTION_STRINGS = frozenset({
    "AKIA" + "IOSFODNN7" + "EXAMPLE",                       # AWS doc example key
    "xoxb-" + "2411-" + "abcdefghijklmnop",                 # fake slack bot token
    "-----BEGIN RSA PRIVATE KEY-----",                      # fixture PEM header
    "HEXKEY=" + "deadbeef" * 5,                             # 40-hex fake assignment
})


def _is_scrub_sanctioned(rel, cls, snip):
    """True iff this hit is a KNOWN scrub demo fixture that may ship.

    All three rails must hold: the file is under gifts/scrub/, the class is a
    credential-demo class, AND the matched text is an exact known fixture. Any
    one failing → not sanctioned → the hit stands and the run REFUSES.
    """
    rel_norm = rel.replace(os.sep, "/")
    if not rel_norm.startswith(_SCRUB_SANCTION_PATH_PREFIX):
        return False
    if cls not in _SCRUB_SANCTION_CLASSES:
        return False
    return snip in _SCRUB_SANCTION_STRINGS


_EXTRAS_FILE = ".ci-extra-signatures.txt"


def _load_extras(root):
    """Read the OPTIONAL session-exported extras. Fixed strings only, additive.

    Each non-empty, non-comment line is a literal substring the CI additionally
    refuses. Returns a list of (class, needle). Never regex — a compromised
    session cannot inject a pattern, only a stricter literal check.
    """
    path = os.path.join(root, _EXTRAS_FILE)
    extras = []
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            for raw in fh:
                s = raw.strip()
                if s and not s.startswith("#"):
                    extras.append(("session-extra", s))
    except FileNotFoundError:
        pass
    except Exception as e:  # a broken extras file must not silently disable the gate
        print(f"ci-leak-gate: WARN — could not read {_EXTRAS_FILE}: {e} "
              f"(baseline still enforced)", file=sys.stderr)
    return extras


def _iter_files(root):
    # Skip .git (never content) and .github (this gate's OWN operator-owned home).
    # The session can never write .github/ — deploy preserves it as chrome — so it
    # is not gated content; scanning it would only self-flag the baseline's own
    # regex-source strings (LOOPMMT_CRED, the private-repo ref, CAIRN-SEED, ...)
    # and block every deploy. The leak surface is the session-pushed content, which
    # never lands under .github/.
    _skip = {".git", ".github"}
    for dirpath, dirs, files in os.walk(root):
        # only prune at the tree root, so a legitimate content dir literally named
        # ".github" nested deeper would still be scanned (there is none, but the
        # skip is scoped to the top level where the CI machinery actually lives).
        if os.path.normpath(dirpath) == os.path.normpath(root):
            dirs[:] = [d for d in dirs if d not in _skip]
        else:
            dirs[:] = [d for d in dirs if d != ".git"]
        for fn in sorted(files):
            yield os.path.join(dirpath, fn)


def scan_tree(root):
    """Return a list of (relpath, line_no, class, snippet) for every hit."""
    extras = _load_extras(root)
    hits = []
    for path in _iter_files(root):
        rel = os.path.relpath(path, root)
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except Exception:
            continue
        for i, line in enumerate(text.splitlines(), start=1):
            for cls, rx in _BASELINE:
                for m in rx.finditer(line):
                    snip = m.group(0).strip()
                    if snip and not _is_scrub_sanctioned(rel, cls, snip):
                        hits.append((rel, i, cls, snip))
            for cls, needle in extras:
                if needle in line:
                    hits.append((rel, i, cls, needle))
    return hits


def main(argv):
    if len(argv) != 2 or not os.path.isdir(argv[1]):
        print("usage: ci-leak-gate.py <tree-root>   (the whole staged public tree)",
              file=sys.stderr)
        return 2
    root = argv[1]
    print(f"ci-leak-gate: scanning the whole tree at {root} against the hardcoded "
          f"baseline ({len(_BASELINE)} classes) ...", file=sys.stderr)
    hits = scan_tree(root)
    if not hits:
        print("ci-leak-gate: CLEAN — no non-negotiable signature. Safe to flip to main.",
              file=sys.stderr)
        return 0
    print(f"ci-leak-gate: REFUSED — {len(hits)} signature hit(s). DO NOT flip to main:",
          file=sys.stderr)
    for rel, i, cls, snip in hits:
        print(f"  {rel}:{i}  [{cls}]  {snip}", file=sys.stderr)
    return 3


if __name__ == "__main__":
    sys.exit(main(sys.argv))

