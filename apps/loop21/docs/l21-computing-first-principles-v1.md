# Computing from First Principles
## A Structured Computer Science Course Taught Through the Loop 2.1 Manual Flow Computer

### Document 2 of the L21 Five-Document Package
### Build 332 · April 2026

---

## About This Course

This is a hands-on computer science course. The instrument is a machine called Loop 2.1 — a manual flow computer that runs in a browser. There is no stored program. There is no automation. The operator is the program. Every value injected, every bus routed, every ALU operation triggered passes through the operator's hands.

The course is organized into eight modules spanning fifteen weeks. Each module introduces computer science concepts through direct machine experience first, then names and formalizes them. By the time a concept receives its textbook name, the student has already felt it — waited for a 41-tick bus transfer, watched a carry flag fire on overflow, debugged a protocol failure in real time across networked machines.

Ninety-nine challenges provide the practice layer. They range from two-minute exercises to multi-hour endeavors, from single-machine arithmetic to multi-machine distributed systems. Eleven built-in challenges in the simulator provide scored practice with par targets. The remaining challenges are designed for this course and documented in full in these pages.

### Who This Is For

**Instructors** teaching an introductory or second-semester CS course who want students to experience computation physically before abstracting it. The course works as a standalone semester or as a complement to a traditional curriculum.

**Self-directed learners** who want to understand computing at the level where data has position, velocity, and cost. No prerequisites beyond a willingness to work through confusion. The machine is the prerequisite.

### How to Use This Document

Each module follows the same structure: an overview of what you'll learn, a concept introduction that explains the CS ideas through the lens of the machine, exercises with setup instructions, strategic solution guidance, and reflection questions. The exercises are self-contained — you need only the simulator and this document.

Work the modules in order. Concepts build on each other. A student who skips to Module 5 without understanding bus latency from Module 1 will be lost. A student who works through Modules 1–4 methodically will find Modules 5–8 surprisingly natural.

The par system in the built-in challenges provides a formal measure of efficiency. Approaching par by the end of the course is the goal. Beating par is unusual and should not be expected in the first half.

### What You'll Learn

By the end of this course, you will have experienced — not merely read about — binary representation, memory addressing, integer arithmetic, overflow handling, boolean logic, sorting algorithms, algorithmic complexity, instruction pipelines, parallel execution, resource contention, network protocols, packet structure, distributed consensus, fault tolerance, and file systems. Every one of these concepts will have arrived through your hands on the machine before it arrived through a textbook.

### The Machine at a Glance

| Component | Detail |
|-----------|--------|
| Loops | 4: Working (18 words), ALU (24), Memory (24), Big (48) |
| Word size | 17 bits: 1 marker + 16 data (values 0–65535) |
| Buses | 9: A–D internal (unidirectional), E challenge (dual), F–G P2P (dual), H–I routed network (dual) |
| ALU operations | 17: ADD, SUB, AND, OR, XOR, NOT, SHL, SHR, NEG, INC, DEC, MOD, ROR, ABS, NAND, NOR, XNOR |
| ALU flags | 5: Zero, Carry, Overflow, Sign, Parity |
| Memory | 16 addressable slots (4-bit addressing) |
| Scratch registers | 4 on the Working loop |
| Pattern matchers | 2 (PM1, PM2) with cascade on the Big Loop |
| Threshold gates | 2 (TG1, TG2) with cascade on the Big Loop |
| Counters | 5, with 25 trigger types |
| Comparator | Distinct subsystem with flags and writeback |
| Clock | 1–144 Hz (recommended: 24 Hz) |
| Bus latency | 41 ticks always (BUS_N=24 + BPW=17) |
| Built-in challenges | 11 (9 local + 1 networked + 1 Operators Club) |
| Networking | WebRTC/PeerJS, up to 16 members, hub election, named networks, chat |
| Skins | 3: OG, Winamp, Sunrise |
| File system | 16-function catalog engine, .L21 binary snapshots, .l21x text archives |

### Course Format

Fifteen weeks. Eight modules. Two sessions per week. Prerequisites: none — a willingness to be confused for short periods and to work through that confusion.

---

# Module 1: The Physical Reality of Data

**Weeks 1–2 · 9 Challenges**

*Theme: Data is not abstract. It has location, velocity, and cost.*

## Overview

Everything starts here. In Module 1 you meet the machine, inject your first value, and discover that data is a physical thing — it has a position in a loop, it moves at a finite speed, and moving it from one place to another costs time you can measure.

By the end of this module you will understand the 17-bit word format and why the marker bit exists, the four loops and what makes them different, bus transfers and the 41-tick latency constant, the concept of instruction cost as something you pay with your own time, and the par scoring system as a formal measure of efficiency.

These are not abstract concepts in this course. They are things you will count, measure, and feel.

## Concepts: Data in Motion

### The 17-Bit Word

Every value in the machine is a 17-bit word. One marker bit — always 1 for a valid word — followed by 16 data bits representing a value from 0 to 65535. The marker bit is word punctuation. Without it, a circulating value of 0 would be indistinguishable from an empty loop position. The marker bit answers the question: "Is there a word here, or is there nothing?" That distinction matters when data travels in circles.

### Four Loops, Four Purposes

Data lives in loops — circular delay lines where bits advance one position per clock tick, visible on screen as moving light. Four loops serve different roles:

The **Working loop** (18 words, 306 bits) is your workspace. Values enter here through the inject channel. It is where you start every computation.

The **ALU loop** (24 words, 408 bits) holds the operands and results of arithmetic and logic operations. The ALU performs all 17 operations on values circulating in this loop.

The **Memory loop** (24 words, 408 bits) connects to the 16 addressable memory slots. Values written to memory pass through this loop; values read from memory arrive here.

The **Big loop** (48 words, 816 bits) is the largest. It hosts the Pattern Matchers and Threshold Gates — the hardware filtering pipeline. Data circulates here for inspection and filtering.

Each loop runs independently. You can have different values circulating in all four simultaneously. Loop size determines circulation time: at 24 Hz, the Working loop completes one revolution in about 12.75 seconds. The Big loop takes twice as long.

### Buses and the Cost of Movement

Nine buses move data between loops and subsystems. Buses A through D are internal, unidirectional, and under operator control. Bus E is the challenge interface — it connects the challenge system to the machine. Buses F and G are peer-to-peer connections to other machines. Buses H and I are routed network buses that can send data to any machine in a connected network, not just direct neighbors.

Every bus transfer takes exactly 41 ticks. This is not arbitrary — it is the physical geometry of the machine. A 17-bit word must enter a 24-position bus before the last bit can exit: 17 + 24 = 41. At 24 Hz, 41 ticks is about 1.7 seconds. That is the cost of moving one word from one loop to another. You will feel this cost every time you route a bus, and that feeling is the foundation of everything that follows.

### The Operator Is the Program

There is no stored instruction set. There is no automation layer between you and the data. You decide what operation to perform. You route the buses. You read the flags and decide what to do next. The machine computes; you control the computation. This is not a limitation — it is the design. Every cost is visible because you are the one paying it.

## Exercises

### Exercise 1.1 — Hello, Read Head
*Challenge #01 · Easy · Solo · ~2 minutes*

Open the simulator. Set the clock to 24 Hz. Type the value 42 into the inject field and press inject. Watch the Working loop. The value 42 is now circulating — 17 bits of light moving through 306 bit positions. Wait for it to reach the read head (the "R" dot on the Working loop display). When you see 42 at the read head, you are done.

Do not touch anything else. Do not route a bus. Do not open the ALU. The purpose of this exercise is to observe: you injected a value, and the loop brought it to the window. The machine does not have a destination register — it has a circulating stream and a read position.

**What to notice:** The value does not appear instantly at the read head. It takes one full revolution of the loop. At 24 Hz with 306 bit positions, that is about 12.75 seconds. That wait is the loop's circulation time, and it is the first cost you encounter.

### Exercise 1.2 — Forty-One Ticks
*Challenge #02 · Easy · Solo · ~5 minutes*

Set the clock to 1 Hz. Inject any non-zero value into the Working loop. Now configure Bus A to transfer from Working to the ALU loop. Watch the bits travel across the bus strip individually — at 1 Hz, each bit is a discrete visible event.

Count the ticks from when the first bit exits the Working read head to when the last bit enters the ALU write head. The answer is 41. Derive why: the word is 17 bits wide, the bus is 24 positions long. The word must fully enter the bus (17 ticks) and the bus must carry the last bit to the end (24 ticks). Total: 41.

**What to notice:** This is not a number to memorize. It is a number to derive. A 17-car train on a 24-position platform. If you can see why it is 41 and not 40 or 42, you understand bus latency at a level that will serve you for the rest of the course.

### Exercise 1.3 — The Marker Bit
*Challenge #03 · Easy · Solo · ~5 minutes*

Inject three values in sequence: 0, 65535, and 1. For each, watch the circulating bit pattern in the Working loop.

The value 0 is all-zero data bits — but the marker bit is still 1. The value 65535 is all-one data bits — 17 bits, all lit. The value 1 has the marker bit lit, bit 0 lit, and everything else dark.

The key question: if the marker bit did not exist, how would you distinguish "one word with value 0" from "no words at all"? Both would look like an empty loop. The marker bit solves this. It is word boundary information — it tells the machine where one word ends and the next begins.

### Exercise 1.4 — All Four Loops
*Challenge #04 · Easy · Solo · ~5 minutes*

Get a different value circulating in each of the four loops simultaneously. Working, ALU, Memory, Big — all four running at 24 Hz, each with a distinct value. No buses active when you are done.

To place a value in the ALU loop: inject into Working, route via Bus A to ALU, then disconnect the bus. Repeat for Memory (via a different bus routing path) and Big. The point is to see four independent loops, each doing its own thing, all at once.

### Exercise 1.5 — The Slow Transfer
*Challenge #05 · Easy · Solo · ~5 minutes*

Set the clock to 1 Hz. Inject a value into Working. Route Bus A from Working to ALU. Now watch every bit travel across the bus strip individually. Find the marker bit in the stream — it leads the word. Count the 17 bits of the word as they cross. When you can identify the marker, the data bits, and the gap between words as a physical stream of light, you have developed the visual intuition that the rest of the course builds on.

### Exercise 1.6 — Bus Collision
*Challenge #06 · Easy · Solo · ~8 minutes*

Configure two buses to deliver simultaneously to the Working loop. Route Bus A from ALU to Working and Bus B from Memory to Working, both active at the same time. Watch what happens when two bit streams arrive at the same write head.

Document what you observe. Is the result destructive? Predictable? What rule does the machine follow when two streams collide? This is resource contention — a concept you will formalize in Module 5, but it is important to see it early, before you understand why it matters.

### Exercise 1.7 — Loop Size Tax
*Challenge #08 · Medium · Solo · ~15 minutes*

The Working loop holds 18 words (306 bits). ALU and Memory hold 24 words (408 bits). Big holds 48 words (816 bits). Move the same value through all four loops and measure — in ticks — how long each loop takes to fully circulate one revolution.

Calculate the relationship between loop size and circulation time. Then explain to yourself why operations on the Big loop take so much longer than operations on Working. This is latency as geometry: the bigger the loop, the longer you wait for data to come around.

### Exercise 1.8 — Op Count Stop
*Challenge #09 · Easy · Solo · ~8 minutes*

Use the Op Count system (one of the five hardware counters) to automatically halt the clock after exactly 100 word reads on the Working loop. Do not manually count to 100. Configure the counter, set the halt condition, start the machine, and wait for it to stop itself.

This is your first encounter with hardware flow control — the machine monitoring its own behavior and taking action. The counter does the watching; you set the rules.

### Exercise 1.9 — Add Two Numbers
*Challenge #10 · Easy · Solo · ~10 minutes*
*Built-in challenge: "Add X Numbers"*

The canonical first scored exercise. Inject two values into the Working loop. Route them to the ALU loop via Bus A. Set the ALU operation to ADD. Trigger the computation. The result circulates in the ALU loop.

This is available as the built-in "Add X Numbers" challenge. Run it. Get your score. The score measures efficiency — total ticks and operator actions from start to correct submission. The par target tells you what an expert achieves. You will not approach par on your first attempt, and that is expected. Understanding what par means — that there exists a faster path — is the real lesson of this exercise.

