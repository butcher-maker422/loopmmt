#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */
/* conform.js — does this JSONL output match the record schema you declared?
 *
 * A model (or any producer) emits JSONL: one JSON value per line. You expect
 * every line to be a record of a known shape — an object with declared fields
 * of declared types. conform reads the stream against a schema you write and,
 * the moment a record does not conform, REFUSES: it names the line, the field,
 * and what was wrong, and stops. A clean run means every record matched the
 * declared STRUCTURE — never that the content is correct or meaningful.
 *
 * Structural, not semantic. conform checks that a field is present and is the
 * declared TYPE (string / number / integer / boolean / enum / array / object),
 * optionally in range or one of a fixed set. It does NOT check that a value is
 * true, sensible, or what the model should have said — a well-typed lie passes.
 *
 * The load-bearing rule: FAIL-CLOSED and FAIL-FIRST. The first non-conforming
 * record is the verdict — conform reports {line, field, reason} and exits 1,
 * so it drops straight into a CI gate on a model's output. A run over a clean
 * stream exits 0. A malformed line (not JSON at all) is itself a conformance
 * failure at that line, never a crash and never a skip.
 *
 * Zero dependencies. Deterministic: the same stream + schema yield the same
 * verdict, every run. Runs in Node or a browser (window.GiftConform).
 *
 * CEILING (printed): conform proves STRUCTURE, not TRUTH. A clean pass means
 * every record has the declared fields at the declared types — it is not a
 * certificate that the model's answer is right. It validates the schema YOU
 * declared; declare the wrong schema and it will faithfully pass the wrong
 * records. Choosing a schema that captures what you actually require is your job.
 */

'use strict';

var CEILING =
  'conform proves STRUCTURE, not TRUTH: a clean pass means every record has the ' +
  'declared fields at the declared types, never that the content is correct. It ' +
  'validates the schema you declared — declare the wrong one and it passes the ' +
  'wrong records. A well-typed lie conforms.';

/* ---- the type checks (closed set) -------------------------------------- */
/* Each returns null on OK, or a short reason string on failure. Pure. */

function checkType(value, spec) {
  var t = spec.type;
  if (t === 'string') {
    if (typeof value !== 'string') return 'expected string, got ' + jsType(value);
    if (spec.maxLen != null && value.length > spec.maxLen)
      return 'string longer than maxLen ' + spec.maxLen + ' (len ' + value.length + ')';
    if (spec.pattern != null) {
      // pattern is a source string compiled once by the caller into spec._re
      if (spec._re && !spec._re.test(value)) return 'string does not match pattern ' + spec.pattern;
    }
    return null;
  }
  if (t === 'number') {
    if (typeof value !== 'number' || !isFinite(value)) return 'expected finite number, got ' + jsType(value);
    if (spec.min != null && value < spec.min) return 'number below min ' + spec.min + ' (got ' + value + ')';
    if (spec.max != null && value > spec.max) return 'number above max ' + spec.max + ' (got ' + value + ')';
    return null;
  }
  if (t === 'integer') {
    if (typeof value !== 'number' || !isFinite(value) || Math.floor(value) !== value)
      return 'expected integer, got ' + jsType(value) + (typeof value === 'number' ? ' ' + value : '');
    if (spec.min != null && value < spec.min) return 'integer below min ' + spec.min + ' (got ' + value + ')';
    if (spec.max != null && value > spec.max) return 'integer above max ' + spec.max + ' (got ' + value + ')';
    return null;
  }
  if (t === 'boolean') {
    if (typeof value !== 'boolean') return 'expected boolean, got ' + jsType(value);
    return null;
  }
  if (t === 'enum') {
    if (!Array.isArray(spec.values)) return 'schema error: enum field has no values[]';
    if (spec.values.indexOf(value) === -1)
      return 'value ' + JSON.stringify(value) + ' not in enum ' + JSON.stringify(spec.values);
    return null;
  }
  if (t === 'array') {
    if (!Array.isArray(value)) return 'expected array, got ' + jsType(value);
    if (spec.minItems != null && value.length < spec.minItems)
      return 'array shorter than minItems ' + spec.minItems + ' (len ' + value.length + ')';
    return null;
  }
  if (t === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      return 'expected object, got ' + jsType(value);
    return null;
  }
  return 'schema error: unknown type ' + JSON.stringify(t);
}

