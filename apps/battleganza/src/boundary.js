'use strict';
/**
 * Battleganza — S1/B1: the match boundary.
 * DP-025 v4 §5.1 (message bus, not a distributed database), §5.3 acceptance
 * condition C-7/D-18: "no state crosses the match boundary except the CLAIM
 * event and the two chat relays -- ASSERTED BY TEST, NOT INSPECTION."
 *
 * This module is the only legal exit from a match. Everything that leaves goes
 * through `encode`, and `encode` refuses anything not on the closed allowlist.
 * The allowlist is the assertion surface: a future feature that needs a new
 * wire type has to WIDEN THIS LIST, in a diff, on purpose -- which is the whole
 * point. D-18's "dock it later" becomes a port rather than a re-architecture
 * exactly to the degree that this list stays short.
 *
 * HONEST CEILING (§8, carried forward rather than quietly dropped): this proves
 * the boundary at the MODULE seam -- that the game module emits only these three
 * envelopes. It does not prove a future server or transport adds nothing of its
 * own, and it cannot see a side channel that bypasses `encode` entirely.
 *
 * ★ UPDATED S26.1823 -- THE TRANSPORT-LEVEL TEST NOW EXISTS. This block used to
 * end "the test that bites on THAT is a transport-level test, and it does not
 * exist yet." It is `battleganza/test-s1-e2e.js` §T. It does not read what this
 * module MEANT to emit; it reads what ACTUALLY ARRIVED at the far side's ear,
 * after a real handshake, over a real datachannel, through the sealed courier --
 * type allowlist, per-type FIELD allowlist (the stowaway-field leak), a raw-bytes
 * fog scan for grids/givens/solution/solvedByMe (D3), and the transport ear
 * checked separately so nothing falls into it unwatched. Mutation-bitten 4x.
 *
 * WHAT IS STILL NOT PROVEN, precisely: the harness's RTC is faithful to the
 * datachannel CONTRACT, not to a browser's implementation, and a real network
 * adds framing it has no opinion about. So the ceiling MOVED one layer out; it
 * did not disappear. Visibility, not immunity.
 *
 * ★ WIDENED S26.2024 — THREE TYPES BECAME FOUR, ON PURPOSE, IN A DIFF.
 * The list above says a new feature "has to WIDEN THIS LIST, in a diff, on
 * purpose -- which is the whole point." This is that diff, and here is the
 * purpose. Every host called `dealMatch()` independently, so two linked players
 * held two DIFFERENT sets of nine puzzles and were never in the same match
 * (found by the operator's first two-browser witness, S26.1938; the tell was a
 * receipt reading `unlocked -3`, which is arithmetically impossible on a shared
 * deal). `DEAL` is how one deal reaches both hands.
 *
 * WHAT DEAL MAY CARRY, and the line it does NOT cross: puzzles and their
 * difficulty. NOT solutions. The deal is PUBLIC by design (match.js:72) and the
 * fog rule (D3) is about GRIDS and SOLUTIONS — a player's private working state
 * and the answers — never about which nine puzzles everyone was dealt. That
 * distinction was free to ignore while nothing legitimate carried a puzzle; it
 * is load-bearing now, and `WIRE_NESTED` below is what makes it mechanical
 * instead of a comment.
 */

