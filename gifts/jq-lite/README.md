# jq-lite

**A tiny jq-style query language for JSON, in one dependency-free file.**

Reach for `jq`'s common moves — pull a field, index an array, iterate a stream, pipe one step into the next — without installing jq. jq-lite takes JSON on stdin (one value or a [JSON Lines](https://jsonlines.org/) stream) and applies a filter you write in a small, well-defined query language, emitting one JSON result per output.

```
echo '{"user":{"name":"ada"}}' | node jq-lite.js '.user.name'   ->  "ada"
echo '[1,2,3]'                 | node jq-lite.js '.[]'           ->  1  2  3
echo '{"items":[{"id":10},{"id":20}]}' | node jq-lite.js '.items[] | .id'  ->  10  20
printf '{"n":1}\n{"n":2}\n'    | node jq-lite.js '.n'           ->  1  2
```

## The quiet failures it fixes

Everyone reaches for `obj.a.b.c` in a script, and everyone gets it subtly wrong — in ways that only bite on the input you didn't test:

1. **The missing-key crash.** `obj.a.b` throws `Cannot read properties of undefined` the moment `obj.a` is absent. jq-lite follows jq's rule: a missing object key yields `null`, not an exception — `.a.b.c` on `{}` is `null`, quietly and correctly. You opt *into* strictness; you're never ambushed by it.

2. **The type confusion.** Indexing a string or number as if it were an object/array is a real error you *want* surfaced — but only when you meant it. jq-lite errors loudly on a genuine type mismatch, and gives you the `?` operator (`.foo?`, `.[]?`) to say "skip it if it doesn't fit", so one ragged record doesn't abort the whole stream.

3. **The stream fan-out.** `.[]` turns one input into *many* outputs, and a pipe must thread that: `.items[] | .id` runs `.id` over *each* item, not the array. Hand-rolled `.map(x => x.id)` forgets the empty-array case, the object case, and composing with a later `[]`. jq-lite treats every filter as value → stream, so it composes properly.

## The language (this is the whole of it — "lite" is the point)

```
.              identity — the input value, unchanged
.foo .foo.bar  field access (missing key -> null; non-object -> error unless ?)
.["a b"]       bracketed string key (for keys that aren't bare identifiers)
.[2] .foo[0]   array index (negative counts from the end: .[-1] is the last)
.[]            iterate — emit each array element, or each object VALUE, as a stream
a | b          pipe — run b over every output of a
.foo? .[0]? .[]?  optional — on a type mismatch, emit nothing instead of erroring
```

`.[]` over an object emits its **values**, in the object's own key order. A missing key is `null`; an out-of-range index is `null`; a real type mismatch is an error unless you mark the step `?`.

## Options

```
--raw-output, -r   print a string result without its quotes (jq -r)
--slurp, -s        read the whole input as ONE JSON array before filtering (jq -s)
--compact, -c      one-line JSON per result (the default)
```

## Determinism

`run(value, filter)` is a pure function — no clock, no randomness, no ambient state, no I/O beyond the value you pass. The same value and filter yield byte-identical output on every run and every machine. Object-value iteration follows key insertion order, which is stable for a given input.

## Exit codes

`0` success (including a filter that yields nothing) · `2` usage error (no filter, an unknown option, a malformed filter, or invalid JSON input — the filter is parsed *before* input is read, so syntax errors surface up front) · `3` a runtime type error the filter did not mark optional. Always a clean one-line message on stderr, never a stack trace.

## In a browser

The core is a pure function. Load `jq-lite.js` and call `window.ForestGifts.jqLite.run(value, filter)` for an array of results, `parse(filter)` for the compiled step list, or `parseInputs(text)` to split a JSONL string into values.

## The edge

jq-lite implements a **small subset** of jq — identity, field/index/bracket access, `.[]` iteration, the pipe, and the `?` optional. It has **no** functions, **no** arithmetic, **no** object/array construction, **no** `select`/`map`/comparison, **no** recursion (`..`). For those, use jq itself. It is a reach tool for the common pull-this-out / walk-this-stream case, not a jq replacement.

## License

MIT. Zero dependencies. Runs in Node or a browser.
