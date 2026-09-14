#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */
/**
 * zonecast — cast a stored wall-clock into the time a VIEWER actually sees.
 *
 * WHAT
 *   A calendar stores an event as a wall-clock ("2026-06-20T23:00") plus, sometimes,
 *   the IANA zone that wall-clock was written in ("America/New_York"). What a viewer
 *   in London should SEE is a different wall-clock — and possibly a different calendar
 *   DAY — because 23:00 in New York is 04:00 the next morning in London. Getting this
 *   wrong (off-by-an-hour at a DST boundary, or bucketing an event on the wrong day) is
 *   one of the most common and most silent bugs in any app that shows times to people
 *   in more than one zone.
 *
 *       cast(value, kind, homeZone) -> { ok, kind, dayKey, time, wallClock, zone }
 *
 *   It answers ONE question — what wall-clock and calendar-day does THIS viewer see for
 *   this stored time? — and answers it DST-correctly, using only the platform's own
 *   Intl time-zone database. Two kinds of stored time:
 *
 *     FLOATING — a wall-clock with NO zone (all-day events, legacy rows). It means the
 *       same wall-clock everywhere and never shifts: 11:00 stays 11:00 in every zone.
 *       Passed through verbatim — no math, no zone.
 *
 *     ZONED — a wall-clock PLUS an IANA zone. Interpreted in its own zone to find the
 *       real instant, then re-expressed in the viewer's homeZone. DST-correct by
 *       construction (a two-pass offset resolution that settles spring-forward /
 *       fall-back edges), never a hardcoded offset.
 *
 * HONEST BY CONSTRUCTION (Flag, don't fake)
 *   - A missing, malformed, or offset-bearing wall-clock returns { ok:false } with all
 *     fields blanked — the caller shows NOTHING rather than a guessed time. An undated
 *     or unparseable thing is never handed a "when".
 *   - A ZONED value with no zone is malformed -> blank. It is never silently treated as
 *     floating.
 *   - An unresolvable home zone is NEVER assumed to be UTC. If no homeZone is given, the
 *     platform's own detected zone is proposed; if even that is unavailable, the result
 *     blanks rather than fabricating a zone.
 *   - A trailing "Z" or an explicit +/-HH:MM offset is REJECTED (blank), not silently
 *     reinterpreted — this tool speaks the tool-shaped "YYYY-MM-DDTHH:MM[:SS]" wall-clock,
 *     and refuses to guess what an offset-bearing string "really meant".
 *
 * HOW
 *   The zone math uses the platform's Intl.DateTimeFormat time-zone database and Date
 *   arithmetic only — no zone table is vendored, so it is always as current as the
 *   runtime's own tzdata. The ZONED path resolves a wall-clock-in-zone to a UTC instant
 *   by a standard two-pass technique: read the fields as if UTC, ask Intl what that
 *   instant reads as in the zone, take the difference as the offset, apply it, then
 *   re-read once to settle a DST edge (taking the first valid reading in the rare
 *   spring-forward gap / fall-back fold). Pure function of (value, kind, homeZone): no
 *   clock, no randomness, no files, no network. Same three inputs -> same result, every
 *   run, in Node or a browser.
 *
 *   In Node:    require("./zonecast.js").cast(...)  /  CLI: node zonecast.js ...
 *   In browser: window.ForestGifts.zonecast.{cast, detectZone}
 *
 * CEILING (printed edge)
 *   zonecast tells you the wall-clock and calendar-day a viewer SEES for a stored time;
 *   it does not store times, validate that a zone name is one you meant, or know what
 *   "now" is — it is a pure renderer of a value you already hold, and it relies entirely
 *   on the host runtime's Intl time-zone database for its correctness.
 */
"use strict";

var BLANK_FLOATING = { ok: false, kind: "floating", dayKey: "", time: "", wallClock: "", zone: null };

function blank(kind) {
  return { ok: false, kind: kind || "floating", dayKey: "", time: "", wallClock: "", zone: null };
}

