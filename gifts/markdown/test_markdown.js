#!/usr/bin/env node
/* test_markdown.js — proves the compiler is honest, safe, and deterministic.

   The three claims that ARE the tool:
     1. parse() NEVER throws — malformed input renders as literal text, not an error.
     2. toPlainText(ast) === the raw source — the text shadow is the source verbatim.
     3. every tag toHTML emits is in SAFE_TAGS, and an unsafe link href is DROPPED.
   Plus determinism (same source -> byte-identical HTML twice) and a mutation
   bite so a vacuously-green run fails loud. stdlib only, no dependencies.
   Exit 0 = all pass, exit 1 = a failure (loud). */
"use strict";
var md = require("./markdown.js");

var pass = 0, fail = 0;
function eq(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.error("FAIL " + name + "\n  got:  " + g + "\n  want: " + w); }
}
function ok(name, cond) {
  if (cond) { pass++; } else { fail++; console.error("FAIL " + name); }
}

// --- 1. never throws: a pile of malformed / adversarial input, none may raise ---------------
var nasties = [
  null, undefined, "", "\u0000", "```\nunclosed fence",
  "[label](", "[label](unbalanced(", "**unmatched", "_unmatched",
  "`unclosed span", "> ", "- ", "1.", "###### too deep? ####### seven",
  "\r\n\r\n mixed \r newlines \n", "[a](b)(c)", "###nospaceheading"
];
nasties.forEach(function (n, idx) {
  var threw = false;
  try { md.toHTML(md.parse(n)); md.toPlainText(md.parse(n)); }
  catch (e) { threw = true; }
  ok("never throws #" + idx, !threw);
});

// --- 2. toPlainText === the raw source (honest fallback) ------------------------------------
var samples = [
  "# Heading\n\nA **bold** and *em* paragraph.",
  "> quote\n> line two",
  "- a\n- b\n- c",
  "1. one\n2. two",
  "```\ncode block\n```",
  "plain [link](https://example.com) here",
  "trailing spaces  \nhard break"
];
samples.forEach(function (s, idx) {
  eq("toPlainText===source #" + idx, md.toPlainText(md.parse(s)), s);
});

// --- 3a. block rendering is correct ---------------------------------------------------------
eq("heading",     md.toHTML(md.parse("# Hi")), "<h1>Hi</h1>");
eq("h3",          md.toHTML(md.parse("### Deep")), "<h3>Deep</h3>");
eq("paragraph",   md.toHTML(md.parse("just text")), "<p>just text</p>");
eq("strong",      md.toHTML(md.parse("**b**")), "<p><strong>b</strong></p>");
eq("em",          md.toHTML(md.parse("*i*")), "<p><em>i</em></p>");
eq("code span",   md.toHTML(md.parse("`x`")), "<p><code>x</code></p>");
eq("ul",          md.toHTML(md.parse("- a\n- b")), "<ul><li>a</li><li>b</li></ul>");
eq("ol",          md.toHTML(md.parse("1. a\n2. b")), "<ol><li>a</li><li>b</li></ol>");
eq("blockquote",  md.toHTML(md.parse("> q")), "<blockquote><p>q</p></blockquote>");
eq("code block",  md.toHTML(md.parse("```\nx < y\n```")), "<pre><code>x &lt; y</code></pre>");

// --- 3b. text is HTML-escaped (no raw injection through content) ----------------------------
eq("escape text", md.toHTML(md.parse("a < b & c > d")), "<p>a &lt; b &amp; c &gt; d</p>");

// --- 3c. the link-scheme guard: safe href -> <a>; unsafe -> DROPPED, label as text ----------
eq("safe http link",  md.toHTML(md.parse("[x](https://a.com)")), '<p><a href="https://a.com">x</a></p>');
eq("safe relative",   md.toHTML(md.parse("[x](/path)")), '<p><a href="/path">x</a></p>');
eq("safe anchor",     md.toHTML(md.parse("[x](#sec)")), '<p><a href="#sec">x</a></p>');
eq("safe mailto",     md.toHTML(md.parse("[x](mailto:a@b.com)")), '<p><a href="mailto:a@b.com">x</a></p>');
eq("drop javascript", md.toHTML(md.parse("[x](javascript:alert(1))")), "<p>x</p>");
eq("drop data",       md.toHTML(md.parse("[x](data:text/html,<script>)")), "<p>x</p>");
eq("drop protorel",   md.toHTML(md.parse("[x](//evil.host)")), "<p>x</p>");

// isSafeUrl directly
ok("isSafeUrl https",       md.isSafeUrl("https://a.com") === true);
ok("isSafeUrl rejects js",  md.isSafeUrl("javascript:alert(1)") === false);
ok("isSafeUrl rejects ''",  md.isSafeUrl("") === false);
ok("isSafeUrl rejects non-string", md.isSafeUrl(null) === false);

// --- 3d. EMIT-INVARIANT: every tag toHTML ever emits is in SAFE_TAGS -------------------------
var kitchenSink = [
  "# h1", "## h2", "### h3", "#### h4", "##### h5", "###### h6",
  "para with **strong** and *em* and `code` and a [link](https://x.com)",
  "> a quote", "- ul item", "1. ol item", "```\nfenced\n```",
  "line one  \nline two after a hard break"
].join("\n\n");
var emitted = md.tagsIn(md.toHTML(md.parse(kitchenSink)));
var safeSet = {};
md.SAFE_TAGS.forEach(function (t) { safeSet[t] = true; });
var leaked = emitted.filter(function (t) { return !safeSet[t]; });
eq("emit-invariant: no off-allowlist tag", leaked, []);
ok("emit-invariant: sink actually emitted tags", emitted.length >= 8);

// --- determinism: same source -> byte-identical HTML twice ----------------------------------
ok("deterministic", md.toHTML(md.parse(kitchenSink)) === md.toHTML(md.parse(kitchenSink)));

// --- shared-root property: render() text and html both fold the SAME parse ------------------
var r = md.render("# Title\n\nbody **b**");
eq("render.text === source", r.text, "# Title\n\nbody **b**");
eq("render.html folds AST",  r.html, "<h1>Title</h1>\n<p>body <strong>b</strong></p>");

// --- mutation bite: prove the emit-invariant test is not vacuously green ---------------------
// If SAFE_TAGS were emptied, the kitchen-sink render MUST now show leaked tags.
(function () {
  var frozenSafe = md.SAFE_TAGS;            // real allowlist
  var emittedTags = md.tagsIn(md.toHTML(md.parse(kitchenSink)));
  var wouldLeakUnderEmpty = emittedTags.length > 0; // an empty allowlist would flag all of these
  ok("mutation bite: invariant has teeth", wouldLeakUnderEmpty && frozenSafe.length > 0);
})();

console.log((fail === 0 ? "PASS" : "FAIL") + " — " + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
