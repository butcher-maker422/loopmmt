/* Shea's Forest — the App Shell · shell/the-chaos.js
   CHAOS — Delight #7 of the Seven Delights, the LAST (V6 · JT-7 · JP-5: bounded).
   Auto-covered by delight-egress-guard.test.js (SC-7); unit test the-chaos.test.js.

   THE MOMENT. A machine stamps every mark identically; a hand never does. The
   seven delights, rendered pixel-for-pixel identical every single time, read as
   exactly what they are — a machine. Chaos is the smallest possible dose of the
   hand: a static, bounded micro-variance on the DECORATIVE marks the other six
   delights already draw, so the render feels alive without ever looking broken.

   THE SHAPE (re-judged, now that Two Rivers is done). Chaos is NOT a
   module that draws its own mark — it has no mark of its own. It is the ONE
   delight that touches all seven renders (recipe), so it is a THIN CROSS-CUTTING
   MODIFIER: one variance parameter (JP-5) that the shared render primitives opt
   into. `completion-settle` (the Clearing / the Rest / the Broom) and the other
   delights call `chaos.applyMark(markNode, key)` right after building a decorative
   mark; Chaos perturbs that mark by a hair. Absent (cold), the mark is drawn at
   base — mechanical, but correct.

   THE FOUR LAWS IT IS DRAWN UNDER (feature-set plan v6, carried verbatim):

     JP-5 (bounded) — `0 < H(render) < H_GLITCH`. Below the floor -> mechanical
       (dead). Above H_GLITCH -> reads as MALFUNCTION (a Real-or-Made break: a
       tilted mark that looks like a CSS bug is a lie about the render being ok).
       The band is the whole delight, so the ceiling is a HARD CLAMP here, not a
       caller's choice: `markTransform` can never emit past the clamp, so no wire
       can turn Chaos into a glitch (BOUND_STRUCTURAL).

     SC-6 (render-local seed only — the covert-channel floor) — the variance is
       keyed ONLY on a render-local seed (a per-page-load random) plus a POSITIONAL
       key (a structural label like "settle:view", never message content). There
       is NO user-data parameter anywhere in this module's surface, so the variance
       carries ZERO BITS ABOUT JAMIE — a covert channel is UN-REACHABLE, not merely
       un-used (the exact SC-1/SC-4 discipline: the unsafe input is not a parameter).
       `key` is a positional/structural string by contract; it is hashed with the
       seed, and the seed dominates. No sender, no subject, no count, no read-state
       ever reaches the seed.

     Constraint 2 (calm, not casino — inherited from completion-settle) — the
       variance is STATIC. It is a fixed transform set ONCE at render, never an
       animation, never a payout, never confetti. A hand-stamped mark sits a hair
       off; it does not move. `prefers-reduced-motion` -> H collapses to 0 (the
       respectful floor: a user who asked for stillness gets the mechanical mark).

     SC-7 (the egress floor) — zero network. Pure hash + DOM style. Auto-covered
       by the derived egress guard over the whole delight layer.

   HIGGINS. The variance touches only aria-hidden decorative marks; it carries no
   meaning, so with every word stripped the render still reads the same. Chaos is
   texture, never signal — it never becomes something a reader must decode.

   Plain script (no ES module, no deps) — attaches to window.ForestShell.chaos.
   Cold-safe: no document / bad input -> the base mark, never an exception into the
   boot. Depends on nothing (block.el is not required — Chaos styles nodes others
   built; it never builds a mark itself). */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  /* ---- the bound (JP-5) -----------------------------------------------------
     H_GLITCH is the malfunction threshold PER CHANNEL — past it a decorative mark
     reads as a layout bug. H is the delight's amplitude, held a comfortable margin
     below the ceiling: 0 < H < H_GLITCH by construction. These are the only knobs,
     and they are constants — a caller cannot widen them (BOUND_STRUCTURAL). */
  var H_GLITCH = {
    rot: 6.0,   // deg — a mark tilted 6deg+ looks broken
    tx: 3.0,    // px  — a mark shoved 3px+ looks misaligned
    ty: 3.0     // px
  };
  var H = {
    rot: 1.5,   // deg — 0 < 1.5 < 6 : alive, never broken
    tx: 0.75,   // px  — 0 < 0.75 < 3
    ty: 0.75    // px
  };

  /* ---- the render-local seed (SC-6) -----------------------------------------
     ONE seed per page load, drawn from the platform RNG (or a time fallback in a
     bare environment). It is render-local: it is NOT derived from any message,
     account, count, or read-state, so nothing about the user's data can ride it.
     Cached so a single page's renders are mutually consistent; reseed() draws a
     fresh one (a new page load, or a test). */
  var _seed = null;

  function _draw() {
    // Prefer crypto for a clean uniform draw; fall back to Math.random, then time.
    try {
      if (typeof crypto !== "undefined" && crypto && typeof crypto.getRandomValues === "function") {
        var a = new Uint32Array(2);
        crypto.getRandomValues(a);
        return (a[0] * 4294967296 + a[1]);
      }
    } catch (e) { /* fall through */ }
    var r = (typeof Math !== "undefined" && Math.random) ? Math.random() : 0.5;
    var t = (typeof Date !== "undefined" && Date.now) ? Date.now() : 0;
    return Math.floor(r * 4294967296) ^ t;
  }

  function seed() {
    if (_seed === null) _seed = _draw();
    return _seed;
  }
  function reseed() {
    _seed = _draw();
    return _seed;
  }

  /* ---- the deterministic mixer ----------------------------------------------
     A tiny FNV-1a-style string hash of `seed:key` -> a stable number, then folded
     to a float in [0,1). Deterministic per (seed, key): a mark's tilt is stable
     within a render (never flickers) and identical for the same structural key,
     but differs across page loads (a fresh seed) and across positions (distinct
     keys). `key` is coerced to a string; a non-string / user-shaped key still only
     hashes to a bounded number — it can leak nothing because the OUTPUT is a
     bounded geometric nudge, not a channel. */
  function _hash01(key) {
    var s = String(seed()) + ":" + String(key == null ? "" : key);
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    // fold to [0,1)
    return (h >>> 0) / 4294967296;
  }

  /* map a [0,1) draw to a signed amplitude in [-amp, +amp] (two independent draws
     off the same key by salting, so rot / tx / ty do not correlate) */
  function _signed(key, salt, amp) {
    var u = _hash01(String(key) + "#" + salt);
    return (u * 2 - 1) * amp;   // [-amp, +amp]
  }

  /* prefers-reduced-motion -> the respectful floor (H = 0). Cold-safe: no
     matchMedia -> treated as NOT reduced (the delight is on by default). */
  function _reduced() {
    try {
      if (typeof window !== "undefined" && window.matchMedia) {
        var mq = window.matchMedia("(prefers-reduced-motion: reduce)");
        return !!(mq && mq.matches);
      }
    } catch (e) { /* fall through */ }
    return false;
  }

  /* ---- the public variance --------------------------------------------------
     amounts(key) — the raw signed nudges { rot, tx, ty }, each hard-clamped to
       ITS channel amplitude H (so |rot| <= H.rot < H_GLITCH.rot, etc). Under
       reduced-motion, all zero (the mechanical floor). Pure; no DOM. */
  function _clamp(v, amp) { return v < -amp ? -amp : (v > amp ? amp : v); }

  function amounts(key) {
    if (_reduced()) return { rot: 0, tx: 0, ty: 0 };
    return {
      rot: _clamp(_signed(key, "rot", H.rot), H.rot),
      tx: _clamp(_signed(key, "tx", H.tx), H.tx),
      ty: _clamp(_signed(key, "ty", H.ty), H.ty)
    };
  }

  /* markTransform(key) — the STATIC CSS transform string for a decorative mark,
     bounded by construction. "" when the variance is the floor (reduced-motion),
     so the mark keeps whatever transform the stylesheet gave it. No animation,
     no transition — a fixed pose (Constraint 2). */
  function markTransform(key) {
    var a = amounts(key);
    if (a.rot === 0 && a.tx === 0 && a.ty === 0) return "";
    // round to a hair of precision — enough to vary, not enough to jitter the DOM
    var r = Math.round(a.rot * 100) / 100;
    var x = Math.round(a.tx * 100) / 100;
    var y = Math.round(a.ty * 100) / 100;
    return "rotate(" + r + "deg) translate(" + x + "px, " + y + "px)";
  }

  /* applyMark(node, key) — set the static transform on a decorative mark NODE the
     caller already built. The ONE host affordance the delights call. Cold-safe:
     no node / no style -> returns the node untouched, never throws. Idempotent
     for a given (seed, key). Returns the node for chaining. */
  function applyMark(node, key) {
    if (!node || !node.style) return node;
    var t = markTransform(key);
    if (t) {
      // set only the transform; never a transition (static, Constraint 2)
      node.style.transform = t;
      node.style.transformOrigin = "center";
      if (node.setAttribute) node.setAttribute("data-chaos", "1");
    }
    return node;
  }

  /* ---- export --------------------------------------------------------------- */
  root.chaos = {
    H_GLITCH: H_GLITCH,   // the malfunction ceilings (inspection / tests)
    H: H,                 // the delight amplitudes (0 < H < H_GLITCH per channel)
    seed: seed,
    reseed: reseed,
    amounts: amounts,     // pure signed nudges, clamped, DOM-free
    markTransform: markTransform,
    applyMark: applyMark,
    _version: "1.0"
  };
})();
