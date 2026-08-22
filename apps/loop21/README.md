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
  getting-started.html    — first steps: open it and drive it
  philosophy.html         — on flow, transparency, and control
  field-guide.html        — the operator's field guide, control by control
  keyboard-guide.html     — every keyboard control
  coding-standards.html   — architecture & coding-standards guide: internals, wiring
  course-outline.html     — a CS 1XX course outline built around the machine
  99-challenges.html      — 99 challenges
  99-solutions.html       — 99 solutions, the teacher's guide
  complete-record.html    — the full build record of Loop 2.1
```

## Reading the code

The machine is self-contained in `loop21-build333.html`. Start with
**Getting Started** and the **Field Guide** to learn what the controls do, then
the **Coding Standards & Architecture Guide** for how the internals are wired.
**Philosophy** is the standalone essay on the ideas underneath; **The Complete
Record** is the long-form account of how it was built.

## Notes

- **Single file, offline.** Nothing phones home; nothing to install. Save the
  HTML and it runs forever, no network required.
- **Designed by Shea Gunther; code written with Claude.** Built nights and
  weekends from a one-room RV on a $200 laptop.
