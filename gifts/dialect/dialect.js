#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */
/* dialect.js — one Markdown source, many honest dialects, from DATA not code.
 *
 * A tiny, dependency-free engine that renders a parsed Markdown AST into a target
 * text dialect (Reddit comment, plain text, …) by folding it through a DECLARATIVE
 * RULESET — a flat table of per-node emission rules — instead of a hand-written
 * emitter per target.
 *
 *     source ──▶ parse() ──▶ AST ──▶ render(ast, RULESET) ──▶ dialect text
 *
 * WHY DATA, NOT CODE (the design decision, and the line it will not cross).
 * The obvious way to support a second target is a second emitter function. That's
 * the N-writers path, and it grows code without bound. The obvious OVER-correction
 * is a template DSL with conditionals and expressions — a programming language in
 * disguise, which is where "flexible" turns baroque. This engine takes the middle:
 * a ruleset is a flat JSON object keyed by AST node type, each value a small record
 * of bounded knobs (a wrap pair, a line-prefix, a marker, a form choice). It has
 * NO conditionals, NO expressions, NO loops you can author. Substitution is a fixed,
 * tiny set of placeholders: {content} {level} {n} {label} {href}. That is expressive
 * enough for the real dialects and it STOPS DEAD before becoming a language. A target
 * that genuinely needs logic gets a code writer; the ruleset covers the declarative 95%.
 *
 * THE REUSE (this ships beside the `markdown` gift and folds over ITS AST).
 * It require()s the markdown gift's parse() — no second parser — and reuses that
 * gift's isSafeUrl href guard, because link safety is never a per-dialect choice:
 * an unsafe href (javascript:, data:, …) is ALWAYS dropped to its plain-text label,
 * in every dialect, by construction.
 *
 * HONESTY / DETERMINISM (inherited and kept):
 *   * parse() never throws — an unparseable construct degrades to literal text.
 *   * render() is a pure fold — same AST + same ruleset ⇒ byte-identical output.
 *     --selftest proves folds-twice-identical.
 *   * A ruleset with a hole (a node type it doesn't name) does not crash: the node
 *     renders its content bare, and the hole is REPORTED, never silently dropped.
 *
 * THE RULESET SHAPE (the whole schema — a dialect that hides its scope lies):
 *   {
 *     "name": "reddit",
 *     "blockJoin": "\n\n",            // separator between top-level blocks
 *     "blocks": {
 *       "heading":    { "form": "bold" | "atx", ... },   // bold-line vs # line
 *       "paragraph":  {},                                 // content as-is
 *       "blockquote": { "linePrefix": "> ", "innerJoin": "\n>\n" },
 *       "codeBlock":  { "form": "indent" | "fence", "indent": "    ", "fence": "```" },
 *       "list":       { "bullet": "- ", "ordered": "{n}. " }
 *     },
 *     "inline": {
 *       "strong":   { "wrap": ["**","**"] },
 *       "em":       { "wrap": ["*","*"] },
 *       "codeSpan": { "wrap": ["`","`"] },
 *       "break":    { "text": "  \n" },
 *       "link":     { "form": "inline" | "label" | "labelHref",  // [t](u) | t | t (u)
 *                     "template": "[{label}]({href})" }          // form:inline uses this
 *     }
 *   }
 * Any block/inline key omitted falls back to a bare, honest default (content only).
 *
 * API (require):  render(ast, ruleset) -> { text, holes:[nodeType…] }
 *                 renderSource(src, ruleset) -> same, parsing src first
 * CLI:            dialect.js --ruleset reddit IN.md [-o OUT.md]
 *                 dialect.js --ruleset ./my-rules.json IN.md
 *                 dialect.js --list           (built-in rulesets)
 *                 dialect.js --selftest
 */
'use strict';

