# The L21 Plan
## Loop 2.1 Manual Flow Computer — Product Specification and Roadmap
## Version 1 · Loop World | Shrubbery · 28 April 2026

---

## What This Is

The specification and roadmap for the Loop 2.1 Manual Flow Computer as a product ecosystem. This document governs the four content documents that ship alongside it: The Operator's Manual, Computing from First Principles, The Technical Reference & Developer Guide, and The Complete Record. Those four reference this document for product context, roadmap, and architectural decisions. This document references those four for their content.

The L21 Plan is the one document in the five-document package that was not extracted from the existing 17-source corpus. The other four compress and absorb existing material. This one synthesizes it with new material to create the product specification that never existed as a single document.

---

## The Machine

Loop 2.1 is a manual flow computer simulator. It runs in a browser as a single HTML file — 18,900 lines of vanilla JavaScript, no dependencies, no server, no build step. The operator is the program. There is no stored instruction set, no automation, no abstraction between the human and the computation. Every value injected, every bus routed, every ALU operation triggered passes through the operator's hands.

The machine computes using circular delay-line storage: data travels in loops, visible as individual bits on screen, advancing one position per clock tick. Four loops (Working, ALU, Memory, Big) hold data in motion. Nine buses (A through I) move data between loops and subsystems. An ALU performs arithmetic and logic. Pattern matchers and threshold gates filter data on the Big Loop. Sixteen memory slots provide addressable storage. Working scratch registers offer fast local caching. Five counters track machine events. A challenge system with built-in problems teaches operation through structured practice. A networking layer connects machines peer-to-peer over WebRTC.

The operator watches the data move, configures the routing, triggers the computation, and reads the results. At 1 Hz, every bit is visible. At 24 Hz — the recommended speed — the machine operates at a pace that balances comprehension with fluency. At higher speeds it becomes a blur, and the operator learns to trust the abstractions they've built through practice.

### What It Is Not

L21 is not a critique of modern computing. It is not anti-anything. It is a different vantage point on computation — one where the human is the control plane and the satisfaction comes from the doing. The correct framing is curiosity, craft, joy, and a working relationship with data as a physical thing that moves through space and time.

### The Origin

The machine began as a castle in Minecraft with a throne room computer built from redstone delay lines. The question that emerged: what does computation feel like when you do all of it yourself? That question became a browser simulator built in three weeks in March 2026 through an AI-assisted development process — what Shea Gunther later formalized as Loop MMT (Multi-Module Theory). The machine is named Loop 2.1. The methodology is named after the machine. They are connected at the root.

### The L21 ↔ Loop MMT Relationship

Loop 2.1 is the founding artifact of Loop MMT. The methodology was developed while building the machine; the machine was built using the methodology as it emerged. The L21 document format system — the four HTML skins (OG, Winamp, Sunrise, and black-and-white print) — carries the machine's component vocabulary into every document the methodology produces. The methodology's name references the machine. The machine's design philosophy ("the operator is the program") is isomorphic to the methodology's core tenet ("the operator is the coherence layer").

This is not a marketing relationship. It is a structural one. The machine and the methodology share a creator, a design philosophy, and a document format. The five-document package ships independently of the methodology, but the connection is stated plainly for anyone who finds both.

---

## Build 331 — The Stable Release

The current stable build is 331. It represents the release candidate that all five documents are written against.

### Architecture at a Glance

| Component | Count | Key Detail |
|-----------|-------|------------|
| Loops | 4 | Working (18 words), ALU (24), Memory (24), Big (48) |
| Buses | 9 | A–D internal (unidirectional), E challenge (dual), F–G P2P (dual), H–I routed network (dual) |
| ALU operations | 17 | ADD, SUB, AND, OR, NOT, XOR, SHL, SHR, NEG, INC, DEC, MOD, ROR, ABS, NAND, NOR, XNOR |
| Memory slots | 16 | 4-bit addressing, addr-read mode |
| Scratch registers | 4 | Attached to Working loop, no bus latency |
| Pattern matchers | 2 | PM1, PM2 on Big Loop with cascade |
| Threshold gates | 2 | TG1, TG2 on Big Loop with cascade |
| Counters | 5 | 25 trigger types across all loops |
| Skins | 3 | OG (default), Winamp, Sunrise |
| Built-in challenges | 11 | 9 local + 1 networked (Chain Sum) + 1 Operators Club (★ Bridge Crossing) |
| Word size | 17 bits | 1 marker + 16 data (0–65535) |
| Clock range | 1–144 Hz | Recommended: 24 Hz |
| Bus latency | 41 ticks | BUS_N (24) + BPW (17), always |
| Networking | WebRTC/PeerJS | Hub election, named networks, chat, up to 16 members |
| Lines of code | 18,900 | Single file, vanilla JS, zero dependencies |

