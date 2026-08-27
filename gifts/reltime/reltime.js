#!/usr/bin/env node
/* reltime.js — an honest relative-time label ("3h ago", "Jun 20") that refuses
   to fake, round up, or invent a time it doesn't have.

   Turn a timestamp into a short human "when" — but the whole point is what it
   WON'T do:

     • FLAG, DON'T FAKE. No stamp, an empty stamp, or an unparseable value
       returns null — NO label. The caller shows nothing rather than a guessed
       or fabricated time. An undated thing is never handed a "when".

     • A FUTURE STAMP IS NOT A RECENCY CLAIM. If the timestamp is ahead of now
       (clock skew, a bad record), it returns null rather than "-2h ago". You
       cannot honestly say how long ago something happened if it hasn't.

     • REAL, NOT ROUNDED-UP. Recent items get a relative label
       (just now / Nm / Nh / Nd ago); anything older than a week gets the
       ABSOLUTE short date it actually landed ("Jun 20", or "Jun 20, 2025"
       across a year boundary) — because "9d ago" is less honest and less
       useful than the date itself.

     • DETERMINISTIC. `now` is injected, so the label is a pure function of
       (stamp, now) — testable with no wall clock and stable across a render.

   Pure function of its inputs, no dependencies. The same code runs in a browser
   (attach relativeTime to your namespace) or on Node (this CLI / require()).

   USAGE
     node reltime.js 2026-08-20T09:00:00Z              # label vs. now
     node reltime.js 2026-08-20T09:00:00Z 1755772800000  # label vs. an injected now (ms)
     node reltime.js --help

   Dates are read/rendered in UTC for determinism. Released under MIT.
*/
"use strict";

var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

var MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR, WEEK = 7 * DAY;

/* relativeTime(iso, nowMs) -> short label string, or null when there is no
   honest label to show. `iso` is an ISO-8601 string (or null). `nowMs` defaults
   to Date.now() but is injected in tests and via the CLI for determinism. */
function relativeTime(iso, nowMs) {
  // flag-don't-fake: no stamp, empty stamp, or a non-string -> no label.
  if (iso == null) return null;
  var s = String(iso);
  if (s === "") return null;

  var t = Date.parse(s);
  if (isNaN(t)) return null;                    // unparseable -> no fabricated time

  var now = (typeof nowMs === "number" && isFinite(nowMs)) ? nowMs : Date.now();
  var delta = now - t;

  // A future stamp (clock skew) is not a recency claim we can make honestly.
  if (delta < 0) return null;

  if (delta < MIN)  return "just now";
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

// Browser: attach to a namespace. Node/require: export. CLI: run below.
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.relativeTime = relativeTime;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { relativeTime: relativeTime };
}

// ---- CLI (runs only when invoked directly, never on require) ----------------
function main(argv) {
  var args = argv.slice(2);
  if (args.length === 0 || args.indexOf("--help") !== -1 || args.indexOf("-h") !== -1) {
    process.stdout.write(
      "reltime.js — an honest relative-time label that refuses to fake a time.\n\n" +
      "  node reltime.js <iso-timestamp>            label vs. now\n" +
      "  node reltime.js <iso-timestamp> <now-ms>   label vs. an injected now (ms)\n" +
      "  node reltime.js --help\n\n" +
      "Prints the label, or '(no honest label)' when the stamp is missing,\n" +
      "unparseable, or in the future. Dates render in UTC.\n"
    );
    return args.length === 0 ? 1 : 0;
  }
  var iso = args[0];
  var nowMs = args.length > 1 ? Number(args[1]) : undefined;
  var label = relativeTime(iso, nowMs);
  process.stdout.write((label === null ? "(no honest label)" : label) + "\n");
  return 0;
}

if (typeof require !== "undefined" && require.main === module) {
  process.exitCode = main(process.argv);
}
