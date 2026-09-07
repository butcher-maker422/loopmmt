#!/usr/bin/env node
/* verify-persistence-dom.cjs — the AFFORDANCE claim: the persistence wiring
 * in index.html actually works in a browser. verify-persistence.cjs proves the
 * PURE model (persist.js); this proves the DOM GLUE — resume-on-reload, the
 * copy→paste puzzle round-trip, and reset — so the buttons are not unclaimed
 * surface (the Cruise's DEAD-AFFORDANCE / UNCLAIMED-SURFACE gap).
 *
 * Served over a real http origin (localStorage is reliable there; file:// gives
 * an opaque origin some browsers refuse storage on — which is WHY the glue
 * fails safe). Self-degrades: no Playwright / no browser -> SKIP, exit 0, the
 * Tier-0 pure test still gates. Pattern borrowed from jamies-garden/verify-fit-render.cjs.
 * Run: `node verify-persistence-dom.cjs`.
 */
"use strict";
let chromium;
try { ({ chromium } = require("playwright")); }
catch (e) { console.log("SKIP-NEEDS-BROWSER — playwright not installed (pure test gates)"); process.exit(0); }

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const P = require("./persist.js"); // the pure core, to build/verify .l21x file bytes

const MIME = { ".html": "text/html", ".js": "application/javascript", ".json": "application/json", ".cjs": "application/javascript" };
function serve(root) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = req.url.split("?")[0];
      const file = path.join(root, url === "/" ? "index.html" : url);
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end("404"); return; }
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "text/plain" });
        res.end(buf);
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port }));
  });
}

let pass = 0, fail = 0;
function claim(s, cond, extra) { if (cond) { console.log("  ok   " + s); pass++; } else { console.log("  FAIL " + s + (extra ? "\n         " + extra : "")); fail++; } }

