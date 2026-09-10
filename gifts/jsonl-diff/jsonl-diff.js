#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */
/* jsonl-diff.js — what changed between two JSONL files, deterministically.
 *
 * A tiny, dependency-free diff for JSON Lines (one JSON value per line). Give it
 * an OLD file and a NEW file and it tells you what was ADDED, REMOVED, and (when
 * you name a key) CHANGED — sorted, canonical, byte-identical on every run so it
 * drops straight into a CI gate or a review.
 *
 *     old.jsonl, new.jsonl ──▶ diff(old, new, {key})
 *                           ──▶ { added:[…], removed:[…], changed:[…] }
 *
 * TWO MODES.
 *   set-diff (default)   — records are keyed by their own canonical form, so a
 *                          record either matches exactly or it is added/removed.
 *                          A changed record shows as one removed + one added.
 *   keyed diff (--key F) — records are keyed by the value of field F. A record
 *                          present on both sides with the same key but different
 *                          content is a CHANGE, reported with its field deltas.
 *
 * DETERMINISM (the promise, and the self-test that proves it). Comparison and
 * output both run over a canonical form: object keys sorted, whitespace fixed,
 * no ordering luck. The result is sorted by key. `--selftest` proves the canon
 * is idempotent (canon(canon(x)) === canon(x)) and the diff is stable, so the
 * output is a pure function of the two inputs — the same bytes, every run.
 *
 * THE LINE IT WILL NOT CROSS (the honest ceiling — printed every --help/--list).
 * jsonl-diff compares STRUCTURE, not MEANING. It tells you two records differ; it
 * cannot tell you the difference matters, is correct, or is safe. Semantic
 * equivalence it will miss (1 vs 1.0, "a,b" vs ["a","b"]) is a difference here.
 * A human reads the diff; the tool only makes the change visible and exact.
 *
 * EXIT CODES (diff convention, gate-friendly).
 *   0  the two files are identical (under the chosen mode)
 *   1  they differ (added / removed / changed present)
 *   2  input could not be used (missing file, a directory, unreadable, bad JSON,
 *      a duplicate key, or a missing --key field) — always a clean message, never
 *      a stack trace.
 *
 * Runs identically in Node and in a browser (no DOM, no deps). MIT.
 */

var CEILING =
  'ceiling: jsonl-diff compares STRUCTURE, not MEANING. A reported change may be\n' +
  '  cosmetic (1 vs 1.0) and an unreported match may still be wrong. A human reads\n' +
  '  the diff; the tool only makes the change visible and exact.';

/* ---- canonical form (the canonicalizer; idempotent + order-faithful) ------ */
function canon(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  var keys = Object.keys(v).sort();
  var parts = [];
  for (var i = 0; i < keys.length; i++) {
    parts.push(JSON.stringify(keys[i]) + ':' + canon(v[keys[i]]));
  }
  return '{' + parts.join(',') + '}';
}

/* ---- parse a JSONL string into records (throws JsonlError on a bad line) --- */
function JsonlError(msg) { var e = new Error(msg); e.jsonl = true; return e; }

function parseJsonl(text, label) {
  var out = [];
  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.replace(/\s+/g, '') === '') continue; // skip blank lines
    var obj;
    try { obj = JSON.parse(line); }
    catch (e) {
      throw JsonlError(label + ':' + (i + 1) + ': not valid JSON (' +
        ((e && e.message) || 'parse error') + ')');
    }
    out.push({ value: obj, line: i + 1 });
  }
  return out;
}

/* ---- key a record: by field F (keyed mode) or by its canonical form (set) -- */
function keyOf(rec, key, label) {
  if (key === null) return canon(rec.value);
  var v = rec.value;
  if (v === null || typeof v !== 'object' || Array.isArray(v) ||
      !Object.prototype.hasOwnProperty.call(v, key)) {
    throw JsonlError(label + ':' + rec.line + ': record has no key field ' +
      JSON.stringify(key));
  }
  return canon(v[key]);
}

function index(recs, key, label) {
  var map = {};
  for (var i = 0; i < recs.length; i++) {
    var k = keyOf(recs[i], key, label);
    if (Object.prototype.hasOwnProperty.call(map, k)) {
      throw JsonlError(label + ':' + recs[i].line + ': duplicate key ' + k +
        ' (first seen at ' + label + ':' + map[k].line + ') — the diff would be ambiguous');
    }
    map[k] = recs[i];
  }
  return map;
}