var path = require('path');
// Resolve the markdown gift. In the SHIPPED (served) home it's a sibling gift dir
// (../markdown/markdown.js). In the repo's design tree the served gift lives under
// projects/loopmmt-website/... — walk up looking for that. Try candidates in order;
// the first that loads wins. (A gift is zero-dependency at ship time — this dual
// path is a repo-checkout convenience, not a runtime dependency.)
var md = (function () {
  var candidates = [
    path.resolve(__dirname, '..', 'markdown', 'markdown.js') // shipped: sibling gift
  ];
  // walk parents looking for the served gifts dir
  var d = __dirname;
  for (var up = 0; up < 8; up++) {
    candidates.push(path.resolve(d, 'projects', 'loopmmt-website', 'site-root', 'gifts', 'markdown', 'markdown.js'));
    d = path.resolve(d, '..');
  }
  for (var i = 0; i < candidates.length; i++) {
    try { return require(candidates[i]); } catch (e) { /* try next */ }
  }
  throw new Error('dialect: cannot locate the markdown gift (markdown.js) in any known home');
})();

// ---- built-in rulesets ------------------------------------------------------
// Data, not code. Add a dialect by adding a table here (or passing a JSON file).
var RULESETS = {
  // Reddit COMMENT dialect: headings->bold line, blocks blank-line-separated,
  // code fences -> 4-space indent (``` unreliable in old-Reddit comments).
  reddit: {
    name: 'reddit',
    desc: 'Reddit comment — bold-line headers, blank-line blocks, indented code.',
    blockJoin: '\n\n',
    blocks: {
      heading:    { form: 'bold' },
      paragraph:  {},
      blockquote: { linePrefix: '> ', innerJoin: '\n>\n' },
      codeBlock:  { form: 'indent', indent: '    ' },
      list:       { bullet: '- ', ordered: '{n}. ' }
    },
    inline: {
      strong:   { wrap: ['**', '**'] },
      em:       { wrap: ['*', '*'] },
      codeSpan: { wrap: ['`', '`'] },
      break:    { text: '  \n' },
      link:     { form: 'inline', template: '[{label}]({href})' }
    }
  },

  // Reddit SELF-POST variant: keep # headings and ``` fences (posts render them).
  'reddit-post': {
    name: 'reddit-post',
    desc: 'Reddit self-post — keeps # headers and ``` fences (posts render them).',
    blockJoin: '\n\n',
    blocks: {
      heading:    { form: 'atx' },
      paragraph:  {},
      blockquote: { linePrefix: '> ', innerJoin: '\n>\n' },
      codeBlock:  { form: 'fence', fence: '```' },
      list:       { bullet: '- ', ordered: '{n}. ' }
    },
    inline: {
      strong:   { wrap: ['**', '**'] },
      em:       { wrap: ['*', '*'] },
      codeSpan: { wrap: ['`', '`'] },
      break:    { text: '  \n' },
      link:     { form: 'inline', template: '[{label}]({href})' }
    }
  },

  // Plain text: strip all markup. Emphasis vanishes; a link becomes "label (href)".
  plain: {
    name: 'plain',
    desc: 'Plain text — every mark stripped; a link becomes "label (href)".',
    blockJoin: '\n\n',
    blocks: {
      heading:    { form: 'bold-none' }, // content only, no marker
      paragraph:  {},
      blockquote: { linePrefix: '', innerJoin: '\n\n' },
      codeBlock:  { form: 'indent', indent: '    ' },
      list:       { bullet: '- ', ordered: '{n}. ' }
    },
    inline: {
      strong:   { wrap: ['', ''] },
      em:       { wrap: ['', ''] },
      codeSpan: { wrap: ['', ''] },
      break:    { text: '\n' },
      link:     { form: 'labelHref' } // "label (href)"
    }
  }
};

// ---- the engine: a pure fold of an AST through a ruleset ---------------------
function render(ast, ruleset) {
  var holes = {};
  if (!ast || ast.type !== 'document') return { text: '', holes: [] };
  var rs = ruleset || RULESETS.reddit;
  var blockJoin = rs.blockJoin != null ? rs.blockJoin : '\n\n';
  var out = ast.children.map(function (node) {
    return renderBlock(node, rs, holes);
  }).filter(function (s) { return s !== null && s !== ''; });
  return { text: out.join(blockJoin) + '\n', holes: Object.keys(holes) };
}

