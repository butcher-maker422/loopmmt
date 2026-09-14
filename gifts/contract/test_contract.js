#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */
/* test_contract.js — out-of-band battery for the contract gift.
 *
 * Oracles are hand-computed here, independent of contract.js's own --selftest:
 * the test asserts WHAT the answer must be, the gift computes it, we compare.
 * A green battery + a green --selftest are two witnesses, not one restated.
 */
var C = require('./contract.js');
var fails = [];
function eq(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) fails.push(name + '\n    got : ' + g + '\n    want: ' + w);
}
function truthy(name, cond) { if (!cond) fails.push(name); }

var schema = {
  id:   { type: 'number', required: true },
  name: 'string',
  tags: { type: 'array', required: false }
};

/* 1. a fully-conforming stream → ok:true (extra field allowed, open mode) */
eq('T1 conforming', C.check(
  '{"id":1,"name":"a","tags":[]}\n{"id":2,"name":"b"}\n{"id":3,"name":"c","x":9}\n', schema),
  { ok: true });

/* 2. missing required field on record 2 → line 2, field name, missing */
eq('T2 missing required', C.check('{"id":1,"name":"a"}\n{"id":2}\n', schema),
  { ok: false, line: 2, field: 'name', reason: 'missing required field' });

/* 3. wrong type on id (string not number), record 1 */
eq('T3 wrong type', C.check('{"id":"1","name":"a"}\n', schema),
  { ok: false, line: 1, field: 'id', reason: 'expected number, got string' });

/* 4. FIRST bad record wins — record 2 fails (missing name), record 3 also would */
eq('T4 first wins', C.check('{"id":1,"name":"a"}\n{"id":2}\n{"name":"z"}\n', schema),
  { ok: false, line: 2, field: 'name', reason: 'missing required field' });

/* 5. optional field present but wrong type → caught at that field */
eq('T5 optional typed', C.check('{"id":1,"name":"a","tags":"nope"}\n', schema),
  { ok: false, line: 1, field: 'tags', reason: 'expected array, got string' });

/* 6. a record that is not an object (an array) → field null, structural reason */
eq('T6 non-object', C.check('{"id":1,"name":"a"}\n[1,2]\n', schema),
  { ok: false, line: 2, field: null, reason: 'record is not a JSON object (got array)' });

/* 7. closed mode rejects the first unexpected field; open mode passes it */
eq('T7 closed rejects', C.check('{"id":1,"name":"a","surprise":1}\n', schema, { closed: true }),
  { ok: false, line: 1, field: 'surprise', reason: 'unexpected field (schema is closed)' });
eq('T7 open allows',   C.check('{"id":1,"name":"a","surprise":1}\n', schema),
  { ok: true });

/* 8. null type + any type */
var s2 = { x: { type: 'null' }, y: { type: 'any' } };
eq('T8 null ok',   C.check('{"x":null,"y":0}\n', s2), { ok: true });
eq('T8 null bad',  C.check('{"x":5,"y":0}\n', s2),
  { ok: false, line: 1, field: 'x', reason: 'expected null, got number' });
eq('T8 any ok',    C.check('{"x":null,"y":{"z":[1,2]}}\n', s2), { ok: true });

/* 9. shorthand string rule === {type,required:true} */
eq('T9 shorthand', C.check('{"name":5}\n', { name: 'string' }),
  { ok: false, line: 1, field: 'name', reason: 'expected string, got number' });

/* 10. boolean + object types */
var s3 = { flag: 'boolean', meta: { type: 'object' } };
eq('T10 bool+object ok',  C.check('{"flag":true,"meta":{}}\n', s3), { ok: true });
eq('T10 object rejects array', C.check('{"flag":false,"meta":[]}\n', s3),
  { ok: false, line: 1, field: 'meta', reason: 'expected object, got array' });

/* 11. empty stream (blank lines only) → vacuously ok */
eq('T11 empty ok', C.check('\n  \n\n', schema), { ok: true });

/* 12. ill-formed schema throws a tagged ContractError (→ exit 2 path) */
var threw = false;
try { C.check('{}\n', { f: { type: 'nope' } }); } catch (e) { threw = e && e.contract === true; }
truthy('T12 bad schema throws tagged', threw);
var threw2 = false;
try { C.check('{}\n', [1, 2, 3]); } catch (e) { threw2 = e && e.contract === true; }
truthy('T12 non-object schema throws', threw2);

/* 13. bad JSON in records throws (→ exit 2), with line number */
var threwJ = false, msgJ = '';
try { C.check('{"id":1,"name":"a"}\n{oops\n', schema); } catch (e) { threwJ = e && e.contract === true; msgJ = e.message; }
truthy('T13 bad json throws', threwJ && /:2:/.test(msgJ));

/* 14. determinism — identical verdict object across repeated calls */
truthy('T14 idempotent',
  JSON.stringify(C.check('{"id":2}\n', schema)) === JSON.stringify(C.check('{"id":2}\n', schema)));

/* 15. required:false absent is fine; required:false present-and-right is fine */
var s4 = { a: { type: 'number', required: false } };
eq('T15 optional absent', C.check('{}\n', s4), { ok: true });
eq('T15 optional present ok', C.check('{"a":7}\n', s4), { ok: true });

/* 16. field order determinism — id checked before name (schema-declared order);
 *     a record missing BOTH reports id first, not name */
eq('T16 field order', C.check('{}\n', schema),
  { ok: false, line: 1, field: 'id', reason: 'missing required field' });

if (fails.length) {
  console.error('BATTERY FAIL (' + fails.length + '):\n  ' + fails.join('\n  '));
  process.exit(1);
}
console.log('BATTERY OK — all checks passed');
process.exit(0);
