#!/usr/bin/env node
/* dir-walk.js — walk a directory tree into a deterministic JSONL stream of entries.
   Dependency-free, deterministic, MIT. Runs in Node (the CLI reads the real filesystem)
   or a browser (the pure core walks an injected in-memory tree).

   WHAT IT IS. A SOURCE: it takes a directory in and emits a JSONL stream out — one record
   per file/directory found, in a stable, sorted, reproducible order — the front of a pipe
   that lets the fold/filter/transform gifts work on a filesystem:

     node dir-walk.js ./src | node schema-filter.js ...
     node dir-walk.js . --files-only --max-depth 2

   Each record is a fixed, portable shape: {"path":"src/a.js","name":"a.js","type":"file",
   "depth":1,"size":128}. It is the "give me this tree as data" adapter — a build/ops source.

   THE QUIET FAILURES IT FIXES. Everyone reaches for a recursive readdir and everyone gets
   it wrong in ways that only bite on another machine or another run:

     1. NON-DETERMINISTIC ORDER. `fs.readdirSync` returns entries in the filesystem's own
        order, which differs across OSes, filesystems, and even runs. A walk that emits in
        readdir order produces a DIFFERENT stream on every machine — un-diffable, un-
        pinnable, useless as a golden. dir-walk SORTS every directory's entries by name
        (byte order) before descending, so the same tree always yields the same stream.

     2. LEAKY, UNPORTABLE STAT. The raw `fs.Stats` object carries mtime, ino, mode, uid,
        blocks — values that change between runs and machines and would make the "same"
        tree hash differently every time. dir-walk emits only a FIXED, portable subset
        (path, name, type, depth, and size for files) — the fields that are a property of
        the tree's shape, not of the moment you looked at it. (size is opt-out with
        --no-size if you want shape-only.)

     3. SYMLINK CYCLES AND SURPRISE DESCENT. Naive recursion follows symlinks and can loop
        forever on a cycle, or wander out of the tree you meant. dir-walk does NOT follow
        symlinks by default — a symlink is reported as its own entry (type "symlink") and
        never descended — so a walk always terminates and stays inside the tree. (Depth is
        also boundable with --max-depth.)

   THE MODEL. The PURE CORE is `walk(provider, opts)`: it takes a PROVIDER (an object with
   `readdir(dirPath) -> [ {name, type} ]` sorted-or-not, `size(filePath) -> number`) and a
   root, and returns the sorted, deterministic array of entry records. The CLI supplies a
   real-filesystem provider (built-in `fs`); a test or a browser supplies an in-memory one.
   The impurity (touching the disk) lives ONLY in the provider — the walk itself is pure,
   so the same provider + opts always yield byte-identical output.

     --files-only        emit only file (and symlink) records, not directory records
     --dirs-only         emit only directory records
     --max-depth N       do not descend past depth N (root entries are depth 1)
     --no-size           omit the size field (shape-only; also skips the size() call)
     --root-name NAME    the label for the root in paths (default: the path you passed)

   DETERMINISM. walk(provider, opts) is a pure function of (provider's answers, opts). Given
   a provider that returns the same answers, the output is byte-identical on every run and
   every machine: entries are sorted by name within each directory, traversal is a stable
   pre-order (a directory record precedes its children), symlinks are not followed, and only
   portable fields are emitted. No clock, no randomness read into the OUTPUT.

   USAGE
     node dir-walk.js ./project
     node dir-walk.js . --files-only --max-depth 3
     node dir-walk.js src --no-size | node dedup-filter.js --key type
     node dir-walk.js --help

   Exit codes: 0 success (including an empty directory -> empty stream) · 2 usage error
   (unknown option, missing/duplicate root, bad --max-depth) · 3 the root does not exist or
   is not a directory. A clean one-line message on stderr, never a stack trace.

   Released under MIT. Its edge is printed in the README: dir-walk emits a SORTED, portable
   pre-order stream of {path,name,type,depth,size}. It does NOT follow symlinks (they are
   reported, never descended), does NOT emit mtime/ino/mode/uid (unportable, time-varying),
   does NOT match globs or filter by pattern (pipe into a filter gift), and does NOT read
   file CONTENTS (use line-source for that). The root record is not emitted; its children
   are depth 1.
*/
"use strict";

