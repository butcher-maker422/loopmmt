# vclock

**Reason about the causal order of a stream of records — is A before B, or are
they concurrent?** ~210 lines, Python standard library only, no dependencies,
MIT licensed.

> Wall-clock time can tell you which of two events has the later timestamp. It
> cannot tell you whether one *caused* — or could even have *known about* — the
> other. A vector clock can. This gets that reasoning onto a pipe.

## The idea in one paragraph

Give every actor its own counter and carry the whole set of counters — the
*vector* — on each record. Now two records can be compared: if every one of A's
counters is less-than-or-equal to B's (and they differ), then A **happened
before** B; if neither dominates the other, they are **concurrent** — causally
independent, neither able to have known about the other. That last case is the
one a timestamp can never express and the whole reason the primitive exists. A
distributed system, an offline-first app syncing later, a git-like history with
branches — anywhere edits happen in more than one place and have to be merged,
this is how you tell a real ordering from a coincidence of clocks.

## Install

Copy `vclock.py`. That's it. Python 3.8+.

## Use

Records are JSON, one per line. Each may carry a `clock` field mapping actor
names to integer counts. An actor not present is read as `0` — it just hasn't
been seen.

```bash
# stamp every record: actor "alice" observed/produced it
echo '{"id":1,"clock":{}}' | python3 vclock.py bump --actor alice
# → {"clock":{"alice":1},"id":1}

# is one record's clock before, after, concurrent with, or equal to another's?
printf '{"clock":{"a":1}}\n{"clock":{"b":1}}\n' | python3 vclock.py compare
# → {"relation":"concurrent"}

printf '{"clock":{"a":1}}\n{"clock":{"a":1,"b":1}}\n' | python3 vclock.py compare
# → {"relation":"before"}

# fold a stream of clocks into one — the least clock that dominates them all
printf '{"clock":{"a":2,"b":1}}\n{"clock":{"a":1,"b":3}}\n' | python3 vclock.py merge
# → {"clock":{"a":2,"b":3}}
```

Because it reads and writes JSON lines, it sits in the middle of a pipe — for
example, ordering a commit stream causally:

```bash
gitlog --repo . | add-a-clock-field | vclock bump --actor ci | your-fold
```

## Operations

| subcommand | in → out | what it does |
|------------|----------|--------------|
| `bump --actor A` | record → record | increment A's component on each record's clock (A absent → starts at 1); other fields untouched |
| `merge` | stream → one clock | component-wise maximum of every record's clock; emits `{"clock": {...}}` |
| `compare` | exactly 2 records → one verdict | emits `{"relation": R}`, R ∈ `before` / `after` / `concurrent` / `equal` |

## The causal relation

For two clocks X and Y, with any absent component read as `0`:

- **equal** — `X[a] == Y[a]` for every actor `a`
- **before** — `X[a] <= Y[a]` for every `a`, and `X != Y` (X causally precedes Y)
- **after** — Y is before X
- **concurrent** — neither before nor after (causally independent)

The absent-is-zero rule is load-bearing: `{"a":1}` is **before** `{"a":1,"b":1}`
because the first has `b=0` implicitly. A comparison that only looked at the keys
two clocks share would miss this — and that miss is the difference between a real
vector clock and a plain counter.

## Exit codes

| code | meaning |
|------|---------|
| `0` | ran and emitted (including the empty stream) |
| `2` | malformed input, or a clock component that isn't an integer — the stream isn't trustworthy |
| `3` | usage error, or `compare` didn't get exactly two records |

Errors go to stderr; stdout stays clean JSON lines, so a downstream fold never
sees a diagnostic mixed into its input.

## Test

```bash
python3 test_vclock.py
```

37 tests. The `compare` cases carry the weight — including the absent-is-zero
cases that separate a real vector clock from an impostor — and a mutation section
proves the suite isn't vacuous: it injects believable-wrong implementations
(compare only shared keys, no concurrent branch, merge by min) and asserts the
suite would catch each one.
