// Jamie's Garden — sim.js
// The headless deterministic sim core (Architecture §3A; Build order §8 step 1 — "the gate").
//
// Pure, DOM-free, deterministic. Byte-identical replays from a seed + an input
// timeline. The sim emits abstract bloom TYPES (0,1,2) only — it never knows a
// marigold from a cornflower; shape/colour identity is render.js's job (§DS/D4).
// The theme paints; it never touches this witness (§1a hard rule).
//
// Mechanic (Dr. Mario family, cloned at the mechanic level — §1; the name, art,
// theme are ours, §7): an 8x16 grid is seeded with stationary blooms ("targets");
// a 2-cell seed-pair falls; the player moves/rotates it; gravity settles; a run of
// 4+ of one type (row or column) resolves (clears); clears trigger gravity again
// (cascades); clear all targets = the garden is brought to rest (win); stack past
// the top = it overgrows (lose).
//
// No universality-class vocabulary in this file (§MS Bone #4 build rule).

'use strict';

const COLS = 8;
const ROWS = 16;
const TYPES = 3;            // v1: three bloom forms (the forms set the count ceiling — §DS edit 3)
const CLEAR_RUN = 4;       // 4-or-more of one type in a line resolves
const SPAWN_X = 3;         // pivot spawn column (left half of the centre pair)
const SPAWN_Y = 0;         // top row

// ── Deterministic PRNG ──────────────────────────────────────────────────────
// mulberry32: a small, fully-specified 32-bit generator. The seed is the ONLY
// source of randomness; given the same seed + the same input timeline the whole
// game evolves identically. This is the determinism the §3A replay rests on and
// the floor BS3's planted-fault FAIL guards.
function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randInt(rng, n) { return Math.floor(rng() * n); }

// ── Cell / board helpers ────────────────────────────────────────────────────
// A cell is null (empty) or { type, target }.
//   type   : 0..TYPES-1 (abstract bloom type)
//   target : true if it is a seeded bloom that must be cleared to win
function emptyBoard() {
  const b = new Array(ROWS);
  for (let y = 0; y < ROWS; y++) b[y] = new Array(COLS).fill(null);
  return b;
}
function inBounds(x, y) { return x >= 0 && x < COLS && y >= 0 && y < ROWS; }
function cellAt(board, x, y) { return inBounds(x, y) ? board[y][x] : undefined; }

// Seed the board with `targetCount` blooms in the lower portion, deterministically.
// Targets are placed only in the bottom `seedRows` rows so the board opens solvable
// and the top stays clear for spawning. We avoid creating a pre-made run of 4 so the
// opening board has nothing already resolving (a deal that clears itself on tick 0 is
// not a puzzle). Placement order is RNG-driven and therefore replayable.
function seedTargets(board, rng, targetCount, seedRows) {
  const minRow = ROWS - seedRows;
  let placed = 0;
  let guard = 0;
  while (placed < targetCount && guard < targetCount * 200) {
    guard++;
    const x = randInt(rng, COLS);
    const y = minRow + randInt(rng, seedRows);
    if (board[y][x]) continue;                       // occupied
    const type = randInt(rng, TYPES);
    if (wouldMakeRun(board, x, y, type)) continue;   // don't pre-build a clear
    board[y][x] = { type, target: true };
    placed++;
  }
  return placed;
}

// True if placing `type` at (x,y) would create a horizontal or vertical run of
// CLEAR_RUN or more (counting same-type neighbours in both directions on each axis).
function wouldMakeRun(board, x, y, type) {
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    let run = 1;
    for (const sign of [-1, 1]) {
      let cx = x + dx * sign, cy = y + dy * sign;
      while (inBounds(cx, cy) && board[cy][cx] && board[cy][cx].type === type) {
        run++; cx += dx * sign; cy += dy * sign;
      }
    }
    if (run >= CLEAR_RUN) return true;
  }
  return false;
}

