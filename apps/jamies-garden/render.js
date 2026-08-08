// Jamie's Garden — render.js  [Build order §8 step 3: the render skin]
// Canvas 2D. THE GARDEN LIVES HERE AND ONLY HERE (§3B / §1a hard rule): map abstract
// sim type (0,1,2) -> a distinct GROWING FORM + measured colour. Identity is
// redundantly encoded — shape AND colour each carry the match, EITHER ALONE SUFFICES
// (§DS/D2, D7). The sim emits types; the skin paints forms+colour; the witness is
// never touched. Draws at true magnitude (M12). Eggs (§FW) would live here too — none
// in v1 (ship the LINE: forms falling + clearing + win/lose + the growth-reveal).
'use strict';

// ── Measured palette (§DS/D1 — load-bearing, do not retune) ──────────────────
//   ΔE00 worst-across-CVD = 18.5 (≥15 floor met); contrasts on soil 8.10/6.00/5.84:1.
const SOIL   = '#EDE7D8';   // soil / sunlit-loam background (Five Lenses v2, daylight garden)
const EMBER  = '#E06A4A';   // overgrowth danger — soft, pattern/state-coded, never hospital-red
const FORMS = [
  { name: 'marigold',   colour: '#E8A33D', dark: '#B97A1F', light: '#F4C77A' }, // type 0 — solid round pom
  { name: 'cornflower', colour: '#4F9DDE', dark: '#2E6FA8', light: '#8FC4EE' }, // type 1 — spiky star
  { name: 'mallow',     colour: '#C879C8', dark: '#8F4A8F', light: '#E2A8E2' }, // type 2 — open ring-bloom
];

