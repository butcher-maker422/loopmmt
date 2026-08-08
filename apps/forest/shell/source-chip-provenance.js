/* Shea's Forest — the App Shell · shell/source-chip-provenance.js
   U4 · SC-4 — the SOURCE-CHIP PROVENANCE BINDING (V6 SC-4 / JT-6 · anti-spoof).

   WHAT THIS IS. The pure function behind the Two Rivers source-chip — the little
   badge on each row of the unified multi-account view that says "this arrived
   through THIS account/source." The one job it exists to get right: the chip's
   value comes from `row.source` (the ingesting ADAPTER / ACCOUNT BINDING — the
   authenticated channel the message actually came in on, which the sender cannot
   forge) and NEVER from the parsed `From:` header or any other message-controlled
   field (which any sender can set to anything).

   THE ATTACK IT CLOSES (SC-4, turned from ASSERTED into ENFORCED). A message whose
   `From:` is forged to read `sovereign@…` must NOT be able to dress its chip in a
   higher trust than the channel it actually came in on. Trust is a property of the
   BINDING (which account pulled it), not of the CLAIM (what the header says). So a
   crafted row with `from: "sovereign@gov"` but `source: "gmail"` (a third-party API
   adapter — Shadow mode) yields the SHADOW chip, never a sovereign mark. The
   function does not read `row.from` at all — proven by the invariance test: hold
   the source fixed, forge every message field, and the chip output does not move.

   THE SEAM IT WELDS TO. The shipped `mail-model.js` already keeps `row.source`
   (the adapter, set by the ingest) separate from the parsed `from` (the header,
   set by the sender) — see its normalize (`from: parsed.from`, `source: pick(row,
   'source')`). This binding is enforceable precisely because the model holds the
   two apart. This module READS that split; it does NOT edit mail-model (parity).

   THE HONESTY QUALIFIER (Threat Model v2 §3 — Sovereign vs Shadow). In Shadow mode
   (operating over a third-party API the operator does not control, e.g. Gmail) the
   chip is marked "as trustworthy as the account binding, no more" — it never claims
   protection it can't provide (the threat model's Honesty Commitment). A `sovereign`
   mark is reachable ONLY from a recognized sovereign SOURCE (the operator's own
   infrastructure), never from a header — and the sovereign-source set is empty
   today (the email app ships only the Gmail-readonly adapter), so the conservative
   default is shadow: an unrecognized source is never awarded sovereign trust.

   Plain script (no ES module, no deps) — attaches to window.ForestShell.sourceChipProvenance.
   Cold-safe: a null / garbage row yields an honest-absent chip, never an exception. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  /* Sovereign sources — adapters that ARE the operator's own sovereign
     infrastructure (full-trust binding). DELIBERATELY EMPTY today: the email app
     ships only the Gmail-readonly adapter, which is Shadow (over the third-party
     API). A sovereign source is added here WHEN it exists, never before. Honest-
     degrade: anything not in this set is shadow (never a false sovereign mark). */
  var SOVEREIGN_SOURCES = {};

  /* Shadow sources — third-party API adapters. Named for legibility only; NOT
     load-bearing for safety (anything not sovereign is shadow regardless). */
  var SHADOW_SOURCES = { "gmail": 1 };

  var SHADOW_QUALIFIER = "as trustworthy as the account binding, no more";

  /* chipProvenance(row) -> { source, mode, trust, qualifier, basis }
       source    — the chip VALUE == row.source (the unforgeable account binding),
                   or null when the row carries no binding (honest-absent: a chip is
                   never INFERRED from the message). Independent of row.from.
       mode      — "sovereign" iff the SOURCE is a recognized sovereign source, else
                   "shadow". A function of the source ALONE — never the message.
       trust     — "account-binding" (or "unbound" when there is no source).
       qualifier — the Threat Model v2 §3 honesty line for shadow rows.
       basis     — "row.source": the provenance basis, stated. Never row.from.
     row.from and every other header/message field are NEVER read here. */
  function chipProvenance(row) {
    var r = (row && typeof row === "object") ? row : {};

    // the account binding — the ONLY input to the chip. Absent/empty -> null.
    var source = (r.source != null && String(r.source) !== "") ? String(r.source) : null;

    // mode is derived from the SOURCE alone (never row.from / headers).
    var sovereign = (source !== null &&
                     Object.prototype.hasOwnProperty.call(SOVEREIGN_SOURCES, source));
    var mode = sovereign ? "sovereign" : "shadow";

    return {
      source: source,
      mode: mode,
      trust: source === null ? "unbound" : "account-binding",
      qualifier: sovereign ? "sovereign account binding"
               : (source === null ? "no account binding to show"
               : SHADOW_QUALIFIER),
      basis: "row.source"
    };
  }

  /* A decidable predicate a host/monitor can gate on without re-deriving the rule:
     is this row's chip the sovereign mark? True IFF the SOURCE is a sovereign
     source — a forged `From:` can never make it true. */
  function isSovereignChip(row) {
    return chipProvenance(row).mode === "sovereign";
  }

  root.sourceChipProvenance = {
    chipProvenance: chipProvenance,
    isSovereignChip: isSovereignChip,
    _SOVEREIGN_SOURCES: SOVEREIGN_SOURCES,
    _SHADOW_SOURCES: SHADOW_SOURCES,
    _SHADOW_QUALIFIER: SHADOW_QUALIFIER,
    _version: "1.0"
  };
})();
