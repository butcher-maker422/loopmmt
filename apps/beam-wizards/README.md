# Beam Wizards

A light-routing puzzle game — place reflectors and splitters to steer beams onto
the targets. Runs in your browser.

**Play it:** the page in this folder is the 2D game. A 3D cube-space variant is at
`index-3d.html`. (The 3D library is vendored locally — no outside servers.)

**Read the code:**

- `engine.js` — the beam-propagation engine: how light fills the field, cell by cell
- `puzzle.js` — the puzzle model and the solved / target-met check
- `puzzles.json` — the 2D puzzle set
- `puzzles3d-library.json` — the 3D puzzle library
- `index.html` / `index-3d.html` — the playable front-ends

Part of the Loop MMT app collection.