(async () => {
  const { srv, port } = await serve(__dirname);
  const base = `http://127.0.0.1:${port}/index.html`;
  let browser;
  try {
    browser = await chromium.launch();
    const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"], acceptDownloads: true });
    const page = await ctx.newPage();
    console.log("verify-persistence-dom — the affordance works in a browser\n");

    // --- resume across reload -------------------------------------------------
    await page.goto(base);
    await page.waitForSelector("#grid td");
    await page.selectOption("#pick", "0");
    const label0 = await page.$eval("#pick", (el) => el.options[el.selectedIndex].textContent);
    await page.click("#next"); await page.click("#next"); await page.click("#next");
    const stepBefore = await page.$eval("#stepno", (el) => el.textContent);
    await page.reload();
    await page.waitForSelector("#grid td");
    const stepAfter = await page.$eval("#stepno", (el) => el.textContent);
    const labelAfter = await page.$eval("#pick", (el) => el.options[el.selectedIndex].textContent);
    claim("stepping then reloading RESUMES the same step (not step 0)", stepAfter === stepBefore && /step 3 \//.test(stepAfter), `before=${stepBefore} after=${stepAfter}`);
    claim("reload resumes the same puzzle selection", labelAfter === label0, `${label0} -> ${labelAfter}`);

    // --- copy -> paste puzzle round-trip -------------------------------------
    await page.goto(base);
    await page.waitForSelector("#grid td");
    await page.click(".saverow summary"); // expand the load-code disclosure
    await page.selectOption("#pick", "0");
    const wantLabel = await page.$eval("#pick", (el) => el.options[el.selectedIndex].textContent);
    await page.click("#copy-save");
    // code is either on the clipboard or (fallback) in #save-in
    let code = "";
    try { code = await page.evaluate(() => navigator.clipboard.readText()); } catch (e) {}
    if (!code) code = await page.$eval("#save-in", (el) => el.value);
    claim("copy save code yields a human-readable LOOP-SUDOKU SAVE", /^LOOP-SUDOKU SAVE v1/.test(code || ""), `got: ${(code || "").slice(0, 30)}`);
    // switch away, then load the code back
    await page.selectOption("#pick", "1");
    await page.fill("#save-in", code);
    await page.click("#load-save");
    const okMsg = await page.$eval("#save-msg", (el) => el.textContent);
    const loadedLabel = await page.$eval("#pick", (el) => el.options[el.selectedIndex].textContent);
    claim("pasting the save code loads that puzzle back", loadedLabel === wantLabel, `${wantLabel} -> ${loadedLabel} (${okMsg})`);

    // --- a corrupt code is rejected, never loaded ----------------------------
    await page.fill("#save-in", "LOOP-SUDOKU SAVE v1\nkind: puzzle\nsum: deadbeef\n--\n{\"givens\":\"x\"}");
    await page.click("#load-save");
    const badMsg = await page.$eval("#save-msg", (el) => el.textContent);
    claim("a corrupt save code is refused with an honest message, not loaded", /checksum|not a recognized|not loaded/i.test(badMsg), `msg: ${badMsg}`);

    // --- reset clears the resume ---------------------------------------------
    await page.click("#next"); await page.click("#next");
    await page.click("#reset-view");
    await page.reload();
    await page.waitForSelector("#grid td");
    const stepReset = await page.$eval("#stepno", (el) => el.textContent);
    claim("reset view clears saved state — a reload starts at step 0", /step 0 \//.test(stepReset), `after reset+reload: ${stepReset}`);

    // --- save .l21x downloads a file that round-trips back -------------------
    await page.goto(base);
    await page.waitForSelector("#grid td");
    await page.selectOption("#pick", "0");
    const savedOpt = await page.$eval("#pick", (el) => el.options[el.selectedIndex].textContent);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#save-file"),
    ]);
    const dlName = download.suggestedFilename();
    const dlBody = fs.readFileSync(await download.path(), "utf8");
    const dlDecoded = P.decodePuzzle(dlBody);
    claim("save .l21x downloads a file named <label>.l21x", /\.l21x$/.test(dlName), `name: ${dlName}`);
    claim("the downloaded .l21x file round-trips: decodePuzzle(fileBytes) is that same puzzle",
      !!dlDecoded && savedOpt.indexOf(dlDecoded.label) === 0,
      `file label -> ${dlDecoded && dlDecoded.label} | opt -> ${savedOpt}`);

    // --- open .l21x adds a puzzle from a file on disk (durable-on-disk) -------
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "l21x-"));
    const importPuzzle = {
      id: "imp1", label: "Imported From File", status: "solved-unique",
      givens: "5".repeat(81),
      result: { status: "solved-unique", trace: [{ technique: "naked-single", reason: "r1c1=5" }], solution: null },
      faces: { grade: {}, hint: {}, teach: [], validate: {} },
    };
    const goodFile = path.join(tmpDir, "imported.l21x");
    fs.writeFileSync(goodFile, P.encodePuzzle(importPuzzle));
    await page.goto(base);
    await page.waitForSelector("#grid td");
    await page.setInputFiles("#file-in", goodFile);
    await page.waitForFunction(() => /loaded/i.test(document.getElementById("save-msg").textContent)).catch(() => {});
    const importedSel = await page.$eval("#pick", (el) => el.options[el.selectedIndex].textContent);
    claim("open .l21x adds the puzzle from the file and selects it",
      importedSel.indexOf("Imported From File") !== -1, `selected: ${importedSel}`);

    // --- a corrupt .l21x file is refused, never loaded -----------------------
    const badFile = path.join(tmpDir, "corrupt.l21x");
    fs.writeFileSync(badFile,
      'LOOP-SUDOKU SAVE v1\nkind: puzzle\nsum: deadbeef\n--\n{"givens":"' + "5".repeat(81) + '","result":{"trace":[]}}\n');
    await page.setInputFiles("#file-in", badFile);
    await page.waitForFunction(() => /checksum|not a loop-sudoku|not loaded/i.test(document.getElementById("save-msg").textContent)).catch(() => {});
    const badFileMsg = await page.$eval("#save-msg", (el) => el.textContent);
    claim("a corrupt .l21x file is refused with an honest message, not loaded",
      /checksum|not a loop-sudoku|not loaded/i.test(badFileMsg), `msg: ${badFileMsg}`);
    fs.rmSync(tmpDir, { recursive: true, force: true });

    // --- clipboard-blocked fallback surfaces the code in an OPENED box --------
    // On file:// the clipboard is often blocked; the copy button must not become
    // a dead button pointing at a hidden textarea. Use a context with no
    // clipboard permission to force the fallback path.
    const ctx2 = await browser.newContext(); // no clipboard-write permission
    const page2 = await ctx2.newPage();
    await page2.goto(base);
    await page2.waitForSelector("#grid td");
    await page2.click("#copy-save");
    const boxVal = await page2.$eval("#save-in", (el) => el.value);
    const detailsOpen = await page2.$eval(".saverow details", (el) => el.open);
    claim("clipboard-blocked copy drops the code into an OPENED box (no dead button)",
      /^LOOP-SUDOKU SAVE v1/.test(boxVal) && detailsOpen === true,
      `boxHasCode=${/^LOOP-SUDOKU/.test(boxVal)} detailsOpen=${detailsOpen}`);
    await ctx2.close();

    await browser.close();
  } catch (e) {
    console.log("  ERROR " + e.message.split("\n")[0]); fail++;
    if (browser) await browser.close();
  } finally {
    srv.close();
  }

  console.log(`\n${fail ? "FAIL" : "PASS"} — ${pass}/${pass + fail} affordance claims`);
  process.exit(fail ? 1 : 0);
})();
