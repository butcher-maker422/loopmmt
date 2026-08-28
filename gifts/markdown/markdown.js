#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */
// markdown.js — one Markdown source, two honest shadows.
//
// A tiny, dependency-free Markdown compiler with a single root and pure emitters:
//
//     source ──▶ parse() ──▶ AST ──▶ { toHTML, toPlainText }
//
// The point is not "another Markdown parser" — it is the SHARED-ROOT property:
// every rendering is a pure fold over the ONE parsed AST, so the plain-text view
// and the HTML view can never silently disagree about what the writer typed.
// (The original this is ported from also carries a browser toDOM emitter; that
// third shadow needs a DOM and is left out of this runtime-agnostic standalone.)
//
// Two load-bearing honesty rules, kept from the source:
//   * parse() NEVER throws. A construct it can't parse degrades to LITERAL text
//     rather than raising — a malformed document renders as itself, not an error.
//   * toPlainText(ast) === the raw source. The text view IS the Markdown the
//     writer typed — an honest fallback by construction, never a lossy re-strip
//     that could drift from the HTML render.
//
// The ONE user-controlled danger is a link href, so it gets the one real guard:
// isSafeUrl allows http/https/mailto/relative/#anchor and REJECTS everything else
// (javascript:, data:, vbscript:, protocol-relative //host, and any unknown
// scheme). A rejected href is DROPPED — the link renders as its plain-text label,
// never as a live attacker-controllable link. There is no runtime HTML scrubber:
// toHTML emits a fixed, frozen tag vocabulary (SAFE_TAGS) by construction, so no
// user input can ever become a tag. That is a stronger guarantee than sanitizing
// untrusted HTML after the fact, and it needs no dependency.
//
// Grammar — a bounded, deliberate subset (not CommonMark; big on purpose):
//   blocks:  heading (# .. ######) · blockquote (>) · ordered/unordered list
//            · fenced code block (``` ```) · paragraph
//   inline:  strong (** or __) · em (* or _) · code span (`) · link ([text](url))
//            · hard break (two trailing spaces)
//
// Deterministic: the same source always yields the same AST and the same output.
// Dependency-free: Node or a browser, no build step, no install.

