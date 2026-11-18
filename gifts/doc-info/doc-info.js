#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// doc-info.js — a document's stated title, people and page count, read from its bytes. Zero dependencies.
//
// It reads only the metadata a document states about itself and the structure needed to find it — its title, its people and its page count — and never renders a page, extracts content or runs code.
//
//   readDocInfo(bytes, {inflate, inflateRaw}) -> {format, title, creator, last_modified_by, pages, encrypted, unreached}
//     bytes       a Uint8Array or Buffer holding the whole file (a PDF, or an OOXML or ODF zip)
//     inflate     optional (bytes, maxOut) -> bytes: zlib streams (PDF FlateDecode). Must throw past maxOut.
//     inflateRaw  optional (bytes, maxOut) -> bytes: raw deflate (zip method 8). Must throw past maxOut and on input
//                 it did not consume. Without an inflater a compressed part is named in `unreached`, never guessed.
//   nodeInflaters(zlib) -> {inflate, inflateRaw}   the Node adapters the CLI wires (Node's zlib, both rules kept)
//   format            "pdf" | "ooxml" | "odf"
//   title, creator, last_modified_by   a string or null;  pages  a safe integer >= 1 or null
//   encrypted         true | false | null (null: could not tell)
//   unreached         sorted, distinct "<field>:<reason>"; reason one of encrypted, needs-inflate, unsupported-filter,
//                     malformed, xmp-only, budget. A property the document does not state is null with no reason.
//   Anything malformed throws DocInfoError (code: format | structure | budget | inflate).
//
// Every offset, count, length and reference is checked before it is used; one budget bounds a whole read (8 MiB of
// decoded bytes, 4,096 objects, 1,000,000 tokens, nesting 32, 64 revisions; a string past 65,536 UTF-8 bytes reads
// null with <field>:budget). It never decrypts: an encrypted PDF's strings are reported as encrypted, not read.
// Blueprint: the doc-info Blueprint (v1.2). Browser: window.LoopGifts.readDocInfo.
// CLI: node doc-info.js FILE   (sorted-key JSON; exit 0, 3 on a DocInfoError, 2 on usage or a file over 256 MiB)
'use strict';

var LIMITS = { decoded: 8 * 1024 * 1024, objects: 4096, tokens: 1000000, depth: 32, revisions: 64, string: 65536, file: 256 * 1024 * 1024 };
var FIELDS = ['creator', 'last_modified_by', 'pages', 'title'];

function DocInfoError(code, message) {
  var e = new Error(message);
  Object.setPrototypeOf(e, DocInfoError.prototype);
  e.name = 'DocInfoError';
  e.code = code;
  return e;
}
DocInfoError.prototype = Object.create(Error.prototype);
DocInfoError.prototype.constructor = DocInfoError;
function fail(code, msg) { throw DocInfoError(code, msg); }
function Blocked(reason) { this.reason = reason; }   // internal: a field cannot be read (needs-inflate, encrypted, ...)

function toU8(b) {
  if (b instanceof Uint8Array) return b;
  if (b && b.buffer instanceof ArrayBuffer) return new Uint8Array(b.buffer, b.byteOffset || 0, b.byteLength);
  if (b instanceof ArrayBuffer) return new Uint8Array(b);
  fail('format', 'bytes must be a Uint8Array, a Buffer or an ArrayBuffer');
}

// ---- the budget ------------------------------------------------------------------------------------------------------
function Budget() { this.decoded = 0; this.objects = 0; this.tokens = 0; }
Budget.prototype.charge = function (kind, n) {
  this[kind] += n;
  if (this[kind] > LIMITS[kind]) fail('budget', 'the read budget for ' + kind + ' is spent (' + LIMITS[kind] + ')');
};
Budget.prototype.room = function () { return LIMITS.decoded - this.decoded; };

function callInflate(fn, data, maxOut, budget) {
  var out;
  if (maxOut > budget.room()) fail('budget', 'a part declares more than the decode budget left (' + budget.room() + ' bytes)');
  try { out = fn(data, Math.max(1, maxOut)); } catch (e) {
    if (e && e.code === 'ERR_BUFFER_TOO_LARGE') fail('budget', 'a part inflates past its bound (' + maxOut + ' bytes)');
    fail('inflate', 'the inflater failed: ' + (e && e.message ? e.message : String(e)));
  }
  out = toU8(out);
  if (out.length > maxOut) fail('inflate', 'the inflater returned more than maxOut (' + out.length + ' > ' + maxOut + ')');
  budget.charge('decoded', out.length);
  return out;
}

// ---- text --------------------------------------------------------------------------------------------------------------
function utf8(bytes, strict) {
  if (typeof TextDecoder !== 'undefined') {
    try { return new TextDecoder('utf-8', { fatal: !!strict }).decode(bytes); } catch (_) { fail('structure', 'invalid UTF-8'); }
  }
  var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  try { return decodeURIComponent(escape(s)); } catch (_) { if (strict) fail('structure', 'invalid UTF-8'); return s; }
}
function utf16(bytes, be) {
  if (bytes.length % 2) fail('structure', 'a UTF-16 string of odd length');
  var s = '';
  for (var i = 0; i < bytes.length; i += 2) s += String.fromCharCode(be ? (bytes[i] << 8) | bytes[i + 1] : bytes[i] | (bytes[i + 1] << 8));
  return s;
}
function utf8Length(s) { var n = 0; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xd800 && c <= 0xdbff) ? (i++, 4) : 3; } return n; }
function latin1(bytes, a, b) { var s = ''; for (var i = a; i < b; i++) s += String.fromCharCode(bytes[i]); return s; }

// ---- the result --------------------------------------------------------------------------------------------------------
function Result(format) {
  this.format = format; this.title = null; this.creator = null; this.last_modified_by = null; this.pages = null;
  this.encrypted = false; this.why = {};
}
Result.prototype.block = function (fields, reason) {
  for (var i = 0; i < fields.length; i++) { this[fields[i]] = null; this.why[fields[i] + ':' + reason] = true; }
};
Result.prototype.text = function (field, s) {      // a stated text value: trimmed, empty -> null, bounded
  if (s === null || s === undefined) { this[field] = null; return; }
  s = s.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
  if (!s) { this[field] = null; return; }
  if (utf8Length(s) > LIMITS.string) { this.block([field], 'budget'); return; }
  this[field] = s;
};
Result.prototype.out = function () {
  return { format: this.format, title: this.title, creator: this.creator, last_modified_by: this.last_modified_by,
    pages: this.pages, encrypted: this.encrypted, unreached: Object.keys(this.why).sort() };
};
function countOf(s) {  // a stated count, text or number -> safe integer >= 1, else undefined (malformed)
  if (typeof s === 'number') return Number.isSafeInteger(s) && s >= 1 ? s : undefined;
  if (typeof s !== 'string' || !/^[0-9]{1,16}$/.test(s)) return undefined;
  var n = Number(s); return Number.isSafeInteger(n) && n >= 1 ? n : undefined;
}

