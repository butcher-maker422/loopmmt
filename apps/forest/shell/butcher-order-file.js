/* forest/app/public/shell/butcher-order-file.js — the browser mirror of the
   order-file's PURE verify half. App-Face leg 25c (import-preview browser-reach).

   WHY A MIRROR, NOT A REQUIRE (the markdown.js precedent, shell line 455). The node
   module forest/butcher/butcher-order-file.js require()s butcher-record.js, which
   drags node:sqlite / node:fs — unreachable in the browser. But its VERIFY half is
   pure: parse / verifyEnvelope / importPlan / serialize / exportContacts touch no
   I/O; their only real dependency is canonicalContent + computeEntryHash, i.e.
   sha256 over a string. So this file mirrors those pure bodies VERBATIM in shape and
   rebuilds canonicalContent/computeEntryHash on window.ForestShell.sha256Hex (the
   drift-proven browser sync SHA-256, sha256.js). It is held true to the node source
   by butcher-order-file.test.js — the DRIFT-CHECK that runs the SAME envelopes
   through BOTH this mirror and the real node module and asserts identical verdicts.
   A byte-identical fallback that silently stopped verifying is the exact 01.2221
   trap; the drift-check is the guard, mirroring the leg-25b compose-spy one level
   down (the surface composes THIS; this is proven equal to node).

   WHAT THIS DELIBERATELY DOES NOT CARRY: exportOrders. Export reads the signed
   entries from the live sqlite record — there is no browser db, so a browser
   exportOrders would either throw or return empty, and the surface would then say
   "nothing to export" — a state-LIE (the entries exist, server-side). Export
   browser-reach is the deploy arc (a /api/butcher/export route), walled honestly by
   the renderer, NOT faked here. This module is the IMPORT-preview half only.

   Plain script (no ES module, no deps) — attaches window.ForestShell.orderFile.
   Cold-safe: absent window.ForestShell.sha256Hex -> orderFile is NOT attached, so
   the porter promote gate stays dark (never a live pane over a missing hash).
   Load AFTER sha256.js. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});
  var sha256Hex = root.sha256Hex;

  // Cold-safe: no hash -> do not attach. A verify pane with no sha256 would render
  // a false verdict; better to leave the porter its honest stub.
  if (typeof sha256Hex !== "function") return;

  var FORMAT = "forest-butcher-orders";
  var FORMAT_VERSION = "1.0";

  function OrderFileError(msg) { var e = new Error(msg); e.name = "OrderFileError"; return e; }

  // ── canonicalContent / computeEntryHash — mirrored from butcher-record.js,
  //    rebuilt on the browser sha256. These are the "offline math" the node
  //    order-file borrows from the record; kept byte-identical (the drift-check
  //    proves it) so a recomputed entry_hash matches what the record signed.
  function canonicalContent(f) {
    return [f.previous_hash == null ? "" : f.previous_hash, f.timestamp, f.order_id,
            f.event, f.actor, f.detail == null ? "" : f.detail].join("|");
  }
  function computeEntryHash(fields, signer_pubkey, signature) {
    return sha256Hex(canonicalContent(fields) + "|" + signer_pubkey + "|" + signature);
  }

  function serialize(envelope) { return JSON.stringify(envelope, null, 2); }

  // ── PARSE ── strict, loud. A malformed file is refused by NAME, never coerced.
  function parse(text) {
    var env;
    try { env = JSON.parse(text); }
    catch (_) { throw OrderFileError("E_PARSE: not valid JSON"); }
    if (!env || typeof env !== "object" || Array.isArray(env)) throw OrderFileError("E_SHAPE: envelope is not an object");
    if (env.format !== FORMAT) throw OrderFileError('E_FORMAT: expected "' + FORMAT + '", got "' + env.format + '"');
    if (env.version !== FORMAT_VERSION) throw OrderFileError('E_VERSION: expected "' + FORMAT_VERSION + '", got "' + env.version + '"');
    if (!Array.isArray(env.orders)) throw OrderFileError("E_ORDERS: orders is not an array");
    for (var oi = 0; oi < env.orders.length; oi++) {
      var o = env.orders[oi];
      if (!o || typeof o.order_id !== "string" || !Array.isArray(o.entries)) {
        throw OrderFileError("E_ORDER_SHAPE: an order is missing order_id or entries");
      }
      for (var ei = 0; ei < o.entries.length; ei++) {
        var e = o.entries[ei];
        if (!e || typeof e !== "object") throw OrderFileError("E_ENTRY_SHAPE: entry is not an object");
        var req = ["previous_hash", "timestamp", "order_id", "event", "actor", "signer_pubkey", "signature", "entry_hash"];
        for (var fi = 0; fi < req.length; fi++) {
          if (!(req[fi] in e)) throw OrderFileError('E_ENTRY_SHAPE: entry missing "' + req[fi] + '"');
        }
      }
    }
    return env;
  }

  // ── VERIFY ── offline integrity: entry_hash recompute + previous_hash linkage,
  //    plus optional signature validity when a verifyFn is supplied.
  function verifyEnvelope(envelope, opts) {
    var verifyFn = (opts && opts.verifyFn) || null;
    var orders = [];
    var ok = true;
    for (var oi = 0; oi < envelope.orders.length; oi++) {
      var o = envelope.orders[oi];
      var prev = null, orderOk = true, problems = [];
      for (var i = 0; i < o.entries.length; i++) {
        var e = o.entries[i];
        var fields = { previous_hash: e.previous_hash, timestamp: e.timestamp, order_id: e.order_id,
                       event: e.event, actor: e.actor, detail: e.detail };
        var recomputed = computeEntryHash(fields, e.signer_pubkey, e.signature);
        if (recomputed !== e.entry_hash) { orderOk = false; problems.push("entry " + i + ": entry_hash mismatch (content or signature altered)"); }
        if (i > 0 && e.previous_hash !== prev) { orderOk = false; problems.push("entry " + i + ": previous_hash does not link to the prior entry"); }
        if (verifyFn) {
          var sigOk = false;
          try { sigOk = !!verifyFn(canonicalContent(fields), e.signer_pubkey, e.signature); }
          catch (_) { sigOk = false; }
          if (!sigOk) { orderOk = false; problems.push("entry " + i + ": signature does not verify against signer_pubkey"); }
        }
        prev = e.entry_hash;
      }
      if (!orderOk) ok = false;
      orders.push({ order_id: o.order_id, reserved: !!o.reserved, ok: orderOk, count: o.entries.length, problems: problems });
    }
    return { ok: ok, orders: orders, signatures_checked: !!verifyFn };
  }

  // ── IMPORT PLAN ── does NOT write. Hands the caller the append plan + verdict.
  function importPlan(envelope, opts) {
    var integrity = verifyEnvelope(envelope, opts);
    var appends = [];
    for (var oi = 0; oi < envelope.orders.length; oi++) {
      var ents = envelope.orders[oi].entries;
      for (var i = 0; i < ents.length; i++) appends.push(ents[i]);
    }
    var counts = {
      orders: envelope.orders.filter(function (o) { return !o.reserved; }).length,
      reserved_lanes: envelope.orders.filter(function (o) { return !!o.reserved; }).length,
      entries: appends.length
    };
    return { format: envelope.format, version: envelope.version, appends: appends, counts: counts, integrity: integrity, orders: envelope.orders };
  }

  // ── CONTACTS (CSV) ── round-trippable, RFC-4180-shaped quoting.
  var CONTACT_FIELDS = ["name", "phone", "email", "address"];
  function csvCell(v) {
    var s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportContacts(list) {
    var head = CONTACT_FIELDS.join(",");
    var rows = (list || []).map(function (c) {
      return CONTACT_FIELDS.map(function (f) { return csvCell(c && c[f]); }).join(",");
    });
    return [head].concat(rows).join("\r\n");   // RFC-4180 CRLF — matches node byte-for-byte
  }

  root.orderFile = {
    FORMAT: FORMAT, FORMAT_VERSION: FORMAT_VERSION,
    canonicalContent: canonicalContent, computeEntryHash: computeEntryHash,
    serialize: serialize, parse: parse, verifyEnvelope: verifyEnvelope,
    importPlan: importPlan, exportContacts: exportContacts
    // exportOrders intentionally absent — db-bound; the deploy arc, walled honestly.
  };

  if (typeof module !== "undefined" && module.exports) module.exports = root.orderFile;
})();
