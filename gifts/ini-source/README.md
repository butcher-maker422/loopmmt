# ini-source

Parse INI / `.gitconfig`-style **sectioned** config text into a uniform JSONL record
stream — the front of a pipe you feed into the fold / filter / transform gifts. Zero
dependencies, deterministic, runs unchanged in Node or a browser. MIT.

```
$ printf '[server]\nhost=localhost\nport=8080\n; note\n[client]\nhost=10.0.0.1\n' | node ini-source.js
{"section":"server","key":"host","value":"localhost"}
{"section":"server","key":"port","value":"8080"}
{"section":"client","key":"host","value":"10.0.0.1"}
```

Every record is the same three string fields — `{section, key, value}` — so it drops
straight into a generic filter or fold:

```
ini-source app.ini | pluck --fields key,value
ini-source app.ini | range-filter ...
```

## The shape (the design decision that makes it compose)

One record per key-assignment, the **flat** uniform triple `{section, key, value}` — **not**
one nested record per section. A nested `{section, entries:{…}}` record would carry the
section's structure but would not compose with the flat fold/filter/transform gifts, which
cannot reach into a per-record sub-object with a generic `--field`. The flat triple lets a
downstream gift filter by section, pluck the key/value, or fold across sections without
knowing the file's shape. Keys that appear **before** any `[section]` header (a global
preamble, as in `.gitconfig`) are emitted with section `""` — the honest "no section"
marker, never an invented default name (rename it with `--global NAME`).

## The honesty axis that is its own

A key that appears **twice within the same section** is a **hard error** (exit 2), naming
the line, the key, and the section. This is the whole reason `ini-source` is its own gift
rather than a flag on `kv-source`: the common INI-parser behaviour is to silently keep the
**last** (or the first) of a duplicated key — which changes the caller's data without
telling them. `ini-source` refuses. The same key in **different** sections is fine (that is
what sections are for). A **repeated `[section]` header** is refused the same way — merging
or overriding two blocks of the same name is the same silent guess one level up.

## The grammar (declared, so it is pinnable)

* A leading UTF-8 BOM on the document is stripped.
* Lines split on newline; a trailing CR is stripped, so a file parses identically as LF or CRLF.
* A whitespace-only line emits nothing.
* A line whose first non-whitespace character is `;` or `#` is a full-line comment — nothing.
  (No inline comments: a `;` or `#` inside a value is part of the value.)
* A trimmed line `[ NAME ]` is a **section header**; `NAME` is trimmed, must be non-empty,
  and must contain no `[` or `]`. An empty `[]` or malformed header is exit 2. A section
  name may appear only once.
* Any other non-blank line is `KEY=VALUE`, split on the **first** `=`. `KEY` is trimmed and
  must match `[A-Za-z_][A-Za-z0-9_.-]*`. `VALUE` is trimmed; matching outer `"`/`'` quotes
  are stripped (no escape processing). A line with no `=` is malformed (exit 2).

## Strings only (the honesty axis, inherited)

Values are literal **strings** — `ini-source` does not coerce types (`8080` stays a string),
does not interpolate `${VAR}`/`%VAR%`, does not honor inline comments, and does not process
escapes inside quotes. Each is a context-dependent guess that would make the same file parse
to different bytes across tools. It parses the grammar it was given and refuses the rest.

## The model

```
[FILE]                INI file to parse (default: read stdin)
--section-field NAME  field the SECTION is emitted under (default "section")
--key-field NAME      field the parsed KEY is emitted under (default "key")
--value-field NAME    field the parsed VALUE is emitted under (default "value")
--global NAME         section name for keys before any header (default "")
```

The three field names must be pairwise distinct (a collision is exit 2).

## Exit codes

`0` success (including an empty stream from empty input) · `2` input error — malformed line,
illegal/empty key, empty/malformed header, **duplicate key in a section**, **repeated
section header**, field-name collision, empty field name, unknown option, unreadable file.
Always a clean one-line message on stderr, never a stack trace.

## In a browser

```html
<script src="ini-source.js"></script>
<script>
  const { parse, toJSONL } = window.ForestGifts.iniSource;
  toJSONL(parse("[s]\nk=v\n"));   // '{"section":"s","key":"k","value":"v"}\n'
</script>
```

## The edge

`ini-source` parses INI/`.gitconfig`-style sectioned config into uniform string records
only. It does not coerce types, interpolate variables, honor inline comments, or process
escapes — and it **refuses** (exit 2) a duplicate key within a section or a repeated
section header rather than silently overwriting. An honest, pinnable parse — not a full INI
runtime.

## License

MIT.