function jsType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/* ---- compile a schema (once): pre-build any regexes -------------------- */
function compileSchema(schema) {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema))
    throw new Error('schema must be an object mapping field -> spec');
  var out = {};
  var fields = Object.keys(schema).sort();  // deterministic field order
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i], spec = schema[f];
    if (spec === null || typeof spec !== 'object' || Array.isArray(spec))
      throw new Error('schema error: field ' + JSON.stringify(f) + ' spec must be an object');
    var c = {};
    for (var k in spec) if (Object.prototype.hasOwnProperty.call(spec, k)) c[k] = spec[k];
    if (c.type === 'string' && c.pattern != null) c._re = new RegExp(c.pattern);
    out[f] = c;
  }
  return { fields: fields, specs: out };
}

/* ---- check one record against the compiled schema --------------------- */
/* Returns null on OK, or { field, reason } on the FIRST failure (field order
 * is the sorted schema order, so the reported field is deterministic). */
function checkRecord(rec, compiled) {
  if (rec === null || typeof rec !== 'object' || Array.isArray(rec))
    return { field: null, reason: 'record is not a JSON object (got ' + jsType(rec) + ')' };
  for (var i = 0; i < compiled.fields.length; i++) {
    var f = compiled.fields[i], spec = compiled.specs[f];
    var present = Object.prototype.hasOwnProperty.call(rec, f);
    if (!present) {
      if (spec.required) return { field: f, reason: 'required field missing' };
      continue;  // optional + absent = OK
    }
    var reason = checkType(rec[f], spec);
    if (reason) return { field: f, reason: reason };
  }
  return null;
}

/* ---- the stream verdict: fail-first over JSONL ------------------------ */
/* lines: array of raw strings (one JSONL line each, no trailing newline).
 * schema: field -> spec map.
 * Returns { ok, checked, verdict } where verdict on failure is
 *   { line, field, reason, raw }  (line is 1-based; raw is the offending text).
 * Blank lines are skipped (a blank line is not a record). Deterministic. */
function conform(lines, schema) {
  var compiled = compileSchema(schema);
  var checked = 0;
  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i];
    if (raw == null) continue;
    var trimmed = raw.replace(/\s+$/, '');
    if (trimmed.replace(/^\s+/, '') === '') continue; // blank line: skip
    var rec;
    try {
      rec = JSON.parse(trimmed);
    } catch (e) {
      return { ok: false, checked: checked,
        verdict: { line: i + 1, field: null, reason: 'not valid JSON: ' + e.message, raw: trimmed } };
    }
    var fail = checkRecord(rec, compiled);
    if (fail) {
      return { ok: false, checked: checked,
        verdict: { line: i + 1, field: fail.field, reason: fail.reason, raw: trimmed } };
    }
    checked++;
  }
  return { ok: true, checked: checked, verdict: null };
}

/* ---- exports ---------------------------------------------------------- */
var API = { conform: conform, checkRecord: checkRecord, compileSchema: compileSchema, CEILING: CEILING };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.GiftConform = API;

/* ---- CLI -------------------------------------------------------------- */
function main(argv) {
  var fs = require('fs');
  var args = argv.slice(2);
  if (args.indexOf('--help') !== -1 || args.length === 0) {
    process.stderr.write(
      'conform — assert JSONL records match a declared schema (structural, fail-first).\n\n' +
      'usage:\n' +
      '  node conform.js --schema schema.json data.jsonl   # exit 0 clean, 1 on first bad record\n' +
      '  cat data.jsonl | node conform.js --schema schema.json\n' +
      '  node conform.js --selftest\n\n' +
      'CEILING: ' + CEILING + '\n');
    return args.length === 0 ? 2 : 0;
  }
  if (args.indexOf('--selftest') !== -1) return selftest();
  var si = args.indexOf('--schema');
  if (si === -1 || !args[si + 1]) { process.stderr.write('conform: --schema FILE is required\n'); return 2; }
  var schema;
  try { schema = JSON.parse(fs.readFileSync(args[si + 1], 'utf8')); }
  catch (e) { process.stderr.write('conform: cannot read schema: ' + e.message + '\n'); return 2; }
  // data file = the first non-flag arg that isn't the schema path
  var dataPath = null;
  for (var i = 0; i < args.length; i++) {
    if (args[i] === '--schema') { i++; continue; }
    if (args[i].charAt(0) === '-') continue;
    dataPath = args[i]; break;
  }
  var text;
  try { text = dataPath ? fs.readFileSync(dataPath, 'utf8') : fs.readFileSync(0, 'utf8'); }
  catch (e) { process.stderr.write('conform: cannot read data: ' + e.message + '\n'); return 2; }
  var lines = text.split('\n');
  var res;
  try { res = conform(lines, schema); }
  catch (e) { process.stderr.write('conform: ' + e.message + '\n'); return 2; }
  process.stderr.write('CEILING: ' + CEILING + '\n');
  if (res.ok) { process.stdout.write('CLEAN: ' + res.checked + ' record(s) conform\n'); return 0; }
  var v = res.verdict;
  process.stdout.write('REFUSE line ' + v.line +
    (v.field ? ' field ' + JSON.stringify(v.field) : '') + ': ' + v.reason + '\n');
  return 1;
}