// =========================================================================================================================
// PDF
// =========================================================================================================================
var PDFDOC = { 0x18: 0x02d8, 0x19: 0x02c7, 0x1a: 0x02c6, 0x1b: 0x02d9, 0x1c: 0x02dd, 0x1d: 0x02db, 0x1e: 0x02da, 0x1f: 0x02dc,
  0x80: 0x2022, 0x81: 0x2020, 0x82: 0x2021, 0x83: 0x2026, 0x84: 0x2014, 0x85: 0x2013, 0x86: 0x0192, 0x87: 0x2044, 0x88: 0x2039,
  0x89: 0x203a, 0x8a: 0x2212, 0x8b: 0x2030, 0x8c: 0x201e, 0x8d: 0x201c, 0x8e: 0x201d, 0x8f: 0x2018, 0x90: 0x2019, 0x91: 0x201a,
  0x92: 0x2122, 0x93: 0xfb01, 0x94: 0xfb02, 0x95: 0x0141, 0x96: 0x0152, 0x97: 0x0160, 0x98: 0x0178, 0x99: 0x017d, 0x9a: 0x0131,
  0x9b: 0x0142, 0x9c: 0x0153, 0x9d: 0x0161, 0x9e: 0x017e, 0x9f: 0xfffd, 0x7f: 0xfffd, 0xa0: 0x20ac, 0xad: 0xfffd };
function pdfText(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return utf16(bytes.subarray(2), true);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return utf8(bytes.subarray(3), true);
  var s = '';
  for (var i = 0; i < bytes.length; i++) { var c = bytes[i]; s += String.fromCharCode(PDFDOC[c] !== undefined ? PDFDOC[c] : c); }
  return s;
}

var WS = { 0: 1, 9: 1, 10: 1, 12: 1, 13: 1, 32: 1 };
var DELIM = { 40: 1, 41: 1, 60: 1, 62: 1, 91: 1, 93: 1, 123: 1, 125: 1, 47: 1, 37: 1 };
function isDigit(c) { return c >= 48 && c <= 57; }
function hexVal(c) { return c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1; }

// A lexer over one span of bytes. Values: {t:'n', v, int} {t:'name', v} {t:'str', b} {t:'arr', v} {t:'dict', v:Map}
// {t:'ref', num, gen} {t:'bool', v} {t:'null'} {t:'kw', v}.
function Lexer(buf, pos, end, budget) { this.b = buf; this.p = pos; this.end = end; this.budget = budget; }
Lexer.prototype.ws = function () {
  var b = this.b;
  while (this.p < this.end) {
    var c = b[this.p];
    if (WS[c]) { this.p++; continue; }
    if (c === 37) { while (this.p < this.end && b[this.p] !== 10 && b[this.p] !== 13) this.p++; continue; }
    break;
  }
};
Lexer.prototype.regular = function () {
  var a = this.p; while (this.p < this.end && !WS[this.b[this.p]] && !DELIM[this.b[this.p]]) this.p++;
  return latin1(this.b, a, this.p);
};
Lexer.prototype.token = function () {   // a primitive token or a structural mark: '[', ']', '<<', '>>'
  this.ws();
  if (this.p >= this.end) fail('structure', 'unexpected end of a PDF object');
  this.budget.charge('tokens', 1);
  var b = this.b, c = b[this.p];
  if (c === 91 || c === 93) { this.p++; return { t: c === 91 ? '[' : ']' }; }
  if (c === 60 && b[this.p + 1] === 60) { this.p += 2; return { t: '<<' }; }
  if (c === 62 && b[this.p + 1] === 62) { this.p += 2; return { t: '>>' }; }
  if (c === 40) return this.literal();
  if (c === 60) return this.hex();
  if (c === 47) return this.name();
  if (c === 123 || c === 125 || c === 41 || c === 62) fail('structure', 'a stray delimiter in a PDF object');
  var word = this.regular();
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
    var isInt = /^[+-]?\d+$/.test(word); var v = Number(word);
    return { t: 'n', v: v, int: isInt && Number.isSafeInteger(v), text: word };
  }
  if (word === 'true' || word === 'false') return { t: 'bool', v: word === 'true' };
  if (word === 'null') return { t: 'null' };
  if (!word) fail('structure', 'an empty PDF token');
  return { t: 'kw', v: word };
};
Lexer.prototype.name = function () {
  this.p++; var out = [];
  while (this.p < this.end && !WS[this.b[this.p]] && !DELIM[this.b[this.p]]) {
    var c = this.b[this.p];
    if (c === 35) {
      var h = hexVal(this.b[this.p + 1]), l = hexVal(this.b[this.p + 2]);
      if (h < 0 || l < 0) fail('structure', 'a bad #xx escape in a name');
      out.push(h * 16 + l); this.p += 3;
    } else { out.push(c); this.p++; }
  }
  return { t: 'name', v: utf8(Uint8Array.from(out), false) };
};
Lexer.prototype.literal = function () {
  var b = this.b, out = [], depth = 1; this.p++;
  while (this.p < this.end) {
    var c = b[this.p++];
    if (c === 92) {
      if (this.p >= this.end) break;
      var e = b[this.p++];
      if (e === 110) out.push(10); else if (e === 114) out.push(13); else if (e === 116) out.push(9);
      else if (e === 98) out.push(8); else if (e === 102) out.push(12);
      else if (e === 13) { if (b[this.p] === 10) this.p++; }
      else if (e === 10) { /* line continuation */ }
      else if (e >= 48 && e <= 55) {
        var v = e - 48;
        for (var k = 0; k < 2 && this.p < this.end && b[this.p] >= 48 && b[this.p] <= 55; k++) v = v * 8 + (b[this.p++] - 48);
        out.push(v & 255);
      } else out.push(e);
    } else if (c === 40) { depth++; out.push(c); }
    else if (c === 41) { if (--depth === 0) return { t: 'str', b: Uint8Array.from(out) }; out.push(c); }
    else if (c === 13) { if (b[this.p] === 10) this.p++; out.push(10); }
    else out.push(c);
  }
  fail('structure', 'an unterminated literal string');
};
Lexer.prototype.hex = function () {
  var b = this.b, digits = []; this.p++;
  while (this.p < this.end) {
    var c = b[this.p++];
    if (c === 62) {
      if (digits.length % 2) digits.push(0);
      var out = new Uint8Array(digits.length / 2);
      for (var i = 0; i < out.length; i++) out[i] = digits[2 * i] * 16 + digits[2 * i + 1];
      return { t: 'str', b: out };
    }
    if (WS[c]) continue;
    var h = hexVal(c); if (h < 0) fail('structure', 'a bad hex string');
    digits.push(h);
  }
  fail('structure', 'an unterminated hex string');
};
Lexer.prototype.object = function (depth) {   // one whole object (arrays and dictionaries recursively), refs folded
  if (depth > LIMITS.depth) fail('budget', 'objects nest deeper than ' + LIMITS.depth);
  var tok = this.token();
  if (tok.t === 'n' && tok.int && tok.v >= 0) {           // N G R ?
    var save = this.p; this.ws();
    if (this.p < this.end && isDigit(this.b[this.p])) {
      var t2 = this.token();
      if (t2.t === 'n' && t2.int && t2.v >= 0) {
        this.ws();
        if (this.p < this.end && this.b[this.p] === 82 && (this.p + 1 >= this.end || WS[this.b[this.p + 1]] || DELIM[this.b[this.p + 1]])) {
          this.p++; return { t: 'ref', num: tok.v, gen: t2.v };
        }
      }
    }
    this.p = save; return tok;
  }
  if (tok.t === '[') {
    var arr = [];
    for (;;) {
      this.ws(); if (this.p < this.end && this.b[this.p] === 93) { this.p++; return { t: 'arr', v: arr }; }
      arr.push(this.object(depth + 1));
    }
  }
  if (tok.t === '<<') {
    var map = new Map();
    for (;;) {
      this.ws();
      if (this.p + 1 < this.end && this.b[this.p] === 62 && this.b[this.p + 1] === 62) { this.p += 2; return { t: 'dict', v: map }; }
      var key = this.token();
      if (key.t !== 'name') fail('structure', 'a dictionary key that is not a name');
      if (map.has(key.v)) fail('structure', 'a duplicate key /' + key.v + ' in one dictionary');
      map.set(key.v, this.object(depth + 1));
    }
  }
  if (tok.t === ']' || tok.t === '>>') fail('structure', 'an unbalanced ' + tok.t);
  return tok;
};
Lexer.prototype.expectKw = function (kw) { var t = this.token(); if (t.t !== 'kw' || t.v !== kw) fail('structure', 'expected ' + kw); };
Lexer.prototype.int = function () { var t = this.token(); if (t.t !== 'n' || !t.int || t.v < 0) fail('structure', 'expected a non-negative integer'); return t.v; };

