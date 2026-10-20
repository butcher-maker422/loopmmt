#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */
/* scrub.js — catch a secret before it ships, from SHAPES not luck.
 *
 * A tiny, dependency-free scanner that reads text and finds the things that
 * should never have been in it: a GitHub token, an AWS key, a PEM private-key
 * block, a Slack token, a JWT, a bearer password in a URL. It can REPORT them
 * (scan), REPLACE them with a fixed placeholder (scrub), or REFUSE (check —
 * a non-zero exit if any secret is present, so it drops into a pre-commit hook
 * or a CI gate). Runs identically in Node and in a browser (no DOM, no deps).
 *
 *     text ──▶ scan(text)  ──▶ [ {kind, line, col, preview}, ... ]
 *     text ──▶ scrub(text) ──▶ text with every secret span replaced
 *     text ──▶ check(text) ──▶ true iff a secret was found (the gate)
 *
 * WHY SHAPES, AND THE LINE IT WILL NOT CROSS (the honest ceiling — printed).
 * Secrets are matched by SHAPE: a github_pat_ prefix, an AKIA… access-key id,
 * a -----BEGIN … PRIVATE KEY----- header, the three-part dot form of a JWT.
 * A shape catches the known, published forms cheaply and deterministically.
 * It does NOT — and this is stated on the tool itself, every run — prove the
 * text is secret-free. A novel token format, a secret split across lines, a
 * home-rolled scheme, or a value with no distinguishing shape will pass clean.
 * scrub is a SMOKE ALARM, not a vault: a hit is real; a clean scan is the
 * absence of a known shape, never a certificate. (This is the same honesty the
 * `grain` gift prints as "a smell, not a proof" and `plumb` as "evidence
 * exists, not evidence correct".) Treat a clean result as "no KNOWN secret
 * shape found here", and keep your other controls.
 *
 * TWO STRUCTURAL PROMISES (so the tool cannot betray its own purpose):
 *   1. It never echoes a secret. A finding carries the secret's KIND, its line
 *      and column, and a masked PREVIEW (first few chars + …) — never the value.
 *      scrub() replaces the whole matched span; the redaction cannot leak what
 *      it redacted. A secret-scanner that printed the secret to warn you about
 *      it would be broken.
 *   2. scrub() is idempotent and pure: scrub(scrub(t)) === scrub(t), and the
 *      output of scrub() always passes check() clean (no secret survives).
 *      --selftest proves both.
 *
 * THE ALLOW MARKER (the carve-out, kept honest). A single line may opt out by
 * carrying the marker `scrub-allow` (in a comment, anywhere on the line). That
 * line is skipped — for a README that documents a token shape, or a test
 * fixture that must contain a planted example. The carve-out is LINE-scoped and
 * EXPLICIT: you cannot silence the scanner globally, only annotate the one line
 * you vouched for. (Stripped from the band-gate's `band-allow` convention.)
 */

'use strict';

/* The closed set of secret SHAPES. Each: a stable `kind`, a `re` (global,
 * applied per line), and whether it is `heuristic` (higher false-positive rate —
 * a generic "secret-looking assignment", a bare 40-hex that is as often a git
 * commit id, a URL whose password may be a ${PLACEHOLDER}). The list is
 * documented, not open: a shape a real secret needs and this set lacks is a gap
 * to name in the printed ceiling, not a reason to pretend coverage.
 *
 * The block below is RENDERED from a shape register (one list of what a secret
 * looks like, shared with the scanners that guard Loop's own repository), so the
 * gift and those scanners cannot drift apart. Each kind's `re` is the union of
 * every definition registered for it. FIXTURES are fake examples, kept split
 * into parts so this file's own bytes carry no secret shape. */
/* >>> SHAPES rendered from the shape register. Do not hand-edit: the register is
 * re-rendered into this block. Each kind's re is the union of every definition registered for it.
 * FIXTURES are fake examples, split into parts and joined at run time. */
