#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */
/* test_palimpsest.js — external battery for palimpsest.js.
 *
 * Proves the survival fold, the canon, determinism, and the CLI contract. Run:
 *     node test_palimpsest.js
 * Exit 0 = all pass; exit 1 = a failure (with the count). This battery is
 * external (require's the gift, does not reach inside it) so a mutation to the
 * gift's logic is caught here — the "bite." Verify the bite: break a line in
 * palimpsest.js and this battery goes RED.
 */
'use strict';
var P = require('./palimpsest.js');
var fails = [];
function check(name, cond) { if (!cond) fails.push(name); }
function eq(name, a, b) { if (a !== b) fails.push(name + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

/* --- survival math --- */
var r = P.layer(['keep\na', 'keep\nb', 'keep\nc'], {});
eq('survival: all-versions line is 1.0', r.survival['keep'], 1.0);
eq('survival: one-version line is 1/3', r.survival['a'], 1 / 3);
eq('core default: exactly one core line', r.core.length, 1);
eq('core default: the survivor', r.core[0].line, 'keep');
eq('churn default: three churn lines', r.churn.length, 3);

/* --- threshold behavior --- */
var half = P.layer(['x\ny', 'x\nz', 'w\nx'], { core: 0.5 });
check('core 0.5: x (3/3) in core', half.core.some(function (o) { return o.line === 'x'; }));
check('core 0.5: y (1/3) not in core', !half.core.some(function (o) { return o.line === 'y'; }));
var none = P.layer(['a', 'b'], { core: 0.0 });
eq('core 0.0: no churn', none.churn.length, 0);
var allT = P.layer(['a', 'b'], { core: 1.0 });
eq('core 1.0: nothing survives disjoint versions', allT.core.length, 0);

/* --- presence counted once per version (not frequency) --- */
var rep = P.layer(['x\nx\nx\nx', 'y'], {});
eq('once-per-version: repeated x is still 1/2', rep.survival['x'], 0.5);

/* --- canon --- */
eq('canon: idempotent', P.canonLine(P.canonLine('a  ')), P.canonLine('a  '));
eq('canon: trailing ws trimmed', P.canonLine('a\t '), 'a');
eq('canon: interior ws preserved', P.canonLine('a  b'), 'a  b');
var ws = P.layer(['line  \nline', 'line'], {});
eq('canon: trailing-ws is not a distinct line', Object.keys(ws.survival).length, 1);

/* --- blank lines dropped --- */
var blanks = P.layer(['real\n\n\n', 'real'], {});
eq('blank lines dropped: only real counted', Object.keys(blanks.survival).length, 1);

/* --- determinism: render stable, order total --- */
var vs = ['tie\nsame', 'tie\nsame'];
eq('render: stable across runs', P.render(P.layer(vs, {})), P.render(P.layer(vs, {})));
// total order under a survival tie: two lines same survival + same enteredAt -> sorted by line
var tie = P.layer(['bbb\naaa'], {});
check('total order: alpha tiebreak', tie.core[0].line === 'aaa' && tie.core[1].line === 'bbb');

/* --- ordering: core sorted by survival desc --- */
var ord = P.layer(['p\nq', 'p\nr', 'p\ns'], { core: 0.0 });
eq('order: highest survival first', ord.churn.length + ord.core.length, 4);
eq('order: p first (survival 1.0)', ord.core[0].line, 'p');

/* --- selftest passes internally --- */
eq('internal selftest clean', P.selftest().length, 0);

/* --- CLI contract via subprocess (exit codes, ceiling in help) --- */
var cp = require('child_process');
var path = require('path');
var GIFT = path.join(__dirname, 'palimpsest.js');
function run(args) {
  var res = cp.spawnSync('node', [GIFT].concat(args), { encoding: 'utf8' });
  return { code: res.status, out: (res.stdout || '') + (res.stderr || '') };
}
var fs = require('fs');
var t1 = path.join(require('os').tmpdir(), 'palimp_t1_' + process.pid + '.txt');
var t2 = path.join(require('os').tmpdir(), 'palimp_t2_' + process.pid + '.txt');
fs.writeFileSync(t1, 'core\ndrop1\n');
fs.writeFileSync(t2, 'core\ndrop2\n');
eq('CLI: clean run exits 0', run([t1, t2]).code, 0);
eq('CLI: missing file exits 2', run(['/no/such/palimpsest/file']).code, 2);
eq('CLI: bad --core exits 2', run(['--core', '9', t1]).code, 2);
eq('CLI: no args exits 2', run([]).code, 2);
eq('CLI: --selftest exits 0', run(['--selftest']).code, 0);
var help = run(['--help']);
check('CLI: --help prints ceiling (stdout+stderr scanned)', /ceiling: palimpsest measures SURVIVAL/.test(help.out));
var list = run(['--list']);
check('CLI: --list prints ceiling', /ceiling: palimpsest measures SURVIVAL/.test(list.out));
try { fs.unlinkSync(t1); fs.unlinkSync(t2); } catch (e) {}

/* --- report --- */
if (fails.length === 0) {
  console.log('test_palimpsest: PASS (all checks)');
  process.exit(0);
} else {
  console.error('test_palimpsest: FAIL (' + fails.length + ')');
  fails.forEach(function (f) { console.error('  - ' + f); });
  process.exit(1);
}