// ── Form GEOMETRY (pure — no canvas; node-testable for the D2-i shape check) ──
// Each returns a list of subpaths in UNIT space ([-0.5..0.5] around a cell centre).
// The three are categorically distinct silhouettes — SOLID disc / SPIKY star /
// HOLED ring — so they read apart by shape alone, downscaled and in greyscale.
function formGeometry(type) {
  if (type === 0) {
    // MARIGOLD — a solid round pom: a filled, gently-scalloped disc (high-freq bumpy edge).
    const lobes = 13, base = 0.31, bump = 0.03, pts = [];
    for (let i = 0; i < lobes * 2; i++) {
      const a = (i / (lobes * 2)) * Math.PI * 2;
      const r = base + (i % 2 ? bump : 0);
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return { kind: 'solid', outline: pts, centre: 0.12 }; // solid centre dot
  }
  if (type === 1) {
    // CORNFLOWER — a spiky star: 6 sharp deep points (thin mass, sharp concavities).
    const points = 6, outer = 0.44, inner = 0.15, pts = [];
    for (let i = 0; i < points * 2; i++) {
      const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? inner : outer;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return { kind: 'spiky', outline: pts, centre: 0 }; // no centre dot — keeps it lean
  }
  // MALLOW — an open ring-bloom: 5 broad lobes around a HOLLOW (negative-space) centre.
  const lobes = 5, outer = 0.46, waist = 0.18, pts = [];
  for (let i = 0; i < lobes * 2; i++) {
    const a = (i / (lobes * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? waist : outer;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return { kind: 'holed', outline: pts, hole: 0.15 }; // dark hollow centre
}

// Trace a unit polygon at (cx,cy) scaled by `cell`, with smoothing via quadratics.
function traceForm(ctx, outline, cx, cy, cell, scale) {
  const n = outline.length;
  for (let i = 0; i <= n; i++) {
    const p = outline[i % n], q = outline[(i + 1) % n];
    const px = cx + p[0] * cell * scale, py = cy + p[1] * cell * scale;
    const mx = cx + ((p[0] + q[0]) / 2) * cell * scale, my = cy + ((p[1] + q[1]) / 2) * cell * scale;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.quadraticCurveTo(px, py, mx, my);
  }
}

// ── Botanical detail (canvas) ─────────────────────────────────────────────────
// The SILHOUETTE is still carried by formGeometry (the mechanical D2 proxy + the
// shape-only channel below render exactly that). Here we render the FLOWER inside
// that footprint — petals, layers, fringe, veins — using ONLY the measured palette
// (f.colour/dark/light; never retuned). Real flowers are self-similar, so each form
// leans on that: concentric petal rings (marigold), forked florets (cornflower),
// branching veins (mallow). None of this is traced from any image — it is built
// from how each bloom is structurally put together.
const TAU = Math.PI * 2;

// The canonical silhouette, neutral grey — the SHAPE channel (D2-ii shape-alone).
// Renders the exact formGeometry outline d2check measures, so proxy and eye agree.
function drawSilhouette(ctx, type, cx, cy, cell, grow) {
  const g = formGeometry(type);
  ctx.save();
  ctx.beginPath(); traceForm(ctx, g.outline, cx, cy, cell, grow); ctx.closePath();
  if (g.kind === 'holed') {
    ctx.arc(cx, cy, cell * g.hole * grow, 0, TAU, true);
    ctx.fillStyle = '#cfd6cf'; ctx.fill('evenodd');
    ctx.beginPath(); ctx.arc(cx, cy, cell * g.hole * grow, 0, TAU);
    ctx.fillStyle = '#3a403a'; ctx.fill();
  } else { ctx.fillStyle = '#cfd6cf'; ctx.fill(); }
  ctx.lineWidth = Math.max(1, cell * 0.05); ctx.strokeStyle = '#7d847d';
  ctx.beginPath(); traceForm(ctx, g.outline, cx, cy, cell, grow); ctx.closePath(); ctx.stroke();
  if (g.centre) { ctx.beginPath(); ctx.arc(cx, cy, cell * g.centre * grow, 0, TAU); ctx.fillStyle = '#7d847d'; ctx.fill(); }
  ctx.restore();
}

function seatShadow(ctx, cx, cy, u) {            // calm soft seat on the soil — no hard edge
  ctx.beginPath(); ctx.ellipse(cx, cy + u * 0.06, u * 0.42, u * 0.40, 0, 0, TAU);
  ctx.fillStyle = 'rgba(74,63,46,0.10)'; ctx.fill();   // faint warm seat on loam (was 0,0,0,0.18 for the dark bed)
}
function scallopPath(ctx, cx, cy, r, lobes, bump, rot) {   // a ruffled (lobed) ring
  const n = lobes * 2; ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = rot + (i / n) * TAU, rr = r + (i % 2 ? bump : -bump * 0.5);
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// MARIGOLD — a dense layered pompom: ruffled outer ring over a dark depth-base,
// packed-petal divisions, a warm radial glow, a lighter inner whorl, dark throat.
function drawMarigold(ctx, cx, cy, u, col, dark, lite) {
  ctx.beginPath(); ctx.arc(cx, cy, u * 0.46, 0, TAU); ctx.fillStyle = dark; ctx.fill();
  const grad = ctx.createRadialGradient(cx, cy, u * 0.04, cx, cy, u * 0.46);
  grad.addColorStop(0, lite); grad.addColorStop(0.5, col); grad.addColorStop(1, col);
  scallopPath(ctx, cx, cy, u * 0.45, 12, u * 0.055, 0); ctx.fillStyle = grad; ctx.fill();
  ctx.strokeStyle = dark; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(0.7, u * 0.022);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + Math.PI / 12;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * u * 0.20, cy + Math.sin(a) * u * 0.20);
    ctx.lineTo(cx + Math.cos(a) * u * 0.42, cy + Math.sin(a) * u * 0.42); ctx.stroke();
  }
  scallopPath(ctx, cx, cy, u * 0.27, 9, u * 0.04, Math.PI / 9); ctx.fillStyle = lite; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, u * 0.10, 0, TAU); ctx.fillStyle = dark; ctx.fill();
}

// CORNFLOWER — fringed ray-florets around a dark disc cluster. Each ray is a tapered
// floret with a forked (notched) tip, lit at the rim; tiny inner florets at the eye.
function floret(ctx, cx, cy, a, rBase, rTip, u, col, dark, lite) {
  const ca = Math.cos(a), sa = Math.sin(a), px = -sa, py = ca;
  const wB = u * 0.055, wM = u * 0.12, notch = u * 0.075, rM = rBase + (rTip - rBase) * 0.6;
  const P = (r, w) => [cx + ca * r + px * w, cy + sa * r + py * w];
  const bL = P(rBase, wB), bR = P(rBase, -wB), mL = P(rM, wM), mR = P(rM, -wM);
  const tL = P(rTip, wM * 0.6), tR = P(rTip, -wM * 0.6), nIn = P(rTip - notch, 0);
  ctx.beginPath();
  ctx.moveTo(bL[0], bL[1]); ctx.lineTo(mL[0], mL[1]); ctx.lineTo(tL[0], tL[1]);
  ctx.lineTo(nIn[0], nIn[1]); ctx.lineTo(tR[0], tR[1]); ctx.lineTo(mR[0], mR[1]); ctx.lineTo(bR[0], bR[1]);
  ctx.closePath();
  const grad = ctx.createLinearGradient(cx + ca * rBase, cy + sa * rBase, cx + ca * rTip, cy + sa * rTip);
  grad.addColorStop(0, dark); grad.addColorStop(0.45, col); grad.addColorStop(1, lite);
  ctx.fillStyle = grad; ctx.fill();
  ctx.strokeStyle = dark; ctx.lineWidth = Math.max(0.5, u * 0.014); ctx.stroke();
}
function drawCornflower(ctx, cx, cy, u, col, dark, lite) {
  for (let i = 0; i < 6; i++) floret(ctx, cx, cy, (i / 6) * TAU - Math.PI / 2, u * 0.15, u * 0.48, u, col, dark, lite);
  ctx.beginPath(); ctx.arc(cx, cy, u * 0.17, 0, TAU); ctx.fillStyle = dark; ctx.fill();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU - Math.PI / 2;
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * u * 0.08, cy + Math.sin(a) * u * 0.08, u * 0.028, 0, TAU);
    ctx.fillStyle = col; ctx.fill();
  }
}

// MALLOW — five broad notched petals with a throat-glow and branching veins fanning
// from a dark throat (a small lit staminal hint at the eye).
function mallowPetal(ctx, cx, cy, a, rBase, rTip, u, col, dark, lite) {
  const ca = Math.cos(a), sa = Math.sin(a), px = -sa, py = ca;
  const wB = u * 0.06, wMax = u * 0.21, notch = u * 0.06, rM = rBase + (rTip - rBase) * 0.55;
  const P = (r, w) => [cx + ca * r + px * w, cy + sa * r + py * w];
  const bL = P(rBase, wB), bR = P(rBase, -wB), mL = P(rM, wMax), mR = P(rM, -wMax);
  const tL = P(rTip, wMax * 0.45), tR = P(rTip, -wMax * 0.45), nIn = P(rTip - notch, 0);
  ctx.beginPath();
  ctx.moveTo(bL[0], bL[1]); ctx.quadraticCurveTo(mL[0], mL[1], tL[0], tL[1]);
  ctx.lineTo(nIn[0], nIn[1]); ctx.lineTo(tR[0], tR[1]); ctx.quadraticCurveTo(mR[0], mR[1], bR[0], bR[1]);
  ctx.closePath();
  const grad = ctx.createRadialGradient(cx, cy, u * 0.02, cx + ca * rM, cy + sa * rM, u * 0.42);
  grad.addColorStop(0, lite); grad.addColorStop(0.7, col); grad.addColorStop(1, col);
  ctx.fillStyle = grad; ctx.fill();
  ctx.strokeStyle = dark; ctx.lineWidth = Math.max(0.5, u * 0.018); ctx.stroke();
}
function mallowVeins(ctx, cx, cy, a, rBase, rTip, u, dark) {
  const ca = Math.cos(a), sa = Math.sin(a), px = -sa, py = ca;
  ctx.strokeStyle = dark; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(0.5, u * 0.016);
  ctx.beginPath(); ctx.moveTo(cx + ca * rBase, cy + sa * rBase);
  ctx.lineTo(cx + ca * (rTip - u * 0.07), cy + sa * (rTip - u * 0.07)); ctx.stroke();
  const rF = rBase + (rTip - rBase) * 0.42, fx = cx + ca * rF, fy = cy + sa * rF;
  for (const s of [1, -1]) {
    ctx.beginPath(); ctx.moveTo(fx, fy);
    ctx.lineTo(cx + ca * (rTip - u * 0.13) + px * s * u * 0.10, cy + sa * (rTip - u * 0.13) + py * s * u * 0.10);
    ctx.stroke();
  }
}
function drawMallow(ctx, cx, cy, u, col, dark, lite) {
  for (let i = 0; i < 5; i++) mallowPetal(ctx, cx, cy, (i / 5) * TAU - Math.PI / 2, u * 0.13, u * 0.49, u, col, dark, lite);
  for (let i = 0; i < 5; i++) mallowVeins(ctx, cx, cy, (i / 5) * TAU - Math.PI / 2, u * 0.13, u * 0.49, u, dark);
  ctx.beginPath(); ctx.arc(cx, cy, u * 0.13, 0, TAU); ctx.fillStyle = dark; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, u * 0.05, 0, TAU); ctx.fillStyle = lite; ctx.fill();
}

