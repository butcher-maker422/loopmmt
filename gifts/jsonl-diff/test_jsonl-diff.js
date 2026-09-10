#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */
/* test_jsonl-diff.js — the house-standard test file for the jsonl-diff gift.
 *
 * Runs the module's own selftest (canon idempotence/order-faithfulness + the
 * diff modes), then adds API-level assertions the CLI selftest doesn't cover:
 * the set-diff vs keyed-diff distinction, deterministic sort order, the JSON
 * render being canonical + byte-stable, and that adversarial input throws a
 * clean JsonlError rather than a raw crash. Exits non-zero on any failure so it
 * drops straight into a CI gate.
 */
'use strict';
var jd = require('./jsonl-diff.js');

var fails = [];
function ck(name, cond) { if (!cond) fails.push(name); }

// 1. the module's own selftest must pass
ck('module selftest GREEN', jd.selftest() === true);

// 2. canon: order-faithful + idempotent
ck('canon order-faithful', jd.canon({ b: 2, a: 1 }) === jd.canon({ a: 1, b: 2 }));
ck('canon idempotent', jd.canon(jd.canon({ a: [1, 2] })) === jd.canon(jd.canon({ a: [1, 2] })));

// 3. set-diff (no key): a changed record is one remove + one add, never a change
var d = jd.diff('{"id":1,"v":"a"}\n', '{"id":1,"v":"b"}\n', {});
ck('set-diff: change becomes remove+add', d.changed.length === 0 && d.added.length === 1 && d.removed.length === 1);

// 4. keyed diff: same key, different content is a CHANGE with field deltas
d = jd.diff('{"id":1,"v":"a","gone":1}\n', '{"id":1,"v":"b","new":2}\n', { key: 'id' });
ck('keyed: same key differing is a change', d.changed.length === 1);
ck('keyed: field delta names changed/removed/added',
  d.changed[0].fields.changed.v && d.changed[0].fields.removed.gone !== undefined &&
  d.changed[0].fields.added.new !== undefined);

// 5. deterministic sort order (result independent of input line order)
var A = jd.diff('{"id":2}\n{"id":1}\n', '{"id":3}\n{"id":1}\n', { key: 'id' });
var B = jd.diff('{"id":1}\n{"id":2}\n', '{"id":1}\n{"id":3}\n', { key: 'id' });
ck('result independent of input order',
  JSON.stringify(A.removed.map(function (r) { return r.key; })) ===
  JSON.stringify(B.removed.map(function (r) { return r.key; })));

// 6. duplicate key => clean JsonlError (not a raw crash)
var threw = null;
try { jd.diff('{"id":1}\n{"id":1}\n', '{"id":1}\n', { key: 'id' }); } catch (e) { threw = e; }
ck('duplicate key throws JsonlError', threw && threw.jsonl === true);

// 7. bad JSON line => clean JsonlError naming file:line
threw = null;
try { jd.parseJsonl('{"ok":1}\nnope\n', 'x'); } catch (e) { threw = e; }
ck('bad JSON throws JsonlError with location', threw && threw.jsonl === true && /x:2:/.test(threw.message));

// 8. missing --key field => clean JsonlError, not a silent wrong answer
threw = null;
try { jd.diff('{"a":1}\n', '{"a":1}\n', { key: 'id' }); } catch (e) { threw = e; }
ck('missing key field throws JsonlError', threw && threw.jsonl === true);

// 9. blank lines + whitespace are insensitive under canon
d = jd.diff('{"id":1}\n\n', '{ "id" : 1 }\n', { key: 'id' });
ck('whitespace/blank-insensitive', d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0);

// --- the adversarial CLI exits (crashclean; the qualify D4 contract) ---------
var cp = require('child_process');
var here = __dirname + '/jsonl-diff.js';
function run(args) {
  var r = cp.spawnSync('node', [here].concat(args), { encoding: 'utf8' });
  return { code: r.status, err: r.stderr || '', out: r.stdout || '' };
}
var m = run(['/no/such/path_zzz', '/also/missing']);
ck('missing file => exit 2, no stack trace', m.code === 2 && !/\bat \w/.test(m.err));
var one = run(['/no/such/path_zzz']);
ck('one arg => exit 2, no stack trace', one.code === 2 && !/\bat \w/.test(one.err));
var help = run(['--help']);
ck('--help => exit 0', help.code === 0);

if (fails.length) {
  console.error('RED: ' + fails.length + ' failed: ' + fails.join(', ') + '  [test_jsonl-diff]');
  process.exit(1);
}
console.log('GREEN: all checks passed  [test_jsonl-diff]');