function renderBlock(node, rs, holes) {
  var rule = (rs.blocks && rs.blocks[node.type]) || null;
  switch (node.type) {
    case 'heading': {
      var body = renderInline(node.children, rs, holes);
      var form = rule ? rule.form : 'bold';
      if (form === 'atx') return repeat('#', node.level) + ' ' + body;
      if (form === 'bold-none') return body;
      return '**' + body + '**'; // 'bold' default
    }
    case 'paragraph':
      return renderInline(node.children, rs, holes);
    case 'blockquote': {
      var prefix = rule && rule.linePrefix != null ? rule.linePrefix : '> ';
      var innerJoin = rule && rule.innerJoin != null ? rule.innerJoin : '\n>\n';
      return node.children.map(function (b) {
        var inner = renderBlock(b, rs, holes);
        return inner.split('\n').map(function (ln) { return prefix + ln; }).join('\n');
      }).join(innerJoin);
    }
    case 'codeBlock': {
      var text = node.text.replace(/\n$/, '');
      var cform = rule ? rule.form : 'indent';
      if (cform === 'fence') {
        var fence = rule && rule.fence ? rule.fence : '```';
        return fence + '\n' + text + '\n' + fence;
      }
      var indent = rule && rule.indent ? rule.indent : '    ';
      return text.split('\n').map(function (ln) { return indent + ln; }).join('\n');
    }
    case 'list': {
      var bullet = rule && rule.bullet ? rule.bullet : '- ';
      var orderedTpl = rule && rule.ordered ? rule.ordered : '{n}. ';
      var n = 0;
      return node.items.map(function (it) {
        n++;
        var marker = node.ordered ? orderedTpl.replace('{n}', String(n)) : bullet;
        return marker + renderInline(it.children, rs, holes);
      }).join('\n');
    }
    default:
      holes[node.type] = true;
      return node.children ? renderInline(node.children, rs, holes) : '';
  }
}

function renderInline(nodes, rs, holes) {
  var inline = rs.inline || {};
  return (nodes || []).map(function (n) {
    switch (n.type) {
      case 'text': return n.value;
      case 'strong': return wrapWith(inline.strong, ['**', '**'], renderInline(n.children, rs, holes));
      case 'em': return wrapWith(inline.em, ['*', '*'], renderInline(n.children, rs, holes));
      case 'codeSpan': return wrapWith(inline.codeSpan, ['`', '`'], n.value);
      case 'break': return inline.break && inline.break.text != null ? inline.break.text : '  \n';
      case 'link': {
        var label = renderInline(n.children, rs, holes);
        // link safety is universal, never a per-dialect choice
        if (!md.isSafeUrl(n.href)) return label;
        var href = n.href.trim();
        var lr = inline.link || { form: 'inline', template: '[{label}]({href})' };
        if (lr.form === 'label') return label;
        if (lr.form === 'labelHref') return label + ' (' + href + ')';
        var tpl = lr.template || '[{label}]({href})';
        return tpl.replace('{label}', label).replace('{href}', href);
      }
      default:
        holes[n.type] = true;
        return n.children ? renderInline(n.children, rs, holes) : (n.value || '');
    }
  }).join('');
}

function wrapWith(rule, dflt, content) {
  var w = rule && rule.wrap ? rule.wrap : dflt;
  return (w[0] || '') + content + (w[1] || '');
}
function repeat(s, n) { var o = ''; for (var k = 0; k < n; k++) o += s; return o; }

function renderSource(src, ruleset) {
  return render(md.parse(String(src == null ? '' : src)), ruleset);
}
function resolveRuleset(nameOrObj) {
  if (nameOrObj && typeof nameOrObj === 'object') return nameOrObj;
  return RULESETS[nameOrObj] || null;
}

