/* Shea's Forest — the App Shell · shell/blob-store.js
   D1=a — the SOVEREIGN BLOB STORE. A Forest sidecar for binary blobs (the first
   tenant is the contact/owner PHOTO), living OUTSIDE the byte-frozen loopcontact.js.
   loopcontact.js never learns about photos; the blob lives here, and view-config's
   ownerProfile.photo holds only a small REFERENCE ({key, mime}) into this store —
   never the blob itself (a base64 photo in view-config's localStorage JSON would
   bloat the whole config past the localStorage ceiling; that separation is the
   entire reason this sidecar exists).

   Swappable backend — a thin facade over a backend, exactly like view-config-store.
   put()/get()/delete() ALL return Promises so a browser-async backend (IndexedDB)
   and a server-async one (a runtime route) share ONE interface. Pointing the store
   at a different backend is a drop-in; no caller changes.

   Three backends ship:
     • idbBackend (V1, working) — IndexedDB, the correct CLIENT primitive for blobs
       (localStorage is string-only and size-capped; IndexedDB holds Blobs natively).
       Per-browser: the blob lives in ONE browser and does not sync across devices.
       This is the operator's own machine — sovereign at rest by default.
     • runtimeBlobBackend (the SOVEREIGN-ACROSS-DEVICES option, structure ready) —
       persists the blob server-side under the owner's Warrant, consistent with the
       Forest data-sovereignty thesis: the photo survives the browser and syncs. The
       one server piece to add when chosen is the runtime route
       (GET/PUT/DELETE <runtime>/blob/:key). Deferred — the forest-sovereign-store
       project's charter explicitly leaves blob-storage policy OUT of its v1 and says
       "measure before scoping," so V1 ships client-side and this backend waits.
     • memoryBackend — an in-process Map. Used by tests, and the cold-safe fallback
       when IndexedDB is unavailable (private-mode lockouts, an ancient engine) so a
       missing IndexedDB degrades to a working-but-non-durable store rather than a
       throw that breaks the boot.

   The default store uses IndexedDB (V1). Swapping to sovereign cross-device
   persistence is one line: makeBlobStore(runtimeBlobBackend()).

   Real-or-Made (Creed): this store only ever holds a GENUINE blob the caller hands
   it — a real photo the operator uploaded. It never generates, guesses, or
   synthesizes an image. The forbidden thing is a fabricated face; a real upload is
   the opposite of fabrication. The store is a dumb byte bucket by design; the
   Real-or-Made discipline lives at the caller (the owner-card upload) which only
   ever feeds it a user-picked File.

   Plain script (no ES module) — attaches to window.ForestShell.blobStore. No DOM. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});
  var DB = "forest.blobs.v1";
  var STORE = "blobs";

  /* ---- memory backend (tests + cold-safe fallback) -------------------------- *
   * An in-process Map. get() of an absent key returns null (NOT an error) — a     *
   * genuine "no blob here", distinct from a backend that could-not-read (which    *
   * rejects). Never throws.                                                       */
  function memoryBackend(opts) {
    opts = opts || {};
    var mem = opts.map || {};
    return {
      name: "memory",
      put: function (key, blob) { mem[key] = blob; return Promise.resolve(true); },
      get: function (key) {
        return Promise.resolve(Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null);
      },
      remove: function (key) { delete mem[key]; return Promise.resolve(true); },
      _peek: function (key) { return mem[key]; }
    };
  }

  /* ---- IndexedDB backend (V1) ---------------------------------------------- *
   * The client primitive for blobs. Injectable factory (opts.idb) so it is       *
   * testable with a fake-indexeddb without touching this code, and cold-safe:     *
   * if no IndexedDB is present the backend is unavailable() and the store falls   *
   * back to memory rather than throwing. get() of an absent key -> null; a store  *
   * that cannot be opened -> a rejected Promise (could-not-read, never a silent   *
   * null that would let the caller treat a broken store as "no photo").          */
  function idbBackend(opts) {
    opts = opts || {};
    var idb = opts.idb || (typeof indexedDB !== "undefined" ? indexedDB : null);
    var dbName = opts.db || DB;
    var storeName = opts.store || STORE;

    function open() {
      return new Promise(function (resolve, reject) {
        if (!idb) { reject(new Error("no indexedDB")); return; }
        var req;
        try { req = idb.open(dbName, 1); } catch (e) { reject(e); return; }
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error("idb open error")); };
      });
    }
    // wantResult=true resolves the request's .result (undefined for an absent get,
    // mapped to null by the caller); wantResult falsy resolves true (put/delete have
    // no meaningful result and must NOT let an undefined result collapse to true-vs-value).
    function tx(mode, fn, wantResult) {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var t = db.transaction(storeName, mode);
          var os = t.objectStore(storeName);
          var req = fn(os);
          t.oncomplete = function () { resolve(wantResult ? (req ? req.result : undefined) : true); };
          t.onerror = function () { reject(t.error || new Error("idb tx error")); };
          t.onabort = function () { reject(t.error || new Error("idb tx abort")); };
        });
      });
    }
    return {
      name: "indexedDB",
      available: function () { return !!idb; },
      put: function (key, blob) { return tx("readwrite", function (os) { os.put(blob, key); }); },
      get: function (key) {
        return tx("readonly", function (os) { return os.get(key); }, true).then(function (v) {
          return v === undefined ? null : v;   // absent key -> null, never undefined
        });
      },
      remove: function (key) { return tx("readwrite", function (os) { os.delete(key); }); }
    };
  }

  /* ---- runtime-endpoint backend (the SOVEREIGN-across-devices option) ------- *
   * Persists the blob server-side under the owner's Warrant. Fully structured;    *
   * needs the runtime route GET/PUT/DELETE <RT>/blob/:key on the box to go live.   *
   * Injectable url/fetch so it is testable with a mock, and cold-safe without a    *
   * fetch (rejects rather than throwing). Deferred for V1 — see the header.        */
  function runtimeBlobBackend(opts) {
    opts = opts || {};
    var RT = opts.runtimeBase || (root.runtimeBase || (typeof window !== "undefined" && window.FOREST_RUNTIME) || "");
    var base = opts.url || ((RT || "") + "/blob/");
    var fetchImpl = opts.fetch || (typeof fetch === "function" ? fetch : null);
    function u(key) { return base + encodeURIComponent(key); }
    return {
      name: "runtime",
      available: function () { return !!fetchImpl; },
      put: function (key, blob) {
        if (!fetchImpl) return Promise.reject(new Error("no fetch"));
        return fetchImpl(u(key), { method: "PUT", credentials: "include", body: blob })
          .then(function (r) { if (!(r && r.ok)) throw new Error("blob put non-2xx"); return true; });
      },
      get: function (key) {
        if (!fetchImpl) return Promise.reject(new Error("no fetch"));
        return fetchImpl(u(key), { cache: "no-store", credentials: "include" })
          .then(function (r) {
            if (r && r.status === 404) return null;             // genuinely no blob
            if (!(r && r.ok)) throw new Error("blob get non-2xx");  // server down/gated -> could-not-read
            return r.blob ? r.blob() : null;
          });
      },
      remove: function (key) {
        if (!fetchImpl) return Promise.reject(new Error("no fetch"));
        return fetchImpl(u(key), { method: "DELETE", credentials: "include" })
          .then(function (r) { return !!(r && r.ok); });
      }
    };
  }

  /* ---- the store: a thin facade over a backend ------------------------------ *
   * put(key, blob) -> Promise<boolean|key>, get(key) -> Promise<blob|null>,        *
   * remove(key) -> Promise<boolean>. keyFor() mints a namespaced key so tenants    *
   * (owner photo, later contact photos) never collide. The facade adds the         *
   * cold-safe fallback: if the chosen backend is unavailable(), it swaps to        *
   * memory so a caller never has to branch on "is IndexedDB here?".                */
  function makeBlobStore(backend) {
    backend = backend || defaultBackend();
    if (typeof backend.available === "function" && !backend.available()) backend = memoryBackend();
    return {
      backendName: backend.name,
      keyFor: function (tenant, id) { return String(tenant || "blob") + ":" + String(id || "default"); },
      put: function (key, blob) { return Promise.resolve(backend.put(key, blob)); },
      get: function (key) { return Promise.resolve(backend.get(key)); },
      remove: function (key) { return Promise.resolve(backend.remove(key)); }
    };
  }

  function defaultBackend() {
    var idb = idbBackend();
    return idb.available() ? idb : memoryBackend();
  }
  function defaultBlobStore() { return makeBlobStore(defaultBackend()); }

  /* ---- export --------------------------------------------------------------- */
  root.blobStore = {
    memoryBackend: memoryBackend,
    idbBackend: idbBackend,
    runtimeBlobBackend: runtimeBlobBackend,
    makeBlobStore: makeBlobStore,
    defaultBlobStore: defaultBlobStore,
    DB: DB,
    STORE: STORE,
    _version: "1.0"
  };
})();
