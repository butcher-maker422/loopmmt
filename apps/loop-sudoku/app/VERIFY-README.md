# The `verify-*.cjs` family — what's ported, and why it stops where it does

The Plumb (`projects/loop-sudoku/src/plumb.py`) carries three invariant checkers.
SWX-F1 ports them to the Jamie's-Garden `verify-*.cjs` jig — but only **two** of the
three belong in the pure-Node family, and that is a deliberate, recorded decision,
not an unfinished port.

## Ported (pure-Node, headless, independent of the Python solver)

| file | invariant | status |
|---|---|---|
| `verify-reason-holds.cjs` | every step's stated technique genuinely held at that board — a fresh JS grid re-derives candidates from scratch and confirms each move | GREEN · mutation-proven |
| `verify-uniqueness.cjs` | the render's terminal status agrees with the TRUE solution count, proved by an independent plain-backtracking counter (a different algorithm from the propagation solver) | GREEN · mutation-proven (bites both `solved-unique ↔ broken` lies) |

Both are **independent re-certifications**: they read the render half's own
`traces.json` and check it with JS that shares **no code path** with the Python
solver, so a solver bug cannot hide in a matching checker bug. That "shares no code"
property is the family's identity.

## NOT ported — and why (the `determinism-replay` decision)

`plumb.py::verify_determinism_replay` asserts: *solve the same givens twice, the two
traces are byte-identical.* That is a property of the **solver**, not of a finished
trace — and **you cannot test whether a solver is deterministic without running it.**
A pure-Node checker that reads only the already-emitted `traces.json` structurally
**cannot observe** solver nondeterminism, so a `verify-determinism-replay.cjs` written
in that family would be a check that can never fail for the reason it claims to check
— theatre, not verification.

The only honest ways to test solver determinism from the `.cjs` side are:

- **(A) re-emit-and-diff** — shell out to `python3 emit_traces.py` into a temp file and
  diff against the committed `traces.json`. This genuinely re-runs the solver, so it
  can genuinely fail — but it *depends on Python* and is *not* independent of the
  solver, so it is a **reproducibility check, a different sub-family**, not a sibling
  of the two above. Available as a documented CI option if belt-and-suspenders
  determinism is ever wanted; deliberately not built as part of this family.
- **(B) Playwright/DOM re-render** — render the same puzzle twice in the real UI and
  assert identical output. Determinism at the layer the user sees; needs a browser
  (the heavier Garden dependency), SKIP-degrades headless.

Determinism is **already tested** where the solver lives —
`plumb.py::verify_determinism_replay`. It is not untested; it is tested in the right
place. Forcing a third `.cjs` file would either break the family's "shares no code"
purity (A) or drag in a browser (B), to cover a property that is already covered.

**Decision (recorded):** the pure-Node `verify-*.cjs` family is **complete at the two
invariants that are genuinely independent JS re-certifications.** Determinism stays in
the Plumb. If CI ever wants a JS-side solver-determinism gate, add option (A) as its
own honest thing — never dressed as a sibling of reason-holds and uniqueness.

---

## The persistence claims (B — the save/resume slice)

Persistence (Butcher Phase-1: working-core-first) added two more claims. Same
family principle — a checker that shares no code path with the thing it proves.

| file | claim | status |
|---|---|---|
| `verify-persistence.cjs` | the round-trip honesty law of `persist.js`: encode∘decode is identity on a view-state and on a full puzzle bundle; a tampered/corrupt/wrong-version/unparseable save decodes to `null` — **never a fabricated state** (the `.l21x` "corruption-detectable" lesson, the persistence analogue of the render half's "no fake placement"); `resolveResume` restores a cursor **only** when the saved puzzle still exists | GREEN · 15/15 · mutation-proven both directions (skip the checksum guard → red; fabricate-on-parse-fail → red); +4 for the `.l21x` file slice (`filenameFor` safety + no path-escape + fallback + file-body round-trip) |
| `verify-persistence-dom.cjs` | the **affordance** works in a real browser: stepping then reloading resumes the same step+puzzle; copy→paste round-trips a puzzle; a corrupt code is refused honestly; reset clears the resume; **save .l21x downloads a file that round-trips back**; **open .l21x adds a puzzle from a file on disk**; a corrupt .l21x file is refused honestly | GREEN · 11/11 · Playwright over a local http origin · `SKIP-NEEDS-BROWSER` degrade (the pure test still gates) |

**Why two.** `verify-persistence.cjs` proves the pure model; `verify-persistence-dom.cjs`
proves the DOM glue — so the buttons and the resume are not unclaimed surface (the
Cruise's DEAD-AFFORDANCE / UNCLAIMED-SURFACE gap). Storage is wrapped to **fail safe**:
where `localStorage` is unavailable (private mode, an opaque `file://` origin, a
sandboxed iframe), the app behaves exactly as it did before persistence — no resume,
no crash, no message. The DOM test runs over http precisely because that is the origin
where storage is reliable; the fail-safe covers where it is not.

## The gate (full)

    # from projects/loop-sudoku/
    python3 tests/test_walking_skeleton.py      # 23/23
    python3 tests/test_faces.py                 # 22/22
    # from app/
    node verify-reason-holds.cjs                # GREEN
    node verify-uniqueness.cjs                  # GREEN
    node verify-render.cjs                      # GREEN (elimination honesty + honest-badge law)
    node verify-persistence.cjs                 # 15/15 (round-trip honesty law + .l21x file naming)
    node verify-persistence-dom.cjs             # 11/11 (affordance in a browser; SKIP-degrades)

## The `.l21x`-file export/import slice (BUILT — S20.1648)

Imported puzzles were session-only: a pasted (or file-opened) puzzle rendered but
did not survive a reload — the honest gap the prior slice flagged. This slice closes
it the honest way for a static viewer that cannot write `traces.json`: **the file on
disk IS the durability.** Save a puzzle to a named `.l21x` file (⭳ save .l21x), reopen
it any time (⤒ open .l21x), and it is back.

- **No new format, no new machinery.** The `.l21x` file body is exactly the proven
  `persist.js` envelope (`encodePuzzle`), so the file round-trips through the same
  checksummed, corruption-detectable core the paste box uses — a *transport* layer, not
  a new grammar. `filenameFor` (pure, in `persist.js`) is the only added primitive: it
  derives a safe `<label>.l21x` name that never emits a path separator, a leading dot,
  or an empty name, and falls back to `puzzle.l21x`.
- **One import joint (Block Principle).** The paste box and the file open both enter
  through `addPuzzle(pz)` in `index.html`, so they behave identically — a corrupt file
  is refused with the same honesty as a corrupt pasted code (never load state you
  cannot verify).
- **Fail-safe, claimed not just shipped.** Both new buttons are proven in a real
  browser (`verify-persistence-dom.cjs`, +3 claims): the download round-trips back, the
  file open adds the puzzle, a corrupt file is refused. Where download is unsupported,
  ⭳ points at ⧉ copy save code rather than becoming a dead button.

## Next slice (scouted, not built)

The optional refinement is the **L21 catalog verbs** — a multi-save library
(name/save/load/delete/sort/timestamps) so many `.l21x` files can be managed in one
place, matching the F5 16-function L21 catalog engine (`software/loop21/`). A *library*
layer over the same primitive; not needed for durable single-puzzle keeping, which this
slice already delivers.
