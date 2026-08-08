/* Shea's Forest — the App Shell · shell/tabstrip-actions.js · Track B
   ----------------------------------------------------------------------------
   The icon-button cluster that fills the FIXED top-bar slot Track F reserved
   (<div class="app-actions" data-app-actions>). FOUR actions, LEFT-to-RIGHT:

       edit-lock   ·   search   ·   skin   ·   settings

   -- THE SUN WAS ALWAYS A SUN (operator note #7,) -------------------
   The "settings" icon shipped here was a circle ringed with eight rays. That is
   a SUN. The operator read it as a skin control every time he looked at it, and
   he was RIGHT -- the glyph was telling the truth and the handler was lying. So
   the glyph KEEPS ITS MEANING and CHANGES ITS JOB: it is now the skin toggle,
   which is what it always looked like. Settings gets a real cogged gear.

   Higgins (reads without a label): a padlock reads as a lock, a lens as search,
   a sun/moon reads as the skin, a cogged gear reads as settings -- each icon is
   inline SVG driven by currentColor, so the theme colours it, never a bitmap.

   The skin button is a TWO-STATE toggle, not a menu, and it shows THE SKIN YOU
   WILL GET, not the one you have: on light it shows a moon ("Switch to dark"),
   on dark it shows the sun ("Switch to light"). A toggle that pictures its own
   current state is the classic ambiguity -- you can never tell whether the icon
   is a readout or a button. This one is a button, so it pictures the DESTINATION.

   This is a PURE renderer + emitter, the exact shape as shell/tab-strip.js:
     • actionsModel(config, opts) -> plain-data description  (THE FOLD)
     • render(mount, config, opts) -> idempotent DOM projection (THE INK)
   It NEVER mutates the view-config. It EMITS and the host (shell-boot.js) owns
   the single write loop — the same separation the strip/pane hold:

       forest:edit-lock-toggle  { locked }   // the NEXT state the user wants
       forest:actions-search    {}
       forest:actions-skin      { skin }     // the NEXT skin the user wants
       forest:actions-settings  {}

   The lock button reflects the current lock state (aria-pressed + is-unlocked)
   so the cluster and the strip agree on one truth. Wire-once via delegation, so
   a re-render is always safe. Cold-safe throughout: no mount / no block atom ->
   a silent no-op, exactly like the strip's host guards.
   ============================================================================ */
