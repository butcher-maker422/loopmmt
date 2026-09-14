/* loopmmt.com — the HUMAN DOOR panel (DOM mount) over the corpus display layer
   · loop-search slot 03, piece 2.

   ─────────────────────────────────────────────────────────────────────────────
   THE THIN LAYER. federation-core (slot 01) federates; corpus-search-federation
   (slot 02, ranked) earns the score; corpus-search-display (slot 03) partitions
   the one honest rank into coverage sections FOR THE EYE. This file is the last,
   thinnest slice: the DOM. input -> site.search(q, onUpdate) -> render(model).
   It reorders NOTHING and scores NOTHING — the rank and the grouping are already
   decided upstream; the panel is only ink.
   ─────────────────────────────────────────────────────────────────────────────

   WHY A FRESH FILE, NOT `index-panel-search.js`. NOTE-29.0103-1 named
   `index-panel-search` as the reuse target. It does not exist: only
   `index-panel-search.test.js` does, and that test proves SEARCH MODE inside the
   FOREST app's `index-panel.js` (Forest stores — soil/contacts/calendar/mail), a
   different door with a different model. The corpus human door renders coverage
   sections over ONE store, so it is its own thin panel. (S29.0209 verification.)

   THE TWO VIEWS (the empty-q model is `[ ranked(empty), catalog, corpus(idle) ]`):
     · EMPTY QUERY  → render the CATALOG browse group (every node, index order).
                      SUPPRESS the empty-rank and the idle-corpus groups. This is a
                      DISPLAY decision, never an engine change — idle is honest R3
                      state and the core is load-bearing (WATCH, goblin-koala).
                      Proper-subset rule: the browse takes NOTHING away from the
                      existing catalog.
     · NON-EMPTY Q  → take the RANKED group's items (the single earned order) ->
                      corpusDisplay.groupByCoverage -> coverage sections of node
                      links. state "empty" says NOTHING MATCHES (a different fact,
                      and different words, from an unreached/idle store).

   REPAINT HONESTY (the reason the Forest search suite runs on the faithful shim).
   site.search fires onUpdate up to once per store as it lands; the panel keeps ONE
   persistent results node and REPLACES its content each paint (results.textContent
   = "" DESTROYS the old tree). A repaint therefore never stacks a second copy, and
   the INPUT node is a stable object across repaints so focus and caret survive.

   A MALFORMED HIT (no url) is DROPPED, never rendered half-formed and never
   dispatched. Determinism-first: pure of wall-clock, random, and network; the only
   time source is the input debounce, which is a FEEL (drive `_debounceMs` to 0 in
   tests and assert the emit).

   Node links are real anchors (href = node url) so a hit is followable with NO JS,
   and ALSO emit `loopsearch:open` {url} on click for any host that wants to
   intercept (SPA navigation). The panel is pure of the write loop; the host owns
   navigation. Twin posture to the Forest panel's forest:search-open event.

   Plain script (no ES module): attaches to window.LoopSearch.corpusPanel AND sets
   module.exports for node/tests. */