(function (global) {
'use strict';

// ---- the link-scheme allowlist -----------------------------------------------------------------------
// Allow: http, https, mailto, relative paths, and bare fragments (#anchor). Reject everything else.
// A rejected href is DROPPED (the link renders as its text, never as a live href).
var SAFE_SCHEME = /^(https?:|mailto:)/i;
var HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i; // RFC-3986 scheme shape — if it matches and isn't allowlisted, reject.

function isSafeUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return false;
  var url = rawUrl.trim();
  if (url === '') return false;
  // A well-formed href never contains raw whitespace, angle brackets, or quotes — spaces are %20-encoded,
  // and <>"'` are injection tells. Rejecting them closes the "relative URL that smuggles javascript:
  // mid-string" class without touching any legitimate http/mailto/relative/anchor url.
  if (/[\s<>"'`]/.test(url)) return false;
  if (SAFE_SCHEME.test(url)) return true;  // explicit allowlisted scheme
  if (HAS_SCHEME.test(url)) return false;  // any OTHER explicit scheme -> reject (javascript:, data:, ...)
  // No scheme: relative path, bare anchor (#…), or protocol-relative (//host — treat as unsafe: it's a
  // scheme-carrying network fetch in disguise).
  if (url.startsWith('//')) return false;
  return true; // relative or #fragment — safe
}

// ---- HTML escaping (text nodes + attribute values) --------------------------------------------------
function escapeText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return escapeText(s).replace(/"/g, '&quot;');
}

// =====================================================================================================
// parse(source) -> AST     { type:'document', source, children:[block...] }
// =====================================================================================================
// Line-oriented block parse, then an inline pass per text run. Deterministic (same source -> same AST).
// NEVER throws — any construct it can't parse falls through to literal text.

function parse(source) {
  var src = source == null ? '' : String(source);
  var doc = { type: 'document', source: src, children: [] };
  // Normalize newlines for block-splitting; the AST keeps `source` verbatim for toPlainText.
  var lines = src.replace(/\r\n?/g, '\n').split('\n');
  var i = 0;

  var isBlank = function (ln) { return /^\s*$/.test(ln); };

  while (i < lines.length) {
    var line = lines[i];

    if (isBlank(line)) { i++; continue; }

    // --- fenced code block: ``` ... ``` (opening fence may carry an info string we ignore) ---
    var fence = /^(\s*)```/.exec(line);
    if (fence) {
      var startIdx = i;
      var buf = [];
      i++;
      var closed = false;
      while (i < lines.length) {
        if (/^\s*```\s*$/.test(lines[i])) { closed = true; i++; break; }
        buf.push(lines[i]);
        i++;
      }
      if (closed) {
        doc.children.push({ type: 'codeBlock', text: buf.join('\n') });
        continue;
      }
      // Unclosed fence -> render as source: the stray fence line becomes a LITERAL paragraph and we
      // advance exactly one line, so the buffered lines re-parse as normal blocks. Never rewind into a
      // state where the paragraph branch (which skips fence lines) can't consume this line — that would
      // be an infinite loop (i never advances).
      doc.children.push({ type: 'paragraph', children: parseInline(lines[startIdx].replace(/\s+$/, '')) });
      i = startIdx + 1;
      continue;
    }

    // --- heading: 1-6 leading # then a space ---
    var h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      doc.children.push({ type: 'heading', level: h[1].length, children: parseInline(h[2]) });
      i++;
      continue;
    }

    // --- blockquote: one or more '>' lines ---
    if (/^\s*>\s?/.test(line)) {
      var qbuf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        qbuf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      // Recurse: a blockquote's content is itself block-level markdown.
      var inner = parse(qbuf.join('\n'));
      doc.children.push({ type: 'blockquote', children: inner.children });
      continue;
    }

    // --- list: consecutive unordered (-,*,+) or ordered (1.) items ---
    var ulItem = /^(\s*)([-*+])\s+(.*)$/;
    var olItem = /^(\s*)(\d+)[.)]\s+(.*)$/;
    if (ulItem.test(line) || olItem.test(line)) {
      var ordered = olItem.test(line);
      var items = [];
      while (i < lines.length) {
        var m = ordered ? olItem.exec(lines[i]) : ulItem.exec(lines[i]);
        if (!m) {
          // allow the OTHER marker type to end the list cleanly (ambiguous nesting -> flat, never throw)
          if (isBlank(lines[i])) { i++; break; }
          if ((ordered ? ulItem : olItem).test(lines[i])) break;
          if (!/^\s+/.test(lines[i])) break; // a non-indented non-item line ends the list
          // an indented continuation line: append to the last item's text
          if (items.length) items[items.length - 1].children.push.apply(
            items[items.length - 1].children, parseInline(' ' + lines[i].trim()));
          i++;
          continue;
        }
        items.push({ type: 'listItem', children: parseInline(m[3]) });
        i++;
      }
      doc.children.push({ type: 'list', ordered: ordered, items: items });
      continue;
    }

    // --- paragraph: gather until a blank line or a block-starting line ---
    var pbuf = [];
    while (i < lines.length && !isBlank(lines[i])
      && !/^\s*```/.test(lines[i])
      && !/^#{1,6}\s+/.test(lines[i])
      && !/^\s*>\s?/.test(lines[i])
      && !ulItem.test(lines[i]) && !olItem.test(lines[i])) {
      pbuf.push(lines[i]);
      i++;
    }
    if (pbuf.length === 0) { i++; continue; } // progress guard: never stall on a line no branch consumed
    // A hard break inside a paragraph = a line ending in two+ spaces. Preserve it as a {break} node by
    // joining with a sentinel the inline pass understands.
    var joined = pbuf.map(function (ln, idx) {
      return idx < pbuf.length - 1 && /  +$/.test(ln)
        ? ln.replace(/\s+$/, '') + '\u0000BR\u0000'
        : ln.replace(/\s+$/, '');
    }).join(' ');
    doc.children.push({ type: 'paragraph', children: parseInline(joined) });
  }

  return doc;
}

// ---- inline pass: strong / em / code span / link / hard break / text -------------------------------
// Tokenizes a single text run. Unmatched delimiters fall through to literal text.
function parseInline(text) {
  var nodes = [];
  var s = String(text);
  var i = 0;
  var buf = '';
  var flush = function () { if (buf) { nodes.push({ type: 'text', value: buf }); buf = ''; } };

  while (i < s.length) {
    // hard break sentinel
    if (s.startsWith('\u0000BR\u0000', i)) { flush(); nodes.push({ type: 'break' }); i += 6; continue; }

    var c = s[i];

    // code span: `...` (no nesting; a lone backtick is literal)
    if (c === '`') {
      var endc = s.indexOf('`', i + 1);
      if (endc > i) { flush(); nodes.push({ type: 'codeSpan', value: s.slice(i + 1, endc) }); i = endc + 1; continue; }
      buf += c; i++; continue;
    }

    // strong: ** or __  (greedy to the matching closer; falls through to text if unmatched)
    if ((s.startsWith('**', i) || s.startsWith('__', i))) {
      var delim = s.substr(i, 2);
      var ends = s.indexOf(delim, i + 2);
      if (ends > i + 1) { flush(); nodes.push({ type: 'strong', children: parseInline(s.slice(i + 2, ends)) }); i = ends + 2; continue; }
      buf += c; i++; continue;
    }

    // em: * or _  (single delimiter; unmatched -> literal)
    if (c === '*' || c === '_') {
      var ende = s.indexOf(c, i + 1);
      if (ende > i) { flush(); nodes.push({ type: 'em', children: parseInline(s.slice(i + 1, ende)) }); i = ende + 1; continue; }
      buf += c; i++; continue;
    }

    // link: [text](url)  — malformed (no closing ) etc.) falls through to literal.
    // The closing paren is found by DEPTH-TRACKING so parens inside the URL balance (e.g. a
    // `javascript:alert(1)` payload closes at its own `)`, not the inner one).
    if (c === '[') {
      var close = s.indexOf(']', i + 1);
      if (close > i && s[close + 1] === '(') {
        var depth = 1, j = close + 2;
        while (j < s.length && depth > 0) {
          if (s[j] === '(') depth++;
          else if (s[j] === ')') { depth--; if (depth === 0) break; }
          j++;
        }
        if (depth === 0) {
          var label = s.slice(i + 1, close);
          var href = s.slice(close + 2, j);
          flush();
          nodes.push({ type: 'link', href: href, children: parseInline(label) });
          i = j + 1;
          continue;
        }
      }
      buf += c; i++; continue;
    }

    buf += c; i++;
  }
  flush();
  return nodes;
}

