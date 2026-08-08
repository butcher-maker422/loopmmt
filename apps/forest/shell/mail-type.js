/* Shea's Forest — the App Shell · shell/mail-type.js
   THE TYPE FUNCTION — email-app T3 (the Thing-list line,).

   WHAT IT IS. The three-valued discriminator that separates a LETTER from a NOTIFICATION.
   It is the gate on both `decline` (letters only) and `decay` (notifications only) — neither
   verb can be built until the app can tell them apart, and this is the telling-apart.

   THE CENTRAL IDEA — WE DO NOT GUESS, WE READ AN ADMISSION.
   A bulk sender publishes `List-Unsubscribe` (RFC 2369) and/or `List-Unsubscribe-Post: One-Click`
   (RFC 8058) because the law and the mailbox providers make them. When those headers are present,
   the sender is not being profiled — the sender is DECLARING that they are a mass mailer. That
   declaration, and nothing else, is the only route into the `notification` class.

   The model already carries both bits, verified end to end:
     gmail.js (emits the headers) -> mail-model.js:82 (parses) -> mail-model.js:105 (exposes
     `m.unsubscribe` : string and `m.oneClick` : boolean on every message object).
   So type(m) is a PURE FUNCTION OF FIELDS ALREADY ON THE MESSAGE. No new plumbing, no network,
   no model change, no AI, no heuristic, no judgment call.

   THE THREE VALUES.
     'notification'  the sender SELF-DECLARED (unsubscribe header and/or one-click present).
     'letter'        the residue. A letter is a message that no machine has claimed.
     'unknown'       we could not establish a sender at all (the model's honest-degrade shape,
                     mail-model.js:104 — a body with no recognizable header block). NEVER
                     silently collapsed into either of the other two.

   ⚠ THE SAFETY INVARIANT — this is the load-bearing property, and it is structural.
   `decayable(m)` is TRUE IF AND ONLY IF classify(m) === 'notification', i.e. iff the sender
   declared themselves. It is exported as its own named function precisely so that the future
   destructive verb (`decay`) has EXACTLY ONE predicate it can consult and cannot reach any other.

   The consequence, and it is the whole reason this shape was chosen:
     A HOSTILE SENDER WHO OMITS THE HEADER LANDS IN THE `letter` LANE.
     Gaming the classifier buys an attacker LESS silence, never more. The dangerous direction —
     a real letter being classified as disposable — is UNREACHABLE, because the only way in is a
     declaration the sender themselves had to make. The hard residue (a personalised sales mail,
     a real human at a company, a calendar invite) all falls to `letter`, where it is SEEN.
     Nothing is lost. The error mode is safe by construction, not by hope.
   (Dara's 3 AM test, : "write it as an invariant, not a hope." This is the invariant.)

   READ-ONLY, RENDER-LAYER, NO STATE. Reads `m.unsubscribe`, `m.oneClick`, `m.from` and nothing
   else. Touches no model, no runtime, no network, no store. It cannot invent a message, a count,
   or a call. Same separation contract as mail-attachment-filter / mail-spam-view / mail-from-chips.

   Plain script (no ES module, no deps) — attaches to window.ForestShell.mailType.
   Cold-safe throughout: null / undefined / junk in -> 'unknown' / [] / 0 out, never throws. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  var NOTIFICATION = "notification";
  var LETTER = "letter";
  var UNKNOWN = "unknown";

  // selfDeclared(m) -> true iff the SENDER published a bulk-mail header on this message.
  // Two bits, either one suffices (a sender may set List-Unsubscribe without one-click):
  //   m.unsubscribe : string  — RFC 2369 List-Unsubscribe. Honest empty ('') on absence.
  //   m.oneClick    : boolean — RFC 8058 List-Unsubscribe-Post: One-Click.
  // A non-string / non-boolean (malformed, pre-model, junk) reads FALSE — never a throw, and
  // never a route into the decayable class. Absence is not a declaration.
  function selfDeclared(m) {
    if (!m || typeof m !== "object") return false;
    var u = m.unsubscribe;
    var hasUnsub = (typeof u === "string" && u.trim() !== "");
    var hasOneClick = (m.oneClick === true);
    return hasUnsub || hasOneClick;
  }

  // classify(m) -> 'notification' | 'letter' | 'unknown'. Total, pure, order-critical:
  //   1. unreadable (null / non-object)          -> 'unknown'   (cold-safe floor)
  //   2. the sender DECLARED                     -> 'notification'  (the only route in)
  //   3. no sender establishable (from is empty) -> 'unknown'   (the model's honest-degrade shape;
  //                                                  we cannot tell, so we SAY we cannot tell)
  //   4. otherwise                               -> 'letter'    (the residue)
  // Step 2 precedes step 3 deliberately: a declaration is the sender's own admission and does not
  // depend on our being able to read their From line. Steps 1 and 3 are the two honest "I don't
  // know" exits — and neither of them is decayable.
  function classify(m) {
    if (!m || typeof m !== "object") return UNKNOWN;
    if (selfDeclared(m)) return NOTIFICATION;
    var from = m.from;
    if (typeof from !== "string" || from.trim() === "") return UNKNOWN;
    return LETTER;
  }

  function isNotification(m) { return classify(m) === NOTIFICATION; }
  function isLetter(m) { return classify(m) === LETTER; }
  function isUnknown(m) { return classify(m) === UNKNOWN; }

  /* ⚠ THE DESTRUCTIVE PREDICATE — the ONE gate `decay` may ever consult.
     decayable(m) is true IFF the sender declared themselves a mass mailer. It is deliberately a
     separate, named, individually-tested export rather than an inline `type === 'notification'`
     check at the call site, so that the destructive verb has exactly one door and no other. If a
     future change ever widens what may be destroyed, it MUST widen this function — where the test
     battery is watching — and cannot do it quietly at a call site. An 'unknown' is NEVER decayable.
     A 'letter' is NEVER decayable. There is no third route. */
  function decayable(m) { return classify(m) === NOTIFICATION; }

  // filter(messages, kind) -> the subset of the mailbox in hand of that kind. New array, order
  // preserved, never mutates. null / non-array / unrecognised kind in -> [] (cold-safe).
  function filter(messages, kind) {
    if (!messages || typeof messages.filter !== "function") return [];
    if (kind !== NOTIFICATION && kind !== LETTER && kind !== UNKNOWN) return [];
    return messages.filter(function (m) { return classify(m) === kind; });
  }

  // count(messages, kind) -> how many messages in hand are of that kind. The host reads this as
  // the present-gate. A zero is a true count, returned honestly.
  function count(messages, kind) {
    if (!messages || typeof messages.forEach !== "function") return 0;
    if (kind !== NOTIFICATION && kind !== LETTER && kind !== UNKNOWN) return 0;
    var n = 0;
    messages.forEach(function (m) { if (classify(m) === kind) n++; });
    return n;
  }

  // tally(messages) -> { notification, letter, unknown } in one pass. The host's cheap read for
  // the MIXED-mailbox gate below. Cold-safe: junk in -> all zeros.
  function tally(messages) {
    var t = { notification: 0, letter: 0, unknown: 0 };
    if (!messages || typeof messages.forEach !== "function") return t;
    messages.forEach(function (m) { t[classify(m)]++; });
    return t;
  }

  /* isMixed(messages) -> true iff the mailbox in hand actually CONTAINS a split — at least one
     notification AND at least one letter. This is the honest present-gate for the view-words, and
     it is a stricter rule than the sibling filters' `count > 0`, on purpose: a "Letters" chip over
     an all-letters mailbox is a control that DOES NOTHING (it would return the whole list). The
     precedent's principle is "never offer an always-empty control"; its dual is "never offer an
     always-full one." The split is only worth showing when there is a split. */
  function isMixed(messages) {
    var t = tally(messages);
    return t.notification > 0 && t.letter > 0;
  }

  root.mailType = {
    NOTIFICATION: NOTIFICATION,
    LETTER: LETTER,
    UNKNOWN: UNKNOWN,
    selfDeclared: selfDeclared,
    classify: classify,
    isNotification: isNotification,
    isLetter: isLetter,
    isUnknown: isUnknown,
    decayable: decayable,
    filter: filter,
    count: count,
    tally: tally,
    isMixed: isMixed
  };
})();
