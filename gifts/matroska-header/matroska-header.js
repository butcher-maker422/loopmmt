#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// matroska-header.js — read a Matroska or WebM file's header (running time, tracks with codec, language and the six
// flags, editions with ordered chapters) without decoding a frame. No dependencies; Node or the browser.
//
//   readMatroskaHeader(bytes)                     one window at offset 0 (a Uint8Array or Buffer)
//   readMatroskaHeader([{offset, bytes}, ...])    several windows of one file (say its head and its tail)
//
// It walks the EBML tree over the windows it is handed and nothing else. A header element it cannot read whole from
// those windows is named in `unreached`, never guessed. Untrusted bytes are checked before they are trusted: the EBML
// magic, the doc type, every variable-length integer, every child against its parent, and a nesting bound. Anything
// malformed throws MatroskaError. Clusters (the frames) are skipped by their size and never read.
// Element IDs: RFC 9559 (Matroska), witnessed against ffprobe in test_matroska-header.js.
'use strict';

class MatroskaError extends Error {
  constructor(message) { super(message); this.name = 'MatroskaError'; }
}

const ID = {
  EBML: 0x1A45DFA3, DocType: 0x4282, DocTypeVersion: 0x4287, Segment: 0x18538067,
  SeekHead: 0x114D9B74, Seek: 0x4DBB, SeekID: 0x53AB, SeekPosition: 0x53AC,
  Info: 0x1549A966, TimestampScale: 0x2AD7B1, Duration: 0x4489, Title: 0x7BA9,
  Tracks: 0x1654AE6B, TrackEntry: 0xAE, TrackNumber: 0xD7, TrackUID: 0x73C5, TrackType: 0x83,
  FlagDefault: 0x88, FlagForced: 0x55AA, FlagHearingImpaired: 0x55AB, FlagVisualImpaired: 0x55AC,
  FlagTextDescriptions: 0x55AD, FlagOriginal: 0x55AE, Name: 0x536E, Language: 0x22B59C, LanguageBCP47: 0x22B59D,
  CodecID: 0x86, Video: 0xE0, PixelWidth: 0xB0, PixelHeight: 0xBA, Audio: 0xE1, SamplingFrequency: 0xB5, Channels: 0x9F,
  Chapters: 0x1043A770, EditionEntry: 0x45B9, EditionUID: 0x45BC, EditionFlagHidden: 0x45BD,
  EditionFlagDefault: 0x45DB, EditionFlagOrdered: 0x45DD, ChapterAtom: 0xB6, ChapterUID: 0x73C4,
  ChapterTimeStart: 0x91, ChapterTimeEnd: 0x92, ChapterFlagHidden: 0x98, ChapterFlagEnabled: 0x4598,
  ChapterDisplay: 0x80, ChapString: 0x85, ChapLanguage: 0x437C, ChapLanguageBCP47: 0x437D,
  Cluster: 0x1F43B675, Cues: 0x1C53BB6B, Tags: 0x1254C367, Attachments: 0x1941A469,
};
const HEADER_PARTS = { [ID.Info]: 'Info', [ID.Tracks]: 'Tracks', [ID.Chapters]: 'Chapters' };
const TRACK_KIND = { 1: 'video', 2: 'audio', 3: 'complex', 0x10: 'logo', 0x11: 'subtitle', 0x12: 'buttons', 0x20: 'control', 0x21: 'metadata' };
const MAX_DEPTH = 32;            // the deepest real header (chapters within chapters) is far shallower
const MAX_STRING = 65536;        // a codec id, a language, a title: never this long in a real file
const MAX_ELEMENTS = 200000;     // a bound on work for one call
const UNKNOWN = -1;              // an element of unknown size (only a Segment or a Cluster may be one)