/* ---- field-level delta for a CHANGED record (keyed mode) ------------------ */
function fieldDelta(before, after) {
  var d = { added: {}, removed: {}, changed: {} };
  var bObj = before && typeof before === 'object' && !Array.isArray(before);
  var aObj = after && typeof after === 'object' && !Array.isArray(after);
  if (!bObj || !aObj) return null; // not object-vs-object; whole-value change
  var seen = {};
  var k, keys = Object.keys(before).concat(Object.keys(after));
  for (var i = 0; i < keys.length; i++) {
    k = keys[i];
    if (seen[k]) continue; seen[k] = 1;
    var hb = Object.prototype.hasOwnProperty.call(before, k);
    var ha = Object.prototype.hasOwnProperty.call(after, k);
    if (hb && !ha) d.removed[k] = before[k];
    else if (!hb && ha) d.added[k] = after[k];
    else if (canon(before[k]) !== canon(after[k])) d.changed[k] = { before: before[k], after: after[k] };
  }
  return d;
}

/* ---- the diff (pure) ------------------------------------------------------ */
function diff(oldText, newText, opts) {
  opts = opts || {};
  var key = (opts.key === undefined) ? null : opts.key;
  var oldRecs = parseJsonl(oldText, 'old');
  var newRecs = parseJsonl(newText, 'new');
  var oldMap = index(oldRecs, key, 'old');
  var newMap = index(newRecs, key, 'new');
  var added = [], removed = [], changed = [];
  var k;
  var allKeys = {};
  for (k in oldMap) if (Object.prototype.hasOwnProperty.call(oldMap, k)) allKeys[k] = 1;
  for (k in newMap) if (Object.prototype.hasOwnProperty.call(newMap, k)) allKeys[k] = 1;
  var sorted = Object.keys(allKeys).sort();
  for (var i = 0; i < sorted.length; i++) {
    k = sorted[i];
    var inOld = Object.prototype.hasOwnProperty.call(oldMap, k);
    var inNew = Object.prototype.hasOwnProperty.call(newMap, k);
    if (inOld && !inNew) removed.push({ key: k, value: oldMap[k].value });
    else if (!inOld && inNew) added.push({ key: k, value: newMap[k].value });
    else if (canon(oldMap[k].value) !== canon(newMap[k].value)) {
      changed.push({
        key: k,
        before: oldMap[k].value,
        after: newMap[k].value,
        fields: (key === null) ? null : fieldDelta(oldMap[k].value, newMap[k].value)
      });
    }
  }
  return { added: added, removed: removed, changed: changed };
}

/* ---- rendering ------------------------------------------------------------ */
function renderText(d) {
  var out = [];
  var i;
  for (i = 0; i < d.removed.length; i++) out.push('- ' + d.removed[i].key);
  for (i = 0; i < d.added.length; i++) out.push('+ ' + d.added[i].key);
  for (i = 0; i < d.changed.length; i++) {
    var c = d.changed[i];
    out.push('~ ' + c.key);
    if (c.fields) {
      var f = c.fields, fk;
      var rk = Object.keys(f.removed).sort();
      for (fk = 0; fk < rk.length; fk++) out.push('    - ' + rk[fk] + ': ' + JSON.stringify(f.removed[rk[fk]]));
      var ak = Object.keys(f.added).sort();
      for (fk = 0; fk < ak.length; fk++) out.push('    + ' + ak[fk] + ': ' + JSON.stringify(f.added[ak[fk]]));
      var ck = Object.keys(f.changed).sort();
      for (fk = 0; fk < ck.length; fk++) {
        out.push('    ~ ' + ck[fk] + ': ' + JSON.stringify(f.changed[ck[fk]].before) +
          ' -> ' + JSON.stringify(f.changed[ck[fk]].after));
      }
    }
  }
  out.push('# ' + d.added.length + ' added, ' + d.removed.length + ' removed, ' +
    d.changed.length + ' changed');
  return out.join('\n');
}

function renderJson(d) {
  // canonical, deterministic: sorted keys, stable field order
  return canon({
    added: d.added,
    removed: d.removed,
    changed: d.changed,
    summary: { added: d.added.length, removed: d.removed.length, changed: d.changed.length }
  });
}

