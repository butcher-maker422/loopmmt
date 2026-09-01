// SPDX-License-Identifier: MIT
// test_timeline.js — self-test + determinism proof for the timeline gift.
//
//   node test_timeline.js
//
// Exit 0 = all pass. Exit 3 = a check failed. This is the gift's canonicalizer
// self-test (Gift-Works B7): the determinism assertion IS the proof the render
// is a pure fold — same artifact in, byte-identical verdict out.

'use strict';

var timelineLint = require('./timeline.js').timelineLint;

var failures = 0;
function ok(name, cond) {
  if (!cond) { console.error('FAIL: ' + name); failures++; }
  else { console.log('pass: ' + name); }
}

// helper: does the verdict contain a finding of the given check code?
function hasCheck(v, code) {
  if (!v.findings) return false;
  for (var i = 0; i < v.findings.length; i++) {
    if (String(v.findings[i].check).indexOf(code) === 0) return true;
  }
  return false;
}

// --- a known-GOOD artifact: passes clean --------------------------------------
var GOOD = {
  frame: { scale: 'interval', grain: null, foliation: { key: 't', dir: 'asc' } },
  events: [
    { id: 'a', t: 0, track: 'main', label: 'start' },
    { id: 'b', t: 100, parents: ['a'], track: 'main', duration: 50, label: 'work' },
    { id: 'c', t: 200, parents: ['b'], track: 'main', label: 'end' }
  ]
};
ok('C-good CLEAN verdict', timelineLint(GOOD).verdict === 'CLEAN');

// --- C0: an event that is not an object with an id ----------------------------
ok('C0 fires on a junk event', hasCheck(
  timelineLint({ frame: { scale: 'ordinal' }, events: [{ id: 'a', t: 0 }, 42] }), 'C0'));

// --- C1: a cycle in the parent edges (real defect: circular happened-before) --
ok('C1 fires on a cycle', hasCheck(timelineLint({
  frame: { scale: 'ordinal' },
  events: [
    { id: 'a', t: 0, parents: ['b'] },
    { id: 'b', t: 1, parents: ['a'] }
  ]
}), 'C1'));
// C1: a dangling parent edge
ok('C1 fires on a dangling edge', hasCheck(timelineLint({
  frame: { scale: 'ordinal' },
  events: [{ id: 'a', t: 0, parents: ['ghost'] }]
}), 'C1'));

// --- C2: no scale declared (implicit gauge) -----------------------------------
ok('C2 fires on undeclared scale', hasCheck(timelineLint({
  frame: { grain: null },
  events: [{ id: 'a', t: 0 }]
}), 'C2'));
// C2: a non-Stevens scale string
ok('C2 fires on a bogus scale', hasCheck(timelineLint({
  frame: { scale: 'vibes' },
  events: [{ id: 'a', t: 0 }]
}), 'C2'));

// --- C3: a causal order declared on a nominal (unordered) axis -----------------
ok('C3 fires on order over a nominal axis', hasCheck(timelineLint({
  frame: { scale: 'nominal' },
  events: [{ id: 'a', t: 0 }, { id: 'b', t: 1, parents: ['a'] }]
}), 'C3'));
// C3: a duration on an ordinal axis (difference of points undefined below interval)
ok('C3 fires on duration below interval', hasCheck(timelineLint({
  frame: { scale: 'ordinal' },
  events: [{ id: 'a', t: 0, duration: 10 }]
}), 'C3'));

// --- C4: a duration with no anchoring instant ---------------------------------
ok('C4 fires on unanchored duration', hasCheck(timelineLint({
  frame: { scale: 'interval' },
  events: [{ id: 'a', duration: 30 }]
}), 'C4'));

