'use strict';
/*
 * loopcontact-lib — a require()-safe, in-process loader for the byte-frozen Contact registry
 * (_tools/loopcontact.js), the People Soil.
 *
 * WHY THIS EXISTS — AND WHAT IS NO LONGER TRUE (corrected, Snag).
 * This loader was written when loopcontact carried its shebang on LINE 2 (after its SPDX comment),
 * where `#!` is not legal JS: node threw `SyntaxError: Invalid or unexpected token` on both require()
 * and direct run. The original comment here said we CANNOT fix that at the source because loopcontact
 * is "byte-frozen" by the golden pin. BOTH claims are now false, and the second was never right:
 * · the shebang WAS fixed at the source — it is on line 1 and `node --check` passes;
 *   · the golden pin is NOT a freeze. It is a PIN THAT MOVES WITH AN OPERATOR-OFFICIATED BLESS
 * (referee != player). loopcontact has been re-pinned twice: 129287f0 -> b6b1253c (,
 * this very shebang fix) -> 8d0fad06 (, the K6-A label filter).
 * So: if you need a change in loopcontact, the path is a BLESS, not another in-memory workaround.
 * NEVER copy the sha into a comment. It lives in golden/{contact,calendar}/bless.json ->
 * reuses.contact_substrate.sha256, and the seal guard (_tools/test-loopcontact-write-path.js)
 * DERIVES it from there. Two hand-kept copies in this header went stale exactly as that guard's own
 * hardcoded copy did — FOLD, do not COPY.
 * The shebang strip below is retained as a harmless no-op / defence-in-depth (a legal line-1 shebang
 * is stripped by node anyway). Retiring it is a live-runtime change and is routed, not done here.
 *
 * The substrate shebang bug itself (loopcontact can neither run nor require cleanly, so the deploy
 * daemon on :1328 would also fail) is a SEPARATE finding, flagged for the operator — not fixed here,
 * because the fix is a re-bless of the People Soil, not a sink concern.
 */

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const SOURCE_PATH = path.resolve(__dirname, '../../../_tools/loopcontact.js');

function loadLoopContact() {
  const raw = fs.readFileSync(SOURCE_PATH, 'utf8');
  // Strip a shebang line wherever it sits in the header (loopcontact's is line 2), then APPEND an
  // in-memory export augmentation so the runtime seam (forest-runtime.js /api/contact/*) can call the
  // tool's in-process HTTP handler. loopcontact's `handleApiRequest(runtimeState,req,res,pathname,query)`
  // is a top-level function but is NOT in its own `module.exports` block, so a clean require() cannot reach
  // it. loopcontact.js is GOLDEN-PINNED — its sha256 is the `reuses.contact_substrate` anchor in BOTH
  // golden/contact/bless.json and golden/calendar/bless.json (the People-Soil + Calendar-of-People LOCKs).
  // The sha is deliberately NOT written here: read it from the bless files (see the header note). A pin is
  // not a freeze — editing loopcontact at source is legal via an operator-officiated re-bless, and has
  // happened twice. It just isn't free, which is why this in-memory append is still the cheaper path for a
  // pure export seam that changes no semantics. This in-memory append is the pin-safe path: the on-disk
  // file is untouched (the pin holds), and the hoisted function is in module scope at the end of the body,
  // so attaching it to the already-assigned `module.exports` object exposes it for the in-process seam.
  // Nothing else is altered (identical discipline to the shebang strip above). Idempotent + defensive.
  const src = raw.replace(/^#!.*\r?\n/m, '')
    + '\n;if (typeof handleApiRequest === "function" && module.exports && !module.exports.handleApiRequest)'
    + ' { module.exports.handleApiRequest = handleApiRequest; }\n';
  const mod = new Module(SOURCE_PATH, module);
  mod.filename = SOURCE_PATH;
  mod.paths = Module._nodeModulePaths(path.dirname(SOURCE_PATH));
  mod._compile(src, SOURCE_PATH);
  return mod.exports;
}

module.exports = loadLoopContact();
