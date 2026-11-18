#!/usr/bin/env node
/*
 * test_gantt-sink.js — drift-check battery for the gantt-sink gift.
 *
 * THE ORACLE IS OUT-OF-BAND BY CONSTRUCTION. The expected SVG documents below are hand-computed
 * from the documented math — xScale(t) = pad + (t-lo)/(hi-lo)*innerW (W=204, pad=2, innerW=200,
 * rowH=20), rows in input order, bar color = PALETTES.loop[row], label XML-escaped — written
 * independently of the emitter, not captured from its output. A build cannot certify itself, so
 * the expected strings are the author's fact. The escaping vector is the CHAR-OF-THIS-GIFT: the
 * one caller-text surface, closed by xmlEscape; a <script>/<b> label must appear ONLY as escaped
 * entities, never as raw markup.
 *
 * Run: node test_gantt-sink.js   (exit 0 = all pass; nonzero = a named failure)
 */
'use strict';
const assert = require('assert');
const { gantt } = require('./gantt-sink.js');

let n = 0, passed = 0;
function check(name, fn) {
  n++;
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '  — ' + e.message); process.exitCode = 1; }
}

// loop palette: #2f6f8f #c25b3a #4a8a52 #8a6d3b #6d4a8a #3b6d8a ; text #111111 ; font-size 11
const TWO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 204 44" width="204" height="44">\n' +
  '<rect x="2" y="5" width="120" height="14" fill="#2f6f8f" />\n' +
  '<text x="4" y="16" font-size="11" fill="#111111">design</text>\n' +
  '<rect x="82" y="25" width="120" height="14" fill="#c25b3a" />\n' +
  '<text x="84" y="36" font-size="11" fill="#111111">build</text>\n' +
  '</svg>\n';

// 1 — two tasks: auto-domain [0,5] -> xScale(t)=2+t*40; rows in input order, palette by row.
check('two tasks: [[0,3,design],[2,5,build]] -> ordered bars + labels', () => {
  assert.strictEqual(gantt({ tasks: [[0,3,"design"],[2,5,"build"]] }), TWO);
});

// 2 — THE escaping probe: a hostile label renders ONLY as entities, never as raw markup.
check('escaping: label <b>&"\' -> entities only, no raw markup', () => {
  const exp =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 204 24" width="204" height="24">\n' +
    '<rect x="2" y="5" width="200" height="14" fill="#2f6f8f" />\n' +
    '<text x="4" y="16" font-size="11" fill="#111111">&lt;b&gt;&amp;&quot;&#39;</text>\n' +
    '</svg>\n';
  const out = gantt({ tasks: [[0,1,"<b>&\"'"]] });
  assert.strictEqual(out, exp);
  // security assertions: no raw label markup leaks into the output.
  assert.ok(!out.includes('<b>'), 'raw <b> must never appear');
  assert.ok(out.includes('&lt;b&gt;'), 'label < > must be escaped');
});

// 2b — a <script> label cannot break out (defense-in-depth, the classic attack).
check('escaping: <script> label never appears as a real tag', () => {
  const out = gantt({ tasks: [[0,1,"<script>alert(1)</script>"]] });
  assert.ok(!out.includes('<script'), 'no raw <script tag');
  assert.ok(out.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'script label fully escaped');
});

// 3 — milestone (start==end): flat window -> zero-width bar, no divide-by-0.
check('milestone: [[2,2,ship]] -> zero-width bar centered', () => {
  const exp =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 204 24" width="204" height="24">\n' +
    '<rect x="102" y="5" width="0" height="14" fill="#2f6f8f" />\n' +
    '<text x="104" y="16" font-size="11" fill="#111111">ship</text>\n' +
    '</svg>\n';
  assert.strictEqual(gantt({ tasks: [[2,2,"ship"]] }), exp);
});

