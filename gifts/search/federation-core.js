/* Loop Search — the FEDERATION CORE · shell/federation-core.js
   THE GENESIS MODULE (loop-search arc, slot 01 — extract-core, S28.2007).

   ─────────────────────────────────────────────────────────────────────────────
   WHAT THIS IS, AND WHY IT WAS EXTRACTED
   ─────────────────────────────────────────────────────────────────────────────
   This is the pure, DOM-free, store-agnostic FEDERATION ENGINE lifted out of the
   Forest's shell/search-federation.js (forest-search line, 5/5, gate e819423c0).
   The Forest's search was never a search engine — it is a FEDERATION model over N
   heterogeneous stores with injected fetchers. That engine is reusable ANYWHERE a
   surface has stores to federate; the store-set, the store shapes, and the
   commensurability are the only things that change per mount. So the engine moves
   here, and each surface (the Forest, loopmmt.com, any future mount) supplies an
   ADAPTER — a config object the engine consumes. The Forest re-adopts this core as
   one adapter with behaviour preserved; its green suite IS the proof (SL-1 conform).

   ─────────────────────────────────────────────────────────────────────────────
   THE §2 GENERALIZATION — RANKING HONESTY IS A FUNCTION OF COMMENSURABILITY
   ─────────────────────────────────────────────────────────────────────────────
   The Forest hard-coded one pole of one parameter. The insight the Forest earned
   (R1 below) is a FORMAL one, not a UI taste:

     Heterogeneous stores cannot be honestly blended into one rank. A Gmail
     relevance score, an FTS5 rank and a date match are not the same quantity; any
     single blended number across them is a lie with a receipt on it. And a contact
     HAS NO DATE, so group-by-time cannot even place a third of the corpus. So for
     INCOMMENSURABLE stores, group-by-source is FORCED, not chosen.

   But that force is CONDITIONAL on incommensurability. If a mount's stores share a
   sort key — every loopmmt.com corpus node has title·words·tokens·coverage, a
   shared shape — then a single honest rank IS available, and refusing to give one
   would be its own dishonesty (hiding a real ordering behind fake groups).

   So the engine parameterizes the one thing the Forest fixed:

     mode: "grouped"  → INCOMMENSURABLE stores. Group-by-source, latency-filled,
                        never blended. (The Forest's forced, proven behaviour.)
     mode: "ranked"   → COMMENSURABLE stores. One honest rank across all stores,
                        sorted by a shared rankKey, emitted whole (a cross-store
                        rank cannot be honestly emitted partial — it must wait for
                        the slowest store, R2's own logic run the other direction).

   This is the WHOLE generalization: same core, the adapter's declared
   commensurability decides the shape. The commensurability flag is the DECIDABLE
   PROXY for "can the substrate support a blend?" — see the §2 Formalize record
   (loop-search-federation-commensurability-formalize): the claim is IN-SPAN of the
   honest-representation invariant (Real-or-Made / Equalization) under Recursion —
   a recognition, not a new drive.

   ─────────────────────────────────────────────────────────────────────────────
   THE RULINGS THE ENGINE ENCODES (inherited verbatim from the Forest model)
   ─────────────────────────────────────────────────────────────────────────────
   R1 · No cross-store rank is invented (grouped mode). In ranked mode the rank is
        honest BECAUSE the stores are commensurable — the adapter asserts it.
   R2 · Group order is LATENCY ORDER (grouped) — spine order is arrival order, so
        the list fills DOWNWARD and never reflows above the eye. In ranked mode this
        inverts: a single rank must wait for the slowest store, so it is emitted whole.
   R3 · A store we could not read SAYS SO. It never renders zero. error ≠ empty ≠ idle.
        empty = we looked and found none. idle = we did not look. error = we could not.
   T  · TOTALITY. A synchronously-throwing fetcher cannot take the surface down —
        settle() try/catches the CALL before any promise exists (the weather.js M11 bug).

   ─────────────────────────────────────────────────────────────────────────────
   THE ADAPTER CONTRACT (config consumed by createFederation)
   ─────────────────────────────────────────────────────────────────────────────
     {
       spine:     [ { kind, title, local?, sync?, commensurable? } ],  // ordered
       produce:   { <kind>: fn(depsValue, q) -> groups[] },   // for sync:true entries
       normalise: { <kind>: fn(value) -> items[]|null },      // for async fetcher entries
       onValue:   { <kind>: fn(group, rawValue) -> void },    // optional per-store group hook
       minRemoteQ: 2,                                         // remote floor (network gate)
       mode:      "grouped" | "ranked",                       // §2: incommensurable | commensurable
       rankKey:   fn(item) -> number,                         // ranked mode: higher = more relevant
       rankedTitle: "Results"                                 // ranked mode: the single group's title
     }

   spine entry kinds:
     sync:true  → a synchronous LOCAL group-PRODUCER (e.g. a catalog fold). Reads
                  deps[kind] as an object, calls produce[kind](obj, q) -> groups[].
                  Produces 0..N groups. Never settled (no network, cannot throw a promise).
     otherwise  → an async FETCHER. deps[kind] is fn(q)->thenable|value; settled;
                  normalise[kind](value) translates the store's envelope to items
                  (or null = shape unrecognised = error, R3). Produces exactly one group.
       local:true  → runs on ANY non-empty query (below the remote floor). The floor
                     gates the NETWORK, not the box.
       local:false → a REMOTE store; waits for q.length >= minRemoteQ.

   onUpdate(model) fires once per group as it lands (grouped, R2 progressive paint),
   or once with the final rank (ranked). Returns a Promise of the FINAL model.

   Plain script (no ES module) — attaches to window.LoopSearch.federationCore. */
