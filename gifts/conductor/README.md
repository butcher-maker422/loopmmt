# conductor

**Run a declared pipeline of small JSONL tools — with a record.**

You have a saved "score" — an ordered pipeline of little JSON-lines tools, the
kind the `declare` gift writes. You could run it with a shell pipe. What the
shell won't do: check the pipeline typechecks *before* it runs, thread one
trace-id through the whole run, and hand you back a receipt of what each stage
did — its exit code, bytes in and out, and which stage broke. `conductor` does
that. It is a **provenance-runner**, not a shell wrapper.

```
$ conductor.py run \
    --stage emit:source:'python3 emit.py' \
    --stage pass:transform:'python3 pass.py' \
    --stage count:fold:'python3 count.py' \
    --ledger run.jsonl --trace DEMO
{"count":2}

$ conductor.py replay --ledger run.jsonl --trace DEMO
{"kind":"run-start","n_stages":3,"trace_id":"DEMO"}
{"bytes_in":0,"bytes_out":16,"exit":0,"index":0,"kind":"stage","slug":"emit","trace_id":"DEMO","verdict":"ok"}
{"bytes_in":16,"bytes_out":16,"exit":0,"index":1,"kind":"stage","slug":"pass","trace_id":"DEMO","verdict":"ok"}
{"bytes_in":16,"bytes_out":12,"exit":0,"index":2,"kind":"stage","slug":"count","trace_id":"DEMO","verdict":"ok"}
{"kind":"run-end","trace_id":"DEMO","verdict":"ok"}
```

## What it does, in order

1. **Typecheck first.** conductor carries its own copy of the five-verb
   composition gate (the same rule the `typecheck` and `declare` gifts use) and
   **refuses to run** a pipeline that doesn't compose — a sink that isn't last, a
   source that isn't first (exit 3). You never watch a broken pipeline half-run;
   it's stopped before a single stage launches.
2. **Run the stages in order,** piping each stage's stdout into the next's stdin,
   exactly as a shell pipe would — but under one trace-id.
3. **Record every stage** to an append-only ledger: trace-id, index, slug,
   command, exit code, bytes in/out, verdict. JSON-lines, replayable by trace-id.
4. **Fail clean.** If a stage exits non-zero, conductor stops, records that stage
   `failed` and every later stage `skipped`, and exits 5 — naming the stage that
   broke. No later stage runs on a broken input.

## The model

Five port-verbs on the shared JSON-lines interface, and only five (the same five
the `port`, `map`, `typecheck`, and `declare` gifts use):

| verb        | contract                        | meaning                                  |
|-------------|---------------------------------|------------------------------------------|
| `source`    | nothing → JSONL                 | emits; no meaningful stdin               |
| `transform` | JSONL → JSONL                   | record in, record out                    |
| `filter`    | JSONL → JSONL′ (output ⊆ input) | record in, a subset out                  |
| `fold`      | JSONL → JSONL_agg               | records in, an aggregate/narrower record |
| `sink`      | JSONL → nothing                 | terminal side effect, no pipeable stdout |

A pipeline composes iff every adjacent join A → B has A **emits** (≠ `sink`) and B
**accepts** (≠ `source`). conductor carries its own copy of that gate so it stands
alone — it agrees with `typecheck` and `declare` by sharing the rule, not by
importing them (a gift is single-file and zero-dependency by covenant).

## Why a record, not just a pipe

A shell pipe answers "did it work?" with one combined exit status and interleaved
stderr. When a five-stage pipeline produces nothing, the shell won't tell you
*which* stage went dark. conductor's ledger does — one record per stage, in
order — so "what happened to this run?" has an answer. This is the `tracebus`
gift's trace-id-and-ledger idea (tracebus is a routed message bus with a
replayable ledger) applied to a **linear ordered run** instead of a fanned-out
bus: a different shape, the same honesty about leaving a receipt.

## The honest ceiling

conductor **runs the commands you give it** — it is exactly as safe as the
commands in the score, and it does not sandbox them. Its typecheck is the
**type**-level gate (ports line up so data can flow), not a proof the **records**
fit or that a stage is correct: a pipeline can typecheck clean, run to
completion, and still have done the wrong thing. conductor proves the run
happened, in order, with a receipt — it never proves the run was right.

conductor's own port-verb is `sink`: it consumes a pipeline and the data flowing
through it and produces side effects — the stages' work and the ledger — with no
pipeable JSONL of its own. Its stdout is the final stage's stdout, passed
through; the run summary goes to stderr so it never pollutes that passthrough.

## Usage

```
conductor verbs                                            # the five port-verbs (JSONL)
conductor check --stage a:source:'cmd' --stage b:fold:'cmd'   # typecheck, don't run
conductor run   --stage a:source:'cmd' --stage b:fold:'cmd' [--ledger F] [--input F] [--trace ID]
conductor replay --ledger F --trace ID                     # every record for a trace-id
```

A stage token is `slug:verb:cmd` (the command is shell-split; only the first two
colons split slug and verb, so a command may contain colons). Stages can also be
piped in as JSON-lines with `--stdin` (the shape `declare show` emits, with a
`cmd` added).

Exit codes: `0` ok · `3` doesn't typecheck (not run) · `4` undeclared verb ·
`5` a stage failed at runtime (the ledger names it) · `2` usage error.

## Requirements

Python 3, standard library only. No dependencies.

## License

MIT. See `LICENSE`.
