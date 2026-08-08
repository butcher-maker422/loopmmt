/* SPDX-License-Identifier: AGPL-3.0-or-later */
// forest — markdown.js — one Markdown AST, pure emitters (the "one source, three shadows" compiler).
//
// Parked-line design record: internal
//   THE ANSWER — source -> parse() -> AST -> { toDOM, toHTML, toPlainText }. Three sinks, one root.
//   Preview≡send is a UNIVERSAL PROPERTY of the shared AST (Chen Wei/Tamar), provable by an
//   AST-corpus fold-twice test — not a discipline anyone has to remember.
//
// SLICE 1 (send-first) ships parse() + toHTML + toPlainText ONLY. No toDOM, no preview, no toolbar,
// no browser surface (Crux's sequence: send -> preview -> toolbar). This module is DEPENDENCY-FREE and
// runtime-agnostic ON PURPOSE, so slice 2 can load the same parse() in the browser for toDOM.
//
// Grammar: a BOUNDED Markdown subset (Belting: resident, no adopted parser lib — the reversible trigger
// to re-open Belting is "scope exceeds this subset", e.g. tables / nested blockquotes / footnotes).
//   blocks:  heading (# .. ######) · blockquote (>) · ordered/unordered list · code fence (``` ```) · paragraph
//   inline:  strong (** or __) · em (* or _) · code span (`) · link ([text](url)) · hard break (two spaces + NL)
//
// Two load-bearing rules from the RCR's Red Team:
//   (Niamh) parse errors RENDER AS SOURCE — parse() never throws; a malformed construct degrades to literal text.
//   (Wren)  toPlainText(ast) === the raw source — the text/plain MIME leg IS the Markdown the writer typed
//           (honest by construction; no lossy strip-logic that could diverge from the render).
//
// The link-scheme guard (Nyx, RCR Beam 2): hrefs are the ONE user-controlled danger. isSafeUrl below is
// semantically identical to loopcms.isSafeUrl — allow http/https/mailto/relative/anchor, reject
// javascript:/data:/vbscript:/unknown. Structure-clamp is UNNECESSARY here: toHTML emits a fixed,
// known-safe tag vocabulary by construction (Wes/Chen Wei — "no untrusted-HTML ingestion"). Keeping the
// guard inline (vs requiring loopcms.sanitizeHtml) keeps this module dependency-free AND browser-safe, so
// the SAME guard serves slice-2's toDOM preview. See the open Crossroads for the A/B on this.

