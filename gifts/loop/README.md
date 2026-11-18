# loop

**Feed a small JSON-lines tool its own output, a bounded number of times — with a record of every pass.**

You have a little tool that reads JSON lines and writes JSON lines of the same shape: a Game of Life step, a smoothing
pass, a "tidy this once more" filter. A shell pipe can run it twice (`A | A`). `loop` runs it N times from one command,
can stop early when the output stops changing, refuses a tool that can't take its own output, and leaves a receipt of
every pass.

```
printf '%s\n' '[0,1]' '[1,2]' '[2,0]' '[2,1]' '[2,2]' \
  | python3 loop.py run --stage life:fold:'node life-fold.js' --closed --max-passes 4
  ->  the glider, four generations on — byte-identical to  life-fold --steps 4
```

It is the feedback arrow around one stage, and nothing more. The composition gifts here already put tools in a line
(`|`) and side by side (`fanout` and `junction`); `loop` is the third way: back into themselves.

## What can be looped

Every composition gift here uses the same five port-verbs. A stage can be fed its own output only if it accepts what it
emits:

| Port-verb | Can it be looped? |
|---|---|
| `transform` | yes |
| `filter` | yes |
| `fold` | only if you declare it closed under its own I/O with `--closed` (like `life-fold`, whose next generation has the same shape as the last) |
| `source` | never — it takes no input |
| `sink` | never — it emits nothing |

A loop takes on its stage's verb: a loop around a transform is a transform, so it fits anywhere that stage would.

## The bound is not optional

`--max-passes` is required, from 1 to 1,000,000. A loop with no bound is refused before it runs (exit 3). Two stop
rules:

- `--until passes` (the default): run exactly `--max-passes` passes.
- `--until fixed`: stop as soon as a pass returns its own input byte for byte — a fixed point. If the bound comes first,
  `loop` still prints the last output but exits **6**, so a loop that never settled can't pass for one that did.

## The record

Every pass appends one JSON line to the ledger (`--ledger`, default `loop.ledger.jsonl`): the trace id, the pass
number, bytes in and out, the sha256 of the output, the stage's exit code, and a verdict (`ok`, `fixed` or `failed`).
One summary line closes the run and says why it stopped (`bound`, `fixed` or `failed`). `loop replay --ledger FILE
--trace ID` prints a run's rows back in order.

## Determinism

`loop` adds nothing that varies: no clock, no random id, no timestamp in the ledger. The trace id is derived from the
stage, the bound, the stop rule and the input unless you pass `--trace`. If your stage is deterministic, the same loop
on the same input writes the same ledger, byte for byte.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | ok — can loop / ran to its stop rule / replayed |
| 2 | usage error — bad arguments, an unreadable file, an unknown trace on replay |
| 3 | the loop does not check — a source or sink, an unclosed fold, or a missing or out-of-range bound |
| 4 | the stage's port-verb is undeclared or not one of the five |
| 5 | a pass failed — the loop stopped, printed nothing, and the ledger names the pass |
| 6 | `--until fixed` was asked for and the bound came first |

## Edge

loop runs the command you give it, as often as you allow — it is exactly as safe as that command and does not sandbox it; its check proves the stage can be fed its own output and the loop is bounded, never that the records really fit, that the loop converges, or that the answer is right.

## Usage

```
python3 loop.py verbs
python3 loop.py check  --stage slug:verb:cmd [--closed] --max-passes N [--until passes|fixed]
python3 loop.py run    --stage slug:verb:cmd [--closed] --max-passes N [--until passes|fixed]
                       [--input FILE] [--ledger FILE] [--trace ID]
python3 loop.py replay --ledger FILE --trace ID
```

Python standard library only. No dependencies. MIT licensed.
