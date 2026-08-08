/* Shea's Forest — the App Shell · shell/relative-time.js
   STEP 5 recency, the VISIBLE half — turns the real `ingestedAt` intake stamp
   (carried by connector-items.js) into a short, honest "when" label for a
   connector item ("3h ago", "Jun 20"). This is the display twin of the recency
   SORT: the projection core orders newest-first within a category; this makes
   that recency legible to the owner instead of an invisible reordering.

   HONESTY (the Real-or-Made Line, applied to the label):
     • FLAG-DON'T-FAKE. A row with no real stamp (null, empty, or an unparseable
       value) returns null — NO label. The renderer shows nothing rather than a
       fabricated or guessed time. An undated item is never handed a "when".
     • REAL, NOT ROUNDED-UP. Recent items get a relative label (just now / Nm /
       Nh / Nd ago); anything older than a week gets an absolute short date
       ("Jun 20", or "Jun 20, 2025" across a year boundary), because "9d ago" is
       less honest and less useful than the date it actually landed.
     • DETERMINISTIC. `now` is injected (ms), so the label is a pure function of
       (stamp, now) — node-testable with no clock, and stable across a render.

   Plain script (no ES module) — attaches to window.ForestShell.relativeTime.
   No dependencies (pure function over an ISO string + a now-ms number). */
(function () {
  "use strict";
  var root = (typeof window !== "undefined" ? window : globalThis);
  root.ForestShell = root.ForestShell || {};

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR, WEEK = 7 * DAY;

  /* relativeTime(iso, nowMs) -> short label string, or null when there is no
     honest label to show. `iso` is the item's ingestedAt (ISO-8601 | null).
     `nowMs` defaults to Date.now() but is injected in tests for determinism. */
  function relativeTime(iso, nowMs) {
    // flag-don't-fake: no stamp, empty stamp, or a non-string -> no label.
    if (iso == null) return null;
    var s = String(iso);
    if (s === "") return null;

    var t = Date.parse(s);
    if (isNaN(t)) return null;                        // unparseable -> no fabricated time

    var now = (typeof nowMs === "number" && isFinite(nowMs)) ? nowMs : Date.now();
    var delta = now - t;

    // A future stamp (clock skew) is not a recency claim we can make honestly.
    if (delta < 0) return null;

    if (delta < MIN) return "just now";
    if (delta < HOUR) return Math.floor(delta / MIN) + "m ago";
    if (delta < DAY)  return Math.floor(delta / HOUR) + "h ago";
    if (delta < WEEK) return Math.floor(delta / DAY) + "d ago";

    // Older than a week -> the absolute short date it actually landed.
    var d = new Date(t);
    var label = MONTHS[d.getUTCMonth()] + " " + d.getUTCDate();
    if (d.getUTCFullYear() !== new Date(now).getUTCFullYear()) {
      label += ", " + d.getUTCFullYear();
    }
    return label;
  }

  root.ForestShell.relativeTime = relativeTime;
  // Node harness convenience (the test requires this file, then reads window).
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { relativeTime: relativeTime };
  }
})();
