/* Shea's Forest — the App Shell · shell/the-two-rivers.js
   TWO RIVERS — Delight #5 of the Seven Delights (V6 · FWW(C) feature set).
   Auto-covered by delight-egress-guard.test.js (SC-7); unit test the-two-rivers.test.js.

   THE MOMENT. Two rivers — the live account and the archive (and, one day, more
   accounts) — flow into one unified mailbox. Two Rivers is the pair of marks that
   make that confluence honest and, when it is truly empty, quietly celebratory:
     • a small SOURCE CHIP on each row — where this message actually arrived; and
     • the UNIFIED "all clear" — the still arrival that fires ONLY when EVERY river
       is a verified known-zero, never a blithe unified calm over one unverified one.

   SM-6 (the sharpest felt): beauty earned by trust. The unified view is celebratory
     ONLY because the provenance underneath is honest — the chip says where each row
     came from, the all-clear withholds itself until every account can vouch for zero.
   JT-6 (the sharpest design): the source-signal is a `chip` on the `row` — a small,
     per-message provenance mark, wearing the Block Alphabet `chip` letter,
     so it costs zero marginal CSS and reads as one alphabet with the rest of the row.

   SC-4 (a SHARPEST security — the chip). renderChip(doc, provenance) takes ONLY the
     provenance object from sourceChipProvenance.chipProvenance(row) — a lattice of
     { source, mode, trust, qualifier, basis } whose `source` is row.source (the
     unforgeable ACCOUNT BINDING) and NEVER row.from / the parsed header. There is NO
     row / from / header parameter here, so a spoofed `From:` is UN-REACHABLE, not
     merely un-drawn (the exact SC-1 discipline the-margin uses for the draft): the
     chip cannot dress a message in a trust its channel didn't earn. In Shadow mode
     the chip carries the honesty qualifier — "as trustworthy as the account binding,
     no more" (Threat Model v2 §3) — on its title/aria; a `sovereign` mark is only
     ever reachable from a recognized sovereign SOURCE, never from a claim.

   SC-3 (the other sharp security — the all-clear). unifiedFire(accounts) is an
     AND over the SHIPPED honest-state gate: the unified all-clear fires IFF there is
     at least one account AND every account is a verified known-zero
     (completionFireGate(state,count).fire for each). If ANY account is `unreachable`
     or non-zero, the unified view withholds the celebration — it never leaks one
     account's unknown into a unified state-lie, and never collapses the per-account
     truth to a single boolean before the AND. Silence on doubt (SC-2 family).

   SC-7 (the egress floor): zero network — pure gate-delegation + render, auto-covered
     by the derived egress guard over the whole delight layer.

   SEPARATION. Like the-clearing, this module reads NO mailbox: renderChip is handed a
   provenance object, and the all-clear is HANDED the per-account (state, count) list
   by its host (which knows both). So the render has no path to invent a completion or
   a chip: no count source, no network, no header — only the gate, the settle, and the
   provenance it was handed.

   Plain script (no ES module, no deps) — attaches to window.ForestShell.twoRivers.
   Cold-safe throughout: no document / no alphabet / no gate -> null, never throws.
   Depends on window.ForestShell.block.el, .completionFireGate, .completionSettle. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  /* Legible source labels for the chip (display only; NOT load-bearing for safety —
     the chip's TRUST comes from `mode`, which chipProvenance derives from the source
     alone). Mirrors the renderer's SRC_LABEL so the confluence reads one language;
     an unknown source degrades to its own (stringified) name, never a guess. */
  var SRC_LABEL = { gmail: "Gmail", mbox: "archive" };
  function prettySource(s) {
    return Object.prototype.hasOwnProperty.call(SRC_LABEL, s) ? SRC_LABEL[String(s)] : String(s);
  }

  /* ---- renderChip(doc, provenance) -> the source chip Node | null --------------- *
   * provenance: the sourceChipProvenance.chipProvenance(row) output —               *
   *   { source, mode, trust, qualifier, basis }. THERE IS NO ROW / FROM / HEADER     *
   *   PARAMETER (SC-4 by construction): the spoofable `From:` is un-reachable here.  *
   * An unbound provenance (source === null) -> null (honest-absent: a chip is never  *
   * INFERRED from a message; a row with no binding shows no source mark). Cold-safe. *
   * The chip wears `chip mail-msg__source` (the shipped alphabet letter + the        *
   * existing test/behavior hook), plus `two-rivers__chip` and a `two-rivers--{mode}` *
   * modifier so the shadow/sovereign trust is legible without a second chip.         */
  function renderChip(doc, provenance) {
    if (!doc || typeof doc.createElement !== "function") return null;   // cold-safe
    var block = root.block;
    if (!block || typeof block.el !== "function") return null;          // cold-safe: alphabet not loaded
    var p = (provenance && typeof provenance === "object") ? provenance : {};

    // the chip VALUE is the account binding (p.source), NEVER a header. Absent -> no chip.
    var src = (p.source != null && String(p.source) !== "") ? String(p.source) : null;
    if (src === null) return null;

    var mode = (p.mode === "sovereign") ? "sovereign" : "shadow";
    var label = prettySource(src);
    // the honesty qualifier rides the title/aria (Threat Model v2 §3) so hover/AT
    // reads the trust; the visible chip stays a calm single word (SM-6, not a lecture).
    var qualifier = (typeof p.qualifier === "string" && p.qualifier) ? p.qualifier
                  : (mode === "sovereign" ? "sovereign account binding"
                                          : "as trustworthy as the account binding, no more");
    var title = "Source: " + label + " \u00b7 " + qualifier;

    return block.el(doc, "span", "chip mail-msg__source two-rivers__chip two-rivers--" + mode, {
      text: label, title: title, "aria-label": title,
      "data-source": src, "data-mode": mode
    });
  }

  /* ---- unifiedFire(accounts) -> the SC-3 AND verdict ---------------------------- *
   * accounts: an array of per-account honest states, each { state, count } (an       *
   *   optional `source`/`id` is carried through untouched for the caller). The       *
   *   module reads NO mailbox — the host hands it the per-account truth.              *
   * Returns { fire, reachable, accounts:[{...,fire,reachable,reason}], reason }:      *
   *   fire      — true IFF accounts.length >= 1 AND every account's                   *
   *               completionFireGate(state,count).fire === true (the AND-gate). One   *
   *               non-zero or unreachable account -> fire:false (SC-3: no unified      *
   *               state-lie). An EMPTY account set is not an all-clear (nothing to     *
   *               be clear about) -> fire:false, reachable:false.                      *
   *   reachable — true IFF every account is reachable (so a caller can tell "verified  *
   *               all-clear" apart from "can't reach one river's truth").              *
   * Cold-safe: no gate loaded -> every account coerces unreachable -> fire:false       *
   *   (never invent a unified fire — Real-or-Made). */
  function unifiedFire(accounts) {
    var list = Array.isArray(accounts) ? accounts : [];
    var gate = root.completionFireGate;
    var hasGate = !!(gate && typeof gate.completionFireGate === "function");

    var per = [];
    var allFire = list.length >= 1;   // an empty set is not an all-clear
    var allReachable = list.length >= 1;
    for (var i = 0; i < list.length; i++) {
      var a = (list[i] && typeof list[i] === "object") ? list[i] : {};
      var g = hasGate
        ? gate.completionFireGate(a.state, a.count)
        : { fire: false, reachable: false, state: "unreachable", reason: "gate-not-loaded" };
      per.push({
        source: (a.source != null ? a.source : (a.id != null ? a.id : null)),
        state: g.state, count: a.count,
        fire: g.fire, reachable: g.reachable, reason: g.reason
      });
      if (!g.fire) allFire = false;
      if (!g.reachable) allReachable = false;
    }

    return {
      fire: allFire,
      reachable: allReachable,
      accounts: per,
      reason: list.length === 0 ? "no-accounts"
            : allFire ? "all-rivers-known-zero"
            : (!allReachable ? "a-river-unreachable" : "a-river-nonzero")
    };
  }

  /* ---- renderAllClear(doc, accounts, opts) -> the unified settle Node | null ----- *
   * The unified "all clear" celebration. Fires the shared completion-settle at a      *
   * UNIFIED scope IFF unifiedFire(accounts).fire — else null (SILENCE, never a false   *
   * unified calm). Carries NO count (SM-3, mirroring the-clearing). Cold-safe: no      *
   * settle primitive -> null. The verdict is available on the returned node's          *
   * data-attrs for tests / a host that wants to know why it stayed silent.            */
  function renderAllClear(doc, accounts, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;   // cold-safe
    var verdict = unifiedFire(accounts);
    if (!verdict.fire) return null;                                     // silence on any doubt (SC-3)

    var settle = root.completionSettle;
    var node = (settle && typeof settle.render === "function")
      ? settle.render(doc, "view", opts || {})   // VIEW scale — the unified pane at rest
      : null;
    if (!node) return null;                                            // cold-safe: settle not loaded

    // mark the confluence for tests / hosts (no count, no praise — just the honest fact).
    node.setAttribute("data-two-rivers", "1");
    node.setAttribute("data-rivers", String((verdict.accounts || []).length));
    return node;
  }

  root.twoRivers = {
    prettySource: prettySource,
    renderChip: renderChip,
    unifiedFire: unifiedFire,
    renderAllClear: renderAllClear,
    _version: "1.0"
  };
})();
