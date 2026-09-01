// SPDX-License-Identifier: MIT
// switchboard — a store-and-forward message bus that cannot carry a command.
//
// PRINTED EDGE: this is a message BUS, not a command channel and not a queue with
// delivery guarantees — every message is third-party DATA (a report), never an
// instruction to the reader; a read is its own logged event, so "I sent" never
// implies "they know."
//
// WHAT IT IS. A tiny, zero-dependency store-and-forward bus over a plain directory.
// Independent workers (scripts, tabs, agents) leave messages for each other under a
// shared folder; nothing is deleted (supersede-only, the folder's history is the
// audit trail). Two things make it a COMPOSE PRIMITIVE rather than a chat log:
//
//   1. The schema is OBSERVATION-ONLY by construction. A message has exactly six
//      fields and no more — the validator REJECTS any unknown top-level field, so a
//      sender cannot smuggle an `action`/`command`/`run`/`exec` field: the schema
//      literally cannot express a command. The four message kinds are status / focus
//      / fyi / question — none imperative.
//
//   2. Every message is surfaced QUOTED — "worker <id> reports: …" — never handed to
//      the reader as its own directive. There is no code path that turns a message
//      body into an instruction. Only a human directs.
//
// This is how you wire N independent gifts (or workers) into a larger block without
// coupling them: they coordinate through DATA on a shared directory, each carrying a
// content-hash and provenance, and a read is a logged fact — not an assumption.
//
// LANE: route (data moves along declared sender→recipient paths, each carrying a
//       receipt). Point-to-point goes to one recipient's inbox; broadcast goes to
//       everyone; a read writes a receipt so orphan (never-read) messages are
//       detectable.
//
// INVOCATION (CLI):
//   node switchboard.js send   --root DIR --from ID --kind status --body "…"           (broadcast)
//   node switchboard.js send   --root DIR --from ID --to ID --kind question --body "…"  (point-to-point)
//   node switchboard.js read   --root DIR --as ID                    (surface inbox+broadcasts, quoted, logs receipts)
//   node switchboard.js orphans --root DIR --to ID                   (P2P messages ID was sent but never read)
//   node switchboard.js --help
//
// BROWSER / NODE ATTACH: the pure functions (validate, canonicalPayload, contentHash,
// renderQuoted, and an in-memory Bus) are exported for use without a filesystem — so
// the schema + quoting discipline compose into a page or a test with no disk at all.
//
// Zero dependencies. Node stdlib only (fs/path/crypto for the CLI; the pure core uses
// none). MIT. Strip provenance: the internal Switchboard tool (AGPL) — the pure schema +
// send/read/orphan path, with the git transport and the internal credential gate cut.

'use strict';

// ── The schema (the structural half of "cannot express a command") ──────────────

var SCHEMA_ID = 'loopmmt.switchboard.message/v1';

// The four observation-only kinds. There is deliberately NO imperative kind.
var KINDS = ['status', 'focus', 'fyi', 'question'];

// The CLOSED set of top-level fields. Anything else is rejected — this is why the
// schema cannot carry a command: `action`, `command`, `run`, `exec` are not in it.
var ALLOWED_TOP = ['schema', 'sender', 'content_hash', 'kind', 'recipient', 'body'];
var SENDER_FIELDS = ['session_id', 'branch', 'ts']; // provenance; session_id required

var BROADCAST = 'broadcast';

function MessageRejected(msg) {
  this.name = 'MessageRejected';
  this.message = msg;
}
MessageRejected.prototype = Object.create(Error.prototype);
MessageRejected.prototype.constructor = MessageRejected;

// ── Pure helpers (no filesystem, browser-safe) ──────────────────────────────────

function isoNow() {
  // UTC, second precision, no locale — the same clock everywhere.
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function has(obj, k) { return Object.prototype.hasOwnProperty.call(obj, k); }

// A stable JSON serialization: keys sorted at every level, compact separators.
// This is the byte-truth the content_hash covers and the file bytes we write.
function stableStringify(x) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x);
  if (Array.isArray(x)) return '[' + x.map(stableStringify).join(',') + ']';
  var keys = Object.keys(x).sort();
  var parts = [];
  for (var i = 0; i < keys.length; i++) {
    parts.push(JSON.stringify(keys[i]) + ':' + stableStringify(x[keys[i]]));
  }
  return '{' + parts.join(',') + '}';
}

