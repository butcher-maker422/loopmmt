#!/usr/bin/env node
/*
 * timesheet — a floor-biased time-worked report folded from git commit timestamps.
 * MIT · zero-dependency · standalone gift stripped from Loop MMT's The Timesheet.
 *
 * THE PRINTED EDGE (read before trusting a number):
 *   Commit timestamps BOUND work; they do NOT MEASURE it. "Hours worked" here is a
 *   MODEL OUTPUT, not a measured truth:
 *       worked(day) = Σ over consecutive commits of min(gap, breakGap)
 *   i.e. day-span minus every inter-commit gap longer than the break threshold.
 *   It is FLOOR-BIASED on purpose: a gap over the threshold counts as a break worth
 *   zero, and an isolated commit contributes zero span — so it UNDER-counts real time
 *   rather than inflating it. It is a derivation (⊢), never a measured truth (⊨). It
 *   is NOT a timeclock: do not bill a client to the minute or adjudicate hours with it.
 *   The one judgment call, --break-gap (default 30 min), is printed in every report so
 *   the number always carries its own assumption.
 *
 * USAGE:
 *   git log --format='%H %at %s' | node timesheet.js
 *   git log --format='%H %at %s' | node timesheet.js --break-gap 45 --tz America/New_York
 *   node timesheet.js --help
 *
 * INPUT: one commit per line on stdin: "<sha> <author-epoch-seconds> <subject...>".
 *   %at is the AUTHOR epoch (integer seconds, timezone-independent). committer-date
 *   (%ct) works too but author-date is the conventional "when the work happened".
 *
 * DETERMINISM: the output is a pure function of (input lines, --break-gap, --tz). No
 *   wall-clock is read; the report stamps the commit range, not a generation time — so
 *   the same input always produces byte-identical output.
 */
'use strict';

const SEC = 1000; // this file works in SECONDS throughout; epochs are integer seconds.
const DEFAULT_BREAK_GAP_MIN = 30;
const DEFAULT_TZ = 'UTC';

// ---- core fold (the whole gift; pure, exported for require) --------------------
function computeTimesheet(commits, opts) {
  // commits: [{ sha, epoch (int seconds), subject }]
  // opts: { breakGapMin, tz }
  const breakGap = (opts.breakGapMin != null ? opts.breakGapMin : DEFAULT_BREAK_GAP_MIN) * 60; // seconds
  const tz = opts.tz || DEFAULT_TZ;

  // sort by epoch ascending (stable, deterministic)
  const cs = commits.slice().sort((a, b) => a.epoch - b.epoch || (a.sha < b.sha ? -1 : a.sha > b.sha ? 1 : 0));

  // bucket by calendar day IN the report timezone
  const byDay = new Map();
  for (const c of cs) {
    const day = dayKey(c.epoch, tz);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(c);
  }

  const days = [];
  for (const day of Array.from(byDay.keys()).sort()) {
    const dcs = byDay.get(day); // already epoch-ascending (built from sorted cs)
    let worked = 0, brk = 0, runs = 1;
    for (let i = 0; i + 1 < dcs.length; i++) {
      const gap = dcs[i + 1].epoch - dcs[i].epoch;
      if (gap > breakGap) { brk += gap; runs += 1; }
      else { worked += gap; }
    }
    days.push({
      date: day,
      startEpoch: dcs[0].epoch,
      endEpoch: dcs[dcs.length - 1].epoch,
      worked, breakTime: brk, runs, nCommits: dcs.length,
    });
  }

  const totalWorked = days.reduce((s, d) => s + d.worked, 0);
  const totalCommits = days.reduce((s, d) => s + d.nCommits, 0);

  return {
    days,
    totalWorked,      // seconds
    totalCommits,
    nDays: days.length,
    breakGapMin: breakGap / 60,
    tz,
    firstSha: cs.length ? cs[0].sha : null,
    lastSha: cs.length ? cs[cs.length - 1].sha : null,
    byWeek: rollup(days, weekKey),
    byMonth: rollup(days, d => d.date.slice(0, 7)),
  };
}

function rollup(days, keyfn) {
  const buckets = new Map();
  const order = [];
  for (const d of days) {
    const k = keyfn(d);
    if (!buckets.has(k)) { buckets.set(k, { label: k, worked: 0, nCommits: 0, nDays: 0 }); order.push(k); }
    const b = buckets.get(k);
    b.worked += d.worked; b.nCommits += d.nCommits; b.nDays += 1;
  }
  return order.map(k => buckets.get(k));
}

