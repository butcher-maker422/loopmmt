#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Tests for gitlog.py — run against a REAL throwaway git repo, not a mock.

The point of a source gift is that it reads a real git log correctly, so the
tests build an actual repository in a temp dir and assert on the emitted records.
Each test is written to BITE: it asserts specific values a broken implementation
would get wrong (field mapping, ordering, churn arithmetic, path filtering),
not merely that "some output appeared".

Run:  python3 test_gitlog.py       (exits non-zero if any assertion fails)
"""

import io
import json
import os
import subprocess
import sys
import tempfile

import gitlog


def _git(repo, *args, env=None):
    subprocess.run(["git", "-C", repo] + list(args), check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)


def _commit(repo, path, content, message, when):
    """Write a file and commit it with a fixed author/committer date."""
    full = os.path.join(repo, path)
    os.makedirs(os.path.dirname(full), exist_ok=True) if os.path.dirname(full) else None
    with open(full, "w", encoding="utf-8") as fh:
        fh.write(content)
    _git(repo, "add", path)
    env = dict(os.environ)
    env["GIT_AUTHOR_DATE"] = when
    env["GIT_COMMITTER_DATE"] = when
    env["GIT_AUTHOR_NAME"] = "Ada Lovelace"
    env["GIT_AUTHOR_EMAIL"] = "ada@example.com"
    env["GIT_COMMITTER_NAME"] = "Ada Lovelace"
    env["GIT_COMMITTER_EMAIL"] = "ada@example.com"
    subprocess.run(["git", "-C", repo, "commit", "-m", message],
                   check=True, stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL, env=env)


def _make_repo(tmp):
    repo = os.path.join(tmp, "r")
    os.makedirs(repo)
    _git(repo, "init")
    _git(repo, "config", "user.name", "Ada Lovelace")
    _git(repo, "config", "user.email", "ada@example.com")
    # three commits, oldest first
    _commit(repo, "a.txt", "one\ntwo\nthree\n", "first: add a.txt",
            "2026-01-01T09:00:00")
    _commit(repo, "b.txt", "x\n", "second: add b.txt",
            "2026-01-02T09:00:00")
    _commit(repo, "a.txt", "one\ntwo\nthree\nfour\n", "third: extend a.txt",
            "2026-01-03T09:00:00")
    return repo


def _run(argv):
    """Run main() capturing stdout; return (exit_code, [parsed records])."""
    buf = io.StringIO()
    old = sys.stdout
    sys.stdout = buf
    try:
        code = gitlog.main(argv)
    finally:
        sys.stdout = old
    records = [json.loads(l) for l in buf.getvalue().splitlines() if l.strip()]
    return code, records


RESULTS = []


def check(name, cond):
    RESULTS.append((name, bool(cond)))
    print(("PASS" if cond else "FAIL") + "  " + name)


def main():
    tmp = tempfile.mkdtemp(prefix="gitlog-test-")
    repo = _make_repo(tmp)

    # 1. count: three commits in, three records out.
    code, recs = _run(["--repo", repo])
    check("emits one record per commit (3)", code == 0 and len(recs) == 3)

    # 2. default order is newest-first — the third commit leads.
    check("default order newest-first",
          recs[0]["subject"] == "third: extend a.txt"
          and recs[2]["subject"] == "first: add a.txt")

    # 3. --reverse flips to oldest-first. (Bites an ignored --reverse.)
    code, rrecs = _run(["--repo", repo, "--reverse"])
    check("--reverse gives oldest-first",
          rrecs[0]["subject"] == "first: add a.txt"
          and rrecs[2]["subject"] == "third: extend a.txt")

    # 4. field mapping: author/email/dates land in the right keys.
    #    (Bites a transposed field map — the classic %an/%ae swap.)
    top = recs[0]
    check("author name mapped correctly", top["author"] == "Ada Lovelace")
    check("email mapped correctly", top["email"] == "ada@example.com")
    check("committed date is the fixed ISO date",
          top["committed"].startswith("2026-01-03T09:00:00"))
    check("hash is 40 hex chars", len(top["hash"]) == 40
          and all(c in "0123456789abcdef" for c in top["hash"]))
    check("short is a prefix of hash", top["hash"].startswith(top["short"]))

    # 5. no churn fields unless asked. (Bites churn leaking in by default.)
    check("no churn fields by default", "added" not in top and "files" not in top)

    # 6. --churn arithmetic: the first commit added 3 lines to a.txt, 0 deleted.
    code, crecs = _run(["--repo", repo, "--reverse", "--churn"])
    first = crecs[0]
    check("churn: files counted", first.get("files") == 1)
    check("churn: added lines correct (3)", first.get("added") == 3)
    check("churn: deleted lines correct (0)", first.get("deleted") == 0)
    # third commit: +1 line, -0 on a.txt
    third = crecs[2]
    check("churn: extend commit added 1", third.get("added") == 1
          and third.get("deleted") == 0)

    # 7. --path filters to commits touching that path.
    #    a.txt was touched by commits 1 and 3 only (not 2). Bites a broken filter.
    code, precs = _run(["--repo", repo, "--path", "a.txt"])
    subjects = {r["subject"] for r in precs}
    check("--path a.txt selects only its 2 commits",
          len(precs) == 2 and "second: add b.txt" not in subjects)

    # 8. -n limits count. Bites an ignored max-count.
    code, nrecs = _run(["--repo", repo, "-n", "1"])
    check("-n 1 yields exactly one record", code == 0 and len(nrecs) == 1)

    # 9. not-a-repo is exit 2, not a crash and not exit 0.
    code, _ = _run(["--repo", tmp])  # tmp itself is not a git repo
    check("non-repo path exits 2", code == 2)

    # 10. -n 0 is a usage error (exit 3).
    code, _ = _run(["--repo", repo, "-n", "0"])
    check("-n 0 is usage error (exit 3)", code == 3)

    # 11. stdout is clean JSON-lines: every emitted line parses as a JSON object.
    code, recs = _run(["--repo", repo])
    check("every line is a JSON object",
          all(isinstance(r, dict) for r in recs) and len(recs) == 3)

    # 12. empty range is exit 0 with zero records (not an error).
    code, erecs = _run(["--repo", repo, "--since", "2030-01-01"])
    check("empty result is exit 0, zero records", code == 0 and erecs == [])

    # --- meta: the suite must not be vacuous ---
    ran = len(RESULTS)
    passed = sum(1 for _, ok in RESULTS if ok)
    print("\n%d/%d checks passed (%d ran)" % (passed, ran, ran))
    if ran < 12:
        print("VACUITY GUARD FAILED: too few checks ran")
        return 1
    return 0 if passed == ran else 1


if __name__ == "__main__":
    sys.exit(main())