(function () {
  "use strict";
  var root = (typeof window !== "undefined" ? window : this);
  root.ForestShell = root.ForestShell || {};

  /* ---- icons: inline SVG, monochrome via currentColor (Higgins-clean) ------- */
  var ICON = {
    // padlock — shackle open when unlocked (visibly distinct: Niamh's rule)
    locked:
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    unlocked:
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>',
    search:
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    // THE SUN -- byte-for-byte the glyph that used to be wired to `settings`. It was always
    // a sun; it now does the sun's job. Shown when the DARK skin is live, because pressing
    // it takes you TO the light (the button pictures its destination, never its state).
    sun:
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.2M12 18.8V21M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M3 12h2.2M18.8 12H21M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"/></svg>',
    // THE MOON -- shown when the LIGHT skin is live (the default): pressing it takes you to dark.
    moon:
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2z"/></svg>',
    // THE GEAR -- a REAL cogged gear (a toothed ring around a hub). This is the glyph every
    // other application has trained a person to read as "settings", and it is deliberately
    // NOT the ringed circle above: that one reads as a sun, and always did.
    settings:
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="3"/>' +
      '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
  };

  /* ---- THE WEATHER READING ---------------------------------------
     Held at module scope for the same reason the runtime commit is: the reading arrives
     ASYNCHRONOUSLY, long after the first paint, and the cluster re-renders on every lock/skin
     toggle. If the reading lived only in the DOM, the next re-render would wipe it and the
     temperature would vanish the first time Shea clicked the lock — the exact class of bug the
     late-/api/version arrival already taught this module once (see signature() below).
     NULL is the resting state and NULL is honest: no reading -> no element (weather.js L1). */
  var lastWeather = null;

  /* setWeather(reading) — called by the reader once NWS answers (and on each refresh).
     Idempotent and cold-safe: repaints the slot IN PLACE if the cluster is already mounted, so a
     late reading appears without a full re-render; a null reading REMOVES the element rather than
     leaving a stale number on the bar. */
  function setWeather(reading, mount) {
    lastWeather = (reading && typeof reading === "object") ? reading : null;
    var wx = root.ForestShell.weather;
    if (!wx || !mount || !mount.querySelectorByClass && !mount.getElementsByClassName) { /* fall through */ }
    var slot = findSlot(mount);
    if (wx && slot) wx.render(slot, wx.weatherModel(lastWeather));
    return lastWeather;
  }

  // Find the weather slot inside a mounted cluster, walking the tree we built ourselves (no
  // querySelector dependency — several of this shell's DOM doubles do not implement it).
  function findSlot(mount) {
    if (!mount) return null;
    var found = null;
    (function walk(n) {
      if (found || !n) return;
      if (n.getAttribute && n.getAttribute("data-weather-slot") != null) { found = n; return; }
      var kids = n.childNodes || [];
      for (var i = 0; i < kids.length && !found; i++) walk(kids[i]);
    })(mount);
    return found;
  }

  function elAtom() {
    return (root.ForestShell.block && root.ForestShell.block.el) || null;
  }

  /* ---- THE FOLD ------------------------------------------------------------- */
  function actionsModel(config, opts) {
    opts = opts || {};
    var vc = root.ForestShell.viewConfig;
    var locked = (typeof opts.locked === "boolean")
      ? opts.locked
      : (vc && vc.editLocked ? vc.editLocked(config) : true);   // LOCKED default
    // The live skin, and THE ONE THE BUTTON WILL GIVE YOU. Cold-safe: no viewConfig ->
    // fall back to "light", the operator's default, never a blank or a guess.
    var skin = (typeof opts.skin === "string")
      ? opts.skin
      : (vc && vc.skinOf ? vc.skinOf(config) : "light");
    if (skin !== "light" && skin !== "dark") skin = "light";
    var nxt = (skin === "light") ? "dark" : "light";
    return {
      locked: locked,
      skin: skin,
      nextSkin: nxt,
      // ORDER IS THE SPEC (operator note #7), as amended: SEARCH . SKIN . SETTINGS.
      // THE LOCK MOVED (operator, item 4,). It used to lead this list, immediately
      // right of the version stamp. It now sits in the TAB STRIP, stacked under the "+"
      // ([data-lock-slot], built by tab-strip.js) and filled by lockModel()/renderLock()
      // below -- this module still owns the icon, the state and the emit; only the seat
      // moved. Same shape as the version stamp's move one session earlier.
      actions: [
        { id: "search",   icon: ICON.search,   label: "Search",   pressed: null, mod: "" },
        // The button PICTURES ITS DESTINATION, and its label SAYS the destination -- so the
        // icon and the accessible name can never disagree about which way the press goes.
        { id: "skin",
          icon: (skin === "light") ? ICON.moon : ICON.sun,
          label: (skin === "light") ? "Switch to dark skin" : "Switch to light skin",
          pressed: null, mod: "is-skin-" + skin,
          data: { "skin": skin, "skin-next": nxt } },
        { id: "settings", icon: ICON.settings, label: "Settings", pressed: null, mod: "" }
      ]
    };
  }

  /* ---- THE EDIT-LOCK, RESEATED (operator item 4,) --------------------
     The lock button no longer rides the .app-actions cluster. It is stacked UNDER the
     "+" in the tab strip, in a slot tab-strip.js builds and leaves empty. This module
     keeps everything that MATTERS about it -- the padlock SVG, the locked/unlocked
     fold, aria-pressed, and the emit -- so there is exactly one owner, as before.

     THE HAZARD THIS SHAPE AVOIDS, named so nobody re-introduces it: the lock's click
     is DELEGATED off the mount it sits in, and shell-boot listens for the resulting
     `forest:edit-lock-toggle`. Move the button to a new parent without moving the
     delegation and the control still PAINTS, still hovers, still takes focus -- and
     does nothing at all, silently. So renderLock() wires its own slot (the same
     delegated wire() the cluster uses; the flag is per-mount, so both can hold it),
     and the event bubbles to the shared .app-topbar ancestor shell-boot binds.

     CLASS NOTE (a live bug fixed in passing): the button is `.tsa-btn--lock`, which is
     what shell.css has ALWAYS styled for the unlocked/electric state. The cluster built
     it as `.tsa-btn--edit-lock` (class = "tsa-btn--" + id), so `.tsa-btn--lock.is-unlocked`
     never matched anything and the two-tone state has never once painted. Naming it
     here revives the rule that was already written for it. */
  function lockModel(config, opts) {
    var m = actionsModel(config, opts);
    return {
      locked: m.locked,
      icon: m.locked ? ICON.locked : ICON.unlocked,
      label: m.locked ? "Unlock tab editing" : "Lock tab editing",
      mod: m.locked ? "" : "is-unlocked"
    };
  }

  function renderLock(doc, config, opts) {
    if (!doc || typeof doc.querySelectorAll !== "function") return null;   // cold-safe
    var el = elAtom();
    if (!el) return null;                                                  // cold-safe: no Block atom
    var slots = doc.querySelectorAll("[data-lock-slot]");
    if (!slots || !slots.length) return null;                              // no seat -> silent no-op
    var m = lockModel(config, opts);
    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i];
      var sig = m.locked ? "locked" : "unlocked";
      if (slot.__forestLockSig !== sig) {
        while (slot.firstChild) slot.removeChild(slot.firstChild);
        var b = el(doc, "button", "tsa-btn tsa-btn--lock" + (m.mod ? " " + m.mod : ""), {
          type: "button", "data-action": "edit-lock",
          "aria-label": m.label, title: m.label,
          "aria-pressed": m.locked ? "false" : "true"
        });
        var ic = el(doc, "span", "tsa-btn__icon", { "aria-hidden": "true" });
        ic.innerHTML = m.icon;            // static, code-owned SVG (no user data)
        b.appendChild(ic);
        slot.appendChild(b);
        slot.__forestLockSig = sig;
      }
      wire(slot);                          // delegated, per-mount flag -> idempotent
    }
    return m;
  }

  /* ---- THE RUNTIME PROVENANCE STAMP -------------------------------
     window.FOREST_RUNTIME_VERSION is set by shell/runtime-version.js from GET /api/version —
     the only browser-reachable answer to "which bytes is the daemon actually running?".
     The viewer stamp (FOREST_SHELL_VERSION) and the app stamps (derived from each renderer's
     own `_version` by pane.js appVersion;) are
     both published by the STATIC deploy, so neither moves on a runtime-only push: three
     real runtime changes shipped 2026-07-12 and every number in this UI stayed put.

     HONESTY IS THE CONTRACT, and it is the same one pane.js holds at T10: we paint what we
     were told and NEVER a number we do not have. Not fetched yet -> no runtime clause at
     all (the tooltip reads exactly as it did before this existed). Fetched but the daemon
     says provenance:'unstamped' (a dev box, or a tree the deploy never wrote) -> we say
     "unstamped" OUT LOUD rather than borrowing the viewer's number to fill the hole. A
     stamp that guesses is worse than no stamp: that is /health returning 200 on a dead
     Forest, moved up one layer, and this line has now been bitten by that shape four times. */
  function runtimeLabel() {
    var rt = root && root.FOREST_RUNTIME_VERSION;
    if (!rt) return "";                                              // not fetched (yet) — say nothing
    if (rt.provenance !== "deployed" || !rt.short_commit) return "unstamped";
    return String(rt.short_commit);
  }

  /* Idempotent: safe to call on a freshly-built element or on a live one in the DOM after
     the async /api/version lands (runtime-version.js re-stamps in place, so the tooltip is
     correct even if no re-render ever comes). */
  function stampRuntime(ver) {
    if (!ver || !ver.setAttribute) return ver;
    var shellVer = (ver.getAttribute && ver.getAttribute("data-shell-version")) || "";
    var label = runtimeLabel();
    var title = "viewer " + shellVer;
    if (label) {
      ver.setAttribute("data-runtime-commit", label);
      var when = (root.FOREST_RUNTIME_VERSION && root.FOREST_RUNTIME_VERSION.deployed_at) || "";
      title += " · runtime " + label + (when ? " (deployed " + when + ")" : "");
    }
    ver.setAttribute("title", title);
    ver.setAttribute("aria-label", title);
    return ver;
  }

  /* ---- THE VERSION STAMP, in the brand slot ------------------------
     Fills every `[data-app-ver]` in the document with the viewer version and hands it
     to stampRuntime() for the tooltip. Split out of buildCluster because the element is
     no longer OURS TO BUILD -- it is Track F's, in the brand slot -- so this is a WRITE
     into a seat someone else declared, which is the Block Principle's joint: F owns the
     box, B owns the number. Idempotent (writes the same text every call) and cold-safe
     three ways: no document, no querySelectorAll (the shell's DOM doubles), or no
     matching element -> return 0 and change nothing. */
  function stampVersion(doc) {
    if (!doc || typeof doc.querySelectorAll !== "function") return 0;
    var shellVer = (root && root.FOREST_SHELL_VERSION != null) ? String(root.FOREST_SHELL_VERSION) : "";
    var els = doc.querySelectorAll("[data-app-ver]");
    var n = 0;
    for (var i = 0; i < els.length; i++) {
      var ver = els[i];
      if (!shellVer) { ver.textContent = ""; continue; }   // no stamp -> no text (:empty collapses it)
      ver.setAttribute("data-shell-version", shellVer);
      ver.textContent = "v" + shellVer;
      stampRuntime(ver);            // viewer version + (when known) the RUNNING runtime commit
      n++;
    }
    return n;
  }

  function signature(model) {
    var acts = model.actions.map(function (a) {
      return a.id + ":" + (a.pressed === true ? "1" : a.pressed === false ? "0" : "-") + ":" + a.mod;
    }).join("|");
    // The runtime label rides the signature so a LATE /api/version arrival actually repaints.
    // Without this the no-op re-render guard below would swallow it and the stamp would only
    // ever appear on a cold first paint — i.e. exactly when it is least likely to be there.
    // The SKIN rides the signature. Without it the no-op re-render guard would swallow the
    // repaint after a toggle and the icon would never change -- the exact class of bug the
    // late-/api/version arrival already taught this module once.
    // THE WEATHER IS DELIBERATELY *NOT* IN THIS SIGNATURE, and that is a correction, not an
    // oversight. I put it here first -- pattern-matching the runtime-label lesson above -- and the
    // mutation battery said so: dropping the term changed nothing. It is redundant, because BOTH
    // repaint paths already cover the reading: setWeather() paints the slot IN PLACE when a reading
    // lands, and buildCluster() re-folds lastWeather on any rebuild the lock/skin/runtime DO force.
    // Leaving it in would have bought nothing and cost a full cluster rebuild every 15 minutes, for
    // a number that repaints itself. Cut. (The runtime label's case is genuinely different: nothing
    // else repaints it.)
    return acts + "|skin:" + model.skin + "|rt:" + runtimeLabel();
  }

  /* ---- THE INK -------------------------------------------------------------- */
  function buildCluster(doc, model, el) {
    var cluster = el(doc, "div", "tsa", { role: "group", "aria-label": "tab-strip actions" });

    // WEATHER — the FIRST thing in the cluster, so it sits immediately LEFT of the version stamp
    // (operator, : "slide the weather dealie all the way to the right, so it's to the left
    // of the | V# ... section"). Reading order is therefore:  [wx] | v# | lock search skin settings.
    //
    // It is a MOUNT, not a build: this module owns the slot and shell/weather.js owns the element.
    // The slot is created unconditionally and stays EMPTY until a reading arrives — and if no
    // reading ever arrives it stays empty forever, which is the whole design (weather.js L1: a
    // reading we do not have renders nothing). An empty slot costs one div and lies about nothing.
    // Cold-safe: no weather module -> no slot, and the cluster reads exactly as it did before.
    if (root.ForestShell.weather) {
      var wxSlot = el(doc, "div", "tsa-wx-slot", { "data-weather-slot": "1" });
      // FOLD THE READING FIRST. render() takes a MODEL, not a reading -- and a raw reading is
      // just close enough to a model to be dangerous: it carries tempF, so a number paints and
      // the bar looks right, while glyph/href/label are all undefined and the element silently
      // becomes a link-less cloud. Caught by mutation M11 going green, not by the eye.
      var wxm = root.ForestShell.weather.weatherModel(lastWeather);
      root.ForestShell.weather.render(wxSlot, wxm);           // repaint from the last reading on a
      cluster.appendChild(wxSlot);                            // re-render, so a toggle never blanks it
    }

    // THE VERSION STAMP MOVED (operator,). It used to be built HERE, as
    // `.tsa-ver`, immediately left of the lock. It now lives under the Loop World
    // wordmark in the brand slot (`[data-app-ver]`, index.html) and is filled by
    // stampVersion() below. This module still OWNS the number and the tooltip -- only
    // the seat moved -- so there is exactly one writer, as before. Cold-safe: no such
    // element in the document -> a silent no-op and the cluster reads as it does now.

    model.actions.forEach(function (a) {
      var cls = "tsa-btn tsa-btn--" + a.id + (a.mod ? " " + a.mod : "");
      var attrs = {
        type: "button", "data-action": a.id,
        "aria-label": a.label, title: a.label
      };
      if (a.pressed !== null) attrs["aria-pressed"] = a.pressed ? "true" : "false";
      if (a.data) { Object.keys(a.data).forEach(function (k) { attrs["data-" + k] = a.data[k]; }); }
      var b = el(doc, "button", cls, attrs);
      var ic = el(doc, "span", "tsa-btn__icon", { "aria-hidden": "true" });
      ic.innerHTML = a.icon;          // static, code-owned SVG (no user data)
      b.appendChild(ic);
      cluster.appendChild(b);
    });
    return cluster;
  }

  function emit(mount, name, detail) {
    var view = mount.ownerDocument && mount.ownerDocument.defaultView;
    var ev;
    if (view && typeof view.CustomEvent === "function") ev = new view.CustomEvent(name, { detail: detail, bubbles: true });
    else ev = { type: name, detail: detail, bubbles: true };
    mount.dispatchEvent(ev);
  }

  function closestAction(node, stop) {
    var n = node;
    while (n && n !== stop) {
      if (n.getAttribute && n.getAttribute("data-action") != null) return n;
      n = n.parentNode;
    }
    return null;
  }

  function wire(mount) {
    if (mount.__forestActionsWired) return;   // delegation: wire ONCE, survives re-render
    mount.__forestActionsWired = true;
    mount.addEventListener("click", function (e) {
      var btn = closestAction(e.target, mount);
      if (!btn) return;
      var id = btn.getAttribute("data-action");
      if (id === "edit-lock") {
        // emit the NEXT state (invert what the button currently reflects)
        var nowUnlocked = btn.getAttribute("aria-pressed") === "true";
        emit(mount, "forest:edit-lock-toggle", { locked: nowUnlocked });  // unlocked now -> lock it
      } else if (id === "search") {
        emit(mount, "forest:actions-search", {});
      } else if (id === "skin") {
        // Emit the NEXT skin, read off the button's own rendered attribute -- the same
        // "emit the state you want, never the state you have" contract edit-lock holds.
        var want = btn.getAttribute("data-skin-next");
        if (want !== "light" && want !== "dark") want = "dark";
        emit(mount, "forest:actions-skin", { skin: want });
      } else if (id === "settings") {
        emit(mount, "forest:actions-settings", {});
      }
    });
  }

  /* ---- the public render — idempotent --------------------------------------- */
  function render(mount, config, opts) {
    if (!mount) return null;                  // cold-safe
    var el = elAtom();
    if (!el) return null;                     // cold-safe: no Block atom
    var doc = mount.ownerDocument;
    var model = actionsModel(config, opts);
    var sig = signature(model);

    wire(mount);
    stampVersion(doc);   // BEFORE the no-op guard: the stamp lives OUTSIDE this mount, so a
                         // re-render the guard swallows must still refresh it (the same lesson
                         // the late-/api/version arrival taught the runtime label).
    renderLock(doc, config, opts);
                         // ALSO before the guard, and for a sharper reason than the stamp: the
                         // lock lives outside this mount AND the guard's signature is computed
                         // over the CLUSTER's model, which no longer carries the lock state at
                         // all. A lock toggle now leaves that signature UNCHANGED -- so a
                         // renderLock() call placed after the guard would be swallowed on the
                         // one re-render it exists to serve, and the padlock would freeze on
                         // whatever face it was wearing at first paint.
    if (mount.__forestActionsSig === sig && mount.__forestActionsBuilt) return model; // no-op re-render

    var cluster = buildCluster(doc, model, el);
    while (mount.firstChild) mount.removeChild(mount.firstChild);
    mount.appendChild(cluster);
    mount.__forestActionsSig = sig;
    mount.__forestActionsBuilt = true;
    return model;
  }

  root.ForestShell.tabstripActions = {
    actionsModel: actionsModel,
    render: render,
    stampVersion: stampVersion, // — fills [data-app-ver] in the brand slot
    renderLock: renderLock, // — fills [data-lock-slot], stacked under the "+"
    lockModel: lockModel,
    stampRuntime: stampRuntime, // — runtime-version.js re-stamps in place on a late fetch
    runtimeLabel: runtimeLabel,
    setWeather: setWeather, // — weather-boot.js pushes the NWS reading in (late + on a timer)
    _weather: function () { return lastWeather; },   // read-only peek, for tests
    _version: "1.5" // 1.5: the EDIT-LOCK moved out of the cluster into the tab strip, stacked under the "+" ([data-lock-slot]); revives the never-matching.tsa-btn--lock rule (operator). 1.4: the version stamp MOVED to the brand slot, under the Loop World wordmark (operator). 1.3: the WEATHER slot -- a live NWS reading, left of the version stamp (operator)
  };
})();