## Solutions

### Strategic Guidance for Module 1

**Exercises 1.1–1.5** have no strategic depth — they are observation exercises. The "solution" is to see what the machine does. If you are uncertain whether you observed correctly, reduce the clock speed to 1 Hz and repeat. Everything becomes visible at 1 Hz.

**Exercise 1.6 (Bus Collision):** The insight is that the machine does not prevent collisions — both streams write simultaneously, and the results at the write head depend on bit-level timing. This is not a bug; it is how the hardware works. In a real CPU, write arbitration circuits prevent this. In Loop 2.1, the operator prevents it by not routing two buses to the same destination.

**Exercise 1.7 (Loop Size Tax):** Circulation time is proportional to loop capacity in bits. Working (306 bits) circulates in 306 ticks. Big (816 bits) circulates in 816 ticks — 2.67× longer. This directly affects how long you wait for a value to reach the read head. Every algorithm you build later must account for this cost.

**Exercise 1.8 (Op Count Stop):** The counter is the simplest form of hardware automation in the machine. Set the trigger type to "word reads on Working," set the count to 100, set the action to "halt clock." The counter watches; you set and forget. Every counter-based exercise in later modules builds on this pattern.

**Exercise 1.9 (Add Two Numbers):** The inefficient path: inject value 1, wait for it to circulate, route to ALU, wait for transfer, inject value 2, route to ALU, wait, then trigger ADD. The efficient path: inject both values before routing, so the bus carries both in a single transfer. The difference in tick count reveals the first optimization principle — minimize bus transfers, because each one costs 41 ticks.

## Reflection Questions

1. You waited about 1.7 seconds for a bus transfer to complete. In Python, adding two numbers takes less than a microsecond. What was the 1.7 seconds teaching you that the microsecond was not?

2. The marker bit uses one of your 17 bits for every word in the machine. That is about 6% of every word's capacity spent on punctuation rather than data. Is that cost worth paying? What would fail without it?

3. The four loops have different sizes. If you could redesign the machine with loops of any size, what would you change and why? What tradeoffs would you consider?

---

# Module 2: Arithmetic and Logic

**Weeks 3–4 · 15 Challenges**

*Theme: Computation is transformation. The ALU is a transformer.*

## Overview

The ALU — the Arithmetic Logic Unit — is where computation happens. In Module 2 you learn what it can do, what it tells you about what it did, and how to build complex operations from simple ones. By the end of this module you will understand all 17 ALU operations, the five condition flags and what each means, binary multiplication via shift-and-add, two's complement representation and negation, bitwise logic and masking, and the Pattern Matcher as a hardware bitmask filter.

The ALU has no hidden behavior. Every operation takes the same input (the values in its registers), applies one transformation, and produces one output plus flag updates. There are no shortcuts. Multiplication is repeated shifting and adding. Division is repeated subtraction. The operator builds every complex operation from primitives, and in doing so discovers why computers work the way they do.

## Concepts: The ALU and Its Operations

### Seventeen Operations

The ALU supports seventeen operations. The original eleven — ADD, SUB, AND, OR, XOR, NOT, SHL, SHR, NEG, INC, DEC — cover basic arithmetic, bitwise logic, and single-operand transforms. Six additional operations — MOD, ROR, ABS, NAND, NOR, XNOR — extend the machine's capability into modular arithmetic, rotation, absolute value, and the complemented logic gates.

