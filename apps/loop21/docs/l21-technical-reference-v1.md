# L21 Technical Reference & Developer Guide
## Loop 2.1 Manual Flow Computer — Build 332
## Version 1 · 28 April 2026

---

# Part 1: Architecture

## 1.1 Machine Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `BPW` | 17 | Bits per word: 1 marker bit + 16 data bits |
| `BUS_N` | 24 | Bus capacity in bits |
| `INJ_N` | 17 | Injection channel width in bits |
| `NET_MAX_MEMBERS` | 16 | Maximum peers in a named network |
| `MAX_TICK_COUNT` | 1,000,000,000 | Tick counter ceiling |
| `KEYBINDING_CHORD_TIMEOUT_MS` | 2000 | Chord input window |
| `DOUBLE_TAP_THRESHOLD_MS` | 300 | Double-tap detection threshold |

## 1.2 Word Structure

Every data word in L21 is 17 bits wide. Bit 16 (the highest) is the marker bit; bits 15–0 carry the data payload. The data field represents an unsigned integer in the range 0–65535. The marker bit distinguishes occupied positions from empty ones during bus transfer and loop inspection.

## 1.3 The Four Loops

Data in L21 exists in circular delay-line storage. Four loops hold data in constant motion, advancing one position per clock tick.

| Loop | Label | Capacity (words) | Capacity (bits) | Role |
|------|-------|-------------------|------------------|------|
| Working | W | 18 | 306 | Primary operator workspace. Attached to scratch registers and injection channel. |
| ALU | A | 24 | 408 | Arithmetic/logic processing loop. Source and destination for ALU operations. |
| Memory | M | 24 | 408 | Addressable storage loop. 16 memory slots, 4-bit addressing, addr-read mode. |
| Big | B | 48 | 816 | Inspection loop. Pattern matchers (PM1, PM2) and threshold gates (TG1, TG2) operate here. |

Total capacity: 114 words (1,938 bits).

Loop data is visible on screen as individual bits. At 1 Hz, every bit transition is observable. At the recommended 24 Hz, operation balances comprehension with fluency. Clock range: 1–144 Hz.

## 1.4 The Nine Buses

Buses move data between loops and subsystems. L21 has nine buses organized into three tiers: internal (unidirectional), challenge (dual-channel), and network (dual-channel).

### Bus Inventory

| Bus | Type | Role | Canvas ID | Color | CSS Variable / Render |
|-----|------|------|-----------|-------|----------------------|
| A | Unidirectional | Internal, operator-controlled | `canvas-bus` | Purple | `--bus-a-color` |
| B | Unidirectional | Internal, operator-controlled | `canvas-busb` | Magenta-violet | `--bus-b-color` |
| C | Unidirectional | Internal, operator-controlled | `canvas-busc` | Teal | `--bus-c-color` |
| D | Unidirectional | Internal, operator-controlled | `canvas-busd` | Amber-gold | `--bus-d-color` |
| E | Dual-channel | Challenge interface | `canvas-buse` | Crimson | `--bus-e-color` |
| F | Dual-channel | P2P Left | `canvas-busf` | Electric blue | `--bus-f-color` |
| G | Dual-channel | P2P Right | `canvas-busg` | Violet | `--bus-g-color` |
| H | Dual-channel | Net0 (routed network) | `canvas-bush` | Amber | Custom renderColors (`#c87800`) |
| I | Dual-channel | Net1 (routed network) | `canvas-busi` | Lime | Custom renderColors (`#60c020`) |

### Bus Types

**Unidirectional (A–D).** Single-direction transfer between two endpoints selected by the operator. These are the general-purpose routing buses. The operator configures source and destination loops, enables the bus, and data transfers on the next tick cycle.

**Dual-channel (E–I).** Two independent channels (outbound and inbound) supporting bidirectional communication. Each channel has its own canvas visualization. Dual-channel buses are used for challenge I/O (E), peer-to-peer connections (F, G), and routed networking (H, I).

### Bus Latency

All bus transfers incur a fixed latency of **41 ticks**, computed as `BUS_N (24) + BPW (17)`. This is invariant — it does not depend on clock speed, bus type, or transfer direction. An operator working at 24 Hz waits approximately 1.7 seconds per bus transfer.

### Network Buses (H, I)

Buses H and I are routed network buses with peer-target selectors. They do not use standard CSS color variables; instead, they use custom `renderColors` applied at the canvas level.

- **Bus H (Net0):** Amber (`#c87800` outbound). Sidebar section `sb-sec-bush`. Routed to a selected network peer.
- **Bus I (Net1):** Lime (`#60c020` outbound, `#90e040` inbound). Sidebar section `sb-sec-busi` with lime wash (`#e8f5e0`). Routed to a selected network peer via `#busi-peer-sel`.

Both H and I have `peerTarget` fields and peer selector UI controls. They pair as the two network routing buses: Net0 and Net1.