// ── The falling piece (the seed-pair) ───────────────────────────────────────
// A 2-cell piece: a pivot half and a second half offset by orientation.
//   orientation 0: second half to the RIGHT of pivot   (horizontal)
//   orientation 1: second half ABOVE pivot             (vertical)
//   orientation 2: second half to the LEFT of pivot    (horizontal, flipped)
//   orientation 3: second half BELOW pivot             (vertical, flipped)
// Rotation-axis fix : kill the sideways "walk" on rotation. The pill is anchored
// at its pivot cell (x,y); a HORIZONTAL orientation's second half is always to the RIGHT
// (footprint {x, x+1}), never to the left. The four orientations differ by H/V and by WHICH
// color sits at the anchor (a t0/t1 `swap` on the flipped states) — exactly Dr. Mario's
// CW cycle [t0|t1] → t1-over-t0 → [t1|t0] → t0-over-t1 — with NO footprint translation.
//
//   The ONLY change from the shipped table is orientation 2: it was `left [-1,0]`, whose
//   footprint {x-1, x} sat one column LEFT of o0's {x, x+1} — so a 180° rotation jumped the
//   pill sideways (the operator's "it moves laterally as you rotate"). It is now `right`
//   with the colors swapped, so the pair reads the same ([t1|t0]) but stays anchored.
//   Vertical o1 (up) / o3 (down) are UNCHANGED — they never walked, o3-down keeps the piece
//   rotatable-to-vertical at the spawn row, and the parked Unfold witness (gen.js, o3 drops)
//   still holds by construction.
const ORIENT = [
  { off: [1, 0],  swap: false },  // 0 horizontal: t0 left,  t1 right   → cells {x, x+1}
  { off: [0, -1], swap: false },  // 1 vertical:   t0 bottom, t1 top    → cells {x} (up)
  { off: [1, 0],  swap: true  },  // 2 horizontal: t1 left,  t0 right   → cells {x, x+1}  (was left [-1,0])
  { off: [0, 1],  swap: false },  // 3 vertical:   t0 top,   t1 bottom  → cells {x} (down)
];
// Back-compat: raw per-orientation displacement of the SECOND rendered cell from the anchor.
const ORIENT_OFFSET = ORIENT.map(o => o.off);
function pieceCells(piece) {
  const { off, swap } = ORIENT[piece.o];
  const [ox, oy] = off;
  const aType = swap ? piece.t1 : piece.t0;   // color rendered at the anchor
  const bType = swap ? piece.t0 : piece.t1;   // color rendered at the offset cell
  return [
    { x: piece.x,      y: piece.y,      type: aType },   // anchor half (pivot)
    { x: piece.x + ox, y: piece.y + oy, type: bType },   // offset half
  ];
}
function nextPieceFromQueue(state) {
  const i = state.pieceIndex;
  const t0 = state.queue0[i % state.queue0.length];
  const t1 = state.queue1[i % state.queue1.length];
  state.pieceIndex++;
  return { x: SPAWN_X, y: SPAWN_Y, o: 0, t0, t1 };
}

// Non-mutating peek at the UPCOMING piece (the one that spawns next). Reads the SAME
// queue slot nextPieceFromQueue will consume (queue[pieceIndex]), so the preview shows
// exactly what comes — by construction, not a guess. Does NOT advance pieceIndex.
function peekNext(state) {
  const i = state.pieceIndex;
  return { t0: state.queue0[i % state.queue0.length], t1: state.queue1[i % state.queue1.length] };
}

// Pre-roll a deterministic piece-type queue from the RNG. Two independent streams
// (the two halves). A fixed-length pre-roll keeps the witness small and replay
// trivially indexable; it wraps for long games (rare — most boards finish first).
function rollQueue(rng, len) {
  const q = new Array(len);
  for (let i = 0; i < len; i++) q[i] = randInt(rng, TYPES);
  return q;
}

// Can the piece occupy its cells (in bounds, not overlapping a filled cell)?
function pieceFits(board, piece) {
  for (const c of pieceCells(piece)) {
    if (!inBounds(c.x, c.y)) return false;
    if (board[c.y][c.x]) return false;
  }
  return true;
}

