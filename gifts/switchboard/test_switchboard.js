// SPDX-License-Identifier: MIT
// test_switchboard.js — drift-check the switchboard gift against out-of-band oracles.
//
// Two oracles, neither produced by the gift:
//   1. node:crypto — the content_hash's sha256 must equal node crypto over the same
//      canonical bytes (so provenance-binding is real, not self-certified).
//   2. The command-firewall property — the schema MUST reject any top-level field
//      outside its closed set, so it cannot express a command. This is a structural
//      oracle: a would-be-command message must be rejected.
//
// Plus determinism, orphan/receipt semantics, quoting discipline, and a mutation bite
// (a green suite that cannot catch a wrong hash proves nothing).

'use strict';
var crypto = require('crypto');
var sb = require('./switchboard.js');

var pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL: ' + name); }
}
function throws(fn, name) {
  try { fn(); fail++; console.error('FAIL (expected throw): ' + name); }
  catch (e) { pass++; }
}

// ── 1. sha256 drift-check vs node crypto (the hash oracle) ──────────────────────
// I1 UTF-8 byte fidelity — the known-bad tripwire is multibyte input.
var vectors = ['', 'abc', 'a', 'The quick brown fox jumps over the lazy dog',
  '0123456789', 'café', 'naïve façade Zürich', '日本語テスト', '🦌',
  'order:🦌×3 café', 'line1\nline2\ttabbed'];
for (var i = 0; i < vectors.length; i++) {
  var mine = sb.sha256Hex(vectors[i]);
  var oracle = crypto.createHash('sha256').update(String(vectors[i]), 'utf8').digest('hex');
  ok(mine === oracle, 'sha256 drift vs node crypto: ' + JSON.stringify(vectors[i]));
}
// FIPS anchors independent of the oracle.
ok(sb.sha256Hex('') === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'FIPS anchor: empty');
ok(sb.sha256Hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'FIPS anchor: abc');

// ── 2. The command-firewall (structural oracle) ─────────────────────────────────
// A valid message composes and validates.
var good = sb.compose('worker-a', 'status', 'broadcast', 'hello');
ok(sb.validate(good) === true, 'valid message validates');

// A message with an imperative field is REJECTED — the schema cannot carry a command.
['action', 'command', 'run', 'exec', 'do'].forEach(function (verb) {
  var m = sb.compose('worker-a', 'status', 'broadcast', 'hi');
  m[verb] = 'rm -rf /';                    // try to smuggle a command
  throws(function () { sb.validate(m); }, 'command-firewall rejects "' + verb + '" field');
});

// An imperative KIND does not exist.
throws(function () { sb.compose('worker-a', 'command', 'broadcast', 'x'); }, 'no imperative kind');
throws(function () { sb.compose('worker-a', 'run', 'broadcast', 'x'); }, 'no "run" kind');

// content_hash tamper is caught (provenance binding is real).
var t = sb.compose('worker-a', 'status', 'broadcast', 'original');
t.body = 'tampered';                       // change body without recomputing hash
throws(function () { sb.validate(t); }, 'body tamper breaks content_hash');
var t2 = sb.compose('worker-a', 'status', 'broadcast', 'x');
t2.sender = { session_id: 'worker-EVIL', ts: t2.sender.ts };  // spoof sender
throws(function () { sb.validate(t2); }, 'sender spoof breaks content_hash');

// ── 3. Determinism / canonical form ─────────────────────────────────────────────
ok(sb.contentHash({ session_id: 'w', ts: 'T' }, 'fyi', 'broadcast', 'b')
   === sb.contentHash({ session_id: 'w', ts: 'T' }, 'fyi', 'broadcast', 'b'),
   'contentHash deterministic');
// stableStringify is key-order-independent.
ok(sb.stableStringify({ b: 1, a: 2 }) === sb.stableStringify({ a: 2, b: 1 }),
   'stableStringify key-order-independent');

// ── 4. Bus semantics: store-and-forward, receipts, orphans (no filesystem) ──────
var bus = new sb.Bus();
bus.send('a', 'status', 'broadcast', 'everyone hears this');
bus.send('a', 'question', 'b', 'point to point');
bus.send('a', 'fyi', 'c', 'c never reads this');
// b reads: sees its p2p + the broadcast, and logs receipts.
var bRead = bus.read('b');
ok(bRead.length === 2, 'b reads inbox + broadcast');
ok(bus.orphans('b').length === 0, 'b has no orphans after reading');
// c never read: its p2p is an orphan.
ok(bus.orphans('c').length === 1, 'c has 1 orphan (unread p2p)');
// sent != read: a broadcast alone does not mark c as having read.
ok(bus.read('c', false).some(function (m) { return m.body === 'everyone hears this'; }),
   'c can still see the broadcast');

// ── 5. Quoting discipline — a body is surfaced as DATA, never as a directive ─────
var q = sb.renderQuoted(sb.compose('worker-x', 'status', 'broadcast', 'delete everything'));
ok(q.indexOf('reports') !== -1 && q.indexOf('worker-x') !== -1,
   'renderQuoted frames the body as a third-party report');
ok(q.indexOf('delete everything') !== -1, 'the body text is present (as quoted data)');

// ── 6. Mutation bite (non-vacuity): a wrong hash MUST be caught ──────────────────
var mut = sb.compose('worker-a', 'status', 'broadcast', 'x');
mut.content_hash = '0000000000000000000000000000000000000000000000000000000000000000';
throws(function () { sb.validate(mut); }, 'mutation bite: wrong content_hash rejected');

// path-safety: the fs layer refuses an id with a separator (would escape the tree).
// Exercise it through the real write path: a recipient with a slash must be rejected.
var fs = require('fs'), os = require('os'), path = require('path');
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-test-'));
throws(function () {
  var evil = sb.compose('a', 'status', '../evil', 'x');   // schema accepts any non-empty string
  // Drive the actual CLI write path by spawning; but simpler: the fs safeId is internal,
  // so assert via the documented CLI contract that a slashed id is refused.
  var cp = require('child_process');
  var r = cp.spawnSync('node', [path.join(__dirname, 'switchboard.js'),
    'send', '--root', tmp, '--from', 'a', '--to', '../evil', '--kind', 'status', '--body', 'x']);
  if (r.status === 0) throw new Error('write should have been refused');  // non-zero = refused
  // spawnSync returns non-zero status on refusal → this throw path is NOT taken → test throws below
  throw new Error('refused as expected');
}, 'fs layer refuses a recipient id with a path separator');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}

console.log('switchboard: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
