#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""test_worklog.py — mutation-bitten tests for the worklog gift.

Self-contained: builds a synthetic git repo in a tempdir with fixed commit dates and
authors, runs worklog over it, and asserts on the buckets. The golden is pinned on the
STRUCTURE (group, key, count, ordered subjects/authors/dates) rather than on commit
hashes, because a commit hash depends on the local git version's object encoding — so
the golden stays byte-stable across environments while still catching any change in
grouping, ordering, counting, or the field set. Hash SHAPE (7-hex short id) is checked
separately.

Mutation bite (proven with teeth in the build):
  - flip the day bucket order to ascending    -> the day-order test + golden fail
  - group_by_author tie-break removed/reversed -> the author-order test fails
  - drop --no-merges commit ordering sort       -> the within-bucket order test fails
  - count a merge/emit wrong count              -> the count tests fail

Run:  python3 test_worklog.py      (prints "N/N passed", exits 0 on all-green)
"""

import io
import json
import os
import re
import subprocess
import sys
import tempfile
import contextlib

import worklog

COMMITS = [
    # (author, date, subject)
    ("Ann", "2026-08-30T10:00:00+00:00", "add login"),
    ("Ann", "2026-08-30T14:00:00+00:00", "fix logout bug"),
    ("Bo",  "2026-08-31T09:00:00+00:00", "write docs"),
    ("Ann", "2026-08-31T11:00:00+00:00", "polish login form"),
]


def build_repo(root):
    def git(*args, **env):
        e = dict(os.environ)
        e.update(env)
        subprocess.run(["git", "-C", root] + list(args), check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=e)
    git("init")
    git("config", "user.email", "x@x.co")
    git("config", "user.name", "seed")
    for author, date, subject in COMMITS:
        email = author.lower() + "@x.co"
        git("commit", "--allow-empty", "-m", subject,
            GIT_AUTHOR_NAME=author, GIT_AUTHOR_EMAIL=email,
            GIT_COMMITTER_NAME=author, GIT_COMMITTER_EMAIL=email,
            GIT_AUTHOR_DATE=date, GIT_COMMITTER_DATE=date)


def run_json(root, by):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = worklog.main([root, "--by", by, "--json"])
    lines = [json.loads(l) for l in buf.getvalue().splitlines() if l.strip()]
    return rc, lines


def structural(buckets):
    """Reduce buckets to the hash-independent shape we pin."""
    out = []
    for b in buckets:
        out.append({
            "group": b["group"],
            "key": b["key"],
            "count": b["count"],
            "subjects": [c["subject"] for c in b["commits"]],
            "authors": [c["author"] for c in b["commits"]],
            "dates": [c["date"] for c in b["commits"]],
        })
    return out


# PINNED GOLDEN — the structural shape of the worklog over the fixture.
GOLDEN_DAY = [
    {"group": "day", "key": "2026-08-31", "count": 2,
     "subjects": ["write docs", "polish login form"],
     "authors": ["Bo", "Ann"],
     "dates": ["2026-08-31T09:00:00+00:00", "2026-08-31T11:00:00+00:00"]},
    {"group": "day", "key": "2026-08-30", "count": 2,
     "subjects": ["add login", "fix logout bug"],
     "authors": ["Ann", "Ann"],
     "dates": ["2026-08-30T10:00:00+00:00", "2026-08-30T14:00:00+00:00"]},
]
GOLDEN_AUTHOR = [
    {"group": "author", "key": "Ann", "count": 3,
     "subjects": ["add login", "fix logout bug", "polish login form"],
     "authors": ["Ann", "Ann", "Ann"],
     "dates": ["2026-08-30T10:00:00+00:00", "2026-08-30T14:00:00+00:00", "2026-08-31T11:00:00+00:00"]},
    {"group": "author", "key": "Bo", "count": 1,
     "subjects": ["write docs"], "authors": ["Bo"], "dates": ["2026-08-31T09:00:00+00:00"]},
]

RESULTS = []


def check(name, cond):
    RESULTS.append((name, bool(cond)))


def main():
    with tempfile.TemporaryDirectory() as root:
        build_repo(root)

        rc_d, day = run_json(root, "day")
        rc_a, author = run_json(root, "author")

        # 1-2. pinned structural golden
        check("golden: by-day structure matches pinned", structural(day) == GOLDEN_DAY)
        check("golden: by-author structure matches pinned", structural(author) == GOLDEN_AUTHOR)

        # 3. determinism — same repo, byte-identical json twice
        _, day2 = run_json(root, "day")
        check("determinism: two by-day runs identical", day == day2)

        # 4. day order is newest-first
        keys = [b["key"] for b in day]
        check("order: days are newest-first", keys == sorted(keys, reverse=True))

        # 5. author order is most-commits-first, then name asc
        acount = [(b["count"], b["key"]) for b in author]
        check("order: authors by count desc then name asc",
              acount == sorted(acount, key=lambda t: (-t[0], t[1])))

        # 6. within a bucket, commits are chronological
        for b in day + author:
            ds = [c["date"] for c in b["commits"]]
            if ds != sorted(ds):
                check("order: within-bucket chronological", False)
                break
        else:
            check("order: within-bucket chronological", True)

        # 7. counts sum to total commits
        check("count: by-day counts sum to 4", sum(b["count"] for b in day) == 4)
        check("count: by-author counts sum to 4", sum(b["count"] for b in author) == 4)

        # 8. every commit carries the four fields
        every = all(set(c) == {"hash", "date", "author", "subject"}
                    for b in day for c in b["commits"])
        check("fields: each commit has hash,date,author,subject", every)

        # 9. hash SHAPE — short hash is 7+ hex chars (hash-independent check)
        shapes = all(re.fullmatch(r"[0-9a-f]{7,}", c["hash"])
                     for b in day for c in b["commits"])
        check("shape: short hashes are hex", shapes)

        # 10. --since narrows the span
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            worklog.main([root, "--since", "2026-08-31T00:00:00", "--by", "day", "--json"])
        narrowed = [json.loads(l) for l in buf.getvalue().splitlines() if l.strip()]
        check("since: narrows to the 31st only",
              [b["key"] for b in narrowed] == ["2026-08-31"] and narrowed[0]["count"] == 2)

        # 11. not a git repo -> exit 2
        with tempfile.TemporaryDirectory() as notrepo:
            buf = io.StringIO()
            with contextlib.redirect_stderr(buf):
                rc_bad = worklog.main([notrepo, "--json"])
            check("usage: non-repo -> exit 2", rc_bad == 2)

        # 12. clean exit 0 on a real span
        check("default: exit 0 (a worklog is a report)", rc_d == 0 and rc_a == 0)

    passed = sum(1 for _, ok in RESULTS if ok)
    total = len(RESULTS)
    for name, ok in RESULTS:
        print("%s  %s" % ("ok  " if ok else "FAIL", name))
    print("\n%d/%d passed" % (passed, total))
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
