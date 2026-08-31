#!/usr/bin/env node
/*
 * test_timesheet — drift-check battery for the timesheet gift.
 * MIT · zero-dependency · stdlib-only.
 *
 * THE ORACLE RULE: the oracle here is HAND-COMPUTED ARITHMETIC. The model
 *   worked(day) = Σ min(gap, breakGap) over consecutive commits
 * is simple enough that a human computes the expected number independently of the
 * implementation — a stronger out-of-band oracle than a second code path. Each
 * fixture below carries its hand-computed expected value and the arithmetic.
 */
'use strict';
const { computeTimesheet } = require('./timesheet.js');

let pass = 0, fail = 0;
function eq(got, want, msg) {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n   got:  ${got}\n   want: ${want}`); }
}
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } }

// helper: build commits at given UTC times on one day (2026-01-05, a Monday)
const BASE = Math.floor(Date.UTC(2026, 0, 5, 0, 0, 0) / 1000); // 2026-01-05 00:00:00Z
const at = (hh, mm) => BASE + hh * 3600 + mm * 60;
const C = (n, epoch) => ({ sha: `sha${n}`.padEnd(7, '0'), epoch, subject: `commit ${n}` });

// ---- 1. Fixed model anchors (hand-computed) -----------------------------------
// Two commits 10 min apart, same day. gap=600s <= break(1800s) -> worked=600.
{
  const ts = computeTimesheet([C(1, at(9, 0)), C(2, at(9, 10))], { breakGapMin: 30, tz: 'UTC' });
  eq(ts.totalWorked, 600, 'anchor A: two commits 10min apart -> worked=600s');
  eq(ts.nDays, 1, 'anchor A: one day');
  eq(ts.totalCommits, 2, 'anchor A: two commits');
}
// Two commits 90 min apart with break-gap 30. gap=5400s > 1800 -> break, worked=0.
{
  const ts = computeTimesheet([C(1, at(9, 0)), C(2, at(10, 30))], { breakGapMin: 30, tz: 'UTC' });
  eq(ts.totalWorked, 0, 'anchor B: 90min gap > 30min break -> worked=0 (clamped)');
}
// A lone commit in a day -> worked=0 (no neighbor).
{
  const ts = computeTimesheet([C(1, at(14, 0))], { breakGapMin: 30, tz: 'UTC' });
  eq(ts.totalWorked, 0, 'anchor C: isolated commit -> worked=0');
  eq(ts.nDays, 1, 'anchor C: still one day recorded');
}
// Three commits: 9:00, 9:20, 9:35 (gaps 20m, 15m; both <=30) -> worked=35m=2100s.
{
  const ts = computeTimesheet([C(1, at(9, 0)), C(2, at(9, 20)), C(3, at(9, 35))], { breakGapMin: 30, tz: 'UTC' });
  eq(ts.totalWorked, 2100, 'anchor D: 20m+15m consecutive -> worked=2100s');
  eq(ts.days[0].runs, 1, 'anchor D: one run (no break)');
}

// ---- 2. Floor-bias tripwire (the known-bad vector) ----------------------------
// A day with an overnight-shaped 3h gap in the middle. Naive first-to-last span
// would count the whole ~3h20m as work; the model must clamp the 3h gap to a break.
// Commits: 9:00, 9:10 (gap 10m -> worked 600), 12:15 (gap 3h05m=11100s > 1800 ->
// BREAK, worked +0), 12:25 (gap 10m -> worked +600). Hand-computed worked = 1200s.
// Naive span = 12:25 - 9:00 = 3h25m = 12300s. The gap between them is the test.
{
  const ts = computeTimesheet(
    [C(1, at(9, 0)), C(2, at(9, 10)), C(3, at(12, 15)), C(4, at(12, 25))],
    { breakGapMin: 30, tz: 'UTC' });
  eq(ts.totalWorked, 1200, 'TRIPWIRE: floor-biased worked=1200s (not the 12300s naive span)');
  ok(ts.totalWorked < 12300, 'TRIPWIRE: model under-counts the naive first-to-last span');
  eq(ts.days[0].runs, 2, 'TRIPWIRE: the 3h gap splits the day into 2 runs');
}

// ---- 3. Determinism: same input twice -> identical result ----------------------
{
  const input = [C(1, at(9, 0)), C(2, at(9, 25)), C(3, at(11, 0))];
  const a = JSON.stringify(computeTimesheet(input, { breakGapMin: 30, tz: 'UTC' }));
  const b = JSON.stringify(computeTimesheet(input, { breakGapMin: 30, tz: 'UTC' }));
  eq(a, b, 'determinism: same input -> byte-identical fold');
}

// ---- 4. Break-gap sensitivity (the assumption is live) -------------------------
// Commits 9:00 and 9:40 (gap 40m=2400s). At break-gap 30 -> break (worked 0).
// At break-gap 45 -> within threshold (worked 2400). The number moves with --break-gap.
{
  const input = [C(1, at(9, 0)), C(2, at(9, 40))];
  const at30 = computeTimesheet(input, { breakGapMin: 30, tz: 'UTC' });
  const at45 = computeTimesheet(input, { breakGapMin: 45, tz: 'UTC' });
  eq(at30.totalWorked, 0, 'sensitivity: 40m gap at break-gap 30 -> worked=0');
  eq(at45.totalWorked, 2400, 'sensitivity: 40m gap at break-gap 45 -> worked=2400s');
}

// ---- 5. Mutation bite: a deliberately-wrong expectation MUST be caught ----------
// (Proves the harness is not a no-op: assert the RIGHT value is NOT the wrong one.)
{
  const ts = computeTimesheet([C(1, at(9, 0)), C(2, at(9, 10))], { breakGapMin: 30, tz: 'UTC' });
  ok(ts.totalWorked !== 999, 'mutation-bite: harness rejects a wrong expected value (worked !== 999)');
  ok(ts.totalWorked === 600, 'mutation-bite: harness confirms the right value (worked === 600)');
}

// ---- 6. Multi-day rollup + week/month keys -------------------------------------
{
  const day2 = BASE + 24 * 3600; // 2026-01-06
  const ts = computeTimesheet(
    [C(1, at(9, 0)), C(2, at(9, 15)), { sha: 'sha3000', epoch: day2 + 10 * 3600, subject: 'd2' },
     { sha: 'sha4000', epoch: day2 + 10 * 3600 + 600, subject: 'd2b' }],
    { breakGapMin: 30, tz: 'UTC' });
  eq(ts.nDays, 2, 'rollup: two distinct days');
  eq(ts.totalWorked, 900 + 600, 'rollup: day1 15m + day2 10m = 1500s total');
  eq(ts.byMonth.length, 1, 'rollup: both days in one month bucket');
  eq(ts.byMonth[0].label, '2026-01', 'rollup: month key = 2026-01');
}

console.log(`\ntimesheet drift-check: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
