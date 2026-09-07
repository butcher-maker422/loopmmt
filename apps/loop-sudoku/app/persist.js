/* persist.js — the PURE persistence model of the walking skeleton.
 *
 * NO DOM, NO localStorage, NO solving logic. These functions turn app state
 * into a HUMAN-READABLE, ROUND-TRIP-VERIFIABLE, CORRUPTION-DETECTABLE save
 * string and back — and they live here (not inline in index.html) so a headless
 * Node test (verify-persistence.cjs) can PROVE the round-trip is honest, the
 * same way render-model.js lets verify-render.cjs prove the render is honest.
 *
 * The honesty contract these functions carry (why they exist), the persistence
 * analogue of the render half's "never paint a solved digit on an elimination":
 *
 *   NEVER RESTORE STATE YOU CANNOT VERIFY.
 *
 *   A save string carries a checksum over its payload. decode() RE-DERIVES that
 *   checksum and compares. On any mismatch — a truncated blob, a tampered byte,
 *   a wrong version, malformed JSON — decode() returns `null`. It NEVER returns
 *   a partial or fabricated state. A corrupt save is DETECTABLE, not silently
 *   half-loaded (the F5 `.l21x` lesson: human-readable hex, round-trip
 *   verification — a saved state is inspectable and a corrupt save is caught).
 *
 * The format is deliberately plain text so a save is inspectable by eye:
 *
 *   LOOP-SUDOKU SAVE v1
 *   kind: <viewstate|puzzle>
 *   sum: <8-hex FNV-1a-32 of the payload line>
 *   --
 *   <one-line JSON payload>
 *
 * One primitive, two consumers (Block Principle — the joint is this file):
 *   * localStorage resume  — encode/decodeViewState round-trips {label,step,teachOpen}.
 *   * shareable copy/paste  — encode/decodePuzzle round-trips a full puzzle bundle
 *                             (givens+trace+solution+faces), so a puzzle persists
 *                             as a shareable code with no client-side solver.
 */
