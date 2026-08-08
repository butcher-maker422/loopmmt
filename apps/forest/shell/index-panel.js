/* Shea's Forest — the App Shell · shell/index-panel.js
   STEP 4, the last DOM piece of the tab system: the "+" catalog PANEL. See
   sessions/01.1230-spunky-whistle-pt1h9t/BUILD-DIRECTIVE-v1.md §3.4 —
   "glob(trees) ⊔ list(horizontals ∪ connectors) → a pick list → pin() writes
   view-config, strip re-renders."

   THIS FILE IS THE PANEL — the thin DOM layer over index-catalog.js (THE MODEL).
   It takes the catalog the model already folded (buildCatalog(data, config)) and
   paints the grouped pick-list into a mount. It is a PURE renderer, twin to
   tab-strip.js: it READS the catalog, it never writes the view-config and never
   persists. A pick flows OUT as an event — forest:catalog-pick {capability} — which
   the host (shell-boot.js) listens for, applies via viewConfig.pin(), persists, and
   re-renders the strip. A dismiss flows out as forest:catalog-close. The panel is
   the ink; the model is the fold; the host owns the write loop.

   §3.8 COMPOSE MODE (the ⊗ compose-CREATION surface — Choice A, pick-two-then-compose):
   a "Compose ⊗" toggle in the head (shown only when ≥2 composable units exist) flips
   the panel into compose-select. In compose mode, picking a unit TOGGLES its selection
   (max two); an already-added item and a ⊗-compose tab are excluded from selection so
   the user never reaches an illegal state (composeRef guards it too — this is the
   defensive front). A "Compose ⊗" button, enabled only at exactly two, emits
   forest:catalog-compose {capA, capB} (the twin of catalog-pick); the host applies
   viewConfig.composeRef → pin → persist → re-render → close. Over-selecting shows a
   calm inline reason and pins nothing. Still PURE of writes — the compose mode emits
   an event; the host owns the write. Compose state rides on the mount so the
   wired-once delegated listener re-renders itself; pick mode is byte-unchanged when
   compose is off (open() always starts in pick mode).

   ─────────────────────────────────────────────────────────────────────────────────
   SEARCH MODE (the Search arc, leg 2 ·) — a SECOND mode, not a rewrite
   ─────────────────────────────────────────────────────────────────────────────────
   The same panel now also paints a FEDERATED SEARCH (shell/search-federation.js). The
   two modes are entered by DIFFERENT DOORS and never sniff each other's shapes:

     open(mount, catalog)        <- the "+" button. PICK MODE. BYTE-UNCHANGED. No input,
                                    no hit items, no state lines. Compose lives here.
     openSearch(mount, model)    <- the magnifying glass. SEARCH MODE. A text input in the
                                    head; groups carry `state`; items may carry `hit`.

   The mode is an EXPLICIT FLAG on the mount, never inferred from the object's shape. A
   shape-sniff ("does it have addableCount?") is the kind of joint that works until the day
   a store answers in a shape you didn't picture — which is precisely the fault that ate
   leg 1's normalisers. So: the door sets the mode.

   ★ THE INPUT SURVIVES A REPAINT, AND THAT IS LOAD-BEARING ★
   Search paints PROGRESSIVELY — onUpdate fires once per store as it lands, so the panel
   repaints up to four times per keystroke-burst. render() clears the whole mount, which
   would DESTROY the text input the user is still typing into: node removed -> focus lost
   -> caret gone -> the next character goes nowhere. So the results live in their own
   `.catalog__groups` node, and the progressive loop calls paintResults(), which swaps ONLY
   that node's contents. The head — and the input inside it, and its focus, and its caret —
   is never touched. (A full render() is still what OPENS the panel and what a compose
   toggle uses; only the search-update path is scoped.)

   The panel stays PURE OF WRITES and pure of network. It does not know searchFederation
   exists. Typing emits `forest:search-query {q}` (debounced); the host runs the federation
   and calls back into paintResults(). Clicking a hit emits `forest:search-open {store,id}`;
   the host opens the tab. Same separation the pick loop has held since STEP 4.

     render(mount, catalog)  -> paint the dialog, wire out-only delegation (once)
     open(mount, catalog)    -> render, starting fresh in pick mode
     openSearch(mount, model)-> render in SEARCH mode (input in the head)
     paintResults(mount, m)  -> swap ONLY the results; never touches the input
     close(mount)            -> empty the mount (the panel disappears; listener stays)

   Already-added items render greyed and inert (no capability, no pick) — the model's
   `added` flag; the panel greys, exactly as the model's contract says. Empty catalog
   (addableCount 0 / no groups) renders a calm "nothing to add" line, never a blank box.

   Plain script (no ES module) — attaches to window.ForestShell.indexPanel.
   Depends on nothing at render time (it consumes a plain catalog object); load order
   is forgiving. Pure of writes; the render layer is the only DOM touch. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});
  var TENSOR = "\u2297";

  /* ---- tiny DOM helpers -----------------------------------------------------
     el() is the one shared from shell/block.js now. This file formerly kept a
     VARIANT with a 5th positional `text` arg; the shared el honours `text` in the
     attrs object instead, so the call sites below migrate positional-text ->
     attrs.text (behaviour-identical — no call passed a literal `text` attr). */
  var el = root.block.el;
  function hasAttr(node, a) { return node && node.getAttribute && node.getAttribute(a) != null; }
  // walk from a node up to (and including) stop, returning the first that satisfies pred
  function closest(node, pred, stop) {
    var n = node;
    while (n) { if (pred(n)) return n; if (n === stop) break; n = n.parentNode; }
    return null;
  }
  function emit(container, name, detail) {
    var view = container && container.ownerDocument && container.ownerDocument.defaultView;
    var ev;
    if (view && typeof view.CustomEvent === "function") ev = new view.CustomEvent(name, { detail: detail, bubbles: true });
    else ev = { type: name, detail: detail, bubbles: true };
    container.dispatchEvent(ev);
  }

  // composable = an addable single unit: not already a tab, and not itself a ⊗ compose
  // (no compose-of-compose — a sub-unit is a single unit; composeRef's nested-compose
  //  guard is the grammar backstop, this exclusion is the front so it's never reached)
  function composable(it) {
    return it && typeof it.capability === "string" && !it.added && it.capability.indexOf(TENSOR) === -1;
  }

  /* ---- search mode: the debounce ---------------------------------------------
     ~180ms. Long enough that a fast typist fires one search, not six; short enough
     that the pause is under the threshold where a person starts wondering. The value
     lives here (not in the host) because it is a property of the INPUT WIDGET's feel,
     not of the network. Exposed on the export so a test can drive it to 0. */
  var DEBOUNCE_MS = 180;

  /* the calm per-state line a group shows INSTEAD of items. R3 (search-federation.js):
     a store we could not read SAYS SO — it never renders zero. `empty` and `error` are
     different facts and they get different words. `pending` is neither: it is a store we
     are still waiting on, and it says that, rather than looking like a store with none. */
  function stateLine(doc, g) {
    if (g.state === "pending") {
      return el(doc, "div", "catalog__group-pending", { role: "status", text: "Looking\u2026" });
    }
    if (g.state === "error") {
      // g.note VERBATIM — the model already wrote the honest reason; the panel does not
      // re-word it, soften it, or replace it with a generic apology.
      return el(doc, "div", "catalog__group-error", { role: "status",
        text: g.note || "This store did not answer." });
    }
    if (g.state === "empty") {
      return el(doc, "div", "catalog__group-empty", { text: "Nothing here matches." });
    }
    return null;
  }

  /* a RESULT item -> a button carrying its {store,id}. The panel does not know how to open
     a contact or an event; it knows how to SAY that one was clicked. The host owns the nav. */
  /* fillMarked(doc, node, text) — T2. FTS5 hands back a snippet delimited with « », e.g.
       "the letter I filed about \u00abJamie\u00bb. She is an ER nurse\u2026"
     Map those delimiters to <mark> NODES. Do NOT inject them as HTML.

     THIS IS AN XSS BOUNDARY AND IT IS NOT THEORETICAL. A snippet is a passage of a document the
     operator ingested from Drive, Dropbox or Gmail — i.e. content an ATTACKER CAN AUTHOR AND SEND
     HIM. A renderer that trusts an index's markup is a renderer that executes a stranger's script
     because the stranger emailed him a file. Every character below lands via createTextNode; the
     only elements created are <mark>s this function makes itself.

     Same shape as contacts-renderer.js :: fillHighlighted (F5/F15) — the built, tested, XSS-safe
     highlighter — with one difference: THERE the needle is the user's typed query, HERE the marks
     already come from the index, so we do not re-match anything. We just honour the marks we were
     given, and we honour them as text. */
  function fillMarked(doc, node, text) {
    var s = String(text == null ? "" : text);
    var i = 0;
    while (i < s.length) {
      var open = s.indexOf("\u00ab", i);
      if (open === -1) { node.appendChild(doc.createTextNode(s.slice(i))); break; }
      var close = s.indexOf("\u00bb", open + 1);
      if (close === -1) { node.appendChild(doc.createTextNode(s.slice(i))); break; }
      if (open > i) node.appendChild(doc.createTextNode(s.slice(i, open)));
      node.appendChild(el(doc, "mark", "catalog__hit-mark", { text: s.slice(open + 1, close) }));
      i = close + 1;
    }
    return node;
  }

  /* highlightInto(doc, node, text, q) — mark the operator's typed query inside a plain string.
     Needed for the NAME, and this is not decoration.

     A soil hit can match on the FILENAME and not the body at all: `jamie-letter.txt` tokenizes to
     jamie + letter + txt, so searching "jamie" hits it even if the word never appears inside the
     document. FTS5 then returns a body snippet with NO « » marks in it — correctly, because the
     match was not there. Render only the body snippet and the user sees a result with nothing lit
     up in it and reasonably concludes the search is broken. So the NAME is highlighted too, and the
     two together always account for why a hit is a hit. (Measured, — there is a test.) */
  function highlightInto(doc, node, text, q) {
    var s = String(text == null ? "" : text);
    var needle = String(q || "").trim();
    if (!needle) { node.textContent = s; return node; }
    var lc = s.toLowerCase(), nlc = needle.toLowerCase(), i = 0, idx;
    while ((idx = lc.indexOf(nlc, i)) !== -1) {
      if (idx > i) node.appendChild(doc.createTextNode(s.slice(i, idx)));
      node.appendChild(el(doc, "mark", "catalog__hit-mark", { text: s.slice(idx, idx + needle.length) }));
      i = idx + needle.length;
    }
    if (i < s.length) node.appendChild(doc.createTextNode(s.slice(i)));
    return node;
  }

  function hitButton(doc, it, q) {
    var b = el(doc, "button", "catalog__item catalog__item--hit",
      { type: "button",
        "data-search-hit": JSON.stringify({ store: it.hit.store, id: it.hit.id }),
        title: it.label || "" });
    var lab = el(doc, "span", "catalog__hit-label");
    // a soil hit gets its NAME highlighted (see above); every other store's label is plain text.
    if (typeof it.snippet === "string") highlightInto(doc, lab, it.label || "", q);
    else lab.textContent = String(it.label || "");
    b.appendChild(lab);
    // a SNIPPET (soil) and a SUB (contacts/calendar/mail) are different facts and render differently.
    if (typeof it.snippet === "string" && it.snippet) {
      b.appendChild(fillMarked(doc, el(doc, "span", "catalog__hit-snippet"), it.snippet));
    } else if (it.sub) {
      b.appendChild(el(doc, "span", "catalog__hit-sub", { text: String(it.sub) }));
    }
    if (it.category) b.appendChild(el(doc, "span", "catalog__hit-cat", { text: String(it.category) }));
    return b;
  }

  /* ---- render(mount, catalog) ----------------------------------------------- *
   * catalog = index-catalog.buildCatalog(data, config):                         *
   *   { groups: [ { kind, title, items: [ { capability, label, added, grove? }]}], addableCount } *
   * Paints a modal dialog: backdrop + panel(head + grouped items). Addable items *
   * are <button data-cap="…"> (emit pick); added items are inert greyed spans.   *
   * In compose mode, composable items are <button data-compose-cap="…"> and the  *
   * compose action row carries the Compose ⊗ button + any calm reason.           */
  function render(mount, catalog) {
    if (!mount) return catalog;
    var doc = mount.ownerDocument;
    if (!doc) return catalog;

    // clear (built fresh each open — a transient modal, not a signature-idempotent strip)
    while (mount.firstChild) mount.removeChild(mount.firstChild);

    var cat = catalog || { groups: [], addableCount: 0 };
    var groups = cat.groups || [];

    // §3.8 compose state rides on the mount so the wired-once listener re-renders itself
    var composeMode = !!mount.__forestComposeMode;
    var searchMode  = !!mount.__forestSearchMode;   // set by the DOOR (openSearch), never sniffed
    var sel = mount.__forestComposeSel || (mount.__forestComposeSel = []);
    var reason = mount.__forestComposeReason || "";
    mount.__forestCatalog = cat;   // stash so the delegated listener can re-render on toggle/selection

    var composableCount = 0;
    groups.forEach(function (g) { (g.items || []).forEach(function (it) { if (composable(it)) composableCount++; }); });

    var dialog = el(doc, "div", "catalog", { role: "dialog", "aria-modal": "true", "aria-label": "Add a tab" });
    var backdrop = el(doc, "div", "catalog__backdrop", { "data-catalog-backdrop": "1" });
    dialog.appendChild(backdrop);

    var panel = el(doc, "div", "catalog__panel");
    var head = el(doc, "div", "catalog__head");
    head.appendChild(el(doc, "span", "catalog__title",
      { text: searchMode ? "Search your Forest" : (composeMode ? "Compose a grove" : "Add a tab") }));

    // SEARCH MODE: the text input. Its listener is wired on the NODE (once), and the node is
    // re-created only by a full render() — the progressive-paint loop uses paintResults(), which
    // never touches the head. `value` is seeded from the mount so a full re-render (e.g. a compose
    // toggle, which cannot happen in search mode, or a reopen) does not silently drop the query.
    if (searchMode) {
      var input = el(doc, "input", "catalog__search",
        { type: "search", "data-catalog-search": "1", autocomplete: "off", spellcheck: "false",
          "aria-label": "Search your Forest",
          placeholder: "Search mail, people, events, and your Forest\u2026" });
      input.value = mount.__forestQuery || "";
      if (!input.__forestSearchWired) {
        input.__forestSearchWired = true;
        input.addEventListener("input", function () {
          var q = String(input.value == null ? "" : input.value);
          mount.__forestQuery = q;
          // debounce: one search per pause, not one per keystroke. The host does the fetching.
          if (mount.__forestSearchTimer) clearTimeout(mount.__forestSearchTimer);
          var ms = root.indexPanel ? root.indexPanel._debounceMs : DEBOUNCE_MS;
          mount.__forestSearchTimer = setTimeout(function () {
            mount.__forestSearchTimer = null;
            emit(mount, "forest:search-query", { q: q });
          }, ms);
        });
      }
      head.appendChild(input);
      mount.__forestSearchInput = input;
    }

    // the Compose ⊗ toggle — the affordance to enter/leave compose mode (only when it can work).
    // NOT in search mode: composing a grove is an act on the CATALOG, and the search surface is
    // not the catalog. Compose is untouched by this arc — it simply does not appear here.
    if (!searchMode && composableCount >= 2) {
      head.appendChild(el(doc, "button",
        "catalog__compose-toggle" + (composeMode ? " catalog__compose-toggle--on" : ""),
        { type: "button", "data-catalog-compose-toggle": "1", "aria-pressed": composeMode ? "true" : "false",
          text: composeMode ? TENSOR + " Composing\u2026" : "Compose " + TENSOR }));
    }
    head.appendChild(el(doc, "button", "catalog__close", { type: "button", "data-catalog-close": "1", "aria-label": "Close", text: "\u00D7" })); // ×
    panel.appendChild(head);

    var body = el(doc, "div", "catalog__body");
    // The global empty line is a PICK-MODE fact ("everything's already on your strip"), and it
    // reads off addableCount — which a search model does not have and must never be asked for.
    // In search mode each group speaks for itself (empty / error / pending), per R3.
    if (!searchMode && (!groups.length || cat.addableCount === 0)) {
      // calm empty state — never a blank box (Theo: state reads as weather, not alarm)
      body.appendChild(el(doc, "div", "catalog__empty",
        { text: groups.length ? "Everything's already on your strip." : "Nothing to add yet." }));
    }

    // the swappable results node — paintResults() replaces ONLY this, so the input above survives
    var groupsWrap = el(doc, "div", "catalog__groups");
    paintGroupsInto(doc, groupsWrap, cat, { searchMode: searchMode, composeMode: composeMode, sel: sel });
    panel.appendChild(groupsWrap);
    mount.__forestGroupsEl = groupsWrap;

    panel.appendChild(body);
    return finishRender(mount, doc, dialog, panel, cat, { composeMode: composeMode, sel: sel, reason: reason });
  }

  /* paintGroupsInto — the ONE place a group becomes DOM. Called by render() (into a fresh node)
     and by paintResults() (into the live one). Pick/compose item paths below are byte-identical
     to what shipped at STEP 4 / §3.8 — the search branches are ADDITIVE, never a rewrite. */
  function paintGroupsInto(doc, wrap, cat, ctx) {
    while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
    var searchMode = !!ctx.searchMode, composeMode = !!ctx.composeMode, sel = ctx.sel || [];

    (cat.groups || []).forEach(function (g) {
      // `idle` = a store we have not asked yet (the empty query). It renders NOTHING — an empty
      // "Mail" heading with nothing under it is a store reporting a result it never looked for.
      if (searchMode && g.state === "idle") return;

      var group = el(doc, "div", "catalog__group catalog__group--" + (g.kind || "x"));
      group.appendChild(el(doc, "div", "catalog__group-title", { text: g.title || "" }));

      if (searchMode) {
        var line = stateLine(doc, g);
        if (line) { group.appendChild(line); wrap.appendChild(group); return; }  // not `ok` -> the state IS the content
      }

      var items = el(doc, "div", "catalog__items");
      /* T2 · THE HONEST FLOOR, SAID OUT LOUD. `unindexed` is how many items in the operator's Soil
         have no text to search — a PDF, a scan, an image. A search surface that reports "3 results"
         over a corpus where 40 documents were never looked at is a right number wearing a wrong
         noun, which is the fault class this whole campaign is named after. So the panel says it. */
      if (searchMode && g.kind === "soil" && g.unindexed > 0) {
        items.appendChild(el(doc, "div", "catalog__group-note", { role: "note",
          text: g.unindexed + (g.unindexed === 1 ? " item has" : " items have")
            + " no text to search (a PDF or a scan). It was not looked at." }));
      }
      (g.items || []).forEach(function (it) {
        if (!it) return;
        // a RESULT (search only). Carries `hit`, never `capability` — the model guarantees it.
        if (searchMode && it.hit) { items.appendChild(hitButton(doc, it, (cat && cat.query) || "")); return; }
        if (typeof it.capability !== "string") return;
        if (composeMode) {
          if (composable(it)) {
            var picked = sel.indexOf(it.capability) !== -1;
            var cbtn = el(doc, "button",
              "catalog__item catalog__item--compose" + (picked ? " catalog__item--picked" : ""),
              { type: "button", "data-compose-cap": it.capability, "aria-pressed": picked ? "true" : "false", title: it.label || it.capability,
                text: (it.label || it.capability) + (picked ? "  \u2713" : "") }); // ✓ on the picked ones
            items.appendChild(cbtn);
          } else {
            // excluded from compose (already a tab, or a ⊗ compose tab) — inert greyed
            items.appendChild(el(doc, "span", "catalog__item catalog__item--added",
              { "data-compose-excluded": it.capability, "aria-disabled": "true", text: (it.label || it.capability) }));
          }
        } else if (it.added) {
          // PICK MODE, inert, greyed — already a tab (the model's `added` flag; the panel greys)
          items.appendChild(el(doc, "span", "catalog__item catalog__item--added",
            { "data-cap-added": it.capability, "aria-disabled": "true", text: (it.label || it.capability) + "  \u2713" })); // ✓
        } else {
          // PICK MODE, addable — a real button carrying data-cap (emits pick)
          items.appendChild(el(doc, "button", "catalog__item",
            { type: "button", "data-cap": it.capability, title: it.label || it.capability, text: it.label || it.capability }));
        }
      });
      group.appendChild(items);
      wrap.appendChild(group);
    });
    return wrap;
  }

  /* finishRender — the dialog assembly + the wired-once delegated listener. Split out only so
     render() could hand the groups to paintGroupsInto; the behaviour below is unchanged. */
  function finishRender(mount, doc, dialog, panel, cat, ctx) {
    var composeMode = !!ctx.composeMode, sel = ctx.sel || [], reason = ctx.reason || "";

    // §3.8 compose action row: the Compose ⊗ button (enabled only at exactly two) + calm reason
    if (composeMode) {
      var actions = el(doc, "div", "catalog__compose-actions");
      if (reason) actions.appendChild(el(doc, "div", "catalog__compose-reason", { role: "status", text: reason }));
      var goBtn = el(doc, "button", "catalog__compose-go" + (sel.length === 2 ? "" : " catalog__compose-go--off"),
        { type: "button", "data-catalog-compose-go": "1" },
        sel.length === 2 ? "Compose " + TENSOR : "Pick two to compose");
      if (sel.length !== 2) goBtn.setAttribute("disabled", "disabled");
      actions.appendChild(goBtn);
      panel.appendChild(actions);
    }

    dialog.appendChild(panel);
    mount.appendChild(dialog);

    // out-only delegation, wired ONCE per mount (re-render never stacks listeners)
    if (!mount.__forestCatalogWired) {
      mount.__forestCatalogWired = true;
      mount.addEventListener("click", function (e) {
        var t = e && e.target;
        if (!t) return;
        // dismiss: the × button or the backdrop
        if (closest(t, function (n) { return hasAttr(n, "data-catalog-close") || hasAttr(n, "data-catalog-backdrop"); }, mount)) {
          emit(mount, "forest:catalog-close", {});
          return;
        }
        // §3.8 compose toggle: flip mode, clear selection + reason, re-render from the stashed catalog
        if (closest(t, function (n) { return hasAttr(n, "data-catalog-compose-toggle"); }, mount)) {
          mount.__forestComposeMode = !mount.__forestComposeMode;
          mount.__forestComposeSel = [];
          mount.__forestComposeReason = "";
          render(mount, mount.__forestCatalog);
          return;
        }
        // §3.8 compose selection: toggle a cap in the selection (max two), re-render
        var cpick = closest(t, function (n) { return hasAttr(n, "data-compose-cap"); }, mount);
        if (cpick) {
          var cap = cpick.getAttribute("data-compose-cap");
          var s = mount.__forestComposeSel || (mount.__forestComposeSel = []);
          var at = s.indexOf(cap);
          if (at !== -1) { s.splice(at, 1); mount.__forestComposeReason = ""; }        // deselect
          else if (s.length < 2) { s.push(cap); mount.__forestComposeReason = ""; }    // select
          else { mount.__forestComposeReason = "Two units make a grove \u2014 deselect one first."; } // over-pick: calm reason, no add
          render(mount, mount.__forestCatalog);
          return;
        }
        // §3.8 compose go: at exactly two, emit forest:catalog-compose {capA, capB}
        if (closest(t, function (n) { return hasAttr(n, "data-catalog-compose-go"); }, mount)) {
          var sg = mount.__forestComposeSel || [];
          if (sg.length === 2) {
            emit(mount, "forest:catalog-compose", { capA: sg[0], capB: sg[1] });
            // reset compose state; the host closes the panel on a successful compose
            mount.__forestComposeSel = [];
            mount.__forestComposeMode = false;
            mount.__forestComposeReason = "";
          }
          return;
        }
        // SEARCH: a result was clicked. Emits {store,id} — the panel does not navigate, it
        // reports. A malformed payload is DROPPED silently rather than dispatched as a
        // half-event the host would have to defend against (the joint is typed at the seam).
        var hitNode = closest(t, function (n) { return hasAttr(n, "data-search-hit"); }, mount);
        if (hitNode) {
          var hit = null;
          try { hit = JSON.parse(hitNode.getAttribute("data-search-hit")); } catch (bad) { hit = null; }
          if (hit && hit.store && hit.id) emit(mount, "forest:search-open", { store: hit.store, id: String(hit.id) });
          return;
        }
        // pick (pick mode only — compose items carry data-compose-cap, never data-cap)
        var pick = closest(t, function (n) { return hasAttr(n, "data-cap"); }, mount);
        if (pick) { emit(mount, "forest:catalog-pick", { capability: pick.getAttribute("data-cap") }); return; }
      });
    }
    return cat;
  }

  function open(mount, catalog) {
    // a fresh open always starts in pick mode; compose is a within-open toggle
    if (mount) {
      mount.__forestComposeMode = false; mount.__forestComposeSel = []; mount.__forestComposeReason = "";
      mount.__forestSearchMode = false;   // the "+" door is PICK. Byte-unchanged.
    }
    return render(mount, catalog);
  }

  /* openSearch(mount, model) — the magnifying-glass door. `model` is a search-federation model
     ({query, groups:[{kind,title,state,items,note?}]}); the empty query's model IS the catalog. */
  function openSearch(mount, model) {
    if (mount) {
      mount.__forestSearchMode = true;
      mount.__forestComposeMode = false; mount.__forestComposeSel = []; mount.__forestComposeReason = "";
      mount.__forestQuery = (model && typeof model.query === "string") ? model.query : "";
    }
    return render(mount, model);
  }

  /* paintResults(mount, model) — the PROGRESSIVE-PAINT path. Swaps ONLY the results node, so the
     input keeps its focus and its caret while stores land underneath it. If the panel is not
     currently open (no groups node in the tree), this is a no-op — a late store answering after
     the user closed the panel must not resurrect it. */
  function paintResults(mount, model) {
    if (!mount || !mount.__forestSearchMode) return model;
    var wrap = mount.__forestGroupsEl;
    if (!wrap || !wrap.ownerDocument || !mount.firstChild) return model;   // closed -> drop it
    mount.__forestCatalog = model || { groups: [] };
    paintGroupsInto(wrap.ownerDocument, wrap, mount.__forestCatalog,
      { searchMode: true, composeMode: false, sel: [] });
    return model;
  }

  function close(mount) {
    if (!mount) return;
    if (mount.__forestSearchTimer) { clearTimeout(mount.__forestSearchTimer); mount.__forestSearchTimer = null; }
    mount.__forestSearchMode = false;
    mount.__forestQuery = "";
    mount.__forestGroupsEl = null;
    mount.__forestSearchInput = null;
    while (mount.firstChild) mount.removeChild(mount.firstChild);
  }

  /* ---- export --------------------------------------------------------------- */
  root.indexPanel = {
    render: render,
    open: open,
    openSearch: openSearch,
    paintResults: paintResults,
    close: close,
    _debounceMs: DEBOUNCE_MS,   // a test drives this to 0; the shell never touches it
    _version: "1.2"
  };
})();
