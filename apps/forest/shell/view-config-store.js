/* Shea's Forest — the App Shell · shell/view-config-store.js
   STEP 4's gating dependency: the per-user view-config STORE. The shell modules
   (view-config, tab-strip, pane) are pure read-and-emit folds by design — none of
   them persists. This is the WRITE side: it loads the saved view-config and saves
   it back, so a user's tabs (pinned, ordered, opened, closed) survive a reload.

   Swappable backend — the store is a thin facade over a backend, and load()/save()
   BOTH return Promises so a synchronous backend (localStorage) and an asynchronous
   one (a runtime endpoint) share ONE interface. Pointing the store at a different
   backend is a drop-in; no caller changes.

   Two backends ship:
     • localStorageBackend (V1, working) — per-browser, no runtime work, ships now.
       Simple, but the config lives in ONE browser (it does not sync or survive a
       device change).
     • runtimeBackend (the SOVEREIGN option, structure ready) — persists the config
       server-side under the owner's Warrant, consistent with Forest's data-
       sovereignty thesis: the config survives the browser, syncs across devices,
       and lives under the owner's control. The one server piece to add when chosen
       is the runtime route (GET/PUT/DELETE <runtime>/view-config).

   The default store uses localStorage (V1). Swapping to sovereign persistence is
   one line: makeStore(runtimeBackend()).

   Pure-ish module: no DOM. Plain script (no ES module) — attaches to
   window.ForestShell.viewConfigStore. Depends on .viewConfig for normalization. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});
  var KEY = "forest.viewConfig.v1";

  /* ---- localStorage backend (V1) -------------------------------------------- *
   * Sync under the hood; the store wraps its returns in Promises so the caller    *
   * interface is uniform with the async runtime backend. load() returns a         *
   * TRI-STATE result — {status:'found',config} | {status:'empty'} | {status:      *
   * 'error'} — and NEVER a bare null that collapses "no config saved" and "could   *
   * not read the store". An unreachable store or a corrupt/unparseable blob is an  *
   * ERROR (do not treat it as a genuine first run and seed over it); a truly       *
   * absent key is EMPTY. Never a throw that breaks the boot.                       */
  function localStorageBackend(opts) {
    opts = opts || {};
    var key = opts.key || KEY;
    var ls = opts.storage || (typeof window !== "undefined" ? window.localStorage : null);
    return {
      name: "localStorage",
      load: function () {
        try {
          if (!ls) return { status: "error" };                 // no store -> could-not-read, NOT empty
          var raw = ls.getItem(key);
          if (raw == null) return { status: "empty" };          // genuinely nothing saved (first run)
          return { status: "found", config: JSON.parse(raw) };  // a saved config, honored exactly
        } catch (e) { return { status: "error" }; }             // corrupt/unparseable -> error, never a seed-over
      },
      save: function (config) {
        try { if (!ls) return false; ls.setItem(key, JSON.stringify(config)); return true; }
        catch (e) { return false; }
      },
      clear: function () { try { if (ls) ls.removeItem(key); return true; } catch (e) { return false; } }
    };
  }

  /* ---- runtime-endpoint backend (the SOVEREIGN option, ready to wire) -------- *
   * Persists the config server-side under the owner's Warrant. Fully structured;  *
   * needs the runtime route GET/PUT/DELETE <RT>/view-config on the box to go live. *
   * Injectable url/fetch so it is testable with a mock, and cold-safe without a    *
   * fetch (returns null/false rather than throwing).                              */
  function runtimeBackend(opts) {
    opts = opts || {};
    var RT = opts.runtimeBase || (root.runtimeBase || (typeof window !== "undefined" && window.FOREST_RUNTIME) || "");
    var url = opts.url || ((RT || "") + "/view-config");
    var fetchImpl = opts.fetch || (typeof fetch === "function" ? fetch : null);
    return {
      name: "runtime",
      load: function () {
        // TRI-STATE (the whole point of leg 01): a non-2xx, a network reject, or a
        // timeout is an ERROR — it must NEVER masquerade as "no config saved". Only a
        // 2xx with an absent body is EMPTY (a genuine first run). A 2xx carrying a
        // config — even {tabs:[]} — is FOUND and honored exactly.
        if (!fetchImpl) return Promise.resolve({ status: "error" });   // no fetch -> could-not-read, NOT empty
        return fetchImpl(url, { cache: "no-store", credentials: "include" })
          .then(function (r) {
            if (!r || !r.ok) return { status: "error" };               // non-2xx -> error (server down / gated)
            return Promise.resolve(r.json())
              .then(function (body) {
                return body == null ? { status: "empty" } : { status: "found", config: body };
              })
              .catch(function () { return { status: "error" }; });     // 2xx but unparseable body -> error
          })
          .catch(function () { return { status: "error" }; });         // network reject / timeout -> error
      },
      save: function (config) {
        if (!fetchImpl) return Promise.resolve(false);
        return fetchImpl(url, {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config)
        }).then(function (r) { return !!(r && r.ok); }).catch(function () { return false; });
      },
      clear: function () {
        if (!fetchImpl) return Promise.resolve(false);
        return fetchImpl(url, { method: "DELETE", credentials: "include" })
          .then(function (r) { return !!(r && r.ok); }).catch(function () { return false; });
      }
    };
  }

  /* ---- the store: a thin facade over a backend ------------------------------ *
   * Normalizes every config through viewConfig on the way in and out so a stored  *
   * blob is always a well-formed view-config. load() -> Promise<TRI-STATE>:        *
   * {status:'found',config} | {status:'empty'} | {status:'error'}. The facade      *
   * norms only the FOUND config and passes empty/error through untouched, so the   *
   * "server down" signal is never laundered into "no config" by the store either.  *
   * save(config) -> Promise<boolean>, clear() -> Promise<boolean>.                 */
  function makeStore(backend) {
    backend = backend || localStorageBackend();
    function norm(c) {
      var vc = root.viewConfig;
      return vc ? vc.normalize(c) : (c || { tabs: [], badges: { enabled: false } });
    }
    return {
      backendName: backend.name,
      load: function () {
        return Promise.resolve(backend.load()).then(function (res) {
          if (res && res.status === "found") return { status: "found", config: norm(res.config) };
          if (res && res.status === "empty") return { status: "empty" };
          return { status: "error" };   // any error/unknown backend result -> error (never a bare null)
        });
      },
      save: function (config) {
        return Promise.resolve(backend.save(norm(config)));
      },
      clear: function () { return Promise.resolve(backend.clear()); }
    };
  }

  // The default store = localStorage backend (V1). The boot uses this. Swap to
  // sovereign persistence with makeStore(runtimeBackend()).
  function defaultStore() { return makeStore(localStorageBackend()); }

  /* ---- export --------------------------------------------------------------- */
  root.viewConfigStore = {
    localStorageBackend: localStorageBackend,
    runtimeBackend: runtimeBackend,
    makeStore: makeStore,
    defaultStore: defaultStore,
    KEY: KEY,
    _version: "1.1"
  };
})();
