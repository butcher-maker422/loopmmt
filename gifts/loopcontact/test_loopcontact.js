/* SPDX-License-Identifier: MIT */
'use strict';

// Loop Contact — test suite. Per AGENTS-contact.md Build #29 Phase 1 (~250 lines).
// Uses node:test + node:assert, no external deps.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

const contact = require('./loopcontact');

// Helper: a fresh in-process database in a temp directory.
function freshDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-contact-test-'));
  const databasePath = path.join(directory, 'contact.db');
  const database = contact.openDatabase(databasePath);
  contact.ensureGenesisEntry(database);
  return { database, databasePath, directory };
}

function cleanup(databaseHandle) {
  try { databaseHandle.database.close(); } catch (_e) { /* fine */ }
  try { fs.rmSync(databaseHandle.directory, { recursive: true, force: true }); }
  catch (_e) { /* fine */ }
}

const runtimeState = { quiet: true };

test('content hash is stable across calls with equal inputs', () => {
  const hashA = contact.computeContentHash('Marco Reyes',
    'Marco@Example.com ', '(207) 555-1234');
  const hashB = contact.computeContentHash('  marco reyes',
    'marco@example.com', '2075551234');
  assert.equal(hashA, hashB);
});

test('levenshtein distance edge cases', () => {
  assert.equal(contact.levenshteinDistance('abc', 'abc'), 0);
  assert.equal(contact.levenshteinDistance('', 'abc'), 3);
  assert.equal(contact.levenshteinDistance('Marco', 'Margo'), 1);
  assert.equal(contact.levenshteinDistance('Marco Reyes', 'Marco Reyas'), 1);
});

test('edge id is idempotent across calls', () => {
  const idA = contact.computeEdgeId('contact:a', 'contact:b', 'knows');
  const idB = contact.computeEdgeId('contact:a', 'contact:b', 'knows');
  const idC = contact.computeEdgeId('contact:b', 'contact:a', 'knows');
  assert.equal(idA, idB);
  assert.notEqual(idA, idC);
});

test('create + read contact roundtrips fields, hash, graph node, proof chain', () => {
  const handle = freshDatabase();
  try {
    const created = contact.createContact(handle.database, runtimeState, {
      displayName: 'Marco Reyes',
      email: 'marco@example.com',
      phone: '2075551234',
      organization: "Marco's Custom Meats",
    });
    assert.ok(created.id);
    assert.equal(created.display_name, 'Marco Reyes');
    assert.equal(created.primary_email, 'marco@example.com');
    assert.ok(created.content_hash);
    const fetched = contact.getContact(handle.database, created.id);
    assert.equal(fetched.id, created.id);
    // Graph node was emitted.
    const node = handle.database.prepare(
      'SELECT * FROM graph_nodes WHERE id = ?'
    ).get(`contact:${created.id}`);
    assert.ok(node);
    assert.equal(node.type, 'person');
    // Proof chain entry was written.
    const events = handle.database.prepare(
      `SELECT event_type FROM proof_chain ORDER BY rowid`
    ).all().map((r) => r.event_type);
    assert.ok(events.includes('contact.created'));
  } finally { cleanup(handle); }
});

test('update contact recomputes content hash and logs changed fields', () => {
  const handle = freshDatabase();
  try {
    const c = contact.createContact(handle.database, runtimeState,
      { displayName: 'Original Name' });
    const result = contact.updateContact(handle.database, runtimeState, c.id,
      { displayName: 'New Name', email: 'new@example.com' });
    assert.equal(result.updated, true);
    assert.equal(result.contact.display_name, 'New Name');
    assert.equal(result.contact.primary_email, 'new@example.com');
    assert.notEqual(result.contact.content_hash, c.content_hash);
    const lastEntry = handle.database.prepare(
      `SELECT detail FROM proof_chain WHERE event_type = 'contact.updated'
       ORDER BY rowid DESC LIMIT 1`
    ).get();
    const detail = JSON.parse(lastEntry.detail);
    assert.ok(detail.changed_fields.includes('display_name'));
  } finally { cleanup(handle); }
});

test('soft delete excludes from default listing; --all includes it', () => {
  const handle = freshDatabase();
  try {
    const a = contact.createContact(handle.database, runtimeState,
      { displayName: 'Alice' });
    const b = contact.createContact(handle.database, runtimeState,
      { displayName: 'Bob' });
    contact.deleteContact(handle.database, runtimeState, a.id, {});
    const active = contact.listContacts(handle.database, {});
    assert.equal(active.length, 1);
    assert.equal(active[0].id, b.id);
    const all = contact.listContacts(handle.database, { includeAll: true });
    assert.equal(all.length, 2);
  } finally { cleanup(handle); }
});

