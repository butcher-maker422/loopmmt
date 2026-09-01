// SPDX-License-Identifier: MIT
// timeline.js — a standalone, zero-dependency validator for a timeline artifact.
//
// WHAT THIS IS
// ------------
// You have events you want to place on a timeline — a project history, a log, a
// story, a schedule. Before you RENDER them, this checks the DECLARATION is
// sound: no cycle in the "happened-before" edges, the axis names its scale, the
// operations you use are legal for that scale, no two events collide on one
// track at one instant, and the sort key is deterministic. It reads one JSON
// object and returns a verdict. It is a pure function: the same artifact always
// yields the same verdict.
//
// THE ARTIFACT (the shape it checks):
//   {
//     "frame": { "scale": "nominal"|"ordinal"|"interval"|"ratio",   // REQUIRED
//                "grain": <ms|null>,
//                "topology": "S1"|null, "period": <number>,          // optional circular axis
//                "foliation": { "key": <field|"t">, "dir": "asc"|"desc" } },
//     "events": [ { "id": <str>, "t": <ms int>, "parents": [<id>...],
//                   "track": <str>, "kind": <str>, "duration": <ms>,
//                   "label": <str> }, ... ]
//   }
//
// THE CHECKS (each decidable from the declaration alone):
//   C0 well-formed .... every event is an object with an `id`.
//   C1 real-order ..... parent edges form a DAG and resolve (no cycle, no dangling edge).
//   C2 scale-declared . frame.scale is an explicit Stevens level — no implicit gauge.
//   C3 stevens-legal .. ops used are legal for the level (ordering needs ordinal+;
//                       a `duration` needs interval+, a difference of points).
//   C4 instant/dur .... a `duration` with no anchoring instant is a length, not a point.
//   C5 no-collision ... two events on the same track at the same instant break the
//                       overlay obligation (unless a non-`t` foliation orders them).
//   C6 fold-safety .... the foliation key is a real declared field (or "t"), never a
//                       nondeterministic sentinel ("now"/"random"/"index"/...).
//   C7 leak-safety .... no event bakes a shared day bucket ("dayKey"/"day"/...);
//                       day buckets are render-derived per frame, not authored.
//   C8 cyclic-topology  a DECLARED circular axis (S1 + period) has its coordinates
//                       reduced into one period (mod the period).
//
// THE PRINTED EDGE (what this is NOT):
//   This is a PRESENCE checker, not a CORRECTNESS oracle. C2 checks a scale is
//   DECLARED and self-consistent with the ops used — never that the declared
//   level is the RIGHT one. It does not prove your renderer is a pure fold; that
//   is a runtime property this static check cannot reach. It reports the
//   trajectory; choosing the true scale, and proving the render pure, stay yours.
//
// USAGE
//   node timeline.js artifact.json      # lint a file
//   cat artifact.json | node timeline.js  # lint stdin
//   node timeline.js --help
//   In a browser: window.ForestGifts.timelineLint(artifactObject)
//   In Node code: require('./timeline.js').timelineLint(artifactObject)
//
// Exit: 0 CLEAN | 3 FLAG | 2 USAGE (malformed input).

'use strict';

// Stevens' levels as a strict tower — each a superset of the one below.
var STEVENS = { nominal: 0, ordinal: 1, interval: 2, ratio: 3 };

// Foliation keys that are NOT a real, replayable field — a sort on any of these
// makes the render depend on WHEN it ran, breaking folds-twice-identical.
var NONDETERMINISTIC_KEYS = {
  'now': 1, 'random': 1, 'rand': 1, 'index': 1, 'render-order': 1,
  'renderorder': 1, 'time()': 1, 'date.now': 1, 'uuid': 1, 'order-of-arrival': 1
};

// Baked day-bucket field names: a per-event day column is a frame-independent
// bucket authored into the data — exactly the cross-frame leak the render must
// derive per-frame instead.
var BAKED_DAY_FIELDS = { 'daykey': 1, 'day': 1, 'datebucket': 1, 'date_bucket': 1 };

