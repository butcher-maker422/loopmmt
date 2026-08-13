# Verification Checklist — Resolved
## Appendix to L21 Staleness Audit · 28 April 2026
## Source: Build 331 code analysis

---

### V1. Full Bus Inventory ✓ RESOLVED

| Bus | Label | Type | Canvas | Role | Colors |
|-----|-------|------|--------|------|--------|
| A | Bus A | Unidirectional | canvas-bus | Internal, operator-controlled | Purple (CSS --bus-a-color) |
| B | Bus B | Unidirectional | canvas-busb | Internal, operator-controlled | Magenta-violet (CSS --bus-b-color) |
| C | Bus C | Unidirectional | canvas-busc | Internal, operator-controlled | Teal (CSS --bus-c-color) |
| D | Bus D | Unidirectional | canvas-busd | Internal, operator-controlled | Amber-gold (CSS --bus-d-color) |
| E | Bus E | Dual-channel | canvas-buse | Challenge interface | Crimson (CSS --bus-e-color) |
| F | Bus F | Dual-channel | canvas-busf | P2P Left | Electric blue (CSS --bus-f-color) |
| G | Bus G | Dual-channel | canvas-busg | P2P Right | Violet (CSS --bus-g-color) |
| H | Bus H | Dual-channel | canvas-bush | Net0 (routed network) | Amber (#c87800, custom renderColors) |
| I | Bus I | Dual-channel | canvas-busi | Net1 (routed network) | Lime (#60c020, custom renderColors) |

**Staleness audit correction:** Bus H is NOT the Challenge Bus. Bus E is the challenge interface. Bus H and I are both routed network buses with custom render colors and peer-target selectors. The Technical Reference v215 calling H "Challenge Bus (CBX)" is **contradicted** — that description belongs to Bus E. H is a network routing bus.

### V2. ALU Operations ✓ RESOLVED — ALL 17 IN UI

The HTML contains `data-op` attributes for all 17 operations:

ADD, SUB, AND, OR, XOR, NOT, SHL, SHR, NEG, INC, DEC, **MOD, ROR, ABS, NAND, NOR, XNOR**

The test suite's "11 ALU operations in HTML" assertion is **stale** — it only checks the original 11 but the build has all 17.

The Book Chapter Outline's claim that "MOD, ABS do not exist" is **contradicted** by build 331.

### V3. Filter Order Swapping ✓ RESOLVED — EXISTS

`toggleFilterOrder` function confirmed. `filterOrder` state with values `pm_first` / `tg_first` confirmed. Snapshot save/restore includes filter order. The feature exists and has UI controls.

### V4. Bus I ✓ RESOLVED

Bus I (label "Bus I") is a dual-channel network bus:
- Canvas: canvas-busi
- Sidebar section: sb-sec-busi with lime wash (#e8f5e0)
- Color: lime (#60c020 outbound, #90e040 inbound)
- Has peer selector (#busi-peer-sel)
- 38 code references
- HTML comment: "BUS I STRIP (Net1)"
- Net1 bus — pairs with Bus H (Net0)

### V5. Comparator ✓ RESOLVED — EXISTS

CSS classes confirm a distinct comparator subsystem with its own visual styling:
- `.cmp-block` container
- Dedicated flag display (`.cmp-flag-bg`, `.cmp-flag-lit-bg`)
- Writeback display (`.cmp-wb-bg`, `.cmp-wb-border`)
- Test suite confirms: "Comparator state has flags and writeback fields"

### V6. Catalog/File System — CONFIRMED IN TEST SUITE

Test suite P0 assertions confirm 16-function catalog engine: create, name, save, load, delete, sort, overwrite, timestamps, validation. The catalog system is the file management UI.

### V7. Built-in Challenges ✓ RESOLVED — 11 TOTAL

| # | ID | Name | Type |
|---|-----|------|------|
| 1 | add | Add X Numbers | Local |
| 2 | multiply | Multiply Two Numbers | Local |
| 3 | transform_nth | Transform Every Nth Value | Local |
| 4 | filter | Filter: Pass Back Matching Values | Local |
| 5 | sort | Sort Values (Low → High) | Local |
| 6 | find_max | Find the Maximum | Local |
| 7 | xor_checksum | XOR Checksum | Local |
| 8 | count_matches | Count Matches | Local |
| 9 | accumulate | Accumulate to Threshold | Local |
| 10 | chain_sum | Chain Sum | **Network** |
| 11 | bridge_crossing | ★ Bridge Crossing | **Operators Club** |

9 local + 1 networked + 1 club = 11 total.

**Open decision resolved:** The Operators Club challenge is **Bridge Crossing** (candidate 10 from the design document). The star (★) prefix in the name distinguishes it visually from other challenges.

### V8. Skins ✓ RESOLVED — 3

Dropdown options: OG, WINAMP, SUNRISE. Confirmed. No additional skins.

---

## Summary of Staleness Audit Corrections

1. **ALU operations:** Corrected from "11 in UI, 17 in code" to **all 17 in UI**. The test suite assertion is stale, not the app.
2. **Bus H role:** Corrected from "Challenge Bus (CBX)" to **network routing bus (Net0)**. Bus E is the challenge interface.
3. **Bus I coverage:** The Book Chapter Outline Chapter 19 ("Buses H and I") does cover Bus I. Only 16 of 17 docs omit it, not all 17.
4. **Challenge count:** 11 total (9 local + 1 network + 1 club). The Operators Club challenge is Bridge Crossing.
5. **Operators Club challenge decision:** Resolved — Bridge Crossing was implemented.

---

*Verification Appendix · L21 Staleness Audit · 28 April 2026*
