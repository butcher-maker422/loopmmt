#!/usr/bin/env node
/*
 * sign-fold — the signed three-way residual over a declared budget.
 *
 * A GIFT (candidate) from Loop MMT. MIT. Zero dependencies. Single file, Node or browser.
 * Reads a JSONL stream of {declared, actual[, label]} and, per record, emits the
 * residual (actual - declared) and its sign: "over" | "at" | "under". Plus a roll-up.
 *
 * PRINTED EDGE (the limits, on the tool):
 *   Signed residual over a DECLARED number. Exact equality — no epsilon; a caller that
 *   wants tolerance bins `residual` itself. It reports the SIGN, never the VIRTUE:
 *   actual >= declared means the count relation holds, not that the work is good. The
 *   floor is only as honest as the declaration.
 *
 * License: MIT. SPDX-License-Identifier: MIT
 */
'use strict';

// ---- core (pure) ----------------------------------------------------------

function signOf(residual) {
  if (residual > 0) return 'over';
  if (residual < 0) return 'under';
  return 'at';
}

function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

// Compute one output record from one parsed input object. Throws on shape errors.
function computeRecord(rec, lineNo) {
  if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
    throw new Error('line ' + lineNo + ': record must be a JSON object');
  }
  var D = rec.declared, A = rec.actual;
  if (!isFiniteNumber(D)) {
    throw new Error('line ' + lineNo + ': "declared" must be a finite number');
  }
  if (!isFiniteNumber(A)) {
    throw new Error('line ' + lineNo + ': "actual" must be a finite number');
  }
  var label = ('label' in rec) ? rec.label : null;
  var residual = A - D;
  return { label: label, declared: D, actual: A, residual: residual, sign: signOf(residual) };
}

// Fold a whole JSONL text into {lines, roll}. Pure: same bytes in -> same bytes out.
function fold(text) {
  var out = [];
  var roll = { over: 0, at: 0, under: 0, count: 0 };
  var rawLines = String(text).split('\n');
  for (var i = 0; i < rawLines.length; i++) {
    var line = rawLines[i];
    if (line.length && line.charCodeAt(line.length - 1) === 13) {
      line = line.slice(0, -1); // trim trailing CR
    }
    if (line.trim() === '') continue; // skip blank lines
    var parsed;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      throw new Error('line ' + (i + 1) + ': not valid JSON');
    }
    var r = computeRecord(parsed, i + 1);
    out.push(r);
    roll[r.sign] += 1;
    roll.count += 1;
  }
  return { lines: out, roll: roll };
}

// ---- CLI ------------------------------------------------------------------

function runCli(argv, io) {
  // io = {readFileSync, stdinText, write, writeErr}
  var args = argv.slice(2);
  var file = null;
  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    if (a === '-h' || a === '--help') {
      io.write(
        'sign-fold — signed 3-way residual over a declared budget.\n' +
        'usage: sign-fold.js [FILE]   (reads stdin if no FILE)\n' +
        'in:  JSONL of {"declared":D,"actual":A[,"label":L]}\n' +
        'out: JSONL of {label,declared,actual,residual,sign} + a final {"roll":{...}}\n' +
        'sign: over (A>D) | at (A==D) | under (A<D). Exact equality, no epsilon.\n' +
        'edge: reports the SIGN, not the VIRTUE; the floor is only as honest as the declaration.\n'
      );
      return 0;
    }
    if (a.charAt(0) === '-') {
      io.writeErr('sign-fold: unknown option ' + a + '\n');
      return 2;
    }
    if (file !== null) {
      io.writeErr('sign-fold: at most one FILE argument\n');
      return 2;
    }
    file = a;
  }
  var text;
  try {
    text = (file === null) ? io.stdinText() : io.readFileSync(file);
  } catch (e) {
    io.writeErr('sign-fold: cannot read ' + (file === null ? 'stdin' : file) + '\n');
    return 2;
  }
  var result;
  try {
    result = fold(text);
  } catch (e) {
    io.writeErr('sign-fold: ' + e.message + '\n');
    return 2;
  }
  for (var j = 0; j < result.lines.length; j++) {
    io.write(JSON.stringify(result.lines[j]) + '\n');
  }
  io.write(JSON.stringify({ roll: result.roll }) + '\n');
  return 0;
}

// ---- triple export (module / CLI / browser) -------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fold: fold, signOf: signOf, computeRecord: computeRecord };
  if (require.main === module) {
    var fs = require('fs');
    var code = runCli(process.argv, {
      readFileSync: function (f) {
        var st = fs.statSync(f);
        if (st.isDirectory()) throw new Error('is a directory');
        return fs.readFileSync(f, 'utf8');
      },
      stdinText: function () { return fs.readFileSync(0, 'utf8'); },
      write: function (s) { process.stdout.write(s); },
      writeErr: function (s) { process.stderr.write(s); }
    });
    process.exit(code);
  }
} else if (typeof window !== 'undefined') {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.signFold = { fold: fold, signOf: signOf, computeRecord: computeRecord };
}
