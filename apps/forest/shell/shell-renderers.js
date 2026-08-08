/* Shea's Forest — the App Shell · shell/shell-renderers.js
   STEP 3 follow-on. The live pane renderers — the guts each capability KIND
   registers with pane.registerRenderer so a selected tab shows REAL Forest data
   instead of a calm PENDING pane. See internal
   eod-handoff (the STEP 3 follow-on: "register app.js's canopy/soil/horizon
   renderers with pane.registerRenderer").

   Why re-implemented here (not app.js's closures directly): app.js's render
   functions are DOM-targeted to fixed PAGE mounts (#canopy-mount, #soil-mount,
   article.horizon[data-horizon=...]) — they find their own home and write into the
   single-page layout. A pane renderer instead renders into the pane element handed
   to it (ctx.paneEl) from ctx.data. So these are thin, self-contained pane twins of
   app.js's render logic — same data shapes, same read-only discipline, no coupling
   to app.js's page DOM, and pane.js is left untouched (its 14/14 stays valid).

   The renderers are PURE folds of (paneEl, ctx) -> DOM, where
     ctx = { capability, kind, data, resolved, label }
   and ctx.data is the merged projection (forest-state + the edge set). They build
   DOM with createElement/textContent (injection-safe, and the shape the test shim
   supports — no innerHTML). READ-ONLY over the graph, exactly like the pane.

   Plain script (no ES module) — attaches to window.ForestShell.renderers.
   Depends on window.ForestShell.pane (registration target) + .viewConfig. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  /* ---- display names + DOM helper (self-contained; mirrors app.js) ---------- */
  // A small custom display map (mirrors app.js's DISPLAY) so tree/grove names read
  // the way they do on the page; everything else title-cases the slug.
  var DISPLAY = {
    "gc": "GC", "retirement-college": "Retirement & College",
    "health-admin": "Health Admin", "founder-equity": "Founder Equity",
    "burning-man": "Burning Man"
  };
  function titleize(slug) {
    if (DISPLAY[slug]) return DISPLAY[slug];
    return String(slug || "").split("-").map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(" ");
  }
  // The el() lives once now, in shell/block.js (the Block Alphabet's shared atom).
  // Same contract as before: `text` sets textContent, other attrs setAttribute.
  var el = root.block.el;
  function refOf(capability) {
    var s = String(capability || ""); var i = s.indexOf(":");
    return i === -1 ? s : s.slice(i + 1);
  }
  function allTrees(data) {
    var out = [];
    (((data || {}).canopy || {}).groves || []).forEach(function (g) {
      (g.trees || []).forEach(function (t) { out.push(t); });
    });
    return out;
  }

  /* ---- the tree card (pane twin of app.js treeCard, built as DOM) ----------- */
  function treeCardNode(doc, t) {
    var art = el(doc, "article", "tree");
    var head = el(doc, "div");
    head.appendChild(el(doc, "div", "tree__name", { text: titleize(t.tree) }));
    head.appendChild(el(doc, "div", "tree__what", { text: t.trunk || "" }));
    var pace = t.pace || [];
    if (pace.length) {
      var pr = el(doc, "div", "tree__pace");
      pace.forEach(function (p) { pr.appendChild(el(doc, "span", "pace-chip", { text: p })); });
      head.appendChild(pr);
    }
    art.appendChild(head);
    var foot = el(doc, "div", "tree__foot");
    foot.appendChild(el(doc, "span", "tree__weather", { text: t.weight || "" }));
    var seams = el(doc, "span", "tree__seams");
    if (t.gate) seams.appendChild(el(doc, "span", "seam-chip seam-chip--gate", { text: "gate" }));
    if (t.edge) seams.appendChild(el(doc, "span", "seam-chip seam-chip--edge", { text: "edge" }));
    if (t.feed_to) seams.appendChild(el(doc, "span", "seam-chip seam-chip--feed", { text: "feeds " + t.feed_to }));
    foot.appendChild(seams);
    art.appendChild(foot);
    return art;
  }

  /* ---- TREE renderer — tree:<slug> ------------------------------------------ */
  function renderTree(paneEl, ctx) {
    var doc = paneEl.ownerDocument;
    var ref = refOf(ctx.capability);
    var t = allTrees(ctx.data).filter(function (x) { return x.tree === ref; })[0];
    paneEl.appendChild(el(doc, "h2", "pane__title", { text: ctx.label }));
    if (!t) {
      paneEl.appendChild(el(doc, "p", "pane__absent", { text: "This tree isn\u2019t in the current snapshot." }));
      return;
    }
    var floor = el(doc, "div", "grove-floor");
    var block = el(doc, "div", "tree-block");
    block.appendChild(treeCardNode(doc, t));
    var it = treeItemsNode(doc, t, (ctx.data || {}).edges, (ctx.data || {}).edgesMeta);
    if (it) block.appendChild(it);
    floor.appendChild(block);
    paneEl.appendChild(floor);
    var m = (ctx.data && ctx.data._meta) || {};
    if (m.source_commit) paneEl.appendChild(el(doc, "div", "pane__gloss", { text: "snapshot " + m.source_commit + " \u00b7 read-only" }));
  }

  /* ---- GROVE renderer — grove:<slug> ---------------------------------------- */
  function renderGrove(paneEl, ctx) {
    // STEP 7 — ⊗ dispatch: grove:<a>⊗<b> is a two-up COMPOSE, not a single canopy
    // grove. ⊗ (U+2297) is the discriminator (unit refs never contain it). Flat +
    // additive — the single-grove path below is byte-identical, so its tests stay green.
    if (refOf(ctx.capability).indexOf("\u2297") !== -1) return renderGroveCompose(paneEl, ctx);
    var doc = paneEl.ownerDocument;
    var ref = refOf(ctx.capability);
    var groves = (((ctx.data || {}).canopy || {}).groves) || [];
    var g = groves.filter(function (x) { return x.grove === ref || x.label === ref; })[0];
    paneEl.appendChild(el(doc, "h2", "pane__title", { text: ctx.label }));
    if (!g) {
      paneEl.appendChild(el(doc, "p", "pane__absent", { text: "This grove isn\u2019t in the current snapshot." }));
      return;
    }
    var group = el(doc, "div", "grove-group");
    var lbl = el(doc, "div", "grove-group__label", { text: g.label });
    lbl.appendChild(el(doc, "span", "grove-group__count", { text: String((g.trees || []).length) }));
    group.appendChild(lbl);
    var floor = el(doc, "div", "grove-floor");
    (g.trees || []).forEach(function (t) {
      var block = el(doc, "div", "tree-block");
      block.appendChild(treeCardNode(doc, t));
      var it = treeItemsNode(doc, t, (ctx.data || {}).edges, (ctx.data || {}).edgesMeta);
      if (it) block.appendChild(it);
      floor.appendChild(block);
    });
    group.appendChild(floor);
    paneEl.appendChild(group);
  }

  /* ---- GROVE-COMPOSE renderer — grove:<a>\u2297<b>  (STEP 7, two-up) --------- *
   * \u2297 is the methodology's monoidal product: parallel-INDEPENDENT compose.   *
   * Builds NO new content — each of the two units is itself any capability        *
   * (tree/grove/horizon/connector), so each is dispatched to its EXISTING         *
   * renderer by kindOf and laid out side-by-side. A composition, not a fifth      *
   * content renderer (the STEP 5 lesson one level up). Graham's bound: exactly    *
   * two-up, never N; flat, never nested. Real-or-Made holds by composition — the  *
   * sub-renderers carry their own dummy-honest tags; we inherit, never re-do them.*/
  function slotLabel(subCap) { return titleize(refOf(subCap)); }
  function renderSubUnit(slotBody, subCap, data) {
    var doc = slotBody.ownerDocument;
    subCap = String(subCap == null ? "" : subCap).trim();
    // Graham's flat bound: a sub-unit is a single capability, never another \u2297.
    if (refOf(subCap).indexOf("\u2297") !== -1) {
      slotBody.appendChild(el(doc, "p", "pane__absent", { text: "Nested \u2297 isn\u2019t supported (two-up only)." }));
      return;
    }
    var kind = (root.viewConfig && typeof root.viewConfig.kindOf === "function")
      ? root.viewConfig.kindOf(subCap) : "unknown";
    var subCtx = { capability: subCap, kind: kind, data: data, resolved: null, label: slotLabel(subCap) };
    // Dispatch by kind through the same renderer set the pane registry uses (reusing data).
    if (kind === "tree") return renderTree(slotBody, subCtx);
    if (kind === "grove") return renderGrove(slotBody, subCtx);
    if (kind === "horizon") return renderHorizon(slotBody, subCtx);
    if (kind === "connector") return renderConnector(slotBody, subCtx);
    // unknown / connector-absent -> honest per-slot; never fabricates, never fails the compose.
    slotBody.appendChild(el(doc, "p", "pane__absent", { text: "This unit isn\u2019t in the current snapshot." }));
  }
  function renderGroveCompose(paneEl, ctx) {
    var doc = paneEl.ownerDocument;
    var parts = refOf(ctx.capability).split("\u2297");   // e.g. ["tree:bills", "horizon:the Flow"]
    paneEl.appendChild(el(doc, "h2", "pane__title", { text: ctx.label }));
    var grid = el(doc, "div", "grove-compose");
    // Exactly two-up (Graham's bound). Render the first two slots; >2 is a spec error, surfaced.
    [parts[0], parts[1]].forEach(function (subCap) {
      var slot = el(doc, "div", "grove-compose__slot");
      slot.appendChild(el(doc, "div", "grove-compose__slot-head", { text: slotLabel(subCap) }));
      var body = el(doc, "div", "grove-compose__slot-body");
      renderSubUnit(body, subCap, ctx.data);
      slot.appendChild(body);
      grid.appendChild(slot);
    });
    paneEl.appendChild(grid);
    if (parts.length > 2) {
      paneEl.appendChild(el(doc, "p", "pane__absent", { text: "\u2297 is two-up only \u2014 extra units are ignored." }));
    }
  }

  /* ---- CONNECTOR renderer — gmail/gcal/contacts/files ------------------------ *
   * Connectors are the SOURCES that feed the Forest; forest-state carries no rich *
   * per-connector view, so this pane stays plain + honest (never invents data).   */
  function renderConnector(paneEl, ctx) {
    var doc = paneEl.ownerDocument;
    paneEl.appendChild(el(doc, "h2", "pane__title", { text: ctx.label }));
    paneEl.appendChild(el(doc, "p", "pane__connector", { text: ctx.label + " is a connected source, feeding your Forest." }));
    var soil = (ctx.data || {}).soil || {};
    if (ctx.capability === "contacts" && (soil.nodes || []).length) {
      paneEl.appendChild(el(doc, "p", "pane__gloss", { text: soil.nodes.length + " people in your Soil" }));
    }

    /* ---- the connector's OWN ingested items — a REAL filter over K1-safe provenance ----
     * Consumes connector-items.js (window.ForestShell.connectorItems) over ctx.data.soilItems
     * (the GET /projection/soil rows). COLD-SAFE: if that core isn't loaded, or no provenance
     * is present, the pane keeps its honest "connected source" line and shows nothing
     * fabricated. CONTENT-FREE by construction (name + category only) — the K1 line holds at
     * the render seam because projectConnectorItems PICKs fields, never spreads the row.       */
    var ci = root.connectorItems;
    if (!ci || typeof ci.projectConnectorItems !== "function") return;   // core absent -> honest degrade
    var proj = ci.projectConnectorItems(ctx.capability, (ctx.data || {}).soilItems);

    if (proj.count === 0) {
      // HONEST-EMPTY: a connected source with nothing ingested yet — never a fabricated row.
      paneEl.appendChild(el(doc, "p", "pane__pending", {
        text: "Nothing from " + ctx.label + " yet \u2014 sync a source to grow this."
      }));
      return;
    }

    // A tiny category census header ("3 items \u00b7 1 bills, 2 tax") — a legible count,
    // not a recency claim (recency is the per-item time badge below). Categories verbatim.
    var censusBits = proj.categories.map(function (c) {
      return c.count + " " + (c.category === null ? "uncategorized" : c.category);
    });
    paneEl.appendChild(el(doc, "div", "pane__census", {
      text: proj.count + " item" + (proj.count === 1 ? "" : "s") + " \u00b7 " + censusBits.join(", ")
    }));

    // The items, GROUPED into category sections (richer than the old flat list):
    // each section carries a heading (category \u00b7 count) and its own items list.
    // Per item we show the name, an optional adapter badge (only on a multi-adapter
    // umbrella like Files), and \u2014 when the item carries a REAL ingestion stamp \u2014 a
    // small relative-time label ("3h ago" / "Jun 20"), the visible half of STEP 5
    // recency. name + category + source are K1-safe (the core PICKs them, never
    // spreads content); ingestedAt is K1-safe provenance too. Order is
    // category-then-recency (category asc, then newest-ingested first within a
    // section; undated rows last, flag-don't-fake \u2014 never a fabricated time).
    var showSource = proj.sources.length > 1;
    var rt = (typeof root.relativeTime === "function") ? root.relativeTime : null;  // cold-safe
    (proj.groups || []).forEach(function (grp) {
      var section = el(doc, "div", "connector-group");
      section.appendChild(el(doc, "div", "connector-group__head", {
        text: (grp.category === null ? "uncategorized" : grp.category) + " \u00b7 " + grp.count
      }));
      var ul = el(doc, "ul", "connector-items");
      grp.items.forEach(function (it) {
        var li = el(doc, "li", "connector-item");
        li.appendChild(el(doc, "span", "connector-item__name", { text: it.name || "(item)" }));
        if (showSource) li.appendChild(el(doc, "span", "connector-item__src", { text: it.source }));
        // flag-don't-fake: only render a time when there is a real, honest label;
        // an undated item (ingestedAt null) gets NO badge, never a guessed time.
        var when = rt ? rt(it.ingestedAt) : null;
        if (when) li.appendChild(el(doc, "span", "connector-item__time", { text: when }));
        ul.appendChild(li);
      });
      section.appendChild(ul);
      paneEl.appendChild(section);
    });
  }

  /* ---- edge-query helpers (pane twins of app.js's edge logic) --------------- */
  function rowDate(row) {
    var best = null;
    Object.keys(row || {}).forEach(function (k) {
      var v = row[k];
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && (best === null || v < best)) best = v;
    });
    return best;
  }
  function cleanLabel(s) {
    s = String(s == null ? "" : s)
      .replace(/\\u[0-9a-fA-F]{4}/g, " ")
      .replace(/\\[ntrbf"'\\\/]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (s.length > 72) s = s.slice(0, 71).replace(/\s+\S*$/, "").trim() + "\u2026";
    return s || "(item)";
  }
  function rowLabel(row) {
    var keys = Object.keys(row || {});
    var pref = keys.filter(function (k) {
      return /obligation|task|event|account|entity|filing|review|merge|practice|screening/.test(k);
    });
    var k = pref[0] || keys.filter(function (j) { return typeof row[j] === "string"; })[0];
    return cleanLabel(k ? row[k] : "(item)");
  }
  function fmtDate(iso) {
    try { return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
    catch (e) { return iso; }
  }
  function edgesFor(edges, name) {
    var out = (edges || []).filter(function (e) { return (e.to || []).indexOf(name) !== -1; });
    out.sort(function (a, b) {
      var da = rowDate(a.row), db = rowDate(b.row);
      if (da && db) return da < db ? -1 : 1;
      return da ? -1 : (db ? 1 : 0);
    });
    return out;
  }
  function provText(edgesMeta) {
    return (edgesMeta && edgesMeta.provenance === "live") ? "live" : "dummy data";
  }

  /* ---- a TREE's OWN items (source_tree match) — the reverse of edgesFor ------ *
   * edgesFor(edges, name) finds edges FEEDING a horizon (matches `to`); this     *
   * finds edges PRODUCED BY a tree (matches `source_tree`), date-sorted. It is    *
   * the query the grove/tree panes need to project a tree's items (STEP 5         *
   * richer projection). Reuses rowDate (hoisted). */
  function edgesFromTree(edges, treeSlug) {
    var out = (edges || []).filter(function (e) { return e.source_tree === treeSlug; });
    out.sort(function (a, b) {
      var da = rowDate(a.row), db = rowDate(b.row);
      if (da && db) return da < db ? -1 : 1;
      return da ? -1 : (db ? 1 : 0);
    });
    return out;
  }

  /* A compact projection of a tree's own items, mirroring the horizon's radar     *
   * rows. DUMMY-GATED: carries the live/dummy provenance tag (provText) so a       *
   * stand-in row is NEVER presented as real (Real-or-Made / Ink-Law) — the same    *
   * guard the horizon rides. Returns null when the tree has no items (no          *
   * sub-list, no fabricated "pending" inside a grove — the card stands alone) and  *
   * when no edge set is loaded (cold-safe: FIXTURE-only panes are untouched).      */
  function treeItemsNode(doc, tree, edges, edgesMeta) {
    if (!edges) return null;
    var rows = edgesFromTree(edges, tree.tree);
    if (!rows.length) return null;
    var today = new Date().toISOString().slice(0, 10);
    var wrap = el(doc, "div", "tree-items");
    var ul = el(doc, "ul", "radar radar--nested");
    rows.slice(0, 5).forEach(function (e) {
      var dt = rowDate(e.row), overdue = dt && dt < today;
      var li = el(doc, "li", "radar-row" + (overdue ? " radar-row--overdue" : ""));
      li.appendChild(el(doc, "span", "radar-row__when", { text: dt ? fmtDate(dt) + (overdue ? " \u00b7 overdue" : "") : "\u2014" }));
      li.appendChild(el(doc, "span", "radar-row__what", { text: rowLabel(e.row) }));
      var amt = (typeof e.row.amount === "number") ? e.row.amount
              : (typeof e.row.est_amount === "number") ? e.row.est_amount : null;
      if (amt != null) li.appendChild(el(doc, "span", "radar-row__amt", { text: "$" + amt.toFixed(0) }));
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    wrap.appendChild(el(doc, "div", "tree-items__tag", {
      text: rows.length + " item" + (rows.length === 1 ? "" : "s") + " \u00b7 " + provText(edgesMeta)
    }));
    return wrap;
  }

  /* ---- the Workbench — a query over the CANOPY (fast + load-bearing first) --- */
  function renderWorkbench(doc, paneEl, data) {
    var trees = allTrees(data);
    if (!trees.length) { paneEl.appendChild(el(doc, "p", "pane__pending", { text: "No trees in the canopy yet." })); return; }
    function paceRank(t) {
      var p = (t.pace || []).join(" ");
      if (/fast/.test(p)) return 0;
      if (/steady|medium/.test(p)) return 1;
      if (/slow|seasonal/.test(p)) return 2;
      return 1.5;
    }
    function weightRank(t) { return /load-bearing/.test(t.weight || "") ? 0 : (/nice-to-have/.test(t.weight || "") ? 2 : 1); }
    trees = trees.slice().sort(function (a, b) {
      var pa = paceRank(a), pb = paceRank(b);
      if (pa !== pb) return pa - pb;
      return weightRank(a) - weightRank(b);
    });
    var ul = el(doc, "ul", "radar");
    trees.slice(0, 12).forEach(function (t) {
      var li = el(doc, "li", "bench-row");
      li.appendChild(el(doc, "span", "bench-row__tree", { text: titleize(t.tree) }));
      li.appendChild(el(doc, "span", "bench-row__work", { text: (t.branches || [])[0] || t.trunk || "" }));
      if (t.pace && t.pace.length) li.appendChild(el(doc, "span", "pace-chip", { text: t.pace.join(", ") }));
      if (t.weight) li.appendChild(el(doc, "span", "bench-row__weight" + (/load-bearing/.test(t.weight) ? " bench-row__weight--load" : ""), { text: t.weight }));
      ul.appendChild(li);
    });
    paneEl.appendChild(ul);
    paneEl.appendChild(el(doc, "div", "horizon__tag", { text: trees.length + " trees \u00b7 from the canopy" }));
  }

  /* ---- HORIZON renderer — horizon:<Name> ------------------------------------ *
   * Horizons are QUERIES over the edge set (data.edges), except the Workbench     *
   * which queries the canopy. The dummy-vs-live provenance tag rides every        *
   * surface so a stand-in row is never presented as real (app.js's rule).         */
  function renderHorizon(paneEl, ctx) {
    var doc = paneEl.ownerDocument;
    var name = refOf(ctx.capability);
    paneEl.appendChild(el(doc, "h2", "pane__title", { text: name }));
    if (name === "the Workbench") { renderWorkbench(doc, paneEl, ctx.data); return; }
    var edges = (ctx.data && ctx.data.edges) || null;
    if (!edges) { paneEl.appendChild(el(doc, "p", "pane__pending", { text: "Connect a feed to populate this horizon." })); return; }
    var rows = edgesFor(edges, name);
    if (!rows.length) { paneEl.appendChild(el(doc, "p", "pane__pending", { text: "No items feeding " + name + " yet." })); return; }
    var today = new Date().toISOString().slice(0, 10);
    var ul = el(doc, "ul", "radar");
    rows.slice(0, 12).forEach(function (e) {
      var dt = rowDate(e.row), overdue = dt && dt < today;
      var li = el(doc, "li", "radar-row" + (overdue ? " radar-row--overdue" : ""));
      li.appendChild(el(doc, "span", "radar-row__when", { text: dt ? fmtDate(dt) + (overdue ? " \u00b7 overdue" : "") : "\u2014" }));
      li.appendChild(el(doc, "span", "radar-row__what", { text: rowLabel(e.row) }));
      li.appendChild(el(doc, "span", "radar-row__src", { text: titleize(e.source_tree) }));
      var amt = (typeof e.row.amount === "number") ? e.row.amount
              : (typeof e.row.est_amount === "number") ? e.row.est_amount : null;
      if (amt != null) li.appendChild(el(doc, "span", "radar-row__amt", { text: "$" + amt.toFixed(0) }));
      ul.appendChild(li);
    });
    paneEl.appendChild(ul);
    paneEl.appendChild(el(doc, "div", "horizon__tag", { text: rows.length + " items \u00b7 " + provText(ctx.data && ctx.data.edgesMeta) }));
  }

  /* ---- registration --------------------------------------------------------- */
  function registerAll(pane) {
    pane = pane || root.pane;
    if (!pane || typeof pane.registerRenderer !== "function") return false;
    pane.registerRenderer("tree", renderTree);
    pane.registerRenderer("grove", renderGrove);
    pane.registerRenderer("connector", renderConnector);
    pane.registerRenderer("horizon", renderHorizon);
    // email-app leg 2 — the Mail app (kind "mail") is a separate additive file
    // (shell/mail-renderer.js). Pick it up here so it registers whether it loaded
    // before or after this pass; cold-safe if the file isn't present.
    if (root.mailRenderer && typeof root.mailRenderer.render === "function") {
      pane.registerRenderer("mail", root.mailRenderer.render);
    }
    // Trio · Track CONTACT (member A) — the Contacts app (kind "contacts")
    // is a separate additive file (shell/contacts-renderer.js). Pick it up here so
    // it registers whether it loaded before or after this pass; cold-safe if absent.
    // Prefix-region ownership (Confluence §1 J2): this block registers ONLY the
    // contacts kind; Track CALENDAR registers only "calendar" in its own block.
    if (root.contactsRenderer && typeof root.contactsRenderer.render === "function") {
      pane.registerRenderer("contacts", root.contactsRenderer.render);
    }
    // Trio · Track CALENDAR (member B) — the Calendar app (kind "calendar")
    // is a separate additive file (shell/calendar-renderer.js). Pick it up here so
    // it registers whether it loaded before or after this pass; cold-safe if absent.
    // Prefix-region ownership (Confluence §1 J2): this block registers ONLY the
    // calendar kind, disjoint from the contacts block above.
    if (root.calendarRenderer && typeof root.calendarRenderer.render === "function") {
      pane.registerRenderer("calendar", root.calendarRenderer.render);
    }
    return true;
  }

  /* ---- the merged read — forest-state + the edge set ------------------------ *
   * Pass this as the pane's opts.readProjection so ctx.data carries BOTH the      *
   * canopy/soil projection AND the edge set (data.edges + data.edgesMeta), so the *
   * horizon renderers have their rows. Mirrors app.js: forest-state with a static *
   * fallback; edges live-then-dummy. Never clobbers forest-state's own _meta.     *
   * Injectable urls (opts.*) so it is testable with a mocked fetch, cold-safe.    */
  function makeForestRead(opts) {
    opts = opts || {};
    var RT = (root.runtimeBase || (typeof window !== "undefined" && window.FOREST_RUNTIME) || "");
    var stateUrl = opts.stateUrl || ((RT || "") + "/projection/forest-state");
    var stateFallback = opts.stateFallback || "state/forest-state.json";
    var edgesLive = opts.edgesUrl || "state/forest-edges.json";
    var edgesDummy = opts.edgesDummyUrl || "state/forest-edges.dummy.json";
    var soilUrl = opts.soilUrl || ((RT || "") + "/projection/soil");
    var fetchImpl = opts.fetch || (typeof fetch === "function" ? fetch : null);
    function getJSON(u, creds) {
      if (!fetchImpl) return Promise.resolve(null);
      return fetchImpl(u, { cache: "no-store", credentials: creds ? "include" : "same-origin" })
        .then(function (r) { return r && r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    return function () {
      var stateP = getJSON(stateUrl, true).then(function (d) { return d || getJSON(stateFallback, false); });
      var edgesP = getJSON(edgesLive, false).then(function (d) { return d || getJSON(edgesDummy, false); });
      // The K1-safe provenance list (GET /projection/soil -> { items:[...] }) — a runtime-only,
      // CREDENTIALED read. COLD-SAFE: no live session / no runtime -> getJSON -> null -> soilItems:[]
      // (honest-empty; the connector pane then renders "nothing here yet", never a fabricated row).
      var soilP = getJSON(soilUrl, true);
      return Promise.all([stateP, edgesP, soilP]).then(function (parts) {
        var state = parts[0] || {};
        var edgeSet = parts[1] || {};
        var soil = parts[2] || {};
        var data = {};
        for (var k in state) if (Object.prototype.hasOwnProperty.call(state, k)) data[k] = state[k];
        data.edges = edgeSet.edges || [];        // never overwrites forest-state's _meta
        data.edgesMeta = edgeSet._meta || {};
        data.soilItems = soil.items || [];       // connector panes' provenance rows (K1-safe: no content)
        return data;
      });
    };
  }

  /* ---- export --------------------------------------------------------------- */
  root.renderers = {
    tree: renderTree, grove: renderGrove, connector: renderConnector, horizon: renderHorizon,
    registerAll: registerAll, makeForestRead: makeForestRead,
    titleize: titleize, _version: "1.0"
  };
})();