// ---- ruleset-load validator -------------------------------------------------
// Validate a ruleset at LOAD for exactly FOUR decidable STRUCTURAL predicates,
// and loud-stop (throw) on failure. This checks the SHAPE the engine substitutes
// into, never the SEMANTICS of a dialect — an unknown node type, a missing block
// rule, an unusual marker are all honest-degraded at render time (holes reported,
// content emitted bare), so they are deliberately NOT checked here.
//
// It stays FOUR predicates on purpose (RCR minority guard, Dara): the moment a
// ruleset wants conditionals or expressions, that is the Simplicity-Yield line —
// the answer is a per-target code writer, NOT a fifth predicate or a richer one.
//
//   1. every `wrap` value is a 2-element [open, close] pair
//   2. `blockJoin`, when present, is a string
//   3. any `template` string contains the placeholders it references — {label}
//      and {href} (the two the link renderer substitutes); a template missing
//      either silently drops content, so this is a real structural fault
//   4. any `linePrefix`, when present, is a string
//
// Returns the ruleset unchanged on success; throws Error naming every violation
// on failure. Pure and decidable — no I/O, no render, terminates on any input.
function validateRuleset(ruleset) {
  if (!ruleset || typeof ruleset !== 'object' || Array.isArray(ruleset)) {
    throw new Error('invalid ruleset: expected an object');
  }
  var errs = [];
  var inline = (ruleset.inline && typeof ruleset.inline === 'object') ? ruleset.inline : {};
  var blocks = (ruleset.blocks && typeof ruleset.blocks === 'object') ? ruleset.blocks : {};

  // (1) every `wrap` value is a 2-element pair
  Object.keys(inline).forEach(function (k) {
    var rule = inline[k];
    if (rule && rule.wrap !== undefined) {
      if (!Array.isArray(rule.wrap) || rule.wrap.length !== 2) {
        errs.push('inline.' + k + '.wrap must be a 2-element [open, close] pair');
      }
    }
  });

  // (2) blockJoin is a string (when present)
  if (ruleset.blockJoin !== undefined && typeof ruleset.blockJoin !== 'string') {
    errs.push('blockJoin must be a string');
  }

  // (3) any template string contains the placeholders it references ({label} and {href})
  Object.keys(inline).forEach(function (k) {
    var rule = inline[k];
    if (rule && rule.template !== undefined) {
      if (typeof rule.template !== 'string') {
        errs.push('inline.' + k + '.template must be a string');
      } else if (rule.template.indexOf('{label}') === -1 || rule.template.indexOf('{href}') === -1) {
        errs.push('inline.' + k + '.template must contain both {label} and {href} (it drops content otherwise)');
      }
    }
  });

  // (4) linePrefix is a string (when present)
  Object.keys(blocks).forEach(function (k) {
    var rule = blocks[k];
    if (rule && rule.linePrefix !== undefined && typeof rule.linePrefix !== 'string') {
      errs.push('blocks.' + k + '.linePrefix must be a string');
    }
  });

  if (errs.length) throw new Error('invalid ruleset: ' + errs.join('; '));
  return ruleset;
}

