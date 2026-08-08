/* Shea's Forest — the App Shell · shell/battleganza-renderer.js
   The Battleganza app pane (kind battleganza:*) — the fifth app pane.

 THE PANE FOLD . This renderer paints the forest-tab FACE of the battleganza
   dual-expression body. It holds NO game rule-logic: boundary/rules/match/view-model/
   mega-render/bus and the whole wire layer come from the served /battleganza/engine/
   tree (the same modules the standalone W5-b proof page loads). This file is a SKIN plus
   ONE seam the standalone page does not have — the Warrant mint.

 THE MINT SEAM (operator decision B, ). The standalone page hit
   `403 read-only by construction: no Warrant grant covers this action (deny-all default)`
   — the Forest C-invariant working as designed. The pane therefore mints its OWN grant at
   match-start rather than borrowing the compose UI's:

     POST /grant { key: "battleganza-<match>", scope:{ billers:["gmail"], cap:0 },
                   secret, ttl_min: 60 }

   Why per-match and short-lived: the Warrant ledger is held IN-PROCESS by the runtime
   (forest-runtime.js names durable persistence as owed), so NO grant survives a box
   restart — a long TTL buys nothing a re-mint does not. Minting per match also keeps the
   game's authority separable from mail's: revoking the game never touches compose
   (test-grant-lifecycle.js W5 — revoke and purge are separable).

   Why billers:["gmail"] and cap:0 — NOT a guess. The runtime maps the action subject to
   the provider for `send` (forest-runtime.js: body.biller = body.biller || body.provider
   || "gmail"), so the courier's provider-only body enumerates against billers[] as
   "gmail"; test-send-route.js issues exactly {billers:["gmail"], cap:0}. `send` is NOT in
   the envelope's gate-predicate (only `pay` is), so a covering grant APPLIES a send with
   no per-send operator HALT.

   Auth: same-origin inside the Forest tab, so every call is CREDENTIALED
   (credentials:"include") and rides the forest_session cookie. The courier's headers()
   omits x-forest-session on a falsy session, so passing no token is the correct
   configuration here — the cookie carries it.

   Cold-safe throughout: a missing engine, a missing pane registry, a refused mint, or a
   thrown mount degrades to an honest note that NAMES THE CAUSE. It never throws, and it
   never reports a refusal as patience (the forest-mail-receive-swallows-non-ok class). */