// Draw one bloom. `grow` 0..1 scales it in (the growth-reveal / settle). shapeOnly →
// neutral silhouette (the shape channel); colourOnly → plain disc (the colour channel).
function drawBloom(ctx, type, cx, cy, cell, opts = {}) {
  const grow = opts.grow == null ? 1 : Math.max(0, Math.min(1, opts.grow));
  if (grow <= 0) return;
  const f = FORMS[type];

  if (opts.colourOnly) {                       // shape neutralised — colour-alone channel
    ctx.beginPath(); ctx.arc(cx, cy, cell * 0.36 * grow, 0, TAU);
    ctx.fillStyle = f.colour; ctx.fill();
    ctx.lineWidth = Math.max(1, cell * 0.04); ctx.strokeStyle = f.dark; ctx.stroke();
    return;
  }
  if (opts.shapeOnly) { drawSilhouette(ctx, type, cx, cy, cell, grow); return; }

  // Cached path: blit the pre-baked bloom sprite, scaled by grow. Pixel-parity with the
  // procedural draw below — the sprite is baked from these very functions. Falls back to
  // procedural when no sprite is supplied (paintNext, or any mismatched cell size).
  if (opts.sprite && opts.spriteBox) {
    const d = opts.spriteBox * grow;
    ctx.drawImage(opts.sprite, cx - d / 2, cy - d / 2, d, d);
    return;
  }

  const u = cell * grow;
  ctx.save();
  seatShadow(ctx, cx, cy, u);
  if (type === 0) drawMarigold(ctx, cx, cy, u, f.colour, f.dark, f.light);
  else if (type === 1) drawCornflower(ctx, cx, cy, u, f.colour, f.dark, f.light);
  else drawMallow(ctx, cx, cy, u, f.colour, f.dark, f.light);
  ctx.restore();
}