// The closed set. FIVE types, and the count is still the design claim.
//
// ★ WIDENED S01.0300 — FOUR BECAME FIVE, ON PURPOSE, IN A DIFF. `PRESENCE` is
// the S2 teammate-highlight channel over the wire (dial 9, D-17). Its whole
// design lives in its field allowlist below: a PRESENCE envelope may carry
// `board` and NOTHING BELOW IT. A presence that tried to smuggle a `box`, a
// `values` array, or any cell datum is refused by `encode` here, at the seam --
// so D-17's "WHERE a teammate is, never WHAT" is enforced at the BOUNDARY, not
// left to the fold to police. This is the same move DEAL made for solutions:
// the guard is the allowlist, and the allowlist is the design claim.
/* BATTLEGANZA-DUAL-EXPRESSION — node: module.exports · browser: root.Battleganza.Boundary */
(function (root) {
const WIRE_TYPES = Object.freeze(['CLAIM', 'CHAT_TEAM', 'CHAT_MATCH', 'DEAL', 'PRESENCE']);

// Per-type field allowlists. A field not named here does not cross.
const WIRE_FIELDS = Object.freeze({
  CLAIM:       Object.freeze(['player', 'team', 'board', 'box', 'mark', 'values', 't']),
  CHAT_TEAM:   Object.freeze(['player', 'team', 'text', 't']),
  CHAT_MATCH:  Object.freeze(['player', 'team', 'text', 't']),
  DEAL:        Object.freeze(['difficulty', 'boards', 't']),
  // PRESENCE — board-level ONLY. NO box, NO values, NO cell/digit. The absence
  // of 'box' from this list is the D-17 fog rule made mechanical: a teammate's
  // presence says which BOARD, and the wire will not carry finer than that.
  PRESENCE:    Object.freeze(['player', 'team', 'board', 't']),
});

/**
 * NESTED field allowlists — added S26.2024 with DEAL, and it is not decoration.
 *
 * DEAL is the FIRST wire type whose payload carries objects rather than scalars
 * and flat arrays. `encode` checked only TOP-LEVEL keys, which was total for the
 * first three types and is NOT total for this one: `{ boards: [{ board, puzzle,
 * givens, solution }] }` has exactly the three legal top-level keys, so a
 * top-level-only check waves all 729 solution digits straight through. That is
 * the same leak B4 caught at S25.1631, wearing a nesting.
 *
 * So the guard descends exactly one level, on a per-type, per-field allowlist.
 * A type with no entry here is unchanged in every respect.
 */
const WIRE_NESTED = Object.freeze({
  DEAL: Object.freeze({
    boards: Object.freeze(['board', 'puzzle', 'givens']),
  }),
});

class BoundaryError extends Error {}

/**
 * encode(type, payload) -> frozen envelope, or throws.
 * Extra fields are a HARD ERROR, not a silent strip: a silent strip would let
 * board state leak into a payload for months and only surface as a mystery.
 */
function encode(type, payload) {
  if (!WIRE_TYPES.includes(type)) {
    throw new BoundaryError('illegal wire type: ' + String(type));
  }
  const allowed = WIRE_FIELDS[type];
  const src = payload || {};
  const extra = Object.keys(src).filter((k) => !allowed.includes(k));
  if (extra.length) {
    throw new BoundaryError(
      'state would cross the match boundary: ' + type + ' carries ' + extra.join(', ')
    );
  }
  const out = { type };
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
  }

  /* One level down, for the types that declare it. Same rule, same hard error,
   * same reason: a silent strip would let a solution ride inside `boards` for
   * months and surface as "why does everyone already know the answers". */
  const nested = WIRE_NESTED[type];
  if (nested) {
    for (const field of Object.keys(nested)) {
      if (!Object.prototype.hasOwnProperty.call(out, field)) continue;
      const rows = out[field];
      if (!Array.isArray(rows)) {
        throw new BoundaryError(
          'malformed envelope: ' + type + '.' + field + ' must be an array'
        );
      }
      const allowedInner = nested[field];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || typeof row !== 'object') {
          throw new BoundaryError(
            'malformed envelope: ' + type + '.' + field + '[' + i + '] is not an object'
          );
        }
        const bad = Object.keys(row).filter((k) => !allowedInner.includes(k));
        if (bad.length) {
          throw new BoundaryError(
            'state would cross the match boundary: ' + type + '.' + field
            + '[' + i + '] carries ' + bad.join(', ')
          );
        }
      }
    }
  }

  /* CEILING, stated rather than buried: this freeze is SHALLOW, exactly as it
   * has always been for CLAIM.values. It is a stowaway-FIELD guard, not an
   * immutability guarantee — and the envelope is JSON.stringify'd by
   * `link.send` on the way out, so post-encode mutation is not the threat this
   * door is built against. */
  return Object.freeze(out);
}

/**
 * The claim the server validates by LOOKUP against the dealt solution (§5.1).
 * NOTE (found by test B3, S25.1525): this helper originally DESTRUCTURED its
 * argument, which silently dropped extra fields before `encode` ever saw them --
 * a convenience signature that quietly re-opened the exact hole `encode` exists
 * to close. It passes the raw payload through now. The guard is only a guard if
 * nothing gets to walk around it.
 */
function claim(payload) {
  return encode('CLAIM', payload);
}

/**
 * The deal, crossing to a peer. Feed it `match.serializePuzzles(deal)` — the
 * puzzles-only form. Feeding it `serializeDeal` (which carries solutions) is
 * refused by the nested allowlist above rather than politely stripped, which is
 * the entire reason that guard exists.
 *
 * RAW PASSTHROUGH, deliberately — same signature discipline as `claim`. A
 * destructuring convenience here would drop extra fields before `encode` saw
 * them and re-open the hole (the B3 finding, S25.1525).
 */
function deal(payload) {
  return encode('DEAL', payload);
}

/**
 * A teammate's live focus crossing to same-team peers (S2, dial 9 / D-17).
 * RAW PASSTHROUGH, same signature discipline as `claim`/`deal` — a destructuring
 * convenience would drop extra fields before `encode` saw them and re-open the
 * exact fog hole the board-level allowlist exists to close. Feed it
 * `{ player, team, board, t }`; a `box` or `values` is refused, not stripped.
 */
function presence(payload) {
  return encode('PRESENCE', payload);
}

const __api = {
  WIRE_TYPES, WIRE_FIELDS, WIRE_NESTED, BoundaryError, encode, claim, deal, presence,
  /* 2-part MAJOR.MINOR per the software versioning convention -- no patch
   * component. 1.4: PRESENCE wire type added (S2 teammate highlight). */
  _version: '1.4',
};

  if (typeof module !== 'undefined' && module.exports) module.exports = __api;
  else {
    root.Battleganza = root.Battleganza || {};
    root.Battleganza.Boundary = __api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
