#!/usr/bin/env node
/*
 * gantt-sink — turn (start,end,label) tasks into one standalone, deterministic Gantt SVG, no deps.
 * MIT · zero-dependency · standalone gift · lane: sink (consumes data, emits an artifact).
 *
 * THE PRINTED EDGE (read before trusting the output):
 *   This is a timeline-bar primitive, not a project-management tool. It draws one horizontal
 *   <rect> bar per task, top to bottom in INPUT ORDER, inside a plain <svg> frame, with each
 *   task's LABEL as one <text> element beside its bar. It renders NO axes, gridlines, tick
 *   marks, date labels, dependency arrows, legend, or interactivity, and it embeds NO fonts
 *   and NO <script>. Unlike its render-sink siblings, gantt-sink DOES place caller text in the
 *   output — the label — so it carries the one injection surface the numbers-only gifts avoid.
 *   That surface is closed DELIBERATELY: every label is XML-escaped (& < > " '), so a caller
 *   string can NEVER break out of <text> content into markup. Bar colors are NOT free-form
 *   input — bars are painted from a fixed, named palette (index = row), so no attacker-chosen
 *   attribute string can appear. A non-finite start/end, an end before its start, or a
 *   non-string label is a HARD ERROR, never silently dropped or guessed. Output is a PURE
 *   FUNCTION of the input: same tasks in → byte-identical SVG out.
 *
 * USAGE:
 *   printf '[0,3,"design"]\n[2,5,"build"]\n' | node gantt-sink.js         # two-row timeline
 *   printf '{"start":0,"end":4,"label":"spec"}\n' | node gantt-sink.js     # object tasks
 *   echo '{"tasks":[[0,2,"a"],[1,4,"b"]],"palette":"cool"}' | node gantt-sink.js
 *   node gantt-sink.js --help
 *
 * INPUT (stdin): either
 *   - JSONL — one task per line, each `[start,end,label]` or `{"start":S,"end":E,"label":"…"}`
 *   - a single JSON spec object { tasks, min, max, width, row, pad, palette }
 *   start,end are finite numbers (timeline positions, end >= start); label is a STRING.
 *   CLI flags (--width --row --pad --min --max --palette) OVERRIDE object fields.
 *
 * OUTPUT (stdout): one SVG document string (UTF-8), trailing newline. No tasks → an empty frame.
 *
 * DETERMINISM: fixed 3-decimal coordinate precision, stable attribute order, rows emitted in
 *   input order, bar color indexed by row from a fixed palette, every label XML-escaped. No
 *   wall-clock, no randomness. Same tasks → same bytes, in Node or a browser.
 * PORTABILITY: pure JS on plain arrays/strings — identical in Node and the browser.
 */
'use strict';

// ---- palettes (the ONLY source of bar color; no free-form color input) ----------
var PALETTES = {
  loop: ['#2f6f8f', '#c25b3a', '#4a8a52', '#8a6d3b', '#6d4a8a', '#3b6d8a'],
  mono: ['#111111', '#555555', '#999999', '#bbbbbb'],
  warm: ['#c25b3a', '#d98a3a', '#b23b3b', '#8a5a2b'],
  cool: ['#2f6f8f', '#4a8a8a', '#3b5a8a', '#5a6d8a']
};
var TEXT_FILL = '#111111';   // fixed label color, never caller input
var FONT_SIZE = 11;          // fixed label size (a number, not an embedded font)
var DEFAULTS = { width: 204, row: 20, pad: 2, palette: 'loop' };

// ---- deterministic number formatting (verbatim from svg-sink) -------------------
var PRECISION = 3, SCALE = 1000;
function num(x) {
  var r = Math.round(x * SCALE) / SCALE;
  var s = r.toFixed(PRECISION);
  s = s.replace(/\.?0+$/, '');
  return (s === '' || s === '-0') ? '0' : s;
}

// ---- XML escaping — THE deliberate injection surface, closed here ----------------
// Every caller label passes through this before entering <text> content. Order matters:
// the ampersand is replaced FIRST so the entities introduced below are not double-escaped.
function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- validation helpers --------------------------------------------------------
function finiteNum(v, i, which) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('task[' + i + '] ' + which + ' is not a finite number: ' + JSON.stringify(v));
  }
  return v;
}
function posInt(v, dflt, name) {
  if (v == null) return dflt;
  var n = Number(v);
  if (!isFinite(n) || Math.floor(n) !== n || n <= 0) throw new Error(name + ' must be a positive integer, got ' + JSON.stringify(v));
  return n;
}
function numOrThrow(v, name) {
  var n = Number(v);
  if (typeof n !== 'number' || !isFinite(n)) throw new Error(name + ' must be a finite number, got ' + JSON.stringify(v));
  return n;
}

