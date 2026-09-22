# dialect

One Markdown source, many honest dialects — from **data, not code**. A tiny,
dependency-free engine that renders a parsed Markdown AST into a target text
dialect (a Reddit comment, a Reddit self-post, plain text, …) by folding it
through a **declarative ruleset** — a flat table of per-node emission rules —
instead of a hand-written emitter per target.

```
source ──▶ parse() ──▶ AST ──▶ render(ast, ruleset) ──▶ dialect text
```

## What it does

Every tool that "posts this Markdown to X" re-hand-rolls the same emitter: walk
the tree, decide how each node looks in the target, glue the strings. Hand-rolled,
that step multiplies — one writer per target, each its own small bugs — and the
usual over-correction is worse: a template DSL with conditionals and expressions,
a programming language in disguise.

This engine takes the middle. A ruleset is a flat JSON object keyed by AST node
type, each value a small record of bounded knobs — a `wrap` pair, a `linePrefix`,
a `form` choice, a link `template`. It has **no conditionals, no expressions, no
loops you can author**. Substitution is a fixed, tiny set of placeholders:
`{content} {level} {n} {label} {href}`. Adding a dialect is adding a table, not
writing code — and the schema already holds new syntaxes (a Slack `*bold*`, a
Discord `||spoiler||`) as new `wrap` pairs.

It ships beside the [`markdown`](../markdown/) gift and folds over **its** AST:
it `require()`s that gift's `parse()` (no second parser) and reuses its `isSafeUrl`
guard, because link safety is never a per-dialect choice — an unsafe href
(`javascript:`, `data:`, …) is dropped to its plain-text label in **every**
dialect, by construction.

## The edge (what it does NOT do)

> The declarative ruleset covers the **~95%** of Markdown whose emission is a flat
> per-node substitution. It **stops at `table`**: column alignment is *logic* —
> it depends on the widths of every other cell in the column — not a flat
> substitution, so a table target needs a **code writer**, not a ruleset. This is
> the Simplicity-Yield line, and the engine will not cross it: a `table` node
> renders its cell content bare and is **reported as a hole**, never silently
> mangled into misaligned junk. A gift that hid its scope would lie; this one
> names the boundary in the README and in `--help`.
>
> It also holds **no** clock, network, or entropy, persists nothing to disk, and
> never throws on bad input: an unparseable construct degrades to literal text
> upstream in `parse()`, and an unruled node type renders bare and is reported.

## Usage

```
node dialect.js --ruleset reddit IN.md [-o OUT.md]   built-in ruleset by name
node dialect.js --ruleset ./my.json IN.md            ruleset from a JSON file
node dialect.js --ruleset reddit -                   read stdin, write stdout
node dialect.js --list                               list built-in rulesets
node dialect.js --selftest                           determinism + dialect self-test
node dialect.js --help
```

Node: `require("./dialect.js")` exports
`{ render, renderSource, RULESETS, resolveRuleset, validateRuleset }`.

```js
var D = require('./dialect.js');
var { text, holes } = D.renderSource('# Hi\n\n**bold**', D.RULESETS.reddit);
// text  -> "**Hi**\n\n**bold**\n"
// holes -> []   (every node type had a rule)
```

## The ruleset (the whole schema — a dialect that hides its scope lies)

```
{
  "name": "reddit",
  "blockJoin": "\n\n",                 // separator between top-level blocks
  "blocks": {
    "heading":    { "form": "bold" | "atx" | "bold-none" },
    "paragraph":  {},
    "blockquote": { "linePrefix": "> ", "innerJoin": "\n>\n" },
    "codeBlock":  { "form": "indent" | "fence", "indent": "    ", "fence": "```" },
    "list":       { "bullet": "- ", "ordered": "{n}. " }
  },
  "inline": {
    "strong":   { "wrap": ["**","**"] },
    "em":       { "wrap": ["*","*"] },
    "codeSpan": { "wrap": ["`","`"] },
    "break":    { "text": "  \n" },
    "link":     { "form": "inline" | "label" | "labelHref",   // [t](u) | t | t (u)
                  "template": "[{label}]({href})" }            // form:inline uses this
  }
}
```

Any block or inline key omitted falls back to a bare, honest default (content only).

## Ruleset validation (the four decidable predicates)

An external ruleset (a `--ruleset ./my.json` file) is **validated at load** and
**loud-stops** on a structural fault, before any rendering. The validator checks
exactly **four decidable structural predicates** — the shape the engine
substitutes into — and nothing semantic (an unknown node, a missing block rule,
an odd marker are all honest-degraded at render time, not rejected here):

1. every `wrap` value is a 2-element `[open, close]` pair
2. `blockJoin`, when present, is a string
3. any link `template` contains both `{label}` and `{href}` (a template missing
   either silently drops content)
4. any `linePrefix`, when present, is a string

It stays **four** on purpose. The moment a ruleset wants conditionals or
expressions, that is the Simplicity-Yield line — the answer is a per-target code
writer, not a fifth predicate or a richer validator. `validateRuleset(ruleset)`
is exported for programmatic callers; it returns the ruleset on success and throws
an `Error` naming every violation on failure.

## Honesty / determinism

- `parse()` never throws — an unparseable construct degrades to literal text.
- `render()` is a **pure fold** — same AST + same ruleset ⇒ byte-identical output.
  `--selftest` proves folds-twice-identical.
- A ruleset with a hole (a node type it doesn't name) does not crash: the node
  renders its content bare and the hole is **reported** in `.holes`, never
  silently dropped.

## Tests

```
node dialect.js --selftest      # determinism + per-dialect deltas + validator (23 checks)
node test_dialect.js            # hand-authored oracle corpus (30 checks, 3 mutation bites)
```

The oracle in `test_dialect.js` hand-authors every expected output from the
ruleset rules (not by running the gift), draws its known-bad half from the real
failure shapes the engine prevents (kept-markup, surviving-unsafe-href,
silently-loading-a-malformed-ruleset), and carries three mutation bites that prove
the checks have teeth.

Released under MIT. Zero dependencies. Single file (beside the `markdown` gift).
