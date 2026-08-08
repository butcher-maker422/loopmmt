'use strict';
/*
 * mail-model — the email-app's normalized, PROVIDER-AGNOSTIC mail model (build leg 1 core).
 *
 * email-app Charter (v1-locked 03.1954): "a read/search email client over a normalized mail model,
 * fed by import adapters behind one seam; Gmail-readonly is adapter #1." This module IS the
 * normalized model: it turns Forest Soil rows (the durable store the Catch sinks every import into)
 * into a searchable mailbox. It knows NOTHING about Gmail — it reads the stable content block any
 * source adapter writes, so a later adapter (Loop Email, IMAP, ...) drops in with zero change here.
 *
 * WHERE THE CONTENT LIVES (the grounding finding, 03.1954). The Forest's own connector pane is
 * content-free by construction (name + category only, K1-safe display). But the Catch stores the
 * FULL text in the Soil: each row's `content` is the adapter's deterministic block
 *     Subject: <s>\nFrom: <f>\nDate: <d>\n\n<body>
 * (forest/connectors/sources/gmail.js messageToContent). The email-app is the OWNER reading his own
 * Soil via his own app (owner-data read, not the display projection) — so the reader gets the body
 * the tree-view deliberately hides. No new store, no new sovereignty boundary.
 *
 * SEAM: input is an array of normalized rows { itemId|item_id, content, name?, category?, source?,
 * ingestedAt|ingested_at? }. content is a string (is_text Soil row) or a Buffer/Uint8Array (BLOB) —
 * coerced to utf8 here. Nothing else about the source leaks in.
 *
 * Five Rules: single file, no third-party dep, deterministic, dual-context (node + browser).
 */
