/* Shea's Forest — the App Shell · shell/sanctum.js
   THE CONSENT GATE — email-app Track B (the "Consent Cluster" · client half of the ONE re-consent).

   NOT the server Sanctum. This is the CLIENT consent-gate that lives on window.ForestShell.sanctum. The
   secrets store + the D2 Warrant link gate are server-side (forest/sanctum/{sanctum,oauth-link-gate}.js) and
   are the ONLY holders of the token value (K1). This file holds no secret, talks to no IdP, and mints no
   grant of its own — it READS the active grant's scopes (GET /connectors), decides whether a settings
   feature needs a scope-widen, builds the operator-facing consent surface, and — only on the operator's act
   — POSTs the widen to /grant (which the server gate turns into the S2 Operator-Authority re-HALT).

   WHY ONE RE-CONSENT UNLOCKS A CLUSTER. Three Track-B features want mail-SETTINGS management:
     · #27 filters/rules            -> users.settings.filters.*    -> gmail.settings.basic
     · #28 send-as / aliases        -> users.settings.sendAs.*     -> gmail.settings.basic
     · #28 vacation responder       -> users.settings.updateVacation -> gmail.settings.basic
   All three ride ONE scope (gmail.settings.basic), so ONE re-consent covers the family. #18 drafts is NOT
   in the cluster — users.drafts.* is gmail.modify-scoped, ALREADY granted (leg 07), so drafts need NO
   re-consent (needsReconsent('drafts', ...) is false by construction).

   THE S2 MOMENT. gmail.settings.basic is absent from the current grant (readonly + send + modify + identity).
   Adding it is a scope-WIDEN on the ACTIVE Gmail grant, which the server gate (oauth-link-gate.requestWiden)
   HALTS for the human (S2 Operator-Authority). That single bless IS the consent gate for the whole cluster;
   the per-operation settings writes then ride the granted scope non-gated (the 'settings' Warrant action,
   like 'send'/'modify'/'label'). This module's job is to make that one moment HONEST and LEGIBLE: the S3
   observation surface (what the new scope grants, what it never does, the scope delta) before the widen.

   HONEST — flag-don't-fake. consentStatement states plainly what gmail.settings.basic grants (manage
   filters, aliases, vacation) and what it NEVER grants (no reading new data classes, no deleting/trashing
   mail — there is no gmail.delete scope; K1 holds). It never over-claims: settings.basic (not .sharing) is
   the least-privilege pick and does not touch domain-wide delegation. A failed/denied widen surfaces the
   server's real reason, never a fabricated "Granted".

   SEPARATION. The deciders + builders are PURE (grant/feature in -> plain object out; no I/O, no model, no
   network). The seam (makeWidenFn) is the only I/O and drops nothing of its own — the account + current
   scopes come from the host read; the token never touches the client (K1 at the server). Read-only on the
   mail model: this file self-registers on window.ForestShell.sanctum and touches no parity-twin, no
   renderer export.

   Plain script (no ES module, no deps) — attaches to window.ForestShell.sanctum.
   Cold-safe throughout: null / undefined / ill-typed in -> honest { ok:false, error } | safe default out,
   never throws. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  // The ONE scope the whole Consent Cluster rides. Least-privilege: .basic, not .sharing.
  var SETTINGS_SCOPE = "gmail.settings.basic";

  // Feature -> the scope it needs. The cluster (#27/#28) needs SETTINGS_SCOPE; #18 drafts rides the
  // ALREADY-granted gmail.modify, so it is listed with its own scope and is never a re-consent trigger.
  // A feature not in this map is treated as "no re-consent" (unknown -> conservative allow, never a
  // fabricated gate). Keys are the stable feature ids the panels pass in.
  var FEATURE_SCOPE = {
    filters: SETTINGS_SCOPE,     // #27 filters/rules
    sendas: SETTINGS_SCOPE,      // #28 send-as / aliases
    vacation: SETTINGS_SCOPE,    // #28 vacation responder
    drafts: "gmail.modify",      // #18 drafts — already granted, NOT a cluster member
  };

  // Plain-language, per-cluster statement of what the settings scope unlocks. Used by consentStatement so
  // the operator sees WHICH capability the one grant buys — not a bare scope string.
  var CLUSTER_UNLOCKS = [
    "create and manage your Gmail filters and rules",
    "manage your send-as addresses and aliases",
    "set your vacation / auto-reply responder",
  ];

  // scopesOf(grant) — the scope array of an active grant row (GET /connectors shape: { provider, account,
  // scope, mode } where scope is a string[] like ['gmail.readonly','gmail.send',...]). Cold-safe: a missing
  // or ill-typed grant yields []. Never throws.
  function scopesOf(grant) {
    if (!grant || typeof grant !== "object") return [];
    var s = grant.scope;
    if (Array.isArray(s)) return s.filter(function (x) { return typeof x === "string"; });
    if (typeof s === "string" && s.trim() !== "") return [s.trim()];
    return [];
  }

  // hasScope(grant, scope) — does the active grant carry `scope`? Cold-safe + total.
  function hasScope(grant, scope) {
    if (typeof scope !== "string" || scope === "") return false;
    return scopesOf(grant).indexOf(scope) !== -1;
  }

  // hasSettingsScope(grant) — does the active grant already carry gmail.settings.basic? If so, the cluster
  // is already unlocked and NO re-consent is needed (idempotent: a second widen must not re-HALT once held).
  function hasSettingsScope(grant) {
    return hasScope(grant, SETTINGS_SCOPE);
  }

  // needsReconsent(feature, grant) -> boolean. TRUE only when the feature needs the SETTINGS_SCOPE and the
  // active grant lacks it — this gate is specifically the cluster's ONE settings re-consent, nothing else.
  // A feature needing only the base gmail.modify (#18 drafts) is ALWAYS FALSE: a missing base scope is a
  // "not linked yet" condition handled by the base link flow, not this re-consent gate — so drafts never
  // trips it, even against a null (unlinked) grant. An unknown feature is FALSE (conservative: never
  // fabricate a consent gate for a capability we don't map). Cold-safe + total.
  function needsReconsent(feature, grant) {
    var need = FEATURE_SCOPE[String(feature)];
    if (need !== SETTINGS_SCOPE) return false;   // only the settings gap is a re-consent (base scopes -> link flow)
    return !hasScope(grant, SETTINGS_SCOPE);      // missing the settings scope -> re-consent required
  }

  // consentStatement(grant) -> the S3 observation surface for the ONE cluster re-consent. Pure. It does not
  // decide WHETHER to show (needsReconsent does) — it describes the crossing so the operator can bless it:
  //   { scope, unlocks[], grants, neverDoes, delta:{ from[], added[], to[] }, alreadyGranted }
  // `grant` is the current active gmail grant row (or null on a fresh link). Cold-safe.
  function consentStatement(grant) {
    var from = scopesOf(grant);
    var already = from.indexOf(SETTINGS_SCOPE) !== -1;
    var added = already ? [] : [SETTINGS_SCOPE];
    var to = already ? from.slice() : from.concat([SETTINGS_SCOPE]);
    return {
      scope: SETTINGS_SCOPE,
      unlocks: CLUSTER_UNLOCKS.slice(),
      grants: "Forest asks Gmail for one more permission — manage your mail settings — so it can " +
        CLUSTER_UNLOCKS.join(", ") + ". You approve this once; the three features then work without asking again.",
      // The honest floor: name what the scope does NOT do, so the grant is never read as more than it is.
      neverDoes: "It does NOT let Forest read new kinds of data, and it does NOT let Forest delete or trash " +
        "any mail — there is no delete permission, ever. Adding a send-as address still needs Gmail's own " +
        "verification email; Forest cannot silently create one.",
      delta: { from: from, added: added, to: to },
      alreadyGranted: already,               // true -> the cluster is unlocked; no widen needed
    };
  }

  // buildWiden({ account, grant }) -> { ok:true, body } | { ok:false, error }. Builds the /grant widen
  // request (the client half): the SAME provider/account with the widened scope set. At the server gate
  // this is a scope-widen on the active grant -> the S2 re-HALT the operator blesses. PURE — no I/O. Refuses
  // a missing account (honest, never a POST that the server would bounce). Idempotent: if the grant already
  // holds settings.basic, returns { ok:false, error:'already-granted' } so the caller shows nothing rather
  // than firing a no-op widen.
  function buildWiden(spec) {
    if (!spec || typeof spec !== "object") return { ok: false, error: "buildWiden: spec must be an object" };
    var account = typeof spec.account === "string" ? spec.account.trim() : "";
    if (account === "") return { ok: false, error: "buildWiden: an account (the Gmail identity) is required" };
    var grant = spec.grant || null;
    if (hasSettingsScope(grant)) return { ok: false, error: "already-granted: gmail.settings.basic is active — no re-consent needed" };
    var scope = scopesOf(grant);
    if (scope.indexOf(SETTINGS_SCOPE) === -1) scope = scope.concat([SETTINGS_SCOPE]);
    // A fresh grant with no prior scopes still declares the full cluster + identity floor so the server sees
    // a complete, closed enumeration (never a wildcard). If the host had no scopes read, seed the known set.
    if (scope.length === 1) scope = ["gmail.readonly", "gmail.send", "gmail.modify", SETTINGS_SCOPE, "identity.email"];
    return { ok: true, body: { provider: "gmail", account: account, scope: scope } };
  }

  // makeWidenFn(fetchFn, RT) -> async ({ account, grant }) => { ok, halt?, error?, status? }. The ONLY I/O.
  // POSTs the widen to /grant (mirrors the renderer's link mint). On the server this returns the S2 HALT
  // (accepted-pending, the operator blesses at /authority/resolve) — surfaced as { ok:true, halt } — or a
  // typed-loud failure surfaced as { ok:false, error, status }. NEVER throws; a network fault is honest, not
  // a fabricated success. Read-only on everything but the one POST.
  function makeWidenFn(fetchFn, RT) {
    var base = RT || "";
    return function widen(spec) {
      var built = buildWiden(spec);
      if (!built.ok) return Promise.resolve({ ok: false, error: built.error });
      return Promise.resolve()
        .then(function () {
          return fetchFn(base + "/grant", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(built.body),
          });
        })
        .then(function (resp) {
          var status = resp && typeof resp.status === "number" ? resp.status : 0;
          var pj = resp && typeof resp.json === "function" ? resp.json() : Promise.resolve(null);
          return Promise.resolve(pj).then(function (data) {
            // 202 = accepted-pending: the S2 HALT was born; the operator blesses it. 200 = applied (rare —
            // if the server auto-blessed in a test seam). Anything else is a typed-loud failure.
            if (status === 202 || status === 200) {
              return { ok: true, halt: (data && (data.halt || data.observation || data)) || null, status: status };
            }
            var err = (data && (data.error || data.reason)) || ("re-consent failed (HTTP " + status + ")");
            return { ok: false, error: err, status: status };
          });
        })
        .catch(function (e) {
          return { ok: false, error: (e && e.message) || "re-consent request failed", status: 0 };
        });
    };
  }

  root.sanctum = {
    SETTINGS_SCOPE: SETTINGS_SCOPE,
    FEATURE_SCOPE: FEATURE_SCOPE,
    scopesOf: scopesOf,
    hasScope: hasScope,
    hasSettingsScope: hasSettingsScope,
    needsReconsent: needsReconsent,
    consentStatement: consentStatement,
    buildWiden: buildWiden,
    makeWidenFn: makeWidenFn,
  };
})();
