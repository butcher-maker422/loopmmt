/* loopmmt.com — the SITE adapter over the shared FEDERATION CORE · loop-search slot 02.

   ─────────────────────────────────────────────────────────────────────────────
   ONE CORE, N MOUNTS. This is the loopmmt.com mount's adapter over
   shell/federation-core.js — the sibling of the Forest's search-federation.js.
   The Forest declares its stores INCOMMENSURABLE (mode:"grouped"). The site has
   ONE store — the served static search index (search-index.json) — so its rank is
   trivially commensurable: mode:"ranked", one honest scale over one store.
   ─────────────────────────────────────────────────────────────────────────────

   THE EARNED SCORE (score-honesty invariant v1 — doc 36). The core ranks by
   rankKey = item.score. That score is NOT a folded static column (the index
   carries none — invariant 36 §4 forbids it). It is computed HERE, at query time,
   by `scoreNode(query, node)` — a pure relevance function of

       (query  x  the shared CONTENT fields: title, description, body)

   and NOTHING else. It never reads `url`, `branch`, or arrival position (identity),
   and it applies NO fixed per-branch / per-coverage privilege. Therefore it is
   IDENTITY-INDEPENDENT by construction (invariant 36 §2a): two nodes with identical
   content score identically, whatever their identity. That permutation-invariance
   is the decidable honesty bite the test lands; a mutation that adds a branch or
   coverage bonus turns it RED. The undecidable half — is the "one store" claim's
   commensurability meaningful — is trivially true here (a single store is
   commensurable with itself), so the §2 ceiling is not even engaged at this mount.

   Field weights (W_TITLE > W_DESC > W_BODY) are a CONTENT structure every node
   shares — a title hit is more relevant than a body hit for ANY node — not a
   per-node privilege, so they preserve identity-independence. Body per-term hits
   are capped so a long page cannot win on length alone.

   Coverage is a DISPLAY dimension (slot 03 groups by it), never a scoring input —
   so no per-coverage privilege can enter here.

   Deterministic: a pure function of (query, content). No wall-clock, no random, no
   network — same inputs, same score, byte-reproducible. stdlib JS only.

   Plain script (no ES module): attaches to window.LoopSearch.corpusSearch AND
   sets module.exports for node/tests. */
