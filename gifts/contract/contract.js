#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */
/* contract.js — assert JSONL output matches a declared record schema, at runtime.
 *
 * A tiny, dependency-free schema check for JSON Lines (one JSON value per line).
 * Give it a stream of records and a SCHEMA you declare, and it walks the records
 * in order and stops at the FIRST one that breaks the contract — naming the
 * record, the field, and what was wrong. Same records + same schema → the same
 * first failure, byte-identical, every run. It drops straight into a CI gate.
 *
 *     records.jsonl, schema ──▶ check(records, schema)
 *                           ──▶ { ok:true }
 *                             | { ok:false, line, field, reason }   (first bad record)
 *
 * THE SCHEMA (declared data, never code). A schema is a plain object naming the
 * fields a record must carry and the STRUCTURE each must have — nothing executes,
 * nothing is eval'd, so a schema is safe to accept from an untrusted source:
 *
 *     { "id":   { "type": "number", "required": true },
 *       "name": { "type": "string", "required": true },
 *       "tags": { "type": "array" },              // present-optional, typed if present
 *       "meta": { "type": "object", "required": false } }
 *
 *   type      one of: string number boolean object array null any
 *             ("object" means a non-array, non-null object; "array" means Array;
 *              "null" means the JSON null; "any" accepts any present value)
 *   required  true (default) → the field must be present; false → may be absent,
 *             but if present it must match `type`.
 *
 *   Shorthand: a bare string value is sugar for a required field of that type —
 *   { "id": "number" } === { "id": { "type": "number", "required": true } }.
 *
 *   By default a record may carry EXTRA fields the schema does not mention; pass
 *   { closed: true } (CLI --closed) to reject the first unexpected field instead.
 *
 * DETERMINISM (the promise, and the self-test that proves it). Records are read
 * in file order; fields are checked in the schema's declared key order; the FIRST
 * violation wins and nothing after it is read. There is no map iteration whose
 * order could vary, no clock, no randomness — the verdict is a pure function of
 * (records, schema). `--selftest` proves a conforming stream passes, a broken one
 * fails at the expected line+field, and the check is idempotent.
 *
 * THE LINE IT WILL NOT CROSS (the honest ceiling — printed every --help/--list).
 * contract checks that each record HAS the declared fields at the declared TYPES.
 * It does NOT check the values are correct, sensible, in range, or true. A record
 * that is structurally perfect and semantically nonsense passes. "age": -3 with
 * type number passes; an email that is not an email passes. Structure, not
 * meaning — a human owns the meaning; contract only makes the shape enforceable.
 *
 * EXIT CODES (filter convention, gate-friendly).
 *   0  every record satisfies the schema
 *   1  a record violated the schema — the FIRST one, with line + field + reason
 *   2  the input could not be used (missing file, unreadable, bad JSON in the
 *      records, or an ill-formed SCHEMA) — always a clean message, never a stack.
 *
 * Runs identically in Node and in a browser (no DOM, no deps). MIT.
 */

var CEILING =
  'ceiling: contract checks STRUCTURE (which fields, which types), not MEANING.\n' +
  '  A structurally-valid record with nonsense values passes — "age":-3 is a valid\n' +
  '  number. A human owns whether the values are right; contract only makes the\n' +
  '  declared shape enforceable and names the first record that breaks it.';

/* ---- errors: a clean, tagged failure, never a stack trace ------------------ */
function ContractError(msg) { var e = new Error(msg); e.contract = true; return e; }

/* ---- the closed type vocabulary (data, not code) -------------------------- */
var TYPES = { string: 1, number: 1, boolean: 1, object: 1, array: 1, 'null': 1, any: 1 };

/* structural type of a JSON value, in this gift's closed vocabulary */
function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  var t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'object') return t;
  return t; // undefined/function can't come from JSON.parse; guarded by schema validation
}

/* ---- normalize + validate a schema (throws ContractError if ill-formed) ---- */
/* returns an ordered list of {field, type, required} so field order is the
 * schema's declared key order — the source of the deterministic field sequence. */
function compileSchema(schema) {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    throw ContractError('schema: must be a JSON object mapping field names to rules');
  }
  var fields = Object.keys(schema);
  var out = [];
  for (var i = 0; i < fields.length; i++) {
    var name = fields[i];
    var rule = schema[name];
    var type, required;
    if (typeof rule === 'string') {           // shorthand: "number" → required number
      type = rule; required = true;
    } else if (rule !== null && typeof rule === 'object' && !Array.isArray(rule)) {
      type = Object.prototype.hasOwnProperty.call(rule, 'type') ? rule.type : 'any';
      required = Object.prototype.hasOwnProperty.call(rule, 'required') ? rule.required : true;
      if (typeof required !== 'boolean') {
        throw ContractError('schema: field ' + JSON.stringify(name) +
          ': "required" must be true or false');
      }
    } else {
      throw ContractError('schema: field ' + JSON.stringify(name) +
        ': rule must be a type string or an object like {"type":"string"}');
    }
    if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(TYPES, type)) {
      throw ContractError('schema: field ' + JSON.stringify(name) +
        ': unknown type ' + JSON.stringify(type) +
        ' (allowed: string number boolean object array null any)');
    }
    out.push({ field: name, type: type, required: required });
  }
  return out;
}