/* ---- browser-detect: the honest fallback for an unsigned home zone ------------ *
 * An UNSET home zone falls back to the platform's own detected zone, NEVER a
 * hardcoded constant and NEVER silent UTC. If Intl is unavailable (some non-browser
 * runtime), return "" — the caller decides; we never fabricate a zone. */
function detectZone() {
  try {
    var z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return (typeof z === "string" && z) ? z : "";
  } catch (e) { return ""; }
}

/* ---- a stored wall-clock string -> component fields --------------------------- *
 * Accepts "YYYY-MM-DDTHH:MM" or "YYYY-MM-DDTHH:MM:SS" (tool-shaped, no offset).
 * A trailing "Z" or an explicit +/-HH:MM offset is NOT a floating/zoned wall-clock
 * in this model — reject it (null) rather than silently reinterpret it. */
function parseWall(s) {
  if (typeof s !== "string") return null;
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  var o = { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: m[6] ? +m[6] : 0 };
  if (o.mo < 1 || o.mo > 12 || o.d < 1 || o.d > 31 || o.h > 23 || o.mi > 59 || o.s > 59) return null;
  return o;
}

function pad(n) { return (n < 10 ? "0" : "") + n; }

/* ---- the two-pass zone-offset algorithm --------------------------------------- *
 * Given wall-clock fields interpreted in `timeZone`, return the UTC instant (ms).
 * Treat the fields as if UTC to get a provisional instant, ask Intl what that instant
 * reads as IN the zone; the difference is the zone's offset there. Apply it, then
 * correct once for a DST edge. DST-correct except in the rare spring-forward gap /
 * fall-back fold, where the first valid reading is taken. Returns null if Intl can't
 * resolve the zone. */
function partsInZone(instantMs, timeZone) {
  var dtf;
  try {
    dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
  } catch (e) { return null; }
  var parts = dtf.formatToParts(new Date(instantMs));
  var map = {};
  for (var i = 0; i < parts.length; i++) { if (parts[i].type !== "literal") map[parts[i].type] = parts[i].value; }
  var hh = map.hour === "24" ? 0 : +map.hour; // some engines emit "24" for midnight
  return { y: +map.year, mo: +map.month, d: +map.day, h: hh, mi: +map.minute, s: +map.second };
}

function fieldsToUTC(f) { return Date.UTC(f.y, f.mo - 1, f.d, f.h, f.mi, f.s); }

function wallClockToInstant(w, timeZone) {
  var asUTC = fieldsToUTC(w);
  var read1 = partsInZone(asUTC, timeZone);
  if (!read1) return null;
  var offset1 = asUTC - fieldsToUTC(read1);   // ms the zone leads UTC at the guess
  var instant = asUTC + offset1;
  var read2 = partsInZone(instant, timeZone); // one correction pass for DST edges
  if (read2) {
    var offset2 = instant - fieldsToUTC(read2);
    if (offset2 !== offset1) instant = asUTC + offset2;
  }
  return instant;
}

function instantToWall(instantMs, timeZone) {
  return partsInZone(instantMs, timeZone); // {y,mo,d,h,mi,s} or null
}

function fieldsToResult(f, kind, zone) {
  if (!f) return blank(kind);
  var dayKey = f.y + "-" + pad(f.mo) + "-" + pad(f.d);
  var time = pad(f.h) + ":" + pad(f.mi);
  return { ok: true, kind: kind, dayKey: dayKey, time: time, wallClock: dayKey + "T" + time, zone: zone || null };
}

/* ---- input pickers: accept a bare string or a tolerant object ------------------ */
function pickWall(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    if (typeof value.wallClock === "string") return value.wallClock;
    if (typeof value.value === "string") return value.value;
    if (typeof value.start_at === "string") return value.start_at;
  }
  return null;
}
function pickZone(value) {
  if (value && typeof value === "object") {
    if (typeof value.zone === "string" && value.zone) return value.zone;
    if (typeof value.ianaZone === "string" && value.ianaZone) return value.ianaZone;
    if (typeof value.tzid === "string" && value.tzid) return value.tzid;
  }
  return "";
}

