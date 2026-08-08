// SPDX-License-Identifier: AGPL-3.0-or-later
//
// tree-cluster.js — the suggest-from-the-drawer core (Forest Phase 4, plan §3d / §3b.1 / §4).
//
// The warm path's engine: lightweight similarity over the Hollow's items so the
// drawer can answer "these k items share a shape — grow a tree for them?" Pure
// logic, no DOM and no runtime, so every piece is unit-tested
// (forest/app/build/test-tree-cluster.js) and reused by the front-end Hollow pen.
//
// Three jobs, each a pure function:
//
//   1. itemTokens   — filename/path-aware tokenizer over a soil item's label +
//                     source (the same name/path/prefix signals the categorize
//                     rule uses, plan §3d). Sibling of tree-author.js's tokenizer,
//                     tuned for short labels (strips file extensions) rather than
//                     prose trunk/branches.
//   2. clusterHollow — group Hollow items into clusters by SHARED DISTINCTIVE
//                     tokens. Connected components over a similarity graph; drops
//                     ubiquitous tokens (present in most items — they carry no
//                     clustering signal, e.g. "pdf" when everything is a pdf).
//                     A heuristic LOWER-BOUND signal: it misses semantic clusters
//                     and can over-suggest on shallow ones (plan §6). It is a
//                     PROMPT for the operator, never an auto-grow (V4 — Witness
//                     Ceiling).
//   3. suggestFields — derive a PRE-FILL ({name,id,trunk,grove,branches,pace,kind})
//                     for the New-tree form from a cluster's shared tokens. A
//                     suggestion the operator edits, not an authority — holding by
//                     default (zero friction), grove left for the operator to pick.
//
// This core SUGGESTS and CLUSTERS. It never writes golden/, never calls the
// runtime, and never emits an anatomy — that is tree-author.js's emitAnatomy,
// which the warm flow drives with these suggested fields (the loop closing, plan
// §3b.1). The drain (recategorizing the clustered items onto the new tree) is an
// owner-data write the operator triggers (§2 write-class split; V4 witness).

