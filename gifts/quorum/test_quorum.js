#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */
/* test_quorum.js — the shipped test for the quorum gift.
 *
 * Re-runs the in-file golden selftest AND asserts the two things a shipped gift
 * must carry that a selftest alone does not check: the printed CEILING is
 * present in the shipped source and emitted, and the structural promises hold
 * on adversarial input. Exit 0 iff everything passes; non-zero otherwise, so it
 * drops into CI unchanged.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Q = require('./quorum.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('ok   ' + name); }
  catch (e) { fail++; console.log('FAIL ' + name + '  — ' + e.message); }
}

// 1. The in-file golden selftest is GREEN.
t('golden selftest all green', function () {
  const r = Q.selftest();
  assert.strictEqual(r.passed, r.total, r.passed + '/' + r.total);
});

// 2. The CEILING string exists, is non-trivial, and is present in the source
//    (a gift with no printed edge is a loud stop — profile B1/§3).
t('CEILING present and substantive', function () {
  assert.ok(typeof Q.CEILING === 'string' && Q.CEILING.length > 40);
  assert.ok(/correctness|concordance|truth/i.test(Q.CEILING));
});
t('CEILING is emitted by the shipped artifact (--help)', function () {
  // The CEILING is built by concatenation in source, so it is not one contiguous
  // literal in the file — assert the shipped BEHAVIOR instead: --help emits it to
  // stderr, verbatim, every run. This is the presence check that actually matters
  // to a stranger running the gift (profile B1/§3 printed-edge).
  const { spawnSync } = require('child_process');
  const r = spawnSync('node', [path.join(__dirname, 'quorum.js'), '--help'],
    { encoding: 'utf8' });
  const emitted = (r.stdout || '') + (r.stderr || '');
  assert.ok(emitted.indexOf(Q.CEILING) !== -1, 'CEILING not emitted by --help');
});
t('CEILING core phrase is present in the shipped source', function () {
  // A weaker, robust source check: the load-bearing phrase is literally present.
  const src = fs.readFileSync(path.join(__dirname, 'quorum.js'), 'utf8');
  assert.ok(/does not judge correctness/.test(src), 'ceiling phrase not in source');
});

// 3. Promise 1 — pure & deterministic: fold twice, byte-identical.
t('promise: folds twice identical', function () {
  const inp = [{ label: 'A', answer: 'k' }, { label: 'B', answer: 'k' },
    { label: 'C', answer: 'm' }, { label: 'D', answer: 'k' }];
  assert.strictEqual(JSON.stringify(Q.quorum(inp)), JSON.stringify(Q.quorum(inp)));
});

// 4. Promise 2 — value is always a verbatim input answer or null.
t('promise: value never invented', function () {
  const r = Q.quorum([{ answer: '  spaced  out ' }, { answer: 'spaced out' },
    { answer: 'x' }]);
  assert.strictEqual(r.verdict, 'quorum');
  // winner group normalized-merged, but value is the FIRST raw form
  assert.strictEqual(r.value, '  spaced  out ');
});

// 5. Promise 3 — exhaustive & disjoint: agree ∪ dissent = all, no overlap.
t('promise: exhaustive and disjoint', function () {
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push({ label: 'r' + i, answer: (i % 3) + '' });
  const r = Q.quorum(rows);
  const inAgree = new Set(r.agree);
  const inDissent = new Set(r.dissent.map(function (d) { return d.label; }));
  // disjoint
  r.agree.forEach(function (l) { assert.ok(!inDissent.has(l)); });
  // exhaustive
  assert.strictEqual(r.agree.length + r.dissent.length, 20);
  const all = new Set(r.agree.concat(r.dissent.map(function (d) { return d.label; })));
  assert.strictEqual(all.size, 20);
});

// 6. Order independence of the tally is by rule, not by input hash: the tally
//    is sorted (count desc, first-appearance asc) — a re-labeled but identically
//    -shaped input yields the same counts in the same order.
t('tally order is a fixed function of input', function () {
  const a = Q.quorum([{ answer: 'z' }, { answer: 'z' }, { answer: 'a' }]);
  assert.deepStrictEqual(a.tally.map(function (t) { return t.count; }), [2, 1]);
});

// 7. Empty answers are counted, never dropped.
t('empty answers counted', function () {
  const r = Q.quorum([{ answer: '' }, { answer: '' }, { answer: 'x' }]);
  assert.strictEqual(r.verdict, 'quorum');
  assert.strictEqual(r.value, '');
  assert.strictEqual(r.n, 3);
});

// 8. Tie meeting threshold yields null, never a silent pick.
t('tie yields no winner', function () {
  const r = Q.quorum([{ answer: 'x' }, { answer: 'y' }], { threshold: 1 });
  assert.strictEqual(r.verdict, 'tie');
  assert.strictEqual(r.value, null);
});

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
process.exit(fail === 0 ? 0 : 1);
