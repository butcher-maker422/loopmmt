/* Shea's Forest — the App Shell · shell/calendar-renderer.js
    Trio · Track CALENDAR · the calendar-* renderer family.
   Path B enrichment (+): member A of the round:pathB-enrich-1 split — port
   the loop-dashboard CalendarPanel to parity, SHELL-NATIVE (never the SPA). Chunks:
   C1 drag-to-reschedule (month) DONE; C2 week/day time-grid views — a
   scrollable hour-column grid, events placed by their DISPLAYED wall-clock minutes
   (string slice, TC-1), greedy overlap packing, a now-line, click-empty-slot → new.
   C3 event popover — a quick-action card off a time-grid block (Open /
   Edit / Delete, in-boundary). C4 recurrence label — recurrenceLabel maps
   the TOOL's already-parsed rule ({frequency,interval}) to "every week" for display
   on the popover + the record's repeats badge (a field→label lookup, NOT a parse).

   Fold-in : the loop-dashboard CalendarPanel LOOK folded into the shell's
   Grove language — the emitted .calendar-* classes are now STYLED (shell.css: month
   grid, category-colored chips, agenda, record, form), category color rides each
   chip/row's --cat edge (getCategoryColor port, DISPLAY only), and the event record
   carries a real in-boundary Edit (PATCH /api/events/:id via api.update). No box
   surgery, no runtime edit — static renderer + stylesheet only. TC-1 untouched.

   The time tree: a 2-D month grid (the sharper interior — it merges SECOND, the
   new surface, SM-6 human read). Four words in the Block Alphabet, one pane:
     • grid        — the month view from GET /api/events?from_date&to_date: a 7-col
                     weekday scaffold, N week rows of day-cells, prev/next-month nav.
                     Events are BUCKETED into cells by their start-date prefix.
     • day-cell    — one day: the date number + event chips (time · title). A chip
                     opens the event record; a busy day never lies about its count.
     • event record— the event detail from GET /api/events/:id: when / all-day /
                     location / description / category / a "repeats" badge (DISPLAY
                     only) + an actions strip (delete in-boundary; edit-form present).
     • agenda      — the 1-D forward read (GET /api/events?from_date=today): upcoming
                     events grouped by day. The list twin of the grid.

   TC-1 (thin-client — the discipline the Confluence greps for): this renderer holds
   NO calendar business logic. It does NOT expand recurrence, does NOT validate, does
   NOT compute an occurrence or an end-from-start, does NOT merge or dedup. RECURRENCE
   is the TOOL's: a range read returns already-expanded instances (the tool ran
   expandRecurrence at create). The ONLY arithmetic here is VIEW GEOMETRY — the empty
   month scaffold (which weekday the 1st sits on, how many days the month has, the
   visible from/to window). That is the calendar's shape, not the events' meaning; you
   cannot make a grid "feel like a calendar" (SM-6) without it, and it is the same class
   as laying out contact rows. Events are bucketed by a plain start_at.slice(0,10) string
   compare — never parsed, never recomputed. If you feel the urge to compute something
   ABOUT AN EVENT here (does this rule fire today? is this end valid?), it belongs in the
   tool, not the renderer.

   F3 (honest badge, both axes):
     • READ axis — a seam 503 (E_SEAM_NO_REGISTRY), a 401, or a network drop renders
       an HONEST "can't reach your calendar" pane (honestBadge 'unreachable' hollow
       ring), NEVER a fabricated-green empty month. A reached-but-empty window renders
       an HONEST "nothing scheduled" state (reached the truth; the truth is zero).
     • WRITE axis — create / delete shows saving -> saved -> (on failure) an honest
       unsaved revert. An in-flight write never renders as landed.

   Real-or-Made: this renderer never fabricates an event, a time, or an attendee — it
   paints what the tool returns and nothing more.

   Boundary (Confluence §1): owns calendar-*; EXCLUDES the person record/contacts-*,
   any forest-runtime.js edit, any mail seam. iCal import/export is a TOOL capability
   NOT yet routed on the seam (only /api/calendars + /api/events*), so the Import/Export
   affordances are rendered as HONEST deferred surfaces (disabled + a "seam route
   pending" note) and FLAGGED to the Confluence — never a silent no-op that looks live,
   never a runtime edit to add the route. The "invite a contact" surface is a J3
   merged-line weave (needs the contact record) — also honestly deferred.

   This view is ALWAYS a full pane, never a grove-compose (⊗) sub-unit — so it does
   NOT touch the shell-renderers.js :154 grove-compose sub-dispatch joint. Decided:
   full pane only (the Contact track's same call, for the same reason).

   Plain script (no ES module) — attaches to window.ForestShell.calendarRenderer and
   self-registers the "calendar" kind with window.ForestShell.pane.
   Depends on window.ForestShell.block.el (the atom) + .calendarRest + .honestBadge
   (all cold-safe: a missing dep degrades to an honest pane, never a throw). */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});
  var el = (root.block && root.block.el) || function (doc, tag, cls, attrs) {
    var n = doc.createElement(tag); if (cls) n.className = cls;
    if (attrs) for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) {
      if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]);
    }
    return n;
  };

  /* S3/A3 — paint the head title with the year dropped to --ink-soft (the .yr span).
   * Only the month-view title parses as "Month YYYY"; week/day titles are ranges/dates
   * that must render plain, so we split ONLY on a trailing 4-digit year. Used at BOTH
   * the initial build AND refreshGrid's in-place re-title, so the split survives nav
   * (a raw `.textContent =` on refresh would wipe the span). ownerDocument keeps it
   * shim-agnostic — no `doc` needed at the call site. */
  function paintTitle(node, str) {
    node.textContent = "";
    var ym = /^(.+?)\s+(\d{4})$/.exec(str);
    if (!ym) { node.textContent = str; return; }
    var d = node.ownerDocument;
    node.appendChild(d.createTextNode(ym[1] + " "));
    var yr = d.createElement("span");
    yr.className = "calendar-grid__yr";
    yr.textContent = ym[2];
    node.appendChild(yr);
  }

  var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  /* ---- VIEW GEOMETRY (the empty calendar — NOT event logic) ------------------ *
   * These build the month scaffold + the visible window. They know nothing about  *
   * any event; they are the grid's shape, the same class as a table's rows. TC-1  *
   * forbids computing about EVENTS, not drawing the calendar the events sit in.   */
  // Zero-padded YYYY-MM-DD for a (year, monthIndex0, day) — the cell's key + the
  // window bound we hand the tool. Pure string assembly, no parsing of event data.
  function ymd(y, m0, d) {
    return String(y) + "-" + String(m0 + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  }
  // The month scaffold: first-cell weekday + day count. Uses Date ONLY for the
  // empty grid geometry (a fixed function of year+month), never for an event.
  function monthShape(year, m0) {
    var first = new Date(year, m0, 1);
    var daysInMonth = new Date(year, m0 + 1, 0).getDate();
    return { firstWeekday: first.getDay(), daysInMonth: daysInMonth };
  }
  // How many week-rows a month ACTUALLY spans (4-6). The leading-blank days plus the
  // month's own days, divided into weeks and rounded up: a month whose last day lands
  // before Saturday of the fifth row needs no sixth row, and a non-leap February that
  // opens on a Sunday needs only four. The MINI calendar sizes to this honest count
  // (a phantom trailing week is a lie about the month); the BIG grid keeps GEOM.weeks,
  // because its height is a declared frame that must not flex with the month.
  function weeksInMonth(year, m0) {
    var shape = monthShape(year, m0);
    return Math.ceil((shape.firstWeekday + shape.daysInMonth) / 7);
  }
  // Walk from `node` up to (not past) `stop`, true if any element on the way carries one of
  // `classes` in its className. Shim-safe on purpose: the house test-dom has no classList and
  // no closest, so this reads the className string directly. Used to tell a BACKGROUND click
  // on a day-cell (which opens a new event) from a click that landed on a chip, the day-number,
  // or the "+N more" line — each of which owns its own action and must not also fire the cell's.
  function hitInside(node, stop, classes) {
    var n = node;
    while (n && n !== stop) {
      var cn = String(n.className || "");
      for (var i = 0; i < classes.length; i++) { if (cn.indexOf(classes[i]) >= 0) return true; }
      n = n.parentNode;
    }
    return false;
  }
  // Step the visible month by ±1, rolling the year. View nav, not event math.
  function stepMonth(year, m0, delta) {
    var m = m0 + delta, y = year;
    while (m < 0) { m += 12; y -= 1; }
    while (m > 11) { m -= 12; y += 1; }
    return { year: y, month: m };
  }
  // Today's parts, for the "today" cell highlight + the agenda's forward window.
  function todayParts() {
    var t = new Date();
    return { year: t.getFullYear(), month: t.getMonth(), day: t.getDate(),
      key: ymd(t.getFullYear(), t.getMonth(), t.getDate()) };
  }

  /* ---- small display helpers (format only — NOT business logic) -------------- */
  // The clock label for an event chip/row. Reads the tool's fields; if all_day,
  // says so; otherwise shows the wall-clock the tool already stamped. No timezone
  // math, no end-from-start — we DISPLAY start_at's time portion verbatim.
  function timeLabel(ev) {
    if (ev.all_day) return "all day";
    var s = String(ev.start_at || "");
    // start_at is "YYYY-MM-DDTHH:MM[:SS]" (tool-shaped). Show HH:MM verbatim; if the
    // shape is unexpected, show nothing rather than guess (Real-or-Made).
    var m = s.match(/T(\d{2}:\d{2})/);
    return m ? m[1] : "";
  }
  // The date-key an event belongs to: the first 10 chars of start_at. A string
  // slice, NOT a parse — the tool owns the date; we only bucket by its prefix.
  function eventDayKey(ev) { return String(ev.start_at || "").slice(0, 10); }

  /* ---- A3 * THE SPAN (owed #354's other half) -------------------------- *
   * eventDayKey() slices start_at and buckets an event to ONE day, so a five-day    *
   * trip painted a chip on its first day and VANISHED from the other four. The data *
   * was in hand the whole time: end_at is on the row and this file already reads it  *
   * (the drag handler patches it). spanOf returns the INCLUSIVE key range a bar must *
   * cover - the last day the event is actually ON.                                   *
   *                                                                                  *
   * TWO EXCLUSIVE-END NORMALIZATIONS, both display-only:                             *
   *   all_day    the calendar convention the tool carries: a ONE-day all-day event on *
   *              Jul 3 ends 2026-07-04. Its last day is the 3rd. Step back one.       *
   *   midnight   a timed event ending exactly at 00:00 ends as the next day BEGINS -  *
   *              it is not ON that day. Same step. (Google draws it through the       *
   *              previous day; a bar that ran a day long would be a visible lie.)     *
   *                                                                                  *
   * Neither computes an occurrence, expands a rule, or parses the event's instant.    *
   * They move a DISPLAY BUCKET boundary by one day - the same class as eventDayKey's  *
   * slice, and TC-1 safe for the same reason.                                         */
  // Step a DATE KEY by +/-delta days. Grid geometry over a key we assembled ourselves,
  // the same bounded Date use gridCells makes to roll a month - never event math.
  function stepKey(key, delta) {
    var y = parseInt(String(key).slice(0, 4), 10);
    var m = parseInt(String(key).slice(5, 7), 10) - 1;
    var d = parseInt(String(key).slice(8, 10), 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return key;   // unexpected shape - do not guess
    var p = stepDays(y, m, d, delta);
    return ymd(p.year, p.month, p.day);
  }
  function spanOf(ev) {
    var from = String((ev && ev.start_at) || "").slice(0, 10);
    if (from.length !== 10) return null;               // no start - nothing to place at all
    var rawEnd = String((ev && ev.end_at) || "");
    var to = rawEnd.slice(0, 10);
    if (to.length !== 10 || to < from) return { fromKey: from, toKey: from };
    if (to > from && (ev.all_day || /T00:00(:00)?/.test(rawEnd))) {
      var back = stepKey(to, -1);
      to = (back < from) ? from : back;
    }
    return { fromKey: from, toKey: to };
  }

  /* ---- A1 · THE DECLARED FRAME (the geometry, and the ONE source of it) ---- *
   * The invariant: a cell's height is an INPUT to the render, never an output of it.  *
   * Every number below is px and is written onto the grid body as a CSS custom prop   *
   * at every paint, so shell.css and this file cannot drift; shell.css carries the    *
   * same values as a DECLARED FALLBACK and calendar-renderer.test.js asserts the two  *
   * agree. `k` — chips painted in a cell — is DERIVED from these numbers. The old     *
   * `slice(0, 4)` was a magic constant: the frame guessing at itself.                 *
   * This is geometry, NOT event logic (TC-1): it decides no rule and computes no      *
   * occurrence. It answers one question — how many rows fit in a box.                 */
  var GEOM = {
    rowH:      112,   // --cal-row-h  (7rem)   the week-row / cell height
    numH:       19,   // --cal-num-h          the day-number row
    chipH:      18,   // --cal-chip-h         one chip, and the "+N more" line
    gap:         2,   // the flex gap in a cell AND between chips (shell.css: gap: 2px)
    padTop:      4,   // --s-1
    padBottom:   8,   // --s-2
    border:      1,   // the cell's bottom border (box-sizing: border-box)
    weeks:       6,   // ALWAYS six week-rows: the grid's height must not depend on the month
    spanLanes:   2    // A3 - the CAP on span-bars DRAWN in one cell. NOT a magic number, and
                      // not a taste: chipRowsAvailable(GEOM, 2) === 2, so a cell sitting under
                      // the cap ALWAYS keeps two chip-rows - room for one chip AND the "+N more"
                      // line. At four lanes it falls to 0 and the day's chips would vanish with
                      // NOTHING LEFT TO SAY SO, which this frame forbids. Spans past the cap are
                      // not dropped: they are COUNTED into "+N more" for every day they cover.
  };

  // How many chip-rows physically fit in a cell, above which sit `lanes` span-bars.
  // A1 always passes lanes = 0; A3 (span bars, owed #354) passes the real lane count.
  function chipRowsAvailable(g, lanes) {
    var L = lanes || 0;
    var avail = g.rowH - g.padTop - g.padBottom - g.border - g.numH - g.gap;
    if (L > 0) avail -= L * (g.chipH + g.gap);
    if (avail <= 0) return 0;
    // n rows occupy n*chipH + (n-1)*gap  =>  n = floor((avail + gap) / (chipH + gap))
    return Math.max(0, Math.floor((avail + g.gap) / (g.chipH + g.gap)));
  }

  // k = chips actually painted. If they all fit, k = n. If they do not, ONE row is spent
  // on the "+N more" line, so k = rows - 1. Nothing is ever cut without saying so.
  function derivedK(g, lanes, n) {
    var rows = chipRowsAvailable(g, lanes);
    if (n <= rows) return n;
    return Math.max(0, rows - 1);
  }

  /* ---- A2 · THE VISIBLE SPAN ------------------------------------------ *
   * The grid shows 42 days. It NEVER showed 42 days' worth of events, because the   *
   * query window was cut from the calendar MONTH (day 1 .. daysInMonth) while the   *
   * geometry was cut from the GRID. So the leading/trailing cells could not carry    *
   * an event even in principle — they were `null`, painted as dead space.           *
   * Same correction as the rest of the arc: derive the query FROM the geometry.     *
   * Pure view geometry (TC-1) — Date is used only to roll a month boundary, never   *
   * for an event.                                                                    */
  function gridCells(year, m0, weeks) {
    var shape = monthShape(year, m0);
    var total = (weeks || GEOM.weeks) * 7;
    var out = [];
    for (var i = 0; i < total; i++) {
      // cell i holds (day 1 of this month) + (i - firstWeekday). Negative and past-
      // the-end values roll into the adjacent month by construction.
      var p = stepDays(year, m0, 1 + (i - shape.firstWeekday), 0);
      out.push({
        y: p.year, m: p.month, d: p.day,
        key: ymd(p.year, p.month, p.day),
        adjacent: (p.month !== m0 || p.year !== year)
      });
    }
    return out;
  }

  // Write the frame onto the DOM so CSS reads the SAME numbers this file derived from.
  function declareFrame(node, g) {
    if (!node || !node.style || typeof node.style.setProperty !== "function") return false;
    node.style.setProperty("--cal-row-h", g.rowH + "px");
    node.style.setProperty("--cal-num-h", g.numH + "px");
    node.style.setProperty("--cal-chip-h", g.chipH + "px");
    return true;
  }

  /* ---- category color (DISPLAY only — ported from loop-dashboard voice.js) ---- *
   * The operator's real event categories, each with a Grove-safe hex. This is a  *
   * pure field->color lookup: it reads ev.category (a string the tool stamped)   *
   * and returns a color to paint the chip's edge. NOT event logic (TC-1) — it    *
   * decides no rule, computes no occurrence; it is the same class as coloring a   *
   * table row by its status. An unknown/empty category falls back to the accent. */
  var CATEGORY_COLORS = {
    coaching: "#0A7B7B", board: "#1A3A5C", speaking: "#C18F2B", program: "#2D7B4F",
    prospect: "#D06B30", content: "#6B4FA0", industry: "#5A6672", internal: "#8B8B8B"
  };
  function catColor(category) {
    if (!category) return "";  // empty -> the CSS --cat fallback (--sunlight/--moss) stands
    var c = CATEGORY_COLORS[String(category).toLowerCase()];
    return c || "";
  }
  // Paint an event's category color onto a node's --cat custom property (the CSS
  // consumes it for the chip/row left-edge). No-op for an unknown category, so the
  // stylesheet's honest fallback shows rather than a fabricated hue.
  function paintCat(node, ev) {
    var c = catColor(ev && ev.category);
    if (c && node.style && typeof node.style.setProperty === "function") node.style.setProperty("--cat", c);
  }

  /* ---- calendar color (DISPLAY only — the "true Google" edge, G1) ------------ *
   * A2 : calendar-color is now PRIMARY on the edge (operator ruling: *
   * "handled like Google … but we don't have to use the exact same colors").     *
   * So we do NOT paint Google's imported backgroundColor — we assign each        *
   * calendar a hue from OUR Grove palette, deterministically by a stable hash of *
   * the calendar_id, so a given calendar always reads the same color across      *
   * sessions and matches its swatch in the "My calendars" rail. Pure field->     *
   * color lookup (TC-1) — no rule, no occurrence, same class as coloring a row   *
   * by status. An UNASSIGNED event (NULL/empty calendar_id — pre-migration rows  *
   * and, until G2 ships, freshly-created ones) returns "" so the CSS neutral     *
   * fallback (--sunlight/--moss) stands: no calendar, no fabricated hue.         *
   * Grove-voice, distinct on the dark ground; not Google's raw hex. */
  var CAL_PALETTE = [
    "#3B7DD8", "#2FA6A0", "#8A5CC8", "#C9932B", "#3E9B5F",
    "#C0559B", "#5A5AD0", "#C06A3A", "#6E9B58", "#D06B7A",
    "#4AA6C9", "#B0863A"
  ];
  // Stable string hash (djb2) -> palette slot. Deterministic in the id, so the
  // same calendar keeps its hue and two different calendars almost always differ.
  function calHue(calendarId) {
    if (!calendarId) return "";              // UNASSIGNED -> neutral fallback stands
    var s = String(calendarId), h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return CAL_PALETTE[h % CAL_PALETTE.length];
  }
  // The SLOT INDEX calHue lands on for an id (calHue's index, not its hue). The
  // recolor picker needs it to mark the "current" swatch when a type has NO
  // override — its current color IS the default slot. Mirrors calHue's djb2 so
  // the marker never disagrees with the dot. -1 for unassigned (no default slot).
  function defaultSlotIndex(calendarId) {
    if (!calendarId) return -1;
    var s = String(calendarId), h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h % CAL_PALETTE.length;
  }

  /* ---- the color seam: deterministic-default + sparse-override --------------- *
   * (internal §DECIDED, color seam A) *
   * calHue above is the born-with DEFAULT ENGINE, unchanged. resolveCalColor is  *
   * the override-aware FRONT DOOR every color read goes through: when the owner   *
   * has recolored a type, its override (a Grove-palette SLOT INDEX, never a hex)  *
   * wins; otherwise calHue stands. OVERRIDES is a renderer-module value SET FROM  *
   * the loaded viewConfig.calColors at render() time (the same ctx.config +       *
   * root.viewConfig pattern the mail view uses for its view-config-derived state).*
   * COLD-SAFE: absent/empty OVERRIDES -> resolveCalColor === calHue at every site *
   * -> served behavior byte-identical to 1.27. Revert = delete the key.          */
  var OVERRIDES = {};
  function resolveCalColor(calendarId, overrides) {
    if (!calendarId) return "";                                   // unassigned -> neutral fallback (unchanged)
    if (overrides && overrides[calendarId] != null) {
      var n = CAL_PALETTE.length, i = overrides[calendarId] | 0;
      return CAL_PALETTE[((i % n) + n) % n];                      // override -> chosen Grove slot (wrap-safe, never off-brand)
    }
    return calHue(calendarId);                                   // deterministic default (unchanged)
  }
  // Paint an event's CALENDAR color onto --cat (the same left-edge var the chip/
  // row/bar CSS already consumes — zero stylesheet change). No-op when unassigned,
  // so the honest neutral fallback shows rather than a fabricated hue.
  function paintCalHue(node, ev) {
    var c = resolveCalColor(ev && ev.calendar_id, OVERRIDES);
    if (c && node.style && typeof node.style.setProperty === "function") node.style.setProperty("--cat", c);
  }

  /* ---- the honest read-failure / empty states (F3 read axis) ----------------- */
  function readFailNode(doc, env, onSealed) {
    // LEG 02b — the seal-door. A plaintext-at-rest fault (500 + E_REGISTRY_PLAINTEXT_AT_REST)
    // is a MUST-ACT state, not a reach failure: offer the migration door instead of the
    // unreachable message. Cold-safe: no registrySeal module -> falls through to the honest
    // unreachable node below, byte-identical to before. onSealed (optional) re-reads the pane.
    var rs = root.registrySeal;
    if (rs && typeof rs.needsSeal === "function" && rs.needsSeal(env)) {
      var sealWrap = el(doc, "div", "calendar-needs-seal");
      rs.renderSealPrompt(sealWrap, { doc: doc, onSealed: (typeof onSealed === "function" ? onSealed : function () {}) });
      return sealWrap;
    }
    var wrap = el(doc, "div", "calendar-unreachable");
    var hb = root.honestBadge;
    if (hb && typeof hb.render === "function") wrap.appendChild(hb.render(doc, "unreachable"));
    var msg = (env && env.status === 401)
      ? "Sign in to see your calendar."
      : (env && env.code === "E_SEAM_NO_REGISTRY")
        ? "Your calendar isn\u2019t mounted on this runtime yet."
        : "Can\u2019t reach your calendar right now.";
    wrap.appendChild(el(doc, "p", "calendar-unreachable__msg", { text: msg }));
    return wrap;
  }
  function emptyGridNote(doc) {
    return el(doc, "p", "calendar-empty", { text: "Nothing scheduled this month." });
  }

  /* ---- the RECOVERY half of the read axis --------------------------- *
   * readFailNode above is the DIAGNOSIS: it says, honestly, that we could not reach   *
   * the calendar. It was also, until now, the END of the story — the pane painted and *
   * nothing ever re-read. Calendar LOOKED better than mail only by accident: paint()   *
   * clears `body`, and the month-nav survived the wipe outside it, so a user who       *
   * happened to click "next month" resurrected the view. That is DOM scoping, not a    *
   * design. Nothing on the dead pane says so, and it evaporates at every site that     *
   * wipes `host` instead of `body`.                                                    *
   *                                                                                    *
   * paintFail hangs the same shared recovery under the same honest node: a Try again    *
   * button plus a bounded ladder against THE SAME read that just failed. Its one hard   *
   * rule is inherited, not re-implemented: a retry that resolves SIGNED-OUT stops and    *
   * hands back — a 401 is a Door, not a window, and after a runtime restart the cookie   *
   * can outlive the owner key, so a ladder that kept knocking would spin. *
   *                                                                                      *
   * Cold-safe: no reachRecovery module, or no re-read seam handed in -> the honest node   *
   * alone, byte-identical to the behaviour before this existed.                           */
  function paintFail(doc, hostNode, env, reread, repaint) {
    // LEG 02b — a seal fault must NOT enter the retry ladder: retrying a read never clears a
    // plaintext-at-rest store, only sealing does (the same reason a 401 Door stops the ladder).
    // Intercept before reachRecovery and mount the seal-door with a real re-read as onSealed.
    var rs0 = root.registrySeal;
    if (rs0 && typeof rs0.needsSeal === "function" && rs0.needsSeal(env)
        && typeof reread === "function" && typeof repaint === "function") {
      hostNode.appendChild(readFailNode(doc, env, function () {
        var p = reread();
        if (p && typeof p.then === "function") p.then(repaint); else repaint(p);
      }));
      return;
    }
    var rr = root.reachRecovery;
    if (!rr || typeof rr.attach !== "function" || typeof reread !== "function" || typeof repaint !== "function") {
      hostNode.appendChild(readFailNode(doc, env));
      return;
    }
    var handle = rr.attach(hostNode, {
      doc: doc,
      outcome: env,
      read: reread,
      classify: function (e) {
        if (e && e.ok) return "ok";
        if (e && e.status === 401) return "signed-out";   // the Door — stop, never knock
        return "unreachable";                              // Real-or-Made: ambiguity is never `ok`
      },
      failNode: function (e) { return readFailNode(doc, e || env); },
      onResolve: function (e) { repaint(e); }
    });
    if (!handle) hostNode.appendChild(readFailNode(doc, env));   // attach declined -> honest node, as before
  }

  /* ---- write-axis feedback --------------------------------------------------- */
  function flashWrite(node, ok, why) {
    node.classList.remove("is-saving");
    node.classList.add(ok ? "is-saved" : "is-unsaved");
    if (!ok && why) node.setAttribute("title", why);
    setTimeout(function () { node.classList.remove("is-saved", "is-unsaved"); }, 1600);
  }

  /* ---- P1 — the search query normalizer -------------------------------------- *
   * THE ONE THING TO UNDERSTAND HERE: the tool hands `q` straight to FTS5's        *
   * `MATCH`, and MATCH is a QUERY LANGUAGE. So every character the user types is    *
   * SYNTAX unless we make it a TERM. An apostrophe is a syntax error. So is an      *
   * unbalanced quote — which a debounced box hits on the way to every phrase you     *
   * ever type. So is a bare `-`, a stray `(`, a colon, the word AND. Un-normalised,  *
   * those don't return nothing; they THROW out of the request handler and, with no   *
   * process guard on the box, EXIT THE RUNTIME. (Proven, real server, real *
   * apostrophe. The seam now contains it as a 400; this function is why the user     *
   * shouldn't ever see that 400.)                                                    *
   *                                                                                  *
   * The rule is one sentence: THE USER TYPED TEXT, SO SEARCH FOR TEXT. Every bare    *
   * token is wrapped as an FTS5 quoted string, which makes its punctuation literal   *
   * — so `Ada's` FINDS "Ada's standup" instead of killing the box. Exactly two       *
   * things stay syntax, because both are things the user MEANT:                      *
   *   · `column:value` on a REAL column (title/description/location/category) —      *
   *     this IS P5. Categories get filtering with no category UI at all, because     *
   *     the FTS5 table already indexes the column (internal:292).      *
   *     An unreal column (`re:`) is not syntax, it is someone typing an email        *
   *     subject line, and it degrades to a literal token rather than "no such column".*
   *   · a trailing `*` — prefix search, and worth keeping: it is how you find        *
   *     "standup" by typing "stand".                                                 *
   *                                                                                  *
   * Returns null for a query with nothing searchable in it — the caller must treat   *
   * null as "don't search", never as "search for nothing".                           *
   *                                                                                  *
   * Honest ceiling: this is a NORMALIZER, not a sanitizer, and the difference        *
   * matters. It is not the security boundary — the seam's 400 is. If a future edit   *
   * lets a token through unquoted, the box still stands. Belt AND braces, on purpose:*
   * the braces are the ones holding the trousers up.                                 */
  var FTS_COLUMNS = { title: 1, description: 1, location: 1, category: 1 };
  function ftsQuery(raw) {
    if (typeof raw !== "string") return null;
    var terms = raw.trim().split(/\s+/), out = [];
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      if (!t) continue;
      var m = /^([A-Za-z_]+):(.+)$/.exec(t);
      var col = null, body = t;
      if (m && FTS_COLUMNS[m[1].toLowerCase()]) { col = m[1].toLowerCase(); body = m[2]; }
      var star = /\*$/.test(body);
      if (star) body = body.slice(0, -1);
      body = body.replace(/"/g, '""');          // "" is FTS5's escape for a quote INSIDE a string
      if (!body.length) continue;               // a lone `*` or a lone `"` carries no term
      out.push((col ? col + ":" : "") + '"' + body + '"' + (star ? "*" : ""));
    }
    return out.length ? out.join(" ") : null;   // FTS5 joins bare terms with an implicit AND
  }

  /* ---- THE HEAD (B2) — ONE builder, TWO callers ------------------------ *
   * B2's stated gate was "Today returns from any month," and §3 read as a *
   * thing to BUILD. It was not. Two heads already existed — `renderGrid` (month)   *
   * and `renderTimeGrid` (week/day) — and they had drifted in OPPOSITE directions: *
   *                                                                                *
   *   month head  : ‹ title ›  ·  + New event  ·  Import/Export .ics   (no Today)  *
   *   time head   : ‹ title ›  ·  Today  ·  + New event                (no iCal)   *
   *                                                                                *
   * NEITHER WAS A SUPERSET OF THE OTHER, and a third view (`renderAgenda`) has no  *
   * head at all. Porting `Today` by copy-paste would have closed the only VISIBLE  *
   * symptom of a three-way divergence and left the other two with no structure     *
   * that could ever notice them. (owed seq=57.)                                    *
   *                                                                                *
   * THE CAUSE, not the symptom: CALENDAR-scoped controls (+ New event, iCal) were  *
   * living inside a VIEW-scoped head. `‹ › Today` move a cursor — they belong to a *
   * view. `+ New event` and iCal do not care which view you are in. Three views,   *
   * two heads: every calendar-scoped control had to be hand-re-authored per view   *
   * or it silently went missing from that view. That is a structural guarantee of  *
   * drift, not an accident of typing.                                              *
   *                                                                                *
   * THE FIX (operator pick B — EXTRACT): one `calendarHead(doc, spec)`, and each   *
   * caller hands it an EXPLICIT, NAMED action list. The divergence between the two *
   * heads is now a DECLARED list at a call site instead of an invisible absence —  *
   * and `head-extraction.test.js` ASSERTS the exact control set of each head, so a *
   * future drift trips a test instead of going quiet for four months.              *
   *                                                                                *
   * WHAT THIS DOES *NOT* DO (and must not, silently): it does not give week/day    *
   * iCal, and it does not give agenda a head. Both are BEHAVIOUR changes — the     *
   * operator's C fork, carded and declined for this leg. The absence is now stated  *
   * at the call site and pinned by an assertion, which is the whole point of B.     *
   *                                                                                *
   * Nav closures stay with their caller (each view refreshes itself its own way —  *
   * `refreshGrid` vs `refresh`), so the §6 fence holds: `refreshGrid` is *
   * never touched, never hoisted, never exported.                                   */
  function calendarHead(doc, spec) {
    var head = el(doc, "div", "calendar-grid__head");

    /* S3(b) — LEFT zone: the view-scoped `Today` sits at the far LEFT of the head (his
     * spec), in its own NAMED slot so it can never drift back into the calendar-scoped
     * action list. Empty when the caller hands no `today`. Back-compat: a legacy caller
     * that still passes Today as `spec.actions[0]` keeps working (it just lands right).  */
    var left = el(doc, "div", "calendar-grid__left");
    if (spec.today) left.appendChild(spec.today);
    head.appendChild(left);

    /* S3(a) — CENTER zone: the ‹ month·year › triple is now a TIGHT GROUP, centered in
     * the head horizontally AND vertically (CSS). The arrows hug the title instead of
     * the title floating off to the left of a wide head. B1/B2 still hold: prev·title·
     * next in that order, month-year between the arrows — now inside `.calendar-grid__nav`. */
    var nav = el(doc, "div", "calendar-grid__nav");
    var prev = el(doc, "button", "calendar-nav calendar-nav--prev", { type: "button", "aria-label": spec.prevLabel, text: "\u2039" });
    var title = el(doc, "div", "calendar-grid__title");
    paintTitle(title, spec.title);
    var next = el(doc, "button", "calendar-nav calendar-nav--next", { type: "button", "aria-label": spec.nextLabel, text: "\u203a" });
    prev.addEventListener("click", spec.onPrev);
    next.addEventListener("click", spec.onNext);
    nav.appendChild(prev); nav.appendChild(title); nav.appendChild(next);
    head.appendChild(nav);

    /* RIGHT zone: calendar-scoped actions — EMPTY on the rail path (the rail carries
     * + New event + iCal); the §6.5 no-rail fallback head carries them here.            */
    var actions = el(doc, "div", "calendar-grid__actions");
    (spec.actions || []).forEach(function (node) { if (node) actions.appendChild(node); });
    head.appendChild(actions);

    /* Hand the title node BACK, rather than making the caller re-find by selector a
     * node this builder just created. The month view's `refreshGrid()` re-titles its
     * head IN PLACE (it repaints the body without rebuilding the chrome), so it needs
     * the node, not a query for it. Returning it is both the cleaner contract and the
     * one that does not quietly depend on a DOM method every shim happens to model. */
    return { el: head, title: title };
  }

  /* Today — VIEW-scoped: it resets the cursor and asks THIS view to repaint. The
   * caller supplies its own repaint, which is why this is safe on both heads.     */
  function actionToday(doc, state, repaint) {
    /* S3/A4 — Today as a quiet OUTLINED pill (--today), NOT accent-filled: accent stays
     * reserved for +New. The gold-hairline (--today-off) is the ONE gold tell up here —
     * it lifts only when the shown month ≠ the current month (you've navigated away).
     * syncOff() re-reads that on every repaint; the month view calls it back through the
     * returned handle after refreshGrid re-anchors state. */
    var btn = el(doc, "button", "calendar-action calendar-action--today", { type: "button", text: "Today" });
    function syncOff() {
      var t = todayParts();
      var away = (state.year !== t.year) || (state.month !== t.month);
      if (btn.classList && btn.classList.toggle) btn.classList.toggle("calendar-action--today-off", away);
      else btn.className = "calendar-action calendar-action--today" + (away ? " calendar-action--today-off" : "");
    }
    btn.addEventListener("click", function () {
      var t = todayParts();
      state.year = t.year; state.month = t.month; state.day = t.day;
      repaint();
      syncOff();
    });
    syncOff();
    btn.syncOff = syncOff;   // the view repaints state elsewhere; let it re-sync the tell
    return btn;
  }

  /* + New event — CALENDAR-scoped. It is on both heads because both heads had it,
   * not because a view needs it.                                                  */
  function actionNewEvent(doc, state, openNew) {
    var btn = el(doc, "button", "calendar-action", { type: "button", text: "+ New event" });
    btn.addEventListener("click", function () { if (typeof openNew === "function") openNew(state); });
    return btn;
  }

  /* iCal — CALENDAR-scoped, and the clearest evidence of the bug: it lives on the
   * month head ALONE for no reason anyone chose. Returns an ARRAY (import button +
   * its hidden file input + export link), or the honest deferred pair when the
   * client lacks the seam — so the badge never over-claims. Still TC-1: the client
   * never parses iCal (the tool does); export is a text download, import posts {ics}. */
  function actionsICal(doc, api, onImported) {
    if (!(api && typeof api.importICal === "function" && typeof api.exportICalUrl === "function")) {
      return [
        deferred(doc, "Import .ics", "the calendar client does not expose the iCal seam"),
        deferred(doc, "Export .ics", "the calendar client does not expose the iCal seam"),
      ];
    }
    var importBtn = el(doc, "button", "calendar-action", { type: "button", text: "Import .ics", title: "Import events from an .ics file" });
    var fileInput = el(doc, "input", "calendar-import-file", { type: "file", accept: ".ics,text/calendar" });
    if (fileInput.style) fileInput.style.display = "none";
    importBtn.addEventListener("click", function () { fileInput.click(); });
    fileInput.addEventListener("change", function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result || "");
        importBtn.disabled = true; importBtn.textContent = "Importing\u2026";
        Promise.resolve(api.importICal(text)).then(function (env) {
          importBtn.disabled = false;
          if (env && env.ok && env.data) {
            var d = env.data;
            importBtn.textContent = "Imported " + (d.imported || 0);
            importBtn.setAttribute("title", "imported " + (d.imported || 0) + " \u00B7 duplicates " + (d.duplicates || 0) + " \u00B7 skipped " + (d.skipped || 0));
            if (typeof onImported === "function") onImported();  // the newly imported events appear in the current window
          } else {
            importBtn.textContent = "Import failed";
            importBtn.setAttribute("title", (env && env.code) || ("status " + (env && env.status)));
          }
          setTimeout(function () { importBtn.textContent = "Import .ics"; }, 2400);
        });
        fileInput.value = "";  // allow re-importing the same file
      };
      reader.readAsText(f);
    });
    var exportLink = el(doc, "a", "calendar-action", {
      href: api.exportICalUrl(), download: "forest-calendar.ics",
      title: "Download your calendar as an .ics file", text: "Export .ics",
    });
    return [importBtn, fileInput, exportLink];
  }

  /* ---- THE MINI CALENDAR (B1) ----------------------------------------- *
   * A rail block. Reads `state`; a click navigates the main pane. It renders under *
   * all four views for free — the views clear `host`, this lives in `menuBody`.    *
   *                                                                                *
   * ★ THE TWO CURSORS, AND WHY THAT IS NOT THE DRIFT §3 FORBADE. *
   * §3 said the mini "must never hold its own month cursor, or the two calendars   *
   * drift and the mini-cal starts lying about where you are." The operator picked  *
   * Google's behaviour (arrows that page the mini WITHOUT moving the main pane),   *
   * which requires a second cursor. The rule is kept by SPLITTING what §3 fused:   *
   *                                                                                *
   *   `state`   THE AUTHORITY cursor. Where you ARE. The only thing that decides   *
   *             what the main pane draws, and the only thing a click here writes.  *
   *   `browse`  A DISPLAY cursor. Which month this 42-cell grid happens to show.   *
   *             It decides NOTHING. It is never read by any view, never persisted, *
   *             never handed to the tool, and never consulted by `onPick` — a      *
   *             click passes the CELL's own (y,m,d), not the browse month.         *
   *                                                                                *
   * A lie needs an ASSERTION, and `browse` makes none: the TODAY ring and the      *
   * SELECTED ring are both painted from `state`/`todayParts()`, never from browse. *
   * Page to December and the grid shows December with NOTHING selected — which is  *
   * true: you are not in December. The block cannot say "you are here" about a     *
   * month you are not in, because it has no ink that says that.                    *
   *                                                                                *
   * And `sync()` is the ratchet: ANY move of the authority cursor snaps `browse`   *
   * back onto it. The mini can wander. It cannot wander AWAY FROM YOU and stay     *
   * there — the next thing you do in the main pane hauls it home.                  *
   *                                                                                *
   * No new date math: `gridCells` (A2) already yields the 6x7 window with adjacent *
   * months flagged — the leading 28-30 and trailing 1-8 in the operator's shot.    */
  function miniCalendar(doc, state, onPick) {
    var browse = { year: state.year, month: state.month };   // DISPLAY ONLY (see above)

    var wrap = el(doc, "div", "calendar-mini", { "data-rail-group": "mini" });

    var head = el(doc, "div", "calendar-mini__head");
    var title = el(doc, "div", "calendar-mini__title");
    var prev = el(doc, "button", "calendar-mini__nav", { type: "button", "aria-label": "Previous month", text: "\u2039" });
    var next = el(doc, "button", "calendar-mini__nav", { type: "button", "aria-label": "Next month", text: "\u203a" });
    head.appendChild(title); head.appendChild(prev); head.appendChild(next);
    wrap.appendChild(head);

    var dows = el(doc, "div", "calendar-mini__weekdays");
    WEEKDAYS.forEach(function (w) {
      dows.appendChild(el(doc, "div", "calendar-mini__weekday", { text: w.charAt(0) }));
    });
    wrap.appendChild(dows);

    var body = el(doc, "div", "calendar-mini__body");
    wrap.appendChild(body);

    function paint() {
      title.textContent = MONTHS[browse.month] + " " + browse.year;
      body.textContent = "";                       // the faithful shim DESTROYS the subtree
      var t = todayParts();
      // Size the mini to the month it is showing — five rows for July 2026, four for a
      // non-leap February that opens on a Sunday, six only when the month truly needs it.
      // No phantom trailing week (the whole-next-month row the operator flagged).
      gridCells(browse.year, browse.month, weeksInMonth(browse.year, browse.month)).forEach(function (c) {
        var isToday = (c.y === t.year && c.m === t.month && c.d === t.day);
        // SELECTED is read off the AUTHORITY cursor, never off `browse`.
        var isSel = (c.y === state.year && c.m === state.month && c.d === state.day);
        var cls = "calendar-mini__day";
        if (c.adjacent) cls += " calendar-mini__day--adjacent";
        if (isToday) cls += " calendar-mini__day--today";
        if (isSel && !isToday) cls += " calendar-mini__day--selected";
        var cell = el(doc, "button", cls, {
          type: "button", "data-date": c.key, text: String(c.d),
          "aria-label": c.key, "aria-current": isToday ? "date" : "false"
        });
        // The cell's OWN date, not the browse month — so a click is correct even on
        // an adjacent-month cell (clicking "1" in the trailing row goes to August).
        cell.addEventListener("click", function () { onPick(c.y, c.m, c.d); });
        body.appendChild(cell);
      });
    }

    // THE RATCHET. Called by render() on every authority-cursor move (the main head's
    // < >, Today, and this block's own click). Re-anchors browse; repaints the rings.
    function sync() { browse.year = state.year; browse.month = state.month; paint(); }

    prev.addEventListener("click", function () {
      var s = stepMonth(browse.year, browse.month, -1);
      browse.year = s.year; browse.month = s.month; paint();     // browse ONLY. state untouched.
    });
    next.addEventListener("click", function () {
      var s = stepMonth(browse.year, browse.month, 1);
      browse.year = s.year; browse.month = s.month; paint();     // browse ONLY. state untouched.
    });

    paint();
    return { el: wrap, sync: sync, _browse: browse };
  }

  /* ---- the GRID (month) view ------------------------------------------------- *
   * `onCursor` (B1) — THE SEAM THAT WAS MISSING. The head's < > and Today *
   * move `state` and repaint THIS view; nothing told the RAIL. A mini-cal reading  *
   * `state` would render right once and then sit there showing last month. It is   *
   * the same class of bug B2 found: an invisible contract between two lines far    *
   * apart. It is a parameter now. Cold-safe: absent -> no-op, today's behaviour.   */
  /* ── Drag-reschedule reconcile (Scope A) ─────────────────────────────────────
   * After a PUT returns ok, a SINGLE-DAY move is fully known locally: the patch we
   * sent IS the server-confirmed state. So the drag views re-render from the events
   * already in hand instead of re-GETting up to 500 rows — removing ONE of the two
   * sequential round-trips a drop used to pay (the felt lag). This is NOT an optimistic
   * lie: nothing renders until the PUT confirms, and we render ONLY what the server just
   * confirmed. A start-only PUT on an event that HAS an end (multi-day, or a timed move
   * across midnight) hands the span back to the tool to re-derive — we cannot know that
   * end locally, so those cases fall back to a fresh read and never paint a guessed span.
   *
   * Mutates `ev` in place to the confirmed start (+ end when the PUT carried one).
   * Returns true  -> the local model is complete; the caller re-renders from cache (no GET).
   * Returns false -> the tool owns a re-derived end we don't hold; the caller must re-fetch. */
  function reconcileLocal(ev, patch) {
    ev.start_at = patch.start_at;
    if ("end_at" in patch) { ev.end_at = patch.end_at; return true; }  // start+end both known
    return !String(ev.end_at || "");   // start-only: complete iff there was no end to re-derive
  }

  /* ── Optimistic reschedule — the felt-lag fix ────────────────────────────────
   * Scope A removed the SECOND round-trip a drop paid (the post-drop GET). This
   * removes the FIRST: the chip no longer waits for the PUT to the remote box
   * before it moves. On a drop we paint the move IMMEDIATELY from the events
   * already in hand, fire the PUT in the background, and — only if it actually
   * FAILS — roll the event back to where it was and flash an honest failure.
   *
   * This is NOT an optimistic lie. On success the paint we already showed IS the
   * confirmed state: a single-day move is fully known locally (reconcileLocal
   * true — start+end both in the patch), so nothing is guessed. On failure the
   * event visibly RETURNS to its cell and a notice says why — the truth, shown.
   * We stay optimistic ONLY where the move is fully known; a multi-day /
   * cross-midnight move, whose server-re-derived span we cannot know, keeps the
   * old confirm-then-refetch path so no guessed span is ever painted.
   *
   *   repaintCached : () -> void | null   re-render the view from its held set (no GET); null = no cache
   *   freshRead     : () -> void          re-fetch (the honest fallback for a span we don't hold)
   *   onFail        : () -> void | undef   flashed after the revert repaint (honest failure surface) */
  function optimisticReschedule(api, ev, patch, repaintCached, freshRead, onFail) {
    var prevStart = ev.start_at, prevEnd = ev.end_at;
    if (reconcileLocal(ev, patch) && repaintCached) {   // single-day: fully known -> optimistic
      repaintCached();                                  // ← the move is on screen NOW, before the PUT
      var revert = function () {
        ev.start_at = prevStart; ev.end_at = prevEnd;   // put the event back
        repaintCached();
        if (typeof onFail === "function") onFail();
      };
      Promise.resolve(api.update(ev.id, patch)).then(function (env) {
        if (!env || !env.ok) revert();                  // server refused -> honest rollback
      }, revert);                                       // network threw -> same
    } else {
      // A span we cannot hold locally (multi-day / cross-midnight): undo the
      // speculative start mutation, wait for the tool to re-derive, then read the
      // truth. Rare, and never paints a guessed span.
      ev.start_at = prevStart; ev.end_at = prevEnd;
      Promise.resolve(api.update(ev.id, patch)).then(function (env) {
        if (env && env.ok) freshRead();
      });
    }
  }

  /* An honest, transient failure notice for a rolled-back reschedule. The event
   * has already snapped back (the visible truth); this names why so the snap-back
   * is not a mystery. View-agnostic: it needs no persistent node. */
  function flashRescheduleFail(doc) {
    if (!doc || !doc.body || typeof doc.createElement !== "function") return;
    var t = doc.createElement("div");
    t.className = "calendar-reschedule-fail";
    t.setAttribute("role", "status");
    t.textContent = "Couldn\u2019t move that event \u2014 it\u2019s back where it was.";
    doc.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2400);
  }

  /* ── The manipulation pass (grab · carry · place) — shared drag-feel helpers ───
   * Direct-manipulation feedback for drag-to-reschedule, factored so all three drag
   * surfaces (month grid, agenda, week/day time-grid) get the same felt beats through
   * the shared `optimisticReschedule` seam. Every browser-only API is GUARDED: under
   * the test harness's minimal document (no getBoundingClientRect / cloneNode /
   * elementFromPoint / body) each helper no-ops and the reschedule still works — the
   * felt layer is progressive enhancement, never a dependency. TC-1 holds: no helper
   * touches an event date; they move pixels, not meaning. */

  function prefersReducedMotion(doc) {
    try {
      var w = doc && (doc.defaultView || (typeof window !== "undefined" ? window : null));
      return !!(w && w.matchMedia && w.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (_) { return false; }
  }

  /* CARRY — a translucent, lifted clone of the picked-up element that tracks the
   * cursor (the thing in your hand). Returns { move(e), destroy() } or null. */
  function makeDragGhost(doc, sourceEl, e) {
    if (!doc || !doc.body || !sourceEl || typeof sourceEl.cloneNode !== "function") return null;
    var rect = sourceEl.getBoundingClientRect ? sourceEl.getBoundingClientRect() : null;
    var ghost = sourceEl.cloneNode(true);
    if (ghost.classList) ghost.classList.add("calendar-drag-ghost");
    else ghost.className = (ghost.className ? ghost.className + " " : "") + "calendar-drag-ghost";
    if (ghost.removeAttribute) { ghost.removeAttribute("id"); ghost.removeAttribute("data-ev-id"); }
    if (rect && ghost.style) { ghost.style.width = rect.width + "px"; ghost.style.height = rect.height + "px"; }
    var offX = rect ? (e.clientX - rect.left) : 10;
    var offY = rect ? (e.clientY - rect.top) : 10;
    doc.body.appendChild(ghost);
    function move(ev) {
      if (ghost.style) ghost.style.transform =
        "translate(" + (ev.clientX - offX) + "px," + (ev.clientY - offY) + "px) rotate(2deg) scale(1.03)";
    }
    move(e);
    return { move: move, destroy: function () { if (ghost.parentNode) ghost.parentNode.removeChild(ghost); } };
  }

  /* Locate the repainted element carrying this event id, so PLACE can FLIP it. */
  function findByEvId(root, id) {
    if (!root) return null;
    if (root.querySelectorAll) {
      var list = root.querySelectorAll("[data-ev-id]");
      for (var i = 0; i < list.length; i++) {
        if (list[i].getAttribute && list[i].getAttribute("data-ev-id") === String(id)) return list[i];
      }
      return null;
    }
    var found = null;   // harness fallback: walk children (no querySelectorAll)
    (function walk(n) {
      if (found || !n) return;
      if (n.getAttribute && n.getAttribute("data-ev-id") === String(id)) { found = n; return; }
      var kids = n.childNodes || [];
      for (var j = 0; j < kids.length; j++) walk(kids[j]);
    })(root);
    return found;
  }

  /* PLACE — the settle. FLIP the moved element from where it WAS (firstRect, captured
   * BEFORE the repaint) to where it now IS: repaint, invert to the old position, then
   * transition to identity so the eye binds old-chip and new-chip as ONE moving object
   * (phi phenomenon) instead of reading a teleport (change blindness). Under reduced
   * motion — or a document without geometry — it just repaints, instant. */
  function flipReschedule(doc, firstRect, repaint, findEl) {
    repaint();
    if (!firstRect || prefersReducedMotion(doc)) return;
    var node = (typeof findEl === "function") ? findEl() : null;
    if (!node || !node.getBoundingClientRect || !node.style) return;
    var last = node.getBoundingClientRect();
    var dx = firstRect.left - last.left, dy = firstRect.top - last.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;   // no real move -> no animation
    if (node.classList) node.classList.add("is-settling");
    node.style.transition = "none";
    node.style.transform = "translate(" + dx + "px," + dy + "px)";
    void node.getBoundingClientRect();   // reflow so the inverted position is the START frame
    node.style.transition = "transform 150ms cubic-bezier(0.2, 0.8, 0.2, 1)";
    node.style.transform = "translate(0, 0)";
    var clear = function () {
      node.style.transition = ""; node.style.transform = "";
      if (node.classList) node.classList.remove("is-settling");
      if (node.removeEventListener) node.removeEventListener("transitionend", clear);
    };
    if (node.addEventListener) node.addEventListener("transitionend", clear);
    setTimeout(clear, 240);   // safety net if transitionend never fires
  }

  /* ARIA — one polite live region per document; announces grab / move / drop so the
   * keyboard + assistive-tech path is not silent. No-ops without a body (the harness). */
  function calAnnounce(doc, msg) {
    if (!doc || !doc.body || typeof doc.createElement !== "function") return;
    var live = doc.__calLive;
    if (!live || !live.parentNode) {
      live = doc.createElement("div");
      live.className = "calendar-live";
      if (live.setAttribute) { live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite"); }
      doc.body.appendChild(live);
      doc.__calLive = live;
    }
    live.textContent = "";   // clear first so an identical message re-announces
    setTimeout(function () { live.textContent = msg; }, 10);
  }

  /* A human day label for announcements ("July 14") — from a date KEY, never an event
   * field, and with no Date construction (TC-1: the renderer does no event date math). */
  function dayLabelForKey(key) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
    if (!m) return String(key || "");
    return MONTHS[(+m[2]) - 1] + " " + (+m[3]);
  }

  function renderGrid(host, ctx, api, state, injected, openRecord, openNew, onCursor, calActions, openDay) {
    var doc = host.ownerDocument;
    host.textContent = "";

    /* THE MONTH HEAD — the shared builder, with this view's action list DECLARED.
     * `Today` is NEW here (B2's gate: "Today returns from any month"). It was
     * absent from this head and present on the time head — the drift, halved. */
    /* B1 — repaint the view AND tell the rail. The THREE sites below are exactly the
     * ones that move the cursor. THE IMPORT IS NOT ONE OF THEM: an import repaints the
     * window you are ALREADY looking at, so ringing the rail on it would tell the mini
     * "you navigated" when you did not. Under the C ruling that distinction is no longer
     * something this head has to REMEMBER — iCal is not built here at all; it is a rail
     * control, and its repaint (`reshowCurrent`) is wired once at render()'s single
     * authoring site. B2 made the distinction VISIBLE; C made it STRUCTURAL.
     * The fence holds harder than before: refreshGrid is not touched, not
     * hoisted, not exported, and now has exactly one caller inside this closure. */
    /* S3/A4 — hold the Today button so cursorMoved can re-sync its off-month gold tell
     * on EVERY move (chevron nav + Today), not just at build/click. Declared before
     * cursorMoved's body runs (only fires on user interaction), so the ref is live. */
    var monthTodayBtn;
    function cursorMoved() {
      refreshGrid();
      if (monthTodayBtn && monthTodayBtn.syncOff) monthTodayBtn.syncOff();
      if (typeof onCursor === "function") onCursor();
    }
    monthTodayBtn = actionToday(doc, state, cursorMoved);
    var head = calendarHead(doc, {
      title: MONTHS[state.month] + " " + state.year,
      prevLabel: "Previous month",
      nextLabel: "Next month",
      onPrev: function () { var s = stepMonth(state.year, state.month, -1); state.year = s.year; state.month = s.month; cursorMoved(); },
      onNext: function () { var s = stepMonth(state.year, state.month, 1); state.year = s.year; state.month = s.month; cursorMoved(); },
      // C — the head is VIEW-SCOPED and carries ONLY what moves a cursor.
      // Calendar-scoped controls arrive as a DECLARED list from the caller (empty on
      // the rail path; the New-event + iCal pair on the no-rail fallback). See the
      // scope-split note above `calendarHead`.
      today: monthTodayBtn,
      actions: (calActions || []),
    });
    var title = head.title;   // refreshGrid() re-titles in place; it needs the node itself
    host.appendChild(head.el);

    // Weekday header row
    var grid = el(doc, "div", "calendar-grid");
    var hdr = el(doc, "div", "calendar-grid__weekdays");
    WEEKDAYS.forEach(function (w, wi) { hdr.appendChild(el(doc, "div", "calendar-grid__weekday" + (wi === 0 || wi === 6 ? " is-weekend" : ""), { text: w })); });
    grid.appendChild(hdr);

    var body = el(doc, "div", "calendar-grid__body");
    grid.appendChild(body);
    host.appendChild(grid);

    // ── Drag-to-reschedule (month view) ──────────────────────────────────
    // A chip can be dragged onto another day-cell to move the event to that
    // day. TC-1: the renderer performs NO event logic — it substitutes the
    // DAY portion of start_at (the same class of edit as the in-boundary Edit
    // form) and preserves duration; the TOOL validates + persists on PUT and
    // owns recurrence/validity. The gesture is view-geometry; the event's
    // meaning stays tool-side. A failed move is honest — the event stays put,
    // no optimistic lie. Listeners live on `body` (rebuilt every renderGrid),
    // so they never leak across month/agenda toggles.
    var drag = null;            // { ev, sourceKey, startX, startY, active, el }
    var suppressClick = false;  // swallow the click that trails an active drag
    var lastEvents = null;      // the last-rendered event set — reused for a no-GET reschedule repaint
    // ── The manipulation pass — month-grid drag-feel state (grab · carry · place) ──
    var ghostCtl = null;        // the follow-ghost controller while a drag is active (CARRY)
    var dropTargetCell = null;  // the cell currently highlighted under the cursor/keyboard target
    var dragSourceCell = null;  // the ORIGIN cell of the grabbed event — the "home" mark, held for the whole drag
    var kbGrab = null;          // keyboard-grab state { ev, el, idx, srcKey } (a11y)
    var gridKeys = [];          // ordered date-keys of the rendered cells (row-major, 7/row)
    var cellByKey = {};         // date-key -> cell node, for target highlighting
    function clearDropTargetCell() {
      if (dropTargetCell && dropTargetCell.classList) dropTargetCell.classList.remove("is-drop-target");
      dropTargetCell = null;
    }
    function setDropTargetCell(node) {
      if (dropTargetCell === node) return;
      clearDropTargetCell();
      if (node && node.classList) node.classList.add("is-drop-target");
      dropTargetCell = node;
    }
    // The HOME mark — the day the grabbed event was picked up from, kept lit for the
    // whole drag so the user can see where it came from. When the grabbed event is held
    // back over home, the cell carries BOTH is-drag-source AND is-drop-target, and the
    // combined CSS rule reads "drop here = put it back, no change" (rescheduleTo no-ops
    // on a same-day drop). Independent of the drop-target mark: each clears only its own.
    function clearDragSourceCell() {
      if (dragSourceCell && dragSourceCell.classList) dragSourceCell.classList.remove("is-drag-source");
      dragSourceCell = null;
    }
    function setDragSourceCell(node) {
      if (dragSourceCell === node) return;
      clearDragSourceCell();
      if (node && node.classList) node.classList.add("is-drag-source");
      dragSourceCell = node;
    }
    function cellNodeUnder(x, y) {
      var node = (doc.elementFromPoint) ? doc.elementFromPoint(x, y) : null;
      while (node && node !== body) {
        if (node.classList && node.classList.contains("calendar-grid__cell") &&
            node.getAttribute && node.getAttribute("data-date")) return node;
        node = node.parentNode;
      }
      return null;
    }
    function cellDateUnder(x, y) {
      var node = cellNodeUnder(x, y);
      return node ? node.getAttribute("data-date") : null;
    }
    function rescheduleTo(ev, targetKey, sourceEl) {
      var sourceKey = eventDayKey(ev);
      if (!targetKey || targetKey === sourceKey) return;
      var start = String(ev.start_at || "");
      if (start.slice(0, 10) !== sourceKey) return;   // only move a date-keyed start
      // Pure string substitution of the DAY portion — the same TC-1-safe slice the
      // Edit pre-fill uses (16-char slice). No Date parse, no epoch math, no date
      // arithmetic: the renderer moves the day-bucket, the TOOL owns duration,
      // validity, and recurrence on PUT.
      var patch = { start_at: targetKey + start.slice(10) };
      var end = String(ev.end_at || "");
      if (end && end.slice(0, 10) === sourceKey) {    // same-day event: carry the end date
        patch.end_at = targetKey + end.slice(10);
      }
      // A multi-day event sends start only; the tool re-derives/validates the span.
      // Optimistic: paint the move NOW from the set in hand, confirm the PUT in the
      // background, roll back honestly on failure. Single-day moves are fully known
      // locally so nothing is guessed; a span we can't hold falls back to a refetch.
      // PLACE (the settle): capture where the chip is NOW, repaint, then FLIP it from
      // there to its new cell so the move is SEEN, not teleported. `sourceEl` is absent
      // on the test seam and under keyboard grab -> flipReschedule just repaints (instant).
      var firstRect = (sourceEl && sourceEl.getBoundingClientRect) ? sourceEl.getBoundingClientRect() : null;
      optimisticReschedule(api, ev, patch,
        (lastEvents ? function () {
          flipReschedule(doc, firstRect,
            function () { refreshGrid(lastEvents); },
            function () { return findByEvId(body, ev.id); });
        } : null),
        function () { refreshGrid(); },
        function () { flashRescheduleFail(doc); });
    }
    function endDrag(e, drop) {
      if (!drag) return;
      var d = drag; drag = null;
      body.classList.remove("is-dragging");
      if (ghostCtl) { ghostCtl.destroy(); ghostCtl = null; }             // drop the carried ghost
      if (d.el && d.el.classList) d.el.classList.remove("is-grabbed");   // un-lift the source
      clearDropTargetCell();
      clearDragSourceCell();                                             // drop the home mark
      if (d.active) {
        suppressClick = true;
        setTimeout(function () { suppressClick = false; }, 0);
        if (drop) rescheduleTo(d.ev, cellDateUnder(e.clientX, e.clientY), d.el);
      }
    }
    body.addEventListener("mousemove", function (e) {
      if (!drag) return;
      if (!drag.active) {
        var dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
        if (dx * dx + dy * dy < 25) return;   // 5px threshold: a click, not a drag
        drag.active = true;
        body.classList.add("is-dragging");
        if (drag.el && drag.el.classList) drag.el.classList.add("is-grabbed");   // GRAB: lift the source
        setDragSourceCell(cellByKey[drag.sourceKey]);                             // GRAB: mark the home day
        ghostCtl = makeDragGhost(doc, drag.el, e);                                // CARRY: the thing in your hand
      }
      if (ghostCtl) ghostCtl.move(e);                            // CARRY: the ghost follows the cursor
      setDropTargetCell(cellNodeUnder(e.clientX, e.clientY));    // CARRY: highlight the target cell
    });
    body.addEventListener("mouseup", function (e) { endDrag(e, true); });
    body.addEventListener("mouseleave", function (e) { endDrag(e, false); });
    // Exposed for tests: drive a reschedule without synthesizing pointer physics.
    body.__calReschedule = rescheduleTo;

    /* ---- the SPAN LAYER (A3) -------------------------------------------- *
     * One absolutely-positioned 7-track grid per week row, laid over the seven cells so
     * a bar can CROSS the cell borders that would otherwise chop it into blocks. The
     * tracks align with the cells by construction (same `repeat(7, 1fr)`, same box), and
     * the layer's `top` is the same three numbers the cell uses to place its own chips.
     * The layer takes no pointer events; only the bars do.
     *
     * NOT DRAGGABLE, deliberately. A chip's drag reschedules a one-day event by patching
     * start_at + end_at to a new day. Dragging a SPAN is a different operation (does it
     * move, or does it stretch?), and shipping a handle that guesses would be worse than
     * shipping none. Bars open their record; that is all they claim to do. */
    function paintSpanLayer(weekEl, segs) {
      var drawn = segs.filter(function (sg) { return sg.lane < GEOM.spanLanes; });
      if (!drawn.length) return;
      var layer = el(doc, "div", "calendar-week__spans");
      drawn.forEach(function (sg) {
        var ev = sg.ev;
        var bar = el(doc, "button", "calendar-span"
          + (sg.isTrueStart ? " calendar-span--start" : "")
          + (sg.isTrueEnd ? " calendar-span--end" : "")
          + (ev.all_day ? " is-allday" : ""),
          { type: "button", title: ev.title || "(untitled)" });
        paintCalHue(bar, ev);   // calendar color rides the bar, same --cat edge as a chip
        if (bar.style) {
          bar.style.gridColumn = (sg.startCol + 1) + " / span " + (sg.endCol - sg.startCol + 1);
          bar.style.gridRow = String(sg.lane + 1);
        }
        if (bar.setAttribute) {
          bar.setAttribute("data-lane", String(sg.lane));
          bar.setAttribute("data-cols", (sg.startCol + 1) + "-" + (sg.endCol + 1));
        }
        // The TIME rides the true start only (it is the start's fact, and a continuation
        // does not begin at it). The TITLE rides EVERY segment: a nameless bar on the second
        // week of a trip tells the user nothing, and "two bars, one event" is a rule about
        // geometry, not about withholding the name.
        if (sg.isTrueStart) {
          var t = timeLabel(ev);
          if (t && t !== "all day") bar.appendChild(el(doc, "span", "calendar-span__time", { text: t }));
        }
        bar.appendChild(el(doc, "span", "calendar-span__title", { text: ev.title || "(untitled)" }));
        bar.addEventListener("click", function () {
          if (suppressClick) return;
          if (typeof openRecord === "function") openRecord(ev);
        });
        layer.appendChild(bar);
      });
      weekEl.appendChild(layer);
    }

    function refreshGrid(cached) {
      paintTitle(title, MONTHS[state.month] + " " + state.year);
      body.textContent = "";
      // The cells are built BEFORE the fetch, because the WINDOW IS CUT FROM THEM.
      // (A2. The old code read the month and left the grid's edges permanently blind.)
      // The BIG grid now spans the month's REAL weeks (4-6), like the mini: only weeks
      // that contain a current-month day are drawn, so the phantom trailing all-next-month
      // week is gone (adjacent-month days appear ONLY where they share a week with this month).
      var cells = gridCells(state.year, state.month, weeksInMonth(state.year, state.month));
      var fromDate = cells[0].key;                    // may be in the previous month
      var toDate = cells[cells.length - 1].key;       // may be in the next month

      function paint(env) {
        body.textContent = "";
        declareFrame(body, GEOM);   // the frame is declared BEFORE any content is laid in
        if (!env.ok) {
          // The grid's re-read is the SAME query that just failed — same window, same limit.
          // Handing the ladder anything else would recover into a different month than the one
          // the user is looking at, which is a subtler lie than the dead pane it replaces.
          paintFail(doc, body, env, function () {
            return api.events({ from_date: fromDate, to_date: toDate, limit: 500 });
          }, paint);
          return;
        }
        var events = (env.data && env.data.events) || [];
        lastEvents = events;   // hold the rendered set so a confirmed reschedule can repaint without a GET

        /* A3 — SPLIT THE SET FIRST. A multi-day event is a BAR, never a chip. If it stayed
         * in the day bucket as well it would paint TWICE in every day it covers — once as a
         * bar running across, once as a chip sitting inside — and the "+N more" count under
         * it would be inflated by an event the user can already see. One event, one mark. */
        var byDay = {};   // single-day events, bucketed by day-key (the A1/A2 behaviour, kept)
        var spans = [];   // multi-day events, as inclusive {fromKey, toKey} ranges
        events.forEach(function (ev) {
          var sp = spanOf(ev);
          if (!sp) return;                        // no start_at — nothing to place (Real-or-Made)
          if (sp.fromKey === sp.toKey) { (byDay[sp.fromKey] = byDay[sp.fromKey] || []).push(ev); }
          else { spans.push({ ev: ev, fromKey: sp.fromKey, toKey: sp.toKey }); }
        });

        var today = todayParts();
        // `cells` is the month's real week span (4-6 rows x 7) computed above — every entry
        // is a REAL date, including the leading/trailing days of the adjacent months that
        // share a week with this month. There are no nulls, and no all-adjacent week.
        var week = null, weekCells = null;
        var laneOf = {};     // cell key -> L, the lane-rows RESERVED in that cell. Feeds derivedK.
        var hiddenOf = {};   // cell key -> spans over the cap: not drawn, so they are COUNTED
        var layers = [];     // the per-week overlays, appended AFTER their cells (z-order)

        // Rebuild the drag-feel index for this repaint: the cells are new nodes, so any
        // in-flight keyboard grab or highlighted target from a prior paint is stale.
        gridKeys = []; cellByKey = {}; kbGrab = null; dropTargetCell = null;

        cells.forEach(function (c, i) {
          if (i % 7 === 0) {
            week = el(doc, "div", "calendar-grid__week");
            body.appendChild(week);
            weekCells = cells.slice(i, i + 7);
            var segs = weekSpanSegments(weekCells, spans);
            layers.push({ week: week, segs: segs });
            /* Reserve the lanes BEFORE this week's cells are built — `k` DEPENDS on L, so the
             * geometry has to be settled before a single chip is laid in. A cell reserves
             * (highest DRAWN lane index over it) + 1 rows: a bar in lane 1 with nothing in
             * lane 0 still needs lane 0's row held, or it would float up and break the row's
             * alignment. Spans past the cap reserve nothing and are counted instead. */
            segs.forEach(function (sg) {
              var over = (sg.lane >= GEOM.spanLanes);
              for (var q = sg.startCol; q <= sg.endCol; q++) {
                var ck = weekCells[q].key;
                if (over) { hiddenOf[ck] = (hiddenOf[ck] || 0) + 1; }
                else if ((sg.lane + 1) > (laneOf[ck] || 0)) { laneOf[ck] = sg.lane + 1; }
              }
            });
          }
          // An adjacent-month day is DIMMED, never "today" — you are not looking at its month.
          var isToday = (!c.adjacent && c.key === today.key);
          var cell = el(doc, "div", "calendar-grid__cell"
            + (c.adjacent ? " calendar-grid__cell--adjacent" : "")
            + ((i % 7 === 0 || i % 7 === 6) ? " is-weekend" : "")
            + (isToday ? " is-today" : ""));
          if (cell.setAttribute) cell.setAttribute("data-date", c.key);   // drop target for drag-to-reschedule
          gridKeys.push(c.key); cellByKey[c.key] = cell;                   // keyboard-grab target index
          // Google's split: the NUMBER opens the day view for that day; the BOX (background)
          // opens a new event pre-populated with that day. An adjacent cell reports ITS OWN
          // date, so clicking "1" in the trailing row lands on August, not July.
          var numNode = el(doc, "div", "calendar-day__num is-open-day", { text: String(c.d) });
          if (numNode.setAttribute) numNode.setAttribute("role", "button");
          numNode.addEventListener("click", function (e) {
            if (e && e.stopPropagation) e.stopPropagation();   // do not also fire the cell's create-click
            if (suppressClick) return;
            if (typeof openDay === "function") openDay(c.y, c.m, c.d);
          });
          cell.appendChild(numNode);

          var L = laneOf[c.key] || 0;
          if (L > 0) {
            /* THE SPACER. The bars themselves cannot live in here — a cell has padding and a
             * right border, so a per-cell bar segment would read as several separated blocks
             * instead of one bar. They live in the week's overlay, which crosses those borders.
             * This block is the SPACE they occupy, declared inside the cell so the chips below
             * start where the bars end. Its height is the SAME arithmetic chipRowsAvailable()
             * subtracts: L bars and the (L-1) gaps between them. Declared, never measured. */
            var pad = el(doc, "div", "calendar-day__spanpad");
            if (pad.style) pad.style.height = (L * GEOM.chipH + (L - 1) * GEOM.gap) + "px";
            if (pad.setAttribute) pad.setAttribute("data-lanes", String(L));
            cell.appendChild(pad);
          }

          var dayEvents = byDay[c.key] || [];
          var hidden = hiddenOf[c.key] || 0;
          var n = dayEvents.length + hidden;   // everything still wanting to be SEEN in this cell
          if (n) {
            var chips = el(doc, "div", "calendar-day__chips");
            // k is DERIVED from the declared frame — and now from the REAL lane count. Lanes and
            // chips spend ONE budget: a cell under two bars has two fewer rows for its chips.
            var k = derivedK(GEOM, L, n);
            // A hidden span is NOT a chip and can never be painted as one at any k — it is a bar
            // we had no lane for. It contributes to `n` (so the frame accounts for it) and to
            // `more` (so the user is TOLD about it), never to the painted chips.
            var painted = Math.min(k, dayEvents.length);
            dayEvents.slice(0, painted).forEach(function (ev) {
              var chip = el(doc, "button", "calendar-chip" + (ev.all_day ? " is-allday" : ""),
                { type: "button", title: ev.title || "(untitled)" });
              paintCalHue(chip, ev);  // calendar color rides the chip’s left edge (display only)
              var t = timeLabel(ev);
              if (t && t !== "all day") chip.appendChild(el(doc, "span", "calendar-chip__time", { text: t }));
              chip.appendChild(el(doc, "span", "calendar-chip__title", { text: ev.title || "(untitled)" }));
              if (chip.setAttribute) chip.setAttribute("data-ev-id", ev.id);   // PLACE: FLIP finds the moved chip by this
              (function (cev, cchip) {
                cchip.addEventListener("mousedown", function (e) {
                  drag = { ev: cev, sourceKey: eventDayKey(cev), startX: e.clientX, startY: e.clientY, active: false, el: cchip };
                });
                // ── Keyboard grab (a11y): Enter/Space picks up, arrows move the target
                // day, Enter drops, Escape cancels — driving the SAME rescheduleTo path. ──
                cchip.addEventListener("keydown", function (e) {
                  var k = e.key;
                  var isEnter = (k === "Enter"), isSpace = (k === " " || k === "Spacebar");
                  if (!kbGrab) {
                    if (isEnter || isSpace) {
                      if (e.preventDefault) e.preventDefault();
                      var srcKey = eventDayKey(cev);
                      var idx = gridKeys.indexOf(srcKey);
                      if (idx < 0) return;
                      kbGrab = { ev: cev, el: cchip, idx: idx, srcKey: srcKey };
                      if (cchip.classList) cchip.classList.add("is-grabbed");
                      setDropTargetCell(cellByKey[gridKeys[idx]]);
                      setDragSourceCell(cellByKey[kbGrab.srcKey]);   // mark the home day (keyboard)
                      calAnnounce(doc, "Grabbed " + (cev.title || "event") + ". Use the arrow keys to choose a day, Enter to move, Escape to cancel.");
                    }
                    return;
                  }
                  if (kbGrab.el !== cchip) return;   // only the grabbed chip acts
                  var delta = (k === "ArrowRight") ? 1 : (k === "ArrowLeft") ? -1
                            : (k === "ArrowDown") ? 7 : (k === "ArrowUp") ? -7 : 0;
                  if (delta !== 0) {
                    if (e.preventDefault) e.preventDefault();
                    kbGrab.idx = Math.max(0, Math.min(gridKeys.length - 1, kbGrab.idx + delta));
                    setDropTargetCell(cellByKey[gridKeys[kbGrab.idx]]);
                    calAnnounce(doc, dayLabelForKey(gridKeys[kbGrab.idx]));
                    return;
                  }
                  if (isEnter || isSpace) {
                    if (e.preventDefault) e.preventDefault();
                    var g = kbGrab; kbGrab = null;
                    var targetKey = gridKeys[g.idx];
                    if (g.el.classList) g.el.classList.remove("is-grabbed");
                    clearDropTargetCell();
                    clearDragSourceCell();
                    if (targetKey && targetKey !== g.srcKey) {
                      calAnnounce(doc, "Moved to " + dayLabelForKey(targetKey));
                      rescheduleTo(g.ev, targetKey);   // no sourceEl -> instant repaint (no FLIP mid-keyboard)
                    } else {
                      calAnnounce(doc, "Left where it was.");
                    }
                    return;
                  }
                  if (k === "Escape" || k === "Esc") {
                    if (e.preventDefault) e.preventDefault();
                    var g2 = kbGrab; kbGrab = null;
                    if (g2.el.classList) g2.el.classList.remove("is-grabbed");
                    clearDropTargetCell();
                    clearDragSourceCell();
                    calAnnounce(doc, "Cancelled \u2014 the event stayed where it was.");
                  }
                });
              })(ev, chip);
              chip.addEventListener("click", function () {
                if (suppressClick) return;   // a drag just ended here — not a real click
                if (typeof openRecord === "function") openRecord(ev);
              });
              chips.appendChild(chip);
            });
            var more = n - painted;
            if (more > 0) {
              chips.appendChild(el(doc, "div", "calendar-day__more line", { text: "+" + more + " more" }));
            }
            cell.appendChild(chips);
          }
          // A click on the BOX (not a chip, the number, or "+N more") opens a new event on
          // this day — Google's behaviour. Chips/number/more each own their handler; a click
          // that landed on one of them is not a background click. A drag that just ended is
          // not a click either (suppressClick). Spans live in the week overlay, a sibling of
          // the cells, so a bar-click never reaches here at all.
          (function (cc) {
            cell.addEventListener("click", function (e) {
              if (suppressClick) return;
              if (e && e.target && hitInside(e.target, cell,
                    ["calendar-chip", "calendar-day__num", "calendar-day__more"])) return;
              if (typeof openNew === "function") {
                openNew({ year: cc.y, month: cc.m, day: cc.d, prefillKey: cc.key });
              }
            });
          })(c);
          week.appendChild(cell);
        });

        // The overlays go on LAST, so a bar sits above the cells it crosses.
        layers.forEach(function (w) { paintSpanLayer(w.week, w.segs); });
        if (!events.length) body.appendChild(emptyGridNote(doc));
      }

      if (cached) { paint({ ok: true, data: { events: cached } }); return; }   // confirmed reschedule -> no GET
      if (injected && injected.events) { paint({ ok: true, data: { events: injected.events } }); return; }
      body.appendChild(el(doc, "p", "calendar-loading", { text: "Reading your calendar\u2026" }));
      api.events({ from_date: fromDate, to_date: toDate, limit: 500 }).then(paint);
    }
    refreshGrid();
  }

  /* ---- the AGENDA (1-D forward) view ----------------------------------------- */
  /* ---- the day-grouped event list, once -------------------------------------- *
   * Lifted verbatim out of renderAgenda so SEARCH RESULTS render into THE SAME     *
   * LIST — not a popover, not an overlay, not a new surface (§3). One list *
   * renderer means a search result and an agenda row are the same object with the  *
   * same affordances, and there is no second surface to drift. The ONLY thing the  *
   * caller varies is the empty-line, because "Nothing upcoming" and "Nothing       *
   * matches" are different facts and neither may stand in for the other.           *
   *                                                                                *
   * NO COUNT. Not here, not on the results (§3.4 / -B §4 Cut 1). The *
   * renderer only ever holds a WINDOW, never the set, so a chip reading `3` would  *
   * mean "3 in the window you happen to be looking at" and would change as you     *
   * page. Mail's chip is honest because mail-model tallies a complete set. We do   *
   * not have mail's premise, so we do not get mail's chip. A windowed count is a   *
   * lie with a number on it, which is the most persuasive kind.                    */
  function paintEventGroups(doc, body, events, openRecord, emptyText, rowDrag) {
    body.textContent = "";
    if (rowDrag && rowDrag.reset) rowDrag.reset();   // fresh day-index for this repaint (manipulation pass)
    if (!events.length) { body.appendChild(el(doc, "p", "calendar-empty", { text: emptyText })); return; }
    // Group by day-key (string bucket). The tool returns them in its own order;
    // we group, we do not re-sort by computed dates (TC-1: no date math).
    var order = [], groups = {};
    events.forEach(function (ev) {
      var k = eventDayKey(ev);
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(ev);
    });
    order.forEach(function (k) {
      var day = el(doc, "div", "calendar-agenda__day");
      // The day-group is the drop target for agenda drag-to-reschedule: its date-key IS
      // the bucket. Harmless when rowDrag is absent (search reuses this list untouched).
      if (day.setAttribute) day.setAttribute("data-date", k);
      if (rowDrag && rowDrag.day) rowDrag.day(k, day);   // register the drop target for keyboard grab
      day.appendChild(el(doc, "div", "calendar-agenda__daylabel line", { text: k }));
      var ul = el(doc, "ul", "calendar-agenda__list");
      groups[k].forEach(function (ev) {
        var li = el(doc, "li", "calendar-agenda__row");
        var b = el(doc, "button", "calendar-agenda__open", { type: "button" });
        paintCalHue(b, ev);  // calendar color rides the row’s left edge (display only)
        var t = timeLabel(ev);
        b.appendChild(el(doc, "span", "calendar-agenda__time", { text: t || "" }));
        b.appendChild(el(doc, "span", "calendar-agenda__title", { text: ev.title || "(untitled)" }));
        // rowDrag is the AGENDA-only drag hook. Absent (search) -> plain open-on-click,
        // exactly as before. Present -> mousedown arms a drag (carrying the row element for
        // the lift + follow-ghost + FLIP), the row is tagged for the settle + keyboard grab,
        // and the click that trails a completed drag is swallowed (the shared suppress dance).
        if (rowDrag) {
          (function (dev, db) {
            db.addEventListener("mousedown", function (e) { rowDrag.begin(dev, e, db); });
            if (rowDrag.tag) rowDrag.tag(db, dev);
          })(ev, b);
        }
        b.addEventListener("click", function () {
          if (rowDrag && rowDrag.suppressed && rowDrag.suppressed()) return;
          if (typeof openRecord === "function") openRecord(ev);
        });
        li.appendChild(b);
        ul.appendChild(li);
      });
      day.appendChild(ul);
      body.appendChild(day);
    });
  }

  /* ---- AGENDA (C — owed seq=57 + the seq=107 defect) -------------------- *
   * ★ THIS VIEW WAS CURSOR-BLIND, AND THE MINI CALENDAR WAS LYING ON IT.           *
   *                                                                                *
   * It took no `state` and queried `from_date: todayParts().key`. So on Agenda the *
   * mini's onPick wrote the cursor, called backToView() -> showAgenda(), the list   *
   * repainted FROM TODAY, and then mini.sync() painted its selected ring on the     *
   * date you clicked. Ring on March 3; list starting today. That is precisely the   *
   * drift §3 named and B1 shipped to kill — in the one view B1 never reached.*
   * B1's own comment reads "two callers, one bug." THERE WERE THREE. Agenda was      *
   * invisible to that count because it had no cursor to notify, which is the same    *
   * shape as the head drift B2 found: an absence nothing was structured to notice.   *
   *                                                                                *
   * SO IT READS THE CURSOR. And THAT is what answers the C fork's second question   *
   * ("does agenda get a head?"): the question was unanswerable while agenda had no  *
   * cursor — `‹ ›` had no referent and `Today` was a no-op. Now it does, so it does.*
   *                                                                                *
   * THE DEFAULT DOES NOT MOVE. `state` initialises to todayParts(), so Agenda ON    *
   * OPEN is byte-identical to what it always was: the forward feed from today. It   *
   * differs only once you have deliberately moved the cursor — which is the whole   *
   * point, and is why this is not the product change it looked like from outside.   */
  function renderAgenda(host, ctx, api, state, injected, openRecord, onCursor, calActions) {
    var doc = host.ownerDocument;
    host.textContent = "";

    function repaintAgenda() {
      renderAgenda(host, ctx, api, state, injected, openRecord, onCursor, calActions);
    }
    // The head's < > and Today move the cursor; the rail must hear it. Same seam as
    // renderGrid's and renderTimeGrid's — the third caller, finally wired.
    function cursorMoved() {
      repaintAgenda();
      if (typeof onCursor === "function") onCursor();
    }
    /* < > page by MONTH, and the day is CLAMPED to the target month's length: without
     * the clamp, paging from the 31st into a 30-day month builds `2026-04-31`, an
     * unparseable from_date the tool would have to guess at. The month is the right
     * unit because it is the unit the mini pages in — the two controls stay in step. */
    function pageMonth(delta) {
      var s = stepMonth(state.year, state.month, delta);
      var last = monthShape(s.year, s.month).daysInMonth;
      state.year = s.year; state.month = s.month;
      if (state.day > last) state.day = last;
      cursorMoved();
    }
    var head = calendarHead(doc, {
      title: "From " + MONTHS[state.month] + " " + state.day + ", " + state.year,
      prevLabel: "Previous month",
      nextLabel: "Next month",
      onPrev: function () { pageMonth(-1); },
      onNext: function () { pageMonth(1); },
      today: actionToday(doc, state, cursorMoved),
      actions: (calActions || []),
    });
    host.appendChild(head.el);

    var body = el(doc, "div", "calendar-agenda__body");
    host.appendChild(body);

    /* Drag-to-reschedule in the agenda. A list has no time-grid, so this is the MONTH
     * gesture, not the week/day one: drag a row onto another day-group and the event moves
     * to THAT day, time-of-day preserved. Same TC-1 string-substitution, no Date math. The
     * reachable targets are the days already in the forward window (the ones carrying events)
     * — honest for a list: you can drop onto a day you can see. Listeners live on `body`,
     * rebuilt every renderAgenda, so they never leak across view toggles. */
    var lastAgenda = null;       // last-rendered set — reused for a no-GET reschedule repaint
    var adrag = null;            // { ev, startX, startY, active, el }
    var aSuppressClick = false;  // swallow the click that trails a completed drag
    // ── The manipulation pass — agenda drag-feel state (grab · carry · place) ──
    var aGhost = null;           // the follow-ghost while dragging a row (CARRY)
    var aDropDay = null;         // the day-group node highlighted under cursor/keyboard
    var aKbGrab = null;          // keyboard-grab state { ev, el, idx, srcKey } (a11y)
    var agKeys = [], agDayByKey = {};   // ordered visible day-keys + day-key -> group node
    function clearDropDay() {
      if (aDropDay && aDropDay.classList) aDropDay.classList.remove("is-drop-target");
      aDropDay = null;
    }
    function setDropDay(node) {
      if (aDropDay === node) return;
      clearDropDay();
      if (node && node.classList) node.classList.add("is-drop-target");
      aDropDay = node;
    }
    function agendaDayNodeUnder(x, y) {
      var node = doc.elementFromPoint ? doc.elementFromPoint(x, y) : null;
      while (node && node !== body) {
        if (node.classList && node.classList.contains("calendar-agenda__day") &&
            node.getAttribute && node.getAttribute("data-date")) return node;
        node = node.parentNode;
      }
      return null;
    }
    function agendaDayUnder(x, y) {
      var node = agendaDayNodeUnder(x, y);
      return node ? node.getAttribute("data-date") : null;
    }
    function rescheduleDay(ev, targetKey, sourceEl) {
      var startStr = String(ev.start_at || "");
      if (startStr.length < 10) return;                          // no date-keyed start -> nothing to move
      var sourceKey = startStr.slice(0, 10);
      if (!targetKey || targetKey === sourceKey) return;         // no move / same day
      var patch = { start_at: targetKey + startStr.slice(10) };  // substitute the DAY, keep the time
      var endStr = String(ev.end_at || "");
      if (endStr && endStr.slice(0, 10) === sourceKey) {         // same-day event carries its end date
        patch.end_at = targetKey + endStr.slice(10);
      }
      var firstRect = (sourceEl && sourceEl.getBoundingClientRect) ? sourceEl.getBoundingClientRect() : null;
      optimisticReschedule(api, ev, patch,
        (lastAgenda ? function () {
          flipReschedule(doc, firstRect,
            function () { paint({ ok: true, data: { events: lastAgenda } }); },
            function () { return findByEvId(body, ev.id); });
        } : null),
        function () { repaintAgenda(); },
        function () { flashRescheduleFail(doc); });
    }
    function endADrag(e, drop) {
      if (!adrag) return;
      var d = adrag; adrag = null;
      if (body.classList) body.classList.remove("is-dragging");
      if (aGhost) { aGhost.destroy(); aGhost = null; }
      if (d.el && d.el.classList) d.el.classList.remove("is-grabbed");
      clearDropDay();
      if (d.active) {
        aSuppressClick = true;
        setTimeout(function () { aSuppressClick = false; }, 0);
        if (drop) rescheduleDay(d.ev, agendaDayUnder(e.clientX, e.clientY), d.el);
      }
    }
    body.addEventListener("mousemove", function (e) {
      if (!adrag) return;
      if (!adrag.active) {
        var dx = e.clientX - adrag.startX, dy = e.clientY - adrag.startY;
        if (dx * dx + dy * dy < 25) return;                      // 5px threshold: a click, not a drag
        adrag.active = true;
        if (body.classList) body.classList.add("is-dragging");
        if (adrag.el && adrag.el.classList) adrag.el.classList.add("is-grabbed");
        aGhost = makeDragGhost(doc, adrag.el, e);
      }
      if (aGhost) aGhost.move(e);
      setDropDay(agendaDayNodeUnder(e.clientX, e.clientY));
    });
    body.addEventListener("mouseup", function (e) { endADrag(e, true); });
    body.addEventListener("mouseleave", function (e) { endADrag(e, false); });
    var rowDrag = {
      // Reset the day index for each list repaint (the day-groups are new nodes).
      reset: function () { agKeys = []; agDayByKey = {}; aKbGrab = null; clearDropDay(); },
      day: function (k, node) { agKeys.push(k); agDayByKey[k] = node; },
      begin: function (ev, e, el) { adrag = { ev: ev, startX: e.clientX, startY: e.clientY, active: false, el: el }; },
      // Tag a row for FLIP + wire its keyboard-grab (a11y). Absent on the search reuse.
      tag: function (b, ev) {
        if (b.setAttribute) b.setAttribute("data-ev-id", ev.id);
        b.addEventListener("keydown", function (e) {
          var k = e.key, isEnter = (k === "Enter"), isSpace = (k === " " || k === "Spacebar");
          if (!aKbGrab) {
            if (isEnter || isSpace) {
              if (e.preventDefault) e.preventDefault();
              var srcKey = eventDayKey(ev), idx = agKeys.indexOf(srcKey);
              if (idx < 0) return;
              aKbGrab = { ev: ev, el: b, idx: idx, srcKey: srcKey };
              if (b.classList) b.classList.add("is-grabbed");
              setDropDay(agDayByKey[agKeys[idx]]);
              calAnnounce(doc, "Grabbed " + (ev.title || "event") + ". Arrow up or down to choose a day, Enter to move, Escape to cancel.");
            }
            return;
          }
          if (aKbGrab.el !== b) return;
          var delta = (k === "ArrowDown" || k === "ArrowRight") ? 1
                    : (k === "ArrowUp" || k === "ArrowLeft") ? -1 : 0;
          if (delta !== 0) {
            if (e.preventDefault) e.preventDefault();
            aKbGrab.idx = Math.max(0, Math.min(agKeys.length - 1, aKbGrab.idx + delta));
            setDropDay(agDayByKey[agKeys[aKbGrab.idx]]);
            calAnnounce(doc, dayLabelForKey(agKeys[aKbGrab.idx]));
            return;
          }
          if (isEnter || isSpace) {
            if (e.preventDefault) e.preventDefault();
            var g = aKbGrab; aKbGrab = null;
            var targetKey = agKeys[g.idx];
            if (g.el.classList) g.el.classList.remove("is-grabbed");
            clearDropDay();
            if (targetKey && targetKey !== g.srcKey) { calAnnounce(doc, "Moved to " + dayLabelForKey(targetKey)); rescheduleDay(g.ev, targetKey); }
            else { calAnnounce(doc, "Left where it was."); }
            return;
          }
          if (k === "Escape" || k === "Esc") {
            if (e.preventDefault) e.preventDefault();
            var g2 = aKbGrab; aKbGrab = null;
            if (g2.el.classList) g2.el.classList.remove("is-grabbed");
            clearDropDay();
            calAnnounce(doc, "Cancelled \u2014 the event stayed where it was.");
          }
        });
      },
      suppressed: function () { return aSuppressClick; }
    };
    // Exposed for tests: drive a reschedule without synthesizing pointer physics.
    body.__calRescheduleDay = rescheduleDay;

    // The window is cut from the CURSOR, not from the clock. This one line is the fix.
    var from = ymd(state.year, state.month, state.day);

    function paint(env) {
      if (!env.ok) {
        body.textContent = "";
        paintFail(doc, body, env, function () { return api.events({ from_date: from, limit: 200 }); }, paint);
        return;
      }
      lastAgenda = (env.data && env.data.events) || [];   // hold the set for a no-GET reschedule repaint
      paintEventGroups(doc, body, lastAgenda, openRecord, "Nothing ahead from here.", rowDrag);
    }

    if (injected && injected.agenda) { paint({ ok: true, data: { events: injected.agenda } }); return; }
    body.appendChild(el(doc, "p", "calendar-loading", { text: "Reading ahead\u2026" }));
    api.events({ from_date: from, limit: 200 }).then(paint);
  }

  /* ---- P1 — the search RESULTS view ------------------------------------------ *
   * The same list, a different head. The head names the query back to the user     *
   * VERBATIM (what they typed, never the normalised FTS5 string — that is our       *
   * business, not theirs), so a result set is always attributable to a question.    *
   *                                                                                 *
   * F3 on the read axis: a search that FAILS renders the honest read-fail node, not  *
   * an empty list. "Nothing matched" and "the search broke" are different facts, and *
   * an empty list would quietly report the second as the first — which, on a search  *
   * over your own calendar, is the failure that teaches you to distrust the box.     */
  function renderSearch(host, ctx, api, raw, openRecord) {
    var doc = host.ownerDocument;
    host.textContent = "";
    host.appendChild(el(doc, "div", "calendar-agenda__head", { text: "Results for \u201c" + raw + "\u201d" }));
    var body = el(doc, "div", "calendar-agenda__body");
    host.appendChild(body);

    var q = ftsQuery(raw);
    if (!q) { body.appendChild(el(doc, "p", "calendar-empty", { text: "Nothing to search for." })); return; }

    body.appendChild(el(doc, "p", "calendar-loading", { text: "Searching\u2026" }));
    api.search(q).then(function (env) {
      if (!env.ok) { body.textContent = ""; body.appendChild(readFailNode(doc, env)); return; }
      paintEventGroups(doc, body, (env.data && env.data.events) || [], openRecord,
        "Nothing matches \u201c" + raw + "\u201d.");
    });
  }

  /* ---- the deferred affordance (honest, disabled) ---------------------------- */
  function deferred(doc, label, why) {
    return el(doc, "button", "calendar-action calendar-action--deferred",
      { type: "button", disabled: "disabled", title: why, text: label });
  }

  /* ---- the EVENT RECORD view ------------------------------------------------- */
  function fieldRow(doc, label, value) {
    var r = el(doc, "div", "calendar-field");
    r.appendChild(el(doc, "span", "calendar-field__label", { text: label }));
    r.appendChild(el(doc, "span", "calendar-field__value", { text: value }));
    return r;
  }
  function renderRecord(host, ctx, api, event, back, openEdit) {
    var doc = host.ownerDocument;
    host.textContent = "";
    var nav = el(doc, "button", "calendar-record__back", { type: "button", text: "\u2190 Calendar" });
    nav.addEventListener("click", function () { if (typeof back === "function") back(); });
    host.appendChild(nav);

    var head = el(doc, "div", "calendar-record__head");
    head.appendChild(el(doc, "h2", "calendar-record__title", { text: event.title || "(untitled)" }));
    // "repeats" badge — DISPLAY only, read from the tool's parsed rule; never computed.
    // C4: show the human label ("every week") when the tool's parsed rule carries it,
    // else the bare "repeats" (a field->label lookup, not a rule parse — TC-1).
    if (event.recurrence_rule_parsed || event.recurrence_rule) {
      head.appendChild(el(doc, "span", "calendar-record__repeats", { text: recurrenceLabel(event) || "repeats" }));
    }
    host.appendChild(head);

    var fields = el(doc, "div", "calendar-record__fields");
    // "when": the tool's start/end, verbatim. all_day flagged; no end-from-start math.
    var whenBits = [];
    if (event.all_day) whenBits.push("all day \u00b7 " + eventDayKey(event));
    else {
      var when = String(event.start_at || "").replace("T", " ");
      if (event.end_at) when += " \u2013 " + String(event.end_at).replace("T", " ");
      whenBits.push(when);
    }
    fields.appendChild(fieldRow(doc, "when", whenBits.join("")));
    if (event.location) fields.appendChild(fieldRow(doc, "where", event.location));
    if (event.category) fields.appendChild(fieldRow(doc, "category", event.category));
    host.appendChild(fields);

    if (event.description) {
      var notes = el(doc, "div", "calendar-record__notes");
      notes.appendChild(el(doc, "div", "calendar-record__notes-label", { text: "notes" }));
      notes.appendChild(el(doc, "p", "calendar-record__notes-body", { text: event.description }));
      host.appendChild(notes);
    }

    // E4 (read half) — the event's guests, from the tool's event.attendees (getEvent returns
    // {id, contact_id, display_name, role, status}). Rendered VERBATIM (Real-or-Made: never a
    // fabricated attendee); honest-empty when there are none. role/status show only when they
    // differ from the tool's defaults (required / needs-action), as a quiet sub-label. A linked
    // contact_id is a display marker only — the contact-record weave stays J3 (no fabricated read).
    var guests = el(doc, "div", "calendar-record__guests");
    guests.appendChild(el(doc, "div", "calendar-record__guests-label", { text: "guests" }));
    var att = event.attendees || [];
    if (!att.length) {
      guests.appendChild(el(doc, "p", "calendar-record__guests-empty line", { text: "No guests yet." }));
    } else {
      var glist = el(doc, "ul", "calendar-record__guest-list", { role: "list" });
      att.forEach(function (a) {
        var li = el(doc, "li", "calendar-record__guest");
        li.appendChild(el(doc, "span", "calendar-record__guest-name", { text: a.display_name || "(unnamed)" }));
        var meta = [];
        if (a.role && a.role !== "required") meta.push(a.role);
        if (a.status && a.status !== "needs-action") meta.push(a.status);
        if (meta.length) li.appendChild(el(doc, "span", "calendar-record__guest-meta", { text: meta.join(" \u00b7 ") }));

        /* P6 (Slice 3) — UN-INVITE. The write half's other direction, and the row's
         * own affordance rather than a mode: the thing you want to remove is the thing you
         * are pointing at, so the control lives on the row and nowhere else. One per guest.
         *
         * F3, and it is the whole design: the row is NOT removed optimistically. A guest is
         * a fact about the event, and the only thing that knows whether that fact changed is
         * the tool. So on a landed DELETE we re-READ the event and re-render from what came
         * back (identical to the invite's landing path above) — the list is always a picture
         * of the database, never a picture of what we hoped the database would do. On a write
         * that does not land we REVERT: re-enable the button, flash the failure, and leave the
         * guest exactly where they are. Removing the row first and putting it back on failure
         * would be the cheaper code and the dishonest one — for a moment the pane would assert
         * something the tool never agreed to. flag-don't-fake cuts in both directions.
         *
         * Cold-safe: an older client with no removeAttendee verb renders NO control rather
         * than a dead one (an affordance that cannot act is worse than an absent affordance). */
        if (typeof api.removeAttendee === "function" && a.id) {
          var un = el(doc, "button", "calendar-record__guest-remove", {
            type: "button", "aria-label": "Remove " + (a.display_name || "guest") + " from this event", text: "\u00d7"
          });
          un.addEventListener("click", function () {
            un.disabled = true;
            un.classList.add("is-saving");
            api.removeAttendee(event.id, a.id).then(function (env) {   // client mints the Idempotency-Key
              un.classList.remove("is-saving");
              if (env && env.ok && env.data && env.data.removed) {
                // landed — re-read the event; the guest list repaints from the tool's truth.
                api.get(event.id).then(function (g) {
                  if (g && g.ok && g.data) renderRecord(host, ctx, api, (g.data.event || g.data), back, openEdit);
                  else { un.disabled = false; flashWrite(un, false, "couldn\u2019t refresh"); }
                });
              } else {
                // REVERT: the write did not land, so the guest is still a guest. Say so.
                un.disabled = false; flashWrite(un, false, "couldn\u2019t remove");
              }
            });
          });
          li.appendChild(un);
        }
        glist.appendChild(li);
      });
      guests.appendChild(glist);
    }
    host.appendChild(guests);

    // Actions: delete is in-boundary (DELETE /api/events/:id). "Invite a contact"
    // is a J3 merged-line weave (needs the contact record) — honestly deferred.
    var strip = el(doc, "div", "calendar-record__actions");
    // Edit is in-boundary (PATCH /api/events/:id via api.update). Opens the same form
    // renderNewForm, pre-filled from this record.
    if (typeof openEdit === "function") {
      var edit = el(doc, "button", "calendar-action", { type: "button", text: "Edit" });
      edit.addEventListener("click", function () { openEdit(event); });
      strip.appendChild(edit);
    }
    // E4 (write half) — "Invite a contact" is now ENABLED: the block-2 runtime seam
    // (POST /api/events/:id/attendees) + the block-3 client (api.addAttendee) landed.
    // Clicking reveals a guest picker (contact-autocomplete.js); picking a contact names
    // them a guest via api.addAttendee, then the record re-reads + re-renders so the new
    // guest appears in the block-1 list above. flag-don't-fake: a write that does not land
    // never renders as a guest (mirrors the Delete write-axis pattern). Cold-safe: absent
    // the picker seam, the field is an honest disabled "unavailable" — never a fake.
    var invite = el(doc, "button", "calendar-action", { type: "button", text: "Invite a contact" });
    var picker = null;   // the inline picker panel, built on first click (toggle)
    invite.addEventListener("click", function () {
      if (picker) {   // second click closes the picker
        if (picker.parentNode) picker.parentNode.removeChild(picker);
        picker = null; invite.classList.remove("is-open"); return;
      }
      picker = el(doc, "div", "calendar-invite");
      var input = el(doc, "input", "calendar-invite__input field",
        { type: "text", placeholder: "Search your contacts\u2026", "aria-label": "Search contacts to invite" });
      picker.appendChild(input);
      host.appendChild(picker);   // the picker panel opens just below the actions strip
      invite.classList.add("is-open");
      var ac = (root.contactAutocomplete && typeof root.contactAutocomplete.attach === "function")
        ? root.contactAutocomplete.attach(input, {
            doc: doc,
            onPick: function (contact) {
              input.disabled = true;
              invite.classList.add("is-saving");
              api.addAttendee(event.id, { displayName: contact.display_name, contactId: contact.id })
                .then(function (env) {   // client mints the Idempotency-Key (a retried invite replays)
                  invite.classList.remove("is-saving");
                  if (env && env.ok && env.data && env.data.added) {
                    // landed — re-read the event + re-render so the guest appears (block-1 list).
                    api.get(event.id).then(function (g) {
                      if (g && g.ok && g.data) renderRecord(host, ctx, api, (g.data.event || g.data), back, openEdit);
                      else { input.disabled = false; flashWrite(invite, false, "couldn\u2019t refresh"); }
                    });
                  } else {
                    // flag-don't-fake: the write did not land — never render as a guest.
                    input.disabled = false; flashWrite(invite, false, "couldn\u2019t invite");
                  }
                });
            }
          })
        : null;
      if (!ac || !ac.wired) {   // cold-safe: no picker seam -> honest disabled input, never a fake
        input.setAttribute("disabled", "disabled");
        input.setAttribute("title", "Contact search unavailable");
      } else if (typeof input.focus === "function") { input.focus(); }
    });
    strip.appendChild(invite);
    var del = el(doc, "button", "calendar-action calendar-action--danger", { type: "button", text: "Delete" });
    del.addEventListener("click", function () {
      del.disabled = true;
      del.classList.add("is-saving");
      api.remove(event.id).then(function (env) {  // client mints the Idempotency-Key
        del.classList.remove("is-saving");
        if (env.ok) { flashWrite(del, true); if (typeof back === "function") back(); }
        else { del.disabled = false; flashWrite(del, false, "couldn\u2019t delete"); }
      });
    });
    strip.appendChild(del);
    host.appendChild(strip);
  }

  /* ---- the NEW-EVENT form (in-boundary: POST /api/events) --------------------- *
   * A minimal create surface — a calendar you can't add to isn't a calendar.      *
   * The datetime-local input hands us a wall-clock string; we send it VERBATIM as  *
   * start_at (TC-1: NO date construction — the tool validates + normalizes). A     *
   * recurrence field sends the rule as-typed; the TOOL expands it.                 */
  function renderNewForm(host, ctx, api, state, back, existing) {
    var doc = host.ownerDocument;
    var isEdit = !!(existing && existing.id);
    // SL-1 — GENESIS OPENS A PANE (internal §4; the Cruise's
    // SHAPE-LAW-BREACH grade, `cruise.py --plan plans/forest.json`). This function used to
    // open with `host.textContent = ""`: the grid — the person's whole context — was
    // DESTROYED to make one event, and a `back` callback rebuilt it. Mail had this exact bug
    // and fixed it (mail-renderer.js `openCompose`, the Gmail-style overlay); the fix never
    // crossed the suite, and nothing audited the law, so it sat in production. It is audited
    // now: the form floats OVER the live grid in a dedicated overlay, the collection stays
    // mounted beneath, and closing removes the overlay and runs the prior return.
    var overlay = el(doc, "div", "calendar-form-overlay");
    host.appendChild(overlay);
    function closeOverlay() {
      if (overlay.parentNode && typeof overlay.parentNode.removeChild === "function") {
        overlay.parentNode.removeChild(overlay);
      }
    }
    // Every return path funnels through here — remove the pane, THEN run the caller's `back`
    // (which repaints a clean grid, exactly as mail's `showList` does behind its overlay).
    function done() { closeOverlay(); if (typeof back === "function") back(); }
    // SL-3(b): the back/cancel joins the record family so the quiet-Cancel shape is uniform.
    var nav = el(doc, "button", "calendar-record__back record__action record__action--quiet", { type: "button", text: "\u2190 Calendar" });
    nav.addEventListener("click", function () { done(); });
    overlay.appendChild(nav);
    // SL-3(a): the top-× dismiss — same teardown as the back (done()). Stays INLINE, unconditional: SL-1
    // grades the record__dismiss × in the genesis function's OWN body, and it is the pane's escape hatch,
    // so it must never be load-conditional. (An earlier cut moved it into the module; the Cruise SL-1
    // audit correctly BREACHed that — the × belongs here. The genesis-dock route's true seam is the
    // minimize→dock block below, not the ×.)
    var formDismiss = el(doc, "button", "calendar-record__dismiss record__dismiss", { type: "button", "aria-label": "Close", text: "\u00d7" });
    formDismiss.addEventListener("click", function () { done(); });
    overlay.appendChild(formDismiss);
    // L3: the shared MINIMIZE→composeDock affordance — the ~20-line block hand-rolled here and identically
    // in contacts createForm, extracted to shell/genesis-dock.js (the Chalk Line's `genesis` MODULE route).
    // SL-1 untouched: `overlay` is ours (it floats OVER the live grid — the person's whole context stays
    // mounted beneath); the module only appends the minimize onto it. Cold-safe by the module (no dock ->
    // no minimize control). The back-nav above stays calendar-local; the dynamic (New/Edit) title rides
    // through to the docked tab.
    if (root.genesisDock && typeof root.genesisDock.wire === "function") {
      root.genesisDock.wire(doc, { container: overlay, kind: "calendar-record", title: (isEdit ? "Edit event" : "New event"), close: done, root: root });
    }
    overlay.appendChild(el(doc, "h2", "calendar-record__title", { text: isEdit ? "Edit event" : "New event" }));

    var form = el(doc, "div", "calendar-newform");
    var title = el(doc, "input", "calendar-newform__title field", { type: "text", placeholder: "Title", "aria-label": "Event title" });
    var start = el(doc, "input", "calendar-newform__start field", { type: "datetime-local", "aria-label": "Start" });
    var allDay = el(doc, "input", "calendar-newform__allday", { type: "checkbox", id: "cal-allday" });
    var allDayWrap = el(doc, "label", "calendar-newform__allday-wrap", { "for": "cal-allday", text: " All day" });
    var location = el(doc, "input", "calendar-newform__location field", { type: "text", placeholder: "Location (optional)", "aria-label": "Location" });
    // Notes maps to the event's `description` field — a real, writable column (loopcalendar
    // events.description; POST/PUT /api/events accept body.description) that renderRecord
    // already DISPLAYS as "notes" but the create form never let you SET. E3 closes that gap.
    var notes = el(doc, "textarea", "calendar-newform__notes field", { rows: "4", placeholder: "Notes (optional)", "aria-label": "Notes" });
    // Pre-fill on edit. start_at is the tool's "YYYY-MM-DDTHH:MM[:SS]" — the datetime-local
    // input wants "YYYY-MM-DDTHH:MM", so we slice the tool's string to 16 chars (NO parse,
    // NO Date construction — TC-1: a string slice, the same discipline as eventDayKey).
    if (isEdit) {
      title.value = existing.title || "";
      start.value = String(existing.start_at || "").slice(0, 16);
      allDay.checked = !!existing.all_day;
      location.value = existing.location || "";
      notes.value = existing.description || "";
    } else if (state && state.prefillKey) {
      // Empty-slot click in the week/day grid → prefill the picked day + hour as a
      // "YYYY-MM-DDTHH:MM" string (pure assembly — TC-1: no Date construction).
      var hh = String(state.prefillHour != null ? state.prefillHour : 9).padStart(2, "0");
      start.value = state.prefillKey + "T" + hh + ":00";
    } else if (state && (state.prefillTitle || state.prefillNotes)) {
      // E3 (Add to calendar, from an email) — prefill the title + notes ONLY; the start is
      // LEFT EMPTY on purpose (operator decision A: never fabricate the event time from an
      // email — the user picks it, and the save-guard below requires it before create).
      if (state.prefillTitle) title.value = String(state.prefillTitle);
      if (state.prefillNotes) notes.value = String(state.prefillNotes);
    }
    // G2 — the calendar picker. The model has carried calendar_id since G1
    // (color); this is the affordance that SETS it. The <select> is built with an
    // "Unassigned" option synchronously, then populated from api.calendars() (the same
    // seam the "My calendars" rail reads). COLD-SAFE by the rail's idiom: absent/slow/dead
    // /api/calendars leaves only "Unassigned", and the event is created unassigned — exactly
    // today's behavior — never a blank or a stall. On edit, the existing calendar_id is
    // pre-selected once the options land.
    var calSelect = el(doc, "select", "calendar-newform__calendar field", { "aria-label": "Calendar" });
    calSelect.appendChild(el(doc, "option", "", { value: "", text: "Unassigned" }));
    var wantCalId = isEdit ? String(existing.calendar_id || "") : "";
    function fillCalendars(r) {
      var rows = (r && r.ok && r.data && r.data.calendars) ? r.data.calendars : [];
      rows.forEach(function (c) {
        if (!c || c.id == null) return;
        calSelect.appendChild(el(doc, "option", "", { value: String(c.id), text: c.name || String(c.id) }));
      });
      // Pre-select the event's current calendar now that its option exists (edit path).
      // Guard: only set if the option is present, so a since-deleted calendar_id falls back
      // to "Unassigned" in the picker rather than silently vanishing. `.options` may be a
      // NodeList (browser) or absent on a bare mock — read length defensively.
      if (wantCalId && calSelect.options) {
        for (var i = 0; i < calSelect.options.length; i++) {
          if (calSelect.options[i].value === wantCalId) { calSelect.value = wantCalId; break; }
        }
      }
    }
    if (typeof api.calendars === "function") {
      // COLD-SAFE, both failure shapes: a broken seam may THROW synchronously (a mock/dead
      // client whose fetch raises) OR reject asynchronously. Either way the form must stand
      // with just "Unassigned" — a dead calendars list can never crash or blank the create
      // form. (The "My calendars" rail's plain `.then` predates this; this is the harder half.)
      try {
        var calP = api.calendars({});
        if (calP && typeof calP.then === "function") { calP.then(fillCalendars).catch(function () {}); }
      } catch (_e) { /* seam threw synchronously — leave "Unassigned", never crash the form */ }
    }

    form.appendChild(title);
    form.appendChild(start);
    var adRow = el(doc, "div", "calendar-newform__row"); adRow.appendChild(allDay); adRow.appendChild(allDayWrap); form.appendChild(adRow);
    form.appendChild(location);
    form.appendChild(calSelect);
    form.appendChild(notes);

    var save = el(doc, "button", "calendar-action", { type: "button", text: isEdit ? "Save changes" : "Save event" });
    var err = el(doc, "p", "calendar-newform__err line");
    save.addEventListener("click", function () {
      if (!title.value.trim() || !start.value) { err.textContent = "A title and a start time are required."; return; }
      err.textContent = "";
      save.disabled = true; save.classList.add("is-saving");
      // Send the raw inputs; the tool validates/normalizes (TC-1). all_day drops the
      // time semantics on the tool side; start_at goes verbatim.
      var payload = { title: title.value.trim(), start_at: start.value, all_day: allDay.checked };
      payload.location = location.value.trim();  // sent even when cleared, so an edit can remove it
      payload.description = notes.value.trim();  // notes -> events.description; sent even when cleared (edit can remove it)
      // G2 — the picked calendar. Empty select ("Unassigned") -> null. On edit the select is
      // pre-filled to the existing calendar_id, so leaving it unchanged re-sends that value
      // (no clobber); changing it reassigns; picking "Unassigned" intentionally clears it.
      payload.calendar_id = calSelect.value || null;
      // create mints a new event; update patches the existing one (both mint an Idempotency-Key).
      var p = isEdit ? api.update(existing.id, payload) : api.create(payload);
      Promise.resolve(p).then(function (env) {
        save.classList.remove("is-saving");
        if (env.ok) { flashWrite(save, true); done(); }   // SL-1: drop the pane, then repaint the grid
        else {
          save.disabled = false;
          var why = (env.data && env.data.error) ? env.data.error : (isEdit ? "couldn\u2019t save the changes" : "couldn\u2019t save the event");
          err.textContent = why;
          flashWrite(save, false, why);
        }
      });
    });
    form.appendChild(save);
    form.appendChild(err);
    overlay.appendChild(form);
  }

  /* ---- WEEK/DAY time-grid geometry + placement (C2,) ---------------- *
   * View geometry ONLY (TC-1): which days sit in the visible week, and where a    *
   * block sits vertically within a day column. The vertical offset is minutes-    *
   * from-midnight read off the tool's DISPLAYED wall-clock (a string slice, the    *
   * same class as timeLabel/eventDayKey) — NEVER a Date parse of the event, never  *
   * epoch math, never an occurrence computed. The empty week scaffold uses the     *
   * bounded new Date(year, m0, d) geometry form (a fixed function of the calendar,  *
   * not of any event), exactly as monthShape does. If you feel the urge to compute  *
   * something ABOUT AN EVENT here (does this recur today? is this end valid?), it   *
   * belongs in the tool. The tool returns already-expanded instances over a range.  */
  var GRID_START_HOUR = 6;   // top of the visible day window (scrollable to the rest)
  var GRID_END_HOUR = 22;    // bottom of the labelled window
  var PX_PER_MIN = 0.9;      // block scale — pure display
  // A short block can't hold BOTH a time line (~11.6px) and a title line
  // (~13.6px) plus padding inside overflow:hidden — the second line clips.
  // At/above this height both fit; below it we drop the time (design call A,
  // seq=356) so the TITLE stays visible. Grid position + click carry the time.
  var TEVENT_TWO_LINE_MIN_PX = 27;   // a 30-min event at 0.9px/min — the sweep measured 30-min CLEAN with both lines

  // Minutes-from-midnight of an event's start, from the DISPLAYED "THH:MM" — a
  // string slice, not a parse. Returns -1 for all-day / unparseable (bucketed to
  // the all-day strip, never guessed onto the grid).
  function startMinutes(ev) {
    if (ev && ev.all_day) return -1;
    var m = String((ev && ev.start_at) || "").match(/T(\d{2}):(\d{2})/);
    if (!m) return -1;
    return (parseInt(m[1], 10) * 60) + parseInt(m[2], 10);
  }
  // Block height in minutes: end_at's displayed time minus start (same-day only,
  // string slice), floored to a legible minimum; default 60 when no end is given.
  // The tool owns the real span — this is only how tall to paint the block.
  function durationMinutes(ev, sMin) {
    var e = String((ev && ev.end_at) || "");
    if (e && sMin >= 0 && e.slice(0, 10) === String((ev && ev.start_at) || "").slice(0, 10)) {
      var m = e.match(/T(\d{2}):(\d{2})/);
      if (m) {
        var eMin = (parseInt(m[1], 10) * 60) + parseInt(m[2], 10);
        if (eMin > sMin) return Math.max(20, eMin - sMin);
      }
    }
    return 60;
  }
  // The visible day-columns for a week or day span, from a reference (y, m0, day).
  // Pure scaffold geometry: new Date(y, m0, expr) normalizes month/year rollover,
  // never touching an event. Each column carries its ymd key (the bucket) + today.
  function spanDays(y, m0, day, span) {
    var out = [], today = todayParts();
    if (span === "day") {
      var d0 = new Date(y, m0, day);
      out.push({ key: ymd(d0.getFullYear(), d0.getMonth(), d0.getDate()),
        label: WEEKDAYS[d0.getDay()] + " " + d0.getDate(),
        isToday: ymd(d0.getFullYear(), d0.getMonth(), d0.getDate()) === today.key });
      return out;
    }
    var weekday = new Date(y, m0, day).getDay();          // which weekday the ref sits on
    for (var i = 0; i < 7; i++) {
      var dn = new Date(y, m0, day - weekday + i);        // roll the week (geometry)
      var key = ymd(dn.getFullYear(), dn.getMonth(), dn.getDate());
      out.push({ key: key, label: WEEKDAYS[dn.getDay()] + " " + dn.getDate(), isToday: key === today.key });
    }
    return out;
  }
  // Step the reference day by ±delta days (view nav), rolling month/year via the
  // same bounded-geometry normalization. Not event math.
  function stepDays(y, m0, day, delta) {
    var d = new Date(y, m0, day + delta);
    return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
  }
  function hourLabel(h) {
    if (h === 0) return "12a"; if (h === 12) return "12p";
    return h < 12 ? (h + "a") : ((h - 12) + "p");
  }
  /* ---- packColumn — THE TWO NUMBERS (Slice 1) -------------------------- *
   * Greedy overlap packing over one column's timed events. Pure layout, no event  *
   * math (TC-1).                                                                  *
   *                                                                               *
   * THIS FUNCTION USED TO RETURN ONE NUMBER AND IT WAS WRONG AT BOTH OF ITS JOBS. *
   *                                                                               *
   * The old `it.lanes` was `1 + the largest lane INDEX among overlapping events` — *
   * a fact about the packing's HISTORY, not a count of things happening at once. A *
   * long event carries the lane index it earned in a busy morning and hands it to  *
   * everything it later brushes. Two failures fell out of that one conflation:     *
   *                                                                               *
   *   the RENDER  the same number was the width divisor, computed PER-ITEM — so    *
   *               two events overlapping in TIME could be given overlapping        *
   *               HORIZONTAL spans. On an ordinary day (a 9:00 standup, a 9-to-5   *
   *               focus block, four 2pm meetings) the focus block PAINTED INSIDE   *
   *               THE STANDUP. 58 of 400 randomly generated days collided. It was  *
   *               never reported because the failure is quiet: an over-wide event  *
   *               looks deliberate, and an occluded one looks like an event you    *
   *               forgot to create.                                                *
   *                                                                               *
   *   the MEASURE Block B ratified this number as the Fullness Read's measure —    *
   *               "it.lanes = omega, PROVEN EXACT." It is not. A lunch overlapping *
   *               only a long block reported 4 when the true concurrency was 2 —   *
   *               a Tufte Lie Factor of 2.0 on the ordinary shape of a working day.*
   *               (The theorem cited was true, and about a different quantity: the *
   *               WHOLE COLUMN'S max lane index, not a per-item neighbourhood max.)*
   *                                                                               *
   * SO WE STOP ASKING ONE NUMBER TO DO TWO JOBS. Both fall out of the `concurrent` *
   * set this function already built and already threw away — no new data source.   *
   *                                                                               *
   *   it.lanes   the RENDER divisor. CLUSTER-UNIFORM: every event in a connected   *
   *              overlap component shares ONE denominator and holds a distinct     *
   *              lane within it. Two events that overlap in time are, by           *
   *              definition, in the same component; greedy gives them distinct     *
   *              lanes; they now share a denominator; so their spans are lane/D    *
   *              and lane'/D with lane != lane'. DISJOINT BY ARITHMETIC. The       *
   *              collision is not defended against — IT IS NOT EXPRESSIBLE.        *
   *              Must be SAFE (never under-report -> never occlude).               *
   *              Honest cost, named: safe is not MINIMAL. An event in a cluster    *
   *              containing one very busy moment is narrower than it strictly      *
   *              needs to be. That is the correct trade and the one Google         *
   *              Calendar makes; minimal-width packing buys pixels at the cost of  *
   *              the inexpressibility above. Do not "optimise" this back.          *
   *                                                                               *
   *   it.atOnce  the FULLNESS measure. The greatest number of events              *
   *              simultaneously in progress at any single instant inside this      *
   *              event's own span. Must be EXACT (never over-report -> never lie). *
   *              THE FULLNESS READ (P8) READS THIS AND NOTHING ELSE.               *
   *                                                                               *
   * Verified against a brute-force oracle in calendar-pack.test.js — including 400 *
   * randomised days, every event checked. See §3.1. */
  /* ---- weekSpanSegments — a span, cut to one week row (A3) ------------ *
   * A BAR CROSSING A WEEK BOUNDARY IS TWO BARS, ONE EVENT. That is Google's model    *
   * and the only one a 7-column grid can express: build a span as one DOM node and    *
   * you are fighting the grid, and you lose. So each week row cuts the span to its    *
   * own seven days and keeps two facts the RENDER needs — whether this segment holds  *
   * the event's TRUE start and whether it holds its TRUE end. Those two bits are the  *
   * ONLY thing that tells the eye a bar continues off the edge of the row: a true     *
   * edge is rounded, a continuation is SQUARE.                                        *
   *                                                                                   *
   * Keys are YYYY-MM-DD, so string compare IS chronological compare. No parse.        *
   * Lanes are packed PER WEEK ROW: a three-week event may sit in lane 0 one week and   *
   * lane 1 the next. Google does the same, and the alternative (a global lane, held    *
   * across rows) would let one long event reserve a lane in every week it touches       *
   * whether or not anything is beside it there. Per-row is the honest packing.          */
  function weekSpanSegments(weekCells, spans) {
    var first = weekCells[0].key, last = weekCells[weekCells.length - 1].key;
    var segs = [];
    spans.forEach(function (s) {
      if (s.toKey < first || s.fromKey > last) return;    // this week never sees it
      var startCol = 0;
      while (startCol < 6 && weekCells[startCol].key < s.fromKey) startCol++;
      var endCol = 6;
      while (endCol > 0 && weekCells[endCol].key > s.toKey) endCol--;
      if (endCol < startCol) return;
      segs.push({
        ev: s.ev,
        startCol: startCol,
        endCol: endCol,
        isTrueStart: weekCells[startCol].key === s.fromKey,
        isTrueEnd: weekCells[endCol].key === s.toKey
      });
    });
    // The interval graph, at DAY granularity. endCol is inclusive, so the half-open end
    // is endCol + 1 — two bars touching at a column boundary do NOT overlap.
    return packLanes(segs, function (g) { return g.startCol; },
                           function (g) { return g.endCol + 1; });
  }

  /* ---- packLanes — THE SHARED GREEDY PASS (A3; owed #354 spent) -------- *
   * THE OWED SAID packColumn COMPUTES THE INTERVAL GRAPH AND THROWS IT AWAY. It    *
   * does. But the asset is not the whole function — it is THIS PASS, and only this  *
   * one. The month grid's span-bars need lanes; they do NOT need the cluster width  *
   * divisor (a bar is full-width across its days, it has no denominator) and they    *
   * do NOT need atOnce (fullness is a time-grid read). Generalizing all of           *
   * packColumn to serve both callers would hand ONE function TWO jobs — the exact    *
   * conflation the comment below is a monument to having just removed. So the FIRST  *
   * STEP comes out, and each caller keeps the steps only it needs.                   *
   *                                                                                 *
   * Greedy-by-start over an interval set. OPTIMAL for interval graphs (the classic   *
   * result — an interval graph is perfect, so greedy attains the chromatic number =  *
   * the max clique = peak concurrency). Writes `lane` onto each item; returns items. *
   * Generic over the interval's units: MINUTES for the time-grid column, DAY-COLUMNS *
   * for a week's span-bars. It knows nothing about either.                           */
  function packLanes(items, startOf, endOf) {
    items.sort(function (a, b) {
      return (startOf(a) - startOf(b))
        || ((endOf(a) - startOf(a)) - (endOf(b) - startOf(b)));
    });
    var laneEnds = [];   // end of the last interval placed in each lane
    items.forEach(function (it) {
      var lane = -1;
      for (var l = 0; l < laneEnds.length; l++) { if (laneEnds[l] <= startOf(it)) { lane = l; break; } }
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = endOf(it);
      it.lane = lane;
    });
    return items;
  }

  function packColumn(items) {
    // A zero/negative-duration event (a malformed import) overlaps nothing — not even
    // itself — which used to hand it a lane outside its own denominator and paint it
    // off the right edge of the column. Give it a floor so the geometry stays sane.
    function endOf(it) { return it.sMin + Math.max(0, it.dur); }
    function startOf(it) { return it.sMin; }
    function ov(a, b) {
      return a.sMin < endOf(b) && b.sMin < endOf(a);
    }

    // --- 1. greedy lane assignment — THE SHARED PASS (A3: extracted to packLanes) -
    packLanes(items, startOf, endOf);

    // --- 2. RENDER divisor: connected components of the overlap graph ------------
    // One denominator per cluster. This is what makes a collision inexpressible.
    var comp = items.map(function () { return -1; });
    var nComp = 0;
    items.forEach(function (_, i) {
      if (comp[i] !== -1) return;
      var stack = [i];
      comp[i] = nComp;
      while (stack.length) {
        var u = stack.pop();
        for (var v = 0; v < items.length; v++) {
          if (comp[v] === -1 && ov(items[u], items[v])) { comp[v] = nComp; stack.push(v); }
        }
      }
      nComp++;
    });
    var width = [];
    for (var c = 0; c < nComp; c++) width.push(1);
    items.forEach(function (it, i) {
      if (it.lane + 1 > width[comp[i]]) width[comp[i]] = it.lane + 1;
    });
    items.forEach(function (it, i) { it.lanes = width[comp[i]]; });

    // --- 3. FULLNESS measure: true peak concurrency inside this event's span -----
    // By the Helly property of intervals it suffices to evaluate coverage at the
    // START INSTANTS falling inside the span — the peak always occurs at one of them.
    // Same O(n^2) the discarded `concurrent` filter already cost.
    items.forEach(function (it) {
      var end = endOf(it);
      // An empty span (a zero-length event from a malformed import) covers NO instant,
      // so the honest count is 0 — not 1. It is not "happening"; it has no when.
      if (end <= it.sMin) { it.atOnce = 0; return; }
      var best = 0;
      var instants = [it.sMin];
      items.forEach(function (o) {
        if (ov(o, it) && o.sMin > it.sMin && o.sMin < end) instants.push(o.sMin);
      });
      instants.forEach(function (p) {
        var n = 0;
        items.forEach(function (o) { if (o.sMin <= p && endOf(o) > p) n++; });
        if (n > best) best = n;
      });
      it.atOnce = best;
    });

    return items;
  }

  /* ---- recurrence label (C4, — DISPLAY only, TC-1) ------------------ *
   * Reads the rule the TOOL already parsed (recurrence_rule_parsed, else a rule   *
   * object) and maps {frequency, interval} to a human label. This is NOT parsing   *
   * (no RRULE string is read/expanded — that is the tool's) and computes no        *
   * occurrence; it is a field->label lookup, the same class as catColor. An        *
   * unrecognised shape returns "" so nothing is fabricated (Real-or-Made).         */
  function recurrenceLabel(ev) {
    var rule = (ev && (ev.recurrence_rule_parsed || ev.recurrence_rule)) || null;
    if (!rule || typeof rule !== "object") return ev && ev.recurrence_rule ? "repeats" : "";
    var freq = String(rule.frequency || rule.freq || "").toLowerCase();
    var n = parseInt(rule.interval, 10); if (!(n > 0)) n = 1;
    var word = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[freq];
    if (!word) return "repeats";
    return n === 1 ? ("every " + word) : ("every " + n + " " + word + "s");
  }

  /* ---- the EVENT POPOVER (C3, — quick actions off a time-grid block) - *
   * A light overlay anchored to the clicked block: when/where/category/recurrence  *
   * + Open (full record) / Edit / Delete, so a common action needs no navigation.  *
   * TC-1: it renders tool fields verbatim and dispatches — no event math. Delete    *
   * is in-boundary; a failed delete is honest (never renders as landed).            */
  var _openPopover = null;
  function closePopover() {
    if (_openPopover && _openPopover.parentNode) _openPopover.parentNode.removeChild(_openPopover);
    _openPopover = null;
  }

  /* ---- the RECOLOR PICKER popover (color seam step 2) ------------------------ *
   * A small inline palette off the rail's color dot: 12 Grove swatches + a        *
   * "Default" revert chip. Pick IS commit (the write primitives are immutable +   *
   * reversible, so nothing to stage — no Apply/Cancel). Sibling to the event      *
   * popover above; its own state so the two never entangle. A view change or an   *
   * outside click dismisses it (mirrors closePopover). Dispatch rides the DOT     *
   * (in the pane subtree) so forest:cal-recolor bubbles to the shell-boot host,   *
   * the exact CustomEvent-up idiom count/density/add-to-calendar already use.     */
  var _openColorPopover = null;
  var _colorDismiss = null;
  function closeColorPopover() {
    if (_openColorPopover && _openColorPopover.parentNode) _openColorPopover.parentNode.removeChild(_openColorPopover);
    if (_colorDismiss && _colorDismiss.doc && _colorDismiss.fn) {
      try { _colorDismiss.doc.removeEventListener("click", _colorDismiss.fn, true); } catch (e) {}
    }
    _openColorPopover = null;
    _colorDismiss = null;
  }
  // Emit forest:cal-recolor { id, slot } from the DOT (slot === null ⇒ revert).
  // Bubbles to the pane host, where shell-boot persists via setCalColor/revertCalColor.
  function emitCalRecolor(dotNode, id, slot) {
    if (!dotNode || !id) return;
    try {
      var doc = dotNode.ownerDocument, view = doc && doc.defaultView;
      var detail = { id: id, slot: slot };
      var ev = (view && typeof view.CustomEvent === "function")
        ? new view.CustomEvent("forest:cal-recolor", { detail: detail, bubbles: true })
        : { type: "forest:cal-recolor", detail: detail, bubbles: true };
      if (typeof dotNode.dispatchEvent === "function") dotNode.dispatchEvent(ev);
    } catch (e) { /* cold-safe: best-effort, never a render throw */ }
  }
  // Emit forest:cal-reorder { order } up to the pane host (verb 4). Carries the WHOLE
  // new order array (computed client-side via calMod.reorder), the way the recolor
  // picker hands setCalColor a computed slot; shell-boot persists via setCalOrder.
  // Bubbles from a pane-subtree node (the rail group). Cold-safe: best-effort.
  function emitCalReorder(node, order) {
    if (!node) return;
    try {
      var doc = node.ownerDocument, view = doc && doc.defaultView;
      var detail = { order: (order || []).slice() };
      var ev = (view && typeof view.CustomEvent === "function")
        ? new view.CustomEvent("forest:cal-reorder", { detail: detail, bubbles: true })
        : { type: "forest:cal-reorder", detail: detail, bubbles: true };
      if (typeof node.dispatchEvent === "function") node.dispatchEvent(ev);
    } catch (e) { /* cold-safe */ }
  }
  function showEventPopover(host, anchorEl, ev, actions) {
    closePopover();
    var doc = host.ownerDocument;
    var pop = el(doc, "div", "calendar-popover");
    paintCalHue(pop, ev);

    var head = el(doc, "div", "calendar-popover__head");
    head.appendChild(el(doc, "h3", "calendar-popover__title", { text: ev.title || "(untitled)" }));
    var close = el(doc, "button", "calendar-popover__close", { type: "button", "aria-label": "Close", text: "\u00d7" });
    close.addEventListener("click", closePopover);
    head.appendChild(close);
    pop.appendChild(head);

    // when: verbatim tool fields (no end-from-start math)
    var when = ev.all_day ? ("all day \u00b7 " + eventDayKey(ev))
      : (String(ev.start_at || "").replace("T", " ") + (ev.end_at ? (" \u2013 " + String(ev.end_at).replace("T", " ")) : ""));
    pop.appendChild(el(doc, "div", "calendar-popover__when line", { text: when }));
    if (ev.location) pop.appendChild(el(doc, "div", "calendar-popover__where line", { text: ev.location }));
    if (ev.category) pop.appendChild(el(doc, "div", "calendar-popover__cat line", { text: ev.category }));
    var rec = recurrenceLabel(ev);
    if (rec) pop.appendChild(el(doc, "div", "calendar-popover__repeats", { text: rec }));

    var strip = el(doc, "div", "calendar-popover__actions");
    var openBtn = el(doc, "button", "calendar-action", { type: "button", text: "Open" });
    openBtn.addEventListener("click", function () { closePopover(); if (actions && actions.open) actions.open(ev); });
    strip.appendChild(openBtn);
    var editBtn = el(doc, "button", "calendar-action", { type: "button", text: "Edit" });
    editBtn.addEventListener("click", function () { closePopover(); if (actions && actions.edit) actions.edit(ev); });
    strip.appendChild(editBtn);
    var delBtn = el(doc, "button", "calendar-action calendar-action--danger", { type: "button", text: "Delete" });
    delBtn.addEventListener("click", function () {
      delBtn.disabled = true; delBtn.classList.add("is-saving");
      Promise.resolve(actions && actions.remove ? actions.remove(ev) : { ok: false }).then(function (env) {
        delBtn.classList.remove("is-saving");
        if (env && env.ok) { closePopover(); if (actions && actions.afterDelete) actions.afterDelete(); }
        else { delBtn.disabled = false; flashWrite(delBtn, false, "couldn\u2019t delete"); }
      });
    });
    strip.appendChild(delBtn);
    pop.appendChild(strip);

    // Position near the anchor (guarded for headless: falls back to a static card).
    if (anchorEl && typeof anchorEl.getBoundingClientRect === "function") {
      var r = anchorEl.getBoundingClientRect();
      pop.style.position = "fixed";
      pop.style.top = (r.bottom + 6) + "px";
      pop.style.left = r.left + "px";
    }
    host.appendChild(pop);
    _openPopover = pop;
    return pop;
  }

  /* ---- the WEEK / DAY time-grid view ----------------------------------------- */
  // `onCursor` (B1) — the rail-notify seam, identical to renderGrid's. Cold-safe.
  function renderTimeGrid(host, ctx, api, state, injected, openRecord, openNew, span, openEdit, onCursor, calActions) {
    var doc = host.ownerDocument;
    host.textContent = "";

    /* THE TIME HEAD — the same builder, its OWN declared action list.
     *
     * NOTE THE ABSENCE, because it is now DECLARED rather than accidental: there is
     * no `actionsICal(...)` in this list. iCal is calendar-scoped, not view-scoped,
     * and it has been reachable from the Month view ALONE — a fact nobody chose.
     * Giving week/day iCal is a BEHAVIOUR change (the operator's open C fork, owed
     * seq=57), not a refactor, so this leg does not make it. What this leg does is
     * make the absence VISIBLE at the call site and PINNED by an assertion
     * (`head-extraction.test.js`), instead of invisible in two divergent bodies. */
    var cols = spanDays(state.year, state.month, state.day, span);
    var rangeText = (span === "day")
      ? (MONTHS[state.month] + " " + state.day + ", " + state.year)
      : (cols[0].key + "  \u2192  " + cols[cols.length - 1].key);
    var stepBy = (span === "day") ? 1 : 7;
    // B1 — repaint this view AND tell the rail (`refresh` is hoisted below). Same
    // shape as renderGrid's; the time head has no iCal, so all its sites are cursor sites.
    function cursorMoved() {
      refresh();
      if (typeof onCursor === "function") onCursor();
    }
    var head = calendarHead(doc, {
      title: rangeText,
      prevLabel: "Previous",
      nextLabel: "Next",
      onPrev: function () { var s = stepDays(state.year, state.month, state.day, -stepBy); state.year = s.year; state.month = s.month; state.day = s.day; cursorMoved(); },
      onNext: function () { var s = stepDays(state.year, state.month, state.day, stepBy); state.year = s.year; state.month = s.month; state.day = s.day; cursorMoved(); },
      // C — identical shape to renderGrid's, and that is the point: ONE
      // view-scoped control (Today), plus whatever calendar-scoped list the caller
      // declares. The two heads can no longer diverge by omission, because neither
      // one AUTHORS a calendar-scoped control any more.
      today: actionToday(doc, state, cursorMoved),
      actions: (calActions || []),
    });
    host.appendChild(head.el);

    var grid = el(doc, "div", "calendar-timegrid" + (span === "day" ? " calendar-timegrid--day" : ""));
    if (grid.setAttribute) grid.setAttribute("data-span", span);
    host.appendChild(grid);

    /* ---- Column header row + THE FULLNESS READ (P8, Slice 2) ------------ *
     * The day label, and beneath it one badge carrying ONE NUMBER: the greatest    *
     * number of events happening AT ONCE at any instant that day (packColumn's     *
     * it.atOnce, maxed over the column). That is the whole feature.                *
     *                                                                              *
     * THE CODE PATH THAT DOES NOT EXIST (the Treeline, B1/D5 — a refusal is        *
     * legitimate iff you can NAME the code path that does not exist):              *
     *                                                                              *
     *   NO WRITE PATH.      The Fullness Read never calls api.create / api.update / *
     *                       api.remove / api.addAttendee, or any POST/PUT/DELETE.   *
     *                       It is handed an array of laid-out items and returns an  *
     *                       integer. It holds no reference to `api` at all.         *
     *   NO SCHEDULER REACH. There is no code that proposes a time, moves an event,  *
     *                       suggests a slot, declines an invitation, or blocks a    *
     *                       range. It is not that the scheduler is DISABLED — THERE *
     *                       IS NO SCHEDULER.                                        *
     *   NO THRESHOLD, NO VERDICT. There is no constant `atOnce` is compared against,*
     *                       no isOverbooked, no busyLevel, no stored history of your*
     *                       density, no banner/toast/badge that fires on any value  *
     *                       of it. THE NUMBER IS RENDERED. IT IS NEVER JUDGED.      *
     *                                                                              *
     * Theo's sentence, made structural: THE APP SHOWS YOU YOUR WEEK; IT NEVER HAS   *
     * AN OPINION ABOUT YOUR WEEK. The instant it says "your week is too full" it    *
     * has an interest in your week and it is an agent. The ABSENCE above is what    *
     * makes that a fact about the code and not a promise about our intentions.      *
     * (Dara/Nyx: hope is not a control. calendar-fullness.test.js greps for it.)    *
     *                                                                              *
     * WHY A COUNT AND NOT A HEAT RAMP (§6 Call 2, the operator's, taken (a)):*
     * the intuitive render is to tint the column redder as it fills. It is ALSO the *
     * least accurate encoding channel there is — Cleveland-McGill put position and  *
     * length at the top and colour saturation/density at the BOTTOM. And red-means- *
     * bad IS AN OPINION ABOUT YOUR WEEK. The perceptually honest encoding and the   *
     * opinion-free encoding turn out to be THE SAME ENCODING. That convergence is   *
     * why this is a number.                                                         *
     *                                                                              *
     * 0 or 1 renders NOTHING — an empty or single-threaded day makes no claim, and  *
     * "1 at once" is noise. Absence is a shipped state.                             */
    var colhead = el(doc, "div", "calendar-timegrid__colhead");
    colhead.appendChild(el(doc, "div", "calendar-timegrid__gutter-corner"));
    var fullnessBadges = {};   // c.key -> the badge node (text set in paint(), from atOnce)
    cols.forEach(function (c) {
      var lab = el(doc, "div", "calendar-timegrid__daylabel line" + (c.isToday ? " is-today" : ""));
      lab.appendChild(el(doc, "span", "calendar-timegrid__dayname", { text: c.label }));
      var badge = el(doc, "span", "calendar-fullness badge", { text: "" });
      if (badge.setAttribute) badge.setAttribute("data-fullness", "");
      lab.appendChild(badge);
      fullnessBadges[c.key] = badge;
      colhead.appendChild(lab);
    });
    grid.appendChild(colhead);

    /* Render one day's fullness. A pure function of packColumn's output to text.
       It reads it.atOnce and NOTHING else. It writes text and NOTHING else. */
    function paintFullness(key, packed) {
      var badge = fullnessBadges[key];
      if (!badge) return;
      var atOnce = 0;
      packed.forEach(function (it) { if (it.atOnce > atOnce) atOnce = it.atOnce; });
      if (atOnce < 2) {                       // nothing overlaps -> no claim to make
        badge.textContent = "";
        if (badge.setAttribute) badge.setAttribute("data-fullness", "");
        return;
      }
      badge.textContent = atOnce + " at once";
      if (badge.setAttribute) badge.setAttribute("data-fullness", String(atOnce));
      if (badge.title !== undefined) {
        badge.title = "At its busiest, " + atOnce + " events overlap on this day.";
      }
    }

    // The all-day strip (events with no time-of-day sit here, honestly, not on the grid)
    var allday = el(doc, "div", "calendar-timegrid__allday");
    grid.appendChild(allday);

    // The scroll body: gutter (hour labels) + one column per day
    var scroll = el(doc, "div", "calendar-timegrid__scroll");
    var gutter = el(doc, "div", "calendar-timegrid__gutter");
    for (var h = 0; h < 24; h++) {
      var hr = el(doc, "div", "calendar-timegrid__hour");
      hr.style.height = (60 * PX_PER_MIN) + "px";
      hr.appendChild(el(doc, "span", "calendar-timegrid__hourlabel", { text: hourLabel(h) }));
      gutter.appendChild(hr);
    }
    scroll.appendChild(gutter);
    var colwrap = el(doc, "div", "calendar-timegrid__cols");
    scroll.appendChild(colwrap);
    grid.appendChild(scroll);

    /* ---- Drag-to-reschedule (week/day time-grid) ------------------------------ *
     * The month view has had this since C; the timed views never did. Same
     * TC-1 contract: the renderer performs NO event logic — on drop it substitutes
     * the DAY and the TIME portions of start_at by STRING (no Date parse, no epoch
     * math) and preserves duration; the TOOL validates + persists on PUT and owns
     * recurrence/validity. Richer than month by exactly one axis: a time-grid drop
     * resolves both the target DAY (the column under the cursor, by data-date) and
     * the target TIME (the vertical drop offset ÷ PX_PER_MIN), and the grab offset
     * is preserved so the block's top lands where the hand expects. A drop outside
     * the columns cancels honestly — the event stays put, no optimistic lie.
     * Listeners live on `scroll` (rebuilt every renderTimeGrid), so they never leak. */
    var tdrag = null;            // { ev, dur, grabDy, startX, startY, active, el }
    var tSuppressClick = false;  // swallow the click that trails an active drag
    var lastEvents = null;       // last-rendered set — reused for a no-GET reschedule repaint
    // ── The manipulation pass — time-grid drag-feel state (grab · carry · place) ──
    var tGhost = null;           // the follow-ghost while dragging a time block (CARRY)
    var tDropCol = null;         // the column highlighted under the cursor
    function clearDropCol() {
      if (tDropCol && tDropCol.classList) tDropCol.classList.remove("is-drop-target");
      tDropCol = null;
    }
    function setDropCol(node) {
      if (tDropCol === node) return;
      clearDropCol();
      if (node && node.classList) node.classList.add("is-drop-target");
      tDropCol = node;
    }
    function colUnder(x, y) {
      var node = doc.elementFromPoint ? doc.elementFromPoint(x, y) : null;
      while (node && node !== colwrap && node !== scroll) {
        if (node.classList && node.classList.contains("calendar-timegrid__col") &&
            node.getAttribute && node.getAttribute("data-date")) return node;
        node = node.parentNode;
      }
      return null;
    }
    function hhmm(min) {
      return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
    }
    function rescheduleTimed(ev, targetKey, newStartMin, dur, sourceEl) {
      var startStr = String(ev.start_at || "");
      if (startStr.length < 16) return;                 // not tool-shaped "…THH:MM" — leave it
      var sourceKey = startStr.slice(0, 10);
      if (targetKey === sourceKey && newStartMin === startMinutes(ev)) return;   // no move
      var secs = startStr.slice(16);                    // ":SS…" tail (or "") preserved verbatim
      var patch = { start_at: targetKey + "T" + hhmm(newStartMin) + secs };
      var endStr = String(ev.end_at || "");
      var endMin = newStartMin + (dur || 0);
      if (endStr.length >= 16 && endStr.slice(0, 10) === sourceKey && endMin < 1440) {
        // a same-day event that stays within the day carries a duration-preserving end;
        // a multi-day event (or one dragged across midnight) sends start only — the tool
        // re-derives + validates the span, exactly as the month drag does for spans.
        patch.end_at = targetKey + "T" + hhmm(endMin) + endStr.slice(16);
      }
      var firstRect = (sourceEl && sourceEl.getBoundingClientRect) ? sourceEl.getBoundingClientRect() : null;
      optimisticReschedule(api, ev, patch,
        (lastEvents ? function () {
          flipReschedule(doc, firstRect,   // PLACE: FLIP settles BOTH the column and the time move
            function () { paint({ ok: true, data: { events: lastEvents } }); },
            function () { return findByEvId(scroll, ev.id); });
        } : null),
        function () { refresh(); },
        function () { flashRescheduleFail(doc); });
      calAnnounce(doc, "Moved to " + dayLabelForKey(targetKey) + " at " + hhmm(newStartMin));
    }
    function endTDrag(e, drop) {
      if (!tdrag) return;
      var d = tdrag; tdrag = null;
      if (grid.classList) grid.classList.remove("is-dragging");
      if (tGhost) { tGhost.destroy(); tGhost = null; }
      if (d.el && d.el.classList) d.el.classList.remove("is-grabbed");
      clearDropCol();
      if (d.active) {
        tSuppressClick = true;
        setTimeout(function () { tSuppressClick = false; }, 0);
        if (drop) {
          var colNode = colUnder(e.clientX, e.clientY);
          if (colNode) {
            var rect = colNode.getBoundingClientRect ? colNode.getBoundingClientRect() : { top: 0 };
            var yInCol = e.clientY - rect.top - d.grabDy;         // block-top, grab offset preserved
            var min = Math.round((yInCol / PX_PER_MIN) / 15) * 15;   // snap to 15 minutes
            min = Math.max(0, Math.min(24 * 60 - 15, min));
            rescheduleTimed(d.ev, colNode.getAttribute("data-date"), min, d.dur, d.el);
          }
        }
      }
    }
    scroll.addEventListener("mousemove", function (e) {
      if (!tdrag) return;
      if (!tdrag.active) {
        var dx = e.clientX - tdrag.startX, dy = e.clientY - tdrag.startY;
        if (dx * dx + dy * dy < 25) return;              // 5px threshold: a click, not a drag
        tdrag.active = true;
        if (grid.classList) grid.classList.add("is-dragging");
        if (tdrag.el && tdrag.el.classList) tdrag.el.classList.add("is-grabbed");
        tGhost = makeDragGhost(doc, tdrag.el, e);
      }
      if (tGhost) tGhost.move(e);
      setDropCol(colUnder(e.clientX, e.clientY));
    });
    scroll.addEventListener("mouseup", function (e) { endTDrag(e, true); });
    scroll.addEventListener("mouseleave", function (e) { endTDrag(e, false); });
    // Exposed for tests: drive a reschedule without synthesizing pointer physics.
    scroll.__calRescheduleTimed = rescheduleTimed;

    function paint(env) {
      allday.textContent = ""; colwrap.textContent = "";
      // F3 (honest badge): an unreachable read must NEVER leave a stale fullness number
      // standing over a pane that is showing a failure. A number that survives its own
      // data is a fabricated claim — the exact thing the honest-badge aspect forbids.
      if (!env.ok) {
        cols.forEach(function (c) { paintFullness(c.key, []); });
        colwrap.appendChild(readFailNode(doc, env));
        return;
      }
      var events = (env.data && env.data.events) || [];
      lastEvents = events;   // hold the rendered set so a confirmed reschedule can repaint without a GET
      var byDay = {};
      events.forEach(function (ev) { var k = eventDayKey(ev); (byDay[k] = byDay[k] || []).push(ev); });

      cols.forEach(function (c) {
        var col = el(doc, "div", "calendar-timegrid__col" + (c.isToday ? " is-today" : ""));
        if (col.setAttribute) col.setAttribute("data-date", c.key);
        col.style.height = (24 * 60 * PX_PER_MIN) + "px";
        // click an empty slot -> new event at that day + hour (prefill via state)
        col.addEventListener("click", function (e) {
          if (e.target !== col) return;                 // a block absorbed the click
          var rect = col.getBoundingClientRect ? col.getBoundingClientRect() : { top: 0 };
          var y = (typeof e.offsetY === "number") ? e.offsetY : 0;
          var hour = Math.max(0, Math.min(23, Math.floor((y / PX_PER_MIN) / 60)));
          if (typeof openNew === "function") openNew({ year: state.year, month: state.month, day: state.day, prefillKey: c.key, prefillHour: hour });
        });

        var timed = [], dayEvents = byDay[c.key] || [];
        dayEvents.forEach(function (ev) {
          var sMin = startMinutes(ev);
          if (sMin < 0) {                                // all-day / untimed -> the strip
            var chip = el(doc, "button", "calendar-chip is-allday", { type: "button", title: ev.title || "(untitled)" });
            paintCalHue(chip, ev);
            chip.appendChild(el(doc, "span", "calendar-chip__title", { text: (span === "day" ? "" : (WEEKDAYS_SHORT(c) + " ")) + (ev.title || "(untitled)") }));
            chip.addEventListener("click", function () { if (typeof openRecord === "function") openRecord(ev); });
            allday.appendChild(chip);
            return;
          }
          timed.push({ ev: ev, sMin: sMin, dur: durationMinutes(ev, sMin) });
        });
        var packed = packColumn(timed);
        paintFullness(c.key, packed);        // P8 — the Fullness Read. Renders. Never judges.
        packed.forEach(function (it) {
          // A block too short to hold a time line + a title (design call A, seq=356):
          // it drops the TIME (title-only) and takes .is-compact, which tightens the
          // title's line-height so the single line clears the ~12px inner box instead
          // of shaving ~2px of ascenders under overflow:hidden.
          var blkH = Math.max(14, it.dur * PX_PER_MIN);
          var compact = blkH < TEVENT_TWO_LINE_MIN_PX;
          var blk = el(doc, "button", "calendar-tevent" + (it.ev.all_day ? " is-allday" : "") + (compact ? " is-compact" : ""), { type: "button", title: it.ev.title || "(untitled)" });
          paintCalHue(blk, it.ev);
          blk.style.top = (it.sMin * PX_PER_MIN) + "px";
          blk.style.height = blkH + "px";
          blk.style.left = ((it.lane / it.lanes) * 100) + "%";
          blk.style.width = ((1 / it.lanes) * 100) + "%";
          var tl = timeLabel(it.ev);
          // Short block -> title only. Rendering the time here would push the
          // title below the overflow clip and hide it (the seq=356 guillotine).
          if (tl && !compact) blk.appendChild(el(doc, "span", "calendar-tevent__time", { text: tl }));
          blk.appendChild(el(doc, "span", "calendar-tevent__title", { text: it.ev.title || "(untitled)" }));
          if (blk.setAttribute) blk.setAttribute("data-ev-id", it.ev.id);   // PLACE: FLIP finds the moved block by this
          (function (bev, bdur, bblk) {
            bblk.addEventListener("mousedown", function (e) {
              // grabDy = where inside the block the hand took hold, so the block's TOP
              // (not the cursor) lands at the drop point — the Google feel.
              var gy = (typeof e.offsetY === "number") ? e.offsetY : 0;
              tdrag = { ev: bev, dur: bdur, grabDy: gy, startX: e.clientX, startY: e.clientY, active: false, el: bblk };
            });
            blk.addEventListener("click", function () {
              if (tSuppressClick) return;              // a drag just ended here — not a real click
              showEventPopover(host, blk, bev, {
                open: openRecord,
                edit: openEdit,
                remove: function (ev) { return api.remove(ev.id); },
                afterDelete: refresh
              });
            });
          })(it.ev, it.dur, blk);
          col.appendChild(blk);
        });

        // the "now" line on today's column (current wall-clock, NOT an event field)
        if (c.isToday) {
          var now = new Date();
          var nowMin = now.getHours() * 60 + now.getMinutes();
          var line = el(doc, "div", "calendar-timegrid__now");
          line.style.top = (nowMin * PX_PER_MIN) + "px";
          col.appendChild(line);
        }
        colwrap.appendChild(col);
      });
      if (!events.length) allday.appendChild(el(doc, "p", "calendar-empty", { text: span === "day" ? "Nothing this day." : "Nothing this week." }));
      // scroll the working window to the top on first paint
      if (scroll.scrollTop === 0) scroll.scrollTop = Math.round(GRID_START_HOUR * 60 * PX_PER_MIN);
    }

    /* ★ THE DROPPED ARGUMENTS. This called itself with EIGHT of its TEN
     * parameters, silently losing `openEdit` and `onCursor`. Month was immune BY
     * ACCIDENT — `refreshGrid()` re-titles IN PLACE and never rebuilds the head, so
     * the head's closure keeps its notify. Week/Day rebuild the whole head on every
     * cursor move, with `onCursor === undefined`: the mini rang ONCE and went deaf,
     * and the Edit on the event popover died with it.
     *
     * `mini-calendar-wire.test.js` was GREEN over this. It captures the nav nodes
     * ONCE and then clicks them five times — but click 1 DESTROYS them, so clicks
     * 2-5 fire on DETACHED nodes whose closures still hold the good `onCursor`. It
     * proved the mini follows a button that is no longer on the screen. A thumb
     * re-queries; a test that caches the node does not, and the difference between
     * those two is exactly the bug. `calendar-scope-split.test.js` re-queries. */
    function refresh() { renderTimeGrid(host, ctx, api, state, injected, openRecord, openNew, span, openEdit, onCursor, calActions); }

    if (injected && injected.events) { paint({ ok: true, data: { events: injected.events } }); return; }
    colwrap.appendChild(el(doc, "p", "calendar-loading", { text: "Reading your calendar\u2026" }));
    api.events({ from_date: cols[0].key, to_date: cols[cols.length - 1].key, limit: 500 }).then(paint);
  }
  // a tiny label helper so a week's all-day strip names its day (display only)
  function WEEKDAYS_SHORT(c) { return String(c.label || "").split(" ")[0] || ""; }


  /* ---- the pane entry (kind "calendar") -------------------------------------- */
  function render(paneEl, ctx) {
    ctx = ctx || {};
    var doc = paneEl.ownerDocument;

    // Color seam (§DECIDED): load the sparse calendar-color OVERRIDES from the durable
    // view-config, the same way the mail view reads its view-config-derived state
    // (ctx.config + root.viewConfig). Set once per render, before any paint. Cold-safe:
    // no viewConfig / no config -> {} -> resolveCalColor === calHue everywhere (1.27 behavior).
    OVERRIDES = (root.viewConfig && typeof root.viewConfig.calColorsOf === "function")
      ? root.viewConfig.calColorsOf(ctx.config) : {};

    /* ---- §7.2 — the app name + V# LEAVE the body pane ------------------- *
     * The frame's left column carries a joint-owned `.menu__anchor` (pane.js        *
     * buildMenu: `.menu__name` from labelFor() + `.menu__version`), written BEFORE  *
     * this renderer runs. The in-pane `.pane__title` / `.pane__version` rendered    *
     * the SAME two facts a second time inside the body — the duplicate the operator *
     * can see on screen ("Calendar / v1.20" floating in the pane under an empty     *
     * column). Deleted, not relocated: the anchor already carries them, from the    *
     * same source the tab strip reads, so the column and the strip cannot disagree. *
     *                                                                              *
     * NO FALLBACK, deliberately — and the asymmetry with the toggle below is the    *
     * point. A heading is DECORATION: a frame with no [data-app-menu] loses it and  *
     * loses nothing it can't live without. The VIEW TOGGLE is a CAPABILITY: without *
     * it the pane is a month you cannot leave. §6.5 gives the capability a fallback *
     * and the decoration none. Cost what it costs; never cost the user an action.   */

    // The rail's home (§7.2): the frame's app-owned menu half, handed in by the pane
    // pool as ctx.menuBody. Cold-safe: no [data-app-menu] in the frame (tests, or a
    // frame that dropped the column) -> null -> the in-pane toggle below.
    var menuBody = ctx.menuBody || null;
    var railInMenu = !!menuBody;

    /* FALLBACK (§6.5) — no menu host: keep TODAY'S in-pane toggle, byte-for-byte.
       Mirrors mail-renderer's rail fallback. The four buttons are built ONLY on this
       path; on the rail path they do not exist at all (§6.2: a half-done relocation
       that leaves BOTH controls live is the worst outcome — two plausible view
       switchers, one of them stale). setToggle() below drives whichever one exists. */
    var toggle = null, monthBtn = null, weekBtn = null, dayBtn = null, agendaBtn = null;
    if (!railInMenu) {
      toggle = el(doc, "div", "calendar-viewtoggle");
      monthBtn = el(doc, "button", "calendar-viewtoggle__btn is-on", { type: "button", "aria-pressed": "true", text: "Month" });
      weekBtn = el(doc, "button", "calendar-viewtoggle__btn", { type: "button", "aria-pressed": "false", text: "Week" });
      dayBtn = el(doc, "button", "calendar-viewtoggle__btn", { type: "button", "aria-pressed": "false", text: "Day" });
      agendaBtn = el(doc, "button", "calendar-viewtoggle__btn", { type: "button", "aria-pressed": "false", text: "Agenda" });
      toggle.appendChild(monthBtn); toggle.appendChild(weekBtn); toggle.appendChild(dayBtn); toggle.appendChild(agendaBtn);
      paneEl.appendChild(toggle);
    }

    var host = el(doc, "div", "calendar-host");
    paneEl.appendChild(host);

    var injected = ctx.data && ctx.data.calendar ? ctx.data.calendar : null;

    // The REST client — cold-safe: absent core -> honest unreachable, never a throw.
    var api = (root.calendarRest && typeof root.calendarRest.makeClient === "function")
      ? root.calendarRest.makeClient(ctx.restOpts || {})
      : { events: function () { return Promise.resolve({ ok: false, status: 0, code: "E_NO_CLIENT" }); },
          calendars: function () { return Promise.resolve({ ok: false, status: 0, code: "E_NO_CLIENT" }); },
          get: function () { return Promise.resolve({ ok: false, status: 0, code: "E_NO_CLIENT" }); },
          create: function () { return Promise.resolve({ ok: false }); },
          update: function () { return Promise.resolve({ ok: false }); },
          remove: function () { return Promise.resolve({ ok: false }); } };

    var t = todayParts();
    var state = { year: t.year, month: t.month, day: t.day, view: "month" };
    var mini = null; // B1 — the rail's mini calendar (rail path only; see below)

    function openEdit(ev) { renderNewForm(host, ctx, api, state, backToView, ev); }
    // Return to whatever timed/grid view the operator was last in (record/form back).
    function backToView() {
      if (state.view === "week") return showWeek();
      if (state.view === "day") return showDay();
      if (state.view === "agenda") return showAgenda();
      return showMonth();
    }
    function openRecord(ev) {
      // Have a full record already (injected/tests)? render it; else fetch by id.
      if (injected && injected.records && injected.records[ev.id]) {
        renderRecord(host, ctx, api, injected.records[ev.id], backToView, openEdit); return;
      }
      host.textContent = "";
      host.appendChild(el(doc, "p", "calendar-loading", { text: "Reading \u2026" }));
      api.get(ev.id).then(function (env) {
        if (env.ok && env.data) {
          var rec = env.data.event || env.data;
          renderRecord(host, ctx, api, rec, backToView, openEdit);
        } else {
          host.textContent = "";
          host.appendChild(readFailNode(doc, env));
          var b = el(doc, "button", "calendar-record__back", { type: "button", text: "\u2190 Calendar" });
          b.addEventListener("click", backToView); host.appendChild(b);
        }
      });
    }
    function openNew(st) { renderNewForm(host, ctx, api, st || state, backToView); }
    // E3 — open the create form prefilled from a cross-app intent (Add to calendar, from an
    // email). Prefill title + notes into a fresh state clone; leave start EMPTY (option A:
    // no fabricated event time — the user picks it). backToView restores the grid on save/cancel.
    function openNewPrefilledLive(seed) {
      seed = seed || {};
      var st = { year: state.year, month: state.month, day: state.day, view: state.view,
                 prefillTitle: seed.title || "", prefillNotes: seed.notes || "" };
      renderNewForm(host, ctx, api, st, backToView);
    }
    // Expose the live opener so the module-level openNewPrefilled (called by shell-boot on
    // forest:add-to-calendar) can drive THIS render — mirrors mail's __liveOpenCompose.
    root.calendarRenderer.__liveOpenNewPrefilled = openNewPrefilledLive;
    // owed 779 — the SEARCH open-by-id bridge, the same slot one row down. A hit
    // {store:"calendar", id} must land on the EVENT, not merely on the app.
    // ★ openRecord above reads only `ev.id` — it was already a fetch-then-open (api.get),
    // so a one-key stub is a complete argument. No new transport, no new envelope.
    root.calendarRenderer.__liveOpenById = function (id) {
      var eid = String(id == null ? "" : id);
      if (eid) openRecord({ id: eid });
    };
    /* ---- P2 · My Calendars — the ONE filter joint --------------------------------- *
     * The owner's events arrive through THREE api.events() call sites (renderGrid,     *
     * renderTimeGrid, renderAgenda). Filtering at each of them is three chances to     *
     * diverge, and the third one always gets forgotten. So the filter is installed     *
     * ONCE, here, by wrapping the client the views are handed. Every window every view *
     * ever draws passes through this one function. There is no second path.            *
     *                                                                                  *
     * COLD-SAFE at every step: absent module -> `api` passes through untouched and the *
     * calendar behaves exactly as it does today; absent /api/calendars -> calList stays *
     * empty, no picker is offered, `calChecked` stays null, and the filter FAILS OPEN   *
     * (calendar-calendars.js: a null checked set returns everything). A slow or dead    *
     * calendars seam can never blank the month.                                         *
     *                                                                                  *
     * SEARCH IS DELIBERATELY UNFILTERED. A search is an explicit act with an explicit   *
     * query — you asked for it by name, so you get it, from wherever it lives (Google   *
     * Calendar behaves the same way). The rail's checkboxes scope what you are BROWSING, *
     * not what you can FIND. Silently withholding a search hit the owner typed the      *
     * words for is the kind of thing that makes a person stop trusting the search box.  */
    var calMod = root.calendarCalendars || null;   // root IS window.ForestShell (see line ~76); the prior root.ForestShell.calendarCalendars read ForestShell.ForestShell.* = always undefined, so calMod was permanently null and the WHOLE "My calendars" picker (recolor/solo/reorder/create/delete) never rendered. Siblings use root.calendarRest / root.block / root.honestBadge — this now matches. Bug survived because the wire tests inject calMod directly and never exercise THIS resolution seam.
    var calList = [];        // the tool's /api/calendars rows, verbatim
    var calChecked = null;   // null = no preference expressed yet -> filter fails OPEN
    var calGroup = null;     // the rail's "My Calendars" group node (rail path only)
    var lastWindow = [];     // the last UNFILTERED window — the slot counts read this
    // Verb 4 — the LIVE order mirror (the calChecked sibling): seeded from the durable
    // view-config (calOrderOf), updated optimistically on a drag, persisted back through
    // shell-boot's forest:cal-reorder listener (survives reload). Cold-safe: no viewConfig
    // -> [] -> applyOrder is a no-op -> derived (alphabetical) order, exactly as today.
    var calOrder = (root.viewConfig && typeof root.viewConfig.calOrderOf === "function")
      ? root.viewConfig.calOrderOf(ctx.config) : [];
    var _calDragId = null;   // the id in hand during a rail drag (never read back out of dataTransfer)

    function makeViewApi(base) {
      if (!calMod) return base;
      var out = {};
      for (var k in base) {
        out[k] = (typeof base[k] === "function" && base[k].bind) ? base[k].bind(base) : base[k];
      }
      out.events = function (q) {
        return base.events(q).then(function (r) {
          if (!r || !r.ok || !r.data || !r.data.events) return r;   // honest errors pass through
          lastWindow = r.data.events;
          paintCalendarSlots();                                     // counts + present-gating
          return { ok: true, status: r.status,
                   data: { events: calMod.filter(lastWindow, calChecked) } };
        });
      };
      return out;
    }
    var viewApi = makeViewApi(api);

    function reshowCurrent() {
      var v = VIEWS.filter(function (x) { return x.id === state.view; })[0];
      (v ? v.show : showMonth)();
    }

    /* Build (or rebuild) the calendar slots. PRESENT-GATED: a single calendar with no
       un-assigned events needs no picker at all, so the group renders nothing — the same
       rule mail's Spam view-word runs (never offer a control onto a set of one). */
    // Open the recolor picker off a calendar's rail dot: 12 Grove swatches + a
    // "Default" revert chip, anchored under the dot. Pick IS commit — optimistic
    // in-place repaint (the count-toggle contract: the view repaints itself, then
    // dispatches up for the host to persist). slot === null on the Default chip.
    function openRecolorPopover(anchorDot, id) {
      closeColorPopover();
      closePopover();                                  // never two popovers at once
      if (!id) return;
      var current = (OVERRIDES && id in OVERRIDES) ? (OVERRIDES[id] | 0) : defaultSlotIndex(id);
      var pop = el(doc, "div", "calendar-recolor", {
        role: "menu", "aria-label": "Recolor this calendar"
      });
      var swatches = [];
      function commit(slot) {                          // slot: 0..11 or null (revert)
        if (slot === null) { if (OVERRIDES) delete OVERRIDES[id]; }
        else if (OVERRIDES) { OVERRIDES[id] = slot; }
        emitCalRecolor(anchorDot, id, slot);           // persist via shell-boot (dot still attached)
        closeColorPopover();
        paintCalendarSlots();                          // rail dot repaints from OVERRIDES
        reshowCurrent();                               // grid chips repaint through the one joint
      }
      var grid = el(doc, "div", "calendar-recolor__grid");
      CAL_PALETTE.forEach(function (hue, i) {
        var sw = el(doc, "button", "calendar-recolor__swatch", {
          type: "button", role: "menuitemradio", "data-slot": String(i),
          "aria-checked": i === current ? "true" : "false",
          "aria-label": "Grove color " + (i + 1) + (i === current ? " (current)" : "")
        });
        if (sw.style) sw.style.background = hue;
        if (i === current) { if (sw.classList) sw.classList.add("is-current"); else sw.className += " is-current"; }
        sw.addEventListener("click", function (e) { if (e && e.stopPropagation) e.stopPropagation(); commit(i); });
        grid.appendChild(sw);
        swatches.push(sw);
      });
      pop.appendChild(grid);
      var revert = el(doc, "button", "calendar-recolor__default", {
        type: "button", role: "menuitem", text: "Default",
        "aria-label": "Revert to the default color"
      });
      revert.addEventListener("click", function (e) { if (e && e.stopPropagation) e.stopPropagation(); commit(null); });
      pop.appendChild(revert);

      // Keyboard: ←/→ move across swatches, Escape dismisses (Enter/Space fire the button click).
      pop.addEventListener("keydown", function (e) {
        var key = e && e.key;
        if (key === "Escape" || key === "Esc") { if (e.preventDefault) e.preventDefault(); closeColorPopover(); if (anchorDot && anchorDot.focus) anchorDot.focus(); return; }
        if (key !== "ArrowLeft" && key !== "ArrowRight") return;
        if (e.preventDefault) e.preventDefault();
        var focused = swatches.indexOf(doc.activeElement);
        if (focused === -1) focused = 0;
        var n = swatches.length, delta = key === "ArrowRight" ? 1 : -1;
        var next = swatches[((focused + delta) % n + n) % n];
        if (next && next.focus) next.focus();
      });

      // Position near the anchor (headless: falls back to a static card).
      if (anchorDot && typeof anchorDot.getBoundingClientRect === "function") {
        var r = anchorDot.getBoundingClientRect();
        pop.style.position = "fixed";
        pop.style.top = (r.bottom + 4) + "px";
        pop.style.left = r.left + "px";
      }
      doc.body.appendChild(pop);
      _openColorPopover = pop;
      // Outside-click dismiss (capture; deferred so the opening click doesn't close it).
      var onDoc = function (e) { if (!pop.contains || !pop.contains(e.target)) closeColorPopover(); };
      var arm = function () { try { doc.addEventListener("click", onDoc, true); } catch (e) {} _colorDismiss = { doc: doc, fn: onDoc }; };
      if (doc.defaultView && doc.defaultView.setTimeout) doc.defaultView.setTimeout(arm, 0); else arm();
      if (swatches[current] && swatches[current].focus) swatches[current].focus();
      else if (swatches[0] && swatches[0].focus) swatches[0].focus();
      return pop;
    }

    /* ── VERB 4 — REORDER (drag) — the rail-slot drag machinery ────────────────
       The rail is a MOVING surface, so per the drag-feel contract §5 the no-op-return
       is legible by MOTION (release in place = no slide = no change), not the colour
       home-mark the static grid uses. Native HTML5 drag (the tab-strip carry), plus a
       keyboard path (Ctrl/Meta+Arrow), both driving ONE seam. Feel beats reused from
       the calendar's own helpers: is-grabbed (grab-lift) · is-drop-target · the shared
       flipReschedule (FLIP settle, reduced-motion-collapsing). UNASSIGNED is never
       draggable (calMod.applyOrder pins it last; a bucket is not a calendar). */
    function calRealIds() {
      return calMod.applyOrder(calMod.slots(calList, lastWindow), calOrder)
        .filter(function (s) { return !s.unassigned; })
        .map(function (s) { return String(s.id); });
    }
    function findSlotNode(id) {
      if (!calGroup || typeof calGroup.querySelector !== "function") return null;
      try { return calGroup.querySelector('[data-calendar="' + String(id).replace(/"/g, '\\"') + '"]'); }
      catch (e) { return null; }
    }
    function clearRailDragPaint() {
      if (!calGroup || typeof calGroup.querySelectorAll !== "function") return;
      var nodes = calGroup.querySelectorAll(".rail__slot");
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].classList) { nodes[i].classList.remove("is-drop-target"); nodes[i].classList.remove("is-grabbed"); }
      }
    }
    function endCalDrag() { _calDragId = null; clearRailDragPaint(); }
    // Move draggedId to sit at targetId's CURRENT index (pre-removal), the browser-tab
    // convention the tab strip uses: drag onto a later row -> land after it; onto an
    // earlier row -> take its place. Optimistic paint (FLIP) + persist. No server
    // round-trip: the order is a client pref, so the optimistic paint IS the truth.
    function commitCalReorder(draggedId, targetId, sourceNode) {
      var cur = calRealIds();
      var tIdx = cur.indexOf(String(targetId));
      if (tIdx < 0) return;                                  // dropped on a non-real slot
      var next = calMod.reorder(cur, String(draggedId), tIdx);
      if (next.join("\u0001") === cur.join("\u0001")) return;   // no real move -> nothing
      calOrder = next;
      var firstRect = (sourceNode && sourceNode.getBoundingClientRect) ? sourceNode.getBoundingClientRect() : null;
      flipReschedule(doc, firstRect, paintCalendarSlots, function () { return findSlotNode(draggedId); });
      emitCalReorder(calGroup, next);                        // persist -> survives reload
    }
    function moveCalRow(id, dir) {                           // dir: -1 up, +1 down (keyboard)
      var cur = calRealIds();
      var at = cur.indexOf(String(id));
      if (at < 0) return;
      var to = at + dir;
      if (to < 0 || to >= cur.length) return;                // at an end -> no move
      var next = calMod.reorder(cur, String(id), to);
      calOrder = next;
      var srcNode = findSlotNode(id);
      var firstRect = (srcNode && srcNode.getBoundingClientRect) ? srcNode.getBoundingClientRect() : null;
      flipReschedule(doc, firstRect, paintCalendarSlots, function () { return findSlotNode(id); });
      emitCalReorder(calGroup, next);
      var moved = findSlotNode(id);
      if (moved && typeof moved.focus === "function") moved.focus();   // keep focus on the moved row
    }
    function wireCalRowDrag(slotNode, id) {
      if (slotNode.setAttribute) slotNode.setAttribute("draggable", "true");
      slotNode.addEventListener("dragstart", function (e) {
        _calDragId = String(id);
        if (e && e.dataTransfer) {
          try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(id)); } catch (_) {}
        }
        if (slotNode.classList) slotNode.classList.add("is-grabbed");   // GRAB: lift the source
      });
      slotNode.addEventListener("dragover", function (e) {
        if (!_calDragId) return;                               // not our drag (a file, a link)
        if (e && e.preventDefault) e.preventDefault();         // THIS makes the node a drop target
        if (e && e.dataTransfer) { try { e.dataTransfer.dropEffect = "move"; } catch (_) {} }
        clearRailDragPaint();
        if (String(id) !== _calDragId && slotNode.classList) slotNode.classList.add("is-drop-target");
      });
      slotNode.addEventListener("drop", function (e) {
        if (!_calDragId) return;
        if (e && e.preventDefault) e.preventDefault();
        var dragged = _calDragId;
        var srcNode = findSlotNode(dragged);
        endCalDrag();                                          // paint down before we commit
        if (String(id) === dragged) return;                   // dropped on itself -> no-op (motion-legible)
        commitCalReorder(dragged, String(id), srcNode);
      });
      slotNode.addEventListener("dragend", function () { endCalDrag(); });  // abandoned drag still clears
      // KEYBOARD reorder: Ctrl/Meta + Arrow Up/Down — distinct from Enter/Space (toggle)
      // and the label's Enter (rename); shares the one reorder seam (a11y parity).
      slotNode.addEventListener("keydown", function (e) {
        if (!e || !(e.ctrlKey || e.metaKey)) return;
        var key = e.key;
        if (key !== "ArrowUp" && key !== "ArrowDown") return;
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        moveCalRow(id, key === "ArrowUp" ? -1 : 1);
      });
    }

    function paintCalendarSlots() {
      if (!calGroup || !calMod) return;
      // Verb 4: the derived slots (server ORDER BY name), re-sequenced by the owner's
      // persisted rail order; applyOrder pins UNASSIGNED last no matter the order.
      var slots = calMod.applyOrder(calMod.slots(calList, lastWindow), calOrder);
      while (calGroup.firstChild) calGroup.removeChild(calGroup.firstChild);
      if (slots.length < 2) return;                       // nothing to choose between
      if (calChecked === null) calChecked = calMod.defaultChecked(calList, lastWindow);

      // The group head carries the CREATE affordance: a + mints a new calendar-type
      // IN THE RAIL (no modal, no Settings room -- the "settings pane is a room with
      // two doors" scar). Click/Enter -> a blank inline input, the create sibling of
      // the slot label's rename. A click here must not bubble to any slot toggle.
      var calHead = el(doc, "div", "rail__group-label", { text: "My calendars" });
      var calAdd = el(doc, "button", "rail__group-add", {
        type: "button", "aria-label": "New calendar", text: "\u002B"   // "+"
      });
      calAdd.addEventListener("click", function (e) {
        if (e && e.stopPropagation) e.stopPropagation();
        openCreateCalendarInput();
      });
      calAdd.addEventListener("keydown", function (e) {
        var key = e && e.key;
        if (key === "Enter" || key === " " || key === "Spacebar") {
          if (e.preventDefault) e.preventDefault();
          if (e.stopPropagation) e.stopPropagation();
          openCreateCalendarInput();
        }
      });
      calHead.appendChild(calAdd);
      calGroup.appendChild(calHead);
      // Distinct-under-clip: compute the visible labels across the WHOLE set at once
      // (a collision is a property of the set, not one name); the full name stays on title.
      var calDisp = distinctCalLabels(slots.map(function (x) { return x.name; }));
      slots.forEach(function (s, i) {
        var on = calChecked.indexOf(s.id) !== -1;
        var slot = el(doc, "div", "rail__slot rail__slot--checked", {
          role: "checkbox", tabindex: "0", "data-calendar": s.id,
          "aria-checked": on ? "true" : "false",
          "aria-label": s.name + " calendar"
        });
        // The tick is a GLYPH, not a background colour: the on-state must survive a
        // stylesheet that never loaded, or the owner cannot tell what he is looking at.
        slot.appendChild(el(doc, "span", "rail__slot-box", { text: on ? "\u2713" : "" }));
        // The NAME is the rename affordance (step 3: management IN THE RAIL, no modal).
        // Click / Enter the label -> it becomes an inline input (beginRenameCalendar).
        // A click/keydown here must NOT bubble to the slot's calendar toggle, so both
        // stop it -- the same division the recolor dot uses: click the NAME to rename,
        // click the BOX/row to show/hide.
        var label = el(doc, "span", "rail__slot-label", {
          text: calDisp[i], title: s.name,   // visible = distinct-under-clip; full name on hover + AT
          role: "button", tabindex: "0", "aria-label": "Rename " + s.name
        });
        (function (calId, labelNode) {
          labelNode.addEventListener("click", function (e) {
            if (e && e.stopPropagation) e.stopPropagation();
            beginRenameCalendar(labelNode, calId);
          });
          labelNode.addEventListener("keydown", function (e) {
            var key = e && e.key;
            if (key === "Enter" || key === " " || key === "Spacebar") {
              if (e.preventDefault) e.preventDefault();
              if (e.stopPropagation) e.stopPropagation();
              beginRenameCalendar(labelNode, calId);
            }
          });
        })(s.id, label);
        slot.appendChild(label);
        // The swatch reads the SAME Grove-palette hue paintCalHue puts on the
        // events (resolveCalColor(s.id, OVERRIDES) — the override-aware read; equals
        // calHue when the owner has not recolored this type), not Google's imported
        // backgroundColor — so the rail is an honest legend for the colors on the
        // grid. UNASSIGNED (no id) returns "" -> no dot, matching its neutral events.
        var swatch = resolveCalColor(s.id, OVERRIDES);
        if (swatch) {
          // The dot is the recolor TRIGGER (the color IS the affordance — no separate
          // "edit colors" control). It opens the Grove-slot picker; a click/keydown
          // here must NOT bubble to the slot's calendar toggle, so both stop it.
          var dot = el(doc, "button", "rail__slot-dot", {
            type: "button", "aria-haspopup": "menu",
            "aria-label": "Recolor " + s.name
          });
          if (dot.style) dot.style.background = swatch;   // identity, not status
          (function (calId, dotNode) {
            dotNode.addEventListener("click", function (e) {
              if (e && e.stopPropagation) e.stopPropagation();
              openRecolorPopover(dotNode, calId);
            });
            dotNode.addEventListener("keydown", function (e) {
              var key = e && e.key;
              if (key === "Enter" || key === " " || key === "Spacebar") {
                if (e.preventDefault) e.preventDefault();
                if (e.stopPropagation) e.stopPropagation();
                openRecolorPopover(dotNode, calId);
              }
            });
          })(s.id, dot);
          slot.appendChild(dot);
        }
        // The reveal cluster : solo + delete live here — calm at rest,
        // revealed on row hover/focus — so the NAME reclaims their width at rest
        // (CSS: .rail__slot-actions is absolute + opacity 0 until :hover/:focus-within).
        var actions = el(doc, "div", "rail__slot-actions");
        // The SOLO control ("only this"): a bulk view op that shows ONLY this
        // calendar (hides all others) via calMod.solo -- a bulk-set of the SAME
        // visible-set the row toggle drives. Ephemeral, exactly like that toggle:
        // colour/density persist, the visible-set does not, so this dispatches
        // NOTHING and touches no write seam (it is a local view op, not a recolor).
        // Clicking the soloed row's control again restores ALL (solo returns null).
        // The glyph is text so the on/off state survives a stylesheet that never
        // loaded (the rail__slot-box tick principle). Click/keydown must NOT bubble
        // to the row's calendar toggle, so both stop it -- the recolor-dot division.
        var soloed = calChecked.length === 1 && String(calChecked[0]) === String(s.id);
        var soloBtn = el(doc, "button", "rail__slot-solo" + (soloed ? " is-soloed" : ""), {
          type: "button", "aria-pressed": soloed ? "true" : "false",
          "aria-label": soloed ? ("Show all calendars (currently only " + s.name + ")")
                                : ("Show only " + s.name)
        });
        soloBtn.appendChild(el(doc, "span", "rail__slot-solo-glyph", {
          text: soloed ? "\u25C9" : "\u25CE"   // \u25C9 filled ring (soloed) / \u25CE ring (not)
        }));
        (function (calId, btnNode) {
          function fireSolo(e) {
            if (e && e.stopPropagation) e.stopPropagation();
            if (e && e.preventDefault) e.preventDefault();
            calChecked = calMod.solo(calChecked, calId);   // [id] or null (un-solo -> all)
            paintCalendarSlots();   // rail repaints: aria-pressed + glyph flip, ticks re-derive
            reshowCurrent();        // grid repaints through the same one joint
          }
          btnNode.addEventListener("click", fireSolo);
          btnNode.addEventListener("keydown", function (e) {
            var key = e && e.key;
            if (key === "Enter" || key === " " || key === "Spacebar") fireSolo(e);
          });
        })(s.id, soloBtn);
        actions.appendChild(soloBtn);
        // Verb 6: the ✕ DELETE affordance — REAL calendars only. Gated on
        // !s.unassigned (the SAME discriminator the drag wire uses at wireCalRowDrag,
        // NOT s.id: the UNASSIGNED bucket carries the "__unassigned__" SENTINEL id, so
        // an s.id-truthy gate would wrongly hand it a ✕ — it is the bucket, not a type,
        // and the runtime 400s a delete of it anyway). This is a DESTRUCTIVE control,
        // so it does NOT delete on the first press: it ARMS an inline two-step confirm
        // (beginCalDelete, mirroring beginCalNameEdit) — NO native confirm(). A
        // click/keydown here must NOT bubble to the slot's calendar toggle, so both
        // stop it, the recolor-dot division exactly.
        if (s.id && !s.unassigned) {
          var del = el(doc, "button", "rail__slot-del", {
            type: "button", "aria-label": "Delete " + s.name + " calendar"
          });
          del.appendChild(el(doc, "span", "rail__slot-del-glyph", { text: "\u2715" }));  // ✕
          (function (calId, calName, delNode) {
            function arm(e) {
              if (e && e.stopPropagation) e.stopPropagation();
              if (e && e.preventDefault) e.preventDefault();
              beginCalDelete({ node: delNode, id: calId, name: calName });
            }
            delNode.addEventListener("click", arm);
            delNode.addEventListener("keydown", function (e) {
              var key = e && e.key;
              if (key === "Enter" || key === " " || key === "Spacebar") arm(e);
            });
          })(s.id, s.name, del);
          actions.appendChild(del);
        }
        slot.appendChild(actions);
        activate(slot, function () {
          calChecked = calMod.toggle(calChecked, s.id);
          reshowCurrent();      // re-draw the current view through the same one joint
        });
        // Verb 4: real calendars are drag-reorderable; the UNASSIGNED bucket is not
        // (applyOrder pins it last, so a drag could never move it anyway — but making
        // it non-draggable keeps the affordance honest: you cannot grab what cannot move).
        if (!s.unassigned) wireCalRowDrag(slot, s.id);
        calGroup.appendChild(slot);
      });
    }

    function findCalRow(id) {
      for (var i = 0; i < calList.length; i++) if (calList[i] && calList[i].id === id) return calList[i];
      return null;
    }

    /* Distinguishable-Under-Clip (— pattern P-071). The rail column is narrow,
     * so CSS ellipsis TAIL-clips a long name. Names that share a long PREFIX ("Marijuana
     * Business Today — Alpha" / "— Beta") then clip to the SAME visible string, and the
     * picker can no longer tell them apart — a hover-per-row tax that defeats the picker's
     * one job. Invariant: no two VISIBLE labels may collapse to the same string. Only LONG
     * names that ACTUALLY collide when tail-clipped are transformed — to a LEADING-ellipsis
     * form that shows the TAIL (where prefix-collisions diverge). Short names (the common
     * case now that the reveal gives the name the whole column) are returned untouched, and
     * the FULL name always rides title + aria-label. Set-scoped: a collision is a property
     * of the whole visible set, not of one name, so it is computed over all names at once. */
    function distinctCalLabels(names, budget) {
      budget = budget || 22;
      var s = names.map(function (n) { return String(n == null ? "" : n); });
      var counts = {};
      s.forEach(function (n) { var k = n.slice(0, budget); counts[k] = (counts[k] || 0) + 1; });
      return s.map(function (n) {
        if (n.length <= budget) return n;                 // fits -> full name, no elision
        if (counts[n.slice(0, budget)] <= 1) return n;    // clips but stays unique -> let CSS ellipsis do it
        var keepTail = Math.max(6, budget - 2);           // colliding + long -> show the distinguishing TAIL
        return "\u2026" + n.slice(n.length - keepTail);   // leading ellipsis; prefix-divergent names now differ
      });
    }

    /* Step 3 verb 2 -- MINT a client id for a NEW calendar-type. The frozen tool serves
     * POST /api/calendars as an id-keyed upsert, so an id it has never seen INSERTs.
     * "local:" marks a type born IN THE RAIL (vs an account-synced id like "work@x");
     * the slug keeps it human-legible, the short-rand suffix keeps two same-named types
     * from colliding. Born on-brand: the row carries id + name ONLY, no color, so
     * resolveCalColor === calHue holds (the north star -- zero decisions at create). */
    function _calShortRand() {
      return (Math.floor(Math.random() * 0x100000).toString(36) +
              Math.floor(Math.random() * 0x100000).toString(36));
    }
    function _calSlug(name) {
      var s = String(name == null ? "" : name).toLowerCase()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
      return s || "cal";
    }
    function mintCalId(name) { return "local:" + _calSlug(name) + "-" + _calShortRand(); }

    /* Step 3 -- the rail's inline calendar-name editor, SHARED by RENAME (an existing
     * slot's label becomes an input) and CREATE (a blank input at the group head mints
     * a NEW type). Both COMMIT on Enter/blur, CANCEL on Escape, and write through the
     * ONE endpoint the frozen tool serves: POST /api/calendars (upsert -- a new id
     * INSERTs, an existing id re-fields). Persistence is a WRITE to the calendar
     * registry (unlike recolor, which is client view-config), so it POSTs through the
     * rest client the renderer already holds (api.saveCalendar). OPTIMISTIC: repaint
     * at once, POST behind it, FLAG-DON'T-FAKE on a non-ok write. Empty/unchanged =
     * no write. Byte-verified STATIC (the runtime seam forwards POST method-agnostically). */
    var _editingCal = false;
    function beginCalNameEdit(opts) {
      opts = opts || {};
      var mode = opts.mode === "create" ? "create" : "rename";
      var node = opts.node;                          // rename: the label span; create: a fresh slot's label
      if (_editingCal || !node) return;
      var row = mode === "rename" ? findCalRow(opts.id) : null;
      if (mode === "rename" && !row) return;
      _editingCal = true;
      var doc2 = node.ownerDocument || doc;
      var oldName = row ? row.name : "";
      var input = el(doc2, "input", "rail__slot-rename field", {
        type: "text", "aria-label": mode === "create" ? "New calendar name" : "Rename calendar"
      });
      input.value = oldName;                         // rename seeds the current name; create seeds blank
      node.textContent = "";
      node.appendChild(input);
      if (input.focus) input.focus();
      var closed = false;
      function finish(commit) {
        if (closed) return; closed = true; _editingCal = false;
        var newName = commit ? String(input.value == null ? "" : input.value).trim() : "";
        if (mode === "rename") {
          if (!commit || newName === "" || newName === oldName) { paintCalendarSlots(); return; }
          row.name = newName;                        // optimistic -- repaint before the wire
          paintCalendarSlots();
          if (api && typeof api.saveCalendar === "function") {
            api.saveCalendar({ id: opts.id, name: newName, color: row.color, source: row.source, account: row.account })
              .then(function (r) {
                if (!r || !r.ok) { row.name = oldName; paintCalendarSlots(); }   // flag-don't-fake: revert
              });
          }
          return;
        }
        // CREATE: empty/cancel repaints away the blank input; a real name INSERTs a new type.
        if (!commit || newName === "") { paintCalendarSlots(); return; }
        var newRow = { id: mintCalId(newName), name: newName };   // born on-brand: id + name ONLY, no color
        calList.push(newRow);                        // optimistic -- the new slot appears at once
        paintCalendarSlots();
        if (api && typeof api.saveCalendar === "function") {
          api.saveCalendar({ id: newRow.id, name: newRow.name })   // NO color key -> resolveCalColor === calHue
            .then(function (r) {
              if (!r || !r.ok) {                     // flag-don't-fake: drop the row the server refused
                var i = calList.indexOf(newRow);
                if (i !== -1) calList.splice(i, 1);
                paintCalendarSlots();
              }
            });
        }
      }
      input.addEventListener("keydown", function (e) {
        var key = e && e.key;
        if (e && e.stopPropagation) e.stopPropagation();
        if (key === "Enter") { if (e.preventDefault) e.preventDefault(); finish(true); }
        else if (key === "Escape" || key === "Esc") { if (e.preventDefault) e.preventDefault(); finish(false); }
      });
      input.addEventListener("blur", function () { finish(true); });
      input.addEventListener("click", function (e) { if (e && e.stopPropagation) e.stopPropagation(); });
    }
    // Thin wrappers -- callers keep their names; the machinery is shared.
    function beginRenameCalendar(labelNode, id) { beginCalNameEdit({ mode: "rename", node: labelNode, id: id }); }
    // CREATE opens a blank input as a fresh, id-less slot at the head of My calendars.
    function openCreateCalendarInput() {
      if (_editingCal || !calGroup) return;
      var slot = el(doc, "div", "rail__slot rail__slot--creating");
      var label = el(doc, "span", "rail__slot-label");
      slot.appendChild(label);
      // a fresh, id-less slot appended to the group; the commit's repaint wipes it and
      // draws the real slot from calList, so its position here is transient (no need to
      // depend on nextSibling ordering -- append is browser- and test-shim-safe).
      calGroup.appendChild(slot);
      beginCalNameEdit({ mode: "create", node: label });
    }

    // Verb 6 — the ✕'s inline two-step confirm, the DESTRUCTIVE sibling of
    // beginCalNameEdit. The ✕ (opts.node) is replaced IN PLACE by a single confirm
    // control carrying honest wording ("Delete <name>? -> events move to Unassigned").
    // No native confirm(). A second press COMMITS; blur/Escape DISARMS. Commit is
    // optimistic-with-honesty: emit forest:cal-delete {id} up (the shell-boot host
    // strips the view-config residue), remove the row from calList + repaint, then
    // drive api.deleteCalendar(id) — and if the server refuses (!ok), RE-ADD the row
    // at its original index (flag-don't-fake). NEVER commits on blur: a destructive
    // action must not fire because focus wandered (the recolor/rename twins commit on
    // blur; a delete does the opposite, on purpose).
    function beginCalDelete(opts) {
      opts = opts || {};
      var node = opts.node, id = opts.id, name = opts.name;
      if (_editingCal || !node || !id) return;         // no id -> UNASSIGNED -> never
      var row = findCalRow(id);
      if (!row) return;
      var idx = calList.indexOf(row);
      _editingCal = true;
      var doc2 = node.ownerDocument || doc;
      node.textContent = "";
      var confirm = el(doc2, "button", "rail__slot-del-confirm", {
        type: "button",
        "aria-label": "Confirm delete " + name + " \u2014 its events move to Unassigned"
      });
      confirm.appendChild(el(doc2, "span", "rail__slot-del-confirm-label", {
        text: "Delete \u2192 Unassigned"
      }));
      node.appendChild(confirm);
      if (confirm.focus) confirm.focus();
      var closed = false;
      function finish(commit) {
        if (closed) return; closed = true; _editingCal = false;
        if (!commit) { paintCalendarSlots(); return; }   // disarm -> repaint restores the ✕
        emitCalDelete(confirm, id);                       // emit BEFORE the repaint wipes the node
        if (idx !== -1) calList.splice(idx, 1);           // optimistic remove
        paintCalendarSlots();
        if (api && typeof api.deleteCalendar === "function") {
          api.deleteCalendar(id).then(function (r) {
            if (!r || !r.ok) {                            // flag-don't-fake: re-add where it was
              if (idx !== -1) calList.splice(idx, 0, row); else calList.push(row);
              paintCalendarSlots();
            }
          });
        }
      }
      // FIX — commit on MOUSEDOWN, not click. The confirm is armed WITH focus, and
      // it is appended inside the ✕ button; a plain `click` commit was lost to the `blur` disarm
      // below, because blur fires during the click's mousedown (before the click event), sets
      // `closed`, and finish(true) then early-returns — so deleteCalendar was NEVER called (the
      // ✕ vanished, the calendar stayed put, and NO DELETE request left the browser: proven by
      // the pre-gate cal_req_ring showing GETs but no DELETE). mousedown fires before blur, and
      // preventDefault holds focus on the confirm so it cannot self-blur. The click handler stays
      // as an idempotent (closed-guarded) fallback for AT/synthetic activation.
      confirm.addEventListener("mousedown", function (e) {
        if (e && e.stopPropagation) e.stopPropagation();
        if (e && e.preventDefault) e.preventDefault();
        finish(true);
      });
      confirm.addEventListener("click", function (e) {
        if (e && e.stopPropagation) e.stopPropagation();
        if (e && e.preventDefault) e.preventDefault();
        finish(true);
      });
      confirm.addEventListener("keydown", function (e) {
        var key = e && e.key;
        if (e && e.stopPropagation) e.stopPropagation();
        if (key === "Enter" || key === " " || key === "Spacebar") { if (e.preventDefault) e.preventDefault(); finish(true); }
        else if (key === "Escape" || key === "Esc") { if (e.preventDefault) e.preventDefault(); finish(false); }
      });
      confirm.addEventListener("blur", function () { finish(false); });   // destructive: disarm, never commit
    }

    // Verb 6 — dispatch forest:cal-delete { id } UP to the shell-boot pane host, the
    // exact mirror of the forest:cal-recolor emit: a bubbling CustomEvent from a live
    // node, cold-safe (best-effort, never a render throw). The host strips the id from
    // calColors (revertCalColor) AND calOrder (setCalOrder minus id) so no residue
    // survives to resurface if an id is ever reused.
    function emitCalDelete(fromNode, id) {
      try {
        var doc2 = fromNode.ownerDocument, view = doc2 && doc2.defaultView;
        var detail = { id: id };
        var ev = (view && typeof view.CustomEvent === "function")
          ? new view.CustomEvent("forest:cal-delete", { detail: detail, bubbles: true })
          : { type: "forest:cal-delete", detail: detail, bubbles: true };
        if (typeof fromNode.dispatchEvent === "function") fromNode.dispatchEvent(ev);
      } catch (e) { /* cold-safe: best-effort, never a render throw */ }
    }

    /* B1 — the rail's ear on the cursor. `mini` is built below (rail path only), so this
     * is a late-bound no-op on the fallback path and on any frame with no [data-app-menu].
     *
     * ★ ALL FOUR VIEWS PASS IT NOW. Agenda used to take none, on the reasoning that it
     * "reads no cursor at all." That reasoning was the bug (seq=107), not a design: it
     * meant the mini could move the cursor while the agenda list stood still, and the
     * ring said one thing while the list said another. Three callers, one seam. */
    function syncMini() { if (mini) mini.sync(); }

    /* ---- THE ONE AUTHORING SITE FOR CALENDAR-SCOPED CONTROLS (C) --------- *
     * The C fork asked "does week/day get iCal, does agenda get a head?" Both       *
     * questions are the same question wearing different nouns, and the answer is    *
     * neither yes nor no: iCal was never a VIEW control. `+ New event` was not one   *
     * either — and worse, it was a DUPLICATE: the rail's `.rail__compose` ("Create") *
     * calls the same openNew(state) and is present on all four views already,        *
     * because it lives in menuBody, outside the view host.                           *
     *                                                                                *
     * So: the head keeps ONLY what moves a cursor. Calendar-scoped controls live in   *
     * the RAIL, where every view gets them for the same reason Create already does.   *
     * `+ New event` is DELETED, not moved — the rail's Create IS it.                  *
     *                                                                                *
     * §6.5 IS HONOURED, NOT SKIPPED. "A capability gets a fallback; decoration gets   *
     * none." On a frame with NO [data-app-menu] there is no rail, hence no Create and  *
     * no rail iCal — so on THAT path the head re-adopts both. `headActions()` is the   *
     * whole of that rule, in one place, and it is asserted from both sides in          *
     * calendar-scope-split.test.js sections A and C.                                   *
     *                                                                                 *
     * `reshowCurrent` is the import's repaint: it re-shows whatever view is live, so   *
     * an import landing while you stand in Agenda repaints Agenda. It is NOT a cursor   *
     * move and does not ring the rail (the B1 rule: an import is not a *
     * navigation) — re-showing a view never fires that view's onCursor.                 */
    function headActions() {
      if (railInMenu) return [];                       // the rail carries them; the head must not
      return [actionNewEvent(doc, state, openNew)].concat(actionsICal(doc, api, reshowCurrent));
    }
    function showMonth() { setToggle("month"); renderGrid(host, ctx, viewApi, state, injected, openRecord, openNew, syncMini, headActions(), function (y, mo, d) { state.year = y; state.month = mo; state.day = d; showDay(); }); }
    function showWeek() { setToggle("week"); renderTimeGrid(host, ctx, viewApi, state, injected, openRecord, openNew, "week", openEdit, syncMini, headActions()); }
    function showDay() { setToggle("day"); renderTimeGrid(host, ctx, viewApi, state, injected, openRecord, openNew, "day", openEdit, syncMini, headActions()); }
    function showAgenda() { setToggle("agenda"); renderAgenda(host, ctx, viewApi, state, injected, openRecord, syncMini, headActions()); }
    /* ---- the four views, once ------------------------------------------------- *
     * ONE table, read by both controls. `state.view` was ALREADY exclusive-select   *
     * (`month|week|day|agenda`) and setToggle already maintained exactly-one-active *
     * — which is precisely why the views win the rail's navigation slot (-B *
     * §3): `.rail__slot--active` + `aria-current` is a 1:1 map onto machinery that  *
     * exists. ZERO growth of the shared vocabulary. The exclusive-select logic below *
     * is the OLD logic, kept verbatim in behaviour and merely pointed at whichever   *
     * control this frame built.                                                     */
    var VIEWS = [
      { id: "month",  label: "Month",  show: function () { showMonth(); } },
      { id: "week",   label: "Week",   show: function () { showWeek(); } },
      { id: "day",    label: "Day",    show: function () { showDay(); } },
      { id: "agenda", label: "Agenda", show: function () { showAgenda(); } }
    ];
    var railSlots = null;   // the four .rail__slot nodes, in VIEWS order (rail path only)

    function setToggle(v) {
      closePopover();   // a view change dismisses any open quick-action popover
      closeColorPopover();  // ...and any open recolor picker
      state.view = v;
      // RAIL path — .rail__slot--active + aria-current follow state.view. Exactly one.
      if (railSlots) {
        VIEWS.forEach(function (view, i) {
          var on = view.id === v;
          // className assignment, not classList: the house's minimal test shim has no
          // classList, and the rail must be provable under it (mail-menu.test.js's shim).
          railSlots[i].className = "rail__slot" + (on ? " rail__slot--active" : "");
          railSlots[i].setAttribute("aria-current", on ? "true" : "false");
        });
      }
      // FALLBACK path — the in-pane toggle, unchanged.
      if (toggle) {
        [[monthBtn, "month"], [weekBtn, "week"], [dayBtn, "day"], [agendaBtn, "agenda"]].forEach(function (pair) {
          var on = pair[1] === v;
          pair[0].classList.toggle("is-on", on); pair[0].setAttribute("aria-pressed", on ? "true" : "false");
        });
      }
    }

    /* ---- the rail (§6.3) — Create + the four views, and NOTHING else ----------- *
     * A RELOCATION, NOT A REBUILD: every row here routes to a function that already *
     * existed above. `Create` -> openNew -> api.create (POST /api/events). Each view *
     * -> showX -> api.events over that view's window. Five slots, five behaviours,   *
     * zero placeholders.                                                             *
     *                                                                                *
     * NO `.rail__count`, ever (-B §4, Cut 1) — and the test locks its absence. *
     * A count beside a VIEW is one set counted twice (Month/Week/Day are the same     *
     * events at different windows). A count beside a calendar would be WINDOWED — the *
     * renderer only ever holds from_date..to_date, so a chip reading `3` would        *
     * silently mean "3 in the month you happen to be looking at" and would CHANGE as  *
     * you page. Mail's chip is honest because mail-model tallies over an already-      *
     * complete set. Calendar has a window, not a set. I don't have mail's premise, so  *
     * I don't get mail's chip. (Earned back by a non-window-scoped count route — the   *
     * countEvents fn already exists in internal, unrouted. Tool change.) */
    function activate(node, fn) {
      node.addEventListener("click", function () { fn(); });
      node.addEventListener("keydown", function (ev) {
        var key = ev && ev.key;
        if (key === "Enter" || key === " " || key === "Spacebar") {
          if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
          fn();
        }
      });
    }
    if (railInMenu) {
      // §6.4 — the shared railMarkup() says "Mailbox folders". Mine is not a mailbox.
      var nav = el(doc, "nav", "rail", { "aria-label": "Calendar views" });
      var create = el(doc, "div", "rail__compose", {
        role: "button", tabindex: "0", text: "Create", "aria-label": "Create an event"
      });
      // "Create", not "New event": the anchor DIRECTLY ABOVE this rail already says
      // Calendar, so the noun is redundant in its own column — and `create` is the
      // tool's own verb (calendar-rest api.create).
      activate(create, function () { openNew(state); });
      nav.appendChild(create);

      /* ---- P1 — THE SEARCH BOX (Slice 4) ------------------------------- *
       * Under Create, above the views. The order is the argument: Create is the one *
       * thing you came to DO, search is how you FIND, and the views are where you    *
       * live. Do · Find · Dwell, top to bottom.                                      *
       *                                                                              *
       * `.rail__search` is a NEW class in the SHARED block (block.css) and calendar   *
       * builds it as the proposing track (§6 Call 1 -> (b), operator ruling). *
       * It is ADDITIVE — a new class, not an edit to an existing one — so mail and     *
       * contacts can consume it unchanged, and the collision surface is near zero.     *
       * Announced on the Switchboard the moment it lands.                              *
       *                                                                                *
       * Debounced, because every keystroke would otherwise be a query — and, before    *
       * today, every keystroke through an unbalanced quote was a crash. The delay is    *
       * a ctx knob (not a constant) because a test frame and an injected-data frame     *
       * both legitimately want it at zero; the default is what a person feels.          *
       *                                                                                 *
       * Emptying the box RESTORES the view you were in — it does not dump you in a      *
       * blank list. Search is a lens you look through, not a place you go, and the      *
       * lens must be removable.                                                          */
      var searchWrap = el(doc, "div", "rail__search");
      var searchInput = el(doc, "input", "rail__search-input field", {
        type: "search", placeholder: "Search events\u2026", "aria-label": "Search events"
      });
      searchWrap.appendChild(searchInput);
      nav.appendChild(searchWrap);

      var searchTimer = null;
      var searchDelay = (ctx.searchDebounceMs != null) ? ctx.searchDebounceMs : 200;
      var viewBeforeSearch = null;   // where to go back to when the box is emptied

      function runSearch(raw) {
        if (!raw || !raw.trim()) {
          // Cleared -> restore the view we came from (never strand the user in a blank list).
          var back = viewBeforeSearch || "month";
          viewBeforeSearch = null;
          var v = VIEWS.filter(function (x) { return x.id === back; })[0];
          (v ? v.show : showMonth)();
          return;
        }
        if (!viewBeforeSearch && state.view !== "search") viewBeforeSearch = state.view;
        // "search" is not one of the four views, so setToggle lights NONE of the rail
        // slots — which is the honest picture: you have stepped OUT of the views, and
        // no slot should claim you are still in it. (setToggle already does exactly this
        // for any unknown id; no change to the exclusive-select logic was needed.)
        setToggle("search");
        renderSearch(host, ctx, api, raw.trim(), openRecord);
      }

      searchInput.addEventListener("input", function () {
        var raw = searchInput.value;
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { searchTimer = null; runSearch(raw); }, searchDelay);
      });

      railSlots = VIEWS.map(function (view) {
        var slot = el(doc, "div", "rail__slot", {
          role: "button", tabindex: "0", "data-slot": view.id,
          "aria-label": view.label + " view", "aria-current": "false"
        });
        slot.appendChild(el(doc, "span", "rail__slot-label", { text: view.label }));
        activate(slot, function () {
          // Leaving search by picking a view CLEARS the box. A query still sitting in the
          // field while a month grid is on screen is a small lie about what you are looking
          // at — and it is the kind that makes a user stop trusting the field.
          if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
          searchInput.value = "";
          viewBeforeSearch = null;
          view.show();
        });
        nav.appendChild(slot);
        return slot;
      });
      menuBody.appendChild(nav);

      /* ---- B1 — THE MINI CALENDAR ---------------------------------------------- *
       * Position: BELOW the views, ABOVE My Calendars. The views are the cursor's     *
       * GRANULARITY (month/week/day) and this is the cursor's POSITION — one control  *
       * pair, so they sit together. My Calendars (what you SEE) stays last. Google    *
       * puts the mini under Create because its views live in a top bar; ours live in  *
       * the rail, so the mini follows them. One `appendChild` to move it if wanted.   *
       *                                                                                *
       * ★ THE PICK IS THE ONLY WRITE. A click is the ONE thing in this block that      *
       * touches the authority cursor. It writes `state`, repaints whichever view is    *
       * live via backToView(), and re-anchors the browse cursor. The arrows write      *
       * NOTHING but the display. That asymmetry IS the anti-drift design.              *
       *                                                                                *
       * Cold-safe: rail path only (a frame with no [data-app-menu] gets no mini and     *
       * loses nothing — `syncMini` stays a no-op and both views run exactly as today).  */
      mini = miniCalendar(doc, state, function (y, m, d) {
        state.year = y; state.month = m; state.day = d;
        // Leaving a search by picking a date CLEARS the box — the same small honesty
        // the view slots keep (a query in the field over a month grid is a lie).
        if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
        searchInput.value = "";
        viewBeforeSearch = null;
        backToView();   // repaints the LIVE view at the new cursor (month/week/day/agenda)
        mini.sync();    // re-anchor browse onto state; move the selected ring
      });
      menuBody.appendChild(mini.el);

      /* P2 — "My calendars" sits BELOW the views, in the rail's Dwell zone. The views are
         WHERE YOU ARE (exclusive; .rail__slot--active). The calendars are WHAT YOU SEE
         (inclusive; .rail__slot--checked). Two different arithmetics, two modifiers, one
         column — the Gmail/Google-Calendar shape the operator asked the round to adopt.
         Cold-safe: no module -> no group; unreachable seam -> empty list -> no picker, and
         the filter stays open. */
      if (calMod) {
        calGroup = el(doc, "div", "rail__group", { "data-rail-group": "calendars" });
        menuBody.appendChild(calGroup);
        if (typeof api.calendars === "function") {
          api.calendars({}).then(function (r) {
            calList = (r && r.ok && r.data && r.data.calendars) ? r.data.calendars : [];
            paintCalendarSlots();
          });
        }
      }

      /* ---- C — the calendar-scoped action group ------------------------- *
       * LAST in the column, under My calendars. The rail reads Do (Create) · Find   *
       * (search) · Dwell (views, mini, calendars) · and now Keep — the file-level    *
       * acts that are about the calendar as a WHOLE rather than about where you are  *
       * standing in it. That is also where Google puts them (Settings), and the      *
       * reason iCal was never a view control in the first place.                     *
       *                                                                              *
       * The nodes are the SAME actionsICal() the head used to build — one authoring  *
       * site, two mount points, and the honest deferred pair still fires when the    *
       * client has no seam. All four views get them for free: this lives in           *
       * menuBody, which no view clears.                                               */
      var railActions = el(doc, "div", "rail__group", { "data-rail-group": "actions" });
      var railActionsBox = el(doc, "div", "calendar-railactions");
      actionsICal(doc, api, reshowCurrent).forEach(function (n) { if (n) railActionsBox.appendChild(n); });
      railActions.appendChild(railActionsBox);
      menuBody.appendChild(railActions);
    } else {
      monthBtn.addEventListener("click", showMonth);
      weekBtn.addEventListener("click", showWeek);
      dayBtn.addEventListener("click", showDay);
      agendaBtn.addEventListener("click", showAgenda);
    }

    showMonth();
    // E3 — if an Add-to-calendar intent arrived before this view was live, consume it now
    // (mirrors mail's __pendingCompose drain). One-shot: cleared once consumed.
    var pendingPrefill = root.calendarRenderer && root.calendarRenderer.__pendingPrefill;
    if (pendingPrefill) {
      root.calendarRenderer.__pendingPrefill = null;
      openNewPrefilledLive(pendingPrefill);
    }
    // owed 779 — same drain, one shot, for a search-open that arrived before this view was
    // live. The host fires forest:tab-select and openById back-to-back, so on a COLD calendar
    // the open lands here, not at the call. Ordered AFTER showMonth so the grid mount does not
    // clear the record we are about to paint.
    var pendingOpenId = root.calendarRenderer && root.calendarRenderer.__pendingOpenId;
    if (pendingOpenId) {
      root.calendarRenderer.__pendingOpenId = null;
      openRecord({ id: String(pendingOpenId) });
    }
  }

  /* ---- registration (self-register the "calendar" kind, cold-safe) ----------- */
  function registerSelf(pane) {
    pane = pane || root.pane;
    if (pane && typeof pane.registerRenderer === "function") { pane.registerRenderer("calendar", render); return true; }
    return false;
  }
  registerSelf();

  /* ---- E3 cross-app "Add to calendar" bridge -------------------------------- *
   * openNewPrefilled(seed) is the calendar-owned entry the shell host calls when a  *
   * mail message dispatches forest:add-to-calendar { title, notes }. If a calendar  *
   * view is live, it opens the create form prefilled now; otherwise it stashes a    *
   * pending intent the next render() consumes (calendar may still be finishing its  *
   * lazy read). Calendar OWNS the create form; the caller only carried title+notes  *
   * (TC-1) and NO date (operator decision A — the user picks the time, and the      *
   * form's save-guard requires it). Cold-safe: empty seed -> no-op; a live-opener   *
   * throw -> pending. Symmetric with mail-renderer's openComposeTo (E1).            */
  function openNewPrefilled(seed) {
    seed = seed || {};
    if (!seed.title && !seed.notes) return false;
    var cr = root.calendarRenderer;
    if (cr && typeof cr.__liveOpenNewPrefilled === "function") {
      try { cr.__liveOpenNewPrefilled(seed); return true; } catch (e) { /* fall through to pending */ }
    }
    if (cr) cr.__pendingPrefill = seed;
    return true;
  }

  /* ---- owed 779 · the search open-by-id entry ------------------------------- *
   * openById(id) is the calendar-owned entry the shell host calls when a search   *
   * hit {store:"calendar", id} is clicked. Live view -> open the event now; cold  *
   * view -> stash a pending intent the next render() consumes. Byte-for-byte the  *
   * same shape as openNewPrefilled directly above (and mail's openComposeTo) —    *
   * this is the E3 idiom's third application, not a new mechanism. Cold-safe:     *
   * empty id -> false, no-op; a live-opener throw -> pending. Returns whether the *
   * intent was ACCEPTED, not whether the event exists — openRecord's api.get      *
   * reports its own read failure on screen (readFailNode), never a silent no-op.  */
  function openById(id) {
    var eid = String(id == null ? "" : id).trim();
    if (!eid) return false;
    var cr = root.calendarRenderer;
    if (cr && typeof cr.__liveOpenById === "function") {
      try { cr.__liveOpenById(eid); return true; } catch (e) { /* fall through to pending */ }
    }
    if (cr) cr.__pendingOpenId = eid;
    return true;
  }

  /* ---- export --------------------------------------------------------------- */
  root.calendarRenderer = {
    render: render,
    registerSelf: registerSelf,
    // E3 — the cross-app "Add to calendar" entry (mail message -> prefilled create form).
    openNewPrefilled: openNewPrefilled,
    // owed 779 — the search open-by-id seam. shell-boot.js:499 calls this on forest:search-open.
    openById: openById,
    _monthShape: monthShape,
    _stepMonth: stepMonth,
    _ymd: ymd,
    _eventDayKey: eventDayKey,
    _timeLabel: timeLabel,
    _catColor: catColor,
    _calHue: calHue, // G1 — calendar_id -> Grove-palette hue (deterministic)
    _resolveCalColor: resolveCalColor,// color seam A — override-aware read (== calHue when no override); OVERRIDES set at render()
    _paintCalHue: paintCalHue,        // G1 — the edge now reads CALENDAR, not category
    _CAL_PALETTE: CAL_PALETTE,
    _packColumn: packColumn, // Slice 1 — the two numbers (calendar-pack.test.js)
    _ftsQuery: ftsQuery, // Slice 4 — the query normalizer (calendar-menu.test.js)
    _startMinutes: startMinutes,
    _durationMinutes: durationMinutes,
    _spanDays: spanDays,
    _stepDays: stepDays,
    _recurrenceLabel: recurrenceLabel,
    _GEOM: GEOM, // A1 — the declared frame (single source of truth)
    _gridCells: gridCells, // A2 — the visible span (the query window's source)
    _weeksInMonth: weeksInMonth, // — the month's real week count (big grid spans it now)
    _chipRowsAvailable: chipRowsAvailable,
    _derivedK: derivedK,
    _packLanes: packLanes, // A3 — the shared greedy pass (owed #354)
    _spanOf: spanOf, // A3 — the inclusive day-range of an event
    _stepKey: stepKey,
    _weekSpanSegments: weekSpanSegments,
    _miniCalendar: miniCalendar, // B1 — the rail block (browse cursor is DISPLAY-only)
    _calendarHead: calendarHead, // B2 — the ONE head both grids call
    _actionToday: actionToday, // B2 — view-scoped (resets the cursor)
    _actionNewEvent: actionNewEvent, // B2 — calendar-scoped
    _actionsICal: actionsICal, // C — calendar-scoped; lives in the RAIL (head only on the no-rail fallback)
    _defaultSlotIndex: defaultSlotIndex,// color seam step 2: the current-slot marker basis for the recolor picker
    _version: "1.34" // 1.34.1 : FIX — calendar-type DELETE never fired. The ✕'s two-step confirm committed on `click`, but the confirm button is nested in the ✕ button and armed with focus, so the confirm's own press blurred it first -> the blur disarm (finish(false)) set `closed` -> finish(true) no-op'd -> deleteCalendar was never called (no DELETE left the browser; proven by a pre-gate request ring). Now commits on mousedown (before blur) with preventDefault to hold focus. // 1.34.0: rail legibility — "My calendars" names get the full column at rest; solo+delete move into a reveal-on-need.rail__slot-actions cluster (calm at rest, shown on hover/focus); colour dot leads (identity); Distinguishable-Under-Clip pass (distinctCalLabels) so prefix-colliding long names never collapse to the same visible string; the previously-UNSTYLED del/solo/confirm now carry real CSS (the invisible-✕ fix). // 1.33.1: FIX — calMod resolution (root.calendarCalendars) so the "My calendars" picker renders at all; it was dead in prod (calMod always null). manager step 3 (reorder, verb 4): rail slots drag-reorder (native drag + Ctrl/Meta+Arrow), persisted via view-config calOrder; UNASSIGNED pinned last; reuses is-grabbed/is-drop-target/flipReschedule; motion-legible no-op-return
  };
})();
