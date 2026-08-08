/* Shea's Forest — the App Shell · shell/badges.js
   STEP 6 of the shell build. See internal §3.6.

   The honest-badge fold — OFF by default + the toggle. This module answers ONE
   question per tab: "what is the calm weather on this capability right now?" and
   returns a plain-data map { capability: word } the tab-strip renders as a small
   dot (shell/tab-strip.js already carries the fold seam + the ink; this feeds it).

   THREE laws it is built to obey (all three are the reason it exists as a fold):

     1. OFF BY DEFAULT. `weatherFor(config, …)` returns {} unless the view-config's
        `badges.enabled` is true — enforced through viewConfig.badgesEnabled, so the
        default (and the resting state) is a bare strip with no dots. The toggle is
        the only thing that turns it on, and it snaps back off nowhere — it persists
        with the view-config like any other user preference.

     2. HONEST — every word binds to REAL already-folded state (Ink Law; the
        Real-or-Made Line). The four calm words (tokens.css: never red, never a
        count — Theo's rule) map to real magnitudes in the projection snapshot:
          • "ok"     ← an ATTESTED connector grant is present (snapshot.connectors).
          • "active" ← the capability is touched by a LIVE edge (snapshot.edges),
                       gated on provenance !== "dummy". Stand-in edges are NEVER
                       presented as activity — with no live edge set on disk yet
                       (forest-edges.json absent; only the .dummy set exists,
                       marked "Never present as real"), NOTHING reads "active".
          • "deep"   ← RESERVED. Provisioned in the vocabulary + CSS for a future
                       explicit deep-work marker; never emitted off an invented
                       signal (an 8-colour approximation is a different thing
                       wearing the name — Wren). Lights only when a real one lands.
          • "quiet"  ← present in the grove, calm — the honest default for a unit
                       with no attestation and no live flow.

     3. CACHED — the EDGE WALK happens ONCE per snapshot, never per render. The
        directive's rule is "never recompute per-render over the edge set": the
        strip re-renders on every pin / unpin / reorder / close (pure view-config
        churn that does not change the grove), so the fold (`_fold`) is memoized on
        a cheap snapshot signature and every render does only O(tabs) lookups
        against the cached result. Curation (an owner Soil write → a re-read → a new
        snapshot) changes the signature and recomputes exactly once; `invalidate()`
        is the explicit hook for a host that re-reads out of band.

   Pure of DOM except renderToggle (the one control). Plain script (no ES module) —
   attaches to window.ForestShell.badges. Depends on window.ForestShell.viewConfig
   (STEP 1) for kindOf + badgesEnabled — load view-config.js first. Cold-safe
   throughout: a missing dep, a missing snapshot, or any throw yields {} / a no-op,
   never an exception into the boot. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});
  function vcRef() { return root.viewConfig; }        // resolved lazily — load-order forgiving

  /* connector capability id  <->  grant provider (the projection's grant rows
     carry `provider`; the tab capability ids are the end-user connector ids). */
  var PROVIDER_TO_CAP = { gmail: "gmail", gcal: "gcal", calendar: "gcal",
                          contacts: "contacts", drive: "files", files: "files" };

  var CALM_WORDS = { active: 1, quiet: 1, deep: 1, ok: 1 };  // the whole vocabulary; never a count, never red

  /* ---- the edge walk, memoized on a snapshot signature (LAW 3) -------------- *
   * Returns { grants:{cap:true}, live:{ref:true} } — the two real signals folded
   * out of the snapshot ONCE. `live` is populated ONLY from non-dummy edges. */
  var _cache = null;     // { sig, fold }
  var _folds = 0;        // compute counter — the caching auditor (tests read badges._debug.folds)

  function _snapSig(snapshot) {
    var s = snapshot || {};
    var edges = s.edges || [];
    var meta = s.edgesMeta || {};
    var conn = s.connectors || [];
    var canopy = s.canopy || {};
    // cheap, content-sensitive — changes exactly when the folded inputs change.
    var provs = "";
    for (var i = 0; i < edges.length; i++) provs += (edges[i] && edges[i].provenance ? "1" : "0");
    var connKey = "";
    for (var j = 0; j < conn.length; j++) connKey += "|" + ((conn[j] && conn[j].provider) || "?");
    return [meta.provenance || "", edges.length, provs.length ? provs.slice(0, 64) : "",
            canopy.tree_count || 0, conn.length, connKey].join("#");
  }

  function _computeFold(snapshot) {
    _folds++;                                   // a real edge walk happened
    var s = snapshot || {};
    var fold = { grants: {}, live: {} };

    // (a) attested connector grants -> "ok"
    var conn = s.connectors || [];
    for (var i = 0; i < conn.length; i++) {
      var prov = conn[i] && conn[i].provider;
      var cap = prov && PROVIDER_TO_CAP[prov];
      if (cap) fold.grants[cap] = true;
    }

    // (b) LIVE edge participation -> "active"  (Real-or-Made: dummy edges excluded)
    var edges = s.edges || [];
    var meta = s.edgesMeta || {};
    var setIsDummy = (meta.provenance === "dummy");   // whole set is stand-in
    for (var e = 0; e < edges.length; e++) {
      var edge = edges[e] || {};
      if (setIsDummy || edge.provenance === "dummy") continue;   // never "active" off stand-in data
      var refs = [];
      if (edge.source_tree) refs.push(edge.source_tree);
      if (edge.source) refs.push(edge.source);
      var to = edge.to || [];
      for (var t = 0; t < to.length; t++) if (to[t]) refs.push(to[t]);
      for (var r = 0; r < refs.length; r++) fold.live[String(refs[r])] = true;
    }
    return fold;
  }

  function _fold(snapshot) {
    var sig = _snapSig(snapshot);
    if (_cache && _cache.sig === sig) return _cache.fold;   // LAW 3: no edge walk on a render
    var fold = _computeFold(snapshot);
    _cache = { sig: sig, fold: fold };
    return fold;
  }

  function invalidate() { _cache = null; }     // explicit curation hook for an out-of-band re-read

  /* ---- per-capability weather (the honest word) ---------------------------- *
   * ref-matching for "active" is forgiving: the projection references trees by
   * bare slug ("bills") and horizons by name ("the Flow") in edge rows, while
   * tabs carry prefixed ids ("tree:bills-and-utilities", "horizon:the Flow"), so
   * a live touch matches the tail with a tolerant slug compare. Moot until a live
   * edge set exists; correct the day BLOCK D lands one. */
  function _slug(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, ""); }
  function _tail(cap) { var i = cap.indexOf(":"); return i === -1 ? cap : cap.slice(i + 1); }

  function _liveTouches(cap, fold) {
    var tail = _tail(cap), tailSlug = _slug(tail);
    for (var ref in fold.live) if (Object.prototype.hasOwnProperty.call(fold.live, ref)) {
      if (ref === tail) return true;                 // exact
      var rs = _slug(ref);
      if (rs && (rs === tailSlug || tailSlug.indexOf(rs) === 0 || rs.indexOf(tailSlug) === 0)) return true; // slug tail
    }
    return false;
  }

  // The honest word for one capability given the folded snapshot signals.
  function wordFor(cap, fold) {
    var vc = vcRef();
    var kind = vc ? vc.kindOf(cap) : "unknown";
    if (kind === "connector") return fold.grants[cap] ? "ok" : null;   // absent -> no dot (honest-absent pane owns it)
    if (kind === "connector-absent") return null;
    // tree / horizon / grove / grove(⊗): live flow -> active, else present -> quiet
    if (kind === "grove") {
      // a ⊗ grove is active if EITHER side sees live flow
      var sides = _tail(cap).split("\u2297");
      for (var k = 0; k < sides.length; k++) if (_liveTouches("x:" + sides[k], fold)) return "active";
      return _liveTouches(cap, fold) ? "active" : "quiet";
    }
    if (kind === "tree" || kind === "horizon") return _liveTouches(cap, fold) ? "active" : "quiet";
    return null;   // unknown kind -> no invented signal, no dot
  }

  /* ---- the public fold: config-gated, keyed by the actual tabs -------------- *
   * weatherFor(config, snapshot) -> { capability: word }  (or {} when OFF).
   * Keyed by the config's own tab capabilities — exactly what the strip looks up.
   * The edge walk is cached (LAW 3); this loop is O(tabs) lookups only. */
  function weatherFor(config, snapshot) {
    try {
      var vc = vcRef();
      if (!vc || !vc.badgesEnabled(config)) return {};   // LAW 1: OFF by default
      if (snapshot == null) return {};                   // no live-state read -> no weather (honest cold-safe)
      var norm = vc.normalize ? vc.normalize(config) : config;
      var tabs = (norm && norm.tabs) || [];
      var fold = _fold(snapshot);
      var map = {};
      for (var i = 0; i < tabs.length; i++) {
        var cap = tabs[i] && tabs[i].capability;
        if (!cap) continue;
        var w = wordFor(cap, fold);
        if (w && CALM_WORDS[w]) map[cap] = w;             // only ever a calm word
      }
      return map;
    } catch (e) { return {}; }                            // cold-safe: never throw into the boot
  }

  /* ---- the toggle (the one DOM control) ------------------------------------ *
   * renderToggle(hostEl, config, { onToggle })  — idempotent; ensures ONE button
   * inside hostEl reflecting badges on/off, emits forest:badges-toggle {enabled},
   * and calls onToggle(next) if supplied. Wired once (survives re-render). Calm
   * label ("weather"), aria-pressed carries state; no counts, no alarm. */
  function renderToggle(hostEl, config, handlers) {
    if (!hostEl || !hostEl.ownerDocument) return null;
    handlers = handlers || {};
    var doc = hostEl.ownerDocument;
    var vc = vcRef();
    var on = !!(vc && vc.badgesEnabled(config));

    hostEl.__forestBadgesHandlers = handlers;    // refresh: the listener reads the LATEST handlers, not the first render's
    var btn = hostEl.__forestBadgesBtn;
    if (!btn) {
      btn = doc.createElement("button");
      btn.type = "button";
      btn.className = "forest-badges-toggle";
      btn.setAttribute("data-forest-badges-toggle", "1");
      hostEl.appendChild(btn);
      hostEl.__forestBadgesBtn = btn;
      btn.addEventListener("click", function () {
        var cur = btn.getAttribute("aria-pressed") === "true";
        var next = !cur;
        var view = doc.defaultView;
        var ev = (view && typeof view.CustomEvent === "function")
          ? new view.CustomEvent("forest:badges-toggle", { detail: { enabled: next }, bubbles: true })
          : { type: "forest:badges-toggle", detail: { enabled: next }, bubbles: true };
        if (btn.dispatchEvent) btn.dispatchEvent(ev);
        var h = hostEl.__forestBadgesHandlers || {};
        if (typeof h.onToggle === "function") h.onToggle(next);
      });
    }
    // idempotent state paint
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.setAttribute("aria-label", (on ? "Hide" : "Show") + " weather on your tabs");
    btn.setAttribute("title", on ? "Weather: on" : "Weather: off");
    btn.className = "forest-badges-toggle" + (on ? " forest-badges-toggle--on" : "");
    btn.textContent = on ? "\u25CF weather" : "\u25CB weather";   // ● on / ○ off — calm, never a count
    return btn;
  }

  /* ---- export -------------------------------------------------------------- */
  root.badges = {
    weatherFor: weatherFor,
    fold: _fold,               // exposed for hosts/tests that want the raw signals
    wordFor: wordFor,
    invalidate: invalidate,
    renderToggle: renderToggle,
    CALM_WORDS: CALM_WORDS,
    _debug: { get folds() { return _folds; }, reset: function () { _folds = 0; _cache = null; } },
    _version: "1.0"
  };
})();
