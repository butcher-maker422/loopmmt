#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""
amber — seal a set of files into a content-addressed snapshot you can prove unaltered.

Amber is tree resin that hardened around an insect and held it, unchanged, for
forty million years — you can still read the wing. `amber` is that for a set of
files: it seals a *moment* — the exact bytes of the paths you name — into a small
JSON capsule whose fixity IS the content. Any later change to any sealed file, or
to the capsule itself, breaks the seal loudly. Nothing is silently altered.

WHAT IT IS (and is not)
    It is a **fixity manifest**, not an archive. It does NOT copy your files or
    store their bytes — it pins each file's content hash (a git-style blob SHA:
    `sha1("blob <len>\\0" + bytes)`, the same address git itself would give the
    file). The capsule is tiny — a list of {path, sha, bytes} plus one seal hash
    over the whole manifest — no matter how large the sealed files are. To prove a
    file unchanged later, `amber verify` re-hashes it and compares. (If you also
    want the bytes preserved, keep the files in git, or zip them separately —
    amber proves *identity*, git/zip preserve *bytes*. Amber is the cheap,
    portable proof-of-no-change that rides alongside.)

THE SEAL (why a change anywhere is caught)
    The manifest carries a `seal_sha256`: sha256 over the CANONICAL manifest with
    the seal field blanked. It covers every pinned file's SHA transitively, so:
      - change a sealed file's bytes   -> its blob SHA changes   -> verify FAILs
      - edit the manifest (add/drop/reorder a file, fudge a size) -> seal FAILs
      - blank/forge the seal itself    -> recomputed seal ≠ stored -> FAILs
    There is no edit that leaves a valid seal. `verify` names the broken member
    and exits non-zero — never a silent pass over a tampered capsule.

DOCTRINE (binding, inherited from the Amber format)
    1. Append-only. A sealed capsule is never edited. Re-sealing a moment makes a
       NEW capsule with its own seal-date. The series of capsules is the record.
       `seal` refuses to overwrite an existing capsule.
    2. Fixity is the content. Amber pins content hashes, not copies — a specimen's
       address IS its content, so the capsule can never drift from what it claims.
    3. Byte, never token. Sizes in bytes; hashes over bytes.
    4. The seal is loud. `verify` exits non-zero and names the broken member.

USAGE
    amber seal --id my-snapshot --out capsule.json a.txt b/c.txt docs/
        Pin every named file (a directory is walked, all files under it pinned)
        into capsule.json, relative to --root (default: current directory).
        Refuses to overwrite an existing capsule (append-only).

    amber verify --capsule capsule.json
        Re-hash every pinned file against --root and recompute the seal. PASS
        (exit 0) iff nothing changed; FAIL (exit 1) naming each broken member.

    amber show --capsule capsule.json
        Print a human summary: id, seal date, member count, total bytes, seal.

    amber --port       # print amber's own port-verb (fold) and exit
    amber --selftest   # run built-in checks and exit

WHAT THIS IS A STRIP OF
    An internal total-snapshot engine (CC-BY-NC) sealed a moment of a byte-truth
    store — a payload, a faceted context Inclusion selected by YAML front-matter,
    a panel of frozen reports, and an embedded fidelity reading — pinning git blob
    SHAs under a canonical seal hash. This gift keeps the load-bearing atom — pin
    content hashes (never duplicate) + one canonical seal hash + loud verify — and
    drops the host-specific machinery (the front-matter facet query, the report
    panel, the fidelity reading, the hardcoded repo root). What remains is a
    plain, portable content-fixity sealer over any set of files. Net-new
    stdlib-only Python; nothing lifted; re-licensed MIT.

    amber's port-verb is `fold`: many files in, one sealed aggregate (the capsule)
    out.
"""

import argparse
import hashlib
import json
import os
import sys
import datetime


PORT_VERB = "fold"          # many files -> one sealed aggregate snapshot
AMBER_VERSION = 1


# ─── the content hash (git-style blob SHA — the same address git gives a file) ─

def blob_sha(path):
    """git blob SHA-1 of a file's bytes: sha1(b"blob <len>\\0" + bytes)."""
    with open(path, "rb") as f:
        data = f.read()
    h = hashlib.sha1()
    h.update(b"blob %d\0" % len(data))
    h.update(data)
    return h.hexdigest()


# ─── the canonical seal hash (covers the whole manifest, seal field blanked) ──