function finding(check, eventId, msg) {
  return { check: check, event: eventId, msg: msg };
}

function has(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// --- C1: axis is a real order (DAG + resolvable parents) --------------------
function checkOrder(events, ids, findings) {
  // dangling parent
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    var parents = ev.parents || [];
    for (var j = 0; j < parents.length; j++) {
      if (!ids[String(parents[j])]) {
        findings.push(finding('C1-real-order', ev.id,
          "parent '" + parents[j] + "' resolves to no event (dangling edge)"));
      }
    }
  }
  // cycle (iterative DFS with colouring: 0 unseen, 1 on-stack, 2 done)
  var byId = {};
  for (var k = 0; k < events.length; k++) byId[String(events[k].id)] = events[k];
  var color = {};

  function visit(start) {
    var stack = [{ node: start, parents: (byId[start] && byId[start].parents) || [], pos: 0 }];
    color[start] = 1;
    while (stack.length) {
      var top = stack[stack.length - 1];
      var advanced = false;
      while (top.pos < top.parents.length) {
        var p = String(top.parents[top.pos]);
        top.pos++;
        if (!has(byId, p)) continue; // dangling already reported above
        var c = color[p] || 0;
        if (c === 1) {
          findings.push(finding('C1-real-order', top.node,
            "parent edge to '" + p + "' closes a cycle (axis is not a poset)"));
          continue;
        }
        if (c === 0) {
          color[p] = 1;
          stack.push({ node: p, parents: (byId[p] && byId[p].parents) || [], pos: 0 });
          advanced = true;
          break;
        }
      }
      if (!advanced) {
        color[top.node] = 2;
        stack.pop();
      }
    }
  }

  for (var m = 0; m < events.length; m++) {
    var id = String(events[m].id);
    if ((color[id] || 0) === 0) visit(id);
  }
}

// --- C2: scale is declared (an explicit Stevens level; no implicit gauge) ---
function checkScaleDeclared(frame, findings) {
  var scale = has(frame, 'scale') ? frame.scale : null;
  if (scale === null || scale === undefined) {
    findings.push(finding('C2-scale-declared', null,
      'frame declares no scale -- an implicit gauge is forbidden'));
    return null;
  }
  if (!has(STEVENS, scale)) {
    findings.push(finding('C2-scale-declared', null,
      "frame.scale '" + scale + "' is not a Stevens level (nominal|ordinal|interval|ratio)"));
    return null;
  }
  return scale;
}

// --- C3: Stevens-legal ops for the declared level ---------------------------
function checkStevensLegal(scale, frame, events, findings) {
  if (scale === null) return; // C2 already flagged
  var rank = STEVENS[scale];
  var fol = frame.foliation || {};
  var folKey = has(fol, 'key') ? fol.key : 't';
  if (rank < STEVENS.ordinal) {
    if (folKey !== null && folKey !== undefined && folKey !== 't') {
      findings.push(finding('C3-stevens-legal', null,
        "foliation orders by '" + folKey + "' but a nominal axis has no order"));
    }
    for (var i = 0; i < events.length; i++) {
      if (events[i].parents && events[i].parents.length) {
        findings.push(finding('C3-stevens-legal', events[i].id,
          'event declares a causal order on a nominal axis'));
      }
    }
  }
  if (rank < STEVENS.interval) {
    for (var j = 0; j < events.length; j++) {
      if (has(events[j], 'duration')) {
        findings.push(finding('C3-stevens-legal', events[j].id,
          'a `duration` needs an interval+ axis (difference of points is undefined at ' + scale + ')'));
      }
    }
  }
}

// --- C4: Instant / Duration not confused ------------------------------------
function checkInstantDuration(events, findings) {
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    var hasDur = has(ev, 'duration');
    var hasAnchor = (ev.t !== null && ev.t !== undefined) ||
                    (ev.start !== null && ev.start !== undefined);
    if (hasDur && !hasAnchor) {
      findings.push(finding('C4-instant-duration', ev.id,
        'a `duration` with no anchoring instant is a length, not a point'));
    }
    if (ev.t_type === 'duration') {
      findings.push(finding('C4-instant-duration', ev.id,
        '`t` is typed a duration -- the axis coordinate must be an Instant'));
    }
  }
}