// ── Resolution TRACE (pure — no canvas; node-testable) ───────────────────────
// After a lock, the sim resolves clears + gravity + cascades ATOMICALLY (one
// Sim.tick call), so render only ever sees the settled board and orphaned cells
// appear to teleport. This rebuilds that resolution as an ordered SEQUENCE of
// animatable steps so render can show the fall at the piece's rate (Dr. Mario).
//
// Critically: there is NO second gravity model here. The clear set comes from
// Sim.findClears and the settled column from Sim.applyGravity — the gate's own
// primitives. Per-cell fall is DERIVED by pairing each column bottom-up before vs.
// after gravity (gravity preserves vertical order within a column), so the trace's
// finalBoard equals Sim.resolveBoard(lockedBoard) BY CONSTRUCTION. The sim stays
// the authority for game state; this only describes the motion to draw.
function cloneBoard(b) { return b.map(row => row.map(c => (c ? { type: c.type, target: c.target, bond: c.bond || null } : null))); }

// Pair surviving cells per column bottom-up (before vs. after gravity) into per-cell
// fall moves. Each cell stays in its own column when it falls (a bonded horizontal
// pair drops straight down, both halves the same distance), so column-pairing still
// yields correct per-cell moves; a resting pair shows no change → no move.
function deriveMoves(before, after, COLS, ROWS) {
  const moves = [];
  for (let x = 0; x < COLS; x++) {
    const from = [], to = [];
    for (let y = ROWS - 1; y >= 0; y--) if (before[y][x]) from.push(y);
    for (let y = ROWS - 1; y >= 0; y--) if (after[y][x]) to.push(y);
    for (let k = 0; k < from.length; k++) {
      if (from[k] !== to[k]) {
        const c = before[from[k]][x];
        moves.push({ x, fromY: from[k], toY: to[k], type: c.type, target: c.target });
      }
    }
  }
  return moves;
}

