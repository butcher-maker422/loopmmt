'use strict';
/**
 * Battleganza — W5-c: THE SHARED SHELL. The body both hosts mount.
 * The Heaving Line leg plan v1 §3 W5 (leg W5-c/d).
 *
 * WHY THIS EXISTS. S25.2042 byte-read both ends and found the hosts inherit NO
 * painter: `megaPlan(vm)` returns pure frozen DATA and stops, and battleganza
 * has no shell to hand that data to. The sudoku dual-expression solved the same
 * shape with `shell/shell.js` + a per-shell skin. The leg plan named the choice
 * explicitly -- a second hand-written painter, or a shared shell -- and the
 * operator took the shell (S25.2133, option B). This is that shell.
 *
 * THE ONE DELIBERATE DIVERGENCE FROM THE SUDOKU PRECEDENT, and it is the whole
 * design. dual-expression's shell.js SMUGGLES DOM by contract ("that is what an
 * expression surface IS") because its two shells vary in exactly one axis: how
 * the grid is drawn. Battleganza's two hosts vary in TWO axes -- how the mega
 * grid is drawn AND how blobs cross the wire (manual clipboard vs forest-mail).
 * A shell holding DOM could only share the first. So THIS SHELL TOUCHES NO DOM:
 * it computes state and drives the wire, and hands both to a skin that owns
 * every pixel. The seam moved because the variation moved -- copying the sudoku
 * seam verbatim would have been cargo, not reuse.
 *
 * AND IT BUYS THE TEST. index.html's slice-B assertions are all SCOPE checks
 * (test-w5b-order §D1-D6): they prove the page CONTAINS a setInterval, a
 * localStorage touch, a boxIsSolved call. They could never prove any of it RUNS,
 * which is why W5-b needed a human at a browser to close. A DOM-free shell runs
 * headless in the vm harness, so `test-w5c-shell.js` asserts BEHAVIOUR -- the
 * sweep's contents, the identity's persistence across a remount, the keepalive's
 * guard, the seal's refusal. The browser witness stops being the only proof and
 * becomes the last one.
 *
 * NO DOM, NO TIMER, NO STORAGE OF ITS OWN. The shell takes `storage` and `now`
 * and `setTimer` as injected capabilities rather than reaching for
 * window.localStorage / setInterval directly. Not for purity points: it is the
 * only way the identity and keepalive contracts are testable at all, and the
 * host already owns those lifecycles by two standing rules of this line --
 * link.js:72 ("the link never calls setInterval; a layer that starts a clock
 * owns a lifecycle") and net.js:93 ("the probe id is the HOST's to mint"). The
 * shell sits between link and host, so it inherits the host's side of both.
 *
 * WHAT IS NOT SHARED, and why each one is per-host rather than an oversight:
 *   - the skin        -- the mega grid's pixels (a DOM table vs a Forest pane)
 *   - the courier     -- manual clipboard vs forest-mail
 *   - the boot strip  -- the standalone page checks a 13-tag script chain; the
 *                        Forest tab is loaded by the Forest's own shell and has
 *                        no such chain to check
 */