test('purge requires --confirm and cascades to multi-value tables', () => {
  const handle = freshDatabase();
  try {
    const c = contact.createContact(handle.database, runtimeState,
      { displayName: 'Doomed', email: 'd@x' });
    contact.addEmail(handle.database, runtimeState, c.id, 'extra@x', 'work', false);
    const refuse = contact.deleteContact(handle.database, runtimeState, c.id,
      { purge: true });
    assert.ok(refuse.error);
    const ok = contact.deleteContact(handle.database, runtimeState, c.id,
      { purge: true, confirm: true });
    assert.equal(ok.purged, true);
    const remaining = handle.database.prepare(
      'SELECT * FROM contact_emails WHERE contact_id = ?'
    ).all(c.id);
    assert.equal(remaining.length, 0);
  } finally { cleanup(handle); }
});

test('multi-value emails: primary promotion demotes others', () => {
  const handle = freshDatabase();
  try {
    const c = contact.createContact(handle.database, runtimeState,
      { displayName: 'Multi Email' });
    contact.addEmail(handle.database, runtimeState, c.id, 'a@x', 'personal', true);
    contact.addEmail(handle.database, runtimeState, c.id, 'b@x', 'work', true);
    const fetched = contact.getContact(handle.database, c.id);
    const primaries = fetched.emails.filter((email) => email.is_primary === 1);
    assert.equal(primaries.length, 1);
    assert.equal(primaries[0].email, 'b@x');
    assert.equal(fetched.primary_email, 'b@x');
  } finally { cleanup(handle); }
});

test('addresses preserve all six structured parts', () => {
  const handle = freshDatabase();
  try {
    const c = contact.createContact(handle.database, runtimeState,
      { displayName: 'Address Person' });
    contact.addAddress(handle.database, runtimeState, c.id, {
      street: '123 Main', city: 'Portland', state: 'ME',
      postalCode: '04103', country: 'US', isPrimary: true,
    });
    const fetched = contact.getContact(handle.database, c.id);
    assert.equal(fetched.addresses.length, 1);
    assert.equal(fetched.addresses[0].city, 'Portland');
    assert.equal(fetched.addresses[0].postal_code, '04103');
  } finally { cleanup(handle); }
});

test('custom fields: set, list, remove', () => {
  const handle = freshDatabase();
  try {
    const c = contact.createContact(handle.database, runtimeState,
      { displayName: 'Butcher Customer' });
    contact.setField(handle.database, runtimeState, c.id,
      'preferred_cuts', 'ribeye, brisket');
    contact.setField(handle.database, runtimeState, c.id,
      'preferred_cuts', 'ribeye, brisket, flank');
    const fetched = contact.getContact(handle.database, c.id);
    assert.equal(fetched.fields.length, 1);
    assert.equal(fetched.fields[0].field_value, 'ribeye, brisket, flank');
    contact.removeField(handle.database, runtimeState, c.id, 'preferred_cuts');
    const after = contact.getContact(handle.database, c.id);
    assert.equal(after.fields.length, 0);
  } finally { cleanup(handle); }
});

test('full-text search returns relevant matches', () => {
  const handle = freshDatabase();
  try {
    contact.createContact(handle.database, runtimeState,
      { displayName: 'Marco Reyes', organization: 'Custom Meats' });
    contact.createContact(handle.database, runtimeState,
      { displayName: 'Nancy Drew', organization: 'Detectives Inc' });
    const result = contact.searchContacts(handle.database, 'marco');
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].display_name, 'Marco Reyes');
    const empty = contact.searchContacts(handle.database, '');
    assert.ok(empty.error);
  } finally { cleanup(handle); }
});

test('vCard parse handles single block with EMAIL TEL ADR ORG', () => {
  const block = [
    'BEGIN:VCARD',
    'VERSION:4.0',
    'FN:Marco Reyes',
    'N:Reyes;Marco;;;',
    'ORG:Marco\'s Custom Meats',
    'TITLE:Owner',
    'EMAIL;TYPE=work:marco@example.com',
    'TEL;TYPE=mobile:2075551234',
    'ADR;TYPE=home:;;123 Main;Portland;ME;04103;US',
    'NOTE:loves brisket',
    'END:VCARD',
  ].join('\r\n');
  const blocks = contact.splitVCardBlocks(block);
  assert.equal(blocks.length, 1);
  const parsed = contact.parseVCardBlock(blocks[0]);
  assert.equal(parsed.displayName, 'Marco Reyes');
  assert.equal(parsed.familyName, 'Reyes');
  assert.equal(parsed.givenName, 'Marco');
  assert.equal(parsed.emails.length, 1);
  assert.equal(parsed.emails[0].email, 'marco@example.com');
  assert.equal(parsed.phones[0].phone, '2075551234');
  assert.equal(parsed.addresses[0].city, 'Portland');
  assert.equal(parsed.notes, 'loves brisket');
});