(function () {
  "use strict";

  /* ---- settle(fn, arg) -> Promise -------------------------------------------
     THE TOTALITY GUARD (T). Calls fn INSIDE a try/catch so a synchronously-throwing
     fetcher is captured before any promise exists (the weather.js M11 bug). A
     rejection, a throw, or a non-thenable return all land as a clean {ok:false}.
     There is no path out of this function that rejects. */
  function settle(fn, arg) {
    return new Promise(function (resolve) {
      var out;
      try {
        out = fn(arg);
      } catch (syncThrow) {
        resolve({ ok: false, reason: "threw" });
        return;
      }
      if (!out || typeof out.then !== "function") {
        resolve({ ok: true, value: out });
        return;
      }
      out.then(
        function (v) { resolve({ ok: true, value: v }); },
        function () { resolve({ ok: false, reason: "rejected" }); }
      );
    });
  }

  function emptyGroup(spec, state) {
    return { kind: spec.kind, title: spec.title, state: state || "idle", items: [] };
  }

  /* createFederation(config) -> { search, _spine, _minRemoteQ, _mode } --------
     Binds the adapter config once and returns a search() the surface calls per
     query. The returned search(query, deps, onUpdate) has the EXACT signature the
     Forest model exported, so a Forest adapter can re-export it unchanged. */
  function createFederation(config) {
    var cfg         = config || {};
    var SPINE       = cfg.spine || [];
    var PRODUCE     = cfg.produce || {};
    var NORMALISE   = cfg.normalise || {};
    var ONVALUE     = cfg.onValue || {};
    var MIN_REMOTE_Q = (cfg.minRemoteQ == null) ? 2 : cfg.minRemoteQ;
    var MODE        = (cfg.mode === "ranked") ? "ranked" : "grouped";
    var RANK_KEY    = (typeof cfg.rankKey === "function") ? cfg.rankKey : null;
    var RANKED_TITLE = (cfg.rankedTitle != null) ? String(cfg.rankedTitle) : "Results";

    function search(query, deps, onUpdate) {
      var d = deps || {};
      var q = String(query == null ? "" : query).trim();
      var notify = (typeof onUpdate === "function") ? onUpdate : function () {};

      var model = { query: q, groups: [] };
      var byKind = {};
      var reachRemote = q.length >= MIN_REMOTE_Q;

      SPINE.forEach(function (spec) {
        if (spec.sync) {
          var producer = PRODUCE[spec.kind];
          if (producer) {
            (producer(d[spec.kind], q) || []).forEach(function (g) {
              model.groups.push(g); byKind[g.kind] = g;
            });
          }
          return;
        }
        if (typeof d[spec.kind] !== "function") return;    // store absent -> no group, never a fake one
        // A LOCAL store reaches on ANY non-empty query; a REMOTE one waits for the floor.
        // The floor gates the network, not the box — reachRemote may only ever gate a NON-local store.
        var reaches = spec.local ? !!q : (q && reachRemote);
        var rg = emptyGroup(spec, reaches ? "pending" : "idle");
        model.groups.push(rg); byKind[spec.kind] = rg;
      });

      // THE EMPTY QUERY fires NOTHING. Whatever the sync producers rendered stands; no fetcher runs.
      if (!q) {
        if (MODE === "ranked") collapseRank(model);
        notify(model);
        return Promise.resolve(model);
      }

      notify(model);   // paint the spine: sync producers answered, fetchers honestly pending

      var pending = SPINE.filter(function (s) {
        if (s.sync || !byKind[s.kind]) return false;
        return s.local ? true : reachRemote;               // below the floor, only LOCAL stores run
      });

      var settled = Promise.all(pending.map(function (spec) {
        return settle(d[spec.kind], q).then(function (r) {
          var g = byKind[spec.kind];
          if (!r.ok) {
            g.state = "error";
            g.note  = (r.reason === "threw") ? "Could not reach this store." : "This store did not answer.";
            g.items = [];                                   // R3: NOT zero results
          } else {
            var items = NORMALISE[spec.kind] ? NORMALISE[spec.kind](r.value) : r.value;
            if (items === null || items === undefined) {    // unrecognised envelope -> error, never a silent empty
              g.state = "error";
              g.note  = "This store answered in a shape we do not know.";
              g.items = [];
            } else {
              g.items = items;
              g.state = items.length ? "ok" : "empty";
              if (typeof ONVALUE[spec.kind] === "function") ONVALUE[spec.kind](g, r.value);
            }
          }
          // GROUPED paints each group the moment it lands (R2). RANKED cannot paint a
          // partial cross-store rank honestly (it would reorder), so it waits and paints once.
          if (MODE === "grouped") notify(model);
          return g;
        });
      }));

      return settled.then(function () {
        if (MODE === "ranked") { collapseRank(model); notify(model); }
        return model;
      });
    }

    /* collapseRank(model) — the COMMENSURABLE assembly (§2). Merge every ok fetcher
       group's items into ONE honestly-ranked group, sorted by rankKey DESCENDING with a
       fully DETERMINISTIC tie-break (spine index, then a stable item ordinal), so the
       same inputs always produce the same rank — no hidden state, byte-reproducible.
       error/empty/idle groups are NOT swept into the rank; they are preserved AFTER it so
       R3 survives ranked mode (a store we could not read still says so; it is not a zero). */
    function collapseRank(model) {
      var merged = [];
      var carried = [];        // sync-produced groups + non-ok fetcher groups, preserved as-is
      var ord = 0;
      (model.groups || []).forEach(function (g) {
        var spec = null;
        SPINE.forEach(function (s) { if (s.kind === g.kind) spec = s; });
        var isFetcherOk = spec && !spec.sync && g.state === "ok";
        if (isFetcherOk) {
          (g.items || []).forEach(function (it) {
            merged.push({ item: it, _ord: ord++ });   // _ord increases in spine-group order, then item order
          });
        } else {
          carried.push(g);     // sync groups (catalog/browse) and error/empty stay separate — never blended
        }
      });

      merged.sort(function (a, b) {
        if (RANK_KEY) {
          var ka = Number(RANK_KEY(a.item)); var kb = Number(RANK_KEY(b.item));
          if (!isNaN(ka) || !isNaN(kb)) {
            if (isNaN(ka)) return 1;
            if (isNaN(kb)) return -1;
            if (kb !== ka) return kb - ka;                 // DESCENDING: higher rank first
          }
        }
        // ONE total deterministic tie-break: the arrival ordinal. Because collapseRank walks the
        // groups in SPINE ORDER and each item takes the next ordinal, _ord already encodes
        // "earlier-spine store first, then item order" — no separate spine-index tie-break is needed
        // (a second one would be dead: _ord never ties). Same inputs -> same order, byte-reproducible.
        return a._ord - b._ord;
      });

      var rankItems = merged.map(function (m) { return m.item; });
      var rankGroup = {
        kind: "ranked",
        title: RANKED_TITLE,
        state: rankItems.length ? "ok" : "empty",
        ranked: true,
        items: rankItems
      };
      // Rebuild groups: the single honest rank first, then any carried (browse / error / empty) groups.
      model.groups = [rankGroup].concat(carried);
    }

    return { search: search, _spine: SPINE, _minRemoteQ: MIN_REMOTE_Q, _mode: MODE };
  }

  var api = {
    settle: settle,
    createFederation: createFederation,
    _version: "1.0"
  };

  /* Dual export. Browser (and the test harness that sets global.window): attach the
     API under window.LoopSearch.federationCore. Node: set module.exports to the API
     DIRECTLY (not nested), so `require("./federation-core.js").createFederation` works
     for a pure-node consumer (search-stores.test.js requires this path). */
  if (typeof window !== "undefined") {
    (window.LoopSearch = window.LoopSearch || {}).federationCore = api;
  }
  if (typeof module !== "undefined" && module && module.exports) {
    module.exports = api;
  }
})();
