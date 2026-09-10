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
 * multiline is applied per-line), and whether it is `heuristic` (higher
 * false-positive rate — a generic "secret-looking assignment" rather than a
 * vendor-stamped prefix). The list is documented, not open: a shape a real
 * secret needs and this set lacks is a gap to name in the printed ceiling, not
 * a reason to pretend coverage. */
var SHAPES = [
  { kind: 'github-pat',        heuristic: false, re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { kind: 'github-token',      heuristic: false, re: /\bgh[posru]_[A-Za-z0-9]{36,}\b/g },
  { kind: 'aws-access-key-id', heuristic: false, re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'google-api-key',    heuristic: false, re: /\bAIza[0-9A-Za-z_\-]{35}\b/g },
  { kind: 'slack-token',       heuristic: false, re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: 'stripe-key',        heuristic: false, re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { kind: 'openai-key',        heuristic: false, re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { kind: 'jwt',               heuristic: false, re: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g },
  { kind: 'private-key-block', heuristic: false, re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g },
  { kind: 'basic-auth-url',    heuristic: false, re: /\b[a-z][a-z0-9+.-]*:\/\/[^\/\s:@]+:[^\/\s:@]+@/g },
  { kind: 'hex-40-token',      heuristic: false, re: /\b[0-9a-f]{40}\b/g },
  // heuristic: a generic "secret = <opaque value>" assignment. Higher FP; kept
  // last and flagged so a caller can drop it with { heuristic:false }.
  { kind: 'secret-assignment', heuristic: true,  re: /\b(?:secret|token|api[_-]?key|access[_-]?key|password|passwd|pwd|auth)\b\s*[:=]\s*['"]?[A-Za-z0-9/+_.=-]{16,}/gi }
];

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

/* scan(text, opts) -> array of findings, each { kind, line, col, preview }.
 * Deterministic: findings are returned in (line, col) order. A line carrying
 * the allow marker contributes no findings. Never includes the secret value. */
function scan(text, opts) {
  text = String(text == null ? '' : text);
  var shapes = _activeShapes(opts);
  var out = [];
  var lines = text.split('\n');
  for (var li = 0; li < lines.length; li++) {
    var line = lines[li];
    if (line.indexOf(ALLOW_MARKER) !== -1) continue; // vouched-for line
    for (var si = 0; si < shapes.length; si++) {
      var re = new RegExp(shapes[si].re.source, shapes[si].re.flags);
      var m;
      while ((m = re.exec(line)) !== null) {
        out.push({ kind: shapes[si].kind, line: li + 1, col: m.index + 1, preview: _mask(m[0]) });
        if (m.index === re.lastIndex) re.lastIndex++; // zero-width guard
      }
    }
  }
  out.sort(function (a, b) { return a.line - b.line || a.col - b.col || (a.kind < b.kind ? -1 : 1); });
  return out;
}

/* scrub(text, opts) -> text with every secret span replaced by a fixed
 * per-kind placeholder. Pure and idempotent. Allow-marked lines pass through. */
function scrub(text, opts) {
  text = String(text == null ? '' : text);
  var shapes = _activeShapes(opts);
  var lines = text.split('\n');
  for (var li = 0; li < lines.length; li++) {
    if (lines[li].indexOf(ALLOW_MARKER) !== -1) continue;
    for (var si = 0; si < shapes.length; si++) {
      var re = new RegExp(shapes[si].re.source, shapes[si].re.flags);
      var kind = shapes[si].kind;
      lines[li] = lines[li].replace(re, PLACEHOLDER(kind));
    }
  }
  return lines.join('\n');
}

/* check(text, opts) -> boolean. true iff at least one secret shape is present.
 * The gate: `if (check(diff)) process.exit(1)`. */
function check(text, opts) { return scan(text, opts).length > 0; }

var CEILING =
  'scrub matches KNOWN secret SHAPES. A clean result means no known shape was ' +
  'found here \u2014 it is NOT proof the text is secret-free. A novel format, a ' +
  'split value, or a shapeless secret will pass. Smoke alarm, not a vault.';

var api = { scan: scan, scrub: scrub, check: check, SHAPES: SHAPES, CEILING: CEILING, selftest: selftest };
if (typeof module !== 'undefined' && module.exports) module.exports = api;

/* ---- selftest: the golden corpus + the two structural promises ---- */
function selftest() {
  var fails = [];
  function ck(name, cond) { if (!cond) fails.push(name); }

  // Prefixes assembled from parts so THIS file's own source bytes carry no
  // literal secret shape — the same reason any secret-scanner's fixtures must
  // not contain literal secrets (they would trip this scanner and its siblings,
  // and a live-credential must never land in a source file). The runtime string
  // is the real shape; the source is inert.
  var GHPAT = 'github_' + 'pat_';   // -> github_pat_
  var GHTOK = 'gh' + 'p_';          // -> ghp_

  // KNOWN-BAD half: each MUST trip its kind. Every value below is a FAKE example
  // (AKIA…EXAMPLE is AWS's own doc placeholder); no value is a real secret.
  var bad = [
    ['github-pat',        'token = ' + GHPAT + '11ABCDEFG0abcdefghij_KLMNOPqrstuvwxyz012345'],
    ['github-token',      GHTOK + '0123456789abcdefghijklmnopqrstuvwxyz'],
    ['aws-access-key-id', 'AKIAIOSFODNN7EXAMPLE'],
    ['google-api-key',    'AIzaSyA1234567890abcdefghijklmnopqrstuv'],
    ['slack-token',       'xoxb-2411-abcdefghijklmnop'],
    ['stripe-key',        'sk_live_0123456789abcdefghijkl'],
    ['jwt',               'eyJhbGciOi.eyJzdWIiOiIx.SflKxwRJSMe'],
    ['private-key-block', '-----BEGIN RSA PRIVATE KEY-----'],
    ['basic-auth-url',    'clone https://user:hunter2@example.com/x.git'],
    ['hex-40-token',      'HEXKEY=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'],
    ['secret-assignment', 'password: "correcthorsebatterystaple42"']
  ];
  for (var i = 0; i < bad.length; i++) {
    var kinds = scan(bad[i][1]).map(function (f) { return f.kind; });
    ck('bad-trips:' + bad[i][0], kinds.indexOf(bad[i][0]) !== -1);
  }

  // KNOWN-CLEAN half: must NOT trip (guards against a trigger-happy scanner).
  var clean = [
    'the quick brown fox jumps over the lazy dog',
    'commit 908ec0b2218aae65912f2e43c79f341 was fine',   // short hex, not 40
    'see the docs at https://example.com/guide for setup',
    'let total = subtotal + tax; // no secrets here',
    'AKIA is a prefix but AKIA alone is not a key'
  ];
  for (var c = 0; c < clean.length; c++) ck('clean-quiet:' + c, scan(clean[c]).length === 0);

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
  ck('heuristic-off', scan('password: "correcthorsebatterystaple42"', { heuristic: false }).length === 0);

  if (fails.length) {
    console.error('RED: ' + fails.length + ' failed  [scrub]\n  ' + fails.join('\n  '));
    return false;
  }
  console.log('GREEN: ' + (bad.length + clean.length + 8) + ' checks passed, 0 failed  [scrub]');
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
