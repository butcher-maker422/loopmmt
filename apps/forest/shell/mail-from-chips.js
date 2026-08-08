/* Shea's Forest — the App Shell · shell/mail-from-chips.js
   FROM-SENDER FILTER — email-app #22b (the email-views line · the render layer).

   THE VIEW. A one-pick "From" filter over the sender the model ALREADY carries
   (m.from, the raw From header). It draws no new data and changes no model: it is a
   pure key + filter that the list region wires at ONE seam — exactly the Label-picker
   pattern the strip already runs. Picking a sender narrows the list to that sender's
   mail; clearing it restores the resting mailbox.

   ONE KEY, SHARED WITH "BY SENDER" (#4). The sender key is the trimmed raw m.from
   string — the SAME key the renderer's _groupSender clustering uses — so the From
   filter and the By-sender grouping never disagree about who a message is "from".
   Senderless mail (from === "") is NOT offered as a chip and never matches a pick:
   you cannot filter TO "no sender" honestly (flag-don't-fake — the group view shows
   the senderless bucket; the filter simply has nothing to select).

   SEPARATION (the-clearing / two-rivers idiom): this module reads NO mailbox of its
   own and calls NO model — the host hands it the messages already in hand and it
   returns the sender set (sendersOf) or the one-sender subset (filter). So it has no
   path to invent a message, a count, or a network call.

   READ-ONLY on the model (the email-views Joint Contract): this file lives entirely
   in the render layer. It never touches the parity-twin model, the runtime, or the
   renderer's exports — it self-registers on window.ForestShell and is wired at one
   call site in buildMailboxView's paint() filter, the same way spam / read-later are.

   Plain script (no ES module, no deps) — attaches to window.ForestShell.mailFromChips.
   Cold-safe throughout: null / undefined / non-array in -> [] out, never throws. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  // senderKey(m) -> the canonical sender key for a message: the trimmed raw From
  // header. Identical to _groupSender's key, so the filter and the "By sender"
  // grouping agree by construction. A missing / blank From -> "" (senderless).
  function senderKey(m) {
    if (!m || m.from == null) return "";
    return String(m.from).trim();
  }

  // sendersOf(messages) -> the distinct, sorted set of sender keys PRESENT in the
  // mailbox in hand (senderless excluded — it is not a selectable chip). The host
  // uses this to build the From picker's options and to OFFER the picker only when
  // there is a sender to pick (honest — no empty control on an empty mailbox).
  // Case-insensitive sort, but the ORIGINAL key casing is preserved for display + match.
  function sendersOf(messages) {
    if (!messages || typeof messages.forEach !== "function") return [];
    var seen = {}, keys = [];
    messages.forEach(function (m) {
      var k = senderKey(m);
      if (k === "") return;                 // senderless is never a chip
      if (!Object.prototype.hasOwnProperty.call(seen, k)) { seen[k] = true; keys.push(k); }
    });
    keys.sort(function (a, b) {
      var la = a.toLowerCase(), lb = b.toLowerCase();
      return la < lb ? -1 : la > lb ? 1 : 0;
    });
    return keys;
  }

  // filter(messages, sender) -> the subset of the mailbox in hand whose sender key
  // EXACTLY matches `sender`. Returns a NEW array (never mutates input), order
  // preserved. A blank / null sender, or null / non-array messages -> [] (cold-safe:
  // an unmatched or empty pick narrows to nothing rather than throwing — but the host
  // only applies the filter when a real sender is picked, so this is the honest floor).
  function filter(messages, sender) {
    if (!messages || typeof messages.filter !== "function") return [];
    var target = (sender == null) ? "" : String(sender).trim();
    if (target === "") return [];
    return messages.filter(function (m) { return senderKey(m) === target; });
  }

  // count(messages) -> how many DISTINCT senders are present. The host uses this as
  // the present-gate (offer the From picker only when count > 0). A zero is a true
  // count (an empty or wholly-senderless mailbox), returned honestly.
  function count(messages) { return sendersOf(messages).length; }

  // ---- multi-select (the removable-chip upgrade over the one-pick #22b) --------
  // The From filter grows from one-sender to a SET of senders: the list shows mail
  // from ANY selected sender (union). filter() is preserved for the one-pick call;
  // filterAny() is its set-valued sibling. Both stay pure key-filters over the raw
  // m.from the model already carries — read-only on the model, invent nothing.

  // filterAny(messages, senders) -> the subset of the mailbox in hand whose sender key
  // matches ANY key in `senders` (the union / OR-filter). Blank keys in the set are
  // ignored (senderless is never selectable). An empty / null set -> [] (honest floor:
  // nothing selected matches nothing; the host guards the call with currentFroms.length,
  // exactly as it guards the one-pick filter). New array, order preserved, never mutates.
  function filterAny(messages, senders) {
    if (!messages || typeof messages.filter !== "function") return [];
    if (!senders || typeof senders.forEach !== "function") return [];
    var set = {};
    senders.forEach(function (s) {
      var t = (s == null) ? "" : String(s).trim();
      if (t !== "") set[t] = true;
    });
    if (Object.keys(set).length === 0) return [];
    return messages.filter(function (m) {
      return Object.prototype.hasOwnProperty.call(set, senderKey(m));
    });
  }

  // toggle(senders, sender) -> a NEW active-set with `sender` added if absent, removed
  // if present (the chip add / remove logic). The key is trimmed (== senderKey), so a
  // padded pick toggles the same chip. A blank / null sender returns a copy unchanged
  // (you cannot toggle "no sender"). Order is add-order (a removed key re-added lands
  // last). Cold-safe: null / non-array senders -> a fresh set with just the new key.
  function toggle(senders, sender) {
    var out = (senders && typeof senders.slice === "function") ? senders.slice() : [];
    var t = (sender == null) ? "" : String(sender).trim();
    if (t === "") return out;
    var i = out.indexOf(t);
    if (i === -1) out.push(t); else out.splice(i, 1);
    return out;
  }

  // chipRow(doc, senders, onRemove) -> a DOM container of removable chips, one per
  // active sender: a `.chip .chip--lit .mail__from-chip` bearing the raw From key +
  // a `.chip__x` remove control that calls onRemove(sender) on click. Pure builder:
  // it reads no mailbox and holds no state — the host owns the set and re-calls this
  // after a toggle. Cold-safe: a bad doc or a non-array set -> an empty container (or
  // null when no doc is given), never throws. onRemove is optional (a static row).
  function chipRow(doc, senders, onRemove) {
    if (!doc || typeof doc.createElement !== "function") return null;
    var row = doc.createElement("div");
    row.className = "mail__from-chips";
    row.setAttribute("role", "list");
    row.setAttribute("aria-label", "Active sender filters");
    if (!senders || typeof senders.forEach !== "function") return row;
    senders.forEach(function (s) {
      var key = (s == null) ? "" : String(s).trim();
      if (key === "") return;
      var chip = doc.createElement("span");
      chip.className = "chip chip--lit mail__from-chip";
      chip.setAttribute("role", "listitem");
      var label = doc.createElement("span");
      label.className = "mail__from-chip-label";
      label.textContent = key;
      chip.appendChild(label);
      var x = doc.createElement("button");
      x.className = "chip__x mail__from-chip-x";
      x.setAttribute("type", "button");
      x.setAttribute("aria-label", "Remove sender filter " + key);
      x.textContent = "\u00d7";   // ×
      if (typeof onRemove === "function") {
        x.addEventListener("click", function () { onRemove(key); });
      }
      chip.appendChild(x);
      row.appendChild(chip);
    });
    return row;
  }

  root.mailFromChips = {
    senderKey: senderKey, sendersOf: sendersOf, filter: filter, count: count,
    filterAny: filterAny, toggle: toggle, chipRow: chipRow
  };
})();
