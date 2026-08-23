#!/usr/bin/env python3
"""excavate.py — The Excavation gift driver.

Reads `excavate.config` (+ optional `core-set.txt`), enumerates a site's pages,
and emits the three coverage-contract faces:

    corpus-manifest.json   the typed-node coverage ORACLE
    corpus-shards.json     budget-sized reading bundles (a pure fold of the manifest)
    reckoning.json         the reader's coverage protocol (a pure fold of the two above)

Hand those three to an AI with "read this corpus and prove you covered all of it,"
and reckoning.json tells it exactly how (see README, "What 'done' looks like").

  python3 excavate.py            build the three faces from ./excavate.config
  python3 excavate.py --check    honesty invariant: manifest nodes == site node set

──────────────────────────────────────────────────────────────────────────────
HONEST STATUS (read before relying on this on a non-loopmmt site)
──────────────────────────────────────────────────────────────────────────────
The generalized builders (build_corpus_manifest.py + its two pure-fold siblings)
carry a config object (`_CFG`) whose defaults reproduce loopmmt.com byte-identical
and whose knobs — base_url, site_name, wrapper_dir, coverage_rules, core_set —
are exactly what this driver injects from excavate.config / core-set.txt.

What is PROVEN: the config surface, the _branch generalization, and the
declared-core-set mechanism (a foreign run with no core-set.txt emits a loud note
and collapses to one tier rather than silently mis-sharding).

STANDALONE INDEPENDENCE — PROVEN (DP-039 s7 beat 5, the acceptance gate). The
in-tree builders (build_corpus_manifest + siblings) still import loopmmt's own
toolchain (build_machine_digest for the sitemap walk; redact + disclosure_gate for
the publish gates) — that path stays byte-identical on the home site. A stranger's
bare tree carries none of those, so this driver no longer dies on the missing
imports: it falls back to `excavate_standalone.py`, a self-contained builder that
does a local .html walk (replacing the sitemap walk), extracts title/desc/body with
stdlib re+html (replacing the digest helpers), and DROPS the two publish gates —
loopmmt.com publish controls keyed to loopmmt's private-signature set and
disclosure map, a safety a stranger's own served tree does not need and this gift
must not falsely assert. Earned the way the beat required: by running against a
REAL non-loopmmt fixture (test-fixture/) under smoke_test.sh and letting the
missing-import failure define the seam. See excavate_standalone.py + smoke_test.sh.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_NAME = "excavate.config"
CORE_SET_NAME = "core-set.txt"


def _die(msg, code=1):
    sys.stderr.write("excavate: " + msg + "\n")
    sys.exit(code)


def parse_config(path):
    """Parse the `key = value` config. Returns a dict with a `coverage_rules`
    list assembled from the repeated `rule = <substring> => <class>` lines."""
    if not os.path.isfile(path):
        _die("no %s found next to excavate.py — copy %s.example to %s and edit it."
             % (CONFIG_NAME, CONFIG_NAME, CONFIG_NAME))
    cfg = {"coverage_rules": []}
    with open(path, "r", encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                _die("malformed config line (no '='): %r" % raw.rstrip())
            key, _, val = line.partition("=")
            key, val = key.strip(), val.strip()
            if key == "rule":
                if "=>" not in val:
                    _die("malformed coverage rule (want 'substring => class'): %r" % val)
                sub, _, cls = val.partition("=>")
                sub, cls = sub.strip(), cls.strip()
                if cls not in ("deep", "standard", "optional"):
                    _die("coverage rule class must be deep|standard|optional, got %r" % cls)
                cfg["coverage_rules"].append((sub, cls))
            else:
                cfg[key] = val
    if not cfg.get("base_url"):
        _die("config is missing the required `base_url`.")
    cfg["base_url"] = cfg["base_url"].rstrip("/")
    return cfg


def read_core_set(path):
    """Read the declared reconnaissance set, one served filename per line.
    Returns None when absent (the builder then emits its loud single-tier note)."""
    if not os.path.isfile(path):
        return None
    names = []
    with open(path, "r", encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if line and not line.startswith("#"):
                names.append(line)
    return set(names) if names else None


def main():
    cfg = parse_config(os.path.join(HERE, CONFIG_NAME))
    core = read_core_set(os.path.join(HERE, CORE_SET_NAME))

    # Two builder paths, chosen by what the tree carries:
    #   * IN-TREE (loopmmt.com) — build_corpus_manifest.py + siblings are present;
    #     inject config into their _CFG and run them (byte-identical home output).
    #   * STANDALONE (a stranger's bare tree) — those builders are absent; run the
    #     self-contained excavate_standalone.py, which does a local walk with zero
    #     loopmmt deps. This is the fixture-proven acceptance beat (DP-039 s7 b5):
    #     the missing-import failure is no longer fatal — it routes to standalone.
    try:
        import build_corpus_manifest as manifest
    except ImportError:
        import excavate_standalone as standalone
        standalone.main()
        return

    manifest._CFG["base_url"] = cfg["base_url"]
    manifest._CFG["site_name"] = cfg.get("site_name", cfg["base_url"])
    manifest._CFG["wrapper_dir"] = cfg.get("wrapper_dir") or ""
    manifest._CFG["node_source"] = cfg.get("node_source", "local-walk")
    if cfg["coverage_rules"]:
        manifest._CFG["coverage_rules"] = cfg["coverage_rules"]
    if core is not None:
        manifest._CFG["core_set"] = core

    if "--check" in sys.argv:
        sys.argv = [a for a in sys.argv if a != "--check"] + ["--check"]
    manifest.main()


if __name__ == "__main__":
    main()