// =====================================================================================================
// The frozen tag allowlist — the emitter's ENTIRE legal vocabulary, in one place.
// -----------------------------------------------------------------------------------------------------
// The emitter emits tags ONLY as hard-coded literals in the switches below, so no user input can ever
// become a tag; the structural floor fails closed (both switches: `default -> ''`, an unknown node emits
// nothing, never a raw tag). SAFE_TAGS turns "safe because I read the switches" into "safe, proven on
// every corpus + fuzz case" — the emit-invariant test scans toHTML output and asserts every opened tag
// is in this set, so any future case that leaks a new tag fails LOUD at test time. We deliberately do NOT
// scrub at runtime: a hand-rolled live tag-stripper is the exact fragile security-primitive this design
// avoids. Frozen so it cannot be mutated at runtime.
var SAFE_TAGS = Object.freeze([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'blockquote', 'pre', 'code',
  'ul', 'ol', 'li',
  'strong', 'em', 'br', 'a'
]);

// Pure scanner: the set of element tag-names opened in an HTML string (lowercased, no closers/attrs).
// Used by the emit-invariant test. Never throws.
function tagsIn(htmlStr) {
  var out = {};
  var re = /<([a-zA-Z][a-zA-Z0-9]*)/g;
  var m;
  while ((m = re.exec(String(htmlStr || ''))) !== null) out[m[1].toLowerCase()] = true;
  return Object.keys(out);
}

// =====================================================================================================
// toHTML(ast) -> string      pure tree-walk; vocabulary is a fixed, known-safe subset by construction.
// =====================================================================================================
function toHTML(ast) {
  if (!ast || ast.type !== 'document') return '';
  return ast.children.map(renderBlockHTML).join('\n');
}

