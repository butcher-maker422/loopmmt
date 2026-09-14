#!/usr/bin/env node
/*
 * test_svg-sink.js — drift-check battery for the svg-sink gift.
 *
 * THE ORACLE IS OUT-OF-BAND BY CONSTRUCTION. The exact-SVG expectations below are
 * hand-computed from the documented scale math (X = pad + i/(n-1)*innerW; Y inverted),
 * written independently of the emitter — not captured from the emitter's own output.
 * A build cannot certify itself, so the expected strings are the test author's fact.
 * The remaining checks are contract properties (determinism, in-viewBox, honest errors).
 *
 * Run: node test_svg-sink.js   (exit 0 = all pass; nonzero = a named failure)
 */
'use strict';
const assert = require('assert');
const { renderSVG, num } = require('./svg-sink.js');

let n = 0, passed = 0;
function check(name, fn) {
  n++;
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '  — ' + e.message); process.exitCode = 1; }
}
const OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">';

// 1 — line, exact bytes. [0,10] on 100x100 pad10 -> x:10,90  y:90,10
check('line: exact SVG for a hand-computed 2-point series', () => {
  const got = renderSVG([0, 10], { kind: 'line', width: 100, height: 100, pad: 10, palette: 'mono' });
  const want = OPEN + '\n' +
    '<polyline fill="none" stroke="#111111" stroke-width="1.5" points="10,90 90,10" />' + '\n' +
    '</svg>\n';
  assert.strictEqual(got, want);
});

// 2 — scatter, exact bytes. single point [5] -> flat domain [4,6], centered at (50,50)
check('scatter: single point centers via flat-domain rule', () => {
  const got = renderSVG([5], { kind: 'scatter', width: 100, height: 100, pad: 10 });
  const want = OPEN + '\n<circle cx="50" cy="50" r="2" fill="#2f6f8f" />\n</svg>\n';
  assert.strictEqual(got, want);
});

// 3 — bar, exact bytes. [2,10] on 100x100 pad10 -> ZERO-baselined; heights 16:80 == 2:10.
// The 1:5 height ratio is only true if bars baseline at 0 (not the domain floor of 2).
check('bar: zero-baselined rects with value-proportional heights', () => {
  const got = renderSVG([2, 10], { kind: 'bar', width: 100, height: 100, pad: 10, palette: 'mono' });
  const want = OPEN + '\n' +
    '<rect x="14" y="74" width="32" height="16" fill="#111111" />' + '\n' +
    '<rect x="54" y="10" width="32" height="80" fill="#111111" />' + '\n' +
    '</svg>\n';
  assert.strictEqual(got, want);
});

// 4 — multi-series line: two polylines, palette by series index
check('line: two series -> two polylines, indexed palette', () => {
  const got = renderSVG([[0, 10], [10, 0]], { kind: 'line', width: 100, height: 100, pad: 10, palette: 'loop' });
  const lines = got.split('\n').filter(l => l.indexOf('<polyline') === 0);
  assert.strictEqual(lines.length, 2, 'expected 2 polylines');
  assert.ok(lines[0].indexOf('stroke="#2f6f8f"') !== -1, 'series 0 uses palette[0]');
  assert.ok(lines[1].indexOf('stroke="#c25b3a"') !== -1, 'series 1 uses palette[1]');
  assert.ok(lines[0].indexOf('points="10,90 90,10"') !== -1);
  assert.ok(lines[1].indexOf('points="10,10 90,90"') !== -1);
});

// 5 — determinism: same spec -> byte-identical output, twice
check('determinism: repeated render is byte-identical', () => {
  const spec = { series: [3, 1, 4, 1, 5, 9, 2, 6], kind: 'line', width: 320, height: 90 };
  const a = renderSVG(spec.series, { kind: spec.kind, width: spec.width, height: spec.height });
  const b = renderSVG(spec.series, { kind: spec.kind, width: spec.width, height: spec.height });
  assert.strictEqual(a, b);
});

// 6 — all emitted coordinates fall inside the viewBox (no overflow)
check('containment: every coordinate lies within [0,W]x[0,H]', () => {
  const W = 300, H = 100;
  ['line', 'bar', 'scatter'].forEach(kind => {
    const svg = renderSVG([3, -2, 7, 0, 5, -4, 9], { kind, width: W, height: H, pad: 6 });
    // pull the geometry attrs specifically and assert each is in-frame:
    const attrs = svg.match(/(?:cx|cy|x|y|width|height)="(-?\d+(?:\.\d+)?)"/g) || [];
    attrs.forEach(a => {
      const v = Number(a.split('"')[1]);
      assert.ok(v >= -0.001 && v <= Math.max(W, H) + 0.001, 'coord ' + v + ' out of frame in ' + kind);
    });
    // points= list too
    const pm = svg.match(/points="([^"]*)"/g) || [];
    pm.forEach(p => p.slice(8, -1).split(/[ ,]/).map(Number).forEach(v => {
      assert.ok(v >= -0.001 && v <= Math.max(W, H) + 0.001, 'point ' + v + ' out of frame');
    }));
  });
});

// 7 — empty series -> a valid empty frame, never a crash
check('empty series -> valid empty <svg> frame', () => {
  const got = renderSVG([], { kind: 'line', width: 100, height: 100, pad: 10 });
  assert.strictEqual(got, OPEN + '\n</svg>\n');
});

// 8 — non-finite is a hard, named error (never a guessed point)
check('non-finite value throws, naming the position', () => {
  assert.throws(() => renderSVG([1, NaN, 3]), /series 0\[1\] is not a finite number/);
  assert.throws(() => renderSVG([[1, 2], [3, Infinity]]), /series 1\[1\]/);
});

// 9 — unknown kind / palette are honest errors, not silent fallbacks
check('unknown kind and palette throw', () => {
  assert.throws(() => renderSVG([1, 2], { kind: 'pie' }), /unknown kind/);
  assert.throws(() => renderSVG([1, 2], { palette: 'neon' }), /unknown palette/);
});

// 10 — the number formatter: rounding, trailing-zero strip, -0 normalization
check('num(): deterministic 3-dp formatting', () => {
  assert.strictEqual(num(12.3),   '12.3');
  assert.strictEqual(num(10),     '10');
  assert.strictEqual(num(12.3006),'12.301');
  assert.strictEqual(num(5.12),   '5.12');
  assert.strictEqual(num(-0.0001),'0');     // normalizes -0
  assert.strictEqual(num(100.5),  '100.5');
});

// 11 — spec object with CLI-flag override precedence
check('spec object: CLI flag overrides object field', () => {
  const svg = renderSVG({ series: [1, 2], kind: 'line', width: 100, height: 100, pad: 10 }, { kind: 'scatter' });
  assert.ok(svg.indexOf('<circle') !== -1, 'flag kind=scatter should win over object kind=line');
  assert.ok(svg.indexOf('<polyline') === -1);
});

// 12 — single-point line degenerates to a visible dot (not an empty polyline)
check('line: single point renders as a dot', () => {
  const svg = renderSVG([7], { kind: 'line', width: 100, height: 100, pad: 10 });
  assert.ok(svg.indexOf('<circle') !== -1, 'single-point line should draw a circle');
  assert.ok(svg.indexOf('<polyline') === -1);
});

console.log('\n' + passed + '/' + n + ' passed');
if (passed !== n) process.exit(1);
