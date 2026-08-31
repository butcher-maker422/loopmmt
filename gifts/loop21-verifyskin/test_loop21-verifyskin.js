#!/usr/bin/env node
/* test_loop21-verifyskin.js — known-answer battery for loop21-verifyskin.

   The oracle is OUT OF BAND: every expected verdict below is a literal fact
   written by hand, never the output of a second validator. Each case constructs
   a config + schema whose correct { ok, value, errors, warnings } is known by
   construction.

   Run: node test_loop21-verifyskin.js   (exit 0 = all pass)
*/
"use strict";
var assert = require("assert");
var { verifySkin, isColor, isSafeCssVar } = require("./loop21-verifyskin.js");

var pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + " — " + e.message); }
}

// ---- 1. a fully-valid config passes, value echoes the typed fields --------
ok("1 valid config -> ok:true, value carries typed fields", function () {
  var schema = {
    bg:      { type: "color" },
    accent:  { type: "color" },
    radius:  { type: "integer", min: 0, max: 32 },
    opacity: { type: "number", min: 0, max: 1 },
    theme:   { type: "enum", values: ["light", "dark"] },
    dense:   { type: "boolean" }
  };
  var config = { bg: "#101820", accent: "gold", radius: 8, opacity: 0.9, theme: "dark", dense: true };
  var r = verifySkin(config, schema);
  assert.strictEqual(r.ok, true);                        // ORACLE
  assert.strictEqual(r.errors.length, 0);
  assert.deepStrictEqual(r.value, config);               // all fields passed
});

// ---- 2. hex-color forms all accepted ------------------------------------
ok("2 #rgb / #rrggbb / #rrggbbaa colors accepted", function () {
  ["#fff", "#ffffff", "#ffffffff", "#1A2b3C"].forEach(function (c) {
    assert.strictEqual(isColor(c), true, c);             // ORACLE
  });
});

// ---- 3. rgb()/rgba()/hsl() color functions accepted ---------------------
ok("3 rgb/rgba/hsl functions accepted", function () {
  ["rgb(10, 20, 30)", "rgba(0,0,0,0.5)", "hsl(210, 50%, 40%)"].forEach(function (c) {
    assert.strictEqual(isColor(c), true, c);             // ORACLE
  });
});

