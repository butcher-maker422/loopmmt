# Battleganza

Sudoku smashed into Tic-Tac-Toe, played head to head. You place digits under
Sudoku's constraints, but you're racing an opponent for lines that score — the
board fights back the way Tic-Tac-Toe does. Built Forest-native (it belongs
inside the Loop World / Forest shell as a multiplayer app).

## Run it

Open **`battleganza-standalone.html`** in any modern browser. It's a single
self-contained file with every module inlined — no build step, no server.

## Read the code

`battleganza-standalone.html` is **derived**, never hand-edited — `game.html` plus
the modules under `src/` are the source of truth, and `build-standalone.sh` (in the
main repo) inlines them into the standalone so it can't drift. The load-bearing
pieces:

- `src/rules.js` — `createMatchConfig` + `evaluate`: the actual game evaluator.
- `src/match.js` — match state and turn flow.
- `src/board-render.js` / `src/mega-render.js` — the two render scales.
- `src/shell.js` / `src/bus.js` / `src/boundary.js` — the Forest-shell wiring.

## Honest limits

- The standalone is **hotseat / single-machine** — two players sharing one screen.
  Battleganza is *designed* multiplayer; the networked head-to-head runs through
  the Forest server, which isn't part of this static file.
- The Forest-tab host wiring (the module chain reaching the live shell) has one
  known open thread; the standalone sidesteps it by inlining everything.
