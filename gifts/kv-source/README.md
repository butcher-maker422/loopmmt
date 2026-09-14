# kv-source

**Parse plain `KEY=VALUE` text into a uniform JSONL record stream.**

A tiny, dependency-free tool that turns non-JSONL text — a `.env`, a `.properties`, a plain key=value config — into the front of a pipe: one JSON object per line ([JSON Lines](https://jsonlines.org/)), one record per assignment, ready to feed *into* the fold/filter/transform tools. Reads a file argument, or text on stdin.

```
PORT=8080            ->  {"key":"PORT","value":"8080"}
# a comment          ->  (skipped)
HOST = localhost     ->  {"key":"HOST","value":"localhost"}
GREETING="hi there"  ->  {"key":"GREETING","value":"hi there"}
```

Every record has the same two string fields, so it drops straight into a generic filter or fold:

```
node kv-source.js .env | node range-filter.js ...
node kv-source.js .env | node dedup-filter.js
```

## The model

```
[FILE]              key=value file to parse (default: read stdin)
--key-field NAME    field the parsed KEY is emitted under (default "key")
--value-field NAME  field the parsed VALUE is emitted under (default "value"; must differ from --key-field)
```

## The grammar (declared, so it is pinnable)

* Lines split on newline; a trailing CR is stripped, so a file parses identically whether it uses LF or CRLF.
* A whitespace-only line emits nothing.
* A line whose first non-whitespace character is `#` is a **full-line comment** and emits nothing. There are no inline/trailing comments — a `#` inside a value is part of the value.
* Any other line must be `KEY=VALUE`, split on the **first** `=`. The key is trimmed and must match `[A-Za-z_][A-Za-z0-9_.-]*`; the value is trimmed, and if it begins and ends with a matching `"` or `'`, those outer quotes are stripped (the inner text is literal — no escape processing).
* A non-blank, non-comment line with no `=`, or an illegal/empty key, is a hard error (exit `2`).

Duplicate keys across lines are **not** merged — each line emits its own record, in file order. De-duplication is `dedup-filter`'s job downstream.

## Strings only (the honesty axis)

Values are emitted as **literal strings** — kv-source does not guess types. `"8080"` stays the string `"8080"`; `"true"` stays `"true"`. This is deliberate: the moment a parser coerces (is `08` octal? is `1e3` a number? is `TRUE` a boolean?), the *same file* parses to different bytes under different tools, and a source you cannot pin is not a source. kv-source emits strings and lets a downstream typed tool decide. For the same reason it does **not** interpolate `${VAR}`/`$VAR`, does **not** strip an `export ` prefix, does **not** honor inline comments, and does **not** process backslash escapes inside quotes — each is a context-dependent guess that would break byte-determinism.

## Exit codes

`0` success (including an empty stream from empty input) · `2` input error (malformed line, illegal/empty key, `--key-field` == `--value-field`, empty field name, unknown option, a second positional file, or an unreadable file). Always a clean one-line message on stderr, never a stack trace.

## In a browser

The core is a pure function. Load `kv-source.js` and call `window.ForestGifts.kvSource.parse(text, {keyField, valueField})` for an array of records, or `window.ForestGifts.kvSource.toJSONL(records)` for the JSONL text.

## The edge

kv-source parses **plain `KEY=VALUE` text into uniform string records only**. It does not coerce types, does not interpolate `${VAR}`, does not strip an `export ` prefix, does not honor inline comments, and does not process escapes inside quotes. An honest, pinnable parse — not a full dotenv runtime.

## License

MIT. Zero dependencies. Runs in Node or a browser.
