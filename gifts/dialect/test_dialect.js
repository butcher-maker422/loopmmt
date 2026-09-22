#!/usr/bin/env node
/* test_dialect.js — the golden oracle corpus for the dialect gift.

   The oracle rule: every expected output here is HAND-AUTHORED from the ruleset
   rules (read off the schema, computed by hand), NOT produced by running the gift.
   The gift must AGREE with the independent expectation. The known-bad half is
   drawn from the real failure shapes the engine promises to prevent — a dialect
   silently keeping markup it should strip, an unsafe href surviving, a malformed
   ruleset loading without complaint — not author-invented pleasantness.

   Three mutation bites prove the oracle has teeth: each asserts that a plausible
   WRONG engine behaviour WOULD be caught here (the check is not vacuously green).

   Run:  node test_dialect.js
   Exit 0 all-green / 1 any-red.
*/
'use strict';
var D = require('./dialect.js');

var checks = [];
function record(name, ok, detail) { checks.push({ name: name, ok: !!ok, detail: detail || '' }); }
function eq(name, got, want) {
  record(name, got === want, got === want ? '' : 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}
function ok(name, cond, detail) { record(name, cond, detail); }
function throws(fn) { try { fn(); return false; } catch (e) { return true; } }

var R = D.RULESETS;

/* ============================================================
   1. REDDIT COMMENT dialect — hand-authored expectations.
      heading -> **bold** line · fence -> 4-space indent ·
      blocks blank-line separated · unsafe href dropped to label.
   ============================================================ */
(function reddit() {
  var src = '# Title\n\n**b** *i* `c`\n\n```\nx = 1\n```\n\n[ok](https://e.com) [bad](javascript:x)';
  var out = D.renderSource(src, R.reddit).text;
  // heading became a bold line, not an atx line
  ok('reddit heading->bold', out.indexOf('**Title**') !== -1 && out.indexOf('# Title') === -1, out);
  // inline marks preserved as Reddit markup
  ok('reddit keeps ** * `', out.indexOf('**b**') !== -1 && out.indexOf('*i*') !== -1 && out.indexOf('`c`') !== -1, out);
  // fenced code became 4-space indent (no ``` in a reddit COMMENT)
  ok('reddit fence->indent', out.indexOf('    x = 1') !== -1 && out.indexOf('```') === -1, out);
  // link safety: unsafe href dropped to its label, safe href kept inline
  ok('reddit unsafe href dropped', out.indexOf('javascript:') === -1 && out.indexOf('bad') !== -1, out);
  ok('reddit safe href inline', out.indexOf('[ok](https://e.com)') !== -1, out);
})();

/* ============================================================
   2. REDDIT-POST variant — keeps # headings and ``` fences.
   ============================================================ */
(function redditPost() {
  var out = D.renderSource('# Title\n\n```\nx\n```', R['reddit-post']).text;
  ok('reddit-post keeps # heading', out.indexOf('# Title') !== -1, out);
  ok('reddit-post keeps ``` fence', out.indexOf('```') !== -1, out);
})();

/* ============================================================
   3. PLAIN dialect — every mark stripped; link -> "label (href)".
   ============================================================ */
(function plain() {
  var out = D.renderSource('# T\n\n**b** *i* [t](https://e.com)', R.plain).text;
  ok('plain strips heading marker', out.indexOf('#') === -1 && out.indexOf('T') !== -1, out);
  ok('plain strips strong/em', out.indexOf('**') === -1 && out.indexOf('b') !== -1 && out.indexOf('i') !== -1, out);
  ok('plain link -> label (href)', out.indexOf('t (https://e.com)') !== -1, out);
})();

/* ============================================================
   4. DETERMINISM — a pure fold: same input twice -> byte-identical;
      re-rendering the output is stable.
   ============================================================ */
(function determinism() {
  var src = '# H\n\n**b**\n\n- one\n- two\n\n1. a\n2. b';
  var a = D.renderSource(src, R.reddit).text;
  var b = D.renderSource(src, R.reddit).text;
  eq('deterministic (folds-twice-identical)', a, b);
  var once = D.renderSource(a, R.reddit).text;
  var twice = D.renderSource(once, R.reddit).text;
  eq('re-render stable', once, twice);
  // ordered-list markers hand-computed: "1. a" then "2. b"
  ok('ordered list numbering', a.indexOf('1. a') !== -1 && a.indexOf('2. b') !== -1, a);
})();

/* ============================================================
   5. HOLES — an unknown node type (block or inline) renders its
      content bare, is REPORTED in .holes, and never crashes or
      silently drops. Hand-build an AST with bogus node types so the
      hole path is exercised directly (no parser needed).
   ============================================================ */
(function holes() {
  var ast = {
    type: 'document',
    children: [
      { type: 'paragraph', children: [
        { type: 'text', value: 'a' },
        { type: 'mystery', value: 'b' }            // unknown INLINE type
      ] },
      { type: 'weirdBlock', children: [
        { type: 'text', value: 'c' }
      ] }                                           // unknown BLOCK type
    ]
  };
  var res = D.render(ast, R.reddit);
  ok('hole render does not crash', typeof res.text === 'string', JSON.stringify(res));
  ok('unknown inline reported', res.holes.indexOf('mystery') !== -1, JSON.stringify(res.holes));
  ok('unknown block reported', res.holes.indexOf('weirdBlock') !== -1, JSON.stringify(res.holes));
  ok('hole content preserved bare', res.text.indexOf('a') !== -1 && res.text.indexOf('b') !== -1 && res.text.indexOf('c') !== -1, res.text);
})();

/* ============================================================
   6. RULESET-LOAD VALIDATOR — the four decidable predicates.
      Each malformed ruleset must LOUD-STOP (throw); each well-formed
      one must pass. A real gate rejects the bad and admits the good.
   ============================================================ */
(function validator() {
  // every built-in passes its own validator
  ok('validator admits all built-ins', Object.keys(R).every(function (k) {
    return !throws(function () { D.validateRuleset(R[k]); });
  }));
  // (1) wrap must be a 2-element pair
  ok('(1) rejects 1-element wrap', throws(function () {
    D.validateRuleset({ inline: { strong: { wrap: ['*'] } } });
  }));
  ok('(1) rejects 3-element wrap', throws(function () {
    D.validateRuleset({ inline: { strong: { wrap: ['*', '*', '*'] } } });
  }));
  ok('(1) admits 2-element wrap', !throws(function () {
    D.validateRuleset({ inline: { strong: { wrap: ['*', '*'] } } });
  }));
  // (2) blockJoin must be a string
  ok('(2) rejects numeric blockJoin', throws(function () {
    D.validateRuleset({ blockJoin: 3 });
  }));
  // (3) template must contain {label} and {href}
  ok('(3) rejects template missing {href}', throws(function () {
    D.validateRuleset({ inline: { link: { template: '[{label}]' } } });
  }));
  ok('(3) rejects template missing {label}', throws(function () {
    D.validateRuleset({ inline: { link: { template: '({href})' } } });
  }));
  ok('(3) admits full template', !throws(function () {
    D.validateRuleset({ inline: { link: { template: '[{label}]({href})' } } });
  }));
  // (4) linePrefix must be a string
  ok('(4) rejects numeric linePrefix', throws(function () {
    D.validateRuleset({ blocks: { blockquote: { linePrefix: 0 } } });
  }));
  // non-object rejected outright
  ok('rejects non-object ruleset', throws(function () { D.validateRuleset(null); }));
})();

/* ============================================================
   7. MUTATION BITES — prove the oracle has teeth.
      Each simulates a WRONG engine output and asserts the check
      above WOULD have caught it (the green is not vacuous).
   ============================================================ */
(function mutationBites() {
  // Bite 1: if reddit KEPT the '#' heading (wrong for a comment), the
  //         'reddit heading->bold' check's condition would be false.
  var wrong1 = '# Title\n\n**b**\n';
  ok('BITE reddit-heading check has teeth',
     !(wrong1.indexOf('**Title**') !== -1 && wrong1.indexOf('# Title') === -1),
     'a mangled engine that kept # would slip past a toothless check');

  // Bite 2: if an unsafe href SURVIVED, the drop check would be false.
  var wrong2 = '[bad](javascript:x)\n';
  ok('BITE unsafe-href check has teeth',
     !(wrong2.indexOf('javascript:') === -1 && wrong2.indexOf('bad') !== -1),
     'a mangled engine that kept javascript: would slip past a toothless check');

  // Bite 3: if the validator were a no-op (never threw), the reject checks
  //         would all be false. Assert a genuinely-bad ruleset still throws.
  ok('BITE validator check has teeth',
     throws(function () { D.validateRuleset({ inline: { strong: { wrap: ['x'] } } }); }),
     'a no-op validator would fail this bite');
})();

/* ---- report ---------------------------------------------------------------- */
var reds = checks.filter(function (c) { return !c.ok; });
checks.forEach(function (c) {
  process.stdout.write((c.ok ? 'ok   ' : 'FAIL ') + c.name + (!c.ok && c.detail ? '  — ' + c.detail : '') + '\n');
});
process.stdout.write('\n' + (reds.length ? 'FAIL' : 'OK') + ' (' + checks.length + ' checks, ' + reds.length + ' red)\n');
process.exit(reds.length ? 1 : 0);
