#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */
/**
 * units-convert — convert a quantity from one unit to another, honestly.
 *
 * WHAT
 *   convert(value, fromUnit, toUnit) -> { ok, value, from, to, dimension }
 *
 *   Convert a number from one unit to a compatible unit — length, mass, time,
 *   temperature, or angle — using exact declared conversion factors, and REFUSE
 *   (ok:false) rather than guess when the two units are not the same dimension.
 *   Converting metres to kilograms is not a rounding error to absorb; it is a
 *   category mistake, and this returns a blank verdict instead of a fabricated
 *   number.
 *
 * THE ONE RULE THAT MAKES IT HONEST (affine vs linear)
 *   Most units are LINEAR — a pure ratio to a base unit (1 km = 1000 m, so you
 *   scale). Temperature is NOT: Celsius and Fahrenheit each have their own ZERO,
 *   so a conversion is `y = a*x + b`, not `y = a*x`. Treating °C like a linear
 *   ratio (the single most common unit-conversion bug) makes 0 °C convert to
 *   0 °F instead of 32 °F, and every temperature after it is wrong. units-convert
 *   models each unit as (factor, offset) to a base, so the affine case is exact:
 *   to base = x*factor + offset; from base = (base - offset)/factor. Linear units
 *   simply have offset 0. There is no separate "temperature mode" to forget.
 *
 * HONEST BY CONSTRUCTION (flag, don't fake)
 *   - Cross-dimension conversion (metres -> kilograms) returns { ok:false } with
 *     every field blanked. It NEVER invents a number across dimensions.
 *   - An unknown unit on either side -> blank (never a guessed alias).
 *   - A non-finite or non-number value -> blank (NaN/Infinity are not quantities).
 *   - Same unit in and out -> the value unchanged (identity), exact.
 *
 * HOW
 *   Every unit declares (dimension, factor-to-base, offset-to-base). Conversion is
 *   two exact steps: value -> base -> target. Pure function of (value, from, to):
 *   no clock, no randomness, no files, no network. Same three inputs -> same
 *   result, every run, in Node or a browser.
 *
 *   In Node:    require("./units-convert.js").convert(...)  /  CLI: node units-convert.js
 *   In browser: window.ForestGifts.unitsConvert.{ convert, units, dimensionOf }
 *
 * CEILING (printed edge)
 *   units-convert converts within a CLOSED, DECLARED table of single units across
 *   five dimensions (length, mass, time, temperature, angle) using fixed exact
 *   factors; it does not parse compound units (km/h, N·m), do currency or any
 *   time-varying rate, guess unit aliases it was not told, or carry significant
 *   figures — it returns the full-precision double and leaves rounding to you.
 */
"use strict";

function blank() { return { ok: false, value: null, from: "", to: "", dimension: "" }; }

/* ---- the unit table: each unit -> (dimension, factor, offset) to its base ----- *
 * to_base(x)   = x * factor + offset
 * from_base(b) = (b - offset) / factor
 * Linear units have offset 0. Temperature units carry a real offset (their zero).
 * Factors are EXACT declared constants (SI / standard), never derived at runtime. */
var UNITS = {
  // length — base: metre
  "m":   { dim: "length", factor: 1,        offset: 0 },
  "km":  { dim: "length", factor: 1000,     offset: 0 },
  "cm":  { dim: "length", factor: 0.01,     offset: 0 },
  "mm":  { dim: "length", factor: 0.001,    offset: 0 },
  "mi":  { dim: "length", factor: 1609.344, offset: 0 },   // international mile (exact)
  "yd":  { dim: "length", factor: 0.9144,   offset: 0 },   // international yard (exact)
  "ft":  { dim: "length", factor: 0.3048,   offset: 0 },   // international foot (exact)
  "in":  { dim: "length", factor: 0.0254,   offset: 0 },   // international inch (exact)
  "nmi": { dim: "length", factor: 1852,     offset: 0 },   // nautical mile (exact)

  // mass — base: kilogram
  "kg":  { dim: "mass", factor: 1,           offset: 0 },
  "g":   { dim: "mass", factor: 0.001,       offset: 0 },
  "mg":  { dim: "mass", factor: 0.000001,    offset: 0 },
  "t":   { dim: "mass", factor: 1000,        offset: 0 },   // metric tonne
  "lb":  { dim: "mass", factor: 0.45359237,  offset: 0 },   // avoirdupois pound (exact)
  "oz":  { dim: "mass", factor: 0.028349523125, offset: 0 }, // avoirdupois ounce (exact, lb/16)

  // time — base: second
  "s":   { dim: "time", factor: 1,     offset: 0 },
  "ms":  { dim: "time", factor: 0.001, offset: 0 },
  "min": { dim: "time", factor: 60,    offset: 0 },
  "h":   { dim: "time", factor: 3600,  offset: 0 },
  "d":   { dim: "time", factor: 86400, offset: 0 },
  "wk":  { dim: "time", factor: 604800, offset: 0 },

  // temperature — base: kelvin (the affine cases — the whole point)
  "K":   { dim: "temperature", factor: 1,     offset: 0 },
  "C":   { dim: "temperature", factor: 1,     offset: 273.15 },      // K = C*1 + 273.15
  "F":   { dim: "temperature", factor: 5 / 9, offset: 273.15 - (32 * 5 / 9) }, // K = F*5/9 + (273.15 - 32*5/9)

  // angle — base: radian
  "rad":  { dim: "angle", factor: 1,                      offset: 0 },
  "deg":  { dim: "angle", factor: Math.PI / 180,          offset: 0 },
  "grad": { dim: "angle", factor: Math.PI / 200,          offset: 0 },
  "turn": { dim: "angle", factor: 2 * Math.PI,            offset: 0 }
};

