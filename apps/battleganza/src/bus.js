/* battleganza/bus.js — S1/B3. The claim bus.
 *
 * §5.1: "That is a MESSAGE BUS, not a distributed database. No CRDT, no
 * operational transform, no conflict resolution, no server-side solver
 * arbitration." This file is the whole server, and it is small on purpose.
 *
 * The six server responsibilities (§5.1), and where each one lives:
 *   1. Deal nine puzzles + the config       -> `createMatch` holds them; B2 deals.
 *   2. Validate a claim against the dealt
 *      solution -- A LOOKUP, NOT A SOLVE    -> `match.validateClaim` (B2).
 *   3. Broadcast it (Fanout #15;
 *      Dead Letter #28 on delivery failure) -> `fanout` + `deadLetters`.
 *   4. Relay two chat channels              -> the same fanout, different row.
 *   5. Evaluate the declared ruleset        -> `rules.evaluate` (B1), unchanged.
 *   6. Serve the claim log -- "(3)'s own
 *      stream, ordered. Not a subsystem:
 *      a read."                             -> `claimLog()` FILTERS `stream`.
 *
 * Reuse rank 1 (§5.2), directly: typed message envelope + DISPATCH TABLE
 * (`CBX_MSG`/`NET_MSG`, Loop 2.1). The routing rules below are DATA -- one row
 * per wire type, each naming its validator and its recipient predicate. There is
 * exactly one fanout implementation and it does not branch on type. Adding a
 * fourth wire type is a table row plus an allowlist entry, never an `if`.
 *
 * The table's keys are asserted equal to `boundary.WIRE_TYPES` at load. A type
 * that can cross the wire but has no route -- or a route for a type that cannot
 * cross -- is a construction error, not a runtime surprise.
 *
 * PURE-ISH: no I/O, no sockets, no clock. Subscribers supply a `deliver`
 * function; the transport is somebody else's problem, which is the point. `t` is
 * passed in. A match is replayable from `{deal, config, stream}` alone.
 */

'use strict';

