/* Shea's Forest — the App Shell · shell/connector-items.js
   STEP 5 A of the shell build — the connector-item PROJECTION core.
   See sessions/01.1230-spunky-whistle-pt1h9t/BUILD-DIRECTIVE-v1.md item 5
   ("wire live tool-tabs — Gmail/Calendar/Contacts/Files panes over the live
   connectors").

   WHAT THIS IS. The pure, DOM-free core that answers "which of my ingested Soil
   items came from THIS connector, and how do I show them honestly?" — so a
   connector tab (Files/Calendar/Gmail/Contacts) can render the operator's real
   recent items instead of the placeholder "X is a connected source" line. The
   render-wire in shell-renderers.js (renderConnector) consumes this; keeping the
   logic here keeps it browser-and-node testable with no DOM and no blast radius.

   WHY IT'S BUILDABLE NOW (the un-block). Every ingested item is keyed by the
   provenance triple (source, account, itemId) and the Catch's listProvenance()
   returns a K1-safe, CONTENT-FREE row carrying { source, account, itemId,
   category, name } (forest/catch/the-catch.js). GET /projection/soil already
   serves that list. So "items from connector X" is a real filter over real
   provenance — no fabricated attribution (the earlier "Soil carries no source"
   model-block was stale once BLOCK D's ingestion landed).

   THE MAPPING (fixed; not a taxonomy guess). A shell connector CAPABILITY groups
   the source ADAPTERS that feed it. The capability set is the directive's
   { gmail, gcal, contacts, files }; the adapter set is { local-fs, drive,
   dropbox, calendar, gmail, contacts }. `files` is the umbrella for every
   file-providing adapter (there is no separate drive/dropbox capability in the
   shell); the other three are 1:1 with their adapter.

   HONESTY (the Real-or-Made Line, applied to the projection):
     • REAL RECENCY, FLAG-DON'T-FAKE. The intake now persists a real ingestion
       stamp: the-catch.js writes `ingested_at` on every intake (preserving the
       prior stamp on an unchanged re-sync), the Soil stores it, and
       listProvenance / GET /projection/soil carry it out. So this core CAN and
       DOES order by time — but only where the time is real: within each category
       section, items sort NEWEST-FIRST by `ingestedAt`. A row that carries NO
       `ingested_at` (a legacy or hand-built row) is projected with
       `ingestedAt: null` and makes NO recency claim — it sorts AFTER every dated
       row in its category (name-then-itemId), never handed a fabricated time.
       (The cross-category order is unchanged: category asc, uncategorized last;
       recency is WITHIN a category, so the grouped sections keep their shape.)
     • K1 CONTENT-FREE. The output is BUILT by PICKING { itemId, name, category,
       source, ingestedAt } — never by spreading the row — so even if a caller
       passes rows that still carry `content`/`cred`, neither can leak into the
       projection. `ingestedAt` is K1-safe provenance (it rides in listProvenance,
       never content).
     • HONEST-EMPTY. A connected source with nothing ingested yet projects to an
       empty list with count 0 — never a fabricated row (the pane renders this as
       a calm "nothing here yet", the sibling of the honest-absent pane).

   Plain script (no ES module) — attaches to window.ForestShell.connectorItems.
   No dependencies (pure functions over a provenance array). */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  /* ---- the fixed capability -> source-adapters mapping --------------------- *
   * Keep this the single source of truth for the grouping; renderConnector and  *
   * any future items endpoint both read it, so the umbrella never drifts.       */
  var CAPABILITY_SOURCES = {
    files: ["local-fs", "drive", "dropbox"],
    gcal: ["calendar"],
    gmail: ["gmail"],
    contacts: ["contacts"]
  };

  function sourcesForCapability(capability) {
    var s = CAPABILITY_SOURCES[capability];
    return s ? s.slice() : [];   // copy — callers never mutate the table
  }

  function capabilityForSource(source) {
    for (var cap in CAPABILITY_SOURCES) {
      if (Object.prototype.hasOwnProperty.call(CAPABILITY_SOURCES, cap) &&
          CAPABILITY_SOURCES[cap].indexOf(source) !== -1) {
        return cap;
      }
    }
    return null;   // an unknown adapter maps to no connector tab (honest null)
  }

  /* ---- the projection ------------------------------------------------------ *
   * projectConnectorItems(capability, provenanceItems) ->                       *
   *   { capability, sources, items: [{ itemId, name, category, source }],       *
   *     count, categories: [{ category, count }] }                              *
   * `provenanceItems` is the K1-safe list from GET /projection/soil (or the     *
   * Catch's listProvenance()). Content-free by construction — see K1 above.     */
  function projectConnectorItems(capability, provenanceItems) {
    var srcs = sourcesForCapability(capability);
    var rows = Array.isArray(provenanceItems) ? provenanceItems : [];

    var items = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || {};
      if (srcs.indexOf(r.source) === -1) continue;          // not this connector's
      items.push({                                          // PICK fields — never spread (K1)
        itemId: r.itemId != null ? String(r.itemId) : null,
        name: r.name != null ? String(r.name) : null,
        category: r.category != null ? String(r.category) : null,
        source: String(r.source),
        // Real ingestion stamp (ISO-8601) when the row carries one; null otherwise
        // (flag-don't-fake — an undated row is never handed a fabricated time).
        // An absent OR empty stamp is "no real claim" -> null (not a false, very-old
        // timestamp): "" would otherwise sort as older-than-any-date, a fabrication.
        ingestedAt: (r.ingested_at != null && String(r.ingested_at) !== "") ? String(r.ingested_at) : null
      });
    }

    // Order: category asc (uncategorized/null last), then RECENCY within the
    // category — newest ingestedAt first — then name asc, then itemId. Keeping
    // category primary means the sections stay contiguous, so the grouped view
    // below is unchanged in shape; recency lives WITHIN each section.
    // flag-don't-fake: an undated row (ingestedAt null) makes no recency claim,
    // so it sorts AFTER every dated row in its category — never given a time.
    items.sort(function (a, b) {
      // 1) category asc, uncategorized/null last
      var ca = a.category === null ? "\uffff" : a.category;
      var cb = b.category === null ? "\uffff" : b.category;
      if (ca !== cb) return ca < cb ? -1 : 1;
      // 2) recency DESC — newest first; undated (null) sorts last in the category
      var da = a.ingestedAt, db = b.ingestedAt;
      if (da !== db) {
        if (da === null) return 1;                 // a undated -> after b
        if (db === null) return -1;                // b undated -> after a
        return da < db ? 1 : -1;                    // ISO-8601 sorts chronologically; reverse for newest-first
      }
      // 3) same-or-both-undated -> name asc (stable, legible)
      var na = a.name === null ? "\uffff" : a.name;
      var nb = b.name === null ? "\uffff" : b.name;
      if (na !== nb) return na < nb ? -1 : 1;
      // 4) final tiebreak on itemId so the order is fully deterministic
      var ia = a.itemId === null ? "" : a.itemId;
      var ib = b.itemId === null ? "" : b.itemId;
      return ia < ib ? -1 : (ia > ib ? 1 : 0);
    });

    // A tiny category census for the pane header ("N in Bills, M in Tax, …").
    var counts = {};
    for (var j = 0; j < items.length; j++) {
      var key = items[j].category === null ? "\u0000uncategorized" : items[j].category;
      counts[key] = (counts[key] || 0) + 1;
    }
    var categories = Object.keys(counts).sort().map(function (k) {
      return { category: k === "\u0000uncategorized" ? null : k, count: counts[k] };
    });

    // A grouped view for a richer pane: contiguous category sections walked off
    // the already-sorted `items`, one group per category (the null-category group
    // lands LAST by the same sort that put null items last). This is a pure
    // re-shape — the group items are the SAME picked objects, so K1 holds
    // unchanged (no field is re-derived, nothing is spread), and the flat count
    // still equals the sum of the group counts (exhaustive: no item dropped).
    var groups = [];
    var cur = null;
    for (var g = 0; g < items.length; g++) {
      var cat = items[g].category;                       // null stays null
      if (cur === null || cur.category !== cat) {         // new run -> new section
        cur = { category: cat, count: 0, items: [] };
        groups.push(cur);
      }
      cur.items.push(items[g]);
      cur.count++;
    }

    return {
      capability: capability,
      sources: srcs,
      items: items,
      count: items.length,
      categories: categories,
      groups: groups
    };
  }

  /* ---- export -------------------------------------------------------------- */
  root.connectorItems = {
    sourcesForCapability: sourcesForCapability,
    capabilityForSource: capabilityForSource,
    projectConnectorItems: projectConnectorItems,
    _capabilitySources: CAPABILITY_SOURCES,
    _version: "1.2"
  };
})();