// ---- windows: the bytes of one file at known offsets ----
function toWindows(input) {
  const list = Array.isArray(input) ? input : [{ offset: 0, bytes: input }];
  return list.map((w) => {
    if (!w || !(w.bytes instanceof Uint8Array) || !Number.isSafeInteger(w.offset) || w.offset < 0) {
      throw new MatroskaError('each window needs a whole-number offset and a Uint8Array of bytes');
    }
    return { start: w.offset, end: w.offset + w.bytes.length, bytes: w.bytes };
  }).sort((a, b) => a.start - b.start);
}
function windowAt(ws, pos) { for (const w of ws) if (pos >= w.start && pos < w.end) return w; return null; }
function have(ws, start, end) { const w = windowAt(ws, start); return w !== null && end <= w.end; }
function byteAt(ws, pos) { const w = windowAt(ws, pos); return w === null ? null : w.bytes[pos - w.start]; }

// ---- variable-length integers ----
function readVint(ws, pos, isId) {
  const first = byteAt(ws, pos);
  if (first === null) return null;                       // out of every window: not readable here
  if (first === 0) throw new MatroskaError(`invalid variable-length integer at byte ${pos}`);
  let len = 1; while (!(first & (0x80 >> (len - 1)))) len++;
  if (len > (isId ? 4 : 8)) throw new MatroskaError(`variable-length integer too long at byte ${pos}`);
  if (!have(ws, pos, pos + len)) return null;
  let value = isId ? first : first & (0xFF >> len); let allOnes = value === (0xFF >> len);
  for (let i = 1; i < len; i++) {
    const b = byteAt(ws, pos + i); value = value * 256 + b; if (b !== 0xFF) allOnes = false;
  }
  if (!isId && allOnes) return { value: UNKNOWN, len };
  if (!Number.isSafeInteger(value)) throw new MatroskaError(`size too large at byte ${pos}`);
  return { value, len };
}
function readHeader(ws, pos) {
  const id = readVint(ws, pos, true); if (id === null) return null;
  const size = readVint(ws, pos + id.len, false); if (size === null) return null;
  return { id: id.value, start: pos, data: pos + id.len + size.len, size: size.value };
}

// ---- leaf values ----
function bytesOf(ws, e) {
  const w = windowAt(ws, e.data);
  return w.bytes.subarray(e.data - w.start, e.data - w.start + e.size);
}
function uint(ws, e) {
  if (e.size > 8) throw new MatroskaError(`unsigned integer of ${e.size} bytes at byte ${e.start}`);
  let v = 0; for (const b of bytesOf(ws, e)) v = v * 256 + b;
  if (!Number.isSafeInteger(v)) throw new MatroskaError(`unsigned integer too large at byte ${e.start}`);
  return v;
}
function float(ws, e) {
  if (e.size === 0) return 0;
  if (e.size !== 4 && e.size !== 8) throw new MatroskaError(`float of ${e.size} bytes at byte ${e.start}`);
  const b = bytesOf(ws, e); const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return e.size === 4 ? dv.getFloat32(0) : dv.getFloat64(0);
}
function text(ws, e) {
  if (e.size > MAX_STRING) throw new MatroskaError(`string of ${e.size} bytes at byte ${e.start}`);
  let b = bytesOf(ws, e); const nul = b.indexOf(0); if (nul >= 0) b = b.subarray(0, nul);
  return new TextDecoder('utf-8').decode(b);
}
const flag = (ws, e) => uint(ws, e) !== 0;
function uid(ws, e) { // a UID is any 64-bit value: kept whole, as a decimal string
  if (e.size > 8) throw new MatroskaError(`UID of ${e.size} bytes at byte ${e.start}`);
  let v = BigInt(0); for (const b of bytesOf(ws, e)) v = v * BigInt(256) + BigInt(b);
  return v.toString();
}

