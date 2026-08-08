// Beam Wizards — B3c: the JS beam engine (a faithful port of B2 `beam_core.py`).
//
// Decision (operator A): the browser runs THIS JS port; correctness is
// pinned by a conformance harness against the canonical Python engine (B2). This
// module is pure JS with NO Three.js dependency — it is the sim, runnable both
// under Node (for conformance) and in the browser (for the game render). The
// render skin imports it; it imports nothing.
//
// Semantics are ported line-for-line from B2 march/cast (verified): state is
// recorded POST-interaction (a reflector's new heading, glass's filtered color);
// LOOPED returns WITHOUT appending the repeated state; BUDGET appends then stops;
// cast skips BLACK states when merging. Match B2 exactly or the conformance fails.

// ── Color — the bounded 3-bit {R,G,B} gamut (8 states), as a bitmask. ──
export const BLACK = 0;
export const R = 0b001, G = 0b010, B = 0b100;
export const RED = R, GREEN = G, BLUE = B;
export const YELLOW = R | G, CYAN = G | B, MAGENTA = R | B, WHITE = R | G | B;
export const GAMUT = [BLACK, RED, GREEN, YELLOW, BLUE, MAGENTA, CYAN, WHITE];

export const merge = (a, b) => a | b;               // additive emission (OR)
export const throughGlass = (c, mask) => c & mask;  // subtractive transmission (AND)
export const isLit = (c) => c !== BLACK;

function checkGamut(c) {
  if (!Number.isInteger(c) || c < 0 || c > 7) {
    throw new Error(`color ${c} not in the 3-bit gamut`);
  }
}

// ── Direction — the six unit axis directions (3D free). ──
function mkDir(dx, dy, dz) { return Object.freeze({ dx, dy, dz }); }
export const PX = mkDir(1, 0, 0), NX = mkDir(-1, 0, 0);
export const PY = mkDir(0, 1, 0), NY = mkDir(0, -1, 0);
export const PZ = mkDir(0, 0, 1), NZ = mkDir(0, 0, -1);
export const UNIT_DIRS = [PX, NX, PY, NY, PZ, NZ];

export const dirKey = (d) => `${d.dx},${d.dy},${d.dz}`;
const opposite = (d) => mkDir(-d.dx, -d.dy, -d.dz);
const stepDir = (d, cell) => [cell[0] + d.dx, cell[1] + d.dy, cell[2] + d.dz];

const _DIR_BY_KEY = new Map(UNIT_DIRS.map((d) => [dirKey(d), d]));
export function dirFromVec(v) {
  const d = _DIR_BY_KEY.get(`${v[0]},${v[1]},${v[2]}`);
  if (!d) throw new Error(`not a unit direction: ${v}`);
  return d;
}

export const cellKey = (c) => `${c[0]},${c[1]},${c[2]}`;

// ── Reflector — a group-action lookup (a permutation of the six directions). ──
function permFromPairs(...swaps) {
  const action = new Map(UNIT_DIRS.map((d) => [dirKey(d), d]));  // identity
  for (const [a, b] of swaps) {
    action.set(dirKey(a), b);
    action.set(dirKey(b), a);
  }
  return action;
}
function makeReflector(action) {
  // validate: defined on all six, and a bijection (a permutation)
  const keys = new Set(action.keys());
  const vals = new Set([...action.values()].map(dirKey));
  if (keys.size !== 6 || vals.size !== 6) {
    throw new Error("reflector action must be a permutation of the six directions");
  }
  return {
    kind: "reflector",
    action,
    reflect(d) { return action.get(dirKey(d)); },
  };
}
export const mirrorSlash = () => makeReflector(permFromPairs([PX, PY], [NX, NY]));     // "/"
export const mirrorBackslash = () => makeReflector(permFromPairs([PX, NY], [NX, PY])); // "\"
// ── The four NEW 3D mirror orientations (the other two of the six; 3 planes × 2
// diagonals = 6, the 2 XY are above). Promoted from the 3d-cube-space spike →
// canonical; pinned against the Python oracle by run_mirror3d_conformance.mjs. ──
export const mirrorSlashXZ = () => makeReflector(permFromPairs([PX, PZ], [NX, NZ]));     // "/" XZ, Y free
export const mirrorBackslashXZ = () => makeReflector(permFromPairs([PX, NZ], [NX, PZ])); // "\" XZ, Y free
export const mirrorSlashYZ = () => makeReflector(permFromPairs([PY, PZ], [NY, NZ]));     // "/" YZ, X free
export const mirrorBackslashYZ = () => makeReflector(permFromPairs([PY, NZ], [NY, PZ])); // "\" YZ, X free
// The general turn-mirror: bends `incoming` -> `outgoing` (must be perpendicular).
export const mirrorForTurn3d = (incoming, outgoing) => {
  if (dirKey(incoming) === dirKey(outgoing) || dirKey(incoming) === dirKey(opposite(outgoing))) {
    throw new Error("mirrorForTurn3d needs perpendicular directions (different axes)");
  }
  const refl = makeReflector(permFromPairs([incoming, outgoing], [opposite(incoming), opposite(outgoing)]));
  if (dirKey(refl.reflect(incoming)) !== dirKey(outgoing)) {
    throw new Error("constructed turn-mirror does not bend in->out");
  }
  return refl;
};
export const retroreflector = () => {
  const action = new Map(UNIT_DIRS.map((d) => [dirKey(d), opposite(d)]));
  return makeReflector(action);
};

// ── Other elements. ──
export const makeGlass = (mask) => { checkGamut(mask); return { kind: "glass", mask }; };
export const makeAbsorber = () => ({ kind: "absorber" });
export const makeEmitter = (dir, color) => { checkGamut(color); return { kind: "emitter", dir, color }; };