test('vCard multi-block import creates multiple contacts', () => {
  const handle = freshDatabase();
  try {
    const text = [
      'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Alice\r\nEMAIL:alice@x\r\nEND:VCARD',
      'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Bob\r\nEMAIL:bob@x\r\nEND:VCARD',
    ].join('\r\n');
    const result = contact.importVCardText(handle.database, runtimeState, text);
    assert.equal(result.imported, 2);
    const all = contact.listContacts(handle.database, {});
    assert.equal(all.length, 2);
  } finally { cleanup(handle); }
});

test('vCard export produces valid RFC 6350 framing', () => {
  const handle = freshDatabase();
  try {
    contact.createContact(handle.database, runtimeState, {
      displayName: 'Marco Reyes', email: 'marco@example.com',
      phone: '2075551234', organization: "Marco's Custom Meats",
    });
    const exported = contact.exportContactsToVCard(handle.database, {});
    assert.ok(exported.includes('BEGIN:VCARD'));
    assert.ok(exported.includes('VERSION:4.0'));
    assert.ok(exported.includes('FN:Marco Reyes'));
    assert.ok(exported.includes('END:VCARD'));
  } finally { cleanup(handle); }
});

test('vCard round-trip: import → export is semantically equivalent', () => {
  const handle = freshDatabase();
  try {
    const sourceVcard = [
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:Round Trip',
      'EMAIL:roundtrip@example.com',
      'TEL:5555555555',
      'END:VCARD',
    ].join('\r\n');
    contact.importVCardText(handle.database, runtimeState, sourceVcard);
    const exported = contact.exportContactsToVCard(handle.database, {});
    assert.ok(exported.includes('FN:Round Trip'));
    assert.ok(exported.includes('roundtrip@example.com'));
    assert.ok(exported.includes('5555555555'));
  } finally { cleanup(handle); }
});

test('suggest-merges flags identical content hash', () => {
  const handle = freshDatabase();
  try {
    contact.createContact(handle.database, runtimeState,
      { displayName: 'Marco', email: 'marco@x', phone: '5551111' });
    contact.createContact(handle.database, runtimeState,
      { displayName: 'marco', email: 'MARCO@X', phone: '555-1111' });
    const candidates = contact.suggestMerges(handle.database);
    assert.ok(candidates.length >= 1);
    assert.ok(candidates[0].reasons.includes('content_hash'));
  } finally { cleanup(handle); }
});

test('suggest-merges fuzzy name match Levenshtein ≤ 2', () => {
  const handle = freshDatabase();
  try {
    contact.createContact(handle.database, runtimeState,
      { displayName: 'Marco Reyes' });
    contact.createContact(handle.database, runtimeState,
      { displayName: 'Marco Reyas' });
    const candidates = contact.suggestMerges(handle.database);
    const reasons = candidates.flatMap((candidate) => candidate.reasons);
    assert.ok(reasons.includes('fuzzy_name'));
  } finally { cleanup(handle); }
});

test('merge sets status=merged, transfers entity links and edges', () => {
  const handle = freshDatabase();
  try {
    const a = contact.createContact(handle.database, runtimeState,
      { displayName: 'Marco Reyes', email: 'marco@x' });
    const b = contact.createContact(handle.database, runtimeState,
      { displayName: 'Marco Reyes', phone: '5551111', organization: 'Meats' });
    contact.createEntityLink(handle.database, runtimeState, b.id,
      'loop-lens:people:abc', 'confirmed');
    const result = contact.mergeContacts(handle.database, runtimeState,
      a.id, b.id, {});
    assert.equal(result.merged, true);
    const mergedRow = contact.getContactRow(handle.database, result.merged_id);
    assert.equal(mergedRow.status, 'merged');
    assert.equal(mergedRow.merged_into, result.survivor_id);
    const survivorLinks = handle.database.prepare(
      'SELECT * FROM entity_links WHERE contact_id = ?'
    ).all(result.survivor_id);
    assert.equal(survivorLinks.length, 1);
    // Merge history row was written.
    const history = handle.database.prepare(
      'SELECT * FROM merge_history WHERE survivor_id = ? AND merged_id = ?'
    ).all(result.survivor_id, result.merged_id);
    assert.equal(history.length, 1);
  } finally { cleanup(handle); }
});

