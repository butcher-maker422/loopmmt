/* Shea's Forest — the App Shell · shell/connector-freshness.js
   LEG 4 — THE SURFACE. The client half of the staleness alarm.

   THE FAULT THIS CLOSES. Legs 2+3 (, 51c77c0d3) taught the runtime to tell
   five states apart — never | fresh | stale | silent | failing — and to serve them,
   typed, each carrying the ACTION it implies, at GET /connectors/freshness.

     AND NOTHING PAINTED IT.

   So the app went on showing 248 contacts frozen for thirteen days in exactly the
   confident silence the whole campaign exists to end. The fact existed; no surface
   exported it. That is the campaign's own defect, one layer up — and it is why this
   module is not garnish.

   THE THREE LAWS. Each one is a bug that would otherwise ship.

   L1 — THE HONESTY GATE. YOU CANNOT GET "up to date" OUT OF NOTHING.
        An absent, failed, malformed, or un-run freshness read coerces to `unknown`
        — NEVER to `fresh`, and its count is `null`, NEVER `0`.
        `0` means ALL CLEAR. A read that did not happen is not all clear. An alarm
        that reads zero when it cannot see is the same lie as an app that reads
        "synced" when it has not looked — the failure mode, one layer up, wearing
        the alarm's own uniform. (Sibling of honest-badge.js's coerce(): you cannot
        coerce your way to `known`.) A naive `count = payload.needs_attention || 0`
        fails this, and the test kills it.

   L2 — THE WORDS ARE THE SERVER'S. NOT A SECOND COPY.
        Every verdict SHIPS its own `action` string (sync-freshness.js's ACTION
        table). This module renders `verdict.action` VERBATIM and does not carry a
        client-side copy of those five sentences. A second table would be a MIRROR,
        and mirror-drift is a named, twice-fired fault class on this very campaign
        (FOREST_APP_VERSIONS; then contacts.primary_email vs contact_emails — "two
        stores for one fact, and the read picks the one nobody writes").
        The ONE sentence this module owns is `unknown`'s — and it owns that one for
        the only honest reason available: THE SERVER CAN NEVER SEND IT. A verdict
        that did not arrive has no `action` to render.
        The client owns PRESENTATION (tone, form, order, urgency). The server owns
        MEANING (state, action). The seam is exactly there.

   L3 — LOUDNESS IS EARNED, AND `stale` != `failing`.
        The two states demand OPPOSITE responses and were indistinguishable for five
        sessions:
          stale   -> "go click Sync."
          failing -> "clicking Sync will NOT help you. Re-link it."
        So `failing` is `urgent` and every other state is not. An all-`fresh` read
        renders NOTHING — silence is the correct output when there is genuinely
        nothing to say, and an alarm that cries on a healthy system gets ignored on
        a sick one. But `unknown` is NOT quiet: it says it could not look.

   Plain script (no ES module) — attaches to window.ForestShell.connectorFreshness.
   DOM-free and pure (the render lives in the caller). Cold-safe: every entry point
   takes garbage and returns a safe value, never an exception into the boot. */