// ── BeamSplitter — the first fan-out element (B4b). Transmits straight + reflects
// (a permutation action, like a Reflector). Both branches carry FULL color (the
// 3-bit gamut has no intensity, so no '50%' — the faithful discrete analog; M12 §4).
function makeSplitter(action) {
  const keys = new Set(action.keys());
  const vals = new Set([...action.values()].map(dirKey));
  if (keys.size !== 6 || vals.size !== 6) {
    throw new Error("splitter action must be a permutation of the six directions");
  }
  return { kind: "splitter", action, reflect(d) { return action.get(dirKey(d)); } };
}
export const splitterSlash = () => makeSplitter(permFromPairs([PX, PY], [NX, NY]));     // "/"
export const splitterBackslash = () => makeSplitter(permFromPairs([PX, NY], [NX, PY])); // "\"

// ── Prism — dispersion (B4b). One beam → one beam per present band, each in its
// band's outgoing direction (the discrete dispersion law). WHITE → 3-way rainbow fan;
// secondary → 2-way; single band → directed bend. Each leg carries its real single-band
// color (M12-honest; no intensity invented). Canonical +X prism: R→+X, G→+Y, B→-Y.
function makePrism(bandDirs) {
  // bandDirs: array of [bandMask, Direction]
  const bands = new Set(bandDirs.map(([b]) => b));
  if (!(bands.size === 3 && bands.has(RED) && bands.has(GREEN) && bands.has(BLUE))) {
    throw new Error("prism dispersion law must map exactly the three bands R, G, B");
  }
  return {
    kind: "prism",
    bandDirs,
    disperse(color) {
      const out = [];
      for (const [band, d] of bandDirs) {
        if (color & band) out.push({ dir: d, color: band });
      }
      return out;
    },
  };
}
export const prismXY = () => makePrism([[RED, PX], [GREEN, PY], [BLUE, NY]]);

// ── TIRInterface — discrete total internal reflection (B4b, 3/3). A CONDITIONAL
// reflector: a beam crossing the 45° boundary dense→rare (past the discrete critical
// angle) reflects (the '/'-'\' group action); a rare→dense beam (below critical)
// transmits STRAIGHT; a beam parallel to the plane (Z) grazes → transmits. `tirDirs`
// IS the discrete critical-angle table. Single-continuation (reflect XOR transmit),
// so it lives in BOTH march and cast — NOT a fan-out element. Mirrors B2 exactly.
function makeTIR(action, tirDirs) {
  const keys = new Set(action.keys());
  const vals = new Set([...action.values()].map(dirKey));
  if (keys.size !== 6 || vals.size !== 6) {
    throw new Error("TIR reflection action must be a permutation of the six directions");
  }
  const tir = new Set([...tirDirs].map(dirKey));
  for (const k of tir) {
    if (!action.has(k)) throw new Error("tir_dirs must be unit directions");
    if (dirKey(action.get(k)) === k) {
      throw new Error("a TIR direction must be reflected by the action (not a no-op self-map)");
    }
  }
  return {
    kind: "tir",
    action,
    tirDirs: tir,
    outgoing(d) {
      const k = dirKey(d);
      return tir.has(k) ? action.get(k) : d;  // reflect (past critical) XOR transmit straight
    },
  };
}
export const tirSlash = (dense = "below_right") => {
  const action = permFromPairs([PX, PY], [NX, NY]);  // the '/' reflection
  let tir;
  if (dense === "below_right") tir = [NX, PY];
  else if (dense === "above_left") tir = [PX, NY];
  else throw new Error("tirSlash dense must be 'below_right' or 'above_left'");
  return makeTIR(action, tir);
};
export const tirBackslash = (dense = "above_right") => {
  const action = permFromPairs([PX, NY], [NX, PY]);  // the '\' reflection
  let tir;
  if (dense === "above_right") tir = [NX, NY];
  else if (dense === "below_left") tir = [PX, PY];
  else throw new Error("tirBackslash dense must be 'above_right' or 'below_left'");
  return makeTIR(action, tir);
};

// ── Transistor — the control-gated pass/inhibit element (B5a). Mirrors B2. ──
// The first FIELD-dependent element: active-low (signal passes IFF control absent).
// merge (OR) and throughGlass (AND) are monotone, so they cannot build NOT; this
// crosses the monotone boundary (NOT → NOR → functionally complete). Because the
// gate reads the field, a transistor grid needs `settle` (the fixed point), not a
// lone `cast`. Geometry: a planar gate — signal beams travel the signal axis (pass
// iff control absent, else extinguish), control beams travel the control axis
// (consumed, their arrival = control lit), a third-axis beam passes unchanged.
const AXIS_DIRS = { x: [PX, NX], y: [PY, NY], z: [PZ, NZ] };
const axisKeySet = (letter) => new Set(AXIS_DIRS[letter].map(dirKey));

export function makeTransistor(signal, control) {
  if (!AXIS_DIRS[signal] || !AXIS_DIRS[control]) {
    throw new Error("transistor signal/control axes must be one of 'x','y','z'");
  }
  if (signal === control) throw new Error("transistor signal and control axes must be distinct");
  return {
    kind: "transistor",
    signal, control,                 // axis letters (for serialization)
    signalAxis: axisKeySet(signal),  // Set of dirKeys
    controlAxis: axisKeySet(control),
  };
}
export const transistor = (signal = "x", control = "y") => makeTransistor(signal, control);

// ── Delay — the sequential keystone (B5c). Stateful element: output-now =
// input-one-tick-ago. A beam arriving heading `direction` is CAPTURED (absorbed);
// the held value (in the stepper's state map) re-emits ONE CELL DOWNSTREAM heading
// `direction` via ε (delayIo). The element is stateless; in the combinational
// settle it is an absorber. Mirrors B2 beam_core.
export const makeDelay = (direction) => ({ kind: "delay", direction });
export const delay = (direction = PX) => makeDelay(direction);

