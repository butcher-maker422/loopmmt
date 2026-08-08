/* Shea's Forest — the App Shell · shell/registry-seal.js
   THE SEAL DOOR — the client affordance leg 02b (the tank) could not ship without.

   ============================================================================
   WHY THIS EXISTS.

   The runtime's envelope opener (forest/runtime/registry-envelope.js) REFUSES a
   legacy plaintext sqlite registry at rest — `E_REGISTRY_PLAINTEXT_AT_REST`,
   surfaced to a gated read as { ok:false, status:500, code:'E_REGISTRY_PLAINTEXT_AT_REST' }.
   It does NOT auto-migrate: sqlite leaves freed pages un-zeroed, so an in-place
   seal would leave his real rows in the file's slack while every check reported
   a sealed store. The migration is fresh-file -> VERIFY -> shred, and it lives at
   `POST /api/registry/migrate` (forest-runtime.js:2200).

   That route is REACHABLE (it is under the already-proxied, already-owner-gated
   /api/ family) but until now there was NO CLIENT AFFORDANCE that called it. So a
   runtime deploy would have left the owner signed in, watching Calendar AND
   Contacts 500 on the plaintext guard (correctly), with NO REACHABLE DOOR to
   migrate with — the exact "no reachable door" failure the runtime's own migrate
   route comment names. This module is that door.

   WHY THE KEY CANNOT COME FROM ANYWHERE BUT A SIGNED-IN REQUEST. The seal key IS
   the owner's login password. It exists only in the runtime's RAM (keyed by the
   session) or wrapped under the browser's cookie — NEVER at rest on the box in a
   form the box alone can read. No cron, no post-receive hook, no CLI can obtain
   it. So the seal MUST be driven by a request carrying his session — which is
   exactly a signed-in browser call, which is exactly this.

   THE ONE-WAY DOOR IS GUARDED BY A TWO-STEP CONFIRM. `POST /api/registry/migrate`
   permanently shreds the plaintext copy. An irreversible destructive action does
   not fire on one click: renderSealPrompt paints an explain-then-confirm flow, and
   the network POST only fires after the owner explicitly confirms.

   HONEST-SIGNAL AXIS (mirrors calendar-rest.js F3). Every call resolves to a
   plain envelope { ok, status, code, data } — never throws for an HTTP error,
   never fabricates a body. The predicate `needsSeal` reads the SAME envelope the
   panes already produce, so the door only appears on the store-needs-sealing
   fault and never on "not signed in" (E_NO_SESSION_KEY) or "daemon down"
   (E_UNREACHABLE / E_SEAM_NO_REGISTRY).

   Plain script (no ES module) — attaches to window.ForestShell.registrySeal.
   Injectable fetch (opts.fetch) so it is unit-testable with a mocked fetch,
   cold-safe. Injectable document (opts.doc) for the same reason. */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  var MIGRATE_URL = "/api/registry/migrate";
  var SEAL_FAULT_CODE = "E_REGISTRY_PLAINTEXT_AT_REST";

  /* needsSeal(readResult) -> boolean.
     TRUE iff a gated read came back as the store-needs-sealing fault, and NOTHING
     else. A read envelope is { ok, status, code, data }. The three faults that are
     NOT this door:
        E_NO_SESSION_KEY        (401) -> sign in again (reach-recovery owns it)
        E_UNREACHABLE           (0)   -> daemon down    (reach-recovery owns it)
        E_SEAM_NO_REGISTRY      (503) -> transient seam gap, not a plaintext store
     Only the 500 + E_REGISTRY_PLAINTEXT_AT_REST pair means "your store is on disk
     in the clear and must be sealed before it will open." */
  function needsSeal(readResult) {
    if (!readResult || readResult.ok) return false;
    return readResult.code === SEAL_FAULT_CODE;
  }

  /* seal(opts) -> Promise<{ ok, status, code, data }>.
     POSTs the migrate route, credentialed. NEVER throws — a network drop resolves
     to { ok:false, status:0, code:'E_UNREACHABLE' }, mirroring calendar-rest.js so
     the caller reads one honest shape. The migrate route returns 200 + receipt on
     success, 401 E_NO_SESSION_KEY if the session lost its key, 500 + code on a
     migration fault (the runtime guarantees the store is UNTOUCHED on a fault:
     it verifies the sealed copy before it destroys anything). */
  function seal(opts) {
    opts = opts || {};
    var fetchImpl = opts.fetch || (typeof fetch === "function" ? fetch : null);
    if (!fetchImpl) {
      return Promise.resolve({ ok: false, status: 0, code: "E_NO_FETCH", data: null });
    }
    var url = opts.url || MIGRATE_URL;
    return fetchImpl(url, {
      method: "POST",
      cache: "no-store",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    }).then(function (res) {
      return res.json().then(
        function (body) {
          return { ok: res.ok, status: res.status, code: (body && body.code) || null, data: body };
        },
        function () {
          // A body that will not parse is still an honest status.
          return { ok: res.ok, status: res.status, code: null, data: null };
        }
      );
    }, function () {
      return { ok: false, status: 0, code: "E_UNREACHABLE", data: null };
    });
  }

  /* formatReceipt(data) -> [String].
     Turns the migrate receipt into the census witness lines the run book's {post}
     demands ("one number moving is a hypothesis — report events + earliest-date +
     bytes"). Reads the receipt shape migrateRegistries returns:
        { ok, registries: [ { registry, status, rows, earliest, source_bytes, blob_bytes, ... } ] }
     Each registry line is human-legible; an already-sealed / absent registry says
     so plainly rather than pretending it sealed something. Cold-safe on a missing
     or malformed receipt. */
  function formatReceipt(data) {
    var lines = [];
    if (!data || !Array.isArray(data.registries)) {
      return ["Sealed. (No detail returned.)"];
    }
    data.registries.forEach(function (r) {
      var name = r.registry || "registry";
      if (r.status === "sealed" || r.status === "recovered") {
        var held = (r.rows != null ? r.rows : "?") + " rows held";
        var earliest = r.earliest ? ", earliest " + r.earliest : "";
        var bytes = (r.source_bytes != null && r.blob_bytes != null)
          ? ", " + r.source_bytes + "B plaintext shredded \u2192 " + r.blob_bytes + "B sealed blob"
          : "";
        lines.push(name + ": SEALED \u2014 " + held + earliest + bytes + ".");
      } else if (r.status === "already-sealed") {
        lines.push(name + ": already sealed \u2014 nothing to do.");
      } else if (r.status === "absent") {
        lines.push(name + ": no store yet \u2014 a fresh sealed one will be created on first write.");
      } else {
        lines.push(name + ": " + (r.status || "unknown") + ".");
      }
    });
    return lines.length ? lines : ["Sealed."];
  }

  /* renderSealPrompt(mount, opts) — paints the explain -> confirm -> seal flow into
     `mount`. opts:
        doc      : the document (defaults to window.document; injectable for tests)
        onSealed : called with the success envelope after a successful seal
        seal     : the seal fn (defaults to this module's; injectable for tests)
     The flow is deliberately THREE states, because the action is irreversible:
        (1) EXPLAIN  — what sealing does, that it is permanent, that it needs sign-in.
        (2) CONFIRM  — an explicit second click; the POST fires only here.
        (3) RESULT   — the census receipt on success, or the typed fault (store
                       UNTOUCHED) on failure, with a Retry.
     Uses the plain document API (createElement / textContent / className) so it is
     modelled faithfully by test-dom.js. */
  function renderSealPrompt(mount, opts) {
    opts = opts || {};
    var doc = opts.doc || (typeof document !== "undefined" ? document : null);
    var sealFn = opts.seal || seal;
    if (!doc || !mount) return null;

    function clear(el) { el.textContent = ""; }
    function el(tag, cls, text) {
      var n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }

    function paintExplain() {
      clear(mount);
      var box = el("div", "registry-seal registry-seal--explain");
      box.appendChild(el("h2", "registry-seal__title", "Your store isn't sealed yet"));
      box.appendChild(el("p", "registry-seal__body",
        "Your calendar and contacts are on the box unencrypted. Sealing encrypts "
        + "them at rest under your login \u2014 nothing readable stays on disk. This "
        + "permanently destroys the unencrypted copy and cannot be undone. You must "
        + "be signed in; your calendar and contacts stay dark until this runs."));
      var go = el("button", "registry-seal__seal-btn", "Seal my store\u2026");
      go.setAttribute("type", "button");
      go.onclick = paintConfirm;
      box.appendChild(go);
      mount.appendChild(box);
    }

    function paintConfirm() {
      clear(mount);
      var box = el("div", "registry-seal registry-seal--confirm");
      box.appendChild(el("p", "registry-seal__confirm-body",
        "This will encrypt everything and permanently destroy the unencrypted "
        + "copy. There is no undo. Continue?"));
      var yes = el("button", "registry-seal__confirm-btn", "Yes, seal it now");
      yes.setAttribute("type", "button");
      yes.onclick = runSeal;
      var no = el("button", "registry-seal__cancel-btn", "Not now");
      no.setAttribute("type", "button");
      no.onclick = paintExplain;
      box.appendChild(yes);
      box.appendChild(no);
      mount.appendChild(box);
    }

    function paintWorking() {
      clear(mount);
      var box = el("div", "registry-seal registry-seal--working");
      box.appendChild(el("p", "registry-seal__working-body", "Sealing your store\u2026"));
      mount.appendChild(box);
    }

    function paintResult(env) {
      clear(mount);
      if (env && env.ok && env.data && env.data.ok !== false) {
        var okBox = el("div", "registry-seal registry-seal--done");
        okBox.appendChild(el("h2", "registry-seal__title", "Sealed"));
        var lines = formatReceipt(env.data);
        var ul = el("ul", "registry-seal__receipt");
        lines.forEach(function (line) { ul.appendChild(el("li", "registry-seal__receipt-line", line)); });
        okBox.appendChild(ul);
        mount.appendChild(okBox);
        if (typeof opts.onSealed === "function") opts.onSealed(env);
        return;
      }
      // Fault. The store was NOT touched (the migration verifies before it shreds).
      var errBox = el("div", "registry-seal registry-seal--error");
      errBox.appendChild(el("h2", "registry-seal__title", "Sealing didn't complete"));
      var msg;
      if (env && env.status === 401) {
        msg = "Your session lost its key. Sign in again, then seal.";
      } else if (env && (env.status === 0 || env.code === "E_UNREACHABLE")) {
        msg = "Couldn't reach the box. Your store was not touched \u2014 try again.";
      } else {
        msg = "The seal did not complete. Your store was NOT touched \u2014 it verifies "
            + "the sealed copy before destroying anything, and it did not get that far.";
      }
      errBox.appendChild(el("p", "registry-seal__error-body", msg));
      var retry = el("button", "registry-seal__retry-btn", "Try again");
      retry.setAttribute("type", "button");
      retry.onclick = paintExplain;
      errBox.appendChild(retry);
      mount.appendChild(errBox);
    }

    function runSeal() {
      paintWorking();
      return Promise.resolve(sealFn({ fetch: opts.fetch, url: opts.url })).then(paintResult, function () {
        paintResult({ ok: false, status: 0, code: "E_UNREACHABLE", data: null });
      });
    }

    paintExplain();
    return { paintExplain: paintExplain, runSeal: runSeal };
  }

  root.registrySeal = {
    needsSeal: needsSeal,
    seal: seal,
    formatReceipt: formatReceipt,
    renderSealPrompt: renderSealPrompt,
    SEAL_FAULT_CODE: SEAL_FAULT_CODE,
    MIGRATE_URL: MIGRATE_URL,
  };
})();