// ── Resolution: clears + gravity + cascades ─────────────────────────────────
// Find every cell that is part of a horizontal or vertical run of CLEAR_RUN+ of a
// single type. Returns a Set of "x,y" keys. Deterministic (fixed scan order).
function findClears(board) {
  const marked = new Set();
  // horizontal
  for (let y = 0; y < ROWS; y++) {
    let runStart = 0;
    for (let x = 1; x <= COLS; x++) {
      const same = x < COLS && board[y][x] && board[y][runStart] &&
                   board[y][x].type === board[y][runStart].type;
      if (!same) {
        if (x - runStart >= CLEAR_RUN && board[y][runStart]) {
          for (let k = runStart; k < x; k++) marked.add(k + ',' + y);
        }
        runStart = x;
      }
    }
  }
  // vertical
  for (let x = 0; x < COLS; x++) {
    let runStart = 0;
    for (let y = 1; y <= ROWS; y++) {
      const same = y < ROWS && board[y][x] && board[runStart][x] &&
                   board[y][x].type === board[runStart][x].type;
      if (!same) {
        if (y - runStart >= CLEAR_RUN && board[runStart][x]) {
          for (let k = runStart; k < y; k++) marked.add(x + ',' + k);
        }
        runStart = y;
      }
    }
  }
  return marked;
}

// The partner cell a bonded cell points at (or null). bond ∈ {L,R,U,D}.
function bondPartner(x, y, c) {
  if (!c || !c.bond) return null;
  const d = c.bond;
  return d === 'L' ? { x: x - 1, y } : d === 'R' ? { x: x + 1, y }
       : d === 'U' ? { x, y: y - 1 } : { x, y: y + 1 };
}

// Bond-aware gravity (Dr. Mario). Settle every free-floating GROUP one row per pass
// until stable. A group is a single cell or a bonded pair (which moves as a unit). A
// group falls iff no cell is on the floor AND every cell has empty space (or its own
// group-mate) directly below — so a bonded HORIZONTAL pair rests if EITHER half has
// support (a piece capping a one-wide column stays up, its hanging half held by the
// bond). Severed singles (a half whose partner was cleared) fall as singles.
function applyGravity(board) {
  let movedEver = false, guard = 0;
  for (;;) {
    if (guard++ > ROWS * COLS) break;                 // safety: a cell falls at most ROWS rows
    // enumerate maximal groups (a cell + its bonded partner, once)
    const groups = [], seen = new Set();
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const c = board[y][x];
      if (!c || seen.has(x + ',' + y)) continue;
      const cells = [{ x, y }]; seen.add(x + ',' + y);
      const p = bondPartner(x, y, c);
      if (p && inBounds(p.x, p.y) && board[p.y][p.x] && !seen.has(p.x + ',' + p.y)) {
        cells.push(p); seen.add(p.x + ',' + p.y);
      }
      groups.push(cells);
    }
    const fallers = groups.filter(cells => {
      // Flowers are PINNED — Dr. Mario viruses never fall, even with empty space below
      // them, and they act as support for whatever rests on them. Only pieces (pill
      // halves) fall. A seeded target is always a lone single (no bond), so checking
      // any cell in the group covers every case. (Before this clause, scatter-seeded
      // flowers floating mid-board collapsed the whole board on the first lock.)
      if (cells.some(({ x, y }) => board[y][x] && board[y][x].target)) return false;
      const inG = new Set(cells.map(c => c.x + ',' + c.y));
      return cells.every(({ x, y }) => y + 1 < ROWS && (!board[y + 1][x] || inG.has(x + ',' + (y + 1))));
    });
    if (!fallers.length) break;
    const lifted = [];                                 // lift all, then place one row down (no clobber)
    for (const cells of fallers) for (const { x, y } of cells) { lifted.push({ x, y, c: board[y][x] }); board[y][x] = null; }
    for (const { x, y, c } of lifted) board[y + 1][x] = c;
    movedEver = true;
  }
  return movedEver;
}

