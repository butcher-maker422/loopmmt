# L21 Challenge-to-Module Mapping
## Computing from First Principles — Challenge Assignment Table
## 28 April 2026

---

## Decision Rules Applied

- **DR-1:** A challenge belongs in the module that teaches its primary CS concept.
- **DR-2:** Multi-concept challenges go to the module covering the MOST ADVANCED concept required.
- **DR-3:** Soft target of 10–15 challenges per module; pedagogical fit wins.
- **DR-4:** Network challenges (requiring Bus H/I or CBX) go in the networking modules (M6/M7).
- **DR-5:** ★ Bridge Crossing is the capstone in Module 8.
- **DR-6:** Exercise descriptions are self-contained.
- **DR-7:** Solutions are strategic, not procedural.

---

## Module Distribution Summary

| Module | Title | Weeks | Challenge Count |
|--------|-------|-------|-----------------|
| 1 | The Physical Reality of Data | 1–2 | 9 |
| 2 | Arithmetic and Logic | 3–4 | 15 |
| 3 | Memory and State | 5–6 | 14 |
| 4 | Algorithms as Physical Procedures | 7–8 | 13 |
| 5 | Hardware Pipelines and Parallel Operations | 9–10 | 10 |
| 6 | Networks and Protocols | 11–12 | 10 |
| 7 | Distributed Systems and Human Coordination | 13–14 | 21 |
| 8 | Integration and Reflection | 15 | 7 |
| **Total** | | | **99** |

**Notes on distribution:**
- Module 2 (15): Arithmetic/logic is the densest single-machine topic with many graduated difficulty levels.
- Module 7 (21): All multi-machine architecture challenges cluster here by necessity (DR-4). Eight are marked Not Yet Done — these are aspirational, not required coursework.
- Module 8 (7): Single capstone week. ★ Bridge Crossing (built-in, not numbered) serves as the capstone challenge alongside these seven.

---

## Full Mapping Table