test('merge: explicit survivor wins', () => {
  const handle = freshDatabase();
  try {
    const a = contact.createContact(handle.database, runtimeState,
      { displayName: 'A', email: 'a@x', notes: 'lots of notes' });
    const b = contact.createContact(handle.database, runtimeState,
      { displayName: 'B' });
    const result = contact.mergeContacts(handle.database, runtimeState,
      a.id, b.id, { survivorId: b.id });
    assert.equal(result.survivor_id, b.id);
    assert.equal(result.merged_id, a.id);
  } finally { cleanup(handle); }
});

test('relationship link creates two edges by default, one with --one-way', () => {
  const handle = freshDatabase();
  try {
    const a = contact.createContact(handle.database, runtimeState,
      { displayName: 'A' });
    const b = contact.createContact(handle.database, runtimeState,
      { displayName: 'B' });
    contact.linkContacts(handle.database, runtimeState, a.id, b.id, 'knows', {});
    const bidirectional = handle.database.prepare(
      `SELECT COUNT(*) AS c FROM graph_edges
       WHERE relationship = 'knows'
       AND (source_id IN (?, ?) OR target_id IN (?, ?))`
    ).get(`contact:${a.id}`, `contact:${b.id}`,
      `contact:${a.id}`, `contact:${b.id}`).c;
    assert.equal(bidirectional, 2);
    contact.unlinkContacts(handle.database, runtimeState, a.id, b.id, 'knows', {});
    contact.linkContacts(handle.database, runtimeState, a.id, b.id,
      'parent_of', { oneWay: true });
    const oneWay = handle.database.prepare(
      `SELECT COUNT(*) AS c FROM graph_edges WHERE relationship = 'parent_of'`
    ).get().c;
    assert.equal(oneWay, 1);
  } finally { cleanup(handle); }
});

test('entity link create/remove writes proof chain and graph edge', () => {
  const handle = freshDatabase();
  try {
    const c = contact.createContact(handle.database, runtimeState,
      { displayName: 'Linked' });
    const created = contact.createEntityLink(handle.database, runtimeState, c.id,
      'loop-lens:people:abc123', 'confirmed');
    assert.ok(created.id);
    const edge = handle.database.prepare(
      `SELECT * FROM graph_edges WHERE source_id = ? AND relationship = 'entity_link'`
    ).get(`contact:${c.id}`);
    assert.ok(edge);
    contact.removeEntityLink(handle.database, runtimeState, c.id, created.id);
    const remaining = handle.database.prepare(
      'SELECT COUNT(*) AS c FROM entity_links WHERE contact_id = ?'
    ).get(c.id).c;
    assert.equal(remaining, 0);
  } finally { cleanup(handle); }
});

test('deceased contact graph node has suppress_from_ambient=1', () => {
  const handle = freshDatabase();
  try {
    const c = contact.createContact(handle.database, runtimeState,
      { displayName: 'In Memoriam', status: 'deceased' });
    const node = handle.database.prepare(
      'SELECT * FROM graph_nodes WHERE id = ?'
    ).get(`contact:${c.id}`);
    assert.equal(node.suppress_from_ambient, 1);
  } finally { cleanup(handle); }
});

test('proof chain is append-only (delete + update rejected)', () => {
  const handle = freshDatabase();
  try {
    assert.throws(() =>
      handle.database.prepare('DELETE FROM proof_chain').run());
    assert.throws(() =>
      handle.database.prepare(
        'UPDATE proof_chain SET event_type = \'x\''
      ).run());
  } finally { cleanup(handle); }
});

test('verify proof chain returns valid for a clean chain', () => {
  const handle = freshDatabase();
  try {
    contact.createContact(handle.database, runtimeState, { displayName: 'A' });
    contact.createContact(handle.database, runtimeState, { displayName: 'B' });
    const result = contact.verifyProofChain(handle.database);
    assert.equal(result.valid, true);
    assert.ok(result.entries_checked >= 3);
  } finally { cleanup(handle); }
});

