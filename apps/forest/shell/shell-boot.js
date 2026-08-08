/* Shea's Forest — the App Shell · shell/shell-boot.js
   The real store-backed boot (STEP 4 gating dependency landed). Renders the strip
   into #forest-tab-strip and the pane into #forest-pane, registers the live pane
   renderers, and — the new part — PERSISTS the view-config through the store, so a
   user's tabs survive a reload. This closes the write loop the pure shell modules
   (view-config/tab-strip/pane) deliberately left out.

   Flow:
     • load the saved view-config from the store (V1 = localStorage; swap to the
       runtime backend for sovereign, cross-device persistence — one line). The load
       is TRI-STATE — found | empty | error — and the three are treated differently:
         - FOUND: honor the saved config exactly (even an empty {tabs:[]} one).
         - EMPTY (a genuine first run, nothing saved): seed from the live projection —
           the user's REAL groves + the horizon surfaces as OPEN tabs — IN MEMORY, and
           do NOT auto-persist. The seed is saved on the operator's first real edit, so
           an unedited fresh boot writes nothing (there is nothing yet to clobber).
         - ERROR (server down / unreachable / unparseable — NOT "no config saved"):
           show a default READ-ONLY, do NOT persist (persisting a default over an
           unreachable-but-real config is the data-loss this leg exists to stop), and
           schedule a bounded retry; on a later `found`, adopt the real config.
     • wire the persist loop: the strip's pin/unpin/reorder/close events mutate the
       config, save it, and re-render the strip (the strip is wired-once via event
       delegation, so re-render is safe). The "+" catalog (open-catalog) is STEP 4.

   Plain script (no ES module); cold-safe throughout — any missing piece or read
   failure falls back to an empty boot (strip shows just "+"). */
