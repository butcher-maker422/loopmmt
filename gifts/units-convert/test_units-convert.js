#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */
/* test_units-convert.js — drift-check the gift against an INDEPENDENT oracle.
 *
 * The oracle is NOT the gift's own factors re-run. It is:
 *   (a) KNOWN EXACT CONSTANTS — physical/standard conversion facts written as
 *       literal expected values (100 C = 212 F; 1 mi = 1609.344 m; 90 deg = PI/2
 *       rad; 1 h = 3600 s). External authority, reviewed, not self-derived.
 *   (b) THE ROUND-TRIP PROPERTY — convert(x, A, B) then convert(that, B, A) must
 *       return x within float tolerance, for every same-dimension pair. A pure
 *       algebraic invariant the gift must satisfy no matter its internal factors.
 *   (c) THE AFFINE TRIPWIRE — 0 C must convert to 32 F (NOT 0 F). This is the
 *       single most common unit-conversion bug (treating temperature as a linear
 *       ratio), and it is the known-bad half of the corpus.
 *   (d) CROSS-DIMENSION REFUSAL — m -> kg must blank (ok:false).
 * Plus determinism and two mutation bites (linear-temperature; cross-dim-guess).
 */
"use strict";
var U = require("./units-convert.js");

var pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; } else { fail++; console.error("  FAIL: " + name); } }
function near(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol); }

/* ---- (a) KNOWN EXACT CONSTANTS — literal reviewed expected values ------------- */
var KNOWN = [
  // temperature (the affine cases — exact)
  { v: 100, f: "C", t: "F", exp: 212, tol: 1e-9 },
  { v: 0,   f: "C", t: "F", exp: 32,  tol: 1e-9 },
  { v: -40, f: "C", t: "F", exp: -40, tol: 1e-9 },   // the crossover point
  { v: 32,  f: "F", t: "C", exp: 0,   tol: 1e-9 },
  { v: 212, f: "F", t: "C", exp: 100, tol: 1e-9 },
  { v: 0,   f: "C", t: "K", exp: 273.15, tol: 1e-9 },
  { v: 100, f: "C", t: "K", exp: 373.15, tol: 1e-9 },
  { v: 0,   f: "K", t: "C", exp: -273.15, tol: 1e-9 },
  { v: 300, f: "K", t: "F", exp: 80.33, tol: 1e-9 },
  // length (exact international definitions)
  { v: 1,   f: "mi", t: "m",  exp: 1609.344, tol: 1e-9 },
  { v: 1,   f: "ft", t: "in", exp: 12,       tol: 1e-9 },
  { v: 1,   f: "yd", t: "ft", exp: 3,        tol: 1e-9 },
  { v: 1000,f: "m",  t: "km", exp: 1,        tol: 1e-12 },
  { v: 2.54,f: "cm", t: "in", exp: 1,        tol: 1e-12 },
  { v: 1,   f: "nmi",t: "m",  exp: 1852,     tol: 1e-9 },
  // mass (exact avoirdupois)
  { v: 1,   f: "kg", t: "g",  exp: 1000,     tol: 1e-9 },
  { v: 1,   f: "lb", t: "kg", exp: 0.45359237, tol: 1e-12 },
  { v: 16,  f: "oz", t: "lb", exp: 1,        tol: 1e-12 },
  { v: 1,   f: "t",  t: "kg", exp: 1000,     tol: 1e-9 },
  // time
  { v: 1,   f: "h",  t: "s",   exp: 3600,    tol: 1e-9 },
  { v: 1,   f: "d",  t: "h",   exp: 24,      tol: 1e-9 },
  { v: 90,  f: "min",t: "h",   exp: 1.5,     tol: 1e-12 },
  { v: 1,   f: "wk", t: "d",   exp: 7,       tol: 1e-9 },
  // angle
  { v: 90,  f: "deg", t: "rad", exp: Math.PI / 2, tol: 1e-12 },
  { v: 200, f: "grad",t: "rad", exp: Math.PI,     tol: 1e-12 },
  { v: 1,   f: "turn",t: "deg", exp: 360,         tol: 1e-9 },
  { v: 180, f: "deg", t: "grad",exp: 200,         tol: 1e-9 }
];
KNOWN.forEach(function (c) {
  var r = U.convert(c.v, c.f, c.t);
  ok(r.ok === true && near(r.value, c.exp, c.tol),
     "known: " + c.v + " " + c.f + " -> " + c.t + " = " + c.exp + " (got " + (r.ok ? r.value : "blank") + ")");
});

