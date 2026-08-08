// SPDX-License-Identifier: AGPL-3.0-or-later
//
// tree-author.js — the propose-from-scratch core (Forest Phase 3, plan §3b.2 / §4).
//
// Pure logic, no DOM and no runtime. Three jobs, each a pure function so they can
// be unit-tested (forest/app/build/test-tree-author.js) and reused by the front-end
// "New tree…" form:
//
//   1. validateFields  — is the operator's input a well-formed tree spec?
//   2. priorArt        — the Prior-Art Gate's VIEW TEST: does the proposed
//                        trunk/branches dissolve to a tree we already have?
//   3. emitAnatomy     — produce the anatomy JSON, GUARANTEED to pass
//                        golden/kit/anatomy-check.js (the test proves it by
//                        running the emitted object through the real checker).
//
// §5.1 = A (deploy-time emit): this core EMITS an anatomy object. It never writes
// golden/ and never calls the runtime. The form hands the operator the JSON to
// review and commit at golden/kit/trees/<id>.anatomy.json. The kit stays a
// source-controlled craft act (Craft-then-Ship).
//
// Scope (§3b.2, deliberately bounded): the cold path authors a HOLDING tree
// (no seam — weight nice-to-have, the corrected-Hollow shape) or a STRUCTURED tree
// (a Feed seam — publishes + to). It does NOT author a Gate (A3 is the operator-
// authority safety class; a Gate is added later as a deliberate edit, never
// machine-emitted) or an Edge (federation contract — a separate, rarer case). A
// new tree works held-only with none of them (plan §4).