/* BATTLEGANZA-DUAL-EXPRESSION — node: module.exports · browser: root.Battleganza.Bus */
(function (root) {
const B = (typeof require === 'function') ? require('./boundary.js') : root.Battleganza.Boundary;
const R = (typeof require === 'function') ? require('./rules.js') : root.Battleganza.Rules;
const M = (typeof require === 'function') ? require('./match.js') : root.Battleganza.Match;

class BusError extends Error {}

// ---------------------------------------------------------- the routing table --
//
// One row per wire type. `recipients` is a predicate over (subscriber, envelope)
// -- NOT a branch inside fanout. `logged` marks the rows that are part of the
// match record; chat is relayed, never recorded (§3.6 -- and a chat archive is a
// moderation surface nobody asked for).

const everyone = () => true;
const sameTeam = (sub, env) => sub.team === env.team;

const ROUTES = Object.freeze({
  CLAIM: Object.freeze({
    validate: (match, env) => {
      if (!M.validateClaim(match.deal, env)) return 'values do not match the dealt solution';
      const k = env.board + ':' + env.box;
      if (match.claimed.has(k)) return 'box ' + k + ' is already claimed';
      return null;
    },
    commit: (match, env) => { match.claimed.set(env.board + ':' + env.box, env.mark); },
    recipients: everyone,
    logged: true,
  }),
  CHAT_TEAM: Object.freeze({
    validate: (match, env) => (typeof env.text === 'string' && env.text.length ? null : 'empty chat text'),
    commit: null,
    recipients: sameTeam,
    logged: true,     // operator call S25.1544: chat is RETAINED. See `transcript`.
  }),
  CHAT_MATCH: Object.freeze({
    validate: (match, env) => (typeof env.text === 'string' && env.text.length ? null : 'empty chat text'),
    commit: null,
    recipients: everyone,
    logged: true,     // operator call S25.1544: chat is RETAINED. See `transcript`.
  }),
  /* DEAL (W5-f, S26.2024) — routed, and routed to a REFUSAL. That is not a
   * loophole in the guard above; it is the honest answer.
   *
   * A deal does not happen INSIDE a match, it is what a match is created FROM:
   * `createMatch({ deal, config })` takes it as an argument. So a DEAL arriving
   * at a live match's `submit` is a caller error every single time, and the
   * right response is to say so out loud and shelve it on the dead letter pile
   * where the operator can see it (#28) — not to fan it out, not to log it into
   * the match record, and NOT to quietly do nothing.
   *
   * The alternative was to teach `assertRoutesCoverWire` about an
   * exempt-from-routing set. That trades a total invariant ("the enum and the
   * routing table are ONE set") for a list of exceptions, and the first
   * exception is the one that makes the second one easy. A row that refuses
   * costs four lines and keeps the invariant total. */
  DEAL: Object.freeze({
    validate: () => 'a DEAL establishes a match, it is not an event inside one '
                  + '-- pass it to createMatch({ deal }), not submit()',
    commit: null,
    recipients: () => false,
    logged: false,
  }),
  /* PRESENCE (S2, dial 9 / D-17) — a teammate's live board focus.
   *
   * recipients: sameTeam. An opponent NEVER hears where you are; that is the
   * fog rule at the routing layer, mirroring the board-level field allowlist at
   * the boundary layer. (The sender is same-team-as-self and so receives their
   * own presence back; the view-model drops self, exactly as it drops self from
   * the highlight — the bus routes by team, the fold applies self-exclusion.)
   *
   * logged: false — OPERATOR CALL S01.0300 (Crossroads, choice B): teammate
   * PRESENCE is EPHEMERAL live focus, NOT part of the retained match record.
   * The record exists for abuse adjudication (S25.1544), which board-level focus
   * has no bearing on; retaining a stream of focus changes would drown that
   * surface in flicker for zero adjudication value. This makes PRESENCE the
   * first accepted-but-unlogged route — safe because its boundary field
   * allowlist is board-level ONLY, so nothing below board resolution is ever in
   * a presence event and nothing below board resolution is dropped from the
   * record (A5c proves this). commit: null — a relay, it mutates no match state. */
  PRESENCE: Object.freeze({
    validate: (match, env) =>
      (Number.isInteger(env.board) && env.board >= 1 && env.board <= 9)
        ? null
        : 'presence board must be an integer 1-9',
    commit: null,
    recipients: sameTeam,
    logged: false,
  }),
});

// The enum and the routing table are ONE set or the bus has a hole in it.
(function assertRoutesCoverWire() {
  const routed = Object.keys(ROUTES).sort().join(',');
  const wire = B.WIRE_TYPES.slice().sort().join(',');
  if (routed !== wire) {
    throw new BusError('routing table and wire allowlist disagree: [' + routed + '] vs [' + wire + ']');
  }
})();

// ------------------------------------------------------------------ the match --

/**
 * createMatch({ deal, config }) -> a match. Holds the deal, the frozen config,
 * the subscriber list, the ordered stream, and the dead letter shelf. Nothing
 * else. There is no game state here -- the game state is on nine replicas per
 * player, which is the whole architecture (§5.1, "no authoritative shared state").
 */
function createMatch(opts) {
  const o = opts || {};
  if (!o.deal || !Array.isArray(o.deal.boards)) throw new BusError('createMatch needs a deal');
  return {
    deal: o.deal,
    config: o.config || R.createMatchConfig({}),
    subscribers: [],
    stream: [],        // the RETAINED record: `logged` rows only, in server order.
    claimed: new Map(),// board:box -> mark. First claim wins.
    dead: [],          // Dead Letter #28. Held for the operator, never retried.
    seq: 0,
  };
}

/**
 * join(match, { player, team, deliver }) -> a subscriber handle.
 * `deliver(envelope, seq)` is called on fanout. It may throw; that is what the
 * dead letter is for.
 */
function join(match, sub) {
  const s = sub || {};
  if (typeof s.deliver !== 'function') throw new BusError('a subscriber needs a deliver function');
  if (!s.player) throw new BusError('a subscriber needs a player id');
  if (match.subscribers.some((x) => x.player === s.player)) {
    throw new BusError('player already joined: ' + s.player);
  }
  const handle = { player: s.player, team: s.team, deliver: s.deliver };
  match.subscribers.push(handle);
  return handle;
}

function leave(match, player) {
  const i = match.subscribers.findIndex((x) => x.player === player);
  if (i >= 0) match.subscribers.splice(i, 1);
  return i >= 0;
}

// ----------------------------------------------------------------- the fanout --

/**
 * fanout(match, envelope, seq) -> { delivered, deadLettered }
 *
 * Fanout #15, and the pattern's own constraint is the one that shapes this
 * function: "The producing tool must not know about or depend on its
 * subscribers... Each subscriber handles its own errors independently -- a
 * failure in Drift does not affect Tome. If a subscriber's failure should stop
 * the overall operation, it's not a fanout -- it's a workflow pipeline."
 *
 * So: no return value is read, no subscriber is awaited by another, and a throw
 * is caught PER SUBSCRIBER. The broadcast has already succeeded by the time
 * anyone fails; a failed delivery is one player's problem, not the match's.
 */
function fanout(match, envelope, seq) {
  const route = ROUTES[envelope.type];
  const to = [];
  let delivered = 0, deadLettered = 0;
  for (const sub of match.subscribers.slice()) {
    if (!route.recipients(sub, envelope)) continue;
    to.push(sub.player);   // addressed, whether or not the socket held
    try {
      sub.deliver(envelope, seq);
      delivered++;
    } catch (err) {
      // Dead Letter #28: "It is not discarded. It is not retried automatically.
      // It waits for the operator." Retrying a delivery to a subscriber that
      // just threw is how a bus turns one broken client into a broadcast storm.
      match.dead.push(Object.freeze({
        seq,
        player: sub.player,
        type: envelope.type,
        envelope,
        error: String(err && err.message ? err.message : err),
        attempts: 1,
      }));
      deadLettered++;
    }
  }
  return { delivered, deadLettered, to };
}

// ----------------------------------------------------------------- the submit --

/**
 * submit(match, envelope) -> a receipt.
 *
 *   { accepted, seq, reason, delivered, deadLettered }
 *
 * A REFUSAL and a DEAD LETTER are different animals and the distinction is
 * load-bearing. A refusal means the message was never legitimate -- a forged
 * claim, a box already taken -- so it never enters the stream and no one hears
 * it. A dead letter means the message was good and ONE recipient could not be
 * reached. Collapsing the two would put forged claims on the operator's
 * investigation shelf and hide real delivery failures among them.
 */
function submit(match, envelope) {
  if (!envelope || typeof envelope !== 'object') {
    return refuse('not an envelope');
  }
  const route = ROUTES[envelope.type];
  if (!route) return refuse('unroutable wire type: ' + String(envelope.type));

  // Defence in depth: boundary.encode already refused extra fields upstream, but
  // an envelope reaching the bus by another path gets checked here too. A guard
  // is only a guard if there is no ergonomic way around it.
  const allowed = B.WIRE_FIELDS[envelope.type];
  const extra = Object.keys(envelope).filter((k) => k !== 'type' && !allowed.includes(k));
  if (extra.length) return refuse('state would cross the boundary: ' + extra.join(', '));

  const why = route.validate(match, envelope);
  if (why) return refuse(why);

  // Every accepted message takes a seq -- ONE total order, so chat and claims
  // sort against each other. `logged` rows are RETAINED.
  //
  // OPERATOR CALL, S25.1544: chat IS retained. The reason is adjudication -- if
  // someone is abusive, the record has to exist when it is needed, and a record
  // you decide to start keeping after an incident is a record that does not
  // cover the incident. That is the whole argument and it beats the retention-
  // surface argument on the merits.
  //
  // What that obligates, and it is not free: the retained rows carry `to` -- the
  // ACTUAL delivery list at send time, not a predicate re-run later. Team
  // membership can change; "who could see this" must be answerable about the
  // moment it was said, or the transcript is evidence of the wrong thing.
  const seq = ++match.seq;
  if (route.commit) route.commit(match, envelope);

  const out = fanout(match, envelope, seq);
  if (route.logged) {
    match.stream.push(Object.freeze({ seq, envelope, to: Object.freeze(out.to) }));
  }
  return Object.freeze({
    accepted: true, seq, reason: null,
    delivered: out.delivered, deadLettered: out.deadLettered,
  });
}

function refuse(reason) {
  return Object.freeze({ accepted: false, seq: null, reason, delivered: 0, deadLettered: 0 });
}

// -------------------------------------------------------------------- the reads --

/**
 * claimLog(match) -> the ordered claim stream.
 * UNCHANGED by the chat-retention call: §3.6 fixes the claim log as "a pure fold
 * over the CLAIM stream," so chat entering the record must NOT enter this read.
 * The filter is what keeps those two facts from becoming one.
 * §5.1 responsibility 6, verbatim: "Serve the claim log -- which is (3)'s own
 * stream, ordered. NOT A SUBSYSTEM: A READ." So this is a filter over `stream`,
 * not a second array kept in step with it. Two stores that must agree are two
 * stores that will eventually disagree.
 */
function claimLog(match) {
  return match.stream
    .filter((r) => r.envelope.type === 'CLAIM')
    .map((r) => r.envelope);
}

/** The public score/territory state. B1's evaluator, unchanged, over the read above. */
function evaluate(match) {
  return R.evaluate(match.config, claimLog(match));
}

/**
 * transcript(match) -> the adjudication read. Operator call S25.1544.
 *
 * Chat is retained SO THAT abuse is answerable after the fact, which means this
 * read -- not the raw stream -- is the thing that has to be right. Each row
 * answers the four questions an adjudication actually asks:
 *
 *   who said it   -> player, team
 *   what          -> text (chat) or the board/box/mark taken (claim)
 *   when          -> seq (total order) and t (the client's stamp)
 *   WHO COULD SEE IT -> `to`, the delivery list AS IT WAS at send time
 *
 * That last one is why `to` is recorded rather than recomputed. A player who
 * switches teams mid-match would otherwise make an old team-chat line look like
 * it was said to the wrong room -- the transcript would be internally consistent
 * and wrong, which is worse than a gap.
 *
 * `scope` is derived, not stored: CHAT_TEAM is 'team', everything else 'match'.
 * A stored scope is a second copy of the route's own truth.
 */
function transcript(match) {
  return match.stream.map((r) => {
    const e = r.envelope;
    return Object.freeze({
      seq: r.seq,
      t: e.t,
      type: e.type,
      player: e.player,
      team: e.team,
      scope: e.type === 'CHAT_TEAM' ? 'team' : 'match',
      text: e.type === 'CLAIM' ? null : e.text,
      took: e.type === 'CLAIM' ? { board: e.board, box: e.box, mark: e.mark } : null,
      to: r.to,
    });
  });
}

/**
 * chatOf(match, player) -> everything one player said, in order.
 * The shape a complaint arrives in ("look at what X was saying"). A derived
 * read over `transcript`, never a per-player store.
 */
function chatOf(match, player) {
  return transcript(match).filter((r) => r.player === player && r.text !== null);
}

/** Dead Letter #28: the shelf. The operator investigates; nothing here self-heals. */
function deadLetters(match) { return match.dead.slice(); }

/** Operator move: hand a held item back to the bus. Explicit, never automatic. */
function reprocess(match, index) {
  const item = match.dead[index];
  if (!item) throw new BusError('no dead letter at index ' + index);
  const sub = match.subscribers.find((x) => x.player === item.player);
  if (!sub) return { ok: false, reason: 'subscriber is gone: ' + item.player };
  try {
    sub.deliver(item.envelope, item.seq);
    match.dead.splice(index, 1);
    return { ok: true };
  } catch (err) {
    match.dead[index] = Object.freeze(Object.assign({}, item, {
      attempts: item.attempts + 1,
      error: String(err && err.message ? err.message : err),
    }));
    return { ok: false, reason: 'still failing' };
  }
}

/** Operator move: drop a held item deliberately. The other half of #28. */
function discard(match, index) {
  if (!match.dead[index]) throw new BusError('no dead letter at index ' + index);
  return match.dead.splice(index, 1)[0];
}

/**
 * replay(match) -> a fresh replica caught up to now, for any player.
 * The determinism claim (§5.2 rank 7) made checkable: deal + ordered stream is
 * sufficient to reconstruct a board. If this ever diverges from a live replica,
 * something is holding state that the stream does not carry -- which would mean
 * the architecture's central claim is false.
 */
function replay(match, identity) {
  const r = M.createReplica(match.deal, identity);
  for (const env of claimLog(match)) M.applyReveal(r, env);
  return r;
}

const __api = {
  ROUTES, BusError,
  createMatch, join, leave,
  submit, fanout,
  claimLog, transcript, chatOf, evaluate, deadLetters, reprocess, discard, replay,
  _version: '1.2',
};

  if (typeof module !== 'undefined' && module.exports) module.exports = __api;
  else {
    root.Battleganza = root.Battleganza || {};
    root.Battleganza.Bus = __api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