// ── Register — the optical logic kit's APEX (B5d). Mirrors B2 beam_core. ──
// A STATEFUL element that holds a value across ticks with set / hold / reset control —
// the third generator. delay + feedback gives a HOLD; the register packages that hold
// with a gated write and a clear:  RESET → 0 (dominates) | else WRITE → data | else
// HOLD (the delay+feedback hold INTERNALIZED, so a register holds with no external
// wire — that is what makes it a register, not a bare delay). Three orthogonal ports
// on three DISTINCT axes: DATA flows the data axis (input captured at the cell, held
// value re-emitted ONE CELL DOWNSTREAM as the readable output, exactly like a Delay);
// WRITE on the write axis (lit arrival = write-enable, consumed); RESET on the reset
// axis (lit arrival = clear, consumed). Like the Delay, the element is STATELESS — the
// held value lives in the stepper state, keyed by cell; registerIo derives (ε,δ). The
// WRITE/RESET controls are read by δ from the SETTLED field, the same field-read the
// Transistor does but at the LATCH, not in the settle: in the combinational settle a
// Register is an ABSORBER reading no gate field, so cast≡march and order-independence
// on register-free grids are untouched, and the only settle-time field-dependence in
// the engine stays the Transistor's. (The held value is a full gamut color like the
// Delay's; "1-bit" is the control abstraction — write/hold/reset — not a data width.)
const POS_DIR = { x: PX, y: PY, z: PZ };
export function makeRegister(data, write, reset) {
  if (!AXIS_DIRS[data] || !AXIS_DIRS[write] || !AXIS_DIRS[reset]) {
    throw new Error("register data/write/reset axes must be one of 'x','y','z'");
  }
  if (new Set([data, write, reset]).size !== 3) {
    throw new Error("register data, write, and reset axes must be pairwise distinct");
  }
  return {
    kind: "register",
    data, write, reset,             // axis letters (for serialization)
    dataDir: POS_DIR[data],         // DATA flows the POSITIVE direction of the data axis
    writeAxis: axisKeySet(write),   // Set of dirKeys
    resetAxis: axisKeySet(reset),
  };
}
export const register = (data = "x", write = "y", reset = "z") => makeRegister(data, write, reset);

// Is a transistor's control port LIT in `gateField`? True iff a lit beam arrived at
// `cell` along the control axis (contributions hold "dirKey|color"). gateField null
// ⇒ control dark / gate open (the seed pass + every transistor-free cast).
function controlLit(gateField, cell, controlAxis) {
  if (!gateField) return false;
  const contribs = gateField.contributions.get(cellKey(cell));
  if (!contribs) return false;
  for (const s of contribs) {
    const bar = s.lastIndexOf("|");
    if (controlAxis.has(s.slice(0, bar)) && isLit(parseInt(s.slice(bar + 1), 10))) return true;
  }
  return false;
}

// Reconstruct an element from a corpus/JSON spec ({kind, ...}).
export function elementFromJson(spec) {
  switch (spec.kind) {
    case "mirror_slash": return mirrorSlash();
    case "mirror_backslash": return mirrorBackslash();
    case "mirror_slash_xz": return mirrorSlashXZ();
    case "mirror_backslash_xz": return mirrorBackslashXZ();
    case "mirror_slash_yz": return mirrorSlashYZ();
    case "mirror_backslash_yz": return mirrorBackslashYZ();
    case "retroreflector": return retroreflector();
    case "glass": return makeGlass(spec.mask);
    case "absorber": return makeAbsorber();
    case "emitter": return makeEmitter(dirFromVec(spec.dir), spec.color);
    case "splitter_slash": return splitterSlash();
    case "splitter_backslash": return splitterBackslash();
    case "prism_xy": return prismXY();
    case "tir_slash": return tirSlash(spec.dense);
    case "tir_backslash": return tirBackslash(spec.dense);
    case "transistor": return makeTransistor(spec.signal, spec.control);
    case "delay": return makeDelay(dirFromVec(spec.direction));
    case "register": return makeRegister(spec.data, spec.write, spec.reset);
    default: throw new Error(`unknown element kind: ${spec.kind}`);
  }
}

// ── Bounds + Grid. ──
export function makeBounds(lo, hi) { return { lo, hi }; }
export function contains(bounds, cell) {
  for (let i = 0; i < 3; i++) {
    if (cell[i] < bounds.lo[i] || cell[i] > bounds.hi[i]) return false;
  }
  return true;
}
export function makeGrid(bounds = null) {
  const elements = new Map();  // cellKey -> element
  return {
    bounds,
    elements,
    place(cell, el) { elements.set(cellKey(cell), el); return this; },
    at(cell) { return elements.get(cellKey(cell)) || null; },
  };
}

export const DEFAULT_MAX_STEPS = 100000;

// Total-beam guard for the worklist cast (fan-out compute ceiling). Per-beam
// depth is bounded by maxSteps; this bounds the number of beams across a cast.
export const DEFAULT_MAX_BEAMS = 100000;

