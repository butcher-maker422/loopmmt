# WUPHF — say one thing once, see it shaped for every channel at once

**WUPHF** takes one message and renders it for every channel you declared — SMS, email,
voicemail, fax, chat, social — side by side, and shows you the **cost each channel imposes**:
the SMS segment count, the character count against the cap, where the text will be cut, how
long the voicemail takes to read aloud. You copy each one and send it yourself.

It's the joke from *The Office* — Ryan's startup that blasts one message to fax, email, and
phone at once — played straight and made honest. On the show WUPHF is a disaster precisely
because it **hides** the mismatch between the channels. This gift is the inversion: it makes
the mismatch **visible**. Same idea; opposite ethic.

Under the hood, WUPHF is the **typed member of the fanout family** (the parallel-independent
compose, the ⊗ product): `fanout` splits one payload into N identical labeled copies; WUPHF
splits one message into N channel-**shaped** renders. Same jig, typed branches.

Zero dependencies. Pure function — same message + same channel set yields byte-identical
output, every run. Runs in a browser (`window.ForestGifts.wuphf`) or on Node.

## Use

```
node wuphf.js "your message"                        # all channels
node wuphf.js --channels sms,social "your message"  # a chosen subset
echo -n "your message" | node wuphf.js               # message from stdin (exact bytes)
node wuphf.js --json "your message"                  # machine-readable JSONL
node wuphf.js --list                                 # the declared channels
node wuphf.js --help
```

Text mode prints one card per channel — the render plus its honest cost line:

```
── SMS ────────────────────────────────────
Standup moved to 10am
  → 1 segment (21/160 septets, GSM-7)

── SOCIAL ─────────────────────────────────
Standup moved to 10am
  → 21/280 chars — fits
```

`--json` emits one JSONL record per channel, in declared order:

```
{"channel":"sms","render":"…","cost":{…},"seq":0,"of":6}
```

The declared, closed channel set is `sms, email, voicemail, fax, chat, social`. Adding a
channel is a new render entry (config, not code). WUPHF **fails closed** — non-zero exit, the
offending channel named — on an unknown, empty, or duplicate channel. There is no default
channel.

### What each channel knows

- **sms** — GSM-7 vs UCS-2 encoding detection, septet counting (extension chars cost two),
  the 160/70 single-segment cap and 153/67 multi-segment cap, honest segment count.
- **email** — splits a subject from the first sentence, the rest becomes the body; reports the
  subject length against the 78-char recommended max.
- **voicemail** — a spoken script plus a read-aloud estimate at 150 wpm, flagged if it runs
  over ~30 seconds.
- **fax** — a cover sheet (To/From/Date/Re, left blank to fill) above the body. The date is a
  placeholder, never the system clock (a gift is a pure fold with no clock).
- **chat** — a plain single block; no hard cap, char count reported.
- **social** — the 280-char cap, honest over-count, truncation point named.

## The edge (what it does NOT do)

> WUPHF renders your message for every channel and counts the cost each imposes. It does **not**
> send anything, connect to any service, fire a `mailto`, or judge whether the words are good.
> It counts the cost each channel imposes; you copy each render and send it yourself.

The sending is deliberately not here. A tool that fanned your real message to your real
contacts' real channels would need credentials and would be sending on your behalf — that is
exactly the mismatch the honest version refuses to hide behind a single "sent ✓". WUPHF shows
you the shapes and the costs; the send is yours.

## Test

```
node test_wuphf.js    # GREEN (exit 0) / RED (exit 1): golden corpus + segment math + determinism + non-vacuity
```

Released under the MIT License (see `LICENSE`).

<!-- keel: gift -->
