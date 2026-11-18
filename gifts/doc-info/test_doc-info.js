#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// test_doc-info.js — the doc-info Gift's tests (the-library AV4, U-G2 documents; Blueprint
// the doc-info Blueprint v1.2). Written red before doc-info.js (S06.2234-swift-disco-7hkvzg).
// Three parts: the frozen corpus in fixtures/ (good files, read with and without an inflate, checked against the oracles
// pdfinfo and Python's zipfile + xml.etree when present — absent tools are SKIPPED and said so); good cases built here
// (sparse ids, a hybrid update over a free entry, a PNG-predicted xref stream, an indirect /Count, a renamed core part
// with a prefixed CDATA title, streamed zip entries); and every known-bad vector of B6, each built here by mutation.
// Run: node test_doc-info.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { readDocInfo, DocInfoError } = require(path.join(__dirname, 'doc-info.js'));

const FX = path.join(__dirname, 'fixtures');
const INFLATE = {
  inflate: (b, max) => zlib.inflateSync(b, { maxOutputLength: max }),
  inflateRaw: (b, max) => zlib.inflateRawSync(b, { maxOutputLength: max }),
};
// The CLI's adapter refuses unconsumed input (R1.1.5); the tests use the Gift's own exported adapter when it has one.
let passed = 0, failed = 0, skipped = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n     ') : e}`); }
}
function skip(name, why) { skipped++; console.log(`SKIP ${name} — ${why}`); }
const have = (cmd, arg) => spawnSync(cmd, [arg || '-v'], { encoding: 'utf8' }).error === undefined;
const read = (b, o) => readDocInfo(b, o === undefined ? nodeInflate() : o);
function nodeInflate() {
  const m = require(path.join(__dirname, 'doc-info.js'));
  return m.nodeInflaters ? m.nodeInflaters(zlib) : INFLATE;
}
function throwsDoc(fn, code, msg) {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  assert.ok(err, `expected DocInfoError (${msg || code}), got a result`);
  assert.ok(err instanceof DocInfoError, `expected DocInfoError, got ${err && err.constructor && err.constructor.name}: ${err && err.message}`);
  if (code) assert.strictEqual(err.code, code, `code for ${msg || ''}: ${err.message}`);
  if (process.env.DOC_INFO_SHOW) console.log(`MSG ${msg} => [${err.code}] ${err.message}`);
  return err;
}
const fx = (name) => fs.readFileSync(path.join(FX, name));
const R = (over) => Object.assign({ format: 'pdf', title: null, creator: null, last_modified_by: null, pages: null, encrypted: false, unreached: [] }, over);
const B = (s) => Buffer.from(s, 'latin1');

// ---- a tiny PDF writer (tests only) ------------------------------------------------------------------------------
// objects: [[num, body]] with body a string or Buffer (a stream body includes its own dictionary and stream keywords).
function obj(num, body, gen = 0) { return Buffer.concat([B(`${num} ${gen} obj\n`), Buffer.isBuffer(body) ? body : B(body), B('\nendobj\n')]); }
function stream(dict, data) { return Buffer.concat([B(`<<${dict}/Length ${data.length}>>\nstream\n`), data, B('\nendstream')]); }
function xrefTable(entries) { // entries: Map num -> {off, gen, free}; subsections by run
  const nums = [...entries.keys()].sort((a, b) => a - b); let out = 'xref\n'; let i = 0;
  while (i < nums.length) {
    let j = i; while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out += `${nums[i]} ${j - i + 1}\n`;
    for (let k = i; k <= j; k++) { const e = entries.get(nums[k]); out += `${String(e.off).padStart(10, '0')} ${String(e.gen).padStart(5, '0')} ${e.free ? 'f' : 'n'} \n`; }
    i = j + 1;
  }
  return out;
}
function buildPdf(objects, trailer, opt = {}) {
  const parts = [B(`%PDF-1.7\n%\xe2\xe3\xcf\xd3\n`)]; let pos = parts[0].length; const entries = new Map([[0, { off: 0, gen: 65535, free: true }]]);
  for (const [num, body, gen] of objects) { const o = obj(num, body, gen || 0); entries.set(num, { off: pos, gen: gen || 0 }); parts.push(o); pos += o.length; }
  for (const [num, gen] of (opt.free || [])) entries.set(num, { off: 0, gen, free: true });
  const size = opt.size || Math.max(...entries.keys()) + 1;
  if (opt.xref === 'stream') {
    const x = xrefStreamObj(opt.xrefNum || size, entries, pos, `/Size ${(opt.xrefNum || size) + 1}${trailer}`, opt);
    parts.push(x); return Buffer.concat([...parts, B(`startxref\n${pos}\n%%EOF\n`)]);
  }
  const xr = B(xrefTable(entries) + `trailer\n<</Size ${size}${trailer}>>\nstartxref\n${pos}\n%%EOF\n`);
  return Buffer.concat([...parts, xr]);
}
function xrefRows(entries, w = [1, 4, 2]) { // entries Map num -> {type, f2, f3}
  const nums = [...entries.keys()].sort((a, b) => a - b); const idx = []; let i = 0; const rows = [];
  while (i < nums.length) { let j = i; while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++; idx.push(nums[i], j - i + 1); for (let k = i; k <= j; k++) rows.push(entries.get(nums[k])); i = j + 1; }
  const width = w[0] + w[1] + w[2]; const out = Buffer.alloc(rows.length * width);
  rows.forEach((r, n) => { let p = n * width; for (const [v, len] of [[r.type, w[0]], [r.f2, w[1]], [r.f3, w[2]]]) { for (let b = len - 1; b >= 0; b--) out[p + b] = Math.floor(v / Math.pow(256, len - 1 - b)) & 255; p += len; } });
  return { data: out, index: idx, width };
}
function pngUp(data, cols) { // PNG predictor 12 (Up) encode
  const rows = data.length / cols; const out = Buffer.alloc(rows * (cols + 1));
  for (let r = 0; r < rows; r++) { out[r * (cols + 1)] = 2; for (let c = 0; c < cols; c++) { const up = r ? data[(r - 1) * cols + c] : 0; out[r * (cols + 1) + 1 + c] = (data[r * cols + c] - up) & 255; } }
  return out;
}
function xrefStreamObj(num, tableEntries, selfOff, dictTail, opt = {}) {
  const e = new Map();
  for (const [n, v] of tableEntries) e.set(n, v.free ? { type: 0, f2: 0, f3: v.gen } : { type: 1, f2: v.off, f3: v.gen });
  for (const [n, v] of (opt.extra || [])) e.set(n, v);
  e.set(num, { type: 1, f2: selfOff, f3: 0 });
  const { data, index } = xrefRows(e);
  let body = data; let filt = '';
  if (opt.predictor) { body = pngUp(data, 7); filt = '/DecodeParms<</Predictor 12/Columns 7>>'; }
  if (opt.deflate || opt.predictor) { body = zlib.deflateSync(body); filt = '/Filter/FlateDecode' + filt; }
  return obj(num, stream(`/Type/XRef/W[1 4 2]/Index[${index.join(' ')}]${filt}${dictTail}`, body));
}
function appendUpdate(base, objects, trailer, opt = {}) { // an incremental update: new objects, a table or stream, /Prev
  const prev = +String(base).match(/startxref\s+(\d+)\s+%%EOF\s*$/)[1];
  const parts = [base]; let pos = base.length; const entries = new Map();
  for (const [num, body, gen] of objects) { const o = obj(num, body, gen || 0); entries.set(num, { off: pos, gen: gen || 0 }); parts.push(o); pos += o.length; }
  if (opt.xref === 'stream') { parts.push(xrefStreamObj(opt.xrefNum, entries, pos, `/Size ${opt.size}/Prev ${prev}${trailer}`, opt)); return Buffer.concat([...parts, B(`startxref\n${pos}\n%%EOF\n`)]); }
  const xr = B(xrefTable(entries) + `trailer\n<</Size ${opt.size}/Prev ${prev}${trailer}>>\nstartxref\n${pos}\n%%EOF\n`);
  return Buffer.concat([...parts, xr]);
}
const CAT = [1, '<</Type/Catalog/Pages 2 0 R>>'];
const PAGES = (n = 1, kids = '[3 0 R]') => [2, `<</Type/Pages/Kids${kids}/Count ${n}>>`];
const PAGE = [3, '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>'];
const INFO = (title = '(A Plain Title)', author = '(Ada Quill)') => [4, `<</Title ${title}/Author ${author}>>`];
const simple = (over = {}) => buildPdf([CAT, PAGES(over.count || 1), PAGE, INFO(over.title, over.author), ...(over.more || [])], over.trailer || '/Root 1 0 R/Info 4 0 R', over.opt || {});

