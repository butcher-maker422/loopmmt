/* Shea's Forest — the App Shell · shell/search-stores.js
   THE SEARCH ARC, LEG 2 · the STORE ADAPTERS. The joint between the transports
   (contacts-rest / calendar-rest / the mail-search route) and the FEDERATION MODEL
   (search-federation.js). Pure: no DOM, no state, `fetch` and the two REST clients
   are all INJECTED, so every adapter below is drivable from a test with no mirror.

   ─────────────────────────────────────────────────────────────────────────────
   WHY THIS FILE EXISTS AT ALL — READ THIS BEFORE YOU "SIMPLIFY" IT AWAY
   ─────────────────────────────────────────────────────────────────────────────
   Leg 1 built the federation model and its normalisers, and shipped 33/33 green.
   Every one of those checks fed the model a fixture the model's author INVENTED.
   So the suite proved the normalisers parse the shapes leg 1 GUESSED — and said
   nothing whatever about the shapes the stores actually emit. When leg 2 read the
   bytes, all three were wrong:

     contacts   contactsRest.search(q) resolves the TRANSPORT envelope
                  { ok, status, code, data }            <- the tool payload is in .data
                and the tool payload is  { results: [ … ] }.
                The model reads `v.results` at the TOP level. It would have found
                nothing and declared "a shape we do not know" on every real hit.

     calendar   identical transport wrapper; tool payload { events, total };
                and the event's date column is `start_at` — not start_date, not
                start, not starts_at, the three names leg 1 tried.

     mail       GET /projection/mail-search?q= returns { _meta, items: [ … ] },
                and an item is { itemId, content, name } — a RAW SOIL RECORD, not
                { id, subject, from }. Wrong envelope key AND wrong every field.

   A green suite over invented fixtures is a MIRROR, NOT A MEASUREMENT. This file is
   the correction: it is the ONE place a store's real transport shape is known, it is
   the place a future store's shape gets read into, and — the point — its fixtures are
   RECORDED FROM THE TOOLS, not composed to fit the code. If you change an adapter,
   change it because you read the tool, and paste the envelope you read into the test.

   ─────────────────────────────────────────────────────────────────────────────
   THE TWO HONESTY RULES THESE ADAPTERS CARRY (inherited from the model's R3)
   ─────────────────────────────────────────────────────────────────────────────
   1. A REACH THAT FAILED THROWS. It never resolves an empty list. `{ ok:false }`
      from the transport (a 401, a 500, an unreachable box) is a REJECTION here, so
      the federation paints `error` and says so. If we resolved `{results:[]}` on a
      401 the user would read "no contacts match" — a confident lie. `0 results`
      must only ever mean WE LOOKED AND THERE WERE NONE.
   2. WE DO NOT RE-PARSE MAIL. `EmailApp.mailModel.mailboxFromExport` already turns
      { items:[{itemId,content,name}] } into { id, subject, from, … } — it is built,
      it is tested, and it is the SAME parser the mailbox itself reads through. A
      second copy of that logic here would drift from it the day someone touched one.
      So the adapter hands the raw items to the real parser and returns its output.
      (Third copy of a parser = third set of bugs. The one seam, reused.)

   make(clients) -> { contacts?, calendar?, mail? }   <- the federation's `deps`
   A store whose client/fetch is absent is simply OMITTED from the returned deps, and
   the model then omits its group entirely. Cold-safe by construction: the shell shows
   search over the stores it actually has, and never fabricates an empty one.

   Plain script (no ES module) — attaches to window.ForestShell.searchStores. */
