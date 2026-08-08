/* Shea's Forest — the App Shell · shell/mail-saved-searches.js
   SAVED SEARCHES — email-app #21 (the email-views line · the render layer).

   THE STORE. A named list of saved search queries over the already-built searchQuery
   (leg #8). It draws no new data and changes no model: it PERSISTS a small blob of
   {name, query} records — the user saves the current search under a name, then re-runs
   it later by picking it. The re-run just sets the search box's value; the existing
   model.searchQuery does the actual matching (this file never searches, it remembers).

   PERSISTENCE — the shell's own store idiom (mirrors view-config-store.js). A thin
   facade over a swappable backend:
     • localStorageBackend (V1, working, SYNC) — per-browser, ships now. The saved
       picker renders at buildMailboxView time and needs the list synchronously, so V1
       is deliberately sync (localStorage is sync under the hood — no Promise wrapper).
     • runtimeBackend (the SOVEREIGN option) — persists server-side under the owner's
       Warrant, consistent with Forest's data-sovereignty thesis (survives the browser,
       syncs across devices). STRUCTURE-READY / DEFERRED — the exact state view-config's
       runtime backend sits in: it needs the runtime route GET/PUT/DELETE <RT>/mail-
       searches AND an async load-then-populate wire (the sync picker becomes an async
       refresh at that swap). Named here so the swap is a known follow-on, not a rebuild.

   READ-ONLY on the mail model (the email-views Joint Contract): this file lives in the
   render layer. It never touches the parity-twin model, the runtime, or the renderer's
   exports — it self-registers on window.ForestShell and its store is read at one call
   site in buildMailboxView (the "Saved" picker + "Save" button), exactly like the
   spam / from overlays are read at their seam.

   Plain script (no ES module, no deps) — attaches to window.ForestShell.mailSavedSearches.
   Cold-safe throughout: a corrupt / unavailable store reads as an empty list (honest),
   never a throw that breaks the boot; bad input -> false, never an exception. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});
  var KEY = "forest.mailSearches.v1";

  /* ---- localStorage backend (V1, SYNC) -------------------------------------- *
   * Reads / writes a JSON array of {name, query} records. A corrupt or missing    *
   * blob reads as [] (honest empty), never a throw. Injectable storage for tests. */
  function localStorageBackend(opts) {
    opts = opts || {};
    var key = opts.key || KEY;
    var ls = opts.storage || (typeof window !== "undefined" ? window.localStorage : null);
    return {
      name: "localStorage",
      read: function () {
        try {
          if (!ls) return [];
          var raw = ls.getItem(key);
          var arr = raw ? JSON.parse(raw) : [];
          return (arr && typeof arr.filter === "function") ? arr : [];
        } catch (e) { return []; }
      },
      write: function (records) {
        try { if (!ls) return false; ls.setItem(key, JSON.stringify(records || [])); return true; }
        catch (e) { return false; }
      },
      clear: function () { try { if (ls) ls.removeItem(key); return true; } catch (e) { return false; } }
    };
  }

  /* ---- runtime-endpoint backend (the SOVEREIGN option — STRUCTURE-READY) ----- *
   * Deferred, exactly like view-config's runtime backend: it needs the runtime     *
   * route on the box AND an async load-then-populate wire in the renderer (the sync *
   * V1 picker becomes an async refresh at the swap). Kept here so the swap is a     *
   * one-module change with a documented route, not a rebuild. NOT wired in V1.      */
  function runtimeBackend(opts) {
    opts = opts || {};
    var RT = opts.runtimeBase || (root.runtimeBase || (typeof window !== "undefined" && window.FOREST_RUNTIME) || "");
    var url = opts.url || ((RT || "") + "/mail-searches");
    var fetchImpl = opts.fetch || (typeof fetch === "function" ? fetch : null);
    // async read()/write()/clear() -> Promises. The renderer wire for this backend is
    // the deferred piece (load-then-populate); the sync V1 store below does not use it.
    return {
      name: "runtime", async: true, url: url,
      read: function () {
        if (!fetchImpl) return Promise.resolve([]);
        return fetchImpl(url, { cache: "no-store", credentials: "include" })
          .then(function (r) { return r && r.ok ? r.json() : []; }).catch(function () { return []; });
      },
      write: function (records) {
        if (!fetchImpl) return Promise.resolve(false);
        return fetchImpl(url, { method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify(records || []) })
          .then(function (r) { return !!(r && r.ok); }).catch(function () { return false; });
      },
      clear: function () {
        if (!fetchImpl) return Promise.resolve(false);
        return fetchImpl(url, { method: "DELETE", credentials: "include" })
          .then(function (r) { return !!(r && r.ok); }).catch(function () { return false; });
      }
    };
  }

  /* ---- the store: a thin SYNC facade over a (sync) backend ------------------- *
   * V1 uses the sync localStorage backend. Every record is {name, query}; save is  *
   * dedup-by-name (re-saving a name overwrites its query). Blank name or query ->   *
   * false (honest — you cannot save a nameless or empty search).                    */
  function makeStore(backend) {
    backend = backend || localStorageBackend();
    function norm(rec) { return { name: String(rec && rec.name != null ? rec.name : "").trim(),
                                  query: String(rec && rec.query != null ? rec.query : "") }; }
    function clean(arr) {
      var out = [], seen = {};
      (arr || []).forEach(function (r) {
        var n = norm(r);
        if (n.name === "") return;                 // drop nameless rows (corrupt / legacy)
        if (Object.prototype.hasOwnProperty.call(seen, n.name)) return; // first wins on read
        seen[n.name] = true; out.push(n);
      });
      return out;
    }
    return {
      backendName: backend.name,
      // list() -> [{name, query}, ...] in saved order (sync V1).
      list: function () { return clean(backend.read()); },
      // names() -> [name, ...] — the picker's options.
      names: function () { return this.list().map(function (r) { return r.name; }); },
      // get(name) -> the saved query string, or null if no such saved search.
      get: function (name) {
        var target = String(name == null ? "" : name).trim();
        if (target === "") return null;
        var hit = this.list().filter(function (r) { return r.name === target; })[0];
        return hit ? hit.query : null;
      },
      // save(name, query) -> true on write. Dedup by name (overwrite the query). A blank
      // name OR a blank query is refused (false) — no nameless / empty saved search.
      save: function (name, query) {
        var n = String(name == null ? "" : name).trim();
        var q = String(query == null ? "" : query).trim();
        if (n === "" || q === "") return false;
        var recs = this.list().filter(function (r) { return r.name !== n; });
        recs.push({ name: n, query: q });
        return backend.write(recs);
      },
      // remove(name) -> true if a row was removed (or the name was absent — idempotent).
      remove: function (name) {
        var n = String(name == null ? "" : name).trim();
        if (n === "") return false;
        var recs = this.list().filter(function (r) { return r.name !== n; });
        return backend.write(recs);
      },
      clear: function () { return backend.clear(); }
    };
  }

  // The default store = sync localStorage backend (V1). The renderer reads this unless a
  // store is injected via buildMailboxView opts.savedSearches (tests inject a mock store).
  function defaultStore() { return makeStore(localStorageBackend()); }

  var _default = defaultStore();

  root.mailSavedSearches = {
    localStorageBackend: localStorageBackend,
    runtimeBackend: runtimeBackend,
    makeStore: makeStore,
    defaultStore: defaultStore,
    KEY: KEY,
    // convenience: the default-store methods, so the renderer can call directly.
    list: function () { return _default.list(); },
    names: function () { return _default.names(); },
    get: function (n) { return _default.get(n); },
    save: function (n, q) { return _default.save(n, q); },
    remove: function (n) { return _default.remove(n); },
    clear: function () { return _default.clear(); },
    _version: "1.0"
  };
})();
