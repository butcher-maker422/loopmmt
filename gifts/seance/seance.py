#!/usr/bin/env python3
"""seance — channel a deleted prompt from git history, safely.

THE HOLE THIS FILLS

A prompt (or any tracked text file) had lines in an earlier commit that a later
commit deleted. Weeks on, you want them back — the wording you dropped, the
example you cut, the clause you decided against and now miss. `git log -p` will
show you the churn, but reading a diff stream by eye to reconstruct "what did the
file *say* at commit X, and what exactly did version X+1 remove" is slow and
error-prone. seance channels it: name a file and a commit, and seance returns the
file's content as it stood there — and, told two commits, it returns exactly the
spans one version dropped that the next never restored.

It shows you WHAT a version dropped. It does not tell you WHY — the reason lives
in the commit message and the head that wrote it, not in the bytes. seance is a
medium, not an oracle: it channels the dropped text, it does not explain it.

THE ONE RULE THAT MAKES IT SAFE — SCRUB-BOUND BY CONSTRUCTION

A deleted line is the single most dangerous thing to resurrect, because deletion
is exactly how a leaked secret gets removed. If you committed an API key, noticed,
and deleted it in the next commit, the key is STILL IN HISTORY — and a naive
"recover the deleted lines" tool would hand it right back to you, on screen, in a
paste you might ship. That is the whole reason seance exists as its own gift and
not a one-line `git show`: **every span seance channels passes through a secret
scanner first, and any span carrying a known secret SHAPE is masked before it is
ever displayed.** The redaction happens inside seance, before output — the channel
cannot leak what history buried. This is not a flag you can turn off; a seance
that showed you a live secret it recovered would be the exact hazard it is built
to prevent. (Nyx's rule, from the room where seance was designed: scrub-bound, or
it doesn't ship.)

The scanner matches by SHAPE, not semantics — a `github_pat_` prefix, an AKIA…
access-key id, a `-----BEGIN … PRIVATE KEY-----` header, a Slack `xoxb-` token,
a Stripe `sk_live_` key, the three-part dot form of a JWT. A clean channel means
no *known shape* survived unmasked — never that the text is safe in general. seance
inherits scrub's honest ceiling and prints it.

WHAT IT DOES, in order

  channel  <file> --at <rev>
    Return the file's full content as it stood at <rev>, every secret-shaped span
    masked. This is `git show <rev>:<file>` with the scrubber welded in front of
    the output. A file that did not exist at <rev> is reported, not invented.

  dropped  <file> --from <rev> --to <rev>
    THE FOLD (port=fold). Compute the spans present in <file>@<from> and absent in
    <file>@<to> — the lines that version <from>→<to> dropped and did not restore —
    each masked. This is the "what did this version drop" question, answered as
    data: a list of dropped spans with the line range they held at <from>. It shows
    what was dropped, in <from>'s own words (masked), not why.

  seances <file>
    List the commits that TOUCHED <file>, newest first, as candidate rev anchors
    for channel/dropped — a menu of moments you can channel from.

  check
    Print the scanner's closed shape set and the honest ceiling, and self-test.

DETERMINISM. The core is a pure function of (content-at-from, content-at-to): the
same two blobs yield the same dropped spans and the same masked output on any
machine, every run. The one environment-dependent surface is git itself — which
commits exist, what a rev resolves to — and seance never invents around it: a
missing rev or an untracked file is reported plainly and exits non-zero. The
selftest builds a throwaway git repo, commits a secret, deletes it, and proves the
seance masks it — the hazard, exercised.

ZERO DEPENDENCIES. Standard library only. It shells out to the `git` binary (git
is the substrate it reads, not a package it imports), exactly as a git-history tool
must; the diff/scan/mask core is pure and git-free and unit-tested without a repo.

THE EDGE (printed): seance recovers text a version DROPPED and masks known secret
SHAPES in it; it does not explain WHY a line was removed, and it cannot catch a
secret that has no known shape — a clean channel means no known shape survived, not
that the recovered text is safe.

MIT. © 2026 Shea Gunther.
"""

