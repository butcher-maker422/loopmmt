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

What is NOT YET PROVEN, and is the next build beat by design: the manifest builder
currently imports loopmmt's own toolchain (build_machine_digest for the single
sitemap walk; redact + disclosure_gate for its publish gates). A stranger's tree
does not carry those. Full standalone independence — swapping the loopmmt walk for
a self-contained local-walk enumerator and dropping the disclosure gate the
stranger has no map for — is the acceptance beat: it is earned by running against a
REAL foreign fixture and letting what breaks define the last of the config surface,
never by asserting it here. Until that beat lands, this driver runs correctly in a
tree that carries the builders and their helpers; pointed at a bare stranger tree
it will fail loudly on the missing imports — which is the honest failure that the
fixture beat converts into the final extraction. Do not paper over that gap; it is
the seam the acceptance test is written against.
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

    # Inject config into the generalized builder's _CFG before it builds. The
    # builder lives in the site's build tree; a standalone extraction of the
    # local-walk enumerator is the acceptance beat (see the HONEST STATUS header).
    try:
        import build_corpus_manifest as manifest
    except ImportError as exc:
        _die("cannot import the excavation builders (%s).\n"
             "  This driver runs inside a tree that carries build_corpus_manifest.py\n"
             "  and its siblings. Standalone-on-a-bare-tree is the fixture-proven\n"
             "  acceptance beat, not yet landed — see the HONEST STATUS header." % exc, code=2)

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