(function () {
  "use strict";
  function boot() {
    var shell = window.ForestShell;
    if (!shell || !shell.tabStrip || !shell.viewConfig || !shell.pane) return; // cold-safe
    var stripEl = document.getElementById("forest-tab-strip");
    var paneEl = document.getElementById("forest-pane");
    var actionsEl = document.querySelector("[data-app-actions]"); // Track B: the top-bar actions slot
    if (!stripEl && !paneEl) return;

    if (shell.renderers && shell.renderers.registerAll) shell.renderers.registerAll(shell.pane);

    // The view-config persists in the FOREST — server-side under the owner's session
    // (GET/PUT/DELETE /view-config), so the tab layout survives the browser and follows
    // the owner across devices (the data-sovereignty posture). The store is an interface,
    // so this is a one-line backend choice; localStorage remains available for local/dev.
    var store = (shell.viewConfigStore && shell.viewConfigStore.makeStore && shell.viewConfigStore.runtimeBackend)
      ? shell.viewConfigStore.makeStore(shell.viewConfigStore.runtimeBackend())
      : ((shell.viewConfigStore && shell.viewConfigStore.defaultStore) ? shell.viewConfigStore.defaultStore() : null);
    var read  = (shell.renderers && shell.renderers.makeForestRead) ? shell.renderers.makeForestRead() : null;

    var cfg = shell.viewConfig.createDefault();
    var snapshot;   // the projection data, shared to the pane

    // ── THE SELECTED TAB (— the operator's note #1) ────────────────────────
    // `forest:tab-select` had exactly ONE listener in the whole shell: pane.js:433,
    // which swapped the PANE and told nobody. shell-boot never heard it, so it never
    // repainted the strip — and paintStrip() did not pass an `active` anyway, so
    // tab-strip.js:101 fell through to its landing default (`opts.active || landing`)
    // on EVERY render. The highlight was therefore welded to the LEFTMOST tab for the
    // life of the session, no matter which app you opened. Two stacked defects; either
    // one alone is sufficient to break it, which is why the strip's own suite (which
    // passes `active` explicitly) has always been green while the live app was wrong.
    //
    // The gold disc (.tab__disc, tab-strip.js:180) rides `t.active`, so it was stuck on
    // tab 1 too — the operator's note #2 ("a black circle on the first minimized tab")
    // is not a second bug, it is this bug's second symptom.
    //
    // The host owns the selection because the host owns the config + the repaint; the
    // strip stays a pure fold (it is TOLD what is active, it never decides).
    var activeCap = null;

    function persist() { if (store) { try { store.save(cfg); } catch (e) {} } } // fire-and-forget

    /* -- THE SKIN (-- the operator's note #7) ----------------------------------
     * LIGHT IS THE DEFAULT AND THE OPERATOR CHOSE IT. Do not "restore" dark: a handoff once
     * asserted dark was ratified at, but the record shows he answered "A" to a
     * BUILD PLAN and the dark default was a line item inside Claude's own proposed §8
     * defaults. An accept of a package is not a vote on every line in it (lesson seq=677).
     *
     * THIS FUNCTION IS THE WHOLE SEAM, and the seam is where note #1 died. tabstrip-actions
     * is a pure fold: it renders a button and EMITS. It cannot reach the document root and
     * must not try. This host owns the single write loop -- config -> DOM -> store -- exactly
     * as it does for edit-lock. Nothing else in the shell writes data-theme.
     *
     * The <html> element is the only place the attribute means anything: tokens.css keys the
     * light variant off :root[data-theme="light"]. Cold-safe: no document -> no-op. */
    function applySkin(skin) {
      if (skin !== "light" && skin !== "dark") skin = "light";
      try {
        var d = (stripEl && stripEl.ownerDocument) || (typeof document !== "undefined" ? document : null);
        if (d && d.documentElement && d.documentElement.setAttribute) {
          d.documentElement.setAttribute("data-theme", skin);
        }
      } catch (e) {}
      return skin;
    }

    /* Read the skin out of the LIVE config and put it on the root. Called on boot (after the
     * saved config lands) and after every toggle -- one function, one truth, so a reload and
     * a click can never disagree about what is on screen. */
    function syncSkin() {
      if (!shell.viewConfig || !shell.viewConfig.skinOf) return "light";
      return applySkin(shell.viewConfig.skinOf(cfg));
    }

    // §3f — the OPT-IN unread count persists like any user preference. The mail
    // view repaints its own count slot in-place and dispatches forest:count-toggle up to
    // here (bubbling to the pane host); this host just SAVES the bit so the choice survives
    // a reload — the exact twin of the badges toggle wiring below. Cold-safe: no setCount /
    // no pane -> a silent no-op.
    if (paneEl && paneEl.addEventListener && !paneEl.__forestCountWired) {
      paneEl.__forestCountWired = true;
      paneEl.addEventListener("forest:count-toggle", function (e) {
        if (!shell.viewConfig || !shell.viewConfig.setCount) return;
        var next = !!(e && e.detail && e.detail.enabled);
        cfg = shell.viewConfig.setCount(cfg, next);
        persist();
      });
    }

    // v9 — row density persists like any user preference, the value-carrying twin
    // of the count toggle above. The mail view's Settings control dispatches forest:density
    // up to the pane host; this host SAVES the value so the choice survives a reload (the
    // in-Settings applyDensity already applied it to the live list). Cold-safe: no setDensity
    // / no pane -> a silent no-op.
    if (paneEl && paneEl.addEventListener && !paneEl.__forestDensityWired) {
      paneEl.__forestDensityWired = true;
      paneEl.addEventListener("forest:density", function (e) {
        if (!shell.viewConfig || !shell.viewConfig.setDensity) return;
        var v = (e && e.detail && e.detail.density) || "comfortable";
        cfg = shell.viewConfig.setDensity(cfg, v);
        persist();
      });
    }

    // Color seam step 2 — a calendar's rail dot opens the Grove-slot recolor picker; on a
    // pick the calendar view repaints its own dot + grid in-place and dispatches
    // forest:cal-recolor { id, slot } up to this pane host (slot === null ⇒ revert). This
    // host just PERSISTS the override so the choice survives a reload — the exact twin of
    // the count/density wiring above. Cold-safe: no setCalColor / no pane -> a silent no-op.
    if (paneEl && paneEl.addEventListener && !paneEl.__forestCalRecolorWired) {
      paneEl.__forestCalRecolorWired = true;
      paneEl.addEventListener("forest:cal-recolor", function (e) {
        if (!shell.viewConfig || !shell.viewConfig.setCalColor) return;
        var d = e && e.detail; if (!d || !d.id) return;
        var slot = d.slot;
        cfg = (slot === null || slot === undefined)
          ? (shell.viewConfig.revertCalColor ? shell.viewConfig.revertCalColor(cfg, d.id) : cfg)
          : shell.viewConfig.setCalColor(cfg, d.id, slot);
        persist();
      });
    }

    // Reorder seam (verb 4) — the calendar rail drag repaints its own slots in-place
    // (optimistic) and dispatches forest:cal-reorder { order } up to this pane host,
    // carrying the WHOLE new order array. This host just PERSISTS it so the arrangement
    // survives a reload — the exact twin of the recolor wiring above (a set-and-forget
    // pref, not a server write). Cold-safe: no setCalOrder / no pane -> a silent no-op.
    if (paneEl && paneEl.addEventListener && !paneEl.__forestCalReorderWired) {
      paneEl.__forestCalReorderWired = true;
      paneEl.addEventListener("forest:cal-reorder", function (e) {
        if (!shell.viewConfig || !shell.viewConfig.setCalOrder) return;
        var d = e && e.detail; if (!d || !d.order) return;
        cfg = shell.viewConfig.setCalOrder(cfg, d.order);
        persist();
      });
    }

    // Delete seam (verb 6) — the calendar rail's ✕ inline-confirm removes a real
    // calendar (the runtime arm reassigns its events to Unassigned and drops the row)
    // and dispatches forest:cal-delete { id } up to this pane host. This host owns ONLY
    // the persisted CLIENT prefs (exactly like the recolor/reorder twins above, not a
    // server write): it STRIPS the deleted id from BOTH keys — its colour override
    // (revertCalColor) AND its rail-order entry (setCalOrder minus the id) — so the
    // deleted calendar leaves no residue that could resurface if an id were ever reused.
    // Cold-safe: no viewConfig / no pane -> a silent no-op.
    if (paneEl && paneEl.addEventListener && !paneEl.__forestCalDeleteWired) {
      paneEl.__forestCalDeleteWired = true;
      paneEl.addEventListener("forest:cal-delete", function (e) {
        if (!shell.viewConfig) return;
        var d = e && e.detail; if (!d || !d.id) return;
        var id = d.id, changed = false;
        if (shell.viewConfig.revertCalColor) {
          cfg = shell.viewConfig.revertCalColor(cfg, id); changed = true;
        }
        if (shell.viewConfig.calOrderOf && shell.viewConfig.setCalOrder) {
          var order = shell.viewConfig.calOrderOf(cfg).filter(function (x) { return x !== id; });
          cfg = shell.viewConfig.setCalOrder(cfg, order); changed = true;
        }
        if (changed) persist();
      });
    }

    // GROUPS V1 — the contacts rail's managed-group seam (the exact forest:cal-* twin).
    // The contacts renderer repaints its own rail in-place (optimistic) and dispatches
    // forest:contact-group-{create,recolor,delete} up to this pane host. A declared
    // group's existence+colour is a persisted CLIENT pref (view-config.contactGroups),
    // NOT a server write — its MEMBERSHIP rides the label API the record already drives.
    // This host owns ONLY the persist: create/recolor -> setContactGroup, delete ->
    // removeContactGroup. Cold-safe: no viewConfig / no pane -> a silent no-op.
    if (paneEl && paneEl.addEventListener && !paneEl.__forestContactGroupWired) {
      paneEl.__forestContactGroupWired = true;
      paneEl.addEventListener("forest:contact-group-create", function (e) {
        if (!shell.viewConfig || !shell.viewConfig.setContactGroup) return;
        var d = e && e.detail; if (!d || !d.name) return;
        cfg = shell.viewConfig.setContactGroup(cfg, d.name, null);   // declare (colour = deterministic default)
        persist();
      });
      paneEl.addEventListener("forest:contact-group-recolor", function (e) {
        if (!shell.viewConfig || !shell.viewConfig.setContactGroup) return;
        var d = e && e.detail; if (!d || !d.name) return;
        var slot = d.slot;
        cfg = shell.viewConfig.setContactGroup(cfg, d.name, (typeof slot === "number") ? slot : null);
        persist();
      });
      paneEl.addEventListener("forest:contact-group-delete", function (e) {
        if (!shell.viewConfig || !shell.viewConfig.removeContactGroup) return;
        var d = e && e.detail; if (!d || !d.name) return;
        cfg = shell.viewConfig.removeContactGroup(cfg, d.name);      // un-declare; membership labels are the tool's
        persist();
      });
      paneEl.addEventListener("forest:contact-group-reorder", function (e) {
        if (!shell.viewConfig || !shell.viewConfig.setContactGroupOrder) return;
        var d = e && e.detail; if (!d || !Array.isArray(d.order)) return;
        cfg = shell.viewConfig.setContactGroupOrder(cfg, d.order);   // reorder declared groups; ORDER only, membership untouched
        persist();
      });
      paneEl.addEventListener("forest:owner-profile-save", function (e) {
        if (!shell.viewConfig || !shell.viewConfig.setOwnerProfile) return;
        var d = e && e.detail;                                       // {profile} sets, null/absent clears — My Card (D2=b)
        cfg = shell.viewConfig.setOwnerProfile(cfg, d && d.profile);
        persist();
      });
      paneEl.addEventListener("forest:owner-contact-id-set", function (e) {
        if (!shell.viewConfig || !shell.viewConfig.setOwnerContactId) return;
        var d = e && e.detail; // {id} designates a contact as owner, null clears — P3 s2
        cfg = shell.viewConfig.setOwnerContactId(cfg, d && d.id);
        persist();
      });
    }

    // E1 — cross-app "Email from a contact". A contacts record's "Email" action dispatches
    // forest:compose {to} up to this pane host; the host (1) ensures the Mail app is open and
    // (2) activates its tab via the SAME forest:tab-select event a manual Mail-tab click fires
    // (so navigation is identical to clicking Mail), then (3) hands the address to Mail, which
    // OWNS compose (opens a pre-addressed compose overlay). Contacts only carried the address
    // (TC-1). Cold-safe throughout: a missing address / renderer / strip -> best-effort no-op,
    // never a boot throw.
    if (paneEl && paneEl.addEventListener && !paneEl.__forestComposeWired) {
      paneEl.__forestComposeWired = true;
      paneEl.addEventListener("forest:compose", function (e) {
        var to = (e && e.detail && e.detail.to) || "";
        if (!to) return;
        try {
          if (shell.viewConfig && shell.viewConfig.addOpen) {
            cfg = shell.viewConfig.addOpen(cfg, "mail:inbox"); // idempotent (mail is seeded first anyway)
            persist();
            try { paintStrip(); } catch (x) { /* wired-once render; safe */ }
          }
          if (stripEl && typeof stripEl.dispatchEvent === "function" && typeof CustomEvent === "function") {
            stripEl.dispatchEvent(new CustomEvent("forest:tab-select", { detail: { capability: "mail:inbox" }, bubbles: true }));
          }
        } catch (x2) { /* navigation is best-effort; the compose hand-off below still runs */ }
        try {
          var mr = shell.mailRenderer;
          if (mr && typeof mr.openComposeTo === "function") mr.openComposeTo(to);
        } catch (x3) { /* cold-safe */ }
      });
    }

    // E3 (the Weave) — forest:add-to-calendar { title, notes } up to this pane host, the
    // calendar sibling of forest:compose above. A mail message dispatches it; the host (1)
    // ensures the Calendar app tab is open, (2) activates it via the SAME forest:tab-select a
    // manual Calendar-tab click fires, then (3) hands the { title, notes } seed to Calendar,
    // which OWNS its create form (opens it prefilled — NO date, option A: the user picks the
    // time). Mail only carried title+notes (TC-1). Cold-safe throughout: a missing seed /
    // renderer / strip -> best-effort no-op, never a boot throw.
    if (paneEl && paneEl.addEventListener && !paneEl.__forestAddToCalendarWired) {
      paneEl.__forestAddToCalendarWired = true;
      paneEl.addEventListener("forest:add-to-calendar", function (e) {
        var seed = (e && e.detail) || {};
        if (!seed.title && !seed.notes) return;
        try {
          if (shell.viewConfig && shell.viewConfig.addOpen) {
            cfg = shell.viewConfig.addOpen(cfg, "calendar:month"); // idempotent
            persist();
            try { paintStrip(); } catch (x) { /* wired-once render; safe */ }
          }
          if (stripEl && typeof stripEl.dispatchEvent === "function" && typeof CustomEvent === "function") {
            stripEl.dispatchEvent(new CustomEvent("forest:tab-select", { detail: { capability: "calendar:month" }, bubbles: true }));
          }
        } catch (x2) { /* navigation is best-effort; the prefill hand-off below still runs */ }
        try {
          var cr = shell.calendarRenderer;
          if (cr && typeof cr.openNewPrefilled === "function") cr.openNewPrefilled(seed);
        } catch (x3) { /* cold-safe */ }
      });
    }

    // STEP 6 — badges. The weather map is folded ONCE per snapshot (cached inside
    // shell.badges) and fed to every strip render; the pin/close/reorder re-renders
    // reuse the cache (never a per-render edge walk). OFF by default -> {} -> no dots.
    function weatherNow() {
      return (shell.badges && shell.badges.weatherFor) ? shell.badges.weatherFor(cfg, snapshot) : null;
    }
    function paintStrip() {
      // `active` is passed EXPLICITLY. Omitting it is not a no-op — tab-strip falls back
      // to the landing tab, which is a silent wrong answer, not a missing one.
      if (stripEl) shell.tabStrip.render(stripEl, cfg, { active: activeCap, weather: weatherNow() });
      paintToggle();
    }
    // The host's ear on the strip's own event. pane.js listens for the same event to swap
    // the pane; this listener is what keeps the STRIP's chrome in step with it. Wired once,
    // idempotent, cold-safe (no strip -> no wire, and paintStrip is already null-guarded).
    function wireSelection() {
      if (!stripEl || stripEl.__forestSelectionWired) return;
      stripEl.__forestSelectionWired = true;
      stripEl.addEventListener("forest:tab-select", function (e) {
        var cap = e && e.detail && e.detail.capability;
        if (!cap || cap === activeCap) return;   // idempotent: same tab -> no repaint
        activeCap = cap;
        try { paintStrip(); } catch (x) {}
      });
    }
    // The resting selection is the landing tab — the same tab the pane renders on a cold
    // boot (pane.js:441). Deriving it here rather than leaving `activeCap` null keeps the
    // strip and the pane agreeing from the first frame, instead of agreeing by coincidence
    // because both happened to default to the same fallback.
    function seedSelection() {
      if (activeCap) return;
      var landing = shell.viewConfig.landingTab ? shell.viewConfig.landingTab(cfg) : null;
      activeCap = landing ? landing.capability : null;
    }
    // the toggle lives in its own mount right after the strip (created if absent,
    // so index.html needs no change); wired ONCE, re-rendered idempotently.
    var toggleEl = null;
    function toggleMount() {
      if (toggleEl) return toggleEl;
      if (!stripEl || !stripEl.ownerDocument) return null;
      var doc = stripEl.ownerDocument;
      toggleEl = doc.getElementById && doc.getElementById("forest-badges-toggle");
      if (!toggleEl) {
        toggleEl = doc.createElement("div");
        toggleEl.id = "forest-badges-toggle";
        toggleEl.className = "forest-badges-toggle-host";
        if (stripEl.parentNode) stripEl.parentNode.insertBefore(toggleEl, stripEl.nextSibling);
        else stripEl.appendChild(toggleEl);
        toggleEl.addEventListener("forest:badges-toggle", function (e) {
          var next = !!(e && e.detail && e.detail.enabled);
          cfg = shell.viewConfig.setBadges(cfg, next);   // persist like any user preference
          persist();
          paintStrip();                                   // repaint dots on/off immediately
        });
      }
      return toggleEl;
    }
    function paintToggle() {
      // The per-tab weather toggle ("● weather" pill, right of the tabs) is removed
      // by operator directive. Left as a no-op so the call sites stay put
      // and the pill is never mounted; badges.js is untouched (still testable).
      return;
    }

    function wirePersist() {
      if (!stripEl || stripEl.__forestPersistWired) return;
      stripEl.__forestPersistWired = true;
      function onMutate(mut) {
        return function (e) {
          // Track B — edit-lock gate: when LOCKED, the tab set is frozen,
          // so pin/unpin/close/reorder no-op (the strip also hides their affordances
          // via CSS; this is the host-side half of the same truth). Opening/adding an
          // app (catalog pick/compose) is NOT gated — that is the core loop.
          if (shell.viewConfig.editLocked && shell.viewConfig.editLocked(cfg)) return;
          var cap = e && e.detail && e.detail.capability;
          if (!cap) return;
          cfg = mut(cap, e.detail);
          persist();
          try { paintStrip(); } catch (x) {}   // wired-once -> safe re-render (badges cache reused; no edge walk)
        };
      }
      stripEl.addEventListener("forest:tab-pin",     onMutate(function (cap) { return shell.viewConfig.pin(cfg, cap); }));
      stripEl.addEventListener("forest:tab-unpin",   onMutate(function (cap) { return shell.viewConfig.unpin(cfg, cap); }));
      stripEl.addEventListener("forest:tab-close",   onMutate(function (cap) { return shell.viewConfig.close(cfg, cap); }));
      stripEl.addEventListener("forest:tab-reorder", onMutate(function (cap, d) { return shell.viewConfig.reorder(cfg, cap, d.newIndexInTier); }));
      stripEl.addEventListener("forest:tab-open-catalog", function () { openCatalog(); });

      /* THE RENAME (item 3 slice B) — bound on `.app-topbar`, NOT on stripEl.
         This reuses the surface item 4 already hoisted for `forest:edit-lock-toggle`
         rather than opening a new one; the event bubbles, so one binding covers the
         strip today and survives the next relocation of a control inside the bar.
         Cold-safe: no topbar in the document -> fall back to stripEl, which is where
         the event originates anyway, so the fallback is correct and not merely safe.

         It rides `onMutate`, which means it inherits the edit-lock gate: a locked
         config freezes tab editing and a rename IS tab editing. The strip refuses to
         open the editor when locked; this refuses to write if one is opened anyway.
         Two gates, and neither is the other's excuse.

         `label` may legitimately be "" — that is REVERT (setTabLabel deletes the entry
         and the fold falls back to labelFor()), so it must not be guarded away as
         "empty". Only `capability` is required, and onMutate already checks it. */
      var renameHost = (stripEl.closest && stripEl.closest(".app-topbar")) || stripEl;
      renameHost.addEventListener("forest:tab-rename", onMutate(function (cap, d) {
        return shell.viewConfig.setTabLabel(cfg, cap, (d && typeof d.label === "string") ? d.label : "");
      }));
    }

    /* ---- Track B — the actions cluster (edit-lock · search · settings) --- *
     * Mounts the icon-buttons into the FIXED .app-actions slot and owns their write  *
     * loop, the exact separation the strip mutators hold: the cluster EMITS, this    *
     * host mutates + persists + repaints. edit-lock is the live one; search opens    *
     * the app catalog (the finder); settings is an honest-deferred surface (real     *
     * button, its consolidated home lands with P->M). Cold-safe throughout.          */
    function syncLock() {
      if (stripEl && shell.viewConfig.editLocked) {
        stripEl.classList.toggle("is-locked", shell.viewConfig.editLocked(cfg));
      }
    }
    function paintActions() {
      if (actionsEl && shell.tabstripActions) {
        try { shell.tabstripActions.render(actionsEl, cfg); } catch (e) {}
      }
      syncLock();   // strip's locked/unlocked chrome follows the same truth
    }
    function wireActions() {
      if (!actionsEl || actionsEl.__forestActionsHostWired) return;
      actionsEl.__forestActionsHostWired = true;
      /* THE LISTENER IS HOISTED (operator item 4,). The lock button no longer
         lives in actionsEl -- it is seated in the tab strip, stacked under the "+" -- and
         `forest:edit-lock-toggle` is now dispatched from a mount inside #forest-tab-strip.
         A listener bound to actionsEl would never hear it, and the failure is SILENT: the
         padlock paints, hovers, focuses, and does nothing.
         So the binding moves UP to the nearest shared ancestor of both mounts (.app-topbar,
         which contains the strip and the actions cluster alike). The event already bubbles,
         so this is one binding instead of two -- and it survives the NEXT relocation of this
         button inside the bar without anyone having to remember this comment.
         Cold-safe: no topbar found -> fall back to actionsEl, the pre-move behaviour. */
      var lockHost = (actionsEl.closest && actionsEl.closest(".app-topbar")) || actionsEl;
      lockHost.addEventListener("forest:edit-lock-toggle", function (e) {
        if (!shell.viewConfig.setEditLocked) return;
        var locked = !!(e && e.detail && e.detail.locked);
        cfg = shell.viewConfig.setEditLocked(cfg, locked);
        persist();
        try { paintActions(); } catch (x) {}   // repaint lock icon (gold<->electric)
        try { paintStrip(); } catch (x) {}      // repaint strip (affordances retract/return)
      });
      actionsEl.addEventListener("forest:actions-search", function () {
        // THE SEARCH ARC, leg 2. This used to call openCatalog — "the app catalog
        // IS the finder". That is not overturned, it is ABSORBED: the empty query renders exactly
        // the catalog and fires no network, so the old behaviour is a PROPER SUBSET of the new
        // surface and there is no regression to guard. The "+" button (forest:tab-open-catalog,
        // above) still calls openCatalog() and is byte-unchanged.
        openSearch();
      });
      actionsEl.addEventListener("forest:actions-skin", function (e) {
        if (!shell.viewConfig || !shell.viewConfig.setSkin) return;   // cold-safe
        var want = e && e.detail && e.detail.skin;
        cfg = shell.viewConfig.setSkin(cfg, want);   // setSkin normalizes junk -> light
        syncSkin();                                   // THE SEAM: config -> <html data-theme>
        persist();                                    // survives the reload
        try { paintActions(); } catch (x) {}          // moon <-> sun, and the label with it
      });
      actionsEl.addEventListener("forest:actions-settings", function () {
        toggleSettings();                       // open/close the Settings pane (Sources lives here)
      });
    }

    // The Settings pane (Sources: the connect-Google surface, re-seated in the
    // frame — Track F dropped the grove-homepage that mounted it). The markup lives in
    // index.html (#settings-pane) so app.js's connector code (loadConnectors /
    // loadLinkPanel / initLinkPanel) finds its mounts at load and fills them on the live
    // read. This owns the pane's LIFECYCLE: open · close · the exit (button · Escape).
    //
    // ── THE EXIT IS WIRED AT BOOT, NOT INSIDE A DOOR ───────────────────────
    // It used to be wired lazily inside openSettings() behind a one-shot `settingsWired`
    // flag. That made the exit a PROPERTY OF THE DOOR YOU CAME THROUGH. When the 1.35
    // connector alarm added a SECOND door (app.js's "Open Settings"/"Re-link" button, which
    // reached straight into `pane.hidden = false`), openSettings() never ran, the flag never
    // flipped, and the close button + Escape were both DEAD — a modal with no way out, live
    // in prod. The suite stayed green because its "wires the close control" check was
    // `has(boot, "[data-settings-close]")` — a grep of the SOURCE TEXT, which proves the
    // wiring was TYPED and can never see a door that skips it.
    //
    // So the exit no longer depends on which door opened the pane, or on any door running at
    // all: wireSettingsExit() fires once at boot (and defensively from openSettings, for a
    // pane injected after boot). A future third entrance CANNOT re-arm this trap — the worst
    // it can do is skip focus management. Doors are cheap; exits are structural.
    //
    // app.js no longer touches `pane.hidden` — it dispatches `forest:open-settings` and this
    // module owns the mutation (the Block Principle: the joint is the design).
    function settingsPane() {
      var doc = (actionsEl && actionsEl.ownerDocument) || document;
      return doc.getElementById("settings-pane");
    }
    function closeSettings() {
      var pane = settingsPane(); if (!pane) return;
      pane.hidden = true;
      var gear = actionsEl && actionsEl.querySelector('[data-action="settings"]');
      if (gear && gear.focus) { try { gear.focus(); } catch (x) {} }
    }
    // Idempotent, door-independent. The guard lives on the PANE NODE (not a closure flag) so
    // it holds even if this runs from more than one call site.
    function wireSettingsExit() {
      var pane = settingsPane();
      if (!pane || pane.__forestSettingsExitWired) return;
      pane.__forestSettingsExitWired = true;
      var closeBtn = pane.querySelector("[data-settings-close]");
      if (closeBtn) closeBtn.addEventListener("click", closeSettings);
      var doc = (actionsEl && actionsEl.ownerDocument) || document;
      doc.addEventListener("keydown", function (ev) {
        if ((ev.key === "Escape" || ev.key === "Esc") && pane && !pane.hidden) closeSettings();
      });
    }
    function openSettings(pane) {
      pane.hidden = false;
      wireSettingsExit();                         // belt: a pane injected after boot still gets its exit
      var focusTarget = pane.querySelector("[data-settings-close]");
      if (focusTarget && focusTarget.focus) { try { focusTarget.focus(); } catch (x) {} }
    }
    function toggleSettings() {
      var pane = settingsPane();
      if (!pane) { settingsDefer(); return; }     // cold-safe fallback (no pane in this index.html)
      if (pane.hidden) openSettings(pane); else closeSettings();
    }
    // The explicit OPEN seam (never a toggle — a caller asking to open must not close an
    // already-open pane). This is the ONLY way in for anything outside this module.
    function wireSettingsOpenSeam() {
      var doc = (actionsEl && actionsEl.ownerDocument) || document;
      if (doc.__forestSettingsOpenSeamWired) return;
      doc.__forestSettingsOpenSeamWired = true;
      doc.addEventListener("forest:open-settings", function () {
        var pane = settingsPane();
        if (!pane) { settingsDefer(); return; }   // cold-safe, same as the gear
        openSettings(pane);
      });
    }

    // Cold-safe fallback ONLY — the honest-deferred pop, kept for an index.html that has
    // no #settings-pane so the gear is never a dead click.
    var settingsEl = null;
    function settingsDefer() {
      var doc = (actionsEl && actionsEl.ownerDocument) || document;
      if (settingsEl && settingsEl.parentNode) {   // toggle off if already open
        settingsEl.parentNode.removeChild(settingsEl); settingsEl = null; return;
      }
      settingsEl = doc.createElement("div");
      settingsEl.className = "tsa-settings-pop";
      settingsEl.setAttribute("role", "dialog");
      settingsEl.setAttribute("aria-label", "Settings");
      settingsEl.innerHTML =
        '<p class="tsa-settings-pop__t">Settings</p>' +
        '<p class="tsa-settings-pop__d">Your preferences consolidate here.</p>';
      (doc.body || doc.documentElement).appendChild(settingsEl);
      var gear = actionsEl && actionsEl.querySelector('[data-action="settings"]');
      if (gear && gear.getBoundingClientRect) {
        var r = gear.getBoundingClientRect();
        settingsEl.style.position = "fixed";
        settingsEl.style.top = (r.bottom + 8) + "px";
        settingsEl.style.right = Math.max(8, (doc.documentElement.clientWidth - r.right)) + "px";
      }
      setTimeout(function () {
        doc.addEventListener("click", function onAway(ev) {
          if (settingsEl && !settingsEl.contains(ev.target) && !(gear && gear.contains(ev.target))) {
            if (settingsEl.parentNode) settingsEl.parentNode.removeChild(settingsEl);
            settingsEl = null; doc.removeEventListener("click", onAway);
          }
        });
      }, 0);
    }

    function paint() {
      try {
        syncSkin();     // the SAVED skin reaches the document root before anything paints
        paintStrip();
        paintActions();
        // — hand the pool its MENU host. The pool's unit is now the VIEW {pane, menu};
        // it writes each app's name+V# anchor into [data-app-menu] and hands the app the body.
        // Cold-safe: a missing [data-app-menu] -> menu-less, byte-identical to.
        if (paneEl)  shell.pane.mount(paneEl, { strip: stripEl || document, menu: document.querySelector("[data-app-menu]"), config: cfg, data: snapshot });
      } catch (e) { if (window.console && console.warn) console.warn("[forest-shell] boot render skipped:", e && e.message); }
    }

    // The "+" catalog (STEP 4, last piece): open a modal pick-list of every addable
    // capability (index-catalog folds it), and on a pick WRITE the view-config, persist,
    // re-render the strip, and close. The panel + model are pure (read/compute/emit);
    // this host owns the single write loop — same separation as the strip mutators above.
    var catalogEl = null;
    function catalogMount() {
      if (catalogEl) return catalogEl;
      var doc = (stripEl && stripEl.ownerDocument) || document;
      catalogEl = (doc.getElementById && doc.getElementById("forest-catalog")) || null;
      if (!catalogEl) {
        catalogEl = doc.createElement("div");
        catalogEl.id = "forest-catalog";
        catalogEl.className = "forest-catalog-overlay";
        (doc.body || doc.documentElement).appendChild(catalogEl);
      }
      if (!catalogEl.__forestCatalogHostWired) {   // wire pick + close ONCE (the panel emits them)
        catalogEl.__forestCatalogHostWired = true;
        catalogEl.addEventListener("forest:catalog-pick", function (e) {
          var cap = e && e.detail && e.detail.capability;
          if (!cap || !shell.viewConfig) return;
          cfg = shell.viewConfig.pin(cfg, cap);    // operator's call, spec §3.4: a pick PINS
          persist();
          try { paintStrip(); } catch (x) {}  // wired-once -> safe
          if (shell.indexPanel) shell.indexPanel.close(catalogEl);                // one pick -> close
        });
        catalogEl.addEventListener("forest:catalog-close", function () {
          if (shell.indexPanel) shell.indexPanel.close(catalogEl);
        });

        // SEARCH, leg 2. The panel asks (debounced); the HOST fetches. Same separation as pick:
        // the panel is pure of network, this host owns every reach.
        catalogEl.addEventListener("forest:search-query", function (e) {
          runSearch((e && e.detail && e.detail.q) || "");
        });

        // SEARCH, leg 2 — a result was clicked. {store,id} -> open the app that result lives in,
        // via the SAME forest:tab-select a manual tab click fires (the E1/E3 cross-app idiom).
        //
        // ⚠ HONEST GAP, NAMED RATHER THAN PAPERED: none of the three renderers exports an
        // open-by-id seam today (contacts has openRecord, calendar has openRecord — both are
        // INTERNAL closures; mail exports openComposeTo but nothing to open a message). So the
        // hand-off below is wired, cold-safe, and CURRENTLY LANDS NOWHERE: a click takes you to
        // the right app, not yet to the record inside it. That is real value and it is not a lie
        // — but it is less than the affordance implies, so it is routed as owed
        // (`forest-search-open-by-id-seams`), not quietly shipped as done. When a renderer grows
        // openById(id), this line starts working with no change here.
        catalogEl.addEventListener("forest:search-open", function (e) {
          var d = (e && e.detail) || {};
          var CAP = { contacts: "contacts:people", calendar: "calendar:month", mail: "mail:inbox" };
          var cap = CAP[d.store];
          if (!cap) return;                                    // an unknown store opens nothing
          try {
            if (shell.viewConfig && shell.viewConfig.addOpen) {
              cfg = shell.viewConfig.addOpen(cfg, cap);        // idempotent
              persist();
              try { paintStrip(); } catch (x) {}
            }
            if (stripEl && typeof stripEl.dispatchEvent === "function" && typeof CustomEvent === "function") {
              stripEl.dispatchEvent(new CustomEvent("forest:tab-select", { detail: { capability: cap }, bubbles: true }));
            }
          } catch (x2) { /* navigation is best-effort; the record hand-off below still runs */ }
          try {
            var R = { contacts: shell.contactsRenderer, calendar: shell.calendarRenderer, mail: shell.mailRenderer };
            var r = R[d.store];
            if (r && typeof r.openById === "function") r.openById(String(d.id));   // the seam, when it lands
          } catch (x3) { /* cold-safe */ }
          if (shell.indexPanel) shell.indexPanel.close(catalogEl);   // one open -> close
        });
        // §3.8: the compose-CREATION handler — twin of the pick handler above.
        // The panel emits forest:catalog-compose {capA,capB}; the host builds the
        // grove:a⊗b capability via composeRef (the ONE grammar source of truth) and,
        // on ok, PINS it (spec §3.4: a creation writes the config), persists, re-renders,
        // closes. On !ok it pins NOTHING (the panel's exclusions prevent most !ok cases;
        // this is the defensive backstop, and composeRef's guards are the grammar floor).
        catalogEl.addEventListener("forest:catalog-compose", function (e) {
          var d = e && e.detail;
          var capA = d && d.capA, capB = d && d.capB;
          if (!capA || !capB || !shell.viewConfig || !shell.viewConfig.composeRef) return;
          var r = shell.viewConfig.composeRef(capA, capB);
          if (!r || !r.ok) return;                    // !ok -> pin nothing
          cfg = shell.viewConfig.pin(cfg, r.capability);   // pin the grove:a⊗b tab
          persist();
          try { paintStrip(); } catch (x) {}  // wired-once -> safe
          if (shell.indexPanel) shell.indexPanel.close(catalogEl);   // one compose -> close
        });
      }
      return catalogEl;
    }
    function openCatalog() {
      if (!shell.indexCatalog || !shell.indexPanel) return;   // cold-safe: no STEP-4 modules loaded
      var catalog = shell.indexCatalog.buildCatalog(snapshot, cfg);
      shell.indexPanel.open(catalogMount(), catalog);
    }

    /* ═══════════════════ THE SEARCH ARC, leg 2 — the wiring ═══════════════
     * The magnifying glass opens a FEDERATED search over four stores. The pieces were all
     * already here; this is the joint:
     *
     *   searchStores.make(clients)  -> the deps: each store's real transport, adapted to the
     *                                  shape the model reads. THE ADAPTERS ARE WHERE THE BUG
     *                                  WAS — see search-stores.js. Never inline them again.
     *   searchFederation.search()   -> the model. Progressive: onUpdate fires once per store
     *                                  as it lands, in LATENCY ORDER, so the list fills
     *                                  downward and nothing the eye has landed on ever moves.
     *   indexPanel.openSearch()     -> the ink. paintResults() repaints ONLY the results, so
     *                                  the input keeps its focus and caret while stores land.
     *
     * make() is called at OPEN, not at boot: the mail store needs EmailApp.mailModel, and
     * resolving the deps lazily means a script-order accident omits a group honestly instead
     * of wiring a store that cannot answer.                                                  */
    function searchDeps() {
      if (!shell.searchStores) return {};                     // cold-safe: no adapters loaded
      var clients = {};
      try {
        if (shell.contactsRest && shell.contactsRest.makeClient) clients.contacts = shell.contactsRest.makeClient({});
      } catch (e) { /* a store we cannot construct is a store we do not offer */ }
      try {
        if (shell.calendarRest && shell.calendarRest.makeClient) clients.calendar = shell.calendarRest.makeClient({});
      } catch (e) { /* ditto */ }
      return shell.searchStores.make(clients);                // mail resolves its own fetch + mailModel
    }

    // one generation counter: a slow store answering for an OLD query must not paint over a
    // newer one. (Mail is live Gmail — it can easily land after the next keystroke's results.)
    var searchGen = 0;

    function runSearch(q) {
      if (!shell.searchFederation || !shell.indexPanel) return;
      var mount = catalogMount();
      var gen = ++searchGen;
      var catalog = shell.indexCatalog ? shell.indexCatalog.buildCatalog(snapshot, cfg) : { groups: [] };
      var deps = searchDeps();
      deps.catalog = catalog;                                  // the soil store: a pure local fold
      shell.searchFederation.search(q, deps, function (model) {
        if (gen !== searchGen) return;                         // superseded — drop it, do not paint
        shell.indexPanel.paintResults(mount, model);
      });
    }

    function openSearch() {
      if (!shell.indexCatalog || !shell.indexPanel || !shell.searchFederation) { openCatalog(); return; }  // cold-safe: fall back to the catalog we've always had
      var mount = catalogMount();
      var catalog = shell.indexCatalog.buildCatalog(snapshot, cfg);
      var deps = searchDeps();
      deps.catalog = catalog;
      searchGen++;
      // the EMPTY QUERY IS THE CATALOG: this fires no network (search-federation short-circuits
      // on q === ""), so opening search costs exactly what opening the catalog always cost.
      shell.searchFederation.search("", deps, function (model) {
        shell.indexPanel.openSearch(mount, model);
      });
    }

    // The full first-run seed: the mail app + every canopy grove + the five horizons.
    // Built in memory; whether it is PERSISTED is start()'s decision, not this fold's.
    function buildSeed(data) {
      var seed = shell.viewConfig.createDefault();
      seed = shell.viewConfig.addOpen(seed, "mail:inbox");  // Mail first (leftmost -> landing) so a fresh boot opens on the mailbox
      (((data || {}).canopy || {}).groves || []).forEach(function (g) { if (g && g.grove) seed = shell.viewConfig.addOpen(seed, "grove:" + g.grove); });
      ["the Workbench", "Expiry Radar", "the Flow", "the Calendar", "the Body Clock"].forEach(function (h) { seed = shell.viewConfig.addOpen(seed, "horizon:" + h); });
      return seed;
    }

    // On an ERROR load (server down / unreachable / unparseable), the operator's real
    // config on the box is UNTOUCHED — we just could not read it this instant. We show a
    // sensible default WITHOUT persisting (persisting would clobber the real config), and
    // schedule a bounded retry; on a later `found` we ADOPT the real config and repaint.
    // Bounded delays are overridable for tests via shell.viewConfigRetryDelaysMs.
    function scheduleRetry() {
      if (!store || typeof setTimeout !== "function") return;   // cold-safe
      var delays = (shell.viewConfigRetryDelaysMs || [1000, 2000, 4000]).slice();
      var i = 0;
      function attempt() {
        Promise.resolve(store.load()).then(function (res) {
          var status = res && res.status;
          if (status === "found") { cfg = res.config; paint(); return; }  // the real config is back -> adopt + repaint
          if (status === "empty") { return; }                             // genuinely nothing saved -> keep the seed, stop
          if (i < delays.length) setTimeout(attempt, delays[i++]);        // still error -> keep trying, bounded
        }).catch(function () {
          if (i < delays.length) setTimeout(attempt, delays[i++]);
        });
      }
      if (i < delays.length) setTimeout(attempt, delays[i++]);
    }

    function start(result, data) {
      snapshot = data;
      if (shell.badges && shell.badges.invalidate) shell.badges.invalidate();  // fresh snapshot -> recompute weather once (curation)
      var status = result && result.status;
      if (status === "found") {
        cfg = result.config;                            // honor the saved config exactly (even if {tabs:[]})
      } else if (status === "error") {
        cfg = buildSeed(data);                          // show a default READ-ONLY — do NOT persist (that was the clobber)
        scheduleRetry();                                // ...and try to recover the real config in the background
      } else {
        // status === "empty" (or absent): a genuine first run. Seed in memory but do NOT
        // auto-persist — the seed is saved on the operator's FIRST real edit (any wirePersist
        // mutation calls persist(cfg)), which removes the auto-save-that-clobbers entirely.
        cfg = buildSeed(data);
      }
      wirePersist();
      wireActions();
      wireSelection();         // the strip's highlight follows the selected tab (note #1)
      seedSelection();         // ...and starts on the landing tab, not on a fallback
      wireSettingsExit();      // the exit is installed BEFORE any door can open the pane
      wireSettingsOpenSeam();  // the one way in from outside this module (app.js's alarm)
      paint();
    }

    var loadP = store ? store.load() : Promise.resolve({ status: "error" });
    var dataP = read ? read() : Promise.resolve(undefined);
    Promise.all([loadP, dataP])
      .then(function (pair) { start(pair[0], pair[1]); })
      .catch(function () { start({ status: "error" }, undefined); });  // cold-safe: any failure -> read-only default, never a persist
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
