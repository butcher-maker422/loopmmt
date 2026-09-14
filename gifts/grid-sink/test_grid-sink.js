#!/usr/bin/env node
/*
 * test_grid-sink.js — drift-check battery for the grid-sink gift.
 *
 * THE ORACLE IS OUT-OF-BAND BY CONSTRUCTION. The expected SVG documents below are hand-computed from
 * the documented geometry — a block at (row,col) spanning (w,h) draws a <rect> at (pad+col*cell,
 * pad+row*cell) sized (w*cell,h*cell); grid W=2*pad+cols*cell, H=2*pad+rows*cell (cell=20,pad=2);
 * fill = PALETTES.loop[blockIndex]; the DECLARED overflow policy (error|clip|skip) decides a block
 * that exceeds a pinned grid — written independently of the emitter. A build cannot certify itself.
 * The char-of-this-gift is the overflow policy, so the battery pins all three branches explicitly.
 *
 * Run: node test_grid-sink.js   (exit 0 = all pass; nonzero = a named failure)
 */
'use strict';
const assert = require('assert');
const { grid, PALETTES } = require('./grid-sink.js');

let n = 0, passed = 0;
function check(name, fn) {
  n++;
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '  — ' + e.message); process.exitCode = 1; }
}

const TWO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 44" width="64" height="44">\n' +
  '<rect x="2" y="2" width="20" height="20" fill="#2f6f8f" />\n' +
  '<rect x="22" y="22" width="40" height="20" fill="#c25b3a" />\n' +
  '</svg>\n';

// 1 — two blocks, auto-fit grid (cols=3,rows=2); rect per block, palette by index.
check('two blocks, auto grid -> one rect each, palette by index', () => {
  assert.strictEqual(grid({ blocks: [[0,0,1,1],[1,1,2,1]] }), TWO);
});

// 2 — overflow "clip": a block wider than the pinned grid is drawn clipped to bounds.
check('overflow clip: 3-wide block in a 2-wide grid -> clipped to 2 cells', () => {
  const exp =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44" width="44" height="44">\n' +
    '<rect x="2" y="2" width="40" height="20" fill="#2f6f8f" />\n' +
    '</svg>\n';
  assert.strictEqual(grid({ blocks: [[0,0,3,1]], cols: 2, rows: 2, overflow: 'clip' }), exp);
});

// 3 — overflow "skip": a block starting outside the grid is omitted entirely.
check('overflow skip: block at col 3 in a 2-col grid -> omitted', () => {
  const exp =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44" width="44" height="44">\n' +
    '<rect x="2" y="2" width="20" height="20" fill="#2f6f8f" />\n' +
    '</svg>\n';
  assert.strictEqual(grid({ blocks: [[0,0,1,1],[0,3,1,1]], cols: 2, rows: 2, overflow: 'skip' }), exp);
});

// 4 — overflow "error" (the default): an overflowing block on a pinned grid THROWS.
check('overflow error (default): overflowing block throws, naming the grid', () => {
  assert.throws(() => grid({ blocks: [[0,0,3,1]], cols: 2, rows: 2 }),
    /block\[0\] at \(row 0, col 0\) size 3x1 exceeds the fixed 2x2 grid \(overflow policy "error"\)/);
});

// 5 — pinned empty grid -> an empty frame of the declared size.
check('pinned empty grid -> empty 2x2 frame', () => {
  assert.strictEqual(grid({ blocks: [], cols: 2, rows: 2 }),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44" width="44" height="44">\n</svg>\n');
});

// 6 — empty auto grid -> a minimal frame (cols=rows=0).
check('empty auto grid -> minimal frame', () => {
  assert.strictEqual(grid({ blocks: [] }),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4" width="4" height="4">\n</svg>\n');
});

// 7 — object-form block + custom cell size render identically to the array form.
check('object-form block + --cell 10', () => {
  const exp =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">\n' +
    '<rect x="2" y="2" width="20" height="20" fill="#2f6f8f" />\n' +
    '</svg>\n';
  assert.strictEqual(grid({ blocks: [{ row:0, col:0, w:2, h:2 }], cell: 10 }), exp);
});

// 8 — I3 closed palette + no text: every fill is a palette color; no <text>/<script>.
check('closed palette + no text', () => {
  const out = grid({ blocks: [[0,0,1,1],[1,0,1,1],[2,0,1,1]] });
  assert.ok(!/<text|<script|<style|font/.test(out), 'no text/script/style/font');
  const closed = new Set(Object.values(PALETTES).flat());
  const fills = (out.match(/fill="([^"]*)"/g) || []).map(s => s.slice(6, -1));
  assert.ok(fills.length === 3 && fills.every(f => closed.has(f)), 'every fill in the closed palette');
});

// 9 — determinism: same blocks + grid + policy -> byte-identical, twice.
check('determinism: repeated render is byte-identical', () => {
  const s = { blocks: [[0,0,2,1],[1,0,1,2],[0,2,1,1]], cols: 3, rows: 3 };
  assert.strictEqual(grid(s), grid(s));
});

// 10 — bad coordinate / span are hard, named errors.
check('bad coord/span throws, naming the block', () => {
  assert.throws(() => grid({ blocks: [[0,-1,1,1]] }), /block\[0\] col must be a non-negative integer/);
  assert.throws(() => grid({ blocks: [[0,0,0,1]] }), /block\[0\] w must be a positive integer/);
  assert.throws(() => grid({ blocks: [[NaN,0,1,1]] }), /block\[0\] row must be a non-negative integer/);
});

// 11 — unknown palette / unknown overflow policy throw (never a silent fallback).
check('unknown palette / overflow throws', () => {
  assert.throws(() => grid({ blocks: [[0,0,1,1]], palette: 'nope' }), /unknown palette/);
  assert.throws(() => grid({ blocks: [[0,0,1,1]], overflow: 'nope' }), /unknown overflow policy/);
});

// 12 — mutation bite (non-vacuity): a wrong-color SVG is rejected.
check('mutation bite: a wrong-color SVG is rejected', () => {
  const wrong = TWO.replace('fill="#c25b3a"', 'fill="#4a8a52"');
  const got = grid({ blocks: [[0,0,1,1],[1,1,2,1]] });
  assert.strictEqual(got, TWO);
  assert.notStrictEqual(got, wrong);
});

console.log('\n' + passed + '/' + n + ' passed');
if (passed !== n) process.exit(1);