var SHAPES = [
  { kind: "github-pat", heuristic: false, re: new RegExp("(?:github_pat_[A-Za-z0-9_]{20,})|(?:\\bgithub_pat_[A-Za-z0-9_]{20,}\\b)", "g") },
  { kind: "github-token", heuristic: false, re: new RegExp("(?:\\bghp_[A-Za-z0-9]{30,})|(?:\\bgh[ous]_[A-Za-z0-9]{30,})|(?:\\bgh[posru]_[A-Za-z0-9]{36,}\\b)|(?:\\bgh[posu]_[A-Za-z0-9]{20,})", "g") },
  { kind: "gitlab-pat", heuristic: false, re: new RegExp("\\bglpat-[A-Za-z0-9_\\-]{20,}", "g") },
  { kind: "aws-access-key-id", heuristic: false, re: new RegExp("\\bAKIA[0-9A-Z]{16}\\b", "g") },
  { kind: "google-api-key", heuristic: false, re: new RegExp("\\bAIza[0-9A-Za-z_\\-]{35}\\b", "g") },
  { kind: "slack-token", heuristic: false, re: new RegExp("(?:\\bxox[baprs]-[A-Za-z0-9-]{10,})|(?:\\bxox[baprs]-[A-Za-z0-9-]{10,}\\b)", "g") },
  { kind: "stripe-key", heuristic: false, re: new RegExp("\\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\\b", "g") },
  { kind: "openai-key", heuristic: false, re: new RegExp("\\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\\b", "g") },
  { kind: "jwt", heuristic: false, re: new RegExp("\\beyJ[A-Za-z0-9_-]{6,}\\.[A-Za-z0-9_-]{6,}\\.[A-Za-z0-9_-]{6,}\\b", "g") },
  { kind: "private-key-block", heuristic: false, re: new RegExp("(?:-----BEGIN [A-Z ]*PRIVATE KEY-----)|(?:-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----)", "g") },
  { kind: "basic-auth-url", heuristic: true, re: new RegExp("\\b[a-z][a-z0-9+.-]*://[^/\\s:@]+:[^/\\s:@]+@", "g") },
  { kind: "assigned-hex-40", heuristic: false, re: new RegExp("(?:TOKEN|PAT|SECRET)\\s*[:=]\\s*[0-9a-f]{40}\\b", "g") },
  { kind: "hex-40-token", heuristic: true, re: new RegExp("\\b[0-9a-f]{40}\\b", "g") },
  { kind: "secret-assignment", heuristic: true, re: new RegExp("\\b(?:secret|token|api[_-]?key|access[_-]?key|password|passwd|pwd|auth)\\b\\s*[:=]\\s*(?:['\\\"][A-Za-z0-9/+_.=-]{16,}|[A-Za-z0-9/+_.=-]{16,}(?![A-Za-z0-9/+_.=-]|\\s*\\())", "gi") },
  { kind: "basic-auth-url-literal", heuristic: false, re: new RegExp("\\b[a-z][a-z0-9+.-]*://[^/\\s:@$%{}<>\\[\\]()*\\\\'\"`]+:[^/\\s:@$%{}<>\\[\\]()*\\\\'\"`]+@", "g") },
];
var FIXTURES = [
  ["github-pat", ["github", "_pat_", "AAAAAAAAAAAA", "BBBBBBBBBBBBBB"]],
  ["github-token", ["gh", "p_", "AAAAAAAAAAAA", "AAAAAAAAAAAA", "AAAAAAAAAAAA", "AAAA"]],
  ["github-token", ["gh", "s_", "AAAAAAAAAAAA", "AAAAAAAAAAAA", "AAAAAAAAAAAA", "AAAA"]],
  ["gitlab-pat", ["glp", "at-", "AAAAAAAAAAAA", "CCCCCCCC"]],
  ["aws-access-key-id", ["AK", "IA", "EXAMPLE", "000000000"]],
  ["google-api-key", ["AI", "za", "Sy", "AAAAAAAAAAAA", "AAAAAAAAAAAA", "CCCCCCCCC"]],
  ["slack-token", ["xo", "xb-", "1111-", "AAAAAAAAAAAA"]],
  ["stripe-key", ["sk", "_live_", "AAAAAAAAAAAA", "DDDDDDDD"]],
  ["openai-key", ["sk", "-proj-", "AAAAAAAAAAAA", "AAAAAAAAAAAA"]],
  ["jwt", ["ey", "JhbGciOi", ".", "eyJzdWIi", ".", "c2lnbmF0dXJl"]],
  ["private-key-block", ["-----BEGIN ", "RSA PRIVATE", " KEY-----"]],
  ["private-key-block", ["-----BEGIN ", "PRIVATE", " KEY-----"]],
  ["basic-auth-url", ["https://", "demo:", "hunter2hunter2", "@example.invalid/"]],
  ["assigned-hex-40", ["TOK", "EN=", "0123456789abcdef0123", "456789abcdef01234567"]],
  ["hex-40-token", ["0123456789abcdef0123", "456789abcdef01234567"]],
  ["secret-assignment", ["pass", "word: ", "\"", "correcthorse", "batterystaple42", "\""]],
  ["basic-auth-url-literal", ["https://", "demo:", "hunter2hunter2", "@example.invalid/"]],
  ["basic-auth-url-literal", ["file://", "x-access-", "token:T0KEN", "@host/"]],
];
/* <<< SHAPES */

