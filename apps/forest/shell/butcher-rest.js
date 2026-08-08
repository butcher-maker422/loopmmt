/* Shea's Forest — the App Shell · shell/butcher-rest.js
   Butcher Forest · the thin REST client (the browser leg of go-live wiring).

   The Butcher Forest front-end's ONLY door to data. A pure TRANSPORT over the
   runtime seam `/api/butcher/*` (the SERVER leg — routes in forest-runtime.js —
   is the entangled half deferred to the box-bug arc; see
   projects/butcher-forest/go-live-wiring-plan-v1.md). This client is built and
   testable NOW against a mocked fetch; the day the routes land, it just works.

   TC-1 (thin-client, the load-bearing discipline this file must NOT break):
   this module carries NO butcher business logic. No chain math, no signing, no
   verify, no lane-grouping — it SENDS a request and returns the runtime's JSON
   verbatim. Every judgment (append+sign, sliceChain, verifyChain, stampHtml)
   is the runtime's, over the Node Record/Ring/Stamp modules; the client carries
   the wire. If you feel the urge to compute something about an order HERE, it
   belongs in the runtime, not the client. The surfaces stay PURE, the client
   stays THIN — that is the whole contract.

   F3 (honest read axis): every call resolves to a plain envelope
     { ok, status, code, data }
   — never throws for an HTTP error, never fabricates a body. A 401 (the keyless
   case) surfaces as { ok:false, status:401 }; a network drop as
   { ok:false, status:0, code:'E_UNREACHABLE' }. The renderer reads ok/status to
   paint the honest badge — a down/keyless read NEVER renders as a real order.

   F1 (mutation-safety): the one destructive write (intake -> a signed record
   append) carries an `Idempotency-Key` — a UUID per user-intent — so a retried
   submit REPLAYS the first response at the seam instead of double-appending.
   Reads carry no key.

   Owner-gated: every request is CREDENTIALED (`credentials:'include'`) — the
   intake write route sits BELOW the runtime's owner-session key gate.

   Plain script (no ES module) — attaches to window.ForestShell.butcherRest.
   Injectable fetch (opts.fetch) so it is unit-testable with a mocked fetch,
   cold-safe. Modeled verbatim on contacts-rest.js's shape (PX: reuse the jig). */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  // The external seam prefix. The runtime strips this and forwards the remainder
  // to the butcher route handler over the Node Record/Ring/Stamp modules.
  var SEAM = "/api/butcher";

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

    // The one transport. Returns the honest envelope; NEVER throws for HTTP
    // status, NEVER fabricates data. A parse failure or network error coerces to
    // a reached-nothing envelope (F3: unreachable is honest, never a fake body).
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
      if (o.idempotent) headers["Idempotency-Key"] = o.idempotencyKey || uuid();
      return fetchImpl(url, init).then(function (r) {
        if (!r) return { ok: false, status: 0, code: "E_UNREACHABLE", data: null };
        return r.json().then(function (j) {
          return { ok: r.ok, status: r.status, code: (j && j.code) || null, data: j,
            replay: (r.headers && typeof r.headers.get === "function" && r.headers.get("Idempotent-Replay") === "true") || false };
        }).catch(function () {
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
      // GET /api/butcher/board -> { orders:[{order_id, latest_event, ...}] }.
      // The board groups by the Record's OWN latest event (never an order-model).
      // Optional `season` (a 4-digit UTC year) windows the board to the orders that
      // OPENED that year (GET /board?season=YYYY) — the SAME orders[] shape, so the
      // archive picker re-runs the dashboard against a past season with no new parse
      // path. No arg -> the full board, byte-unchanged (the season is only appended
      // when supplied). Bad season -> the server answers E_BAD_SEASON 400, never coerced.
      board: function (season) {
        return call("GET", "/board" + (season == null || season === "" ? "" : qs({ season: season })));
      },
      // GET /api/butcher/seasons -> { ok:true, seasons:[{season,from,to,count}] } —
      // the box's FULL season LIST (every year the deployed record holds), newest-first,
      // the same partition rule (openedYearOf) the windowed board uses. This is what lets
      // the archive picker offer seasons the browser never loaded; an unprovisioned box
      // answers a clean 503 and the surface keeps its honest wall. Owner-gated READ, no key.
      seasons: function () { return call("GET", "/seasons"); },
      // GET /api/butcher/order?order_id= -> { order_id, entries:[...], verify:{valid,reason,failure_seq} }
      // exactly the shape renderOrder expects (intake facts + full timeline + honest verify chip).
      order: function (orderId) { return call("GET", "/order" + qs({ order_id: orderId })); },
      // GET /api/butcher/cooler?from=&to= -> the per-day cooler roll-up:
      //   { ok, toSupplied, days:[{date, readings[], count, missed}], zone, zoneAssumed,
      //     from, to, dayCount, missedCount, count }
      // T-4, the auditor's read. BOTH BOUNDS ARE OPTIONAL AND THE OMISSION IS THE POINT:
      // omitting `to` is what makes the server strike TODAY off its own clock, which is the
      // only way "nobody has checked since Tuesday" is renderable at all (the fold has no
      // clock — its last day always holds a reading by construction). `toSupplied` on the
      // response reports which of the two happened. Pass `to` only when a reader has
      // deliberately asked for a historical window; the DEFAULT CALL IS THE AUDIT CALL.
      // `spanDeclared` is NOT on this wire — it is constant-true through this route and was
      // dropped at so a face cannot paint a constant as a finding. It still lives
      // on the fold, where a clockless direct caller needs it; do not go looking for it here.
      cooler: function (from, to) { return call("GET", "/cooler" + qs({ from: from, to: to })); },
      // GET /api/butcher/stamp?order_id= -> { html } the self-contained, offline-verifiable
      // Stamp export (stampChain + stampHtml). The renderer triggers the browser download;
      // the exported HTML is the authority, not the pane (its guard blocks only KNOWN-broken).
      stamp: function (orderId) { return call("GET", "/stamp" + qs({ order_id: orderId })); },

      // GET /api/butcher/export -> { ok:true, order_file } — the WHOLE signed record
      // serialized as the round-trippable order-file (butcher-order-file.js
      // exportOrders+serialize), read from the deployed box's sqlite record. The
      // browser mirror omits exportOrders (no browser db), so THIS is the read-side
      // deploy half: the porter downloads `order_file` verbatim and parse()s it back.
      // An unprovisioned box answers a clean 503 (the store existence gate) — the
      // renderer paints the honest note and NEVER fabricates a file (the state-lie
      // this campaign kills). Owner-gated READ; no Idempotency-Key (reads carry none).
      exportRecord: function () { return call("GET", "/export"); },

      // ---- WRITE (Idempotency-Key; owner-gated) -----------------------------
      // POST /api/butcher/intake { order_id, event:"intake", actor, detail } -> the appended
      // entry. The payload is renderIntake's onIntake payload VERBATIM — already record-ready,
      // NO translation. The runtime appends+signs via appendEntry(db, payload, ring).
      intake: function (payload, key) {
        return call("POST", "/intake", { body: payload, idempotent: true, idempotencyKey: key });
      },
      // POST /api/butcher/event { order_id, event, actor, detail } -> the appended entry.
      // E1, the Advance. The SAME signed append as intake() under an honest name: this is how
      // the list MOVES an order (record the next event; the lane follows). The runtime routes
      // /event and /intake to one handler — /intake stays the right name for the FIRST event.
      // RECORD AN EVENT, NEVER SET A STAGE (standing law 4): there is no stage field to set,
      // and a failed append must leave the row where it was.
      event: function (payload, key) {
        return call("POST", "/event", { body: payload, idempotent: true, idempotencyKey: key });
      },
      // POST /api/butcher/event { order_id, event:"correction", actor, detail } -> the appended
      // entry. E2, the Correction. THE SAME signed append again, under a third honest name —
      // exactly the E1 precedent (/intake and /event are one handler, and adding a second write
      // path would be the claim the chain cannot back). A correction is an ordinary entry whose
      // detail carries supersedes/reason/event; the runtime REFUSES it at append if the target
      // does not resolve, so a failed correction leaves the row exactly where it was.
      // No delete verb exists on this client, and none is coming — that is the whole design.
      correct: function (payload, key) {
        return call("POST", "/event", { body: payload, idempotent: true, idempotencyKey: key });
      },

      // ---- THE OPENING (O-4; owner-gated, ABOVE the store guard) -------------
      // GET /api/butcher/shop -> { ok:true, state:"unopened" }
      //                       |  { ok:true, state:"open", shop:{ name, place,
      //                            mark_pubkey, mark, mark_fingerprint, opened_at, entry_hash } }
      // A READ THAT CREATES NOTHING. It is the ONLY route that answers honestly on an
      // unopened box: /shop sits above the 503 store guard precisely because
      // seamButcherDb() null-returns by design before the Opening (O-1's existence gate),
      // so `unopened` arrives as a 200 and never as a provisioning error.
      // `shop.mark` is READY-TO-INJECT SVG struck server-side from the chain's recorded
      // signer_pubkey — the pane RENDERS it, it never re-derives it (shop-mark.js is Node
      // CommonJS and a served second copy is standing law 4). It may be null; that is an
      // absent picture, not a closed shop.
      shop: function () { return call("GET", "/shop"); },

      // POST /api/butcher/shop { name, place?:{lat,lon,label} } -> the Opening act.
      //   400 E_MALFORMED  — blank/whitespace name (a blank sign is not a shop; nothing written)
      //   200 already_open:true — the shop was already open; NOTHING was appended, no re-mint
      //   200 { state:"open", shop } — the store was created, the Ring minted, the identity signed
      // NO Idempotency-Key, deliberately: the route is idempotent by CONSTRUCTION (it reads
      // the reserved lane and reports `already_open` before it appends), and sending a key the
      // runtime does not consult would be a claim the server cannot back. Omitting `place`
      // is legal and correct — no default coordinate, ever; an unaffirmed place leaves weather
      // dark, which is honest.
      open: function (payload) { return call("POST", "/shop", { body: payload }); },

      // POST /api/butcher/shop/place { place:{lat,lon,label} } (seq1000/seq156) —
      //   AFFIRM the place of an ALREADY-OPEN, place-less shop, so a shop that opened
      //   with the place declined is no longer weather-dark forever. Appends a SIGNED
      //   SHOP_PLACE_SET on the reserved lane — NOT a re-Opening (opened_at is stable).
      //   409 E_SHOP_UNOPENED — no shop to place (nothing written)
      //   400 E_MALFORMED     — absent / out-of-range coordinate (the no-invent law; nothing written)
      //   200 { state:"open", shop } — the place is affirmed; weather begins from here
      // Carries NO Idempotency-Key for the same reason `open` does not: the runtime folds
      // the last identity event, so a re-affirm of the same coord is a harmless idempotent
      // restatement, not a claim the client has to guard.
      place: function (payload) { return call("POST", "/shop/place", { body: payload }); },

      _uuid: uuid,
      _base: base
    };
  }

  /* ---- export --------------------------------------------------------------- */
  root.butcherRest = {
    makeClient: makeClient,
    _version: "1.6"
  };
})();