function lastIndexOf(b, s, from, floor) {
  var n = s.length; for (var i = Math.min(from, b.length - n); i >= floor; i--) {
    var k = 0; while (k < n && b[i + k] === s.charCodeAt(k)) k++;
    if (k === n) return i;
  }
  return -1;
}
function startsAt(b, p, s) { if (p < 0 || p + s.length > b.length) return false; for (var k = 0; k < s.length; k++) if (b[p + k] !== s.charCodeAt(k)) return false; return true; }
function eol(b, p) { if (b[p] === 13 && b[p + 1] === 10) return p + 2; if (b[p] === 10 || b[p] === 13) return p + 1; return p; }
function dget(d, k) { return d && d.t === 'dict' ? d.v.get(k) : undefined; }
function intOf(v) { return v && v.t === 'n' && v.int ? v.v : undefined; }

function Pdf(b, inf, budget) {
  this.b = b; this.inf = inf; this.budget = budget;
  this.entries = new Map(); this.cache = new Map(); this.trailer = null; this.size = 0; this.encrypted = false;
}
// The cross-reference chain (R1.1.2, R1.2.2): the newest revision first; within a revision the companion stream of a
// hybrid file applies first and a table's free entry yields to it; across revisions the newest entry wins.
Pdf.prototype.chain = function () {
  var b = this.b, tail = Math.max(0, b.length - 1024 - 5);
  var eof = lastIndexOf(b, '%%EOF', b.length - 5, tail);
  if (eof < 0) fail('structure', 'no %%EOF in the last 1,024 bytes');
  var sx = lastIndexOf(b, 'startxref', eof - 9, Math.max(0, eof - 2048));
  if (sx < 0) fail('structure', 'no startxref before the final %%EOF');
  var lx = new Lexer(b, sx + 9, eof, this.budget);
  var off = lx.int(), seen = {}, revs = 0, blocked = null;
  while (off !== undefined) {
    if (seen[off]) fail('structure', 'a /Prev cycle at offset ' + off);
    seen[off] = true;
    if (++revs > LIMITS.revisions) fail('budget', 'more than ' + LIMITS.revisions + ' revisions');
    if (off >= b.length) fail('structure', 'an xref offset past the end');
    var rev = new Map(), trailer, prev;
    if (startsAt(b, off, 'xref')) {
      var table = this.table(off + 4);
      trailer = table.trailer;
      var xs = intOf(dget(trailer, 'XRefStm'));
      if (xs !== undefined) {
        var comp = this.xrefStream(xs, true);
        if (comp.blocked) blocked = blocked || comp.blocked; else comp.rows.forEach(function (v, k) { rev.set(k, v); });
      }
      table.rows.forEach(function (v, k) { if (!rev.has(k) || !v.free) rev.set(k, v); });
    } else {
      var st = this.xrefStream(off, false);
      trailer = st.dict;
      if (st.blocked) blocked = blocked || st.blocked; else rev = st.rows;
    }
    if (!this.trailer) { this.trailer = trailer; this.size = intOf(dget(trailer, 'Size')); if (this.size === undefined) fail('structure', 'a trailer with no /Size'); }
    var self = this; rev.forEach(function (v, k) { if (!self.entries.has(k)) self.entries.set(k, v); });
    prev = dget(trailer, 'Prev');
    if (prev !== undefined && intOf(prev) === undefined) fail('structure', 'a /Prev that is not an offset');
    off = intOf(prev);
  }
  this.encrypted = dget(this.trailer, 'Encrypt') !== undefined && dget(this.trailer, 'Encrypt').t !== 'null';
  if (blocked) throw new Blocked(blocked);
};
Pdf.prototype.table = function (p) {
  var b = this.b, rows = new Map(), lx = new Lexer(b, p, b.length, this.budget);
  for (;;) {
    lx.ws();
    if (startsAt(b, lx.p, 'trailer')) { lx.p += 7; break; }
    var start = lx.int(), count = lx.int();
    var q = lx.p; while (b[q] === 32) q++;
    q = eol(b, q);
    if (q === lx.p) fail('structure', 'a subsection header not ended by a line');
    if (!Number.isSafeInteger(start + count) || q + count * 20 > b.length) fail('structure', 'a subsection whose count overruns the file');
    this.budget.charge('tokens', count);
    for (var i = 0; i < count; i++) {
      var r = q + i * 20, s = latin1(b, r, r + 20);
      var m = /^(\d{10}) (\d{5}) ([nf])(?: \r| \n|\r\n)$/.exec(s);
      if (!m) fail('structure', 'a malformed cross-reference record');
      rows.set(start + i, m[3] === 'f' ? { free: true, gen: +m[2] } : { type: 1, off: +m[1], gen: +m[2] });
    }
    lx.p = q + count * 20;
  }
  var trailer = lx.object(0);
  if (trailer.t !== 'dict') fail('structure', 'a trailer that is not a dictionary');
  return { rows: rows, trailer: trailer };
};
Pdf.prototype.rawObject = function (off, num, gen) {   // `N G obj` at off -> {value, stream?:{start, length}}
  var b = this.b;
  if (!Number.isSafeInteger(off) || off < 0 || off >= b.length) fail('structure', 'an object offset past the end');
  var lx = new Lexer(b, off, b.length, this.budget);
  var n = lx.int(), g = lx.int(); lx.expectKw('obj');
  if ((num !== undefined && n !== num) || (gen !== undefined && g !== gen)) fail('structure', 'the object at ' + off + ' is ' + n + ' ' + g + ', not ' + num + ' ' + gen);
  var value = lx.object(0);
  lx.ws();
  if (value.t === 'dict' && startsAt(b, lx.p, 'stream')) {
    var s = lx.p + 6;
    if (b[s] === 13 && b[s + 1] === 10) s += 2; else if (b[s] === 10) s += 1; else fail('structure', 'stream not followed by an end of line');
    return { num: n, value: value, stream: { start: s } };
  }
  return { num: n, value: value };
};
Pdf.prototype.streamBytes = function (o, length) {
  var b = this.b, s = o.stream.start;
  if (!Number.isSafeInteger(length) || length < 0 || s + length > b.length) fail('structure', 'a stream /Length past the end');
  var e = s + length, k = e;
  if (b[k] === 13 && b[k + 1] === 10) k += 2; else if (b[k] === 10 || b[k] === 13) k += 1;
  if (!startsAt(b, k, 'endstream') && !startsAt(b, e, 'endstream')) fail('structure', 'a stream /Length that misses endstream');
  return b.subarray(s, e);
};
Pdf.prototype.decode = function (dict, data, columns) {   // -> bytes, or throws Blocked
  var f = dget(dict, 'Filter'), parms = dget(dict, 'DecodeParms');
  if (f && f.t === 'arr') { if (f.v.length > 1) throw new Blocked('unsupported-filter'); f = f.v[0]; }
  if (parms && parms.t === 'arr') parms = parms.v[0];
  if (f === undefined || f.t === 'null') return data;
  if (f.t !== 'name' || f.v !== 'FlateDecode') throw new Blocked('unsupported-filter');
  var pred = 1, cols = 1, colors = 1, bpc = 8;
  if (parms && parms.t === 'dict') {
    var pv = intOf(dget(parms, 'Predictor')); if (pv !== undefined) pred = pv;
    var cv = intOf(dget(parms, 'Columns')); if (cv !== undefined) cols = cv;
    var co = intOf(dget(parms, 'Colors')); if (co !== undefined) colors = co;
    var bp = intOf(dget(parms, 'BitsPerComponent')); if (bp !== undefined) bpc = bp;
  } else if (parms !== undefined && parms.t !== 'null') throw new Blocked('unsupported-filter');
  if (!(pred === 1 || (pred >= 10 && pred <= 15)) || colors !== 1 || bpc !== 8) throw new Blocked('unsupported-filter');
  if (!this.inf.inflate) throw new Blocked('needs-inflate');
  var out = callInflate(this.inf.inflate, data, this.budget.room(), this.budget);
  if (pred === 1) return out;
  if (columns !== undefined && cols !== columns) fail('structure', 'a predictor /Columns that is not the row width');
  if (cols < 1 || out.length % (cols + 1)) fail('structure', 'a predictor row geometry that does not divide the body');
  var rows = out.length / (cols + 1), res = new Uint8Array(rows * cols);
  for (var r = 0; r < rows; r++) {
    var tag = out[r * (cols + 1)];
    for (var c = 0; c < cols; c++) {
      var x = out[r * (cols + 1) + 1 + c], a = c ? res[r * cols + c - 1] : 0, up = r ? res[(r - 1) * cols + c] : 0, ul = r && c ? res[(r - 1) * cols + c - 1] : 0, v;
      if (tag === 0) v = x; else if (tag === 1) v = x + a; else if (tag === 2) v = x + up; else if (tag === 3) v = x + ((a + up) >> 1);
      else if (tag === 4) { var p = a + up - ul, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - ul); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? up : ul); }
      else fail('structure', 'an unknown PNG predictor tag');
      res[r * cols + c] = v & 255;
    }
  }
  return res;
};
Pdf.prototype.xrefStream = function (off, companion) {
  var o;
  try { o = this.rawObject(off); } catch (e) {
    if (e instanceof DocInfoError && e.code === 'structure') fail('structure', companion ? 'an /XRefStm that is not an xref stream' : 'startxref lands on neither xref nor an xref stream');
    throw e;
  }
  var d = o.value;
  var ty = dget(d, 'Type');
  if (!o.stream || !ty || ty.t !== 'name' || ty.v !== 'XRef') fail('structure', companion ? 'an /XRefStm that is not an xref stream' : 'startxref lands on neither xref nor an xref stream');
  var len = intOf(dget(d, 'Length')); if (len === undefined) fail('structure', 'an xref stream /Length that is not a direct integer');
  var raw = this.streamBytes(o, len);
  var w = dget(d, 'W'), size = intOf(dget(d, 'Size'));
  if (!w || w.t !== 'arr' || w.v.length !== 3 || size === undefined) fail('structure', 'an xref stream without a good /W and /Size');
  var W = w.v.map(function (x) { var n = intOf(x); if (n === undefined || n < 0 || n > 8) fail('structure', 'a /W field that is not 0..8'); return n; });
  var width = W[0] + W[1] + W[2]; if (width < 1) fail('structure', 'a /W with no width');
  var idx = dget(d, 'Index'), pairs = [];
  if (idx === undefined) pairs = [0, size];
  else { if (idx.t !== 'arr' || idx.v.length % 2) fail('structure', 'a bad /Index'); pairs = idx.v.map(function (x) { var n = intOf(x); if (n === undefined || n < 0) fail('structure', 'a bad /Index entry'); return n; }); }
  var total = 0; for (var i = 1; i < pairs.length; i += 2) { total += pairs[i]; if (!Number.isSafeInteger(total) || !Number.isSafeInteger(pairs[i - 1] + pairs[i])) fail('structure', 'an /Index that overflows'); }
  var data;
  try { data = this.decode(d, raw, width); } catch (e) { if (e instanceof Blocked) return { dict: d, blocked: e.reason }; throw e; }
  if (data.length !== total * width) fail('structure', 'an xref stream whose body is not /Index rows of /W bytes');
  this.budget.charge('tokens', total);
  var rows = new Map(), p = 0;
  function field(n, dflt) { if (!n) return dflt; var v = 0; for (var k = 0; k < n; k++) v = v * 256 + data[p++]; return v; }
  for (var j = 0; j < pairs.length; j += 2) {
    for (var k = 0; k < pairs[j + 1]; k++) {
      var t = field(W[0], 1), f2 = field(W[1], 0), f3 = field(W[2], 0), num = pairs[j] + k;
      if (t === 0) rows.set(num, { free: true, gen: f3 });
      else if (t === 1) rows.set(num, { type: 1, off: f2, gen: f3 });
      else if (t === 2) rows.set(num, { type: 2, stm: f2, idx: f3 });
      // other types are reserved: treated as the null object (ISO 32000-1 §7.5.8.3)
    }
  }
  return { dict: d, rows: rows };
};
Pdf.prototype.get = function (num, gen) {   // the object value for N G, resolved through the xref; throws Blocked
  if (num >= this.size) fail('structure', 'object ' + num + ' is past the trailer /Size ' + this.size);
  var key = num + ' ' + gen;
  if (this.cache.has(key)) return this.cache.get(key);
  this.budget.charge('objects', 1);
  var e = this.entries.get(num), v;
  if (!e || e.free) v = { t: 'null' };
  else if (e.type === 1) {
    if (e.gen !== gen) v = { t: 'null' };
    else {
      var o = this.rawObject(e.off, num, gen);
      if (o.stream) {
        var L = dget(o.value, 'Length');
        var len = L && L.t === 'ref' ? intOf(this.resolve(L, 1)) : intOf(L);
        this.streamBytes(o, len);
        v = { t: 'stream', dict: o.value, o: o, len: len };
      } else v = o.value;
    }
  } else {
    if (gen !== 0) v = { t: 'null' };
    else v = this.fromObjStm(num, e.stm, e.idx);
  }
  this.cache.set(key, v);
  return v;
};
Pdf.prototype.fromObjStm = function (num, stm, idx) {
  if (this.encrypted) throw new Blocked('encrypted');
  var s = this.get(stm, 0);
  if (s.t !== 'stream') fail('structure', 'an object stream that is not a stream');
  var ty = dget(s.dict, 'Type');
  if (!ty || ty.t !== 'name' || ty.v !== 'ObjStm') fail('structure', 'an object stream without /Type /ObjStm');
  if (!s.decoded) s.decoded = this.decode(s.dict, this.streamBytes(s.o, s.len));
  var data = s.decoded, n = intOf(dget(s.dict, 'N')), first = intOf(dget(s.dict, 'First'));
  if (n === undefined || first === undefined || first > data.length) fail('structure', 'an object stream whose /N or /First overruns');
  if (idx >= n) fail('structure', 'an object stream index past /N');
  var lx = new Lexer(data, 0, first, this.budget), pairs = [];
  for (var i = 0; i < n; i++) { var on = lx.int(), oo = lx.int(); if (first + oo > data.length || (i && oo < pairs[i - 1][1])) fail('structure', 'an object stream offset out of order or past the end'); pairs.push([on, oo]); }
  if (pairs[idx][0] !== num) fail('structure', 'object stream slot ' + idx + ' names object ' + pairs[idx][0] + ', not ' + num);
  var a = first + pairs[idx][1], z = idx + 1 < n ? first + pairs[idx + 1][1] : data.length;
  return new Lexer(data, a, z, this.budget).object(0);
};
Pdf.prototype.resolve = function (v, depth) {
  var seen = {};
  for (var hops = 0; v && v.t === 'ref'; hops++) {
    var k = v.num + ' ' + v.gen;
    if (seen[k]) fail('structure', 'a reference cycle at ' + k);
    if (hops > LIMITS.depth) fail('budget', 'a reference chain longer than ' + LIMITS.depth);
    seen[k] = true; v = this.get(v.num, v.gen);
  }
  return v;
};

