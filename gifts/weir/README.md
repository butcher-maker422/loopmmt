# weir

**Run a pipeline under a declared budget — in real units, never tokens.**

You have a prompt-pipeline — a command that reads JSON-lines on stdin and writes
them on stdout, the kind the `declare`/`conductor` gifts drive. You want to run it
under a ceiling: *stop after 10,000 rows*, *stop after 30 seconds*, *stop after
5 MB*. `weir` is that gate. You declare the budget in units you can actually meter
— **rows, wall-time, bytes** — and weir runs the command, counting as records
flow, and cuts the flow clean the instant a ceiling is crossed. It names which
budget you exceeded, exits non-zero so it fails a pipeline, and leaves a receipt
you can replay. A weir on a river holds the water back to a measured level; this
one holds a run back to a measured cost.

```
$ weir.py run --max-rows 10 --trace DEMO --ledger run.jsonl -- python3 emit.py 100
{"i": 0}
{"i": 1}
 ... (exactly 10 rows) ...
{"i": 9}
# stderr: {"budget":"rows","count_at_cut":11,"limit":10,"reproducible":true,"verdict":"cut", ...}
# exit 3

$ weir.py check --max-tokens 5000
weir: a budget is rows, wall-time, or bytes -- never tokens. ...
# exit 2
```

## The one rule that makes it a weir, not a throttle

**A budget is rows, wall-time, or bytes. Never tokens.** If you ask weir for a
token budget (`--max-tokens`) it refuses — by construction, with a reason — and
exits 2. Tokens are a model-internal proxy: you cannot meter them
deterministically, offline, without the model's own tokenizer, and two tokenizers
disagree on the same text. A budget you cannot meter is not a budget, it is a
hope. weir meters the real resource the tokens were standing in for — the rows you
process, the seconds you spend, the bytes you move — and declines the proxy out
loud.

## What it does, in order

1. **Read the declared budget** — one or more of `--max-rows N`, `--max-seconds S`,
   `--max-bytes B`. At least one real ceiling is required; a run with no ceiling is
   refused (exit 2) — a weir with no wall holds nothing.
2. **Run the command,** feeding it `--input` if you gave one, reading its stdout as
   JSON-lines.
3. **Count as it flows** — rows emitted, bytes emitted, seconds elapsed — and pass
   each record through until a ceiling is crossed.
4. **Cut clean at the wall.** The record that would cross a ceiling is **not**
   emitted — weir stops at the wall, not past it — records the breach (which
   budget, the limit, the count at the cut) to an append-only ledger, and exits 3.
   Under budget to the end: exit 0.

## The budget model

| unit        | meaning                          | reproducible?              |
|-------------|----------------------------------|----------------------------|
| `rows`      | records emitted on stdout        | yes — exact count          |
| `bytes`     | bytes emitted on stdout          | yes — exact count          |
| `wall-time` | seconds since the run began      | **no** — machine-dependent |
| `tokens`    | *refused — not a real resource*  | —                          |

`rows` and `bytes` give a **byte-identical** verdict for a given input on any
machine — the same records in yield the same cut every run. `wall-time` is the one
honest exception: it depends on the machine and the load, so a wall-time cut is
real but not reproducible, and weir says so in the receipt (`"reproducible":
false`). The deterministic core is rows+bytes; trust a rows or bytes cut to
reproduce exactly, and never trust a wall-time cut to.

## Why a ledger, not just an exit code

A pipeline that stops at a budget answers *"did it finish?"* with a bare non-zero.
It does not say which wall it hit, or how close the others were. weir's receipt
does: the budget that cut it, the ceiling, the counts at the cut, and the
trace-id — so *"why did this run stop?"* has an answer you can read back and replay
by trace-id. This is `conductor`'s trace-id-and-ledger idea applied to a budget cut
instead of a stage failure: the same honesty about leaving a receipt.

## The honest ceiling

weir cuts the flow it can see — the command's stdout, line by line. It does **not**
cap the command's own internal resource use: a command that reads a 10 GB file into
memory before emitting its first row is past weir's reach until that row appears.
It does not sandbox the command; it is exactly as safe as the command you give it.
And a wall-time cut is real but not reproducible — the same input can cut at a
different row on a slower machine. weir proves the rows and bytes cuts reproduce; it
reports the wall-time cut honestly as environment-dependent. It meters flow at the
pipe, and it refuses to pretend a token is a resource it can meter.

## Usage

```
weir budget                                         # the budget model (JSONL)
weir check  --max-rows N [--max-seconds S] [--max-bytes B]   # validate, don't run
weir run    --max-rows N [...] [--input F] [--ledger F] [--trace ID] -- CMD ARGS...
weir replay --ledger F --trace ID                   # every record for a trace-id
```

Exit codes: `0` under budget · `3` cut at a ceiling (the ledger names which) ·
`2` refused (token budget, empty budget, or usage error).

## Requirements

Python 3, standard library only. No dependencies. Offline. Deterministic core.

## License

MIT. See `LICENSE`.