function dimensionOf(unit) {
  return (typeof unit === "string" && Object.prototype.hasOwnProperty.call(UNITS, unit)) ? UNITS[unit].dim : "";
}

function units() {
  // a stable, sorted listing (dimension then unit) — deterministic
  var out = [];
  var keys = Object.keys(UNITS).sort();
  for (var i = 0; i < keys.length; i++) out.push({ unit: keys[i], dimension: UNITS[keys[i]].dim });
  out.sort(function (a, b) { return a.dimension < b.dimension ? -1 : a.dimension > b.dimension ? 1 : (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0); });
  return out;
}

/* ---- convert — THE primitive -------------------------------------------------- *
 * value : a finite number.
 * from  : a known unit key.  to : a known unit key of the SAME dimension.
 * Returns { ok, value, from, to, dimension }; ok:false blanks every field. */
function convert(value, from, to) {
  if (typeof value !== "number" || !isFinite(value)) return blank();
  if (!Object.prototype.hasOwnProperty.call(UNITS, from)) return blank();
  if (!Object.prototype.hasOwnProperty.call(UNITS, to)) return blank();
  var uFrom = UNITS[from], uTo = UNITS[to];
  if (uFrom.dim !== uTo.dim) return blank();          // cross-dimension: refuse, never guess

  if (from === to) {
    return { ok: true, value: value, from: from, to: to, dimension: uFrom.dim }; // identity, exact
  }

  var base = value * uFrom.factor + uFrom.offset;      // to base
  var out = (base - uTo.offset) / uTo.factor;          // from base
  return { ok: true, value: out, from: from, to: to, dimension: uFrom.dim };
}

/* ---- exports ------------------------------------------------------------------ */
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.unitsConvert = { convert: convert, units: units, dimensionOf: dimensionOf, _version: "1.0" };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { convert: convert, units: units, dimensionOf: dimensionOf, _version: "1.0" };
}

/* ------------------------------------------------------------------ *
 * CLI.  node units-convert.js VALUE FROM TO                           *
 *   e.g. node units-convert.js 100 C F   -> {"ok":true,"value":212,...}*
 *   node units-convert.js --units        -> the unit table (JSONL)     *
 * Prints the JSON result. Exit 0 on ok:true, 1 on ok:false (blank),    *
 * 2 on usage error.                                                    *
 * ------------------------------------------------------------------ */
function usage() {
  return "usage: units-convert.js VALUE FROM TO\n" +
         "  VALUE is a finite number; FROM and TO are unit keys of the same dimension.\n" +
         "  units-convert.js --units   lists the unit table (one JSON object per line).\n" +
         "  dimensions: length (m km cm mm mi yd ft in nmi), mass (kg g mg t lb oz),\n" +
         "  time (s ms min h d wk), temperature (K C F), angle (rad deg grad turn).";
}

function main(argv) {
  var args = argv.slice(2);
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) { process.stdout.write(usage() + "\n"); process.exit(0); }
  if (args.length === 1 && args[0] === "--units") {
    var list = units();
    for (var i = 0; i < list.length; i++) process.stdout.write(JSON.stringify(list[i]) + "\n");
    process.exit(0);
  }
  if (args.length !== 3) { process.stderr.write("units-convert: expected VALUE FROM TO\n" + usage() + "\n"); process.exit(2); }
  var value = Number(args[0]);
  if (args[0].trim() === "" || isNaN(value)) { process.stderr.write("units-convert: VALUE is not a number: " + args[0] + "\n"); process.exit(2); }
  var r = convert(value, args[1], args[2]);
  process.stdout.write(JSON.stringify(r) + "\n");
  process.exit(r.ok ? 0 : 1);
}

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  main(process.argv);
}