**Arithmetic:** ADD (addition), SUB (subtraction), INC (increment by 1), DEC (decrement by 1), NEG (two's complement negation), ABS (absolute value), MOD (modulo/remainder).

**Bitwise logic:** AND, OR, XOR, NOT (complement), NAND (not-and), NOR (not-or), XNOR (exclusive-nor, equivalence).

**Shifts and rotation:** SHL (shift left, multiply by 2), SHR (shift right, divide by 2), ROR (rotate right, wrapping the lowest bit to the top).

Each operation reads from the ALU registers, computes, and writes the result back. The five flags (Zero, Carry, Overflow, Sign, Parity) update after every operation to describe what happened. The operator reads the flags and decides what to do next — the flags do not trigger automatic branching.

### The Five Flags

**Zero (Z):** The result is exactly 0. Fires when SUB produces equality, when AND produces no overlapping bits, or any operation that zeroes out.

**Carry (C):** The unsigned result exceeded 16 bits. ADD 65535 + 1 produces 0 and fires Carry — the result wrapped around.

**Overflow (O):** The signed result crossed the sign boundary. ADD 32767 + 1 produces 32768 and fires Overflow — the sign bit flipped.

**Sign (S):** Bit 15 of the result is 1. In signed interpretation, the result is negative.

**Parity (P):** The number of 1-bits in the result is even.

Carry and Overflow are different. Carry is the unsigned boundary (the result would require 17+ bits). Overflow is the signed boundary (the result changed sign unexpectedly). Learning to read and react to each flag correctly is a core skill of this module.

### Auto-Writeback: The ALU as a Self-Running Machine

When Auto-Writeback is enabled, the ALU continuously applies its current operation to the value in its register and writes the result back. Set the operation to INC and seed with 0: the ALU counts upward automatically — 0, 1, 2, 3... until it overflows at 65535, wraps to 0, and continues. Set the operation to SHL and seed with 1: the ALU doubles — 1, 2, 4, 8, 16... until the 1-bit shifts past bit 15 and the value becomes 0 forever.

Auto-Writeback turns the ALU configuration into a program. The operation is the instruction. The loop circulation is the clock. This is the skeleton of a stored-program machine — the difference is that here the operator sets the operation, not a stored instruction.

### Pattern Matching as Bitmask Filtering

The Pattern Matcher (PM1, located on the Big loop) examines each word that passes through and compares selected bits against a target pattern. You configure a mask (which bits to inspect) and a pattern (what those bits should be). Words that match are ejected to a destination; words that do not match continue circulating.

This is bitmasking as physical hardware. When you configure PM1 with mask 0x0001 and pattern 0x0000, you are saying: "Look at bit 0 only. If it is 0, the value is even — eject it." That is the same operation as `value & 1 == 0` in any programming language, but here you watch it happen bit by bit on a physical stream.

## Exercises

### Exercise 2.1 — Zero-Pulse Inject
*Challenge #11 · Medium · Solo · ~15 minutes*

Inject two values into the Working loop, separated by a zero-pulse injection (a single word with value 0 inserted mid-stream). Route the loop to the ALU. Your goal: capture only one of the two values into the ALU, not both. Use the zero-value word as your signal — when you see it at the read head, you know the boundary between the two values. Time your ALU capture accordingly.

The zero-pulse is a separator. In a stream of words where you cannot see boundaries (all words are just numbers), inserting a known sentinel gives you timing information. This is the first time you use a data value not for its arithmetic content but for its role as a signal.

### Exercise 2.2 — The Five Flags
*Challenge #13 · Easy · Solo · ~12 minutes*

Trigger all five ALU flags — Zero, Carry, Overflow, Sign, Parity — in a single session. For each flag, document which operation produced it and exactly what values were involved.

Suggested approach: Zero from SUB (equal operands), Carry from ADD (65535 + 1), Overflow from ADD (32767 + 1), Sign from NEG (negate a small positive value), Parity from ADD (produce a result with an even number of 1-bits). You should know what each flag means before you encounter a challenge that requires you to react to one.

### Exercise 2.3 — Multiply by 12
*Challenge #14 · Easy · Solo · ~15 minutes*

Compute N × 12 for any input value N using only the available ALU operations. Repeated addition is not permitted — find the decomposition that uses the fewest operations.

The insight: 12 = 8 + 4 = 2³ + 2². Compute N × 4 using two SHL operations. Save that result to a memory slot. Compute N × 8 using three SHL operations. Add the saved N × 4. The result is N × 12, computed with five operations instead of eleven additions.

This is binary multiplication. Any constant multiplication reduces to a sum of left shifts when you decompose the constant into powers of 2. The number 12 in binary is 1100 — bits 3 and 2 are set, so two shifted copies suffice.

### Exercise 2.4 — Integer Square Root
*Challenge #15 · Medium · Solo · ~30 minutes*

Given a value N in the Working loop, compute floor(√N) — the largest integer whose square does not exceed N. You cannot use a table. You must compute it.

You will need a multiplication sub-procedure (shift-and-add) and a comparison strategy. The naive approach (increment a candidate from 1 upward, testing candidate² ≤ N each time) works but takes up to 255 iterations. The efficient approach (binary search between 1 and 256, halving the range each step) takes about 8 iterations. Both produce the correct answer — the difference in tick count is the lesson.

### Exercise 2.5 — Auto-Writeback Counter
*Challenge #16 · Medium · Solo · ~20 minutes*

Configure the ALU with Auto-Writeback and demonstrate three modes: INC (counting upward), SHL (doubling), and ADD with a constant in register B (skip-counting). For each mode, document what happens when the value overflows 16 bits.

INC wraps at 65535 → 0 and continues. SHL terminates when the 1-bit exits bit 15 (result becomes 0 and stays 0). ADD with constant wraps modulo 65536. Each mode tells you something different about how arithmetic behaves at the boundary.

### Exercise 2.6 — Two's Complement Tour
*Challenge #17 · Medium · Solo · ~15 minutes*

Take the value 1000. Negate it with the NEG operation. Confirm the result is 64536 (the two's complement negation: 65536 − 1000 = 64536). Add the original and the negated value — the result should be 0, and the Zero flag should fire.

Then compute the absolute value of a negative-looking value (one with bit 15 set). Check the Sign flag; if set, apply NEG. The ABS operation does this directly — verify that ABS produces the same result as your manual check-and-negate procedure.

### Exercise 2.7 — Bit Reversal
*Challenge #18 · Medium · Solo · ~25 minutes*

Take a 16-bit value and produce its bit-reversal: bit 15 becomes bit 0, bit 14 becomes bit 1, and so on. The value 0b1100000000000000 should produce 0b0000000000000011.

The procedure: 16 iterations. Each iteration extracts the LSB of the source (AND with 1), shifts the accumulator left (SHL), ORs in the extracted bit, then shifts the source right (SHR). After 16 passes, the accumulator holds the reversed value. You will need two memory slots — one for the source (shifted right each pass) and one for the accumulator (shifted left and ORed each pass).

### Exercise 2.8 — Population Count
*Challenge #19 · Medium · Solo · ~35 minutes*

Given a 16-bit value N, count the number of 1-bits in its binary representation (the Hamming weight). The result must be in the Working loop when done.

The method is structurally identical to Bit Reversal: 16 iterations, each extracting the LSB (AND with 1), adding it to an accumulator, then shifting the source right. After 16 passes the accumulator holds the population count. This is systematic bit extraction — the pattern appears in many later challenges.

### Exercise 2.9 — Long Division
*Challenge #20 · Hard · Solo · ~1 hour*

Divide A by B, producing both quotient and remainder. Both results must be simultaneously available (in separate memory slots) when you declare completion. Works correctly for any A, B where B > 0.

The naive approach is repeated subtraction: while remainder ≥ divisor, subtract and increment the quotient. This is correct but takes A ÷ B iterations — potentially thousands for large dividends and small divisors. The efficient approach adapts the shift-and-subtract algorithm (O(16) iterations regardless of value magnitude). Both are valid; par rewards the faster one.

### Exercise 2.10 — GCD
*Challenge #21 · Hard · Solo · ~1.5 hours*

Compute the greatest common divisor of two values A and B using Euclid's algorithm: repeatedly replace the larger value with (larger mod smaller) until one becomes zero; the other is the GCD.

This requires Long Division (#20) as a sub-procedure to compute the modulo operation. The algorithm is recursive in structure but implemented iteratively: save B, compute A mod B, set A = old B, set B = remainder, repeat.

### Exercise 2.11 — Full Multiplication
*Challenge #22 · Hard · Solo · ~1 hour*

Compute A × B for arbitrary 8-bit values using the binary shift-and-add algorithm. For each bit of B (LSB first): if the bit is 1, add the current shifted A to the accumulator. Then shift A left and shift B right. After 8 iterations the accumulator holds A × B.

Repeated addition takes M iterations for N × M. Binary shift-and-add takes 8 iterations always. For N = 1000, M = 1000: that is 1000 iterations versus 8. This is the reason computers are fast at multiplication, and you will discover it by building it.

### Exercise 2.12 — CRC-16
*Challenge #23 · Hard · Solo · ~2 hours*

Compute a CRC-16 checksum over 8 values in memory using the standard CRC-16/BUYPASS polynomial (0x8005). This requires implementing polynomial long division over GF(2) using XOR and SHL.

For each input value: XOR it into the high byte of the CRC register. Then run an 8-bit inner loop: if the MSB of the register is 1, shift left and XOR with 0x8005; otherwise just shift left. After all values are processed, the register holds the CRC. This is a real error-detection algorithm implemented at the hardware level.

### Exercise 2.13 — Floating Point, Approximately
*Challenge #24 · Not Yet Done · Solo · 3+ hours*

Design a fixed-point number system using 16 bits and implement addition and multiplication in your format. Compute 3.75 × 1.5 = 5.625 and verify the result.

This challenge has not been demonstrated at par. The difficulty: two Q8.8 fixed-point values multiplied give a Q16.16 result that must be right-shifted back to Q8.8, discarding half the precision. After two sequential multiplications the result degrades significantly. Understanding why this happens — and what a 32-bit accumulator would fix — is the pedagogical goal even if the full challenge proves intractable.

### Exercise 2.14 — Even or Odd
*Challenge #35 · Easy · Solo · ~10 minutes*

Configure PM1 (Pattern Matcher 1) on the Big loop to route only even values from a mixed stream into the ALU loop, discarding odd values. Set the mask to 0x0001 (inspect bit 0 only) and the pattern to 0x0000 (match when bit 0 is zero). Load a stream of mixed values into the Big loop. Enable PM1. Even values eject; odd values remain.

This is the `value % 2 == 0` test implemented as a hardware filter. One mask, one pattern, zero ALU involvement. The Pattern Matcher is doing what would be a conditional branch in software — but it does it continuously on the circulating stream without any operator action after configuration.

### Exercise 2.15 — Powers of Two Detector
*Challenge #38 · Medium · Solo · ~25 minutes*

Detect whether a value is a power of two. A power of two has exactly one bit set. Can you do this with the Pattern Matcher alone?

The answer reveals the limits of static pattern matching: a single PM mask cannot express "exactly one of 16 possible bit positions is set" — that would require 16 different patterns. You would need to run 16 sequential PM configurations, one per power of two. The ALU approach is far more elegant: compute N AND (N − 1). If the result is 0, N is a power of two. One operation, all powers detected. The contrast between the PM approach (16 passes) and the ALU approach (1 operation) teaches when to use hardware filtering versus when to use arithmetic.

## Solutions

### Strategic Guidance for Module 2

**Exercises 2.1–2.2** build flag literacy. The ability to read a flag and know what it means without looking it up is essential. If you cannot instantly distinguish Carry from Overflow by the end of this module, go back and trigger both deliberately until the distinction is felt, not memorized.

**Exercises 2.3–2.8** build a pattern: decompose a complex operation into primitives, track intermediate state in memory or scratch registers, and iterate. The specific pattern — extract, accumulate, shift — appears in bit reversal, population count, multiplication, and CRC computation. Recognizing this pattern is more valuable than memorizing any individual procedure.

**Exercises 2.9–2.12** are hard because they require sub-procedures. Long division requires comparison (SUB + Sign flag). GCD requires long division. Full multiplication requires the shift-and-add loop. CRC requires XOR, SHL, and conditional branching via flag inspection. These challenges reward the student who builds reusable techniques, not the student who approaches each as isolated.

**Exercise 2.14 (Even or Odd):** The Pattern Matcher's power is in continuous, zero-operator filtering. Once configured, it runs every time a word passes through — no button press per word. The ALU approach requires per-word operator action. For large streams, the PM wins on operator action count. For single values, the ALU wins on simplicity. Both are "correct" — the choice depends on context.

**Exercise 2.15 (Powers of Two):** The key insight — N AND (N − 1) = 0 for powers of two — is a classic bit manipulation trick. Students who discover it independently have entered the domain of bit-level thinking. Students who recognize that the PM cannot express this condition efficiently have understood the limits of static hardware filtering.

## Reflection Questions

1. You built multiplication from SHL and ADD, and division from SUB and comparison. A modern CPU has dedicated MUL and DIV circuits. What did building these operations from primitives teach you about what those circuits are actually doing?

2. The ALU's flags do not trigger automatic branches — you read them and decide. In a CPU, flags trigger conditional jumps automatically. What are the advantages of each approach? What does the manual approach force you to understand?

3. The Pattern Matcher can filter a stream without operator intervention. The ALU requires the operator to act on each value. When would you choose hardware filtering over arithmetic? When would arithmetic be better?

---

# Module 3: Memory and State

**Weeks 5–6 · 14 Challenges**

*Theme: Memory is where computation lives between operations.*

## Overview

So far, all your data has been transient — circulating in loops, moving through buses, transformed by the ALU. In Module 3 you discover persistence: 16 addressable memory slots that hold values between operations, scratch registers that provide fast local caching, and a file system that survives across sessions.

By the end of this module you will understand addressable memory and 4-bit addressing, the difference between transient loop data and persistent slot data, register files and why they exist alongside main memory, addressing modes including addr-read (indirect addressing), state machines implemented with memory as the state register, and the file system — .L21 binary snapshots, .l21x text archives, the null-slot invariant, and the catalog engine.

## Concepts: Persistence and Addressing

### Sixteen Slots, Four-Bit Addresses

The Memory subsystem has 16 slots, addressed with 4 bits (0000 through 1111, or 0 through 15). Each slot holds one 16-bit value. Write mode stores a value at a specified address. Read mode retrieves it. Auto-increment advances the address after each operation, enabling sequential reads or writes without manual address management.

This is the smallest possible addressable memory system that demonstrates all the concepts: addressing, read/write cycles, and the fundamental distinction between "a value circulating in a loop" (transient, moving, no address) and "a value in a slot" (persistent, addressed, stationary until overwritten).

### Addr-Read: Indirect Addressing

In addr-read mode, the Memory subsystem interprets an incoming data word as an address. You inject the number 7 into the loop; the Memory system reads it not as a value but as an instruction — "retrieve the contents of slot 7." The word selects the slot. The data chooses its own destination.

This is array indexing at the hardware level. When you write `table[i]` in a programming language, the runtime performs an address calculation and a memory fetch. On this machine, you do both visibly: compute the address in the ALU, route it to Memory in addr-read mode, and watch the addressed value emerge.

### Scratch Registers: Fast Local Storage

Four Working Scratch registers sit on the Working loop with zero bus latency. No 41-tick transfer — capture and release are immediate (within the loop's own circulation time). Scratch registers exist because sometimes you need to hold a value briefly while you compute something else, and a full memory round trip is too expensive.

This is the memory hierarchy in miniature. Scratch registers are fast but few (4). Memory slots are slower (require bus transfer) but more numerous (16). The Big loop can hold data in transit (48 words of circulation space). The cost model — scratch vs. memory vs. loop — mirrors the register/cache/RAM hierarchy of a real computer.

### The File System: Surviving the Tab Close

The machine forgets everything when the browser tab closes. Every loop empties. Every memory slot resets. The file system is how computation persists across sessions.

**Batch Write All** streams all 16 memory slots to a file. The operator names the file, triggers the batch write, and watches the 16-word stream travel across the bus strip — each word taking 41 ticks. The file appears in the `/local` catalog.

**Loading** a file reverses the process: 16 words stream through the Memory loop's writeback pipeline and populate the slots in order.

**The null-slot invariant:** Empty slots produce marker=1, data=0 — they are not skipped. This preserves position information. Slot 5 is always the sixth word in the stream, whether it contains a meaningful value or is empty. Without this invariant, a file with values in slots 0, 4, and 12 would produce only 3 words, and the loader would not know which slots to fill.

**The .l21x archive** is a human-readable hex format. You can open it in any text editor, read the values, modify them, and import the file back. The format is designed to be auditable by hand.

## Exercises

### Exercise 3.1 — Working Scratch Sprint
*Challenge #12 · Medium · Solo · ~12 minutes*

Capture four different values into the four Working Scratch registers without letting any circulate back to the main loop. Then release them in reverse order — slot 4 first, slot 1 last. Verify the correct order by watching the read head. This is a LIFO exercise using the fastest storage in the machine.

### Exercise 3.2 — Write All, Read All
*Challenge #25 · Easy · Solo · ~15 minutes*

Load a distinct value into every one of the 16 memory slots (try 100, 200, 300... 1600). Switch to read mode with auto-increment. Stream all 16 back to the Working loop in order. Verify each against what you stored. No slot skipped, no value wrong. This is the baseline memory exercise — confirm you can use every slot reliably before attempting anything more complex.

### Exercise 3.3 — The Lookup Table
*Challenge #26 · Medium · Solo · ~20 minutes*

Pre-load slots 0–15 with a mapping: slot N contains the value (N × 7) mod 100. Then switch to addr-read mode. Inject a query value Q (0–15) into the loop. The Memory system interprets Q as an address and ejects the contents of slot Q. This is a hardware lookup table — array indexing at the hardware level.

### Exercise 3.4 — Stack, Manually
*Challenge #27 · Medium · Solo · ~30 minutes*

Use memory slots 0–7 as a stack. Maintain a stack pointer in a Working Scratch register (initialized to 0). Push: write to M[SP], SP++. Pop: SP−−, read M[SP]. Push five values in order, then pop them and verify LIFO order. The stack pointer must track the current top at all times.

### Exercise 3.5 — State Machine: Traffic Light
*Challenge #28 · Medium · Solo · ~25 minutes*

Implement a three-state machine (Red=0 → Green=1 → Yellow=2 → Red) using memory slots. Store the current state in slot 0. Store the transition table in slots 10–12 (next[Red]=Green, next[Green]=Yellow, next[Yellow]=Red). When a 1 arrives in Working, advance the state via addr-read of the transition table. When a 0 arrives, hold. The current state is always readable from slot 0.

### Exercise 3.6 — Histogram
*Challenge #29 · Medium · Solo · ~35 minutes*

Inject 16 values, each in the range 0–3. Use memory slots 0–3 as count buckets. For each value: addr-read the corresponding slot to get the current count, increment via the ALU, addr-write back. After all 16 values, the four buckets contain the frequency distribution. This is computed addressing — the data value selects the memory slot.

### Exercise 3.7 — The Sine Table
*Challenge #30 · Medium · Solo · ~40 minutes*

Pre-load memory with 16 sine values for angles 0° through 337.5° in 22.5° steps, scaled so sin(90°) = 1000. Negative values are stored as two's complement (sin(210°) = −500 → stored as 65036). Given an angle index Q, retrieve sin(Q) via addr-read. For cosine: cos(Q) = sin(Q + 4) because 4 steps × 22.5° = 90°.

### Exercise 3.8 — Ring Buffer
*Challenge #32 · Hard · Solo · ~1.5 hours*

Implement an 8-slot circular ring buffer in memory slots 0–7. Use two scratch registers as read and write pointers and a third for the count. Implement all four operations: enqueue (write to M[write_ptr], advance, count++), dequeue (read M[read_ptr], advance, count−−), full detection (count = 8), and empty detection (count = 0). Pointer wrapping at 8 requires modular arithmetic — if pointer + 1 ≥ 8, subtract 8.

### Exercise 3.9 — Save, Corrupt, Recover
*Challenge #33 · Hard · Solo · ~45 minutes*

Build a 16-slot memory state with specific values. Compute a checksum (XOR all 16 values together). Save the state to a .L21 file. Deliberately corrupt two slots. Recompute the checksum — it should differ. Load the saved file. Recompute the checksum again — it should match the original. This demonstrates what the file system does and does not guarantee: it restores exactly what you saved, but it has no built-in integrity checking. The checksum is your guarantee, computed manually both times.

### Exercise 3.10 — Virtual Memory
*Challenge #34 · Not Yet Done · Solo · 4+ hours*

Simulate a 32-slot address space using 8 slots as physical RAM and 8 slots as a page table. Implement address translation and a simple eviction policy. Demonstrate a page fault and recovery.

This challenge exposes a fundamental mismatch: the page table itself consumes half the available memory, leaving little room for actual data. Understanding why this is impractical — and what a real memory management unit provides — is the pedagogical goal. A student who implements 4-address mapping with page fault recovery has achieved something genuine.

### Exercise 3.11 — The Slow Save
*Challenge #68 · Easy · Solo · ~10 minutes*

Set the clock to 4 Hz. Fill all 16 memory slots with distinct values. Name a file. Trigger Batch Write All to the FILE SAVE destination on Bus A. Watch every word of the 16-word stream travel across the bus strip at 4 Hz. Watch the word counter in the armed panel advance: 1/16, 2/16... 16/16. This is your memory becoming a file. Stay present for all 41 × 16 ticks of it. At 4 Hz, that is about 164 seconds — nearly three minutes of watching data become persistent.

### Exercise 3.12 — The Null Slot Test
*Challenge #69 · Easy · Solo · ~15 minutes*

Load values into memory slots 0, 4, 8, and 12 only — leave the rest empty. Save to a file. Load it back. Verify that the four populated slots contain their original values AND that the empty slots are still empty. This is the null-slot invariant in action: empty slots transmit as marker=1, data=0 rather than being skipped. Position is preserved because silent slots are not silent — they are explicit zeros.

### Exercise 3.13 — The l21x Audit
*Challenge #70 · Medium · Solo · ~20 minutes*

Save 3 files to /local. Export the folder as a .l21x archive. Open the archive in a text editor. Read the hex values. Manually verify that slot 5 of file 2 matches what you stored. Modify one value in the text editor. Import the archive back. Confirm the change landed in the correct slot. The .l21x format is designed to be human-auditable — audit it.

### Exercise 3.14 — Checkpoint System
*Challenge #71 · Medium · Solo · ~45 minutes*

Run a long computation (at least 10 minutes). Every time you reach a meaningful intermediate state, save a checkpoint file with a meaningful name (STEP-01, STEP-02, etc.). After completing the computation, demonstrate that you can restore any checkpoint and resume from that state. The file system is your undo history — but only if you name your checkpoints well enough to know which state each represents.

## Solutions

### Strategic Guidance for Module 3

**Memory exercises (3.2–3.7)** establish the pattern: write values, compute addresses, read values. The key insight is that addr-read mode turns data into addresses — the value in the loop selects the slot. This is indirect addressing, and it is how arrays, lookup tables, and function dispatch work in every computing system.

**The Stack (3.4):** The stack pointer is the critical state. Every push and pop must update it correctly. The most common error is off-by-one: pushing to the wrong slot because the pointer was incremented before the write instead of after (or vice versa). Decide on a convention (pointer points to the next empty slot, or to the top occupied slot) and maintain it consistently.

**The State Machine (3.5):** Encoding the transition table in memory and using addr-read for state transitions is the key architectural insight. The state machine runs without conditional logic in the ALU — the memory lookup performs the branching. This is table-driven programming at the hardware level.

**The Ring Buffer (3.8):** The hardest part is modular pointer arithmetic. After incrementing a pointer, check if it reached 8 (SUB 8, check Sign flag). If not negative, the pointer wrapped and you keep the subtracted value. If negative, add 8 back. This is modulo via arithmetic, not via a dedicated MOD instruction — though the MOD operation is available and would simplify this.

**File exercises (3.11–3.14):** The lesson is that persistence has a cost. Saving takes 41 × 16 = 656 ticks. Loading takes the same. At 24 Hz, that is about 27 seconds per save or load. A checkpoint every 2 minutes means spending about 10% of your time on persistence. This cost/benefit calculation mirrors real-world decisions about checkpoint frequency in long-running systems.

## Reflection Questions

1. The Working Scratch registers have zero bus latency. Memory slots require a 41-tick bus transfer. What computation would you restructure to use scratch registers instead of memory? At what point does the 4-register limit force you back to the slower memory?

2. The file system uses a null-slot invariant — empty slots produce explicit zeros rather than being skipped. What would break if empty slots were simply omitted from the stream? Design a scenario where position-preserving zeros matter.

3. You implemented a state machine using a lookup table in memory. A modern CPU implements state machines using conditional jumps in stored code. What are the advantages of each approach? What does the memory-based approach make easy that the code-based approach makes hard?

---

# Module 4: Algorithms as Physical Procedures

**Weeks 7–8 · 13 Challenges**

*Theme: An algorithm is a plan for moving data. Elegance is measurable.*

## Overview

In Module 4, computation shifts from single operations to multi-step algorithms. You will sort values, search for extremes, accumulate running totals, and discover that the difference between a correct algorithm and an efficient one is measurable in ticks and operator actions.

By the end of this module you will understand sorting algorithms (implemented manually, then hardware-assisted), algorithmic complexity as something you feel rather than compute, search strategies and their costs, checksums and data integrity, the par scoring system as a formal optimization target, and custom challenge authorship as algorithm specification.

The midterm falls at the end of this module: a timed challenge session with a written debrief explaining every significant decision.

## Concepts: Algorithms You Can See

### Sorting: From Brute Force to Hardware-Assisted

Sorting 8 values in the Big loop by hand — manual comparison, swap, repeat — leads most students to independently discover selection sort. Each pass through the loop finds the minimum, extracts it, places it in order. O(n²) comparisons, O(n) passes.

The Threshold Gate offers a hardware shortcut: set TG1 to pass values greater than or equal to a rising threshold. Each pass extracts the current minimum (or maximum, depending on configuration). The comparison is performed by the hardware, not by the operator — the same O(n²) complexity but significantly fewer operator actions.

The difference between the manual approach and the TG-assisted approach is the lesson. Both are correct. Both are O(n²). But one requires the operator to perform every comparison; the other delegates comparisons to hardware. This is the fundamental distinction between software and hardware algorithms.

### The Par System

The built-in challenges include a par target — the tick count and operator action count that an expert achieves. Par is not a theoretical minimum; it is an achieved score. It represents a specific approach that uses the machine's features efficiently.

Closing the gap between your score and par is the optimization process. Each gap-closing insight — "I could use auto-writeback instead of manual capture," "I could route both operands in one bus transfer" — reveals an architectural feature you were not yet using. Par is a teaching tool, not a grading tool.

### Checksums: Verifying Without Seeing

The XOR Checksum challenge introduces data integrity: given a sequence of values, compute a single value that changes if any input changes. XOR all values together — the result is a fingerprint. Change one input value and the fingerprint changes. This is the simplest possible integrity check, and it is the same principle behind CRC, MD5, and every checksum system.

### Algorithm Specification: The Generate/Par Contract

In Week 8, you write a custom challenge definition: a `generate(params)` function that produces challenge values and a correct answer, and a `par(result, params)` function that specifies the expert score. The machine validates both — eight structural checks, five dry runs, 50ms timeout.

This exercise forces you to specify an algorithm precisely enough that a machine can verify it. What are the inputs? What is the output? What counts as correct? What is efficient? Writing the specification is harder than implementing the algorithm, and that discovery is the point.

## Exercises

### Exercise 4.1 — Insertion Sort
*Challenge #31 · Hard · Solo · ~1 hour*

Load 8 values into memory slots 0–7. Sort them in ascending order in-place using insertion sort. For each element at position i (starting at 1), save as "key," scan backward through the sorted portion, shift larger elements right, and insert the key in its correct position. Track indices in scratch registers. Compare via SUB and the Sign flag. The Threshold Gate is available as a comparator if you want to use it.

### Exercise 4.2 — The Rising Threshold
*Challenge #36 · Easy · Solo · ~10 minutes*

Configure TG1 with an initial threshold of 100 and threshold-update enabled. Circulate a stream of values through it. Each passing value raises the threshold to that value. Watch the threshold climb. Observe when it stops passing values entirely. The final threshold is the maximum of all values that exceeded 100. This is a hardware search — find-the-max without a loop.

### Exercise 4.3 — 100 Accumulations
*Challenge #45 · Medium · Solo · ~30 minutes*

Inject 100 values (range 1–10) and compute their running sum, storing the result in slot 0 after each addition. Use a counter to halt after 100 reads. The efficient approach: use Auto-Writeback to maintain the running total in the ALU register, avoiding the round trip to memory for each addition.

### Exercise 4.4 — Fibonacci to Overflow
*Challenge #46 · Medium · Solo · ~40 minutes*

Compute the Fibonacci sequence: F(1)=1, F(2)=1, F(n)=F(n−1)+F(n−2). Continue until the next value would overflow 16 bits. Detect the overflow using the Carry flag (not by watching for a negative-looking result). Store values in memory as you go. F(24)=46368 is the last value that fits; F(25)=75025 overflows.

### Exercise 4.5 — Primes Below 200
*Challenge #47 · Medium · Solo · ~1.5 hours*

Find all primes below 200 using trial division. Pre-load divisor primes 2, 3, 5, 7, 11, 13 in slots 0–5 (sufficient since √199 < 15). For each candidate from 2 to 199, test divisibility against each stored prime using long division. If any divides evenly, the candidate is composite. This requires the Long Division sub-procedure from Exercise 2.9.

### Exercise 4.6 — LFSR Full Cycle
*Challenge #48 · Hard · Solo · ~1.5 hours*

Implement a 16-bit maximal-length LFSR with a feedback polynomial (e.g., taps at bits 15 and 13). Each step: compute the feedback (XOR of tapped bits), shift the register right, insert the feedback at bit 15. Run for 256 steps, storing every 16th value in memory. A 16-bit maximal-length LFSR visits all 65535 non-zero values before repeating.

### Exercise 4.7 — Merge Sort (Two Lists)
*Challenge #49 · Hard · Solo · ~1.5 hours*

Two pre-sorted lists of 4 values each occupy slots 0–3 and 4–7. Merge them into a single sorted 8-value list in slots 8–15 using the merge algorithm: compare front elements, write the smaller to the output, advance that pointer. Do not sort the combined output after the fact — the merge must be visibly incremental.

### Exercise 4.8 — The Midnight Run
*Challenge #50 · Hard · Solo · 20+ minutes*

Design a computation that takes at least 20 minutes of continuous machine operation at 24 Hz. It must produce a verifiable result in memory when it finishes. You decide what it computes. Suitable candidates: Collatz sequence from N=27 (111 steps, peaks at 9232), running max over 1000 LFSR values, or a long-message CRC-16. Write a session log the entire time. The log is as important as the result.

### Exercise 4.9 — Custom Challenge Authorship
*Challenge #51 · Hard · Solo · ~1.5 hours*

Write a complete custom challenge definition with a `generate(params)` function, a `par(result, params)` function, and configurable parameters. The challenge must pass the validator (8 structural checks, 5 dry runs). Register it, run it, solve it yourself, then exchange it with another operator. If they need to ask a clarifying question, the definition is not yet self-documenting — revise until it is.

### Exercise 4.10 — File Library
*Challenge #52 · Hard · Solo · ~1 hour*

Build a library of 8 carefully named files in /local, each representing a reusable memory state: a lookup table, a working constant set, an initialized accumulator state. Name them descriptively (SIN-TABLE, PRIMES-6, LUT-MOD7). Demonstrate reuse: load one, perform a computation that depends on its contents, verify the result. Export the full folder as a .l21x archive. The file system has no metadata beyond the filename — the name is the documentation.

### Exercise 4.11 — Par Hunt
*Challenge #88 · Medium · Solo · ~1 hour*

Choose any built-in challenge. Run it. Get your score. Look at the par. Close the gap by at least 50%. Then close it by another 25%. Keep going until you either beat par or fully understand why you cannot. Write down every optimization you discovered. Common gap-closers: using auto-writeback instead of manual capture, routing both operands in a single bus transfer, using PM continuous ejection instead of per-value routing.

### Exercise 4.12 — The Annotated Session Log
*Challenge #89 · Medium · Solo · ~30 minutes*

Run any medium-length challenge with the session log active. Download the .loop file. Open it. The format uses dual-format lines: T-prefix lines are machine tick events; S-prefix lines are operator setup actions. Find five S-lines that correspond to meaningful decisions you made. For each, write one sentence explaining why you made that decision at that moment. The session log is a record of your thinking — prove you can read it back.

### Exercise 4.13 — The Wrong Architecture
*Challenge #91 · Hard · Solo · ~2 hours*

Solve the Sort Values challenge (8 values) three different ways: (1) brute-force comparison with no hardware assist, (2) using TG1 as a comparator, (3) using the four-bus mega-loop as a pipeline. Score all three. Write a technical comparison: which is fastest, which uses the fewest operator actions, which is most observable, which scales better to 16 values. The best score is not necessarily the best architecture.

## Solutions

### Strategic Guidance for Module 4

**Sorting (4.1, 4.13):** The core insight is that multiple correct algorithms exist with dramatically different performance characteristics. A student who can articulate why TG-assisted extraction beats manual comparison in operator actions but not in algorithmic complexity (both are O(n²)) has understood something that many introductory courses never reach.

**Accumulation (4.2, 4.3, 4.4):** Auto-Writeback is the key optimization. Instead of routing the running total to memory after each addition, keep it in the ALU register using Auto-Writeback. Each new value enters the ALU, the operation fires, and the result stays in place. This eliminates one bus round trip per iteration — a massive tick savings over 100 iterations.

**Algorithmic endurance (4.5, 4.6, 4.8):** These challenges reward sustained attention and clean procedure. The session log is your proof. Students who lose track of their progress after 15 minutes will struggle with these — the discipline of logging intermediate state (either in memory checkpoints or session log annotations) separates successful long runs from abandoned ones.

**Algorithm specification (4.9):** The hardest part is writing `par()` correctly. Most students write par based on their first clean run rather than an expert run. Par should represent the best achievable score for the challenge, not the student's personal best. This distinction matters — it is the difference between describing a problem and defining a standard for solving it.

## Reflection Questions

1. You sorted 8 values three different ways and scored each one. The fastest approach was not necessarily the simplest or most observable. In what situations would you choose a slower but more observable algorithm over a faster but opaque one?

2. The par system gives you a number to chase. When you close the gap, the insight is always architectural — "I was doing X when I could have done Y." What does this tell you about the relationship between algorithm design and hardware awareness?

3. You wrote a custom challenge specification. Was it harder to specify the problem or to solve it? What does the difference tell you about the relationship between specification and implementation in software engineering?

---

# Module 5: Hardware Pipelines and Parallel Operations

**Weeks 9–10 · 10 Challenges**

*Theme: Multiple things can happen at the same time if you design for it.*

## Overview

In Module 5, you stop doing one thing at a time. Multiple buses can operate simultaneously. Pattern Matchers and Threshold Gates run in cascade — a multi-stage hardware pipeline that filters data without any operator routing between stages. The concept of resource contention, encountered briefly in Module 1, now becomes a design constraint you must manage.

By the end of this module you will understand instruction pipelining, parallel execution with multiple simultaneous buses, the PM1→PM2→TG1→TG2 four-stage hardware pipeline, resource contention and pipeline hazards, throughput versus latency, filter order swapping (PM-first vs. TG-first inspection order), and the concept of headless operation — configuring a machine that runs without you.

## Concepts: Parallelism at Human Speed

### Multiple Buses, Simultaneous Transfers

Buses A and B can operate simultaneously — two transfers running in parallel. The four-bus mega-loop pipeline (Working → ALU → Memory → Big → Working via Buses A through D) creates a continuous flow where data circulates through all four loops in sequence. Values enter at Working, transform at ALU, store at Memory, filter at Big, and return to Working.

The catch: two buses delivering to the same loop produce a collision. Resource contention is not theoretical in this machine — you can see it, and you can hear it if sound is enabled. Managing which buses can run concurrently and which conflict is the core design skill of this module.

### The Four-Stage Hardware Pipeline

On the Big loop, PM1 and PM2 (Pattern Matchers) and TG1 and TG2 (Threshold Gates) can run simultaneously in cascade. PM1's match output feeds PM2. PM2's output feeds TG1. TG1's output feeds TG2. Each stage is independently configured with its own mask, pattern, or threshold.

When all four stages are active, a value circulating in the Big loop passes through all four filters without any operator intervention. The machine is running a four-stage pipeline — filtering, matching, thresholding, and delivering — while the operator watches. This is the moment the pipeline becomes real: four independent hardware filters, zero button presses.

The filter inspection order can be swapped: PM-first (pattern matchers inspect before threshold gates) or TG-first (threshold gates inspect first). The choice affects which values survive the pipeline, because the order of filtering matters when stages have different selection criteria.

### Headless Operation

A machine configured with counter triggers, pattern matchers in continuous mode, threshold gates with auto-eject, and op count halt can complete an entire challenge without operator intervention after the initial setup. The operator configures the hardware, presses start, and waits. The machine is running the operator's plan.

This is the boundary between "configuring a machine" and "programming a machine." Every component — PM mask, eject mode, counter limit, auto-writeback state — is a configuration choice made during setup. There is no remaining distinction between configuration and code. The operator has written a program — it is just stored in hardware knobs instead of memory.

## Exercises

### Exercise 5.1 — The Four-Bus Mega-Loop
*Challenge #07 · Medium · Solo · ~10 minutes*

Configure all four A–D buses to form a single continuous pipeline: Working → ALU → Memory → Big → Working. Inject a value and watch it circulate through all four loops in sequence. Keep it running for at least three complete cycles through the full pipeline. This is the largest continuous data path the machine supports.

### Exercise 5.2 — Band-Pass Filter
*Challenge #37 · Medium · Solo · ~20 minutes*

Using TG1 and TG2 in cascade, build a band-pass filter that passes only values in the range 500–1500. TG1 in GTE mode with threshold 500 passes values ≥ 500. TG2 cascades from TG1 in LTE mode with threshold 1500 to pass values ≤ 1500. Only values in the band survive. Test with values at the boundaries (499, 500, 1500, 1501) and extremes (0, 65535).

### Exercise 5.3 — PM Rewrite Pipeline
*Challenge #39 · Medium · Solo · ~25 minutes*

Configure PM2 in rewrite mode. Values matching a specific top-nibble pattern are replaced with 0xFFFF before delivery. Non-matching values pass through unchanged. Set the mask to 0xFF00 and pattern to 0xA000. Inject values with various top bytes: 0xA042 becomes 0xFFFF (matched, rewritten), 0x1234 stays 0x1234 (not matched). Verify both behaviors.

### Exercise 5.4 — TG Clamp
*Challenge #40 · Medium · Solo · ~15 minutes*

Configure TG1 in clamp mode with threshold 1000. Values ≤ 1000 pass unchanged. Values > 1000 are replaced with exactly 1000. This is different from destructive mode (which discards) — clamp mode substitutes. Verify with boundary values: 999 → 999, 1000 → 1000, 1001 → 1000, 65535 → 1000.

### Exercise 5.5 — Dynamic Mask
*Challenge #41 · Hard · Solo · ~45 minutes*

The Pattern Matcher's mask is static — set once during configuration. Implement dynamic filtering: run PM1 with an initial mask, collect the matched results, compute a new mask from the output (e.g., the XOR of all matched values to derive the new pattern), reconfigure PM1 mid-session with the new mask, and resume filtering. The second filter was determined by the data, not by you. This is adaptive filtering — a feedback system where the output programs the next input.

### Exercise 5.6 — Two-Stage PM Cascade
*Challenge #42 · Hard · Solo · ~45 minutes*

Run PM1 and PM2 in cascade: PM1 checks the high byte (mask 0xFF00), PM2 checks the low byte (mask 0x00FF). Only values matching both patterns survive. No ALU involvement — pure hardware filtering with compound conditions.

### Exercise 5.7 — The Full Four-Stage
*Challenge #43 · Hard · Solo · ~1 hour*

Build the maximum hardware pipeline: PM1 → PM2 → TG1 → TG2, all operating simultaneously on the Big loop. Each stage must be meaningfully configured — not pass-through. Feed the pipeline a diverse stream and verify all four filtering behaviors are visible simultaneously. No operator routing between stages. The machine runs the pipeline while you watch.

### Exercise 5.8 — Hardware Neural Threshold
*Challenge #44 · Not Yet Done · Solo · 2+ hours*

Use TG threshold-update to implement a moving-average tracker. The difficulty: TG threshold-update raises the threshold to each passing value (tracking the maximum), but a moving average requires (threshold + value) / 2 — which requires division per step, not available as a hardware operation. This challenge has not been demonstrated at par. Understanding where the hardware falls short is the learning goal.

### Exercise 5.9 — Headless Run
*Challenge #92 · Hard · Solo · ~1.5 hours*

Configure the machine to complete the Filter challenge entirely automatically — no operator interaction after the initial setup. Use counter triggers, op count halts, pattern matchers in continuous mode, and threshold gates to route, filter, accumulate, and stop without any button presses during execution. The challenge must complete correctly. You are configuring a machine, not operating one.

### Exercise 5.10 — The Stress Test
*Challenge #93 · Hard · Solo · ~1 hour*

Run the machine continuously at 24 Hz for 60 minutes. Complete at least five distinct challenges during that time, each with a saved session log. Do not pause the machine between challenges — keep the loops running at all times. Transition cleanly from one challenge setup to the next without stopping the clock.

The challenge is transition fluency: developing a personal protocol for moving from dirty state to clean state without halting. Students who achieve smooth transitions have internalized the machine.

## Solutions

### Strategic Guidance for Module 5

**Cascade pipelines (5.2, 5.6, 5.7):** The key is understanding that each stage is independent. PM1 does not know about TG2. They are filters in series. The order matters — a value that fails PM1 never reaches PM2. Design the cascade by working backwards: what should the final output contain? What does the last stage need to see? What does the second-to-last stage need to pass?

**The headless run (5.9):** Start with the Filter challenge because it has a natural PM-based solution. Configure PM1 with the target mask and pattern in destructive eject mode. Set op count to halt after N Big loop reads. Pre-load the source stream. Press start. The machine filters, collects matches, and halts — all without you. Each component is a configuration choice that encodes a piece of your algorithm.

**The Stress Test (5.10):** The secret is draining. After each challenge, the loops contain leftover data. Use op count to drain all circulating values (count out all words until the loop is empty), then inject the next challenge's values without stopping the clock. A clean drain-and-inject cycle takes practice but becomes automatic with repetition.

## Reflection Questions

1. The full four-stage pipeline runs without operator intervention. At what point does "configuring hardware" become "writing a program"? Is there a meaningful distinction?

2. Resource contention (two buses delivering to the same loop) produces incorrect results. In a CPU, pipeline hazards produce similar problems. What solutions does a CPU use that this machine does not have?

3. The headless run configures the machine to solve a problem without operator action. If you could save that configuration and replay it, you would have a stored program. What is the machine missing that would make stored programs possible?

---

# Module 6: Networks and Protocols

**Weeks 11–12 · 10 Challenges**

*Theme: When two machines talk, they need a shared language. That language is a protocol.*

## Overview

Module 6 introduces the second machine. Everything until now has been single-machine computation. Now you connect to another operator's machine over a real network (WebRTC), send data across a real connection with real latency, and discover that coordination between machines requires something that pure computation does not: a protocol.

By the end of this module you will understand peer-to-peer connections and the WebRTC SDP handshake, direct P2P data transfer via Bus F (left neighbor) and Bus G (right neighbor), routed delivery via Bus H and Bus I (network buses that route through intermediate machines), the CBX protocol and its packet types (INVITE, ASSIGN, GO, SUBMIT, SUM_OK, SUM_FAIL, COMPLETE), the Network Monitor as a packet inspector, and the fundamentals of protocol design — start signals, data formats, acknowledgments, and end signals.

## Concepts: Machines That Talk

### P2P: Direct Connections

Bus F connects to a left neighbor. Bus G connects to a right neighbor. These are direct peer-to-peer channels — data travels from one machine to the other with no routing. The connection setup requires exchanging SDP offers and answers — a handshake that happens outside the machine (typically pasted into a text field).

When the connection is established, routing Working → Bus F sends data to the connected machine's inbound buffer. The receiving machine routes Bus F → Working to accept. The transfer has network latency on top of the 41-tick bus latency — you will measure it empirically.

### Routed Networks: Bus H and Bus I

Bus H (Net0) and Bus I (Net1) are routed network buses. Instead of connecting to a fixed neighbor, they send data to any machine in the connected network, addressed by machine ID. Words injected into Bus H with a target peer selected route through intermediate machines without touching their loops — the operator on an intermediate machine sees the packet transit in their Network Monitor, but their loops are untouched.

Bus H is amber. Bus I is lime. Both are dual-channel (send and receive). Both have peer selectors in their sidebar panels. Using PING NETWORK reveals the network topology; selecting a peer target directs the bus output.

### The CBX Protocol

The built-in Chain Sum challenge uses the CBX (Challenge Bus eXchange) protocol over Bus E (the challenge interface bus, crimson). The protocol unfolds in a defined sequence: the origin sends INVITE to all machines; each responds with ACCEPT; the origin sends ASSIGN with values and positions; GO starts the computation; each machine SUBMITs its running sum; the origin verifies each submission against independently computed correct answers; SUM_OK or SUM_FAIL follows; COMPLETE ends the challenge.

The Network Monitor captures the last 20 meaningful packets. You can watch the protocol unfold in real time, capture packets in a staging area, inspect their fields, modify them, and reinject. This is not a security exercise — it is how you learn what a protocol is actually doing.

### Protocol Design

A protocol is a specification precise enough that two operators who have never spoken can implement it correctly. It defines: a start signal, a data format, an acknowledgment, and an end signal. If the operators need to talk during execution to clarify something, the protocol is incomplete.

## Exercises

### Exercise 6.1 — First Contact
*Challenge #55 · Easy · Multi-Machine · ~15 minutes*

Connect two machines via Bus F. Exchange SDP offer and answer. Machine A injects a value, routes via Bus F. Machine B confirms receipt. Then send in the other direction. Measure the latency from send to confirmed arrival. Two operators, two machines, one confirmed exchange each direction.

### Exercise 6.2 — The Buffer Demonstration
*Challenge #56 · Easy · Multi-Machine · ~15 minutes*

Machine A sends a stream of values to Machine B via Bus F at a rate faster than B's loop can absorb. Machine B's loop is stopped. Watch B's inbound buffer count climb. Then start B's loop. Watch the buffer drain. Document the relationship between sender rate, receiver rate, and buffer depth. This is the producer-consumer problem made physical.

### Exercise 6.3 — Producer-Consumer
*Challenge #57 · Medium · Multi-Machine · ~30 minutes*

Machine A uses Auto-Writeback with INC to generate a continuous stream of values, sent via Bus F. Machine B receives, processes each through the ALU (e.g., multiply by 3 using SHL+ADD), and stores results in memory via auto-increment. Neither machine stops until memory is full. No manual coordination after setup.

### Exercise 6.4 — Three-Machine Relay
*Challenge #58 · Medium · Multi-Machine · ~30 minutes*

Three machines in a chain (A–B–C). A sends values to B via Bus F. B adds 100 to each using the ALU. B forwards to C via Bus G. C stores results in memory. B is the relay — it receives, transforms, and forwards. All three operators are active simultaneously.

### Exercise 6.5 — Agreed Protocol
*Challenge #59 · Medium · Multi-Machine · ~45 minutes*

Two machines, no built-in challenge. Design and implement your own protocol from scratch: agree on a start signal, a data format, an acknowledgment, and an end signal. Write the protocol specification before connecting. Transfer exactly 8 values with verified round-trip acknowledgment for each. If you need to talk during execution to clarify anything, revise the specification.

### Exercise 6.6 — Routed Delivery
*Challenge #60 · Medium · Networked · ~20 minutes*

Three machines in a chain (A–B–C). Using Bus H, send a value from Machine A directly to Machine C, bypassing B's loops. Verify arrival on C. Then open B's Network Monitor — the packet should appear as a transit packet. B is physically in the path but operationally invisible to the data. This is the difference between routing (infrastructure) and processing (computation).

### Exercise 6.7 — File Handshake
*Challenge #61 · Medium · Multi-Machine · ~30 minutes*

Machine A builds a lookup table in memory, saves it as a file, and sends it to Machine B via SEND TO PEER (FTP). Machine B accepts, loads the file into memory, runs an addr-read query on a pre-agreed slot, and sends the result back to A via Bus F. A verifies the result independently. File transfer, query, and verification — all in one session.

### Exercise 6.8 — Network Monitor Lab
*Challenge #62 · Medium · Multi-Machine · ~25 minutes*

Two machines running Chain Sum with Network Monitor enabled on both. Watch the full protocol: INVITE, ASSIGN, GO, SUBMIT, SUM_OK, COMPLETE. On the non-origin machine, capture the ASSIGN packet and read your assigned value and position. Then capture your SUBMIT packet, modify the sum value by 1, and reinject it. Observe SUM_FAIL with the exact discrepancy. This is protocol verification — learning what the protocol does by attempting to break it.

### Exercise 6.9 — Operator-as-Router
*Challenge #63 · Hard · Multi-Machine · ~45 minutes*

Three machines (A–B–C). Bus H on A is pointed at C. Bus I on C is pointed at A. Machine B sits in the middle with its Network Monitor on. A sends a stream via Bus H toward C — packets transit through B (visible in B's monitor, but B's loops are not involved). C processes the values and sends results back to A via Bus I through B. B never touches the data. The humans are the routing layer.

### Exercise 6.10 — Pipeline Stages
*Challenge #75 · Medium · Multi-Machine · ~30 minutes*

Three machines in a distributed pipeline. Stage 1 (Machine A) doubles each input using SHL. Stage 2 (Machine B) adds a constant. Stage 3 (Machine C) applies a bitmask. Values flow A → B → C continuously via Bus F/G. Each machine performs only its assigned transformation. The final output on C must be provably correct for any input A generates.

## Solutions

### Strategic Guidance for Module 6

**P2P basics (6.1–6.4):** The common failure is timing. The sender sends before the receiver is ready. The receiver's loop is not running, or the bus is not configured. Establish a convention: both machines set up their bus configurations before either sends. Use the chat system or an out-of-band signal to confirm readiness.

**Protocol design (6.5):** The specification must be written before the machines connect. Common mistakes: no end signal (both operators sit waiting), ambiguous acknowledgment (a data value could be confused with an ACK), no error handling (what happens if the wrong value arrives?). A good protocol handles the unhappy path, not just the happy one.

**Routed delivery (6.6, 6.9):** The routing is automatic for Bus H and I — intermediate machines forward without operator action. The insight is that the physical path and the logical path differ. A value sent from A to C via Bus H goes through B's hardware but not through B's loops. B's Network Monitor sees it; B's operator does not need to do anything.

**The Network Monitor (6.8):** Capturing and modifying a packet in flight is how you learn what each field means. The ASSIGN packet contains your machine ID, your assigned value, and your chain position. The SUBMIT packet contains your computed sum. Changing the sum triggers SUM_FAIL with the exact discrepancy — proving the origin verifies every submission independently.

## Reflection Questions

1. You designed a protocol specification before connecting the machines. Was the specification complete on the first try? What did you need to add after the first failed attempt?

2. Routed delivery via Bus H goes through intermediate machines without involving their loops. What is the difference between a machine that routes traffic and a machine that processes traffic? Why does the distinction matter?

3. You deliberately broke the Chain Sum protocol by modifying a SUBMIT packet. The origin detected the modification immediately and reported the exact discrepancy. What does this tell you about the relationship between protocol design and error detection?

---

# Module 7: Distributed Systems and Human Coordination

**Weeks 13–14 · 21 Challenges**

*Theme: When multiple computers work together, the humans coordinating them are part of the system.*

## Overview

Module 7 is the largest module. Twenty-one challenges span the full range of distributed systems concepts: parallel reduction, consensus protocols, fault tolerance, hub election, file transfer protocols, secret sharing, and network architecture. Eight of these are marked Not Yet Done — challenges that have not been demonstrated at par or that require machine capabilities not yet built. They are included as aspirational targets and boundary markers.

By the end of this module you will understand the Chain Sum as a zero-trust distributed algorithm, named networks and hub election, the FTP three-message protocol (offer, accept, decline), distributed sorting, consensus, and the map-reduce pattern, Byzantine fault tolerance (in concept, if not in practice), and the limits of what the machine can and cannot guarantee about networked computation.

## Concepts: Coordination at Scale

### The Chain Sum as Zero-Trust Verification

In the Chain Sum challenge, the origin assigns values and positions to every machine. Each machine computes a running sum and submits it. The origin can verify every submission independently — it knows every correct intermediate sum because it assigned every value. No machine needs to trust any other. The origin detects any error, names the failing position, and reports the exact discrepancy.

This is zero-trust verification: the verifier has enough information to check every claim without trusting the claimer. The deliberate-injection exercise (modifying a SUBMIT packet via Network Monitor) demonstrates that the protocol catches everything.

### Named Networks and Hub Election

A named network is a set of machines under a common name with an elected hub. The hub manages the network — when the hub machine disconnects, the remaining machines elect a new hub. You can observe this: form a named network, identify the hub, disconnect the hub deliberately, and watch re-election complete in real time. The network is functional again after the new hub takes over.

### File Transfer: The Three-Message Protocol

The FTP protocol is three messages: OFFER (sender to recipient, with filename and metadata), ACCEPT (recipient grants permission), or DECLINE (recipient refuses). The file streams to the recipient's memory via the writeback pipeline. The sender's memory is unchanged; the recipient's memory now contains the file contents.

What does this protocol guarantee? Integrity of the transfer (the stream preserves position via the null-slot invariant). What does it not guarantee? That the recipient wanted this file. That the file was not corrupted in transit. That the sender did not modify the file after offering it. These gaps are discussion material — what would a production file transfer protocol add?

## Exercises

### Exercise 7.1 — Chain Sum — Perfect Score
*Challenge #64 · Hard · Multi-Machine · ~30 minutes*

Run Chain Sum with 3 machines. Every operator completes their arithmetic correctly on the first submission — no retries, no SUM_FAIL. One clean pass through the chain. The constraint is coordination, not computation: all operators write down their assigned value and position before pressing ACCEPT, all confirm readiness via chat, and all maintain silence during execution.

### Exercise 7.2 — Distributed Max-Finding
*Challenge #65 · Hard · Multi-Machine · ~45 minutes*

Three machines, each holding 4 values in memory. Find the global maximum across all 12 values using a tournament protocol: each machine finds its local max, sends it to a designated aggregator, and the aggregator finds the maximum of the local maxes. No machine ever sees another machine's raw values.

### Exercise 7.3 — Hub Election Live
*Challenge #66 · Hard · Networked · ~1 hour*

Form a named network with 3 machines. Identify the hub. Disconnect the hub machine deliberately. Watch re-election complete — the remaining two machines elect a new hub. Prove the network is functional by completing a Chain Sum after re-election. Document the packets visible in the Network Monitor during the election process.

### Exercise 7.4 — The Broadcast Storm
*Challenge #67 · Not Yet Done · Multi-Machine · 1+ hour*

Four machines in a chain. Design a forwarding protocol where each machine that receives a broadcast also forwards it to its neighbors. Deliberately omit the "don't forward what you already forwarded" rule. Run it. Watch the storm — packets bouncing back and forth endlessly. Then coordinate a shutdown: highest-numbered machine stops forwarding first, then inward. Drain the network while it is still oscillating.

### Exercise 7.5 — FTP: Blind Transfer
*Challenge #72 · Medium · Multi-Machine · ~30 minutes*

Machine A has a file with 12 populated slots. A transfers it to B via SEND TO PEER. B accepts without knowing the contents. B loads the file and uses slot 0 and slot 1 as inputs to an addition. A sends the expected answer via Bus F. B confirms match. Neither operator communicated the values out-of-band.

### Exercise 7.6 — Distributed Lookup
*Challenge #73 · Hard · Multi-Machine · ~1 hour*

Machine A holds a lookup table in /local. Machine B needs 8 values but does not have the table. B sends each query value to A via Bus H. A looks up the value, finds the result, sends it back via Bus H. B stores all 8 results in memory. A never shares the full table — B gets only the answers it asks for. This is a remote procedure call pattern.

### Exercise 7.7 — Content-Addressed Storage
*Challenge #74 · Not Yet Done · Solo · 2+ hours*

Build a filing system where each file is named by a hash of its contents. Compute a 16-bit hash of the 16-slot memory state and use the hash (in hex) as the filename. Store 8 files. Retrieve a file by hash alone, without remembering which computation produced it. Demonstrate a collision strategy for when two states hash identically.

### Exercise 7.8 — Parallel Sum
*Challenge #76 · Medium · Multi-Machine · ~40 minutes*

Four machines, each summing 4 local values. All send their partial sums to a fifth machine (aggregator) via Bus H. The aggregator sums the four partials. The result is the total sum of all 16 values, and no machine ever saw another machine's raw data. This is the map-reduce pattern at human scale.

### Exercise 7.9 — Consensus
*Challenge #77 · Medium · Multi-Machine · ~40 minutes*

Three machines each choose a private value. All broadcast to each other. After receiving both remote values, each machine finds the maximum of all three. Because all three see all three values and run the same algorithm, they all reach the same result. This works because there are no faulty machines — see Challenge #85 (Byzantine Generals) for the adversarial case.

### Exercise 7.10 — Distributed Sort
*Challenge #78 · Hard · Multi-Machine · ~2 hours*

Four machines, each with 4 unsorted values. After the protocol: Machine 1 holds the 4 globally smallest values (sorted), Machine 2 the next 4, Machine 3 the next 4, Machine 4 the 4 largest. Communication via Bus F and G only. Multiple rounds allowed. The protocol must be correct for any input distribution.

### Exercise 7.11 — The Invisible Middleman
*Challenge #79 · Hard · Multi-Machine · ~1 hour*

Three machines: A, B (hidden), C. A sends values to B, which applies a secret transformation and forwards to C. C must deduce B's transformation from input/output pairs alone. The challenge ends when C can predict B's output for any new input before B processes it. This is reverse engineering — analyzing a black box from its behavior.

### Exercise 7.12 — Commit-Reveal
*Challenge #80 · Hard · Multi-Machine · ~1 hour*

Implement a fair coin flip between two machines. Both operators pick a secret value, commit (send a hash), then reveal (send the actual value), then XOR the two values mod 2. Neither can change their value after seeing the other's commitment. The lesson is the protocol structure — commit before reveal, verify commitments — not the cryptographic strength (all ALU operations are invertible).

### Exercise 7.13 — 5-Machine Chain Sum — Clean
*Challenge #81 · Hard · Multi-Machine · ~45 minutes*

Five machines, Chain Sum, one clean pass, zero errors. The most demanding coordination exercise in the curriculum. Pre-session protocol: all five write down assigned values before ACCEPT; all confirm ready via chat; silence during execution. Classes that achieve this on the first attempt have reached genuine collective mastery.

### Exercise 7.14 — Network-Wide XOR Checksum
*Challenge #82 · Hard · Multi-Machine · ~1 hour*

Four machines, each holding 4 values. Compute the XOR of all 16 values across all machines. Each machine XORs its 4 local values and sends the result to an aggregator. The aggregator XORs all four partial results (including its own). Because XOR is commutative and associative, the aggregation order does not matter.

### Exercise 7.15 — The Protocol Autopsy
*Challenge #94 · Hard · Multi-Machine · ~1.5 hours*

Run a full Chain Sum with 3 machines. Enable the Network Monitor. Collect every packet. After completion, produce a written timeline: for each packet, what caused it, what it contained, and what it produced on the receiving end. The timeline must account for every packet with no gaps. This is a protocol trace, written by the operators who ran it.

### Exercise 7.16 — The Impossible Protocol
*Challenge #97 · Not Yet Done · Multi-Machine · 1+ hour*

Attempt to implement a reliable two-machine protocol that guarantees delivery even when the P2P connection drops mid-transfer. You will fail — the machine has no persistence layer between the bus strip and the file system. A dropped connection loses in-flight words irrecoverably. Document exactly where the guarantee breaks down and what would need to exist to fix it. This is how you learn why real TCP has retransmit timers and sequence numbers.

### Exercises 7.17–7.21 — Aspirational Challenges

**Challenge #83: Distributed Multiplication Table** (NYD) — Four machines compute a multiplication table in parallel; a coordinator queries any product from any machine via Bus H.

**Challenge #84: Secret Sharing** (NYD) — XOR-based 2-of-3 secret sharing distributed via FTP. Any two shares reconstruct the secret; a single share reveals nothing.

**Challenge #85: Byzantine Generals** (NYD) — Four machines, one traitor sending different values to different recipients. Loyal machines must reach consensus despite the traitor. Requires 3f+1 machines for f traitors.

**Challenge #86: The Eight-Node Ring** (NYD) — Eight machines in a closed ring with addressing, unicast, broadcast, and storm prevention. Requires a third P2P bus (Bus J) that does not yet exist.

**Challenge #87: The Full Internet** (NYD) — Three named networks connected by a gateway machine. Inter-network routing with full Network Monitor traces. Requires multi-network membership not yet supported.

These challenges are aspirational. Some require machine capabilities that have not been built. Documenting why they are impossible with current constraints is itself a valid exercise.

## Solutions

### Strategic Guidance for Module 7

**Chain Sum coordination (7.1, 7.13):** The protocol is simple; the execution is hard. Five humans performing dependent arithmetic correctly on the first try, in parallel, under time pressure, with no second chances — this is not a machine problem. Pre-session agreements (write everything down, confirm readiness, maintain silence) matter more than machine skill.

**Distributed reduction (7.2, 7.8, 7.14):** The pattern is always the same: compute locally, send partial results to an aggregator, aggregate. The choice of aggregation function matters — SUM and XOR are commutative and associative (order-independent), but MAX requires comparison (not just arithmetic). Students who recognize this pattern across challenges have understood map-reduce.

**Consensus (7.9, 7.10):** The benign case (no faulty machines) is straightforward: all-to-all broadcast followed by local computation. Every machine sees the same inputs and runs the same algorithm, so the result is identical. The adversarial case (Byzantine Generals) breaks this assumption and requires multiple rounds — understanding why is the lesson.

**Protocol limits (7.16):** The impossible protocol teaches more than any solvable challenge. The machine cannot guarantee delivery because it has no retransmit mechanism — a dropped connection loses in-flight data with no acknowledgment, no sequence numbers, no timeout-and-retry. This is the exact gap that TCP fills. Students who can articulate the specific point of failure have understood why networking protocols are the way they are.

## Reflection Questions

1. The Chain Sum uses zero-trust verification — the origin can verify every submission independently. What information does the origin need to make this possible? Could you design a challenge where zero-trust verification is impossible?

2. You watched a hub election happen in real time after deliberately disconnecting the hub. What properties must a leader election algorithm have to work correctly? What happens if two machines both think they are the hub?

3. The impossible protocol failed because the machine has no retransmit mechanism. What is the minimum set of features the machine would need to guarantee delivery? How does this compare to what TCP provides?

---

# Module 8: Integration and Reflection

**Week 15 · 7 Challenges + ★ Bridge Crossing Capstone**

*Theme: Everything you've learned is connected.*

## Overview

Module 8 is one week. It is a culmination, not a new topic. The challenges here are meta-challenges — they ask you to design, teach, specify, and reflect rather than to compute. The capstone is ★ Bridge Crossing, the Operators Club challenge built into the simulator: the single most demanding challenge in the machine, requiring every skill the course has taught.

## Concepts: Synthesis and Mastery

Module 8 does not introduce new machine concepts. Instead it asks you to demonstrate mastery of everything preceding it — through design, specification, teaching, and the capstone challenge. The concept underlying this module is integration: every idea from Modules 1–7 connects to every other, and the operator who sees those connections has completed the course.

## The Capstone: ★ Bridge Crossing

The Operators Club challenge — ★ Bridge Crossing — is the final challenge of the course. It is the only challenge in the simulator marked with a star. Completing it generates a cryptographic completion code unique to your machine session.

This challenge is deliberately not described in detail here. Discovery is part of the experience. What can be said: it requires routing, arithmetic, memory management, timing, and strategic thinking at a level that synthesizes the entire course. An operator who completes ★ Bridge Crossing has demonstrated mastery of the machine.

## Exercises

### Exercise 8.1 — Quine
*Challenge #53 · Not Yet Done · Solo · Hours*

Produce a 16-slot memory state such that when the Batch Write All stream is routed back into the machine as an injected sequence, the resulting memory state is identical to what you started with. The trivial fixed point is all-zeros. A non-trivial fixed point requires understanding how the save/load stream maps to slot positions. The interesting question: is there a state that is NOT its own fixed point under this definition?

### Exercise 8.2 — The Tour de France
*Challenge #54 · Not Yet Done · Solo · 4+ hours*

Complete challenges 01 through 50 in a single session without closing the browser tab. Session log running the entire time. This is not a speed challenge — it is a fluency challenge. An operator who has genuinely internalized the machine should manage it in under four hours. No one has demonstrated this yet.

### Exercise 8.3 — Teach the Machine a New Problem
*Challenge #90 · Medium · Solo · ~1 hour*

Write a custom challenge definition for a problem that does not exist in the built-in set. The problem must be original, must have a non-trivial optimal solution, and must be self-documenting — another operator must be able to run it without verbal explanation. If they need to ask a clarifying question, the definition is incomplete.

### Exercise 8.4 — The Variant
*Challenge #95 · Not Yet Done · Solo · Open*

Design a Loop 2.1 variant — a modified set of rules that changes how the machine operates without breaking it. Write the spec: what rule changes, what stays the same, what new behaviors emerge, what becomes impossible. The spec must be precise enough that two operators reading it independently would run the variant the same way.

### Exercise 8.5 — The Loopscript Program
*Challenge #96 · Not Yet Done · Solo · 2+ hours*

Write a complete Loopscript (.lps) file that performs the Accumulate to Threshold challenge from scratch — setup, configuration, execution, and halt — parameterized by the threshold value. Test on three different thresholds. A program that specifies a computation is different from an operator performing one.

### Exercise 8.6 — Teach a Class
*Challenge #98 · Not Yet Done · Solo · 30 minutes + prep*

Prepare and deliver a 30-minute session introducing Loop 2.1 to someone with no prior exposure. Cover: the 17-bit word, the inject channel, a bus transfer, and one ALU operation. The learner must successfully move a value from Working to the ALU loop without your hands on their keyboard. If they cannot, your explanation failed.

### Exercise 8.7 — The One That Isn't Here Yet
*Challenge #99 · Not Yet Done · Solo · Unknown*

This slot is intentionally empty. When you encounter a capability that makes something possible that was not possible before, that is where Challenge 99 begins. It has not been designed because it cannot be designed yet. Challenge 99 is always the next capability that does not yet exist.

## Solutions

### Strategic Guidance for Module 8

The challenges in this module do not have canonical solutions — they are assessed on the quality of thinking, rigor of documentation, and evidence that the operator understands the machine at a deeper level than button-pressing.

**The Quine (8.1):** The trivial fixed point (all zeros) is a genuine answer. The deeper question — whether all memory states are their own quine under the Batch Write All / load cycle — is worth investigating. Most states are fixed points because the save/load stream preserves position exactly.

**The Tour de France (8.2):** No one has completed this. If you attempt it, the session log is your proof. Verify by checking that tick numbers increase monotonically across challenge boundaries — any gap indicates a clock stop.

**Teach the Machine a New Problem (8.3):** The specification is the deliverable. If another operator can run your challenge without asking you a question, the specification is complete. If they need to ask anything, revise.

**Teach a Class (8.6):** The hardest part is not explaining — it is staying silent while the learner makes mistakes. The constraint "without your hands on their keyboard" forces communication over demonstration. If the learner completes Challenge 01 independently, you have succeeded.

## The Final Project

The final project is a novel computation of your own design: documented with a session log, transcribed as a Loopscript file, annotated with explanations of every significant decision, and presented live. It must be demonstrated and discussed, not read from notes.

**Synthesis question (written):** "Name one thing the machine taught you that a textbook could not have."

## Reflection Questions

1. You have spent a semester operating a machine where every operation is visible, every cost is measured, and every decision is yours. How has this changed the way you think about the computers you use every day?

2. What did you understand in week 15 that you could not have understood in week 1? Be specific — name a concept that only made sense after you had worked through earlier modules.

3. The machine has no stored program. You are the program. After 15 weeks of being the program, what do you now understand about what a stored program actually does?

---

# Appendix A: CS Topic Cross-Reference

Every topic in this table is encountered experientially on the machine before it is formalized in lecture or reading. "First Encountered" indicates when students have already felt the concept; "Formalized" indicates when it receives its proper name and theoretical treatment.

| CS Topic | First Encountered | Formalized | Module |
|----------|------------------|------------|--------|
| Binary representation | Week 1 | Week 1 | M1 |
| Word size and bit width | Week 1 | Week 1 | M1 |
| Clock cycles and instruction cost | Week 1 | Week 2 | M1 |
| Latency as physical distance | Week 2 | Week 2 | M1 |
| Integer arithmetic | Week 3 | Week 3 | M2 |
| Overflow and carry | Week 3 | Week 3 | M2 |
| Two's complement representation | Week 3 | Week 3 | M2 |
| Condition flags | Week 3 | Week 3 | M2 |
| Bitwise logic and masking | Week 4 | Week 4 | M2 |
| Addressable memory | Week 5 | Week 5 | M3 |
| Register files | Week 5 | Week 6 | M3 |
| Memory hierarchy | Week 6 | Week 6 | M3 |
| Addressing modes | Week 5 | Week 6 | M3 |
| State machines | Week 6 | Week 6 | M3 |
| File systems and persistent storage | Week 6 | Week 6 | M3 |
| Serialization and binary formats | Week 6 | Week 6 | M3 |
| Sorting algorithms | Week 7 | Week 7 | M4 |
| Algorithmic complexity (O notation) | Week 7 | Week 8 | M4 |
| Search algorithms | Week 8 | Week 8 | M4 |
| Checksums and data integrity | Week 8 | Week 12 | M4/M6 |
| Algorithmic optimization | Week 7 | Week 8 | M4 |
| Algorithm specification (generate/par) | Week 8 | Week 8 | M4 |
| Instruction pipelining | Week 9 | Week 10 | M5 |
| Parallel execution | Week 9 | Week 10 | M5 |
| Resource contention and hazards | Week 9 | Week 10 | M5 |
| Throughput vs. latency | Week 10 | Week 10 | M5 |
| Network protocols | Week 11 | Week 12 | M6 |
| Packet structure and addressing | Week 11 | Week 12 | M6 |
| TTL and packet lifecycle | Week 12 | Week 12 | M6 |
| Handshaking and connection setup | Week 11 | Week 12 | M6 |
| Layered network model | Week 12 | Week 12 | M6 |
| Routed networking (non-adjacent delivery) | Week 11 | Week 12 | M6 |
| Packet inspection and protocol debugging | Week 12 | Week 12 | M6 |
| Distributed algorithms | Week 13 | Week 13 | M7 |
| Consensus and fault tolerance | Week 13 | Week 14 | M7 |
| Routing tables | Week 14 | Week 14 | M7 |
| Leader election | Week 14 | Week 14 | M7 |
| CAP theorem (intuition) | Week 13 | Week 14 | M7 |
| Zero-trust verification | Week 13 | Week 13 | M7 |
| File transfer protocols | Week 14 | Week 14 | M7 |

---

# Appendix B: Challenge Index

All 99 challenges listed alphabetically with module assignments.

| Challenge | # | Module | Difficulty |
|-----------|---|--------|-----------|
| 100 Accumulations | 45 | M4 | Medium |
| 5-Machine Chain Sum — Clean | 81 | M7 | Hard |
| Add Two Numbers | 10 | M1 | Easy |
| Agreed Protocol | 59 | M6 | Medium |
| All Four Loops | 04 | M1 | Easy |
| Auto-Writeback Counter | 16 | M2 | Medium |
| Band-Pass Filter | 37 | M5 | Medium |
| Bit Reversal | 18 | M2 | Medium |
| Broadcast Storm, The | 67 | M7 | NYD |
| Buffer Demonstration, The | 56 | M6 | Easy |
| Bus Collision | 06 | M1 | Easy |
| Byzantine Generals | 85 | M7 | NYD |
| Chain Sum — Perfect Score | 64 | M7 | Hard |
| Checkpoint System | 71 | M3 | Medium |
| Commit-Reveal | 80 | M7 | Hard |
| Consensus | 77 | M7 | Medium |
| Content-Addressed Storage | 74 | M7 | NYD |
| CRC-16 | 23 | M2 | Hard |
| Custom Challenge Authorship | 51 | M4 | Hard |
| Distributed Lookup | 73 | M7 | Hard |
| Distributed Max-Finding | 65 | M7 | Hard |
| Distributed Multiplication Table | 83 | M7 | NYD |
| Distributed Sort | 78 | M7 | Hard |
| Dynamic Mask | 41 | M5 | Hard |
| Eight-Node Ring, The | 86 | M7 | NYD |
| Even or Odd | 35 | M2 | Easy |
| Fibonacci to Overflow | 46 | M4 | Medium |
| File Handshake | 61 | M6 | Medium |
| File Library | 52 | M4 | Hard |
| First Contact | 55 | M6 | Easy |
| Five Flags, The | 13 | M2 | Easy |
| Floating Point, Approximately | 24 | M2 | NYD |
| Forty-One Ticks | 02 | M1 | Easy |
| Four-Bus Mega-Loop, The | 07 | M5 | Medium |
| FTP: Blind Transfer | 72 | M7 | Medium |
| Full Four-Stage, The | 43 | M5 | Hard |
| Full Internet, The | 87 | M7 | NYD |
| Full Multiplication | 22 | M2 | Hard |
| GCD | 21 | M2 | Hard |
| Hardware Neural Threshold | 44 | M5 | NYD |
| Headless Run | 92 | M5 | Hard |
| Hello, Read Head | 01 | M1 | Easy |
| Histogram | 29 | M3 | Medium |
| Hub Election Live | 66 | M7 | Hard |
| Impossible Protocol, The | 97 | M7 | NYD |
| Insertion Sort | 31 | M4 | Hard |
| Integer Square Root | 15 | M2 | Medium |
| Invisible Middleman, The | 79 | M7 | Hard |
| l21x Audit, The | 70 | M3 | Medium |
| LFSR Full Cycle | 48 | M4 | Hard |
| Long Division | 20 | M2 | Hard |
| Loop Size Tax | 08 | M1 | Medium |
| Lookup Table, The | 26 | M3 | Medium |
| Marker Bit, The | 03 | M1 | Easy |
| Merge Sort (Two Lists) | 49 | M4 | Hard |
| Midnight Run, The | 50 | M4 | Hard |
| Multiply by 12 | 14 | M2 | Easy |
| Network Monitor Lab | 62 | M6 | Medium |
| Network-Wide XOR Checksum | 82 | M7 | Hard |
| Null Slot Test, The | 69 | M3 | Easy |
| One That Isn't Here Yet, The | 99 | M8 | NYD |
| Op Count Stop | 09 | M1 | Easy |
| Operator-as-Router | 63 | M6 | Hard |
| Par Hunt | 88 | M4 | Medium |
| Pipeline Stages | 75 | M6 | Medium |
| PM Rewrite Pipeline | 39 | M5 | Medium |
| Population Count | 19 | M2 | Medium |
| Powers of Two Detector | 38 | M2 | Medium |
| Primes Below 200 | 47 | M4 | Medium |
| Producer-Consumer | 57 | M6 | Medium |
| Protocol Autopsy, The | 94 | M7 | Hard |
| Quine | 53 | M8 | NYD |
| Ring Buffer | 32 | M3 | Hard |
| Rising Threshold, The | 36 | M4 | Easy |
| Routed Delivery | 60 | M6 | Medium |
| Save, Corrupt, Recover | 33 | M3 | Hard |
| Secret Sharing | 84 | M7 | NYD |
| Sine Table, The | 30 | M3 | Medium |
| Slow Save, The | 68 | M3 | Easy |
| Slow Transfer, The | 05 | M1 | Easy |
| Stack, Manually | 27 | M3 | Medium |
| State Machine: Traffic Light | 28 | M3 | Medium |
| Stress Test, The | 93 | M5 | Hard |
| Teach a Class | 98 | M8 | NYD |
| Teach the Machine a New Problem | 90 | M8 | Medium |
| TG Clamp | 40 | M5 | Medium |
| Three-Machine Relay | 58 | M6 | Medium |
| Tour de France, The | 54 | M8 | NYD |
| Two's Complement Tour | 17 | M2 | Medium |
| Two-Stage PM Cascade | 42 | M5 | Hard |
| Variant, The | 95 | M8 | NYD |
| Virtual Memory | 34 | M3 | NYD |
| Working Scratch Sprint | 12 | M3 | Medium |
| Write All, Read All | 25 | M3 | Easy |
| Wrong Architecture, The | 91 | M4 | Hard |
| XOR Checksum (see CRC-16) | 23 | M2 | Hard |
| Zero-Pulse Inject | 11 | M2 | Medium |
| Annotated Session Log, The | 89 | M4 | Medium |
| Loopscript Program, The | 96 | M8 | NYD |
| Parallel Sum | 76 | M7 | Medium |

---

# Appendix C: The Built-In Challenges

The simulator includes 11 built-in challenges with scored operation and par targets. These are distinct from the 99 course challenges but are referenced throughout the curriculum.

| # | Name | Type | Description | Course Relevance |
|---|------|------|-------------|-----------------|
| 1 | Add X Numbers | Local | Sum a series of injected values. The canonical first scored challenge. | M1: first ALU exercise, introduces par |
| 2 | Multiply Two Numbers | Local | Compute a product using shift-and-add. | M2: binary multiplication discovery |
| 3 | Transform Every Nth Value | Local | Apply a transformation to every Nth value in a stream, passing others unchanged. | M5: simultaneous bus and gate management |
| 4 | Filter: Pass Back Matching Values | Local | Return only values matching a criteria from a mixed stream. | M2/M5: PM filtering, headless run target |
| 5 | Sort Values (Low → High) | Local | Sort a set of values in ascending order. | M4: sorting algorithms, the Wrong Architecture exercise |
| 6 | Find the Maximum | Local | Identify the largest value in a set. | M4: search algorithms, TG-assisted approach |
| 7 | XOR Checksum | Local | Compute the XOR of all values for data integrity verification. | M4: checksums and data integrity |
| 8 | Count Matches | Local | Count how many values in a stream match a given criteria. | M3: accumulation across multiple passes |
| 9 | Accumulate to Threshold | Local | Sum values until a running total exceeds a target threshold. | M4: accumulation algorithms |
| 10 | Chain Sum | Network | A multi-machine distributed computation with zero-trust verification. | M7: distributed algorithm, CBX protocol |
| 11 | ★ Bridge Crossing | Operators Club | The capstone challenge. Completion generates a cryptographic code. | M8: course capstone |

The challenge interface uses Bus E (crimson, dual-channel). Built-in challenges inject values and read submissions through Bus E. Network challenges (Chain Sum, ★ Bridge Crossing) additionally use the CBX protocol over the network layer. Buses H and I (Net0 and Net1) handle routed network traffic for multi-machine challenges.

---

## Assessment Structure

For instructors using this document in a semester course:

| Component | Weight | Notes |
|-----------|--------|-------|
| Weekly challenge scores | 35% | Efficiency and speed modes, logged via session log. Scored against par. Best N of M sessions count. |
| Short written reflections | 20% | One per module, 200–300 words. Graded on evidence of genuine engagement, not correctness. |
| Midterm | 20% | Timed challenge session (end of Module 4) with written debrief. The debrief is graded; the challenge score is context. |
| Final project | 25% | Novel computation, session log, Loopscript documentation, live presentation. |

---

*Computing from First Principles · Loop 2.1 Manual Flow Computer*
*Document 2 of the L21 Five-Document Package*
*Build 332 · April 2026*
*© 2026 Shea Gunther · loop2.computer*
*"The Operator Is the Program"*
