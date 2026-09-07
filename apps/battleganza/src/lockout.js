'use strict';
/**
 * Battleganza — the wrong-guess lockout (D-43 / D-60, §3.5a).
 *
 * THE KEYSTONE. `boxIsSolved` is a free client-side correctness oracle, so a
 * box's real cost is arrangements-to-try, not deduction. Without a penalty a
 * box is brute-forceable at zero cost and THE ENTIRE DIFFICULTY SYSTEM IS
 * DECORATIVE (§3.5, §5 Inside Done Done). This module rate-limits wrong
 * submissions so exhaustive search is unprofitable, not merely slow.
 *
 * FIVE PROPERTIES, each traced to §3.5a's five constraints:
 *   1. It punishes SEARCH harder than DEDUCTION. The first wrong entry on a
 *      board is FREE (not cheap — free). An honest misread costs nothing.
 *   2. Exhaustive search is UNPROFITABLE, and the escalation does the work:
 *      GEOMETRIC ×3 after the free strike. The sketch (arithmetic escalation)
 *      failed because search cost grows FACTORIALLY; a geometric curve beats it.
 *   3. It DOES NOT LEAK (D-38). Strike count and expiry are CLIENT-LOCAL and
 *      never enter a claim message or any P2P payload. `boundary.js` enforces
 *      this by schema: no strike field is in WIRE_FIELDS.CLAIM, and the
 *      stowaway guard rejects any that try. A frozen player looks exactly like
 *      a thinking one under total fog.
 *   4. It runs on the MONOTONIC CLOCK (D-34): every time is ms-since-`Go!`,
 *      passed IN by the caller — this module never reads a wall clock — so it
 *      replays correctly through a reconnect, and a lockout SURVIVES a
 *      disconnect (deliberately: pulling the cable must not be a free reset).
 *   5. It DECAYS. One strike drops off per `decayMs` of quiet on that board;
 *      a successful box claim on that board resets the count to zero. A player
 *      who errs, waits out a small lockout, then plays honestly is clean within
 *      a few minutes; a brute-forcer never earns decay because they never stop.
 *
 * SCOPE: PER BOARD (operator, S27.1653). A wrong submission freezes input on
 * the board it happened on; every other board stays live. Per-box is escapable
 * in one click; global punishes eighty honest boards for one typo. Per-board is
 * the only scope where the cost lands where the abuse happened.
 *
 * THE SCHEDULE IS DIAL 11 (§3.7): `{ freeStrikes, baseMs, factor, decayMs }`
 * are match config so playtest tunes them without a build. SCOPE is NOT a dial
 * — per-board is ruled. The default is `0 free / 5s / ×3 / 90s`:
 *
 *   wrong #1 -> 0s (free) | #2 -> 5s | #3 -> 15s | #4 -> 45s | #5 -> 135s | #6 -> 405s
 *
 * PURITY. State is a plain `{ boards: { [board]: {strikes,lastWrongAt,lockUntil} } }`
 * object; every transition returns a NEW state and mutates nothing. This is the
 * fold-family discipline (rules.js) applied to client-local session state, and
 * it is what makes replay (property 4) a byte-identical re-fold rather than a
 * hope. UI state (the advisory indication) lives OUTSIDE this object, in the
 * skin — the L21 namespace discipline §3.7 adopts by name.
 *
 * This module is NOT read by the evaluator. `evaluate(config, claimLog)` folds
 * PUBLIC state only; the lockout is client-local, so adding dial 11 to the
 * config leaves the evaluator's fold byte-identical (asserted in test-lockout).
 */