test('foreign-DB integrity probe rejects truly missing tables gracefully', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-contact-foreign-'));
  try {
    const garbagePath = path.join(directory, 'not-a-real.db');
    const result = contact.openForeignDatabaseReadOnly(garbagePath);
    assert.ok(result.error);
    assert.equal(result.database, null);
  } finally {
    try { fs.rmSync(directory, { recursive: true, force: true }); }
    catch (_e) { /* fine */ }
  }
});

test('cross-tool discovery returns candidates from a mock Lens DB', () => {
  const handle = freshDatabase();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-contact-discover-'));
  try {
    const fakeLensPath = path.join(directory, 'lens.db');
    const lensDb = new DatabaseSync(fakeLensPath);
    lensDb.exec(`
      CREATE TABLE people (id TEXT PRIMARY KEY, name TEXT);
      INSERT INTO people VALUES ('p1', 'Marco'), ('p2', 'Alice');
    `);
    lensDb.close();
    const toolEntry = { name: 'loop-lens', database_path: fakeLensPath };
    const report = contact.discoverForeignPeople(handle.database, toolEntry);
    assert.equal(report.tool, 'loop-lens');
    assert.equal(report.error, null);
    assert.equal(report.candidates.length, 2);
    assert.ok(report.candidates.some((cand) => cand.display_name === 'Marco'));
  } finally {
    cleanup(handle);
    try { fs.rmSync(directory, { recursive: true, force: true }); }
    catch (_e) { /* fine */ }
  }
});

test('cross-tool discovery falls back to graph_nodes type=person for unknown tools', () => {
  const handle = freshDatabase();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-contact-unknown-'));
  try {
    const unknownPath = path.join(directory, 'unknown.db');
    const unknownDb = new DatabaseSync(unknownPath);
    unknownDb.exec(`
      CREATE TABLE graph_nodes (id TEXT, type TEXT, metadata TEXT);
      INSERT INTO graph_nodes VALUES
        ('x:1', 'person', '{"display_name":"Generic Person"}');
    `);
    unknownDb.close();
    const toolEntry = { name: 'loop-mystery', database_path: unknownPath };
    const report = contact.discoverForeignPeople(handle.database, toolEntry);
    assert.equal(report.candidates.length, 1);
    assert.equal(report.candidates[0].display_name, 'Generic Person');
  } finally {
    cleanup(handle);
    try { fs.rmSync(directory, { recursive: true, force: true }); }
    catch (_e) { /* fine */ }
  }
});

test('parseArgs handles --flag=value, --flag value, and positional', () => {
  const result = contact.parseArgs(['add', 'Marco', '--email=marco@x',
    '--phone', '555-1234', '--starred']);
  assert.deepEqual(result.positional, ['add', 'Marco']);
  assert.equal(result.flags.email, 'marco@x');
  assert.equal(result.flags.phone, '555-1234');
  assert.equal(result.flags.starred, true);
});

test('star/unstar are not proof-chain events (C5)', () => {
  const handle = freshDatabase();
  try {
    const c = contact.createContact(handle.database, runtimeState,
      { displayName: 'Star Me' });
    const beforeCount = handle.database.prepare(
      'SELECT COUNT(*) AS c FROM proof_chain'
    ).get().c;
    contact.setStarred(handle.database, c.id, true);
    contact.setStarred(handle.database, c.id, false);
    const afterCount = handle.database.prepare(
      'SELECT COUNT(*) AS c FROM proof_chain'
    ).get().c;
    assert.equal(afterCount, beforeCount);
  } finally { cleanup(handle); }
});

test('HTTP status payload reports counts only — no contact details (C26)', () => {
  const handle = freshDatabase();
  try {
    contact.createContact(handle.database, runtimeState,
      { displayName: 'Private Person', email: 'private@example.com' });
    const runtime = { database: handle.database,
      startedAtMs: Date.now() - 1000 };
    const handler = contact.buildStatusHandler(runtime);
    const captured = { status: null, body: null, headers: null };
    const fakeResponse = {
      writeHead(status, headers) { captured.status = status; captured.headers = headers; },
      end(body) { captured.body = body; },
    };
    handler({ url: '/status', method: 'GET' }, fakeResponse);
    assert.equal(captured.status, 200);
    const payload = JSON.parse(captured.body);
    assert.equal(payload.tool, 'loop-contact');
    assert.equal(payload.contact_count.active, 1);
    assert.ok(payload.proof_chain_head);
    // Privacy: no email, phone, name, address strings.
    assert.ok(!captured.body.includes('private@example.com'));
    assert.ok(!captured.body.includes('Private Person'));
  } finally { cleanup(handle); }
});