// The bytes the content_hash covers: provenance + kind + recipient + body, canonically
// serialized. Hashing the sender block binds provenance INTO the hash — tampering with
// who-sent-it breaks the hash.
function canonicalPayload(sender, kind, recipient, body) {
  return stableStringify({
    body: body,
    kind: kind,
    recipient: recipient,
    sender: sender
  });
}

// A minimal, dependency-free sha-256 hex (FIPS-180-4) so contentHash works in the
// browser AND in Node without importing anything. Bytes are the UTF-8 bytes of the
// input string (multibyte-faithful), matching node crypto over the same string.
function sha256Hex(str) {
  function utf8Bytes(s) {
    var out = [], i, c, c2;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
      else if (c >= 0xd800 && c <= 0xdbff) {
        c2 = s.charCodeAt(++i);
        var u = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
        out.push(0xf0 | (u >> 18), 0x80 | ((u >> 12) & 0x3f),
                 0x80 | ((u >> 6) & 0x3f), 0x80 | (u & 0x3f));
      } else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
    }
    return out;
  }
  var K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  function rotr(n, x) { return (x >>> n) | (x << (32 - n)); }
  var bytes = utf8Bytes(str);
  var l = bytes.length, bitLen = l * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (var j = 7; j >= 0; j--) bytes.push((bitLen / Math.pow(2, j * 8)) & 0xff);
  var w = new Array(64);
  for (var off = 0; off < bytes.length; off += 64) {
    for (var t = 0; t < 16; t++) {
      w[t] = (bytes[off+4*t]<<24)|(bytes[off+4*t+1]<<16)|(bytes[off+4*t+2]<<8)|(bytes[off+4*t+3]);
    }
    for (t = 16; t < 64; t++) {
      var s0 = rotr(7,w[t-15])^rotr(18,w[t-15])^(w[t-15]>>>3);
      var s1 = rotr(17,w[t-2])^rotr(19,w[t-2])^(w[t-2]>>>10);
      w[t] = (w[t-16]+s0+w[t-7]+s1)|0;
    }
    var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
    for (t = 0; t < 64; t++) {
      var S1 = rotr(6,e)^rotr(11,e)^rotr(25,e);
      var ch = (e&f)^(~e&g);
      var t1 = (h+S1+ch+K[t]+w[t])|0;
      var S0 = rotr(2,a)^rotr(13,a)^rotr(22,a);
      var maj = (a&b)^(a&c)^(b&c);
      var t2 = (S0+maj)|0;
      h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
    }
    H[0]=(H[0]+a)|0; H[1]=(H[1]+b)|0; H[2]=(H[2]+c)|0; H[3]=(H[3]+d)|0;
    H[4]=(H[4]+e)|0; H[5]=(H[5]+f)|0; H[6]=(H[6]+g)|0; H[7]=(H[7]+h)|0;
  }
  var hex = '';
  for (var k = 0; k < 8; k++) hex += ('00000000' + (H[k]>>>0).toString(16)).slice(-8);
  return hex;
}

function contentHash(sender, kind, recipient, body) {
  return sha256Hex(canonicalPayload(sender, kind, recipient, body));
}