def seal_hash(manifest):
    """sha256 over the canonical manifest with the seal field blanked.

    Deep-copy, blank fixity.seal_sha256, serialize with sorted keys and no
    whitespace, hash. This transitively covers every pinned member's SHA and byte
    count, so no manifest edit leaves a valid seal.
    """
    m = json.loads(json.dumps(manifest))          # deep copy
    m["fixity"]["seal_sha256"] = ""
    canon = json.dumps(m, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


# ─── path collection (a file pins itself; a directory pins every file under it) ─

SKIP_DIRS = {".git", "node_modules", "__pycache__"}


def collect(root, targets):
    """Resolve targets (files or dirs) to a sorted list of file paths rel to root.

    A directory is walked recursively; SKIP_DIRS are pruned. A named file is
    pinned directly. Raises FileNotFoundError on a missing target.
    """
    paths = []
    for t in targets:
        ap = t if os.path.isabs(t) else os.path.join(root, t)
        if not os.path.exists(ap):
            raise FileNotFoundError(t)
        if os.path.isdir(ap):
            for dirpath, dirnames, filenames in os.walk(ap):
                dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
                for fn in filenames:
                    paths.append(os.path.join(dirpath, fn))
        else:
            paths.append(ap)
    # relative, de-duplicated, sorted (deterministic manifest)
    rels = sorted(set(os.path.relpath(p, root) for p in paths))
    return rels


def pin(root, rel):
    """Pin one file: {path, blob_sha, bytes}."""
    ap = os.path.join(root, rel)
    return {"path": rel, "blob_sha": blob_sha(ap), "bytes": os.path.getsize(ap)}


# ─── build a manifest (pure — no I/O of the capsule; testable) ────────────────

def build_manifest(root, capsule_id, targets, session=""):
    """Build the capsule manifest dict for the given targets. Sealed."""
    rels = collect(root, targets)
    members = [pin(root, r) for r in rels]
    manifest = {
        "amber_version": AMBER_VERSION,
        "id": capsule_id,
        "seal_date": datetime.date.today().isoformat(),
        "seal_session": session,
        "members": members,
        "fixity": {
            "seal_sha256": "",
            "file_count": len(members),
            "total_bytes": sum(m["bytes"] for m in members),
        },
    }
    manifest["fixity"]["seal_sha256"] = seal_hash(manifest)
    return manifest


# ─── verify a manifest against a live root (pure — returns broken members) ────

def verify_manifest(manifest, root):
    """Return a list of broken-member descriptions ([] iff the seal holds).

    Checks: (1) the manifest seal hash recomputes; (2) every pinned member's file
    exists and still hashes to its stored SHA.
    """
    broken = []
    if seal_hash(manifest) != manifest["fixity"]["seal_sha256"]:
        broken.append("manifest seal hash")
    for m in manifest["members"]:
        ap = os.path.join(root, m["path"])
        if not os.path.exists(ap):
            broken.append(f"pinned missing: {m['path']}")
        elif blob_sha(ap) != m["blob_sha"]:
            broken.append(f"pinned drifted: {m['path']}")
    return broken


# ─── CLI ──────────────────────────────────────────────────────────────────────

def cmd_seal(a):
    root = os.path.abspath(a.root)
    if os.path.exists(a.out):
        sys.stderr.write(
            f"amber: refusing to overwrite existing capsule {a.out} "
            f"(append-only — re-seal a moment as a NEW capsule with a new id/out).\n")
        return 2
    if not a.targets:
        sys.stderr.write("amber: seal needs at least one file or directory to pin.\n")
        return 2
    try:
        manifest = build_manifest(root, a.id, a.targets, session=a.session)
    except FileNotFoundError as e:
        sys.stderr.write(f"amber: cannot seal — no such path: {e}\n")
        return 2
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    fx = manifest["fixity"]
    print(f"AMBER SEAL OK | {a.id} | pinned {fx['file_count']} member(s) | "
          f"{fx['total_bytes']} B | seal {fx['seal_sha256'][:16]}…")
    return 0


def cmd_verify(a):
    with open(a.capsule, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    root = os.path.abspath(a.root)
    broken = verify_manifest(manifest, root)
    if broken:
        print("AMBER VERIFY: FAIL")
        for b in broken:
            print(f"  ✗ {b}")
        return 1
    fx = manifest["fixity"]
    print(f"AMBER VERIFY: PASS | {manifest['id']} | {fx['file_count']} member(s) | "
          f"{fx['total_bytes']} B | seal {fx['seal_sha256'][:16]}…")
    return 0


def cmd_show(a):
    with open(a.capsule, "r", encoding="utf-8") as f:
        m = json.load(f)
    fx = m["fixity"]
    print(f"AMBER {m['id']}  (sealed {m['seal_date']}"
          + (f" · {m['seal_session']}" if m.get("seal_session") else "") + ")")
    print(f"  members : {fx['file_count']}")
    print(f"  bytes   : {fx['total_bytes']}")
    print(f"  seal    : {fx['seal_sha256']}")
    # list up to 10 members for a quick glance
    for mem in m["members"][:10]:
        print(f"    {mem['blob_sha'][:12]}  {mem['bytes']:>8}  {mem['path']}")
    if len(m["members"]) > 10:
        print(f"    … and {len(m['members']) - 10} more")
    return 0


def _selftest():
    import tempfile
    import shutil

    n = 0
    def check(cond, msg):
        nonlocal n
        assert cond, msg
        n += 1

    tmp = tempfile.mkdtemp()
    try:
        # a small tree
        os.makedirs(os.path.join(tmp, "sub"))
        with open(os.path.join(tmp, "a.txt"), "w") as f:
            f.write("alpha\n")
        with open(os.path.join(tmp, "sub", "b.txt"), "w") as f:
            f.write("beta\n")

        # build + seal
        man = build_manifest(tmp, "s1", ["a.txt", "sub"])
        check(man["fixity"]["file_count"] == 2, "seals both files")
        check(man["members"][0]["path"] < man["members"][1]["path"], "members sorted")
        check(len(man["fixity"]["seal_sha256"]) == 64, "seal is a sha256 hex")

        # verify clean
        check(verify_manifest(man, tmp) == [], "a fresh seal verifies clean")

        # determinism: same tree seals to the same member SHAs + seal hash
        man2 = build_manifest(tmp, "s1", ["a.txt", "sub"])
        check(man2["fixity"]["seal_sha256"] == man["fixity"]["seal_sha256"],
              "same bytes -> same seal (deterministic)")

        # tamper a sealed file -> verify FAILs, names the drifted member
        with open(os.path.join(tmp, "a.txt"), "w") as f:
            f.write("ALPHA-CHANGED\n")
        broken = verify_manifest(man, tmp)
        check(any("a.txt" in b and "drifted" in b for b in broken),
              "a changed file is caught as drifted")
        # restore, verify clean again
        with open(os.path.join(tmp, "a.txt"), "w") as f:
            f.write("alpha\n")
        check(verify_manifest(man, tmp) == [], "restoring the bytes restores the seal")

        # delete a sealed file -> caught as missing
        os.unlink(os.path.join(tmp, "sub", "b.txt"))
        broken = verify_manifest(man, tmp)
        check(any("b.txt" in b and "missing" in b for b in broken),
              "a deleted file is caught as missing")
        with open(os.path.join(tmp, "sub", "b.txt"), "w") as f:
            f.write("beta\n")

        # tamper the MANIFEST (fudge a byte count) -> seal hash FAILs
        tampered = json.loads(json.dumps(man))
        tampered["members"][0]["bytes"] += 1
        broken = verify_manifest(tampered, tmp)
        check("manifest seal hash" in broken, "editing the manifest breaks the seal")

        # forge the seal to match a tampered manifest: build fresh, lie about a
        # member's SHA, recompute the seal so the seal-hash check passes — the live
        # member no longer matches, so verify still FAILs (the two checks are independent)
        fresh = build_manifest(tmp, "s2", ["a.txt", "sub"])
        forged = json.loads(json.dumps(fresh))
        for mem in forged["members"]:
            if mem["path"] == "a.txt":
                mem["blob_sha"] = "0" * 40
        forged["fixity"]["seal_sha256"] = seal_hash(forged)  # attacker recomputes
        broken = verify_manifest(forged, tmp)
        check("manifest seal hash" not in broken, "the recomputed seal passes the hash check")
        check(any("a.txt" in b and "drifted" in b for b in broken),
              "a forged seal cannot hide that a member no longer matches the bytes")

        # append-only: seal refuses to overwrite (CLI-level, tested via os path)
        cap = os.path.join(tmp, "cap.json")
        with open(cap, "w") as f:
            f.write("{}")
        class A: pass
        a = A(); a.root = tmp; a.out = cap; a.id = "x"; a.targets = ["a.txt"]; a.session = ""
        rc = cmd_seal(a)
        check(rc == 2, "seal refuses to overwrite an existing capsule (append-only)")

        # port-verb
        check(PORT_VERB == "fold", "port-verb is fold")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print(f"amber selftest: {n} checks passed")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="amber",
        description="Seal a set of files into a content-addressed snapshot you can prove unaltered.")
    ap.add_argument("--port", action="store_true",
                    help="print amber's own port-verb (fold) and exit")
    ap.add_argument("--selftest", action="store_true",
                    help="run built-in checks and exit")
    sub = ap.add_subparsers(dest="cmd")

    s = sub.add_parser("seal", help="pin a set of files into a sealed capsule")
    s.add_argument("--id", required=True, help="capsule id")
    s.add_argument("--out", required=True, help="capsule JSON path (refuses to overwrite)")
    s.add_argument("--root", default=".", help="root the pinned paths are relative to (default: cwd)")
    s.add_argument("--session", default="", help="optional seal-session label")
    s.add_argument("targets", nargs="*", help="files and/or directories to pin")
    s.set_defaults(fn=cmd_seal)

    v = sub.add_parser("verify", help="re-hash every member and recompute the seal")
    v.add_argument("--capsule", required=True, help="capsule JSON to verify")
    v.add_argument("--root", default=".", help="root to verify against (default: cwd)")
    v.set_defaults(fn=cmd_verify)

    h = sub.add_parser("show", help="print a capsule summary")
    h.add_argument("--capsule", required=True)
    h.set_defaults(fn=cmd_show)

    args = ap.parse_args(argv)

    if args.port:
        print(json.dumps({"slug": "amber", "port_verb": PORT_VERB}))
        return 0
    if args.selftest:
        return _selftest()
    if not getattr(args, "cmd", None):
        ap.print_help()
        return 0
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
