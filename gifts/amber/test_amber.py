#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""
test_amber.py — golden + mutation battery for the amber gift.

Run:  python3 test_amber.py
Exit 0 iff every golden check passes AND every planted mutation is caught.

Discipline (the count-fill lessons, applied upfront):
  1. ISOLATE each load-bearing predicate — a "bad" case must fail on EXACTLY the
     predicate under test, never by another path.
  2. A .replace(...,1) anchor targets a CODE line, not a docstring example; the
     harness asserts each anchor is present outside the docstring AND bites.
  Every ESCAPE is a real test gap (missing/weak golden check), never noise.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "amber.py")
# _CLI_TARGET lets a mutation test point the CLI checks at a mutated copy on disk.
_CLI_TARGET = [SRC]


def _load_module_from_source(text, name):
    import importlib.util
    tmp = tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8")
    tmp.write(text)
    tmp.close()
    spec = importlib.util.spec_from_file_location(name, tmp.name)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    os.unlink(tmp.name)
    return mod


def _run_cli(args, cwd=None):
    proc = subprocess.run([sys.executable, _CLI_TARGET[0]] + args, capture_output=True, cwd=cwd)
    return proc.returncode, proc.stdout.decode(), proc.stderr.decode()


def _mktree():
    """A small tree: a.txt, sub/b.txt. Returns the root path."""
    root = tempfile.mkdtemp()
    os.makedirs(os.path.join(root, "sub"))
    with open(os.path.join(root, "a.txt"), "w") as f:
        f.write("alpha\n")
    with open(os.path.join(root, "sub", "b.txt"), "w") as f:
        f.write("beta\n")
    return root


GOLDEN = []
def golden(fn):
    GOLDEN.append(fn)
    return fn


@golden
def g_port_verb_is_fold(mod):
    assert mod.PORT_VERB == "fold"
    rc, out, _ = _run_cli(["--port"])
    assert rc == 0
    assert json.loads(out) == {"slug": "amber", "port_verb": "fold"}, out


@golden
def g_seals_all_files_sorted(mod):
    """A dir target pins every file under it; members are sorted (deterministic).

    Uses several files whose creation/walk order is NOT their sorted order, so a
    dropped sort() is actually detectable (not coincidentally sorted).
    """
    root = tempfile.mkdtemp()
    try:
        # create in deliberately non-alphabetical order
        for nm in ["zebra.txt", "apple.txt", "mango.txt", "banana.txt"]:
            with open(os.path.join(root, nm), "w") as f:
                f.write(nm + "\n")
        man = mod.build_manifest(root, "s1", ["."])
        assert man["fixity"]["file_count"] == 4, man["fixity"]
        paths = [m["path"] for m in man["members"]]
        assert paths == sorted(paths), f"members must be sorted, got: {paths}"
        # and specifically the first must be the alphabetical first, last the last
        assert paths[0] == "apple.txt" and paths[-1] == "zebra.txt", paths
    finally:
        shutil.rmtree(root, ignore_errors=True)


@golden
def g_fresh_seal_verifies_clean(mod):
    root = _mktree()
    try:
        man = mod.build_manifest(root, "s1", ["a.txt", "sub"])
        assert mod.verify_manifest(man, root) == [], "a fresh seal must verify clean"
    finally:
        shutil.rmtree(root, ignore_errors=True)


@golden
def g_deterministic_seal(mod):
    """ISOLATES determinism: same bytes -> byte-identical seal hash."""
    root = _mktree()
    try:
        m1 = mod.build_manifest(root, "s1", ["a.txt", "sub"])
        m2 = mod.build_manifest(root, "s1", ["a.txt", "sub"])
        assert m1["fixity"]["seal_sha256"] == m2["fixity"]["seal_sha256"], "seal must be deterministic"
        assert m1["members"] == m2["members"], "member SHAs must be deterministic"
    finally:
        shutil.rmtree(root, ignore_errors=True)


@golden
def g_changed_file_is_drifted(mod):
    """ISOLATES the pinned-SHA check: a changed byte -> 'drifted', naming the file."""
    root = _mktree()
    try:
        man = mod.build_manifest(root, "s1", ["a.txt", "sub"])
        with open(os.path.join(root, "a.txt"), "w") as f:
            f.write("ALPHA-CHANGED\n")
        broken = mod.verify_manifest(man, root)
        assert any("a.txt" in b and "drifted" in b for b in broken), broken
        # and the OTHER file (unchanged) is NOT flagged — isolation
        assert not any("b.txt" in b for b in broken), "only the changed file drifts"
    finally:
        shutil.rmtree(root, ignore_errors=True)


@golden
def g_deleted_file_is_missing(mod):
    """ISOLATES the existence check: a deleted member -> 'missing'."""
    root = _mktree()
    try:
        man = mod.build_manifest(root, "s1", ["a.txt", "sub"])
        os.unlink(os.path.join(root, "sub", "b.txt"))
        broken = mod.verify_manifest(man, root)
        assert any("b.txt" in b and "missing" in b for b in broken), broken
    finally:
        shutil.rmtree(root, ignore_errors=True)


