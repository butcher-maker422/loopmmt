#!/usr/bin/env node
/*
 * test_sign-fold.js — drift-check battery for the sign-fold gift.
 *
 * Drives the gift as a SUBPROCESS (does not import it). Checks frozen goldens,
 * one-out-per-in order, the roll-up, determinism across two runs, input-honesty
 * (exit 2) — and a MUTATION BITE: a deliberately-wrong copy of the gift must FAIL
 * the same vectors, proving the check actually catches a fault (it will not go
 * green on hope). Each expected value below is a HAND-COMPUTED fact, written
 * independently of the gift — a build cannot certify itself.
 *
 * Run: node test_sign-fold.js   (exit 0 = all pass; nonzero = a failure, named)
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GIFT = path.join(__dirname, 'sign-fold.js');
let pass = 0, fail = 0;
const notes = [];
function ok(name, cond) { if (cond) { pass++; } else { fail++; notes.push('FAIL: ' + name); } }

// run the gift on `input`, return {code, out, err}
function run(giftPath, input) {
  try {
    const out = execFileSync('node', [giftPath], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { code: 0, out, err: '' };
  } catch (e) {
    return { code: e.status == null ? -1 : e.status, out: e.stdout || '', err: e.stderr || '' };
  }
}
function lines(out) { return out.split('\n').filter(s => s.trim() !== '').map(s => JSON.parse(s)); }

// ---- 1. frozen goldens: over / at / under, order preserved -----------------
const vec = [
  '{"declared":3,"actual":5,"label":"a"}',   // over,  residual 2
  '{"declared":4,"actual":4,"label":"b"}',   // at,    residual 0
  '{"declared":9,"actual":2,"label":"c"}',   // under, residual -7
  '{"declared":-2,"actual":-2}',             // at,    label null
  '{"declared":0,"actual":-1,"label":"d"}'   // under, residual -1
].join('\n') + '\n';

const r = run(GIFT, vec);
ok('exit 0 on well-formed input', r.code === 0);
const L = lines(r.out);
ok('one-out-per-in + roll (5 records + 1 roll)', L.length === 6);
ok('record 0 = over,+2', L[0].sign === 'over' && L[0].residual === 2 && L[0].label === 'a');
ok('record 1 = at,0', L[1].sign === 'at' && L[1].residual === 0);
ok('record 2 = under,-7', L[2].sign === 'under' && L[2].residual === -7);
ok('record 3 label null', L[3].label === null && L[3].sign === 'at');
ok('order preserved (labels a,b,c,null,d)', L.slice(0,5).map(x=>x.label).join(',') === 'a,b,c,,d');
const roll = L[5].roll;
ok('roll-up {over:1,at:2,under:2,count:5}', roll && roll.over===1 && roll.at===2 && roll.under===2 && roll.count===5);

// ---- 2. determinism across two runs (byte-identical) -----------------------
const r2 = run(GIFT, vec);
ok('byte-identical across two runs', r.out === r2.out);

// ---- 3. empty stream -------------------------------------------------------
const re = run(GIFT, '\n\n');
ok('empty stream -> exit 0, roll count 0', re.code === 0 && lines(re.out).pop().roll.count === 0);

// ---- 4. input-honesty: fail closed on exit 2 -------------------------------
ok('non-JSON line -> exit 2', run(GIFT, 'not json\n').code === 2);
ok('non-object record -> exit 2', run(GIFT, '5\n').code === 2);
ok('missing "actual" -> exit 2', run(GIFT, '{"declared":3}\n').code === 2);
ok('non-finite -> exit 2', run(GIFT, '{"declared":3,"actual":"x"}\n').code === 2);
ok('unknown option -> exit 2', (function(){ try { execFileSync('node',[GIFT,'--nope'],{input:'',encoding:'utf8'}); return false;} catch(e){return e.status===2;} })());

// ---- 5. no-epsilon: 0.1+0.2 != 0.3 is honestly "over" (float truth, not hidden) ----
const rf = run(GIFT, '{"declared":0.3,"actual":0.30000000000000004}\n');
ok('no hidden epsilon (tiny positive residual reads "over")', lines(rf.out)[0].sign === 'over');

// ---- 6. THE MUTATION BITE: a wrong gift must FAIL the goldens ---------------
// Build a mutant whose signOf always returns "at" (the classic "green on hope" bug).
const src = fs.readFileSync(GIFT, 'utf8');
const mutantSrc = src.replace(
  /function signOf\(residual\) \{[\s\S]*?\n\}/,
  'function signOf(residual) { return "at"; }'
);
ok('mutation actually rewrote signOf', mutantSrc !== src && /return "at"; \}/.test(mutantSrc));
const mutantPath = path.join(__dirname, '.mutant-sign-fold.js');
fs.writeFileSync(mutantPath, mutantSrc);
try {
  const rm = run(mutantPath, vec);
  const Lm = lines(rm.out);
  const mutantWrong = Lm[0].sign !== 'over' || Lm[2].sign !== 'under';
  ok('mutation BITE: wrong gift fails the goldens (check has teeth)', mutantWrong);
} finally {
  try { fs.unlinkSync(mutantPath); } catch (_) {}
}

// ---- signature + verdict ---------------------------------------------------
const sig = crypto.createHash('sha256').update(r.out).digest('hex').slice(0, 16);
const total = pass + fail;
process.stdout.write(
  (fail === 0 ? 'GREEN' : 'RED') + ' ' + pass + '/' + total +
  '  signature=' + sig + '\n'
);
if (notes.length) process.stdout.write(notes.join('\n') + '\n');
process.exit(fail === 0 ? 0 : 1);
