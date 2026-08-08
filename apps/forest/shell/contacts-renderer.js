/* Shea's Forest — the App Shell · shell/contacts-renderer.js
    Trio · Track CONTACT (member A) · the contacts-* renderer family.

   The person tree: a native 1-D list (the cheap/earlier interior — it merges FIRST
   and so is the seam's first live exercise through a real UI). Three words in the
   Block Alphabet, one pane:
     • row     — the person list from GET /api/contacts (+ /search): an initials
                 avatar (Real-or-Made: initials, NEVER a fabricated face), the name,
                 one honest sub-line (org/title, or "starred"), a star toggle.
     • record  — the person detail from GET /api/contacts/:id: emails/phones/
                 addresses (each a field, the primary marked), custom fields, notes,
                 and an actions strip.
     • context — the honest weave: relationship edges from the contact tool's OWN
                 proof-chained graph. Cross-tool weave (calendar events, mail threads)
                 is a J3 merged-line surface — rendered here as an HONEST deferred
                 note, never a fabricated cross-tool read. (E1: the record's "Email"
                 action IS now wired — a cross-app compose gesture, not a cross-tool
                 read; it dispatches the address to Mail, which owns compose.)

   TC-1 (thin-client — the discipline the Confluence greps for): this renderer holds
   NO contact business logic. No merge decision, no entity resolution, no name
   normalization, no confidence math, no dedup — it renders whatever the tool's REST
   returns and sends user intent back through contactsRest verbatim. The `merge`
   action is ASK-FIRST here (a confirm gate is UI, not business logic); the actual
   merge judgment + the suggest-merges candidates are the TOOL's.

   F3 (honest badge, both axes):
     • READ axis — a seam 503 (E_SEAM_NO_REGISTRY), a 401, or a network drop renders
       an HONEST "can't reach your contacts" pane (honestBadge 'unreachable' hollow
       ring), NEVER a fabricated-green empty list. An empty-but-reached registry
       renders an HONEST "no contacts yet" pane (reached the truth; the truth is zero).
     • WRITE axis — a star toggle / merge shows saving -> saved -> (on failure) an
       honest unsaved revert. An in-flight write never renders as landed.

   Real-or-Made: a CONTACT row/record avatar is ALWAYS an initials chip derived from
   the display name — this renderer never invents a face where none exists. The ONE
   photo path is the owner's OWN card (My Card, leg 2), and only ever a REAL photo the
   operator uploaded — a genuine capture, never a fabricated or guessed face. (Contact
   photos are a later leg; today only the owner card carries an image.)

   Boundary (Confluence §1): owns contacts-*; EXCLUDES the grid/calendar-*, any
   forest-runtime.js edit, any mail seam. The "email them" / "file to a tree" /
   "add relationship" actions are SURFACES shown here and WIRED at the Confluence
   (merged line, J3) — rendered as honest, clearly-deferred affordances, never a
   silent no-op that looks live and never a live handshake with the mail session.

   This view is ALWAYS a full pane, never a grove-compose (⊗) sub-unit — so it does
   NOT touch the shell-renderers.js :154 grove-compose sub-dispatch joint (Cistern:
   "decide explicitly; document it"). Decided: full pane only.

   Plain script (no ES module) — attaches to window.ForestShell.contactsRenderer and
   self-registers the "contacts" kind with window.ForestShell.pane.
   Depends on window.ForestShell.block.el (the atom) + .contactsRest + .honestBadge
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

  /* ---- activate: make a non-button node behave like a button (click + keyboard) *
   * The `.rail__slot` vocabulary (§3.4) is role=button + tabindex=0 on a *
   * <div>, so the keyboard half is ours to supply. Enter and Space both fire, and   *
   * Space's default page-scroll is suppressed — a nav row that scrolls the page     *
   * when you pick it is not a nav row.                                              */
  // The list-alphabet's node clear (mail-renderer.js:59, same shape). `textContent = ""` detaches
  // children in a REAL DOM but is a plain property write in the suites' fake document, so a
  // textContent-only clear silently leaves stale nodes attached. Detach them explicitly: correct
  // in the browser, correct in the harness, one function.
  function clearNode(node) {
    if (!node) return;
    if (node.childNodes && typeof node.removeChild === "function") {
      while (node.childNodes.length) node.removeChild(node.childNodes[node.childNodes.length - 1]);
    }
    node.textContent = "";
  }

  function activate(node, fn) {
    node.addEventListener("click", function () { fn(); });
    node.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); fn(); }
    });
    return node;
  }

  /* ---- small pure helpers (display only — NOT business logic) ---------------- */
  // Initials from a display name: first letter of the first + last token, upper.
  // Real-or-Made: for a contact ROW/RECORD this is the ONLY avatar — never a photo,
  // never a guessed face. (The owner card, My Card, may show a REAL uploaded photo —
  // leg 2 — which is a genuine capture, not a fabrication; see ownerAvatar in render().)
  function initials(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }
  // E1 — which address to hand to Mail for a "Email from a contact" gesture. DISPLAY-ONLY
  // selection (no business logic): the record already MARKS a primary email (is_primary,
  // rendered in the record fields); this picks that same one, else the first address on
  // file, else null. No normalization, no dedup, no resolution — TC-1: it only chooses
  // among addresses the tool already returned. null -> the contact has no address to email.
  // ALL addresses on file for this person — the guest-list read's query key.
  //
  // primaryEmailOf picks ONE address (for the "email them" action, which needs a single target).
  // Moments needs ALL of them: Shea's calendar invites reach people at whichever address the
  // organiser happened to have. Matching only the primary would silently miss every meeting that
  // used a work address for someone filed under their personal one — a WRONG-EMPTY, and a
  // wrong-empty in this app is indistinguishable from "you never met" (the exact failure that let
  // the whole canopy render blank for six sessions without anyone noticing).
  //
  // Dedupe by folded key, matching the tool's own fold (lowercase + trim, nothing cleverer).
  function allEmailsOf(contact) {
    var emails = (contact && contact.emails) || [];
    var out = [], seen = {}, i, v, k;
    for (i = 0; i < emails.length; i++) {
      v = (emails[i] && (emails[i].email || emails[i].value)) || "";
      if (typeof v !== "string") continue;
      k = v.trim().toLowerCase();
      if (!k || seen[k]) continue;
      seen[k] = 1;
      out.push(k);
    }
    return out;
  }

  function primaryEmailOf(contact) {
    var emails = (contact && contact.emails) || [];
    var i, v;
    for (i = 0; i < emails.length; i++) {
      if (emails[i] && emails[i].is_primary) {
        v = emails[i].email || emails[i].value || "";
        if (v) return v;
      }
    }
    for (i = 0; i < emails.length; i++) {
      v = emails[i] && (emails[i].email || emails[i].value || "");
      if (v) return v;
    }
    return null;
  }
  // E1 — dispatch the cross-app compose intent up to the shell host (forest:compose {to},
  // bubbles). The host navigates to Mail and opens compose pre-addressed; contacts carries
  // ONLY the address (TC-1: no compose logic here). Cross-env CustomEvent (mirrors badges.js):
  // the document's defaultView in the browser, a plain object under the test doc; cold-safe.
  function emitCompose(node, to) {
    if (!node || !to) return;
    try {
      var doc = node.ownerDocument;
      var view = doc && doc.defaultView;
      var ev = (view && typeof view.CustomEvent === "function")
        ? new view.CustomEvent("forest:compose", { detail: { to: to }, bubbles: true })
        : { type: "forest:compose", detail: { to: to }, bubbles: true };
      if (typeof node.dispatchEvent === "function") node.dispatchEvent(ev);
    } catch (e) { /* cold-safe: the gesture is best-effort, never a render throw */ }
  }
  // One honest sub-line for a row: org · title, else "starred", else "".
  function subline(c) {
    var bits = [];
    if (c.organization) bits.push(c.organization);
    if (c.title) bits.push(c.title);
    if (bits.length) return bits.join(" \u00b7 ");
    return c.starred ? "starred" : "";
  }

  /* ---- K1: search highlight (display only) ---------------------------------- *
   * Marks the operator's typed query inside a rendered string. The SEARCH itself *
   * is the tool's FTS (api.search); this only highlights what the person typed — *
   * no matching logic, no ranking, no business logic (TC-1).                      */
  function fillHighlighted(doc, node, text, q) {
    text = String(text == null ? "" : text);
    var needle = String(q || "").trim();
    if (!needle) { node.textContent = text; return node; }
    var lc = text.toLowerCase(), nlc = needle.toLowerCase(), i = 0, idx;
    while ((idx = lc.indexOf(nlc, i)) !== -1) {
      if (idx > i) node.appendChild(doc.createTextNode(text.slice(i, idx)));
      node.appendChild(el(doc, "mark", "contacts-hl", { text: text.slice(idx, idx + needle.length) }));
      i = idx + needle.length;
    }
    if (i < text.length) node.appendChild(doc.createTextNode(text.slice(i)));
    return node;
  }

  /* ---- K1: label chips (display only) --------------------------------------- *
   * Read-only label strip. Colors ride the label's OWN swatch (tool-owned); this *
   * renders what the tool returned, never a computed category. Defensive: rows    *
   * carry labels only if the tool's list route serves them — absent -> nothing.   */
  function labelBadges(doc, labels) {
    if (!labels || !labels.length) return null;
    var wrap = el(doc, "div", "contacts-labels");
    labels.forEach(function (l) {
      var chip = el(doc, "span", "contacts-label", { text: l.label || l.name || "" });
      chip.style.borderLeftColor = l.color || "var(--teal)";
      wrap.appendChild(chip);
    });
    return wrap;
  }

  /* ---- K1: the label EDITOR (record interior, WRITE axis) ------------------- *
   * The detail record carries real `labels` (getContactRow attaches them). Render *
   * them as removable chips + an add affordance. TC-1: every mutation DISPATCHES  *
   * to the tool (api.addLabel / api.removeLabel) and re-reads the record on land;  *
   * the renderer computes nothing about the label — the tool owns dedup/creation.  */
  function labelEditor(doc, api, contact, reopen) {
    var wrap = el(doc, "div", "contacts-record__labels");
    wrap.appendChild(el(doc, "div", "contacts-record__labels-label", { text: "labels" }));
    var chips = el(doc, "div", "contacts-labels contacts-labels--editable");
    (contact.labels || []).forEach(function (l) {
      var name = l.label || l.name || "";
      var chip = el(doc, "span", "contacts-label contacts-label--removable", { text: name });
      chip.style.borderLeftColor = l.color || "var(--teal)";
      var x = el(doc, "button", "contacts-label__x",
        { type: "button", "aria-label": "Remove label " + name, text: "\u00d7" });
      x.addEventListener("click", function () {
        x.disabled = true;
        api.removeLabel(contact.id, name).then(function (env) {
          if (env && env.ok) { if (typeof reopen === "function") reopen(); }
          else { x.disabled = false; flashWrite(chip, false, "couldn\u2019t remove"); }
        });
      });
      chip.appendChild(x);
      chips.appendChild(chip);
    });
    if (!(contact.labels || []).length) {
      chips.appendChild(el(doc, "span", "contacts-labels__empty line", { text: "No labels yet." }));
    }
    wrap.appendChild(chips);
    var form = el(doc, "div", "contacts-label-add");
    var input = el(doc, "input", "contacts-label-add__input field",
      { type: "text", placeholder: "Add a label\u2026", "aria-label": "Add a label" });
    var add = el(doc, "button", "contacts-label-add__go", { type: "button", text: "Add" });
    function submit() {
      var v = input.value.trim();
      if (!v) return;
      add.disabled = true;
      api.addLabel(contact.id, v, null).then(function (env) {
        if (env && env.ok) { if (typeof reopen === "function") reopen(); }
        else { add.disabled = false; flashWrite(input, false, "couldn\u2019t add"); }
      });
    }
    add.addEventListener("click", submit);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); submit(); }
    });
    form.appendChild(input); form.appendChild(add);
    wrap.appendChild(form);
    return wrap;
  }

  /* ---- K2: the merge HISTORY (record interior, READ axis) ------------------- *
   * The audit trail of past merges for this contact (GET :id/merge-history).      *
   * Display only — the tool owns the merge record; the renderer shows it verbatim, *
   * honest on an unreachable/empty read (never a fabricated history). Async fill.  */
  function mergeHistorySection(doc, api, contact) {
    var wrap = el(doc, "div", "contacts-record__history");
    wrap.appendChild(el(doc, "div", "contacts-record__history-label", { text: "merge history" }));
    var body = el(doc, "div", "contacts-history");
    body.appendChild(el(doc, "p", "contacts-history__loading line", { text: "Reading merge history\u2026" }));
    wrap.appendChild(body);
    if (!api || typeof api.mergeHistory !== "function") { body.textContent = ""; return wrap; }
    api.mergeHistory(contact.id).then(function (env) {
      body.textContent = "";
      if (!env || !env.ok) { body.appendChild(el(doc, "p", "contacts-history__empty line", { text: "Merge history is unavailable right now." })); return; }
      var rows = (env.data && env.data.history) || [];
      if (!rows.length) { body.appendChild(el(doc, "p", "contacts-history__empty line", { text: "No merges recorded for this contact." })); return; }
      var ul = el(doc, "ul", "contacts-history__list");
      rows.slice(0, 12).forEach(function (r) {
        var li = el(doc, "li", "contacts-history__row");
        var survived = (r.survivor_id === contact.id);
        li.appendChild(el(doc, "span", "contacts-history__verb", { text: survived ? "absorbed a duplicate" : "was merged into another" }));
        if (r.merge_reason) li.appendChild(el(doc, "span", "contacts-history__reason", { text: r.merge_reason }));
        if (r.created_at) li.appendChild(el(doc, "span", "contacts-history__when line", { text: String(r.created_at).slice(0, 10) }));
        ul.appendChild(li);
      });
      body.appendChild(ul);
    });
    return wrap;
  }

  /* ---- the honest read-failure / empty panes (F3 read axis) ------------------ */
  function readFailNode(doc, env, onSealed) {
    // LEG 02b — the seal-door. A plaintext-at-rest fault (500 + E_REGISTRY_PLAINTEXT_AT_REST)
    // is a MUST-ACT state, not a reach failure: offer the migration door instead of the
    // unreachable message. Cold-safe: no registrySeal module -> the honest unreachable node
    // below, byte-identical to before. onSealed (optional) re-reads the pane after a seal.
    var rs = root.registrySeal;
    if (rs && typeof rs.needsSeal === "function" && rs.needsSeal(env)) {
      var sealWrap = el(doc, "div", "contacts-needs-seal");
      rs.renderSealPrompt(sealWrap, { doc: doc, onSealed: (typeof onSealed === "function" ? onSealed : function () {}) });
      return sealWrap;
    }
    // A reached-nothing state: 503 seam / 401 / network. HONEST, never a fake list.
    var wrap = el(doc, "div", "contacts-unreachable");
    var hb = root.honestBadge;
    if (hb && typeof hb.render === "function") wrap.appendChild(hb.render(doc, "unreachable"));
    var msg = (env && env.status === 401)
      ? "Sign in to see your contacts."
      : (env && env.code === "E_SEAM_NO_REGISTRY")
        ? "Your contacts aren\u2019t mounted on this runtime yet."
        : "Can\u2019t reach your contacts right now.";
    wrap.appendChild(el(doc, "p", "contacts-unreachable__msg", { text: msg }));
    return wrap;
  }
  function emptyNode(doc) {
    // Reached the truth; the truth is zero. HONEST empty, distinct from unreachable.
    return el(doc, "p", "contacts-empty", { text: "No contacts yet \u2014 sync a source to grow this." });
  }

  /* ---- the RECOVERY half of the read axis --------------------------- *
   * readFailNode is the DIAGNOSIS — honest, never a fabricated list. It was also the   *
   * whole story: the pane painted and nothing ever re-read. Contacts looked better       *
   * than mail only by accident (paint() clears `body`; the rail and the search box       *
   * survived outside it and still called refresh()), which is DOM scoping, not design:   *
   * nothing on the dead pane tells you a rail slot would resurrect it.                   *
   *                                                                                      *
   * paintFail hangs the shared recovery under the same honest node — a Try again button   *
   * and a bounded ladder against THE SAME read that failed. The hard rule is inherited:   *
   * a retry that resolves SIGNED-OUT stops and hands back. A 401 is a Door, not a window, *
   * and after a runtime restart the cookie can outlive the owner key — a *
   * ladder that kept knocking would spin forever on a tab that cannot recover by asking.  *
   *                                                                                       *
   * Cold-safe: no module / no re-read seam -> the honest node alone, exactly as before.    */
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
        if (e && e.status === 401) return "signed-out";
        return "unreachable";
      },
      failNode: function (e) { return readFailNode(doc, e || env); },
      onResolve: function (e) { repaint(e); }
    });
    if (!handle) hostNode.appendChild(readFailNode(doc, env));
  }

  /* ---- the person ROW (list interior) --------------------------------------- */
  function rowNode(doc, c, onOpen, onStar, q, select) {
    // C2 — `select` (optional) is the bulk-selection controller { enabled, has, toggle }, the
    // SAME shape mail threads into messageRow (mail-renderer.js:854). §5 C2: reuse the
    // alphabet, do not re-invent it. Undefined/absent select -> byte-identical to every prior
    // caller (no checkbox), so the existing list/search/rail suites are unchanged.
    //
    // WHY EVERY CONTACT ROW IS SELECTABLE AND MAIL'S ARE NOT: mail gates the checkbox on
    // `m.source === "gmail" && m.id` because its batch primitive is gmail-only — an mbox row
    // physically cannot be Gmail-batch-modified (flag-don't-fake). Contacts has no such split:
    // `POST /api/contacts/bulk` is the tool's own verb over the tool's own records, so every
    // row with an id is genuinely actionable. Copying mail's gate here would refuse a capability
    // that exists — the inverse fault, and just as dishonest.
    var li = el(doc, "li", "contacts-row");
    if (select && select.enabled && c.id) {
      var checked = !!select.has(c.id);
      var box = el(doc, "span", "contacts-row__check" + (checked ? " is-checked" : ""),
        { role: "checkbox", tabindex: "0", "aria-checked": checked ? "true" : "false",
          "aria-label": "Select " + (c.display_name || "contact") });
      // Stop propagation so ticking a box never OPENS the record — the two gestures live on
      // the same row and must not collide (mail's rule, same reason).
      function flip(e) {
        if (e && typeof e.stopPropagation === "function") e.stopPropagation();
        var now = select.toggle(c.id, c);
        box.classList.toggle("is-checked", !!now);
        box.setAttribute("aria-checked", now ? "true" : "false");
      }
      box.addEventListener("click", flip);
      box.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { if (e.preventDefault) e.preventDefault(); flip(e); }
      });
      li.appendChild(box);
    }
    var btn = el(doc, "button", "contacts-row__open", { type: "button", "aria-label": "Open " + (c.display_name || "contact") });
    var av = el(doc, "span", "contacts-row__avatar", { "aria-hidden": "true", text: initials(c.display_name) });
    btn.appendChild(av);
    var main = el(doc, "span", "contacts-row__main");
    // K1: highlight the operator's typed query in the name/sub (display only).
    main.appendChild(fillHighlighted(doc, el(doc, "span", "contacts-row__name field"), c.display_name || "(no name)", q));
    var sub = subline(c);
    if (sub) main.appendChild(fillHighlighted(doc, el(doc, "span", "contacts-row__sub line"), sub, q));
    // K1: defensive label badges — shown only if the row carries labels (honest).
    var badges = labelBadges(doc, c.labels);
    if (badges) main.appendChild(badges);
    btn.appendChild(main);
    if (typeof onOpen === "function") btn.addEventListener("click", function () { onOpen(c); });
    li.appendChild(btn);
    // Star toggle (write axis). Reflects current state; the flip is optimistic-then-honest.
    var star = el(doc, "button", "contacts-row__star" + (c.starred ? " is-starred" : ""),
      { type: "button", "aria-pressed": c.starred ? "true" : "false", "aria-label": (c.starred ? "Unstar " : "Star ") + (c.display_name || "contact"), text: c.starred ? "\u2605" : "\u2606" });
    if (typeof onStar === "function") star.addEventListener("click", function (e) { e.stopPropagation(); onStar(c, star); });
    li.appendChild(star);
    return li;
  }

  /* ---- the actions strip (record interior) ---------------------------------- *
   * merge is FULLY wired (pure /api/contact/* — the seam-exercising write, ask-  *
   * first). EMAIL is now wired too (E1): it dispatches forest:compose {to} to the *
   * shell host, which navigates to Mail and opens a pre-addressed compose (mail   *
   * owns compose; contacts only carries the address — TC-1). file-to-tree /       *
   * add-relationship remain J3 merged-line surfaces — HONEST deferred affordances *
   * (disabled + a "soon" note), never a silent no-op that looks live.             */
  function actionsStrip(doc, contact, api, host, rerender) {
    var strip = el(doc, "div", "contacts-record__actions");
    function deferred(label, why) {
      var b = el(doc, "button", "contacts-action contacts-action--deferred",
        { type: "button", disabled: "disabled", title: why, text: label });
      return b;
    }
    // E1 — "Email" is now WIRED (the mail seam this boundary note always deferred to):
    // it dispatches forest:compose {to} to the shell host, which navigates to Mail and opens
    // a compose pre-addressed to this person. Contacts carries only the address (TC-1). Honest:
    // a contact with NO address on file keeps the button DEFERRED — you cannot pre-address a
    // compose to an address that doesn't exist (the same flag-don't-fake as E2's autocomplete).
    var emailAddr = primaryEmailOf(contact);
    if (emailAddr) {
      var emailBtn = el(doc, "button", "contacts-action",
        { type: "button", title: "Email " + emailAddr, "aria-label": "Email " + (contact.display_name || "this contact"), text: "Email" });
      emailBtn.addEventListener("click", function () { emitCompose(emailBtn, emailAddr); });
      strip.appendChild(emailBtn);
    } else {
      strip.appendChild(deferred("Email", "no email address on file"));
    }
    // "File to a tree" is E7 in the Weave — the soil seam, genuinely NOT BUILT. It stays
    // deferred, but its REASON is re-worded: it used to say "wired at the Confluence," and
    // the Confluence landed at. The affordance was honest; the reason it gave had
    // expired. A deferral must say WHY it is deferred, and "wait for an event that already
    // happened" is not a why.
    strip.appendChild(deferred("File to a tree", "not built yet \u2014 the soil seam (E7)"));

    // "Add relationship" USED TO BE DEFERRED HERE. It is not deferred. It is LIVE, and it
    // has been since K3 — the working "Link" form is rendered by renderContext, on this very
    // record, a few inches below this strip. So this button was a disabled control sitting
    // directly above the functioning version of itself, telling Shea a feature was unbuilt
    // while the feature worked. Removed. The live form is the affordance.
    //
    // The two faults share one root and it is the fault class of this whole line: a deferral
    // note is written honestly, the thing it defers to LANDS, and nobody goes back to the
    // note. The note does not decay into vagueness — it decays into a confident false claim,
    // and it does it in production, where it is the only thing the operator can actually see.
    // Merge — fully in-boundary, ask-first. Exercises a destructive seam write.
    var mergeBtn = el(doc, "button", "contacts-action", { type: "button", text: "Merge\u2026" });
    mergeBtn.addEventListener("click", function () {
      mergeBtn.disabled = true;
      // suggest-merges is a READ (GET, read-only) — distinct from the merge POST.
      api.suggestMerges().then(function (env) {
        mergeBtn.disabled = false;
        if (!env.ok) { flashWrite(mergeBtn, false, "couldn\u2019t reach merge candidates"); return; }
        openMergePrompt(doc, contact, env.data, api, host, rerender);
      });
    });
    strip.appendChild(mergeBtn);
    return strip;
  }

  /* ---- K2/ §07 — THE MERGE COMPARE DIALOG ------------------------------ *
   * The shape the TOOL actually sends (loopcontact.js:2593 suggestMerges ->        *
   * :2859 `GET /api/contacts/suggest-merges`):                                     *
   *                                                                                *
   *     { candidates: [ { contact_a, contact_b, reasons: ["content_hash", ...] } ] }*
   *                                                                                *
   * Two ids and a list of REASONS. No display_name. No confidence. No score. And    *
   * the list is the WHOLE BOOK's candidate pairs — it is not scoped to any contact. *
   *                                                                                *
   * The prompt this replaces read `cand.display_name || cand.name || cand.merged_id *
   * || cand.id` and `cand.confidence ?? cand.score`. NONE of those keys exist on the*
   * wire, so every row painted the literal string "(candidate)", `otherId` came back *
   * `undefined`, and every Merge click died on "candidate has no id". The merge      *
   * affordance was DEAD ON ARRIVAL — the same disease as the search pane (slot 04):  *
   * a client written from the caller's ASSUMPTION about the server instead of from   *
   * the server's SOURCE. It shipped with a green suite over it because the test      *
   * double lied in exactly the same direction as the client. Owed:                   *
   * `contacts-suggestmerges-response-shape` — this is it, and it was never a missing *
   * pin; it was a live bug.                                                          *
   *                                                                                  *
   * TC-1 holds throughout: the TOOL decides the merge. The dialog carries the user's *
   * per-field intent as `field_choices` (VALUES, not side-labels — the tool derives  *
   * survivor/merged by comparing the value it was handed against the survivor's, at  *
   * loopcontact.js:2455). It computes no similarity, invents no confidence, and shows *
   * the tool's `reasons` verbatim.                                                    */

  /* The 8 scalar fields the tool RESOLVES via field_choices (loopcontact.js:2448).
     Every OTHER field (emails, phones, addresses, labels, links) is UNIONED by the
     tool and cannot be picked — offering a picker for one would be a lie about what
     the button does. This list is a mirror of a substrate array, which is exactly the
     copy-drift the line keeps finding; so it is FOLDED, not copied: contacts-merge.test.js
     reads `_tools/loopcontact.js`, parses the real `scalarFields` array, and fails loud
     if these two ever disagree. The test IS the wire. */
  var MERGE_SCALAR_FIELDS = ["display_name", "given_name", "family_name",
    "organization", "title", "primary_email", "primary_phone", "notes"];

  var FIELD_LABEL = {
    display_name: "name", given_name: "first", family_name: "last",
    organization: "organization", title: "title",
    primary_email: "email", primary_phone: "phone", notes: "notes"
  };
  // The tool's reason codes, said in English. An UNKNOWN code is shown VERBATIM
  // rather than dropped — a reason we cannot name is still the tool's evidence.
  var REASON_LABEL = {
    content_hash: "identical record", email: "shared email",
    phone: "shared phone", name: "similar name"
  };
  function reasonText(reasons) {
    if (!reasons || !reasons.length) return "";
    return reasons.map(function (r) { return REASON_LABEL[r] || String(r); }).join(" \u00B7 ");
  }

  /* Scope the tool's GLOBAL pair list to the opened contact and name the OTHER side.
     A pair that does not contain this contact is not this contact's candidate. */
  function candidatesFor(contactId, suggestData) {
    var all = (suggestData && suggestData.candidates) || [];
    var out = [];
    all.forEach(function (cand) {
      if (!cand) return;
      var a = cand.contact_a, b = cand.contact_b;
      if (a !== contactId && b !== contactId) return;
      out.push({ otherId: (a === contactId ? b : a), reasons: cand.reasons || [] });
    });
    return out;
  }

  function isBlank(v) { return v == null || String(v) === ""; }

  // Ask-first merge prompt (UI gate — NOT business logic; the tool decides the merge).
  function openMergePrompt(doc, contact, suggestData, api, host, rerender) {
    var cands = candidatesFor(contact.id, suggestData);
    var box = el(doc, "div", "contacts-merge");
    box.appendChild(el(doc, "div", "contacts-merge__head", { text: "Merge candidates for " + (contact.display_name || "this contact") }));
    if (!cands.length) {
      // Honest-empty: the tool ran and found nothing for THIS contact. Not a failure.
      box.appendChild(el(doc, "p", "contacts-empty", { text: "No merge candidates found for this contact." }));
      host.appendChild(box);
      return;
    }
    var ul = el(doc, "ul", "contacts-merge__list");
    cands.slice(0, 8).forEach(function (cand) {
      var li = el(doc, "li", "contacts-merge__row");
      // The candidate carries an ID, not a name. Fetch the record — do not fabricate a label.
      var nameNode = el(doc, "span", "contacts-merge__name field", { text: "Reading\u2026" });
      li.appendChild(nameNode);
      var why = reasonText(cand.reasons);
      // The tool's evidence, VERBATIM (Real-or-Made). There is no confidence score on this wire.
      if (why) li.appendChild(el(doc, "span", "contacts-merge__reason", { text: why }));
      var go = el(doc, "button", "contacts-action", { type: "button", text: "Compare\u2026" });
      go.disabled = true;
      li.appendChild(go);
      ul.appendChild(li);
      if (!api || typeof api.get !== "function") { nameNode.textContent = cand.otherId; return; }
      api.get(cand.otherId).then(function (env) {
        if (!env || !env.ok || !env.data) {
          nameNode.textContent = cand.otherId;   // the id is true; a name would not be
          go.disabled = false;
          go.addEventListener("click", function () { flashWrite(go, false, "couldn\u2019t read that contact"); });
          return;
        }
        var other = env.data.contact || env.data;
        nameNode.textContent = other.display_name || other.primary_email || cand.otherId;
        go.disabled = false;
        go.addEventListener("click", function () {
          openCompareDialog(doc, contact, other, cand.reasons, api, host, rerender);
        });
      });
    });
    box.appendChild(ul);
    host.appendChild(box);
  }

  /* The CompareDialog — side-by-side A/B on the tool's resolvable fields, a per-field
     survivor pick, and an explicit choice of WHICH RECORD SURVIVES. Posts field_choices.
     Defaults MIRROR the tool's own resolution (loopcontact.js:2453-2467): the survivor's
     value wins when it has one, else the merged record's. So an untouched dialog sends
     exactly what the tool would have done on its own — the dialog never silently changes
     the outcome just by being opened. */
  function openCompareDialog(doc, contact, other, reasons, api, host, rerender) {
    var dlg = el(doc, "div", "contacts-compare");
    var survivorId = contact.id;                 // the opened contact survives by default
    var picks = {};                              // field -> chosen VALUE (only where set)

    dlg.appendChild(el(doc, "div", "contacts-compare__head", { text: "Compare and merge" }));
    var why = reasonText(reasons);
    if (why) dlg.appendChild(el(doc, "p", "contacts-compare__reason line", { text: "The tool matched these on: " + why }));

    // Which record survives. The other one is absorbed; the tool marks it status='merged'.
    var survRow = el(doc, "div", "contacts-compare__survivor");
    survRow.appendChild(el(doc, "span", "contacts-compare__survivor-label", { text: "Keep" }));
    var pair = [contact, other];
    var survBtns = [];
    pair.forEach(function (rec) {
      var b = el(doc, "button", "contacts-compare__keep", { type: "button", text: rec.display_name || rec.primary_email || rec.id });
      b.setAttribute("data-id", rec.id);
      b.addEventListener("click", function () { survivorId = rec.id; picks = {}; paint(); });
      survBtns.push(b);
      survRow.appendChild(b);
    });
    dlg.appendChild(survRow);

    var grid = el(doc, "div", "contacts-compare__grid");
    dlg.appendChild(grid);

    var foot = el(doc, "div", "contacts-compare__foot");
    var goBtn = el(doc, "button", "contacts-action contacts-compare__go", { type: "button", text: "Merge" });
    var cancel = el(doc, "button", "contacts-action", { type: "button", text: "Cancel" });
    cancel.addEventListener("click", function () { if (dlg.parentNode) dlg.parentNode.removeChild(dlg); });
    foot.appendChild(goBtn);
    foot.appendChild(cancel);
    dlg.appendChild(foot);

    function survivor() { return survivorId === contact.id ? contact : other; }
    function absorbed() { return survivorId === contact.id ? other : contact; }
    // The tool's own default, reproduced exactly: survivor's value unless it is blank.
    function defaultFor(field) {
      var s = survivor()[field];
      return !isBlank(s) ? s : absorbed()[field];
    }
    function chosenFor(field) {
      return Object.prototype.hasOwnProperty.call(picks, field) ? picks[field] : defaultFor(field);
    }

    function paint() {
      survBtns.forEach(function (b) {
        var on = b.getAttribute("data-id") === survivorId;
        b.classList.remove("is-on");
        if (on) b.classList.add("is-on");
      });
      grid.textContent = "";
      MERGE_SCALAR_FIELDS.forEach(function (field) {
        var sv = survivor()[field], av = absorbed()[field];
        // Nothing on either side: nothing to decide. Do not paint an empty argument.
        if (isBlank(sv) && isBlank(av)) return;
        var row = el(doc, "div", "contacts-compare__row");
        row.setAttribute("data-field", field);
        row.appendChild(el(doc, "span", "contacts-compare__field", { text: FIELD_LABEL[field] || field }));
        var chosen = chosenFor(field);
        var conflict = !isBlank(sv) && !isBlank(av) && String(sv) !== String(av);
        if (conflict) row.classList.add("is-conflict");
        [[sv, survivor().id], [av, absorbed().id]].forEach(function (sidePair) {
          var val = sidePair[0];
          var side = el(doc, "button", "contacts-compare__val", {
            type: "button",
            text: isBlank(val) ? "\u2014" : String(val)          // an em-dash IS the honest empty
          });
          side.setAttribute("data-side", sidePair[1] === survivorId ? "keep" : "absorb");
          if (isBlank(val)) side.classList.add("is-blank");
          if (String(chosen == null ? "" : chosen) === String(val == null ? "" : val)) side.classList.add("is-picked");
          side.addEventListener("click", function () { picks[field] = (val == null ? null : val); paint(); });
          row.appendChild(side);
        });
        grid.appendChild(row);
      });
      if (!grid.childNodes.length) {
        grid.appendChild(el(doc, "p", "contacts-compare__empty line", { text: "These two records carry no differing fields \u2014 the merge is a straight absorb." }));
      }
    }
    paint();

    goBtn.addEventListener("click", function () {
      goBtn.disabled = true;
      // Send a choice ONLY where the two records genuinely disagree, or where the user
      // overrode the default. Fields that agree need no instruction — the tool's own
      // resolution already lands on the same value, and sending noise would let a future
      // change of ours silently override a change of theirs.
      var fieldChoices = {};
      MERGE_SCALAR_FIELDS.forEach(function (field) {
        var sv = survivor()[field], av = absorbed()[field];
        var differ = String(sv == null ? "" : sv) !== String(av == null ? "" : av);
        var overridden = Object.prototype.hasOwnProperty.call(picks, field);
        if (differ || overridden) fieldChoices[field] = chosenFor(field);
      });
      api.merge(contact.id, other.id, {
        survivorId: survivorId,
        fieldChoices: fieldChoices,
        reason: "manual compare"
      }).then(function (env) {
        // F3, the honest write axis: a merge that did not land NEVER renders as landed.
        if (!env || !env.ok) { goBtn.disabled = false; flashWrite(goBtn, false, "merge failed \u2014 nothing was changed"); return; }
        flashWrite(goBtn, true);
        if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
        if (typeof rerender === "function") rerender();
      });
    });

    host.appendChild(dlg);
  }

  // Write-axis feedback: a brief saving->saved / unsaved flash on a control.
  function flashWrite(node, ok, why) {
    node.classList.remove("is-saving");
    node.classList.add(ok ? "is-saved" : "is-unsaved");
    if (!ok && why) node.setAttribute("title", why);
    setTimeout(function () { node.classList.remove("is-saved", "is-unsaved"); }, 1600);
  }

  /* ---- the LIST view --------------------------------------------------------- */
  /* ---- K5: import / export (list-level) ------------------------------------- *
   * Export pulls the tool's payload and offers a download; Import sends raw text   *
   * + a format flag and lets the TOOL parse (TC-1: no vCard/CSV parsing here).      */
  function triggerDownload(doc, text, filename, mime) {
    // cold-safe: only in a real browser with Blob/URL; a no-op in the test DOM.
    try {
      if (typeof Blob !== "function" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return false;
      var blob = new Blob([text], { type: mime });
      var a = doc.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      if (typeof a.click === "function") a.click();
      return true;
    } catch (e) { return false; }
  }
  // `onImport(text, fmt) -> Promise<{ok}>` is the C3 seam. Before C3 this bar POSTed the import,
  // flashed the button green and called `onDone()` WITH NO ARGUMENTS — throwing away everything
  // the tool handed back (`imported`, `contact_ids`, `merge_candidates`; loopcontact.js runs
  // suggestMerges() after every import and answers with all three). The result set was already on
  // the wire; only the client was deaf to it. The bar no longer owns the outcome: it hands the
  // text to the list, which owns the book, the selection and the recovery.
  // Phase 3 slice 3 — export-with-PHOTO (the fenced shell-side splice; TC-1 kept).
  // Export stays TC-1: the tool serializes the vCard (api.exportAll). Photos are client-sovereign
  // in the blob store — the tool cannot see them. So the shell does a BOUNDED, FENCED splice, NOT
  // a parser: for each BEGIN:VCARD..END:VCARD block it reads ONLY the FN line (to match the card to
  // a contact), and if that contact has a photo blob, inserts exactly ONE line. No field is parsed,
  // no field is rewritten — that is what keeps it on the right side of the TC-1 no-shell-parse line.
  function normPhotoKey(s) { return String(s == null ? "" : s).trim().toLowerCase(); }
  // PURE. `photoLineByKey`: normalized-FN -> a ready PHOTO line string. For each vCard block: skip if
  // it already carries a PHOTO; read its FN (unfolding RFC-6350 line folds for the match value only);
  // if a photo line exists for that key, insert it right after the VERSION line (else after BEGIN).
  // A card with no match / no blob passes through VERBATIM; blocks are matched independently so an
  // adjacent card is never touched. The value we emit is pure base64 (PHOTO;ENCODING=b;TYPE=JPEG:),
  // whose alphabet has no ';'/',' — so it survives the tool's vcard:* round-trip escaping intact
  // (the data-URI form's ';'/',' would be escaped and corrupt the value on re-export).
  function spliceVCardPhotos(vcardText, photoLineByKey) {
    if (!vcardText || !photoLineByKey) return vcardText;
    return String(vcardText).replace(/BEGIN:VCARD[\s\S]*?END:VCARD/g, function (block) {
      if (/(^|\r?\n)PHOTO[;:]/.test(block)) return block;              // already has a photo -> leave it
      var fnMatch = block.match(/(^|\r?\n)FN:([^\r\n]*(?:\r?\n[ \t][^\r\n]*)*)/);
      if (!fnMatch) return block;
      var fn = fnMatch[2].replace(/\r?\n[ \t]/g, "");                  // unfold the folded FN value
      var key = normPhotoKey(fn);
      var line = key ? photoLineByKey[key] : null;
      if (!line) return block;
      var vm = block.match(/(^|\r?\n)(VERSION:[^\r\n]*)/);
      if (vm) return block.replace(vm[2], vm[2] + "\r\n" + line);      // after VERSION (the canonical spot)
      return block.replace(/BEGIN:VCARD/, "BEGIN:VCARD\r\n" + line);   // fallback: right after BEGIN
    });
  }
  // Read a blob as raw base64 (strip the FileReader data-URI prefix). Cold-safe: any failure -> "".
  function blobToBase64(blob) {
    return new Promise(function (resolve) {
      try {
        var view = (typeof window !== "undefined") ? window : {};
        var FR = view.FileReader || (typeof FileReader !== "undefined" ? FileReader : null);
        if (!FR) { resolve(""); return; }
        var fr = new FR();
        fr.onload = function () { var s = String(fr.result || ""); var i = s.indexOf("base64,"); resolve(i >= 0 ? s.slice(i + 7) : ""); };
        fr.onerror = function () { resolve(""); };
        fr.readAsDataURL(blob);
      } catch (e) { resolve(""); }
    });
  }
  // Async pre-step for the splice: list the contacts (id + display_name), and for each one that has a
  // photo blob under contact:<id>, resolve base64 and key a ready PHOTO line by normalized display_name.
  // Cold-safe: no store / no api.list / no FileReader -> {} (export is byte-unchanged). The match is by
  // display_name because the tool emits NO UID in the vCard (verified: loopcontact.js serializeVCard
  // writes FN/N/EMAIL/TEL, never a UID); a duplicate display_name is an accepted V1 limit (first wins).
  function buildPhotoLines(api, store) {
    if (!store || !api || typeof api.list !== "function") return Promise.resolve({});
    return api.list({ limit: 100000, offset: 0 }).then(function (env) {
      var contacts = (env && env.ok && env.data && env.data.contacts) || [];
      var out = {};
      var chain = Promise.resolve();
      contacts.forEach(function (c) {
        if (!c || c.id == null || !c.display_name) return;
        chain = chain.then(function () {
          return store.get(store.keyFor("contact", c.id)).then(function (blob) {
            if (!blob) return;
            return blobToBase64(blob).then(function (b64) {
              if (b64) out[normPhotoKey(c.display_name)] = "PHOTO;ENCODING=b;TYPE=JPEG:" + b64;
            });
          }).catch(function () { /* cold-safe: one bad blob never fails the export */ });
        });
      });
      return chain.then(function () { return out; });
    }).catch(function () { return {}; });
  }

  function importExportBar(doc, api, onDone, onImport) {
    // The sovereign photo store (Phase 2 / slice 3): where per-contact photo blobs live, keyed
    // contact:<id>. Cold-safe: absent -> the export splice resolves to {} and the vCard is unchanged.
    var photoStore = (root.blobStore && typeof root.blobStore.defaultBlobStore === "function")
      ? root.blobStore.defaultBlobStore() : null;
    var wrap = el(doc, "div", "contacts-io");
    // export
    var exp = el(doc, "div", "contacts-io__export");
    function exporter(label, fmt, fname, mime) {
      var b = el(doc, "button", "contacts-io__exp", { type: "button", text: label });
      b.addEventListener("click", function () {
        if (!api || typeof api.exportAll !== "function") return;
        b.disabled = true;
        api.exportAll(fmt).then(function (env) {
          if (!(env && env.ok && env.data)) { b.disabled = false; flashWrite(b, false, "couldn\u2019t export"); return; }
          if (fmt === "csv") {                              // CSV carries no photo field — unchanged
            b.disabled = false;
            if (!triggerDownload(doc, env.data.csv || "", fname, mime)) flashWrite(b, false, "download unavailable");
            return;
          }
          // vCard: splice each contact's sovereign photo blob in as one PHOTO line (slice 3, TC-1).
          var text = env.data.vcard || "";
          buildPhotoLines(api, photoStore).then(function (photoLineByKey) {
            b.disabled = false;
            var out = spliceVCardPhotos(text, photoLineByKey);
            if (!triggerDownload(doc, out, fname, mime)) flashWrite(b, false, "download unavailable");
          });
        });
      });
      return b;
    }
    exp.appendChild(exporter("Export vCard", null, "contacts.vcf", "text/vcard"));
    exp.appendChild(exporter("Export CSV", "csv", "contacts.csv", "text/csv"));
    wrap.appendChild(exp);
    // import
    if (api && typeof api.importText === "function") {
      var imp = el(doc, "div", "contacts-io__import");
      var ta = el(doc, "textarea", "contacts-io__text field",
        { rows: "3", placeholder: "Paste vCard or CSV\u2026", "aria-label": "Import contacts text" });
      var fmt = el(doc, "select", "contacts-io__fmt field", { "aria-label": "Import format" });
      var oV = el(doc, "option", null, { value: "vcard", text: "vCard" });
      var oC = el(doc, "option", null, { value: "csv", text: "CSV" });
      fmt.appendChild(oV); fmt.appendChild(oC);
      var go = el(doc, "button", "contacts-io__go", { type: "button", text: "Import" });
      go.addEventListener("click", function () {
        var text = (ta.value || "").trim();
        if (!text) return;
        go.disabled = true;
        var run = (typeof onImport === "function")
          ? onImport(text, fmt.value)
          : api.importText(text, fmt.value).then(function (env) {
              if (env && env.ok && typeof onDone === "function") onDone();
              return { ok: !!(env && env.ok) };
            });
        run.then(function (r) {
          go.disabled = false;
          // The flash is now only ever a flash. It is NOT the report — the band is, and the band
          // speaks the tool's own numbers. A green button that says nothing is how "couldn't
          // import" came to mean "nothing happened" (it didn't; see the strand, C3-E).
          if (r && r.ok) { ta.value = ""; flashWrite(go, true); }
          else { flashWrite(ta, false, "couldn\u2019t import"); }
        });
      });
      imp.appendChild(ta); imp.appendChild(fmt); imp.appendChild(go);
      wrap.appendChild(imp);
    }
    return wrap;
  }

  function renderList(host, ctx, api, injected, openRecord, openMyCard, renderOwnerMasthead) {
    var doc = host.ownerDocument;
    host.textContent = "";
    // /SL-2 — the app-scoped search moves to the LEFT RAIL under Compose (renderRail,
    // .rail__search), one home, the calendar shape — WHEN there is a rail. The `search` element
    // is still BUILT here (its `state.q` listener + the rail-slot clears reference this exact
    // element) and HOSTED into the rail by repaintRail (opts.searchEl). In the anchor-only
    // shippable state (no ctx.menuBody -> no rail column, §3.2), there is no rail to host
    // it, so it stays in the list head where it always was — the capability never vanishes.
    var hasRail = !!(ctx && ctx.menuBody);
    var search = el(doc, "input", "contacts-list__search field",
      { type: "search", placeholder: "Search contacts\u2026", "aria-label": "Search contacts" });
    // §7.2 — the `.contacts-list__starred` head button is RETIRED. Starred moved to the
    // rail's `.rail__slot` (decision doc §5), so the filter has exactly ONE home — mail's move
    // exactly: it put Compose in `.rail__compose` and retired the strip's "New message" for the
    // same reason. Two homes for one filter is the defect the block exists to remove. The rail
    // slot DRIVES `state.starredOnly` below — the SAME state, the SAME refresh(), the SAME query.
    // The rail is not a new filter engine; it is the new home of the filters that already existed.
    // K5: import/export bar (list-level; re-reads the list after a successful import). Sits at the TOP
    // of the list (above the rows) so the affordance is visible at a glance — parity with Calendar's
    // Import/Export .ics; previously appended after the body, it was buried below the full contact list.
    host.appendChild(importExportBar(doc, api, function () { refresh(); },
      function (text, fmt) { return handleImport(text, fmt); }));

    // Anchor-only fallback (no rail column): search has no rail to live in, so keep it in the
    // list head — its old home — so a null column never costs the person the search box. When a
    // rail IS present, repaintRail hosts `search` in it (opts.searchEl) and this head is skipped.
    if (!hasRail) {
      var listHead = el(doc, "div", "contacts-list__head");
      listHead.appendChild(search);
      host.appendChild(listHead);
    }

    var body = el(doc, "div", "contacts-list__body");
    // NOTE: `body` is APPENDED below, after the C2 bulk bar + undo toast, so the two sit
    // above the rows (mail's placement) without an insertBefore — plain appends, in order.

    var state = { starredOnly: false, q: "", dueOnly: false, label: null };
    var dueIds = null;   // K4: contact ids with an OPEN follow-up due (cross-contact)
    // K6-A: the label vocabulary, from GET /api/labels. NULL until it lands, and it only
    // ever lands on the LIVE path — which is the point. A label slot is a SERVER filter
    // (list({label})) with no client-side equivalent, because the list rows do not carry
    // their labels. So on the injected path (tests, host pre-fetch) the vocabulary never
    // arrives, no label slot is ever built, and a slot the rows could not obey cannot be
    // lit. The rail's rule — a lit slot the rows do not obey is unreachable — is held here
    // by construction rather than by a client-side filter that has no data to filter on.
    var labelVocab = null;
    // GROUPS V1 — declared managed groups (sessions/20.1753 groups-v1-build-ready-design).
    // A contact LABEL exists only as a membership row, so an empty label has no home and the
    // rail hides it. A managed GROUP must persist while empty — so its existence+order+colour
    // live in view-config (the calOrder precedent), while membership rides the existing label
    // API (zero edit to the byte-frozen loopcontact.js). We resolve view-config off `root`
    // the sibling way — `root.viewConfig` — NEVER `root.ForestShell.viewConfig`: `root` IS
    // window.ForestShell (see :55), so the double-nest reads ForestShell.ForestShell.* =
    // always undefined, the exact seam that shipped a dead calMod picker for a whole release
    // (calendar-renderer :2905; guarded by contacts-groups-resolution.test.js here).
    // Optimistic local copy (the calendar rail pattern): seeded from ctx.config at render,
    // updated in-hand on create/delete so a fresh empty group shows immediately; shell-boot
    // persists the authoritative copy back through view-config on the emitted events.
    var declaredGroups = (root.viewConfig && typeof root.viewConfig.contactGroupsOf === "function")
      ? root.viewConfig.contactGroupsOf(ctx.config) : [];
    function isDeclaredGroup(name) {
      for (var i = 0; i < declaredGroups.length; i++) { if (declaredGroups[i].name === name) return true; }
      return false;
    }
    // C3-A: THE CEILING. The renderer used to send no `limit` at all, so it silently inherited
    // the substrate's CONTACTS_PER_PAGE_DEFAULT (50) — a ceiling nobody in this pane chose, that
    // this pane could not see, and that it had no way to climb past: there was no pagination here,
    // at all, ever. A 248-person book rendered 50 rows under a census that read "248 people". The
    // fix is not a bigger silent number; it is an EXPLICIT page the renderer owns, plus a real way
    // to reach the rest, plus a census that admits the difference.
    var PAGE_SIZE = 200;
    var page = { rows: [], total: 0, pageable: false };   // pageable=false for a search (the FTS
                                                          // envelope carries no `total` and no offset)
    var lastEnv = null;  // held so the due-set arrival re-paints without a re-fetch

    /* ==== C2 — multi-select + bulk (§5) ================================== *
     * Client-only. Consumes `POST /api/contacts/bulk` — BUILT and tested at REST with
     * no UI at all (contacts-rest.js:331). Zero new scope, zero runtime change, zero
     * substrate change. Selection lives in THIS closure (like `state` and `dueIds`), so
     * a repaint — a keystroke, a rail slot, the due-set landing — keeps it.
     *
     * ⚠ THE SAFETY MODEL IS *NOT* MAIL'S, AND THE DIFFERENCE IS LOAD-BEARING.
     * mail-renderer.js:3513 reasons, in its own source: "the two v1 actions are archive +
     * mark-read — both label-only and REVERSIBLE, so there is no blocking confirm; the undo
     * toast IS the safety net." That premise is TRUE for mail and FALSE for contacts:
     *
     *   loopcontact.js:1164 —  } else { // delete — hard purge, mirroring the single-contact
     *                            deleteContact(db, rt, id, { purge: true, confirm: true });
     *
     * `bulk(ids,'delete')` is a HARD PURGE: cascade FK delete of the row, its emails, phones,
     * addresses, fields and entity_links, plus its graph node and every edge. There is no
     * trash. There is nothing to undo TO. Wiring it behind mail's no-confirm toast would ship a
     * one-click irreversible erasure of the address book — Dara's 3am test with the sign flipped.
     *
     * What IS reversible, and what the plan's "bulk delete is the undo of a bad import" (C3)
     * actually wants, is the OTHER action the same verb already carries:
     *   listContacts() defaults to  WHERE status = 'active'  (loopcontact.js:1088)
     *   -> bulk(ids,'status','inactive') REMOVES the rows from every list, and
     *      bulk(ids,'status','active')   PUTS THEM BACK.
     * That is archive. It is mail's archive exactly — reversible, list-removing — and it is the
     * action that earns mail's toast. So:
     *
     *   Label          additive · idempotent server-side · undo = removeLabel over the same ids
     *   Archive        status->inactive · REVERSIBLE      · undo = status->active over the same ids
     *   Delete forever HARD PURGE · IRREVERSIBLE          · a blocking typed confirm. NO toast —
     *                  a toast on a purge is a lie about what the button did.
     *
     * The SELECTION controller is mail's, verbatim in shape ({ enabled, has, toggle }) —
     * §5 C2's "the shape to reuse, not re-invent." The BULK BAR's safety model is derived from
     * this app's own bytes, because mail's was derived from mail's. Same alphabet, honest verbs. */
    var selected = {};          // id -> contact (the live selection)
    var bulkBusy = false;
    var lastShown = [];         // the rows paint() last rendered (for "select all in view")
    var confirmOpen = false;    // the purge confirm expander; survives repaints via this flag

    function selIds()   { return Object.keys(selected); }
    function selCount() { return selIds().length; }
    function selHas(id) { return Object.prototype.hasOwnProperty.call(selected, String(id)); }
    function selToggle(id, c) {
      id = String(id);
      if (selHas(id)) delete selected[id]; else selected[id] = c;
      paintBulkBar();
      return selHas(id);
    }
    function selClear() { selected = {}; confirmOpen = false; paintBulkBar(); }
    // The controller threaded into rowNode. `enabled` is TRUE unconditionally: unlike mail's
    // gmail-modify Warrant, bulk here is the tool's own verb over the owner's own records — no
    // grant to resolve, nothing to gate on. Gating it would refuse a capability that exists.
    var selectCtl = { enabled: true, has: selHas, toggle: selToggle };

    // Bar + toast, both ABOVE the list (mail's placement). Empty at rest -> `:empty{display:none}`
    // keeps the resting surface calm: nothing appears until the first box is ticked.
    var bulkBar = el(doc, "div", "contacts__bulk strip");
    var undoBar = el(doc, "div", "contacts__undo");
    var importBand = el(doc, "div", "contacts__import-band");   // C3 — empty at rest
    host.appendChild(importBand);
    host.appendChild(bulkBar);
    host.appendChild(undoBar);
    host.appendChild(body);        // the rows land last — band, bar, toast, then list

    /* ==== C3-C/D/E — THE IMPORT RESULT SET ======================================= *
     * `importScope` is non-null exactly while the list is showing the OUTCOME of an import
     * rather than the book: the rows are scoped to the ids the TOOL SAYS IT CREATED
     * (`contact_ids`) — never a timestamp heuristic, never "the newest rows", never a guess.
     *
     * ⚠ C3-D — C3's OWN SENTENCE IS WRONG, AND THIS IS THE PIN.
     * The plan says: "bulk delete on a selection is the undo of an import." It is not.
     * `bulk(ids,'delete')` is a HARD CASCADE PURGE (loopcontact.js:1164) — the contact, its
     * emails, phones, addresses, fields, entity_links, its graph node and every edge. There is
     * no trash. Volunteering that as the RECOVERY AFFORDANCE FOR A MISTAKE — offered to a person
     * who has just botched an import and is clicking fast — would make an unconfirmed,
     * irreversible erasure the DEFAULT response to an error. The undo of an import is ARCHIVE:
     * `listContacts()` filters to status='active' (loopcontact.js:1088), so status->inactive IS
     * the removal, and status->active puts it straight back. Reversible, list-removing, and the
     * word "undo" stays true. The purge is not removed — it stays one click away behind C2's
     * blocking confirm (C3-D7). Reachable, never offered. Do not "simplify" this back to the
     * plan's wording; contacts-import.test.js C3-D3 is the assertion that screams if you do. */
    var importScope = null;    // { ids:[…], kind:'imported'|'stranded', n, dupes }

    function clearScope() { importScope = null; clearNode(importBand); }

    // The whole book's id-set, read fresh. NOT `page.rows` — that is a truncated, possibly
    // filtered VIEW, and a set-difference over a view is not a set-difference over the book.
    function bookIds() {
      if (!api || typeof api.list !== "function") return Promise.resolve(null);
      return api.list({ limit: 100000, offset: 0 }).then(function (env) {
        if (!env || !env.ok || !env.data) return null;   // could not read -> we do NOT get to guess
        var m = {};
        (env.data.contacts || []).forEach(function (c) { if (c && c.id != null) m[String(c.id)] = true; });
        return m;
      });
    }

    // Narrow the list to exactly `ids` and speak the band over it.
    function scopeTo(ids, meta) {
      var want = {};
      ids.forEach(function (id) { want[String(id)] = true; });
      return api.list({ limit: 100000, offset: 0 }).then(function (env) {
        var all = (env && env.ok && env.data && env.data.contacts) || [];
        var found = all.filter(function (c) { return want[String(c.id)]; });
        importScope = { ids: ids.map(String), kind: meta.kind, n: meta.n, dupes: meta.dupes || 0 };
        page.rows = found;
        page.pageable = false;      // a result set is complete by construction — there is no page 2
        page.total = found.length;
        state.q = "";
        paint({ ok: true, data: { contacts: found, total: found.length } });
        paintBand();
      });
    }

    function paintBand() {
      clearNode(importBand);
      if (!importScope) return;
      var s = importScope;
      var n = s.n;
      var line = (s.kind === "stranded")
        ? (n + " " + (n === 1 ? "contact" : "contacts") + " had already been created before the import failed.")
        : (n + " " + (n === 1 ? "contact" : "contacts") + " imported.");
      importBand.appendChild(el(doc, "span", "contacts__import-msg",
        { text: line, role: "status", "aria-live": "polite" }));
      if (s.kind !== "stranded" && s.dupes) {
        // The tool ran suggestMerges() for us and handed the number back. Saying it costs nothing
        // and NOT saying it is how 2 duplicates become 200.
        importBand.appendChild(el(doc, "span", "contacts__import-dupes",
          { text: "\u00b7 " + s.dupes + " possible duplicate" + (s.dupes === 1 ? "" : "s") }));
      }

      // One control hands the whole result set to the C2 bulk bar — Label / Archive / the
      // confirm-gated purge, all one gesture away. Nobody fixes 248 rows by hand; they leave.
      var sel = el(doc, "div", "contacts__import-select strip__action",
        { role: "button", tabindex: "0", text: "Select these " + n,
          "aria-label": "Select the " + n + " contact" + (n === 1 ? "" : "s") + " from this import" });
      activate(sel, function () {
        (lastShown || []).forEach(function (c) { if (c && c.id) selected[String(c.id)] = c; });
        paintBulkBar();
      });
      importBand.appendChild(sel);

      // The volunteered recovery. ARCHIVE — reversible by construction (C3-D2/D3).
      var undoIds = s.ids.slice();
      var undo = el(doc, "div", "contacts__import-undo strip__action",
        { role: "button", tabindex: "0",
          text: (s.kind === "stranded" ? "Archive these " + n : "Undo this import"),
          "aria-label": "Archive the " + n + " contact" + (n === 1 ? "" : "s") + " from this import (reversible)" });
      activate(undo, function () {
        if (bulkBusy || !undoIds.length) return;
        clearScope();                       // the recovery returns us to the book, not the result set
        selected = {};
        undoIds.forEach(function (id) { selected[String(id)] = { id: id }; });
        runBulk("status", "inactive", "archived", function () {
          return api.bulk(undoIds, "status", "active").then(function (e) { return !!(e && e.ok); });
        });
      });
      importBand.appendChild(undo);

      // The scope is a MOMENT, not a place. Keeping the import is the do-nothing outcome, so it is
      // the one that costs a single click and takes you straight back to the whole book.
      var dismiss = el(doc, "div", "contacts__import-dismiss contacts__undo-action strip__action",
        { role: "button", tabindex: "0", text: "Keep them",
          "aria-label": "Keep these contacts and show the whole address book" });
      activate(dismiss, function () { clearScope(); selClear(); refresh(); });
      importBand.appendChild(dismiss);
    }

    function bandSays(text) {
      clearNode(importBand);
      importBand.appendChild(el(doc, "span", "contacts__import-msg",
        { text: text, role: "status", "aria-live": "polite" }));
    }

    function handleImport(text, fmt) {
      clearScope();
      selClear();
      // THE SNAPSHOT, taken BEFORE the POST. importVCardText/importCsvText have NO transaction
      // (bulkContactAction, sixty lines away, HAS one: BEGIN/COMMIT/ROLLBACK) — so a throw mid-loop
      // leaves every row before the throw COMMITTED, and the tool reports nothing at all on the
      // failure path. "Couldn't import" has never meant "nothing happened". The only way to know
      // what a failed import left in the address book is to diff the book across it.
      return bookIds().then(function (before) {
        return api.importText(text, fmt).then(function (env) {
          if (env && env.ok) {
            var d = env.data || {};
            var ids = (d.contact_ids || []).map(String);
            var n = (typeof d.imported === "number") ? d.imported : ids.length;
            if (!ids.length) { refresh(); return { ok: true }; }
            return scopeTo(ids, { kind: "imported", n: n, dupes: d.merge_candidates || 0 })
              .then(function () { return { ok: true }; });
          }
          // ---- the failure path: did it strand anything? --------------------------------
          if (!before) {
            // THE HONEST FLOOR. The snapshot could not be taken, so the diff is impossible. We do
            // not invent a recovery and we do not fabricate a reassuring zero — a made-up
            // "0 imported" here is exactly the fabricated-green the F3 honest-write axis forbids.
            bandSays("The import failed, and contacts may still have been created \u2014 " +
                     "your address book could not be read, so I cannot single them out. " +
                     "Reload and check before importing again.");
            return { ok: false };
          }
          return bookIds().then(function (after) {
            if (!after) {
              bandSays("The import failed, and contacts may still have been created \u2014 " +
                       "your address book could not be re-read, so I cannot single them out. " +
                       "Reload and check before importing again.");
              return { ok: false };
            }
            var strand = Object.keys(after).filter(function (id) { return !before[id]; });
            if (!strand.length) { refresh(); return { ok: false }; }   // a clean refusal: nothing landed
            return scopeTo(strand, { kind: "stranded", n: strand.length })
              .then(function () { return { ok: false }; });
          });
        });
      });
    }

    function bulkStatus(text, isErr) {
      clearNode(undoBar);
      undoBar.appendChild(el(doc, "div", "contacts__undo-status" + (isErr ? " contacts__undo-status--error" : ""),
        { text: text, role: "status", "aria-live": "polite" }));
    }
    function clearToast() { clearNode(undoBar); }

    // The undo toast — fires the INVERSE batch over the SAME ids. Offered ONLY where an inverse
    // genuinely exists (label, archive). Never on a purge.
    function showUndo(text, undoFn) {
      clearNode(undoBar);
      undoBar.appendChild(el(doc, "span", "contacts__undo-label", { text: text }));
      var u = el(doc, "span", "contacts__undo-action", { role: "button", tabindex: "0", text: "Undo", "aria-label": "Undo " + text });
      activate(u, function () {
        bulkStatus("Undoing\u2026");
        undoFn().then(function (okAll) {
          if (okAll) bulkStatus("Undone.");
          else bulkStatus("Undo failed \u2014 some records did not change.", true);
          refresh();
        });
      });
      undoBar.appendChild(u);
    }

    function selectAllInView() {
      lastShown.forEach(function (c) { if (c && c.id) selected[String(c.id)] = c; });
      paint(lastEnv || { ok: true, data: { contacts: lastShown } });   // repaint so the boxes tick
    }

    // Run one bulk action. `undo` (optional) is a thunk returning a Promise<bool> — present only
    // for the reversible actions. An absent `undo` means: this cannot be taken back, and the UI
    // must not pretend otherwise.
    function runBulk(action, value, verbPast, undo) {
      if (bulkBusy) return;
      var ids = selIds();
      if (!ids.length) return;
      bulkBusy = true;
      bulkStatus(verbPast.replace(/ed$/, "ing") + " " + ids.length + "\u2026");
      api.bulk(ids, action, value).then(function (env) {
        bulkBusy = false;
        if (!env || !env.ok) {
          // F3 — the honest write axis. A write that did NOT land never renders as landed.
          bulkStatus("Could not " + verbPast.replace(/ed$/, "") + " \u2014 " + ((env && env.error) || "the write did not land") + ".", true);
          return;   // selection KEPT: the records are untouched, so the user's set is still true
        }
        var n = (env.data && typeof env.data.count === "number") ? env.data.count : ids.length;
        var skipped = (env.data && env.data.skipped && env.data.skipped.length) || 0;
        selClear();
        var msg = n + " " + (n === 1 ? "contact" : "contacts") + " " + verbPast +
          (skipped ? " \u00b7 " + skipped + " skipped" : "");
        if (undo) showUndo(msg, undo);
        else bulkStatus(msg);   // no inverse exists -> no Undo affordance. Never a fake one.
        refresh();
      });
    }

    function paintBulkBar() {
      clearNode(bulkBar);
      var n = selCount();
      if (!n) { confirmOpen = false; return; }   // calm at rest
      var ids = selIds();
      bulkBar.appendChild(el(doc, "span", "contacts__bulk-count", { text: n + " selected", "aria-live": "polite" }));

      // ---- Label (additive, idempotent, reversible) ----------------------------
      var labelBtn = el(doc, "div", "contacts__bulk-label strip__action",
        { role: "button", tabindex: "0", text: "Label\u2026", "aria-label": "Add a label to " + n + " selected contact" + (n === 1 ? "" : "s") });
      activate(labelBtn, function () {
        var picker = el(doc, "div", "contacts__bulk-picker");
        var input = el(doc, "input", "field", { type: "text", placeholder: "Label name\u2026", "aria-label": "Label to add" });
        var go = el(doc, "div", "strip__action", { role: "button", tabindex: "0", text: "Apply" });
        function apply() {
          var v = String(input.value || "").trim();
          if (!v) return;   // a known-invalid write is never sent (F3)
          runBulk("label", v, "labeled", function () {
            // The tool has no bulk UNLABEL action — so the inverse is the single verb, per id.
            // Honest: it is a real inverse, it just isn't one call.
            return Promise.all(ids.map(function (id) { return api.removeLabel(id, v); }))
              .then(function (envs) { return envs.every(function (e) { return e && e.ok; }); });
          });
        }
        input.addEventListener("keydown", function (e) { if (e.key === "Enter") apply(); });
        activate(go, apply);
        picker.appendChild(input); picker.appendChild(go);
        bulkBar.appendChild(picker);
        if (input.focus) input.focus();
      });
      bulkBar.appendChild(labelBtn);

      // ---- Archive (status -> inactive) — THE reversible removal -----------------
      // This is what "bulk delete on a selection is the undo of an import" (C3) actually
      // wants. `listContacts()` filters to status='active', so an archived contact leaves every
      // list — and comes straight back when the status flips home.
      var archiveBtn = el(doc, "div", "contacts__bulk-archive strip__action",
        { role: "button", tabindex: "0", text: "Archive", "aria-label": "Archive " + n + " selected contact" + (n === 1 ? "" : "s") });
      activate(archiveBtn, function () {
        runBulk("status", "inactive", "archived", function () {
          return api.bulk(ids, "status", "active").then(function (e) { return !!(e && e.ok); });
        });
      });
      bulkBar.appendChild(archiveBtn);

      // ---- Delete forever (HARD PURGE) — blocking confirm, no toast ---------------
      // The one action in this app that cannot be taken back. It gets friction, and the friction
      // is proportionate to the loss: the count is named in the confirm, and the confirm is a
      // second deliberate act. There is deliberately NO Undo offered afterward, because there is
      // deliberately nothing to undo to.
      var delBtn = el(doc, "div", "contacts__bulk-delete strip__action strip__action--danger",
        { role: "button", tabindex: "0", text: "Delete forever\u2026", "aria-label": "Permanently delete " + n + " selected contact" + (n === 1 ? "" : "s") });
      activate(delBtn, function () { confirmOpen = !confirmOpen; paintBulkBar(); });
      bulkBar.appendChild(delBtn);

      if (confirmOpen) {
        var warn = el(doc, "div", "contacts__bulk-confirm");
        warn.appendChild(el(doc, "span", "contacts__bulk-confirm-text", {
          text: "Permanently delete " + n + " " + (n === 1 ? "contact" : "contacts") +
                " and all their emails, phones, addresses and links? This cannot be undone."
        }));
        var yes = el(doc, "div", "contacts__bulk-confirm-yes strip__action strip__action--danger",
          { role: "button", tabindex: "0", text: "Delete " + n + " forever", "aria-label": "Confirm permanent deletion of " + n + " contact" + (n === 1 ? "" : "s") });
        activate(yes, function () { confirmOpen = false; runBulk("delete", null, "deleted permanently", null); });
        var no = el(doc, "div", "contacts__bulk-confirm-no strip__action",
          { role: "button", tabindex: "0", text: "Cancel", "aria-label": "Cancel the deletion" });
        activate(no, function () { confirmOpen = false; paintBulkBar(); });
        warn.appendChild(yes); warn.appendChild(no);
        bulkBar.appendChild(warn);
      }

      var allBtn = el(doc, "div", "contacts__bulk-all strip__action",
        { role: "button", tabindex: "0", text: "Select all in view", "aria-label": "Select every contact in view" });
      activate(allBtn, selectAllInView);
      bulkBar.appendChild(allBtn);

      var clearBtn = el(doc, "div", "contacts__bulk-clear strip__action",
        { role: "button", tabindex: "0", text: "Clear", "aria-label": "Clear selection" });
      activate(clearBtn, function () { selClear(); clearToast(); });
      bulkBar.appendChild(clearBtn);
    }

    /* ---- the rail (§7.2) ------------------------------------------------ *
     * The frame's left column hands us its app-owned half as `ctx.menuBody`. It is  *
     * NULL when the frame has no [data-app-menu] host (tests, or a frame without    *
     * the column) -> we simply build no rail. Cold-safe by the contract: *
     * §3.2 says ignoring ctx.menuBody is a CORRECT, SHIPPABLE state (anchor-only),  *
     * and unlike mail we lose no primary action by doing so -- we have none to lose *
     * -- and the search box stays in the list head where it always was. Nothing      *
     * about a null column costs the user a capability here.                         *
     *                                                                               *
     * REPAINT IS OURS (§3.2): the joint calls the renderer ONCE per admit (a *
     * menu is SHOWN, not rebuilt), so live values must be repainted in place from    *
     * THIS closure -- which is exactly why the menu is a ctx field and not a second  *
     * registry: `state`, `dueIds`, and the counts live in here and a separate        *
     * menu-renderer closure could never reach them.                                  */
    var menuBody = (ctx && ctx.menuBody) || null;
    var railCounts = { starred: 0, due: 0 };
    var baseContacts = [];   // the last UNFILTERED list response — the one array every count reads

    // THE COUNT CONTRACT (decision doc §2): the chip counts what the slot DELIVERS. A slot's
    // number can never exceed the rows clicking it produces -- a stronger promise than "no
    // fabricated counts," and the one that survives pagination. Both counts are computed from
    // `baseContacts` (the same array the slots filter), so agreement is STRUCTURAL, not careful:
    //   · Starred  -> the starred rows in the book. (The slot re-queries the server for the true
    //                 set, which can only ever be a SUPERSET if the book was truncated -- so the
    //                 chip under-promises and never over-promises. Never a lie on screen.)
    //   · Follow-ups -> the rows carrying an open follow-up. EXACTLY the rows the `has-due` glow
    //                 dot already marks -- the dot's own data, counted. If the dot is honest,
    //                 this number is honest.
    // `All contacts` carries NO count on purpose: `total` is a SIZE, not a SIGNAL.
    function recountRail() {
      railCounts.starred = baseContacts.filter(function (c) { return !!c.starred; }).length;
      railCounts.due = dueIds
        ? baseContacts.filter(function (c) { return !!dueIds[c.id]; }).length
        : 0;
    }

    function railSlots() {
      var slots = [
        { id: "all",     label: "All contacts", count: 0 },
        // MY CARD graduated OUT of the slot list to the owner MASTHEAD at the top of the rail
        // (leg 3, the layout redesign). An owner is the distinguished ROOT of the book, not a
        // rail slot — and the slot list is uniformly filters-with-counts again, honest by
        // construction (no more `action:true` special-case that had to suppress "0 people").
        // The masthead (renderOwnerMasthead, render() scope) opens the same openMyCard.
        { id: "starred", label: "Starred",      count: railCounts.starred },
        { id: "due",     label: "Follow-ups",   count: railCounts.due }
      ];
      // K6-A: one slot per label the book actually uses. The count is the SERVER's
      // `active_count` — precisely the set `list({label})` returns — so the chip counts
      // what the slot delivers, the same rule the three fixed slots above obey. A label
      // with no active members is not offered: a slot that opens onto an empty list is a
      // dead end wearing a number.
      if (labelVocab) {
        labelVocab.forEach(function (l) {
          var n = Number(l.active_count || 0);
          // GROUPS V1: a DECLARED group's label is rendered in the managed Groups
          // section below (with its create/colour/delete affordances), not doubled
          // here as a bare quick-filter. An UNdeclared, member-bearing label still
          // appears here (the auto-label quick filter — the union's other half).
          if (n > 0 && !isDeclaredGroup(l.label)) slots.push({ id: "label:" + l.label, label: l.label, count: n });
        });
      }
      return slots;
    }

    function activeSlotId() {
      if (state.label) return "label:" + state.label;
      if (state.dueOnly) return "due";
      if (state.starredOnly) return "starred";
      return "all";
    }

    /* ---- GROUPS V1 — the managed-group rail section --------------------------- *
     * Reuses the calendar "My calendars" rail shape (calendar-renderer :3120+). A  *
     * declared group's EXISTENCE+COLOUR live in view-config (seeded into           *
     * `declaredGroups`); its MEMBERSHIP is the matching label (count from          *
     * labelVocab). Create/colour/delete mutate the optimistic copy AND emit a      *
     * bubbling CustomEvent that shell-boot persists through view-config — the exact *
     * forest:cal-recolor/forest:cal-delete idiom. Filtering reuses the existing     *
     * label path (state.label + list({label})), so a group slot is free to open.   */

    // Grove palette — MIRRORS calendar-renderer CAL_PALETTE (:331). Duplicated (not
    // imported) to avoid a contacts→calendar internal dependency; the honest fix is a
    // shared Grove-palette module both read — named V1-tail, not built now.
    var GROUP_PALETTE = [
      "#3B7DD8", "#2FA6A0", "#8A5CC8", "#C9932B", "#3E9B5F",
      "#C0559B", "#5A5AD0", "#C06A3A", "#6E9B58", "#D06B7A",
      "#4AA6C9", "#B0863A"
    ];
    function groupDefaultSlot(name) {                    // djb2 -> deterministic default slot (calHue's twin)
      var s = String(name || ""), h = 5381;
      for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
      return h % GROUP_PALETTE.length;
    }
    function groupColorOf(g) {                           // override slot -> hex, else deterministic default
      var slot = (g && typeof g.color === "number") ? g.color : groupDefaultSlot(g && g.name);
      return GROUP_PALETTE[((slot % GROUP_PALETTE.length) + GROUP_PALETTE.length) % GROUP_PALETTE.length];
    }
    function groupCount(name) {                          // member count = the matching label's active_count (0 if empty)
      if (!labelVocab) return 0;
      for (var i = 0; i < labelVocab.length; i++) {
        if (labelVocab[i].label === name) return Number(labelVocab[i].active_count || 0);
      }
      return 0;
    }
    var _groupEditing = false;                           // one inline edit (create) or delete-confirm at a time
    var _groupDragName = null;                            // the group name currently being dragged (reorder), mirror of calendar's _calDragId

    // Emit a bubbling CustomEvent up to the shell-boot pane host (the forest:cal-* idiom).
    // Cold-safe: best-effort, never a render throw.
    function emitGroup(fromNode, type, detail) {
      try {
        var doc2 = fromNode.ownerDocument, view = doc2 && doc2.defaultView;
        var ev = (view && typeof view.CustomEvent === "function")
          ? new view.CustomEvent(type, { detail: detail, bubbles: true })
          : { type: type, detail: detail, bubbles: true };
        if (typeof fromNode.dispatchEvent === "function") fromNode.dispatchEvent(ev);
      } catch (e) { /* cold-safe */ }
    }

    // CREATE — a "+" in the group head mints a declared group inline (no modal — the
    // calendar "settings pane is a room with two doors" scar). Blank input -> a group
    // name -> optimistic declare + emit + light it. Empty is legal (that's the point).
    function beginGroupCreate(headNode) {
      if (_groupEditing || !headNode) return;
      _groupEditing = true;
      var doc2 = headNode.ownerDocument || doc;
      var input = el(doc2, "input", "rail__slot-rename field", {
        type: "text", "aria-label": "New group name", placeholder: "Group name\u2026"
      });
      headNode.appendChild(input);
      if (input.focus) input.focus();
      var closed = false;
      function finish(commit) {
        if (closed) return; closed = true; _groupEditing = false;
        var v = (input.value || "").trim();
        if (!commit || !v) { repaintRail(); return; }
        if (!isDeclaredGroup(v)) {
          declaredGroups.push({ name: v, color: null });   // optimistic; shell-boot persists
          emitGroup(input, "forest:contact-group-create", { name: v });
        }
        state.label = v; state.starredOnly = false; state.dueOnly = false;   // light the new group
        repaintRail(); refresh();
      }
      input.addEventListener("keydown", function (e) {
        var key = e && e.key;
        if (key === "Enter") { if (e.preventDefault) e.preventDefault(); finish(true); }
        else if (key === "Escape" || key === "Esc") { if (e.preventDefault) e.preventDefault(); finish(false); }
      });
      input.addEventListener("blur", function () { finish(true); });   // create commits on blur (non-destructive)
    }

    // DELETE — the ✕ is replaced IN PLACE by a single confirm control. COMMIT ON
    // MOUSEDOWN, NOT CLICK (the calendar fix, carried verbatim): the confirm
    // is armed WITH focus and nested in the ✕, so a `click` commit is lost to the
    // confirm's own blur-disarm (blur fires during click's mousedown, sets closed,
    // finish(true) early-returns -> NO delete ever fires). mousedown + preventDefault
    // holds focus so it cannot self-blur. blur/Escape DISARM; a destructive action
    // must never fire because focus wandered. NO native confirm().
    function beginGroupDelete(delNode, name) {
      if (_groupEditing || !delNode || !name) return;
      _groupEditing = true;
      var doc2 = delNode.ownerDocument || doc;
      delNode.textContent = "";
      var confirm = el(doc2, "button", "rail__slot-del-confirm", {
        type: "button", "aria-label": "Confirm remove group " + name + " \u2014 its members keep the label"
      });
      confirm.appendChild(el(doc2, "span", "rail__slot-del-confirm-label", { text: "Remove group" }));
      delNode.appendChild(confirm);
      if (confirm.focus) confirm.focus();
      var closed = false;
      function finish(commit) {
        if (closed) return; closed = true; _groupEditing = false;
        if (!commit) { repaintRail(); return; }
        emitGroup(confirm, "forest:contact-group-delete", { name: name });   // emit BEFORE repaint wipes the node
        declaredGroups = declaredGroups.filter(function (g) { return g.name !== name; });  // optimistic un-declare
        if (state.label === name) { state.label = null; }                    // drop the filter if it was lit
        repaintRail(); refresh();
      }
      confirm.addEventListener("mousedown", function (e) {
        if (e && e.stopPropagation) e.stopPropagation();
        if (e && e.preventDefault) e.preventDefault();
        finish(true);
      });
      confirm.addEventListener("click", function (e) {   // idempotent fallback for AT/synthetic activation
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

    // COLOUR — the dot IS the recolor affordance (the calendar principle: colour is
    // the control, no separate "edit colours"). V1 CYCLES to the next Grove slot on
    // click (a full swatch popover is V1-tail); a click here must NOT bubble to the
    // slot's filter toggle.
    function cycleGroupColour(dotNode, name) {
      var cur = null;
      for (var i = 0; i < declaredGroups.length; i++) { if (declaredGroups[i].name === name) { cur = declaredGroups[i]; break; } }
      if (!cur) return;
      var base = (typeof cur.color === "number") ? cur.color : groupDefaultSlot(name);
      var next = (base + 1) % GROUP_PALETTE.length;
      cur.color = next;                                   // optimistic
      emitGroup(dotNode, "forest:contact-group-recolor", { name: name, slot: next });
      repaintRail();
    }

    // ── REORDER (the calendar "My calendars" drag+keyboard twin) ──────────────
    // A declared group's ORDER is a client pref (view-config.contactGroups is an
    // ordered array; setContactGroupOrder reorders it) — NOT a server write and NOT
    // a membership change. So the optimistic repaint IS the truth (no round-trip),
    // exactly the calendar reorder contract. Groups are keyed by NAME (calendars by
    // id), so the whole seam speaks names. loopcontact.js is untouched.

    // Pure: move `dragged` to sit where `target` currently is (the browser-tab
    // convention the calendar uses — drop onto a LATER row lands AFTER it, onto an
    // EARLIER row takes its place). Returns a new names array; unchanged on a no-op.
    function reorderGroupNames(names, dragged, target) {
      var out = names.slice();
      var from = out.indexOf(dragged), to = out.indexOf(target);
      if (from < 0 || to < 0 || from === to) return out;
      out.splice(from, 1);
      var at = out.indexOf(target);                       // target's index AFTER removing dragged
      out.splice(from < to ? at + 1 : at, 0, dragged);    // downward -> after target; upward -> take its place
      return out;
    }
    // Pure: nudge `name` one slot in `dir` (-1 up / +1 down). Unchanged at an end.
    function moveGroupName(names, name, dir) {
      var out = names.slice();
      var at = out.indexOf(name), to = at + dir;
      if (at < 0 || to < 0 || to >= out.length) return out;
      out.splice(at, 1); out.splice(to, 0, name);
      return out;
    }
    // Re-sequence the closure's declaredGroups array IN PLACE to match `newNames`
    // (so the next repaintRail — which reads this closure var — paints the new order,
    // the same in-place-mutate-then-repaint pattern beginGroupCreate/cycleGroupColour use).
    function applyGroupOrder(newNames) {
      var byName = {}, i;
      for (i = 0; i < declaredGroups.length; i++) byName[declaredGroups[i].name] = declaredGroups[i];
      var next = [];
      newNames.forEach(function (n) { if (byName[n]) { next.push(byName[n]); delete byName[n]; } });
      for (i = 0; i < declaredGroups.length; i++) { var g = declaredGroups[i]; if (byName[g.name]) next.push(g); }  // any unlisted keep tail
      declaredGroups.length = 0;
      Array.prototype.push.apply(declaredGroups, next);
    }
    // Commit a reorder: compute the new order, and if it actually moved, apply +
    // emit forest:contact-group-reorder { order } up to shell-boot (persist ->
    // setContactGroupOrder -> survives reload) + repaint. `fromNode` is any live
    // node under the pane host (the slot) for the bubbling emit; `focusName` (opt)
    // refocuses the moved row after the repaint (keyboard a11y parity).
    function commitGroupReorder(next, fromNode, focusName) {
      var cur = declaredGroups.map(function (g) { return g.name; });
      if (next.join("\u0001") === cur.join("\u0001")) return;   // no real move -> nothing
      applyGroupOrder(next);
      emitGroup(fromNode, "forest:contact-group-reorder", { order: next });
      repaintRail();
      if (focusName && menuBody && menuBody.querySelectorAll) {          // a11y: keep focus on the moved row
        var slots = menuBody.querySelectorAll(".rail__slot");           // ONLY a .class selector (shim + browser safe)
        for (var qi = 0; qi < slots.length; qi++) {
          var s = slots[qi];
          if (s.getAttribute && s.getAttribute("data-slot") === "group:" + focusName) {
            if (typeof s.focus === "function") s.focus();
            break;
          }
        }
      }
    }
    function moveGroupRow(name, dir, slotNode) {
      var cur = declaredGroups.map(function (g) { return g.name; });
      commitGroupReorder(moveGroupName(cur, name, dir), slotNode, name);
    }
    // Wire drag (mouse) + Ctrl/Meta+Arrow (keyboard) reorder onto a group slot.
    // Mirrors calendar's wireCalRowDrag; the keyboard path shares the ONE reorder
    // seam (a11y parity) and is gated on Ctrl/Meta so it never collides with the
    // slot's Enter/Space (filter toggle) or the dot/del controls.
    function wireGroupRowDrag(slotNode, name) {
      if (slotNode.setAttribute) slotNode.setAttribute("draggable", "true");
      slotNode.addEventListener("dragstart", function (e) {
        _groupDragName = name;
        if (e && e.dataTransfer) {
          try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", name); } catch (_) {}
        }
        if (slotNode.classList) slotNode.classList.add("is-grabbed");
      });
      slotNode.addEventListener("dragover", function (e) {
        if (!_groupDragName) return;                      // not our drag (a file, a link)
        if (e && e.preventDefault) e.preventDefault();     // THIS makes the node a drop target
        if (e && e.dataTransfer) { try { e.dataTransfer.dropEffect = "move"; } catch (_) {} }
        if (name !== _groupDragName && slotNode.classList) slotNode.classList.add("is-drop-target");
      });
      slotNode.addEventListener("dragleave", function () {
        if (slotNode.classList) slotNode.classList.remove("is-drop-target");
      });
      slotNode.addEventListener("drop", function (e) {
        if (!_groupDragName) return;
        if (e && e.preventDefault) e.preventDefault();
        var dragged = _groupDragName; _groupDragName = null;
        if (slotNode.classList) { slotNode.classList.remove("is-drop-target"); slotNode.classList.remove("is-grabbed"); }
        if (name === dragged) return;                     // dropped on itself -> no-op (motion-legible)
        var cur = declaredGroups.map(function (g) { return g.name; });
        commitGroupReorder(reorderGroupNames(cur, dragged, name), slotNode);
      });
      slotNode.addEventListener("dragend", function () {
        _groupDragName = null;
        if (slotNode.classList) { slotNode.classList.remove("is-grabbed"); slotNode.classList.remove("is-drop-target"); }
      });
      slotNode.addEventListener("keydown", function (e) {
        if (!e || !(e.ctrlKey || e.metaKey)) return;
        var key = e.key;
        if (key !== "ArrowUp" && key !== "ArrowDown") return;
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        moveGroupRow(name, key === "ArrowUp" ? -1 : 1, slotNode);
      });
    }

    // Build the managed Groups section (mirrors calendar's "My calendars" group).
    // Renders every DECLARED group (empty or not); member-bearing UNdeclared labels
    // stay as flat quick-filters above (the union's other half). Returns null when
    // there is nothing to show AND no create surface is wanted — but the create "+"
    // means the head always renders, so a person can mint the first group.
    function renderContactGroups(doc2) {
      var group = el(doc2, "div", "rail__group", { "data-rail-group": "contact-groups" });
      var head = el(doc2, "div", "rail__group-label", { text: "Groups" });
      var add = el(doc2, "button", "rail__group-add", {
        type: "button", "aria-label": "New group", text: "\u002B"   // "+"
      });
      add.addEventListener("click", function (e) {
        if (e && e.stopPropagation) e.stopPropagation();
        beginGroupCreate(head);
      });
      add.addEventListener("keydown", function (e) {
        var key = e && e.key;
        if (key === "Enter" || key === " " || key === "Spacebar") {
          if (e.preventDefault) e.preventDefault();
          if (e.stopPropagation) e.stopPropagation();
          beginGroupCreate(head);
        }
      });
      head.appendChild(add);
      group.appendChild(head);

      declaredGroups.forEach(function (g) {
        var name = g.name;
        var count = groupCount(name);
        var active = (state.label === name);
        var slot = el(doc2, "div", "rail__slot" + (active ? " rail__slot--active" : ""), {
          role: "button", tabindex: "0", "data-slot": "group:" + name,
          "aria-label": name + ", " + count + " " + (count === 1 ? "person" : "people")
        });
        if (active) slot.setAttribute("aria-current", "true");
        // colour dot — identity, not status; the recolor trigger
        var dot = el(doc2, "button", "rail__slot-dot", {
          type: "button", "aria-label": "Recolor " + name
        });
        if (dot.style) dot.style.background = groupColorOf(g);
        (function (nm, dotNode) {
          dotNode.addEventListener("click", function (e) {
            if (e && e.stopPropagation) e.stopPropagation();
            cycleGroupColour(dotNode, nm);
          });
          dotNode.addEventListener("keydown", function (e) {
            var key = e && e.key;
            if (key === "Enter" || key === " " || key === "Spacebar") {
              if (e.preventDefault) e.preventDefault();
              if (e.stopPropagation) e.stopPropagation();
              cycleGroupColour(dotNode, nm);
            }
          });
        })(name, dot);
        slot.appendChild(dot);
        slot.appendChild(el(doc2, "span", "rail__slot-label", { text: name }));
        if (count > 0) slot.appendChild(el(doc2, "span", "rail__count chip", { text: String(count) }));
        // delete (✕) — reveal cluster; commits on mousedown (the guard)
        var actions = el(doc2, "div", "rail__slot-actions");
        var del = el(doc2, "button", "rail__slot-del", {
          type: "button", "aria-label": "Remove group " + name
        });
        del.appendChild(el(doc2, "span", "rail__slot-del-glyph", { text: "\u2715" }));  // ✕
        (function (nm, delNode) {
          delNode.addEventListener("click", function (e) {
            if (e && e.stopPropagation) e.stopPropagation();
            beginGroupDelete(delNode, nm);
          });
          delNode.addEventListener("keydown", function (e) {
            var key = e && e.key;
            if (key === "Enter" || key === " " || key === "Spacebar") {
              if (e.preventDefault) e.preventDefault();
              if (e.stopPropagation) e.stopPropagation();
              beginGroupDelete(delNode, nm);
            }
          });
        })(name, del);
        actions.appendChild(del);
        slot.appendChild(actions);
        // filter/open — the existing label path (state.label + list({label})). A
        // click on the dot/del above stops propagation, so only the row body filters.
        activate(slot, function () {
          state.q = ""; if (search) search.value = "";
          state.label = name; state.starredOnly = false; state.dueOnly = false;
          repaintRail(); refresh();
        });
        wireGroupRowDrag(slot, name);   // drag (mouse) + Ctrl/Meta+Arrow (keyboard) reorder — the "My calendars" twin
        group.appendChild(slot);
      });
      return group;
    }

    function repaintRail() {
      if (!menuBody) return;
      // The rail hosts the search box now, and some search keystrokes call repaintRail (the
      // empty-out-and-reset path) — so preserve the box's focus + caret across the rebuild.
      var searchHadFocus = (doc.activeElement === search);
      var selStart = null, selEnd = null;
      try { selStart = search.selectionStart; selEnd = search.selectionEnd; } catch (e) {}
      menuBody.textContent = "";
      menuBody.appendChild(renderRail(doc, railSlots(), {
        searchEl: search,   // host contacts' persistent search input in the rail (SL-2)
        // (leg 3) the owner masthead, rebuilt fresh each rail repaint so it reads the current
        // ownerLocal + its own lit-state; null when no owner profile (renderRail skips a null).
        masthead: (typeof renderOwnerMasthead === "function" ? renderOwnerMasthead() : null),
        activeId: activeSlotId(),
        // W1 — contacts HAS a create verb now (it always did; §2b v3 — the write
        // half lives inside the byte-frozen substrate and `POST /api/contacts` has always
        // answered). §6's "no `.rail__compose` — a decision, not an omission" was
        // reasoned FROM "contacts has no create verb," so the decision inverts on its own
        // stated ground. The button takes the ONE home the block reserves for a primary
        // action — mail's exact slot. It is not added to the strip as well: two homes for
        // one action is the defect the block exists to remove.
        onCompose: function () {
          createForm(doc, api, host, function (created) {
            // The tool returns the created contact; open it so the person lands where they
            // can immediately fill it in. Never an optimistic row — we open what LANDED.
            if (typeof openRecord === "function") openRecord(created);
          });
        },
        onSlot: function (s) {
          // (leg 3) the mycard ACTION-slot branch is GONE — My Card is the owner masthead now,
          // which calls openMyCard directly from render() scope. Every slot here is a filter.
          state.q = "";
          if (search) search.value = "";
          // The slots are mutually exclusive — exactly one filter is lit, and the rows
          // obey exactly that one. A label slot clears starred/due and vice versa.
          var isLabel = s.id.indexOf("label:") === 0;
          state.label = isLabel ? s.id.slice(6) : null;
          state.starredOnly = (s.id === "starred");
          state.dueOnly = (s.id === "due");
          repaintRail();   // move the weight immediately; the rows follow
          refresh();
        }
      }));
      // GROUPS V1: the managed-group section renders as a sibling block below the flat
      // rail (the calendar "My calendars" placement), so declared groups get their
      // create/colour/delete affordances without disturbing the three fixed slots or
      // the undeclared-label quick filters above.
      menuBody.appendChild(renderContactGroups(doc));
      if (searchHadFocus && typeof search.focus === "function") {
        search.focus();
        if (selStart != null) { try { search.setSelectionRange(selStart, selEnd); } catch (e) {} }
      }
    }

    function paint(env) {
      lastEnv = env;
      body.textContent = "";
      if (!env.ok) {
        // The re-read is the SAME query the list is currently showing (the live search term,
        // or page 0 of the book) — recovering into a DIFFERENT query would repopulate the pane
        // with rows the user never asked for, which is a quieter dishonesty than the dead pane.
        paintFail(doc, body, env, function () {
          return state.q ? api.search(state.q) : api.list(listQuery(0));
        }, paint);
        return;
      }
      // THE TWO SHAPES. `GET /api/contacts` answers `{contacts, total}`; `GET /api/contacts/search`
      // answers the tool's FTS5 envelope `{results, error}` — a DIFFERENT key, because searchContacts()
      // returns `{results}` (loopcontact.js) and the route sends it verbatim. This pane read only
      // `.contacts`, so every search resolved to an empty array and painted "No contacts yet" OVER A
      // REAL MATCH. Search was not degraded; it was dead, and it told the person their book was empty.
      // (Pinned as a known failure in contacts-bulk.test.js C2-F1 — "THE BUG, PINNED HERE TOO" — and
      // fixed here, at the seam that reads, rather than by re-shaping the byte-frozen substrate.)
      var contacts = page.rows.slice();
      var rawLen = contacts.length;   // what the model handed us, before any client-side narrowing
      // The Follow-ups slot is a CLIENT-SIDE intersect over rows the model DID return --
      // the same set the `has-due` glow dot already marks below. If the dot is honest, this
      // is honest: same response, same rows, no new claim. It is not a fabricated filter,
      // it is the dot's data used twice. (The seam has no server-side "has an open
      // follow-up" filter; if one ever lands, this becomes a `list()` param and the count
      // becomes the model's `total`.)
      if (state.dueOnly) {
        if (!dueIds) { body.appendChild(el(doc, "p", "contacts-loading", { text: "Reading follow-ups\u2026" })); return; }
        contacts = contacts.filter(function (c) { return !!dueIds[c.id]; });
      }
      // Starred is a SERVER filter (`list({starred:"1"})`), so on the live path this is a
      // no-op -- the response already carries only starred rows. It is here for the INJECTED
      // path (tests / a host pre-fetch), which hands us the whole book regardless of state:
      // without it, clicking Starred would LIGHT THE SLOT AND SHOW EVERYONE. A lit slot whose
      // rows do not obey it is the exact dishonesty this column is supposed to be incapable of,
      // and it must not be reachable down ANY path -- not just the one the server happens to guard.
      if (state.starredOnly) contacts = contacts.filter(function (c) { return !!c.starred; });
      // THE BASE ENV (the unfiltered book) is what the rail's counts are derived from -- held
      // here, and ONLY when the query was unfiltered, so a filtered response can never be
      // mistaken for the whole. This is what makes "the chip counts what the slot delivers"
      // true by construction rather than by care: every slot's number and every slot's rows
      // are computed from the SAME array.
      // C3: ...and NOT while an import result set is scoped. Those rows are three contacts, not
      // the book — deriving the rail's counts from them would print "3" over an address book of
      // 248. The rail describes the book; a result set is not the book.
      if (!state.starredOnly && !state.dueOnly && !state.q && !state.label && !importScope) {
        baseContacts = page.rows.slice();
        recountRail();
        repaintRail();   // the counts only exist once the book lands — the column follows it
      }
      // A census line: legible count, never a recency claim -- and never an OVER-COUNT.
      // THE RULE: the model's `total` is usable ONLY when it describes exactly what is on
      // screen. The moment a client-side filter narrowed the response, `total` describes the
      // BOOK, not this VIEW, and printing it would say "4 people" over two rows. So: if the
      // rendered array is not the array the model handed us, count the rendered array.
      // (Live starred path: the server already filtered, the client filter is a no-op, the
      //  lengths agree, and `total` -- the model's own number -- is used. Injected path: the
      //  host hands us the whole book regardless of state, the client filter bites, and the
      //  census follows the rows. One rule, honest down both paths.)
      var narrowed = (contacts.length !== rawLen);
      // C3-B: THE TRUNCATION THE OLD GUARD COULD NOT SEE. `narrowed` compares the rendered array to
      // THE RESPONSE — so it catches a client-side filter and is blind to a truncated page, because
      // the truncated page IS the response. That blindness is exactly how "248 people" came to sit
      // over 50 rows. A page is truncated when what we HOLD is less than what EXISTS (`total`), a
      // comparison the response alone can never make. Held rows < total => say so, out loud.
      var truncated = page.pageable && !narrowed && !state.q && page.rows.length < page.total;
      var count = narrowed
        ? contacts.length
        : (page.total || contacts.length);
      // C2 — the rows this paint actually rendered. `Select all in view` means exactly what it
      // says: the rows ON SCREEN, after every filter and the query. Never the book.
      lastShown = contacts;
      paintBulkBar();   // a repaint (keystroke, slot, due-set) must not lose the live selection
      if (!contacts.length) { body.appendChild(emptyNode(doc)); return; }
      // The numerator is what you can SEE AND ACT ON; the denominator is what EXISTS. On a complete
      // book there is nothing to hedge and the line stays the plain census it always was — the hedge
      // fires on truncation and never on honest completeness.
      body.appendChild(el(doc, "div", "contacts-list__census", {
        text: truncated
          ? ("Showing " + contacts.length + " of " + page.total + " people")
          : (count + " " + (count === 1 ? "person" : "people"))
      }));
      var ul = el(doc, "ul", "contacts-list");
      contacts.forEach(function (c) {
        var li = rowNode(doc, c,
          function (person) { if (typeof openRecord === "function") openRecord(person); },
          function (person, starBtn) { toggleStar(api, person, starBtn); },
          state.q,
          selectCtl);
        // K4 due-glow: an honest dot when this person has an open follow-up due.
        if (dueIds && dueIds[c.id]) {
          li.classList.add("has-due");
          li.insertBefore(el(doc, "span", "contacts-row__due",
            { "aria-label": "Has a follow-up due", title: "Follow-up due" }), li.firstChild);
        }
        ul.appendChild(li);
      });
      body.appendChild(ul);
      // C3-A4/A7: a real way to reach the rest — offered EXACTLY while there is a rest to reach.
      // It never invites a click that would do nothing.
      if (truncated) {
        var more = el(doc, "button", "contacts-list__more", {
          type: "button",
          text: "Load more (" + (page.total - contacts.length) + " remaining)"
        });
        more.addEventListener("click", loadMore);
        body.appendChild(more);
      }
    }

    // Absorb a response into the page. `append` is what makes Load more ACCUMULATE rather than
    // replace: page 2 lands under page 1, and the rows already on screen (and any selection over
    // them) survive. A search response is not pageable — the FTS envelope carries no `total` and
    // the tool takes no offset — so it lands as a complete, un-hedged set of its own.
    function absorb(env, append) {
      if (!env || !env.ok) { paint(env || { ok: false }); return; }
      var got = (env.data && (env.data.contacts || env.data.results)) || [];
      var isSearch = !!(env.data && env.data.results && !env.data.contacts);
      page.rows = append ? page.rows.concat(got) : got;
      page.pageable = !isSearch;
      page.total = (env.data && typeof env.data.total === "number")
        ? env.data.total
        : page.rows.length;
      paint(env);
    }

    function listQuery(offset) {
      return {
        starred: state.starredOnly || undefined,
        label: state.label || undefined,   // K6-A: a SERVER filter; `total` comes back filtered too
        limit: PAGE_SIZE,                  // C3-A1: explicit, chosen HERE — never the server's silent default
        offset: offset                     // C3-A2: the two halves of a page, together
      };
    }

    function loadMore() {
      if (!api || !page.pageable) return;
      api.list(listQuery(page.rows.length)).then(function (env) { absorb(env, true); });
    }

    function refresh() {
      // Any fresh read of the book leaves the import's result set behind. The scope is a VIEW of
      // one import, not a filter the app holds; it dissolves the moment we go back to the book.
      if (importScope) clearScope();
      if (injected) {
        var rows = injected.contacts || [];
        page.rows = rows;
        page.pageable = false;   // the host handed us the whole book; there is no page 2 to fetch
        page.total = (typeof injected.total === "number") ? injected.total : rows.length;
        paint({ ok: true, data: { contacts: rows, total: page.total } });
        return;
      }
      body.textContent = "";
      body.appendChild(el(doc, "p", "contacts-loading", { text: "Reading your contacts\u2026" }));
      var p = state.q ? api.search(state.q) : api.list(listQuery(0));
      p.then(function (env) { absorb(env, false); });   // a fresh query always RESETS the page
    }

    // Searching is orthogonal to the rail's filters — typing leaves the rail's weight where it
    // is but the query drives the rows, so a search while "Starred" is lit would show unstarred
    // hits under a lit slot. Drop back to `all` on a search: the rail must never claim a filter
    // the rows are not obeying.
    search.addEventListener("input", function () {
      state.q = search.value.trim();
      if (state.q && (state.starredOnly || state.dueOnly || state.label)) {
        state.starredOnly = false; state.dueOnly = false; state.label = null; repaintRail();
      }
      refresh();
    });

    // K4: fetch the cross-contact due set once; re-paint the held list when it lands.
    if (api && typeof api.dueFollowups === "function") {
      api.dueFollowups().then(function (env) {
        if (!env || !env.ok) return;
        var fus = (env.data && env.data.followups) || [];
        var ids = {};
        fus.forEach(function (f) {
          var cid = f.contact_id || f.contact;
          if (cid != null && !f.completed) ids[cid] = true;
        });
        dueIds = ids;
        recountRail();
        repaintRail();
        if (lastEnv) paint(lastEnv);
      });
    }
    // K6-A: fetch the label vocabulary once; the label slots appear when it lands. This is
    // the ONLY producer of `labelVocab`, and it runs only when a live `api` is present — so
    // the injected path never grows a label slot it could not honour (see `labelVocab` above).
    if (api && typeof api.labelsAll === "function") {
      api.labelsAll().then(function (env) {
        if (!env || !env.ok) return;   // no vocabulary, no slots — silent, not a fabricated rail
        labelVocab = (env.data && env.data.labels) || [];
        repaintRail();
      });
    }
    repaintRail();   // the column paints immediately (labels, no chips) — it does not wait on a fetch
    refresh();
  }

  // WRITE axis: optimistic star flip, then honest confirm/revert on the seam reply.
  function toggleStar(api, person, starBtn) {
    var next = !person.starred;
    starBtn.classList.add("is-saving");
    starBtn.textContent = next ? "\u2605" : "\u2606";
    if (!api || typeof api.update !== "function") { starBtn.classList.remove("is-saving"); return; }
    api.update(person.id, { starred: next }).then(function (env) {
      starBtn.classList.remove("is-saving");
      if (env.ok) {
        person.starred = next;
        starBtn.classList.toggle("is-starred", next);
        starBtn.setAttribute("aria-pressed", next ? "true" : "false");
        flashWrite(starBtn, true);
      } else {
        // Honest revert — the write did not land, so the UI must not claim it did.
        starBtn.textContent = person.starred ? "\u2605" : "\u2606";
        flashWrite(starBtn, false, "couldn\u2019t save");
      }
    });
  }

  /* ---- the RECORD view ------------------------------------------------------- */
  function fieldRow(doc, label, value, primary) {
    var r = el(doc, "div", "contacts-field" + (primary ? " is-primary" : ""));
    r.appendChild(el(doc, "span", "contacts-field__label", { text: label }));
    r.appendChild(el(doc, "span", "contacts-field__value field", { text: value }));
    if (primary) r.appendChild(el(doc, "span", "contacts-field__primary", { text: "primary" }));
    return r;
  }

  /* ---- W1: THE RECORD WRITE PATH (§5 W1) ------------------------------ *
   * Every verb below rides a route that ALREADY answered — the write half lives    *
   * inside the byte-frozen substrate and always did (§2b v3; receipt: *
   * _tools/test-loopcontact-write-path.js, 16/16). What was missing was exactly     *
   * this: a control. No tool change, no re-bless, no golden gate.                   *
   *                                                                                 *
   * TC-1 holds: these send typed intent and re-read the record on land (`reopen`) — *
   * the SAME dispatch-then-reopen shape labelEditor/notesSection/followUpsSection    *
   * already use. No optimistic paint: a write that did not land NEVER shows as       *
   * landed (F3, the honest-read axis, applied to the write axis).                    */

  // The address the tool actually returns: snake_case, and the column is `state`.
  // (The old read said `a.region` — a key the tool has never emitted, so the state
  // silently vanished from every formatted address. Fixed here, on the way past.)
  function formatAddress(a) {
    return a.formatted
      || [a.street, a.city, a.state, a.postal_code, a.country].filter(Boolean).join(", ")
      || a.value || "";
  }

  // One editable row: the value, an optional `primary` mark, and an × that removes it.
  function editableRow(doc, label, value, primary, onRemove) {
    var r = el(doc, "div", "contacts-field contacts-field--editable" + (primary ? " is-primary" : ""));
    r.appendChild(el(doc, "span", "contacts-field__label", { text: label }));
    r.appendChild(el(doc, "span", "contacts-field__value field", { text: value }));
    if (primary) r.appendChild(el(doc, "span", "contacts-field__primary", { text: "primary" }));
    var x = el(doc, "button", "contacts-field__x",
      { type: "button", "aria-label": "Remove " + label + " " + value, title: "Remove", text: "\u00D7" });
    x.addEventListener("click", function () {
      x.disabled = true;
      x.classList.add("is-saving");
      onRemove().then(function (env) {
        if (env && env.ok) { flashWrite(x, true); if (typeof r.__reopen === "function") r.__reopen(); }
        else { x.disabled = false; flashWrite(x, false, "couldn\u2019t remove"); }
      });
    });
    r.appendChild(x);
    return r;
  }

  // A generic "add one" form: N text inputs + a Go button. Enter submits from any input.
  // `submit(values)` returns the client's promise; on land we reopen the record.
  function addForm(doc, cls, inputs, goLabel, submit, reopen) {
    var form = el(doc, "div", "contacts-add " + cls);
    var nodes = inputs.map(function (spec) {
      return el(doc, "input", "contacts-add__input field", {
        type: spec.type || "text", placeholder: spec.placeholder,
        "aria-label": spec.label || spec.placeholder
      });
    });
    var go = el(doc, "button", "contacts-add__go", { type: "button", text: goLabel || "Add" });
    function fire() {
      var values = {};
      var any = false;
      inputs.forEach(function (spec, i) {
        var v = String(nodes[i].value || "").trim();
        values[spec.key] = v;
        if (v) any = true;
      });
      // The FIRST input is the required one (the value; the rest are label/type hints).
      if (!values[inputs[0].key]) return;
      if (!any) return;
      go.disabled = true;
      go.classList.add("is-saving");
      submit(values).then(function (env) {
        go.disabled = false;
        go.classList.remove("is-saving");
        if (env && env.ok) {
          nodes.forEach(function (n) { n.value = ""; });
          flashWrite(go, true);
          if (typeof reopen === "function") reopen();
        } else {
          flashWrite(go, false, (env && env.data && env.data.error) || "couldn\u2019t save");
        }
      });
    }
    nodes.forEach(function (n) {
      n.addEventListener("keydown", function (e) { if (e && e.key === "Enter") fire(); });
      form.appendChild(n);
    });
    go.addEventListener("click", fire);
    form.appendChild(go);
    return form;
  }

  // W1 — the multi-value editor: emails, phones, addresses, custom fields.
  // Each group renders its live rows (each removable) and one add-form.
  function contactFieldsEditor(doc, api, contact, reopen) {
    var wrap = el(doc, "div", "contacts-record__fields contacts-record__fields--editable");

    function group(cls, title, rows, rowLabel, rowValue, rowPrimary, onRemove, inputs, submit) {
      var g = el(doc, "div", "contacts-group " + cls);
      g.appendChild(el(doc, "div", "contacts-group__label", { text: title }));
      if (!rows.length) {
        g.appendChild(el(doc, "p", "contacts-group__empty line", { text: "None yet." }));
      }
      rows.forEach(function (row) {
        var r = editableRow(doc, rowLabel(row), rowValue(row), rowPrimary(row),
          function () { return onRemove(row); });
        r.__reopen = reopen;
        g.appendChild(r);
      });
      g.appendChild(addForm(doc, cls + "-add", inputs, "Add", submit, reopen));
      wrap.appendChild(g);
    }

    group("contacts-group--emails", "email", contact.emails || [],
      function (e) { return e.label || "email"; },
      function (e) { return e.email || e.value || ""; },
      function (e) { return !!e.is_primary; },
      function (e) { return api.removeEmail(contact.id, e.id); },
      [{ key: "email", placeholder: "name@example.com", label: "Email address", type: "email" },
       { key: "label", placeholder: "label (work, home\u2026)", label: "Email label" }],
      function (v) { return api.addEmail(contact.id, v.email, v.label || null, !(contact.emails || []).length); });

    group("contacts-group--phones", "phone", contact.phones || [],
      function (p) { return p.label || "phone"; },
      function (p) { return p.phone || p.value || ""; },
      function (p) { return !!p.is_primary; },
      function (p) { return api.removePhone(contact.id, p.id); },
      [{ key: "phone", placeholder: "+1 207 555 0142", label: "Phone number", type: "tel" },
       { key: "label", placeholder: "label (mobile, work\u2026)", label: "Phone label" }],
      function (v) { return api.addPhone(contact.id, v.phone, v.label || null, !(contact.phones || []).length); });

    group("contacts-group--addresses", "address", contact.addresses || [],
      function (a) { return a.label || "address"; },
      function (a) { return formatAddress(a); },
      function (a) { return !!a.is_primary; },
      function (a) { return api.removeAddress(contact.id, a.id); },
      [{ key: "street", placeholder: "street", label: "Street" },
       { key: "city", placeholder: "city", label: "City" },
       { key: "state", placeholder: "state", label: "State" },
       { key: "postalCode", placeholder: "zip", label: "Postal code" }],
      function (v) {
        return api.addAddress(contact.id, {
          street: v.street, city: v.city, state: v.state, postalCode: v.postalCode,
          isPrimary: !(contact.addresses || []).length
        });
      });

    // The tool's key is `fields` with { field_name, field_value } — NOT `custom_fields`
    // with { label, value }. The old read looked for a key the tool has never emitted, so
    // custom fields have never once rendered. They render now, and they are writable.
    group("contacts-group--custom", "custom fields", contact.fields || [],
      function (f) { return f.field_name || "field"; },
      function (f) { return f.field_value || ""; },
      function () { return false; },
      function (f) { return api.removeField(contact.id, f.field_name); },
      [{ key: "name", placeholder: "field name", label: "Field name" },
       { key: "value", placeholder: "value", label: "Field value" }],
      // setField is an UPSERT at the tool, so re-sending a name EDITS it. No separate verb.
      function (v) { return api.setField(contact.id, v.name, v.value); });

    return wrap;
  }

  // W1 — edit-person. `update` already existed (the star toggle rides it) and already
  // mapped to PUT /api/contacts/:id, which already wrote name/org/title. It was one form
  // away, not one gate away. Collapsed by default; the head's Edit button opens it.
  var PERSON_FIELDS = [
    { key: "display_name", label: "Name", required: true },
    { key: "given_name", label: "First" },
    { key: "family_name", label: "Last" },
    { key: "organization", label: "Organization" },
    { key: "title", label: "Title" },
    { key: "notes", label: "Notes" }
  ];

  function personEditor(doc, api, contact, reopen) {
    var wrap = el(doc, "div", "contacts-record__edit");
    var form = el(doc, "div", "contacts-edit is-collapsed");
    var toggle = el(doc, "button", "contacts-record__edit-toggle",
      { type: "button", "aria-expanded": "false", "aria-label": "Edit this contact", text: "Edit" });
    toggle.addEventListener("click", function () {
      var open = form.classList.contains("is-collapsed");
      form.classList.toggle("is-collapsed", !open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.textContent = open ? "Cancel" : "Edit";
    });
    wrap.appendChild(toggle);

    var nodes = {};
    PERSON_FIELDS.forEach(function (f) {
      var row = el(doc, "div", "contacts-edit__row");
      row.appendChild(el(doc, "label", "contacts-edit__label", { text: f.label }));
      var input = el(doc, "input", "contacts-edit__input field",
        { type: "text", "aria-label": f.label });
      input.value = contact[f.key] != null ? String(contact[f.key]) : "";
      nodes[f.key] = input;
      row.appendChild(input);
      form.appendChild(row);
    });

    var save = el(doc, "button", "contacts-edit__save", { type: "button", text: "Save" });
    save.addEventListener("click", function () {
      var patch = {};
      PERSON_FIELDS.forEach(function (f) { patch[f.key] = String(nodes[f.key].value || "").trim() || null; });
      // The tool 400s on an empty display_name. Flag it — never send a write we know fails,
      // and never blank the person's name on a stray keystroke.
      if (!patch.display_name) { flashWrite(save, false, "a name is required"); return; }
      save.disabled = true;
      save.classList.add("is-saving");
      api.update(contact.id, patch).then(function (env) {
        save.disabled = false;
        save.classList.remove("is-saving");
        if (env && env.ok) { flashWrite(save, true); if (typeof reopen === "function") reopen(); }
        else { flashWrite(save, false, (env && env.data && env.data.error) || "couldn\u2019t save"); }
      });
    });
    form.appendChild(save);
    wrap.appendChild(form);
    return wrap;
  }

  // W1 — create. §6 said contacts has NO `.rail__compose` and called that "a
  // decision, not an omission — contacts has no create verb." It has one now (it always
  // did), so the decision inverts on its own stated ground and the button takes the ONE
  // home the block reserves for a primary action — mail's Compose slot. No second home.
  function createForm(doc, api, host, onCreated) {
    var box = el(doc, "div", "contacts-create");
    // SL-1 "Genesis Opens a Pane" — New Contact FLOATS in a dedicated overlay over the list, the
    // same shape as calendar's New Event (.calendar-form-overlay) and mail's Compose. The form was
    // previously appended inline to `host`, so it rendered at the BOTTOM of the list; this wraps it
    // in the floating pane so the collection stays put beneath and the create pane floats over it.
    var overlay = el(doc, "div", "contacts-form-overlay");
    box.appendChild(el(doc, "div", "contacts-create__head", { text: "New contact" }));
    var name = el(doc, "input", "contacts-create__input field",
      { type: "text", placeholder: "Name", "aria-label": "New contact name" });
    var org = el(doc, "input", "contacts-create__input field",
      { type: "text", placeholder: "Organization (optional)", "aria-label": "New contact organization" });
    var email = el(doc, "input", "contacts-create__input field",
      { type: "email", placeholder: "Email (optional)", "aria-label": "New contact email" });
    var go = el(doc, "button", "contacts-create__go", { type: "button", text: "Create" });
    // SL-3(b): the Cancel joins the record family so the quiet-Cancel shape is uniform.
    var cancel = el(doc, "button", "contacts-create__cancel record__action record__action--quiet", { type: "button", text: "Cancel" });

    function close() { if (overlay.parentNode && typeof overlay.parentNode.removeChild === "function") overlay.parentNode.removeChild(overlay); }
    cancel.addEventListener("click", close);
    // SL-3(a): the top-× dismiss — same teardown as Cancel (close()). Stays INLINE, unconditional: SL-1
    // grades the record__dismiss × in the genesis function's OWN body, and it is the pane's escape hatch,
    // so it must never be load-conditional. (An earlier cut moved it into the module; the Cruise SL-1
    // audit correctly BREACHed that — the × belongs here. The genesis-dock route's true seam is the
    // minimize→dock block below, not the ×.)
    var createDismiss = el(doc, "button", "contacts-create__dismiss record__dismiss", { type: "button", "aria-label": "Close", text: "\u00d7" });
    createDismiss.addEventListener("click", close);
    box.appendChild(createDismiss);
    // L3: the shared MINIMIZE→composeDock affordance — the ~20-line block hand-rolled here and identically
    // in calendar renderNewForm, extracted to shell/genesis-dock.js (the Chalk Line's `genesis` MODULE
    // route). SL-1 untouched: `box` is ours; the module only appends the minimize control onto it.
    // Cold-safe by the module (no dock -> no minimize control). The labeled Cancel stays contacts-local.
    if (root.genesisDock && typeof root.genesisDock.wire === "function") {
      root.genesisDock.wire(doc, { container: overlay, kind: "contacts-create", title: "New contact", close: close, root: root });
    }

    function fire() {
      var v = String(name.value || "").trim();
      // display_name is the tool's one hard requirement. Say so; don't send a known-400.
      if (!v) { flashWrite(go, false, "a name is required"); return; }
      go.disabled = true;
      go.classList.add("is-saving");
      var body = { display_name: v };
      var o = String(org.value || "").trim(); if (o) body.organization = o;
      var e = String(email.value || "").trim(); if (e) body.email = e;
      api.create(body).then(function (env) {
        go.disabled = false;
        go.classList.remove("is-saving");
        if (env && env.ok && env.data && env.data.id) {
          flashWrite(go, true);
          close();
          if (typeof onCreated === "function") onCreated(env.data);
        } else {
          flashWrite(go, false, (env && env.data && env.data.error) || "couldn\u2019t create");
        }
      });
    }
    [name, org, email].forEach(function (n) {
      n.addEventListener("keydown", function (ev) { if (ev && ev.key === "Enter") fire(); });
      box.appendChild(n);
    });
    go.addEventListener("click", fire);
    box.appendChild(go);
    box.appendChild(cancel);
    overlay.appendChild(box);
    host.appendChild(overlay);
    return box;
  }

  /* ---- K4: notes log (record) ----------------------------------------------- *
   * The contact's own note log (record carries `notes_log`; mutations dispatch).   *
   * TC-1: display the tool's rows + send typed intent; the tool owns the store.    */
  function notesSection(doc, api, contact, reopen) {
    var wrap = el(doc, "div", "contacts-record__noteslog");
    wrap.appendChild(el(doc, "div", "contacts-record__noteslog-label", { text: "notes log" }));
    var rows = contact.notes_log || [];
    var list = el(doc, "div", "contacts-noteslog");
    if (rows.length) {
      rows.slice(0, 20).forEach(function (n) {
        var item = el(doc, "div", "contacts-noteslog__row");
        item.appendChild(el(doc, "p", "contacts-noteslog__text field", { text: n.note_text || n.text || "" }));
        if (n.created_at) item.appendChild(el(doc, "span", "contacts-noteslog__when line", { text: String(n.created_at).slice(0, 10) }));
        if (api && typeof api.removeNote === "function" && n.id != null) {
          var x = el(doc, "button", "contacts-noteslog__x", { type: "button", "aria-label": "Delete note", text: "\u00d7" });
          x.addEventListener("click", function () {
            x.disabled = true;
            api.removeNote(contact.id, n.id).then(function (env) {
              if (env && env.ok) { if (typeof reopen === "function") reopen(); }
              else { x.disabled = false; flashWrite(item, false, "couldn\u2019t delete"); }
            });
          });
          item.appendChild(x);
        }
        list.appendChild(item);
      });
    } else {
      list.appendChild(el(doc, "p", "contacts-noteslog__empty line", { text: "No notes yet." }));
    }
    wrap.appendChild(list);
    if (api && typeof api.addNote === "function") {
      var form = el(doc, "div", "contacts-note-add");
      var input = el(doc, "input", "contacts-note-add__input field",
        { type: "text", placeholder: "Add a note\u2026", "aria-label": "Add a note" });
      var add = el(doc, "button", "contacts-note-add__go", { type: "button", text: "Add" });
      function submit() {
        var v = input.value.trim();
        if (!v) return;
        add.disabled = true;
        api.addNote(contact.id, v).then(function (env) {
          if (env && env.ok) { if (typeof reopen === "function") reopen(); }
          else { add.disabled = false; flashWrite(input, false, "couldn\u2019t add"); }
        });
      }
      add.addEventListener("click", submit);
      input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); submit(); } });
      form.appendChild(input); form.appendChild(add);
      wrap.appendChild(form);
    }
    return wrap;
  }

  /* ---- K4: follow-ups (record; async read + keyed writes) ------------------- */
  function followUpsSection(doc, api, contact, reopen) {
    var wrap = el(doc, "div", "contacts-record__followups");
    wrap.appendChild(el(doc, "div", "contacts-record__followups-label", { text: "follow-ups" }));
    var body = el(doc, "div", "contacts-followups");
    body.appendChild(el(doc, "p", "contacts-followups__loading line", { text: "Reading follow-ups\u2026" }));
    wrap.appendChild(body);
    // the add affordance always renders (a fresh contact can get its first follow-up)
    if (api && typeof api.addFollowUp === "function") {
      var form = el(doc, "div", "contacts-followup-add");
      var note = el(doc, "input", "contacts-followup-add__note field",
        { type: "text", placeholder: "Follow up on\u2026", "aria-label": "Follow-up note" });
      var due = el(doc, "input", "contacts-followup-add__due field",
        { type: "date", "aria-label": "Follow-up due date" });
      var add = el(doc, "button", "contacts-followup-add__go", { type: "button", text: "Add" });
      function submit() {
        var n = note.value.trim();
        var d = due.value ? due.value : null;
        if (!n && !d) return;
        add.disabled = true;
        api.addFollowUp(contact.id, n || null, d).then(function (env) {
          if (env && env.ok) { if (typeof reopen === "function") reopen(); }
          else { add.disabled = false; flashWrite(note, false, "couldn\u2019t add"); }
        });
      }
      add.addEventListener("click", submit);
      note.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); submit(); } });
      form.appendChild(note); form.appendChild(due); form.appendChild(add);
      wrap.appendChild(form);
    }
    if (!api || typeof api.followups !== "function") { body.textContent = ""; return wrap; }
    api.followups(contact.id).then(function (env) {
      body.textContent = "";
      if (!env || !env.ok) { body.appendChild(el(doc, "p", "contacts-followups__empty line", { text: "Follow-ups are unavailable right now." })); return; }
      var rows = (env.data && env.data.followups) || [];
      if (!rows.length) { body.appendChild(el(doc, "p", "contacts-followups__empty line", { text: "No follow-ups yet." })); return; }
      var ul = el(doc, "ul", "contacts-followups__list");
      rows.slice(0, 20).forEach(function (f) {
        var li = el(doc, "li", "contacts-followups__row" + (f.completed ? " is-done" : ""));
        // complete toggle (dispatch; reopen on land)
        if (typeof api.updateFollowUp === "function" && f.id != null) {
          var chk = el(doc, "button", "contacts-followups__check" + (f.completed ? " is-done" : ""),
            { type: "button", "aria-label": (f.completed ? "Reopen follow-up" : "Complete follow-up"),
              text: f.completed ? "\u2713" : "\u25cb" });
          chk.addEventListener("click", function () {
            chk.disabled = true;
            api.updateFollowUp(contact.id, f.id, { completed: !f.completed }).then(function (e2) {
              if (e2 && e2.ok) { if (typeof reopen === "function") reopen(); }
              else { chk.disabled = false; flashWrite(li, false, "couldn\u2019t update"); }
            });
          });
          li.appendChild(chk);
        }
        li.appendChild(el(doc, "span", "contacts-followups__note field", { text: f.note || "(follow-up)" }));
        if (f.due_date) li.appendChild(el(doc, "span", "contacts-followups__due line", { text: "due " + String(f.due_date).slice(0, 10) }));
        if (typeof api.removeFollowUp === "function" && f.id != null) {
          var x = el(doc, "button", "contacts-followups__x", { type: "button", "aria-label": "Delete follow-up", text: "\u00d7" });
          x.addEventListener("click", function () {
            x.disabled = true;
            api.removeFollowUp(contact.id, f.id).then(function (e3) {
              if (e3 && e3.ok) { if (typeof reopen === "function") reopen(); }
              else { x.disabled = false; flashWrite(li, false, "couldn\u2019t delete"); }
            });
          });
          li.appendChild(x);
        }
        ul.appendChild(li);
      });
      body.appendChild(ul);
    });
    return wrap;
  }

  /* ---- K4: activity timeline (record; read-only, render verbatim) ----------- *
   * Merged proof-chain + event records newest-first. TC-1: NO fixed type list,     *
   * NO computed labels beyond a display map — render whatever the tool returns.     */
  function timelineSection(doc, api, contact) {
    var wrap = el(doc, "div", "contacts-record__timeline");
    wrap.appendChild(el(doc, "div", "contacts-record__timeline-label", { text: "activity" }));
    var body = el(doc, "div", "contacts-timeline");
    body.appendChild(el(doc, "p", "contacts-timeline__loading line", { text: "Reading activity\u2026" }));
    wrap.appendChild(body);
    if (!api || typeof api.timeline !== "function") { body.textContent = ""; return wrap; }
    api.timeline(contact.id).then(function (env) {
      body.textContent = "";
      if (!env || !env.ok) { body.appendChild(el(doc, "p", "contacts-timeline__empty line", { text: "Activity is unavailable right now." })); return; }
      var rows = (env.data && env.data.timeline) || [];
      if (!rows.length) { body.appendChild(el(doc, "p", "contacts-timeline__empty line", { text: "No activity recorded yet." })); return; }
      var ul = el(doc, "ul", "contacts-timeline__list");
      rows.slice(0, 30).forEach(function (t) {
        var li = el(doc, "li", "contacts-timeline__row");
        // display map only — humanize the dotted event type without inventing meaning
        var kind = t.type || t.event_type || t.kind || "event";
        li.appendChild(el(doc, "span", "contacts-timeline__kind", { text: String(kind).replace(/[._]/g, " ") }));
        var label = t.summary || t.description || t.note || t.label || "";
        if (label) li.appendChild(el(doc, "span", "contacts-timeline__label field", { text: label }));
        var when = t.created_at || t.at || t.timestamp;
        if (when) li.appendChild(el(doc, "span", "contacts-timeline__when line", { text: String(when).slice(0, 10) }));
        ul.appendChild(li);
      });
      body.appendChild(ul);
    });
    return wrap;
  }

  function renderRecord(host, ctx, api, contact, back, reopen, isOwner) {
    var doc = host.ownerDocument;
    host.textContent = "";
    var nav = el(doc, "button", "contacts-record__back", { type: "button", text: "\u2190 Contacts" });
    nav.addEventListener("click", function () { if (typeof back === "function") back(); });
    host.appendChild(nav);

    // Phase 2 — per-contact photo. Real-or-Made: the record shows a REAL photo iff a
    // blob exists under this contact's derived key, else initials — nothing here fabricates a
    // face. Persistence is the blob's PRESENCE, not a ref column (plan §2): loopcontact.js is
    // untouched and there is no per-contact ref-map — the key is minted from contact.id, and
    // get(key) returns the photo or nothing. Mirrors the owner path (renderMyCardEdit /
    // ownerAvatar) but keyed "contact:<id>" and with the Phase-1 pipeline inserted before put.
    var photoStore = (root.blobStore && typeof root.blobStore.defaultBlobStore === "function")
      ? root.blobStore.defaultBlobStore() : null;
    var pipeline = root.photoPipeline || null;   // Phase-1 module
    var photoKey = (photoStore && contact && contact.id != null)
      ? photoStore.keyFor("contact", contact.id) : null;

    // The avatar: initials synchronously, then the real photo swapped in iff a blob loads (a
    // missing/unreadable blob stays initials — never a fabricated or stale face). Byte-identical
    // to the shipping ownerAvatar read, keyed by contact instead of owner.
    function contactAvatar() {
      var av = el(doc, "span", "contacts-record__avatar", { "aria-hidden": "true", text: initials(contact.display_name) });
      if (photoStore && photoKey) {
        photoStore.get(photoKey).then(function (blob) {
          if (!blob) return;                                   // no blob -> stay initials
          try {
            var view = doc && doc.defaultView;
            var url = (view && view.URL && view.URL.createObjectURL) ? view.URL.createObjectURL(blob) : null;
            if (!url) return;
            var img = el(doc, "img", "contacts-record__avatar contacts-record__avatar--photo", { alt: "" });
            img.onload = function () { try { if (view.URL.revokeObjectURL) view.URL.revokeObjectURL(url); } catch (e) {} };  // no object-URL leak on re-render
            img.src = url;
            if (av.parentNode && typeof av.parentNode.replaceChild === "function") av.parentNode.replaceChild(img, av);
          } catch (e) { /* cold-safe: stay initials */ }
        }).catch(function () { /* could-not-read -> stay initials, never a fake */ });
      }
      return av;
    }
    var avatarNode = contactAvatar();

    var head = el(doc, "div", "contacts-record__head");
    head.appendChild(avatarNode);
    var hb = el(doc, "div", "contacts-record__headtext");
    hb.appendChild(el(doc, "h2", "contacts-record__name field", { text: contact.display_name || "(no name)" }));
    // Phase 3 slice 2 (2c) — the owner badge on the unified My Card: POSITION/label only, no
    // new hue (gold stays the scarce warm point; tokens-only). Marks the owner's record
    // without a special record grammar — every person renders in the same record shell (Lens 1).
    if (isOwner) hb.appendChild(el(doc, "span", "contacts-record__owner-badge", { text: "You" }));
    var sub = subline(contact);
    if (sub) hb.appendChild(el(doc, "div", "contacts-record__sub line", { text: sub }));
    head.appendChild(hb);
    host.appendChild(head);

    // The upload affordance. GATED on the Phase-1 pipeline being present: without it we would
    // have to store the RAW file, which keeps EXIF/GPS — a privacy regression the whole feature
    // exists to prevent. So pipeline-absent -> NO upload control (read still works); never a
    // silent raw-with-GPS put. Real-upload-only: the sole source is a File the operator picks.
    if (photoStore && photoKey && pipeline && typeof pipeline.processContactPhoto === "function") {
      var photoRow = el(doc, "div", "contacts-record__photo-edit");
      var fileIn = el(doc, "input", "contacts-record__photo-file", { type: "file" });
      try { fileIn.accept = "image/*"; } catch (e) {}   // real images only
      // A dedicated text span, NOT label.textContent: setting textContent would wipe the label's
      // children (detaching the file input). setLabel() re-words the control without ever touching
      // the input's parentage.
      var fileLabel = el(doc, "label", "contacts-record__photo-label");
      var labelText = el(doc, "span", "contacts-record__photo-label-text", { text: "Add photo" });
      fileLabel.appendChild(labelText);
      fileLabel.appendChild(fileIn);
      function setLabel(t) { labelText.textContent = t; }
      var removeBtn = el(doc, "button", "contacts-record__photo-remove", { type: "button", text: "Remove photo" });
      function setRemoveVisible(on) { removeBtn.style.display = on ? "" : "none"; }
      setRemoveVisible(false);
      // initial existence probe -> reveal Remove only when a photo is actually present
      photoStore.get(photoKey).then(function (b) { if (b) { setRemoveVisible(true); setLabel("Change photo"); } }).catch(function () {});
      function refreshAvatar() {
        var next = contactAvatar();
        if (avatarNode.parentNode && typeof avatarNode.parentNode.replaceChild === "function") avatarNode.parentNode.replaceChild(next, avatarNode);
        avatarNode = next;
      }
      fileIn.addEventListener("change", function () {
        var f = fileIn.files && fileIn.files[0];
        if (!f) return;
        // THE LOAD-BEARING STEP: the raw File never reaches the store. It goes through the
        // Phase-1 pipeline (orient/square/scale-512/jpeg-0.85/EXIF+GPS-strip); only the
        // processed blob is put. A pipeline reject keeps the previous photo (cold-safe).
        pipeline.processContactPhoto(f, { size: 512, quality: 0.85 }).then(function (processed) {
          return photoStore.put(photoKey, processed);
        }).then(function () {
          refreshAvatar(); setRemoveVisible(true); setLabel("Change photo");
        }).catch(function () { /* cold-safe: keep the previous photo */ });
      });
      removeBtn.addEventListener("click", function () {
        Promise.resolve(photoStore.remove(photoKey)).then(function () {
          refreshAvatar(); setRemoveVisible(false); setLabel("Add photo");
        }).catch(function () {});
      });
      photoRow.appendChild(fileLabel);
      photoRow.appendChild(removeBtn);
      host.appendChild(photoRow);
    }

    var fields = el(doc, "div", "contacts-record__fields");
    (contact.emails || []).forEach(function (e) { fields.appendChild(fieldRow(doc, "email", e.email || e.value || "", !!(e.is_primary))); });
    (contact.phones || []).forEach(function (p) { fields.appendChild(fieldRow(doc, "phone", p.phone || p.value || "", !!(p.is_primary))); });
    (contact.addresses || []).forEach(function (a) {
      fields.appendChild(fieldRow(doc, "address", formatAddress(a), !!(a.is_primary)));
    });
    (contact.fields || []).forEach(function (f) { fields.appendChild(fieldRow(doc, f.field_name || "field", f.field_value || "", false)); });
    if (fields.childNodes.length) host.appendChild(fields);

    // W1 — edit-person (collapsed; the head's Edit button opens it).
    host.appendChild(personEditor(doc, api, contact, reopen));

    // W1 — the multi-value write path: emails / phones / addresses / custom fields,
    // each row removable, each group with an add-form. Every route already answered;
    // this is the control that was missing (§2b v3).
    host.appendChild(contactFieldsEditor(doc, api, contact, reopen));

    // K1: the label editor (record carries real `labels`; mutations dispatch to the tool).
    host.appendChild(labelEditor(doc, api, contact, reopen));

    // K2: the merge-history audit trail (async read; honest on empty/unreachable).
    host.appendChild(mergeHistorySection(doc, api, contact));

    // K4: notes log + follow-ups + activity timeline.
    host.appendChild(notesSection(doc, api, contact, reopen));
    host.appendChild(followUpsSection(doc, api, contact, reopen));
    host.appendChild(timelineSection(doc, api, contact));

    if (contact.notes) {
      var notes = el(doc, "div", "contacts-record__notes");
      notes.appendChild(el(doc, "div", "contacts-record__notes-label", { text: "notes" }));
      notes.appendChild(el(doc, "p", "contacts-record__notes-body", { text: contact.notes }));
      host.appendChild(notes);
    }

    host.appendChild(actionsStrip(doc, contact, api, host, function () { if (typeof back === "function") back(); }));

    // E6 — the Person Canopy. Everything this person is across all three apps, assembled
    // here. Cold-safe by construction (a missing calendar client or mail seam degrades to
    // an honest note, never a throw), so a record still renders on a runtime that has
    // neither. `ctx` carries the test seams (calendarClient / searchFn / _fetch); in the
    // browser it is absent and the real clients resolve off window.ForestShell.
    host.appendChild(canopySection(doc, contact, ctx && ctx.canopy));

    host.appendChild(renderContext(doc, api, contact, reopen));
  }

  /* ================ E6 — THE PERSON CANOPY (the Weave's last leg) ================ *
   * Everything this person IS, across all three apps, on one card. Google makes you  *
   * open three products to assemble this; the Forest grows the whole canopy around   *
   * a person in one place. V1 is the READ — actions from the card reuse E1 (email    *
   * them) and E4 (invite them), which are already live in the actions strip.         *
   *                                                                                  *
   * TC-1 HOLDS. Contacts ASSEMBLES reads; it never owns the graph. The calendar tool *
   * decides which events are this person's (it owns the event_attendees link). The   *
   * mail projection decides which messages match. This file joins two answers and    *
   * draws them. It ranks nothing, matches nothing, normalizes nothing.               *
   *                                                                                  *
   * TWO READS OF DIFFERENT QUALITY, AND THE CARD MUST NOT PRETEND OTHERWISE:         *
   *                                                                                  *
   *   Moments — PRECISE. GET /api/events?contact_id=<id> is a real structured join   *
   *     on the attendee LINK (loopcalendar `event_attendees.contact_id`, covered by  *
   *     idx_attendees_contact). These ARE their events, by identity, not by name.    *
   *                                                                                  *
   *   Threads — FUZZY. GET /projection/mail-search?q=<address> is a KEYWORD search   *
   *     over the corpus, not a structured thread index. It finds mail MENTIONING     *
   *     the address — including mail merely cc'd, quoted, or signature-matched. The  *
   *     heading says exactly that. Dressing a keyword hit as a precise thread join   *
   *     would be the confident-wrong-answer fault this line keeps getting bitten by. *
   *     No address on file -> the sub-section is NOT rendered at all. An empty       *
   *     search box for a person who has no address is a question we never asked.     *
   *                                                                                  *
   * ⚠ DEPLOY ORDER IS LOAD-BEARING — RUNTIME FIRST, ALWAYS. DO NOT FLIP.             *
   *   `/api/events` PREDATES E6. If the static canopy ships to a box whose runtime   *
   *   does not yet carry the contact_id filter, the read does NOT 404 into an honest *
   *   empty — it returns 200 with the ENTIRE event list, and this card renders every *
   *   event on the calendar as if it belonged to this person. A silent, confident,   *
   *   wrong answer. The 12.1015 Cistern named the order but justified it with the    *
   *   404 case; the real hazard is worse than the one it named. Runtime, then static.*/
  function canopySection(doc, contact, cfg) {
    cfg = cfg || {};
    var wrap = el(doc, "div", "contacts-canopy");
    wrap.appendChild(el(doc, "div", "contacts-canopy__label", { text: "canopy" }));

    canopyMoments(doc, contact, cfg, wrap);
    canopyThreads(doc, contact, cfg, wrap);
    return wrap;
  }

  /* ---- Moments: this person's events. PRECISE (the attendee link). ------------ */
  function canopyMoments(doc, contact, cfg, host) {
    var sec = el(doc, "div", "contacts-canopy__sec contacts-canopy__sec--moments");
    sec.appendChild(el(doc, "h3", "contacts-canopy__head", { text: "Moments" }));
    var body = el(doc, "div", "contacts-canopy__body");
    body.appendChild(el(doc, "p", "contacts-canopy__loading line", { text: "Reading their events\u2026" }));
    sec.appendChild(body);
    host.appendChild(sec);

    // Cold-safe: the calendar client is a sibling module. Absent (a pane loaded without
    // calendar-rest.js) -> an HONEST deferred note. Never a throw, never a fake empty.
    var client = cfg.calendarClient ||
      (root.calendarRest && typeof root.calendarRest.makeClient === "function"
        ? root.calendarRest.makeClient()
        : null);
    if (!client || typeof client.events !== "function" || !contact || !contact.id) {
      clearNode(body);
      body.appendChild(el(doc, "p", "contacts-canopy__deferred line",
        { text: "The calendar isn\u2019t mounted on this runtime yet." }));
      return;
    }

    // TWO keys, UNIONed by the tool :
    //   contact_id     — events Shea invited them to THROUGH Forest (the E4 button). Exact.
    //   attendee_email — events whose INGESTED invite carried any address we hold for them.
    // Before the guest-list read, only the first existed, so on Google-synced data this section
    // rendered "No events with this person yet." on every contact — a sentence that was FALSE and
    // looked like a fact.
    var addrs = allEmailsOf(contact);
    var q = { contact_id: contact.id, limit: CANOPY_N };
    if (addrs.length) q.attendee_email = addrs;

    client.events(q).then(function (env) {
      clearNode(body);
      // The honest envelope from calendar-rest: reached-nothing is NOT an empty list.
      if (!env || !env.ok) {
        body.appendChild(canopyFailNode(doc, env, "events"));
        return;
      }
      var evs = (env.data && (env.data.events || env.data.items)) || [];
      if (!evs.length) {
        // AN EMPTY MOMENTS SECTION HAS TWO CAUSES AND THEY ARE NOT THE SAME FACT. Say which.
        // Without an address we did not ask a question we could answer — reporting "no events" there
        // would be a confident claim resting on nothing, which is the fault class this whole session
        // exists to kill (a deferral note that decays into a false statement in production).
        body.appendChild(el(doc, "p", "contacts-canopy__empty line", {
          text: addrs.length
            ? "No events with this person yet."
            : "No address on file for them, so their events can\u2019t be found."
        }));
        return;
      }
      var ul = el(doc, "ul", "contacts-canopy__list");
      // The tool already orders by start. The client re-sorts NOTHING (TC-1).
      evs.slice(0, CANOPY_N).forEach(function (e) {
        var li = el(doc, "li", "contacts-canopy__row");
        li.appendChild(el(doc, "span", "contacts-canopy__when line", { text: whenOf(e) }));
        li.appendChild(el(doc, "span", "contacts-canopy__title",
          { text: e.title || e.summary || "(untitled event)" }));
        ul.appendChild(li);
      });
      body.appendChild(ul);
      var total = (env.data && env.data.total);
      if (typeof total === "number" && total > evs.length) {
        body.appendChild(el(doc, "p", "contacts-canopy__more line",
          { text: "Showing " + evs.length + " of " + total + "." }));
      }
    }, function () {
      clearNode(body);
      body.appendChild(canopyFailNode(doc, null, "events"));
    });
  }

  /* ---- Threads: mail MENTIONING this address. FUZZY, and it says so. ---------- */
  function canopyThreads(doc, contact, cfg, host) {
    var addr = primaryEmailOf(contact);
    // No address -> render NOTHING. Honest absence beats an empty search for a question
    // we were never in a position to ask.
    if (!addr) return;

    var sec = el(doc, "div", "contacts-canopy__sec contacts-canopy__sec--threads");
    sec.appendChild(el(doc, "h3", "contacts-canopy__head", { text: "Mail mentioning this address" }));
    // The honesty seam, in the UI and not just the comment: this is a keyword reach over
    // the corpus, NOT a structured thread join. The user is told which kind of answer
    // they are looking at, because the two are not worth the same.
    sec.appendChild(el(doc, "p", "contacts-canopy__caveat line",
      { text: "A keyword search for " + addr + " \u2014 not a precise thread index." }));
    var body = el(doc, "div", "contacts-canopy__body");
    body.appendChild(el(doc, "p", "contacts-canopy__loading line", { text: "Searching your mail\u2026" }));
    sec.appendChild(body);
    host.appendChild(sec);

    var searchFn = cfg.searchFn || canopyMailSearch(cfg);
    searchFn(addr).then(function (r) {
      clearNode(body);
      if (!r || !r.ok) {
        body.appendChild(el(doc, "p", "contacts-canopy__unreachable line",
          { text: (r && r.error) || "Can\u2019t reach your mail right now." }));
        return;
      }
      var items = r.items || [];
      if (!items.length) {
        body.appendChild(el(doc, "p", "contacts-canopy__empty line",
          { text: "No mail mentioning this address." }));
        return;
      }
      var ul = el(doc, "ul", "contacts-canopy__list");
      items.slice(0, CANOPY_N).forEach(function (m) {
        var li = el(doc, "li", "contacts-canopy__row");
        var d = m.date || m.internalDate || m.received_at || "";
        if (d) li.appendChild(el(doc, "span", "contacts-canopy__when line", { text: String(d).slice(0, 10) }));
        li.appendChild(el(doc, "span", "contacts-canopy__title",
          { text: m.subject || m.snippet || "(no subject)" }));
        ul.appendChild(li);
      });
      body.appendChild(ul);
    }, function () {
      clearNode(body);
      body.appendChild(el(doc, "p", "contacts-canopy__unreachable line",
        { text: "Can\u2019t reach your mail right now." }));
    });
  }

  /* ---- the mail-search transport (mirrors mail-renderer.js makeSearchAllFn) ---- *
   * Same route, same owner-gated credentials, same honest resolve — never throws,   *
   * never fabricates a hit list. Duplicated deliberately and minimally: mail owns    *
   * its search UI and does not export this; reaching into mail-renderer's internals  *
   * to borrow it would couple the two panes far harder than 12 lines of fetch.       */
  function canopyMailSearch(cfg) {
    var fetchFn = (cfg && cfg._fetch) || (typeof fetch === "function" ? fetch : null);
    var RT = (root.runtimeBase || (typeof window !== "undefined" && window.FOREST_RUNTIME) || "");
    return function (q) {
      if (!fetchFn) return Promise.resolve({ ok: false, error: "offline \u2014 can\u2019t reach your mail" });
      return fetchFn(RT + "/projection/mail-search?q=" + encodeURIComponent(q), {
        cache: "no-store", credentials: "include"
      }).then(function (r) {
        return r.json().then(function (j) {
          if (r.ok && j && Array.isArray(j.items)) return { ok: true, items: j.items };
          return { ok: false, error: (j && j.error) || ("search failed (HTTP " + r.status + ")") };
        }, function () { return { ok: false, error: "search failed (HTTP " + r.status + ")" }; });
      }).catch(function () { return { ok: false, error: "network error \u2014 couldn\u2019t search" }; });
    };
  }

  // How far back / how many the canopy reaches (Weave §11 open call 5 — a relevance +
  // performance call). A bounded recent-N, not full history: the canopy is a glance at
  // who this person is to you, not an archive. One constant, easy for the operator to retune.
  var CANOPY_N = 8;

  // The canopy's own read-fail node. Distinct from the contacts one because the thing that
  // failed is NOT contacts — saying "can't reach your contacts" when the CALENDAR is down
  // sends the operator to debug the wrong tool.
  function canopyFailNode(doc, env, what) {
    var wrap = el(doc, "div", "contacts-canopy__unreachable");
    var hb = root.honestBadge;
    if (hb && typeof hb.render === "function") wrap.appendChild(hb.render(doc, "unreachable"));
    var msg = (env && env.status === 401)
      ? "Sign in to see their " + what + "."
      : "Can\u2019t reach your " + what + " right now.";
    wrap.appendChild(el(doc, "p", "contacts-canopy__unreachable-msg", { text: msg }));
    return wrap;
  }

  // Display-only date read. The tool owns the timestamps; this slices a string for the eye
  // and computes NO occurrence dates, NO timezone math (TC-1 — the calendar owns that).
  function whenOf(e) {
    var s = e && (e.start_at || e.start || e.starts_at || "");
    return s ? String(s).slice(0, 10) : "";
  }

  /* ---- the CONTEXT weave (record interior) ---------------------------------- *
   * The honest weave from the contact tool's OWN graph (relationship edges the    *
   * record already carries). The cross-tool half of this weave is no longer        *
   * deferred — it is the CANOPY above (E6). The note that used to stand here        *
   * ("wired at the Confluence") was honest when written and became FALSE when the   *
   * Confluence landed and nothing followed it: it pointed every contact *
   * record at an event that was already over. Retired with the thing it promised.   */
  function renderContext(doc, api, contact, reopen) {
    var wrap = el(doc, "div", "contacts-context");
    wrap.appendChild(el(doc, "div", "contacts-context__label", { text: "context" }));
    var rels = contact.relationships || contact.edges || [];
    var canWrite = api && typeof api.addLink === "function" && typeof api.removeLink === "function";
    if (rels.length) {
      var ul = el(doc, "ul", "contacts-context__rels" + (canWrite ? " contacts-context__rels--editable" : ""));
      rels.slice(0, 12).forEach(function (r) {
        var reltype = r.relationship || r.type || r.relation || "related";
        // the target contact id the tool keys the edge on (display-safe fallbacks).
        var targetId = r.target_contact || r.target || r.contact_id || r.id || null;
        var li = el(doc, "li", "contacts-context__rel");
        li.appendChild(el(doc, "span", "contacts-context__reltype", { text: reltype }));
        li.appendChild(el(doc, "span", "contacts-context__relname field", { text: r.display_name || r.name || r.target || "" }));
        // K3: removable — the × dispatches removeLink and re-reads the record on land.
        if (canWrite && targetId) {
          var x = el(doc, "button", "contacts-context__relx",
            { type: "button", "aria-label": "Remove relationship " + reltype, text: "\u00d7" });
          x.addEventListener("click", function () {
            x.disabled = true;
            api.removeLink(contact.id, targetId, reltype).then(function (env) {
              if (env && env.ok) { if (typeof reopen === "function") reopen(); }
              else { x.disabled = false; flashWrite(li, false, "couldn\u2019t remove"); }
            });
          });
          li.appendChild(x);
        }
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
    } else {
      wrap.appendChild(el(doc, "p", "contacts-context__empty line", { text: "No relationships recorded yet." }));
    }
    // K3: the add affordance — a target contact id + a relationship type, dispatched
    // to the tool's OWN /links graph (TC-1: the renderer sends typed intent, the tool
    // owns the edge). Re-reads the record on land so the panel reflects tool truth.
    if (canWrite) {
      var form = el(doc, "div", "contacts-rel-add");
      var tgt = el(doc, "input", "contacts-rel-add__target field",
        { type: "text", placeholder: "Contact id\u2026", "aria-label": "Related contact id" });
      var rel = el(doc, "input", "contacts-rel-add__rel field",
        { type: "text", placeholder: "knows", "aria-label": "Relationship type" });
      var add = el(doc, "button", "contacts-rel-add__go", { type: "button", text: "Link" });
      function submit() {
        var t = tgt.value.trim();
        if (!t) return;
        var rt = rel.value.trim();  // empty -> tool defaults 'knows'
        add.disabled = true;
        api.addLink(contact.id, t, rt || null, false).then(function (env) {
          if (env && env.ok) { if (typeof reopen === "function") reopen(); }
          else { add.disabled = false; flashWrite(tgt, false, "couldn\u2019t link"); }
        });
      }
      add.addEventListener("click", submit);
      rel.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); submit(); } });
      form.appendChild(tgt); form.appendChild(rel); form.appendChild(add);
      wrap.appendChild(form);
    }
    // The cross-tool weave is LIVE — it is the canopy above (E6). The honest-deferred note
    // that stood here is gone: it promised work "at the Confluence," the Confluence landed
    // at, and the promise outlived it. A deferral note whose event has passed is
    // not honest any more; it is just wrong, and it was wrong in production.
    return wrap;
  }

  /* ---- renderRail (§7.2) — the frame's left column, contacts' half ----- *
   * A PURE builder (doc + slots -> DOM), so it unit-tests without the whole view.   *
   * Composed ONLY from the shared `.rail__*` vocabulary (§3.4, block.css *
   * 1080-1153). We do not invent our own block; we do not touch `.menu__anchor`.    *
   *                                                                                 *
   * NO `.rail__compose`. This is a DECISION, not an omission (decision doc §3):     *
   * contacts has NO create verb — no `create` in contacts-rest.js, no POST          *
   * /api/contacts on the runtime, no create affordance in render(), ever. Building  *
   * one is a runtime SEAM change = a §2 structural joint = defers to the *
   * convergence (anti-dribble). So the primary action is ABSENT, not faked: the     *
   * button renders only when opts.onCompose is a function, and nobody passes one.   *
   * An empty button that does nothing is worse than no button. The slot is owed to  *
   * the runtime, and it is named as owed rather than mimed.                         *
   *                                                                                 *
   * HONEST BY CONSTRUCTION (§3.5, non-negotiable). Every slot below has a *
   * byte-verified filter and a destination that already exists. The chip's rule is  *
   * stronger than "no fabricated counts": THE CHIP COUNTS WHAT THE SLOT DELIVERS —  *
   * a slot's number can never exceed the rows clicking it produces. Shown only when *
   * non-zero, so a clean book is not a wall of zeros; the label always shows.        *
   *                                                                                 *
   * CUT, and each owed a named seam (decision doc §4): Labels (labelsAll() lists    *
   * the vocabulary but list() has NO `label` param -- enumerable, NOT filterable; a *
   * Labels rail is real rows that click to NOTHING) · Status (list({status})        *
   * forwards the param but the tool's value vocabulary is unverifiable from these   *
   * bytes -- naming values would be a guess) · Duplicates (suggestMerges()'s        *
   * RESPONSE shape is nowhere verified -- the suite pins only its request; reading   *
   * a count out of it means guessing a key, and duplicates are PAIRS, not a contact  *
   * subset list() can filter to, so there is nowhere to go).                        */
  function renderRail(doc, slots, opts) {
    opts = opts || {};
    // Not a mailbox. The nav's own name is part of the honesty.
    var nav = el(doc, "nav", "rail", { "aria-label": "Contact filters" });
    // OWNER MASTHEAD (leg 3) — the crown of the rail: the book's owner (My Card), photo-first,
    // ABOVE compose, always visible, never scrolling with the list. Built in render() scope
    // (where ownerLocal/ownerAvatar/openMyCard live) and handed in via opts.masthead; absent
    // when there is no owner profile (a null node is simply not appended). It is NOT a slot —
    // it is the distinguished root, distinguished by position + form, never by a new hue.
    if (opts.masthead) nav.appendChild(opts.masthead);
    // The primary action, iff a host supplies one. Contacts supplies none (see above).
    if (typeof opts.onCompose === "function") {
      var compose = el(doc, "div", "rail__compose", {
        role: "button", tabindex: "0", text: opts.composeLabel || "New contact",
        "aria-label": "Create a new contact"
      });
      activate(compose, function () { opts.onCompose(); });
      nav.appendChild(compose);
    }
    // SL-2 — the app-scoped search sits in the rail, DIRECTLY under compose (the
    // calendar shape). renderRail builds the `.rail__search` HOST; contacts hands in its own
    // persistent search input (opts.searchEl) so its `state.q` listener and the rail-slot
    // clears (`search.value = ""`) keep working against the SAME element. A standalone caller
    // (unit test, a frame with no search element) gets a plain scoped input — so renderRail
    // satisfies SL-2 on its own bytes either way.
    var railSearch = el(doc, "div", "rail__search");
    railSearch.appendChild(opts.searchEl || el(doc, "input", "rail__search-input field", {
      type: "search", placeholder: "Search contacts\u2026", "aria-label": "Search these contacts"
    }));
    nav.appendChild(railSearch);
    (slots || []).forEach(function (s) {
      var active = (opts.activeId === s.id);
      var slot = el(doc, "div", "rail__slot" + (active ? " rail__slot--active" : ""), {
        role: "button", tabindex: "0", "data-slot": s.id,
        // an ACTION slot (My Card) opens a card — it is NOT a people-count filter, so it
        // never claims "N people" (which for My Card would falsely read "0 people").
        "aria-label": s.action ? s.label : (s.label + ", " + s.count + " " + (s.count === 1 ? "person" : "people"))
      });
      // WEIGHT marks the place, never a colour alarm (§3.4).
      if (active) slot.setAttribute("aria-current", "true");
      slot.appendChild(el(doc, "span", "rail__slot-label", { text: s.label }));
      // Non-zero only. A resting rail carries no numbers at all -- that is the calm the
      // block was designed for, and `All contacts` deliberately never carries one: a
      // TOTAL is a size, not a signal, and this chip's grammar is "something here wants you."
      if (s.count > 0) slot.appendChild(el(doc, "span", "rail__count chip", { text: String(s.count) }));
      if (typeof opts.onSlot === "function") activate(slot, function () { opts.onSlot(s); });
      nav.appendChild(slot);
    });
    return nav;
  }

  /* ---- the pane entry (kind "contacts") -------------------------------------- */
  function render(paneEl, ctx) {
    ctx = ctx || {};
    var doc = paneEl.ownerDocument;
    // §7.2 move 1 — the pane's `H2` title and `pane__version` stamp are GONE.
    // The frame's `.menu__anchor` (built by the pane pool's joint BEFORE this renderer runs,
    // and surviving even if this renderer throws) now names the app once, at the top of the
    // left column, with the V# under it. Keeping them here was the deliberate duplicate of
    // §7.3 — visible for exactly one commit, pointing straight at these two lines.
    // Deleted now. The name has one home. Nothing else in the tree pins them (verified:
    // no `pane__title` / `pane__version` assertion in any contacts suite).
    var host = el(doc, "div", "contacts-host");
    paneEl.appendChild(host);

    // Injected path (tests / a host pre-fetch): ctx.data.contactsList present -> sync.
    var injected = ctx.data && ctx.data.contactsList ? ctx.data.contactsList : null;

    // The REST client — cold-safe: absent core -> honest unreachable, never a throw.
    var api = (root.contactsRest && typeof root.contactsRest.makeClient === "function")
      ? root.contactsRest.makeClient(ctx.restOpts || {})
      : { list: function () { return Promise.resolve({ ok: false, status: 0, code: "E_NO_CLIENT" }); },
          search: function () { return Promise.resolve({ ok: false, status: 0, code: "E_NO_CLIENT" }); },
          get: function () { return Promise.resolve({ ok: false, status: 0, code: "E_NO_CLIENT" }); },
          suggestMerges: function () { return Promise.resolve({ ok: false }); },
          merge: function () { return Promise.resolve({ ok: false }); },
          update: function () { return Promise.resolve({ ok: false }); } };

    // MY CARD (D2=b,) — the rail's first ACTION slot opens the OWNER'S own card.
    // The owner-profile is SELF-AUTHORED (the box has no login identity to seed from —
    // GET /session is booleans-only) and lives client-durable in view-config
    // (ownerProfileOf/setOwnerProfile), so loopcontact.js stays byte-frozen (D1=a). It
    // renders into `host` exactly like a contact record; `showList` is Back. `ownerLocal`
    // is the optimistic local copy (the Groups V1 pattern): seeded from ctx.config at
    // render, updated on save so a re-open in the same session shows the fresh card without
    // waiting on the host round-trip. LEG-1 authors display_name + a primary email + phone;
    // the PHOTO (D1=a sovereign blob), multi-value add/remove, and the auto-feed-to-
    // connections sharing hook are named leg-2 increments — this view never touches them.
    var ownerLocal = (root.viewConfig && typeof root.viewConfig.ownerProfileOf === "function")
      ? root.viewConfig.ownerProfileOf(ctx && ctx.config) : null;
    // Phase 3 slice 2 (2a) — the designated-owner-contact id (view-config _version 1.9 seam).
    // Mirrors ownerLocal's read verbatim, through ownerContactIdOf. null pre-migration; once the
    // migration designates a contact this holds its id and openMyCard takes the unified branch.
    var ownerCid = (root.viewConfig && typeof root.viewConfig.ownerContactIdOf === "function")
      ? root.viewConfig.ownerContactIdOf(ctx && ctx.config) : null;
    // The D1=a sovereign blob sidecar (shell/blob-store.js) — where the owner PHOTO blob lives,
    // OUTSIDE the byte-frozen loopcontact.js. Cold-safe: absent -> no photo path (initials only).
    var ownerBlobStore = (root.blobStore && typeof root.blobStore.defaultBlobStore === "function")
      ? root.blobStore.defaultBlobStore() : null;
    // THE AUTO-FEED-TO-CONNECTIONS HOOK (named leg 2, wired in a later leg). The owner-profile
    // is a DISTINCT, stable-identity record — that is the whole reason D2=b is a distinct record
    // and not a pointer to a contact — which makes it the anchor a future "share my card with my
    // connections" feed hangs off. Leg 2 NAMES the seam and leaves it unbuilt: a
    // `forest:owner-photo-changed` event fires whenever the owner photo is set or cleared, so a
    // later connections-feed listener reacts without this view knowing about it. Real-or-Made
    // rides through — the event only ever carries a ref to a GENUINE uploaded blob, never a
    // generated one.
    function emitOwnerPhotoChanged(node, ref) {
      if (!node) return;
      try {
        var view = doc && doc.defaultView;
        var ev = (view && typeof view.CustomEvent === "function")
          ? new view.CustomEvent("forest:owner-photo-changed", { detail: { photo: ref }, bubbles: true })
          : { type: "forest:owner-photo-changed", detail: { photo: ref }, bubbles: true };
        if (typeof node.dispatchEvent === "function") node.dispatchEvent(ev);
      } catch (e) { /* cold-safe: the feed hook is best-effort, never a render throw */ }
    }
    // The owner avatar: a REAL user-uploaded photo if one is set, else an initials chip.
    // Real-or-Made (Creed): the forbidden thing is a FABRICATED or guessed face; a genuine
    // upload is the opposite of fabrication, so a real photo is allowed and initials is the
    // honest fallback. This NEVER generates an image. Progressive: renders initials
    // synchronously, then swaps in the photo when the blob loads (a missing/unreadable blob
    // stays initials — never a fabricated or stale face).
    function ownerAvatar(o) {
      var av = el(doc, "span", "contacts-record__avatar", { "aria-hidden": "true", text: initials((o && o.display_name) || "Me") });
      var ref = o && o.photo;
      if (ref && ref.key && ownerBlobStore) {
        ownerBlobStore.get(ref.key).then(function (blob) {
          if (!blob) return;                                    // no blob -> stay initials
          try {
            var view = doc && doc.defaultView;
            var url = (view && view.URL && view.URL.createObjectURL) ? view.URL.createObjectURL(blob) : null;
            if (!url) return;
            var img = el(doc, "img", "contacts-record__avatar contacts-record__avatar--photo", { alt: "" });
            img.src = url;
            if (av.parentNode && typeof av.parentNode.replaceChild === "function") av.parentNode.replaceChild(img, av);
          } catch (e) { /* cold-safe: stay initials */ }
        }).catch(function () { /* could-not-read the store -> stay initials, never a fake */ });
      }
      return av;
    }
    function myCardBack() {
      var b = el(doc, "button", "contacts-record__back", { type: "button", text: "\u2190 Contacts" });
      b.addEventListener("click", showList);
      return b;
    }
    // OWNER MASTHEAD (leg 3, the layout redesign) — My Card graduates from a rail slot to the
    // crown of the rail. Lens 1 invariant: the owner is the persistent, distinguished ROOT of
    // the book; every other person renders in the same record grammar. The distinction is carried
    // by POSITION (crown of the rail) + FORM (photo disc + Fraunces name), never a new hue — gold
    // stays 's scarce warm point. Clicking it opens My Card in the RECORD PANE (openMyCard),
    // it does NOT swap/wipe the pane (the teleport Lens 2 subtracted is gone). It lights while My
    // Card is the open record (the rail's active-slot idiom, reused) and un-lights when a contact
    // opens or the list returns.
    var myCardActive = false;      // is My Card the currently-open record?
    var ownerMastheadNode = null;  // the live masthead node (for a no-rebuild class toggle)
    // className idiom, NOT classList — the shell's DOM doubles do not implement classList
    // (the calendar rail carries the same warning). A post-build toggle sets the class string.
    function setMastheadActive(on) {
      myCardActive = !!on;
      if (ownerMastheadNode) ownerMastheadNode.className = "contacts-owner-masthead" + (on ? " is-active" : "");
    }
    // The masthead is ALWAYS present — the root is PERSISTENT (Lens 1's own word), and it is the
    // ONLY first-run affordance to author My Card now that the always-present slot is gone: with
    // no owner profile it shows a "Set up" state (a neutral "Me" initials placeholder + "SET UP"
    // sub) whose click opens the SAME setup editor the old slot opened (openMyCard -> ownerLocal
    // null -> renderMyCardEdit(null)). This OVERRIDES the design pass's "absent when no profile"
    // detail, which broke first-run and contradicted the persistent-root invariant (reported in
    // the close handoff). Real-or-Made rides through BOTH states: a real photo iff one is set,
    // else initials of a real name (owner) or the neutral "Me" (unset) — never a fabricated face.
    function renderOwnerMasthead() {
      var hasOwner = !!ownerLocal;
      var m = el(doc, "div",
        "contacts-owner-masthead" + (myCardActive ? " is-active" : "") + (hasOwner ? "" : " contacts-owner-masthead--unset"), {
          role: "button", tabindex: "0",
          "aria-label": hasOwner
            ? ("My Card" + (ownerLocal.display_name ? " \u2014 " + ownerLocal.display_name : ""))
            : "Set up My Card"
        });
      if (myCardActive) m.setAttribute("aria-current", "true");
      m.appendChild(ownerAvatar(hasOwner ? ownerLocal : { display_name: "Me" }));   // REUSE (Real-or-Made)
      var t = el(doc, "div", "contacts-owner-masthead__text");
      t.appendChild(el(doc, "span", "contacts-owner-masthead__name", { text: hasOwner ? (ownerLocal.display_name || "(your name)") : "My Card" }));
      t.appendChild(el(doc, "span", "contacts-owner-masthead__sub", { text: hasOwner ? "MY CARD" : "SET UP" }));
      m.appendChild(t);
      activate(m, function () { openMyCard(); });   // owner set -> read view; unset -> the setup editor
      ownerMastheadNode = m;
      return m;
    }
    function openMyCard() {
      setMastheadActive(true);   // light the masthead: My Card is now the open record
      if (ownerCid != null) {                     // UNIFIED: open the designated contact's NORMAL record
        openOwnerContact(ownerCid);
        return;
      }
      if (ownerLocal) {                           // pre-migration: ownerProfile set, no designated contact
        renderMyCardRead(ownerLocal);             // legacy read — carries the "Move to Contacts" offer (2e)
        return;
      }
      renderMyCardEdit(null);                      // first-run setup (nothing to migrate)
    }
    // 2b — resolve ownerCid through the SAME fetch-then-open path openRecord uses (in-memory injected
    // set first, else api.get), with isOwner=true. Stale-designation self-heal is load-bearing: a
    // designated id that no longer resolves must not brick My Card — clear it (emit set{null}) and
    // fall back to legacy. (view-config coerces a bad id to null on normalize; this handles the
    // resolves-in-config-but-not-in-registry case at read time.)
    function openOwnerContact(cid) {
      var reopen = function () { openOwnerContact(cid); };
      if (injected && injected.records && injected.records[cid]) {
        renderRecord(host, ctx, api, injected.records[cid], showList, reopen, /*isOwner=*/true); return;
      }
      host.textContent = "";
      host.appendChild(el(doc, "p", "contacts-loading", { text: "Reading \u2026" }));
      api.get(cid).then(function (env) {
        if (env && env.ok && env.data) {
          var rec = env.data.contact || env.data;
          renderRecord(host, ctx, api, rec, showList, reopen, /*isOwner=*/true);
        } else {
          healStaleOwnerDesignation();            // designated contact is gone -> self-heal + legacy
        }
      }).catch(function () { healStaleOwnerDesignation(); });
    }
    function healStaleOwnerDesignation() {
      ownerCid = null;                             // in-session: stop taking the unified branch
      emitOwnerContactIdSet(null);                 // persist the clear via shell-boot (2d)
      if (ownerLocal) renderMyCardRead(ownerLocal); else renderMyCardEdit(null);
    }
    // 2d (renderer side) — dispatch the owner-contact designation up to shell-boot -> setOwnerContactId.
    // The exact twin of the forest:owner-profile-save wire. The migration emits it once with the new
    // contact's id; the self-heal emits it with null to clear a dangling designation.
    function emitOwnerContactIdSet(id) {
      try {
        var view = doc && doc.defaultView;
        var node = ownerMastheadNode || host;
        var ev = (view && typeof view.CustomEvent === "function")
          ? new view.CustomEvent("forest:owner-contact-id-set", { detail: { id: id }, bubbles: true })
          : { type: "forest:owner-contact-id-set", detail: { id: id }, bubbles: true };
        if (node && typeof node.dispatchEvent === "function") node.dispatchEvent(ev);
      } catch (e) { /* cold-safe: designation persist is best-effort, never a render throw */ }
    }
    // 2e — the one-time migration: ownerProfile -> a designated registry contact. TC-1: the tool
    // decides identity (api.create). Steps: create from display_name (+ primary email), carry the
    // remaining emails/phones via the record mutators, re-key the owner photo blob owner:me ->
    // contact:<newId>, persist the designation (emit set{id}), then open the new record unified
    // (isOwner). Idempotent by construction: once ownerCid is set, openMyCard never reaches the offer
    // again. No auto-merge — a duplicate "me" is the operator's Merge pick (Phase 4). Offered, not
    // imposed (the offer button lives in renderMyCardRead); legacy stays fully usable if never clicked.
    function migrateOwnerToContact(o) {
      o = o || ownerLocal || {};
      if (ownerCid != null) return;                       // guard: already migrated
      if (!api || typeof api.create !== "function") return;
      var emails = o.emails || [], phones = o.phones || [];
      var primaryEmail = "";
      for (var i = 0; i < emails.length; i++) { if (emails[i] && emails[i].email) { primaryEmail = emails[i].email; break; } }
      var body = { display_name: o.display_name || "Me" };
      if (primaryEmail) body.email = primaryEmail;
      host.textContent = "";
      host.appendChild(el(doc, "p", "contacts-loading", { text: "Moving My Card into Contacts \u2026" }));
      api.create(body).then(function (env) {
        if (!(env && env.ok && env.data && env.data.id != null)) {
          renderMyCardRead(o); return;                    // create failed -> do NOT half-migrate; restore legacy
        }
        var newId = env.data.id;
        var chain = Promise.resolve();                    // carry remaining emails/phones, best-effort
        emails.forEach(function (e) {
          if (!e || !e.email || e.email === primaryEmail) return;
          chain = chain.then(function () { return api.addEmail(newId, e.email, e.label || null, false); }).catch(function () {});
        });
        phones.forEach(function (p, idx) {
          if (!p || !p.phone) return;
          chain = chain.then(function () { return api.addPhone(newId, p.phone, p.label || null, idx === 0); }).catch(function () {});
        });
        chain = chain.then(function () { return rekeyOwnerPhoto(newId); });   // owner:me -> contact:<newId>
        chain.then(function () {
          ownerCid = newId;                                // in-session: take the unified branch now
          emitOwnerContactIdSet(newId);                    // persist the designation (2d)
          openOwnerContact(newId);                         // open the migrated record, unified (isOwner)
        }).catch(function () {
          ownerCid = newId; emitOwnerContactIdSet(newId); openOwnerContact(newId);  // designation still stands
        });
      }).catch(function () { renderMyCardRead(o); });
    }
    // Move the owner photo blob owner:me -> contact:<newId> in the sovereign sidecar (get->put->remove).
    // Cold-safe: no store / no blob -> no-op. The blob is already the processed (EXIF-stripped) jpeg —
    // never re-processed, raw-never-stored holds.
    function rekeyOwnerPhoto(newId) {
      if (!ownerBlobStore || typeof ownerBlobStore.keyFor !== "function") return Promise.resolve();
      var oldKey = ownerBlobStore.keyFor("owner", "me");
      var newKey = ownerBlobStore.keyFor("contact", newId);
      return ownerBlobStore.get(oldKey).then(function (blob) {
        if (!blob) return;                                 // no owner photo -> nothing to move
        return ownerBlobStore.put(newKey, blob).then(function () {
          try { return ownerBlobStore.remove(oldKey); } catch (e) { /* leave old; new is authoritative */ }
        });
      }).catch(function () { /* cold-safe: photo move is best-effort, never blocks the migration */ });
    }
    function renderMyCardRead(o) {
      host.textContent = "";
      host.appendChild(myCardBack());
      var head = el(doc, "div", "contacts-record__head");
      head.appendChild(ownerAvatar(o));   // leg 2: real photo if set, else initials (Real-or-Made)
      var hb = el(doc, "div", "contacts-record__headtext");
      hb.appendChild(el(doc, "h2", "contacts-record__name field", { text: o.display_name || "(your name)" }));
      hb.appendChild(el(doc, "div", "contacts-record__sub line", { text: "My Card" }));
      head.appendChild(hb);
      host.appendChild(head);
      var fields = el(doc, "div", "contacts-record__fields");
      (o.emails || []).forEach(function (e) { fields.appendChild(fieldRow(doc, "email", e.email || "", !!e.is_primary)); });
      (o.phones || []).forEach(function (p) { fields.appendChild(fieldRow(doc, "phone", p.phone || "", !!p.is_primary)); });
      if (fields.childNodes.length) host.appendChild(fields);
      var edit = el(doc, "button", "contacts-record__edit", { type: "button", text: "Edit My Card" });
      edit.addEventListener("click", function () { renderMyCardEdit(o); });
      host.appendChild(edit);
      // Phase 3 slice 2 (2e) — the migration OFFER (offered, not imposed): fold this
      // self-authored My Card into a normal registry contact and designate it owner. Shown only
      // pre-migration (ownerCid null); one click runs migrateOwnerToContact once. If never clicked,
      // the legacy card stays fully usable — no forced migration.
      if (ownerCid == null) {
        var moveBtn = el(doc, "button", "contacts-record__owner-migrate", { type: "button", text: "Move to Contacts" });
        moveBtn.addEventListener("click", function () { migrateOwnerToContact(o); });
        host.appendChild(moveBtn);
      }
    }
    function renderMyCardEdit(o) {
      o = o || { display_name: "", emails: [], phones: [] };
      host.textContent = "";
      host.appendChild(myCardBack());
      var wrap = el(doc, "div", "contacts-mycard-edit");
      wrap.appendChild(el(doc, "h2", "contacts-record__name", { text: (o.display_name || (o.emails || []).length) ? "Edit My Card" : "Set up My Card" }));

      // --- photo (leg 2): a REAL upload only. Real-or-Made — the ONLY source is a File the
      // operator picks; nothing here generates, guesses, or fetches a face. The blob lands in
      // the sovereign sidecar; the profile carries only the {key,mime} ref. ---
      var photoRef = (o.photo && o.photo.key) ? { key: o.photo.key, mime: o.photo.mime || "" } : null;
      var photoRow = el(doc, "div", "contacts-mycard-edit__photo");
      var photoPrev = ownerAvatar({ display_name: (o.display_name || "Me"), photo: photoRef });
      var fileIn = el(doc, "input", "contacts-mycard-edit__file", { type: "file" });
      try { fileIn.accept = "image/*"; } catch (e) {}   // real images only
      var removeBtn = el(doc, "button", "contacts-mycard-edit__photo-remove", { type: "button", text: "Remove photo" });
      function refreshPreview() {
        var next = ownerAvatar({ display_name: (o.display_name || "Me"), photo: photoRef });
        if (photoPrev.parentNode && typeof photoPrev.parentNode.replaceChild === "function") photoPrev.parentNode.replaceChild(next, photoPrev);
        photoPrev = next;
      }
      fileIn.addEventListener("change", function () {
        var f = fileIn.files && fileIn.files[0];
        if (!f || !ownerBlobStore) return;               // no file / no store -> no-op (cold-safe)
        // THE PRIVACY STEP (symmetry with the contact path,): the operator's OWN photo is
        // the one most likely to carry home GPS. Route it through the Phase-1 pipeline so only the
        // oriented, square, 512² jpeg — EXIF/GPS stripped — is stored; the raw File never lands.
        // Pipeline ABSENT (a partial shell load only; the shell always loads it) -> NO put at all,
        // never a raw-with-GPS fallback — the "raw never stored" invariant holds on EVERY path.
        var pipe = root.photoPipeline;
        if (!pipe || typeof pipe.processContactPhoto !== "function") return;
        var key = ownerBlobStore.keyFor("owner", "me");  // stable per-owner key
        pipe.processContactPhoto(f, { size: 512, quality: 0.85 }).then(function (blob) {
          return ownerBlobStore.put(key, blob).then(function () {
            photoRef = { key: key, mime: (blob && blob.type) || "image/jpeg" };
            refreshPreview();
            emitOwnerPhotoChanged(fileIn, photoRef);       // NAMED auto-feed-to-connections hook
          });
        }).catch(function () { /* cold-safe: keep the previous photo */ });
      });
      removeBtn.addEventListener("click", function () {
        if (photoRef && ownerBlobStore) { try { ownerBlobStore.remove(photoRef.key); } catch (e) {} }
        photoRef = null;
        refreshPreview();
        emitOwnerPhotoChanged(removeBtn, null);           // NAMED auto-feed-to-connections hook
      });
      photoRow.appendChild(photoPrev);
      photoRow.appendChild(fileIn);
      photoRow.appendChild(removeBtn);
      wrap.appendChild(photoRow);

      var e0 = (o.emails && o.emails[0]) || {}, p0 = (o.phones && o.phones[0]) || {};
      var nameIn  = el(doc, "input", "contacts-mycard-edit__input field", { type: "text",  value: o.display_name || "", placeholder: "Your name" });
      var emailIn = el(doc, "input", "contacts-mycard-edit__input field", { type: "email", value: e0.email || "",       placeholder: "Email" });
      var phoneIn = el(doc, "input", "contacts-mycard-edit__input field", { type: "tel",   value: p0.phone || "",       placeholder: "Phone" });
      [["Name", nameIn], ["Email", emailIn], ["Phone", phoneIn]].forEach(function (row) {
        var r = el(doc, "label", "contacts-mycard-edit__row");
        r.appendChild(el(doc, "span", "contacts-mycard-edit__label", { text: row[0] }));
        r.appendChild(row[1]);
        wrap.appendChild(r);
      });
      var save = el(doc, "button", "contacts-mycard-edit__save", { type: "button", text: "Save" });
      save.addEventListener("click", function () {
        var profile = {
          display_name: nameIn.value || "",
          emails: emailIn.value ? [{ email: emailIn.value, is_primary: true }] : [],
          phones: phoneIn.value ? [{ phone: phoneIn.value, is_primary: true }] : [],
          photo: photoRef   // leg 2: {key,mime} ref into the sovereign sidecar, or null (blob already stored on upload)
        };
        try {   // dispatch up to shell-boot -> setOwnerProfile (openMyCard is in render()'s closure, not renderList's — no emitGroup here)
          var view = doc && doc.defaultView;
          var ev = (view && typeof view.CustomEvent === "function")
            ? new view.CustomEvent("forest:owner-profile-save", { detail: { profile: profile }, bubbles: true })
            : { type: "forest:owner-profile-save", detail: { profile: profile }, bubbles: true };
          if (typeof save.dispatchEvent === "function") save.dispatchEvent(ev);
        } catch (e) { /* cold-safe */ }
        ownerLocal = (root.viewConfig && root.viewConfig.ownerProfileOf)
          ? root.viewConfig.ownerProfileOf({ ownerProfile: profile }) : profile;   // optimistic: show the saved card now
        renderMyCardRead(ownerLocal);
      });
      wrap.appendChild(save);
      host.appendChild(wrap);
      if (typeof nameIn.focus === "function") { try { nameIn.focus(); } catch (e) {} }
    }

    // owed 779 — HOISTED out of showList's callback slot to render() scope. It was a named
    // function EXPRESSION passed inline to renderList, so it was reachable only from inside
    // itself; the search seam below needs to call it. Nothing else changed: it still closes
    // over host/ctx/api/injected/showList, and renderList still receives it as its callback.
    // ★ Note what it actually reads off `person`: ONLY `.id`. It was already a fetch-then-open.
    function openRecord(person) {
      setMastheadActive(false);   // (leg 3) a contact is opening -> My Card is no longer the open record
      var reopen = function () { openRecord(person); };
      if (injected && injected.records && injected.records[person.id]) {
        renderRecord(host, ctx, api, injected.records[person.id], showList, reopen); return;
      }
      host.textContent = "";
      host.appendChild(el(doc, "p", "contacts-loading", { text: "Reading \u2026" }));
      api.get(person.id).then(function (env) {
        if (env.ok && env.data) {
          // The tool returns { contact:{...} } or the record directly — read both.
          var rec = env.data.contact || env.data;
          renderRecord(host, ctx, api, rec, showList, reopen);
        } else {
          host.textContent = "";
          host.appendChild(readFailNode(doc, env));
          var b = el(doc, "button", "contacts-record__back", { type: "button", text: "\u2190 Contacts" });
          b.addEventListener("click", showList); host.appendChild(b);
        }
      });
    }
    function showList() {
      myCardActive = false;   // (leg 3) back to the list -> the masthead rebuilds un-lit
      renderList(host, ctx, api, injected, openRecord, openMyCard, renderOwnerMasthead);
    }
    showList();

    // owed 779 — the SEARCH open-by-id bridge. Expose THIS live view's opener so a
    // forest:search-open {store:"contacts", id} (routed by the shell host) lands on the
    // RECORD, not merely on the app. Same shape as calendar's __liveOpenNewPrefilled and
    // mail's __liveOpenCompose (the E3 cross-app idiom, third application) — and it consumes
    // an intent that arrived before this view was built, because the host fires tab-select and
    // openById back-to-back and contacts may still be finishing its lazy read.
    // openRecord takes only `.id`, so a one-key stub is a complete argument — and it does the
    // fetch itself (api.get). Cold-safe: any throw leaves the list exactly as it rendered.
    try {
      root.contactsRenderer.__liveOpenById = function (id) {
        var pid = String(id == null ? "" : id);
        if (pid) openRecord({ id: pid });
      };
      var pendingOpenId = root.contactsRenderer.__pendingOpenId;
      if (pendingOpenId) {
        root.contactsRenderer.__pendingOpenId = null;
        openRecord({ id: String(pendingOpenId) });
      }
    } catch (e) { /* cold-safe: the bridge is best-effort; the list still renders */ }
  }

  /* ---- owed 779 · the search open-by-id entry ------------------------------- *
   * openById(id) is the contacts-owned entry the shell host calls when a search  *
   * hit {store:"contacts", id} is clicked. If a contacts view is live, it opens   *
   * the record now; otherwise it stashes a pending intent the next render()       *
   * consumes (contacts may still be mounting — the host fires forest:tab-select   *
   * and openById back-to-back). Symmetric with calendar's openNewPrefilled and    *
   * mail's openComposeTo. Cold-safe: empty id -> false, no-op; a live-opener      *
   * throw -> pending. Returns whether the intent was ACCEPTED, not whether the    *
   * record was found — the fetch is async and reports its own failure on screen.  */
  function openById(id) {
    var pid = String(id == null ? "" : id).trim();
    if (!pid) return false;
    var cr = root.contactsRenderer;
    if (cr && typeof cr.__liveOpenById === "function") {
      try { cr.__liveOpenById(pid); return true; } catch (e) { /* fall through to pending */ }
    }
    if (cr) cr.__pendingOpenId = pid;
    return true;
  }

  /* ---- registration (self-register the "contacts" kind, cold-safe) ----------- */
  function registerSelf(pane) {
    pane = pane || root.pane;
    if (pane && typeof pane.registerRenderer === "function") { pane.registerRenderer("contacts", render); return true; }
    return false;
  }
  registerSelf();

  /* ---- export --------------------------------------------------------------- */
  root.contactsRenderer = {
    render: render,
    registerSelf: registerSelf,
    // owed 779 — the search open-by-id seam. shell-boot.js:499 calls this on forest:search-open.
    openById: openById,
    _initials: initials,
    _highlight: fillHighlighted,
    _labelBadges: labelBadges,
    _context: renderContext,
    _notes: notesSection,
    _followups: followUpsSection,
    _timeline: timelineSection,
    _io: importExportBar,
    _primaryEmail: primaryEmailOf,
    // §7.2 — the left column's pure builder, exported for contacts-menu.test.js
    // (mirrors mail-renderer's `renderRail` export; a pure builder unit-tests without the view).
    renderRail: renderRail,
    // W1 — the record view, exported for contacts-write-path.test.js. Same precedent as
    // renderRail: the write path's controls are ON the record, so the suite that pins them has to
    // be able to build one without driving a whole list->fetch->open cycle first.
    renderRecord: renderRecord,
    // C2 — the list view, exported for contacts-bulk.test.js. Third instance of the same
    // precedent renderRail and renderRecord already set: the surface a suite must pin lives INSIDE
    // this builder, so the suite has to be able to build one against a fake api without driving a
    // whole mount->fetch cycle first. Signature: (host, ctx, api, injected, openRecord).
    renderList: renderList,
    // slot 07 — the merge surfaces, exported for contacts-merge.test.js. Fourth instance
    // of the renderRail/renderRecord/renderList precedent: the surface the suite must pin lives
    // inside this builder. `MERGE_SCALAR_FIELDS` is exported for one reason only — so the suite
    // can FOLD it against `_tools/loopcontact.js`'s real `scalarFields` array instead of trusting
    // a comment. It is a mirror of a substrate constant, and every hand-kept mirror on this line
    // has drifted; this one is checked by a test that reads the substrate (M-E3).
    _test: {
      openMergePrompt: openMergePrompt,
      openCompareDialog: openCompareDialog,
      candidatesFor: candidatesFor,
      MERGE_SCALAR_FIELDS: MERGE_SCALAR_FIELDS,
      // P3 slice 3 — the fenced export-with-PHOTO splice, exported so the suite can pin the
      // PURE transform (spliceVCardPhotos) and the async blob->line pre-step (buildPhotoLines)
      // without driving a whole export->download cycle. Same precedent as renderRecord/renderList.
      spliceVCardPhotos: spliceVCardPhotos,
      buildPhotoLines: buildPhotoLines
    },
    // E6 — the Person Canopy, exported for contacts-canopy.test.js. Fifth instance of the
    // renderRail/renderRecord/renderList/merge precedent: the surface the suite must pin
    // lives inside this builder, so the suite has to be able to build one against injected
    // seams without driving a whole mount->fetch->open cycle first.
    _canopy: canopySection,
    _canopyN: function () { return CANOPY_N; },
    _version: "1.28" // P3 s3: export-with-PHOTO — the fenced vCard splice (spliceVCardPhotos/buildPhotoLines) inserts each contact's sovereign photo blob as one PHOTO;ENCODING=b line, TC-1 kept (tool serializes, shell splices one line, no field parsed/rewritten). 2-part per C13 (was 1.27; substantive change bumps MINOR).
  };
})();