@golden
def g_manifest_edit_breaks_seal(mod):
    """ISOLATES the seal-hash check: fudging a byte count -> seal hash breaks."""
    root = _mktree()
    try:
        man = mod.build_manifest(root, "s1", ["a.txt", "sub"])
        tampered = json.loads(json.dumps(man))
        tampered["members"][0]["bytes"] += 1
        broken = mod.verify_manifest(tampered, root)
        assert "manifest seal hash" in broken, broken
    finally:
        shutil.rmtree(root, ignore_errors=True)


@golden
def g_forged_seal_cannot_hide_drift(mod):
    """A recomputed seal over a tampered manifest still FAILs on the member check.

    The attacker edits a member SHA and recomputes the seal so the seal-hash check
    passes — but the member no longer matches the live bytes, so verify still FAILs.
    This proves the two checks are independent (seal AND per-member), not one.
    """
    root = _mktree()
    try:
        man = mod.build_manifest(root, "s1", ["a.txt", "sub"])
        tampered = json.loads(json.dumps(man))
        # point a.txt at a wrong SHA, then recompute the seal to match the lie
        for m in tampered["members"]:
            if m["path"] == "a.txt":
                m["blob_sha"] = "0" * 40
        tampered["fixity"]["seal_sha256"] = mod.seal_hash(tampered)
        broken = mod.verify_manifest(tampered, root)
        # seal-hash now passes, but the member drift is still caught
        assert "manifest seal hash" not in broken, "attacker's recomputed seal passes the hash check"
        assert any("a.txt" in b and "drifted" in b for b in broken), (
            "a forged seal cannot hide that a member no longer matches the bytes")
    finally:
        shutil.rmtree(root, ignore_errors=True)


@golden
def g_blob_sha_matches_git(mod):
    """ISOLATES the blob-SHA formula: it must equal git's own blob hash of the bytes."""
    root = _mktree()
    try:
        got = mod.blob_sha(os.path.join(root, "a.txt"))
        # git blob sha of "alpha\n" (6 bytes) — computed independently here
        import hashlib
        data = b"alpha\n"
        want = hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()
        assert got == want, f"blob_sha must match git's formula: {got} != {want}"
    finally:
        shutil.rmtree(root, ignore_errors=True)


@golden
def g_cli_seal_verify_roundtrip(mod):
    """CLI end-to-end: seal then verify PASS; then tamper -> verify FAIL (exit 1)."""
    root = _mktree()
    try:
        cap = os.path.join(root, "cap.json")
        rc, out, err = _run_cli(["seal", "--id", "t", "--out", cap, "--root", root, "a.txt", "sub"])
        assert rc == 0, (rc, err)
        rc, out, err = _run_cli(["verify", "--capsule", cap, "--root", root])
        assert rc == 0 and "PASS" in out, (rc, out, err)
        with open(os.path.join(root, "a.txt"), "w") as f:
            f.write("changed\n")
        rc, out, err = _run_cli(["verify", "--capsule", cap, "--root", root])
        assert rc == 1 and "FAIL" in out, (rc, out)
    finally:
        shutil.rmtree(root, ignore_errors=True)


@golden
def g_cli_seal_refuses_overwrite(mod):
    """ISOLATES append-only: seal onto an existing path is refused (exit 2)."""
    root = _mktree()
    try:
        cap = os.path.join(root, "cap.json")
        with open(cap, "w") as f:
            f.write("{}")
        rc, out, err = _run_cli(["seal", "--id", "t", "--out", cap, "--root", root, "a.txt"])
        assert rc == 2 and "append-only" in err.lower(), (rc, err)
    finally:
        shutil.rmtree(root, ignore_errors=True)


@golden
def g_file_count_matches_members(mod):
    """ISOLATES the count: fixity.file_count must equal the actual member count.

    (A wrong count is self-consistent under the seal — build and verify both use
    it — so verify can't catch it; only an independent count check can.)
    """
    root = _mktree()
    try:
        man = mod.build_manifest(root, "s1", ["a.txt", "sub"])
        assert man["fixity"]["file_count"] == len(man["members"]), (
            f"file_count {man['fixity']['file_count']} != {len(man['members'])} members")
    finally:
        shutil.rmtree(root, ignore_errors=True)


@golden
def g_missing_target_is_refused(mod):
    """A named path that does not exist -> refuse, don't seal a phantom."""
    root = _mktree()
    try:
        try:
            mod.build_manifest(root, "s1", ["nope.txt"])
            assert False, "a missing target must raise"
        except FileNotFoundError:
            pass
    finally:
        shutil.rmtree(root, ignore_errors=True)


# ─── mutations: (name, code_anchor, replacement, target golden check) ─────────