// ── march — discrete integer grid-march of one beam (ported from B2). ──
export function march(grid, start, direction, color, maxSteps = DEFAULT_MAX_STEPS) {
  checkGamut(color);
  if (color === BLACK) return { states: [], termination: "extinguished" };

  const states = [];
  const seen = new Set();
  let curCell = start, curDir = direction, curColor = color, steps = 0;

  while (true) {
    const el = grid.at(curCell);
    if (el && el.kind === "reflector") {
      curDir = el.reflect(curDir);
    } else if (el && el.kind === "tir") {
      // Conditional reflector: reflect (past critical) XOR transmit straight. Single
      // continuation — march-compatible (not fan-out).
      curDir = el.outgoing(curDir);
    } else if (el && el.kind === "glass") {
      curColor = curColor & el.mask;
      if (curColor === BLACK) {
        states.push({ cell: curCell, dir: curDir, color: BLACK });
        return { states, termination: "extinguished" };
      }
    } else if (el && (el.kind === "absorber" || el.kind === "emitter")) {
      states.push({ cell: curCell, dir: curDir, color: curColor });
      return { states, termination: "absorbed" };
    }
    // else: empty cell — pass through unchanged.

    const key = `${cellKey(curCell)}|${dirKey(curDir)}|${curColor}`;
    if (seen.has(key)) return { states, termination: "looped" };
    seen.add(key);
    states.push({ cell: curCell, dir: curDir, color: curColor });

    steps += 1;
    if (steps >= maxSteps) return { states, termination: "budget" };

    const nxt = stepDir(curDir, curCell);
    if (grid.bounds && !contains(grid.bounds, nxt)) return { states, termination: "exit" };
    curCell = nxt;
  }
}

// ── _interact — the per-cell element action, as [records, lives]. ──
// records: lit (dir,color) states to PAINT at this cell.
// lives:   (out_dir,out_color) continuations that propagate ONWARD.
// Most elements yield ≤1 continuation, so the worklist `cast` reduces exactly to
// the single-beam `march` (locked by the equivalence test). Fan-out elements (B4b)
// return lives.length > 1. `gateField`/`cell` are read ONLY by the field-dependent
// transistor (B5a); every other element ignores them, so order-independence + the
// cast≡march equivalence on transistor-free grids hold verbatim. Mirrors B2.
function _interact(el, inDir, inColor, gateField = null, cell = null) {
  if (!el) {
    return [[{ dir: inDir, color: inColor }], [{ dir: inDir, color: inColor }]];
  }
  if (el.kind === "reflector") {
    const outDir = el.reflect(inDir);
    return [[{ dir: outDir, color: inColor }], [{ dir: outDir, color: inColor }]];
  }
  if (el.kind === "tir") {
    // Conditional reflector: reflect XOR transmit straight. One continuation, so the
    // worklist reduces to march on a TIR grid too.
    const outDir = el.outgoing(inDir);
    return [[{ dir: outDir, color: inColor }], [{ dir: outDir, color: inColor }]];
  }
  if (el.kind === "glass") {
    const outColor = inColor & el.mask;
    if (outColor === BLACK) return [[{ dir: inDir, color: BLACK }], []];  // extinguished
    return [[{ dir: inDir, color: outColor }], [{ dir: inDir, color: outColor }]];
  }
  if (el.kind === "absorber" || el.kind === "emitter") {
    return [[{ dir: inDir, color: inColor }], []];  // opaque body: paint, no life
  }
  if (el.kind === "delay") {
    // The state boundary (B5c). In the combinational settle a delay is an absorber:
    // it captures its input (painted here for δ to latch), nothing propagates. The
    // held value re-emits one cell downstream as a SOURCE by ε (delayIo).
    return [[{ dir: inDir, color: inColor }], []];
  }
  if (el.kind === "register") {
    // The register / latch (B5d), the kit's apex. Like the Delay, in the combinational
    // settle a Register is an ABSORBER: it captures every beam arriving at its cell
    // (painted here so δ can read the DATA input AND the WRITE/RESET controls from this
    // cell's contributions), nothing propagates this tick. The held value re-emits one
    // cell downstream as a SOURCE by ε (registerIo); the gating + hold live in δ, NOT
    // here — so the Register reads no gateField and the settle stays exactly as field-
    // dependent as the Transistor alone (cast≡march on register-free grids untouched).
    return [[{ dir: inDir, color: inColor }], []];
  }
  if (el.kind === "splitter") {
    // FAN-OUT: transmitted (straight, full color) + reflected (bent, full color).
    const reflDir = el.reflect(inDir);
    const out = [{ dir: inDir, color: inColor }, { dir: reflDir, color: inColor }];
    return [out, out];
  }
  if (el.kind === "prism") {
    // FAN-OUT: one beam per present band, each in its band's outgoing direction.
    const outs = el.disperse(inColor);
    return [outs, outs];
  }
  if (el.kind === "transistor") {
    // The first FIELD-dependent element (B5a). Active-low control gate. M12: a real
    // pass or a real extinguish — nothing faked.
    const inKey = dirKey(inDir);
    if (el.signalAxis.has(inKey)) {
      if (cell && controlLit(gateField, cell, el.controlAxis)) {
        return [[{ dir: inDir, color: BLACK }], []];  // inhibited (control present)
      }
      return [[{ dir: inDir, color: inColor }], [{ dir: inDir, color: inColor }]];  // pass
    }
    if (el.controlAxis.has(inKey)) {
      return [[{ dir: inDir, color: inColor }], []];  // control consumed (no onward life)
    }
    return [[{ dir: inDir, color: inColor }], [{ dir: inDir, color: inColor }]];  // third axis
  }
  return [[{ dir: inDir, color: inColor }], [{ dir: inDir, color: inColor }]];
}

