# Jamie's Garden

A falling-block puzzle game — drop and rotate pieces, clear rows, and keep the
garden from overgrowing. Built as a gift.

**Play it:** the page in this folder is a single self-contained file — no install,
no server, just open it in a browser.

**Read the code:** the game is split into small modules you can read top to bottom:

- `sim.js` — the simulation: the board, gravity, piece locking, row clears
- `render.js` — drawing the board and pieces
- `input.js` — keyboard and touch handling
- `climb.js` — the climb / scoring model
- `gen.js` — the piece generator

The playable `index.html` is a self-contained build of those same pieces.

Part of the Loop MMT app collection.
