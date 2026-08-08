/* Shea's Forest — the App Shell · shell/contacts-rest.js
    Trio · Track CONTACT (member A) · the thin REST client.

   The contact front-end's ONLY door to data. A pure TRANSPORT over the runtime
   seam (J1, built) — it calls `GET/POST /api/contact/api/contacts*` on the runtime,
   which prefix-strips `/api/contact` and forwards in-process to the bundled
   loopcontact tool's `handleApiRequest` against the injected contactDb.

   TC-1 (thin-client, the load-bearing discipline this file must NOT break):
   this module carries NO contact business logic. No merge/entity-resolution math,
   no name normalization, no confidence scoring, no dedup — it SENDS a request and
   returns the tool's JSON verbatim. Every judgment (which contacts merge, at what
   confidence) is the tool's; the client just carries the wire. If you feel the urge
   to compute something about a contact HERE, it belongs in the tool, not the client.

   F3 (honest read axis): every call resolves to a plain envelope
     { ok, status, code, data }
   — never throws for an HTTP error, never fabricates a body. A seam 503 surfaces as
   { ok:false, status:503, code:'E_SEAM_NO_REGISTRY' }; a 401 as { ok:false, status:401 };
   a network drop as { ok:false, status:0, code:'E_UNREACHABLE' }. The renderer reads
   `ok`/`status`/`code` to paint the honest badge — a down/empty read NEVER renders as
   current/landed.

   F1 (mutation-safety): the destructive writes (merge, delete, bulk, starred PUT)
   carry an `Idempotency-Key` header — a UUID per user-intent. A retried write with the
   same key REPLAYS the first response at the seam instead of double-applying. The
   client MINTS the key; the seam holds the replay cache. Reads carry no key.

   Owner-gated: every request is CREDENTIALED (the app holds the owner session;
   `credentials:'include'`), mirroring shell-renderers.js's getJSON(url, true) pattern.

   Boundary (Confluence §1, Track CONTACT): owns contacts-* + this client. Touches
   ONLY /api/contact/*. NEVER edits forest-runtime.js (the seam is done); NEVER touches
   the mail app or calendar. A mail-compose or soil action is a SURFACE the renderer
   shows but does NOT wire here — that wiring is the merged line (J3).

   Plain script (no ES module) — attaches to window.ForestShell.contactsRest.
   Injectable fetch (opts.fetch) so it is unit-testable with a mocked fetch, cold-safe. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  // The external seam prefix. The runtime strips this and forwards the remainder
  // (`/api/contacts…`) to the tool's handleApiRequest. Confirmed by the seam test:
  // external GET /api/contact/api/contacts -> tool sees /api/contacts.
  var SEAM = "/api/contact";

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
      // GET /api/contacts -> { contacts:[...], total } ; starred/status/limit/offset
      // K6-A: `label` closes the write-only loop. labelsAll() below has always
      // enumerated the vocabulary; until the substrate learned ?label=, nothing
      // could read it back out as a query. The filtered response's `total` is
      // filtered too, so the count the rail shows is the count the page holds.
      list: function (o) {
        o = o || {};
        var p = {};
        if (o.starred) p.starred = "1";
        if (o.status) p.status = o.status;
        if (o.label) p.label = o.label;
        if (o.limit != null) p.limit = o.limit;
        if (o.offset != null) p.offset = o.offset;
        return call("GET", "/api/contacts" + qs(p));
      },
      // GET /api/contacts/search?q= -> the tool's FTS5 result (envelope tool-shaped)
      search: function (q) { return call("GET", "/api/contacts/search" + qs({ q: q })); },
      // GET /api/contacts/:id -> the full record (emails/phones/addresses/notes/custom)
      get: function (id) { return call("GET", "/api/contacts/" + encodeURIComponent(id)); },
      // GET /api/contacts/suggest-merges -> candidates (READ-ONLY; !== the POST merge)
      suggestMerges: function () { return call("GET", "/api/contacts/suggest-merges"); },
      // GET /api/contacts/export -> the tool's export payload ({vcard}); ?format=csv -> {csv}.
      exportAll: function (format) { return call("GET", "/api/contacts/export" + qs({ format: format })); },
      // GET /api/labels -> { labels:[...] } the full label vocabulary (list-filter source)
      labelsAll: function () { return call("GET", "/api/labels"); },
      // GET /api/contacts/:id/labels -> { labels:[...] } this contact's labels
      contactLabels: function (id) { return call("GET", "/api/contacts/" + encodeURIComponent(id) + "/labels"); },

      // ---- WRITES (Idempotency-Key; owner-gated) ----------------------------
      // POST /api/contacts/merge -> merge two contacts. The tool's REAL contract is
      // { contact_a, contact_b, survivor_id?, field_choices?, reason?, auto? } — it
      // REQUIRES contact_a/contact_b (the prior {survivor_id,merged_id} body was a
      // silent 400). ask-first is the RENDERER's job; the client carries confirmed
      // intent. Idempotent. Back-compat: a string 3rd arg is treated as the key.
      merge: function (contactA, contactB, opts, key) {
        opts = opts || {};
        if (typeof opts === "string") { key = opts; opts = {}; }
        var body = { contact_a: contactA, contact_b: contactB };
        if (opts.survivorId != null) body.survivor_id = opts.survivorId;
        if (opts.fieldChoices) body.field_choices = opts.fieldChoices;
        if (opts.reason != null) body.reason = opts.reason;
        if (opts.auto) body.auto = true;
        return call("POST", "/api/contacts/merge",
          { body: body, idempotent: true, idempotencyKey: key });
      },
      // GET /api/contacts/:id/merge-history -> { history:[...] } past merges for this
      // contact (survivor or merged side). READ-ONLY, no key.
      mergeHistory: function (id) {
        return call("GET", "/api/contacts/" + encodeURIComponent(id) + "/merge-history");
      },
      // PUT /api/contacts/:id -> update (the star toggle rides this). Idempotent.
      update: function (id, patch, key) {
        return call("PUT", "/api/contacts/" + encodeURIComponent(id),
          { body: patch, idempotent: true, idempotencyKey: key });
      },
      // DELETE /api/contacts/:id -> remove. Idempotent (replay-safe at the seam).
      remove: function (id, key) {
        return call("DELETE", "/api/contacts/" + encodeURIComponent(id),
          { idempotent: true, idempotencyKey: key });
      },
      // POST /api/contacts/:id/labels { label, color? } -> attach a label. Idempotent.
      // TC-1: the renderer passes the typed label + swatch; the tool owns dedup/creation.
      addLabel: function (id, label, color, key) {
        return call("POST", "/api/contacts/" + encodeURIComponent(id) + "/labels",
          { body: { label: label, color: color || null }, idempotent: true, idempotencyKey: key });
      },
      // DELETE /api/contacts/:id/labels/:name -> detach a label (name in the path). Idempotent.
      removeLabel: function (id, name, key) {
        return call("DELETE", "/api/contacts/" + encodeURIComponent(id) + "/labels/" + encodeURIComponent(name),
          { idempotent: true, idempotencyKey: key });
      },
      // ---- W1: the RECORD WRITE PATH (§5 W1) --------------------------
      // These verbs were the ONLY missing layer of the contact write path. Every
      // route below ALREADY answers on the tool and ALREADY passes the seam (which
      // is a generic pass-through with idempotency handling for mutating methods) —
      // v2's F2 claimed they did not exist at any layer; that was false, and
      // the receipt is internal (16/16, zero substrate
      // bytes changed). TC-1 holds throughout: these SEND typed intent and return the
      // tool's JSON. No validation math, no normalization, no primary-election logic —
      // the tool owns all of it (it recomputes content_hash and journals every write).
      //
      // POST /api/contacts { display_name, given_name?, family_name?, organization?,
      //   title?, email?, phone?, notes?, starred? } -> 201 + the new contact.
      // display_name is the tool's ONLY required field (it 400s without one); the
      // renderer enforces nothing — it sends, and paints whatever comes back. Idempotent.
      create: function (fields, key) {
        return call("POST", "/api/contacts",
          { body: fields || {}, idempotent: true, idempotencyKey: key });
      },

      // Emails — POST /api/contacts/:id/emails { email, label?, is_primary? } -> 201.
      addEmail: function (id, email, label, isPrimary, key) {
        return call("POST", "/api/contacts/" + encodeURIComponent(id) + "/emails",
          { body: { email: email, label: label || null, is_primary: !!isPrimary },
            idempotent: true, idempotencyKey: key });
      },
      // DELETE /api/contacts/:id/emails/:emailId -> 200. Idempotent.
      removeEmail: function (id, emailId, key) {
        return call("DELETE", "/api/contacts/" + encodeURIComponent(id) + "/emails/" + encodeURIComponent(emailId),
          { idempotent: true, idempotencyKey: key });
      },

      // Phones — POST /api/contacts/:id/phones { phone, label?, is_primary? } -> 201.
      addPhone: function (id, phone, label, isPrimary, key) {
        return call("POST", "/api/contacts/" + encodeURIComponent(id) + "/phones",
          { body: { phone: phone, label: label || null, is_primary: !!isPrimary },
            idempotent: true, idempotencyKey: key });
      },
      // DELETE /api/contacts/:id/phones/:phoneId -> 200. Idempotent.
      removePhone: function (id, phoneId, key) {
        return call("DELETE", "/api/contacts/" + encodeURIComponent(id) + "/phones/" + encodeURIComponent(phoneId),
          { idempotent: true, idempotencyKey: key });
      },

      // Addresses — POST /api/contacts/:id/addresses { street?, city?, state?,
      //   postal_code?, country?, label?, is_primary? } -> 201. The tool's wire names
      //   are snake_case and its column is `state` (NOT `region` — the record pane read
      //   `a.region` for months and silently rendered no state). Idempotent.
      addAddress: function (id, parts, key) {
        parts = parts || {};
        return call("POST", "/api/contacts/" + encodeURIComponent(id) + "/addresses",
          { body: {
              street: parts.street || null,
              city: parts.city || null,
              state: parts.state || null,
              postal_code: parts.postalCode || parts.postal_code || null,
              country: parts.country || null,
              label: parts.label || null,
              is_primary: !!parts.isPrimary
            }, idempotent: true, idempotencyKey: key });
      },
      // DELETE /api/contacts/:id/addresses/:addressId -> 200. Idempotent.
      removeAddress: function (id, addressId, key) {
        return call("DELETE", "/api/contacts/" + encodeURIComponent(id) + "/addresses/" + encodeURIComponent(addressId),
          { idempotent: true, idempotencyKey: key });
      },

      // Custom fields — POST /api/contacts/:id/fields { field_name, field_value } -> 200.
      // An UPSERT at the tool (setField), so re-sending an existing name EDITS it — the
      // reason there is no separate "editField" verb. Idempotent.
      setField: function (id, name, value, key) {
        return call("POST", "/api/contacts/" + encodeURIComponent(id) + "/fields",
          { body: { field_name: name, field_value: value != null ? value : null },
            idempotent: true, idempotencyKey: key });
      },
      // DELETE /api/contacts/:id/fields/:fieldName -> 200 (keyed by NAME, not row id). Idempotent.
      removeField: function (id, name, key) {
        return call("DELETE", "/api/contacts/" + encodeURIComponent(id) + "/fields/" + encodeURIComponent(name),
          { idempotent: true, idempotencyKey: key });
      },

      // ---- K3 relationships (RelationshipPanel over the tool's OWN graph) -----
      // GET /api/contacts/:id/links -> { links:[...] } this contact's relationship
      // edges (the DETAIL record also carries `relationships`; this is the live read
      // for the panel after a mutation). READ-ONLY, no key.
      contactLinks: function (id) {
        return call("GET", "/api/contacts/" + encodeURIComponent(id) + "/links");
      },
      // POST /api/contacts/:id/links { target_contact, relationship?, one_way? } -> 201.
      // relationship defaults to 'knows' at the TOOL; the renderer passes typed intent,
      // the tool owns the edge. Idempotent (F1 write).
      addLink: function (id, target, relationship, oneWay, key) {
        var body = { target_contact: target };
        if (relationship) body.relationship = relationship;
        if (oneWay) body.one_way = true;
        return call("POST", "/api/contacts/" + encodeURIComponent(id) + "/links",
          { body: body, idempotent: true, idempotencyKey: key });
      },
      // DELETE /api/contacts/:id/links?target_contact=&relationship= -> 200. The tool
      // tolerates a body OR query; query is the replay-safe DELETE form. Idempotent.
      removeLink: function (id, target, relationship, key) {
        return call("DELETE", "/api/contacts/" + encodeURIComponent(id) + "/links" +
          qs({ target_contact: target, relationship: relationship }),
          { idempotent: true, idempotencyKey: key });
      },
      // ---- K4 notes + follow-ups + activity timeline -------------------------
      // GET /api/contacts/:id/notes -> { notes:[{id, note_text, created_at}] }. Read.
      notes: function (id) { return call("GET", "/api/contacts/" + encodeURIComponent(id) + "/notes"); },
      // POST /api/contacts/:id/notes { text } -> 201. Idempotent write.
      addNote: function (id, text, key) {
        return call("POST", "/api/contacts/" + encodeURIComponent(id) + "/notes",
          { body: { text: text }, idempotent: true, idempotencyKey: key });
      },
      // DELETE /api/contacts/:id/notes/:noteId -> 200. Idempotent.
      removeNote: function (id, noteId, key) {
        return call("DELETE", "/api/contacts/" + encodeURIComponent(id) + "/notes/" + encodeURIComponent(noteId),
          { idempotent: true, idempotencyKey: key });
      },
      // GET /api/contacts/:id/followups -> { followups:[...] }. Read.
      followups: function (id) { return call("GET", "/api/contacts/" + encodeURIComponent(id) + "/followups"); },
      // POST /api/contacts/:id/followups { note?, due_date? } -> 201. Idempotent.
      addFollowUp: function (id, note, dueDate, key) {
        var body = {};
        if (note) body.note = note;
        if (dueDate) body.due_date = dueDate;
        return call("POST", "/api/contacts/" + encodeURIComponent(id) + "/followups",
          { body: body, idempotent: true, idempotencyKey: key });
      },
      // PUT /api/contacts/:id/followups/:fid { note?, due_date?, completed? } -> 200. Idempotent.
      updateFollowUp: function (id, fid, patch, key) {
        return call("PUT", "/api/contacts/" + encodeURIComponent(id) + "/followups/" + encodeURIComponent(fid),
          { body: patch || {}, idempotent: true, idempotencyKey: key });
      },
      // DELETE /api/contacts/:id/followups/:fid -> 200. Idempotent.
      removeFollowUp: function (id, fid, key) {
        return call("DELETE", "/api/contacts/" + encodeURIComponent(id) + "/followups/" + encodeURIComponent(fid),
          { idempotent: true, idempotencyKey: key });
      },
      // GET /api/contacts/:id/timeline -> { timeline:[...] } merged proof-chain +
      // event records, newest-first. Runtime event types are not enumerated here —
      // render verbatim (TC-1: no fixed type list, no computed labels). Read.
      timeline: function (id) { return call("GET", "/api/contacts/" + encodeURIComponent(id) + "/timeline"); },
      // GET /api/followups?due=YYYY-MM-DD (defaults today) -> { followups, due } —
      // cross-contact OPEN follow-ups due, for the LIST due-glow dot. Read.
      dueFollowups: function (due) { return call("GET", "/api/followups" + qs({ due: due })); },
      // ---- K5 import/export --------------------------------------------------
      // POST /api/contacts/import { vcard_text } OR { csv_text, format:'csv' } -> 200.
      // The renderer passes raw text + a format flag; the tool owns the PARSE (TC-1).
      // Idempotent write.
      importText: function (text, format, key) {
        var body = (format === "csv") ? { csv_text: text, format: "csv" } : { vcard_text: text };
        return call("POST", "/api/contacts/import", { body: body, idempotent: true, idempotencyKey: key });
      },
      // POST /api/contacts/bulk { ids, action, value } (action in label|status|delete) -> 200.
      // Idempotent. (Multi-select surface; wired if the UI grows one.)
      bulk: function (ids, action, value, key) {
        return call("POST", "/api/contacts/bulk",
          { body: { ids: ids, action: action, value: value }, idempotent: true, idempotencyKey: key });
      },
      _uuid: uuid,
      _base: base
    };
  }

  /* ---- export --------------------------------------------------------------- */
  root.contactsRest = {
    makeClient: makeClient,
    _version: "1.6"
  };
})();
