/* render-model.js — the PURE render model of the walking skeleton.
 *
 * NO DOM, NO solving logic. These are the functions index.html uses to turn one
 * verified trace into what the grid + faces show. They live here (not inline in
 * index.html) so a headless Node test (verify-render.cjs) can prove the render
 * is HONEST about elimination steps — the render half's equivalent of the
 * engine's plumb/verify gates. A shipped render behavior leaves a claim.
 *
 * The honesty contract these functions carry (why they exist):
 *   A PLACEMENT step fills one cell with the solved digit and marks it `just`.
 *   An ELIMINATION step fills NOTHING — it places no digit — and instead marks
 *   the cells it pruned FROM (`pruned`) and reports which candidates it removed.
 *   The old inline render read `solution[r][c]` for EVERY step's cell, so an
 *   elimination painted a solved digit into a cell it never resolved, and the
 *   hint line rendered `= null`. These functions make that impossible.
 *
 * Schema (from src/solver.py + src/faces.py):
 *   raw trace step  : { technique, cells_affected:[[r,c],...] (0-indexed),
 *                       candidates_eliminated:[[[r,c],d],...] (0-indexed),
 *                       reason }
 *     PLACEMENT  <=> candidates_eliminated is empty  (_is_placement)
 *   faces teach/hint: { kind:'placement'|'elimination', cell:[r,c]|null
 *                       (1-indexed), digit:int|null, eliminates:[[[r,c],d],...]
 *                       |null (1-indexed), technique, reason }
 */
(function (root) {
  "use strict";

  // givens string -> 9x9 array of ints (0 = blank). Mirrors solver.from_string.
  function parseGivens(s) {
    const g = [];
    for (let r = 0; r < 9; r++) {
      const row = [];
      for (let c = 0; c < 9; c++) {
        const ch = s[r * 9 + c];
        row.push(ch === "." || ch === "0" ? 0 : parseInt(ch, 10));
      }
      g.push(row);
    }
    return g;
  }

  // A raw trace step is a PLACEMENT iff it eliminates no candidates (it places a
  // digit). Mirrors solver._is_placement — the schema-stable discriminator.
  function isPlacement(step) {
    return !(step.candidates_eliminated && step.candidates_eliminated.length);
  }

  // The board at the current step: givens + the placements from the first
  // `step` trace steps. PLACEMENT steps fill the solved digit at their cell;
  // ELIMINATION steps fill NOTHING (they place nothing). The cell markers the
  // grid uses come back too: `justCell` is the placement cell of the LAST step
  // (null on an elimination step), `prunedCells` are the cells the last step
  // pruned from (empty unless the last step is an elimination), `isElimStep`
  // says which kind the cursor is sitting on.
  function boardAtStep(puzzle, step) {
    const board = parseGivens(puzzle.givens);
    const givenMask = board.map((row) => row.map((v) => v !== 0));
    const trace = (puzzle.result && puzzle.result.trace) || [];
    const solution = puzzle.result && puzzle.result.solution;
    let justCell = null;
    let prunedCells = [];
    let isElimStep = false;

    for (let k = 0; k < step && k < trace.length; k++) {
      const t = trace[k];
      const last = k === step - 1;
      if (isPlacement(t)) {
        const cell = t.cells_affected && t.cells_affected[0];
        if (!cell) continue;
        const [r, c] = cell;
        // solved-unique traces carry a solution; ceiling-hit/broken have no
        // placements anyway, so the guard is belt-and-suspenders.
        board[r][c] = solution ? solution[r][c] : board[r][c];
        if (last) {
          justCell = [r, c];
          prunedCells = [];
          isElimStep = false;
        }
      } else if (last) {
        // elimination step at the cursor: place NOTHING; mark the pruned cells.
        justCell = null;
        isElimStep = true;
        prunedCells = (t.cells_affected || []).map(([r, c]) => [r, c]);
      }
    }
    return { board, givenMask, justCell, prunedCells, isElimStep };
  }

  // Format a faces step's eliminates ([[[r,c],d],...], 1-indexed) as a compact
  // human line: "-3 r2c7, -3 r2c8, -3 r2c9". Empty/null -> "".
  function fmtElims(eliminates) {
    if (!eliminates || !eliminates.length) return "";
    return eliminates
      .map((e) => {
        const [[r, c], d] = e;
        return `\u2212${d} r${r}c${c}`;
      })
      .join(", ");
  }

  // The "(...)" suffix for a faces teach/hint step, HONEST about its kind:
  //   placement  -> "r2c7 = 5"
  //   elimination-> "eliminates -3 r2c7, -3 r2c8, -3 r2c9"
  // Never "= null" on an elimination (the bug this exists to kill).
  function moveSuffix(faceStep) {
    if (!faceStep) return "";
    if (faceStep.kind === "elimination") {
      const e = fmtElims(faceStep.eliminates);
      return e ? `eliminates ${e}` : "eliminates (candidates pruned)";
    }
    // placement (or legacy step with a cell+digit)
    if (faceStep.cell && faceStep.digit != null) {
      return `r${faceStep.cell[0]}c${faceStep.cell[1]} = ${faceStep.digit}`;
    }
    return "";
  }

  // The honest-badge state (SWX-F6 — the Forest honest-badge grammar mapped to
  // the puzzle's THREE real, already-computed terminal states). Form carries the
  // state; a fabricated "success" green is forbidden (the Real-or-Made Line /
  // DP-006 §3f). The LAW this encodes, and what verify-render asserts:
  //   * ONLY solved-unique earns tone `known` (the clear/attested state). A
  //     ceiling-hit or a broken board NEVER renders as clear — no fake green.
  //   * ceiling-hit carries NO FILL (`form: "dashed"`): the FORM says
  //     "beyond the reach of the V1 ladder", it does not paint a result it
  //     does not have.
  //   * no tone is an alarm/red word — the vocabulary is calm (Theo's rule).
  // tone -> the tokens.css --badge-* var the chip reads; form -> fill|dashed.
  function badgeFor(status) {
    switch (status) {
      case "solved-unique":
        return { label: "solved", tone: "known", form: "fill" };
      case "ceiling-hit":
        // reachable by SOME method, not by the V1 ladder — honest about the gap.
        return { label: "beyond the V1 ladder", tone: "unreachable", form: "dashed" };
      case "broken":
        // not a proper puzzle (a cell with zero candidates) — heavy, never red.
        return { label: "not a proper puzzle", tone: "overdue", form: "fill" };
      default:
        // an unknown status invents no signal — a bare, un-toned chip.
        return { label: String(status || "\u2014"), tone: "quiet", form: "fill" };
    }
  }

  const api = { parseGivens, isPlacement, boardAtStep, fmtElims, moveSuffix, badgeFor };

  // UMD-ish: browser global for index.html, module export for Node tests.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.RenderModel = api;
  }
})(typeof window !== "undefined" ? window : this);