function buildResolveTrace(lockedBoard, Sim) {
  const COLS = Sim.COLS, ROWS = Sim.ROWS;
  const partnerOf = (x, y, c) => !c || !c.bond ? null
    : c.bond === 'L' ? { x: x - 1, y } : c.bond === 'R' ? { x: x + 1, y }
    : c.bond === 'U' ? { x, y: y - 1 } : { x, y: y + 1 };
  const inB = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS;
  const steps = [];
  let board = cloneBoard(lockedBoard);

  // INITIAL SETTLE — mirror resolveBoard's leading applyGravity. With bonds this is
  // almost always a no-op at lock (a bonded pair rests), so no step is emitted; it
  // only fires (and animates) if something was genuinely unsettled. Bond-aware
  // gravity rests a pair on either half's support, so a capping piece does NOT drop.
  {
    const afterGrav = cloneBoard(board);
    Sim.applyGravity(afterGrav);
    const moves = deriveMoves(board, afterGrav, COLS, ROWS);
    if (moves.length) steps.push({ clears: [], afterClear: cloneBoard(board), moves });
    board = afterGrav;
  }

  let guard = 0;
  for (;;) {
    if (guard++ > ROWS * COLS) break;                 // safety: cannot exceed the cell count
    const marked = Sim.findClears(board);             // the gate's own clear logic
    if (marked.size === 0) break;
    const clears = [];
    for (const key of marked) {
      const [x, y] = key.split(',').map(Number);
      clears.push({ x, y, type: board[y][x].type });
    }
    const afterClear = cloneBoard(board);
    for (const key of marked) {                        // sever + clear, mirroring resolveBoard
      const [x, y] = key.split(',').map(Number);
      const c = afterClear[y][x];
      if (c && c.bond) {
        const p = partnerOf(x, y, c);
        if (p && inB(p.x, p.y) && afterClear[p.y][p.x]) afterClear[p.y][p.x].bond = null;
      }
      afterClear[y][x] = null;
    }
    const afterGrav = cloneBoard(afterClear);
    Sim.applyGravity(afterGrav);                      // the gate's own gravity = the truth
    const moves = deriveMoves(afterClear, afterGrav, COLS, ROWS);
    steps.push({ clears, afterClear, moves });
    board = afterGrav;
  }
  return { steps, finalBoard: board };
}