// Run the full resolution loop after a lock: clear runs, settle by gravity, repeat
// until stable. Returns the number of cascade steps that cleared something (0 = the
// lock created no clears). Deterministic.
function resolveBoard(state) {
  let cascades = 0;
  applyGravity(state.board);            // settle bonded pairs on lock; nothing floats
  for (;;) {
    const marked = findClears(state.board);
    if (marked.size === 0) break;
    let clearedTargets = 0;
    for (const key of marked) {
      const [x, y] = key.split(',').map(Number);
      const c = state.board[y][x];
      if (c && c.target) clearedTargets++;
      if (c && c.bond) {                                 // sever the survivor's bond (it becomes a single)
        const p = bondPartner(x, y, c);
        if (p && inBounds(p.x, p.y) && state.board[p.y][p.x]) state.board[p.y][p.x].bond = null;
      }
      state.board[y][x] = null;
    }
    state.targetsRemaining -= clearedTargets;
    state.cleared += marked.size;
    cascades++;
    applyGravity(state.board);                            // freed singles fall; pairs that lost support fall
  }
  return cascades;
}

// ── Lock + spawn ────────────────────────────────────────────────────────────
// Write `piece`'s two cells onto `board` as a LOCKED, BONDED, but UNRESOLVED group —
// the single source of truth for what a just-locked piece looks like on the board
// BEFORE gravity and clears run. Halves bond to each other by relative direction
// (L/R/U/D); a half landing off-board leaves its partner a single (no partner to bond
// to). Mutates and returns `board`. The gate (lockPiece, below) and the render skin's
// pre-resolve snapshot (index.html stepGravity) BOTH mint the locked board from here,
// so the live animation and the authoritative gate can never again disagree about a
// piece's bonds. (The bug this kills: index.html used to hand-write these cells WITHOUT
// their bond, so buildResolveTrace saw two independent singles and animated a phantom
// half-fall the gate's bonded lock then snapped back. One source, two consumers.)
function writeLockedPiece(board, piece) {
  const [a, b] = pieceCells(piece);
  const dx = b.x - a.x, dy = b.y - a.y;
  const aToB = dx === 1 ? 'R' : dx === -1 ? 'L' : dy === -1 ? 'U' : 'D';
  const opp = { L: 'R', R: 'L', U: 'D', D: 'U' };
  const aIn = inBounds(a.x, a.y), bIn = inBounds(b.x, b.y);
  if (aIn) board[a.y][a.x] = { type: a.type, target: false, bond: bIn ? aToB : null };
  if (bIn) board[b.y][b.x] = { type: b.type, target: false, bond: aIn ? opp[aToB] : null };
  return board;
}

function lockPiece(state) {
  writeLockedPiece(state.board, state.piece);   // single source for the bonded lock (also minted by the render snapshot)
  state.piece = null;
  // record the chain depth of this lock's resolution (number of times a clear
  // triggered gravity that triggered another clear). Read by the difficulty meter
  // (§6a(b) metric 2 — a real cascade is a chain >= 2, not a multi-cell clear).
  state.cascadesLastLock = resolveBoard(state);
  if (state.targetsRemaining <= 0) { state.status = 'won'; return; }
  spawnNext(state);
}
function spawnNext(state) {
  const p = nextPieceFromQueue(state);
  if (!pieceFits(state.board, p)) { state.status = 'lost'; state.piece = null; return; }
  state.piece = p;
}

// ── Public API ──────────────────────────────────────────────────────────────
// createGameFrom(board, queue0, queue1, opts?) -> state
// Build a game from a PREBUILT board + piece queues (the generator's output —
// gen.js / The Unfold). Counts the targets on the board. No RNG: the generator
// owns determinism here. Used by the constructive-certificate path (§4/§3C).
function createGameFrom(board, queue0, queue1, opts = {}) {
  let targets = 0;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (board[y][x] && board[y][x].target) targets++;
  }
  const state = {
    seed: opts.seed ?? 0,
    board,
    piece: null,
    queue0: queue0.slice(), queue1: queue1.slice(), pieceIndex: 0,
    targetsRemaining: targets,
    cleared: 0,
    ticks: 0,
    status: 'playing',
  };
  spawnNext(state);
  return state;
}

