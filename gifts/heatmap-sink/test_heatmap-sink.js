#!/usr/bin/env node
/*
 * test_heatmap-sink.js — drift-check battery for the heatmap-sink gift.
 *
 * THE ORACLE IS OUT-OF-BAND BY CONSTRUCTION. The expected SVG documents below are
 * hand-computed from the documented math — level(v) = clamp(floor((v-lo)/(hi-lo)*5), 0, 4),
 * lo/hi the auto-fit or pinned domain (flat field -> unit window), cells drawn row-major at
 * (x*cell, y*cell) — written independently of the emitter, not captured from its output. A
 * build cannot certify itself, so the expected strings are the author's fact. The remaining
 * checks are contract properties (determinism, order-independence, closed palette, honest errors).
 *
 * Run: node test_heatmap-sink.js   (exit 0 = all pass; nonzero = a named failure)
 */
'use strict';
const assert = require('assert');
const { heatmap, SCALES, EMPTY_FILLS } = require('./heatmap-sink.js');

let n = 0, passed = 0;
function check(name, fn) {
  n++;
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '  — ' + e.message); process.exitCode = 1; }
}

// ---- hand-computed expected SVGs (heat palette, cell=16, empty=light) ------------
// heat = #ffffcc #fed976 #fd8d3c #e31a1c #800026 ; empty light = #eeeeee
const RAMP_2x2 =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">\n' +
  '<rect x="0" y="0" width="16" height="16" fill="#ffffcc" />\n' +
  '<rect x="16" y="0" width="16" height="16" fill="#fed976" />\n' +
  '<rect x="0" y="16" width="16" height="16" fill="#e31a1c" />\n' +
  '<rect x="16" y="16" width="16" height="16" fill="#800026" />\n' +
  '</svg>\n';

// 1 — full 2x2 grid, values 0..3 auto-domain [0,3] -> one bucket per corner, in order.
//     level(0)=0 level(1)=floor(1/3*5)=1 level(2)=floor(2/3*5)=3 level(3)=clamp(5)=4
check('ramp 2x2: [0,1,2,3] -> #ffffcc #fed976 #e31a1c #800026', () => {
  assert.strictEqual(heatmap({ cells: [[0,0,0],[1,0,1],[0,1,2],[1,1,3]] }), RAMP_2x2);
});

// 2 — flat field: all equal -> unit window -> every cell mid-scale (bucket 2 = #fd8d3c).
check('flat field: [5,5,5,5] -> all #fd8d3c (mid-scale, no divide-by-0)', () => {
  const exp =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">\n' +
    '<rect x="0" y="0" width="16" height="16" fill="#fd8d3c" />\n' +
    '<rect x="16" y="0" width="16" height="16" fill="#fd8d3c" />\n' +
    '<rect x="0" y="16" width="16" height="16" fill="#fd8d3c" />\n' +
    '<rect x="16" y="16" width="16" height="16" fill="#fd8d3c" />\n' +
    '</svg>\n';
  assert.strictEqual(heatmap({ cells: [[0,0,5],[1,0,5],[0,1,5],[1,1,5]] }), exp);
});

// 3 — single cell -> flat window -> one mid-scale rect, 16x16 frame.
check('single cell: [0,0,7] -> one #fd8d3c rect', () => {
  const exp =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">\n' +
    '<rect x="0" y="0" width="16" height="16" fill="#fd8d3c" />\n' +
    '</svg>\n';
  assert.strictEqual(heatmap({ cells: [[0,0,7]] }), exp);
});

// 4 — sparse input: two corners set, 3x3 grid, the 7 missing cells take the empty fill.
check('sparse: [(0,0)=0,(2,2)=10] -> corners painted, 7 empty #eeeeee', () => {
  const exp =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">\n' +
    '<rect x="0" y="0" width="16" height="16" fill="#ffffcc" />\n' +
    '<rect x="16" y="0" width="16" height="16" fill="#eeeeee" />\n' +
    '<rect x="32" y="0" width="16" height="16" fill="#eeeeee" />\n' +
    '<rect x="0" y="16" width="16" height="16" fill="#eeeeee" />\n' +
    '<rect x="16" y="16" width="16" height="16" fill="#eeeeee" />\n' +
    '<rect x="32" y="16" width="16" height="16" fill="#eeeeee" />\n' +
    '<rect x="0" y="32" width="16" height="16" fill="#eeeeee" />\n' +
    '<rect x="16" y="32" width="16" height="16" fill="#eeeeee" />\n' +
    '<rect x="32" y="32" width="16" height="16" fill="#800026" />\n' +
    '</svg>\n';
  assert.strictEqual(heatmap({ cells: [[0,0,0],[2,2,10]] }), exp);
});

// 5 — pinned domain overrides the flat-window auto-fit: [5,5] on [0,10] -> bucket 2.
check('pinned: {cells:[5,5],min:0,max:10} -> both #fd8d3c', () => {
  const exp =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 16" width="32" height="16">\n' +
    '<rect x="0" y="0" width="16" height="16" fill="#fd8d3c" />\n' +
    '<rect x="16" y="0" width="16" height="16" fill="#fd8d3c" />\n' +
    '</svg>\n';
  assert.strictEqual(heatmap({ cells: [[0,0,5],[1,0,5]], min: 0, max: 10 }), exp);
});

