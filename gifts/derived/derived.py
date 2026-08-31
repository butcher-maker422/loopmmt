#!/usr/bin/env python3
"""derived.py — is a generated file STALE against the command that makes it?

A "derived" file is one no human should hand-edit: a build command produces it
from some source, and the committed copy is only ever supposed to be whatever
that command most recently emitted. The failure this catches is the oldest one
in generated code: the source moved, nobody re-ran the build, and the committed
derived file quietly fell behind. It works today (it is a real file on disk) and
breaks silently later, so no "does the file exist?" check ever sees it.

    A script-generated file cannot DRIFT; it can only be STALE,
    and stale is one command.

That sentence is TRUE and it is NOT A GUARD. The command is unenforced, so the
sentence describes the fix, not a mechanism -- and the file goes stale while the
sentence sits there being correct. This tool is the mechanism: it RUNS the build
command and byte-compares its fresh output against the committed derived file.

NON-MUTATING BY CONTRACT (the property this gift is built around).
This never edits your working tree. It runs the build command inside a private
temporary directory, seeded with a copy of your inputs, and compares the fresh
output there against the committed derived file here. Your files are never
touched -- there is no reading of a tree that proves an edit is worthless, and a
checker must not destroy one on a guess. If the build command insists on writing
in place, pass --in-place and it runs against a full copy of the working tree in
the sandbox (still never your real tree).

THE ORACLE IS THE COMMAND ITSELF, ON PURPOSE.
This carries no copy of the source->derived mapping. You name the build command
and the file it is supposed to produce; the tool asks the only question that
needs no mapping: run the command fresh -- does what it emits match what is
committed, byte for byte? A checker that re-declared the mapping would be a
second source of truth for it, which is the very fault class being guarded.

EXITS
  0  CURRENT  -- the committed derived file matches a fresh build, byte for byte
  3  STALE    -- it does not; the diff summary is printed (and --show-diff dumps it)
  4  BUILD-FAILED -- the build command exited non-zero; nothing can be concluded
  2  USAGE    -- bad arguments, or the derived file / a --copy input is missing

USAGE
  # The build command writes the derived file to a path you name.
  python3 derived.py --build-cmd "python3 gen.py" --derived out/table.json --copy gen.py --copy data/

  # The build command writes to stdout; capture it and compare.
  python3 derived.py --build-cmd "python3 gen.py" --derived out/table.json --stdout --copy gen.py

  # The build insists on editing files in place: run it against a tree copy.
  python3 derived.py --build-cmd "make derived" --derived out/x --in-place

  python3 derived.py --json      # machine-readable verdict
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

EXIT_CURRENT = 0
EXIT_USAGE = 2
EXIT_STALE = 3
EXIT_BUILD_FAILED = 4

# --- the printed edge: what this gift does NOT do -------------------------
EDGE = (
    "this checks STALENESS (committed vs a fresh build), not CORRECTNESS: "
    "a green means the file matches what the command emits right now, never "
    "that the command or its output is right. It runs your build command, so "
    "only point it at a command you trust."
)


def _read_bytes(path):
    with open(path, "rb") as fh:
        return fh.read()


def _diff_summary(want, got):
    """A short, deterministic description of a byte difference. No external diff."""
    if want == got:
        return "identical"
    if len(want) != len(got):
        lead = "committed" if len(want) > len(got) else "fresh-build"
        return f"length differs: committed={len(want)}B fresh={len(got)}B (longer: {lead})"
    for i, (a, b) in enumerate(zip(want, got)):
        if a != b:
            return f"first byte differs at offset {i}: committed=0x{a:02x} fresh=0x{b:02x}"
    return "differ"  # unreachable given the length/zip checks above


def check(build_cmd, derived, copies, use_stdout=False, in_place=False,
          repo_root=None):
    """Run the build fresh in a sandbox and compare to the committed derived file.

    Returns a result dict with a 'status' of current | stale | build-failed | usage.
    Never mutates the working tree.
    """
    root = repo_root or os.getcwd()
    result = {
        "build_cmd": build_cmd,
        "derived": derived,
        "status": "current",
        "diff": "identical",
        "edge": EDGE,
    }

    committed_path = os.path.join(root, derived)
    if not os.path.isfile(committed_path):
        result["status"] = "usage"
        result["error"] = f"derived file not found: {derived}"
        return result
    committed = _read_bytes(committed_path)

    sandbox = tempfile.mkdtemp(prefix="derived-check.")
    try:
        if in_place:
            # Copy the whole working tree so an in-place build can't touch the real one.
            for entry in os.listdir(root):
                if entry == ".git":
                    continue  # never needed to rebuild a derived file; huge
                src = os.path.join(root, entry)
                dst = os.path.join(sandbox, entry)
                if os.path.isdir(src):
                    shutil.copytree(src, dst, symlinks=True)
                else:
                    shutil.copy2(src, dst)
        else:
            for rel in copies:
                src = os.path.join(root, rel)
                if not os.path.exists(src):
                    result["status"] = "usage"
                    result["error"] = f"--copy input not found: {rel}"
                    return result
                dst = os.path.join(sandbox, rel)
                os.makedirs(os.path.dirname(dst) or sandbox, exist_ok=True)
                if os.path.isdir(src):
                    shutil.copytree(src, dst, symlinks=True)
                else:
                    shutil.copy2(src, dst)

        proc = subprocess.run(
            build_cmd, shell=True, cwd=sandbox,
            capture_output=True, timeout=300,
        )
        if proc.returncode != 0:
            result["status"] = "build-failed"
            result["exit"] = proc.returncode
            result["stderr"] = proc.stderr.decode("utf-8", "replace")[:2000]
            return result

        if use_stdout:
            fresh = proc.stdout
        else:
            fresh_path = os.path.join(sandbox, derived)
            if not os.path.isfile(fresh_path):
                result["status"] = "build-failed"
                result["error"] = (
                    f"build ran but produced no {derived} in the sandbox "
                    f"(did you mean --stdout, or a different --derived path?)"
                )
                return result
            fresh = _read_bytes(fresh_path)

        if fresh == committed:
            result["status"] = "current"
            result["diff"] = "identical"
        else:
            result["status"] = "stale"
            result["diff"] = _diff_summary(committed, fresh)
            result["_fresh"] = fresh
            result["_committed"] = committed
        return result
    finally:
        shutil.rmtree(sandbox, ignore_errors=True)


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Is a generated file stale against the command that makes it?",
        epilog="EDGE: " + EDGE,
    )
    ap.add_argument("--build-cmd", required=True,
                    help="the command that regenerates the derived file (run in a sandbox)")
    ap.add_argument("--derived", required=True,
                    help="repo-relative path of the file the command is supposed to produce")
    ap.add_argument("--copy", action="append", default=[], metavar="PATH",
                    help="input file/dir the build needs; repeatable (ignored with --in-place)")
    ap.add_argument("--stdout", action="store_true",
                    help="the build writes the derived content to stdout; capture and compare it")
    ap.add_argument("--in-place", action="store_true",
                    help="the build edits files in place; run it against a full copy of the tree")
    ap.add_argument("--show-diff", action="store_true",
                    help="on STALE, dump both versions' first differing region")
    ap.add_argument("--json", action="store_true", help="machine-readable verdict")
    ap.add_argument("--edge", action="store_true", help="print the printed edge and exit")
    args = ap.parse_args(argv)

    if args.edge:
        print(EDGE)
        return EXIT_CURRENT

    res = check(
        args.build_cmd, args.derived, args.copy,
        use_stdout=args.stdout, in_place=args.in_place,
    )
    status = res["status"]
    # strip internal blobs before any user-facing emission
    fresh = res.pop("_fresh", None)
    committed = res.pop("_committed", None)

    if args.json:
        print(json.dumps(res, indent=2, sort_keys=True))
    else:
        if status == "current":
            print(f"CURRENT — {args.derived} matches a fresh build")
        elif status == "stale":
            print(f"STALE — {args.derived} is behind its build command")
            print(f"  {res['diff']}")
            print(f"  regenerate with: {args.build_cmd}")
            if args.show_diff and fresh is not None:
                print("  --- committed (first 400B) ---")
                sys.stdout.buffer.write(committed[:400])
                print("\n  --- fresh build (first 400B) ---")
                sys.stdout.buffer.write(fresh[:400])
                print()
        elif status == "build-failed":
            print(f"BUILD-FAILED — {res.get('error') or 'the build command exited non-zero'}")
            if res.get("stderr"):
                print(res["stderr"])
        else:  # usage
            print(f"USAGE ERROR — {res.get('error', 'bad arguments')}", file=sys.stderr)

    return {
        "current": EXIT_CURRENT,
        "stale": EXIT_STALE,
        "build-failed": EXIT_BUILD_FAILED,
        "usage": EXIT_USAGE,
    }[status]


if __name__ == "__main__":
    sys.exit(main())