// ── cast — march many beams and merge per cell, as a worklist over segments. ──
// Each work item is a beam segment walked until it terminates (exit / absorbed /
// extinguished / looped / budget) or FANS OUT, at which point each continuation
// is pushed as a fresh segment. On a grid with no fan-out element this is
// byte-identical to casting via `march`. Order-independent (OR/union commute).
export function cast(grid, sources, maxSteps = DEFAULT_MAX_STEPS, maxBeams = DEFAULT_MAX_BEAMS, gateField = null) {
  const colors = new Map();        // cellKey -> merged color
  const cells = new Map();         // cellKey -> cell (for output)
  const contributions = new Map(); // cellKey -> Set("dirKey|color")

  const paint = (cell, dir, color) => {
    if (!isLit(color)) return;
    const k = cellKey(cell);
    colors.set(k, (colors.get(k) || BLACK) | color);
    cells.set(k, cell);
    if (!contributions.has(k)) contributions.set(k, new Set());
    contributions.get(k).add(`${dirKey(dir)}|${color}`);
  };

  // Seed the worklist: validate gamut (as `march` does), drop dark sources.
  const work = [];
  for (const src of sources) {
    checkGamut(src.color);
    if (src.color === BLACK) continue;
    work.push({ cell: src.cell, dir: src.dir, color: src.color });
  }

  let head = 0;  // FIFO via head pointer (mirrors deque.popleft, no O(n) shift)
  let beams = 0;
  while (head < work.length) {
    beams += 1;
    if (beams > maxBeams) break;  // total-beam guard.
    const item = work[head++];
    let curCell = item.cell, curDir = item.dir, curColor = item.color;

    const seen = new Set();
    let steps = 0;
    while (true) {
      const el = grid.at(curCell);
      const [records, lives] = _interact(el, curDir, curColor, gateField, curCell);

      if (lives.length === 0) {
        // Terminal interaction (absorbed / extinguished): paint and stop.
        for (const r of records) paint(curCell, r.dir, r.color);
        break;
      }

      if (lives.length === 1) {
        const outDir = lives[0].dir, outColor = lives[0].color;
        const key = `${cellKey(curCell)}|${dirKey(outDir)}|${outColor}`;
        if (seen.has(key)) break;  // looped — paint nothing.
        seen.add(key);
        paint(curCell, outDir, outColor);

        steps += 1;
        if (steps >= maxSteps) break;  // budget (state already painted).

        const nxt = stepDir(outDir, curCell);
        if (grid.bounds && !contains(grid.bounds, nxt)) break;  // exit.
        curCell = nxt; curDir = outDir; curColor = outColor;
        continue;
      }

      // FAN-OUT (lives.length > 1): paint each continuation and push as a fresh
      // segment with its own loop history. (B4b.)
      for (const live of lives) {
        paint(curCell, live.dir, live.color);
        const nxt = stepDir(live.dir, curCell);
        if (grid.bounds && !contains(grid.bounds, nxt)) continue;
        work.push({ cell: nxt, dir: live.dir, color: live.color });
      }
      break;
    }
  }
  return { colors, cells, contributions };
}

// ── settle — the combinational FIXED-POINT of the lit-field (B5a). Mirrors B2. ──
// Φ(F) = cast(grid, sources, gateField=F); iterate from the open seed (gateField
// null) until the field repeats. Inhibition is NON-MONOTONE (no least-fixed-point
// guarantee), so the status is honest (M12): CONVERGED / OSCILLATING (a real ring) /
// CAP (circuit too hot) — never a faked "settled" field. Transistor-free ⇒ Φ never
// reads the field ⇒ converges in one pass, byte-identical to cast.
export const DEFAULT_MAX_SETTLE_PASSES = 256;

function fieldSignature(field) {
  const colorParts = [];
  for (const [k, v] of field.colors.entries()) { if (v !== BLACK) colorParts.push(`${k}=${v}`); }
  colorParts.sort();
  const contribParts = [];
  for (const [k, set] of field.contributions.entries()) {
    if (set.size === 0) continue;
    contribParts.push(`${k}:{${[...set].sort().join(",")}}`);
  }
  contribParts.sort();
  return `C[${colorParts.join(";")}]X[${contribParts.join(";")}]`;
}

export function settle(grid, sources, maxPasses = DEFAULT_MAX_SETTLE_PASSES,
                       maxSteps = DEFAULT_MAX_STEPS, maxBeams = DEFAULT_MAX_BEAMS) {
  const srcs = [...sources];
  let field = cast(grid, srcs, maxSteps, maxBeams, null);   // seed: all gates open
  let sig = fieldSignature(field);
  const seen = new Map([[sig, 0]]);
  for (let k = 1; k <= maxPasses; k++) {
    const nxt = cast(grid, srcs, maxSteps, maxBeams, field);  // gates from the PRIOR field
    const nsig = fieldSignature(nxt);
    if (nsig === sig) return { field: nxt, status: "converged", passes: k };
    if (seen.has(nsig)) return { field: nxt, status: "oscillating", passes: k };
    seen.set(nsig, k); field = nxt; sig = nsig;
  }
  return { field, status: "cap", passes: maxPasses };
}
export function litFieldColorList(field) {
  const out = [];
  for (const [k, color] of field.colors.entries()) {
    out.push([field.cells.get(k), color]);
  }
  out.sort((a, b) => {
    for (let i = 0; i < 3; i++) { if (a[0][i] !== b[0][i]) return a[0][i] - b[0][i]; }
    return 0;
  });
  return out;
}

// ── step / run — the per-tick STEPPER (B5b) + delayIo (B5c). Mirrors B2. ──
// One scale up from settle: each tick, state cells emit held values (ε), the
// combinational part settles, each cell latches its input (δ). Honest, one scale up
// from settle (M12): CONVERGED (fixed point) / CYCLING (a real clock, with period) /
// CAP (the tick-scale circuit-too-hot guard); each tick's within-tick combinational
// status is threaded up. Detection is on STATE alone (the field is a deterministic
// function of state). State is { cellKey -> color } (delay cells carry a real 0).
export const DEFAULT_MAX_TICKS = 1024;

const cellFromKey = (k) => k.split(",").map(Number);

function stateSignature(state) {
  return Object.keys(state).sort().map((k) => `${k}=${state[k]}`).join(";");
}

const TICK_SEVERITY = { converged: 0, oscillating: 1, cap: 2 };
const worseSettle = (a, b) => (TICK_SEVERITY[a] >= TICK_SEVERITY[b] ? a : b);

