/* Shea's Forest — the Forest Settings Pattern SHARED FRAME · forest/app/public/shell/settings-frame.js
   window.ForestShell.settingsFrame

   WHAT THIS IS (§6-a — the MODULE route's build half).
   The Forest Settings Pattern (design/forest-settings-pattern-plan-v1.md) named a
   MODULE-level gap: mail HAS a settings surface, butcher/calendar/contacts lack one,
   so the common bones extract to a SHARED frame every app's render<App>Settings
   composes — not per-app copies. This is that frame. It carries the bones the two
   real instances already shared, generalized:

     • panel(doc, opts)        — the titled settings panel frame (root + title + lede).
     • titledSection(doc, opts)— a sub-section container with its own heading.
     • labeledRow(doc, opts)   — a labeled field row: <label|div> <span.field__label> [control].
     • backAction(doc, opts)   — the standard "back" affordance, wired to onBack.
     • hostPersist(fn, patch)  — the host-owned persist seam, flag-don't-fake.

   The two instances it was extracted FROM (N=2, both shipped and byte-verified):
     • butcher renderSettings   (butcher-surfaces.js) — panel/title/lede + labeled rows
                                  + the onConfigChange host seam.
     • mail buildSettingsPanel  (mail-renderer.js)    — record panel/title + labeled
                                  field rows + a back affordance + the onDensity/onExport
                                  host seams.
   Per §6-a, the frame supplies the COMMON bones; each consuming app supplies only its
   own FIELD SET (butcher's stage rows + honest §6-#3 badge; mail's tabs/density/export).
   Mail's retrofit onto this frame is its OWN later leg (§6-b) — mail is shipped and
   load-bearing and is NOT touched here. Butcher is the first app to COMPOSE onto it.

   DUAL-CLASS, ZERO MARGINAL CSS. Every builder takes the caller's skin
   classes as parameters (rootClass/titleClass/rowClass/…) and defaults to shared
   semantic classes that already exist in the shipped stylesheet. A consuming app
   passes its own hook classes so its rendered DOM is byte-identical to its
   pre-extract surface — the frame changes WHO builds the bones, never WHAT class
   the bones wear.

   NO I/O, NO STATE. Pure builders over a doc, exactly like block.js. Every act a
   control performs is handed back to the host through a callback (hostPersist); the
   frame never reaches a store, a network, or the crypto, and never fakes a
   persistence it did not get (flag-don't-fake).

   Plain script (no ES module, no deps beyond the shared el). Cold-safe throughout.
   Attaches to window.ForestShell.settingsFrame. Depends on window.ForestShell.block
   for the shared el() (load block.js first); degrades to a private el() if absent, so
   a mis-ordered load never throws. Load AFTER block.js and BEFORE any render<App>Settings
   that composes it (butcher-surfaces.js today; mail-renderer.js on the §6-b retrofit).
   Mirrors the genesis-dock.js MODULE-route precedent (the Chalk Line's shared block). */
