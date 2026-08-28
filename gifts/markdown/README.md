# markdown — one Markdown source, two honest shadows

A tiny, dependency-free Markdown compiler with a single root and pure emitters:

```
source ──▶ parse() ──▶ AST ──▶ { toHTML, toPlainText }
```

The point isn't "another Markdown parser." It's the **shared-root property**:
every rendering is a pure fold over the *one* parsed AST, so the plain-text view
and the HTML view can never silently disagree about what the writer typed.

## Two honesty rules baked in

- **`parse()` never throws.** A construct it can't parse degrades to *literal
  text* rather than raising. A malformed document renders as itself, not an error.
- **`toPlainText(ast)` === the raw source.** The text view *is* the Markdown the
  writer typed — an honest fallback by construction, never a lossy re-strip that
  could drift from the HTML render.

## The one guard that matters

A link's `href` is the only user-controlled danger, so it gets the only real
guard: `isSafeUrl` allows `http` / `https` / `mailto` / relative paths / `#anchor`
and **rejects everything else** — `javascript:`, `data:`, `vbscript:`,
protocol-relative `//host`, and any unknown scheme. A rejected href is **dropped**:
the link renders as its plain-text label, never as a live link.

There is **no runtime HTML scrubber**. `toHTML` emits a fixed, frozen tag
vocabulary (`SAFE_TAGS`) by construction, so no user input can ever become a tag.
That's a stronger guarantee than sanitizing untrusted HTML after the fact, and it
needs no dependency. The test suite scans the emitted HTML and asserts every
opened tag is in the allowlist, so a future edit that leaks a new tag fails loud.

## The grammar (a deliberate, bounded subset)

- **blocks:** heading (`# … ######`), blockquote (`>`), ordered/unordered list,
  fenced code block (` ``` `), paragraph
- **inline:** strong (`**` or `__`), em (`*` or `_`), code span (`` ` ``),
  link `[text](url)`, hard break (two trailing spaces)

Not CommonMark — small on purpose. It covers the constructs a person actually
types in a note or a message, and refuses to grow a dependency to do more.

## Use it

Node or a browser, no build step, no install.

```bash
echo "# Hello" | node markdown.js            # read Markdown on stdin, print HTML
echo "# Hello" | node markdown.js --text     # print the plain-text shadow (=== the source)
node markdown.js "**bold** [x](https://ex.com)"   # read Markdown from an argument
```

As a library:

```js
const md = require("./markdown.js");
const ast = md.parse("# Title\n\nbody **b**");
md.toHTML(ast);        // "<h1>Title</h1>\n<p>body <strong>b</strong></p>"
md.toPlainText(ast);   // "# Title\n\nbody **b**"  (=== the source)
md.render(source);     // { text, html } in one call — the guard can't be forgotten
```

In the browser, drop the file in and use `window.markdown` (same API).

## Test it

```bash
node test_markdown.js     # 52 checks: never-throws, text===source, link guard,
                          # emit-invariant, determinism, + a mutation bite
```

Deterministic: the same source always yields the same AST and the same output.

MIT licensed. Take the folder.