(function (root) {
  "use strict";

  var VERSION = "LOOP-SUDOKU SAVE v1";

  // FNV-1a 32-bit over a string -> 8-hex. Deterministic, dependency-free,
  // identical in browser and Node. Not a security hash — a corruption detector
  // (that is exactly its job here: catch a truncated/edited save).
  function checksum(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      // FNV prime 16777619, kept in 32-bit via Math.imul.
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }

  // Assemble the plain-text envelope around a JSON-able payload.
  function encode(kind, payload) {
    var line = JSON.stringify(payload);
    return (
      VERSION + "\n" +
      "kind: " + kind + "\n" +
      "sum: " + checksum(line) + "\n" +
      "--\n" +
      line + "\n"
    );
  }

  // The honest inverse. Returns { kind, payload } on a VERIFIED save, else null.
  // Verified means: right version header, a payload whose recomputed checksum
  // equals the declared `sum`, and payload JSON that parses. Anything else ->
  // null (never a partial state). Wrapped so a garbage string returns null
  // rather than throwing (a save box the user pasted into is untrusted input).
  function decode(str) {
    try {
      if (typeof str !== "string") return null;
      var lines = str.replace(/\r\n/g, "\n").split("\n");
      if (lines[0] !== VERSION) return null;
      var kind = null, sum = null, sep = -1;
      for (var i = 1; i < lines.length; i++) {
        if (lines[i] === "--") { sep = i; break; }
        var m = lines[i].match(/^(kind|sum):\s*(.*)$/);
        if (!m) return null;
        if (m[1] === "kind") kind = m[2].trim();
        else sum = m[2].trim();
      }
      if (sep === -1 || kind === null || sum === null) return null;
      // the payload is the first non-empty line after the separator
      var line = "";
      for (var j = sep + 1; j < lines.length; j++) {
        if (lines[j].length) { line = lines[j]; break; }
      }
      if (!line) return null;
      if (checksum(line) !== sum) return null; // corruption/tamper caught here
      var payload = JSON.parse(line);           // malformed -> throws -> null
      return { kind: kind, payload: payload };
    } catch (e) {
      return null;
    }
  }

  // ---- view-state (localStorage resume) --------------------------------------
  function encodeViewState(state) {
    return encode("viewstate", {
      label: state && state.label != null ? String(state.label) : null,
      step: state && Number.isFinite(state.step) ? state.step | 0 : 0,
      teachOpen: !!(state && state.teachOpen),
    });
  }
  function decodeViewState(str) {
    var d = decode(str);
    if (!d || d.kind !== "viewstate") return null;
    var p = d.payload || {};
    return {
      label: p.label != null ? String(p.label) : null,
      step: Number.isFinite(p.step) ? p.step | 0 : 0,
      teachOpen: !!p.teachOpen,
    };
  }

  // Given a decoded view-state and the labels currently available, return the
  // restore target ONLY if the saved puzzle still exists — else null. This is
  // the honesty law at the app seam: do not restore a cursor onto a puzzle that
  // is not there (the render half's "no fake placement", applied to resume).
  function resolveResume(viewState, availableLabels) {
    if (!viewState || viewState.label == null) return null;
    var labels = availableLabels || [];
    if (labels.indexOf(viewState.label) === -1) return null;
    return { label: viewState.label, step: viewState.step, teachOpen: viewState.teachOpen };
  }

  // ---- puzzle bundle (shareable copy/paste round-trip) -----------------------
  // The bundle is exactly what the viewer needs to render a puzzle with no
  // client solver: id/label/givens + result(trace,solution) + faces + status.
  function encodePuzzle(puzzle) {
    return encode("puzzle", puzzle);
  }
  function decodePuzzle(str) {
    var d = decode(str);
    if (!d || d.kind !== "puzzle") return null;
    var p = d.payload;
    // minimal shape gate: a puzzle a viewer can actually render.
    if (!p || typeof p.givens !== "string" || p.givens.length !== 81) return null;
    if (!p.result || !Array.isArray(p.result.trace)) return null;
    return p;
  }

  // ---- .l21x file naming (PURE; the DOM glue in index.html does the actual
  //      download/upload) --------------------------------------------------------
  // The copy/paste code lives only as long as the tab. A puzzle you want to KEEP
  // travels as a named `.l21x` file on disk — and the FILE IS THE DURABILITY: a
  // static viewer cannot write traces.json, so "durable" means a file you can
  // re-open, not a mutated data file. Same persist.js envelope, new transport.
  //
  // filenameFor derives a safe, human-meaningful filename from the puzzle label.
  // The honesty here is smaller but real: it NEVER emits a path separator, a
  // leading dot, or an empty name (all of which are unsafe or lie about what the
  // file is), and it ALWAYS ends in `.l21x`. An absent/empty/all-unsafe label
  // falls back to a generic name rather than producing a dangerous one.
  function filenameFor(puzzle) {
    var raw = puzzle && puzzle.label != null ? String(puzzle.label) : "";
    var safe = raw
      .replace(/[^A-Za-z0-9 _-]+/g, "-") // drop / \ . " ' etc. -> dash (no path escapes)
      .replace(/\s+/g, "-")               // spaces -> dashes
      .replace(/-+/g, "-")                // collapse runs
      .replace(/^-+|-+$/g, "")            // trim leading/trailing dashes (no leading-dot files)
      .slice(0, 60);                       // bound the length
    if (!safe) safe = "puzzle";            // never an empty or bare-extension name
    return safe + ".l21x";
  }

  var api = {
    checksum: checksum,
    encode: encode,
    decode: decode,
    encodeViewState: encodeViewState,
    decodeViewState: decodeViewState,
    resolveResume: resolveResume,
    encodePuzzle: encodePuzzle,
    decodePuzzle: decodePuzzle,
    filenameFor: filenameFor,
    VERSION: VERSION,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.Persist = api;
  }
})(typeof window !== "undefined" ? window : this);