// --- C5: overlay tracks don't collide on a shared instant -------------------
function checkNoCollision(frame, events, findings) {
  var fol = (frame || {}).foliation || {};
  var folKey = has(fol, 'key') ? fol.key : 't';
  var resolves = folKey !== null && folKey !== undefined && String(folKey) !== 't';
  var seen = {}; // "track\x00t" -> array of {id, fv}
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    var t = ev.t;
    if (t === null || t === undefined) continue;
    var track = has(ev, 'track') ? ev.track : '_default';
    var fv = resolves ? (has(ev, folKey) ? ev[folKey] : undefined) : null;
    var key = String(track) + '\x00' + String(t);
    var bucket = seen[key];
    if (bucket) {
      var unresolved = (!resolves) || (fv === null || fv === undefined);
      if (!unresolved) {
        for (var b = 0; b < bucket.length; b++) {
          var pv = bucket[b].fv;
          if (pv === null || pv === undefined || pv === fv) { unresolved = true; break; }
        }
      }
      if (unresolved) {
        findings.push(finding('C5-no-collision', ev.id,
          "collides with '" + bucket[0].id + "' on track '" + track + "' at instant " + t +
          ' (overlay X obligation broken)'));
      }
      bucket.push({ id: ev.id, fv: fv });
    } else {
      seen[key] = [{ id: ev.id, fv: fv }];
    }
  }
}

// --- C6: fold-safety (static proxy for "render is a pure fold") -------------
function checkFoldSafety(frame, events, findings) {
  var fol = frame.foliation || {};
  var key = has(fol, 'key') ? fol.key : 't';
  if (key === null || key === undefined) return;
  if (NONDETERMINISTIC_KEYS[String(key).trim().toLowerCase()]) {
    findings.push(finding('C6-fold-safety', null,
      "foliation key '" + key + "' is nondeterministic -- breaks folds-twice-identical (the Ink Law)"));
    return;
  }
  if (key !== 't') {
    var carried = false;
    for (var i = 0; i < events.length; i++) {
      if (has(events[i], key)) { carried = true; break; }
    }
    if (!carried) {
      findings.push(finding('C6-fold-safety', null,
        "foliation key '" + key + "' is carried by no event (the declared sort would silently fall back to `t`)"));
    }
  }
}

// --- C7: leak-safety (static proxy for "no cross-frame day-leak") -----------
function checkLeakSafety(events, findings) {
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    var keys = Object.keys(ev);
    for (var j = 0; j < keys.length; j++) {
      if (BAKED_DAY_FIELDS[String(keys[j]).trim().toLowerCase()]) {
        findings.push(finding('C7-leak-safety', ev.id,
          "event bakes a day bucket ('" + keys[j] + "') -- day buckets are render-derived per-frame, not authored (cross-frame leak)"));
        break;
      }
    }
  }
}

// --- C8: cyclic-topology (a DECLARED circular axis is reduced mod period) ---
function checkCyclicTopology(frame, events, findings) {
  var topo = has(frame, 'topology') ? frame.topology : null;
  if (topo === null || topo === undefined) return;
  if (topo !== 'S1') {
    findings.push(finding('C8-cyclic-topology', null,
      "frame.topology '" + topo + "' is not a recognized axis topology (S1 = a periodic circle)"));
    return;
  }
  var period = frame.period;
  if (typeof period !== 'number' || period <= 0 || period !== period) {
    findings.push(finding('C8-cyclic-topology', null,
      'an S1 topology needs a positive numeric `period` (the wrap modulus, e.g. 1440 minutes)'));
    return;
  }
  for (var i = 0; i < events.length; i++) {
    var t = events[i].t;
    if (t === null || t === undefined) continue;
    if (!(t >= 0 && t < period)) {
      findings.push(finding('C8-cyclic-topology', events[i].id,
        'instant ' + t + ' is not reduced into [0,' + period + ') -- a circular coordinate must be taken mod the period'));
    }
  }
}