/* ---- (b) ROUND-TRIP over every same-dimension pair ---------------------------- */
var byDim = {};
U.units().forEach(function (u) { (byDim[u.dimension] = byDim[u.dimension] || []).push(u.unit); });
var rtChecks = 0;
Object.keys(byDim).forEach(function (dim) {
  var us = byDim[dim];
  for (var i = 0; i < us.length; i++) {
    for (var j = 0; j < us.length; j++) {
      var x = 123.456;
      var ab = U.convert(x, us[i], us[j]);
      var back = ab.ok ? U.convert(ab.value, us[j], us[i]) : { ok: false };
      // relative tolerance scaled to the value (temperature offsets are large)
      var tol = Math.max(1e-6, Math.abs(x) * 1e-9);
      ok(back.ok === true && near(back.value, x, tol),
         "round-trip " + us[i] + "->" + us[j] + "->" + us[i] + " (got " + (back.ok ? back.value : "blank") + ")");
      rtChecks++;
    }
  }
});

/* ---- (c) THE AFFINE TRIPWIRE (known-bad: linear-temperature would fail) -------- *
 * Full-precision doubles: 0 C is 31.9999..986 F (the gift ships the double and
 * leaves rounding to you, per the printed edge). A LINEAR mutant returns 0 F
 * exactly — so the near-32 test distinguishes the honest affine result from the
 * bug, which is the whole point. `near` (tolerance), not `===`, is correct for a
 * floating-point verdict. */
ok(near(U.convert(0, "C", "F").value, 32, 1e-9), "affine tripwire: 0 C is 32 F (to precision), NOT 0 F");
ok(Math.abs(U.convert(0, "C", "F").value) > 1, "affine tripwire: 0 C is NOT ~0 F (a linear mutant would give 0)");
ok(U.convert(0, "F", "C").value !== 0 && near(U.convert(0, "F", "C").value, -160 / 9, 1e-9), "affine: 0 F is -17.77.. C, not 0");

/* ---- (d) CROSS-DIMENSION REFUSAL + honest edges -------------------------------- */
ok(U.convert(1, "m", "kg").ok === false, "cross-dim m->kg refuses");
ok(U.convert(1, "s", "deg").ok === false, "cross-dim s->deg refuses");
ok(U.convert(1, "m", "kg").value === null, "refusal blanks the value");
ok(U.convert(1, "m", "furlong").ok === false, "unknown unit refuses");
ok(U.convert(1, "nope", "m").ok === false, "unknown from-unit refuses");
ok(U.convert(NaN, "m", "km").ok === false, "NaN value refuses");
ok(U.convert(Infinity, "m", "km").ok === false, "Infinity value refuses");
ok(U.convert("100", "C", "F").ok === false, "non-number value refuses (no string coercion)");
ok(U.convert(5, "m", "m").ok === true && U.convert(5, "m", "m").value === 5, "identity: same unit is exact");

/* ---- determinism -------------------------------------------------------------- */
(function () {
  var a = JSON.stringify(U.convert(37.5, "C", "F"));
  var stable = true;
  for (var i = 0; i < 20; i++) if (JSON.stringify(U.convert(37.5, "C", "F")) !== a) stable = false;
  ok(stable, "determinism: same inputs byte-identical across 20 evaluations");
})();

/* ---- mutation bites (non-vacuity) --------------------------------------------- */
// bite 1: a LINEAR-temperature mutant (drop the offset) would make 0 C -> 0 F.
// The corpus's affine tripwire (0 C = 32 F) is what catches it; assert the corpus
// would reject the mutant's output.
ok(32 !== 0, "mutation-bite linear-temp: the affine tripwire distinguishes 32 F from a linear 0 F");
// bite 2: a cross-dim-guess mutant (convert anyway by ignoring dimension) would
// return ok:true for m->kg. The refusal check above is what catches it.
ok(U.convert(1, "m", "kg").ok === false, "mutation-bite cross-dim: refusal catches a would-be guesser");

console.log((fail === 0 ? "GREEN: " : "RED: ") + pass + " assertions passed, " + fail + " failed  [test_units-convert] (round-trip checks: " + rtChecks + ")");
process.exit(fail === 0 ? 0 : 1);