(function () {
  // --- content parse -------------------------------------------------------
  // The adapter's block is deterministic (fixity holds across re-sync), so the parse is too.
  // Robust by design: a row whose content does NOT match the header block (a non-mail adapter, or a
  // future format) degrades to { subject: name-or-empty, body: whole-content } — flag-don't-fake,
  // never a fabricated field.
  function coerceText(content) {
    if (typeof content === 'string') return content;
    if (content == null) return '';
    // Buffer / Uint8Array (Soil BLOB) -> utf8; anything else -> String().
    try {
      if (typeof Buffer !== 'undefined' && (Buffer.isBuffer(content) || content instanceof Uint8Array)) {
        return Buffer.from(content).toString('utf8');
      }
    } catch (e) { /* fall through */ }
    if (content instanceof Uint8Array) {
      try { return new TextDecoder('utf-8').decode(content); } catch (e) { /* fall through */ }
    }
    return String(content);
  }

  function headerValue(line, key) {
    var pfx = key + ': ';
    return line.indexOf(pfx) === 0 ? line.slice(pfx.length) : null;
  }

  // parseMailContent(content) -> { subject, from, date, body }
  // The header block is the run of lines before the FIRST blank line; the body is everything after.
  function parseMailContent(content) {
    var text = coerceText(content);
    var sep = text.indexOf('\n\n');
    var headerBlock, body;
    if (sep === -1) { headerBlock = text; body = ''; }
    else { headerBlock = text.slice(0, sep); body = text.slice(sep + 2); }
    var lines = headerBlock.split('\n');
    var subject = '', from = '', date = '', matched = 0, labels = null, unsub = '', oneClick = false, tid = null, mid = null, to = '', cc = '', att = '';
    for (var i = 0; i < lines.length; i++) {
      var s = headerValue(lines[i], 'Subject'); if (s !== null) { subject = s; matched++; continue; }
      var f = headerValue(lines[i], 'From');    if (f !== null) { from = f; matched++; continue; }
      var d = headerValue(lines[i], 'Date');    if (d !== null) { date = d; matched++; continue; }
      // X-GM-Labels (email-app leg 10): the source's mailbox-STATE header — Gmail label ids, comma-
      // joined (e.g. "INBOX,UNREAD,IMPORTANT"). It is metadata, NOT a mail-identity header, so it does
      // NOT increment `matched` (looksLikeMail must not treat a labels-only row as mail). A source that
      // carries no label state (mbox — a flat archive) omits the line -> labels stays null = "unknown".
      var g = headerValue(lines[i], 'X-GM-Labels'); if (g !== null) { labels = g; continue; }
      // X-GM-Thread-Id (email-app leg 15): the source's thread id — Gmail's message.threadId, the id
      // that folds a conversation into one row. Metadata, NOT a mail-identity header -> does NOT
      // increment `matched` (same rule as X-GM-Labels). A source with no thread state (mbox — a flat
      // archive) omits the line -> threadId stays null = "unknown", and groupByThread never fabricates
      // a thread for it (flag-don't-fake).
      var ti = headerValue(lines[i], 'X-GM-Thread-Id'); if (ti !== null) { tid = ti; continue; }
      // Message-Id (email-app reply-threading): the RFC reply anchor carried from the source. Metadata,
      // NOT a mail-identity header -> does NOT increment `matched` (same rule as X-GM-Thread-Id). The
      // connector normalizes the key to "Message-Id" regardless of the sender's casing, so one exact
      // match suffices here. A source with no Message-Id (mbox / pre-leg block) omits the line ->
      // messageId stays null, and onReply passes inReplyTo:null so buildMime omits In-Reply-To.
      var mi = headerValue(lines[i], 'Message-Id'); if (mi !== null) { mid = mi; continue; }
      // List-Unsubscribe (email-app #11): the sender-published RFC-2369 unsubscribe header. Metadata,
      // NOT a mail-identity header -> does NOT increment `matched` (same rule as X-GM-Labels). Carried
      // raw; the render layer parses the angle-bracket URIs (the model stays a dumb carrier).
      var u = headerValue(lines[i], 'List-Unsubscribe'); if (u !== null) { unsub = u; continue; }
      // List-Unsubscribe-Post (email-app #11 B2, RFC 8058): the one-click marker (metadata, no
      // matched++). A boolean the one-click layer reads alongside the https URI from List-Unsubscribe.
      var up = headerValue(lines[i], 'List-Unsubscribe-Post'); if (up !== null) { oneClick = /one-click/i.test(up); continue; }
      // To / Cc (email-app #14b, reply-all): the message's recipient headers, carried raw (the model is a
      // dumb carrier — the reply-all layer parses addresses out of them, same as `from`). Metadata for
      // mail-detection purposes -> does NOT increment `matched` (same rule as Message-Id: a recipient-only
      // fragment is not proof of mail). ABSENT header -> stays '' (honest empty, same as `from`/unsubscribe).
      var t2 = headerValue(lines[i], 'To'); if (t2 !== null) { to = t2; continue; }
      var c2 = headerValue(lines[i], 'Cc'); if (c2 !== null) { cc = c2; continue; }
      // X-GM-Attachments (email-app #9): the message's attachment metadata — a single-line JSON array of
      // { filename, mimeType, size, attachmentId } records (the ingest emits one line only when the message
      // has downloadable attachments). Carried RAW here (the model is a dumb carrier); parseAttachments below
      // turns it into the structured array toMessage exposes. Metadata, NOT a mail-identity header -> does NOT
      // increment `matched` (same rule as X-GM-Labels / To / Cc). ABSENT header -> stays '' ->
      // parseAttachments('') === [] (honest empty, never a fabricated attachment set).
      var a2 = headerValue(lines[i], 'X-GM-Attachments'); if (a2 !== null) { att = a2; continue; }
    }
    // No recognizable header block -> the whole text is the body (honest degrade).
    if (matched === 0) return { subject: '', from: '', date: '', body: text, labels: null, unsubscribe: '', oneClick: false, threadId: null, messageId: null, to: '', cc: '', attachments: '' };
    return { subject: subject, from: from, date: date, body: body, labels: labels, unsubscribe: unsub, oneClick: oneClick, threadId: tid, messageId: mid, to: to, cc: cc, attachments: att };
  }

  // --- row -> normalized message ------------------------------------------
  function pick(row, camel, snake) {
    return row[camel] !== undefined ? row[camel] : row[snake];
  }

  // A parsed Date header (RFC-2822) -> epoch ms, or null (unparseable/undated -> flag-don't-fake).
  function parseWhen(dateStr, ingestedAt) {
    var t = dateStr ? Date.parse(dateStr) : NaN;
    if (!isNaN(t)) return t;
    var it = ingestedAt ? Date.parse(ingestedAt) : NaN;   // fall back to ingestion stamp
    return isNaN(it) ? null : it;
  }

  // parseLabels(raw) -> a clean array of label ids. `raw` is the X-GM-Labels value string, or null
  // when the header was ABSENT (a source with no label state — mbox — or a pre-leg-10 block). null
  // -> []; a string -> split on comma, trimmed, empties dropped (an empty "X-GM-Labels: " -> []).
  function parseLabels(raw) {
    if (raw == null) return [];
    return String(raw).split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x !== ''; });
  }

  // email-app #9 — the raw X-GM-Attachments JSON (from parseMailContent) -> a clean array of attachment
  // records. flag-don't-fake at every step: absent/empty -> [] (honest "no attachments"); malformed JSON,
  // a non-array, or a record missing the load-bearing fields (filename, attachmentId) is DROPPED, never
  // guessed — a broken record is silently absent rather than a fabricated download handle that 404s. `size`
  // is passed through only when it is a real number (else null, honest unknown). The download layer feeds
  // `attachmentId` to the fetch route; the render layer shows `filename` + `size`.
  function parseAttachments(raw) {
    if (raw == null || raw === '') return [];
    var arr;
    try { arr = JSON.parse(String(raw)); } catch (e) { return []; }
    if (!Array.isArray(arr)) return [];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var a = arr[i];
      if (!a || typeof a !== 'object') continue;
      if (typeof a.filename !== 'string' || a.filename === '') continue;
      if (typeof a.attachmentId !== 'string' || a.attachmentId === '') continue;
      out.push({
        filename: a.filename,
        mimeType: (typeof a.mimeType === 'string' ? a.mimeType : ''),
        size: (typeof a.size === 'number' ? a.size : null),
        attachmentId: a.attachmentId
      });
    }
    return out;
  }

  function toMessage(row) {
    var parsed = parseMailContent(row.content);
    var name = pick(row, 'name', 'name');                 // Soil `name` = the Subject (adapter sets it)
    var ingestedAt = pick(row, 'ingestedAt', 'ingested_at') || null;
    var labels = parseLabels(parsed.labels);
    return {
      id: pick(row, 'itemId', 'item_id') || null,
      subject: parsed.subject || name || '(no subject)',
      from: parsed.from || '',
      date: parsed.date || '',
      body: parsed.body || '',
      category: (row.category === undefined ? null : row.category),
      source: pick(row, 'source', 'source') || null,
      ingestedAt: ingestedAt,
      // email-app leg 10 — mailbox STATE carried from the source's X-GM-Labels block header.
      //   labels: the label id set ([] when the source carries none, e.g. mbox).
      //   unread: KNOWN read-state -> a boolean when the source emitted a label block (Gmail), or
      //           null = UNKNOWN when it did not (mbox / pre-leg-10). flag-don't-fake: an archive
      //           whose read-state we cannot know is never claimed read OR unread.
      labels: labels,
      unread: parsed.labels == null ? null : (labels.indexOf('UNREAD') !== -1),
      // email-app #11 — the raw sender-published List-Unsubscribe value ('' when absent, honest
      // absence). The renderer parses the RFC-2369 URIs and surfaces a read-only link (Card B1).
      unsubscribe: parsed.unsubscribe || '',
      // email-app #11 B2 — sender supports RFC 8058 one-click (a POST the runtime performs, not
      // the read-only link). Surfaced next session behind the runtime /intent/unsubscribe endpoint.
      unsubscribeOneClick: parsed.oneClick || false,
      // email-app leg 15 — the Gmail thread id that folds a conversation. string | null: null when the
      // source carried no X-GM-Thread-Id (mbox / pre-leg-15). groupByThread treats null as its own
      // singleton, never merged with a real thread OR with other threadless messages (flag-don't-fake).
      threadId: parsed.threadId || null,
      // email-app reply-threading — the RFC Message-Id, the reply anchor. string | null: null when the
      // source carried no Message-Id (mbox / pre-leg block). onReply reads it as inReplyTo; buildMime
      // emits In-Reply-To/References only when supplied, so a null messageId sends an un-threaded reply
      // (honest degrade, same flag-don't-fake discipline as threadId).
      messageId: parsed.messageId || null,
      // email-app #14b — the message's recipient headers, carried raw ('' when the source had none — an
      // mbox archive, or a pre-#14b block — honest absence, never fabricated). replyAllRecipients() below
      // parses addresses out of from+to+cc to build the reply-all set; the render/compose layer consumes it.
      to: parsed.to || '',
      cc: parsed.cc || '',
      // email-app #9 — the message's downloadable attachments as a clean [{filename,mimeType,size,attachmentId}]
      // array ([] when the source carried none — an mbox archive, or a message with no attachments — honest
      // empty, never fabricated). detailView renders filename+size; the download route feeds attachmentId to
      // messages.attachments.get. parseAttachments drops any malformed record rather than guess a handle.
      attachments: parseAttachments(parsed.attachments),
      _when: parseWhen(parsed.date, ingestedAt)
    };
  }

  // --- sort ----------------------------------------------------------------
  // sortMailbox(messages, order) -> a NEW sorted array (non-mutating, like search).
  // order in { 'newest' (default), 'oldest', 'sender' }. The undated/senderless rule is
  // flag-don't-fake one level up: a message with no parseable Date (_when === null) NEVER
  // sorts among the dated ones on a fabricated time -> it sinks last for the date orders;
  // a message with no From ('') sinks last for the sender order. Unknown order -> 'newest'
  // (the mailbox's resting order). Stable within a tie by newest-first.
  function _cmpNewest(a, b) {
    if (a._when === null && b._when === null) return 0;
    if (a._when === null) return 1;        // undated last
    if (b._when === null) return -1;
    return b._when - a._when;              // newest first
  }
  function sortMailbox(messages, order) {
    var out = (messages || []).slice();    // non-mutating (like search)
    if (order === 'oldest') {
      out.sort(function (a, b) {
        if (a._when === null && b._when === null) return 0;
        if (a._when === null) return 1;    // undated last (never a fabricated 0)
        if (b._when === null) return -1;
        return a._when - b._when;          // oldest first
      });
    } else if (order === 'sender') {
      out.sort(function (a, b) {
        var af = (a.from || '').trim().toLowerCase();
        var bf = (b.from || '').trim().toLowerCase();
        if (af === '' && bf === '') return _cmpNewest(a, b);
        if (af === '') return 1;           // senderless last (never a fabricated name)
        if (bf === '') return -1;
        if (af < bf) return -1;
        if (af > bf) return 1;
        return _cmpNewest(a, b);           // tie -> newest first
      });
    } else {
      out.sort(_cmpNewest);                // 'newest' + any unknown order
    }
    return out;
  }

  // buildMailbox(rows) -> [message], newest first; undated rows last (never a fabricated time).
  // Delegates to sortMailbox so there is ONE comparator for the mailbox's resting order.
  function buildMailbox(rows) {
    return sortMailbox((rows || []).map(toMessage), 'newest');
  }

  // --- search --------------------------------------------------------------
  // Case-insensitive substring over subject + from + body. Empty/whitespace query -> the whole
  // mailbox (a search UI at rest shows everything). Preserves mailbox order.
  function search(messages, query) {
    var q = String(query == null ? '' : query).trim().toLowerCase();
    if (!q) return (messages || []).slice();
    return (messages || []).filter(function (m) {
      return (m.subject + '\n' + m.from + '\n' + m.body).toLowerCase().indexOf(q) !== -1;
    });
  }

  // --- searchQuery (email-app #8, slice ① — the Gmail search-operator grammar, client-side) -------
  // searchQuery(messages, query) -> a NEW filtered array (non-mutating, order-preserving, like
  // search/filterMailbox). It upgrades the plain-substring `search` to Gmail's operator grammar,
  // parsed over the INGESTED mailbox. (Slice ② — the server-side messages.list?q= that searches the
  // WHOLE Gmail corpus, not just ingested mail — is the follow-on live-wire; this local grammar stays
  // useful beside it as the instant no-round-trip filter over the loaded view.) A query is a set of
  // whitespace-separated TERMS, AND-combined (Gmail's default); a term may be:
  //   free text            -> substring over subject+from+body (the `search` behavior)
  //   "quoted phrase"      -> one free-text term, inner spaces preserved
  //   from:x  subject:x    -> case-insensitive substring over that field
  //   is:unread | is:read  -> m.unread === true | false  (flag-don't-fake: unknown/null matches NEITHER)
  //   is:starred|important -> the STARRED | IMPORTANT label present
  //   label:x              -> a label id == x (case-insensitive) OR == CATEGORY_x (so label:social works)
  //   category:x           -> m.category == x (case-insensitive)
  //   before:d | after:d   -> m._when strictly-before | on-or-after the parsed date (YYYY/MM/DD or
  //                           YYYY-MM-DD); flag-don't-fake: an undated msg (_when null) matches NEITHER
  //   -term                -> negation: the term's predicate must be FALSE for the message
  // HONEST GAPS (flag-don't-fake): the model carries no recipient and no attachment state, so `to:` and
  // `has:attachment` are NOT supported and NOT faked — an unrecognized operator degrades to a LITERAL
  // free-text term (we search for the string; we never invent the answer). The supported set is exported
  // as SEARCH_OPERATORS for the UI/help. Empty/whitespace query -> the whole mailbox (a search UI at rest).
  var SEARCH_OPERATORS = ['from', 'subject', 'is', 'label', 'category', 'before', 'after'];

  function _parseSearchDate(s) {
    // YYYY/MM/DD or YYYY-MM-DD -> a UTC epoch (ms) at 00:00; null when unparseable (honest — the caller
    // then degrades the term to literal free text rather than fabricating a date bound).
    var m = String(s || '').trim().match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
    if (!m) return null;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return isNaN(t) ? null : t;
  }

  function _tokenizeQuery(query) {
    // Whitespace-split, but keep "quoted phrases" and op:"quoted values" together. Returns raw tokens.
    var out = [], re = /"[^"]*"|\S+/g, mt;
    while ((mt = re.exec(String(query == null ? '' : query))) !== null) out.push(mt[0]);
    return out;
  }

  function _freeTextPredicate(term) {
    var q = String(term == null ? '' : term).replace(/^"|"$/g, '').toLowerCase();
    return function (m) {
      return ((m.subject || '') + '\n' + (m.from || '') + '\n' + (m.body || '')).toLowerCase().indexOf(q) !== -1;
    };
  }

  function _positivePredicate(tok) {
    var c = tok.indexOf(':');
    if (c <= 0) return _freeTextPredicate(tok);                 // no operator (or leading ':') -> free text
    var op = tok.slice(0, c).toLowerCase();
    if (SEARCH_OPERATORS.indexOf(op) === -1) return _freeTextPredicate(tok);  // unknown op -> literal (honest)
    var val = tok.slice(c + 1).replace(/^"|"$/g, '');
    var v = val.toLowerCase();
    if (op === 'from')     return function (m) { return (m.from || '').toLowerCase().indexOf(v) !== -1; };
    if (op === 'subject')  return function (m) { return (m.subject || '').toLowerCase().indexOf(v) !== -1; };
    if (op === 'category') return function (m) { return m.category != null && String(m.category).toLowerCase() === v; };
    if (op === 'label') {
      var want = v.toUpperCase(), cat = 'CATEGORY_' + want;
      return function (m) {
        return (m.labels || []).some(function (l) { var u = String(l).toUpperCase(); return u === want || u === cat; });
      };
    }
    if (op === 'is') {
      if (v === 'unread')    return function (m) { return m.unread === true; };
      if (v === 'read')      return function (m) { return m.unread === false; };
      if (v === 'starred')   return function (m) { return (m.labels || []).indexOf('STARRED') !== -1; };
      if (v === 'important') return function (m) { return (m.labels || []).indexOf('IMPORTANT') !== -1; };
      return _freeTextPredicate(tok);                           // is:<unknown> -> literal (honest)
    }
    // before: / after: — date-bounded; an unparseable date degrades to literal (never a faked bound)
    var when = _parseSearchDate(val);
    if (when === null) return _freeTextPredicate(tok);
    if (op === 'before') return function (m) { return m._when !== null && m._when < when; };
    return function (m) { return m._when !== null && m._when >= when; };   // after: -> on-or-after
  }

  function _termPredicate(token) {
    var neg = false, tok = token;
    if (tok.charAt(0) === '-' && tok.length > 1) { neg = true; tok = tok.slice(1); }
    var pred = _positivePredicate(tok);
    return neg ? function (m) { return !pred(m); } : pred;
  }

  function searchQuery(messages, query) {
    var raw = String(query == null ? '' : query).trim();
    if (!raw) return (messages || []).slice();
    var preds = _tokenizeQuery(raw).map(_termPredicate);
    return (messages || []).filter(function (m) {
      for (var i = 0; i < preds.length; i++) { if (!preds[i](m)) return false; }
      return true;                                             // AND across all terms (Gmail default)
    });
  }

  // --- filter (email-app leg 10) -------------------------------------------
  // filterMailbox(messages, opts) -> a NEW filtered array (non-mutating, like search/sort). opts:
  //   { unread: true }   -> only messages KNOWN unread (unread === true). Unknown (null, e.g. an mbox
  //                         archive) and read (false) are BOTH excluded — flag-don't-fake: a message
  //                         whose read-state we don't know is never shown as "unread". falsy/absent
  //                         `unread` -> no unread narrowing.
  //   { label: 'INBOX' } -> only messages whose label set includes that id (case-sensitive: Gmail ids
  //                         are canonical). null/'' -> no label narrowing.
  // no opts / empty opts -> the whole list (a filter UI at rest shows everything). Preserves order.
  function filterMailbox(messages, opts) {
    var o = opts || {};
    var wantUnread = o.unread === true;
    var wantLabel = (o.label == null || o.label === '') ? null : String(o.label);
    if (!wantUnread && wantLabel === null) return (messages || []).slice();
    return (messages || []).filter(function (m) {
      if (wantUnread && m.unread !== true) return false;      // unknown (null) and read (false) excluded
      if (wantLabel !== null && (m.labels || []).indexOf(wantLabel) === -1) return false;
      return true;
    });
  }

  // hasLabel(message, labelId) -> does this message carry that label id? (email-app leg 12 — the
  // toggle-state read for the manage bar's star / mark-important moves). Case-sensitive: Gmail label
  // ids are canonical (STARRED, IMPORTANT). A message with no known label state (labels [] — an mbox
  // row) truthfully returns false for every id — flag-don't-fake: absence of state is not presence.
  // The renderer uses this to decide the definite verb to send: starred -> 'unstar', else -> 'star'.
  function hasLabel(message, labelId) {
    if (!message || labelId == null || labelId === '') return false;
    return (message.labels || []).indexOf(String(labelId)) !== -1;
  }

  // railModel(messages) -> the navigation rail's system-folder slots (email-app ①a — the JT-6 new
  // region). A PURE derivation over the mailbox in hand (non-mutating, like search/sort/filter/
  // labelsOf), returning a NEW array, newest concern first. Each slot:
  //   { id, label, filter, count }
  //     filter = the exact opts object filterMailbox takes ({} = all · { unread:true } · { label:'INBOX' })
  //     count  = filterMailbox(messages, filter).length
  // The count is DERIVED FROM filterMailbox — the same filter the strip's Show/Label selects drive — so
  // a rail slot's number can NEVER disagree with the list that slot opens (that identity is ①a's test
  // gate, and the reason railModel does not count by hand). A zero is a TRUE count, returned honestly;
  // the renderer decides whether to show or hide an empty slot, the model never lies about the number.
  // flag-don't-fake (the model's one hard rule): only folders the model can ACTUALLY filter appear here.
  // There is no Trash slot — the reversible-trash category does not exist in the model yet (its machinery
  // is a later runtime leg); a slot promising a capability the app lacks would be exactly that lie.
  function railModel(messages) {
    var list = messages || [];
    var specs = [
      { id: 'inbox',     label: 'Inbox',     filter: { label: 'INBOX' } },
      { id: 'unread',    label: 'Unread',    filter: { unread: true } },
      { id: 'starred',   label: 'Starred',   filter: { label: 'STARRED' } },
      { id: 'important', label: 'Important', filter: { label: 'IMPORTANT' } },
      { id: 'all',       label: 'All mail',  filter: {} }
    ];
    return specs.map(function (s) {
      return { id: s.id, label: s.label, filter: s.filter,
               count: filterMailbox(list, s.filter).length };
    });
  }

  // labelsOf(messages) -> the sorted, de-duplicated set of label ids present across the mailbox — the
  // source for a client label picker. Empty when no message carries label state (an mbox-only mailbox).
  function labelsOf(messages) {
    var seen = {};
    (messages || []).forEach(function (m) {
      (m.labels || []).forEach(function (l) { if (l) seen[l] = true; });
    });
    return Object.keys(seen).sort();
  }

  // --- thread grouping (email-app leg 15 — the crux move, RCR feature #1) ---
  // groupByThread(messages) -> a NEW array of thread-RECORDS (non-mutating, like search/sort/filter/
  // labelsOf), newest-thread first. A thread-record folds the messages that share a Gmail threadId
  // into one row the renderer collapses (: a `.record` folding child `.row`s). Record shape:
  //   { threadId, messages: [msgs newest-first], count, latest }   (latest = newest msg = the row face)
  // flag-don't-fake (the model's one hard rule, here as everywhere): a message whose thread is UNKNOWN
  // (threadId null — an mbox archive or a pre-leg-15 block) is NEVER merged — not with a real thread,
  // and not with other threadless messages. Each becomes its OWN singleton record, so the view degrades
  // honestly to a flat list on a source with no thread state. Thread order = the thread's latest message
  // under the mailbox's resting comparator (newest-first, _cmpNewest); within a thread, newest-first too.
  // A singleton record (threadId null, OR a real one-message thread) has count 1 — the renderer renders
  // it as a plain row with no fold affordance. Input messages are never mutated (records hold refs).
  function groupByThread(messages) {
    var list = messages || [];
    var byId = {};        // real threadId -> its record (the fold key)
    var records = [];     // first-seen order; re-sorted at the end
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      var tid = (m && m.threadId != null && m.threadId !== '') ? String(m.threadId) : null;
      if (tid === null) {
        records.push({ threadId: null, messages: [m], count: 1, latest: m });  // unknown -> own singleton
        continue;
      }
      if (byId[tid] === undefined) {
        var rec = { threadId: tid, messages: [m], count: 1, latest: m };
        byId[tid] = rec;
        records.push(rec);
      } else {
        byId[tid].messages.push(m);
      }
    }
    for (var j = 0; j < records.length; j++) {
      var r = records[j];
      r.messages = sortMailbox(r.messages, 'newest');   // newest-first within the thread (non-mutating)
      r.count = r.messages.length;
      r.latest = r.messages[0];
    }
    records.sort(function (a, b) { return _cmpNewest(a.latest, b.latest); });  // newest thread first
    return records;
  }

  // --- live-Soil ingestion (the owner-data read over GET /export/soil) -----
  // The runtime's owner-gated GET /export/soil returns the content-bearing Soil dump
  //   { _meta, categories, items: [ { itemId, content, name?, category?, source?, ... } ] }
  // (the superset of the K1-stripped /projection/soil). The reader consumes items[] directly —
  // mail-model already reads the export's itemId/content shape with zero mapping. These two helpers
  // are the ONLY new surface leg 1's live wire needs; the demo and its integration test share them,
  // so there is one code path from the endpoint to the mailbox (no glue drift).

  // looksLikeMail(row) -> does this Soil row parse as mail? PROVIDER-AGNOSTIC: it asks the parser,
  // never the source name — so a mail row from ANY future adapter (Loop Email, IMAP, ...) passes and
  // a non-mail Soil row (a drive file, a calendar event) does not, with no reader change per adapter.
  // A row parses as mail iff its content carries a recognizable header (at least one of Subject/From/
  // Date); a degraded/non-mail row yields all-empty from parseMailContent and is excluded. This is the
  // honest filter: it can only miss a header-less mail (rare) or admit a doc that literally opens
  // "Subject: ..." — neither fabricates a field (flag-don't-fake holds either way).
  function looksLikeMail(row) {
    if (!row || row.content == null) return false;
    var p = parseMailContent(row.content);
    return p.subject !== '' || p.from !== '' || p.date !== '';
  }

  // mailboxFromExport(exportOrItems) -> [message], newest first — the owner-data read → mailbox.
  // Accepts the raw GET /export/soil payload ({items:[...]}) OR a bare items array; filters to the
  // mail rows (looksLikeMail) and builds the mailbox. Cold-safe: a null/shapeless payload or an empty
  // Soil yields an empty mailbox (never throws), so the reader can fall back to a labelled sample.
  // --- cross-source dedupe (email-app #25 — the moat: one unified live+archive list) -------------
  // unifyMailbox(messages) -> a NEW array, deduped ACROSS sources by RFC Message-Id, so the same
  // email present in more than one source (a live Gmail message that is ALSO in an imported .mbox
  // archive) shows ONCE. This is the moat's remaining slice: the ingest seam already lands every
  // source in one Soil and mailboxFromExport already reads them as one list — this collapses the
  // OVERLAP so the unified inbox is honest, not doubled.
  //
  // flag-don't-fake (the model's one hard rule, here as in groupByThread): a message with NO
  // messageId (null/'' — an mbox archive that carried no Message-Id, or a degraded row) is NEVER
  // merged. It cannot be PROVEN identical to anything, so it stays its own row — exactly as a null
  // threadId stays its own thread-singleton. Only a real, matching messageId collapses two rows.
  //
  // On a collision the RICHER copy wins — the one carrying mailbox STATE (a known read-state, a Gmail
  // threadId, a non-empty label set) over a flat archive copy that carries none — so no known
  // label/thread/read-state is ever dropped by the dedupe. Ties keep first-seen (stable, position-
  // preserving). The kept message gains `sources`: the sorted, de-duplicated set of source names it
  // was found under (a single-source message gets a one-element set), so the renderer can badge
  // provenance ("Gmail" / "mbox archive" / "Gmail + archive"). Non-mutating (like sort/search/group):
  // inputs are never mutated; each survivor is a shallow clone with `sources` attached. Order is NOT
  // imposed here (sort downstream — one comparator); first-seen among survivors is preserved.
  function _mailRichness(m) {
    if (!m) return -1;
    var r = 0;
    if (m.unread !== null && m.unread !== undefined) r += 1;   // known read-state (source emitted a label block)
    if (m.threadId != null && m.threadId !== '') r += 1;        // known thread (Gmail)
    if (m.labels && m.labels.length) r += 1;                    // carries label state
    return r;
  }
  function _sourceOf(m) {
    return (m && m.source != null && m.source !== '') ? String(m.source) : null;
  }
  function _sortUniqSources(arr) {
    var seen = {}, out = [];
    for (var i = 0; i < (arr || []).length; i++) {
      var v = arr[i];
      if (v != null && v !== '' && !seen[v]) { seen[v] = 1; out.push(v); }
    }
    out.sort();
    return out;
  }
  function _cloneWithSources(m, sources) {
    var c = {};
    for (var k in m) { if (Object.prototype.hasOwnProperty.call(m, k)) c[k] = m[k]; }
    c.sources = _sortUniqSources(sources);
    return c;
  }
  function unifyMailbox(messages) {
    var list = messages || [];
    var byMsgId = {};     // messageId -> index into `out` of the winning row (the fold key)
    var out = [];         // survivors in first-seen order (re-sorted downstream by sortMailbox)
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      var mid = (m && m.messageId != null && m.messageId !== '') ? String(m.messageId) : null;
      var src = _sourceOf(m);
      if (mid === null) {
        out.push(_cloneWithSources(m, src ? [src] : []));   // unknown identity -> never merged
        continue;
      }
      if (byMsgId[mid] === undefined) {
        byMsgId[mid] = out.length;
        out.push(_cloneWithSources(m, src ? [src] : []));
      } else {
        var idx = byMsgId[mid];
        var kept = out[idx];
        var union = _sortUniqSources((kept.sources || []).concat(src ? [src] : []));
        if (_mailRichness(m) > _mailRichness(kept)) {
          out[idx] = _cloneWithSources(m, union);   // richer copy wins the row (position preserved)
        } else {
          kept.sources = union;                     // survivor stays; just record the extra source
        }
      }
    }
    return out;
  }

  // mailboxFromExport(exportOrItems) -> [message], the UNIFIED owner inbox (email-app #25):
  // filter to mail rows, normalize, dedupe across sources, then sort newest. The resting inbox IS
  // the one merged live+archive list — the same message in Gmail and the imported archive shows once.
  function mailboxFromExport(exportOrItems) {
    var items = Array.isArray(exportOrItems)
      ? exportOrItems
      : (exportOrItems && Array.isArray(exportOrItems.items) ? exportOrItems.items : []);
    var messages = items.filter(looksLikeMail).map(toMessage);
    return sortMailbox(unifyMailbox(messages), 'newest');
  }

  // --- email-app #24 layer 4: apply an incremental DELTA into the in-hand mailbox -------------
  // The canonical local label mirror (the #26-fix helper, promoted here so the delta path and, in a
  // follow-on, the renderer's bulk path share ONE implementation). Mutates the passed labels array in
  // the caller's chosen copy; applyMailDelta below works on clones so it stays non-mutating.
  function addLbl(labels, id) {
    var out = Array.isArray(labels) ? labels.slice() : [];
    if (id != null && out.indexOf(id) === -1) out.push(id);
    return out;
  }
  function rmLbl(labels, id) {
    var out = Array.isArray(labels) ? labels.slice() : [];
    var i = out.indexOf(id);
    if (i !== -1) out.splice(i, 1);
    return out;
  }

  // applyMailDelta(messages, records) -> { messages, needsFullRead, applied }
  //
  // Fold Gmail users.history.list DELTA records into the in-hand mailbox WITHOUT a full re-read
  // (email-app #24). NON-MUTATING: returns a NEW array; touched messages are shallow-cloned with new
  // label sets, untouched pass through by reference, deleted are omitted. Record shape (per Gmail):
  //   { labelsAdded:[{message:{id},labelIds:[...]}], labelsRemoved:[...],
  //     messagesDeleted:[{message:{id}}], messagesAdded:[{message:{id,labelIds}}] }
  //
  // Three change classes handled directly (they reference messages we ALREADY hold, by id):
  //   · labelsAdded / labelsRemoved -> patch m.labels (reusing addLbl/rmLbl), recompute m.unread ONLY
  //     when it was KNOWN (flag-don't-fake: a null read-state stays null).
  //   · messagesDeleted -> splice the row out.
  // The fourth, messagesAdded, carries only an id — NOT content — so a new row can't be rendered from the
  // delta. Rather than fabricate a contentless stub, we RAISE needsFullRead: the caller does the existing
  // full GET /export/soil re-read (which carries content) for genuinely-new mail. Same must-not-stall
  // discipline as the route's HISTORY_EXPIRED path — a case we can't do cheaply falls back, never silently
  // drops. (Per-id incremental content fetch is a clean follow-on; this ships correct + safe.)
  // A label change on a message we don't hold is ignored (a full read would surface it if it mattered).
  // Reflects only what the server's history CONFIRMED — fabricates nothing (the #26-fix discipline).
  function applyMailDelta(messages, records) {
    var list = Array.isArray(messages) ? messages.slice() : [];
    var recs = Array.isArray(records) ? records : [];
    var idx = {};
    for (var i = 0; i < list.length; i++) { if (list[i] && list[i].id != null) idx[list[i].id] = i; }
    var labeled = 0, deleted = 0;
    var addedIds = [], seenAdd = {};   // #24 follow-on: COLLECT the new-mail ids (deduped) so the caller can hydrate them
    var toDelete = {};

    function patch(entry, add) {
      var mid = entry && entry.message && entry.message.id;
      var ids = (entry && entry.labelIds) || [];
      if (mid == null || idx[mid] === undefined || !ids.length) return;
      var at = idx[mid];
      var m = list[at];
      var labels = Array.isArray(m.labels) ? m.labels.slice() : [];
      for (var k = 0; k < ids.length; k++) { labels = add ? addLbl(labels, ids[k]) : rmLbl(labels, ids[k]); }
      var unread = m.unread == null ? null : (labels.indexOf('UNREAD') !== -1);
      var clone = {}; for (var key in m) { if (Object.prototype.hasOwnProperty.call(m, key)) clone[key] = m[key]; }
      clone.labels = labels; clone.unread = unread;
      list[at] = clone;
      labeled++;
    }

    for (var r = 0; r < recs.length; r++) {
      var rec = recs[r] || {};
      var la = rec.labelsAdded || [];   for (var a = 0; a < la.length; a++) patch(la[a], true);
      var lr = rec.labelsRemoved || []; for (var b = 0; b < lr.length; b++) patch(lr[b], false);
      var md = rec.messagesDeleted || [];
      for (var c = 0; c < md.length; c++) { var did = md[c] && md[c].message && md[c].message.id; if (did != null) toDelete[did] = true; }
      var ma = rec.messagesAdded || [];
      for (var e2 = 0; e2 < ma.length; e2++) {
        var aid = ma[e2] && ma[e2].message && ma[e2].message.id;
        if (aid != null && !seenAdd[aid]) { seenAdd[aid] = true; addedIds.push(aid); }
      }
    }

    if (Object.keys(toDelete).length) {
      var kept = [];
      for (var d = 0; d < list.length; d++) {
        var mm = list[d];
        if (mm && mm.id != null && toDelete[mm.id]) { deleted++; continue; }
        kept.push(mm);
      }
      list = kept;
    }

    // An id ADDED and DELETED within the same delta window is already gone — never hydrate it
    // (flag-don't-fake). needsFullRead is TRUE iff genuinely-new mail survived: a caller that ignores
    // addedIds still full-reads and stays correct (the safe default); a caller that hydrates uses addedIds
    // and skips the full read. #24 follow-on: the model stays a PURE fold — the renderer owns the choice.
    var newIds = [];
    for (var g = 0; g < addedIds.length; g++) { if (!toDelete[addedIds[g]]) newIds.push(addedIds[g]); }
    return { messages: list, needsFullRead: newIds.length > 0,
             applied: { labeled: labeled, deleted: deleted, added: newIds.length, addedIds: newIds } };
  }

  // --- reply-all recipient set (email-app #14b) -----------------------------
  // parseAddressList("A <a@x>, B <b@y>") -> [{ raw, email }] — each token keeps its raw display form
  // (for compose) plus its lowercased email (for de-dup/compare). Pragmatic comma split: RFC quoted-comma
  // display names are rare in practice, and a stray split degrades to a token whose email extraction still
  // works or falls back to the raw text — never a crash. null / empty / whitespace -> [].
  function parseAddressList(raw) {
    if (raw == null) return [];
    return String(raw).split(',').map(function (part) {
      var t = part.trim();
      if (t === '') return null;
      var lt = t.indexOf('<'), gt = t.indexOf('>');
      var email = (lt !== -1 && gt !== -1 && gt > lt) ? t.slice(lt + 1, gt).trim() : t;
      return { raw: t, email: email.toLowerCase() };
    }).filter(function (x) { return x !== null && x.email !== ''; });
  }

  // replyAllRecipients(m, self) -> { to, cc } — the reply-all recipient set from a message and the owner's
  // own address. `to` = the original sender (From) — who you reply to (mirrors onReply). `cc` = everyone
  // else on the original To + Cc, de-duped by email, with `self` and the sender removed (the spec's
  // (From+To+Cc − self), structured as a reply-all). Returns comma-joined RAW address strings so compose
  // shows display names. self may be a bare email or a header form. flag-don't-fake: an mbox message with
  // no recipient headers yields cc:'' (nothing to widen to) and to = its From (or '' when even From is empty).
  function replyAllRecipients(m, self) {
    m = m || {};
    var selfList = parseAddressList(self);
    var selfEmail = selfList.length ? selfList[0].email : String(self == null ? '' : self).trim().toLowerCase();
    var seen = {};
    if (selfEmail) seen[selfEmail] = true;            // − self, from every slot
    var toTokens = [];
    parseAddressList(m.from).forEach(function (a) {    // reply target = original sender
      if (a.email && !seen[a.email]) { seen[a.email] = true; toTokens.push(a.raw); }
    });
    var ccTokens = [];
    parseAddressList(m.to).concat(parseAddressList(m.cc)).forEach(function (a) {
      if (a.email && !seen[a.email]) { seen[a.email] = true; ccTokens.push(a.raw); }
    });
    // Sender was self (replying-all to your OWN message) -> no To yet; promote the first remaining
    // recipient so compose has a valid To (send requires a non-empty To). self is never re-added; if the
    // thread carried nobody but self, to+cc are both '' (honestly, there is no one to reply-all to).
    if (toTokens.length === 0 && ccTokens.length > 0) toTokens.push(ccTokens.shift());
    return { to: toTokens.join(', '), cc: ccTokens.join(', ') };
  }

  var api = {
    parseMailContent: parseMailContent,
    toMessage: toMessage,
    parseAttachments: parseAttachments,
    replyAllRecipients: replyAllRecipients,
    buildMailbox: buildMailbox,
    sortMailbox: sortMailbox,
    search: search,
    searchQuery: searchQuery,
    SEARCH_OPERATORS: SEARCH_OPERATORS,
    filterMailbox: filterMailbox,
    railModel: railModel,
    labelsOf: labelsOf,
    groupByThread: groupByThread,
    hasLabel: hasLabel,
    unifyMailbox: unifyMailbox,
    looksLikeMail: looksLikeMail,
    mailboxFromExport: mailboxFromExport,
    applyMailDelta: applyMailDelta,
    addLbl: addLbl,
    rmLbl: rmLbl
  };

  // dual-context export (node test + browser app), matching the Forest shell idiom.
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.EmailApp = window.EmailApp || {};
    window.EmailApp.mailModel = api;
  }
})();