## 1.5 Architecture Diagram (Logical)

```
                    ┌──────────────────────────────────────┐
                    │           INJECTION (17 bits)         │
                    └────────────────┬─────────────────────┘
                                     │
                    ┌────────────────▼─────────────────────┐
                    │        WORKING LOOP (18 words)        │
                    │   ┌──────────────────────────────┐   │
                    │   │  Scratch Registers (4 slots)  │   │
                    │   └──────────────────────────────┘   │
                    └────────┬──────────────────┬──────────┘
                             │                  │
                     Buses A–D            Buses A–D
                             │                  │
                    ┌────────▼──────┐   ┌──────▼──────────┐
                    │  ALU LOOP     │   │  MEMORY LOOP     │
                    │  (24 words)   │   │  (24 words)      │
                    │               │   │  16 slots, 4-bit │
                    │  17 operations│   │  addressing      │
                    │  5 flags      │   │                  │
                    │  Comparator   │   │                  │
                    └───────────────┘   └─────────────────┘
                             │                  │
                     Buses A–D            Buses A–D
                             │                  │
                    ┌────────▼──────────────────▼──────────┐
                    │         BIG LOOP (48 words)           │
                    │  PM1 → PM2 → TG1 → TG2 (cascade)    │
                    │  Filter order: PM-first / TG-first    │
                    └──────────────────────────────────────┘
                             │
              ┌──────────────┼──────────────────┐
              │              │                  │
         Bus E          Buses F, G         Buses H, I
         Challenge      P2P Left/Right     Net0/Net1
         (dual)         (dual)             (dual, routed)
              │              │                  │
         Challenge       Peer Machine      Network Peers
         Engine          (direct)          (hub-routed)
```

---

# Part 2: Subsystems

## 2.1 ALU (Arithmetic Logic Unit)

The ALU operates on data in the ALU loop. It performs 17 operations across four categories: binary arithmetic, bitwise logic, unary transforms, and extended operations. All operations work on 16-bit unsigned data (the marker bit is preserved but not operated on).

### Operation Table