// createGame(seed, opts?) -> state
//   opts.targetCount (default 16), opts.seedRows (default 10), opts.queueLen (default 256)
function createGame(seed, opts = {}) {
  const targetCount = opts.targetCount ?? 16;
  const seedRows = opts.seedRows ?? 10;
  const queueLen = opts.queueLen ?? 256;
  const rng = makeRng(seed);
  const board = emptyBoard();
  const placed = seedTargets(board, rng, targetCount, seedRows);
  const queue0 = rollQueue(rng, queueLen);
  const queue1 = rollQueue(rng, queueLen);
  const state = {
    seed: seed >>> 0,
    board,
    piece: null,
    queue0, queue1, pieceIndex: 0,
    targetsRemaining: placed,
    cleared: 0,
    ticks: 0,
    status: 'playing',
  };
  spawnNext(state);
  return state;
}

// applyInput(state, input) -> state (mutated). Inputs never advance gravity; they
// only reposition the active piece (input never mutates locked board state — §3B).
//   'left' | 'right' | 'rotateCW' | 'rotateCCW' | 'softDrop' | 'hardDrop'
function applyInput(state, input) {
  if (state.status !== 'playing' || !state.piece) return state;
  const p = state.piece;
  switch (input) {
    case 'left':  tryMove(state, p, -1, 0); break;
    case 'right': tryMove(state, p, 1, 0); break;
    case 'softDrop': tryMove(state, p, 0, 1); break;
    case 'rotateCW':  tryRotate(state, p, 1); break;
    case 'rotateCCW': tryRotate(state, p, -1); break;
    case 'hardDrop': {
      // Loop on the LIVE piece (tryMove replaces state.piece each step); bound by
      // ROWS so a pathological state can never spin forever.
      let guard = 0;
      while (guard++ <= ROWS && tryMove(state, state.piece, 0, 1)) { /* drop to rest */ }
      lockPiece(state);
      break;
    }
    default: break;
  }
  return state;
}
function tryMove(state, p, dx, dy) {
  const moved = { ...p, x: p.x + dx, y: p.y + dy };
  if (pieceFits(state.board, moved)) { state.piece = moved; return true; }
  return false;
}
// Rotate with a simple wall-kick: if the rotated piece doesn't fit, try nudging it
// one cell horizontally (the classic kick) before refusing.
function tryRotate(state, p, dir) {
  const o = ((p.o + dir) % 4 + 4) % 4;
  for (const kick of [0, -1, 1]) {
    const cand = { ...p, o, x: p.x + kick };
    if (pieceFits(state.board, cand)) { state.piece = cand; return true; }
  }
  return false;
}

// tick(state) -> state (mutated). One gravity step: the active piece falls one row;
// if it cannot, it locks and resolution + spawn run. Render/input drive ticks on a
// timer — the sim never reads a wall clock.
function tick(state) {
  if (state.status !== 'playing') return state;
  state.ticks++;
  if (!state.piece) { spawnNext(state); return state; }
  if (!tryMove(state, state.piece, 0, 1)) lockPiece(state);
  return state;
}

// Serialise the witness-relevant state to a compact, stable string. Two runs with
// the same seed + input timeline must produce byte-identical serialisations at each
// tick — that equality IS the determinism contract (§3A). Excludes nothing derived;
// includes only the true witness.
function serialize(state) {
  let s = '';
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const c = state.board[y][x];
      s += c ? (c.type + (c.target ? 'T' : 'p') + (c.bond || '-')) : '..';
    }
    s += '|';
  }
  const p = state.piece ? `${state.piece.x},${state.piece.y},${state.piece.o},${state.piece.t0}${state.piece.t1}` : 'none';
  return `seed=${state.seed};st=${state.status};tr=${state.targetsRemaining};cl=${state.cleared};pi=${state.pieceIndex};p=${p};b=${s}`;
}

var API = {
  COLS, ROWS, TYPES, CLEAR_RUN,
  makeRng, randInt,
  createGame, createGameFrom, applyInput, tick, serialize,
  // exposed for tests / the validator + render layers:
  emptyBoard, findClears, applyGravity, resolveBoard, pieceCells, pieceFits, writeLockedPiece, peekNext,
};

// Dual-environment export: ESM-ish for the browser (window.Sim) and CommonJS for
// the node test harness — no build step, no dependencies.
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.Sim = API;
