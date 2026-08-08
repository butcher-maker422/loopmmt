'use strict';
/*
 * loopcalendar-lib — a require()-safe, in-process loader for the Calendar time-hub
 * (internal).
 *
 * WHY THIS EXISTS. loopcalendar is a Five-Rules single-file tool. It previously carried its shebang
 * on line 2 (after its SPDX comment), where `#!` is invalid JS — node threw
 * `SyntaxError: Invalid or unexpected token` both on require() AND on direct run
 * (`node loopcalendar.js …`), so its own daemon/CLI could not start. Byte-truth found
 * loopcalendar is NOT sha-pinned anywhere under golden/: the golden/calendar/bless.json seal is the
 * Calendar-of-People *binding* bless, which pins loopcontact.js (the consumed Contact substrate), NOT
 * loopcalendar. So the defect was fixed AT SOURCE — shebang reordered to line 1, SPDX to line 2 — the
 * exact 2-line, runtime-identical reorder already applied to loopcontact.js (whose re-pin note records
 * the same fix for the same reason: an unstartable daemon). No seal to break, no Canonical Guard to
 * trip (loopcalendar is unpinned).
 *
 * This loader is retained to mirror loopcontact-lib.js, so the calendar sink stack stays symmetric
 * with the proven contacts sink stack (sink → -lib → tool). With the source fixed, the strip is now
 * defensive and idempotent: it removes a shebang wherever it sits (`^#!.*\r?\n/m`) and is a no-op for
 * every other byte, so the in-process compile yields loopcalendar's `module.exports` exactly as a
 * clean require() would. This loader never mutates the on-disk file.
 */

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const SOURCE_PATH = path.resolve(__dirname, '../../../internal');