// ---- the walk ----
function children(ws, parent, depth, budget) {
  if (depth > MAX_DEPTH) throw new MatroskaError(`nesting deeper than ${MAX_DEPTH} at byte ${parent.start}`);
  const out = []; let pos = parent.data; const end = parent.data + parent.size;
  while (pos < end) {
    if (++budget.n > MAX_ELEMENTS) throw new MatroskaError('too many elements');
    const e = readHeader(ws, pos);
    if (e === null) throw new MatroskaError(`element at byte ${pos} is not in the window that holds its parent`);
    if (e.size === UNKNOWN) throw new MatroskaError(`unknown size inside a header element at byte ${pos}`);
    if (e.data + e.size > end) throw new MatroskaError(`element at byte ${pos} runs past its parent`);
    if (!have(ws, e.data, e.data + e.size)) throw new MatroskaError(`element at byte ${pos} is not in the window that holds its parent`);
    out.push(e); pos = e.data + e.size;
  }
  return out;
}
const kid = (list, id) => list.find((e) => e.id === id);
const kids = (list, id) => list.filter((e) => e.id === id);

function parseInfo(ws, e, budget, out) {
  const c = children(ws, e, 2, budget);
  const ts = kid(c, ID.TimestampScale); out.timestamp_scale = ts ? uint(ws, ts) : 1000000;
  const d = kid(c, ID.Duration); out.duration_raw = d ? float(ws, d) : null;
  const t = kid(c, ID.Title); out.title = t ? text(ws, t) : null;
}
function language(ws, list, isoId, bcpId, isoDefault) {
  const iso = kid(list, isoId); const bcp = kid(list, bcpId);
  const isoValue = iso ? text(ws, iso) : isoDefault; const bcpValue = bcp ? text(ws, bcp) : null;
  return { language: bcpValue !== null ? bcpValue : isoValue, language_iso639_2: isoValue, language_bcp47: bcpValue, defaulted: !iso && !bcp };
}
function parseTracks(ws, e, budget) {
  return kids(children(ws, e, 2, budget), ID.TrackEntry).map((te) => {
    const c = children(ws, te, 3, budget);
    const num = kid(c, ID.TrackNumber); const type = kid(c, ID.TrackType); const codec = kid(c, ID.CodecID); const name = kid(c, ID.Name);
    const uidEl = kid(c, ID.TrackUID);
    const optFlag = (id) => { const f = kid(c, id); return f ? flag(ws, f) : null; };
    const lang = language(ws, c, ID.Language, ID.LanguageBCP47, 'eng');
    const typeNum = type ? uint(ws, type) : null;
    const track = {
      number: num ? uint(ws, num) : null, uid: uidEl ? uid(ws, uidEl) : null, type: typeNum,
      kind: typeNum === null ? null : (TRACK_KIND[typeNum] || 'unknown'),
      codec_id: codec ? text(ws, codec) : null, name: name ? text(ws, name) : null,
      language: lang.language, language_iso639_2: lang.language_iso639_2, language_bcp47: lang.language_bcp47,
      language_defaulted: lang.defaulted,
      flags: {
        default: kid(c, ID.FlagDefault) ? flag(ws, kid(c, ID.FlagDefault)) : true,
        forced: kid(c, ID.FlagForced) ? flag(ws, kid(c, ID.FlagForced)) : false,
        hearing_impaired: optFlag(ID.FlagHearingImpaired), visual_impaired: optFlag(ID.FlagVisualImpaired),
        descriptions: optFlag(ID.FlagTextDescriptions), original: optFlag(ID.FlagOriginal),
      },
    };
    const v = kid(c, ID.Video);
    if (v) { const vc = children(ws, v, 4, budget); const w = kid(vc, ID.PixelWidth); const h = kid(vc, ID.PixelHeight);
      track.video = { width: w ? uint(ws, w) : null, height: h ? uint(ws, h) : null }; }
    const a = kid(c, ID.Audio);
    if (a) { const ac = children(ws, a, 4, budget); const sf = kid(ac, ID.SamplingFrequency); const ch = kid(ac, ID.Channels);
      track.audio = { sampling_frequency: sf ? float(ws, sf) : 8000, channels: ch ? uint(ws, ch) : 1 }; }
    return track;
  });
}
function parseChapter(ws, e, depth, budget) {
  const c = children(ws, e, depth, budget);
  const g = (id) => kid(c, id);
  return {
    uid: g(ID.ChapterUID) ? uid(ws, g(ID.ChapterUID)) : null,
    start_ns: g(ID.ChapterTimeStart) ? uint(ws, g(ID.ChapterTimeStart)) : null,
    end_ns: g(ID.ChapterTimeEnd) ? uint(ws, g(ID.ChapterTimeEnd)) : null,
    hidden: g(ID.ChapterFlagHidden) ? flag(ws, g(ID.ChapterFlagHidden)) : false,
    enabled: g(ID.ChapterFlagEnabled) ? flag(ws, g(ID.ChapterFlagEnabled)) : true,
    titles: kids(c, ID.ChapterDisplay).map((d) => {
      const dc = children(ws, d, depth + 1, budget); const str = kid(dc, ID.ChapString);
      const lang = language(ws, dc, ID.ChapLanguage, ID.ChapLanguageBCP47, 'eng');
      return { title: str ? text(ws, str) : null, language: lang.language, language_iso639_2: lang.language_iso639_2, language_bcp47: lang.language_bcp47 };
    }),
    chapters: kids(c, ID.ChapterAtom).map((sub) => parseChapter(ws, sub, depth + 1, budget)),
  };
}
function parseChapters(ws, e, budget) {
  return kids(children(ws, e, 2, budget), ID.EditionEntry).map((ed) => {
    const c = children(ws, ed, 3, budget); const g = (id) => kid(c, id);
    return {
      uid: g(ID.EditionUID) ? uid(ws, g(ID.EditionUID)) : null,
      default: g(ID.EditionFlagDefault) ? flag(ws, g(ID.EditionFlagDefault)) : false,
      ordered: g(ID.EditionFlagOrdered) ? flag(ws, g(ID.EditionFlagOrdered)) : false,
      hidden: g(ID.EditionFlagHidden) ? flag(ws, g(ID.EditionFlagHidden)) : false,
      chapters: kids(c, ID.ChapterAtom).map((a) => parseChapter(ws, a, 4, budget)),
    };
  });
}

