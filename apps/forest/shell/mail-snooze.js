/* Shea's Forest — the App Shell · shell/mail-snooze.js
   SNOOZE / RE-SURFACE — email-app #12 (the email-views line · the render layer).

   THE CALM FORM (Wren's constraint: re-surface, NEVER a badge). Snooze hides a
   conversation from the list until a chosen time, then lets it come back on its own —
   silently. There is no count, no notification, no red dot: a snoozed item is simply
   out of sight until it is due, and when it is due it re-appears in the normal list as
   if it had never left. The whole feature is the ABSENCE of noise, by design.

   THE STORE. A local map { id -> resurfaceAt (ms epoch) } over any message with an id
   (gmail or mbox-archived — no Gmail grant, like read-later). It draws no new data and
   changes no model: it PERSISTS a small blob and offers pure list-overlay reads. The
   auto-resurface is dueClear(now): entries whose time has passed simply LEAVE the store,
   so the item re-appears in the ordinary list with nothing to dismiss.

   PERSISTENCE — the shell's own store idiom (mirrors mail-saved-searches.js /
   view-config-store.js). A thin facade over a swappable backend:
     • localStorageBackend (V1, working, SYNC) — per-browser, ships now. The hide/only
       overlays run at paint() time and need the map synchronously, so V1 is sync
       (localStorage is sync under the hood — no Promise wrapper).
     • runtimeBackend (the SOVEREIGN option) — persists server-side under the owner's
       Warrant (survives the browser, syncs across devices). STRUCTURE-READY / DEFERRED —
       the exact state saved-searches' runtime backend sits in: it needs the runtime route
       GET/PUT/DELETE <RT>/mail-snooze AND an async load-then-populate wire (the sync
       overlay becomes an async refresh at that swap). Named here so the swap is a known
       follow-on, not a rebuild. NOT wired in V1.

   READ-ONLY on the mail model (the email-views Joint Contract): this file lives in the
   render layer. It never touches the parity-twin model, the runtime, or the renderer's
   exports — it self-registers on window.ForestShell and its overlay is read at one call
   site in buildMailboxView's paint(), exactly like the spam / from / saved overlays.

   Plain script (no ES module, no deps) — attaches to window.ForestShell.mailSnooze.
   Cold-safe throughout: a corrupt / unavailable store reads as an empty map (honest),
   never a throw that breaks the boot; bad input -> false / no-op, never an exception. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});
  var KEY = "forest.mail.snooze.v1";
  var HOUR = 3600 * 1000, DAY = 24 * HOUR;

  /* ---- localStorage backend (V1, SYNC) -------------------------------------- *
   * Reads / writes a JSON object { id: resurfaceAtMs }. A corrupt or missing blob  *
   * reads as {} (honest empty), never a throw. Injectable storage for tests.       */
  function localStorageBackend(opts) {
    opts = opts || {};
    var key = opts.key || KEY;
    var ls = opts.storage || (typeof window !== "undefined" ? window.localStorage : null);
    return {
      name: "localStorage",
      read: function () {
        try {
          if (!ls) return {};
          var raw = ls.getItem(key);
          var obj = raw ? JSON.parse(raw) : {};
          return (obj && typeof obj === "object" && !Array.isArray(obj)) ? obj : {};
        } catch (e) { return {}; }
      },
      write: function (map) {
        try { if (!ls) return false; ls.setItem(key, JSON.stringify(map || {})); return true; }
        catch (e) { return false; }
      },
      clear: function () { try { if (ls) ls.removeItem(key); return true; } catch (e) { return false; } }
    };
  }

  /* ---- runtime-endpoint backend (the SOVEREIGN option — STRUCTURE-READY) ----- *
   * Deferred, exactly like saved-searches' runtime backend: it needs the runtime    *
   * route on the box AND an async load-then-populate wire in the renderer (the sync  *
   * V1 overlay becomes an async refresh at the swap). Kept here so the swap is a     *
   * one-module change with a documented route, not a rebuild. NOT wired in V1.       */
  function runtimeBackend(opts) {
    opts = opts || {};
    var RT = opts.runtimeBase || (root.runtimeBase || (typeof window !== "undefined" && window.FOREST_RUNTIME) || "");
    var url = opts.url || ((RT || "") + "/mail-snooze");
    var fetchImpl = opts.fetch || (typeof fetch === "function" ? fetch : null);
    return {
      name: "runtime", async: true, url: url,
      read: function () {
        if (!fetchImpl) return Promise.resolve({});
        return fetchImpl(url, { cache: "no-store", credentials: "include" })
          .then(function (r) { return r && r.ok ? r.json() : {}; }).catch(function () { return {}; });
      },
      write: function (map) {
        if (!fetchImpl) return Promise.resolve(false);
        return fetchImpl(url, { method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify(map || {}) })
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
   * V1 uses the sync localStorage backend. The map is { id -> resurfaceAtMs }.      *
   * snooze(id, at) refuses a blank id or a non-finite/past-or-now time (honest —    *
   * you cannot snooze nothing, and a time that is already due is not a snooze).      */
  function makeStore(backend) {
    backend = backend || localStorageBackend();
    function clean(obj) {
      var out = {};
      Object.keys(obj || {}).forEach(function (id) {
        var at = obj[id];
        if (id && typeof at === "number" && isFinite(at)) out[String(id)] = at;   // drop corrupt rows
      });
      return out;
    }
    return {
      backendName: backend.name,
      // map() -> { id: resurfaceAtMs } (sync V1), cleaned of corrupt rows.
      map: function () { return clean(backend.read()); },
      // snooze(id, untilMs[, now]) -> true on write. A blank id, a non-number time, or a
      // time that is NOT strictly in the future (<= now) is refused (false). `now` defaults
      // to Date.now() (production); tests inject a fixed clock.
      snooze: function (id, untilMs, now) {
        var i = String(id == null ? "" : id).trim();
        if (i === "") return false;
        var t = (typeof now === "number" && isFinite(now)) ? now : Date.now();
        if (typeof untilMs !== "number" || !isFinite(untilMs) || untilMs <= t) return false;
        var m = this.map(); m[i] = untilMs; return backend.write(m);
      },
      // unsnooze(id) -> true (idempotent — absent id is still a clean write).
      unsnooze: function (id) {
        var i = String(id == null ? "" : id).trim();
        if (i === "") return false;
        var m = this.map(); if (Object.prototype.hasOwnProperty.call(m, i)) delete m[i];
        return backend.write(m);
      },
      // snoozedUntil(id) -> the resurface ms, or null if not snoozed.
      snoozedUntil: function (id) {
        var i = String(id == null ? "" : id).trim();
        var m = this.map(); return Object.prototype.hasOwnProperty.call(m, i) ? m[i] : null;
      },
      // dueClear(now) -> the AUTO-RESURFACE: drop every entry whose time has passed
      // (at <= now). Returns the array of ids cleared (silent — no badge, no notice).
      // Idempotent: a second call clears nothing. Only writes when something changed.
      dueClear: function (now) {
        var t = (typeof now === "number" && isFinite(now)) ? now : Date.now();
        var m = this.map(), cleared = [];
        Object.keys(m).forEach(function (id) { if (m[id] <= t) { cleared.push(id); delete m[id]; } });
        if (cleared.length) backend.write(m);
        return cleared;
      },
      clear: function () { return backend.clear(); }
    };
  }

  var _default = makeStore(localStorageBackend());

  /* ---- list overlays (pure — the render-layer reads these) ------------------- *
   * `store` is optional (defaults to the module store); tests inject a mock store.  *
   * An item is ACTIVELY snoozed when it has an id, a future resurface time (> now),  *
   * and is present in the list in hand. These reads NEVER mutate the store; the      *
   * caller runs dueClear(now) once per paint to auto-resurface due items.            */
  function activeIds(now, store) {
    store = store || _default;
    var t = (typeof now === "number" && isFinite(now)) ? now : Date.now();
    var m = store.map(), out = {};
    Object.keys(m).forEach(function (id) { if (m[id] > t) out[id] = true; });
    return out;   // a set { id: true } of still-snoozed ids
  }
  // hide(list, now) -> the list with actively-snoozed items REMOVED (the default view).
  function hide(list, now, store) {
    var set = activeIds(now, store);
    return (list || []).filter(function (m) { return !(m && m.id && set[String(m.id)]); });
  }
  // only(list, now) -> the actively-snoozed subset PRESENT in this list (the Snoozed view).
  function only(list, now, store) {
    var set = activeIds(now, store);
    return (list || []).filter(function (m) { return !!(m && m.id && set[String(m.id)]); });
  }
  // count(list, now) -> how many actively-snoozed items are present here (present-gate the
  // Snoozed view-word — never offer an always-empty view).
  function count(list, now, store) { return only(list, now, store).length; }

  /* ---- calm presets (deterministic given `now`) ----------------------------- *
   * The snooze picker's default choices. All strictly in the future given now, in    *
   * ascending order. Wall-times computed from a local Date(now); tests assert         *
   * ordering + future-ness (TZ-agnostic), not exact clock values. A custom ms time    *
   * bypasses these entirely via store.snooze(id, ms).                                 */
  function presets(now) {
    var t = (typeof now === "number" && isFinite(now)) ? now : Date.now();
    var d = new Date(t);
    // Later today: +3h (a short calm defer).
    var later = t + 3 * HOUR;
    // Tomorrow morning: next day at 08:00 local.
    var tm = new Date(t); tm.setDate(d.getDate() + 1); tm.setHours(8, 0, 0, 0);
    // This weekend: the coming Saturday 08:00 local (if today is Sat/Sun, next Saturday).
    var wk = new Date(t); var dow = d.getDay(); var addSat = (6 - dow + 7) % 7; if (addSat === 0) addSat = 7;
    wk.setDate(d.getDate() + addSat); wk.setHours(8, 0, 0, 0);
    // Next week: the coming Monday 08:00 local.
    var nx = new Date(t); var addMon = (1 - dow + 7) % 7; if (addMon === 0) addMon = 7;
    nx.setDate(d.getDate() + addMon); nx.setHours(8, 0, 0, 0);
    var choices = [
      { key: "later",   label: "Later today",  at: later },
      { key: "tomorrow", label: "Tomorrow",     at: tm.getTime() },
      { key: "weekend", label: "This weekend",  at: wk.getTime() },
      { key: "nextweek", label: "Next week",    at: nx.getTime() }
    ].filter(function (p) { return p.at > t; });      // honest: only future choices
    // Guarantee ASCENDING + DISTINCT: depending on the weekday, "Tomorrow" / "This weekend" /
    // "Next week" can resolve to the same morning (e.g. a Sunday makes Tomorrow == Next week).
    // Sort by time and drop any choice that lands on an already-offered moment — showing one
    // calm choice per distinct time is honest; a duplicated time is noise.
    choices.sort(function (a, b) { return a.at - b.at; });
    var out = [], seenAt = {};
    choices.forEach(function (p) { if (!seenAt[p.at]) { seenAt[p.at] = true; out.push(p); } });
    return out;
  }

  root.mailSnooze = {
    localStorageBackend: localStorageBackend,
    runtimeBackend: runtimeBackend,
    makeStore: makeStore,
    defaultStore: function () { return _default; },
    KEY: KEY,
    // convenience: the default-store methods, so the renderer can call directly.
    snooze: function (id, at, now) { return _default.snooze(id, at, now); },
    unsnooze: function (id) { return _default.unsnooze(id); },
    snoozedUntil: function (id) { return _default.snoozedUntil(id); },
    dueClear: function (now) { return _default.dueClear(now); },
    clear: function () { return _default.clear(); },
    // the list overlays (accept an injected store for tests via the trailing arg).
    activeIds: activeIds,
    hide: hide,
    only: only,
    count: count,
    presets: presets,
    _version: "1.0"
  };
})();