var ALLOW_MARKER = 'scrub-allow';
var PLACEHOLDER = function (kind) { return '\u2039redacted:' + kind + '\u203a'; };

function _mask(s) {
  s = String(s);
  if (s.length <= 4) return '\u2026';
  return s.slice(0, 4) + '\u2026(' + s.length + ')';
}

function _activeShapes(opts) {
  opts = opts || {};
  var wantHeuristic = opts.heuristic !== false; // heuristic ON by default
  return SHAPES.filter(function (s) { return wantHeuristic || !s.heuristic; });
}

/* One OCCURRENCE per token: every match of every active shape on a line, with
 * overlapping matches merged into one span (one token seen by two definitions
 * is one secret, not two). The span keeps the kind of its best match: a decided
 * (non-heuristic) shape beats a heuristic one, then the longer match, then the
 * earlier shape in SHAPES. Deterministic. */
function _occurrences(line, shapes) {
  var spans = [];
  for (var si = 0; si < shapes.length; si++) {
    var re = new RegExp(shapes[si].re.source, shapes[si].re.flags);
    var m;
    while ((m = re.exec(line)) !== null) {
      if (m[0].length) spans.push({ start: m.index, end: m.index + m[0].length, order: si,
                                    kind: shapes[si].kind, heuristic: shapes[si].heuristic, text: m[0] });
      if (m.index === re.lastIndex) re.lastIndex++; // zero-width guard
    }
  }
  spans.sort(function (a, b) { return a.start - b.start || b.end - a.end || a.order - b.order; });
  var groups = [], cur = null;
  for (var i = 0; i < spans.length; i++) {
    var sp = spans[i];
    if (cur && sp.start < cur.end) { cur.members.push(sp); if (sp.end > cur.end) cur.end = sp.end; }
    else { cur = { start: sp.start, end: sp.end, members: [sp] }; groups.push(cur); }
  }
  return groups.map(function (g) {
    var best = g.members.slice().sort(function (a, b) {
      return (a.heuristic - b.heuristic) || ((b.end - b.start) - (a.end - a.start)) || (a.order - b.order);
    })[0];
    return { start: g.start, end: g.end, kind: best.kind, text: best.text };
  });
}

/* scan(text, opts) -> array of findings, each { kind, line, col, preview }.
 * One finding per occurrence, in (line, col) order. A line carrying the allow
 * marker contributes no findings. Never includes the secret value. */
function scan(text, opts) {
  text = String(text == null ? '' : text);
  var shapes = _activeShapes(opts);
  var out = [];
  var lines = text.split('\n');
  for (var li = 0; li < lines.length; li++) {
    if (lines[li].indexOf(ALLOW_MARKER) !== -1) continue; // vouched-for line
    var occ = _occurrences(lines[li], shapes);
    for (var oi = 0; oi < occ.length; oi++) {
      out.push({ kind: occ[oi].kind, line: li + 1, col: occ[oi].start + 1, preview: _mask(occ[oi].text) });
    }
  }
  out.sort(function (a, b) { return a.line - b.line || a.col - b.col || (a.kind < b.kind ? -1 : 1); });
  return out;
}

/* scrub(text, opts) -> text with every occurrence's whole span replaced by a
 * fixed per-kind placeholder. Pure and idempotent. Allow-marked lines pass. */
function scrub(text, opts) {
  text = String(text == null ? '' : text);
  var shapes = _activeShapes(opts);
  var lines = text.split('\n');
  for (var li = 0; li < lines.length; li++) {
    if (lines[li].indexOf(ALLOW_MARKER) !== -1) continue;
    var occ = _occurrences(lines[li], shapes);
    for (var oi = occ.length - 1; oi >= 0; oi--) {
      lines[li] = lines[li].slice(0, occ[oi].start) + PLACEHOLDER(occ[oi].kind) + lines[li].slice(occ[oi].end);
    }
  }
  return lines.join('\n');
}

/* check(text, opts) -> boolean. true iff at least one secret shape is present.
 * The gate: `if (check(diff)) process.exit(1)`. */
function check(text, opts) { return scan(text, opts).length > 0; }

