# csv-source

**Turn CSV text into a JSONL record stream — one object per row.**

A tiny, dependency-free tool that reads CSV (a file, or stdin) and emits one JSON object per data row ([JSON Lines](https://jsonlines.org/)). CSV is the shape most real tabular data arrives in; csv-source is the on-ramp that turns it into the one-object-per-line stream the other stream tools consume — the front of a pipe.

```
name,age            ->  {"name":"ada","age":"36"}
ada,36                  {"name":"grace","age":"41"}
grace,41
```

```
cat people.csv | node csv-source.js | node dedup-filter.js --key name
```

## The model

```
FILE          optional .csv path; with none, reads stdin
--no-header   row 1 is data, not names; keys become c0, c1, c2, ...
--fill VALUE  pad short rows to the header width with VALUE (else a short row errors)
--delim CH    field delimiter, one character (default ",")
```

With a header (the default), each row emits `{ name0: v0, name1: v1, ... }` under the header names. Under `--no-header`, keys are `c0..c{n-1}` by column index, so the stream is always well-keyed.

## RFC 4180, honestly

It parses the real grammar, not a comma-split: fields may be quoted with `"` `"`, a quote inside a quoted field is written `""` (doubled), and a quoted field may contain commas and newlines. Both `LF` and `CRLF` endings are accepted; a trailing newline is optional. Unquoted fields are taken verbatim — CSV does not trim, so `csv-source` does not either.

## Values are strings (the honesty axis)

Every emitted value is a **string**, exactly as it appeared in the file. csv-source does **not** guess types — `"36"` stays `"36"`, not `36`; `"true"` stays `"true"`; `""` is the empty string, not `null`. CSV carries no type information, so a source that inferred types would be inventing data the file never held, and the same file could parse differently on different guessers. Type it downstream on purpose, never by accident here.

## Ragged rows fail closed

With a header, every data row must have exactly as many fields as the header. A row with too few or too many is a hard error (exit `2`) that names the row — never silently padded or truncated. If you actually want padding, opt in with `--fill VALUE`: short rows are filled, long rows are still an error. A duplicate or empty header name is also a hard error (either would silently hide a column).

## Exit codes

`0` success (including an empty file → an empty stream) · `2` input error (ragged row, duplicate or empty header name, unterminated quote, a stray quote in an unquoted field, a bad `--delim`, an unknown option, or an unreadable file). Always a clean one-line message on stderr, never a stack trace.

## In a browser

The core is a pure function. Load `csv-source.js` and call `window.ForestGifts.csvSource.parse(text, {header, fill, delim})` for an array of records, or `window.ForestGifts.csvSource.toJSONL(records)` for the JSONL text.

## The edge

csv-source emits **string values only** — it never infers types (numbers, booleans, and null stay as their text), never trims unquoted whitespace, and fails closed on a ragged row rather than padding it. A parser you can pin, not a comma-split you have to babysit.

## License

MIT. Zero dependencies. Runs in Node or a browser.
