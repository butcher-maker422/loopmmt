# Forest

Forest is one app for your own data — **email, calendar, and contacts** in a single
shell, running against your own accounts. This directory is a **curated, readable slice
of the source**: enough to see how the app is built and how the four surfaces fit
together, without the full monorepo's build tooling and internals.

> **This is source to read, not an app to run here.** Forest is a **hosted platform** —
> it runs *through* a server-side runtime that brokers your connected accounts. It does
> **not** run statically from these files the way a single-page app would. So this page
> is *read the code*, not *run it in your browser*. (If you want a runnable example in
> this repo, see `apps/loop21/`.)

## The four surfaces

Forest is "one app" because a single shell hosts three data surfaces over a shared
connector layer. Start at the entry point, then read into whichever surface interests you.

**Entry — how the one app boots**
- `index.html` — the app shell markup: the frame, the top bar, the account/link gate.
- `app.js` — boot: account linking, auth/session handling, the connector wiring.
- `shell/shell-boot.js` — brings the shell up; `shell/shell-renderers.js` registers the
  per-surface renderers.
- `shell/pane.js`, `shell/tab-strip.js`, `shell/tabstrip-actions.js`,
  `shell/view-config.js`, `shell/block.js` — the shell architecture: the pane pool, the
  tab strip, view configuration, and the tiny DOM helper (`block.js`) everything composes on.

**Email** — `email/` + the shell renderer
- `email/mail-model.js` — the standalone mail data model (+ `email/demo.html`, a minimal demo harness).
- `shell/mail-renderer.js` — the mail UI, plus the feature modules around it
  (`shell/mail-*.js`: compose, labels, snooze, undo, trash/spam views, saved searches, …).

**Calendar** — `calendar/` + the shell renderer
- `calendar/loopcalendar-lib.js` — the calendar library.
- `shell/calendar-renderer.js`, `shell/calendar-rest.js`, `shell/calendar-calendars.js` — the calendar surface in the shell.

**Contacts** — `contacts/` + the shell renderer
- `contacts/loopcontact-lib.js` — the contacts library.
- `shell/contacts-renderer.js`, `shell/contacts-rest.js` — the contacts surface in the shell.

**Shared layer** (worth a look — this is what makes it one app, not three)
- `shell/search-federation.js`, `shell/search-stores.js` — search across all surfaces at once.
- `shell/connector-freshness.js`, `shell/connector-items.js` — how the app knows a data source is live or stale.
- `shell/blob-store.js`, `shell/sha256.js`, `shell/markdown.js` — storage and rendering primitives shared across surfaces.

## What's intentionally not here

This is a curated read, so a few things are deliberately left out:

- **Tests** (`*.test.js`) — dropped; this slice is for reading the app, not its test suite.
- **The Butcher app** — Forest's shell can host a separate order-management app; that app
  is published on its own at `apps/butcher-constellation/`, so its files aren't duplicated here.
- **Bundled games** (a falling-block game and a sudoku) — separate apps served alongside Forest, not part of the personal-data story.
- **Deploy scripts, build output, and internal internal folders** — server-side and
  build-time material that isn't the app's readable surface.

## License

Source is shared under CC BY-NC 4.0. © 2026 Shea Gunther · New Gloucester, Maine.
