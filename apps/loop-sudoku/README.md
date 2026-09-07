# loop-sudoku

A Sudoku app in the making. What's built and shared here is the part that's
hardest to get right: a **self-certifying solver core** that reasons through a
puzzle one logical step at a time — and can show its own working. It grades a
puzzle, proves whether it's solvable by logic alone, and names each next move
(naked single, hidden single, and on up).

## Read the code

Source-only — there's no hosted play yet.

- `src/solver.py` — the certifying solver: the step-by-step reasoner.
- `src/faces.py` / `src/plumb.py` — the puzzle representation and the plumbing
  around the solver.
- `app/` — the in-progress front end: `index.html`, the render model, persistence,
  and a set of `verify-*.cjs` harnesses that check reasoning, rendering,
  uniqueness, and persistence hold.
- `app/traces.json` / `app/fixtures.json` — recorded solve traces the app replays.

## Honest limits

- This is a **solver core reached and paused** — the build stopped here to go make
  Battleganza. loop-sudoku returns as a full Sudoku app inside the Forest.
- No browser-playable build ships in this folder yet; `app/` is scaffold plus
  verification, not a finished game. Read it as "the engine and its proofs," not
  "the app."
