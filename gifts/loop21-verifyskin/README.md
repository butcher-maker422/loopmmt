# loop21-verifyskin

A pure, dependency-free, **strict** validator for user-submitted "skin" config
objects — colors, fonts, numbers, CSS custom properties — **before** you apply
them to a UI. Same code runs in a browser (`window.LoopGifts.verifySkin`) and in
Node (`require`, or the CLI). No DOM, no dependencies.

A theming feature hands you an untrusted object that you then splice into a
stylesheet or inline style. Trust it and you ship a CSS injection or a broken
layout from a typo'd number. This validates the **whole** object against a schema
you declare and tells you, honestly, what is wrong first.

```js
const { verifySkin } = require("./loop21-verifyskin.js");
const schema = {
  bg:     { type: "color", required: true },
  radius: { type: "integer", min: 0, max: 32 },
  theme:  { type: "enum", values: ["light", "dark"] }
};
const r = verifySkin(userConfig, schema);
if (r.ok) applySkin(r.value);   // r.value is only the fields that passed
else showErrors(r.errors);      // { field, message } each
```

## What "verify" means here

It does **not** mutate, coerce, or "fix" your config. It returns a verdict:

```
{ ok, value, errors, warnings }
```

- `ok` — true only when there are zero errors.
- `value` — the subset of the input that passed (known, well-typed fields), safe
  to apply.
- `errors` — hard failures: wrong type, out-of-range, a disallowed CSS value, a
  missing required field.
- `warnings` — soft: an unknown field that was dropped (forward-compat, not an
  error).

A validator that blurs "wrong" and "unknown" is lying about what it checked; this
one keeps them apart.

## The schema

A plain object mapping field name to a small spec:

- `{ type: "color" }` — a CSS color: `#rgb` / `#rrggbb` / `#rrggbbaa`,
  `rgb()/rgba()/hsl()/hsla()`, or an allowlisted named color. No `url()`, no
  `;`, no `}`.
- `{ type: "cssvar" }` — a CSS custom-property value, allowlisted to a safe
  grammar. Rejects `; { } < >`, `url(`, `@import`, `expression(`, `javascript:`.
- `{ type: "number", min, max }` — a finite number, optionally range-checked.
- `{ type: "integer", min, max }` — a number with no fractional part.
- `{ type: "enum", values: [...] }` — one of a fixed set.
- `{ type: "boolean" }` — true / false.
- `{ type: "string", maxLen }` — an arbitrary string, optionally length-capped.

Add `required: true` to make a missing field an error (default: optional).

## The edge

This gift is honest about its scope — a validator that hides its edges is not a
gift:

- The `string` type is **not** sanitized for a stylesheet. It length-caps and
  type-checks; if you splice a `string` value into CSS you must escape it
  yourself. Use `cssvar` for anything headed into a style surface — that is the
  type with the injection allowlist.
- The named-color allowlist is **conservative**, not exhaustive: an unknown
  color name is rejected, not guessed. Extend the list in your own copy if you
  need more.
- The `cssvar` allowlist is a **grammar** check (safe characters), not a full CSS
  value parser — it proves the value can't break out of a declaration, not that
  it is meaningful CSS.
- The schema is **yours**: a malformed schema (non-object, unknown spec type)
  **throws**, because that is a programmer error, not user input. Only the
  `config` is treated as untrusted and reported-not-thrown.

## Run it

```
node loop21-verifyskin.js config.json schema.json   # prints the verdict JSON
node loop21-verifyskin.js --help
```

Exit code is `0` when the config is accepted, `2` when it is rejected, `1` on a
usage/IO error.

## Tests

`test_loop21-verifyskin.js` — 18 known-answer cases with **out-of-band oracles**:
every color/cssvar/number/integer/enum/boolean/string path, CSS-injection
rejection, unknown-field dropping, required-missing errors, non-object config
reported-not-thrown, multi-error reporting, and two ratchet-refusal cases (bad
schema, unknown spec type).

```
node test_loop21-verifyskin.js
```

## License

MIT. See `LICENSE`.