/* ==================================================================
   THE PURE CORE — walk(provider, opts) -> [entry, ...]
   The provider is the only impure boundary; the walk is pure.
     provider.readdir(dirPath) -> [ { name, type }, ... ]   (type: 'file'|'dir'|'symlink'|'other')
     provider.size(filePath)   -> number                    (only called for files when size wanted)
   ================================================================== */

// Join a parent path and a child name with a forward slash, normalizing so output is
// platform-independent ("src/a.js", never "src\\a.js"). Pure.
function joinPath(parent, name) {
  if (parent === "") return name;
  return parent + "/" + name;
}

// Sort directory entries by name in byte (code-unit) order — the determinism keystone.
// Pure; does not mutate the input.
function sortedByName(entries) {
  return entries.slice().sort(function (a, b) {
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
  });
}

// Build one entry record with the fixed, portable field set. Pure.
function makeRecord(relPath, name, type, depth, size) {
  var rec = { path: relPath, name: name, type: type, depth: depth };
  if (size !== undefined) rec.size = size;
  return rec;
}

// The deterministic pre-order walk. Pure function of the provider's answers and opts.
//   opts.filesOnly / opts.dirsOnly  — emit only files(+symlinks) / only dirs
//   opts.maxDepth                   — do not descend past this depth (root children = 1)
//   opts.withSize                   — include the size field for file records (default true)
//   opts.rootName                   — label for the root in paths (default "")
// Returns an array of entry records in stable pre-order (a dir precedes its children).
function walk(provider, opts) {
  opts = opts || {};
  var filesOnly = !!opts.filesOnly;
  var dirsOnly = !!opts.dirsOnly;
  var maxDepth = opts.maxDepth === undefined ? Infinity : opts.maxDepth;
  var withSize = opts.withSize === undefined ? true : !!opts.withSize;
  var rootLabel = opts.rootName === undefined ? "" : String(opts.rootName);

  if (filesOnly && dirsOnly) throw new Error("--files-only and --dirs-only are mutually exclusive");
  if (typeof maxDepth === "number" && maxDepth < 1 && maxDepth !== Infinity) {
    // maxDepth 0 means "emit nothing below root"; treat as an empty walk (root has no record)
  }

  var out = [];

  // recurse over a directory at absolute-ish `dirAbs` (what the provider understands),
  // whose path RELATIVE to the root is `relBase`, at `depth`.
  function descend(dirAbs, relBase, depth) {
    if (depth > maxDepth) return;
    var entries = sortedByName(provider.readdir(dirAbs));
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var childAbs = joinPath(dirAbs, e.name);
      var childRel = joinPath(relBase, e.name);
      var type = e.type;
      if (type === "dir") {
        if (!filesOnly) out.push(makeRecord(childRel, e.name, "dir", depth));
        // descend only if within depth budget; a symlink-typed entry is never descended
        descend(childAbs, childRel, depth + 1);
      } else {
        // file, symlink, or other
        if (!dirsOnly) {
          var size = undefined; // reset each iteration (var is function-scoped; do not leak a prior file's size)
          if (withSize && type === "file") size = provider.size(childAbs);
          out.push(makeRecord(childRel, e.name, type, depth, size));
        }
      }
    }
  }

  descend(opts.__rootAbs === undefined ? "" : opts.__rootAbs, rootLabel, 1);
  return out;
}

// Render entry records as JSONL text (one JSON object per line, trailing newline per record).
function toJSONL(records) {
  var s = "";
  for (var i = 0; i < records.length; i++) s += JSON.stringify(records[i]) + "\n";
  return s;
}

/* ==================================================================
   EXPORTS (browser + Node)
   ================================================================== */
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.dirWalk = { walk: walk, toJSONL: toJSONL, sortedByName: sortedByName };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { walk: walk, toJSONL: toJSONL, sortedByName: sortedByName, joinPath: joinPath };
}

/* ==================================================================
   THE REAL-FILESYSTEM PROVIDER (Node CLI only) — the one impure edge
   ================================================================== */
function fsProvider(rootAbs) {
  var fs = require("fs");
  var path = require("path");
  return {
    // returns [{name, type}] for the directory; type via lstat so symlinks are seen as symlinks
    readdir: function (relDir) {
      var abs = relDir === "" ? rootAbs : path.join(rootAbs, relDir);
      var names = fs.readdirSync(abs);
      var out = [];
      for (var i = 0; i < names.length; i++) {
        var full = path.join(abs, names[i]);
        var st;
        try { st = fs.lstatSync(full); } catch (e) { st = null; }
        var type = "other";
        if (st) {
          if (st.isSymbolicLink()) type = "symlink";
          else if (st.isDirectory()) type = "dir";
          else if (st.isFile()) type = "file";
        }
        out.push({ name: names[i], type: type });
      }
      return out;
    },
    size: function (relFile) {
      var abs = relFile === "" ? rootAbs : path.join(rootAbs, relFile);
      try { return require("fs").statSync(abs).size; } catch (e) { return 0; }
    }
  };
}