function readPdf(b, inf, budget) {
  var r = new Result('pdf'), pdf = new Pdf(b, inf, budget);
  try { pdf.chain(); } catch (e) {
    if (!(e instanceof Blocked)) throw e;
    r.encrypted = pdf.encrypted; r.block(['creator', 'pages', 'title'], e.reason); return r.out();
  }
  r.encrypted = pdf.encrypted;
  var t = pdf.trailer, root = null;
  // the page count (R1.2.4, R1.2.6)
  try {
    root = pdf.resolve(dget(t, 'Root'), 0);
    if (!root || root.t !== 'dict') fail('structure', 'a /Root that is not a dictionary');
    var pages = pdf.resolve(dget(root, 'Pages'), 0);
    var count = pages && pages.t === 'dict' ? pdf.resolve(dget(pages, 'Count'), 0) : undefined;
    var n = count && count.t === 'n' && count.int ? countOf(count.v) : undefined;
    if (n === undefined) r.block(['pages'], 'malformed'); else r.pages = n;
  } catch (e) { if (!(e instanceof Blocked)) throw e; r.block(['pages'], e.reason); root = root && root.t === 'dict' ? root : null; }
  // the information dictionary
  if (pdf.encrypted) { r.block(['creator', 'title'], 'encrypted'); return r.out(); }
  try {
    var iv = dget(t, 'Info'), info = null;
    if (iv !== undefined && iv.t !== 'null') {
      if (iv.t !== 'ref') { r.block(['creator', 'title'], 'malformed'); return r.out(); }
      info = pdf.resolve(iv, 0);
      if (info.t === 'null') info = null;
      else if (info.t !== 'dict') { r.block(['creator', 'title'], 'malformed'); return r.out(); }
    }
    var pairs = [['title', 'Title'], ['creator', 'Author']];
    for (var i = 0; i < pairs.length; i++) {
      var v = info ? pdf.resolve(dget(info, pairs[i][1]), 0) : undefined;
      if (v === undefined || v.t === 'null') continue;
      if (v.t !== 'str') { r.block([pairs[i][0]], 'malformed'); continue; }
      r.text(pairs[i][0], pdfText(v.b));
    }
    if (r.title === null && !r.why['title:budget'] && !r.why['title:malformed'] && root && dget(root, 'Metadata') !== undefined) r.block(['title'], 'xmp-only');
  } catch (e) { if (!(e instanceof Blocked)) throw e; r.block(['creator', 'title'], e.reason); }
  return r.out();
}

