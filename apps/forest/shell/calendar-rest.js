/* Shea's Forest — the App Shell · shell/calendar-rest.js
    Trio · Track CALENDAR (member B) · the thin REST client.

   The calendar front-end's ONLY door to data. A pure TRANSPORT over the runtime
   seam (J1, built) — it calls `/api/calendar/api/events*` and `/api/calendar/api/calendars`
   on the runtime, which prefix-strips `/api/calendar` and forwards in-process to the
   bundled loopcalendar tool's `handleApiRequest` against the injected calendarDb.
   (Confirmed by the seam route: forest-runtime.js seamDispatch(calSeamLib, …, '/api/calendar').)

   TC-1 (thin-client, the discipline the Confluence greps for): this module carries
   NO calendar business logic. No date arithmetic, NO recurrence expansion, no iCal
   parsing, no merge/dedup — it SENDS a request and returns the tool's JSON verbatim.
   The load-bearing case: RECURRENCE is expanded by the TOOL. A recurring event's
   concrete instances land in the tool's own store (expandRecurrence, 90-day horizon
   on create); a range read (GET /api/events?from_date&to_date) returns those already-
   expanded rows. The client asks for a window and carries what comes back. If you feel
   the urge to compute an occurrence date HERE, it belongs in the tool, not the client.

   F3 (honest read axis): every call resolves to a plain envelope
     { ok, status, code, data }
   — never throws for an HTTP error, never fabricates a body. A seam 503 surfaces as
   { ok:false, status:503, code:'E_SEAM_NO_REGISTRY' }; a 401 as { ok:false, status:401 };
   a network drop as { ok:false, status:0, code:'E_UNREACHABLE' }. The renderer reads
   `ok`/`status`/`code` to paint the honest badge — a down/empty read NEVER renders as
   current/landed.

   F1 (mutation-safety): the destructive writes (create, update, delete) carry an
   `Idempotency-Key` header — a UUID per user-intent. A retried write with the same key
   REPLAYS the first response at the seam instead of double-applying. The client MINTS
   the key; the seam holds the replay cache. Reads carry no key.

   Owner-gated: every request is CREDENTIALED (`credentials:'include'`), mirroring
   shell-renderers.js's getJSON(url, true) pattern and contacts-rest.js.

   Boundary (Confluence §1, Track CALENDAR): owns calendar-* + this client. Touches
   ONLY /api/calendar/*. NEVER edits forest-runtime.js (the seam is done); NEVER touches
   the mail app, contacts, or the calendar TOOL. iCal import/export is a TOOL capability
   now ROUTED at the seam (, forest-trio-ical-seam-route): the merged line added a
   lib-shim intercept in loopcalendar-lib.js (NOT a runtime edit, NOT a tool edit) that
   routes GET /api/events/export.ics -> text/calendar and POST /api/events/import ->
   { imported, ... }. The iCal methods below are LIVE (_seamPending is now empty); the
   renderer surfaces real Import/Export controls. We still do NOT parse iCal here (that is
   tool business logic) — export is a text download, import posts { ics } and the tool does
   the parse/dedup.

   Plain script (no ES module) — attaches to window.ForestShell.calendarRest.
   Injectable fetch (opts.fetch) so it is unit-testable with a mocked fetch, cold-safe. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  // The external seam prefix. The runtime strips this and forwards the remainder
  // (`/api/events…`, `/api/calendars`) to the tool's handleApiRequest. Mirrors the
  // contact seam: external GET /api/calendar/api/events -> tool sees /api/events.
  var SEAM = "/api/calendar";

  /* RFC4122-ish v4 UUID for the Idempotency-Key. crypto.randomUUID when present
     (all live browsers), else a Math.random fallback — the key only needs to be
     unique per user-intent within the replay window, not cryptographically strong. */
  function uuid() {
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
    } catch (e) { /* fall through */ }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0, v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function makeClient(opts) {
    opts = opts || {};
    var base = (opts.base != null ? opts.base : (root.runtimeBase ||
      (typeof window !== "undefined" && window.FOREST_RUNTIME) || "")) + SEAM;
    var fetchImpl = opts.fetch || (typeof fetch === "function" ? fetch : null);

    // The one transport. Returns the honest envelope; NEVER throws for HTTP status,
    // NEVER fabricates data. A parse failure or a network error coerces to a
    // reached-nothing envelope (F3: unreachable is honest, never a fake body).
    function call(method, toolPath, o) {
      o = o || {};
      if (!fetchImpl) return Promise.resolve({ ok: false, status: 0, code: "E_NO_FETCH", data: null });
      var url = base + toolPath;
      var headers = {};
      var init = { method: method, cache: "no-store", credentials: "include", headers: headers };
      if (o.body !== undefined) {
        headers["content-type"] = "application/json";
        init.body = JSON.stringify(o.body);
      }
      // F1: a destructive intent carries an Idempotency-Key (minted or passed in).
      if (o.idempotent) headers["Idempotency-Key"] = o.idempotencyKey || uuid();
      return fetchImpl(url, init).then(function (r) {
        if (!r) return { ok: false, status: 0, code: "E_UNREACHABLE", data: null };
        return r.json().then(function (j) {
          return { ok: r.ok, status: r.status, code: (j && j.code) || null, data: j,
            replay: (r.headers && typeof r.headers.get === "function" && r.headers.get("Idempotent-Replay") === "true") || false };
        }).catch(function () {
          // ok:true with an unparseable body is still a reach-failure at this layer.
          return { ok: false, status: r.status || 0, code: "E_BAD_BODY", data: null };
        });
      }).catch(function () {
        return { ok: false, status: 0, code: "E_UNREACHABLE", data: null };
      });
    }

    function qs(params) {
      var parts = [];
      Object.keys(params || {}).forEach(function (k) {
        var v = params[k];
        if (v === undefined || v === null || v === "") return;
        parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
      });
      return parts.length ? "?" + parts.join("&") : "";
    }

    return {
      // ---- READS (no key; owner-gated) --------------------------------------
      // GET /api/calendars -> { calendars:[...], total }
      calendars: function (o) {
        o = o || {};
        var p = {};
        if (o.source) p.source = o.source;
        if (o.account) p.account = o.account;
        return call("GET", "/api/calendars" + qs(p));
      },
      // ---- WRITES (calendar-type manager, step 3) ---------------------------
      // POST /api/calendars { id, name, ... } -> the tool's upsertCalendar
      // (INSERT ... ON CONFLICT(id) DO UPDATE SET name/color/source/account). The
      // upsert is id-keyed: a NEW id CREATES a calendar-type, an EXISTING id RENAMES
      // (or re-fields) it -- so create AND rename ride this ONE endpoint (no PUT).
      // Byte-verified: the frozen tool serves POST /api/calendars, and the runtime
      // seam (forest-runtime seamDispatch) forwards it method-agnostically, so this
      // is a STATIC-only client change (no runtime deploy). Pass the EXISTING color/
      // source/account on a rename -- the tool does SET color = excluded.color, so
      // omitting them would NULL those columns. Cold-safe: no fetch -> {ok:false}.
      saveCalendar: function (cal) {
        cal = cal || {};
        var body = { id: cal.id, name: cal.name };
        if (cal.color !== undefined) body.color = cal.color;
        if (cal.source !== undefined) body.source = cal.source;
        if (cal.account !== undefined) body.account = cal.account;
        return call("POST", "/api/calendars", { body: body });
      },
      // DELETE /api/calendars/:id -> verb 6 (delete-merge). The runtime seam
      // (loopcalendar-lib) reassigns this calendar's events to Unassigned (never
      // orphaned) IN ONE TRANSACTION and removes the calendars row, returning
      // { deleted, id, reassigned }. WIRED : the model's deleteCalendar
      // primitive + the DELETE /api/calendars/:id route now exist in loopcalendar.js
      // (test-loopcalendar-delete-calendar.js, 6/6) -- the seam owns this terminus,
      // the same door create/rename POST through. Previously the frozen tool had no
      // such route (the ✕ hit a 405/404); this closes that backend gap.
      // UNASSIGNED is never deletable (it is the bucket, not a type).
      deleteCalendar: function (id) {
        return call("DELETE", "/api/calendars/" + encodeURIComponent(id));
      },
      // GET /api/events -> { events:[...], total }. The RANGE read the grid/agenda use;
      // from_date/to_date bound the window and the tool returns ALREADY-EXPANDED
      // recurrence instances (TC-1: the client computes NO occurrence dates).
      events: function (o) {
        o = o || {};
        var p = {};
        if (o.from_date) p.from_date = o.from_date;
        if (o.to_date) p.to_date = o.to_date;
        if (o.category) p.category = o.category;
        if (o.status) p.status = o.status;
        if (o.calendar_id) p.calendar_id = o.calendar_id;
        // E6 (the Person Canopy) — contact_id scopes the read to the events THIS contact is on
        // (their Moments for the canopy). The tool filters by the event_attendees link.
        if (o.contact_id) p.contact_id = o.contact_id;
        // THE GUEST-LIST READ. attendee_email is the half that works on INGESTED data.
        // contact_id only ever matched events Shea invited someone to THROUGH Forest (the E4 button),
        // so on Google-synced events it matched nothing, forever. Here CONTACTS hands over the
        // addresses it already holds for this person and asks which invites carried them. The
        // calendar resolves no identity and stores no binding; the two filters UNION.
        if (o.attendee_email) {
          p.attendee_email = Array.isArray(o.attendee_email)
            ? o.attendee_email.join(",")
            : o.attendee_email;
        }
        if (o.limit != null) p.limit = o.limit;
        if (o.offset != null) p.offset = o.offset;
        return call("GET", "/api/events" + qs(p));
      },
      // GET /api/events?q= -> the tool's search result (envelope tool-shaped).
      search: function (q) { return call("GET", "/api/events" + qs({ q: q })); },
      // GET /api/events/:id -> the full event (recurrence_rule_parsed, exceptions, etc.)
      get: function (id) { return call("GET", "/api/events/" + encodeURIComponent(id)); },

      // ---- WRITES (Idempotency-Key; owner-gated) ----------------------------
      // POST /api/events -> create. Recurrence: pass recurrence_rule and the TOOL
      // expands it (the client sends the rule verbatim, never expands it). Idempotent.
      create: function (event, key) {
        return call("POST", "/api/events",
          { body: event, idempotent: true, idempotencyKey: key });
      },
      // PUT /api/events/:id -> update. Idempotent.
      update: function (id, patch, key) {
        return call("PUT", "/api/events/" + encodeURIComponent(id),
          { body: patch, idempotent: true, idempotencyKey: key });
      },
      // DELETE /api/events/:id -> remove. Idempotent (replay-safe at the seam).
      remove: function (id, key) {
        return call("DELETE", "/api/events/" + encodeURIComponent(id),
          { idempotent: true, idempotencyKey: key });
      },

      // ---- iCal (LIVE — routed at the lib-shim seam,) --------------
      // The tool's icalendar-export/import are now routed by loopcalendar-lib's seam
      // wrap: GET /api/events/export.ics answers text/calendar; POST /api/events/import
      // takes { ics } and returns { imported, duplicates, skipped, event_ids }. Still
      // TC-1: no iCal parsing here — the tool does the work; we transport.
      //
      // Export is a FILE download, not a JSON envelope: call() force-JSON-parses, so
      // export uses a raw fetch and returns an HONEST TEXT envelope { ok, status, code,
      // text } (never throws, never fabricates). exportICalUrl() gives the renderer a
      // direct download href (same-origin, cookie-gated) for a browser-native save.
      exportICalUrl: function () { return base + "/api/events/export.ics"; },
      exportICal: function () {
        var url = base + "/api/events/export.ics";
        if (!fetchImpl) return Promise.resolve({ ok: false, status: 0, code: "E_NO_FETCH", text: null });
        return fetchImpl(url, { method: "GET", cache: "no-store", credentials: "include" }).then(function (r) {
          if (!r) return { ok: false, status: 0, code: "E_UNREACHABLE", text: null };
          return r.text().then(function (t) {
            return { ok: r.ok, status: r.status, code: r.ok ? null : "E_HTTP", text: r.ok ? t : null };
          }).catch(function () { return { ok: false, status: r.status || 0, code: "E_BAD_BODY", text: null }; });
        }).catch(function () { return { ok: false, status: 0, code: "E_UNREACHABLE", text: null }; });
      },
      // importICal(text): POST /api/events/import — rides call() (JSON in, JSON envelope out).
      importICal: function (icsText, key) {
        return call("POST", "/api/events/import",
          { body: { ics: icsText }, idempotent: true, idempotencyKey: key });
      },
      // E4 — invite a contact: POST /api/events/:id/attendees { display_name, contact_id? }.
      // The lib-shim routes this to the tool's addAttendee (the tool owns validation + the
      // has_attendee graph edge). TC-1: transport only, no attendee logic here. Idempotent —
      // the client mints the key, so a retried invite replays rather than double-adds.
      addAttendee: function (eventId, attendee, key) {
        var body = {
          display_name: (attendee && attendee.displayName) || "",
          contact_id: (attendee && attendee.contactId) || undefined,
          role: (attendee && attendee.role) || undefined,
          status: (attendee && attendee.status) || undefined
        };
        return call("POST", "/api/events/" + encodeURIComponent(eventId) + "/attendees",
          { body: body, idempotent: true, idempotencyKey: key });
      },
      // P6 — un-invite: DELETE /api/events/:id/attendees/:attendeeId. The lib-shim routes this
      // to the tool's removeAttendee (which retracts the has_attendee graph edge and writes the
      // proof-chain entry — the seam does none of that, and must not). TC-1: transport only.
      // Idempotent, and here that word is load-bearing rather than decorative: a retried DELETE
      // must not be read as a SECOND un-invite. The tool answers 404 "attendee not found" on a
      // replay, which the renderer would otherwise be entitled to paint as a failure on a row
      // that is, in fact, already gone. The key makes the replay a replay.
      removeAttendee: function (eventId, attendeeId, key) {
        return call("DELETE", "/api/events/" + encodeURIComponent(eventId)
          + "/attendees/" + encodeURIComponent(attendeeId),
          { idempotent: true, idempotencyKey: key });
      },

      _seamPending: [],

      _uuid: uuid,
      _base: base
    };
  }

  /* ---- export --------------------------------------------------------------- */
  root.calendarRest = {
    makeClient: makeClient,
    _version: "1.3"
  };
})();
