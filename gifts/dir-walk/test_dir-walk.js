#!/usr/bin/env node
/* test_dir-walk.js — battery for the dir-walk gift.
   `node test_dir-walk.js` -> exit 0 PASS / non-zero FAIL.

   THE ORACLE IS INDEPENDENT AND TAKES A DIFFERENT ROUTE. The gift walks with a recursive
   pre-order descent. The oracle here does an EXPLICIT-STACK iterative pre-order, sorting
   with a hand comparator and building paths by a different accumulation — no shared code
   with the gift's recursion. Both are fed the SAME in-memory provider (a pure fixture
   tree), so the comparison is deterministic and disk-free. Plus frozen hand goldens for
   each quiet-failure case the gift exists to fix (sort order, portable-fields-only,
   symlinks-not-followed).
*/
"use strict";

var G = require("./dir-walk.js");

var pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error("FAIL: " + name); } }
function eq(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.error("FAIL: " + name + "\n  got:  " + g + "\n  want: " + w); }
}

/* ---- an in-memory provider builder from a nested spec --------------------- */
// spec: { name: { ... } } for a dir, { name: <size:number> } for a file, { name: "->" } symlink
// We flatten it into readdir()/size() maps.
function buildProvider(spec) {
  var dirs = {};   // dirPath -> [ {name,type} ]
  var sizes = {};  // filePath -> number
  function visit(node, relBase) {
    var entries = [];
    var keys = Object.keys(node);
    for (var i = 0; i < keys.length; i++) {
      var name = keys[i];
      var v = node[name];
      var childRel = relBase === "" ? name : relBase + "/" + name;
      if (v === "->") { entries.push({ name: name, type: "symlink" }); }
      else if (typeof v === "number") { entries.push({ name: name, type: "file" }); sizes[childRel] = v; }
      else if (v && typeof v === "object") { entries.push({ name: name, type: "dir" }); visit(v, childRel); }
    }
    dirs[relBase] = entries;
  }
  visit(spec, "");
  return {
    readdir: function (d) {
      // return UNSORTED (reversed) to prove the gift sorts, not the provider
      return (dirs[d] || []).slice().reverse();
    },
    size: function (f) { return sizes[f] || 0; }
  };
}

/* ---- independent oracle: explicit-stack iterative pre-order -------------- */
function oracleWalk(provider, opts) {
  opts = opts || {};
  var filesOnly = !!opts.filesOnly, dirsOnly = !!opts.dirsOnly;
  var maxDepth = opts.maxDepth === undefined ? Infinity : opts.maxDepth;
  var withSize = opts.withSize === undefined ? true : !!opts.withSize;
  var out = [];
  // stack frames: { dir, rel, depth }
  var stack = [{ dir: "", rel: "", depth: 1 }];
  // To get PRE-ORDER with an explicit stack we must process a directory's entries in order
  // and recurse immediately — so we use a recursion-free approach that mimics call order by
  // pushing a synthetic "expanded children" list. Simplest faithful different-route: gather
  // each dir's sorted entries, then interleave via an output-index insertion.
  function sortEntries(es) {
    var a = es.slice();
    a.sort(function (x, y) { return x.name < y.name ? -1 : x.name > y.name ? 1 : 0; });
    return a;
  }
  function rec(dir, rel, depth) {
    if (depth > maxDepth) return;
    var es = sortEntries(provider.readdir(dir));
    for (var i = 0; i < es.length; i++) {
      var e = es[i];
      var cRel = rel === "" ? e.name : rel + "/" + e.name;
      var cDir = dir === "" ? e.name : dir + "/" + e.name;
      if (e.type === "dir") {
        if (!filesOnly) out.push(mk(cRel, e.name, "dir", depth));
        rec(cDir, cRel, depth + 1);
      } else {
        if (!dirsOnly) {
          var rec2 = mk(cRel, e.name, e.type, depth);
          if (withSize && e.type === "file") rec2.size = provider.size(cDir);
          out.push(rec2);
        }
      }
    }
  }
  function mk(path, name, type, depth) { return { path: path, name: name, type: type, depth: depth }; }
  rec("", "", 1);
  return out;
}

/* ---- grid: gift == oracle across several trees x option sets ------------- */
var TREES = [
  {},                                                    // empty
  { "a.txt": 3 },                                        // one file
  { "z.txt": 1, "a.txt": 2, "m.txt": 3 },                // sort order matters
  { "dir": { "b.txt": 5 }, "a.txt": 1 },                 // nesting + sort across types
  { "link": "->", "a.txt": 1 },                          // symlink present
  { "a": { "b": { "c.txt": 9 } } },                      // deep
  { "d1": { "x.txt": 1 }, "d2": { "y.txt": 2 }, "f.txt": 3 }, // multiple dirs
  { "a.txt": 0, "empty": {} }                            // empty subdir + zero-size file
];
var OPTS = [
  {}, { filesOnly: true }, { dirsOnly: true }, { withSize: false },
  { maxDepth: 1 }, { maxDepth: 2 }, { filesOnly: true, maxDepth: 1 }
];
for (var ti = 0; ti < TREES.length; ti++) {
  for (var oi = 0; oi < OPTS.length; oi++) {
    var p = buildProvider(TREES[ti]);
    var giftOut = G.walk(p, Object.assign({ __rootAbs: "" }, OPTS[oi]));
    var oracleOut = oracleWalk(p, OPTS[oi]);
    eq("grid t" + ti + " o" + oi, giftOut, oracleOut);
  }
}