// ---- a tiny zip writer (tests only) ------------------------------------------------------------------------------
function zip(entries, opt = {}) { // entries: {name, data, method=8, bit3, sig=true, lname, lcrc, lsize, comment}
  const locals = []; const cds = []; let pos = 0;
  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const method = e.method === undefined ? 8 : e.method;
    const comp = e.raw || (method === 8 ? zlib.deflateRawSync(data) : data);
    const crc = e.crc === undefined ? zlib.crc32(data) : e.crc; const name = Buffer.from(e.name, 'utf8'); const lname = Buffer.from(e.lname || e.name, 'utf8');
    const flags = e.bit3 ? 8 : 0;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(e.bit3 ? 0 : (e.lcrc === undefined ? crc : e.lcrc), 14); lh.writeUInt32LE(e.bit3 ? 0 : comp.length, 18); lh.writeUInt32LE(e.bit3 ? 0 : (e.lsize === undefined ? data.length : e.lsize), 22);
    lh.writeUInt16LE(lname.length, 26);
    let desc = Buffer.alloc(0);
    if (e.bit3) { const d = Buffer.alloc(e.sig === false ? 12 : 16); let p = 0; if (e.sig !== false) { d.writeUInt32LE(0x08074b50, 0); p = 4; } d.writeUInt32LE(crc, p); d.writeUInt32LE(comp.length, p + 4); d.writeUInt32LE(e.dsize === undefined ? data.length : e.dsize, p + 8); desc = d; }
    const rec = Buffer.concat([lh, lname, comp, desc]);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(flags, 8); cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(e.csize === undefined ? comp.length : e.csize, 20); cd.writeUInt32LE(e.usize === undefined ? data.length : e.usize, 24); cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(e.offset === undefined ? pos : e.offset, 42);
    cds.push(Buffer.concat([cd, name])); locals.push(rec); pos += rec.length;
  }
  const cdBuf = Buffer.concat(cds); const comment = Buffer.from(opt.comment || '', 'latin1');
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(opt.count || entries.length, 8); eocd.writeUInt16LE(opt.count || entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(pos, 16); eocd.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...locals, cdBuf, eocd, comment]);
}
const NS = { pkg: 'http://schemas.openxmlformats.org/package/2006/relationships', core: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  ext: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties', doc: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument' };
const CT_CORE = 'application/vnd.openxmlformats-package.core-properties+xml';
const CT_EXT = 'application/vnd.openxmlformats-officedocument.extended-properties+xml';
const CT_WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
function ctypes(over) { return `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${Object.entries(over).map(([p, c]) => `<Override PartName="${p}" ContentType="${c}"/>`).join('')}</Types>`; }
function relsXml(rels) { return `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${NS.pkg}">${rels.map(([id, ty, tg, mode]) => `<Relationship Id="${id}" Type="${ty}" Target="${tg}"${mode ? ` TargetMode="${mode}"` : ''}/>`).join('')}</Relationships>`; }
const coreXml = (inner) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">${inner}</cp:coreProperties>`;
const appXml = (inner) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">${inner}</Properties>`;
function docx(o = {}) {
  const corePath = o.corePath || 'docProps/core.xml';
  const entries = [
    { name: '[Content_Types].xml', data: o.ct || ctypes(Object.assign({ '/word/document.xml': CT_WORD, ['/' + corePath]: CT_CORE, '/docProps/app.xml': CT_EXT }, o.ctOver || {})) },
    { name: '_rels/.rels', data: o.rels || relsXml([['rId1', NS.doc, 'word/document.xml'], ['rId2', NS.core, o.coreTarget || corePath], ['rId3', NS.ext, 'docProps/app.xml'], ...(o.moreRels || [])]) },
    { name: corePath, data: o.core || coreXml('<dc:title>A Weir</dc:title><dc:creator>Ada Quill</dc:creator><cp:lastModifiedBy>Bram Ostrander</cp:lastModifiedBy>') },
    { name: 'docProps/app.xml', data: o.app || appXml('<Pages>2</Pages>') },
    { name: 'word/document.xml', data: '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>' },
    ...(o.more || []),
  ];
  for (const [i, patch] of Object.entries(o.patch || {})) Object.assign(entries[i], patch);
  return zip(entries, o.zip || {});
}
const DOCX_OK = R({ format: 'ooxml', title: 'A Weir', creator: 'Ada Quill', last_modified_by: 'Bram Ostrander', pages: 2 });