export function step(grid, baseSources, state, emit, nextState,
                     maxPasses = DEFAULT_MAX_SETTLE_PASSES,
                     maxSteps = DEFAULT_MAX_STEPS, maxBeams = DEFAULT_MAX_BEAMS) {
  const emitted = emit(state);
  const sr = settle(grid, baseSources.concat(emitted), maxPasses, maxSteps, maxBeams);
  const state2 = nextState(sr.field, state);
  return { state: state2, settle: sr, field: sr.field };
}

export function run(grid, baseSources, initialState, emit, nextState,
                    maxTicks = DEFAULT_MAX_TICKS, maxPasses = DEFAULT_MAX_SETTLE_PASSES,
                    maxSteps = DEFAULT_MAX_STEPS, maxBeams = DEFAULT_MAX_BEAMS) {
  let state = { ...initialState };
  const seen = new Map([[stateSignature(state), 0]]);
  let worst = "converged";
  let lastField = { colors: new Map(), cells: new Map(), contributions: new Map() };

  for (let t = 1; t <= maxTicks; t++) {
    const sr = step(grid, baseSources, state, emit, nextState, maxPasses, maxSteps, maxBeams);
    lastField = sr.settle.field;
    worst = worseSettle(worst, sr.settle.status);
    const nstate = sr.state;
    const nsig = stateSignature(nstate);
    if (nsig === stateSignature(state)) {
      return { status: "converged", ticks: t, period: 0, field: lastField, state: nstate, combinational: worst };
    }
    if (seen.has(nsig)) {
      return { status: "cycling", ticks: t, period: t - seen.get(nsig), field: lastField, state: nstate, combinational: worst };
    }
    seen.set(nsig, t);
    state = nstate;
  }
  return { status: "cap", ticks: maxTicks, period: 0, field: lastField, state, combinational: worst };
}

// Derive the (ε emit, δ nextState) pair the stepper consumes from every Delay on the
// grid (the real element producing what B5b's fixture stood in for). A delay-free
// grid yields trivial functions (emit→[], nextState→{}) — the combinational stepper.
export function delayIo(grid) {
  const delays = [];
  for (const [k, el] of grid.elements.entries()) {
    if (el.kind === "delay") delays.push({ key: k, cell: cellFromKey(k), dir: el.direction });
  }
  const emit = (state) => {
    const out = [];
    for (const d of delays) {
      const held = state[d.key] || BLACK;
      if (isLit(held)) out.push({ cell: stepDir(d.dir, d.cell), dir: d.dir, color: held });
    }
    return out;
  };
  const nextState = (field, state) => {
    const ns = {};
    for (const d of delays) {
      let arrived = BLACK;
      const contribs = field.contributions.get(d.key);
      if (contribs) {
        const dk = dirKey(d.dir);
        for (const s of contribs) {
          const bar = s.lastIndexOf("|");
          if (s.slice(0, bar) === dk) arrived = arrived | parseInt(s.slice(bar + 1), 10);
        }
      }
      ns[d.key] = arrived;
    }
    return ns;
  };
  return { emit, nextState };
}

// Derive the (ε emit, δ nextState) pair the stepper consumes from every Register on the
// grid (B5d). State is keyed by the register's cell. ε re-emits the held value ONE CELL
// DOWNSTREAM heading the register's data direction (exactly like a Delay). δ reads the
// SETTLED field at the cell and applies the control precedence — RESET → 0, else WRITE →
// data, else HOLD — to compute the next held value (DATA = merge of beams arriving along
// dataDir; WRITE = a lit beam along the write axis; RESET = a lit beam along the reset
// axis, dominant). A register-free grid yields trivial functions. HOLD is the
// internalized delay+feedback: with neither control asserted δ returns the CURRENT held
// value. Built fresh each tick so state == the register cells, no drift (mirrors delayIo).
export function registerIo(grid) {
  const regs = [];
  for (const [k, el] of grid.elements.entries()) {
    if (el.kind === "register") {
      regs.push({
        key: k, cell: cellFromKey(k), dataDir: el.dataDir,
        dataKey: dirKey(el.dataDir), writeAxis: el.writeAxis, resetAxis: el.resetAxis,
      });
    }
  }
  const emit = (state) => {
    const out = [];
    for (const r of regs) {
      const held = state[r.key] || BLACK;
      if (isLit(held)) out.push({ cell: stepDir(r.dataDir, r.cell), dir: r.dataDir, color: held });
    }
    return out;
  };
  const nextState = (field, state) => {
    const ns = {};
    for (const r of regs) {
      const held = state[r.key] || BLACK;
      let resetLit = false, writeLit = false, data = BLACK;
      const contribs = field.contributions.get(r.key);
      if (contribs) {
        for (const s of contribs) {
          const bar = s.lastIndexOf("|");
          const dk = s.slice(0, bar);
          const col = parseInt(s.slice(bar + 1), 10);
          if (r.resetAxis.has(dk) && isLit(col)) resetLit = true;
          if (r.writeAxis.has(dk) && isLit(col)) writeLit = true;
          if (dk === r.dataKey) data = data | col;
        }
      }
      if (resetLit) ns[r.key] = BLACK;        // RESET dominates → clear
      else if (writeLit) ns[r.key] = data;    // SET / write-enable → latch the data input
      else ns[r.key] = held;                  // HOLD → internalized delay+feedback
    }
    return ns;
  };
  return { emit, nextState };
}

// The combined (ε emit, δ nextState) pair over EVERY stateful element on the grid —
// Delays AND Registers — composed so a grid mixing them runs under ONE stepper. State
// keys are disjoint (a Delay's cell vs a Register's cell), so the composition is a clean
// union. Only delays == delayIo; only registers == registerIo; neither == the
// combinational stepper. Future state elements join here. (Mirrors B2 state_io.)
export function stateIo(grid) {
  const d = delayIo(grid);
  const r = registerIo(grid);
  const emit = (state) => d.emit(state).concat(r.emit(state));
  const nextState = (field, state) => {
    const ns = {};
    Object.assign(ns, d.nextState(field, state));
    Object.assign(ns, r.nextState(field, state));
    return ns;
  };
  return { emit, nextState };
}

