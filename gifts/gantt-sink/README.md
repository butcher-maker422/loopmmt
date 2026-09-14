# gantt-sink — (start,end,label) tasks → one standalone Gantt SVG, zero dependencies

One file. MIT. Pipe a stream of `(start, end, label)` tasks in, get one deterministic timeline SVG out.

```
$ printf '[0,3,"design"]\n[2,5,"build"]\n' | node gantt-sink.js
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 204 44" width="204" height="44">
<rect x="2" y="5" width="120" height="14" fill="#2f6f8f" />
<text x="4" y="16" font-size="11" fill="#111111">design</text>
<rect x="82" y="25" width="120" height="14" fill="#c25b3a" />
<text x="84" y="36" font-size="11" fill="#111111">build</text>
</svg>
```

One horizontal bar per task, top to bottom in the order you give them, each labeled — a schedule you
can drop straight into a README, a report, or a CI comment, with no project-management tool and no
runtime.

## Input

Stdin, one of:

- **JSONL** — one task per line, each `[start,end,label]` or `{"start":S,"end":E,"label":"…"}`
- **a single spec object** — `{ "tasks": [[start,end,label],…], "min": N, "max": N, "width": N, "row": N, "pad": N, "palette": "…" }`

`start`,`end` are finite numbers (timeline positions, `end >= start`); `label` is a string. CLI flags
(`--width` · `--row` · `--pad` · `--min` · `--max` · `--palette`) override object fields. Empty input →
a valid, empty `<svg>` frame.

```
$ echo '{"tasks":[[0,2,"a"],[1,4,"b"]],"palette":"cool"}' | node gantt-sink.js
```

## What it does NOT do — the printed edge

**This is a timeline-bar primitive, not a project-management tool.** It draws one `<rect>` bar per task
and one `<text>` label beside it, and renders **no axes, date labels, gridlines, dependency arrows, or
legend**, and embeds **no fonts** and **no `<script>`**.

Unlike its numbers-only siblings (`svg-sink`, `sparkline-sink`, `heatmap-sink`), gantt-sink **does place
caller text in the output** — the label — so it carries the one injection surface they avoid. That surface
is closed **deliberately**: every label is **XML-escaped** (`& < > " '`), so a caller string can never
break out of `<text>` content into markup. A label of `<script>alert(1)</script>` renders as the literal
text `&lt;script&gt;alert(1)&lt;/script&gt;` — never a real tag. Bar colors are **not** free-form input:
they come from a **fixed named palette** indexed by row, so no attacker-chosen attribute string can appear.
A **non-finite start/end, an end before its start, or a non-string label is a hard error**, never silently
dropped or guessed.

## Guarantees

- **Zero dependencies.** Imports nothing, shells out to nothing.
- **Deterministic.** Fixed 3-decimal coordinates, a fixed palette by row, rows in input order, every label
  escaped — the same tasks always yield **byte-identical** SVG (committable, diffable, cacheable). A Gantt
  is an *ordered* list, so reordering the tasks reorders the rows, by design.
- **One escaped surface.** The only caller-controlled bytes in the output are the label text, and it is
  XML-escaped; colors and font-size are fixed.
- **Honest framing.** A non-finite `start`/`end` throws naming its task; `end < start`, a non-string label,
  and an unknown palette all throw rather than mis-rendering.

Palettes: `loop` (default), `mono`, `warm`, `cool`.

## Use it as a library

```js
const { gantt } = require('./gantt-sink.js');
const svg = gantt({ tasks: [[0,3,"design"],[2,5,"build"]] });   // "<svg …>…</svg>\n"
```

In a browser it attaches to `window.LoopGifts['gantt-sink']` — `gantt(input, flags)` is a pure function,
safe to call in a render loop. `xmlEscape` is exported too, should you want the same escaping elsewhere.

## Test

```
$ node test_gantt-sink.js
```

The battery's oracle is **out-of-band**: the exact expected SVG for each sample input is hand-computed from
the documented geometry and escaping rules, written independently of the emitter — a build cannot certify
itself. It includes a hostile-label probe: a `<script>`/`<b>` label must appear only as escaped entities.

---

MIT © 2026 Shea Gunther. A Loop MMT gift. Fourth in the render-sink cluster — the one that takes on the
text-label surface the numbers-only siblings avoid, and closes it.
