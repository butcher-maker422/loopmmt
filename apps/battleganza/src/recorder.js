/* battleganza/recorder.js — S1. The playtest instrumentation recorder.
 *
 * Closes owed `battleganza-s1-playtest-instrumentation-unbuilt` (seq 1144): the
 * S1 slot note ends with a build instruction — "Instrument from playtest one,
 * zero design surface: time-to-first-claim, unlocked-cells-per-claim keyed by
 * board, unprompted-notice + boards-visible counts." Nothing in battleganza/
 * captured any of it, so a playtest would run blind and could not separate
 * "the map is boring" from "the map lost the sightline" — the exact confound
 * `battleganza-c2-pre-registration-v1.md` exists to prevent (§3 D1–D4).
 *
 * WHAT THIS IS. A passive, side-effect-free observer with ZERO design surface.
 * It renders nothing, changes no game behaviour, and adds no wire type. The host
 * calls one method at each seam it already has; the recorder stamps a time and
 * appends one event to an ordered log. A playtest leaves the log behind
 * (`record()`); the four C-2 numbers are a FOLD over that log (`metrics()`),
 * not four separate instruments — derive the metrics, don't re-instrument.
 *
 * WHY IT IS SEPARATE FROM THE BUS. Focus is `logged: false` by operator ruling
 * (S01.0300, bus.js): retaining a stream of focus changes would drown the claim
 * log, which exists for abuse adjudication, not attention analysis. So boards-
 * visible cannot be read off the match record — it must be captured here, in a
 * record that is NOT the match record. The claim log stays clean; the playtest
 * telemetry lives in its own artifact.
 *
 * THE PEER-TO-PEER SEAM (why the gift is on the notice, not the claim). In the
 * standalone 1v1, each host holds its own replica. A host knows the size of a
 * reveal only for gifts it RECEIVES (its own `applyReveal` receipt); it cannot
 * know what its outgoing claim unlocked on the opponent's board. So each host
 * records its own outgoing `claim`s (authorship, board, timing) and the
 * `notice`s it receives (the receipt: filled/unlocked/worthless, keyed by the
 * board the gift hit). Reviewing both hosts' logs together shows the whole
 * match. `unlocked-cells-per-claim keyed by board` folds from notices (receipts);
 * `time-to-first-claim` folds from own claims.
 *
 * CLOCK INJECTED ON PURPOSE. `clock()` defaults to Date.now but is injectable so
 * a headless witness is deterministic — run-suites.js treats anything short of
 * 100% over N samples as broken, and a wall-clock recorder would flake.
 *
 * PURE-ISH: no I/O, no DOM, no sockets. Mirrors bus.js's own posture.
 */

'use strict';