/* ---- cast — THE primitive ------------------------------------------------------ *
 * value :
 *   FLOATING  -> a wall-clock string "YYYY-MM-DDTHH:MM[:SS]" (or an object
 *                { wallClock } / { value } / { start_at }). No zone; passed verbatim.
 *   ZONED     -> an object carrying the wall-clock AND its zone (zone aliases:
 *                zone / ianaZone / tzid). Interpreted in that zone, re-expressed in
 *                homeZone.
 * kind : "floating" | "zoned" (anything else -> treated as floating, cold-safe)
 * homeZone : IANA name; for zoned, "" / absent falls back to detectZone(). */
function cast(value, kind, homeZone) {
  var w = parseWall(pickWall(value));
  if (!w) return blank(kind === "zoned" ? "zoned" : "floating");

  if (kind !== "zoned") {
    // FLOATING — the wall-clock is the display, everywhere. No math, no zone.
    return fieldsToResult(w, "floating", null);
  }

  // ZONED — need the value's own zone and the viewer's home zone.
  var srcZone = pickZone(value);
  if (!srcZone) return blank("zoned");                      // zoned with no zone is malformed
  var home = (typeof homeZone === "string" && homeZone) ? homeZone : detectZone();
  if (!home) return blank("zoned");                         // never assume UTC

  var instant = wallClockToInstant(w, srcZone);
  if (instant === null || isNaN(instant)) return blank("zoned");
  return fieldsToResult(instantToWall(instant, home), "zoned", home);
}

/* ---- exports ------------------------------------------------------------------ */
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.zonecast = {
    cast: cast, detectZone: detectZone,
    parseWall: parseWall, wallClockToInstant: wallClockToInstant, instantToWall: instantToWall,
    BLANK: BLANK_FLOATING, _version: "1.0"
  };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    cast: cast, detectZone: detectZone,
    parseWall: parseWall, wallClockToInstant: wallClockToInstant, instantToWall: instantToWall,
    BLANK: BLANK_FLOATING, _version: "1.0"
  };
}

/* ------------------------------------------------------------------ *
 * CLI.  node zonecast.js --kind zoned --zone America/New_York \       *
 *         --home Europe/London 2026-06-20T23:00                       *
 * Prints the JSON result. Exit 0 on ok:true, 1 on ok:false (blank).   *
 * ------------------------------------------------------------------ */
function usage() {
  return "usage: zonecast.js [--kind floating|zoned] [--zone IANA] [--home IANA] WALLCLOCK\n" +
         "  WALLCLOCK is YYYY-MM-DDTHH:MM[:SS] (no offset, no trailing Z).\n" +
         "  --zone is required for --kind zoned (the zone the wall-clock was written in).\n" +
         "  --home is the viewer's IANA zone; omitted -> the host's detected zone.";
}

function main(argv) {
  var args = argv.slice(2);
  var kind = "floating", zone = "", home = "", wall = null, i;
  for (i = 0; i < args.length; i++) {
    var a = args[i];
    if (a === "--help" || a === "-h") { process.stdout.write(usage() + "\n"); process.exit(0); }
    else if (a === "--kind") { kind = args[++i]; }
    else if (a === "--zone") { zone = args[++i]; }
    else if (a === "--home") { home = args[++i]; }
    else if (a.slice(0, 2) === "--") { process.stderr.write("zonecast: unknown option " + a + "\n" + usage() + "\n"); process.exit(2); }
    else { wall = a; }
  }
  if (wall === null) { process.stderr.write("zonecast: a WALLCLOCK argument is required\n" + usage() + "\n"); process.exit(2); }
  var value = (kind === "zoned") ? { wallClock: wall, zone: zone } : wall;
  var r = cast(value, kind, home || undefined);
  process.stdout.write(JSON.stringify(r) + "\n");
  process.exit(r.ok ? 0 : 1);
}

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  main(process.argv);
}
