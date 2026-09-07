# Beam Wizards

A 3D-optics puzzle: steer a beam of light through a cube of coloured blocks —
mirrors, lenses, splitters — to hit the target. A kids' game with a
university-course origin (the optics are a directed-eikonal transport model, run
honestly under the hood).

## Run it

Open **`beam-wizards.html`** in any modern browser. It's a single self-contained
file — engine and a 54-puzzle library are inlined; the only external fetch is the
Three.js module from a CDN, so you need a network connection the first time.

## Read the code

- `beam-wizards.html` — the "just open it" playable (the operator-held survivor of
  a build that was recovered byte-for-byte; engine + puzzle library inlined).
- `src/engine.js` — the canonical optics engine (mirror-3D conformance 57/57,
  puzzle round-trip 32/32). The standalone's inlined copy is byte-identical to this.
- `src/index-3d.html` — the modular render skin (imports `./engine.js`).
- `src/puzzles3d-library.json` — 54 BFS-confirmed puzzles, all solvable and
  non-trivial through the engine.

## Honest limits

- This is the **B3 playable layer** ("the game as designed"), not the continuous
  field-engine apex (B7) that's still on the workbench. The full 3D element set,
  generator productionization, and delight pass are in progress.
- The puzzle *generator's* wall-target/spread mode source was lost in the same
  incident that this file was recovered from; the puzzles it produced survived and
  ship here, but fresh-puzzle generation is a re-derive, not an extract.
