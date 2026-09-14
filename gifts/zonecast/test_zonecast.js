#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */
/* test_zonecast.js — the drift-check battery for the zonecast gift.
 *
 * THE ORACLE IS OUT-OF-BAND. The zoned conversions are checked against an
 * INDEPENDENT computation of the same instant built directly from Node's own
 * Intl.DateTimeFormat + Date — NOT against numbers the gift produced, and NOT
 * against author-eyeballed constants. For each zoned case we (a) compute the true
 * UTC instant of the source wall-clock-in-its-zone using a from-scratch Intl offset
 * probe, (b) format THAT instant in the home zone with a second independent Intl
 * formatter, and (c) assert the gift's {dayKey,time} equals that oracle formatting.
 * If Node's tzdata says 23:00 New York is 04:00 next-day London, the gift must agree.
 *
 * KNOWN-BAD TRIPWIRES (the covenant's "name the known-bad vector"):
 *   - a DST spring-forward day (US 2026-03-08 02:30 does not exist) — the gift must
 *     still return a coherent, non-throwing result, and must agree with the oracle's
 *     first-valid reading.
 *   - an offset-bearing string ("...Z" / "...+05:00") — MUST blank, never reinterpret.
 *   - a zoned value with no zone — MUST blank, never fall through to floating.
 *
 * Run: node test_zonecast.js   (exit 0 all pass, 1 on any failure)
 */
"use strict";

var Z = require("./zonecast.js");

var passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; }
  else { failed++; process.stderr.write("FAIL: " + msg + "\n"); }
}
function eq(a, b, msg) { ok(a === b, msg + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }

/* ---- the INDEPENDENT oracle (built only from Node Intl + Date) ------------------ */
function oracleParts(instantMs, zone) {
  var dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  var p = {}, arr = dtf.formatToParts(new Date(instantMs));
  for (var i = 0; i < arr.length; i++) if (arr[i].type !== "literal") p[arr[i].type] = arr[i].value;
  var h = p.hour === "24" ? "00" : p.hour;
  return { dayKey: p.year + "-" + p.month + "-" + p.day, time: h + ":" + p.minute };
}
// true UTC instant of a wall-clock interpreted in `zone` — an independent 2-pass probe
function oracleInstant(y, mo, d, h, mi, zone) {
  var asUTC = Date.UTC(y, mo - 1, d, h, mi, 0);
  function offAt(ms) {
    var op = oracleParts(ms, zone);
    var pm = op.dayKey.split("-"), tm = op.time.split(":");
    var back = Date.UTC(+pm[0], +pm[1] - 1, +pm[2], +tm[0], +tm[1], 0);
    return ms - back;
  }
  var inst = asUTC + offAt(asUTC);
  var o2 = offAt(inst);
  if (asUTC + o2 !== inst) inst = asUTC + o2;
  return inst;
}
// full oracle: what does a viewer in homeZone see for wall-clock-in srcZone?
function oracleSees(y, mo, d, h, mi, srcZone, homeZone) {
  return oracleParts(oracleInstant(y, mo, d, h, mi, srcZone), homeZone);
}

/* ======================= 1. FLOATING — verbatim passthrough ======================= */
(function () {
  var r = Z.cast("2026-06-20T11:00", "floating");
  ok(r.ok, "floating string ok");
  eq(r.time, "11:00", "floating time verbatim");
  eq(r.dayKey, "2026-06-20", "floating day verbatim");
  eq(r.zone, null, "floating has no zone");
  // floating ignores kind-less / unknown kind -> treated as floating (cold-safe)
  var r2 = Z.cast("2026-01-01T00:00", "something-else");
  ok(r2.ok && r2.kind === "floating", "unknown kind -> floating");
  // floating accepts an object carrier
  var r3 = Z.cast({ wallClock: "2026-12-31T23:59" }, "floating");
  eq(r3.time, "23:59", "floating object carrier");
  // seconds accepted, dropped from display time (HH:MM), day preserved
  var r4 = Z.cast("2026-06-20T11:00:45", "floating");
  ok(r4.ok, "floating with seconds ok");
  eq(r4.time, "11:00", "floating drops seconds from time");
})();

/* ======================= 2. ZONED — checked against the oracle ===================== */
var zonedCases = [
  // [y,mo,d,h,mi, srcZone, homeZone, label]
  [2026, 6, 20, 23, 0, "America/New_York", "Europe/London", "NY 23:00 summer -> London"],
  [2026, 6, 20, 9, 0, "Europe/London", "America/New_York", "London 09:00 summer -> NY"],
  [2026, 1, 15, 12, 0, "America/New_York", "Asia/Tokyo", "NY noon winter -> Tokyo"],
  [2026, 1, 15, 12, 0, "Asia/Tokyo", "America/New_York", "Tokyo noon winter -> NY (prev day)"],
  [2026, 6, 20, 0, 30, "Pacific/Kiritimati", "Pacific/Honolulu", "far +14 -> far -10 (day jump)"],
  [2026, 3, 1, 8, 0, "Australia/Sydney", "Europe/Paris", "Sydney -> Paris"],
  [2026, 6, 20, 23, 0, "America/New_York", "America/New_York", "same zone identity"]
];
zonedCases.forEach(function (c) {
  var y = c[0], mo = c[1], d = c[2], h = c[3], mi = c[4], src = c[5], home = c[6], label = c[7];
  var wall = y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0") +
             "T" + String(h).padStart(2, "0") + ":" + String(mi).padStart(2, "0");
  var got = Z.cast({ wallClock: wall, zone: src }, "zoned", home);
  var want = oracleSees(y, mo, d, h, mi, src, home);
  ok(got.ok, "zoned ok: " + label);
  eq(got.dayKey, want.dayKey, "zoned dayKey vs oracle: " + label);
  eq(got.time, want.time, "zoned time vs oracle: " + label);
  eq(got.zone, home, "zoned reports home zone: " + label);
});

/* same-zone identity: seen from its own zone, the wall-clock is unchanged */
(function () {
  var r = Z.cast({ wallClock: "2026-06-20T23:00", zone: "America/New_York" }, "zoned", "America/New_York");
  eq(r.time, "23:00", "same-zone time unchanged");
  eq(r.dayKey, "2026-06-20", "same-zone day unchanged");
})();

/* zone aliases (ianaZone / tzid) resolve identically to `zone` */
(function () {
  var base = Z.cast({ wallClock: "2026-06-20T23:00", zone: "America/New_York" }, "zoned", "Europe/London");
  var alias1 = Z.cast({ wallClock: "2026-06-20T23:00", ianaZone: "America/New_York" }, "zoned", "Europe/London");
  var alias2 = Z.cast({ wallClock: "2026-06-20T23:00", tzid: "America/New_York" }, "zoned", "Europe/London");
  eq(alias1.wallClock, base.wallClock, "ianaZone alias == zone");
  eq(alias2.wallClock, base.wallClock, "tzid alias == zone");
})();

/* ======================= 3. DST edges (known-bad tripwires) ======================= */
(function () {
  // US spring-forward 2026-03-08: 02:00 -> 03:00, so 02:30 does not exist locally.
  // The gift must not throw and must agree with the oracle's resolution.
  var got = Z.cast({ wallClock: "2026-03-08T02:30", zone: "America/New_York" }, "zoned", "UTC");
  ok(got.ok, "spring-forward gap resolves (no throw)");
  var want = oracleSees(2026, 3, 8, 2, 30, "America/New_York", "UTC");
  eq(got.time, want.time, "spring-forward time agrees with oracle");
  eq(got.dayKey, want.dayKey, "spring-forward day agrees with oracle");
  // US fall-back 2026-11-01: 02:00 -> 01:00, so 01:30 is ambiguous (occurs twice).
  var got2 = Z.cast({ wallClock: "2026-11-01T01:30", zone: "America/New_York" }, "zoned", "UTC");
  ok(got2.ok, "fall-back fold resolves (no throw)");
  var want2 = oracleSees(2026, 11, 1, 1, 30, "America/New_York", "UTC");
  eq(got2.time, want2.time, "fall-back time agrees with oracle");
})();

/* ======================= 4. HONEST EDGES (flag, don't fake) ======================= */
(function () {
  // missing / malformed
  ok(!Z.cast(null, "floating").ok, "null -> blank");
  ok(!Z.cast(undefined, "zoned").ok, "undefined -> blank");
  ok(!Z.cast("not-a-time", "floating").ok, "garbage -> blank");
  ok(!Z.cast("2026-13-40T99:99", "floating").ok, "out-of-range fields -> blank");
  ok(!Z.cast({}, "floating").ok, "empty object -> blank");
  // offset-bearing strings are REJECTED, never reinterpreted
  ok(!Z.cast("2026-06-20T11:00Z", "floating").ok, "trailing Z rejected");
  ok(!Z.cast("2026-06-20T11:00+05:00", "floating").ok, "explicit offset rejected");
  // zoned with no zone -> blank, never falls through to floating
  ok(!Z.cast({ wallClock: "2026-06-20T23:00" }, "zoned", "Europe/London").ok, "zoned-no-zone -> blank");
  // blanks carry the right kind label
  eq(Z.cast(null, "zoned").kind, "zoned", "blank keeps zoned kind");
  eq(Z.cast(null, "floating").kind, "floating", "blank keeps floating kind");
  // an unresolvable home zone is never assumed UTC -> blank (bogus zone name)
  ok(!Z.cast({ wallClock: "2026-06-20T23:00", zone: "America/New_York" }, "zoned", "Not/AZone").ok,
     "bogus home zone -> blank, never UTC");
  // a bogus SOURCE zone also blanks
  ok(!Z.cast({ wallClock: "2026-06-20T23:00", zone: "Not/AZone" }, "zoned", "UTC").ok,
     "bogus source zone -> blank");
})();

/* ======================= 5. DETERMINISM (canonicalizer self-test) ================= */
(function () {
  // same inputs -> byte-identical JSON, every run. The gift is a pure function, so
  // repeated evaluation must never drift (this IS the determinism lint).
  var val = { wallClock: "2026-06-20T23:00", zone: "America/New_York" };
  var first = JSON.stringify(Z.cast(val, "zoned", "Europe/London"));
  for (var i = 0; i < 50; i++) {
    ok(JSON.stringify(Z.cast(val, "zoned", "Europe/London")) === first, "deterministic run " + i);
  }
})();

/* ---- report ---- */
if (failed === 0) {
  process.stdout.write("GREEN: " + passed + " assertions passed, 0 failed  [test_zonecast]\n");
  process.exit(0);
} else {
  process.stdout.write("RED: " + passed + " passed, " + failed + " FAILED  [test_zonecast]\n");
  process.exit(1);
}
