#!/usr/bin/env node
/* test_reltime.js — proves the label is honest, exact, and deterministic.

   The honesty rules ARE the tool, so the test's real job is to prove each
   REFUSAL fires (null, not a fabricated label) and each threshold is exact. The
   clock is injected, so every case is deterministic with no wall clock. A
   mutation bite guards against a vacuously-green run. Exit 0 = all pass, exit 1
   = a failure (loud). stdlib only, no dependencies. */
"use strict";
var relativeTime = require("./reltime.js").relativeTime;

var pass = 0, fail = 0;
function eq(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.error("FAIL " + name + "\n  got:  " + g + "\n  want: " + w); }
}

// A fixed "now" so every case is deterministic. 2026-06-27T12:00:00Z.
var NOW = Date.parse("2026-06-27T12:00:00Z");
function ago(ms) { return new Date(NOW - ms).toISOString(); }
var MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR, WEEK = 7 * DAY;

// --- flag-don't-fake: every "no honest label" case returns null -------------
eq("null stamp -> null",        relativeTime(null, NOW), null);
eq("undefined stamp -> null",   relativeTime(undefined, NOW), null);
eq("empty string -> null",      relativeTime("", NOW), null);
eq("unparseable -> null",       relativeTime("not a date", NOW), null);
eq("garbage -> null",           relativeTime("2026-13-99", NOW), null);
eq("future stamp -> null",      relativeTime(ago(-HOUR), NOW), null); // 1h in the FUTURE

// --- relative band, exact thresholds ---------------------------------------
eq("0ms -> just now",           relativeTime(ago(0), NOW), "just now");
eq("59s -> just now",           relativeTime(ago(59 * 1000), NOW), "just now");
eq("60s -> 1m ago",             relativeTime(ago(MIN), NOW), "1m ago");
eq("59m -> 59m ago",            relativeTime(ago(59 * MIN), NOW), "59m ago");
eq("60m -> 1h ago",             relativeTime(ago(HOUR), NOW), "1h ago");
eq("23h -> 23h ago",            relativeTime(ago(23 * HOUR), NOW), "23h ago");
eq("24h -> 1d ago",             relativeTime(ago(DAY), NOW), "1d ago");
eq("6d -> 6d ago",              relativeTime(ago(6 * DAY), NOW), "6d ago");

// --- absolute band (>= 1 week): the real date it landed --------------------
eq("7d -> absolute date",       relativeTime(ago(WEEK), NOW), "Jun 20");
eq("30d same year -> date",     relativeTime(ago(30 * DAY), NOW), "May 28");
eq("across a year boundary",    relativeTime("2025-12-31T00:00:00Z", NOW), "Dec 31, 2025");

// --- determinism: same inputs, same output ---------------------------------
eq("deterministic",             relativeTime(ago(3 * HOUR), NOW), relativeTime(ago(3 * HOUR), NOW));

// --- coercion / robustness --------------------------------------------------
eq("non-string stamp -> null",  relativeTime(12345, NOW), null); // a number is not an ISO string here

// --- mutation bite: the future-guard MUST be load-bearing ------------------
//    If someone deleted `if (delta < 0) return null;`, a future stamp would
//    produce "just now" (delta<MIN with negative delta). Assert it does NOT.
var futureResult = relativeTime(ago(-HOUR), NOW);
if (futureResult === null) { pass++; }
else { fail++; console.error("FAIL mutation-bite: future stamp produced a label: " + JSON.stringify(futureResult)); }

console.log("\nreltime: " + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
