#!/usr/bin/env node
/*
 * test_sparkline-sink.js — drift-check battery for the sparkline-sink gift.
 *
 * THE ORACLE IS OUT-OF-BAND BY CONSTRUCTION. The expected glyph lines below are
 * hand-computed from the documented level math — level(v) = clamp(floor((v-lo)/(hi-lo)*8), 0, 7),
 * lo/hi the auto-fit or pinned domain — written independently of the emitter, not captured
 * from its output. A build cannot certify itself, so the expected strings are the author's fact.
 * The remaining checks are contract properties (determinism, honest errors, alphabet-closed).
 *
 * Run: node test_sparkline-sink.js   (exit 0 = all pass; nonzero = a named failure)
 */
'use strict';
const assert = require('assert');
const { sparkline, LEVELS } = require('./sparkline-sink.js');
const [L0, L1, L2, L3, L4, L5, L6, L7] = LEVELS; // ▁▂▃▄▅▆▇█

let n = 0, passed = 0;
function check(name, fn) {
  n++;
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '  — ' + e.message); process.exitCode = 1; }
}

// 1 — the clean 8-step ramp: [0..7] auto-domain [0,7] -> one glyph per level, in order.
check('ramp: [0..7] -> ▁▂▃▄▅▆▇█ (every level, in order)', () => {
  assert.strictEqual(sparkline([0, 1, 2, 3, 4, 5, 6, 7]), '\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588\n');
});

// 2 — flat series: all equal -> unit window -> all mid-scale (level 4 = ▅), never a divide-by-0.
check('flat: [1,1,1] -> ▅▅▅ (mid-scale, no NaN)', () => {
  assert.strictEqual(sparkline([1, 1, 1]), L4 + L4 + L4 + '\n');
});

// 3 — single value: flat window -> one mid-scale glyph.
check('single: [5] -> ▅', () => {
  assert.strictEqual(sparkline([5]), L4 + '\n');
});

// 4 — two-point extremes: [0,10] auto [0,10] -> low, high (10 clamps 8->7).
check('extremes: [0,10] -> ▁█', () => {
  assert.strictEqual(sparkline([0, 10]), L0 + L7 + '\n');
});

// 5 — negatives across zero: [-4,0,4] auto [-4,4] -> ▁▅█.
check('negatives: [-4,0,4] -> ▁▅█', () => {
  assert.strictEqual(sparkline([-4, 0, 4]), L0 + L4 + L7 + '\n');
});

// 6 — the classic: [3,1,4,1,5,9,2,6] auto [1,9] (hi-lo=8 -> level=floor(v-1)).
//     3->2 4->3 1->0 5->4 9->8clamp7 2->1 6->5  => ▃▁▄▁▅█▂▆
check('classic: [3,1,4,1,5,9,2,6] -> ▃▁▄▁▅█▂▆', () => {
  assert.strictEqual(sparkline([3, 1, 4, 1, 5, 9, 2, 6]), L2 + L0 + L3 + L0 + L4 + L7 + L1 + L5 + '\n');
});

// 7 — pinned domain: [5] with min0 max10 -> ▅ (level 4), overriding the flat-window auto-fit.
check('pinned: {series:[5],min:0,max:10} -> ▅', () => {
  assert.strictEqual(sparkline({ series: [5], min: 0, max: 10 }), L4 + '\n');
  // CLI flags override object fields:
  assert.strictEqual(sparkline({ series: [5], min: 0, max: 10 }, { min: 0, max: 2 }), L7 + '\n'); // 5 > max2 -> clamp high
});

// 8 — empty series -> a bare newline, never a crash.
check('empty: [] -> "\\n"', () => {
  assert.strictEqual(sparkline([]), '\n');
});

// 9 — determinism: same series -> byte-identical output, twice.
check('determinism: repeated render is byte-identical', () => {
  const s = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5];
  assert.strictEqual(sparkline(s), sparkline(s));
});

// 10 — alphabet is CLOSED: every output char is one of the 8 block levels or the trailing \n.
check('closed alphabet: only ▁▂▃▄▅▆▇█ (+ newline) ever appear', () => {
  const out = sparkline([3, -2, 7, 0, 5, -4, 9, 1, 8]);
  const body = out.replace(/\n$/, '');
  for (const ch of body) assert.ok(LEVELS.indexOf(ch) !== -1, 'unexpected char ' + JSON.stringify(ch));
  assert.strictEqual(body.length, 9, 'one glyph per value');
});

// 11 — non-finite is a hard, named error (never a guessed point).
check('non-finite value throws, naming the position', () => {
  assert.throws(() => sparkline([1, NaN, 3]), /series\[1\] is not a finite number/);
  assert.throws(() => sparkline([1, 2, Infinity]), /series\[2\]/);
});

// 12 — honest input errors: nested arrays and bad min/max throw rather than mis-render.
check('nested arrays and inverted domain throw', () => {
  assert.throws(() => sparkline([[1, 2], [3, 4]]), /ONE series/);
  assert.throws(() => sparkline({ series: [1, 2], min: 5, max: 5 }), /min must be < max/);
});

console.log('\n' + passed + '/' + n + ' passed');
if (passed !== n) process.exit(1);
