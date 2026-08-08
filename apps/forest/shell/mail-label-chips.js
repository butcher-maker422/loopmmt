/* Shea's Forest — the App Shell · shell/mail-label-chips.js
   MULTI-LABEL CHIP FILTER — email-app (the email-views line · the render layer).
   The removable-chip sibling of the From filter (#22b chip upgrade), pointed at
   the labels the model ALREADY carries (m.labels). Picking labels narrows the list
   to mail carrying ANY of the selected labels (UNION), each an × to remove.

   WHY UNION (a filed design call,). Within one facet, multiple picks read
   as "show me anything in these buckets" — the same shape as the From chip (any of
   the picked senders) and standard faceted-filter convention. Intersection (ALL
   selected) is the rarer, surgical need and produces the empty-result surprise when
   two disjoint labels are picked; the rail already gives the primary single-view
   narrowing. So the chip facet is UNION, consistent with its From sibling.

   READ-ONLY on the model (the email-views Joint Contract): this file lives entirely
   in the render layer. It reads m.labels (already on the message), calls NO model,
   touches NO model/runtime/renderer export — it self-registers on window.ForestShell
   and is wired at one seam in buildMailboxView's paint() as a client overlay, exactly
   like the From filter / spam / read-later. The rail's primary-view state (currentLabel,
   model-side) is untouched and orthogonal — this overlay composes on top of it (AND
   across facets, UNION within the label facet).

   SEPARATION: reads NO mailbox of its own and invents nothing — the host hands it the
   messages in hand and it returns the union subset (filterAny) or manages the picked
   set (toggle) / renders it (chipRow). Cold-safe throughout: null / undefined / non-array
   in -> [] out (or an empty chip row), never throws.

   Plain script (no ES module, no deps) — attaches to window.ForestShell.mailLabelChips. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  // labelsOn(m) -> the message's label id array (a NEW array; never the live ref),
  // honestly empty for a label-less message (mbox source, or none). Never throws.
  function labelsOn(m) {
    if (!m || !m.labels || typeof m.labels.slice !== "function") return [];
    return m.labels.slice();
  }

  // filterAny(messages, labels) -> the subset of the mailbox in hand whose label set
  // intersects `labels` (the UNION / OR-filter: the message carries ANY selected label).
  // Blank ids in the set are ignored. An empty / null set -> [] (honest floor: nothing
  // selected matches nothing; the host guards the call with currentLabels.length, exactly
  // as the From overlay guards its own). New array, order preserved, never mutates.
  function filterAny(messages, labels) {
    if (!messages || typeof messages.filter !== "function") return [];
    if (!labels || typeof labels.forEach !== "function") return [];
    var want = {};
    labels.forEach(function (l) {
      var t = (l == null) ? "" : String(l).trim();
      if (t !== "") want[t] = true;
    });
    if (Object.keys(want).length === 0) return [];
    return messages.filter(function (m) {
      var ls = labelsOn(m);
      for (var i = 0; i < ls.length; i++) {
        if (Object.prototype.hasOwnProperty.call(want, String(ls[i]).trim())) return true;
      }
      return false;
    });
  }

  // toggle(labels, label) -> a NEW active-set with `label` added if absent, removed if
  // present (the chip add / remove logic). The id is trimmed. A blank / null label returns
  // a copy unchanged. Order is add-order (a removed id re-added lands last). Cold-safe:
  // null / non-array senders -> a fresh set with just the new id.
  function toggle(labels, label) {
    var out = (labels && typeof labels.slice === "function") ? labels.slice() : [];
    var t = (label == null) ? "" : String(label).trim();
    if (t === "") return out;
    var i = out.indexOf(t);
    if (i === -1) out.push(t); else out.splice(i, 1);
    return out;
  }

  // chipRow(doc, labels, onRemove) -> a DOM container of removable chips, one per active
  // label: a `.chip .chip--lit .mail__label-chip` bearing the label id + a `.chip__x`
  // remove control that calls onRemove(label) on click. Pure builder: reads no mailbox,
  // holds no state — the host owns the set and re-calls this after a toggle. Cold-safe:
  // a bad doc -> null; a non-array set -> an empty container; never throws. onRemove
  // optional (a static row).
  function chipRow(doc, labels, onRemove) {
    if (!doc || typeof doc.createElement !== "function") return null;
    var row = doc.createElement("div");
    row.className = "mail__label-chips";
    row.setAttribute("role", "list");
    row.setAttribute("aria-label", "Active label filters");
    if (!labels || typeof labels.forEach !== "function") return row;
    labels.forEach(function (l) {
      var id = (l == null) ? "" : String(l).trim();
      if (id === "") return;
      var chip = doc.createElement("span");
      chip.className = "chip chip--lit mail__label-chip";
      chip.setAttribute("role", "listitem");
      var label = doc.createElement("span");
      label.className = "mail__label-chip-label";
      label.textContent = id;
      chip.appendChild(label);
      var x = doc.createElement("button");
      x.className = "chip__x mail__label-chip-x";
      x.setAttribute("type", "button");
      x.setAttribute("aria-label", "Remove label filter " + id);
      x.textContent = "\u00d7";   // ×
      if (typeof onRemove === "function") {
        x.addEventListener("click", function () { onRemove(id); });
      }
      chip.appendChild(x);
      row.appendChild(chip);
    });
    return row;
  }

  root.mailLabelChips = { labelsOn: labelsOn, filterAny: filterAny, toggle: toggle, chipRow: chipRow };
})();
