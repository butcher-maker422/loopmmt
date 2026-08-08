/* Shea's Forest — the App Shell · shell/mail-decline.js
   DECLINE — email-app T1 (the Thing-list line,). The LETTER primitive.

   WHAT IT IS. A way to say "this one isn't mine to answer" — deliberately, and finished.

   WHY IT DOES NOT EXIST ANYWHERE. The 12-app survey found EIGHT mechanisms for "not right now"
   — snooze, bubble-up, follow-up, reply-later, set-aside, turn-into-a-todo, ignore, do-not-disturb.
   Eight painkillers for one disease. Every one of them ASSUMES the debt exists and only manages
   WHEN you pay it. None of them cancel it. There is no "no." The sender sent for free; you either
   pay (reply) or you carry it (guilt). This is the first mechanism that lets you put it down.

   ⚠ THE THING IS THE ABSENCE. Read the exports and notice what is NOT there:
   THERE IS NO `dueClear`. THERE IS NO RESURFACE. THERE IS NO TIMER.
   mail-snooze.js — the module this one is otherwise shaped like — has `dueClear(now)`, which
   auto-resurfaces an item once its time passes. That single function is the difference between
   *deferral* and *decision*, and its absence here is the entire feature. A declined message does
   not come back. Not on a schedule, not in a digest, not as a badge. **You answered. The answer
   was no.** If a future edit adds a resurface path to this module it has not extended `decline` —
   it has quietly turned it back into snooze, and the test battery says so out loud.

   HOW IT DIFFERS FROM ARCHIVE — the honest version, because the mechanism alone does not carry it.
   Mechanically, "declined" is a local terminal-state store: hidden from the inbox, surfaced in a
   Declined view. Archive is also "hidden from the inbox." The difference is not the hiding, it is
   the SHAPE of what remains:
     • Archive is a NEUTRAL STORE  — "filed; I might come back to it." The debt is still yours.
     • Declined is a CLOSED DECISION — "I answered: no." The Declined view is a RECORD, not a
       to-do list. Nothing in this module ever puts a declined message back in front of you.
   Do not oversell it as more than that. The mechanism is small. The Thing is that the act is
   DISTINCT, DELIBERATE, and HAS NO RETURN PATH.

   ⚠ LETTERS ONLY — gated on T3 (mail-type.js). `canDecline(m)` is TRUE only for a `letter`.
   You cannot decline a `notification`: nobody is on the other end waiting, so there is no debt to
   cancel — a receipt does not need your permission to stop mattering (that is `decay`'s job, and
   `decay` is not in this file). You cannot decline an `unknown` either: the app does not offer a
   decision it cannot ground. FAIL-CLOSED — with mail-type absent, `canDecline` is FALSE for
   everything and the verb is simply not offered. No classifier, no decline.

   REVERSIBLE — C1 ("it will never destroy your mail") holds here without exception. `undecline(id)`
   restores the message. Declining hides and records; it does not delete, does not archive server-
   side, does not touch Gmail, and does not reach the network at all. The decision is yours to
   change; it is simply never changed FOR you.

   IT DOES NOT NOTIFY THE SENDER. A decline that notifies is just a rude reply, and it would be
   irreversible — a byte that has left the building cannot be taken back, which would put this
   module in direct conflict with C1 and C3 ("it will never send without you"). Whether a declining
   sender should ever be told is a REAL FORK and it is the operator's, left OPEN on purpose. This
   module builds the reversible half, which is the half that cannot hurt anyone if the fork lands
   the other way. NOTHING HERE TRANSMITS.

   NO COUNT, NO BADGE, NO NAG (C5, C6). The Declined view is a place you go and look, not a number
   the app pushes at you. This module exports `count` ONLY as the host's present-gate (offer the
   view-word only when something is actually declined — never an always-empty control); it is not
   a score and must never be rendered as one.

   Plain script (no ES module, no deps) — attaches to window.ForestShell.mailDecline.
   Cold-safe throughout: null / junk in -> honest false / [] / 0 out, never throws.
   Store shape { id -> declinedAtMs }: the timestamp is a RECORD OF WHEN YOU DECIDED, not a time
   anything happens at. Nothing in this file reads it as a deadline. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  var KEY = "forest.mail.decline.v1";

  /* ---- localStorage backend (V1, SYNC) — same contract as mail-snooze's ------ *
   * Reads / writes a JSON object { id: declinedAtMs }. A corrupt or missing blob   *
   * reads as {} (honest empty), never a throw. Injectable storage for tests.       */
  function localStorageBackend(opts) {
    opts = opts || {};
    var key = opts.key || KEY;
    var ls = opts.storage || (typeof window !== "undefined" ? window.localStorage : null);
    return {
      name: "localStorage",
      read: function () {
        try {
          if (!ls) return {};
          var raw = ls.getItem(key);
          var obj = raw ? JSON.parse(raw) : {};
          return (obj && typeof obj === "object" && !Array.isArray(obj)) ? obj : {};
        } catch (e) { return {}; }
      },
      write: function (map) {
        try { if (!ls) return false; ls.setItem(key, JSON.stringify(map || {})); return true; }
        catch (e) { return false; }
      },
      clear: function () { try { if (ls) ls.removeItem(key); return true; } catch (e) { return false; } }
    };
  }

  /* ---- the store — { id -> declinedAtMs } ------------------------------------ *
   * NOTE THE MISSING METHOD. mail-snooze's store has `dueClear(now)`. This one has  *
   * no equivalent and never will: there is no time at which a declined message does  *
   * anything. The map's value is a record of the decision, not a trigger for it.     */
  function makeStore(backend) {
    backend = backend || localStorageBackend();
    function clean(obj) {
      var out = {};
      Object.keys(obj || {}).forEach(function (id) {
        var at = obj[id];
        if (id && typeof at === "number" && isFinite(at)) out[String(id)] = at;   // drop corrupt rows
      });
      return out;
    }
    return {
      backendName: backend.name,
      map: function () { return clean(backend.read()); },

      // decline(id[, now]) -> true on write. A blank id is refused (you cannot decline nothing).
      // `now` defaults to the wall clock; tests inject a fixed one. Idempotent: re-declining an
      // already-declined id rewrites the same decision and is harmless.
      decline: function (id, now) {
        var i = String(id == null ? "" : id).trim();
        if (i === "") return false;
        var t = (typeof now === "number" && isFinite(now)) ? now : Date.now();
        var m = this.map(); m[i] = t; return backend.write(m);
      },

      // undecline(id) -> true. THE DECISION IS YOURS TO CHANGE (C1 — nothing is destroyed).
      // Idempotent: an absent id is still a clean write. This is the ONLY route back, and it is
      // manual, deliberate, and yours. There is no automatic one.
      undecline: function (id) {
        var i = String(id == null ? "" : id).trim();
        if (i === "") return false;
        var m = this.map(); if (Object.prototype.hasOwnProperty.call(m, i)) delete m[i];
        return backend.write(m);
      },

      // declinedAt(id) -> the ms at which you decided, or null. A RECORD, never a deadline.
      declinedAt: function (id) {
        var i = String(id == null ? "" : id).trim();
        var m = this.map(); return Object.prototype.hasOwnProperty.call(m, i) ? m[i] : null;
      },

      isDeclined: function (id) { return this.declinedAt(id) !== null; },

      clear: function () { return backend.clear(); }
    };
  }

  var _default = makeStore(localStorageBackend());

  /* ---- the type gate (T3) — LETTERS ONLY, FAIL-CLOSED ------------------------ *
   * canDecline(m) is true iff mail-type classifies m as a `letter`. A notification   *
   * has nobody waiting (nothing to decline); an unknown is not grounded enough to     *
   * offer a decision on. With mail-type ABSENT the answer is FALSE for everything —   *
   * fail-closed, so a missing classifier silently removes the verb rather than         *
   * silently offering it on mail it cannot classify.                                   */
  function canDecline(m) {
    var T = root.mailType;
    if (!T || typeof T.isLetter !== "function") return false;   // no classifier, no decline
    if (!m || typeof m !== "object") return false;
    var id = String(m.id == null ? "" : m.id).trim();
    if (id === "") return false;                                 // cannot decline an id-less row
    return T.isLetter(m) === true;
  }

  /* ---- list overlays (pure — the render layer reads these) -------------------- *
   * hide(list)  -> the default view: declined mail is OUT of the inbox.             *
   * only(list)  -> the Declined view: a RECORD of decisions, not a to-do list.      *
   * count(list) -> the host's PRESENT-GATE only. Never a badge, never a score (C5).  *
   * There is deliberately no `due`, no `pending`, no `overdue`, and no `now` param    *
   * anywhere in this section — time does not enter into a decision that is finished.  */
  function declinedIds(store) {
    store = store || _default;
    var m = store.map(), out = {};
    Object.keys(m).forEach(function (id) { out[id] = true; });
    return out;
  }

  function hide(list, store) {
    var set = declinedIds(store);
    return (list || []).filter(function (m) { return !(m && m.id && set[String(m.id)]); });
  }

  function only(list, store) {
    var set = declinedIds(store);
    return (list || []).filter(function (m) { return !!(m && m.id && set[String(m.id)]); });
  }

  function count(list, store) { return only(list, store).length; }

  root.mailDecline = {
    localStorageBackend: localStorageBackend,
    makeStore: makeStore,
    canDecline: canDecline,
    declinedIds: declinedIds,
    hide: hide,
    only: only,
    count: count,
    // the default store's verbs, hoisted for the host
    decline: function (id, now) { return _default.decline(id, now); },
    undecline: function (id) { return _default.undecline(id); },
    declinedAt: function (id) { return _default.declinedAt(id); },
    isDeclined: function (id) { return _default.isDeclined(id); },
    map: function () { return _default.map(); },
    clear: function () { return _default.clear(); }
    /* ⚠ AND NOTHING ELSE. No dueClear. No resurface. No timer. No notify. No send.
       If you are adding one of those, you are not extending decline — you are undoing it. */
  };
})();
