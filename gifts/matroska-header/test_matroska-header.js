#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// test_matroska-header.js — the Matroska header reader's tests (Gift; the-library AV4, Blueprint B3.34, D266).
// Hand-built EBML vectors (every element ID written once, in E below) plus, when ffmpeg and ffprobe are present,
// real files written by ffmpeg and read back by ffprobe as the oracle. Absent tools are SKIPPED and said so.
// Run: node test_matroska-header.js
'use strict';
const assert = require('assert');
const path = require('path');
const { readMatroskaHeader, MatroskaError } = require(path.join(__dirname, 'matroska-header.js'));

// ---- a tiny EBML writer (tests only) ----
const E = {
  EBML: '1A45DFA3', DocType: '4282', DocTypeVersion: '4287', Segment: '18538067', SeekHead: '114D9B74',
  Seek: '4DBB', SeekID: '53AB', SeekPosition: '53AC', Info: '1549A966', TimestampScale: '2AD7B1',
  Duration: '4489', Title: '7BA9', Tracks: '1654AE6B', TrackEntry: 'AE', TrackNumber: 'D7', TrackUID: '73C5',
  TrackType: '83', FlagEnabled: 'B9', FlagDefault: '88', FlagForced: '55AA', FlagHearingImpaired: '55AB',
  FlagVisualImpaired: '55AC', FlagTextDescriptions: '55AD', FlagOriginal: '55AE', Name: '536E',
  Language: '22B59C', LanguageBCP47: '22B59D', CodecID: '86', Video: 'E0', PixelWidth: 'B0', PixelHeight: 'BA',
  Audio: 'E1', SamplingFrequency: 'B5', Channels: '9F', Chapters: '1043A770', EditionEntry: '45B9',
  EditionUID: '45BC', EditionFlagHidden: '45BD', EditionFlagDefault: '45DB', EditionFlagOrdered: '45DD',
  ChapterAtom: 'B6', ChapterUID: '73C4', ChapterTimeStart: '91', ChapterTimeEnd: '92', ChapterFlagHidden: '98',
  ChapterFlagEnabled: '4598', ChapterDisplay: '80', ChapString: '85', ChapLanguage: '437C',
  ChapLanguageBCP47: '437D', Cluster: '1F43B675', Void: 'EC', Tags: '1254C367',
};
const hex = (h) => Buffer.from(h, 'hex');
function vsize(n) { // smallest EBML size vint for n
  for (let len = 1; len <= 8; len++) {
    if (n < Math.pow(2, 7 * len) - 1) {
      const out = Buffer.alloc(len); let v = n;
      for (let i = len - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
      out[0] |= 1 << (8 - len); return out;
    }
  }
  throw new Error('too big');
}
const el = (name, ...kids) => { const body = Buffer.concat(kids); return Buffer.concat([hex(E[name]), vsize(body.length), body]); };
const unknownSize = (name, ...kids) => Buffer.concat([hex(E[name]), hex('01FFFFFFFFFFFFFF'), ...kids]);
const u = (n) => { if (n === 0) return Buffer.from([0]); const b = []; let v = n; while (v > 0) { b.unshift(v % 256); v = Math.floor(v / 256); } return Buffer.from(b); };
const s = (t) => Buffer.from(t, 'utf8');
const f64 = (x) => { const b = Buffer.alloc(8); b.writeDoubleBE(x); return b; };
const f32 = (x) => { const b = Buffer.alloc(4); b.writeFloatBE(x); return b; };
const ebmlHead = (doc = 'matroska') => el('EBML', el('DocType', s(doc)), el('DocTypeVersion', u(4)));

function film() { // a two-cut film: video, French audio (ISO only), pt-BR audio (both codes), forced subtitle
  return Buffer.concat([ebmlHead(), el('Segment',
    el('Info', el('TimestampScale', u(1000000)), el('Duration', f64(5400000.0)), el('Title', s('The Lantern Coast'))),
    el('Tracks',
      el('TrackEntry', el('TrackNumber', u(1)), el('TrackUID', u(11)), el('TrackType', u(1)), el('CodecID', s('V_MPEGH/ISO/HEVC')),
        el('Video', el('PixelWidth', u(3840)), el('PixelHeight', u(1600)))),
      el('TrackEntry', el('TrackNumber', u(2)), el('TrackType', u(2)), el('CodecID', s('A_PCM/INT/LIT')), el('Language', s('fre')),
        el('FlagHearingImpaired', u(0)), el('FlagOriginal', u(1)), el('Name', s('Original')),
        el('Audio', el('SamplingFrequency', f64(48000)), el('Channels', u(6)))),
      el('TrackEntry', el('TrackNumber', u(3)), el('TrackType', u(2)), el('CodecID', s('A_AAC')), el('Language', s('por')),
        el('LanguageBCP47', s('pt-BR')), el('FlagDefault', u(0)), el('FlagTextDescriptions', u(1)), el('FlagVisualImpaired', u(1)),
        el('Audio', el('SamplingFrequency', f32(44100)), el('Channels', u(2)))),
      el('TrackEntry', el('TrackNumber', u(4)), el('TrackType', u(0x11)), el('CodecID', s('S_TEXT/UTF8')), el('Language', s('eng')),
        el('FlagForced', u(1)), el('FlagDefault', u(0)))),
    el('Chapters',
      el('EditionEntry', el('EditionUID', u(100)), el('EditionFlagDefault', u(1)), el('EditionFlagOrdered', u(0)),
        el('ChapterAtom', el('ChapterUID', u(1)), el('ChapterTimeStart', u(0)), el('ChapterTimeEnd', u(60e9)),
          el('ChapterDisplay', el('ChapString', s('Opening')), el('ChapLanguage', s('eng'))))),
      el('EditionEntry', el('EditionUID', u(200)), el('EditionFlagOrdered', u(1)),
        el('ChapterAtom', el('ChapterUID', u(2)), el('ChapterTimeStart', u(120e9)), el('ChapterTimeEnd', u(180e9)),
          el('ChapterDisplay', el('ChapString', s('Extended scene')), el('ChapLanguageBCP47', s('en-GB')), el('ChapLanguage', s('eng')))),
        el('ChapterAtom', el('ChapterUID', u(3)), el('ChapterTimeStart', u(0)), el('ChapterTimeEnd', u(60e9)), el('ChapterFlagHidden', u(1))))),
    el('Cluster', hex('E7'), vsize(1), u(0), hex('A3'), vsize(4), hex('81000080')))]);
}

let passed = 0, failed = 0, skipped = 0;
function t(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e && e.message}`); }
}
function skip(name, why) { skipped++; console.log(`SKIP ${name} — ${why}`); }

// ---- the header ----
t('reads the doc type and running time from the header (duration x timestamp scale, in nanoseconds)', () => {
  const r = readMatroskaHeader(film());
  assert.strictEqual(r.doc_type, 'matroska');
  assert.strictEqual(r.doc_type_version, 4);
  assert.strictEqual(r.timestamp_scale, 1000000);
  assert.strictEqual(r.duration_ns, 5400000.0 * 1000000);
  assert.strictEqual(r.title, 'The Lantern Coast');
});
t('webm is a Matroska doc type and is read the same way', () => {
  const b = Buffer.concat([ebmlHead('webm'), el('Segment', el('Info', el('Duration', f64(1000))))]);
  const r = readMatroskaHeader(b);
  assert.strictEqual(r.doc_type, 'webm');
  assert.strictEqual(r.timestamp_scale, 1000000, 'the spec default when absent');
  assert.strictEqual(r.duration_ns, 1000 * 1000000);
});
t('an absent Duration is null, never zero', () => {
  const b = Buffer.concat([ebmlHead(), el('Segment', el('Info', el('TimestampScale', u(1000000))))]);
  assert.strictEqual(readMatroskaHeader(b).duration_ns, null);
});

// ---- tracks ----
t('reads every track with its number, kind and codec id', () => {
  const r = readMatroskaHeader(film());
  assert.deepStrictEqual(r.tracks.map((x) => [x.number, x.kind, x.codec_id]),
    [[1, 'video', 'V_MPEGH/ISO/HEVC'], [2, 'audio', 'A_PCM/INT/LIT'], [3, 'audio', 'A_AAC'], [4, 'subtitle', 'S_TEXT/UTF8']]);
  assert.deepStrictEqual(r.tracks[0].video, { width: 3840, height: 1600 });
  assert.deepStrictEqual(r.tracks[1].audio, { sampling_frequency: 48000, channels: 6 });
  assert.deepStrictEqual(r.tracks[2].audio, { sampling_frequency: 44100, channels: 2 });
  assert.strictEqual(r.tracks[1].name, 'Original');
});
t('the BCP 47 tag wins over the three-letter code when both are present', () => {
  const r = readMatroskaHeader(film());
  assert.strictEqual(r.tracks[2].language, 'pt-BR');
  assert.strictEqual(r.tracks[2].language_iso639_2, 'por');
  assert.strictEqual(r.tracks[2].language_bcp47, 'pt-BR');
  assert.strictEqual(r.tracks[1].language, 'fre');
  assert.strictEqual(r.tracks[1].language_bcp47, null);
});
t('an absent Language reads the spec default eng, marked as defaulted', () => {
  const r = readMatroskaHeader(film());
  assert.strictEqual(r.tracks[0].language, 'eng');
  assert.strictEqual(r.tracks[0].language_defaulted, true);
  assert.strictEqual(r.tracks[1].language_defaulted, false);
});
t('the six flags: default and forced take their spec defaults; the four accessibility flags are null when absent', () => {
  const [v, fr, pt, sub] = readMatroskaHeader(film()).tracks;
  assert.deepStrictEqual(v.flags, { default: true, forced: false, hearing_impaired: null, visual_impaired: null, descriptions: null, original: null });
  assert.deepStrictEqual(fr.flags, { default: true, forced: false, hearing_impaired: false, visual_impaired: null, descriptions: null, original: true });
  assert.deepStrictEqual(pt.flags, { default: false, forced: false, hearing_impaired: null, visual_impaired: true, descriptions: true, original: null });
  assert.deepStrictEqual(sub.flags, { default: false, forced: true, hearing_impaired: null, visual_impaired: null, descriptions: null, original: null });
});

// ---- editions and chapters ----
t('reads editions with their default and ordered flags', () => {
  const ed = readMatroskaHeader(film()).editions;
  assert.deepStrictEqual(ed.map((e) => [e.uid, e.default, e.ordered, e.hidden]), [['100', true, false, false], ['200', false, true, false]]);
});
t('an ordered edition keeps its chapters in stored order, with times in nanoseconds and titles with languages', () => {
  const ch = readMatroskaHeader(film()).editions[1].chapters;
  assert.deepStrictEqual(ch.map((c) => [c.uid, c.start_ns, c.end_ns, c.hidden]), [['2', 120e9, 180e9, false], ['3', 0, 60e9, true]]);
  assert.deepStrictEqual(ch[0].titles, [{ title: 'Extended scene', language: 'en-GB', language_iso639_2: 'eng', language_bcp47: 'en-GB' }]);
  assert.strictEqual(ch[0].enabled, true);
});

// ---- never decode; bounded windows ----
t('never reads inside a Cluster: frames are skipped, not decoded', () => {
  const r = readMatroskaHeader(film());
  assert.ok(!('clusters' in r));
  assert.deepStrictEqual(r.unreached, []);
});
t('stops at an unknown-size Cluster and still reports the header before it', () => {
  const b = Buffer.concat([ebmlHead(), unknownSize('Segment',
    el('Info', el('Duration', f64(2000))), el('Tracks', el('TrackEntry', el('TrackNumber', u(1)), el('TrackType', u(2)), el('CodecID', s('A_FLAC')))),
    unknownSize('Cluster', hex('E781'), u(0)))]);
  const r = readMatroskaHeader(b);
  assert.strictEqual(r.tracks.length, 1);
  assert.strictEqual(r.duration_ns, 2000 * 1000000);
});
t('a header element cut off by the window is named unreached, never guessed', () => {
  const whole = film();
  const cut = whole.subarray(0, whole.indexOf(hex(E.Chapters)) + 12);
  const r = readMatroskaHeader(cut);
  assert.strictEqual(r.tracks.length, 4, 'Tracks sat wholly inside the window');
  assert.deepStrictEqual(r.editions, []);
  assert.deepStrictEqual(r.unreached, ['Chapters']);
});
t('reads a top-level element from a later window found through the SeekHead', () => {
  // Segment: SeekHead -> Chapters at a far offset; the head window ends in a Cluster; the tail window holds Chapters.
  const chapters = el('Chapters', el('EditionEntry', el('EditionUID', u(9)), el('ChapterAtom', el('ChapterUID', u(5)), el('ChapterTimeStart', u(0)))));
  const info = el('Info', el('Duration', f64(10)));
  const tracks = el('Tracks', el('TrackEntry', el('TrackNumber', u(1)), el('TrackType', u(1)), el('CodecID', s('V_AV1'))));
  const filler = el('Cluster', hex('E7'), vsize(1), u(0), el('Void', Buffer.alloc(5000))); // frames: the walk stops here
  const seekLen = 30; // SeekHead is padded to a fixed length so positions are known before it is built
  const body = (seek) => Buffer.concat([seek, info, tracks, filler, chapters]);
  const chapPos = seekLen + info.length + tracks.length + filler.length;
  let seek = el('SeekHead', el('Seek', el('SeekID', hex(E.Chapters)), el('SeekPosition', u(chapPos))));
  seek = Buffer.concat([seek, el('Void', Buffer.alloc(seekLen - seek.length - 2))]);
  assert.strictEqual(seek.length, seekLen);
  const segment = el('Segment', body(seek));
  const file = Buffer.concat([ebmlHead(), segment]);
  const headEnd = file.length - chapters.length - 2000;
  const r = readMatroskaHeader([{ offset: 0, bytes: file.subarray(0, headEnd) }, { offset: file.length - chapters.length - 10, bytes: file.subarray(file.length - chapters.length - 10) }]);
  assert.strictEqual(r.editions.length, 1);
  assert.strictEqual(r.editions[0].chapters[0].uid, '5');
  assert.deepStrictEqual(r.unreached, []);
  const linearOnly = readMatroskaHeader([{ offset: 0, bytes: file.subarray(0, headEnd) }, { offset: file.length - chapters.length - 10, bytes: file.subarray(file.length - chapters.length - 10) }]);
  assert.strictEqual(linearOnly.editions[0].uid, '9', 'found through the SeekHead, past the Cluster');
  const headOnly = readMatroskaHeader([{ offset: 0, bytes: file.subarray(0, headEnd) }]);
  assert.deepStrictEqual(headOnly.unreached, ['Chapters']);
});

// ---- the ratchet: untrusted bytes refused, never read past ----
t('refuses bytes that are not EBML', () => {
  assert.throws(() => readMatroskaHeader(Buffer.from('RIFF....WAVEfmt ')), MatroskaError);
});
t('refuses an EBML doc type that is not matroska or webm', () => {
  assert.throws(() => readMatroskaHeader(Buffer.concat([ebmlHead('mide'), el('Segment')])), /doc type/);
});
t('refuses a child whose size runs past its parent', () => {
  const bad = Buffer.concat([ebmlHead(), hex(E.Segment), vsize(8), hex(E.Info), vsize(200), Buffer.alloc(5)]);
  assert.throws(() => readMatroskaHeader(bad), /past its parent/);
});
t('refuses a child that runs past its parent inside a header element', () => {
  const info = Buffer.concat([hex(E.Info), vsize(6), hex(E.Duration), vsize(8), f64(1).subarray(0, 3), Buffer.alloc(20)]);
  assert.throws(() => readMatroskaHeader(Buffer.concat([ebmlHead(), el('Segment', info)])), /runs past its parent/);
});
t('refuses an unknown size inside a header element', () => {
  const info = el('Info', hex(E.Title), hex('01FFFFFFFFFFFFFF'), s('x'));
  assert.throws(() => readMatroskaHeader(Buffer.concat([ebmlHead(), el('Segment', info)])), /unknown size inside/);
});
t('refuses an invalid variable-length integer (a zero first byte)', () => {
  assert.throws(() => readMatroskaHeader(Buffer.concat([ebmlHead(), hex(E.Segment), Buffer.from([0x00, 0x01])])), MatroskaError);
});
t('refuses nesting deeper than the bound', () => {
  let x = el('ChapterDisplay', el('ChapString', s('x')));
  for (let i = 0; i < 40; i++) x = el('ChapterAtom', x);
  const b = Buffer.concat([ebmlHead(), el('Segment', el('Chapters', el('EditionEntry', x)))]);
  assert.throws(() => readMatroskaHeader(b), /nesting deeper/);
});
t('the same bytes read twice give the same facts (a pure function)', () => {
  assert.deepStrictEqual(readMatroskaHeader(film()), readMatroskaHeader(film()));
});
t('a 64-bit UID is kept whole, digit for digit', () => {
  const big = Buffer.from('8000000000000001', 'hex'); // 2^63 + 1: not representable as a JS number
  const b = Buffer.concat([ebmlHead(), el('Segment', el('Tracks', el('TrackEntry', el('TrackNumber', u(1)), el('TrackUID', big), el('TrackType', u(2)))))]);
  assert.strictEqual(readMatroskaHeader(b).tracks[0].uid, '9223372036854775809');
});
t('a string padded with NUL bytes reads up to the first NUL', () => {
  const b = Buffer.concat([ebmlHead(), el('Segment', el('Tracks', el('TrackEntry', el('TrackNumber', u(1)), el('TrackType', u(2)), el('CodecID', Buffer.from('A_AAC\0\0\0', 'latin1')))))]);
  assert.strictEqual(readMatroskaHeader(b).tracks[0].codec_id, 'A_AAC');
});
t('Void and CRC-32 padding is skipped', () => {
  const b = Buffer.concat([ebmlHead(), el('Segment', el('Void', Buffer.alloc(3)), el('Info', el('Void', Buffer.alloc(1)), el('Duration', f64(5))))]);
  assert.strictEqual(readMatroskaHeader(b).duration_ns, 5 * 1000000);
});

// ---- the oracle: ffmpeg writes, ffprobe reads, the reader must agree (skipped and said so when absent) ----
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const have = (bin) => spawnSync(bin, ['-version'], { encoding: 'utf8' }).status === 0;
function probe(file) {
  const p = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', file], { encoding: 'utf8' });
  if (!p.stdout || !p.stdout.trim()) throw new Error(p.stderr);
  return JSON.parse(p.stdout);
}
if (have('ffmpeg') && have('ffprobe')) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkvh-'));
  const meta = path.join(dir, 'ch.txt');
  fs.writeFileSync(meta, ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=Opening\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1000\nEND=2000\ntitle=Close\n');
  const out = path.join(dir, 'oracle.mkv');
  const mk = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-f', 'lavfi', '-i', 'color=c=black:s=64x48:d=2:r=10',
    '-i', meta, '-map', '1:v', '-map', '0:a', '-map_chapters', '2', '-c:v', 'mpeg4', '-c:a', 'pcm_s16le', '-metadata:s:a:0', 'language=fre',
    '-disposition:a:0', 'default+hearing_impaired+original', '-disposition:v:0', '0', out], { encoding: 'utf8' });
  if (mk.status !== 0) { skip('ffprobe oracle', `ffmpeg could not write the fixture: ${mk.stderr.trim()}`); }
  else {
    const p = probe(out); let r = null;
    t('oracle: reads the ffmpeg-written file (64-bit UIDs kept whole as strings)', () => {
      r = readMatroskaHeader(fs.readFileSync(out));
      assert.ok(/^[0-9]+$/.test(r.tracks[0].uid));
    });
    if (r === null) r = { duration_ns: NaN, tracks: [{ flags: {} }, { flags: {} }], editions: [] };
    t('oracle: running time agrees with ffprobe to the millisecond', () => {
      assert.ok(Math.abs(r.duration_ns / 1e9 - Number(p.format.duration)) < 0.001, `${r.duration_ns / 1e9} vs ${p.format.duration}`);
    });
    t('oracle: the track list and codec kinds agree with ffprobe', () => {
      assert.deepStrictEqual(r.tracks.map((x) => x.kind), p.streams.map((x) => x.codec_type));
    });
    t('oracle: languages and the six flags agree with ffprobe', () => {
      const a = r.tracks[1]; const ps = p.streams[1];
      assert.strictEqual(a.language, ps.tags.language);
      assert.strictEqual(a.flags.default, ps.disposition.default === 1);
      assert.strictEqual(a.flags.hearing_impaired, ps.disposition.hearing_impaired === 1);
      assert.strictEqual(a.flags.original, ps.disposition.original === 1);
      assert.strictEqual(r.tracks[0].flags.default, p.streams[0].disposition.default === 1);
    });
    t('oracle: chapters agree with ffprobe (start, end, title)', () => {
      const mine = r.editions.flatMap((e) => e.chapters).map((c) => [c.start_ns / 1e9, c.end_ns / 1e9, c.titles[0] && c.titles[0].title]);
      const theirs = p.chapters.map((c) => [Number(c.start_time), Number(c.end_time), c.tags && c.tags.title]);
      assert.deepStrictEqual(mine, theirs);
    });
    // The hand-built film carries IDs ffmpeg 6.1 never writes. ffprobe 6.1 reads back FlagOriginal, FlagVisualImpaired,
    // FlagForced, ChapterTimeStart/End and ChapString, so those IDs are witnessed. It does NOT read LanguageBCP47
    // (0x22B59D), FlagTextDescriptions (0x55AD) or ChapLanguageBCP47 (0x437D): it reports the ISO code and no
    // descriptions disposition. Those three rest on RFC 9559 and on their witnessed neighbours (0x22B59C; 0x55AA-AC, AE),
    // and the run below says so instead of claiming the oracle covered them.
    const fpath = path.join(dir, 'film.mkv'); fs.writeFileSync(fpath, film());
    const fp = probe(fpath); const fr = readMatroskaHeader(film());
    t('oracle: ffprobe reads the hand-built film the same way where it reads at all (original, visual-impaired, forced, chapters)', () => {
      assert.strictEqual(fp.streams[2].tags.language, fr.tracks[2].language_iso639_2, 'ffprobe 6.1 reports the ISO code');
      assert.strictEqual(fp.streams[2].disposition.visual_impaired, 1);
      assert.strictEqual(fp.streams[3].disposition.forced, 1);
      assert.strictEqual(fp.streams[1].disposition.original, 1);
      assert.strictEqual(fp.streams[1].disposition.default, 1);
      assert.strictEqual(fp.streams[2].disposition.default, 0);
      const visible = fr.editions.flatMap((e) => e.chapters).filter((c) => !c.hidden).map((c) => [c.start_ns / 1e9, c.titles[0].title]);
      assert.deepStrictEqual(fp.chapters.map((c) => [Number(c.start_time), c.tags.title]), visible);
    });
    const wit = fp.streams[2].tags.language === 'pt-BR' && fp.streams[2].disposition.descriptions === 1;
    console.log(wit ? 'WITNESS LanguageBCP47 + FlagTextDescriptions read back by this ffprobe' :
      'UNWITNESSED by this ffprobe: LanguageBCP47 0x22B59D, FlagTextDescriptions 0x55AD, ChapLanguageBCP47 0x437D (RFC 9559; neighbours witnessed)');
    fs.rmSync(dir, { recursive: true, force: true });
  }
} else {
  skip('ffprobe oracle (5 checks)', 'ffmpeg or ffprobe is not on this machine; the hand-built vectors still ran');
}

console.log(`matroska-header: ${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed ? 1 : 0);