(function () {
  "use strict";

  var root = (typeof window !== "undefined" ? window : globalThis);
  root.ForestShell = root.ForestShell || {};

  /* The vocabulary. The first five are the SERVER's (sync-freshness.js STATE); the
     sixth is the client's alone and cannot arrive over the wire — it is what a read
     that did not happen looks like. */
  var STATE = {
    UNLINKED: "unlinked", // server : the source has NO GRANT. Not stale — NOT THERE.
    NEVER:   "never",
    FRESH:   "fresh",
    STALE:   "stale",
    SILENT:  "silent",
    FAILING: "failing",
    UNKNOWN: "unknown"     // client-only: no verdict reached us. See L1.
  };

  var LEGAL = {};
  Object.keys(STATE).forEach(function (k) { LEGAL[STATE[k]] = 1; });

  /* The DISPLAY spec per state — tone, form, and the calm word.
     Note what is NOT here: the action sentences. Those are L2's whole point.

       word    — a short chip word. Never a count, never a number.
       tone    — the visual band the CSS binds (`.conn-fresh--<tone>`).
       urgent  — L3: does this demand the LOUD surface? `failing` only.
       attention — is this a source the owner must do something about? Everything
                 but `fresh`. This is the predicate `needs_attention` counts, and
                 it is recomputed here so the client can CHECK the server's count
                 rather than trust it (see summarize()).
       badge   — the honest-badge state this maps onto, so the alarm speaks the
                 shell's existing badge grammar rather than inventing a second one
                 (honest-badge.js: verified states are SOLID chips, `unreachable`
                 is the hollow dashed ring — the form, not the colour, carries the
                 did-we-reach-the-truth bit). `unknown` -> `unreachable`: we could
                 not reach the truth, and the badge says so in its FORM. */
  var SPEC = {
    // The chip WORDS are the client's own short vocabulary — deliberately NOT byte-equal
    // to any of the server's ACTION sentences (`fresh` read "up to date" here until the
    // L2 mirror check in the test caught it colliding with ACTION[FRESH] verbatim; a chip
    // word that happens to equal a server sentence is a mirror waiting to drift apart).
    // `unlinked` is URGENT, and `never` is not, and the gap between them is the whole point.
    // Both say "this source has given you nothing." They demand OPPOSITE clicks:
    //   never    -> the source is CONNECTED. Click Sync. It will work.
    //   unlinked -> the source is NOT CONNECTED. Sync does not exist for it. Click LINK.
    // Thirteen days of frozen contacts were spent clicking the button that could not help, so this
    // one is loud and it names the right button. It is also always CLEARABLE — link it and the row
    // is gone — which is why it can be loud without crying wolf (L3).
    "unlinked": { state: "unlinked", word: "not connected", tone: "unlinked", urgent: true,  attention: true,  badge: "overdue" },
    "never":   { state: "never",   word: "never synced", tone: "never",   urgent: false, attention: true,  badge: "known-due" },
    "fresh":   { state: "fresh",   word: "current",      tone: "fresh",   urgent: false, attention: false, badge: "known" },
    "stale":   { state: "stale",   word: "stale",        tone: "stale",   urgent: false, attention: true,  badge: "known-due" },
    "silent":  { state: "silent",  word: "empty",        tone: "silent",  urgent: false, attention: true,  badge: "known" },
    "failing": { state: "failing", word: "not working",  tone: "failing", urgent: true,  attention: true,  badge: "overdue" },
    "unknown": { state: "unknown", word: "unchecked",    tone: "unknown", urgent: false, attention: true,  badge: "unreachable" }
  };

  /* L1 — THE HONESTY GATE. Anything that is not one of the six legal states becomes
     `unknown`. There is no path from garbage to `fresh`: null, undefined, "", a
     number, an object, a misspelling, a state the server adds tomorrow that this
     client has never heard of — all `unknown`. "I don't recognise this" and "it's
     fine" are different sentences, and only one of them is safe to guess. */
  function coerce(rawState) {
    if (typeof rawState === "string" && Object.prototype.hasOwnProperty.call(LEGAL, rawState)) {
      return rawState;
    }
    return STATE.UNKNOWN;
  }

  /* The display spec for a state (coerced first). Returns a COPY — a caller cannot
     mutate the shared table. Pure, DOM-free. */
  function specFor(rawState) {
    var s = SPEC[coerce(rawState)];
    return { state: s.state, word: s.word, tone: s.tone,
             urgent: s.urgent, attention: s.attention, badge: s.badge };
  }

  /* The ACTION sentence for a verdict — L2 made mechanical.
     A real verdict carries the server's words; render them VERBATIM. Only the
     client-only `unknown` gets a client-owned sentence, because no verdict for it
     can ever exist to carry one. If a real verdict arrives with its `action` field
     missing or empty, we do NOT invent a replacement — we say so, honestly, and the
     absence is visible rather than papered over with a plausible guess. */
  var UNKNOWN_ACTION =
    "couldn\u2019t check this source \u2014 the app could not reach the freshness read, so it does not know how old this data is";
  var ACTIONLESS =
    "the runtime reported a state but no action for it \u2014 this is a defect, not a diagnosis";

  function actionFor(verdict) {
    var v = verdict || {};
    var st = coerce(v.state);
    if (st === STATE.UNKNOWN) return UNKNOWN_ACTION;
    if (typeof v.action === "string" && v.action) return v.action;   // the SERVER's words, verbatim
    return ACTIONLESS;                                               // flag, never fabricate
  }

  /* Worst-first. The owner should meet the source that has STOPPED WORKING before
     the one that is merely a day old, and should never have to scroll past four
     healthy rows to find the dead one. `fresh` sinks. */
  var RANK = { "unlinked": 0, "failing": 1, "unknown": 2, "never": 3, "stale": 4, "silent": 5, "fresh": 6 };
  function rankOf(state) { return RANK[coerce(state)]; }

  function sortSources(sources) {
    var arr = Array.isArray(sources) ? sources.slice() : [];
    return arr.sort(function (a, b) {
      var d = rankOf((a || {}).state) - rankOf((b || {}).state);
      if (d !== 0) return d;
      var an = String((a || {}).provider || "") + "|" + String((a || {}).account || "");
      var bn = String((b || {}).provider || "") + "|" + String((b || {}).account || "");
      return an < bn ? -1 : (an > bn ? 1 : 0);
    });
  }

  /* summarize(payload) — the whole fold, and the home of L1.
   *
   *   payload : the parsed GET /connectors/freshness body, or NULL/garbage when the
   *             read failed, 401'd, timed out, or never ran.
   *
   * Returns:
   *   { read      : "ok" | "unknown"      -- did we actually learn anything?
   *     count     : Number | null         -- sources needing attention. NULL on an
   *                                          unknown read. NEVER 0-on-ignorance (L1).
   *     sources   : [ verdict ]           -- worst-first, each coerced + spec'd
   *     failing   : [ verdict ]           -- the urgent subset (L3)
   *     urgent    : Boolean               -- any source is REFUSING
   *     staleAfterMs : Number | null
   *     counted   : Number | null         -- the count RECOMPUTED from the rows
   *     agrees    : Boolean               -- server's count === our count?
   *   }
   *
   * WHY WE RECOMPUTE THE COUNT. `needs_attention` is one number the server folded;
   * `sources` is the set it folded it from. Rendering the number while ignoring the
   * rows is precisely how "1,511 assertion strings" got published as "1,511 passing
   * tests" (the Cruise,): A WRONG NOUN ON A RIGHT NUMBER IS A LIE THAT
   * ARRIVES HOLDING A RECEIPT. So we fold the rows ourselves and check. On a
   * disagreement we trust OUR fold (it is derived from the very rows we are about
   * to render, so the badge cannot contradict the list beneath it) and set
   * agrees:false so the divergence is visible rather than silently absorbed. */
  function summarize(payload) {
    var p = (payload && typeof payload === "object") ? payload : null;
    var rawSources = (p && Array.isArray(p.sources)) ? p.sources : null;

    if (!p || !rawSources) {
      // L1 — the gate. No read, no rows, no knowledge. Say so; do not guess "fine".
      return { read: "unknown", count: null, counted: null, agrees: true,
               sources: [], failing: [], unlinked: [], urgent: false, staleAfterMs: null };
    }

    var sources = sortSources(rawSources).map(function (v) {
      var s = specFor((v || {}).state);
      return {
        provider: String((v || {}).provider || ""),
        account:  String((v || {}).account  || ""),
        state:    s.state,
        word:     s.word,
        tone:     s.tone,
        badge:    s.badge,
        urgent:   s.urgent,
        attention: s.attention,
        action:   actionFor(v),                       // L2 — the server's words
        lastAttemptAt:  (v || {}).lastAttemptAt  || null,
        lastDeliveryAt: (v || {}).lastDeliveryAt || null,
        lastOutcome:    (v || {}).lastOutcome    || null,
        attempts: Number((v || {}).attempts) || 0
      };
    });

    /* `failing` is filtered by STATE, not by `urgent` — `unlinked` is also urgent, and folding the
       two together would let the banner tell an owner that a source he NEVER CONNECTED "stopped
       answering." Two urgent states, two different sentences, two different buttons. Keeping them
       apart here is the same discipline that split `stale` from `failing` in the first place. */
    var failing  = sources.filter(function (s) { return s.state === STATE.FAILING; });
    var unlinked = sources.filter(function (s) { return s.state === STATE.UNLINKED; });
    var counted = sources.filter(function (s) { return s.attention; }).length;

    var served = (typeof p.needs_attention === "number" && isFinite(p.needs_attention))
      ? p.needs_attention : null;

    return {
      read: "ok",
      count: counted,                                  // OUR fold — never contradicts the list below it
      counted: counted,
      agrees: (served === null) ? false : (served === counted),
      sources: sources,
      failing: failing,
      unlinked: unlinked,
      urgent: (failing.length + unlinked.length) > 0,
      staleAfterMs: (typeof p.stale_after_ms === "number") ? p.stale_after_ms : null
    };
  }

  /* alarmSentence(summary) -> { tone, text } | null
   *
   * The LOUD half — the one line the shell shows OUTSIDE Settings, so the owner does
   * not have to open a gear to learn that his data stopped moving thirteen days ago.
   *
   * L3 — it is EARNED, and it never cries wolf:
   *   · every source fresh          -> NULL. Render nothing. Silence is correct here,
   *                                    and an alarm that fires on a healthy system is
   *                                    an alarm nobody reads on a sick one.
   *   · any source FAILING          -> the urgent line. It names RE-LINK, because Sync
   *                                    will not help and telling him to click it would
   *                                    be the confident-silence bug with extra steps.
   *   · otherwise (stale/never/     -> the calm line. Sync will help; say so quietly.
   *     silent needing attention)
   *   · the read itself unknown     -> the honest line. NOT silence — "I could not
   *                                    look" is a thing the owner must be told, and it
   *                                    is exactly the state (signed-in-but-keyless
   *                                    after a restart) the runtime deliberately kept
   *                                    this route readable in.
   *
   * Names the sources by provider (never a bare count in the sentence) so the line
   * says WHICH source is dead — "Contacts and Calendar" is actionable; "2 sources"
   * sends him hunting. */
  function nameList(sources) {
    var names = [];
    (sources || []).forEach(function (s) {
      var n = String((s || {}).provider || "").trim();
      if (n && names.indexOf(n) === -1) names.push(n);
    });
    if (names.length === 0) return "";
    if (names.length === 1) return names[0];
    if (names.length === 2) return names[0] + " and " + names[1];
    return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  }

  /* keyOf(tone, contributors) — THE MESSAGE'S IDENTITY.
   *
   * The dismissal is PER-MESSAGE (operator's invariant, held across a full redesign
   * of its carrier), so a dismissal needs a stable name for "this message" that a
   * DIFFERENT message cannot collide with.
   *
   * It is built from `provider|account|state` of the rows that PRODUCED the sentence,
   * sorted so row order can never fork the key — DELIBERATELY NOT from the rendered
   * text. Two reasons, and the first is a law:
   *
   *   L2. The action/alarm wording is the SERVER's. A key derived from the rendered
   *       string would be a second client-side copy of those words by the back door
   *       — the exact mirror L2 forbids, arriving through a hash instead of a table.
   *   Drift. A server reword would silently re-arm every dismissal, and a *different*
   *       message that happened to render the same words would inherit a dismissal it
   *       never earned.
   *
   * Because the key names the contributing ROWS, requirement 4 falls out by
   * construction: dismiss `calendar|…|failing` and a later `contacts|…|failing`
   * produces a DIFFERENT key, so the new failure appears. It cannot be masked. And a
   * source that changes state (stale -> failing) is likewise a new message, which is
   * correct — the sentence changed and so did the button it names. */
  function keyOf(tone, contributors) {
    var parts = (contributors || []).map(function (s) {
      var v = s || {};
      return String(v.provider || "") + "|" + String(v.account || "") + "|" + String(v.state || "");
    }).sort();
    return String(tone) + "::" + parts.join(";");
  }

  /* nextLocalMidnight(now) -> ms timestamp of the next LOCAL 00:00.
   *
   * The dismissal's expiry (operator: "dismiss at 8pm Tuesday -> it returns Wednesday,
   * or at the stroke of midnight if he is still sitting in the app"). LOCAL, not UTC —
   * the owner's midnight is the one on his wall.
   *
   * setHours(24,0,0,0) is the whole trick and it is deliberate: it asks the engine for
   * "the start of tomorrow" and therefore stays correct across DST folds, where naive
   * `+ 86400000` arithmetic is off by an hour twice a year. Pure and injectable so the
   * test can drive it at any wall-clock instant without waiting for a real midnight. */
  function nextLocalMidnight(now) {
    var base;
    if (now instanceof Date) base = new Date(now.getTime());
    else if (typeof now === "number" && isFinite(now)) base = new Date(now);
    else base = new Date();
    base.setHours(24, 0, 0, 0);
    return base.getTime();
  }

  function alarmSentence(summary) {
    var s = summary || {};

    if (s.read !== "ok") {
      return { tone: "unknown", urgent: false, key: keyOf("unknown", []),
               text: "Forest couldn\u2019t check how fresh your sources are \u2014 it doesn\u2019t know how old this data is." };
    }

    /* THE URGENT LINE. Two states earn it — `unlinked` and `failing` — and they are NOT the same
       sentence, because they are not the same fact:
         unlinked -> "it is not connected."   (it was never there, or its grant is gone)
         failing  -> "it stopped answering."  (it is connected and refusing)
       Both send the owner to Settings and both mean SYNC WILL NOT HELP, which is why they share a
       banner. But an owner told that Google Contacts "stopped answering" will go hunting for a
       broken thing, and the true answer is that there is no thing — he never linked it. Say which. */
    var gone = (s.unlinked || []);
    var dead = (s.failing  || []);
    if (gone.length || dead.length) {
      var parts = [];
      if (gone.length) {
        parts.push(nameList(gone) + " " + (gone.length === 1 ? "is" : "are") + " not connected");
      }
      if (dead.length) {
        parts.push(nameList(dead) + " " + (dead.length === 1 ? "has" : "have") + " stopped answering");
      }
      var urgentTone = gone.length ? "unlinked" : "failing";
      return { tone: urgentTone, urgent: true,
               // the key names EXACTLY the rows this sentence was folded from
               key: keyOf(urgentTone, gone.concat(dead)),
               text: parts.join("; ") + " \u2014 "
                     + (gone.length ? "link" : "re-link")
                     + " in Settings. Syncing will not fix this." };
    }

    var needy = (s.sources || []).filter(function (v) { return v.attention; });
    if (needy.length === 0) return null;               // all fresh -> say nothing

    return { tone: "stale", urgent: false,
             key: keyOf("stale", needy),
             text: nameList(needy) + " " + (needy.length === 1 ? "hasn\u2019t" : "haven\u2019t")
                   + " been refreshed lately \u2014 sync in Settings." };
  }

  /* fetchFreshness(fetchImpl, base) -> Promise<summary>
     Cold-safe by construction: EVERY failure path (no fetch, non-2xx, unparseable
     body, network refusal, a 401 after a restart) lands on summarize(null), which is
     the honest `unknown` — never a fabricated all-clear. The promise NEVER rejects,
     so a boot that wires this can never be broken by a dead runtime. */
  function fetchFreshness(fetchImpl, base) {
    var f = fetchImpl || (typeof root.fetch === "function" ? root.fetch.bind(root) : null);
    if (!f) return Promise.resolve(summarize(null));
    var url = String(base == null ? "" : base) + "/connectors/freshness";
    return f(url, { cache: "no-store", credentials: "include" })
      .then(function (r) {
        if (!r || !r.ok) return null;                  // 401 / 404 / 502 -> unknown, not "fine"
        return r.json();
      })
      .then(function (body) { return summarize(body); })
      .catch(function () { return summarize(null); }); // the runtime is down -> unknown, not "fine"
  }

  root.ForestShell.connectorFreshness = {
    STATE: STATE,
    coerce: coerce,
    specFor: specFor,
    actionFor: actionFor,
    sortSources: sortSources,
    summarize: summarize,
    alarmSentence: alarmSentence,
    keyOf: keyOf,
    nextLocalMidnight: nextLocalMidnight,
    fetchFreshness: fetchFreshness,
    UNKNOWN_ACTION: UNKNOWN_ACTION,
    _version: "1.2"
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.ForestShell.connectorFreshness;
  }
})();