/* BATTLEGANZA-DUAL-EXPRESSION — node: module.exports · browser: root.Battleganza.Shell */
(function (root) {

/* ---- the canned fixture (PURE) -------------------------------------------
 * Lifted in SHAPE from index.html §2, which earned its browser witness at
 * S25.2133. Deterministic in territory, not in digits: dealMatch generates real
 * puzzles so the fill bars differ per load, while the claim set below is
 * hand-canned so the paint exercises every visual state rather than nine empty
 * boards. 1-indexed on purpose -- evaluate() ingests board/box in 1..9 and
 * silently skips anything else. */
const CANNED = [
  // board 1 — X takes a full line: this board reads won-X.
  { board: 1, box: 1, mark: 'X' }, { board: 1, box: 2, mark: 'X' }, { board: 1, box: 3, mark: 'X' },
  // board 5 — X holds two of a line: leaves ONE open box = a threat ring.
  { board: 5, box: 4, mark: 'X' }, { board: 5, box: 5, mark: 'X' },
  // board 5 — O contests elsewhere on the same board.
  { board: 5, box: 9, mark: 'O' },
  // board 7 — O alone: contested, no line.
  { board: 7, box: 2, mark: 'O' }
];

/* replica-private channels — never reach the claim log. That split IS the
 * public/private line the whole match model is built on. */
const SOLVED_BY_ME = ['1:1', '5:4'];
const REVEALED = ['7:2'];

/* The seed: ONE genuinely-solved, never-claimed box, so the readyToClaim cue has
 * something honest to paint on a fresh deal. Copies the deal's OWN solution
 * digits into the replica -- cann the INPUT so the paint exercises the state,
 * never fake the OUTPUT. It does NOT touch solvedByMe: that set means CLAIMED
 * (match.js:311 adds to it inside attemptClaim), which is exactly the gap
 * "solved but not banked" names. boxIsSolved then earns its true through the
 * solver, with no special-casing anywhere downstream. */
const SEED = { board: 3, box: 5 };

/* THE SEAT TABLE (mirrors the standalone's G.Seats, index.html). The two hosts
 * must agree on this mapping or they are not the same match. Frozen so a host
 * cannot drift its own seat. On THIS surface the deal is still PER-HOST (the
 * practice-board banner's whole point), so a reseat rebuilds the replica on the
 * fixture's OWN deal -- it changes WHO this player is (mark/player/team), it does
 * NOT adopt a shared deal or cross a claim. That is the seat-only scope: two
 * hosts stop both being X; the banner stays because it is still not a match. */
const SEATS = Object.freeze({
  offerer:  Object.freeze({ player: 'p1', team: 'A', mark: 'X' }),
  answerer: Object.freeze({ player: 'p2', team: 'B', mark: 'O' })
});

/* Build a replica for a seat on a given deal, seeded with the canned demo state
 * so the paint exercises every visual state. Factored out of buildFixture so a
 * post-handshake RESEAT (offerer stays X, answerer becomes O) re-applies the
 * identical seeding on the fixture's own deal, rather than handing the answerer a
 * bare board. The seeding is demo state on a practice board, not a claim ledger,
 * so it is applied the same for both seats. */
function seatReplica(G, deal, seat) {
  const replica = G.Match.createReplica(deal, seat);
  SOLVED_BY_ME.forEach(function (k) { replica.solvedByMe.add(k); });
  REVEALED.forEach(function (k) { replica.revealed.add(k); });
  const sol = deal.boards[SEED.board - 1].solution;
  const r0 = Math.floor((SEED.box - 1) / 3) * 3;
  const c0 = ((SEED.box - 1) % 3) * 3;
  for (let dr = 0; dr < 3; dr++) {
    for (let dc = 0; dc < 3; dc++) {
      const i = (r0 + dr) * 9 + (c0 + dc);
      replica.grids[SEED.board][i] = sol[i];
    }
  }
  return replica;
}

function buildFixture(G, opts) {
  const o = opts || {};
  const deal = G.Match.dealMatch({ difficulty: o.difficulty || 'easy' });
  /* Solo/pre-handshake placeholder seat: a lone page has to be SOMEBODY, so it
   * boots as the offerer (X). seat() rebuilds this the moment a role resolves --
   * booting both hosts here and never revisiting it is what left both on X. */
  const replica = seatReplica(G, deal, SEATS.offerer);
  const config = G.Rules.createMatchConfig();

  const claimLog = CANNED.map(function (c, i) {
    return G.Boundary.claim({
      player: c.mark === 'X' ? 'p1' : 'p2',
      team: c.mark === 'X' ? 'A' : 'B',
      board: c.board, box: c.box, mark: c.mark,
      values: [1], t: i
    });
  });

  return { deal, replica, config, claimLog };
}

/* ---- the state build (PURE) ----------------------------------------------
 * The 81-box readyToClaim sweep lives HERE and not in view-model.js, by the
 * ratified owed-866 decision (option B, host-side): the view model's contract is
 * a CHEAP READ and this is a solver call per box. The shell is the host's side
 * of that seam, so the sweep comes with it.
 *
 * READY = solved on this replica AND not already claimed by me AND not already
 * owned by anyone. The third clause matters: a box someone else took is gone,
 * and cueing it would send the player at a dead square. */
function buildState(G, fx, now) {
  const clock = typeof now === 'function' ? now : function () { return Date.now(); };
  // presence (S2, dial 9 / D-17) is the host's 4th input: the live board focus
  // of each teammate. Optional — an fx with no `presence` leaves it undefined,
  // and the view-model treats that as "no teammates visible" (backward compat
  // for every caller that predates S2). The teammate highlight then flows
  // through megaPlan with no further shell change: WHERE a teammate is, never
  // WHAT. Populating fx.presence from received PRESENCE envelopes + emitting
  // one's own focus is the live-loop half, still owed
  // (battleganza-s2-presence-host-wiring-unbuilt).
  const vm = G.ViewModel.viewModel(fx.replica, fx.claimLog, fx.config, fx.presence);
  const plan = G.MegaRender.megaPlan(vm);

  const ownedNow = {};
  plan.boards.forEach(function (bb) {
    bb.boxes.forEach(function (bx) { if (bx.owner) ownedNow[bb.board + ':' + bx.box] = true; });
  });

  const readyKeys = {};
  const t0 = clock();
  for (let bN = 1; bN <= 9; bN++) {
    for (let xN = 1; xN <= 9; xN++) {
      const k = bN + ':' + xN;
      if (fx.replica.solvedByMe.has(k) || ownedNow[k]) continue;
      if (G.Match.boxIsSolved(fx.replica, bN, xN)) readyKeys[k] = true;
    }
  }
  const sweepMs = clock() - t0;

  return { plan, readyKeys, sweepMs, readyCount: Object.keys(readyKeys).length };
}

/* ---- machine identity (PURE over an injected store) -----------------------
 * Operator ratified localStorage S25.2109 (option A) on the Loop 2.1 precedent
 * net.js's own header cites. Persistence is the POINT, not a convenience: the
 * RTC fidelity gap open since W3 closes only under a live two-browser run, and
 * that run needs a machine that is still the same machine after a refresh.
 *
 * Storage can throw (private mode, disabled cookies, a file:// origin in some
 * browsers). A host that dies because it could not REMEMBER is worse than one
 * that runs ephemerally and says so, so every touch is guarded and the fallback
 * is an in-memory identity plus an honest `source`. */
const IDENT_KEY = 'battleganza.machine.v1';

function resolveIdentity(storage, randomId) {
  let stored = null;
  try {
    const raw = storage && storage.getItem(IDENT_KEY);
    if (raw) {
      const got = JSON.parse(raw);
      if (got && typeof got.id === 'string' && got.id !== '') stored = got;
    }
  } catch (e) { stored = null; }

  if (stored) return { ident: stored, source: 'remembered' };

  const id = randomId();
  const ident = { id, handle: 'machine-' + id.slice(0, 4), position: 0 };
  let wrote = false;
  try { storage.setItem(IDENT_KEY, JSON.stringify(ident)); wrote = true; }
  catch (e) { wrote = false; }
  return { ident, source: wrote ? 'minted' : 'ephemeral' };
}

function forgetIdentity(storage) {
  try { storage.removeItem(IDENT_KEY); return true; }
  catch (e) { return false; }
}

/* ---- mount ---------------------------------------------------------------
 * Returns a controller. The skin is handed a VIEW (plain data) and owns every
 * pixel; the shell never reaches into the DOM, so this whole function runs
 * headless under the vm harness with a fake courier, a fake store and a fake
 * timer. That is the property the browser-only slice-B assertions could not buy.
 *
 * opts:
 *   G        required — the Battleganza namespace (injected, so node and browser
 *                       resolve it the same way and neither hardcodes a path)
 *   courier  required — RAW courier. The shell seals it before the link sees it.
 *   skin     optional — { render(view) }. Absent is legal: a headless mount.
 *   storage  optional — localStorage-shaped. Absent → ephemeral identity.
 *   setTimer optional — setInterval-shaped. Absent → no keepalive clock.
 *   now / randomId — injected clocks/entropy for deterministic tests.
 */
function mount(opts) {
  const o = opts || {};
  const G = o.G;
  if (!G) throw new Error('battleganza shell: G (the Battleganza namespace) is required');
  if (!o.courier) throw new Error('battleganza shell: a courier is required');

  const skin = o.skin || null;
  const storage = o.storage || null;
  const now = o.now || function () { return Date.now(); };
  const randomId = o.randomId || function () {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') {
      return root.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    }
    let s = '';
    for (let i = 0; i < 12; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)];
    return s;
  };

  const notes = [];
  function note(msg) { notes.unshift({ t: now(), msg: msg }); return msg; }

  // ---- state ----
  const fx = buildFixture(G, o);

  /* ---- the presence loop (S2, dial 9 / D-17 — the LIVE half) ----------------
   * The engine half landed at S01.0300 (fold->paint->wire->shell): buildState
   * threads fx.presence into the view-model and the teammate highlight flows
   * through megaPlan. What was owed (battleganza-s2-presence-live-loop-and-tab-
   * dom-unbuilt, seq 178) is the two moving parts that make a playtester SEE it
   * in a real match: emit my own focus on change, and populate presence from
   * received PRESENCE envelopes. Both live here.
   *
   * presenceByPlayer: player id -> { player, team, board, t }, the LATEST focus
   * each teammate broadcast. Re-projected to exactly those four board-level
   * fields, so a stray wire field cannot enter here — WHERE-not-WHAT is the
   * store's SHAPE, the same guarantee the boundary allowlist makes at the seam.
   *
   * EPHEMERAL by the S01.0300 operator ruling (choice B): this map is in-memory
   * only and never reaches the claim log or any persisted surface. A refresh
   * forgets every teammate's focus, which is exactly right for "where are you
   * RIGHT NOW" — a presence is not a claim and is never replayed as one. */
  const presenceByPlayer = {};
  let myBoard = null;
  function presenceList() {
    return Object.keys(presenceByPlayer).map(function (k) { return presenceByPlayer[k]; });
  }
  function withPresence() { return Object.assign({}, fx, { presence: presenceList() }); }

  let state = buildState(G, withPresence(), now);
  function rebuild() { state = buildState(G, withPresence(), now); repaint(); }

  /* ---- the seat (reseat-on-handshake, seat-only scope) ---------------------
   * The fixture boots as the offerer (X). The moment the handshake resolves a
   * role -- offer() means offerer, a pump() that returns 'OFFER' means answerer
   * -- reseat the fixture replica to that role's mark on the fixture's OWN deal.
   * A role, once taken, is KEPT (pumping twice is not a re-seat). This is the
   * shell's copy of the standalone's seat(); it does NOT adopt a shared deal or
   * cross a claim -- it only stops two hosts from both coming up X. */
  let seated = null;
  function seat(role) {
    const spec = SEATS[role];
    if (!spec || seated) return;
    fx.replica = seatReplica(G, fx.deal, spec);
    seated = role;
    note('seated as ' + role + ' -- you play ' + spec.mark + '.');
    rebuild();
  }

  // ---- identity ----
  const who = resolveIdentity(storage, randomId);
  const ident = who.ident;

  /* THE COURIER SPLIT. The RAW courier is what a host affordance drives (a paste
   * box, a mail poll); the SEALED one is what the link gets. That split is
   * courier.js's whole point -- nothing crosses a sealed courier unless it parses
   * as a handshake frame -- and collapsing them would hand the link a channel a
   * human can put anything into. */
  const sealed = G.Courier.seal(o.courier);

  let link = null, net = null, linkError = null, probeSeq = 0, pingCount = 0;

  /* THE MATCH HOOK (W5-x, Option A). A page-registered handler for the live
   * game envelopes (DEAL / CLAIM) the shell does NOT own the logic for. The
   * shell stays UI-free AND match-logic-free: the ONE envelope ear routes
   * PRESENCE itself and hands DEAL/CLAIM to this hook, so the host owns adopt,
   * verifyClaim/applyReveal, its ownersMap and its repaint. Registered via
   * api.onMatchEnvelope; null until a host wires it (headless/practice hosts
   * leave it null and the ear falls through to note, exactly as before). It is
   * the SAME single ear extended — never a second link.onEnvelope, which is
   * last-writer-wins at wire/link.js and would clobber PRESENCE. */
  let matchHook = null;

  /* Receive a teammate's live focus. Re-projects to the four board-level fields
   * (never the raw envelope) and DROPS anything staler than what this player
   * last said: the wire is at-least-once and unordered (bus.js), so a late
   * duplicate must not overwrite a newer focus. Then rebuilds — the highlight
   * flows through megaPlan with no engine change. An opponent's presence, were
   * it ever to arrive, is stored harmlessly: teammateBoardsOf filters by team
   * and self, so it never lights a board. */
  function receivePresence(env) {
    const p = env && env.player;
    if (!p) return false;
    const prev = presenceByPlayer[p];
    if (prev && typeof prev.t === 'number' && typeof env.t === 'number' && env.t < prev.t) return false;
    presenceByPlayer[p] = { player: env.player, team: env.team, board: env.board, t: env.t };
    rebuild();
    return true;
  }

  /* Emit MY current focus to same-team peers. Board-level ONLY — the envelope is
   * built by boundary.presence, so a box/values/cell datum is refused AT THE
   * SEAM, not policed here. Sends only when linked; a focus set while the link
   * is down is HELD in myBoard and announced the instant the link comes up (see
   * offer/pump below). */
  function emitPresence() {
    if (myBoard === null) return false;
    if (!link || link.state !== 'linked') {
      note('focus held (board ' + myBoard + '): link is ' + (link ? link.state : 'unavailable'));
      return false;
    }
    try {
      const env = G.Boundary.presence({
        player: fx.replica.player, team: fx.replica.team, board: myBoard, t: now()
      });
      link.send(env);
      note('focus emitted: board ' + myBoard);
      return true;
    } catch (e) { note('focus emit failed: ' + e.message); return false; }
  }

  try {
    link = G.Link.createLink({ side: o.side || 'l', courier: sealed, rtc: o.rtc });
    net = G.Net.createNet({ self: ident, links: { l: link } });
    link.onTransport(function (msg) { note('transport in: ' + msg.type); repaint(); });
    /* THE ENVELOPE EAR — ONE ear, EXTENDED (W5-x). A PRESENCE envelope is the
     * one live channel the shell wires itself: it populates the teammate map
     * and rebuilds. The live-game envelopes (DEAL / CLAIM) are handed to the
     * page's matchHook when one is registered — the shell routes, the host
     * adopts/verifies/applies/repaints. Anything else, or a host that wired no
     * hook, still just notes (the practice-board path). This is the SAME single
     * handler, never a second link.onEnvelope: a second registration is
     * last-writer-wins at wire/link.js and would silently clobber PRESENCE. */
    link.onEnvelope(function (env) {
      if (env && env.type === 'PRESENCE') {
        receivePresence(env);
        note('presence in: ' + env.player + ' -> board ' + env.board);
      } else if (matchHook && env && (env.type === 'DEAL' || env.type === 'CLAIM')) {
        try { matchHook(env); }
        catch (e) { note('match hook threw on ' + env.type + ': ' + e.message); }
      } else {
        note('envelope in: ' + (env && env.type));
      }
      repaint();
    });
  } catch (e) { linkError = e; }

  /* THE KEEPALIVE. link.js:72 -- the link exposes ping() and lastPingAt and
   * "never calls setInterval. A layer that starts a clock owns a lifecycle." The
   * shell is the host's side, so the clock is here. Unconditional-and-guarded
   * rather than started on link: a timer that only exists in one state is a timer
   * whose teardown you forget. ping() throws unless linked, so the guard is the
   * state read and the throw is the backstop. */
  const PING_MS = o.pingMs || 5000;
  let timer = null;
  if (typeof o.setTimer === 'function') {
    timer = o.setTimer(function () {
      if (!link || link.state !== 'linked') return;
      try { link.ping(now()); pingCount++; } catch (e) { note('ping refused: ' + e.message); }
      repaint();
    }, PING_MS);
  }

  function view() {
    return {
      version: __api._version,
      plan: state.plan,
      readyKeys: state.readyKeys,
      readyCount: state.readyCount,
      sweepMs: state.sweepMs,
      ident: ident,
      identSource: who.source,
      seat: seated,                 // 'offerer' | 'answerer' | null (pre-handshake)
      mark: fx.replica.mark,        // the mark this host plays right now (X until seated O)
      link: {
        state: link ? link.state : 'unavailable',
        channel: (link && link.channelLabel) || null,
        lastPingAt: (link && link.lastPingAt) || null,
        pingCount: pingCount,
        pingMs: PING_MS,
        error: linkError ? linkError.message : null
      },
      net: { probeSeq: probeSeq, seenCount: net ? net.seenCount : null },
      courier: { name: o.courier.name || 'unnamed' },
      notes: notes.slice(0, 12),
      canProbe: !!(net && link && link.state === 'linked'),
      // the board I am broadcasting as my live focus (null until focus() is
      // called). A skin marks this board `board--mine-focus` so the player can
      // see what they are announcing; the teammate highlight itself rides
      // state.plan (board--teammate-here), painted from received presence.
      myBoard: myBoard,
      teammateCount: Object.keys(presenceByPlayer).length
    };
  }

  function repaint() { if (skin && typeof skin.render === 'function') skin.render(view()); }

  const api = {
    view: view,
    repaint: repaint,
    fixture: fx,
    state: state,
    ident: ident,
    identSource: who.source,
    link: link,
    net: net,
    linkError: linkError,
    timer: timer,

    /* onMatchEnvelope(fn) — register the host's live-game handler. The ONE
     * envelope ear routes DEAL/CLAIM here so the host owns adopt + verifyClaim/
     * applyReveal + its ownersMap + repaint, and the shell stays UI-free. Pass a
     * non-function (or null) to unregister. */
    onMatchEnvelope: function (fn) { matchHook = (typeof fn === 'function') ? fn : null; return api; },

    /* focus(board) — declare which board I am working RIGHT NOW. Emits a
     * PRESENCE envelope to same-team peers ON CHANGE ONLY: re-declaring the same
     * board is a no-op, so a repaint (which fires constantly) never spams the
     * wire. The host calls this from whatever means "I switched boards" on its
     * surface (the tab's board picker). WHERE I am is broadcast; nothing about
     * WHAT I am doing there. */
    focus: function (board) {
      if (!Number.isInteger(board) || board < 1 || board > 9) {
        note('focus refused: board ' + String(board) + ' out of range'); return false;
      }
      if (board === myBoard) return false;    // emit on CHANGE only
      myBoard = board;
      emitPresence();
      repaint();
      return true;
    },
    offer: function () {
      if (!link) return Promise.reject(new Error(note('no link: ' + (linkError ? linkError.message : 'unknown'))));
      return link.offer().then(function (r) {
        note('offer made');
        seat('offerer');                                // I offered -> I am X
        if (link.state === 'linked') emitPresence();   // announce my held focus the moment we link
        repaint(); return r;
      }).catch(function (e) { note('offer failed: ' + e.message); repaint(); throw e; });
    },
    pump: function () {
      if (!link) return Promise.reject(new Error(note('no link')));
      return link.pump().then(function (kind) {
        note(kind ? 'pumped a ' + kind : 'nothing admissible waiting');
        if (kind === 'OFFER') seat('answerer');         // I answered an offer -> I am O
        if (link.state === 'linked') emitPresence();   // announce my held focus the moment we link
        repaint(); return kind;
      }).catch(function (e) { note('pump failed: ' + e.message); repaint(); throw e; });
    },
    /* THE PROBE ID. net.js:93 refuses without one, in those words. Sequence plus
     * the persistent machine id, so a probe is traceable to a machine that still
     * exists after a refresh -- the same reason the id is stored at all. */
    probe: function () {
      if (!net) { note('no net'); return null; }
      const probeId = ident.id + ':' + (++probeSeq);
      try {
        const sent = net.flood(probeId);
        note('flooded probe ' + probeId + ' out ' + sent.length + ' side(s)');
        repaint();
        return probeId;
      } catch (e) { probeSeq--; note('flood failed: ' + e.message); repaint(); return null; }
    },
    /* Forgetting is the honest counterpart of remembering. It does NOT re-mint in
     * place -- a remount does that -- so the identity on screen never disagrees
     * with the one the link was built on. */
    forget: function () { const ok = forgetIdentity(storage); note(ok ? 'forgotten' : 'nothing to forget'); repaint(); return ok; },
    note: note
  };

  note('shell up · identity ' + who.source + ' · courier ' + (o.courier.name || 'unnamed') +
       (linkError ? ' · LINK UNAVAILABLE: ' + linkError.message : ' · link ready'));
  repaint();
  return api;
}