// ---- one task -> {start,end,label}  (accepts [start,end,label] or {start,end,label}) ----
function asTask(raw, i) {
  var start, end, label;
  if (Array.isArray(raw)) {
    if (raw.length !== 3) throw new Error('task[' + i + '] array must be [start,end,label] (3 fields), got ' + JSON.stringify(raw));
    start = raw[0]; end = raw[1]; label = raw[2];
  } else if (raw && typeof raw === 'object') {
    if (!('start' in raw) || !('end' in raw) || !('label' in raw)) throw new Error('task[' + i + '] object must have start,end,label, got ' + JSON.stringify(raw));
    start = raw.start; end = raw.end; label = raw.label;
  } else {
    throw new Error('task[' + i + '] must be [start,end,label] or {start,end,label}, got ' + JSON.stringify(raw));
  }
  finiteNum(start, i, 'start'); finiteNum(end, i, 'end');
  if (end < start) throw new Error('task[' + i + '] end (' + end + ') is before start (' + start + ')');
  if (typeof label !== 'string') throw new Error('task[' + i + '] label must be a string, got ' + JSON.stringify(label));
  return { start: start, end: end, label: label };
}

// ---- scale (shared timeline domain across all tasks) ---------------------------
function domain(tasks, min, max) {
  var lo = (min != null) ? Number(min) : Infinity;
  var hi = (max != null) ? Number(max) : -Infinity;
  if (min == null || max == null) {
    for (var i = 0; i < tasks.length; i++) {
      if (min == null && tasks[i].start < lo) lo = tasks[i].start;
      if (max == null && tasks[i].end > hi) hi = tasks[i].end;
    }
  }
  if (!isFinite(lo)) lo = 0;
  if (!isFinite(hi)) hi = 0;
  if (lo === hi) { lo -= 1; hi += 1; } // all-instant tasks -> unit window, never a divide-by-0
  return { lo: lo, hi: hi };
}

// ---- input normalization -------------------------------------------------------
function normalize(input, flags) {
  var spec = {};
  var tasksRaw;
  if (input && !Array.isArray(input) && typeof input === 'object') {
    tasksRaw = input.tasks;
    if (input.min     != null) spec.min     = input.min;
    if (input.max     != null) spec.max     = input.max;
    if (input.width   != null) spec.width   = input.width;
    if (input.row     != null) spec.row     = input.row;
    if (input.pad     != null) spec.pad     = input.pad;
    if (input.palette != null) spec.palette = input.palette;
  } else {
    tasksRaw = input;
  }
  flags = flags || {};
  for (var k in flags) if (flags[k] != null) spec[k] = flags[k];

  if (tasksRaw == null) tasksRaw = [];
  if (!Array.isArray(tasksRaw)) throw new Error('input has no tasks (expected [[start,end,label],...] or a {tasks:...} object)');
  spec.tasks   = tasksRaw.map(asTask);
  spec.width   = posInt(spec.width, DEFAULTS.width, 'width');
  spec.row     = posInt(spec.row,   DEFAULTS.row,   'row');
  spec.pad     = (spec.pad != null) ? posIntOrZero(spec.pad, 'pad') : DEFAULTS.pad;
  spec.palette = (spec.palette != null) ? String(spec.palette) : DEFAULTS.palette;
  if (spec.min != null) spec.min = numOrThrow(spec.min, 'min');
  if (spec.max != null) spec.max = numOrThrow(spec.max, 'max');
  if (spec.min != null && spec.max != null && spec.min >= spec.max) {
    throw new Error('min must be < max (got min=' + spec.min + ', max=' + spec.max + ')');
  }
  if (!PALETTES[spec.palette]) throw new Error('unknown palette "' + spec.palette + '" (expected ' + Object.keys(PALETTES).join(' | ') + ')');
  if (spec.width <= 2 * spec.pad) throw new Error('width too small for pad (need width > 2*pad)');
  return spec;
}
function posIntOrZero(v, name) {
  var n = Number(v);
  if (!isFinite(n) || Math.floor(n) !== n || n < 0) throw new Error(name + ' must be a non-negative integer, got ' + JSON.stringify(v));
  return n;
}

