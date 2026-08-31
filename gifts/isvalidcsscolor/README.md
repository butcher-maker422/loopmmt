# isvalidcsscolor — is this string actually a CSS color? (no DOM, no deps)

A pure `isValidCSSColor(str) -> boolean` that decides whether a string is a valid
CSS color, running **identically in a browser and in Node** — no DOM, no
dependencies, one file you can read in a sitting.

## Why this exists

You take a color from a human — a theme field, a config file, a `?color=` param —
and before you write it into a stylesheet or a canvas you want to know: *is this
actually a color?* The browser's honest oracle, `CSS.supports('color', str)`,
only exists **in a browser** and needs the DOM. In a Node server, a build step,
or a test, there is no built-in answer. This is the small pure function that
gives you one.

## What it accepts (the whole contract — a validator that hides its scope lies)

- **Named colors** — the 148 CSS Color Module Level 4 names, plus `transparent`
  and the `currentColor` keyword. Case-insensitive.
- **Hex** — `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA` (3/4/6/8 hex digits).
- **`rgb()` / `rgba()`** — both the **legacy** comma form `rgb(255, 0, 0)` /
  `rgba(255,0,0,.5)` (all-number **or** all-percent, no mixing; optional alpha)
  and the **modern** space form `rgb(255 0 0 / 50%)` (number | percent | `none`
  per channel, mixing allowed, optional `/ alpha`).
- **`hsl()` / `hsla()`** — legacy `hsl(120, 50%, 50%)` and modern
  `hsl(120deg 50% 50% / .5)`. Hue may be a bare number (degrees) or an `<angle>`
  (`deg` / `grad` / `rad` / `turn`).

Out-of-range numeric channels are **accepted**, because CSS accepts and clamps
them: `rgb(300 -10 0)` is a valid color that renders as red. Validity is about
grammar, not range.

## Use it

```sh
node isvalidcsscolor.js "rebeccapurple"        # prints true|false, exits 0|1
node isvalidcsscolor.js "#0f0" "not-a-color"   # one verdict per argument
node isvalidcsscolor.js --help
```

In a browser, load `isvalidcsscolor.js` and call
`window.LoopGifts.isValidCSSColor(str)`. In Node, `require`:

```js
const { isValidCSSColor } = require('./isvalidcsscolor.js');
isValidCSSColor('#00ff0080');        // true
isValidCSSColor('rgb(255 0 0 / .5)'); // true
isValidCSSColor('inherit');          // false — a CSS-wide keyword is not a color
isValidCSSColor(42);                 // false — a color is a string, not a number
```

## Its edge (a gift that hides its edges is not a gift)

This validates a **defined subset** of the CSS Color spec — the colors people
actually type. It deliberately does **not** accept the newer color functions:
`hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`, `color()`, `color-mix()`, the
relative-color syntax (`rgb(from …)`), or **system colors** (`Canvas`,
`ButtonText`, …). The CSS-wide keywords `inherit`, `initial`, `unset`, `revert`
are **not colors** and are rejected. If you need the full modern surface in a
browser, `CSS.supports('color', str)` is the ground truth; this gift trades that
breadth for a tiny, DOM-free, dependency-free core. It answers *"is this a color
by this documented grammar,"* not *"will every browser on earth paint it."*

## Test

```sh
node test_isvalidcsscolor.js
```

38 valid + 34 invalid curated spec vectors (every grammar branch — named,
hex 3/4/6/8, rgb/hsl legacy + modern, angles, out-of-range clamps, and the
documented exclusions), plus non-string coercion, determinism, and a
mutation-bite that fails loudly if the core stops discriminating. stdlib only,
no dependencies.

## License

MIT — use it in anything, including something you sell.
