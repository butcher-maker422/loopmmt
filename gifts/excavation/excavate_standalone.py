#!/usr/bin/env python3
"""excavate_standalone.py — the self-contained Excavation builder.

This is the STRANGER-SIDE builder: it emits the three excavation faces
(corpus-manifest.json, corpus-shards.json, reckoning.json) for a foreign site
with ZERO loopmmt.com dependencies. It carries no import of build_machine_digest,
redact, or disclosure_gate — a bare tree has none of those, and this module is
what the acceptance beat (DP-039 s7 beat 5) extracts so the gift runs anywhere.

WHAT IT REPRODUCES (and how it differs from the in-tree builders):
  * NODE SOURCE — a self-contained recursive local walk of `site_dir` (every
    *.html leaf), NOT digest.sitemap_pages(). Redirect stubs (meta-refresh) are
    skipped, matching the in-tree walk's exclusion.
  * TEXT / META — local _meta() and _page_text() equivalents, stdlib re+html
    only (byte-identical logic to the digest helpers).
  * PUBLISH GATES — DROPPED. redact.scan_text and disclosure_gate.require_publish
    are loopmmt.com publish controls keyed to loopmmt's private-signature set and
    disclosure map. A stranger's tree has neither, and the gift never asserts a
    safety it cannot honestly run: the stranger's own tree is their published
    surface by construction (they point it at their served files). The HONEST
    STATUS in excavate.py names this as the correct foreign behaviour.

DETERMINISM: stdlib only, offline, no wall-clock field. A re-run over an
unchanged tree is byte-identical (folds-twice-identical) — the same property the
staleness lints rely on. lastmod is OMITTED in standalone mode (a stranger's git
history is not this gift's to assume; the in-tree builder reads it from loopmmt's
own repo). Its absence is honest, not a gap.

USAGE (driven by excavate.py; runnable directly for the smoke test):
    python3 excavate_standalone.py             build the three faces
    python3 excavate_standalone.py --check      honesty invariant: manifest == walk
Config is read from excavate.config next to this file (same parser the driver
uses); site_dir names the local served tree.
"""
import hashlib
import html
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_NAME = "excavate.config"
CORE_SET_NAME = "core-set.txt"

# Shard budget — the ~40K-token reading-bundle size the in-tree builder uses.
SHARD_TOKEN_BUDGET = 40000


# ── config (same shape excavate.py parses) ──────────────────────────────────
def _die(msg, code=1):
    sys.stderr.write("excavate-standalone: " + msg + "\n")
    sys.exit(code)


def parse_config(path):
    if not os.path.isfile(path):
        _die("no %s found next to this builder — copy %s.example and edit it."
             % (CONFIG_NAME, CONFIG_NAME))
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
    cfg.setdefault("site_name", cfg["base_url"])
    cfg.setdefault("site_dir", "./site")
    cfg.setdefault("wrapper_dir", "")
    return cfg


def load_core_set(config_dir=HERE):
    path = os.path.join(config_dir, CORE_SET_NAME)
    if not os.path.isfile(path):
        return None
    out = set()
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.split("#", 1)[0].strip()
            if line:
                out.add(line)
    return out or None


# ── local HTML helpers (stdlib-only equivalents of the digest helpers) ──────
def _meta(path):
    """(title, description) from a page's <head>. Same logic as digest._meta,
    dropping og:url/canonical (a standalone node's url is derived from its path,
    not read from the page)."""
    try:
        with open(path, encoding="utf-8") as fh:
            h = fh.read()
    except OSError:
        return "", ""

    def grab(pat):
        m = re.search(pat, h, re.S)
        return html.unescape(m.group(1).strip()) if m else ""
    return grab(r"<title>(.*?)</title>"), grab(r'<meta name="description" content="(.*?)"')