/* ---- selftest: golden corpus, mutation-checkable ---------------------- */
function selftest() {
  var pass = 0, fail = 0;
  function ck(name, cond) { if (cond) pass++; else { fail++; process.stderr.write('  FAIL ' + name + '\n'); } }

  var schema = {
    id:    { type: 'integer', min: 0, required: true },
    name:  { type: 'string', maxLen: 40, required: true },
    score: { type: 'number', min: 0, max: 1 },
    kind:  { type: 'enum', values: ['a', 'b', 'c'] },
    tags:  { type: 'array' }
  };

  // clean stream
  var clean = [
    '{"id":1,"name":"alpha","score":0.5,"kind":"a","tags":[]}',
    '{"id":2,"name":"beta"}',                         // optionals absent = OK
    '',                                               // blank line skipped
    '{"id":3,"name":"gamma","kind":"c","tags":["x"]}'
  ];
  var r = conform(clean, schema);
  ck('clean-ok', r.ok === true);
  ck('clean-count', r.checked === 3);          // blank line not counted

  // missing required field -> first-fail on that line/field
  r = conform(['{"id":1,"name":"a"}', '{"name":"noid"}'], schema);
  ck('missing-required-fails', r.ok === false);
  ck('missing-required-line', r.verdict.line === 2);
  ck('missing-required-field', r.verdict.field === 'id');
  ck('missing-required-checked', r.checked === 1);  // first line passed

  // wrong type
  r = conform(['{"id":"notint","name":"x"}'], schema);
  ck('wrong-type-fails', r.ok === false);
  ck('wrong-type-field', r.verdict.field === 'id');

  // out of range
  r = conform(['{"id":1,"name":"x","score":2}'], schema);
  ck('range-fails', r.ok === false && r.verdict.field === 'score');

  // enum violation
  r = conform(['{"id":1,"name":"x","kind":"z"}'], schema);
  ck('enum-fails', r.ok === false && r.verdict.field === 'kind');

  // maxLen
  r = conform(['{"id":1,"name":"' + new Array(50).join('x') + '"}'], schema);
  ck('maxlen-fails', r.ok === false && r.verdict.field === 'name');

  // not-JSON line is a conformance failure, not a crash
  r = conform(['{"id":1,"name":"x"}', 'this is not json'], schema);
  ck('bad-json-fails', r.ok === false && r.verdict.line === 2 && r.verdict.field === null);

  // non-object record
  r = conform(['[1,2,3]'], schema);
  ck('non-object-fails', r.ok === false && r.verdict.field === null);

  // fail-FIRST: two bad records, only the first is reported
  r = conform(['{"name":"nofirst"}', '{"name":"nosecond"}'], schema);
  ck('fail-first-line', r.verdict.line === 1);

  // determinism: same input twice is byte-identical verdict
  var a = JSON.stringify(conform(clean, schema));
  var b = JSON.stringify(conform(clean, schema));
  ck('deterministic', a === b);

  // field order deterministic: a record failing two fields reports the
  // alphabetically-first ('id' before 'name')
  r = conform(['{"score":5}'], schema);   // id missing AND name missing AND score out of range
  ck('field-order-deterministic', r.verdict.field === 'id');

  // pattern
  var ps = { code: { type: 'string', pattern: '^[A-Z]{3}$', required: true } };
  ck('pattern-ok', conform(['{"code":"ABC"}'], ps).ok === true);
  ck('pattern-fails', conform(['{"code":"abcd"}'], ps).ok === false);

  // schema error surfaces (bad schema throws, caught by caller)
  var threw = false;
  try { conform(['{}'], { x: 'notaspec' }); } catch (e) { threw = true; }
  ck('bad-schema-throws', threw === true);

  var msg = (fail === 0 ? 'GREEN' : 'RED') + ': ' + pass + ' checks passed, ' + fail + ' failed  [conform]\n';
  process.stderr.write(msg);
  return fail === 0 ? 0 : 1;
}

if (typeof require !== 'undefined' && require.main === module) {
  process.exit(main(process.argv));
}
