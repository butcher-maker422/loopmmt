#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""worklog.py — turn a git history into a readable worklog over a span of time.

`git log` is a firehose. What you usually want is the human question underneath it:
*what got done last week?* — grouped by day or by person, summarized, countable.
`worklog` is that. Point it at a git repo and a time span and it emits a grouped
worklog: commits collected over the span, bucketed by day (default) or by author,
each bucket summarized with a count and its commit subjects.

    python3 worklog.py [<repo>] [--since ...] [--until ...] [--by day|author] [--json]

It reads the repository through `git log` only. It never writes to the repo, never
touches your working tree, and never needs network — it is a read-only fold over
history you already have.

------------------------------------------------------------------------------
Spans (pick one; --since/--until can combine):
  --since <when>     only commits at or after this date   (git date: 2026-08-01, "2 weeks ago")
  --until <when>     only commits at or before this date
  --last <N>         shorthand for the last N days (from now)
  (no span)          the whole history reachable from --ref

Grouping:
  --by day     (default)  one bucket per calendar day, newest day first
  --by author             one bucket per author, most commits first

------------------------------------------------------------------------------
The JSON contract (so this composes in a pipe):
  --json emits ONE JSON object per bucket on stdout, sorted deterministically:
     {"group":"day"|"author", "key":..., "count":N, "commits":[{hash,date,author,subject}, ...]}
  so you can pipe the worklog into the next tool (sum counts, filter to one author,
  feed a summarizer). Without --json it prints a grouped human report.

Determinism: for a fixed repo + span + grouping, the output is byte-identical across
runs — commits are ordered by (committer-date, hash), buckets are ordered by a fixed
rule (day: date descending; author: count descending then name ascending), so the
report is diffable and hashable.

Exit codes:
    0   ran clean (commits or none — a worklog is a report, not a gate)
    2   not a git repository, or git failed
    3   usage error
"""

import argparse
import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone

# A record separator unlikely to appear in a commit subject.
_SEP = "\x1f"
_REC = "\x1e"


def _run_git(repo, args):
    try:
        out = subprocess.run(
            ["git", "-C", repo] + args,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            check=True, text=True,
        )
        return out.stdout
    except FileNotFoundError:
        sys.stderr.write("worklog: git not found on PATH\n")
        raise SystemExit(2)
    except subprocess.CalledProcessError as e:
        sys.stderr.write("worklog: git failed: %s\n" % (e.stderr.strip() or e))
        raise SystemExit(2)


def is_git_repo(repo):
    try:
        r = subprocess.run(
            ["git", "-C", repo, "rev-parse", "--is-inside-work-tree"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        return r.returncode == 0 and r.stdout.strip() == "true"
    except FileNotFoundError:
        return False


def collect_commits(repo, ref, since, until):
    """Return commits as list of {hash, short, date (ISO committer date), author, subject},
    ordered deterministically by (committer-date, hash)."""
    fmt = _SEP.join(["%H", "%h", "%cI", "%an", "%s"]) + _REC
    args = ["log", ref, "--no-merges", "--pretty=format:" + fmt]
    if since:
        args.append("--since=" + since)
    if until:
        args.append("--until=" + until)
    raw = _run_git(repo, args)
    commits = []
    for rec in raw.split(_REC):
        rec = rec.strip("\n")
        if not rec:
            continue
        parts = rec.split(_SEP)
        if len(parts) != 5:
            continue
        full, short, cdate, author, subject = parts
        commits.append({
            "hash": full, "short": short, "date": cdate,
            "author": author, "subject": subject,
        })
    commits.sort(key=lambda c: (c["date"], c["hash"]))
    return commits


def _day_of(iso):
    # committer date is ISO-8601 with offset, e.g. 2026-08-31T19:25:00-04:00
    return iso[:10]


def group_by_day(commits):
    buckets = {}
    for c in commits:
        buckets.setdefault(_day_of(c["date"]), []).append(c)
    # newest day first
    out = []
    for day in sorted(buckets, reverse=True):
        cs = sorted(buckets[day], key=lambda c: (c["date"], c["hash"]))
        out.append({"group": "day", "key": day, "count": len(cs), "commits": cs})
    return out


def group_by_author(commits):
    buckets = {}
    for c in commits:
        buckets.setdefault(c["author"], []).append(c)
    # most commits first, then author name ascending for a stable tie-break
    keys = sorted(buckets, key=lambda a: (-len(buckets[a]), a))
    out = []
    for a in keys:
        cs = sorted(buckets[a], key=lambda c: (c["date"], c["hash"]))
        out.append({"group": "author", "key": a, "count": len(cs), "commits": cs})
    return out


def _short_commit(c):
    return {"hash": c["short"], "date": c["date"], "author": c["author"], "subject": c["subject"]}


def main(argv=None):
    p = argparse.ArgumentParser(
        prog="worklog",
        description="turn a git history into a readable worklog over a span of time.",
    )
    p.add_argument("repo", nargs="?", default=".", help="path to the git repo (default: current dir)")
    p.add_argument("--ref", default="HEAD", help="ref to walk (default: HEAD)")
    p.add_argument("--since", metavar="WHEN", help="only commits at/after this git date")
    p.add_argument("--until", metavar="WHEN", help="only commits at/before this git date")
    p.add_argument("--last", type=int, metavar="N", help="shorthand: the last N days")
    p.add_argument("--by", choices=["day", "author"], default="day", help="grouping (default: day)")
    p.add_argument("--json", action="store_true", help="emit one JSON object per bucket (the pipe contract)")
    args = p.parse_args(argv)

    if args.last is not None:
        if args.last < 1:
            sys.stderr.write("worklog: --last must be >= 1\n")
            return 3
        cutoff = datetime.now(timezone.utc) - timedelta(days=args.last)
        args.since = cutoff.strftime("%Y-%m-%dT%H:%M:%S")

    if not is_git_repo(args.repo):
        sys.stderr.write("worklog: not a git repository: %s\n" % args.repo)
        return 2

    commits = collect_commits(args.repo, args.ref, args.since, args.until)
    buckets = group_by_day(commits) if args.by == "day" else group_by_author(commits)

    if args.json:
        for b in buckets:
            obj = {
                "group": b["group"], "key": b["key"], "count": b["count"],
                "commits": [_short_commit(c) for c in b["commits"]],
            }
            sys.stdout.write(json.dumps(obj, sort_keys=True) + "\n")
        return 0

    if not commits:
        print("worklog: no commits in the given span.")
        return 0

    span = []
    if args.since:
        span.append("since %s" % args.since)
    if args.until:
        span.append("until %s" % args.until)
    span_s = (" (%s)" % ", ".join(span)) if span else ""
    print("# worklog — %d commit(s) grouped by %s%s\n" % (len(commits), args.by, span_s))
    for b in buckets:
        print("## %s  (%d commit%s)" % (b["key"], b["count"], "" if b["count"] == 1 else "s"))
        for c in b["commits"]:
            if args.by == "day":
                print("    %s  %-16s  %s" % (c["short"], c["author"][:16], c["subject"]))
            else:
                print("    %s  %s  %s" % (c["short"], _day_of(c["date"]), c["subject"]))
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
