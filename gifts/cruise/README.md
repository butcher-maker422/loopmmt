# cruise

**A deterministic feature inventory of a codebase — the floor an LLM can't hallucinate through.**

Ask a language model "list all the features of this app" and it does two bad things at
once: it invents plausible features that aren't there, and it misses real ones that are.
It has nothing under it. `cruise` builds the floor. It walks a source tree, extracts
every byte-derived **fact** about what the code exposes, and emits a **ledger** — one
fact per line, each carrying what it *proves* and, just as important, what it *does not
prove*. Hand that ledger to an LLM and ask it to **group and name** the facts into
features, and it can't invent one with no route, no label, and no test behind it.

The name is a timber cruise: a systematic field survey of a standing forest, run to
produce a valuation for a buyer. This is that, for software — tally what's actually
standing, emit the survey, let someone write the sales sheet from real numbers.

```
python3 cruise.py <tree-root> [options]
```

## The four plots

Each is an independent text scan over byte-truth:

- **route** — server path literals in route/handler declarations (`app.get("/api/x")`, `@app.route("/x")`, `HandleFunc("/x")`) → what the backend *serves*.
- **call** — client-side request URLs (`fetch("/x")`, `axios.post("/x")`) → what the frontend *asks for*.
- **affordance** — user-visible control labels (`<button>Save</button>`, `aria-label="Delete"`) → what a *user* can touch.
- **claim** — assertion descriptions in test files (`it("...")`, `def test_x`) → what the code *claims* about itself.

Every fact ships its own `proves` / `does_not_prove`, because a right number under a
wrong noun is a lie with a receipt. A `route` proves a path literal exists; it does **not**
prove the route works, is reachable, or is tested.

## Two free grades

- **HEADLESS-ROUTE** — a served route no client call anywhere names. Built, unreached by the client source scanned. (Fails safe: graded only when neither called nor mentioned.)
- **UNCLAIMED** — the tree exposes affordances but has zero test claims → unverified surface.

## The pipe contract

`--json` emits one sorted JSON object per fact and per grade on stdout:

```
{"plot","value","path","line","proves","does_not_prove"}
{"grade","value","detail"}
```

so you can pipe the ledger onward — count facts, filter to one plot (`--plot route`),
or feed the whole thing to an LLM. Without `--json` it prints a grouped human report.

`--strict` makes a HEADLESS-ROUTE an exit code (1) your CI can catch. Default is a report,
not a gate (exit 0).

Determinism: the tree is walked in sorted order and facts are sorted by
`(plot, path, line, value)`, so the same tree always produces the **same ledger** —
byte-identical, diffable, hashable, cache-keyable.

## The edge — what this does not do

`cruise` is a **text scan with a declared pattern set, not a language parser.** That is
the honest limit, stated plainly so you calibrate it:

- It matches routes/calls/affordances/claims by **pattern**, so a framework or idiom it
  wasn't told about is a fact it won't see. It fails **safe** — a real fact it can't
  match is left *out* of the ledger, never a fabricated one put in. Completeness of the
  patterns is your call.
- Route and call matching is **literal**. A server that serves `/api/users/:id` and a
  client that calls `/api/users/42` are two different strings, so a live parameterized
  route can read as HEADLESS. Treat HEADLESS as "look here," not "delete this."
- A `claim` is the **description string** a test declares, read from source. It is not
  executed. `cruise` proves the claim is *written*, never that it runs or passes.
- The ledger stops you inventing a **feature**. It cannot stop you inventing a
  **property** of a real one ("passing", "shipped", "live") — which is exactly why every
  fact carries its own `does_not_prove` line.

MIT licensed. Python standard library only. No dependencies.