(function () {
  "use strict";

  var DEFAULT_DEBOUNCE_MS = 120;

  function displayApi() {
    return (typeof window !== "undefined" && window.LoopSearch && window.LoopSearch.corpusDisplay) ||
           (typeof module !== "undefined" && module && module.exports && module.exports._display) ||
           null;
  }

  /* findGroup(model, pred) -> the first group matching pred, or null. */
  function findGroup(model, pred) {
    var gs = (model && model.groups) || [];
    for (var i = 0; i < gs.length; i++) { if (pred(gs[i])) return gs[i]; }
    return null;
  }
  function rankedGroup(model)  { return findGroup(model, function (g) { return g && (g.ranked === true || g.kind === "ranked"); }); }
  function catalogGroup(model) { return findGroup(model, function (g) { return g && (g.catalog === true || g.kind === "catalog"); }); }

  /* makeEvent(type, url) — a CustomEvent in a browser, a plain dispatchable object
     under the test shim. bubbles so a host listener above the mount catches it. */
  function makeEvent(type, url) {
    if (typeof CustomEvent === "function") {
      return new CustomEvent(type, { detail: { url: url }, bubbles: true });
    }
    return { type: type, detail: { url: url }, bubbles: true,
             preventDefault: function () {}, stopPropagation: function () {} };
  }

  /* mount(mountEl, site, opts) -> handle
       mountEl : the DOM node to paint into (owned by the panel while mounted).
       site    : a createSiteSearch(...) handle exposing search(q, onUpdate).
       opts    : { doc?, query?, debounceMs? }  (doc injected for tests).
     Returns { setQuery, destroy, _input, _results }. */
  function mount(mountEl, site, opts) {
    if (!mountEl) throw new Error("corpus-search-panel: no mount element");
    if (!site || typeof site.search !== "function") throw new Error("corpus-search-panel: site.search missing");
    var o = opts || {};
    var doc = o.doc || (typeof document !== "undefined" ? document : null);
    if (!doc) throw new Error("corpus-search-panel: no document");
    var disp = o.display || displayApi();
    if (!disp || typeof disp.groupByCoverage !== "function") throw new Error("corpus-search-panel: corpusDisplay not loaded");

    var debounceMs = (o.debounceMs != null) ? o.debounceMs : mount._debounceMs;
    var closed = false;
    var timer = null;

    /* ── frame: head (persistent input) + results (repainted) ── */
    mountEl.textContent = "";                        // faithful clear (destroys any prior mount)
    var root = doc.createElement("div"); root.className = "loopsearch";
    var head = doc.createElement("div"); head.className = "loopsearch__head";
    var input = doc.createElement("input");
    input.className = "loopsearch__input";
    input.setAttribute("type", "search");
    input.setAttribute("placeholder", "Search the corpus");
    input.setAttribute("aria-label", "Search the corpus");
    var results = doc.createElement("div"); results.className = "loopsearch__results";
    head.appendChild(input);
    root.appendChild(head);
    root.appendChild(results);
    mountEl.appendChild(root);

    if (o.query != null) { input.value = String(o.query); }

    /* renderItem(container, item) — a node link, or nothing if malformed. */
    function renderItem(container, item) {
      if (!item || !item.url) { return; }           // malformed -> dropped, never half-formed
      var a = doc.createElement("a");
      a.className = "loopsearch__hit";
      a.setAttribute("href", String(item.url));
      a.setAttribute("data-search-hit", String(item.url));
      var label = doc.createElement("span");
      label.className = "loopsearch__hit-label";
      label.textContent = String(item.label != null ? item.label : item.title != null ? item.title : item.url);
      a.appendChild(label);
      if (item.description) {
        var sub = doc.createElement("span");
        sub.className = "loopsearch__hit-sub";
        sub.textContent = String(item.description);
        a.appendChild(sub);
      }
      a.addEventListener("click", function () {
        a.dispatchEvent(makeEvent("loopsearch:open", String(item.url)));
      });
      container.appendChild(a);
    }

    /* renderSection(coverage, items) — a coverage header + its node links. */
    function renderSection(coverage, items) {
      var sec = doc.createElement("div"); sec.className = "loopsearch__section";
      var h = doc.createElement("div"); h.className = "loopsearch__coverage";
      h.textContent = coverage ? String(coverage) : "Uncategorized";
      sec.appendChild(h);
      (items || []).forEach(function (it) { renderItem(sec, it); });
      results.appendChild(sec);
    }

    function renderMessage(cls, text) {
      var m = doc.createElement("div"); m.className = "loopsearch__msg " + cls;
      m.textContent = text;
      results.appendChild(m);
    }

    /* render(model, q) — REPLACE the results content (never stack). */
    function render(model, q) {
      results.textContent = "";                     // faithful destroy of the prior paint
      var empty = !q;
      if (empty) {
        // EMPTY VIEW: the catalog browse; suppress ranked(empty) + corpus(idle).
        var cat = catalogGroup(model);
        var browse = (cat && cat.items) || [];
        if (!browse.length) { renderMessage("loopsearch__msg--browse", "The corpus is empty."); return; }
        var head2 = doc.createElement("div"); head2.className = "loopsearch__browse-title";
        head2.textContent = (cat && cat.title) ? String(cat.title) : "Browse the corpus";
        results.appendChild(head2);
        var browseView = disp.groupByCoverage(browse);
        (browseView.groups || []).forEach(function (g) { renderSection(g.coverage, g.items); });
        return;
      }
      // QUERY VIEW: the ranked group, partitioned by coverage.
      var rk = rankedGroup(model);
      var items = (rk && rk.items) || [];
      if (!items.length) {                          // NOTHING MATCHES — not "no store", not idle
        renderMessage("loopsearch__msg--empty", "Nothing matches \u201C" + q + "\u201D.");
        return;
      }
      var view = disp.groupByCoverage(items);
      (view.groups || []).forEach(function (g) { renderSection(g.coverage, g.items); });
    }

    function run(q) {
      site.search(q, function (model) { if (!closed) render(model, q); });
    }

    function onInput() {
      var q = String(input.value || "").trim();
      if (timer) { clearTimeout(timer); timer = null; }
      if (debounceMs > 0) { timer = setTimeout(function () { run(q); }, debounceMs); }
      else { run(q); }
    }
    input.addEventListener("input", onInput);

    // initial paint: the empty-query catalog browse (or the seeded query).
    run(String(input.value || "").trim());

    return {
      _input: input,
      _results: results,
      setQuery: function (q) { input.value = (q == null ? "" : String(q)); onInput(); },
      destroy: function () {
        closed = true;
        if (timer) { clearTimeout(timer); timer = null; }
        mountEl.textContent = "";                     // faithful clear
      }
    };
  }
  mount._debounceMs = DEFAULT_DEBOUNCE_MS;

  var api = { mount: mount, _version: "1.0" };

  if (typeof window !== "undefined") {
    (window.LoopSearch = window.LoopSearch || {}).corpusPanel = api;
  }
  if (typeof module !== "undefined" && module && module.exports) {
    module.exports = api;
  }
})();
