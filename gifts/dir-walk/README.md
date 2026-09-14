# dir-walk

**Walk a directory tree into a deterministic, portable JSONL stream — in one dependency-free file.**

Point `dir-walk` at a directory and it emits one JSON record per file, directory, and symlink it finds, in a stable sorted order that is byte-identical on every machine. It is the "give me this tree as data" adapter — the front of a pipe that lets the JSON fold/filter/transform tools work on a filesystem.

```
node dir-walk.js ./src                            ->  one JSONL record per entry, sorted
node dir-walk.js . --files-only --max-depth 2     ->  files only, no deeper than depth 2
node dir-walk.js src --no-size | node dedup-filter.js --key type
```

Each record is a fixed, portable shape:

```
{"path":"src/a.js","name":"a.js","type":"file","depth":1,"size":128}
```

## The quiet failures it fixes

Everyone reaches for a recursive `fs.readdirSync`, and everyone gets it wrong in three ways that only bite on another machine or another run:

1. **Non-deterministic order.** `fs.readdirSync` returns entries in the filesystem's own order, which differs across OSes, filesystems, and even runs. A walk that emits in that order produces a *different* stream on every machine — un-diffable, un-pinnable, useless as a golden. dir-walk **sorts** every directory's entries by name (byte order) before descending, so the same tree always yields the same stream.

2. **Leaky, unportable stat.** The raw `fs.Stats` object carries `mtime`, `ino`, `mode`, `uid`, `blocks` — values that change between runs and machines and would make the "same" tree hash differently every time. dir-walk emits only a **fixed portable subset** — `path`, `name`, `type`, `depth`, and `size` for files — the fields that are a property of the tree's *shape*, not of the moment you looked at it. (`size` is opt-out with `--no-size` for a shape-only stream.)

3. **Symlink cycles and surprise descent.** Naive recursion follows symlinks and can loop forever on a cycle, or wander out of the tree you meant. dir-walk does **not** follow symlinks: a symlink is reported as its own entry (`type: "symlink"`) and never descended, so a walk always terminates and stays inside the tree. (Depth is also boundable with `--max-depth`.)

## The model

The pure core is `walk(provider, opts)`. The **provider** is the only impure edge — an object with `readdir(dir) -> [{name, type}]` and `size(file) -> number`. The CLI supplies a real-filesystem provider (built-in `fs`); a test or a browser supplies an in-memory one. The walk itself is pure, so the same provider and options always yield byte-identical output — which is exactly what lets it be tested against an in-memory fixture and pinned as a golden.

## Options

```
--files-only     emit only file/symlink records, not directories
--dirs-only      emit only directory records (mutually exclusive with --files-only)
--max-depth N    do not descend past depth N (the root's children are depth 1; N=0 emits nothing)
--no-size        omit the size field (shape-only; also skips the size() call)
--root-name NM   label for the root in emitted paths (default: paths are relative)
```

## Determinism

`walk(provider, opts)` is a pure function of the provider's answers and the options — no clock, no randomness, no ambient state read into the output. Entries are sorted by name within each directory, traversal is a stable pre-order (a directory record precedes its children), symlinks are reported but never followed, and only portable fields are emitted. Given a provider that returns the same answers, the output is byte-identical on every run and every machine.

## Exit codes

`0` success (including an empty directory, which yields an empty stream) · `2` usage error (an unknown option, a duplicate root, a bad `--max-depth`, or `--files-only` with `--dirs-only`) · `3` the root does not exist or is not a directory. Always a clean one-line message on stderr, never a stack trace.

## In a browser

The core is pure and filesystem-free. Load `dir-walk.js` and call `window.ForestGifts.dirWalk.walk(provider, opts)` with your own in-memory provider (`readdir`/`size`), then `toJSONL(records)` to render the stream. `sortedByName(entries)` is exposed for reuse.

## The edge

dir-walk emits a **sorted, portable pre-order** stream of `{path, name, type, depth, size}`. It does **not** follow symlinks (they are reported, never descended), does **not** emit `mtime`/`ino`/`mode`/`uid` (unportable, time-varying), does **not** match globs (pipe the stream into a filter gift), and does **not** read file contents (use `line-source` for that). The root record is not emitted; its children are depth 1.

## License

MIT. Zero dependencies. Runs in Node or a browser.
