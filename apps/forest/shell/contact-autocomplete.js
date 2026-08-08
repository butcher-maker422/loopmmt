/* Shea's Forest — the App Shell · shell/contact-autocomplete.js
   THE WEAVE · edge E4 — the guest picker for "Invite a contact" on an event.

   THE VIEW. When the owner clicks "Invite a contact" on an event record, a small
   search field appears. As they type, this offers name matches read from their OWN
   contacts. Picking one names that person as a guest — it calls back with the picked
   contact's { id, display_name }; the caller (the calendar record) does the actual
   attendee write via api.addAttendee. This module NEVER writes; it only picks.

   NOT mail-compose-autocomplete. That module is compose-recipient-shaped: it splits a
   comma list, finds the token being typed, and REPLACES it with a chosen ADDRESS. A
   guest field is different — it is pick-ONE-contact-add, not build-a-recipient-list.
   So this is a fresh, smaller component: type -> match -> pick one -> onPick(contact).
   (The "generalize vs clone" call was resolved to a fresh picker so E2's compose flow
   can never regress from an E4 change — two shapes, two components.)

   THE SEAM. It reads GET /api/contact/api/contacts/search?q= through the shell's thin
   contacts client (window.ForestShell.contactsRest.makeClient().search) — the SAME
   seam E2 uses — which forwards in-process to the bundled loopcontact tool's FTS5
   search. The route returns { results: [ { id, display_name, primary_email, ... } ] }.

   TC-1 (thin-client discipline). This module carries NO contact business logic. It
   does NOT rank, match, normalize, dedup, or score — the TOOL's FTS5 does all matching;
   the client SENDS the typed token and RENDERS the tool's rows verbatim. If you feel
   the urge to decide *which* contact matches here, it belongs in the tool.

   HONEST (Real-or-Made / flag-don't-fake). The dropdown renders only real rows the
   tool returned; a failed or empty read shows nothing (never a fabricated or stale
   suggestion). Unlike E2, a contact WITHOUT a primary_email is still a valid guest
   (the tool's addAttendee needs display_name, not an address) — so such a contact IS
   offered; the email is shown only as a quiet sub-label when it exists.

   COLD-SAFE. Absent the `block` atom, the document, or the `contactsRest` read seam
   (or an injected `searchFn`), `attach` is a no-op returning { wired: false } and
   leaves the input exactly as it is. No error, no throw, no stall.

   INJECTION-SAFE. Every node is built via `block.el` (createElement + textContent /
   setAttribute) — never innerHTML — so a contact's name can never inject markup.

   Plain script (no ES module) — attaches to window.ForestShell.contactAutocomplete.
   Injectable searchFn (opts.searchFn) so it is unit-testable with no network,
   cold-safe. Read at record-render time by calendar-renderer.js (the invite handler). */
