# ndjson-source

**Validate and normalize an NDJSON stream into canonical JSONL.**

A tiny, dependency-free tool that reads [NDJSON](https://jsonlines.org/) — newline-delimited JSON, one JSON value per line, the shape a log, an export, or a `jq -c` stream so often arrives in — and re-emits it as canonical [JSON Lines](https://jsonlines.org/): one compact JSON value per line, ready to feed *into* the fold/filter/transform tools. Reads a file argument, or text on stdin.

```
{"id":1}              ->  {"id":1}
{"id":2}                  {"id":2}

{ "a": 1e3 }          ->  {"a":1000}     (whitespace + number tokens normalized)
[1, 2, 3]                 [1,2,3]
```

Object lines are records the consuming tools read directly:

```
node ndjson-source.js events.ndjson | node dedup-filter.js --key id
```

## Where it sits next to json-source

`json-source` streams a **top-level JSON array** — one `[ ... ]` document — and refuses a non-array top-level, because a single value is not a stream. NDJSON is the *other* shape: the stream is already spelled out, one value per line, with no enclosing array. **ndjson-source is the honest reader for that shape.** json-source unwraps an array into a stream; ndjson-source validates and canonicalizes a stream that is already line-delimited. It reads NDJSON, **not** a JSON array (use `json-source`) and **not** JSON5.

## The model

```
[FILE]   NDJSON file to read (default: read stdin). One JSON value per line; blank lines
         are skipped; each non-blank line becomes one output line.
```

## Per-line honesty (the honesty axis)

Each non-blank line **must** be exactly one valid JSON value. A malformed line — or a line carrying a second value after the first — is a hard error (exit `2`) that names the **1-based line number**, never a skipped line and never a partial or repaired parse. ndjson-source does not quietly drop the bad record and keep going (that silently changes your data); it stops and tells you which line. Blank lines (empty or whitespace-only) carry no record and are skipped — that is not a guess, a blank line is unambiguously not a value. CRLF and LF line endings are both accepted.

## Canonical re-serialization

Each value is emitted via canonical compact `JSON.stringify` — object key order is preserved from the input, but input **whitespace** and **number tokens** are normalized to canonical JSON form (`1e3` → `1000`, `1.0` → `1`, `{ "a" : 1 }` → `{"a":1}`). This is the JSON *value*, losslessly; it is not the input line's exact bytes. So ndjson-source is a **validator and normalizer**: valid-but-sloppy NDJSON comes out as canonical JSONL, byte-identical every run.

## Exit codes

`0` success (including an empty stream from empty or all-blank input) · `2` input error (a malformed JSON line, an unknown option, a second positional file, or an unreadable file). Always a clean one-line message on stderr, never a stack trace.

## In a browser

The core is a pure function. Load `ndjson-source.js` and call `window.ForestGifts.ndjsonSource.parse(text)` for the array of values, or `window.ForestGifts.ndjsonSource.toJSONL(values)` for the JSONL text.

## The edge

ndjson-source reads **NDJSON (one JSON value per line)** — not a JSON array (use `json-source`) and not JSON5. Blank lines are skipped; a malformed line is refused (exit `2`) with its 1-based line number, never skipped or repaired. Each value is re-serialized to canonical compact JSON (number tokens and whitespace normalized, key order preserved), so it validates and normalizes. It reads the whole input, not an incremental stream.

## License

MIT. Zero dependencies. Runs in Node or a browser.
