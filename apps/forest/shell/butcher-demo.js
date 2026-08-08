/* Shea's Forest — Butcher · shell/butcher-demo.js
   DEMO / SAMPLE DATA — clearly labeled, never presented as live.

   The Butcher surfaces (butcher-surfaces.js) are PURE: hand them orders and they
   draw the board / glance. Until the runtime's /api/butcher/board returns real
   signed records (the Chunk-B Record wiring), the pane has nothing to draw and
   shows only an honest "couldn't load" node. For a DEMO — showing Rick & Christine
   the design — this module supplies a small set of SAMPLE Deer Hill orders across
   the lifecycle so the board, the order glance, and the intake form are all visible.

   HONEST BY CONSTRUCTION (Real-or-Made):
     • Every sample is served under a LOUD "Sample orders — demo, not live" banner
       (the renderer paints it; see butcher-renderer.js showDemoBoard/showDemoOrder).
     • verify is null on every sample -> the surfaces render the honest "unverified"
       (dashed) chip. A sample record carries NO real chain, so it is NEVER shown as
       cryptographically verified — that would be a false green (forbidden by the
       surfaces' own state-lie guard and the Real-or-Made Line).
     • The moment the runtime returns even one real order, the live board shows and
       this sample set NEVER appears. It is a fallback, not an overlay.

   Plain script, no deps. Attaches to window.ForestShell.butcherDemo. */
(function () {
  "use strict";
  var root = (window.ForestShell = window.ForestShell || {});

  // ISO timestamp `daysAgo` days back, at `hour` local (for readable timelines).
  function iso(daysAgo, hour) {
    var d = new Date();
    d.setDate(d.getDate() - (daysAgo || 0));
    if (hour != null) d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  }
  function ymd(daysAgo) { return iso(daysAgo, 8).slice(0, 10); }

  // Encode the intake detail EXACTLY as butcher-surfaces.detailEncode does
  // (customer;phone;dropoff;weight;cuts, with ';' '=' '\' escaped) so the board
  // and glance parse it back. Kept byte-compatible with the surfaces' parser.
  function detail(f) {
    var order = ["customer", "phone", "dropoff", "weight", "cuts"], parts = [];
    for (var i = 0; i < order.length; i++) {
      var k = order[i], v = f[k];
      if (v != null && String(v).length) parts.push(k + "=" + String(v).replace(/([\\;=])/g, "\\$1"));
    }
    return parts.join(";");
  }

  // Build an order record: the intake entry (carries the encoded detail) plus the
  // lifecycle events since, each a Record row {seq, order_id, event, actor, timestamp, detail}.
  function order(id, events) {
    var entries = [];
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      entries.push({ seq: i, order_id: id, event: e.event, actor: e.actor || "Shea",
        timestamp: e.at, detail: e.detail || "" });
    }
    return { order_id: id, entries: entries, verify: null };  // null -> honest "unverified" chip
  }

  // Six sample Deer Hill orders, one in each lifecycle lane
  // (Intake -> Hanging -> Cutting -> Packaged -> Ready -> Picked up).
  var ORDERS = [
    order("2026-118", [
      { event: "intake", at: iso(0, 8), detail: detail({ customer: "Dale Prentiss", phone: "(207) 555-0148", dropoff: ymd(0), weight: "118", cuts: "backstraps whole, rest ground" }) }
    ]),
    order("2026-116", [
      { event: "intake", at: iso(3, 7), detail: detail({ customer: "Marie Cyr", phone: "(207) 555-0116", dropoff: ymd(3), weight: "104", cuts: "steaks + roasts, 15 lb summer sausage" }) },
      { event: "hang", at: iso(3, 9) }
    ]),
    order("2026-115", [
      { event: "intake", at: iso(5, 7), detail: detail({ customer: "Wendell Roy", phone: "(207) 555-0102", dropoff: ymd(5), weight: "127", cuts: "chops, stew, grind; 5 lb jerky" }) },
      { event: "hang", at: iso(5, 10) },
      { event: "cut", at: iso(0, 11) }
    ]),
    order("2026-113", [
      { event: "intake", at: iso(8, 6), detail: detail({ customer: "Sam Beaulieu", phone: "(207) 555-0177", dropoff: ymd(8), weight: "96", cuts: "mostly grind, a few roasts" }) },
      { event: "hang", at: iso(8, 9) },
      { event: "cut", at: iso(2, 10) },
      { event: "package", at: iso(1, 14) }
    ]),
    order("2026-111", [
      { event: "intake", at: iso(10, 8), detail: detail({ customer: "Georgia Nadeau", phone: "(207) 555-0130", dropoff: ymd(10), weight: "132", cuts: "custom sheet — steaks 3/4in, roasts, 20 lb snack sticks" }) },
      { event: "hang", at: iso(10, 11) },
      { event: "cut", at: iso(4, 9) },
      { event: "package", at: iso(2, 15) },
      { event: "notify", at: iso(0, 10) }
    ]),
    order("2026-108", [
      { event: "intake", at: iso(14, 7), detail: detail({ customer: "Travis Ouellette", phone: "(207) 555-0161", dropoff: ymd(14), weight: "88", cuts: "all grind + snack sticks" }) },
      { event: "hang", at: iso(14, 10) },
      { event: "cut", at: iso(9, 9) },
      { event: "package", at: iso(7, 13) },
      { event: "notify", at: iso(6, 10) },
      { event: "pickup", at: iso(2, 16) }
    ])
  ];

  var BY_ID = {};
  ORDERS.forEach(function (o) { BY_ID[o.order_id] = o; });

  // A self-contained SAMPLE take-home page, clearly marked, so the "Take it home"
  // button visibly does something in the demo. This is NOT the real signed Stamp —
  // the real one is server-generated and offline-verifiable; this is a labeled sample.
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>]/g, function (c) { return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"; }); }
  function sampleStampHtml(o) {
    var rows = (o.entries || []).map(function (e) {
      return "<tr><td>" + e.seq + "</td><td>" + esc(e.event) + "</td><td>" + esc(e.actor) + "</td><td>" + esc(e.timestamp) + "</td></tr>";
    }).join("");
    return "<!doctype html><meta charset=utf-8><title>SAMPLE - Butcher order " + esc(o.order_id) + "</title>" +
      "<body style='font:14px system-ui,sans-serif;margin:40px;color:#2a2a2a'>" +
      "<p style='background:#C9A84C;padding:6px 10px;border-radius:6px;display:inline-block'>SAMPLE — demo record, not a verified Stamp</p>" +
      "<h1 style='font-family:Georgia,serif'>Butcher — order " + esc(o.order_id) + "</h1>" +
      "<table border=1 cellpadding=6 cellspacing=0 style='border-collapse:collapse'>" +
      "<tr><th>#</th><th>event</th><th>by</th><th>when</th></tr>" + rows + "</table></body>";
  }

  root.butcherDemo = { orders: ORDERS, byId: BY_ID, sampleStampHtml: sampleStampHtml, _version: "1.0" };
})();
