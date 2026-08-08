/* Shea's Forest — the App Shell · shell/index-catalog.js
   STEP 4 (the last piece of the tab system): the "+" catalog. See
   internal §3.4 —
   "glob(trees) ⊔ list(horizontals ∪ connectors) → a pick list → pin() writes
   view-config, strip re-renders."

   THIS FILE IS THE MODEL — the pure "what can I add" computation. Given the live
   projection + the current view-config, it produces the grouped pick-list the "+"
   panel renders: every addable capability (groves, trees, horizons, connectors),
   each with its end-user label and an `added` flag (already a tab or not). No DOM,
   no fetch, no writes — a pure fold, testable in isolation. The panel (the DOM +
   the pick->write->re-render wiring) is the thin layer on top, built next.

   Kinds included: the directive names trees ⊔ horizons ∪ connectors; groves (the
   canopy-cluster kind the shell already tabs) are included too, so the "+" can add
   any tab kind the shell supports.

   Plain script (no ES module) — attaches to window.ForestShell.indexCatalog.
   Depends on .viewConfig (connector list) and, if present, .renderers (titleize). */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  // The fixed horizon surfaces (mirror app.js's named set; the capability ref must
  // match what the horizon renderer + the edge `to` names expect).
  var HORIZONS = ["the Workbench", "Expiry Radar", "the Flow", "the Calendar", "the Body Clock"];
  // The Forest APPS — first-class destinations built on the Forest's own data
  // (distinct from a raw connector source). Mail (email-app) is the first: a
  // provider-agnostic read/search client over the normalized mail model.
  // Trio · Track CONTACT (member A) adds the Contacts app row (a J2-extension
  // the Confluence plan under-declared — FLAGGED to the Confluence). Track CALENDAR
  // adds only its own row here; prefix-region ownership keeps the intent disjoint.
  // Track CALENDAR (member B) adds its own row — the Calendar app (capability
  // "calendar:month"), distinct from the "gcal" connector + the "the Calendar" horizon.
  var APPS = [{ capability: "mail:inbox", label: "Mail" }, { capability: "contacts:people", label: "Contacts" }, { capability: "calendar:month", label: "Calendar" }, { capability: "sudoku:play", label: "Sudoku" }, { capability: "butcher:forest", label: "Butcher" }, { capability: "battleganza:play", label: "Battleganza" }];
  // End-user connector labels (mirror the strip/pane vocabulary).
  var CONNECTOR_LABEL = { gmail: "Gmail", gcal: "Calendar", contacts: "Contacts", files: "Files" };

  function titleize(slug) {
    if (root.renderers && typeof root.renderers.titleize === "function") return root.renderers.titleize(slug);
    return String(slug || "").split("-").map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ");
  }

  function tabbedSet(config) {
    var set = {};
    ((config && config.tabs) || []).forEach(function (t) { if (t && typeof t.capability === "string") set[t.capability] = true; });
    return set;
  }

  /* ---- buildCatalog(data, config) ------------------------------------------- *
   * -> { groups: [ { kind, title, items: [ { capability, label, added, grove? } ] } ],
   *      addableCount }                                                          *
   * `added` = the capability is already a tab in `config` (the panel greys it).  *
   * Empty groups are dropped. Groups ordered groves -> trees -> horizons ->      *
   * connectors (clusters first, then the leaves, then the cross-cutting).        */
  function buildCatalog(data, config) {
    var vc = root.viewConfig;
    var tabbed = tabbedSet(config);
    var groves = (((data || {}).canopy || {}).groves) || [];

    var groveItems = [];
    groves.forEach(function (g) {
      if (!g || !g.grove) return;
      var cap = "grove:" + g.grove;
      groveItems.push({ capability: cap, label: g.label || titleize(g.grove), added: !!tabbed[cap] });
    });

    // glob(trees): every tree across every grove, individually addable
    var treeItems = [];
    groves.forEach(function (g) {
      (g.trees || []).forEach(function (t) {
        if (!t || !t.tree) return;
        var cap = "tree:" + t.tree;
        treeItems.push({ capability: cap, label: titleize(t.tree), grove: g.grove, added: !!tabbed[cap] });
      });
    });

    var horizonItems = HORIZONS.map(function (h) {
      var cap = "horizon:" + h;
      return { capability: cap, label: h, added: !!tabbed[cap] };
    });

    var connectors = (vc && vc.LIVE_CONNECTORS && vc.LIVE_CONNECTORS.length) ? vc.LIVE_CONNECTORS : ["gmail", "gcal", "contacts", "files"];
    var connectorItems = connectors.map(function (c) {
      return { capability: c, label: CONNECTOR_LABEL[c] || titleize(c), added: !!tabbed[c] };
    });

    var appItems = APPS.map(function (a) {
      return { capability: a.capability, label: a.label, added: !!tabbed[a.capability] };
    });

    var groups = [
      { kind: "app", title: "Apps", items: appItems },
      { kind: "grove", title: "Groves", items: groveItems },
      { kind: "tree", title: "Trees", items: treeItems },
      { kind: "horizon", title: "Horizons", items: horizonItems },
      { kind: "connector", title: "Connectors", items: connectorItems }
    ].filter(function (g) { return g.items.length > 0; });

    var addableCount = groups.reduce(function (n, g) {
      return n + g.items.filter(function (i) { return !i.added; }).length;
    }, 0);

    return { groups: groups, addableCount: addableCount };
  }

  /* ---- export --------------------------------------------------------------- */
  root.indexCatalog = {
    buildCatalog: buildCatalog,
    HORIZONS: HORIZONS.slice(),
    CONNECTOR_LABEL: CONNECTOR_LABEL,
    _version: "1.0"
  };
})();