| # | Challenge Name | Difficulty | Module | Primary Concept | Rationale |
|---|---------------|-----------|--------|-----------------|-----------|
| 01 | Hello, Read Head | Easy | M1 | Inject channel, circular storage | First contact with the machine; foundational |
| 02 | Forty-One Ticks | Easy | M1 | Bus transfer latency (BUS_N + BPW) | Empirical discovery of the 41-tick constant |
| 03 | The Marker Bit | Easy | M1 | 17-bit word format, sentinel values | Word structure is Week 1 content |
| 04 | All Four Loops | Easy | M1 | Loop independence | Introduces all four loops simultaneously |
| 05 | The Slow Transfer | Easy | M1 | Bit-serial transmission | Visual intuition for data movement |
| 06 | Bus Collision | Easy | M1 | Resource contention at write head | Early encounter with contention; formalized in M5 |
| 07 | The Four-Bus Mega-Loop | Medium | M5 | Multi-stage pipeline (DR-2) | Most advanced concept is pipeline design; placed per DR-2 |
| 08 | Loop Size Tax | Medium | M1 | Loop geometry, latency as distance | Extends latency concept from #02 |
| 09 | Op Count Stop | Easy | M1 | Hardware flow control, counter halt | Counter system is basic machine operation |
| 10 | Add Two Numbers | Easy | M1 | Basic ALU arithmetic, par scoring | First scored challenge; course outline places this in Week 2 |
| 11 | Zero-Pulse Inject | Medium | M2 | Selective ALU capture (DR-2) | Requires understanding ALU capture timing |
| 12 | Working Scratch Sprint | Medium | M3 | Scratch registers, capture timing | Scratch registers are introduced in Module 3 per outline |
| 13 | The Five Flags | Easy | M2 | ALU flags (Z, C, O, S, P) | Core ALU concept for Week 3 |
| 14 | Multiply by 12 | Easy | M2 | Binary multiplication, SHL decomposition | Shift-and-add discovery |
| 15 | Integer Square Root | Medium | M2 | Iterative approximation, binary search | ALU-intensive computation |
| 16 | Auto-Writeback Counter | Medium | M2 | ALU feedback loops, overflow behavior | ALU self-modification concept |
| 17 | Two's Complement Tour | Medium | M2 | Two's complement, negation | Core arithmetic representation |
| 18 | Bit Reversal | Medium | M2 | SHL/SHR interplay | Bit manipulation under constraint |
| 19 | Population Count | Medium | M2 | Bit extraction, Hamming weight | Systematic bit-level iteration |
| 20 | Long Division | Hard | M2 | Division by repeated subtraction | Fundamental arithmetic algorithm |
| 21 | GCD | Hard | M2 | Euclidean algorithm, modulo | Requires division (#20) as sub-procedure |
| 22 | Full Multiplication | Hard | M2 | Binary long multiplication | Shift-and-add efficiency |
| 23 | CRC-16 | Hard | M2 | Polynomial XOR arithmetic | Primarily ALU-intensive; data integrity formalized later |
| 24 | Floating Point, Approximately | NYD | M2 | Fixed-point format design | Arithmetic format at the limits of 16-bit words |
| 25 | Write All, Read All | Easy | M3 | Full memory utilization, read/write cycle | First memory exercise |
| 26 | The Lookup Table | Medium | M3 | Addr-read mode, indirect addressing | Array indexing at hardware level |
| 27 | Stack, Manually | Medium | M3 | Stack data structure, LIFO | Classic data structure via memory slots |
| 28 | State Machine: Traffic Light | Medium | M3 | Finite state machine, transition logic | State stored in memory slots |
| 29 | Histogram | Medium | M3 | Frequency counting, computed addresses | Addr-write via computed address |
| 30 | The Sine Table | Medium | M3 | Precomputed lookup tables, scaling | Memory as persistent lookup resource |
| 31 | Insertion Sort | Hard | M4 | In-place sorting algorithm (DR-2) | Most advanced concept is sorting → M4 |
| 32 | Ring Buffer | Hard | M3 | Circular buffer, pointer arithmetic | Data structure implemented in memory |
| 33 | Save, Corrupt, Recover | Hard | M3 | File save/load, integrity checking | File system + memory verification |
| 34 | Virtual Memory | NYD | M3 | Page tables, address translation | Memory architecture at its limits |
| 35 | Even or Odd | Easy | M2 | Pattern Matcher as bitmask | PM introduced via masking concept in Week 4 |
| 36 | The Rising Threshold | Easy | M4 | Threshold Gate, convergence | TG used for search/accumulation in M4 algorithms |
| 37 | Band-Pass Filter | Medium | M5 | TG cascade pipeline (DR-2) | Two-stage cascade is pipeline hardware |
| 38 | Powers of Two Detector | Medium | M2 | PM limits + ALU bit manipulation | Core insight is bitwise: N AND (N-1) = 0 |
| 39 | PM Rewrite Pipeline | Medium | M5 | PM rewrite mode, conditional transform | Hardware pipeline feature |
| 40 | TG Clamp | Medium | M5 | TG clamp mode, range limiting | Hardware filtering mode |
| 41 | Dynamic Mask | Hard | M5 | Runtime PM reconfiguration | Adaptive pipeline concept |
| 42 | Two-Stage PM Cascade | Hard | M5 | PM1→PM2 cascade pipeline | Hardware cascade |
| 43 | The Full Four-Stage | Hard | M5 | Full PM1→PM2→TG1→TG2 pipeline | Maximum hardware pipeline |
| 44 | Hardware Neural Threshold | NYD | M5 | Adaptive filtering, convergence | TG threshold-update at its limits |
| 45 | 100 Accumulations | Medium | M4 | Streaming arithmetic, counter halt | Long accumulation exercise |
| 46 | Fibonacci to Overflow | Medium | M4 | Iterative computation, overflow detection | Classic algorithm on the machine |
| 47 | Primes Below 200 | Medium | M4 | Trial division, sieve principles | Requires long division sub-procedure |
| 48 | LFSR Full Cycle | Hard | M4 | XOR feedback, maximal-length sequences | Algorithm with verifiable mathematical property |
| 49 | Merge Sort (Two Lists) | Hard | M4 | Merge algorithm, two-pointer technique | Sorting algorithm |
| 50 | The Midnight Run | Hard | M4 | Long-running computation, session log | Algorithmic endurance with verifiable result |
| 51 | Custom Challenge Authorship | Hard | M4 | Algorithm specification, generate/par | Course outline places this in Week 8 Extension |
| 52 | File Library | Hard | M4 | File system design, reuse strategy | Named state library for algorithmic reuse |
| 53 | Quine | NYD | M8 | Self-reference, fixed-point computation | Meta-challenge about computation itself |
| 54 | The Tour de France | NYD | M8 | Operator fluency, session continuity | Capstone endurance: challenges 01–50 in one session |
| 55 | First Contact | Easy | M6 | WebRTC SDP exchange, P2P basics | First networking exercise |
| 56 | The Buffer Demonstration | Easy | M6 | Inbound buffer, flow control | P2P buffer behavior |
| 57 | Producer-Consumer | Medium | M6 | Async producer-consumer, throughput | Sustained P2P data flow |
| 58 | Three-Machine Relay | Medium | M6 | Linear chain, relay node | Per-hop transformation |
| 59 | Agreed Protocol | Medium | M6 | Protocol design, handshaking | Custom protocol specification |
| 60 | Routed Delivery | Medium | M6 | Bus H routing, hop-through | Non-adjacent delivery via routed network |
| 61 | File Handshake | Medium | M6 | FTP offer/accept, remote state | File transfer + verification |
| 62 | Network Monitor Lab | Medium | M6 | Packet inspection, CBX protocol | Protocol observation and injection |
| 63 | Operator-as-Router | Hard | M6 | Bidirectional net bus routing | Bus H/I routing pattern; networking concept |
| 64 | Chain Sum — Perfect Score | Hard | M7 | Zero-trust verification, coordination | Distributed algorithm requiring zero errors |
| 65 | Distributed Max-Finding | Hard | M7 | Tournament algorithm, partial aggregation | Distributed reduction pattern |
| 66 | Hub Election Live | Hard | M7 | Hub election, fault tolerance | Network recovery after deliberate failure |
| 67 | The Broadcast Storm | NYD | M7 | Broadcast storm, coordinated recovery | Network saturation and drain |
| 68 | The Slow Save | Easy | M3 | Batch Write All, bit-serial save | File save mechanics at slow speed |
| 69 | The Null Slot Test | Easy | M3 | Null-slot invariant | Position preservation in file streams |
| 70 | The l21x Audit | Medium | M3 | .l21x format, human-readable hex | File format round-trip verification |
| 71 | Checkpoint System | Medium | M3 | Checkpointing, resumable computation | Intermediate state preservation via files |
| 72 | FTP: Blind Transfer | Medium | M7 | Blind data transfer, remote verification | FTP as communication channel |
| 73 | Distributed Lookup | Hard | M7 | Remote procedure call pattern | Request-response across machines |
| 74 | Content-Addressed Storage | NYD | M7 | Hash functions, collision handling | Distributed file naming via content hash |
| 75 | Pipeline Stages | Medium | M6 | Distributed pipeline, stage isolation | Multi-machine pipeline via Bus F/G |
| 76 | Parallel Sum | Medium | M7 | Map-reduce pattern, partial results | Parallel reduction across machines |
| 77 | Consensus | Medium | M7 | Distributed consensus, single-round | Agreement via symmetric broadcast |
| 78 | Distributed Sort | Hard | M7 | Distributed sorting, merge partition | Multi-round multi-machine coordination |
| 79 | The Invisible Middleman | Hard | M7 | Black box analysis, reverse engineering | Deducing a transformation from I/O pairs |
| 80 | Commit-Reveal | Hard | M7 | Commitment scheme, fairness | Cryptographic protocol at human speed |
| 81 | 5-Machine Chain Sum — Clean | Hard | M7 | Coordination at scale, zero-error | Chain Sum with five operators |
| 82 | Network-Wide XOR Checksum | Hard | M7 | Distributed checksum, XOR commutativity | Data integrity across network |
| 83 | Distributed Multiplication Table | NYD | M7 | Work partitioning, query-response | Distributed computation and storage |
| 84 | Secret Sharing | NYD | M7 | XOR secret sharing, threshold schemes | Information-theoretic security |
| 85 | Byzantine Generals | NYD | M7 | Byzantine fault tolerance | The generals problem at human speed |
| 86 | The Eight-Node Ring | NYD | M7 | Ring topology, addressing protocol | Requires machine capability not yet built |
| 87 | The Full Internet | NYD | M7 | Inter-network routing, gateway nodes | Requires multi-network membership |
| 88 | Par Hunt | Medium | M4 | Algorithmic optimization | Closing the par gap reveals architectural insight |
| 89 | The Annotated Session Log | Medium | M4 | Session log format, computation history | Pairs with algorithm debrief work in M4 |
| 90 | Teach the Machine a New Problem | Medium | M8 | Problem design, self-documenting spec | Capstone-level problem authorship |
| 91 | The Wrong Architecture | Hard | M4 | Architectural tradeoffs, efficiency | Comparing three approaches to sorting |
| 92 | Headless Run | Hard | M5 | Fully automated pipeline, hardware-as-program | Machine configured to run without operator |
| 93 | The Stress Test | Hard | M5 | Operator fluency, transition technique | Continuous operation across challenges |
| 94 | The Protocol Autopsy | Hard | M7 | Protocol analysis, packet causation | Full CBX packet trace and timeline |
| 95 | The Variant | NYD | M8 | Rule design, variant specification | Creative layer above operation |
| 96 | The Loopscript Program | NYD | M8 | Specification vs. execution | Machine-executable program authorship |
| 97 | The Impossible Protocol | NYD | M7 | Reliability limits, why TCP exists | Deliberately unsolvable; documents the gap |
| 98 | Teach a Class | NYD | M8 | Teaching as mastery test | Highest demonstration of understanding |
| 99 | The One That Isn't Here Yet | NYD | M8 | The frontier | Intentionally empty; permanent placeholder |

---

## Built-In Challenges (Not Part of the 99)

The simulator includes 11 built-in challenges. These are referenced throughout the course but are not numbered among the 99.

| # | Built-In Challenge | Type | Course Module |
|---|-------------------|------|---------------|
| 1 | Add X Numbers | Local | M1 (arithmetic basics) |
| 2 | Multiply Two Numbers | Local | M2 (binary multiplication) |
| 3 | Transform Every Nth Value | Local | M5 (pipeline/gate management) |
| 4 | Filter: Pass Back Matching Values | Local | M2/M5 (filtering) |
| 5 | Sort Values (Low → High) | Local | M4 (sorting algorithms) |
| 6 | Find the Maximum | Local | M4 (search algorithms) |
| 7 | XOR Checksum | Local | M4 (data integrity) |
| 8 | Count Matches | Local | M3 (accumulation, memory) |
| 9 | Accumulate to Threshold | Local | M4 (accumulation algorithms) |
| 10 | Chain Sum | Network | M7 (distributed algorithm) |
| 11 | ★ Bridge Crossing | Operators Club | M8 (capstone) |

---

*Challenge Mapping Table · Computing from First Principles · 28 April 2026*
*99 challenges mapped to 8 modules per Decision Rules DR-1 through DR-7*