function renderBlockHTML(node) {
  switch (node.type) {
    case 'heading': return '<h' + node.level + '>' + renderInlineHTML(node.children) + '</h' + node.level + '>';
    case 'paragraph': return '<p>' + renderInlineHTML(node.children) + '</p>';
    case 'blockquote': return '<blockquote>' + node.children.map(renderBlockHTML).join('\n') + '</blockquote>';
    case 'codeBlock': return '<pre><code>' + escapeText(node.text) + '</code></pre>';
    case 'list': {
      var tag = node.ordered ? 'ol' : 'ul';
      var items = node.items.map(function (it) { return '<li>' + renderInlineHTML(it.children) + '</li>'; }).join('');
      return '<' + tag + '>' + items + '</' + tag + '>';
    }
    default: return '';
  }
}

function renderInlineHTML(nodes) {
  return (nodes || []).map(function (n) {
    switch (n.type) {
      case 'text': return escapeText(n.value);
      case 'strong': return '<strong>' + renderInlineHTML(n.children) + '</strong>';
      case 'em': return '<em>' + renderInlineHTML(n.children) + '</em>';
      case 'codeSpan': return '<code>' + escapeText(n.value) + '</code>';
      case 'break': return '<br>';
      case 'link': {
        var innerHtml = renderInlineHTML(n.children);
        // The link-scheme guard: a safe href becomes a real <a>; an unsafe one DROPS the href and
        // renders the label as plain text (never a live javascript:/data: link).
        return isSafeUrl(n.href) ? '<a href="' + escapeAttr(n.href.trim()) + '">' + innerHtml + '</a>' : innerHtml;
      }
      default: return '';
    }
  }).join('');
}

// =====================================================================================================
// toPlainText(ast) -> string     === the raw Markdown source (the honest fallback).
// =====================================================================================================
function toPlainText(ast) {
  if (!ast || ast.type !== 'document') return '';
  return ast.source;
}

// ---- the convenience call: source -> { text, html } (the UNSKIPPABLE guard boundary) ---------------
// One call a send/render route can use so the guard can never be forgotten (hope is not a control).
// text = the source (honest); html = the guarded HTML emission.
function render(source) {
  var ast = parse(source);
  return { text: toPlainText(ast), html: toHTML(ast) };
}

var api = {
  parse: parse,
  toHTML: toHTML,
  toPlainText: toPlainText,
  render: render,
  isSafeUrl: isSafeUrl,
  tagsIn: tagsIn,
  SAFE_TAGS: SAFE_TAGS
};

// ---- dual export: CommonJS (Node), and a global for the browser -------------------------------------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  global.markdown = api;
}

// ---- CLI (runs only when invoked directly, never on require) ----------------------------------------
function main(argv) {
  var args = argv.slice(2);
  var wantText = false;
  var rest = [];
  for (var k = 0; k < args.length; k++) {
    if (args[k] === '--text') wantText = true;
    else if (args[k] === '--help' || args[k] === '-h') rest = ['--help'];
    else rest.push(args[k]);
  }
  if (rest.length === 1 && rest[0] === '--help') {
    process.stdout.write(
      'markdown.js — one Markdown source, two honest shadows (HTML + plain text).\n\n' +
      '  echo "# hi" | node markdown.js            read Markdown on stdin, print HTML\n' +
      '  echo "# hi" | node markdown.js --text     print the plain-text shadow (=== the source)\n' +
      '  node markdown.js "**bold** [x](javascript:alert(1))"   read Markdown from an argument\n' +
      '  node markdown.js --help\n\n' +
      'HTML emits a fixed, known-safe tag vocabulary; an unsafe link href is dropped, not rendered.\n' +
      'Parsing never throws — anything it can\'t parse renders as literal text.\n'
    );
    return 0;
  }

  function emit(source) {
    var out = render(source);
    process.stdout.write((wantText ? out.text : out.html) + '\n');
  }

  if (rest.length > 0) { emit(rest.join(' ')); return 0; }

  // No positional argument: read Markdown from stdin.
  var chunks = [];
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (d) { chunks.push(d); });
  process.stdin.on('end', function () { emit(chunks.join('')); });
  return 0;
}

if (typeof require !== 'undefined' && require.main === module) {
  process.exitCode = main(process.argv);
}

})(typeof globalThis !== 'undefined' ? globalThis : this);
