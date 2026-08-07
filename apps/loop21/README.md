# Loop 2.1 — a manual flow computer in one HTML file

Loop 2.1 is a working flow computer that runs in a browser: ~18,000 lines of
JavaScript, a single HTML file, zero external dependencies. Registers, buses, an
ALU, loop-line memory, operator switches, and a session log — a non-trivial
machine you can open and drive without installing anything.

It is the direct descendant of a computer built inside Minecraft with redstone
over seven years (Loop 1.0), inspired by 1940s mercury delay-line memory — bits
kept alive by circulating them in a loop. When that architecture outgrew
Minecraft's one-hertz reality, it moved to the browser. This is where it landed.

## Run it

No build, no install, no server. Open the file:

```
open loop21-build333.html
```

Or double-click it, or drag it into any modern browser. Everything — the
machine, the UI, the logic — is in that one file.

You can also run it live on the site: **http://loopmmt.com/apps/loop21/loop21-build333.html**

## What's here

```
loop21-build333.html   — the whole machine: one file, no dependencies
docs/
  l21-operators-manual-v1-2.md        — how to drive it, control by control
  l21-technical-reference-v1.md        — developer guide: internals, wiring
  l21-computing-first-principles-v1.md — computing built up from nothing
  l21-complete-record-v1.md            — the full build record of Loop 2.1
```

## Reading the code

The machine is self-contained in `loop21-build333.html`. Start with the
**Operator's Manual** to learn what the controls do, then the **Technical
Reference** for how the internals are wired. **Computing from First Principles**
is the standalone essay on the ideas underneath; **The Complete Record** is the
long-form account of how it was built.

## Notes

- **Single file, offline.** Nothing phones home; nothing to install. Save the
  HTML and it runs forever, no network required.
- **Designed by Shea Gunther; code written with Claude.** Built nights and
  weekends from a one-room RV on a $200 laptop.
