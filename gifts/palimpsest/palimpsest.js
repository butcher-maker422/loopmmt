#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */
/* palimpsest.js — layer every version of a text, find the load-bearing core.
 *
 * A palimpsest is a manuscript rewritten over an erased earlier one, where the
 * old writing still shows through. Give this tool the successive versions of a
 * prompt (or any text) in order — v1, v2, … vN — and it shows you what showed
 * THROUGH every rewrite: the lines that survived revision after revision (the
 * load-bearing CORE) versus the lines that came and went (CHURN).
 *
 *     v1.txt v2.txt … vN.txt ──▶ layer(versions)
 *                            ──▶ { core:[…], churn:[…], survival:{line→rate} }
 *
 * WHAT IT MEASURES. For each distinct line, its SURVIVAL RATE = (number of
 * versions the line appears in) / (number of versions). A line present in all N
 * versions has survival 1.0; a line in one version has survival 1/N. The CORE is
 * every line whose survival ≥ a threshold (default 1.0 — present in ALL versions);
 * CHURN is the rest. Lower the threshold with --core to loosen "load-bearing"
 * (e.g. --core 0.5 = present in at least half the versions).
 *
 * DETERMINISM (the promise, and the self-test that proves it). A line is keyed by
 * its canonical form (trimmed of trailing whitespace; interior preserved). Output
 * is sorted — core and churn each by descending survival then by the line's first
 * appearance (the version index it entered), so the result is a pure function of
 * the inputs: same versions, same bytes, every run. `--selftest` proves the key is
 * idempotent and the layering is stable.
 *
 * THE LINE IT WILL NOT CROSS (the honest ceiling — printed every --help/--list).
 * palimpsest measures SURVIVAL, not QUALITY. A line that survived every draft is
 * load-bearing to the AUTHOR — it is not thereby correct, good, or necessary. A
 * mistake copied faithfully through every version survives with rate 1.0 and lands
 * in the core. Persistence is evidence of intent, never of merit. A human reads
 * the core and decides what it means; the tool only makes survival visible and exact.
 *
 * EXIT CODES (analysis convention, gate-friendly).
 *   0  ran clean — a survival map was produced (this is the normal result; unlike a
 *      two-file diff there is no "they differ" state — an N-version fold always
 *      yields a map).
 *   2  input could not be used (fewer than one version, a missing/unreadable/
 *      directory path, or a --core outside [0,1]) — always a clean one-line
 *      message, never a stack trace.
 *
 * Runs identically in Node and in a browser (no DOM, no deps). MIT.
 */

'use strict';

var CEILING =
  'ceiling: palimpsest measures SURVIVAL, not QUALITY. A line that survived every\n' +
  '  draft is load-bearing to the author — not thereby correct, good, or necessary.\n' +
  '  A mistake copied through every version survives too. A human reads the core.';

/* ---- canonical form of a line (idempotent) --------------------------------
 * Trailing whitespace is churn no reader intends; interior whitespace is content.
 * Trimming only the end makes canon(canon(x)) === canon(x). We do NOT lowercase
 * or collapse interior space: two lines that differ in real content are different
 * lines, and that is exactly the signal we are counting.
 */
function canonLine(s) {
  return String(s).replace(/[ \t\r]+$/, '');
}

/* Split a version's raw text into canonical lines. Blank lines are dropped: an
 * empty line is layout, not content, and counting it would let indentation churn
 * masquerade as a surviving core line. */
function linesOf(raw) {
  var out = [];
  var parts = String(raw).split('\n');
  for (var i = 0; i < parts.length; i++) {
    var c = canonLine(parts[i]);
    if (c.length > 0) out.push(c);
  }
  return out;
}

/* ---- the fold -------------------------------------------------------------
 * versions: array of raw strings, in chronological order (v1 … vN).
 * opts.core: survival threshold in [0,1] for a line to count as CORE (default 1.0).
 * Returns { n, core:[{line,survival,enteredAt}], churn:[…], survival:{line:rate} }.
 * A line is counted ONCE PER VERSION (presence, not frequency): a line repeated
 * three times in v2 still contributes a single "present in v2". Survival is about
 * persistence across versions, not repetition within one.
 */