MUTATIONS = [
    ("port_verb_wrong",
     'PORT_VERB = "fold"',
     'PORT_VERB = "sink"',
     "g_port_verb_is_fold"),

    # blob_sha drops the git header -> no longer matches git's formula
    ("blob_sha_no_header",
     'h.update(b"blob %d\\0" % len(data))',
     'h.update(b"")',
     "g_blob_sha_matches_git"),

    # members not sorted -> non-deterministic order (isolated by the sorted check)
    ("members_not_sorted",
     "    rels = sorted(set(os.path.relpath(p, root) for p in paths))",
     "    rels = list(set(os.path.relpath(p, root) for p in paths))",
     "g_seals_all_files_sorted"),

    # seal_hash must DEEP-COPY before blanking, else it mutates the caller's
    # manifest as a side effect — corrupting the stored seal on verify. Aliasing
    # instead of copying makes a fresh seal verify as broken.
    ("seal_hash_no_deepcopy",
     'm = json.loads(json.dumps(manifest))          # deep copy',
     'm = manifest          # deep copy',
     "g_fresh_seal_verifies_clean"),

    # per-member drift check disabled -> a changed file no longer caught
    ("drift_check_disabled",
     'elif blob_sha(ap) != m["blob_sha"]:',
     'elif False:',
     "g_changed_file_is_drifted"),

    # existence check disabled -> a deleted member no longer caught as missing
    ("missing_check_disabled",
     'if not os.path.exists(ap):\n            broken.append(f"pinned missing: {m[\'path\']}")',
     'if False:\n            broken.append(f"pinned missing: {m[\'path\']}")',
     "g_deleted_file_is_missing"),

    # seal-hash check disabled -> a manifest edit no longer caught
    ("seal_check_disabled",
     'if seal_hash(manifest) != manifest["fixity"]["seal_sha256"]:',
     'if False:',
     "g_manifest_edit_breaks_seal"),

    # append-only guard disabled -> seal overwrites an existing capsule
    ("append_only_disabled",
     "    if os.path.exists(a.out):",
     "    if False:",
     "g_cli_seal_refuses_overwrite"),

    # missing-target guard disabled: collect() no longer raises on a bad path.
    # Isolated by g_missing_target_is_refused.
    ("missing_target_ignored",
     "        if not os.path.exists(ap):\n            raise FileNotFoundError(t)",
     "        if not os.path.exists(ap):\n            continue",
     "g_missing_target_is_refused"),

    # total_bytes computed wrong (e.g. count members not bytes) -> seal changes but
    # more importantly the deterministic-vs-live parity check would break. Isolate
    # via the seal determinism: a bytes miscount still hashes deterministically, so
    # target the file_count instead — a dropped member breaks the count check.
    ("file_count_wrong",
     '"file_count": len(members),',
     '"file_count": len(members) + 1,',
     "g_file_count_matches_members"),
]


def _run_golden(mod, name):
    fn = next(f for f in GOLDEN if f.__name__ == name)
    try:
        fn(mod)
        return True
    except Exception:
        return False


def _run_cli_golden(name, script_path):
    """Run a CLI golden check against an arbitrary amber.py path (a mutated copy).

    Points _CLI_TARGET at the mutated script, runs the check, restores. Returns
    True iff the check passed (i.e. the mutation escaped detection).
    """
    fn = next(f for f in GOLDEN if f.__name__ == name)
    saved = _CLI_TARGET[0]
    _CLI_TARGET[0] = script_path
    try:
        fn(None)   # CLI golden checks don't use the module arg
        return True
    except Exception:
        return False
    finally:
        _CLI_TARGET[0] = saved


def main():
    src = open(SRC, encoding="utf-8").read()
    base = _load_module_from_source(src, "amber_base")

    gpass = 0
    for fn in GOLDEN:
        fn(base)
        gpass += 1
    print(f"golden: {gpass}/{len(GOLDEN)} passed")

    caught = 0
    body = src.split('"""', 2)[-1] if src.count('"""') >= 2 else src
    for name, anchor, repl, target in MUTATIONS:
        assert anchor in src, f"MUTATION {name}: anchor not found (stale test)"
        assert anchor in body, f"MUTATION {name}: anchor only in docstring (non-biting)"
        mutated = src.replace(anchor, repl, 1)
        assert mutated != src, f"MUTATION {name}: replace was a no-op"
        target_fn = next(f for f in GOLDEN if f.__name__ == target)
        uses_cli = target in ("g_cli_seal_refuses_overwrite", "g_cli_seal_verify_roundtrip",
                              "g_port_verb_is_fold")
        if uses_cli:
            # Write mutated source to a temp file; run the CLI golden check against
            # it by pointing a fresh _run_cli at that path (no global mutation).
            mtmp = tempfile.NamedTemporaryFile("w", suffix=".py", delete=False)
            mtmp.write(mutated); mtmp.close()
            try:
                still = _run_cli_golden(target, mtmp.name)
            finally:
                os.unlink(mtmp.name)
        else:
            mmod = _load_module_from_source(mutated, f"amber_mut_{name}")
            still = _run_golden(mmod, target)
        assert not still, (
            f"MUTATION {name}: ESCAPED — {target} still passed. Real test gap: "
            f"add/repair a golden check that isolates this predicate.")
        caught += 1
        print(f"  mutation {name}: caught by {target}")

    print(f"mutations: {caught}/{len(MUTATIONS)} caught")
    print(f"\nAMBER TEST: {gpass} golden + {caught} mutations — ALL GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
