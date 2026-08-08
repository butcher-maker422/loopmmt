/* Shea's Forest — the App Shell · shell/mail-spam-view.js
   SPAM VIEW — email-app #10 (the email-views line · the render layer).

   THE VIEW. A one-word "Spam" view over the SPAM label the model ALREADY carries
   (X-GM-Labels, leg 10). It draws no new data and changes no model: it is a pure
   predicate + filter that the list region wires at ONE seam — exactly the read-later
   view-word pattern the strip already runs. Turning it on narrows the list to the
   messages Gmail flagged as spam; turning it off restores the resting mailbox.

   SEPARATION (the-clearing / two-rivers idiom): this module reads NO mailbox of its
   own and calls NO model — the host hands it the messages already in hand and it
   returns the SPAM subset. So it has no path to invent a message, a count, or a
   network call. The label read is a pure lookup on m.labels (an array of uppercase
   Gmail label ids); a message with no label state (an mbox archive — labels [] or
   absent) is never spam here (honest: unknown label state is not spam, flag-don't-fake).

   READ-ONLY on the model (the email-views Joint Contract): this file lives entirely
   in the render layer. It never touches the parity-twin model, the runtime, or the
   renderer's exports — it self-registers on window.ForestShell and is wired at one
   call site in buildMailboxView's paint() filter, the same way read-later is.

   Plain script (no ES module, no deps) — attaches to window.ForestShell.mailSpamView.
   Cold-safe throughout: null / undefined / non-array in -> [] or 0 / false out,
   never throws. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  // The canonical Gmail label id the model carries in m.labels for spam-flagged mail.
  var LABEL = "SPAM";

  // isSpam(m) -> does this message carry the SPAM label? A pure read of m.labels.
  // No labels / no label state (mbox) / a bad shape -> false (never a guess).
  function isSpam(m) {
    if (!m) return false;
    var labels = m.labels;
    if (!labels || typeof labels.indexOf !== "function") return false;
    return labels.indexOf(LABEL) !== -1;
  }

  // filter(messages) -> the SPAM subset of the mailbox in hand, order preserved.
  // Returns a NEW array (never mutates the input); null / non-array -> [].
  function filter(messages) {
    if (!messages || typeof messages.filter !== "function") return [];
    return messages.filter(isSpam);
  }

  // count(messages) -> how many carry SPAM. The host uses this to OFFER the view only
  // when there is spam to show (an honest affordance — no always-empty Spam view on a
  // mailbox that carries none). A zero is a true count, returned honestly.
  function count(messages) { return filter(messages).length; }

  root.mailSpamView = { LABEL: LABEL, isSpam: isSpam, filter: filter, count: count };
})();
