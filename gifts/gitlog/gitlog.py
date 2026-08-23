#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""gitlog.py — turn a git history into one JSON object per commit, on stdout.

A git repository already holds the truth about what happened and when: every
commit is a dated, authored, immutable record. But that truth is trapped behind
`git log`'s human-facing format. This reads the log and emits it as **JSON
lines** — one object per commit, newest first by default — so the next tool in a
pipe can fold, filter, count, or chart it without re-parsing git's output itself.

It is a *source*: it emits records and consumes no stdin. Point it at a repo, get
a clean stream of commits you can reason about. The whole point is to stop
eyeballing `git log` and start folding it: "how many commits touched this file",
"who authored what in this range", "what was the churn per day" all become one
pipe away once the history is on the rail as records.

Each commit becomes one object with these fields (always present):
    hash        full 40-char commit SHA            (git %H)
    short       abbreviated SHA                     (git %h)
    committed   committer date, ISO-8601 strict     (git %cI)
    authored    author date, ISO-8601 strict        (git %aI)
    author      author name                         (git %an)
    email       author email                        (git %ae)
    subject     first line of the message           (git %s)

With --churn, three more fields are added per commit (one extra git call each):
    files       number of files changed in the commit   (int)
    added       total inserted lines across those files  (int, None if binary-only)
    deleted     total deleted lines                       (int, None if binary-only)

The field names match what the existing git-log folds already read (%H, %h, %cI,
%aI, %s), so a fold written against those consumes this source's output directly.

------------------------------------------------------------------------------
The JSON-lines contract (so this composes in a pipe):
  - emits ONE JSON object per line on stdout — a commit record.
  - order is git's default (reverse-chronological) unless --reverse is given.
  - --path P restricts to commits that touched P (repeatable).
  - --since / --until / --author / --max-count are passed through to git log.
  - errors go to stderr; stdout stays clean JSON-lines.

Exit codes:
    0   the log was read and emitted (including the empty-history case)
    2   git failed / not a repository / git not found (don't trust the reading)
    3   usage / bad input
"""

import argparse
import json
import subprocess
import sys


# ASCII unit/record separators: safe inside commit text, so a subject line
# containing newlines or pipes cannot break the parse. Same technique the
# existing folds use.
UNIT = "\x1f"
REC = "\x1e"

# The per-commit fields, in emit order. (placeholder, json_key) pairs.
FIELDS = [
    ("%H", "hash"),
    ("%h", "short"),
    ("%cI", "committed"),
    ("%aI", "authored"),
    ("%an", "author"),
    ("%ae", "email"),
    ("%s", "subject"),
]


class GitLogError(Exception):
    """A git fault or usage error, carrying an exit code."""

    def __init__(self, message, code):
        super().__init__(message)
        self.code = code


def _run_git(args, repo):
    """Run a git command in repo, return stdout text. Raise GitLogError on failure."""
    try:
        proc = subprocess.run(
            ["git", "-C", repo] + args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            encoding="utf-8",
        )
    except FileNotFoundError:
        raise GitLogError("git executable not found on PATH", 2)
    if proc.returncode != 0:
        detail = proc.stderr.strip() or "git exited %d" % proc.returncode
        raise GitLogError(detail, 2)
    return proc.stdout


def read_commits(repo, ref="HEAD", paths=None, since=None, until=None,
                 author=None, max_count=None, reverse=False):
    """Read commits from repo and return a list of record dicts (no churn).

    The list is git's default order (reverse-chronological) unless reverse=True.
    An empty history returns [] and is NOT an error.
    """
    fmt = UNIT.join(p for p, _ in FIELDS) + REC
    args = ["log", ref, "--format=%s" % fmt]
    if reverse:
        args.append("--reverse")
    if since:
        args.append("--since=%s" % since)
    if until:
        args.append("--until=%s" % until)
    if author:
        args.append("--author=%s" % author)
    if max_count is not None:
        args.append("--max-count=%d" % max_count)
    if paths:
        args.append("--")
        args.extend(paths)

    raw = _run_git(args, repo)
    records = []
    for chunk in raw.split(REC):
        chunk = chunk.strip("\n")
        if not chunk:
            continue
        parts = chunk.split(UNIT)
        if len(parts) != len(FIELDS):
            # A malformed record is a fault, not a silent drop.
            raise GitLogError(
                "malformed log record: expected %d fields, got %d"
                % (len(FIELDS), len(parts)),
                2,
            )
        rec = {key: parts[i] for i, (_, key) in enumerate(FIELDS)}
        records.append(rec)
    return records


def add_churn(repo, record):
    """Add files/added/deleted to one record via `git show --numstat`.

    added/deleted are None when the commit is binary-only (git prints '-').
    Mutates and returns the record.
    """
    out = _run_git(
        ["show", "--numstat", "--format=", record["hash"]], repo
    )
    files = 0
    added = 0
    deleted = 0
    saw_binary = False
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        cols = line.split("\t")
        if len(cols) < 3:
            continue
        files += 1
        a, d = cols[0], cols[1]
        if a == "-" or d == "-":
            saw_binary = True
            continue
        try:
            added += int(a)
            deleted += int(d)
        except ValueError:
            saw_binary = True
    record["files"] = files
    # If every changed file was binary, added/deleted are not meaningful.
    if saw_binary and added == 0 and deleted == 0:
        record["added"] = None
        record["deleted"] = None
    else:
        record["added"] = added
        record["deleted"] = deleted
    return record


def _emit(record, out=None):
    """Write one JSON object as a single line to stdout (or the given stream)."""
    stream = out if out is not None else sys.stdout
    stream.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


def build_parser():
    p = argparse.ArgumentParser(
        prog="gitlog",
        description="Emit a git history as JSON lines, one object per commit.",
    )
    p.add_argument("--repo", default=".", help="path to the git repo (default: .)")
    p.add_argument("--ref", default="HEAD",
                   help="ref/range to log (default: HEAD; e.g. main, v1..v2)")
    p.add_argument("--path", action="append", dest="paths", metavar="P",
                   help="restrict to commits touching P (repeatable)")
    p.add_argument("--since", help="git --since passthrough (e.g. '2 weeks ago')")
    p.add_argument("--until", help="git --until passthrough")
    p.add_argument("--author", help="git --author filter passthrough")
    p.add_argument("-n", "--max-count", type=int, default=None,
                   help="limit to the most recent N commits")
    p.add_argument("--reverse", action="store_true",
                   help="oldest first (default is newest first)")
    p.add_argument("--churn", action="store_true",
                   help="add files/added/deleted per commit (one extra git call each)")
    return p


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.max_count is not None and args.max_count < 1:
        sys.stderr.write("gitlog: -n must be >= 1\n")
        return 3

    try:
        records = read_commits(
            args.repo,
            ref=args.ref,
            paths=args.paths,
            since=args.since,
            until=args.until,
            author=args.author,
            max_count=args.max_count,
            reverse=args.reverse,
        )
        for rec in records:
            if args.churn:
                add_churn(args.repo, rec)
            _emit(rec)
        return 0
    except GitLogError as exc:
        sys.stderr.write("gitlog: %s\n" % exc)
        return exc.code


if __name__ == "__main__":
    sys.exit(main())