// ===================================================================================================================
// 1. the frozen corpus
// ===================================================================================================================
const HAVE_FX = fs.existsSync(path.join(FX, 'SHA256SUMS'));
if (!HAVE_FX) skip('the frozen corpus and its oracles (19 checks)', 'fixtures/ is not beside this file (the served copy ships the code, not the corpus); the built cases and every known-bad vector still run');
if (HAVE_FX) {
t('every frozen fixture matches SHA256SUMS', () => {
  const lines = fs.readFileSync(path.join(FX, 'SHA256SUMS'), 'utf8').trim().split('\n');
  assert.ok(lines.length >= 18);
  for (const l of lines) { const [sum, name] = l.split(/\s+/); assert.strictEqual(crypto.createHash('sha256').update(fx(name)).digest('hex'), sum, name); }
});

const MEMO = { title: 'The Mill Pond Ledger & Notes', creator: 'Ada Quill', pages: 3 };
const DECK = { title: 'Spring Gathering 池', creator: 'Ada Quill', pages: 4 };
const GOOD = {
  'memo.pdf': R(MEMO), 'deck.pdf': R(DECK), 'memo-objstm.pdf': R(MEMO), 'memo-linear.pdf': R(MEMO), 'deck-objstm-linear.pdf': R(DECK),
  'memo-incremental.pdf': R({ title: 'The Mill Pond Ledger, revised (2)', creator: 'Ada Quill', pages: 3 }),
  'memo-encrypted.pdf': R({ pages: 3, encrypted: true, unreached: ['creator:encrypted', 'title:encrypted'] }),
  'memo-encrypted-objstm.pdf': R({ encrypted: true, unreached: ['creator:encrypted', 'pages:encrypted', 'title:encrypted'] }),
  'memo.docx': R({ format: 'ooxml', title: MEMO.title, creator: 'Ada Quill', last_modified_by: 'Bram Ostrander' }),
  'deck.pptx': R({ format: 'ooxml', title: DECK.title, creator: 'Ada Quill' }),
  'sheet.xlsx': R({ format: 'ooxml', title: 'Seed Count', creator: 'Ada Quill' }),
  'word-shaped.docx': R({ format: 'ooxml', title: 'Résumé of the Weir <draft>', creator: 'Ada Quill', last_modified_by: 'Bram Ostrander', pages: 12 }),
  'renamed-parts.docx': R({ format: 'ooxml', title: 'The Weir, Second Survey', creator: 'Ada Quill', pages: 5 }),
  'deck-slides.pptx': R({ format: 'ooxml', title: 'Seven Slides on Eels', creator: 'Ada Quill', pages: 7 }),
  'memo.odt': R({ format: 'odf', title: MEMO.title, creator: 'Ada Quill', last_modified_by: 'Bram Ostrander', pages: 3 }),
  'deck.odp': R({ format: 'odf', title: DECK.title, creator: 'Ada Quill' }),
  'sheet.ods': R({ format: 'odf', title: 'Seed Count', creator: 'Ada Quill' }),
};
for (const [name, want] of Object.entries(GOOD)) {
  t(`reads ${name}`, () => assert.deepStrictEqual(read(fx(name)), want));
}
t('without an inflate: a plain PDF reads whole; a compressed newest xref withholds every field; zips name what they could not reach', () => {
  assert.deepStrictEqual(read(fx('memo.pdf'), {}), GOOD['memo.pdf']);
  assert.deepStrictEqual(read(fx('memo-objstm.pdf'), {}), R({ unreached: ['creator:needs-inflate', 'pages:needs-inflate', 'title:needs-inflate'], encrypted: false }));
  const d = read(fx('memo.docx'), {});
  assert.deepStrictEqual(d, R({ format: 'ooxml', unreached: ['creator:needs-inflate', 'last_modified_by:needs-inflate', 'pages:needs-inflate', 'title:needs-inflate'] }));
  const o = read(fx('memo.odt'), {});
  assert.strictEqual(o.format, 'odf'); assert.strictEqual(o.encrypted, null);
  assert.ok(o.unreached.includes('title:needs-inflate') && o.unreached.includes('encrypted:needs-inflate'), JSON.stringify(o.unreached));
});
t('deck-slides-no-types.pptx: properties parts without their content type are refused', () => {
  throwsDoc(() => read(fx('deck-slides-no-types.pptx')), 'structure');
});
t('the incremental fixture: the newest /Info wins and the older title is never reported', () => {
  assert.strictEqual(read(fx('memo-incremental.pdf')).title, 'The Mill Pond Ledger, revised (2)');
});
t('determinism: two reads of every fixture print the same bytes, unreached sorted', () => {
  for (const name of Object.keys(GOOD)) {
    const a = JSON.stringify(read(fx(name))); const b = JSON.stringify(read(Buffer.from(fx(name))));
    assert.strictEqual(a, b, name);
    const u = JSON.parse(a).unreached; assert.deepStrictEqual(u, [...new Set(u)].sort(), name);
  }
});
t('the result has exactly the contract keys, in any read', () => {
  for (const name of Object.keys(GOOD)) assert.deepStrictEqual(Object.keys(read(fx(name))).sort(), ['creator', 'encrypted', 'format', 'last_modified_by', 'pages', 'title', 'unreached']);
});

// ---- the oracles (skipped and said so when absent) ----
if (have('pdfinfo')) {
  t('pdfinfo agrees on Title, Author and Pages for every unencrypted good PDF', () => {
    for (const name of Object.keys(GOOD).filter((n) => n.endsWith('.pdf') && !n.includes('encrypted'))) {
      const out = spawnSync('pdfinfo', ['-enc', 'UTF-8', path.join(FX, name)], { encoding: 'utf8' }).stdout;
      const field = (k) => { const m = out.match(new RegExp(`^${k}:\\s+(.*)$`, 'm')); return m ? m[1].trim() : null; };
      const got = read(fx(name));
      assert.strictEqual(got.title, field('Title'), name); assert.strictEqual(got.creator, field('Author'), name); assert.strictEqual(String(got.pages), field('Pages'), name);
    }
  });
} else skip('pdfinfo oracle', 'pdfinfo is not on this machine; the frozen expectations still ran');
const PY_ORACLE = String.raw`
import sys, json, zipfile, posixpath, xml.etree.ElementTree as ET
DC="{http://purl.org/dc/elements/1.1/}"; CP="{http://schemas.openxmlformats.org/package/2006/metadata/core-properties}"
EP="{http://schemas.openxmlformats.org/officeDocument/2006/extended-properties}"; META="{urn:oasis:names:tc:opendocument:xmlns:meta:1.0}"
OFF="{urn:oasis:names:tc:opendocument:xmlns:office:1.0}"
def t(e): return ((e.text or "").strip() or None) if e is not None else None
out={}
for f in sys.argv[1:]:
    z=zipfile.ZipFile(f)
    if "meta.xml" in z.namelist():
        m=ET.fromstring(z.read("meta.xml")).find(OFF+"meta"); st=m.find(META+"document-statistic")
        pc=st.get(META+"page-count") if st is not None else None
        out[f]=[t(m.find(DC+"title")), t(m.find(META+"initial-creator")), t(m.find(DC+"creator")), int(pc) if pc else None]; continue
    core=app=None
    for r in ET.fromstring(z.read("_rels/.rels")):
        ty=r.get("Type"); tg=posixpath.normpath(r.get("Target").lstrip("/"))
        if ty.endswith("/metadata/core-properties"): core=ET.fromstring(z.read(tg))
        if ty.endswith("/extended-properties"): app=ET.fromstring(z.read(tg))
    n=None
    if app is not None:
        n=t(app.find(EP+"Pages")) or t(app.find(EP+"Slides"))
    out[f]=[t(core.find(DC+"title")), t(core.find(DC+"creator")), t(core.find(CP+"lastModifiedBy")), int(n) if n else None]
print(json.dumps(out))
`;
if (have('python3', '-V')) {
  t('Python zipfile + xml.etree (the independent reader) agrees on every good office fixture', () => {
    const names = Object.keys(GOOD).filter((n) => !n.endsWith('.pdf'));
    const r = spawnSync('python3', ['-I', '-c', PY_ORACLE, ...names.map((n) => path.join(FX, n))], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    const want = JSON.parse(r.stdout);
    for (const n of names) {
      const [title, creator, last, pages] = want[path.join(FX, n)]; const got = read(fx(n));
      assert.deepStrictEqual([got.title, got.creator, got.last_modified_by, got.pages], [title, creator, last, pages], n);
    }
  });
} else skip('python oracle', 'python3 is not on this machine');

}  // HAVE_FX

// ===================================================================================================================
// 2. good cases built here (B6 "good fixtures that must read correctly")
// ===================================================================================================================
t('a sparse object id: /Info is object 4096 in a small file (R1.2.1)', () => {
  const b = buildPdf([CAT, PAGES(), PAGE, [4096, '<</Title (Sparse)>>']], '/Root 1 0 R/Info 4096 0 R');
  assert.ok(b.length < 1024);
  assert.deepStrictEqual(read(b), R({ title: 'Sparse', pages: 1 }));
});
t('a hybrid update: the companion stream supplies an object the older table marks free (R1.2.2)', () => {
  const base = buildPdf([CAT, PAGES(), PAGE, INFO('(Old Title)')], '/Root 1 0 R/Info 4 0 R', { free: [[5, 0]], size: 6 });
  // the update: object 5 (the new /Info) is written but listed only in the companion xref stream (object 6); the
  // classic section lists nothing new but its own update trailer; /XRefStm points at the stream.
  const prev = +String(base).match(/startxref\s+(\d+)\s+%%EOF\s*$/)[1];
  let pos = base.length; const o5 = obj(5, '<</Title (Hybrid Title)/Author (Ada Quill)>>'); const off5 = pos; pos += o5.length;
  const xs = xrefStreamObj(6, new Map([[5, { off: off5, gen: 0 }]]), pos, '/Size 7'); const offXs = pos; pos += xs.length;
  const tail = B(`xref\n0 0\ntrailer\n<</Size 7/Root 1 0 R/Info 5 0 R/Prev ${prev}/XRefStm ${offXs}>>\nstartxref\n${pos}\n%%EOF\n`);
  const b = Buffer.concat([base, o5, xs, tail]);
  if (have('pdfinfo')) { fs.writeFileSync('/tmp/doc-info-hybrid.pdf', b); assert.match(spawnSync('pdfinfo', ['/tmp/doc-info-hybrid.pdf'], { encoding: 'utf8' }).stdout, /Title:\s+Hybrid Title/); }
  assert.deepStrictEqual(read(b), R({ title: 'Hybrid Title', creator: 'Ada Quill', pages: 1 }));
});
t('within one hybrid revision a table free entry yields to its companion stream (Word writes compressed objects so)', () => {
  const base = simple();
  const prev = +String(base).match(/startxref\s+(\d+)\s+%%EOF\s*$/)[1];
  let pos = base.length; const o5 = obj(5, '<</Title (Companion Wins)>>'); const off5 = pos; pos += o5.length;
  const xs = xrefStreamObj(6, new Map([[5, { off: off5, gen: 0 }]]), pos, '/Size 7'); const offXs = pos; pos += xs.length;
  const tail = B(`xref\n5 1\n0000000000 00001 f \ntrailer\n<</Size 7/Root 1 0 R/Info 5 0 R/Prev ${prev}/XRefStm ${offXs}>>\nstartxref\n${pos}\n%%EOF\n`);
  assert.strictEqual(read(Buffer.concat([base, o5, xs, tail])).title, 'Companion Wins');
});
t('an xref stream with the PNG Up predictor (R1.2.3)', () => {
  const b = simple({ opt: { xref: 'stream', predictor: true } });
  if (have('pdfinfo')) { fs.writeFileSync('/tmp/doc-info-pred.pdf', b); assert.match(spawnSync('pdfinfo', ['/tmp/doc-info-pred.pdf'], { encoding: 'utf8' }).stdout, /Title:\s+A Plain Title/); }
  assert.deepStrictEqual(read(b), R({ title: 'A Plain Title', creator: 'Ada Quill', pages: 1 }));
  assert.deepStrictEqual(read(b, {}).unreached, ['creator:needs-inflate', 'pages:needs-inflate', 'title:needs-inflate']);
});
t('an uncompressed xref stream reads with no inflate', () => {
  assert.deepStrictEqual(read(simple({ opt: { xref: 'stream' } }), {}), R({ title: 'A Plain Title', creator: 'Ada Quill', pages: 1 }));
});
t('an indirect /Count (R1.2.4) and an indirect /Title', () => {
  const b = buildPdf([CAT, [2, '<</Type/Pages/Kids[3 0 R]/Count 8 0 R>>'], PAGE, [4, '<</Title 9 0 R>>'], [8, '1'], [9, '(Through a Reference)']], '/Root 1 0 R/Info 4 0 R');
  assert.deepStrictEqual(read(b), R({ title: 'Through a Reference', pages: 1 }));
});
t('strings: UTF-16BE and UTF-8 with BOMs, PDFDocEncoding, literal escapes and balanced parentheses, hex', () => {
  const u16 = '<FEFF' + Buffer.from('Café 池', 'utf16le').swap16().toString('hex') + '>';
  assert.strictEqual(read(simple({ title: u16 })).title, 'Café 池');
  assert.strictEqual(read(simple({ title: '<EFBBBF' + Buffer.from('Café', 'utf8').toString('hex') + '>' })).title, 'Café');
  assert.strictEqual(read(simple({ title: '(a \\(b\\) (c) \\134 \\101\\\n z)' })).title, 'a (b) (c) \\ A z');
  assert.strictEqual(read(simple({ title: '(\\204 \\215 \\223)' })).title, '— “ ﬁ');  // PDFDocEncoding: em dash, left quote, fi
  assert.strictEqual(read(simple({ title: '<48 6>' })).title, 'H`');                              // hex with whitespace, odd digit padded
});
t('name escapes: /Ti#74le is /Title (R1.3.2)', () => {
  assert.strictEqual(read(buildPdf([CAT, PAGES(), PAGE, [4, '<</Ti#74le (Escaped)>>']], '/Root 1 0 R/Info 4 0 R')).title, 'Escaped');
});
t('XMP: a /Metadata catalog with no /Info title reads xmp-only', () => {
  const b = buildPdf([[1, '<</Type/Catalog/Pages 2 0 R/Metadata 5 0 R>>'], PAGES(), PAGE, [4, '<</Author (Ada Quill)>>'], [5, stream('/Type/Metadata/Subtype/XML', B('<x/>'))]], '/Root 1 0 R/Info 4 0 R');
  assert.deepStrictEqual(read(b), R({ creator: 'Ada Quill', pages: 1, unreached: ['title:xmp-only'] }));
});
t('no /Info at all: people and title absent, no reason', () => {
  assert.deepStrictEqual(read(buildPdf([CAT, PAGES(2, '[3 0 R 3 0 R]'), PAGE], '/Root 1 0 R')), R({ pages: 2 }));
});
t('a renamed core part with a Dublin Core title through another prefix, written as CDATA (R1.2.5)', () => {
  const b = docx({ corePath: 'Metadata/Properties.xml', coreTarget: '/Metadata/Properties.xml',
    core: '<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:terms="http://purl.org/dc/elements/1.1/"><!-- a comment <dc:title>no</dc:title> --><terms:title><![CDATA[Alternate <metadata> & title]]></terms:title></cp:coreProperties>' });
  assert.deepStrictEqual(read(b), R({ format: 'ooxml', title: 'Alternate <metadata> & title', pages: 2 }));
});
t('a relationship target with ./ and percent-encoding resolves to its part', () => {
  const b = docx({ corePath: 'meta/c.xml', coreTarget: './meta/%63.xml' });
  assert.strictEqual(read(b).title, 'A Weir');
});
t('an end-record signature inside the comment is not mistaken for the end record', () => {
  const g = docx(); const inner = Buffer.from(g.subarray(g.length - 22));
  assert.deepStrictEqual(read(docx({ zip: { comment: inner.toString('latin1') } })), DOCX_OK);
});
t('streamed entries: bit 3 with signed and unsigned descriptors (R1.3.3)', () => {
  assert.deepStrictEqual(read(docx({ patch: { 2: { bit3: true }, 3: { bit3: true, sig: false } } })), DOCX_OK);
});
t('a stored entry reads without an inflate', () => {
  assert.deepStrictEqual(read(docx({ patch: { 0: { method: 0 }, 1: { method: 0 }, 2: { method: 0 }, 3: { method: 0 } } }), {}), DOCX_OK);
});
t('a deck counts Slides, a sheet counts nothing, no extended part reads pages absent', () => {
  const CT_DECK = 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';
  const deck = docx({ app: appXml('<Slides>9</Slides><Pages>4</Pages>'), ctOver: { '/word/document.xml': CT_DECK } });
  assert.strictEqual(read(deck).pages, 9);
  const sheet = docx({ ctOver: { '/word/document.xml': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml' } });
  assert.strictEqual(read(sheet).pages, null);
  const noApp = docx({ rels: relsXml([['rId1', NS.doc, 'word/document.xml'], ['rId2', NS.core, 'docProps/core.xml']]) });
  assert.deepStrictEqual(read(noApp), Object.assign({}, DOCX_OK, { pages: null }));
  const noProps = docx({ rels: relsXml([['rId1', NS.doc, 'word/document.xml']]) });
  assert.deepStrictEqual(read(noProps), R({ format: 'ooxml' }));
});
t('XML text: entities expanded once, numeric references, whitespace trimmed, an empty value null', () => {
  assert.strictEqual(read(docx({ core: coreXml('<dc:title>  &amp;#65; &#x41;&#66; &lt;&gt;&quot;&apos;  </dc:title>') })).title, '&#65; AB <>"\'');
  assert.strictEqual(read(docx({ core: coreXml('<dc:title>   </dc:title>') })).title, null);
});
t('UTF-16 XML with a BOM reads', () => {
  const x = coreXml('<dc:title>Sixteen</dc:title>').replace('UTF-8', 'UTF-16');
  const b16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(x, 'utf16le')]);
  assert.strictEqual(read(docx({ core: b16 })).title, 'Sixteen');
});
t('ODF: manifest encryption on another member is reported, meta still read; on meta.xml every field is blocked (R1.3.5)', () => {
  const MAN = (enc) => `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>${['content.xml', 'meta.xml'].map((p) => `<manifest:file-entry manifest:full-path="${p}" manifest:media-type="text/xml">${enc.includes(p) ? '<manifest:encryption-data manifest:checksum-type="SHA1/1K" manifest:checksum="x"><manifest:algorithm manifest:algorithm-name="Blowfish CFB" manifest:initialisation-vector="x"/></manifest:encryption-data>' : ''}</manifest:file-entry>`).join('')}</manifest:manifest>`;
  const META = '<?xml version="1.0" encoding="UTF-8"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><office:meta><dc:title>Ledger</dc:title><meta:initial-creator>Ada Quill</meta:initial-creator><dc:creator>Bram Ostrander</dc:creator><meta:document-statistic meta:page-count="7"/></office:meta></office:document-meta>';
  const odt = (enc, metaBytes) => zip([{ name: 'mimetype', data: 'application/vnd.oasis.opendocument.text', method: 0 }, { name: 'META-INF/manifest.xml', data: MAN(enc) }, { name: 'meta.xml', data: metaBytes || META, method: enc.includes('meta.xml') ? 0 : 8 }, { name: 'content.xml', data: '<x/>' }]);
  assert.deepStrictEqual(read(odt([])), R({ format: 'odf', title: 'Ledger', creator: 'Ada Quill', last_modified_by: 'Bram Ostrander', pages: 7 }));
  assert.deepStrictEqual(read(odt(['content.xml'])), R({ format: 'odf', title: 'Ledger', creator: 'Ada Quill', last_modified_by: 'Bram Ostrander', pages: 7, encrypted: true }));
  assert.deepStrictEqual(read(odt(['meta.xml'], crypto.randomBytes(64))), R({ format: 'odf', encrypted: true, unreached: ['creator:encrypted', 'last_modified_by:encrypted', 'pages:encrypted', 'title:encrypted'] }));
  const noMan = zip([{ name: 'mimetype', data: 'application/vnd.oasis.opendocument.text', method: 0 }, { name: 'meta.xml', data: META }]);
  assert.deepStrictEqual(read(noMan), R({ format: 'odf', title: 'Ledger', creator: 'Ada Quill', last_modified_by: 'Bram Ostrander', pages: 7, encrypted: null }));
});
t('a long title past 65,536 UTF-8 bytes reads null with title:budget', () => {
  const r = read(simple({ title: '(' + 'x'.repeat(65537) + ')' }));
  assert.strictEqual(r.title, null); assert.deepStrictEqual(r.unreached, ['title:budget']);
});
t('a /Count that is not a safe integer >= 1 reads pages:malformed', () => {
  for (const c of ['0', '-1', '2.5', '(3)', '99999999999999999999', '/Three']) {
    const b = buildPdf([CAT, [2, `<</Type/Pages/Kids[3 0 R]/Count ${c}>>`], PAGE, INFO()], '/Root 1 0 R/Info 4 0 R');
    const r = read(b); assert.strictEqual(r.pages, null, c); assert.deepStrictEqual(r.unreached, ['pages:malformed'], c);
  }
});
t('a direct-dictionary /Info blanks the people fields with malformed and keeps the count', () => {
  const r = read(buildPdf([CAT, PAGES(), PAGE], '/Root 1 0 R/Info <</Title (Direct)>>'));
  assert.deepStrictEqual(r, R({ pages: 1, unreached: ['creator:malformed', 'title:malformed'] }));
});
t('a newest xref stream that needs an inflate withholds the older revision\'s title (R1.3.1)', () => {
  const base = simple();
  const upd = appendUpdate(base, [[5, '<</Title (Newer)>>']], '/Root 1 0 R/Info 5 0 R', { xref: 'stream', deflate: true, xrefNum: 6, size: 7 });
  assert.strictEqual(read(upd).title, 'Newer');
  assert.deepStrictEqual(read(upd, {}), R({ unreached: ['creator:needs-inflate', 'pages:needs-inflate', 'title:needs-inflate'] }));
});
t('an unsupported filter reads every field unsupported-filter', () => {
  const b = Buffer.from(String(simple({ opt: { xref: 'stream', deflate: true } }), 'latin1').replace('/Filter/FlateDecode', '/Filter/LZWDecode  '), 'latin1');
  assert.deepStrictEqual(read(b), R({ unreached: ['creator:unsupported-filter', 'pages:unsupported-filter', 'title:unsupported-filter'] }));
});
t('the browser surface and the CLI', () => {
  const src = fs.readFileSync(path.join(__dirname, 'doc-info.js'), 'utf8');
  assert.match(src, /window\.LoopGifts\.readDocInfo = readDocInfo/);
  assert.match(src, /window\.LoopGifts\['doc-info'\] = \{ readDocInfo: readDocInfo, DocInfoError: DocInfoError \}/);
  assert.ok(src.includes('never renders a page, extracts content or runs code.'), 'the printed edge is in the shipped header');
  fs.writeFileSync('/tmp/doc-info-cli.pdf', simple());
  const want = R({ title: 'A Plain Title', creator: 'Ada Quill', pages: 1 });
  const ok = spawnSync(process.execPath, [path.join(__dirname, 'doc-info.js'), '/tmp/doc-info-cli.pdf'], { encoding: 'utf8' });
  assert.strictEqual(ok.status, 0, ok.stderr); assert.deepStrictEqual(JSON.parse(ok.stdout), want);
  assert.strictEqual(ok.stdout, JSON.stringify(want, Object.keys(want).sort()) + '\n', 'sorted-key JSON');
  fs.writeFileSync('/tmp/doc-info-bad.bin', 'not a document');
  assert.strictEqual(spawnSync(process.execPath, [path.join(__dirname, 'doc-info.js'), '/tmp/doc-info-bad.bin']).status, 3);
  assert.strictEqual(spawnSync(process.execPath, [path.join(__dirname, 'doc-info.js')]).status, 2);
  const help = spawnSync(process.execPath, [path.join(__dirname, 'doc-info.js'), '--help'], { encoding: 'utf8' });
  assert.strictEqual(help.status, 0); assert.match(help.stdout, /^usage: node doc-info.js FILE/);
  const dir = spawnSync(process.execPath, [path.join(__dirname, 'doc-info.js'), __dirname], { encoding: 'utf8' });
  assert.strictEqual(dir.status, 2); assert.match(dir.stderr, /not a file/); assert.ok(!/at /.test(dir.stderr), 'no stack trace');
});

// ===================================================================================================================
// 3. known-bad (B6), each built by mutation; every one throws DocInfoError unless it says otherwise
// ===================================================================================================================
const swap = (buf, a, b) => { const s = buf.toString('latin1'); assert.ok(s.includes(a), `mutation anchor missing: ${a}`); return Buffer.from(s.replace(a, b), 'latin1'); };
const lastXref = (buf) => +String(buf).match(/startxref\s+(\d+)\s+%%EOF\s*$/)[1];
const BAD_PDF = {
  'a newest startxref that lands on garbage': () => Buffer.concat([simple(), B('startxref\n9\n%%EOF\n')]),
  'trailing bytes past 1,024 after %%EOF': () => Buffer.concat([simple(), Buffer.alloc(1100, 0x20)]),
  'startxref landing on neither xref nor an XRef object': () => { const b = simple(); return swap(b, `startxref\n${lastXref(b)}`, `startxref\n${lastXref(b) - 7}`); },
  'a classic subsection whose count overruns its span': () => swap(simple(), 'xref\n0 5\n', 'xref\n0 9\n'),
  'an xref offset past the end': () => swap(simple(), /\n(\d{10}) 00000 n \n(?![\s\S]*\d{10} 00000 n)/.exec(String(simple()))[0], '\n9999999999 00000 n \n'),
  'a type-1 offset whose header names another object': () => { const b = simple(); const s = String(b); const off4 = s.indexOf('4 0 obj'); const off3 = s.indexOf('3 0 obj'); return swap(b, `${String(off4).padStart(10, '0')} 00000 n`, `${String(off3).padStart(10, '0')} 00000 n`); },
  'a type-1 offset whose object header names another generation': () => { const b = simple(); const off4 = String(b).indexOf('4 0 obj'); return swap(swap(b, `${String(off4).padStart(10, '0')} 00000 n`, `${String(off4).padStart(10, '0')} 00002 n`), '/Info 4 0 R', '/Info 4 2 R'); },
  'a /Prev cycle': () => { const b = simple(); const x = lastXref(b); return swap(b, '/Root 1 0 R/Info 4 0 R>>', `/Root 1 0 R/Info 4 0 R/Prev ${x}>>`); },
  '65 revisions': () => { let b = simple(); for (let i = 0; i < 65; i++) b = appendUpdate(b, [], '/Root 1 0 R/Info 4 0 R', { size: 5 }); return b; },
  '/W [0 0 0] with a nonempty body': () => swap(simple({ opt: { xref: 'stream' } }), '/W[1 4 2]', '/W[0 0 0]'),
  '/W summing past 24': () => swap(simple({ opt: { xref: 'stream' } }), '/W[1 4 2]', '/W[9 9 9]'),
  'an /Index count that overruns the decoded body': () => { const b = simple({ opt: { xref: 'stream' } }); const m = /\/Index\[0 (\d+)\]/.exec(String(b)); return swap(b, m[0], `/Index[0 ${+m[1] + 40}]`.padEnd(m[0].length, ' ')); },
  'a predictor geometry that does not divide the body': () => swap(simple({ opt: { xref: 'stream', predictor: true } }), '/Columns 7', '/Columns 6'),
  'predictor /Columns that divide the body but are not the row width': () => swap(simple({ opt: { xref: 'stream', predictor: true } }), '/Columns 7', '/Columns 3'),
  'an xref stream body longer than its /Index rows': () => { const b = simple({ opt: { xref: 'stream' } }); const m = /\/Index\[0 (\d)\]/.exec(String(b)); return swap(b, m[0], `/Index[0 ${+m[1] - 1}]`); },
  'a stream /Length that misses endstream': () => { const b = simple({ opt: { xref: 'stream' } }); const m = /\/Length (\d+)>>\nstream/.exec(String(b)); return swap(b, m[0], `/Length ${+m[1] - 3}>>\nstream`); },
  'an object stream whose /First overruns': () => objStmPdf({ first: 9999 }),
  'an object stream whose /First is in bounds but whose slot names another object': () => objStmPdf({ slotNames: 7 }),
  'an object stream index past /N': () => objStmPdf({ index: 5 }),
  'a duplicate key in a dictionary': () => buildPdf([CAT, PAGES(), PAGE, [4, '<</Title (A)/Ti#74le (B)>>']], '/Root 1 0 R/Info 4 0 R'),
  'nesting 33 deep in /Info': () => buildPdf([CAT, PAGES(), PAGE, [4, '<</Title (A)/X ' + '['.repeat(33) + ']'.repeat(33) + '>>']], '/Root 1 0 R/Info 4 0 R'),
  'an indirect /Title that points at itself': () => buildPdf([CAT, PAGES(), PAGE, [4, '<</Title 5 0 R>>'], [5, '5 0 R']], '/Root 1 0 R/Info 4 0 R'),
  'no %PDF- header in the first 1,024 bytes': () => Buffer.concat([Buffer.alloc(1100, 0x20), simple()]),
  'an /Info object number past /Size': () => swap(simple(), '/Info 4 0 R', '/Info 9 0 R'),
};
function objStmPdf(o = {}) {
  // object 4 (the /Info) lives in object stream 6 at index 0; the xref stream (7) is uncompressed
  const inner = '<</Title (In a Stream)>>'; const header = `${o.slotNames || 4} 0 `; const first = o.first || header.length;
  const s6 = stream(`/Type/ObjStm/N 1/First ${first}`, B(header + inner));
  const objects = [CAT, PAGES(), PAGE, [6, s6]];
  const parts = [B('%PDF-1.7\n')]; let pos = parts[0].length; const entries = new Map([[0, { off: 0, gen: 65535, free: true }]]);
  for (const [num, body] of objects) { const ob = obj(num, body); entries.set(num, { off: pos, gen: 0 }); parts.push(ob); pos += ob.length; }
  const x = xrefStreamObj(7, entries, pos, '/Size 8/Root 1 0 R/Info 4 0 R', { extra: [[4, { type: 2, f2: 6, f3: o.index || 0 }]] });
  return Buffer.concat([...parts, x, B(`startxref\n${pos}\n%%EOF\n`)]);
}
t('an object stream read: the good case', () => assert.strictEqual(read(objStmPdf()).title, 'In a Stream'));
t('a reference whose generation is not the entry\'s is the null object (ISO 32000-1 §7.3.10), never another object', () => {
  const b = simple(); const off4 = String(b).indexOf('4 0 obj');
  assert.deepStrictEqual(read(swap(b, `${String(off4).padStart(10, '0')} 00000 n`, `${String(off4).padStart(10, '0')} 00002 n`)), R({ pages: 1 }));
});
const FRAG = {"a newest startxref that lands on garbage": "lands on neither","trailing bytes past 1,024 after %%EOF": "no %%EOF","startxref landing on neither xref nor an XRef object": "lands on neither","a classic subsection whose count overruns its span": "overruns the file","an xref offset past the end": "offset past the end","a type-1 offset whose header names another object": "is 3 0, not 4 0","a type-1 offset whose object header names another generation": "is 4 0, not 4 2","a /Prev cycle": "/Prev cycle","65 revisions": "more than 64 revisions","/W [0 0 0] with a nonempty body": "no width","/W summing past 24": "not 0..8","an /Index count that overruns the decoded body": "not /Index rows","a predictor geometry that does not divide the body": "predictor","predictor /Columns that divide the body but are not the row width": "not the row width","an xref stream body longer than its /Index rows": "not /Index rows","a stream /Length that misses endstream": "misses endstream","an object stream whose /First overruns": "/First overruns","an object stream whose /First is in bounds but whose slot names another object": "names object 7, not 4","an object stream index past /N": "index past /N","a duplicate key in a dictionary": "duplicate key","nesting 33 deep in /Info": "nest deeper","an indirect /Title that points at itself": "reference cycle","no %PDF- header in the first 1,024 bytes": "neither a PDF","an /Info object number past /Size": "past the trailer /Size","an end record whose central directory does not end where it begins": "no end-of-central-directory","an end record whose comment length does not reach the end": "no end-of-central-directory","a directory count that lies": "fewer records","a local header whose name disagrees with the directory": "name disagrees","a directory offset that lands on another part's local header": "name disagrees","a selected payload that runs into the central directory": "runs into the central directory","a duplicate name by case": "two entries name one part","bit 3 clear with a local CRC that disagrees": "local CRC or size","bit 3 set with a descriptor whose size disagrees": "data descriptor","a stored part whose length differs from its size": "stored part whose length","a deflate payload with trailing bytes the inflater leaves": "ends before its payload","a part whose declared size is over the budget": "decode budget","a CRC-32 that does not match": "CRC-32","an unknown compression method": "compression method 12","a Zip64 end record": "Zip64","an OLE compound file": "OLE","a core relationship that targets the document body": "not a core-properties part","two core-properties relationships": "two core-properties","a target leaving the package": "leaves the package","an external target": "external properties target","a relationship naming a part not in the directory": "not in the package","an XML part declaring a DTD": "DTD","a UTF-16 XML part declaring a DTD": "DTD","&#x110000;": "not a Char","an unknown named entity": "not one of the five","a mimetype that is not ODF": "not ODF","a zip that is neither OOXML nor ODF": "neither OOXML nor ODF"};
function refuses(name, make) { const e = throwsDoc(() => read(make()), null, name); assert.ok(FRAG[name], `no pinned reason for ${name}`); assert.ok(e.message.includes(FRAG[name]), `${name}: refused for another reason: ${e.message}`); }
for (const [name, make] of Object.entries(BAD_PDF)) t(`refuses: ${name}`, () => refuses(name, make));
t('refuses a nesting bomb with code budget, a cycle with code structure', () => {
  throwsDoc(() => read(BAD_PDF['nesting 33 deep in /Info']()), 'budget');
  throwsDoc(() => read(BAD_PDF['a /Prev cycle']()), 'structure');
});

const BAD_ZIP = {
  'an end record whose central directory does not end where it begins': () => { const g = Buffer.from(docx()); g.writeUInt32LE(g.readUInt32LE(g.length - 10) - 1, g.length - 10); return g; },
  'an end record whose comment length does not reach the end': () => Buffer.concat([docx(), B('xx')]),
  'a directory count that lies': () => docx({ zip: { count: 9 } }),
  'a local header whose name disagrees with the directory': () => docx({ patch: { 2: { lname: 'docProps/kore.xml' } } }),
  'a selected payload that runs into the central directory': () => docx({ patch: { 2: { csize: 100000 } } }),
  'a directory offset that lands on another part\'s local header': () => docx({ patch: { 3: { offset: 0 } } }),
  'a duplicate name by case': () => docx({ more: [{ name: 'docProps/Core.xml', data: '<x/>' }] }),
  'bit 3 clear with a local CRC that disagrees': () => docx({ patch: { 2: { lcrc: 1234 } } }),
  'bit 3 set with a descriptor whose size disagrees': () => docx({ patch: { 2: { bit3: true, dsize: 7 } } }),
  'a stored part whose length differs from its size': () => docx({ patch: { 2: { method: 0, usize: 9, lsize: 9 } } }),
  'a deflate payload with trailing bytes the inflater leaves': () => { const data = coreXml('<dc:title>T</dc:title>'); return docx({ core: data, patch: { 2: { raw: Buffer.concat([zlib.deflateRawSync(Buffer.from(data)), Buffer.from('TRAILING')]) } } }); },
  'a part whose declared size is over the budget': () => docx({ patch: { 2: { usize: 9 * 1024 * 1024, lsize: 9 * 1024 * 1024 } } }),
  'a CRC-32 that does not match': () => docx({ patch: { 2: { crc: 77 } } }),
  'an unknown compression method': () => docx({ patch: { 2: { method: 12 } } }),
  'a Zip64 end record': () => { const b = docx(); const z64 = Buffer.alloc(20); z64.writeUInt32LE(0x07064b50, 0); return Buffer.concat([b.subarray(0, b.length - 22), z64, b.subarray(b.length - 22)]); },
  'an OLE compound file': () => Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(512)]),
  'a core relationship that targets the document body': () => docx({ coreTarget: 'word/document.xml' }),
  'two core-properties relationships': () => docx({ moreRels: [['rId9', NS.core, 'docProps/core.xml']] }),
  'a target leaving the package': () => docx({ coreTarget: '../../etc/core.xml' }),
  'an external target': () => docx({ rels: relsXml([['rId1', NS.doc, 'word/document.xml'], ['rId2', NS.core, 'http://example.com/core.xml', 'External']]) }),
  'a relationship naming a part not in the directory': () => docx({ coreTarget: 'docProps/missing.xml', ctOver: { '/docProps/missing.xml': CT_CORE } }),
  'an XML part declaring a DTD': () => docx({ core: '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]>' + coreXml('<dc:title>&a;</dc:title>').replace(/^<\?xml[^>]*\?>/, '') }),
  'a UTF-16 XML part declaring a DTD': () => docx({ core: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<?xml version="1.0" encoding="UTF-16"?><!DOCTYPE x>' + coreXml('<dc:title>t</dc:title>').replace(/^<\?xml[^>]*\?>/, ''), 'utf16le')]) }),
  '&#x110000;': () => docx({ core: coreXml('<dc:title>&#x110000;</dc:title>') }),
  'an unknown named entity': () => docx({ core: coreXml('<dc:title>&nbsp;</dc:title>') }),
  'a mimetype that is not ODF': () => zip([{ name: 'mimetype', data: 'application/x-not-odf', method: 0 }, { name: 'meta.xml', data: '<x/>' }]),
  'a zip that is neither OOXML nor ODF': () => zip([{ name: 'readme.txt', data: 'hi' }]),
};
for (const [name, make] of Object.entries(BAD_ZIP)) t(`refuses: ${name}`, () => refuses(name, make));
t('refuses: a part whose local record sits inside another selected stored part (two records overlap)', () => {
  const name = Buffer.from('docProps/app.xml');
  let appData, crc;
  for (let i = 0; ; i++) { appData = Buffer.from(appXml('<Pages>2</Pages>' + ' '.repeat(i))); crc = zlib.crc32(appData); const ok7 = (v) => [0, 8, 16, 24].every((k) => ((v >>> k) & 255) < 0x80); if (ok7(crc) && ok7(appData.length)) break; if (i > 4096) throw new Error('no ASCII-safe CRC in 4,096 tries'); }
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(appData.length, 18); lh.writeUInt32LE(appData.length, 22); lh.writeUInt16LE(name.length, 26);
  const rec = Buffer.concat([lh, name, appData]);
  const head = ctypes({ '/word/document.xml': CT_WORD, '/docProps/core.xml': CT_CORE, '/docProps/app.xml': CT_EXT }) + '<!--';
  const ct = Buffer.concat([Buffer.from(head), rec, Buffer.from('-->')]);
  const pos = 30 + '[Content_Types].xml'.length + Buffer.byteLength(head);
  const b = zip([{ name: '[Content_Types].xml', data: ct, method: 0 },
    { name: '_rels/.rels', data: relsXml([['rId1', NS.doc, 'word/document.xml'], ['rId2', NS.core, 'docProps/core.xml'], ['rId3', NS.ext, 'docProps/app.xml']]) },
    { name: 'docProps/core.xml', data: coreXml('<dc:title>A Weir</dc:title>') },
    { name: 'docProps/app.xml', data: appData, method: 0, offset: pos },
    { name: 'word/document.xml', data: '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>' }]);
  throwsDoc(() => read(b), 'structure');
});
t('an inflater that ignores maxOut and returns too much is refused on length', () => {
  const liar = { inflateRaw: (b) => Buffer.concat([zlib.inflateRawSync(b), Buffer.alloc(10)]), inflate: INFLATE.inflate };
  const e = throwsDoc(() => readDocInfo(docx(), liar), 'inflate'); assert.ok(e.message.includes('more than maxOut'), e.message);
});
t('the token budget: a cross-reference table of 1,000,001 records stops (R1.1.1)', () => {
  const rec = Buffer.from('0000000000 65535 f \n'); const n = 1000001;
  const table = Buffer.alloc(n * 20); for (let i = 0; i < n; i++) rec.copy(table, i * 20);
  const head = B('%PDF-1.7\n'); const xoff = head.length;
  const b = Buffer.concat([head, B(`xref\n0 ${n}\n`), table, B(`trailer\n<</Size ${n}>>\nstartxref\n${xoff}\n%%EOF\n`)]);
  const e = throwsDoc(() => read(b), 'budget'); assert.ok(e.message.includes('tokens'), e.message);
});
t('an inflater that throws becomes a DocInfoError with code inflate', () => {
  throwsDoc(() => readDocInfo(docx(), { inflateRaw: () => { throw new RangeError('boom'); } }), 'inflate');
});
t('the Node adapter refuses input the inflater did not consume', () => {
  const m = require(path.join(__dirname, 'doc-info.js'));
  assert.strictEqual(typeof m.nodeInflaters, 'function', 'doc-info exports nodeInflaters(zlib) for the CLI and callers');
  const raw = Buffer.concat([zlib.deflateRawSync(Buffer.from('abc')), Buffer.from('xxxxx')]);
  assert.throws(() => m.nodeInflaters(zlib).inflateRaw(raw, 100));
  assert.strictEqual(m.nodeInflaters(zlib).inflateRaw(zlib.deflateRawSync(Buffer.from('abc')), 100).toString(), 'abc');
  assert.throws(() => m.nodeInflaters(zlib).inflateRaw(zlib.deflateRawSync(Buffer.alloc(200)), 100));
});
t('a whole-read decode budget: many parts each under the cap still stop at 8 MiB in total', () => {
  const big = coreXml('<dc:title>t</dc:title><!--' + 'x'.repeat(5 * 1024 * 1024) + '-->');
  throwsDoc(() => read(docx({ core: big, app: appXml('<Pages>1</Pages><!--' + 'y'.repeat(5 * 1024 * 1024) + '-->') })), 'budget');
});
if (HAVE_FX) t('an encrypted PDF never reports a decrypted string, and the fixture\'s strings are not in the output', () => {
  const r = read(fx('memo-encrypted.pdf')); assert.strictEqual(r.title, null); assert.strictEqual(r.creator, null);
});

if (process.env.DOC_INFO_EXPORT) {   // the Plumb's known-bad half, frozen from these builders (G2; plumb/README.md)
  const dir = process.env.DOC_INFO_EXPORT; fs.mkdirSync(dir, { recursive: true }); const rows = [];
  for (const [name, make] of [...Object.entries(BAD_PDF), ...Object.entries(BAD_ZIP)]) {
    const bytes = make(); let code = null;
    try { read(bytes); } catch (e) { code = e.code; }
    const file = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.bin';
    fs.writeFileSync(path.join(dir, file), bytes);
    rows.push({ id: file.replace(/\.bin$/, ''), why: name, file, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), expect: { throws: 'DocInfoError', code, message_has: FRAG[name] } });
  }
  fs.writeFileSync(path.join(dir, 'known-bad.json'), JSON.stringify(rows, null, 1) + '\n');
  console.log(`exported ${rows.length} known-bad vectors to ${dir}`);
}
console.log(`doc-info: ${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed ? 1 : 0);