(function () {
  "use strict";

  var root = (typeof window !== "undefined")
    ? (window.ForestShell = window.ForestShell || {})
    : (module.exports = {});

  /* unwrap(r) — the REST transport envelope { ok, status, code, data } -> the tool payload.
     A !ok reach THROWS (rule 1): the federation's settle() catches it and paints `error`. */
  function unwrap(r, storeName) {
    if (!r || !r.ok) {
      var why = (r && (r.code || r.status)) || "unreachable";
      throw new Error(storeName + " search did not answer (" + why + ")");
    }
    return r.data;                 // { results: [...] } | { events: [...], total }
  }

  function makeContacts(client) {
    if (!client || typeof client.search !== "function") return null;
    return function (q) {
      return Promise.resolve(client.search(q)).then(function (r) { return unwrap(r, "contacts"); });
    };
  }

  function makeCalendar(client) {
    if (!client || typeof client.search !== "function") return null;
    return function (q) {
      return Promise.resolve(client.search(q)).then(function (r) { return unwrap(r, "calendar"); });
    };
  }

  /* mail — GET /projection/mail-search?q=  -> { _meta, items:[{itemId,content,name}] }
     The items are RAW SOIL RECORDS. `mailboxFromExport` is the real, tested parser that
     turns them into { id, subject, from } — the exact shape the model's mailItems reads.
     No fetch, or no mail model, -> no mail store (the group is omitted, not faked). */
  /* T1.8 — THE ABORT. F10: shell-boot's generation counter drops the stale
     PAINT (`if (gen !== searchGen) return;`) — it never dropped the stale REQUEST. So a
     superseded Gmail round-trip still completed, still cost quota, and still SHIPPED THE
     QUERY. Correct for the UI; incomplete for the wire, and the wire is the one that
     leaves the box.

     Each mail adapter holds ONE in-flight controller. A new search aborts the old one
     before it opens the new. The aborted fetch rejects; the federation's settle() lands
     it as {ok:false} on a model the generation counter is already discarding — so an
     abort never paints an error. It just stops talking to Google.

     Guarded: an environment with no AbortController (an old shim) degrades to today's
     behaviour rather than throwing. Cold-safe, never a hard fail. */
  function makeMail(cfg) {
    cfg = cfg || {};
    var fetchFn = cfg.fetch || (typeof fetch === "function" ? fetch : null);
    var mm = cfg.mailModel ||
      ((typeof window !== "undefined" && window.EmailApp && window.EmailApp.mailModel) || null);
    if (!fetchFn || !mm || typeof mm.mailboxFromExport !== "function") return null;
    var RT = cfg.runtimeBase || (typeof window !== "undefined" && window.FOREST_RUNTIME) || "";
    var AC = cfg.AbortController ||
      ((typeof AbortController === "function") ? AbortController : null);
    var inflight = null;

    return function (q) {
      if (inflight) { try { inflight.abort(); } catch (_) { /* already settled */ } inflight = null; }
      var opts = { cache: "no-store", credentials: "include" };
      if (AC) { inflight = new AC(); opts.signal = inflight.signal; }
      return Promise.resolve(fetchFn(RT + "/projection/mail-search?q=" + encodeURIComponent(q), opts)).then(function (r) {
        if (!r) throw new Error("mail search did not answer");
        return Promise.resolve(r.json()).then(function (j) {
          // an HTTP failure carries the server's real reason — surfaced, never swallowed
          if (!r.ok) throw new Error((j && j.error) || ("mail search failed (HTTP " + r.status + ")"));
          if (!j || !Array.isArray(j.items)) throw new Error("mail search answered without items");
          return { messages: mm.mailboxFromExport({ items: j.items }) };
        });
      }).then(function (v) { inflight = null; return v; },
              function (e) { inflight = null; throw e; });
    };
  }

  /* soil (T2,) — GET /projection/soil-search?q= -> { items:[{itemId,name,snippet,category}], unindexed }
     THE FOURTH STORE, AND THE FIRST LOCAL ONE. Everything above this line reaches OFF the box:
     contacts and calendar hit the Trunk tools, mail hits live Google. Soil hits an in-memory FTS5
     index inside the runtime the browser is already talking to. No packet leaves the machine.

     THAT IS WHY IT MUST FIRE BELOW MIN_REMOTE_Q. The remote floor (T1.8) exists to stop a
     one-character query being shipped to Google's servers. It gates THE NETWORK, not THE BOX.
     Putting the operator's own sovereign local search behind a rule written to protect him FROM
     Google would be the funniest possible way to lose this campaign, and it is a single line away
     at all times. The federation's `local: true` flag on the spine entry is what keeps it honest.

     Same unwrap() discipline as the others in spirit — a !ok reach THROWS (R3), so the federation
     paints `error` and says which. It NEVER resolves an empty list on a 401, because `0 results`
     must only ever mean WE LOOKED AND THERE WERE NONE. A 401 here means the owner session lapsed,
     which is a completely different sentence than "you have nothing filed about Jamie."

     `unindexed` is threaded through to the model UNTOUCHED. It is how many of the operator's items
     have no text to search (a PDF, a scan). The panel prints it. A search surface that silently
     drops a third of the corpus is a right number wearing a wrong noun. */
  function makeSoil(cfg) {
    cfg = cfg || {};
    var fetchFn = cfg.fetch || (typeof fetch === "function" ? fetch : null);
    if (!fetchFn) return null;
    var RT = cfg.runtimeBase || (typeof window !== "undefined" && window.FOREST_RUNTIME) || "";
    var AC = cfg.AbortController ||
      ((typeof AbortController === "function") ? AbortController : null);
    var inflight = null;

    return function (q) {
      if (inflight) { try { inflight.abort(); } catch (_) { /* already settled */ } inflight = null; }
      var opts = { cache: "no-store", credentials: "include" };
      if (AC) { inflight = new AC(); opts.signal = inflight.signal; }
      return Promise.resolve(fetchFn(RT + "/projection/soil-search?q=" + encodeURIComponent(q), opts)).then(function (r) {
        if (!r) throw new Error("soil search did not answer");
        return Promise.resolve(r.json()).then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || ("soil search failed (HTTP " + r.status + ")"));
          if (!j || !Array.isArray(j.items)) throw new Error("soil search answered without items");
          return { items: j.items, unindexed: j.unindexed };
        });
      }).then(function (v) { inflight = null; return v; },
              function (e) { inflight = null; throw e; });
    };
  }

  /* make(clients) -> deps for searchFederation.search(q, deps, onUpdate).
       clients = { contacts?, calendar?, fetch?, mailModel?, runtimeBase? }
     Only the stores that can actually be reached appear in the result. */
  function make(clients) {
    var c = clients || {};
    var deps = {};
    var contacts = makeContacts(c.contacts);
    var calendar = makeCalendar(c.calendar);
    var mail     = makeMail(c);
    var soil     = makeSoil(c);
    if (soil)     deps.soil     = soil;
    if (contacts) deps.contacts = contacts;
    if (calendar) deps.calendar = calendar;
    if (mail)     deps.mail     = mail;
    return deps;
  }

  root.searchStores = {
    make: make,
    makeSoil: makeSoil,           // T2: the first LOCAL store
    makeContacts: makeContacts,   // exported so each adapter is drivable ALONE against a recorded envelope
    makeCalendar: makeCalendar,
    makeMail: makeMail,
    unwrap: unwrap,
    _version: "1.2"
  };
})();