function layer(versions, opts) {
  opts = opts || {};
  var threshold = (opts.core === undefined || opts.core === null) ? 1.0 : opts.core;
  var n = versions.length;
  // presence[line] = set of version indices it appears in; firstSeen[line] = min index.
  var presence = Object.create(null);
  var firstSeen = Object.create(null);
  for (var v = 0; v < n; v++) {
    var seenThisVersion = Object.create(null);
    var ls = linesOf(versions[v]);
    for (var j = 0; j < ls.length; j++) {
      var line = ls[j];
      if (seenThisVersion[line]) continue;      // count once per version
      seenThisVersion[line] = true;
      if (!presence[line]) { presence[line] = 0; firstSeen[line] = v; }
      presence[line] += 1;
    }
  }
  var survival = Object.create(null);
  var rows = [];
  var keys = Object.keys(presence);
  for (var k = 0; k < keys.length; k++) {
    var ln = keys[k];
    var rate = presence[ln] / n;
    survival[ln] = rate;
    rows.push({ line: ln, survival: rate, enteredAt: firstSeen[ln] });
  }
  // Deterministic order: survival desc, then enteredAt asc, then line asc (total order).
  rows.sort(function (a, b) {
    if (b.survival !== a.survival) return b.survival - a.survival;
    if (a.enteredAt !== b.enteredAt) return a.enteredAt - b.enteredAt;
    return a.line < b.line ? -1 : (a.line > b.line ? 1 : 0);
  });
  var core = [], churn = [];
  for (var r = 0; r < rows.length; r++) {
    (rows[r].survival >= threshold ? core : churn).push(rows[r]);
  }
  return { n: n, core: core, churn: churn, survival: survival };
}

/* ---- rendering (deterministic text report) -------------------------------- */
function render(result) {
  var out = [];
  out.push('palimpsest — ' + result.n + ' version' + (result.n === 1 ? '' : 's') + ' layered');
  out.push('');
  out.push('CORE (load-bearing — survived the threshold):');
  if (result.core.length === 0) {
    out.push('  (none)');
  } else {
    for (var i = 0; i < result.core.length; i++) {
      out.push('  ' + pct(result.core[i].survival) + '  ' + result.core[i].line);
    }
  }
  out.push('');
  out.push('CHURN (came and went):');
  if (result.churn.length === 0) {
    out.push('  (none)');
  } else {
    for (var j = 0; j < result.churn.length; j++) {
      out.push('  ' + pct(result.churn[j].survival) + '  ' + result.churn[j].line);
    }
  }
  return out.join('\n');
}

function pct(rate) {
  // Fixed-width, deterministic: "100%", " 50%", " 33%". Integer floor of rate*100,
  // right-justified to 3 cols, plus '%'. Rounding is not used (would be locale-free
  // but still add ambiguity at .5); floor is exact and stable.
  var p = Math.floor(rate * 100 + 1e-9);
  var s = String(p);
  while (s.length < 3) s = ' ' + s;
  return s + '%';
}

