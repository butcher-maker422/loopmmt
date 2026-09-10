# quorum — ask three, trust the overlap

**quorum** takes the answers you already collected — one prompt run through several
models, or the same model run several times — and decides what they **agree on**. It
emits the agreed value (if enough of them concur), the full tally of who said what, and
the dissent. It is a pure counting fold: same answers in, same verdict out, every run.

Zero dependencies. Runs identically in a browser (`window.quorum`) or on Node
(`require`). No network, no API keys, no model calls — you bring the answers, quorum
folds them.

## Use

```
node quorum.js FILE.jsonl                       # one {"label":..,"answer":..} per line
node quorum.js --lines FILE.txt                 # each line is an answer (label = line no.)
node quorum.js --answer gpt=42 --answer claude=42 --answer llama=43
cat answers.jsonl | node quorum.js              # reads stdin when no FILE is given
node quorum.js --selftest                       # run the golden selftest
```

Exit code is a gate: **0** on a clean quorum, **2** on no-quorum or a tie — so
`... | node quorum.js` fails a pipeline when the sources don't converge.

## What it emits

For `--answer gpt=42 --answer claude=42 --answer llama=43`:

```
verdict: quorum  →  "42"
n=3  needed=2 (majority)
tally:
  2×  "42"   [gpt, claude]
  1×  "43"   [llama]
dissent:
  llama: "43"
```

Add `--out-json` for the full result object: `{ verdict, value, agree, dissent, tally,
n, needed, threshold }`.

## Agreement is declared, never guessed

Two answers "agree" only after **normalization**, and the normalize is conservative by
default so nothing merges silently:

- **default** — trim outer whitespace, collapse internal whitespace runs to one space.
- `--fold-case` — case-insensitive.
- `--json` — parse each answer as JSON and compare by a canonical, key-sorted form, so
  `{"a":1,"b":2}` and `{"b":2,"a":1}` agree.

The **threshold** is declared too:

- **default** — strict majority (`floor(n/2) + 1`).
- `--threshold N` — need exactly N matching answers.
- `--unanimous` — need all of them.

If the top answer doesn't reach the needed count, the verdict is **no-quorum** — never a
quiet plurality passed off as agreement. If two answers tie for the top count *and* meet
the threshold, the verdict is **tie** with no winner — quorum will not pick one for you.

## The edge (what quorum does not do)

> quorum counts agreement; it does not judge correctness. N sources can agree and all be
> wrong — a majority can be a shared blind spot. A quorum means "this many independently
> landed here", never "here is right". It does not call the models for you — you bring the
> answers, it folds them. **Concordance, not truth.**

This is deliberate. Quorum ships the consensus *fold* and declines the "run N models"
step, because that step needs a network, keys, and a substrate — and would stop the
output being a pure function of its input. You keep the model-calling; quorum gives you
the honest, replayable, offline count.

## Guarantees

- **Deterministic.** The same answers and options always yield the same verdict — no
  clock, no randomness, no I/O in the core. `--selftest` proves it folds twice identical.
- **Never invents an answer.** `value` is always one of your input answers, verbatim, or
  `null`.
- **Nothing dropped.** Every input answer is counted; `agree` and `dissent` together
  cover every label exactly once. An empty answer is a real answer — it counts.

MIT licensed. One file. Take it.
