# timesheet — floor-biased time-worked report from git commit timestamps

Zero dependencies. One file. MIT. Pipe a `git log` in, get an honest effort estimate out.

```
$ git log --format='%H %at %s' | node timesheet.js
Work Timesheet

Span: 2026-08-24 .. 2026-08-30  ·  Days worked: 6  ·  Commits: 214
Total time (model): 31h 12m  (31.2 h)
Timezone: UTC  ·  Break threshold: 30 min  ·  Range: fd98f168..c51bacb9
...
```

## What it measures — and what it does not

Commit timestamps **bound** work; they do not **measure** it. You can commit twice in a
minute or think for two hours between commits. So "hours worked" here is a **model
output**, not a measured truth:

```
worked(day) = Σ over consecutive commits of  min(gap, break_gap)
```

i.e. the day's span minus every inter-commit gap longer than the break threshold. It is
**floor-biased on purpose**: a gap over the threshold counts as a break worth zero, and
an isolated commit contributes zero span — so it **under-counts** real time rather than
inflating it. It is a derivation (`⊢`), never a measured truth (`⊨`).

**It is not a timeclock.** Do not bill a client to the minute or adjudicate someone's
hours with it. The one judgment call — `--break-gap` (default 30 min) — is printed in
every report so the number always carries its own assumption.

## Usage

```
git log --format='%H %at %s' | node timesheet.js [--break-gap MIN] [--tz ZONE]

  --break-gap MIN   a gap over MIN minutes counts as a break worth zero (default 30)
  --tz ZONE         IANA timezone for day bucketing (default UTC)
  --help            usage + the edge
```

Input is one commit per line on stdin: `<sha> <author-epoch-seconds> <subject>`. That is
exactly what `git log --format='%H %at %s'` emits. Because it reads a piped stream rather
than shelling out to git itself, it has **no dependency on git, no subprocess, and no
repo** — you can feed it any timestamped event stream, and it is trivially testable.

## Determinism

The output is a pure function of `(input, --break-gap, --tz)`. No wall-clock is read; the
report stamps the commit range, not a generation time. The same input always produces
byte-identical output.

## As a library

```js
const { computeTimesheet } = require('./timesheet.js');
const ts = computeTimesheet(commits, { breakGapMin: 30, tz: 'UTC' });
// commits: [{ sha, epoch (int seconds), subject }]
// ts.totalWorked (seconds), ts.byDay, ts.byWeek, ts.byMonth, ...
```

In a browser it attaches to `window.LoopGifts.timesheet`.

## Provenance

Stripped from Loop MMT's internal instrument **The Timesheet**, keeping the
floor-biased `worked` model and its honest ceiling, dropping the Loop-MMT-specific
report skin and session grammar. MIT.