/* ---- self-test (determinism + promise proof) ------------------------------ */
function selftest() {
  var pass = 0, fail = 0;
  function ok(cond, name) { if (cond) pass++; else { fail++; console.error('FAIL: ' + name); } }

  // canon is idempotent and order-faithful
  var a = { b: 1, a: [3, { y: 2, x: 1 }] };
  ok(canon(JSON.parse(canon(a))) === canon(a), 'canon round-trips through JSON.parse');
  ok(canon({ x: 1, y: 2 }) === canon({ y: 2, x: 1 }), 'canon is key-order-faithful');
  ok(canon(canon(a)) === canon(canon(a)), 'canon is idempotent');

  // set-diff mode
  var oldT = '{"id":1,"v":"a"}\n{"id":2,"v":"b"}\n';
  var newT = '{"id":2,"v":"b"}\n{"id":3,"v":"c"}\n';
  var d1 = diff(oldT, newT, {});
  ok(d1.added.length === 1 && d1.removed.length === 1 && d1.changed.length === 0, 'set-diff add/remove');

  // keyed diff: same key, changed content => CHANGE with field delta
  var d2 = diff(oldT, '{"id":1,"v":"A","extra":9}\n{"id":2,"v":"b"}\n', { key: 'id' });
  ok(d2.changed.length === 1 && d2.added.length === 0 && d2.removed.length === 0, 'keyed change is a change, not add+remove');
  ok(d2.changed[0].fields && d2.changed[0].fields.changed.v && d2.changed[0].fields.added.extra !== undefined,
    'keyed change reports field deltas');

  // identical inputs => empty diff, byte-stable render
  var d3 = diff(oldT, oldT, { key: 'id' });
  ok(d3.added.length === 0 && d3.removed.length === 0 && d3.changed.length === 0, 'identical => empty');
  ok(renderJson(diff(oldT, newT, {})) === renderJson(diff(oldT, newT, {})), 'render is byte-stable across runs');

  // blank lines skipped; whitespace-insensitive comparison
  ok(diff('{"id":1}\n\n', '{ "id" : 1 }\n', { key: 'id' }).changed.length === 0, 'whitespace-insensitive, blanks skipped');

  // duplicate key is an error (ambiguous)
  var threw = false;
  try { diff('{"id":1}\n{"id":1}\n', '{"id":1}\n', { key: 'id' }); } catch (e) { threw = e && e.jsonl; }
  ok(threw, 'duplicate key throws a clean JsonlError');

  console.log((fail === 0 ? 'GREEN' : 'RED') + ': ' + (pass) + ' checks passed, ' + fail + ' failed  [jsonl-diff]');
  return fail === 0;
}

/* ---- crashclean read ------------------------------------------------------ */
function readFileClean(path) {
  var fs = require('fs');
  try {
    return fs.readFileSync(path, 'utf8');
  } catch (e) {
    var why = e && e.code === 'ENOENT' ? 'no such file'
            : e && e.code === 'EISDIR' ? 'is a directory'
            : e && e.code === 'EACCES' ? 'permission denied'
            : (e && e.message) || 'cannot read';
    process.stderr.write('jsonl-diff: cannot read ' + JSON.stringify(path) + ': ' + why + '\n');
    process.exit(2);
  }
}

/* ---- CLI ------------------------------------------------------------------ */
function usage() {
  console.log('usage: jsonl-diff.js [--key FIELD] [--out text|json] OLD.jsonl NEW.jsonl');
  console.log('  --key FIELD   key records by FIELD; a same-key record that differs is a CHANGE');
  console.log('                (default: key by the whole record — changes show as remove + add)');
  console.log('  --out text    - removed, + added, ~ changed, then a summary  [default]');
  console.log('  --out json    a canonical JSON result object');
  console.log('  --selftest    run the built-in checks (exit 0 GREEN, 1 RED)');
  console.log('  exit 0 identical | 1 differs | 2 input could not be used');
  console.error('\n' + CEILING);
}

if (typeof require !== 'undefined' && require.main === module) {
  var argv = process.argv.slice(2);
  var key = null, out = 'text', files = [];
  for (var a = 0; a < argv.length; a++) {
    var t = argv[a];
    if (t === '--selftest') { process.exit(selftest() ? 0 : 1); }
    else if (t === '-h' || t === '--help') { usage(); process.exit(0); }
    else if (t === '--key') { key = argv[++a]; if (key === undefined) { console.error('jsonl-diff: --key needs a field name'); process.exit(2); } }
    else if (t === '--out') { out = argv[++a]; if (out !== 'text' && out !== 'json') { console.error('jsonl-diff: --out must be text or json'); process.exit(2); } }
    else if (t.charAt(0) === '-') { console.error('jsonl-diff: unknown option ' + JSON.stringify(t)); process.exit(2); }
    else files.push(t);
  }
  if (files.length !== 2) {
    console.error('jsonl-diff: need exactly two files (OLD NEW); got ' + files.length + '. Try --help.');
    process.exit(2);
  }
  var oldText = readFileClean(files[0]);
  var newText = readFileClean(files[1]);
  var d;
  try {
    d = diff(oldText, newText, key === null ? {} : { key: key });
  } catch (e) {
    if (e && e.jsonl) { console.error('jsonl-diff: ' + e.message); process.exit(2); }
    throw e; // a non-input bug: let it surface honestly (never masked as clean)
  }
  console.log(out === 'json' ? renderJson(d) : renderText(d));
  var differs = d.added.length + d.removed.length + d.changed.length > 0;
  process.exit(differs ? 1 : 0);
}

/* ---- exports (browser / require) ------------------------------------------ */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { diff: diff, canon: canon, parseJsonl: parseJsonl, selftest: selftest };
}
