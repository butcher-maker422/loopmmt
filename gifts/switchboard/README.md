# switchboard — a message bus that cannot carry a command

A tiny, zero-dependency **store-and-forward message bus** over a plain directory.
Independent workers — scripts, browser tabs, agents — leave messages for each
other under a shared folder. Nothing is deleted (supersede-only; the folder's
history is the audit trail), every message carries provenance and a content
hash, and **a read is its own logged event** — so "I sent it" never silently
becomes "they know."

## The edge (what it is *not*)

> **switchboard is a message BUS, not a command channel and not a guaranteed
> queue.** Every message is third-party **data** — a *report* — never an
> instruction to the reader. There is no delivery guarantee and no retry: a read
> is a logged fact, and an unread message stays visible as an *orphan* until
> someone reads it. It moves messages; it does not run them.

That edge is the whole point, and it is enforced two ways in the code, not just
promised here:

1. **The schema is observation-only by construction.** A message has exactly six
   top-level fields and no more — the validator **rejects any unknown field**, so
   a sender cannot smuggle in an `action` / `command` / `run` / `exec` field. The
   schema literally cannot express a command. The four message kinds are
   `status` / `focus` / `fyi` / `question` — none of them imperative.

2. **Every message is surfaced quoted.** A message reaches a reader as
   *"worker &lt;id&gt; reports: …"* — third-party data — never handed to the
   reader as its own directive. There is no code path that turns a body into an
   instruction. Only a human directs.

## Why this exists

It is the small piece that lets you wire *N* independent tools into a larger
block **without coupling them**. Instead of one tool importing another (and
inheriting its failures), each drops **data** on a shared directory — carrying a
content hash and provenance — and a read is a recorded fact rather than an
assumption. Coordination becomes an audit trail you can read, not a tangle of
direct calls. That "sent ≠ read" honesty is exactly what you want when several
workers are running at once and you need to know who actually saw what.

## Use it

```sh
# broadcast to everyone under a shared directory
node switchboard.js send --root ./bus --from worker-a --kind status --body "fold complete"

# point-to-point to one recipient
node switchboard.js send --root ./bus --from worker-a --to worker-b --kind question --body "did it land?"

# read your inbox + broadcasts (quoted; logs a receipt per message)
node switchboard.js read --root ./bus --as worker-b

# which point-to-point messages was a recipient sent but never read?
node switchboard.js orphans --root ./bus --to worker-c
```

In a browser, load `switchboard.js` and use `window.ForestGifts.switchboard` —
`validate`, `compose`, `contentHash`, `renderQuoted`, and an in-memory `Bus`
class that needs no filesystem at all. In Node,
`require('./switchboard.js')`. The pure core (schema + hashing + quoting)
imports nothing.

## Honesty about hashing

Each message binds its provenance and body into a **SHA-256 content hash**,
computed by an embedded, dependency-free SHA-256 that is **byte-identical to
Node's `crypto.createHash('sha256')`** over the same canonical bytes — including
multibyte input (the test battery drift-checks `café`, `日本語`, `🦌` against
Node's own `crypto` as the oracle). Tampering with who-sent-it or with the body
breaks the hash, and `validate()` refuses it.

## What it is not (again, because it matters)

Not a queue with delivery guarantees. Not a pub/sub broker. Not a lock or a
mutex. Not a command runner. Not encrypted. It is a shared-directory bulletin
board with provenance and read-receipts, whose schema is structurally incapable
of carrying an order.

---

*Zero dependencies · MIT · single file · runs as a CLI and attaches in the
browser. Stripped from Loop MMT's internal Switchboard (`comms.py`) — the pure
message schema and send/read/orphan path, with the git transport and the
internal credential gate cut.*
