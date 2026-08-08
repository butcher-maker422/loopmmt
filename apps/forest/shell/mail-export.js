/* Shea's Forest — the App Shell · shell/mail-export.js
   EXPORT — email-app D1 (the Thing-list line,). THE DEBT, paid.

   WHAT THIS IS. The way out. `toMbox(mailbox)` turns your mail into a `.mbox` archive you can
   download, keep, and open in anything.

   ⚠ WHY THIS IS NOT A FEATURE. The Cannot says, in C8, in the same voice and with the same moral
   weight as every other guard: **"It will never make leaving hard."** Until this file existed, that
   was a WISH. You could import an .mbox. You could not get your mail out. Byte-verified: there was
   no export verb anywhere in the app. So C8 was not an unbuilt feature — it was a LIE IN FORCE, and
   this file is the retraction, not an enhancement.

   AND IT IS THE KEYSTONE, not a nicety. An app you cannot leave is an app whose promises are
   UNENFORCEABLE — you have no exit, so you have no leverage, so every other guard on the list is a
   thing we merely say. Export is what makes the rest of them credible. It is the anti-hostage clause.
   The industry default is one click in, seven clicks out; without this we were shaped exactly like
   the industry we wrote the Cannot against.

   ══ WHY MBOX, AND WHY THAT CHOICE PROVES SOMETHING ══════════════════════════════════════════════
   The app ALREADY IMPORTS .mbox (forest/connectors/sources/mbox.js — the leg-3 adapter). So the exit
   is not a format we invented and asked you to trust: it is the SAME format the app reads.

   That makes the promise DECIDABLE instead of rhetorical. The acceptance test for this file is not
   "a download button appears." It is:

       toMbox(mailbox) -> the app's OWN mbox import adapter -> mailboxFromExport -> the same mailbox

   A round trip through the real importer, not through a parser written to agree with me. If that
   holds, you can LEAVE — provably — and you can also come back, which is the same property read
   backwards. (This is the Tromp Test's predicate: an invertible derivation, not a depiction.)

   MBOXRD — matched to the reader, not guessed at. `connectors/sources/mbox.js` reads MBOXRD, so this
   writes MBOXRD, and the two facts are one decision:
     • The separator is `From <envelope> <asctime>`. The reader hardens against over-segmentation by
       requiring a 4+-digit run (the year) after the envelope token, so the date is NOT decorative —
       omit it and the reader treats the separator as preamble and silently swallows the message.
     • Body lines matching /^>*From / are escaped with one leading '>'. The reader strips exactly one
       back. THIS IS THE CLASSIC MBOX CORRUPTION and it is silent: an unescaped body line beginning
       "From " splits one message into two, and you would not notice until you opened the archive
       somewhere else, years later, when it mattered. It is tested.

   EVERY HEADER THE MODEL READS IS WRITTEN BACK. mail-model.js parses eleven headers; this writes all
   eleven (Subject, From, Date, To, Cc, Message-Id, X-GM-Thread-Id, X-GM-Labels, List-Unsubscribe,
   List-Unsubscribe-Post, X-GM-Attachments). An export that dropped Message-Id would still LOOK like
   a complete export and would quietly destroy threading and cross-source dedupe on re-import. The
   round-trip test compares the fields, so a dropped header FAILS — it cannot pass by looking right.

   ⚠ THE ONE HONEST GAP — stated here, in the UI, and logged as owed. NOT papered over.
   Attachment BYTES are not in this archive. The model carries attachment METADATA (filename, mime,
   size, attachmentId — the X-GM-Attachments header) and that metadata IS exported, so the archive
   records exactly what was attached to what. But the bytes live behind a server route and fetching
   them is N network calls, which is a different (and bigger) build. So: your mail, all of it, every
   header, portable and re-importable — and a truthful record of the attachments, without their
   contents. That is a REAL limitation and the app says so out loud rather than shipping a download
   that quietly isn't everything. Flag, don't fake. (owed: email-app-export-attachment-bytes)

   NOTHING HERE TRANSMITS AND NOTHING HERE DELETES. Export is a pure read: mailbox in, string out. It
   is a pure function of the list it is handed — no I/O, no network, no store, no clock except the one
   you inject. Leaving does not tell anyone you are leaving, and it does not cost you your mail.

   Plain script (no ES module, no deps) — attaches to window.ForestShell.mailExport.
   Cold-safe throughout: null / junk in -> honest "" / [] / 0 out, never throws. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  /* ---- the envelope line ------------------------------------------------------ *
   * `From <envelope> <asctime>` — RFC 4155. The reader (connectors/sources/mbox.js)  *
   * requires a non-space envelope token AND a 4+-digit run after it, so BOTH parts    *
   * are load-bearing: a separator without a date is read as preamble and the message   *
   * it introduces is swallowed. MAILER-DAEMON is the conventional fallback envelope     *
   * when the From header carries no parseable address (never a fabricated one).          */
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  // asctime — "Sun Jul 12 20:15:00 2026". The year is what the reader's separator test keys on.
  function asctime(ms) {
    var d = new Date((typeof ms === "number" && isFinite(ms)) ? ms : Date.now());
    if (isNaN(d.getTime())) d = new Date(0);
    return DAYS[d.getDay()] + " " + MONTHS[d.getMonth()] + " " + pad2(d.getDate()) + " " +
           pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()) + " " +
           d.getFullYear();
  }

  // The addr-spec out of a From header ("Jamie <jamie@example.com>" -> "jamie@example.com").
  // No address -> MAILER-DAEMON (the conventional envelope), never an invented one.
  function envelopeOf(from) {
    var s = String(from == null ? "" : from);
    var m = /<([^<>\s]+@[^<>\s]+)>/.exec(s) || /([^\s<>,;:]+@[^\s<>,;:]+)/.exec(s);
    var addr = m ? m[1] : "";
    addr = addr.replace(/\s+/g, "");
    return addr || "MAILER-DAEMON";
  }

  /* ---- MBOXRD body escaping — the silent-corruption guard --------------------- *
   * Any body line matching /^>*From / gets ONE leading '>'. The reader strips one    *
   * back, so the round trip is exact. Skip this and a body line that begins "From "   *
   * becomes a MESSAGE SEPARATOR: one email silently becomes two, in an archive you     *
   * will not open for years. This is the single most important function in this file.  */
  function escapeBody(body) {
    var s = String(body == null ? "" : body);
    return s.split("\n").map(function (line) {
      return /^>*From /.test(line) ? ">" + line : line;
    }).join("\n");
  }

  // One header line, only when the value is non-empty. An empty header is NOT written — a bare
  // "Cc: " on re-import is a fabricated empty field where the truth was "there was no Cc."
  function hdr(name, value) {
    var v = String(value == null ? "" : value).trim();
    return v === "" ? "" : (name + ": " + v + "\n");
  }

  /* ---- one message -> one mbox entry ------------------------------------------ *
   * Writes EVERY header mail-model.js parses. The order mirrors the model's read     *
   * order; the model is order-insensitive, but a stable order makes the archive        *
   * diffable, which is a property you want the day you are checking whether your        *
   * export is honest.                                                                    */
  function messageToEntry(m, nowMs) {
    if (!m || typeof m !== "object") return "";
    var when = (typeof m.when === "number" && isFinite(m.when)) ? m.when : nowMs;
    var out = "From " + envelopeOf(m.from) + " " + asctime(when) + "\n";
    out += hdr("Subject", m.subject);
    out += hdr("From", m.from);
    out += hdr("Date", m.date);
    out += hdr("To", m.to);
    out += hdr("Cc", m.cc);
    out += hdr("Message-Id", m.messageId);
    out += hdr("X-GM-Thread-Id", m.threadId);
    // labels: the model may hold an array (parsed) or the raw header string. Both serialize.
    var labels = m.labels;
    if (labels && typeof labels.join === "function") labels = labels.join(",");
    out += hdr("X-GM-Labels", labels);
    out += hdr("List-Unsubscribe", m.unsubscribe);
    // The one-click declaration. ⚠ THE MODEL CALLS THIS `unsubscribeOneClick`, not `oneClick`
    // (mail-model.js:176) — reading the wrong name here fails SILENTLY: every archive would simply
    // omit the header and nothing would complain. Both names are accepted so a hand-built message
    // object (as the T3 fixtures use) also serializes.
    if (m.unsubscribeOneClick === true || m.oneClick === true) out += "List-Unsubscribe-Post: List-Unsubscribe=One-Click\n";
    // attachments: METADATA only, and the model carries it raw (a single-line JSON array). An array
    // here is re-serialized; a string passes through. The BYTES are not in this archive — see the
    // header note. Recording the metadata is the honest half: the archive says what WAS attached.
    var att = m.attachments;
    if (att && typeof att === "object") { try { att = JSON.stringify(att); } catch (e) { att = ""; } }
    out += hdr("X-GM-Attachments", att);
    out += "\n";                          // the header/body separator
    out += escapeBody(m.body);
    if (!/\n$/.test(out)) out += "\n";
    return out;
  }

  /* ---- toMbox(mailbox[, opts]) -> the archive text ----------------------------- *
   * Pure. Mailbox in, string out. No I/O, no network, no store. `opts.now` injects     *
   * the clock (an undated message falls back to it) so the output is deterministic in   *
   * a test. An empty mailbox exports "" — an honest empty archive, never a throw and     *
   * never a fabricated placeholder message.                                               */
  function toMbox(mailbox, opts) {
    opts = opts || {};
    var nowMs = (typeof opts.now === "number" && isFinite(opts.now)) ? opts.now : Date.now();
    var list = (mailbox && typeof mailbox.length === "number") ? mailbox : [];
    var parts = [];
    for (var i = 0; i < list.length; i++) {
      var e = messageToEntry(list[i], nowMs);
      if (e) parts.push(e);
    }
    return parts.join("\n");   // a blank line between entries — conventional, and the reader tolerates it
  }

  // count(mailbox) -> how many messages this export will actually contain. The UI states this to you
  // BEFORE you click, so the download is never a surprise. Not a badge (C5): you asked, it answered.
  function count(mailbox) {
    var list = (mailbox && typeof mailbox.length === "number") ? mailbox : [];
    var n = 0;
    for (var i = 0; i < list.length; i++) { if (list[i] && typeof list[i] === "object") n++; }
    return n;
  }

  // filename([now]) -> "forest-mail-YYYY-MM-DD.mbox". Dated, because you will do this more than once
  // and a file called "export.mbox" is a file you cannot tell from the last one.
  function filename(now) {
    var d = new Date((typeof now === "number" && isFinite(now)) ? now : Date.now());
    if (isNaN(d.getTime())) d = new Date(0);
    return "forest-mail-" + d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + ".mbox";
  }

  root.mailExport = {
    toMbox: toMbox,
    count: count,
    filename: filename,
    // internals, exported for the battery (each is a place a silent corruption could live)
    escapeBody: escapeBody,
    envelopeOf: envelopeOf,
    asctime: asctime
    /* ⚠ AND NOTHING ELSE. No fetch. No send. No delete. No "are you sure?". Leaving is a right,
       not a request — the app does not get to ask you to reconsider, and it does not get to know. */
  };
})();