// ── The local API's browser gate (S19.1111: Access-Control-Allow-Origin `*` on a login-less API let any web page
// read and change the address book; a DNS-rebinding page reached it under its own Host name). ──────────────────

test('gate: a request with no headers is an in-process call and passes', () => {
  assert.deepEqual(contact.checkRequestOrigin(undefined), { allowed: true, allowOrigin: null });
});

test('gate: Host must name this machine — a rebinding page carries its own name and is refused', () => {
  const ok = (host) => contact.checkRequestOrigin({ host }).allowed;
  assert.equal(ok('127.0.0.1:1328'), true);
  assert.equal(ok('localhost:1328'), true);
  assert.equal(ok('[::1]:1328'), true);
  assert.equal(ok('LOCALHOST'), true);
  assert.equal(ok('attacker.example:1328'), false);
  assert.equal(ok('127.0.0.1.attacker.example'), false);
  assert.equal(contact.checkRequestOrigin({ host: 'box.lan:1328' }, { bindHost: 'box.lan' }).allowed, true);
});

test('gate: a foreign Origin is refused; a loopback Origin on any port is allowed and echoed, never `*`', () => {
  const foreign = contact.checkRequestOrigin({ host: '127.0.0.1:1328', origin: 'https://attacker.example' });
  assert.deepEqual(foreign, { allowed: false, status: 403, reason: 'origin not allowed' });
  const local = contact.checkRequestOrigin({ host: '127.0.0.1:1328', origin: 'http://localhost:3000' });
  assert.deepEqual(local, { allowed: true, allowOrigin: 'http://localhost:3000' });
  assert.equal(contact.checkRequestOrigin({ origin: 'http://localhost.attacker.example' }).allowed, false);
  assert.equal(contact.checkRequestOrigin({ origin: 'file://' }).allowed, false);
  assert.equal(contact.checkRequestOrigin({ origin: 'null' }).allowed, false);
});

test('gate: contact.allowed_origins admits a named origin and nothing else', () => {
  const opts = { allowedOrigins: ['https://forest.example'] };
  assert.equal(contact.checkRequestOrigin({ origin: 'https://forest.example' }, opts).allowOrigin, 'https://forest.example');
  assert.equal(contact.checkRequestOrigin({ origin: 'https://other.example' }, opts).allowed, false);
});

test('gate: Sec-Fetch-Site cross-site with no Origin is refused', () => {
  assert.equal(contact.checkRequestOrigin({ host: '127.0.0.1:1328', 'sec-fetch-site': 'cross-site' }).allowed, false);
  assert.equal(contact.checkRequestOrigin({ host: '127.0.0.1:1328', 'sec-fetch-site': 'same-origin' }).allowed, true);
});

test('gate: the daemon handler refuses a foreign page before any contact data is read, and never sends `*`', async () => {
  const handle = freshDatabase();
  try {
    contact.createContact(handle.database, runtimeState,
      { displayName: 'Private Person', email: 'private@example.com' });
    const runtime = { database: handle.database, startedAtMs: Date.now() };
    const handler = contact.buildStatusHandler(runtime);
    const run = (headers, url = '/api/contacts/export') => new Promise((resolve) => {
      const captured = { status: null, body: '', headers: {} };
      const fakeResponse = {
        setHeader(k, v) { captured.headers[k.toLowerCase()] = v; },
        writeHead(status, headers) {
          captured.status = status;
          for (const [k, v] of Object.entries(headers ?? {})) captured.headers[k.toLowerCase()] = v;
        },
        end(body) { captured.body = String(body ?? ''); resolve(captured); },
      };
      handler({ url, method: 'GET', headers }, fakeResponse);
    });
    const evil = await run({ host: '127.0.0.1:1328', origin: 'https://attacker.example' });
    assert.equal(evil.status, 403);
    assert.ok(!evil.body.includes('Private Person'));
    const rebound = await run({ host: 'attacker.example:1328' });
    assert.equal(rebound.status, 403);
    const local = await run({ host: '127.0.0.1:1328', origin: 'http://127.0.0.1:1328' });
    assert.equal(local.status, 200);
    assert.ok(local.body.includes('Private Person'));
    assert.equal(local.headers['access-control-allow-origin'], 'http://127.0.0.1:1328');
    const plain = await run({ host: '127.0.0.1:1328' });
    assert.equal(plain.status, 200);
    assert.equal(plain.headers['access-control-allow-origin'], undefined);
  } finally { cleanup(handle); }
});
