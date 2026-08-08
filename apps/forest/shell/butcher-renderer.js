/* Shea's Forest — the App Shell · shell/butcher-renderer.js
   Butcher Forest · the renderer + the callback wiring (the browser leg's joint).

   Self-registers the "butcher" kind with window.ForestShell.pane and OWNS the
   pane's inner DOM for it. It holds NO domain logic and NO DOM of its own beyond
   navigation chrome — the three PURE surfaces (window.ForestShell.butcher:
   renderIntake / renderBoard / renderOrder) draw everything; this module only
   (1) fetches via window.ForestShell.butcherRest and (2) hands each surface its
   callbacks. board -> glance -> intake navigate INSIDE the one pane (like
   contacts list -> record). The surfaces stay pure, the client stays thin, and
   THIS is the only place the two meet.

   The four wirings (the go-live contract, from the Chunk-D handoff's "For My
   Successor"):
     • renderBoard  onOpen(order_id)  -> api.order()  -> renderOrder
     • renderOrder  onStamp(order_id) -> api.stamp()  -> browser download
     • renderIntake onIntake(payload) -> api.intake() -> back to board
     • the payload is renderIntake's payload VERBATIM — already record-ready.

   Honest read (F3): a 401 (the keyless case) / network drop never renders as a
   real board or a real order — it renders a reached-nothing node, never a fake
   green. The Stamp guard STAYS as the surface built it: disabled on a KNOWN-broken
   verify, deliberately ENABLED on unverified/absent (the exported HTML self-
   verifies offline; the artifact is the authority, not the pane). Do NOT "fix"
   that into a false-safety block.

   Depends on: window.ForestShell.block.el (the atom), .butcher (the surfaces),
   .butcherRest (the client), .pane (the registry). Must load AFTER pane.js,
   block.js, butcher-surfaces.js, butcher-rest.js. Cold-safe: any absent dep ->
   the pane renders a calm honest node, never throws.

   OPTIONAL dep: .contactsRest — the Order->Person join (E5b leg 07). It is
   optional on purpose. Absent, the join renders `unresolved` (the attested
   snapshot, MARKED), which is a TRUE state the surface already draws; it is
   not a degradation to invent around. See withContact() below.

   The module name is `butcherRenderer` and it carries `_version` — the app-kind
   convention pinned by version-stamp-derived.test.js (kind "butcher" ->
   window.ForestShell.butcherRenderer). Plain script, no ES module. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  function el(doc, tag, cls, attrs) {
    // Prefer the shared atom; degrade to a minimal shim so a missing block.js
    // never throws (cold-safe — the pane still paints an honest node).
    if (root.block && typeof root.block.el === "function") return root.block.el(doc, tag, cls, attrs);
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (attrs && attrs.text != null) n.textContent = attrs.text;
    return n;
  }

  // An honest reached-nothing node — used on 401 / unreachable / absent-dep.
  // NEVER a fabricated board or order (Real-or-Made at the read).
  /* `act` is "read" (default) or "write". IT CHANGES THE VERB, NOTHING ELSE.
     Fault (1) of owed butcher-renderer-discards-legible-403: the operator
     submitted an order, the append was REFUSED, and the pane said "Couldn't
     LOAD your order". Nothing was being loaded. The wrong verb sends the reader
     hunting through network and fetch when the actual answer is authority — it
     costs a debugging session and points away from the fix. Every existing call
     site omits the argument and keeps its exact wording; the write paths pass
     "write". */
  function honestNode(doc, envelope, what, act) {
    var wrap = el(doc, "div", "pane__connect butcher__unreached");
    var status = envelope && envelope.status;
    var code = envelope && envelope.code;
    var writing = (act === "write");
    var msg;
    /* E_NO_BENCH is taught HERE rather than in a second note builder, so every
     * failure path that already paints an honest node picks it up for free —
     * the advance, the correction, the intake, all five call sites. A second
     * builder is how the two sides drift (the leg-09 NON_LINE_EVENTS ruling,
     * applied again). */
    if (code === "E_NO_BENCH") {
      msg = "No one is at the bench — choose a name in the rail first. " +
            "The record signs who did the work, and a signed entry cannot be edited afterward.";
    }
    else if (status === 401) {
      msg = writing
        ? "Signed out — " + what + " was not saved. Reconnect and try again."
        : "Signed out — reconnect to see " + what + ".";
    }
    else if (!status) msg = "Couldn't reach the runtime — " + what + " is unavailable.";
    else {
      /* THE SERVER'S OWN REASON, WHEN IT SENT ONE (owed
         butcher-renderer-discards-legible-403).
         This branch used to be `"Couldn't load " + what + " (" + status + ")"` and
         nothing else, which THREW AWAY a reason the runtime had already written
         for a human. The live case that made it matter: the first real
         temperature 403s with

           error: "the shop is open but UNARMED: no Warrant grant 'shop'
                   covers a butcher 'cooler_reading' append, so nothing was
                   written — issue …"
           code:  "E_NO_WARRANT_GRANT"   shop_state: "open-unarmed"

         — a refusal that names the kind, the missing grant key and the fix, and
         Rick was shown "(403)". A pane that has been told exactly what is wrong
         and says nothing is worse than a pane that never asked: it converts a
         legible, actionable refusal into a dead end, and the operator then
         debugs the UI instead of arming the grant.

         THE DISCIPLINE, so this does not become a fabrication surface:
           · Render the server's string ONLY when it actually sent one. There is
             no invented explanation and no code-to-prose table here — a table
             would be a second copy of the runtime's wording, free to drift from
             it and to keep asserting a reason after the server changed its mind.
           · The generic line stays as the fallback for a body with no `error`.
           · The status is ALWAYS kept, appended in parentheses. It is what makes
             the note actionable for whoever reads the runtime log next, and it
             is the one fact the client is certain of. */
      var reason = envelope && envelope.data && typeof envelope.data.error === "string"
        ? envelope.data.error.trim() : "";
      msg = reason
        ? reason + " (" + status + ")"
        : (writing ? "The shop refused " + what + " (" + status + ")."
                   : "Couldn't load " + what + " (" + status + ").");
    }
    wrap.appendChild(el(doc, "p", "line", { text: msg }));
    /* The machine-readable code rides ALONGSIDE the prose, never instead of it —
       it is what the operator quotes into a search or a runbook. Absent code,
       absent chip: no placeholder, no "unknown". */
    if (code) wrap.appendChild(el(doc, "p", "line butcher__unreached-code", { text: String(code) }));
    return wrap;
  }

  /* THE ACCEPT, MADE AS LEGIBLE AS THE DENY (owed 98).
     T-2's stated ethic was "the deny is legible, never silent." It delivered
     exactly that — honestNode above — and left the ACCEPT silent: the ok-branch
     of a cooler reading was `closePane(); showBoard();` and nothing else, and
     `__cooler__` is a RESERVED lane the board filters out, so the reading left
     no mark anywhere a person could see. A signed chain entry and a lost one
     looked identical at the gauge. That inverts the trust the legibility work
     was for: the failure path is the one you are told about, and the success
     path is the one you have to take on faith.
     It is not hypothetical. On 2026-07-28 Christine recorded two real
     temperatures twelve minutes apart (seq 40: 32F, Cutting room; seq 41: 23F)
     and got no confirmation for either one. She was doing her job blind.

     WHAT THIS NODE MAY AND MAY NOT SAY — the ruling (a) fence, inherited.
     butcher-temp-pane.test.js grades that NO VERIFICATION VOCABULARY appears on
     this surface: no "verified", no "signed by". That fence is right and it
     binds here too. The client did not verify anything — it cannot; it has no
     key and did not walk the chain. What it HAS is the server's own receipt for
     the append it just made, so this node reports exactly that and claims
     nothing beyond it:
       · the reading, as the person typed it (from the pane's own view object —
         never re-decoded from payload.detail, which would be a second copy of
         the detail grammar);
       · the entry the server said it wrote (`seq`, `entry_hash`), rendered ONLY
         when the server actually sent them — absent-not-empty, exactly as the
         honest-node's code chip works. No placeholder, no "unknown", and no
         invented id.
     "Recorded" is a report of what the runtime answered. "Verified" would be a
     claim this surface cannot back — the Real-or-Made line at the write. */
  function receiptNode(doc, reading, envelope) {
    var wrap = el(doc, "div", "pane__connect butcher__recorded");
    var r = reading || {};
    var where = r.cooler ? ", " + r.cooler : "";
    var who = r.actor ? ", by " + r.actor : "";
    var what = (r.value != null && String(r.value) !== "")
      ? String(r.value) + "\u00B0" + (r.unit === "C" ? "C" : "F")
      : "that reading";
    wrap.appendChild(el(doc, "p", "line",
      { text: "Recorded \u2014 " + what + where + who + "." }));
    /* The entry id rides ALONGSIDE the prose, never instead of it — it is the
       one thing a person can quote to an auditor, and it is what makes this a
       receipt rather than a reassurance. Absent server fields, absent chip. */
    var data = envelope && envelope.data;
    var seq = data && data.seq != null ? String(data.seq) : "";
    var hash = data && typeof data.entry_hash === "string" ? data.entry_hash.slice(0, 8) : "";
    if (seq || hash) {
      wrap.appendChild(el(doc, "p", "line butcher__recorded-id",
        { text: (seq ? "entry #" + seq : "entry") + (hash ? " \u00B7 " + hash : "") }));
    }
    try { wrap.style.borderLeft = "3px solid var(--gold, #C9A84C)"; } catch (e) {}
    return wrap;
  }

  /* Two notes, one slot. paintBoard takes a single `note`, and after a good
     write whose board fetch then FAILS the person needs both facts — the
     reading landed AND the board could not be loaded. Dropping either one is a
     lie by omission, so they stack rather than compete. */
  function notes(doc, a, b) {
    if (!a) return b || null;
    if (!b) return a;
    var f = doc.createDocumentFragment();
    f.appendChild(a);
    f.appendChild(b);
    return f;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  // Trigger a browser download of the self-contained Stamp HTML. Blob + object
  // URL, no network — the export is already offline-verifiable.
  function downloadStamp(doc, orderId, html) {
    try {
      var blob = new Blob([html], { type: "text/html" });
      var url = (root.URL || window.URL).createObjectURL(blob);
      var a = el(doc, "a", null, {});
      a.href = url;
      a.download = "butcher-order-" + String(orderId).replace(/[^a-zA-Z0-9_-]/g, "_") + ".html";
      (doc.body || doc.documentElement).appendChild(a);
      a.click();
      a.parentNode && a.parentNode.removeChild(a);
      setTimeout(function () { try { (root.URL || window.URL).revokeObjectURL(url); } catch (e) {} }, 0);
      return true;
    } catch (e) { return false; }
  }

  // Trigger a browser download of arbitrary text (the order-file / contacts CSV
  // export). Same Blob + object-URL path as downloadStamp, generalized over
  // filename + mime — no network, the bytes are offline-verifiable.
  function downloadText(doc, text, filename, mime) {
    try {
      var blob = new Blob([String(text == null ? "" : text)], { type: mime || "application/octet-stream" });
      var url = (root.URL || window.URL).createObjectURL(blob);
      var a = el(doc, "a", null, {});
      a.href = url;
      a.download = String(filename || "export").replace(/[^a-zA-Z0-9_.-]/g, "_");
      (doc.body || doc.documentElement).appendChild(a);
      a.click();
      a.parentNode && a.parentNode.removeChild(a);
      setTimeout(function () { try { (root.URL || window.URL).revokeObjectURL(url); } catch (e) {} }, 0);
      return true;
    } catch (e) { return false; }
  }

  /* The renderer. paneEl is the pane the joint hands us; ctx carries capability/
     kind/label/config. We own paneEl's inner DOM and manage board<->glance<->intake
     navigation inside it. */
  function render(paneEl, ctx) {
    var doc = paneEl.ownerDocument || document;
    var surfaces = root.butcher;
    var rest = root.butcherRest;

    // Cold-safe: without the surfaces or the client we cannot render honestly.
    if (!surfaces || !rest || typeof rest.makeClient !== "function") {
      clear(paneEl);
      paneEl.appendChild(honestNode(doc, { status: 0 }, "Butcher Forest"));
      return;
    }
    var api = rest.makeClient();

    /* E5b (leg 07) — THE HOST HALF OF THE CONTACT JOIN. (owed 1238)

       butcher-surfaces has carried this join since leg 07 and it is PURE: it
       "never fetches, never merges and never resolves". contactState(order)
       reads `order.contact` — THE HOST'S ALREADY-FETCHED RECORD — and renders
       one of four states. The host never handed it one. So every order carrying
       a contact_id rendered `unresolved` forever: a built dock with no boat.
       This is that boat, and nothing more. No new state, no new route, no
       merge, no cache — the surface's contract is unchanged and unwidened.

       Two-Place is the whole reason this is a READ-TIME join: Contacts is
       canonical, the chain keeps a signed derivative, and no foreign key spans
       the two SQLite stores. So a contact_id CAN dangle, and the only honest
       answers are the four the surface already draws.

       COLD-SAFE BY CONSTRUCTION, and this is load-bearing rather than defensive:
       no contactsRest on the shell -> no client -> `order.contact` is never set
       -> the surface renders `unresolved` -> the SNAPSHOT, MARKED. Identical for
       a 404, a 401, a dead network or an unparseable body. The one thing this
       must never do is fabricate a current name, and it structurally cannot: it
       only ever passes through what /api/contacts/<id> actually returned. */
    var contactsApi = (root.contactsRest && typeof root.contactsRest.makeClient === "function")
      ? root.contactsRest.makeClient()
      : null;

    /* Resolve an order's Person and hand the record back ON the order.

       ALWAYS RESOLVES, NEVER REJECTS. A contact we cannot read must not stop an
       order from rendering — the order is the butcher's work; the customer
       record is context on it. A throw here would take the whole glance down to
       protect a line of text. */
    function withContact(order) {
      var ref = (order && typeof surfaces.contactRef === "function")
        ? surfaces.contactRef(order.entries) : null;
      var id = ref && ref.contact_id;
      if (!id || !contactsApi) return Promise.resolve(order);
      return contactsApi.get(id).then(function (env) {
        // The same unwrap the contacts pane uses (contacts-renderer.js :554).
        // Anything else falls through untouched -> `unresolved`.
        if (env && env.ok && env.data) order.contact = env.data.contact || env.data;
        return order;
      }).catch(function () { return order; });
    }

    /* ==== SL-1 · GENESIS OPENS A PANE (the-shape-law-register-v1 §4) ==========
     *
     * WHAT THIS REPLACED, and why the old shape was invisible to the law.
     * `mount()` used to be `clear(paneEl); paneEl.appendChild(node)` — a real
     * host-wipe of the mount parent, calendar's exact pre-SL-1 bug. It graded
     * UNRULED rather than BREACH for two reasons, and BOTH were accidents of
     * spelling rather than of conformance: the wipe wore a LOCAL name (`clear`,
     * not `clearNode`/`textContent=""`), and the append into `paneEl` lived one
     * hop away inside this helper instead of in the genesis body the checker
     * reads. An extractor's silence is not evidence of conformance — the cruise
     * says so in its own docstring, and it was right to refuse to call it a pass.
     *
     * The fix is CONFORM, not widen (`_tools/cruise/test_indirection.py` carries
     * the standing "when the next idiom shows up, do not widen" warning). So the
     * mount parent is split in two, exactly as mail's conforming compose does it:
     *
     *   paneEl
     *     └─ .butcher__collection   the COLLECTION. `mount()` clears only this,
     *     └─ .butcher-form-overlay  and a genesis/detail pane floats HERE, as a
     *                               sibling, appended straight into paneEl.
     *
     * `mount()` now empties a node this module BUILT (the collection host), never
     * the inherited parent — which is the same distinction that keeps mail's
     * `clearNode(overlay)` from grading as a breach. The collection stays mounted
     * and interactive beneath every pane. */
    var collectionHost = null;

    function collection() {
      if (collectionHost && collectionHost.parentNode === paneEl) return collectionHost;
      collectionHost = el(doc, "div", "butcher__collection");
      paneEl.appendChild(collectionHost);
      return collectionHost;
    }

    function mount(node) {
      var host = collection();
      clear(host);
      host.appendChild(node);
    }

    // Dismiss the live pane. Removes the overlay from paneEl — it never empties
    // paneEl, so the collection beneath is untouched by construction.
    function closePane() {
      var live = paneEl.querySelector ? paneEl.querySelector(".butcher-form-overlay") : null;
      if (live && live.parentNode) live.parentNode.removeChild(live);
    }

    /* SL-3 — a pane carries a top-× dismiss AND keeps its cancel. The × is the
     * universal dismiss affordance the law exempts; the surface's own Cancel is
     * left alone. This is the head strip that replaces `‹ Back to board`: under
     * SL-1 there is no back button, because you never left the board. */
    function paneHead(title) {
      var head = el(doc, "div", "butcher-pane__head");
      head.appendChild(el(doc, "span", "butcher-pane__title", { text: title }));
      // ZERO NEW GRAMMAR, and the cruise caught me inventing some. `record__dismiss`
      // and `record__action--quiet` are the Forest's OWN dismiss/cancel classes,
      // already styled in block.css and already what SL-3 grades on. A bespoke
      // `butcher-pane__dismiss` graded BREACH for exactly the right reason: a
      // dismiss the shared vocabulary does not recognise is a dismiss the person's
      // hand does not recognise either.
      var x = el(doc, "button", "record__dismiss", {
        text: "\u00D7", "aria-label": "Close " + title
      });
      x.type = "button";
      x.addEventListener("click", closePane);
      head.appendChild(x);
      return head;
    }

    // The pane's Cancel — SL-3 clause (b): the top-× is ADDED, the cancel is KEPT.
    function paneCancel(doc2, label) {
      var cancel = el(doc2, "button", "record__action record__action--quiet",
        { text: label || "Cancel" });
      cancel.type = "button";
      cancel.addEventListener("click", closePane);
      return cancel;
    }

    // A thin nav strip prepended to a surface (back / new-order affordances that
    // the pure surfaces intentionally do not own).
    function chrome(doc2, buttons) {
      var strip = el(doc2, "div", "butcher__nav pane__connect");
      buttons.forEach(function (b) {
        var btn = el(doc2, "button", "butcher__nav-btn", { text: b.label });
        btn.type = "button";
        btn.addEventListener("click", b.onClick);
        strip.appendChild(btn);
      });
      return strip;
    }

    /* ==== THE RAIL ( §7.2 · the menu half of the view) ==================
     *
     * WHY THIS EXISTS, and it is the whole shape of the operator's finding:
     * `pane.js` hands EVERY app a VIEW = {pane, menu} and offers the app its
     * left column as `ctx.menuBody`. Mail fills it (`.rail__compose` "Compose"),
     * calendar fills it ("Create"), contacts fills it. **Butcher ignored it.**
     * So Butcher's left column rendered as the joint's anchor over a third of a
     * screen of empty white, and Butcher's own verbs had nowhere to live except
     * a horizontal pill strip shoved into the top of the work pane — the one
     * app in the Forest not wearing the Forest's own information architecture.
     *
     * That is not a styling defect and no stylesheet could have reached it. It
     * is why two skin passes both landed and both still looked wrong: they were
     * repainting a structure that was missing its left half. `.rail`,
     * `.rail__compose`, `.rail__search` and `.rail__slot` have existed and been
     * styled in `block.css` the entire time.
     *
     * ZERO NEW GRAMMAR — every class here already exists and already reaches
     * (design-plan v2 §5 Fork 1: the posture is CONFORM, answered by the probe).
     *
     * Do · Find · Dwell, top to bottom (the calendar/contacts order):
     *   New order   -> `.rail__compose`  the one thing Rick came to DO
     *   search      -> `.rail__search`   how he FINDS a specific order
     *   the views   -> `.rail__slot`     where he LIVES
     *
     * COLD-SAFE: a frame with no menu host -> ctx.menuBody is null -> every
     * function here is a no-op and the pane renders exactly as it did before. */

    function menuBody() {
      return (ctx && ctx.menuBody && typeof ctx.menuBody.appendChild === "function")
        ? ctx.menuBody : null;
    }

    /* ==== THE STUBS ( §3 — the unbuilt destinations, honestly) =========
     *
     * The six rail items that have no surface yet. Each renders a NAMED empty
     * pane that says what it will be — never a dead button, never real data
     * behind a TODO (the runbook's stub rule). Each is one leg's fill against a
     * known seam (legs 20–26). The `coming` line IS the promise; keeping it
     * beside the label is what makes the stub honest rather than a placeholder.
     *
     * `porter` is Export / Import — named for the act, not the file, and its
 * OCR-backfill is explicitly a later leg ( §5 leg 25), not this stub. */
    var STUBS = {
      "archive":   { label: "Seasons archive",
        coming: "pick a past season and re-run this year's views against it" },
      "customers": { label: "Customers",
        coming: "each customer's order history and your marketing notes, in one place" },
      "orders":    { label: "Orders",
        coming: "browse and search every order across the whole record" },
      "reports":   { label: "Reports",
        coming: "generate a season report and the auditor's packet" },
      "porter":    { label: "Export / import",
        coming: "export the record and import contacts or an order file (photo backfill is a later leg)" },
      "settings":  { label: "Settings",
        coming: "settings for this shop" }
    };

    /* Build a stub's pane. Spells in the Block alphabet only (`.pane`,
     * `.record`, `.record__title`, `.line line--muted`) so it costs zero
     * marginal CSS — the zero-new-grammar gate, inherited from the parent design
     * language. It is deliberately calm: a title, and one honest line about what
     * is coming. Cold-safe: an unknown slug renders a generic, still-honest pane
     * rather than throwing. */
    function renderStub(doc2, slug) {
      var s = STUBS[slug] || { label: "Coming soon", coming: "this part of the app isn't built yet" };
      var pane = el(doc2, "section", "pane pane--live", { "data-kind": "butcher-stub", "data-stub": slug });
      var card = el(doc2, "div", "record record--sign", { "data-region": "stub" });
      card.appendChild(el(doc2, "span", "record__title", { text: s.label }));
      card.appendChild(el(doc2, "p", "line line--muted", { text: "Coming: " + s.coming + "." }));
      pane.appendChild(card);
      return pane;
    }

    // Click + Enter/Space, the `.rail__slot` vocabulary (role=button + tabindex=0
    // on a div is a real control only if it answers the keyboard too).
    function activate(node, fn) {
      node.addEventListener("click", fn);
      node.addEventListener("keydown", function (ev) {
        var key = ev && ev.key;
        if (key === "Enter" || key === " " || key === "Spacebar") {
          if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
          fn();
        }
      });
    }

    // The live `.rail__search` host, re-parented into each freshly-built rail so
    // renderBoard can hand the surface somewhere to put its own field.
    var railSearchHost = null;

    // The live `.rail__group` host — the GROUP slot, same seam as the search
    // host above and for the same reason: renderBoard keeps the one
    // implementation of its own control and the rail only says WHERE it goes.
    // Do · Find · Dwell puts it under Find: search narrows what is shown,
    // grouping arranges what search left.
    var railGroupHost = null;

    // The last board this pane actually painted. The rail's view slots are gated
    // on it (a season/census/shift slot over zero orders is a heading over
    // nothing), and a sub-view that does not carry the board — intake — still
    // needs the same gate, so it reads the last known truth rather than guessing.
    // Never fabricated: null until a real board lands, and null gates everything
    // but "Order board" off.
    var lastOrders = null;

    /* Leg 26 — the Settings surface  edits THIS: the dwell config the
       Order Board reads to level each order (leg 18). It holds ONLY what Rick
       typed — persist-clean, so the deploy-owed Soil write (Thread 3) never
       stores a placeholder/example number (WATCH #1). The board's DISPLAY config
       is a paint-time merge (`boardDwellConfig` below), never stored, so an
       untouched stage keeps its clearly-marked EXAMPLE (leg 18's cold display)
       and no example number can leak to persist. null until Rick sets his first
       number — and null lets the board fall back to its own LOUD placeholder
       default (renderBoard: `opts.dwellConfig || STAGE_DWELL_DEFAULT`). */
    var dwellConfig = null;

    /* Build the rail for a given board state.
     *
     * `orders` gates the view slots exactly as the old strip gated its buttons —
     * a season glance / census / shift view over zero orders is a heading over
     * nothing, which is the badge-count-of-zero the season surfaces refuse. The
     * gate is UNCHANGED; only its address moved.
     *
     * `activeId` marks where Rick is with WEIGHT, never a colour alarm
 * ( §3.4) — `.rail__slot--active` + aria-current, exactly one. */
    function paintRail(orders, activeId) {
      var host = menuBody();
      if (!host) return null;
      while (host.firstChild) host.removeChild(host.firstChild);

      var nav = el(doc, "nav", "rail", { "aria-label": "Butcher" });

      // THE PRIMARY ACTION. "New order" — the same rail-top home, the same
      // vocabulary and the same weight as Compose / Create / New contact. This
      // is the operator's named ask and it is one class, not a new form.
      var compose = el(doc, "div", "rail__compose", {
        role: "button", tabindex: "0", text: "New order",
        "aria-label": "Open a new order"
      });
      activate(compose, function () { showIntake(); });
      nav.appendChild(compose);

      /* T-2 — "New Temp Reading button below New Order, same size/style"
         (design §6 leg 2, the operator's words). Same `.rail__compose` class,
         so it is literally the same control language and inherits every
         contrast fix that slot has already earned (tokens.css:82, app.css:470)
         — a bespoke button here would be a second styling vocabulary for a
         second primary act, which is the divergence the styling law watches for.
         Guarded on the surface existing so an older butcher-surfaces.js cannot
         paint a control that leads nowhere (cold-safe, the renderSeasonCensus
         precedent two blocks down). */
      if (typeof surfaces.renderTempReading === "function") {
        var temp = el(doc, "div", "rail__compose", {
          role: "button", tabindex: "0", text: "New temp reading",
          "aria-label": "Record a cooler temperature reading"
        });
        activate(temp, function () { showTempReading(); });
        nav.appendChild(temp);
      }

      // THE FIND SLOT. Built empty here; renderBoard parents its own live field
      // into it (opts.searchHost), so the filter keeps its one implementation.
      railSearchHost = el(doc, "div", "rail__search");
      nav.appendChild(railSearchHost);

      railGroupHost = el(doc, "div", "rail__group", { "data-rail-group": "butcher-grouping" });
      nav.appendChild(railGroupHost);

      /* ==== THE VIEWS — regrouped to §3 (leg 16, decision A) ==========
       *
       * REGROUP, NOT CONSOLIDATE. Every shipped slot below keeps its exact id,
       * label, route and GATE — the six paintRail call-sites still light their
       * slot and the existing rail tests stay green (that is the regression bar
       * the leg carries). What changes is arrangement: the operational views are
       * placed into §3's three `.rail__group` sections in the operator's stated
       * order, and the six genuinely-unbuilt destinations join them as labeled
       * stubs. The two Auditor's-View surfaces (Cooler log + Season census) sit
       * TOGETHER in the records group as its members; folding them behind one
       * "Auditor's View" label is the consolidation, and that is leg 23 — not
       * this leg (per the runbook's regroup map).
       *
       * ZERO NEW GRAMMAR: `.rail__group` is the calendar rail's own section
       * wrapper (`data-rail-group`), `.rail__slot`/`.rail__slot-label` the slot
       * vocabulary, and the stub pane spells in `.pane`/`.record`/`.line`. No
       * section LABEL is invented — the operator grouped by divider, not by name;
       * naming the sections is a later presentation call, not a leg-16 decision. */

      // One rail slot — a real route to a built surface OR a labeled stub. `match`
      // decides which activeId lights it (a slot may own more than one surface).
      function railSlot(spec) {
        var on = spec.match ? spec.match(activeId) : (activeId === spec.id);
        var slot = el(doc, "div", "rail__slot" + (on ? " rail__slot--active" : ""), {
          role: "button", tabindex: "0", "data-slot": spec.id, "aria-label": spec.label
        });
        if (on) slot.setAttribute("aria-current", "true");
        slot.appendChild(el(doc, "span", "rail__slot-label", { text: spec.label }));
        activate(slot, spec.go);
        return slot;
      }

      // The six genuinely-unbuilt destinations. A stub is a NAMED empty pane that
      // says what it will be — never a dead button, never real data behind a TODO.
      // The `coming` line is the honest promise, kept next to the label so leg 17+
      // fills each against a known seam. `data-slot="stub:<slug>"` keeps stubs off
      // the built-surface activeId namespace, so an activeId never lights a stub.
      function stubSlot(slug) {
        var s = STUBS[slug];
        return railSlot({
          id: "stub:" + slug, label: s.label,
          go: function () { showStub(slug); }
        });
      }

      // A section is a `.rail__group`; an empty section (every member gated off)
      // is NEVER appended, so the rail never shows a heading over nothing.
      function section(dataName, build) {
        var g = el(doc, "div", "rail__group", { "data-rail-group": dataName });
        build(g);
        if (g.firstChild) nav.appendChild(g);
      }

      // §3 §2 — the work. My Shift / This Season keep their orders-gate (a season
      // heading over zero orders is the badge-count-of-zero the season surfaces
      // refuse); Order Board is ungated (it is the home, and its own empty-board
      // branch is the honest cold-start). Seasons Archive is a stub.
      section("butcher-work", function (g) {
        if (orders && orders.length && typeof surfaces.renderWorkerDashboard === "function") {
          g.appendChild(railSlot({ id: "shift", label: "My shift",
            go: function () { showWorker(orders, null); } }));
        }
        g.appendChild(railSlot({ id: "board", label: "Order board",
          go: function () { showBoard(); } }));
        if (orders && orders.length) {
          g.appendChild(railSlot({ id: "season", label: "This season",
            go: function () { showSeason(orders); } }));
        }
        /* Leg 27 — the sixth (and last) stub-fill: `archive` is a real surface
           now (Seasons Archive). Promote when the surface exists AND there are
           orders to partition; picking a season re-runs the season dashboard
           windowed to it (box-independent: it folds only the seasons already in
           the loaded record; older history is the deploy arc, walled honestly in
           the surface). Cold-safe: an older surfaces build with no
           renderSeasonsArchive, or an empty board -> the honest stub, never a
           dead slot (the customers/orders/reports precedent). */
        if (orders && orders.length && typeof surfaces.renderSeasonsArchive === "function") {
          g.appendChild(railSlot({ id: "archive", label: STUBS.archive.label,
            go: function () { showArchive(lastOrders); } }));
        } else {
          g.appendChild(stubSlot("archive"));
        }
      });

      // §3 §3 — records & reporting. Auditor's View's two shipped surfaces live
      // here as members: the Cooler log is gated on the SURFACE existing and on
      // nothing else (a live cooler chain over zero OPEN orders is the ordinary
      // cold-start state, and gating it on orders would hide the temperature log
      // in exactly the weeks an inspector asks for it — the T-4 rule, preserved);
      // the Season census keeps its orders-gate. Consolidating the two behind one
      // "Auditor's View" entry is leg 23.
      section("butcher-records", function (g) {
        /* Leg 17 — the first stub-fill: `customers` is a real surface now. The
           slot keeps its exact id/label; only its destination changed from a
           named stub to renderCustomers. Cold-safe: if the loaded surfaces build
           has no renderCustomers (an older client), fall back to the honest stub
           rather than a dead button — the same surface-existence guard the Temp
           and Census slots carry. `lastOrders` (read at click) is the last real
           board, so Customers folds the whole known record regardless of which
           sub-view is active — the showStub precedent. */
        if (typeof surfaces.renderCustomers === "function") {
          g.appendChild(railSlot({ id: "customers", label: STUBS.customers.label,
            go: function () { showCustomers(lastOrders); } }));
        } else {
          g.appendChild(stubSlot("customers"));
        }
        /* Leg 21 — the second stub-fill: `orders` is a real surface now (the
           all-orders explorer). Same guard as `customers`: if the loaded
           surfaces build has no renderOrders (an older client), fall back to the
           honest stub rather than a dead button. `lastOrders` (read at click) is
           the last real board, so Orders folds the whole known record. */
        if (typeof surfaces.renderOrders === "function") {
          g.appendChild(railSlot({ id: "orders", label: STUBS.orders.label,
            go: function () { showOrders(lastOrders); } }));
        } else {
          g.appendChild(stubSlot("orders"));
        }
        /* Leg 22 — the third stub-fill: `reports` is a real surface now (the
           non-techy generator). Same guard as `customers`/`orders`: if the
           loaded surfaces build has no renderReports (an older client), fall
           back to the honest stub rather than a dead button. `lastOrders` (read
           at click) is the last real board, so Reports folds the whole known
           record for its season-report headline. */
        if (typeof surfaces.renderReports === "function") {
          g.appendChild(railSlot({ id: "reports", label: STUBS.reports.label,
            go: function () { showReports(lastOrders); } }));
        } else {
          g.appendChild(stubSlot("reports"));
        }
        /* Leg 23 — THE CONSOLIDATION (§6-#5 ruling A). The two Auditor's-View
           surfaces that used to sit here as two separate slots (Cooler log +
           Season census, "regrouped not consolidated") now live BEHIND one
           "Auditor's View" entry — the 13-item rail's own named item, finally
           filled. The consolidation reads the record for its attestation
           headline and opens both surfaces through showAuditor's onOpen map. The
           underlying surfaces are untouched: showCooler and showCensus still
           mount renderCoolerLog / renderSeasonCensus exactly as before; only the
           door changed. Guarded on renderAuditorView existing (an older surfaces
           build) — and in that case fall back to the two standalone slots rather
           than losing the auditor's surfaces entirely (the honest-degradation
           rule: never hide the cooler log from an inspector). */
        if (typeof surfaces.renderAuditorView === "function") {
          g.appendChild(railSlot({ id: "auditor", label: "Auditor's View",
            go: function () { showAuditor(); } }));
        } else {
          // Cold-safe: an older surfaces build with no consolidation. Keep the
          // two surfaces reachable as their own slots rather than a dead entry.
          if (typeof surfaces.renderCoolerLog === "function") {
            g.appendChild(railSlot({ id: "cooler", label: "Cooler log",
              go: function () { showCooler(); } }));
          }
          if (orders && orders.length && typeof surfaces.renderSeasonCensus === "function") {
            g.appendChild(railSlot({ id: "census", label: "Season census",
              go: function () { showCensus(orders); } }));
          }
        }
      });

      // §3 §4 — setup.
      section("butcher-setup", function (g) {
        /* Leg 25c — the fifth stub-fill: `porter` (Export / Import). Promote when
           the surface fn exists AND the order-file module is wired to the browser
           with its IMPORT capability (parse + importPlan). NOT keyed on
           exportOrders: the browser mirror (butcher-order-file.js) DELIBERATELY
           omits exportOrders (db-bound), so keying on it would keep the slot dark
           forever even though the live import-preview is fully reachable. The pane
           is powered by the import half; export is walled honestly inside the
           surface. Cold-safe: no mirror attached -> the honest stub, exactly as
           before (owed: butcher-porter-orderfile-browser-attach). */
        if (typeof surfaces.renderExportImport === "function" &&
            root.orderFile && typeof root.orderFile.parse === "function" &&
            typeof root.orderFile.importPlan === "function") {
          g.appendChild(railSlot({ id: "porter", label: STUBS.porter.label,
            go: function () { showPorter(); } }));
        } else {
          g.appendChild(stubSlot("porter"));
        }
        /* Leg 26 — the fourth stub-fill: `settings` is a real surface now (the
 Forest Settings Pattern's first instance, ). Same guard as
           customers/orders/reports: if the loaded surfaces build has no
           renderSettings (an older client), fall back to the honest stub rather
           than a dead button. Settings edits the dwell config the Order Board
           reads (leg 18); the client-side re-level ships now, the runtime persist
           is deploy-gated (Thread 3). */
        if (typeof surfaces.renderSettings === "function") {
          g.appendChild(railSlot({ id: "settings", label: STUBS.settings.label,
            go: function () { showSettings(); } }));
        } else {
          g.appendChild(stubSlot("settings"));
        }
      });

      // WHO, at the foot of the rail — below the views, out of the way of the
      // work, but always on screen because every write is signed with it.
      nav.appendChild(benchControl(doc));

      host.appendChild(nav);
      return railSearchHost;
    }

    /* ==== THE ACTOR SEAM (owed 531) =========================================
     *
     * THE FAULT: `ctx.config.actor` was READ at exactly one site and SET at zero
     * sites repo-wide, so the `|| "Shea"` fallback always fired and every signed
     * entry in an append-only, cryptographically-signed record claimed Shea did
     * the work. It cannot be edited later, only SUPERSEDED — so the cost was not
     * fixed, it accrued every shift Rick and Christine worked.
     *
     * WHAT THIS IS, AND WHAT IT IS DELIBERATELY NOT. This is the smallest thing
     * that stops the record lying: a per-browser choice from a named roster,
     * written into the seam that already exists. It is NOT an identity
     * architecture — there is no authentication here, and this proves nothing
     * cryptographically. `signer_pubkey` is already per-entry, so the real
     * second identity axis is untouched and still open for the leg that decides
     * what a worker IS. Everything here is supersedable by a real sign-in.
     *
     * The roster is CONFIG-FIRST (`ctx.config.workers`) with the operator's own
     * named default — his note 6, verbatim: "Rick and Christine to start". */
    var WORKERS_DEFAULT = ["Rick", "Christine"];
    var ACTOR_KEY = "forest.butcher.actor";

    function workers() {
      var w = ctx && ctx.config && ctx.config.workers;
      return (w && w.length) ? w : WORKERS_DEFAULT;
    }

    function storedActor() {
      try { return window.localStorage.getItem(ACTOR_KEY); } catch (e) { return null; }
    }

    function setActor(name) {
      if (!ctx) return;
      ctx.config = ctx.config || {};
      ctx.config.actor = name;
      try { window.localStorage.setItem(ACTOR_KEY, name); } catch (e) {}
    }

    // Boot: a previously-chosen bench survives a reload. Never invents a name —
    // an empty store leaves the seam exactly as it was.
    (function () {
      var saved = storedActor();
      if (saved && workers().indexOf(saved) !== -1) setActor(saved);
    })();

    /* The actor recorded on every write this pane makes — or NOTHING.
     *
     * The `|| "Shea"` fallback that stood here is deleted (leg 2, owed 531's
     * second half). Leg 1 fed this seam; it did not close it. The bench control
     * refused to PRE-SELECT a worker, but nothing refused the WRITE — so a shift
     * worked without touching the picker signed every entry under the operator's
     * own name, permanently, in a chain where the only remedy is a superseding
     * correction. Worse, the record could not distinguish "Shea did this" from
     * "nobody chose": one string carried both meanings.
     *
     * Returning null is not a degradation. `appendEntry` has refused an
     * actor-less entry since it was written; this simply stops manufacturing a
     * value to get past a guard that was already right. Absent is representable;
     * "unattributed" would be a permanent token asserting a claim, and the chain
     * does not need a word for the entry it declined to write. */
    function actorOf() {
      var a = ctx && ctx.config && ctx.config.actor;
      if (a == null) return null;
      a = String(a).trim();
      return a.length ? a : null;
    }

    /* The rail's bench control — Do · Find · Dwell, and this is WHO. Rendered in
     * the rail's own `.rail__slot` vocabulary so it costs zero new grammar. */
    function benchControl(doc2) {
      var wrap = el(doc2, "div", "rail__bench");
      wrap.appendChild(el(doc2, "span", "rail__bench-label", { text: "At the bench" }));
      var sel = el(doc2, "select", "rail__bench-pick", { "aria-label": "Who is at this bench" });
      var current = actorOf();
      workers().forEach(function (name) {
        var opt = el(doc2, "option", null, { text: name });
        opt.value = name;
        if (name === current) opt.selected = true;
        sel.appendChild(opt);
      });
      // A bench with no stored choice must not silently claim the first worker.
      if (!storedActor()) {
        var none = el(doc2, "option", null, { text: "\u2014 choose \u2014" });
        none.value = "";
        none.selected = true;
        sel.insertBefore(none, sel.firstChild);
      }
      sel.addEventListener("change", function () {
        if (!sel.value) return;
        setActor(sel.value);
      });
      wrap.appendChild(sel);
      return wrap;
    }

    /* E1, the Advance — the host half of the affordance.

       The surface hands us an INTENT (order_id + the computed next event token);
       we append it and then RE-READ. That ordering is standing law 4 made
       mechanical: nothing here sets a stage, and the lane moves only because the
       Record moved first. On failure we repaint the SAME data we already had —
       so "the row does not move" is not a rollback we have to get right, it is
       the absence of an action. The honest note says so out loud rather than
       failing silently and leaving Rick to notice the order sat still. */
    // Session latch: has this pane ever seen the LIVE record? Set by a board read
    // that returned orders, and by any append that landed. Read only by showBoard,
    // to keep the labeled SAMPLE from ever re-appearing over real work. It is a
    // one-way latch on purpose — nothing clears it.
    var sawLive = false;

    /* THE NOTE SEAM (owed butcher-advance-carries-no-note-seam). `detail` is the
       Record's free-text column and the SAME slot appendEntry has always signed —
       no server change, no new verb, no new route. Absent-not-empty: a move with
       no note sends no `detail` key at all rather than an empty string, so a
       noteless advance is byte-identical to every advance already signed. */
    function doAdvance(orderId, eventKind, detail, onLanded, onFailed) {
      /* Refused HERE, before the round trip. The server would refuse it too
       * (appendEntry E_MALFORMED), but a 500-shaped answer to "who are you"
       * is not an answer Rick can act on — and the trip is wasted either way. */
      var who = actorOf();
      if (!who) { onFailed({ ok: false, code: "E_NO_BENCH" }); return; }
      var payload = { order_id: orderId, event: eventKind, actor: who };
      if (detail != null && String(detail).length) payload.detail = String(detail);
      api.event(payload)
        .then(function (res) {
          if (res && res.ok) { sawLive = true; onLanded(); return; }   // re-read; the view follows the Record
          onFailed(res);
        });
    }

    /* E2, the Correction — the host half, and deliberately the SAME shape as
       doAdvance above: append, then RE-READ. A correction is an ordinary signed
       append; there is no delete call to make and no state to unwind. The surface
       already built the record-ready payload (supersedes/reason/event encoded into
       detail), so we send it verbatim — no translation, the intake precedent.
       The runtime resolves `supersedes` BEFORE it signs, so a refusal (a target in
       another order, an entry already corrected) never half-writes: the failure
       path repaints the data we already had, and nothing moved. */
    function doCorrect(payload, onLanded, onFailed) {
      // Same refusal as doAdvance. A correction is an ordinary signed append and
      // needs an author exactly as much as the entry it supersedes does.
      if (!actorOf()) { onFailed({ ok: false, code: "E_NO_BENCH" }); return; }
      api.correct(payload)
        .then(function (res) {
          if (res && res.ok) { sawLive = true; onLanded(); return; }
          onFailed(res);
        });
    }

    // paint <- the pure surface; show <- fetch then paint. Kept apart so the
    // failure path can repaint without a round trip (and without inventing data).
    function paintBoard(orders, note) {
      var frag = doc.createDocumentFragment();
      if (note) frag.appendChild(note);

      // seq156: the dismissible place-affirm strip rides ABOVE the board when the
      // open shop has no place set (weather-dark). A placed shop arms nothing.
      var pStrip = placeAffirmStrip();
      if (pStrip) frag.appendChild(pStrip);

      /* THE VERBS MOVED TO THE RAIL. `+ New order`, `This season`,
         `Season census` and `My shift` were a horizontal `.butcher__nav` pill
         strip across the top of the WORK pane — four controls competing with
         the work for the first thing Rick's eye lands on, in the one app whose
         left column was empty. They are the rail's slots now (paintRail above);
         the gates on each one are carried across unchanged. The pane holds the
         work and nothing else, which is parent §5's whole sentence: the pane
         faces the WORK, never the worker. */
      lastOrders = orders || [];
      var searchHost = paintRail(orders, "board");

      /* owed 759, the board half. The glance rides ABOVE the lanes because it is
         the answer to the question Rick asks before he reads a single row. It is
         withheld on an empty board on purpose: a glance over zero orders is three
         zeroes, which is the badge-count the season surfaces already refuse. */
      var summary = orders && orders.length ? seasonOf(orders) : null;
      if (summary) {
        frag.appendChild(surfaces.renderSeasonGlance(doc, summary, {
          onOpen: function () { showSeason(orders); }
        }));
      }
      frag.appendChild(surfaces.renderBoard(doc, orders, {
        searchHost: searchHost,
        groupHost: railGroupHost,
        // Leg 26 — the live dwell config Rick set in Settings . The board
        // reads it at build (leg 18) and levels each order to his real numbers,
        // no rebuild. null until he sets one -> renderBoard's own placeholder
        // default -> the display is unchanged from before the wire.
        dwellConfig: boardDwellConfig(),
        onOpen: showOrder,
        onAdvance: function (orderId, kind, detail) {
          doAdvance(orderId, kind, detail, showBoard, function (res) {
            paintBoard(orders, honestNode(doc, res, "that advance \u2014 the order has NOT moved", "write"));
          });
        }
      }));
      mount(frag);
    }

    function showBoard(receipt) {
      api.board().then(function (res) {
        var ok = !!(res && res.ok);
        var orders = (ok && res.data && res.data.orders) || [];

        // THE SAMPLE IS A COLD-START AFFORDANCE, NOT A FALLBACK (Real-or-Made).
        // Once this session has seen the live Record — an order returned, or an
        // advance landed — the sample must never appear again. The old branch
        // collapsed THREE different worlds into one `orders.length === 0`:
        //   (a) never connected      -> the sample is honest, show it
        //   (b) fetch FAILED         -> showing sample orders is a lie
        //   (c) genuinely empty now  -> the board is empty; say so
        // (b) and (c) after a successful signed append put SAMPLE orders on
        // Rick's screen one beat after he moved a REAL one. Split them.
        /* THE RECEIPT RIDES EVERY BRANCH, and the empty-board branch is the one
           that matters most. A shop with a live cooler chain and no OPEN orders
           lands on `showDemoBoard()` — so routing the receipt only through the
           orders.length path would have dropped it in exactly Rick and
           Christine's cold-start case, which is the case owed 98 was found in.
           Four branches, four hand-offs; none of them may swallow it. */
        if (orders.length) { sawLive = true; paintBoard(orders, receipt || null); return; }
        if (!ok) {
          paintBoard([], notes(doc, receipt, honestNode(doc, res, "the order board")));
          return;
        }
        if (sawLive) { paintBoard([], receipt || null); return; }
        showDemoBoard(receipt);
      });
    }

    /* ---- DEMO fallback (labeled sample; never presented as live) --------------
       DELIBERATELY carries NO onAdvance, so the sample offers no Advance button.
       Both alternatives are lies: wiring it to api.event() would write a real
       signed entry against a fake order_id, and mutating the demo's own data
       would move a lane without a record behind it — standing law 4 inverted, and
       it would teach the wrong model of how the app works. The sample's job is to
       show the SHAPE of the list; a write is not a shape. */
    function demoBanner(doc2) {
      var b = el(doc2, "div", "pane__connect butcher__demo-banner",
        { text: "Sample orders — a preview of the Butcher app. Real orders replace these once the record is connected." });
      try { b.style.borderLeft = "3px solid var(--gold, #C9A84C)"; b.style.opacity = "0.9"; } catch (e) {}
      return b;
    }
    function showDemoBoard(receipt) {
      var demo = root.butcherDemo;
      if (!demo || !demo.orders) {
        mount(notes(doc, receipt, honestNode(doc, { status: 0 }, "the order board")));
        return;
      }
      /* THE RAIL RIDES THE COLD-START TOO (leg 16). The sample board is the
         FIRST-RUN view — the state Rick and Christine actually open the app in
         before a single real order lands — and it was the one rendered state
         that left `ctx.menuBody` empty, which is exactly the empty-left-column
         fault this whole rail exists to fix. Painting it here from the sample's
         own orders makes the app's shape (the grouped views + the stubs) visible
         from the very first screen, not only after the first real order. It is
         painted from `demo.orders` so the gated views demonstrate their shape on
         the sample; nothing here is presented as live (the banner + the sample's
         no-Advance contract stand). */
      lastOrders = demo.orders || [];
      paintRail(demo.orders, "board");

      var frag = doc.createDocumentFragment();
      /* The receipt sits ABOVE the sample banner on purpose: what just happened
         to this person's own reading outranks an explanation of the preview. */
      if (receipt) frag.appendChild(receipt);
      // seq156: a freshly-opened, place-less shop meets the affirm strip on the
      // cold-start too — the natural onboarding moment to set the shop's place.
      var pStrip = placeAffirmStrip();
      if (pStrip) frag.appendChild(pStrip);
      frag.appendChild(demoBanner(doc));
      frag.appendChild(chrome(doc, [{ label: "+ New order", onClick: showIntake }]));
      frag.appendChild(surfaces.renderBoard(doc, demo.orders, { onOpen: showDemoOrder }));
      mount(frag);
    }
    function showDemoOrder(orderId) {
      var demo = root.butcherDemo;
      var o = demo && demo.byId ? demo.byId[orderId] : null;
      if (!o) { showDemoBoard(); return; }
      closePane();
      var overlay = el(doc, "div", "butcher-form-overlay butcher-form-overlay--order");
      overlay.appendChild(demoBanner(doc));
      overlay.appendChild(paneHead("Order " + (o.order_id || "")));
      overlay.appendChild(surfaces.renderOrder(doc, o, { onStamp: doDemoStamp }));
      paneEl.appendChild(overlay);
    }
    function doDemoStamp(orderId) {
      var demo = root.butcherDemo;
      var o = demo && demo.byId ? demo.byId[orderId] : null;
      if (o && typeof demo.sampleStampHtml === "function") downloadStamp(doc, orderId, demo.sampleStampHtml(o));
    }

    /* NOTE 2 — "the order in question should be in a new pane, not taking over
       the main pane … not unlike an email." Same overlay as genesis: the board
       stays mounted and readable beneath, so Rick can see the lane he just moved
       a deer out of while he is still looking at the deer. The advance/correct
       failure paths re-enter here with the same order, so this REPLACES the live
       pane rather than stacking a second one. */
    function paintOrder(order, note) {
      closePane();
      var overlay = el(doc, "div", "butcher-form-overlay butcher-form-overlay--order");
      if (note) overlay.appendChild(note);
      overlay.appendChild(paneHead("Order " + ((order && order.order_id) || "")));
      var frag = doc.createDocumentFragment();
      // renderOrder wires its own Stamp guard; we hand it the download action.
      frag.appendChild(surfaces.renderOrder(doc, order, {
        actor: actorOf(),
        onStamp: doStamp,
        onAdvance: function (orderId, kind, detail) {
          doAdvance(orderId, kind, detail,
            function () { showOrder(orderId); },
            function (res) {
              paintOrder(order, honestNode(doc, res, "that advance \u2014 the order has NOT moved", "write"));
            });
        },
        onCorrect: function (payload) {
          doCorrect(payload,
            function () { showOrder(order && order.order_id ? order.order_id : payload.order_id); },
            function (res) {
              paintOrder(order, honestNode(doc, res, "that correction \u2014 the record is UNCHANGED", "write"));
            });
        }
      }));
      overlay.appendChild(frag);
      paneEl.appendChild(overlay);
    }

    function showOrder(orderId) {
      api.order(orderId).then(function (res) {
        if (!res || !res.ok || !res.data) {
          // NOTE 2: a failed read must not cost Rick the board. The honest node
          // rides in the pane, over a collection that is still there.
          closePane();
          var miss = el(doc, "div", "butcher-form-overlay");
          miss.appendChild(paneHead("Order"));
          miss.appendChild(honestNode(doc, res, "this order"));
          paneEl.appendChild(miss);
          return;
        }
        // The join rides HERE, not in paintOrder: paintOrder is re-entered by the
        // advance/correct failure paths with the SAME order object, which already
        // carries `.contact`. One fetch per order read, never one per repaint.
        withContact(res.data).then(function (order) { paintOrder(order, null); });
      });
    }

    /* NOTE 1 — "When New Order is hit, it creates a new pane like New Email, New
       Contact, and New Event." That is SL-1, and this is the exemplar's idiom
       written out longhand ON PURPOSE: the overlay is BUILT here and appended
       into the mount parent HERE, in the genesis body the law reads, so the
       check can witness clause (b) without the matcher being widened for us. */
    function showIntake() {
      /* Refused at the DOOR, not at the submit button. Intake's surface guard
       * (renderIntake returns null with no actor) is real but silent — Rick
       * would fill the whole form, press the button, and watch nothing happen.
       * Stopping before the form opens costs him one click instead of a page of
       * typing, and says why. Defence in depth: the surface still refuses. */
      if (!actorOf()) {
        paintBoard(lastOrders, honestNode(doc, { ok: false, code: "E_NO_BENCH" }, "a new order"));
        return;
      }
      paintRail(lastOrders, null);   // no view slot owns intake; nothing is lit
      if (!collection().firstChild) showBoard();   // cold entry: the collection lands beneath
      closePane();

      var overlay = el(doc, "div", "butcher-form-overlay");

      /* SL-3's two controls are built HERE, inline, and that is deliberate rather
         than sloppy. Hidden behind `paneHead()` they were invisible to the check
         for the SAME reason the old `mount()` was: the law reads the genesis body,
         and a control constructed one hop away is a control it cannot witness.
         The exemplars build theirs inline. So does this. (a) the top-× dismiss:  */
      var head = el(doc, "div", "butcher-pane__head");
      head.appendChild(el(doc, "span", "butcher-pane__title", { text: "New order" }));
      var dismiss = el(doc, "button", "record__dismiss", {
        text: "\u00D7", "aria-label": "Close New order"
      });
      dismiss.type = "button";
      dismiss.addEventListener("click", closePane);
      head.appendChild(dismiss);
      overlay.appendChild(head);

      overlay.appendChild(surfaces.renderIntake(doc, {
        actor: actorOf(),
        onIntake: doIntake
      }));

      /* (b) and the Cancel is KEPT, not replaced — SL-3 adds the ×, it never
         trades one way out for another. */
      var cancel = el(doc, "button", "record__action record__action--quiet", { text: "Cancel" });
      cancel.type = "button";
      cancel.addEventListener("click", closePane);
      overlay.appendChild(cancel);

      paneEl.appendChild(overlay);
    }

    /* T-2 — the cooler pane's host half. Deliberately the SAME longhand shape as
       showIntake() above rather than a shared helper the two call: SL-1 reads
       the genesis body for the overlay-built-and-appended-here clause, and a
       control constructed one hop away is a control the law cannot witness. The
       comment on showIntake says this in full; it applies verbatim here. */
    function showTempReading() {
      /* Refused at the DOOR, same as intake. renderTempReading returns null with
         no actor — a real guard, but a silent one: Rick would type a temperature,
         press the button and watch nothing happen. One click and a reason beats
         a page of typing into a void. The surface still refuses (defence in depth). */
      if (!actorOf()) {
        paintBoard(lastOrders, honestNode(doc, { ok: false, code: "E_NO_BENCH" }, "a temperature reading"));
        return;
      }
      paintRail(lastOrders, null);   // no view slot owns this pane; nothing is lit
      if (!collection().firstChild) showBoard();   // cold entry: the collection lands beneath
      closePane();

      var overlay = el(doc, "div", "butcher-form-overlay");

      var head = el(doc, "div", "butcher-pane__head");
      head.appendChild(el(doc, "span", "butcher-pane__title", { text: "New temp reading" }));
      var dismiss = el(doc, "button", "record__dismiss", {
        text: "\u00D7", "aria-label": "Close New temp reading"
      });
      dismiss.type = "button";
      dismiss.addEventListener("click", closePane);
      head.appendChild(dismiss);
      overlay.appendChild(head);

      var surface = surfaces.renderTempReading(doc, {
        actor: actorOf(),
        /* Butcher Settings ships F (design §6 leg 2). There is no settings store
           on this line yet, so the default is passed EXPLICITLY from the one
           place that would read it when it exists — rather than defaulted deep
           inside the surface where a future settings read would have to hunt
           for it. The surface falls back to F on anything unknown regardless. */
        defaultUnit: "F",
        /* The sticky zone (owed 415). Null on the first reading of the session,
           which the surface falls to COOLER_ZONES[0] for. */
        lastZone: lastCoolerZone,
        onReading: doTempReading
      });
      if (surface) overlay.appendChild(surface);

      var cancel = el(doc, "button", "record__action record__action--quiet", { text: "Cancel" });
      cancel.type = "button";
      cancel.addEventListener("click", closePane);
      overlay.appendChild(cancel);

      paneEl.appendChild(overlay);
    }

    /* The write. api.event() — NOT a new verb and NOT a new endpoint: the runtime
       routes POST /api/butcher/event and /intake to one handler, and the reserved
       `__cooler__` lane plus the `cooler_reading` kind are what make this a
       temperature rather than an order's event. Building an endpoint here would
       be a second write path into a chain that already has one.

       The failure path is the one that matters and it is why the honestNode fix
       lands in the same commit: a freshly-opened shop is UNARMED, so the FIRST
       real reading 403s until a Warrant grant carries `cooler_reading`. That 403
       is fully legible on the wire — it names the kind, the grant key and the
       fix — so the note now shows Rick the reason instead of "(403)", and the
       typed reading stays on screen because a refused append lost nothing. */
    /* THE STICKY ZONE (owed 415, ). The last zone a reading was
       actually recorded in, held here in the host rather than in the surface —
       the surface is a pure DOM builder and is rebuilt on every pane open, so
       it has nowhere to remember. Set only on a SUCCESSFUL write: a refused
       append recorded nothing, so it must not move the default the next
       reading arms with. Session-scoped by construction (a reload starts at
       the first zone), which covers the witnessed defect — two readings twelve
       minutes apart with the place on one and not the other. */
    var lastCoolerZone = null;

    function doTempReading(payload, reading) {
      api.event(payload).then(function (res) {
        /* THE ACCEPT IS NO LONGER SILENT (owed 98). The pane still closes — the
           work is done and the form should get out of the way — but it closes
           ONTO a receipt instead of onto nothing. `reading` is the pane's own
           unencoded view (second arg of opts.onReading); absent it, receiptNode
           degrades to "Recorded — that reading." rather than inventing values. */
        if (res && res.ok) {
          // The write landed — arm the next pane with the zone it landed in.
          if (reading && reading.cooler) lastCoolerZone = reading.cooler;
          closePane(); showBoard(receiptNode(doc, reading, res)); return;
        }
        var live = paneEl.querySelector ? paneEl.querySelector(".butcher-form-overlay") : null;
        var note = honestNode(doc, res, "that reading (it was not recorded)", "write");
        if (live) { live.insertBefore(note, live.firstChild); }
        else { paneEl.insertBefore(note, paneEl.firstChild); }
        /* RE-ARM THE CLICK LATCH. The pane stays open on a refused write and the
           typed reading is still on screen (a refused append lost nothing), so a
           retry is exactly the right move — and it must not be locked out by the
           double-fire guard that fired on the first press. Reached by the same
           `data-act` hook the surface defines and the suite queries; the guard
           and its release are one pair, and a guard with no release would turn a
           recoverable 403 into a dead pane. */
        var btn = paneEl.querySelector ? paneEl.querySelector("[data-act=\"temp-submit\"]") : null;
        if (btn) { btn.__inflight = false; btn.disabled = false; }
      });
    }

    function doIntake(payload) {
      api.intake(payload).then(function (res) {
        // On a clean append, return to the board (the new order is now a lane row).
        // On failure, stay on the form under an honest node so nothing is lost silently.
        if (res && res.ok) { closePane(); showBoard(); return; }
        // Stay on the form under an honest node so nothing is lost silently —
        // and put the note INSIDE the pane, not above the collection.
        var live = paneEl.querySelector ? paneEl.querySelector(".butcher-form-overlay") : null;
        var note = honestNode(doc, res, "your order (it was not saved)", "write");
        if (live) { live.insertBefore(note, live.firstChild); }
        else { paneEl.insertBefore(note, paneEl.firstChild); }
      });
    }

    function doStamp(orderId) {
      api.stamp(orderId).then(function (res) {
        if (res && res.ok && res.data && res.data.html) { downloadStamp(doc, orderId, res.data.html); return; }
        var live = paneEl.querySelector ? paneEl.querySelector(".butcher-form-overlay") : null;
        var note = honestNode(doc, res, "the take-home Stamp");
        if (live) { live.insertBefore(note, live.firstChild); }
        else { paneEl.insertBefore(note, paneEl.firstChild); }
      });
    }

    /* The porter-export DEPLOY half (owed butcher-porter-export-deploy-arc). The
       surface (renderExportImport) offers the Export button and hands the act back
       through opts.onExportFromBox; the fetch + download live HERE, the exact doStamp
       precedent. GET /api/butcher/export -> { order_file } (the whole signed record,
       serialized round-trippable by the server so there is ONE order-file
       implementation, standing law 4). A 503 (unprovisioned box), keyless read, or an
       unreachable box paints the HONEST node and downloads NOTHING — never a fabricated
       file (the state-lie this campaign kills). */
    function doExportRecord() {
      api.exportRecord().then(function (res) {
        if (res && res.ok && res.data && res.data.order_file) {
          downloadText(doc, res.data.order_file, exportRecordFilename(), "application/json");
          return;
        }
        var note = honestNode(doc, res, "the record export");
        paneEl.insertBefore(note, paneEl.firstChild);
      });
    }
    function exportRecordFilename() {
      var stamp;
      try { stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19); }
      catch (e) { stamp = "export"; }
      return "deer-hill-record-" + stamp + ".json";
    }

    /* ---- THE OPENING (O-4) — screens 1 and 2, gated on shop state ------------

       The gate is a READ, and it routes on a KNOWN answer only:
         state 'unopened'  -> the Sign. The shop is provably not open.
         state 'open'      -> the board, exactly as before.
         anything else     -> the board, exactly as before.

       That last line is the load-bearing one. A 401, a dropped network or a body
       we cannot read means we do not KNOW whether this shop is open — and
       painting the Sign on a not-known is a claim, not a fallback: it would
       invite a butcher with a live signed chain to "open" a shop he already has.
       (He would land on already_open and lose nothing, but he would have been
       told something false about his own store, which is the fault.) So an
       unreadable shop state falls through to showBoard(), whose honest-node and
       labeled-sample handling already cover every unreachable case and are
       unchanged by this leg. */

    function showSign(note) {
      var frag = doc.createDocumentFragment();
      if (note) frag.appendChild(note);
      frag.appendChild(surfaces.renderSign(doc, {
        // No place proposal exists today: nothing on this box publishes where it
        // is (captureWeatherFor still reads BUTCHER_SHOP_LAT/LON from env — owed
        // butcher-weather-place-reads-env-not-opening-entry, UNTOUCHED here and
        // deliberately not made to look resolved). The surface self-skips place
        // with an honest line; when a proposal source lands it drops in HERE and
        // the flow does not move.
        placeProposal: null,
        onOpen: doOpenShop
      }));
      mount(frag);
    }

    function doOpenShop(payload) {
      api.open(payload).then(function (res) {
        var body = res && res.data;
        if (res && res.ok && body && body.state === "open") {
          // Chaos row 1: an already-open shop goes STRAIGHT to the board. It was
          // not opened by this tap and the reveal would be narrating someone
          // else's act as if it had just happened.
          if (body.already_open) { showBoard(); return; }
          showOpening(body.shop);
          return;
        }
        // Nothing was written (every refusal on POST /shop happens before disk).
        // Repaint the Sign under an honest note and re-arm it so he can retry.
        showSign(honestNode(doc, res, "the Opening \u2014 your shop was NOT opened", "write"));
      });
    }

    function showOpening(shop) {
      var went = false;
      function toBoard() { if (went) return; went = true; showBoard(); }   // timer OR button, once
      mount(surfaces.renderOpening(doc, shop, { onDone: toBoard }));
    }

    /* ---- owed 759 — the season renderers, mounted ---------------------------
       renderSeasonGlance / renderSeasonDashboard / renderSeasonReport and the
       pure seasonSummary fold have been built and green since leg 08 with NO
       host reaching them: the numbers existed and nobody could see them. This is
       the wiring pass, folded into O-4 because it is the same file and the same
       act. The fold is PURE and runs over the board's own orders — no second
       fetch, no cache, no snapshot (leg 07's refusal, still refused). */
    function seasonOf(orders) {
      try { return surfaces.seasonSummary(orders, {}, null); } catch (e) { return null; }
    }

    function showSeason(orders) {
      var summary = seasonOf(orders);
      var frag = doc.createDocumentFragment();
      frag.appendChild(chrome(doc, [
        { label: "Season report", onClick: function () { showSeasonReport(orders); } }
      ]));
      if (summary) {
        frag.appendChild(surfaces.renderSeasonDashboard(doc, summary, {}));
        /* Leg 19 — This Season charts, ADDITIVE over the numeric fold (the
           dashboard stays first, so the leg-08 season tests read unchanged).
           Guarded on the surfaces build carrying the pair (an older client
           renders the dashboard alone, never throws), exactly the shape the
           leg-22 reports / leg-23 auditor guards use. The charts fold their
           OWN weekly view over the same orders; a null node appends nothing. */
        if (typeof surfaces.seasonChartsView === "function" &&
            typeof surfaces.renderSeasonCharts === "function") {
          var chartsNode = surfaces.renderSeasonCharts(
            doc, surfaces.seasonChartsView(orders), {});
          if (chartsNode) frag.appendChild(chartsNode);
        }
      } else {
        frag.appendChild(honestNode(doc, { status: 0 }, "the season summary"));
      }
      mount(frag);
    }

    /* Leg 27 — the Seasons Archive mount. Box-independent: renderSeasonsArchive
       folds the seasons ALREADY in `orders` (no fetch); picking one re-runs the
       SAME renderSeasonDashboard windowed to that season — the rail stub's
       promise kept, over the record in hand. Cold-safe: an older surfaces build
       with no renderSeasonsArchive -> the honest stub. */
    function showArchive(orders) {
      paintRail(orders, "archive");
      if (typeof surfaces.renderSeasonsArchive !== "function") {
        mount(renderStub(doc, "archive"));
        return;
      }
      function paint(boxSeasons) {
        mount(surfaces.renderSeasonsArchive(doc, orders || [], {
          boxSeasons: boxSeasons || null,
          onPick: function (sel) {
            if (sel && sel.fromBox) showArchivedFromBox(orders, sel);
            else showArchivedSeason(orders, sel, orders);
          }
        }));
      }
      /* The box's full season LIST (GET /api/butcher/seasons) is a best-effort
         enrichment: it lets the picker offer seasons the browser never loaded.
         Cold-safe — an older box mirror with no seasons() verb, or an unreachable /
         unprovisioned box (503), paints WITHOUT a box list, so the surface keeps its
         honest wall and the loaded record still browses. Never a fabricated list. */
      if (typeof api.seasons !== "function") { paint(null); return; }
      api.seasons().then(function (res) {
        paint(res && res.ok && res.data && Array.isArray(res.data.seasons) ? res.data.seasons : null);
      }).catch(function () { paint(null); });
    }

    /* A box-only season the browser never loaded: pull GET /board?season=YYYY (the
       SAME orders[] shape /board ships) and re-run the season dashboard over it, no
       new parse path. A 503/unreachable/keyless read paints the honest node and shows
       NOTHING fabricated (the state-lie this campaign kills). */
    function showArchivedFromBox(orders, sel) {
      function wall(res) {
        var frag = doc.createDocumentFragment();
        frag.appendChild(chrome(doc, [{ label: "\u2039 Back to archive", onClick: function () { showArchive(orders); } }]));
        frag.appendChild(honestNode(doc, res, "that season from the box"));
        mount(frag);
      }
      api.board(sel.season).then(function (res) {
        if (res && res.ok && res.data && Array.isArray(res.data.orders)) {
          showArchivedSeason(orders, sel, res.data.orders);
          return;
        }
        wall(res);
      }).catch(function () { wall({ status: 0 }); });
    }

    /* Re-run the "This season" dashboard windowed to the picked season. `viewOrders`
       is the set the dashboard folds (the loaded record for a loaded season, or the
       box-fetched window for a box season); `orders` stays the record the Back button
       returns to, so a box drill-down never strands the picker on one season. */
    function showArchivedSeason(orders, sel, viewOrders) {
      var src = viewOrders || orders;
      var summary = null;
      try { summary = surfaces.seasonSummary(src, { from: sel.from, to: sel.to }, null); }
      catch (e) { summary = null; }
      var frag = doc.createDocumentFragment();
      frag.appendChild(chrome(doc, [{ label: "\u2039 Back to archive", onClick: function () { showArchive(orders); } }]));
      if (summary) {
        frag.appendChild(surfaces.renderSeasonDashboard(doc, summary, { title: "Season " + sel.season }));
      } else {
        frag.appendChild(honestNode(doc, { status: 0 }, "the archived season"));
      }
      mount(frag);
    }

    function showSeasonReport(orders) {
      var summary = seasonOf(orders);
      var frag = doc.createDocumentFragment();
      frag.appendChild(chrome(doc, [{ label: "\u2039 Back to season", onClick: function () { showSeason(orders); } }]));
      if (summary) {
        frag.appendChild(surfaces.renderSeasonReport(doc, summary, {
          // The report carries its own referent; the stamp is the host's to supply.
          generatedAt: new Date().toISOString()
        }));
      } else {
        frag.appendChild(honestNode(doc, { status: 0 }, "the season report"));
      }
      mount(frag);
    }

    /* ---- leg 11, the mount (operator ruled A) --------------------------------
       Diane's census, reached by a button on Rick's board. Same shape as
       showSeason: a PURE fold over the orders the board already read, no second
       fetch, no cache, no snapshot (leg 07's refusal, still refused).

       ON THE RESIDUE, because the next reader will otherwise re-derive this.
       `censusView` names two unplaceable classes and butcher-census.test.js
       asserts both are named-not-omitted. Neither is reachable through the live
       write path, and that is a RECORD-MODEL fact, not a wiring gap: `no-entries`
       cannot occur because the /board grouping walk creates a lane only because
       entries exist; `all-superseded` cannot occur because butcher-record.js
       :1106 refuses a second correction of the same entry (E_ALREADY_SUPERSEDED)
       and appends are forward-only, so a supersession cycle is impossible and the
       last correction is always effective. The residue counters therefore read
       zero, honestly. Do NOT "fix" this by widening the wire — the wire is not
       what is hiding them. They are defensive branches that light up only if a
       repair/import path ever writes the record without going through
       appendEntry. */
    /* E9-worker (leg 12) — the shift view. A VIEW SWAP inside the butcher pane,
       exactly as the census mounts: no new tab, no new route, no new authority.

       THE ROLE IS HELD HERE, IN HOST MEMORY, AND NOWHERE ELSE. Not in a cookie,
       not in a header, not in a request. It is a view preference on the same
       footing as which pane is open, so:
         · it is never sent to the runtime;
         · it is never handed to `doAdvance` — the advance path below is the
           IDENTICAL three-argument call the board makes, and the role does not
           appear in it. That is the fence, and `{post}` 4 tests it.
       Cold-safe: an older surfaces build without renderWorkerDashboard simply
       never offers the button. */
    var workerRoleId = null;

    function showWorker(orders, roleId) {
      if (roleId != null) workerRoleId = roleId;
      var frag = doc.createDocumentFragment();
      paintRail(orders, "shift");
      frag.appendChild(surfaces.renderWorkerDashboard(doc, orders || [], {
        role: workerRoleId,
        onRole: function (rid) { showWorker(orders, rid); },
        // The SAME host verb the board passes. Three arguments. No role.
        onAdvance: function (orderId, kind, detail) {
          doAdvance(orderId, kind, detail,
            function () { showWorker(orders, null); },
            function (res) {
              showWorker(orders, null);
              return honestNode(doc, res, "that advance \u2014 the order has NOT moved", "write");
            });
        }
      }));
      mount(frag);
    }

    /* Leg 17 beat 2 — MARKETING NOTES: the boat for the surface's socket.
       The ruled model (operator conn, this session): reuse the shipped Contacts
       notes primitive keyed on contact_id — ONE store, NO new route. The pure
       surface drew an empty `customer-notes` socket per contact-bearing customer;
       this fills each from contactsApi.notes / .addNote when the client is live
       and REMOVES it when cold (no dead affordance on the glass).

       ALWAYS RESOLVES, NEVER REJECTS — the leg-07 join's exact discipline: a
       notes read or write failure must never take the Customers pane down. And a
       down read renders the HONEST unavailable state, never a fabricated empty
       (surfaces.renderCustomerNotes opts.down) — the board/cooler honest-read
       axis, held here too. */
    function paintNotesSocket(socket, id) {
      if (!socket) return;
      var coldClient = !contactsApi || typeof contactsApi.notes !== "function";
      var coldSurface = typeof surfaces.renderCustomerNotes !== "function";
      if (coldClient || coldSurface || !id) {
        // No live client / no builder / no id -> remove the empty socket entirely.
        if (socket.parentNode) socket.parentNode.removeChild(socket);
        return;
      }
      contactsApi.notes(id).then(function (env) {
        var ok = !!(env && env.ok);
        var notes = (ok && env.data && Array.isArray(env.data.notes)) ? env.data.notes : [];
        fillNotesSocket(socket, id, notes, !ok);
      }).catch(function () {
        // Unreachable/threw -> honest-down, never an empty list.
        fillNotesSocket(socket, id, [], true);
      });
    }

    /* Inject the built notes DOM into the socket and, when the read was live,
       WIRE the add button. Re-entrant: clears the socket first, so a re-hydrate
       after a successful write never stacks or double-wires. */
    function fillNotesSocket(socket, id, notes, down) {
      clear(socket);
      var body = surfaces.renderCustomerNotes(doc, notes, { down: !!down });
      if (!body) return;
      socket.appendChild(body);
      if (down) return;  // honest-down carries no add affordance to wire

      var input = body.querySelector('[data-role="note-input"]');
      var btn = body.querySelector('[data-role="note-add-btn"]');
      if (!input || !btn) return;
      btn.addEventListener("click", function () {
        var text = (input.value || "").replace(/^\s+|\s+$/g, "");
        if (!text) return;
        if (typeof contactsApi.addNote !== "function") return;
        btn.disabled = true;
        contactsApi.addNote(id, text).then(function (env) {
          if (env && env.ok) {
            // Re-hydrate from truth: re-read so the list reflects what the store
            // actually holds (never optimistically paint an unconfirmed write).
            paintNotesSocket(socket, id);
          } else {
            // Honest write-fail: re-enable, mark it, keep the typed text.
            btn.disabled = false;
            if (!body.querySelector('[data-region="note-add-fail"]')) {
              body.appendChild(el(doc, "p", "notes__fail",
                { "data-region": "note-add-fail", text: "Could not save that note. Try again." }));
            }
          }
        }).catch(function () {
          btn.disabled = false;
        });
      });
    }

    function hydrateCustomerNotes(rootNode) {
      if (!rootNode || typeof rootNode.querySelectorAll !== "function") return;
      var sockets = rootNode.querySelectorAll('[data-region="customer-notes"]');
      for (var i = 0; i < sockets.length; i++) {
        var socket = sockets[i];
        paintNotesSocket(socket, socket.getAttribute && socket.getAttribute("data-contact-id"));
      }
    }

    /* Leg 17 — the Customers mount (the first stub-fill). Beat 1 is a pure fold
       over the orders in hand, exactly like showCensus: no fetch, no clock. Beat
       2 hydrates the marketing-notes sockets AFTER mount (the only I/O this view
       does, and it is per-socket, never a whole-pane read). The rail lights the
       `customers` slot (its own id now, no longer `stub:*`). Cold-safe: guarded
       on renderCustomers existing so an older butcher-surfaces.js cannot light a
       slot that leads nowhere (the renderTempReading / renderSeasonCensus
       precedent). */
    /* Leg 26 — the level config the BOARD paints from (the paint-time merge).
       The STORED `dwellConfig` holds only Rick's typed stages (persist-clean).
       This lays those over the placeholder default so an UNTOUCHED stage keeps
       its example mark (placeholder:true — exactly leg 18's cold display) while a
       stage Rick set shows his real number (placeholder:false). Never stored, so
       no example number can ever reach the deploy-owed Soil write. Returns null
       when Rick has set nothing, so renderBoard falls back to STAGE_DWELL_DEFAULT
       on its own cold path — the display is byte-identical to before the wire
       until Rick's first real number lands. */
    function boardDwellConfig() {
      if (!dwellConfig || !dwellConfig.stages) return null;
      var out = { placeholder: false, stages: {} };
      var D = (surfaces.STAGE_DWELL_DEFAULT && surfaces.STAGE_DWELL_DEFAULT.stages) || {};
      Object.keys(D).forEach(function (id) {
        out.stages[id] = { watchDays: D[id].watchDays, lateDays: D[id].lateDays, placeholder: true };
      });
      Object.keys(dwellConfig.stages).forEach(function (id) {
        var s = dwellConfig.stages[id];
        var m = out.stages[id] || (out.stages[id] = { placeholder: true });
        if (s.watchDays !== undefined) m.watchDays = s.watchDays;
        if (s.lateDays !== undefined) m.lateDays = s.lateDays;
        // Rick's stage iff he set a real number here; else it stays an example.
        m.placeholder = (s.watchDays === undefined && s.lateDays === undefined);
      });
      return out;
    }

    /* Leg 26 — the host handler the Settings surface calls on every edit. It runs
 the CLIENT-SIDE half of the Forest Settings Pattern : fold Rick's
       typed values into the stored dwell config and re-level the board live (leg
       18 reads dwellConfig at board build with NO rebuild, so the next board paint
       shows his real numbers). The PERSIST half — the runtime Soil owner-data
       write, POST /soil/<verb> (Thread 3) — is DEPLOY-GATED; it is owed on the
       deploy leg, NOT injected here.

       §6-#3, kept STRUCTURAL (WATCH #1): only what Rick TYPED lands. An empty
       field arrives as `undefined` and CLEARS that value — the handler never
       substitutes a placeholder/default number, so an unset stage stays unset,
       and a stage with nothing typed carries no bytes at all (never a fabricated
       0). It rides the SAME onConfigChange contract every Forest app's Settings
       will (the pattern's one host seam), so app #2's handler differs only in
       which runtime verb it will call — not in this honesty gate. */
    function onDwellConfigChange(patch) {
      if (!patch || !patch.stage) return;
      if (!dwellConfig) dwellConfig = { placeholder: false, stages: {} };
      var st = dwellConfig.stages[patch.stage] || (dwellConfig.stages[patch.stage] = {});
      if (patch.watchDays !== undefined) st.watchDays = patch.watchDays; else delete st.watchDays;
      if (patch.lateDays  !== undefined) st.lateDays  = patch.lateDays;  else delete st.lateDays;
      // A stage Rick cleared to empty holds no bytes — drop it, never a phantom 0.
      if (st.watchDays === undefined && st.lateDays === undefined) delete dwellConfig.stages[patch.stage];
      // Re-level is deploy-free: the next showBoard reads boardDwellConfig() and
      // paints Rick's real numbers with no rebuild. The runtime persist that makes
      // them survive a reload is the deploy-owed half (Thread 3).
    }

    /* Leg 26 — THE FOURTH STUB-FILL: `settings` is a real surface now, the first
 instance of the Forest Settings Pattern . A pure config-editor pane
       (renderSettings) mounted like every other view; its every edit rides the
       host's onDwellConfigChange (the pattern's onConfigChange seam). Cold-safe:
       guarded on renderSettings existing so an older butcher-surfaces.js cannot
       light a slot that leads nowhere (the customers/orders/reports precedent). */
    function showSettings() {
      paintRail(lastOrders, "settings");
      if (typeof surfaces.renderSettings !== "function") {
        // Cold-safe: an older surfaces build. Say so; paint nothing false.
        mount(renderStub(doc, "settings"));
        return;
      }
      mount(surfaces.renderSettings(doc, boardDwellConfig(), { onConfigChange: onDwellConfigChange }));
    }

    /* Leg 25b — the Porter mount (the fifth stub-fill: Export / Import). The
       surface is PURE and composes the injected order-file module; the host
       supplies (1) that module (root.orderFile), (2) the download I/O
       (onExport -> downloadText, the Blob path), and (3) the write-wall: onImport
       is deliberately ABSENT here, so the surface renders "preview only" —
       landing rides the deploy-gated, warrant-gated append path, not the client.
       Cold-safe: absent renderExportImport OR absent order-file module -> the
       honest stub (the promote gate above already keeps the slot dark, so this is
       the belt-and-braces path a direct showPorter() call still lands on). */
    function showPorter() {
      paintRail(lastOrders, "porter");
      var of = root.orderFile;
      /* Leg 25c — cold-gate keyed on the IMPORT capability (parse + importPlan),
         the twin of the promote gate above. NOT exportOrders: the browser mirror
         omits it by design, and export is walled honestly inside the surface. */
      if (typeof surfaces.renderExportImport !== "function" ||
          !of || typeof of.parse !== "function" || typeof of.importPlan !== "function") {
        mount(renderStub(doc, "porter"));
        return;
      }
      mount(surfaces.renderExportImport(doc, {
        orderFile: of,
        db: root.butcherRecordDb || null,     // the record source; server-held until go-live
        verifyFn: (root.ring && typeof root.ring.verify === "function") ? root.ring.verify : null,
        onExport: function (text, filename) { downloadText(doc, text, filename); },
        // The IMPORT read half : the surface offers a file PICKER (no paste
        // box); the file READ is the host's I/O, done here through a FileReader so the
        // surface stays pure — the mirror of onExport handing the download back. Returns
        // a Promise<string>; a read error rejects and the surface says so honestly. The
        // surface carries a cold-safe FileReader fallback if this seam is ever unwired.
        onReadFile: function (file) {
          return new Promise(function (resolve, reject) {
            var view = doc.defaultView || (typeof window !== "undefined" ? window : null);
            var FR = (view && view.FileReader) || (typeof FileReader !== "undefined" ? FileReader : null);
            if (!FR || !file) { reject(new Error("E_NO_FILEREADER")); return; }
            var reader = new FR();
            reader.onload = function () { resolve(String(reader.result || "")); };
            reader.onerror = function () { reject(new Error("E_FILE_READ")); };
            try { reader.readAsText(file); } catch (e) { reject(e); }
          });
        },
        // The porter-export DEPLOY half: the box seam. The surface offers the button;
        // doExportRecord does the fetch + download and reports a 503/keyless/unreachable
        // box honestly (honestNode), never a fabricated file. This is what lights the
        // Export button that leg 25c walled honestly — the browser mirror still has no
        // exportOrders; the record is read from the box through GET /api/butcher/export.
        onExportFromBox: function () { doExportRecord(); }
        // onImport intentionally omitted — Import previews + verifies only; landing
        // is deploy+Warrant-gated (out of scope for this leg, per the plan §6-c wall).
      }));
    }

    function showCustomers(orders) {
      paintRail(orders, "customers");
      if (typeof surfaces.renderCustomers !== "function") {
        // Cold-safe: an older surfaces build. Say so; paint nothing false.
        mount(renderStub(doc, "customers"));
        return;
      }
      var paneNode = surfaces.renderCustomers(doc, orders || [], { onOpen: showOrder });
      var frag = doc.createDocumentFragment();
      frag.appendChild(paneNode);
      mount(frag);
      // paneNode is now live in the pane; fill its notes sockets (beat 2).
      hydrateCustomerNotes(paneNode);
    }

    /* Leg 21 — the Orders mount (the second stub-fill: the all-orders explorer).
       A pure fold over the orders in hand, exactly like showCensus/showCustomers
       beat 1: no fetch, no clock. It does NO post-mount I/O — the rows navigate
       to the existing per-order detail (showOrder) via the surface's onOpen, the
       same interaction the board's rows use, so there is no new route and no
       socket to hydrate. The rail lights the `orders` slot (its own id now, no
       longer `stub:*`). Cold-safe: guarded on renderOrders existing so an older
       surfaces build cannot light a slot that leads nowhere (the showCustomers
       precedent). */
    function showOrders(orders) {
      paintRail(orders, "orders");
      if (typeof surfaces.renderOrders !== "function") {
        // Cold-safe: an older surfaces build. Say so; paint nothing false.
        mount(renderStub(doc, "orders"));
        return;
      }
      var frag = doc.createDocumentFragment();
      frag.appendChild(surfaces.renderOrders(doc, orders || [], { onOpen: showOrder }));
      mount(frag);
    }

    /* Leg 22 — the Reports mount (the third stub-fill: the non-techy generator).
       A pure fold over orders in hand for the season-report headline, exactly
       like showOrders/showCensus: no fetch, no clock in the surface. The cards
       navigate to the EXISTING surfaces via the surface's onOpen — a MULTI-TARGET
       host map: `season` opens the season report (showSeasonReport, which folds
       the same orders) and `auditor` opens the cooler face (showCooler, which
       owns its own honest-read I/O). So there is no new route and no report
       format — Reports is a front door to views that already render. The rail
       lights the `reports` slot (its own id now, no longer `stub:*`). Cold-safe:
       guarded on renderReports existing so an older surfaces build cannot light a
       slot that leads nowhere (the showOrders precedent). */
    function showReports(orders) {
      paintRail(orders, "reports");
      if (typeof surfaces.renderReports !== "function") {
        // Cold-safe: an older surfaces build. Say so; paint nothing false.
        mount(renderStub(doc, "reports"));
        return;
      }
      var frag = doc.createDocumentFragment();
      frag.appendChild(surfaces.renderReports(doc, orders || [], {
        onOpen: function (id) {
          if (id === "season") showSeasonReport(orders);
          else if (id === "auditor") showCooler();
        }
      }));
      mount(frag);
    }

    function showCensus(orders) {
      var frag = doc.createDocumentFragment();
      paintRail(orders, "census");
      // No window passed: renderSeasonCensus names "All orders on file" on the
      // artifact rather than leaving the referent blank. A season filter is a
      // later call, not something to invent here.
      var pane = surfaces.renderSeasonCensus(doc, orders || [], {});
      wireCensusToggle(pane);
      frag.appendChild(pane);
      mount(frag);
    }

    /* THE DISCLOSURE TOGGLE (owed butcher-census-chain-has-no-working-collapse).
       The surface renders every order's chain with `data-open="0|1"` (open only
       for opts.expanded), and the row is already a real control — role=button,
       tabindex=0, .row--clickable — but nothing ever TOGGLED data-open, so the
       chain sat inert and butcher.css could not honestly hide a closed one
       (hiding an un-openable region makes the record unreachable — the false-
       green butcher.css's own law forbids it). This wires the row so a click or
       Enter/Space flips its OWN chain open/closed; a `data-open="0"` collapse
       rule in butcher.css is now honest because the affordance can fire.

       Pure VIEW STATE: no I/O, no fetch, no write payload — the entries are
       already in hand (this surface performs no I/O, leg 11's refusal). The
       advance/write path is untouched. `activate` is the shell's shared
       control-vocabulary helper (click + Enter/Space) defined above. */
    function wireCensusToggle(pane) {
      if (!pane || typeof pane.querySelectorAll !== "function") return;
      var rows = pane.querySelectorAll(".row--clickable[data-order]");
      for (var i = 0; i < rows.length; i++) {
        (function (row) {
          var chain = row.querySelector('[data-region="census-chain"]');
          if (!chain) return;
          // Mirror the rendered state onto ARIA so the control announces
          // whether it is expanded before the first interaction.
          row.setAttribute("aria-expanded",
            chain.getAttribute("data-open") === "1" ? "true" : "false");
          activate(row, function () {
            var open = chain.getAttribute("data-open") === "1";
            chain.setAttribute("data-open", open ? "0" : "1");
            row.setAttribute("aria-expanded", open ? "false" : "true");
          });
        })(rows[i]);
      }
    }

    /* T-4 — THE COOLER LOG MOUNT.
     *
     * Unlike showCensus (a pure fold over orders already in hand) this view does
     * I/O: the roll-up is the RUNTIME's, because the fold has no clock and only
     * the server can honestly strike "today". So it carries the honest-read axis
     * like the board does — a down or keyless read paints the honest node and
     * NEVER an empty log. An empty cooler log and an unreachable one look
     * identical on the glass if you let them, and on this surface that
     * confusion reads as "the cooler was never checked", which is a claim the
     * client is in no position to make.
     *
     * NO BOUNDS PASSED. Omitting `to` is what makes the route strike today off
     * its own clock — the audit-relevant default. A date filter is a later
     * call, not something to invent here (the showCensus precedent: name the
     * scope on the artifact rather than guessing one). */
    function showCooler() {
      paintRail(lastOrders, "cooler");
      if (typeof api.cooler !== "function") {
        // Cold-safe: an older client with no cooler verb. Say so; paint nothing false.
        mount(honestNode(doc, { ok: false, code: "E_UNSUPPORTED" }, "the cooler log"));
        return;
      }
      api.cooler().then(function (res) {
        if (!res || !res.ok || !res.data) {
          mount(honestNode(doc, res || { ok: false, status: 0 }, "the cooler log"));
          return;
        }
        var frag = doc.createDocumentFragment();
        frag.appendChild(surfaces.renderCoolerLog(doc, res.data, {}));
        mount(frag);
      });
    }

    /* Leg 23 — THE AUDITOR'S-VIEW CONSOLIDATION MOUNT (§6-#5 ruling A).
     *
     * The consolidation is a PURE fold (auditorReport reads the record in hand
     * for its attestation headline) with a host-owned interaction: its two
     * cards open the surfaces that already render them, the SAME onOpen seam
     * Reports proved. `census`->showCensus (a pure fold over the same orders),
     * `cooler`->showCooler (the host's I/O — a live door offered even over an
     * empty record, the T-4 rule the surface honors).
     *
     * `lastOrders` (read at call) is the last real board, so the consolidation
     * folds the whole known record for its headline regardless of which sub-view
     * was active — the showReports/showCustomers precedent. Guarded on
     * renderAuditorView existing so an older surfaces build falls back to the
     * honest stub rather than a dead slot. */
    function showAuditor() {
      paintRail(lastOrders, "auditor");
      if (typeof surfaces.renderAuditorView !== "function") {
        // Cold-safe: an older surfaces build. Say so; paint nothing false.
        mount(renderStub(doc, "auditor"));
        return;
      }
      var frag = doc.createDocumentFragment();
      frag.appendChild(surfaces.renderAuditorView(doc, lastOrders || [], {
        onOpen: function (id) {
          if (id === "census") showCensus(lastOrders);
          else if (id === "cooler") showCooler();
        }
      }));
      mount(frag);
    }

    /* Show a stub. Lights its own rail slot (`stub:<slug>`) and mounts the named
     * empty pane — no fetch, no fold, nothing false. The rail is painted from
     * the last board this pane knew, so a stub does not blank the operational
     * views behind it. */
    function showStub(slug) {
      paintRail(lastOrders, "stub:" + slug);
      mount(renderStub(doc, slug));
    }

    /* seq156 — the post-open place-affirm affordance, as a BOARD-TOP STRIP.
     *
     * An OPEN shop that carries no place is weather-dark; this is the control
     * that lets the owner set it (a SIGNED SHOP_PLACE_SET via api.place). It is
     * a dismissible strip ABOVE the board, NOT a screen that preempts it: a shop
     * with live orders must reach its board — the place-less state is valid, not
     * a gate. `placeAffirmShop` (set in the entry read) is the place-less open
     * shop, or null; the strip renders only when it is set, and renderPlaceAffirm
     * returns null for a placed shop, so a placed shop shows nothing (the
     * asymmetry is the law). "Not now" clears the flag and repaints. */
    var placeAffirmShop = null;
    function placeAffirmStrip() {
      if (!placeAffirmShop || typeof surfaces.renderPlaceAffirm !== "function") return null;
      return surfaces.renderPlaceAffirm(doc, placeAffirmShop, {
        onAffirm: function (place) {
          if (typeof api.place !== "function") { placeAffirmShop = null; showBoard(); return; }
          api.place({ place: place }).then(function (r) {
            // On success the place is set and weather begins — clear the strip and
            // repaint. On refusal (bad coord / unopened) leave the flag set so the
            // strip returns for a retry; a fresh strip re-renders clean, so no
            // optimistic "done" persists past the failure.
            if (r && r.ok) placeAffirmShop = null;
            showBoard();
          });
        },
        onSkip: function () { placeAffirmShop = null; showBoard(); }
      });
    }

    // Entry: the capability ref selects the opening view; default = board — but
    // the shop-state read comes FIRST, because on an unopened box the board has
    // nothing honest to show and the Sign is the whole screen.
    var ref = (ctx && typeof ctx.capability === "string" && ctx.capability.indexOf(":") !== -1)
      ? ctx.capability.slice(ctx.capability.indexOf(":") + 1) : "board";
    if (ref === "intake") { showIntake(); return; }
    if (typeof api.shop !== "function") { showBoard(); return; }   // cold-safe: an older client still works
    api.shop().then(function (res) {
      var data = res && res.ok && res.data ? res.data : null;
      var state = data ? data.state : null;
      if (state === "unopened" && typeof surfaces.renderSign === "function") { showSign(null); return; }
      // seq156: an OPEN but place-LESS shop arms the board-top affirm strip. A placed
      // shop — or a response with no shop object (the shape existing tests stub) —
      // arms nothing, so the board-first default is unchanged.
      if (state === "open") {
        var shop = data && data.shop;
        var placed = shop && shop.place && isFinite(Number(shop.place.lat)) && isFinite(Number(shop.place.lon));
        placeAffirmShop = (shop && !placed) ? shop : null;
      }
      showBoard();
    });
  }

  /* ---- self-register + export ---------------------------------------------- */
  if (root.pane && typeof root.pane.registerRenderer === "function") {
    root.pane.registerRenderer("butcher", render);
  }
  root.butcherRenderer = {
    render: render,
    _version: "1.25"
  };
})();
