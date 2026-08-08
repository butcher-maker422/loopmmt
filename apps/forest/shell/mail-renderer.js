/* Shea's Forest — the App Shell · shell/mail-renderer.js
   email-app leg 2 — the SHELL-WIRE (Pull F1). Gives the leg-1 reader its proper
   home: an authenticated app-shell TAB (capability kind "mail"), instead of the
   public demo.html whose data 401s to a sample. The pane read is CREDENTIALED
   (same-origin/owner session), so the mailbox this renders is the owner's REAL
   mail — the authenticated home the go-live wire asked for.

   email-app leg 5 — READ A MESSAGE LEGIBLY (the reading pane). A message row is
   now a button: click (or Enter/Space) opens a detail view showing from · subject ·
   date · the full body rendered LEGIBLY — HTML bodies are stripped to readable text
   (tags dropped, entities decoded, hrefs surfaced as plain text, script/style
   dropped), NEVER the raw `<!DOCTYPE html> …` source the operator saw live. A
   "← Inbox" back affordance restores the list+search view. The swap is a single
   `mail__body` host (list view cached, re-shown on Back — search state intact); the
   list is never left half-torn-down. INJECTION-SAFE still holds: createElement +
   textContent ONLY, no innerHTML, no sanitizer dependency. (A sanitized RICH-HTML
   render is a LATER leg with its own sandboxing decision — not smuggled in here.)

   Provider-agnostic on purpose. This renderer NEVER touches "gmail" — it reads the
   normalized mail model (window.EmailApp.mailModel), which parses the content block
   any import adapter writes. So a second adapter (Loop Email, IMAP, …) drops in
   behind the seam with ZERO change here — the exact reason the email-app is its own
   capability kind and NOT an overload of the gmail connector pane.

   The read surface is the owner-gated, content-bearing GET /export/soil (the
   superset of the K1-stripped /projection/soil the connector panes read). It is
   fetched LAZILY — only when the Mail tab is actually viewed — because it carries
   full mail bodies; folding it into every shell boot would pull the owner's content
   into the browser proactively, which the content-free connector read exists to
   avoid.

   Real-or-Made: a no-session read (401 -> null) renders an HONEST sign-in pane, and
   an empty Soil renders an HONEST empty pane — the live mailbox NEVER wears a sample
   flag, and a fabricated inbox is never shown.

   Two render paths, one view builder:
     • INJECTED (tests / a host pre-fetch): ctx.data.mailExport present -> render
       synchronously from it (the sync path the pane's sync dispatch supports).
     • LAZY (production): no injected export -> paint a calm "reading…" line, then
       credentialed fetch /export/soil and swap in the mailbox (or the honest
       sign-in / empty pane). Cold-safe: no fetch / no model -> honest degrade.

   Pure of the obligation graph — READ-ONLY, like every other pane renderer. Builds
   DOM with createElement/textContent only (injection-safe; the shape the test shim
   supports — no innerHTML).

   Plain script (no ES module) — attaches to window.ForestShell.mailRenderer and
   self-registers with pane if pane is already present. shell-renderers.js's
   registerAll ALSO picks it up (cold-safe optional), so it registers whether it
   loads before or after the pane's registration pass.
   Depends on window.EmailApp.mailModel (the leg-1 core) + window.ForestShell.pane. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  /* ---- DOM helper: the one el(), now shared from shell/block.js ------------- */
  var el = root.block.el;
  function clearNode(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function mm() { return (window.EmailApp && window.EmailApp.mailModel) || null; }

  /* ---- leg 13 — move-to-label: the movable-label set ------------------------ *
   * The label picker in the manage bar adds/removes a label via the SAME /intent/  *
   * modify seam leg 07 built (`action:'label'` + add/removeLabelIds — server done). *
   * Not every Gmail label is a safe message-level toggle, so the picker offers only *
   * the MOVABLE ones: the system labels below are excluded because they either own  *
   * a dedicated manage button (STARRED/IMPORTANT/UNREAD, INBOX=Archive) or are not  *
   * a clean, reversible message-label add via messages.modify (SENT/DRAFT are set   *
   * by Gmail; TRASH/SPAM are destructive-adjacent; CHAT is not user-movable). What  *
   * remains is the user's own labels (+ CATEGORY_*): reversible, label-only, no     *
   * delete path — K1 holds by construction, exactly as the star/important toggles.  */
  var NON_MOVABLE_LABELS = {
    INBOX: 1, STARRED: 1, IMPORTANT: 1, UNREAD: 1,
    SENT: 1, DRAFT: 1, TRASH: 1, SPAM: 1, CHAT: 1
  };
  // movableLabels(labelIds) -> the subset a message-level modify may safely toggle.
  // Pure + cold-safe: a non-array yields []; order is preserved from the input
  // (labelsOf already returns them sorted). Honest by construction — it can only
  // ever REMOVE from the offered set, never invent a label the mailbox doesn't have.
  function movableLabels(labels) {
    if (!Array.isArray(labels)) return [];
    // accept BOTH shapes: a bare id string (from model.labelsOf) or a record { id, name, ... } (from
    // mailLabelCrud.knownLabels — the #06 registry merge). Filter by id against the non-movable set and
    // return the SAME elements (id-in -> id-out, record-in -> record-out), so the picker can render the
    // record's name while still operating on its id.
    return labels.filter(function (l) {
      var id = (typeof l === "string") ? l : (l && typeof l === "object" ? l.id : "");
      return id && !Object.prototype.hasOwnProperty.call(NON_MOVABLE_LABELS, String(id));
    });
  }

  /* ---- source-provenance badge (email-app #25 F2) --------------------------- *
   * unifyMailbox (mail-model #25) records `m.sources` — the sorted-unique set of *
   * source names a surviving row was seen in ('gmail', 'mbox', ...). This turns  *
   * that set into ONE human label for the row's meta line, so the merged inbox   *
   * SHOWS which side(s) a message came from — the visible half of the moat.      *
   *                                                                              *
   * Honest by construction (the movableLabels ethic, one row up): it can only    *
   * ever render a source the row actually carries — it never INVENTS one. A row  *
   * that never went through unify (e.g. #8 "Search all Gmail" server results,    *
   * which paint straight from the search projection) has NO `sources` field, so  *
   * it gets NO badge (flag-don't-fake) rather than a fabricated "Gmail". The     *
   * three spec'd labels are exact; any other set degrades to an honest join of   *
   * its own (prettified) source names, never a guess.                            */
  var SRC_LABEL = { gmail: "Gmail", mbox: "archive" };
  function prettySource(s) {
    return Object.prototype.hasOwnProperty.call(SRC_LABEL, s) ? SRC_LABEL[s] : String(s);
  }
  // sourceBadgeLabel(sources) -> a display string, or null when there is nothing
  // honest to show. Pure + cold-safe: a non-array / empty set yields null (no badge).
  function sourceBadgeLabel(sources) {
    if (!Array.isArray(sources) || sources.length === 0) return null;
    if (sources.length === 1) {
      // solo mbox reads "mbox archive" (its own line), not the bare combo word "archive".
      return sources[0] === "mbox" ? "mbox archive" : prettySource(sources[0]);
    }
    // multi-source: e.g. sorted ['gmail','mbox'] -> "Gmail + archive".
    return sources.map(prettySource).join(" + ");
  }
  // appendSourceBadge(doc, head, sources): attach the provenance chip to a row's
  // meta line IFF there is an honest label. The chip wears the Block Alphabet
  // `chip` skin (block.css — same letter the thread-count chip uses), so it costs
  // zero marginal CSS; `mail-msg__source` is the semantic/behavior hook for tests.
  function appendSourceBadge(doc, head, sources) {
    var label = sourceBadgeLabel(sources);
    if (!label) return null;
    var chip = el(doc, "span", "chip mail-msg__source", {
      text: label, title: "Source: " + label, "aria-label": "Source: " + label
    });
    head.appendChild(chip);
    return chip;
  }

  // appendSourceChip(doc, head, m) — Two Rivers (#5): the per-row SOURCE chip.
  // When the delight module + the SC-4 membrane are loaded, the chip is the
  // SC-4-HONEST provenance mark: built from chipProvenance(m).source (the
  // unforgeable ACCOUNT BINDING), NEVER m.from / the parsed header — and it
  // SUBSUMES the legacy #25 F2 source badge, so a row wears ONE source chip, not
  // two. SC-4 lives HERE: the ROW (m, carrying m.source) is passed to
  // chipProvenance; the chip renders from its output only. Cold-safe: if Two Rivers
  // or the membrane is absent, fall back to the shipped appendSourceBadge (the
  // m.sources dedupe badge, byte-unchanged — zero regression, which is why the
  // existing renderer tests that don't load the delight are unaffected). When the
  // membrane IS loaded but this row carries no binding, the row shows no source mark
  // (honest-absent), never an inferred one.
  function appendSourceChip(doc, head, m) {
    var shell = (typeof window !== "undefined" && window.ForestShell) ? window.ForestShell : null;
    var scp = shell && shell.sourceChipProvenance;
    var tr = shell && shell.twoRivers;
    if (scp && tr && typeof scp.chipProvenance === "function" && typeof tr.renderChip === "function") {
      var chip = tr.renderChip(doc, scp.chipProvenance(m));   // SC-4: m.source in, header un-reachable
      if (chip) head.appendChild(chip);
      return chip;   // membrane loaded: the SC-4 chip is authoritative (null -> honest-absent, no legacy fallback)
    }
    return appendSourceBadge(doc, head, (m && m.sources));    // cold-safe: shipped legacy badge, unchanged
  }

  /* ---- activate: make a non-button node behave like a button (click + keyboard) *
   * role="button" + tabindex are set by the caller; this wires click and Enter/   *
   * Space so the reading pane is reachable without a mouse (accessibility).       */
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

  /* ---- legible body: raw body -> readable DOM (leg 5) ----------------------- *
   * The whole point of the leg: an HTML body renders as legible TEXT, never raw   *
   * <!DOCTYPE …> source. HTML -> strip to text (drop script/style, surface hrefs, *
   * block tags -> line breaks, decode entities, collapse whitespace). Plain text  *
   * -> as-is. Rendered one <p> per line so breaks show — createElement/textContent *
   * only, NO innerHTML (the injection-safe contract holds).                       */
  function cp(n) {
    try { return String.fromCodePoint(n); } catch (e) { return String.fromCharCode(n); }
  }
  function decodeEntities(s) {
    return String(s)
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#0*39;|&apos;/g, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return cp(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return cp(parseInt(d, 10)); })
      .replace(/&amp;/g, "&"); // last, so &amp;lt; -> &lt; (no double-decode)
  }
  function looksLikeHtml(s) {
    return /<!DOCTYPE/i.test(s) || /<html[\s>]/i.test(s) || /<\/?[a-z][a-z0-9]*\b[^>]*>/i.test(s);
  }
  function htmlToText(html) {
    var s = String(html);
    // drop script/style blocks entirely — never surface JS/CSS as body text
    s = s.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
    // surface anchors as plain text: <a href="URL">label</a> -> "label (URL)"
    s = s.replace(/<a\b[^>]*?href\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))[^>]*>([\s\S]*?)<\/a>/gi,
      function (_, _q, dq, sq, uq, label) {
        var url = dq || sq || uq || "";
        var lbl = label.replace(/<[^>]+>/g, "").trim();
        return (lbl ? lbl + " " : "") + "(" + url + ")";
      });
    // block-level closers -> newline; <br> -> newline; table cells -> space
    s = s.replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|table|blockquote|section|article|header|footer|pre)>/gi, "\n");
    s = s.replace(/<br\s*\/?>/gi, "\n");
    s = s.replace(/<\/(td|th)>/gi, " ");
    // drop DOCTYPE, comments, and every remaining tag
    s = s.replace(/<!DOCTYPE[^>]*>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ");
    // decode entities, collapse whitespace, trim per line, collapse blank runs
    s = decodeEntities(s);
    s = s.replace(/[ \t\f\v]+/g, " ");
    s = s.split("\n").map(function (ln) { return ln.trim(); }).join("\n");
    s = s.replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
    return s;
  }
  function legibleBody(doc, rawBody) {
    var host = el(doc, "div", "mail-detail__body record__body");
    var raw = String(rawBody == null ? "" : rawBody);
    var text = looksLikeHtml(raw) ? htmlToText(raw) : raw;
    var lines = text.split("\n");
    var any = false, kept = 0;
    lines.forEach(function (ln) {
      if (ln.trim() === "") return; // paragraph breaks collapse; block spacing is CSS's job
      host.appendChild(el(doc, "p", "mail-detail__line", { text: ln }));
      any = true; kept++;
    });
    if (!any) host.appendChild(el(doc, "p", "mail-detail__line mail-detail__line--empty", { text: "(no content)" }));
    // JT-4 — the one-giant-table case: a very long body is bounded-scrolled inside its
    // region (the declared .record__body--bounded policy) so the record contains it
    // without deforming the frame; a normal-length email flows naturally, no scroll box.
    if (kept > 60 || text.length > 4000) host.className = host.className + " record__body--bounded";
    return host;
  }

  /* ---- the reading pane (leg 5): from · subject · date · legible body + Back -- *
   * leg 6 adds a Reply affordance when onReply is wired (the mailbox threads it to  *
   * openCompose, prefilled). leg 7 adds a MANAGE bar (Archive · Mark as unread) when *
   * `manage` is wired AND the message is gmail-sourced — the two actions are label   *
   * moves via /intent/modify, and both are REVERSIBLE, so each is a single click (no *
   * send-style confirm) with an honest inline result: the server's real reason on    *
   * failure, never a fabricated "Done". Absent manage the pane is leg-5/6 exactly.   */
  /* ---- read-later (leg 16, #13): a purely-LOCAL "come back to this" flag ------ *
   * NOT a Gmail label — a client-side overlay set of message-ids in localStorage    *
   * (Shea's laptop web app, same client-first store as the signature). So it needs   *
   * NO gmail grant and NO source==='gmail' gate: it works on any message with an id,  *
   * including mbox-archived ones the manage bar can't touch. No model change -> parity *
   * holds by construction (the list filter lives in the renderer, not filterMailbox,   *
   * which stays label-pure). Cold-safe: every store touch is wrapped; an absent store   *
   * degrades to an empty set (silent), never a throw. Reversible: toggle it back off.   */
  var RL_KEY = "forest.mail.readlater";
  function _rlRead() {
    var ls = _ls();
    try { var raw = ls && ls.getItem(RL_KEY); var arr = raw ? JSON.parse(raw) : []; return Array.isArray(arr) ? arr : []; }
    catch (e) { return []; }
  }
  function _rlWrite(ids) { var ls = _ls(); try { if (ls) ls.setItem(RL_KEY, JSON.stringify(ids || [])); return true; } catch (e) {} return false; }
  function rlHas(id) { if (!id) return false; return _rlRead().indexOf(String(id)) !== -1; }
  function rlIds() { return _rlRead().slice(); }
  function rlToggle(id) {
    if (!id) return false;
    id = String(id);
    var ids = _rlRead(); var at = ids.indexOf(id);
    if (at === -1) { ids.push(id); _rlWrite(ids); return true; }   // now IN read-later
    ids.splice(at, 1); _rlWrite(ids); return false;                 // now OUT
  }
  // The controller a view uses: an injected {has,toggle} (test/host seam) or the module store.
  function readLaterFrom(carrier) {
    var c = carrier && carrier.readLater;
    if (c && typeof c === "object" && typeof c.has === "function" && typeof c.toggle === "function") return c;
    if (c) return { has: rlHas, toggle: rlToggle, ids: rlIds };   // truthy but not a controller -> module store
    return null;                                                    // absent -> feature not wired for this caller
  }

  // email-app #9 — human-readable attachment size. flag-don't-fake: a null/unknown size (the ingest
  // couldn't read body.size) returns '' so the render shows the filename WITHOUT a fabricated byte count,
  // never "0 B". Powers-of-1024, one decimal under 10 units for a readable KB/MB.
  function fmtBytes(n) {
    if (typeof n !== "number" || !isFinite(n) || n < 0) return "";
    if (n < 1024) return n + " B";
    var kb = n / 1024;
    if (kb < 1024) return (kb < 10 ? kb.toFixed(1) : String(Math.round(kb))) + " KB";
    var mb = kb / 1024;
    if (mb < 1024) return (mb < 10 ? mb.toFixed(1) : String(Math.round(mb))) + " MB";
    var gb = mb / 1024;
    return (gb < 10 ? gb.toFixed(1) : String(Math.round(gb))) + " GB";
  }

  // email-app #9 — the meta line beside an attachment's filename: a short type hint + the size, joined
  // only with what is actually known (honest: an unknown size drops out, an empty mimeType drops out —
  // never "· " with nothing after it). e.g. "PDF · 20.0 KB", or just "20.0 KB", or "" when neither is known.
  function attachmentMeta(a) {
    var parts = [];
    var mt = (a && typeof a.mimeType === "string") ? a.mimeType : "";
    var sub = mt.indexOf("/") !== -1 ? mt.slice(mt.indexOf("/") + 1) : mt;   // "application/pdf" -> "pdf"
    if (sub) parts.push(sub.toUpperCase());
    var sz = fmtBytes(a && a.size);
    if (sz) parts.push(sz);
    return parts.join(" \u00B7 ");
  }

  // E3 (the Weave) — dispatch the cross-app "Add to calendar" intent UP to the shell host
  // (forest:add-to-calendar { title, notes }, bubbles). The host navigates to Calendar and
  // opens the create form prefilled; mail carries ONLY the title + notes (TC-1: no calendar
  // logic here) and NO date (operator decision A: never fabricate the event time — the user
  // picks it). Cross-env CustomEvent (mirrors contacts-renderer's emitCompose / badges.js);
  // cold-safe: falsy seed / node -> no-op, never a render throw.
  function emitAddToCalendar(node, seed) {
    if (!node || !seed || (!seed.title && !seed.notes)) return;
    try {
      var doc = node.ownerDocument;
      var view = doc && doc.defaultView;
      var detail = { title: seed.title || "", notes: seed.notes || "" };
      var ev = (view && typeof view.CustomEvent === "function")
        ? new view.CustomEvent("forest:add-to-calendar", { detail: detail, bubbles: true })
        : { type: "forest:add-to-calendar", detail: detail, bubbles: true };
      if (typeof node.dispatchEvent === "function") node.dispatchEvent(ev);
    } catch (e) { /* cold-safe: the gesture is best-effort, never a render throw */ }
  }

  // Build the { title, notes } seed for "Add to calendar" from an open message — NO date
  // (option A). title = subject; notes = a provenance line (From · date) plus a plain-text
  // reduction of the body (tags stripped, a few entities decoded, whitespace collapsed,
  // length-capped) — a display-string reduction in the same class as legibleBody's text
  // handling (TC-1), never a fabrication: an empty body yields just the provenance line.
  function mailToCalendarSeed(m) {
    m = m || {};
    var title = m.subject || "(no subject)";
    var prov = [];
    if (m.from) prov.push("From: " + m.from);
    if (m.date) prov.push(m.date);
    var body = String(m.body == null ? "" : m.body)
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
      .replace(/\s+/g, " ").trim();
    if (body.length > 2000) body = body.slice(0, 2000) + "\u2026";
    var notes = prov.join(" \u00b7 ");
    if (body) notes = notes ? (notes + "\n\n" + body) : body;
    return { title: title, notes: notes };
  }

  function detailView(doc, m, onBack, onReply, manage, onForward, onReplyAll) {
    // : an opened message is a `record` in the Block Alphabet — the reading pane
    // wears the shared record skin (block.css), not a bespoke mail detail sheet. mail-*
    // classes ride along as behavior/test hooks (mail-detail__manage-btn is queried by
    // mail-manage.test.js — it MUST stay a co-class).
    var d = el(doc, "div", "mail-detail record");
    var back = el(doc, "div", "mail-detail__back record__back", { role: "button", tabindex: "0", text: "\u2190 Inbox" });
    activate(back, onBack);
    d.appendChild(back);
    // subject is the record title (JT-4: block.css clamps a 4000-char subject to a
    // readable height + wraps, never a horizontal blowout); from · date is the meta line.
    var subj = m.subject || "(no subject)";
    d.appendChild(el(doc, "h3", "mail-detail__subject record__title", { text: subj, title: subj }));
    var head = el(doc, "div", "mail-detail__head record__meta");
    head.appendChild(el(doc, "span", "mail-detail__from", { text: m.from || "(unknown sender)" }));
    if (m.date) head.appendChild(el(doc, "span", "mail-detail__date", { text: m.date }));
    d.appendChild(head);
    d.appendChild(legibleBody(doc, m.body));
    // email-app #9 — the attachment surface (READ + DOWNLOAD). If the message carries downloadable
    // attachments (the model's m.attachments, [] when none — flag-don't-fake), list them below the body:
    // filename + a short type/size meta. Both halves are LIVE: the SEE-what's-attached list, and — for a
    // gmail-sourced message with a known id + attachmentId — a live <a download> per item hitting the
    // runtime GET /mail/attachment route (built; feeds messages.attachments.get), wired below. An mbox
    // record or a record missing the handle stays a read-only span (flag-don't-fake: no dead control).
    if (Array.isArray(m.attachments) && m.attachments.length) {
      var att = el(doc, "div", "mail-attachments record__attachments");
      var n = m.attachments.length;
      att.appendChild(el(doc, "div", "mail-attachments__head", {
        text: "\uD83D\uDCCE " + n + (n === 1 ? " attachment" : " attachments")
      }));
      // email-app #9 (download) — an attachment is DOWNLOADABLE when it is gmail-sourced (the byte route is
      // messages.attachments.get, gmail-only), the message id is known, and the record carries an
      // attachmentId. Then the filename is a live <a download> hitting GET /mail/attachment (a plain browser
      // GET — the HttpOnly session cookie authenticates it, no JS/closure/cross-line wire needed). Otherwise
      // (an mbox-archived message, or a record missing the handle) the filename is a read-only span — the
      // list still SHOWS what's attached, it just can't fetch it (flag-don't-fake: no dead download control).
      var canDownload = (m.source === "gmail" && m.id);
      var list = el(doc, "ul", "mail-attachments__list", { role: "list" });
      for (var ai = 0; ai < m.attachments.length; ai++) {
        var a = m.attachments[ai];
        var li = el(doc, "li", "mail-attachments__item");
        if (canDownload && a.attachmentId) {
          var href = "/mail/attachment?messageId=" + encodeURIComponent(m.id)
            + "&attachmentId=" + encodeURIComponent(a.attachmentId)
            + "&filename=" + encodeURIComponent(a.filename)
            + (a.mimeType ? "&mimeType=" + encodeURIComponent(a.mimeType) : "");
          li.appendChild(el(doc, "a", "mail-attachments__name mail-attachments__download", {
            href: href, download: a.filename, text: a.filename, title: "Download " + a.filename,
            rel: "noopener"
          }));
        } else {
          li.appendChild(el(doc, "span", "mail-attachments__name", { text: a.filename, title: a.filename }));
        }
        var meta = attachmentMeta(a);
        if (meta) li.appendChild(el(doc, "span", "mail-attachments__meta", { text: meta }));
        list.appendChild(li);
      }
      att.appendChild(list);
      d.appendChild(att);
    }
    // one calm command row (record__actions) holds reply + the manage moves; the live
    // status result sits at its end (record__status). Few, wide, calm — not a toolbar.
    var actions = el(doc, "div", "record__actions");
    var hasAction = false;
    if (typeof onReply === "function") {
      var reply = el(doc, "div", "mail-detail__reply record__action", { role: "button", tabindex: "0", text: "Reply", "aria-label": "Reply to this message" });
      activate(reply, function () { onReply(m); });
      actions.appendChild(reply);
      hasAction = true;
    }
    // email-app #14b (reply-all) — Reply all sits between Reply and Forward on the same calm
    // command row. It opens compose prefilled from replyAllRecipients(m, self): To = the
    // original sender, Cc = everyone else on the original To+Cc minus self. Client-only, like
    // reply/forward — composing is free; the Warrant gate applies at Send. Backward-compatible:
    // a 6-arg detailView call (no onReplyAll) renders no Reply-all button, so nothing regresses.
    if (typeof onReplyAll === "function") {
      var replyAll = el(doc, "div", "mail-detail__reply-all record__action", { role: "button", tabindex: "0", text: "Reply all", "aria-label": "Reply to all recipients" });
      activate(replyAll, function () { onReplyAll(m); });
      actions.appendChild(replyAll);
      hasAction = true;
    }
    // email-app #14 (forward half) — Forward sits beside Reply on the same calm command row.
    // It opens compose prefilled with the quoted forwarded block (forwardBody) and an EMPTY
    // To (the user names the recipient — unlike reply, which pre-fills the original sender).
    // Client-only: no gmail grant needed to OPEN the forward (composing is free; the Warrant
    // gate applies at Send, exactly as it does for reply and new-message). Works on any open
    // message, gmail- or mbox-sourced, since forwardBody uses only carried fields.
    if (typeof onForward === "function") {
      var fwd = el(doc, "div", "mail-detail__forward record__action", { role: "button", tabindex: "0", text: "Forward", "aria-label": "Forward this message" });
      activate(fwd, function () { onForward(m); });
      actions.appendChild(fwd);
      hasAction = true;
    }
    // E3 (the Weave) — "Add to calendar" sits on the same calm command row, beside Forward.
    // It dispatches forest:add-to-calendar { title, notes } UP to the shell host (mirrors E1's
    // contacts forest:compose), which opens the Calendar create form PREFILLED. Client-only:
    // composing an event is FREE (no grant / warrant — the gate is at the calendar WRITE,
    // exactly as reply/forward composing is free). NO date is carried (option A: the user picks
    // the time). Works on ANY open message (gmail- or mbox-sourced) — mailToCalendarSeed uses
    // only carried fields, like forwardBody.
    var addCal = el(doc, "div", "mail-detail__add-to-calendar record__action", { role: "button", tabindex: "0", text: "Add to calendar", "aria-label": "Add this message to the calendar" });
    activate(addCal, function () { emitAddToCalendar(addCal, mailToCalendarSeed(m)); });
    actions.appendChild(addCal);
    hasAction = true;
    // leg 16 (#13) — read-later: a LOCAL toggle, deliberately OUTSIDE the gmail manage gate
    // below (no grant, no source check) so you can flag ANY open message to come back to,
    // even an mbox-archived one. Reversible; the button reads the current local state and
    // offers the definite reverse verb, the leg-12 discipline applied to a local flag.
    var rlCtl = readLaterFrom(manage);
    if (rlCtl && m.id) {
      var rlStatus = el(doc, "div", "mail-detail__readlater-status record__status", { role: "status", "aria-live": "polite" });
      var rlBtn = el(doc, "div", "mail-detail__readlater record__action record__action--quiet", { role: "button", tabindex: "0" });
      function paintRl() {
        var on = rlCtl.has(m.id);
        rlBtn.textContent = on ? "Remove from read-later" : "Read later";
        rlBtn.setAttribute("aria-label", on ? "Remove this message from read-later" : "Save this message to read later");
      }
      activate(rlBtn, function () {
        var nowOn = rlCtl.toggle(m.id);
        paintRl();
        rlStatus.textContent = nowOn ? "Saved to read-later \u2713" : "Removed from read-later \u2713";
      });
      paintRl();
      actions.appendChild(rlBtn);
      actions.appendChild(rlStatus);
      hasAction = true;
    }
    // email-app #11 — unsubscribe surfacing (READ-ONLY, Card B1): if the message carries a sender-
    // published List-Unsubscribe header, surface the link the sender offered. The app does NOT
    // unsubscribe FOR the user (one-click B2 is a future send-scope escalation, an operator gate) —
    // it shows the link, the user clicks it. INDEPENDENT of the gmail manage gate (display, not
    // modify — like read-later), so it works on any message carrying the header, incl. mbox-archived.
    // Card C: prefer the https link (one tap), mailto fallback. Zero new CSS (record__action--quiet).
    var unsub = parseUnsubscribe(m.unsubscribe);
    var unsubUri = unsub.https || unsub.mailto;
    if (unsubUri) {
      var unsubLink = el(doc, "a", "mail-detail__unsubscribe record__action record__action--quiet", {
        href: unsubUri, text: "Unsubscribe",
        "aria-label": "Unsubscribe from this sender \u2014 opens the link the sender published",
        rel: "noopener noreferrer nofollow", target: "_blank"
      });
      actions.appendChild(unsubLink);
      hasAction = true;
    }
    // email-app #11 B2 — ONE-CLICK unsubscribe (RFC 8058): when the sender advertised one-click AND we
    // have an https target AND a caller is wired, add a one-click BUTTON beside the read-only link. It
    // does the unsubscribe FOR the user server-side (SSRF-safe: the runtime reads the URL from Soil, not
    // the client). Confirm friction (like send): first tap confirms, second tap calls. The read-only
    // link STAYS as the always-safe fallback — a failure leaves it visible, never a fabricated success.
    var unsubFn = manage && typeof manage.unsubscribeFn === "function" ? manage.unsubscribeFn : null;
    if (m.unsubscribeOneClick && unsub.https && unsubFn && m.id) {
      var oneClickStatus = el(doc, "div", "mail-detail__unsubscribe-status record__status", { role: "status", "aria-live": "polite" });
      var senderLabel = m.from || "this sender";
      var ocBtn = el(doc, "div", "mail-detail__unsubscribe-oneclick record__action", {
        role: "button", tabindex: "0", text: "Unsubscribe (1-click)",
        "aria-label": "Unsubscribe from " + senderLabel + " in one click"
      });
      var armed = false;
      activate(ocBtn, function () {
        if (ocBtn.getAttribute("data-busy") === "1" || ocBtn.getAttribute("data-done") === "1") return;
        if (!armed) {   // first tap — confirm
          armed = true;
          ocBtn.textContent = "Confirm unsubscribe?";
          oneClickStatus.textContent = "Tap again to unsubscribe from " + senderLabel + ".";
          return;
        }
        // second tap — call
        ocBtn.setAttribute("data-busy", "1");
        ocBtn.textContent = "Unsubscribing\u2026";
        oneClickStatus.textContent = "";
        unsubFn({ itemId: m.id, source: m.source || null, account: m.account || null }).then(function (res) {
          ocBtn.removeAttribute("data-busy");
          if (res && res.ok) {
            ocBtn.setAttribute("data-done", "1");
            ocBtn.textContent = "Unsubscribed \u2713";
            oneClickStatus.textContent = "Unsubscribed from " + senderLabel + ".";
          } else {
            // honest failure — re-arm, keep the read-only link the way out
            armed = false;
            ocBtn.textContent = "Unsubscribe (1-click)";
            oneClickStatus.textContent = (res && res.error) || "Couldn\u2019t complete it \u2014 use the link instead \u2197";
          }
        });
      });
      actions.appendChild(ocBtn);
      actions.appendChild(oneClickStatus);
      hasAction = true;
    }
    // leg 7 — the manage moves: only for a gmail-sourced message with a live modify grant. An mbox-archived
    // message (source !== 'gmail') carries an itemId Gmail wouldn't recognize, so managing it is honestly
    // out of scope — no buttons rather than a button that would fail at the API.
    if (manage && typeof manage.modifyFn === "function" && manage.canManage && m.source === "gmail" && m.id) {
      // the actions row IS the manage bar when manage is live — keep the semantic hook
      // (mail-manage.test.js queries `.mail-detail__manage`) on the same element.
      actions.className = actions.className + " mail-detail__manage";
      var status = el(doc, "div", "mail-detail__manage-status record__status", { role: "status", "aria-live": "polite" });
      function runAction(btn, action, pending, done, extra) {
        if (btn.getAttribute("data-busy") === "1") return;
        btn.setAttribute("data-busy", "1");
        status.textContent = pending;
        // leg 13 — for action:'label' the picker passes the definite {addLabelIds}|{removeLabelIds}
        // through `extra`; canned toggles (archive/star/...) pass none. Merge, don't overwrite the base.
        var payload = { itemId: m.id, action: action, account: m.account || manage.account || null };
        if (extra) { for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) payload[k] = extra[k]; } }
        manage.modifyFn(payload).then(function (res) {
          btn.removeAttribute("data-busy");
          status.textContent = (res && res.ok) ? done : ((res && res.error) || "couldn\u2019t make that change");
          if (res && res.ok) {
            // #26 fix — reflect the CONFIRMED label change in m.labels so the LABEL filter
            // (filterMailbox) + the toggle-state read (hasLabel) see it at once — same stale-local-labels
            // bug the bulk path had. Idempotent; only inside res.ok, so it never invents unconfirmed state.
            if (!Array.isArray(m.labels)) m.labels = [];
            // #24 follow-on DRY: the label-set logic lives ONCE in the model (canonical non-mutating
            // addLbl/rmLbl). Delegate to it and reassign m.labels — the same move #2 made for the bulk
            // path, now applied to this single-message pair (the #26 residual). Consistent with hasLbl
            // below, which already reads through the model. Cold-safe: an older model without the
            // helpers falls back to the inline mutation (no behavior change).
            var _add = function (id) {
              if (id == null) return;
              if (model && typeof model.addLbl === "function") { m.labels = model.addLbl(m.labels, id); return; }
              if (m.labels.indexOf(id) === -1) m.labels.push(id);
            };
            var _rm = function (id) {
              if (model && typeof model.rmLbl === "function") { m.labels = model.rmLbl(m.labels, id); return; }
              var i = m.labels.indexOf(id); if (i !== -1) m.labels.splice(i, 1);
            };
            if (action === "star") _add("STARRED");
            else if (action === "unstar") _rm("STARRED");
            else if (action === "important") _add("IMPORTANT");
            else if (action === "unimportant") _rm("IMPORTANT");
            else if (action === "label") { (payload.addLabelIds || []).forEach(_add); (payload.removeLabelIds || []).forEach(_rm); }
          }
          // leg 7.1 + leg 14 + #29 — a SUCCESSFUL archive, report-spam, OR trash is a -INBOX label move;
          // drop the row from the inbox projection and re-count. Display-refresh only (the write-back
          // already took in Gmail); a denied move (res.ok false) leaves the list untouched. notspam /
          // unarchive / untrash re-ADD INBOX and are clicked from other views, so they don't drop.
          if (res && res.ok && (action === "archive" || action === "spam" || action === "trash") && typeof manage.onArchived === "function") {
            manage.onArchived(m);
          }
        });
      }
      var archiveBtn = el(doc, "div", "mail-detail__manage-btn record__action record__action--quiet", { role: "button", tabindex: "0", text: "Archive", "aria-label": "Archive this message" });
      activate(archiveBtn, function () { runAction(archiveBtn, "archive", "Archiving\u2026", "Archived \u2713"); });
      actions.appendChild(archiveBtn);
      var unreadBtn = el(doc, "div", "mail-detail__manage-btn record__action record__action--quiet", { role: "button", tabindex: "0", text: "Mark as unread", "aria-label": "Mark this message as unread" });
      activate(unreadBtn, function () { runAction(unreadBtn, "unread", "Marking unread\u2026", "Marked as unread \u2713"); });
      actions.appendChild(unreadBtn);
      // leg 12 — star + mark-important: two REVERSIBLE label toggles over Gmail system labels. The
      // button reads the message's CURRENT label state (mailModel.hasLabel) and offers the opposite
      // move, so the verb sent is always definite (starred -> 'unstar', else -> 'star'); no client-side
      // guessing, and a message with unknown label state (mbox: labels []) truthfully reads "not set".
      var model = mm();
      var hasLbl = function (id) { return model ? model.hasLabel(m, id) : (m.labels || []).indexOf(id) !== -1; };
      var starred = hasLbl("STARRED");
      var starBtn = el(doc, "div", "mail-detail__manage-btn record__action record__action--quiet", { role: "button", tabindex: "0", text: starred ? "Unstar" : "Star", "aria-label": starred ? "Remove the star from this message" : "Star this message" });
      activate(starBtn, function () {
        starred ? runAction(starBtn, "unstar", "Removing star\u2026", "Unstarred \u2713")
                : runAction(starBtn, "star", "Starring\u2026", "Starred \u2713");
      });
      actions.appendChild(starBtn);
      var important = hasLbl("IMPORTANT");
      var importantBtn = el(doc, "div", "mail-detail__manage-btn record__action record__action--quiet", { role: "button", tabindex: "0", text: important ? "Mark not important" : "Mark important", "aria-label": important ? "Mark this message not important" : "Mark this message important" });
      activate(importantBtn, function () {
        important ? runAction(importantBtn, "unimportant", "Updating\u2026", "Marked not important \u2713")
                  : runAction(importantBtn, "important", "Updating\u2026", "Marked important \u2713");
      });
      actions.appendChild(importantBtn);
      // leg 14 — report-spam: a REVERSIBLE toggle over the SPAM system label, same definite-verb
      // discipline as star/important. A message already in spam offers "Not spam" (restore to inbox);
      // otherwise "Report spam" (-> SPAM, out of INBOX). A successful report drops the row from the
      // inbox list via onArchived (the -INBOX effect), like archive.
      var isSpam = hasLbl("SPAM");
      var spamBtn = el(doc, "div", "mail-detail__manage-btn record__action record__action--quiet", { role: "button", tabindex: "0", text: isSpam ? "Not spam" : "Report spam", "aria-label": isSpam ? "Mark this message as not spam and return it to the inbox" : "Report this message as spam" });
      activate(spamBtn, function () {
        isSpam ? runAction(spamBtn, "notspam", "Restoring\u2026", "Marked not spam \u2713")
               : runAction(spamBtn, "spam", "Reporting spam\u2026", "Reported as spam \u2713");
      });
      actions.appendChild(spamBtn);
      // #29 — trash: the operator + charter K1 reversal (, pick C), in its REVERSIBLE form only.
      // Same definite-verb discipline as spam/star: a message already in Trash offers "Restore" (untrash
      // -> back to INBOX); otherwise "Trash" (-> TRASH, out of INBOX). A successful trash drops the row
      // from the inbox list via onArchived (the -INBOX effect), exactly like archive/spam. There is NO
      // permanent-delete button anywhere — the runtime wires no messages.delete verb, so the UI cannot
      // offer one; trashed mail is recoverable (untrash here, or Gmail's own 30-day window).
      var isTrash = hasLbl("TRASH");
      var trashBtn = el(doc, "div", "mail-detail__manage-btn record__action record__action--quiet", { role: "button", tabindex: "0", text: isTrash ? "Restore" : "Trash", "aria-label": isTrash ? "Restore this message from the Trash back to the inbox" : "Move this message to the Trash (recoverable)" });
      activate(trashBtn, function () {
        isTrash ? runAction(trashBtn, "untrash", "Restoring\u2026", "Restored \u2713")
                : runAction(trashBtn, "trash", "Moving to Trash\u2026", "Moved to Trash \u2713");
      });
      actions.appendChild(trashBtn);
      // leg 13 — move-to-label: an expander over the mailbox's MOVABLE labels (host-filtered via
      // movableLabels). Each label is a REVERSIBLE toggle over the SAME /intent/modify seam
      // (action:'label' + add/removeLabelIds — server already built): the button reads the message's
      // current membership (mailModel.hasLabel) and offers the DEFINITE reverse verb, so the client
      // never guesses "am I adding or removing?" (the leg-12 discipline, generalized off the two
      // system labels onto the user's own). Label-only + reversible -> still no delete path, K1 by
      // construction. Behind an expander so the calm command row stays calm; absent/empty labels ->
      // no button at all (honest: nothing to move to), so the leg-7/12 bar is unchanged when unwired.
      var labels = Array.isArray(manage.labels) ? manage.labels : [];
      // #06 picker-paint: the "Labels\u2026" expander opens when there are movable labels to toggle OR
      // a create capability is wired (labelFn) — so a mailbox with zero user labels can still make its
      // first one. Absent both, no expander (leg-13 behavior unchanged when unwired).
      var canLabelCrud = !!(manage && typeof manage.labelFn === "function");
      if (labels.length > 0 || canLabelCrud) {
        var picker = el(doc, "div", "mail-detail__label-picker");
        labels.forEach(function (lbl) {
          var id = (typeof lbl === "string") ? lbl : (lbl && lbl.id);
          if (!id) return;
          // #06 picker-paint: render the human NAME (from the registry merge — knownLabels) but operate
          // on the id. A bare-id element (no registry record arrived yet) shows its id, exactly as before.
          var labelName = (typeof lbl === "string") ? lbl : ((lbl && typeof lbl.name === "string" && lbl.name) ? lbl.name : id);
          var on = hasLbl(id);
          var lb = el(doc, "div", "mail-detail__label-btn record__action record__action--quiet", {
            role: "button", tabindex: "0",
            text: (on ? "Remove from " : "Add to ") + labelName,
            "aria-label": (on ? "Remove this message from the label " : "Add this message to the label ") + labelName
          });
          activate(lb, function () {
            on ? runAction(lb, "label", "Updating\u2026", "Removed from " + labelName + " \u2713", { removeLabelIds: [id] })
               : runAction(lb, "label", "Updating\u2026", "Added to " + labelName + " \u2713", { addLabelIds: [id] });
          });
          picker.appendChild(lb);
          // #06 picker-paint (email-deepen) — rename/recolor THIS movable (user) label via op:'patch'.
          // A "Rename" control reveals an inline name (prefilled with the id) + optional color; Save calls
          // labelFn({op:'patch', id, name?, color?, account}) — only the changed fields ride. Present only
          // when labelFn is wired. movableLabels already filtered out system labels at manage construction,
          // so this stays user-label-only. K1: patch only, still no delete path.
          if (canLabelCrud) {
            var rnBtn = el(doc, "div", "mail-detail__label-rename record__action record__action--quiet", {
              role: "button", tabindex: "0", text: "Rename " + labelName,
              "aria-label": "Rename or recolor the label " + labelName, "aria-expanded": "false"
            });
            var rnForm = el(doc, "div", "mail-detail__label-rename-form");
            var rnName = el(doc, "input", "mail-detail__label-rename-name field__control", { type: "text", "aria-label": "New name for " + labelName });
            rnName.value = labelName;   // prefill via the .value property (the composeView idiom), not the attribute
            var rnColor = el(doc, "input", "mail-detail__label-rename-color field__control", { type: "text", placeholder: "#hex (optional)", "aria-label": "New color for " + id });
            var rnStatus = el(doc, "span", "mail-detail__label-status record__meta");
            var rnSave = el(doc, "div", "mail-detail__label-rename-save record__action record__action--quiet", { role: "button", tabindex: "0", text: "Save", "aria-label": "Save the label change" });
            activate(rnSave, function () {
              if (rnSave.getAttribute("data-busy") === "1") return;
              var nm = String(rnName.value == null ? "" : rnName.value).trim();
              var col = String(rnColor.value == null ? "" : rnColor.value).trim();
              var pl = { op: "patch", id: id, account: manage.account || null };
              if (nm && nm !== labelName) pl.name = nm;
              if (col) pl.color = col;
              if (pl.name === undefined && pl.color === undefined) { rnStatus.textContent = "no change"; return; }
              rnSave.setAttribute("data-busy", "1");
              rnStatus.textContent = "Saving\u2026";
              manage.labelFn(pl).then(function (res) {
                rnSave.removeAttribute("data-busy");
                rnStatus.textContent = (res && res.ok) ? "Saved \u2713" : ((res && res.error) || "couldn\u2019t save that change");
              });
            });
            activate(rnBtn, function () {
              if (rnForm.parentNode) { rnForm.parentNode.removeChild(rnForm); rnBtn.setAttribute("aria-expanded", "false"); }
              else { picker.appendChild(rnForm); rnBtn.setAttribute("aria-expanded", "true"); }
            });
            rnForm.appendChild(rnName); rnForm.appendChild(rnColor); rnForm.appendChild(rnSave); rnForm.appendChild(rnStatus);
            picker.appendChild(rnBtn);
          }
        });
        // #06 picker-paint (email-deepen) — the CREATE affordance. Present only when labelFn is wired.
        // Name (required) + optional color; Create calls labelFn({op:'create', name, color?, account}).
        // Feedback rides an inline status span (mirrors runAction's pending/done/error idiom). The
        // builder (mail-label-crud buildCreate) validates name/color, so a bad spec surfaces its real
        // reason here rather than being pre-guessed. K1: create only, no delete path.
        if (canLabelCrud) {
          var mk = el(doc, "div", "mail-detail__label-new");
          var mkName = el(doc, "input", "mail-detail__label-name field__control", {
            type: "text", placeholder: "New label name", "aria-label": "New label name"
          });
          var mkColor = el(doc, "input", "mail-detail__label-color field__control", {
            type: "text", placeholder: "#hex (optional)", "aria-label": "New label color (optional hex)"
          });
          var mkStatus = el(doc, "span", "mail-detail__label-status record__meta");
          var mkBtn = el(doc, "div", "mail-detail__label-create record__action record__action--quiet", {
            role: "button", tabindex: "0", text: "Create label", "aria-label": "Create a new label"
          });
          activate(mkBtn, function () {
            if (mkBtn.getAttribute("data-busy") === "1") return;
            var name = String(mkName.value == null ? "" : mkName.value).trim();
            if (!name) { mkStatus.textContent = "name required"; return; }
            var payload = { op: "create", name: name, account: manage.account || null };
            var color = String(mkColor.value == null ? "" : mkColor.value).trim();
            if (color) payload.color = color;
            mkBtn.setAttribute("data-busy", "1");
            mkStatus.textContent = "Creating\u2026";
            manage.labelFn(payload).then(function (res) {
              mkBtn.removeAttribute("data-busy");
              if (res && res.ok) { mkStatus.textContent = "Created \u2713"; mkName.value = ""; mkColor.value = ""; }
              else { mkStatus.textContent = (res && res.error) || "couldn\u2019t create that label"; }
            });
          });
          mk.appendChild(mkName); mk.appendChild(mkColor); mk.appendChild(mkBtn); mk.appendChild(mkStatus);
          picker.appendChild(mk);
        }
        var labelsBtn = el(doc, "div", "mail-detail__labels-btn record__action record__action--quiet", {
          role: "button", tabindex: "0", text: "Labels\u2026",
          "aria-label": "Add or remove labels", "aria-expanded": "false"
        });
        activate(labelsBtn, function () {
          if (picker.parentNode) {
            picker.parentNode.removeChild(picker);
            labelsBtn.setAttribute("aria-expanded", "false");
          } else {
            d.appendChild(picker);             // the picker sits BELOW the command row, not inside it
            labelsBtn.setAttribute("aria-expanded", "true");
          }
        });
        actions.appendChild(labelsBtn);
      }
      actions.appendChild(status);
      hasAction = true;
    }
    if (hasAction) d.appendChild(actions);
    return d;
  }

  /* ---- one message row (from · subject · date · snippet) -------------------- *
   * When onOpen is given (leg 5), the row is a button: role/tabindex + click and   *
   * Enter/Space open the reading pane. Absent onOpen it degrades to a plain row.   */
  function snippet(body) {
    var s = String(body == null ? "" : body).replace(/\s+/g, " ").trim();
    return s.length > 140 ? s.slice(0, 139).replace(/\s+\S*$/, "").trim() + "\u2026" : s;
  }
  // email-app #11 — parse an RFC 2369 List-Unsubscribe value into its URIs. The value is a comma-
  // separated list of angle-bracketed URIs, e.g. "<mailto:u@x?subject=off>, <https://x/u?id=1>".
  // Returns { https, mailto, all[] }. Card C: the render prefers https (one tap, no mail-client
  // dependency); mailto is the fallback. Read-only — the app surfaces the sender's link, never acts.
  function parseUnsubscribe(raw) {
    var out = { https: "", mailto: "", all: [] };
    if (!raw) return out;
    String(raw).split(",").forEach(function (part) {
      var u = part.trim().replace(/^<+/, "").replace(/>+$/, "").trim();
      if (!u) return;
      out.all.push(u);
      if (!out.https && /^https:\/\//i.test(u)) out.https = u;
      if (!out.mailto && /^mailto:/i.test(u)) out.mailto = u;
    });
    return out;
  }

  /* ---- clustering views (email-app #2/#3/#4 — "By date · By sender · By category") ----------- *
   * A PURE CLIENT-SIDE grouping fold over the mailbox already in hand: no Gmail scope, no model   *
   * change (so mail-model parity holds by CONSTRUCTION — the leg-16 read-later discipline), no    *
   * new block (sections render through the existing `row` grammar). One key function per view;    *
   * paint() folds the already-filtered+sorted list into ordered sections. View-words operator-    *
   * ratified (internal). Undated / senderless / *
   * uncategorized never fabricate a bucket — they sink to a last group (flag-don't-fake, mirroring *
   * sortMailbox's undated-last rule). The order WITHIN each group is the incoming sort order.     */

  // #3 — By date: Today / Yesterday / This week / Older, Undated last (never a fabricated time).
  // `now` is injected (opts.now in paint; the exported fold takes it) so the buckets are testable.
  function dateBucketKey(m, now) {
    if (!m || m._when == null) return "undated";
    var startOf = function (t) { var x = new Date(t); return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    var day = 86400000, today = startOf(now), msgDay = startOf(m._when);
    if (msgDay === today) return "today";
    if (msgDay === today - day) return "yesterday";
    if (msgDay > today - 7 * day) return "week";   // last 7 days (today/yesterday already caught above)
    return "older";
  }
  var DATE_BUCKETS = [["today", "Today"], ["yesterday", "Yesterday"], ["week", "This week"], ["older", "Older"], ["undated", "Undated"]];

  // #2 — By category: read the ingested Gmail CATEGORY_* labels (readonly, already in hand — no new
  // scope). No category label -> Primary (Gmail's default). Fixed Gmail order.
  function categoryKey(m) {
    var labels = (m && m.labels) || [];
    if (labels.indexOf("CATEGORY_SOCIAL") !== -1) return "social";
    if (labels.indexOf("CATEGORY_PROMOTIONS") !== -1) return "promotions";
    if (labels.indexOf("CATEGORY_UPDATES") !== -1) return "updates";
    if (labels.indexOf("CATEGORY_FORUMS") !== -1) return "forums";
    return "primary";   // CATEGORY_PERSONAL or none -> Primary
  }
  var CATEGORY_BUCKETS = [["primary", "Primary"], ["social", "Social"], ["promotions", "Promotions"], ["updates", "Updates"], ["forums", "Forums"]];

  function _groupFixed(shown, keyOf, order) {
    var bins = {};
    shown.forEach(function (m) { var k = keyOf(m); (bins[k] = bins[k] || []).push(m); });
    var out = [];
    order.forEach(function (pair) { if (bins[pair[0]] && bins[pair[0]].length) out.push([pair[1], bins[pair[0]]]); });
    return out;
  }
  // #4 — By sender: group by the From line, alphabetical; senderless -> a last "(unknown sender)" group.
  function _groupSender(shown) {
    var bins = {}, keys = [], senderless = [];
    shown.forEach(function (m) {
      var f = (m && m.from ? String(m.from) : "").trim();
      if (f === "") { senderless.push(m); return; }
      if (!bins[f]) { bins[f] = []; keys.push(f); }
      bins[f].push(m);
    });
    keys.sort(function (a, b) { var la = a.toLowerCase(), lb = b.toLowerCase(); return la < lb ? -1 : la > lb ? 1 : 0; });
    var out = keys.map(function (k) { return [k, bins[k]]; });
    if (senderless.length) out.push(["(unknown sender)", senderless]);   // senderless last
    return out;
  }
  // groupMailbox(shown, view, now) -> [[label, [messages...]], ...] in display order. Pure fold;
  // preserves incoming order within each group. Unknown view -> one unlabeled group (== flat).
  function groupMailbox(shown, view, now) {
    shown = shown || [];
    if (view === "date") return _groupFixed(shown, function (m) { return dateBucketKey(m, now); }, DATE_BUCKETS);
    if (view === "category") return _groupFixed(shown, categoryKey, CATEGORY_BUCKETS);
    if (view === "sender") return _groupSender(shown);
    return [["", shown]];
  }

  function messageRow(doc, m, onOpen, extraCls, select, rowActions, snoozeCtl, declineCtl, screenCtl) {
    // #23 — `select` (optional) is the bulk-selection controller { enabled, has, toggle }.
    // When present + enabled AND the row is a gmail message with an id, the row grows a
    // leading checkbox (a role=checkbox affordance, shim-friendly like the rest of this
    // file). Undefined/absent select -> byte-identical to every prior caller (no checkbox),
    // so the flat / grouped / thread rows and the whole-corpus search rows are unchanged.
    // Only gmail+id rows are selectable because the batch primitive is gmail-only (an mbox
    // row can't be Gmail-batch-modified — flag-don't-fake, the same gate the single manage
    // bar uses at line ~363).
    // ①b — `rowActions` (optional) is the row-affordance controller
    //   { canManage, modifyFn, account, model, onArchived }.
    // Present -> the row grows a leading MONOGRAM (sender initial, pure visual, honest for
    // any source). Present AND canManage AND gmail+id -> a trailing `.row__actions` group
    // (star · important · archive), hover/focus-revealed, each firing the SAME existing
    // makeModifyFn verb the detail manage bar uses (star/unstar/important/unimportant/archive)
    // — a promotion of built actions onto the row, never a new backend (JT-7). Undefined/absent
    // rowActions -> byte-identical to every prior caller (no monogram, no actions), so the
    // existing tests and non-list callers are unchanged.
    // : a message row is a `row` in the Block Alphabet — mail wears the shared
    // block skin (block.css), it is not hand-styled. The mail-* classes ride along as
    // semantic / behavior hooks (tests + reach code query them); the alphabet classes
    // carry the skin, so calendar/contacts get the same row free (zero marginal CSS).
    // `.row--unread` binds ONLY to a KNOWN-unread message (m.unread === true) — an
    // unknowable read-state (null) is never dressed as unread (flag-don't-fake).
    // `extraCls` (leg 15) is an optional trailing class — the thread view passes
    // `row--thread-child` to indent a conversation's expanded members; zero effect
    // on every existing caller (undefined → no-op), so the flat/sectioned rows are byte-unchanged.
    var cls = "row mail-msg";
    if (m.unread === true) cls += " row--unread";
    if (extraCls) cls += " " + extraCls;
    var li = el(doc, "li", cls);
    if (typeof onOpen === "function") {
      li.setAttribute("role", "button");
      li.setAttribute("tabindex", "0");
      li.setAttribute("aria-label", "Open message: " + (m.subject || "(no subject)"));
      activate(li, function () { onOpen(m); });
    }
    var bodyCol = el(doc, "div", "row__body");
    // ①b — the MONOGRAM: a calm sender-initial avatar (pure visual, honest for any source —
    // it reads the From we already show, invents nothing). Leads the row like the checkbox.
    if (rowActions) {
      var fromStr = String(m.from || "");
      var mono = fromStr.replace(/^[^A-Za-z0-9]+/, "").charAt(0).toUpperCase() || "\u00b7";
      li.appendChild(el(doc, "span", "row__monogram", { "aria-hidden": "true", text: mono }));
    }
    // meta line: from · date, in the data face (the alphabet's secondary row line)
    var head = el(doc, "div", "row__meta mail-msg__head");
    head.appendChild(el(doc, "span", "mail-msg__from", { text: m.from || "(unknown sender)" }));
    if (m.date) head.appendChild(el(doc, "span", "mail-msg__date", { text: " \u00b7 " + m.date }));
    appendSourceChip(doc, head, m);   // #5 Two Rivers: SC-4 source chip (m.source, never From:); cold-safe -> legacy #25 F2 badge
    bodyCol.appendChild(head);
    // the subject is the row title — truncated with a hover reveal (JT-4: the title
    // attribute is the affordance; a 4000-char subject reads its start and reveals the rest).
    var subj = m.subject || "(no subject)";
    bodyCol.appendChild(el(doc, "div", "row__title mail-msg__subject", { text: subj, title: subj }));
    var snip = snippet(m.body);
    if (snip) bodyCol.appendChild(el(doc, "div", "row__snippet mail-msg__snippet", { text: snip }));
    // #23 — the leading selection checkbox (built BEFORE bodyCol is appended so it reads
    // as the row's lead). Its click/keydown STOP PROPAGATION so toggling selection never
    // also opens the message (the row's own activate() opens on click; activate does not
    // stop propagation, so the checkbox must, or a check would open the mail).
    if (select && select.enabled && m.source === "gmail" && m.id) {
      var on0 = select.has(m.id);
      var box = el(doc, "span", "row__lead mail-msg__check" + (on0 ? " is-checked" : ""), {
        role: "checkbox", tabindex: "0", "aria-checked": on0 ? "true" : "false",
        "aria-label": (on0 ? "Deselect" : "Select") + " message: " + (m.subject || "(no subject)")
      });
      var flip = function (ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        var now = select.toggle(m.id, m);
        box.className = "row__lead mail-msg__check" + (now ? " is-checked" : "");
        box.setAttribute("aria-checked", now ? "true" : "false");
        box.setAttribute("aria-label", (now ? "Deselect" : "Select") + " message: " + (m.subject || "(no subject)"));
      };
      box.addEventListener("click", flip);
      box.addEventListener("keydown", function (ev) {
        var key = ev && ev.key;
        if (key === "Enter" || key === " " || key === "Spacebar") { if (ev && typeof ev.preventDefault === "function") ev.preventDefault(); flip(ev); }
      });
      li.appendChild(box);
    }
    li.appendChild(bodyCol);
    // ①b — the trailing ROW ACTIONS: star · important · archive, hover/focus-revealed. Gated
    // exactly like the detail manage bar (a gmail message with an id + a live modify grant), so
    // an mbox row or a grant-less view grows NO actions — flag-don't-fake. Each button fires the
    // SAME existing makeModifyFn verb the manage bar sends (the definite verb, read from current
    // label state via the model — no client-side guessing), and on a CONFIRMED ok reflects the
    // label change into m.labels through the model's canonical addLbl/rmLbl (the #26 discipline),
    // so the STARRED/IMPORTANT filter + rail counts see it at once. Clicks stopPropagation so an
    // action never also opens the message. No new backend, no new scope — a promotion (JT-7).
    // ①b/①c — the trailing ROW ACTIONS. Two INDEPENDENT gates share one container:
    //   canModify (①b): star · important · archive — gmail + a live MODIFY grant.
    //   canFile   (①c): "Send to Forest" — OWNER-DATA (fileFn + a tree taxonomy), NO
    //                   grant, any source with an id. flag-don't-fake twice: no tree
    //                   list -> no picker (never invent a taxonomy), and no persistent
    //                   toggle (the mail row carries no Soil filed-state to read) —
    //                   filing is fire-and-confirm, not a faked file/un-file state.
    var canModify = rowActions && rowActions.canManage && typeof rowActions.modifyFn === "function" && m.source === "gmail" && m.id;
    var canFile = rowActions && typeof rowActions.fileFn === "function" && rowActions.trees && rowActions.trees.length && m.source && m.id;
    if (canModify || canFile) {
      var actions = el(doc, "div", "row__actions", { role: "group", "aria-label": "Message actions" });
      function mkBtn(cls, label, aria) {
        return el(doc, "span", "row__action " + cls, { role: "button", tabindex: "0", "aria-label": aria, text: label });
      }
      // bind click+keydown DIRECTLY (not via activate) so the handler receives the event and can
      // stopPropagation — an action must never also open the message (the row's own activate opens
      // on click and does not stop propagation, exactly like the #23 checkbox).
      function onAct(node, fn) {
        node.addEventListener("click", fn);
        node.addEventListener("keydown", function (ev) {
          var key = ev && ev.key;
          if (key === "Enter" || key === " " || key === "Spacebar") { if (ev && typeof ev.preventDefault === "function") ev.preventDefault(); fn(ev); }
        });
      }
      if (canModify) {
        var rmodel = rowActions.model || mm();
        var rowBusy = false;
        function hasLbl(id) { return rmodel && typeof rmodel.hasLabel === "function" ? rmodel.hasLabel(m, id) : (m.labels || []).indexOf(id) !== -1; }
        function reflect(action) {
          var add = function (id) { if (rmodel && typeof rmodel.addLbl === "function") m.labels = rmodel.addLbl(m.labels, id); else { if (!Array.isArray(m.labels)) m.labels = []; if (m.labels.indexOf(id) === -1) m.labels.push(id); } };
          var rm = function (id) { if (rmodel && typeof rmodel.rmLbl === "function") m.labels = rmodel.rmLbl(m.labels, id); else { if (Array.isArray(m.labels)) { var i = m.labels.indexOf(id); if (i !== -1) m.labels.splice(i, 1); } } };
          if (action === "star") add("STARRED"); else if (action === "unstar") rm("STARRED");
          else if (action === "important") add("IMPORTANT"); else if (action === "unimportant") rm("IMPORTANT");
        }
        function fire(action, btn, onOk) {
          if (rowBusy) return;
          rowBusy = true; btn.setAttribute("data-busy", "1");
          var payload = { itemId: m.id, action: action, account: m.account || rowActions.account || null };
          Promise.resolve(rowActions.modifyFn(payload)).then(function (res) {
            rowBusy = false; btn.removeAttribute("data-busy");
            if (res && res.ok) { reflect(action); if (typeof onOk === "function") onOk(); }
          }, function () { rowBusy = false; btn.removeAttribute("data-busy"); });
        }
        // star — reads current state, sends the definite opposite verb (starred -> unstar)
        var starred0 = hasLbl("STARRED");
        var starBtn = mkBtn("row__star" + (starred0 ? " row__star--on" : ""), starred0 ? "\u2605" : "\u2606", starred0 ? "Unstar this message" : "Star this message");
        onAct(starBtn, function (ev) {
          if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
          var on = hasLbl("STARRED");
          fire(on ? "unstar" : "star", starBtn, function () {
            var now = hasLbl("STARRED");
            starBtn.className = "row__action row__star" + (now ? " row__star--on" : "");
            starBtn.textContent = now ? "\u2605" : "\u2606";
            starBtn.setAttribute("aria-label", now ? "Unstar this message" : "Star this message");
          });
        });
        actions.appendChild(starBtn);
        // important — same definite-verb discipline over IMPORTANT
        var imp0 = hasLbl("IMPORTANT");
        var impBtn = mkBtn("row__importance" + (imp0 ? " row__importance--on" : ""), "\u203b", imp0 ? "Mark not important" : "Mark important");
        onAct(impBtn, function (ev) {
          if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
          var on = hasLbl("IMPORTANT");
          fire(on ? "unimportant" : "important", impBtn, function () {
            var now = hasLbl("IMPORTANT");
            impBtn.className = "row__action row__importance" + (now ? " row__importance--on" : "");
            impBtn.setAttribute("aria-label", now ? "Mark not important" : "Mark important");
          });
        });
        actions.appendChild(impBtn);
        // archive — the -INBOX move; on ok drop the row from the inbox projection via onArchived
        var arcBtn = mkBtn("row__archive", "\u2913", "Archive this message");
        onAct(arcBtn, function (ev) {
          if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
          fire("archive", arcBtn, function () { if (typeof rowActions.onArchived === "function") rowActions.onArchived(m); });
        });
        actions.appendChild(arcBtn);
      }
      if (canFile) {
        // ①c — "Send to Forest": a trigger reveals the tree menu; picking a tree files
        // THIS message into it via fileFn -> POST /soil/file (owner-data, no grant). On a
        // confirmed { ok:true } the trigger reflects "Filed -> <tree>" (data-filed) — a
        // fire-and-confirm, NOT a persistent toggle we can't honestly source. Every
        // handler stopPropagation so filing never also opens the row (the #23 discipline).
        var fileBusy = false;
        var fileBtn = mkBtn("row__file", "\uD83C\uDF32", "Send to Forest");
        fileBtn.setAttribute("aria-haspopup", "menu");
        var menu = el(doc, "div", "row__file-menu", { role: "menu", "aria-label": "Send to a Forest tree" });
        function setMenu(open) {
          if (menu.style) menu.style.display = open ? "" : "none";
          menu.setAttribute("data-open", open ? "1" : "0");
          fileBtn.setAttribute("aria-expanded", open ? "true" : "false");
        }
        setMenu(false);
        onAct(fileBtn, function (ev) {
          if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
          setMenu(menu.getAttribute("data-open") !== "1");
        });
        rowActions.trees.forEach(function (t) {
          var cat = t && t.category != null ? t.category : t;
          var lbl = t && t.label != null ? t.label : String(cat);
          var opt = el(doc, "span", "row__file-opt", { role: "menuitem", tabindex: "0", "aria-label": "File into " + lbl, text: lbl });
          onAct(opt, function (ev) {
            if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
            if (fileBusy) return;
            fileBusy = true; fileBtn.setAttribute("data-busy", "1");
            var payload = { source: m.source, account: m.account || rowActions.account || null, itemId: m.id, category: cat };
            Promise.resolve(rowActions.fileFn(payload)).then(function (res) {
              fileBusy = false; fileBtn.removeAttribute("data-busy");
              if (res && res.ok) {
                fileBtn.setAttribute("data-filed", "1");
                fileBtn.setAttribute("aria-label", "Filed to " + lbl + " \u2014 send again");
                fileBtn.setAttribute("title", "Filed \u2192 " + lbl);
              } else {
                fileBtn.setAttribute("aria-label", "Send to Forest (last attempt failed)");
              }
              setMenu(false);
            }, function () { fileBusy = false; fileBtn.removeAttribute("data-busy"); setMenu(false); });
          });
          menu.appendChild(opt);
        });
        actions.appendChild(fileBtn);
        actions.appendChild(menu);
      }
      li.appendChild(actions);
    }
    // #12 — SNOOZE (email-views, the calm form): a LOCAL per-row affordance (any message with
    // an id — no Gmail grant, like read-later). It rides the shared .row__actions cluster (calm
    // at rest, revealed on hover/focus — zero new CSS) and NEVER opens the row (stopPropagation,
    // the #23 checkbox discipline). Normal view: a native preset <select> (the app's own idiom —
    // zero menu CSS) that snoozes THIS message; it vanishes from the list on the repaint. Snoozed
    // view (snoozeCtl.viewing): the resurface time + an "Un-snooze" button. READ-ONLY on the model
    // (the store is a client overlay). Cold-safe: absent snoozeCtl / id -> no affordance.
    if (snoozeCtl && snoozeCtl.store && m.id) {
      var snz = el(doc, "div", "row__actions row__snooze-actions", { role: "group", "aria-label": "Snooze" });
      var stopSnz = function (ev) { if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation(); };
      if (snoozeCtl.viewing) {
        var until = (typeof snoozeCtl.store.snoozedUntil === "function") ? snoozeCtl.store.snoozedUntil(m.id) : null;
        var note = el(doc, "span", "row__action row__snooze-note", { text: "Snoozed", "aria-hidden": "true" });
        if (until) { try { note.setAttribute("title", "Snoozed until " + new Date(until).toLocaleString()); } catch (e) {} }
        snz.appendChild(note);
        var unBtn = el(doc, "span", "row__action row__unsnooze", { role: "button", tabindex: "0", "aria-label": "Un-snooze this message", text: "\u21ba" });
        var doUn = function (ev) { stopSnz(ev); snoozeCtl.store.unsnooze(m.id); if (typeof snoozeCtl.onChange === "function") snoozeCtl.onChange(); };
        unBtn.addEventListener("click", doUn);
        unBtn.addEventListener("keydown", function (ev) { var k = ev && ev.key; if (k === "Enter" || k === " " || k === "Spacebar") { if (ev && ev.preventDefault) ev.preventDefault(); doUn(ev); } });
        snz.appendChild(unBtn);
      } else {
        var sel = el(doc, "select", "row__action row__snooze", { "aria-label": "Snooze this message" });
        sel.appendChild(el(doc, "option", null, { value: "", text: "\uD83C\uDF19 Snooze\u2026" }));
        var ps = (typeof snoozeCtl.presets === "function") ? (snoozeCtl.presets(snoozeCtl.now) || []) : [];
        ps.forEach(function (p) { sel.appendChild(el(doc, "option", null, { value: String(p.at), text: p.label })); });
        sel.addEventListener("click", stopSnz);
        sel.addEventListener("change", function (ev) {
          stopSnz(ev);
          var at = parseInt(sel.value, 10);
          if (at && isFinite(at)) { snoozeCtl.store.snooze(m.id, at, snoozeCtl.now); if (typeof snoozeCtl.onChange === "function") snoozeCtl.onChange(); }
        });
        snz.appendChild(sel);
      }
      li.appendChild(snz);
    }
    // T1 — DECLINE (the Thing-list line). The per-row affordance for the LETTER primitive:
    // "this one isn't mine to answer" — deliberately, and finished. It rides the same shared
    // .row__actions cluster as snooze (calm at rest, revealed on hover/focus — zero new CSS) and
    // NEVER opens the row (stopPropagation, the #23 checkbox discipline). One button, not a
    // <select>: snooze needs a WHEN, decline needs nothing — that asymmetry IS the feature.
    //
    // ⚠ THE GATE IS ON THE WAY IN, NEVER ON THE WAY OUT — read this before touching it.
    //   OFFER (decline):  gated on declineCtl.canDecline(m) — letters only, FAIL-CLOSED (T3).
    //                     No classifier, no decline; a notification has nobody waiting.
    //   REVERSE (un-decline): gated ONLY on isDeclined(m.id) — never on canDecline.
    // If the reversal shared the offer's gate, then losing the classifier (mail-type absent ->
    // canDecline is false for EVERYTHING) would strand already-declined mail with no way back,
    // and C1 ("it will never destroy your mail" — the decision is always yours to change) would
    // fail exactly when the app is most degraded. The dangerous direction is the one you gate.
    // Cold-safe: absent declineCtl / store / id -> no affordance at all.
    if (declineCtl && declineCtl.store && m.id) {
      var dstore = declineCtl.store;
      var isDec = (typeof dstore.isDeclined === "function") && dstore.isDeclined(m.id) === true;
      var canDec = (typeof dstore.canDecline === "function") && dstore.canDecline(m) === true;
      if (isDec || canDec) {
        var dec = el(doc, "div", "row__actions row__decline-actions", { role: "group", "aria-label": "Decline" });
        var stopDec = function (ev) { if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation(); };
        var fireDec = function () { if (typeof declineCtl.onChange === "function") declineCtl.onChange(); };
        if (isDec) {
          // The reversal. Shown wherever a declined message is visible — which, because declined
          // mail is hidden from every other view, is the Declined view. A RECORD, not a to-do list:
          // the note states the decision, it never nags about it (C5/C6 — no count, no badge).
          var dnote = el(doc, "span", "row__action row__decline-note", { text: "Declined", "aria-hidden": "true" });
          var at = (typeof dstore.declinedAt === "function") ? dstore.declinedAt(m.id) : null;
          if (at) { try { dnote.setAttribute("title", "You declined this on " + new Date(at).toLocaleString()); } catch (e) {} }
          dec.appendChild(dnote);
          var reBtn = el(doc, "span", "row__action row__undecline", { role: "button", tabindex: "0", "aria-label": "Un-decline this message", text: "\u21ba" });
          var doRe = function (ev) { stopDec(ev); dstore.undecline(m.id); fireDec(); };
          reBtn.addEventListener("click", doRe);
          reBtn.addEventListener("keydown", function (ev) { var k = ev && ev.key; if (k === "Enter" || k === " " || k === "Spacebar") { if (ev && ev.preventDefault) ev.preventDefault(); doRe(ev); } });
          dec.appendChild(reBtn);
        } else {
          // The offer. No confirm dialog — decline is REVERSIBLE (undecline is one click away),
          // and a confirm on a reversible act is a nag that teaches you to click through nags.
          var decBtn = el(doc, "span", "row__action row__decline", { role: "button", tabindex: "0", "aria-label": "Decline this message \u2014 you answered: no", text: "Decline" });
          try { decBtn.setAttribute("title", "Decline \u2014 this one isn't yours to answer. It will not come back."); } catch (e) {}
          var doDec = function (ev) { stopDec(ev); dstore.decline(m.id, declineCtl.now); fireDec(); };
          decBtn.addEventListener("click", doDec);
          decBtn.addEventListener("keydown", function (ev) { var k = ev && ev.key; if (k === "Enter" || k === " " || k === "Spacebar") { if (ev && ev.preventDefault) ev.preventDefault(); doDec(ev); } });
          dec.appendChild(decBtn);
        }
        li.appendChild(dec);
      }
    }
    // T5 — THE SCREEN (the Thing-list line). The per-row affordance for the SENDER primitive.
    //
    // ⚠ THIS ROW DECIDES ABOUT A PERSON, NOT A MESSAGE — and every label here must say so.
    // Decline (above) is per-message: "this one isn't mine to answer." Screen is per-SENDER and it
    // is FOREVER: approving Alice approves every letter Alice will ever send. A control that reads
    // like a message-level verb while acting at sender scope is the one way this feature lies to
    // him, so the aria-labels and titles name the address out loud. (RCR: "once, about the person.")
    //
    // ⚠ THE GATE IS ON THE WAY IN, NEVER ON THE WAY OUT — the same law decline carries, and here it
    // is C1 itself:
    //   OFFER (approve / deny): gated on screenable(m) — letters only, FAIL-CLOSED on a missing
    //                           mail-type. No classifier -> nothing is a letter -> no screening.
    //   REVERSE (un-screen):    gated ONLY on isDenied(key) — never on the classifier.
    // Rip mail-type.js out and an already-denied sender must STILL be un-deniable, or C1 fails at
    // exactly the moment the app is most degraded.
    //
    // Cold-safe: absent screenCtl / store / senderless mail -> no affordance at all.
    if (screenCtl && screenCtl.store) {
      var sstore = screenCtl.store;
      var skey = (typeof sstore.senderEmail === "function") ? sstore.senderEmail(m) : "";
      if (skey) {
        var isDenied = (typeof sstore.isDenied === "function") && sstore.isDenied(skey) === true;
        // The OFFER shows only on a HELD letter — an already-approved sender needs no control
        // (his inbox is the affordance) and a notification was never screened in the first place.
        var isHeldRow = (typeof sstore.screenable === "function") && sstore.screenable(m) === true &&
                        (typeof sstore.verdict === "function") && sstore.verdict(m) === sstore.HELD;
        if (isDenied || isHeldRow) {
          var scr = el(doc, "div", "row__actions row__screen-actions", { role: "group", "aria-label": "Screen sender" });
          var stopScr = function (ev) { if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation(); };
          var fireScr = function () { if (typeof screenCtl.onChange === "function") screenCtl.onChange(); };
          var keyBtn = function (node, fn) {
            node.addEventListener("click", fn);
            node.addEventListener("keydown", function (ev) { var k = ev && ev.key; if (k === "Enter" || k === " " || k === "Spacebar") { if (ev && ev.preventDefault) ev.preventDefault(); fn(ev); } });
          };
          if (isDenied) {
            // The RECORD and the REVERSAL. A denied sender's mail is hidden from every view except
            // this one — so this row is the ONLY place the decision is findable, and Renata's call
            // ("deny is reversible and findable, or C1 is a lie") lives or dies right here.
            var snote = el(doc, "span", "row__action row__screen-note", { text: "Denied", "aria-hidden": "true" });
            var sat = (typeof sstore.decidedAt === "function") ? sstore.decidedAt(skey) : null;
            if (sat) { try { snote.setAttribute("title", "You denied " + skey + " on " + new Date(sat).toLocaleString()); } catch (e) {} }
            scr.appendChild(snote);
            var unBtn = el(doc, "span", "row__action row__unscreen", { role: "button", tabindex: "0", "aria-label": "Undo \u2014 stop denying " + skey, text: "\u21ba" });
            keyBtn(unBtn, function (ev) { stopScr(ev); sstore.unscreen(skey); fireScr(); });
            scr.appendChild(unBtn);
          } else {
            // The two offers. No confirm dialog on either — BOTH are reversible (unscreen is one
            // click away in the Denied view), and a confirm on a reversible act teaches him to
            // click through confirms.
            var apBtn = el(doc, "span", "row__action row__screen-approve", { role: "button", tabindex: "0", "aria-label": "Approve " + skey + " \u2014 always let this sender through", text: "Approve" });
            try { apBtn.setAttribute("title", "Approve " + skey + " \u2014 their mail comes to your inbox from now on."); } catch (e) {}
            keyBtn(apBtn, function (ev) { stopScr(ev); sstore.approve(skey, screenCtl.now); fireScr(); });
            scr.appendChild(apBtn);
            var dnBtn = el(doc, "span", "row__action row__screen-deny", { role: "button", tabindex: "0", "aria-label": "Deny " + skey + " \u2014 keep this sender out of your inbox", text: "Deny" });
            // ⚠ The title says what this DOES and what it does NOT do. It hides; it does not delete,
            // does not bounce, does not tell them. Nothing in this module transmits (C3/C4) and the
            // mail stays in Gmail untouched (C1). If a future edit makes that sentence false, the
            // sentence is not the thing to change.
            try { dnBtn.setAttribute("title", "Deny " + skey + " \u2014 their mail stays out of your inbox. Nothing is deleted and they are never told."); } catch (e) {}
            keyBtn(dnBtn, function (ev) { stopScr(ev); sstore.deny(skey, screenCtl.now); fireScr(); });
            scr.appendChild(dnBtn);
          }
          li.appendChild(scr);
        }
      }
    }
    return li;
  }

  /* ---- threadHeadRow (leg 15) — the collapsed CONVERSATION face -------------- *
   * A thread-record with count > 1 renders as ONE foldable `row` (§3: a
   * collapsed conversation lives in the LIST region, so it is a row, not a
   * `.record` — that is the detail object you open a message INTO). It wears the
   * same row grammar as messageRow (from · date · subject · snippet from the
   * `latest` message), plus a `.row__trail` carrying a count `chip` and a fold
   * caret — both already letters of the Block Alphabet, so the marginal CSS is
   * one indent modifier for the expanded members, nothing more.
   * The honest badge/unread rides the LATEST message (§3f) — never a
   * fabricated thread-level state. The HEAD toggles expand; the MEMBERS open
   * (Gmail's own model). Pure render — no model call, no re-fetch. */
  function threadHeadRow(doc, rec, isOpen, onToggle) {
    var latest = (rec && rec.latest) || (rec && rec.messages && rec.messages[0]) || {};
    var count = (rec && rec.count) || (rec && rec.messages && rec.messages.length) || 1;
    var cls = "row mail-msg row--thread";
    if (latest.unread === true) cls += " row--unread";       // flag-don't-fake, on the latest
    var li = el(doc, "li", cls);
    li.setAttribute("role", "button");
    li.setAttribute("tabindex", "0");
    li.setAttribute("aria-expanded", isOpen ? "true" : "false");
    li.setAttribute("aria-label",
      "Conversation: " + (latest.subject || "(no subject)") + ", " + count +
      " messages, " + (isOpen ? "expanded" : "collapsed"));
    if (typeof onToggle === "function") activate(li, function () { onToggle(); });
    var bodyCol = el(doc, "div", "row__body");
    var headLine = el(doc, "div", "row__meta mail-msg__head");
    headLine.appendChild(el(doc, "span", "mail-msg__from", { text: latest.from || "(unknown sender)" }));
    if (latest.date) headLine.appendChild(el(doc, "span", "mail-msg__date", { text: " \u00b7 " + latest.date }));
    appendSourceChip(doc, headLine, latest);   // #5 Two Rivers: SC-4 source chip on the LATEST (flag-don't-fake); cold-safe -> legacy badge
    bodyCol.appendChild(headLine);
    var subj = latest.subject || "(no subject)";
    bodyCol.appendChild(el(doc, "div", "row__title mail-msg__subject", { text: subj, title: subj }));
    var snip = snippet(latest.body);
    if (snip) bodyCol.appendChild(el(doc, "div", "row__snippet mail-msg__snippet", { text: snip }));
    li.appendChild(bodyCol);
    // the fold affordance rides row__trail (already in the alphabet): a count chip + a caret.
    var trail = el(doc, "div", "row__trail mail-thread__trail");
    trail.appendChild(el(doc, "span", "chip mail-thread__count", { text: String(count), "aria-hidden": "true" }));
    trail.appendChild(el(doc, "span", "mail-thread__caret", { text: isOpen ? "\u25be" : "\u25b8", "aria-hidden": "true" }));
    li.appendChild(trail);
    return li;
  }

  /* ---- the compose surface (leg 6): new message + reply --------------------- *
   * Injection-safe like the rest of this file: createElement + textContent/value    *
   * only, no innerHTML, and NO <form> (role=button divs + input/textarea, wired by   *
   * event listeners — the same shape the test shim supports). The irreversibility    *
   * friction lives HERE, client-side: a two-step SEND-CONFIRM (decision A, *
   * — send is a non-gated covered write, so the friction is the confirm click, not a  *
   * server HALT). sendFn is INJECTED (tests) and defaults to POST /intent/send. All   *
   * failure is honest: a denied/failed send shows the server's real reason and lets   *
   * the owner retry — never a fabricated "Sent".                                      *
   *   opts: { to?, subject?, body?, inReplyTo?, account?, isReply?, onCancel?, onSent?, sendFn? } */
  function emailFromHeader(fromHeader) {
    // "Name <addr@x>" -> "addr@x"; a bare "addr@x" -> itself; else "" (flag-don't-fake, no guess).
    var s = String(fromHeader == null ? "" : fromHeader);
    var m = s.match(/<([^>]+)>/);
    if (m) return m[1].trim();
    m = s.match(/[^\s<>@]+@[^\s<>@]+/);
    return m ? m[0] : "";
  }
  function replySubject(subject) {
    var s = String(subject == null ? "" : subject).trim();
    return /^re:/i.test(s) ? s : ("Re: " + (s || "(no subject)"));   // idempotent — never "Re: Re:"
  }
  // email-app #14 (forward half) — "Fwd:" subject, idempotent (never "Fwd: Fwd:"); mirrors
  // replySubject. Accepts a pre-existing "Fwd:" or "Fw:" prefix as already-forwarded.
  function fwdSubject(subject) {
    var s = String(subject == null ? "" : subject).trim();
    return /^fwd?:/i.test(s) ? s : ("Fwd: " + (s || "(no subject)"));
  }
  // email-app #14 (forward half) — the quoted forwarded block, built ONLY from fields the
  // model actually carries (from · date · subject · body). To/Cc are an HONEST model gap
  // (mail-model.js ~L229: no recipient state) and are OMITTED, never faked — forward does
  // not need them. A header line is dropped when its field is empty (flag-don't-fake); the
  // block header always stays. Leading blank lines give the user room to type ABOVE the quote.
  var FWD_HEADER = "---------- Forwarded message ----------";
  function forwardBody(m) {
    m = m || {};
    var lines = [FWD_HEADER];
    if (m.from) lines.push("From: " + m.from);
    if (m.date) lines.push("Date: " + m.date);
    if (m.subject) lines.push("Subject: " + m.subject);
    return "\n\n" + lines.join("\n") + "\n\n" + (m.body == null ? "" : String(m.body));
  }
  /* ---- send config: account + send-grant, resolved from the runtime (leg 06 "build B") ------ *
   * The witnessed finish needs NO hand-set window.FOREST_*: compose sources the gmail account   *
   * from GET /connectors and the active gmail send-grant KEY from GET /authority/grants — the    *
   * runtime's own K1-safe projections (never a token/secret). checkWarrant selects the grant by  *
   * EXACT key (deny-all otherwise), so the resolved key must be a live, non-revoked grant whose  *
   * billers include 'gmail'. Both fall back to the window globals for backward-compat, and the   *
   * reads are cold-safe: a failure yields nulls -> canSend:false -> the honest "Enable sending"  *
   * affordance (the owner-gated setup act), never a fabricated "Sent". ------------------------- */
  function runtimeBase() {
    return (root.runtimeBase || (typeof window !== "undefined" && window.FOREST_RUNTIME) || "");
  }
  function pickFetch(f) {
    if (typeof f === "function") return f;
    return (typeof fetch === "function") ? fetch : null;
  }
  function getJSON(fetchFn, url) {
    if (!fetchFn) return Promise.resolve(null);
    return fetchFn(url, { cache: "no-store", credentials: "include" })
      .then(function (r) { return r && r.ok ? r.json() : null; }, function () { return null; })
      .catch(function () { return null; });
  }
  // the active gmail send-grant KEY from GET /authority/grants (non-revoked, billers has 'gmail')
  function gmailGrantKeyFrom(grantsPayload) {
    var grants = grantsPayload && Array.isArray(grantsPayload.grants) ? grantsPayload.grants : [];
    for (var i = 0; i < grants.length; i++) {
      var g = grants[i] || {};
      if (g.revoked === true) continue;
      var billers = Array.isArray(g.billers) ? g.billers : [];
      if (billers.indexOf("gmail") !== -1 && g.key) return g.key;
    }
    return null;
  }
  // the gmail account (email) from GET /connectors linked sources ({ grants:[{provider,account}] })
  function gmailAccountFrom(connectorsPayload) {
    var rows = connectorsPayload && Array.isArray(connectorsPayload.grants) ? connectorsPayload.grants : [];
    for (var i = 0; i < rows.length; i++) {
      var c = rows[i] || {};
      if (String(c.provider) === "gmail" && c.account) return c.account;
    }
    return null;
  }
  function resolveSendConfig(opts) {
    opts = opts || {};
    var RT = runtimeBase();
    var fetchFn = pickFetch(opts._fetch);
    var winAccount = (root.FOREST_MAIL_ACCOUNT || (typeof window !== "undefined" && window.FOREST_MAIL_ACCOUNT) || null);
    var winGrant = (root.FOREST_SEND_GRANT || (typeof window !== "undefined" && window.FOREST_SEND_GRANT) || null);
    return Promise.all([
      getJSON(fetchFn, (RT || "") + "/connectors"),
      getJSON(fetchFn, (RT || "") + "/authority/grants")
    ]).then(function (r) {
      var account = gmailAccountFrom(r[0]) || winAccount || null;
      var grant = gmailGrantKeyFrom(r[1]) || winGrant || null;
      return { account: account, grant: grant, canSend: !!(account && grant) };
    });
  }
  var SEND_GRANT_KEY = "gmail-send";
  // A fresh, non-reused value for the grant-issue `secret`. This is a FORMAL Vault-wrap
  // placeholder the Warrant requires non-empty at issue — NOT the send credential (the real
  // send auth is the OAuth gmail.send token the connector serves in-tenant, K1) and NOT a
  // shared/matching secret (exercise never checks it; it is held server-side, never emitted).
  function freshSecret() {
    try {
      if (typeof crypto !== "undefined" && crypto.getRandomValues) {
        var a = new Uint8Array(16); crypto.getRandomValues(a);
        return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
      }
    } catch (e) {}
    return "send-grant-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }
  // owner-gated setup: issue the Warrant send-grant (billers:['gmail'], cap:0) — the sibling of
  // blessing the OAuth grant. Idempotent by key: re-issuing 'gmail-send' is harmless. Resolves
  // { ok, grant?, error? } — never throws to the caller.
  function enableSending(opts) {
    opts = opts || {};
    var RT = runtimeBase();
    var fetchFn = pickFetch(opts._fetch);
    if (!fetchFn) return Promise.resolve({ ok: false, error: "offline \u2014 sending not enabled" });
    var reqBody = { key: SEND_GRANT_KEY, scope: { billers: ["gmail"], cap: 0 }, secret: freshSecret() };
    if (opts.ttl_min != null) reqBody.ttl_min = opts.ttl_min;
    return fetchFn((RT || "") + "/grant", {
      method: "POST", cache: "no-store", credentials: "include",
      headers: { "content-type": "application/json" }, body: JSON.stringify(reqBody)
    }).then(function (r) {
      return r.json().then(function (j) {
        if (r.ok && j && j.decision === "issued") return { ok: true, grant: j.grant || SEND_GRANT_KEY };
        return { ok: false, error: (j && j.error) || ("couldn\u2019t enable sending (HTTP " + r.status + ")") };
      }, function () { return { ok: false, error: "couldn\u2019t enable sending (HTTP " + r.status + ")" }; });
    }).catch(function () { return { ok: false, error: "network error \u2014 sending not enabled" }; });
  }
  // the production send: POST the compose to /intent/send (the Warrant seam). The grant KEY is the
  // resolved one (getGrant()) with the window global as fallback; the account rides the payload.
  // Resolves { ok, id?, error? } — never throws to the caller.
  function makeSendFn(cfg) {
    cfg = cfg || {};
    return function (payload) {
      var RT = runtimeBase();
      var grant = (typeof cfg.getGrant === "function" ? cfg.getGrant() : cfg.grant)
        || (root.FOREST_SEND_GRANT || (typeof window !== "undefined" && window.FOREST_SEND_GRANT) || "");
      var fetchFn = pickFetch(cfg._fetch);
      if (!fetchFn) return Promise.resolve({ ok: false, error: "offline \u2014 not sent" });
      var bodyObj = {
        grant: grant, provider: "gmail", account: payload.account,
        to: payload.to, subject: payload.subject, body: payload.body
      };
      if (payload.inReplyTo) bodyObj.inReplyTo = payload.inReplyTo;
      // email-app #14b (reply-all): Cc rides the POST only when present, so the runtime's
      // buildMime emits a Cc: header for reply-all and a plain reply / new-message send stays
      // byte-unchanged (no empty Cc slot). Mirrors the inReplyTo pass-through above.
      if (payload.cc) bodyObj.cc = payload.cc;
      // email-app (Bcc): rides the POST only when present, so the runtime's buildMime emits a
      // Bcc: header only for a Bcc'd send (Gmail strips it from delivered copies — blind). A send with
      // no Bcc stays byte-unchanged. Mirrors the cc / inReplyTo pass-throughs above.
      if (payload.bcc) bodyObj.bcc = payload.bcc;
      // email-app #19 (attachments on send): the base64 file array rides the POST only when present, so the
      // runtime's buildMime switches to multipart/mixed for a send-with-files and a plain send stays
      // byte-unchanged (no empty attachments slot). Mirrors the cc / inReplyTo pass-throughs above.
      if (payload.attachments && payload.attachments.length) bodyObj.attachments = payload.attachments;
      // email-app undo-send: the user's reconsideration window (closed set {5,10,20,30}s) rides the POST
      // only when set, so a no-undo send stays byte-unchanged. The runtime HOLDs it server-side and returns
      // a { decision:'queued', undoId } receipt; a 0/absent window sends immediately (decision:'allow').
      if (payload.undoWindowSec) bodyObj.undoWindowSec = payload.undoWindowSec;
      return fetchFn((RT || "") + "/intent/send", {
        method: "POST", cache: "no-store", credentials: "include",
        headers: { "content-type": "application/json" }, body: JSON.stringify(bodyObj)
      }).then(function (r) {
        return r.json().then(function (j) {
          if (r.ok && j && j.decision === "allow") return { ok: true, id: j.sent && j.sent.id };
          // HELD: the send is queued behind an undo window. The caller shows an Undo affordance and, on
          // Undo, calls the cancel fn with this undoId; on timeout the runtime dispatches on its own.
          if (r.ok && j && j.decision === "queued") return { ok: true, queued: true, undoId: j.undoId, dispatchAt: j.dispatchAt };
          return { ok: false, error: (j && j.error) || ("send failed (HTTP " + r.status + ")") };
        }, function () { return { ok: false, error: "send failed (HTTP " + r.status + ")" }; });
      }).catch(function () { return { ok: false, error: "network error \u2014 not sent" }; });
    };
  }

  // email-app undo-send: the CANCEL counterpart of makeSendFn. Given an undoId from a queued send, POST
  // /intent/send/cancel to pull the message back before its window elapses. Resolves { ok, cancelled } —
  // never throws. A 409 (already dispatched / unknown) resolves { ok:false, error } so the toast can say so.
  function makeCancelSendFn(cfg) {
    cfg = cfg || {};
    return function (undoId) {
      var RT = runtimeBase();
      var fetchFn = pickFetch(cfg._fetch);
      if (!fetchFn) return Promise.resolve({ ok: false, error: "offline \u2014 cannot cancel" });
      return fetchFn((RT || "") + "/intent/send/cancel", {
        method: "POST", cache: "no-store", credentials: "include",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ undoId: undoId })
      }).then(function (r) {
        return r.json().then(function (j) {
          if (r.ok && j && j.cancelled) return { ok: true, cancelled: true, undoId: undoId };
          return { ok: false, error: (j && j.error) || ("cancel failed (HTTP " + r.status + ")") };
        }, function () { return { ok: false, error: "cancel failed (HTTP " + r.status + ")" }; });
      }).catch(function () { return { ok: false, error: "network error \u2014 cancel not sent" }; });
    };
  }

  // email-app undo-send D1 — the RESTART-EXPIRY notice READER. On mail load, ask the runtime which held
  // sends expired when it last restarted: GET /projection/undo-expired (owner-gated). The list is METADATA
  // ONLY (undoId/provider/account/times — never a body, recipient, or token; the runtime captures it at
  // start and one-time-surfaces it). Cold-safe: no fetch, 401/403 (signed out), any non-ok (5xx), or a
  // network error -> [] (silent no-op), so a mailbox with nothing expired — or a signed-out read — is
  // byte-unchanged. The _fetch seam mirrors the rest of this renderer (tests inject; production uses the
  // global fetch over runtimeBase). Never throws.
  function readUndoExpired(opts) {
    opts = opts || {};
    var RT = runtimeBase();
    var fetchFn = pickFetch(opts._fetch);
    if (!fetchFn) return Promise.resolve([]);
    return fetchFn((RT || "") + "/projection/undo-expired", { cache: "no-store", credentials: "include" })
      .then(function (r) {
        if (!r || !r.ok) return [];   // 401/403 signed-out, 5xx, anything non-ok -> nothing to show
        return r.json().then(function (j) {
          return (j && Array.isArray(j.expired)) ? j.expired : [];
        }, function () { return []; });
      })
      .catch(function () { return []; });   // network — say nothing rather than fabricate a notice
  }

  // email-app undo-send D1 — the RESTART-EXPIRY notice BUILDER. Turns the expired-sends metadata into a
  // calm, dismissible notice for the top of the mail view: "N queued send(s) didn't go out after a restart."
  // D1-A is EXPIRE + NOTIFY (operator pick A), NOT re-send (that was option B, unbuilt) — so the notice
  // tells the owner the held sends were dropped so they can resend them THEMSELVES; there is deliberately no
  // re-send button. Honest + K1-safe: it shows a COUNT (and the provider names, non-secret metadata) and
  // NEVER a composed body, a recipient, or a token. Empty/absent list -> null (no node), so the view is
  // byte-unchanged when nothing expired (flag-don't-fake). onDismiss (opts) fires when the owner closes it.
  function undoExpiredNotice(doc, expired, opts) {
    opts = opts || {};
    var rows = Array.isArray(expired) ? expired : [];
    if (rows.length === 0) return null;   // nothing expired -> no notice, view byte-unchanged
    var n = rows.length;
    var box = el(doc, "div", "mail-undo-expired", { role: "status", "aria-live": "polite" });
    var headline = (n === 1)
      ? "1 queued send didn\u2019t go out after a restart."
      : (n + " queued sends didn\u2019t go out after a restart.");
    box.appendChild(el(doc, "div", "mail-undo-expired__headline", { text: headline }));
    box.appendChild(el(doc, "div", "mail-undo-expired__detail", {
      text: "They were held for the undo window and expired when the server restarted \u2014 resend them if you still want them."
    }));
    // Provider names are non-secret metadata; a compact deduped list helps the owner know which account
    // without ever surfacing a body/recipient/token. Omitted when no providers are named.
    var providers = [];
    for (var i = 0; i < rows.length; i++) {
      var pv = rows[i] && rows[i].provider;
      if (pv && providers.indexOf(pv) === -1) providers.push(pv);
    }
    if (providers.length) {
      box.appendChild(el(doc, "div", "mail-undo-expired__providers", { text: providers.join(", ") }));
    }
    var dismiss = el(doc, "div", "mail-undo-expired__dismiss record__action", {
      role: "button", tabindex: "0", text: "Dismiss", "aria-label": "Dismiss restart notice"
    });
    activate(dismiss, function () {
      if (box.parentNode) box.parentNode.removeChild(box);
      if (typeof opts.onDismiss === "function") opts.onDismiss();
    });
    box.appendChild(dismiss);
    return box;
  }

  /* ---- the draft seam (email-app Track B #18): POST to /intent/draft --------- *
   * The DRAFT counterpart of makeSendFn. One fn, three ops:                       *
   *   op:'save' {to,cc?,subject,body,id?} -> create (no id) or UPDATE (id) a      *
   *     NOT-YET-SENT draft; resolves { ok, id? (the draft id), op? }.             *
   *   op:'list' -> the saved-drafts registry; resolves { ok, drafts:[{id,         *
   *     message:{id,threadId}}] }.                                                *
   *   op:'get' {id} -> resume one draft; resolves { ok, id, content } where       *
   *     content is the read-seam STRING (parsed by mailModel.parseMailContent —   *
   *     never a second parser here, the whole reason getDraft returns a string).  *
   * Grant is the SAME resolved gmail grant send/modify use (subject-scoped); the  *
   * 'draft' action rides gmail.modify, no re-consent. Honest: a denied/failed     *
   * draft surfaces the server's real reason, never a fabricated success. The      *
   * shapes mirror the route byte-for-byte: save/list/get all reply decision:      *
   * 'allow' with save->{draft:{id,op}}, list->{drafts}, get->{draft:{id,content}}.*/
  function makeDraftFn(cfg) {
    cfg = cfg || {};
    return function (payload) {
      payload = payload || {};
      var op = payload.op || "save";
      var RT = runtimeBase();
      var grant = (typeof cfg.getGrant === "function" ? cfg.getGrant() : cfg.grant)
        || (root.FOREST_SEND_GRANT || (typeof window !== "undefined" && window.FOREST_SEND_GRANT) || "");
      var fetchFn = pickFetch(cfg._fetch);
      if (!fetchFn) return Promise.resolve({ ok: false, error: "offline \u2014 draft not saved" });
      var bodyObj = { op: op, grant: grant, provider: "gmail", account: payload.account };
      if (op === "save") {
        bodyObj.to = String(payload.to || "");
        bodyObj.subject = String(payload.subject || "");
        bodyObj.body = String(payload.body || "");
        if (payload.cc) bodyObj.cc = payload.cc;   // only-when-present (mirrors send's cc discipline)
        if (payload.bcc) bodyObj.bcc = payload.bcc;   // only-when-present (Bcc preserved in the draft; mirrors cc)
        if (payload.id) bodyObj.id = payload.id;    // present => UPDATE, absent => CREATE
      } else if (op === "get") {
        bodyObj.id = payload.id;
      }
      return fetchFn((RT || "") + "/intent/draft", {
        method: "POST", cache: "no-store", credentials: "include",
        headers: { "content-type": "application/json" }, body: JSON.stringify(bodyObj)
      }).then(function (r) {
        return r.json().then(function (j) {
          if (r.ok && j && j.decision === "allow") {
            if (op === "list") return { ok: true, drafts: (j.drafts || []) };
            if (op === "get")  return { ok: true, id: j.draft && j.draft.id, content: j.draft ? j.draft.content : null };
            return { ok: true, id: j.draft && j.draft.id, op: j.draft && j.draft.op };  // save
          }
          return { ok: false, error: (j && j.error) || ("draft " + op + " failed (HTTP " + r.status + ")") };
        }, function () { return { ok: false, error: "draft " + op + " failed (HTTP " + r.status + ")" }; });
      }).catch(function () { return { ok: false, error: "network error \u2014 draft not saved" }; });
    };
  }

  /* ------------------------------------------------------------------------- *
   * makeSettingsFn(cfg) — email-app #27 (filters) + #28 (send-as/vacation).   *
   * The SETTINGS counterpart of makeDraftFn. One fn, the /intent/settings     *
   * seam, keyed on payload.op:                                                *
   *   READS (state:'READ', no Warrant grant needed):                          *
   *     op:'filter.list'  -> { ok, filters:[{id,criteria,action}] }           *
   *     op:'sendAs.list'  -> { ok, sendAs:[{sendAsEmail,...}] }               *
   *     op:'vacation.get' -> { ok, vacation:{enableAutoReply,...} }           *
   *   WRITES (state:'APPLIED', ride the 'settings' Warrant action, non-gated  *
   *   — the OAuth gmail.settings.basic scope IS the authorization):           *
   *     op:'filter.create' {criteria,action} -> { ok, filterId }              *
   *     op:'filter.delete' {id}              -> { ok, filterId, deleted }     *
   *     op:'sendAs.create' {sendAs}          -> { ok, sendAsEmail }           *
   *     op:'sendAs.patch'  {email,patch}     -> { ok, sendAsEmail }           *
   *     op:'vacation.update' {vacation}      -> { ok, enableAutoReply }       *
   * Grant is the SAME resolved gmail grant send/modify/draft use. Honest: a   *
   * denied/failed settings op surfaces the server's real reason, never a      *
   * fabricated success. The K1 no-auto-trash guard is enforced server-side in *
   * createFilter (unbypassable); the UI ALSO omits the TRASH option as        *
   * defense-in-depth — a bad filter that slips through still 400s here.        *
   * ------------------------------------------------------------------------- */
  function makeSettingsFn(cfg) {
    cfg = cfg || {};
    return function (payload) {
      payload = payload || {};
      var op = payload.op || "filter.list";
      var RT = runtimeBase();
      var grant = (typeof cfg.getGrant === "function" ? cfg.getGrant() : cfg.grant)
        || (root.FOREST_SEND_GRANT || (typeof window !== "undefined" && window.FOREST_SEND_GRANT) || "");
      var fetchFn = pickFetch(cfg._fetch);
      if (!fetchFn) return Promise.resolve({ ok: false, error: "offline \u2014 settings not changed" });
      var bodyObj = { op: op, grant: grant, provider: "gmail", account: payload.account };
      if (op === "filter.create") { bodyObj.criteria = payload.criteria; bodyObj.action = payload.action; }
      else if (op === "filter.delete") { bodyObj.id = payload.id; }
      else if (op === "sendAs.create") { bodyObj.sendAs = payload.sendAs; }
      else if (op === "sendAs.patch") { bodyObj.email = payload.email; bodyObj.patch = payload.patch; }
      else if (op === "vacation.update") { bodyObj.vacation = payload.vacation; }
      return fetchFn((RT || "") + "/intent/settings", {
        method: "POST", cache: "no-store", credentials: "include",
        headers: { "content-type": "application/json" }, body: JSON.stringify(bodyObj)
      }).then(function (r) {
        return r.json().then(function (j) {
          if (r.ok && j && j.decision === "allow") {
            if (op === "filter.list")   return { ok: true, filters: (j.filters || []) };
            if (op === "sendAs.list")   return { ok: true, sendAs: (j.sendAs || []) };
            if (op === "vacation.get")  return { ok: true, vacation: (j.vacation || null) };
            // writes carry a settings receipt { op, filterId?/sendAsEmail?/enableAutoReply? }
            var s = j.settings || {};
            return { ok: true, filterId: s.filterId, sendAsEmail: s.sendAsEmail, enableAutoReply: s.enableAutoReply, deleted: s.deleted, op: s.op };
          }
          return { ok: false, error: (j && j.error) || ("settings " + op + " failed (HTTP " + r.status + ")"), code: j && j.code };
        }, function () { return { ok: false, error: "settings " + op + " failed (HTTP " + r.status + ")" }; });
      }).catch(function () { return { ok: false, error: "network error \u2014 settings not changed" }; });
    };
  }

  /* ---- the manage seam (leg 07): POST a label move to /intent/modify -------- *
   * The MANAGE counterpart of makeSendFn. `payload` is { itemId, action, account } where action is one   *
   * of read / unread / archive / unarchive (the runtime maps it to a label mutation). The grant is the    *
   * SAME resolved gmail grant send uses — the Warrant grant is subject-scoped ('gmail'), so one gmail     *
   * grant authorizes both send and modify (the OAuth gmail.modify scope is the real per-capability        *
   * authority at Google). Resolves { ok, id?, labelIds?, error? } — never throws. Honest: a denied/       *
   * failed modify surfaces the server's real reason, never a fabricated "Done".                           */
  function makeModifyFn(cfg) {
    cfg = cfg || {};
    return function (payload) {
      var RT = runtimeBase();
      var grant = (typeof cfg.getGrant === "function" ? cfg.getGrant() : cfg.grant)
        || (root.FOREST_SEND_GRANT || (typeof window !== "undefined" && window.FOREST_SEND_GRANT) || "");
      var fetchFn = pickFetch(cfg._fetch);
      if (!fetchFn) return Promise.resolve({ ok: false, error: "offline \u2014 not changed" });
      var bodyObj = { grant: grant, provider: "gmail", account: payload.account, itemId: payload.itemId, action: payload.action };
      if (payload.action === "label") {
        if (payload.addLabelIds) bodyObj.addLabelIds = payload.addLabelIds;
        if (payload.removeLabelIds) bodyObj.removeLabelIds = payload.removeLabelIds;
      }
      return fetchFn((RT || "") + "/intent/modify", {
        method: "POST", cache: "no-store", credentials: "include",
        headers: { "content-type": "application/json" }, body: JSON.stringify(bodyObj)
      }).then(function (r) {
        return r.json().then(function (j) {
          if (r.ok && j && j.decision === "allow") return { ok: true, id: j.modified && j.modified.id, labelIds: j.modified && j.modified.labelIds };
          return { ok: false, error: (j && j.error) || ("change failed (HTTP " + r.status + ")") };
        }, function () { return { ok: false, error: "change failed (HTTP " + r.status + ")" }; });
      }).catch(function () { return { ok: false, error: "network error \u2014 not changed" }; });
    };
  }

  /* ---- makeFileFn (①c) — the "Send to Forest" file seam -------------------- *
   * The owner-data sibling of makeModifyFn: POSTs { source, account, itemId,
   * category } to the OWNER-GATED /soil/file door (forest-runtime.js). Filing is
   * NOT the Warrant class — it mints no /intent grant, carries no grant, widens no
   * scope; it is gated only by the owner session (credentials: "include"), exactly
   * like the door. The runtime answers { decision: "applied", applied, proof }; we
   * read `decision === "applied"` as ok (the owner-data vocabulary, not "allow"),
   * and un-file is simply category: null. Honest failure: a 401/404/400 surfaces
   * the server's real reason; offline -> honest, never a fabricated file. K1: no
   * token/cred value is sent or read back. */
  function makeFileFn(cfg) {
    cfg = cfg || {};
    return function (payload) {
      var RT = runtimeBase();
      var fetchFn = pickFetch(cfg._fetch);
      if (!fetchFn) return Promise.resolve({ ok: false, error: "offline \u2014 not filed" });
      var bodyObj = { source: payload.source, account: payload.account, itemId: payload.itemId, category: payload.category };
      return fetchFn((RT || "") + "/soil/file", {
        method: "POST", cache: "no-store", credentials: "include",
        headers: { "content-type": "application/json" }, body: JSON.stringify(bodyObj)
      }).then(function (r) {
        return r.json().then(function (j) {
          if (r.ok && j && j.decision === "applied") return { ok: true, applied: j.applied, proof: j.proof };
          return { ok: false, error: (j && j.error) || ("file failed (HTTP " + r.status + ")") };
        }, function () { return { ok: false, error: "file failed (HTTP " + r.status + ")" }; });
      }).catch(function () { return { ok: false, error: "network error \u2014 not filed" }; });
    };
  }

  /* ---- makeBatchModifyFn (#23) — the BULK label-move seam ------------------- *
   * The batch sibling of makeModifyFn: POSTs an itemIds[] array to the SAME
   * /intent/modify route (the #15 primitive), which routes the array to
   * conn.batchModify (ONE served token, ONE Gmail API call) and returns
   * { modified: { ids, count, action } }. Same Warrant gate, same MODIFY_ACTIONS
   * map as the single path — this client seam adds NO new authority, it just hands
   * the route a list instead of one id. The runtime REFUSES >1000 typed-loud (never
   * a silent partial), so a caller with a larger selection chunks below the cap
   * before calling (v1's selection surface stays within one batch). Honest failure:
   * a denied/failed batch surfaces the server's real reason; offline -> honest, never
   * a fabricated success. Reversible by construction (label-only), so the caller's
   * undo just fires the inverse action over the same ids. */
  function makeBatchModifyFn(cfg) {
    cfg = cfg || {};
    return function (payload) {
      var RT = runtimeBase();
      var grant = (typeof cfg.getGrant === "function" ? cfg.getGrant() : cfg.grant)
        || (root.FOREST_SEND_GRANT || (typeof window !== "undefined" && window.FOREST_SEND_GRANT) || "");
      var fetchFn = pickFetch(cfg._fetch);
      if (!fetchFn) return Promise.resolve({ ok: false, error: "offline \u2014 not changed" });
      var ids = (payload && payload.itemIds) || [];
      if (!ids.length) return Promise.resolve({ ok: false, error: "nothing selected" });
      var bodyObj = { grant: grant, provider: "gmail", account: payload.account, itemIds: ids, action: payload.action };
      if (payload.action === "label") {
        if (payload.addLabelIds) bodyObj.addLabelIds = payload.addLabelIds;
        if (payload.removeLabelIds) bodyObj.removeLabelIds = payload.removeLabelIds;
      }
      return fetchFn((RT || "") + "/intent/modify", {
        method: "POST", cache: "no-store", credentials: "include",
        headers: { "content-type": "application/json" }, body: JSON.stringify(bodyObj)
      }).then(function (r) {
        return r.json().then(function (j) {
          if (r.ok && j && j.decision === "allow") return { ok: true, ids: j.modified && j.modified.ids, count: j.modified && j.modified.count, action: j.modified && j.modified.action };
          return { ok: false, error: (j && j.error) || ("change failed (HTTP " + r.status + ")") };
        }, function () { return { ok: false, error: "change failed (HTTP " + r.status + ")" }; });
      }).catch(function () { return { ok: false, error: "network error \u2014 not changed" }; });
    };
  }

  /* ---- the search-all seam (#8 slice ②): GET /projection/mail-search?q= -------- *
   * The client half of the whole-corpus reach. `query` is the raw Gmail operator     *
   * string already in the search box. GETs the owner-gated live search (gmail.readonly *
   * — no re-consent) and resolves { ok, items?, error? } — never throws. Honest: an    *
   * empty/denied/failed search surfaces the server's real reason, never a fabricated   *
   * hit list. Offline (no fetch) -> an honest message, never a silent empty result.    */
  function makeSearchAllFn(cfg) {
    cfg = cfg || {};
    return function (query) {
      var RT = runtimeBase();
      var fetchFn = pickFetch(cfg._fetch);
      var q = String(query == null ? "" : query).trim();
      if (!fetchFn) return Promise.resolve({ ok: false, error: "offline \u2014 can\u2019t reach your mail" });
      if (!q) return Promise.resolve({ ok: false, error: "type a search first" });
      return fetchFn((RT || "") + "/projection/mail-search?q=" + encodeURIComponent(q), {
        cache: "no-store", credentials: "include"
      }).then(function (r) {
        return r.json().then(function (j) {
          if (r.ok && j && Array.isArray(j.items)) return { ok: true, items: j.items };
          return { ok: false, error: (j && j.error) || ("search failed (HTTP " + r.status + ")") };
        }, function () { return { ok: false, error: "search failed (HTTP " + r.status + ")" }; });
      }).catch(function () { return { ok: false, error: "network error \u2014 couldn\u2019t search" }; });
    };
  }

  /* ---- the incremental REFRESH seam (email-app #24 L4): POST /connectors/history --- *
   * The delta counterpart of the full /export/soil read. Resolves a normalized outcome  *
   * the caller acts on — never throws, never fakes:                                     *
   *   { ok:true, decision:'delta', records }          -> fold via model.applyMailDelta   *
   *   { ok:true, decision:'full_read_required', reason } -> full re-read (existing path)  *
   *   { ok:false, error }                              -> honest inline note, no change  *
   * Client sends only { provider:'gmail' } (the route resolves the sole account). Cold-  *
   * safe: no fetch -> an honest offline outcome, never a fabricated refresh.             */
  function makeRefreshFn(cfg) {
    cfg = cfg || {};
    return function () {
      var RT = runtimeBase();
      var fetchFn = pickFetch(cfg._fetch);
      if (!fetchFn) return Promise.resolve({ ok: false, error: "offline \u2014 can\u2019t refresh right now" });
      return fetchFn((RT || "") + "/connectors/history", {
        method: "POST", cache: "no-store", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "gmail" })
      }).then(function (r) {
        return r.json().then(function (j) {
          if (r.ok && j && j.decision) return { ok: true, decision: j.decision, records: (j.records || []), reason: (j.reason || null) };
          // The CODE rides out with the failure. E_NO_SESSION_KEY is not a refresh fault —
          // it is a signed-in-but-keyless session (the runtime restarted under an open tab), and the
          // caller must re-open the Door rather than paint the raw server string into a status line.
          return { ok: false, error: (j && j.error) || ("refresh failed (HTTP " + r.status + ")"), code: (j && j.code) || null };
        }, function () { return { ok: false, error: "refresh failed (HTTP " + r.status + ")", code: null }; });
      }).catch(function () { return { ok: false, error: "network error \u2014 couldn\u2019t refresh", code: null }; });
    };
  }

  /* ---- the per-id CONTENT HYDRATE seam (email-app #24 follow-on): POST /connectors/messages --- *
   * The companion to the refresh seam: a delta reports messagesAdded as ids only, and this fetches   *
   * their content so genuinely-new mail rides the cheap delta path instead of a full re-read.        *
   * Resolves a normalized outcome the caller acts on — never throws, never fakes:                    *
   *   { ok:true, rows:[{ itemId, content, name }] }  -> fold via model.mailboxFromExport + unify      *
   *   { ok:false, error }                            -> caller falls back to the full read (honest)   *
   * Client sends { provider:'gmail', ids }. Cold-safe: no fetch / empty ids -> honest no-op, never a  *
   * fabricated row. On ANY failure the caller full-reads — the safe path is always reachable.         */
  function makeFetchFn(cfg) {
    cfg = cfg || {};
    return function (ids) {
      var RT = runtimeBase();
      var fetchFn = pickFetch(cfg._fetch);
      if (!fetchFn) return Promise.resolve({ ok: false, error: "offline \u2014 can\u2019t fetch new mail" });
      if (!ids || !ids.length) return Promise.resolve({ ok: true, rows: [] });
      return fetchFn((RT || "") + "/connectors/messages", {
        method: "POST", cache: "no-store", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "gmail", ids: ids })
      }).then(function (r) {
        return r.json().then(function (j) {
          if (r.ok && j && Array.isArray(j.rows)) return { ok: true, rows: j.rows };
          return { ok: false, error: (j && j.error) || ("fetch failed (HTTP " + r.status + ")") };
        }, function () { return { ok: false, error: "fetch failed (HTTP " + r.status + ")" }; });
      }).catch(function () { return { ok: false, error: "network error \u2014 couldn\u2019t fetch new mail" }; });
    };
  }

  /* ---- signature (leg 15, #20): a purely-LOCAL, compose-only signature -------- *
   * Shea's laptop web app, client-first: the signature lives in localStorage, never *
   * on Google and never in the mail model (so parity holds by construction — no     *
   * model change). Cold-safe: every store touch is wrapped; an absent/stubbed        *
   * localStorage degrades to "no signature" (a silent no-op), never a throw. The     *
   * RFC-3676 delimiter "\n\n-- \n" marks the block, so injection is idempotent and    *
   * a reader can see where the body ends and the sig begins. Reversible: clear the    *
   * stored text, or delete the block in the compose body — the user's edits win.      */
  /* ---- the one-click unsubscribe seam (email-app #11 B2): POST /unsubscribe -------- *
   * The ACTION counterpart of the read-only link. `payload` is { itemId, source?, account? } —      *
   * NEVER a URL: the runtime reads the target from that message's OWN Soil (the SSRF guard). Owner-  *
   * gated on the box (the session cookie), NOT the gmail Warrant grant (it is not a Gmail call), so  *
   * the button works from the read-only pane too. Resolves { ok, status?, error? } — never throws;   *
   * an honest failure leaves the visible read-only link as the fallback (never a fabricated ✓).      */
  function makeUnsubscribeFn(cfg) {
    cfg = cfg || {};
    return function (payload) {
      var RT = runtimeBase();
      var fetchFn = pickFetch(cfg._fetch);
      if (!fetchFn) return Promise.resolve({ ok: false, error: "offline \u2014 use the link" });
      var bodyObj = { itemId: payload.itemId };
      if (payload.source) bodyObj.source = payload.source;
      if (payload.account) bodyObj.account = payload.account;
      return fetchFn((RT || "") + "/unsubscribe", {
        method: "POST", cache: "no-store", credentials: "include",
        headers: { "content-type": "application/json" }, body: JSON.stringify(bodyObj)
      }).then(function (r) {
        return r.json().then(function (j) {
          if (r.ok && j && j.ok) return { ok: true, status: j.status };
          return { ok: false, error: (j && j.error) || ("unsubscribe failed (HTTP " + r.status + ")") };
        }, function () { return { ok: false, error: "unsubscribe failed (HTTP " + r.status + ")" }; });
      }).catch(function () { return { ok: false, error: "network error \u2014 use the link" }; });
    };
  }

  var SIG_KEY = "forest.mail.signature";
  // email-app undo-send Block 3 — the reconsideration window is a LOCAL preference (localStorage,
  // no backend). Only the closed set {5,10,20,30}s is honored; anything else = 0 (off).
  var UNDO_KEY = "forest.mail.undoWindowSec";
  var UNDO_WINDOWS = [5, 10, 20, 30];
  var SIG_DELIM = "\n\n-- \n";
  function _ls() { try { return (typeof window !== "undefined" && window.localStorage) || null; } catch (e) { return null; } }
  function readSignature() { var ls = _ls(); try { return (ls && ls.getItem(SIG_KEY)) || ""; } catch (e) { return ""; } }
  function writeSignature(text) { var ls = _ls(); try { if (ls) { ls.setItem(SIG_KEY, String(text == null ? "" : text)); return true; } } catch (e) {} return false; }
  // email-app undo-send Block 3 — read/write the local Undo-window preference. Cold-safe to 0 (off)
  // with no localStorage; the closed-set guard means a tampered or legacy value can never send an
  // odd window — it degrades to off, never to a surprising delay.
  function readUndoWindow() {
    var ls = _ls();
    try {
      var raw = ls && ls.getItem(UNDO_KEY);
      var n = raw == null ? 0 : (parseInt(raw, 10) || 0);
      return UNDO_WINDOWS.indexOf(n) !== -1 ? n : 0;
    } catch (e) { return 0; }
  }
  function writeUndoWindow(sec) {
    var ls = _ls();
    var n = UNDO_WINDOWS.indexOf(Number(sec)) !== -1 ? Number(sec) : 0;
    try { if (ls) { ls.setItem(UNDO_KEY, String(n)); return true; } } catch (e) {}
    return false;
  }
  function bodyWithSignature(body, sig) {
    body = body == null ? "" : String(body);
    sig = sig == null ? "" : String(sig).replace(/\s+$/, "");
    if (!sig) return body;
    if (body.indexOf(SIG_DELIM + sig) !== -1) return body;   // already present — idempotent
    return body + SIG_DELIM + sig;
  }
  // Re-apply on Save: swap an existing trailing sig block for the new one; if there is no
  // block yet, append the new one; an empty newSig strips the block. The body is only touched
  // at its own trailing sig block, so a user's typed body above the delimiter is never disturbed.
  function applySigToBody(body, oldSig, newSig) {
    body = body == null ? "" : String(body);
    oldSig = oldSig == null ? "" : String(oldSig).replace(/\s+$/, "");
    newSig = newSig == null ? "" : String(newSig).replace(/\s+$/, "");
    if (oldSig) {
      var oldBlock = SIG_DELIM + oldSig;
      var at = body.lastIndexOf(oldBlock);
      if (at !== -1 && at + oldBlock.length === body.length) {
        return newSig ? body.slice(0, at) + SIG_DELIM + newSig : body.slice(0, at);
      }
    }
    return bodyWithSignature(body, newSig);
  }

  function composeView(doc, opts) {
    opts = opts || {};
    // Signature: injected value wins (test seam); else the local store. injectSignature
    // defaults ON — a reply carrying a quoted body gets the sig appended below the quote.
    var sig = opts.signature != null ? String(opts.signature) : readSignature();
    var injectSignature = opts.injectSignature !== false;
    var saveSignature = typeof opts.onSignatureSave === "function" ? opts.onSignatureSave : writeSignature;
    // The resolved send-grant key (leg 06 "build B"): mutable so an in-pane "Enable sending" can
    // fill it after issuing the grant; the sendFn reads it live via getGrant().
    var effectiveGrant = opts.grant || null;
    var sendFn = typeof opts.sendFn === "function"
      ? opts.sendFn
      : makeSendFn({ getGrant: function () { return effectiveGrant; }, _fetch: opts._fetch });
    // email-app undo-send Block 2-UI — the reconsideration window (closed set {5,10,20,30}s; 0/absent = off)
    // rides the send from settings, and the cancel fn is the Undo toast's action. Both injectable (test
    // seams). undoWindowSec defaults 0, so a mailbox with the feature off sends byte-unchanged.
    var undoWindowSec = opts.undoWindowSec != null ? (Number(opts.undoWindowSec) || 0) : readUndoWindow();
    var cancelFn = typeof opts.cancelFn === "function"
      ? opts.cancelFn
      : makeCancelSendFn({ getGrant: function () { return effectiveGrant; }, _fetch: opts._fetch });
    // email-app Track B #18 — the draft seam beside send. Injected fn wins (test seam); else built
    // on the same resolved grant. currentDraftId carries a resumed draft's id so re-saves UPDATE the
    // same draft rather than piling up duplicates (a first create fills it from the save receipt).
    var draftFn = typeof opts.draftFn === "function"
      ? opts.draftFn
      : makeDraftFn({ getGrant: function () { return effectiveGrant; }, _fetch: opts._fetch });
    var currentDraftId = opts.draftId || null;
    var account = opts.account || (root.FOREST_MAIL_ACCOUNT || (typeof window !== "undefined" && window.FOREST_MAIL_ACCOUNT) || null);
    // canSend defaults TRUE (so an injected sendFn / the legacy window-global path still shows Send);
    // it is only false when the resolver explicitly reported no gmail send-grant.
    var canSend = opts.canSend !== false;

    // : the compose surface is a `record` (a raised paper card); each labeled
    // input is a `field` in the Block Alphabet. mail-compose__* stays as behavior hooks.
    var view = el(doc, "div", "mail-compose record");
    view.appendChild(el(doc, "h3", "mail-compose__title record__title", { text: opts.isForward ? "Forward" : (opts.isReplyAll ? "Reply all" : (opts.isReply ? "Reply" : "New message")) }));
    // SL-3: a top-× dismiss beside the labeled Cancel below — same teardown (opts.onCancel).
    var composeDismiss = el(doc, "button", "mail-compose__dismiss record__dismiss", { type: "button", "aria-label": "Close", text: "\u00d7" });
    activate(composeDismiss, function () { if (typeof opts.onCancel === "function") opts.onCancel(); });
    view.appendChild(composeDismiss);
    // L3: MINIMIZE -> dock, beside the × dismiss. Rendered ONLY when the host wired opts.onMinimize
    // (the host owns the overlay, so it owns hide/restore); a caller without the dock gets the prior
    // ×-only pane, cold-safe by construction. record__minimize is its OWN family — NOT record__dismiss
    // (minimize is not a dismiss; SL-3 audits the ×, this is a distinct affordance).
    if (typeof opts.onMinimize === "function") {
      var composeMin = el(doc, "button", "mail-compose__minimize record__minimize", { type: "button", "aria-label": "Minimize", text: "\u2013" });
      activate(composeMin, function () { opts.onMinimize(); });
      view.appendChild(composeMin);
    }

    function field(labelText, tag, cls, value, attrs) {
      var row = el(doc, "div", "mail-compose__field field");
      row.appendChild(el(doc, "label", "mail-compose__label field__label", { text: labelText }));
      var inp = el(doc, tag, cls + " field__control", attrs || {});
      if (value != null) inp.value = value;
      row.appendChild(inp);
      view.appendChild(row);
      return inp;
    }
    var toInput = field("To", "input", "mail-compose__to", opts.to || "", { type: "email", "aria-label": "Recipient" });
    // email-app (Cc reveal): Cc is HIDDEN by default and opened with a small reveal
    // affordance (Gmail's model — the resting compose is To / Subject / body; Cc is one reach
    // away, the honest-default calm). It starts REVEALED when prefilled (reply-all's opts.cc),
    // because a field that already holds recipients MUST be visible — Gmail's exact behavior,
    // and the honest-default's floor: never hide state that already exists. Cc is otherwise
    // fully wired end-to-end (rendered here, sent only-when-present, draft-saved) — this slice
    // gates its VISIBILITY only, nothing on the send path changes (a plain send stays byte-
    // identical). mail-compose__cc stays the behavior hook; the field() helper carries the
    // field/field__control styling (no bespoke field CSS). [Bcc is a separate slice: it
    // has NO send-path wire today, and a Bcc field that could not send would be a Real-or-Made
    // lie (§2, Lens 2) — so it is not added here.]
    var ccPrefilled = !!(opts.cc && String(opts.cc).trim());
    var ccRow = el(doc, "div", "mail-compose__field field");
    ccRow.appendChild(el(doc, "label", "mail-compose__label field__label", { text: "Cc" }));
    var ccInput = el(doc, "input", "mail-compose__cc field__control", { type: "email", "aria-label": "Cc recipients" });
    ccInput.value = opts.cc || "";
    ccRow.appendChild(ccInput);
    // the reveal control — an inline `.reveal` affordance, keyboard-reachable (role=button,
    // tabindex 0, activate() = click + Enter/Space), labeled so a screen reader announces what
    // it opens. Tapping it opens Cc, hides itself, and moves focus into the field.
    var ccReveal = el(doc, "div", "mail-compose__cc-reveal reveal", { role: "button", tabindex: "0", "aria-label": "Add Cc recipients", text: "Cc" });
    function revealCc() {
      ccRow.removeAttribute("hidden");
      ccReveal.setAttribute("hidden", "hidden");
      if (typeof ccInput.focus === "function") ccInput.focus();
    }
    activate(ccReveal, revealCc);
    if (ccPrefilled) {
      ccReveal.setAttribute("hidden", "hidden");   // prefilled -> Cc already open, no reveal needed
    } else {
      ccRow.setAttribute("hidden", "hidden");       // calm default -> Cc hidden until wanted
    }
    view.appendChild(ccReveal);
    view.appendChild(ccRow);
    // email-app (Bcc reveal): Bcc mirrors Cc — HIDDEN by default, opened by a small reveal
    // affordance, REVEALED when prefilled (opts.bcc). UNLIKE the earlier Cc-only slice, Bcc ships WITH
    // its full send wire this session (payload.bcc in doSend + doSaveDraft; the runtime's buildMime emits
    // a Bcc: header Gmail strips from delivered copies — blind). Shipping the field WITHOUT that wire
    // would be the Real-or-Made lie (§2, Lens 2) — it is closed here, so the field is honest.
    var bccPrefilled = !!(opts.bcc && String(opts.bcc).trim());
    var bccRow = el(doc, "div", "mail-compose__field field");
    bccRow.appendChild(el(doc, "label", "mail-compose__label field__label", { text: "Bcc" }));
    var bccInput = el(doc, "input", "mail-compose__bcc field__control", { type: "email", "aria-label": "Bcc recipients" });
    bccInput.value = opts.bcc || "";
    bccRow.appendChild(bccInput);
    var bccReveal = el(doc, "div", "mail-compose__bcc-reveal reveal", { role: "button", tabindex: "0", "aria-label": "Add Bcc recipients", text: "Bcc" });
    function revealBcc() {
      bccRow.removeAttribute("hidden");
      bccReveal.setAttribute("hidden", "hidden");
      if (typeof bccInput.focus === "function") bccInput.focus();
    }
    activate(bccReveal, revealBcc);
    if (bccPrefilled) {
      bccReveal.setAttribute("hidden", "hidden");   // prefilled -> Bcc already open, no reveal needed
    } else {
      bccRow.setAttribute("hidden", "hidden");       // calm default -> Bcc hidden until wanted
    }
    view.appendChild(bccReveal);
    view.appendChild(bccRow);

    // THE WEAVE · E2 — contact autocomplete in To / Cc / Bcc. Reads /api/contact via
    // the contactsRest seam and offers name->address matches as the owner types; a raw
    // address is still accepted (the inputs stay plain, the dropdown is additive). TC-1:
    // the tool owns matching, this only wires render+dispatch. Cold-safe: absent the
    // module or the read seam, attach() no-ops and the fields stay exactly as today.
    // opts.contactSearchFn is a test seam (injected search); default builds from
    // window.ForestShell.contactsRest. opts.autocomplete === false disables the wire.
    if (opts.autocomplete !== false) {
      var ac = root.mailComposeAutocomplete;
      if (ac && typeof ac.attach === "function") {
        var acOpts = { doc: doc, searchFn: opts.contactSearchFn, restOpts: opts.contactRestOpts };
        ac.attach(toInput, acOpts);
        ac.attach(ccInput, acOpts);
        ac.attach(bccInput, acOpts);
      }
    }

    var subjInput = field("Subject", "input", "mail-compose__subject", opts.subject || "", { type: "text", "aria-label": "Subject" });
    var bodyInput = field("Message", "textarea", "mail-compose__body", injectSignature ? bodyWithSignature(opts.body || "", sig) : (opts.body || ""), { rows: "8", "aria-label": "Message body" });

    // email-app compose formatting affordances (slice-2 §6.2 — Markdown scope DECIDED,
    // "we can evolve out of that later"). A LIGHT toolbar of quiet controls sits above the body;
    // each wraps/prefixes the selection with Markdown. The formatting is REAL, not decorative:
    // slice-1's send path already renders the Markdown to HTML on send (connectors markdown.js
    // renderEmail), so what these buttons write IS what sends (Real-or-Made honesty holds). No
    // browser-side parser is needed — the toolbar mutates the plain textarea value only, so the
    // createElement/textContent injection-safe contract is untouched. A live PREVIEW (markdown
    // toDOM) is the named next slice, gated on loading the parser browser-side (index.html script
    // + a toDOM export); this ships the visible affordance the surface was missing. -calm:
    // four quiet controls, not a dense toolbar (the Burnisher aesthetic).
    var formatBar = el(doc, "div", "mail-compose__format", { role: "toolbar", "aria-label": "Formatting" });
    function fireBodyInput() {
      // best-effort: the value change is what sends; this only nudges the Margin/future preview.
      try {
        if (typeof bodyInput.dispatchEvent === "function" && typeof Event === "function") {
          bodyInput.dispatchEvent(new Event("input", { bubbles: true }));
        }
      } catch (e) { /* no-op */ }
    }
    function bodySel() {
      var v = String(bodyInput.value || "");
      var s = bodyInput.selectionStart, e = bodyInput.selectionEnd;
      if (s == null || e == null) { s = e = v.length; }
      return { v: v, s: s, e: e };
    }
    // wrap the selection (or the caret) in before/after; reselect the inner run so a repeat
    // click or immediate typing replaces the placeholder rather than nesting it.
    function surround(before, after, placeholder) {
      var x = bodySel(), sel = x.v.slice(x.s, x.e) || (placeholder || "");
      bodyInput.value = x.v.slice(0, x.s) + before + sel + after + x.v.slice(x.e);
      var ns = x.s + before.length, ne = ns + sel.length;
      if (typeof bodyInput.focus === "function") bodyInput.focus();
      try { bodyInput.setSelectionRange(ns, ne); } catch (e2) {}
      fireBodyInput();
    }
    // prefix every line the selection touches with `prefix` (lists, quotes).
    function linePrefix(prefix) {
      var x = bodySel();
      var lineStart = x.v.lastIndexOf("\n", x.s - 1) + 1;
      var lineEnd = x.v.indexOf("\n", x.e); if (lineEnd === -1) lineEnd = x.v.length;
      var block = x.v.slice(lineStart, lineEnd);
      var prefixed = block.split("\n").map(function (ln) { return prefix + ln; }).join("\n");
      bodyInput.value = x.v.slice(0, lineStart) + prefixed + x.v.slice(lineEnd);
      if (typeof bodyInput.focus === "function") bodyInput.focus();
      try { bodyInput.setSelectionRange(lineStart, lineStart + prefixed.length); } catch (e2) {}
      fireBodyInput();
    }
    function fmtBtn(label, aria, fn) {
      var b = el(doc, "button", "mail-compose__format-btn", { type: "button", "aria-label": aria, text: label });
      activate(b, fn);
      formatBar.appendChild(b);
      return b;
    }
    fmtBtn("B", "Bold", function () { surround("**", "**", "bold"); });
    fmtBtn("I", "Italic", function () { surround("*", "*", "italic"); });
    fmtBtn("Link", "Link", function () {
      var x = bodySel(), sel = x.v.slice(x.s, x.e), text = sel || "text", md = "[" + text + "](url)";
      bodyInput.value = x.v.slice(0, x.s) + md + x.v.slice(x.e);
      var urlStart = x.s + md.length - 4, urlEnd = urlStart + 3;   // select the "url" run
      if (typeof bodyInput.focus === "function") bodyInput.focus();
      try { bodyInput.setSelectionRange(urlStart, urlEnd); } catch (e2) {}
      fireBodyInput();
    });
    fmtBtn("List", "Bulleted list", function () { linePrefix("- "); });
    // seat the toolbar between the MESSAGE label and the textarea (bodyInput's field row).
    if (bodyInput.parentNode && typeof bodyInput.parentNode.insertBefore === "function") {
      bodyInput.parentNode.insertBefore(formatBar, bodyInput);
    }

    // email-app A1 (live Markdown preview) — the slice A0 armed. A0 loaded the shared parser
    // browser-side (window.ForestShell.markdown, index.html script BEFORE this file), so compose
    // can now render the body's Markdown as-you-type. A "Preview" TOGGLE beside the fmt buttons
    // swaps the textarea for a rendered pane that shows markdown.toDOM(parse(bodyInput.value)).
    // preview === send BY CONSTRUCTION: the SAME parse() + toDOM walk the SAME frozen SAFE_TAGS
    // vocabulary and the SAME isSafeUrl guard as the send path's toHTML (A0's shared-AST universal
    // property) — so what you preview is what sends. createElement/textContent only (toDOM's
    // structural floor, identical to toHTML's); no innerHTML — injection-safe like the rest of
    // compose. COLD-SAFE: the toggle is added ONLY when the parser actually loaded (root.markdown
    // .toDOM present). A dead preview button that renders nothing would be a Real-or-Made lie, so
    // absent the module there is simply no toggle and compose behaves byte-identically to A0.
    var FM = root.markdown;
    if (FM && typeof FM.toDOM === "function" && typeof FM.parse === "function") {
      // the rendered pane — seated right after the textarea, inside the body field row (grouped
      // with the Message label + toolbar). Hidden at rest; [aria-live] so a screen reader is told
      // when preview content arrives. block.css carries the `[hidden]` rule (a class selector
      // outranks the UA [hidden]{display:none}, so the pane needs an explicit hidden rule).
      var previewPane = el(doc, "div", "mail-compose__preview", { hidden: "", "aria-live": "polite", "aria-label": "Message preview" });
      if (bodyInput.parentNode && typeof bodyInput.parentNode.appendChild === "function") {
        bodyInput.parentNode.appendChild(previewPane);   // bodyInput is the field row's last child -> this seats the pane right after it
      }
      var previewing = false;
      // reuse the fmt-btn LOOK (same base class) but build it DIRECTLY (not via fmtBtn) so it
      // wires exactly ONE handler — the toggle — instead of fmtBtn's text-insert wiring.
      var previewToggle = el(doc, "button", "mail-compose__format-btn mail-compose__preview-toggle", { type: "button", "aria-label": "Toggle Markdown preview", "aria-pressed": "false", text: "Preview" });
      formatBar.appendChild(previewToggle);
      function renderPreview() {
        clearNode(previewPane);
        try {
          previewPane.appendChild(FM.toDOM(FM.parse(String(bodyInput.value || ""))));
        } catch (e) { /* a parser throw must never break compose — leave the pane empty */ }
      }
      function setPreviewing(on) {
        previewing = !!on;
        if (previewing) {
          renderPreview();
          previewPane.removeAttribute("hidden");
          bodyInput.setAttribute("hidden", "hidden");
        } else {
          previewPane.setAttribute("hidden", "hidden");
          bodyInput.removeAttribute("hidden");
        }
        previewToggle.setAttribute("aria-pressed", previewing ? "true" : "false");   // drives BOTH a11y and the active style ([aria-pressed="true"] in CSS) — no classList
      }
      activate(previewToggle, function () { setPreviewing(!previewing); });
      // live re-render: while previewing, ANY body change updates the pane — typing OR a fmt
      // button (which dispatches "input" via fireBodyInput), so bold/italic track in the preview.
      bodyInput.addEventListener("input", function () { if (previewing) renderPreview(); });
    }

    // email-app #19 (attachments on send): an optional attach-picker below the body. Picked files are read to
    // base64 into pendingAttachments [{ filename, mimeType, data }] and each renders a removable chip. An EMPTY
    // picker adds NO `attachments` key to the payload (only-when-present, in doSend below), so a plain send stays
    // byte-identical — the same discipline cc/inReplyTo follow. `mail-attachment*` is this line's CSS surface
    // (joint contract). File reads go through a `_readFile` seam so tests inject bytes without a real FileReader.
    // email-app §5 (attach reveal): the attach affordance is HIDDEN by default and
    // seated in the compose strip as a quiet "Attach" record__action (renderActions below) —
    // the calm-at-rest posture, the attach input one reach away, mirroring the Cc reveal this
    // line already ships. It starts REVEALED when prefilled (opts.attachments present) — the
    // attach analog of Cc's reveal-when-prefilled: never hide state that already exists. HONEST
    // NOTE: no caller seeds opts.attachments today (forward/draft-resume do not yet carry
    // attachments back into compose), so in practice the row currently opens CLOSED — the
    // predicate is real and lights up the moment any path passes attachments; it is not a
    // claimed-but-dead behavior. The SEND PATH IS UNCHANGED (attachments ride only-when-present
    // in doSend; a plain send stays byte-identical) — this slice gates VISIBILITY only.
    var pendingAttachments = [];
    if (opts.attachments && opts.attachments.length) {
      for (var _ai = 0; _ai < opts.attachments.length; _ai++) {
        var _a = opts.attachments[_ai];
        if (_a && _a.filename && _a.data != null) pendingAttachments.push({ filename: _a.filename, mimeType: _a.mimeType || "application/octet-stream", data: _a.data });
      }
    }
    var attachRevealed = pendingAttachments.length > 0;
    var attachRow = el(doc, "div", "mail-compose__attach field");
    attachRow.appendChild(el(doc, "label", "mail-compose__attach-label field__label", { text: "Attachments" }));
    var fileInput = el(doc, "input", "mail-compose__attach-input field__control", { type: "file", multiple: "multiple", "aria-label": "Attach files" });
    attachRow.appendChild(fileInput);
    var attachChips = el(doc, "ul", "mail-attachment-chips", { role: "list" });
    attachRow.appendChild(attachChips);
    if (!attachRevealed) attachRow.setAttribute("hidden", "hidden");   // calm default -> hidden until the strip's Attach control opens it
    view.appendChild(attachRow);

    function renderAttachChips() {
      clearNode(attachChips);
      for (var ci = 0; ci < pendingAttachments.length; ci++) {
        (function (idx) {
          var a = pendingAttachments[idx];
          var chip = el(doc, "li", "mail-attachment-chip");
          chip.appendChild(el(doc, "span", "mail-attachment-chip__name", { text: a.filename, title: a.filename }));
          var rm = el(doc, "button", "mail-attachment-chip__remove", { type: "button", "aria-label": "Remove " + a.filename, text: "\u00d7" });
          activate(rm, function () { pendingAttachments.splice(idx, 1); renderAttachChips(); });
          chip.appendChild(rm);
          attachChips.appendChild(chip);
        })(ci);
      }
    }
    // read one File -> { filename, mimeType, data(base64) }. The default strips the "data:<type>;base64," prefix
    // off a FileReader data URL; opts._readFile overrides it in tests (no DOM FileReader needed).
    var readAttachFile = typeof opts._readFile === "function" ? opts._readFile : function (file) {
      return new Promise(function (resolve, reject) {
        try {
          var fr = new FileReader();
          fr.onload = function () {
            var s = String(fr.result || ""), comma = s.indexOf(",");
            resolve({ filename: file.name, mimeType: file.type || "application/octet-stream", data: comma >= 0 ? s.slice(comma + 1) : s });
          };
          fr.onerror = function () { reject(fr.error || new Error("read failed")); };
          fr.readAsDataURL(file);
        } catch (e) { reject(e); }
      });
    };
    function onAttachPick() {
      var files = fileInput.files ? Array.prototype.slice.call(fileInput.files) : [];
      if (!files.length) return;
      Promise.all(files.map(function (f) { return Promise.resolve(readAttachFile(f)); })).then(function (recs) {
        for (var i = 0; i < recs.length; i++) if (recs[i]) pendingAttachments.push(recs[i]);
        renderAttachChips();
        if (fileInput.value != null) { try { fileInput.value = ""; } catch (e) {} }   // allow re-picking the same file
      }, function () { setStatus("Couldn\u2019t read a file.", "is-error"); });
    }
    if (fileInput && typeof fileInput.addEventListener === "function") fileInput.addEventListener("change", onAttachPick);
    if (attachRevealed) renderAttachChips();   // prefilled (opts.attachments) -> show the seeded chips in the already-open row

    // revealAttach — the strip's quiet "Attach" control opens the (hidden) attach row, focuses
    // the file input, and re-renders the actions strip so the now-redundant Attach control
    // drops (one door, now open — the exact Cc-reveal shape). Idempotent; further picks ride
    // the open row's own file input.
    function revealAttach() {
      if (attachRevealed) return;
      attachRevealed = true;
      attachRow.removeAttribute("hidden");
      if (typeof renderActions === "function") renderActions();
      if (typeof fileInput.focus === "function") fileInput.focus();
    }

    // The Margin (delight #6) renders a quiet, content-free shape echo beside the
    // draft — coarse width strata (one per line) + a settled/active pulse that calms
    // in the pauses. Absent module/membrane -> the slot stays empty and compose
    // behaves identically (the Margin is an ADD over the compose path, never a
    // dependency). SC-1 is honored operationally in paintMargin below: the raw draft
    // (bodyInput.value) reaches the composeMargin DIGEST and NOTHING else; only the
    // content-free digest is handed to margin.render.
    var marginSlot = el(doc, "div", "mail-compose__margin");
    view.appendChild(marginSlot);
    (function wireMargin() {
      var setT = opts._setTimeout || (typeof setTimeout === "function" ? setTimeout : null);
      var clrT = opts._clearTimeout || (typeof clearTimeout === "function" ? clearTimeout : null);
      var DEBOUNCE_MS = (opts._marginDebounceMs != null) ? opts._marginDebounceMs : 160;   // calm repaint, not per-keystroke
      var SETTLE_MS   = (opts._marginSettleMs != null) ? opts._marginSettleMs : 1600;        // JT-1: settle after a quiet gap
      // the membrane's own settle boundary (its _bounds), so the wiring and the
      // digest agree on what "settled" means; fall back to the documented 1500ms.
      var SETTLE_GAP  = (root.composeMargin && root.composeMargin._bounds && root.composeMargin._bounds.SETTLE_GAP) || 1500;
      var MAX_SAMPLES = 32;
      var timingSamples = [];   // raw inter-keystroke intervals (ms) — SC-1: fed ONLY to marginDigest, never to render, never egressed
      var lastTs = null, repaintTimer = null, settleTimer = null;

      function now() { return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }

      // SC-1 lives HERE: bodyInput.value -> marginDigest -> digest -> margin.render.
      // bodyInput.value is NEVER passed to margin.render (the module has no draft
      // parameter to receive it); only the content-free digest crosses the boundary.
      function paintMargin() {
        var cm = root.composeMargin, mg = root.margin;
        if (!cm || typeof cm.marginDigest !== "function" || !mg || typeof mg.render !== "function") return; // cold-safe no-op
        var digest = cm.marginDigest(bodyInput.value, timingSamples);   // draft + raw timing -> content-free digest
        clearNode(marginSlot);
        var node = mg.render(doc, digest);                             // ONLY the digest crosses into the delight
        if (node) marginSlot.appendChild(node);
      }

      function onInput() {
        var t = now();
        if (lastTs != null) { timingSamples.push(t - lastTs); if (timingSamples.length > MAX_SAMPLES) timingSamples.shift(); }
        lastTs = t;
        if (repaintTimer != null && clrT) clrT(repaintTimer);
        if (setT) repaintTimer = setT(paintMargin, DEBOUNCE_MS); else paintMargin();
        // JT-1 "settling in the pauses": after a quiet gap, push a settle-length
        // trailing interval so the membrane's rhythm.state flips to "settled" and the
        // margin visibly calms — without this it would only ever read "active."
        if (settleTimer != null && clrT) clrT(settleTimer);
        if (setT) settleTimer = setT(function () {
          timingSamples.push(SETTLE_GAP + 100);
          if (timingSamples.length > MAX_SAMPLES) timingSamples.shift();
          paintMargin();
        }, SETTLE_MS);
      }

      if (bodyInput && typeof bodyInput.addEventListener === "function") bodyInput.addEventListener("input", onInput);
      paintMargin();   // initial echo for a prefilled body (reply/quoted); settled by default (no samples yet)
    })();

    var status = el(doc, "div", "mail-compose__status", { role: "status", "aria-live": "polite" });
    view.appendChild(status);
    // The Launch (delight #2) renders its two-phase send voice here, below the honest
    // status line. Absent module -> the slot stays empty and the status line alone
    // carries the truth (the delight is an ADD over the send path, never a dependency).
    var launchSlot = el(doc, "div", "mail-compose__launch");
    view.appendChild(launchSlot);
    var actions = el(doc, "div", "mail-compose__actions record__actions");
    view.appendChild(actions);

    function setStatus(text, cls) { status.textContent = text || ""; status.className = "mail-compose__status" + (cls ? " " + cls : ""); }
    function setDisabled(on) {
      // el() returns real DOM nodes (createElement) — they have no `_attrs`, so the old
      // `delete n._attrs.disabled` threw "Cannot convert undefined or null to object" on the
      // re-enable path, an uncaught rejection that froze the compose on "Sending…" and hid the
      // real send result (leg-06 send-hang, 04.1536). setAttribute("disabled","") also never
      // re-enabled (attribute presence = disabled regardless of value). removeAttribute is correct.
      [toInput, ccInput, subjInput, bodyInput].forEach(function (n) {
        if (on) n.setAttribute("disabled", "disabled"); else n.removeAttribute("disabled");
      });
    }
    function renderActions() {
      clearNode(actions);
      var send = el(doc, "div", "mail-compose__send record__action", { role: "button", tabindex: "0", text: "Send" });
      // email-app Track B #18 — Save draft sits between Send and Cancel: a quiet action (no
      // irreversibility friction — a draft is reversible by construction, no confirm needed).
      var saveDraft = el(doc, "div", "mail-compose__save-draft record__action record__action--quiet", { role: "button", tabindex: "0", text: "Save draft" });
      var cancel = el(doc, "div", "mail-compose__cancel record__action record__action--quiet", { role: "button", tabindex: "0", text: "Cancel" });
      activate(cancel, function () { if (typeof opts.onCancel === "function") opts.onCancel(); });
      activate(saveDraft, function () { doSaveDraft(); });
      activate(send, function () {
        if (!String(toInput.value || "").trim()) { setStatus("Add a recipient before sending.", "is-error"); if (toInput.focus) toInput.focus(); return; }
        renderConfirm();   // don't fire — reveal the confirm (the irreversibility friction)
      });
      actions.appendChild(send);
      actions.appendChild(saveDraft);
      actions.appendChild(cancel);
      // §5 — the attach affordance seated in the compose strip: a quiet "Attach"
      // record__action (TEXT, not a paperclip glyph — the Burnisher bar forbids a new
      // badge/hue/motion), shown only while the attach row is hidden. It inherits the FN-4
      // focus ring from the record__action family (no new CSS). Once revealed, the open attach
      // row's own file input carries further picks, so the control drops (mirrors the Cc reveal).
      if (!attachRevealed) {
        var attachReveal = el(doc, "div", "mail-compose__attach-reveal record__action record__action--quiet", { role: "button", tabindex: "0", "aria-label": "Attach files", text: "Attach" });
        activate(attachReveal, revealAttach);
        actions.appendChild(attachReveal);
      }
    }
    function renderConfirm() {
      clearNode(actions);
      setStatus("Send this message? It can\u2019t be unsent.", "is-confirm");
      var confirm = el(doc, "div", "mail-compose__confirm record__action", { role: "button", tabindex: "0", text: "Confirm send" });
      var keep = el(doc, "div", "mail-compose__keep record__action record__action--quiet", { role: "button", tabindex: "0", text: "Keep editing" });
      activate(keep, function () { setStatus("", ""); renderActions(); });
      activate(confirm, function () { doSend(); });
      actions.appendChild(confirm);
      actions.appendChild(keep);
    }
    // The Launch (delight #2) paints its two-phase send voice into launchSlot. Cold-safe:
    // no module -> a no-op, the status line alone carries the truth. clearLaunch empties
    // the slot on any honest-failure/reject so no in-flight voice lingers over an error.
    function paintLaunch(phase) {
      var launch = root.launch;
      if (!launch || typeof launch.render !== "function") return;
      clearNode(launchSlot);
      var node = launch.render(doc, phase, {});
      if (node) launchSlot.appendChild(node);
    }
    function clearLaunch() { clearNode(launchSlot); }
    function doSend() {
      clearNode(actions);
      setDisabled(true);
      setStatus("Sending\u2026", "is-pending");
      // The Launch — SM-4 beat one ("leaving"): the message is in flight. Honest in-flight
      // voice, matches "Sending…" — claims departure, never arrival. Beat two ("landed")
      // fires ONLY inside res.ok below (SC-2). The #523 send-timeout: with no reply after
      // sendTimeoutMs, show phase="waiting" (honest uncertainty) instead of a frozen
      // "Sending…" forever — NEVER a fabricated "landed." Default 12s (past a normal
      // 1-3s Gmail round-trip; catches a hang, not a slow-but-working send).
      paintLaunch("leaving");
      var settled = false, timer = null;
      var timeoutMs = (opts.sendTimeoutMs != null) ? opts.sendTimeoutMs : 12000;
      var setT = opts._setTimeout || (typeof setTimeout === "function" ? setTimeout : null);
      var clrT = opts._clearTimeout || (typeof clearTimeout === "function" ? clearTimeout : null);
      if (setT && timeoutMs > 0) { timer = setT(function () { if (!settled) paintLaunch("waiting"); }, timeoutMs); }
      function stopTimer() { settled = true; if (timer != null && clrT) { clrT(timer); timer = null; } }
      var payload = { to: String(toInput.value || "").trim(), subject: String(subjInput.value || ""), body: String(bodyInput.value || ""), account: account };
      if (opts.inReplyTo) payload.inReplyTo = opts.inReplyTo;
      // email-app #14b — carry Cc only when the owner actually put addresses there (an empty
      // Cc field sends no Cc: header; reply/forward/new-message stay byte-unchanged).
      var ccVal = String(ccInput.value || "").trim();
      if (ccVal) payload.cc = ccVal;
      // email-app — carry Bcc only when the owner actually put addresses there (an empty
      // Bcc field sends no Bcc: header). Blind by the wire (Gmail strips Bcc from delivered mail).
      var bccVal = String(bccInput.value || "").trim();
      if (bccVal) payload.bcc = bccVal;
      // email-app #19 — carry attachments only when the owner actually picked files (an empty picker adds no
      // `attachments` key, so buildMime stays on the plain text path). Mirrors the cc only-when-present above.
      if (pendingAttachments.length) payload.attachments = pendingAttachments.slice();
      // email-app undo-send — carry the reconsideration window only when set (>0); a 0/off window adds no
      // key, so the runtime sends immediately (decision:'allow') and the send path stays byte-unchanged.
      if (undoWindowSec > 0) payload.undoWindowSec = undoWindowSec;
      Promise.resolve(sendFn(payload)).then(function (res) {
        stopTimer();
        if (res && res.ok && res.queued) {
          // email-app undo-send Block 2-UI: the runtime HELD the send behind the reconsideration window
          // and returned { queued, undoId, dispatchAt }. Show the Undo toast for the window — it is
          // COSMETIC (the runtime is the source of truth and dispatches at dispatchAt on its own, even if
          // this tab closes). Undo → cancelFn(undoId); at the window's end the send has landed.
          showSendUndo(res.undoId, res.dispatchAt, payload);
        } else if (res && res.ok) {
          setStatus("Sent \u2713", "is-sent");
          clearNode(actions);
          var done = el(doc, "div", "mail-compose__done record__action", { role: "button", tabindex: "0", text: "\u2190 Inbox" });
          activate(done, function () { if (typeof opts.onCancel === "function") opts.onCancel(); });
          actions.appendChild(done);
          paintLaunch("landed");   // SM-4 beat two — SC-2: only inside res.ok, the confirmed landing
          if (typeof opts.onSent === "function") opts.onSent(res.id, payload);
        } else {
          setDisabled(false);
          setStatus((res && res.error) || "Not sent.", "is-error");
          clearLaunch();   // honest failure: drop the in-flight voice, the status carries it
          renderActions();   // honest failure: let the owner retry
        }
      }, function () { stopTimer(); setDisabled(false); setStatus("Not sent.", "is-error"); clearLaunch(); renderActions(); });
    }
    // email-app undo-send — the reconsideration window. A queued send is HELD server-side; this used
    // to count down INSIDE the compose overlay (fields disabled, the owner watching a timer, unsure
    // whether to close the window). Now it hands off to the bottom-left DOCK (mail-undo-dock.js):
    // compose CLOSES, a quiet "Sent" flash reassures, and the dock carries the Undo + a dual countdown
    // (numeric seconds + a shrinking ring) for the window. It is COSMETIC — the runtime dispatches at
    // dispatchAt on its own (survives tab-close), so the countdown is a courtesy, never the source of
    // truth. Undo -> cancelFn(undoId): cancelled -> reopen compose repopulated with the EXACT just-unsent
    // email; 409 -> honest "already sent". K1: neither the flash nor the dock ever shows the composed
    // body, a recipient, a subject, or a token. Cold-safe: if the dock module is absent (an older
    // deploy served without mail-undo-dock.js), fall back to the in-compose countdown (prior behaviour).
    function showSendUndo(undoId, dispatchAt, payload) {
      var nowFn = opts._now || (typeof Date !== "undefined" ? function () { return Date.now(); } : function () { return 0; });
      var setIv = opts._setInterval || (typeof setInterval === "function" ? setInterval : null);
      var clrIv = opts._clearInterval || (typeof clearInterval === "function" ? clearInterval : null);
      // remaining seconds: trust dispatchAt (absolute, the runtime's own clock) when present; else the
      // window we requested. Guarded to >= 0 so a slow round-trip never shows a negative countdown.
      var remaining = (typeof dispatchAt === "number")
        ? Math.max(0, Math.round((dispatchAt - nowFn()) / 1000))
        : (undoWindowSec > 0 ? undoWindowSec : 0);

      // --- NEW: hand off to the shell-level dock (feature-detected; opts.undoDock is the test seam) ---
      var dock = (opts.undoDock !== undefined) ? opts.undoDock : ((root && root.undoDock) || null);
      if (dock && typeof dock.show === "function") {
        if (typeof dock.flashSent === "function") dock.flashSent({ _doc: doc });   // quiet "Sent" reassurance
        if (typeof opts.onCancel === "function") opts.onCancel();                   // CLOSE the compose overlay -> inbox
        dock.show({
          total: (undoWindowSec > 0 ? undoWindowSec : remaining),
          remaining: remaining,
          _doc: doc,
          _setInterval: setIv, _clearInterval: clrIv,
          onExpire: function () {
            // the window ended; the runtime dispatched on its own -> the send has landed.
            if (typeof opts.onSent === "function") opts.onSent(undoId, payload);
          },
          // note #4: the dock's "Edit Undo Settings" link opens mail's settings straight to the
          // Sending tab (tab 1), where the Undo-window controls live. Does NOT cancel the send.
          onEditSettings: function () { openSettings(1); },
          onUndo: function () {
            Promise.resolve(cancelFn(undoId)).then(function (cres) {
              if (cres && cres.cancelled) {
                // cancelled in time -> reopen compose repopulated with the exact just-unsent email.
                if (typeof dock.dismiss === "function") dock.dismiss({ fade: true });
                if (typeof opts.onReopenWith === "function") opts.onReopenWith(payload);
              } else {
                // 409 / already dispatched -> honest: too late, it went.
                if (typeof dock.landed === "function") dock.landed("Already sent \u2014 too late to undo");
                if (typeof opts.onSent === "function") opts.onSent(undoId, payload);
              }
            }, function () {
              if (typeof dock.landed === "function") dock.landed("Already sent \u2014 too late to undo");
              if (typeof opts.onSent === "function") opts.onSent(undoId, payload);
            });
          }
        });
        return;
      }

      // --- COLD-SAFE FALLBACK: the dock module is absent -> the in-compose countdown (prior behaviour) ---
      var iv = null;
      function stopIv() { if (iv != null && clrIv) { clrIv(iv); iv = null; } }
      function landed() {
        stopIv();
        setStatus("Sent \u2713", "is-sent");
        clearNode(actions);
        var done = el(doc, "div", "mail-compose__done record__action", { role: "button", tabindex: "0", text: "\u2190 Inbox" });
        activate(done, function () { if (typeof opts.onCancel === "function") opts.onCancel(); });
        actions.appendChild(done);
        paintLaunch("landed");
        if (typeof opts.onSent === "function") opts.onSent(undoId, payload);
      }
      function paintCountdown() { setStatus("Sending in " + remaining + "s\u2026", "is-undo"); }
      clearNode(actions);
      setDisabled(true);           // hold the fields while the send is queued (Undo restores them)
      paintCountdown();
      var undoBtn = el(doc, "div", "mail-compose__undo-send record__action", { role: "button", tabindex: "0", text: "Undo", "aria-label": "Undo send" });
      activate(undoBtn, function () {
        stopIv();
        setStatus("Undoing\u2026", "is-pending");
        Promise.resolve(cancelFn(undoId)).then(function (cres) {
          if (cres && cres.cancelled) {
            // cancelled in time — restore the draft so the owner can edit and resend.
            setStatus("Send undone \u2014 back to your draft.", "");
            setDisabled(false);
            clearLaunch();
            renderActions();
          } else {
            // 409 / already dispatched — honest: too late, it went. Fall to the landed state.
            landed();
            setStatus("Already sent \u2014 too late to undo.", "is-sent");
          }
        }, function () { landed(); setStatus("Already sent \u2014 too late to undo.", "is-sent"); });
      });
      actions.appendChild(undoBtn);
      if (remaining <= 0) { landed(); return; }   // window already elapsed → it has landed
      if (setIv) {
        iv = setIv(function () {
          remaining -= 1;
          if (remaining <= 0) { landed(); } else { paintCountdown(); }
        }, 1000);
      }
    }
    // email-app Track B #18 — save the draft. Unlike Send, a draft needs NO recipient and NO
    // irreversibility confirm (nothing external leaves the mailbox — it is a not-yet-sent draft, and
    // the route has no delete/trash path, so a save can never destroy mail — K1). op:'save' with
    // currentDraftId present UPDATES the same draft; absent CREATES one and captures the new id so the
    // next save updates it. Honest failure: the status line carries the server's real reason.
    function doSaveDraft() {
      setStatus("Saving draft\u2026", "is-pending");
      var payload = {
        op: "save",
        to: String(toInput.value || "").trim(),
        subject: String(subjInput.value || ""),
        body: String(bodyInput.value || ""),
        account: account
      };
      var ccVal = String(ccInput.value || "").trim();
      if (ccVal) payload.cc = ccVal;   // only-when-present, mirrors send
      var bccVal = String(bccInput.value || "").trim();
      if (bccVal) payload.bcc = bccVal;   // only-when-present, Bcc preserved in the draft (mirrors cc)
      if (currentDraftId) payload.id = currentDraftId;   // update the same draft, never a duplicate
      Promise.resolve(draftFn(payload)).then(function (res) {
        if (res && res.ok) {
          if (res.id) currentDraftId = res.id;   // capture the id so a re-save UPDATES
          setStatus("Draft saved \u2713", "is-sent");
          if (typeof opts.onDraftSaved === "function") opts.onDraftSaved(res.id, payload);
        } else {
          setStatus((res && res.error) || "Draft not saved.", "is-error");
        }
      }, function () { setStatus("Draft not saved.", "is-error"); });
    }
    // The owner-gated setup act (leg 06 "build B"): when no gmail send-grant exists yet, the actions
    // show "Enable sending" instead of Send — the sibling of blessing the OAuth grant. Issuing it
    // fills effectiveGrant, so the very next Send uses the exact key checkWarrant selects on. Never a
    // fabricated "Sent": the compose refuses to send until the grant is real.
    function renderEnable(msg, cls) {
      clearNode(actions);
      setStatus(msg || "Sending isn\u2019t enabled for this mailbox yet.", cls || "");
      var enable = el(doc, "div", "mail-compose__enable record__action", { role: "button", tabindex: "0", text: "Enable sending" });
      var cancel = el(doc, "div", "mail-compose__cancel record__action record__action--quiet", { role: "button", tabindex: "0", text: "Cancel" });
      activate(cancel, function () { if (typeof opts.onCancel === "function") opts.onCancel(); });
      activate(enable, function () {
        clearNode(actions);
        setStatus("Enabling sending\u2026", "is-pending");
        Promise.resolve(typeof opts.onEnableSending === "function" ? opts.onEnableSending() : { ok: false, error: "sending setup isn\u2019t available here" })
          .then(function (res) {
            if (res && res.ok) {
              effectiveGrant = res.grant || effectiveGrant;
              canSend = true;
              setStatus("Sending enabled \u2713", "is-sent");
              renderActions();
            } else {
              renderEnable((res && res.error) || "Couldn\u2019t enable sending.", "is-error");
            }
          }, function () { renderEnable("Couldn\u2019t enable sending.", "is-error"); });
      });
      actions.appendChild(enable);
      actions.appendChild(cancel);
    }
    // --- the inline Signature editor (leg 15, #20) -------------------------------
    // In-context, never buried in settings (the app's standing ethos). A quiet expander
    // below the actions: reveal a field prefilled with the current signature + Save. Saving
    // persists it (localStorage / injected seam) and re-applies to THIS compose's trailing
    // sig block, so the change is felt immediately and every future compose inherits it.
    var sigWrap = el(doc, "div", "mail-compose__sig-wrap");
    var sigToggle = el(doc, "div", "mail-compose__sig record__action record__action--quiet", { role: "button", tabindex: "0", text: "Signature" });
    var sigPanel = el(doc, "div", "mail-compose__sig-panel");
    var sigOpen = false;
    function renderSigPanel() {
      clearNode(sigPanel);
      if (!sigOpen) return;
      var row = el(doc, "div", "mail-compose__field field");
      row.appendChild(el(doc, "label", "mail-compose__sig-label field__label", { text: "Your signature" }));
      var sigInput = el(doc, "textarea", "mail-compose__sig-input field__control", { rows: "3", "aria-label": "Email signature" });
      sigInput.value = sig || "";
      row.appendChild(sigInput);
      sigPanel.appendChild(row);
      var sigStatus = el(doc, "div", "mail-compose__sig-status", { role: "status", "aria-live": "polite" });
      sigPanel.appendChild(sigStatus);
      var save = el(doc, "div", "mail-compose__sig-save record__action", { role: "button", tabindex: "0", text: "Save signature" });
      activate(save, function () {
        var next = String(sigInput.value || "").replace(/\s+$/, "");
        saveSignature(next);
        // re-apply to the current body's trailing sig block (idempotent, user's body above untouched)
        if (injectSignature) bodyInput.value = applySigToBody(bodyInput.value, sig, next);
        sig = next;
        sigStatus.textContent = next ? "Signature saved \u2713" : "Signature cleared \u2713";
      });
      sigPanel.appendChild(save);
    }
    activate(sigToggle, function () { sigOpen = !sigOpen; renderSigPanel(); });
    sigWrap.appendChild(sigToggle);
    sigWrap.appendChild(sigPanel);
    view.appendChild(sigWrap);

    if (canSend) renderActions(); else renderEnable();
    return view;
  }

  /* ---- #27/#28 settings panel — the account-level settings the mail app owns:  *
   * Filters (rules), Send-as (aliases + the SERVER signature), Vacation (auto-    *
   * reply). A PURE builder (doc + settingsFn + hooks -> DOM), unit-tested like     *
   * composeView. The seam is makeSettingsFn (READS filter.list/sendAs.list/        *
   * vacation.get; WRITES filter.create/delete, sendAs.create/patch, vacation.update).*
   * K1 governs the whole panel: NO path here trashes MAIL. The filter create-form  *
   * offers ONLY archive/label/read/star — trash/delete/spam are absent from the UI *
   * BY CONSTRUCTION (defense-in-depth over the server-side no-auto-trash guard),    *
   * and filterActionShape never folds TRASH/SPAM. The server signature (the sendAs  *
   * `signature` field) is the account-level counterpart of the in-compose local    *
   * signature (#20) — edited here via sendAs.patch, never a mail-destroying path.   */

  // The create-form's action menu. NO trash/delete/spam value — a filter that
  // auto-destroys incoming mail cannot be built from this UI (the server rejects
  // it too; this is the client half of the same K1 guard).
  function filterActionOptions() {
    return [
      { value: "label",   label: "Apply a label" },
      { value: "archive", label: "Skip the inbox (archive)" },
      { value: "read",    label: "Mark as read" },
      { value: "star",    label: "Star it" }
    ];
  }
  // Fold an action value (+ a label id for 'label') into the Gmail filter action
  // shape. NEVER emits TRASH or SPAM: archive removes INBOX (not a delete), read
  // removes UNREAD, star/label add a non-destructive label id.
  function filterActionShape(value, labelId) {
    if (value === "archive") return { removeLabelIds: ["INBOX"] };
    if (value === "read")    return { removeLabelIds: ["UNREAD"] };
    if (value === "star")    return { addLabelIds: ["STARRED"] };
    if (value === "label")   return { addLabelIds: [labelId || ""] };
    return {};   // unknown -> empty (never a destructive default)
  }

  function buildSettingsPanel(doc, settingsFn, hooks) {
    hooks = hooks || {};
    var account = hooks.account || null;
    var onBack = typeof hooks.onBack === "function" ? hooks.onBack : function () {};

    // §6-b: mail composes onto the shared Forest Settings frame
    // (window.ForestShell.settingsFrame — panel/labeledRow/backAction/hostPersist).
    // The frame supplies the common BONES; mail keeps its FIELD SET (tabs, status,
    // .mbox export, the --check checkbox rows, the record__action buttons). Every
    // compose site is cold-safe: absent frame -> the exact pre-extract DOM, so a
    // mis-ordered/absent load renders identically (mail's el IS block.el, the same
    // atom the frame builds with, so composed and fallback are byte-identical).
    var SF = (typeof window !== "undefined" && window.ForestShell) ? window.ForestShell.settingsFrame : null;

    // mailRow — one cold-safe wrapper over the frame's labeledRow for mail's
    // label-then-control rows (a <div class=rowClass> with a real <label> element).
    // One fallback path (proven once by the composed-path spy test + the fallback
    // path proven by mail-renderer-settings-panel.test.js, which does not load the frame).
    function mailRow(rowClass, labelText, control, labelClass, labelAttrs) {
      if (SF && SF.labeledRow) {
        return SF.labeledRow(doc, {
          rowTag: "div", rowClass: rowClass,
          labelTag: "label", labelClass: labelClass || "field__label",
          labelAttrs: labelAttrs || null, label: labelText, control: control
        });
      }
      var w = el(doc, "div", rowClass);
      var la = { text: labelText };
      if (labelAttrs) for (var lk in labelAttrs) {
        if (Object.prototype.hasOwnProperty.call(labelAttrs, lk)) la[lk] = labelAttrs[lk];
      }
      w.appendChild(el(doc, "label", labelClass || "field__label", la));
      if (control) w.appendChild(control);
      return w;
    }

    // : the settings surface is a `record` (a raised paper card); each labeled
    // input is a `field`. mail-settings__* stays as behavior hooks.
    var panel = (SF && SF.panel)
      ? SF.panel(doc, {
          rootTag: "div", rootClass: "mail-settings record",
          titleTag: "h3", titleClass: "mail-settings__title record__title", title: "Settings"
        })
      : (function () {
          var n = el(doc, "div", "mail-settings record");
          n.appendChild(el(doc, "h3", "mail-settings__title record__title", { text: "Settings" }));
          return n;
        })();

    // tabs: [0] Filters (loads on mount), [1] Identity & away (lazy on click)
    var tabs = el(doc, "div", "mail-settings__tabs");
    var tabFilters = el(doc, "div", "mail-settings__tab mail-settings__tab--active", { role: "button", tabindex: "0", text: "Filters" });
    var tabIdentity = el(doc, "div", "mail-settings__tab", { role: "button", tabindex: "0", text: "Identity & away" });
    tabs.appendChild(tabFilters);
    tabs.appendChild(tabIdentity);
    panel.appendChild(tabs);

    // one shared status line (below the tabs, above the sub-view body) — every op
    // that fails writes the server's real reason here, never a fabricated success.
    var status = el(doc, "div", "mail-settings__status", { role: "status", "aria-live": "polite" });
    panel.appendChild(status);

    /* ---- D1 — EXPORT: THE WAY OUT ------------------------------------------------- *
     * C8: "It will never make leaving hard." Until this existed that was a WISH — the app
     * imported .mbox and had no export verb at all. This is the retraction of a lie, not a
     * feature, so it is NOT buried behind a tab: it sits on the face of the settings panel,
     * above the tabbed body, where the doors belong together. You imported through here; you
     * leave through here.
     *
     * NO CONFIRM DIALOG. Leaving is a right, not a request. The app does not get to ask you
     * whether you are sure, and it does not get to know that you asked.
     *
     * ⚠ THE GAP IS ON THE LABEL, NOT IN A FOOTNOTE. Attachment BYTES are not in the archive
     * (metadata is). Saying so on the control itself is the difference between a promise kept
     * and a download that quietly isn't everything. Flag, don't fake.
     * Cold-safe: no mailbox / no module / no onExport -> the section simply does not render
     * (never a dead control, never an always-empty one). */
    var xMailbox = hooks.mailbox || null;
    var xExport = (typeof window !== "undefined" && window.ForestShell) ? window.ForestShell.mailExport : null;
    if (xMailbox && xExport && typeof hooks.onExport === "function" && typeof xExport.count === "function") {
      var xN = xExport.count(xMailbox);
      if (xN > 0) {
        var xBox = el(doc, "div", "mail-settings__export field");
        xBox.appendChild(el(doc, "div", "mail-settings__export-title field__label", { text: "Your mail is yours" }));
        xBox.appendChild(el(doc, "p", "mail-settings__export-note", {
          text: "Download all " + xN + " message" + (xN === 1 ? "" : "s") + " as a .mbox archive \u2014 the same " +
                "format this app imports, and the one Thunderbird, Apple Mail and most clients read. " +
                "Every header comes with it. Attachment bytes do not (their filenames and sizes do)."
        }));
        var xBtn = el(doc, "button", "mail-settings__export-btn btn", {
          type: "button", text: "Export " + xN + " message" + (xN === 1 ? "" : "s") + " (.mbox)",
          "aria-label": "Export all your mail as a .mbox archive"
        });
        xBtn.addEventListener("click", function () {
          var r = hooks.onExport();
          // The host reports what actually happened. It never fabricates a success it did not get.
          if (r && r.ok) setStatus("Exported " + r.count + " message" + (r.count === 1 ? "" : "s") + " to " + r.filename + ".", false);
          else setStatus((r && r.error) || "Export failed \u2014 your mail was not changed.", true);
        });
        xBox.appendChild(xBtn);
        panel.appendChild(xBox);
      }
    }
    function setStatus(msg, isError) {
      status.textContent = msg || "";
      status.className = "mail-settings__status" + (isError ? " is-error" : (msg ? " is-ok" : ""));
    }

    var subBody = el(doc, "div", "mail-settings__body");
    panel.appendChild(subBody);

    // (v9 restructure) Row density moved OFF the command strip to here — it is a set-and-forget
    // DISPLAY preference, not a per-session filter. It lives as a persistent panel control (outside
    // the tab-swapped subBody, so it survives a tab switch). Changing it dispatches forest:density up
    // to the host to persist, exactly as the unread-count toggle dispatches forest:count-toggle; the
    // next mailbox build reads it back via opts.density. Cold-safe: no onDensityChange hook -> the
    // control still renders and reflects the choice, it simply does not persist (flag-don't-fake).
    var densitySel = el(doc, "select", "mail-settings__density field__control", { id: "mail-settings-density", "aria-label": "Row density" });
    [["comfortable", "Comfortable"], ["cozy", "Cozy"], ["compact", "Compact"]].forEach(function (o) {
      densitySel.appendChild(el(doc, "option", null, { value: o[0], text: o[1] }));
    });
    densitySel.value = (hooks.density === "cozy" || hooks.density === "compact") ? hooks.density : "comfortable";
    densitySel.addEventListener("change", function () {
      var v = densitySel.value || "comfortable";
      // §6-b: route the host persist through the frame's flag-don't-fake seam (byte-identical
      // behavior — calls the handler in a try/catch, no-ops when absent). Cold-safe inline.
      if (SF && SF.hostPersist) SF.hostPersist(hooks.onDensityChange, v);
      else if (typeof hooks.onDensityChange === "function") { try { hooks.onDensityChange(v); } catch (e) {} }
    });
    var displayWrap = mailRow(
      "mail-settings__display mail-settings__field field", "Row density", densitySel,
      "mail-settings__display-label field__label", { "for": "mail-settings-density" }
    );
    panel.appendChild(displayWrap);

    var back = (SF && SF.backAction)
      ? SF.backAction(doc, {
          className: "mail-settings__back record__action record__action--quiet",
          label: "\u2190 Inbox", onBack: onBack
        })
      : (function () {
          var b = el(doc, "div", "mail-settings__back record__action record__action--quiet", { role: "button", tabindex: "0", text: "\u2190 Inbox" });
          activate(b, function () { onBack(); });
          return b;
        })();
    panel.appendChild(back);

    function call(payload) { payload.account = account; return Promise.resolve(settingsFn(payload)); }

    /* ---------- Filters sub-view ---------- */
    function renderFilters() {
      clearNode(subBody);
      var wrap = el(doc, "div", "mail-settings__filters");

      // existing filters
      var listEl = el(doc, "ul", "mail-settings__filter-list", { role: "list" });
      wrap.appendChild(listEl);

      // create-form: a condition (from / subject) + a non-destructive action
      var form = el(doc, "div", "mail-settings__filter-form");
      form.appendChild(el(doc, "h4", "mail-settings__subtitle", { text: "New rule" }));
      var fromInput = el(doc, "input", "mail-settings__crit-from field__control", { type: "text", "aria-label": "Filter: from contains" });
      form.appendChild(mailRow("mail-settings__field field", "From contains", fromInput));
      var subjInput = el(doc, "input", "mail-settings__crit-subject field__control", { type: "text", "aria-label": "Filter: subject contains" });
      form.appendChild(mailRow("mail-settings__field field", "Subject contains", subjInput));

      var actSel = el(doc, "select", "mail-settings__action-select field__control", { "aria-label": "Filter action" });
      filterActionOptions().forEach(function (o) {
        var opt = el(doc, "option", "", { text: o.label });
        opt.value = o.value;
        actSel.appendChild(opt);
      });
      actSel.value = "label";
      form.appendChild(mailRow("mail-settings__field field", "Then", actSel));
      // label id, used only when the action is "Apply a label"
      var labelInput = el(doc, "input", "mail-settings__action-label field__control", { type: "text", "aria-label": "Label to apply" });
      form.appendChild(mailRow("mail-settings__field field", "Label", labelInput));

      var createBtn = el(doc, "div", "mail-settings__filter-create record__action", { role: "button", tabindex: "0", text: "Create rule" });
      activate(createBtn, function () {
        var criteria = {};
        var from = String(fromInput.value || "").trim();
        var subj = String(subjInput.value || "").trim();
        if (from) criteria.from = from;
        if (subj) criteria.subject = subj;
        // empty guard — a rule with no condition would match ALL mail; refuse locally.
        var hasCond = false; for (var k in criteria) { if (Object.prototype.hasOwnProperty.call(criteria, k)) { hasCond = true; break; } }
        if (!hasCond) { setStatus("Add at least one condition (from or subject) before creating a rule.", false); return; }
        var action = filterActionShape(actSel.value, String(labelInput.value || "").trim());
        setStatus("Creating rule\u2026", false);
        call({ op: "filter.create", criteria: criteria, action: action }).then(function (res) {
          if (!res || !res.ok) { setStatus((res && res.error) || "Couldn\u2019t create the rule.", true); return; }
          setStatus("Rule created \u2713", false);
          fromInput.value = ""; subjInput.value = ""; labelInput.value = "";
          loadFilters();
        }, function () { setStatus("Couldn\u2019t create the rule.", true); });
      });
      form.appendChild(createBtn);
      wrap.appendChild(form);
      subBody.appendChild(wrap);

      function loadFilters() {
        clearNode(listEl);
        call({ op: "filter.list" }).then(function (res) {
          if (!res || !res.ok) { setStatus((res && res.error) || "Couldn\u2019t load rules.", true); return; }
          var filters = res.filters || [];
          if (!filters.length) { listEl.appendChild(el(doc, "li", "mail-settings__filter-empty", { text: "No rules yet." })); return; }
          filters.forEach(function (f) {
            var li = el(doc, "li", "mail-settings__filter-item");
            var crit = f.criteria || {};
            var critText = [];
            if (crit.from) critText.push("From: " + crit.from);
            if (crit.to) critText.push("To: " + crit.to);
            if (crit.subject) critText.push("Subject: " + crit.subject);
            var act = f.action || {};
            var actText = [];
            if ((act.addLabelIds || []).length) actText.push("label " + act.addLabelIds.join(", "));
            if ((act.removeLabelIds || []).indexOf("INBOX") !== -1) actText.push("archive");
            if ((act.removeLabelIds || []).indexOf("UNREAD") !== -1) actText.push("mark read");
            li.appendChild(el(doc, "span", "mail-settings__filter-desc", { text: (critText.join(" \u00B7 ") || "(any)") + " \u2192 " + (actText.join(", ") || "(no action)") }));
            var del = el(doc, "div", "mail-settings__filter-delete record__action record__action--quiet", { role: "button", tabindex: "0", text: "Delete", "aria-label": "Delete this rule" });
            activate(del, function () {
              setStatus("Deleting rule\u2026", false);
              call({ op: "filter.delete", id: f.id }).then(function (r) {
                if (!r || !r.ok) { setStatus((r && r.error) || "Couldn\u2019t delete the rule.", true); return; }
                setStatus("Rule deleted \u2713", false);
                loadFilters();
              }, function () { setStatus("Couldn\u2019t delete the rule.", true); });
            });
            li.appendChild(del);
            listEl.appendChild(li);
          });
        }, function () { setStatus("Couldn\u2019t load rules.", true); });
      }
      loadFilters();
    }

    /* ---------- Identity & away sub-view (send-as aliases + server signature + vacation) ---------- */
    function renderIdentity() {
      clearNode(subBody);
      var wrap = el(doc, "div", "mail-settings__identity");

      // email-app undo-send Block 3 — Sending: the local Undo-window preference (cancel-after-send).
      // Purely LOCAL (localStorage, no backend call), so it renders and saves even with no send-grant.
      // The checkbox turns the reconsideration window on/off; the select picks its length {5,10,20,30}s.
      // Off (unchecked) stores 0, so the next compose sends immediately — byte-unchanged.
      wrap.appendChild(el(doc, "h4", "mail-settings__subtitle", { text: "Sending" }));
      var undoCur = readUndoWindow();
      var undoRow = el(doc, "div", "mail-settings__field field mail-settings__field--check");
      var undoCheck = el(doc, "input", "mail-settings__undo-enable", { type: "checkbox", "aria-label": "Give me a few seconds to undo after I send" });
      if (undoCur > 0) undoCheck.setAttribute("checked", "checked");
      undoCheck.checked = undoCur > 0;
      undoRow.appendChild(undoCheck);
      undoRow.appendChild(el(doc, "label", "field__label", { text: "Give me a few seconds to undo after I send" }));
      wrap.appendChild(undoRow);
      var undoSel = el(doc, "select", "mail-settings__undo-window field__control", { "aria-label": "Undo window length" });
      UNDO_WINDOWS.forEach(function (w) {
        var opt = el(doc, "option", "", { text: w + " seconds" });
        opt.value = String(w);
        undoSel.appendChild(opt);
      });
      undoSel.value = String(undoCur > 0 ? undoCur : 10);   // when turning on, default the picker to 10s
      wrap.appendChild(mailRow("mail-settings__field field", "Undo window", undoSel));
      function saveUndo() {
        var on = !!undoCheck.checked;
        var sec = on ? (parseInt(undoSel.value, 10) || 10) : 0;
        if (writeUndoWindow(sec)) setStatus(on ? ("Undo window set to " + sec + "s \u2713") : "Undo window off \u2713", false);
        else setStatus("Couldn\u2019t save the Undo setting.", true);
      }
      undoCheck.addEventListener("change", saveUndo);
      undoSel.addEventListener("change", function () { if (undoCheck.checked) saveUndo(); });

      // send-as / aliases (each with the SERVER signature — the account-level sig,
      // distinct from the in-compose local #20 signature)
      wrap.appendChild(el(doc, "h4", "mail-settings__subtitle", { text: "Send-as addresses" }));
      var sendasList = el(doc, "ul", "mail-settings__sendas-list", { role: "list" });
      wrap.appendChild(sendasList);

      // add-alias form
      var addWrap = el(doc, "div", "mail-settings__sendas-add");
      var aEmail = el(doc, "input", "mail-settings__alias-email field__control", { type: "text", "aria-label": "New alias email" });
      addWrap.appendChild(mailRow("mail-settings__field field", "Add alias (email)", aEmail));
      var aName = el(doc, "input", "mail-settings__alias-name field__control", { type: "text", "aria-label": "New alias display name" });
      addWrap.appendChild(mailRow("mail-settings__field field", "Display name", aName));
      var addBtn = el(doc, "div", "mail-settings__alias-add record__action", { role: "button", tabindex: "0", text: "Add alias" });
      activate(addBtn, function () {
        var email = String(aEmail.value || "").trim();
        if (!email) { setStatus("Enter an email address for the alias.", false); return; }
        setStatus("Adding alias\u2026", false);
        call({ op: "sendAs.create", sendAs: { sendAsEmail: email, displayName: String(aName.value || "").trim() } }).then(function (res) {
          if (!res || !res.ok) { setStatus((res && res.error) || "Couldn\u2019t add the alias.", true); return; }
          setStatus("Alias added \u2713", false);
          aEmail.value = ""; aName.value = "";
          loadSendAs();
        }, function () { setStatus("Couldn\u2019t add the alias.", true); });
      });
      addWrap.appendChild(addBtn);
      wrap.appendChild(addWrap);

      // vacation / auto-reply
      wrap.appendChild(el(doc, "h4", "mail-settings__subtitle", { text: "Vacation responder" }));
      var vacEnableRow = el(doc, "div", "mail-settings__field field mail-settings__field--check");
      var vacEnable = el(doc, "input", "mail-settings__vac-enable", { type: "checkbox", "aria-label": "Enable vacation auto-reply" });
      vacEnableRow.appendChild(vacEnable);
      vacEnableRow.appendChild(el(doc, "label", "field__label", { text: "Auto-reply while away" }));
      wrap.appendChild(vacEnableRow);
      var vacSubj = el(doc, "input", "mail-settings__vac-subject field__control", { type: "text", "aria-label": "Vacation subject" });
      wrap.appendChild(mailRow("mail-settings__field field", "Subject", vacSubj));
      var vacBody = el(doc, "textarea", "mail-settings__vac-body field__control", { rows: "3", "aria-label": "Vacation message" });
      wrap.appendChild(mailRow("mail-settings__field field", "Message", vacBody));
      var vacSave = el(doc, "div", "mail-settings__vac-save record__action", { role: "button", tabindex: "0", text: "Save auto-reply" });
      activate(vacSave, function () {
        setStatus("Saving auto-reply\u2026", false);
        call({ op: "vacation.update", vacation: {
          enableAutoReply: !!vacEnable.checked,
          responseSubject: String(vacSubj.value || ""),
          responseBodyPlainText: String(vacBody.value || "")
        } }).then(function (res) {
          if (!res || !res.ok) { setStatus((res && res.error) || "Couldn\u2019t save the auto-reply.", true); return; }
          setStatus("Auto-reply saved \u2713", false);
        }, function () { setStatus("Couldn\u2019t save the auto-reply.", true); });
      });
      wrap.appendChild(vacSave);
      subBody.appendChild(wrap);

      function loadSendAs() {
        clearNode(sendasList);
        call({ op: "sendAs.list" }).then(function (res) {
          if (!res || !res.ok) { setStatus((res && res.error) || "Couldn\u2019t load send-as addresses.", true); return; }
          var rows = res.sendAs || [];
          if (!rows.length) { sendasList.appendChild(el(doc, "li", "mail-settings__sendas-empty", { text: "No send-as addresses." })); return; }
          rows.forEach(function (sa) { sendasList.appendChild(sendAsRow(sa)); });
        }, function () { setStatus("Couldn\u2019t load send-as addresses.", true); });
      }

      // one send-as row: the address (+ primary badge) and an expander to edit its
      // display name and its SERVER signature (sendAs.patch). No delete affordance.
      function sendAsRow(sa) {
        var li = el(doc, "li", "mail-settings__sendas-item");
        var head = el(doc, "div", "mail-settings__sendas-head");
        head.appendChild(el(doc, "span", "mail-settings__sendas-email", { text: sa.sendAsEmail + (sa.isPrimary ? " (primary)" : "") }));
        var edit = el(doc, "div", "mail-settings__sendas-edit record__action record__action--quiet", { role: "button", tabindex: "0", text: "Edit" });
        head.appendChild(edit);
        li.appendChild(head);
        var editor = el(doc, "div", "mail-settings__sendas-editor");
        var open = false;
        function renderEditor() {
          clearNode(editor);
          if (!open) return;
          var nameInput = el(doc, "input", "mail-settings__sendas-name field__control", { type: "text", "aria-label": "Alias display name" });
          nameInput.value = sa.displayName || "";
          editor.appendChild(mailRow("mail-settings__field field", "Display name", nameInput));
          var sigInput = el(doc, "textarea", "mail-settings__sendas-signature field__control", { rows: "3", "aria-label": "Server signature for this address" });
          sigInput.value = sa.signature || "";
          editor.appendChild(mailRow("mail-settings__field field", "Signature (this address)", sigInput));
          var save = el(doc, "div", "mail-settings__sendas-save record__action", { role: "button", tabindex: "0", text: "Save" });
          activate(save, function () {
            setStatus("Saving address\u2026", false);
            call({ op: "sendAs.patch", email: sa.sendAsEmail, patch: { displayName: String(nameInput.value || ""), signature: String(sigInput.value || "") } }).then(function (res) {
              if (!res || !res.ok) { setStatus((res && res.error) || "Couldn\u2019t save the address.", true); return; }
              setStatus("Address saved \u2713", false);
              sa.displayName = String(nameInput.value || ""); sa.signature = String(sigInput.value || "");
            }, function () { setStatus("Couldn\u2019t save the address.", true); });
          });
          editor.appendChild(save);
        }
        activate(edit, function () { open = !open; renderEditor(); });
        li.appendChild(editor);
        return li;
      }

      loadSendAs();
      // vacation.get — prefill the responder form from the server
      call({ op: "vacation.get" }).then(function (res) {
        if (!res || !res.ok || !res.vacation) return;
        var v = res.vacation;
        vacEnable.checked = !!v.enableAutoReply;
        vacSubj.value = v.responseSubject || "";
        vacBody.value = v.responseBodyPlainText || v.responseBodyHtml || "";
      }, function () {});
    }

    function showTab(idx) {
      tabFilters.className = "mail-settings__tab" + (idx === 0 ? " mail-settings__tab--active" : "");
      tabIdentity.className = "mail-settings__tab" + (idx === 1 ? " mail-settings__tab--active" : "");
      setStatus("", false);
      if (idx === 1) renderIdentity(); else renderFilters();
    }
    activate(tabFilters, function () { showTab(0); });
    activate(tabIdentity, function () { showTab(1); });

    // Open to a requested tab (note #4: the dock's "Edit Undo Settings" routes to tab 1, where the
    // Sending / Undo-window controls live). Default: Filters, and filter.list fires on mount.
    if (hooks && hooks.initialTab === 1) showTab(1);
    else renderFilters();
    return panel;
  }

  /* ---- renderRail (email-app ①a) — the navigation rail region ---------------- *
   * A PURE builder (doc + slots -> DOM), so it unit-tests without the whole view.  *
   * `slots` is model.railModel(mailbox) — the system-folder slots with their       *
   * counts. The rail is JT-6's one new region; each `.rail__slot` is a `row`-kin    *
   * affordance that routes to a filter (opts.onSlot). Compose lives HERE, at the    *
   * TOP (`.rail__compose`, opts.onCompose) — seq=13 returned it to Gmail's          *
   * placement and retired the command-strip "New message" (one home). The           *
   * active slot wears `--active` + aria-current. The count rides a muted `chip`      *
   * unread pill — the app's "weight, never a red count" ethos), shown only when     *
   * non-zero so a rail at rest is not a wall of zeros; the slot label always shows  *
   * (the nav is stable-shaped). Honest by construction: the slots and counts come   *
   * straight from railModel, which only names folders the model can actually        *
   * filter — no Trash slot, no fabricated number.                                   */
  function renderRail(doc, slots, opts) {
    opts = opts || {};
    var nav = el(doc, "nav", "rail", { "aria-label": "Mailbox folders" });
    /* email-app seq=13 — Compose returns to the TOP of the left rail. Gmail got the
       PLACEMENT right: the primary action sits above the folders, always visible.
       The command-strip "New message" retires with this, so there is still exactly
       ONE compose home (the Δ4 one-affordance rule preserved — the home just moved).
       As the app's primary action it renders as a filled `--canopy` button (the
       structure colour used as a fill, not a new hue) — prominent by weight + place,
       per "weight marks the place," never a colour alarm. Read from opts.onCompose;
       absent it, no button (cold-safe — same contract as onSlot). */
    if (typeof opts.onCompose === "function") {
      var compose = el(doc, "div", "rail__compose", {
        role: "button", tabindex: "0", text: "Compose",
        "aria-label": "Compose a new message"
      });
      activate(compose, function () { opts.onCompose(); });
      nav.appendChild(compose);
    }
    // SL-2 — the app-scoped search sits in the rail, DIRECTLY under compose (the
    // calendar shape). renderRail builds the `.rail__search` HOST; mail hands in its own
    // persistent, wired search input (opts.searchEl) so the box's state, its ~2 dozen
    // `input.value` readers, and its keystroke listener all survive the rail's per-paint
    // repaint. A standalone caller (unit test, a frame with no search element) gets a plain
    // scoped input instead — so renderRail satisfies SL-2 on its own bytes either way.
    var railSearch = el(doc, "div", "rail__search");
    railSearch.appendChild(opts.searchEl || el(doc, "input", "rail__search-input field", {
      type: "search", placeholder: "Search mail\u2026", "aria-label": "Search this mailbox"
    }));
    nav.appendChild(railSearch);
    (slots || []).forEach(function (s) {
      var active = (opts.activeId === s.id);
      // Change-1: a slot may carry no honest count (the Drafts LAUNCHER — a live count would
      // need a fetch; a fabricated one is the flag-don't-fake lie). Only voice the count when
      // it is a real number; a count-less slot reads as its plain label.
      var hasCount = (typeof s.count === "number");
      var slot = el(doc, "div", "rail__slot" + (active ? " rail__slot--active" : ""), {
        role: "button", tabindex: "0", "data-slot": s.id,
        "aria-label": hasCount ? (s.label + ", " + s.count + " message" + (s.count === 1 ? "" : "s")) : s.label
      });
      if (active) slot.setAttribute("aria-current", "true");
      slot.appendChild(el(doc, "span", "rail__slot-label", { text: s.label }));
      // rail-count grain (seq=13 follow-on): the count chip follows the app's OPT-IN count
      // preference (opts.showCounts, OFF by default per §6.3 — Nyx's never-default), so
      // the rail at rest is calm (no numbers), coherent with the header count toggle. Shown only
      // when counts are ON *and* the slot is non-zero (still no wall of zeros when ON).
      if (opts.showCounts && s.count > 0) slot.appendChild(el(doc, "span", "rail__count chip", { text: String(s.count) }));
      if (typeof opts.onSlot === "function") activate(slot, function () { opts.onSlot(s); });
      nav.appendChild(slot);
    });
    return nav;
  }

  /* ---- the mailbox VIEW builder (pure: doc + mailbox -> DOM) ----------------- *
   * A single `mail__body` swap host holds either the list view (search + count +   *
   * list, built ONCE and cached) or a reading-pane detail. Clicking a row opens    *
   * the detail; Back re-shows the cached list view (search state intact — same     *
   * node, never rebuilt). The list is never left half-torn-down: swap = clear the  *
   * host, append the target. Search wiring is local to the built node (one code    *
   * path with the leg-1 model — no drift).                                         */
  function buildMailboxView(doc, mailbox, opts) {
    opts = opts || {};
    var wrap = el(doc, "div", "mail");
    var body = el(doc, "div", "mail__body");
    wrap.appendChild(body);
    var model = mm();
    // §3f — the OPT-IN unread count. OFF by default (§6.3, Nyx's never-default):
    // the resting surface shows no unread number, only a calm invite where it would sit
    // (SM-2). `countOn` is a closure bit toggled in-place; the preference is persisted by
    // the host via the forest:count-toggle event opts.onCountToggle dispatches.
    var countOn = !!opts.countEnabled;
    // leg 16 (#13) — the read-later controller: an injected {has,toggle,ids} (test/host seam)
    // or the module localStorage store. Always available (a local feature, no backend), so the
    // "Read-later only" view below is always offered; it simply shows an empty list until you've
    // saved any (honest — flag-don't-fake).
    var rl = (opts.readLater && typeof opts.readLater.has === "function")
      ? opts.readLater
      : { has: rlHas, toggle: rlToggle, ids: rlIds };

    // #8 slice ② — the whole-corpus "Search all Gmail" seam. In production makeSearchAllFn falls back
    // to the global fetch + runtimeBase (like makeModifyFn); tests inject opts._fetch. Cold-safe: with
    // no fetch, the affordance still renders but reports honestly offline on click (never a fake empty).
    var searchAllFn = makeSearchAllFn({ _fetch: opts._fetch });

    // email-app #24 L4 — the incremental REFRESH controller. runRefresh() POSTs /connectors/history;
    // a 'delta' outcome folds through model.applyMailDelta over the in-hand mailbox (cheap, no re-read)
    // and repaints; a 'full_read_required' (cold cursor / expired) OR a delta that carries genuinely-new
    // mail (needsFullRead) falls back to the existing full /export/soil re-read — never a silent stall,
    // never a fabricated row. refreshNote is a calm one-line status (honest on failure).
    var refreshFn = makeRefreshFn({ _fetch: opts._fetch });
    var fetchNewFn = makeFetchFn({ _fetch: opts._fetch });   // #24 follow-on: per-id hydrate for new mail
    var refreshBusy = false;
    var composeOpen = false;   // #24 follow-on #3: the background poll's pause-guard reads this (don't refresh mid-compose)
    function setRefreshNote(t) { if (refreshNote) refreshNote.textContent = t || ""; }
    function refreshSummary(a, addedCount) {
      var parts = [];
      var added = addedCount != null ? addedCount : 0;
      if (added) parts.push(added + " new");
      if (a.labeled) parts.push(a.labeled + " updated");
      if (a.deleted) parts.push(a.deleted + " removed");
      return parts.length ? ("Refreshed \u00b7 " + parts.join(", ")) : "Up to date";
    }
    function fullRefresh() {
      return readExport().then(function (o) {
        if (o && o.reach === "ok" && model && typeof model.mailboxFromExport === "function") {
          mailbox = model.mailboxFromExport(o.payload);
          paint(input.value);
          setRefreshNote("Refreshed");
        } else {
          setRefreshNote("Couldn\u2019t reach your mail just now");
        }
      });
    }
    function runRefresh() {
      if (refreshBusy) return;
      refreshBusy = true;
      if (refreshBtn) refreshBtn.setAttribute("aria-busy", "true");
      setRefreshNote("Refreshing\u2026");
      return refreshFn().then(function (res) {
        if (refreshBtn) refreshBtn.removeAttribute("aria-busy");
        refreshBusy = false;
        if (!res || !res.ok) {
          // THE KEYLESS CASE — not a refresh failure. The runtime restarted; the cookie
          // outlived the in-memory owner key, so the app still believes it is signed in while every
          // owner-keyed route is 401ing. The poll is the first thing to notice because it is the only
          // thing running unattended. Tell the Door, in plain words, instead of pasting the server's
          // sentence into a status line and going quiet.
          if (res && res.code === "E_NO_SESSION_KEY") {
            setRefreshNote("Signed out \u2014 sign in again to reconnect your mail.");
            if (typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof window.CustomEvent === "function") {
              window.dispatchEvent(new window.CustomEvent("forest:session-keyless", { bubbles: true }));
            }
            return;
          }
          setRefreshNote((res && res.error) || "Couldn\u2019t refresh");
          return;
        }
        if (res.decision === "delta" && model && typeof model.applyMailDelta === "function") {
          var applied = model.applyMailDelta(mailbox, res.records);
          var addedIds = (applied.applied && applied.applied.addedIds) || [];
          if (addedIds.length && typeof model.mailboxFromExport === "function") {
            // #24 follow-on: new mail -> try the CHEAP per-id hydrate; fall back to the full read on ANY
            // failure (never a fabricated row). The label/delete patches in applied.messages are already
            // real changes; the fetched rows merge onto them, deduped by unifyMailbox.
            return fetchNewFn(addedIds).then(function (fres) {
              if (!fres || !fres.ok || !Array.isArray(fres.rows)) return fullRefresh();
              var newMsgs = model.mailboxFromExport({ items: fres.rows });
              var base = applied.messages.concat(newMsgs);
              mailbox = (typeof model.unifyMailbox === "function") ? model.unifyMailbox(base) : base;
              paint(input.value);
              setRefreshNote(refreshSummary(applied.applied, fres.rows.length));
              return;
            }).catch(function () { return fullRefresh(); });
          }
          if (applied.needsFullRead) return fullRefresh();   // no hydrate seam / older model -> safe full path
          mailbox = applied.messages;
          paint(input.value);
          setRefreshNote(refreshSummary(applied.applied));
          return;
        }
        // full_read_required (no_cursor | expired) — or an older model without applyMailDelta
        return fullRefresh();
      }).catch(function () {
        if (refreshBtn) refreshBtn.removeAttribute("aria-busy");
        refreshBusy = false;
        setRefreshNote("Couldn\u2019t refresh");
      });
    }

    // email-app #24 follow-on #3 — the background POLL DRIVER. Reuses runRefresh() VERBATIM (adds no
    // network logic); it just calls it on a cadence so the mailbox stays fresh without a click. Two
    // properties keep the blast low: (1) VISIBILITY-GATED — the interval runs ONLY while the tab is
    // visible and stops the moment it's hidden, so a backgrounded tab spends zero Gmail quota; on
    // return-to-tab it fires one immediate catch-up refresh + resumes ticking. (2) PAUSE-AWARE — a tick
    // is SKIPPED (never a repaint mid-action) while the user is composing, has a bulk selection open,
    // or an undo window is live — "don't yank the rug." runRefresh's refreshBusy already makes
    // overlapping ticks safe; this guard is UX politeness, not correctness.
    // Cadence chosen AX (operator delegated the call,): on-visible + a gentle 3-min interval
    // while visible. Injectable for tests via opts._setInterval/_clearInterval/pollIntervalMs, and the
    // controls are handed to opts._exposePoll (the shim doc has no visibility API, so tests drive the
    // seam directly rather than through DOM events).
    var POLL_MS = (opts.pollIntervalMs != null) ? opts.pollIntervalMs : 180000;   // 3 min while visible
    var _setIv = (typeof opts._setInterval === "function") ? opts._setInterval
               : (typeof setInterval === "function" ? setInterval : null);
    var _clearIv = (typeof opts._clearInterval === "function") ? opts._clearInterval
                 : (typeof clearInterval === "function" ? clearInterval : null);
    var pollTimer = null;
    function pollVisible() {
      // default VISIBLE when the platform gives no signal (older/stub doc) — never silently go dark
      if (!doc || typeof doc.visibilityState === "undefined") return true;
      return doc.visibilityState !== "hidden";
    }
    function pollBlocked() {
      if (composeOpen) return true;                                         // typing a message
      if (typeof selCount === "function" && selCount() > 0) return true;    // a bulk selection is open
      if (typeof undoBar !== "undefined" && undoBar && undoBar.firstChild) return true;  // an undo window is live
      return false;
    }
    function pollTick() {
      if (pollBlocked()) return;   // skip this tick; catch the next one — never yank the rug
      runRefresh();                // refreshBusy guards overlap; no new network logic
    }
    function pollStart() {
      if (pollTimer != null || !_setIv || POLL_MS <= 0) return;
      pollTimer = _setIv(pollTick, POLL_MS);
    }
    function pollStop() {
      if (pollTimer == null) return;
      if (_clearIv) _clearIv(pollTimer);
      pollTimer = null;
    }
    function pollOnVisibility() {
      if (pollVisible()) { pollTick(); pollStart(); }   // back to the tab: immediate catch-up + resume ticking
      else { pollStop(); }                              // hidden: stop ticking (no background quota burn)
    }
    if (doc && typeof doc.addEventListener === "function") {
      doc.addEventListener("visibilitychange", pollOnVisibility);
    }
    // window focus is a belt-and-suspenders catch-up on browsers that fire focus but not visibilitychange
    var pollWin = (typeof window !== "undefined") ? window : (root && typeof root.addEventListener === "function" ? root : null);
    if (pollWin && typeof pollWin.addEventListener === "function") {
      pollWin.addEventListener("focus", pollOnVisibility);
    }
    if (pollVisible()) pollStart();   // mounted already-visible -> start the gentle interval
    if (typeof opts._exposePoll === "function") {
      // test seam: drive the driver directly (the shim doc has no visibility API / DOM events)
      opts._exposePoll({ tick: pollTick, onVisibility: pollOnVisibility, blocked: pollBlocked,
                         start: pollStart, stop: pollStop, hasTimer: function () { return pollTimer != null; } });
    }

    // --- email-app ①a — the navigation rail. §7.2: the rail MOVES HOME. It is no longer
    // a left region *beside the list inside the pane*; it is the frame's left column, and the
    // pane pool hands us that column's app-owned half as ctx.menuBody -> opts.menuBody. Test by
    // Removal (§1.2): delete the old.mail__rail-host and.rail survives intact — it only
    // ever needed a host, and the host was the frame's all along.
    //
    // A RELOCATION, NOT A REBUILD. renderRail() is untouched; repaintRail() below still clears and
    // repaints THIS host from railModel over the CURRENT mailbox on every mailbox change, filter
    // move, and density change — so the counts stay live and the active slot still tracks the
    // strip's Show/Label selects (same currentUnread/currentLabel: one filter path, one truth).
    // Only the host changed.
    //
    // FALLBACK (opts.menuBody === null — no [data-app-menu] in the frame; tests, or a frame that
    // dropped the column): the rail is built into a local host inside the pane instead. This is
    // not decoration. `.rail__compose` is mail's ONE compose home — the command-strip's "New
    // message" retired when Compose moved to the rail's top (block.css:1087, and :3100 below) —
    // so a rail that fails to render is a mailbox with NO WAY TO WRITE A MESSAGE. The frame going
    // missing may cost mail its column; it must never silently cost the user the primary action.
    var railInMenu = !!opts.menuBody;
    var railHost = opts.menuBody || el(doc, "div", "mail__rail-host");
    // --- the list view (search + count + list) — built once, cached, re-shown on Back ---
    var listView = el(doc, "div", "mail__list-view");

    // email-app #5 Two Rivers — the SC-3 UNIFIED all-clear. A quiet settle at the top of the
    // unified view IFF every river (source/account) merged into this mailbox is a VERIFIED
    // known-zero. The module reads NO mailbox (host-hands-state, mirroring the-clearing): the
    // HOST assembles the per-account (state,count) here and hands it in. Per account (m.source):
    //   state = "known"  IFF every message from that source carries a KNOWN read-state (m.unread
    //           is a boolean); ONE unknowable-read-state row (m.unread === null — an mbox archive
    //           / pre-leg block) makes the account "unreachable", so SC-3 stays SILENT rather than
    //           assert an all-clear it can't verify (no unified state-lie — Real-or-Made).
    //   count = # KNOWN-unread from that source (m.unread === true; unknown/read excluded).
    // renderAllClear returns null unless unifiedFire fires (>=1 account AND every account a
    // known-zero); an EMPTY mailbox is not an all-clear (the-clearing owns the empty inbox), so
    // this only appears when the unified view HAS mail and every river is read-to-zero. It is a
    // WHOLE-mailbox property (like the unread count) — computed once from the full mailbox, it does
    // not chase the search/filter narrowing. Cold-safe: no twoRivers module -> nothing rendered.
    function perAccountStates(messages) {
      var by = Object.create(null), order = [];
      var src = Array.isArray(messages) ? messages : [];
      for (var i = 0; i < src.length; i++) {
        var m = src[i]; if (!m || typeof m !== "object") continue;
        var s = (m.source != null && m.source !== "") ? String(m.source) : "(unbound)";
        if (!by[s]) { by[s] = { source: s, count: 0, known: true }; order.push(s); }
        if (m.unread === null || m.unread === undefined) by[s].known = false;   // unknowable read-state
        else if (m.unread === true) by[s].count += 1;                           // KNOWN unread
      }
      return order.map(function (k) {
        var a = by[k];
        return { source: a.source, state: a.known ? "known" : "unreachable", count: a.count };
      });
    }
    var twoRivers = root.twoRivers;
    if (twoRivers && typeof twoRivers.renderAllClear === "function") {
      var allClearNode = twoRivers.renderAllClear(doc, perAccountStates(mailbox));  // null unless every river known-zero
      if (allClearNode) listView.appendChild(allClearNode);   // top of the unified view, above the strip
    }

    // the search / sort / filter band is a `strip` in the Block Alphabet — a few wide
    // affordances, not a dense toolbar (§4). mail__* classes stay as behavior hooks.
    var searchWrap = el(doc, "div", "mail__search strip");
    var input = el(doc, "input", "mail__search-input strip__search", {
      type: "search", placeholder: "Search your mail\u2026", "aria-label": "Search your mail"
    });
    // email-app #8 slice ③ — surface the model's Gmail-operator grammar as an honest hint. The
    // operator list is READ FROM the model (M.SEARCH_OPERATORS), never hardcoded here, so the hint
    // can never claim an operator the model doesn't actually support (flag-don't-fake at the UI seam).
    // A title tooltip, not a placeholder rewrite: the resting placeholder stays plain; the grammar is
    // discoverable on hover / for AT without cluttering the at-rest field. Cold-safe: no operator
    // list (an older model) -> no title, plain search unchanged.
    var searchOps = (model && Object.prototype.toString.call(model.SEARCH_OPERATORS) === "[object Array]")
      ? model.SEARCH_OPERATORS : [];
    if (searchOps.length) {
      input.setAttribute("title",
        "Search operators: " + searchOps.map(function (o) { return o + ":"; }).join(" ") +
        " \u00b7 also \"quoted phrases\" and -negation");
    }
    // email-app /SL-2 — the "Search your mail" box is RETIRED from the strip: the
    // app-scoped search now lives in the LEFT RAIL under Compose (renderRail, .rail__search),
    // one home, the calendar shape. The `input` element is still BUILT here (its ~2 dozen
    // readers + its keystroke listener are wired in this closure) and HOSTED into the rail by
    // repaintRail (opts.searchEl); it is no longer appended to the strip. The strip keeps its
    // utility band (Drafts, Settings, refresh, sort, filters).
    // email-app seq=13 — the command-strip "New message" (.mail__compose-btn strip__action)
    // RETIRED: Compose moved to the TOP of the left rail (renderRail, .rail__compose), Gmail's
    // placement. One compose home, not two. The strip keeps the utility actions below.
    // email-app Track B #18 — the Drafts affordance: opens the saved-drafts panel (list -> resume).
    // Sits in the strip. Reads /intent/draft {op:'list'} (read-only); a click resumes
    // a draft into compose (openDrafts -> get -> parse via the model's ONE parser -> openCompose).
    var draftsBtn = el(doc, "div", "mail__drafts-btn strip__action", { role: "button", tabindex: "0", text: "Drafts", "aria-label": "View your saved drafts" });
    activate(draftsBtn, function () { openDrafts(); });
    searchWrap.appendChild(draftsBtn);
    // email-app #27/#28 — the Settings affordance: opens the settings panel (Filters +
    // Send-as/aliases/server-signature + Vacation). Sits in the strip beside Drafts. Reads
    // filter.list on open; every write goes through the non-gated /intent/settings seam.
    var settingsBtn = el(doc, "div", "mail__settings-btn strip__action", { role: "button", tabindex: "0", text: "Settings", "aria-label": "Mail settings \u2014 rules, aliases, and auto-reply" });
    activate(settingsBtn, function () { openSettings(); });
    searchWrap.appendChild(settingsBtn);
    // email-app #24 L4 — the Refresh affordance: an explicit, manual incremental refresh (no timers,
    // no per-keystroke network — lower blast; a background poll is a clean follow-on). Sits in the strip
    // with the other utility actions. runRefresh() does the delta-or-full-read dance; refreshNote reports the outcome.
    var refreshBtn = el(doc, "div", "mail__refresh strip__action", { role: "button", tabindex: "0", text: "Refresh", "aria-label": "Refresh your mail \u2014 fetch what changed since the last sync" });
    activate(refreshBtn, function () { runRefresh(); });
    searchWrap.appendChild(refreshBtn);
    var refreshNote = el(doc, "span", "mail__refresh-note", { "aria-live": "polite" });
    searchWrap.appendChild(refreshNote);
    // #8 slice ② — the whole-corpus reach. The strip already filters the LOADED mail instantly
    // (slice ③); this button reaches ALL of Gmail via the owner-gated server search, on an explicit
    // click (never a network call per keystroke). Hidden until a query is typed; results land in a
    // "From all your mail" section below the local list, deduped against what's already loaded.
    var searchAllBtn = el(doc, "div", "mail__search-all strip__action", {
      role: "button", tabindex: "0", text: "Search all Gmail",
      "aria-label": "Search all of your Gmail, not just the loaded mailbox"
    });
    // NOT appended here — paint() appends it into the strip only while a query is present, and
    // removes it when the box is cleared (portable show/hide: attach/detach, not a CSS-fragile
    // [hidden] toggle on a strip action).

    // leg 09 — client-only inbox sort (newest / oldest / sender A-Z). Applies AFTER search, over the
    // mailbox already in hand: no network, no re-consent, no ingest change. The order lives in this
    // closure so the keystroke and archive-splice re-paints keep it without threading a param.
    var currentOrder = "newest";
    var sortWrap = el(doc, "div", "mail__sort strip__field");
    sortWrap.appendChild(el(doc, "label", "mail__sort-label strip__field-label", { "for": "mail-sort", text: "Sort" }));
    var sortSelect = el(doc, "select", "mail__sort-select strip__select", { id: "mail-sort", "aria-label": "Sort messages" });
    [["newest", "Newest first"], ["oldest", "Oldest first"], ["sender", "Sender A\u2013Z"]].forEach(function (o) {
      sortSelect.appendChild(el(doc, "option", null, { value: o[0], text: o[1] }));
    });
    sortSelect.value = currentOrder;
    sortWrap.appendChild(sortSelect);
    searchWrap.appendChild(sortWrap);

    // (v9 · command-surface restructure — "few wide affordances") the collapsed command
    // surface. Sort stays inline (above); Show/Label/From/Saved/Group fold into ONE "Filters"
    // toggle that opens a calm expanding PANEL (not a popover — no z-index, keyboard-trivial);
    // active facets show once as removable chips in a unified row below. The toggle + panel +
    // chip-row are built HERE; the collapsible fields append into `filtersPanel` (not searchWrap)
    // as they are constructed; the panel + chip-row append to the strip at the end of assembly.
    var filtersPanel = el(doc, "div", "mail__filters-panel", { id: "mail-filters-panel", role: "group", "aria-label": "Filters" });
    filtersPanel.setAttribute("hidden", "hidden");                 // collapsed at rest
    var activeFiltersRow = el(doc, "div", "mail__active-filters"); // the unified removable-chip row
    var filtersToggle = el(doc, "div", "mail__filters-btn strip__toggle", {
      role: "button", tabindex: "0", "aria-expanded": "false", "aria-controls": "mail-filters-panel",
      "aria-label": "Filters \u2014 read state, labels, senders, and grouping"
    });
    filtersToggle.appendChild(el(doc, "span", "strip__toggle-text", { text: "Filters" }));
    var filtersCount = el(doc, "span", "strip__toggle-count", { "aria-hidden": "true" });   // active-facet count; hidden at 0
    filtersToggle.appendChild(filtersCount);
    filtersToggle.appendChild(el(doc, "span", "strip__toggle-caret", { text: "\u25be", "aria-hidden": "true" }));   // ▾
    var filtersOpen = false;
    function toggleFilters(force) {
      filtersOpen = (force == null) ? !filtersOpen : !!force;
      if (filtersOpen) filtersPanel.removeAttribute("hidden"); else filtersPanel.setAttribute("hidden", "hidden");
      filtersToggle.setAttribute("aria-expanded", filtersOpen ? "true" : "false");
    }
    filtersToggle.addEventListener("click", function () { toggleFilters(); });
    filtersToggle.addEventListener("keydown", function (ev) {
      if (ev && (ev.key === "Enter" || ev.key === " ")) { if (ev.preventDefault) ev.preventDefault(); toggleFilters(); }
    });
    searchWrap.appendChild(filtersToggle);

    // leg 10 — unread filter + label picker (the ingest slice made visible). Both apply AFTER search
    // and BEFORE sort, over the mailbox already in hand: no network, no re-consent. They live in this
    // closure (like currentOrder) so the keystroke / sort / archive-splice re-paints keep them. Both
    // are <select>s (same shim path as sort). "unread" narrows to KNOWN-unread only (mbox rows, whose
    // read-state is unknown, are excluded — flag-don't-fake, honoring the model). The label options are
    // the labels PRESENT in this mailbox (UNREAD excluded — the unread select owns it); the picker is
    // hidden when the mailbox carries no label state (an mbox-only inbox), so it never shows an empty control.
    var currentUnread = false, currentLabel = "", currentReadLater = false, currentSpam = false, currentTrash = false, currentFroms = [], currentLabels = [], currentSnoozed = false, currentHasAttachment = false, currentType = "", currentDeclined = false, currentScreening = false, currentDeniedSenders = false;   // T5: the two screen views
    // #10 — the SPAM view (email-views line). The module owns the SPAM-label semantic;
    // this region only OFFERS the view-word and delegates the filter to it (one seam in
    // paint()). Offered only when there is spam to show (honest — no always-empty view);
    // cold-safe when the module is absent (the option simply never appears).
    var spamView = root.mailSpamView;
    var offerSpam = !!(spamView && typeof spamView.count === "function" && spamView.count(mailbox) > 0);
    // #29 — the TRASH view (the trash line), the exact sibling of Spam. The module owns the
    // TRASH-label semantic; this region OFFERS the "Trash" view-word and delegates the filter to
    // it (one seam in paint()). Offered only when there is trash in hand (honest — no always-empty
    // view; Gmail's default fetch excludes TRASH, so this populates from an mbox import carrying
    // TRASH or a future in:trash fetch). Cold-safe when the module is absent (the option never appears).
    var trashView = root.mailTrashView;
    var offerTrash = !!(trashView && typeof trashView.count === "function" && trashView.count(mailbox) > 0);
    // #22a — the HAS-ATTACHMENT view-word (filter-chips). ONE seam: delegate the narrowing to the
    // module (host hands it the list in hand; it returns the attachment-bearing subset). Offered as a
    // view-word (like Spam / Snoozed) only when at least one message in the mailbox actually carries a
    // downloadable attachment — honest, no always-empty control. Cold-safe when the module is absent
    // (the option never appears). READ-ONLY on the model (the filter reads m.attachments only).
    var attachmentFilter = root.mailAttachmentFilter;
    var offerAttachments = !!(attachmentFilter && typeof attachmentFilter.count === "function" && attachmentFilter.count(mailbox) > 0);
    // T3 — the TYPE view-words (letter / notification / unclassified). ONE seam: delegate the
    // narrowing to the module (host hands it the list in hand; it returns the subset of that kind).
    // READ-ONLY, and deliberately so: this is the classifier shipped as an OBSERVATION, not an
    // action. `decline` and `decay` are NOT wired here and must not be until the classification has
    // been watched on real mail. The module's `decayable()` is the sole future gate for destruction
    // and nothing in this region touches it.
    // The present-gate is `isMixed` (a STRICTER rule than the siblings' count>0, on purpose): the
    // split is only OFFERED when the mailbox actually contains both a letter and a notification —
    // a "Letters" chip over an all-letters mailbox is an always-FULL control that does nothing.
    // "Unclassified" is offered separately whenever anything is genuinely unclassifiable — the
    // honest third value must be reachable, never silently folded into the other two.
    // Cold-safe when the module is absent (the options simply never appear).
    var mailType = root.mailType;
    var offerType = !!(mailType && typeof mailType.isMixed === "function" && mailType.isMixed(mailbox));
    var offerUnknownType = !!(mailType && typeof mailType.count === "function" && mailType.count(mailbox, "unknown") > 0);
    // T1 — DECLINE (the Thing-list line). The module owns the terminal-decision semantic; this
    // region OFFERS the "Declined" view-word and delegates hide/only to it (one seam in paint()).
    // Offered only when something is actually declined (honest — no always-empty view), and the
    // count is the PRESENT-GATE only: never a badge, never a score (C5 — "count AT you" is the
    // rule the preposition carries). Cold-safe when the module is absent (the option never
    // appears, and the row affordance never grows).
    var declineStore = opts.decline || root.mailDecline || null;
    var offerDeclined = !!(declineStore && typeof declineStore.count === "function" && declineStore.count(mailbox) > 0);
    // T5 — THE SCREEN (the Thing-list line). The first LETTER from a sender he has never written to
    // does not appear in the inbox; it waits in one view and he says yes or no ONCE, ABOUT THE PERSON,
    // FOREVER. The module owns the whole semantic (verdict / hide / only / denied / resolve); this
    // region OFFERS the view-words, hands the module the list, and drains the lookup off the paint path.
    //
    // ⚠ SCREEN IS A PRECONDITION, NOT AN OVERLAY — and that is the load-bearing sentence of the wire.
    // snooze / decline / spam / type are endofunctions on ONE message list, so they compose in a stack.
    // Screen is a predicate on SENDERS, which touches messages only by pullback along sender. It does
    // NOT go in the paint() overlay stack — it runs AHEAD of it and OUTSIDE it, on `mailbox` itself,
    // before search even sees the list. An unscreened sender's mail was never IN the inbox to be
    // snoozed, declined, or searched. (Tamar, RCR R1: the third-overlay ordering question dissolves.)
    //
    // TWO view-words, not one, and the second one is not decoration:
    //   Screening  — the UNDECIDED letters, waiting on him.
    //   Denied     — the RECORD, and the ONLY surface where `unscreen` is reachable. Without it,
    //                deny is irreversible in practice and C1 is a lie (Renata's settled call).
    // Both present-gated (offered only when non-empty — no always-empty control, C5/C6: no count,
    // no badge). Cold-safe when the module is absent: the options never appear and paint() no-ops.
    var screenStore = (opts.screen !== undefined) ? opts.screen : (root.mailScreen || null);
    var offerScreening = !!(screenStore && typeof screenStore.count === "function" && screenStore.count(mailbox) > 0);
    var offerDeniedSenders = !!(screenStore && typeof screenStore.denied === "function" && screenStore.denied(mailbox).length > 0);
    // #22b — the FROM-sender filter (email-views line). The module owns the sender-key
    // semantic (== _groupSender's key); this region OFFERS a "From" picker (the senders
    // PRESENT in this mailbox) and delegates the narrowing to it (one seam in paint()).
    // Offered only when a sender is present (honest — no empty control); cold-safe when
    // the module is absent (the picker simply never appears). READ-ONLY on the model.
    var fromChips = root.mailFromChips;
    var presentSenders = (fromChips && typeof fromChips.sendersOf === "function") ? fromChips.sendersOf(mailbox) : [];
    // #12 — SNOOZE / re-surface (email-views line, the calm form). The module owns the
    // local {id->resurfaceAt} store + the hide/only/count overlays; this region only OFFERS
    // the "Snoozed" view-word and delegates hide/only to it (one seam in paint()). Offered
    // only when something is actively snoozed (honest — no always-empty view); cold-safe when
    // the module is absent (the option simply never appears). READ-ONLY on the model. `snoozeNow`
    // is opts.now when provided (deterministic in tests), else the wall clock — the same idiom
    // as groupNow. dueClear runs in paint() to auto-resurface due items SILENTLY (no badge).
    var snoozeStore = opts.snooze || root.mailSnooze || null;
    var snoozeNow = (opts.now != null) ? opts.now : Date.now();
    var offerSnoozed = !!(snoozeStore && typeof snoozeStore.count === "function" && snoozeStore.count(mailbox, snoozeNow) > 0);
    var unreadWrap = el(doc, "div", "mail__unread strip__field");
    unreadWrap.appendChild(el(doc, "label", "mail__unread-label strip__field-label", { "for": "mail-unread", text: "Show" }));
    var unreadSelect = el(doc, "select", "mail__unread-select strip__select", { id: "mail-unread", "aria-label": "Filter by read state" });
    var showOpts = [["", "All mail"], ["unread", "Unread only"], ["readlater", "Read-later only"]];
    if (offerSpam) showOpts.push(["spam", "Spam"]);   // #10: the SPAM view-word, only when spam is present
    if (offerTrash) showOpts.push(["trash", "Trash"]);   // #29: the TRASH view-word, only when trash is in hand
    if (offerAttachments) showOpts.push(["attachments", "Has attachment"]);   // #22a: only when an attachment is present
    if (offerType) showOpts.push(["letter", "Letters"]);   // T3: only when the mailbox is genuinely MIXED
    if (offerType) showOpts.push(["notification", "Notifications"]);   // T3: the sender's own declaration
    if (offerUnknownType) showOpts.push(["unclassified", "Unclassified"]);   // T3: the honest third value, never hidden
    if (offerSnoozed) showOpts.push(["snoozed", "Snoozed"]);   // #12: the SNOOZED view-word, only when something is snoozed
    if (offerDeclined) showOpts.push(["declined", "Declined"]);   // T1: the DECLINED view-word — a RECORD of decisions, not a to-do list
    // T5: the two SCREEN view-words. ⚠ "Screening" and "Denied senders" are deliberately worded to
    // sit apart from T1's "Declined" — the words are one letter apart and the SCOPES are not:
    // Declined is a MESSAGE you answered no to; Denied is a PERSON you answered no to. Both names
    // are in pencil (§7.1 — the Christening owns them, not this wire).
    if (offerScreening) showOpts.push(["screening", "Screening"]);          // T5: the undecided letters — waiting on HIM
    if (offerDeniedSenders) showOpts.push(["denied-senders", "Denied senders"]);   // T5: the record — and the only route back
    showOpts.forEach(function (o) {
      unreadSelect.appendChild(el(doc, "option", null, { value: o[0], text: o[1] }));
    });
    unreadSelect.value = "";
    unreadWrap.appendChild(unreadSelect);
    filtersPanel.appendChild(unreadWrap);            // (v9) Show collapses into the Filters panel

    var presentLabels = (model && typeof model.labelsOf === "function") ? model.labelsOf(mailbox) : [];
    var pickable = presentLabels.filter(function (l) { return l !== "UNREAD"; });
    // Label filter (chip upgrade, email-views) — the picker ADDS a label to an active SET
    // (a chip apiece, × to remove one); "All labels" clears the set; the list shows mail
    // carrying ANY selected label (UNION), a client overlay read-only on the model. The rail's
    // primary-view state (currentLabel, model-side) is untouched — this composes on top of it.
    var labelChips = root.mailLabelChips;
    var labelSelect = el(doc, "select", "mail__label-select strip__select", { id: "mail-label", "aria-label": "Filter by label" });
    labelSelect.appendChild(el(doc, "option", null, { value: "", text: "All labels" }));
    pickable.forEach(function (l) { labelSelect.appendChild(el(doc, "option", null, { value: l, text: l })); });
    labelSelect.value = "";
    if (pickable.length > 0) {                       // hide the picker entirely on a label-less (mbox-only) mailbox
      var labelWrap = el(doc, "div", "mail__label strip__field");
      labelWrap.appendChild(el(doc, "label", "mail__label-label strip__field-label", { "for": "mail-label", text: "Label" }));
      labelWrap.appendChild(labelSelect);
      filtersPanel.appendChild(labelWrap);           // (v9) Label collapses into the Filters panel;
    }                                                //      active label chips render in the unified row (paintActiveFilters)

    // #22b — the FROM picker (email-views). Mirrors the Label picker exactly: options are the
    // senders PRESENT in this mailbox (from the module, == the "By sender" grouping key), the
    // picker is hidden entirely when the mailbox carries no sender (an empty mailbox), so it
    // never shows an empty control. The option value + text are the raw From key (consistent
    // with the group view); a future slice may prettify the display without moving the key.
    var fromSelect = el(doc, "select", "mail__from-select strip__select", { id: "mail-from", "aria-label": "Filter by sender" });
    fromSelect.appendChild(el(doc, "option", null, { value: "", text: "All senders" }));
    presentSenders.forEach(function (s) { fromSelect.appendChild(el(doc, "option", null, { value: s, text: s })); });
    fromSelect.value = "";
    // the removable-chip upgrade over the one-pick #22b: the From picker now ADDS a sender
    // to an active SET (a chip apiece, × to remove one); "All senders" clears the whole set;
    // the list shows mail from ANY selected sender (union). Still read-only on the model — the
    // module owns the key + the union filter, this region owns the strip UI + the chip slot.
    if (presentSenders.length > 0) {                 // hide the picker on a senderless (empty) mailbox
      var fromWrap = el(doc, "div", "mail__from strip__field");
      fromWrap.appendChild(el(doc, "label", "mail__from-label strip__field-label", { "for": "mail-from", text: "From" }));
      fromWrap.appendChild(fromSelect);
      filtersPanel.appendChild(fromWrap);            // (v9) From collapses into the Filters panel;
    }                                                //      active sender chips render in the unified row (paintActiveFilters)

    // #21 — SAVED SEARCHES (email-views). The module owns the persistence; this region
    // wires a "Save search" button (persist the current query) + a present-gated "Saved"
    // picker (re-apply one — just sets the search box value + repaints; the model's
    // searchQuery does the matching). READ-ONLY on the model. The picker attaches on the
    // FIRST save so it is usable within one session (present-gate: no empty Saved control).
    // Cold-safe: no store module -> neither control appears. Injectable via opts.savedSearches.
    var savedStore = opts.savedSearches || root.mailSavedSearches || null;
    if (savedStore && typeof savedStore.names === "function") {
      var savedSelect = el(doc, "select", "mail__saved-select strip__select", { id: "mail-saved", "aria-label": "Apply a saved search" });
      var savedWrap = el(doc, "div", "mail__saved strip__field");
      savedWrap.appendChild(el(doc, "label", "mail__saved-label strip__field-label", { "for": "mail-saved", text: "Saved" }));
      savedWrap.appendChild(savedSelect);
      var savedAttached = false;
      var refreshSaved = function () {
        clearNode(savedSelect);
        savedSelect.appendChild(el(doc, "option", null, { value: "", text: "Saved searches\u2026" }));
        var names = savedStore.names() || [];
        names.forEach(function (n) { savedSelect.appendChild(el(doc, "option", null, { value: n, text: n })); });
        savedSelect.value = "";
        if (names.length > 0 && !savedAttached) { filtersPanel.appendChild(savedWrap); savedAttached = true; }   // (v9) into the Filters panel
        else if (names.length === 0 && savedAttached) { filtersPanel.removeChild(savedWrap); savedAttached = false; }
      };
      refreshSaved();   // present-gate: the Saved picker attaches only when ≥1 saved search exists
      // apply a saved search: set the box value + repaint (the model does the matching), then reset.
      savedSelect.addEventListener("change", function () {
        var n = savedSelect.value;
        if (!n) return;
        var q = savedStore.get(n);
        if (q != null) { input.value = q; paint(input.value); }
        savedSelect.value = "";
      });
      // the Save button — always present (the app's div[role=button] idiom). Saves the current
      // non-empty query under its own text (V1: the query is its own name), then refreshes the picker.
      var saveBtn = el(doc, "div", "mail__save-btn strip__field", { role: "button", tabindex: "0", text: "Save search", "aria-label": "Save the current search" });
      var doSave = function () {
        var q = String(input.value || "").trim();
        if (!q) return;                 // nothing to save (honest — no empty saved search)
        savedStore.save(q, q);
        refreshSaved();
      };
      saveBtn.addEventListener("click", doSave);
      saveBtn.addEventListener("keydown", function (ev) { if (ev && (ev.key === "Enter" || ev.key === " ")) doSave(); });
      filtersPanel.appendChild(saveBtn);             // (v9) into the Filters panel
    }

    // email-app #2/#3/#4 — the clustering views ("Group"). A pure client-side grouping fold over
    // the mailbox in hand (no scope, no model change); view-words operator-ratified. Lives
    // in the closure like currentOrder so keystroke / sort / filter re-paints keep it. Default None
    // (the flat resting list). `groupNow` is opts.now when provided (deterministic date buckets in
    // tests), else the wall clock.
    var currentGroup = "";
    var groupNow = (opts.now != null) ? opts.now : Date.now();
    // leg 15 — conversation expand-state: which threads are open, keyed by real threadId.
    // CLIENT state only (no re-fetch, no model call, NO browser storage — the shell idiom);
    // it lives in the closure like currentGroup, so a re-paint (toggle / sort / filter) keeps it.
    // Only count>1 records carry a real threadId, so a null key never lands here.
    var threadExpanded = {};
    var groupWrap = el(doc, "div", "mail__group strip__field");
    groupWrap.appendChild(el(doc, "label", "mail__group-label strip__field-label", { "for": "mail-group", text: "Group" }));
    var groupSelect = el(doc, "select", "mail__group-select strip__select", { id: "mail-group", "aria-label": "Group messages" });
    // leg 15 — "Conversation" is a DIFFERENT kind of fold than date/sender/category:
    // those are LABELED SECTIONS (groupMailbox), this is COLLAPSE-TO-ONE-ROW over
    // model.groupByThread. It is mutually exclusive with the sectioned views (one
    // grouping axis at a time, Gmail's own model); paint() branches on "thread".
    [["", "None"], ["thread", "Conversation"], ["date", "By date"], ["sender", "By sender"], ["category", "By category"]].forEach(function (o) {
      groupSelect.appendChild(el(doc, "option", null, { value: o[0], text: o[1] }));
    });
    groupSelect.value = "";
    groupWrap.appendChild(groupSelect);
    filtersPanel.appendChild(groupWrap);             // (v9) Group collapses into the Filters panel

    // ①b — density: a calm row-rhythm control. CSS-only — it only swaps a `.view--density-*`
    // modifier on the list; no layout JS, no data change (JT-1: a BEM modifier, not a token).
    // Comfortable is the resting default (the grove's unhurried spacing); Cozy/Compact tighten
    // the row padding for denser triage. The setting lives in the closure like currentGroup.
    // ①b — density swaps a `.view--density-*` modifier on the list (no layout JS, no data change).
    // (v9 restructure) Density is NO LONGER a command-strip control — it moved to Settings (a
    // set-and-forget display preference, not a per-session filter). buildMailboxView now READS the
    // persisted choice via opts.density (default comfortable), exactly as it reads opts.countEnabled;
    // the Settings surface writes it back via forest:density (host-persisted, like forest:count-toggle).
    var currentDensity = (opts.density === "cozy" || opts.density === "compact") ? opts.density : "comfortable";
    function applyDensity() { list.className = "mail-list view__list view--density-" + currentDensity; }

    // (v9 restructure) the collapsed command surface, assembled last: the Filters PANEL (holding the
    // Show/Label/From/Saved/Group controls that appended into it above) drops to its own row, and the
    // unified ACTIVE-FILTER chip row sits below it. The strip now reads:
    //   [Sort] [Filters ▾]  ·  panel (when open)  ·  active chips (when any filter is set).
    searchWrap.appendChild(filtersPanel);
    searchWrap.appendChild(activeFiltersRow);

    // one removable chip matching the .chip/.chip--lit/.chip__x markup the chipRow infra builds — for
    // the single-value facets (Show, Group). Label/From reuse their own chipRow container verbatim.
    function activeChip(text, ariaLabel, onRemove) {
      var chip = el(doc, "span", "chip chip--lit mail__active-chip", { role: "listitem" });
      chip.appendChild(el(doc, "span", "mail__active-chip-label", { text: text }));
      var x = el(doc, "button", "chip__x mail__active-chip-x", { type: "button", "aria-label": ariaLabel });
      x.textContent = "\u00d7";   // ×
      if (typeof onRemove === "function") x.addEventListener("click", onRemove);
      chip.appendChild(x);
      return chip;
    }
    // the current "Show" facet, derived from the closure booleans (single-select: at most one true).
    function showFacet() {
      if (currentUnread) return { label: "Unread" };
      if (currentReadLater) return { label: "Read-later" };
      if (currentSpam) return { label: "Spam" };
      if (currentTrash) return { label: "Trash" };
      if (currentSnoozed) return { label: "Snoozed" };
      if (currentHasAttachment) return { label: "Has attachment" };
      if (currentType === "letter") return { label: "Letters" };            // T3
      if (currentType === "notification") return { label: "Notifications" };  // T3
      if (currentType === "unknown") return { label: "Unclassified" };        // T3
      if (currentDeclined) return { label: "Declined" };                      // T1
      if (currentScreening) return { label: "Screening" };                    // T5
      if (currentDeniedSenders) return { label: "Denied senders" };           // T5
      return null;
    }
    var GROUP_LABELS = { thread: "Conversation", date: "By date", sender: "By sender", category: "By category" };
    // count of active filter facets: Show(0/1) + labels + senders + Group(0/1) — feeds the toggle badge.
    function filterFacetCount() {
      return (showFacet() ? 1 : 0) + currentLabels.length + currentFroms.length + (currentGroup ? 1 : 0);
    }
    // THE single chip authority — renders every active facet into the unified row + updates the Filters
    // toggle count. Called after paint() and on every filter change. Each chip's × clears its own facet,
    // resets the matching control back to its "all" value, then repaints the list and the chip row.
    function paintActiveFilters() {
      clearNode(activeFiltersRow);
      var n = filterFacetCount();
      if (filtersCount) filtersCount.textContent = n ? String(n) : "";
      if (n === 0) return;                              // :empty -> the row hides itself at rest
      activeFiltersRow.appendChild(el(doc, "span", "mail__active-filters-label", { text: "Active", "aria-hidden": "true" }));
      var sf = showFacet();
      if (sf) {
        activeFiltersRow.appendChild(activeChip(sf.label, "Clear the " + sf.label + " filter", function () {
          currentUnread = currentReadLater = currentSpam = currentTrash = currentSnoozed = currentHasAttachment = currentDeclined = false;   // currentDeclined: T1
          currentScreening = currentDeniedSenders = false;   // T5
          currentType = "";   // T3
          if (unreadSelect) unreadSelect.value = "";
          paint(input.value); paintActiveFilters();
        }));
      }
      if (currentLabels.length && labelChips && typeof labelChips.chipRow === "function") {
        activeFiltersRow.appendChild(labelChips.chipRow(doc, currentLabels, function (label) {
          currentLabels = (labelChips && typeof labelChips.toggle === "function")
            ? labelChips.toggle(currentLabels, label)
            : currentLabels.filter(function (k) { return k !== label; });
          paint(input.value); paintActiveFilters();
        }));
      }
      if (currentFroms.length && fromChips && typeof fromChips.chipRow === "function") {
        activeFiltersRow.appendChild(fromChips.chipRow(doc, currentFroms, function (sender) {
          currentFroms = (fromChips && typeof fromChips.toggle === "function")
            ? fromChips.toggle(currentFroms, sender)
            : currentFroms.filter(function (k) { return k !== sender; });
          paint(input.value); paintActiveFilters();
        }));
      }
      if (currentGroup) {
        activeFiltersRow.appendChild(activeChip("Grouped: " + (GROUP_LABELS[currentGroup] || currentGroup), "Clear grouping", function () {
          currentGroup = "";
          if (groupSelect) groupSelect.value = "";
          paint(input.value); paintActiveFilters();
        }));
      }
    }

    listView.appendChild(searchWrap);

    // The honest reachability glance rides the count line — one calm status row.
    // buildMailboxView is only reached on a VERIFIED read, so the glance is
    // `known` ("current"): a quiet, true marker, not an alarm. When the read
    // could NOT reach the truth, control never gets here — it renders the
    // unreachable pane instead (the badge is loud only when it has bad news).
    var statusRow = el(doc, "div", "mail__status");
    var glance = reachGlance(doc, "known", { label: "current" });
    if (glance) statusRow.appendChild(glance);
    var tag = el(doc, "div", "mail__count");
    statusRow.appendChild(tag);

    // §3f — the count slot sits where the unread number would be. OFF (default):
    // a calm in-place invite worded to WELCOME, not concede (SM-2) — met at the empty
    // spot, never buried in settings. ON: a quiet muted Spline-Sans-Mono field carrying
    // the HONEST known-unread count (mbox rows of unknown read-state are excluded —
    // flag-don't-fake), never a red pill or notification (JT-6). Deadpan, never cute
    // (BP-4). The number is a mailbox property (whole-mailbox unread), so it sits beside
    // the resting view and does not chase the search/filter narrowing.
    var countSlot = el(doc, "div", "mail__count-slot");
    statusRow.appendChild(countSlot);

    function knownUnread() {
      if (!(model && typeof model.filterMailbox === "function")) return null; // cold-safe: can't count honestly -> don't
      try { return model.filterMailbox(mailbox || [], { unread: true, label: null }).length; }
      catch (e) { return null; }
    }
    function setCountPref(on) {
      countOn = !!on;
      paintCountSlot();
      repaintRail();   // rail-count grain: the rail's counts follow the SAME preference, coherently
      if (typeof opts.onCountToggle === "function") { try { opts.onCountToggle(countOn); } catch (e) {} }
    }
    function paintCountSlot() {
      clearNode(countSlot);
      if (!countOn) {
        // OFF — the welcome at the empty spot (SM-2), worded to welcome. Deadpan (BP-4).
        var invite = el(doc, "div", "mail__count-invite", {
          role: "button", tabindex: "0",
          text: "want a count? it\u2019s here",
          "aria-label": "Show an unread count \u2014 off by default; some people like a number to track"
        });
        activate(invite, function () { setCountPref(true); });
        countSlot.appendChild(invite);
        return;
      }
      // ON — a calm, muted unread field (JT-6). Honest: unknown read-state excluded.
      var n = knownUnread();
      var field = el(doc, "div", "mail__unread-count", {
        text: (n == null) ? "unread \u2014 unavailable" : (n + " unread"),
        "aria-label": (n == null) ? "Unread count unavailable" : (n + " unread")
      });
      countSlot.appendChild(field);
      // a quiet way back off — plain, low-contrast, never a nag.
      var hide = el(doc, "div", "mail__count-hide", {
        role: "button", tabindex: "0", text: "hide",
        "aria-label": "Hide the unread count"
      });
      activate(hide, function () { setCountPref(false); });
      countSlot.appendChild(hide);
    }
    paintCountSlot();

    listView.appendChild(statusRow);

    /* ==== #23 — bulk-archive: selection + a bulk toolbar + an undo toast ======= *
     * Client-only. Consumes the #15 batch primitive (makeBatchModifyFn) with ZERO
     * new scope and ZERO runtime change. Selection state lives in this closure (like
     * currentGroup), so a re-paint (keystroke / sort / filter / archive-splice) keeps
     * it. The whole surface is GRANT-GATED: no live gmail modify grant -> canBulk
     * stays false, rows grow no checkboxes, the bar never appears (the same honest
     * gate the single manage bar uses). The two v1 actions are archive + mark-read —
     * both label-only and REVERSIBLE, so there is no blocking confirm; the undo toast
     * IS the safety net (fires the inverse batch over the same ids). Calm resting
     * surface preserved: the bar is empty until the first row is checked. */
    var selected = {};          // id -> message (the live selection)
    var bulkGrant = null, bulkAccount = null, batchModifyFn = null;
    var canBulk = false, bulkBusy = false;
    var lastShown = [];         // the rows paint() last rendered (for "select all in view")
    function selCount() { var n = 0; for (var k in selected) if (Object.prototype.hasOwnProperty.call(selected, k)) n++; return n; }
    function selIds() { var out = []; for (var k in selected) if (Object.prototype.hasOwnProperty.call(selected, k)) out.push(k); return out; }
    function selHas(id) { return Object.prototype.hasOwnProperty.call(selected, String(id)); }
    function selToggle(id, m) { id = String(id); if (selHas(id)) delete selected[id]; else selected[id] = m; paintBulkBar(); return selHas(id); }
    function selClear() { selected = {}; paintBulkBar(); }
    // the controller threaded into messageRow — `enabled` flips true once a grant resolves.
    var selectCtl = { enabled: false, has: selHas, toggle: selToggle };
    // ①b — the row-affordance controller, threaded into messageRow so a row's star/important/
    // archive fire the SAME single-message modify path the detail bar uses. Built when the grant
    // resolves (below, beside the bulk light-up); null until then -> rows grow monogram only.
    // ①c — fileFn + trees are OWNER-DATA, not Warrant: wired unconditionally at
    // creation (no grant resolve, no canManage gate), because filing needs only the
    // owner session the app already holds. `trees` is the app's tree taxonomy passed
    // in via opts.forestTrees; absent -> no picker (flag-don't-fake: never invent a
    // taxonomy). Each tree is { category, label } or a bare category string.
    var rowActionsCtl = { canManage: false, modifyFn: null, account: null, model: mm(),
      fileFn: makeFileFn({ _fetch: opts._fetch }),
      trees: (opts && opts.forestTrees) || null,
      onArchived: function (msg) { var i = mailbox.indexOf(msg); if (i >= 0) mailbox.splice(i, 1); paint(input.value); } };
    // #12 — the per-row snooze controller (email-views, calm form). Present only when the module
    // is available; carries the store (snooze/unsnooze/snoozedUntil), the calm presets, the render
    // clock, the current view mode (set per-paint), and a repaint callback. Absent module -> null
    // -> messageRow grows no snooze affordance (cold-safe). READ-ONLY on the model.
    var snoozeCtl = (snoozeStore && typeof snoozeStore.snooze === "function")
      ? { store: snoozeStore,
          presets: (typeof snoozeStore.presets === "function") ? snoozeStore.presets : null,
          now: snoozeNow, viewing: false,
          onChange: function () { paint(input.value); } }
      : null;
    // T1 — the per-row DECLINE controller. Present only when the module is available; carries the
    // store (decline / undecline / declinedAt / isDeclined + the canDecline type-gate), the render
    // clock (the RECORD of when you decided — never a deadline), and a repaint callback. Absent
    // module -> null -> messageRow grows no decline affordance (cold-safe, and the verb is simply
    // not offered). There is deliberately NO `viewing` flag here, unlike snoozeCtl: the row decides
    // its own face from isDeclined(id), because the reversal must be reachable wherever a declined
    // message is visible — not only in one blessed view. READ-ONLY on the model.
    var declineCtl = (declineStore && typeof declineStore.decline === "function")
      ? { store: declineStore,
          now: (opts.now != null) ? opts.now : Date.now(),
          onChange: function () { paint(input.value); } }
      : null;
    // T5 — the per-row SCREEN controller. Carries the module (the store verbs + the two gates it
    // reads: screenable/verdict for the offer, isDenied for the reversal), the decision clock, and
    // a repaint callback. Absent module -> null -> messageRow grows no screen affordance (cold-safe).
    // Like declineCtl and unlike snoozeCtl there is deliberately NO `viewing` flag: the row decides
    // its own face from the store, because the reversal must be reachable wherever a denied sender's
    // mail is visible — not only in one blessed view.
    var screenCtl = (screenStore && typeof screenStore.approve === "function")
      ? { store: screenStore,
          now: (opts.now != null) ? opts.now : Date.now(),
          onChange: function () { paint(input.value); } }
      : null;

    /* ---- T5: THE LOOKUP SEAM + THE OFF-PAINT DRAIN ------------------------------------- *
     * ⚠ READ THIS BEFORE YOU TOUCH paint(). Two traps, and both of them bite silently.      *
     *                                                                                       *
     * TRAP 1 — paint() MUST STAY SYNCHRONOUS. Every overlay in the stack (snooze.hide,      *
     * decline.hide, the type views) reads a sync localStorage map at paint time. The screen *
     * VERDICT is sync too — it reads the store and only the store. But the screen LOOKUP    *
     * (`in:sent to:<addr>`) is a network call, and it is async. The temptation is to await  *
     * it in paint(). DO NOT. Making paint() async is a rewrite of the render loop and it    *
     * breaks every overlay in the stack. THE STORE IS THE SYNC SURFACE AND THE NETWORK      *
     * LIVES BEHIND IT: paint() reads the store, renders what it knows, and returns. The     *
     * drain runs AFTER, off the paint path, and asks for exactly ONE repaint when it        *
     * changes something. An unresolved sender reads HELD in the meantime — fail-closed,     *
     * never a flicker toward approval.                                                      *
     *                                                                                       *
     * TRAP 2 — A MISS IS NOT WRITTEN, SO `pending` NEVER SHRINKS FOR IT. This one is not in *
     * the plan and it is the reason `screenAsked` exists. resolve() deliberately writes     *
     * NOTHING on a miss or a throw (a miss is not a deny — a deny is HIS act, and only his; *
     * a network blip must never be cached as a condemnation). Correct — but it means a      *
     * stranger stays in pending() forever. And paint() fires ON EVERY KEYSTROKE. Wire the   *
     * drain naively and every character he types re-issues a live Gmail search for every    *
     * unknown sender on screen. `screenAsked` is the in-memory guard: one lookup per sender *
     * PER SESSION. The store still memoizes approvals FOREVER (across sessions); the misses *
     * are re-asked on the next load, which is exactly the retry the module's law demands.   *
     *                                                                                       *
     * BOUNDED, because day one is the worst day: an empty store against a real mailbox is a *
     * cold-start with every sender unknown. Unbounded, that is one parallel live search per *
     * distinct sender — a hundred of them, at once, on first paint. The drain takes them    *
     * SCREEN_BATCH at a time and continues quietly until the queue is empty.                *
     * ------------------------------------------------------------------------------------ */
    var SCREEN_BATCH = 8;
    var screenAsked = {};        // sender key -> true. In-memory, session-scoped. See TRAP 2.
    var screenDraining = false;
    // The injected lookup. The module opens no socket of its own — it is handed this and nothing
    // else, and it is READ-ONLY. Adapts the existing owner-gated search seam (which resolves
    // { ok, items } and never throws) to the array-or-throw shape resolve() expects: a FAILED
    // search THROWS, so resolve() catches it, returns HELD, and writes nothing — it is retried,
    // never cached as a denial. Cold-safe: no fetch -> the seam resolves offline -> throw -> HELD.
    // `opts.screenSearch` (including an explicit null) overrides — null means NO seam, which the
    // module reads as fail-closed HELD.
    var screenSearchFn;
    if (opts.screenSearch !== undefined) {
      screenSearchFn = opts.screenSearch;
    } else {
      var _searchAll = makeSearchAllFn({ _fetch: opts._fetch });
      screenSearchFn = function (q) {
        return _searchAll(q).then(function (r) {
          if (r && r.ok && Array.isArray(r.items)) return r.items;
          throw new Error((r && r.error) || "search unavailable");   // -> HELD, nothing written, retried
        });
      };
    }
    function drainScreen() {
      if (screenDraining) return;
      if (!screenStore || typeof screenStore.pending !== "function" || typeof screenSearchFn !== "function") return;
      var queue = screenStore.pending(mailbox).filter(function (k) { return !screenAsked[k]; });
      if (!queue.length) return;
      var batch = queue.slice(0, SCREEN_BATCH);
      batch.forEach(function (k) { screenAsked[k] = true; });   // claim BEFORE the await — never ask twice
      screenDraining = true;
      Promise.all(batch.map(function (k) { return screenStore.resolve(k, screenSearchFn, null, screenCtl ? screenCtl.now : undefined); }))
        .then(function (verdicts) {
          screenDraining = false;
          var approved = 0;
          verdicts.forEach(function (v) { if (v === screenStore.APPROVED) approved += 1; });
          // ONE repaint, and only if something actually moved into the inbox. A batch of pure
          // misses changes NOTHING on screen (they were already held) — so it repaints nothing and
          // just keeps draining. paint() re-enters drainScreen() at its tail, so the approved case
          // continues the queue too. Terminates: screenAsked only ever grows.
          if (approved > 0) paint(input.value); else drainScreen();
        })
        .catch(function () { screenDraining = false; });   // the module already fails closed; never throw at the host
    }

    // the bulk toolbar (a `strip`) + the undo toast, both above the list. Empty (render
    // nothing) at rest; painted on demand. Appended BEFORE the list so they sit above it.
    var bulkBar = el(doc, "div", "mail__bulk strip");
    listView.appendChild(bulkBar);
    var undoBar = el(doc, "div", "mail__undo");
    listView.appendChild(undoBar);
    /* T5 / seq=469 — ⚠ THE CEILING, ON THE CONTROL HE READS. NOT IN A FOOTNOTE.
     *
     * The Screening view offers a control that says "Approve alice@x — always let this sender
     * through," and it means FOREVER. A browser has NO DKIM and NO SPF. This app CANNOT verify that
     * the address in a `From` header is who actually sent the mail — anyone can type an address they
     * do not own. So a spammer opens this gate by SPOOFING an approved address, and he would never
     * know it happened.
     *
     * That is not a bug in the module. It is the CEILING OF A CLIENT WITH NO SERVER, and the only
     * honest move is to NAME it where the decision is made — which is here, not in a doc he will
     * never open. The Cannot's law (Graham): NEVER PUBLISH A LINE AS A GUARD. The moral weight of a
     * "never" is exactly its enforcement mechanism, and there is no credit for intent. An unlabelled
     * approve button IS a published guard. This label is what makes it honest instead.
     *
     * Tier: DEPENDENCY (the Cannot §three-tiers) — blocked on a named thing (`loop-email`, a mail
     * server of his own, where DKIM/SPF can actually be checked). He gets the blocker, not a vow.
     * Sibling of C2-D. (Nyx, minority preserved, RCR R3 — and the minority was right.)
     *
     * It renders ONLY in the Screening view, where the approve/deny decision is actually made — not
     * in the inbox (that would be a nag, and C5/C6 forbid nagging) and not in the Denied view (the
     * spoofing risk is on APPROVE: a spoofer forges an APPROVED address to get IN; nobody forges
     * their way into being denied). One quiet line, stated once, where it changes what he does. */
    var screenNote = el(doc, "div", "mail__screen-note");
    listView.appendChild(screenNote);
    function paintScreenNote() {
      clearNode(screenNote);
      if (!screenStore || !currentScreening) return;
      var n = el(doc, "div", "mail__screen-ceiling", { role: "note" });
      n.appendChild(el(doc, "span", "mail__screen-ceiling-text", {
        text: "This checks the address in the From line. It cannot verify who actually sent the " +
              "mail \u2014 anyone can type an address they don\u2019t own. Approving trusts the address, " +
              "not the person. Closing that gap needs a mail server of your own."
      }));
      screenNote.appendChild(n);
    }

    function bulkStatus(text, isErr) {
      clearNode(undoBar);
      undoBar.appendChild(el(doc, "div", "mail__undo-status" + (isErr ? " mail__undo-status--error" : ""), { text: text, role: "status", "aria-live": "polite" }));
    }
    function selectAllInView() {
      lastShown.forEach(function (m) { if (m && m.source === "gmail" && m.id) selected[String(m.id)] = m; });
      paint(input.value);   // repaint so the boxes check; paint() re-calls paintBulkBar
    }
    var bulkLabelOpen = false;   // #26 — the bulk label-picker expander state; survives repaints via this flag
    // #26 fix — reflect a CONFIRMED server label change in the in-hand message so the client-side
    // LABEL filter (filterMailbox reads m.labels) sees it at once. Idempotent; never invents state the server
    // didn't confirm (called only inside a res.ok branch). addLbl/rmLbl are the honest local mirror of the
    // batch mutation the runtime already applied.
    // #24 follow-on DRY: the label-set logic lives ONCE in the model (canonical non-mutating
    // addLbl/rmLbl, return a new array). These renderer wrappers adapt that to the bulk path's
    // mutate-in-place contract (reassign m.labels) so runBulk/showUndo call sites are unchanged.
    // Cold-safe: an older model without the helpers falls back to the inline splice (no behavior change).
    function addLbl(m, id) {
      if (!m || id == null) return;
      if (model && typeof model.addLbl === "function") { m.labels = model.addLbl(m.labels, id); return; }
      if (!Array.isArray(m.labels)) m.labels = []; if (m.labels.indexOf(id) === -1) m.labels.push(id);
    }
    function rmLbl(m, id) {
      if (!m) return;
      if (model && typeof model.rmLbl === "function") { m.labels = model.rmLbl(m.labels, id); return; }
      if (!Array.isArray(m.labels)) return; var i = m.labels.indexOf(id); if (i !== -1) m.labels.splice(i, 1);
    }
    function paintBulkBar() {
      clearNode(bulkBar);
      var n = selCount();
      if (!canBulk || !n) { bulkLabelOpen = false; return; }   // calm at rest: nothing until the first check
      bulkBar.appendChild(el(doc, "span", "mail__bulk-count", { text: n + " selected", "aria-live": "polite" }));
      var archiveBtn = el(doc, "div", "mail__bulk-archive strip__action", { role: "button", tabindex: "0", text: "Archive", "aria-label": "Archive " + n + " selected message" + (n === 1 ? "" : "s") });
      activate(archiveBtn, function () { runBulk("archive"); });
      bulkBar.appendChild(archiveBtn);
      var readBtn = el(doc, "div", "mail__bulk-read strip__action", { role: "button", tabindex: "0", text: "Mark read", "aria-label": "Mark " + n + " selected message" + (n === 1 ? "" : "s") + " as read" });
      activate(readBtn, function () { runBulk("read"); });
      bulkBar.appendChild(readBtn);
      // #26 — bulk star: a canned toggle over the STARRED system label, riding the SAME batch seam as
      // archive/read (the runtime's MODIFY_ACTIONS supplies STARRED; the client sends the definite verb).
      // Reversible + label-only -> the undo toast is the net (inverse 'unstar'); no delete path (K1 holds).
      var starBtn = el(doc, "div", "mail__bulk-star strip__action", { role: "button", tabindex: "0", text: "Star", "aria-label": "Star " + n + " selected message" + (n === 1 ? "" : "s") });
      activate(starBtn, function () { runBulk("star"); });
      bulkBar.appendChild(starBtn);
      // #26 — bulk label: an expander over the mailbox's MOVABLE labels (movableLabels host-filter, exactly
      // like the single manage bar). A pick adds that ONE user label across the selection (action:'label' +
      // addLabelIds); undo removes exactly it. No movable labels (e.g. an mbox-only mailbox) -> no button at
      // all (honest: nothing to add to). Recomputed fresh each paint so the picker tracks the live mailbox.
      var movable = movableLabels((model && typeof model.labelsOf === "function") ? model.labelsOf(mailbox) : []);
      if (movable.length) {
        var labelBtn = el(doc, "div", "mail__bulk-label strip__action", { role: "button", tabindex: "0", text: "Label\u2026", "aria-label": "Add a label to " + n + " selected message" + (n === 1 ? "" : "s"), "aria-expanded": bulkLabelOpen ? "true" : "false" });
        activate(labelBtn, function () { bulkLabelOpen = !bulkLabelOpen; paintBulkBar(); });
        bulkBar.appendChild(labelBtn);
      }
      var allBtn = el(doc, "div", "mail__bulk-all strip__action", { role: "button", tabindex: "0", text: "Select all", "aria-label": "Select all selectable messages in view" });
      activate(allBtn, selectAllInView);
      bulkBar.appendChild(allBtn);
      var clearBtn = el(doc, "div", "mail__bulk-clear strip__action", { role: "button", tabindex: "0", text: "Clear", "aria-label": "Clear selection" });
      activate(clearBtn, selClear);
      bulkBar.appendChild(clearBtn);
      // the expanded picker sits BELOW the button row (rebuilt each paint from the flag, so it survives a
      // selection-count repaint; a Clear or an applied action empties the bar and resets the flag above).
      if (bulkLabelOpen && movable.length) {
        var picker = el(doc, "div", "mail__bulk-picker");
        movable.forEach(function (id) {
          var chip = el(doc, "div", "mail__bulk-label-chip strip__action", { role: "button", tabindex: "0", text: "Add to " + id, "aria-label": "Add the label " + id + " to " + n + " selected message" + (n === 1 ? "" : "s") });
          activate(chip, function () { runBulk("label", { addLabelIds: [id] }); });
          picker.appendChild(chip);
        });
        bulkBar.appendChild(picker);
      }
    }
    function runBulk(action, extra) {
      var ids = selIds();
      if (!ids.length || !batchModifyFn || bulkBusy) return;
      bulkBusy = true;
      var moved = ids.map(function (id) { return selected[id]; }).filter(Boolean);
      // leg-13 discipline: for action:'label' the caller passes definite {addLabelIds} through `extra`;
      // canned toggles (archive/read/star) pass none. Merge onto the base request, don't overwrite it.
      var req = { itemIds: ids, action: action, account: bulkAccount };
      if (extra) { for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) req[k] = extra[k]; } }
      Promise.resolve(batchModifyFn(req)).then(function (res) {
        bulkBusy = false;
        if (!res || !res.ok) { bulkStatus((res && res.error) || "Couldn\u2019t apply the change \u2014 nothing was moved.", true); return; }
        var appliedN = (res.count != null) ? res.count : ids.length;
        if (action === "archive") { moved.forEach(function (m) { var i = mailbox.indexOf(m); if (i >= 0) mailbox.splice(i, 1); }); }
        else if (action === "read") { moved.forEach(function (m) { if (m) m.unread = false; }); }  // now KNOWN-read (honest)
        // star / label: the server CONFIRMED it (res.ok), so reflect the change in the in-hand labels — the
        // client-side LABEL filter reads m.labels, so withholding a confirmed star was exactly what made
        // "Star -> STARRED filter shows nothing" (operator,). This mirrors truth, it does not fake it.
        else if (action === "star") { moved.forEach(function (m) { addLbl(m, "STARRED"); }); }
        else if (action === "label") { ((extra && extra.addLabelIds) || []).forEach(function (id) { moved.forEach(function (m) { addLbl(m, id); }); }); }
        selClear();
        paint(input.value);
        showUndo(action, moved, appliedN, extra);
      }, function () { bulkBusy = false; bulkStatus("Couldn\u2019t apply the change \u2014 nothing was moved.", true); });
    }
    function showUndo(action, moved, count, extra) {
      clearNode(undoBar);
      if (!moved || !moved.length) return;
      var verb = (action === "archive") ? "Archived "
               : (action === "read")    ? "Marked read "
               : (action === "star")    ? "Starred "
               : (action === "label")   ? ("Added to " + (((extra && extra.addLabelIds) || [])[0] || "label") + " \u00b7 ")
               : "Updated ";
      var label = verb + count;
      undoBar.appendChild(el(doc, "span", "mail__undo-label", { text: label, "aria-live": "polite" }));
      var undoBtn = el(doc, "div", "mail__undo-action strip__action", { role: "button", tabindex: "0", text: "Undo", "aria-label": "Undo \u2014 " + label });
      activate(undoBtn, function () { runUndo(action, moved, extra); });
      undoBar.appendChild(undoBtn);
      // The Broom (delight #3) — a NON-ZERO-TERMINAL sweep comes to rest (SM-5,
      // unhurried follow-through). Fires only on `archive` (the sweep that clears
      // the inbox), and the co-fire rule (JP-1) is the gate itself: theBroom.render
      // silences on a real-zero terminal, because paint() has already rendered the
      // Clearing over the now-empty pane — one celebration per completion. The state
      // is "known" (res.ok was confirmed in runBulk before this), so no false
      // sweep-complete on `unreachable`. Rides the transient undoBar lifecycle
      // (auto-dismiss / cleared on next action). Cold-safe: no theBroom -> nothing.
      if (action === "archive") {
        var broom = root.theBroom;
        if (broom && typeof broom.render === "function") {
          var bnode = broom.render(doc, "known", mailbox.length, count);
          if (bnode) { bnode.setAttribute("data-broom", "1"); undoBar.appendChild(bnode); }
        }
      }
      // auto-dismiss (guarded: the test shim has no real timer, so this is a no-op there)
      if (typeof setTimeout === "function") { try { setTimeout(function () { if (undoBar && undoBar.firstChild) clearNode(undoBar); }, 8000); } catch (e) {} }
    }
    function runUndo(action, moved, extra) {
      if (!batchModifyFn || !moved || !moved.length) return;
      var ids = moved.map(function (m) { return m && m.id; }).filter(Boolean);
      // the DEFINITE inverse verb (the leg-12 discipline — the client never guesses direction). Canned
      // pairs invert by name; a label-ADD inverts by REMOVING exactly the ids that were added over the
      // same message set (label is not self-inverse, so `extra` must ride the undo closure to reverse it).
      var inv = { itemIds: ids, account: bulkAccount };
      if (action === "archive") { inv.action = "unarchive"; }
      else if (action === "read") { inv.action = "unread"; }
      else if (action === "star") { inv.action = "unstar"; }
      else if (action === "label") { inv.action = "label"; inv.removeLabelIds = (extra && extra.addLabelIds) || []; }
      else { inv.action = action; }
      clearNode(undoBar);
      Promise.resolve(batchModifyFn(inv)).then(function (res) {
        if (!res || !res.ok) { bulkStatus((res && res.error) || "Couldn\u2019t undo.", true); return; }
        if (action === "archive") { moved.forEach(function (m) { if (m && mailbox.indexOf(m) < 0) mailbox.push(m); }); }
        else if (action === "read") { moved.forEach(function (m) { if (m) m.unread = true; }); }
        else if (action === "star") { moved.forEach(function (m) { rmLbl(m, "STARRED"); }); }   // undo = unstar = drop STARRED locally
        else if (action === "label") { ((extra && extra.addLabelIds) || []).forEach(function (id) { moved.forEach(function (m) { rmLbl(m, id); }); }); }  // undo = remove exactly what was added
        // (star/label undo mirrors runBulk's forward path — reflect the confirmed reversal in m.labels)
        paint(input.value);
      }, function () { bulkStatus("Couldn\u2019t undo.", true); });
    }

    // the rows sit in the LIST region of the three-region view (block.css .view__list):
    // one bordered, scrolling column of `row`s. mail-list stays as the semantic hook.
    var list = el(doc, "ul", "mail-list view__list");
    applyDensity();   // ①b — set the resting density modifier on the list at build
    listView.appendChild(list);

    // #8 slice ② — the whole-corpus results region. Sits below the local list; empty until the
    // operator clicks "Search all Gmail". Cleared (emptied) whenever the query changes, so it never
    // shows stale server hits for a query the box no longer holds. An empty region renders nothing.
    var serverResults = el(doc, "div", "mail__server-results");
    listView.appendChild(serverResults);

    function clearServerResults() { clearNode(serverResults); }
    function serverStatus(text, cls) {
      clearNode(serverResults);
      serverResults.appendChild(el(doc, "div", "mail__server-status" + (cls ? " " + cls : ""), { text: text }));
    }
    function renderServerHits(rows) {
      clearNode(serverResults);
      // dedupe against what's already loaded (by id): the whole-corpus reach shows only what the
      // instant local filter could NOT — honest ("here's what searching all your mail adds").
      var loaded = {};
      (mailbox || []).forEach(function (m) { if (m && m.id != null) loaded[String(m.id)] = true; });
      var msgs = (model && typeof model.mailboxFromExport === "function")
        ? model.mailboxFromExport({ items: rows }) : [];
      var fresh = msgs.filter(function (m) { return !loaded[String(m.id)]; });
      serverResults.appendChild(el(doc, "div", "mail__server-header", {
        text: fresh.length + " more from all your mail", role: "presentation"
      }));
      if (!fresh.length) {
        // The Divining Rod (delight #4): a whole-corpus search that came up dry gets a
        // quiet voice, not a flat status (JT-3 an empty record + one line; SM-2 the joke
        // decays). Fires only on this VERIFIED ok-but-empty branch — a failed/offline
        // search goes through serverStatus(error), so the Rod never says a false "nothing
        // out there." Cold-safe: no Rod module -> the honest flat line, never a blank.
        var rod = root.diviningRod;
        var rodNode = (rod && typeof rod.render === "function") ? rod.render(doc, {}) : null;
        serverResults.appendChild(rodNode || el(doc, "div", "mail__server-status", {
          text: "Nothing else in your mail matches \u2014 the results above are all of them."
        }));
        return;
      }
      var slist = el(doc, "ul", "mail-list mail-list--server view__list");
      fresh.forEach(function (m) { slist.appendChild(messageRow(doc, m, openDetail)); });
      serverResults.appendChild(slist);
    }
    function runSearchAll() {
      var q = String(input.value || "").trim();
      if (!q) return;
      serverStatus("Searching all your mail\u2026", "mail__server-status--loading");
      Promise.resolve(searchAllFn(q)).then(function (res) {
        // a newer query may have superseded this run — only paint if the box still holds q
        if (String(input.value || "").trim() !== q) return;
        if (res && res.ok) return renderServerHits(res.items || []);
        serverStatus((res && res.error) || "Couldn\u2019t search all your mail.", "mail__server-status--error");
      }, function () {
        serverStatus("Couldn\u2019t search all your mail.", "mail__server-status--error");
      });
    }
    activate(searchAllBtn, runSearchAll);

    // email-app ①a — the rail wiring. railActiveId() derives which slot is lit from the SAME
    // currentUnread/currentLabel the strip selects and paint() read (so the rail and the selects
    // can never disagree). repaintRail() rebuilds the rail node in its host from railModel over the
    // CURRENT mailbox — counts live, active in sync. onRailSlot() routes a click through that one
    // filter path (and syncs the strip selects so the two surfaces stay coherent).
    function railActiveId() {
      // Change-1: the Tier-B view-mode slots light first (they're mutually exclusive with the
      // filter slots after onRailSlot's clean-switch reset).
      if (currentSnoozed) return "snoozed";
      if (currentSpam) return "spam";
      if (currentTrash) return "trash";
      if (currentUnread) return "unread";
      if (currentLabel === "INBOX") return "inbox";
      if (currentLabel === "STARRED") return "starred";
      if (currentLabel === "IMPORTANT") return "important";
      if (!currentLabel) return "all";
      return null;   // a label the rail doesn't name (e.g. a custom label via the picker) — no slot lit
    }
    function repaintRail() {
      // email-app Change-1 — the Gmail-shaped rail. railModel stays the PURE source of the
      // filter-slots it can honestly count (Tier A: Inbox/Unread/Starred/Important/All mail).
      // The Tier-B view-mode slots (Snoozed/Spam/Trash) and the Drafts LAUNCHER are composed
      // HERE, in the renderer, where the view objects and their honest present-gates already
      // live (offerSnoozed/offerSpam/offerTrash, each count>0). So a folder appears in the rail
      // ONLY when the app can actually open it — the model's flag-don't-fake rule honored one
      // layer up, exactly as the model comment says ("the renderer decides whether to show or
      // hide"). Sent is NOT yet a view (no SENT fetch) and is deliberately omitted — never a
      // false always-empty slot; it is the one follow-on when its fetch leg lands.
      var base = (model && typeof model.railModel === "function") ? model.railModel(mailbox) : [];
      var byId = {};
      base.forEach(function (s) { byId[s.id] = { id: s.id, label: s.label, kind: "filter", filter: s.filter, count: s.count }; });
      var slots = [];
      function pushFilter(id) { if (byId[id]) slots.push(byId[id]); }
      function pushView(id, label, on, count) { if (on) slots.push({ id: id, label: label, kind: "view", count: count }); }
      // Gmail order over what EXISTS (Sent omitted — no view yet):
      pushFilter("inbox");
      pushFilter("unread");                                                             // Forest keeps Unread
      pushFilter("starred");
      pushView("snoozed", "Snoozed", offerSnoozed, snoozeStore ? snoozeStore.count(mailbox, snoozeNow) : 0);
      pushFilter("important");
      slots.push({ id: "drafts", label: "Drafts", kind: "drafts" });                   // a launcher (openDrafts) — no fabricated count
      pushFilter("all");
      pushView("spam", "Spam", offerSpam, spamView ? spamView.count(mailbox) : 0);
      pushView("trash", "Trash", offerTrash, trashView ? trashView.count(mailbox) : 0);
      // The rail hosts the search box now, and paint() repaints the rail on every keystroke —
      // so preserve the box's focus + caret across the rebuild, or typing loses focus per key.
      var searchHadFocus = (doc.activeElement === input);
      var selStart = null, selEnd = null;
      try { selStart = input.selectionStart; selEnd = input.selectionEnd; } catch (e) {}
      clearNode(railHost);
      railHost.appendChild(renderRail(doc, slots, {
        onCompose: function () { openCompose({ isReply: false }); },
        onSlot: onRailSlot,
        activeId: railActiveId(),
        showCounts: countOn,  // rail-count grain: ONE count preference drives header + rail
        searchEl: input       // host mail's persistent, wired search input in the rail (SL-2)
      }));
      if (searchHadFocus && typeof input.focus === "function") {
        input.focus();
        if (selStart != null) { try { input.setSelectionRange(selStart, selEnd); } catch (e) {} }
      }
    }
    function onRailSlot(s) {
      // Change-1 dispatch. A filter-slot (Tier A) narrows the loaded mailbox; a view-slot
      // (Tier B) switches to a view-mode the renderer already owns; Drafts LAUNCHES its panel.
      if (s.kind === "drafts") { openDrafts(); return; }   // a launcher, not a persistent view
      // A rail click is a CLEAN folder switch: reset every narrowing the rail can set, then set
      // the target. Resetting the view booleans here also fixes the latent inbox∩trash overlap
      // the pre-Change-1 rail left behind when a strip view-mode was active (it only cleared the
      // filter facet, never the view-mode booleans).
      currentReadLater = false;
      currentSpam = false; currentTrash = false; currentSnoozed = false;
      if (s.kind === "view") {
        currentUnread = false; currentLabel = "";
        if (s.id === "snoozed") currentSnoozed = true;
        else if (s.id === "spam") currentSpam = true;
        else if (s.id === "trash") currentTrash = true;
        if (unreadSelect) unreadSelect.value = s.id;   // keep the strip select coherent with the rail
      } else {   // filter slot
        var f = s.filter || {};
        currentUnread = (f.unread === true);
        currentLabel = f.label || "";
        if (unreadSelect) unreadSelect.value = currentUnread ? "unread" : "";
      }
      // the Label picker is now a chip ADD-picker (it no longer holds currentLabel), so it
      // rests at "All labels" — the rail owns currentLabel; the chip set is a separate facet.
      if (labelSelect) labelSelect.value = "";
      paint(input.value);
      if (typeof paintActiveFilters === "function") paintActiveFilters();
      repaintRail();
    }
    // The cached list surface. §7.2 —.mail__layout COLLAPSES TO THE LIST: with the rail
    // living in the frame's column, the two-column flex row has one child and nothing to lay out.
    // It survives only as the list's measure/centering wrapper (block.css), which was always a
    // separate job from hosting the rail.
    //
    // The rail is appended here ONLY on the fallback path. In the frame, the rail lives in
    // .menu__body — OUTSIDE the pane — so the pane pool's hidden-attribute toggle carries it:
    // menu and pane are one pool entry (§2 Move 2), shown, hidden, and evicted together.
    // That is also why a swap to the reading pane and Back no longer has to keep the rail with the
    // list: the rail is not in the swap host at all. It cannot be torn down by a view swap, and it
    // cannot desync from the pane — the desync is not defended against, it is not expressible.
    var layout = el(doc, "div", "mail__layout");
    if (!railInMenu) layout.appendChild(railHost);
    layout.appendChild(listView);
    function showList() { composeOpen = false; clearNode(body); body.appendChild(layout); }
    // send config (account + grant) resolved once per mailbox-view open and cached; cleared after a
    // successful "Enable sending" so a re-open picks up the freshly-issued grant (leg 06 "build B").
    var sendCfgP = null;
    function getSendConfig() {
      if (!sendCfgP) sendCfgP = resolveSendConfig({});
      return sendCfgP;
    }
    // email-app undo-send — reopen compose repopulated from a queued send's payload (the Undo path).
    // The payload is exactly what the owner composed (to/subject/body/cc/bcc/attachments); reopening
    // compose prefilled from it restores the message "just as it was when it was sent." injectSignature
    // is OFF because the payload body ALREADY carries the signature (it was assembled from the live
    // textarea at send time) — re-appending would double it.
    function prefillFromPayload(pl) {
      pl = pl || {};
      var c = { isReply: false, injectSignature: false };
      if (pl.to) c.to = pl.to;
      if (pl.subject != null) c.subject = pl.subject;
      if (pl.body != null) c.body = pl.body;
      if (pl.cc) c.cc = pl.cc;
      if (pl.bcc) c.bcc = pl.bcc;
      if (pl.attachments && pl.attachments.length) c.attachments = pl.attachments.slice();
      return c;
    }
    function openCompose(copts) {
      composeOpen = true;   // #24 follow-on #3: pause the background poll while the user is composing
      // Gmail-style overlay (§6.1, "just like Gmail"): float compose OVER the live mailbox
      // instead of swapping the view. The current view (list or detail) stays mounted; a fixed,
      // bottom-right docked overlay layers on top of it (non-modal — the list stays visible behind).
      // Every return path in composeView funnels through onCancel, so closing = remove the overlay
      // then run the prior return (showList re-renders a clean list; a caller-supplied onCancel is
      // preserved). This replaces the old clearNode(body)+mount-in-place swap.
      var co = {};
      for (var k in (copts || {})) if (Object.prototype.hasOwnProperty.call(copts, k)) co[k] = copts[k];
      // undo-send: the dock's Undo calls this to reopen compose with the exact just-unsent email.
      // Reopening runs a fresh openCompose, so the overlay closes cleanly first (onCancel already ran).
      co.onReopenWith = function (pl) { openCompose(prefillFromPayload(pl)); };
      var priorCancel = (typeof co.onCancel === "function") ? co.onCancel : showList;
      var overlay = el(doc, "div", "mail-compose-overlay");
      function closeOverlay() {
        composeOpen = false;
        if (overlay.parentNode && typeof overlay.parentNode.removeChild === "function") overlay.parentNode.removeChild(overlay);
      }
      co.onCancel = function () { closeOverlay(); priorCancel(); };
      // L3: minimize -> the shell-level composeDock (feature-detected, seam co.composeDock). Hides
      // THIS overlay (its DOM + typed state preserved) and hands a restorable tab to the dock: restore
      // re-shows this same overlay (state intact), discard runs the full teardown (onCancel). Cold-safe:
      // no dock -> onMinimize stays unset, so composeView renders no minimize control (prior ×-only pane).
      var _cdock = (co.composeDock !== undefined) ? co.composeDock : ((root && root.composeDock) || null);
      if (_cdock && typeof _cdock.minimize === "function") {
        var _mtitle = co.isForward ? "Forward" : (co.isReplyAll ? "Reply all" : (co.isReply ? "Reply" : "New message"));
        co.onMinimize = function () {
          composeOpen = false;   // a minimized draft isn't actively composing; let the background poll resume
          if (overlay.classList && overlay.classList.add) overlay.classList.add("record--docked");
          else overlay.className = (overlay.className || "") + " record--docked";
          _cdock.minimize({
            title: _mtitle, _doc: doc,
            onRestore: function () {
              composeOpen = true;
              if (overlay.classList && overlay.classList.remove) overlay.classList.remove("record--docked");
              else overlay.className = String(overlay.className || "").replace(/\s*record--docked/g, "");
            },
            onClose: function () { co.onCancel(); }
          });
        };
      }
      // resolve account + send-grant from the runtime, THEN build compose with them — no hand-set
      // window.FOREST_*. A reply already carries msg.account; prefer it, else the resolved gmail
      // account. onEnableSending is the owner-gated setup act (issue the Warrant send-grant).
      body.appendChild(overlay);
      overlay.appendChild(el(doc, "p", "mail-compose__preparing", { text: "Preparing\u2026" }));
      function build(cfg) {
        clearNode(overlay);
        cfg = cfg || {};
        co.account = co.account || cfg.account || null;
        if (co.grant == null) co.grant = cfg.grant || null;
        if (co.canSend == null && cfg.hasOwnProperty("canSend")) co.canSend = cfg.canSend;
        co.onEnableSending = function () {
          return enableSending({}).then(function (res) {
            if (res && res.ok) sendCfgP = null; // force re-resolve so a re-open sees the new grant
            return res;
          });
        };
        overlay.appendChild(composeView(doc, co));
      }
      getSendConfig().then(build, function () { build(null); }); // resolve failure -> window-global fallback
    }
    // email-app Track B #18 — the drafts panel. openDrafts resolves the send config (account+grant),
    // lists saved drafts via /intent/draft {op:'list'} (read-only, like the label registry read),
    // and a click resumes one: {op:'get'} returns the read-seam content STRING, parsed by the model's
    // ONE parser (mailModel.parseMailContent) into {subject, to, cc, body}, then openCompose prefilled
    // and carrying draftId so a re-save UPDATES the same draft. Cold-safe: an older model without the
    // parser falls back to the raw content as the body (honest, never a fabricated split).
    function openDrafts() {
      composeOpen = true;   // pause the background poll while the drafts pane is up (like compose)
      clearNode(body);
      body.appendChild(el(doc, "p", "mail-drafts__preparing", { text: "Loading drafts\u2026" }));
      getSendConfig().then(function (cfg) { renderDrafts(cfg || {}); }, function () { renderDrafts({}); });
    }
    function renderDrafts(cfg) {
      var draftFn = makeDraftFn({ getGrant: function () { return cfg.grant || null; }, _fetch: opts._fetch });
      clearNode(body);
      var panel = el(doc, "div", "mail-drafts record");
      panel.appendChild(el(doc, "h3", "mail-drafts__title record__title", { text: "Drafts" }));
      var status = el(doc, "div", "mail-drafts__status", { role: "status", "aria-live": "polite" });
      panel.appendChild(status);
      var listEl = el(doc, "ul", "mail-drafts__list", { role: "list" });
      panel.appendChild(listEl);
      var back = el(doc, "div", "mail-drafts__back record__action record__action--quiet", { role: "button", tabindex: "0", text: "\u2190 Inbox" });
      activate(back, function () { showList(); });
      panel.appendChild(back);
      body.appendChild(panel);

      Promise.resolve(draftFn({ op: "list", account: cfg.account || null })).then(function (res) {
        if (!res || !res.ok) { status.textContent = (res && res.error) || "Couldn\u2019t load drafts."; status.className = "mail-drafts__status is-error"; return; }
        var drafts = res.drafts || [];
        if (!drafts.length) { status.textContent = "No saved drafts."; return; }
        drafts.forEach(function (d) {
          var li = el(doc, "li", "mail-drafts__item");
          var open = el(doc, "div", "mail-drafts__open record__action record__action--quiet", {
            role: "button", tabindex: "0", text: "Draft " + d.id, "aria-label": "Resume draft " + d.id
          });
          activate(open, function () { resumeDraft(draftFn, cfg, d.id, status); });
          li.appendChild(open);
          listEl.appendChild(li);
        });
      }, function () { status.textContent = "Couldn\u2019t load drafts."; status.className = "mail-drafts__status is-error"; });
    }
    function resumeDraft(draftFn, cfg, id, status) {
      if (status) { status.textContent = "Opening draft\u2026"; status.className = "mail-drafts__status is-pending"; }
      Promise.resolve(draftFn({ op: "get", account: cfg.account || null, id: id })).then(function (res) {
        if (!res || !res.ok) { if (status) { status.textContent = (res && res.error) || "Couldn\u2019t open draft."; status.className = "mail-drafts__status is-error"; } return; }
        var mdl = mm();
        var parsed = (mdl && typeof mdl.parseMailContent === "function")
          ? mdl.parseMailContent(res.content || "")
          : { subject: "", to: "", cc: "", body: String(res.content || "") };   // cold-safe: older bundle -> raw body
        openCompose({
          draftId: id,
          to: parsed.to || "",
          cc: parsed.cc || "",
          subject: parsed.subject || "",
          body: parsed.body || "",
          account: cfg.account || null,
          injectSignature: false   // resume shows the saved body as-is; don't re-append the signature
        });
      }, function () { if (status) { status.textContent = "Couldn\u2019t open draft."; status.className = "mail-drafts__status is-error"; } });
    }
    // email-app #27/#28 — the settings panel. openSettings resolves the send config
    // (account + grant), builds the settings seam over that grant, and mounts the pure
    // buildSettingsPanel (Filters + Send-as/Vacation). Mirrors openDrafts: pause the poll,
    // show a preparing line, then render. onBack returns to the inbox list.
    function openSettings(initialTab) {
      composeOpen = true;   // pause the background poll while the settings pane is up
      clearNode(body);
      body.appendChild(el(doc, "p", "mail-settings__preparing", { text: "Loading settings\u2026" }));
      getSendConfig().then(function (cfg) { renderSettings(cfg || {}, initialTab); }, function () { renderSettings({}, initialTab); });
    }
    function renderSettings(cfg, initialTab) {
      var settingsFn = makeSettingsFn({ getGrant: function () { return cfg.grant || null; }, _fetch: opts._fetch });
      clearNode(body);
      body.appendChild(buildSettingsPanel(doc, settingsFn, {
        account: cfg.account || null,
        initialTab: initialTab,   // note #4: 1 opens straight to the Sending / Undo-window controls
        onBack: function () { showList(); },
        // D1 — EXPORT. The panel builds the control; the HOST does the download, so the panel
        // stays a pure builder (unit-testable with no Blob/URL in the DOM shim). Pure client-side:
        // the mailbox is already in hand, so leaving needs no server, no route, and no network —
        // which is also why it works when everything else is down. That is the point of an exit.
        mailbox: mailbox,
        onExport: function () {
          var X = root.mailExport;
          if (!X || typeof X.toMbox !== "function") return { ok: false, error: "Export is unavailable." };
          try {
            var text = X.toMbox(mailbox);
            var name = X.filename();
            var n = X.count(mailbox);
            // Blob + object URL + a synthetic <a download>. Guarded: a substrate without Blob/URL
            // reports an honest failure rather than pretending the file landed (flag-don't-fake).
            if (typeof Blob === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
              return { ok: false, error: "This browser cannot download files." };
            }
            var url = URL.createObjectURL(new Blob([text], { type: "application/mbox" }));
            var a = doc.createElement("a");
            a.href = url; a.download = name;
            if (a.style) a.style.display = "none";
            if (doc.body && doc.body.appendChild) doc.body.appendChild(a);
            a.click();
            if (a.parentNode && a.parentNode.removeChild) a.parentNode.removeChild(a);
            try { URL.revokeObjectURL(url); } catch (e) {}
            return { ok: true, count: n, filename: name };
          } catch (e) {
            return { ok: false, error: "Export failed \u2014 your mail was not changed." };
          }
        },
        // v9 density wire. The Settings select reflects the persisted choice
        // (opts.density, resolved from the view-config by countOptsFrom) and, on change,
        // runs this composed callback: (1) re-apply the `.view--density-*` modifier to the
        // LIVE cached list node — a re-render-free className swap (applyDensity), so the
        // choice is already applied when the user returns via "<- Inbox"; (2) persist it
        // via the host (opts.onDensityChange dispatches forest:density -> shell-boot saves
        // it) so it also survives a reload. Cold-safe: no onDensityChange -> the local
        // apply still happens; the control never fakes persistence it didn't get.
        density: opts.density,
        onDensityChange: function (v) {
          currentDensity = (v === "cozy" || v === "compact") ? v : "comfortable";
          applyDensity();
          if (typeof opts.onDensityChange === "function") { try { opts.onDensityChange(v); } catch (e) {} }
        }
      }));
    }
    function openDetail(m) {
      clearNode(body);
      function onReply(msg) {
        openCompose({
          isReply: true,
          to: emailFromHeader(msg.from),
          subject: replySubject(msg.subject),
          // inReplyTo omitted honestly: the read path does not yet carry the RFC Message-Id, so a reply
          // sends un-threaded rather than fabricating a thread id. The send plumbing IS threading-ready.
          inReplyTo: msg.messageId || null,
          account: msg.account || null,
          body: ""
        });
      }
      // email-app #14 (forward half) — forward prefills the QUOTED original as the body and
      // leaves To EMPTY (the user names the recipient). No inReplyTo (a forward starts a new
      // thread, not a reply into the original). Uses only carried fields, so it works on any
      // source; account is carried through so a gmail forward sends from the right identity.
      function onForward(msg) {
        openCompose({
          isForward: true,
          to: "",
          subject: fwdSubject(msg.subject),
          body: forwardBody(msg),
          account: msg.account || null
        });
      }
      // email-app #14b (reply-all) — the model already carries the recipient headers (to/cc) and
      // computes the widened set: replyAllRecipients(msg, self) -> { to: original sender,
      // cc: everyone else on To+Cc minus self }. self is the mailbox owner's address (msg.account),
      // so the owner is never Cc'd on their own reply. Degrades honestly: an mbox message with no
      // recipient headers yields cc:'' and to = its sender (a plain reply). Cold-safe if the model
      // lacks the verb (older bundle) -> fall back to a reply-to-sender.
      function onReplyAll(msg) {
        var self = msg.account || null;
        var rr = (model && typeof model.replyAllRecipients === "function")
          ? model.replyAllRecipients(msg, self)
          : { to: emailFromHeader(msg.from), cc: "" };
        openCompose({
          isReplyAll: true,
          to: rr.to || emailFromHeader(msg.from),
          cc: rr.cc || "",
          subject: replySubject(msg.subject),
          // inReplyTo omitted honestly until the read path carries the RFC Message-Id (same as onReply).
          inReplyTo: msg.messageId || null,
          account: msg.account || null,
          body: ""
        });
      }
      // render the pane IMMEDIATELY (the read never waits on a grant lookup) …
      // carry the read-later controller so the LOCAL toggle shows even with no gmail grant / mbox source.
      // email-app #11 B2 — unsubscribeFn rides the immediate pane too: one-click is owner-gated at the
      // runtime (the session), NOT the gmail Warrant grant, so the button shows without waiting on a grant.
      body.appendChild(detailView(doc, m, showList, onReply, { readLater: rl, unsubscribeFn: makeUnsubscribeFn({ _fetch: opts._fetch }) }, onForward, onReplyAll));
      // … then, for a gmail-sourced message, resolve the (cached) gmail grant and upgrade the pane with
      // the manage bar. No live grant -> no bar (the owner enables via compose's "Enable sending", which
      // issues the same subject-scoped gmail grant). A resolve failure leaves the leg-5/6 read-only pane.
      if (m.source === "gmail") {
        getSendConfig().then(function (cfg) {
          cfg = cfg || {};
          if (!cfg.canSend) return;
          var observedLabels = (model && typeof model.labelsOf === "function") ? model.labelsOf(mailbox) : [];
          var crud = root.mailLabelCrud;
          // #06 registry merge: knownLabels(observed, registry) unions the ids the mailbox WEARS with the
          // full registry records (real names/colors, incl. empty labels no message wears yet); movableLabels
          // drops system labels. Cold-safe: no crud module -> the observed id set, exactly as before.
          var mergeMovable = function (registry) {
            return (crud && typeof crud.knownLabels === "function")
              ? movableLabels(crud.knownLabels(observedLabels, registry || []))
              : movableLabels(observedLabels);
          };
          var manage = {
            modifyFn: makeModifyFn({ getGrant: function () { return cfg.grant; } }),
            // email-app #06 picker-paint (email-deepen) — the label-CRUD seam, threaded EXACTLY like
            // modifyFn above (grant from the live send config, _fetch injectable for tests). Cold-safe:
            // absent the mail-label-crud.js module (its <script> tag is Baton'd to email-views and may
            // not be loaded yet), labelFn is null and the picker's create/rename affordances simply do
            // not render — the leg-13 toggles are untouched (honest: no capability, no button). K1 holds
            // by construction: makeLabelFn exposes create/patch only, never a delete op.
            labelFn: (root.mailLabelCrud && typeof root.mailLabelCrud.makeLabelFn === "function")
              ? root.mailLabelCrud.makeLabelFn({ getGrant: function () { return cfg.grant; }, _fetch: opts._fetch })
              : null,
            // email-app #11 B2 — keep the one-click button on the upgraded (manage) pane too.
            unsubscribeFn: makeUnsubscribeFn({ _fetch: opts._fetch }),
            canManage: true,
            account: cfg.account || null,
            readLater: rl,   // leg 16 — keep the local read-later toggle on the upgraded pane too
            // leg 13 + #06 registry merge — the movable labels feed the manage bar's label picker. Starts
            // observed-only (mergeMovable([])), then lights up with real names when the registry read lands.
            labels: mergeMovable([]),
            // leg 7.1 — list-refresh after a successful archive: splice the message out of the
            // in-memory inbox projection and re-paint (re-renders the list + re-counts). Closure
            // access to mailbox/paint/input is why this lives here, not in detailView.
            onArchived: function (msg) {
              var i = mailbox.indexOf(msg);
              if (i >= 0) mailbox.splice(i, 1);
              paint(input.value);
            }
          };
          clearNode(body);
          body.appendChild(detailView(doc, m, showList, onReply, manage, onForward, onReplyAll));
          // #06 READ: light the picker up with the full label REGISTRY (system + user, incl. just-created
          // empty labels no message wears). makeListFn POSTs { op:'list' } to /intent/label (read-only, no
          // Warrant). On a good non-empty read, re-merge observed ∪ registry (now carrying real names) and
          // re-paint the manage bar; a failed/empty/absent read leaves the observed-only bar already shown.
          if (crud && typeof crud.makeListFn === "function") {
            crud.makeListFn({ getGrant: function () { return cfg.grant; }, _fetch: opts._fetch })({ account: cfg.account || null })
              .then(function (res) {
                if (!res || !res.ok || !Array.isArray(res.labels) || !res.labels.length) return;
                manage.labels = mergeMovable(res.labels);
                clearNode(body);
                body.appendChild(detailView(doc, m, showList, onReply, manage, onForward, onReplyAll));
              }, function () { /* registry read failed -> keep the observed-only manage bar */ });
          }
        }, function () { /* resolve failed -> keep the read-only pane already shown */ });
      }
    }

    // leg 15 — append one thread-record to the list (the conversation render).
    // count === 1 -> a plain row, NO fold affordance (a singleton — a real one-message
    // thread OR a threadless mbox message, which the model already made its own singleton).
    // count  >  1 -> a foldable head row (latest as face + count chip); when open, its
    // members render as indented child rows below it, each openable into the detail view.
    function appendThreadRecord(rec) {
      if (!rec) return;
      if (rec.count === 1) {
        list.appendChild(messageRow(doc, rec.latest || (rec.messages && rec.messages[0]), openDetail, null, selectCtl, rowActionsCtl, snoozeCtl, declineCtl, screenCtl));
        return;
      }
      var tid = String(rec.threadId);
      var isOpen = threadExpanded[tid] === true;
      list.appendChild(threadHeadRow(doc, rec, isOpen, function () {
        threadExpanded[tid] = !isOpen;   // toggle; expand-state persists in the closure across re-paints
        paint(input.value);
      }));
      if (isOpen) {
        // members are already newest-first from the model; indent each as a child row.
        rec.messages.forEach(function (m) {
          list.appendChild(messageRow(doc, m, openDetail, "row--thread-child", selectCtl, rowActionsCtl, snoozeCtl, declineCtl, screenCtl));
        });
        // The Rest (delight #7) — a LONG conversation read to the end comes to rest.
        // Fire ONLY on a verified all-messages-read: theRest.threadState derives the
        // honest (state, count) from the thread's own messages (any unknowable member
        // -> unreachable -> silence), and the shipped SC-2 gate decides fire/silence.
        // Record-scale settle, at the foot of the expanded conversation. paint() rebuilds
        // the list wholesale, so a member later marked unread retracts it on the next
        // paint (no stale "done"). Cold-safe: no theRest -> nothing rendered.
        var theRest = root.theRest;
        if (theRest && typeof theRest.threadState === "function" && typeof theRest.render === "function") {
          var ts = theRest.threadState(rec);
          var restNode = theRest.render(doc, ts.state, ts.count);
          if (restNode) {
            var restLi = el(doc, "li", "mail-thread__rest");
            restLi.setAttribute("data-rest", "1");
            restLi.appendChild(restNode);
            list.appendChild(restLi);
          }
        }
      }
    }

    function paint(query) {
      // #8 slice ② — the whole-corpus affordance: attach "Search all Gmail" only while there's a
      // query to send (detach when the box is cleared), and clear any prior server results (a changed
      // query invalidates them — reversible). Attach/detach is portable (no CSS-fragile [hidden]).
      var qStr = String(query == null ? "" : query).trim();
      if (qStr && !searchAllBtn.parentNode) searchWrap.appendChild(searchAllBtn);
      else if (!qStr && searchAllBtn.parentNode) searchWrap.removeChild(searchAllBtn);
      clearServerResults();
      // email-app #8 slice ③ — the search strip now drives the Gmail-operator grammar
      // (model.searchQuery: from:/subject:/is:/label:/category:/before:/after:, "quoted phrases",
      // -negation, AND-combined). Cold-safe LADDER: searchQuery (the grammar) -> search (plain
      // substring, older model) -> the raw mailbox (no model). A bare term routes through
      // searchQuery as free text, so the plain-search behavior is preserved with zero backend change.
      // ⚠ T5 — THE SCREEN. THE PRECONDITION, AND IT IS NOT PART OF THE STACK BELOW.
      // Everything after this line — search, unread, label, spam, trash, type, snooze, decline,
      // from-chips — is an endofunction on ONE message list, and they chain. The screen is not one
      // of them: it is a predicate on SENDERS, pulled back along sender to messages, and it runs
      // HERE — ahead of search, outside the chain, on `mailbox` itself. An unheld sender's mail was
      // never IN the inbox to be searched, snoozed or declined in the first place. Do not "simplify"
      // this into the overlay stack below; the ordering question it looks like it belongs to is
      // exactly the question this placement dissolves. (Tamar, RCR R1.)
      //
      // ⚠ THREE VERDICTS, TWO OF THEM OUT OF THE INBOX. `held` (undecided, awaiting him) and
      // `denied` (he said no) are DIFFERENT STATES with the SAME inbox consequence: NEITHER IS IN
      // IT. The inbox predicate is `verdict === APPROVED` — the module's inInbox(), delegated. It is
      // NEVER re-derived as the negation of one of the other two: an earlier draft filtered on
      // `!isHeld` and quietly put every DENIED sender's mail straight back in front of him, with a
      // green store and a full Denied view to "prove" the feature worked. The bug lived in the one
      // surface nobody writes a test for, because it is the default. hide() is the single predicate.
      //
      // Cold-safe: module absent -> `screened` IS `mailbox` and the curtain is simply not hung.
      var screened = mailbox;
      if (screenStore && typeof screenStore.hide === "function") {
        screened = currentScreening ? screenStore.only(mailbox)                 // the undecided letters
                 : currentDeniedSenders ? screenStore.denied(mailbox)           // the record (+ the way back)
                 : screenStore.hide(mailbox);                                   // every other view: APPROVED only
      }
      var found = model && typeof model.searchQuery === "function"
        ? model.searchQuery(screened, query)
        : (model && typeof model.search === "function"
            ? model.search(screened, query)
            : (screened || []));
      // leg 10 — filter (unread + label) between search and sort; cold-safe if unavailable.
      var filtered = model && typeof model.filterMailbox === "function"
        ? model.filterMailbox(found, { unread: currentUnread, label: currentLabel || null })
        : found;
      // leg 16 (#13) — read-later narrowing, a LOCAL overlay filter (not a model/label filter,
      // so filterMailbox stays label-pure). Applied after unread/label, before sort.
      if (currentReadLater) filtered = filtered.filter(function (m) { return rl.has(m.id); });
      // #10 — the SPAM view (email-views). ONE seam: delegate the SPAM-label narrowing to the
      // module (host hands it the list in hand; it returns the spam subset). A client-side overlay
      // like read-later, applied after unread/label, before sort. Cold-safe: module absent -> no-op.
      if (currentSpam && spamView && typeof spamView.filter === "function") filtered = spamView.filter(filtered);
      if (currentTrash && trashView && typeof trashView.filter === "function") filtered = trashView.filter(filtered);
      // #22a — the HAS-ATTACHMENT view (filter-chips). ONE seam: delegate the narrowing to the module
      // (returns only messages carrying a downloadable attachment). A client overlay like spam, applied
      // after unread/label, before sort. Cold-safe: module absent or view not selected -> no-op.
      if (currentHasAttachment && attachmentFilter && typeof attachmentFilter.filter === "function") filtered = attachmentFilter.filter(filtered);
      // T3 — the TYPE view. A client overlay like spam / has-attachment, applied after unread/label,
      // before sort. READ-ONLY: it narrows what is SHOWN and destroys nothing. Cold-safe: module
      // absent or no type picked -> no-op (currentType guards the whole call).
      if (currentType && mailType && typeof mailType.filter === "function") filtered = mailType.filter(filtered, currentType);
      // #12 — SNOOZE (email-views, the calm form). TWO seams, both delegated to the module:
      // (1) dueClear(now) SILENTLY auto-resurfaces items whose time has passed — no badge, no
      // notice; they simply drop from the store and re-appear here on their own. (2) the view:
      // the Snoozed view-word shows ONLY still-snoozed items; every other view HIDES them. A
      // client overlay like spam / read-later, applied after unread/label, before sort. Cold-safe:
      // module absent -> no-op (both calls guarded). READ-ONLY on the model (parity holds).
      if (snoozeStore && typeof snoozeStore.dueClear === "function") snoozeStore.dueClear(snoozeNow);
      // ⚠ `!currentDeclined` is LOAD-BEARING, not defensive noise. Snooze and decline are the two
      // store-backed overlays and a message can be in BOTH (you snoozed it Tuesday, you declined it
      // Friday). Without this guard, snooze's hide() would strip that message from `filtered` BEFORE
      // decline's only() ever ran — and it would be missing from the Declined view, the one view whose
      // whole job is to be a COMPLETE record of what you decided. A decision that silently isn't in its
      // own record is worse than no record. So: inside the Declined view, snooze's view-narrowing is
      // suspended (dueClear above still runs — that is store maintenance, not a view).
      if (!currentDeclined && snoozeStore && typeof snoozeStore.only === "function") {
        filtered = currentSnoozed ? snoozeStore.only(filtered, snoozeNow) : snoozeStore.hide(filtered, snoozeNow);
      }
      // T1 — DECLINE (the Thing-list line). ONE seam, delegated to the module, and the OUTER gate of
      // the two: the Declined view-word shows ONLY declined mail; EVERY other view hides it — including
      // Snoozed, including Spam, including the type views. That total hiding is the difference between
      // a decision and a deferral: `decline` has no dueClear, no resurface, no timer (see the module's
      // header), so nothing here ever puts a declined message back in front of you. The ONLY route back
      // is the row's un-decline button — manual, deliberate, and yours. Cold-safe: module absent -> no-op.
      if (declineStore && typeof declineStore.only === "function") {
        filtered = currentDeclined ? declineStore.only(filtered) : declineStore.hide(filtered);
      }
      // #22b — the FROM filter (email-views). ONE seam: delegate the sender narrowing to the
      // module (host hands it the list in hand; it returns the one-sender subset). A client-side
      // overlay like spam / read-later, applied after unread/label, before sort. Cold-safe:
      // module absent or no sender picked -> no-op (currentFrom guards the whole call).
      if (currentFroms.length && fromChips && typeof fromChips.filterAny === "function") filtered = fromChips.filterAny(filtered, currentFroms);
      else if (currentFroms.length && fromChips && typeof fromChips.filter === "function") filtered = fromChips.filter(filtered, currentFroms[0]);   // cold-safe: pre-multi module
      // label chip filter (email-views) — a client overlay UNION over m.labels: the list shows
      // mail carrying ANY selected label. Composes on top of the rail's model-side currentLabel
      // (AND across facets). Cold-safe: module absent or empty set -> no-op (guarded by length).
      if (currentLabels.length && labelChips && typeof labelChips.filterAny === "function") filtered = labelChips.filterAny(filtered, currentLabels);
      // sort the filtered result (search/filter preserve order; sort orders it) — cold-safe if unavailable
      var shown = model && typeof model.sortMailbox === "function"
        ? model.sortMailbox(filtered, currentOrder)
        : filtered;
      lastShown = shown;   // #23 — remember what's on screen for "select all in view"
      if (snoozeCtl) snoozeCtl.viewing = currentSnoozed;   // #12 — row affordance reflects the current view mode
      clearNode(list);
      if (currentGroup === "thread") {
        // leg 15 — CONVERSATION render (collapse-to-one-row). A DIFFERENT fold than the
        // sectioned views: a multi-message thread renders as ONE foldable row (latest as the
        // face + a count chip), expanding to its members as indented child rows. The renderer
        // NEVER re-implements grouping — it calls model.groupByThread (the model owns the fold key).
        // Cold-safe: no groupByThread -> each message is its own singleton (a flat list, honestly).
        var records = model && typeof model.groupByThread === "function"
          ? model.groupByThread(shown)
          : shown.map(function (m) { return { threadId: null, messages: [m], count: 1, latest: m }; });
        records.forEach(function (rec) { appendThreadRecord(rec); });
      } else if (currentGroup) {
        // #2/#3/#4 — sectioned render. Each group gets a header li (label · count) then its rows,
        // through the SAME row grammar (no new block). The header is an element of the list block.
        groupMailbox(shown, currentGroup, groupNow).forEach(function (g) {
          list.appendChild(el(doc, "li", "mail-list__group", {
            text: g[0] + " \u00b7 " + g[1].length,
            role: "presentation",
            "aria-label": g[0] + ", " + g[1].length + " message" + (g[1].length === 1 ? "" : "s")
          }));
          g[1].forEach(function (m) { list.appendChild(messageRow(doc, m, openDetail, null, selectCtl, rowActionsCtl, snoozeCtl, declineCtl, screenCtl)); });
        });
      } else {
        shown.forEach(function (m) { list.appendChild(messageRow(doc, m, openDetail, null, selectCtl, rowActionsCtl, snoozeCtl, declineCtl, screenCtl)); });
      }
      var total = (mailbox || []).length;
      var narrowed = (query && String(query).trim()) || currentUnread || currentLabel || currentReadLater || currentSpam || currentTrash || currentSnoozed || currentHasAttachment || currentType || currentDeclined || currentScreening || currentDeniedSenders || currentFroms.length || currentLabels.length;
      tag.textContent = narrowed
        ? shown.length + " of " + total + " message" + (total === 1 ? "" : "s")
        : total + " message" + (total === 1 ? "" : "s") + " \u00b7 your mail";
      // keep the opt-in unread number honest after a mutation (archive / mark-unread
      // re-paint the list); the count is whole-mailbox, so search/filter never move it.
      paintCountSlot();
      // #23 — keep the bulk bar's count in sync after any re-paint (a selected message
      // that got spliced out on archive drops from the count honestly).
      paintBulkBar();
      // T5 / seq=469 — the sender-auth ceiling, shown in the Screening view (see its declaration).
      paintScreenNote();
      // ①a — keep the rail's counts + active slot in sync (counts are whole-mailbox, so they
      // move on refresh/archive/undo, not on search; repainting here is cheap and always correct).
      repaintRail();
      // ⚠ T5 — THE DRAIN, and it is THE LAST LINE OF paint() ON PURPOSE. The render above is
      // COMPLETE and SYNCHRONOUS before this fires: paint() has already read the store, drawn what
      // it knows, and is about to return. drainScreen() starts network work and does NOT block —
      // paint() stays sync (TRAP 1) and this stays off the paint path. When a lookup lands and
      // actually moves someone into the inbox, it asks for ONE repaint. Nothing here is awaited.
      // Do not hoist this above the render, and do not `await` it. See the drain's header.
      drainScreen();
    }

    // live filter — re-fold on every keystroke (mailbox is already in hand).
    input.addEventListener("input", function () { paint(input.value); });
    // live sort — re-order the current (possibly filtered) view when the order changes.
    sortSelect.addEventListener("change", function () { currentOrder = sortSelect.value || "newest"; paint(input.value); });
    // live filter (leg 10) — re-fold the current view when the unread/label narrowing changes.
    unreadSelect.addEventListener("change", function () { var v = unreadSelect.value; currentUnread = v === "unread"; currentReadLater = v === "readlater"; currentSpam = v === "spam"; currentTrash = v === "trash"; currentSnoozed = v === "snoozed"; currentHasAttachment = v === "attachments"; currentType = (v === "letter" || v === "notification") ? v : (v === "unclassified" ? "unknown" : ""); currentDeclined = v === "declined"; currentScreening = v === "screening"; currentDeniedSenders = v === "denied-senders"; paint(input.value); paintActiveFilters(); });   // T5: the two screen views
    // Label picker (chip upgrade) — ADDS a label to the active set (a chip apiece);
    // "All labels" clears the set; each chip's × removes one. paint() unions the set.
    // The rail keeps currentLabel for its primary views — the select no longer sets it.
    labelSelect.addEventListener("change", function () {
      var v = labelSelect.value || "";
      if (v === "") { currentLabels = []; }                                       // "All labels" = clear all
      else if (labelChips && typeof labelChips.toggle === "function") { currentLabels = labelChips.toggle(currentLabels, v); }
      else if (currentLabels.indexOf(v) === -1) { currentLabels = currentLabels.concat([v]); }  // cold-safe add
      labelSelect.value = "";                                                     // reset to add another
      paint(input.value);
      paintActiveFilters();                                                       // (v9) chips render in the unified row
    });
    // #22b (chip upgrade) — the From picker ADDS a sender to the active set (a chip apiece),
    // "All senders" clears the whole set; each chip's × removes one. paint() unions the set.
    fromSelect.addEventListener("change", function () {
      var v = fromSelect.value || "";
      if (v === "") { currentFroms = []; }                                   // "All senders" = clear all
      else if (fromChips && typeof fromChips.toggle === "function") { currentFroms = fromChips.toggle(currentFroms, v); }
      else if (currentFroms.indexOf(v) === -1) { currentFroms = currentFroms.concat([v]); }  // cold-safe add
      fromSelect.value = "";                                                 // reset the picker to add another
      paint(input.value);
      paintActiveFilters();                                                  // (v9) chips render in the unified row
    });
    // ①a — the strip selects and the rail drive the same filter; paint() repaints the rail, so
    // changing a select re-lights the matching rail slot with no extra handler needed.
    // live clustering view (email-app #2/#3/#4) — re-fold the current view into sections (or flat).
    groupSelect.addEventListener("change", function () { currentGroup = groupSelect.value || ""; paint(input.value); paintActiveFilters(); });
    // ①b — density moved off the strip to Settings (v9); it is applied at build from opts.density
    // (applyDensity() at the resting-density call above), no strip listener remains here.
    paint("");
    paintActiveFilters();                             // (v9) seed the unified chip row + toggle count
    showList(); // mount the list view into the swap host
    // E1 — cross-app compose bridge (contacts -> mail). Expose THIS live view's opener so a
    // forest:compose intent (dispatched by a contacts record's "Email" action, routed by the
    // shell host) can open a compose pre-addressed over the live mailbox — and consume any
    // intent that arrived before this view was built (mail may still be loading its lazy read).
    // Mail owns compose (TC-1: the caller only carried the address). Placed AFTER showList so
    // the compose overlay is not cleared by the list mount. Cold-safe: any throw leaves the
    // mailbox exactly as it rendered.
    try {
      root.mailRenderer.__liveOpenCompose = function (to) { if (to) openCompose({ to: to, isReply: false }); };
      var pendingCompose = root.mailRenderer.__pendingCompose;
      if (pendingCompose && pendingCompose.to) {
        root.mailRenderer.__pendingCompose = null;
        openCompose({ to: pendingCompose.to, isReply: false });
      }
    } catch (e) { /* cold-safe: the bridge is best-effort; the mailbox still renders */ }

    /* ---- owed 779 · the SEARCH open-by-id bridge ------------------------------ *
     * Mail is the ONE store where this is not a one-key stub. contacts/calendar's  *
     * openRecord reads only `.id` and fetches the record itself; mail's openDetail *
     * takes a HYDRATED message (from, subject, body, account, messageId) and does  *
     * no fetch of its own. So this seam has to hydrate first.                      *
     *                                                                              *
     * ★ It does NOT need a new transport. `fetchNewFn` — the per-id CONTENT        *
     * HYDRATE seam built for the #24 delta path (POST /connectors/messages         *
     * {provider,ids} -> rows) — is a closure SIBLING of openDetail, and            *
     * `mailboxFromExport` is the same tested parser the mailbox and the search     *
     * store both read through. This composes two seams that were already touching. *
     *                                                                              *
     * ★★ It hydrates rather than scanning the loaded mailbox, and that is the      *
     * load-bearing choice. A search hit routinely names mail OUTSIDE the current   *
     * view — an older page, another label, a thread the mailbox never folded. A    *
     * local scan would find those hits absent and open NOTHING, which is the exact *
     * "lands nowhere" defect this owed exists to kill, moved one layer inward and  *
     * made SILENT. The network call is what contacts and calendar already pay      *
     * (api.get) on every record open.                                              *
     *                                                                              *
     * A failed hydrate paints the server's real reason and a way back. It never    *
     * leaves the operator staring at an inbox wondering why the click did nothing. */
    try {
      root.mailRenderer.__liveOpenById = function (id) {
        var mid = String(id == null ? "" : id);
        if (!mid) return;
        clearNode(body);
        body.appendChild(el(doc, "p", "mail-loading", { text: "Reading \u2026" }));
        Promise.resolve(fetchNewFn([mid])).then(function (res) {
          var msgs = (res && res.ok && res.rows && res.rows.length &&
                      model && typeof model.mailboxFromExport === "function")
            ? model.mailboxFromExport({ items: res.rows })
            : [];
          if (msgs && msgs.length) { openDetail(msgs[0]); return; }
          clearNode(body);
          body.appendChild(el(doc, "p", "mail-loading", {
            text: (res && res.error) || "Couldn\u2019t open that message."
          }));
          var back = el(doc, "div", "mail-detail__back record__back",
            { role: "button", tabindex: "0", text: "\u2190 Inbox" });
          back.addEventListener("click", showList);
          body.appendChild(back);
        });
      };
      var pendingOpenId = root.mailRenderer.__pendingOpenId;
      if (pendingOpenId) {
        root.mailRenderer.__pendingOpenId = null;
        root.mailRenderer.__liveOpenById(pendingOpenId);
      }
    } catch (e2) { /* cold-safe: the bridge is best-effort; the mailbox still renders */ }
    // #23 — resolve the gmail modify grant ONCE (shares getSendConfig's cache with the
    // reading pane), then light up bulk selection. No live grant -> canBulk stays false:
    // no checkboxes, no bar (the same honest gate the single manage bar uses). Cold-safe:
    // a resolve failure leaves the read view exactly as it was.
    getSendConfig().then(function (cfg) {
      cfg = cfg || {};
      if (!cfg.canSend) return;
      bulkGrant = cfg.grant;
      bulkAccount = cfg.account || null;
      batchModifyFn = makeBatchModifyFn({ getGrant: function () { return bulkGrant; }, _fetch: opts._fetch });
      canBulk = true;
      selectCtl.enabled = true;
      // ①b — same grant lights up the per-ROW modify path (star/important/archive on a row).
      rowActionsCtl.modifyFn = makeModifyFn({ getGrant: function () { return bulkGrant; }, _fetch: opts._fetch });
      rowActionsCtl.account = bulkAccount;
      rowActionsCtl.canManage = true;
      paint(input.value);   // re-paint so selectable rows grow their checkboxes
    }, function () { /* resolve failed -> bulk stays off; the read view is intact */ });
    return wrap;
  }

  /* ---- honest panes (Real-or-Made: never a fabricated inbox) ---------------- */
  function signInPane(doc) {
    var wrap = el(doc, "div", "mail mail--absent");
    wrap.appendChild(el(doc, "p", "pane__absent", {
      text: "Sign in to load your mail. Your mailbox reads your own Soil, under your session \u2014 nothing to show until you\u2019re signed in."
    }));
    return wrap;
  }
  function emptyPane(doc) {
    var wrap = el(doc, "div", "mail mail--empty");
    // The Clearing (delight #1). This branch is reached ONLY on a VERIFIED read —
    // nodeFromOutcome routes `unreachable`/`signed-out` to their own panes — so the
    // mailbox here is a real KNOWN-zero: the honest fire condition (SC-2). Render the
    // calm settle above the onboarding line; it says the true thing (the inbox is at
    // rest) whether the box was just cleared or is not yet synced. Cold-safe: if
    // theClearing is not loaded, render() is unavailable and the settle is simply
    // omitted — the pane is byte-identical to before (no regression), and the honest
    // guidance line below stands alone.
    var tc = root.theClearing;
    var settle = (tc && typeof tc.render === "function") ? tc.render(doc, "known", 0) : null;
    if (settle) wrap.appendChild(settle);
    wrap.appendChild(el(doc, "p", "pane__pending", {
      text: "No mail yet \u2014 sync a source (Gmail is adapter #1) to grow your mailbox."
    }));
    return wrap;
  }
  function noModelPane(doc) {
    var wrap = el(doc, "div", "mail mail--absent");
    wrap.appendChild(el(doc, "p", "pane__absent", { text: "The mail model isn\u2019t loaded." }));
    return wrap;
  }

  /* ---- the honest reachability glance (§3f / honest-badge) ------ *
   * The badge is the mail view's PRIMARY status atom. In a mail context an item   *
   * has no due-date, so the honest state is the MAILBOX's reachability: did the   *
   * last read reach the truth (clear) or not (unreachable)? It binds ONLY to the  *
   * real fetch outcome — never a fabricated "clear" (Real-or-Made). The badge     *
   * module carries the H3 form (solid chip vs hollow dashed ring) intrinsically,  *
   * so the state survives a color-stripped / dead-stylesheet read. Cold-safe: no  *
   * honestBadge module or no document -> the glance is simply omitted, never a    *
   * thrown boot. */
  function reachGlance(doc, state, opts) {
    var hb = root.honestBadge;
    if (!hb || typeof hb.render !== "function") return null;   // module not loaded -> no glance, never a crash
    var span = hb.render(doc, state, opts || {});
    if (!span) return null;
    var line = el(doc, "div", "mail__reach");
    line.appendChild(span);
    return line;
  }

  /* The honest UNREACHABLE pane: the server couldn't be reached, so we say so —
     we do NOT render a stale inbox as current (§3f: a sync failure renders
     `unreachable`, never yesterday's mail dressed as today's). The voice is SM-1:
     plain fact, no blame, promise of continuity. */
  function unreachablePane(doc) {
    var wrap = el(doc, "div", "mail mail--unreachable");
    var g = reachGlance(doc, "unreachable");
    if (g) wrap.appendChild(g);
    wrap.appendChild(el(doc, "p", "pane__absent", {
      // — the sentence used to say "we'll refresh when we're back," which was
      // a PROMISE NOTHING KEPT: every piece of mail's refresh machinery (the button,
      // runRefresh, fullRefresh, the 3-minute poll) lives inside buildMailboxView, which
      // only runs on reach:"ok". Mail's clock only ticked when mail was already working.
      // The promise is now kept by reach-recovery.js (the ladder + the Try again button
      // that renderMail hangs under this pane), so the copy no longer has to carry it —
      // the recovery bar says what is actually happening, second by second. This sentence
      // keeps the part that was always true: we are not showing you a stale inbox.
      text: "Couldn\u2019t reach your mail just now. Nothing\u2019s lost \u2014 this isn\u2019t showing you a stale inbox as current."
    }));
    return wrap;
  }

  /* ---- export -> a rendered node (the shared join point) --------------------- *
   * exportPayload: the GET /export/soil body ({ items:[...] }) or an items array. *
   *   null      -> honest sign-in pane (no session)                               *
   *   no mail   -> honest empty pane                                              *
   *   mail rows -> the mailbox view                                              */
  function nodeFromExport(doc, exportPayload, opts) {
    var model = mm();
    if (!model || typeof model.mailboxFromExport !== "function") return noModelPane(doc);
    if (exportPayload === null || exportPayload === undefined) return signInPane(doc);
    var mailbox = model.mailboxFromExport(exportPayload);
    if (!mailbox || !mailbox.length) return emptyPane(doc);
    return buildMailboxView(doc, mailbox, opts);
  }

  /* Map a DISCRIMINATED read outcome ({reach, payload}) to a pane. This is where
     the honest reachability split lands: `unreachable` gets its own honest pane
     (never the sign-in pane a dropped connection used to be mislabeled as), and
     only a VERIFIED `ok` read reaches the mailbox view. Back-compat: a bare
     payload (the legacy injected `mailExport`) still routes through nodeFromExport. */
  function nodeFromOutcome(doc, outcome, opts) {
    if (outcome && typeof outcome === "object" && Object.prototype.hasOwnProperty.call(outcome, "reach")) {
      if (outcome.reach === "ok") return nodeFromExport(doc, outcome.payload, opts);  // the VERIFIED read
      if (outcome.reach === "signed-out") return signInPane(doc);
      return unreachablePane(doc);   // "unreachable" OR any unknown/ambiguous -> honest couldn't-reach (Real-or-Made)
    }
    return nodeFromExport(doc, outcome, opts);       // legacy bare-payload path
  }

  /* ---- the credentialed lazy read (production) ------------------------------ *
   * Returns a DISCRIMINATED outcome, not a bare payload — the honest signal the   *
   * reachability badge binds to. Three real states, never collapsed:             *
   *   { reach:"ok",          payload }  — the read VERIFIED (r.ok): render mail    *
   *   { reach:"signed-out",  payload:null } — 401/403 / no session: honest sign-in *
   *   { reach:"unreachable", payload:null } — network error OR server error (5xx): *
   *        we could not reach the truth, so the badge SAYS so (never a stale inbox *
   *        dressed as current, never "sign in" mislabeling a dropped connection).  *
   * Real-or-Made: an ambiguous failure coerces toward `unreachable` (honest       *
   * "couldn't reach"), NEVER toward `ok`. Cold-safe: no fetch -> signed-out.       */
  function readExport() {
    var RT = (root.runtimeBase || (typeof window !== "undefined" && window.FOREST_RUNTIME) || "");
    if (typeof fetch !== "function") return Promise.resolve({ reach: "signed-out", payload: null }); // cold-safe -> sign-in
    return fetch((RT || "") + "/export/soil", { cache: "no-store", credentials: "include" })
      .then(function (r) {
        if (r && r.ok) return r.json().then(function (j) { return { reach: "ok", payload: j }; });
        // no session -> honest sign-in; any other non-ok (5xx &c.) -> couldn't reach the truth
        var st = r && r.status;
        if (st === 401 || st === 403) return { reach: "signed-out", payload: null };
        return { reach: "unreachable", payload: null };
      })
      .catch(function () { return { reach: "unreachable", payload: null }; });  // network — couldn't reach
  }

  /* ---- the pane renderer (kind "mail") -------------------------------------- *
   * pane.render dispatches renderers SYNCHRONOUSLY over ctx.data, so:            *
   *   • injected export (ctx.data.mailExport present) -> render now (test path)   *
   *   • otherwise -> paint a calm "reading…" line, then fill from the lazy read   *
   *     (the pane node is a live reference; the async swap fills it in place).    */
  /* ---- the opt-in count, resolved from the view-config (§3f/§6.3) ------ *
   * Reads the off-by-default `count.enabled` bit from the view-config threaded    *
   * through ctx (viewConfig.countEnabled), and builds an onCountToggle that       *
   * PERSISTS the user's choice by dispatching forest:count-toggle up to the host  *
   * (shell-boot listens and saves the bit) — the direct twin of the badges        *
   * toggle. Entirely cold-safe: no viewConfig -> off; no CustomEvent / no pane    *
   * -> the toggle is a silent no-op; the view still repaints its own slot.        */
  function countOptsFrom(ctx, paneEl) {
    var vc = root.viewConfig;
    var cfg = ctx && ctx.config;
    var pcfg = cfg || {};   // #24 follow-on #3: ctx.config also carries the optional _poll test seam
    var enabled = (vc && typeof vc.countEnabled === "function") ? !!vc.countEnabled(cfg) : false;
    return {
      countEnabled: enabled,
      // §7.2 — the rail's HOST. The frame's left column (.menu__body, handed to us on
      // ctx.menuBody by the pane pool's joint) is the rail's home: the block was always the
      // frame's, it was just sitting in mail's house (§1.2). NULL when the frame has no
      // [data-app-menu] host (tests / a frame without the column) -> buildMailboxView falls back
      // to a local host inside the pane, because .rail__compose is mail's ONE compose home
      // (block.css:1087) and a null menu must never silently cost the user the primary action.
      menuBody: (ctx && ctx.menuBody) || null,
      // ①c — the "Send to Forest" tree taxonomy. Sourced from the APP (app.js owns the canopy →
      // ASSIGNABLE_TREES via deriveAssignable, and publishes the picker-shaped list to the global
      // FOREST_MAIL_TREES — the same window.FOREST_* channel this renderer already reads account/grant
      // off). A test/host can override via ctx.data.forestTrees. Absent everywhere -> null -> the row
      // picker never renders (flag-don't-fake: never invent a taxonomy; the button stays dark until a
      // real tree list is wired). Each entry is { category, label } or a bare category string.
      forestTrees: (ctx && ctx.data && ctx.data.forestTrees)
        || root.FOREST_MAIL_TREES
        || (typeof window !== "undefined" && window.FOREST_MAIL_TREES)
        || null,
      // #8 slice ② — the fetch seam threads through so buildMailboxView's whole-corpus "Search all
      // Gmail" affordance can reach GET /projection/mail-search. In production this is absent and the
      // default over the global fetch + runtimeBase is used (like makeModifyFn); tests inject it.
      _fetch: ctx && ctx._fetch,
      // #24 follow-on #3 — the background-poll test seams ride ctx.config._poll (pane.render forwards
      // `config`, not arbitrary ctx keys). Production config carries no `_poll`, so the driver uses its
      // real defaults (global setInterval, 3-min cadence, no _exposePoll). Cold-safe by construction.
      pollIntervalMs: pcfg._poll && pcfg._poll.intervalMs,
      _setInterval: pcfg._poll && pcfg._poll.setInterval,
      _clearInterval: pcfg._poll && pcfg._poll.clearInterval,
      _exposePoll: pcfg._poll && pcfg._poll.expose,
      onCountToggle: function (on) {
        try {
          if (paneEl && typeof paneEl.dispatchEvent === "function" && typeof CustomEvent === "function") {
            paneEl.dispatchEvent(new CustomEvent("forest:count-toggle", { detail: { enabled: !!on }, bubbles: true }));
          }
        } catch (e) { /* cold-safe: persistence is best-effort; the in-place repaint already happened */ }
      },
      // v9 — row density, the value-carrying twin of countEnabled/onCountToggle.
      // Read the set-and-forget choice off the view-config (comfortable default; junk ->
      // comfortable via densityOf's normalize) and hand the mail view a callback that
      // PERSISTS a change by dispatching forest:density up to the host (shell-boot saves
      // it), exactly as onCountToggle dispatches forest:count-toggle. Cold-safe: no
      // viewConfig -> comfortable; no CustomEvent / no pane -> the callback is a no-op.
      density: (vc && typeof vc.densityOf === "function") ? vc.densityOf(cfg) : "comfortable",
      onDensityChange: function (v) {
        try {
          if (paneEl && typeof paneEl.dispatchEvent === "function" && typeof CustomEvent === "function") {
            paneEl.dispatchEvent(new CustomEvent("forest:density", { detail: { density: v }, bubbles: true }));
          }
        } catch (e) { /* cold-safe: persistence is best-effort */ }
      }
    };
  }

  function renderMail(paneEl, ctx) {
    var doc = paneEl.ownerDocument;
    // — the app name + V# are the ANCHOR's (top of the left column), written by the
    // joint for every app. The body pane no longer prints its own name. See §1.3/§2.
    // Version stamp (operator directive): a quiet number under "Mail", bumped every deploy, so
    // the live version is legible at a glance. Cold-safe: absent global (tests / no version.js) -> no
    // element, so the pane DOM is byte-identical to before wherever the stamp isn't provided.
    var host = el(doc, "div", "mail-host");
    paneEl.appendChild(host);

    var data = (ctx && ctx.data) || null;

    // §3f — resolve the OPT-IN unread count from the view-config threaded through
    // the pane ctx (off by default; §6.3). onCountToggle persists the user's choice by
    // dispatching forest:count-toggle up to the host (shell-boot), exactly as the badges
    // toggle dispatches forest:badges-toggle — the view repaints itself in-place, the host
    // just saves the bit so it survives a reload. Cold-safe: no viewConfig / no CustomEvent
    // -> count simply stays off and the toggle is a no-op, never a boot throw.
    var mailOpts = countOptsFrom(ctx, paneEl);

    // INJECTED, discriminated (tests / host pre-fetch that knows reachability):
    //   ctx.data.mailReach = "ok" | "signed-out" | "unreachable" (+ mailExport for "ok")
    if (data && Object.prototype.hasOwnProperty.call(data, "mailReach")) {
      host.appendChild(nodeFromOutcome(doc, { reach: data.mailReach, payload: data.mailExport }, mailOpts));
      return;
    }
    // INJECTED, legacy bare payload (unchanged): ctx.data.mailExport, null -> sign-in.
    if (data && Object.prototype.hasOwnProperty.call(data, "mailExport")) {
      host.appendChild(nodeFromExport(doc, data.mailExport, mailOpts));
      return;
    }

    // LAZY path (production): calm placeholder, then the credentialed read. In parallel, ask the runtime
    // which held sends expired on its last restart (owner-gated, one-time) and render that notice ABOVE the
    // mailbox so the owner sees it first. Both are cold-safe: the mailbox falls to the unreachable pane on
    // an unexpected throw; the notice reader yields [] on signed-out / network / nothing-expired and the
    // builder returns null on an empty list, so the common case is byte-unchanged (no notice node).
    host.appendChild(el(doc, "p", "pane__pending", { text: "Reading your mailbox\u2026" }));
    Promise.all([
      readExport(),
      readUndoExpired({ _fetch: ctx && ctx._fetch })
    ]).then(function (results) {
      var outcome = results[0];
      var expired = results[1];
      clearNode(host);
      var notice = undoExpiredNotice(doc, expired, {});
      if (notice) host.appendChild(notice);   // above the mailbox — the owner sees the restart notice first
      paintOutcome(doc, host, outcome, mailOpts);
    }).catch(function () {
      clearNode(host);
      paintOutcome(doc, host, { reach: "unreachable", payload: null }, mailOpts);  // an unexpected throw = couldn't reach the truth
    });
  }

  /* ---- the LAZY path's outcome painter — where the recovery hangs -------------- *
   * THE FAULT THIS CLOSES (docket `forest-unreachable-pane-never-retries`): mail's    *
   * unreachable pane was TERMINAL. Not slow to recover — terminal. The pane was       *
   * painted and renderMail RETURNED. No timer, no listener, no button anywhere on it. *
   * And the refresh machinery that would have saved it (refreshBtn, runRefresh,       *
   * fullRefresh, the 3-minute background poll) lives entirely INSIDE buildMailboxView,*
   * which only runs on reach:"ok" — so mail's clock only ticked when mail was already *
   * working. Every runtime deploy restarts the daemon and opens a 502 window; a tab   *
   * that read across that window stayed dead until a human reloaded, wearing a        *
   * sentence that promised otherwise.                                                 *
   *                                                                                   *
   * So an `unreachable` outcome no longer just paints. It hands its own sub-host to   *
   * reach-recovery, which hangs a "Try again" button under the honest pane and runs a *
   * bounded ladder (2/5/10/20/30s) against THE SAME readExport that just failed. When *
   * a rung lands, WE repaint through nodeFromOutcome — the recovery module never      *
   * paints a mailbox, because it does not know what one looks like, and a module that *
   * guessed would be the exact fabrication this reachability grammar exists to refuse.*
   *                                                                                   *
   * THE SUB-HOST IS NOT COSMETIC. reach-recovery clears its host on every repaint, and *
   * the undo-expired notice is a SIBLING of the mailbox in `host` — hand the recovery  *
   * the whole host and the first ladder rung silently eats the restart notice the      *
   * owner is meant to see first. The ladder gets its own box; the notice keeps its own.*
   *                                                                                    *
   * THE SIGNED-OUT STOP: a retry that resolves `signed-out` ENDS the ladder and routes  *
   * to the sign-in pane. A 401 is a Door, not a window — and after a runtime restart a  *
   * cookie can outlive the in-memory owner key ('s keyless session), so a *
   * ladder that kept knocking would spin forever against a tab that cannot recover by   *
   * being asked again. reach-recovery holds that rule; this note is why it isn't optional.*
   *                                                                                      *
   * Cold-safe: no reach-recovery module (a page that never loaded it, a suite that never *
   * required it) -> byte-identical to the old behaviour: the honest pane, and nothing    *
   * else. The INJECTED paths above deliberately get NO ladder — they are the test /     *
   * host-pre-fetch seam, and arming a live timer inside a suite is how a suite hangs.    *
   * Production reaches mail only through the lazy path, which is exactly this one.       */
  function paintOutcome(doc, host, outcome, mailOpts) {
    var rr = root.reachRecovery;
    var reach = outcome && outcome.reach;
    var unreachable = (reach !== "ok" && reach !== "signed-out");   // Real-or-Made: unknown coerces here
    if (unreachable && rr && typeof rr.attach === "function") {
      var box = el(doc, "div", "mail-recovery-host");
      host.appendChild(box);
      var handle = rr.attach(box, {
        doc: doc,
        outcome: outcome,
        read: readExport,
        classify: function (o) {
          if (o && o.reach === "ok") return "ok";
          if (o && o.reach === "signed-out") return "signed-out";
          return "unreachable";
        },
        failNode: function () { return unreachablePane(doc); },
        onResolve: function (o) { clearNode(box); box.appendChild(nodeFromOutcome(doc, o, mailOpts)); }
      });
      if (handle) return;                       // attached — the ladder owns this pane now
      host.removeChild(box);                    // attach declined (no doc) — leave no empty box behind
    }
    host.appendChild(nodeFromOutcome(doc, outcome, mailOpts));   // cold path — byte-identical to before
  }

  /* ---- registration (self-register if pane is already up; registerAll also
         picks us up in shell-renderers.js — cold-safe either order) ----------- */
  function register(pane) {
    pane = pane || root.pane;
    if (pane && typeof pane.registerRenderer === "function") {
      pane.registerRenderer("mail", renderMail);
      return true;
    }
    return false;
  }

  /* ---- E1 cross-app compose bridge: open a pre-addressed compose from another app ---- *
   * openComposeTo(to) is the mail-owned entry the shell host calls when a contacts record  *
   * dispatches forest:compose {to}. If a mail view is live, it opens compose over it now;   *
   * otherwise it stashes a pending intent that the next buildMailboxView consumes (mail may *
   * still be finishing its lazy read). Mail owns compose; the caller only carried the       *
   * address (TC-1). Cold-safe: falsy address -> no-op; a live-opener throw falls to pending. */
  function openComposeTo(to) {
    if (!to) return false;
    var mr = root.mailRenderer;
    if (mr && typeof mr.__liveOpenCompose === "function") {
      try { mr.__liveOpenCompose(to); return true; } catch (e) { /* fall through to pending */ }
    }
    if (mr) mr.__pendingCompose = { to: to };
    return true;
  }

  /* ---- owed 779 · the search open-by-id entry ------------------------------- *
   * openById(id) is the mail-owned entry the shell host calls when a search hit   *
   * {store:"mail", id} is clicked. Live mailbox -> hydrate + open the message now; *
   * cold mailbox -> stash a pending intent the next buildMailboxView consumes     *
   * (mail is the slowest of the three to mount — it is a live Gmail read — so the *
   * pending path is not a corner case here, it is the COMMON one on a cold tab).  *
   * Same shape as openComposeTo directly above; the E3 idiom's third application. *
   * Cold-safe: empty id -> false, no-op; a live-opener throw -> pending. Returns   *
   * whether the intent was ACCEPTED, not whether the message was found — the      *
   * hydrate is async and paints its own honest failure.                            */
  function openById(id) {
    var mid = String(id == null ? "" : id).trim();
    if (!mid) return false;
    var mr = root.mailRenderer;
    if (mr && typeof mr.__liveOpenById === "function") {
      try { mr.__liveOpenById(mid); return true; } catch (e) { /* fall through to pending */ }
    }
    if (mr) mr.__pendingOpenId = mid;
    return true;
  }

  /* ---- export --------------------------------------------------------------- */
  root.mailRenderer = {
    render: renderMail,
    // E1 — the cross-app compose entry (contacts "Email" -> pre-addressed compose).
    openComposeTo: openComposeTo,
    // owed 779 — the search open-by-id seam. shell-boot.js:499 calls this on forest:search-open.
    openById: openById,
    buildMailboxView: buildMailboxView,
    nodeFromExport: nodeFromExport,
    legibleBody: legibleBody,
    composeView: composeView,
    detailView: detailView,
    emailFromHeader: emailFromHeader,
    replySubject: replySubject,
    fwdSubject: fwdSubject,
    forwardBody: forwardBody,
    register: register,
    // email-app undo-send D1 — the restart-expiry notice (reader + builder; the poll-on-load surfacing)
    readUndoExpired: readUndoExpired,
    undoExpiredNotice: undoExpiredNotice,
    // leg 06 "build B" — send-grant + account wiring (resolve from the runtime; issue the grant)
    resolveSendConfig: resolveSendConfig,
    enableSending: enableSending,
    makeSendFn: makeSendFn,
    makeCancelSendFn: makeCancelSendFn,
    // email-app Track B #18 — the /intent/draft seam (save/list/get). Exported for unit tests;
    // wired into composeView (Save draft) and the drafts panel (openDrafts -> list/get -> resume).
    makeDraftFn: makeDraftFn,
    makeSettingsFn: makeSettingsFn,
    // email-app #27/#28 — the settings PANEL (Filters + Send-as/aliases/server-signature
    // + Vacation) over the makeSettingsFn seam. Pure builders, exported for the unit suite;
    // wired into the strip via openSettings(). filterActionShape/Options carry the client
    // half of the K1 no-auto-trash guard (no destructive action is constructable from the UI).
    filterActionOptions: filterActionOptions,
    filterActionShape: filterActionShape,
    buildSettingsPanel: buildSettingsPanel,
    gmailAccountFrom: gmailAccountFrom,
    gmailGrantKeyFrom: gmailGrantKeyFrom,
    // leg 07 — manage: the /intent/modify seam (label moves: archive / mark-unread)
    makeModifyFn: makeModifyFn,
    // #23 — bulk manage: the BATCH /intent/modify seam (itemIds[] -> conn.batchModify)
    makeBatchModifyFn: makeBatchModifyFn,
    makeUnsubscribeFn: makeUnsubscribeFn,
    // leg 13 — move-to-label: the movable-label filter feeding the manage bar's picker
    movableLabels: movableLabels,
    // slice ② — the honest reachability split + the badge, first-class in mail
    readExport: readExport,
    nodeFromOutcome: nodeFromOutcome,
    // — exported so mail-recovery.test.js can drive the LAZY path (the one production
    // takes, and the only one that was ever terminal). The injected paths were already reachable
    // via nodeFromOutcome; the lazy path was not testable at all, which is a fair part of why a
    // pane that never retried stayed green for as long as it did.
    renderMail: renderMail,
    paintOutcome: paintOutcome,
    unreachablePane: unreachablePane,
    reachGlance: reachGlance,
    countOptsFrom: countOptsFrom,
    // leg 15 (#20) — local, compose-only signature (localStorage; no model change)
    readSignature: readSignature,
    writeSignature: writeSignature,
    bodyWithSignature: bodyWithSignature,
    applySigToBody: applySigToBody,
    // leg 16 (#13) — local read-later overlay (localStorage; no model change, no gmail gate)
    rlHas: rlHas,
    rlToggle: rlToggle,
    rlIds: rlIds,
    // email-app #2/#3/#4 — the clustering views: a pure client-side grouping fold (no model change,
    // no scope). Exported for unit tests (deterministic `now`); the sectioned render is wired in paint().
    groupMailbox: groupMailbox,
    // email-app #11 — read-only unsubscribe surfacing: parse the RFC-2369 List-Unsubscribe URIs.
    parseUnsubscribe: parseUnsubscribe,
    // email-app leg 15 — the collapsed CONVERSATION face (count chip + fold caret over a row).
    // Exported for unit tests; the fold render + expand-state are wired in paint()/appendThreadRecord.
    threadHeadRow: threadHeadRow,
    // email-app #25 F2 — the source-provenance badge: sources[] -> one honest label
    // ("Gmail" / "mbox archive" / "Gmail + archive"), null when nothing honest to show.
    // Exported for unit tests; the chip is wired into messageRow + threadHeadRow.
    sourceBadgeLabel: sourceBadgeLabel,
    // email-app ①a — the navigation rail region (system-folder slots + Compose pill).
    // Pure builder; wired into buildMailboxView's cached list surface.
    renderRail: renderRail,
    // email-app ①b — the message row (monogram + star/important/archive affordances). Exported for tests.
    messageRow: messageRow,
    // 1.29.0 — T5 THE SCREENER's wire: the screen precondition, the Screening + Denied-senders
    // view-words, the row's approve/deny/un-screen controls, and the bounded (8-at-a-time),
    // screenAsked-guarded drain. Landed at 1.28.0 without moving this stamp; the map in
    // version.js mirrors THIS number and it is what the mail pane renders — so an unmoved stamp
    // means the deploy that LIGHTS the Screener would have shown the same number as the deploy
    // before it. Moved here, at the deploy.
    //
    // RULE (, the fold): touch this `_version` and you are DONE. There is no map to touch.
    // pane.js reads THIS field directly off the module (window.ForestShell.mailRenderer._version);
    // the hand-kept FOREST_APP_VERSIONS mirror in version.js is DELETED. The number the operator
    // reads under "Mail" IS this number. (The AGGREGATE FOREST_APP_VERSION still gates the deploy
    // and is still bumped by hand at deploy time — that one is a different stamp.)
    _version: "1.36"
  };

  register(); // no-op if pane not loaded yet; registerAll covers that case
})();
