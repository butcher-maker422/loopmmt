/* Shea's Forest — the App Shell · shell/mail-trash-view.js
   TRASH VIEW — email-app #29 (the trash line · the render layer).

   THE VIEW. A one-word "Trash" view over the TRASH label the model ALREADY carries
   (X-GM-Labels, leg 10) — the exact sibling of the Spam view (mail-spam-view.js).
   It draws no new data and changes no model: a pure predicate + filter the list
   region wires at ONE seam. Turning it on narrows the list to trashed messages;
   turning it off restores the resting mailbox.

   THE #29 REVERSAL, HONESTLY SCOPED. Trash is the operator + charter K1 reversal
   (, pick C) in its REVERSIBLE form only: the runtime `trash`/`untrash`
   verbs move mail to/from the TRASH label (recoverable), and permanent delete
   (messages.delete) is never wired. This module is the read side of that — it lists
   what is in the Trash so a trashed message can be found and RESTORED (untrash).

   THE HONEST DORMANCY (same as Spam). Gmail's default messages.list excludes TRASH,
   so trashed mail is in-hand only when a source carries it (an mbox import with TRASH
   labels, or a future `in:trash` fetch). Like the Spam view, this view is OFFERED
   only when there is trash to show (count > 0) — never an always-empty view-word. A
   live server-backed Trash listing is the same follow-on the Spam view carries.

   SEPARATION (the-clearing / two-rivers idiom): this module reads NO mailbox of its
   own and calls NO model — the host hands it the messages already in hand and it
   returns the TRASH subset. No path to invent a message, a count, or a network call.
   The label read is a pure lookup on m.labels (an array of uppercase Gmail label ids);
   a message with no label state (an mbox archive — labels [] or absent) is never in
   the Trash here (honest: unknown label state is not trash, flag-don't-fake).

   READ-ONLY on the model (the email-views Joint Contract): this file lives entirely
   in the render layer. It never touches the parity-twin model, the runtime, or the
   renderer's exports — it self-registers on window.ForestShell and is wired at one
   call site in buildMailboxView's paint() filter, the same way Spam is.

   Plain script (no ES module, no deps) — attaches to window.ForestShell.mailTrashView.
   Cold-safe throughout: null / undefined / non-array in -> [] or 0 / false out,
   never throws. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  // The canonical Gmail label id the model carries in m.labels for trashed mail.
  var LABEL = "TRASH";

  // isTrash(m) -> does this message carry the TRASH label? A pure read of m.labels.
  // No labels / no label state (mbox) / a bad shape -> false (never a guess).
  function isTrash(m) {
    if (!m) return false;
    var labels = m.labels;
    if (!labels || typeof labels.indexOf !== "function") return false;
    return labels.indexOf(LABEL) !== -1;
  }

  // filter(messages) -> the TRASH subset of the mailbox in hand, order preserved.
  // Returns a NEW array (never mutates the input); null / non-array -> [].
  function filter(messages) {
    if (!messages || typeof messages.filter !== "function") return [];
    return messages.filter(isTrash);
  }

  // count(messages) -> how many carry TRASH. The host uses this to OFFER the view only
  // when there is trash to show (an honest affordance — no always-empty Trash view on a
  // mailbox that carries none). A zero is a true count, returned honestly.
  function count(messages) { return filter(messages).length; }

  root.mailTrashView = { LABEL: LABEL, isTrash: isTrash, filter: filter, count: count };
})();