def _is_redirect_stub(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return re.search(r'<meta\s+http-equiv=["\']refresh["\']', fh.read(), re.I) is not None
    except OSError:
        return False


def _page_text(path):
    """Plain body text — byte-identical logic to digest._page_text (no DRAFT
    sentinel branch: a stranger has no loopmmt draft convention)."""
    try:
        with open(path, encoding="utf-8") as fh:
            h = fh.read()
    except OSError:
        return "(source unavailable)"
    h = re.sub(r"(?is)<head\b.*?</head>", " ", h)
    h = re.sub(r"(?is)<script\b.*?</script>", " ", h)
    h = re.sub(r"(?is)<style\b.*?</style>", " ", h)
    h = re.sub(r"(?is)<svg\b.*?</svg>", " ", h)
    m = re.search(r"(?is)<main\b[^>]*>(.*?)</main>", h)
    if m:
        h = m.group(1)
    h = re.sub(r"(?is)<(p|div|section|article|li|h[1-6]|tr|br)\b[^>]*>", "\n", h)
    h = re.sub(r"(?is)<[^>]+>", " ", h)
    h = html.unescape(h)
    h = re.sub(r"[ \t]+", " ", h)
    lines = [ln.strip() for ln in h.splitlines()]
    out, blank = [], False
    for ln in lines:
        if ln:
            out.append(ln)
            blank = False
        elif not blank:
            out.append("")
            blank = True
    return "\n".join(out).strip()


# ── the local walk (the node source — replaces digest.sitemap_pages) ────────
def _site_dir(cfg):
    sd = cfg["site_dir"]
    return sd if os.path.isabs(sd) else os.path.normpath(os.path.join(HERE, sd))


def _served_rel(cfg, disk_path):
    """The served path for a local file, relative to site_dir, forward-slashed.
    A wrapper_dir (if the served tree sits under a non-URL wrapper) is peeled."""
    rel = os.path.relpath(disk_path, _site_dir(cfg)).replace(os.sep, "/")
    wd = cfg.get("wrapper_dir")
    if wd and rel.startswith(wd + "/"):
        rel = rel[len(wd) + 1:]
    return rel


def walk_nodes(cfg):
    """Every served *.html leaf under site_dir, as {url, served_rel, disk},
    sorted for determinism. Redirect stubs are skipped (routing, not content)."""
    base = cfg["base_url"]
    root = _site_dir(cfg)
    if not os.path.isdir(root):
        _die("site_dir %r does not exist (config: site_dir = %s)" % (root, cfg["site_dir"]), code=2)
    found = []
    for dirpath, _dirs, files in os.walk(root):
        for fn in files:
            if not fn.endswith(".html"):
                continue
            disk = os.path.join(dirpath, fn)
            if _is_redirect_stub(disk):
                continue
            served = _served_rel(cfg, disk)
            url = base + "/" + served
            found.append({"url": url, "served_rel": served, "disk": disk})
    found.sort(key=lambda n: n["served_rel"])
    return found


# ── coverage typing (config-driven; same rules as the in-tree builder) ──────
def _branch(served_rel):
    if served_rel in ("", "index.html"):
        return "root"
    parts = [p for p in served_rel.split("/") if p]
    if not parts:
        return "root"
    if len(parts) == 1:
        return parts[0] if served_rel.endswith("/") else "root"
    return parts[0]


def _coverage_type(cfg, served_rel, core_set, single_tier):
    if single_tier:
        return "standard"
    fname = os.path.basename(served_rel)
    if served_rel in ("", "index.html") or fname in core_set:
        return "core"
    # Rule substrings match against a slash-bracketed served path so a rule
    # written the natural way — `/docs/ => deep` — hits both a root-served
    # `docs/guide.html` (a stranger's tree) AND a wrapped `site/docs/x.html`
    # (loopmmt's). Bracketing with leading+trailing '/' makes "/docs/" a segment
    # match regardless of whether the segment is at path start. (Fixture-proven:
    # without this, root-level dir rules silently never fired — beat 5.)
    bracketed = "/" + served_rel
    for needle, cls in cfg.get("coverage_rules", []):
        if needle in bracketed:
            return cls
    return "standard"


def _hash_and_tokens(disk_path):
    try:
        with open(disk_path, "rb") as fh:
            raw = fh.read()
    except OSError:
        return None, None, None
    return hashlib.sha256(raw).hexdigest()[:12], len(raw.split()), round(len(raw) / 4)


# ── face 1: the manifest ────────────────────────────────────────────────────
def build_manifest(cfg):
    core_set = load_core_set()
    single_tier = not core_set
    if single_tier:
        print("NOTE — no `core` reconnaissance set declared (no core-set.txt): "
              "every page is one tier. Declare a core-set.txt for a real "
              "recon/full cycle.", file=sys.stderr)
    nodes, counts, branches = [], {"core": 0, "standard": 0, "deep": 0, "optional": 0}, {}
    for entry in walk_nodes(cfg):
        served_rel, disk = entry["served_rel"], entry["disk"]
        title, desc = _meta(disk)
        ctype = _coverage_type(cfg, served_rel, core_set or set(), single_tier)
        branch = _branch(served_rel)
        h, words, tokens = _hash_and_tokens(disk)
        node = {"url": entry["url"], "title": title, "description": desc,
                "branch": branch, "coverage": ctype, "hash": h,
                "words": words, "tokens": tokens}
        nodes.append(node)
        counts[ctype] = counts.get(ctype, 0) + 1
        branches[branch] = branches.get(branch, 0) + 1
    total_tokens = sum(n["tokens"] for n in nodes if n["tokens"])
    doc = {
        "site": cfg["site_name"],
        "url": cfg["base_url"] + "/",
        "manifest_version": 1,
        "description": (
            f"The complete public coverage boundary of {cfg['site_name']}: one "
            "node per served public leaf, typed by coverage class. The reader's "
            "coverage oracle for a full excavation (see The Reckoning). A pure "
            "fold over the local served tree; nodes[].url is independently "
            "checkable against the served files."),
        "coverage_note": (
            "core = read for a Reconnaissance pass; standard = mid-tier content, "
            "read in full excavation; deep = evidentiary leaves, full excavation "
            "only; optional = supporting tools / docs. A complete excavation "
            "reads every core+standard+deep node, or declares each skipped node "
            "optional/inaccessible by name."),
        "counts": {
            "nodes": len(nodes),
            "by_coverage": counts,
            "by_branch": dict(sorted(branches.items())),
            "total_tokens_estimate": total_tokens,
        },
        "nodes": nodes,
    }
    return doc


# ── face 2: the shards (pure partition of the manifest node set) ────────────
def build_shards(cfg, manifest):
    base = cfg["base_url"]
    nodes = manifest["nodes"]
    shards, cur, cur_tokens, cur_branch = [], [], 0, None

    def flush():
        nonlocal cur, cur_tokens, cur_branch
        if cur:
            shards.append({"branch": cur_branch, "nodes": cur,
                           "tokens_estimate": cur_tokens})
            cur, cur_tokens, cur_branch = [], 0, None

    for n in nodes:
        tok = n.get("tokens") or 0
        if cur_branch is not None and (n["branch"] != cur_branch
                                       or cur_tokens + tok > SHARD_TOKEN_BUDGET):
            flush()
        cur_branch = n["branch"]
        cur.append(n["url"])
        cur_tokens += tok
    flush()

    index = {
        "site": cfg["site_name"],
        "url": f"{base}/corpus-shards.json",
        "description": (
            "The corpus partitioned into bounded reading bundles. The "
            "authoritative tree is corpus-manifest.json; each shard names a "
            "budget-sized set of node urls to read together."),
        "shard_token_budget": SHARD_TOKEN_BUDGET,
        "manifest_url": f"{base}/corpus-manifest.json",
        "counts": {"shards": len(shards),
                   "nodes": sum(len(s["nodes"]) for s in shards)},
        "shards": [
            {"id": f"shard-{i:02d}", "branch": s["branch"],
             "tokens_estimate": s["tokens_estimate"], "nodes": s["nodes"]}
            for i, s in enumerate(shards)
        ],
    }
    return index


# ── face 3: the reckoning (pure fold of manifest + shards) ──────────────────
def build_reckoning(cfg, manifest, shards):
    base = cfg["base_url"]
    c = manifest["counts"]
    doc = {
        "site": cfg["site_name"],
        "url": f"{base}/reckoning.json",
        "description": (
            f"The reader's coverage protocol for {cfg['site_name']}. A pure fold "
            "over corpus-manifest.json (the node oracle) and corpus-shards.json "
            "(the corpus in bounded bundles)."),
        "sources": {
            "manifest_url": f"{base}/corpus-manifest.json",
            "shards_url": f"{base}/corpus-shards.json",
        },
        "totals": {
            "nodes": c["nodes"],
            "by_coverage": c["by_coverage"],
            "shards": shards["counts"]["shards"],
            "total_tokens_estimate": c["total_tokens_estimate"],
        },
        "protocol": [
            {"pass": "reconnaissance",
             "how": ("fetch corpus-manifest.json, take the nodes with "
                     "coverage=='core', and read those first to understand the "
                     "whole site before the full pass.")},
            {"pass": "full-excavation",
             "how": ("iterate corpus-shards.json; fetch each shard's node urls "
                     "and read them, covering every core+standard+deep node.")},
            {"pass": "account",
             "how": ("a complete excavation reads every core+standard+deep node, "
                     "or declares each skipped node optional/inaccessible by "
                     "name. 'Everything' means every node examined or explicitly "
                     "accounted for.")},
            {"pass": "resume",
             "how": ("re-fetch corpus-manifest.json and compare its node set + "
                     "hashes against your last read to find what changed.")},
        ],
    }
    return doc


# ── driver ──────────────────────────────────────────────────────────────────
def _out_dir(cfg):
    # Foreign faces are written next to the config, under ./corpus-out/, so a
    # stranger's run never assumes a loopmmt site-root/ layout.
    d = os.path.join(HERE, "corpus-out")
    return d


def check(cfg):
    """Honesty invariant: the manifest's node-url set == a fresh local walk's
    url set. What a visiting AI runs to trust the manifest without trusting us."""
    manifest = build_manifest(cfg)
    manifest_urls = {n["url"] for n in manifest["nodes"]}
    walk_urls = {n["url"] for n in walk_nodes(cfg)}
    if manifest_urls == walk_urls:
        return True, f"CLEAN — manifest nodes == local walk ({len(manifest_urls)} urls)"
    missing = walk_urls - manifest_urls
    extra = manifest_urls - walk_urls
    return False, (f"DRIFT — manifest != walk. missing={sorted(missing)[:5]} "
                   f"extra={sorted(extra)[:5]}")


def main():
    cfg = parse_config(os.path.join(HERE, CONFIG_NAME))
    if "--check" in sys.argv:
        ok, msg = check(cfg)
        print(msg)
        sys.exit(0 if ok else 3)

    manifest = build_manifest(cfg)
    shards = build_shards(cfg, manifest)
    reckoning = build_reckoning(cfg, manifest, shards)

    out = _out_dir(cfg)
    os.makedirs(out, exist_ok=True)
    faces = {
        "corpus-manifest.json": manifest,
        "corpus-shards.json": shards,
        "reckoning.json": reckoning,
    }
    for name, doc in faces.items():
        body = json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
        with open(os.path.join(out, name), "w", encoding="utf-8") as fh:
            fh.write(body)
    cc = manifest["counts"]
    print(f"wrote corpus-out/{{corpus-manifest,corpus-shards,reckoning}}.json — "
          f"standalone (no loopmmt deps)")
    print(f"grounded: {cc['nodes']} nodes · by_coverage={cc['by_coverage']} · "
          f"{shards['counts']['shards']} shard(s) · "
          f"~{cc['total_tokens_estimate']} tokens total")


if __name__ == "__main__":
    main()
