#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */
/* test_conform.js — external battery for conform.js.
 *
 * Independent of the in-file --selftest: this file constructs its own JSONL
 * streams and schemas and asserts the PUBLIC behavior (conform / checkRecord /
 * compileSchema / CEILING), so a regression in the core trips here even if the
 * selftest were also broken. Mutation-bitten: mutate a core rule, this goes RED.
 */
'use strict';
var C = require('./conform.js');
var pass = 0, fail = 0;
function ck(name, cond) { if (cond) pass++; else { fail++; console.error('  FAIL ' + name); } }

var schema = {
  id:    { type: 'integer', required: true },
  email: { type: 'string', pattern: '@', required: true },
  age:   { type: 'integer', min: 0, max: 150 },
  role:  { type: 'enum', values: ['admin', 'user'] }
};

// 1. a fully-conforming stream passes and counts every non-blank record
var ok = C.conform([
  '{"id":1,"email":"a@x.com","age":30,"role":"admin"}',
  '{"id":2,"email":"b@x.com"}'
], schema);
ck('all-conform-ok', ok.ok === true);
ck('all-conform-count', ok.checked === 2);

// 2. missing required field: named field, right line, fail-closed
var r = C.conform(['{"id":1,"email":"a@x.com"}', '{"email":"b@x.com"}'], schema);
ck('missing-id-refused', r.ok === false);
ck('missing-id-line-2', r.verdict.line === 2);
ck('missing-id-field', r.verdict.field === 'id');

// 3. type mismatch on a present field
r = C.conform(['{"id":"one","email":"a@x.com"}'], schema);
ck('id-string-refused', r.ok === false && r.verdict.field === 'id');

// 4. pattern (email must contain @)
r = C.conform(['{"id":1,"email":"noatsign"}'], schema);
ck('email-pattern-refused', r.ok === false && r.verdict.field === 'email');

// 5. range on optional field
r = C.conform(['{"id":1,"email":"a@x.com","age":200}'], schema);
ck('age-range-refused', r.ok === false && r.verdict.field === 'age');
r = C.conform(['{"id":1,"email":"a@x.com","age":-1}'], schema);
ck('age-negative-refused', r.ok === false && r.verdict.field === 'age');

// 6. enum
r = C.conform(['{"id":1,"email":"a@x.com","role":"root"}'], schema);
ck('role-enum-refused', r.ok === false && r.verdict.field === 'role');

// 7. malformed JSON line is a conformance failure at that line, field null
r = C.conform(['{"id":1,"email":"a@x.com"}', '{ broken'], schema);
ck('bad-json-refused', r.ok === false && r.verdict.line === 2 && r.verdict.field === null);
ck('bad-json-reason', /not valid JSON/.test(r.verdict.reason));

// 8. non-object record refused (array / scalar)
ck('array-record-refused', C.conform(['[1,2]'], schema).ok === false);
ck('scalar-record-refused', C.conform(['42'], schema).ok === false);

// 9. blank/whitespace lines are skipped, not counted, not failed
r = C.conform(['{"id":1,"email":"a@x.com"}', '   ', '', '{"id":2,"email":"b@x.com"}'], schema);
ck('blank-lines-skipped', r.ok === true && r.checked === 2);

// 10. fail-FIRST: the first bad record is the verdict, later ones never reached
r = C.conform(['{"email":"a@x.com"}', '{"email":"b@x.com"}'], schema);  // both missing id
ck('fail-first-only', r.verdict.line === 1 && r.checked === 0);

// 11. checkRecord is usable standalone and returns the same field verdict
var cs = C.compileSchema(schema);
ck('checkRecord-ok', C.checkRecord({ id: 1, email: 'a@x.com' }, cs) === null);
var cr = C.checkRecord({ email: 'a@x.com' }, cs);
ck('checkRecord-names-field', cr && cr.field === 'id');

// 12. determinism: identical input -> byte-identical verdict JSON
var d1 = JSON.stringify(C.conform(['{"email":"x@y"}'], schema));
var d2 = JSON.stringify(C.conform(['{"email":"x@y"}'], schema));
ck('deterministic-verdict', d1 === d2);

// 13. deterministic field order: fields are checked in SORTED order
//     (age, email, id, role). For {"email":"noat"}: email is present with a
//     bad pattern and sorts before id, so email's failure is reported first —
//     a deterministic, alphabetical-order verdict.
r = C.conform(['{"email":"noat"}'], schema);
ck('field-order-sorted', r.verdict.field === 'email');

// 14. CEILING is present and honest about structure-not-truth
ck('ceiling-present', typeof C.CEILING === 'string' && C.CEILING.length > 20);
ck('ceiling-says-structure', /STRUCTURE|structure/.test(C.CEILING));

// 15. schema itself is validated: a bad spec throws (programmer error, not silent)
var threw = false;
try { C.conform(['{}'], { x: { type: 'nonsense' } }); } catch (e) {}
// unknown TYPE is a per-record schema-error reason, not a throw; a non-object SPEC throws:
threw = false;
try { C.conform(['{}'], { x: 'notanobject' }); } catch (e) { threw = true; }
ck('bad-spec-throws', threw === true);

console.error((fail === 0 ? 'GREEN' : 'RED') + ': ' + pass + ' assertions passed, ' + fail + ' failed  [test_conform]');
process.exit(fail === 0 ? 0 : 1);
