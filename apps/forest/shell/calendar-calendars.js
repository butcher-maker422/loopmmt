/* calendar-calendars.js — P2, "My Calendars": the calendar-identity filter.

   WHAT THIS IS. The owner has more than one calendar (Personal, Work, a shared
   family one, the birthdays feed Google injects). The connector already fans out
   over every one of them (forest/connectors/sources/calendar.js — defaultFetchEvents
   is parameterized by calendarId; it was hardcoded to 'primary' once and is not
   anymore) and the tool already stores the identity (_tools/loopcalendar.js — a
   `calendars` table and an `events.calendar_id` column, with a live ALTER migration).
   Only the UI was flat. This module is the missing half: given the calendars in hand
   and the set the owner has CHECKED, return the events that belong on screen.

   SEPARATION (the-clearing / two-rivers idiom, TC-1). This module reads no calendar
   of its own, calls no model, and touches no network. The host hands it the events it
   already fetched and the checked set, and it returns the visible subset. It therefore
   has no path to invent an event, a calendar, or a request. Pure functions, in and out.

   ── B3 — THE NULL ARITHMETIC, WRITTEN DOWN ────────────────────────────────────────
    D7 parked this: "B3 sleeps. With P2 out of the V1, the NULL-calendar_id
   arithmetic never bites. It re-fires the moment P2 is scheduled." P2 is scheduled.
   Here is the arithmetic, and it is a RULE, not an implementation detail:

     `events.calendar_id` was added by ALTER AFTER the live event populations
     (loopcalendar.js:394). Every event synced before that migration carries
     NULL. Those events are real. They are on the owner's calendar. They simply
     predate the column.

     THEREFORE: an event with no calendar_id belongs to NO calendar, and a
     calendar filter MUST NEVER SILENTLY HIDE IT. The naive filter — keep an
     event iff checked.includes(e.calendar_id) — drops every pre-migration event
     the moment the owner touches a checkbox, and drops them QUIETLY. The owner
     would watch his own history evaporate and have no idea which control did it.

     So the un-assigned events get their own explicit, VISIBLE, checked-by-default
     slot (UNASSIGNED, below). They are hideable — but only ever by a deliberate
     act on a control that names them. Never as a side effect of filtering
     something else.

   That rule is the whole reason this module exists as its own file: it is the one
   piece of judgment in P2, and it is pinned by test (calendar-calendars.test.js),
   not by a comment. Delete the UNASSIGNED handling and the suite goes red.
   ──────────────────────────────────────────────────────────────────────────────────
*/
(function (root) {
  "use strict";

  /* The sentinel id for "this event has no calendar." Not a real calendar id — no
     Google calendar id can collide with it (they are emails or opaque ids, never
     this). It is the ADDRESS of the un-assigned bucket in the checked set, so the
     bucket can be checked and unchecked by exactly the same machinery as a real
     calendar, with no special case in the caller. */
  var UNASSIGNED = "__unassigned__";

  /* Is this event un-assigned? NULL, undefined, and "" all mean the same thing —
     nobody told us which calendar this is. Treat them identically; a filter that
     distinguishes NULL from "" is a filter that will drop rows on a whim. */
  function isUnassigned(ev) {
    if (!ev) return true;
    var id = ev.calendar_id;
    return id === null || id === undefined || id === "";
  }

  /* The address an event answers to in the checked set. */
  function addressOf(ev) {
    return isUnassigned(ev) ? UNASSIGNED : String(ev.calendar_id);
  }

  /* Do any of these events lack a calendar? If none do, the Unassigned slot is not
     OFFERED at all — an always-empty control is a lie about the data (the same
     present-gating rule mail's Spam view-word runs: never offer a view onto nothing). */
  function hasUnassigned(events) {
    if (!events || !events.length) return false;
    for (var i = 0; i < events.length; i++) { if (isUnassigned(events[i])) return true; }
    return false;
  }

  /* The slot list the rail renders: the real calendars, plus the Unassigned bucket
     IFF some event actually needs it. `calendars` is the tool's /api/calendars rows
     ({ id, name, color, ... }) verbatim — this module renames nothing and ranks
     nothing; the tool owns that. */
  function slots(calendars, events) {
    var out = [];
    var list = calendars || [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c || !c.id) continue;
      out.push({
        id: String(c.id),
        name: (c.name === undefined || c.name === null || c.name === "")
          ? String(c.id) : String(c.name),   // honest: never a blank row
        color: c.color || null,
        unassigned: false
      });
    }
    if (hasUnassigned(events)) {
      out.push({ id: UNASSIGNED, name: "Unassigned", color: null, unassigned: true });
    }
    return out;
  }

  /* The default checked set: everything. A calendar the owner has never touched is
     ON — the resting state of the app is "show me my calendar," not "show me nothing
     until you configure me." */
  function defaultChecked(calendars, events) {
    return slots(calendars, events).map(function (s) { return s.id; });
  }

  /* THE FILTER. checked is an array of addresses (calendar ids and/or UNASSIGNED).

     COLD-SAFE, and this matters more than it looks: a NULL/undefined `checked` means
     "the owner has expressed no preference" — the calendar list has not loaded, or the
     seam is unreachable, or this is an older runtime. In that state the honest answer
     is EVERYTHING, unfiltered. A filter that fails CLOSED here would blank the whole
     calendar on a slow /api/calendars response, and the owner would see an empty month
     and conclude his events were gone. It fails OPEN. Always. */
  function filter(events, checked) {
    var all = events || [];
    if (checked === null || checked === undefined) return all.slice();
    if (!checked.length) return [];   // an explicit empty set IS a choice: show nothing.
    var want = {};
    for (var i = 0; i < checked.length; i++) want[String(checked[i])] = true;
    return all.filter(function (ev) { return want[addressOf(ev)] === true; });
  }

  /* How many events each slot holds, for the rail. Read-only, derived. */
  function count(events, id) {
    var all = events || [];
    var addr = String(id);
    var n = 0;
    for (var i = 0; i < all.length; i++) { if (addressOf(all[i]) === addr) n++; }
    return n;
  }

  /* Toggle one address in a checked set. Pure — returns a NEW array, never mutates
     the caller's. */
  function toggle(checked, id) {
    var cur = (checked || []).map(String);
    var addr = String(id);
    var at = cur.indexOf(addr);
    if (at === -1) { cur.push(addr); return cur; }
    cur.splice(at, 1);
    return cur;
  }

  /* SOLO one address ("only this"): return a NEW checked set showing ONLY `id`
     (every other slot hidden) — a bulk-set of the SAME visible-set `toggle`
     drives, not a new persistence seam. Ephemeral by design: colour/density are
     set-and-forget prefs, but the visible-set is a transient view filter whose
     resting state is "show everything" (defaultChecked). So un-solo restores
     ALL, not the pre-solo set: if `id` is ALREADY the sole visible member, solo
     returns null — the null/"show all" resting state (filter treats null as
     everything). Pure — never mutates. `id` is a slot address (a calendar id or
     UNASSIGNED). This is what makes un-solo reachable from the same control. */
  function solo(checked, id) {
    var cur = (checked || []).map(String);
    var addr = String(id);
    if (cur.length === 1 && cur[0] === addr) return null;   // already soloed -> restore all
    return [addr];
  }

  /* ── VERB 4 — REORDER (drag) — the persisted rail order ─────────────────────
     Unlike solo (an EPHEMERAL view filter), reorder is a SET-AND-FORGET pref,
     the same class as colour/density: the owner arranges his calendars once and
     the arrangement STAYS. It persists through view-config (calOrderOf), never
     the /api/calendars registry — the tool serves rows ORDER BY name COLLATE
     NOCASE and knows nothing about the owner's preferred order; the order is a
     pure client view-pref layered over the server's alphabetical list.

     Two pure helpers, in the module's own idiom (a NEW value out, never a
     mutation of the caller's), mirroring toggle/solo:

       reorder(order, id, newIndex) — the ORDER-ARRAY move. Splice `id` out of
         the persisted order array and re-insert at `newIndex` (the same
         splice-out-then-insert view-config.reorder uses for tabs). Returns a
         NEW array of ids. `id` not yet in the order is appended-then-moved
         (a first drag of a never-arranged calendar still lands where dropped).

       applyOrder(slots, order) — apply a persisted order to DERIVED slots.
         Real-calendar slots are re-sequenced to match `order` (ids in `order`
         first, in that sequence; any real calendar absent from `order` keeps
         its original relative position, AFTER the ordered ones). THE INVARIANT:
         the UNASSIGNED bucket is NEVER reordered — it stays pinned LAST, exactly
         where slots() appends it. UNASSIGNED is not a calendar; a reorder that
         let it float would let a drag hide history behind a bucket. */
  function reorder(order, id, newIndex) {
    var cur = (order || []).map(String);
    var addr = String(id);
    var at = cur.indexOf(addr);
    if (at !== -1) cur.splice(at, 1);                 // remove if present
    var n = cur.length;
    var idx = newIndex;
    if (idx === null || idx === undefined || idx < 0) idx = n;
    if (idx > n) idx = n;                              // clamp: never past the end
    cur.splice(idx, 0, addr);                          // insert at target
    return cur;
  }

  function applyOrder(slots, order) {
    var list = slots || [];
    if (!order || !order.length) return list.slice();  // no pref -> derived order, untouched
    var rank = {};
    for (var i = 0; i < order.length; i++) rank[String(order[i])] = i;

    var reals = [];      // real calendars, to be re-sequenced
    var buckets = [];    // UNASSIGNED (and any future bucket) — pinned, never reordered
    for (var j = 0; j < list.length; j++) {
      var s = list[j];
      if (s && s.unassigned) buckets.push(s); else reals.push(s);
    }

    /* Stable sort: ordered ids by their rank; un-ranked reals keep their
       original relative position, sorted AFTER the ranked ones. A plain
       numeric sort on (rank ?? BIG + originalIndex) is stable-by-construction. */
    var BIG = order.length;
    reals = reals.map(function (s, k) {
      var r = (s && rank[String(s.id)] !== undefined) ? rank[String(s.id)] : (BIG + k);
      return { s: s, key: r };
    }).sort(function (a, b) { return a.key - b.key; }).map(function (w) { return w.s; });

    return reals.concat(buckets);                      // buckets always last
  }

  var api = {
    _version: "1.2",
    UNASSIGNED: UNASSIGNED,
    isUnassigned: isUnassigned,
    addressOf: addressOf,
    hasUnassigned: hasUnassigned,
    slots: slots,
    defaultChecked: defaultChecked,
    filter: filter,
    count: count,
    toggle: toggle,
    solo: solo,
    reorder: reorder,
    applyOrder: applyOrder
  };

  /* Self-register onto the shell namespace (the house idiom), and export for node. */
  root.ForestShell = root.ForestShell || {};
  root.ForestShell.calendarCalendars = api;
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }

})(typeof globalThis !== "undefined" ? globalThis : this);
