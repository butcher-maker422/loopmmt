/* Shea's Forest — the App Shell · shell/block.js
   The Block Alphabet's shared foundation (slice ①, the walking skeleton).

   ONE el(). Before this file, `el(doc, tag, cls, attrs)` — the tiny DOM builder
   every renderer uses — was copied into FIVE shell files (shell-renderers, mail-
   renderer, pane, tab-strip) plus a sixth VARIANT (index-panel, with a 5th
   positional `text` param). That is the "mail is a special case" smell at the
   helper level: the same atom, written six times, is six chances to drift. This
   module holds the ONE canonical definition; every renderer binds to it, so the
   Block Alphabet's atoms are built by a single hand.

   The el() body is byte-identical to the former canonical (shell-renderers.js) —
   this is a DEDUP, not a rewrite. `text` in attrs sets textContent; every other
   key setAttribute's. The index-panel variant's 5th-positional `text` call sites
   migrate to attrs.text (behaviour-identical, since no call passed a literal
   `text` attribute key).

   Load FIRST among the shell scripts — the consumers bind `root.block.el` at
   their IIFE-execution time (index.html loads block.js ahead of the renderers;
   each *.test.js requires it before the consumers).

   Plain script (no ES module) — attaches to window.ForestShell.block.
   No dependencies. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  /* The one el(). `text` -> textContent; every other attr -> setAttribute.
     Byte-identical to the former shell-renderers.js:44 canonical body. */
  function el(doc, tag, cls, attrs) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) {
      if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]);
    }
    return n;
  }

  /* ---- export --------------------------------------------------------------- */
  root.block = {
    el: el,
    _version: "1.0"
  };
})();
