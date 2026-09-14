# json-source

**Stream the elements of a JSON array as a JSONL record stream.**

A tiny, dependency-free tool that turns a JSON array — the shape an API response, an export, or a `[ ... ]` file so often arrives in — into the front of a pipe: one element per line ([JSON Lines](https://jsonlines.org/)), ready to feed *into* the fold/filter/transform tools. Reads a file argument, or text on stdin.

```
[{"id":1},{"id":2}]   ->  {"id":1}
                          {"id":2}
[1, 2, 3]             ->  1
                          2
                          3
```

When the elements are objects, they are records the consuming tools read directly:

```
node json-source.js users.json | node dedup-filter.js --key id
```

## The model

```
[FILE]   JSON file to stream (default: read stdin). Top-level value must be an array;
         each element becomes one output line.
```

## Top-level array only (the honesty axis)

The input's top-level value **must** be a JSON array — that is the only thing that *is* a stream. A bare object, number, string, boolean, or `null` is a single value, not a stream, so json-source **refuses** it (exit `2`) rather than guess how to "streamify" it (wrap it? emit its entries? emit it as one line?). Each guess is a different tool; refusing keeps json-source one honest thing. Malformed JSON is likewise a hard error (exit `2`), never a partial or repaired parse.

## Canonical re-serialization

Each element is emitted via canonical compact `JSON.stringify` — object key order is preserved from the input, but input **whitespace** and **number tokens** are normalized to canonical JSON form (`1e3` → `1000`, `1.0` → `1`, `[ 1 ,2 ]` → `[1,2]`). This is the JSON *value*, losslessly; it is not the input's exact bytes. The result is deterministic: the same input yields byte-identical output every run.

## Exit codes

`0` success (including an empty stream from `[]`) · `2` input error (malformed JSON, a non-array top-level, an unknown option, a second positional file, or an unreadable file). Always a clean one-line message on stderr, never a stack trace.

## In a browser

The core is a pure function. Load `json-source.js` and call `window.ForestGifts.jsonSource.parse(text)` for the array of elements, or `window.ForestGifts.jsonSource.toJSONL(elements)` for the JSONL text.

## The edge

json-source streams the elements of a **top-level JSON array only**. It refuses a non-array top-level and malformed JSON (exit `2`), and re-serializes each element to canonical compact JSON (normalizing number tokens and whitespace, preserving key order). It reads JSON, not JSON5/NDJSON, and parses the whole document (not an incremental stream).

## License

MIT. Zero dependencies. Runs in Node or a browser.
