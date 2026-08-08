/* Shea's Forest — the App Shell · shell/mail-attachment-filter.js
   HAS-ATTACHMENT FILTER — email-app #22a (the email-deepen line · the data-layer's view half).

   THE VIEW. A one-word "Has attachment" filter over the attachment state the model
   ALREADY carries (m.attachments — the clean [{filename,mimeType,size,attachmentId}]
   array the #9 ingest→model vertical lands). It draws no new data and changes no model:
   it is a pure predicate + filter the list region wires at ONE seam — exactly the
   spam / from-sender view-word pattern the strip already runs. Selecting it narrows the
   list to mail that carries a downloadable attachment; clearing it restores the mailbox.

   WHY THIS LINE OWNS THE MODULE. #22a filters the attachment state THIS line (email-deepen)
   added and shipped in #9 — so the predicate lives with the data it reads, in email-deepen's
   surface. The one-seam LIST-REGION WIRE (the Show-selector option + the paint() branch) is
   email-views' region (buildMailboxView), handed over by Baton — this module never reaches
   into the list/rail region itself (Joint Contract rule 4: a line files a Baton, it does not
   reach across).

   HONEST — flag-don't-fake. hasAttachment is true ONLY for a message whose m.attachments is a
   NON-EMPTY array. A message with no attachments (m.attachments === [] — the honest #9 shape on
   absence) is never matched, and the host OFFERS the view-word only when at least one message in
   hand carries an attachment (count > 0) — no always-empty view.

   SEPARATION (the-clearing / two-rivers idiom): this module reads NO mailbox of its own and calls
   NO model — the host hands it the messages already in hand and it returns the with-attachment
   subset (filter) or the count. So it has no path to invent a message, a count, or a network call.

   READ-ONLY on the model: this file lives entirely in the render layer. It never touches the
   parity-twin model, the runtime, or the renderer's exports — it self-registers on window.ForestShell
   and is wired at one call site in buildMailboxView's paint(), the same way spam / read-later / from are.

   Plain script (no ES module, no deps) — attaches to window.ForestShell.mailAttachmentFilter.
   Cold-safe throughout: null / undefined / non-array in -> honest false / [] / 0 out, never throws. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  // hasAttachment(m) -> true iff the message carries at least one downloadable attachment.
  // The model's #9 contract: m.attachments is a clean array ([] on absence). A non-array
  // (a pre-#9-shaped or malformed message) is treated as "no attachments" honestly (false),
  // never a throw — the resting/absent shape and junk both read false.
  function hasAttachment(m) {
    return !!(m && Array.isArray(m.attachments) && m.attachments.length > 0);
  }

  // filter(messages) -> the subset of the mailbox in hand that carries an attachment.
  // Returns a NEW array (never mutates input), order preserved. null / non-array in -> []
  // (cold-safe). The host applies this only while the "Has attachment" view-word is selected.
  function filter(messages) {
    if (!messages || typeof messages.filter !== "function") return [];
    return messages.filter(hasAttachment);
  }

  // count(messages) -> how many messages in hand carry an attachment. The host uses this as
  // the present-gate (offer the "Has attachment" view-word only when count > 0). A zero is a
  // true count (a mailbox with no attachment-bearing mail), returned honestly.
  function count(messages) {
    if (!messages || typeof messages.forEach !== "function") return 0;
    var n = 0;
    messages.forEach(function (m) { if (hasAttachment(m)) n++; });
    return n;
  }

  root.mailAttachmentFilter = { hasAttachment: hasAttachment, filter: filter, count: count };
})();