function readMatroskaHeader(input) {
  const ws = toWindows(input); const budget = { n: 0 };
  const head = readHeader(ws, 0);
  if (head === null || head.id !== ID.EBML) throw new MatroskaError('not an EBML file (no EBML header at byte 0)');
  if (head.size === UNKNOWN || !have(ws, head.data, head.data + head.size)) throw new MatroskaError('the EBML header is not whole in the first window');
  const hc = children(ws, head, 1, budget);
  const dt = kid(hc, ID.DocType); const docType = dt ? text(ws, dt) : 'matroska';
  if (docType !== 'matroska' && docType !== 'webm') throw new MatroskaError(`doc type "${docType}" is not matroska or webm`);
  const dtv = kid(hc, ID.DocTypeVersion);

  const seg = readHeader(ws, head.data + head.size);
  if (seg === null || seg.id !== ID.Segment) throw new MatroskaError('no Segment after the EBML header');
  const segEnd = seg.size === UNKNOWN ? Infinity : seg.data + seg.size;
  const out = { doc_type: docType, doc_type_version: dtv ? uint(ws, dtv) : 1, timestamp_scale: 1000000, duration_raw: null, title: null };
  let tracks = []; let editions = [];
  const found = {}; const seekTo = {};

  const take = (e) => {
    const part = HEADER_PARTS[e.id]; if (!part || found[part]) return;
    found[part] = true;
    if (e.id === ID.Info) parseInfo(ws, e, budget, out);
    else if (e.id === ID.Tracks) tracks = parseTracks(ws, e, budget);
    else editions = parseChapters(ws, e, budget);
  };
  // The linear walk: top-level children of the Segment, in order, until the window ends or a Cluster begins.
  let pos = seg.data;
  while (pos < segEnd) {
    if (++budget.n > MAX_ELEMENTS) throw new MatroskaError('too many elements');
    const e = readHeader(ws, pos);
    if (e === null) break;                                          // the window ended
    if (e.id === ID.Cluster) break;                                 // frames begin: never read them
    if (e.size === UNKNOWN) throw new MatroskaError(`unknown size on a non-Cluster element at byte ${pos}`);
    if (e.data + e.size > segEnd) throw new MatroskaError(`element at byte ${pos} runs past its parent`);
    if (HEADER_PARTS[e.id] || e.id === ID.SeekHead) {
      if (!have(ws, e.data, e.data + e.size)) { if (HEADER_PARTS[e.id]) seekTo[HEADER_PARTS[e.id]] = { at: e.start, cut: true }; break; }
      if (e.id === ID.SeekHead) {
        for (const s of kids(children(ws, e, 2, budget), ID.Seek)) {
          const sc = children(ws, s, 3, budget); const sid = kid(sc, ID.SeekID); const sp = kid(sc, ID.SeekPosition);
          if (!sid || !sp) continue;
          let idv = 0; for (const b of bytesOf(ws, sid)) idv = idv * 256 + b;
          const part = HEADER_PARTS[idv]; if (part && !seekTo[part]) seekTo[part] = { at: seg.data + uint(ws, sp) };
        }
      } else take(e);
    }
    pos = e.data + e.size;
  }
  // The SeekHead's pointers: any header part not met on the walk is read wherever a window holds it whole.
  const unreached = [];
  for (const part of ['Info', 'Tracks', 'Chapters']) {
    if (found[part] || !seekTo[part]) continue;
    const e = readHeader(ws, seekTo[part].at);
    if (e !== null && HEADER_PARTS[e.id] === part && e.size !== UNKNOWN && e.data + e.size <= segEnd && have(ws, e.data, e.data + e.size)) take(e);
    else unreached.push(part);
  }
  return {
    doc_type: out.doc_type, doc_type_version: out.doc_type_version, timestamp_scale: out.timestamp_scale,
    duration_ns: out.duration_raw === null ? null : out.duration_raw * out.timestamp_scale, title: out.title,
    tracks, editions, unreached,
  };
}