// Serialize a stepper state ({cellKey: color}) to a sorted [[x,y,z], color] list,
// matching the Python corpus's state serialization (delay cells carry a real 0).
export function stateToList(state) {
  const out = Object.keys(state).map((k) => [cellFromKey(k), state[k]]);
  out.sort((a, b) => { for (let i = 0; i < 3; i++) { if (a[0][i] !== b[0][i]) return a[0][i] - b[0][i]; } return 0; });
  return out;
}

// Build a grid from a corpus scenario ({bounds, elements:[{cell,kind,...}]}).
export function gridFromScenario(scn) {
  const bounds = scn.bounds ? makeBounds(scn.bounds.lo, scn.bounds.hi) : null;
  const grid = makeGrid(bounds);
  for (const e of scn.elements) grid.place(e.cell, elementFromJson(e));
  return grid;
}

// ═════════════════════════════════════════════════════════════════════════════
// B7 — the FIELD-WORLD evolution (ported from b7-field-engine/field_step.py).
//
// The field engine IS the beam engine coarse-grained. coarseGrain (B2/CF-5) keeps
// a HEADING per coarse cell; fieldStep/fieldEvolve advance that directed field by
// the field-NATIVE transport rule (advect along the dominant axis of Ŝ, bend ON
// ARRIVAL at a boundary cell, re-inject sources, merge with the coarse_grain fold).
// The compose-upward diagram  coarseGrain(settle(grid)) == fieldEvolve(seed)  is
// the oracle (conformance/run_b7_conformance.mjs), pinned to the same diagram the
// Python side proves. M12-honest: intensity is a flux COUNT, never a faked float.
// ═════════════════════════════════════════════════════════════════════════════
const _EPS7 = 1e-12;

export function normalizeVec(v) {
  const m = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (m <= _EPS7) return [0, 0, 0];
  return [v[0] / m, v[1] / m, v[2] / m];
}

// A coarse FieldCell carries {cell, heading, intensity, color}; a DirectedField is
// {cells: Map(cellKey -> FieldCell), window}. (cell is stored because JS Map keys
// are strings — fieldStep needs the integer cell to compute neighbours.)
export const isDirected = (fc) => fc.heading.some((h) => Math.abs(h) > _EPS7);

const _coarseCell = (cell, w) => [Math.floor(cell[0] / w), Math.floor(cell[1] / w), Math.floor(cell[2] / w)];

// B2 coarse_grain — LitField -> DirectedField. Ŝ = normalized vector-sum of the
// in-window contribution directions; intensity = flux count; color = OR-merge.
export function coarseGrain(field, window) {
  if (window < 1) throw new Error("window must be >= 1");
  const accVec = new Map(), accFlux = new Map(), accColor = new Map(), ccCell = new Map();
  for (const [k, set] of field.contributions.entries()) {
    if (set.size === 0) continue;
    const cell = field.cells.get(k);
    const cc = _coarseCell(cell, window);
    const ck = cellKey(cc);
    if (!accVec.has(ck)) { accVec.set(ck, [0, 0, 0]); ccCell.set(ck, cc); }
    const v = accVec.get(ck);
    for (const tok of set) {
      const bar = tok.indexOf("|");
      const d = _DIR_BY_KEY.get(tok.slice(0, bar));
      const color = parseInt(tok.slice(bar + 1), 10);
      v[0] += d.dx; v[1] += d.dy; v[2] += d.dz;
      accFlux.set(ck, (accFlux.get(ck) || 0) + 1);
      accColor.set(ck, merge(accColor.get(ck) || BLACK, color));
    }
  }
  const cells = new Map();
  for (const [ck, v] of accVec.entries()) {
    cells.set(ck, {
      cell: ccCell.get(ck),
      heading: normalizeVec([v[0], v[1], v[2]]),
      intensity: accFlux.get(ck) || 0,
      color: accColor.get(ck) || BLACK,
    });
  }
  return { cells, window };
}

// The integer-flux-preserving transport direction: the axis with the largest
// |component|, that component's sign; ties resolve x>y>z; null for a ~zero heading.
// At window=1 Ŝ is axis-unit, so this returns exactly that direction (one march step).
function dominantAxis(h) {
  const ax = Math.abs(h[0]), ay = Math.abs(h[1]), az = Math.abs(h[2]);
  if (ax <= _EPS7 && ay <= _EPS7 && az <= _EPS7) return null;
  if (ax >= ay && ax >= az) return h[0] > 0 ? PX : NX;
  if (ay >= ax && ay >= az) return h[1] > 0 ? PY : NY;
  return h[2] > 0 ? PZ : NZ;
}

// The coarse image of a reflector: the 3x3 signed-permutation matrix with columns
// reflect(+x), reflect(+y), reflect(+z), applied to a heading vector. Exact for
// axis-aligned headings, linear for diagonal (coarse) ones.
export function bendFromReflector(refl) {
  const cols = [PX, PY, PZ].map((d) => {
    const out = refl.reflect(d);
    const nout = refl.reflect(opposite(d));
    if (!(nout.dx === -out.dx && nout.dy === -out.dy && nout.dz === -out.dz)) {
      throw new Error("reflector is not a signed permutation; coarse image not linear");
    }
    return [out.dx, out.dy, out.dz];
  });
  const [cx, cy, cz] = cols;
  return (h) => [
    cx[0] * h[0] + cy[0] * h[1] + cz[0] * h[2],
    cx[1] * h[0] + cy[1] * h[1] + cz[1] * h[2],
    cx[2] * h[0] + cy[2] * h[1] + cz[2] * h[2],
  ];
}

