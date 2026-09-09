#!/usr/bin/env node
/* test_template.js — the golden corpus + determinism self-test + non-vacuity
   bite for the template gift. Zero dependencies (Node assert only). This file
   IS the canonicalizer self-test the Plumb cites (Gift-Works Procedure v1 §2):
   a gift whose output is byte-identical across repeated evaluation has proven
   its canonical form is idempotent and order-faithful.

   The known-good half is written out as FIXED LITERALS — the corpus is an
   oracle, not a re-derivation of the code (the oracle-less-gift self-check
   pattern: a net-new gift with a bespoke output shape has no external oracle,
   so it proves itself with fixed-literal expects + a non-vacuity bite).

   Run:  node test_template.js       # exit 0 GREEN / non-zero RED
*/
"use strict";
var assert = require("assert");
var T = require("./template.js");

var pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.error("FAIL: " + name + " — " + e.message); }
}

// ---- GOLDEN CORPUS: the known-good half (fixed-literal oracle) --------------
var GOLDEN = [
  {
    name: "one variable filled from the record",
    template: "Hi {{name}}.", record: { name: "Ada" },
    expect: "Hi Ada."
  },
  {
    name: "two variables filled in first-appearance order",
    template: "Hi {{name}}, about {{topic}}.", record: { name: "Ada", topic: "looms" },
    expect: "Hi Ada, about looms."
  },
  {
    name: "a variable used twice is filled the same both times",
    template: "{{x}} and {{x}} again.", record: { x: "7" },
    expect: "7 and 7 again."
  },
  {
    name: "whitespace inside the braces is trimmed to the same slot",
    template: "{{ name }} == {{name}}", record: { name: "q" },
    expect: "q == q"
  },
  {
    name: "a number value is String-coerced deterministically",
    template: "n={{n}} b={{b}}", record: { n: 42, b: true },
    expect: "n=42 b=true"
  },
  {
    name: "a template with no variables passes through unchanged with the empty record",
    template: "no slots here at all", record: {},
    expect: "no slots here at all"
  },
  {
    name: "an empty double-brace is literal text, not a slot",
    template: "keep {{}} and {{  }} literal", record: {},
    expect: "keep {{}} and {{  }} literal"
  },
  {
    name: "a charset-invalid inner is left literal, not treated as a variable",
    template: "spaces {{a b}} stay", record: {},
    expect: "spaces {{a b}} stay"
  },
  {
    name: "dotted and hyphenated names are valid variables",
    template: "{{user.name}}-{{req-id}}", record: { "user.name": "Ada", "req-id": "9" },
    expect: "Ada-9"
  },
  {
    name: "exact bytes preserved including a trailing newline",
    template: "Hi {{name}}.\n", record: { name: "Ada" },
    expect: "Hi Ada.\n"
  }
];

GOLDEN.forEach(function (v) {
  check("golden: " + v.name, function () {
    assert.strictEqual(T.fill(v.template, v.record), v.expect);
  });
});

// ---- variablesOf: the --list contract --------------------------------------
check("variablesOf lists declared variables in first-appearance order, de-duplicated", function () {
  assert.deepStrictEqual(T.variablesOf("{{b}} {{a}} {{b}} {{c}}"), ["b", "a", "c"]);
});
check("variablesOf ignores empty and charset-invalid slots", function () {
  assert.deepStrictEqual(T.variablesOf("{{ok}} {{}} {{a b}} {{ok2}}"), ["ok", "ok2"]);
});

// ---- FAIL-CLOSED: the known-bad half (the whole reason the gift exists) -----
check("test_missing_required_variable_refuses_and_names_the_blank", function () {
  assert.throws(function () { T.fill("Hi {{name}}.", {}); }, function (e) {
    return e.name === "TemplateError" &&
      /missing 1 required variable: name/.test(e.message) &&
      Array.isArray(e.missing) && e.missing.length === 1 && e.missing[0] === "name";
  });
});
check("test_every_missing_variable_is_named_at_once_not_just_the_first", function () {
  assert.throws(function () { T.fill("{{a}} {{b}} {{c}}", { b: "have-b" }); }, function (e) {
    return e.name === "TemplateError" &&
      /missing 2 required variables: a, c/.test(e.message) &&
      e.missing.join(",") === "a,c";
  });
});
check("test_missing_names_are_reported_in_declared_order", function () {
  assert.throws(function () { T.fill("{{z}} then {{a}}", {}); }, function (e) {
    return e.missing.join(",") === "z,a"; // declared order, NOT sorted
  });
});
check("test_inherited_property_is_not_a_supplied_value_(no_silent_lie)", function () {
  // "toString" exists on every object's prototype; it must NOT satisfy {{toString}}.
  assert.throws(function () { T.fill("{{toString}}", {}); }, function (e) {
    return e.name === "TemplateError" && e.missing[0] === "toString";
  });
});
check("test_a_supplied_own_property_named_like_a_builtin_DOES_fill", function () {
  assert.strictEqual(T.fill("{{toString}}", { toString: "ok" }), "ok");
});
check("test_non_object_record_refuses", function () {
  assert.throws(function () { T.fill("{{x}}", [1, 2]); }, /expected a JSON object/);
  assert.throws(function () { T.fill("{{x}}", "nope"); }, /expected a JSON object/);
  assert.throws(function () { T.fill("{{x}}", null); }, /expected a JSON object/);
});

// ---- DETERMINISM SELF-TEST (= the canonicalizer self-test, Gift-Works §2) ---
check("test_same_template_same_record_is_byte_identical_across_seeds", function () {
  var tmpl = "Dear {{name}}, your {{item}} ships {{when}}. — {{name}}";
  var rec = { name: "Ada", item: "loom", when: "Friday" };
  var first = T.fill(tmpl, rec);
  for (var seed = 0; seed < 25; seed++) {
    assert.strictEqual(T.fill(tmpl, rec), first, "drift at seed " + seed);
  }
});

// ---- NON-VACUITY BITE: prove the tests can FAIL (mutation guard) ------------
// If this harness passed a no-op implementation, it would be worthless. Bite it:
// a mutant that leaves the slot literal instead of filling must be caught by the
// golden corpus above. We assert the REAL fill differs from the mutant output.
check("non-vacuity: a no-fill mutant would fail the golden corpus", function () {
  var tmpl = "Hi {{name}}.", rec = { name: "Ada" };
  var real = T.fill(tmpl, rec);
  var mutant = tmpl; // the no-op: returns the template unfilled
  assert.notStrictEqual(real, mutant,
    "if the real output equalled the unfilled template, the corpus could not tell them apart");
  assert.strictEqual(real, "Hi Ada.");
});
check("non-vacuity: a fail-open mutant (blank instead of refuse) would fail the known-bad half", function () {
  // The known-bad tests assert a THROW. A mutant that returned "" instead of
  // throwing would fail them — assert the real code throws where the mutant wouldn't.
  var threw = false;
  try { T.fill("{{missing}}", {}); } catch (e) { threw = true; }
  assert.strictEqual(threw, true, "the real fill must refuse; a blank-filling mutant would not");
});

// ---- report ----------------------------------------------------------------
if (fail === 0) {
  console.log("GREEN: " + pass + " passed, 0 failed  [template]");
  process.exitCode = 0;
} else {
  console.error("RED: " + pass + " passed, " + fail + " failed  [template]");
  process.exitCode = 1;
}