(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api; // node (tests)
  if (root) root.TreeAuthor = api;                                           // browser (the form)
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // The typed vocabularies — MUST match golden/kit/anatomy-contract.md (A2). If the
  // contract grows a term, mirror it here (the tests pin the contract's values).
  var PACE_VOCAB = ["fast", "slow", "geological", "continuous", "event-driven", "seasonal"];
  var WEIGHT_VOCAB = ["load-bearing", "nice-to-have"];

  // A tree id: lowercase kebab — what build_forest_*.py globs and the canopy keys on.
  var ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  // ---- helpers ----
  function isNonEmptyString(v) { return typeof v === "string" && v.trim().length > 0; }
  function uniq(a) { var s = {}, out = []; for (var i = 0; i < a.length; i++) { if (!s[a[i]]) { s[a[i]] = 1; out.push(a[i]); } } return out; }

  // Derive a kebab id from a free-text name. Idempotent on an already-clean id.
  function slugify(name) {
    return String(name == null ? "" : name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")   // any run of non-alphanumerics -> one hyphen
      .replace(/^-+|-+$/g, "");       // trim leading/trailing hyphens
  }

  // ---- 1. field validation ----------------------------------------------------
  // Returns { ok, errors: [..] }. errors is empty iff ok. existingIds is the live
  // tree-id set (lowercase) so a duplicate id is caught here too (belt with the
  // prior-art braces). kind is "holding" | "structured".
  function validateFields(fields, existingIds) {
    fields = fields || {};
    existingIds = existingIds || [];
    var errors = [];

    var id = isNonEmptyString(fields.id) ? fields.id.trim() : "";
    if (!id) errors.push("An id is required (e.g. \u201cwoodshed\u201d).");
    else if (!ID_RE.test(id)) errors.push("Id must be lowercase letters, numbers, and single hyphens (got \u201c" + id + "\u201d).");
    else if (existingIds.indexOf(id) !== -1) errors.push("A tree with id \u201c" + id + "\u201d already exists.");

    if (!isNonEmptyString(fields.trunk)) errors.push("A trunk (one-line purpose) is required.");
    if (!isNonEmptyString(fields.grove)) errors.push("A grove is required.");

    var branches = Array.isArray(fields.branches)
      ? fields.branches.filter(isNonEmptyString)
      : [];
    if (!branches.length) errors.push("At least one branch is required.");

    var pace = Array.isArray(fields.pace) ? fields.pace : [];
    if (!pace.length) errors.push("Pick at least one pace.");
    var badPace = pace.filter(function (p) { return PACE_VOCAB.indexOf(p) === -1; });
    if (badPace.length) errors.push("Pace must be one of " + JSON.stringify(PACE_VOCAB) + " (got " + JSON.stringify(badPace) + ").");

    var kind = fields.kind === "structured" ? "structured" : (fields.kind === "holding" ? "holding" : "");
    if (!kind) errors.push("Choose a kind: holding or structured.");

    // weight: holding is forced to nice-to-have (a residual node carries no load);
    // structured may pick a weight (default load-bearing). An explicit out-of-vocab
    // weight is an error.
    if (fields.weight !== undefined && WEIGHT_VOCAB.indexOf(fields.weight) === -1)
      errors.push("Weight must be one of " + JSON.stringify(WEIGHT_VOCAB) + ".");

    if (kind === "structured") {
      var publishes = fields.publishes;
      var hasFields = publishes && typeof publishes === "object" && !Array.isArray(publishes) &&
        Object.keys(publishes).length > 0 &&
        Object.keys(publishes).every(function (k) { return isNonEmptyString(k) && isNonEmptyString(publishes[k]); });
      if (!hasFields) errors.push("A structured tree must publish at least one field (name \u2192 type).");
      if (!isNonEmptyString(fields.feedTo)) errors.push("A structured tree must name the horizontal it feeds (\u201cto\u201d).");
    }

    return { ok: errors.length === 0, errors: errors };
  }

  // ---- 2. the Prior-Art Gate (the View Test) ----------------------------------
  // "Does the proposed trunk/branches dissolve to a tree we already have?" Token
  // overlap (Jaccard) over the proposed trunk+branches vs each existing tree's
  // trunk+branches (the canopy state carries both). Above THRESHOLD => near-dup,
  // surfaced as prior art (never a hard block — the operator can grow it anyway).
  // Also flags an exact id collision.
  var STOPWORDS = {
    the: 1, a: 1, an: 1, and: 1, or: 1, of: 1, to: 1, for: 1, in: 1, on: 1, at: 1,
    is: 1, it: 1, that: 1, this: 1, with: 1, as: 1, by: 1, be: 1, are: 1, "": 1
  };
  var PRIOR_ART_THRESHOLD = 0.34; // tuned: catches real overlap, tolerant of short specs

  function tokens(text) {
    return uniq(
      String(text || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(function (t) { return t.length >= 3 && !STOPWORDS[t]; })
    );
  }

  function treeText(t) {
    return [t.trunk || ""].concat(Array.isArray(t.branches) ? t.branches : []).join(" ");
  }

  function jaccard(a, b) {
    if (!a.length && !b.length) return 0;
    var set = {}, i, inter = 0;
    for (i = 0; i < a.length; i++) set[a[i]] = 1;
    var seen = {};
    for (i = 0; i < b.length; i++) { if (set[b[i]] && !seen[b[i]]) { inter++; seen[b[i]] = 1; } }
    var union = a.length + b.length - inter;
    return union === 0 ? 0 : inter / union;
  }

  function priorArt(proposed, existingTrees) {
    proposed = proposed || {};
    existingTrees = Array.isArray(existingTrees) ? existingTrees : [];
    var pid = proposed.id ? slugify(proposed.id) : "";
    var ptoks = tokens(treeText(proposed));

    var idCollision = !!pid && existingTrees.some(function (t) { return slugify(t.tree || "") === pid; });

    var matches = existingTrees
      .map(function (t) { return { tree: t.tree, score: Math.round(jaccard(ptoks, tokens(treeText(t))) * 100) / 100 }; })
      .filter(function (m) { return m.score >= PRIOR_ART_THRESHOLD; })
      .sort(function (a, b) { return b.score - a.score; });

    return {
      verdict: matches.length ? "near-dup" : "clear",
      idCollision: idCollision,
      matches: matches,
      threshold: PRIOR_ART_THRESHOLD
    };
  }

  // ---- 3. the emit ------------------------------------------------------------
  // Produce the anatomy object. Guaranteed-valid by construction: A1 (four parts),
  // A2 (typed pace + weight), and — for a structured tree — A5 (feed states its
  // postcondition). A holding tree carries no seam (config C1 default, legal). The
  // test runs the emitted object through golden/kit/anatomy-check.js to PROVE it.
  function emitAnatomy(fields) {
    fields = fields || {};
    var kind = fields.kind === "structured" ? "structured" : "holding";
    var weight = WEIGHT_VOCAB.indexOf(fields.weight) !== -1
      ? fields.weight
      : (kind === "holding" ? "nice-to-have" : "load-bearing");

    var anatomy = {
      tree: slugify(fields.id),
      grove: String(fields.grove || "").trim(),
      trunk: String(fields.trunk || "").trim(),
      branches: (Array.isArray(fields.branches) ? fields.branches : [])
        .map(function (b) { return String(b).trim(); })
        .filter(function (b) { return b.length; }),
      pace: (Array.isArray(fields.pace) ? fields.pace : []).slice(),
      weight: kind === "holding" ? "nice-to-have" : weight
    };

    if (kind === "structured") {
      anatomy.seams = { feed: { publishes: {}, to: String(fields.feedTo || "").trim() } };
      var pub = fields.publishes || {};
      Object.keys(pub).forEach(function (k) {
        if (isNonEmptyString(k) && isNonEmptyString(pub[k])) anatomy.seams.feed.publishes[String(k).trim()] = String(pub[k]).trim();
      });
    }
    return anatomy;
  }

  // Pretty JSON the operator commits (matches the kit's 2-space, ASCII-escaped style).
  function emitJSON(fields) {
    return JSON.stringify(emitAnatomy(fields), null, 2)
      .replace(/[\u0080-\uffff]/g, function (c) { return "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4); });
  }

  return {
    PACE_VOCAB: PACE_VOCAB,
    WEIGHT_VOCAB: WEIGHT_VOCAB,
    ID_RE: ID_RE,
    PRIOR_ART_THRESHOLD: PRIOR_ART_THRESHOLD,
    slugify: slugify,
    validateFields: validateFields,
    priorArt: priorArt,
    emitAnatomy: emitAnatomy,
    emitJSON: emitJSON,
    _tokens: tokens,
    _jaccard: jaccard
  };
});
