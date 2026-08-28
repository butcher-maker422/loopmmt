# callsigns — memorable IDs that are safe by construction

A random identifier you can read aloud, remember for the length of a standup, and
paste anywhere without escaping. Every token has the shape:

```
word-word-hash          e.g.  sunny-champion-8h3kq7
```

Two human-readable words from a curated pool, then a six-character disambiguating
hash. The whole point is that all three parts are **ref-, path-, URL-, and
shell-safe by construction** — not "usually fine," but safe as a proven property
of the alphabet each part draws from. A callsign drops straight into a git branch
name, a directory name, a URL segment, or a shell argument with no quoting and no
surprises.

```
$ python3 callsigns.py
turbo-dynamo-qfj4ms

$ python3 callsigns.py --n 3
feral-sprocket-6vydyt
lanky-fjord-bg807s
untamed-disco-vryetd

$ python3 callsigns.py --seed 42
crispy-walrus-hfe865        # same seed, same token, on any machine
```

## Why it's honest

- **Safe by construction, not by hope.** The words pass a lowercase-ASCII
  allowlist; the hash draws from a confusable-free, case-safe base32 alphabet
  (digits + `a-z` minus `i/l/o/u`). Every character clears git refs, Windows and
  macOS filenames, RFC-3986 URL segments, and the shell. There is nothing to
  escape, so there is no escaping step to forget.

- **No case-fold collisions.** Everything is lowercase, so two callsigns can't
  collide only because a filesystem folded their case.

- **The namespace is a stated number, not a vibe.** 64 × 64 word-pairs = 4096
  memorable prefixes; the six-char hash adds 32⁶ (~1.07e9) per prefix, for
  ~4.4e12 total. You can reason about collision odds because the size is exact.

- **No degenerate pairs.** A token is never `word-word` with the two words equal;
  the draw rejects and redraws.

- **Seed it and it's deterministic.** `--seed N` yields the same token forever, so
  demos, tests, and fixtures are byte-identical. Leave the seed off and it draws
  from the system CSPRNG.

## The honest edge

A callsign is a **memorable, safe** identifier, not a **guaranteed-unique** one.
The hash makes an accidental collision astronomically unlikely, but "unlikely" is
not "impossible." If your system's correctness depends on uniqueness, pair a
callsign with a real uniqueness source — a timestamp prefix, a sequence, or a
registry that rejects duplicates. Callsigns buy you memorability and
paste-safety; they don't replace a uniqueness authority.

## Use it

```
python3 callsigns.py                 # one callsign
python3 callsigns.py --n 5           # five, one per line
python3 callsigns.py --seed 42       # deterministic
python3 callsigns.py --demo          # a short reproducible demonstration
```

As a library:

```python
import random
import callsigns

callsigns.draw()                       # one, from the system CSPRNG
callsigns.draw(rng=random.Random(42))  # deterministic
callsigns.draw_many(5)                 # a list of five
```

Python standard library only. Deterministic under `--seed`. Headless. The word
pool lives in `wordlist.json` beside the script — edit it to change the flavor;
the safety filter still applies to whatever you put there.

## Tests

```
python3 test_callsigns.py
```

Mutation-bitten: the determinism test pins a **golden sha256** of a seeded batch
rather than checking self-equality, because a self-equality test passes benign
reorders. Each test is here because a plausible mutation makes it fail loud.

MIT licensed. © 2026 Shea Gunther.