// Validate a candidate message. Throws MessageRejected on ANY violation — refuse loud,
// never store. This is the load-bearing gate: the closed field set is what makes the
// schema unable to express a command.
function validate(msg) {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
    throw new MessageRejected('message must be an object');
  }
  // Closed field set — reject any unknown top-level field (the command firewall).
  var keys = Object.keys(msg);
  for (var i = 0; i < keys.length; i++) {
    if (ALLOWED_TOP.indexOf(keys[i]) === -1) {
      throw new MessageRejected(
        'unknown top-level field "' + keys[i] + '" — the schema is closed; ' +
        'it cannot carry a command');
    }
  }
  for (i = 0; i < ALLOWED_TOP.length; i++) {
    if (!has(msg, ALLOWED_TOP[i])) {
      throw new MessageRejected('missing required field "' + ALLOWED_TOP[i] + '"');
    }
  }
  if (msg.schema !== SCHEMA_ID) {
    throw new MessageRejected('schema must be "' + SCHEMA_ID + '"');
  }
  if (KINDS.indexOf(msg.kind) === -1) {
    throw new MessageRejected(
      'kind must be one of ' + KINDS.join('/') + ' (no imperative kind exists)');
  }
  if (typeof msg.recipient !== 'string' || msg.recipient.length === 0) {
    throw new MessageRejected('recipient must be a non-empty string ("broadcast" or an id)');
  }
  if (typeof msg.body !== 'string') {
    throw new MessageRejected('body must be a string (data, never a directive)');
  }
  // Sender provenance
  var s = msg.sender;
  if (s === null || typeof s !== 'object' || Array.isArray(s)) {
    throw new MessageRejected('sender must be a provenance object');
  }
  if (typeof s.session_id !== 'string' || s.session_id.length === 0) {
    throw new MessageRejected('sender.session_id is required');
  }
  var skeys = Object.keys(s);
  for (i = 0; i < skeys.length; i++) {
    if (SENDER_FIELDS.indexOf(skeys[i]) === -1) {
      throw new MessageRejected('unknown sender field "' + skeys[i] + '"');
    }
  }
  // content_hash must match the payload — provenance/body tampering breaks it.
  var expect = contentHash(s, msg.kind, msg.recipient, msg.body);
  if (msg.content_hash !== expect) {
    throw new MessageRejected(
      'content_hash mismatch (message was tampered or malformed): ' +
      'expected ' + expect.slice(0, 12) + '…');
  }
  return true;
}

// Compose a valid message object (fills schema + content_hash). Throws if the result
// would not validate — you cannot build an invalid message with this.
function compose(sender, kind, recipient, body) {
  if (typeof sender === 'string') sender = { session_id: sender, ts: isoNow() };
  else if (sender && !sender.ts) sender = assign({}, sender, { ts: isoNow() });
  var msg = {
    schema: SCHEMA_ID,
    sender: sender,
    kind: kind,
    recipient: recipient,
    body: body,
    content_hash: contentHash(sender, kind, recipient, body)
  };
  validate(msg);
  return msg;
}

function assign(target) {
  for (var i = 1; i < arguments.length; i++) {
    var src = arguments[i];
    if (src) for (var k in src) if (has(src, k)) target[k] = src[k];
  }
  return target;
}

// Surface a message as QUOTED third-party data — never as an instruction to the reader.
// There is no other render path: a body cannot reach the reader as its own directive.
function renderQuoted(msg) {
  var who = msg.sender.session_id;
  var to = msg.recipient === BROADCAST ? 'all' : msg.recipient;
  return 'worker ' + who + ' reports (' + msg.kind + ' → ' + to + '): ' + msg.body;
}

// ── An in-memory Bus (no filesystem) — composes into a test or a page ───────────

function Bus() {
  this._broadcast = [];      // list of messages
  this._inbox = {};          // recipient -> list of messages
  this._reads = {};          // reader -> set of content_hash
}
Bus.prototype.send = function (sender, kind, recipient, body) {
  var msg = compose(sender, kind, recipient, body);
  if (recipient === BROADCAST) this._broadcast.push(msg);
  else (this._inbox[recipient] = this._inbox[recipient] || []).push(msg);
  return msg;
};
Bus.prototype.read = function (readerId, logReceipt) {
  var out = (this._inbox[readerId] || []).concat(this._broadcast);
  if (logReceipt !== false) {
    var set = this._reads[readerId] = this._reads[readerId] || {};
    for (var i = 0; i < out.length; i++) set[out[i].content_hash] = true;
  }
  return out;
};
Bus.prototype.orphans = function (recipientId) {
  // P2P messages this recipient was sent but never read (never sent a receipt for).
  var sent = this._inbox[recipientId] || [];
  var read = this._reads[recipientId] || {};
  var out = [];
  for (var i = 0; i < sent.length; i++) {
    if (!read[sent[i].content_hash]) out.push(sent[i]);
  }
  return out;
};