/* ---- self-test (proves the promises) -------------------------------------- */
function selftest() {
  var fail = [];
  // 1. canon idempotence
  var samples = ['a', 'a  ', '  keep interior ', 'tab\there\t', ''];
  for (var i = 0; i < samples.length; i++) {
    var once = canonLine(samples[i]);
    if (canonLine(once) !== once) fail.push('canon not idempotent on ' + JSON.stringify(samples[i]));
  }
  // 2. a line in all versions has survival 1.0 and lands in the default core
  var vs = ['keep\ndrop1', 'keep\ndrop2', 'keep\ndrop3'];
  var res = layer(vs, {});
  if (!(res.survival['keep'] === 1.0)) fail.push('all-versions line survival != 1.0');
  if (!(res.core.length === 1 && res.core[0].line === 'keep')) fail.push('core is not exactly [keep]');
  if (res.churn.length !== 3) fail.push('churn count != 3');
  // 3. layering is stable: same inputs -> byte-identical render
  if (render(layer(vs, {})) !== render(layer(vs, {}))) fail.push('render not stable across runs');
  // 4. presence counted once per version (repetition within a version does not inflate survival)
  var rep = layer(['x\nx\nx', 'y'], {});
  if (rep.survival['x'] !== 0.5) fail.push('within-version repetition inflated survival');
  // 5. threshold loosening moves lines from churn to core monotonically
  var loose = layer(vs, { core: 0.0 });
  if (loose.churn.length !== 0) fail.push('core 0.0 left churn nonempty');
  // 6. trailing whitespace is not a distinct line (canon merge)
  var ws = layer(['line  \nline', 'line'], {});
  if (Object.keys(ws.survival).length !== 1) fail.push('trailing-ws produced a distinct line');
  return fail;
}

/* ---- CLI ------------------------------------------------------------------ */
function fail2(msg) {
  process.stderr.write('palimpsest: ' + msg + '\n');
  process.exit(2);
}

function main(argv) {
  var args = argv.slice(2);
  if (args.indexOf('--help') !== -1 || args.indexOf('-h') !== -1) {
    process.stdout.write(usage() + '\n\n' + CEILING + '\n');
    return 0;
  }
  if (args.indexOf('--list') !== -1) {
    process.stdout.write(CEILING + '\n');
    return 0;
  }
  if (args.indexOf('--selftest') !== -1) {
    var fails = selftest();
    if (fails.length === 0) { process.stdout.write('selftest: OK (6 checks)\n'); return 0; }
    process.stderr.write('selftest: FAIL\n  ' + fails.join('\n  ') + '\n');
    process.exit(1);
  }
  // parse --core <t> and collect file paths
  var threshold = 1.0, paths = [], i;
  for (i = 0; i < args.length; i++) {
    if (args[i] === '--core') {
      var t = parseFloat(args[i + 1]);
      if (isNaN(t) || t < 0 || t > 1) fail2('--core must be a number in [0,1]');
      threshold = t; i++;
    } else if (args[i].charAt(0) === '-') {
      fail2('unknown option: ' + args[i]);
    } else {
      paths.push(args[i]);
    }
  }
  if (paths.length < 1) fail2('need at least one version file (give them in order v1 … vN)');
  var fs = require('fs');
  var versions = [];
  for (i = 0; i < paths.length; i++) {
    var raw;
    try {
      var st = fs.statSync(paths[i]);
      if (st.isDirectory()) fail2('is a directory, not a file: ' + paths[i]);
      raw = fs.readFileSync(paths[i], 'utf8');
    } catch (e) {
      fail2('cannot read ' + paths[i] + ' (' + (e && e.code ? e.code : 'unreadable') + ')');
    }
    versions.push(raw);
  }
  var result = layer(versions, { core: threshold });
  process.stdout.write(render(result) + '\n');
  return 0;
}

function usage() {
  return [
    'palimpsest — layer every version of a text, find the load-bearing core vs churn.',
    '',
    'usage: palimpsest [--core <t>] <v1> <v2> ... <vN>',
    '       palimpsest --selftest',
    '',
    '  <v1> … <vN>   version files IN ORDER (oldest first). At least one.',
    '  --core <t>    survival threshold in [0,1] for CORE (default 1.0 = in every version).',
    '  --selftest    prove the canon is idempotent and the layering is stable.',
    '  --help        this message.   --list  the ceiling only.',
    '',
    'Each line\'s SURVIVAL RATE = (versions it appears in) / (number of versions).',
    'CORE = survival ≥ threshold; CHURN = the rest. Output is sorted, deterministic.'
  ].join('\n');
}

/* Dual use: CLI when run directly, library when required (Node or browser). */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { layer: layer, canonLine: canonLine, linesOf: linesOf, render: render, selftest: selftest };
}
if (typeof require !== 'undefined' && require.main === module) {
  main(process.argv);
}
