# zonecast

**Cast a stored wall-clock into the time — and the calendar day — a viewer in another zone actually sees.** Zero dependencies, DST-correct, and honest: it never guesses a time it doesn't have.

A calendar stores an event as a wall-clock (`2026-06-20T23:00`) plus, sometimes, the IANA zone that wall-clock was written in (`America/New_York`). What a viewer in London should *see* is a different wall-clock — and possibly a different calendar **day** — because 23:00 in New York is 04:00 the next morning in London. Getting this wrong (off by an hour at a daylight-saving boundary, or bucketing an event on the wrong day) is one of the most common and most silent bugs in any app that shows times to people in more than one place.

`zonecast` answers one question — *what wall-clock and calendar day does **this** viewer see for this stored time?* — and answers it DST-correctly, using only the platform's own `Intl` time-zone database.

## Two kinds of stored time

| kind | meaning | what zonecast does |
|---|---|---|
| `floating` | a wall-clock with **no** zone — all-day events, legacy rows | passes it through **verbatim**: 11:00 stays 11:00 in every zone, no math |
| `zoned` | a wall-clock **plus** an IANA zone | interprets it in its own zone to find the real instant, then re-expresses it in the viewer's home zone — DST-correct |

## The result

```js
cast(value, kind, homeZone)
// -> { ok, kind, dayKey: "YYYY-MM-DD", time: "HH:MM", wallClock: "YYYY-MM-DDTHH:MM", zone }
```

`ok:false` blanks every field — the caller shows **nothing** rather than a guessed time.

## Use it

```bash
# a zoned event, seen by a viewer in London
node zonecast.js --kind zoned --zone America/New_York --home Europe/London 2026-06-20T23:00
# -> {"ok":true,"kind":"zoned","dayKey":"2026-06-21","time":"04:00","wallClock":"2026-06-21T04:00","zone":"Europe/London"}

# a floating (zoneless) wall-clock — unchanged everywhere
node zonecast.js 2026-06-20T11:00
# -> {"ok":true,"kind":"floating","dayKey":"2026-06-20","time":"11:00", ... ,"zone":null}
```

In code (Node or browser — `window.ForestGifts.zonecast`):

```js
const { cast } = require("./zonecast.js");
cast({ wallClock: "2026-06-20T23:00", zone: "America/New_York" }, "zoned", "Europe/London");
```

## Honest by construction

- A **missing, malformed, or offset-bearing** wall-clock returns `ok:false` with blank fields — an undated or unparseable thing is never handed a "when".
- A trailing `Z` or an explicit `+05:00` offset is **rejected**, not silently reinterpreted — this tool speaks the tool-shaped `YYYY-MM-DDTHH:MM[:SS]` wall-clock.
- A `zoned` value with **no zone** is malformed → blank. It is never silently treated as floating.
- An **unresolvable home zone is never assumed to be UTC.** With no `homeZone`, the platform's own detected zone is proposed; if even that is unavailable, the result blanks.

## How it works

The zoned path resolves a wall-clock-in-zone to a UTC instant by a two-pass technique: read the fields as if UTC, ask `Intl` what that instant reads as in the zone, take the difference as the offset, apply it, then re-read once to settle a DST edge (taking the first valid reading in the rare spring-forward gap or fall-back fold). No zone table is vendored, so it is always as current as the runtime's own tzdata. Pure function of `(value, kind, homeZone)` — no clock, no randomness, no files, no network — so the same inputs yield the same result every run, in Node or a browser.

## What this is **not**

zonecast tells you the wall-clock and calendar day a viewer *sees* for a stored time; it does **not** store times, validate that a zone name is one you meant, or know what "now" is. It is a pure renderer of a value you already hold, and it relies entirely on the host runtime's `Intl` time-zone database for its correctness.

## License

MIT. Zero dependencies. Single file. Runs identically in Node and a browser.