/* BATTLEGANZA-DUAL-EXPRESSION — node: module.exports · browser: root.Battleganza.Lockout */
(function (root) {

// ------------------------------------------------------------- the schedule --
/**
 * lockoutMsFor(strikeNumber, dial) -> ms this Nth wrong entry costs.
 *
 * A pure function of the strike ordinal and the dial-11 config — no branch on a
 * game mode, exactly the "definitions-as-data read by one function" shape
 * rules.js uses for WIN_RULES. The first `freeStrikes` cost 0; thereafter the
 * cost is `baseMs · factor^(n - freeStrikes - 1)` — geometric, so it beats the
 * factorial growth of arrangements-to-try (§3.5a constraint 2).
 */
function lockoutMsFor(strikeNumber, dial) {
  if (strikeNumber <= dial.freeStrikes) return 0;
  const power = strikeNumber - dial.freeStrikes - 1;
  return dial.baseMs * Math.pow(dial.factor, power);
}

// ----------------------------------------------------------------- the state --
function initState() {
  return { boards: {} };
}

const FRESH = Object.freeze({ strikes: 0, lastWrongAt: 0, lockUntil: 0 });

function entryFor(state, board) {
  const e = state.boards[board];
  return e ? { strikes: e.strikes, lastWrongAt: e.lastWrongAt, lockUntil: e.lockUntil }
           : { strikes: FRESH.strikes, lastWrongAt: FRESH.lastWrongAt, lockUntil: FRESH.lockUntil };
}

/**
 * Apply decay to a copied entry AS OF `now`. One strike drops per `decayMs` of
 * quiet since the last wrong entry (§3.5a constraint 5). Partial windows carry:
 * `lastWrongAt` advances forward by exactly the windows consumed, so a strike
 * that is 89s old does not reset its clock when a query happens to land.
 * Never negative; a board at 0 strikes stays put.
 */
function settle(entry, now, dial) {
  if (entry.strikes <= 0) return entry;
  const quiet = now - entry.lastWrongAt;
  if (quiet < dial.decayMs) return entry;
  const drops = Math.floor(quiet / dial.decayMs);
  const strikes = Math.max(0, entry.strikes - drops);
  // Consume only the windows that actually dropped a strike; if the count
  // bottomed out, park the clock at `now` (fully clean, nothing pending).
  const consumed = Math.min(drops, entry.strikes) * dial.decayMs;
  const lastWrongAt = strikes === 0 ? now : entry.lastWrongAt + consumed;
  return { strikes, lastWrongAt, lockUntil: entry.lockUntil };
}

function withBoard(state, board, entry) {
  const boards = Object.assign({}, state.boards);
  boards[board] = entry;
  return { boards };
}

// ------------------------------------------------------------- transitions ----
/**
 * A wrong submission on `board` at `now`. Decays first (a slow, honest player
 * gets credit for the quiet), then adds the strike and sets the lock.
 */
function registerWrong(state, board, now, dial) {
  const settled = settle(entryFor(state, board), now, dial);
  const strikes = settled.strikes + 1;
  const lock = lockoutMsFor(strikes, dial);
  return withBoard(state, board, {
    strikes,
    lastWrongAt: now,
    lockUntil: lock > 0 ? now + lock : settled.lockUntil,   // a free strike never shortens a live lock
  });
}

/**
 * A successful box claim on `board` resets its strike count to zero (§3.5a
 * constraint 5). You cannot be locked and claim at the same time (input is
 * frozen while locked), so a claim clears the board clean.
 */
function registerClaim(state, board, now) {
  return withBoard(state, board, { strikes: 0, lastWrongAt: 0, lockUntil: 0 });
}

// ------------------------------------------------------------- read-only ------
/** Is `board` frozen at `now`? Absolute compare against the stored expiry. */
function isLocked(state, board, now) {
  return now < entryFor(state, board).lockUntil;
}

/** ms of lockout left on `board` at `now` — 0 if open. For the advisory tier. */
function remainingMs(state, board, now) {
  return Math.max(0, entryFor(state, board).lockUntil - now);
}

/** Decay-aware strike count on `board` at `now` — for stats/tests, never the wire. */
function strikeCount(state, board, now, dial) {
  return settle(entryFor(state, board), now, dial).strikes;
}

const __api = {
  lockoutMsFor,
  initState, registerWrong, registerClaim,
  isLocked, remainingMs, strikeCount,
  _version: '1.0',
};

  if (typeof module !== 'undefined' && module.exports) module.exports = __api;
  else {
    root.Battleganza = root.Battleganza || {};
    root.Battleganza.Lockout = __api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