(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api; // node (tests)
  if (root) root.TreeCluster = api;                                          // browser (the pen)
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Stopwords + tuning. The stopword set mirrors tree-author.js's (one source of
  // intent, two tuned copies — the prose tokenizer and this label tokenizer are
  // deliberately separate concerns). Common file extensions are dropped too: a
  // shared extension is not a shared SHAPE.
  var STOPWORDS = {
    the: 1, a: 1, an: 1, and: 1, or: 1, of: 1, to: 1, for: 1, in: 1, on: 1, at: 1,
    is: 1, it: 1, that: 1, this: 1, with: 1, as: 1, by: 1, be: 1, are: 1,
    copy: 1, final: 1, draft: 1, new: 1, untitled: 1, document: 1, "": 1
  };
  var EXTENSIONS = {
    pdf: 1, doc: 1, docx: 1, txt: 1, md: 1, rtf: 1, odt: 1, pages: 1,
    xls: 1, xlsx: 1, csv: 1, tsv: 1, numbers: 1,
    ppt: 1, pptx: 1, key: 1,
    png: 1, jpg: 1, jpeg: 1, gif: 1, heic: 1, webp: 1, svg: 1,
    zip: 1, gz: 1, tar: 1, eml: 1, json: 1, html: 1, htm: 1
  };

  var DEFAULTS = {
    minShared: 2,      // two items link iff they share >= this many distinctive tokens
    minSize: 2,        // a cluster is >= this many items
    ubiquityFrac: 0.9, // large-drawer guard only (n>=8); small sets drop ALL-item tokens
    maxTokens: 6       // top-N shared tokens reported per cluster / used in a suggestion
  };

  // ---- helpers ----
  function isStr(v) { return typeof v === "string" && v.trim().length > 0; }
  function uniq(a) { var s = {}, out = []; for (var i = 0; i < a.length; i++) { if (!s[a[i]]) { s[a[i]] = 1; out.push(a[i]); } } return out; }

  function stripExt(name) {
    var s = String(name == null ? "" : name);
    var dot = s.lastIndexOf(".");
    if (dot > 0 && dot > s.length - 7) {            // a short trailing ".ext"
      var ext = s.slice(dot + 1).toLowerCase();
      if (EXTENSIONS[ext]) return s.slice(0, dot);
    }
    return s;
  }

  // The label a tokenizer reads for an item: its name (filename/title) when carried,
  // else its opaque source id; plus its source ("drive"/"gmail") which the ubiquity
  // filter will drop when every item shares it (plan §3d: name + path + prefix).
  function itemLabel(item) {
    item = item || {};
    var name = isStr(item.name) ? item.name.trim() : "";
    if (name) return name;
    var id = item.itemId == null ? "" : String(item.itemId);
    return id;
  }

  function itemTokens(item) {
    item = item || {};
    var text = stripExt(itemLabel(item)) + " " + String(item.source || "");
    return uniq(
      text.toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(function (t) { return t.length >= 3 && !STOPWORDS[t]; })
    );
  }

  // ---- 1. cluster the drawer ---------------------------------------------------
  // Returns { clusters: [{ items:[..], tokens:[..], size }], singletons:[..],
  // dropped:[..] }. clusters are connected components (>= minSize) of the graph
  // where two items are linked iff they share >= minShared DISTINCTIVE tokens.
  // "Distinctive" = not ubiquitous: a token present in > ubiquityFrac of the items
  // is dropped before linking (it cannot discriminate — the "everything is a pdf"
  // problem). Sorted largest cluster first.
  function clusterHollow(items, opts) {
    items = Array.isArray(items) ? items.slice() : [];
    opts = opts || {};
    var minShared = opts.minShared || DEFAULTS.minShared;
    var minSize = opts.minSize || DEFAULTS.minSize;
    var ubiquityFrac = opts.ubiquityFrac != null ? opts.ubiquityFrac : DEFAULTS.ubiquityFrac;
    var maxTokens = opts.maxTokens || DEFAULTS.maxTokens;

    var n = items.length;
    var empty = { clusters: [], singletons: items.slice(), dropped: [] };
    if (n < minSize) return empty;

    // token sets per item + document frequency
    var toks = items.map(itemTokens);
    var df = {};
    toks.forEach(function (ts) { ts.forEach(function (t) { df[t] = (df[t] || 0) + 1; }); });

    // drop ubiquitous tokens (no discriminating power). A token carries clustering
    // signal only when SOME items have it and SOME don't; a token in EVERY item
    // links everything and discriminates nothing (the "everything is a pdf"
    // problem). So drop df === n. For a LARGE drawer, also drop near-universal
    // tokens (>= ubiquityFrac); the high default makes that a no-op for small sets,
    // where a majority token (e.g. "tax" in 3 of 4) is exactly the cluster signal.
    var dropped = [];
    var keep = {};
    Object.keys(df).forEach(function (t) {
      var ubiquitous = (df[t] >= n) || (n >= 8 && df[t] / n >= ubiquityFrac);
      if (ubiquitous) dropped.push(t);
      else keep[t] = 1;
    });
    var distinctive = toks.map(function (ts) { return ts.filter(function (t) { return keep[t]; }); });

    // adjacency: link i~j iff they share >= minShared distinctive tokens
    var adj = [];
    for (var i = 0; i < n; i++) adj.push([]);
    for (i = 0; i < n; i++) {
      var si = {}; distinctive[i].forEach(function (t) { si[t] = 1; });
      for (var j = i + 1; j < n; j++) {
        var shared = 0;
        for (var k = 0; k < distinctive[j].length; k++) if (si[distinctive[j][k]]) shared++;
        if (shared >= minShared) { adj[i].push(j); adj[j].push(i); }
      }
    }

    // connected components
    var seen = new Array(n);
    var components = [];
    for (i = 0; i < n; i++) {
      if (seen[i]) continue;
      var stack = [i], comp = [];
      seen[i] = true;
      while (stack.length) {
        var v = stack.pop(); comp.push(v);
        for (k = 0; k < adj[v].length; k++) { var w = adj[v][k]; if (!seen[w]) { seen[w] = true; stack.push(w); } }
      }
      components.push(comp);
    }

    var clusters = [];
    var singletons = [];
    components.forEach(function (comp) {
      if (comp.length < minSize) { comp.forEach(function (idx) { singletons.push(items[idx]); }); return; }
      // the cluster's shared tokens, ranked by in-cluster frequency (then alpha for stability)
      var freq = {};
      comp.forEach(function (idx) { distinctive[idx].forEach(function (t) { freq[t] = (freq[t] || 0) + 1; }); });
      var ranked = Object.keys(freq)
        .filter(function (t) { return freq[t] >= 2; })           // shared by >= 2 of the cluster
        .sort(function (a, b) { return freq[b] - freq[a] || (a < b ? -1 : 1); })
        .slice(0, maxTokens);
      clusters.push({
        items: comp.map(function (idx) { return items[idx]; }),
        tokens: ranked,
        size: comp.length
      });
    });
    clusters.sort(function (a, b) { return b.size - a.size || (a.tokens[0] < b.tokens[0] ? -1 : 1); });

    return { clusters: clusters, singletons: singletons, dropped: dropped };
  }

  // ---- 2. titleize a token run (for the suggested name) ------------------------
  function titleize(s) {
    return String(s || "").split(/[\s_-]+/).filter(Boolean)
      .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ");
  }
  function slugify(name) {
    return String(name == null ? "" : name).toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  // ---- 3. the suggested pre-fill ----------------------------------------------
  // Derive a New-tree form pre-fill from a cluster. A SUGGESTION the operator edits
  // (V4 witness): holding by default (zero friction), pace slow (residual-ish),
  // grove LEFT BLANK for the operator to pick from the datalist (a wrong grove
  // guess is worse than none). Name + trunk + branches come from the shared tokens.
  function suggestFields(cluster) {
    cluster = cluster || {};
    var toks = Array.isArray(cluster.tokens) ? cluster.tokens.filter(isStr) : [];
    var size = cluster.size || (Array.isArray(cluster.items) ? cluster.items.length : 0);

    var head = toks.slice(0, 2);
    var name = head.length ? titleize(head.join(" ")) : "New Tree";
    var trunk = toks.length
      ? ("keep the " + toks.slice(0, 3).join(" / ") + " items together \u2014 grown from the Hollow")
      : ("a home for " + size + " related items grown from the Hollow");
    // branches: the distinctive shared tokens describe what the tree holds; ensure >= 1.
    var branches = toks.slice(0, 4);
    if (!branches.length) branches = ["items grown from a Hollow cluster"];

    return {
      name: name,
      id: slugify(name),
      trunk: trunk,
      grove: "",            // operator picks (datalist-guided)
      branches: branches,
      pace: ["slow"],       // residual-ish default; matches the Hollow's pace
      kind: "holding"       // zero-friction default; structured is enrich-later
    };
  }

  return {
    STOPWORDS: STOPWORDS,
    EXTENSIONS: EXTENSIONS,
    DEFAULTS: DEFAULTS,
    itemLabel: itemLabel,
    itemTokens: itemTokens,
    clusterHollow: clusterHollow,
    suggestFields: suggestFields,
    _titleize: titleize,
    _slugify: slugify,
    _stripExt: stripExt
  };
});
