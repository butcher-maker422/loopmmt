# amber

**Seal a set of files into a content-addressed snapshot you can prove unaltered.**

Amber is tree resin that hardened around an insect and held it, unchanged, for
forty million years — you can still read the wing. `amber` is that for a set of
files: it seals a *moment* — the exact bytes of the paths you name — into a small
JSON capsule whose fixity *is* the content. Any later change to any sealed file,
or to the capsule itself, breaks the seal loudly. Nothing is silently altered.

## What it is (and is not)

It is a **fixity manifest**, not an archive. It does **not** copy your files or
store their bytes — it pins each file's content hash (a git-style blob SHA:
`sha1("blob <len>\0" + bytes)`, the same address git itself would give the file).
The capsule stays tiny — a list of `{path, sha, bytes}` plus one seal hash over
the whole manifest — no matter how large the sealed files are. To prove a file
unchanged later, `amber verify` re-hashes it and compares.

If you also want the *bytes* preserved, keep the files in git or zip them
separately — amber proves **identity**, git/zip preserve **bytes**. Amber is the
cheap, portable proof-of-no-change that rides alongside.

## The seal — why a change anywhere is caught

The manifest carries a `seal_sha256`: sha256 over the canonical manifest with the
seal field blanked. It covers every pinned file's SHA transitively, so:

- change a sealed file's bytes → its blob SHA changes → verify **FAILs**
- edit the manifest (add/drop/reorder a file, fudge a size) → seal **FAILs**
- blank or forge the seal itself → recomputed seal ≠ stored → **FAILs**

There is no edit that leaves a valid seal. And the two checks are independent: an
attacker who lies about a member's SHA *and* recomputes the seal to match still
fails, because the live file no longer matches the lie. `verify` names the broken
member and exits non-zero — never a silent pass over a tampered capsule.

## Usage

```
amber seal --id my-snapshot --out capsule.json a.txt b/c.txt docs/
    Pin every named file (a directory is walked; every file under it pinned)
    into capsule.json, relative to --root (default: current directory).
    Refuses to overwrite an existing capsule (append-only).

amber verify --capsule capsule.json
    Re-hash every pinned file against --root and recompute the seal.
    PASS (exit 0) iff nothing changed; FAIL (exit 1) naming each broken member.

amber show --capsule capsule.json
    Print a summary: id, seal date, member count, total bytes, seal.

amber --port       # print amber's own port-verb (fold)
amber --selftest   # run built-in checks
```

## Doctrine (binding)

1. **Append-only.** A sealed capsule is never edited. Re-sealing a moment makes a
   *new* capsule with its own seal-date. The series of capsules is the record.
   `seal` refuses to overwrite an existing capsule.
2. **Fixity is the content.** Amber pins content hashes, not copies — a
   specimen's address *is* its content, so the capsule can never drift from what
   it claims.
3. **Byte, never token.** Sizes in bytes; hashes over bytes.
4. **The seal is loud.** `verify` exits non-zero and names the broken member.

## What composes with it

`amber`'s port-verb is `fold`: many files in, one sealed aggregate (the capsule)
out. It's part of the **compose set** — small standalone tools that snap together
because they agree on one JSON-lines-friendly format, not because they share code
(`port` labels a tool, `map` shows what chains, `typecheck` checks a chain,
`declare` writes a chain down, `conductor` runs a chain, `amber` seals a moment).

## What this is a strip of

An internal total-snapshot engine sealed a moment of a byte-truth store — a
payload, a faceted context selected by document front-matter, a panel of frozen
reports, and a fidelity reading — pinning git blob SHAs under a canonical seal
hash. This gift keeps the load-bearing atom (pin content hashes, never duplicate,
under one canonical seal hash, with loud verify) and drops the host-specific
machinery (the front-matter facet query, the report panel, the fidelity reading,
the hardcoded repo root). What remains is a plain, portable content-fixity sealer
over any set of files. Net-new stdlib-only Python; nothing lifted; re-licensed
**MIT**.

## Tests

```
python3 test_amber.py     # 13 golden + 10 mutations, all caught
python3 amber.py --selftest
```

## License

MIT — see `LICENSE`. Use it for anything.