// ── Filesystem transport (CLI only; append-by-create never conflicts) ───────────
// Layout under --root:
//   <root>/broadcast/<ts>-<sender>-<hash8>.json
//   <root>/inbox/<recipient>/<ts>-<sender>-<hash8>.json
//   <root>/reads/<reader>/<ts>-<reader>-reads-<hash8>.json

function _fsLayer() {
  var fs = require('fs');
  var path = require('path');

  function safeId(id) {
    // ids in filenames must be ref/path-safe; refuse anything with a separator.
    if (!/^[A-Za-z0-9._-]+$/.test(id)) {
      throw new MessageRejected('id "' + id + '" is not path-safe (allowed: A-Za-z0-9._-)');
    }
    return id;
  }
  function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }
  function stamp() { return isoNow().replace(/[:]/g, ''); }

  function writeMessage(root, msg) {
    validate(msg);
    var hash8 = msg.content_hash.slice(0, 8);
    var name = stamp() + '-' + safeId(msg.sender.session_id) + '-' + hash8 + '.json';
    var dir;
    if (msg.recipient === BROADCAST) dir = path.join(root, 'broadcast');
    else dir = path.join(root, 'inbox', safeId(msg.recipient));
    ensureDir(dir);
    var full = path.join(dir, name);
    // append-by-create: a fresh filename per message never collides, so two writers
    // never conflict on the same file.
    fs.writeFileSync(full, stableStringify(msg) + '\n');
    return full;
  }

  function readDirMessages(dir) {
    var out = [];
    if (!fs.existsSync(dir)) return out;
    var files = fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); }).sort();
    for (var i = 0; i < files.length; i++) {
      var raw = fs.readFileSync(path.join(dir, files[i]), 'utf8');
      var msg;
      try { msg = JSON.parse(raw); } catch (e) { continue; }
      try { validate(msg); } catch (e) { continue; } // skip malformed, never trust blindly
      out.push(msg);
    }
    return out;
  }

  function logReceipt(root, readerId, hash) {
    var dir = path.join(root, 'reads', safeId(readerId));
    ensureDir(dir);
    var name = stamp() + '-' + safeId(readerId) + '-reads-' + hash.slice(0, 8) + '.json';
    fs.writeFileSync(path.join(dir, name),
      stableStringify({ reader: readerId, content_hash: hash, ts: isoNow() }) + '\n');
  }

  function readHashes(root, readerId) {
    var dir = path.join(root, 'reads', safeId(readerId));
    var set = {};
    if (!fs.existsSync(dir)) return set;
    var files = fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); });
    for (var i = 0; i < files.length; i++) {
      try {
        var r = JSON.parse(fs.readFileSync(path.join(dir, files[i]), 'utf8'));
        if (r && r.content_hash) set[r.content_hash] = true;
      } catch (e) { /* skip */ }
    }
    return set;
  }

  function read(root, readerId, logReceipts) {
    var msgs = readDirMessages(path.join(root, 'inbox', safeId(readerId)))
      .concat(readDirMessages(path.join(root, 'broadcast')));
    if (logReceipts !== false) {
      for (var i = 0; i < msgs.length; i++) logReceipt(root, readerId, msgs[i].content_hash);
    }
    return msgs;
  }

  function orphans(root, recipientId) {
    var sent = readDirMessages(path.join(root, 'inbox', safeId(recipientId)));
    var read = readHashes(root, recipientId);
    var out = [];
    for (var i = 0; i < sent.length; i++) {
      if (!read[sent[i].content_hash]) out.push(sent[i]);
    }
    return out;
  }

  return { writeMessage: writeMessage, read: read, orphans: orphans, safeId: safeId };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────

var EDGE = 'switchboard is a message BUS, not a command channel and not a guaranteed ' +
  'queue — every message is third-party DATA, never an instruction to the reader; ' +
  'a read is its own logged event, so "I sent" never implies "they know".';

