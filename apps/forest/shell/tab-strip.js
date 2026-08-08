/* Shea's Forest — the App Shell · shell/tab-strip.js
   STEP 2 of the shell build. See internal §3.2.

   The tab-strip is a PURE FOLD of the view-config into the two-tier tab chrome:
   pinned tabs small/icon on the LEFT, open tabs named on the RIGHT, then the "+".
   It READS the view-config; it never writes it, and it never touches the
   obligation graph. Every change flows OUT as an event — select / pin / unpin /
   reorder / close / open-catalog — which the host listens for, applies to the
   view-config, and re-renders. The strip is the ink; the view-config is the source.

   Two layers:
     stripModel(config, opts)        -> plain-data strip description   (THE FOLD)
     render(container, config, opts) -> idempotent DOM projection      (THE INK)

   Ink Law: render is idempotent. The same (config, active, resolver, badges) folds
   to the same DOM; a second render with identical inputs is a no-op that leaves the
   existing nodes untouched (folds-twice-identical), enforced by a signature check.

   Design rules carried from styles/tokens.css + the directive:
     • Browser-native chrome vocabulary: "tabs", "pinned", "+".
     • The ACTIVE tab carries the gold disc (tokens: where attention rests).
     • Badges OFF by default; when on, calm WEATHER only — no counts, no red
       (Theo's rule: state reads as weather, not alarm). The badge FOLD itself is
       step 6; here it is an inert seam that renders nothing until fed.
     • Honest-absent: a capability with no live source renders muted with a
       "not connected" hint (the full absent PANE is step 9).

   Pure of DOM in the model layer; the render layer is the only DOM touch.
   Plain script (no ES module) — attaches to window.ForestShell.tabStrip.
   Depends on window.ForestShell.viewConfig (STEP 1) — load view-config.js first. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  function vcRef() { return root.viewConfig; } // resolved lazily so load-order is forgiving

  /* ---- end-user vocabulary (system names never leak to the chrome) --------- */
  var CONNECTOR_LABEL = { gmail: "Gmail", gcal: "Calendar", contacts: "Contacts", files: "Files" };
  var CONNECTOR_ICON  = { gmail: "\u2709", gcal: "\u25A6", contacts: "\u25CD", files: "\u25A4" }; // ✉ ▦ ◍ ▤

  function titleCase(s) {
    return String(s).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
      .replace(/\b\w/g, function (m) { return m.toUpperCase(); });
  }

  function sideLabel(cap) { // one side of a grove:a⊗b
    var vc = vcRef();
    if (vc && vc.LIVE_CONNECTORS.indexOf(cap) !== -1) return CONNECTOR_LABEL[cap] || titleCase(cap);
    var i = cap.indexOf(":");
    return i === -1 ? titleCase(cap) : titleCase(cap.slice(i + 1));
  }

  function labelFor(capability) {
    var vc = vcRef();
    var kind = vc ? vc.kindOf(capability) : "unknown";
    if (kind === "connector") return CONNECTOR_LABEL[capability] || titleCase(capability);
    if (kind === "connector-absent") return titleCase(capability);
    var ref = capability.indexOf(":") !== -1 ? capability.slice(capability.indexOf(":") + 1) : capability;
    if (kind === "tree") return titleCase(ref);          // slugs -> Title Case
    if (kind === "horizon") return ref;                  // horizon names arrive human-cased
    if (kind === "grove") return ref.split("\u2297").map(sideLabel).join(" \u2297 ");
    if (kind === "mail") return "Mail";                  // the email-app tab (kind mail:inbox)
    // Trio app panes: the Calendar app (calendar:month) and Contacts app
    // (contacts:people) are the top-level APPS, not their capability-ref view names.
    // Without these two lines they fell through to titleCase(ref) -> "Month"/"People",
    // colliding with the operator's mental model (the gcal/contacts *connector* source
    // tabs carry "Calendar"/"Contacts" via CONNECTOR_LABEL). The catalog's Apps group
    // already labels them "Calendar"/"Contacts"; the strip now agrees.
    if (kind === "calendar") return "Calendar";          // the Calendar app tab (kind calendar:*)
    if (kind === "contacts") return "Contacts";          // the Contacts app tab (kind contacts:*)
    if (kind === "sudoku") return "Sudoku";              // the Sudoku app tab (kind sudoku:*) — the dual-expression forest face
    if (kind === "butcher") return "Butcher"; // the Butcher app tab (kind butcher:forest) — was falling through to titleCase("forest")="Forest" (operator)
    if (kind === "battleganza") return "Battleganza";    // the Battleganza app tab (kind battleganza:*) — the second dual-expression game face
    return titleCase(ref);
  }

  function iconFor(capability) {
    var vc = vcRef();
    var kind = vc ? vc.kindOf(capability) : "unknown";
    if (kind === "connector") return CONNECTOR_ICON[capability] || "\u25A1";
    if (kind === "connector-absent") return "\u25A1"; // □
    if (kind === "tree") return "\u25B2";             // ▲ a planted tree
    if (kind === "horizon") return "\u2014";          // — the horizon line
    if (kind === "grove") return "\u2297";            // ⊗ the workspace
    if (kind === "mail") return "\u2709";             // ✉ the Mail app
    if (kind === "calendar") return "\u25A6";         // ▦ the Calendar app (kind calendar:*)
    if (kind === "contacts") return "\u25CD";         // ◍ the Contacts app (kind contacts:*)
    if (kind === "sudoku") return "\u229E";           // ⊞ the Sudoku app (kind sudoku:*) — a gridded board
    if (kind === "battleganza") return "\u25C8";     // ◈ the Battleganza app (kind battleganza:*) — a contested field
    return "\u25A1";
  }

  /* ========================================================================= *
   *  THE FOLD — view-config -> plain-data strip description (no DOM)           *
   * ========================================================================= */
  // opts: { active?, resolver?, weather? }  — all optional.
  //   active   : capability id of the current tab (defaults to landing = leftmost)
  //   resolver : capability -> unit | falsy  (drives honest-absent)
  //   weather  : { <capability>: "active"|"quiet"|"deep"|"ok" }  calm words, never counts
  function stripModel(config, opts) {
    opts = opts || {};
    var vc = vcRef();
    var order = vc ? vc.renderOrder(config) : [];      // pinned-by-ord ++ open-by-ord
    var landing = vc ? vc.landingTab(config) : null;
    var active = opts.active || (landing ? landing.capability : null);
    var badgesOn = vc ? vc.badgesEnabled(config) : false;

    function tabModel(t) {
      var res = vc ? vc.resolveOrAbsent(t.capability, opts.resolver) : { ok: true };
      var weather = null;
      if (badgesOn && opts.weather && Object.prototype.hasOwnProperty.call(opts.weather, t.capability)) {
        weather = opts.weather[t.capability];          // calm weather word; NEVER a count
      }
      // THE RENAME OVERRIDE (item 3). labelFor() stays the pure DERIVED name — what
      // the system would call this tab — and the owner's stored name, if there is
      // one, is layered over it HERE at the fold. Keeping the two apart is what lets
      // "clear the field and press Return" mean revert: the derived name was never
      // overwritten, only covered. Cold-safe against an older view-config that has
      // no tabLabelOf (falls through to derived, exactly today's behaviour).
      var derived = labelFor(t.capability);
      var chosen = (vc && typeof vc.tabLabelOf === "function") ? vc.tabLabelOf(config, t.capability) : "";
      return {
        capability: t.capability,
        kind: vc ? vc.kindOf(t.capability) : "unknown",
        label: chosen || derived,
        derivedLabel: derived,        // what a revert would restore — the editable shows it as placeholder
        renamed: chosen !== "",       // whether this name is the owner's or the system's
        icon: iconFor(t.capability),
        pinned: !!t.pinned,
        active: t.capability === active,
        absent: res.ok === false,
        absentReason: res.ok === false ? res.reason : null,
        pending: res.pending === true,
        weather: weather
      };
    }

    var tabs = order.map(tabModel);
    return {
      pinned: tabs.filter(function (t) { return t.pinned; }),
      open:   tabs.filter(function (t) { return !t.pinned; }),
      add: true,
      // The edit-lock is the SAME truth the lock button in the actions cluster reads
      // (viewConfig.editLocked) — folded in here so the "+" can refuse the click rather
      // than open a catalog whose pick the locked config will then reject. The strip is
      // a pure fold: it is TOLD the lock state by the config, it never decides it.
      locked: vc ? vc.editLocked(config) : false,
      badgesOn: badgesOn,
      active: active,
      empty: tabs.length === 0
    };
  }

  // A stable signature of a folded model — the idempotency key.
  //
  // THE LABEL IS IN HERE ON PURPOSE (item 3,). render short-circuits on
  // an unchanged signature. Before the rename seam existed, a tab's label was a pure
  // function of its capability, so capability-in-signature covered it. It no longer
  // is: two models can agree on every field below and disagree on what the tab is
  // CALLED. Leave the label out and a rename writes the store, re-folds, hits the
  // no-op guard and paints nothing — the button works, the config is right, and the
  // screen never changes. That is the silent-dead-control class this bar has already
  // been bitten by once (the delegated lock click,), arriving from the other
  // direction: not a lost event, a landed event with no visible effect.
  function signature(model) {
    function sig1(t) {
      return [t.capability, t.pinned ? "P" : "O", t.active ? "A" : "-",
              t.absent ? "X" : (t.pending ? "~" : "-"), t.weather || "",
              t.label].join(":");
    }
    return [
      model.pinned.map(sig1).join("|"),
      model.open.map(sig1).join("|"),
      model.badgesOn ? "b1" : "b0",
      model.locked ? "L" : "U",
      model.active || ""
    ].join("#");
  }

  /* ========================================================================= *
   *  THE INK — deterministic DOM projection of the fold                       *
   * ========================================================================= */
  // The one el() lives in shell/block.js now (the Block Alphabet's shared atom).
  var el = root.block.el;

  function classOf(n) { return (n && n.className) || ""; }

  // minimal, structure-aware ancestor search (we own the structure)
  function closest(node, pred, stop) {
    var n = node;
    while (n && n !== stop) { if (pred(n)) return n; n = n.parentNode; }
    return (n && n !== stop && pred(n)) ? n : null;
  }
  function hasAttr(n, a) { return n && typeof n.getAttribute === "function" && n.getAttribute(a) != null; }
  function attr(n, a) { return n && typeof n.getAttribute === "function" ? n.getAttribute(a) : null; }

  function buildTab(doc, t, locked) {
    var cls = "tab tab--" + (t.pinned ? "pinned" : "open")
      + (t.active ? " tab--active" : "")
      + (t.absent ? " tab--absent" : "")
      + (t.pending ? " tab--pending" : "");
    var tabAttrs = {
      type: "button", role: "tab",
      "aria-selected": t.active ? "true" : "false",
      "data-capability": t.capability,
      "data-kind": t.kind,
      title: t.label + (t.absent ? " \u2014 not connected" : ""),
      tabindex: t.active ? "0" : "-1"                  // roving tabindex
    };
    // MOUSE REORDER (operator's note #4,). The reorder seam already existed
    // on BOTH sides — viewConfig.reorder() and the host's forest:tab-reorder listener —
    // and the ONLY emitter in the shell was Ctrl/Meta+Arrow. The mouse path was never
    // built, which is why the cursor turned into a hand and nothing moved: nothing was
    // listening for the hand. This adds the missing INPUT PATH and nothing else; it
    // emits the SAME event the keyboard emits, so the store mutation, the persistence
    // and the host's lock gate are inherited whole, with no second source of truth.
    //
    // `draggable` is the strip's own fold of viewConfig.editLocked — exactly the idiom
    // the "+" already uses (`disabled` = the affordance, the handler guard = the fence).
    // Locked -> no draggable attribute -> the browser will not start a drag AND the
    // dragstart guard below refuses one anyway (a synthetic event must hit the same wall
    // a mouse does). Unlocked -> draggable, and the strip's fold and the host's write
    // loop are reading the one truth.
    if (!locked) tabAttrs.draggable = "true";
    var b = el(doc, "button", cls, tabAttrs);
    b.appendChild(el(doc, "span", "tab__icon", { "aria-hidden": "true", text: t.icon }));
    // The gold disc marks the active tab — but ONLY on a LABELLED (open) tab, where the
    // pill is wide enough to carry a second mark beside the words. A PINNED tab is
    // icon-only (its label is sr-only), so the disc lands right next to the glyph with
    // no room to breathe and reads as a smudge on the icon, not as a marker (operator's
    // note #2,). It is also redundant there: `.tab--active` already tints the
    // whole pill, which on a small icon-only chip is the LOUDER signal, not the quieter
    // one. Removing ink that says nothing new — the active state loses nothing.
    // (a11y is unaffected: `aria-selected` carries the state, the disc is aria-hidden.)
    if (t.active && !t.pinned) b.appendChild(el(doc, "span", "tab__disc", { "aria-hidden": "true" }));
    // open tabs are named on the surface; pinned carry the name for AT only.
    //
    // ON AN OPEN TAB THIS SPAN IS ALSO THE RENAME SURFACE (item 3 slice B). Two
    // attributes carry it: `data-label` is the hook the delegated handlers find (the
    // same data-attribute idiom data-pin/data-close already use, so the rename joins
    // an existing family rather than inventing a lookup), and `data-derived` carries
    // the SYSTEM's own name for this tab so the editor can tell "the owner typed this"
    // from "this is what we compute" without a second fold.
    //
    // A PINNED tab gets NEITHER, and is not renamable in this slice. Its label is
    // sr-only — there is nothing on screen to edit, so an editable there is a control
    // that exists for assistive tech and for no one else, with no visible affordance,
    // no visible caret and no visible result. That is a trap, not a feature. This is a
    // DECISION, not a gap: if pinned tabs should be renamable, the honest form is a
    // rename entry point that does not pretend the sr-only span is a text field.
    if (t.pinned) {
      b.appendChild(el(doc, "span", "tab__label tab__label--sr", { text: t.label }));
    } else {
      b.appendChild(el(doc, "span", "tab__label", {
        text: t.label,
        "data-label": "1",
        "data-derived": t.derivedLabel || ""
      }));
    }
    if (t.weather) b.appendChild(el(doc, "span", "tab__weather tab__weather--" + t.weather,
      { "aria-hidden": "true", title: t.weather }));                                       // calm weather dot
    if (t.absent) b.appendChild(el(doc, "span", "tab__absent", { "aria-hidden": "true", text: "\u00B7 not connected" }));
    // pin control — emits pin/unpin
    b.appendChild(el(doc, "span", "tab__pin", {
      role: "button", tabindex: "-1",
      "aria-label": (t.pinned ? "Unpin " : "Pin ") + t.label,
      title: t.pinned ? "Unpin" : "Pin",
      "data-pin": "1", text: t.pinned ? "\u25C9" : "\u25CB"                                // ◉ pinned / ○ open
    }));
    // close on open tabs only (pinned resist casual close — no ×)
    if (!t.pinned) b.appendChild(el(doc, "span", "tab__close", {
      role: "button", tabindex: "-1", "aria-label": "Close " + t.label, title: "Close",
      "data-close": "1", text: "\u00D7"                                                    // ×
    }));
    return b;
  }

  function buildStrip(doc, model) {
    var strip = el(doc, "div", "tabstrip" + (model.empty ? " tabstrip--empty" : ""), { role: "tablist", "aria-label": "your tabs" });

    var pinned = el(doc, "div", "tabstrip__pinned", { role: "group", "aria-label": "pinned tabs" });
    model.pinned.forEach(function (t) { pinned.appendChild(buildTab(doc, t, model.locked)); });
    strip.appendChild(pinned);

    var open = el(doc, "div", "tabstrip__open", { role: "group", "aria-label": "open tabs" });
    model.open.forEach(function (t) { open.appendChild(buildTab(doc, t, model.locked)); });
    strip.appendChild(open);

    // The "+" — opens the catalog (step 4). Browser-native affordance.
    //
    // LOCKED -> the button is genuinely DISABLED, not merely painted grey (operator's
    // note #3,). The distinction is the whole point: a control that LOOKS dead
    // but still fires is worse than one that never dimmed, and a control that fires into
    // a locked config costs the user a click to *discover* a refusal. Disabled + a title
    // that names the remedy ("click the lock") turns a dead end into an instruction. The
    // click handler ALSO guards on the model (below) — the `disabled` attribute is the
    // affordance, the handler guard is the fence; a keyboard or a synthetic event must
    // hit the same wall the mouse does.
    var addLabel = model.locked
      ? "Tab editing is locked \u2014 click the lock to add a tab"
      : "Open a tab";
    var addAttrs = {
      type: "button", "data-add": "1",
      "aria-label": addLabel, title: addLabel,
      text: "\uFF0B"   // ＋
    };
    if (model.locked) { addAttrs.disabled = "disabled"; addAttrs["aria-disabled"] = "true"; }

    /* THE ADD STACK (operator, item 4,): "+" on TOP, the edit-lock BENEATH it.
       The lock used to live in the top bar's .app-actions cluster; only its SEAT moves.
       This module builds the seat and leaves it EMPTY -- shell/tabstrip-actions.js still
       owns the padlock SVG, its aria-pressed state and its emit, and fills the slot via
       renderLock(). One icon, one owner, one writer; the alternative (rebuild the padlock
       here) would fork the SVG into two modules that can silently disagree.
       Cold-safe BOTH ways: no actions module -> an empty slot and the strip reads exactly
       as it does today; no slot in the document -> renderLock() is a silent no-op. */
    var stack = el(doc, "div", "tab-addstack", { "data-add-stack": "1" });
    stack.appendChild(el(doc, "button", "tab tab--add" + (model.locked ? " tab--add-locked" : ""), addAttrs));
    stack.appendChild(el(doc, "div", "tab-addstack__lock", { "data-lock-slot": "1" }));
    strip.appendChild(stack);
    return strip;
  }

  /* ---- event emission (out only; the strip never mutates the graph) -------- */
  // The FENCE behind the affordance. `disabled` stops a real mouse click in a real
  // browser — it does NOT stop a synthetic dispatch, a keydown route, or a test double
  // that never implemented disabled semantics. So the emit path checks the lock itself.
  // (The rendered `disabled` attribute IS the strip's own fold of viewConfig.editLocked,
  // so this reads the same truth the model wrote — no second source.)
  function addIsLocked(n) {
    return !!(n && typeof n.getAttribute === "function" &&
      (n.getAttribute("disabled") != null || n.getAttribute("aria-disabled") === "true"));
  }

  function emit(container, name, detail) {
    var view = container.ownerDocument && container.ownerDocument.defaultView;
    var ev;
    if (view && typeof view.CustomEvent === "function") ev = new view.CustomEvent(name, { detail: detail, bubbles: true });
    else ev = { type: name, detail: detail, bubbles: true };
    container.dispatchEvent(ev);
    var on = container.__forestOn;                    // convenience handler map (optional)
    if (on && typeof on[name] === "function") on[name](detail);
  }

  function tabCapOf(node, stop) {
    var tab = closest(node, function (n) { return classOf(n).indexOf("tab--") !== -1 && hasAttr(n, "data-capability"); }, stop);
    return tab ? attr(tab, "data-capability") : null;
  }
  function tabIsPinned(node, stop) {
    var tab = closest(node, function (n) { return classOf(n).indexOf("tab--") !== -1; }, stop);
    return tab ? classOf(tab).indexOf("tab--pinned") !== -1 : false;
  }

  /* ---- drag-to-reorder (note #4) ------------------------------------------- *
   * Written against className directly, not classList: this file has never used  *
   * classList and several of the shell's DOM doubles do not implement it. One    *
   * vocabulary, no new dependency on the double.                                */
  function addClass(n, c) {
    if (!n || classOf(n).split(/\s+/).indexOf(c) !== -1) return;
    n.className = (classOf(n) + " " + c).trim();
  }
  function removeClass(n, c) {
    if (!n) return;
    n.className = classOf(n).split(/\s+/).filter(function (x) { return x && x !== c; }).join(" ");
  }
  // A tab node is draggable iff render() PUT the attribute there — i.e. iff the config
  // is unlocked. The fence reads the same rendered truth the affordance does (the
  // addIsLocked idiom), so a synthetic dragstart on a locked strip is refused too.
  function tabIsDraggable(tab) { return !!tab && attr(tab, "draggable") === "true"; }
  function isPinnedNode(n) { return classOf(n).indexOf("tab--pinned") !== -1; }
  // The tab BUTTON under an event target (the pin/close spans live inside it).
  function dragTabOf(node, container) {
    return closest(node, function (n) {
      return classOf(n).indexOf("tab--") !== -1
        && classOf(n).indexOf("tab--add") === -1
        && hasAttr(n, "data-capability");
    }, container);
  }
  function tabNodeOf(container, cap) {
    var tabs = tabButtons(container);
    for (var i = 0; i < tabs.length; i++) if (attr(tabs[i], "data-capability") === cap) return tabs[i];
    return null;
  }
  // The dragged tab's OWN tier, in render order. Reorder is WITHIN a tier — crossing
  // the pinned/open line is pin/unpin, a different verb, and viewConfig.reorder cannot
  // express it. A cross-tier drop is refused, not silently coerced.
  function tierOf(container, tab) {
    var pinnedFlag = isPinnedNode(tab);
    return tabButtons(container).filter(function (n) { return isPinnedNode(n) === pinnedFlag; });
  }
  function endDrag(container) {
    var tabs = tabButtons(container);
    for (var i = 0; i < tabs.length; i++) {
      removeClass(tabs[i], "tab--dragging");
      removeClass(tabs[i], "tab--drop-target");
    }
    container.__forestDrag = null;
  }

  /* ---- FLIP settle (note #4's missing beat) -------------------------------- *
   * The calendar has this beat (calendar-renderer.js flipReschedule); the strip *
   * lacked it, so a reordered tab TELEPORTED to its new slot instead of sliding *
   * — the change-blindness discontinuity the Carry-Agnostic Feel Contract       *
   * (internal §2) names as the strip's one real   *
   * delta. This is flipReschedule GENERALIZED to the strip's className idiom:    *
   * classList-OPTIONAL by construction (it uses addClass/removeClass, never      *
   * .classList — several of the shell's DOM doubles do not implement it, §3).   *
   *                                                                             *
   * The settle spans the emit->host->re-render cycle (cistern SLOT 1, option a): *
   * the strip captures the dragged tab's FIRST rect at drop (BEFORE the host     *
   * reorders + re-renders), stashes it on the container, and runs the invert +   *
   * transition on the strip's NEXT render() — so the whole FLIP stays inside the *
   * strip module and shell-boot is untouched. Carry-agnostic: nothing here reads *
   * the native drag event; a mousemove carry would drive the identical beat.    */
  function prefersReducedMotion(doc) {
    try {
      var w = doc && (doc.defaultView || (typeof window !== "undefined" ? window : null));
      return !!(w && w.matchMedia && w.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (_) { return false; }
  }
  function rectOf(node) {
    if (!node || typeof node.getBoundingClientRect !== "function") return null;
    try { return node.getBoundingClientRect(); } catch (_) { return null; }
  }
  // Capture the dragged tab's FIRST rect (keyed by capability) so the strip's next
  // render() can FLIP it from here to its new slot. No geometry (the harness) -> the
  // stash carries a null rect and the settle degrades to a plain repaint, never throws.
  function armFlip(container, cap, srcTab) {
    container.__forestFlip = { cap: cap, firstRect: rectOf(srcTab) };
  }
  // PLACE — run on the re-rendered strip. Find the moved tab by capability in the NEW
  // strip, invert to its old position, then transition to identity so the eye binds the
  // old-slot tab and new-slot tab as ONE moving object (phi phenomenon) instead of a
  // teleport. Under reduced motion — or a document without geometry — it just no-ops and
  // leaves the already-repainted strip in place. Mirrors calendar flipReschedule 819.
  function settleFlip(container) {
    var pending = container.__forestFlip;
    container.__forestFlip = null;              // consume once — a stale stash never re-fires
    if (!pending || !pending.firstRect) return;
    var doc = container.ownerDocument;
    if (prefersReducedMotion(doc)) return;      // reduced-motion collapses the settle
    var node = tabNodeOf(container, pending.cap);
    if (!node || typeof node.getBoundingClientRect !== "function" || !node.style) return;
    var last = rectOf(node);
    if (!last) return;
    var dx = pending.firstRect.left - last.left, dy = pending.firstRect.top - last.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;   // no real move -> no animation
    addClass(node, "tab--settling");
    node.style.transition = "none";
    node.style.transform = "translate(" + dx + "px," + dy + "px)";
    void node.getBoundingClientRect();          // reflow so the inverted position is frame 1
    node.style.transition = "transform 150ms cubic-bezier(0.2, 0.8, 0.2, 1)";
    node.style.transform = "translate(0, 0)";
    var clear = function () {
      node.style.transition = ""; node.style.transform = "";
      removeClass(node, "tab--settling");
      if (node.removeEventListener) node.removeEventListener("transitionend", clear);
    };
    if (node.addEventListener) node.addEventListener("transitionend", clear);
    if (typeof setTimeout === "function") setTimeout(clear, 240);   // safety net
  }

  /* ========================================================================= *
   *  THE RENAME (item 3 slice B)                                              *
   * ========================================================================= *
   * Slice A built the store and the fold: viewConfig.tabLabels holds the owner's
   * chosen name, stripModel layers it over the derived one, and the label is in
   * signature() so a rename actually repaints. This is the surface that writes it.
   *
   * THE EDITABLE IS THE LABEL ITSELF — contenteditable toggled on the span that is
   * already there, not a new input mounted over it. Three reasons, in the order they
   * decided it:
   *
   *   1. GEOMETRY. `.tabstrip` is flex-wrap and `align-items: flex-end`, so the flex
   *      LINE's cross size is its tallest item and ANY child that grows drags every
   *      tab bottom off item 5's hairline (measured on this line: a 42px child moved
   *      them 46.00 -> 58.00, and nothing threw). A new element is a new box to get
   *      wrong. The existing span, given no padding and no border, is not.
   *   2. VALIDITY. `<button>` forbids INTERACTIVE content descendants — an <input>
   *      inside a tab is invalid HTML and behaves badly (the button eats the click).
   *      `contenteditable` does not make an element interactive content, so a
   *      contenteditable <span> inside a button is legal.
   *   3. IDIOM. `.tab__pin` and `.tab__close` are already spans inside the button that
   *      stopPropagation so the button does not also fire. The editable is the third
   *      member of a family this file already has, not a fourth kind of thing.
   *
   * The belt-and-braces on (1): `.tab` declares `height: var(--tab-h)` with
   * border-box, so a taller descendant cannot push the button's own box in the first
   * place. That is the belt. The no-padding/no-border CSS is the braces. The probe is
   * the proof, and on this line the probe is the only thing that has ever been right
   * about pixels. */
  var EDIT_CLASS = "tab__label--editing";
  // The SLOW double-click window (entry path c). A real double-click is the FAST pair
  // and the browser already reports it as e.detail >= 2; this gesture is deliberately
  // the OTHER side of that line, which is exactly why it cannot ride `dblclick` and
  // has to time itself. Below SLOW_MIN it is a double-click; above SLOW_MAX it is two
  // unrelated clicks and renaming would be a surprise.
  var SLOW_MIN_MS = 500;
  var SLOW_MAX_MS = 2500;

  function nowMs() { return Date.now ? Date.now() : new Date().getTime(); }

  function labelNodeOf(node, container) {
    return closest(node, function (n) { return hasAttr(n, "data-label"); }, container);
  }
  // The label is a direct child of the tab button, so the childNodes scan is a complete
  // fallback, not a partial one — it is here for shims without querySelector, never as
  // a guess about depth.
  function labelInTab(tab) {
    if (!tab) return null;
    if (tab.querySelector) { try { var q = tab.querySelector("[data-label]"); if (q) return q; } catch (x) {} }
    var kids = tab.childNodes || [];
    for (var i = 0; i < kids.length; i++) if (hasAttr(kids[i], "data-label")) return kids[i];
    return null;
  }
  function tabIsActive(node, container) {
    var tab = closest(node, function (n) { return hasAttr(n, "data-capability"); }, container);
    return !!tab && classOf(tab).indexOf("tab--active") !== -1;
  }
  function renameState(container) { return container.__forestRename || null; }

  function beginRename(container, labelNode) {
    if (!labelNode) return false;
    var st = renameState(container);
    if (st && st.node === labelNode) return true;      // already editing this one
    // THE FENCE, and it is a real one. `contenteditable` is the affordance; this is the
    // wall a synthetic event, a keyboard route or a test double has to hit too — the
    // same affordance/fence split the "+" already runs (`disabled` vs the handler guard).
    // A locked config freezes tab editing, and renaming a tab is tab editing. The host
    // gates it again on the write side; neither gate is the other's excuse.
    if (container.__forestLocked) return false;
    var tab = closest(labelNode, function (n) { return hasAttr(n, "data-capability"); }, container);
    var cap = attr(tab, "data-capability");
    if (!cap) return false;
    if (st) endRename(container, true);                // moving the edit COMMITS the last one
    container.__forestRename = { cap: cap, node: labelNode, original: String(labelNode.textContent || "") };
    labelNode.contentEditable = "true";
    if (labelNode.setAttribute) labelNode.setAttribute("contenteditable", "true");
    addClass(labelNode, EDIT_CLASS);
    // Best-effort only, and deliberately not load-bearing: focus/selection are browser
    // behaviours a shim does not have, so the state machine above is driven by events
    // and explicit state, never by "is this focused?". A shim that no-ops focus() still
    // exercises the real path.
    try { if (labelNode.focus) labelNode.focus(); } catch (x) {}
    try {
      var doc = labelNode.ownerDocument;
      var view = doc && doc.defaultView;
      if (view && view.getSelection && doc.createRange) {
        var r = doc.createRange(); r.selectNodeContents(labelNode);
        var sel = view.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      }
    } catch (x2) {}
    return true;
  }

  function endRename(container, commit) {
    var st = renameState(container);
    if (!st) return null;
    container.__forestRename = null;
    var node = st.node;
    var raw = node ? String(node.textContent == null ? "" : node.textContent) : "";
    if (node) {
      node.contentEditable = "false";
      if (node.removeAttribute) node.removeAttribute("contenteditable");
      removeClass(node, EDIT_CLASS);
    }
    if (!commit) { if (node) node.textContent = st.original; return null; }
    var next = raw.replace(/\s+/g, " ").trim();
    // A CLEARED FIELD IS A REAL COMMIT, not an empty one. viewConfig.setTabLabel deletes
    // the entry on "" and the fold falls back to labelFor(), which is what makes "clear
    // it and press Return" mean revert — so "" must reach the host, and the guard below
    // must only swallow the case where the owner changed NOTHING.
    if (next === st.original) return null;
    emit(container, "forest:tab-rename", { capability: st.cap, label: next });
    return next;
  }

  function wire(container) {
    if (container.__forestWired) return;              // delegation: wire ONCE, survives re-render
    container.__forestWired = true;

    container.addEventListener("click", function (e) {
      var t = e.target;
      if (closest(t, function (n) { return hasAttr(n, "data-close"); }, container)) {
        var capC = tabCapOf(t, container); if (capC) emit(container, "forest:tab-close", { capability: capC });
        if (e.stopPropagation) e.stopPropagation(); return;
      }
      if (closest(t, function (n) { return hasAttr(n, "data-pin"); }, container)) {
        var capP = tabCapOf(t, container);
        if (capP) emit(container, tabIsPinned(t, container) ? "forest:tab-unpin" : "forest:tab-pin", { capability: capP });
        if (e.stopPropagation) e.stopPropagation(); return;
      }
      var addC = closest(t, function (n) { return hasAttr(n, "data-add"); }, container);
      if (addC) { if (!addIsLocked(addC)) emit(container, "forest:tab-open-catalog", {}); return; }

      /* THE RENAME ENTRY PATHS (item 3 slice B), two of the three. (a) is keyboard and
         lives in the keydown handler below.
           (b) PLAIN DOUBLE-CLICK — the browser reports the fast pair as e.detail >= 2.
           (c) SLOW DOUBLE-CLICK — two clicks on an ALREADY-SELECTED tab separated by
               MORE than the double-click threshold. This is the Finder gesture, and it
               is emphatically NOT `dblclick`: dblclick fires on the fast pair, so the
               slow one has to time itself off the previous click. It requires the tab
               to be active already, because on an INACTIVE tab the first click means
               "select this" and a second click a second later means "I meant it" —
               renaming there would punish a hesitant click. */
      var lab = labelNodeOf(t, container);
      var stC = renameState(container);
      if (stC && lab && stC.node === lab) {            // clicks inside the open editor
        if (e.stopPropagation) e.stopPropagation();     // belong to the editor, not the tab
        return;
      }
      if (lab) {
        var capL = tabCapOf(lab, container);
        var at = nowMs();
        var gap = at - (container.__forestClickAt || 0);
        var fast = !!(e && typeof e.detail === "number" && e.detail >= 2);
        var slow = container.__forestClickCap === capL &&
                   gap > SLOW_MIN_MS && gap < SLOW_MAX_MS &&
                   tabIsActive(lab, container);
        container.__forestClickAt = at;
        container.__forestClickCap = capL;
        if ((fast || slow) && beginRename(container, lab)) {
          if (e.stopPropagation) e.stopPropagation();   // do NOT also select the tab
          prevent(e);
          return;
        }
      }

      var capS = tabCapOf(t, container);
      if (capS) emit(container, "forest:tab-select", { capability: capS });
    });

    container.addEventListener("keydown", function (e) {
      var key = e.key;

      /* WHILE AN EDIT IS OPEN, THE EDITOR OWNS THE KEYBOARD. This block runs first and
         returns unconditionally, which is the point: without it ArrowLeft/ArrowRight
         would fall through to the roving-focus branch below and move FOCUS TO ANOTHER
         TAB while the owner was trying to move the CARET — destroying the edit with a
         keystroke that in every text field on earth means "back one character".
         Enter commits, Escape discards, and Escape is the ONLY discard. */
      var stK = renameState(container);
      if (stK) {
        if (key === "Enter") { endRename(container, true); prevent(e); if (e.stopPropagation) e.stopPropagation(); return; }
        if (key === "Escape" || key === "Esc") { endRename(container, false); prevent(e); if (e.stopPropagation) e.stopPropagation(); return; }
        return;
      }

      var tabs = tabButtons(container);
      var cur = activeIndex(tabs);
      // Enter/Space on the custom controls (spans with role=button)
      if (key === "Enter" || key === " " || key === "Spacebar") {
        var t = e.target;
        if (hasAttr(t, "data-close")) { var c1 = tabCapOf(t, container); if (c1) { emit(container, "forest:tab-close", { capability: c1 }); prevent(e); } return; }
        if (hasAttr(t, "data-pin"))   { var c2 = tabCapOf(t, container); if (c2) { emit(container, tabIsPinned(t, container) ? "forest:tab-unpin" : "forest:tab-pin", { capability: c2 }); prevent(e); } return; }
        if (hasAttr(t, "data-add"))   { if (!addIsLocked(t)) emit(container, "forest:tab-open-catalog", {}); prevent(e); return; }
        /* (a) SELECTED + RETURN -> rename. This must run BEFORE the `return` below and
           must swallow the key, because a real <button> fires CLICK on Enter and that
           click SELECTS — so an unswallowed Enter would open the editor and then
           immediately re-select the tab underneath it. Only on the ALREADY-ACTIVE tab:
           on an inactive one Enter still means "go there", which is the whole reason
           the roving tabindex exists. */
        if (key === "Enter" && hasAttr(t, "data-capability") && tabIsActive(t, container)) {
          if (beginRename(container, labelInTab(t))) {
            prevent(e); if (e.stopPropagation) e.stopPropagation(); return;
          }
        }
        return; // a real <button> tab fires click itself
      }
      if (!tabs.length) return;
      // reorder within tier: Ctrl/Meta + Arrow
      if ((e.ctrlKey || e.metaKey) && (key === "ArrowRight" || key === "ArrowLeft")) {
        var here = tabs[cur < 0 ? 0 : cur];
        var cap = here && attr(here, "data-capability");
        if (cap) {
          var pinnedFlag = classOf(here).indexOf("tab--pinned") !== -1;
          var tier = tabs.filter(function (n) { return (classOf(n).indexOf("tab--pinned") !== -1) === pinnedFlag; });
          var idxInTier = tier.indexOf(here);
          var next = idxInTier + (key === "ArrowRight" ? 1 : -1);
          if (next >= 0 && next < tier.length) emit(container, "forest:tab-reorder", { capability: cap, newIndexInTier: next });
        }
        prevent(e); return;
      }
      // roving focus: Arrow / Home / End
      var target = -1;
      if (key === "ArrowRight") target = (cur + 1 + tabs.length) % tabs.length;
      else if (key === "ArrowLeft") target = (cur - 1 + tabs.length) % tabs.length;
      else if (key === "Home") target = 0;
      else if (key === "End") target = tabs.length - 1;
      if (target >= 0) { moveFocus(tabs, target); prevent(e); }
    });

    /* ---- the mouse path: drag to reorder (note #4) -------------------------- *
     * Delegated on the container, wired once, survives re-render — same contract *
     * as click/keydown above. The strip stays a PURE FOLD: it emits              *
     * forest:tab-reorder and touches no config. The dragged capability is held   *
     * on the container (__forestDrag), never read back out of dataTransfer —     *
     * dataTransfer is set only because Firefox will not START a drag without     *
     * setData, and its contents are not load-bearing anywhere.                   */
    container.addEventListener("dragstart", function (e) {
      var tab = dragTabOf(e.target, container);
      if (!tabIsDraggable(tab)) {                 // locked, or not a tab -> no drag begins
        if (e.preventDefault) e.preventDefault();
        return;
      }
      var cap = attr(tab, "data-capability");
      if (!cap) { if (e.preventDefault) e.preventDefault(); return; }
      container.__forestDrag = cap;
      if (e.dataTransfer) {
        try {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", cap);   // Firefox: no setData, no drag
        } catch (_) { /* a double without dataTransfer is fine — the payload is ours */ }
      }
      addClass(tab, "tab--dragging");
    });

    container.addEventListener("dragover", function (e) {
      var cap = container.__forestDrag;
      if (!cap) return;                                  // not our drag (a file, a link, ...)
      var over = dragTabOf(e.target, container);
      var src = tabNodeOf(container, cap);
      if (!over || !src) return;
      if (isPinnedNode(over) !== isPinnedNode(src)) return;   // cross-tier: NOT a drop target
      // preventDefault on dragover is what MAKES a node a drop target. Without it the
      // browser refuses the drop and no `drop` event ever fires. This line is the feature.
      if (e.preventDefault) e.preventDefault();
      if (e.dataTransfer) { try { e.dataTransfer.dropEffect = "move"; } catch (_) {} }
      var tabs = tabButtons(container);
      for (var i = 0; i < tabs.length; i++) removeClass(tabs[i], "tab--drop-target");
      if (over !== src) addClass(over, "tab--drop-target");
    });

    container.addEventListener("drop", function (e) {
      var cap = container.__forestDrag;
      if (!cap) return;
      if (e.preventDefault) e.preventDefault();
      var over = dragTabOf(e.target, container);
      var src = tabNodeOf(container, cap);
      endDrag(container);                                // paint down before we emit
      if (!over || !src || over === src) return;
      // Cross-tier refusal, stated twice on purpose — and the mutation battery says so:
      // removing THIS line alone stays green (M3), removing the `idx < 0` return alone
      // stays green (M3c), removing BOTH goes red (M3b). Each half is independently
      // sufficient; neither is uniquely load-bearing. That is belt-and-braces, not dead
      // code — but it is recorded here rather than left to a comment implying this line
      // is the one holding the gate. (Last session shipped a redundant term labelled
      // load-bearing and only found out by running the mutation. Run the mutation.)
      if (isPinnedNode(over) !== isPinnedNode(src)) return;
      var targetCap = attr(over, "data-capability");
      if (!targetCap || targetCap === cap) return;
      // newIndexInTier is the target's index in the tier as it stands NOW (before the
      // move). viewConfig.reorder splices the dragged tab OUT first and inserts at that
      // index, which yields the browser-tab semantics both directions: drag right onto a
      // later tab -> land after it; drag left onto an earlier tab -> take its place and
      // push it right. Identical convention to the keyboard path's idxInTier ± 1.
      var idx = tierOf(container, src).indexOf(over);
      if (idx < 0) return;
      // Capture the FIRST rect (src is still in its old slot) BEFORE we emit — the host
      // will reorder the config and re-render the strip, and the strip's next render()
      // reads this stash to FLIP the tab from here to its new slot (option (a): the FLIP
      // stays inside the strip; shell-boot is untouched).
      armFlip(container, cap, src);
      emit(container, "forest:tab-reorder", { capability: cap, newIndexInTier: idx });
    });

    // A drag abandoned outside the strip (Esc, off-window, onto a non-target) still has
    // to clear the paint — dragend always fires on the source, drop does not.
    container.addEventListener("dragend", function () { endDrag(container); });

    /* CLICKING AWAY KEEPS THE NAME. That is the Finder contract and the one every
       inline rename on the desktop follows: blur commits, Escape discards, and there
       is exactly one way to throw work away. The alternative — blur discards — loses
       a name to a stray click on the pane, silently, with no undo anywhere in this
       app to get it back. */
    container.addEventListener("focusout", function (e) {
      var st = renameState(container);
      if (!st) return;
      if (e && e.target && e.target !== st.node) return;
      endRename(container, true);
    });
  }

  function prevent(e) { if (e && e.preventDefault) e.preventDefault(); }
  function tabButtons(container) {
    var strip = container.__forestStrip;
    if (!strip) return [];
    var out = [];
    (function walk(n) {
      if (!n) return;
      var kids = n.childNodes || n.children || [];
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        if (classOf(k).indexOf("tab--") !== -1 && classOf(k).indexOf("tab--add") === -1 && hasAttr(k, "data-capability")) out.push(k);
        walk(k);
      }
    })(strip);
    return out;
  }
  function activeIndex(tabs) {
    for (var i = 0; i < tabs.length; i++) if (attr(tabs[i], "tabindex") === "0") return i;
    return tabs.length ? 0 : -1;
  }
  function moveFocus(tabs, target) {
    for (var i = 0; i < tabs.length; i++) tabs[i].setAttribute("tabindex", i === target ? "0" : "-1");
    if (typeof tabs[target].focus === "function") tabs[target].focus();
  }

  /* ---- the public render — idempotent -------------------------------------- *
   * render(container, config, opts)
   *   container : the mount element (host-provided; the strip lives inside it)
   *   config    : a view-config object
   *   opts      : { active?, resolver?, weather?, on? }
   *               on = { "forest:tab-select": fn, ... } convenience handlers.
   * Returns the folded model (useful for the host + tests).                    */
  function render(container, config, opts) {
    opts = opts || {};
    var doc = container.ownerDocument;
    var model = stripModel(config, opts);
    var sig = signature(model);

    // THE LOCK, PUBLISHED TO THE FENCE. beginRename() refuses when this is true, and it
    // has to read it from somewhere that survives between renders — the delegated
    // handlers run long after this function returned. The lock is already in signature()
    // ("L"/"U"), so a lock change always reaches here rather than being short-circuited
    // away by the no-op guard below.
    container.__forestLocked = !!model.locked;

    if (opts.on) container.__forestOn = opts.on;
    wire(container);

    if (container.__forestSig === sig && container.__forestStrip) {
      container.__forestFlip = null;   // an identical fold moved nothing — drop any stale stash
      return model;                    // folds-twice-identical: no-op
    }

    var strip = buildStrip(doc, model);
    // A REBUILD DESTROYS THE EDITING NODE, so drop the handle rather than leave a
    // pointer to a detached element — endRename() would otherwise "restore" text into
    // a node no longer in the document, or commit a name off a tab that no longer
    // exists. The normal commit path already emitted before the host repainted, so
    // nothing is lost here; this is the abnormal path (a repaint from somewhere else
    // arriving mid-edit) failing safe instead of silently.
    container.__forestRename = null;
    // replace prior strip content deterministically
    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(strip);
    container.__forestStrip = strip;
    container.__forestSig = sig;

    /* REFILL THE LOCK SEAT, HERE. The rebuild above just replaced the strip
       wholesale, so the [data-lock-slot] this render created is EMPTY -- and the module
       that owns the padlock has no idea the strip re-rendered. Refilling at the call
       sites (every paintStrip() in shell-boot, every test that re-renders) is a rule
       someone eventually forgets, and forgetting it costs a lock button that vanishes
       on the first pin/close/reorder. So the refill lives at the one place the seat is
       ever rebuilt. Cold-safe: no actions module loaded -> an empty slot, exactly as
       the strip looked before this seat existed. */
    var ta = root && root.tabstripActions;   /* NB: in THIS module `root` IS window.ForestShell
                                                (tabstrip-actions.js binds `root` to window and
                                                reaches through root.ForestShell -- two modules,
                                                two conventions, one namespace). */
    if (ta && typeof ta.renderLock === "function") {
      try { ta.renderLock(doc, config, { locked: model.locked }); } catch (x) {}
    }
    // PLACE — if this render is the reorder re-render (a flip was armed at drop), settle
    // the moved tab from its old slot to its new one. Runs after the new strip is mounted
    // so the moved tab exists to measure; consumes the stash so a later render never re-fires.
    settleFlip(container);
    return model;
  }

  /* ---- export -------------------------------------------------------------- */
  root.tabStrip = {
    stripModel: stripModel,
    signature: signature,
    labelFor: labelFor,
    iconFor: iconFor,
    render: render,
    _version: "1.6" // 1.6: THE RENAME SURFACE (item 3 slice B,) -- the open-tab label becomes contenteditable IN PLACE (no new box: `.tabstrip` is flex-wrap + align-items:flex-end, so a growing child drags every tab bottom off item 5's hairline); three entry paths (active+Return, plain double-click, SLOW double-click on an already-selected tab, self-timed because dblclick fires on the fast pair); Enter commits, Escape is the only discard, blur commits (the Finder contract); the editor owns the keyboard while open so Arrow moves the caret and not the roving focus; emits forest:tab-rename, writes nothing. 1.5: THE RENAME OVERRIDE (item 3 slice A,) -- stripModel layers viewConfig.tabLabelOf over the derived labelFor and carries derivedLabel + renamed; the LABEL IS NOW IN signature or a rename would write the store, re-fold, hit the no-op guard and paint nothing. 1.4: the ADD STACK -- "+" on top, the edit-lock seated beneath it ([data-lock-slot], filled by tabstrip-actions.renderLock); refill wired at the rebuild point (operator item 4,)
  };
})();