(function () {
  "use strict";
  var root = (window.ForestShell = window.ForestShell || {});

  var ASSET = "battleganza/engine/";
  /* LOAD_ORDER — test-w5a.js §A, mirrored from the standalone page's chain. Order is
     load-bearing: each module registers onto window.Battleganza for the next. */
  var SCRIPTS = [
    "sudoku/internal",
    ASSET + "boundary.js",
    ASSET + "rules.js",
    ASSET + "match.js",
    ASSET + "view-model.js",
    ASSET + "mega-render.js",
    ASSET + "bus.js",
    ASSET + "wire/handshake.js",
    ASSET + "wire/courier.js",
    ASSET + "wire/link.js",
    ASSET + "wire/net.js",
    ASSET + "wire/fake-rtc.js",
    ASSET + "courier/manual.js",
    ASSET + "courier/forest-mail.js",
    // (owed 219) — the host loop needs the shell: onMatchEnvelope (the
    // ONE match ear the wire subscribes), offer/pump (the link handshake), and
    // fixture/link (adopt + share). shell.js was served + synced but NOT in this
    // list, so B.Shell never appeared on the mega surface — that absence IS what
    // "no host loop" was. It self-registers root.Battleganza.Shell (shell.js:543).
    ASSET + "shell.js"
  ];

  var STYLE_ID = "battleganza-pane-styles";
  var GRANT_PATH = "/grant";
  var TTL_MIN = 60;

  /* ---- tiny DOM helper (the renderers' el() shape, verbatim behavior) -------- */
  function el(doc, tag, cls, attrs) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) {
      if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]);
    }
    return n;
  }

  /* =========================================================================== */
  var PANE_CSS = [
    '[data-kind="battleganza"] .bg-app{display:flex;gap:20px;align-items:flex-start;',
    '  max-width:900px;margin:0 auto;padding:22px;color:var(--ink,#0d1116);',
    '  font-family:-apple-system,system-ui,"Segoe UI",sans-serif}',
    '[data-kind="battleganza"] .bg-rail{flex:0 0 180px;display:flex;flex-direction:column;gap:14px}',
    '[data-kind="battleganza"] .bg-main{flex:1 1 auto;min-width:0}',
    '[data-kind="battleganza"] .bg-empty{color:var(--ink-dim,#63707d);padding:22px;margin:0}',
    '[data-kind="battleganza"] .bg-note{color:var(--ink-dim,#63707d);font-size:12px;line-height:1.4}',
    '[data-kind="battleganza"] .bg-bad{color:var(--bad,#b3261e);font-size:12px;line-height:1.4;',
    '  white-space:pre-wrap;margin:0}',

    /* ---- the solo-visible "created" band  ----------------------
     * Chrome OUTSIDE the blur, so Create reads as a legible result instead of
     * an empty blurred board. Forest tokens only, a cool --accent left rule
 * (informational, NOT gold — gold is needs-a-hand, ). Sits above the
     * blurred .bg-mega it introduces. */
    '[data-kind="battleganza"] .bg-created{background:var(--surface-2,#f4f6f8);',
    '  border:1px solid var(--line,#d7dce1);border-left:3px solid var(--accent,#3B9EFF);',
    '  border-radius:var(--r-m,6px);padding:12px 14px;margin:0 0 14px}',
    '[data-kind="battleganza"] .bg-created__status{margin:0;font-weight:650;',
    '  color:var(--ink,#0d1116);font-size:14px}',
    '[data-kind="battleganza"] .bg-created__summary{margin:4px 0 0;',
    '  color:var(--ink,#0d1116);font-size:13px}',
    '[data-kind="battleganza"] .bg-created__note{margin:6px 0 0;',
    '  color:var(--ink-dim,#63707d);font-size:12px;line-height:1.4}',

    /* ---- the board  --------------------------------------------
     * Authored against Forest tokens, NOT ported from battleganza/index.html.
     * That page is dark-themed (#24282c, --x/--o) and this shell is not; a
     * copied palette would have been a foreign body in the app. The STRUCTURE
     * is the frozen page's (it is the proven face); only the skin is Forest's. */
    '[data-kind="battleganza"] .bg-demo{font-size:11px;letter-spacing:.08em;',
    '  text-transform:uppercase;color:var(--ink-faint,#8a94a0);',
    '  border:1px dashed var(--line,#d7dce1);border-radius:var(--r-s,3px);',
    '  padding:4px 8px;margin:0 0 12px;display:inline-block}',
    '[data-kind="battleganza"] .bg-mega{display:grid;grid-template-columns:repeat(3,1fr);',
    '  gap:10px;max-width:640px}',
    '@media (max-width:560px){[data-kind="battleganza"] .bg-mega{grid-template-columns:repeat(2,1fr)}}',
    '[data-kind="battleganza"] .bg-board{border:1px solid var(--line,#d7dce1);',
    '  border-radius:var(--r-s,3px);padding:8px;background:var(--paper,#fff)}',
    '[data-kind="battleganza"] .bg-board-head{display:flex;justify-content:space-between;',
    '  font-size:10px;text-transform:uppercase;letter-spacing:.07em;',
    '  color:var(--ink-faint,#8a94a0);margin-bottom:6px}',
    '[data-kind="battleganza"] .bg-board--won-X{border-color:var(--accent,#3b6ea5)}',
    '[data-kind="battleganza"] .bg-board--won-O{border-color:var(--bark,#7a5c3e)}',
    '[data-kind="battleganza"] .bg-face{display:grid;grid-template-columns:repeat(3,1fr);gap:2px}',
    '[data-kind="battleganza"] .bg-box{aspect-ratio:1;display:flex;align-items:center;',
    '  justify-content:center;background:var(--floor,#f2f4f6);border-radius:2px;',
    '  font-size:14px;font-weight:700;position:relative;color:var(--ink-faint,#8a94a0)}',
    '[data-kind="battleganza"] .bg-box--X{color:var(--accent,#3b6ea5)}',
    '[data-kind="battleganza"] .bg-box--O{color:var(--bark,#7a5c3e)}',
    '[data-kind="battleganza"] .bg-box--threat{outline:1px dashed var(--gold,#b8860b);outline-offset:-2px}',
    '[data-kind="battleganza"] .bg-box--mine::after{content:"";position:absolute;bottom:2px;',
    '  left:50%;transform:translateX(-50%);width:4px;height:4px;border-radius:50%;',
    '  background:var(--moss,#5a7a52)}',
    '[data-kind="battleganza"] .bg-box--revealed::before{content:"";position:absolute;top:2px;',
    '  right:2px;width:4px;height:4px;border-radius:50%;background:var(--ink-faint,#8a94a0)}',
    '[data-kind="battleganza"] .bg-fill{height:3px;background:var(--floor,#f2f4f6);',
    '  border-radius:2px;margin-top:6px;overflow:hidden}',
    '[data-kind="battleganza"] .bg-fill i{display:block;height:100%;background:var(--moss,#5a7a52)}',
    '[data-kind="battleganza"] .bg-label{font-size:10px;color:var(--ink-faint,#8a94a0);',
    '  margin-top:4px;line-height:1.3}',

    /* Resting blur (block 5, S02). The board at rest is a REAL mapped game held
     * behind a blur ("no live match") — it resolves sharp on Go!. Not decoration:
     * the resting state has to be legibly "not the live game" so the player is
     * never unsure whether a move counts. The demo deal IS that resting game. */
    '[data-kind="battleganza"] .bg-mega--resting{filter:blur(2.5px);opacity:.55;',
    '  transition:filter .25s ease,opacity .25s ease;pointer-events:none}',

    /* ---- the New-game create pop-up (block 6, ) ------------------
     * POSITIONING ONLY — the CARD chrome and every field reuse the shared Block
     * Alphabet (.record / .field / .field__label / .field__control /
     * .record__dismiss / .record__actions / .record__action), zero new grammar.
     * The overlay is calendar-form-overlay / mail-compose-overlay / butcher-
     * form-overlay VERBATIM in shape: a fixed bottom-right band that floats OVER
     * the live (blurred) board — the board stays mounted and visible behind it,
     * non-modal, no backdrop (SL-1: genesis opens a pane, never wipes the host).
     * Scoped here rather than in block.css because this renderer already injects
     * its own [data-kind] style block and the pop-up is shell-only by
     * construction (no menu seam on the standalone page -> no rail -> no New
     * game -> no pop-up), so it never needs to reach the standalone. */
    '[data-kind="battleganza"] .bg-form-overlay{position:fixed;right:var(--s-5,16px);',
    '  bottom:0;z-index:50;width:min(34rem,calc(100vw - 2 * var(--s-5,16px)));',
    '  max-height:92vh;overflow:auto;background:var(--surface,#fff);',
    '  border:1px solid var(--line,#d7dce1);border-bottom:0;',
    '  border-radius:var(--r-m,6px) var(--r-m,6px) 0 0;padding:var(--s-5,16px)}',
    '[data-kind="battleganza"] .bg-form-overlay .record{max-width:none;margin:0}',
    /* the format choices reflow as the scale gate opens/closes them; a segmented
     * row of the shared field controls, nothing bespoke. */
    '[data-kind="battleganza"] .bg-thresholds{display:flex;gap:10px}',
    '[data-kind="battleganza"] .bg-thresholds .field{flex:1 1 0;min-width:0}',
    '[data-kind="battleganza"] .bg-form-note{color:var(--ink-dim,#63707d);font-size:12px;',
    '  line-height:1.4;margin:6px 0 0}'
  ].join("");

  function ensureStyles(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    var s = el(doc, "style", null, { id: STYLE_ID });
    s.textContent = PANE_CSS;
    (doc.head || doc.documentElement).appendChild(s);
  }

  /* ---- script chain (the sudoku-renderer idiom: sequential, cold-safe) ------ */
  function loadScriptsThen(doc, i, done) {
    if (i >= SCRIPTS.length) { done(null); return; }
    var src = SCRIPTS[i];
    if (doc.querySelector('script[data-bg-src="' + src + '"]')) { loadScriptsThen(doc, i + 1, done); return; }
    var s = doc.createElement("script");
    s.src = src;
    s.setAttribute("data-bg-src", src);
    s.onload = function () { loadScriptsThen(doc, i + 1, done); };
    s.onerror = function () { done(new Error("could not load " + src)); };
    (doc.head || doc.documentElement).appendChild(s);
  }

  /* ---- the credentialed fetch every seam rides ------------------------------ */
  function credFetch(url, init) {
    init = init || {};
    init.credentials = "include";
    return window.fetch(url, init);
  }

  /* ---- a secret with real entropy, degrading honestly ----------------------- */
  function mintSecret() {
    try {
      var a = new Uint8Array(16);
      window.crypto.getRandomValues(a);
      return Array.prototype.map.call(a, function (b) {
        return ("0" + b.toString(16)).slice(-2);
      }).join("");
    } catch (e) {
      return "bg-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    }
  }

  /* ---- THE MINT SEAM -------------------------------------------------------
     Issue a send-scoped Warrant grant for ONE match. Resolves { ok, key } or
     { ok:false, status, code, reason } — a refusal is REPORTED, never swallowed
     into a nothing-happened (the receive-swallows-non-ok class, owed this line). */
  function mintGrant(matchId) {
    var key = "battleganza-" + String(matchId || Date.now().toString(36));
    return credFetch(GRANT_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: key,
        scope: { billers: ["gmail"], cap: 0 },
        secret: mintSecret(),
        ttl_min: TTL_MIN
      })
    }).then(function (res) {
      if (!res || !res.ok) {
        var status = res ? res.status : 0;
        return res.json().catch(function () { return {}; }).then(function (j) {
          return {
            ok: false,
            status: status,
            code: (j && (j.error || j.code)) || null,
            reason: status === 401
              ? "the Forest session is not owner-gated here — sign in, then reopen the tab"
              : "the runtime refused to issue the grant"
          };
        });
      }
      return res.json().then(function (j) {
        if (!j || j.decision !== "issued") {
          return { ok: false, status: 200, code: (j && j.decision) || null,
                   reason: "the grant seam answered 200 but did not issue" };
        }
        return { ok: true, key: key, ttl_min: TTL_MIN };
      });
    }).catch(function (e) {
      return { ok: false, status: 0, code: null, reason: "the grant seam was unreachable: " + (e && e.message) };
    });
  }

  /* ---- who this window plays AGAINST: the ?to= handshake --------------------
 * . `window.ForestShell.battleganzaPeer` was READ at mount and SET
   * NOWHERE in the tree -- so the note on the pane's own face ("add ?to= to play
   * a second identity") was an instruction the code did not honour. A comment is
   * not a call; a printed instruction with no parser behind it is a DEAD
   * AFFORDANCE that decays into a confident false statement in production.
   *
   * Two windows, one box: window A opens the pane plain, window B opens it at
   * `...?to=<address>`, and B's courier now has somewhere to send.
   *
   * THE GATE, and why it is not paranoia. `?to=` is attacker-supplied URL text
   * that lands in the `to` of a real outbound send riding a real minted Warrant
   * grant. Anyone who can get Shea to click a link chooses that recipient. So
   * the address is validated for SHAPE before it is trusted, and the three
   * refusals are separated rather than collapsed into one silence:
   *   - `header`  : CR/LF/comma/semicolon/angle -- the header-injection and
   *                 multi-recipient shapes. One send, one recipient, always.
   *   - `shape`   : not a single local@domain with a dotted TLD.
   *   - `length`  : over 254 (RFC 5321 ceiling) -- a bounded field, not a buffer.
   * An override on ForestShell WINS over the URL, so the shell and the tests can
   * inject a peer without a location; the URL is the operator-facing path. */
  var PEER_MAX = 254;
  var PEER_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
  function resolvePeer(doc) {
    var out = { peer: null, source: null, rejected: null, raw: "" };
    var override = window.ForestShell && window.ForestShell.battleganzaPeer;
    if (override) { out.peer = String(override); out.source = "shell"; return out; }

    var search = "";
    try {
      var loc = (doc && doc.defaultView && doc.defaultView.location) ||
                (typeof window !== "undefined" && window.location) || null;
      search = (loc && loc.search) || "";
    } catch (e) { return out; }
    if (!search) return out;

    var raw = null;
    try {
      var parts = String(search).replace(/^\?/, "").split("&");
      for (var i = 0; i < parts.length; i++) {
        var eq = parts[i].indexOf("=");
        if (eq > 0 && parts[i].slice(0, eq) === "to") { raw = decodeURIComponent(parts[i].slice(eq + 1)); break; }
      }
    } catch (e) { return out; }
    if (raw === null || raw === "") return out;

    var cand = raw.trim();
    out.raw = cand;
    if (cand.length > PEER_MAX)            { out.rejected = "length"; return out; }
    if (/[\r\n,;<>]/.test(cand))           { out.rejected = "header"; return out; }
    if (!PEER_SHAPE.test(cand))            { out.rejected = "shape";  return out; }
    out.peer = cand; out.source = "?to=";
    return out;
  }

  /* ---- the courier, built on a live grant ----------------------------------- */
  function makeCourier(grantKey, to) {
    var api = window.Battleganza && window.Battleganza.ForestMailCourier;
    if (!api || typeof api.createForestMailCourier !== "function") return null;
    return api.createForestMailCourier({
      to: to,
      fetch: credFetch,
      session: null,          // same-origin: the forest_session COOKIE carries it;
                              // headers() omits x-forest-session on a falsy token.
      grant: grantKey,
      provider: "gmail"
    });
  }

  /* ==== THE RAIL — the shared menu seam (frame-wiring, S02) ==================
   * Battleganza wears the frame Butcher already wears: paint nav.rail into the
   * shell's ctx.menuBody in the SAME .rail__* Block Alphabet (zero new grammar —
   * the vocabulary carries the aesthetic; a bespoke rail here is the divergence
   * the styling law watches for). The peer strip is NOT here: it is folded to
   * status inside the content pane (mountBoard). D-48 — this rail shows
   * Battleganza's menu ONLY, no other apps.
   *
   * COLD-SAFE, and this is load-bearing rather than defensive (the dual-target
   * property, block 8): no menu host -> ctx.menuBody is null -> paintRail is a
   * no-op and the standalone page paints the board exactly as before. ONE
   * renderer rides both targets precisely because the rail degrades to nothing
   * when there is no seam to paint into. */
  var RAIL_STUBS = {
    "new-game": { label: "New game",
      coming: "choose scale (1 or 2), format, ruleset and difficulty, then send the invite — the create pop-up is the next leg" },
    "archive":  { label: "Played games archive",
      coming: "every finished match, searchable — a completed game is a Loop World object, archived from its first move" },
    "friends":  { label: "Friends who play",
      coming: "the people you can challenge, and who is online now" },
    "settings": { label: "Settings",
      coming: "board theme, notifications, and defaults for this player" },
    "practice": { label: "Practice",
      coming: "play the engine solo to learn the fog and the reveal" },
    "howto":    { label: "How to play",
      coming: "the rules of Sudoku Tic Tac Toe Battleganza, start to finish" },
    "invites":  { label: "Invites",
      coming: "open invitations you have sent and received" },
    "stats":    { label: "Career stats",
      coming: "your record across every match you have played" }
  };

  // Click + Enter/Space — the `.rail__slot` vocabulary (a role=button div is a
  // real control only if it answers the keyboard too). Butcher's activate(), verbatim.
  function activate(node, fn) {
    node.addEventListener("click", fn);
    node.addEventListener("keydown", function (ev) {
      var key = ev && ev.key;
      if (key === "Enter" || key === " " || key === "Spacebar") {
        if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
        fn();
      }
    });
  }

  /* A stub is a NAMED empty pane that says what it will be — never a dead
   * button, never real data behind a TODO. Spells in the parent Block alphabet
   * (.pane / .record / .line) so it costs zero marginal CSS, exactly as
   * butcher-renderer.js:renderStub does. */
  function showStub(paneEl, doc, slug) {
    var s = RAIL_STUBS[slug] ||
            { label: "Coming soon", coming: "this part of Battleganza isn't built yet" };
    paneEl.innerHTML = "";
    var pane = el(doc, "section", "pane pane--live", { "data-kind": "battleganza-stub", "data-stub": slug });
    var card = el(doc, "div", "record record--sign", { "data-region": "stub" });
    card.appendChild(el(doc, "span", "record__title", { text: s.label }));
    card.appendChild(el(doc, "p", "line line--muted", { text: "Coming: " + s.coming + "." }));
    pane.appendChild(card);
    paneEl.appendChild(pane);
  }

  /* ==== THE NEW-GAME CREATE POP-UP (block 6, ) =====================
   *
   * The bottom pane matching New Email / New Contact / New Event — modelled on
   * mail's conforming compose (butcher-renderer.js:306, "mount parent split in
   * two"). SL-1 shape: the pop-up floats OVER the live (blurred) board as an
   * overlay sibling appended straight into paneEl; it NEVER wipes paneEl, so the
   * board stays mounted and visible behind it (the collection beneath the pane).
   *
   * The field set (prep §block 6, grounded in the V6 dial table):
   *   Scale     1 or 2   — D-57 bounds Done Done at Scale 1 & 2; Scale 3 is the
   *                        next round. (Dial 7 `depth`; default 2.)
   *   Format    gated by scale — D-63: Scale 1 is 1v1 ONLY; Scale 2 opens teams
   *                        to three a side (1v1 / 1v2 / 1v3 / 2v3 / 3v3). The
   *                        Format control REFLOWS when Scale changes.
   *   Ruleset   Three in a row / Points — maps to a real winRule key
   *                        (instant-win / bonus-end); createMatchConfig consumes it.
   *   Difficulty three thresholds on 1–100 (easy < medium < hard), per match,
   *                        declared at creation. NEVER labelled on a board (D-25):
   *                        this is a CREATION input (deal composition + stats
   *                        vocabulary), not a per-board badge. */

  // D-63: scale gates format. Scale 1 is 1v1 only; Scale 2 opens teams.
  function formatsFor(scale) {
    return Number(scale) === 1
      ? ["1v1"]
      : ["1v1", "1v2", "1v3", "2v3", "3v3"];
  }

  // Remove the open create pop-up, if any. Never touches paneEl's other
  // children — the board beneath is untouched by construction (SL-1).
  function closeNewGame(paneEl) {
    var live = paneEl && paneEl.querySelector ? paneEl.querySelector(".bg-form-overlay") : null;
    if (live && live.parentNode) live.parentNode.removeChild(live);
  }

  /* "Create Game fills the blurred board in the background" (prep §block 6).
   * Records the descriptor as the pane's resting game, then repaints ONLY the
   * board region (.bg-main), still blurred — nothing goes live until the WebRTC
   * handshake + countdown. Cold-safe: no board mounted yet, or the engine not
   * loaded under this runtime (the node DOM can't run the engine chain), records
   * the descriptor and leaves an honest caption rather than throwing. */
  function fillRestingBoard(paneEl, doc, create) {
    paneEl.__battleganzaCreate = create;
    var main = paneEl.querySelector ? paneEl.querySelector(".bg-main") : null;
    if (!main) return;                    // board not mounted; applies on next mount
    var B = (typeof window !== "undefined") ? window.Battleganza : null;
    var ready = B && B.Match && B.Rules && B.ViewModel &&
                typeof B.ViewModel.viewModel === "function" &&
                B.MegaRender && typeof B.MegaRender.megaPlan === "function";
    // Clear the prior caption + mega, keep the .bg-main host itself (never wipe
    // the parent — same distinction that keeps mount() conforming).
    var old;
    while ((old = main.querySelector(".bg-created") || main.querySelector(".bg-mega") ||
                  main.querySelector(".bg-demo")    || main.querySelector(".bg-note") ||
                  main.querySelector(".bg-bad"))) {
      old.parentNode.removeChild(old);            // re-create is clean; bands never stack
    }
    var band = createdBand(doc, create);   // solo-visible "created" signal, outside the blur
    if (band) main.appendChild(band);
    main.appendChild(el(doc, "p", "bg-demo", { text: restingCaption(create) }));
    if (!ready) {
      main.appendChild(el(doc, "p", "bg-note", {
        text: "Game recorded. The board fills when the engine loads on this runtime."
      }));
      return;
    }
    try {
      paintPlan(doc, main, buildCreatedPlan(B, create), true);   // resting = blurred
    } catch (pe) {
      main.appendChild(el(doc, "p", "bg-bad", {
        text: "The game was created but the board failed to paint: " + String(pe && pe.message)
      }));
    }
  }

  // The create pop-up. Opens from .rail__compose (New game). Shell-only by
  // construction — it is reached only through the menu-seam rail.
  function showNewGame(paneEl, doc) {
    closeNewGame(paneEl);                 // never stack two pop-ups

    var overlay = el(doc, "div", "bg-form-overlay", { role: "dialog", "aria-label": "New game" });
    var card = el(doc, "div", "record", { "data-region": "new-game" });

    card.appendChild(el(doc, "h3", "record__title", { text: "New game" }));
    var dismiss = el(doc, "button", "record__dismiss", {
      type: "button", "aria-label": "Close", text: "\u00d7"
    });
    dismiss.addEventListener("click", function () { closeNewGame(paneEl); });
    card.appendChild(dismiss);

    // ---- the shared field() helper (mail composeView idiom, verbatim shape) --
    function field(labelText, controlEl) {
      var row = el(doc, "div", "field");
      row.appendChild(el(doc, "label", "field__label", { text: labelText }));
      row.appendChild(controlEl);
      card.appendChild(row);
      return row;
    }
    function select(cls, ariaLabel) {
      return el(doc, "select", cls + " field__control", { "aria-label": ariaLabel });
    }
    function option(value, label) {
      return el(doc, "option", null, { value: value, text: label });
    }

    // Scale — 1 or 2 (D-57). Default 2 (dial 7 default; §5's shipping slice).
    var scaleSel = select("bg-scale", "Scale");
    scaleSel.appendChild(option("1", "Scale 1 — one board"));
    scaleSel.appendChild(option("2", "Scale 2 — nine boards"));
    scaleSel.value = "2";
    field("Scale", scaleSel);

    // Format — gated by scale (D-63); reflows on scale change.
    var formatSel = select("bg-format", "Format");
    function repaintFormats() {
      while (formatSel.firstChild) formatSel.removeChild(formatSel.firstChild);
      formatsFor(scaleSel.value).forEach(function (f) {
        formatSel.appendChild(option(f, f));
      });
    }
    repaintFormats();
    scaleSel.addEventListener("change", repaintFormats);
    field("Format", formatSel);

    // Ruleset — Three in a row / Points. Real winRule keys.
    var rulesetSel = select("bg-ruleset", "Ruleset");
    rulesetSel.appendChild(option("instant-win", "Three in a row"));
    rulesetSel.appendChild(option("bonus-end", "Points"));
    rulesetSel.value = "bonus-end";        // the ratified default (D-19)
    field("Ruleset", rulesetSel);

    // Difficulty thresholds — three integers on 1–100, easy < medium < hard.
    // A creation input (deal composition + stats vocabulary), NEVER a per-board
    // label (D-25). Defaults sit ascending inside the scale.
    var thRow = el(doc, "div", "field");
    thRow.appendChild(el(doc, "label", "field__label", { text: "Difficulty thresholds (1\u2013100)" }));
    var thGroup = el(doc, "div", "bg-thresholds");
    function threshold(name, label, val) {
      var box = el(doc, "div", "field");
      box.appendChild(el(doc, "label", "field__label", { text: label }));
      var inp = el(doc, "input", "bg-th-" + name + " field__control", {
        type: "number", min: "1", max: "100", "aria-label": label + " threshold"
      });
      inp.value = String(val);
      box.appendChild(inp);
      thGroup.appendChild(box);
      return inp;
    }
    var easyInp = threshold("easy", "Easy", 25);
    var medInp  = threshold("medium", "Medium", 50);
    var hardInp = threshold("hard", "Hard", 75);
    thRow.appendChild(thGroup);
    card.appendChild(thRow);

    // Honest note — what the deal obeys today, and what is recorded for the owed
    // engine/view work. A badge renders only byte-verified state (prep §law).
    card.appendChild(el(doc, "p", "bg-form-note", {
      text: "Thresholds set how the deal is composed and name your stats \u2014 " +
            "they are never shown on a board. Ruleset drives the match; scale, " +
            "format and the three thresholds are recorded per game (the deal " +
            "composition and team formats land with the shared-deal leg)."
    }));

    var status = el(doc, "div", "record__status", { role: "status", "aria-live": "polite" });

    // ---- actions: Create + Cancel (record__actions, the shared command row) --
    var actions = el(doc, "div", "record__actions");
    var create = el(doc, "button", "record__action", { type: "button", text: "Create game" });
    var cancel = el(doc, "button", "record__action record__action--quiet", { type: "button", text: "Cancel" });
    cancel.addEventListener("click", function () { closeNewGame(paneEl); });

    create.addEventListener("click", function () {
      var e = parseInt(easyInp.value, 10);
      var m = parseInt(medInp.value, 10);
      var h = parseInt(hardInp.value, 10);
      var bad = null;
      if (!(e >= 1 && e <= 100 && m >= 1 && m <= 100 && h >= 1 && h <= 100)) {
        bad = "Each threshold must be a whole number from 1 to 100.";
      } else if (!(e < m && m < h)) {
        bad = "Thresholds must increase: easy < medium < hard.";
      }
      if (bad) { status.textContent = bad; return; }

      var scale = Number(scaleSel.value);
      var rulesetLabel = rulesetSel.value === "instant-win" ? "Three in a row" : "Points";
      var descriptor = {
        scale: scale,
        format: formatSel.value,
        winRule: rulesetSel.value,
        rulesetLabel: rulesetLabel,
        thresholds: { easy: e, medium: m, hard: h },
        dealDifficulty: "medium",         // what the engine deals today (honest)
        summary: "Scale " + scale + " \u00b7 " + formatSel.value + " \u00b7 " + rulesetLabel
      };
      fillRestingBoard(paneEl, doc, descriptor);
      closeNewGame(paneEl);
    });

    actions.appendChild(create);
    actions.appendChild(cancel);
    card.appendChild(actions);
    card.appendChild(status);

    overlay.appendChild(card);
    paneEl.appendChild(overlay);          // sibling of the board — never wipes paneEl
    return overlay;
  }

  /* Paint the shared rail into ctx.menuBody. New game (.rail__compose) + an
   * empty .rail__search host (the archive parents its live field here in a later
   * leg) + the eight .rail__slot menu items. "Active games / resume" re-shows the
   * resting board on the grant the mount already cached; the rest open honest
   * stubs. Returns the nav (or null when there is no seam). */
  function paintRail(ctx, doc, paneEl) {
    var host = (ctx && ctx.menuBody && typeof ctx.menuBody.appendChild === "function")
      ? ctx.menuBody : null;
    if (!host) return null;                       // dual-target cold-safe: no seam, no rail
    while (host.firstChild) host.removeChild(host.firstChild);

    var nav = el(doc, "nav", "rail", { "aria-label": "Battleganza" });

    // THE PRIMARY ACTION — New game. Same class and weight as New Order /
    // Compose / New contact; it inherits every contrast fix that slot has
    // already earned (tokens.css:82, app.css:470). Opens the create pop-up
    // (block 6, ) — the full field set, modelled on mail's conforming
    // compose: an overlay that floats over the live board, not a wipe.
    var compose = el(doc, "div", "rail__compose", {
      role: "button", tabindex: "0", text: "New game",
      "aria-label": "Start a new Battleganza game"
    });
    activate(compose, function () { showNewGame(paneEl, doc); });
    nav.appendChild(compose);

    // THE FIND SLOT — built empty; the Played-games archive parents its own live
    // filter field in here later (opts.searchHost), so search keeps one impl.
    nav.appendChild(el(doc, "div", "rail__search"));

    // THE VIEWS — the eight (menu set ruled ; D-48 Battleganza-only).
    function railSlot(id, label, go) {
      var slot = el(doc, "div", "rail__slot", {
        role: "button", tabindex: "0", "data-slot": id, "aria-label": label
      });
      slot.appendChild(el(doc, "span", "rail__slot-label", { text: label }));
      activate(slot, go);
      return slot;
    }
    function stubSlot(slug) {
      return railSlot("stub:" + slug, RAIL_STUBS[slug].label,
        function () { showStub(paneEl, doc, slug); });
    }

    // "Active games / resume" returns to the resting board on the cached grant.
    // Cold-safe: no engine/grant yet -> honest note, never a throw.
    nav.appendChild(railSlot("resume", "Active games / resume", function () {
      try { mountBoard(paneEl, doc, paneEl.__battleganzaGrant || null); }
      catch (e) { honestNote(paneEl, doc, "The board isn't ready yet.", String(e && e.message)); }
    }));
    nav.appendChild(stubSlot("archive"));
    nav.appendChild(stubSlot("friends"));
    nav.appendChild(stubSlot("settings"));
    nav.appendChild(stubSlot("practice"));
    nav.appendChild(stubSlot("howto"));
    nav.appendChild(stubSlot("invites"));
    nav.appendChild(stubSlot("stats"));

    host.appendChild(nav);
    return nav;
  }

  /* =========================================================================== */
  function honestNote(paneEl, doc, msg, detail) {
    paneEl.innerHTML = "";
    paneEl.appendChild(el(doc, "p", "bg-empty", { text: msg }));
    if (detail) paneEl.appendChild(el(doc, "p", "bg-bad", { text: detail }));
  }

  function render(paneEl, ctx) {
    var doc = paneEl.ownerDocument || document;
    if (paneEl.__battleganzaMounted) return;   // keep-alive pane: mount once
    ensureStyles(doc);
    // Paint the rail FIRST — it needs no engine, so the menu is warm while the
    // board loads (walking-skeleton: thin end-to-end first). Cold-safe: a target
    // with no ctx.menuBody (the standalone page) simply gets no rail.
    paintRail(ctx, doc, paneEl);
    paneEl.innerHTML = "";
    paneEl.appendChild(el(doc, "p", "bg-empty", { text: "Loading Battleganza…" }));

    loadScriptsThen(doc, 0, function (err) {
      if (err || !window.Battleganza) {
        honestNote(paneEl, doc, "Couldn’t load the Battleganza engine on this runtime.",
          err ? String(err.message) : "window.Battleganza never appeared after the chain loaded.");
        return;
      }
      var matchId = (ctx && ctx.ref) || Date.now().toString(36);
      mintGrant(matchId).then(function (g) {
        if (!g.ok) {
          honestNote(paneEl, doc, "Battleganza can read, but cannot send yet.",
            "Warrant mint refused — " + g.reason +
            (g.status ? " (HTTP " + g.status + (g.code ? ", " + g.code : "") + ")" : "") +
            "\nThe board below is playable; the mail handshake is not.");
          mountBoard(paneEl, doc, null);
          return;
        }
        mountBoard(paneEl, doc, g.key);
      });
    });
  }

  /* ---- the drive: engine namespaces, verified against engine bytes ----------
 * . The prior call was `B.megaPlan(B.viewModel)` and it was wrong in
   * three separate ways, each of which alone would have blanked the board:
   *   1. NAMESPACE. megaPlan lives at Battleganza.MegaRender.megaPlan and
   *      viewModel at Battleganza.ViewModel.viewModel (mega-render.js:162,
   *      view-model.js api). Neither is hoisted to the Battleganza root.
   *   2. ARITY. viewModel is a FUNCTION taking (replica, claimLog, config)
   *      (view-model.js:146) -- it was being passed as a value.
   *   3. SHAPE. megaPlan returns a FROZEN PLAIN OBJECT (mega-render.js:154-159),
   *      not a DOM node, so appendChild could never have worked. The host has
   *      to paint it. The sudoku tab inherits painting from the shared
   *      DualExpressionShell; Battleganza has no such shell, so this is ours.
 * (Recorded and not carried forward -- hence the re-dig.)
   *
   * The deal below is CANNED, and the pane says so on its face. Rationale, so
   * the next instance does not "fix" it into a lie: match state is not yet
   * persisted anywhere, so a real deal paints nine blank boards and proves
   * nothing about the painter. Cann the INPUT so the paint exercises real
   * state; never fake the OUTPUT. When persistence lands, swap buildDemoPlan
   * for the live replica -- paintPlan does not change. */
  function buildDemoPlan(B) {
    var deal    = B.Match.dealMatch({ difficulty: "easy" });
    var replica = B.Match.createReplica(deal, { player: "p1", team: "A", mark: "X" });
    var config  = B.Rules.createMatchConfig();

    var canned = [
      { board: 1, box: 1, mark: "X" }, { board: 1, box: 2, mark: "X" }, { board: 1, box: 3, mark: "X" },
      { board: 5, box: 4, mark: "X" }, { board: 5, box: 5, mark: "X" },
      { board: 5, box: 9, mark: "O" },
      { board: 7, box: 2, mark: "O" }
    ];
    var claimLog = canned.map(function (c, i) {
      return B.Boundary.claim({
        player: c.mark === "X" ? "p1" : "p2",
        team:   c.mark === "X" ? "A"  : "B",
        board:  c.board, box: c.box, mark: c.mark,
        values: [1], t: i
      });
    });

    // Replica-private channels: solved-by-me and revealed never reach the claim
    // log. That split is the public/private line the engine defends.
    replica.solvedByMe.add("1:1");
    replica.solvedByMe.add("5:4");
    replica.revealed.add("7:2");

    return B.MegaRender.megaPlan(B.ViewModel.viewModel(replica, claimLog, config));
  }

  /* ---- the created game's resting plan (block 6, ) -----------------
   * "Create Game fills the blurred board in the background" (prep §block 6). The
   * fill is a REAL engine deal, not a canned one: dealMatch at the chosen deal
   * difficulty + createMatchConfig with the chosen winRule, and an EMPTY claim
   * log — a freshly created match has no moves yet, so the truthful resting
   * state is a dealt board with nothing claimed. It stays blurred (resting=true
   * at the call site); it does NOT resolve sharp — nothing goes live until the
   * WebRTC handshake + countdown (the W5 host arc, a later leg).
   *
   * HONEST CEILING — what the engine consumes today vs. what the form collects.
   * The engine (rules.js / match.js) consumes `winRule` (real: instant-win /
   * bonus-end / bonus-continue) and a single named `difficulty` string. It does
   * NOT yet consume `scale` (dealMatch always deals BOARDS=9), team `format`, or
   * the THREE difficulty thresholds (dial 8's deal-composition generator, §3.7,
   * is design-ahead — owed). So this fill is HONEST about the split: winRule and
   * a single deal difficulty drive a real deal (real OUTPUT); the thresholds,
   * scale and format are RECORDED on the descriptor for the owed generator/view
   * work and surfaced in the status band, never painted as if the board obeyed
   * them. Cann the reduced INPUT, never fake the OUTPUT (the buildDemoPlan rule).
   * Owed: battleganza-create-form-ahead-of-engine (scale board-count, team
   * formats, three-threshold deal composition). */
  function buildCreatedPlan(B, create) {
    var c = create || {};
    // The engine deals one named difficulty; the three thresholds are recorded,
    // not yet a deal-composition input. 'medium' is the honest neutral deal.
    var deal    = B.Match.dealMatch({ difficulty: c.dealDifficulty || "medium" });
    var replica = B.Match.createReplica(deal, { player: "p1", team: "A", mark: "X" });
    var config  = B.Rules.createMatchConfig({ winRule: c.winRule || "bonus-end" });
    // A fresh match: no claims. The resting board shows the dealt game, blurred.
    return B.MegaRender.megaPlan(B.ViewModel.viewModel(replica, [], config));
  }

  /* One source for the resting (blurred) board's plan: the created game once a
   * game has been created on this pane, else the canned demo that proves the
   * painter before any Create. mountBoard and the Create handler both read it. */
  function restingPlan(B, paneEl) {
    var create = paneEl && paneEl.__battleganzaCreate;
    return create ? buildCreatedPlan(B, create) : buildDemoPlan(B);
  }

  /* ---- the solo-visible "created" band ( — owed
   * battleganza-create-no-solo-visible-state) --------------------------------
   * The create-flow legibility fix. A solo operator clicks Create and gets a
   * REAL board, dealt and blurred — but blurred-by-design + empty-new-game read
   * as "nothing happened" (the operator-witnessed fault, 02.1352 Cistern §3:
   * Create IS working, the caption changed, but there is no legible "created"
   * signal a solo operator can see). This band is chrome OUTSIDE the blur: a
   * legible "Game created" panel that names the game and its state, so Create
   * stops reading as dead. It does NOT make the board playable solo — a real
   * go-live crossing still resolves it sharp (owed 191 / the W5 host arc). It
   * makes the create HONEST and SEEN, not sharp.
   *
   * HONEST CEILING — it SURFACES scale, it does not make the board OBEY it. The
   * engine deals BOARDS=9 regardless of scale (buildCreatedPlan's honest ceiling;
   * owed battleganza-create-form-ahead-of-engine). So for Scale 1 the band NAMES
   * the request and states plainly that the board is dealt full until the
   * per-scale deal ships — it RECORDS + SURFACES the reduced input, it never
   * PAINTS a nine-board game as one. That is the buildDemoPlan rule turned on the
   * create band: "cann the reduced INPUT, never fake the OUTPUT."
   *
   * D-25/D-54: the band names scale / format / ruleset (create.summary) ONLY —
   * never a difficulty threshold or an easy/medium/hard word. The frame-leak
   * guard (battleganza-board-mount-d25.test.js) drives this band too. */
  function createdBand(doc, create) {
    if (!create) return null;                     // create-only by construction
    var band = el(doc, "div", "bg-created");
    band.appendChild(el(doc, "p", "bg-created__status", { text: "Game created" }));
    band.appendChild(el(doc, "p", "bg-created__summary", { text: create.summary || "" }));
    // Scale 1 asks for one board; the engine deals nine. Say so, honestly,
    // rather than faking a single-board deal (owed
    // battleganza-create-form-ahead-of-engine).
    if (Number(create.scale) === 1) {
      band.appendChild(el(doc, "p", "bg-created__note", {
        text: "Scale 1 (one board) recorded — the board is dealt at full size until the per-scale deal ships."
      }));
    }
    band.appendChild(el(doc, "p", "bg-created__note", {
      text: "Waiting for a peer to go live. The board stays blurred until a real match crosses — offer a link or paste a handshake."
    }));
    return band;
  }

  /* One source for the resting board's caption line — both mountBoard and
   * fillRestingBoard read it, so the string can't drift between the two mounts
 * (it was built twice by hand before, board-mount polish).
   * D-25/D-54, load-bearing: this line names scale / format / ruleset (carried on
   * create.summary) and DELIBERATELY never the difficulty. Difficulty is a
   * creation input, never labelled on a board — no threshold digits, no
   * easy/medium/hard word reaches the paint. The frame-leak guard
   * (battleganza-board-mount-d25.test.js) drives a descriptor whose difficulty is
   * set to distinctive values and asserts none of them surface here. */
  function restingCaption(created) {
    return created
      ? "resting board — " + created.summary + " (held blurred until Go!)"
      : "resting board — no live match (a real mapped game, held blurred until Go!)";
  }

  /* The caption once the board has resolved sharp on Go!. Built from the SAME
   * create.summary as restingCaption (scale / format / ruleset only), so the
   * D-25/D-54 no-difficulty guard extends to it by construction — no threshold
   * digit, no easy/medium/hard word can reach this line either. Kept as the
   * existing small advisory .bg-demo caption, not new focal chrome (D-38/D-47). */
  function liveCaption(created) {
    return created
      ? "live — " + created.summary
      : "live — the match is on";
  }

  /* ---- the sharp-on-Go! resolve  ---------------------------------
   * The board at rest carries .bg-mega--resting (a REAL mapped game held behind
   * a blur, "not the live game"). On Go! (D-34 — the shared epoch every claim
   * stamps ms-against, performance.now(), drift-free over a match) the board
   * resolves SHARP: this drops the --resting modifier and the ALREADY-BUILT CSS
   * transition on that rule (.25s filter+opacity ease; pointer-events restored
   * by the class going away) carries the fade. That transition IS the C-3
   * ceremony (v6 §484 / D-47 / D-38): NO modal, NO ticking countdown at the
   * focal point, NO sound — this touches ONLY the class, the caption, and the
   * epoch; it builds no focal node and plays no audio. The player's board simply
   * clears; nothing takes their eyes off the other boards.
   *
   * This is the RENDERER's half of the subscription. The go-live path calls it
   * when Go! fires. It is deliberately NOT auto-fired at mount: a board that went
   * sharp with no live match is the exact "never unsure whether a move counts"
   * failure the resting blur exists to prevent (block 5 note above). The trigger
   * that INVOKES this — the engine-shell/transport go-live signal under a real
   * two-browser run — is the W5 fidelity gap the code already NAMES open
   * (wire/link.js:43, engine/shell.js:183); wiring that invocation is the owed
   * follow-on. This seam is what it subscribes.
   *
   * The Go! epoch (t0) is captured here on performance.now() so claim stamps can
   * be taken as ms-since-Go! (D-34); it is injectable ({epoch}) so a headless
   * test (no performance) drives a known t0. Idempotent: a second call on a live
   * pane is a no-op that keeps the FIRST epoch — Go! happens once. Cold-safe: no
   * pane, no mounted board, or no resting node -> a truthful {resolved:false}. */
  function resolveToLive(paneEl, opts) {
    var out = { resolved: false, epoch: null, reason: null };
    if (!paneEl) { out.reason = "no pane"; return out; }
    if (paneEl.__battleganzaLive) {      // Go! happens once; keep the first epoch.
      out.epoch = (typeof paneEl.__battleganzaGoEpoch === "number")
        ? paneEl.__battleganzaGoEpoch : null;
      out.reason = "already live";
      return out;
    }
    var resting = paneEl.querySelector
      ? paneEl.querySelector(".bg-mega--resting") : null;
    if (!resting) { out.reason = "no resting board mounted"; return out; }

    var epoch;
    if (opts && typeof opts.epoch === "number") {
      epoch = opts.epoch;                                    // test / caller drives t0
    } else if (typeof performance !== "undefined" && performance &&
               typeof performance.now === "function") {
      epoch = performance.now();                             // the live monotonic epoch
    } else {
      epoch = 0;                                             // floor; stamps stay relative
    }

    // The resolve: drop the modifier. The CSS transition does the ceremony.
    if (resting.classList && typeof resting.classList.remove === "function") {
      resting.classList.remove("bg-mega--resting");
    } else {
      resting.className = String(resting.className || "").split(/\s+/)
        .filter(function (c) { return c && c !== "bg-mega--resting"; }).join(" ");
    }

    // Keep the face honest: a "held blurred until Go!" caption on a now-sharp
    // board would be a lie (the courier-note fault this line already paid for).
    // Cold-safe: no caption node -> skip. Same .bg-demo node, no new chrome.
    var caption = paneEl.querySelector ? paneEl.querySelector(".bg-demo") : null;
    if (caption) caption.textContent = liveCaption(paneEl.__battleganzaCreate);

    paneEl.__battleganzaLive = true;
    paneEl.__battleganzaGoEpoch = epoch;
    out.resolved = true; out.epoch = epoch; out.reason = null;
    return out;
  }

  /* ---- the go-live subscription (owed 191, ) -----------------------
   * resolveToLive is the RENDERER's HALF; this is the WIRE that fires it when the
 * host's match goes live. It closes the gap the handoff named: nothing
   * outside this module referenced resolveToLive, so a real match could go live
   * with the mega board still blurred.
   *
   * THE GO-LIVE MOMENT is the SAME one the standalone tab uses (index.html
   * `inSharedMatch`): a shared deal is in play. Two host-owned events reach it:
   *   - the ANSWERER adopts an incoming DEAL envelope (arrives via the shell's
   *     ONE match ear -> onMatchEnvelope);
   *   - the OFFERER shares its deal (a local send, no envelope) -- `shared()`.
   * Both funnel to ONE idempotent go-live; resolveToLive keeps the FIRST epoch,
   * so whichever side/event lands first stamps t0 (D-34) and the rest are no-ops.
   *
   * WHY IT LIVES HERE, NOT IN THE ENGINE. `battleganza/engine/` is SYNCED from the
   * standalone repo (sync-from-battleganza.sh); an edit there would be clobbered
   * and would fork drift. So the wire is AUTHORED in the renderer and reads only
   * the shell's EXISTING surface (`onMatchEnvelope`, the host's share hook) -- it
   * adds no engine verb. It COMPOSES with the host's own DEAL/CLAIM handler rather
   * than replacing it (a second `link.onEnvelope` would be last-writer-wins and
   * clobber PRESENCE -- the exact fault W5-x is a fork to avoid), so `matchHandler`
   * wraps the host handler: fire go-live on a DEAL, THEN run the host's adopt.
   * Order matters -- the epoch is stamped BEFORE the first adopted claim is timed
   * against it.
   *
   * NOT AUTO-FIRED AT MOUNT (the successor caveat, verbatim): a sharp board with
   * no live match is the exact "never unsure whether a move counts" failure the
   * resting blur exists to prevent. This wire fires ONLY on a genuine go-live
   * signal (a real DEAL / a real share), never on paint. Cold-safe throughout
   * (delegates to resolveToLive's own {resolved:false} truth-telling). */
  function wireGoLive(paneEl, host) {
    host = host || {};
    var fired = false;
    function goLive() {
      // Capture t0 at the real go-live instant (performance.now(), D-34);
      // resolveToLive keeps the FIRST epoch if called again, so this is a no-op
      // after the first genuine go-live. A headless caller injects {epoch}.
      var opts = {};
      if (typeof performance !== "undefined" && performance &&
          typeof performance.now === "function") {
        opts.epoch = performance.now();
      }
      var out = resolveToLive(paneEl, opts);
      if (out && out.resolved) fired = true;
      return out;
    }
    var hostMatch = (typeof host.onMatchEnvelope === "function")
      ? host.onMatchEnvelope : null;
    return {
      /* Pass to shell.onMatchEnvelope. On a DEAL (the answerer's go-live) fire
       * the resolve FIRST (stamp t0), THEN hand the envelope to the host's own
       * adopt/verify/apply logic. Never swallows: the host handler always runs. */
      matchHandler: function (env) {
        if (env && env.type === "DEAL") goLive();
        if (hostMatch) hostMatch(env);
      },
      /* The offerer's go-live: called from the host's maybeShareDeal at the same
       * instant it sets inSharedMatch. Idempotent with the DEAL path. */
      shared: function () { return goLive(); },
      /* Direct entry (the go-live path, named) + a read for the host/tests. */
      goLive: goLive,
      fired: function () { return fired; }
    };
  }

  /* ---- adopt-rebuild: the shared deal, painted SHARP -----------------------
   * On a real go-live the resting board unblurs (resolveToLive). But two hosts
   * start on PER-HOST deals (shell.fixture is dealt locally), so the ANSWERER's
   * unblurred board would show ITS OWN local deal — not the shared match. That
   * is the "unblurred but unsynced" half-lie the successor caveat warns against:
   * a board that says "live — the match is on" must be the SHARED deal, not this
   * host's practice deal. So on adopt we rebuild the mega node from the adopted
   * replica and paint it SHARP (resting=false). The OFFERER is honest by
   * construction — it shared its OWN deal, so its resting board IS the shared
   * board; it only needs the unblur (resolveToLive), no rebuild.
   *
   * The paint is the SAME pure path the resting mount uses — megaPlan(viewModel(
   * replica, [], config)) -> paintPlan — with resting=false. Claims reset ([]):
   * a freshly adopted shared deal carries no prior owners on this face (the
   * standalone clears ownersMap for exactly this reason). Cold-safe: no main
   * node, or any paint fault, leaves the already-unblurred board in place and is
   * recorded, never thrown (a rebuild fault must not blank a live board). */
  function paintLive(paneEl, doc, B, replica, config) {
    if (!paneEl || !paneEl.querySelector) return { repainted: false, reason: "no pane" };
    var main = paneEl.querySelector(".bg-main");
    if (!main) return { repainted: false, reason: "no main" };
    try {
      var plan = B.MegaRender.megaPlan(B.ViewModel.viewModel(replica, [], config));
      var old = main.querySelector(".bg-mega");
      if (old && old.parentNode) old.parentNode.removeChild(old);
      paintPlan(doc, main, plan, false);   // resting=false — the shared deal, sharp
      return { repainted: true, reason: null };
    } catch (pe) {
      return { repainted: false, reason: String(pe && pe.message) };
    }
  }

  /* ---- the host loop on the mega surface (owed 219, ) ---------------
   * resolveToLive is the renderer's half; wireGoLive is the subscription; THIS
   * is the CALLER that was missing — the shell+link+pump+share host loop that
   * makes a REAL go-live fire the wire. It mirrors the standalone tab's host
   * (battleganza/index.html): mount the shell, register ONE match ear, drive the
   * link handshake with a pump clock, and share the deal when we are the offerer.
   *
   * WHAT IS REAL HERE (the successor caveat, honored verbatim): nothing fakes a
   * go-live. The wire fires ONLY on a genuine DEAL adopted through the shell's
   * real envelope ear, or a genuine share over a linked link. No timer trips it;
   * mount does not trip it. If no peer links, the board stays honestly resting.
   *
   * COMPOSES, NEVER CLOBBERS. The wire's matchHandler wraps the host's own
   * DEAL/CLAIM handler and is passed to shell.onMatchEnvelope (the ONE ear) —
   * never a second link.onEnvelope (last-writer-wins would clobber PRESENCE, the
   * fault W5-x forks to avoid). On a DEAL: go-live (stamp t0, unblur) FIRST, THEN
   * the host adopts + rebuilds SHARP.
   *
   * NO ENGINE EDIT. battleganza/engine/ is SYNCED; this reads only the shell's
   * existing surface (mount / onMatchEnvelope / offer / pump / link / fixture).
   *
   * Injectable shell (last arg) for the seen test: the engine chain does not load
   * headless from forest/app/public (match.js requires the standalone layout), so
   * the test drives a real paneEl + a fake shell to prove the WIRING, exactly as
   * the go-live-wire suite proves the wire. */
  function standUpHostLoop(paneEl, doc, B, grantKey, injectedShell) {
    var win = (doc && doc.defaultView) || (typeof window !== "undefined" ? window : null);

    // The raw courier the shell will seal. Forest-mail when there is somewhere to
    // send (a live grant + a peer), else the MANUAL (clipboard) courier — the same
    // working fallback the standalone tab uses, so a solo/no-?to= visit still
    // stands up a real host loop instead of nothing. Contained: a courier that
    // cannot be built costs SEND, never the loop.
    var res = resolvePeer(doc);
    var courier = null, courierNote = null, courierKind = null;
    try {
      if (grantKey && res.peer) {
        courier = makeCourier(grantKey, res.peer);
        if (courier) courierKind = "forest-mail";
      }
      if (!courier && B.ManualCourier && typeof B.ManualCourier.createManualCourier === "function") {
        courier = B.ManualCourier.createManualCourier();
        courierKind = "manual";
        courierNote = "manual (clipboard) courier — add ?to=<address> for Forest mail";
      }
    } catch (ce) {
      courierNote = "courier unavailable: " + String(ce && ce.message);
    }
    if (!courier) return { ok: false, reason: "no courier (" + (courierNote || "none built") + ")" };

    var shell;
    try {
      shell = injectedShell || B.Shell.mount({
        G: B,
        courier: courier,
        skin: null,   // the mega surface has its OWN painter (paintPlan); no shell skin
        storage: (function () { try { return win && win.localStorage; } catch (e) { return null; } })(),
        setTimer: function (fn, ms) { return win ? win.setInterval(fn, ms) : null; }
      });
    } catch (me) {
      return { ok: false, reason: "shell mount failed: " + String(me && me.message) };
    }
    if (!shell || typeof shell.onMatchEnvelope !== "function") {
      return { ok: false, reason: "shell has no onMatchEnvelope" };
    }

    var inSharedMatch = false;

    // The host's own live-game handler — the tab's DEAL/CLAIM logic, moved onto
    // the mega surface. DEAL: rebuild the replica from the adopted shared deal and
    // repaint SHARP (paintLive). CLAIM: verify BEFORE apply (a rejected claim
    // writes nothing), then apply + repaint. Never swallows: the wire runs go-live
    // FIRST, then hands the same envelope here.
    function currentSeat() {
      var r = shell.fixture && shell.fixture.replica;
      return r ? { player: r.player, team: r.team, mark: r.mark } : { player: "p1", team: "A", mark: "X" };
    }
    function hostMatch(env) {
      if (!env) return;
      if (env.type === "DEAL") {
        try {
          var adopted = B.Match.deserializePuzzles(env);
          shell.fixture.replica = B.Match.createReplica(adopted, currentSeat());
          inSharedMatch = true;
          paintLive(paneEl, doc, B, shell.fixture.replica, shell.fixture.config);
        } catch (e) { /* adopt refused — the board stays live-but-local; recorded, not thrown */ }
        return;
      }
      if (env.type !== "CLAIM") return;
      try {
        var rep = shell.fixture && shell.fixture.replica;
        if (!rep || !B.Match.verifyClaim(rep, env)) return;   // rejected claim writes nothing
        B.Match.applyReveal(rep, env);
        paintLive(paneEl, doc, B, rep, shell.fixture.config);
      } catch (e) { /* incoming reveal refused — recorded, not thrown */ }
    }

    // The wire: go-live composes with hostMatch. matchHandler -> the ONE ear.
    var wire = root.battleganzaRenderer.wireGoLive(paneEl, { onMatchEnvelope: hostMatch });
    shell.onMatchEnvelope(wire.matchHandler);

    // The offerer's share: the same instant it deals the shared match, it fires
    // the wire's shared() go-live (idempotent with the answerer's DEAL path).
    var dealShared = false;
    function maybeShareDeal() {
      if (dealShared) return false;
      var link = shell.link;
      if (!link || link.state !== "linked") return false;
      if (!shell.view || shell.view().seat !== "offerer") return false;   // only the offerer deals
      try {
        link.send(B.Boundary.deal(B.Match.serializePuzzles(shell.fixture.deal)));
        dealShared = true;
        inSharedMatch = true;
        wire.shared();   // the offerer's go-live — unblur its OWN (== the shared) board
        return true;
      } catch (e) { return false; }
    }

    // The link-completion driver. The handshake needs BOTH sides to pump (the
    // answerer to consume the OFFER, the offerer the ANSWER); shell.js runs no
    // pump clock. Poll ONLY until linked (the keepalive takes over), then share.
    var POLL_MS = 2500;
    var pumpTimer = null;
    if (win && typeof win.setInterval === "function") {
      pumpTimer = win.setInterval(function () {
        var l = shell.link;
        if (!l || l.state === "linked" || typeof shell.pump !== "function") {
          if (pumpTimer && win.clearInterval) win.clearInterval(pumpTimer);
          maybeShareDeal();
          return;
        }
        shell.pump().then(function (kind) { if (kind) maybeShareDeal(); }).catch(function () {});
      }, POLL_MS);
    }

    paneEl.__battleganzaShell = shell;         // for inspection / the seen test
    paneEl.__battleganzaWire = wire;
    paneEl.__battleganzaHostMatch = hostMatch;
    paneEl.__battleganzaMaybeShareDeal = maybeShareDeal;

    return {
      ok: true, shell: shell, wire: wire,
      offer: function () { return (typeof shell.offer === "function") ? shell.offer() : null; },
      maybeShareDeal: maybeShareDeal,
      courierNote: courierNote,
      courierKind: courierKind,
      // Only the forest-mail courier auto-exchanges the offer/answer over a real
      // channel; the manual (clipboard) fallback needs a handshake paste box this
      // surface does NOT yet have, so an "offer a link" click there would produce
      // an SDP blob with nowhere to go — a silent dead-end (the "refusal reported
      // as patience" fault this renderer's posture forbids). canOffer is the gate.
      canOffer: courierKind === "forest-mail",
      inSharedMatch: function () { return inSharedMatch; }
    };
  }

  /* ---- the painter: plan data -> DOM. Structure from the proven frozen page
   * (battleganza/index.html:436-490); skin is Forest's own. */
  function paintPlan(doc, main, plan, resting) {
    var mega = el(doc, "div", "bg-mega" + (resting ? " bg-mega--resting" : ""));

    plan.boards.forEach(function (b) {
      var cell = el(doc, "div", "bg-board " + (b.tokens || []).map(function (t) {
        return "bg-board--" + t;
      }).join(" "));

      var head = el(doc, "div", "bg-board-head");
      head.appendChild(el(doc, "span", null, { text: "board " + b.board }));
      head.appendChild(el(doc, "span", null, { text: b.state }));
      cell.appendChild(head);

      var face = el(doc, "div", "bg-face");
      b.boxes.forEach(function (box) {
        var cls = ["bg-box"];
        if (box.owner)      cls.push("bg-box--" + box.owner);
        if (box.openThreat) cls.push("bg-box--threat");
        if (box.minesolved) cls.push("bg-box--mine");
        if (box.viaReveal)  cls.push("bg-box--revealed");
        var d = el(doc, "div", cls.join(" "), { text: box.owner || "" });
        d.title = "box " + box.box +
          (box.owner ? " — owned by " + box.owner : " — unclaimed") +
          (box.openThreat ? " — open threat for " + box.openThreat : "") +
          (box.minesolved ? " — solved by you" : "") +
          (box.viaReveal ? " — revealed to you" : "");
        face.appendChild(d);
      });
      cell.appendChild(face);

      // `fill` is a PASS-THROUGH of the view-model's density. Not re-derived,
      // not weighted -- own-progress has its own channel and must not leak in.
      var bar = el(doc, "div", "bg-fill");
      var i = el(doc, "i");
      i.style.width = Math.round((b.fill || 0) * 100) + "%";
      bar.appendChild(i);
      cell.appendChild(bar);

      cell.appendChild(el(doc, "div", "bg-label", { text: b.label }));
      mega.appendChild(cell);
    });

    main.appendChild(mega);
  }

  /* ---- the board: the engine's own face, painted into the pane -------------- */
  function mountBoard(paneEl, doc, grantKey) {
    try {
      paneEl.innerHTML = "";
      var app = el(doc, "div", "bg-app");
      // STATUS, not the rail (block 7, S02). The primary navigation now lives in
      // the shared menu seam (paintRail -> ctx.menuBody). This in-pane strip is
      // demoted to the W5 peer/authority STATUS band — advisory-tier (D-38),
      // never the primary left rail. Its `bg-rail` class is kept only for its
      // existing styling (zero new grammar); the aria-label names its true role
      // so it does not read as navigation. _resolvePeer / makeCourier are intact.
      var rail = el(doc, "div", "bg-rail", { role: "status", "aria-label": "Battleganza status" });
      var main = el(doc, "div", "bg-main");

      var status = el(doc, "div", "bg-note", {
        text: grantKey
          ? "send authority: " + grantKey + " (expires in " + TTL_MIN + " min)"
          : "send authority: none — read-only"
      });
      rail.appendChild(status);
      app.appendChild(rail);
      app.appendChild(main);
      paneEl.appendChild(app);

      var B = window.Battleganza;
      var ready = B && B.Match && B.Rules && B.Boundary &&
                  B.ViewModel && typeof B.ViewModel.viewModel === "function" &&
                  B.MegaRender && typeof B.MegaRender.megaPlan === "function";

      if (ready) {
        // The paint is its own try: a painter fault is DOM-shaped and must not
        // read as an engine fault. Naming which half broke is the whole point
        // of splitting them -- the last three sessions lost time to a blank
        // board that could not say why it was blank.
        try {
          var created = paneEl.__battleganzaCreate;
          main.appendChild(el(doc, "p", "bg-demo", { text: restingCaption(created) }));
          paintPlan(doc, main, restingPlan(B, paneEl), true);   // resting = blurred
        } catch (pe) {
          main.appendChild(el(doc, "p", "bg-bad", {
            text: "The engine produced a plan but the board failed to paint: " +
                  String(pe && pe.message)
          }));
        }
      } else {
        var missing = [];
        if (!B) missing.push("Battleganza");
        else {
          if (!B.Match) missing.push("Match");
          if (!B.Rules) missing.push("Rules");
          if (!B.Boundary) missing.push("Boundary");
          if (!B.ViewModel || typeof B.ViewModel.viewModel !== "function") missing.push("ViewModel.viewModel");
          if (!B.MegaRender || typeof B.MegaRender.megaPlan !== "function") missing.push("MegaRender.megaPlan");
        }
        main.appendChild(el(doc, "p", "bg-note", {
          text: "The engine loaded but is missing: " + missing.join(", ") +
                " — nothing rendered rather than a wrong board."
        }));
      }
      paneEl.__battleganzaMounted = true;
      paneEl.__battleganzaGrant = grantKey || null;
      // (first browser witness). The courier is a SEND-time need that was being
      // constructed at MOUNT time: forest-mail.js:141 throws without a `to`, and a solo
      // visit has no peer -- so the single-window first look, which is exactly the look
      // this arc prescribes, could never start. Worse, the board above was already
      // painted and mounted; the throw fell to honestNote(), which blanks innerHTML, so
      // a WORKING board was erased by a failure in a line that does not paint anything.
      // Two changes, both narrowing: (a) build it only when there is somewhere to send,
      // (b) contain its failure so it can only cost SEND, never the board. The renderer's
      // own stated posture is to degrade loudly on refusal and never report refusal as
      // patience -- that holds here: no peer is not a refusal, and a courier that cannot
      // be built is recorded, not swallowed.
      var res = resolvePeer(doc);
      var peer = res.peer;
      paneEl.__battleganzaCourier = null;
      paneEl.__battleganzaCourierNote = null;
      paneEl.__battleganzaPeer = peer;
      if (grantKey && peer) {
        try {
          paneEl.__battleganzaCourier = makeCourier(grantKey, peer);
          paneEl.__battleganzaCourierNote = "sending to " + peer + " (via " + res.source + ")";
        } catch (ce) {
          paneEl.__battleganzaCourierNote = "send is unavailable: " + String(ce && ce.message);
        }
      } else if (grantKey && res.rejected) {
        // A PRESENT-BUT-REJECTED ?to= is a REFUSAL, not patience. The old single note
        // ("no peer yet") would have reported a rejected address as an absent one --
        // the exact "report refusal as patience" fault this renderer's own posture forbids.
        paneEl.__battleganzaCourierNote =
          "send authority held; the ?to= address was REFUSED (" + res.rejected + "): " + res.raw;
      } else if (grantKey && !peer) {
        paneEl.__battleganzaCourierNote = "send authority held; no peer yet (add ?to= to play a second identity)";
      }
      // -- THE RENDER HALF. The second browser witness came back NEGATIVE: every
      // branch above wrote __battleganzaCourierNote and NOTHING ANYWHERE READ IT (written
      // 5x, read 0x across forest/app/public), so the ?to= handshake painted nothing on all
      // four URL shapes -- plain, accepted peer, and REFUSED alike. mountBoard built exactly
      // ONE bg-note (the send-authority line, inline at ~418) and never a node for this one.
      // 1.2 carried the mirror fault (battleganzaPeer read at mount, set nowhere) and its
      // "add ?to=" string was never on the face either -- so 1.3 was an INCOMPLETE fix, not
      // a regression: the parse was real and tested, the paint was never built. Painted from
      // the SAME property the branches set, so that property stays the single source of truth
      // (the existing 8/8 keeps asserting on it) and the DOM finally reads it. Reuses the
      // already-styled bg-note class -- no new class, because an unstyled new class is its
      // own registered fault on this line. owed 301; lesson 302 (build/testing).
      if (paneEl.__battleganzaCourierNote) {
        rail.appendChild(el(doc, "div", "bg-note", {
          text: paneEl.__battleganzaCourierNote
        }));
      }

      // (owed 219) — stand up the REAL host loop so a genuine go-live
      // fires the wire. Gated on the engine being WHOLE (ready) AND B.Shell (added
      // to SCRIPTS this session). On a partial/absent engine the board stays a
      // resting read (exactly as before), never a fake and never a broken mount.
      // The host loop is inert-until-real by construction: the wire fires on a
      // genuine DEAL/share, never on this mount.
      if (ready && B.Shell && typeof B.Shell.mount === "function") {
        var loop = standUpHostLoop(paneEl, doc, B, grantKey || null);
        if (loop && loop.ok && loop.canOffer) {
          // The offer affordance — ONLY when the transport can actually complete
          // it (forest-mail auto-exchange). A real click starts a real link; the
          // wire still fires only when the deal actually crosses.
          var offer = el(doc, "button", "bg-note", {
            text: "offer a link", role: "button", tabindex: "0",
            "aria-label": "Offer a Battleganza link to your peer"
          });
          activate(offer, function () {
            try { loop.offer(); } catch (oe) { /* the shell noted it; status band shows it */ }
          });
          rail.appendChild(offer);
        } else if (loop && loop.ok) {
          // Loop is live and can RECEIVE a shared deal (the answerer path needs no
          // grant), but cannot auto-offer on this transport — say so honestly
          // rather than paint a button that dead-ends.
          rail.appendChild(el(doc, "div", "bg-note", {
            text: "live play: ready to receive a shared deal. " +
                  (loop.courierNote || "add ?to=<peer> and a send grant to offer a link")
          }));
        } else if (loop) {
          rail.appendChild(el(doc, "div", "bg-note", {
            text: "live play unavailable: " + loop.reason
          }));
        }
      }
    } catch (e) {
      honestNote(paneEl, doc, "The Battleganza pane failed to start.", String(e && e.message));
    }
  }

  root.battleganzaRenderer = {
    render: render, mintGrant: mintGrant,
    _resolvePeer: resolvePeer,   // -- exposed for battleganza-peer.test.js (the _appVersion precedent)
    _mountBoard: mountBoard,     // -- exposed for battleganza-peer-paint.test.js. The parse
                                 // seam above was exposed and asserted 8/8 while the PAINT had no seam
                                 // and no assertion, which is exactly how a note written 5x and read 0x
                                 // shipped to the box. A rendered deliverable needs a rendered assertion.
    _paintPlan: paintPlan,       // S02 -- exposed so the resting-blur can be asserted without the engine
                                 // (the engine chain cannot load under the node DOM, so _mountBoard hits
                                 // the missing-engine branch; paintPlan is the pure plan->DOM painter).
    _paintRail: paintRail,       // S02 -- exposed for battleganza-frame-wiring.test.js. The rail is a
                                 // rendered deliverable (slots the operator SEES), so it gets a rendered
                                 // assertion driving the real paint into a real ctx.menuBody -- the same
                                 // lesson (302) the courier note taught: a seen feature needs a seen test.
    _showNewGame: showNewGame,   // -- block 6. The create pop-up is a SEEN deliverable (the
                                 // operator fills it), so it gets a seen test: open it into a real paneEl,
                                 // assert the field set, the D-63 scale->format gate, and that Create
                                 // records the descriptor + closes the overlay without wiping the board.
    _fillRestingBoard: fillRestingBoard,
    _createdBand: createdBand,            // -- the solo-visible "created" band (create-flow
                                          // legibility fix). A SEEN deliverable, so it gets a seen test;
                                          // the D-25 frame-leak guard also scans it for a difficulty tell.
    _buildCreatedPlan: buildCreatedPlan,  // driven with an injected fake B (engine chain won't load in node)
    _formatsFor: formatsFor,
    _restingCaption: restingCaption,      // board-mount polish — the D-25 frame-leak guard drives it
    resolveToLive: resolveToLive, // -- the sharp-on-Go! resolve, PUBLIC: the go-live path (W5
                                  // host arc / transport) calls this when Go! fires to unblur the board.
                                  // Named public, not just _-prefixed, because its caller is another
                                  // module (the transport), not only the test — the subscription seam.
    wireGoLive: wireGoLive,       // (owed 191) -- the go-live SUBSCRIPTION: composes with the
                                  // shell's onMatchEnvelope so the shared-deal-adopted / share moment
                                  // fires resolveToLive. PUBLIC: the host loop (browser standup / the
                                  // standalone tab / a FakeRTC harness) wires it. Not auto-fired.
    _wireGoLive: wireGoLive,      // _-alias for the seen test's own convention
    _resolveToLive: resolveToLive,        // -- same fn, _-alias for the seen test's own convention
    _liveCaption: liveCaption,            // -- exposed so the D-25 no-difficulty guard covers it too
    standUpHostLoop: standUpHostLoop,     // (owed 219) -- the host loop: shell+link+pump+share wired
                                          // through wireGoLive. PUBLIC: the browser standup calls it; the seen
                                          // test drives it with a fake shell (engine chain won't load headless).
    _standUpHostLoop: standUpHostLoop,    // _-alias for the seen test's own convention
    _paintLive: paintLive,                // -- the adopt-rebuild painter (shared deal, sharp)
    _version: "1.11"
  };
  if (root.pane && typeof root.pane.registerRenderer === "function") root.pane.registerRenderer("battleganza", render);
})();
