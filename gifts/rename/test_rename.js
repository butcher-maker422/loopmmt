#!/usr/bin/env node
/* test_rename.js — drift-check battery for rename.js.
   Zero-dependency. `node test_rename.js`. Exit 0 all-pass, 1 any-fail.

   THE ORACLE. rename's contract is small enough that the oracle is hand-computed
   expected output lines PLUS one mechanical invariant on every case:
     (I-order) position-preserved: the output's field POSITIONS equal the input's
       (rename swaps names in place, it never moves a field).
   The KNOWN-BAD vector is the COLLISION tripwire: a rename that would make two
   fields share a name must be refused (exit/throw), never silently overwrite. A
   regression that last-write-wins on a clash passes a naive "renamed the field"
   check but fails the collision case — so the battery pins the fail-closed rule
   that protects data.
*/
"use strict";

var mod = require("./rename.js");
var rename = mod.rename;

var passed = 0, failed = 0;
function check(name, got, want) {
  if (got === want) { passed++; }
  else {
    failed++;
    console.log("FAIL  " + name);
    console.log("   want: " + JSON.stringify(want));
    console.log("   got:  " + JSON.stringify(got));
  }
}
function checkThrows(name, fn) {
  var threw = false;
  try { fn(); } catch (e) { threw = true; }
  if (threw) { passed++; }
  else { failed++; console.log("FAIL  " + name + " (expected a throw, none happened)"); }
}
function out(text, opts) {
  return rename(text, opts).lines.join("\n");
}

// ---- Core rename -----------------------------------------------------
check("rename one field",
  out('{"a":1,"b":2}', { map: "a=x" }),
  '{"x":1,"b":2}');

check("rename two fields",
  out('{"a":1,"b":2,"c":3}', { map: "a=x,c=z" }),
  '{"x":1,"b":2,"z":3}');

check("unmapped field passes through unchanged",
  out('{"a":1,"b":2}', { map: "a=x" }),
  '{"x":1,"b":2}');

// ---- POSITION PRESERVED: rename swaps in place, never moves ----------
check("rename keeps field POSITION (in place, not moved)",
  out('{"a":1,"b":2,"c":3}', { map: "a=z" }),
  '{"z":1,"b":2,"c":3}');   // z stays first, NOT moved to the end

// ---- Missing source field: default skips -----------------------------
check("missing source field skipped (default), record otherwise intact",
  out('{"b":2}', { map: "a=x" }),
  '{"b":2}');

check("record with none of the mapped fields emitted unchanged",
  out('{"p":1,"q":2}', { map: "a=x,c=z" }),
  '{"p":1,"q":2}');

// ---- --strict: missing source is a hard error ------------------------
checkThrows("strict: missing source field throws", function () {
  rename('{"b":2}', { map: "a=x", strict: true });
});
check("strict: all present passes",
  out('{"a":1}', { map: "a=x", strict: true }),
  '{"x":1}');

// ---- KNOWN-BAD VECTOR: collisions are refused, never overwritten -----
checkThrows("KNOWN-BAD: rename onto an existing field name collides (throws)", function () {
  // renaming a->b when b already exists would make two "b"s
  rename('{"a":1,"b":2}', { map: "a=b" });
});
checkThrows("KNOWN-BAD: two sources onto one target collides (throws)", function () {
  rename('{"a":1,"c":3}', { pairs: [["a", "x"], ["c", "x"]] });
});
check("rename onto a name that IS itself being renamed away is OK (swap)",
  out('{"a":1,"b":2}', { map: "a=b,b=a" }),
  '{"b":1,"a":2}');   // a->b and b->a: a clean swap, no collision

// ---- Value fidelity + nested canonicalization ------------------------
check("value copied verbatim, nested object canonicalized",
  out('{"a":{"z":1,"y":2}}', { map: "a=x" }),
  '{"x":{"y":2,"z":1}}');

check("array value order preserved",
  out('{"a":[3,1,2]}', { map: "a=x" }),
  '{"x":[3,1,2]}');

check("null/bool/string values kept through rename",
  out('{"a":null,"b":true,"c":"hi"}', { map: "a=p,b=q,c=r" }),
  '{"p":null,"q":true,"r":"hi"}');

// ---- Multi-line stream, order preserved ------------------------------
check("multi-record stream keeps input order",
  out('{"id":1}\n{"id":2}\n{"id":3}', { map: "id=n" }),
  '{"n":1}\n{"n":2}\n{"n":3}');

// ---- Blank + CRLF ----------------------------------------------------
check("blank lines skipped",
  out('{"a":1}\n\n{"a":2}\n', { map: "a=x" }),
  '{"x":1}\n{"x":2}');

check("CRLF trailing \\r trimmed",
  out('{"a":1}\r\n{"a":2}\r', { map: "a=x" }),
  '{"x":1}\n{"x":2}');

// ---- Input honesty: non-object + bad JSON are hard errors ------------
checkThrows("bare number record throws", function () { rename('42', { map: "a=x" }); });
checkThrows("array record throws", function () { rename('[1,2]', { map: "a=x" }); });
checkThrows("null record throws", function () { rename('null', { map: "a=x" }); });
checkThrows("invalid JSON throws", function () { rename('{"a":1', { map: "a=x" }); });

// ---- Map parse validation --------------------------------------------
checkThrows("malformed map pair (no =) throws", function () {
  rename('{"a":1}', { map: "ax" });
});
checkThrows("empty new name throws", function () {
  rename('{"a":1}', { map: "a=" });
});
checkThrows("duplicate source in map throws", function () {
  rename('{"a":1}', { map: "a=x,a=y" });
});

// ---- Determinism: folds-twice-identical ------------------------------
(function () {
  var input = '{"b":2,"a":1}\n{"a":10,"c":30}';
  var opts = { map: "a=x,b=y" };
  check("determinism: two runs byte-identical", out(input, opts), out(input, opts));
})();

console.log("\nrename battery: " + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