// ---- the command line: bounded windows from a file, JSON out ----
const HEAD_BYTES = 4 * 1024 * 1024;
const TAIL_BYTES = 1024 * 1024;
function readFileWindows(fs, file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size; const windows = [];
    const headLen = Math.min(size, HEAD_BYTES); const head = Buffer.alloc(headLen); fs.readSync(fd, head, 0, headLen, 0);
    windows.push({ offset: 0, bytes: head });
    if (size > headLen) {
      const tailStart = Math.max(headLen, size - TAIL_BYTES); const tail = Buffer.alloc(size - tailStart);
      fs.readSync(fd, tail, 0, tail.length, tailStart); windows.push({ offset: tailStart, bytes: tail });
    }
    return windows;
  } finally { fs.closeSync(fd); }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { readMatroskaHeader, readFileWindows, MatroskaError, HEAD_BYTES, TAIL_BYTES };
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const fs = require('fs'); const file = process.argv[2];
  const usage = 'usage: node matroska-header.js FILE.mkv   (prints the header facts as JSON; reads the first 4 MiB and the last 1 MiB)\n';
  if (file === '--help' || file === '-h') { process.stdout.write(usage); process.exit(0); }
  if (!file) { process.stderr.write(usage); process.exit(2); }
  try { process.stdout.write(JSON.stringify(readMatroskaHeader(readFileWindows(fs, file)), null, 2) + '\n'); }
  catch (e) { process.stderr.write(`${e.name}: ${e.message}\n`); process.exit(e instanceof MatroskaError ? 3 : 1); }
}