// --- the lint ---------------------------------------------------------------
function timelineLint(artifact) {
  if (artifact === null || typeof artifact !== 'object' || Array.isArray(artifact)) {
    return { verdict: 'USAGE', error: 'artifact is not a JSON object' };
  }
  var frame = artifact.frame;
  var events = artifact.events;
  if (frame === null || typeof frame !== 'object' || Array.isArray(frame) || !Array.isArray(events)) {
    return { verdict: 'USAGE', error: 'artifact needs a `frame` object and an `events` list' };
  }

  var findings = [];
  var valid = [];
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (ev === null || typeof ev !== 'object' || Array.isArray(ev) ||
        ev.id === null || ev.id === undefined) {
      findings.push(finding('C0-well-formed', 'index ' + i, 'event is not an object with an `id`'));
    } else {
      valid.push(ev);
    }
  }
  var ids = {};
  for (var v = 0; v < valid.length; v++) ids[String(valid[v].id)] = 1;

  var scale = checkScaleDeclared(frame, findings);
  checkOrder(valid, ids, findings);
  checkStevensLegal(scale, frame, valid, findings);
  checkInstantDuration(valid, findings);
  checkNoCollision(frame, valid, findings);
  checkFoldSafety(frame, valid, findings);
  checkLeakSafety(valid, findings);
  checkCyclicTopology(frame, valid, findings);

  var checksRun = ['C0-well-formed', 'C1-real-order', 'C2-scale-declared',
    'C3-stevens-legal', 'C4-instant-duration', 'C5-no-collision',
    'C6-fold-safety', 'C7-leak-safety', 'C8-cyclic-topology'];
  return {
    verdict: findings.length ? 'FLAG' : 'CLEAN',
    checks: checksRun,
    findings: findings,
    runtime_owned_by_renderer: ['render-is-a-pure-fold', 'no-cross-frame-day-leak']
  };
}

var HELP = [
  'timeline.js — validate a timeline artifact before you render it.',
  '',
  'Usage:',
  '  node timeline.js artifact.json     lint a file',
  '  cat artifact.json | node timeline.js   lint stdin',
  '  node timeline.js --help',
  '',
  'Reads one JSON object {frame, events}; prints a verdict; exits',
  '  0 CLEAN · 3 FLAG · 2 USAGE.',
  '',
  'Edge: this is a PRESENCE checker, not a CORRECTNESS oracle. It confirms a',
  'scale is declared and self-consistent with the ops used — never that the',
  'declared level is the right one, and it does not prove your renderer is pure.'
].join('\n');

// --- surfaces: browser attach, Node require, Node CLI -----------------------
if (typeof window !== 'undefined') {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.timelineLint = timelineLint;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { timelineLint: timelineLint };
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  var argv = process.argv.slice(2);
  if (argv.indexOf('--help') !== -1 || argv.indexOf('-h') !== -1) {
    process.stdout.write(HELP + '\n');
    process.exit(0);
  }
  var readInput = function (cb) {
    if (argv[0]) {
      try { cb(require('fs').readFileSync(argv[0], 'utf8')); }
      catch (e) { process.stdout.write(JSON.stringify({ verdict: 'USAGE', error: String(e.message || e) }) + '\n'); process.exit(2); }
    } else {
      var chunks = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', function (d) { chunks += d; });
      process.stdin.on('end', function () { cb(chunks); });
    }
  };
  readInput(function (raw) {
    var artifact;
    try { artifact = JSON.parse(raw); }
    catch (e) { process.stdout.write(JSON.stringify({ verdict: 'USAGE', error: String(e.message || e) }) + '\n'); process.exit(2); }
    var out = timelineLint(artifact);
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    process.exit(out.verdict === 'USAGE' ? 2 : (out.verdict === 'FLAG' ? 3 : 0));
  });
}