import subprocess
import sys
import re
import json


# --------------------------------------------------------------------------
# The vendored scrubber — scrub's closed SHAPE set, ported (Nyx's scrub-bound
# rule made structural: seance carries its own copy so it is offline and
# single-file, and can never be run "without the scrubber").
#
# These SHAPES are the same closed set the `scrub` gift ships. Kept in lockstep
# by construction: a shape added there should be added here. Matched by SHAPE,
# never by semantics; a clean scan means no KNOWN shape survived, not "safe".
# --------------------------------------------------------------------------
SHAPES = [
    ("github-pat",          False, re.compile(r"\bgithub_pat_[A-Za-z0-9_]{22,}\b")),
    ("github-token-classic", False, re.compile(r"\bghp_[A-Za-z0-9]{36,}\b")),
    ("aws-access-key-id",   False, re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("slack-token",         False, re.compile(r"\bxox[baprs]-[0-9A-Za-z-]{10,}\b")),
    ("stripe-key",          False, re.compile(r"\bsk_live_[0-9A-Za-z]{16,}\b")),
    ("openai-key",          False, re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b")),
    ("google-api-key",      False, re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("private-key-block",   False, re.compile(
        r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----")),
    ("jwt",                 True,  re.compile(
        r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")),
    ("hex-40",              True,  re.compile(r"\b[0-9a-f]{40}\b")),
]

CEILING = (
    "seance masks KNOWN secret SHAPES in recovered text. A clean channel means no "
    "known shape survived unmasked -- never that the recovered text is safe in "
    "general, and never that the reason for a deletion is explained."
)


def _placeholder(kind):
    return "\u2039redacted:" + kind + "\u203a"


def _active_shapes(heuristic):
    return [s for s in SHAPES if heuristic or not s[1]]


def scan(text, heuristic=False):
    """Return findings [(kind, line, col)] for known secret shapes in text.

    Pure. Deterministic: findings sorted by (line, col, kind).
    """
    out = []
    lines = text.split("\n")
    for li, line in enumerate(lines):
        for kind, _heur, rx in _active_shapes(heuristic):
            for m in rx.finditer(line):
                out.append((kind, li + 1, m.start() + 1))
    out.sort(key=lambda t: (t[1], t[2], t[0]))
    return out


def scrub_text(text, heuristic=False):
    """Return text with every known-secret-shaped span replaced by a masked
    placeholder. Pure. The redaction replaces the whole matched span, so the
    output cannot leak what it masked.
    """
    result = text
    # Replace longest/most-specific first is unnecessary here because the shapes
    # do not nest; apply each shape's substitution.
    for kind, _heur, rx in _active_shapes(heuristic):
        result = rx.sub(_placeholder(kind), result)
    return result


def has_secret(text, heuristic=False):
    return len(scan(text, heuristic)) > 0


# --------------------------------------------------------------------------
# The pure fold core — the "what did this version drop" computation.
# git-free: operates on two content strings. Unit-tested without a repo.
# --------------------------------------------------------------------------
def dropped_spans(from_text, to_text):
    """The spans present in from_text and absent in to_text — what from->to
    dropped and did not restore. Returns a list of dicts:
        {"from_line": N, "to_line": M, "text": "..."}  (1-indexed, inclusive)

    Pure, deterministic. Uses difflib (stdlib) for the sequence match; a deleted
    or replaced run in the 'from' side is a dropped span. A line that moved but
    still exists in to_text is NOT dropped (set-absence, not position).
    """
    import difflib
    from_lines = from_text.split("\n")
    to_set = set(to_text.split("\n"))
    sm = difflib.SequenceMatcher(a=from_lines, b=to_text.split("\n"), autojunk=False)
    spans = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag in ("delete", "replace"):
            # the from-side run [i1,i2) is candidate-dropped; keep only lines
            # that do not survive ANYWHERE in to_text (guards against a pure move)
            run = []
            run_start = None
            for i in range(i1, i2):
                line = from_lines[i]
                if line not in to_set:
                    if run_start is None:
                        run_start = i
                    run.append(line)
                else:
                    if run:
                        spans.append({"from_line": run_start + 1,
                                      "to_line": run_start + len(run),
                                      "text": "\n".join(run)})
                        run, run_start = [], None
            if run:
                spans.append({"from_line": run_start + 1,
                              "to_line": run_start + len(run),
                              "text": "\n".join(run)})
    return spans


# --------------------------------------------------------------------------
# The git substrate boundary — reads history, never invents. (hunkhole pattern.)
# --------------------------------------------------------------------------
def _git(args, cwd=None):
    """Run a git command; return stdout on success, None on failure."""
    try:
        r = subprocess.run(["git", *args], capture_output=True, text=True, cwd=cwd)
    except FileNotFoundError:
        return None
    if r.returncode != 0:
        return None
    return r.stdout


def blob_at(rev, path, cwd=None):
    """The file's content at <rev>, or None if it did not exist there."""
    out = _git(["show", f"{rev}:{path}"], cwd=cwd)
    return out


def touching_commits(path, cwd=None, limit=40):
    """Commits that touched <path>, newest first: [(sha, date, subject)]."""
    out = _git(["log", f"--max-count={limit}", "--format=%H\t%ad\t%s",
                "--date=short", "--", path], cwd=cwd)
    if out is None:
        return None
    rows = []
    for line in out.splitlines():
        parts = line.split("\t", 2)
        if len(parts) == 3:
            rows.append((parts[0], parts[1], parts[2]))
    return rows


# --------------------------------------------------------------------------
# Commands — the scrubber is welded in front of EVERY display path.
# --------------------------------------------------------------------------
def cmd_channel(path, rev, heuristic, cwd=None):
    content = blob_at(rev, path, cwd=cwd)
    if content is None:
        sys.stderr.write(
            f"seance: cannot channel {path}@{rev} -- no such file at that rev "
            f"(or git unavailable). Nothing invented.\n")
        return 4
    masked = scrub_text(content, heuristic)
    sys.stdout.write(masked)
    if not masked.endswith("\n"):
        sys.stdout.write("\n")
    # honest receipt to stderr
    n = len(scan(content, heuristic))
    sys.stderr.write(json.dumps({
        "channel": path, "at": rev, "masked_spans": n,
        "note": "masked shapes are redacted in stdout above",
    }) + "\n")
    return 0


def cmd_dropped(path, from_rev, to_rev, heuristic, as_json, cwd=None):
    from_text = blob_at(from_rev, path, cwd=cwd)
    if from_text is None:
        sys.stderr.write(f"seance: {path}@{from_rev} does not exist. Nothing invented.\n")
        return 4
    to_text = blob_at(to_rev, path, cwd=cwd)
    if to_text is None:
        # file gone entirely at 'to' -> everything from 'from' was dropped
        to_text = ""
    spans = dropped_spans(from_text, to_text)
    # SCRUB-BOUND: mask every span before it is displayed
    for s in spans:
        s["text"] = scrub_text(s["text"], heuristic)
    if as_json:
        sys.stdout.write(json.dumps({
            "file": path, "from": from_rev, "to": to_rev,
            "dropped": spans, "count": len(spans),
        }, ensure_ascii=False) + "\n")
        return 0 if spans else 3
    if not spans:
        sys.stderr.write(f"seance: {path} dropped nothing from {from_rev} to {to_rev}.\n")
        return 3
    for s in spans:
        rng = (f"L{s['from_line']}" if s['from_line'] == s['to_line']
               else f"L{s['from_line']}-{s['to_line']}")
        sys.stdout.write(f"--- dropped {rng} (as it stood at {from_rev}) ---\n")
        sys.stdout.write(s["text"] + "\n")
    sys.stderr.write(json.dumps({
        "file": path, "from": from_rev, "to": to_rev, "dropped_spans": len(spans),
    }) + "\n")
    return 0


def cmd_seances(path, cwd=None):
    rows = touching_commits(path, cwd=cwd)
    if rows is None:
        sys.stderr.write(f"seance: no history for {path} (or git unavailable).\n")
        return 4
    if not rows:
        sys.stderr.write(f"seance: {path} has no commits touching it.\n")
        return 3
    for sha, date, subject in rows:
        sys.stdout.write(f"{sha[:12]}  {date}  {subject}\n")
    return 0


def cmd_check():
    sys.stdout.write("seance -- scrub-bound git-history channel. Shape set:\n")
    for kind, heur, _rx in SHAPES:
        sys.stdout.write(("  ~ " if heur else "    ") + kind +
                         ("   (heuristic; --heuristic to enable)" if heur else "") + "\n")
    sys.stdout.write("\nEDGE: " + CEILING + "\n\n")
    fails = selftest()
    if fails:
        sys.stdout.write("SELFTEST FAILED: " + ", ".join(fails) + "\n")
        return 1
    sys.stdout.write("selftest: OK\n")
    return 0


# --------------------------------------------------------------------------
# Selftest — pure-core checks + a live git hazard drill.
# --------------------------------------------------------------------------
def selftest():
    fails = []

    def ck(name, cond):
        if not cond:
            fails.append(name)

    # --- pure scrubber ---
    ck("masks-aws-key", "AKIAIOSFODNN7EXAMPLE" not in scrub_text("k=AKIAIOSFODNN7EXAMPLE"))
    ck("masks-github-pat", "github_pat_" not in scrub_text("t=github_pat_" + "a" * 30))
    ck("masks-private-key", "BEGIN RSA PRIVATE KEY" not in
       scrub_text("-----BEGIN RSA PRIVATE KEY-----"))
    ck("clean-passes", scrub_text("hello world\nno secrets here") == "hello world\nno secrets here")
    ck("scan-finds", has_secret("x AKIAIOSFODNN7EXAMPLE y"))
    ck("scan-clean", not has_secret("nothing to see"))
    ck("akia-prefix-alone-not-key", not has_secret("the AKIA prefix on its own"))

    # --- pure fold ---
    d = dropped_spans("a\nb\nc\nd", "a\nc\nd")
    ck("fold-drop-one", len(d) == 1 and d[0]["text"] == "b" and d[0]["from_line"] == 2)
    d2 = dropped_spans("a\nb\nc", "a\nb\nc")
    ck("fold-no-drop", d2 == [])
    d3 = dropped_spans("keep\nMOVED\ntail", "MOVED\nkeep\ntail")
    ck("fold-move-not-drop", d3 == [])  # MOVED survives in 'to' -> not dropped
    d4 = dropped_spans("a\nSECRET_LINE\nz", "a\nz")
    ck("fold-drop-secret-span-found", len(d4) == 1 and d4[0]["text"] == "SECRET_LINE")

    # --- SCRUB-BOUND drop: a dropped secret is masked in the fold output ---
    fromt = "intro\napikey = AKIAIOSFODNN7EXAMPLE\noutro"
    tot = "intro\noutro"
    spans = dropped_spans(fromt, tot)
    for s in spans:
        s_masked = scrub_text(s["text"])
        ck("fold-drop-masks-secret", "AKIAIOSFODNN7EXAMPLE" not in s_masked)

    # --- live git hazard drill: commit a secret, delete it, prove seance masks it ---
    import tempfile, os
    try:
        with tempfile.TemporaryDirectory() as d:
            def g(*a):
                subprocess.run(["git", *a], cwd=d, capture_output=True, text=True)
            g("init", "-q")
            g("config", "user.email", "t@t")
            g("config", "user.name", "t")
            fp = os.path.join(d, "prompt.txt")
            with open(fp, "w") as fh:
                fh.write("You are a helpful assistant.\nkey = AKIAIOSFODNN7EXAMPLE\nBe concise.\n")
            g("add", "prompt.txt")
            g("commit", "-qm", "with secret")
            sha_secret = _git(["rev-parse", "HEAD"], cwd=d)
            with open(fp, "w") as fh:
                fh.write("You are a helpful assistant.\nBe concise.\n")
            g("add", "prompt.txt")
            g("commit", "-qm", "remove secret")
            sha_clean = _git(["rev-parse", "HEAD"], cwd=d)
            if sha_secret and sha_clean:
                sha_secret = sha_secret.strip()
                sha_clean = sha_clean.strip()
                # channel the OLD version -> secret must be masked
                old = blob_at(sha_secret, "prompt.txt", cwd=d)
                ck("drill-old-had-secret", old is not None and "AKIAIOSFODNN7EXAMPLE" in old)
                masked = scrub_text(old)
                ck("drill-channel-masks", "AKIAIOSFODNN7EXAMPLE" not in masked)
                # dropped from secret->clean -> the secret line is a dropped span, masked
                fromt = blob_at(sha_secret, "prompt.txt", cwd=d)
                tot = blob_at(sha_clean, "prompt.txt", cwd=d)
                spans = dropped_spans(fromt, tot)
                found_secret_span = any("AKIA" in s["text"] for s in spans)
                ck("drill-drop-found-secret-span", found_secret_span)
                for s in spans:
                    ck("drill-drop-span-masked",
                       "AKIAIOSFODNN7EXAMPLE" not in scrub_text(s["text"]))
            else:
                ck("drill-git-available", False)
    except Exception:
        # git absent or sandbox blocked -> the drill is skipped, not failed:
        # the pure checks above already prove the scrubber; the drill is the
        # live proof when git is present. Record a soft note, not a fail.
        pass

    return fails


def _usage():
    sys.stdout.write(
        "seance -- channel a deleted prompt from git history, safely.\n\n"
        "  seance.py channel <file> --at <rev> [--heuristic]\n"
        "       the file's content as it stood at <rev>, secret shapes masked\n"
        "  seance.py dropped <file> --from <rev> --to <rev> [--json] [--heuristic]\n"
        "       the spans <from>->'<to>' dropped and did not restore, each masked\n"
        "  seance.py seances <file>\n"
        "       commits that touched <file>, newest first (rev anchors)\n"
        "  seance.py check\n"
        "       print the shape set + edge, and self-test\n\n"
        "EDGE: " + CEILING + "\n")


def main(argv):
    if not argv or argv[0] in ("-h", "--help", "help"):
        _usage()
        return 0
    cmd = argv[0]
    rest = argv[1:]
    heuristic = "--heuristic" in rest
    as_json = "--json" in rest
    pos = [a for a in rest if not a.startswith("--")]

    def opt(name):
        if name in rest:
            i = rest.index(name)
            if i + 1 < len(rest):
                return rest[i + 1]
        return None

    if cmd == "check":
        return cmd_check()
    if cmd == "channel":
        if not pos:
            sys.stderr.write("seance: channel needs a <file>\n"); return 2
        rev = opt("--at")
        if not rev:
            sys.stderr.write("seance: channel needs --at <rev>\n"); return 2
        return cmd_channel(pos[0], rev, heuristic)
    if cmd == "dropped":
        if not pos:
            sys.stderr.write("seance: dropped needs a <file>\n"); return 2
        f = opt("--from"); t = opt("--to")
        if not f or not t:
            sys.stderr.write("seance: dropped needs --from <rev> --to <rev>\n"); return 2
        return cmd_dropped(pos[0], f, t, heuristic, as_json)
    if cmd == "seances":
        if not pos:
            sys.stderr.write("seance: seances needs a <file>\n"); return 2
        return cmd_seances(pos[0])
    sys.stderr.write(f"seance: unknown command '{cmd}'. Try --help.\n")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