// =========================================================================================================================
// Zip
// =========================================================================================================================
var CRC = (function () { var t = new Int32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(b) { var c = -1; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function u16(b, p) { return b[p] | (b[p + 1] << 8); }
function u32(b, p) { return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16)) + b[p + 3] * 0x1000000; }
function partKey(name) {   // a logical part name: percent-decoded, case-folded (OPC part names compare that way)
  var s = name;
  try { s = decodeURIComponent(name.replace(/%(?![0-9a-fA-F]{2})/g, '%25')); } catch (_) { fail('structure', 'a bad percent escape in a part name'); }
  return s.replace(/^\/+/, '').toLowerCase();
}

function Zip(b, inf, budget) {
  this.b = b; this.inf = inf; this.budget = budget; this.read = [];
  var floor = Math.max(0, b.length - 65557), found = [];
  for (var p = b.length - 22; p >= floor; p--) {
    if (u32(b, p) !== 0x06054b50) continue;
    var cl = u16(b, p + 20), dn = u16(b, p + 4), dcd = u16(b, p + 6), en = u16(b, p + 8), tot = u16(b, p + 10), cs = u32(b, p + 12), co = u32(b, p + 16);
    if (p + 22 + cl !== b.length || dn !== 0 || dcd !== 0 || en !== tot) continue;
    if (p >= 20 && u32(b, p - 20) === 0x07064b50) fail('format', 'a Zip64 archive is not read');
    if (tot === 0xffff || cs === 0xffffffff || co === 0xffffffff) fail('format', 'a Zip64 archive is not read');
    if (co + cs !== p) continue;
    found.push({ p: p, count: tot, size: cs, off: co });
  }
  if (!found.length) fail('structure', 'no end-of-central-directory record that fits');
  if (found.length > 1) fail('structure', 'more than one end-of-central-directory record fits');
  var e = found[0]; this.cdOff = e.off; this.entries = []; this.byKey = {};
  var q = e.off, end = e.off + e.size;
  this.budget.charge('tokens', e.count);
  for (var i = 0; i < e.count; i++) {
    if (q + 46 > end || u32(b, q) !== 0x02014b50) fail('structure', 'the central directory holds fewer records than it declares');
    var flags = u16(b, q + 8), nl = u16(b, q + 28), xl = u16(b, q + 30), kl = u16(b, q + 32);
    if (q + 46 + nl + xl + kl > end) fail('structure', 'a directory record past the directory');
    var nameBytes = b.subarray(q + 46, q + 46 + nl);
    var ent = { name: (flags & 0x800) ? utf8(nameBytes, true) : latin1(nameBytes, 0, nameBytes.length), nameBytes: nameBytes, flags: flags,
      method: u16(b, q + 10), crc: u32(b, q + 16), csize: u32(b, q + 20), usize: u32(b, q + 24), off: u32(b, q + 42) };
    if (ent.csize === 0xffffffff || ent.usize === 0xffffffff || ent.off === 0xffffffff) fail('format', 'a Zip64 entry is not read');
    var key = partKey(ent.name);
    if (this.byKey[key]) fail('structure', 'two entries name one part: ' + ent.name);
    this.byKey[key] = ent; this.entries.push(ent);
    q += 46 + nl + xl + kl;
  }
  if (q !== end) fail('structure', 'the central directory holds more than it declares');
}
Zip.prototype.has = function (name) { return !!this.byKey[partKey(name)]; };
Zip.prototype.part = function (name) {   // the part's decoded bytes; throws Blocked('needs-inflate')
  var b = this.b, e = this.byKey[partKey(name)];
  if (!e) fail('structure', 'no part ' + name);
  var p = e.off;
  if (p + 30 > this.cdOff || u32(b, p) !== 0x04034b50) fail('structure', 'no local header for ' + e.name);
  var lf = u16(b, p + 6), lm = u16(b, p + 8), nl = u16(b, p + 26), xl = u16(b, p + 28);
  var ds = p + 30 + nl + xl, de = ds + e.csize;
  if (ds > this.cdOff || de > this.cdOff) fail('structure', 'the payload of ' + e.name + ' runs into the central directory');
  var ln = b.subarray(p + 30, p + 30 + nl);
  if (ln.length !== e.nameBytes.length || ln.some(function (c, i) { return c !== e.nameBytes[i]; })) fail('structure', 'a local header whose name disagrees with the directory: ' + e.name);
  if (lm !== e.method || (lf & 8) !== (e.flags & 8)) fail('structure', 'a local header that disagrees with the directory: ' + e.name);
  var recEnd = de;
  if (!(e.flags & 8)) {
    if (u32(b, p + 14) !== e.crc || u32(b, p + 18) !== e.csize || u32(b, p + 22) !== e.usize) fail('structure', 'a local CRC or size that disagrees with the directory: ' + e.name);
  } else {
    var ok = false;
    var tries = u32(b, de) === 0x08074b50 ? [4, 0] : [0];
    for (var t = 0; t < tries.length && !ok; t++) {
      var s = de + tries[t];
      if (s + 12 <= this.cdOff && u32(b, s) === e.crc && u32(b, s + 4) === e.csize && u32(b, s + 8) === e.usize) { ok = true; recEnd = s + 12; }
    }
    if (!ok) fail('structure', 'a data descriptor that disagrees with the directory: ' + e.name);
  }
  for (var i = 0; i < this.read.length; i++) if (p < this.read[i][1] && this.read[i][0] < recEnd) fail('structure', 'two selected records overlap');
  this.read.push([p, recEnd]);
  if (e.usize > this.budget.room()) fail('budget', e.name + ' declares more than the decode budget left');
  var data = b.subarray(ds, de), out;
  if (e.method === 0) {
    if (e.csize !== e.usize) fail('structure', 'a stored part whose length is not its size: ' + e.name);
    this.budget.charge('decoded', e.usize); out = data;
  } else if (e.method === 8) {
    if (!this.inf.inflateRaw) throw new Blocked('needs-inflate');
    out = callInflate(this.inf.inflateRaw, data, e.usize, this.budget);
    if (out.length !== e.usize) fail('structure', 'a part that inflates to another size than it declares: ' + e.name);
  } else fail('structure', 'compression method ' + e.method + ' is not read');
  if (crc32(out) !== e.crc) fail('structure', 'a CRC-32 that does not match: ' + e.name);
  return out;
};

// ---- XML: a bounded tokenizer, never a general parser (R1.3.4, R1.2.5) ----------------------------------------------------
var XML_NS = 'http://www.w3.org/XML/1998/namespace';
function xmlChar(cp) { return cp === 9 || cp === 10 || cp === 13 || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff); }
function xmlRefs(s) {
  return s.replace(/&([^;&]*);?/g, function (m, body) {
    if (m[m.length - 1] !== ';') fail('structure', 'an unterminated XML reference');
    if (body === 'lt') return '<'; if (body === 'gt') return '>'; if (body === 'amp') return '&'; if (body === 'quot') return '"'; if (body === 'apos') return "'";
    var mm = /^#(?:x([0-9a-fA-F]{1,6})|([0-9]{1,7}))$/.exec(body);
    if (!mm) fail('structure', 'an XML reference that is not one of the five or numeric: &' + body + ';');
    var cp = mm[1] ? parseInt(mm[1], 16) : parseInt(mm[2], 10);
    if (!xmlChar(cp)) fail('structure', 'an XML character reference that is not a Char');
    return String.fromCodePoint(cp);
  });
}
function xmlDoc(bytes, budget) {
  var s;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) s = utf16(bytes.subarray(2), false);
  else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) s = utf16(bytes.subarray(2), true);
  else if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) s = utf8(bytes.subarray(3), true);
  else if (bytes.length >= 2 && (bytes[0] === 0 || bytes[1] === 0)) fail('structure', 'UTF-16 XML without a byte-order mark');
  else s = utf8(bytes, true);
  var root = null, stack = [], i = 0, n = s.length;
  function scope() { return stack.length ? stack[stack.length - 1].ns : { xml: XML_NS }; }
  while (i < n) {
    budget.charge('tokens', 1);
    var lt = s.indexOf('<', i);
    if (lt < 0) lt = n;
    if (lt > i) {
      var txt = s.slice(i, lt);
      if (stack.length) stack[stack.length - 1].text += xmlRefs(txt);
      else if (/[^ \t\r\n]/.test(txt)) fail('structure', 'text outside the XML root');
      i = lt; continue;
    }
    if (s.startsWith('<!--', i)) { var ce = s.indexOf('-->', i + 4); if (ce < 0) fail('structure', 'an unterminated XML comment'); i = ce + 3; continue; }
    if (s.startsWith('<![CDATA[', i)) {
      var de = s.indexOf(']]>', i + 9); if (de < 0) fail('structure', 'an unterminated CDATA section');
      if (!stack.length) fail('structure', 'CDATA outside the XML root');
      stack[stack.length - 1].text += s.slice(i + 9, de); i = de + 3; continue;
    }
    if (s.startsWith('<!', i)) fail('structure', 'an XML part declaring a DTD or other markup declaration');
    if (s.startsWith('<?', i)) { var pe = s.indexOf('?>', i + 2); if (pe < 0) fail('structure', 'an unterminated processing instruction'); i = pe + 2; continue; }
    var gt = -1, q = null;
    for (var k = i + 1; k < n; k++) { var c = s[k]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') { gt = k; break; } }
    if (gt < 0) fail('structure', 'an unterminated XML tag');
    var tag = s.slice(i + 1, gt); i = gt + 1;
    if (tag[0] === '/') {
      var nm = tag.slice(1).trim(), top = stack.pop();
      if (!top || top.qname !== nm) fail('structure', 'a mismatched XML end tag');
      continue;
    }
    var selfClose = tag[tag.length - 1] === '/'; if (selfClose) tag = tag.slice(0, -1);
    var m = /^([^\s=\/]+)/.exec(tag); if (!m) fail('structure', 'an XML tag with no name');
    var qname = m[1], rest = tag.slice(qname.length), attrs = [], am, re = /\s+([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g, last = 0;
    while ((am = re.exec(rest))) { if (am.index !== last) fail('structure', 'a malformed XML attribute'); attrs.push([am[1], xmlRefs(am[3] !== undefined ? am[3] : am[4])]); last = re.lastIndex; }
    if (rest.slice(last).trim()) fail('structure', 'a malformed XML attribute');
    var ns = Object.assign({}, scope());
    attrs.forEach(function (a) { if (a[0] === 'xmlns') ns[''] = a[1]; else if (a[0].indexOf('xmlns:') === 0) ns[a[0].slice(6)] = a[1]; });
    var resolveQ = function (q2, isAttr) {
      var c2 = q2.indexOf(':'); var pre = c2 < 0 ? '' : q2.slice(0, c2), loc = c2 < 0 ? q2 : q2.slice(c2 + 1);
      if (isAttr && !pre) return { ns: '', local: loc };
      if (pre && ns[pre] === undefined) fail('structure', 'an unbound XML prefix ' + pre);
      return { ns: ns[pre] || '', local: loc };
    };
    var el = { qname: qname, ns: ns, name: resolveQ(qname, false), attrs: {}, kids: [], text: '' };
    attrs.forEach(function (a) { if (a[0] === 'xmlns' || a[0].indexOf('xmlns:') === 0) return; var r2 = resolveQ(a[0], true); el.attrs[r2.ns + '|' + r2.local] = a[1]; });
    if (stack.length) stack[stack.length - 1].kids.push(el);
    else if (root) fail('structure', 'two XML roots'); else root = el;
    if (!selfClose) { stack.push(el); if (stack.length > LIMITS.depth) fail('budget', 'XML nests deeper than ' + LIMITS.depth); }
  }
  if (stack.length || !root) fail('structure', 'an unclosed or empty XML document');
  return root;
}
function kid(el, ns, local) {
  var hits = el.kids.filter(function (k) { return ns.indexOf(k.name.ns) >= 0 && k.name.local === local; });
  if (hits.length > 1) fail('structure', 'two <' + local + '> elements under one parent');
  return hits[0] || null;
}
var DC = ['http://purl.org/dc/elements/1.1/'];
var CORE_NS = ['http://schemas.openxmlformats.org/package/2006/metadata/core-properties'];
var EXT_NS = ['http://schemas.openxmlformats.org/officeDocument/2006/extended-properties', 'http://purl.oclc.org/ooxml/officeDocument/extendedProperties'];
var REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
var CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
var CT_CORE = 'application/vnd.openxmlformats-package.core-properties+xml';
var CT_EXT = 'application/vnd.openxmlformats-officedocument.extended-properties+xml';

function resolveTarget(target) {   // an OPC relationship target from the package root -> a part name (R1.1.6)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target) || target.indexOf('//') === 0) fail('structure', 'a relationship target outside the package');
  var segs = [];
  target.split('#')[0].split('/').forEach(function (seg, i) {
    if (seg === '' || seg === '.') return;
    if (seg === '..') { if (!segs.length) fail('structure', 'a relationship target that leaves the package'); segs.pop(); return; }
    segs.push(seg);
  });
  if (!segs.length) fail('structure', 'an empty relationship target');
  return segs.join('/');
}

function readOoxml(zip) {
  var r = new Result('ooxml'), types, rels;
  try { types = xmlDoc(zip.part('[Content_Types].xml'), zip.budget); rels = zip.has('_rels/.rels') ? xmlDoc(zip.part('_rels/.rels'), zip.budget) : null; }
  catch (e) { if (!(e instanceof Blocked)) throw e; r.block(FIELDS, e.reason); return r.out(); }
  if (types.name.ns !== CT_NS || types.name.local !== 'Types') fail('structure', 'a [Content_Types].xml that is not Types');
  var defaults = {}, overrides = {};
  types.kids.forEach(function (k) {
    if (k.name.ns !== CT_NS) return;
    if (k.name.local === 'Default') defaults[String(k.attrs['|Extension'] || '').toLowerCase()] = k.attrs['|ContentType'];
    if (k.name.local === 'Override') overrides[partKey(String(k.attrs['|PartName'] || ''))] = k.attrs['|ContentType'];
  });
  function typeOf(part) { var o = overrides[partKey(part)]; if (o !== undefined) return o; var dot = part.lastIndexOf('.'); return dot < 0 ? undefined : defaults[part.slice(dot + 1).toLowerCase()]; }
  if (!rels) return r.out();
  if (rels.name.ns !== REL_NS || rels.name.local !== 'Relationships') fail('structure', 'a _rels/.rels that is not Relationships');
  var core = null, ext = null, main = null;
  rels.kids.forEach(function (k) {
    if (k.name.ns !== REL_NS || k.name.local !== 'Relationship') return;
    var ty = String(k.attrs['|Type'] || ''), tg = String(k.attrs['|Target'] || ''), external = k.attrs['|TargetMode'] === 'External';
    var which = /\/metadata\/core-properties$/.test(ty) ? 'core' : /\/extended-properties$|\/extendedProperties$/.test(ty) ? 'ext' : /\/officeDocument$/.test(ty) ? 'main' : null;
    if (!which) return;
    if (which === 'main') { if (!external && main === null) main = resolveTarget(tg); return; }
    if (external) fail('structure', 'an external properties target');
    var part = resolveTarget(tg);
    if (which === 'core') { if (core !== null) fail('structure', 'two core-properties relationships'); core = part; }
    else { if (ext !== null) fail('structure', 'two extended-properties relationships'); ext = part; }
  });
  if (core !== null) {
    if (!zip.has(core)) fail('structure', 'the core-properties part is not in the package: ' + core);
    if (typeOf(core) !== CT_CORE) fail('structure', 'the core-properties target is not a core-properties part: ' + core);
    try {
      var cx = xmlDoc(zip.part(core), zip.budget);
      if (CORE_NS.indexOf(cx.name.ns) < 0 || cx.name.local !== 'coreProperties') fail('structure', 'a core part that is not coreProperties');
      var tt = kid(cx, DC, 'title'), cr = kid(cx, DC, 'creator'), lm = kid(cx, CORE_NS, 'lastModifiedBy');
      r.text('title', tt && tt.text); r.text('creator', cr && cr.text); r.text('last_modified_by', lm && lm.text);
    } catch (e) { if (!(e instanceof Blocked)) throw e; r.block(['creator', 'last_modified_by', 'title'], e.reason); }
  }
  var mt = main === null ? '' : String(typeOf(main) || '');
  var tagName = /wordprocessingml|ms-word/.test(mt) ? 'Pages' : /presentationml|ms-powerpoint/.test(mt) ? 'Slides' : null;
  if (ext !== null) {
    if (!zip.has(ext)) fail('structure', 'the extended-properties part is not in the package: ' + ext);
    if (typeOf(ext) !== CT_EXT) fail('structure', 'the extended-properties target is not an extended-properties part: ' + ext);
    try {
      var ex = xmlDoc(zip.part(ext), zip.budget);
      if (EXT_NS.indexOf(ex.name.ns) < 0 || ex.name.local !== 'Properties') fail('structure', 'an extended part that is not Properties');
      if (tagName) {
        var pg = kid(ex, EXT_NS, tagName);
        if (pg) { var txt = pg.text.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, ''); if (txt) { var nn = countOf(txt); if (nn === undefined) r.block(['pages'], 'malformed'); else r.pages = nn; } }
      }
    } catch (e) { if (!(e instanceof Blocked)) throw e; r.block(['pages'], e.reason); }
  }
  return r.out();
}

var MF_NS = 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0';
var OFFICE_NS = ['urn:oasis:names:tc:opendocument:xmlns:office:1.0'];
var META_NS = ['urn:oasis:names:tc:opendocument:xmlns:meta:1.0'];
function readOdf(zip) {
  var r = new Result('odf'), enc = {};
  r.encrypted = null;
  if (zip.has('META-INF/manifest.xml')) {
    try {
      var mf = xmlDoc(zip.part('META-INF/manifest.xml'), zip.budget);
      if (mf.name.ns !== MF_NS || mf.name.local !== 'manifest') fail('structure', 'a manifest that is not manifest:manifest');
      mf.kids.forEach(function (k) {
        if (k.name.ns === MF_NS && k.name.local === 'file-entry' && k.kids.some(function (c) { return c.name.ns === MF_NS && c.name.local === 'encryption-data'; })) enc[partKey(String(k.attrs[MF_NS + '|full-path'] || ''))] = true;
      });
      r.encrypted = Object.keys(enc).length > 0;
    } catch (e) { if (!(e instanceof Blocked)) throw e; r.block(['encrypted'], e.reason); r.encrypted = null; }
  }
  if (enc['meta.xml']) { r.block(FIELDS, 'encrypted'); return r.out(); }
  if (!zip.has('meta.xml')) return r.out();
  try {
    var doc = xmlDoc(zip.part('meta.xml'), zip.budget);
    if (OFFICE_NS.indexOf(doc.name.ns) < 0 || doc.name.local !== 'document-meta') fail('structure', 'a meta.xml that is not office:document-meta');
    var m = kid(doc, OFFICE_NS, 'meta');
    if (!m) return r.out();
    var tt = kid(m, DC, 'title'), ic = kid(m, META_NS, 'initial-creator'), lm = kid(m, DC, 'creator'), st = kid(m, META_NS, 'document-statistic');
    r.text('title', tt && tt.text); r.text('creator', ic && ic.text); r.text('last_modified_by', lm && lm.text);
    var pc = st ? st.attrs[META_NS[0] + '|page-count'] : undefined;
    if (pc !== undefined) { var n = countOf(pc.trim()); if (n === undefined) r.block(['pages'], 'malformed'); else r.pages = n; }
  } catch (e) { if (!(e instanceof Blocked)) throw e; r.block(FIELDS, e.reason); }
  return r.out();
}

function readZip(b, inf, budget) {
  var zip = new Zip(b, inf, budget);
  var first = zip.entries.slice().sort(function (x, y) { return x.off - y.off; })[0];
  if (first && first.name === 'mimetype') {
    if (first.method !== 0) fail('format', 'an ODF mimetype that is not stored');
    var mt = latin1(zip.part('mimetype'), 0, first.usize);
    if (mt.indexOf('application/vnd.oasis.opendocument.') !== 0) fail('format', 'a mimetype that is not ODF: ' + mt.slice(0, 64));
    return readOdf(zip);
  }
  if (zip.has('[Content_Types].xml')) return readOoxml(zip);
  fail('format', 'a zip that is neither OOXML nor ODF');
}

// =========================================================================================================================
function readDocInfo(bytes, options) {
  var b = toU8(bytes), o = options || {};
  var inf = { inflate: typeof o.inflate === 'function' ? o.inflate : null, inflateRaw: typeof o.inflateRaw === 'function' ? o.inflateRaw : null };
  var budget = new Budget();
  try {
    if (b.length >= 4 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) fail('format', 'an OLE compound file (a legacy Office file or an encrypted OOXML package) is not read');
    if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) && (b[3] === 4 || b[3] === 6)) return readZip(b, inf, budget);
    if (lastIndexOf(b, '%PDF-', Math.min(b.length, 1024) - 5, 0) >= 0) return readPdf(b, inf, budget);
    fail('format', 'neither a PDF nor an OOXML or ODF zip');
  } catch (e) {
    if (e instanceof DocInfoError) throw e;
    if (e instanceof Blocked) fail('structure', 'blocked: ' + e.reason);
    fail('structure', 'malformed: ' + (e && e.message ? e.message : String(e)));
  }
}

