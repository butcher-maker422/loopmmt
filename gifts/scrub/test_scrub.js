#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */
/* test_scrub.js — the house-standard test file for the scrub gift.
 *
 * Runs the module's own golden-corpus selftest (the known-bad/known-clean pair
 * plus the two structural promises), then adds API-level assertions the CLI
 * selftest doesn't cover: the finding shape, the CEILING string, and that no
 * fixture value is echoed. Exits non-zero on any failure so it drops straight
 * into a CI gate.
 */
'use strict';
var scrub = require('./scrub.js');

var fails = [];
function ck(name, cond) { if (!cond) fails.push(name); }

// 1. The module's own golden-corpus selftest is the core of the suite.
ck('module-selftest', scrub.selftest() === true);

// 2. Finding shape — every finding names kind/line/col and a masked preview only.
var hits = scrub.scan('l1 ok\nl2 AKIAIOSFODNN7EXAMPLE trailing');
ck('finds-on-line-2', hits.length === 1 && hits[0].line === 2);
ck('finding-has-kind', hits[0].kind === 'aws-access-key-id');
ck('finding-has-col', typeof hits[0].col === 'number' && hits[0].col > 0);
ck('preview-masked', hits[0].preview.indexOf('EXAMPLE') === -1);

// 3. check() is scan()>0, and a clean string is clean.
ck('check-clean', scrub.check('nothing secret in this sentence at all') === false);
ck('check-dirty', scrub.check('AKIAIOSFODNN7EXAMPLE') === true);

// 4. scrub() output always passes check clean (the load-bearing property).
var s = scrub.scrub('a AKIAIOSFODNN7EXAMPLE b\n-----BEGIN RSA PRIVATE KEY-----');
ck('scrub-output-clean', scrub.check(s) === false);
ck('scrub-placeholder-present', s.indexOf('redacted:') !== -1);

// 5. The honest ceiling is a non-empty, shipped string.
ck('ceiling-present', typeof scrub.CEILING === 'string' && scrub.CEILING.length > 40);

// 6. SHAPES is the documented closed set, each with a stable kind.
ck('shapes-closed', Array.isArray(scrub.SHAPES) && scrub.SHAPES.every(function (x) { return x.kind && x.re; }));

// 7. CLI clean-fail on unreadable input (D4-crashclean): a stranger who points
//    the gate at a missing file or a directory gets a clean one-line error and a
//    non-zero exit that is NOT the gate's "secret present" (1) — never a stack trace.
var cp = require('child_process');
var path = require('path');
var os = require('os');
var fs2 = require('fs');
var CLI = path.join(__dirname, 'scrub.js');
function runCheck(target) {
  var r = cp.spawnSync(process.execPath, [CLI, '--check', target], { encoding: 'utf8' });
  var both = (r.stdout || '') + (r.stderr || '');
  return { code: r.status, out: both };
}
var missing = runCheck(path.join(os.tmpdir(), 'scrub-no-such-' + process.pid + '.txt'));
ck('badinput-missing-exit2', missing.code === 2);
ck('badinput-missing-clean', /scrub: cannot read/.test(missing.out) && !/at Object|node:fs|Node\.js v/.test(missing.out));
var dir = fs2.mkdtempSync(path.join(os.tmpdir(), 'scrub-dir-'));
var asFile = runCheck(dir);
ck('badinput-dir-exit2', asFile.code === 2);
ck('badinput-dir-clean', /scrub: cannot read/.test(asFile.out) && !/at Object|node:fs|Node\.js v/.test(asFile.out));
try { fs2.rmdirSync(dir); } catch (e) {}

if (fails.length) {
  console.error('RED: ' + fails.length + ' failed  [test_scrub]\n  ' + fails.join('\n  '));
  process.exit(1);
}
console.log('GREEN: ' + (16) + ' assertions passed, 0 failed  [test_scrub]');
process.exit(0);