var api = {
  render: render,
  renderSource: renderSource,
  RULESETS: RULESETS,
  resolveRuleset: resolveRuleset,
  validateRuleset: validateRuleset
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;

// ---- selftest ---------------------------------------------------------------
function selftest() {
  var fails = [];
  function ck(name, cond) { if (!cond) fails.push(name); }
  var src = '# Title\n\n**b** *i* `c`\n\n> quote\n> line two\n\n- one\n- two\n\n1. a\n2. b\n\n```\nx = 1\n```\n\n[ok](https://e.com) [bad](javascript:x)';

  // determinism
  var r1 = renderSource(src, RULESETS.reddit).text;
  var r2 = renderSource(src, RULESETS.reddit).text;
  ck('deterministic', r1 === r2);
  ck('re-render stable', renderSource(r1, RULESETS.reddit).text === renderSource(renderSource(r1, RULESETS.reddit).text, RULESETS.reddit).text);

  // reddit dialect deltas
  ck('reddit heading->bold', r1.indexOf('**Title**') !== -1 && r1.indexOf('# Title') === -1);
  ck('reddit fence->indent', r1.indexOf('    x = 1') !== -1);
  ck('reddit blank-line blocks', /\n\n/.test(r1));
  ck('unsafe href dropped', r1.indexOf('javascript:') === -1 && r1.indexOf('bad') !== -1);
  ck('safe href kept', r1.indexOf('[ok](https://e.com)') !== -1);

  // reddit-post variant keeps hash + fence
  var rp = renderSource('# Title\n\n```\nx\n```', RULESETS['reddit-post']).text;
  ck('reddit-post keeps hash', rp.indexOf('# Title') !== -1);
  ck('reddit-post keeps fence', rp.indexOf('```') !== -1);

  // plain strips markup
  var pl = renderSource('# T\n\n**b** *i* [t](https://e.com)', RULESETS.plain).text;
  ck('plain strips heading marker', pl.indexOf('#') === -1);
  ck('plain strips strong', pl.indexOf('**') === -1 && pl.indexOf('b') !== -1);
  ck('plain link labelHref', pl.indexOf('t (https://e.com)') !== -1);

  // holes are reported, never crash — a custom ruleset with an empty inline table
  var holed = render(md.parse('**x** *y*'), { name: 't', blockJoin: '\n\n', blocks: {}, inline: {} });
  ck('hole render does not crash', typeof holed.text === 'string');

  // custom ruleset via object
  var custom = { name: 'shout', blockJoin: '\n\n', blocks: { paragraph: {} },
                 inline: { strong: { wrap: ['[', ']'] }, em: { wrap: ['', ''] },
                           codeSpan: { wrap: ['`', '`'] }, link: { form: 'label' } } };
  ck('custom wrap applied', renderSource('**hi**', custom).text.indexOf('[hi]') === 0);

  // ruleset-load validator — the four decidable structural predicates
  function throws(fn) { try { fn(); return false; } catch (e) { return true; } }
  // every built-in ruleset passes its own validator (a real gate must not reject the good)
  ck('validator passes built-ins', Object.keys(RULESETS).every(function (k) {
    return !throws(function () { validateRuleset(RULESETS[k]); });
  }));
  // (1) wrap must be a 2-element pair
  ck('validator rejects bad wrap', throws(function () {
    validateRuleset({ blockJoin: '\n\n', inline: { strong: { wrap: ['*'] } } });
  }));
  ck('validator accepts good wrap', !throws(function () {
    validateRuleset({ blockJoin: '\n\n', inline: { strong: { wrap: ['*', '*'] } } });
  }));
  // (2) blockJoin must be a string
  ck('validator rejects non-string blockJoin', throws(function () {
    validateRuleset({ blockJoin: 2, inline: {} });
  }));
  // (3) a template must contain {label} and {href}
  ck('validator rejects template missing href', throws(function () {
    validateRuleset({ inline: { link: { form: 'inline', template: '[{label}]' } } });
  }));
  ck('validator accepts full template', !throws(function () {
    validateRuleset({ inline: { link: { form: 'inline', template: '[{label}]({href})' } } });
  }));
  // (4) linePrefix must be a string
  ck('validator rejects non-string linePrefix', throws(function () {
    validateRuleset({ blocks: { blockquote: { linePrefix: 4 } } });
  }));
  // a non-object ruleset is rejected outright
  ck('validator rejects non-object', throws(function () { validateRuleset(null); }) &&
                                     throws(function () { validateRuleset([1, 2]); }));

  if (fails.length) { process.stderr.write('SELFTEST FAIL: ' + fails.join('; ') + '\n'); process.exit(1); }
  process.stdout.write('SELFTEST OK (' + 23 + ' checks)\n'); process.exit(0);
}

// ---- CLI --------------------------------------------------------------------
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  var fs = require('fs');
  var args = process.argv.slice(2);

  if (args.indexOf('--help') !== -1 || args.length === 0) {
    process.stdout.write(
      'dialect — render Markdown into a target dialect via a declarative ruleset\n\n' +
      '  dialect.js --ruleset reddit IN.md [-o OUT.md]   built-in ruleset by name\n' +
      '  dialect.js --ruleset ./my.json IN.md            ruleset from a JSON file\n' +
      '  dialect.js --ruleset reddit -                   read stdin, write stdout\n' +
      '  dialect.js --list                               list built-in rulesets\n' +
      '  dialect.js --selftest                           determinism + dialect self-test\n' +
      '  dialect.js --help\n\n' +
      'Built-in rulesets: ' + Object.keys(RULESETS).join(', ') + '\n\n' +
      'Scope (the edge): the declarative ruleset covers the ~95% of Markdown whose\n' +
      'emission is a flat per-node substitution. It STOPS at `table`: column\n' +
      'alignment is logic, not a flat substitution, so a table target needs a code\n' +
      'writer, not a ruleset. A table node renders its cell content bare and is\n' +
      'reported as a hole — never silently mangled.\n'
    );
    process.exit(0);
  }
  if (args.indexOf('--selftest') !== -1) selftest();
  if (args.indexOf('--list') !== -1) {
    Object.keys(RULESETS).forEach(function (k) {
      var d = RULESETS[k].desc ? '  —  ' + RULESETS[k].desc : '';
      process.stdout.write(k + d + '\n');
    });
    process.exit(0);
  }

  var rulesetArg = 'reddit', inFile = null, outFile = null, useStdin = false, i;
  for (i = 0; i < args.length; i++) {
    if (args[i] === '--ruleset') rulesetArg = args[++i];
    else if (args[i] === '-o' || args[i] === '--out') outFile = args[++i];
    else if (args[i] === '-') useStdin = true;
    else if (args[i].indexOf('--') === 0) { /* ignore */ }
    else inFile = args[i];
  }

  try {
    var ruleset;
    if (rulesetArg && (rulesetArg.indexOf('/') !== -1 || rulesetArg.indexOf('.json') !== -1)) {
      ruleset = JSON.parse(fs.readFileSync(rulesetArg, 'utf8'));
      validateRuleset(ruleset); // loud-stop on a structurally malformed external ruleset
    } else {
      ruleset = RULESETS[rulesetArg];
      if (!ruleset) throw new Error('unknown ruleset "' + rulesetArg + '" (try --list)');
    }

    function emit(source) {
      var res = render(md.parse(source), ruleset);
      if (res.holes.length) process.stderr.write('note: ruleset has no rule for node type(s): ' + res.holes.join(', ') + ' (rendered content bare)\n');
      if (outFile) { fs.writeFileSync(outFile, res.text); process.stderr.write('wrote ' + outFile + ' (' + res.text.length + ' bytes)\n'); }
      else if (useStdin) process.stdout.write(res.text);
      else {
        var def = (inFile ? inFile.replace(/\.md$/i, '') : 'dialect-output') + '.' + (ruleset.name || 'out') + '.md';
        fs.writeFileSync(def, res.text); process.stderr.write('wrote ' + def + ' (' + res.text.length + ' bytes)\n');
      }
    }

    if (useStdin) {
      var chunks = [];
      process.stdin.on('data', function (d) { chunks.push(d); });
      process.stdin.on('end', function () { emit(Buffer.concat(chunks).toString('utf8')); process.exit(0); });
    } else {
      if (!inFile) throw new Error('no input file (use - for stdin, or --help)');
      emit(fs.readFileSync(inFile, 'utf8'));
      process.exit(0);
    }
  } catch (e) {
    process.stderr.write('dialect: ' + (e && e.message ? e.message : String(e)) + '\n');
    process.exit(1);
  }
}
