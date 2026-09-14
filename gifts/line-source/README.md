# line-source

**Turn a plain-text file into a JSONL record stream, one record per line.**

A tiny, dependency-free tool that takes line-oriented text on stdin and emits one JSON object per line ([JSON Lines](https://jsonlines.org/)): `{"line":"...","n":0}`. It's the adapter at the front of a pipe — it lets the JSONL stream tools consume ordinary text files (a log, a word list, any line-per-record text) without you hand-writing JSON.

```
printf 'a\nb\nc\n' | node line-source.js   ->  {"line":"a","n":0} {"line":"b","n":1} {"line":"c","n":2}
node line-source.js < access.log | node range-filter.js ...
```

## The three quiet failures it fixes

Everyone "knows" how to split a file into lines — `text.split("\n")` — and everyone gets it subtly wrong, in three ways that only bite later:

1. **The phantom empty record.** A well-formed text file ends with a newline, so `"abc\ndef\n".split("\n")` yields `["abc","def",""]` — a bogus trailing empty. line-source treats a final newline as the **terminator** it is (POSIX: a line is text followed by a newline), not a separator, so `"abc\ndef\n"` is exactly **two** lines. A file with *no* final newline is also two lines — the last line is still a line. "Ends with a newline" versus "doesn't" never changes the record count.

2. **CRLF.** Windows files end lines with `\r\n`. Splitting on `\n` alone leaves a trailing `\r` glued to every record — invisible, and a silent mismatch the moment you compare or key on that field. line-source recognizes `\r\n`, `\n`, and a lone `\r`, and strips the terminator, whatever the file's convention.

3. **The BOM.** A UTF-8 file may open with a byte-order mark (U+FEFF) that glues an invisible character to the first record. line-source strips a single leading BOM before splitting.

## The model

```
--field NAME   key holding the line text (default "line")
--index NAME   key holding the 0-based line number (default "n"; "" disables the index)
--skip-blank   drop lines empty after the terminator is stripped
--trim         strip surrounding ASCII whitespace from each line's text
```

Each line becomes `{ line: <text-without-terminator>, n: <0-based index> }`, in file order, one JSON object per output line.

**`--skip-blank` keeps `n` honest.** A dropped blank line leaves a *gap* in `n`, because `n` is the line's original position in the source file — a faithful pointer, not a re-count. `"a\n\nc\n" --skip-blank` emits `{line:"a",n:0}` then `{line:"c",n:2}`.

**Bytes are preserved unless you ask.** Without `--trim`, the line text is verbatim (minus the terminator and a leading BOM). `--trim` strips surrounding whitespace; nothing else ever does.

## Exit codes

`0` success (including empty input → empty stream) · `2` input error (empty `--field` name, an unknown option, or an unexpected positional argument — line-source reads text from stdin). Always a clean one-line message on stderr, never a stack trace.

## In a browser

The core is a pure function. Load `line-source.js` and call `window.ForestGifts.lineSource.lines(text, {field, index, skipBlank, trim})` for an array of records, or `window.ForestGifts.lineSource.toJSONL(records)` for the JSONL text. `splitLines(text)` is also exported if you only want the terminator-correct line array.

## The edge

line-source splits on line **terminators** (`\r\n`, `\n`, `\r`) and emits one record per line. It does **not** parse CSV fields (use `csv-source`), does **not** parse JSON (the lines are emitted as verbatim strings), does **not** read the file itself (you pipe text in), and does **not** sort or deduplicate. It preserves line bytes (minus the terminator and a leading BOM); with `--trim` it strips surrounding whitespace, and never otherwise.

## License

MIT. Zero dependencies. Runs in Node or a browser.
