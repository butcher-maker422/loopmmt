/* Shea's Forest — the App Shell · shell/mail-screen.js
   THE SCREENER — email-app T5 (the Thing-list line, ; HEAVY RCR +,).
   ⚠ NAME IN PENCIL. "Screener" is HEY's word and it arrives carrying HEY's architecture — a DOOR.

   WHAT IT IS. The first LETTER from a sender he has never written to does not appear in the inbox.
   It waits in one view. He says yes or no — ONCE, ABOUT THE PERSON, FOREVER. Not about the message.

   ⚠ IT IS A CURTAIN, NOT A DOOR — and the difference is the whole honesty of this module.
   HEY screens mail at the door of a server it owns. THIS APP HAS NO DOOR. Gmail already accepted the
   message, already stored it, already pushed it to his phone. What this builds is a curtain hung on
   the inside of a room the stranger is already standing in. That is not worthless — it is his room and
   his curtain — but it is DIFFERENT, and a curtain that calls itself a door is the dangerous form,
   because he stops looking. Do not let a future edit sell this as more than it is. (Wren, RCR R2.)

   ⚠ THE STORE IS THE DECISION. IT IS NOT THE MAIL.
   Read the store shape and notice what is NOT in it: there is no held-mail vault, no quarantine, no
   copy of anything. { senderEmail -> { verdict, decidedAtMs } } and nothing else. GMAIL KEEPS CUSTODY
   OF THE BYTES. "Held" means NOT IN A VIEW — it does not mean "in a box we built." Every gate humans
   have built needs a threshold, a holder and a rite of admission; ours has the threshold and the rite,
   and the HOLDER IS GOOGLE'S. If a future edit starts storing message bodies here, it has not extended
   the Screener — it has built the vault C1 exists to make unnecessary. (Crux/Sol/Chen Wei, RCR R2.)

   ⚠ THE KEY IS THE PARSED EMAIL — NEVER THE RAW `From`.
   mail-from-chips.js:37 keys a sender on String(m.from).trim() — the RAW header, display name and all.
   That is correct FOR A FILTER CHIP (you pick from what is in front of you) and CATASTROPHIC HERE.
   Key on the raw header and a friend who changes their display name ("Jamie" -> "Jamie F.") becomes a
   NEW STRANGER and is silently re-held. That breaks the one word this whole feature rests on: FOREVER.
   We key on the bare address via mail-model's parseAddressList idiom. `Alice <a@x>` and `A. Smith <a@x>`
   ARE ONE PERSON. The test battery asserts exactly that, and it is the test that guards the promise.

   ⚠ SCREEN IS A PRECONDITION, NOT AN OVERLAY.
   snooze / decline / spam / trash are predicates on MESSAGES; they compose because they are all
   endofunctions on one list. This is a predicate on SENDERS, which induces a message predicate only by
   pullback along sender: Message -> Sender. So it does NOT go in the paint() overlay stack — it runs
   AHEAD of it and OUTSIDE it. An unscreened sender's mail was never IN the inbox to be snoozed or
   declined in the first place. The predecessor warned that "a third overlay WILL come — order them by
   which is terminal"; the answer is that this is NOT a third overlay, and the ordering question
   dissolves. (Tamar, RCR R1.)

   ⚠ LETTERS ONLY — the T3 gate, reused verbatim from mail-decline.js.
   A NOTIFICATION IS NOT A STRANGER. It is a machine he subscribed to; nobody is on the other end
   reaching for him. Screening notifications would be a bulk-sender wall, not a screener. `unknown`
   is ALSO not held — the app does not withhold mail on a decision it cannot ground.
   FAIL-CLOSED ON THE GATE: with mail-type absent, NOTHING is a letter, so NOTHING is held and the
   curtain is simply not hung. A missing classifier must never silently start hiding his mail.

   ⚠ FAIL-CLOSED ON THE LOOKUP, AND THIS IS THE OPPOSITE DIRECTION — READ IT TWICE.
   The gate fails toward NOT-SCREENING (above). The VERDICT fails toward HELD. An unknown sender whose
   lookup has not landed is HELD, never provisionally approved: a gate whose network fails must fail
   toward the door being SHUT, not open. Held is recoverable in one click; approved-by-accident is a
   stranger in his inbox and he will never know it happened. (Nyx: hope is not a control.)

   THE BOOTSTRAP — WHY THERE IS NO MIGRATION, AND WHY THE EAGER ONE IS DEAD.
   Day one the store is empty and the mailbox is not. The obvious move — precompute the approved set
   from `in:sent` — IS UNBUILDABLE ON OUR OWN BYTES: gmail.js's search() has NO pagination and refuses
   over its cap (`TOO_MANY: refused, not truncated`, gmail.js:1042). An eager whole-corpus `in:sent` is
   precisely the query that seam is built to reject.
   So the policy is evaluated LAZILY instead: ONE narrow query, ONCE per sender, in a lifetime —
   `in:sent to:<email>`, which returns 0 or 1 and cannot trip the cap. The store memoizes the answer
   forever. No day-one derive, no wall, no new route, no new OAuth scope. It is the same policy — Shea's
   pick A at the Crossroads — MEMOIZED rather than PRECOMPUTED. Sending IS approving, read
   backwards (Graham); we simply ask the question one person at a time, the moment it is first asked of us.

   ⚠ THE ASYNC SEAM — DO NOT MAKE paint() ASYNC.
   Every existing overlay is SYNCHRONOUS (a sync localStorage map read at paint() time). `verdict()` is
   sync and reads ONLY the store. The lookup (`resolve`) is async and runs OFF the paint path; when it
   lands it writes the store and the host requests one repaint. An unresolved sender reads HELD in the
   meantime (fail-closed, above) — never a flicker toward approval. THE STORE IS THE SYNC SURFACE AND
   THE NETWORK LIVES BEHIND IT. Making paint() async is a rewrite of the render loop and it will break
   every overlay in the stack.

   ⚠ GATE THE WAY IN, NEVER THE WAY OUT (the predecessor's law, and it is load-bearing here).
   The OFFER to screen is gated on isLetter(). The REVERSAL — unscreen(email) — is gated on NOTHING but
   membership in the store. Rip mail-type.js out and an already-denied sender must STILL be un-deniable.
   Share those gates and losing the classifier would strand denied senders with no way back — C1 failing
   exactly when the app is most degraded.

   NOTHING HERE TRANSMITS. No notify, no bounce, no auto-reply, no "you have been screened." A screener
   that tells the stranger he was screened is a rude reply, and it would be irreversible — a byte that has
   left the building cannot be taken back. (C3, C4.) The `search` seam is the module's ONLY reach toward
   the network, it is READ-ONLY, and it is INJECTED — this file opens no socket of its own.

   ⚠ SENDER AUTHENTICATION IS A DEPENDENCY ON `loop-email` — AND IT GOES ON THE LABEL HE READS.
   A browser has no DKIM and no SPF. This module CANNOT verify that the address in `From` is who actually
   sent the mail. A spammer opens this gate by TYPING an approved address into a header. That is not a bug
   in this module — it is the ceiling of a client with no server, and it is the exact shape of C2-D: the
   honest move is to NAME it, not to ship a gate that pretends. (Nyx, minority preserved, RCR R3.)

   NO COUNT, NO BADGE, NO NAG (C5, C6). `count` is exported ONLY as the host's present-gate — offer the
   view-word when something is actually held, never an always-empty control. It is not a score and must
   never be rendered as one.

   Plain script (no ES module, no deps) — attaches to window.ForestShell.mailScreen.
   Cold-safe throughout: null / junk in -> honest HELD / [] / 0 out, never throws. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});
  var KEY = "forest.mail.screen.v1";

  var APPROVED = "approved";
  var HELD = "held";
  var DENIED = "denied";

  /* ---------------------------------------------------------------------- *
   * THE KEY. The bare address, lowercased. NOT the raw From header.
   * Mirrors mail-model.js:669 parseAddressList's extraction, kept local so this
   * module has no load-order dependency on the model. `Alice <a@x>` -> "a@x".
   * A bare "a@x" (no angle brackets) -> "a@x". Junk -> "" (senderless -> HELD).
   * ---------------------------------------------------------------------- */
  function senderEmail(m) {
    if (!m || m.from == null) return "";
    var raw = String(m.from).trim();
    if (!raw) return "";
    var lt = raw.lastIndexOf("<");
    var gt = raw.lastIndexOf(">");
    var addr = (lt !== -1 && gt > lt) ? raw.slice(lt + 1, gt) : raw;
    addr = String(addr).trim().toLowerCase();
    // an address is a thing with an @ and something on both sides of it. Anything else is junk.
    if (addr.indexOf("@") < 1 || addr.indexOf("@") === addr.length - 1) return "";
    if (/\s/.test(addr)) return "";
    return addr;
  }

  /* THE T3 GATE — screenable(m) is TRUE only for a `letter`.
     FAIL-CLOSED: mail-type absent -> false for everything -> the curtain is not hung. */
  function screenable(m) {
    if (!m) return false;
    var T = root.mailType;
    if (!T || typeof T.isLetter !== "function") return false;   // no classifier, no screening
    try { return T.isLetter(m) === true; } catch (e) { return false; }
  }

  /* ---------------------------------------------------------------------- *
   * THE STORE — the DECISION, not the mail. { email -> { verdict, decidedAtMs } }
   * ---------------------------------------------------------------------- */
  function localStorageBackend(opts) {
    var storage = (opts && opts.storage) || (typeof localStorage !== "undefined" ? localStorage : null);
    return {
      read: function () {
        try {
          if (!storage) return {};
          var raw = storage.getItem(KEY);
          if (!raw) return {};
          var o = JSON.parse(raw);
          return (o && typeof o === "object" && !Array.isArray(o)) ? o : {};
        } catch (e) { return {}; }   // corrupt store reads as empty. Honest, never a throw at boot.
      },
      write: function (map) {
        try { if (storage) storage.setItem(KEY, JSON.stringify(map || {})); } catch (e) { /* full/blocked -> no-op */ }
      }
    };
  }

  function makeStore(backend) {
    var be = backend || localStorageBackend();

    function map() { return be.read(); }

    function set(email, verdict, now) {
      var k = String(email || "").trim().toLowerCase();
      if (!k) return false;
      if (verdict !== APPROVED && verdict !== DENIED) return false;   // HELD is the ABSENCE of a decision, never a stored one
      var m = be.read();
      m[k] = { verdict: verdict, decidedAtMs: (typeof now === "number" ? now : Date.now()) };
      be.write(m);
      return true;
    }

    function get(email) {
      var k = String(email || "").trim().toLowerCase();
      if (!k) return null;
      var e = be.read()[k];
      if (!e || (e.verdict !== APPROVED && e.verdict !== DENIED)) return null;
      return e;
    }

    return {
      map: map,
      approve: function (email, now) { return set(email, APPROVED, now); },
      deny: function (email, now) { return set(email, DENIED, now); },
      // THE REVERSAL. Gated on NOTHING but membership — never on the classifier. (Gate the way in, not out.)
      unscreen: function (email) {
        var k = String(email || "").trim().toLowerCase();
        if (!k) return false;
        var m = be.read();
        if (!Object.prototype.hasOwnProperty.call(m, k)) return false;
        delete m[k];
        be.write(m);
        return true;
      },
      get: get,
      verdictOf: function (email) { var e = get(email); return e ? e.verdict : HELD; },  // no decision -> HELD. Fail-closed.
      isApproved: function (email) { var e = get(email); return !!e && e.verdict === APPROVED; },
      isDenied: function (email) { var e = get(email); return !!e && e.verdict === DENIED; },
      decidedAt: function (email) { var e = get(email); return e ? e.decidedAtMs : null; },
      clear: function () { be.write({}); return true; }
    };
  }

  var _default = makeStore();

  /* ---------------------------------------------------------------------- *
   * THE SYNC READ — what paint() calls. Reads the STORE ONLY. Never the network.
   * A message from a sender with no decision reads HELD. That is the fail-closed
   * direction and it is deliberate: unresolved is not a reason to let a stranger in.
   * ---------------------------------------------------------------------- */
  function verdict(m, store) {
    var S = store || _default;
    // NOT A LETTER -> never screened. T3 routes a notification (a machine he subscribed to) AND an
    // `unknown` (a message it cannot ground a decision on, e.g. senderless) both to APPROVED. The app
    // does not withhold mail on a judgement it cannot make. The senderless case never reaches the key
    // extraction below because classify() already calls it `unknown` — the guard is defence in depth.
    if (!screenable(m)) return APPROVED;
    var k = senderEmail(m);
    if (!k) return HELD;                       // unreachable via T3, held anyway (fail-closed)
    return S.verdictOf(k);
  }

  function isHeld(m, store) { return verdict(m, store) === HELD; }

  /* ⚠ THREE VERDICTS, TWO OF THEM OUT OF THE INBOX — and conflating them is a REAL BUG the
     battery caught on the first run. `held` (undecided, awaiting his call) and `denied` (he
     said no) are DIFFERENT STATES that a reader must never confuse, but they have the SAME
     consequence for the inbox: NEITHER IS IN IT. An earlier draft filtered the inbox on
     `!isHeld`, which quietly put every DENIED sender's mail straight back in front of him —
     the feature silently doing nothing, with a green store and a full Denied view to prove
     it was "working." inInbox() is the single predicate; read it, do not re-derive it. */
  function inInbox(m, store) { return verdict(m, store) === APPROVED; }

  /* THE LIST READS — the precondition, applied. NOT overlays: these run AHEAD of the stack. */
  function hide(messages, store) {   // the inbox: APPROVED only. Not held, not denied.
    if (!messages || typeof messages.filter !== "function") return [];
    return messages.filter(function (m) { return inInbox(m, store); });
  }
  function only(messages, store) {   // the Screening view: the UNDECIDED letters — the ones awaiting him
    if (!messages || typeof messages.filter !== "function") return [];
    return messages.filter(function (m) { return isHeld(m, store); });
  }
  /* The DENIED view — his record of what he decided. Present-gated, never a count. */
  function denied(messages, store) {
    var S = store || _default;
    if (!messages || typeof messages.filter !== "function") return [];
    return messages.filter(function (m) { var k = senderEmail(m); return !!k && S.isDenied(k); });
  }

  /* count(messages) — THE HOST'S PRESENT-GATE ONLY. Offer the view-word when something is
     actually held; never an always-empty control. NOT A SCORE. Never render it as one. (C5.) */
  function count(messages, store) { return only(messages, store).length; }

  /* pending(messages, store) -> the distinct sender keys with NO decision yet. This is the
     lookup queue the host drains OFF the paint path. Empty on a cold/absent classifier. */
  function pending(messages, store) {
    var S = store || _default;
    if (!messages || typeof messages.forEach !== "function") return [];
    var seen = {}, out = [];
    messages.forEach(function (m) {
      if (!screenable(m)) return;
      var k = senderEmail(m);
      if (!k || seen[k]) return;
      if (S.get(k)) return;                    // already decided — never asked again
      seen[k] = true; out.push(k);
    });
    return out;
  }

  /* ---------------------------------------------------------------------- *
   * THE LAZY BOOTSTRAP — ONE query, ONCE per sender, in a lifetime.
   *
   * `searchFn(q) -> Promise<array>` is INJECTED (the host wires it to
   * GET /projection/mail-search?q=; this module opens no socket).
   *
   * resolve(email, searchFn, store, now):
   *   - already decided       -> returns the stored verdict, RUNS NO QUERY. (Memoized forever.)
   *   - `in:sent to:<email>`  -> any hit  => APPROVED  (he wrote to them; sending IS approving)
   *                           -> no hit   => HELD, and NOTHING IS WRITTEN.
   *   - the search THROWS     -> HELD, and NOTHING IS WRITTEN — so it is retried, never cached
   *                              as a denial. A network blip must not silently condemn a stranger.
   *
   * ⚠ ONLY `approved` IS EVER WRITTEN BY THIS FUNCTION. A miss is not a `deny` — a deny is HIS act,
   * and only his. The lookup can let someone IN automatically; it can never shut someone OUT
   * automatically. That asymmetry is the module's whole relationship to C9: the app never decides
   * against a person. It only ever recognises one he already decided FOR.
   * ---------------------------------------------------------------------- */
  function resolve(email, searchFn, store, now) {
    var S = store || _default;
    var k = String(email || "").trim().toLowerCase();
    if (!k) return Promise.resolve(HELD);
    var e = S.get(k);
    if (e) return Promise.resolve(e.verdict);          // MEMOIZED. No query. Not now, not ever again.
    if (typeof searchFn !== "function") return Promise.resolve(HELD);   // no seam -> HELD (fail-closed)
    var q = "in:sent to:" + k;
    return Promise.resolve()
      .then(function () { return searchFn(q); })
      .then(function (hits) {
        var n = (hits && typeof hits.length === "number") ? hits.length : 0;
        if (n > 0) { S.approve(k, now); return APPROVED; }
        return HELD;                                    // no hit -> HELD, nothing written. Never an auto-deny.
      })
      .catch(function () { return HELD; });             // throw -> HELD, nothing written. Retried, never cached.
  }

  /* resolveAll — drain the pending queue off the paint path. Bounded by `pending`'s
     DISTINCT sender set, so N messages from one stranger cost ONE query, not N. */
  function resolveAll(messages, searchFn, store, now) {
    var keys = pending(messages, store);
    if (!keys.length) return Promise.resolve(0);
    return Promise.all(keys.map(function (k) { return resolve(k, searchFn, store, now); }))
      .then(function (verdicts) {
        var approved = 0;
        verdicts.forEach(function (v) { if (v === APPROVED) approved += 1; });
        return approved;                                // the host repaints iff > 0
      });
  }

  root.mailScreen = {
    APPROVED: APPROVED, HELD: HELD, DENIED: DENIED,
    KEY: KEY,
    localStorageBackend: localStorageBackend,
    makeStore: makeStore,
    defaultStore: function () { return _default; },
    senderEmail: senderEmail,
    screenable: screenable,
    verdict: verdict,
    isHeld: isHeld,
    inInbox: inInbox,
    hide: hide,
    only: only,
    denied: denied,
    count: count,
    pending: pending,
    resolve: resolve,
    resolveAll: resolveAll,
    // the default store's verbs, hoisted for the host
    approve: function (email, now) { return _default.approve(email, now); },
    deny: function (email, now) { return _default.deny(email, now); },
    unscreen: function (email) { return _default.unscreen(email); },
    verdictOf: function (email) { return _default.verdictOf(email); },
    isApproved: function (email) { return _default.isApproved(email); },
    isDenied: function (email) { return _default.isDenied(email); },
    decidedAt: function (email) { return _default.decidedAt(email); },
    map: function () { return _default.map(); },
    clear: function () { return _default.clear(); },
    _version: "1.0"
    /* ⚠ AND NOTHING ELSE. No notify. No send. No bounce. No auto-reply. No held-mail store.
       No auto-deny. If you are adding one of those, you are not extending the Screener —
       you are turning a curtain into a wall, or a client into a party to the conversation. */
  };
})();
