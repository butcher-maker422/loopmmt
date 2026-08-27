# reltime — a relative-time label that refuses to lie

Turn a timestamp into a short human "when" — `3h ago`, `Jun 20` — where the
whole point is what it **won't** do.

## The honesty rules (this is the tool)

- **Flag, don't fake.** No stamp, an empty stamp, or an unparseable value
  returns `null` — **no label**. The caller shows nothing rather than a guessed
  or fabricated time. An undated thing is never handed a "when".
- **A future stamp is not a recency claim.** If the timestamp is ahead of now
  (clock skew, a bad record), it returns `null` rather than `-2h ago`. You can't
  honestly say how long ago something happened if it hasn't.
- **Real, not rounded up.** Recent items get a relative label
  (`just now` / `Nm` / `Nh` / `Nd ago`); anything older than a week gets the
  **absolute short date** it actually landed (`Jun 20`, or `Jun 20, 2025` across
  a year boundary) — because `9d ago` is less honest and less useful than the
  date itself.
- **Deterministic.** `now` is injected, so the label is a pure function of
  `(stamp, now)` — testable with no wall clock and stable across a render.

## Use it

```sh
node reltime.js 2026-08-20T09:00:00Z               # label vs. now
node reltime.js 2026-08-20T09:00:00Z 1755772800000 # label vs. an injected now (ms)
node reltime.js --help
```

In a browser, load `reltime.js` and call
`window.ForestGifts.relativeTime(iso, nowMs)`. In Node,
`require('./reltime.js').relativeTime(iso, nowMs)`. It is a pure function of its
inputs with no dependencies, so the same code runs in both — and returns `null`
whenever there is no honest label to show.

```js
const { relativeTime } = require('./reltime.js');
relativeTime('2026-08-20T09:00:00Z', Date.parse('2026-08-20T12:00:00Z')); // '3h ago'
relativeTime('', Date.now());        // null  — nothing to show, so show nothing
relativeTime('2099-01-01', Date.now()); // null  — a future stamp is not a recency claim
```

## Its edge (a gift that hides its edges is not a gift)

It renders and reasons in **UTC** for determinism — it is a recency label, not a
localized/timezone-aware formatter, and it is not a full date library. If you
need locale-aware or timezone-shifted display, format the absolute date
yourself; reach for this when you want a *short, honest* "when" that degrades to
nothing rather than to a lie. The relative bands (minute / hour / day / week)
are fixed by design; the value is the refusal to fabricate, not configurable
granularity.

## Test

```sh
node test_reltime.js
```

20 cases: every refusal (missing / empty / unparseable / future), exact band
thresholds, the absolute-date crossover and year boundary, determinism, and a
mutation-bite that fails loudly if the future-guard is removed. stdlib only.

## License

MIT — use it in anything, including something you sell.