// 6 — empty input -> a valid, empty 0x0 frame, never a crash.
check('empty: {cells:[]} -> empty <svg> frame', () => {
  assert.strictEqual(heatmap({ cells: [] }),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 0" width="0" height="0">\n</svg>\n');
});

// 7 — 'none' empty omits missing rects entirely.
check("empty:none -> missing cells produce no rect", () => {
  const exp =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">\n' +
    '<rect x="0" y="0" width="16" height="16" fill="#ffffcc" />\n' +
    '<rect x="16" y="16" width="16" height="16" fill="#800026" />\n' +
    '</svg>\n';
  assert.strictEqual(heatmap({ cells: [[0,0,0],[1,1,10]], empty: 'none' }), exp);
});

// 8 — object-form cells {x,y,v} render identically to array-form.
check('object cells {x,y,v} == array cells [x,y,v]', () => {
  const a = heatmap({ cells: [[0,0,0],[1,0,1],[0,1,2],[1,1,3]] });
  const o = heatmap({ cells: [{x:0,y:0,v:0},{x:1,y:0,v:1},{x:0,y:1,v:2},{x:1,y:1,v:3}] });
  assert.strictEqual(o, a);
  assert.strictEqual(o, RAMP_2x2);
});

// 9 — INPUT-ORDER-INDEPENDENCE: scrambled cell order -> byte-identical SVG (a heatmap is a SET).
check('order-independent: scrambled cells -> identical bytes', () => {
  const scrambled = heatmap({ cells: [[1,1,3],[0,0,0],[1,0,1],[0,1,2]] });
  assert.strictEqual(scrambled, RAMP_2x2);
});

// 10 — determinism: same cells -> byte-identical output, twice.
check('determinism: repeated render is byte-identical', () => {
  const c = { cells: [[0,0,3],[1,0,1],[2,0,4],[0,1,1],[1,1,5],[2,1,9]] };
  assert.strictEqual(heatmap(c), heatmap(c));
});

// 11 — closed palette + no text: every fill is in the named scale (∪ empty); no <text|script|style.
check('closed palette: only scale colors + empty, no text/script/style', () => {
  const out = heatmap({ cells: [[0,0,0],[1,0,50],[0,1,100],[1,1,25]], palette: 'cool', min: 0, max: 100 });
  const allowed = new Set(SCALES.cool.concat([EMPTY_FILLS.light]));
  const fills = out.match(/fill="([^"]*)"/g).map(s => s.slice(6, -1));
  for (const f of fills) assert.ok(allowed.has(f), 'unexpected fill ' + f);
  assert.ok(!/<text|<script|<style|font/.test(out), 'output must contain no text/script/style/font');
  assert.ok(out.startsWith('<svg ') && out.endsWith('</svg>\n'), 'well-formed svg frame');
});

// 12 — non-finite value is a hard, named error (never a guessed color).
check('non-finite value throws, naming the cell', () => {
  assert.throws(() => heatmap({ cells: [[0,0,0],[1,0,NaN]] }), /cell \(1,0\) value is not a finite number/);
  assert.throws(() => heatmap({ cells: [[0,0,Infinity]] }), /is not a finite number/);
});

// 13 — bad coordinates throw: negative and non-integer are both refused.
check('negative / non-integer coordinate throws', () => {
  assert.throws(() => heatmap({ cells: [[-1,0,5]] }), /coordinate must be a non-negative integer/);
  assert.throws(() => heatmap({ cells: [[0.5,0,5]] }), /coordinate must be a non-negative integer/);
});

// 14 — a duplicate (x,y) is a hard error (no silent last-wins).
check('duplicate cell throws', () => {
  assert.throws(() => heatmap({ cells: [[0,0,1],[0,0,2]] }), /duplicate cell at \(0,0\)/);
});

// 15 — a cell outside a pinned grid throws (no silent clipping); unknown palette throws.
check('out-of-grid cell and unknown palette throw', () => {
  assert.throws(() => heatmap({ cells: [[3,0,1]], cols: 2 }), /outside the pinned grid/);
  assert.throws(() => heatmap({ cells: [[0,0,1]], palette: 'nope' }), /unknown palette/);
});

// 16 — mutation bite (non-vacuity): a deliberately-wrong SVG (last fill bumped one bucket down)
//      MUST NOT equal the real render.
check('mutation bite: a wrong-color SVG is rejected', () => {
  const wrong = RAMP_2x2.replace('fill="#800026"', 'fill="#e31a1c"');
  const got = heatmap({ cells: [[0,0,0],[1,0,1],[0,1,2],[1,1,3]] });
  assert.strictEqual(got, RAMP_2x2);
  assert.notStrictEqual(got, wrong);
});

console.log('\n' + passed + '/' + n + ' passed');
if (passed !== n) process.exit(1);