// CoarseStructure: { bends: Map(cellKey -> h=>h), sources: Map(cellKey -> FieldCell),
// bounds: Set(cellKey) | null }.
export function makeCoarseStructure(bends = new Map(), sources = new Map(), bounds = null) {
  return { bends, sources, bounds };
}

// Coarse-grain a set of {cell, dir, color} emitters into per-coarse-cell FieldCells
// (the same fold as coarseGrain; one contribution each).
export function coarseSources(emitters, window) {
  const accVec = new Map(), accFlux = new Map(), accColor = new Map(), ccCell = new Map();
  for (const e of emitters) {
    const cc = _coarseCell(e.cell, window);
    const ck = cellKey(cc);
    if (!accVec.has(ck)) { accVec.set(ck, [0, 0, 0]); ccCell.set(ck, cc); }
    const v = accVec.get(ck);
    v[0] += e.dir.dx; v[1] += e.dir.dy; v[2] += e.dir.dz;
    accFlux.set(ck, (accFlux.get(ck) || 0) + 1);
    accColor.set(ck, merge(accColor.get(ck) || BLACK, e.color));
  }
  const out = new Map();
  for (const [ck, v] of accVec.entries()) {
    out.set(ck, {
      cell: ccCell.get(ck),
      heading: normalizeVec([v[0], v[1], v[2]]),
      intensity: accFlux.get(ck) || 0,
      color: accColor.get(ck) || BLACK,
    });
  }
  return out;
}

// The coarse image of a grid's static structure for fieldEvolve: reflectors ->
// coarse bends, emitters -> coarse re-injected sources, the grid box -> coarse bounds.
export function coarseBoundsFrom(bounds, window) {
  const out = new Set();
  for (let x = bounds.lo[0]; x <= bounds.hi[0]; x++)
    for (let y = bounds.lo[1]; y <= bounds.hi[1]; y++)
      for (let z = bounds.lo[2]; z <= bounds.hi[2]; z++)
        out.add(cellKey(_coarseCell([x, y, z], window)));
  return out;
}

export function coarseStructureFromGrid(grid, sources, window) {
  const bends = new Map();
  for (const [k, el] of grid.elements.entries()) {
    if (el.kind === "reflector") {
      const cell = k.split(",").map(Number);
      bends.set(cellKey(_coarseCell(cell, window)), bendFromReflector(el));
    }
  }
  const srcs = coarseSources(sources, window);
  const bounds = grid.bounds ? coarseBoundsFrom(grid.bounds, window) : null;
  return makeCoarseStructure(bends, srcs, bounds);
}

// fieldStep — ONE transport step. Bend happens ON ARRIVAL at a boundary cell, so
// the cell records + transports the OUTGOING heading (matches the engine: cast
// paints a reflector cell with the post-reflection direction).
export function fieldStep(df, structure) {
  const acc = new Map();  // cellKey -> {cell, vx, vy, vz, flux, color}
  const deposit = (dk, destCell, heading, flux, color) => {
    let s = acc.get(dk);
    if (!s) { s = { cell: destCell, vx: 0, vy: 0, vz: 0, flux: 0, color: BLACK }; acc.set(dk, s); }
    s.vx += heading[0] * flux; s.vy += heading[1] * flux; s.vz += heading[2] * flux;
    s.flux += flux; s.color = merge(s.color, color);
  };
  const arrive = (destCell, heading, flux, color) => {
    const dk = cellKey(destCell);
    const bend = structure.bends.get(dk);
    const h = bend ? normalizeVec(bend(heading)) : heading;
    deposit(dk, destCell, h, flux, color);
  };

  for (const [, fc] of df.cells.entries()) {
    const axis = dominantAxis(fc.heading);
    let dest;
    if (axis === null) {
      dest = fc.cell;
    } else {
      dest = stepDir(axis, fc.cell);
    }
    if (structure.bounds && !structure.bounds.has(cellKey(dest))) continue;  // EXIT
    arrive(dest, fc.heading, fc.intensity, fc.color);
  }
  for (const [k, src] of structure.sources.entries()) {
    if (structure.bounds && !structure.bounds.has(k)) continue;
    arrive(src.cell, src.heading, src.intensity, src.color);
  }

  const cells = new Map();
  for (const [k, s] of acc.entries()) {
    if (s.color === BLACK) continue;
    cells.set(k, {
      cell: s.cell,
      heading: normalizeVec([s.vx, s.vy, s.vz]),
      intensity: s.flux,
      color: s.color,
    });
  }
  return { cells, window: df.window };
}

export const DEFAULT_MAX_FIELD_PASSES = 10000;

function _dfSignature(df) {
  const parts = [];
  for (const [k, fc] of df.cells.entries()) {
    parts.push(`${k}:${fc.heading.map((x) => x.toFixed(9)).join(",")}:${fc.intensity}:${fc.color}`);
  }
  parts.sort();
  return parts.join(";");
}

// fieldEvolve — iterate fieldStep to a coarse fixpoint, with the honest status
// (converged / oscillating / cap), one scale up from settle.
export function fieldEvolve(seed, structure, maxPasses = DEFAULT_MAX_FIELD_PASSES) {
  let field = seed, sig = _dfSignature(field);
  const seen = new Map([[sig, 0]]);
  for (let k = 1; k <= maxPasses; k++) {
    const nxt = fieldStep(field, structure);
    const nsig = _dfSignature(nxt);
    if (nsig === sig) return { field: nxt, status: "converged", passes: k };
    if (seen.has(nsig)) return { field: nxt, status: "oscillating", passes: k };
    seen.set(nsig, k); field = nxt; sig = nsig;
  }
  return { field, status: "cap", passes: maxPasses };
}
