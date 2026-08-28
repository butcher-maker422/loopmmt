# dwell — the *when* you commit is the *what* you choose

A cart circles a loop of `n` ticks. Holding is free — it can circle forever, and
an extra full lap changes nothing. It leaves only when you **reverse**, and which
of `k` exits it leaves on is a pure function of the **phase** at the instant of
reversal:

```
phase(entry, reverse, n)            = (reverse - entry) mod n      # where on the loop, in [0, n)
exit_segment(entry, reverse, n, k)  = (phase * k) // n             # which of k exits, in [0, k)
```

There is no separate "pick" step. Deferring costs nothing, and the moment you stop
deferring **is** the decision. That's the whole idea: a decision structure where
latency isn't lost time — it's the signal that carries the choice.

## Why it's honest

- **Integer-exact, no float.** The map is total and pure, so the same
  `(entry, reverse, n, k)` yields the same exit on any machine, forever.
- **Free-hold.** The *winding* number (how many full laps you circled) is discarded
  for routing — so a decision deferred through extra laps is never penalized:

  ```
  exit_segment(entry, reverse, n, k) == exit_segment(entry, reverse + n, n, k)
  ```

- **A decision is an audit record, not an opinion.** A `Mark` stores a routing
  decision as two integers; `replay(mark, n, k)` re-derives the exit from them. You
  re-check a decision by recomputing it, never by trusting a stored verdict.

## The honest edge

This is the fully-deterministic **router**: given the four integers, the exit is a
fact. It does **not** decide *when* to stop deferring — that single judgment (the
reversal itself) is yours. Dwell turns your timing into a choice; it does not make
the choice for you. And `k <= n` is a wall: you can't quantize a loop of `n` ticks
into more than `n` distinguishable exits, so `k > n` is refused, not rounded.

## Use it

```bash
python3 dwell.py route 0 6 12 4    # entry@0, reverse@6, loop=12, exits=4  -> exit segment
python3 dwell.py route 0 18 12 4   # +1 full lap from tick 6 -> the SAME exit (free-hold)
python3 dwell.py phase 0 18 12     # phase + winding (laps circled)
python3 dwell.py demo              # a small routing table you can eyeball
```

As a library:

```python
from dwell import exit_segment, phase, winding, Mark, replay

exit_segment(0, 6, 12, 4)          # 2
exit_segment(0, 18, 12, 4)         # 2  — an extra lap changed nothing
replay(Mark(3, 20), 12, 4)         # re-derives the exit from the audit record
```

## Test it

```bash
python3 test_dwell.py    # 89 checks: free-hold, the routing law, replay, the k-wall,
                         # refusals on malformed input, + a mutation bite
```

Python 3 stdlib only, no dependencies. MIT licensed. Take the folder.