var CEILING =
  'scrub matches KNOWN secret shapes. A clean result means no known shape was ' +
  'found here \u2014 it is NOT proof the text is secret-free: a novel token ' +
  'format, a secret split across lines, or a home-rolled scheme passes clean. ' +
  'It is a smoke alarm, not a vault \u2014 a hit is real, a clean scan is the ' +
  'absence of a known shape, never a certificate. Because it matches shapes ' +
  'it also flags EXAMPLE secrets (a documented token, its own fixtures) ' +
  '\u2014 the honest ceiling working, not a bug; vouch for a line you know is ' +
  'safe with scrub-allow.';

var api = { scan: scan, scrub: scrub, check: check, SHAPES: SHAPES, FIXTURES: FIXTURES, CEILING: CEILING, selftest: selftest };
if (typeof module !== 'undefined' && module.exports) module.exports = api;

/* ---- selftest: the golden corpus + the two structural promises ---- */
function selftest() {
  var fails = [], ran = 0;
  function ck(name, cond) { ran++; if (!cond) fails.push(name); }

  // Every fixture below is assembled from parts at run time, so THIS file's own
  // source bytes carry no secret shape (a scanner's fixtures must not trip the
  // scanner or its siblings, and a live credential must never land in a source
  // file). The runtime string is the real shape; the source is inert. Every
  // value is a FAKE example (AKIA...EXAMPLE is AWS's own documentation key).
  function j() { return Array.prototype.join.call(arguments, ''); }
  var GHPAT = j('github', '_pat_');
  var GHTOK = j('gh', 'p_');

  // KNOWN-BAD half (hand-written): each MUST trip its kind.
  var bad = [
    ['github-pat',             j('token = ', GHPAT, '11ABCDEFG0abcdefghij_KLMNOPqrstuvwxyz012345')],
    ['github-token',           j(GHTOK, '0123456789abcdefghijklmnopqrstuvwxyz')],
    ['aws-access-key-id',      j('AK', 'IAIOSFODNN7EXAMPLE')],
    ['google-api-key',         j('AI', 'zaSyA1234567890abcdefghijklmnopqrstuv')],
    ['slack-token',            j('xo', 'xb-2411-abcdefghijklmnop')],
    ['stripe-key',             j('sk', '_live_0123456789abcdefghijkl')],
    ['jwt',                    j('ey', 'JhbGciOi.', 'ey', 'JzdWIiOiIx.SflKxwRJSMe')],
    ['private-key-block',      j('-----BEGIN RSA ', 'PRIVATE KEY-----')],
    ['basic-auth-url-literal', j('clone https://user:', 'hunter2@example.com/x.git')],
    ['basic-auth-url',         j('clone https://ci:', '${CI_TOKEN}@example.com/x.git')],
    ['hex-40-token',           j('HEXKEY=', 'deadbeef', 'deadbeef', 'deadbeef', 'deadbeef', 'deadbeef')],
    ['secret-assignment',      j('password: "correcthorse', 'batterystaple42"')]
  ];
  for (var i = 0; i < bad.length; i++) {
    var kinds = scan(bad[i][1]).map(function (f) { return f.kind; });
    ck('bad-trips:' + bad[i][0], kinds.indexOf(bad[i][0]) !== -1);
  }

  // REGISTER LIVENESS: every rendered fixture is caught by its own kind's re in
  // this build (tested per kind: a decided kind may rightly win the finding on
  // the same token, but the heuristic kind must still be alive).
  for (var fi = 0; fi < FIXTURES.length; fi++) {
    var own = SHAPES.filter(function (s) { return s.kind === FIXTURES[fi][0]; })[0];
    ck('fixture-trips:' + FIXTURES[fi][0] + '#' + fi,
       !!own && new RegExp(own.re.source, own.re.flags.replace('g', '')).test(FIXTURES[fi][1].join('')));
  }

  // KNOWN-CLEAN half: must NOT trip (guards against a trigger-happy scanner).
  var clean = [
    'the quick brown fox jumps over the lazy dog',
    'commit 908ec0b2218aae65912f2e43c79f341 was fine',   // short hex, not 40
    'see the docs at https://example.com/guide for setup',
    'let total = subtotal + tax; // no secrets here',
    'AKIA is a prefix but AKIA alone is not a key',
    j('const secret = crypto.', 'randomBytes(32);')    // a key GENERATED at run time: a call, not a value
  ];
  for (var c = 0; c < clean.length; c++) ck('clean-quiet:' + c, scan(clean[c]).length === 0);

  // ONE TOKEN, ONE FINDING: a token two definitions see is one occurrence, and
  // the decided kind wins over the heuristic one.
  var one = scan(bad[0][1]);
  ck('one-finding-per-token', one.length === 1 && one[0].kind === 'github-pat');
  ck('placeholder-url-is-heuristic-only', scan(bad[9][1], { heuristic: false }).length === 0);

  // PROMISE 1 — never echoes the secret; preview is masked.
  var f = scan('x = ' + GHPAT + '11ABCDEFG0abcdefghij_KLMNOPqrstuvwxyz012345')[0];
  ck('no-echo', f && f.preview.indexOf('KLMNOP') === -1 && f.preview.indexOf('\u2026') !== -1);

  // PROMISE 2 — scrub removes every secret; idempotent; output passes check clean.
  var dirty = bad.map(function (b) { return b[1]; }).join('\n');
  var s1 = scrub(dirty);
  ck('scrub-clears', check(s1) === false);
  ck('scrub-idempotent', scrub(s1) === s1);
  ck('scrub-kept-shape', s1.split('\n').length === dirty.split('\n').length);

  // ALLOW MARKER — a vouched-for line is skipped.
  ck('allow-skips', scan(GHTOK + '0123456789abcdefghijklmnopqrstuvwxyz  // scrub-allow example').length === 0);

  // DETERMINISM — scan twice, identical.
  ck('scan-deterministic', JSON.stringify(scan(dirty)) === JSON.stringify(scan(dirty)));

  // HEURISTIC toggle — dropping heuristics silences secret-assignment only.
  ck('heuristic-off', scan(bad[11][1], { heuristic: false }).length === 0);

  // Every declared check must have RUN: a loop that silently stops running is a failure, not a pass.
  var declared = bad.length + FIXTURES.length + clean.length + 9;
  if (ran !== declared) fails.push('ran ' + ran + ' of ' + declared + ' declared checks');
  if (fails.length) {
    console.error('RED: ' + fails.length + ' failed  [scrub]\n  ' + fails.join('\n  '));
    return false;
  }
  console.log('GREEN: ' + ran + ' checks passed, 0 failed  [scrub]');
  return true;
}