function nodeInflaters(zlib) {
  return {
    inflate: function (b, max) { return zlib.inflateSync(b, { maxOutputLength: Math.max(1, max) }); },
    inflateRaw: function (b, max) {
      var r = zlib.inflateRawSync(b, { maxOutputLength: Math.max(1, max), info: true });
      if (r.engine.bytesWritten !== b.length) throw new Error('the deflate stream ends before its payload does (' + r.engine.bytesWritten + ' of ' + b.length + ' bytes)');
      return r.buffer;
    },
  };
}

if (typeof window !== 'undefined') {
  window.LoopGifts = window.LoopGifts || {};
  window.LoopGifts.readDocInfo = readDocInfo;
  window.LoopGifts['doc-info'] = { readDocInfo: readDocInfo, DocInfoError: DocInfoError };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { readDocInfo: readDocInfo, DocInfoError: DocInfoError, nodeInflaters: nodeInflaters };
}
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  var fs = require('fs');
  var args = process.argv.slice(2);
  var USAGE = 'usage: node doc-info.js FILE\n  prints a PDF\'s or an OOXML/ODF file\'s stated title, people and page count as JSON\n  exit 0 read · 3 malformed (DocInfoError) · 2 usage, unreadable, not a file, or over 256 MiB\n';
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) { process.stdout.write(USAGE); process.exit(0); }
  if (args.length !== 1) { process.stderr.write(USAGE); process.exit(2); }
  var st;
  try { st = fs.statSync(args[0]); } catch (e) { process.stderr.write('doc-info: cannot read ' + args[0] + '\n'); process.exit(2); }
  if (!st.isFile()) { process.stderr.write('doc-info: not a file: ' + args[0] + '\n'); process.exit(2); }
  var size = st.size;
  if (size > LIMITS.file) { process.stderr.write('doc-info: the file is over 256 MiB\n'); process.exit(2); }
  try {
    var res = readDocInfo(fs.readFileSync(args[0]), nodeInflaters(require('zlib')));
    process.stdout.write(JSON.stringify(res, Object.keys(res).sort()) + '\n');
  } catch (e) {
    if (e instanceof DocInfoError) { process.stderr.write('doc-info: ' + e.code + ': ' + e.message + '\n'); process.exit(3); }
    throw e;
  }
}