// --- C5: two events, same track, same instant, no resolving foliation ---------
ok('C5 fires on a same-track same-instant collision', hasCheck(timelineLint({
  frame: { scale: 'interval', foliation: { key: 't' } },
  events: [
    { id: 'a', t: 100, track: 'main' },
    { id: 'b', t: 100, track: 'main' }
  ]
}), 'C5'));
// C5: the same collision RESOLVED by a non-t foliation is CLEAN for C5
ok('C5 clear when a seq foliation resolves the pair', !hasCheck(timelineLint({
  frame: { scale: 'interval', foliation: { key: 'seq' } },
  events: [
    { id: 'a', t: 100, track: 'main', seq: 1 },
    { id: 'b', t: 100, track: 'main', seq: 2 }
  ]
}), 'C5'));

// --- C6: a nondeterministic foliation key -------------------------------------
ok('C6 fires on a nondeterministic key', hasCheck(timelineLint({
  frame: { scale: 'ordinal', foliation: { key: 'random' } },
  events: [{ id: 'a', t: 0 }]
}), 'C6'));
// C6: a foliation key carried by no event (silent fallback to t)
ok('C6 fires on a key no event carries', hasCheck(timelineLint({
  frame: { scale: 'ordinal', foliation: { key: 'seq' } },
  events: [{ id: 'a', t: 0 }]
}), 'C6'));

// --- C7: a baked day bucket ---------------------------------------------------
ok('C7 fires on a baked dayKey', hasCheck(timelineLint({
  frame: { scale: 'interval' },
  events: [{ id: 'a', t: 0, dayKey: '2026-08-31' }]
}), 'C7'));

// --- C8: a circular axis with an unreduced coordinate -------------------------
ok('C8 fires on an unreduced circular coord', hasCheck(timelineLint({
  frame: { scale: 'interval', topology: 'S1', period: 1440 },
  events: [{ id: 'a', t: 1500 }]
}), 'C8'));
// C8: a valid circular axis is CLEAN
ok('C8 clear on a reduced circular coord', timelineLint({
  frame: { scale: 'interval', topology: 'S1', period: 1440 },
  events: [{ id: 'a', t: 30 }, { id: 'b', t: 720 }]
}).verdict === 'CLEAN');

// --- USAGE verdicts -----------------------------------------------------------
ok('USAGE on a non-object', timelineLint(42).verdict === 'USAGE');
ok('USAGE on a missing frame', timelineLint({ events: [] }).verdict === 'USAGE');
ok('USAGE on a missing events list', timelineLint({ frame: {} }).verdict === 'USAGE');

// --- DETERMINISM: the canonicalizer self-test (Gift-Works B7) -----------------
// Same artifact -> byte-identical serialized verdict, twice. This is the proof
// the lint is a pure fold (folds-twice-identical).
var samples = [GOOD, {
  frame: { scale: 'interval', topology: 'S1', period: 1440, foliation: { key: 't' } },
  events: [
    { id: 'x', t: 100, track: 'a', parents: [] },
    { id: 'y', t: 100, track: 'a', duration: 5, dayKey: 'z' },
    { id: 'z', t: 200, parents: ['x', 'ghost'] }
  ]
}];
for (var s = 0; s < samples.length; s++) {
  var a = JSON.stringify(timelineLint(samples[s]));
  var b = JSON.stringify(timelineLint(samples[s]));
  ok('determinism: sample ' + s + ' byte-identical across two runs', a === b);
}

// --- MUTATION BITE: prove the test is non-vacuous -----------------------------
// If the lint were a no-op returning CLEAN always, C1 (cycle) would not fire.
// The C1 assertion above already bites that mutation; assert it explicitly here.
ok('mutation bite: a real cycle is NOT reported CLEAN',
  timelineLint({ frame: { scale: 'ordinal' }, events: [
    { id: 'a', parents: ['b'] }, { id: 'b', parents: ['a'] }] }).verdict === 'FLAG');

if (failures) {
  console.error('\nTIMELINE GIFT SELFTEST FAIL: ' + failures + ' failure(s)');
  process.exit(3);
}
console.log('\nTIMELINE GIFT SELFTEST PASS: all checks green, determinism proven');
process.exit(0);
