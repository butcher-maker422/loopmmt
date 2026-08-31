#!/usr/bin/env node
/* loop21-verifyskin.js — a pure, dependency-free, STRICT validator for
   user-submitted "skin" config objects, before you apply them to a UI. Runs
   identically in a browser (window.LoopGifts.verifySkin) and in Node (require /
   this CLI). No DOM, no dependencies.

   WHY THIS EXISTS. A theming / skin feature lets a user hand you a small config
   object — colors, a font, a few numbers, some CSS custom properties — that you
   then splice into a stylesheet or inline style. That is untrusted input landing
   in your render surface. The usual answer is to trust it (and ship a CSS
   injection, or a broken layout from a typo'd number) or to hand-check a few
   fields and miss the rest. This validates the WHOLE object against a declared
   schema and tells you, honestly, what is wrong — before a single value is
   applied.

   WHAT "VERIFY" MEANS HERE. verifySkin does not mutate, coerce, or "fix" your
   config. It reads it against a schema and returns a verdict:
       { ok, value, errors, warnings }
   `ok` is true only when there are zero errors. `value` is the subset of the
   input that passed (known, well-typed fields) — safe to apply. `errors` are
   hard failures (wrong type, out-of-range, a disallowed CSS value, a missing
   required field). `warnings` are soft (an unknown field that was dropped, a
   value clamped-in-spec-but-suspicious). A validator that silently drops the
   difference between "wrong" and "unknown" is lying about what it checked; this
   one keeps them apart.

   THE SCHEMA. A plain object mapping field name -> a small type spec:
     { type: "color" }            a CSS color: #rgb / #rrggbb / #rrggbbaa /
                                  rgb()/rgba()/hsl()/hsla() / a named-color from
                                  the allowlist. No url(), no expression, no ; }
     { type: "cssvar" }           a CSS custom-property VALUE, allowlisted to a
                                  safe grammar (letters, digits, %, #, spaces,
                                  commas, dots, parens for the color fns above) —
                                  rejects ; { } < > url( javascript: and @import.
     { type: "number", min, max } a finite number, optionally range-checked.
     { type: "integer", min, max} a number with no fractional part.
     { type: "enum", values:[..] }one of a fixed set of strings.
     { type: "boolean" }          true / false.
     { type: "string", maxLen }   an arbitrary string, optionally length-capped
                                  (NOT applied to a stylesheet without your own
                                  escaping — see the README edge).
   Add `required: true` to make a missing field an error (default: optional).

   API
     verifySkin(config, schema) -> { ok, value, errors, warnings }
       `config`  the untrusted object (anything; a non-object is one error).
       `schema`  the field->spec map above (a non-object throws — the schema is
                 YOURS, so a bad schema is a programmer error, not user input).
       `errors` / `warnings` are arrays of { field, message } (field null for
       whole-object problems). Never throws on bad `config` — that is the point;
       it reports. THROWS only on a malformed `schema`.

   Pure function of its inputs. Same code in a browser
   (window.LoopGifts.verifySkin) or Node (this CLI / require()).

   USAGE
     node loop21-verifyskin.js config.json schema.json   # prints the verdict JSON
     node loop21-verifyskin.js --help
*/
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window !== "undefined") {
    window.LoopGifts = window.LoopGifts || {};
    window.LoopGifts.verifySkin = api.verifySkin;
  }
  root.__loop21VerifySkin = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // A conservative named-color allowlist — the common CSS keywords. Not
  // exhaustive by design: an unknown name is rejected, not guessed.
  var NAMED_COLORS = {
    black:1, silver:1, gray:1, grey:1, white:1, maroon:1, red:1, purple:1,
    fuchsia:1, green:1, lime:1, olive:1, yellow:1, navy:1, blue:1, teal:1,
    aqua:1, cyan:1, magenta:1, orange:1, pink:1, brown:1, gold:1, coral:1,
    salmon:1, khaki:1, violet:1, indigo:1, turquoise:1, tan:1, beige:1,
    ivory:1, crimson:1, chocolate:1, transparent:1
  };

  var HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  // rgb/rgba/hsl/hsla with only numbers, %, commas, spaces, dots inside.
  var COLOR_FN = /^(?:rgb|rgba|hsl|hsla)\(\s*[-0-9.%,\s\/]+\)$/;
  // A safe cssvar value: letters, digits, whitespace, and a small punctuation set.
  // Explicitly excludes ; { } < > and the url(/@import/expression/javascript vectors.
  var SAFE_CSSVAR = /^[A-Za-z0-9#%.,()\-_ \/]*$/;
  var DANGER = /(url\s*\(|@import|expression\s*\(|javascript:|[;{}<>])/i;

  function isColor(v) {
    if (typeof v !== "string") return false;
    var s = v.trim();
    if (HEX.test(s)) return true;
    if (COLOR_FN.test(s)) return true;
    if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, s.toLowerCase())) return true;
    return false;
  }
  function isSafeCssVar(v) {
    if (typeof v !== "string") return false;
    if (DANGER.test(v)) return false;
    return SAFE_CSSVAR.test(v);
  }

  function verifySkin(config, schema) {
    if (schema === null || typeof schema !== "object" || Array.isArray(schema))
      throw new Error("loop21-verifyskin: schema must be a plain object of field specs");

    var errors = [], warnings = [], value = {};

    if (config === null || typeof config !== "object" || Array.isArray(config)) {
      errors.push({ field: null, message: "config must be a plain object" });
      return { ok: false, value: {}, errors: errors, warnings: warnings };
    }

    var schemaFields = Object.keys(schema);

    // 1. unknown fields -> dropped, warned (not an error: forward-compat)
    Object.keys(config).forEach(function (k) {
      if (schemaFields.indexOf(k) === -1)
        warnings.push({ field: k, message: "unknown field dropped (not in schema)" });
    });

    // 2. each schema field
    schemaFields.forEach(function (field) {
      var spec = schema[field];
      if (spec === null || typeof spec !== "object")
        throw new Error("loop21-verifyskin: schema field '" + field + "' has a non-object spec");
      var present = Object.prototype.hasOwnProperty.call(config, field);
      var v = config[field];

      if (!present) {
        if (spec.required) errors.push({ field: field, message: "required field missing" });
        return;
      }

      switch (spec.type) {
        case "color":
          if (isColor(v)) value[field] = v;
          else errors.push({ field: field, message: "not a valid/allowlisted CSS color" });
          break;
        case "cssvar":
          if (isSafeCssVar(v)) value[field] = v;
          else errors.push({ field: field, message: "cssvar value contains a disallowed character or vector" });
          break;
        case "number":
          if (typeof v !== "number" || !isFinite(v)) { errors.push({ field: field, message: "not a finite number" }); break; }
          if (typeof spec.min === "number" && v < spec.min) { errors.push({ field: field, message: "below min " + spec.min }); break; }
          if (typeof spec.max === "number" && v > spec.max) { errors.push({ field: field, message: "above max " + spec.max }); break; }
          value[field] = v;
          break;
        case "integer":
          if (typeof v !== "number" || !isFinite(v) || Math.floor(v) !== v) { errors.push({ field: field, message: "not an integer" }); break; }
          if (typeof spec.min === "number" && v < spec.min) { errors.push({ field: field, message: "below min " + spec.min }); break; }
          if (typeof spec.max === "number" && v > spec.max) { errors.push({ field: field, message: "above max " + spec.max }); break; }
          value[field] = v;
          break;
        case "enum":
          if (!Array.isArray(spec.values)) throw new Error("loop21-verifyskin: enum field '" + field + "' needs a values array");
          if (spec.values.indexOf(v) !== -1) value[field] = v;
          else errors.push({ field: field, message: "not one of the allowed values" });
          break;
        case "boolean":
          if (typeof v === "boolean") value[field] = v;
          else errors.push({ field: field, message: "not a boolean" });
          break;
        case "string":
          if (typeof v !== "string") { errors.push({ field: field, message: "not a string" }); break; }
          if (typeof spec.maxLen === "number" && v.length > spec.maxLen) { errors.push({ field: field, message: "exceeds maxLen " + spec.maxLen }); break; }
          value[field] = v;
          break;
        default:
          throw new Error("loop21-verifyskin: unknown spec type '" + spec.type + "' for field '" + field + "'");
      }
    });

    return { ok: errors.length === 0, value: value, errors: errors, warnings: warnings };
  }

  return { verifySkin: verifySkin, isColor: isColor, isSafeCssVar: isSafeCssVar };
});

// ---- CLI (Node only) ------------------------------------------------------
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  var api = (typeof globalThis !== "undefined" ? globalThis : this).__loop21VerifySkin;
  var args = process.argv.slice(2);
  if (!args.length || args.indexOf("--help") !== -1) {
    process.stdout.write(
      "loop21-verifyskin — strict, zero-dep validator for user skin config\n" +
      "  node loop21-verifyskin.js config.json schema.json   print the verdict JSON\n" +
      "  node loop21-verifyskin.js --help\n"
    );
    process.exit(0);
  }
  try {
    var fs = require("fs");
    if (args.length < 2) throw new Error("need a config.json and a schema.json");
    var config = JSON.parse(fs.readFileSync(args[0], "utf8"));
    var schema = JSON.parse(fs.readFileSync(args[1], "utf8"));
    var res = api.verifySkin(config, schema);
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    process.exit(res.ok ? 0 : 2); // nonzero when the config is rejected
  } catch (e) {
    var msg = e && e.message ? e.message : String(e);
    if (msg.indexOf("loop21-verifyskin:") !== 0) msg = "loop21-verifyskin: " + msg;
    process.stderr.write(msg + "\n");
    process.exit(1);
  }
}
