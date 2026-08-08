/* Shea's Forest — the App Shell · shell/honest-badge.js
   The honest-badge grammar (§3f — the load-bearing block).

   This is the FIRST component to consume the declared --badge-* tokens. It is a
   SIBLING of shell/badges.js, not part of it, because the two answer different
   questions on different axes:

     • badges.js  — the calm WEATHER dot: ambient "how is this capability right
       now?" (ok / active / quiet / deep), OFF by default, a preference.
     • THIS       — the honest-badge GRAMMAR: an item's OBLIGATION state (known /
       known-due / overdue / unreachable). Always honest, never a preference —
       a badge either shows a true state or shows it CANNOT REACH the truth.

   The grammar is §3f's THREE states — known (verified true), overdue
   (verified past-due), unreachable (can't reach the truth) — where `known-due`
   is the amber SUB-CASE of known ("verified, needs you today"), not a fourth
   peer. All three verified forms (known / known-due / overdue) are SOLID chips;
   only `unreachable` is the ring. The axis that matters is reached-the-truth
   (solid) vs couldn't (ring) — see H3.

   The one law it exists to obey — H3 (Higgins-hardened, §3f):

     A badge shows a true state, or shows it CANNOT reach the truth — never a
     stale value dressed as a fresh one. `unreachable` therefore carries a
     DISTINCT NON-COLOR FORM: a hollow, dashed ring (transparent FILL). Every
     VERIFIED state (known / known-due / overdue) is a SOLID chip. So with
     labels hidden and color stripped, a stale badge and a clear badge CANNOT
     look alike — the FORM carries the "did it reach the truth?" bit, not the
     color. Tokens alone can't prove that; a rendered component can, and this
     module's test does (honest-badge.test.js, the H3 block).

   HONEST-DEGRADE (Real-or-Made Line): you can never get a "clear" badge out of
   nothing. Any absent / unknown / failed input coerces to `unreachable` — the
   badge SAYS it can't reach the truth — NEVER a silent `known`. coerce() is the
   honesty gate; a naive "unknown -> known" implementation fails the test.

   INK LAW (nothing hardcodes a hex): every color is a var(--badge-*) reference;
   the CSS (styles/shell.css .honest-badge--*) binds the classes to the tokens.
   The H3-critical structural bits (transparent fill, dashed border) are ALSO
   set intrinsically on the node, so the hollow form survives even if the
   stylesheet fails to load — the form is in the node, not only in the CSS.

   THEO'S RULE: never red, never a count. `overdue` is burnt gold; no numbers.

   Plain script (no ES module) — attaches to window.ForestShell.honestBadge.
   Cold-safe: a missing document or a bad input yields a safe value / null,
   never an exception into the boot. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  /* The vocabulary — the ONLY legal states. `unreachable` is the honest-absent
     state, and (deliberately) the coercion target for everything illegal. */
  var STATES = { "known": 1, "known-due": 1, "overdue": 1, "unreachable": 1 };

  /* The four render specs — plain data, DOM-free, the single source of truth for
     both the DOM render and the test's H3 assertions. Each names:
       solid          — is this a VERIFIED state (a solid chip) or not (the ring)?
       form           — "chip" (solid) | "ring" (hollow dashed — the H3 form)
       fillTransparent— H3: only the ring has a transparent fill
       borderStyle    — H3: only the ring is dashed
       *Var           — the token references (Ink Law); never a literal hex
       label / aria   — calm words, never a count; aria always carries the state */
  var SPEC = {
    "known": {
      state: "known", solid: true, form: "chip",
      fillTransparent: false, borderStyle: "none",
      fillVar: "var(--badge-known)", strokeVar: "transparent",
      inkVar: "var(--bark)", label: "clear",
      aria: "clear — verified up to date"
    },
    "known-due": {
      state: "known-due", solid: true, form: "chip",
      fillTransparent: false, borderStyle: "none",
      fillVar: "var(--badge-known-due)", strokeVar: "transparent",
      inkVar: "var(--bark)", label: "due today",
      aria: "due today — verified, needs you today"
    },
    "overdue": {
      state: "overdue", solid: true, form: "chip",
      fillTransparent: false, borderStyle: "none",
      fillVar: "var(--badge-overdue)", strokeVar: "transparent",
      inkVar: "var(--badge-overdue-ink)", label: "overdue",
      aria: "overdue — verified past due"
    },
    "unreachable": {
      state: "unreachable", solid: false, form: "ring",   // <- the H3 form
      fillTransparent: true, borderStyle: "dashed",
      fillVar: "var(--badge-unreachable)",                // transparent by token
      strokeVar: "var(--badge-unreachable-line)",
      inkVar: "var(--badge-unreachable-ink)", label: "unreachable",
      aria: "unreachable — the badge can't reach the truth"
    }
  };

  /* The honesty gate. Any input that is not a legal VERIFIED-or-honest state
     becomes `unreachable`: null, undefined, "", an unknown word, a non-string —
     the badge that can't reach the truth. You CANNOT coerce your way to `known`
     (that would be inventing a clear state out of nothing — Real-or-Made). */
  function coerce(rawState) {
    if (typeof rawState === "string" && Object.prototype.hasOwnProperty.call(STATES, rawState)) {
      return rawState;
    }
    return "unreachable";
  }

  /* The render spec for a state (coerced first). Returns a COPY so a caller can't
     mutate the shared table. Pure, DOM-free — the test reads this for the H3
     structural assertions without needing a document. */
  function specFor(rawState) {
    var s = SPEC[coerce(rawState)];
    return {
      state: s.state, solid: s.solid, form: s.form,
      fillTransparent: s.fillTransparent, borderStyle: s.borderStyle,
      fillVar: s.fillVar, strokeVar: s.strokeVar, inkVar: s.inkVar,
      label: s.label, aria: s.aria
    };
  }

  /* The decidable H3 predicate: is this state (or spec) the hollow, honest-absent
     form? True iff `unreachable`. A host or a monitor can gate on this without
     re-deriving the rule. */
  function isHollow(stateOrSpec) {
    var st = (stateOrSpec && typeof stateOrSpec === "object") ? stateOrSpec.state : stateOrSpec;
    return coerce(st) === "unreachable";
  }

  /* The DOM render. Returns a <span class="honest-badge honest-badge--<state>">.
     The H3-critical structural properties (background transparent, border dashed
     for the ring; opaque chip otherwise) are set INTRINSICALLY as inline style,
     so the hollow form is a property of the NODE — it survives a missing
     stylesheet. data-state / data-form / aria-label carry the honest state for
     tests, hosts, and assistive tech (the state is announced, never color-only).
       opts.label  — override the calm default word (never a count — ignored if
                     it looks like a bare number, Theo's rule).
     Cold-safe: no document -> null; never throws. */
  function render(doc, rawState, opts) {
    if (!doc || typeof doc.createElement !== "function") return null;
    opts = opts || {};
    var spec = specFor(rawState);

    var span = doc.createElement("span");
    span.className = "honest-badge honest-badge--" + spec.state
                     + (spec.solid ? " honest-badge--solid" : " honest-badge--ring");
    span.setAttribute("data-state", spec.state);
    span.setAttribute("data-form", spec.form);        // "chip" | "ring" — the H3 discriminator
    span.setAttribute("aria-label", spec.aria);
    span.setAttribute("role", "img");   // a graphical status indicator (reliably announced),
                                        // NOT role="status" (a live region — would over-announce)

    // Intrinsic H3 form (the whole point) — set on the node, not only via CSS.
    span.style.background = spec.fillVar;             // transparent for the ring (by token)
    span.style.borderStyle = spec.borderStyle;       // "dashed" ONLY for the ring
    span.style.borderColor = spec.strokeVar;
    span.style.color = spec.inkVar;

    // A calm label — never a count (a bare number is rejected, Theo's rule).
    var label = spec.label;
    if (typeof opts.label === "string" && opts.label && !/^\s*\d[\d.,\s]*$/.test(opts.label)) {
      label = opts.label;
    }
    span.textContent = label;
    return span;
  }

  root.honestBadge = {
    STATES: STATES,
    coerce: coerce,
    specFor: specFor,
    isHollow: isHollow,
    render: render,
    _version: "1.0"
  };
})();
