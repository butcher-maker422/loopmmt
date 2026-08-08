// Jamie's Garden — input.js  [Build order §8 step 3: input]
// Touch + keyboard -> sim inputs ('left'|'right'|'rotateCW'|'rotateCCW'|'softDrop'|
// 'hardDrop'). Input NEVER mutates locked board state (§3B) — it only asks the sim,
// which decides. The unaided-path gate (§8 step 7): legible with NO instructions —
// design for "Jamie picks it up cold." Keyboard for desktop; tap-zones + swipe for phone.
'use strict';

function attachInput(canvas, send, getCell, getPieceIndex) {
  // SPAWN LATCH marker: the sim's own piece counter (read-only; sim.js sealed). It advances on every
  // spawn, so an input source can bind to the piece it engaged on and notice when a new one has landed.
  // Absent (older callers / tests) -> a stable -1, which disables the latch harmlessly.
  const curPiece = getPieceIndex || (() => -1);

  // ── Keyboard (desktop) ─────────────────────────────────────────────────────
  const keys = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'softDrop',
    ArrowUp: 'rotateCCW', KeyZ: 'rotateCCW', KeyX: 'rotateCW', Space: 'hardDrop',
  };
  // SPAWN LATCH (keyboard): the OS fires auto-repeat keydowns while a key is physically held, and that
  // stream keeps flowing across a piece lock. Track which keys are down and the piece they went down on;
  // an auto-repeat whose piece counter has since advanced is a hold that spanned a spawn -> ignore it until
  // the key is released and pressed again. A fresh keydown is always honored. (heldKeys: Map<code, pieceIndex>.)
  const heldKeys = new Map();
  function onKey(e) {
    const input = keys[e.code];
    if (!input) return;
    e.preventDefault();
    if (heldKeys.has(e.code)) {                          // OS auto-repeat (key already physically down)
      if (heldKeys.get(e.code) !== curPiece()) return;   // held across a spawn -> latch until keyup + fresh press
    } else {
      heldKeys.set(e.code, curPiece());                  // fresh press -> bind to the current piece
    }
    send(input);
  }
  function onKeyUp(e) { if (keys[e.code]) heldKeys.delete(e.code); }   // release clears the latch
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);

  // ── Touch (phone) — the natural mapping, no on-screen buttons ───────────────
  //   • tap LEFT third  -> move left      • tap RIGHT third -> move right
  //   • tap MIDDLE third -> rotate         • swipe DOWN      -> hard drop
  //   • short downward drag -> soft drop
  let start = null;
  const TAP_MS = 250, SWIPE = 0.9; // swipe threshold ≈ one cell-height fraction of travel

  function xy(e) {
    const t = e.changedTouches ? e.changedTouches[0] : e;
    const r = canvas.getBoundingClientRect();
    return { x: t.clientX - r.left, y: t.clientY - r.top, t: Date.now() };
  }
  function onStart(e) { e.preventDefault(); start = xy(e); start.pi = curPiece(); }   // bind gesture to its piece
  function onEnd(e) {
    if (!start) return;
    e.preventDefault();
    const end = xy(e);
    const dx = end.x - start.x, dy = end.y - start.y, dt = end.t - start.t;
    const cell = getCell ? getCell() : 30;
    const w = canvas.getBoundingClientRect().width;

    // SPAWN LATCH (touch parity): if a piece spawned while the finger was down, this gesture began on the
    // piece that just landed -> drop it whole, so a tap/swipe meant for the old piece can't hit the fresh one.
    if (curPiece() !== start.pi) { start = null; return; }

    if (Math.abs(dy) > cell * SWIPE && dy > 0 && Math.abs(dy) > Math.abs(dx)) {
      send(dy > cell * 3 ? 'hardDrop' : 'softDrop');          // long swipe = slam, short = nudge
      start = null; return;
    }
    if (dt < TAP_MS && Math.abs(dx) < cell * 0.6 && Math.abs(dy) < cell * 0.6) {
      const third = start.x / w;                              // tap zone by horizontal third
      if (third < 0.33) send('left');
      else if (third > 0.67) send('right');
      else send('rotateCCW');
    }
    start = null;
  }
  canvas.addEventListener('touchstart', onStart, { passive: false });
  canvas.addEventListener('touchend', onEnd, { passive: false });
  // mouse parity (so it's playable on a laptop trackpad too)
  canvas.addEventListener('mousedown', onStart);
  canvas.addEventListener('mouseup', onEnd);

  return function detach() {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKeyUp);
    canvas.removeEventListener('touchstart', onStart);
    canvas.removeEventListener('touchend', onEnd);
    canvas.removeEventListener('mousedown', onStart);
    canvas.removeEventListener('mouseup', onEnd);
  };
}

var API = { attachInput };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.Input = API;
