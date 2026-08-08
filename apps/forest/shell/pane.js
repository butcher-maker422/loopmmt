/* Shea's Forest — the App Shell · shell/pane.js
   STEP 3 of the shell build (lifecycle rewritten in Track P,).

   The pane is the tab→pane JOINT — the load-bearing joint of the shell. When a tab
   is selected (the strip's `forest:tab-select` event), the pane resolves the
   capability and renders it, dispatching by capability KIND. It REUSES the live
   projection read (the same GET the page already does) rather than re-plumbing it,
   and it renders a first-class HONEST-ABSENT pane for a capability whose source is
   not connected. Like the strip, the pane is READ-ONLY over the graph — it renders;
   it never writes an obligation.

    — the VIEW pool (the payload change; the pool's algebra is unchanged):
     • The pool's unit is no longer a pane. It is a VIEW — the PRODUCT {pane, menu}:
       the body pane in #forest-pane, and the app's left column in [data-app-menu].
       Both are built, shown, hidden, and released AS ONE ENTRY. Because visibility is
       applied to the ENTRY, the menu cannot disagree with its pane about which app is
       active -- there is no state that names them separately. The desync bug is not
       defended against; it is not expressible.
     • The pool's algebra (LRU, admit, evict, showOnly, release) never inspected its
       payload, so NONE of it changed. Only what an entry HOLDS changed.
     • THE JOINT WRITES THE ANCHOR. Every menu opens with `.menu__anchor` --
       `.menu__name` (labelFor(), the SAME source the tab strip uses, so the column and
       the strip cannot disagree) + `.menu__version` (DERIVED from the renderer module's own
       `_version` — see appVersion;). It is written
       BEFORE the app renderer runs, so it survives any renderer fault. An app cannot
       forget it, cannot restyle it, and must not touch it.
     • THE APP WRITES THE BODY. The renderer's ctx gains ONE optional field --
       `ctx.menuBody` (the `.menu__body` div). Fill it, or ignore it: ignoring it yields
       an ANCHOR-ONLY column (name + V#), which is a correct, shippable state.
       There is deliberately NO second registry: a menu whose contents depend on pane
       state (mail's repaintRail() lives in the pane renderer's closure) could not be
       reached from a separate closure. One renderer, one closure, one truth.
     • COLD-SAFE: no [data-app-menu] host -> menu is null, ctx.menuBody is null, and the
       module behaves byte-identically to. Every pre-existing test passes UNEDITED.

    Track P — the KEEP-ALIVE POOL (the lifecycle; the guts are unchanged):
     • BEFORE: one pane container, cleared+rebuilt on every switch (mountPane→clear).
       A tab switch destroyed the outgoing pane's DOM, so in-progress state (form
       inputs, scroll position, a half-composed reply) was lost on every switch —
       the "no changes showed up" / state-loss seam.
     • NOW: one live pane PER capability, kept mounted in the container. A tab switch
       is SHOW/HIDE (the `hidden` attribute), never destroy/rebuild — so state
       SURVIVES a switch. The core-loop (switch app) is instant and state-preserving
       (Web-App/Product-UI module Step 1 core-loop + the recovery invariant).
     • BOUNDED: the pool caps the most-recent-N live panes (default 8); older panes
       are RELEASED (removed from DOM + pool) so dozens of tabs don't grow unbounded.
       A released pane RE-MOUNTS CLEANLY on re-select (module Step 7 edge/recovery) —
       it simply rebuilds fresh, re-reading the projection.
     • PRESERVED, byte-for-byte in spirit: the renderer registry, the honest
       absent / pending / empty / error states, the injectable projection read, the
       label vocabulary. ONLY the lifecycle (when a pane is built, shown, hidden,
       released) changed.

   Design:
     • Kind dispatch via a RENDERER REGISTRY. pane.registerRenderer(kind, fn) is the
       extension seam the later steps (wire live tool-tabs, groves, horizons) fill —
       each kind registers its own renderer; the joint owns the lifecycle, not the
       per-kind guts. Until a kind is registered it renders a calm PENDING pane.
     • The projection READ is INJECTABLE (opts.readProjection) so the pane shares
       app.js's runtime fetch; it defaults to GET <runtime>/projection/forest-state
       with credentials, and falls back to nothing-yet honestly on failure.
     • HONEST-ABSENT is first-class: a not-connected capability gets its own pane
       (calm, no alarm — Theo's rule), never a broken or blank one.

   Plain script (no ES module) — attaches to window.ForestShell.pane.
   Depends on window.ForestShell.viewConfig (STEP 1). */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});
  function vcRef() { return root.viewConfig; }

  var DEFAULT_POOL_MAX = 8; // §8: keep at most N most-recent live panes mounted.

  /* ---- the renderer registry (kind -> fn(paneEl, ctx)) --------------------- *
   * ctx = { capability, kind, data, resolved, label, config }                   *
   * A renderer OWNS the pane's inner DOM for its kind; the joint owns when it   *
   * is called and the absent/pending/error states around it.                   */
  var RENDERERS = {};
  function registerRenderer(kind, fn) { if (typeof fn === "function") RENDERERS[kind] = fn; }
  function hasRenderer(kind) { return typeof RENDERERS[kind] === "function"; }

  /* ---- end-user labels (mirror the strip's vocabulary) --------------------- */
  var CONNECTOR_LABEL = { gmail: "Gmail", gcal: "Calendar", contacts: "Contacts", files: "Files" };
  function titleCase(s) {
    return String(s).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().replace(/\b\w/g, function (m) { return m.toUpperCase(); });
  }
  function labelFor(capability) {
    if (root.tabStrip && typeof root.tabStrip.labelFor === "function") return root.tabStrip.labelFor(capability);
    var vc = vcRef(); var kind = vc ? vc.kindOf(capability) : "unknown";
    if (kind === "connector") return CONNECTOR_LABEL[capability] || titleCase(capability);
    var ref = capability.indexOf(":") !== -1 ? capability.slice(capability.indexOf(":") + 1) : capability;
    return kind === "horizon" ? ref : titleCase(ref);
  }

  /* ---- DOM helper: the one el(), now shared from shell/block.js ------------- */
  var el = root.block.el;
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function setState(pane, state) { pane.setAttribute("data-pane-state", state); pane.__state = state; }

  /* ---- the pane states ------------------------------------------------------ */
  function paneShell(doc, capability, kind, stateClass) {
    var wrap = el(doc, "section", "pane pane--" + stateClass, {
      role: "tabpanel", "aria-label": labelFor(capability), "data-capability": capability, "data-kind": kind
    });
    return wrap;
  }

  // HONEST-ABSENT — first-class, calm. Never alarmed, never blank.
  function renderAbsent(doc, capability, kind, reason) {
    var pane = paneShell(doc, capability, kind, "absent");
    setState(pane, "absent");
    var label = labelFor(capability);
    pane.appendChild(el(doc, "h2", "pane__title", { text: label }));
    var msg = reason === "not-connected"
      ? label + " isn\u2019t connected yet. Link its source to grow this tab into a living view."
      : "This capability has nothing to show yet.";
    pane.appendChild(el(doc, "p", "pane__absent", { text: msg }));
    // an honest, plain call-to-connect (browser-native voice; no false urgency)
    var act = el(doc, "button", "pane__connect", { type: "button", "data-connect": capability, text: "Connect \u2192" });
    pane.appendChild(act);
    return pane;
  }

  // PENDING — a kind with no renderer registered yet (calm, honest "coming").
  function renderPending(doc, capability, kind) {
    var pane = paneShell(doc, capability, kind, "pending");
    setState(pane, "pending");
    pane.appendChild(el(doc, "h2", "pane__title", { text: labelFor(capability) }));
    pane.appendChild(el(doc, "p", "pane__pending", { text: "This view is on its way." }));
    return pane;
  }

  // EMPTY — no tab selected (the resting pane; the page's own content shows).
  function renderEmpty(doc) {
    var pane = paneShell(doc, "", "none", "empty");
    setState(pane, "empty");
    return pane;
  }

  /* ==== THE KEEP-ALIVE POOL ================================================== *
   * Per-container pool state (attached to the container element). The pool owns *
   * a live pane per capability + one resting EMPTY pane; a switch is show/hide, *
   * never destroy/rebuild, so pane state survives switches. Bounded to the most *
   * recent N (default 8); older panes are released (Step 7: they re-mount clean *
   * on re-select).                                                              */
  function poolOf(container) {
    if (!container.__forestPane) {
      container.__forestPane = {
        map: Object.create(null), // capability -> VIEW { pane, menu } (: a product)
        order: [],                // LRU: least-recent first, most-recent last
        empty: null,              // the resting EMPTY pane (never counted / evicted)
        active: null,             // the currently-shown capability ("" => empty)
        menuHost: null, // : the [data-app-menu] element, or null (cold-safe)
        max: DEFAULT_POOL_MAX
      };
    }
    return container.__forestPane;
  }

  function ensureEmpty(container) {
    var pool = poolOf(container);
    if (!pool.empty) {
      pool.empty = renderEmpty(container.ownerDocument);
      pool.empty.hidden = true;
      container.appendChild(pool.empty);
    }
    return pool.empty;
  }

  function touchLRU(pool, cap) {
    var i = pool.order.indexOf(cap);
    if (i !== -1) pool.order.splice(i, 1);
    pool.order.push(cap);
  }

  // Release the least-recently-used live panes until the pool is within `max`.
  // Never releases the ACTIVE pane (Step 7: eviction must not pull the rug on the
  // pane the user is looking at).
  function evictOverflow(container) {
    var pool = poolOf(container);
    var i = 0;
    while (pool.order.length > pool.max && i < pool.order.length) {
      var cap = pool.order[i];
      if (cap === pool.active) { i++; continue; } // skip the active one, try the next
      releasePane(container, cap);
      i = 0; // order shifted; restart the scan
    }
  }

  // Release a VIEW -- BOTH halves, together. A pane can never outlive its menu, nor
  // a menu its pane: they are one entry.
  function releasePane(container, cap) {
    var pool = poolOf(container);
    var view = pool.map[cap];
    if (view) {
      if (view.pane && view.pane.parentNode) view.pane.parentNode.removeChild(view.pane);
      if (view.menu && view.menu.parentNode) view.menu.parentNode.removeChild(view.menu);
    }
    delete pool.map[cap];
    var i = pool.order.indexOf(cap);
    if (i !== -1) pool.order.splice(i, 1);
    if (pool.active === cap) pool.active = null;
  }

  // Show exactly one pane (the given capability, or the empty pane when falsy);
  // hide the rest. Pure DOM visibility — no rebuild.
  // Show exactly one VIEW -- its pane AND its menu, together -- and hide the rest.
  // Visibility is applied to the ENTRY, which is why a menu can never disagree with its
  // pane about the active app. With no tab selected, the menu column is BARE:
  // an anchor with nothing to name is not an anchor.
  function showOnly(container, cap) {
    var pool = poolOf(container);
    ensureEmpty(container);
    var showEmpty = !cap;
    pool.empty.hidden = !showEmpty;
    for (var k in pool.map) {
      if (Object.prototype.hasOwnProperty.call(pool.map, k)) {
        var hide = (k !== cap) || showEmpty;
        pool.map[k].pane.hidden = hide;
        if (pool.map[k].menu) pool.map[k].menu.hidden = hide;
      }
    }
    pool.active = showEmpty ? "" : cap;
    if (!showEmpty) touchLRU(pool, cap);
  }

  // Insert a freshly-built pane into the pool (append, do NOT clear the container),
  // then enforce the bound.
  // Admit a VIEW: the pane into the pane container, its menu (if the frame has a menu
  // host) into [data-app-menu]. Both hidden; showOnly reveals them together.
  function admit(container, cap, pane, menu) {
    var pool = poolOf(container);
    pane.hidden = true;
    container.appendChild(pane);
    if (menu && pool.menuHost) { menu.hidden = true; pool.menuHost.appendChild(menu); }
    pool.map[cap] = { pane: pane, menu: (menu && pool.menuHost) ? menu : null };
    touchLRU(pool, cap);
  }

  // Build the menu for a capability iff the frame has a host. Cold-safe: no host -> null.
  function menuFor(container, doc, capability, kind) {
    var pool = poolOf(container);
    return pool.menuHost ? buildMenu(doc, capability, kind) : null;
  }

  /* ==== · THE MENU HALF OF A VIEW ====================================== *
   * The JOINT builds the menu and writes the anchor. The APP fills .menu__body   *
   * (via ctx.menuBody) -- or ignores it, and gets an anchor-only column.         *
   * The anchor is written BEFORE the app renderer runs, so it survives a fault.  */
  /* THE FOLD — the per-app stamp is DERIVED, never mirrored.
   *
   * WAS: window.FOREST_APP_VERSIONS — a hand-kept map in version.js mirroring each renderer
   * module's own `_version`. Its own comment predicted its drift ("⚠ THIS MAP IS A HAND-KEPT
   * MIRROR. It DRIFTS.") and it drifted anyway — three times in three sessions, the third as a
   * PARALLEL collision (two branches independently stamping calendar-renderer 1.6.0). A warning
   * in a comment is not a guard, and a parity test that goes red is a floor-raise, not a seal.
   *
   * NOW: there is no map. `appVersion` resolves the renderer MODULE for this kind by the shell's
   * own naming convention — the same one shell-renderers.js `registerAll` already uses to find
   * them (kind "calendar" -> window.ForestShell.calendarRenderer) — and reads its `_version`
   * directly. The number the pane shows IS the number in the renderer file. There is no second
   * copy, so the copies cannot disagree: the drift is not defended against, it is not expressible.
   * (owed: forest-per-app-version-map-hand-kept-drift — this is its close.)
   *
   * The convention is PINNED by a test (version-stamp-derived.test.js): a new app kind whose
   * module is not named `<kind>Renderer`, or which carries no `_version`, goes red.
   */
  function rendererModuleFor(kind) {
    if (typeof window === "undefined" || !kind) return null;
    var shell = window.ForestShell;
    if (!shell) return null;
    var mod = shell[String(kind) + "Renderer"];
    return (mod && typeof mod === "object") ? mod : null;
  }

  function appVersion(kind) {
    if (typeof window === "undefined") return "";
    var mod = rendererModuleFor(kind);
    if (mod && mod._version) return String(mod._version);
    // COLD-SAFE fallback, unchanged in spirit from : a kind with no renderer module of its
    // own (tree / grove / connector / horizon), or one whose file failed to load, falls back to
    // the AGGREGATE stamp. Never a fabricated number — absent both, the anchor renders no V#.
    return window.FOREST_APP_VERSION ? String(window.FOREST_APP_VERSION) : "";
  }

  // Build the menu element for a capability: <section class="menu"> with a joint-owned
  // .menu__anchor (name + V#) and an app-owned, initially-empty .menu__body.
  function buildMenu(doc, capability, kind) {
    var menu = el(doc, "section", "menu", {
      "data-capability": capability, "data-kind": kind, "aria-label": labelFor(capability) + " menu"
    });
    var anchor = el(doc, "div", "menu__anchor");
    // THE NAME comes from labelFor() -- the SAME source the tab strip uses (tab-strip.js
    // labelFor). One name, one place: the column and the strip cannot disagree.
    anchor.appendChild(el(doc, "h2", "menu__name", { text: labelFor(capability) }));
    var v = appVersion(kind);
    if (v) anchor.appendChild(el(doc, "div", "menu__version", { text: "v" + v }));
    menu.appendChild(anchor);
    menu.appendChild(el(doc, "div", "menu__body"));
    return menu;
  }

  // Find the app-owned body inside a menu. Walks childNodes rather than using
  // querySelector so it works under the shell's minimal DOM shim as well as a browser
  // (the test harness's Node has no querySelector). The body is the menu's LAST child
  // by construction (buildMenu appends anchor then body), but we match by class so a
  // future anchor addition cannot silently break it.
  function menuBodyOf(menu) {
    if (!menu) return null;
    var kids = menu.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      if (kids[i] && kids[i].className === "menu__body") return kids[i];
    }
    return null;
  }

  /* ---- the projection read (injectable; reuses the page's runtime fetch) ---- */
  function defaultReadProjection() {
    // Mirrors app.js: GET <runtime>/projection/forest-state, credentials included.
    var RT = (root.runtimeBase || (typeof window !== "undefined" && window.FOREST_RUNTIME) || "");
    if (typeof fetch !== "function") return Promise.resolve(null);
    return fetch((RT || "") + "/projection/forest-state", { cache: "no-store", credentials: "include" })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  /* ---- render a capability into the pane ------------------------------------ *
   * render(container, capability, opts)                                        *
   *   opts: { resolver?, readProjection?, data?, poolMax? }                    *
   * Returns a Promise resolving to { state, capability, kind }.                *
   *                                                                            *
   * POOL CONTRACT: a capability already live in the pool is SHOWN (state       *
   * preserved), never rebuilt. A fresh capability is built, admitted, shown,   *
   * and (for a live kind) filled from the projection read.                     */
  function render(container, capability, opts) {
    opts = opts || {};
    var doc = container.ownerDocument;
    var vc = vcRef();
    var pool = poolOf(container);
    if (typeof opts.poolMax === "number" && opts.poolMax > 0) pool.max = opts.poolMax;

    // no capability -> the resting empty pane (kept, never rebuilt)
    if (!capability) {
      showOnly(container, null);
      return Promise.resolve({ state: "empty", capability: null, kind: "none" });
    }

    // POOL HIT — show the kept VIEW (pane + menu); do NOT rebuild (this preserves state
    // in BOTH halves: a half-composed reply AND a scrolled/filtered menu both survive).
    if (pool.map[capability]) {
      var kept = pool.map[capability].pane;
      showOnly(container, capability);
      return Promise.resolve({ state: kept.__state || "live", capability: capability, kind: kept.getAttribute("data-kind") });
    }

    var kind = vc ? vc.kindOf(capability) : "unknown";
    var res = vc ? vc.resolveOrAbsent(capability, opts.resolver) : { ok: true };

    // honest-absent short-circuits before any read
    if (res.ok === false) {
      var absent = renderAbsent(doc, capability, kind, res.reason);
      admit(container, capability, absent, menuFor(container, doc, capability, kind));
      showOnly(container, capability);
      evictOverflow(container);
      return Promise.resolve({ state: "absent", capability: capability, kind: kind });
    }
    // a kind with no renderer yet -> calm pending (no read needed)
    if (!hasRenderer(kind)) {
      var pending = renderPending(doc, capability, kind);
      admit(container, capability, pending, menuFor(container, doc, capability, kind));
      showOnly(container, capability);
      evictOverflow(container);
      return Promise.resolve({ state: "pending", capability: capability, kind: kind });
    }

    // resolved kind with a renderer: build + admit + reveal, then fill from the read.
    var pane = paneShell(doc, capability, kind, "live");
    setState(pane, "live");
    // The MENU is built here -- with its anchor already written -- BEFORE the app's
    // renderer runs below. That is why the anchor survives a renderer fault: it is not
    // defended by a try/catch, it simply already exists.
    var menu = menuFor(container, doc, capability, kind);
    admit(container, capability, pane, menu);
    showOnly(container, capability); // instant switch; the read fills it in place
    evictOverflow(container);

    var readP = ("data" in opts) ? Promise.resolve(opts.data)
      : (typeof opts.readProjection === "function" ? opts.readProjection() : defaultReadProjection());

    return readP.then(function (data) {
      // the pane may have been released by an overflow while the read was in flight;
      // if so, its work is moot — resolve honestly without touching the DOM.
      if (!pool.map[capability] || pool.map[capability].pane !== pane) return { state: "released", capability: capability, kind: kind };
      try {
        RENDERERS[kind](pane, {
          capability: capability, kind: kind, data: data, resolved: res,
          label: labelFor(capability), config: opts.config, _fetch: opts._fetch,
          // — the app's half of its left column. Fill it, or ignore it (ignoring
          // it yields an anchor-only column, which is correct). null when the frame has
          // no [data-app-menu] host. The anchor above it is the joint's; do not touch it.
          menuBody: menuBodyOf(pool.map[capability].menu)
        });
      } catch (e) {
        // a renderer that throws degrades to an honest error pane, never a blank one.
        // The MENU's anchor is untouched -- it was written before the renderer ran.
        clear(pane); setState(pane, "error");
        pane.className = "pane pane--error";
        pane.appendChild(el(doc, "h2", "pane__title", { text: labelFor(capability) }));
        pane.appendChild(el(doc, "p", "pane__error", { text: "This view hit a snag loading. Try again in a moment." }));
        return { state: "error", capability: capability, kind: kind };
      }
      return { state: "live", capability: capability, kind: kind };
    });
  }

  /* ---- wire the pane to a strip -------------------------------------------- *
   * mount(container, opts) — listen for the strip's select event and render.   *
   *   opts: { strip? (element that emits forest:tab-select; defaults to        *
   *           document), resolver?, readProjection?, config? (for initial      *
   *           landing render), poolMax? }                                      *
   * Returns { render, container, release, poolSize }.                          */
  function mount(container, opts) {
    opts = opts || {};
    var pool = poolOf(container);
    if (typeof opts.poolMax === "number" && opts.poolMax > 0) pool.max = opts.poolMax;
    // — the menu host. ABSENT => the pool runs menu-less, byte-identical to
    //. This is what lets the joint land before any app fills a column.
    if (opts.menu) pool.menuHost = opts.menu;
    var source = opts.strip || (container.ownerDocument && container.ownerDocument);
    if (source && source.addEventListener && !container.__forestPaneWired) {
      container.__forestPaneWired = true;
      source.addEventListener("forest:tab-select", function (e) {
        var cap = e && e.detail && e.detail.capability;
        render(container, cap, opts);
      });
    }
    // initial landing render, if a config is supplied
    var vc = vcRef();
    if (opts.config && vc) {
      var landing = vc.landingTab(opts.config);
      render(container, landing ? landing.capability : null, opts);
    } else {
      render(container, null, opts); // resting empty pane
    }
    return {
      render: function (cap) { return render(container, cap, opts); },
      container: container,
      release: function (cap) { return releasePane(container, cap); },
      poolSize: function () { return poolOf(container).order.length; }
    };
  }

  /* ---- export -------------------------------------------------------------- */
  root.pane = {
    render: render,
    mount: mount,
    registerRenderer: registerRenderer,
    hasRenderer: hasRenderer,
    renderAbsent: function (container, capability, reason) {
      // pooled honest-absent (used directly by callers, e.g. a connect-flow reset)
      var doc = container.ownerDocument;
      var vc = vcRef();
      if (poolOf(container).map[capability]) releasePane(container, capability);
      var kind = (vc ? vc.kindOf(capability) : "unknown");
      var pane = renderAbsent(doc, capability, kind, reason);
      admit(container, capability, pane, menuFor(container, doc, capability, kind));
      showOnly(container, capability);
      evictOverflow(container);
      return pane;
    },
    labelFor: labelFor,
    release: releasePane,
    poolSize: function (container) { return poolOf(container).order.length; },
    _renderers: RENDERERS,
    _buildMenu: buildMenu, // — exposed for frame-anchor.test.js
    _poolMax: DEFAULT_POOL_MAX,
    _appVersion: appVersion, // — exposed for version-stamp-derived.test.js
    _version: "2.2" // : the per-app stamp is DERIVED from the renderer module, not mirrored
  };
})();
