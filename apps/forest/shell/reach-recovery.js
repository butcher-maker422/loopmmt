/* forest/app/public/shell/reach-recovery.js — THE RECOVERY HALF OF THE HONEST SIGNAL.
   ============================================================================
   THE BUG THIS EXISTS TO KILL (→, docket
   `forest-unreachable-pane-never-retries`):

     Mail, Calendar and Contacts each render an `unreachable` read HONESTLY —
     the hollow ring, the plain sentence, never a stale list dressed as current —
     and then they STOP. Forever. There is no retry, no backoff, no re-read.

     Mail is the worst of the three, and it is worst STRUCTURALLY: its entire
     refresh apparatus (the Refresh button, runRefresh(), fullRefresh(), the
     3-minute background poll) lives INSIDE buildMailboxView, and buildMailboxView
     only runs on reach:"ok". So mail's clock only ticks when mail is already
     working. The one pane that PROMISED recovery — "we'll refresh when we're
     back" — was the one pane with no mechanism to keep the promise.

     Calendar and Contacts look better only by accident: their paint() clears
     `body`, and the chrome (month-nav, rail slots, search box) survived the wipe
     and still calls the read. That is DOM scoping, not design. It is invisible
     to the user — nothing on a dead pane tells you that clicking "next month"
     would resurrect it — and it evaporates the first time someone widens a wipe
     to `host` (calendar-renderer.js:1359 already does).

     The trigger is not exotic. EVERY runtime deploy restarts the daemon and opens
     a 502 window. Any tab open across that window could be left permanently dead
     with a reassuring sentence on it.

   THE HONEST-SIGNAL WORK WAS DONE ON THE DIAGNOSIS AND NEVER ON THE RECOVERY.
   This module is the recovery.

   ---------------------------------------------------------------------------
   THE ONE HARD RULE — THE SIGNED-OUT STOP (composes with).

   A daemon restart produces TWO symptoms in one open tab, not one:

     (a) an UNREACHABLE window — the 502 while the process comes back (this file);
     (b) a KEYLESS session — the cookie outlives the in-memory owner key, so the
         app still believes it is signed in while every owner-keyed route 401s
         (, `E_NO_SESSION_KEY`, forest:session-keyless).

   Same event. Two faces. Therefore a retry ladder that does not know about (b)
   would SPIN FOREVER, painting sign-in panes into a tab that cannot recover on
   its own — turning one honest failure into a busy one.

   So: A RETRY THAT RESOLVES `signed-out` STOPS THE LADDER AND HANDS BACK to the
   caller, which paints its own Door. We never retry into a 401. We never own the
   keyless event (owns it); we just refuse to fight it.

   ---------------------------------------------------------------------------
   THE LADDER. 2s · 5s · 10s · 20s · 30s — 67 seconds of unattended coverage,
   then it STOPS and leaves a live "Try again" button. It does not retry
   forever: an app that hammers a dead server is not being honest, it is being
   loud. When the ladder is spent the copy says so plainly ("Still can't reach
   it") — an honest end-state, not a spinner that lies about progress.

   WHAT THE 67 SECONDS ACTUALLY BUYS — and what it CANNOT (, corrected).
   Through this header said the ladder "comfortably spans a daemon
   restart." It does span it, in wall-clock. It cannot RECOVER it, and saying so
   was a fresh unkeepable promise written directly beneath the retirement of an
   old one. The byte chain:

     · mail's pane read is GET /export/soil, which is OWNER-KEYED
       (forest-runtime.js — `ownerKeyFor(req)` -> 401 E_NO_SESSION_KEY).
     · the owner key is `sessionKeys`, an in-memory Map:
       "PROCESS-LIFETIME. Wiped by every restart." (forest-runtime.js).

   So after ANY runtime restart, the FIRST read that reaches a live daemon is a
   401 — never a 200. The very event that opens the 502 window also takes the
   key. classify() calls that `signed-out`, the SIGNED-OUT STOP below fires, and
   we hand to the Door. THE MAILBOX DOES NOT COME BACK ON ITS OWN AFTER A
   RESTART, AND IT NEVER CAN — not without the browser holding a passphrase,
   which is the sovereignty model, not a bug.

   The ladder's unattended coverage is real for every 502 the daemon PROCESS
   SURVIVES — an nginx reload, a proxy blip, a network drop. Those never touch
   `sessionKeys`, so the retry lands 200 and the mailbox does return by itself.
   That is the ladder's true domain, and it is worth having.

   On a daemon restart the ladder still earns its keep, differently and no less:
   it converts a TERMINAL dead pane into a DOOR. Before this module a restart
   left a corpse the user had to hard-reload. Now it retries, learns it has been
   signed out, and opens the thing that can actually fix it. Claim THAT.

   Plain script (no ES module) — attaches to window.ForestShell.reachRecovery.
   Cold-safe by construction: no setTimeout -> no ladder, button only; no `read`
   -> no controls at all (the caller's honest pane still renders); a throw in any
   caller-supplied hook is contained, never an exception into the boot. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  /* The ladder. Exported so a test can read the real thing rather than restate it. */
  var LADDER_MS = [2000, 5000, 10000, 20000, 30000];

  function el(doc, tag, cls, opts) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (opts && opts.text != null) n.textContent = opts.text;
    if (opts && opts.type) n.setAttribute("type", opts.type);
    return n;
  }

  function clearNode(n) {
    if (!n) return;
    if (typeof n.removeChild === "function" && n.firstChild) {
      while (n.firstChild) n.removeChild(n.firstChild);
      return;
    }
    n.textContent = "";   // faithful shims destroy the subtree on a textContent SET
  }

  function seconds(ms) { return Math.round(ms / 1000); }

  /* attach(host, opts) — render the caller's honest fail pane INTO host, hang a
     recovery bar under it, and run the ladder.

     opts:
       read()        -> Promise<result>            REQUIRED. The same read that failed.
       classify(res) -> "ok"|"signed-out"|"unreachable"   REQUIRED. The caller owns its
                        own envelope shape (mail reads .reach; calendar/contacts read
                        .ok/.status), so the classifier is theirs, not ours.
       failNode(res) -> Node                       REQUIRED. The caller's own honest pane.
       onResolve(res)-> void                       REQUIRED. Called ONCE when a retry lands
                        ok OR signed-out. The caller clears host and paints. We never
                        paint success or a Door — we do not know what those look like.
       doc           -> defaults to host.ownerDocument
       ladderMs      -> defaults to LADDER_MS
       _setTimeout / _clearTimeout -> injected clocks (tests)

     Returns a handle { stop(), retryNow(), attempts } — or null if it could not
     even build a node (no doc), in which case the caller must paint its own pane. */
  function attach(host, opts) {
    opts = opts || {};
    var doc = opts.doc || (host && host.ownerDocument);
    if (!host || !doc || typeof doc.createElement !== "function") return null;

    var read = opts.read;
    var classify = opts.classify;
    var failNode = opts.failNode;
    var onResolve = opts.onResolve;
    var ladder = opts.ladderMs || LADDER_MS;

    /* hasOwnProperty, not `||` — an EXPLICIT null must be able to say "there is no clock
       here" (that is the whole cold-safe case, and a `||` would silently fall back to the
       real global one, quietly re-arming a ladder the caller just disabled). */
    var hasOwn = function (k) { return Object.prototype.hasOwnProperty.call(opts, k); };
    var setT = hasOwn("_setTimeout") ? opts._setTimeout : (typeof setTimeout === "function" ? setTimeout : null);
    var clrT = hasOwn("_clearTimeout") ? opts._clearTimeout : (typeof clearTimeout === "function" ? clearTimeout : null);

    /* A prior handle on this host is a stale ladder aimed at a pane that is about
       to be overwritten. Stop it before we start, or two ladders race one node. */
    if (host.__reachRecovery && typeof host.__reachRecovery.stop === "function") {
      try { host.__reachRecovery.stop(); } catch (e) { /* a dead handle is not a boot failure */ }
    }

    var stopped = false;
    var attempt = 0;      // how many ladder rungs have been SPENT
    var timer = null;
    var busy = false;
    var noteEl = null;
    var btnEl = null;

    function stop() {
      stopped = true;
      if (timer != null && clrT) { try { clrT(timer); } catch (e) {} }
      timer = null;
      if (host.__reachRecovery === handle) host.__reachRecovery = null;
    }

    /* The pane was swapped out from under us (pane.render replaced the app). Do not
       paint into a detached node and do not keep a timer alive against it. `isConnected`
       is absent on the test shim, so this guard is opt-in by construction — it only
       fires when the DOM actually tells us the node is gone. */
    function detached() {
      return (typeof host.isConnected === "boolean") && host.isConnected === false;
    }

    function setNote(t) { if (noteEl) noteEl.textContent = t || ""; }

    function bar() {
      var wrap = el(doc, "div", "reach-recovery");
      btnEl = el(doc, "button", "reach-recovery__retry", { type: "button", text: "Try again" });
      if (typeof btnEl.addEventListener === "function") {
        btnEl.addEventListener("click", function () { retryNow(); });
      }
      wrap.appendChild(btnEl);
      noteEl = el(doc, "p", "reach-recovery__note line", { text: "" });
      wrap.appendChild(noteEl);
      return wrap;
    }

    /* Paint the caller's honest pane + our bar, then arm the next rung. `res` is the
       outcome that FAILED — handed back to failNode so the caller can vary its own
       copy (a 503 seam and a network drop are different sentences in calendar). */
    function render(res) {
      if (stopped || detached()) return;
      clearNode(host);
      var pane = null;
      try { pane = failNode(res); } catch (e) { pane = null; }
      if (pane) host.appendChild(pane);

      /* No read seam -> no recovery bar. The honest pane still stands; we simply do
         not print a button that cannot do anything. Flag-don't-fake. */
      if (typeof read !== "function" || typeof classify !== "function" || typeof onResolve !== "function") return;

      host.appendChild(bar());

      if (!setT) { setNote("Try again when you\u2019re ready."); return; }   // cold-safe: no clock -> button only

      if (attempt >= ladder.length) {
        setNote("Still can\u2019t reach it.");   // the ladder is spent. Say so; do not spin.
        return;
      }
      var wait = ladder[attempt];
      setNote("Trying again in " + seconds(wait) + "s\u2026");
      timer = setT(function () { timer = null; attempt += 1; fire(); }, wait);
    }

    /* One read. Three outcomes, and only one of them keeps the ladder alive. */
    function fire() {
      if (stopped || detached() || busy) return;
      busy = true;
      setNote("Trying again\u2026");
      if (btnEl && typeof btnEl.setAttribute === "function") btnEl.setAttribute("aria-busy", "true");

      var p;
      try { p = read(); } catch (e) { p = null; }
      if (!p || typeof p.then !== "function") { busy = false; render(null); return; }

      p.then(function (res) {
        busy = false;
        if (stopped || detached()) return;
        var kind;
        try { kind = classify(res); } catch (e) { kind = "unreachable"; }   // Real-or-Made: ambiguity is never `ok`

        /* THE SIGNED-OUT STOP. A 401 is not a transient window — it is a Door, and
           the tab will not open it by being asked 400 more times. Stop, hand back,
           let the caller paint its sign-in pane. (This is the composition seam with
           's E_NO_SESSION_KEY / forest:session-keyless work: that line owns
           TELLING the Door; this line owns NOT FIGHTING it.) */
        if (kind === "ok" || kind === "signed-out") {
          stop();
          try { onResolve(res); } catch (e) { /* the caller's paint is the caller's problem */ }
          return;
        }
        render(res);   // still unreachable -> repaint honestly, arm the next rung
      }, function () {
        busy = false;
        if (stopped || detached()) return;
        render(null);   // a rejected read is a failed read, not a crash
      });
    }

    /* The USER's retry. One attempt, now. It does NOT rewind the ladder: a person
       clicking a button is not a reason to start hammering a server that is down,
       and an honest "still can't reach it" is a better answer than a fresh spinner. */
    function retryNow() {
      if (stopped || busy) return;
      if (timer != null && clrT) { try { clrT(timer); } catch (e) {} }
      timer = null;
      attempt = ladder.length;   // manual retry lands in the spent state either way
      fire();
    }

    var handle = { stop: stop, retryNow: retryNow, attempts: function () { return attempt; } };
    host.__reachRecovery = handle;
    render(opts.outcome !== undefined ? opts.outcome : null);
    return handle;
  }

  root.reachRecovery = {
    LADDER_MS: LADDER_MS,
    attach: attach,
    _version: "1.0"
  };
})();
