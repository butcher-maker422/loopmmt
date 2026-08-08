/* Shea's Forest — the App Shell · shell/view-config.js
   STEP 1 of the shell build (the spine). See sessions/.../BUILD-DIRECTIVE-v1.md.

   The view-config is the per-user store that SELECTS and ORDERS capabilities into
   tabs. It is DISJOINT from the obligation graph — it never stores an obligation,
   only a reference (a capability id), a facet (pinned), and an order (ord). Every
   downstream piece of the shell (the strip, the pane, the index, badges) is a pure
   fold of THIS object plus the live projection.

   Model (one object type; `pinned` is a facet, not a second type):
     { tabs: [ { capability, pinned, ord } ], badges: { enabled:false } }

   Locked design rules (operator,):
     • Landing  = the LEFTMOST rendered tab (pinned-by-ord, then open-by-ord)[0].
     • Badges   = OFF by default; one toggle turns them on.
     • Generic  = NO preset pinned set. The user configures at runtime. A capability
                  whose source is absent resolves to an honest "not connected" pane.

   Pure module: no DOM, no fetch. Plain script (no ES module) — attaches to
   window.ForestShell.viewConfig. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  /* ---- capability kinds (for resolve + render dispatch) --------------------- */
  // A capability id is "<kind>:<ref>" or a bare connector name.
  var LIVE_CONNECTORS = ["gmail", "gcal", "contacts", "files"]; // wired sources today

  function kindOf(capability) {
    if (typeof capability !== "string" || !capability) return "unknown";
    if (capability.indexOf(":") === -1) {
      return LIVE_CONNECTORS.indexOf(capability) !== -1 ? "connector" : "connector-absent";
    }
    var k = capability.slice(0, capability.indexOf(":"));
    // Trio · Track CONTACT (member A) adds "contacts" (an app pane kind, e.g.
    // "contacts:people"). This is prefix-region ownership on a shared surface the
    // Confluence plan under-declared (it named only shell-renderers.js as J2; a
    // top-level app pane also needs its kind here + a catalog row) — FLAGGED to the
    // Confluence. bare "contacts" (no colon) stays the connector source, above.
    // Trio · Track CALENDAR (member B) adds "calendar" (an app pane kind, e.g.
    // "calendar:month") — prefix-region ownership, disjoint from CONTACT's "contacts".
    // Distinct from the "gcal" connector source and the "the Calendar" horizon above.
    // The Sudoku app (sudoku:play) — the Trio app-pane shape reused for a
    // game: a single top-level pane that mounts the guarded dual-expression forest
    // face (shared shell + core, DOM-table skin). No prefix-region split — one board,
    // one pane. Distinct from any connector source; there is no "sudoku" connector.
    // Butcher Forest (butcher:forest) — the Trio app-pane shape reused for
    // Deer Hill order management. One pane; board/glance/intake navigate INSIDE it
    // (butcher-renderer.js), like contacts list->record. Distinct from any connector.
    // Battleganza (battleganza:play) — the Trio app-pane shape reused for the
    // second game. One pane; the engine's own face mounts inside it
    // (battleganza-renderer.js). Distinct from any connector.
    if (k === "tree" || k === "horizon" || k === "grove" || k === "mail" || k === "contacts" || k === "calendar" || k === "sudoku" || k === "butcher" || k === "battleganza") return k;
    return "unknown";
  }

  /* ---- construction --------------------------------------------------------- */
  // Deliberately empty of a preset (the reframe): no hardcoded pinned set.
  // `count` mirrors `badges`: an off-by-default user preference (§3f/§6.3,
  // Nyx's never-default). It gates the mail view's OPT-IN unread number — the
  // resting surface shows no unread count; a user turns it on by their own hand.
  function createDefault() {
    return { tabs: [], badges: { enabled: false }, count: { enabled: false }, density: { value: "comfortable" }, editLock: { locked: true }, skin: { value: "light" }, calColors: {}, calOrder: [], contactGroups: [], ownerProfile: null, ownerContactId: null, tabLabels: {} };
  }

  // Calendar-type COLOR OVERRIDES — the sparse-override half of the color seam
  // (design/forest-calendar-type-manager-direction-v1.md §DECIDED). A map of
  // calendarId -> Grove-palette SLOT INDEX (an integer, NOT a hex): an override is
  // palette-relative, so it can never be off-brand, a palette retune still moves it,
  // and revert = delete the key. ABSENT/EMPTY is the resting state — every type keeps
  // its deterministic calHue color, zero decisions. This module only stores the map;
  // resolveCalColor (calendar-renderer) is the read side. normalizeCalColors coerces a
  // malformed/missing map to a clean { id: int } (junk entries dropped), never a throw.
  function normalizeCalColors(raw) {
    var out = {};
    if (raw && typeof raw === "object") {
      for (var k in raw) {
        if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
        var v = raw[k];
        if (typeof v === "number" && isFinite(v)) out[k] = v | 0;   // slot index; junk keys dropped
      }
    }
    return out;
  }
  // Reader (symmetric with densityOf/countEnabled): the loaded override map, always a
  // plain object. calendar-renderer sets its OVERRIDES from this at render time.
  function calColorsOf(config) { return normalizeCalColors(config && config.calColors); }

  // WRITE side of the color seam (the recolor UI calls these; step-2 plumbing).
  // setCalColor persists a Grove-palette SLOT INDEX override for one calendar type;
  // revertCalColor deletes the key so the type falls back to its deterministic calHue
  // (revert = delete, no sentinel — §DECIDED). Both return a NEW normalized config
  // (never mutate in place), exactly like setDensity/setBadges. A non-number slot is
  // treated as a revert, so setCalColor(cfg, id, null) is a safe alias for revert.
  function setCalColor(config, id, slot) {
    var c = normalize(clone(config));
    if (typeof id !== "string" || !id) return c;                 // no id -> no-op
    if (typeof slot === "number" && isFinite(slot)) c.calColors[id] = slot | 0;
    else delete c.calColors[id];                                 // non-number -> revert
    return c;
  }
  function revertCalColor(config, id) {
    var c = normalize(clone(config));
    if (typeof id === "string" && id) delete c.calColors[id];
    return c;
  }

  // Calendar-type ORDER — the persisted-order half of the calendar seam (verb 4,
  // reorder/drag). A single ordered array of calendar ids: the owner's preferred
  // rail sequence, layered over the tool's ORDER BY name COLLATE NOCASE (the tool
  // knows nothing of this). Unlike calColors (a per-id map) this is ONE list; unlike
  // solo (an ephemeral view filter) it is a SET-AND-FORGET pref, exactly the class
  // of calColors/density. ABSENT/EMPTY is the resting state — derived (alphabetical)
  // order, zero decisions. This module only STORES the list; calMod.applyOrder
  // (calendar-renderer's read side) applies it, calMod.reorder computes the moves.
  // normalizeCalOrder coerces a malformed/missing value to a clean, deduped array of
  // non-empty id strings (junk dropped), never a throw — the calColors discipline.
  function normalizeCalOrder(raw) {
    var out = [], seen = {};
    if (raw && raw.length) {
      for (var i = 0; i < raw.length; i++) {
        var v = raw[i];
        if (v === null || v === undefined) continue;
        var id = String(v);
        if (id === "" || seen[id]) continue;                     // drop blanks + dups
        seen[id] = true; out.push(id);
      }
    }
    return out;
  }
  // Reader (symmetric with calColorsOf): the loaded order list, always a plain array.
  function calOrderOf(config) { return normalizeCalOrder(config && config.calOrder); }
  // WRITE side (the reorder UI calls this via shell-boot): persist a NEW order list.
  // The caller (calendar-renderer) computes the moved order with calMod.reorder and
  // hands the whole array here — mirroring how the recolor picker hands setCalColor a
  // computed slot index. Returns a NEW normalized config (never mutates in place).
  function setCalOrder(config, order) {
    var c = normalize(clone(config));
    c.calOrder = normalizeCalOrder(order);
    return c;
  }

  // TAB LABELS — the stored-override half of the tab-rename seam (item 3 of the
  // top-bar reduction pass). tab-strip's labelFor() COMPUTES every tab name from
  // its capability kind — "Mail", "Calendar", a Title-Cased tree slug, a grove's
  // a ⊗ b — and until now there was nowhere for a human-chosen name to live, so
  // the strip could only ever call a tab what the system called it.
  //
  // SHAPE: a per-capability map, the calColors shape (not calOrder's list) — a
  // rename is per-tab and order-independent. ABSENT IS THE RESTING STATE: no
  // entry means labelFor() decides, which is why an owner who never renames
  // anything carries an empty object and inherits every future labelling fix we
  // make. That is the whole reason this is an OVERRIDE map and not a snapshot of
  // all the labels: snapshot the computed names and the first tab you rename
  // freezes the other eleven against improvement.
  //
  // REVERT IS FREE, and it is the empty string. setTabLabel(c, cap, "") DELETES
  // the entry rather than storing a blank — the exact calColors idiom (a
  // non-number reverts the slot). So clearing the editable and pressing Return
  // gives the derived name back; there is no separate "reset" affordance to
  // build, discover, or explain.
  //
  // CAP: MAX_TAB_LABEL. A tab is a chip in a 56px bar, and an un-capped label is
  // a geometry weapon — paste a paragraph and the strip wraps, which on a
  // flex-wrap container drags every tab bottom off the hairline item 5 just made
  // flush. The cap is defence in depth BELOW the CSS, so a config hand-edited or
  // restored from an older client cannot do what the UI refuses to.
  //
  // normalizeTabLabels coerces a malformed/missing value to a clean map of
  // non-empty capability -> non-empty trimmed string, never a throw — the
  // calColors/calOrder discipline.
  var MAX_TAB_LABEL = 48;
  function cleanTabLabel(raw) {
    // TYPE FIRST, and this is not pedantry. An earlier draft coerced everything
    // through String(), which is the calColors idiom read one step too literally --
    // calColors coerces a NUMBER to a number, this coerces anything at all to a
    // NAME. A stray object then became the literal tab label "[object Object]" and
    // a stray 7 became "7", both non-empty, both stored, both painted in the bar.
    // A value that is not a string is not a name the owner typed; it is a caller
    // bug or a corrupt config, and the honest response is to drop it and fall back
    // to the derived label -- never to invent a name out of a coercion.
    if (typeof raw !== "string") return "";
    // collapse ALL whitespace runs (incl. a pasted newline) to single spaces, then trim:
    // a label is one line by construction, never by hope.
    var s = raw.replace(/\s+/g, " ").trim();
    return s.length > MAX_TAB_LABEL ? s.slice(0, MAX_TAB_LABEL).trim() : s;
  }
  function normalizeTabLabels(raw) {
    var out = {};
    if (raw && typeof raw === "object") {
      for (var k in raw) {
        if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
        if (typeof k !== "string" || k === "") continue;          // drop blank capability keys
        var v = cleanTabLabel(raw[k]);
        if (v !== "") out[k] = v;                                 // blank/junk -> no entry (= derived)
      }
    }
    return out;
  }
  // Reader (symmetric with calColorsOf): the loaded override map, always a plain object.
  function tabLabelsOf(config) { return normalizeTabLabels(config && config.tabLabels); }
  // Reader for ONE tab: the owner's name for this capability, or "" if they never
  // set one. tab-strip's labelFor() consults this and falls through to its own
  // computation on "" — so the fallback lives in ONE place and this returns a
  // plain, honest empty rather than guessing a default it has no business knowing.
  function tabLabelOf(config, capability) {
    if (typeof capability !== "string" || capability === "") return "";
    var m = tabLabelsOf(config);
    return Object.prototype.hasOwnProperty.call(m, capability) ? m[capability] : "";
  }
  // WRITE side (the rename UI calls this via shell-boot): store a name, or clear
  // it back to derived with "" / null. Returns a NEW normalized config (never
  // mutates in place) — the calColors/calOrder contract.
  function setTabLabel(config, capability, label) {
    var c = normalize(clone(config));
    if (typeof capability !== "string" || capability === "") return c;   // nothing to key on
    var v = cleanTabLabel(label);
    if (v === "") delete c.tabLabels[capability];                        // revert to derived
    else c.tabLabels[capability] = v;
    return c;
  }

  // Contacts DECLARED GROUPS — the existence half of the Groups seam
  // (sessions/20.1753 groups-v1-build-ready-design §"the crux"). A contact
  // LABEL exists only as a membership row, so an empty managed group has no home
  // — the contacts rail hides empty labels on purpose. But a managed group must
  // persist WHILE EMPTY (you make "Ultimate" before adding anyone), the way a
  // calendar type persists empty. So a group's EXISTENCE + ORDER + COLOUR live
  // here in view-config (the exact calColors/calOrder precedent, client-durable);
  // its MEMBERSHIP rides the existing label API (contacts-renderer, zero edit to
  // the byte-frozen loopcontact.js). A group is stored as an ordered { name,
  // color } record: `name` is the label string it maps onto (identity, matched
  // to loopcontact's UNIQUE(contact_id,label) — case-sensitive, exact); `color`
  // is a Grove-palette SLOT INDEX (an integer, NOT a hex — same discipline as
  // calColors: palette-relative, never off-brand, revert = null) or null for the
  // deterministic default. ORDER is the array position (the calOrder pattern,
  // one list not a map). ABSENT/EMPTY is the resting state — no declared groups,
  // zero decisions. normalizeContactGroups coerces a malformed/missing value to a
  // clean, deduped-by-name array of { name:string, color:int|null }, never a
  // throw — the calColors/calOrder discipline.
  function normalizeContactGroups(raw) {
    var out = [], seen = {};
    if (raw && raw.length) {
      for (var i = 0; i < raw.length; i++) {
        var g = raw[i];
        if (!g || typeof g !== "object") continue;
        var name = (typeof g.name === "string") ? g.name : "";
        if (name === "" || seen[name]) continue;                 // drop blanks + dups (exact-name identity)
        seen[name] = true;
        var color = (typeof g.color === "number" && isFinite(g.color)) ? (g.color | 0) : null;
        out.push({ name: name, color: color });
      }
    }
    return out;
  }
  // Reader (symmetric with calColorsOf/calOrderOf): the loaded groups list, always
  // a plain array. contacts-renderer sets its declared-group set from this at
  // render time (union'd with member-bearing labels).
  function contactGroupsOf(config) { return normalizeContactGroups(config && config.contactGroups); }
  // WRITE side (the rail Create + recolor emit these via shell-boot): declare a
  // group or update its colour. Add-or-update by name (existence is idempotent —
  // declaring an existing group is a no-op except colour); a group already present
  // keeps its ORDER (array position) and only its colour is touched. Returns a NEW
  // normalized config (never mutates in place), exactly like setCalColor/setCalOrder.
  function setContactGroup(config, name, color) {
    var c = normalize(clone(config));
    if (typeof name !== "string" || !name) return c;             // no name -> no-op
    var slot = (typeof color === "number" && isFinite(color)) ? (color | 0) : null;
    for (var i = 0; i < c.contactGroups.length; i++) {
      if (c.contactGroups[i].name === name) { c.contactGroups[i].color = slot; return c; }
    }
    c.contactGroups.push({ name: name, color: slot });           // new declared group (appended = last in order)
    return c;
  }
  // WRITE side (the rail Delete emits this via shell-boot): un-declare a group. The
  // membership rows (labels) are the tool's to strip; this only removes the group's
  // DECLARATION so an empty group stops persisting. Returns a NEW normalized config.
  function removeContactGroup(config, name) {
    var c = normalize(clone(config));
    if (typeof name !== "string" || !name) return c;
    c.contactGroups = c.contactGroups.filter(function (g) { return g.name !== name; });
    return c;
  }
  // WRITE side (the V1-tail reorder UI calls this): persist a NEW order by name
  // list, mirroring setCalOrder. Names not present are dropped; present-but-unlisted
  // groups are appended in their existing order (a partial order never loses a group).
  function setContactGroupOrder(config, names) {
    var c = normalize(clone(config));
    var order = normalizeCalOrder(names);                        // reuse the deduped-string-array coercer
    var byName = {}, rest = [];
    c.contactGroups.forEach(function (g) { byName[g.name] = g; });
    var next = [];
    order.forEach(function (n) { if (byName[n]) { next.push(byName[n]); byName[n] = null; } });
    c.contactGroups.forEach(function (g) { if (byName[g.name]) rest.push(g); });  // unlisted keep tail order
    c.contactGroups = next.concat(rest);
    return c;
  }

  // MY CARD — the owner's own record (D2=b,). A DISTINCT owner-profile,
  // NOT a pointer to a contact row (that was D2=a, rejected) and NOT seeded from a
  // login identity (the box has none — GET /session is booleans-only; the owner
  // AUTHORS this). Stored here client-durable (the exact calColors/calOrder/
  // contactGroups precedent), so loopcontact.js stays byte-frozen (D1=a). SHAPE
  // mirrors a contact record so the record renderer can reuse its field rows:
  //   { display_name:string, emails:[{email,is_primary}], phones:[{phone,is_primary}], photo:null }
  // `photo` is a RESERVED, UNBUILT hook — leg 2 fills it from the sovereign blob
  // store (D1=a), and the auto-feed-to-connections sharing hook hangs off THIS
  // record's stable identity. Leg 1 stores it null and never touches it.
  // RESTING STATE is `null` (My Card not set up) — distinct from a set-up-but-empty
  // record ({} -> a clean empty record), so the rail can offer "set up your card"
  // vs "open your card". normalizeOwnerProfile coerces malformed input to a clean
  // record or null, never a throw — the calColors/contactGroups discipline.
  function normalizeOwnerContacts(raw, key) {
    var out = [];
    if (raw && raw.length) {
      for (var i = 0; i < raw.length; i++) {
        var r = raw[i];
        if (!r || typeof r !== "object") continue;
        var v = (typeof r[key] === "string") ? r[key] : "";
        if (v === "") continue;                                   // drop blank rows
        out.push({ isPrimaryKey: v, is_primary: r.is_primary === true });
      }
    }
    // re-key to the caller's field name (email/phone), preserving is_primary
    return out.map(function (o) { var m = { is_primary: o.is_primary }; m[key] = o.isPrimaryKey; return m; });
  }
  // A photo is a small REFERENCE into the sovereign blob store (shell/blob-store.js) —
  // { key, mime } — NEVER the blob itself (a base64 photo here would bloat the config past
  // the localStorage ceiling; the sidecar exists for exactly that separation). leg 1 forced
  // this null; leg 2 makes it a writable ref. Real-or-Made: the ref only ever points at a
  // GENUINE user-uploaded blob — nothing in this system generates or guesses a face.
  function normalizeOwnerPhoto(raw) {
    if (!raw || typeof raw !== "object") return null;             // absent/junk -> no photo
    var key = (typeof raw.key === "string" && raw.key) ? raw.key : null;
    if (!key) return null;                                        // a ref with no key is not a photo
    return { key: key, mime: (typeof raw.mime === "string") ? raw.mime : "" };
  }
  function normalizeOwnerProfile(raw) {
    if (!raw || typeof raw !== "object") return null;             // absent -> not set up
    return {
      display_name: (typeof raw.display_name === "string") ? raw.display_name : "",
      emails: normalizeOwnerContacts(raw.emails, "email"),
      phones: normalizeOwnerContacts(raw.phones, "phone"),
      photo: normalizeOwnerPhoto(raw.photo)                       // leg-2: {key,mime} ref into the blob sidecar, or null
    };
  }
  // Reader (symmetric with contactGroupsOf): the loaded owner record, or null if not
  // set up. contacts-renderer's My Card slot reads this at render time.
  function ownerProfileOf(config) { return normalizeOwnerProfile(config && config.ownerProfile); }
  // WRITE side (the My Card editor emits this via shell-boot): set/replace the owner
  // record. A null/absent patch CLEARS it (back to not-set-up); any object SETS it
  // (normalized). Returns a NEW normalized config, never mutates in place — the
  // setContactGroup discipline. photo (leg 2) rides the profile as a {key,mime} ref into
  // the sovereign blob store — normalized here like every other field; the blob itself is
  // written to the sidecar by the editor before this fires (view-config carries only the ref).
  function setOwnerProfile(config, profile) {
    var c = normalize(clone(config));
    c.ownerProfile = normalizeOwnerProfile(profile);              // object -> clean record; null/junk -> not set up
    return c;
  }

  // ── OWNER UNIFICATION (Phase 3) ────────────────────────────────────────
  // ownerContactId DESIGNATES an existing registry contact as "you" — a shell-side
  // VIEW-CONFIG fact, never a tool column: the golden loopcontact.js is untouched
  // (owner-ness is a view decision, not a data decision — plan §1). My Card then
  // opens that contact's NORMAL renderRecord + an owner badge, instead of a bespoke
  // owner view. RESTING STATE is null (no contact designated yet — the pre-migration
  // shape, and the honest "not unified" state). A non-empty string id SETS the
  // designation; null/blank/junk CLEARS it (back to un-designated) — the ownerProfile
  // / setCalColor discipline: coerce to a clean value or null, never a throw.
  function normalizeOwnerContactId(raw) {
    return (typeof raw === "string" && raw !== "") ? raw : null;
  }
  // Reader (symmetric with ownerProfileOf): the designated contact id, or null.
  function ownerContactIdOf(config) { return normalizeOwnerContactId(config && config.ownerContactId); }
  // WRITE side (emitted via shell-boot when the operator designates / re-designates
  // "you", or by the one-time migration): set/replace the designation. A null/blank
  // patch CLEARS it. Returns a NEW normalized config, never mutates in place.
  function setOwnerContactId(config, id) {
    var c = normalize(clone(config));
    c.ownerContactId = normalizeOwnerContactId(id);              // string id -> designated; null/blank/junk -> un-designated
    return c;
  }

  // The SKIN is a set-and-forget DISPLAY preference, the same shape as density: a closed
  // value set, an honest default, junk normalizes to the default (never blank).
  //
  // ── LIGHT IS THE DEFAULT. OPERATOR, DIRECTLY,. ──────────────────────────────
  // Read this before you "fix" it back. The 13.1945 handoff asserted that DARK was the
  // ratified default and that the light variant Shea had been looking at
  // all campaign was an accident nobody caught. It was not. Shea asked for light, on
  // purpose, and said so the moment the fold was written. The handoff's claim was INHERITED
  // PROSE, not a read of the record — the same mechanism as the false runtime sha (owed 633)
  // and the ghost fork (owed 667), and it was one commit from re-skinning his app out
  // from under him on the authority of a sentence.
  //
  // The CSS structure is unchanged and is NOT evidence of intent: :root carries the dark
  // palette and [data-theme="light"] is the override off it. That is a stylesheet-authoring
  // convenience. It says nothing about which skin the operator wants served, and reading
  // intent out of it is how this went wrong. The DEFAULT lives HERE, in the fold, in one
  // place, where the toggle reads it — and it is LIGHT.
  var SKIN_VALUES = ["light", "dark"];
  function normSkinValue(v) { return SKIN_VALUES.indexOf(v) !== -1 ? v : "light"; }
  function skinOf(config) { return normSkinValue(config && config.skin && config.skin.value); }
  function setSkin(config, value) {
    var c = normalize(clone(config));
    c.skin = { value: normSkinValue(value) };
    return c;
  }
  function nextSkin(config) { return skinOf(config) === "light" ? "dark" : "light"; }

  // Row density is a set-and-forget DISPLAY preference (v9): three values,
  // default comfortable. Unlike badges/count it carries a VALUE, not a bit — the
  // valid set is closed and an out-of-set value normalizes to comfortable (never
  // blank), the same honest-default posture the mail view's opts.density read holds.
  var DENSITY_VALUES = ["comfortable", "cozy", "compact"];
  function normDensityValue(v) { return DENSITY_VALUES.indexOf(v) !== -1 ? v : "comfortable"; }

  function clone(config) {
    return JSON.parse(JSON.stringify(config || createDefault()));
  }

  function normalize(config) {
    var c = config && typeof config === "object" ? config : createDefault();
    if (!Array.isArray(c.tabs)) c.tabs = [];
    if (!c.badges || typeof c.badges !== "object") c.badges = { enabled: false };
    if (typeof c.badges.enabled !== "boolean") c.badges.enabled = false; // OFF by default
    if (!c.count || typeof c.count !== "object") c.count = { enabled: false };
    if (typeof c.count.enabled !== "boolean") c.count.enabled = false;   // OFF by default (the opt-in unread number)
    if (!c.density || typeof c.density !== "object") c.density = { value: "comfortable" };
    c.density.value = normDensityValue(c.density.value);                 // comfortable by default; junk -> comfortable
    if (!c.editLock || typeof c.editLock !== "object") c.editLock = { locked: true };
    if (typeof c.editLock.locked !== "boolean") c.editLock.locked = true; // LOCKED by default (FBD: editing the tab set is deliberate)
    if (!c.skin || typeof c.skin !== "object") c.skin = { value: "light" };
    c.skin.value = normSkinValue(c.skin.value); // LIGHT by default (operator,); junk -> light
    c.calColors = normalizeCalColors(c.calColors);                       // {} by default; malformed map -> clean { id: int }, never a throw
    c.calOrder = normalizeCalOrder(c.calOrder);                          // [] by default; malformed -> clean deduped [id], never a throw
    c.contactGroups = normalizeContactGroups(c.contactGroups);           // [] by default; malformed -> clean deduped [{name,color}], never a throw
    c.ownerProfile = normalizeOwnerProfile(c.ownerProfile);              // null by default (My Card not set up); malformed -> clean owner record or null, never a throw
    c.tabLabels = normalizeTabLabels(c.tabLabels);                       // {} by default; malformed -> clean { capability: name }, never a throw
    c.ownerContactId = normalizeOwnerContactId(c.ownerContactId);        // null by default (no contact designated as "you"); malformed -> null, never a throw
    c.tabs = c.tabs
      .filter(function (t) { return t && typeof t.capability === "string"; })
      .map(function (t, i) {
        return {
          capability: t.capability,
          pinned: t.pinned === true,
          ord: typeof t.ord === "number" ? t.ord : i
        };
      });
    return c;
  }

  /* ---- ordering + landing (the leftmost rule) ------------------------------- */
  function byOrd(a, b) { return a.ord - b.ord || 0; }

  // Render order: pinned (by ord) first, then open (by ord). The strip paints
  // pinned small/icon on the LEFT, open named on the RIGHT — so element [0] is
  // the physical leftmost tab.
  function renderOrder(config) {
    var c = normalize(config);
    var pinned = c.tabs.filter(function (t) { return t.pinned; }).slice().sort(byOrd);
    var open = c.tabs.filter(function (t) { return !t.pinned; }).slice().sort(byOrd);
    return pinned.concat(open);
  }

  // Landing = the leftmost rendered tab (pinned or not). null if no tabs.
  function landingTab(config) {
    var order = renderOrder(config);
    return order.length ? order[0] : null;
  }

  /* ---- mutation helpers (return a NEW config; never mutate in place) --------- */
  function find(c, capability) {
    for (var i = 0; i < c.tabs.length; i++) if (c.tabs[i].capability === capability) return i;
    return -1;
  }
  function nextOrd(c, pinned) {
    var same = c.tabs.filter(function (t) { return t.pinned === pinned; });
    return same.reduce(function (m, t) { return Math.max(m, t.ord); }, -1) + 1;
  }

  function add(config, capability, pinned) {
    var c = normalize(clone(config));
    if (find(c, capability) !== -1) return c; // idempotent
    c.tabs.push({ capability: capability, pinned: !!pinned, ord: nextOrd(c, !!pinned) });
    return c;
  }
  function pin(config, capability) {
    var c = normalize(clone(config));
    var i = find(c, capability);
    if (i === -1) return add(c, capability, true);
    if (!c.tabs[i].pinned) { c.tabs[i].pinned = true; c.tabs[i].ord = nextOrd(c, true); }
    return c;
  }
  function unpin(config, capability) {
    var c = normalize(clone(config));
    var i = find(c, capability);
    if (i !== -1 && c.tabs[i].pinned) { c.tabs[i].pinned = false; c.tabs[i].ord = nextOrd(c, false); }
    return c;
  }
  function addOpen(config, capability) { return add(config, capability, false); }
  function close(config, capability) {
    var c = normalize(clone(config));
    var i = find(c, capability);
    if (i !== -1) c.tabs.splice(i, 1);
    return c;
  }
  // Move a tab to a new position WITHIN its tier (pinned or open); re-packs ords.
  function reorder(config, capability, newIndexInTier) {
    var c = normalize(clone(config));
    var i = find(c, capability);
    if (i === -1) return c;
    var pinnedFlag = c.tabs[i].pinned;
    var tier = c.tabs.filter(function (t) { return t.pinned === pinnedFlag; }).sort(byOrd);
    var moving = tier.splice(tier.map(function (t) { return t.capability; }).indexOf(capability), 1)[0];
    var idx = Math.max(0, Math.min(newIndexInTier, tier.length));
    tier.splice(idx, 0, moving);
    tier.forEach(function (t, n) { c.tabs[find(c, t.capability)].ord = n; });
    return c;
  }

  /* ---- badges (off by default) ---------------------------------------------- */
  function badgesEnabled(config) { return normalize(config).badges.enabled === true; }
  function setBadges(config, on) {
    var c = normalize(clone(config));
    c.badges.enabled = !!on;
    return c;
  }

  /* ---- count (off by default) — the mail view's OPT-IN unread number --------- *
   * The exact twin of badges: an off-by-default preference the user turns on by  *
   * their own hand (§6.3, Nyx's never-default). Off, the mail view shows *
   * a calm invite where the number would sit (SM-2); on, a quiet muted unread    *
   * field (JT-6). This module only stores the bit — the surfacing is the mail    *
   * view's, exactly as the strip owns the badges dots. */
  function countEnabled(config) { return normalize(config).count.enabled === true; }
  function setCount(config, on) {
    var c = normalize(clone(config));
    c.count.enabled = !!on;
    return c;
  }

  /* ---- density (comfortable by default) — the mail view's row-rhythm choice ---- *
   * The value-carrying sibling of count: a set-and-forget DISPLAY preference the   *
   * user picks in Settings (v9). This module only stores the value — the *
   * mail view reads it back via opts.density and swaps a `.view--density-*` CSS     *
   * modifier at build, exactly as it reads opts.countEnabled for the unread field.  *
   * setDensity normalizes an out-of-set value to comfortable (never persists junk). */
  function densityOf(config) { return normalize(config).density.value; }
  function setDensity(config, val) {
    var c = normalize(clone(config));
    c.density.value = normDensityValue(val);
    return c;
  }

  /* ---- edit-lock (LOCKED by default) — the tab-set edit gate (Track B) --- *
   * The structural sibling of badges/count, one bit, but weighted the OTHER way:    *
   * LOCKED is the resting state (FBD — restructuring your tabs is a deliberate act,  *
   * never an accidental drag). When locked, the strip's pin/unpin/close/reorder      *
   * mutations are gated at the host (shell-boot's single write loop) and the         *
   * affordances hide via CSS; unlock to edit, then it re-locks by the user's hand.   *
   * This module only stores the bit and persists it like any preference — the        *
   * gating + the visibly-distinct locked chrome live in the host + shell.css, so     *
   * the pure tab-strip renderer stays byte-frozen (theme + wire, never rebuilt).     */
  function editLocked(config) { return normalize(config).editLock.locked === true; }
  function setEditLocked(config, locked) {
    var c = normalize(clone(config));
    c.editLock.locked = !!locked;
    return c;
  }

  /* ---- resolution + validation ---------------------------------------------- */
  // resolver(capability) -> truthy unit descriptor, or falsy if the source is absent.
  // Falls back to kind inspection so the shell degrades honestly with no resolver.
  function resolveOrAbsent(capability, resolver) {
    var kind = kindOf(capability);
    var unit = typeof resolver === "function" ? resolver(capability) : null;
    if (unit) return { ok: true, kind: kind, capability: capability, unit: unit };
    if (!resolver && kind !== "connector-absent" && kind !== "unknown") {
      // no resolver wired yet — treat known kinds as pending, not absent
      return { ok: true, kind: kind, capability: capability, unit: null, pending: true };
    }
    return { ok: false, kind: kind, capability: capability,
             reason: kind === "connector-absent" ? "not-connected" : "unresolved" };
  }

  // Well-formed iff every tab's capability resolves and every grove (⊗) slot is
  // collision-free. Returns { ok, errors:[{capability, reason}] }.
  function validate(config, resolver) {
    var c = normalize(config);
    var errors = [];
    var seenSlots = {};
    c.tabs.forEach(function (t) {
      var r = resolveOrAbsent(t.capability, resolver);
      if (!r.ok) errors.push({ capability: t.capability, reason: r.reason });
      if (kindOf(t.capability) === "grove") {
        var ref = t.capability.slice(t.capability.indexOf(":") + 1);
        // Only ⊗-groves (compose groves) carry slot rules; a bare grove:x is a
        // valid single grove (STEP 5) and is left alone.
        if (ref.indexOf("\u2297") !== -1) {
          var sides = ref.split("\u2297");
          // Graham's two-up bound is HARD, so validate rejects >2 as a spec
          // error (STEP 7-B): the render degrades to two slots + a note, but a
          // malformed >2 spec is caught here, not silently accepted.
          if (sides.length !== 2) {
            errors.push({ capability: t.capability, reason: "too-many-slots:" + sides.length });
          }
          // Baseline: a ≠ b — a slot may not appear twice in one grove. Data
          // OVERLAP (distinct refs over the same underlying data) stays legal:
          // ⊗ is two independent reads, never a write, so tree:bills ⊗ grove:bills
          // (same data, two framings) is a valid view and is NOT flagged.
          var local = {};
          sides.forEach(function (s) {
            if (local[s]) errors.push({ capability: t.capability, reason: "slot-collision:" + s });
            local[s] = true;
          });
        }
      }
    });
    return { ok: errors.length === 0, errors: errors };
  }

  /* ---- composeRef(capA, capB) — the §3.8 creation-side twin of validate ------ *
   * Builds the ⊗ compose capability `grove:<capA>⊗<capB>` from two single-unit    *
   * capabilities. It is the ONE source of truth for the compose grammar on the    *
   * creation side, and it produces ONLY refs `validate` accepts (round-trip-safe: *
   * compose then validate → ok). Pure fold — no DOM, no writes.                   *
   *   ok  -> { ok:true, capability:"grove:<capA>⊗<capB>" }                        *
   *   not -> { ok:false, reason }  reason ∈ empty-slot | nested-compose |         *
   *                                 slot-collision:<cap>                          *
   * Guards mirror validate's slot rules: both slots non-empty strings; neither    *
   * slot may itself contain ⊗ (no compose-of-compose — a sub-unit is a single     *
   * unit, else the render's nested-⊗ guard fires and validate flags too-many-     *
   * slots); capA !== capB (identical strings collide — but data OVERLAP over       *
   * DISTINCT refs, e.g. tree:bills ⊗ grove:bills, stays legal, exactly as         *
   * validate allows, because ⊗ is two reads never a write). Exactly-two is         *
   * implicit in the 2-arg signature; validate remains the defensive >2 backstop.  */
  function composeRef(capA, capB) {
    var TENSOR = "\u2297";
    if (typeof capA !== "string" || typeof capB !== "string" || !capA || !capB) {
      return { ok: false, reason: "empty-slot" };
    }
    if (capA.indexOf(TENSOR) !== -1 || capB.indexOf(TENSOR) !== -1) {
      return { ok: false, reason: "nested-compose" };
    }
    if (capA === capB) {
      return { ok: false, reason: "slot-collision:" + capA };
    }
    return { ok: true, capability: "grove:" + capA + TENSOR + capB };
  }

  /* ---- export --------------------------------------------------------------- */
  root.viewConfig = {
    LIVE_CONNECTORS: LIVE_CONNECTORS.slice(),
    kindOf: kindOf,
    composeRef: composeRef,
    createDefault: createDefault,
    normalize: normalize,
    clone: clone,
    renderOrder: renderOrder,
    landingTab: landingTab,
    add: add, pin: pin, unpin: unpin, addOpen: addOpen, close: close, reorder: reorder,
    badgesEnabled: badgesEnabled, setBadges: setBadges,
    countEnabled: countEnabled, setCount: setCount,
    densityOf: densityOf, setDensity: setDensity,
    editLocked: editLocked, setEditLocked: setEditLocked,
    SKIN_VALUES: SKIN_VALUES.slice(),
    skinOf: skinOf, setSkin: setSkin, nextSkin: nextSkin,
    tabLabelsOf: tabLabelsOf, tabLabelOf: tabLabelOf, setTabLabel: setTabLabel, MAX_TAB_LABEL: MAX_TAB_LABEL,
    calColorsOf: calColorsOf,
    setCalColor: setCalColor, revertCalColor: revertCalColor,
    calOrderOf: calOrderOf, setCalOrder: setCalOrder,
    contactGroupsOf: contactGroupsOf, setContactGroup: setContactGroup,
    removeContactGroup: removeContactGroup, setContactGroupOrder: setContactGroupOrder,
    ownerProfileOf: ownerProfileOf, setOwnerProfile: setOwnerProfile,
    ownerContactIdOf: ownerContactIdOf, setOwnerContactId: setOwnerContactId,
    resolveOrAbsent: resolveOrAbsent, validate: validate,
    _version: "1.10" // 1.10: TAB LABELS -- the stored-override half of the tab-rename seam (item 3,): a per-capability map on the calColors precedent, absent=derived, ""=revert-by-delete, MAX_TAB_LABEL=48 as defence below the CSS, non-string values DROPPED not String-coerced into names
  };
})();
