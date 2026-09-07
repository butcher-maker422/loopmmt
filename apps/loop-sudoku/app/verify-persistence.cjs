#!/usr/bin/env node
/* verify-persistence.cjs — the headless CLAIM that the persistence round-trip
 * is HONEST. The render half proves "the render never fakes a placement"
 * (verify-render.cjs); this proves "a save never restores state it cannot
 * verify" — the persistence honesty law from persist.js.
 *
 * Test names are behavior SENTENCES (the Blaze: a claim you can read), not
 * test_3. The law is MUTATION-PROVEN: break the checksum guard and the
 * tamper/corrupt tests go red; fabricate a state on parse failure and the
 * malformed test goes red. Run: `node verify-persistence.cjs` (exit 0/1).
 */
"use strict";
const P = require("./persist.js");

let pass = 0, fail = 0;
function claim(sentence, fn) {
  try { fn(); console.log("  ok   " + sentence); pass++; }
  catch (e) { console.log("  FAIL " + sentence + "\n         " + e.message); fail++; }
}
function eq(a, b, m) { if (a !== b) throw new Error((m || "") + ` expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function deep(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || "") + " not deep-equal"); }
function isNull(a, m) { if (a !== null) throw new Error((m || "") + ` expected null, got ${JSON.stringify(a)}`); }

// a representative view-state and a representative puzzle bundle
const VS = { label: "Easy — one blank per box", step: 5, teachOpen: true };
const PZ = {
  id: "p1", label: "Easy — one blank per box", status: "solved-unique",
  givens: "5".repeat(81),
  result: { status: "solved-unique", trace: [{ technique: "naked-single", reason: "r1c1=5" }], solution: null },
  faces: { grade: {}, hint: {}, teach: [], validate: {} },
};

console.log("verify-persistence — the round-trip honesty law\n");

claim("a view-state round-trips: decodeViewState(encodeViewState(s)) equals s", () => {
  const back = P.decodeViewState(P.encodeViewState(VS));
  deep(back, VS, "viewstate round-trip");
});

claim("a full puzzle bundle round-trips: decodePuzzle(encodePuzzle(p)) deep-equals p", () => {
  const back = P.decodePuzzle(P.encodePuzzle(PZ));
  deep(back, PZ, "puzzle round-trip");
});

claim("a save is human-readable: the version header and a checksum line are present in plain text", () => {
  const s = P.encodeViewState(VS);
  if (!s.startsWith("LOOP-SUDOKU SAVE v1")) throw new Error("no version header");
  if (!/\nsum: [0-9a-f]{8}\n/.test(s)) throw new Error("no 8-hex checksum line");
  if (s.indexOf('"label"') === -1) throw new Error("payload not inspectable");
});

claim("a TAMPERED save is rejected, not silently accepted (the corruption-detectable law)", () => {
  const s = P.encodeViewState(VS);
  // flip one character inside the JSON payload, leaving the checksum line intact
  const tampered = s.replace('"step":5', '"step":9');
  isNull(P.decodeViewState(tampered), "tampered payload must fail the checksum");
});

claim("a save with a corrupted checksum line is rejected", () => {
  const s = P.encodePuzzle(PZ).replace(/\nsum: [0-9a-f]{8}\n/, "\nsum: deadbeef\n");
  isNull(P.decodePuzzle(s), "wrong sum must be caught");
});

claim("a malformed blob decodes to null and NEVER throws", () => {
  isNull(P.decode("not a save at all"), "garbage");
  isNull(P.decode(""), "empty");
  isNull(P.decode("LOOP-SUDOKU SAVE v1\nkind: viewstate\nsum: 00000000\n--\n{broken json"), "bad json");
  isNull(P.decodeViewState(null), "null input");
});

claim("a save whose checksum is VALID but payload is not JSON decodes to null (the parse-throw path)", () => {
  // hand-craft a save whose sum matches a non-JSON payload: this is the only
  // input that reaches JSON.parse and throws. It proves decode() returns null
  // there rather than fabricating a state (mutation-proves the catch branch).
  const line = "this is not json";
  const s = "LOOP-SUDOKU SAVE v1\nkind: viewstate\nsum: " + P.checksum(line) + "\n--\n" + line + "\n";
  isNull(P.decode(s), "checksum-valid but unparseable payload must be null");
});

claim("a save from a different version is rejected (no cross-version half-load)", () => {
  const s = P.encodeViewState(VS).replace("LOOP-SUDOKU SAVE v1", "LOOP-SUDOKU SAVE v2");
  isNull(P.decode(s), "wrong version");
});

claim("resolveResume restores a cursor ONLY when the saved puzzle still exists", () => {
  const vs = P.decodeViewState(P.encodeViewState(VS));
  const hit = P.resolveResume(vs, ["Easy — one blank per box", "Other"]);
  deep(hit, { label: "Easy — one blank per box", step: 5, teachOpen: true }, "present label restores");
});

claim("resolveResume returns null for a puzzle that is GONE — it never fakes a cursor", () => {
  const vs = P.decodeViewState(P.encodeViewState(VS));
  isNull(P.resolveResume(vs, ["Some Other Puzzle"]), "missing label must not restore");
});

claim("decodePuzzle rejects a bundle a viewer could not actually render", () => {
  const noGivens = P.encode("puzzle", { label: "x", result: { trace: [] } });
  isNull(P.decodePuzzle(noGivens), "no 81-char givens");
  const wrongKind = P.encodeViewState(VS);
  isNull(P.decodePuzzle(wrongKind), "a viewstate is not a puzzle");
});

// ---- .l21x filename derivation (the file-export naming) ---------------------

claim("filenameFor derives a readable name from the label and always ends in .l21x", () => {
  const name = P.filenameFor(PZ);
  if (!/\.l21x$/.test(name)) throw new Error("must end .l21x, got " + name);
  if (name.indexOf("Easy") === -1) throw new Error("should keep the label words, got " + name);
});

claim("filenameFor NEVER emits a path separator or a leading dot (no unsafe filenames)", () => {
  const evil = P.filenameFor({ label: "../../etc/passwd" });
  if (/[\/\\]/.test(evil)) throw new Error("path separator leaked: " + evil);
  if (evil[0] === ".") throw new Error("leading dot (hidden/dangerous): " + evil);
  if (!/\.l21x$/.test(evil)) throw new Error("must still end .l21x: " + evil);
  // dots inside the label must be sanitized so the only dot is the extension's
  const dotty = P.filenameFor({ label: "a.b.c" });
  eq((dotty.match(/\./g) || []).length, 1, "exactly one dot (the extension):");
});

claim("filenameFor falls back to a generic name when the label is absent or all-unsafe", () => {
  eq(P.filenameFor({}), "puzzle.l21x", "no label");
  eq(P.filenameFor(null), "puzzle.l21x", "no puzzle");
  eq(P.filenameFor({ label: "///" }), "puzzle.l21x", "all-unsafe label");
  eq(P.filenameFor({ label: "" }), "puzzle.l21x", "empty label");
});

claim("a puzzle saved to a .l21x file round-trips: decodePuzzle(fileBody) deep-equals it", () => {
  // the file body IS the envelope (persist.js is the transport-agnostic core);
  // this proves the file slice reuses the proven primitive, not a new format.
  const fileBody = P.encodePuzzle(PZ);
  deep(P.decodePuzzle(fileBody), PZ, ".l21x file body round-trip");
});

console.log(`\n${fail ? "FAIL" : "PASS"} — ${pass}/${pass + fail} claims`);
process.exit(fail ? 1 : 0);