function loadLoopCalendar() {
  const raw = fs.readFileSync(SOURCE_PATH, 'utf8');
  // Strip a shebang line wherever it sits in the header (loopcalendar's is line 2), then APPEND an
  // in-memory export augmentation so the runtime seam (forest-runtime.js /api/calendar/*) can call the
  // tool's in-process HTTP handler. loopcalendar's `handleApiRequest(runtimeState,req,res,pathname,query)`
  // is a top-level function but is NOT in its own `module.exports` block, so a clean require() cannot reach
  // it. Rather than edit the on-disk tool (kept byte-frozen — the in-process seam, pick A), we append
  // one line to the IN-MEMORY source before compile: the hoisted function is in module scope at the end of
  // the body, so attaching it to the already-assigned `module.exports` object exposes it. Nothing else is
  // altered; this affects only the in-memory compile, never the file on disk (identical discipline to the
  // shebang strip above). Idempotent + defensive: a no-op if the export ever lands at source.
  //
  // (forest-trio-ical-seam-route): additionally expose the two hoisted iCal verbs
  // `exportEventsToIcal(database, options)` and `importIcalText(database, runtimeState, rawText)`
  // by the SAME in-memory augmentation — they are top-level in module scope, like handleApiRequest,
  // and are needed by the iCal seam wrap below. Same defensive, idempotent, on-disk-untouched
  // discipline; a no-op if a verb is ever absent.
  const src = raw.replace(/^#!.*\r?\n/m, '')
    + '\n;if (typeof handleApiRequest === "function" && module.exports && !module.exports.handleApiRequest)'
    + ' { module.exports.handleApiRequest = handleApiRequest; }'
    + '\n;if (typeof exportEventsToIcal === "function" && module.exports && !module.exports.exportEventsToIcal)'
    + ' { module.exports.exportEventsToIcal = exportEventsToIcal; }'
    + '\n;if (typeof importIcalText === "function" && module.exports && !module.exports.importIcalText)'
    + ' { module.exports.importIcalText = importIcalText; }'
    // E4 (forest-weave-e4-attendee-seam-route): expose the hoisted `addAttendee(database,
    // runtimeState, eventId, displayName, options)` verb the SAME way — it is top-level in
    // module scope like handleApiRequest, and the attendee seam route below needs it. Same
    // defensive, idempotent, on-disk-untouched discipline; a no-op if the verb is ever absent.
    + '\n;if (typeof addAttendee === "function" && module.exports && !module.exports.addAttendee)'
    + ' { module.exports.addAttendee = addAttendee; }\n';
  const mod = new Module(SOURCE_PATH, module);
  mod.filename = SOURCE_PATH;
  mod.paths = Module._nodeModulePaths(path.dirname(SOURCE_PATH));
  mod._compile(src, SOURCE_PATH);
  return wrapSeam(mod.exports);
}

/*
 * The calendar seam (iCal routes: forest-trio-ical-seam-route ; attendee route:
 * forest-weave-e4-attendee-seam-route).
 *
 * WHY HERE. loopcalendar HAS `icalendar-export` / `icalendar-import` (the CLI verbs
 * `exportEventsToIcal` / `importIcalText`), but its `handleApiRequest` never routes them: a
 * GET `/api/events/export.ics` and a POST `/api/events/import` fall through to the generic
 * `/api/events/:id` branch, which reads `export.ics` / `import` as an event id (→ 404 / 405).
 * The Trio's calendar seam (forest-runtime.js seamDispatch) strips `/api/calendar` and
 * forwards the remainder to this lib's handleApiRequest, so the fix belongs HERE — a lib-shim
 * intercept, one layer above the byte-frozen tool and below the runtime the Confluence fenced
 * off (both tracks excluded forest-runtime.js). We do NOT edit the tool and we do NOT edit the
 * runtime; we wrap the exposed handler and intercept the two routes BEFORE the swallow.
 *
 * Honest, thin: export answers `text/calendar` (the tool builds the VCALENDAR — no client parse);
 * import reads `{ ics }` JSON, hands the raw text to the tool, and returns the tool's real
 * `{ imported, duplicates, skipped, event_ids }`. Everything else delegates verbatim. Cold-safe:
 * if the tool ever stops exposing a verb, the wrap is a no-op and the raw handler stands.
 */
function readIcalJsonBody(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (chunk) => { buf += chunk; });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch (_) { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

function wrapSeam(exp) {
  const rawHandle = exp && exp.handleApiRequest;
  const exportFn = exp && exp.exportEventsToIcal;
  const importFn = exp && exp.importIcalText;
  const addFn = exp && exp.addAttendee;
  // P6 "Un-invite" (Slice 3). NOTE, because it is the opposite of what the addAttendee
  // comment above says and the comment is what will mislead you: `removeAttendee` IS in the
  // tool's real `module.exports` block (internal:2669 — `addAttendee,
  // removeAttendee,`). A plain require() reaches it; the source-preamble augmentation above is
  // NOT needed for it, and adding one would be a no-op guarded by `!module.exports.<verb>`.
  // (That preamble line for addAttendee is itself vestigial for the same reason — kept because
  // it is inert and internal is golden-frozen, so proving it dead is not worth a
  // byte of churn in a file we may not touch.) What the tool does NOT have, exactly as with
  // add, is a ROUTE: its handleApiRequest knows /api/events/:id for GET/PUT/DELETE and then
  // 405s, so a DELETE to /api/events/:id/attendees/:aid never reaches removeAttendee. The door
  // is THIS seam's door.
  const removeFn = exp && exp.removeAttendee;
  // verb 6 (calendar-type-manager delete-merge). Like removeAttendee, BOTH verbs this arm
  // needs are already in the tool's real `module.exports` block (internal:2844
  // — `updateEvent` and `listEvents` among them), so a plain require() reaches them and the
  // in-memory source augmentation above is NOT needed. `updateFn` reassigns an event to the
  // UNASSIGNED bucket (patch `calendarId: null`) through the tool's honest write path — which
  // recomputes content_hash, refreshes the event graph node + co-temporal edges, writes an
  // `event.updated` proof-chain entry, and emits a structured event.
  // DE-BLOCK CORRECTION : the reassign is now a raw bulk `UPDATE events SET
  // calendar_id = NULL` ON PURPOSE. calendar_id is in NONE of content_hash (title|start|end),
  // graph-node metadata, or the (day-keyed) co-temporal edges, so the primitive's per-event
  // recompute (upsertEventGraphNode + refreshCoTemporalEdges, O(K^2)/day) was pure waste — and
  // its cost blocked the single event loop on a large calendar, tripping the watchdog restart
  // (the "delete-merge crash": 502 + uptime reset + rollback, never an uncaughtException). One
  // `calendar.deleted` proof entry (proofFn) records the whole op — operator ratified A,.
  // See internal
  const proofFn = exp && exp.writeProofChainEntry;
  // Cold-safe: without the base handler there is nothing to wrap. Each intercept below is
  // then guarded on ITS OWN verb, so a missing iCal verb no longer skips the attendee route
  // (and vice-versa) — an absent verb just falls through to the raw handler for that route.
  if (typeof rawHandle !== 'function') {
    return exp;
  }
  exp.handleApiRequest = async function handleApiRequestWithSeam(runtimeState, req, res, pathname, query) {
    const method = (req.method || 'GET').toUpperCase();
    const database = runtimeState && runtimeState.database;

    // GET /api/events/export.ics -> text/calendar (the tool builds the VCALENDAR).
    if (method === 'GET' && pathname === '/api/events/export.ics' && typeof exportFn === 'function') {
      const text = exportFn(database, {
        fromDate: query && query.from_date,
        toDate: query && query.to_date,
        category: query && query.category,
        status: query && query.status,   // undefined -> the tool defaults to 'confirmed'
      });
      res.writeHead(200, {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="forest-calendar.ics"',
        'Content-Length': Buffer.byteLength(text),
        'Cache-Control': 'no-store',
      });
      res.end(text);
      return;
    }

    // POST /api/events/import -> the tool imports { ics } and returns { imported, ... }.
    if (method === 'POST' && pathname === '/api/events/import' && typeof importFn === 'function') {
      const body = await readIcalJsonBody(req);
      const ics = body && typeof body.ics === 'string' ? body.ics : null;
      if (!ics) {
        const err = JSON.stringify({ error: 'import requires a JSON body { ics: <iCalendar text> }', code: 'E_ICAL_NO_BODY' });
        res.writeHead(400, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(err), 'Cache-Control': 'no-store' });
        res.end(err);
        return;
      }
      try {
        const result = importFn(database, runtimeState, ics) || { imported: 0, duplicates: 0, skipped: 0, event_ids: [] };
        const out = JSON.stringify(result);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(out), 'Cache-Control': 'no-store' });
        res.end(out);
      } catch (e) {
        const err = JSON.stringify({ error: (e && e.message) ? e.message : 'iCalendar import failed', code: 'E_ICAL_IMPORT' });
        res.writeHead(400, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(err), 'Cache-Control': 'no-store' });
        res.end(err);
      }
      return;
    }

    // POST /api/events/:id/attendees -> the tool's addAttendee (E4 "Invite a contact").
    // The byte-frozen tool HAS addAttendee (a top-level verb + a CLI command) but its
    // handleApiRequest never routes it: a POST to /api/events/:id/attendees falls through to
    // the generic /api/events/:id branch, which only knows GET/PUT/DELETE (-> 405). Same
    // lib-shim intercept as the iCal routes above — one layer over the frozen tool, below the
    // Confluence-fenced runtime. Thin: read { display_name, contact_id?, role?, status? }, hand
    // it to the tool, return the tool's real result ({ added, attendee_id } | { error }). The
    // tool owns all validation (display_name required, allowed roles/statuses, the has_attendee
    // graph edge on a linked contact) — the seam only transports.
    if (method === 'POST' && typeof addFn === 'function') {
      const am = pathname.match(/^\/api\/events\/([^/]+)\/attendees\/?$/);
      if (am) {
        const eventId = decodeURIComponent(am[1]);
        const body = await readIcalJsonBody(req);
        if (body === null) {
          const err = JSON.stringify({ error: 'attendee add requires a JSON body { display_name, contact_id? }', code: 'E_ATTENDEE_NO_BODY' });
          res.writeHead(400, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(err), 'Cache-Control': 'no-store' });
          res.end(err);
          return;
        }
        const options = {
          contactId: typeof body.contact_id === 'string' ? body.contact_id : undefined,
          role: typeof body.role === 'string' ? body.role : undefined,
          status: typeof body.status === 'string' ? body.status : undefined,
        };
        const displayName = typeof body.display_name === 'string' ? body.display_name : '';
        let result;
        try {
          result = addFn(database, runtimeState, eventId, displayName, options);
        } catch (e) {
          const err = JSON.stringify({ error: (e && e.message) ? e.message : 'add attendee failed', code: 'E_ATTENDEE_ADD' });
          res.writeHead(400, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(err), 'Cache-Control': 'no-store' });
          res.end(err);
          return;
        }
        result = result || { error: 'add attendee failed' };
        const status = result.error
          ? (String(result.error).includes('not found') ? 404 : 400)
          : 200;
        const out = JSON.stringify(result);
        res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(out), 'Cache-Control': 'no-store' });
        res.end(out);
        return;
      }
    }

    // DELETE /api/events/:id/attendees/:attendeeId -> the tool's removeAttendee (P6 "Un-invite").
    // The exact mirror of the POST arm above, and it exists for the exact same reason: the verb
    // is real (internal:1034 — DELETE FROM event_attendees, plus the has_attendee
    // graph-edge retraction and a proof-chain entry) and the route is not. The tool's own
    // /api/events/:id branch DOES answer DELETE — which is the trap: a DELETE to the deeper
    // attendee path must be caught HERE, above the tool, or it falls into a branch that would
    // read the segment after :id as noise. Thin: transport only. The tool owns every check
    // (event exists -> 404; attendee exists AND belongs to THIS event -> 404), and the
    // attendee-belongs-to-event predicate is the tool's, not ours — we never re-implement it.
    if (method === 'DELETE' && typeof removeFn === 'function') {
      const rm = pathname.match(/^\/api\/events\/([^/]+)\/attendees\/([^/]+)\/?$/);
      if (rm) {
        const eventId = decodeURIComponent(rm[1]);
        const attendeeId = decodeURIComponent(rm[2]);
        let result;
        try {
          result = removeFn(database, runtimeState, eventId, attendeeId);
        } catch (e) {
          const err = JSON.stringify({ error: (e && e.message) ? e.message : 'remove attendee failed', code: 'E_ATTENDEE_REMOVE' });
          res.writeHead(400, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(err), 'Cache-Control': 'no-store' });
          res.end(err);
          return;
        }
        result = result || { error: 'remove attendee failed' };
        const status = result.error
          ? (String(result.error).includes('not found') ? 404 : 400)
          : 200;
        const out = JSON.stringify(result);
        res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(out), 'Cache-Control': 'no-store' });
        res.end(out);
        return;
      }
    }

    // DELETE /api/calendars/:id  (and POST /api/calendars/:id/delete) -> verb 6, delete-merge.
    // The LAST calendar-type-manager verb, and the only one that crosses into the RUNTIME. The
    // owner deletes a calendar type; its events are REASSIGNED to Unassigned (never orphaned,
    // never deleted), and the calendars-table ROW is removed so the type does not reappear on the
    // next GET /api/calendars.
    //
    // WHY HERE, and why BOTH a reassign AND a row-delete. The byte-frozen tool serves
    // GET + POST on /api/calendars (list + id-keyed upsert — verbs 1/2 rename/create write the
    // table) but 405s DELETE and has no /api/calendars/:id route and NO deleteCalendar primitive
    // (internal:2207 / :2844). The client sources its calList from that table
    // VERBATIM (calendar-renderer.js:2906), so a delete that reassigned events but left the row
    // would leave a ghost calendar the tool keeps serving. The tool being frozen, the row-delete
    // terminus lives HERE — the same seam door that already reaches runtimeState.database for the
    // search-containment guard, and that already owns the reassign loop. Transport + terminus,
    // not a tool edit.
    //
    // ONE transaction: enumerate EVERY event on the calendar (a raw `SELECT id ... WHERE
    // calendar_id = ?` — includes cancelled events, which listEvents would hide by default, and
    // takes no LIMIT), reassign each to null through updateEvent (the honest write path), then
    // DELETE the calendars row. If any step throws, ROLLBACK and 500 — a half-done delete-merge
    // (some events reassigned, the row gone, or vice-versa) is worse than a refused one.
    if (database
        && (method === 'DELETE' || method === 'POST')) {
      const cm = pathname.match(/^\/api\/calendars\/([^/]+?)(?:\/delete)?\/?$/);
      // POST is a calendar-delete only via the explicit /delete suffix; a bare POST
      // /api/calendars/:id is not a delete and must fall through to the tool.
      const isDelete = method === 'DELETE'
        || (method === 'POST' && /\/delete\/?$/.test(pathname));
      if (cm && isDelete) {
        const calId = decodeURIComponent(cm[1]);
        // UNASSIGNED is the bucket (NULL calendar_id), not a deletable type. It has no routable
        // id, but reject the sentinels defensively so a client mistake can never wipe the bucket.
        const lowered = calId.trim().toLowerCase();
        if (!calId.trim() || lowered === 'unassigned' || lowered === 'null' || lowered === 'undefined') {
          const err = JSON.stringify({ error: 'Unassigned is not a deletable calendar', code: 'E_CAL_UNASSIGNED' });
          res.writeHead(400, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(err), 'Cache-Control': 'no-store' });
          res.end(err);
          return;
        }
        let reassigned = 0;
        try {
          database.prepare('BEGIN').run();
          // DE-BLOCK : one bulk UPDATE, not a per-event updateEvent loop. See the
          // destructure-block comment above + the finding note for why this is correct and fast.
          const info = database.prepare('UPDATE events SET calendar_id = NULL WHERE calendar_id = ?').run(calId);
          reassigned = Number(info.changes) || 0;
          // ONE proof-chain entry for the whole delete-merge (operator ratified A,):
          // records the destructive op + count, replacing N no-op-content_hash event.updated entries.
          if (typeof proofFn === 'function') {
            proofFn(database, 'calendar.deleted', null,
              { calendar_id: calId, reassigned, action: 'delete-merge' });
          }
          database.prepare('DELETE FROM calendars WHERE id = ?').run(calId);
          database.prepare('COMMIT').run();
        } catch (e) {
          try { database.prepare('ROLLBACK').run(); } catch (_) { /* already rolled back */ }
          const err = JSON.stringify({ error: (e && e.message) ? e.message : 'delete-merge failed', code: 'E_CAL_DELETE' });
          res.writeHead(500, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(err), 'Cache-Control': 'no-store' });
          res.end(err);
          return;
        }
        const out = JSON.stringify({ deleted: true, id: calId, reassigned });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(out), 'Cache-Control': 'no-store' });
        res.end(out);
        return;
      }
    }

    /* ===== SEARCH CONTAINMENT (Slice 4) — the outage this closes ========= *
     * GET /api/events?q= routes to the tool's searchEvents (internal  *
     * :1378), which hands the query VERBATIM to `WHERE events_fts MATCH ?`. FTS5    *
     * MATCH is a QUERY LANGUAGE, not a string compare — so an apostrophe, an        *
     * unbalanced quote, a bare hyphen, a stray paren, a colon, or a bare AND is not *
     * a search TERM, it is a SYNTAX ERROR, and sqlite THROWS.                        *
     *                                                                               *
     * The tool does not catch it. Neither does forest-runtime's request handler     *
     * (an async listener whose returned promise http.createServer never awaits, and *
     * no process-level guard). PROVEN against a real server: a user typing *
     * an APOSTROPHE into the calendar search box EXITS THE RUNTIME PROCESS — mail,  *
     * calendar, contacts, Soil, all of it. A debounced box fires mid-typing, so you *
     * cannot even type `"team offsite"` without passing through `"team offsite`.    *
     *                                                                               *
     * The tool is golden-frozen, so the guard goes HERE — the same door every other *
     * calendar route came through. THE SIBLING TOOL ALREADY DOES THIS: loopcontact's *
     * searchContacts wraps its own MATCH in try/catch and returns an error envelope  *
     * (internal:1562). Contacts got it right; calendar never did. This  *
     * is not a new posture — it is the house posture, applied where it was missing.  *
     *                                                                               *
     * 400, NOT an empty 200. "Your query did not parse" and "there are no matching  *
     * events" are DIFFERENT FACTS, and a search box that renders the first as the   *
     * second is lying to you about your own calendar (F3 — flag, don't fake).        *
     *                                                                               *
     * Scoped to the q-search alone: a blanket try/catch over the delegate would      *
     * swallow every other fault the tool raises, and a guard that hides bugs is a    *
     * worse bug than the one it hides. Transport-only — the seam re-implements       *
     * nothing; it lets the tool build the envelope and only contains the throw.      */
    if (method === 'GET' && pathname === '/api/events'
        && query && typeof query.q === 'string' && query.q.trim().length > 0) {
      try {
        return await rawHandle(runtimeState, req, res, pathname, query);
      } catch (e) {
        // If the tool already answered, the response is not ours to rewrite. Note the test
        // is `headersSent` ALONE: node's real ServerResponse initialises `statusCode` to 200,
        // so a `statusCode > 0` guard would rethrow on every single call and this whole
        // containment would be decorative. (Caught by re-reading it, not by a test — a test
        // with a fake res whose statusCode starts at 0 would have passed it green.)
        if (res.headersSent) throw e;
        const err = JSON.stringify({
          error: 'that search did not parse: ' + ((e && e.message) ? e.message : 'invalid query'),
          code: 'E_SEARCH_SYNTAX',
        });
        res.writeHead(400, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(err), 'Cache-Control': 'no-store' });
        res.end(err);
        return;
      }
    }

    // Everything else: delegate to the tool's real handler, verbatim.
    return rawHandle(runtimeState, req, res, pathname, query);
  };
  return exp;
}

module.exports = loadLoopCalendar();