/* ---- parse a JSONL string into records (throws ContractError on a bad line)  */
function parseJsonl(text, label) {
  var out = [];
  var lines = String(text).split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.replace(/\s+/g, '') === '') continue; // skip blank lines
    var obj;
    try { obj = JSON.parse(line); }
    catch (e) {
      throw ContractError(label + ':' + (i + 1) + ': not valid JSON (' +
        ((e && e.message) || 'parse error') + ')');
    }
    out.push({ value: obj, line: i + 1 });
  }
  return out;
}

/* ---- check ONE record against the compiled schema; return null | {field,reason} */
function checkRecord(value, compiled, closed) {
  // a record must be a JSON object (not array, not scalar, not null)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { field: null, reason: 'record is not a JSON object (got ' + typeOf(value) + ')' };
  }
  // fields, in schema-declared order (deterministic)
  for (var i = 0; i < compiled.length; i++) {
    var r = compiled[i];
    var present = Object.prototype.hasOwnProperty.call(value, r.field);
    if (!present) {
      if (r.required) return { field: r.field, reason: 'missing required field' };
      continue; // optional + absent → fine
    }
    if (r.type === 'any') continue; // present + any type accepted
    var actual = typeOf(value[r.field]);
    if (actual !== r.type) {
      return { field: r.field, reason: 'expected ' + r.type + ', got ' + actual };
    }
  }
  // closed mode: reject the first extra field not named by the schema
  if (closed) {
    var declared = {};
    for (var j = 0; j < compiled.length; j++) declared[compiled[j].field] = 1;
    var keys = Object.keys(value); // insertion order from JSON.parse — deterministic per input
    for (var k = 0; k < keys.length; k++) {
      if (!Object.prototype.hasOwnProperty.call(declared, keys[k])) {
        return { field: keys[k], reason: 'unexpected field (schema is closed)' };
      }
    }
  }
  return null;
}

/* ---- the gift: check a JSONL string against a schema ---------------------- */
/* opts: { closed:false, label:'records' }
 * returns { ok:true } | { ok:false, line, field, reason } — the FIRST violation. */
function check(recordsText, schema, opts) {
  opts = opts || {};
  var closed = !!opts.closed;
  var label = opts.label || 'records';
  var compiled = compileSchema(schema);        // throws on ill-formed schema (→ exit 2)
  var recs = parseJsonl(recordsText, label);   // throws on bad JSON (→ exit 2)
  for (var i = 0; i < recs.length; i++) {
    var bad = checkRecord(recs[i].value, compiled, closed);
    if (bad) return { ok: false, line: recs[i].line, field: bad.field, reason: bad.reason };
  }
  return { ok: true };
}

/* ================= self-test (proves the promises; no deps) ================= */
function selftest() {
  var fails = [];
  function ok(name, cond) { if (!cond) fails.push(name); }

  var schema = {
    id:   { type: 'number', required: true },
    name: 'string',                              // shorthand → required string
    tags: { type: 'array', required: false }     // optional, typed if present
  };

  // conforming stream (extra field allowed in default open mode) → ok
  var good = '{"id":1,"name":"a","tags":[]}\n{"id":2,"name":"b"}\n{"id":3,"name":"c","extra":9}\n';
  ok('conforming passes', check(good, schema).ok === true);

  // missing required field → first bad record named
  var miss = '{"id":1,"name":"a"}\n{"id":2}\n{"id":3,"name":"c"}\n';
  var r1 = check(miss, schema);
  ok('missing field caught', r1.ok === false && r1.line === 2 && r1.field === 'name' &&
                             /missing required/.test(r1.reason));

  // wrong type → named with expected/got
  var wrong = '{"id":"1","name":"a"}\n';
  var r2 = check(wrong, schema);
  ok('type mismatch caught', r2.ok === false && r2.line === 1 && r2.field === 'id' &&
                            /expected number, got string/.test(r2.reason));

  // FIRST bad record wins — the second violation is never reported
  var two = '{"id":1,"name":"a"}\n{"id":2}\n{"name":"x"}\n';
  var r3 = check(two, schema);
  ok('first-bad-record wins', r3.ok === false && r3.line === 2 && r3.field === 'name');

  // optional present-but-wrong-type → caught
  var badopt = '{"id":1,"name":"a","tags":"oops"}\n';
  var r4 = check(badopt, schema);
  ok('optional typed-if-present', r4.ok === false && r4.field === 'tags' &&
                                  /expected array, got string/.test(r4.reason));

  // non-object record → structural reject
  var scal = '{"id":1,"name":"a"}\n[1,2,3]\n';
  var r5 = check(scal, schema);
  ok('non-object record rejected', r5.ok === false && r5.line === 2 && r5.field === null);

  // closed mode → first extra field rejected; open mode → same record passes
  var extra = '{"id":1,"name":"a","surprise":1}\n';
  ok('closed rejects extra', check(extra, schema, { closed: true }).ok === false);
  ok('open allows extra', check(extra, schema).ok === true);
  var rc = check(extra, schema, { closed: true });
  ok('closed names the extra field', rc.field === 'surprise' && /unexpected field/.test(rc.reason));

  // 'null' type and 'any' type
  var s2 = { x: { type: 'null' }, y: { type: 'any' } };
  ok('null type matches null', check('{"x":null,"y":0}\n', s2).ok === true);
  ok('null type rejects non-null', check('{"x":0,"y":0}\n', s2).ok === false);
  ok('any accepts anything present', check('{"x":null,"y":{"deep":[1]}}\n', s2).ok === true);

  // ill-formed schema → thrown ContractError (would be exit 2)
  var threw = false;
  try { check('{}\n', { f: { type: 'weird' } }); } catch (e) { threw = !!e.contract; }
  ok('bad schema throws', threw);

  // determinism / idempotence — same inputs, same verdict object twice
  ok('idempotent verdict',
     JSON.stringify(check(miss, schema)) === JSON.stringify(check(miss, schema)));

  // empty stream (no records) → vacuously ok
  ok('empty stream ok', check('\n\n', schema).ok === true);

  if (fails.length) { print('SELFTEST FAIL: ' + fails.join(', ')); return 1; }
  print('SELFTEST OK (' + 15 + ' checks)');
  return 0;
}