/* ---- CLI ---- */
function _readInput(argPath, cb) {
  if (argPath) {
    var fs = require('fs');
    var _text;
    try {
      _text = fs.readFileSync(argPath, 'utf8');
    } catch (e) {
      var _why = e && e.code === 'ENOENT' ? 'no such file'
               : e && e.code === 'EISDIR' ? 'is a directory'
               : e && e.code === 'EACCES' ? 'permission denied'
               : (e && e.message) || 'cannot read';
      process.stderr.write('scrub: cannot read ' + JSON.stringify(argPath) + ': ' + _why + '\n');
      process.exit(2);
    }
    cb(_text);
    return;
  }
  var buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (d) { buf += d; });
  process.stdin.on('end', function () { cb(buf); });
}

if (typeof require !== 'undefined' && require.main === module) {
  var argv = process.argv.slice(2);
  var mode = '--scan';
  var file = null;
  var noHeuristic = false;
  for (var a = 0; a < argv.length; a++) {
    if (argv[a] === '--selftest') { process.exit(selftest() ? 0 : 1); }
    else if (argv[a] === '--list') {
      SHAPES.forEach(function (s) { console.log((s.heuristic ? '~ ' : '  ') + s.kind); });
      console.error('\n' + CEILING);
      process.exit(0);
    }
    else if (argv[a] === '--scan' || argv[a] === '--scrub' || argv[a] === '--check') mode = argv[a];
    else if (argv[a] === '--no-heuristic') noHeuristic = true;
    else if (argv[a] === '-h' || argv[a] === '--help') {
      console.log('usage: scrub.js [--scan|--scrub|--check|--list|--selftest] [--no-heuristic] [FILE]');
      console.log('  --scan   report findings (kind:line:col, masked preview)   [default]');
      console.log('  --scrub  emit the text with secrets replaced');
      console.log('  --check  exit 1 if any secret is present, 0 if clean (the gate)');
      console.log('  exit 2   input could not be read (missing file, directory, permission)');
      console.error('\n' + CEILING);
      process.exit(0);
    }
    else if (argv[a][0] !== '-') file = argv[a];
  }
  _readInput(file, function (text) {
    var opts = { heuristic: !noHeuristic };
    if (mode === '--check') {
      var hits = scan(text, opts);
      if (hits.length) { console.error('scrub: ' + hits.length + ' secret(s) found \u2014 refusing.'); process.exit(1); }
      process.exit(0);
    } else if (mode === '--scrub') {
      process.stdout.write(scrub(text, opts));
    } else {
      var found = scan(text, opts);
      found.forEach(function (f) { console.log(f.kind + ':' + f.line + ':' + f.col + '  ' + f.preview); });
      console.error('\n' + CEILING);
      process.exit(found.length ? 1 : 0);
    }
  });
}
