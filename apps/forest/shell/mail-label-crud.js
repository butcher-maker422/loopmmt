/* Shea's Forest — the App Shell · shell/mail-label-crud.js
   LABEL CRUD — email-app #06 (the email-deepen line · label create / rename / color).

   THE AFFORDANCE. The client half of #06: build the validated /intent/label request for a label
   CREATE (a new user label, with an optional color) or a PATCH (rename and/or recolor an existing
   label), and POST it to the runtime's label seam. It is the manage-bar label picker's create/rename/
   color companion — the picker (leg 13) already applies existing labels; this lets the owner MAKE and
   RESHAPE them without leaving Forest.

   WHY THIS LINE OWNS IT. #06 is data-layer work: a new connector verb (users.labels.create/.patch), a
   runtime route (/intent/label), and this client seam — all in email-deepen's surface. The label picker
   lives in the manage bar (detailView), which the joint contract assigns to email-deepen, so the
   create/rename/color affordance ON that picker is this line's to wire (not a reach-across).

   NO RE-CONSENT. users.labels.* is gmail.modify-scoped — the SAME grant the picker's apply/move already
   uses. The runtime's 'label' Warrant action is non-gated for exactly that reason, so a label create/
   rename rides the existing gmail grant with no new consent (verified at the runtime + warrant layers).

   HONEST — flag-don't-fake. The builders validate the SHAPE the source verb requires (a non-empty name
   within Gmail's ceiling; a color that is the { textColor, backgroundColor } pair with both non-empty
   strings) and refuse a bad spec BEFORE any POST — the same typed-loud refusal the connector makes, moved
   one layer earlier for a clean UX. The color PALETTE is Gmail's authority: an off-palette hex passes the
   shape check here and is left for Gmail to reject (surfaced as the server's real error), never faked as
   applied. A denied/failed create surfaces the runtime's real reason, never a fabricated "Done".

   SEPARATION. The builders are PURE (spec in -> { ok, body } | { ok:false, error } out; no I/O, no model,
   no network). The seam is the only I/O, and it drops nothing of its own — the grant + account come from
   the host, the token never touches the client (K1 holds at the runtime). Read-only on the model: this
   file self-registers on window.ForestShell and touches no parity-twin, no renderer export.

   Plain script (no ES module, no deps) — attaches to window.ForestShell.mailLabelCrud.
   Cold-safe throughout: null / undefined / ill-typed in -> honest { ok:false, error } out, never throws. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  var MAX_LABEL_NAME_BYTES = 225;   // Gmail's own users.labels name ceiling (matches the source verb)

  // byteLen(s) — UTF-8 byte length without Buffer (browser-safe). Mirrors the source's Buffer.byteLength.
  function byteLen(s) {
    if (typeof s !== "string") return 0;
    if (typeof TextEncoder === "function") return new TextEncoder().encode(s).length;
    return unescape(encodeURIComponent(s)).length;   // fallback: UTF-8 bytes without TextEncoder
  }

  // okColor(c) — the label color SHAPE guard: { textColor, backgroundColor } both non-empty strings.
  // Palette is Gmail's authority (an off-palette hex passes here, rejected server-side). Pure + total.
  function okColor(c) {
    return !!c && typeof c === "object"
      && typeof c.textColor === "string" && c.textColor.trim() !== ""
      && typeof c.backgroundColor === "string" && c.backgroundColor.trim() !== "";
  }

  // buildCreate(spec) -> { ok:true, body } | { ok:false, error }. `spec` is { name, color? }. Validates
  // the name (non-empty, within the byte ceiling) and, if present, the color shape — a bad spec is a
  // clean { ok:false, error } (the client refusal), never a thrown exception and never a bad POST.
  function buildCreate(spec) {
    var s = spec || {};
    var name = typeof s.name === "string" ? s.name.trim() : "";
    if (!name) return { ok: false, error: "a label needs a name" };
    if (byteLen(name) > MAX_LABEL_NAME_BYTES) return { ok: false, error: "that label name is too long" };
    if (s.color !== undefined && !okColor(s.color)) return { ok: false, error: "a color needs both a text and a background color" };
    var body = { op: "create", name: name };
    if (s.color !== undefined) body.color = { textColor: s.color.textColor, backgroundColor: s.color.backgroundColor };
    return { ok: true, body: body };
  }

  // buildPatch(id, patch) -> { ok:true, body } | { ok:false, error }. `patch` is { name?, color? } — at
  // least one must be present (an empty patch is a client refusal, never a silent no-op POST). A partial
  // update: only the fields present ride the body, so a rename never disturbs the color and vice versa.
  function buildPatch(id, patch) {
    var lid = typeof id === "string" ? id.trim() : "";
    if (!lid) return { ok: false, error: "which label? (no id)" };
    var p = patch || {};
    var hasName = p.name !== undefined;
    var hasColor = p.color !== undefined;
    if (!hasName && !hasColor) return { ok: false, error: "nothing to change (give a new name or color)" };
    var body = { op: "patch", id: lid };
    if (hasName) {
      var name = typeof p.name === "string" ? p.name.trim() : "";
      if (!name) return { ok: false, error: "a label needs a name" };
      if (byteLen(name) > MAX_LABEL_NAME_BYTES) return { ok: false, error: "that label name is too long" };
      body.name = name;
    }
    if (hasColor) {
      if (!okColor(p.color)) return { ok: false, error: "a color needs both a text and a background color" };
      body.color = { textColor: p.color.textColor, backgroundColor: p.color.backgroundColor };
    }
    return { ok: true, body: body };
  }

  // makeLabelFn(cfg) -> function(payload) -> Promise<{ ok, label?, error? }>. The client seam. `payload`
  // is { op:'create', name, color? } or { op:'patch', id, name?, color? } — it re-runs the matching
  // builder (so a caller that skips the builder still can't POST a bad spec), attaches the resolved gmail
  // grant + account, and POSTs to /intent/label. Mirrors makeModifyFn exactly: resolves an object, never
  // throws; a denied/failed op surfaces the runtime's real reason; offline -> honest, never a fake apply.
  function makeLabelFn(cfg) {
    cfg = cfg || {};
    var runtimeBase = typeof cfg.runtimeBase === "function" ? cfg.runtimeBase
      : function () { return (root.FOREST_RUNTIME_BASE || (typeof window !== "undefined" && window.FOREST_RUNTIME_BASE) || ""); };
    return function (payload) {
      payload = payload || {};
      var built = payload.op === "patch" ? buildPatch(payload.id, payload) : buildCreate(payload);
      if (!built.ok) return Promise.resolve({ ok: false, error: built.error });

      var RT = runtimeBase();
      var grant = (typeof cfg.getGrant === "function" ? cfg.getGrant() : cfg.grant)
        || (root.FOREST_SEND_GRANT || (typeof window !== "undefined" && window.FOREST_SEND_GRANT) || "");
      var fetchFn = cfg._fetch || (typeof window !== "undefined" && window.fetch) || null;
      if (!fetchFn) return Promise.resolve({ ok: false, error: "offline \u2014 not changed" });

      var bodyObj = { grant: grant, provider: "gmail", account: payload.account };
      bodyObj.op = built.body.op;
      if (built.body.id !== undefined) bodyObj.id = built.body.id;
      if (built.body.name !== undefined) bodyObj.name = built.body.name;
      if (built.body.color !== undefined) bodyObj.color = built.body.color;

      return fetchFn((RT || "") + "/intent/label", {
        method: "POST", cache: "no-store", credentials: "include",
        headers: { "content-type": "application/json" }, body: JSON.stringify(bodyObj)
      }).then(function (r) {
        return r.json().then(function (j) {
          if (r.ok && j && j.decision === "allow") return { ok: true, label: j.label };
          return { ok: false, error: (j && j.error) || ("change failed (HTTP " + r.status + ")") };
        }, function () { return { ok: false, error: "change failed (HTTP " + r.status + ")" }; });
      }).catch(function () { return { ok: false, error: "network error \u2014 not changed" }; });
    };
  }

  // makeListFn(cfg) -> function({ account? }) -> Promise<{ ok, labels, error? }>. THE REGISTRY READ SEAM
  // (email-app #06 READ) — the fetch the merge below was waiting on. POSTs { op:'list' } to /intent/label
  // (the runtime read branch short-circuits BEFORE the Warrant exercise — read-only by construction — so
  // no grant/re-consent is needed for the read; the seam still sends the resolved grant harmlessly for
  // symmetry with makeLabelFn). Resolves the normalized registry [{ id, name, type, color }] for
  // knownLabels(observed, registry). Mirrors makeLabelFn's resolve-an-object-never-throw contract:
  // offline/denied -> { ok:false, labels:[] } (honest), never a fake set — the merge then degrades to the
  // observed set exactly as it does today.
  function makeListFn(cfg) {
    cfg = cfg || {};
    var runtimeBase = typeof cfg.runtimeBase === "function" ? cfg.runtimeBase
      : function () { return (root.FOREST_RUNTIME_BASE || (typeof window !== "undefined" && window.FOREST_RUNTIME_BASE) || ""); };
    return function (opts) {
      opts = opts || {};
      var RT = runtimeBase();
      var grant = (typeof cfg.getGrant === "function" ? cfg.getGrant() : cfg.grant)
        || (root.FOREST_SEND_GRANT || (typeof window !== "undefined" && window.FOREST_SEND_GRANT) || "");
      var fetchFn = cfg._fetch || (typeof window !== "undefined" && window.fetch) || null;
      if (!fetchFn) return Promise.resolve({ ok: false, error: "offline \u2014 registry not read", labels: [] });
      var bodyObj = { grant: grant, provider: "gmail", account: opts.account, op: "list" };
      return fetchFn((RT || "") + "/intent/label", {
        method: "POST", cache: "no-store", credentials: "include",
        headers: { "content-type": "application/json" }, body: JSON.stringify(bodyObj)
      }).then(function (r) {
        return r.json().then(function (j) {
          if (r.ok && j && j.decision === "allow" && Array.isArray(j.labels)) return { ok: true, labels: j.labels };
          return { ok: false, error: (j && j.error) || ("registry read failed (HTTP " + r.status + ")"), labels: [] };
        }, function () { return { ok: false, error: "registry read failed (HTTP " + r.status + ")", labels: [] }; });
      }).catch(function () { return { ok: false, error: "network error \u2014 registry not read", labels: [] }; });
    };
  }

  // ---- THE REGISTRY MERGE (salvaged from the noble-kraken line,) ------------------------
  // The app derives its label set two ways that disagree exactly where it matters. labelsOf(messages)
  // is the OBSERVED set (ids the mail in hand wears — no name, no color, and it can NEVER surface a
  // label no message wears). listLabels() is the REGISTRY (full records: id + name + color + type). A
  // just-created, still-empty label is in the registry but in NO message — so without the merge it is
  // invisible the instant you make it. knownLabels(observed, registry) is the union that fixes this.
  // These are PURE + cold-safe (no I/O, no model, no network). The read seam that FETCHES the registry
  // is makeListFn above (POST /intent/label { op:'list' }, built); knownLabels(observed,)
  // still degrades cleanly to the observed set when no registry has arrived yet, and lights up the
  // moment makeListFn's result is passed in.

  // labelId(x) — accept a bare id string (from labelsOf) or a record (from listLabels), return its id
  // (trimmed) or "" for anything shapeless. Never throws.
  function labelId(x) {
    if (x == null) return "";
    if (typeof x === "string") return x.trim();
    if (typeof x === "object" && typeof x.id === "string") return x.id.trim();
    return "";
  }

  // knownLabels(observed, registry) -> the merged, sorted label set. THE LOAD-BEARING MERGE.
  //   observed : the ids the mailbox actually wears (model.labelsOf(messages)) — ids only.
  //   registry : the full label records (listLabels()) — { id, name, color, type }.
  // Union by id; the registry record WINS (it carries name + color + type). An observed-only id with no
  // registry match degrades to { id, name:id, color:null, type:'user' } (flag-don't-fake: an id we
  // cannot name is shown as its own id, never guessed). Sorted user-first (editable) then system, each
  // group by display name (case-insensitive), so the manage UI reads stably. New array; never mutates.
  function knownLabels(observed, registry) {
    var byId = {};
    var order = [];
    function put(id, rec) {
      if (id === "") return;
      if (!Object.prototype.hasOwnProperty.call(byId, id)) { order.push(id); }
      byId[id] = rec;   // last writer wins; registry is applied AFTER observed, so the full record wins
    }
    if (observed && typeof observed.forEach === "function") {
      observed.forEach(function (x) {
        var id = labelId(x);
        if (id === "") return;
        if (!Object.prototype.hasOwnProperty.call(byId, id)) {
          put(id, { id: id, name: id, color: null, type: "user" });   // flag-don't-fake
        }
      });
    }
    if (registry && typeof registry.forEach === "function") {
      registry.forEach(function (r) {
        var id = labelId(r);
        if (id === "" || !r || typeof r !== "object") return;
        put(id, {
          id: id,
          name: (typeof r.name === "string" && r.name) ? r.name : id,
          color: (r.color && typeof r.color === "object") ? r.color : null,
          type: (r.type === "system") ? "system" : "user"
        });
      });
    }
    var out = order.map(function (id) { return byId[id]; });
    out.sort(function (a, b) {
      if (a.type !== b.type) return a.type === "system" ? 1 : -1;   // user labels first (editable)
      var na = String(a.name).toLowerCase(), nb = String(b.name).toLowerCase();
      return na < nb ? -1 : na > nb ? 1 : 0;
    });
    return out;
  }

  // userLabels(known) -> the type:'user' subset of a merged list — the ONLY labels Gmail lets you
  // rename/recolor (a system-label patch is refused). The create/rename affordances offer over these.
  function userLabels(known) {
    if (!known || typeof known.filter !== "function") return [];
    return known.filter(function (l) { return l && l.type === "user"; });
  }

  // applyLocal(known, result) -> the optimistic next merged-list after a makeLabelFn create/patch
  // result. result = { ok, label:{ id, name, color, type } }. create -> append (or replace if the id
  // already exists); patch -> replace by id. Unknown/shapeless -> the list unchanged. Always a NEW
  // array; never mutates the input. The next real registry read reconciles authoritatively.
  function applyLocal(known, result) {
    var base = (known && typeof known.slice === "function") ? known.slice() : [];
    var label = result && result.label;
    var id = labelId(label);
    if (id === "") return base;
    var rec = {
      id: id,
      name: (label && typeof label.name === "string" && label.name) ? label.name : id,
      color: (label && label.color && typeof label.color === "object") ? label.color : null,
      type: (label && label.type === "system") ? "system" : "user"
    };
    var found = false;
    var out = base.map(function (l) {
      if (l && labelId(l) === id) { found = true; return rec; }
      return l;
    });
    if (!found) out.push(rec);
    return out;
  }

  root.mailLabelCrud = {
    buildCreate: buildCreate,
    buildPatch: buildPatch,
    okColor: okColor,
    makeLabelFn: makeLabelFn,
    makeListFn: makeListFn,
    // the salvaged registry merge
    labelId: labelId,
    knownLabels: knownLabels,
    userLabels: userLabels,
    applyLocal: applyLocal,
    MAX_LABEL_NAME_BYTES: MAX_LABEL_NAME_BYTES
  };
})();
