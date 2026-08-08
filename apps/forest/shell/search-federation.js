/* Shea's Forest — the App Shell · shell/search-federation.js
   THE SEARCH ARC (operator note #6) · the FEDERATION MODEL. Pure logic, no DOM,
   no network of its own — every store is an INJECTED fetcher, so this file is
   fully drivable from a test without a mirror.

   ─────────────────────────────────────────────────────────────────────────────
   WHY THIS FILE IS A MODEL AND NOT A SEARCH ENGINE
   ─────────────────────────────────────────────────────────────────────────────
   All three stores were ALREADY searchable and alive in production before a line
   of this was written ('s Cistern, probed live — 401 = gated-alive):

     mail      GET /projection/mail-search?q=   -> LIVE Gmail. Fuzzy. SLOW.
     contacts  GET /api/contacts/search?q=      -> the tool's FTS5. Precise. Fast.
     calendar  GET /api/events?q=               -> the tool's own event search.
     soil      indexCatalog.buildCatalog()      -> a pure LOCAL fold. No network.

   So site-wide search was never three build problems. It is ONE FEDERATION
   problem: how do four heterogeneous result sets become one list a person can
   act on? That question is what this file answers, and it is the only thing it
   answers.

   ─────────────────────────────────────────────────────────────────────────────
   THE THREE RULINGS THIS MODEL ENCODES (each one closed a fork)
   ─────────────────────────────────────────────────────────────────────────────

   R1 · THERE IS NO CROSS-STORE RANK, AND WE DO NOT INVENT ONE.
        A Gmail relevance score, an FTS5 rank and a date match are not the same
        quantity. Any single blended number across them would be a lie with a
        receipt on it — a RIGHT NUMBER WEARING A WRONG NOUN, the fault class this
        very campaign was bitten by (M11). So results are GROUPED BY
        STORE, each group ranked internally by its own store, and no number is
        ever computed across a group boundary. `group-by-time` was considered and
        is IMPOSSIBLE, not merely worse: A CONTACT HAS NO DATE. It cannot be
        placed on a timeline at all, so a third of the corpus would have no home.

   R2 · GROUP ORDER IS LATENCY ORDER, AND THAT IS WHAT MAKES PROGRESSIVE PAINT CALM.
        soil (instant, local) -> contacts (fast) -> calendar -> mail (slow, live
        Google). Each group paints AS IT LANDS. Because the layout order already
        matches the arrival order, the list fills DOWNWARD and nothing the eye has
        already landed on ever moves. The "honest but jumpy" tradeoff everyone
        assumes here is an artifact of arbitrary group order; order them by latency
        and it evaporates. We do NOT wait for the slowest store — waiting would
        make the two fast local stores feel as slow as Google, for nothing.

   R3 · A STORE WE COULD NOT READ SAYS SO. IT NEVER RENDERS ZERO.
        Inherited verbatim from the 1.34 alarm and the weather laws (L1): a
        reading we do not have renders NOTHING — never a `0`, never an empty list,
        never a stale one. `0 results` means WE LOOKED AND THERE WERE NONE. A
        store that 401'd, timed out, or threw is `error`, and it says which. These
        are different facts and the shell has been bitten before by conflating
        them.

   ─────────────────────────────────────────────────────────────────────────────
   TOTALITY (the bug, and it is not repeated here)
   ─────────────────────────────────────────────────────────────────────────────
   `Promise.resolve(f(q))` DOES NOT CATCH A SYNCHRONOUSLY-THROWING FETCHER — the
   throw escapes before the chain exists. That exact bug shipped in weather.js and
   was caught only by a test that DROVE the throw. So every store call here goes
   through `settle()`, which try/catches the CALL ITSELF before any promise exists.
   The one guarantee this module makes is that it cannot take the shell down, and
   a guarantee that depends on a fetcher behaving is not a guarantee.

   ─────────────────────────────────────────────────────────────────────────────
   THE SHAPE (deliberately the shape index-panel.js ALREADY RENDERS)
   ─────────────────────────────────────────────────────────────────────────────
     { query, groups: [ { kind, title, state, items, note? } ] }

   `state` is one of: "pending" | "ok" | "empty" | "error" | "idle"
   `items` is [ { capability?, label, sub?, added?, hit? } ]

   An item with `capability` and no `hit` is a SOIL item — the panel already knows
   how to render it and it already emits forest:catalog-pick. An item with `hit`
   is a RESULT — it emits forest:search-open. This is why the model emits the
   catalog's own group shape: THE CATALOG MODEL WAS ALREADY THE FEDERATION MODEL.
   `index-catalog.js` emits {groups:[{kind,title,items}]} and has been for months.
   Nothing needed inventing.

   ─────────────────────────────────────────────────────────────────────────────
   THE EMPTY QUERY IS THE CATALOG (the ABSORB ruling, operator delegated AX)
   ─────────────────────────────────────────────────────────────────────────────
   q === "" renders EXACTLY today's app catalog and FIRES NO NETWORK. The search
   button's long-standing job ("the app catalog IS the finder", shell-boot.js:301)
   is not overturned — it becomes the empty-query case of a bigger surface. There
   is no regression surface because the old behaviour is a PROPER SUBSET of the new.

   Plain script (no ES module) — attaches to window.ForestShell.searchFederation. */