(function () {
  "use strict";

  var W_TITLE = 8;
  var W_DESC = 4;
  var W_BODY = 1;
  var BODY_CAP_PER_TERM = 6;   // a term can contribute at most this many body hits

  /* normalise(text) -> lowercased string (deterministic, content-only). */
  function normalise(text) {
    return String(text == null ? "" : text).toLowerCase();
  }

  /* terms(query) -> [distinct lowercased query terms], stable order, no empties.
     Splitting on non-alphanumerics is a property of the QUERY, not any node's
     identity, so it cannot introduce a per-node privilege. */
  function terms(query) {
    var raw = normalise(query).split(/[^a-z0-9]+/);
    var seen = {}, out = [];
    for (var i = 0; i < raw.length; i++) {
      var t = raw[i];
      if (t && !seen[t]) { seen[t] = 1; out.push(t); }
    }
    return out;
  }

  /* count(term, hay) -> number of non-overlapping occurrences of term in hay. */
  function count(term, hay) {
    if (!term) return 0;
    var n = 0, from = 0, idx;
    while ((idx = hay.indexOf(term, from)) !== -1) { n++; from = idx + term.length; }
    return n;
  }

  /* scoreNode(query, node) -> number  (THE EARNED SCORE — invariant 36).
     Pure relevance over (query x {title, description, body}). Reads no identity
     field. Higher = more relevant, matching the core's rankKey contract. */
  function scoreNode(query, node) {
    var ts = terms(query);
    if (!ts.length || !node) return 0;
    var title = normalise(node.title);
    var desc = normalise(node.description);
    var body = normalise(node.body);
    var score = 0;
    for (var i = 0; i < ts.length; i++) {
      var t = ts[i];
      score += W_TITLE * count(t, title);
      score += W_DESC * count(t, desc);
      var b = count(t, body);
      score += W_BODY * (b > BODY_CAP_PER_TERM ? BODY_CAP_PER_TERM : b);
    }
    return score;
  }

  /* scoreIndex(query, nodes) -> [{...node, score}] for nodes with score > 0.
     The store's item shape: the node plus its earned score + a federation `hit`.
     Deterministic order in = order out (the core supplies the ranked order). */
  function scoreIndex(query, nodes) {
    var out = [];
    (nodes || []).forEach(function (n) {
      var s = scoreNode(query, n);
      if (s > 0) {
        out.push({
          hit: { url: n.url },
          label: String(n.title || n.url),
          url: n.url,
          title: n.title,
          description: n.description,
          coverage: n.coverage,   // carried for DISPLAY grouping (slot 03), not scored
          branch: n.branch,       // carried for DISPLAY only, never scored
          score: s
        });
      }
    });
    return out;
  }

  /* makeCorpusStore(index) -> fn(q) -> items[]  — the injected LOCAL fetcher the
     federation spine calls. `index` is the parsed search-index.json ({nodes:[...]}).
     Synchronous + local: it reaches on any non-empty query, fires no network. */
  function makeCorpusStore(index) {
    var nodes = (index && index.nodes) || [];
    return function (q) { return scoreIndex(q, nodes); };
  }

  /* makeCatalogItems(index) -> items[]  — the BROWSE listing: every corpus node as a
     display item, in INDEX ORDER. The served index is a deterministic fold, so a pure
     order-preserving map is byte-reproducible (determinism-first; any display re-order
     is the renderer's call, slot 03 piece 2). Carries the fields the slot-03 renderer +
     groupByCoverage read (coverage), and DELIBERATELY carries NO score: a browse is not
     a rank. Same item envelope as scoreIndex minus the earned score, so one renderer
     handles both a ranked hit and a catalog entry. */
  function makeCatalogItems(index) {
    var nodes = (index && index.nodes) || [];
    return nodes.map(function (n) {
      return {
        hit: { url: n.url },
        label: String(n.title || n.url),
        url: n.url,
        title: n.title,
        description: n.description,
        coverage: n.coverage,   // DISPLAY grouping (slot 03), never scored
        branch: n.branch        // DISPLAY only
      };
    });
  }

  /* catalogProducer(catalog, q) -> groups[]  — the sync:true LOCAL producer wired into
     the site spine (loop-search slot 03, piece 1). The EMPTY query alone yields the
     browse catalog; ANY non-empty query yields [] so the ranked scorer owns the query
     path UNTOUCHED. That is the PROPER-SUBSET rule with a receipt: empty-q gains the
     catalog, the query path loses nothing. The core carries this group SEPARATELY from
     the rank (federation-core collapseRank: sync groups are `carried`, never merged), so
     the browse can never contaminate the earned score — honesty by construction, not by
     convention. */
  function catalogProducer(catalog, q) {
    if (q) return [];                       // non-empty: defer entirely to the ranked scorer
    var items = makeCatalogItems(catalog);
    return [{
      kind: "catalog",
      title: "Browse the corpus",
      state: items.length ? "ok" : "empty",
      catalog: true,                        // display marker: a browse group, not a rank
      items: items
    }];
  }

  /* createSiteSearch(core, index) -> { search, ... }  — the ranked federation over
     the one corpus store, PLUS the empty-q browse catalog (slot 03 piece 1). Reuses the
     shared core UNCHANGED; this adapter only supplies the spine, the catalog producer,
     the (identity) normaliser, and rankKey = item.score. */
  function createSiteSearch(core, index) {
    if (!core || typeof core.createFederation !== "function") {
      throw new Error("corpus-search: shared federation-core not loaded");
    }
    var fed = core.createFederation({
      spine: [
        { kind: "catalog", title: "Browse the corpus", sync: true },   // empty-q browse (piece 1)
        { kind: "corpus",  title: "Loop MMT", local: true }            // the query-time ranked store
      ],
      produce: { catalog: catalogProducer },
      normalise: { corpus: function (v) { return v; } },  // store returns items directly
      mode: "ranked",
      rankKey: function (item) { return item && item.score; },  // the EARNED score
      rankedTitle: "Results"
    });
    var store = makeCorpusStore(index);
    return {
      search: function (query, onUpdate) {
        return fed.search(query, { corpus: store, catalog: index }, onUpdate);
      },
      _fed: fed,
      _store: store
    };
  }

  var api = {
    scoreNode: scoreNode,
    scoreIndex: scoreIndex,
    makeCorpusStore: makeCorpusStore,
    makeCatalogItems: makeCatalogItems,
    catalogProducer: catalogProducer,
    createSiteSearch: createSiteSearch,
    _weights: { title: W_TITLE, desc: W_DESC, body: W_BODY, bodyCap: BODY_CAP_PER_TERM },
    _version: "1.0"
  };

  if (typeof window !== "undefined") {
    (window.LoopSearch = window.LoopSearch || {}).corpusSearch = api;
  }
  if (typeof module !== "undefined" && module && module.exports) {
    module.exports = api;
  }
})();