// 4 — empty input -> a valid, empty frame (height = 2*pad).
check('empty: {tasks:[]} -> empty <svg> frame', () => {
  assert.strictEqual(gantt({ tasks: [] }),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 204 4" width="204" height="4">\n</svg>\n');
});

// 5 — pinned domain + object-form task render identically to the array form.
check('pinned + object task: {start,end,label} on [0,4]', () => {
  const exp =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 204 24" width="204" height="24">\n' +
    '<rect x="2" y="5" width="100" height="14" fill="#2f6f8f" />\n' +
    '<text x="4" y="16" font-size="11" fill="#111111">a</text>\n' +
    '</svg>\n';
  assert.strictEqual(gantt({ tasks: [{start:0,end:2,label:"a"}], min:0, max:4 }), exp);
});

// 6 — empty label string is allowed (an empty <text> element).
check('empty label -> empty <text> element', () => {
  const exp =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 204 24" width="204" height="24">\n' +
    '<rect x="2" y="5" width="200" height="14" fill="#2f6f8f" />\n' +
    '<text x="4" y="16" font-size="11" fill="#111111"></text>\n' +
    '</svg>\n';
  assert.strictEqual(gantt({ tasks: [[0,1,""]] }), exp);
});

// 7 — determinism: same tasks -> byte-identical output, twice.
check('determinism: repeated render is byte-identical', () => {
  const t = { tasks: [[0,2,"a"],[1,5,"b"],[3,4,"c"]] };
  assert.strictEqual(gantt(t), gantt(t));
});

// 8 — non-finite start/end is a hard, named error.
check('non-finite start/end throws, naming the task', () => {
  assert.throws(() => gantt({ tasks: [[NaN,1,"a"]] }), /task\[0\] start is not a finite number/);
  assert.throws(() => gantt({ tasks: [[0,Infinity,"a"]] }), /task\[0\] end is not a finite number/);
});

// 9 — end before start is a hard, named error (an inverted task, never silently swapped).
check('end<start throws', () => {
  assert.throws(() => gantt({ tasks: [[3,1,"a"]] }), /task\[0\] end \(1\) is before start \(3\)/);
});

// 10 — a non-string label throws (a label must be text, never a coerced number/object).
check('non-string label throws', () => {
  assert.throws(() => gantt({ tasks: [[0,1,5]] }), /task\[0\] label must be a string/);
  assert.throws(() => gantt({ tasks: [[0,1,{}]] }), /label must be a string/);
});

// 11 — unknown palette throws (never a silent fallback).
check('unknown palette throws', () => {
  assert.throws(() => gantt({ tasks: [[0,1,"a"]], palette: "nope" }), /unknown palette/);
});

// 12 — mutation bite (non-vacuity): a wrong-color SVG is rejected.
check('mutation bite: a wrong-color SVG is rejected', () => {
  const wrong = TWO.replace('fill="#c25b3a"', 'fill="#4a8a52"');
  const got = gantt({ tasks: [[0,3,"design"],[2,5,"build"]] });
  assert.strictEqual(got, TWO);
  assert.notStrictEqual(got, wrong);
});

// The file door (S18.1220-quiet-cellar-f6sj84; owed node-gifts-file-output-short-write-silent). Node reports a write to a regular
// file that only partly fit as a success, so a cut chart used to exit 0.
(function () {
  const cp = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gantt-sink-file-'));
  fs.writeFileSync(path.join(tmp, 'in.txt'), Array.from({length: 1500}, (_, i) => JSON.stringify([i, i + 3, 'task ' + i])).join('\n') + '\n');
  const q = JSON.stringify(process.execPath) + ' ' + JSON.stringify(path.join(__dirname, 'gantt-sink.js'));
  const sh = (cmd) => cp.spawnSync('bash', ['-c', cmd], { cwd: tmp, encoding: 'utf8' });
  const piped = sh(q + ' < in.txt').stdout;
  check('file: the chart written to a regular file is the same bytes as the chart written to a pipe', () => {
    assert.strictEqual(sh(q + ' < in.txt > whole.out; echo $?').stdout.trim(), '0');
    assert.ok(Buffer.byteLength(piped) > 8192, 'the answer must be larger than the 8 KB limit below');
    assert.strictEqual(fs.readFileSync(path.join(tmp, 'whole.out'), 'utf8'), piped);
  });
  check('file: a file that takes only part of the chart exits 1, says so in one line, and is left empty', () => {
    const r = sh('ulimit -f 8; ' + q + ' < in.txt > cut.out 2> cut.err; echo $?');
    assert.strictEqual(r.stdout.trim(), '1', 'exit code');
    assert.strictEqual(fs.statSync(path.join(tmp, 'cut.out')).size, 0, 'a cut answer was left in the file');
    const err = fs.readFileSync(path.join(tmp, 'cut.err'), 'utf8').trim().split('\n');
    assert.strictEqual(err.length, 1);
    assert.ok(/^gantt-sink: cannot write the whole output/.test(err[0]), err[0]);
  });
  check('file: appending a chart that does not fit leaves what the file held', () => {
    fs.writeFileSync(path.join(tmp, 'log.txt'), 'yesterday\n');
    assert.strictEqual(sh('ulimit -f 8; ' + q + ' < in.txt >> log.txt 2>/dev/null; echo $?').stdout.trim(), '1');
    assert.strictEqual(fs.readFileSync(path.join(tmp, 'log.txt'), 'utf8'), 'yesterday\n');
  });
  check('browser: the file still loads where there is no require', () => {
    const vm = require('vm'), sandbox = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'gantt-sink.js'), 'utf8'), sandbox);
    if (sandbox.window.LoopGifts) assert.strictEqual(typeof sandbox.window.LoopGifts['gantt-sink'], 'object');
  });
  fs.rmSync(tmp, { recursive: true, force: true });
})();

console.log('\n' + passed + '/' + n + ' passed');
if (passed !== n) process.exit(1);