(function () {
  "use strict";
  var root = (window.ForestShell = window.ForestShell || {});

  function elOf() { return root.block && root.block.el; }

  // defaultSearchFn(opts) -> a searchFn built from the live contactsRest seam, or
  // null when the seam is absent (cold-safe: attach then no-ops the wiring). Mirrors
  // E2's default seam exactly — same client, same envelope unwrap.
  function defaultSearchFn(opts) {
    var cr = root.contactsRest;
    if (!cr || typeof cr.makeClient !== "function") return null;
    var client = cr.makeClient(opts.restOpts || {});
    return function (q) {
      return client.search(q).then(function (env) {
        // TC-1: unwrap the honest envelope and return the tool's rows verbatim.
        if (!env || !env.ok || !env.data) return [];
        var d = env.data;
        return d.results || d.contacts || [];         // search route emits { results }; be tolerant
      });
    };
  }

  // attach(input, opts) -> wires the guest picker onto one search input. Returns a
  // handle { wired, query, close, pick, isOpen, detach }. opts:
  //   doc?        the document (defaults to input.ownerDocument)
  //   searchFn?   q -> Promise<contact[]> (test seam; defaults to the contactsRest seam)
  //   restOpts?   passed to contactsRest.makeClient for the default seam
  //   minChars?   minimum length before querying (default 1)
  //   debounceMs? keystroke debounce (default 140)
  //   onPick?     callback(contact) after a pick — { id, display_name, primary_email, ... }
  function attach(input, opts) {
    opts = opts || {};
    var el = elOf();
    var doc = opts.doc || (input && input.ownerDocument);
    if (!input || !el || !doc) return { wired: false, detach: function () {} };

    var searchFn = typeof opts.searchFn === "function" ? opts.searchFn : defaultSearchFn(opts);
    if (!searchFn) return { wired: false, detach: function () {} };   // no read seam -> plain input

    var minChars = opts.minChars != null ? opts.minChars : 1;
    var debounceMs = opts.debounceMs != null ? opts.debounceMs : 140;

    var row = input.parentNode || input;
    if (row.classList) row.classList.add("contact-autocomplete");
    var menuId = "cac-" + Math.random().toString(36).slice(2, 8);
    var menu = el(doc, "div", "contact-autocomplete__menu",
      { role: "listbox", hidden: "hidden", "aria-label": "Contact suggestions" });
    menu.id = menuId;
    row.appendChild(menu);

    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", menuId);
    input.setAttribute("autocomplete", "off");

    var items = [];      // [{ el, contact }]
    var active = -1;
    var open = false;
    var timer = null;
    var lastReq = 0;

    function close() {
      open = false; active = -1; items = [];
      while (menu.firstChild) menu.removeChild(menu.firstChild);
      menu.setAttribute("hidden", "hidden");
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    }

    function pick(contact) {
      if (!contact) { close(); return; }
      // A guest needs a name (the tool requires display_name). A row with no name is
      // not pickable (never invite a nameless guest) — honest, mirrors E2's no-address gate.
      var name = contact.display_name ? String(contact.display_name) : "";
      if (!name) { close(); return; }
      if (typeof opts.onPick === "function") opts.onPick(contact);
      close();
    }

    function render(contacts) {
      while (menu.firstChild) menu.removeChild(menu.firstChild);
      items = [];
      (contacts || []).forEach(function (c, i) {
        if (!c || !c.display_name) return;            // only offer pickable (has a name) — honest
        var it = el(doc, "div", "contact-autocomplete__item",
          { role: "option", id: menuId + "-" + i, "aria-selected": "false" });
        it.appendChild(el(doc, "span", "contact-autocomplete__name", { text: c.display_name }));
        // Email is a quiet sub-label — shown only when it exists (name-over-email, no colour crutch).
        if (c.primary_email) {
          it.appendChild(el(doc, "span", "contact-autocomplete__email", { text: c.primary_email }));
        }
        // mousedown (not click) fires before the input's blur that would otherwise close the menu first.
        it.addEventListener("mousedown", function (ev) {
          if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
          pick(c);
        });
        menu.appendChild(it);
        items.push({ el: it, contact: c });
      });
      if (!items.length) { close(); return; }
      open = true; active = -1;
      menu.removeAttribute("hidden");
      input.setAttribute("aria-expanded", "true");
    }

    function setActive(i) {
      if (!items.length) return;
      if (i < 0) i = items.length - 1;
      if (i >= items.length) i = 0;
      items.forEach(function (it, idx) {
        var on = idx === i;
        it.el.setAttribute("aria-selected", on ? "true" : "false");
        if (it.el.classList) it.el.classList.toggle("is-active", on);
      });
      active = i;
      input.setAttribute("aria-activedescendant", items[i].el.id);
    }

    function query() {
      var q = String(input.value == null ? "" : input.value).trim();
      if (!q || q.length < minChars) { close(); return; }
      var req = ++lastReq;
      Promise.resolve(searchFn(q)).then(function (contacts) {
        if (req !== lastReq) return;                  // a newer keystroke superseded this read
        render(contacts || []);
      }).catch(function () { close(); });             // honest: a failed read shows nothing
    }

    function onInput() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(query, debounceMs);
    }

    function onKeydown(ev) {
      if (!open) {
        if (ev.key === "ArrowDown") { query(); }      // open the menu from a filled field
        return;
      }
      if (ev.key === "ArrowDown") { if (ev.preventDefault) ev.preventDefault(); setActive(active + 1); }
      else if (ev.key === "ArrowUp") { if (ev.preventDefault) ev.preventDefault(); setActive(active - 1); }
      else if (ev.key === "Enter") {
        if (active >= 0 && items[active]) { if (ev.preventDefault) ev.preventDefault(); pick(items[active].contact); }
      }
      else if (ev.key === "Escape") { if (ev.preventDefault) ev.preventDefault(); close(); }
      else if (ev.key === "Tab") { close(); }         // let Tab move focus on, but close the menu
    }

    function onBlur() { setTimeout(close, 120); }     // delay so a mousedown-pick lands first

    input.addEventListener("input", onInput);
    input.addEventListener("keydown", onKeydown);
    input.addEventListener("blur", onBlur);

    return {
      wired: true,
      query: query,            // test seam: force a query
      close: close,
      pick: pick,
      isOpen: function () { return open; },
      detach: function () {
        input.removeEventListener("input", onInput);
        input.removeEventListener("keydown", onKeydown);
        input.removeEventListener("blur", onBlur);
        close();
        if (row.classList) row.classList.remove("contact-autocomplete");
        if (menu.parentNode) menu.parentNode.removeChild(menu);
      }
    };
  }

  root.contactAutocomplete = {
    _version: "1.0",
    attach: attach
  };
})();