// ── Board renderer ───────────────────────────────────────────────────────────
// ── Planted bed: the fixed/loose channel ────────────────────────────────────
// Seeded flowers are ROOTED — they sit in a pocket of tilled earth, so the player
// can tell at a glance which blooms are fixed (never fall) from the loose dropped
// halves (which fall when decoupled). TYPE stays carried entirely by the bloom's
// colour + silhouette (untouched); "planted" rides on a bold WHITE frame around the
// cell — a high-contrast figure/ground cue that survives greyscale, so the colourblind
// shape-channel is preserved. Loose blooms (dropped halves, the falling piece, severed
// singles) get no frame, so they read as resting on top — about to fall.
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function plantedBed(ctx, cx, cy, cell, grow) {
  const s = cell * 0.9 * grow, r = cell * 0.22 * grow, x = cx - s / 2, y = cy - s / 2;
  if (s <= 0) return;
  ctx.save();
  rrect(ctx, x, y, s, s, r);
  ctx.lineWidth = Math.max(2.5, cell * 0.1);          // BOLD — not a hairline
  ctx.strokeStyle = '#4A3F2E';                         // tilled-earth brown — planted blooms sit ROOTED in soil, high-contrast on loam
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

function makeRenderer(canvas, Sim) {
  const ctx = canvas.getContext('2d');
  const COLS = Sim.COLS, ROWS = Sim.ROWS;
  let cell = 30, dpr = 1;
  let sprites = [], spriteBox = 0;

  function fit() {
    dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    // Dr-Virus layout: board left of an info rail, with a control deck along the bottom. Reserve
    // HORIZONTAL for the rail (~98px + gaps) AND VERTICAL for the deck (~88px) + safe-area top. The
    // board is bounded by both. These are dial-able if the bed wants to be bigger/smaller.
    const maxW = Math.min(window.innerWidth - 134, 360);   // info rail + gap + margins (gutter is inside the rail)
    // VERTICAL reserve: safe-area top + bottom control deck + margins (176) PLUS the Next strip that
    // now sits ABOVE the board inside #field (the board is pushed down to clear it). Over-reserve a hair
    // so the field can never grow taller than the viewport (overflow = the scroll-shift bug). Dial-able.
    const NEXT_STRIP = 52;                                  // compact horizontal "Next [piece]" strip + gap
    // Base 150 (was 176): trimmed so the board grows to fill more height and the top/bottom gaps shrink
    // toward the 1rem side gap — the bed was leaving too much dead space above the control deck.
    const maxH = window.innerHeight - 150 - NEXT_STRIP;
    cell = Math.floor(Math.min(maxW / COLS, maxH / ROWS));
    cell = Math.max(18, cell);                 // never below the D2 render-size floor
    const w = cell * COLS, h = cell * ROWS;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildSprites();                            // re-bake bloom sprites for the new cell/dpr
    return { w, h };
  }

  // Pre-bake each bloom type to an offscreen canvas once per cell/dpr, so paintBoard BLITS
  // them instead of re-running per-petal gradients every frame (the hot cost). Baked from the
  // SAME draw functions as the procedural path -> pixel-parity. See RUNBOOK-bloom-sprite-cache.
  function buildSprites() {
    spriteBox = Math.ceil(cell * 1.35);        // pads the bloom's ~0.52*cell extent + shadow
    sprites = [];
    for (let t = 0; t < FORMS.length; t++) {
      const off = document.createElement('canvas');
      off.width = Math.round(spriteBox * dpr); off.height = Math.round(spriteBox * dpr);
      const c = off.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);    // bake at device resolution -> crisp blits
      const m = spriteBox / 2, f = FORMS[t];
      c.save();
      seatShadow(c, m, m, cell);
      if (t === 0) drawMarigold(c, m, m, cell, f.colour, f.dark, f.light);
      else if (t === 1) drawCornflower(c, m, m, cell, f.colour, f.dark, f.light);
      else drawMallow(c, m, m, cell, f.colour, f.dark, f.light);
      c.restore();
      sprites[t] = off;
    }
  }
  fit();   // size the canvas once at construction (return value was unused)

  function clear() {
    ctx.fillStyle = SOIL;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // faint soil rows — a tilled-bed feel, very quiet
    ctx.strokeStyle = 'rgba(90,70,45,0.08)'; ctx.lineWidth = 1;   // warm raked-earth furrows on loam
    for (let r = 1; r < ROWS; r++) { ctx.beginPath(); ctx.moveTo(0, r * cell); ctx.lineTo(COLS * cell, r * cell); ctx.stroke(); }
  }

  // Overgrowth ember (§DS/D5): the garden's danger STATE — soft top-vignette that
  // deepens as blooms crowd the top rows. Clear but not alarming (for a tired nurse).
  function overgrowth(board) {
    let topFill = 0;
    for (let y = 0; y < 3; y++) for (let x = 0; x < COLS; x++) if (board[y][x]) topFill++;
    const danger = Math.min(1, topFill / (COLS * 2));
    if (danger <= 0) return;
    const g = ctx.createLinearGradient(0, 0, 0, cell * 3.5);
    g.addColorStop(0, `rgba(224,106,74,${0.28 * danger})`);
    g.addColorStop(1, 'rgba(224,106,74,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, COLS * cell, cell * 3.5);
  }

  function cellCentre(x, y) { return [x * cell + cell / 2, y * cell + cell / 2]; }

  function paintBoard(state, opts = {}) {
    clear();
    const b = state.board;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const c = b[y][x];
      if (!c) continue;
      const [cx, cy] = cellCentre(x, y);
      const grow = (opts.growMap && opts.growMap[y * COLS + x] != null) ? opts.growMap[y * COLS + x] : 1;
      if (c.target && !opts.shapeOnly && !opts.colourOnly) plantedBed(ctx, cx, cy, cell, grow);
      drawBloom(ctx, c.type, cx, cy, cell, { grow, shapeOnly: opts.shapeOnly, colourOnly: opts.colourOnly, sprite: sprites[c.type], spriteBox });
    }
    if (state.piece && !opts.hidePiece) {        // the falling seed-pair, drawn live
      for (const pc of Sim.pieceCells(state.piece)) {
        if (pc.y < 0) continue;
        const [cx, cy] = cellCentre(pc.x, pc.y);
        drawBloom(ctx, pc.type, cx, cy, cell, { shapeOnly: opts.shapeOnly, colourOnly: opts.colourOnly, sprite: sprites[pc.type], spriteBox });
      }
    }
    overgrowth(b);
  }

  // The "next" preview — draws the upcoming pair (from Sim.peekNext) into a small side
  // canvas using the board's own bloom art, so the player can plan the placement ahead
  // (Dr. Mario shows the next pill). Sized off the live board cell so it scales together.
  function paintNext(nextCanvas, types) {
    if (!nextCanvas) return;
    const nctx = nextCanvas.getContext('2d');
    const c = Math.max(18, cell);                      // board-cell size — Next blooms match the board pieces
    const w = c * 2, h = c;
    nextCanvas.style.width = w + 'px'; nextCanvas.style.height = h + 'px';
    nextCanvas.width = Math.round(w * dpr); nextCanvas.height = Math.round(h * dpr);
    nctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    nctx.clearRect(0, 0, w, h);
    if (!types) return;
    drawBloom(nctx, types.t0, c * 0.5, c * 0.5, c);   // pivot half (spawns on the left)
    drawBloom(nctx, types.t1, c * 1.5, c * 0.5, c);   // second half (spawns to the right)
  }

  // The brand mark: all three blooms (marigold + cornflower + mallow) in a tight, overlapping
  // triangular cluster — same procedural draw as the board, drawn back-to-front for layered depth.
  // Scales with the board cell but floored so it stays legible small. Bake at DPR for a crisp blit.
  function paintLogo(logoCanvas) {
    if (!logoCanvas) return;
    const g = logoCanvas.getContext('2d');
    const S = Math.max(30, Math.round(cell * 1.55));      // logo box scale (floored for the small size)
    const W = Math.round(S * 1.16), H = S;
    logoCanvas.style.width = W + 'px'; logoCanvas.style.height = H + 'px';
    logoCanvas.width = Math.round(W * dpr); logoCanvas.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const c = S * 0.62;                                    // each bloom's size — tuned for a tight overlap
    drawBloom(g, 0, W * 0.34, H * 0.60, c);                // marigold (orange), lower-left  — back
    drawBloom(g, 1, W * 0.66, H * 0.60, c);                // cornflower (blue), lower-right — back
    drawBloom(g, 2, W * 0.50, H * 0.36, c);                // mallow (purple), top-centre    — front, overlaps both
  }

  return { ctx, fit, paintBoard, paintNext, paintLogo, cellPx: () => cell, COLS, ROWS };
}

var API = { FORMS, SOIL, EMBER, formGeometry, drawBloom, makeRenderer, cloneBoard, buildResolveTrace };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.Render = API;
