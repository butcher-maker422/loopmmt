# units-convert

**Convert a quantity from one unit to another — and refuse, honestly, when the two units are not the same kind of thing.** Zero dependencies, deterministic, and correct about the one conversion everyone gets wrong: temperature.

Converting metres to kilograms is not a rounding error to absorb — it is a category mistake. `units-convert` returns a blank verdict (`ok:false`) instead of a fabricated number whenever the two units belong to different dimensions.

```js
convert(value, fromUnit, toUnit)
// -> { ok, value, from, to, dimension }
```

`ok:false` blanks every field — the caller shows **nothing** rather than a wrong number.

## The one rule that makes it honest: affine vs linear

Most units are **linear** — a pure ratio to a base unit (`1 km = 1000 m`, so you scale). **Temperature is not.** Celsius and Fahrenheit each have their own zero, so a conversion is `y = a·x + b`, not `y = a·x`. Treating °C like a linear ratio is the single most common unit-conversion bug: it makes `0 °C` convert to `0 °F` instead of `32 °F`, and every temperature after it is wrong.

`units-convert` models **every** unit as `(factor, offset)` to a base, so the affine case is exact and there is **no separate "temperature mode" to forget**:

```
to base   = x · factor + offset
from base  = (base − offset) / factor
```

Linear units simply have `offset = 0`.

## Dimensions and units

| dimension | base | units |
|---|---|---|
| length | metre | `m km cm mm mi yd ft in nmi` |
| mass | kilogram | `kg g mg t lb oz` |
| time | second | `s ms min h d wk` |
| temperature | kelvin | `K C F` |
| angle | radian | `rad deg grad turn` |

Length, mass, and angle factors are **exact declared constants** (international definitions: `1 mi = 1609.344 m`, `1 lb = 0.45359237 kg`).

## Use it

```bash
node units-convert.js 100 C F
# -> {"ok":true,"value":211.99999999999997,"from":"C","to":"F","dimension":"temperature"}

node units-convert.js 1 mi m
# -> {"ok":true,"value":1609.344,"from":"mi","to":"m","dimension":"length"}

node units-convert.js 1 m kg    # cross-dimension -> refuses
# -> {"ok":false,"value":null,"from":"","to":"","dimension":""}   (exit 1)

node units-convert.js --units   # the full unit table, one JSON object per line
```

In code (Node or browser — `window.ForestGifts.unitsConvert`):

```js
const { convert } = require("./units-convert.js");
convert(100, "C", "F");   // { ok:true, value: 211.99999999999997, ... }
```

## Honest by construction

- **Cross-dimension** conversion (`m → kg`) returns `ok:false` with blank fields — it never invents a number across dimensions.
- An **unknown unit** on either side → blank (never a guessed alias).
- A **non-finite or non-number** value (`NaN`, `Infinity`, a string) → blank — those are not quantities.
- **Same unit** in and out → the value unchanged, exact.

## What this is **not**

units-convert converts within a **closed, declared table** of single units across five dimensions using fixed exact factors. It does **not** parse compound units (`km/h`, `N·m`), do currency or any time-varying rate, guess unit aliases it was not told, or carry significant figures — it returns the **full-precision double** and leaves rounding to you.

## License

MIT. Zero dependencies. Single file. Runs identically in Node and a browser.