// ---- timezone-aware day + ISO-week keys, stdlib Intl only (no deps) -------------
function dayKey(epochSec, tz) {
  // Format the epoch in the target tz as YYYY-MM-DD, deterministically.
  const d = new Date(epochSec * SEC);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const g = t => parts.find(p => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

function weekKey(dayRec) {
  // ISO week from the day's YYYY-MM-DD (tz already applied when the day was bucketed).
  const [y, m, dd] = dayRec.date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, dd));
  const dayNum = (dt.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  dt.setUTCDate(dt.getUTCDate() - dayNum + 3); // Thursday of this week
  const firstThu = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((dt - firstThu) / (7 * 24 * 3600 * SEC)));
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ---- render (plain text, deterministic) ----------------------------------------
function fmtHM(sec) {
  const t = Math.floor(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
function hours(sec) { return Math.round((sec / 3600) * 100) / 100; }
function grp(n) { return typeof n === 'number' && Number.isInteger(n) ? n.toLocaleString('en-US') : String(n); }

function render(ts) {
  if (ts.nDays === 0) return 'Work Timesheet\n\nNo commits in input.\n';
  const L = [];
  L.push('Work Timesheet');
  L.push('');
  L.push(`Span: ${ts.days[0].date} .. ${ts.days[ts.nDays - 1].date}  ·  Days worked: ${grp(ts.nDays)}  ·  Commits: ${grp(ts.totalCommits)}`);
  L.push(`Total time (model): ${fmtHM(ts.totalWorked)}  (${hours(ts.totalWorked)} h)`);
  L.push(`Timezone: ${ts.tz}  ·  Break threshold: ${ts.breakGapMin} min  ·  Range: ${ts.firstSha}..${ts.lastSha}`);
  L.push('');
  L.push('What this measures: time bracketed by commits, not time at the keyboard.');
  L.push('worked = day-span − every gap longer than the break threshold. Floor-biased:');
  L.push('it under-counts (isolated commit = 0, invisible thinking = 0), never inflates.');
  L.push('A derivation (⊢), not a truth (⊨). Not a timeclock.');
  L.push('');
  L.push('By month');
  for (const b of ts.byMonth) L.push(`  ${b.label}  ·  ${fmtHM(b.worked)}  ·  ${grp(b.nDays)} day(s)  ·  ${grp(b.nCommits)} commit(s)`);
  L.push('');
  L.push('By week');
  for (const b of ts.byWeek) L.push(`  ${b.label}  ·  ${fmtHM(b.worked)}  ·  ${grp(b.nDays)} day(s)  ·  ${grp(b.nCommits)} commit(s)`);
  L.push('');
  L.push('By day');
  for (const d of ts.days) L.push(`  ${d.date}  ·  ${fmtHM(d.worked)}  ·  ${grp(d.nCommits)} commit(s)  ·  ${d.runs} run(s)`);
  L.push('');
  return L.join('\n') + '\n';
}

// ---- parse stdin lines ----------------------------------------------------------
function parseLines(text) {
  const commits = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\S+)\s+(\d+)\s?(.*)$/);
    if (!m) continue;
    commits.push({ sha: m[1], epoch: parseInt(m[2], 10), subject: m[3] || '' });
  }
  return commits;
}

// ---- CLI ------------------------------------------------------------------------
function parseArgs(argv) {
  const o = { breakGapMin: DEFAULT_BREAK_GAP_MIN, tz: DEFAULT_TZ, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--break-gap') o.breakGapMin = parseInt(argv[++i], 10);
    else if (a === '--tz') o.tz = argv[++i];
  }
  return o;
}

const HELP = `timesheet — floor-biased time-worked report from git commit timestamps (MIT, zero-dep)

  git log --format='%H %at %s' | node timesheet.js [--break-gap MIN] [--tz ZONE]

  --break-gap MIN   gap over MIN minutes counts as a break worth zero (default 30)
  --tz ZONE         IANA timezone for day bucketing (default UTC)
  --help            this text

EDGE: commit timestamps BOUND work, they do not MEASURE it. This is a floor-biased
model output (⊢), never a measured truth (⊨) — it under-counts on purpose. Not a
timeclock; do not bill or adjudicate hours with it. The --break-gap assumption is
printed in every report.
`;

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { process.stdout.write(HELP); return; }
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { input += d; });
  process.stdin.on('end', () => {
    const commits = parseLines(input);
    const ts = computeTimesheet(commits, opts);
    process.stdout.write(render(ts));
  });
}

if (typeof window !== 'undefined') {
  window.LoopGifts = window.LoopGifts || {};
  window.LoopGifts.timesheet = { computeTimesheet, render, parseLines };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeTimesheet, render, parseLines, fmtHM, weekKey, dayKey };
}
if (typeof require !== 'undefined' && require.main === module) {
  main();
}