| # | Operation | Mnemonic | Type | Description |
|---|-----------|----------|------|-------------|
| 1 | `ADD` | Addition | Binary | Sum of two operands. Carry flag set on overflow past 65535. |
| 2 | `SUB` | Subtraction | Binary | First operand minus second. Carry flag set on underflow (borrow). |
| 3 | `AND` | Bitwise AND | Binary | Each result bit is 1 only if both input bits are 1. |
| 4 | `OR` | Bitwise OR | Binary | Each result bit is 1 if either input bit is 1. |
| 5 | `XOR` | Bitwise XOR | Binary | Each result bit is 1 if the input bits differ. |
| 6 | `NOT` | Bitwise NOT | Unary | Inverts all 16 data bits. |
| 7 | `SHL` | Shift Left | Unary | Shifts all bits left by one position. Lowest bit becomes 0. Highest bit shifts into carry. |
| 8 | `SHR` | Shift Right | Unary | Shifts all bits right by one position. Highest bit becomes 0. Lowest bit shifts into carry. |
| 9 | `NEG` | Negate | Unary | Two's complement negation. Equivalent to NOT + INC. Sets carry. |
| 10 | `INC` | Increment | Unary | Adds 1 to the operand. Carry flag set on overflow. |
| 11 | `DEC` | Decrement | Unary | Subtracts 1 from the operand. Carry flag set on underflow. |
| 12 | `MOD` | Modulo | Binary | Remainder of first operand divided by second. Sets carry. |
| 13 | `ROR` | Rotate Right | Unary | Rotates all bits right by one position. Lowest bit wraps to highest position. Sets carry. |
| 14 | `ABS` | Absolute Value | Unary | If the value is negative (two's complement interpretation), negates it. Sets carry. |
| 15 | `NAND` | Bitwise NAND | Binary | NOT(AND). Each result bit is 0 only if both inputs are 1. |
| 16 | `NOR` | Bitwise NOR | Binary | NOT(OR). Each result bit is 1 only if both inputs are 0. |
| 17 | `XNOR` | Bitwise XNOR | Binary | NOT(XOR). Each result bit is 1 if the input bits are the same. |

### Operation Groups

**Unary operations** (`UNARY_OPS`): NOT, SHL, SHR, NEG, INC, DEC, ROR, ABS. These require a single operand.

**Carry-setting operations** (`CARRY_OPS`): NEG, INC, DEC, ROR, ABS, MOD. These modify the carry flag as a side effect.

### ALU Flags

The ALU maintains five status flags, updated after every operation:

| Flag | Set When |
|------|----------|
| Zero | Result is 0 |
| Carry | Arithmetic overflow/underflow or shift/rotate output |
| Overflow | Signed overflow detected |
| Sign | Bit 15 of the result is 1 (negative in two's complement) |
| Parity | Result has an even number of 1-bits |

## 2.2 Comparator

The comparator is a distinct subsystem separate from the ALU. It compares two values and maintains its own state.

**Components:**
- Comparator block container (`.cmp-block`)
- Flag display with lit/unlit states (`.cmp-flag-bg`, `.cmp-flag-lit-bg`)
- Writeback display (`.cmp-wb-bg`, `.cmp-wb-border`)

The comparator has both flags (comparison result indicators) and writeback fields (values written back to a destination). It operates independently of the ALU flags.

## 2.3 Pattern Matchers (PM1, PM2)

Two pattern matchers operate on the Big Loop. Each inspects passing words and triggers when a word matches a configured pattern.

- **PM1:** First-stage pattern matcher.
- **PM2:** Second-stage pattern matcher. Operates in cascade with PM1.

Cascade behavior: PM1 inspects first; if PM1 triggers, PM2 may inspect the same word for a secondary match. The cascade enables compound filtering — match on one criterion, then refine on another.

Pattern matchers participate in the eject pipeline: `PM1 → PM2 → TG1 → TG2`. Eject indices are assigned sequentially through this pipeline.

## 2.4 Threshold Gates (TG1, TG2)

Two threshold gates operate on the Big Loop. Each inspects passing words and triggers when a word's value exceeds (or meets) a configured threshold.

- **TG1:** First-stage threshold gate.
- **TG2:** Second-stage threshold gate. Operates in cascade with TG1.

Cascade behavior mirrors the pattern matchers: TG1 inspects first, TG2 refines.

## 2.5 Filter Order

The Big Loop inspection pipeline has a configurable filter order. Two modes:

- **PM-first** (`pm_first`): Pattern matchers inspect before threshold gates. Pipeline order: PM1 → PM2 → TG1 → TG2.
- **TG-first** (`tg_first`): Threshold gates inspect before pattern matchers. Pipeline order: TG1 → TG2 → PM1 → PM2.

Filter order is toggled via `toggleFilterOrder`. The current filter order is persisted in snapshots and restored on snapshot load. UI controls expose this toggle to the operator.

## 2.6 Memory

Sixteen addressable memory slots provide persistent (within a session) storage. Addressing is 4-bit (0–15). Memory operates in addr-read mode: a memory address is set, and the value at that address is read into or written from the Memory loop.

The Memory loop (24 words) circulates data continuously. Memory slot access is synchronized with the loop's rotation.

## 2.7 Working Scratch Registers

Four scratch registers are attached directly to the Working loop. They provide fast local caching with no bus latency — data moves between the Working loop and scratch registers without traversing a bus.

Scratch registers are useful for holding intermediate values during multi-step computations where the 41-tick bus latency would be prohibitive.

## 2.8 Counters

Five counters track machine events. Each counter can be configured with trigger conditions drawn from 25 trigger types spanning all four loops. Counters respond to events such as bus drains, bus ejects, loop rotations, and subsystem activations.

Counter trigger types include per-bus drain and eject events, enabling fine-grained instrumentation of data flow.

## 2.9 Injection Channel

The injection channel is a 17-bit (`INJ_N`) input interface for inserting data into the Working loop. The operator enters a value (0–65535); the injection channel formats it as a 17-bit word (marker bit + 16 data bits) and inserts it into the Working loop at the next available position.

Injection is the primary mechanism for introducing new data into the machine. All external data enters through this channel.

## 2.10 RNG

A random number generator produces values on demand. The RNG output feeds into the injection channel, providing a source of non-deterministic data for challenges and experimentation.

## 2.11 Sound

An optional sound subsystem uses the Web Audio API to provide auditory feedback for machine events. Sound generation is independent of the tick engine.

---

# Part 3: The Tick Engine

## 3.1 Overview

The L21 tick engine advances the machine state by one discrete step per clock tick. Each tick executes a fixed sequence of phases. The engine is implemented in `executeOneTick`, which has a confirmed Read/Gate/Write phase structure.

## 3.2 The Tick Cycle

Each tick proceeds through the following phases in strict order:

### Phase 0: Preamble

Pre-tick housekeeping. Counter states are sampled. Pending bus transfers are checked. The tick count is incremented.

### Phase 1: Sample

Subsystems sample their inputs. Pattern matchers and threshold gates on the Big Loop read the current word at their inspection point. The ALU reads its operand(s) from the ALU loop.

### Phase 2: Read → Gate → Write

The core three-step phase structure confirmed by the test suite:

1. **Read:** Data is read from loop positions and bus channels. Bus transfers in progress deliver their payload after the latency period (41 ticks) has elapsed.
2. **Gate:** Logic is evaluated. ALU operations execute. Pattern matcher and threshold gate comparisons resolve. Eject decisions are made. Flags are updated. The comparator evaluates.
3. **Write:** Results are written back to loops and bus channels. Ejected values are routed. Memory writes commit. Scratch register updates apply.

### Phase 3: Rotate

All four loops advance by one position. Every word moves one slot forward in its loop. This is the mechanical heartbeat of the delay-line architecture — data is always in motion.

## 3.3 Bus Transfer Mechanics

A bus transfer proceeds as follows:

1. The operator configures a bus: selects source loop, source position, destination loop, destination position, and enables the bus.
2. On the next tick, the source value is read onto the bus.
3. The value propagates for 41 ticks (`BUS_N + BPW = 24 + 17`).
4. After 41 ticks, the value is written to the destination.

During propagation, the value is visible on the bus canvas. The bus occupies its full capacity (`BUS_N = 24` bit positions) during transfer.

Dual-channel buses (E–I) support simultaneous outbound and inbound transfers on their two independent channels.

## 3.4 Peripheral Tick Sequence

Beyond the core loop and bus machinery, each tick also processes:

- Counter trigger evaluation (all 5 counters, all configured trigger types)
- Snapshot state capture (if a snapshot save is in progress)
- Network message processing (if connected to a network)
- Challenge state evaluation (if a challenge is active)
- UI canvas updates (all loop and bus visualizations)
- Session log entry (if logging is active)

## 3.5 Clock Control

The clock runs at a configurable rate from 1 Hz to 144 Hz. At 1 Hz, each tick is individually observable. At 24 Hz (recommended), operation is fluid but comprehensible. Above 24 Hz, the operator increasingly relies on counters, pattern matchers, and threshold gates rather than direct visual inspection.

The clock can be paused, single-stepped, and resumed. Single-step mode is essential for debugging and for understanding bus transfer timing.

---

# Part 4: Networking

## 4.1 Transport Layer

L21 networking is built on WebRTC via the PeerJS library. All peer communication is browser-to-browser with no application server. PeerJS provides signaling; once a connection is established, data flows directly between peers over WebRTC data channels.

## 4.2 Hub Election

When multiple peers join a named network, one peer is elected as the hub. The hub coordinates message routing for the routed network buses (H, I). Hub election is automatic and transparent to the operator.

The hub is not a privileged node in terms of computation — it runs the same machine as every other peer. Its additional responsibility is message forwarding for network bus traffic.

## 4.3 Named Networks

Peers connect by joining a named network. The network name serves as the rendezvous identifier. Up to `NET_MAX_MEMBERS` (16) peers can join a single named network.

The `netState` object tracks the current network configuration: connected peers, hub identity, network name, and connection status.

## 4.4 P2P Buses (F, G)

Buses F and G provide direct peer-to-peer data transfer.

- **Bus F (P2P Left):** Electric blue. Direct channel to a connected peer.
- **Bus G (P2P Right):** Violet. Direct channel to a connected peer.

P2P buses establish a direct WebRTC data channel between two specific peers. Data placed on Bus F outbound at one machine arrives on Bus F inbound at the connected peer (and vice versa). The same applies to Bus G.

These buses bypass the hub — they are point-to-point connections.

## 4.5 Network Buses (H, I)

Buses H and I provide routed network communication through the hub.

- **Bus H (Net0):** Amber. Routed through the hub to a peer selected via the peer-target selector.
- **Bus I (Net1):** Lime. Routed through the hub to a peer selected via `#busi-peer-sel`.

Unlike P2P buses, network buses can target any peer in the named network, not just a directly connected partner. The hub forwards traffic to the specified peer target.

Both buses have independent peer-target selectors, allowing the operator to route H and I to different peers simultaneously.

## 4.6 Chat

A text chat system operates alongside the machine networking. Chat messages are broadcast to all members of the named network. The chat system is independent of the bus architecture — it uses the same WebRTC connections but does not consume bus bandwidth or tick cycles.

## 4.7 Network Monitor (Netmon)

The network monitor provides real-time visibility into network state: connected peers, message traffic, hub identity, and connection health. Netmon is a diagnostic tool for operators debugging network behavior.

## 4.8 CBX Protocol

The Challenge Bus Exchange (CBX) protocol enables networked challenges — problems that require multiple machines to cooperate. CBX operates over Bus E (the challenge interface bus) and coordinates through a defined message sequence.

### CBX Message Types

| Message | Direction | Purpose |
|---------|-----------|---------|
| `DISCOVERY` | Broadcast | Announces availability for a networked challenge. |
| `PROBE` | Directed | Queries a specific peer's readiness and configuration. |
| `PROBE_RETURN` | Response | Returns probe results to the requesting peer. |
| `CHAIN_INVITE` | Directed | Invites a peer to join a challenge chain. |
| `CHAIN_GO` | Broadcast | Signals all chain members to begin the challenge simultaneously. |
| `CHAIN_COMPLETE` | Broadcast | Signals that the chain challenge has been completed. |

### Chain Sum Challenge

The Chain Sum challenge (the sole networked built-in challenge) uses the full CBX protocol sequence: DISCOVERY to find peers, PROBE to verify readiness, CHAIN_INVITE to assemble the chain, CHAIN_GO to start, and CHAIN_COMPLETE to signal finish. Each machine in the chain computes a partial sum and passes its result to the next machine via the network buses.

---

# Part 5: File Formats

## 5.1 `.loop` — Session Log Format

The `.loop` format records a machine session as a timestamped log. It uses a dual-column format: one column for machine events (tick counts, bus transfers, ALU operations) and one for operator annotations. The log captures the full history of a session in a human-readable text format.

Session logs are the primary record of machine operation. They capture what happened, when it happened, and (via annotations) why the operator did it.

## 5.2 `.loopscript` — Annotation Format

The `.loopscript` format stores annotations independently of session logs. Annotations are operator-authored notes attached to specific machine states or tick ranges. They can be saved, loaded, and shared.

The annotation system enables collaborative analysis: one operator runs a session, another annotates it. The `.loopscript` file travels independently of the `.loop` session it annotates.

## 5.3 `.l21s` — Challenge Script Format

The `.l21s` format defines challenge scripts. A challenge script specifies:

- Challenge metadata (name, ID, type, difficulty)
- Initial machine configuration (bus settings, memory contents, counter triggers)
- Input data (values to inject via the challenge bus)
- Expected output (values to validate against)
- Completion criteria (what constitutes a correct solution)

Challenge scripts support both local challenges (single-machine) and networked challenges (multi-machine via CBX). The `.l21s` format supports upload — operators can load custom challenges into the simulator.

## 5.4 Snapshot Format

Snapshots capture the complete machine state at a point in time: all four loop contents, all bus configurations, all subsystem settings (ALU operation, pattern matcher patterns, threshold gate thresholds, memory contents, counter configurations, filter order), scratch register values, and UI state. Snapshots support save and restore.

Snapshot persistence includes filter order state (`pm_first` or `tg_first`), ensuring that restoring a snapshot returns the machine to the exact configuration it was in when saved.

---

# Part 6: Skin System

## 6.1 Architecture

The skin system provides complete visual theming via CSS variable replacement. Each skin defines a set of CSS custom properties that control every visual aspect of the simulator: colors, fonts, borders, backgrounds, spacing, and component styling.

Skins are parsed from `SKIN_SOURCE` strings by the `parseSkinSource` function. Each skin source string encodes the full set of CSS variable overrides for that skin.

## 6.2 The Three Foundational Skins

| Skin | ID | Description |
|------|-----|-------------|
| OG | `OG` | The original skin. Default. The machine as it was first built. |
| Winamp | `WINAMP` | Inspired by the classic media player aesthetic. |
| Sunrise | `SUNRISE` | A lighter, warmer palette. |

The skin selector is a dropdown in the UI. Skin changes apply immediately — all CSS variables are rewritten and the UI re-renders.

## 6.3 CSS Variable Theming

Skins control the simulator's appearance exclusively through CSS custom properties. No skin modifies HTML structure or JavaScript behavior. This separation ensures that every skin produces an identical machine — only the visual presentation changes.

The bus color variables (`--bus-a-color` through `--bus-g-color`) are skin-controlled for buses A–G. Buses H and I use custom `renderColors` that are applied at the canvas level rather than through CSS variables.

## 6.4 Skin Source Strings

Each skin is defined as a `SKIN_SOURCE` string — a serialized representation of all CSS variable key-value pairs for that skin. The `parseSkinSource` function deserializes this string into a CSS variable map and applies it to the document root.

This architecture supports future skin creation: any valid `SKIN_SOURCE` string that maps the required CSS variables produces a functional skin.

---

# Part 7: Catalog Engine

## 7.1 Architecture

The catalog engine is the file management subsystem (P0 implementation). It provides a 16-function API for managing saved machine states, challenge scripts, and session files.

The catalog operates through `CATALOG_CONFIGS` (configuration objects defining catalog behavior) and `catalogState` (runtime state tracking the current catalog contents and selection).

## 7.2 Engine Functions

The catalog engine exposes 16 functions covering the full file management lifecycle:

1. **Create** — Initialize a new catalog entry.
2. **Name** — Assign or rename a catalog entry.
3. **Save** — Persist the current machine state to a catalog entry.
4. **Load** — Restore machine state from a catalog entry.
5. **Delete** — Remove a catalog entry.
6. **Sort** — Reorder catalog entries by name, date, or other criteria.
7. **Overwrite** — Replace an existing catalog entry with current state.
8. **Timestamps** — Track creation and modification times for each entry.
9. **Validation** — Verify catalog entry integrity before load.
10. **List** — Enumerate all catalog entries.
11. **Select** — Set the active catalog entry.
12. **Export** — Serialize a catalog entry for external storage.
13. **Import** — Deserialize an external catalog entry.
14. **Duplicate** — Copy an existing catalog entry.
15. **Clear** — Remove all catalog entries.
16. **Stats** — Report catalog size and usage metrics.

The test suite (P0 assertions) confirms the 16-function engine: create, name, save, load, delete, sort, overwrite, timestamps, and validation are all independently tested.

---

# Part 8: Coding Standards

## 8.1 Namespace

All L21 code lives under the `L21` namespace. There is no module system, no import/export, no build step. The simulator is a single HTML file (18,900 lines of vanilla JavaScript). The namespace is the organizational boundary.

## 8.2 Naming Conventions

### Function Prefixes

Functions follow a prefix system that encodes their subsystem and purpose. The prefix identifies which part of the machine a function belongs to, enabling navigation of a 700+ function codebase without a module system.

Examples of prefix domains: `bus` (bus operations), `alu` (ALU operations), `pm` (pattern matchers), `tg` (threshold gates), `mem` (memory), `wscr` (working scratch), `ctr` (counters), `net` (networking), `cbx` (challenge bus exchange), `cat` (catalog), `skin` (skin system), `club` (Operators Club), `snap` (snapshots), `log` (session logging), `inj` (injection).

### Variable Naming

- Constants: `UPPER_SNAKE_CASE` (e.g., `BPW`, `BUS_N`, `NET_MAX_MEMBERS`)
- State objects: `camelCase` (e.g., `netState`, `catalogState`, `filterOrder`)
- DOM IDs: `kebab-case` (e.g., `canvas-bus`, `sb-sec-bush`, `busi-peer-sel`)
- CSS variables: `--kebab-case` (e.g., `--bus-a-color`, `--bus-net0-color`)
- CSS classes: `.kebab-case` (e.g., `.cmp-block`, `.cmp-flag-bg`)

### File Extensions

| Extension | Purpose |
|-----------|---------|
| `.html` | The simulator (single file) |
| `.loop` | Session log |
| `.loopscript` | Annotations |
| `.l21s` | Challenge script |

## 8.3 Function Documentation

Every function should be documented with:
- A single-line description of what it does
- Parameter names and types (JSDoc-style)
- Return value description
- Side effects (state mutations, DOM updates, network messages)

Functions that modify global state must document which state objects they touch.

## 8.4 State Management

L21 uses a flat state architecture. State objects are plain JavaScript objects at the top level of the `L21` namespace. There is no state management library, no observable pattern, no proxy layer.

Key state objects include:
- Loop contents (arrays of 17-bit words)
- Bus configurations (source, destination, enable state)
- ALU state (current operation, flags, operands)
- Comparator state (flags, writeback fields)
- Pattern matcher state (patterns, enable flags, cascade mode)
- Threshold gate state (thresholds, enable flags, cascade mode)
- Memory state (16 slots, current address)
- Scratch register state (4 values)
- Counter state (5 counters, trigger configurations)
- Filter order (`pm_first` or `tg_first`)
- Network state (`netState`)
- Catalog state (`catalogState`)
- Skin state (current skin ID, parsed CSS variables)

State is mutated directly. The tick engine reads and writes these objects on every cycle. The UI reads them for rendering. Snapshot save/restore serializes and deserializes the full state tree.

## 8.5 Architecture Rules

1. **No dependencies.** The simulator has zero external dependencies at runtime. PeerJS is the sole exception (networking); the machine runs fully offline without it.
2. **No build step.** The source file is the distribution file. There is no transpilation, bundling, or minification.
3. **Single file.** All HTML, CSS, and JavaScript live in one `.html` file. This is a design constraint, not a limitation — it guarantees that the machine is always complete and self-contained.
4. **Vanilla JavaScript.** No frameworks, no libraries (except PeerJS for networking). DOM manipulation is direct.
5. **No abstraction between operator and computation.** Every value injected, every bus routed, every ALU operation triggered passes through the operator's hands. There is no automation layer, no macro system, no stored program.

---

# Part 9: Development Guide

This section extracts development principles from the Dev Playbook v2. The Playbook is 329 builds behind the stable release; all specific procedures (build steps, deployment steps, testing steps) are stale and omitted. The principles that follow reflect the architectural philosophy, not the procedural workflow.

## 9.1 AI-Assisted Development

L21 was built through an AI-assisted development process. The human operator provides direction, design decisions, and quality judgment. The AI provides code generation, refactoring, and implementation detail. The operator is the coherence layer — the human who holds the full context of what the machine is and what it should become.

This workflow produces a characteristic development pattern: rapid iteration with frequent verification. The test suite is the ground truth for whether a change is correct.

## 9.2 Architectural Principles

### The Operator Is the Program

There is no stored instruction set. The operator manually configures every bus, triggers every ALU operation, reads every result. This is the foundational constraint. Any feature that automates the operator out of the loop violates the machine's purpose.

### Visibility Over Abstraction

Every bit is visible. Every bus transfer is shown on screen. Every loop rotation is rendered. The machine does not hide its state. Debugging is observation, not instrumentation.

### Latency Is Real

The 41-tick bus latency is not a performance limitation — it is a design feature. The latency makes data movement tangible. An operator who works with the machine learns to think in terms of pipeline stages, timing, and synchronization — the same skills that matter in real hardware design.

### Simplicity Over Cleverness

The codebase uses direct DOM manipulation, flat state objects, and explicit control flow. There are no clever abstractions. A developer reading the code should be able to trace any operation from UI event to state change to canvas render without indirection.

## 9.3 Development Workflow Principles

1. **Test before shipping.** The test suite must pass before any build is considered stable.
2. **Verify against the running app.** Code analysis is necessary but not sufficient. The app must be run and visually inspected.
3. **Constants are sacred.** Architecture constants (`BPW`, `BUS_N`, `INJ_N`, loop capacities) do not change between builds. They are the machine's dimensional constraints.
4. **Phases ship complete.** A development phase (P0–P5) ships all its features or none. Partial phases are not released.
5. **The single-file constraint holds.** All features must fit in the single HTML file. If a feature cannot be implemented within this constraint, the feature is redesigned, not the constraint.

---

# Part 10: Operators Club Crypto

## 10.1 Overview

The Operators Club is a physical membership club for operators who complete the designated club challenge (★ Bridge Crossing). Completion is verified cryptographically — the simulator generates a completion code that encodes the operator's performance and is verifiable offline.

## 10.2 Completion Code Structure

The completion code is an 8-group, 4-character string encoding 143 bits of data. Each group uses an unambiguous alphabet designed to avoid visually similar characters (no 0/O confusion, no 1/l/I confusion).

### Encoded Fields

The 143-bit encoding captures:
- **Seed (48 bits):** A pseudorandom value generated by `clubGenerateSeed48` at challenge start. Ties the code to a specific challenge instance.
- **Tick count:** The number of ticks the operator took to complete the challenge.
- **Operator actions:** The number of manual actions (bus configurations, ALU triggers, injections) performed.
- **Wall time:** Real-world elapsed time from challenge start to completion.
- **Hash (55 bits):** A verification hash computed by `clubComputeHash55` over the other fields. Prevents code forgery.

### Unambiguous Alphabet

The completion code uses a character set chosen to be unambiguous in both print and handwriting. Characters that could be confused with each other are excluded. This is a deliberate design choice — completion codes are intended to be written on postcards and mailed physically.

## 10.3 Verification

A standalone HTML verification tool accepts a completion code and validates its hash. The verification tool does not require the simulator — it is a separate file that implements only the hash verification algorithm.

Verification confirms that the code was generated by a genuine completion of the challenge. It does not confirm the operator's identity — that is established by the physical mailing process.

## 10.4 Design Philosophy

The challenge (★ Bridge Crossing) is designed so that knowing the solution does not make completion meaningfully easier. The operator is the program. Knowing the program does not let you skip being the program. The completion code cryptographically attests that someone operated the machine through the full challenge — it cannot be generated without actually doing the work.

---

# Part 11: Test Suite

## 11.1 Overview

The L21 test suite (v10, current with build 332) validates the simulator across seven categories. The suite contains 262 tests.

## 11.2 Test Categories

| Category | Scope | Description |
|----------|-------|-------------|
| **Structural** | HTML/DOM | Validates that the HTML structure is correct: all loop canvases exist, all bus canvases exist (9 buses A–I), sidebar sections are present, UI controls are wired. |
| **Logic** | ALU, Comparator | Validates all 17 ALU operations produce correct results. Validates comparator flags and writeback behavior. |
| **State** | Machine state | Validates state management: snapshot save/restore, filter order persistence, memory addressing, counter trigger configurations, scratch register operations. |
| **Phase 4** | P4 features | Validates `.l21s` challenge script format, upload functionality, and challenge execution. |
| **CSS** | Skin system | Validates skin parsing, CSS variable application, and visual theming for all three skins (OG, Winamp, Sunrise). |
| **Catalog** | P0 engine | Validates the 16-function catalog engine: create, name, save, load, delete, sort, overwrite, timestamps, validation, and related operations. |
| **Integration** | Cross-system | Validates interactions between subsystems: bus transfers completing across loops, ALU results affecting memory, challenge completion triggering Operators Club crypto, networking handshakes. |

## 11.3 Key Assertions

The following assertions represent critical architectural invariants enforced by the test suite:

- "Four loops defined" — Working, ALU, Memory, Big.
- "All nine bus canvases exist in HTML" — canvas-bus through canvas-busi.
- "11 ALU operations in HTML" — **STALE assertion.** Build 332 has all 17 ALU operations in the HTML with `data-op` attributes. The test asserts 11 because it was written before operations 12–17 were added to the UI. The test suite assertion count will be updated in a future build.
- "Five counters defined."
- "Three skins defined" — OG, Winamp, Sunrise.
- "At least 9 built-in challenges."
- "File header contains the eight tenets."
- "executeOneTick has R/G/W phase structure."
- "Comparator state has flags and writeback fields."
- "BPW equals 17," "BUS_N equals 24," "INJ_N equals 17."
- Loop capacity assertions: W=18, A=24, M=24, B=48 words.

## 11.4 Operators Club Crypto Tests

The test suite includes dedicated assertions for the Operators Club completion code system:
- `clubGenerateCompletionCode` produces valid codes.
- `clubDecodeCompletionCode` correctly decodes valid codes.
- Hash verification (`clubComputeHash55`) detects tampering.
- The unambiguous alphabet contains no visually confusable characters.

## 11.5 Running the Test Suite

The test suite is a standalone validation tool. It asserts against the simulator's HTML structure, JavaScript functions, and CSS definitions. Tests are declarative: each test specifies what should be true about the simulator at rest (before any operator interaction). Integration tests may invoke functions to verify behavior.

---

# Part 12: The Eight Tenets

The simulator's source code header contains eight design tenets. These are the machine's constitution — they govern all development decisions and define what L21 is and is not. The tenets were written by the machine's builder and are embedded in the source as a permanent record of design intent.

The eight tenets are extracted from the simulator file header. They are referenced here as the authoritative design philosophy of the machine. The Complete Record (Document 4) provides the narrative context for each tenet; this reference documents their existence and role.

The test suite enforces their presence: "File header contains the eight tenets."

---

# Appendix A: Built-in Challenges

## Challenge Inventory

| # | ID | Name | Type | Description |
|---|-----|------|------|-------------|
| 1 | `add` | Add X Numbers | Local | Sum a set of injected values. |
| 2 | `multiply` | Multiply Two Numbers | Local | Compute the product of two values. |
| 3 | `transform_nth` | Transform Every Nth Value | Local | Apply a transformation to every Nth word in a stream. |
| 4 | `filter` | Filter: Pass Back Matching Values | Local | Return only values matching a criterion. |
| 5 | `sort` | Sort Values (Low → High) | Local | Arrange values in ascending order. |
| 6 | `find_max` | Find the Maximum | Local | Identify the largest value in a set. |
| 7 | `xor_checksum` | XOR Checksum | Local | Compute the XOR of all input values. |
| 8 | `count_matches` | Count Matches | Local | Count values matching a criterion. |
| 9 | `accumulate` | Accumulate to Threshold | Local | Sum values until a threshold is reached. |
| 10 | `chain_sum` | Chain Sum | Network | Multi-machine sum using CBX protocol. |
| 11 | `bridge_crossing` | ★ Bridge Crossing | Operators Club | The club challenge. Completion generates a cryptographic code. |

9 local + 1 networked + 1 Operators Club = 11 total.

---

# Appendix B: Quick Reference

## Architecture Constants

```
BPW             = 17        (bits per word)
BUS_N           = 24        (bus capacity, bits)
INJ_N           = 17        (injection width, bits)
BUS_LATENCY     = 41        (BUS_N + BPW, ticks)
NET_MAX_MEMBERS = 16        (max network peers)
MAX_TICK_COUNT  = 1,000,000,000
CLOCK_MIN       = 1 Hz
CLOCK_MAX       = 144 Hz
CLOCK_DEFAULT   = 24 Hz
```

## Loop Dimensions

```
Working  = 18 words ×  17 bits =   306 bits
ALU      = 24 words ×  17 bits =   408 bits
Memory   = 24 words ×  17 bits =   408 bits
Big      = 48 words ×  17 bits =   816 bits
Total    = 114 words            = 1,938 bits
```

## ALU Operations (All 17)

```
Binary:  ADD  SUB  AND  OR  XOR  MOD  NAND  NOR  XNOR
Unary:   NOT  SHL  SHR  NEG  INC  DEC  ROR  ABS
```

## Bus Map

```
A  Uni   Purple         Internal
B  Uni   Magenta-violet Internal
C  Uni   Teal           Internal
D  Uni   Amber-gold     Internal
E  Dual  Crimson        Challenge
F  Dual  Electric blue  P2P Left
G  Dual  Violet         P2P Right
H  Dual  Amber          Net0 (routed)
I  Dual  Lime           Net1 (routed)
```

---

*L21 Technical Reference & Developer Guide · Version 1 · Build 332*
*Document 3 of the L21 Five-Document Package*
*© 2026 Shea Gunther · CC BY-NC 4.0*