(function () {
  "use strict";

  var root = (typeof window !== "undefined")
    ? (window.ForestShell = window.ForestShell || {})
    : (module.exports = {});

  /* ---- group spine ----------------------------------------------------------
     ORDER IS LATENCY ORDER (R2). Do not reorder this array for taste — the
     no-reflow property of the progressive paint is a CONSEQUENCE of it. If a
     store's latency profile ever changes, move it here and the calm follows. */
  /* T2 — THE SPINE GROWS A GROUP, AND THE SPLIT IS THE POINT.
     Until now one slot did two jobs. `catalog` is the BROWSE half — the containers in your Forest
     (apps, groves, trees, horizons, connectors), a pure local fold over names. `soil` is the SEARCH
     half — the CONTENTS of those containers, full-text over the operator's own documents via the
     runtime's in-memory FTS5 index.

     They are different questions and they were sharing one degraded door: "Bills" (the tree) and
     "the letter I filed under Bills" are not the same result and never were. Splitting them is what
     lets browse stay instant and search actually answer.

     `local: true` IS LOAD-BEARING, NOT A LABEL. Both of these run ON THE BOX and fire NO network, so
     they must fire BELOW MIN_REMOTE_Q — at one character, like the catalog always has. The remote
     floor gates GOOGLE, not the machine in the room. Gate the operator's own sovereign search behind
     a rule written to protect him from Google and you have lost the campaign in one line. */
  var SPINE = [
    { kind: "catalog",  title: "Places in your Forest", local: true },  // the CONTAINERS — pure local fold, instant
    { kind: "soil",     title: "Things in your Forest", local: true },  // the CONTENTS  — local FTS5 on the box, fast
    { kind: "contacts", title: "People"                            },   // FTS5, precise, fast
    { kind: "calendar", title: "Events"                            },   // tool search
    { kind: "mail",     title: "Mail"                              }    // LIVE Gmail: fuzzy + slow. Always last.
  ];

  /* T1.8 — the minimum query length before ANY remote store is reached. Below this
     floor the search is purely local (the catalog fold) and fires no network at all.
     Exported so a test can assert the floor rather than trust it. */
  var MIN_REMOTE_Q = 2;

  function emptyGroup(spec, state) {
    return { kind: spec.kind, title: spec.title, state: state || "idle", items: [] };
  }

  /* ---- settle(fn, arg) -> Promise -------------------------------------------
     THE TOTALITY GUARD. Calls fn INSIDE a try/catch so a synchronously-throwing
     fetcher is captured before any promise exists (the weather.js M11 bug). A
     rejection, a throw, or a non-thenable return all land as a clean {ok:false}.
     There is no path out of this function that rejects. */
  function settle(fn, arg) {
    return new Promise(function (resolve) {
      var out;
      try {
        out = fn(arg);
      } catch (syncThrow) {
        resolve({ ok: false, reason: "threw" });          // <- the escape hatch that weather.js did not have
        return;
      }
      if (!out || typeof out.then !== "function") {
        resolve({ ok: true, value: out });                // a synchronous fetcher is legal
        return;
      }
      out.then(
        function (v) { resolve({ ok: true, value: v }); },
        function () { resolve({ ok: false, reason: "rejected" }); }
      );
    });
  }

  /* ---- normalisers ----------------------------------------------------------
     Each store answers in ITS OWN envelope. We translate at the boundary and
     NEVER let a store's shape leak into the panel. A shape we do not recognise
     is `error`, not an empty list (R3) — silence and absence are different facts. */

  /* catalogGroups(catalog, q) -> [ federation group per CATALOG group ] (T1.1,)
     ─────────────────────────────────────────────────────────────────────────────
     THIS REPLACES `soilItems`, WHICH WAS A FORGETFUL FUNCTOR AND THAT WAS THE BUG.

     `index-catalog.buildCatalog()` emits FIVE TYPED GROUPS — app · grove · tree ·
     horizon · connector. The old `soilItems` flattened all five into one array,
     stashed the source group's title in a `sub` the soil render path never renders,
     and handed the panel thirty undifferentiated pills under one heading. The type
     information was computed, carried across ONE function boundary, and dropped on
     the floor. That is the screenshot.

     The header comment above says it plainly and was RIGHT: "the catalog model WAS
     already the federation model." It just wasn't being used as one. `paintGroupsInto`
     has drawn a title per group since STEP 4 — so restoring the structure needs no
     render change at all. We stop throwing it away and the panel draws it for free.

     The catalog's OWN kind + title are the source of truth here. We do not keep a
     second copy of that list (a second copy is how the `start_at` guess shipped).

     EMPTY GROUPS: on a live query, a group with no match is DROPPED — five "Nothing
     here matches." lines is noise, not honesty. If NOTHING in the catalog matches,
     one honest empty group says so. On the empty query every group is kept: that is
     the browse surface, and it is the catalog. */
  function catalogGroups(catalog, q) {
    var needle = String(q || "").toLowerCase();
    var groups = [];
    ((catalog && catalog.groups) || []).forEach(function (g) {
      if (!g) return;
      var items = [];
      ((g.items) || []).forEach(function (it) {
        if (!it || typeof it.capability !== "string") return;
        var label = String(it.label || it.capability);
        if (needle && label.toLowerCase().indexOf(needle) === -1) return;   // local substring — no network, ever
        // NOTE: the item does NOT carry its kind. The GROUP carries it, the panel's
        // `catalog__group--soil-<kind>` class descends onto the pill, and the item's key
        // set stays CLOSED (the M10 contract: a new key is a deliberate act, and the
        // suite fails on it first). A second copy of the type on the item would be the
        // same duplication that produced the `start_at` guess.
        items.push({ capability: it.capability, label: label, added: !!it.added });
      });
      if (needle && !items.length) return;                                  // drop a no-match group on a live query
      groups.push({
        kind:  "soil-" + String(g.kind || "x"),   // CSS-safe: .catalog__group--soil-tree
        title: String(g.title || ""),
        state: items.length ? "ok" : "empty",
        items: items
      });
    });
    // a query that matched nothing local still SAYS SO, once. (R3's spirit: we looked.)
    if (needle && !groups.length) {
      groups.push({ kind: "catalog", title: "Places in your Forest", state: "empty", items: [] });
    }
    return groups;
  }

  function contactItems(v) {
    var rows = (v && (v.contacts || v.results || v.rows)) || null;
    if (!rows || !rows.length) return rows ? [] : null;      // null = shape unrecognised -> error, NOT empty
    return rows.map(function (c) {
      var name = c.display_name || c.name || c.full_name || c.email || "(no name)";
      return { hit: { store: "contacts", id: String(c.id != null ? c.id : "") }, label: String(name), sub: String(c.email || c.primary_email || "") };
    });
  }

  /* THE CALENDAR DATE COLUMN IS `start_at`. Read from the bytes, not guessed:
     internal's event rows carry `start_at` — there is no `start_date`, no
     `starts_at`, no `start`. This normaliser shipped in leg 1 with three plausible names
     and not the real one, and its 33/33 suite stayed green because the FIXTURES CARRIED
     THE GUESS. A boundary tested from the inside is a mirror, not a measurement. The three
     legacy names are kept as tail-fallbacks (harmless, and they cost nothing); `start_at`
     leads because it is the one a live event actually has. */
  function calendarItems(v) {
    var rows = (v && (v.events || v.results || v.rows)) || null;
    if (!rows || !rows.length) return rows ? [] : null;
    return rows.map(function (e) {
      var when = e.start_at || e.start_date || e.start || e.starts_at || "";
      return { hit: { store: "calendar", id: String(e.id != null ? e.id : "") }, label: String(e.title || e.summary || "(untitled event)"), sub: String(when) };
    });
  }

  function mailItems(v) {
    var rows = (v && (v.messages || v.results || v.rows)) || null;
    if (!rows || !rows.length) return rows ? [] : null;
    return rows.map(function (m) {
      return { hit: { store: "mail", id: String(m.id != null ? m.id : "") }, label: String(m.subject || "(no subject)"), sub: String(m.from || m.sender || "") };
    });
  }

  /* soilItems (T2) — the runtime's { items:[{itemId,name,snippet,category}], unindexed } envelope.
     A soil hit carries `snippet`, NOT `sub`. That is a deliberate key difference and the panel keys
     off it: a `sub` is a subtitle (an email address, a date) and gets rendered as plain text; a
     `snippet` is ATTACKER-INFLUENCED CONTENT carrying FTS5's «…» delimiters, and it must be mapped
     to text nodes, never injected as HTML. Same key for both would be one careless innerHTML away
     from an XSS in the operator's own documents. */
  function soilItems(v) {
    var rows = (v && v.items) || null;
    if (!rows || !rows.length) return rows ? [] : null;
    return rows.map(function (it) {
      return {
        hit: { store: "soil", id: String(it.itemId != null ? it.itemId : "") },
        label: String(it.name || "(unnamed)"),
        snippet: String(it.snippet || ""),
        category: it.category == null ? "" : String(it.category)
      };
    });
  }

  var NORMALISE = { soil: soilItems, contacts: contactItems, calendar: calendarItems, mail: mailItems };

  /* ---- search(query, deps, onUpdate) ----------------------------------------
     deps = {
       catalog  : the ALREADY-FOLDED index-catalog object (no network),
       contacts : fn(q) -> thenable|value   (optional; absent -> group omitted)
       calendar : fn(q) -> thenable|value
       mail     : fn(q) -> thenable|value
     }
     onUpdate(model) fires ONCE PER GROUP AS IT LANDS (R2 progressive paint), and
     once immediately with every remote group `pending`, so the panel can paint the
     spine before any network answers. Returns a Promise of the FINAL model — the
     tests await it; the UI does not need to.

     COLD-SAFE: a store with no fetcher injected is simply not in the spine. The
     shell renders search with whatever stores it actually has. */
  function search(query, deps, onUpdate) {
    var d = deps || {};
    var q = String(query == null ? "" : query).trim();
    var notify = (typeof onUpdate === "function") ? onUpdate : function () {};

    // the SOIL groups are always present, always local, always instant.
    var model = { query: q, groups: [] };
    var byKind = {};

    /* T1.8 — THE REMOTE FLOOR. A one-character query does not reach the network.
       Not a performance tweak: `mail` is a LIVE GOOGLE READ (F9). At 180ms debounce
       with no floor, a two-character pause shipped the string to Google's servers —
       on the one surface where a person types their most private intent, in a product
       whose charter is "migrate 100% off external online platforms."

       Below the floor, the remote stores are `idle` — NOT `empty`. That distinction is
       R3 and it is load-bearing: `empty` means WE LOOKED AND THERE WERE NONE; `idle`
       means we did not look. The panel renders an `idle` group as nothing at all. So a
       one-character query gives you the local catalog, filtered, instantly — and zero
       packets. */
    var reachRemote = q.length >= MIN_REMOTE_Q;

    SPINE.forEach(function (spec) {
      if (spec.kind === "catalog") {
        catalogGroups(d.catalog, q).forEach(function (g) {
          model.groups.push(g); byKind[g.kind] = g;
        });
        return;
      }
      if (typeof d[spec.kind] !== "function") return;        // store absent -> no group. Never a fake one.
      // A LOCAL store reaches on ANY non-empty query; a REMOTE one waits for the floor. The floor
      // gates the network, not the box (T1.8's whole reason for existing) — so `reachRemote` may
      // only ever gate a store with `local` false. Read this line before you "unify" it.
      var reaches = spec.local ? !!q : (q && reachRemote);
      var rg = emptyGroup(spec, reaches ? "pending" : "idle");
      model.groups.push(rg); byKind[spec.kind] = rg;
    });

    // THE EMPTY QUERY IS THE CATALOG. No network, no index read. This IS today's behaviour, and it
    // survived T1 and must survive T2: an empty query fires NOTHING.
    if (!q) {
      notify(model);
      return Promise.resolve(model);
    }

    notify(model);   // paint the spine: the catalog already answered, the rest are honestly `pending`

    var pending = SPINE.filter(function (s) {
      if (s.kind === "catalog" || !byKind[s.kind]) return false;
      return s.local ? true : reachRemote;                  // below the floor, only the LOCAL stores run
    });

    return Promise.all(pending.map(function (spec) {
      return settle(d[spec.kind], q).then(function (r) {
        var g = byKind[spec.kind];
        if (!r.ok) {
          g.state = "error";
          g.note  = (r.reason === "threw") ? "Could not reach this store." : "This store did not answer.";
          g.items = [];                                     // R3: NOT zero results. We did not look successfully.
        } else {
          var items = NORMALISE[spec.kind](r.value);
          if (items === null) {                             // unrecognised envelope -> error, never a silent empty
            g.state = "error";
            g.note  = "This store answered in a shape we do not know.";
            g.items = [];
          } else {
            g.items = items;
            g.state = items.length ? "ok" : "empty";
            // T2: the honest floor rides on the GROUP, so the panel can say "N items have no text to
            // search" beside the results rather than quietly pretending the corpus is all text.
            if (spec.kind === "soil" && r.value && r.value.unindexed != null) {
              g.unindexed = Number(r.value.unindexed) || 0;
            }
          }
        }
        notify(model);                                      // paint THIS group the moment it lands
        return g;
      });
    })).then(function () { return model; });
  }

  root.searchFederation = {
    search: search,
    settle: settle,          // exported so the totality guard is directly testable
    catalogGroups: catalogGroups,  // T1.1: the structure-preserving fold, drivable alone
    _spine: SPINE,           // exported so the LATENCY ORDER is directly assertable (R2 is a contract, not a comment)
    _minRemoteQ: MIN_REMOTE_Q,     // T1.8: the remote floor is a CONTRACT, not a comment (F9)
    _version: "1.3"
  };
})();
