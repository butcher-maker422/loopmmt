// Jamie's Garden — climb.js  [The Garden Climb · §2 of the build plan: the progression
// schedule. PURE: no DOM, no sim, no rng, no I/O. This is the SINGLE SOURCE of the
// stage->level math; verify-progression.cjs proof-gates it directly (the proof tests THIS
// code, never a copy). index.html loads it and uses it as thin orchestration glue.
// sim.js is sealed and untouched — the progression rides its public surface (createGame opts
// + the loop's tick cadence), nothing more.]
//
// THE MODEL (resolved by RCR , "The Garden Climb"):
//   A run is a bounded climb of clear-the-bed stages. The player picks a starting bed
//   (density D0, speed S0) at the menu; that seeds stage 1. Each cleared bed advances the
//   garden one stage denser and — gently — one notch faster, until the garden has "come in
//   fully" (density at its flower cap AND speed maxed): the summit, end-of-run.
//
//   The system moves exactly ONE scalar (the stage index k); the player FEELS two surfaces
//   change (density + speed). Density leads (+1 level/stage, Dr. Mario's increment), speed
//   follows gently (+1 level every 3 stages) — the gentle bias for Jamie, the beginner whose
//   play degrades on overshoot. Every number here is a tunable dial (calibrate WITH her).
'use strict';
(function () {
  // Mirror index.html's dial bounds + the flowersFor cap. (Kept in sync by intent; the
  // browser-load proof + verify-progression assert the live values agree with these.)
  const DENSITY_LEVELS = 24;   // #dens dial max
  const SPEED_LEVELS   = 5;    // #spd  dial max
  const VIRUS_CAP      = 84;   // flowersFor(level) = min(84, level*4) caps here

  // The density LEVEL at which the flower count maxes: flowersFor(L) = min(84, L*4) hits 84
  // at L = 21. PAST this level, a higher density-level seeds the SAME flower count — so the
  // garden looks no fuller. Density has therefore "come in" at this level; beyond it only
  // speed can still make the garden feel like it's closing in.
  const DENSITY_CAP_LEVEL = Math.ceil(VIRUS_CAP / 4);   // 21

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // A run: { stage (k, 1-based), startDensity (1..24), startSpeed (1..5) }.
  // The two starts are the player's menu picks; they seed stage 1.
  function newRun(startDensity, startSpeed) {
    return {
      stage: 1,
      startDensity: clamp(startDensity | 0, 1, DENSITY_LEVELS),
      startSpeed:   clamp(startSpeed   | 0, 1, SPEED_LEVELS),
    };
  }

  // Density LEADS: +1 level per stage, capped at the dial max.
  // (= +4 flowers/stage via flowersFor until the cap — Dr. Mario's increment, but OUR scalar
  //  drives it and the player chose the start.)
  function densityLevelForStage(run) {
    return Math.min(DENSITY_LEVELS, run.startDensity + (run.stage - 1));
  }

  // Speed FOLLOWS gently: +1 level every 3 stages, capped at the dial max. Speed creeps while
  // density leads — the gentle bias (M-delta: overshoot degrades Jamie's play).
  function speedLevelForStage(run) {
    return Math.min(SPEED_LEVELS, run.startSpeed + Math.floor((run.stage - 1) / 3));
  }

  // The summit: the garden has come in fully — density at its flower cap AND speed maxed.
  // Clearing a bed that is already at the summit ends the run (there is nowhere denser or
  // faster to climb). Checked on the bed just cleared.
  function atSummit(run) {
    return densityLevelForStage(run) >= DENSITY_CAP_LEVEL
        && speedLevelForStage(run)   >= SPEED_LEVELS;
  }

  // Pure successor: the next bed up the climb. Identity-preserving (D0,S0 carried).
  function nextStage(run) {
    return { stage: run.stage + 1, startDensity: run.startDensity, startSpeed: run.startSpeed };
  }

  // The win resolution — the whole §2 decision, pure and node-testable: clearing a bed either
  // SUMMITS (end of run) or ADVANCES to the next bed. index.html's endGame win-branch is thin
  // glue over this: { action:'summit' } -> the over-screen as a summit win; { action:'advance',
  // run } -> reseed at the new bed and play.
  function resolveWin(run) {
    return atSummit(run)
      ? { action: 'summit' }
      : { action: 'advance', run: nextStage(run) };
  }

  const API = {
    DENSITY_LEVELS, SPEED_LEVELS, VIRUS_CAP, DENSITY_CAP_LEVEL,
    newRun, densityLevelForStage, speedLevelForStage, atSummit, nextStage, resolveWin,
  };

  // Dual-environment export (mirrors sim.js): CommonJS for the node proofs, window.Climb for
  // the browser bundle. The IIFE keeps every const above private — no collision with the other
  // <script>s under the browser's shared scope (the browser-load proof guards this).
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.Climb = API;
})();