/* BATTLEGANZA-DUAL-EXPRESSION — node: module.exports · browser: root.Battleganza.Recorder */
(function (root) {

class RecorderError extends Error {}

/* The event kinds, and the exact C-2 signal each one feeds:
 *   match-start  — t0, the baseline for time-to-first-claim (§6 falsifier)
 *   claim        — an own, accepted claim: feeds time-to-first-claim + claims-by-board
 *   notice       — an incoming opponent reveal on MY board, with its receipt:
 *                  feeds unprompted-notice (D2) AND unlocked-cells-per-claim-by-board (D1)
 *   view         — a board-focus change: feeds boards-visible (D1 hunting phase)
 *   mega         — the whole-map view opened (a consult): feeds boards-visible (D1)
 *   match-end    — terminal, carries the winner
 */
const KINDS = Object.freeze(['match-start', 'claim', 'notice', 'view', 'mega', 'match-end']);

function createRecorder(opts) {
  const o = opts || {};
  const clock = (typeof o.clock === 'function') ? o.clock : Date.now;
  const events = [];
  let seq = 0;
  let started = false;
  let ended = false;

  function push(kind, fields) {
    if (KINDS.indexOf(kind) === -1) throw new RecorderError('unknown event kind: ' + String(kind));
    const ev = Object.assign({ seq: ++seq, t: clock(), kind: kind }, fields);
    events.push(Object.freeze(ev));
    return ev;
  }

  const api = {
    /* start(config) — the match began. One per recorder; a second is a no-op
     * that is flagged, because two starts would corrupt every t0-relative fold. */
    start: function (config) {
      if (started) throw new RecorderError('start called twice — t0 is already fixed');
      started = true;
      return push('match-start', { config: config || null });
    },

    /* claim(env) — MY own accepted claim went out. `env` is the CLAIM envelope
     * (player/team/board/box/mark). Only accepted claims should reach here; a
     * refused claim never entered the match and is not part of the record. */
    claim: function (env) {
      if (!env || env.type !== 'CLAIM') throw new RecorderError('claim() needs a CLAIM envelope');
      return push('claim', {
        player: env.player, team: env.team || null,
        board: env.board, box: env.box, mark: env.mark || null,
      });
    },

    /* notice(env, receipt) — an opponent's claim landed on MY board unbidden.
     * `receipt` is this host's applyReveal receipt { filled, unlocked, worthless }.
     * This is the D2 "unprompted notice" AND the source of the by-board gift size. */
    notice: function (env, receipt) {
      if (!env || env.type !== 'CLAIM') throw new RecorderError('notice() needs the opponent CLAIM envelope');
      const r = receipt || {};
      return push('notice', {
        by: env.player, board: env.board, box: env.box, mark: env.mark || null,
        filled: (r.filled | 0), unlocked: (r.unlocked | 0), worthless: !!r.worthless,
      });
    },

    /* view(player, board) — the player switched the board they are working. */
    view: function (player, board) {
      return push('view', { player: player, board: board });
    },

    /* mega(player) — the player opened the whole-map (mega) view: a consult. */
    mega: function (player) {
      return push('mega', { player: player });
    },

    /* end(result) — the match is over. `result` may be a rules.evaluate() return
     * (reads `.winner`) or a plain { winner }. */
    end: function (result) {
      if (ended) throw new RecorderError('end called twice');
      ended = true;
      const winner = (result && 'winner' in result) ? result.winner : (result || null);
      return push('match-end', { winner: winner });
    },

    /* record() — the reviewable, ordered event log a playtest leaves behind.
     * Frozen; this is the artifact, not a live handle. */
    record: function () {
      return Object.freeze(events.slice());
    },

    /* metrics() — the C-2 fold over the record. Pure; recomputable at any time.
     * Per-player where the signal is per-player; the match-level fields at top. */
    metrics: function () {
      const start = events.find((e) => e.kind === 'match-start') || null;
      const endEv = events.find((e) => e.kind === 'match-end') || null;
      const t0 = start ? start.t : null;

      // Discover the players named anywhere in the record (own claims, views, megas).
      const players = [];
      const seen = Object.create(null);
      for (const e of events) {
        const p = (e.kind === 'claim' || e.kind === 'view' || e.kind === 'mega') ? e.player : null;
        if (p != null && !seen[p]) { seen[p] = true; players.push(p); }
      }

      const perPlayer = {};
      for (const p of players) {
        // time-to-first-claim: first own accepted claim, relative to t0. null if
        // the player never claimed — the §6 difficulty-vs-frame falsifier's null.
        const firstClaim = events.find((e) => e.kind === 'claim' && e.player === p) || null;
        const ttfc = (firstClaim && t0 != null) ? (firstClaim.t - t0) : null;

        // claims-by-board (which board each own claim landed on).
        const claimsByBoard = {};
        for (const e of events) {
          if (e.kind === 'claim' && e.player === p) {
            claimsByBoard[e.board] = (claimsByBoard[e.board] | 0) + 1;
          }
        }

        // boards-visible: distinct boards viewed, view count, mega-open count, and
        // the ORDER (so D1's hunting-phase vs collapse-to-1 signature is readable).
        const sequence = [];
        const distinctBoards = Object.create(null);
        let views = 0, megaOpens = 0;
        for (const e of events) {
          if (e.kind === 'view' && e.player === p) { views++; distinctBoards[e.board] = true; sequence.push(e.board); }
          else if (e.kind === 'mega' && e.player === p) { megaOpens++; sequence.push('mega'); }
        }

        perPlayer[p] = {
          timeToFirstClaim: ttfc,
          claimsByBoard: claimsByBoard,
          boardsVisible: {
            distinct: Object.keys(distinctBoards).length,
            views: views,
            megaOpens: megaOpens,
            sequence: sequence,
          },
        };
      }

      // unlocked-cells-per-claim keyed by board — folds from the notices a host
      // received (the receipts), keyed by the board the gift hit. Recipient-scoped:
      // in 1v1 there is exactly one receiver, so this is that host's received gifts.
      const unlockedByBoard = {};
      let noticeCount = 0, noticeResponded = 0;
      const noticeDetail = [];
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        if (e.kind !== 'notice') continue;
        noticeCount++;
        const b = e.board;
        if (!unlockedByBoard[b]) unlockedByBoard[b] = { count: 0, totalUnlocked: 0, totalFilled: 0, worthless: 0 };
        const cell = unlockedByBoard[b];
        cell.count++; cell.totalUnlocked += e.unlocked; cell.totalFilled += e.filled;
        if (e.worthless) cell.worthless++;
        // D2: was this notice followed, anywhere later in the record, by a mega
        // consult or a board switch? That is the "attention moved" signal.
        let responded = false;
        for (let j = i + 1; j < events.length; j++) {
          if (events[j].kind === 'mega' || events[j].kind === 'view') { responded = true; break; }
        }
        if (responded) noticeResponded++;
        noticeDetail.push({ seq: e.seq, board: b, unlocked: e.unlocked, responded: responded });
      }
      for (const b of Object.keys(unlockedByBoard)) {
        const c = unlockedByBoard[b];
        c.meanUnlocked = c.count ? (c.totalUnlocked / c.count) : 0;
      }

      return {
        players: players,
        perPlayer: perPlayer,
        unlockedByBoard: unlockedByBoard,
        notices: { count: noticeCount, respondedCount: noticeResponded, detail: noticeDetail },
        matchEnd: endEv ? { winner: endEv.winner, t: endEv.t } : null,
        durationMs: (endEv && t0 != null) ? (endEv.t - t0) : null,
      };
    },
  };

  return Object.freeze(api);
}

const __api = { createRecorder, RecorderError, KINDS, _version: '1.0' };

  if (typeof module !== 'undefined' && module.exports) module.exports = __api;
  else {
    root.Battleganza = root.Battleganza || {};
    root.Battleganza.Recorder = __api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