### The Eight Tenets

The simulator's source code header contains eight design tenets that govern all development decisions. These are the machine's constitution. They are documented in The Complete Record and referenced by The Technical Reference.

### Development Phases (Completed and Remaining)

The machine was built in six phases (P0–P5) as specified in the March 2026 Handoff document. Current implementation status:

| Phase | Scope | Status |
|-------|-------|--------|
| P0 | Shared catalog engine (Files refactor) | Complete |
| P1 | Skin refactor + Scripts shell | Complete |
| P2 | Skins sub-section | Complete |
| P3 | CBX Local + Networked scripts | Complete |
| P4 | .l21s format + upload | Complete |
| P5 | Operators Club challenge | Complete |

Build 331 reflects all six phases delivered. (Inferred from test suite v8 which validates P0 catalog functions, P1 skin parsing, P3 challenge scripts, and P5 Operators Club crypto. The 23-build gap between the Handoff's v308 baseline and build 331 accounts for six phases of implementation.) The test suite (v8, 183 tests) covers structure, architecture, integration, and the Operators Club crypto system. The app stabilization pass (build 331 → release candidate) is complete.

---

## The Five-Document Architecture

Seventeen existing documents compress into five irreducible basis documents. This architecture was produced by a six-beam convergence test (audiences, content clusters, the Ur Tome precedent, temporal shelf life, commercial mapping, subtraction test) — all six beams returned the same number independently.

### Why Five

**Subtraction test:** Remove any one and the package breaks. No Manual = nobody can operate. No Course = no educational product. No Reference = nobody can extend. No Record = no soul. No Plan = no map.

**Addition test:** Try adding a sixth and it collapses into one of the five. A separate Challenges book is the practice layer of The Course. A separate Operators Club doc is a product spec inside The Plan. A separate Philosophy essay is editorial material woven into The Record.

### The Five Documents

#### Document 1: The Operator's Manual

Everything an operator needs to use the machine. Absorbs six source documents via merge-and-deduplicate: User Manual (trunk), Getting Started, Quick Start, Keyboard Guide, Field Guide, Networking Guide.

- **Audience:** Operators — anyone who wants to use L21
- **Tone:** The voice of someone who knows everything about this machine and is genuinely excited to tell you about it. Smart. Unhurried. Occasionally wry. Never condescending.
- **Ships:** Free, in the Gumroad zip alongside the simulator
- **Format:** L21 HTML (all skins)
- **Estimated size:** 180–220KB

The Manual is the onramp. It includes tutorials (Getting Started becomes Chapter 1), reference (Quick Start becomes an appendix), the complete keyboard guide, all 30 named techniques with par estimates, and the full networking chapter. The Manual assumes the reader is intelligent. The examples assume they are new.

#### Document 2: Computing from First Principles

A structured computer science course taught through the L21 machine. Absorbs three source documents via absorb-and-extend: Course Outline (structural backbone), 99 Challenges, 99 Solutions.

- **Audience:** Instructors and self-directed learners
- **Tone:** Pedagogical but not academic. The machine teaches the concepts; the text guides the discovery.
- **Ships:** $39.42 on Gumroad (may split into Student + Instructor editions at packaging)
- **Format:** L21 HTML + PDF
- **Estimated size:** 250–300KB

Eight modules, fifteen weeks, 99 challenges organized by curriculum topic. The Course teaches real computer science — binary arithmetic, memory addressing, boolean logic, pipeline design, networking — through a machine where every operation is manually performed. The CS topic cross-reference maps L21 challenges to standard CS curriculum topics.

#### Document 3: Technical Reference & Developer Guide

The complete architectural specification and development guide. Absorbs three source documents via consolidate-and-verify: Technical Reference (trunk), Coding Standards, Dev Playbook v2.

- **Audience:** Developers who want to understand, modify, or extend the machine
- **Tone:** Dense and precise. No warmth needed. The reader knows what they came for.
- **Ships:** Open — ships with the L21 Format Kit or standalone
- **Format:** L21 HTML + Markdown
- **Estimated size:** 140–170KB

Architecture constants, the four-step tick model, the complete bus inventory, all protocols (P2P wire, CBX, named networking), file formats (.loop session log, .loopscript, .l21s), the naming conventions, and the development workflow. Every constant verified against the stable build. The test suite documented as an appendix.

#### Document 4: The Complete Record

The narrative history of the machine's creation and philosophy. Absorbs two source documents via editorial-compression: Complete Record (trunk, v308), Philosophy (eleven essays woven into the narrative).

- **Audience:** Everyone — this is the soul document
- **Tone:** Personal. Reflective. The voice of the builder looking at what was built and understanding what it means.
- **Ships:** Blog, landing page, Gumroad store "About," conviction piece
- **Format:** L21 HTML + standalone web page
- **Estimated size:** 160–180KB

The prefatory note about AI stays on page one, untouched. The Philosophy essays integrate at their natural narrative moments — On Slowness when the clock is introduced, On Circles when circular storage arrives, On Flow when the operator-as-program paradigm is established. This is the one document where editorial judgment in placement choices requires operator review.

#### Document 5: The L21 Plan (This Document)

Product specification and roadmap. Synthesized from Book Chapter Outline, Operators Club Design, Handoff, and new material.

- **Audience:** The builder, evaluators, anyone assessing the product
- **Tone:** Direct. Specification, not persuasion.
- **Ships:** Internal / evaluator circulation
- **Format:** Markdown or PDF
- **Estimated size:** 40–60KB

---

## Product Lineup

### Free Products

| Product | What It Is | Role |
|---------|-----------|------|
| Loop 2.1 Simulator | The machine itself (build 331, single HTML file) | Acquisition. This is what brings people in. |
| The Operator's Manual | How to use the machine | Ships in the simulator zip. You can't have the machine without the manual. |
| The Complete Record | Why the machine exists | Landing page, blog, Gumroad "About." The conviction piece. |
| GitHub Repository | Source code + all documentation | Open source presence. Forkability. Trust. |

### Paid Products

| Product | Price | What It Is | Why This Price |
|---------|-------|-----------|----------------|
| Computing from First Principles | $39.42 | CS course taught through L21 | Educational product. The price says "this is a course." The .42 is brand. |
| L21 Document Format Kit | $9.42 | The L21 HTML format system + skins | The format is the brand carrier. Developers who want the skins. |
| Technical Reference & Developer Guide | Open | Architecture spec + dev guide | Open by default. May bundle with Format Kit. |

### The Operators Club

| Item | Cost | What You Get |
|------|------|-------------|
| Club membership | $16 (8 two-dollar bills, mailed) | Member number, postcard, monthly newsletter |
| Variant registration | $32 (16 two-dollar bills, mailed) | Official variant number in the registry |
| Cool number auctions | Varies | Reserved "interesting" member numbers, auctioned individually |

The Operators Club is a physical membership club. The completion code is cryptographic — 8 groups of 4 characters, 143 bits encoding seed, ticks, actions, wall time, and a hash. The verification tool is a standalone HTML file. The challenge is designed so that knowing the solution does not make it meaningfully easier — the operator is the program, and knowing the program doesn't let you skip being the program.

The club is maintained personally by Shea Gunther. It is not a company. It's a person in Maine with a spreadsheet, postcards, and an email list. The two-dollar-bill requirement is a self-selection filter for exactly the kind of person who would enjoy this kind of thing.

**Public record per member:** Member number, date, operator actions. That's it. No leaderboards. All stats are encoded privately in the completion code; only operator actions gets published.

### Revenue Model

The primary revenue products are the CS course ($39.42), the Format Kit ($9.42), and Operators Club membership ($16/member). The simulator ships free as the acquisition tool. The Complete Record is the conviction piece that makes people care enough to explore further.

The model is: free machine → free manual → paid education. The operator who downloads the simulator and works through the manual is the person who buys the course. The Operators Club is the community anchor — small, physical, deliberately analog.

### Pricing Note

Every price ends in .42. This is deliberate and permanent. It is the brand signal in every transaction.

---

## The Staleness Audit (Session A Findings)

The staleness audit compared all 17 source documents against build 331 and test suite v8. Key findings that affect production:

1. **Bus H role is contradicted in the Technical Reference.** The Tech Ref (v215) describes Bus H as "Challenge Bus (CBX)." In build 331, Bus E is the challenge interface. Bus H is a routed network bus (Net0). Bus I (Net1, lime) is undocumented in 16 of 17 source docs. The full verified bus inventory is in the verification appendix.

2. **All 17 ALU operations are in the UI.** The test suite's "11 ALU operations in HTML" assertion is stale — build 331 has all 17 in the HTML with `data-op` attributes. The Book Chapter Outline's claim that "MOD, ABS do not exist" is contradicted. All docs need updating to the full 17-operation list.

3. **Filter order swapping** (PM-first vs TG-first) exists in build 331 with UI controls and snapshot persistence. Undocumented.

4. **Networking Guide is effectively obsolete** at 121 builds behind.

5. **Dev Playbook is a historical document** at 329 builds behind.

6. **The Operators Club challenge is Bridge Crossing** (candidate 10). This resolves the open decision from the Handoff. The star (★) prefix distinguishes it in the UI.

Full audit: `l21-staleness-audit.md` + `l21-verification-results.md`

---

## Production Timeline

```
COMPLETE    Mining map (staleness audit)
COMPLETE    The L21 Plan (this document)
            |
SESSIONS C–F (parallelizable, any order):
            |
    C: THE MANUAL (Document 1)
       Merge-and-deduplicate, 6 sources
       Heaviest compression — advisory-tab session
       NOTE: Networking chapter is rebuild, not merge
            |
    D: THE COURSE (Document 2)
       Absorb-and-extend, 3 sources
       Advisory-tab session (curriculum integration)
            |
    E: THE REFERENCE (Document 3)
       Consolidate-and-verify, 3 sources
       Dispatchable as Work Order if mining map detail is sufficient
       NOTE: Bus inventory and protocols require app verification first
            |
    F: THE RECORD (Document 4)
       Editorial-compression, 2 sources
       Advisory-tab session (editorial judgment required)
       Lightest production of the four
            |
SESSION G:  CROSS-DOCUMENT REVIEW
            All five read together
            Contradictions, redundancy, cross-references,
            voice consistency, version-pin accuracy
            |
SHIP        Update Gumroad, GitHub, landing page
```

**Total remaining sessions:** 4–6 depending on parallelism.

---

## Verification Checklist — ALL RESOLVED

All items resolved via code analysis of build 331. Full results in `l21-verification-results.md`.

1. ✅ Full bus inventory — 9 buses verified. A–D unidirectional, E–I dual-channel. E=challenge, F–G=P2P, H–I=routed network.
2. ✅ ALU operations — all 17 in UI. Test suite assertion was stale.
3. ✅ Filter order swapping — exists with UI controls and snapshot persistence.
4. ✅ Bus I — Net1 routed network bus, lime, dual-channel with peer selector.
5. ✅ Comparator — exists as distinct subsystem with flags and writeback.
6. ✅ Catalog system — 16-function engine confirmed by test suite.
7. ✅ 11 built-in challenges (9 local + 1 networked + 1 Operators Club).
8. ✅ 3 skins (OG, Winamp, Sunrise).

**All pre-production gates cleared. Content document production (Sessions C–F) is unblocked.**

---

## Open Decisions

These decisions remain open from the Handoff document and the production process. None block the current production sessions except where noted.

### Operators Club (from Handoff §4)

| Decision | Options | Blocks |
|----------|---------|--------|
| ~~Which challenge?~~ | **RESOLVED: Bridge Crossing** (★ prefix in UI) | — |
| Member number format | 5-digit, 6-digit, prefixed | Club launch |
| P.O. box or home address | — | Club launch |
| Email platform for newsletter | — | Club launch |
| Launch timing | Club at launch or post-launch | — |

### Product (from production process)

| Decision | Context | Blocks |
|----------|---------|--------|
| Course split | Student edition (no solutions) vs Instructor edition (with solutions) vs single edition | Document 2 packaging |
| Technical Reference distribution | Open/free vs bundled with Format Kit | Document 3 packaging |
| GitHub repo structure | Source + docs in one repo vs separate | Ship |

---

## What Happens to the 17 Source Documents

All seventeen existing documents are reclassified as SOURCE MATERIAL after their content is absorbed into the five basis documents. They are not deleted — they are archived as the historical record of L21's documentation evolution. The five basis documents are the living package; the seventeen are the fossil record.

The GitHub repository (`sheagunther/l21-sim`) is the public home. The five basis documents ship alongside the simulator. The seventeen source documents may be preserved in an `archive/` directory for historical reference.

---

*The L21 Plan · Version 1 · Loop World | Shrubbery · 28 April 2026*
*Produced: Session B of the L21 Five-Document Production Plan*
*Sources: Book Chapter Outline, Operators Club Design, Handoff (Catalog/Scripts/Club), Staleness Audit, new synthesis*
*© 2026 Shea Gunther · CC BY-NC 4.0*
