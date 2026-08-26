# Cairn

**A self-healing, multi-store git fabric in one script.** git + POSIX-ish bash
only, no dependencies, MIT licensed.

> Keep the same repo alive on several *independent* stores, so losing any one of
> them — a host outage, a deleted account, a revoked token, a dead disk — never
> costs you the repo.

## The idea in one paragraph

A backup on the same provider as the original is not a second copy — it is the
same bet twice. Cairn makes durability a property of **independence classes**,
not of copy count. You tag each store with the failure domain it belongs to (a
big public host, a *different* public host, a box you run yourself, an offline
bundle), and you set a threshold in **distinct classes**. A push succeeds only
when enough independent classes confirm it; two repos on the same provider count
once, because the day that provider goes down they both go with it. Cold-boot is
a **priority-ordered failover clone** — try each store in turn, the first live
one wins, and it only gives up when *all* of them are dead. Catching a lagging
mirror back up is **frontier** — it REPORTS the newest head among heads that are
comparable (a laggard is just behind), read-only: it records the discovered
heads and prints the frontier SHA, and moves nothing. You adopt it yourself with
`git fetch && git merge --ff-only <frontier>`. And the one thing it will never do
quietly is paper over a real fork: two *incomparable* heads are surfaced as a
divergence and left for you to resolve by hand.

## Install

Copy `cairn.sh`. Copy `stores.example` to `stores` and edit it. That's it.
Bash 4+ and git. (For private stores, also copy `askpass.example.sh`; see
*Credentials* below.)

## Use

```bash
# describe your stores once (name | class | priority | url | enabled)
cp stores.example stores && $EDITOR stores
cairn.sh doctor                 # validate: enough distinct classes for the threshold?

# cold boot: clone from whichever store is up, in priority order
cairn.sh clone ./repo

# every time you'd push: fan out to all stores, succeed on >= threshold classes
cairn.sh push                   # ref defaults to HEAD -> main
cairn.sh push main

# catch a lagging mirror up (run inside a working clone)
cairn.sh frontier
```

The threshold and the store list live in `stores`, never in the script. Edit the
config; leave `cairn.sh` alone.

## Credentials (private stores)

Cairn holds no secret and needs to know none. Private stores authenticate through
git's askpass helper (`askpass.example.sh` → copy to `askpass.sh`, edit the host
arms). The helper reads a token from a **gitignored** file at call time and writes
it **only to git's stdin** — never into a remote URL, an environment variable, a
log, or a commit. One scoped token per store, so a single leak reaches a single
store — the same independence the class model buys. See the comments in
`askpass.example.sh` for wiring.

## What it's good for (graded honestly)

- **Surviving the loss of a whole store — its reason to exist.** Provider deletes
  your account, a host has a bad week, a token gets revoked, a disk dies: as long
  as one store in a *different* class is up, `clone` still works and `push` still
  meets threshold.
- **Cold-boot on a fresh machine when you don't know what's up.** The failover
  clone tries stores in order and takes the first that answers.
- **Finding the newest head after an outage.** `frontier` reports the newest
  comparable head (read-only); you fast-forward to it and `cairn push` fans it
  back out. No guessing which mirror is ahead.
- **Refusing to hide a fork.** Two incomparable heads become a recorded,
  loud divergence — the one case you *must* see, made impossible to miss.

## What it is **not** good for — read this before you trust it

- **Corruption you push yourself.** Cairn heals **availability, not
  correctness.** A bad commit, a force-push over history, a secret committed by
  mistake — these fan out to every mirror faithfully. It protects you from
  *losing* the repo, not from *breaking* it. (Pair it with review and history
  protection; that is a different tool.)
- **Automatic conflict resolution.** A real fork (incomparable heads) is
  **never** auto-merged. Cairn records it and stops. Merging is a human call.
- **Independence you only claimed.** The class tags are a promise *you* make.
  Two stores you labeled different classes but that actually share a data center,
  a DNS provider, or a billing account are one class wearing two hats. Cairn
  trusts your labels; it cannot verify them. `doctor` checks the *count* of
  distinct classes, not the *truth* of them.
- **A live `file://` store on an ephemeral machine.** That is a phantom copy that
  vanishes with the machine. Realize the offline class as an operator-held
  `git clone --all` bundle you regenerate on a cadence, and keep the entry
  disabled.

The tool prints its honest ceiling as part of every run. Shipping the limits
*with* the tool is the point.

## The knobs

- `threshold = N` (in `stores`) — how many **distinct classes** must confirm a
  push. Set it to *(independent failures you want to survive) + 1*. Default 2.
- `CAIRN_STORES` — path to the config (default `./stores`).
- `CAIRN_TIMEOUT` — per-store network timeout in seconds (default 10).

## Provenance

Extracted and generalized from the multi-store git fabric that keeps a private
methodology repo alive across a public host, a second public host, and a
self-hosted box. The specific stores, hosts, and credentials stayed home; this is
the general kernel — the failover clone, the distinct-class push, the max-head
frontier, and the call-time credential discipline — given away.

## License

MIT. See `LICENSE`.
