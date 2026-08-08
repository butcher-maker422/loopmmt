/* Shea's Forest — Butcher Forest · forest/butcher/butcher-surfaces.js
   Chunk D — The Surfaces. The panes Shea (and Rick, and Christine) actually see
   and touch when they tab to the Butcher Forest.

   WHAT THIS IS (the wiring, not new machinery). Three PURE render functions over
   The Record (Chunk A, forest/butcher/butcher-record.js). The Record is the ONE
   source of truth; these surfaces DISPLAY it and OFFER the two acts that write to
   it (intake a new order · take one order home as a Stamp). They perform NO I/O:
   like the-rest.js and the-clearing.js, every surface is HANDED its data and hands
   its acts back to the host through callbacks. There is no path from a render to
   the database, the network, or the crypto — so a pane can never invent an order,
   fake a verify, or fabricate a completion.

     • renderIntake(doc, opts)         — the Deer Hill intake form. Captures the
                                          fields that OPEN an order record; on submit,
                                          calls opts.onIntake(payload) with the
                                          record-ready {order_id, event, actor, detail}.
     • renderBoard(doc, orders, opts)   — the lifecycle board. Orders grouped by the
                                          stage of their LATEST recorded event —
                                          derived from the Record's own event field,
                                          NOT from any order-model. (This is why the
                                          board is decoupled from Track OM: it reads
                                          what happened, not what the pipeline spec says
                                          should happen.)
     • renderOrder(doc, order, opts)    — one order's record glance: the event timeline,
                                          the honest verify state, and the "Take it home"
                                          Stamp affordance (opts.onStamp(order_id)). This
                                          is the affordance that makes Chunk A's Stamp
                                          EXPORTER reachable — Chunk A built the generator;
                                          this offers the button (the Blaze rule: a shipped
                                          capability leaves an affordance).

   THE FELT LAW (carried from the shipped surfaces): the pane faces the WORK, never
   the worker. No praise, no confetti, no red. Weather is gold/quiet only (Theo's
   rule). An unverifiable verify renders a LOUD honest state, never a false green
   (the same state-lie guard the Clearing/Rest carry, pointed at one order's chain).

   THE SHARED OBJECT (this module's Crux-seam): detailEncode/detailParse. The intake
   form ENCODES the customer/drop-off fields into the Record's free-text `detail`;
   the board and glance PARSE them back for display. Encode and parse are the one
   pair that must agree — kept in ONE place, lenient on read (a missing field shows
   as unknown, NEVER fabricated), and collision-safe (values are ; and = escaped).

   WEARS THE BLOCK ALPHABET — zero marginal CSS. Every element is a block.el() built
   from the shell's existing classes (.pane .view .field .row .line .chip .badge
   .pane__connect) reading tokens.css. Nothing hard-codes a hue; no bespoke skin.

   Plain script (no ES module, no deps) — attaches to window.ForestShell.butcher.
   Cold-safe throughout. Depends on window.ForestShell.block (load block.js first). */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  /* the one DOM builder (bound lazily so load order is forgiving) */
  function el(doc, tag, cls, attrs) {
    var b = root.block;
    if (b && typeof b.el === "function") return b.el(doc, tag, cls, attrs);
    // cold-safe fallback: minimal el() so a mis-ordered load degrades, never throws
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) {
      if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]);
    }
    return n;
  }

  /* ======================================================================
     WHO — and the refusal to invent one (leg 2, owed 531's second half).

     Every payload builder in this file used to carry its own `opts.actor ||
     "Shea"`. Five copies of one default, and the default was a lie the moment
     the shop had two workers: a write nobody attributed got signed under a real
     person's name, permanently, in an append-only hash-chained record where the
     only remedy is a superseding correction.

     `appendEntry` (butcher-record.js:1142) has ALWAYS refused an actor-less
     entry — `E_MALFORMED`. The record was never the thing that needed fixing.
     These five defaults existed solely to manufacture a value that satisfied a
     guard that was already correct. Deleting them does not add a rule; it stops
     defeating one.

     SO: no default, and no sentinel. A sentinel ("unattributed", "unknown")
     would be a token written to the chain — permanent under the same
     three-lifetime discipline as the stage tokens above — and it would make
     "nobody chose" a thing the record ASSERTS rather than a write the record
     REFUSED. Absent is the truth; a word for absent is a claim.

     The builders below return `null` when there is no bench — which is the
     idiom they already use for their other guards (an intake with no tag, a
     correction with no reason, a payment of zero). Refusing is not new grammar
     here. The host paints the legible reason (butcher-renderer.js honestNode,
     code E_NO_BENCH); this file simply declines to build.
     ====================================================================== */
  function actorFor(opts) {
    var a = opts && opts.actor;
    if (a == null) return null;
    a = String(a).trim();
    return a.length ? a : null;
  }

  /* ======================================================================
     THE LIFECYCLE — the Deer Hill stages, in order. The board groups on these.
     Each order's stage is the stage of its LATEST recorded event. The map is
     from the Record's own event vocabulary (butcher-record.js CLI dogfood +
     build-plan §3: intake -> hang -> cuts -> package -> label -> pickup -> sale;
     the genome specimen's drop-off -> tag -> hang -> butcher -> package ->
     notify -> pickup). Both vocabularies fold onto ONE ordered stage list; an
     event token we don't recognize lands in the honest "other" lane, never
     dropped and never silently mapped.
     ====================================================================== */
  /* THREE FIELDS, THREE LIFETIMES (, Parallax pick C). A stage entry
     carries strings for three different audiences, and they do NOT change on the
     same clock. Keeping them in one field is how a UI copy-edit reaches into a
     signed record.

       token   — THE ONE STRING WRITTEN TO THE CHAIN. Permanent. The Record is
                 append-only and hash-chained, so a token that has ever been
                 appended can never be renamed without breaking verification of
                 every row that carries it. Choose once. Never edit this field.
       accepts — READ-ONLY alias list. Tokens we RECOGNIZE on the way in (older
                 vocabularies, the CLI dogfood's words, the genome specimen's).
                 Freely extendable: adding an alias can only ever make MORE
                 orders readable. It can NEVER change what gets written, because
                 nothing writes from this list.
       label   — the lane name on Rick's screen. Presentation. Change at will.
       action  — the verb on the Advance button, imperative, short (cold hands,
                 laptop on a shelf). Presentation. Change at will.

     WHAT THIS REPLACED, and why it mattered: the canonical write-token used to
     be `events[0]` — defined by POSITION in the alias array. Inserting an alias
     at the front (a one-character edit that reads as harmless) silently changed
     the string appended to every subsequent signed record. The write token is
     now a NAMED field; the alias list cannot reach it.

     Intake has no action because nothing advances INTO intake — the intake FORM
     opens a record; the Advance only ever moves an order that already has one.

     The six tokens below are UNCHANGED from v1.2. This is a pure shape refactor:
     zero stored tokens moved, so nothing already signed has to be re-read. */
  var STAGES = [
    { id: "intake",  token: "intake",  label: "Intake",    accepts: ["intake", "drop-off", "dropoff", "tag"] },
    { id: "hang",    token: "hang",    label: "Hanging",   accepts: ["hang", "hung", "cooler", "aging"],      action: "Hang it" },
    { id: "cuts",    token: "cut",     label: "Cutting",   accepts: ["cut", "cuts", "butcher", "butchering"], action: "Start cutting" },
    { id: "package", token: "package", label: "Packaged",  accepts: ["package", "packaged", "label", "labeled", "labelled"], action: "Packed" },
    { id: "notify",  token: "notify",  label: "Ready",     accepts: ["notify", "notified", "ready", "call", "called"],       action: "Call the customer" },
    { id: "pickup",  token: "pickup",  label: "Picked up", accepts: ["pickup", "picked-up", "pickedup", "sale", "sold", "paid"], action: "Picked up" }
  ];
  var OTHER_STAGE = { id: "other", token: null, label: "Other", accepts: [] };

  /* ======================================================================
     LEG 18 — the per-stage dwell thresholds (the aging-alarm config).

     THESE NUMBERS ARE PLACEHOLDERS, NOT FOOD-SAFETY GUIDANCE. Rick sets the
     real per-stage limits (§6-#3, §6-#6) — hanging, cutting and cooler each
     have their own clock and that is his practice, never the chair's to invent.
     Setting the real numbers is a CONFIG EDIT, not a rebuild. Because
     `placeholder: true` rides every entry, the surface MUST render any
     placeholder threshold with a visible "example — set your real limit" mark
     and MUST NOT present it as a real limit.

     A stage ABSENT from `stages` carries NO clock — `dwellAlarm` returns
     `level:"none"` for it. That is the honest default: silence, not a guessed
     limit. intake/pickup and the exception/terminal lanes (cancelled,
     abandoned, other) are absent by design — a picked-up or abandoned order
     does not "age", and whether intake should be clocked is Rick's call, not a
     number to guess here. Keys are the real STAGES ids (hang/cuts/package/notify).
     ====================================================================== */
  var STAGE_DWELL_DEFAULT = {
    placeholder: true,                 // the whole default is un-authoritative
    stages: {
      hang:    { watchDays: 5,  lateDays: 10, placeholder: true },
      cuts:    { watchDays: 2,  lateDays: 4,  placeholder: true },
      package: { watchDays: 1,  lateDays: 3,  placeholder: true },
      notify:  { watchDays: 3,  lateDays: 7,  placeholder: true }
    }
  };

  /* ======================================================================
     THE EXCEPTION LANES (E5a, leg 03) — the four paths off the line.

 Operator decision A, : four first-class lanes, re-expressed from
     V1's stage machine (`constellation.js` — pack §5 reads
     `pending_customer_input` · `dispute_filed` · `cancelled` · `abandoned`
     already sitting off to the side of its main sequence). Standing law 3:
     re-express, never `cp` — these are V1's words, and V1's 612 tests are the
     oracle for anything the Forest re-expresses.

     THEY LIVE IN THEIR OWN ARRAY, AND THAT IS THE WHOLE MECHANISM. `nextStage`
     walks STAGES by index; an id that is not in STAGES makes `stageIndex`
     return >= STAGES.length, which `nextStage` already reads as "no next."
     So keeping these four OUT of the sequence array is not bookkeeping — it is
     the structural guarantee that Advance can never reach them and that an
     order sitting in one computes no next stage. There is deliberately NO
     special case in `nextStage` for them: a special case can be deleted by a
     future edit, a separate array cannot be walked by an index loop.

     Same three-lifetime discipline as STAGES: `token` is the ONE string written
     to the chain and is permanent once appended; `accepts` is a read-only alias
     list, freely extendable; `label` is presentation, change at will.

     `resumes` is the fourth field and it is BEHAVIOR, not stored bytes — it says
     whether an order can come back onto the line from here. Two of these are
     waypoints, two are endings, and that is the plain meaning of the four words:
       · pending_customer_input — waiting on the customer. They answer, it resumes.
       · dispute_filed          — an argument about the bill. Disputes resolve.
       · cancelled              — the customer called it off. An ending.
       · abandoned              — nobody ever came. An unhappy ending.
     Re-entry is an ORDINARY APPENDED EVENT recording the stage resumed at — never
     an un-do, never a mutation, nothing leaves `sliceChain` (leg 02's law).

     THE REVISION WINDOW: nothing has ever been signed (`BUTCHER_RECORD_DB` is
     unprovisioned, signer custody / owed 199 undecided), so these four `token`
     strings are still freely revisable. That window closes at the first signed
     record on a provisioned box, not at build. After it closes, a rename is a
     chain break and the honest move is a NEW token plus the old one in `accepts`.
     ====================================================================== */
  var EXCEPTION_STAGES = [
    { id: "pending_customer_input", token: "pending_customer_input", label: "Waiting on customer",
      accepts: ["pending_customer_input", "pending-customer-input", "pending_customer", "waiting"], resumes: true },
    { id: "dispute_filed",          token: "dispute_filed",          label: "Dispute",
      accepts: ["dispute_filed", "dispute-filed", "dispute", "disputed"],                            resumes: true },
    { id: "cancelled",              token: "cancelled",              label: "Cancelled",
      accepts: ["cancelled", "canceled", "cancel"],                                                  resumes: false },
    { id: "abandoned",              token: "abandoned",              label: "Never picked up",
      accepts: ["abandoned", "abandon", "unclaimed"],                                                resumes: false }
  ];
  function exceptionStage(stageId) {
    for (var i = 0; i < EXCEPTION_STAGES.length; i++) {
      if (EXCEPTION_STAGES[i].id === stageId) return EXCEPTION_STAGES[i];
    }
    return null;
  }
  // Is this lane an ending? Only meaningful for exception lanes; false elsewhere.
  function isTerminalException(stageId) {
    var e = exceptionStage(stageId);
    return !!e && e.resumes === false;
  }

  // event token -> stage (lenient, case-insensitive). Unknown -> OTHER_STAGE.
  // Reads `accepts` ONLY, across BOTH tables. This is the read half; it can
  // never set a write token. The six are checked first so a sequence stage can
  // never be shadowed by an exception alias.
  function stageForEvent(ev) {
    var t = String(ev == null ? "" : ev).trim().toLowerCase();
    for (var i = 0; i < STAGES.length; i++) {
      if (STAGES[i].accepts.indexOf(t) !== -1) return STAGES[i];
    }
    for (var j = 0; j < EXCEPTION_STAGES.length; j++) {
      if (EXCEPTION_STAGES[j].accepts.indexOf(t) !== -1) return EXCEPTION_STAGES[j];
    }
    return OTHER_STAGE;
  }
  // Sort position: the six in sequence, then the four exception lanes, then OTHER
  // last. Every return >= STAGES.length is "off the line" — which is exactly what
  // `nextStage` reads as "no next," with no special case.
  function stageIndex(stageId) {
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i].id === stageId) return i;
    for (var j = 0; j < EXCEPTION_STAGES.length; j++) {
      if (EXCEPTION_STAGES[j].id === stageId) return STAGES.length + j;
    }
    return STAGES.length + EXCEPTION_STAGES.length; // OTHER sorts last
  }
  // Every lane the list can render, in sort order. One source, so the census and
  // the lanes can never disagree about what exists.
  function ALL_LANES() { return STAGES.concat(EXCEPTION_STAGES).concat([OTHER_STAGE]); }

  /* ======================================================================
     E5a item 4 — RESTING vs ACTIVE lanes. The list must survive ~500 orders
     (pack §6.5: ~40/week x 13 weeks), and at that scale the overwhelming
     majority of rows are orders that are DONE. A season's worth of finished
     work rendered as a wall of cards buries the dozen rows Rick is actually
     working, on a laptop on a shelf in a 38F room (pack §6.3).

     So a RESTING lane collapses to one quiet line carrying its count, and an
     ACTIVE lane renders its rows. `{post}` 4 names the three: `pickup` and the
     two TERMINAL exception lanes.

     DERIVED, NEVER HAND-LISTED — the same shape rule the four lanes and the
     re-entry were built on. No lane id appears below:
       · a terminal exception rests            (`resumes === false`)
       · the LAST line stage rests             (`STAGES.length - 1`)
       · everything else is active — including OTHER, and that is the whole
         reason this is not simply "has no next stage." An order in OTHER has
         an event we cannot read. That is not finished work, it is UNKNOWN
         work, and collapsing it would hide the one row most likely to need a
         human. Never paint a claim the chain cannot back (standing law 2) —
         and "this order is done" is exactly such a claim.

     Add a seventh line stage tomorrow and `pickup` stops resting on its own,
     because "the last one" is computed, not typed. */
  function isRestingLane(stageId) {
    if (stageId === OTHER_STAGE.id) return false;    // unknown is not finished
    if (isTerminalException(stageId)) return true;   // the unhappy endings
    return stageIndex(stageId) === STAGES.length - 1; // the happy ending (pickup today)
  }
  function ACTIVE_LANES() {
    return ALL_LANES().filter(function (s) { return !isRestingLane(s.id); });
  }
  function RESTING_LANES() {
    return ALL_LANES().filter(function (s) { return isRestingLane(s.id); });
  }

  /* ======================================================================
 THE GROUPING AXIS (leg 2's design pass — operator Crossroads C, ).

     WHAT CHANGED AND WHY. Note 4 asked to "see all the orders currently in
     each stage." That was already built — the lane walk below. What was NOT
     built is the thing that makes it good, and it is not a paint job: the
     stage was a HARDCODED axis, and note 6 ("a board for each worker …
     EXACTLY what they themselves are working on") is THE SAME CONTROL WITH A
     DIFFERENT KEY. Hardcode the stage and note 6 gets built from scratch;
     make the key a parameter and note 6 is one row in the table below.

     THE FOREST ALREADY OWNS THIS PATTERN and butcher was not wearing it.
     mail-renderer builds `mail__group-select` over None · Conversation ·
     By date · By sender · By category, renders `li.mail-list__group` as
     `label · count`, and puts the SAME row grammar under every header —
     one axis at a time. contacts does the same with `contacts-group__label`.
     `view__region-label` appears in exactly ONE file repo-wide: this one.
     So this is a CONFORM, the same posture leg 1 took with `.rail`.

     WHY "By worker" IS NOT IN THIS TABLE TODAY, and it is not an oversight.
     `actor` is on every entry and the fold below would work — but owed 531
     stands: `ctx.config.actor` was fed only at leg 1 and every entry written
     before it says `Shea`. A "By worker" view over that record renders ONE
     group holding the whole season, labelled with the operator's name. That
     is a confidently-wrong surface — standing law 2, never paint a claim the
     chain cannot back. The key opens when the record can back it; the seam
     is a one-row edit and that is the whole point of the axis.
     ====================================================================== */
  /* NAME COLLISION, CAUGHT AT BUILD AND RECORDED RATHER THAN QUIETLY RENAMED.
     `GROUP_KEYS` was ALREADY TAKEN in this file (line ~3032) by the SEASON
     axis — ["stage","week","month","customer","dayOfWeek"], the third
     parameter of seasonSummary(). A second `var GROUP_KEYS` in the same scope
     does not error: the later declaration wins at module-eval, so this table
     was silently clobbered and the board rendered the SEASON's five keys as
     bare strings whose `.id` is undefined. Green-looking, wholly wrong.

     THE FINDING IS BIGGER THAN THE BUG. Butcher did not lack a grouping axis.
     It BUILT one — with better discipline than the first draft of this one:
     an unplaceable order gets a NAMED BUCKET rather than a drop, and an
     unknown key is a LOUD refusal, not a silent fall-back to the default.
     The BOARD simply never used it and hardcoded the stage. So the honest
     move here is RESTRICTION, not a rival vocabulary: the board's keys are a
     named subset, prefixed so the two can never shadow again, and the bucket
     itself is computed by the incumbent `_groupKeyOf` — ONE arithmetic path,
     so the board and the season census can never disagree about what stage
     an order is in. A second copy of one membership is exactly the fault the
     comments in this file warn about twice, and the fault leg 2 just deleted
     six of. */
  /* A ROW HERE IS NOW GENUINELY ONE ROW, and until it was not. The
     table below LOOKED keyed while `boardGroupsFor` was a two-state switch
     (`none` / not-`none`) whose else-branch discarded its own `key` and asked
     `_groupKeyOf` for the literal "stage". Adding `week` to this list painted
     STAGE lanes under a control reading "By week" — green-looking, wholly
     wrong, the identical class leg 2 caught in GROUP_KEYS one function along.
     A keyed-looking TABLE is not evidence of a keyed FOLD; the fold below is
     now the evidence. */
  var BOARD_GROUP_KEYS = [
    { id: "stage", label: "By stage" },
    { id: "week",  label: "By week" },
    { id: "none",  label: "None" }
  ];
  function boardGroupKey(id) {
    for (var i = 0; i < BOARD_GROUP_KEYS.length; i++) {
      if (BOARD_GROUP_KEYS[i].id === id) return BOARD_GROUP_KEYS[i];
    }
    return BOARD_GROUP_KEYS[0];                 // unknown key -> the resting default
  }

  /* THE BUCKET ORDER IS DERIVED IN BOTH DIRECTIONS, AND THE TWO SHAPES DIFFER.
     `stage` reads a TABLE (ALL_LANES()) because a lifecycle carries an order
     that is not in the data: `intake` precedes `pickup` even in a season where
     nobody has picked anything up, so the table is the only place that fact
     lives. Every other key is the opposite — its buckets exist ONLY because an
     order put them there, so they are DISCOVERED from the views and sorted by
     a rule. Reading a discovered key off a table would invent buckets that no
     order is in; reading `stage` off the data would lose the empty lanes'
     order. The fold has to hold both, and this is where it does. */
  function _boardBucketsFor(views, key) {
    if (key === "stage") {
      var out = [];
      ALL_LANES().forEach(function (stage) {
        var inLane = views.filter(function (v) { return _groupKeyOf("stage", v) === stage.id; });
        if (!inLane.length) return;             // an empty lane never renders
        out.push({ id: stage.id, label: stage.label, orders: inLane });
      });
      return out;
    }
    /* THE THIRD ARGUMENT IS THE ONE THAT WAS MISSING. `_groupKeyOf` takes
       (kind, view, opened) and every date-derived key returns "undated" when
       `opened` is null — so a fold that passed only two arguments would have
       put EVERY order in one "undated" bucket even after the key was threaded
       through. `opened` is not a new fact: it is `_openedAt(view.entries)`,
       the same earliest-raw-entry anchor the season census windows on. ONE
       arithmetic path, so the board and the census can never disagree about
       which week an order belongs to. */
    var byId = {}, order = [], i;
    for (i = 0; i < views.length; i++) {
      var v = views[i];
      var id = _groupKeyOf(key, v, _openedAt(v.entries));
      if (!Object.prototype.hasOwnProperty.call(byId, id)) { byId[id] = []; order.push(id); }
      byId[id].push(v);
    }
    order.sort(_bucketSorter(key));
    return order.map(function (id) {
      return { id: id, label: _bucketLabel(key, id), orders: byId[id] };
    });
  }

  /* THE NAMED BUCKETS SORT LAST, NEVER OUT. `undated` and `unresolved` are the
     incumbent's answers for an order the census keeps but cannot place (:3073)
     — an order the census counts must appear in EVERY grouping of that census
     or the groups stop summing to the total. They go to the bottom because
     they are not part of the sequence, never because they are less real.
     Everything else sorts by its own grain: ISO week and month ids are
     zero-padded, so a plain string compare IS chronological; DOW_NAMES is not
     alphabetical, so it sorts by the incumbent's index. DESCENDING on the
     dated keys — the board is a thing Rick works and this week is the top of
     it, the same reason the stage axis is lifecycle order and not A-to-Z. */
  function _bucketSorter(key) {
    function pinned(id) { return id === "undated" || id === "unresolved"; }
    if (key === "dayOfWeek") {
      return function (a, b) {
        if (pinned(a) !== pinned(b)) return pinned(a) ? 1 : -1;
        return DOW_NAMES.indexOf(a) - DOW_NAMES.indexOf(b);
      };
    }
    return function (a, b) {
      if (pinned(a) !== pinned(b)) return pinned(a) ? 1 : -1;
      return a < b ? 1 : (a > b ? -1 : 0);
    };
  }

  /* THE LABEL IS DERIVED FROM THE BUCKET ID, never a second lookup. `2026-W31`
     is a correct id and an unreadable header; Rick reads "Week of Jul 27". The
     Monday is computed back out of the ISO id by the inverse of `_isoWeek`, so
     the id and the header can never disagree about which week is which — and
     the month name comes from `weatherDayLabel` rather than a second copy of
     the same twelve strings. (That helper's name is narrower than its
     function: it formats a YYYY-MM-DD key and has nothing weather-specific in
     it. Reused rather than copied; the misnaming is filed, not fixed here,
     because renaming it touches call sites this leg has no business in.) */
  function _isoWeekMonday(id) {
    var m = /^(\d{4})-W(\d{2})$/.exec(String(id));
    if (!m) return null;
    var year = Number(m[1]), week = Number(m[2]);
    if (!(week >= 1 && week <= 53)) return null;
    var jan4 = new Date(Date.UTC(year, 0, 4));
    var dayn = (jan4.getUTCDay() + 6) % 7;                  /* Mon=0 */
    return new Date(Date.UTC(year, 0, 4) - dayn * 86400000 + (week - 1) * 604800000);
  }
  function _bucketLabel(key, id) {
    if (key === "week") {
      var mon = _isoWeekMonday(id);
      if (!mon) return String(id);                          // `undated` keeps its own name
      return "Week of " + weatherDayLabel(
        mon.getUTCFullYear() + "-" +
        _pad2(mon.getUTCMonth() + 1) + "-" + _pad2(mon.getUTCDate()));
    }
    return String(id);
  }

  /* `restable` GENERALIZED, AND THE GENERALIZATION AGREES WITH THE INCUMBENT
     BY CONSTRUCTION. The old rule was `isRestingLane(stage.id)` — a question
     about a LANE's position in the lifecycle. Off the stage axis there is no
     lifecycle position to ask about: `2026-W31` has no "last line stage," and
     inventing one would paint a claim the chain cannot back (standing law 2).

     So the question moves from the BUCKET to the ORDERS IN IT: a bucket rests
     when every order in it sits in a resting lane. On the stage axis every
     order in a bucket has that bucket's stage, so this evaluates to
     `isRestingLane(stage.id)` for every bucket, exactly — a WIDENING that
     changes no stage behaviour, not a replacement that hopes it doesn't. Off
     the axis it is honest without new vocabulary: a week whose orders are all
     picked up rests; a week with one animal still hanging does not, which is
     the answer Rick would give and the one the record can back.

     This is why the week key needed no per-key rest predicate and no
     "completed week" event — there is no such event in the chain, and the
     right answer never required one. */
  function _restable(orders) {
    if (!orders.length) return false;
    for (var i = 0; i < orders.length; i++) {
      var st = orders[i] && orders[i].stage;
      if (!isRestingLane(st && st.id)) return false;
    }
    return true;
  }

  /* Fold a view list into rendered groups under one key. Returns
     [{ id, label, orders, restable }] in render order. `restable` says the
     group is ELIGIBLE to collapse; whether it actually does is the paint's
     call (a search sees everything — that rule is unchanged and lives there).

     THE FLAT KEY IS A REAL ANSWER, NOT A NULL ONE. Rick calls it "the list"
     (pack §3.1) and the pack's own correction #1 says so: "a board may be a
     VIEW; the list is the object." Under `none` the whole season is one
     column in lifecycle order — which is also the only shape where the
     `Ready` lane is never pushed onto a second grid row. */
  function boardGroupsFor(views, key) {
    if (boardGroupKey(key).id === "none") {
      var flat = views.slice().sort(function (a, b) {
        return stageIndex(a.stage.id) - stageIndex(b.stage.id);
      });
      return flat.length ? [{ id: "all", label: null, orders: flat, restable: false }] : [];
    }
    /* THE KEY IS HONOURED, and `boardGroupKey(key).id` is what honours it —
       an unknown key still resolves to the resting default rather than folding
       on a string nobody offered. The bucket is still the INCUMBENT's, never a
       second copy of the same rule; what changed is that the key reaches it. */
    return _boardBucketsFor(views, boardGroupKey(key).id).map(function (b) {
      return { id: b.id, label: b.label, orders: b.orders,
               restable: _restable(b.orders) };
    });
  }

  /* ======================================================================
     THE ADVANCE (E1) — the next stage is COMPUTED, never chosen.

     The stage machine is a SEQUENCE, so the next stage is derivable from the
     order's own latest recorded event. Presenting it as a dropdown of eight
     would manufacture a decision the domain already made — and this decision is
     made ~500 times a season by someone holding a knife with cold hands
     (Hick's Law; pack §3.1, §4 Load). Hence ONE button whose label is the next
     stage's verb.

     Returns null — meaning NO affordance is offered — in exactly two honest cases:
       · the order is at the terminal stage (picked up); there is no next.
       · the order's latest event is UNRECOGNIZED (the "other" lane). We do not
         know where it sits in the sequence, so we do not guess where it goes
         next. Offering "Hang it" on an order whose position we cannot read would
         be painting a claim the chain cannot back (standing law 2).
     ====================================================================== */
  function nextStage(stageId) {
    var i = stageIndex(stageId);
    if (i >= STAGES.length - 1) return null;      // terminal, or OTHER (index == length)
    var n = STAGES[i + 1];
    // `event` is the string that will be APPENDED to the chain. It reads the
    // named `token` field — never the alias list, never by array position.
    return { id: n.id, label: n.label, event: n.token, action: n.action };
  }

  /* ======================================================================
     E5a item 3 — RE-ENTRY, and the whole point is that it is ORDINARY.

     An order in a RESUMABLE exception lane (`resumes === true`) came off the
     line at some stage and can go back on at that same stage. Recording that is
     an ORDINARY APPENDED EVENT carrying the resumed stage's own `token` — the
     identical string the Advance would have written. Not an un-do, not a
     mutation, not a new verb, and nothing leaves `sliceChain` (leg 02's law).

     THE DISTINCTION THAT MUST NOT COLLAPSE (runbook {post} 3): a CORRECTION says
     *that was wrong*; a RE-ENTRY says *and then this happened*. They are
     different verbs with different encodings — a correction rides
     `correctionEncode` and supersedes an entry_hash; a re-entry rides nothing at
     all, because a plain event needs no wrapper. That is why this function
     returns the same `{id,label,event,action}` shape `nextStage` returns and why
     the control below hands the host `onAdvance`: to the Record, a re-entry IS
     an advance. Only the derivation of WHICH stage differs.

     Derived, never hand-listed (the leg's standing shape rule): resumability is
     read off `resumes` via `exceptionStage`, and the target is read off the
     chain by walking back to the last entry whose stage is in `STAGES`. No id
     appears in this function. A future fifth resumable lane needs no edit here.

     Honest absence: an order whose chain holds no line stage at all (nothing but
     an exception) returns null rather than inventing a stage to resume at —
     never paint a claim the chain cannot back (law 2). */
  function resumeStage(view) {
    if (!view || !view.stage) return null;
    var ex = exceptionStage(view.stage.id);
    if (!ex || ex.resumes !== true) return null;      // not in a resumable lane

    var eff = view.effective || view.entries || [];
    for (var i = eff.length - 1; i >= 0; i--) {
      var s = stageForEvent(eff[i].event);
      if (stageIndex(s.id) < STAGES.length) {          // it is a LINE stage
        return {
          id: s.id,
          label: s.label,
          event: s.token,                              // the named token, never an alias
          action: "Back on the line \u2014 " + s.label
        };
      }
    }
    return null;                                       // nothing to resume to
  }

  /* The single primary affordance, shared by the list row and the order glance so
     the two can never drift apart. PURE: it performs no I/O and — load 4, the
     load-bearing one — it DOES NOT MOVE THE ROW. It records an intent and hands
     it to the host; the lane follows only when the host re-reads the Record. A
     failed append therefore leaves the row exactly where it was, by construction
     rather than by remembering to undo something.

     Deliberately NOT gated on verify state. A broken chain disables the STAMP
     (nothing leaves in the truck looking valid) but must not stop the work: Rick
     cannot see the cryptography and must never need to (pack §3.7), and the pane
     faces the work, never the worker (law 1). Appending to a broken chain hides
     nothing — verifyChain still reports the break at its original seq, and the
     export boundary is where containment already lives. */
  function advanceControl(doc, view, opts, detail) {
    if (!opts || typeof opts.onAdvance !== "function") return null;
    var next = nextStage(view.stage.id);
    if (!next) return null;

    var btn = el(doc, "button", "pane__connect butcher__advance", {
      type: "button",
      "data-act": "advance",
      "data-advance-event": next.event,
      "data-advance-stage": next.id,
      text: next.action
    });
    btn.setAttribute("title",
      "Records \u201C" + next.event + "\u201D on order " + view.order_id + " \u2014 the lane follows the record");

    function fire(e) {
      // The row is itself clickable (-> open the order). The Advance is a
      // different act, so it must not also open. Real bubbling, real stop.
      if (e && typeof e.stopPropagation === "function") e.stopPropagation();
      if (btn.disabled) return null;
      // One user intent, one append. The client mints a fresh Idempotency-Key per
      // call, so a double-click would be two DIFFERENT keys and two real entries —
      // the key protects a RETRIED request, not a repeated intent. The latch is
      // what makes the intent single. The host re-renders either way, which is
      // what returns an enabled button.
      btn.disabled = true;
      /* THE NOTE SEAM (owed butcher-advance-carries-no-note-seam). The third
         argument is the Record's free-text `detail`, and it is the SAME slot
         `appendEntry(db, {order_id, event, actor, detail}, signer)` has always
         signed — no server change, no new verb. The primary Advance passes null
         BY DESIGN: this button is a one-touch act for cold hands on the list
         (Hick's/Fitts, plan §E1) and a text field beside it would spend the
         interaction budget the single button exists to protect. The seam is cut
         here so every path through the host verb carries the slot; the first
         consumer that fills it is offLineControl on the order pane. */
      opts.onAdvance(view.order_id, next.event, detail == null ? null : detail);
      return next.event;
    }
    if (btn.addEventListener) {
      btn.addEventListener("click", fire);
      // Enter/Space on the button natively fires click; the KEYDOWN still bubbles
      // to the row's handler, which would open the order behind the append.
      btn.addEventListener("keydown", function (e) {
        if (e && (e.key === "Enter" || e.key === " ") && typeof e.stopPropagation === "function") e.stopPropagation();
      });
    }
    btn._fire = fire;
    btn._next = next;
    return btn;
  }

  /* The re-entry affordance. Deliberately built as a near-twin of advanceControl
     and NOT folded into it: `advanceControl` returns null on any exception lane
     because `nextStage` returns null there, and that null is the structural
     guarantee item 1 bought (Advance can never reach or leave an exception lane
     by index). Making Advance ALSO mean re-entry would put a special case back
     inside the guarantee. Two controls, one host verb.

     Same purity contract: no I/O, does not move the row, hands the host the same
     `onAdvance(order_id, event)` it already implements — because a re-entry is
     an ordinary event. Quiet grammar, no red, no badge ({post} 6): this reads as
     a fact about an order, not a rescue. */
  function resumeControl(doc, view, opts) {
    if (!opts || typeof opts.onAdvance !== "function") return null;
    var back = resumeStage(view);
    if (!back) return null;

    var btn = el(doc, "button", "pane__connect butcher__resume", {
      type: "button",
      "data-act": "resume",
      "data-resume-event": back.event,
      "data-resume-stage": back.id,
      text: back.action
    });
    btn.setAttribute("title",
      "Records \u201C" + back.event + "\u201D on order " + view.order_id +
      " \u2014 an ordinary event, not an un-do; the lane follows the record");

    function fire(e) {
      if (e && typeof e.stopPropagation === "function") e.stopPropagation();
      if (btn.disabled) return null;
      btn.disabled = true;
      // Same three-argument host verb as advanceControl — a re-entry IS an
      // advance to the Record, so it must not grow a second shape.
      opts.onAdvance(view.order_id, back.event, null);
      return back.event;
    }
    if (btn.addEventListener) {
      btn.addEventListener("click", fire);
      btn.addEventListener("keydown", function (e) {
        if (e && (e.key === "Enter" || e.key === " ") && typeof e.stopPropagation === "function") e.stopPropagation();
      });
    }
    btn._fire = fire;
    btn._resume = back;
    return btn;
  }

  /* ======================================================================
     E1 SECONDARY — THE OFF-LINE MOVE (plan §E1: "the full event list behind a
     secondary control for the out-of-order case").

     WHAT IT MAY WRITE, and why the list is not "everything appendable."
     §E1 was written when the vocabulary was six line stages. It is now six line
     stages, four exception lanes, and six non-line verbs. This control offers
     the first two groups and REFUSES the third, on the bytes rather than on
     taste: `weigh`, `told`, `tell_skipped`, `payment`, `refund` and `correction`
     each have a validator in butcher-record that REFUSES a malformed detail
     before anything is signed, and each already has a control here that builds
     a valid one. A generic picker over them would manufacture refusals and
     duplicate finished work. The two groups it DOES offer are exactly the ones
     whose detail is free-text: a bare stage token plus an optional note.

     WHY IT EXISTS AT ALL, and this is the load-bearing half: nothing in this
     module has ever written an exception token. `advanceControl` walks STAGES
     only; `resumeControl` writes a LINE token (it is the way OUT of an exception
     lane); tell/correct/money write non-line events. So the four exception
 lanes — built, tested, `resumes`-aware, terminal-aware since —
     were write-unreachable, and `resumeControl` was a door out of a room with
     no door in. This is the door in.

     WHY IT IS A PANEL ON THE ORDER PANE AND NOT A BUTTON ON THE LIST ROW —
     the moneyControl precedent, verbatim in its reasoning: every control that
     earned the list is one decision Rick makes standing up. This is a form (pick
     a token, say why), and a form on a list row is how a wrong permanent token
     gets into a chain that cannot remove it. The list row keeps exactly one
     primary button, which is the whole of §E1's Hick's/Fitts argument.

     Purity contract, identical to its siblings: no I/O, does not move the row,
     hands the host the SAME `onAdvance(order_id, event, detail)` verb. An
     off-line move is an ordinary appended event; it needs no new verb, and the
     note rides the free-text `detail` the Record has always signed.

     Derived, never hand-listed: the options are read off STAGES and
     EXCEPTION_STAGES. A future seventh stage or fifth lane needs no edit here.
     ====================================================================== */
  function offLineOptions(view) {
    var here = view && view.stage ? view.stage.id : null;
    var i = stageIndex(here);
    var next = nextStage(here);
    var out = [];
    // Out-of-sequence LINE stages: every line stage that is not where the order
    // already sits and not the one the primary Advance already offers. Offering
    // the primary's own token here would be two doors onto one act.
    for (var a = 0; a < STAGES.length; a++) {
      if (STAGES[a].id === here) continue;
      if (next && STAGES[a].id === next.id) continue;
      out.push({ token: STAGES[a].token, label: STAGES[a].label, group: "line" });
    }
    // The four exception lanes, minus the one the order is already in.
    for (var b = 0; b < EXCEPTION_STAGES.length; b++) {
      if (EXCEPTION_STAGES[b].id === here) continue;
      out.push({ token: EXCEPTION_STAGES[b].token, label: EXCEPTION_STAGES[b].label, group: "exception" });
    }
    // `i` is read so an OTHER-lane order still gets the full list: it has no
    // computable next, which is precisely when this control is the only way out.
    return i >= 0 ? out : out;
  }

  function offLineControl(doc, view, opts) {
    if (!opts || typeof opts.onAdvance !== "function") return null;
    var options = offLineOptions(view);
    if (!options.length) return null;              // nothing honest to offer

    var btn = el(doc, "button", "chip butcher__offline",
      { type: "button", "data-act": "off-line", text: "Record something else" });
    btn.setAttribute("title",
      "Records an out-of-sequence stage or an off-the-line move on order " +
      view.order_id + " \u2014 an ordinary appended event, never an un-do");

    var panel = el(doc, "div", "row", { "data-region": "off-line", "data-for-order": String(view.order_id) });
    panel.style.display = "none";
    var pbody = el(doc, "div", "row__body");
    pbody.appendChild(el(doc, "div", "row__title", { text: "What happened instead?" }));

    var sel = el(doc, "select", "field__control", { "data-field": "event" });
    options.forEach(function (o) {
      sel.appendChild(el(doc, "option", null,
        { value: o.token, text: o.label, "data-group": o.group }));
    });
    sel.value = options[0].token;
    pbody.appendChild(sel);

    /* THE NOTE. Optional by design, unlike a correction's required reason: a
       correction claims a prior entry was WRONG and must say why, while an
       off-line move is only "and then this happened" and can be self-evident
       from the token. Optional, but always OFFERED — this is the attach point
       the note-seam owed named (pack SS3.3 makes notes first-class and
       time-shifted: "ask about sausage seasoning before grinding"). */
    var note = el(doc, "input", "field__control",
      { type: "text", "data-field": "note", placeholder: "Note (optional)" });
    pbody.appendChild(note);
    panel.appendChild(pbody);

    var save = el(doc, "button", "pane__connect",
      { type: "button", "data-act": "off-line-save", text: "Record it" });

    function submit(e) {
      if (e && typeof e.stopPropagation === "function") e.stopPropagation();
      if (save.disabled) return null;
      var token = String(sel.value == null ? "" : sel.value).trim();
      if (!token) return null;                     // never append an empty token
      var text = String(note.value == null ? "" : note.value).trim();
      // detailEncode, not a bespoke string: the note joins the SAME k=v grammar
      // detailParse already reads, so every consumer of a detail reads it for
      // free. No note -> no detail at all, never an empty "note=".
      var detail = text.length ? detailEncode({ note: text }) : null;
      save.disabled = true;                        // one intent, one append (the E1 latch)
      opts.onAdvance(view.order_id, token, detail);
      return { order_id: view.order_id, event: token, detail: detail };
    }
    if (save.addEventListener) save.addEventListener("click", submit);
    panel.appendChild(save);

    function toggle(e) {
      if (e && typeof e.stopPropagation === "function") e.stopPropagation();
      panel.style.display = (panel.style.display === "none") ? "" : "none";
      return panel.style.display !== "none";
    }
    if (btn.addEventListener) btn.addEventListener("click", toggle);

    btn._toggle = toggle;
    panel._submit = submit;
    panel._select = sel;
    panel._note = note;
    panel._save = save;
    return { control: btn, panel: panel };
  }

  /* ======================================================================
     E2 — THE CORRECTION AFFORDANCE.

     Reaching a correction costs ONE deliberate act from the order's own timeline:
     a quiet control on the entry itself opens a small form directly beneath that
     entry. No modal, no stack, no separate screen, no phone-sized thumb target —
     this is a laptop on a shelf in a cold room (pack §6.3), opened "the way he
     opens the cooler door" (§3.6). No red, no scolding (law 1). And no hash and
     no signature state ever reaches this pane: Rick does not see the cryptography
     and must never need to (§3.7) — the entry_hash rides in the payload, never in
     the render.

     PURE, exactly like advanceControl: it performs no I/O and DOES NOT MOVE THE
     ROW. It builds a record-ready payload and hands it to the host; the lane
     follows only when the host re-reads the Record. A refused correction (the
     runtime resolves `supersedes` before it signs) therefore leaves everything
     exactly where it was, by construction rather than by remembering to undo.
     ====================================================================== */
  function correctionEncode(fields) {
    return ["supersedes=" + esc(fields.supersedes),
            "reason=" + esc(fields.reason),
            "event=" + esc(fields.event)].join(";");
  }

  /* E4, THE TELL — the affordance that reaches the hunter (leg 05).

     A near-twin of advanceControl on purpose, with ONE structural difference
     that is the whole leg: THE ADVANCE MOVES THE ORDER, THE TELL DOES NOT. It
     appends a non-line event and hands a composed message to the shell's compose
     surface. An order's lane is exactly where it was before the call.

     FLAG-DON'T-FAKE, INHERITED FROM CONTACTS EXACTLY. Contacts disables "Email"
     when the contact has no address. Butcher inherits that: an order whose
     hunter cannot be reached gets a DEFERRED control that SAYS WHY, never a
     compose window that cannot be addressed. The reason on the disabled button
     is the same reason that would be recorded as the skip — one vocabulary, so
     what Rick reads on the button and what a future auditor reads in the chain
     are the same sentence.

     NO AUTO-SEND (§Boundaries). Nothing here composes or sends without a hand,
     for the same reason leg 04 refused the auto-advance: a machine that speaks
     to a customer in the shop's name without a human act is a claim the chain
     cannot back. `onTell` is called with what the operator's click produced;
     the HOST decides whether to append, and the host is downstream of a person. */
  function tellControl(doc, view, opts) {
    if (!opts || typeof opts.onTell !== "function") return null;
    // Offered from the `notify` lane onward: before the order is packed there is
    // nothing true to say, and after pickup the thank-you still wants a hand.
    var i = stageIndex(view.stage.id);
    if (i < stageIndex("notify") || i >= STAGES.length) return null;

    var plan = (opts.plan && typeof opts.plan === "function") ? opts.plan(view) : (view.tellPlan || null);

    var reachable = !!(plan && plan.ok && plan.to);
    var btn = el(doc, "button", "pane__connect butcher__tell", {
      type: "button",
      "data-act": "tell",
      "data-tell-channel": reachable ? String(plan.channel) : "",
      text: view.tell && view.tell.told ? "Tell again" : "Tell the customer"
    });

    if (!reachable) {
      /* The DEFERRED form. Not hidden — hiding it would make an unreachable
         customer LESS visible than a reachable one, and {post} 3 says the
         opposite. It is present, disabled, and it states the gap. */
      btn.disabled = true;
      btn.setAttribute("data-deferred", "true");
      btn.setAttribute("title", "cannot compose \u2014 " +
        skipLabel(plan && plan.reason ? plan.reason : "customer_not_found"));
    } else {
      btn.setAttribute("title",
        "Composes a " + plan.channel + " to " + plan.to +
        " and records that it was handed off \u2014 never that it was delivered");
    }

    function fire(e) {
      if (e && typeof e.stopPropagation === "function") e.stopPropagation();
      if (btn.disabled) return null;
      btn.disabled = true;
      /* The compose intent goes UP to the shell host (Mail owns compose); the
         RECORD payload goes to the host's onTell. Two different consumers, one
         click, and neither of them is this file writing anything. */
      var who = actorFor(opts);
      if (!who) { btn.disabled = false; return null; }   // no bench, no telling
      var intent = emitCompose(btn, { to: plan.to, subject: plan.subject, body: plan.body });
      var payload = {
        order_id: view.order_id,
        event: TOLD,
        actor: who,
        detail: tellingEncode({
          channel: plan.channel, to: plan.to, body: plan.body,
          template: plan.template, templateSource: plan.templateSource, subject: plan.subject
        })
      };
      opts.onTell(payload, intent);
      return payload;
    }
    if (btn.addEventListener) {
      btn.addEventListener("click", fire);
      btn.addEventListener("keydown", function (ev) {
        if (ev && (ev.key === "Enter" || ev.key === " ") && typeof ev.stopPropagation === "function") ev.stopPropagation();
      });
    }
    btn._fire = fire;
    btn._plan = plan;
    /* The skip payload the host records when the operator dismisses the compose
       window. It is built HERE, from the same plan, so the skip and the telling
       can never disagree about which channel was in play. */
    btn._skip = function (reason) {
      var who = actorFor(opts);
      if (!who) return null;                             // no bench, no skip record
      return {
        order_id: view.order_id,
        event: TELL_SKIPPED,
        actor: who,
        detail: skipEncode({
          reason: reason || (plan && plan.reason) || "dismissed",
          channel: plan && plan.channel ? plan.channel : null
        })
      };
    };
    return btn;
  }

  function correctionControl(doc, view, entry, flags, opts) {
    if (!opts || typeof opts.onCorrect !== "function") return null;
    if (!entry || entry.entry_hash == null) return null;   // nothing to point at, so nothing offered
    if (flags.superseded || flags.isCorrection) return null;

    var btn = el(doc, "button", "chip butcher__correct",
      { type: "button", "data-act": "correct", text: "Correct" });
    btn.setAttribute("title", "This entry was wrong \u2014 record what was meant");

    var panel = el(doc, "div", "row", { "data-region": "correction", "data-for-seq": String(entry.seq) });
    panel.style.display = "none";
    var pbody = el(doc, "div", "row__body");
    pbody.appendChild(el(doc, "div", "row__title", { text: "What should this entry have said?" }));

    var sel = el(doc, "select", "field__control", { "data-field": "event" });
    STAGES.forEach(function (s) {
      sel.appendChild(el(doc, "option", null, { value: s.token, text: s.label }));
    });
    var current = stageForEvent(entry.event);
    sel.value = (current && current.token) ? current.token : STAGES[0].token;
    pbody.appendChild(sel);

    var reason = el(doc, "input", "field__control",
      { type: "text", "data-field": "reason", placeholder: "Why (required)" });
    pbody.appendChild(reason);
    panel.appendChild(pbody);

    var save = el(doc, "button", "pane__connect",
      { type: "button", "data-act": "correct-save", text: "Record the correction" });
    save.disabled = true;
    function refresh() { save.disabled = !String(reason.value == null ? "" : reason.value).trim(); }
    if (reason.addEventListener) reason.addEventListener("input", refresh);

    function submit(e) {
      if (e && typeof e.stopPropagation === "function") e.stopPropagation();
      refresh();
      // required, and enforced HERE as well as at append: a correction without a
      // stated reason is a silent rewrite, and the record must never carry one.
      if (save.disabled) return null;
      var who = actorFor(opts);
      if (!who) return null;                             // no bench, no correction
      var payload = {
        order_id: view.order_id,
        event: "correction",
        actor: who,
        detail: correctionEncode({
          supersedes: entry.entry_hash,
          reason: String(reason.value).trim(),
          event: String(sel.value || "").trim()
        })
      };
      save.disabled = true;                    // one intent, one append (the E1 latch)
      opts.onCorrect(payload);
      return payload;
    }
    if (save.addEventListener) save.addEventListener("click", submit);
    panel.appendChild(save);

    function toggle(e) {
      if (e && typeof e.stopPropagation === "function") e.stopPropagation();
      panel.style.display = (panel.style.display === "none") ? "" : "none";
      return panel.style.display !== "none";
    }
    if (btn.addEventListener) btn.addEventListener("click", toggle);

    btn._toggle = toggle;
    panel._submit = submit;
    panel._reason = reason;
    panel._select = sel;
    return { control: btn, panel: panel };
  }

  /* ======================================================================
     THE SHARED OBJECT — detailEncode / detailParse.
     The intake fields ride in the Record's free-text `detail`. Encode and parse
     are the one pair that must agree byte-for-byte; kept here, together.
     Format: "k=v;k=v" with ';' and '=' backslash-escaped inside values, so a
     ';' or '=' in a customer name cannot shift a field boundary (the same
     delimiter-safety discipline the Record's canonicalContent carries).
     ====================================================================== */
  function esc(s) { return String(s == null ? "" : s).replace(/([\\;=])/g, "\\$1"); }
  function detailEncode(fields) {
    /* `v1_stage` is LAST and was added at 1.4. It is the V1 ingest's provenance
       field: three V1 tokens collapse onto one Forest token, so the original is
       carried here to keep the fold lossless IN THE RECORD (the law-3 round-trip
       to V1's conformance oracle depends on it). Before 1.4 this key was absent
       from the order array and detailEncode DROPPED IT SILENTLY — the map emitted
       it, the encoder discarded it, and the map's own suite never ran the two
       together, so "lossless" was asserted at the field boundary and false at the
       record. Appending, never reordering: existing encoded details carry none of
       these bytes, so nothing already signed changes.

       `v1_via` (1.5) is the sibling: the V1 stages FOLDED INTO this event. Several
       V1 stages collapse onto one Forest token, and the importer suppresses the
       duplicates -- without carrying them here, the record could not name every
       stage an order actually passed through, and the round-trip to V1 would be
       lossy exactly where the fold is heaviest. */
    var order = ["customer", "phone", "dropoff", "weight", "cuts", "v1_stage", "v1_via",
                 /* E5b (leg 07) — the Call-1 join. APPENDED, never inserted: every
                    detail string encoded before this leg carries neither key and is
                    byte-identical under the new encoder, so nothing already signed
                    changes. `contact_id` is WHERE the canonical record lives;
                    `contact_hash` is WHAT it looked like at intake (Two-Place #32
                    provenance). Both are absent-not-empty. */
                 "contact_id", "contact_hash",
                 /* E1 note-seam (1.19) — APPENDED LAST, never inserted. Every detail
                    string encoded before this leg carries no `note` key and is
                    byte-identical under the new encoder, so nothing already signed
                    changes. `note` is not a new grammar: weighEncode and
                    tellingEncode have emitted the same key since leg 04 / leg 05;
                    this only lets the SHARED encoder speak it too. Absent-not-empty,
                    like every key above it. */
                 "note"];
    var parts = [];
    for (var i = 0; i < order.length; i++) {
      var k = order[i], v = fields[k];
      if (v != null && String(v).length) parts.push(k + "=" + esc(v));
    }
    return parts.join(";");
  }
  function detailParse(detail) {
    var out = {};
    var s = String(detail == null ? "" : detail);
    var key = "", val = "", inKey = true, escaped = false, i;
    function flush() { if (key) out[key] = val; key = ""; val = ""; inKey = true; }
    for (i = 0; i < s.length; i++) {
      var c = s[i];
      if (escaped) { if (inKey) key += c; else val += c; escaped = false; continue; }
      if (c === "\\") { escaped = true; continue; }
      if (inKey && c === "=") { inKey = false; continue; }
      if (c === ";") { flush(); continue; }
      if (inKey) key += c; else val += c;
    }
    flush();
    return out; // missing keys simply absent -> callers show "unknown", never fabricate
  }

  /* ======================================================================
     E2, THE CORRECTION — the fold, client side.

     A correction is an ORDINARY entry (event "correction") whose detail carries
     supersedes=<entry_hash>;reason=<text>;event=<replacement kind>, in the same
     grammar detailEncode/detailParse above already speak. Nothing is deleted,
     nothing is hidden, nothing leaves the timeline — the correction SUPERSEDES,
     it does not erase (runbook §E2 Watch).

     This is the same rule butcher-record.js's foldCorrections() applies server
     side, for the same reason canonicalContent is computed on both sides of the
     Ring/Stamp seam: one runs in Node against SQLite, this one runs in a browser
     with no require(). They are not allowed to drift, so the drift is CHECKED,
     not hoped for — forest/butcher/test-butcher-record.js requires THIS file and
     round-trips real bytes through both folds.

     A correction that is itself superseded still holds its claim on its target
     (correcting a correction never resurrects the original mistake into the lane)
     and is itself dropped from `effective`.
     ====================================================================== */
  function isCorrection(ev) {
    return String(ev == null ? "" : ev).trim().toLowerCase() === "correction";
  }

  function foldCorrections(entries) {
    var rows = Array.isArray(entries) ? entries : [];
    var supersededBy = {}, byCorrection = {}, i, r, f, target;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (!isCorrection(r.event)) continue;
      f = detailParse(r.detail);
      target = String(f.supersedes == null ? "" : f.supersedes).trim();
      if (!target) continue;
      supersededBy[target] = r.entry_hash;
      byCorrection[r.entry_hash] = {
        supersedes: target,
        reason: String(f.reason == null ? "" : f.reason).trim(),
        event: String(f.event == null ? "" : f.event).trim()
      };
    }
    var effective = [];
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (r.entry_hash != null && supersededBy[r.entry_hash]) continue;
      var c = r.entry_hash != null ? byCorrection[r.entry_hash] : null;
      if (!c) { effective.push(r); continue; }
      var proj = {}; for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) proj[k] = r[k];
      proj.event = c.event; proj.corrects = c.supersedes; proj.correction_reason = c.reason;
      effective.push(proj);
    }
    return { effective: effective, supersededBy: supersededBy, byCorrection: byCorrection };
  }

  /* ======================================================================
     E3a, THE WEIGHT — the client half of the seam (leg 04).

     A weighing is an ORDINARY entry (event "weigh") whose detail carries
     hangingWeightLbs=<decimal>, in the same grammar detailEncode/detailParse
     already speak. Same seam discipline as the correction fold above: this runs
     in a browser with no require(), butcher-record.js runs in Node against
     SQLite, and they are NOT ALLOWED TO DRIFT — so the drift is CHECKED, not
     hoped for (test-butcher-record.js requires this file and round-trips real
     bytes through both).

     WEIGH IS A NON-LINE EVENT, AND THAT IS THE WHOLE MECHANISM. The board reads
     an order's lane from its latest EFFECTIVE entry. `weigh` is not in STAGES,
     so without this declaration `stageForEvent` would answer OTHER and WEIGHING
     AN ORDER WOULD SILENTLY KNOCK IT OFF RICK'S BOARD into a lane nobody
     watches. NON_LINE_EVENTS lives in its own array for exactly the reason
     EXCEPTION_STAGES does: a separate array cannot be walked by the lane loop,
     where a special case inside the loop can be deleted by a future edit.
     Weight ANNOTATES an order; it does not move it. Genuinely unknown events
     are untouched by this and still fall to OTHER, as before.
     ====================================================================== */
  var WEIGH = "weigh";
  /* E4 (leg 05) — the telling tokens live HERE, beside WEIGH, so every declared
     non-line event is visible in one three-line span. `notify` is already a
     STAGE ("reached the point where somebody should call"); `told` is an EVENT
     ("a message went out"). Different facts. Keeping the telling non-line is
     what stops the board reading "told" for a hunter nobody has spoken to. */
  var TOLD = "told";
  var TELL_SKIPPED = "tell_skipped";
  /* E3c (leg 06) — the money tokens, declared HERE beside the others for the same
     reason the server declares them beside WEIGH: the point of the array is that
     every declared non-line event is visible in ONE span. The sharp reason money
     must be non-line: the `pickup` stage ACCEPTS the alias "paid", so a payment
     read as a line event would move a hunter who paid a deposit at DROP-OFF into
     "Picked up" — claiming he collected meat that is still hanging. */
  var PAYMENT = "payment";
  var REFUND = "refund";
  /* Leg 09 — the weather token, declared HERE beside the others for the same
     reason every one above it is: the point of the array is that every declared
     non-line event is visible in ONE span.

     THIS DECLARATION WAS MISSING AND IT WAS A LIVE DRIFT. Leg 09 built the
     module and added `weather_at_intake` to butcher-record.js's NON_LINE_EVENTS
     — the SERVER's copy — and stopped there, because nothing appended one yet so
     nothing could reveal the gap. The moment the wiring lands, an order's newest
     effective entry is a weather reading; `orderView` would have counted it as a
     LINE entry, `stageForEvent` would answer OTHER, and EVERY ORDER WOULD FALL
     OFF RICK'S BOARD ONE BEAT AFTER IT WAS OPENED. That is the exact silent
     disappearance NON_LINE_EVENTS exists to prevent, arriving through the exact
     mechanism the runtime's own leg-06 comment named: "a second copy of the
     membership is how the two sides drift." Found by wiring, not by reading. */
  var WEATHER_AT_INTAKE = "weather_at_intake";
  var NON_LINE_EVENTS = [WEIGH, TOLD, TELL_SKIPPED, PAYMENT, REFUND, WEATHER_AT_INTAKE];

  function isWeigh(ev) {
    return String(ev == null ? "" : ev).trim().toLowerCase() === WEIGH;
  }
  function isNonLineEvent(ev) {
    var t = String(ev == null ? "" : ev).trim().toLowerCase();
    for (var i = 0; i < NON_LINE_EVENTS.length; i++) if (NON_LINE_EVENTS[i] === t) return true;
    return false;
  }

  /* Exact decimal -> integer thousandths of a pound. Mirrors butcher-record.js's
     toMilliLbs byte-for-byte in behaviour: digits read as digits, no float step,
     and anything finer than a thousandth is REFUSED rather than rounded (a value
     that cannot be represented exactly must not be rounded into a permanent row). */
  function toMilliLbs(value) {
    if (value == null) return null;
    var m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(String(value).replace(/^\s+|\s+$/g, ""));
    if (!m) return null;
    var frac = (m[2] || "");
    while (frac.length < 3) frac += "0";
    var whole = Number(m[1]);
    if (whole > 100000) return null;
    return whole * 1000 + Number(frac);
  }
  function fromMilliLbs(milli) {
    if (milli == null) return null;
    var n = Number(milli);
    if (n < 0) return null;
    var whole = Math.floor(n / 1000);
    var frac = String(n % 1000);
    while (frac.length < 3) frac = "0" + frac;
    frac = frac.replace(/0+$/, "");
    return frac ? whole + "." + frac : String(whole);
  }
  function weighEncode(fields) {
    var parts = ["hangingWeightLbs=" + esc(fields.hangingWeightLbs)];
    if (fields.scale != null && String(fields.scale).length) parts.push("scale=" + esc(fields.scale));
    if (fields.note != null && String(fields.note).length) parts.push("note=" + esc(fields.note));
    return parts.join(";");
  }

  /* COOLER_ZONES — the shop's ruled place vocabulary (owed 416, ).
     Two zones, named by the operator: the Cooler and the Cutting Room. This is
     a CLOSED list on purpose. Before it existed the `cooler` field was free
     text and the live log carried CUTTING ROOM and CUT ROOM as two distinct
     values for one physical room — so the record could not answer the question
     a cooler log exists to answer (is that 23F a freezer or a cutting room?).

     WHY A CONSTANT AND NOT A SETTINGS READ. The zones are a fact about Deer
     Hill, ruled by the operator, not a number invented at a keyboard (compare
     owed 67, the thresholds, correctly left NOT-RULED for exactly that reason).
     When a second shop exists this becomes a shop-record read; until then a
     constant is the honest shape and a settings store would be scaffolding
     around a decision nobody has had to make yet.

     READ STAYS LENIENT. Entries already on the chain carry free text or no
     place at all. Nothing here re-signs or rewrites them: the fold reads what
     was signed. This closes the vocabulary going FORWARD only. */
  var COOLER_ZONES = ["Cooler", "Cutting Room"];

  /* coolerEncode — T-2 (, THE COOLER PANE'S WRITE HALF).
     The browser twin of the Record's `encodeCoolerReading`. It exists as its OWN
     encoder — the weighEncode / tellingEncode precedent — and NOT as a call into
     the shared `detailEncode`, for two reasons that are both byte-facts:

       1. `detailEncode` emits only keys in its hardcoded `order[]` whitelist and
          DROPS EVERY OTHER KEY SILENTLY. Of the cooler vocabulary
          (value, unit, taken_at, source, cooler, device_id, calibrated_at, note)
          exactly ONE — `note` — is in that list. Routing a temperature through
          the shared encoder emits a detail with no temperature in it, and the
          append would sign it. That is the same silent-drop the 1.4 comment on
          `order[]` already documents happening once to `v1_stage`.
       2. `detailEncode` omits empty values; `encodeCoolerReading` emits its four
          REQUIRED keys unconditionally, so the Record's validator can refuse a
          blank reading by name (E_TEMP_MALFORMED) instead of receiving a detail
          that is merely short. Dropping an empty required key would convert a
          loud refusal into a silent absence.

     Key ORDER here is load-bearing and must track the Node encoder exactly:
     value;unit;taken_at;source[;cooler][;device_id][;calibrated_at][;note].
     The E-T2 SEAM test in test-butcher-record.js pins both encoders' bytes
     against each other and goes red the moment either side reorders or drops. */
  function coolerEncode(fields) {
    var f = fields || {};
    var parts = [
      "value=" + esc(f.value),
      "unit=" + esc(f.unit),
      "taken_at=" + esc(f.taken_at),
      "source=" + esc(f.source)
    ];
    if (f.cooler != null && String(f.cooler).length) parts.push("cooler=" + esc(f.cooler));
    if (f.device_id != null && String(f.device_id).length) parts.push("device_id=" + esc(f.device_id));
    if (f.calibrated_at != null && String(f.calibrated_at).length) parts.push("calibrated_at=" + esc(f.calibrated_at));
    if (f.note != null && String(f.note).length) parts.push("note=" + esc(f.note));
    return parts.join(";");
  }

  /* effectiveWeight — the latest EFFECTIVE weighing, or null. Built on the
     correction fold, so a re-weigh supersedes the old reading in the view while
     the first reading stays permanently in the timeline.
     NULL IS A REAL ANSWER AND CALLERS MUST CARRY IT: an unweighed order has no
     total, NOT a total of zero. Painting $0 on an order nobody has weighed is a
     claim the chain cannot back (standing law 2). */
  function effectiveWeight(entries) {
    var rows = foldCorrections(entries).effective, best = null, i, r, f, milli;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (!isWeigh(r.event)) continue;
      f = detailParse(r.detail);
      milli = toMilliLbs(f.hangingWeightLbs);
      if (milli == null) continue;             // unreadable historical row -> ABSENT, never zero
      if (best == null || (r.seq != null && best.seq != null ? r.seq >= best.seq : true)) {
        best = {
          milliLbs: milli, lbs: fromMilliLbs(milli),
          scale: f.scale || null, note: f.note || null,
          seq: r.seq != null ? r.seq : null,
          entry_hash: r.entry_hash != null ? r.entry_hash : null,
          actor: r.actor != null ? r.actor : null,
          corrects: r.corrects != null ? r.corrects : null
        };
      }
    }
    return best;
  }

  /* ======================================================================
     E4, THE CALL — the client half of the seam (leg 05).

     A telling is an ORDINARY entry (event "told") whose detail carries
     channel/to/body in the same grammar detailEncode/detailParse already speak.
     Same anti-drift discipline as the weight seam: this runs in a browser with
     no require(), butcher-record.js runs in Node against SQLite, and they are
     NOT ALLOWED TO DRIFT — so the drift is CHECKED, not hoped for
     (test-butcher-record.js requires this file and round-trips real bytes).

     WHAT THIS SURFACE MAY SAY, AND IT IS A SHORT LIST. "Told" here means a
     message was COMPOSED AND HANDED to the shell's compose surface. There is no
     carrier on this line and no read receipt, so no word on this surface may
     imply delivery. "Told" / "not told yet" — that is the whole vocabulary, and
     the boundary is the point (the plan calls notification the place a system
     starts lying).
     ====================================================================== */
  function isTold(ev) {
    return String(ev == null ? "" : ev).trim().toLowerCase() === TOLD;
  }
  function isTellSkipped(ev) {
    return String(ev == null ? "" : ev).trim().toLowerCase() === TELL_SKIPPED;
  }
  function tellingEncode(fields) {
    fields = fields || {};
    var parts = ["channel=" + esc(fields.channel), "to=" + esc(fields.to)];
    if (fields.template != null && String(fields.template).length) parts.push("template=" + esc(fields.template));
    if (fields.templateSource != null && String(fields.templateSource).length) parts.push("templateSource=" + esc(fields.templateSource));
    if (fields.subject != null && String(fields.subject).length) parts.push("subject=" + esc(fields.subject));
    parts.push("body=" + esc(fields.body));
    return parts.join(";");
  }
  function skipEncode(fields) {
    fields = fields || {};
    var parts = ["reason=" + esc(fields.reason)];
    if (fields.channel != null && String(fields.channel).length) parts.push("channel=" + esc(fields.channel));
    if (fields.note != null && String(fields.note).length) parts.push("note=" + esc(fields.note));
    return parts.join(";");
  }

  /* tellStatus — THE DERIVED READ, and the one {post} 4 is about.

     `told: false` is a REAL ANSWER and every caller must carry it. An order
     sitting in the `notify` lane with no telling event reads NOT TOLD YET —
     that is the entire tension this leg was built around, and it is why the
     stage and the event are two different things.

     Built on the correction fold, so a telling sent to the wrong number is
     superseded in the view while the mistaken one stays permanently in the
     timeline — it has to, because somebody out there received it. */
  function tellStatus(entries) {
    var rows = foldCorrections(entries).effective, best = null, skips = [], i, r, f;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (isTold(r.event)) {
        f = detailParse(r.detail);
        if (!f.channel || !f.to) continue;      // unreadable historical row -> ABSENT, never a telling
        if (best == null || (r.seq != null && best.seq != null ? r.seq >= best.seq : true)) {
          best = {
            channel: f.channel, to: f.to, body: f.body || null,
            template: f.template || null, templateSource: f.templateSource || null,
            seq: r.seq != null ? r.seq : null,
            entry_hash: r.entry_hash != null ? r.entry_hash : null,
            actor: r.actor != null ? r.actor : null,
            timestamp: r.timestamp != null ? r.timestamp : null,
            corrects: r.corrects != null ? r.corrects : null
          };
        }
      } else if (isTellSkipped(r.event)) {
        f = detailParse(r.detail);
        if (!f.reason) continue;
        skips.push({
          reason: f.reason, channel: f.channel || null, note: f.note || null,
          seq: r.seq != null ? r.seq : null,
          actor: r.actor != null ? r.actor : null,
          timestamp: r.timestamp != null ? r.timestamp : null
        });
      }
    }
    return {
      told: !!best, telling: best, skips: skips,
      lastSkip: skips.length ? skips[skips.length - 1] : null
    };
  }

  /* The plain-English skip labels. An order that could NOT be told must be MORE
     visible than one that was ({post} 3), so each reason gets words a tired
     person reads in a cold room — not a token. `no_address_on_file` and
     `no_channel_opt_in` are deliberately different sentences because they need
     different hands: one means go get the address, the other means don't. */
  var SKIP_LABELS = {
    customer_not_found: "no customer on file",
    no_channel_opt_in: "no contact preference — they declined",
    no_address_on_file: "opted in, but no address on file",
    dismissed: "compose window dismissed — nobody was told"
  };
  function skipLabel(reason) {
    var r = String(reason == null ? "" : reason);
    return SKIP_LABELS[r] || r;
  }

  /* emitCompose — THE WEAVE EDGE, taken from Contacts whole (operator ruling,
 : "take patterns from Contacts, but pass all the info it needs").

     The base is contacts-renderer.js's emitCompose and its DISCIPLINE is
     inherited, not just its event name:
       · the sender carries ONLY the intent — no compose logic lives here;
       · the MAIL side owns compose (openComposeTo opens over a live mail view,
         else stashes a pending intent the next mailbox build consumes). Butcher
         gets that for free and must not build a second version of it;
       · cross-env CustomEvent, bubbles:true, wrapped in try/catch — cold-safe,
         never a render throw.

     THE WIDENING IS ADDITIVE AND THAT IS WHY IT IS SAFE. `detail` gains
     `subject` and `body`; the Contacts consumer reads only `detail.to` and its
     test asserts only `to`, so it is unaffected BY CONSTRUCTION. This is a
     shared cross-app contract and the widening is deliberate and recorded here
     rather than discovered later — quiet widening of a shared contract from
     inside one app is the move that is invisible until it is load-bearing. */
  function emitCompose(node, intent) {
    if (!node || !intent || !intent.to) return null;
    var detail = { to: intent.to };
    if (intent.subject != null && String(intent.subject).length) detail.subject = String(intent.subject);
    if (intent.body != null && String(intent.body).length) detail.body = String(intent.body);
    try {
      var doc = node.ownerDocument;
      var view = doc && doc.defaultView;
      var ev = (view && typeof view.CustomEvent === "function")
        ? new view.CustomEvent("forest:compose", { detail: detail, bubbles: true })
        : { type: "forest:compose", detail: detail, bubbles: true };
      if (typeof node.dispatchEvent === "function") node.dispatchEvent(ev);
    } catch (e) { /* cold-safe: the gesture is best-effort, never a render throw */ }
    return detail;
  }

  /* ======================================================================
     E3b, THE MONEY — the EDGE ONLY.

     The arithmetic lives in forest/butcher/butcher-pricing.js and runs server
     side, in integer cents. NOTHING IN THIS FILE COMPUTES MONEY. The host hands
     the view a `pricingSnapshot` already in cents and this pair renders it —
     that is the entire client-side money surface, on purpose. A second
     implementation of the arithmetic in the browser would be a second thing to
     keep correct forever, and the one that drifted would be the one a customer
     read off a screen (standing law 3 — re-express, never `cp`; and there is
     nothing to re-express here, because rendering is not arithmetic).
     ====================================================================== */
  function centsToDollars(cents) {
    if (cents == null) return null;
    var n = Number(cents);
    var neg = n < 0, a = Math.abs(n);
    var frac = String(a % 100);
    if (frac.length < 2) frac = "0" + frac;
    return (neg ? "-" : "") + Math.floor(a / 100) + "." + frac;
  }
  function formatDollars(cents) {
    var d = centsToDollars(cents);
    return d == null ? null : "$" + d;
  }

  /* ======================================================================
     E3c, THE PAYMENT GATE (leg 06) — the client half of the money seam.

     The arithmetic that matters lives server-side (butcher-record.js
     paymentState/storageDue, butcher-pricing.js priceOrder) for the same
     reason the pricing arithmetic does — standing law 3. What lives HERE is
     the fold the surfaces read to paint, mirrored exactly, and the encoders
     the controls write with.

     THE ONE RULE THIS BLOCK EXISTS TO HOLD: an order that has NOT been paid
     for is MORE visible than one that has ({post} 6 — the leg-05
     skip-visibility law applied to money). So a paid order carries no chip
     at all and an unpaid intake carries one. Absence more visible than
     presence; and NOTHING HERE BLOCKS ANYTHING — no disabled stage, no
     greyed button, no refusal. The gate is Rick's hand and the shop's rule;
     the machine's only job is to make the exception impossible to miss.
     A machine that blocks Rick at 6am in a cold room with a truck in the
     driveway is a machine he stops using.
     ====================================================================== */
  var PAYMENT_METHODS = ["cash", "check", "card_terminal"];
  var PAYMENT_FORS = ["deposit", "balance", "storage"];
  var METHOD_LABEL = { cash: "cash", check: "check", card_terminal: "card terminal" };

  function isPayment(ev) { return String(ev == null ? "" : ev).trim().toLowerCase() === PAYMENT; }
  function isRefund(ev) { return String(ev == null ? "" : ev).trim().toLowerCase() === REFUND; }
  function isMoney(ev) { return isPayment(ev) || isRefund(ev); }

  /* Exact digits -> integer cents. The MIRROR of butcher-record.js parseCents,
     and it must stay a mirror: the server refuses at append, and a client that
     accepted what the server refuses would send Rick a 500 instead of a "that
     is not a number of cents". */
  function parseCents(v) {
    if (v == null) return null;
    var s = String(v).trim();
    if (!/^\d+$/.test(s)) return null;
    var n = Number(s);
    return (isFinite(n) && Math.floor(n) === n) ? n : null;
  }

  /* THE DOLLARS BOUNDARY, and it is crossed exactly once per write — here,
     on the way IN, before anything is encoded. Rick types 75.50; the chain
     only ever sees 7550. Read as digits, never multiplied as a float:
     `75.50 * 100` is 7550.000000000001 in this runtime, and that value would
     be refused at append (correctly) after looking fine on screen. */
  function dollarsToCents(v) {
    if (v == null) return null;
    var s = String(v).trim().replace(/^\$/, "").replace(/,/g, "");
    var m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
    if (!m) return null;
    var frac = (m[2] || "").length === 1 ? m[2] + "0" : (m[2] || "00");
    return Number(m[1]) * 100 + Number(frac);
  }

  function paymentEncode(f) {
    f = f || {};
    var parts = ["amountCents=" + esc(f.amountCents), "method=" + esc(f.method), "for=" + esc(f.forWhat)];
    if (f.taken_by) parts.push("taken_by=" + esc(f.taken_by));
    if (f.note) parts.push("note=" + esc(f.note));
    return parts.join(";");
  }
  function refundEncode(f) {
    f = f || {};
    var parts = ["amountCents=" + esc(f.amountCents), "method=" + esc(f.method), "reason=" + esc(f.reason)];
    if (f.taken_by) parts.push("taken_by=" + esc(f.taken_by));
    if (f.note) parts.push("note=" + esc(f.note));
    return parts.join(";");
  }

  function moneyParse(detail) {
    var f = detailParse(detail);
    var pick = function (k) { return (f[k] != null && String(f[k]).length) ? String(f[k]) : null; };
    return {
      amountCents: parseCents(f.amountCents), method: pick("method"), for: pick("for"),
      reason: pick("reason"), taken_by: pick("taken_by"), note: pick("note")
    };
  }

  /* THE FOLD. Reads EFFECTIVE entries, never raw — a deposit typed as 75 and
     corrected to 750 must count ONCE, at 750. The server mirror carries the
     mutation bite; this one carries the same read for the same reason. */
  function moneyFold(entries) {
    var rows = foldCorrections(Array.isArray(entries) ? entries : []).effective;
    var payments = [], refunds = [], hasIntake = false, i, r, kind, m;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      kind = String(r.event == null ? "" : r.event).trim().toLowerCase();
      if (stageForEvent(kind).id === "intake") hasIntake = true;
      if (!isMoney(kind)) continue;
      m = moneyParse(r.detail);
      if (m.amountCents == null) continue;
      var row = {
        amountCents: m.amountCents, method: m.method, for: m.for, reason: m.reason,
        taken_by: m.taken_by, note: m.note,
        seq: r.seq != null ? r.seq : null,
        entry_hash: r.entry_hash != null ? r.entry_hash : null,
        actor: r.actor != null ? r.actor : null,
        timestamp: r.timestamp != null ? r.timestamp : null
      };
      if (isPayment(kind)) payments.push(row); else refunds.push(row);
    }
    function sum(list) { var t = 0, j; for (j = 0; j < list.length; j++) t += list[j].amountCents; return t; }
    function forSum(want) {
      var j, t = 0;
      for (j = 0; j < payments.length; j++) if (payments[j].for === want) t += payments[j].amountCents;
      return t;
    }
    var paidCents = sum(payments), refundedCents = sum(refunds);
    var depositCents = forSum("deposit"), balancePaidCents = forSum("balance"), storagePaidCents = forSum("storage");
    return {
      payments: payments, refunds: refunds,
      timeline: payments.concat(refunds).sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); }),
      paidCents: paidCents, refundedCents: refundedCents, netPaidCents: paidCents - refundedCents,
      depositCents: depositCents, balancePaidCents: balancePaidCents, storagePaidCents: storagePaidCents,
      // storage never credits the cut sheet; a credit is floored at zero so an
      // order can never owe MORE than its own bill.
      creditCents: Math.max(0, depositCents + balancePaidCents - refundedCents),
      paid: payments.length > 0,
      hasIntake: hasIntake,
      unpaidIntake: hasIntake && payments.length === 0
    };
  }

  /* A one-line human label for a money row in the timeline. `taken_by` reads as
 "recorded by", never as "verified by" — the call-2 ruling: ring.js
     holds ONE identity, so every entry is signed by THE SHOP and never by a
     person, and this string must not imply otherwise. */
  function moneyLabel(row, kind) {
    if (!row) return null;
    var amt = formatDollars(row.amountCents);
    var bits = [(kind === REFUND ? "refunded " : "") + amt];
    if (row.for) bits.push(row.for);
    if (row.method) bits.push(METHOD_LABEL[row.method] || row.method);
    if (row.reason) bits.push(row.reason);
    if (row.taken_by) bits.push("recorded by " + row.taken_by);
    return bits.join(" \u00B7 ");
  }

  /* THE ANOMALY CHIP ({post} 6). Present only when an intake carries no payment.
     A PAID ORDER GETS NOTHING — that asymmetry IS the law: an unpaid order must
     be more visible than a paid one, not less. Plain chip, no red, no badge
     count, no alarm: three unpaid intakes is a busy Saturday, not a fire. It
     names the next action rather than scolding, because the next action is the
     only useful thing a chip can carry. */
  function unpaidChip(doc, v) {
    if (!v || !v.money || !v.money.unpaidIntake) return null;
    return el(doc, "span", "chip", {
      text: "no deposit recorded",
      "data-money": "unpaid",
      title: "the shop takes payment before the animal is left \u2014 nothing here blocks the order, "
        + "and no machine on this line can take money; record it when it is in hand"
    });
  }

  /* THE MONEY CONTROL — record a payment, or record a refund.

     A NEAR-TWIN OF correctionControl AND DELIBERATELY NOT FOLDED INTO IT. A
     correction says "this entry was a mistake"; a payment says "this happened."
     {post} 4 turns on keeping those two apart, and two functions cannot drift
     into agreeing that a refund is a correction the way one function with a
     mode flag eventually would.

     PURE: it performs no I/O and appends nothing. It hands a payload UP to the
     host, exactly like every other control on this surface. */
  function moneyControl(doc, view, opts) {
    if (!opts || typeof opts.onMoney !== "function") return null;
    if (!view || !view.order_id) return null;

    var wrap = el(doc, "div", "butcher__money", { "data-region": "money" });
    var btn = el(doc, "button", "pane__connect butcher__money-open",
      { type: "button", "data-act": "money-open", text: "Record a payment" });
    var panel = el(doc, "div", "view__detail butcher__money-panel",
      { "data-region": "money-form", hidden: "hidden" });

    function field(key, label, ph, type) {
      var lab = el(doc, "label", "field", { "data-field": key });
      lab.appendChild(el(doc, "span", "field__label", { text: label }));
      var input = el(doc, type === "select" ? "select" : "input", "field__control",
        { "data-input": key });
      if (type !== "select") { input.type = type || "text"; if (ph) input.setAttribute("placeholder", ph); }
      lab.appendChild(input);
      panel.appendChild(lab);
      return input;
    }
    function option(sel, value, text) {
      var o = el(doc, "option", null, { value: value, text: text });
      sel.appendChild(o); return o;
    }

    var kind = field("kind", "Kind", null, "select");
    option(kind, PAYMENT, "Payment in");
    option(kind, REFUND, "Refund out");
    var amount = field("amount", "Amount", "e.g. 75.00");
    var method = field("method", "How", null, "select");
    for (var mi = 0; mi < PAYMENT_METHODS.length; mi++) {
      option(method, PAYMENT_METHODS[mi], METHOD_LABEL[PAYMENT_METHODS[mi]]);
    }
    var forWhat = field("for", "Against", null, "select");
    for (var fi = 0; fi < PAYMENT_FORS.length; fi++) option(forWhat, PAYMENT_FORS[fi], PAYMENT_FORS[fi]);
    var reason = field("reason", "Reason", "why the money went back");
    /* `taken_by` is offered plainly and is OPTIONAL. It is an UNVERIFIED gloss:
       one keypair signs for the whole shop, so this records who says they took
       the money, and the label says exactly that and no more. */
    var takenBy = field("taken_by", "Recorded by (not verified)", "who took it");
    var note = field("note", "Note", "optional");

    var honest = el(doc, "p", "pane__absent butcher__money-note", {
      text: "Nothing on this line can take money. This records that money changed hands."
    });
    panel.appendChild(honest);

    var submit = el(doc, "button", "pane__connect butcher__money-submit",
      { type: "button", "data-act": "money-submit", text: "Record it" });
    submit.disabled = true;
    panel.appendChild(submit);

    var err = el(doc, "p", "pane__error butcher__money-error", { hidden: "hidden" });
    panel.appendChild(err);

    function isRefundMode() { return String(kind.value || PAYMENT) === REFUND; }
    function refresh() {
      var cents = dollarsToCents(amount.value);
      var ok = cents != null && cents > 0;
      if (isRefundMode()) ok = ok && !!String(reason.value || "").trim();
      submit.disabled = !ok;
      // the two mode-specific fields swap; neither is ever silently ignored
      reason.parentNode.hidden = !isRefundMode() ? "hidden" : null;
      forWhat.parentNode.hidden = isRefundMode() ? "hidden" : null;
      if (amount.value && cents == null) {
        err.hidden = null;
        err.textContent = "that is not an amount \u2014 dollars and cents, e.g. 75 or 75.50";
      } else { err.hidden = "hidden"; err.textContent = ""; }
      return ok;
    }
    [amount, reason, kind].forEach(function (n) {
      if (n && n.addEventListener) { n.addEventListener("input", refresh); n.addEventListener("change", refresh); }
    });

    function build() {
      var cents = dollarsToCents(amount.value);
      if (cents == null || cents <= 0) return null;
      var refundMode = isRefundMode();
      if (refundMode && !String(reason.value || "").trim()) return null;
      var who = actorFor(opts);
      if (!who) return null;                             // no bench, no money entry
      return {
        order_id: view.order_id,
        event: refundMode ? REFUND : PAYMENT,
        actor: who,
        detail: refundMode
          ? refundEncode({ amountCents: cents, method: method.value || "cash",
              reason: String(reason.value).trim(), taken_by: takenBy.value, note: note.value })
          : paymentEncode({ amountCents: cents, method: method.value || "cash",
              forWhat: forWhat.value || "deposit", taken_by: takenBy.value, note: note.value })
      };
    }
    function fire(e) {
      if (e && typeof e.stopPropagation === "function") e.stopPropagation();
      var payload = build();
      if (!payload) return null;
      opts.onMoney(payload);
      return payload;
    }
    function toggle(e) {
      if (e && typeof e.stopPropagation === "function") e.stopPropagation();
      panel.hidden = panel.hidden ? null : "hidden";
      refresh();
    }
    if (btn.addEventListener) btn.addEventListener("click", toggle);
    if (submit.addEventListener) submit.addEventListener("click", fire);

    wrap.appendChild(btn);
    wrap._open = toggle;
    wrap._submit = fire;
    wrap._build = build;
    wrap._refresh = refresh;
    wrap._fields = { kind: kind, amount: amount, method: method, for: forWhat,
                     reason: reason, taken_by: takenBy, note: note };
    refresh();
    return { control: wrap, panel: panel };
  }

  /* ======================================================================
     LEG 09 — THE WEATHER AT INTAKE, read and turned into words.

     Three functions, and the split between them is CALL 2's ruling: a
     LINE-PRODUCING function is separate from the function that paints, exactly
     as leg 08 split summaryLines/anomalyLines from `_lineEl`. A surface chooses
     WHICH lines to show; it has no way to reach WHAT A LINE SAYS. The printable
     per-order artifact leg 11 may cut consumes these same functions and inherits
     byte-identical text for free — the joint declared once instead of twice.

     WHY THE SHELL RE-READS THE DETAIL INSTEAD OF IMPORTING parseWeather.
     forest/butcher/butcher-weather.js is Node CommonJS: no script tag, no
     bundler, unreachable from the browser. What is NOT duplicated is the
     grammar — `detailParse` above already speaks the same `k=v;k=v` seam the
     module's `encodeWeather` writes into, so the ONLY shared knowledge here is
     the one convention that `rows` rides as JSON in a single value. One line,
     named, rather than a served second copy of a module (standing law 4).

     LAW 3 IS INHERITED AND IT IS STRUCTURAL, NOT POLITE. `rollup` emits NO ROW
     for a day it has no usable temperature for, so there is no placeholder to
     accidentally render — a short window renders short, and a reading we do not
     have renders nothing. Never a dash, never a zero, never an "N/A" dressed as
     data. LAW 2 rides too: `conditions` are the service's own words, carried
     verbatim from the observation and never paraphrased on the way to the glass.
     ====================================================================== */

  function isWeatherAtIntake(ev) {
    return String(ev == null ? "" : ev).trim().toLowerCase() === WEATHER_AT_INTAKE;
  }

  /* The citation keys, mirrored from the module because they are the SIGNED
     preimage's own field names — the wire's vocabulary, not a second opinion
     about it. A citation added at the glass proves nothing; these are read back
     OUT of what was signed, which is the entire point of R2. */
  var WEATHER_CITATION_KEYS = ["station_id", "station_name", "lat", "lon",
    "window_start_utc", "window_end_utc"];

  /* readWeather(entries) — the last EFFECTIVE weather reading on this order, or
     null. Reads the fold, not the raw chain: if a reading was ever superseded
     (wrong station, wrong coordinates — the whole-reading corrections CALL 1
     enumerated), the correction is what should show. Returns the parsed reading
     or null; never a partial object dressed as a reading. */
  function readWeather(entries) {
    var list = Array.isArray(entries) ? entries : [];
    var fold = foldCorrections(list);
    var eff = fold && Array.isArray(fold.effective) ? fold.effective : [];
    var found = null, i;
    for (i = 0; i < eff.length; i++) {
      if (isWeatherAtIntake(eff[i].event)) found = eff[i];      // last one standing
    }
    if (!found) return null;
    var p = detailParse(found.detail);
    var reading = {};
    for (i = 0; i < WEATHER_CITATION_KEYS.length; i++) {
      var k = WEATHER_CITATION_KEYS[i];
      reading[k] = p[k] != null && String(p[k]).length ? p[k] : null;
    }
    reading.slices = p.slices != null && String(p.slices).length ? Number(p.slices) : null;
    try { reading.rows = JSON.parse(p.rows || "[]"); } catch (e) { reading.rows = []; }
    if (!Object.prototype.toString.call(reading.rows).match(/Array/)) reading.rows = [];
    reading.captured = found.timestamp != null ? found.timestamp : null;
    /* A reading with no rows is NOT a reading. The module already refuses to
       write one (captureAtIntake returns null on an empty rollup), so this is
       the belt to that braces — and it means the caller's `if (v.weather)` is a
       complete test, with no second "…and does it have anything in it" check
       waiting to be forgotten at a future call site. */
    if (!reading.rows.length) return null;
    return reading;
  }

  /* weatherLines(reading) — the week, as display-ready rows, oldest first.
     Returns [{ id, date, label, value, conditions }]. `label` is the day as a
     human reads it; `value` is the high/low as one string. The caller does NO
     arithmetic and NO formatting — same discipline summaryLines carries, for
     the same reason: three consumers of one reading must render one wording. */
  function weatherLines(reading) {
    var rows = reading && Object.prototype.toString.call(reading.rows).match(/Array/)
      ? reading.rows : [];
    var out = [], i;
    for (i = 0; i < rows.length; i++) {
      var r = rows[i] || {};
      if (r.date == null || r.highF == null || r.lowF == null) continue;   // LAW 3
      out.push({
        id: "wx-" + String(r.date),
        date: String(r.date),
        label: weatherDayLabel(r.date),
        value: String(r.highF) + "\u00B0 / " + String(r.lowF) + "\u00B0",
        /* LAW 2 — the service's own words, joined for display and NEVER
           rewritten, shortened to a synonym, or mapped onto an icon set. */
        conditions: Object.prototype.toString.call(r.conditions).match(/Array/)
          ? r.conditions.join(", ") : null
      });
    }
    return out;
  }

  /* The date as a person reads it, from the YYYY-MM-DD key. Parsed by hand
     rather than through `new Date(key)`: that constructor reads a bare date as
     UTC MIDNIGHT and then prints it in the local zone, so every day west of
     Greenwich renders as the DAY BEFORE. A weather record that is off by one
     day is worse than no weather record — it is a wrong number holding a
     receipt. This line is the whole reason that cannot happen here. */
  var WEATHER_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function weatherDayLabel(key) {
    var s = String(key == null ? "" : key);
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return s;
    var mi = Number(m[2]) - 1;
    if (!(mi >= 0 && mi < 12)) return s;
    return WEATHER_MONTHS[mi] + " " + String(Number(m[3]));
  }

  /* weatherCitation(reading) — the re-checkability line, and it is the ONLY
     thing standing in for a certification.

     R2's accepted ceiling, restated where a renderer can see it: signing a
     reading proves WE RECORDED THIS AND NOBODY EDITED IT SINCE. It does NOT
     prove NWS said it. What replaces a seal is a skeptical customer's ability
     to re-run the same public query and land on the same numbers — so the
     station, its name and the exact UTC window ride to the glass together or
     not at all. Returns null when the citation is incomplete: a badge without a
     re-runnable citation behind it is forbidden, because that is a wrong noun
     on a right number. */
  function weatherCitation(reading) {
    if (!reading || !reading.station_id) return null;
    if (!reading.window_start_utc || !reading.window_end_utc) return null;
    var who = String(reading.station_id);
    if (reading.station_name) who += " \u00B7 " + String(reading.station_name);
    return {
      station: who,
      window: String(reading.window_start_utc) + " \u2192 " + String(reading.window_end_utc),
      slices: reading.slices == null ? null : Number(reading.slices)
    };
  }

  /* ======================================================================
     E6 (leg 10) — THE NOTES, SURFACED AT THE MOMENT THEY MATTER.

     THE GAP THIS CLOSES, and it is the same gap three times running. The
     note-seam leg (1.19) cut a WRITE path for free text: `detailEncode` speaks
     `note`, `offLineControl` sends one, and weigh/telling/money have emitted
     `note=` since legs 04/05. Nothing ever READ one back as a note. A note
     landed in the timeline as a raw `note=hold the shanks` snippet, buried in a
     chronological Record beside `hangingWeightLbs=` and `taken_by=`, and the
     LIST — the object Rick actually works (pack §3.1) — carried no signal at
     all. Written in four places, readable in none of the moments that matter:
     the contact join and the four write-unreachable exception lanes were this
     same shape, and this is the read half arriving late for the third time.

     THE TWO MOMENTS, and they are different moments. (1) At the LIST, BEFORE he
     touches an order: a chip, because the whole point of a note is that it
     changes what you are about to do, and a note he finds AFTER advancing the
     order is a note that failed. (2) On the PANE, immediately above the action
     controls — not at the bottom, not inside the Record — because that is the
     last surface his eye crosses on the way to the button.

     NO NEW VERB, NO SERVER CHANGE, NO HOST CHANGE. This leg is a fold and two
     paint sites. `detail` has been a signed column since leg 01 and the notes
     are already in the chain; nothing here writes, so nothing here can be
     wrong about what was written.

     THE FULL CHAIN, NOT THE EFFECTIVE ONE. A superseded note renders as
     superseded rather than vanishing — E2's law verbatim: the correction must
     not be able to hide a loss (runbook §E2 Watch). The pane shows every note
     ever written and marks the dead ones; the LIST chip counts only the LIVE
     ones, because the chip is a "read this before you act" signal and a
     corrected note is history, not an instruction. Those two counts differ on
     purpose and the difference is the point. */
  function noteFold(entries) {
    var rows = Array.isArray(entries) ? entries : [];
    var fold = foldCorrections(rows);
    var notes = [], live = 0, i, r, f, text, superseded;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      /* A correction entry's own detail carries supersedes=/reason=/event=, not
         a note; its `reason` already renders on its timeline row. Reading one
         here would file an editorial reason as a shop-floor instruction. */
      if (isCorrection(r.event)) continue;
      f = detailParse(r.detail);
      text = f.note == null ? "" : String(f.note).trim();
      if (!text.length) continue;
      superseded = r.entry_hash != null && !!fold.supersededBy[r.entry_hash];
      if (!superseded) live++;
      notes.push({
        seq: r.seq,
        event: r.event,
        stage: stageForEvent(r.event),
        actor: r.actor,
        timestamp: r.timestamp,
        text: text,
        superseded: superseded
      });
    }
    return { notes: notes, count: notes.length, live: live };
  }

  /* The LIST read. Asymmetric on purpose, and the asymmetry is the law the
     unpaid chip already runs on: an order carrying a note must be more visible
     than one that does not, so a note-free order carries NOTHING here rather
     than an empty "no notes" chip. Counts LIVE notes only (see noteFold): an
     order whose only note was corrected away is, to a man about to press
     Advance, an order with no note. */
  function noteChip(doc, v) {
    if (!v || !v.notes || !v.notes.live) return null;
    var n = v.notes.live;
    return el(doc, "span", "chip", {
      text: n === 1 ? "1 note" : String(n) + " notes",
      "data-note": "present",
      title: "somebody wrote something on this order \u2014 open it before you move it"
    });
  }

  /* ======================================================================
     orderView — PURE derivation of one order's display state from its entries.
     entries: the Record rows for ONE order_id, in seq order (as sliceChain gives).
     Returns only what the entries actually say; nothing invented.
     ====================================================================== */
  function orderView(order) {
    order = order || {};
    var entries = Array.isArray(order.entries) ? order.entries : [];
    var order_id = order.order_id != null ? order.order_id
      : (entries.length ? entries[0].order_id : null);

    /* E2: the lane reads the latest EFFECTIVE event, never plain-latest. After a
       correction the mistake is still the newest entry (and always will be — C1
       removes nothing), so a plain-latest walk would keep showing it forever. */
    var fold = foldCorrections(entries);
    var effective = fold.effective;

    /* E3a: the lane walk skips DECLARED NON-LINE events. A weighing annotates an
       order; it does not advance it. Without this skip a `weigh` would be the
       latest effective entry, `stageForEvent` would answer OTHER, and every
       weighed order would vanish from its lane on Rick's board — a silent
       disappearance, which is the worst kind. Only DECLARED non-line events are
       skipped: a genuinely unknown event still falls to OTHER exactly as before,
       so nothing about the existing behaviour moves. */
    var intake = null, last = null, i, e, lineEntries = [];
    for (i = 0; i < effective.length; i++) {
      if (!isNonLineEvent(effective[i].event)) lineEntries.push(effective[i]);
    }
    for (i = 0; i < lineEntries.length; i++) {
      e = lineEntries[i];
      if (last == null || (e.seq != null && last.seq != null && e.seq >= last.seq)) last = e;
    }
    if (last == null && lineEntries.length) last = lineEntries[lineEntries.length - 1];

    /* The intake FACTS are read off the RAW chain, not the fold. Customer, phone,
       drop-off and cut notes live on the original intake entry's detail; a
       correction's detail carries supersedes/reason/event instead. Reading facts
       off a projected entry would blank them the moment someone corrected an
       intake — showing "customer unknown" for an order whose customer the record
       plainly knows would be painting a claim against the chain (law 2). The
       original entry is never removed, so the facts are always there to read. */
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      if (intake == null && stageForEvent(e.event).id === "intake") { intake = e; break; }
    }

    var meta = intake ? detailParse(intake.detail) : {};
    var stage = last ? stageForEvent(last.event) : OTHER_STAGE;

    return {
      order_id: order_id,
      customer: meta.customer || null,     // null -> the row shows "customer unknown"
      phone: meta.phone || null,
      dropoff: meta.dropoff || null,
      weight: meta.weight || null,
      cuts: meta.cuts || null,
      count: entries.length,               // EVERY entry — a correction never shrinks the count

      /* E3a/E3b (leg 04). `hangingWeight` is DERIVED from the chain and is null
         when the order has never been weighed — distinct from `weight` above,
         which is the intake note somebody typed at drop-off. Two different facts
         recorded by two different hands at two different times; overloading one
         field with both would have made the record lie about which. */
      hangingWeight: effectiveWeight(entries),
      /* Leg 09 — the weather at intake, DERIVED from the chain like
         `hangingWeight` beside it, and null on the overwhelming majority of
         orders (every order opened before this leg, every order where the fetch
         failed, and every order opened with the internet down). Null is the
         resting state here, not an error state: standing law 6 says the business
         goes home in the truck, so an order MUST be openable with no network and
         such an order simply has no reading. The pane renders nothing at all in
         that case — LAW 3, and it is why this field is null-or-complete rather
         than an object with empty rows in it. */
      weather: readWeather(entries),
      /* `pricing` is the host's snapshot, in CENTS, or null. The view never
         computes it. Null renders as "not priced yet", never as $0. */
      pricing: order.pricing || null,
      /* E5b (leg 07) — THE CONTACT JOIN, derived. `order.contact` is the host's
         already-fetched Contacts record, or null; this view never fetches, never
         merges and never resolves. It reads the chain's reference + attested
         snapshot and COMPARES. `status: "unresolved"` is a real answer and every
         caller must carry it — a contact_id that no longer resolves renders the
         snapshot MARKED, never a blank that looks filled and never a fabricated
         current name. Two stores in one process means nothing enforces the join;
         this field is where that cost is made visible instead of hidden. */
      contact: contactState(order),
      /* {post} 7 — the RTB gate re-expressed as a READ. The oracle auto-advanced
         here; we refuse that parity on a standing law (an advance is a signed
         human act) and expose a flag the view MAY show. The Advance stays Rick's,
         and nothing in this object can move an order. */
      readyToButcher: !!(effectiveWeight(entries) && order.pricing && order.pricing.totalCents != null),

      /* E4 (leg 05) — the told/not-told read, DERIVED from telling events and
         never from the stage. `tell.told === false` for an order sitting in the
         `notify` lane is the correct and load-bearing answer: `notify` means
         "somebody should call," `told` means "a message went out," and this
         object is where those two facts are kept apart. Nothing here implies
         delivery — there is no carrier on this line. */
      tell: tellStatus(entries),
      /* E3c (leg 06) — the money read, DERIVED from signed payment and refund
         events and never from a field. Nothing anywhere sets a `depositPaid`
         boolean: whether an order has been paid for is folded, exactly like its
         weight and its telling. `unpaidIntake` is the anomaly {post} 6 names. */
      money: moneyFold(entries),
      /* E6 (leg 10) — the notes, folded ONCE and read by both surfaces, so the
         list chip and the pane strand cannot drift into disagreeing about what
         this order says. Same discipline as advanceControl being one function
         on two surfaces. */
      notes: noteFold(entries),
      /* The host's proposal for what WOULD be sent (butcher-record.js planTelling),
         or null. The view never plans: templates and channel resolution are
         server-side for the same reason the money arithmetic is (standing law 3). */
      tellPlan: order.tellPlan || null,

      latest: last,
      stage: stage,
      stageIndex: stageIndex(stage.id),
      entries: entries,                    // the FULL chain, unfiltered (the timeline shows it all)
      effective: effective,                // the folded view the lane reads
      supersededBy: fold.supersededBy,     // { corrected entry_hash: correcting entry_hash }
      byCorrection: fold.byCorrection,     // { correction entry_hash: {supersedes, reason, event} }
      verify: order.verify || null         // the host's verifyChain result (or null)
    };
  }

  /* TIME-IN-STAGE — the dwell derive (leg 18 foundation, the net-new arithmetic
     the App-Face plan flagged as "NOT a pure render"). How long has this order
     sat in the stage it is CURRENTLY in? orderView already folds the current
     stage off the latest EFFECTIVE line event (`view.latest`, corrected for
     supersessions) — so `view.latest.timestamp` IS "when it entered this stage."
     The dwell reads that ONE arithmetic path; it never re-walks the chain, so the
     board's stage and the alarm's clock can never disagree about which event they
     are timing (the {post} 1 discipline the season fold rests on).

     PURE and DETERMINISTIC: `now` is a PARAMETER (an ISO instant or an epoch-ms
     number) — the clock is I/O the host owns (like the cooler roll-up), never
     read inside. `known` is false when the stage-entry timestamp is unreadable
     (an undated order) OR `now` is unreadable — an unknown dwell is NOT reported
     as zero, the same honesty the season floors carry.

     THIS DERIVE DOES NOT ALARM. It reports the dwell and the stage; the per-stage
     THRESHOLD that turns a dwell into "late" is Rick's food-safety judgment (a
     config-with-placeholder, App-Face §6-#3) and is NOT this file's to invent.
     The colour-coded alarm surface is leg 18's gated remainder; this is its clock,
     nothing more. `ms` is reported RAW (it can be negative under a skewed clock)
     so the policy layer decides how to clamp — the derive does not hide an
     anomaly by flooring it to zero. */
  function _asMs(t) {
    if (typeof t === "number") return isFinite(t) ? t : NaN;
    if (t == null) return NaN;
    return Date.parse(String(t));
  }
  function timeInStage(order, now) {
    var view = orderView(order);
    var stage = view.stage || OTHER_STAGE;
    var enteredAt = (view.latest && view.latest.timestamp != null)
      ? String(view.latest.timestamp) : null;
    var enteredMs = _asMs(enteredAt);
    var nowMs = _asMs(now);
    var known = enteredAt != null && isFinite(enteredMs) && isFinite(nowMs);
    var ms = known ? (nowMs - enteredMs) : null;
    return {
      orderId: view.order_id,
      stage: { id: stage.id, label: stage.label },
      enteredAt: enteredAt,                       // ISO instant the current stage began, or null (undated)
      now: known ? new Date(nowMs).toISOString() : null,
      known: known,                               // false => dwell unknown; a surface must not draw it as 0
      ms: ms,                                     // raw; may be negative under clock skew — the policy clamps
      hours: known ? ms / 3600000 : null,
      days: known ? ms / 86400000 : null
    };
  }

  /* LEG 18 — turn a `timeInStage(...)` dwell + a config into an alarm LEVEL.
     Pure and number-free of its own: every threshold comes from `config`, so
     this function invents no food-safety judgment (that is Rick's, §6-#3). A
     dwell with `known:false` is ALWAYS `level:"unknown"`, never "ok" — the same
     honesty as the season floors: an undated order can't be judged clear, so it
     is not drawn as safe. A stage with no config entry gets `level:"none"` (no
     clock). `placeholder` rides through so the surface can mark a non-real limit.
     Levels: none · unknown · ok · watch · late. */
  function dwellAlarm(dwell, config) {
    var cfg = (config && config.stages) || {};
    var stageId = dwell && dwell.stage ? dwell.stage.id : null;
    var t = stageId != null ? cfg[stageId] : null;   // no config for this stage => no clock
    if (!t) return { level: "none", placeholder: false };
    if (!dwell.known) return { level: "unknown", placeholder: !!t.placeholder,
                               watchDays: t.watchDays, lateDays: t.lateDays };
    var d = dwell.days;
    var level = d >= t.lateDays ? "late" : (d >= t.watchDays ? "watch" : "ok");
    return { level: level, placeholder: !!t.placeholder,
             watchDays: t.watchDays, lateDays: t.lateDays };
  }

  /* honest verify chip: a real clear -> known/gold-due by stage; a real failure ->
     a LOUD "broken" chip; an ABSENT verify -> the unreachable FORM (dashed, no fill),
     never a fabricated green. Mirrors the honest-badge grammar in tokens.css. */
  function verifyChip(doc, verify, done) {
    var chip;
    if (verify && verify.valid === true) {
      chip = el(doc, "span", "badge" + (done ? "" : " badge--known-due"),
        { text: "verified", "data-verify": "valid", title: "chain hashes, links, and signatures all verify" });
    } else if (verify && verify.valid === false) {
      var where = (verify.reason ? verify.reason : "chain") +
        (verify.failure_seq != null ? " @ seq " + verify.failure_seq : "");
      chip = el(doc, "span", "badge badge--overdue",
        { text: "BROKEN — " + where, "data-verify": "broken",
          title: "this order's record does not verify — do NOT trust or ship it" });
    } else {
      chip = el(doc, "span", "badge",
        { text: "unverified", "data-verify": "unknown",
          title: "verify not run — state unknown, not clear" });
      chip.style.borderStyle = "dashed";           // the unreachable FORM carries the state
      chip.style.background = "transparent";
    }
    return chip;
  }

  /* LEG 18 — the aging line for row__meta. A plain, colourless phrase naming
     the dwell in words ("3 days in Cutting"). Returned for a KNOWN dwell whose
     stage carries a clock (levels ok/watch/late); null otherwise — an undated
     dwell must NOT paint a "0 days" line (the same asymmetry as the season
     floors: absence is silence, never a confident zero). The level colour lives
     on the trail chip below, not here — this line stays neutral so the row body
     reads the same whether or not the order is late. */
  function agingLine(dwell, alarm) {
    if (!dwell || !alarm) return null;
    if (alarm.level === "none" || alarm.level === "unknown") return null;
    if (!dwell.known) return null;
    var whole = Math.floor(dwell.days);
    var unit = whole === 1 ? "day" : "days";
    return whole + " " + unit + " in " + dwell.stage.label;
  }

  /* LEG 18 — the aging MARK for the trail. Reuses the honest-badge grammar
     verbatim (no new red class, the zero-new-CSS gate): `badge--overdue` for
     late (the same mark an unpaid/overdue order wears), `badge--known-due` for
     watch (the gold/due idiom), the dashed unreachable FORM for unknown. A
     placeholder threshold appends a visible "example limit — set your real
     number" note so the mark is NEVER read as a real food-safety limit. Returns
     null for `ok` (a healthy order wears nothing — the asymmetry is the law:
     watch/late must be more visible than ok) and for `none` (no clock). */
  function agingChip(doc, dwell, alarm) {
    if (!dwell || !alarm) return null;
    var placeholderNote = alarm.placeholder
      ? "  \u26A0 example limit \u2014 set your real number" : "";
    var chip;
    if (alarm.level === "late") {
      chip = el(doc, "span", "badge badge--overdue",
        { text: "LATE" + placeholderNote, "data-aging": "late",
          title: "this order has been in " + dwell.stage.label +
                 " past its \u201clate\u201d limit" +
                 (alarm.placeholder ? " (placeholder — Rick sets the real number)" : "") });
    } else if (alarm.level === "watch") {
      chip = el(doc, "span", "badge badge--known-due",
        { text: "watch" + placeholderNote, "data-aging": "watch",
          title: "approaching the \u201clate\u201d limit for " + dwell.stage.label +
                 (alarm.placeholder ? " (placeholder — Rick sets the real number)" : "") });
    } else if (alarm.level === "unknown") {
      chip = el(doc, "span", "badge",
        { text: "no readable date", "data-aging": "unknown",
          title: "this order has no dated entry for its current stage — dwell can't be judged, not clear" });
      chip.style.borderStyle = "dashed";           // the unreachable FORM carries the state
      chip.style.background = "transparent";
    } else {
      return null;                                 // ok / none wear nothing
    }
    return chip;
  }

  /* E4 — the told / not-told-yet chip. ONE builder, so the list row and the
     order pane can never drift into disagreeing about whether a hunter has been
     called (the same discipline advanceControl carries for "next").

     Returns null before the `notify` lane: an order still hanging in the cooler
     has nothing true to be told, and painting "not told yet" on it would turn a
     real signal into wallpaper.

     THE WORDS ARE THE WHOLE CONTROL. "told" — not "sent", not "delivered",
     not "notified". A message was composed and handed off; that is the only
     claim the chain can back, so it is the only claim on the screen. */
  /* claimableTelling — THE ONE PLACE the told-claim is adjudicated.

     `tell.told` and `tell.telling` are two fields of ONE derived answer, and two
     surfaces were each trusting the flag to imply the payload. A mutation-bite
     proved the coupling by throwing a TypeError inside the render — twice, at
     two different sites. Two call sites reading a coupled invariant by hand is
     how they drift; one reader is how they cannot.

     The rule it encodes is the leg's own: if we cannot name the CHANNEL and the
     RECIPIENT, we cannot claim the hunter was told. Returns the telling, or null. */
  function claimableTelling(v) {
    var t = v && v.tell && v.tell.told ? v.tell.telling : null;
    return (t && t.channel && t.to) ? t : null;
  }

  function tellStateChip(doc, v) {
    if (!v || !v.tell) return null;
    if (stageIndex(v.stage.id) < stageIndex("notify")) return null;
    if (stageIndex(v.stage.id) >= STAGES.length) return null;   // exception lanes / OTHER

    /* COLD-SAFE, AND IT IS NOT DEFENSIVE PADDING — it is the honest reading.
       `told` and `telling` are two fields of one derived answer, and this chip
       trusted the flag to imply the payload. A mutation-bite proved the coupling:
       invert the read and this line throws a TypeError inside renderBoard, which
       in a browser takes the WHOLE board down for every order, not just the one
       with the bad row (the render-throw scar this file already carries).
       And the fallback is the truthful one: if we cannot name the channel and the
       recipient, we cannot claim the hunter was told. */
    var t = claimableTelling(v);
    if (t) {
      return el(doc, "span", "chip", {
        text: "told \u00B7 " + t.channel,
        "data-tell": "told",
        title: "a " + t.channel + " to " + t.to + " was composed and handed off "
          + fmtWhen(t.timestamp) + " \u2014 handed off, not confirmed delivered"
      });
    }
    var skip = v.tell.lastSkip;
    if (skip) {
      /* An order that could NOT be told is MORE visible than one that was
         ({post} 3) — it carries the reason right on the row, because the reason
         is the next action. */
      return el(doc, "span", "chip", {
        text: "not told \u00B7 " + skipLabel(skip.reason),
        "data-tell": "skipped",
        "data-skip-reason": String(skip.reason),
        title: "nobody was told, and the record says why"
      });
    }
    return el(doc, "span", "chip", {
      text: "not told yet",
      "data-tell": "untold",
      title: "this order reached the point where somebody should call \u2014 no message has gone out"
    });
  }

  /* ======================================================================
     E5a item 5 — SEARCH, recognition over recall.

     Nobody remembers tag 2026-114. Pack §6 row 2: the tag DERIVES from customer
     + drop-off date, so the NAME is the primary handle and the tag is the
     secondary. A search that only matched tags would have missed the leg.

     THIS IS A SUBSTRING COMPARE AND IT IS DELIBERATELY NOT A QUERY LANGUAGE.
     The Loop-Line carries the scar: *a search box is a place where user text
     meets a PARSER* — FTS5's `MATCH ?` is a query language, and an apostrophe
     in a customer name took the runtime down with an unhandled rejection. The
     defence here is not to guard a parser, it is to NOT INTRODUCE ONE. No
     regex is built from the query (`new RegExp(userText)` is a parser too),
     no FTS, no network. `indexOf` on a lowercased string, and an apostrophe is
     just a character. Keep it that way.

     It runs over data ALREADY IN HAND — the board ships every order's intake
     entry, and `orderView` has already parsed the customer off it. If the wire
     is ever trimmed, re-read this: customer + order_id must both survive the
     trim or search moves server-side and meets exactly the parser above.

     Returns the KIND of match so the caller can honour name-before-tag:
       "name" | "tag" | null */
  function matchKind(view, query) {
    var q = String(query == null ? "" : query).trim().toLowerCase();
    if (!q) return null;
    var name = String((view && view.customer) || "").toLowerCase();
    if (name && name.indexOf(q) !== -1) return "name";       // primary handle
    var tag = String((view && view.order_id) || "").toLowerCase();
    if (tag && tag.indexOf(q) !== -1) return "tag";          // secondary
    return null;
  }
  // Name matches first, tag-only matches after; relative order preserved within
  // each group. An empty/absent query is NOT a filter — it returns everything.
  function filterViews(views, query) {
    views = Array.isArray(views) ? views : [];
    var q = String(query == null ? "" : query).trim();
    if (!q) return views.slice();
    var byName = [], byTag = [], i, k;
    for (i = 0; i < views.length; i++) {
      k = matchKind(views[i], q);
      if (k === "name") byName.push(views[i]);
      else if (k === "tag") byTag.push(views[i]);
    }
    return byName.concat(byTag);
  }

  function fmtWhen(iso) {
    // relative-time.js attaches the BARE function at window.ForestShell.relativeTime
    // in the browser, but exports { relativeTime } under Node (the test shape). The
    // prior guard read ONLY the Node shape (rt.relativeTime), so on the live box —
    // where rt IS the function — it was always false and every "when" fell through
    // to the short-local-date fallback (owed butcher-fmtwhen-reads-node-export-shape).
    // Accept both shapes.
    var rt = root.relativeTime;                      // reuse the shell's relative-time if present
    var rtFn = (typeof rt === "function") ? rt
             : (rt && typeof rt.relativeTime === "function") ? rt.relativeTime
             : null;
    if (rtFn) { try { return rtFn(iso); } catch (_) {} }
    /* THE FALLBACK USED TO PRINT THE ISO STRING VERBATIM, and on the live box it
       is the fallback that fires — `2026-07-26T12:01:47.061Z` on the face of a
       board a butcher reads between cuts. A machine timestamp is not a degraded
       date, it is a different KIND of thing, and shipping it as one is the same
       Real-or-Made fault as a fabricated number: it looks like an answer.
       Degrade to a SHORT LOCAL DATE instead — less precise than the relative
       form, still a date a person reads. Unparseable input still returns the raw
       string: inventing a date we cannot derive is the one worse option. */
    if (iso == null) return "";
    try {
      var d = new Date(iso);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
          ", " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      }
    } catch (_) {}
    return String(iso);
  }

  /* ======================================================================
     SURFACE 1 — renderIntake(doc, opts)
     The Deer Hill intake form. Fields that OPEN an order. On submit, builds the
     record-ready payload and hands it to opts.onIntake — the surface never writes.
     Required: order_id (the deer tag) + customer. Submit stays disabled until both
     are non-empty (an order with no tag and no owner is not an order).
     opts: { onIntake(payload), actor }  (actor defaults to "Shea")
     ====================================================================== */
  /* ======================================================================
 SURFACE — renderSettings(doc, config, opts) · leg 26 / 

     The FIRST instance of the Forest Settings Pattern
     (design/forest-settings-pattern-plan-v1.md). A PURE config-editor panel:
     it reads the live dwell config (or the labeled placeholder when unset),
     paints per-stage editable watch/late day pairs, and hands every edit back
     through the host via `opts.onConfigChange` — the HOST owns the write, which
     goes THROUGH the runtime as an owner-data (Soil) write, never around it and
     never here. This surface performs no I/O and holds no persisted state.

     THE §6-#3 GATE, MADE STRUCTURAL: this surface NEVER suggests a food-safety
     number Rick did not choose. A placeholder stage (STAGE_DWELL_DEFAULT, or a
     stage carrying `placeholder:true`) renders an EMPTY input with the example
     shown only as a grayed HINT (the HTML placeholder attr) plus the row mark
     "example — set your real number" — so the field is unset until Rick TYPES
     one. A real, owner-set stage shows its real value. An example number is
     never pre-filled as `value`, because a pre-filled value reads as a chosen
     one, and that is exactly the suggestion the no-invent law forbids.

     On any edit the surface emits `opts.onConfigChange({ stage, watchDays,
     lateDays })` (numbers, or undefined for a still-empty field). Cold-safe:
     with no `onConfigChange` the field still edits locally and NEVER fakes a
     persistence it did not get (flag-don't-fake).
     ====================================================================== */
  function renderSettings(doc, config, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    opts = opts || {};
    var SF = root.settingsFrame;   // the shared Forest Settings frame ( §6-a); cold-safe below

    var cfg = config || STAGE_DWELL_DEFAULT;
    var cfgStages = (cfg && cfg.stages) || STAGE_DWELL_DEFAULT.stages;
    var cfgIsPlaceholder = !!(cfg && cfg.placeholder);

    // The four real STAGES ids that carry a clock, in order. intake/pickup and
    // the exception lanes carry NO clock (STAGE_DWELL_DEFAULT's own law), so
    // they are absent here by construction — not an omission.
    var STAGE_ROWS = [
      { id: "hang",    label: "Hanging" },
      { id: "cuts",    label: "Cutting" },
      { id: "package", label: "Packaging" },
      { id: "notify",  label: "Notified (awaiting pickup)" }
    ];

    // The titled panel frame comes from the shared Forest Settings frame; butcher
    // passes its OWN skin classes (dual-class, zero marginal CSS) so the DOM is
    // byte-identical to the pre-extract surface. Cold-safe: absent settingsFrame ->
    // the inline pane, exactly as before.
    var LEDE = "Set how long an order may sit in each stage before the Order Board flags it. These are your numbers \u2014 the board never guesses a food-safety limit.";
    var pane = (SF && SF.panel)
      ? SF.panel(doc, {
          rootClass: "pane pane--live", kind: "butcher-settings",
          titleTag: "h2", titleClass: "pane__title", title: "Settings",
          ledeClass: "pane__lede", lede: LEDE
        })
      : (function () {
          var p = el(doc, "section", "pane pane--live", { "data-kind": "butcher-settings" });
          p.appendChild(el(doc, "h2", "pane__title", { text: "Settings" }));
          p.appendChild(el(doc, "p", "pane__lede", { text: LEDE }));
          return p;
        })();

    var inputs = {};   // inputs[stageId] = { watch: <input>, late: <input> }

    STAGE_ROWS.forEach(function (row) {
      var st = cfgStages[row.id] || {};
      // A row is a placeholder (unset) when the whole config is placeholder OR
      // this stage carries placeholder:true OR the stage is simply absent.
      var isPh = cfgIsPlaceholder || !!st.placeholder || !cfgStages[row.id];

      var group = el(doc, "div", "field-group" + (isPh ? " field-group--example" : ""),
        { "data-stage": row.id });
      var head = el(doc, "div", "field-group__head", {});
      head.appendChild(el(doc, "span", "field-group__label", { text: row.label }));
      if (isPh) {
        // The honest mark: this row is an EXAMPLE until Rick sets it, never a real limit.
        head.appendChild(el(doc, "span", "badge badge--example",
          { text: "example \u2014 set your real number" }));
      }
      group.appendChild(head);

      inputs[row.id] = {};
      [["watch", "watchDays", "Watch after (days)"],
       ["late",  "lateDays",  "Late after (days)"]].forEach(function (f) {
        var key = f[0], cfgKey = f[1], label = f[2];
        var realVal = st[cfgKey];
        var input = el(doc, "input", "field__control field__control--num", {
          type: "number", min: "0", inputmode: "numeric",
          "data-input": row.id + "-" + key,
          "aria-label": row.label + " \u2014 " + label
        });
        // THE GATE: a placeholder stage shows the example ONLY as a grayed hint,
        // never as a filled value. A real stage shows its real value. (Butcher's
        // own field-set logic — the honest §6-#3 gate stays HERE, not in the frame.)
        if (isPh) {
          if (realVal != null) input.setAttribute("placeholder", "e.g. " + realVal);
        } else if (realVal != null) {
          input.setAttribute("value", String(realVal));
          if ("value" in input) { try { input.value = String(realVal); } catch (e) {} }
        }
        // The labeled-row bone comes from the shared frame (field field--inline >
        // field__label + control). Cold-safe: absent settingsFrame -> inline.
        var wrap = (SF && SF.labeledRow)
          ? SF.labeledRow(doc, {
              rowClass: "field field--inline", labelClass: "field__label",
              label: label, control: input,
              rowAttrs: { "data-field": row.id + "-" + key }
            })
          : (function () {
              var w = el(doc, "label", "field field--inline", { "data-field": row.id + "-" + key });
              w.appendChild(el(doc, "span", "field__label", { text: label }));
              w.appendChild(input);
              return w;
            })();
        group.appendChild(wrap);
        inputs[row.id][key] = input;

        if (input.addEventListener) {
          input.addEventListener("change", function () { emit(row.id); });
        }
      });

      pane.appendChild(group);
    });

    // Read both fields of a stage and hand the patch to the host. Numbers, or
    // undefined for an empty field. The host turns this into a runtime (Soil)
    // owner-data write; this surface just reports the edit.
    function emit(stageId) {
      var pair = inputs[stageId] || {};
      function num(inp) {
        if (!inp) return undefined;
        var raw = ("value" in inp) ? inp.value : (inp.getAttribute && inp.getAttribute("value"));
        if (raw == null || String(raw).trim() === "") return undefined;
        var n = Number(raw);
        return isFinite(n) ? n : undefined;
      }
      var patch = { stage: stageId, watchDays: num(pair.watch), lateDays: num(pair.late) };
      // The host-owned persist seam comes from the shared frame (flag-don't-fake:
      // never throws, never fakes a persistence it did not get). Cold-safe: absent
      // settingsFrame -> the inline host call, exactly as before.
      if (SF && SF.hostPersist) return SF.hostPersist(opts.onConfigChange, patch);
      if (typeof opts.onConfigChange === "function") {
        try { opts.onConfigChange(patch); } catch (e) {}
      }
      return patch;   // returned for host/test drive without a synthetic event
    }

    // Host/test drive without synthesising DOM events (the renderIntake precedent).
    pane._emit = emit;
    pane._inputs = inputs;
    return pane;
  }

  function renderIntake(doc, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    opts = opts || {};

    var pane = el(doc, "section", "pane pane--live", { "data-kind": "butcher-intake" });
    pane.appendChild(el(doc, "h2", "pane__title", { text: "New order" }));

    var fields = {};
    function addField(key, label, ph, type) {
      var wrap = el(doc, "label", "field", { "data-field": key });
      wrap.appendChild(el(doc, "span", "field__label", { text: label }));
      var input = el(doc, "input", "field__control",
        { type: type || "text", placeholder: ph || "", "data-input": key });
      wrap.appendChild(input);
      fields[key] = input;
      pane.appendChild(wrap);
      return input;
    }

    addField("order_id", "Deer tag #", "e.g. 2026-114");
    addField("customer", "Customer", "name on the order");
    addField("phone",    "Phone",    "for the ready call", "tel");
    addField("dropoff",  "Drop-off", "", "date");
    addField("weight",   "Field weight (lb)", "", "text");
    addField("cuts",     "Cut notes", "steaks / roasts / grind / summer sausage …");

    var submit = el(doc, "button", "pane__connect",
      { type: "button", "data-act": "intake-submit", text: "Open order" });
    submit.disabled = true;
    pane.appendChild(submit);

    function val(k) { return fields[k] && fields[k].value != null ? String(fields[k].value).trim() : ""; }
    function refresh() { submit.disabled = !(val("order_id") && val("customer")); }
    // the shim + real DOM both support addEventListener; guard for cold-safety
    ["order_id", "customer"].forEach(function (k) {
      if (fields[k] && fields[k].addEventListener) fields[k].addEventListener("input", refresh);
    });

    function submitOrder() {
      if (!(val("order_id") && val("customer"))) return null;     // guard: never emit a tag-less/owner-less order
      var who = actorFor(opts);
      if (!who) return null;                             // no bench, no order opened
      var payload = {
        order_id: val("order_id"),
        event: "intake",
        actor: who,
        /* E5b (leg 07) — the Call-1 join, written at the ONE moment the identity
           is actually known. `opts.contact` is a contact the HOST has already
           picked on the Contacts surface; there is NO picker on this pane and
           none is coming (contacts-email-bridge E1/TC-1: dispatch, do not
           implement). Absent it, the encoded detail is byte-identical to every
           intake this line has ever written. Present, it adds the reference AND
           freezes the hash of what canonical looked like right now — the two
           things Two-Place requires a copy to carry. */
        detail: detailEncode({
          customer: val("customer"), phone: val("phone"),
          dropoff: val("dropoff"), weight: val("weight"), cuts: val("cuts"),
          contact_id: contactIdOf(opts.contact),
          contact_hash: opts.contact && contactIdOf(opts.contact) ? contactHash(opts.contact) : null
        })
      };
      if (typeof opts.onIntake === "function") opts.onIntake(payload);   // the host appends to the Record
      return payload;
    }
    if (submit.addEventListener) submit.addEventListener("click", submitOrder);

    // expose for tests + host-driven submit (no DOM event needed)
    pane._submit = submitOrder;
    pane._refresh = refresh;
    pane._fields = fields;
    return pane;
  }

  /* ======================================================================
     SURFACE 1b — renderTempReading(doc, opts)
     T-2 (design §6 leg 2). The cooler log's write face: ONE reading, one unit
     toggle. On submit it builds the record-ready payload and hands it to
     opts.onReading — the surface never writes, exactly like renderIntake.
     opts: { onReading(payload), actor, defaultUnit }   defaultUnit ships "F"

     FIVE THINGS HERE ARE LOAD-BEARING AND EACH IS A RULING OR A BYTE-FACT:

 1. RULING (a), — `actor` is a shop-signed NAME, an unverified
        gloss, NOT a keystore identity. It is SENT (the Record signs who did the
        work) and it is NOT RENDERED ANYWHERE ON THIS PANE. That is the same
        thing renderIntake does, and it is the cheapest possible compliance with
 "no surface may render it verification-shaped" ( call 2): a name
        that is never painted cannot be painted as verified. When per-person
        custody lands (owed 199) this is where the question re-opens — until
        then, drawing a bench name beside a signature chip would assert exactly
        the thing the chain cannot back.

     2. `coolerEncode`, NEVER `detailEncode`. The shared encoder emits only keys
        in its hardcoded `order[]` whitelist and drops the rest SILENTLY; of the
        eight cooler keys exactly one (`note`) is on that list, so routing a
        temperature through it produces a detail with no temperature in it —
        and the chain would SIGN that. The E-T2 SEAM test pins this.

     3. The value is a TEXT input, not type=number. The Record stores the
        reading AS TAKEN and refuses more than three decimal places by name
        (E_TEMP_PRECISION) rather than rounding into a signed row. A number
        input hands the browser licence to normalise "38.50" or step-round what
        the person actually read off the gauge, which destroys the attestation
        before it ever reaches the validator.

     4. `taken_at` is stamped AT SUBMIT, never at render. The pane may sit open
        while Rick walks to the cooler; a render-time stamp would attest a
        reading time that is not when the reading was read. Submit-time is the
        closest truth this surface can honestly hold.

     5. NO BACK-FILL AFFORDANCE, and no client-side clamp. Retroactive entry is
        T-4 and the 24h window is enforced SERVER-side (design §4: "a
        client-side clamp is a suggestion"). Offering a taken_at field here
        would ship half of T-4 with none of its enforcement.
     ====================================================================== */
  function renderTempReading(doc, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    opts = opts || {};

    /* No bench, no reading — the same surface guard renderIntake carries. The
       host refuses at the door too (defence in depth); this is the backstop. */
    if (!actorFor(opts)) return null;

    var unit = opts.defaultUnit === "C" ? "C" : "F";   // ships F; anything unknown falls to F

    var pane = el(doc, "section", "pane pane--live", { "data-kind": "butcher-temp" });
    pane.appendChild(el(doc, "h2", "pane__title", { text: "New temp reading" }));

    var fields = {};
    function addField(key, label, ph, type) {
      var wrap = el(doc, "label", "field", { "data-field": key });
      wrap.appendChild(el(doc, "span", "field__label", { text: label }));
      var input = el(doc, "input", "field__control",
        { type: type || "text", placeholder: ph || "", "data-input": key });
      wrap.appendChild(input);
      fields[key] = input;
      pane.appendChild(wrap);
      return input;
    }

    // THE one field. Text, not number — see note 3 above.
    addField("value", "Temperature", "e.g. 38.5");

    /* The F/C toggle. Two buttons rather than a <select> because this is read
       and pressed with cold hands between cuts, and because the CHOSEN unit is
       part of the stored fact (§3: the reading is stored AS TAKEN, unit and
       all) — it deserves to be visibly one-of-two, not folded into a dropdown
       whose current value is a glance away. */
    var unitWrap = el(doc, "div", "field", { "data-field": "unit" });
    unitWrap.appendChild(el(doc, "span", "field__label", { text: "Unit" }));
    var unitBtns = {};
    ["F", "C"].forEach(function (u) {
      var b = el(doc, "button", "strip__toggle", {
        type: "button", "data-unit": u, text: "\u00B0" + u,
        "aria-label": u === "F" ? "Degrees Fahrenheit" : "Degrees Celsius"
      });
      b.type = "button";
      unitBtns[u] = b;
      if (b.addEventListener) b.addEventListener("click", function () { setUnit(u); });
      unitWrap.appendChild(b);
    });
    pane.appendChild(unitWrap);

    function setUnit(u) {
      unit = (u === "C" ? "C" : "F");
      ["F", "C"].forEach(function (k) {
        var on = (k === unit);
        unitBtns[k].className = "strip__toggle" + (on ? " strip__toggle--on" : "");
        if (unitBtns[k].setAttribute) unitBtns[k].setAttribute("aria-pressed", on ? "true" : "false");
      });
    }
    setUnit(unit);

    /* THE ZONE — owed 415 + 416, landed together because neither pays alone.

       416 was the vocabulary (CUTTING ROOM vs CUT ROOM, one room, two strings).
       415 was the absence (the place simply missing on one of each pair of
       readings — witnessed on the live log at SHELL 1.56, both multi-reading
       days, in BOTH orders, so it was never a first-vs-second ordinal bug).
       A sticky default over free text would have faithfully remembered the
       wrong string; a closed list that still lets the field go empty would
       have left the absence. Together they close both.

       WHY TWO BUTTONS AND NOT A <select>. The same argument the F/C toggle
       above already makes and this file already decided: the chosen zone is
       PART OF THE STORED FACT, and a fact that gets signed into an append-only
       food-safety chain deserves to be visibly one-of-two rather than folded
       into a dropdown whose current value is a glance away. Rick reads this
       with cold hands between cuts. The armed zone is on screen, always.

       WHY THERE IS NO BLANK OPTION. With the list closed and both zones on
       screen, every real reading is taken in one of them — so absence is
       removed BY CONSTRUCTION rather than by remembering to fill a field in.
       That is the Floor drive: the design fails, not the person. The cost is
       that an inattentive submit signs the armed zone rather than nothing —
       the identical risk the unit toggle has always carried and accepted for
       the identical reason (it is visible). It is a real trade and it is named
       here rather than hidden.

       STICKY (415). `opts.lastZone` arms the zone the previous reading used,
       so a second reading in the same room costs zero taps and a second
       reading in the OTHER room costs one. Unknown or absent falls to the
       first zone. The host holds the last value; this surface stays pure. */
    var zone = COOLER_ZONES.indexOf(opts.lastZone) !== -1 ? opts.lastZone : COOLER_ZONES[0];
    var zoneWrap = el(doc, "div", "field", { "data-field": "cooler" });
    zoneWrap.appendChild(el(doc, "span", "field__label", { text: "Where" }));
    var zoneBtns = {};
    COOLER_ZONES.forEach(function (z) {
      var b = el(doc, "button", "strip__toggle", {
        type: "button", "data-zone": z, text: z, "aria-label": "Reading taken in the " + z
      });
      b.type = "button";
      zoneBtns[z] = b;
      if (b.addEventListener) b.addEventListener("click", function () { setZone(z); });
      zoneWrap.appendChild(b);
    });
    pane.appendChild(zoneWrap);

    function setZone(z) {
      zone = COOLER_ZONES.indexOf(z) !== -1 ? z : COOLER_ZONES[0];
      COOLER_ZONES.forEach(function (k) {
        var on = (k === zone);
        zoneBtns[k].className = "strip__toggle" + (on ? " strip__toggle--on" : "");
        if (zoneBtns[k].setAttribute) zoneBtns[k].setAttribute("aria-pressed", on ? "true" : "false");
      });
    }
    setZone(zone);

    addField("note",   "Note",         "optional \u2014 anything an auditor should see");

    var submit = el(doc, "button", "pane__connect",
      { type: "button", "data-act": "temp-submit", text: "Record reading" });
    submit.disabled = true;
    pane.appendChild(submit);

    function val(k) { return fields[k] && fields[k].value != null ? String(fields[k].value).trim() : ""; }
    function refresh() { submit.disabled = !val("value"); }
    if (fields.value && fields.value.addEventListener) fields.value.addEventListener("input", refresh);

    function submitReading() {
      if (!val("value")) return null;              // guard: never emit a reading with no reading in it
      var who = actorFor(opts);
      if (!who) return null;                       // no bench, no entry
      var payload = {
        /* THE RESERVED LANE. A temperature is not an order's event: the Record
           REFUSES a cooler_reading on an order lane (E_COOLER_LANE) and refuses
           anything but readings and their corrections on this one. The lane id
           is a constant of the chain, not a choice this surface makes. */
        order_id: "__cooler__",
        event: "cooler_reading",
        actor: who,
        detail: coolerEncode({
          value: val("value"),
          unit: unit,
          taken_at: new Date().toISOString(),      // note 4 — stamped at submit
          source: "bench",                         // a device never reaches this pane (T-5 has its own path)
          cooler: zone,                            // ruled vocabulary, always carried (owed 415+416)
          note: val("note")
        })
      };
      /* THE SECOND ARGUMENT IS THE DISPLAY VIEW, AND IT EXISTS TO AVOID A SECOND
         PARSER. `payload.detail` is an ENCODED string (`value=32;unit=F;...`).
         A host that wants to show the person what it just recorded would
         otherwise have to decode it — a second copy of the detail grammar,
         free to drift from coolerEncode/parseCoolerReading, which is the exact
         fault honestNode's own header warns about ("a table would be a second
         copy of the runtime's wording"). This pane already HOLDS the unencoded
         values; handing them over costs nothing and keeps the grammar in one
         place. The payload is untouched — the wire contract is unchanged, and
         every existing caller that takes one argument keeps working. */
      var reading = {
        value: val("value"), unit: unit, actor: who,
        cooler: zone, note: val("note")
      };
      if (typeof opts.onReading === "function") opts.onReading(payload, reading);
      return payload;
    }

    /* THE DOUBLE-FIRE WINDOW, CLOSED — AND IT IS A CLICK GUARD, NOT A SUBMIT
       GUARD, WHICH IS THE WHOLE POINT.
       `submitReading` is the TEST + HOST seam (`pane._submit`), called directly
       and repeatedly by butcher-temp-pane.test.js to grade the payload under
       different field states. Putting the latch inside it would make the second
       `_submit()` return null and break assertions that have nothing to do with
       clicking. The defect is a HUMAN clicking twice, so the latch belongs on
       the human's edge.
       Why the window is real: `onReading` hands off to an ASYNC write, the pane
       stays mounted until that promise resolves, and — until this leg — nothing
       on screen changed when it did. A person who sees no confirmation has every
       reason to press again, and the second press was a second signed append to
 an append-only chain. ( checked the live lane: the two entries
       there are two REAL readings 12.5 min apart, not this bug. The window was
       open anyway; it is shut now before it is ever exercised.)
       The latch is released by `pane._rearm()` — which the host calls back on a
       failed write, where the typed reading is still on screen and a retry is
       exactly right.

       THE LATCH IS ITS OWN FLAG, NOT `disabled` — and the suite is what taught
       me that. My first cut read `if (submit.disabled) return`, which conflates
       two different facts: "nothing is typed yet" (what `disabled` has always
       meant here, maintained by refresh() on the `input` event) and "a write is
       in flight" (what this guard needs). The host-wiring test assigns
       `field.value` directly without dispatching `input`, so `disabled` was
       still true from construction and the conflated guard swallowed a
       legitimate append — one FAIL, immediately, before this reached a box.
       The right shape is the one the old code already had: RE-DERIVE the value
       at click time, never trust a cached UI bit. `__inflight` is an expando on
       the button in the same idiom as `pane._submit` / `pane._refresh`, and it
       is on the BUTTON so the host can clear it through the same `data-act`
       hook it already reaches for. */
    function onSubmitClick() {
      if (submit.__inflight) return;        // a write is already in flight
      if (!val("value")) return;            // re-derived, never read off `disabled`
      submit.__inflight = true;             // shut synchronously, BEFORE the async hand-off
      submit.disabled = true;
      if (!submitReading()) {               // nothing was emitted (no bench) -> give it back
        submit.__inflight = false;
        refresh();
      }
    }
    if (submit.addEventListener) submit.addEventListener("click", onSubmitClick);

    // expose for tests + host-driven submit (no DOM event needed) — renderIntake's precedent
    pane._submit = submitReading;
    pane._refresh = refresh;
    // release the in-flight latch AND re-derive `disabled` — one call, used by
    // the host after a refused write and by the suite to prove the retry path.
    pane._rearm = function () { submit.__inflight = false; refresh(); };
    pane._fields = fields;
    pane._unit = function () { return unit; };
    pane._setUnit = setUnit;
    // The zone seam, mirroring the unit seam above — the suite reads the armed
    // zone and drives it, exactly as it does the unit (owed 415+416).
    pane._zone = function () { return zone; };
    pane._setZone = setZone;
    return pane;
  }

  /* ======================================================================
     SURFACE 2 — renderBoard(doc, orders, opts)
     The lifecycle board. orders: array of { order_id, entries, verify }. Grouped
     into stage lanes by each order's LATEST recorded event. Each order is a
     clickable .row -> opts.onOpen(order_id). Empty -> honest-absent pane.
     opts: { onOpen(order_id) }
     ====================================================================== */
  function renderBoard(doc, orders, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    opts = opts || {};
    orders = Array.isArray(orders) ? orders : [];

    var pane = el(doc, "section", "pane pane--live", { "data-kind": "butcher-board" });
    pane.appendChild(el(doc, "h2", "pane__title", { text: "Butcher — orders" }));

    if (!orders.length) {
      pane.className = "pane pane--absent";
      pane.appendChild(el(doc, "p", "pane__absent",
        { text: "No orders yet. Open one to start a record." }));
      return pane;
    }

    /* LEG 18 — the aging alarm is computed HERE, at the view build, because this
       is the one place the raw order and the host's clock are both in hand, so
       buildRow stays a pure render of a passed value (`v.dwell`/`v.alarm`). The
       clock is the HOST's (`opts.now`) — I/O the host owns, like the cooler
       roll-up; a caller that passes none falls back to the wall clock. The
       config is the host's too (`opts.dwellConfig`) so Rick's real numbers land
       as a config pass, no rebuild; absent one, the LOUD placeholder default. */
    var agingNow = opts.now != null ? opts.now : Date.now();
    var agingConfig = opts.dwellConfig || STAGE_DWELL_DEFAULT;
    var views = orders.map(function (o) {
      var v = orderView(o);
      v.dwell = timeInStage(o, agingNow);
      v.alarm = dwellAlarm(v.dwell, agingConfig);
      return v;
    });

    /* A ROW REQUIRES A CHAIN. An order carrying no entries has nothing signed
       behind it, so painting it — into OTHER, where a zero-entry view lands —
       would assert an order exists on the strength of an id alone. That is
       precisely the claim the chain cannot back (standing law 2), and it hands
       Rick a clickable row with nothing under it.

       The route already agrees: GET /board skips an order whose every entry is
       superseded (`if (!last) continue`). This makes the SURFACE agree too, so
       a host driving renderBoard directly cannot conjure what the wire would
       have dropped. Caught reading the item-6 "renders only from a signed
       entry" claim, which until now was prose. */
    views = views.filter(function (v) { return v.count > 0; });

    /* E5a item 5 — the search field. Above the census, because it changes what
       the census is counting. No submit button: filtering is instant and local,
       and a button would imply a round trip that does not happen.

       WHERE IT LIVES IS THE HOST'S CALL (opts.searchHost). Every other Forest
       app puts its app-scoped search in the LEFT RAIL under the primary action
 (/SL-2: Do · Find · Dwell, top to bottom) — mail, calendar and
       contacts all do. Butcher put it in the pane because Butcher had no rail
       to put it in. Now that it does, the host hands in `.rail__search` and the
       field is parented THERE instead, wearing the rail's own vocabulary
       (`rail__search-input`) rather than the in-pane `field` form.

       ONLY THE PARENT AND THE CLASS MOVE. The element, its `data-input` hook,
       its value seeding and every listener bound below are untouched, so the
       filter behaves identically whichever column it is standing in — and a
       host that supplies no searchHost (a unit test, an older renderer) gets
       exactly the pane-local field it got before. */
    var hosted = opts.searchHost && typeof opts.searchHost.appendChild === "function";
    var search = hosted ? opts.searchHost
      : el(doc, "label", "field", { "data-field": "board-search" });
    if (!hosted) search.appendChild(el(doc, "span", "field__label", { text: "Find an order" }));
    var searchInput = el(doc, "input", hosted ? "rail__search-input field" : "field__control",
      { type: hosted ? "search" : "text", placeholder: "customer name or tag",
        "aria-label": "Find an order", "data-input": "board-search" });
    if (opts.query != null) searchInput.value = String(opts.query);
    search.appendChild(searchInput);
    if (!hosted) pane.appendChild(search);

    /* THE GROUP CONTROL (leg 2's design pass). Same seam as the search field
       above, deliberately: `opts.groupHost` is a `.rail__group` the HOST built,
       and a caller that supplies none gets a pane-local control instead — so a
       unit test, the demo pane and an older renderer all keep working with no
       branch anywhere below this line. ZERO NEW GRAMMAR: `.rail__group`,
       `.rail__group-label` and `.strip__select` are all already styled and
       already reaching (calendar and contacts build their rails from them), so
       no stylesheet moves for this and FOREST_SHELL_VERSION stays put.

       It sits BELOW the search for the same reason mail's does: search narrows
       WHAT is shown, grouping decides HOW the shown set is arranged. Reversing
       them would put the arrangement control above the thing it arranges. */
    var groupHosted = opts.groupHost && typeof opts.groupHost.appendChild === "function";
    var groupWrap = groupHosted ? opts.groupHost
      : el(doc, "div", "rail__group", { "data-rail-group": "butcher-grouping" });
    groupWrap.appendChild(el(doc, "label", "rail__group-label",
      { "for": "butcher-group", text: "Group" }));
    var groupSelect = el(doc, "select", "strip__select",
      { id: "butcher-group", "aria-label": "Group orders", "data-input": "board-group" });
    BOARD_GROUP_KEYS.forEach(function (g) {
      groupSelect.appendChild(el(doc, "option", null, { value: g.id, text: g.label }));
    });
    var currentGroup = boardGroupKey(opts.group).id;
    groupSelect.value = currentGroup;
    groupWrap.appendChild(groupSelect);
    if (!groupHosted) pane.appendChild(groupWrap);

    var census = el(doc, "p", "pane__census", { text: "" });
    pane.appendChild(census);

    var lanesRegion = el(doc, "div", "view", { "data-region": "board-lanes" });
    pane.appendChild(lanesRegion);

    /* one row — extracted so the collapsed lanes can build the same row on
       expand as the open lanes build up front. One builder, so a resting row
       and an active row can never drift apart. */
    function buildRow(v) {
      var row = el(doc, "div", "row row--clickable",
        { role: "button", tabindex: "0", "data-order": String(v.order_id) });

      var body = el(doc, "div", "row__body");
      /* A SEPARATOR NEEDS SOMETHING ON BOTH SIDES OF IT. This concatenated the
         `·  #` unconditionally, so a view with no order_id painted
         `customer unknown ·` — a dangling connective advertising a missing
         field. Join only the parts that exist. */
      var titleBits = [v.customer || "customer unknown"];
      /* THE ID IN THE TITLE MUST BE A HANDLE, NOT A MACHINE KEY. A tagged order's
         order_id is a legible handle (e.g. DH-2026-004); an OTHER-lane order born
         from job.created carries a 36-char job UUID. Painting "#<uuid>" dressed a
         machine key as an order number and wrapped three serif lines (the id is
         not absent — it is the WRONG KIND of id reaching the face). The row is
         still routable by data-order below; only the DISPLAY suppresses a uuid.
         An untagged order reads by customer + its meta line, which is honest. */
      var oid = v.order_id != null ? String(v.order_id) : "";
      var isJobUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(oid);
      if (oid !== "" && !isJobUuid) titleBits.push("#" + oid);
      body.appendChild(el(doc, "div", "row__title", { text: titleBits.join("  ·  ") }));
      var metaBits = [];
      if (v.latest) metaBits.push(v.latest.event + " " + fmtWhen(v.latest.timestamp));
      metaBits.push(v.count + (v.count === 1 ? " entry" : " entries"));
      // LEG 18 — the dwell, in words, on the meta line (neutral; the level colour
      // rides the trail chip below). Null for undated / no-clock stages, so a
      // healthy resting order reads exactly as it did before.
      var _ageLine = agingLine(v.dwell, v.alarm);
      if (_ageLine) metaBits.push(_ageLine);
      body.appendChild(el(doc, "div", "row__meta", { text: metaBits.join("  ·  ") }));
      row.appendChild(body);

      var trail = el(doc, "div", "row__trail");
      trail.appendChild(verifyChip(doc, v.verify, isRestingLane(v.stage.id)));
      // LEG 18 — the aging MARK: watch/late/unknown wear an honest badge; ok/none
      // wear nothing (the asymmetry is the law). A placeholder threshold is marked
      // "example limit — set your real number" so it is never read as a real limit.
      var _ageChip = agingChip(doc, v.dwell, v.alarm);
      if (_ageChip) trail.appendChild(_ageChip);
      /* E4 — the told read, on the LIST, because the list is the object Rick
         works (pack §3.1). It paints ONLY from `notify` onward: before an order
         is packed, "not told yet" is noise, not information.

         AN ORDER IN `notify` WITH NO TELLING READS "not told yet" — that is
         {post} 4 and it is the point of the leg. It is a plain chip, no red and
         no scolding: three orders waiting on a call is a Tuesday, not an alarm. */
      var tellChip = tellStateChip(doc, v);
      if (tellChip) trail.appendChild(tellChip);
      /* E3c ({post} 6) — the unpaid anomaly, on the LIST, because the list is
         the object Rick works. A PAID order carries NOTHING here: the asymmetry
         is the law (an unpaid order must be more visible than a paid one), not
         an omission. Nothing about this chip blocks or disables anything. */
      var moneyChip = unpaidChip(doc, v);
      if (moneyChip) trail.appendChild(moneyChip);
      /* E6 (leg 10) — the note read, on the LIST, because the list is the
         object Rick works and a note he finds only after opening the order is a
         note that arrived too late to change anything. Plain chip, no red: a
         note is information, not an alarm. */
      var nChip = noteChip(doc, v);
      if (nChip) trail.appendChild(nChip);
      // E1, the Advance — offered on the LIST, because the list is the object
      // Rick works (pack §3.1: he calls it the list, not a board) and making him
      // open an order to move it spends the whole interaction budget (§3.6).
      var adv = advanceControl(doc, v, opts);
      if (adv) { trail.appendChild(adv); row._advance = adv._fire; }
      // E5a item 3 — the re-entry, offered on the LIST for the same reason the
      // Advance is: the list is the object Rick works. Mutually exclusive with
      // the Advance by construction (a lane has a next OR a resume, never both).
      var res = resumeControl(doc, v, opts);
      if (res) { trail.appendChild(res); row._resume = res._fire; }
      // E4 — the Tell, offered on the LIST for the same reason the Advance is:
      // the list is the object Rick works, and making him open an order to make
      // the call spends the whole interaction budget (pack §3.6).
      var tel = tellControl(doc, v, opts);
      if (tel) { trail.appendChild(tel); row._tell = tel._fire; row._tellSkip = tel._skip; }
      row.appendChild(trail);

      function open() { if (typeof opts.onOpen === "function") opts.onOpen(v.order_id); }
      if (row.addEventListener) {
        row.addEventListener("click", open);
        row.addEventListener("keydown", function (e) {
          if (e && (e.key === "Enter" || e.key === " ")) { if (e.preventDefault) e.preventDefault(); open(); }
        });
      }
      row._open = open;
      return row;
    }

    function clear(node) {
      while (node.childNodes && node.childNodes.length) node.removeChild(node.childNodes[0]);
    }

    /* ------------------------------------------------------------------
       THE PAINT. Runs on first render and on every keystroke.

       `expanded` holds the resting lanes the operator has opened by hand this
       session. It is deliberately NOT reset by a search: opening "Picked up",
       typing a name, and clearing the box should leave it open. Surprise is a
       cost too.

       THE RULE THAT JOINS ITEMS 4 AND 5, and it is the one worth stating out
       loud: **a search sees everything.** With a query, every lane paints its
       matches, resting or not. Searching a customer and being told there are
       no results because they already picked up their order would be the search
       lying, and the whole leg is about recognition over recall. The collapse is
       a DEFAULT-VIEW affordance, never a filter on the truth.
       ------------------------------------------------------------------ */
    var expanded = {};

    function paint() {
      var q = searchInput.value != null ? String(searchInput.value).trim() : "";
      var shown = filterViews(views, q);
      var searching = !!q;

      // census counts what is on screen, and says so when that is a subset
      var byStage = {};
      shown.forEach(function (v) { var id = v.stage.id; byStage[id] = (byStage[id] || 0) + 1; });
      var censusBits = ALL_LANES().filter(function (s) { return byStage[s.id]; })
        .map(function (s) { return byStage[s.id] + " " + s.label.toLowerCase(); });
      census.textContent = searching
        ? (shown.length + (shown.length === 1 ? " match" : " matches") +
           " of " + views.length + (censusBits.length ? " · " + censusBits.join(", ") : ""))
        : (views.length + (views.length === 1 ? " order · " : " orders · ") + censusBits.join(", "));

      clear(lanesRegion);

      if (searching && !shown.length) {
        /* honest absence, and it says WHAT was looked through. "0 results" from a
           search that silently skipped the finished orders would be a lie; this
           one looked at all of them. */
        lanesRegion.appendChild(el(doc, "p", "pane__absent",
          { text: "No order matches \u201C" + q + "\u201D — searched all " +
                  views.length + " by name and tag." }));
        return;
      }

      /* THE GROUPS, under whichever key the axis is on. Under `stage` this is
         exactly what it always was: one lane per stage that has orders, in
         lifecycle order — the six, then the four exception lanes (E5a), then
         OTHER last; an empty lane never renders, so a clean season shows
         exactly the six it always did and the exceptions get a home without
         taking the stage (runbook 03, the named tension). Under `none` it is
         one column, lifecycle-ordered, no headers. The row grammar below is
         the SAME either way — one builder, mail's rule. */
      boardGroupsFor(shown, currentGroup).forEach(function (stage) {
        var laneOrders = stage.orders;

        var resting = stage.restable && !searching && !expanded[stage.id];
        var lane = el(doc, "div", "view__list",
          { "data-lane": stage.id, "data-count": String(laneOrders.length),
            "data-collapsed": resting ? "true" : "false" });

        if (resting) {
          /* THE QUIET GRAMMAR ({post} 6): one line, the lane's own label, a plain
             count. No badge, no red, no scolding — 412 picked-up orders is a good
             season, not a warning. It reads as a line and opens as a line. */
          var summary = el(doc, "div", "line line--clickable",
            { role: "button", tabindex: "0", "data-act": "expand-lane",
              "data-lane-summary": stage.id,
              text: stage.label + "  ·  " + laneOrders.length +
                    (laneOrders.length === 1 ? " order" : " orders") });
          function expand() {
            expanded[stage.id] = true;
            paint();
          }
          if (summary.addEventListener) {
            summary.addEventListener("click", expand);
            summary.addEventListener("keydown", function (e) {
              if (e && (e.key === "Enter" || e.key === " ")) { if (e.preventDefault) e.preventDefault(); expand(); }
            });
          }
          summary._expand = expand;
          lane.appendChild(summary);
          lane._expand = expand;
        } else {
          /* THE COUNT GOES IN THE HEADER. It always existed — as a `data-count`
             attribute NO stylesheet has ever rendered, written on every paint
             and read by nothing. So the stage-level answer to note 4 lived only
             in the census sentence at the top, and the header carrying the lane
             name carried no number. mail's `mail-list__group` is `label · count`
             on every header and that is the fix: the collapsed lane already read
             "Picked up · 412 orders", and an OPEN lane read "CUTTING" and made
             you count the cards. Same separator, same shape, both states.

             A null label is the flat key — one column, no header, because a
             header over the only group is a heading over everything. */
          if (stage.label != null) {
            lane.appendChild(el(doc, "div", "view__region-label",
              { text: stage.label + "  ·  " + laneOrders.length }));
          }
          laneOrders.forEach(function (v) { lane.appendChild(buildRow(v)); });
        }
        lanesRegion.appendChild(lane);
      });
    }

    if (searchInput.addEventListener) searchInput.addEventListener("input", paint);
    /* Changing the axis re-paints; it does NOT re-fetch and does not touch
       `views`. The fold is local, exactly as the filter is. */
    if (groupSelect.addEventListener) {
      groupSelect.addEventListener("change", function () {
        currentGroup = boardGroupKey(groupSelect.value).id;
        paint();
      });
    }
    paint();

    // exposed for the host wiring + tests (no DOM event needed)
    pane._views = views;
    pane._search = searchInput;
    pane._group = groupSelect;
    pane._paint = paint;
    pane._setQuery = function (q) { searchInput.value = q == null ? "" : String(q); paint(); return q; };
    pane._setGroup = function (k) {
      currentGroup = boardGroupKey(k).id; groupSelect.value = currentGroup; paint(); return currentGroup;
    };
    return pane;
  }

  /* ======================================================================
     SURFACE 3 — renderOrder(doc, order, opts)
     One order's record glance: the intake facts, the full event timeline, the
     honest verify state, and the "Take it home" Stamp affordance. The affordance
     hands opts.onStamp(order_id) to the host, which runs stamp.js's exporter and
     triggers the download — this surface offers the button; Chunk A does the export.
     order: { order_id, entries, verify }
     opts:  { onStamp(order_id) }
     ====================================================================== */
  function renderOrder(doc, order, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    opts = opts || {};
    var v = orderView(order);

    if (!v.order_id || !v.entries.length) {
      var absent = el(doc, "section", "pane pane--absent", { "data-kind": "butcher-order" });
      absent.appendChild(el(doc, "p", "pane__absent", { text: "No record for this order." }));
      return absent;
    }

    var pane = el(doc, "section", "pane pane--live", { "data-kind": "butcher-order",
      "data-order": String(v.order_id) });

    var head = el(doc, "h2", "pane__title",
      { text: (v.customer || "customer unknown") + "  ·  order #" + v.order_id });
    pane.appendChild(head);
    pane.appendChild(verifyChip(doc, v.verify, v.stage.id === "pickup"));

    // the intake facts as .line key/values (missing shown as the empty line, not faked)
    function line(label, value) {
      var ln = el(doc, "div", "line" + (value ? "" : " line--empty"));
      ln.appendChild(el(doc, "span", "line__label", { text: label }));
      ln.appendChild(el(doc, "span", "line__value", { text: value || "—" }));
      return ln;
    }
    var facts = el(doc, "div", "view__detail", { "data-region": "facts" });
    facts.appendChild(line("Stage", v.stage.label));
    facts.appendChild(line("Phone", v.phone));
    /* E5b (leg 07) — THE UNRESOLVED / DIVERGED RENDER. Quiet, gold-grammar, the
       same `line` every other fact uses: no red, no badge, no count. Present
       ONLY when there is something true to say. What it says in each case:

         diverged   — BOTH readings, marked. The order was signed for one name
                      and phone; Contacts holds another today. Rendering only the
                      current one would rewrite what the customer handed over at
                      drop-off; rendering only the snapshot would hide that they
                      moved. Stale is not an error here — it is the point.
         unresolved — the SNAPSHOT, marked. Flag, do not fake: the chain still
                      knows who this order was for even when the pointer is dead.

       `resolved` and `none` render nothing extra, because they have nothing
       extra that is true to add. */
    if (v.contact && (v.contact.status === "diverged" || v.contact.status === "unresolved")) {
      facts.appendChild(line("Customer record", contactStateLabel(v.contact)));
      if (v.contact.snapshot && v.contact.snapshot.customer) {
        facts.appendChild(line("Signed for", v.contact.snapshot.customer
          + (v.contact.snapshot.phone ? " \u00B7 " + v.contact.snapshot.phone : "")));
      }
      if (v.contact.status === "diverged" && v.contact.current) {
        facts.appendChild(line("On file now", (v.contact.current.name
          || v.contact.current.display_name || v.contact.current.full_name || null)));
      }
    }
    facts.appendChild(line("Drop-off", v.dropoff));
    facts.appendChild(line("Field weight", v.weight ? v.weight + " lb" : null));
    /* E3a/E3b, leg 04 — QUIET AND DERIVED ({post} 6). Same `line` grammar as
       every other fact on this pane: no red, no emphasis, no "AMOUNT DUE". No
       input anywhere accepts a total; it is computed from weight + config +
       services or it is absent.

       An order with no weighing shows the EMPTY line ("—"), never "$0.00". "We
       have not weighed it" and "it is worth nothing" are different claims and
       only one of them is true — showing the second would be painting a claim
       the chain cannot back (standing law 2), the exact defect leg 03's item 6
       was written to catch.

       E3c (leg 06) EARNED `balanceDue` ITS SURFACE, and the reservation that
       used to sit here is discharged rather than quietly deleted. The deposit
       now has a source — signed payment events, folded — so the number below is
       backed by the chain instead of asserted over it. It obeys the same rule
       everything else on this pane obeys: `pricing` null renders the EMPTY line,
       never "$0.00", because "we have not priced it" and "it is paid off" are
       different claims and only one of them is ever true. */
    facts.appendChild(line("Hanging weight", v.hangingWeight ? v.hangingWeight.lbs + " lb" : null));
    facts.appendChild(line("Total", v.pricing && v.pricing.totalCents != null ? formatDollars(v.pricing.totalCents) : null));
    /* Paid is DERIVED (the chain), Balance is the host's snapshot less that
       credit. An order with events but no price shows Paid and an empty Balance
       — the two facts are independent and the pane keeps them apart. */
    facts.appendChild(line("Paid", v.money.paid
      ? formatDollars(v.money.netPaidCents)
        + (v.money.refundedCents ? " (" + formatDollars(v.money.paidCents) + " in, "
            + formatDollars(v.money.refundedCents) + " back)" : "")
      : null));
    facts.appendChild(line("Balance due",
      (v.pricing && v.pricing.balanceDueCents != null) ? formatDollars(v.pricing.balanceDueCents) : null));
    facts.appendChild(line("Cut notes", v.cuts));
    /* E4 (leg 05) — the telling, in the SAME quiet `line` grammar as every other
       fact on this pane. An order that has never been told shows the EMPTY line,
       exactly as an unweighed order shows "\u2014" rather than "$0.00": "we have
       not called them" and "we called them" are different claims and only one is
       true at a time. The words stop at "handed off" because that is where the
       chain's knowledge stops. */
    var toldT = claimableTelling(v);
    facts.appendChild(line("Told",
      toldT
        ? (toldT.channel + " to " + toldT.to + " \u00B7 " + fmtWhen(toldT.timestamp) + " \u00B7 handed off")
        : (v.tell && v.tell.lastSkip ? "not told \u00B7 " + skipLabel(v.tell.lastSkip.reason) : null)));
    pane.appendChild(facts);

    /* LEG 09 — THE WEEK BEFORE IT ARRIVED.
       The whole leg lands right here, in the quiet `line` grammar every other
       fact on this pane wears: no red, no badge, no icons, no colour ramp on a
       temperature. Present ONLY when there is a reading, absent entirely when
       there is not — an order with no weather shows NO REGION, not an empty one
       captioned "no data". That asymmetry is LAW 3 arriving at the glass.

       THE PAINTER DOES NOT KNOW WHAT A LINE SAYS. Every string below comes from
       weatherLines/weatherCitation; this block only decides placement. That is
       CALL 2's ruling made mechanical rather than promised — when leg 11 cuts a
       per-order artifact it calls the same two functions and CANNOT render
       different words.

       WHY THE CITATION IS NOT OPTIONAL CHROME. It is the only thing standing in
       for a certification (R2's accepted ceiling), so it renders WITH the
       numbers or the numbers do not render at all. A week of temperatures with
       no station and no window behind it is exactly the seal-looking badge this
       leg forbids: it would invite trust it has not earned. */
    var wx = v.weather;
    var wxCite = weatherCitation(wx);
    var wxLines = weatherLines(wx);
    if (wxLines.length && wxCite) {
      var wxRegion = el(doc, "div", "view__detail", { "data-region": "weather" });
      wxRegion.appendChild(el(doc, "div", "view__region-label",
        { text: "Weather at intake" }));
      for (var wi = 0; wi < wxLines.length; wi++) {
        var wl = wxLines[wi];
        var wxRow = el(doc, "div", "line", { "data-day": wl.date });
        wxRow.appendChild(el(doc, "span", "line__label", { text: wl.label }));
        /* High/low and the service's own words in ONE value cell, so a day is one
           reading rather than two facts a reader has to marry up. `conditions`
           absent (the station reported temperature but no description) simply
           renders the temperatures — the honest short line, not a padded one. */
        wxRow.appendChild(el(doc, "span", "line__value",
          { text: wl.conditions ? wl.value + "  \u00B7  " + wl.conditions : wl.value }));
        wxRegion.appendChild(wxRow);
      }
      /* The citation, in the same `line` grammar, last — it is provenance, not a
         headline. `title` carries the full window for a hover without spending a
         line on it; the visible text names the station, which is the field a
         person actually re-runs the query with. */
      var citeRow = el(doc, "div", "line", { "data-region": "weather-citation" });
      citeRow.appendChild(el(doc, "span", "line__label", { text: "Recorded from" }));
      var citeVal = el(doc, "span", "line__value", { text: wxCite.station });
      try { citeVal.title = "UTC window queried: " + wxCite.window; } catch (e) {}
      citeRow.appendChild(citeVal);
      wxRegion.appendChild(citeRow);
      pane.appendChild(wxRegion);
    }

    /* E6 (leg 10) — THE NOTES STRAND, and its PLACEMENT is the leg.
       It sits here, between the facts and the first action control, because
       the moment a note matters is the moment BEFORE the button. At the bottom
       of the pane, under the Record, it would be an archive; here it is the
       last thing his eye crosses on the way to Advance.

       Present ONLY when there is a note — no region at all otherwise, never an
       empty one captioned "no notes". Same asymmetry the weather region above
       obeys, and it is standing law 3 arriving at the glass.

       A SUPERSEDED NOTE STAYS, struck through and labelled, in the SAME form
       the timeline uses for a superseded entry (law 8: this leg adds no bespoke
       skin — shell.css owns no strike class, so the form carries the state).
       Hiding it would let a correction hide a loss, which is the one thing E2
       forbids. */
    if (v.notes && v.notes.count) {
      var notesRegion = el(doc, "div", "view__detail", { "data-region": "notes" });
      notesRegion.appendChild(el(doc, "div", "view__region-label", { text: "Notes" }));
      v.notes.notes.forEach(function (n) {
        var nRow = el(doc, "div", "row", { "data-seq": String(n.seq) });
        if (n.superseded) nRow.setAttribute("data-superseded", "true");
        var nBody = el(doc, "div", "row__body");
        var nText = el(doc, "div", "row__title", { text: n.text });
        if (n.superseded) {
          nText.style.textDecoration = "line-through";
          nText.style.opacity = "0.6";
        }
        nBody.appendChild(nText);
        /* WHO, WHEN, AND ON WHAT ACT — a note with no act behind it is a
           sticky note; a note attached to the weighing is a fact about the
           weighing. The stage LABEL where there is one, for the same reason the
           timeline shows a correction's meant stage.

           BUT NOT WHEN THERE ISN'T ONE. The notes that actually exist today ride
           weigh, told, payment and refund — every one of them a NON-LINE verb,
           so stageForEvent returns the OTHER stage and its label is the word
           "Other". "on Other" is not a fact about anything; it is the shape of a
           fact with the fact removed. Where there is no stage, the verb IS the
           act, so the verb is what renders. Caught by the claim test asserting
           a stage id the fold could never produce — the assertion was wrong and
           so was the line it was aimed at. */
        var nAct = n.stage.id === "other" ? String(n.event) : n.stage.label;
        var nMeta = [n.actor, fmtWhen(n.timestamp), "\u00B7 on " + nAct];
        if (n.superseded) nMeta.push("\u00B7 corrected in the Record below");
        nBody.appendChild(el(doc, "div", "row__meta", { text: nMeta.join("  \u00B7  ") }));
        nRow.appendChild(nBody);
        notesRegion.appendChild(nRow);
      });
      pane.appendChild(notesRegion);
    }

    // E1, the Advance — the same control the list row carries, built by the same
    // function so the two surfaces cannot drift into disagreeing about what
    // "next" means (plan §E1: on each board card AND the order glance).
    var advance = advanceControl(doc, v, opts);
    if (advance) pane.appendChild(advance);
    // E5a item 3 — the same re-entry control the list row carries, from the same
    // function, so the two surfaces cannot drift about where an order resumes.
    var resume = resumeControl(doc, v, opts);
    if (resume) pane.appendChild(resume);
    // E4 — the same Tell control the list row carries, from the same function,
    // so the two surfaces cannot drift about who is reachable or on what channel.
    var tell = tellControl(doc, v, opts);
    if (tell) pane.appendChild(tell);
    /* E3c — the money control lives on the ORDER PANE ONLY, not on the list row.
       Every other control here earned the list because it is one decision Rick
       makes standing up (advance, resume, call). Money is an amount, a method
       and a hand — a form, not a verb — and a form on a list row is how a
       mis-keyed 7500 gets into a chain that cannot remove it. */
    var money = moneyControl(doc, v, opts);
    if (money) { pane.appendChild(money.control); pane.appendChild(money.panel); pane._money = money.control; }

    /* E1 SECONDARY — the off-line move. Order pane only, for the reason stated
       on moneyControl directly above: this is a form, not a verb. */
    var offline = offLineControl(doc, v, opts);
    if (offline) { pane.appendChild(offline.control); pane.appendChild(offline.panel); pane._offLine = offline; }

    /* the event timeline — EVERY recorded event, oldest first, as .row.
       E2: a superseded entry is struck through and stays exactly where it is. It
       is never hidden, never filtered out, never collapsed behind a disclosure —
       the correction must not be able to hide a loss (runbook §E2 Watch). The
       correction that replaced it renders directly beneath it, so the mistake and
       what was meant read as one thing. No red and no scolding: the pane faces
       the work (law 1), and the work is "this was wrong, here is what was meant." */
    var timeline = el(doc, "div", "view__list", { "data-region": "timeline" });
    timeline.appendChild(el(doc, "div", "view__region-label", { text: "Record" }));
    v.entries.forEach(function (e) {
      var correction = e.entry_hash != null ? v.byCorrection[e.entry_hash] : null;
      var superseded = e.entry_hash != null && !!v.supersededBy[e.entry_hash];
      // A correction row shows the stage it MEANT, not the literal token "correction".
      var shownEvent = correction ? correction.event : e.event;
      var stage = stageForEvent(shownEvent);

      var row = el(doc, "div", "row", { "data-seq": String(e.seq) });
      if (superseded) row.setAttribute("data-superseded", "true");
      if (correction) row.setAttribute("data-corrects", String(correction.supersedes));

      var body = el(doc, "div", "row__body");
      var title = el(doc, "div", "row__title", { text: shownEvent });
      if (superseded) {
        // carried in the FORM, the way verifyChip carries "unreachable" as dashed —
        // shell.css owns no strike class and this leg adds no bespoke skin (law 8)
        title.style.textDecoration = "line-through";
        title.style.opacity = "0.6";
      }
      body.appendChild(title);

      var meta = [];
      meta.push(e.actor);
      meta.push(fmtWhen(e.timestamp));
      if (stage.id === "other") meta.push("· uncategorized event");
      if (superseded) meta.push("· corrected below");
      body.appendChild(el(doc, "div", "row__meta", { text: meta.join("  ·  ") }));

      if (correction) {
        // the link back to what this corrected, and WHY — reason is required at
        // append, so it is always there to show. No hash, ever (pack §3.7).
        body.appendChild(el(doc, "div", "row__snippet",
          { text: "corrects the entry above \u00B7 " + correction.reason }));
      } else if (e.detail && stage.id !== "intake") {
        body.appendChild(el(doc, "div", "row__snippet", { text: e.detail }));
      }
      row.appendChild(body);

      var lead = el(doc, "span", "chip", { text: stage.label });
      row.appendChild(lead);

      // the correction affordance, reached from the order's own timeline in one
      // deliberate act. Not offered on an entry already corrected, and not on a
      // correction itself — correct the correction and you would be reasoning
      // about liveness in a cold room.
      var form = correctionControl(doc, v, e, {
        superseded: superseded, isCorrection: !!correction
      }, opts);
      if (form) { row.appendChild(form.control); timeline.appendChild(row); timeline.appendChild(form.panel); }
      else timeline.appendChild(row);
    });
    pane.appendChild(timeline);

    // the affordance that makes Chunk A's Stamp reachable
    var stamp = el(doc, "button", "pane__connect",
      { type: "button", "data-act": "stamp", text: "Take it home (Stamp)" });
    // never offer a take-home copy of a record that does not verify — a broken
    // chain must not leave in the truck looking valid.
    if (v.verify && v.verify.valid === false) {
      stamp.disabled = true;
      stamp.setAttribute("title", "record does not verify — fix the chain before exporting");
    }
    function doStamp() {
      if (stamp.disabled) return null;
      if (typeof opts.onStamp === "function") opts.onStamp(v.order_id);
      return v.order_id;
    }
    if (stamp.addEventListener) stamp.addEventListener("click", doStamp);
    pane.appendChild(stamp);

    pane._stamp = doStamp;
    pane._advance = advance ? advance._fire : null;
    pane._tell = tell ? tell._fire : null;
    pane._tellSkip = tell ? tell._skip : null;
    pane._view = v;
    return pane;
  }

  /* ======================================================================
     E5b (leg 07) — THE CONTACT JOIN. Contacts owns WHO THEY ARE NOW; the
     chain owns WHO THEY WERE THEN, and it keeps its own copy on purpose.

 Operator ruling + (option A, "reference AND snapshot"),
     recorded in runbooks/07-e5b-season-summary.md §"CALL 1 — RE-RULED against
     the Contacts Tree". The superseded union-find design is preserved in that
     runbook and is NOT what this code implements.

     THE REASON THE SNAPSHOT SURVIVES THE REFERENCE. Butcher is a signed hash
     chain and the customer's name and phone live INSIDE the signed preimage:
     `customerFacts()` reads them off the intake detail (butcher-record.js :414)
     and stamp.js folds that detail into the hashed line and renders it into the
     offline-verifiable artifact. The Stamp Rick hands a customer ATTESTS who the
     order was for. A pure `contact_id` reference would move an attested fact
     into a mutable store — the chain would attest to a pointer, and the Stamp
     could not name a person without a live Contacts read. A proof chain cannot
     reference mutable state without losing what it proves.

     PX — The Two-Place Rule (#32) IS ADOPTED FOR ITS PROVENANCE REQUIREMENT AND
     ITS REBUILD REMEDY IS DELIBERATELY DECLINED, and that distinction is the
     whole design. Two-Place says every copy must know it is a copy, know where
     the original is, and be able to tell whether it is still fresh — that is
     exactly `contact_id` (where) plus `contact_hash` (fresh?), and the entry's
     own timestamp already supplies `derived_at`, so it is not duplicated. But
     Two-Place's remedy — rebuild the stale copy from canonical — MUST NOT be
     applied here: this copy is an ATTESTATION, not a cache (#30, The Snapshot:
     immutable once taken). Rebuilding it would rewrite what a customer handed
     over at drop-off, which is leg 02's tension re-emerging on identity.
     **A SUCCESSOR READING THE PATTERN REGISTRY WILL FIND "rebuild from
     canonical" — DO NOT APPLY IT HERE.** On divergence the surface renders BOTH
     and marks it. Stale is not an error state here; it is the point.

     WHAT THIS MODULE MAY DO, AND IT IS A SHORT LIST. It READS a contact the host
     hands it and it COMPARES hashes. It never fetches, never merges, never
     resolves. Same-person judgement is Contacts' (`merge` / `suggest-merges` /
     `owner-unify`, all shipped); editing a record is a cross-app dispatch on the
     `forest:compose` jig — dispatch, do not implement (contacts-email-bridge
     E1/TC-1). There is no contact picker on this pane and none is coming.
     ====================================================================== */

  /* The two keys the chain gains. They are APPENDED to detailEncode's order, never
     inserted, so every previously-encoded detail string stays byte-identical —
     the same guarantee leg 06 established on the bytes for `for=`/`method=`. An
     order intaken before this leg carries neither key and reads as `none`, which
     is a real state and not a fault. */
  var CONTACT_ID_KEY = "contact_id";
  var CONTACT_HASH_KEY = "contact_hash";

  /* The display-only picker, mirroring contacts-renderer's `primaryEmailOf`
     byte-for-byte in behaviour: is_primary first, else the first present, else
     null. SELECTION, NEVER RESOLUTION — it picks among values Contacts already
     holds and invents nothing. Generalized over the value key because emails
     carry `email` and phones carry `phone`, and both may carry `value`. */
  function _primaryOf(list, key) {
    var rows = Array.isArray(list) ? list : [], i, v;
    for (i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].is_primary) {
        v = rows[i][key] || rows[i].value || "";
        if (v) return String(v);
      }
    }
    for (i = 0; i < rows.length; i++) {
      v = rows[i] && (rows[i][key] || rows[i].value || "");
      if (v) return String(v);
    }
    return null;
  }

  /* contactIdOf — the record's id, or null. Accepts `id` or `contact_id` because
     the Contacts REST record carries `id` while a host that has already built a
     reference carries `contact_id`; reading both here is one line, and the
     alternative is every caller remembering which shape it holds. Absent-not-empty:
     a record with no usable id reads as NO REFERENCE, never as the string
     "undefined" written into a signed chain. */
  function contactIdOf(record) {
    var c = record || {};
    var id = c.id != null ? c.id : (c.contact_id != null ? c.contact_id : null);
    if (id == null) return null;
    id = String(id).trim();
    return id.length ? id : null;
  }

  /* contactCanonical — the exact bytes the hash is taken over. UNIT SEPARATOR
     (U+001F) between fields so a name containing the separator cannot shift a
     field boundary — the same delimiter-safety discipline detailEncode carries,
     for the same reason. Absent reads as empty; it does not read as the next
     field. */
  function contactCanonical(record) {
    var c = record || {};
    var name = c.name || c.display_name || c.full_name || "";
    return [String(name),
            String(_primaryOf(c.phones, "phone") || ""),
            String(_primaryOf(c.emails, "email") || "")].join("\u001F");
  }

  /* contactHash — FNV-1a/32, hex, zero-padded to 8.

     SAID PLAINLY SO NOBODY LATER MISTAKES IT FOR SOMETHING IT IS NOT: THIS IS A
     CHANGE DETECTOR, NOT A SECURITY PRIMITIVE. It is not collision-resistant and
     an adversary is not its threat model — the chain's integrity is the ring
     signature's job (ring.js), and this hash rides INSIDE that signed preimage,
     so tampering with it is tampering with the chain. What it buys is the one
     thing Two-Place requires and a bare name string cannot give: the ability to
     tell a snapshot that still matches canonical from one that has diverged.
     Without it a diverged snapshot is indistinguishable from a correct one.

     Non-cryptographic on purpose: this runs in a browser with no require() and
     no SubtleCrypto sync path, and it must be computed at WRITE (intake) and
     recomputed at READ (the glance) from the same function — one place, so the
     two cannot drift. A crypto digest here would be an async API on a pure
     render path, bought at the price of a guarantee nothing needs. */
  function contactHash(record) {
    var s = contactCanonical(record), h = 0x811c9dc5, i;
    for (i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i) & 0xff;
      /* the FNV prime, 16777619, by shift-add — Math.imul is not on every
         target this shell supports and `h * 16777619` overflows into a float. */
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }

  /* contactRef — the reference and the snapshot, read off the order's INTAKE
     entry, from the RAW chain.

     RAW, NOT THE FOLD, and for the identical reason orderView reads intake facts
     raw: a correction's detail carries supersedes/reason/event, so reading the
     reference off a PROJECTED entry would blank the customer of any order whose
     intake was ever corrected. The original entry is never removed (C1), so the
     facts are always there to read. */
  function contactRef(entries) {
    var rows = Array.isArray(entries) ? entries : [], i, f = null;
    for (i = 0; i < rows.length; i++) {
      if (stageForEvent(rows[i].event).id === "intake") { f = detailParse(rows[i].detail); break; }
    }
    if (!f) return null;
    var id = f[CONTACT_ID_KEY] != null && String(f[CONTACT_ID_KEY]).length ? String(f[CONTACT_ID_KEY]) : null;
    return {
      contact_id: id,
      contact_hash: f[CONTACT_HASH_KEY] != null && String(f[CONTACT_HASH_KEY]).length ? String(f[CONTACT_HASH_KEY]) : null,
      // the attested snapshot — what the order was SIGNED for
      snapshot: { customer: f.customer || null, phone: f.phone || null }
    };
  }

  /* contactState — THE JOIN, and it is a read-time join because that is all the
     substrate offers. `/api/contact` and `/api/butcher` are two SQLite stores in
     one process (forest-runtime.js :2061, :2080); nothing enforces a foreign key
     between them, so the discipline has to. THE COST IS NAMED RATHER THAN HIDDEN:
     a `contact_id` can point at a contact that no longer exists, and that is
     exactly why `contact_hash` is not optional and why `unresolved` is a rendered
     state instead of a silent fallback.

     `contact` is the host's already-fetched record, or null. This function never
     fetches. Four states, and every one of them renders SOMETHING true:

       none        no contact_id in the chain (a pre-join order, or an intake the
                   host had no contact for). Not a fault. The snapshot is all
                   there is and it is rendered plainly.
       unresolved  a contact_id the host could not resolve. Render the SNAPSHOT,
                   MARKED — never a blank that looks filled, never a fabricated
                   current name. Same law contacts-email-bridge enforces on a
                   missing address: flag, do not fake.
       diverged    resolved, but canonical has moved since intake. Render BOTH,
                   marked. This is the expected happy path of a customer who
                   changed their number, NOT an error — see the Two-Place note.
       resolved    resolved and the hash still matches. */
  function contactState(order) {
    var o = order || {};
    var ref = contactRef(o.entries);
    if (!ref) return { status: "none", contact_id: null, snapshot: null, current: null, hashAtIntake: null, hashNow: null };
    var base = {
      contact_id: ref.contact_id, snapshot: ref.snapshot,
      hashAtIntake: ref.contact_hash, current: null, hashNow: null
    };
    if (!ref.contact_id) { base.status = "none"; return base; }
    var current = o.contact || null;
    if (!current) { base.status = "unresolved"; return base; }
    base.current = current;
    base.hashNow = contactHash(current);
    base.status = (ref.contact_hash && ref.contact_hash !== base.hashNow) ? "diverged" : "resolved";
    return base;
  }

  /* The one-line human reading of the join, for the glance. Words chosen so no
     state reads as an error the shop has to fix: a diverged snapshot is a
     customer who changed something, and that is ordinary. */
  function contactStateLabel(st) {
    if (!st) return null;
    if (st.status === "unresolved") return "on file at intake \u00B7 no current record found";
    if (st.status === "diverged") return "their record has changed since drop-off";
    return null;   // `none` and `resolved` have nothing extra to say
  }

  /* ======================================================================
     E5b (leg 07) — THE SEASON SUMMARY. A pure fold. It is a function.

     `{post}` 1: no store, no index, no cache, no new route, no new event kind,
     NO NEW PERSISTENCE OF ANY KIND. It takes the set it is given and returns
     numbers. This is the oracle's own shape (`assembleReport(reportType, orders,
     customers, config)`, constellation.js :2818) and it is what the runbook's
     P4 correction makes available for free: the board route already enumerates
     server-side and already ships every order's full `entries`, so the set this
     folds over is already on the wire and already in the browser's hand.

     A STORED SEASON REPORT IS FORBIDDEN. The oracle keeps one (STORE_SNAPSHOT,
     :2789); we derive. A stored total is a second source that can disagree with
     the chain, and this one would disagree about MONEY. If a frozen artifact is
     ever needed it is a Stamp — signed, offline-verifiable, already built.

     THE TENSION THIS LEG WAS BUILT AROUND: THE BOARD IS A WORKLIST AND THIS IS A
     CENSUS, AND THEY DISAGREE ABOUT WHAT TO DROP. `GET /api/butcher/board`
     answers "what needs doing", so it correctly throws things away — an order
     with no standing lane falls off Rick's list, and a phantom row in a cold room
     at 6am is worse than an absence. A census may not drop anything: that order
     exists, it was intaken, it was signed, and a season report that omits it
     under-counts IN THE QUIET DIRECTION. So this fold REUSES THE BOARD'S PAYLOAD
     AND NEVER THE BOARD'S JUDGEMENT — it reads `entries`, does its own reckoning,
     and reaches its own conclusions about what counts. It does not touch the
     board route; Rick's list keeps dropping what has no lane, because that is
     correct for Rick.

     `{post}` 2, THE ITEM MOST LIKELY TO BE GOT WRONG: IT FOLDS FROM `entries`,
     NEVER FROM THE WIRE'S `event` FIELD. That field is the LANE — leg 06 made it
     the last effective LINE entry, skipping every declared non-line event
     (forest-runtime.js :2165). Pounds, payments and refunds are ALL non-line. A
     fold that read `order.event` would see a season with no money and no weight
     in it and report zeros — a wrong answer that looks like a working one.

     TWO WORDS THAT ARE NOT ONE NUMBER. `billedTotalCents` is what the cut sheets
     say (the host's pricing snapshot, the oracle's parity surface).
     `collectedNetCents` is what actually came in, folded from signed payment and
     refund events. A REFUND REDUCES WHAT WAS COLLECTED AND DOES NOT TOUCH WHAT
     WAS BILLED, and it erases neither — leg 06's law, at season scale. Calling
     either one "revenue" alone would be leg 05's fault (one word carrying two
     facts) repeated on money, which is the worst place on this line to repeat it.
     ====================================================================== */

  /* The window anchor: the order's EARLIEST raw entry — when it arrived. Raw and
     earliest on purpose. A correction never moves when the animal was dropped
     off, and the intake entry is never removed, so the opening of an order is a
     permanent fact and the only honest thing to window on. */
  function _openedAt(entries) {
    var rows = Array.isArray(entries) ? entries : [], best = null, i, t;
    for (i = 0; i < rows.length; i++) {
      t = rows[i] && rows[i].timestamp != null ? String(rows[i].timestamp) : null;
      if (!t) continue;
      var n = Date.parse(t);
      if (!isFinite(n)) continue;
      if (best == null || n < best) best = n;
    }
    return best;   // epoch ms, or null when NOTHING on the order carries a readable time
  }
  function _bound(v) {
    if (v == null || String(v).length === 0) return null;
    var n = Date.parse(String(v));
    return isFinite(n) ? n : null;
  }

  /* seasonSummary(orders, window)
     orders: [{ order_id, entries, pricing?, contact? }] — orderView's own input
             shape, so the fold and the glance can never disagree about an order.
     window: { from, to } — ISO instants, BOTH OPTIONAL. Absent means everything.

     THE PARAMETER IS HERE BEFORE THERE IS A CALLER, ON PURPOSE. Today the Record
     holds one season and zero orders, so "the whole store" and "the season" are
     the same set and every number here is accidentally correct. They stop being
     the same set in the first week of the SECOND season, at which point a season
     summary folded over the whole store is silently wrong — quiet direction,
     again. A signature is free to widen before there is a caller and expensive
     after. See the runbook's "What this leg hands leg 08". */
  /* ======================================================================
 THE GROUPING ENUM — ruled (operator, A).

     A SUPPLIED KEY FUNCTION WAS REFUSED. It is one line and infinitely
     extensible, and it moves the grouping decision OUT of the fold and INTO
     the caller — which is exactly how two surfaces start disagreeing about a
     number, and this leg's whole tension is that they must not. The enum is
     cheap to widen; that is the extensibility promise, kept structurally.

     TWO NAMES ARE DELIBERATELY ABSENT AND BOTH ABSENCES ARE FINDINGS:

       `service` was in the runbook's draft five. VALID_SERVICES (porkFat,
       sausage, antlers, skullCapMount, cape, rushProcessing) lives ONLY in
       butcher-pricing.js as a pricing INPUT; intake records a free-text
       field labelled "Cut notes". There is nothing to bucket. Grouping by it
       would paint a claim the chain cannot back (pack §7.2) — the same shape
       as the runbook's own Q3 correction, one name further down.

       `animal` is the grouping this line most wants — a custom game
       processor's first question is deer vs moose vs bear — and it is absent
       for the same reason: BASE_ANIMAL_TYPES is a pricing input and is never
       carried into the signed record. It is one intake field away. It is not
       this leg's field to add, because adding it changes what gets signed.

     Both are recorded here rather than in a handoff, because the next person
     to widen this enum will read this line before they read any handoff. */
  var GROUP_KEYS = ["stage", "week", "month", "customer", "dayOfWeek"];
  var DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function _pad2(n) { return (n < 10 ? "0" : "") + n; }

  /* ISO-8601 week, UTC. Weeks are the shop's real unit — ~40 animals a week
     for 13 weeks — so this is the grouping Rick's rhythm actually lives in. */
  function _isoWeek(ms) {
    var d = new Date(ms);
    var t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    var dayn = (t.getUTCDay() + 6) % 7;              /* Mon=0 */
    t.setUTCDate(t.getUTCDate() - dayn + 3);         /* the Thursday that names the week */
    var year = t.getUTCFullYear();
    var jan4 = new Date(Date.UTC(year, 0, 4));
    var week = 1 + Math.round(((t - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
    return year + "-W" + _pad2(week);
  }

  /* THE BUCKET, AND THE UNPLACEABLE ORDER GETS A NAME RATHER THAN A DROP.
     Leg 07 keeps an undated order and counts it on a named line; a grouping
     that silently dropped it would re-open that hole one level up. Same for a
     customer grouping over an order with no contact_id: `unresolved` is a
     bucket, never an omission. An order the census counts must appear in
     EVERY grouping of that census, or the groups stop summing to the total —
     and two numbers that do not sum is this leg's failure mode. */
  function _groupKeyOf(kind, view, opened) {
    if (kind === "stage") return (view.stage && view.stage.id) ? view.stage.id : "other";
    if (kind === "customer") {
      var st = view.contact;
      return (st && st.contact_id) ? String(st.contact_id) : "unresolved";
    }
    if (opened == null) return "undated";
    if (kind === "month") {
      var d = new Date(opened);
      return d.getUTCFullYear() + "-" + _pad2(d.getUTCMonth() + 1);
    }
    if (kind === "dayOfWeek") return DOW_NAMES[new Date(opened).getUTCDay()];
    if (kind === "week") return _isoWeek(opened);
    return "other";
  }

  /* ======================================================================
     ONE ARITHMETIC PATH, N CONSUMERS.

     `{post}` 1 says neither the panel nor the report may compute a grouping,
     a total or a subtotal of its own. The way to make that TRUE rather than
     ASKED FOR is to have exactly one function that does the adding, and to
     run it over the whole set and over each bucket with the same arguments.
     The byte-identity of the total and the sum of its groups is then a
     property of the construction, not a coincidence a test hopes to catch.

     _accum() makes a register. _addOrder() is the only thing in this file
     that adds. _finish() reads a register out. Three surfaces call the
     result; none of them can reach the arithmetic. */
  function _accum() {
    return {
      ordersByStage: {},
      billedTotalCents: 0, balanceDueTotalCents: 0,
      collectedGrossCents: 0, refundedTotalCents: 0,
      poundsMilliLbs: 0,
      counts: {
        weighed: 0, unweighed: 0, priced: 0, unpriced: 0,
        identified: 0, unidentified: 0, unresolvedContacts: 0, divergedContacts: 0,
        unpaidIntakes: 0, unplaced: 0, undated: 0, terminal: 0
      },
      anomalies: {
        unplaced: [], undated: [], unweighed: [], unpriced: [],
        unresolvedContacts: [], unpaidIntakes: []
      },
      seenContacts: {}, contactCount: 0
    };
  }

  function _addOrder(a, view, id, entries, countUndated) {
    var counts = a.counts, anomalies = a.anomalies;

    if (countUndated) { counts.undated++; if (id) anomalies.undated.push(id); }

    /* THE LANE — computed from the entries, never read off the wire. */
    var laneId = (view.stage && view.stage.id) ? view.stage.id : "other";
    a.ordersByStage[laneId] = (a.ordersByStage[laneId] || 0) + 1;
    if (isTerminalException(laneId)) counts.terminal++;

    /* `{post}` 3 — THE CENSUS COUNTS WHAT THE WORKLIST DROPS. */
    if (!view.entries.length || !foldCorrections(entries).effective.length) {
      counts.unplaced++;
      if (id) anomalies.unplaced.push(id);
    }

    /* `{post}` 6 — POUNDS FOLD FREE AND NULL IS A REAL ANSWER. */
    var hw = view.hangingWeight;
    if (hw && hw.milliLbs != null) { a.poundsMilliLbs += hw.milliLbs; counts.weighed++; }
    else { counts.unweighed++; if (id) anomalies.unweighed.push(id); }

    /* `{post}` 5 — INTEGER CENTS THE WHOLE WAY UP. */
    var pr = view.pricing;
    if (pr && pr.totalCents != null) {
      a.billedTotalCents += pr.totalCents;
      if (pr.balanceDueCents != null) a.balanceDueTotalCents += pr.balanceDueCents;
      counts.priced++;
    } else {
      counts.unpriced++; if (id) anomalies.unpriced.push(id);
    }

    var money = view.money;
    a.collectedGrossCents += money.paidCents;
    a.refundedTotalCents += money.refundedCents;
    if (money.unpaidIntake) { counts.unpaidIntakes++; if (id) anomalies.unpaidIntakes.push(id); }

    /* `totalCustomers` — DISTINCT CONTACTS REFERENCED, and a FLOOR when any
       order is unidentified or unresolved. Never dressed as a headcount. */
    var st = view.contact;
    if (st && st.contact_id) {
      counts.identified++;
      if (!Object.prototype.hasOwnProperty.call(a.seenContacts, st.contact_id)) {
        a.seenContacts[st.contact_id] = true; a.contactCount++;
      }
      if (st.status === "unresolved") { counts.unresolvedContacts++; if (id) anomalies.unresolvedContacts.push(id); }
      if (st.status === "diverged") counts.divergedContacts++;
    } else {
      counts.unidentified++;
    }
  }

  function _finish(a) {
    var totalOrders = 0, k;
    for (k in a.ordersByStage) {
      if (Object.prototype.hasOwnProperty.call(a.ordersByStage, k)) totalOrders += a.ordersByStage[k];
    }

    /* `{post}` 7 — A TOTAL THAT CANNOT BE COMPLETE SAYS SO. Never a false
       green. Every group carries its OWN floors: a season can be complete
       while one week inside it is not, and a per-group figure that inherited
       the season's clean flag would be a confident wrong number in the one
       place a human is most likely to read it. */
    var floors = {
      pounds: a.counts.unweighed > 0,
      billed: a.counts.unpriced > 0,
      balance: a.counts.unpriced > 0,
      customers: a.counts.unidentified > 0 || a.counts.unresolvedContacts > 0
    };

    return {
      totalOrders: totalOrders,
      totalCustomers: a.contactCount,
      ordersByStage: a.ordersByStage,
      billedTotalCents: a.billedTotalCents,
      balanceDueTotalCents: a.balanceDueTotalCents,
      collectedGrossCents: a.collectedGrossCents,
      refundedTotalCents: a.refundedTotalCents,
      collectedNetCents: a.collectedGrossCents - a.refundedTotalCents,
      poundsMilliLbs: a.poundsMilliLbs,
      poundsLbs: fromMilliLbs(a.poundsMilliLbs),
      counts: a.counts,
      floors: floors,
      anomalies: a.anomalies
    };
  }

  /* ======================================================================
     summaryLines(summary) — THE ONE CROSSING TO DISPLAY UNITS.

     This is the joint the three surfaces share, and it exists because of the
     one failure this leg was warned about by name: the glance is the smallest
     surface, so it is the one most likely to render a floored number as a
     bare confident figure. `{post}` 4 asks a renderer to remember. A renderer
     that has to remember will eventually forget, and it will forget silently,
     which is the only way this line has ever been hurt.

     So the floor is not a flag a surface may consult — it is baked into the
     STRING before any surface sees it. There is no way to reach the number
     without reaching the mark, because the number is not exported separately.

     `{post}` 6: money crosses through formatDollars and pounds through
     fromMilliLbs EXACTLY here, once, and nothing downstream does arithmetic.

     Returns [{ id, label, value, floored, note }] — display-ready, in a fixed
     order, so three surfaces that render the same summary render the same
     words. A surface chooses WHICH lines to show (the glance shows few); it
     never chooses what a line SAYS. */
  function summaryLines(summary) {
    var s = summary || {}, f = s.floors || {}, c = s.counts || {};
    function mark(text, floored, why) {
      if (text == null) return { text: "\u2014", floored: false, note: null };
      return floored
        ? { text: "at least " + text, floored: true, note: why }
        : { text: text, floored: false, note: null };
    }
    var money = function (cents, floored, why) {
      return mark(formatDollars(cents), !!floored, why);
    };
    var rows = [
      { id: "orders",    label: "Orders",        m: mark(String(s.totalOrders == null ? 0 : s.totalOrders), false, null) },
      { id: "customers", label: "Customers",     m: mark(String(s.totalCustomers == null ? 0 : s.totalCustomers), !!f.customers,
                                                    (c.unidentified || 0) + " with no contact on file") },
      { id: "pounds",    label: "Hanging weight", m: mark(s.poundsLbs == null ? null : s.poundsLbs + " lb", !!f.pounds,
                                                    (c.unweighed || 0) + " not yet weighed") },
      { id: "billed",    label: "Billed",        m: money(s.billedTotalCents, f.billed, (c.unpriced || 0) + " not yet priced") },
      { id: "collected", label: "Collected",     m: money(s.collectedNetCents, false, null) },
      { id: "balance",   label: "Balance due",   m: money(s.balanceDueTotalCents, f.balance, (c.unpriced || 0) + " not yet priced") }
    ];
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      out.push({ id: rows[i].id, label: rows[i].label, value: rows[i].m.text,
                 floored: rows[i].m.floored, note: rows[i].m.note });
    }
    return out;
  }

  /* anomalyLines(summary) — the six lines, in the gold/quiet weather idiom
     (pack §7.1). Named with the next action, never red, never a badge count.
     A zero-count anomaly returns NOTHING: a paid order carries no chip, and
     that asymmetry is the law (leg 06). An order that has fallen off the list
     must be MORE visible here than one that is on it. */
  var ANOMALY_SPEC = [
    { id: "unplaced",          label: "not on the board",     action: "open and give it a stage" },
    { id: "undated",           label: "no readable date",     action: "counted anyway \u2014 check the drop-off" },
    { id: "unweighed",         label: "not weighed",          action: "weigh to complete the pounds" },
    { id: "unpriced",          label: "not priced",           action: "price to complete the money" },
    { id: "unresolvedContacts", label: "customer not matched", action: "match in Contacts" },
    { id: "unpaidIntakes",     label: "intake unpaid",        action: "take payment" }
  ];
  function anomalyLines(summary) {
    var s = summary || {}, a = s.anomalies || {}, out = [];
    for (var i = 0; i < ANOMALY_SPEC.length; i++) {
      var spec = ANOMALY_SPEC[i], ids = a[spec.id];
      if (!Array.isArray(ids) || !ids.length) continue;
      out.push({ id: spec.id, count: ids.length, label: spec.label,
                 action: spec.action, orders: ids.slice() });
    }
    return out;
  }

  /* seasonSummary(orders, window, groupBy)
     orders:  [{ order_id, entries, pricing?, contact? }] — orderView's own
              input shape, so the fold and the glance can never disagree.
     window:  { from, to } — ISO instants, BOTH OPTIONAL. Absent means all.
     groupBy: one of GROUP_KEYS, or null/absent. An UNKNOWN key is a LOUD
              refusal (`groupBy: null` + a named anomaly) rather than a silent
              ungrouped answer, because a panel that asked for a grouping and
              silently got the total back is a wrong answer that looks right.

     THE THIRD PARAMETER IS APPENDED. Every existing caller passes two
     arguments and gets a byte-identical object with two keys added
     (`groupBy: null`, `groups: null`) — asserted in the suite, not assumed. */
  function seasonSummary(orders, window, groupBy) {
    var rows = Array.isArray(orders) ? orders : [];
    var w = window || {};
    var from = _bound(w.from), to = _bound(w.to);

    var kind = (groupBy == null || groupBy === "") ? null : String(groupBy);
    var badGroup = (kind != null && GROUP_KEYS.indexOf(kind) === -1) ? kind : null;
    if (badGroup) kind = null;

    var total = _accum();
    var buckets = {}, order2 = [];

    for (var i = 0; i < rows.length; i++) {
      var order = rows[i] || {};
      var entries = Array.isArray(order.entries) ? order.entries : [];
      var id = order.order_id != null ? String(order.order_id)
             : (entries.length && entries[0].order_id != null ? String(entries[0].order_id) : null);

      /* THE WINDOW, AND THE FAILURE DIRECTION IS CHOSEN OUT LOUD. An order
         whose every timestamp is unreadable cannot be PROVED in-window — so
         with an explicit window it is KEPT and counted as `undated`, never
         dropped. Dropping under-counts in the quiet direction, the exact
         failure this leg exists to refuse; keeping over-counts LOUDLY. */
      var opened = _openedAt(entries);
      var countUndated = false;
      if (opened == null) {
        if (from != null || to != null) countUndated = true;
      } else {
        if (from != null && opened < from) continue;
        if (to != null && opened > to) continue;
      }

      var view = orderView({
        order_id: id, entries: entries,
        pricing: order.pricing || null, contact: order.contact || null
      });

      _addOrder(total, view, id, entries, countUndated);

      if (kind) {
        var gk = _groupKeyOf(kind, view, opened);
        if (!Object.prototype.hasOwnProperty.call(buckets, gk)) {
          buckets[gk] = _accum(); order2.push(gk);
        }
        _addOrder(buckets[gk], view, id, entries, countUndated);
      }
    }

    var out = _finish(total);
    out.window = { from: w.from == null ? null : String(w.from), to: w.to == null ? null : String(w.to) };
    out.groupBy = kind;
    out.groups = null;
    out.groupOrder = null;

    if (kind) {
      var groups = {};
      for (var j = 0; j < order2.length; j++) groups[order2[j]] = _finish(buckets[order2[j]]);
      out.groups = groups;
      out.groupOrder = order2.slice();
    }
    if (badGroup) out.anomalies.unknownGroupBy = badGroup;

    return out;
  }

  /* ======================================================================
     SURFACES 4-6 — THE THREE SEASON RENDERERS.  `{post}` 1, 4, 6, 7, 8.

       renderSeasonGlance(doc, summary, opts)     the strip on the order list
       renderSeasonDashboard(doc, summary, opts)  the owner's own screen
       renderSeasonReport(doc, summary, opts)     the printed/exported artifact

     THEY ARE CALLERS. Every number any of them shows comes out of
     `summaryLines(summary)` / `anomalyLines(summary)` already formatted, already
     floored, already in display units. There is no arithmetic below this comment
     and no second path to a raw cent — `{post}` 6 is true because the operations
     are ABSENT, not because three renderers each remembered to behave.

     WHY ONE PAINTER AND NOT THREE. `{post}` 1 requires the surfaces to be
     byte-identical about a number. Three painters that agree today are three
     painters that can drift tomorrow, and the drift would be silent and in the
     money. `_lineEl` is the ONLY thing in this file that turns a summary line
     into DOM; all three surfaces call it. Byte-identity is then a property of
     there being one function, which is why the test for it is cheap.

     WHAT A SURFACE MAY DECIDE: which lines to show, and how to frame them.
     WHAT A SURFACE MAY NOT DECIDE: what a line says. (summaryLines' own rule,
     enforced here by giving a surface no way to reach the words.)
     ====================================================================== */

  /* THE GLANCE'S SUBSET — three lines, and the choice is Rick's rhythm rather
     than a truncation: how many are in, how much weight is hanging, how much
     money is still out. Money-in (`collected`) is deliberately NOT here: the
     glance sits on the worklist, and the worklist question is what is still
     owed, not what was banked. The full set is one click away on the dashboard.

     A subset is a display choice and is legal. Re-WORDING a line is not, and
     there is no way to do it from here. */
  var GLANCE_LINE_IDS = ["orders", "pounds", "balance"];

  /* _lineEl — the one crossing from a summary line to DOM, for all three.
     `line.value` ALREADY carries the floor mark ("at least $120.00"), so there
     is nothing here to remember and nothing to forget: this function cannot
     paint a bare number because it is never handed one. `line.note` explains a
     floor when there is one and rides the title/accessible name, where a long
     string costs no layout. */
  function _lineEl(doc, line) {
    var ln = el(doc, "div", "line" + (line.value ? "" : " line--empty"),
      { "data-line": line.id });
    if (line.floored) ln.setAttribute("data-floored", "1");
    if (line.note) ln.setAttribute("title", line.note);
    ln.appendChild(el(doc, "span", "line__label", { text: line.label }));
    ln.appendChild(el(doc, "span", "line__value", { text: line.value || "\u2014" }));
    return ln;
  }

  /* _linesInto — paint a whole (optionally filtered) line set. `only` is a list
     of ids or null for all. Order is summaryLines' order, never the caller's. */
  function _linesInto(doc, host, summary, only) {
    var lines = summaryLines(summary);
    for (var i = 0; i < lines.length; i++) {
      if (only && only.indexOf(lines[i].id) === -1) continue;
      host.appendChild(_lineEl(doc, lines[i]));
    }
    return host;
  }

  /* _anomaliesInto — `{post}` 5. The gold/quiet idiom: named with the next
     action, never red, never a bare badge count. A clean season appends
     NOTHING (anomalyLines returns []), which is the asymmetry leg 06 made law:
     a quiet dimension emits nothing rather than a zero. */
  function _anomaliesInto(doc, host, summary) {
    var rows = anomalyLines(summary);
    if (!rows.length) return null;
    var wrap = el(doc, "div", "view__list", { "data-region": "season-anomalies" });
    wrap.appendChild(el(doc, "div", "view__region-label", { text: "Needs a hand" }));
    for (var i = 0; i < rows.length; i++) {
      var a = rows[i];
      var row = el(doc, "div", "row", { "data-anomaly": a.id });
      var body = el(doc, "div", "row__body");
      body.appendChild(el(doc, "div", "row__title",
        { text: a.count + " " + a.label }));
      body.appendChild(el(doc, "div", "row__meta", { text: a.action }));
      row.appendChild(body);
      wrap.appendChild(row);
    }
    host.appendChild(wrap);
    return wrap;
  }

  /* _groupsInto — one .row per bucket, each carrying that bucket's OWN lines.
     A group's numbers come from `summary.groups[key]` run through the same
     summaryLines, so a bucket is floored on its own evidence: a season can be
     complete while one week inside it is not, and a group that inherited the
     season's clean flag would be a confident wrong number exactly where a human
     reads it. `groupOrder` is the fold's order — first-seen, never re-sorted
     here, because a renderer that re-sorts is a renderer that has an opinion
     about the data. */
  function _groupsInto(doc, host, summary, only) {
    if (!summary || !summary.groupBy || !summary.groups) return null;
    var order = Array.isArray(summary.groupOrder) ? summary.groupOrder : [];
    var wrap = el(doc, "div", "view__list", { "data-region": "season-groups" });
    wrap.appendChild(el(doc, "div", "view__region-label",
      { text: "By " + summary.groupBy }));
    for (var i = 0; i < order.length; i++) {
      var key = order[i], g = summary.groups[key];
      if (!g) continue;
      var row = el(doc, "div", "row", { "data-group": key });
      var body = el(doc, "div", "row__body");
      body.appendChild(el(doc, "div", "row__title", { text: key }));
      _linesInto(doc, body, g, only || null);
      row.appendChild(body);
      wrap.appendChild(row);
    }
    host.appendChild(wrap);
    return wrap;
  }

  /* THE WINDOW, SAID OUT LOUD — `{post}` 7. "Everything" is a real and correct
     answer today (one season, zero orders) and it is stated rather than left
     blank, because a blank window on an artifact reads as an oversight and an
     oversight is what a dispute attacks. */
  function _windowText(summary) {
    var w = (summary && summary.window) || {};
    if (w.from == null && w.to == null) return "All orders on file";
    return "From " + (w.from == null ? "the beginning" : String(w.from)) +
           " to " + (w.to == null ? "now" : String(w.to));
  }

  /* SURFACE 4 — the glance. Smallest surface, therefore the one `{post}` 4 was
     written about. It shows three lines and it cannot say them differently. */
  function renderSeasonGlance(doc, summary, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    opts = opts || {};
    var pane = el(doc, "section", "pane pane--live", { "data-kind": "butcher-season-glance" });
    pane.appendChild(el(doc, "h2", "pane__title", { text: opts.title || "This season" }));
    var region = el(doc, "div", "view__detail", { "data-region": "season-lines" });
    _linesInto(doc, region, summary, GLANCE_LINE_IDS);
    pane.appendChild(region);
    /* The glance does not paint anomalies as rows — it says HOW MANY need a hand
       and hands off. Saying nothing when there are none is the same law as
       anomalyLines'; saying "0 need a hand" would be a badge count, refused. */
    var an = anomalyLines(summary);
    if (an.length) {
      /* DISTINCT ORDERS, not the sum of buckets. An order can trip several
         anomalies at once (unverified AND no-deposit AND aging), and summing
         `count` across the spec made five orders read as "14 orders need a
         hand" directly under "ORDERS 5" — the surface contradicting itself on
         the same card. Parent §5 addition 3: never paint a claim the chain
         cannot back. The chain backs "these order ids need a hand"; it does
         not back a count larger than the season. */
      var seen = {}, n = 0;
      for (var i = 0; i < an.length; i++) {
        var ids = Array.isArray(an[i].orders) ? an[i].orders : [];
        for (var j = 0; j < ids.length; j++) {
          var key = String(ids[j]);
          if (!Object.prototype.hasOwnProperty.call(seen, key)) { seen[key] = 1; n++; }
        }
      }
      if (!n) return pane;
      var more = el(doc, "p", "pane__census",
        { text: n + (n === 1 ? " order needs" : " orders need") + " a hand" });
      if (typeof opts.onOpen === "function" && more.addEventListener) {
        more.setAttribute("data-act", "season-open");
        more.addEventListener("click", function () { opts.onOpen(); });
      }
      pane.appendChild(more);
    }
    return pane;
  }

  /* SURFACE 5 — the owner's dashboard (pack §142: Rick AND Christine). The full
     line set, the anomalies as rows, and the grouping when one was asked for. */
  function renderSeasonDashboard(doc, summary, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    opts = opts || {};
    var pane = el(doc, "section", "pane pane--live", { "data-kind": "butcher-season-dashboard" });
    pane.appendChild(el(doc, "h2", "pane__title", { text: opts.title || "Season" }));
    pane.appendChild(el(doc, "p", "pane__census", { text: _windowText(summary) }));
    var region = el(doc, "div", "view__detail", { "data-region": "season-lines" });
    _linesInto(doc, region, summary, null);
    pane.appendChild(region);
    _anomaliesInto(doc, pane, summary);
    _groupsInto(doc, pane, summary, null);
    return pane;
  }

  /* SURFACE 6 — the printed report. Same numbers, framed as an artifact: it
     carries its own window and its own generated-at stamp, because a number
     that leaves the building without a referent is a number someone will later
     read as covering whatever they wish it covered.

     It is a RECORD block, not a pane — the Block alphabet's artifact shape —
     so it prints and detaches like the other Forest records. Zero marginal CSS.

     `{post}` 2/3: it computes nothing, stores nothing, writes nothing. There is
     no snapshot here and `snapshot_on_demand` stays REFUSED, one leg after leg
     07 refused it and in the first place where refusing it actually costs
     something: a frozen artifact is a Stamp (signed, offline-verifiable) and
     generalising the Stamp from one order to a window is leg 09's gated work. */
  function renderSeasonReport(doc, summary, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    opts = opts || {};
    var rec = el(doc, "article", "record", { "data-kind": "butcher-season-report" });
    var head = el(doc, "div", "record__head");
    head.appendChild(el(doc, "h2", "record__title", { text: opts.title || "Season report" }));
    /* The window rides the artifact, not the request that produced it. */
    head.appendChild(el(doc, "div", "record__meta", { text: _windowText(summary) }));
    if (opts.generatedAt) {
      head.appendChild(el(doc, "div", "record__meta",
        { text: "Prepared " + String(opts.generatedAt) }));
    }
    rec.appendChild(head);
    var body = el(doc, "div", "record__body");
    var region = el(doc, "div", "view__detail", { "data-region": "season-lines" });
    _linesInto(doc, region, summary, null);
    body.appendChild(region);
    _anomaliesInto(doc, body, summary);
    _groupsInto(doc, body, summary, null);
    rec.appendChild(body);
    return rec;
  }

  /* ======================================================================
     THE OPENING — screens 1 and 2 (O-4). Two more PURE surfaces, same contract
     as the three above: they draw, they hand acts back through callbacks, they
     perform no I/O and hold no state beyond the node they return.

     WHY THE PLACE CONFIRM LIVES ON THE SIGN AND NOT INSIDE THE OPENING.
     The design (the-opening-spin-up-design-v1 §3) drew place as the third beat
     of screen 2. The O-2 contract makes that unbuildable HONESTLY: the Opening
     is ONE signed append, `place` rides inside it, and a second POST reports
     already_open and writes nothing — so a place answered after the write can
     never reach the record. The only way to keep place on screen 2 would be to
     paint "your book is open" and "here is your mark" BEFORE they were true and
     write afterwards, which is a spinner that lies — the exact thing §4 says
     this screen exists not to be. So the tap moves to the Sign (where §2's own
     table already puts it: place is PROPOSED and confirmed by tap, costing zero
     questions) and screen 2 stays what it was designed to be: a reveal of three
     facts that are ALL TRUE by the time they are shown.
     ====================================================================== */

  /* markInto(doc, node, svg) — paint a SERVED Shop Mark.

     THE MARK IS RENDERED, NEVER RE-DERIVED. forest/butcher/shop-mark.js is Node
     CommonJS with no script tag and no bundler; a served second copy is standing
     law 4, so the runtime strikes the mark and ships the PICTURE. This function
     is the whole browser-side surface area of that decision.

     The two guards are NOT distrust of shop-mark.js (which emits no script, href
     or id, asserted M1-M9). They are the pane refusing to be a general-purpose
     markup sink: whatever arrives, only a bare <svg> root with nothing active in
     it is ever put into the document. A refusal is not an outage — the caller
     falls back to the fingerprint, and the shop is open either way. */
  function markInto(doc, node, svg) {
    var s = typeof svg === "string" ? svg.trim() : "";
    if (!/^<svg[\s>]/i.test(s)) return false;                 // a bare <svg …> root, or nothing
    if (/<script|<foreignObject|javascript:|\son\w+\s*=/i.test(s)) return false;  // nothing active, ever
    try { node.innerHTML = s; return true; } catch (e) { return false; }
  }

  /* ======================================================================
     SURFACE 4 — renderSign(doc, opts)   ·   THE OPENING, screen 1

     One field. The words BECOME the sign as you type — the input is not a form
     control that later produces an artifact, it IS the artifact, which is what
     makes the provenance line ("this name goes on every record you make") felt
     at the moment it becomes true rather than read as a disclaimer.

     opts.placeProposal — {lat, lon, label} the BOX says it is at, or absent.
       Absent is the ordinary case today and it SELF-SKIPS with an honest line
       (chaos row 3). There is no browser-geolocation fallback here and none is
       coming from this surface: a phone's coordinate is the butcher's location,
       not the shop's, and signing it as the shop's place is the "somebody else's
       weather on a real order" fault the no-default-coordinate law exists for.
     opts.onOpen(payload) — {name} or {name, place}. Called ONCE per tap.

     Chaos row 2 lives here: a blank or whitespace sign leaves the control
     disabled, so no placeholder shop name can be minted from this pane at all.
     ====================================================================== */
  /* ======================================================================
     SEASONS ARCHIVE — the sixth (and last) rail stub-fill (leg 27).

     seasonsPresent(orders) — a PURE fold, the archive's twin of seasonSummary.
       Partitions orders-in-hand by SEASON (= the calendar year the order opened
       in; for a deer shop a season's orders all fall inside one year, so year is
       the honest grain). Returns { seasons:[{season,from,to,count}] newest-first,
       undated }. An order with no readable timestamp is UNDATED — KEPT and
       counted honestly, never silently dropped (the seasonSummary undated rule).

       BOX-INDEPENDENCE (honest, named): this folds only the seasons ALREADY IN
       the loaded record. It does NOT reach back into the deployed box's history
       for arbitrary past seasons — that read is db-bound, the deploy arc, and the
       surface says so rather than faking a browsable full history.
     ====================================================================== */
  function seasonsPresent(orders) {
    var rows = Array.isArray(orders) ? orders : [];
    var buckets = {}, undated = 0;
    for (var i = 0; i < rows.length; i++) {
      var o = rows[i] || {};
      var opened = _openedAt(Array.isArray(o.entries) ? o.entries : []);
      if (opened == null) { undated++; continue; }
      var year = new Date(opened).getUTCFullYear();
      buckets[year] = (buckets[year] || 0) + 1;
    }
    var years = Object.keys(buckets).map(Number).sort(function (a, b) { return b - a; });
    var seasons = years.map(function (y) {
      return { season: y,
               from: y + "-01-01T00:00:00.000Z",
               to:   y + "-12-31T23:59:59.999Z",
               count: buckets[y] };
    });
    return { seasons: seasons, undated: undated };
  }

  /* renderSeasonsArchive(doc, orders, opts) — the picker. Lists the seasons the
     archive can show and hands a picked season's {season,from,to,fromBox} back
     through opts.onPick; the host re-runs the season dashboard windowed to it.

     TWO sources, merged by year (newest-first):
       - the LOADED record (seasonsPresent(orders)) — a loaded row is re-run over
         the orders in hand, no fetch (fromBox:false).
       - the BOX's full season LIST (opts.boxSeasons from GET /api/butcher/seasons)
         — a box-only year the browser never loaded is offered as a FETCH row
         (fromBox:true); the host pulls GET /board?season=YYYY on pick.
     When opts.boxSeasons is absent (pre-deploy, or the box was unreachable) the
     picker shows only the record in hand and keeps the honest wall — older history
     lives in the deployed box and the surface says so rather than faking a browse.
     PURE + no I/O (the host owns every fetch). Cold-safe: absent doc -> null;
     nothing to show -> an honest empty pane. */
  function renderSeasonsArchive(doc, orders, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    opts = opts || {};
    var fold = seasonsPresent(orders);
    var box = Array.isArray(opts.boxSeasons) ? opts.boxSeasons : null;

    // Merge loaded + box by year. Loaded wins the row (it re-runs without a fetch);
    // a box year not already loaded joins as a fetch row.
    var byYear = {};
    fold.seasons.forEach(function (s) {
      byYear[s.season] = { season: s.season, from: s.from, to: s.to, count: s.count, loaded: true };
    });
    if (box) {
      box.forEach(function (s) {
        var y = Number(s && s.season);
        if (!y || byYear[y]) return;   // bad row, or already loaded -> keep the loaded row
        byYear[y] = { season: y, from: s.from, to: s.to, count: (s && s.count) || 0, loaded: false };
      });
    }
    var seasons = Object.keys(byYear).map(function (k) { return byYear[k]; })
      .sort(function (a, b) { return b.season - a.season; });

    var pane = el(doc, "section", "pane pane--live", { "data-kind": "butcher-seasons-archive" });
    pane.appendChild(el(doc, "h2", "pane__title", { text: "Seasons archive" }));

    if (!seasons.length && !fold.undated) {
      pane.appendChild(el(doc, "p", "pane__lede",
        { text: "No dated orders in the record yet \u2014 nothing to archive." }));
      return pane;
    }

    pane.appendChild(el(doc, "p", "pane__lede",
      { text: box
          ? "Pick a season to re-run this season's dashboard against it. Seasons from the box are pulled on demand."
          : "Pick a season to re-run this season's dashboard against it. Only seasons already in the loaded record appear here." }));

    var list = el(doc, "div", "view__detail", { "data-region": "seasons-list" });
    seasons.forEach(function (s) {
      var label = s.season + "  \u00B7  " + s.count + (s.count === 1 ? " order" : " orders");
      if (!s.loaded) label += "  \u00B7  from the box";
      var row = el(doc, "div", "line line--clickable",
        { role: "button", tabindex: "0", "data-act": "pick-season",
          "data-season": String(s.season),
          "data-source": s.loaded ? "loaded" : "box",
          text: label });
      function pick() {
        if (typeof opts.onPick === "function") {
          opts.onPick({ season: s.season, from: s.from, to: s.to, fromBox: !s.loaded });
        }
      }
      if (row.addEventListener) {
        row.addEventListener("click", pick);
        row.addEventListener("keydown", function (ev) {
          var k = ev && ev.key;
          if (k === "Enter" || k === " " || k === "Spacebar") {
            if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
            pick();
          }
        });
      }
      list.appendChild(row);
    });
    pane.appendChild(list);

    if (fold.undated) {
      pane.appendChild(el(doc, "p", "line line--muted",
        { text: fold.undated + " order" + (fold.undated === 1 ? "" : "s") +
                " with no readable date \u2014 kept in the record, not assigned to a season." }));
    }

    if (!box) {
      /* The deploy-arc, stated honestly (the export-wall's sibling): older seasons
         that never loaded into this record live in the deployed box's history. Kept
         only when no box list is in hand — once we have it, those seasons ARE offered. */
      pane.appendChild(el(doc, "p", "line line--muted",
        { text: "Seasons that aren't in the loaded record need the deployed box \u2014 that history isn't reachable from the browser yet." }));
    }

    return pane;
  }

  function renderSign(doc, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    opts = opts || {};
    var proposal = opts.placeProposal || null;

    var pane = el(doc, "section", "pane pane--live", { "data-kind": "butcher-sign" });

    // The sign face. Its text tracks the input; before anything is typed it shows
    // the hint, and the hint is NEVER a submittable name (the guard is on val()).
    var face = el(doc, "div", "record record--sign", { "data-region": "sign-face" });
    var faceText = el(doc, "span", "record__title", { text: "Your shop's name" });
    face.appendChild(faceText);
    pane.appendChild(face);

    var input = el(doc, "input", "field__control",
      { type: "text", placeholder: "e.g. Deer Hill Butchery", "data-input": "shop-name" });
    pane.appendChild(input);

    pane.appendChild(el(doc, "p", "line line--muted",
      { text: "This name goes on every record you make." }));

    /* The place strip. Three states, and only one of them writes a coordinate:
         proposed + affirmed  -> place rides in the payload
         proposed + declined  -> no place; the honest cost is stated
         no proposal          -> self-skip; the honest cost is stated
       Un-affirmed is the DEFAULT and it behaves exactly like declined. Place is
       never carried by silence. */
    var placeAffirmed = false;
    var placeStrip = el(doc, "div", "view__list", { "data-region": "sign-place" });
    var placeLine = el(doc, "p", "line", { text: "" });
    placeStrip.appendChild(placeLine);

    function placeSay(t) { placeLine.textContent = t; }

    if (proposal && proposal.label) {
      placeSay("Looks like you're at " + proposal.label + " — right?");
      var yes = el(doc, "button", "pane__connect",
        { type: "button", "data-act": "place-affirm", text: "Yes, that's the shop" });
      var no = el(doc, "button", "pane__connect",
        { type: "button", "data-act": "place-decline", text: "Somewhere else" });
      function affirm() {
        placeAffirmed = true;
        placeSay("Place set: " + proposal.label + ".");
        yes.disabled = true; no.disabled = true;
      }
      function decline() {
        placeAffirmed = false;
        placeSay("No place set. Your records won't carry a weather line — that's fine.");
        yes.disabled = true; no.disabled = true;
      }
      if (yes.addEventListener) yes.addEventListener("click", affirm);
      if (no.addEventListener) no.addEventListener("click", decline);
      placeStrip.appendChild(yes);
      placeStrip.appendChild(no);
      pane._affirmPlace = affirm;
      pane._declinePlace = decline;
    } else {
      // Chaos row 3, and the ONLY honest answer available today: this box does not
      // publish where it is. No coordinate is invented to fill the hole.
      placeSay("This box doesn't know where it is, so no place is set. Your records won't carry a weather line.");
    }
    pane.appendChild(placeStrip);

    var submit = el(doc, "button", "pane__connect",
      { type: "button", "data-act": "shop-open", text: "Open the shop" });
    submit.disabled = true;
    pane.appendChild(submit);

    function val() { return input && input.value != null ? String(input.value).trim() : ""; }
    function refresh() {
      var n = val();
      submit.disabled = !n;
      faceText.textContent = n || "Your shop's name";
    }
    if (input && input.addEventListener) input.addEventListener("input", refresh);

    var fired = false;
    function openShop() {
      var name = val();
      if (!name) return null;                      // chaos row 2: a blank sign is not a shop
      if (fired) return null;                      // one Opening per tap-through, never a double-post
      fired = true;
      submit.disabled = true;
      var payload = { name: name };
      if (placeAffirmed && proposal) {
        payload.place = { lat: proposal.lat, lon: proposal.lon, label: proposal.label };
      }
      if (typeof opts.onOpen === "function") opts.onOpen(payload);
      return payload;
    }
    if (submit.addEventListener) submit.addEventListener("click", openShop);

    // host/test drive without synthesising DOM events (the renderIntake precedent)
    pane._submit = openShop;
    pane._refresh = refresh;
    pane._fields = { name: input };
    pane._rearm = function () { fired = false; refresh(); };
    return pane;
  }

  /* ======================================================================
     SURFACE 4b — renderPlaceAffirm(doc, shop, opts)   ·   seq156 / seq1000

     The place-affirm affordance for an ALREADY-OPEN, place-LESS shop. A shop
     that opened with the place declined is weather-dark; this is the control
     that lets it become weather-capable later, POSTing a SIGNED SHOP_PLACE_SET
 through the host (the api.place verb). The server half landed ; this
     is the shell affordance the owed brick named.

     THE ASYMMETRY IS THE LAW: a shop that ALREADY carries a place shows NOTHING
     from here (return null). Only the place-less open shop gets the control —
     never a "change your place" surface, which would invite churn on a signed,
     weather-bearing identity for no reason the operator asked for.

     TWO PATHS, one interaction model (mirrors renderSign._affirmPlace):
       proposal present -> affirm it (Yes / Not now), the renderSign model.
       no proposal      -> the OWNER enters the shop's real coordinates. This is
                           NOT the no-invent fault: the owner affirming true
                           coordinates is exactly the affirmation the record
                           needs; the fault the no-default law guards is a
                           coordinate NOBODY chose (env/geo/box), signed as the
                           shop's. Client-side the coord passes the SAME gate the
                           server applies (finite + earth-bounds) before it can be
                           sent, so a malformed entry never leaves the glass.
     A place-less shop is a VALID state, so "Not now" always leaves for the board
     (opts.onSkip); this is an affordance, never a gate.
     ====================================================================== */
  function renderPlaceAffirm(doc, shop, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    shop = shop || {};
    opts = opts || {};

    // The asymmetry: a placed shop shows nothing.
    if (shop.place && isFinite(Number(shop.place.lat)) && isFinite(Number(shop.place.lon))) return null;

    // The one gate a coordinate passes to be usable — the client mirror of the
    // server's placeFromCoords (finite + earth-bounds). An unusable coord is
    // ABSENT here exactly as it is there; the button never arms on one.
    function usable(lat, lon) {
      lat = Number(lat); lon = Number(lon);
      return isFinite(lat) && isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
    }

    var pane = el(doc, "section", "pane pane--live", { "data-kind": "butcher-place-affirm" });
    var card = el(doc, "div", "record record--sign", { "data-region": "place-affirm" });
    card.appendChild(el(doc, "span", "record__title", { text: "Set your shop's place" }));
    card.appendChild(el(doc, "p", "line line--muted",
      { text: (shop.name ? shop.name : "This shop") +
          " has no place set, so its records don't carry a weather line yet. Set it once and every new order records the weather at intake." }));

    var status = el(doc, "p", "line", { text: "" });
    function say(t) { status.textContent = t; }
    function fire(place) { if (typeof opts.onAffirm === "function") opts.onAffirm(place); }

    var proposal = opts.placeProposal || null;
    if (proposal && proposal.label && usable(proposal.lat, proposal.lon)) {
      say("Looks like you're at " + proposal.label + " — set it as the shop's place?");
      var yes = el(doc, "button", "pane__connect", { type: "button", "data-act": "place-affirm", text: "Yes, set it" });
      var done = false;
      function affirm() {
        if (done) return; done = true; yes.disabled = true;
        say("Place set: " + proposal.label + ".");
        fire({ lat: Number(proposal.lat), lon: Number(proposal.lon), label: proposal.label });
      }
      if (yes.addEventListener) yes.addEventListener("click", affirm);
      card.appendChild(status);
      card.appendChild(yes);
      pane._affirm = affirm;
      pane._proposal = proposal;
    } else {
      var labelIn = el(doc, "input", "field__control", { type: "text", placeholder: "Place name (e.g. Deer Hill)", "data-input": "place-label", "aria-label": "Place name" });
      var latIn   = el(doc, "input", "field__control", { type: "text", placeholder: "Latitude",  "data-input": "place-lat", "aria-label": "Latitude" });
      var lonIn   = el(doc, "input", "field__control", { type: "text", placeholder: "Longitude", "data-input": "place-lon", "aria-label": "Longitude" });
      var set = el(doc, "button", "pane__connect", { type: "button", "data-act": "place-set", text: "Set the place" });
      set.disabled = true;
      function refresh() { set.disabled = !usable(latIn.value, lonIn.value); }
      [latIn, lonIn].forEach(function (n) { if (n && n.addEventListener) n.addEventListener("input", refresh); });
      var fired = false;
      function submit() {
        if (fired) return null;
        if (!usable(latIn.value, lonIn.value)) { say("That doesn't look like a real coordinate — nothing was set."); return null; }
        fired = true; set.disabled = true;
        var place = { lat: Number(latIn.value), lon: Number(lonIn.value) };
        var lbl = (labelIn.value || "").trim() || shop.name;
        if (lbl) place.label = lbl;
        say("Place set.");
        fire(place);
        return place;
      }
      if (set.addEventListener) set.addEventListener("click", submit);
      card.appendChild(labelIn); card.appendChild(latIn); card.appendChild(lonIn);
      card.appendChild(set);
      card.appendChild(status);
      pane._submit = submit;
      pane._fields = { label: labelIn, lat: latIn, lon: lonIn };
      pane._refresh = refresh;
    }

    // A place-less shop is valid; leaving without setting is always available.
    var skip = el(doc, "button", "pane__connect", { type: "button", "data-act": "place-skip", text: "Not now \u2014 open the board" });
    if (skip.addEventListener) skip.addEventListener("click", function () { if (typeof opts.onSkip === "function") opts.onSkip(); });
    card.appendChild(skip);
    pane._skip = function () { if (typeof opts.onSkip === "function") opts.onSkip(); };

    pane.appendChild(card);
    return pane;
  }

  /* ======================================================================
     SURFACE 5 — renderOpening(doc, shop, opts)   ·   THE OPENING, screen 2

     Three named acts, revealed in order. Each one is a CLAIM ABOUT WHAT NOW
     EXISTS, and every one of them is already true when this surface is called —
     the host calls it with the server's `shop` in hand. That is the difference
     between this and a spinner: a spinner narrates work it cannot see; this
     narrates work that is finished, and teaches the trust model on the way past.

     opts.schedule(fn, ms) — injectable timer (tests pass a run-now shim).
     opts.onDone()         — the butcher is through; the host shows the board.

     The "Go to the board" control is present from the first paint and is never
     gated on the reveal finishing. A dropped timer must not be able to strand
     someone inside their own shop opening.
     ====================================================================== */
  function renderOpening(doc, shop, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    opts = opts || {};
    shop = shop || {};
    var schedule = typeof opts.schedule === "function"
      ? opts.schedule
      : function (fn, ms) { try { return setTimeout(fn, ms); } catch (e) { fn(); return null; } };

    var pane = el(doc, "section", "pane pane--live", { "data-kind": "butcher-opening" });
    pane.appendChild(el(doc, "h2", "pane__title",
      { text: shop.name ? shop.name + " is open." : "The shop is open." }));

    var acts = el(doc, "div", "view__list", { "data-region": "opening-acts" });
    pane.appendChild(acts);

    function act(id) {
      var row = el(doc, "div", "record record--act", { "data-act-id": id, "data-shown": "no" });
      acts.appendChild(row);
      return row;
    }
    var rBook = act("book"), rMark = act("mark"), rPlace = act("place");

    function reveal(row, build) {
      row.setAttribute("data-shown", "yes");
      build(row);
    }

    function showBook(row) {
      row.appendChild(el(doc, "p", "line", { text: "Your book is open. Nothing in it yet." }));
    }

    function showMark(row) {
      /* RENDER the served picture; never re-derive it. If it cannot be painted the
         fingerprint is shown instead — an absent mark, not a broken shop.
         AND: nothing here ever compares marks. The mark carries ~19 bits; it is a
         RECOGNITION aid, not an identifier (asserted M8). Identity is mark_pubkey. */
      var slot = el(doc, "div", "record__media", { "data-region": "shop-mark" });
      row.appendChild(slot);
      if (markInto(doc, slot, shop.mark)) {
        row.appendChild(el(doc, "p", "line", { text: "This is your mark. It goes on everything you sign." }));
      } else {
        row.appendChild(el(doc, "p", "line",
          { text: "Your mark couldn't be drawn here" +
                  (shop.mark_fingerprint ? " — its fingerprint is " + shop.mark_fingerprint + "." : ".") +
                  " Your key is fine; it signs everything either way." }));
      }
    }

    function showPlace(row) {
      var p = shop.place;
      if (p && (p.label || p.lat != null)) {
        row.appendChild(el(doc, "p", "line",
          { text: "Your place is set" + (p.label ? ": " + p.label + "." : ".") }));
      } else {
        row.appendChild(el(doc, "p", "line",
          { text: "No place set — your records won't carry a weather line. You can open orders all the same." }));
      }
    }

    var done = el(doc, "button", "pane__connect",
      { type: "button", "data-act": "opening-done", text: "Go to the board" });
    if (done.addEventListener) done.addEventListener("click", function () {
      if (typeof opts.onDone === "function") opts.onDone();
    });
    pane.appendChild(done);

    reveal(rBook, showBook);
    schedule(function () { reveal(rMark, showMark); }, 1200);
    schedule(function () { reveal(rPlace, showPlace); }, 2400);
    schedule(function () { if (typeof opts.onDone === "function") opts.onDone(); }, 4000);

    pane._done = function () { if (typeof opts.onDone === "function") opts.onDone(); };
    return pane;
  }

  /* ======================================================================
     E8 — THE CENSUS (Diane's view, leg 11). A COMPOSITION, not new machinery.

     WHY THIS IS NOT `renderBoard`. `renderBoard` is a WORKLIST and it drops on
     purpose: an order with no signed entry behind it is filtered out (:2020),
     and the route behind it drops an all-superseded order (`if (!last)
     continue`). Both drops are RIGHT for a worklist — Rick wants to know what to
     do next, and an order with nothing signed is not work.

     Diane wants the opposite. A census that silently omits a row is worse than
     one that shows a row it cannot classify, because the omission is invisible
     and the unclassifiable row is a question she can ask out loud. SO A CENSUS
     MAY NOT DROP. The census set is the worklist's set PLUS THE NAMED RESIDUE.

     This reuses leg 07's resolution rather than re-deriving it: leg 07 already
     "counts and NAMES any order the lane read cannot place." Same shape, same
     law, one level out.

     WHAT THIS LEG IS NOT — and the boundary is load-bearing, not decorative.
     There is NO regulatory language anywhere in this surface or its copy: no
     "compliant", no "required", no retention claim. This view renders a chain
     the shop already signed and NAMES what it cannot place; Diane brings her own
     judgment about whether that satisfies her. The leg that exports a record and
     calls it compliant is leg 10, and it stays gated on Maine DACF. That
 boundary is WHY this leg ships ungated (CALL 1, ruled A at ).

     It never writes. It performs no I/O. It is handed its data and hands
     nothing back but what the host asked to be told.
     ====================================================================== */

  /* The two residue causes, named once so the fold and the copy cannot drift. */
  var CENSUS_RESIDUE = {
    "no-entries": "No signed entries — the order id exists, the chain does not",
    "all-superseded": "Every entry superseded — nothing effective remains to place"
  };

  /* censusView(orders) — PURE fold. Returns EVERY order handed in, each either
     placed (it has a lane) or NAMED as unplaceable with a reason. Nothing is
     dropped, and no row is invented: `total` always equals `orders.length`. */
  function censusView(orders) {
    var list = Array.isArray(orders) ? orders : [];
    var rows = [], placed = 0, unplaceable = 0, i;
    for (i = 0; i < list.length; i++) {
      var o = list[i] || {};
      var entries = Array.isArray(o.entries) ? o.entries : [];
      var order_id = o.order_id != null ? o.order_id
        : (entries.length ? entries[0].order_id : null);
      var fold = foldCorrections(entries);
      var residue = null;
      if (!entries.length) residue = "no-entries";
      else if (!fold.effective.length) residue = "all-superseded";

      /* The view is derived even for a residue row. A row Diane cannot place is
         still a row she can OPEN — the chain is exactly what she came to read,
         and an unplaceable order is the one most worth reading. */
      var v = orderView({ order_id: order_id, entries: entries });
      rows.push({
        order_id: order_id,
        view: v,
        entries: entries,
        supersededBy: fold.supersededBy,
        placeable: residue == null,
        residue: residue,
        residueLabel: residue ? CENSUS_RESIDUE[residue] : null
      });
      if (residue == null) placed++; else unplaceable++;
    }
    return { rows: rows, total: rows.length, placed: placed, unplaceable: unplaceable };
  }

  /* chainLines(row) — one order's entries as summary LINES, oldest first.
     `label` is what happened, `value` is when. A superseded entry is MARKED and
     never removed (leg 02's law): it keeps its place in the chain and says so.
     These go through `_lineEl` like every other line in this file — the census
     chooses WHICH lines to show and has no way to reach what a line says. */
  function chainLines(row) {
    var entries = (row && Array.isArray(row.entries)) ? row.entries : [];
    var supersededBy = (row && row.supersededBy) || {};
    var out = [], i;
    var ordered = entries.slice().sort(function (a, b) {
      var as = a && a.seq != null ? Number(a.seq) : 0;
      var bs = b && b.seq != null ? Number(b.seq) : 0;
      return as - bs;
    });
    for (i = 0; i < ordered.length; i++) {
      var e = ordered[i];
      var stage = stageForEvent(e.event);
      var gone = e.entry_hash != null && !!supersededBy[e.entry_hash];
      var what = (stage && stage.label) ? stage.label : String(e.event == null ? "" : e.event);
      if (isCorrection(e.event)) what = "Correction";
      out.push({
        id: "chain-" + (e.seq != null ? e.seq : i),
        label: what + (gone ? " (superseded)" : ""),
        value: e.timestamp ? fmtWhen(e.timestamp) : "",
        note: gone ? "Superseded by a later correcting entry. Kept, never erased." : null
      });
    }
    return out;
  }

  /* ======================================================================
     SURFACE — renderSeasonCensus(doc, orders, opts)

     opts.window   — {from, to} or absent. NAMED ON THE ARTIFACT either way:
                     absent renders "All orders on file", never a blank.
     opts.title    — heading override.
     opts.expanded — an order_id, or a list of them, to render open.

 Where this MOUNTS was CALL 2. RULED (operator, ): a "Season census"
     button on the board's nav strip — a view swap inside the butcher pane, not
     its own tab. The host wires it (butcher-renderer.js showCensus) by folding
     the orders the board already read; this stayed a pure render function and
     did not change a line for the mount, which was the point of leaving it open.
     ====================================================================== */
  function renderSeasonCensus(doc, orders, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    opts = opts || {};
    var census = censusView(orders);

    var pane = el(doc, "section", "pane pane--live",
      { "data-kind": "butcher-season-census" });
    pane.appendChild(el(doc, "h2", "pane__title",
      { text: opts.title || "Every order on file" }));

    /* The window rides the artifact, not the request that produced it. A blank
       here would let a reader assume a scope nobody chose. */
    pane.appendChild(el(doc, "div", "record__meta",
      { text: _windowText({ window: opts.window }) }));

    if (!census.total) {
      pane.className = "pane pane--absent";
      pane.appendChild(el(doc, "p", "pane__absent",
        { text: "No orders on file." }));
      return pane;
    }

    /* The counts, through the one line painter. `unplaceable` emits even at zero
       — unlike an anomaly, a census's residue count is the reader's assurance
       that nothing was hidden, so a silent zero would be the wrong asymmetry. */
    var counts = el(doc, "div", "view__detail", { "data-region": "census-counts" });
    counts.appendChild(_lineEl(doc, {
      id: "census-total", label: "Orders on file", value: String(census.total)
    }));
    counts.appendChild(_lineEl(doc, {
      id: "census-placed", label: "Placed in a lane", value: String(census.placed)
    }));
    counts.appendChild(_lineEl(doc, {
      id: "census-unplaceable",
      label: "Shown but not placed",
      value: String(census.unplaceable),
      note: "Listed with a reason. A census names what it cannot classify rather than dropping it."
    }));
    pane.appendChild(counts);

    var wantOpen = {};
    (function (x) {
      if (x == null) return;
      var arr = Array.isArray(x) ? x : [x];
      for (var i = 0; i < arr.length; i++) wantOpen[String(arr[i])] = true;
    })(opts.expanded);

    var list = el(doc, "div", "view__rows", { "data-region": "census-rows" });
    for (var i = 0; i < census.rows.length; i++) {
      var r = census.rows[i];
      var v = r.view;
      var row = el(doc, "div", "row row--clickable", {
        role: "button", tabindex: "0",
        "data-order": String(r.order_id),
        "data-placeable": r.placeable ? "1" : "0"
      });
      if (!r.placeable) row.setAttribute("data-residue", r.residue);

      var body = el(doc, "div", "row__body");
      body.appendChild(el(doc, "div", "row__title",
        { text: (v.customer || "customer unknown") + "  ·  #" + r.order_id }));
      body.appendChild(el(doc, "div", "row__meta", {
        text: r.placeable
          ? ((v.stage && v.stage.label ? v.stage.label : "other") +
             "  ·  " + v.count + (v.count === 1 ? " entry" : " entries"))
          : r.residueLabel
      }));
      row.appendChild(body);

      /* Each row opens to its chain. Rendered as a child region rather than
         fetched on tap: this surface performs no I/O, and the entries are
         already in the hand that called it. */
      var chain = el(doc, "div", "view__list", { "data-region": "census-chain" });
      chain.setAttribute("data-open", wantOpen[String(r.order_id)] ? "1" : "0");
      var lines = chainLines(r);
      if (!lines.length) {
        chain.appendChild(el(doc, "div", "view__region-label",
          { text: "Nothing signed against this order." }));
      } else {
        chain.appendChild(el(doc, "div", "view__region-label",
          { text: "What happened, and when" }));
        for (var j = 0; j < lines.length; j++) {
          chain.appendChild(_lineEl(doc, lines[j]));
        }
      }
      row.appendChild(chain);
      list.appendChild(row);
    }
    pane.appendChild(list);
    return pane;
  }

  /* ======================================================================
     SURFACE — renderCoolerLog(doc, rollup, opts)   [T-4, the auditor's face]

     The read face over GET /api/butcher/cooler. Pure render, no I/O — the host
     (butcher-renderer.js showCooler) fetches and hands the envelope in.

     TAKES THE WHOLE ROLLUP, NOT A BARE `days` ARRAY. The predecessor's [STEP]
     line named `renderCoolerLog(doc, days, opts)`; the same handoff's own "what
     the face renders" block lists the full envelope, and that is the shape this
     takes. The reason is not tidiness: `toSupplied`, `zoneAssumed` and
     `missedCount` are the three fields that carry the AUDIT meaning, and a
     signature that accepts only `days` would oblige the host to re-thread them
     as loose opts — three chances to drop the one that matters.

     THE LAW THIS SURFACE EXISTS FOR: EVERY DAY IN THE SPAN GETS A ROW,
     INCLUDING THE DAYS NOBODY CHECKED. `coolerDays` is a fold and not a filter
     precisely so a missed check is renderable; a face that paints only the days
     with readings would satisfy every grouping assertion and DEFEAT THE ENTIRE
     RULING. `days.filter(d => d.count)` is the forbidden line in this function
     and there is a test named for it. The empty rows are the feature.

     NO THRESHOLDS, NO OUT-OF-RANGE MARKS. Call 3 of the T-3 route rulings is
     deliberately NOT RULED (owed butcher-cooler-thresholds-unruled): the safe
     numbers come from DACF/USDA or from Rick, and one invented at a keyboard
     becomes a food-safety claim on a signed chain. This surface renders the
     temperature and says nothing about whether it is good. That silence is a
     ruling, not an omission — do not "finish" it.

     THE ZONE SENTENCE IS OBLIGED, NOT OPTIONAL. The route is zone-blind by
     ruling (call 2, A) and ships `zoneAssumed: true`. forest-runtime.js says
     the face must say so "in a sentence a health inspector can read — not a
     badge, not a tooltip." So it is a line of prose in the meta block, in
     words, at full weight. Owed butcher-shop-records-no-timezone is the fix
     one layer down; until it lands, the honest move is to SAY the assumption.

     `toSupplied` IS NAMED IN WORDS, never leaned on as a field name. It reads
     "the route supplied `to`" — true when the CALLER passed nothing and the
     server struck today off its own clock (the default, and the audit-relevant
     case). The identifier parses just as naturally the other way round, so the
     copy states the act rather than echoing the key.

     opts.title — heading override.
     opts.expanded — a date (or list of dates) to render open.
     ====================================================================== */
  function renderCoolerLog(doc, rollup, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    opts = opts || {};
    var r = rollup || {};
    /* NOT `(r.days || []).filter(...)`. The fold already decided which days
       exist; this surface's only job is to paint all of them. */
    var days = Array.isArray(r.days) ? r.days : [];

    var pane = el(doc, "section", "pane pane--live",
      { "data-kind": "butcher-cooler-log" });
    pane.appendChild(el(doc, "h2", "pane__title",
      { text: opts.title || "Cooler temperature log" }));

    var meta = el(doc, "div", "record__meta", { "data-region": "cooler-span" });

    /* The span rides the artifact. A blank here would let a reader assume a
       scope nobody chose — the renderSeasonCensus precedent. */
    meta.appendChild(el(doc, "div", "record__meta-line", {
      text: (r.from && r.to)
        ? ("Every day from " + r.from + " through " + r.to + ".")
        : "No span was resolved for this log."
    }));

    /* THE TRAILING-EDGE SENTENCE. This is the whole reason the roll-up is a
       route and not a client call: a pure fold has no clock, so its last day
       always holds a reading by construction and "nobody has checked since
       Tuesday" is unrenderable from it. Say which of the two a reader is
       looking at, in words. */
    meta.appendChild(el(doc, "div", "record__meta-line", {
      "data-line": "cooler-trailing-edge",
      text: r.toSupplied
        ? ("The last day shown is today, struck from the server's own clock — " +
           "so a run of days with no reading at the end of this log is a real gap, not the end of the record.")
        : ("The last day shown was requested by whoever opened this log, not struck from a clock — " +
           "readings after " + (r.to || "that date") + " are outside this view.")
    }));

    /* THE ZONE SENTENCE — obliged by the route (call 2, ruling A). Prose, not
       a badge. It emits only when the zone WAS assumed; a shop that one day
       records its own zone should not be told its correct zone is a guess. */
    if (r.zoneAssumed) {
      meta.appendChild(el(doc, "div", "record__meta-line", {
        "data-line": "cooler-zone-assumed",
        text: "Days are counted in " + (r.zone || "UTC") + " because this shop has not recorded " +
              "its own time zone. A reading taken late in the evening may therefore be filed under " +
              "the following day."
      }));
    } else {
      meta.appendChild(el(doc, "div", "record__meta-line", {
        "data-line": "cooler-zone",
        text: "Days are counted in " + (r.zone || "UTC") + ", the zone this shop recorded."
      }));
    }
    pane.appendChild(meta);

    if (!days.length) {
      pane.className = "pane pane--absent";
      pane.appendChild(el(doc, "p", "pane__absent",
        { text: "No cooler readings on file for this span." }));
      return pane;
    }

    /* The counts, through the one line painter. `missedCount` EMITS AT ZERO —
       unlike an anomaly, a gap count is the auditor's assurance that nothing
       was hidden, so a silent zero would be the wrong asymmetry. This is the
       renderSeasonCensus `unplaceable` rule, same reason. */
    var counts = el(doc, "div", "view__detail", { "data-region": "cooler-counts" });
    counts.appendChild(_lineEl(doc, {
      id: "cooler-days", label: "Days in this log", value: String(r.dayCount != null ? r.dayCount : days.length)
    }));
    counts.appendChild(_lineEl(doc, {
      id: "cooler-readings", label: "Readings recorded", value: String(r.count != null ? r.count : "")
    }));
    counts.appendChild(_lineEl(doc, {
      id: "cooler-missed",
      label: "Days with no reading",
      value: String(r.missedCount != null ? r.missedCount : ""),
      note: "Counted from the span, not from the readings. A day nobody checked is a row in this log."
    }));
    pane.appendChild(counts);

    var wantOpen = {};
    (function (x) {
      if (x == null) return;
      var arr = Array.isArray(x) ? x : [x];
      for (var i = 0; i < arr.length; i++) wantOpen[String(arr[i])] = true;
    })(opts.expanded);

    var list = el(doc, "div", "view__rows", { "data-region": "cooler-days" });
    for (var i = 0; i < days.length; i++) {
      var d = days[i] || {};
      var readings = Array.isArray(d.readings) ? d.readings : [];

      /* `data-missed` is set from the fold's OWN derived bit, never re-derived
          from readings.length here. A second copy of that rule is free to drift
          from the one in butcher-record.js — the deleted FOREST_APP_VERSIONS
          map, one scale down. */
      var row = el(doc, "div", "row row--clickable", {
        role: "button", tabindex: "0",
        "data-day": String(d.date),
        "data-missed": d.missed ? "1" : "0"
      });

      var body = el(doc, "div", "row__body");
      body.appendChild(el(doc, "div", "row__title", { text: String(d.date) }));
      body.appendChild(el(doc, "div", "row__meta", {
        text: d.missed
          ? "No reading recorded"
          : (d.count + (d.count === 1 ? " reading" : " readings"))
      }));
      row.appendChild(body);

      var detail = el(doc, "div", "view__list", { "data-region": "cooler-readings" });
      detail.setAttribute("data-open", wantOpen[String(d.date)] ? "1" : "0");
      if (!readings.length) {
        /* THE EMPTY ROW SPEAKS. A missed day that opened to nothing would read
           as a rendering failure; it is a finding, and it says so. */
        detail.appendChild(el(doc, "div", "view__region-label",
          { text: "Nobody recorded a cooler temperature on this day." }));
      } else {
        detail.appendChild(el(doc, "div", "view__region-label",
          { text: "What was recorded, and when" }));
        for (var j = 0; j < readings.length; j++) {
          detail.appendChild(_coolerReadingEl(doc, readings[j]));
        }
      }
      row.appendChild(detail);
      list.appendChild(row);
    }
    pane.appendChild(list);
    return pane;
  }

  /* One reading, as a line. The two derived honesty marks (`retroactive`,
     `provisional`) ride the line as attributes AND as words — an attribute a
     stylesheet reads is not a thing a health inspector reads, and this face is
     for the inspector. Neither mark is a judgement about the TEMPERATURE; both
     are statements about the RECORD, which is the only thing this surface is
     entitled to characterise (thresholds are unruled). */
  function _coolerReadingEl(doc, x) {
    var rd = x || {};
    var marks = [];
    if (rd.retroactive) marks.push("entered after the fact");
    if (rd.provisional) marks.push("uncalibrated device");

    var value = (rd.value != null && rd.unit)
      ? (String(rd.value) + "\u00B0" + String(rd.unit))
      : "\u2014";

    var label = fmtWhen(rd.taken_at);
    if (rd.cooler) label = String(rd.cooler) + "  \u00B7  " + label;

    var ln = _lineEl(doc, {
      id: "cooler-reading",
      label: label,
      value: value,
      note: marks.length ? marks.join("; ") : null
    });
    if (rd.retroactive) ln.setAttribute("data-retroactive", "1");
    if (rd.provisional) ln.setAttribute("data-provisional", "1");
    if (rd.seq != null) ln.setAttribute("data-seq", String(rd.seq));
    /* The marks are SPOKEN, not only attributed. */
    if (marks.length) {
      ln.appendChild(el(doc, "span", "line__note", { text: "(" + marks.join("; ") + ")" }));
    }
    return ln;
  }

  /* ======================================================================
     E9-worker (leg 12) — THE SURFACE HALF OF THE ROLE SEAM.

     READ THE FENCE BEFORE READING THE CODE. This is a role-shaped VIEW. It is
     NOT a permission, and the GRANT half of the Role Seam is specified NOWHERE
     in this project (four carriers repeat "one grant now, second-grant-shaped";
     none says what a grant is — owed `butcher-role-seam-grant-half-specified-
     nowhere`, seq 212). Three statements hold, and each carries a test in
     `butcher-worker.test.js`:

       1. EVERY write rides the existing owner-gated route, unchanged. This
          surface calls `advanceControl`, which calls the host's `onAdvance` with
          the same three arguments the board and the order glance have always
          passed. It adds no route, widens no gate, introduces no second
          authority. If this dashboard can write, it is because the owner session
          can write, and for no other reason.
       2. NO ROLE CLAIM IS EVER TRUSTED, and none is ever WRITTEN. The role is a
          view preference, exactly as sort order is. It is never an argument to
          an authorization decision, never persisted as an entitlement, and —
          load-bearing — never reaches a write payload, so nothing false is ever
          signed into an append-only record as an actor identity. `{post}` 4 is
          the test that proves it, and it is the test that keeps this fence from
          being prose.
       3. THE ABSENCE IS DECLARED, NOT HIDDEN. No lock glyph, no "you do not have
          permission" copy, no control greyed with a role explanation. A lock
          would teach the operator that the seam is CLOSED when it is OPEN, which
          is the one misreading this whole section exists to prevent. So the pane
          says, in words, that it is a filter over a record this session can read
          in full.

     THE QUESTION THIS SURFACE ANSWERS is none of the other three's. The board
     asks "where is every order?", the glance asks "what happened to this one?",
     the census asks "what did the season do?". This asks "WHAT DO I TOUCH NEXT?"
     — asked by someone holding a knife, in a 38F room, two hundred times in
     three weeks, who does not want to read a board and find their own row on it.
     ====================================================================== */

  /* CALL 1 ( run book) — THE STAGE-WINDOW MAPPING. NOT RULED.

     `ux-evolution-plan-v1.md:102` grounds the split by EXAMPLE (Rick -> carcass
     into the cooler; Christine -> pack-out) and `:159` adds Christine -> the
     call. NOTHING DECLARES A MAPPING. Deer Hill's actual division of labour is
     the operator's to state, so this is CONFIGURATION WITH A STATED DEFAULT —
     never a hardened constant. Two ways to correct it and both are one move:
     edit the `stages` array below, or pass `opts.roles` from the host.

     The default reads the run book's plausible reading, and the `derivedFrom`
     field records that it is a READING, not a ruling, on the artifact itself so
     a later reader cannot mistake it for a decision that was made. */
  var WORKER_ROLES = [
    { id: "rick", label: "Rick", stages: ["intake", "hang", "cuts"],
      derivedFrom: "ux-evolution-plan-v1.md:102 (by example: tags a carcass into the cooler) — A READING, NOT A RULING" },
    { id: "christine", label: "Christine", stages: ["package", "notify", "pickup"],
      derivedFrom: "ux-evolution-plan-v1.md:102/:159 (by example: pack-out, and the call) — A READING, NOT A RULING" }
  ];

  /* CALL 2 — ONE surface parameterized by role, not two. The Block Principle
     leans this way and so does the vocabulary: two surfaces would each hold
     their own copy of the lane words and diverge, which is the drift class
     `run.md` has recorded five times. `roleId` is the parameter. */
  function workerRole(roleId, roles) {
    var set = Array.isArray(roles) && roles.length ? roles : WORKER_ROLES;
    for (var i = 0; i < set.length; i++) {
      if (String(set[i].id) === String(roleId)) return set[i];
    }
    return null;
  }
  function WORKER_ROLE_IDS(roles) {
    var set = Array.isArray(roles) && roles.length ? roles : WORKER_ROLES;
    return set.map(function (r) { return r.id; });
  }

  /* workerView(orders, roleId, opts) — PURE fold. No I/O, no DOM, no writes.

     "Mine to do now" = an order whose CURRENT lane is (a) in this role's stage
     window AND (b) ACTIVE. Both halves matter and neither is hand-listed:

       · the window comes from the role config (CALL 1, correctable);
       · ACTIVE comes from `ACTIVE_LANES()` — the record's own partition, read
         as the FUNCTION it is (the `{pre}` check 3 correction: these are
         functions returning freshly-filtered lane objects, not arrays. Gating on
         the array shape would have gated on a belief about the module rather
         than on the module — the leg-08 failure class).

     Nothing is dropped. Every order handed in lands in exactly one of four
     buckets and the four sum to the total, so the pane can state its own
     arithmetic and a reader can check it:

       mine       — in my window, active. The worklist.
       resting    — in my window, but the lane rests (finished work, or an
                    ending). Counted, not listed: it is not work.
       elsewhere  — a lane outside my window. Someone else's work, and the pane
                    SAYS so rather than pretending the order does not exist.
       unreadable — the OTHER lane: an event we cannot classify. Surfaced to
                    EVERY role, deliberately, because an unknown row is the one
                    most likely to need a human and hiding it from everybody is
                    how it sits for a week. Never paint a claim the chain cannot
                    back (standing law 2) — and "not your problem" is such a claim.

     A window naming a stage that is not in the shared vocabulary is REPORTED in
     `unknownStages`, never silently ignored — a typo'd config that quietly
     filtered everything out would look exactly like a quiet day. */
  function workerView(orders, roleId, opts) {
    opts = opts || {};
    var role = workerRole(roleId, opts.roles);
    var list = Array.isArray(orders) ? orders : [];

    var activeIds = ACTIVE_LANES().map(function (s) { return s.id; });
    var knownIds = ALL_LANES().map(function (s) { return s.id; });

    var window_ = role ? (Array.isArray(role.stages) ? role.stages : []) : [];
    var unknownStages = window_.filter(function (id) { return knownIds.indexOf(id) === -1; });
    var inWindow = function (id) { return window_.indexOf(id) !== -1; };

    var out = {
      role: role,
      roleId: role ? role.id : null,
      window: window_.slice(),
      unknownStages: unknownStages,
      mine: [], restingCount: 0, elsewhereCount: 0, unreadable: [],
      total: list.length
    };

    for (var i = 0; i < list.length; i++) {
      var v = orderView(list[i]);
      var sid = v && v.stage ? v.stage.id : OTHER_STAGE.id;

      if (sid === OTHER_STAGE.id) { out.unreadable.push(v); continue; }
      if (!inWindow(sid)) { out.elsewhereCount++; continue; }
      if (activeIds.indexOf(sid) === -1) { out.restingCount++; continue; }
      out.mine.push(v);
    }

    /* Sort by the record's own sequence, so the worklist reads down the line the
       way the shop runs. `stageIndex` is the single sort authority the board and
       the census already share — this surface adds no second ordering. */
    out.mine.sort(function (a, b) {
      var d = stageIndex(a.stage.id) - stageIndex(b.stage.id);
      return d !== 0 ? d : String(a.order_id).localeCompare(String(b.order_id));
    });
    out.mineCount = out.mine.length;
    out.unreadableCount = out.unreadable.length;
    return out;
  }

  /* CALL 3 — WHERE THE ROLE SELECTION COMES FROM. `opts.role` is a plain view
     preference handed in by the host, exactly like `opts.window` on the census.
     A shell toggle, a URL parameter, and a stored preference are all acceptable
     shapes under the fence; what is NOT acceptable is anything that LOOKS like a
     login, because a login that authenticates nothing teaches the operator the
     seam is closed when it is open. So there is no credential slot here, no
     "sign in as", and no failure state for a wrong role — an unknown role
     renders the honest chooser, not a rejection. */
  function renderWorkerDashboard(doc, orders, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    opts = opts || {};
    var roles = Array.isArray(opts.roles) && opts.roles.length ? opts.roles : WORKER_ROLES;
    var wv = workerView(orders, opts.role, { roles: roles });

    var pane = el(doc, "section", "pane pane--live",
      { "data-kind": "butcher-worker" });

    /* NO ROLE IN A WRITE, AND NO ROLE IN A CLAIM. The role rides the artifact as
       a view attribute so a test can read it and so the pane can name its own
       scope — it is never handed to `onAdvance`. `{post}` 4 asserts exactly that. */
    if (wv.role) pane.setAttribute("data-role", wv.role.id);
    pane.setAttribute("data-role-enforced", "0");   // the fence, machine-readable

    if (!wv.role) {
      /* The honest chooser. Not an error, not a permission failure — the pane
         simply has not been told whose shift it is. */
      pane.className = "pane pane--absent";
      pane.appendChild(el(doc, "h2", "pane__title", { text: "Whose shift?" }));
      pane.appendChild(el(doc, "p", "pane__absent",
        { text: "Pick a shift to see just that work. This only changes what is shown \u2014 every order stays readable from the board." }));
      var chooser = el(doc, "div", "view__cluster", { "data-region": "worker-roles" });
      for (var c = 0; c < roles.length; c++) {
        var pick = el(doc, "button", "pane__connect", {
          type: "button", "data-act": "worker-role", "data-role": String(roles[c].id),
          text: roles[c].label
        });
        (function (rid, btn) {
          function fire() { if (typeof opts.onRole === "function") opts.onRole(rid); return rid; }
          if (btn.addEventListener) btn.addEventListener("click", fire);
          btn._fire = fire;
        })(roles[c].id, pick);
        chooser.appendChild(pick);
      }
      pane.appendChild(chooser);
      return pane;
    }

    pane.appendChild(el(doc, "h2", "pane__title",
      { text: opts.title || (wv.role.label + "\u2019s shift") }));

    /* STATEMENT 3 OF THE FENCE, IN WORDS, ON THE PANE. This is not a caveat
       bolted on for tidiness — it is a `{post}` requirement. The wording says
       what the filter IS and what it is NOT, and it never implies enforcement. */
    pane.appendChild(el(doc, "div", "record__meta", {
      text: "Showing the work on this shift. This is a filter, not a lock \u2014 every order is still readable from the board."
    }));

    /* LEG 15, `{post}` 5 — THE WRITE-SIDE HALF OF FENCE 3, AND IT IS A DIFFERENT
       CLAIM FROM THE LINE ABOVE. Leg 12's sentence is about the READ: what this
       pane SHOWS you. This one is about the WRITE: what an append is allowed to
       BE. As of leg 15 the butcher write path really is gated (`checkWarrant`
       before the signed append, `forest-runtime.js:2445`), so the pane now has a
       live gate to describe — and describing it wrong is the whole hazard owed
       212 was filed against.

       THE SECOND SENTENCE IS LOAD-BEARING AND WAS WRITTEN FROM BYTES, NOT FROM
       THE RUNBOOK'S PROSE. `rec.appendEntry` DOES persist `actor`
       (`forest-runtime.js:2475`), so "the record keeps no name" would be FALSE —
       standing law 2, never paint a claim the chain cannot back. What is true is
       narrower and is exactly what a reader needs: the name is RECORDED and is
       never CONSULTED (`body.actor` is not passed to `checkWarrant`, :2429; W6
       proves two different actor values both pass under one grant). So the copy
       says recorded-but-not-checked rather than absent.

       No lock glyph, no padlock, no "signed by" line — a reader who sees one
       learns the seam is closed when it is open, which is the misreading this
       fence exists to prevent. `{post}` 5's test asserts that absence. */
    pane.appendChild(el(doc, "div", "record__meta", {
      "data-region": "worker-write-fence",
      text: "What can be recorded on this shift is set by the shift itself, not by who is standing at the screen. " +
            "A name typed on an entry is kept as part of the record \u2014 it is never checked, and it opens nothing."
    }));

    /* A mis-typed window looks exactly like a quiet day, so it is LOUD. */
    if (wv.unknownStages.length) {
      pane.appendChild(el(doc, "p", "pane__absent", {
        text: "Shift setup names " + wv.unknownStages.length +
              " stage" + (wv.unknownStages.length === 1 ? "" : "s") +
              " the record does not have: " + wv.unknownStages.join(", ") +
              ". Those are being skipped."
      }));
    }

    /* The arithmetic, through the one line painter. Every bucket emits even at
       zero: a reader checking that the four sum to the total is the assurance
       nothing was hidden from them, and a silent zero would break the sum. */
    var counts = el(doc, "div", "view__detail", { "data-region": "worker-counts" });
    counts.appendChild(_lineEl(doc, {
      id: "worker-mine", label: "On this shift now", value: String(wv.mineCount)
    }));
    counts.appendChild(_lineEl(doc, {
      id: "worker-resting", label: "Finished on this shift", value: String(wv.restingCount)
    }));
    counts.appendChild(_lineEl(doc, {
      id: "worker-elsewhere", label: "On another shift", value: String(wv.elsewhereCount),
      note: "Not hidden \u2014 read them on the board. They are not this shift\u2019s work."
    }));
    counts.appendChild(_lineEl(doc, {
      id: "worker-unreadable", label: "Needs a look", value: String(wv.unreadableCount),
      note: "The last thing recorded on these could not be read, so no shift owns them. Shown to everyone on purpose."
    }));
    pane.appendChild(counts);

    /* THE WORKLIST. One row per order, carrying the SAME single primary advance
       affordance E1 established — `advanceControl`, not a copy of it. The next
       stage is COMPUTED (`nextStage`), so this surface offers no choice the
       domain already made, and it cannot drift from the board's label because it
       is literally the same function. */
    var list = el(doc, "div", "view__rows", { "data-region": "worker-rows" });
    if (!wv.mineCount) {
      list.appendChild(el(doc, "div", "view__region-label",
        { text: "Nothing waiting on this shift." }));
    }
    pane._advances = {};
    for (var i = 0; i < wv.mine.length; i++) {
      var v = wv.mine[i];
      var row = el(doc, "div", "row row--clickable", {
        role: "button", tabindex: "0", "data-order": String(v.order_id),
        "data-stage": v.stage.id
      });
      var body = el(doc, "div", "row__body");
      body.appendChild(el(doc, "div", "row__title",
        { text: (v.customer || "customer unknown") + "  \u00b7  #" + v.order_id }));
      body.appendChild(el(doc, "div", "row__meta",
        { text: v.stage.label + "  \u00b7  " + v.count + (v.count === 1 ? " entry" : " entries") }));
      row.appendChild(body);

      var trail = el(doc, "div", "row__trail");
      var adv = advanceControl(doc, v, opts);
      if (adv) {
        trail.appendChild(adv);
        row._advance = adv._fire;
        pane._advances[String(v.order_id)] = adv._fire;
      }
      row.appendChild(trail);
      list.appendChild(row);
    }
    pane.appendChild(list);

    /* The unreadable rows, listed rather than counted — the count says how many
       and the list says which, because "needs a look" is useless without a
       pointer. No advance is offered: `nextStage` returns null on OTHER and we do
       not guess where an unreadable order goes next. The ABSENCE IS EXPLAINED,
       and the explanation is about the RECORD, never about the role. */
    if (wv.unreadableCount) {
      var odd = el(doc, "div", "view__list", { "data-region": "worker-unreadable" });
      odd.appendChild(el(doc, "div", "view__region-label",
        { text: "Needs a look \u2014 the last entry could not be read" }));
      for (var u = 0; u < wv.unreadable.length; u++) {
        var uv = wv.unreadable[u];
        odd.appendChild(_lineEl(doc, {
          id: "worker-odd-" + uv.order_id,
          label: (uv.customer || "customer unknown") + "  \u00b7  #" + uv.order_id,
          value: "no next step",
          note: "The record does not say where this sits, so no next step is offered."
        }));
      }
      pane.appendChild(odd);
    }

    /* The shift switch. A view preference, and the copy says so. */
    if (roles.length > 1 && typeof opts.onRole === "function") {
      var swap = el(doc, "div", "view__cluster", { "data-region": "worker-roles" });
      for (var k = 0; k < roles.length; k++) {
        if (roles[k].id === wv.role.id) continue;
        var other = el(doc, "button", "pane__connect", {
          type: "button", "data-act": "worker-role", "data-role": String(roles[k].id),
          text: "Show " + roles[k].label + "\u2019s shift"
        });
        (function (rid, btn) {
          function fire() { return opts.onRole(rid); }
          if (btn.addEventListener) btn.addEventListener("click", fire);
          btn._fire = fire;
        })(roles[k].id, other);
        swap.appendChild(other);
      }
      pane.appendChild(swap);
    }

    pane._view = wv;
    return pane;
  }

  /* ======================================================================
     CUSTOMERS — the fold (leg 17, the first stub-fill · owed app-face-customers).

     A PURE fold over the orders already in the caller's hand — no fetch, the
     showCensus discipline (this surface performs no I/O; the marketing-notes
     half, which reads the Contacts store, is a SEPARATE beat gated on the
     notes-model ruling). Each customer is a bucket of their own orders — their
     history — keyed by the CONTACT the order resolves to when it carries one
     (two orders from one contact merge even if the typed name drifted between
     them), else by the customer NAME (walk-ins and unmatched intakes group by
     what the chain actually holds). A `customer` of null — the intake never
     named one — folds under ONE honest "customer unknown" bucket rather than
     each unnamed order becoming a phantom singleton (never the order_id as a
     key: that is the phantom-singleton the fold exists to avoid). */
  function customersView(orders) {
    orders = Array.isArray(orders) ? orders : [];
    var byKey = {};        // key -> bucket
    var seen = [];         // insertion order, so the list is stable, not hash-order
    for (var i = 0; i < orders.length; i++) {
      var v = orderView(orders[i]);
      var cid = v.contact && v.contact.contact_id ? String(v.contact.contact_id) : null;
      var name = v.customer != null ? v.customer : null;
      var key = cid ? ("cid:" + cid) : (name ? ("name:" + name) : "unknown");
      var b = byKey[key];
      if (!b) {
        b = byKey[key] = {
          key: key,
          contact_id: cid,
          name: name || "customer unknown",
          named: name != null,
          phone: v.phone || null,
          orders: []
        };
        seen.push(key);
      }
      // First non-null phone seen wins the bucket's display phone; a later order
      // that dropped the phone must never blank a known one.
      if (!b.phone && v.phone) b.phone = v.phone;
      // A later order that DID resolve a contact upgrades a name-keyed bucket's
      // display id (best-effort; the key itself is fixed on first sight).
      if (!b.contact_id && cid) b.contact_id = cid;
      b.orders.push(v);
    }
    var rows = [];
    for (var j = 0; j < seen.length; j++) {
      var bucket = byKey[seen[j]];
      bucket.count = bucket.orders.length;
      rows.push(bucket);
    }
    return { rows: rows, total: rows.length, orders: orders.length };
  }

  /* CUSTOMERS — the surface (leg 17). Contacts-SHAPED (a list of people, each
     opening to what the shop holds on them) but butcher-owned: the "what we
     hold" is their ORDER HISTORY, folded from the record in hand. Spells in the
     same Block alphabet the census uses (.pane / .row / .view__list) so it costs
     zero marginal CSS — the zero-new-grammar gate. Honest asymmetry (law 3): a
     customer with no phone shows no phone fragment, never an empty one; an empty
     record shows the absent pane, not a heading over nothing.

     MARKETING NOTES — the surface draws only the SOCKET (leg 17 beat 2). Notes
     are the I/O half (a Contacts notes read/write keyed on contact_id, the ruled
     model: reuse the shipped Contacts primitive, one store, no new route). The
     surface stays pure — it mounts an empty `customer-notes` div for each
     contact-bearing customer and nothing more; the renderer (showCustomers)
     hydrates and wires it when contactsRest is live and removes it when cold.
     A customer with no contact_id gets no socket at all (nothing durable to hang
     a note on) — the census's honest-asymmetry, absence over an empty caption. */
  function renderCustomers(doc, orders, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    opts = opts || {};
    var view = customersView(orders);

    var pane = el(doc, "section", "pane pane--live", { "data-kind": "butcher-customers" });
    pane.appendChild(el(doc, "h2", "pane__title", { text: opts.title || "Customers" }));
    pane.appendChild(el(doc, "div", "record__meta",
      { text: view.total === 1 ? "1 customer on file" : view.total + " customers on file" }));

    if (!view.total) {
      pane.className = "pane pane--absent";
      pane.appendChild(el(doc, "p", "pane__absent", { text: "No customers on file." }));
      return pane;
    }

    var wantOpen = {};
    (function (x) {
      if (x == null) return;
      var arr = Array.isArray(x) ? x : [x];
      for (var i = 0; i < arr.length; i++) wantOpen[String(arr[i])] = true;
    })(opts.expanded);

    var list = el(doc, "div", "view__rows", { "data-region": "customer-rows" });
    for (var i = 0; i < view.rows.length; i++) {
      var c = view.rows[i];
      var row = el(doc, "div", "row row--clickable", {
        role: "button", tabindex: "0",
        "data-customer": c.key,
        "data-count": String(c.count)
      });
      if (c.contact_id) row.setAttribute("data-contact", c.contact_id);
      if (!c.named) row.setAttribute("data-unknown", "1");

      var body = el(doc, "div", "row__body");
      body.appendChild(el(doc, "div", "row__title", { text: c.name }));
      var metaText = c.count + (c.count === 1 ? " order" : " orders");
      if (c.phone) metaText += "  \u00B7  " + c.phone;
      body.appendChild(el(doc, "div", "row__meta", { text: metaText }));
      row.appendChild(body);

      /* The history — this customer's own orders, in the record's own order (a
         date sort is a later call, not one to invent here — the showCensus
         precedent: name the scope, don't guess one). A child region, no I/O:
         every order is already in the hand that called us.

         MANAGEABLE (owed butcher-contacts-order-history-fold, operator directive
 — "viewable AND manageable in the ways one would expect"). Leg
         17 built the history as a read-only list; this closes the manageable
         half: an order in a customer's history OPENS the existing per-order
         detail via opts.onOpen(order_id) — the board's/Orders' exact interaction,
         no new route. Cold-safe and honest: the row is an interactive .row (the
         app's clickable-row idiom, zero marginal CSS) ONLY when the host wires
         onOpen; absent that it stays the read-only .line it always was — never a
         dead button. The click STOPS PROPAGATION so opening an order never also
         toggles the enclosing customer row (row--clickable). */
      var hist = el(doc, "div", "view__list", { "data-region": "customer-history" });
      hist.setAttribute("data-open", wantOpen[c.key] ? "1" : "0");
      hist.appendChild(el(doc, "div", "view__region-label", { text: "Order history" }));
      var histOpenable = typeof opts.onOpen === "function";
      for (var h = 0; h < c.orders.length; h++) {
        var ov = c.orders[h];
        var entryText = ov.count + (ov.count === 1 ? " entry" : " entries");
        if (histOpenable) {
          var hrow = el(doc, "div", "row row--clickable",
            { role: "button", tabindex: "0", "data-order": String(ov.order_id) });
          var hbody = el(doc, "div", "row__body");
          hbody.appendChild(el(doc, "div", "row__title", { text: "#" + ov.order_id }));
          hbody.appendChild(el(doc, "div", "row__meta", { text: entryText }));
          hrow.appendChild(hbody);
          (function (orderId, rowEl) {
            function open(e) {
              if (e && typeof e.stopPropagation === "function") e.stopPropagation();
              opts.onOpen(orderId);
            }
            if (rowEl.addEventListener) {
              rowEl.addEventListener("click", open);
              rowEl.addEventListener("keydown", function (e) {
                if (e && (e.key === "Enter" || e.key === " ")) { if (e.preventDefault) e.preventDefault(); open(e); }
              });
            }
            rowEl._open = open;
          })(ov.order_id, hrow);
          hist.appendChild(hrow);
        } else {
          var lrow = el(doc, "div", "line", { "data-order": String(ov.order_id) });
          lrow.appendChild(el(doc, "span", "line__label", { text: "#" + ov.order_id }));
          lrow.appendChild(el(doc, "span", "line__value", { text: entryText }));
          hist.appendChild(lrow);
        }
      }
      row.appendChild(hist);

      /* MARKETING NOTES — the SOCKET, not the boat (leg 17 beat 2). The surface
         stays PURE: it draws an EMPTY mount point ONLY for a customer that
         resolves to a contact_id, and nothing else — no label, no list, no
         input, no wiring. The RENDERER (showCustomers, the I/O joint) supplies
         the boat: it hydrates this socket from the Contacts notes primitive
         (contactsRest.notes / .addNote, keyed on contact_id) when the client is
         live, and REMOVES the socket when it is cold. Two reasons the socket is
         drawn here yet empty: (1) purity — a fetch in the surface would breach
         the census's "never fetches, never merges, never resolves" contract the
         cruise checks; (2) honesty — the renderer owning the socket's contents
         means a cold client (or a walk-in with no contact) shows NO dead
         affordance, exactly the dock/boat shape leg 07's join already set. A
         name-keyed or unknown customer gets NO socket: there is no durable place
         to hang a note on someone who is not a contact. */
      if (c.contact_id) {
        row.appendChild(el(doc, "div", "view__list",
          { "data-region": "customer-notes", "data-contact-id": String(c.contact_id) }));
      }

      list.appendChild(row);
    }
    pane.appendChild(list);
    return pane;
  }

  /* CUSTOMER MARKETING NOTES — the pure builder (leg 17 beat 2). Builds the DOM
     the renderer injects into the socket. PURE: it takes an ALREADY-FETCHED notes
     array and renders it; it never fetches, wires, or resolves (the renderer owns
     I/O + the add-button handler — the census/join split). Three honest states,
     mirroring the honest-read axis the board and cooler already draw:

       · available + notes   -> the list, newest as the record gives them
       · available + empty    -> "No notes yet." (a TRUE empty, safe to state)
       · unavailable (opts.down) -> "Notes unavailable right now." and NO add
         affordance — a read we could not complete must NOT render as "no notes"
         (that is the join's cardinal rule), and we do not invite a write we
         cannot confirm. The renderer sets opts.down from the notes envelope.

     The add affordance is INERT here (input + button, no handler). The renderer
     wires it and only ever calls this builder when contactsApi is live, so the
     button is never dead on the glass. */
  function renderCustomerNotes(doc, notes, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    opts = opts || {};
    var wrap = el(doc, "div", "notes", { "data-region": "customer-notes-body" });
    wrap.appendChild(el(doc, "div", "view__region-label", { text: "Marketing notes" }));

    if (opts.down) {
      // Honest-read: a down/unreachable notes read is NOT an empty one.
      wrap.appendChild(el(doc, "p", "notes__down",
        { "data-region": "notes-down", text: "Notes unavailable right now." }));
      return wrap;
    }

    notes = Array.isArray(notes) ? notes : [];
    if (!notes.length) {
      wrap.appendChild(el(doc, "p", "notes__empty",
        { "data-region": "notes-empty", text: "No notes yet." }));
    } else {
      var listEl = el(doc, "div", "view__list", { "data-region": "notes-list" });
      for (var i = 0; i < notes.length; i++) {
        var n = notes[i] || {};
        var line = el(doc, "div", "line",
          { "data-note-id": n.id != null ? String(n.id) : "" });
        line.appendChild(el(doc, "span", "line__value",
          { text: n.note_text != null ? String(n.note_text) : "" }));
        if (n.created_at != null) {
          line.appendChild(el(doc, "span", "line__meta", { text: String(n.created_at) }));
        }
        listEl.appendChild(line);
      }
      wrap.appendChild(listEl);
    }

    // The add affordance — INERT (the renderer wires the button).
    var add = el(doc, "div", "notes__add", { "data-region": "note-add" });
    add.appendChild(el(doc, "input", "notes__input",
      { type: "text", placeholder: "Add a marketing note\u2026", "data-role": "note-input" }));
    add.appendChild(el(doc, "button", "notes__btn",
      { type: "button", "data-role": "note-add-btn", text: "Add" }));
    wrap.appendChild(add);
    return wrap;
  }

  /* ======================================================================
     ORDERS — the fold (leg 21, the all-orders explorer · owed app-face-orders).

     A PURE fold over the orders already in the caller's hand — the showCensus
     discipline (no fetch, no clock). The Orders explorer is the third face of
     the same record the board and Customers already read, cut a third way:
     the BOARD groups by STAGE (Rick's live pipeline), CUSTOMERS groups by PERSON
     (the marketing view), and ORDERS is the flat, whole-season browse — every
     order in one list, in the record's own order, plus the analyse-angles
     (FWW(C)) that neither per-stage nor per-person shows as one number: how the
     whole season sits across the line, the exception lanes, and the endings.

     `rows` is stable (the record's own order — a date/name sort is a later call,
     not one to invent here, the showCensus precedent). `angles` is the analyse
     half: a status roll-up (on-the-line / done / exception / other) that is
     always four buckets even at zero (they are meaningful absences), plus a
     per-lane breakdown of ONLY the lanes actually present (recognition over
     recall — an empty lane in a whole-season summary is noise, and `total`
     reconciles so nothing is hidden). `withContact` is the one marketing angle
     the explorer owes Customers: how many orders resolve to a live contact. */
  function ordersView(orders) {
    orders = Array.isArray(orders) ? orders : [];
    var rows = [];
    var laneCount = {};                 // stage.id -> count
    var onLine = 0, done = 0, exception = 0, other = 0, withContact = 0, named = 0;
    for (var i = 0; i < orders.length; i++) {
      var v = orderView(orders[i]);
      var stage = v.stage || OTHER_STAGE;
      rows.push({
        order_id: v.order_id,
        customer: v.customer,                 // null -> the row shows "customer unknown"
        named: v.customer != null,
        phone: v.phone || null,
        contact_id: (v.contact && v.contact.contact_id) ? v.contact.contact_id : null,
        stage_id: stage.id,
        stage_label: stage.label,
        stageIndex: v.stageIndex,
        count: v.count
      });
      laneCount[stage.id] = (laneCount[stage.id] || 0) + 1;
      if (v.customer != null) named++;
      if (v.contact && v.contact.contact_id) withContact++;
      // The status roll-up: which of the four buckets does this order sit in?
      // Read off the SAME lane tables the board reads (one source, never a
      // second opinion about what "off the line" means).
      var ex = exceptionStage(stage.id);
      if (ex) exception++;
      else if (stage.id === "pickup") done++;
      else if (stage.id === "other") other++;
      else onLine++;              // intake..notify — the live pipeline
    }
    // Per-lane breakdown: ALL_LANES sort order, present lanes only.
    var byLane = ALL_LANES()
      .filter(function (s) { return laneCount[s.id]; })
      .map(function (s) { return { id: s.id, label: s.label, count: laneCount[s.id] }; });
    return {
      rows: rows,
      total: rows.length,
      angles: {
        total: rows.length,
        onLine: onLine, done: done, exception: exception, other: other,
        named: named, withContact: withContact,
        byLane: byLane
      }
    };
  }

  /* ORDERS — the surface (leg 21). The whole-season browse: an angles strip
     (the analyse half) over a flat, clickable all-orders list. Spells the same
     Block alphabet the board and census use (.pane / .row / .view__list / .line)
     so it costs zero marginal CSS — the zero-new-grammar gate. Honest asymmetry
     (law 3): a row with no name shows "customer unknown" (never an empty title),
     a row with no phone shows no phone fragment, an empty record shows the absent
     pane (not a heading over nothing).

     ROW NAVIGATION reuses the board's exact interaction: each row wires its
     click/keydown to `opts.onOpen(order_id)` — the renderer passes `onOpen:
     showOrder`, the SAME per-order detail navigation the board's rows already
     use. NO new route, NO new socket, no I/O in the surface: it attaches a
     handler to a callback the host owns (the renderBoard precedent — the surface
     is still pure; the host owns the navigation). */
  function renderOrders(doc, orders, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    opts = opts || {};
    var view = ordersView(orders);

    var pane = el(doc, "section", "pane pane--live", { "data-kind": "butcher-orders" });
    pane.appendChild(el(doc, "h2", "pane__title", { text: opts.title || "Orders" }));
    pane.appendChild(el(doc, "div", "record__meta",
      { text: view.total === 1 ? "1 order on file" : view.total + " orders on file" }));

    if (!view.total) {
      pane.className = "pane pane--absent";
      pane.appendChild(el(doc, "p", "pane__absent", { text: "No orders on file." }));
      return pane;
    }

    /* THE ANGLES STRIP — the analyse half. The four-way status roll-up is drawn
       always (each bucket is a meaningful count, including zero); the per-lane
       breakdown lists only the lanes present. `data-region`/`data-*` so a test
       reads the counts off the DOM, never off a re-computed fold. */
    var a = view.angles;
    var angles = el(doc, "div", "view__list", { "data-region": "orders-angles" });
    angles.appendChild(el(doc, "div", "view__region-label", { text: "This season at a glance" }));
    function stat(region, label, n) {
      var line = el(doc, "div", "line", { "data-region": region });
      line.appendChild(el(doc, "span", "line__label", { text: label }));
      line.appendChild(el(doc, "span", "line__value", { text: String(n) }));
      return line;
    }
    angles.appendChild(stat("stat-online",    "On the line",  a.onLine));
    angles.appendChild(stat("stat-done",      "Picked up",    a.done));
    angles.appendChild(stat("stat-exception", "Exceptions",   a.exception));
    if (a.other) angles.appendChild(stat("stat-other", "Other", a.other));
    angles.appendChild(stat("stat-contact",   "Resolve to a contact", a.withContact));
    // Per-lane breakdown (present lanes, sort order).
    for (var b = 0; b < a.byLane.length; b++) {
      var lane = a.byLane[b];
      var lrow = el(doc, "div", "line", { "data-region": "lane-count", "data-lane": lane.id });
      lrow.appendChild(el(doc, "span", "line__label", { text: lane.label }));
      lrow.appendChild(el(doc, "span", "line__value", { text: String(lane.count) }));
      angles.appendChild(lrow);
    }
    pane.appendChild(angles);

    /* THE ALL-ORDERS LIST — one clickable row per order, the record's own order.
       Each row navigates to the existing per-order detail via opts.onOpen (the
       board's interaction), so the explorer is a browse, not a second detail
       view. */
    var list = el(doc, "div", "view__rows", { "data-region": "orders-rows" });
    for (var i = 0; i < view.rows.length; i++) {
      var r = view.rows[i];
      var row = el(doc, "div", "row row--clickable", {
        role: "button", tabindex: "0",
        "data-order": String(r.order_id),
        "data-stage": r.stage_id,
        "data-count": String(r.count)
      });
      if (r.contact_id) row.setAttribute("data-contact", r.contact_id);
      if (!r.named) row.setAttribute("data-unknown", "1");

      var body = el(doc, "div", "row__body");
      body.appendChild(el(doc, "div", "row__title",
        { text: r.named ? r.customer : "customer unknown" }));
      var metaText = r.stage_label + "  \u00B7  " + r.count + (r.count === 1 ? " entry" : " entries");
      if (r.phone) metaText += "  \u00B7  " + r.phone;
      body.appendChild(el(doc, "div", "row__meta", { text: metaText }));
      row.appendChild(body);

      (function (orderId, rowEl) {
        function open() { if (typeof opts.onOpen === "function") opts.onOpen(orderId); }
        if (rowEl.addEventListener) {
          rowEl.addEventListener("click", open);
          rowEl.addEventListener("keydown", function (e) {
            if (e && (e.key === "Enter" || e.key === " ")) { if (e.preventDefault) e.preventDefault(); open(); }
          });
        }
        rowEl._open = open;
      })(r.order_id, row);

      list.appendChild(row);
    }
    pane.appendChild(list);
    return pane;
  }

  /* CHARTS — the pure fold (leg 19, §6-#4 ruling A). This Season's charts:
     ADDITIVE over the numeric season fold, never a rival to it. It reads the
     SAME seasonSummary the dashboard mounts, grouped by `week` — a GROUP_KEY
     that already existed — so a chart bar and the season total can never
     disagree: ONE arithmetic path, N consumers (the {post} 1 law the season
     surfaces are built on). It folds THREE ordered weekly series (orders,
     pounds, revenue-billed), each POINT carrying its OWN floor: `_finish` warns
     that a season can be complete while one week inside it is not, so a floored
     week is marked "at least" and never drawn as a confident bar. No new derive,
     no route, no I/O, no store, no cache (leg 07's refusals, still refused) —
     the leg-22/23 generator shape. `max` is a fold FACT (the series maximum),
     exported so the renderer can scale a bar without computing a total of its
     own. The starter set is deliberately three (the operator dials denser on
     his eye, §6-#4); adding a fourth series is one more `series(...)` row. */
  function seasonChartsView(orders) {
    orders = Array.isArray(orders) ? orders : [];
    var summary = null;
    try { summary = seasonSummary(orders, {}, "week"); } catch (e) { summary = null; }
    var order = (summary && Array.isArray(summary.groupOrder)) ? summary.groupOrder : [];
    var groups = (summary && summary.groups) || {};
    var total = (summary && typeof summary.totalOrders === "number") ? summary.totalOrders : 0;

    /* One series builder, three calls — the same discipline as the fold it
       reads: a chart never invents an arithmetic path of its own, it names
       which pre-folded figure a point shows and whether that figure is floored. */
    function series(id, label, unit, valueOf, flooredOf, noteOf, displayOf) {
      var points = [], max = 0;
      for (var i = 0; i < order.length; i++) {
        var key = order[i], g = groups[key];
        if (!g) continue;
        var v = valueOf(g);
        var num = (typeof v === "number" && isFinite(v)) ? v : null;
        if (num != null && num > max) max = num;
        var floored = !!flooredOf(g);
        points.push({
          key: key,
          label: _bucketLabel("week", key),   /* "Week of <date>", `undated` keeps its name */
          value: num,
          display: displayOf(g),
          floored: floored,
          note: floored ? noteOf(g) : null
        });
      }
      return { id: id, label: label, unit: unit, points: points, max: max };
    }

    var charts = [
      series("orders", "Orders per week", "orders",
        function (g) { return g.totalOrders == null ? 0 : g.totalOrders; },
        function () { return false; },                       /* an order count is exact — never floored */
        function () { return null; },
        function (g) { return String(g.totalOrders == null ? 0 : g.totalOrders); }),
      series("pounds", "Pounds per week", "lb",
        function (g) { return g.poundsLbs == null ? null : g.poundsLbs; },
        function (g) { return !!(g.floors && g.floors.pounds); },
        function (g) { return ((g.counts && g.counts.unweighed) || 0) + " not yet weighed"; },
        function (g) { return g.poundsLbs == null ? "\u2014" : (g.poundsLbs + " lb"); }),
      series("revenue", "Revenue per week (billed)", "$",
        function (g) { return g.billedTotalCents == null ? null : g.billedTotalCents; },
        function (g) { return !!(g.floors && g.floors.billed); },
        function (g) { return ((g.counts && g.counts.unpriced) || 0) + " not yet priced"; },
        function (g) { return formatDollars(g.billedTotalCents); })
    ];

    return {
      /* empty === no season to chart. Not a zero-bar chart — the
         badge-count-of-zero the season surfaces refuse (leg 06's asymmetry). */
      empty: total === 0 || order.length === 0,
      weeks: order.slice(),
      charts: charts,
      window: (summary && summary.window) || { from: null, to: null }
    };
  }

  /* CHARTS — the surface (leg 19). A text bar per week in the SAME Block
     alphabet the season surfaces speak (.pane / .view__list / .line /
     .line__label / .line__meta / .line__value / .line__note + the `data-floored`
     mark) — so it costs ZERO marginal CSS, the zero-new-grammar gate, and a
     floored week wears the exact mark `_lineEl` gives a floored season line.
     The bar is a glyph run scaled to the series `max` (a fold fact, never
     computed here); a floored week renders "at least" + the quiet gold-idiom
     note, never a confident bar. Over an empty season it SAYS so and draws
     nothing. Pure: it draws, holds no state, performs no I/O. */
  var CHART_BAR_CELLS = 18;                 /* the widest a bar gets — a starter dial */
  function _barGlyphs(value, max) {
    if (value == null || !(max > 0)) return "";
    var n = Math.round((value / max) * CHART_BAR_CELLS);
    if (n < 1 && value > 0) n = 1;          /* a nonzero week is never invisible */
    var s = "";
    for (var i = 0; i < n; i++) s += "\u2588";   /* full block */
    return s;
  }
  function renderSeasonCharts(doc, view, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    opts = opts || {};
    view = view || {};
    var pane = el(doc, "section", "pane pane--live", { "data-kind": "butcher-season-charts" });
    pane.appendChild(el(doc, "h2", "pane__title", { text: opts.title || "This season \u2014 charts" }));

    if (view.empty || !Array.isArray(view.charts) || !view.charts.length) {
      pane.appendChild(el(doc, "p", "pane__census",
        { text: "Charts appear once the season has orders on file." }));
      return pane;
    }

    for (var c = 0; c < view.charts.length; c++) {
      var chart = view.charts[c];
      var wrap = el(doc, "div", "view__list",
        { "data-region": "season-chart", "data-chart": chart.id });
      wrap.appendChild(el(doc, "div", "view__region-label", { text: chart.label }));
      var pts = Array.isArray(chart.points) ? chart.points : [];
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        var ln = el(doc, "div", "line", { "data-week": p.key });
        if (p.floored) ln.setAttribute("data-floored", "1");
        if (p.floored && p.note) ln.setAttribute("title", p.note);   /* mirrors _lineEl */
        ln.appendChild(el(doc, "span", "line__label", { text: p.label }));
        var bar = _barGlyphs(p.value, chart.max);
        if (bar) ln.appendChild(el(doc, "span", "line__meta", { text: bar }));
        ln.appendChild(el(doc, "span", "line__value",
          { text: (p.floored ? "at least " : "") + p.display }));
        if (p.floored && p.note) {
          ln.appendChild(el(doc, "span", "line__note", { text: p.note }));
        }
        wrap.appendChild(ln);
      }
      pane.appendChild(wrap);
    }
    return pane;
  }

  /* REPORTS — the pure fold (leg 22). The non-techy generator's manifest: the
     order count off the season fold + the ordered list of reports a shop can
     produce. It reads the SAME `seasonSummary` fold the season report itself
     mounts, so the headline Reports shows equals the report it opens (never a
     second opinion about the season's size). It folds NOTHING for the auditor
     packet — that surface's roll-up is the runtime's clock (I/O the host owns);
     Reports LINKS it, so its card is `available: true` regardless of the orders
     in hand (the T-4 rule: the cooler log is offered even over zero OPEN
     orders). The season-report card is `available: total > 0` — a report over
     zero orders is the badge-count-of-zero the season surfaces refuse. */
  function reportsView(orders) {
    orders = Array.isArray(orders) ? orders : [];
    var summary = null;
    try { summary = seasonSummary(orders, {}, null); } catch (e) { summary = null; }
    var total = (summary && typeof summary.totalOrders === "number")
      ? summary.totalOrders : orders.length;
    var customers = (summary && typeof summary.totalCustomers === "number")
      ? summary.totalCustomers : null;
    var reports = [
      {
        id: "season",
        label: "Season report",
        blurb: "the whole season on one page — orders, customers, weights, and money",
        headline: total === 1 ? "1 order" : total + " orders",
        detail: customers == null ? null
          : (customers === 1 ? "1 customer" : customers + " customers"),
        available: total > 0
      },
      {
        id: "auditor",
        label: "Auditor's packet",
        blurb: "the cooler log and the signed record, ready to hand an inspector",
        headline: "cooler log + signed chain",
        detail: null,
        available: true
      }
    ];
    return { total: total, reports: reports };
  }

  /* REPORTS — the surface (leg 22). The non-techy GENERATOR front door: a plain
     list of the reports a shop can produce, each one card, each card a door to
     the surface that already renders it. Spells the same Block alphabet the
     board / census / orders use (.pane / .row / .view__rows / .line) so it costs
     zero marginal CSS — the zero-new-grammar gate.

     CARD NAVIGATION reuses leg 21's exact interaction: an available card wires
     its click/keydown to `opts.onOpen(report_id)` — the renderer passes an
     `onOpen` that maps `season`→showSeasonReport and `auditor`→showCooler, the
     SAME host-owned-interaction seam Orders proved (now with a MULTI-TARGET
     map). NO new route, NO new socket, no I/O in the surface: it folds orders in
     hand for the season headline and attaches handlers to a callback the host
     owns (the renderOrders precedent — the surface is pure; the host owns the
     navigation and the cooler I/O).

     HONEST ASYMMETRY (law 3), specific to Reports: the pane is NOT blanked on an
     empty record. The season-report card reads honestly unavailable (no live
     control, a muted "no season yet" line), but the auditor packet stays a live
     door — hiding the cooler log in exactly the weeks an inspector asks for it
     would be the confusion the T-4 rule refuses. */
  function renderReports(doc, orders, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    opts = opts || {};
    var view = reportsView(orders);

    var pane = el(doc, "section", "pane pane--live", { "data-kind": "butcher-reports" });
    pane.appendChild(el(doc, "h2", "pane__title", { text: opts.title || "Reports" }));
    pane.appendChild(el(doc, "div", "record__meta",
      { text: view.total === 1 ? "1 order on file" : view.total + " orders on file" }));

    var list = el(doc, "div", "view__rows", { "data-region": "reports-rows" });
    for (var i = 0; i < view.reports.length; i++) {
      var rep = view.reports[i];
      var card = el(doc, "div", "row" + (rep.available ? " row--clickable" : ""),
        { "data-region": "report-card", "data-report": rep.id });
      if (rep.available) {
        card.setAttribute("role", "button");
        card.setAttribute("tabindex", "0");
      } else {
        card.setAttribute("data-unavailable", "1");
      }

      var body = el(doc, "div", "row__body");
      body.appendChild(el(doc, "div", "row__title", { text: rep.label }));
      var metaText = rep.headline + (rep.detail ? "  \u00B7  " + rep.detail : "");
      body.appendChild(el(doc, "div", "row__meta", { text: metaText }));
      body.appendChild(el(doc, "div", "line line--muted", { text: rep.blurb }));
      if (!rep.available) {
        body.appendChild(el(doc, "div", "line line--muted",
          { "data-region": "report-unavailable",
            text: "No season yet — ready once you have orders on file." }));
      }
      card.appendChild(body);

      if (rep.available) {
        (function (reportId, cardEl) {
          function open() { if (typeof opts.onOpen === "function") opts.onOpen(reportId); }
          if (cardEl.addEventListener) {
            cardEl.addEventListener("click", open);
            cardEl.addEventListener("keydown", function (e) {
              if (e && (e.key === "Enter" || e.key === " ")) { if (e.preventDefault) e.preventDefault(); open(); }
            });
          }
          cardEl._open = open;
        })(rep.id, card);
      }

      list.appendChild(card);
    }
    pane.appendChild(list);
    return pane;
  }

  /* AUDITOR'S VIEW — the generator it OWNS (leg 23, §6-#5 ruling A).

     The §6-#5 call — "does Auditor's View own its own generator or share
 Reports'?" — was ruled A : Auditor's View owns its own. So this
     fold lives HERE, beside the cooler face and the census it reads, not in
     reportsView. It is NOT reportsView: reportsView lists the DOORS a shop can
     open (a menu); auditorReport folds the ONE attestation headline an inspector
     reads — how big the file is, and whether the census could place every order
     in it. The two share zero code by design (the split, confirmed): a report
     for an inspector must not lean on a generator tuned for the operator's
     front door.

     PURE, like reportsView. It folds ONLY what is in hand — the season size off
     the SAME seasonSummary the season report mounts (never a second opinion),
     and the census's own placed / shown-but-not-placed assurance off censusView.
     It folds NOTHING for the cooler (that roll-up is the runtime's clock — I/O
     the host owns); the consolidation LINKS the cooler, so its door is
     `available: true` regardless of orders in hand (the T-4 rule reportsView
     also honors). */
  function auditorReport(orders) {
    orders = Array.isArray(orders) ? orders : [];
    var summary = null;
    try { summary = seasonSummary(orders, {}, null); } catch (e) { summary = null; }
    var total = (summary && typeof summary.totalOrders === "number")
      ? summary.totalOrders : orders.length;
    var customers = (summary && typeof summary.totalCustomers === "number")
      ? summary.totalCustomers : null;

    /* The census assurance — placed vs shown-but-not-placed. `unplaceable`
       carries at zero (the census's own rule): a residue count of zero is the
       inspector's assurance that nothing was hidden, not a number to omit. */
    var census = null;
    try { census = censusView(orders); } catch (e) { census = null; }
    var placed = (census && typeof census.placed === "number") ? census.placed : total;
    var unplaceable = (census && typeof census.unplaceable === "number") ? census.unplaceable : 0;

    /* The two doors the consolidation gathers. The signed record folds from the
       orders in hand (available only when there IS a record); the cooler log is
       a live door the host fetches, offered even over an empty record. */
    var sections = [
      {
        id: "census",
        label: "Signed record — every order on file",
        blurb: "the whole season, each order openable to its signed, append-only chain",
        headline: total === 1 ? "1 order on file" : total + " orders on file",
        detail: (unplaceable === 0
          ? "every order placed in a lane"
          : (unplaceable === 1 ? "1 order shown but not placed"
             : unplaceable + " orders shown but not placed")),
        available: total > 0
      },
      {
        id: "cooler",
        label: "Cooler temperature log",
        blurb: "every day of the temperature record, with the gaps named",
        headline: "cooler log",
        detail: null,
        available: true
      }
    ];

    return {
      total: total,
      customers: customers,
      placed: placed,
      unplaceable: unplaceable,
      sections: sections
    };
  }

  /* AUDITOR'S VIEW — the surface (leg 23). The CONSOLIDATION: the two auditor
     surfaces (the signed census and the cooler log) gathered behind one door,
     with the auditorReport headline read off the record at the top. Before this
     leg the two lived as two separate rail slots ("regrouped not consolidated",
     the rail-groups suite's own word); this leg fulfils the "Auditor's View"
     entry the 13-item rail always named, and the two surfaces now live BEHIND
     it. Neither underlying surface changes — renderSeasonCensus and
     renderCoolerLog are untouched; this is a landing page that reads the record
     and opens them.

     Spells the same Block alphabet as Reports (.pane / .row / .view__rows /
     .line) — zero marginal CSS. CARD NAVIGATION reuses the Reports/Orders seam
     exactly: an available section card wires click/keydown to
     `opts.onOpen(section_id)`; the host (showAuditor) maps `census`->showCensus
     and `cooler`->showCooler, the SAME host-owned-interaction seam, no new
     route, no I/O in the surface.

     HONEST ASYMMETRY (law 3), inherited from Reports: the pane is NOT blanked on
     an empty record. The signed-record card reads honestly unavailable (no live
     control, a muted line), but the cooler-log card stays a live door — hiding
     the cooler log in exactly the weeks an inspector asks for it is the
     confusion the T-4 rule refuses. */
  function renderAuditorView(doc, orders, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    opts = opts || {};
    var view = auditorReport(orders);

    var pane = el(doc, "section", "pane pane--live", { "data-kind": "butcher-auditor" });
    pane.appendChild(el(doc, "h2", "pane__title", { text: opts.title || "Auditor's View" }));

    /* The attestation headline — read off the record, never invented. Orders on
       file, customers, and the census's placed / residue assurance. */
    var metaText = (view.total === 1 ? "1 order on file" : view.total + " orders on file");
    if (view.customers != null) {
      metaText += "  \u00B7  " + (view.customers === 1 ? "1 customer" : view.customers + " customers");
    }
    metaText += "  \u00B7  " + (view.unplaceable === 0
      ? "all placed"
      : (view.unplaceable === 1 ? "1 shown but not placed"
         : view.unplaceable + " shown but not placed"));
    pane.appendChild(el(doc, "div", "record__meta", { text: metaText }));

    var list = el(doc, "div", "view__rows", { "data-region": "auditor-rows" });
    for (var i = 0; i < view.sections.length; i++) {
      var sec = view.sections[i];
      var card = el(doc, "div", "row" + (sec.available ? " row--clickable" : ""),
        { "data-region": "auditor-card", "data-section": sec.id });
      if (sec.available) {
        card.setAttribute("role", "button");
        card.setAttribute("tabindex", "0");
      } else {
        card.setAttribute("data-unavailable", "1");
      }

      var body = el(doc, "div", "row__body");
      body.appendChild(el(doc, "div", "row__title", { text: sec.label }));
      var mt = sec.headline + (sec.detail ? "  \u00B7  " + sec.detail : "");
      body.appendChild(el(doc, "div", "row__meta", { text: mt }));
      body.appendChild(el(doc, "div", "line line--muted", { text: sec.blurb }));
      if (!sec.available) {
        body.appendChild(el(doc, "div", "line line--muted",
          { "data-region": "auditor-unavailable",
            text: "No season yet — the signed record opens once you have orders on file." }));
      }
      card.appendChild(body);

      if (sec.available) {
        (function (sectionId, cardEl) {
          function open() { if (typeof opts.onOpen === "function") opts.onOpen(sectionId); }
          if (cardEl.addEventListener) {
            cardEl.addEventListener("click", open);
            cardEl.addEventListener("keydown", function (e) {
              if (e && (e.key === "Enter" || e.key === " ")) { if (e.preventDefault) e.preventDefault(); open(); }
            });
          }
          cardEl._open = open;
        })(sec.id, card);
      }

      list.appendChild(card);
    }
    pane.appendChild(list);
    return pane;
  }

  /* ======================================================================
     THE PORTER — Export / Import  (App-Face leg 25b, owed 887).

     Fills the `porter` rail stub. The way OUT and the way BACK IN for the
     signed record, wearing the Block alphabet (zero marginal CSS). Like every
     surface in this file it is PURE and does NO I/O: it COMPOSES the injected
     order-file module (`opts.orderFile` = forest/butcher/butcher-order-file.js)
     and hands the two acts that touch the world back through callbacks.

       • EXPORT has no wall. On click it composes serialize(exportOrders(db))
         and hands the text to opts.onExport(text, filename) — the HOST does the
         download (Blob I/O). The count is stated BEFORE the click (mail-export's
         honesty): you asked, it answered — never a surprise download.
       • IMPORT is PREVIEW + VERIFY ONLY, and says so LOUDLY. On preview it
         composes parse -> importPlan (which runs verifyEnvelope) over the pasted
         text and renders the integrity verdict + the ordered append plan. The
         LAND control is present, DISABLED, and states the write-wall: landing
         rides the deploy-gated, warrant-gated append path (opts.onImport),
         absent on an unarmed box — honest by construction, never a false button.
       • CONTACTS — export the customer list, same composition (exportContacts).
       • OCR backfill is a NAMED, DISABLED stub. OCR_BACKFILL is frozen
         enabled:false and ocrBackfill() throws E_STUB; the row says "a later
         leg" and never offers a live control. Flag, don't fake.

     THE COMPOSE SEAM (this leg's Crux-seam, the reason for the compose-spy
     test): every format act is a call THROUGH opts.orderFile, never a
     re-implementation. A byte-identical fallback would pass a render test while
     silently not verifying — so the test loads the REAL node module and asserts
     these functions are the ones called (handoff 01.2221 "For My Successor" #1).

     BROWSER REACH (honest, not faked): opts.orderFile is INJECTED by the host.
     butcher-order-file.js is node-only today, so the browser download is live
     the moment the host wires those pure fns onto window.ForestShell.orderFile —
     the surface + format are proven now (the compose-spy test), the browser
     attach is the go-live wiring step (owed, flagged in the handoff), the same
     posture butcher-rest.js carries ("testable now; the box wiring is next").

     Cold-safe: absent opts.orderFile -> an honest degraded pane that names the
     gap (never a throw, never a false green), exactly like renderStub. */
  function renderExportImport(doc, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    opts = opts || {};
    var OF = opts.orderFile || null;

    var pane = el(doc, "section", "pane pane--live", { "data-kind": "butcher-porter" });
    pane.appendChild(el(doc, "h2", "pane__title", { text: "Export / import" }));

    /* Cold-gate keyed on the IMPORT capability, NOT exportOrders (leg 25c). The
       pane is powered by parse -> importPlan (the pure verify half); the browser
       order-file mirror carries exactly those and DELIBERATELY omits exportOrders
       (db-bound). Keying the whole-pane cold-gate on exportOrders would kill the
       LIVE import-preview just because export can't reach a browser db — the
       state-lie this leg exists to avoid. Export is walled honestly below, at its
       own block, when exportOrders is absent. */
    var canPreview = OF && typeof OF.parse === "function" && typeof OF.importPlan === "function";
    if (!canPreview) {
      pane.appendChild(el(doc, "p", "pane__lede",
        { text: "The record's export/import isn't wired in this build yet \u2014 nothing here writes or fakes a verify." }));
      return pane;
    }

    pane.appendChild(el(doc, "p", "pane__lede",
      { text: "Take the whole record out as a file you can keep and open anywhere, or preview an order file before it lands." }));

    /* ---- EXPORT (no wall) --------------------------------------------------- */
    var exportGroup = el(doc, "div", "field-group", { "data-part": "export" });
    var exHead = el(doc, "div", "field-group__head", {});
    exHead.appendChild(el(doc, "span", "field-group__label", { text: "Export the record" }));
    exportGroup.appendChild(exHead);

    if (typeof OF.exportOrders !== "function") {
      /* Leg 25c gave this block an honest DEPLOY-WALL: the browser mirror omits
         exportOrders (db-bound), and there is no browser db, so export cannot run
         in the browser. The porter-export DEPLOY ARC wires it (this leg). The
         surface stays PURE — it does NO fetch: when the host supplies the box-export
         seam (opts.onExportFromBox — the renderer's GET /api/butcher/export ->
         download), present the LIVE button and hand the act back through it, exactly
         as onExport hands back the Blob download for the node path below. When the
         host has NOT wired the seam (an older renderer, or a pre-deploy build), fall
         back to the honest deploy-wall. The state-lie stays killed either way: a 503
         from an unprovisioned box is the HOST's to report honestly (honestNode), the
         surface only OFFERS the act and never fabricates a file or a false
         "nothing to export". */
      if (typeof opts.onExportFromBox === "function") {
        exportGroup.appendChild(el(doc, "p", "line line--muted",
          { text: "Take the whole signed record off the deployed box \u2014 the signed entries, verbatim." }));
        var boxExportBtn = el(doc, "button", "pane__connect butcher__export",
          { type: "button", "data-act": "export", text: "Export the record" });
        boxExportBtn.addEventListener("click", function () {
          if (boxExportBtn.disabled) return;
          opts.onExportFromBox();
        });
        exportGroup.appendChild(boxExportBtn);
      } else {
        /* THE HONEST DEPLOY-WALL — the read-side twin of import's write-wall, NOT
           "nothing to export". The record isn't empty (the entries live on the box);
           the host simply hasn't wired the box-export seam in this build. */
        exportGroup.appendChild(el(doc, "p", "line line--muted",
          { text: "Export reads the deployed box's signed record \u2014 it opens once the box is live. The record isn't empty; it just isn't reachable from the browser yet." }));
      }
    } else {
      var db = opts.db || null;
      // Count before the click: how many orders (non-reserved lanes) will export.
      var exportEnv = null, exportCount = 0, exportReserved = 0;
      try {
        exportEnv = OF.exportOrders(db, { shop: opts.shop || null });
        (exportEnv.orders || []).forEach(function (o) { if (o.reserved) exportReserved++; else exportCount++; });
      } catch (e) { exportEnv = null; }

      if (exportEnv && (exportCount + exportReserved) > 0) {
        exportGroup.appendChild(el(doc, "p", "line line--muted",
          { text: exportCount + " order" + (exportCount === 1 ? "" : "s") +
                  (exportReserved ? " (plus " + exportReserved + " reserved lane" + (exportReserved === 1 ? "" : "s") + ")" : "") +
                  " \u2014 the signed entries, verbatim." }));
        var exportBtn = el(doc, "button", "pane__connect butcher__export",
          { type: "button", "data-act": "export", text: "Export the record" });
        if (typeof opts.onExport !== "function") {
          exportBtn.disabled = true;
          exportGroup.appendChild(el(doc, "p", "line line--muted",
            { text: "Download isn't wired in this build." }));
        } else {
          exportBtn.addEventListener("click", function () {
            if (exportBtn.disabled) return;
            opts.onExport(OF.serialize(exportEnv), "deer-hill-record-" + isoStamp() + ".json");
          });
        }
        exportGroup.appendChild(exportBtn);
      } else {
        // db present but genuinely empty — this "nothing to export" is TRUE.
        exportGroup.appendChild(el(doc, "p", "line line--muted",
          { text: "No orders in the record yet \u2014 nothing to export." }));
      }
    }
    pane.appendChild(exportGroup);

    /* ---- IMPORT (preview + verify ONLY) ------------------------------------- */
    var importGroup = el(doc, "div", "field-group", { "data-part": "import" });
    var imHead = el(doc, "div", "field-group__head", {});
    imHead.appendChild(el(doc, "span", "field-group__label", { text: "Import an order file" }));
    importGroup.appendChild(imHead);
    importGroup.appendChild(el(doc, "p", "line line--muted",
      { text: "Choose an exported order file. This PREVIEWS and VERIFIES it \u2014 it never lands until the box is deployed and a Warrant is granted." }));

    /* THE PICKER (leg: file-import UX, operator finding). A labelled
       button opens the OS file dialog; a hidden file input carries the selection.
       No paste box \u2014 reading a saved .json back as text to paste is a chore the
       operator called out. Mirrors the calendar .ics import seam (calendar-renderer
       actionsICal): pick -> read -> run the pure verify path. The surface stays
       PURE: the file READ is the host's I/O, handed back through opts.onReadFile; a
       cold-safe FileReader fallback keeps the picker live in a browser even on a
       host that hasn't wired the seam. */
    var fileInput = el(doc, "input", "field__control butcher__import-file",
      { type: "file", accept: ".json,application/json", "data-input": "import-file",
        "aria-label": "Choose an exported order file" });
    if (fileInput.style) fileInput.style.display = "none";
    var pickBtn = el(doc, "button", "pane__connect butcher__import-pick",
      { type: "button", "data-act": "import-pick", text: "Choose an order file\u2026" });
    pickBtn.addEventListener("click", function () { if (!pickBtn.disabled) fileInput.click(); });
    importGroup.appendChild(pickBtn);
    importGroup.appendChild(fileInput);
    var pickedName = el(doc, "p", "line line--muted", { "data-part": "import-picked" });
    importGroup.appendChild(pickedName);

    var verdict = el(doc, "div", "record", { "data-part": "import-verdict" });
    importGroup.appendChild(verdict);

    /* THE PURE VERIFY CORE \u2014 parse -> importPlan -> honest verdict. Unchanged from
       the paste flow; only the INPUT method moved from a textarea to a file pick.
       A byte-identical fallback would pass a render check while silently NOT
       verifying, so it composes the injected module (OF.parse/importPlan) exactly. */
    function runVerify(text) {
      clearNode(verdict);
      if (!text || !String(text).trim()) {
        verdict.appendChild(el(doc, "p", "line line--muted", { text: "That file was empty \u2014 nothing to verify." }));
        return;
      }
      var env, plan;
      try { env = OF.parse(text); }
      catch (e) {
        // A malformed file is refused BY NAME, never silently coerced.
        verdict.appendChild(el(doc, "p", "record__title", { text: "This isn't a valid order file" }));
        verdict.appendChild(el(doc, "p", "line", { text: (e && e.message) || "E_PARSE" }));
        return;
      }
      try { plan = OF.importPlan(env, { verifyFn: opts.verifyFn || null }); }
      catch (e) {
        verdict.appendChild(el(doc, "p", "line", { text: (e && e.message) || "could not build the plan" }));
        return;
      }
      var integ = plan.integrity || { ok: false };
      // The honest verify state \u2014 never a false green.
      var badge = integ.ok
        ? el(doc, "span", "badge",
            { text: integ.signatures_checked ? "verified \u2014 signatures checked" : "verified \u2014 integrity holds" })
        : el(doc, "span", "badge badge--overdue", { text: "BROKEN \u2014 do not land" });
      var title = el(doc, "p", "record__title", {});
      title.appendChild(el(doc, "span", null, { text: "Order file \u2014 " }));
      title.appendChild(badge);
      verdict.appendChild(title);

      verdict.appendChild(el(doc, "p", "line",
        { text: plan.counts.orders + " order" + (plan.counts.orders === 1 ? "" : "s") +
                (plan.counts.reserved_lanes ? " (plus " + plan.counts.reserved_lanes + " reserved lane" +
                  (plan.counts.reserved_lanes === 1 ? "" : "s") + ")" : "") +
                ", " + plan.counts.entries + " signed entr" + (plan.counts.entries === 1 ? "y" : "ies") + " to append." }));

      // If broken, name the first problem \u2014 never hide it.
      if (!integ.ok) {
        var firstBad = (integ.orders || []).filter(function (o) { return !o.ok; })[0];
        if (firstBad && firstBad.problems && firstBad.problems.length) {
          verdict.appendChild(el(doc, "p", "line line--muted",
            { text: firstBad.order_id + ": " + firstBad.problems[0] }));
        }
      }

      // THE WRITE-WALL, stated at the act. Land is present, disabled, and says why.
      var land = el(doc, "button", "pane__connect butcher__import-land",
        { type: "button", "data-act": "import-land", text: "Land these entries" });
      land.disabled = true;
      verdict.appendChild(land);
      var landable = (typeof opts.onImport === "function") && integ.ok;
      verdict.appendChild(el(doc, "p", "line line--muted",
        { text: landable
            ? "Landing rides the Warrant path \u2014 armed only on the deployed box."
            : "Preview only. Landing needs the deployed box and a granted Warrant." }));
      if (landable) {
        land.disabled = false;
        land.addEventListener("click", function () {
          if (land.disabled) return;
          land.disabled = true;   // one intent, one land (the E1 latch)
          opts.onImport(plan);
        });
      }
    }

    /* Reading the picked file is host I/O: prefer opts.onReadFile (the host owns the
       FileReader \u2014 the pure path); fall back to a browser FileReader so the picker
       stays live on an unwired host; if neither is reachable, say so honestly \u2014
       never fake a verdict. onReadFile may return a string (sync) OR a Promise. */
    function readErr() {
      clearNode(verdict);
      verdict.appendChild(el(doc, "p", "line line--muted",
        { text: "Couldn't read that file in this build." }));
    }
    function readPicked(file) {
      if (typeof opts.onReadFile === "function") {
        var r;
        try { r = opts.onReadFile(file); } catch (e) { readErr(); return; }
        if (r && typeof r.then === "function") { r.then(runVerify, readErr); return; }
        runVerify(r); return;
      }
      var FR = (doc.defaultView && doc.defaultView.FileReader) ||
               (typeof FileReader !== "undefined" ? FileReader : null);
      if (!FR) { readErr(); return; }
      var reader = new FR();
      reader.onload = function () { runVerify(String(reader.result || "")); };
      reader.onerror = readErr;
      try { reader.readAsText(file); } catch (e) { readErr(); }
    }

    fileInput.addEventListener("change", function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      clearNode(pickedName);
      pickedName.appendChild(el(doc, "span", null, { text: (f.name || "order file") }));
      readPicked(f);
      try { fileInput.value = ""; } catch (e) {}   // allow re-picking the same file
    });
    pane.appendChild(importGroup);

    /* ---- CONTACTS ----------------------------------------------------------- */
    if (typeof OF.exportContacts === "function") {
      var cGroup = el(doc, "div", "field-group", { "data-part": "contacts" });
      var cHead = el(doc, "div", "field-group__head", {});
      cHead.appendChild(el(doc, "span", "field-group__label", { text: "Contacts (CSV)" }));
      cGroup.appendChild(cHead);
      cGroup.appendChild(el(doc, "p", "line line--muted",
        { text: "Export your customers so orders resolve against real contacts when you import elsewhere." }));
      var contacts = opts.contacts || [];
      var cBtn = el(doc, "button", "chip butcher__contacts-export",
        { type: "button", "data-act": "contacts-export", text: "Export contacts" });
      if (!contacts.length || typeof opts.onExport !== "function") {
        cBtn.disabled = true;
        cGroup.appendChild(el(doc, "p", "line line--muted",
          { text: contacts.length ? "Download isn't wired in this build." : "No contacts yet." }));
      } else {
        cBtn.addEventListener("click", function () {
          if (cBtn.disabled) return;
          opts.onExport(OF.exportContacts(contacts), "deer-hill-contacts-" + isoStamp() + ".csv");
        });
      }
      cGroup.appendChild(cBtn);
      pane.appendChild(cGroup);
    }

    /* ---- OCR backfill — a NAMED, DISABLED stub (flag, don't fake) ------------ */
    var ocrGroup = el(doc, "div", "field-group field-group--example", { "data-part": "ocr" });
    var ocrHead = el(doc, "div", "field-group__head", {});
    ocrHead.appendChild(el(doc, "span", "field-group__label", { text: "Photo backfill" }));
    ocrHead.appendChild(el(doc, "span", "badge badge--example", { text: "a later leg" }));
    ocrGroup.appendChild(ocrHead);
    ocrGroup.appendChild(el(doc, "p", "line line--muted",
      { text: "Reading old paper orders from a photo is a future leg \u2014 there's no button because it isn't built." }));
    var ocrBtn = el(doc, "button", "chip", { type: "button", "data-act": "ocr", text: "Backfill from a photo" });
    ocrBtn.disabled = true;
    ocrGroup.appendChild(ocrBtn);
    pane.appendChild(ocrGroup);

    return pane;
  }

  // Small local helpers for the porter (no new grammar).
  function isoStamp() {
    try { return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19); }
    catch (e) { return "export"; }
  }
  function clearNode(node) { if (node) while (node.firstChild) node.removeChild(node.firstChild); }

  /* ---- export --------------------------------------------------------------- */
  root.butcher = {
    renderExportImport: renderExportImport,
    // E9, leg 12 — the worker dashboard (the SURFACE half of the Role Seam).
    // A role-shaped VIEW over a role-blind write path. Not a permission.
    WORKER_ROLES: WORKER_ROLES,
    WORKER_ROLE_IDS: WORKER_ROLE_IDS,
    workerRole: workerRole,
    workerView: workerView,
    renderWorkerDashboard: renderWorkerDashboard,
    // E8, leg 11 — the census (Diane's view). A census may not drop.
    censusView: censusView,
    chainLines: chainLines,
    renderSeasonCensus: renderSeasonCensus,
    CENSUS_RESIDUE: CENSUS_RESIDUE,
    // Leg 17 — Customers (the first stub-fill). A pure fold over orders in hand
    // (customersView) painted Contacts-shaped (renderCustomers); the notes half
    // is a separate beat.
    customersView: customersView,
    renderCustomers: renderCustomers,
    // Leg 17 beat 2 — the pure notes builder the renderer injects into the
    // customer-notes socket (Contacts notes primitive, read model).
    renderCustomerNotes: renderCustomerNotes,
    // Leg 21 — Orders (the all-orders explorer). A pure fold over orders in hand
    // (ordersView) painted as an angles strip over a flat clickable list
    // (renderOrders); rows navigate via opts.onOpen (the board's showOrder).
    ordersView: ordersView,
    renderOrders: renderOrders,
    // Leg 22 — Reports (the generator). A pure fold over orders in hand for the
    // season-report headline (reportsView) painted as a list of report cards
    // (renderReports); cards navigate via opts.onOpen (host maps season ->
    // showSeasonReport, auditor -> showCooler). Links existing surfaces; no new
    // route, no report format, no I/O in the surface.
    reportsView: reportsView,
    renderReports: renderReports,
    // Leg 19 — This Season charts (§6-#4 ruling A). Pure fold off the SAME
    // seasonSummary the dashboard mounts, grouped by week; three weekly series
    // (orders/pounds/revenue-billed), floored per week. Additive, no new route.
    seasonChartsView: seasonChartsView,
    renderSeasonCharts: renderSeasonCharts,
    // Leg 23 — Auditor's View consolidation (§6-#5 ruling A: owns its own
    // generator). auditorReport folds the ONE attestation headline; the surface
    // gathers the signed census + the cooler log behind one door.
    auditorReport: auditorReport,
    renderAuditorView: renderAuditorView,
    renderSign: renderSign,
    renderPlaceAffirm: renderPlaceAffirm,   // seq156 — the post-open place-affirm affordance
    renderSettings: renderSettings,   // leg 26 / — first Forest Settings Pattern instance
    renderOpening: renderOpening,
    markInto: markInto,
    renderSeasonGlance: renderSeasonGlance,
    renderSeasonDashboard: renderSeasonDashboard,
    renderSeasonReport: renderSeasonReport,
    seasonsPresent: seasonsPresent,
    renderSeasonsArchive: renderSeasonsArchive,
    GLANCE_LINE_IDS: GLANCE_LINE_IDS,
    renderIntake: renderIntake,
    renderTempReading: renderTempReading,   // T-2, the cooler log's write face
    // T-4, the cooler log's READ face — the auditor's day-shaped view. A fold,
    // never a filter: every day in the span emits, including the missed ones.
    renderCoolerLog: renderCoolerLog,
    renderBoard: renderBoard,
    renderOrder: renderOrder,
    // pure helpers (exported for the host wiring + tests)
    orderView: orderView,
    // Leg 18 foundation — the time-in-stage dwell derive (pure; reads orderView's
    // one arithmetic path; clock is a param; does NOT alarm — thresholds are §6-#3).
    timeInStage: timeInStage,
    // Leg 18 surface — the alarm level logic (pure; numbers all from config) and
    // the LOUD placeholder default. Rick's real per-stage numbers are a config
    // edit (§6-#3), no rebuild; the surface marks a placeholder as un-authoritative.
    dwellAlarm: dwellAlarm,
    STAGE_DWELL_DEFAULT: STAGE_DWELL_DEFAULT,
    noteFold: noteFold,
    noteChip: noteChip,
    detailEncode: detailEncode,
    detailParse: detailParse,
    stageForEvent: stageForEvent,
    nextStage: nextStage,
    STAGES: STAGES,
    EXCEPTION_STAGES: EXCEPTION_STAGES,
    BOARD_GROUP_KEYS: BOARD_GROUP_KEYS,
    boardGroupsFor: boardGroupsFor,
    exceptionStage: exceptionStage,
    isTerminalException: isTerminalException,
    ALL_LANES: ALL_LANES,
    resumeStage: resumeStage,
    // E1 SECONDARY — the off-line move (the door INTO the exception lanes) and
    // the note seam it consumes. Derived from STAGES + EXCEPTION_STAGES.
    offLineOptions: offLineOptions,
    offLineControl: offLineControl,
    // E5a item 4 — the scale read (lane classification, derived not listed)
    isRestingLane: isRestingLane,
    ACTIVE_LANES: ACTIVE_LANES,
    RESTING_LANES: RESTING_LANES,
    // E5a item 5 — search (a substring compare, never a query language)
    matchKind: matchKind,
    filterViews: filterViews,
    // E2, the Correction — the fold + its encoder (exported for the host wiring + tests)
    foldCorrections: foldCorrections,
    correctionEncode: correctionEncode,
    isCorrection: isCorrection,
    // E3a, the Weight — the client half of the seam + the non-line declaration
    WEIGH: WEIGH,
    NON_LINE_EVENTS: NON_LINE_EVENTS,
    /* Leg 09 — exported so the suite can assert the membership from OUTSIDE this
       closure (the drift this leg found is only catchable from outside) and so a
       later per-order artifact consumes the SAME line producers the pane does. */
    WEATHER_AT_INTAKE: WEATHER_AT_INTAKE,
    isWeatherAtIntake: isWeatherAtIntake,
    readWeather: readWeather,
    weatherLines: weatherLines,
    weatherCitation: weatherCitation,
    isWeigh: isWeigh,
    isNonLineEvent: isNonLineEvent,
    toMilliLbs: toMilliLbs,
    fromMilliLbs: fromMilliLbs,
    weighEncode: weighEncode,
    COOLER_ZONES: COOLER_ZONES,
    coolerEncode: coolerEncode,
    effectiveWeight: effectiveWeight,
    // E3b, the Money — the EDGE only; the arithmetic is server-side, in cents
    centsToDollars: centsToDollars,
    formatDollars: formatDollars,
    // E3c, the Payment Gate — money as a signed non-line event, the derived
    // read over it, and the one control that writes it. Nothing here blocks.
    PAYMENT: PAYMENT, REFUND: REFUND,
    PAYMENT_METHODS: PAYMENT_METHODS, PAYMENT_FORS: PAYMENT_FORS,
    isPayment: isPayment, isRefund: isRefund, isMoney: isMoney,
    parseCents: parseCents, dollarsToCents: dollarsToCents,
    paymentEncode: paymentEncode, refundEncode: refundEncode, moneyParse: moneyParse,
    moneyFold: moneyFold, moneyLabel: moneyLabel,
    unpaidChip: unpaidChip, moneyControl: moneyControl,
    // E4, the Call — the telling as a non-line event, the told/not-told read, and
    // the widened Weave edge. "Handed off" is the only claim; never "delivered".
    TOLD: TOLD,
    TELL_SKIPPED: TELL_SKIPPED,
    isTold: isTold,
    isTellSkipped: isTellSkipped,
    tellingEncode: tellingEncode,
    skipEncode: skipEncode,
    tellStatus: tellStatus,
    SKIP_LABELS: SKIP_LABELS,
    skipLabel: skipLabel,
    emitCompose: emitCompose,
    claimableTelling: claimableTelling,
    tellStateChip: tellStateChip,
    tellControl: tellControl,
    // E5b, leg 07 — the contact join (Contacts is canonical; the chain keeps a
    // MARKED derivative) and the season fold (pure, no store, no cache).
    CONTACT_ID_KEY: CONTACT_ID_KEY,
    CONTACT_HASH_KEY: CONTACT_HASH_KEY,
    contactCanonical: contactCanonical,
    contactHash: contactHash,
    contactIdOf: contactIdOf,
    contactRef: contactRef,
    contactState: contactState,
    contactStateLabel: contactStateLabel,
    seasonSummary: seasonSummary,
    GROUP_KEYS: GROUP_KEYS,
    summaryLines: summaryLines,
    anomalyLines: anomalyLines,
    _version: "1.48"
  };
})();