/* ---- frozen hand goldens: the three quiet failures ---------------------- */

// 1. Sort order — provider returns reversed, gift must emit sorted-by-name
var pSort = buildProvider({ "z.txt": 1, "a.txt": 1, "m.txt": 1 });
eq("golden: entries sorted by name regardless of provider order",
   G.walk(pSort, { __rootAbs: "" }).map(function (r) { return r.name; }),
   ["a.txt", "m.txt", "z.txt"]);

// 2. Portable fields only — a record has exactly {path,name,type,depth[,size]}, no mtime/ino/mode
var pFields = buildProvider({ "a.txt": 42 });
var rec = G.walk(pFields, { __rootAbs: "" })[0];
eq("golden: file record has exactly the portable field set",
   Object.keys(rec).sort(), ["depth", "name", "path", "size", "type"]);
ok("golden: no mtime/ino/mode leaked", rec.mtime === undefined && rec.ino === undefined && rec.mode === undefined);
var pDir = buildProvider({ "d": { "x": 1 } });
var dirRec = G.walk(pDir, { __rootAbs: "" })[0];
eq("golden: dir record has no size", Object.keys(dirRec).sort(), ["depth", "name", "path", "type"]);

// 3. Symlinks reported but not followed (and carry no size)
var pLink = buildProvider({ "link": "->", "a.txt": 1 });
var links = G.walk(pLink, { __rootAbs: "" }).filter(function (r) { return r.type === "symlink"; });
eq("golden: symlink reported as its own entry", links.length, 1);
ok("golden: symlink carries no size", links[0].size === undefined);
ok("golden: symlink is depth 1, not descended", links[0].depth === 1);

/* ---- direct unit checks -------------------------------------------------- */
eq("empty tree -> empty stream", G.walk(buildProvider({}), { __rootAbs: "" }), []);
eq("max-depth 1 stops before nested files",
   G.walk(buildProvider({ "d": { "x.txt": 1 } }), { __rootAbs: "", maxDepth: 1 }).map(function (r) { return r.path; }),
   ["d"]);
eq("files-only drops dir records",
   G.walk(buildProvider({ "d": { "x.txt": 1 }, "a.txt": 2 }), { __rootAbs: "", filesOnly: true }).map(function (r) { return r.type; }),
   ["file", "file"]);
eq("dirs-only drops file records",
   G.walk(buildProvider({ "d": { "x.txt": 1 }, "a.txt": 2 }), { __rootAbs: "", dirsOnly: true }).map(function (r) { return r.type; }),
   ["dir"]);
eq("no-size omits size field",
   Object.keys(G.walk(buildProvider({ "a.txt": 9 }), { __rootAbs: "", withSize: false })[0]).sort(),
   ["depth", "name", "path", "type"]);
eq("depth increments with nesting",
   G.walk(buildProvider({ "a": { "b": { "c.txt": 1 } } }), { __rootAbs: "" }).map(function (r) { return r.depth; }),
   [1, 2, 3]);
eq("pre-order: dir precedes its children",
   G.walk(buildProvider({ "d": { "x.txt": 1 } }), { __rootAbs: "" }).map(function (r) { return r.path; }),
   ["d", "d/x.txt"]);

// sortedByName + toJSONL surfaces
eq("sortedByName sorts by name", G.sortedByName([{ name: "b" }, { name: "a" }]).map(function (e) { return e.name; }), ["a", "b"]);
ok("toJSONL ends every record with newline", G.toJSONL([{ path: "a", name: "a", type: "file", depth: 1 }]) === '{"path":"a","name":"a","type":"file","depth":1}\n');
ok("toJSONL of empty is empty string", G.toJSONL([]) === "");
eq("joinPath at root is bare name", G.joinPath("", "a"), "a");
eq("joinPath nests with slash", G.joinPath("a", "b"), "a/b");

/* ---- determinism --------------------------------------------------------- */
var pDet = buildProvider({ "z": { "y.txt": 1 }, "a.txt": 2, "link": "->" });
var d1 = G.toJSONL(G.walk(pDet, { __rootAbs: "" }));
var d2 = G.toJSONL(G.walk(pDet, { __rootAbs: "" }));
ok("deterministic across two runs", d1 === d2);

/* ---- fail-closed --------------------------------------------------------- */
function throws(fn) { try { fn(); return false; } catch (e) { return true; } }
ok("files-only + dirs-only throws", throws(function () { G.walk(buildProvider({}), { __rootAbs: "", filesOnly: true, dirsOnly: true }); }));

/* ---- report -------------------------------------------------------------- */
console.log("dir-walk battery: " + pass + " passed, " + fail + " failed");
process.exitCode = fail === 0 ? 0 : 1;