(function () {
  "use strict";
  var root = (window.ForestShell = window.ForestShell || {});

  /* The shared element atom — reuse block.el (one atom, one place, no drift). The
     cold-safe fallback mirrors block.el / butcher's el byte-for-byte so a mis-ordered
     or absent block.js degrades instead of throwing. */
  function el(doc, tag, cls, attrs) {
    var b = root.block;
    if (b && typeof b.el === "function") return b.el(doc, tag, cls, attrs);
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) {
      if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]);
    }
    return n;
  }

  /* Make a non-button node behave like a button (click + Enter/Space). Generalized
     from mail's activate — the shared "back" and any role=button control uses it. */
  function activate(node, fn) {
    if (!node || typeof fn !== "function") return node;
    if (node.addEventListener) {
      node.addEventListener("click", function (e) { if (e && e.preventDefault) e.preventDefault(); fn(); });
      node.addEventListener("keydown", function (e) {
        var k = e && (e.key != null ? e.key : e.keyCode);
        if (k === "Enter" || k === " " || k === 13 || k === 32) {
          if (e && e.preventDefault) e.preventDefault();
          fn();
        }
      });
    }
    return node;
  }

  /* panel(doc, opts) -> the titled settings panel frame.
       opts: { rootTag, rootClass, kind, titleTag, titleClass, title, ledeClass, lede }
     Returns the panel node; the caller appends its own field set to it. A null/absent
     title or lede is simply not rendered (never an empty node). Defaults are shared
     semantic classes (settings-frame*); a consuming app passes its own skin classes.
     rootTag defaults to "section" (butcher's byte-identical form); an app whose
     pre-extract root is a different element (mail's <div>) passes its own rootTag,
     so the frame changes WHO builds the root, never WHAT element it is. */
  function panel(doc, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    opts = opts || {};
    var attrs = {};
    if (opts.kind != null) attrs["data-kind"] = opts.kind;
    var node = el(doc, opts.rootTag || "section", opts.rootClass || "settings-frame record", attrs);
    if (opts.title != null) {
      node.appendChild(el(doc, opts.titleTag || "h2", opts.titleClass || "settings-frame__title",
        { text: opts.title }));
    }
    if (opts.lede != null) {
      node.appendChild(el(doc, "p", opts.ledeClass || "settings-frame__lede", { text: opts.lede }));
    }
    return node;
  }

  /* titledSection(doc, opts) -> a sub-section container with its own heading.
       opts: { sectionClass, sectionAttrs, headingTag, headingClass, heading } */
  function titledSection(doc, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    opts = opts || {};
    var sec = el(doc, "div", opts.sectionClass || "settings-frame__section", opts.sectionAttrs || {});
    if (opts.heading != null) {
      sec.appendChild(el(doc, opts.headingTag || "h3", opts.headingClass || "settings-frame__subtitle",
        { text: opts.heading }));
    }
    return sec;
  }

  /* labeledRow(doc, opts) -> a labeled field row.
       opts: { rowTag, rowClass, rowAttrs, labelTag, labelClass, labelAttrs, label, control }
     Emits <rowTag class=rowClass> <labelTag class=labelClass ...labelAttrs>label</labelTag> [control].
     The control is any node the caller already built (input/select/…) — the frame
     never builds the control, so per-app control logic (a placeholder gate, a value,
     a change listener) stays with the app. Returns the row node.
     labelTag defaults to "span" (butcher's byte-identical form); an app whose label is
     a real <label> element (mail) passes labelTag:"label", and labelAttrs carries any
     attrs that element needs (e.g. a `for` binding to the control's id). Defaults leave
     the pre-extension behavior exactly as it was — the label stays a bare <span>. */
  function labeledRow(doc, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    opts = opts || {};
    var row = el(doc, opts.rowTag || "label", opts.rowClass || "field", opts.rowAttrs || {});
    if (opts.label != null) {
      var labAttrs = { text: opts.label };
      if (opts.labelAttrs) for (var k in opts.labelAttrs) {
        if (Object.prototype.hasOwnProperty.call(opts.labelAttrs, k)) labAttrs[k] = opts.labelAttrs[k];
      }
      row.appendChild(el(doc, opts.labelTag || "span", opts.labelClass || "field__label", labAttrs));
    }
    if (opts.control) row.appendChild(opts.control);
    return row;
  }

  /* backAction(doc, opts) -> a "back" affordance wired to onBack.
       opts: { className, label, onBack }
     Cold-safe: a missing onBack yields an inert (but present) control rather than a
     throw, exactly like the app renderers' own guards. */
  function backAction(doc, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    opts = opts || {};
    var node = el(doc, "div",
      opts.className || "settings-frame__back record__action record__action--quiet",
      { role: "button", tabindex: "0", text: opts.label || "\u2190 Back" });
    activate(node, typeof opts.onBack === "function" ? opts.onBack : function () {});
    return node;
  }

  /* hostPersist(fn, patch) -> the host-owned persist seam (flag-don't-fake).
     Hands the patch to the host callback inside a try/catch: it NEVER throws and
     NEVER fabricates a persistence it did not get — with no handler the edit is
     simply reported nowhere (the surface still edited locally). Returns the patch
     unchanged so a host/test can drive an edit without a synthetic DOM event. */
  function hostPersist(fn, patch) {
    if (typeof fn === "function") { try { fn(patch); } catch (e) {} }
    return patch;
  }

  root.settingsFrame = {
    el: el,
    activate: activate,
    panel: panel,
    titledSection: titledSection,
    labeledRow: labeledRow,
    backAction: backAction,
    hostPersist: hostPersist,
    _version: "1.1"
  };
})();