// ---- core: renderGantt(spec) -> string  (pure, the whole gift) ------------------
function gantt(input, flags) {
  var spec = normalize(input, flags);
  var tasks = spec.tasks, W = spec.width, rowH = spec.row, pad = spec.pad;
  var n = tasks.length;
  var H = 2 * pad + n * rowH;
  var innerW = W - 2 * pad;
  var pal = PALETTES[spec.palette];
  var dom = domain(tasks, spec.min, spec.max);
  function X(t) { return pad + ((t - dom.lo) / (dom.hi - dom.lo)) * innerW; }

  var body = [];
  for (var i = 0; i < n; i++) {          // rows in INPUT ORDER (a gantt is an ordered list)
    var t = tasks[i];
    var rowTop = pad + i * rowH;
    var x = X(t.start), w = X(t.end) - X(t.start);
    var barY = rowTop + 3, barH = rowH - 6;
    var color = pal[i % pal.length];
    body.push('<rect x="' + num(x) + '" y="' + num(barY) + '" width="' + num(w) +
              '" height="' + num(barH) + '" fill="' + color + '" />');
    // the label — THE injection surface — escaped before it enters <text> content.
    body.push('<text x="' + num(x + 2) + '" y="' + num(rowTop + rowH - 6) +
              '" font-size="' + FONT_SIZE + '" fill="' + TEXT_FILL + '">' + xmlEscape(t.label) + '</text>');
  }

  var open = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '">';
  return open + '\n' + (body.length ? body.join('\n') + '\n' : '') + '</svg>\n';
}

// ---- exports (browser attach · require · direct run) ---------------------------
if (typeof window !== 'undefined') {
  window.LoopGifts = window.LoopGifts || {};
  window.LoopGifts['gantt-sink'] = { gantt: gantt, PALETTES: PALETTES, xmlEscape: xmlEscape };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { gantt: gantt, num: num, normalize: normalize, domain: domain, xmlEscape: xmlEscape, PALETTES: PALETTES, TEXT_FILL: TEXT_FILL };
}

// ---- cli -----------------------------------------------------------------------
var HELP =
'gantt-sink — (start,end,label) tasks -> a standalone, deterministic Gantt SVG, zero deps.\n\n' +
"  printf '[0,3,\"design\"]\\n[2,5,\"build\"]\\n' | node gantt-sink.js\n" +
"  printf '{\"start\":0,\"end\":4,\"label\":\"spec\"}\\n' | node gantt-sink.js\n" +
"  echo '{\"tasks\":[[0,2,\"a\"],[1,4,\"b\"]]}' | node gantt-sink.js --palette cool\n\n" +
'INPUT (stdin): JSONL of [start,end,label] or {start,end,label} tasks (one per line), OR a\n' +
'{tasks,...} spec object. Flags (override object fields): --width N  --row N  --pad N\n' +
'                                                          --min N  --max N  --palette loop|mono|warm|cool\n\n' +
'One <rect> bar + one <text> label per task, in input order; no axes/dates/arrows/legend. Bar\n' +
'colors come from a fixed named palette (not caller input). Labels are XML-escaped — caller text\n' +
'can never break out of markup. Non-finite start/end, end<start, or a non-string label -> error.\n';

function parseFlags(argv) {
  var f = {};
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--width')   f.width   = Number(argv[++i]);
    else if (a === '--row') f.row    = Number(argv[++i]);
    else if (a === '--pad') f.pad    = Number(argv[++i]);
    else if (a === '--min') f.min    = Number(argv[++i]);
    else if (a === '--max') f.max    = Number(argv[++i]);
    else if (a === '--palette') f.palette = argv[++i];
  }
  return f;
}

function parseStdin(raw) {
  var trimmed = raw.trim();
  if (trimmed === '') return { tasks: [] };
  if (trimmed.charAt(0) === '{') {
    try {
      var obj = JSON.parse(trimmed);
      if (obj && !Array.isArray(obj) && typeof obj === 'object' && 'tasks' in obj) return obj;
    } catch (e) { /* fall through to JSONL */ }
  }
  var tasks = [];
  var lines = trimmed.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i].trim();
    if (ln === '') continue;
    var task;
    try { task = JSON.parse(ln); }
    catch (e) { throw new Error('line ' + (i + 1) + ' is not valid JSON: ' + e.message); }
    tasks.push(task);
  }
  return { tasks: tasks };
}

function main() {
  var argv = process.argv.slice(2);
  if (argv.indexOf('--help') !== -1 || argv.indexOf('-h') !== -1) { process.stdout.write(HELP); return; }
  var flags = parseFlags(argv);
  var chunks = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (d) { chunks += d; });
  process.stdin.on('end', function () {
    var input;
    try { input = parseStdin(chunks); }
    catch (e) { process.stderr.write('gantt-sink: ' + e.message + '\n'); process.exitCode = 1; return; }
    var svg;
    try { svg = gantt(input, flags); }
    catch (e) { process.stderr.write('gantt-sink: ' + e.message + '\n'); process.exitCode = 1; return; }
    process.stdout.write(svg);
  });
}
if (typeof require !== 'undefined' && require.main === module) { main(); }