/* ================= tiny I/O shim (Node CLI; browser export) ================ */
function print(s) {
  if (typeof process !== 'undefined' && process.stdout) process.stdout.write(s + '\n');
  else if (typeof console !== 'undefined') console.log(s);
}
function eprint(s) {
  if (typeof process !== 'undefined' && process.stderr) process.stderr.write(s + '\n');
  else if (typeof console !== 'undefined') console.error(s);
}

var HELP =
  'contract — assert JSONL records match a declared structural schema.\n\n' +
  'usage:\n' +
  '  contract --schema <schema.json> [<records.jsonl>] [--closed]\n' +
  '  contract --selftest\n' +
  '  contract --help | --list\n\n' +
  'reads records from the file argument or stdin. exit 0 = all pass,\n' +
  '1 = first record that violates the schema (line + field + reason on stderr),\n' +
  '2 = unusable input or ill-formed schema.\n\n' +
  '  --schema F   the declared schema (a JSON object; see below)\n' +
  '  --closed     reject the first field a record carries that the schema omits\n' +
  '  --selftest   run the built-in proofs and exit\n\n' +
  'schema: { "field": {"type":"string","required":true}, ... }\n' +
  '  type: string number boolean object array null any  ·  required: true|false\n' +
  '  shorthand: "field":"number" === required field of that type\n\n' +
  CEILING;

function readAll(fd) {
  var fs = require('fs');
  return fs.readFileSync(fd === undefined ? 0 : fd, 'utf8');
}

function main(argv) {
  var args = argv.slice(2);
  if (args.indexOf('--help') >= 0 || args.indexOf('-h') >= 0) { print(HELP); return 0; }
  if (args.indexOf('--list') >= 0) { print(HELP); return 0; }
  if (args.indexOf('--selftest') >= 0) return selftest();

  var closed = false, schemaPath = null, recPath = null, i;
  for (i = 0; i < args.length; i++) {
    if (args[i] === '--closed') closed = true;
    else if (args[i] === '--schema') { schemaPath = args[++i]; }
    else if (args[i].slice(0, 9) === '--schema=') { schemaPath = args[i].slice(9); }
    else if (args[i].charAt(0) === '-') { eprint('contract: unknown option ' + args[i]); return 2; }
    else recPath = args[i];
  }
  if (!schemaPath) { eprint('contract: --schema <file> is required (see --help)'); return 2; }

  var fs = require('fs'), schema, records;
  try { schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')); }
  catch (e) { eprint('contract: cannot read schema ' + JSON.stringify(schemaPath) +
                     ': ' + ((e && e.message) || 'error')); return 2; }
  try { records = recPath ? fs.readFileSync(recPath, 'utf8') : readAll(0); }
  catch (e) { eprint('contract: cannot read records: ' + ((e && e.message) || 'error')); return 2; }

  var res;
  try { res = check(records, schema, { closed: closed, label: recPath || 'stdin' }); }
  catch (e) {
    if (e && e.contract) { eprint('contract: ' + e.message); return 2; }
    throw e;
  }
  if (res.ok) return 0;
  eprint('contract: ' + (recPath || 'stdin') + ':' + res.line + ': ' +
         (res.field === null ? '' : 'field ' + JSON.stringify(res.field) + ': ') + res.reason);
  return 1;
}

/* ---- exports (browser) + CLI (Node) --------------------------------------- */
var API = { check: check, compileSchema: compileSchema, typeOf: typeOf, selftest: selftest, CEILING: CEILING };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = API;
  if (require.main === module) process.exit(main(process.argv));
} else if (typeof window !== 'undefined') {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.contract = API;
}