function parseArgs(argv) {
  var out = { _: [] };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a.slice(0, 2) === '--') {
      var key = a.slice(2);
      if (i + 1 < argv.length && argv[i + 1].slice(0, 2) !== '--') { out[key] = argv[++i]; }
      else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

function usage() {
  return [
    'switchboard — a store-and-forward message bus that cannot carry a command.',
    '',
    'EDGE: ' + EDGE,
    '',
    'Usage:',
    '  node switchboard.js send --root DIR --from ID --kind K --body "…" [--to ID] [--branch B]',
    '  node switchboard.js read --root DIR --as ID [--no-receipt] [--json]',
    '  node switchboard.js orphans --root DIR --to ID [--json]',
    '  node switchboard.js --help',
    '',
    'Kinds: ' + KINDS.join(' / ') + '  (no imperative kind exists).',
    'Omit --to (or --to broadcast) for a broadcast; give --to ID for point-to-point.',
    'read logs a receipt per message so orphans (never-read P2P) are detectable;',
    '  --no-receipt reads without logging.'
  ].join('\n');
}

function main(argv) {
  var args = parseArgs(argv);
  var cmd = args._[0];
  if (args.help || cmd === '--help' || !cmd) { process.stdout.write(usage() + '\n'); return args.help || !cmd ? 0 : 0; }

  var fsl;
  try { fsl = _fsLayer(); } catch (e) { process.stderr.write(String(e.message || e) + '\n'); return 2; }

  try {
    if (cmd === 'send') {
      if (!args.root || !args.from || !args.kind || args.body === undefined) {
        process.stderr.write('send needs --root --from --kind --body\n'); return 2;
      }
      var sender = { session_id: args.from, ts: isoNow() };
      if (args.branch) sender.branch = args.branch;
      var recipient = (!args.to || args.to === true) ? BROADCAST : args.to;
      var msg = compose(sender, args.kind, recipient, String(args.body));
      var p = fsl.writeMessage(args.root, msg);
      process.stdout.write('sent ' + msg.content_hash.slice(0, 12) + '… → ' +
        (recipient === BROADCAST ? 'broadcast' : recipient) + '  (' + p + ')\n');
      return 0;
    }
    if (cmd === 'read') {
      if (!args.root || !args.as) { process.stderr.write('read needs --root --as\n'); return 2; }
      var msgs = fsl.read(args.root, args.as, !args['no-receipt']);
      if (args.json) { process.stdout.write(stableStringify(msgs) + '\n'); return 0; }
      if (msgs.length === 0) { process.stdout.write('(no messages for ' + args.as + ')\n'); return 0; }
      for (var i = 0; i < msgs.length; i++) process.stdout.write(renderQuoted(msgs[i]) + '\n');
      return 0;
    }
    if (cmd === 'orphans') {
      if (!args.root || !args.to) { process.stderr.write('orphans needs --root --to\n'); return 2; }
      var orph = fsl.orphans(args.root, args.to);
      if (args.json) { process.stdout.write(stableStringify(orph) + '\n'); return 0; }
      if (orph.length === 0) { process.stdout.write('(no orphans — every P2P message to ' + args.to + ' was read)\n'); return 0; }
      process.stdout.write(orph.length + ' orphan(s) — sent to ' + args.to + ' but never read:\n');
      for (var j = 0; j < orph.length; j++) process.stdout.write('  ' + renderQuoted(orph[j]) + '\n');
      return 0;
    }
    process.stderr.write('unknown command "' + cmd + '" — see --help\n');
    return 2;
  } catch (e) {
    process.stderr.write(String(e.message || e) + '\n');
    return 1;
  }
}

// ── Exports (browser attach + Node require) ─────────────────────────────────────

var api = {
  SCHEMA_ID: SCHEMA_ID,
  KINDS: KINDS,
  BROADCAST: BROADCAST,
  MessageRejected: MessageRejected,
  validate: validate,
  compose: compose,
  canonicalPayload: canonicalPayload,
  contentHash: contentHash,
  sha256Hex: sha256Hex,
  renderQuoted: renderQuoted,
  stableStringify: stableStringify,
  Bus: Bus,
  EDGE: EDGE
};

if (typeof window !== 'undefined') {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.switchboard = api;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