(function (global) {
'use strict';

// ---- the link-scheme allowlist (= loopcms.isSafeUrl semantics) --------------------------------------
// Allow: http, https, mailto, relative paths, and bare fragments (#anchor). Reject everything else —
// javascript:, data:, vbscript:, file:, and any unknown scheme. A rejected href is DROPPED (the link
// renders as its text, never as a live href), never neutralized into an attacker-controllable string.
const SAFE_SCHEME = /^(https?:|mailto:)/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i; // RFC-3986 scheme shape — if it matches and isn't allowlisted, reject.

function isSafeUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return false;
  const url = rawUrl.trim();
  if (url === '') return false;
  // A well-formed href never contains raw whitespace, angle brackets, or quotes — spaces are %20-encoded,
  // and <>"'` are injection tells. Rejecting them closes the "relative URL that smuggles `javascript:`
  // mid-string" class the fuzz surfaced, without touching any legitimate http/mailto/relative/anchor url.
  if (/[\s<>"'`]/.test(url)) return false;
  if (SAFE_SCHEME.test(url)) return true; // explicit allowlisted scheme
  if (HAS_SCHEME.test(url)) return false; // any OTHER explicit scheme -> reject (javascript:, data:, vbscript:, ...)
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
// NEVER throws — any construct it can't parse falls through to literal text (Niamh's rule).

function parse(source) {
  const src = source == null ? '' : String(source);
  const doc = { type: 'document', source: src, children: [] };
  // Normalize newlines for block-splitting; the AST keeps `source` verbatim for toPlainText.
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;

  const isBlank = (ln) => /^\s*$/.test(ln);

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) { i++; continue; }

    // --- fenced code block: ``` ... ``` (opening fence may carry an info string we ignore) ---
    const fence = /^(\s*)```/.exec(line);
    if (fence) {
      const startIdx = i;
      const buf = [];
      i++;
      let closed = false;
      while (i < lines.length) {
        if (/^\s*```\s*$/.test(lines[i])) { closed = true; i++; break; }
        buf.push(lines[i]);
        i++;
      }
      if (closed) {
        doc.children.push({ type: 'codeBlock', text: buf.join('\n') });
        continue;
      }
      // Unclosed fence -> render as source (Niamh): the stray fence line becomes a LITERAL paragraph and
      // we advance exactly one line, so the buffered lines re-parse as normal blocks. Never rewind into a
      // state where the paragraph branch (which skips fence lines) can't consume this line — that was an
      // infinite loop (i never advances), caught by the MD-hard fuzz.
      doc.children.push({ type: 'paragraph', children: parseInline(lines[startIdx].replace(/\s+$/, '')) });
      i = startIdx + 1;
      continue;
    }

    // --- heading: 1-6 leading # then a space ---
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      doc.children.push({ type: 'heading', level: h[1].length, children: parseInline(h[2]) });
      i++;
      continue;
    }

    // --- blockquote: one or more '>' lines ---
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      // Recurse: a blockquote's content is itself block-level markdown.
      const inner = parse(buf.join('\n'));
      doc.children.push({ type: 'blockquote', children: inner.children });
      continue;
    }

    // --- list: consecutive unordered (-,*,+) or ordered (1.) items ---
    const ulItem = /^(\s*)([-*+])\s+(.*)$/;
    const olItem = /^(\s*)(\d+)[.)]\s+(.*)$/;
    if (ulItem.test(line) || olItem.test(line)) {
      const ordered = olItem.test(line);
      const items = [];
      while (i < lines.length) {
        const m = ordered ? olItem.exec(lines[i]) : ulItem.exec(lines[i]);
        if (!m) {
          // allow the OTHER marker type to end the list cleanly (ambiguous nesting -> flat, never throw)
          if (isBlank(lines[i])) { i++; break; }
          if ((ordered ? ulItem : olItem).test(lines[i])) break;
          if (!/^\s+/.test(lines[i])) break; // a non-indented non-item line ends the list
          // an indented continuation line: append to the last item's text
          if (items.length) items[items.length - 1].children.push(...parseInline(' ' + lines[i].trim()));
          i++;
          continue;
        }
        items.push({ type: 'listItem', children: parseInline(m[3]) });
        i++;
      }
      doc.children.push({ type: 'list', ordered, items });
      continue;
    }

    // --- paragraph: gather until a blank line or a block-starting line ---
    const buf = [];
    while (i < lines.length && !isBlank(lines[i])
      && !/^\s*```/.test(lines[i])
      && !/^#{1,6}\s+/.test(lines[i])
      && !/^\s*>\s?/.test(lines[i])
      && !ulItem.test(lines[i]) && !olItem.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    if (buf.length === 0) { i++; continue; } // progress guard: never stall on a line no branch consumed
    // A hard break inside a paragraph = a line ending in two+ spaces. Preserve it as a {break} node by
    // joining with a sentinel the inline pass understands.
    const joined = buf.map((ln, idx) => idx < buf.length - 1 && /  +$/.test(ln) ? ln.replace(/\s+$/, '') + '\u0000BR\u0000' : ln.replace(/\s+$/, '')).join(' ');
    doc.children.push({ type: 'paragraph', children: parseInline(joined) });
  }

  return doc;
}

// ---- inline pass: strong / em / code span / link / hard break / text -------------------------------
// Tokenizes a single text run. Unmatched delimiters fall through to literal text (Niamh).
function parseInline(text) {
  const nodes = [];
  const s = String(text);
  let i = 0;
  let buf = '';
  const flush = () => { if (buf) { nodes.push({ type: 'text', value: buf }); buf = ''; } };

  while (i < s.length) {
    // hard break sentinel
    if (s.startsWith('\u0000BR\u0000', i)) { flush(); nodes.push({ type: 'break' }); i += 6; continue; }

    const c = s[i];

    // code span: `...` (no nesting; a lone backtick is literal)
    if (c === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i) { flush(); nodes.push({ type: 'codeSpan', value: s.slice(i + 1, end) }); i = end + 1; continue; }
      buf += c; i++; continue;
    }

    // strong: ** or __  (greedy to the matching closer; falls through to text if unmatched)
    if ((s.startsWith('**', i) || s.startsWith('__', i))) {
      const delim = s.substr(i, 2);
      const end = s.indexOf(delim, i + 2);
      if (end > i + 1) { flush(); nodes.push({ type: 'strong', children: parseInline(s.slice(i + 2, end)) }); i = end + 2; continue; }
      buf += c; i++; continue;
    }

    // em: * or _  (single delimiter; unmatched -> literal)
    if (c === '*' || c === '_') {
      const end = s.indexOf(c, i + 1);
      if (end > i) { flush(); nodes.push({ type: 'em', children: parseInline(s.slice(i + 1, end)) }); i = end + 1; continue; }
      buf += c; i++; continue;
    }

    // link: [text](url)  — malformed (no closing ) etc.) falls through to literal (Niamh).
    // The closing paren is found by DEPTH-TRACKING so parens inside the URL balance (e.g. a
    // `javascript:alert(1)` payload closes at its own `)`, not the inner one — the MD-link case).
    if (c === '[') {
      const close = s.indexOf(']', i + 1);
      if (close > i && s[close + 1] === '(') {
        let depth = 1, j = close + 2;
        while (j < s.length && depth > 0) {
          if (s[j] === '(') depth++;
          else if (s[j] === ')') { depth--; if (depth === 0) break; }
          j++;
        }
        if (depth === 0) {
          const label = s.slice(i + 1, close);
          const href = s.slice(close + 2, j);
          flush();
          nodes.push({ type: 'link', href, children: parseInline(label) });
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
// This is the mechanical half of the link-scheme guard's sibling control (AX decision, option C):
// the emitter emits tags ONLY as hard-coded literals in the switches below, so no user input can ever
// become a tag — but a *future edit* could add a case that emits an off-allowlist tag. The structural
// floor already fails closed (both switches: `default -> ''`, an unknown node emits nothing, never a raw
// tag). SAFE_TAGS turns "safe because I read the switches" into "safe, proven on every corpus + fuzz
// case" — the emit-invariant test (test-markdown.js) scans toHTML output and asserts every opened tag is
// in this set, so any future case that leaks a new tag fails LOUD at test time. We deliberately do NOT
// scrub at runtime: a hand-rolled live tag-stripper is the exact fragile security-primitive the design
// avoids (dependency-free, no re-implemented sanitizer). Exported as the single source of truth so
// slice-2's toDOM shares one vocabulary. Frozen so it cannot be mutated at runtime.
const SAFE_TAGS = Object.freeze([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'blockquote', 'pre', 'code',
  'ul', 'ol', 'li',
  'strong', 'em', 'br', 'a',
]);

// Pure scanner: the set of element tag-names opened in an HTML string (lowercased, no closers/attrs).
// Used by the emit-invariant test; also available to slice-2. Never throws.
function tagsIn(html) {
  const out = new Set();
  const re = /<([a-zA-Z][a-zA-Z0-9]*)/g;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) out.add(m[1].toLowerCase());
  return out;
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
    case 'heading': return `<h${node.level}>${renderInlineHTML(node.children)}</h${node.level}>`;
    case 'paragraph': return `<p>${renderInlineHTML(node.children)}</p>`;
    case 'blockquote': return `<blockquote>${node.children.map(renderBlockHTML).join('\n')}</blockquote>`;
    case 'codeBlock': return `<pre><code>${escapeText(node.text)}</code></pre>`;
    case 'list': {
      const tag = node.ordered ? 'ol' : 'ul';
      const items = node.items.map((it) => `<li>${renderInlineHTML(it.children)}</li>`).join('');
      return `<${tag}>${items}</${tag}>`;
    }
    default: return '';
  }
}

function renderInlineHTML(nodes) {
  return (nodes || []).map((n) => {
    switch (n.type) {
      case 'text': return escapeText(n.value);
      case 'strong': return `<strong>${renderInlineHTML(n.children)}</strong>`;
      case 'em': return `<em>${renderInlineHTML(n.children)}</em>`;
      case 'codeSpan': return `<code>${escapeText(n.value)}</code>`;
      case 'break': return '<br>';
      case 'link': {
        const inner = renderInlineHTML(n.children);
        // The link-scheme guard: a safe href becomes a real <a>; an unsafe one DROPS the href and
        // renders the label as plain text (never a live javascript:/data: link).
        return isSafeUrl(n.href) ? `<a href="${escapeAttr(n.href.trim())}">${inner}</a>` : inner;
      }
      default: return '';
    }
  }).join('');
}

// =====================================================================================================
// toPlainText(ast) -> string     === the raw Markdown source (Wren's honest fallback).
// =====================================================================================================
function toPlainText(ast) {
  if (!ast || ast.type !== 'document') return '';
  return ast.source;
}

// ---- the send-side convenience: source -> { text, html } (the UNSKIPPABLE guard boundary) ----------
// One call the send route uses so the sanitize/guard can never be forgotten (Nyx: hope is not a control).
// text = the source (Wren); html = the guarded HTML emission.
function renderEmail(source) {
  const ast = parse(source);
  return { text: toPlainText(ast), html: toHTML(ast) };
}


// =====================================================================================================
// toDOM(ast) -> DocumentFragment   the browser sink (slice 2). Same AST, same SAFE_TAGS vocabulary, same
// isSafeUrl guard as toHTML -> preview === send by construction (the shared-AST universal property).
// createElement can ONLY emit the hard-coded literal tags below, so no user input can become a tag
// (structural floor identical to toHTML's); textContent/createTextNode is the DOM's escapeText.
// Browser-only (references `document`); never called on the send/Node side.
// =====================================================================================================
function toDOM(ast) {
  var frag = document.createDocumentFragment();
  if (!ast || ast.type !== 'document') return frag;
  ast.children.forEach(function (node) {
    var el = renderBlockDOM(node);
    if (el) frag.appendChild(el);
  });
  return frag;
}

function renderBlockDOM(node) {
  switch (node.type) {
    case 'heading': {
      var h = document.createElement('h' + node.level);
      appendInlineDOM(h, node.children);
      return h;
    }
    case 'paragraph': {
      var p = document.createElement('p');
      appendInlineDOM(p, node.children);
      return p;
    }
    case 'blockquote': {
      var bq = document.createElement('blockquote');
      node.children.forEach(function (c) { var b = renderBlockDOM(c); if (b) bq.appendChild(b); });
      return bq;
    }
    case 'codeBlock': {
      var pre = document.createElement('pre');
      var code = document.createElement('code');
      code.textContent = node.text;
      pre.appendChild(code);
      return pre;
    }
    case 'list': {
      var listEl = document.createElement(node.ordered ? 'ol' : 'ul');
      node.items.forEach(function (it) {
        var li = document.createElement('li');
        appendInlineDOM(li, it.children);
        listEl.appendChild(li);
      });
      return listEl;
    }
    default: return null;
  }
}

function appendInlineDOM(parent, nodes) {
  (nodes || []).forEach(function (n) {
    switch (n.type) {
      case 'text': parent.appendChild(document.createTextNode(n.value)); break;
      case 'strong': { var st = document.createElement('strong'); appendInlineDOM(st, n.children); parent.appendChild(st); break; }
      case 'em': { var em = document.createElement('em'); appendInlineDOM(em, n.children); parent.appendChild(em); break; }
      case 'codeSpan': { var cs = document.createElement('code'); cs.textContent = n.value; parent.appendChild(cs); break; }
      case 'break': parent.appendChild(document.createElement('br')); break;
      case 'link': {
        // Same guard as toHTML: safe href -> real <a>; unsafe -> DROP href, render label as plain text.
        if (isSafeUrl(n.href)) {
          var a = document.createElement('a');
          a.setAttribute('href', n.href.trim());
          appendInlineDOM(a, n.children);
          parent.appendChild(a);
        } else {
          appendInlineDOM(parent, n.children);
        }
        break;
      }
      default: break;
    }
  });
}

// ---- UMD export: Node (send-side gmail.js + node --test) OR browser (window.ForestShell.markdown).
// The browser copy at forest/app/public/shell/markdown.js is byte-identical (markdown.test.js gate).
var __forestMarkdownApi = { parse, toHTML, toPlainText, toDOM, renderEmail, isSafeUrl, SAFE_TAGS, tagsIn };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __forestMarkdownApi;
} else {
  var __root = (global.ForestShell = global.ForestShell || {});
  __root.markdown = __forestMarkdownApi;
}
})(typeof self !== 'undefined' ? self : this);