/* ==================================================================
   CLI (runs only when invoked directly, never on require)
   ================================================================== */

function parseArgs(args) {
  var opts = { withSize: true };
  var root = null;
  var i = 0;
  while (i < args.length) {
    var a = args[i];
    if (a === "--files-only") { opts.filesOnly = true; i++; }
    else if (a === "--dirs-only") { opts.dirsOnly = true; i++; }
    else if (a === "--no-size") { opts.withSize = false; i++; }
    else if (a === "--max-depth") {
      var v = args[i + 1];
      if (v === undefined) throw new Error("--max-depth requires a number");
      var n = parseInt(v, 10);
      if (String(n) !== String(v).trim() || n < 0) throw new Error("--max-depth must be a non-negative integer");
      opts.maxDepth = n;
      i += 2;
    }
    else if (a === "--root-name") {
      var rn = args[i + 1];
      if (rn === undefined) throw new Error("--root-name requires a value");
      opts.rootName = rn;
      i += 2;
    }
    else if (a.charAt(0) === "-") { throw new Error("unknown option " + a); }
    else {
      if (root !== null) throw new Error("unexpected extra argument " + JSON.stringify(a) + " (dir-walk takes one root directory)");
      root = a;
      i++;
    }
  }
  if (opts.filesOnly && opts.dirsOnly) throw new Error("--files-only and --dirs-only are mutually exclusive");
  if (root === null) root = ".";
  opts.root = root;
  return opts;
}

var HELP =
  "dir-walk.js — walk a directory tree into a deterministic JSONL stream of entries.\n\n" +
  "  node dir-walk.js ./project\n" +
  "  node dir-walk.js . --files-only --max-depth 3\n" +
  "  node dir-walk.js src --no-size | node dedup-filter.js --key type\n" +
  "  node dir-walk.js --help\n\n" +
  "  --files-only    emit only file/symlink records, not directories\n" +
  "  --dirs-only     emit only directory records\n" +
  "  --max-depth N   do not descend past depth N (root's children are depth 1)\n" +
  "  --no-size       omit the size field (shape-only)\n" +
  "  --root-name NM  label for the root in emitted paths (default: none, paths are relative)\n\n" +
  "Emits one JSON object per entry: { path, name, type, depth[, size] }, entries SORTED by\n" +
  "name within each directory (deterministic across machines). Symlinks are reported but\n" +
  "never followed. Only portable fields are emitted (no mtime/ino/mode).\n\n" +
  "Edge: dir-walk does NOT follow symlinks, does NOT emit time/inode/mode, does NOT match\n" +
  "globs (pipe into a filter gift), and does NOT read file contents (use line-source).\n";

function main(argv) {
  var args = argv.slice(2);
  if (args.indexOf("--help") !== -1 || args.indexOf("-h") !== -1) {
    process.stdout.write(HELP);
    return 0;
  }
  var opts;
  try { opts = parseArgs(args); }
  catch (e) { process.stderr.write("dir-walk: " + e.message + "\n"); return 2; }

  var fs = require("fs");
  var st;
  try { st = fs.statSync(opts.root); }
  catch (e) { process.stderr.write("dir-walk: not found: " + opts.root + "\n"); return 3; }
  if (!st.isDirectory()) { process.stderr.write("dir-walk: not a directory: " + opts.root + "\n"); return 3; }

  var provider = fsProvider(opts.root);
  var records;
  try {
    records = walk(provider, {
      filesOnly: opts.filesOnly,
      dirsOnly: opts.dirsOnly,
      maxDepth: opts.maxDepth,
      withSize: opts.withSize,
      rootName: opts.rootName === undefined ? "" : opts.rootName,
      __rootAbs: ""
    });
  } catch (e) { process.stderr.write("dir-walk: " + e.message + "\n"); return 2; }

  process.stdout.write(toJSONL(records));
  return 0;
}

if (typeof require !== "undefined" && require.main === module) {
  process.exitCode = main(process.argv);
}