const __api = {
  mount,
  buildFixture,
  buildState,
  resolveIdentity,
  forgetIdentity,
  IDENT_KEY,
  CANNED,
  SEED,
  SEATS,
  seatReplica,
  /* 2-part MAJOR.MINOR (C15). 1.4: the match hook (W5-x, Option A) — the ONE
   * envelope ear now routes DEAL/CLAIM to a host-registered onMatchEnvelope hook
   * (adopt / verifyClaim+applyReveal / record / repaint live in the host), so a
   * tab host gains a real shared match while the shell stays UI-free. Same single
   * ear extended; PRESENCE routing unchanged. 1.3: the seat-only reseat — offer()/pump() resolve
   * a role and seatReplica rebuilds the fixture replica to that role's mark on the
   * fixture's OWN deal (offerer X / answerer O), so two hosts stop both coming up
   * X. No shared deal, no claim crossing — the practice-board banner stays. 1.2:
   * the presence live loop — focus() emits my board on change, onEnvelope routes
   * received PRESENCE into the teammate map and rebuilds. Engine untouched. */
  _version: '1.4'
};

  if (typeof module !== 'undefined' && module.exports) module.exports = __api;
  else {
    root.Battleganza = root.Battleganza || {};
    root.Battleganza.Shell = __api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