// ---- 4. CSS injection in a color is rejected ----------------------------
ok("4 injection color 'red; } body{...' rejected", function () {
  assert.strictEqual(isColor("red; } body{display:none}"), false);   // ORACLE
  var r = verifySkin({ bg: "red; } body{}" }, { bg: { type: "color" } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.errors[0].field, "bg");
});

// ---- 5. url() and javascript: rejected as cssvar ------------------------
ok("5 cssvar url()/javascript:/@import rejected", function () {
  assert.strictEqual(isSafeCssVar("url(evil.png)"), false);          // ORACLE
  assert.strictEqual(isSafeCssVar("javascript:alert(1)"), false);
  assert.strictEqual(isSafeCssVar("@import 'x'"), false);
  assert.strictEqual(isSafeCssVar("a; color: red"), false);         // semicolon
});

// ---- 6. a benign cssvar value accepted ----------------------------------
ok("6 benign cssvar 'clamp(1rem, 2vw, 2rem)'-ish accepted", function () {
  assert.strictEqual(isSafeCssVar("1.5 2px 10%"), true);            // ORACLE
  assert.strictEqual(isSafeCssVar("rgba(0,0,0,0.2)"), true);
  var r = verifySkin({ shadow: "0 1px 3px" }, { shadow: { type: "cssvar" } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.shadow, "0 1px 3px");
});

// ---- 7. number range enforced -------------------------------------------
ok("7 number out of range is an error", function () {
  var schema = { opacity: { type: "number", min: 0, max: 1 } };
  assert.strictEqual(verifySkin({ opacity: 1.5 }, schema).ok, false);  // ORACLE above max
  assert.strictEqual(verifySkin({ opacity: -0.1 }, schema).ok, false); // below min
  assert.strictEqual(verifySkin({ opacity: 0.4 }, schema).ok, true);   // in range
});

// ---- 8. integer rejects a fractional value ------------------------------
ok("8 integer field rejects 8.5", function () {
  var schema = { radius: { type: "integer" } };
  assert.strictEqual(verifySkin({ radius: 8.5 }, schema).ok, false);   // ORACLE
  assert.strictEqual(verifySkin({ radius: 8 }, schema).ok, true);
});

// ---- 9. enum enforces the allowed set -----------------------------------
ok("9 enum rejects an off-list value", function () {
  var schema = { theme: { type: "enum", values: ["light", "dark"] } };
  assert.strictEqual(verifySkin({ theme: "neon" }, schema).ok, false); // ORACLE
  assert.strictEqual(verifySkin({ theme: "light" }, schema).ok, true);
});

// ---- 10. boolean type-checked -------------------------------------------
ok("10 boolean field rejects the string 'true'", function () {
  var schema = { dense: { type: "boolean" } };
  assert.strictEqual(verifySkin({ dense: "true" }, schema).ok, false); // ORACLE: string != bool
  assert.strictEqual(verifySkin({ dense: false }, schema).ok, true);
});

// ---- 11. unknown field -> dropped + warned, NOT an error ----------------
ok("11 unknown field dropped with a warning, ok stays true", function () {
  var schema = { bg: { type: "color" } };
  var r = verifySkin({ bg: "#000", evilField: "x" }, schema);
  assert.strictEqual(r.ok, true);                        // ORACLE: unknown != error
  assert.strictEqual(r.warnings.length, 1);
  assert.strictEqual(r.warnings[0].field, "evilField");
  assert.strictEqual("evilField" in r.value, false);     // dropped from safe value
});

// ---- 12. required field missing -> error --------------------------------
ok("12 required-but-missing field is an error", function () {
  var schema = { bg: { type: "color", required: true } };
  var r = verifySkin({}, schema);
  assert.strictEqual(r.ok, false);                       // ORACLE
  assert.strictEqual(r.errors[0].message, "required field missing");
});

// ---- 13. optional missing field is silent -------------------------------
ok("13 optional missing field is neither error nor warning", function () {
  var schema = { bg: { type: "color" } };
  var r = verifySkin({}, schema);
  assert.strictEqual(r.ok, true);                        // ORACLE
  assert.strictEqual(r.errors.length, 0);
  assert.strictEqual(r.warnings.length, 0);
});

// ---- 14. non-object config -> one whole-object error, never throws ------
ok("14 non-object config reported, not thrown", function () {
  ["a string", 42, null, [1, 2]].forEach(function (bad) {
    var r = verifySkin(bad, { bg: { type: "color" } });
    assert.strictEqual(r.ok, false);                     // ORACLE
    assert.strictEqual(r.errors[0].field, null);
  });
});

// ---- 15. multiple errors all reported (not just the first) --------------
ok("15 several bad fields all reported", function () {
  var schema = {
    bg:      { type: "color" },
    radius:  { type: "integer" },
    theme:   { type: "enum", values: ["a"] }
  };
  var r = verifySkin({ bg: "not-a-color", radius: 1.2, theme: "z" }, schema);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.errors.length, 3);                // ORACLE: all three
});

// ---- 16. RATCHET: bad schema (non-object) throws ------------------------
ok("16 ratchet: non-object schema throws", function () {
  assert.throws(function () { verifySkin({}, "not a schema"); }, /schema must be/);  // ORACLE
});

// ---- 17. RATCHET: unknown spec type throws ------------------------------
ok("17 ratchet: unknown spec type throws (programmer error)", function () {
  assert.throws(function () { verifySkin({ x: 1 }, { x: { type: "widget" } }); }, /unknown spec type/);
});

// ---- 18. value carries ONLY passing fields (a rejected field is absent) --
ok("18 rejected field absent from value, valid sibling present", function () {
  var schema = { good: { type: "color" }, bad: { type: "integer" } };
  var r = verifySkin({ good: "#abc", bad: 1.5 }, schema);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.value.good, "#abc");              // ORACLE: good survives
  assert.strictEqual("bad" in r.value, false);           // bad excluded
});

console.log("\nloop21-verifyskin: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
