# Loop 2.1 — Operator's Manual

**Manual Flow Computer**

---

## Chapter 1 — Getting Started

### Choose Your Starting Guide

Before you read further, you have a choice. This manual has two entry points — pick the one that fits you.

**Guide A — The Technical Guide.** For CS students, developers, hardware people. Assumes you know what a register is.

**Guide B — The Plain-Language Guide.** For curious people who like technical things but don't need to know binary first.

Both guides cover the same ground and end at the same place: you will have loaded numbers into the machine, moved them through a bus, performed addition in the ALU, and gotten the result back. That is a real computation on a real computer. It just happened to require your hands at every step.

After completing either guide, continue to Chapter 2 for the full reference.

---

### Guide A — The Technical Guide

*For people who know what a register is*

This guide assumes you know what binary is and can read a 16-bit value in hex, understand what registers, buses, and ALUs are at a conceptual level, are comfortable with terms like "fetch-decode-execute" and "memory-mapped I/O," and do not need to be told what addition is.

If that doesn't sound like you, try Guide B instead. No judgment — it covers the same ground.

#### The Architecture

Loop 2.1 is a dataflow machine with no instruction memory. Data is stored as 17-bit words — one marker bit followed by 16 data bits — circulating in one of four shift-register loops: Working (18 words), ALU (24 words), Memory (24 words), and Big (48 words). The marker bit distinguishes a data word from empty space; the 16 data bits carry the unsigned integer value (0–65535).

Words rotate at the clock rate — 24 Hz by default. There is a read head (R dot), a gate head (G dot), and a write head (W dot) at fixed positions on each loop. The bus samples the R dot, the gate controls whether a word exits, and the write head is where bus-delivered bits enter the loop.

A bus moves bits from the R dot of a source loop to the W dot of a destination loop. Buses A through D are the four general-purpose intra-machine buses. Bus E is the external interface — used for challenge I/O. F and G are P2P connections to neighboring machines. H and I are routed network buses.

The ALU is not pipelined and has no clock. It recomputes instantaneously whenever any input register changes. It has four 16-bit registers (A, B, C, D) and seventeen operations: ADD, SUB, AND, OR, XOR, NOT, SHL, SHR, NEG, INC, DEC, MOD, ROR, ABS, NAND, NOR, XNOR. Five flags (Zero, Carry, Overflow, Sign, Parity) are updated on every operation. The ALU result can be written back to the ALU loop via a 17-tick writeback pipeline — manually, or automatically on result change.

Memory provides 16 addressable 16-bit slots. Each slot can be written from the Memory loop's read head (Write to Slots mode) or read back out via individual slot writeback or Batch Write All.

#### What You Will Build

You are going to add two numbers. Specifically: inject 1000 and 2000 into the Working loop, route them to the ALU loop via Bus A, capture them into registers A and B, compute ADD, and write the result back to the ALU loop. The result should be 3000 (0x0BB8).

This requires: inject channel, Bus A source/destination routing, the gate, ALU register capture, and ALU writeback. It exercises most of the core data path in one short session.

#### Step 1 — Open the simulator and get oriented

Open the Loop 2.1 simulator HTML file in any modern browser. You'll see a canvas with four loop tracks. The right sidebar contains all controls. The control bar at the top has CLOCK, RUNNING, BUS, INJECT, and P2P LEDs.

Default clock is 1 Hz. Set it higher — 8 or 12 Hz — using the clock slider in the control bar. You want it fast enough to be interesting but slow enough to watch individual words. 24 Hz is the recommended operating speed (the cinema threshold — motion becomes continuous rather than discrete ticks).

Press START in the control bar. The machine starts running. You will see the clock LED flash and the tick counter increment. The loops are empty — the canvas shows no lit bits.

#### Step 2 — Inject your first value

The inject channel loads data directly into the Working loop's write head. It's the primary way to get data into the machine from outside.

Find the Inject panel (top of the right sidebar, or inline below the Working loop). Set the value to 1000 using the sixteen toggle switches — each switch is one bit of the 16-bit value. 1000 decimal = 0x03E8 = 0000001111101000 in binary, so switches 9, 8, 7, 6, 5, and 3 should be up.

Press INJECT. A 17-bit word (marker + 16 data bits) enters the inject channel and shifts into the Working loop's write head over 17 ticks. Watch the canvas — you will see the lit bits appear and start circulating.

Wait for the word to clear the inject channel (17 ticks at your clock rate). Then set the switches to 2000 (0x07D0 = 0000011111010000) and inject again.

You need a gap between words — at least one empty marker-position between them — or the second word's marker will collide with the first word's tail bits. Waiting for the inject LED to go dark is enough.

#### Step 3 — Configure Bus A and route to ALU

Bus A is a 24-bit shift register that bridges source and destination loops. You need to configure its source, destination, and then open the gate to let words exit the Working loop onto the bus.

1. Open the Bus A panel in the right sidebar. Set Source to Working and Destination to ALU.
2. Press TURN BUS A ON. The bus activates. Nothing moves yet — the gate is closed.
3. Watch the Working loop canvas. When the first word is approaching the gate position (G dot), press OPEN GATE on the Working loop. The marker bit exits through the gate onto the bus, followed by the 16 data bits. The word is consumed from the Working loop and travels across Bus A to the ALU loop's write head.
4. Open the gate once more to pass the second word (2000). Both values are now in the ALU loop.

> **Bus transit time.** Bus A is 24 positions wide. A 17-bit word takes 41 ticks to fully cross it — 17 ticks to enter the bus plus 24 more for the last bit to exit (BUS_N 24 + BPW 17 = 41). At 24 Hz, that's about 1.7 seconds.

#### Step 4 — Capture into ALU registers

The ALU captures words from the ALU loop's read head into registers on demand. You set a route (which register to capture into next) and the next complete word that passes the R dot goes there.

1. Open the ALU panel. Set the capture route to A.
2. Watch the ALU loop. When your first word (1000) passes the R dot, it is captured into Register A. The register display updates immediately. The word is still circulating in the loop — capture is non-destructive by default.
3. Set the route to B. The next word (2000) that passes is captured into Register B.

At this point: Reg A = 1000, Reg B = 2000, Op = ADD, Result = 3000. The ALU computed the result the moment Reg B was populated. No clock cycle, no pipeline stage — it's purely combinational from the register values.

#### Step 5 — Write the result back to the loop

Press SEND TO LOOP in the ALU panel. This starts a 17-tick writeback — the result word is shifted bit by bit into the ALU loop's write head. The result (3000) is now circulating in the ALU loop.

Set the capture route to C and let the result word pass the R dot. Register C now holds 3000 — your verified answer.

**You did it.** 1000 + 2000 = 3000. You loaded data, moved it across a bus, captured it into registers, computed an ALU operation, and retrieved the result. That is a complete computation on a dataflow machine with no stored program. The only instruction that ran was you.

#### What to Try Next

**Auto-writeback.** Toggle AUTO-SEND: ON in the ALU. Now the result writes back to the loop automatically every time it changes. Load values, set op to INC, watch the ALU loop count upward continuously.

**Memory slots.** Enable Write to Slots and Auto-Increment on the Memory panel, then route values from the Working loop through Bus B to the Memory loop. Watch them land in consecutive slots.

**The Pattern Matcher.** Configure PM1 on the Big Loop to match a specific bit pattern. Route a stream of values through and watch it eject matches while letting non-matches continue circulating.

**Challenges.** Open the Challenges panel and try Add Two Numbers — the machine sends values to you via Bus E and you route them through the ALU and send the answer back.

---

### Guide B — The Plain-Language Guide

*For curious people who like technical things*

This guide assumes you are curious and comfortable learning new things, have used a computer but don't necessarily know how one works inside, don't need to know what binary is before you start — we'll cover what matters, and are patient enough to watch something happen slowly and find that interesting.

If you already know what registers and buses are, Guide A will move faster for you.

#### A Different Kind of Computer

Every computer you've used in your life — phone, laptop, game console — works the same basic way. Someone wrote a program. The program tells the computer what to do, step by step, automatically. You click a button and a thousand instructions execute before you've moved your finger. The computer is fast, the program is hidden, and you are the user.

Loop 2.1 works differently. There is no program. There are no hidden instructions. There is just you, and data moving through loops, and a set of tools you can use to do things to that data.

You are the program. Every step, every decision, every movement of data — that's you.

This sounds slow and tedious. It is, a little. It is also the clearest possible view of what a computer actually does. Most computers hide everything from you in the name of speed and convenience. Loop 2.1 hides nothing.

#### The Basic Idea: Data Goes Around in Circles

Imagine a conveyor belt in a circle — like the kind at a sushi restaurant, where the food goes around and you take what you want. Loop 2.1 has four of these conveyor belts, called loops. Data circulates on them continuously, going around and around at whatever speed you set the clock to.

Data on the loop is stored as numbers — any whole number from 0 to 65,535. When you put a number on a loop, it circulates forever (or until you take it off). It doesn't go anywhere on its own. It just goes around.

The four loops are: Working (your main workspace), ALU (for calculation), Memory (for storing values), and Big (a larger loop for bigger jobs). For this guide, you'll only use Working and ALU.

#### Moving Data Between Loops: Buses

A bus is a bridge between loops. You point it at a source loop and a destination loop, open it, and data flows across. Think of it as a short conveyor belt that connects two of the circular ones.

You control which data crosses. The bus doesn't decide — you do. When a number reaches the exit point of the source loop, you can let it through (by opening the gate) or let it keep circulating. One press of the gate lets exactly one number cross.

#### The Calculator: The ALU

The ALU (you can just call it the calculator) is where arithmetic happens. It has four slots — Registers A, B, C, and D — where you can hold numbers. You put a number in A, a number in B, tell it to add them, and it instantly shows you the result.

The ALU doesn't reach out and grab numbers. You route data to it through a bus. The numbers arrive from the ALU loop, pass the read point, and get captured into whichever register you've selected. The whole thing is deliberate and visible.

#### What You'll Do

You are going to add two numbers: 1000 and 2000. The answer is 3000. You already know that — but the machine doesn't. You're going to show it, by hand, step by step.

Here's the plan: put both numbers into the Working loop, move them across a bus to the ALU loop, capture them into the calculator's registers, add them, and send the result back to the loop. By the end, the number 3000 will be circulating in the ALU loop, and you'll have watched every bit of it happen.

#### Step 1 — Open the simulator and start the clock

Open the Loop 2.1 simulator in your browser. You'll see a panel of loops drawn as canvases — circular tracks. The right side has all the controls. It looks complicated. Ignore most of it for now.

Find the control bar at the top. Press START. The machine starts running. A tick counter begins incrementing — each tick is one step of the clock. At 1 Hz (the default), there's one tick per second.

The loops are empty, so nothing interesting happens yet. That's fine. The machine is ready.

Optionally: find the clock speed slider and bump it to around 8. Things will move a little faster and feel more alive. You can always slow it back down.

#### Step 2 — Put numbers into the Working loop

The inject channel is how you get a number into the machine from the outside. Think of it as the input slot.

1. Find the Inject panel (it's near the top of the right sidebar, or there's a small one inline below the Working loop). Set the value to 1000 using the sixteen toggle switches — flip them to match the binary pattern for 1000 (0000001111101000). The switches represent the 16 data bits of the word, from bit 15 (left) to bit 0 (right).
2. Press INJECT. Watch the Working loop canvas. You'll see a cluster of lit bits appear and start moving clockwise around the loop. That cluster is your number — 1000 — circulating.
3. Wait a moment for the injection to finish (the INJECT LED in the control bar will go dark). Then set the switches to 2000 (0000011111010000) and press INJECT again. Now two clusters of bits are circulating in the Working loop — 1000 and 2000, going around and around.

> **Why lit bits?** Numbers in Loop 2.1 are stored in binary — a series of 0s and 1s. Lit bits are 1s, dark bits are 0s. The pattern of lights is the number 1000 written in binary. You don't need to read binary — the number display shows the decimal value.

#### Step 3 — Move the numbers to the ALU loop

The numbers are in Working, but the calculator (ALU) only knows about things in the ALU loop. You need to move them. Bus A is the bridge.

1. Open the Bus A section in the right sidebar. Set the Source to Working — Bus A will read from the Working loop. Set the Destination to ALU — it will write into the ALU loop.
2. Press TURN BUS A ON. The bus is ready, but data hasn't moved yet — you still control the gate.
3. Watch the Working loop. There's an exit point — the Gate — where numbers can leave the loop onto the bus. When your first number (1000) is near the gate, press OPEN GATE. The gate opens and closes automatically after one number passes. You'll see the lit bits shift from the Working loop across the Bus A channel into the ALU loop. It takes a moment at the clock rate you've set.
4. Wait for 1000 to finish crossing the bus. Then open the gate again when 2000 approaches. It crosses too. Both numbers are now in the ALU loop.

#### Step 4 — Capture the numbers into the calculator

The numbers are circulating in the ALU loop, but the calculator doesn't have them yet — it needs to grab them as they pass the read point.

1. Open the ALU section in the sidebar. Find the register route selector — buttons labeled A, B, C, D. Press A to set the next capture destination to Register A.
2. Watch the ALU loop. The moment your first number (1000) passes the read point, it's captured into Register A. The ALU panel will show A: 1000. The number is still in the loop too — capture doesn't remove it. You're reading a copy, like scanning a barcode.
3. Press B to set the next capture to Register B. When 2000 passes, it's captured into B. The ALU panel shows B: 2000.

The calculator showed 3000 the instant Register B was filled. It didn't need you to press Calculate or Execute. It just does the math, always, as soon as it has both inputs.

#### Step 5 — Send the answer back into the loop

The result (3000) exists in the calculator but isn't in any loop yet. To do anything with it — store it, route it somewhere, use it in a further calculation — you need to put it back in the loop.

1. In the ALU panel, press SEND TO LOOP. Watch the ALU loop — a new cluster of lit bits appears and starts circulating. That's 3000, now living in the loop alongside the 1000 and 2000 you put there earlier.
2. To confirm: press C in the register selector, and let the 3000 word pass the read point. Register C will show 3000. You've verified the answer is what you expect.

**You did it.** You just added 1000 + 2000 = 3000 on a computer where you made every single decision. You chose when the numbers entered. You chose when they crossed the bus. You chose when they were captured. You chose when the result went back to the loop. There was no hidden step. No instruction ran without your direction. That's Loop 2.1.

#### What Makes This Interesting

You might be thinking: that was a lot of steps to do addition. And you're right — it was. A normal calculator does that in a fraction of a millisecond with no effort from you. So why bother?

Because now you know exactly how it happened. Most computers hide the routing, the transfer, the capture, the writeback — all of it happens automatically at billions of steps per second. You get the answer but you don't get the understanding. In Loop 2.1, you can't get the answer without the understanding. They're the same thing.

And once the understanding is there, the machine becomes surprisingly expressive. Try this: set the ALU operation to INC (increment by 1) and turn on AUTO-SEND: ON. Now every time the result changes, it automatically goes back to the loop — which means it gets captured again, which changes the result, which goes back to the loop. You've just created a counter that runs by itself at the clock rate. From "how does addition work" to "I made a machine that counts" in two steps.

#### What to Try Next

**Different operations.** Change the ALU operation to SUB, SHL (shift left — doubles the value), XOR, or NOT. Watch what happens to the result display as you swap operations while registers are loaded.

**The auto-send counter.** As described above — INC + AUTO-SEND is one of the most satisfying things in the machine.

**Memory slots.** Find the Memory Slots panel. Enable Write to Slots and route values from Working into the Memory loop via Bus B. Watch them get stored in slot 0, 1, 2… in sequence.

**Challenges.** The Challenges panel gives you structured problems to solve — the machine sends you numbers via Bus E and asks you to send back an answer. Add Two Numbers is the natural first one.

---

## Chapter 2 — Data Format: The 17-Bit Word

Loop 2.1 uses 17-bit data words. Each word consists of:

- 1 marker bit — always 1 when a word is present, 0 for empty space
- 16 data bits — the actual value, capable of holding 0 through 65,535

```
[ M | b15 b14 b13 b12 · b11 b10 b9 b8 b7 b6 b5 b4 b3 b2 b1 b0 ]
```

The marker bit is essential to the loop architecture. Because data circulates continuously with empty gaps between words, the machine needs a way to distinguish "this is a word" from "this is empty space." The marker bit serves that purpose — it is the leading edge of every word.

> **Important.** The marker bit is not part of the value. A word with marker=1 and all data bits=0 holds the value zero — it is a valid word containing zero, not an empty slot.

### Reading the Head Display

At the bottom of each loop panel, the HEAD display shows the 17-bit pattern currently at the Read head. The leftmost box is the marker bit, followed by b15 through b0. Below the bit pattern you will see the decimal and hexadecimal value of the word currently passing.

The top four bits (b15–b12) are visually grouped separately. In most contexts they are ordinary data bits. In Memory's address-read mode, they encode a destination slot address.

### Bus Width and Transfer Time

Buses are 24-slot pipelines — slightly wider than a word to allow clean separation between consecutive words. A complete word transfer takes BUS_N + BPW = 24 + 17 = 41 ticks from the moment the first bit (the marker) enters the bus to the moment the last data bit lands in the destination.

---

## Chapter 3 — The Four Loops

Loop 2.1 has four circular storage tracks. Each is independent and runs at the same clock rate. Data circulates continuously — one bit per tick — around each loop until the operator intercepts it.

**◈ Working Loop** — 18 words · 306 bits

Primary workspace. New values enter here via the inject channel. Staging area for values in transit. Has four working scratch registers for temporary holding without crossing a bus.

**◈ ALU Loop** — 24 words · 408 bits

Connected to the Arithmetic Logic Unit. Route values here, capture them into registers A–D, and the Answer register updates automatically based on your current operation selection.

**◈ Memory Loop** — 24 words · 408 bits + 16 addressed slots

Bulk storage loop with 16 fixed addressed slots (0–15). Route values here to store them by address. Read slots back individually, in batch, or with auto-increment. Good for persisting intermediate results.

**◈ Big Loop** — 48 words · 816 bits

Largest loop. Home of both Pattern Matchers. Suited for datasets you want to filter, scan, or pass through the PM. Data circulates while the PM watches for matching values.

> **Key Concept.** Data has position. A value injected into the Working loop will take up to 306 ticks to rotate back around to the read head. At 24 Hz, that's about 12.75 seconds. Plan ahead: send values early and let them circulate to where you need them.

### The Read/Gate/Write Head

Each loop has a three-position head at a fixed location on the track. Data flows left to right past these three positions on every tick:

| Position | Symbol | Function |
|----------|--------|----------|
| Read (R) | R· | Where buses sample bits. Bus source sampling happens at the R dot before the loop rotates. |
| Gate (G) | G· | When the gate is CLOSED, any bit at this position is zeroed on that tick. When OPEN, data passes through freely. |
| Write (W) | W· | Where bus deliveries, ALU writebacks, inject channel output, and scratch register playbacks all land. Data enters the loop here. |

The R dot is at bit position 2 in the loop's bit array. The G dot is at position 1. The W dot is at position 0. This means that a bit written at the W dot will reach the G dot on the next tick, and the R dot on the tick after that — a natural two-tick pipeline.

### The Gate

Press CLOSE GATE on any loop to close that loop's gate. While closed, any bit that reaches the G dot is destroyed on that tick. This is how you clear data from a loop: close the gate and let the loop rotate. After one full rotation, all bits have passed the gate and been zeroed.

> **Warning.** Closing a gate does not stop circulation. Data injected from outside lands at the W dot, which is past the gate, and is not affected. But any data already circulating in the loop will be destroyed as it passes the G dot. Do not close the gate while something you need is in transit.

### Pause and Step

The ⏸ button on each loop freezes that loop in place. Other loops continue running. The STEP button on each loop advances only that loop by one position. The global STEP button in the control bar advances the entire machine by one tick.

Pausing a loop while a bus is delivering into it stops the delivery gracefully — the bus sees a zero bit from the halted loop. Data already in transit completes delivery into the paused loop's W dot on each tick, which means words may stack up at the write position while the loop is frozen.

---

## Chapter 4 — The Control Bar

The control bar runs across the top of the machine, below the header. It contains the master clock controls, speed adjustment, Op Count, and status indicators.

### Start, Stop, and Step

| Control | Function |
|---------|----------|
| START / STOP | Starts or halts the master clock. All loops run when the clock is running. |
| STEP | Advances the entire machine by exactly one tick. Useful for debugging. |

### Speed Control

Two controls set the clock speed and stay in sync with each other:

- **Slider** — 1 to 144 Hz in 1 Hz integer steps. Drag for quick coarse adjustment.
- **Number input** — 0.1 to 144 Hz, accepts any decimal. Type 0.5, 24, 12.5, or any other value. Moving the slider syncs the number; changing the number snaps the slider to the nearest integer.

The Hz display to the right of the controls shows the current speed. The Clock % display in the header shows how accurately the machine is hitting that target — green means ≥95% accurate, amber means ≥75%, red means below. At 24 Hz you should see solid green on any modern machine.

### Op Count

Op Count is a halt-on-match system. Set a target value in the Op Count input, then link it to one or more loop counters using the W, A, M, B, and G buttons. When any linked counter reaches the target, that loop halts automatically. The linked button turns red to show the halt state.

> **Common Mistake.** Op Count only fires if the linked counter is actually incrementing. Counters only increment when you have configured triggers for them in the Counter Triggers panel. If the counter never increments, Op Count never fires.

To release a halted loop: press RESET on that loop's counter. This resets the counter to zero and releases the halt. The loop begins circulating again immediately.

### Operator Handle and Session Name

Two text fields in the header identify your session. The Operator Handle is your name or alias — it appears in the session log file. The Session Name labels the specific computation. Both are optional but useful when reviewing log files later.

### Skins

Three visual skins are available: OG (default cool-grey industrial), Winamp (dark mode, lime green, 1990s bevel aesthetic), and Sunrise (warm amber and terracotta). Switching skins is instant and affects the full interface. Your choice persists across sessions.

---

## Chapter 5 — Loading Data: The Inject Channel

The inject channel is the primary way to load values into the machine. It runs as a horizontal strip above the loops and connects to the Working loop's write head.

### The Operator Switches

Sixteen toggle switches represent the 16 data bits. The switches are grouped visually: four switches on the left for bits b15–b12 (the address bits), then a small gap, then twelve switches for bits b11–b0. Flip a switch up for 1, down for 0. The display below shows the current value in decimal and hexadecimal as you set the switches.

**Drag to set:** Click on any switch and hold the mouse button down. As you drag across other switches they will all flip to match the initial direction of your first click — ON if you started on an OFF switch, OFF if you started on an ON switch. This lets you sweep across the full row to set all bits at once, or drag precisely to set a specific range.

Press CLEAR INPUT to set all switches to zero.

### Sending a Value

Press ▼ SEND. The machine prepends the marker bit and loads the 17-bit word into the inject channel. The full word enters the Working loop over the next 17 ticks.

> **Important.** You cannot inject a second value while the channel still has bits in flight — the INJECT LED will be lit. Wait until the channel clears before pressing SEND again. Watching the inject strip on the main display lets you see when the channel is clear.

### The RNG

The RNG button generates a random value within a range you specify and injects it directly into the Working loop. Set Min and Max to constrain the range — both default to the full 0–65,535 range. If Min exceeds Max after clamping, the range is invalid and the RNG will not fire.

The RNG is a linear feedback shift register (LFSR) seeded from Math.random(). Over large samples it produces balanced distributions, but like any PRNG it can show local clustering. The Filter challenge uses this property deliberately — testing whether a sample's parity distribution is as balanced as expected.

---

## Chapter 6 — Moving Data: The Buses

Buses move data between loops and other components. Each bus is a 24-slot pipeline — a complete word takes 41 ticks to travel across and land in the destination. Set source and destination first, then turn the bus on.

### Buses A Through D — All the Same Type

Buses A, B, C, and D are all the same kind of bus. Any of them can move data between any two loops. The differences are in what additional sources and destinations they can reach:

**A** — Any loop as source or destination. Also accepts PM1 output as a source, and handles counter read/write (any counter as source or destination).

**B** — Same as A. Full counter access — read any counter as a word, or write a word value into any counter. The dedicated counter bus.

**C** — Same as A and B. Run simultaneously with any other bus for parallel transfers between loops.

**D** — Same as A, B, and C. With all four active: Working → ALU → Memory → Big → Working forms a continuous mega-loop pipeline.

Running multiple buses simultaneously is normal and expected. Use two buses to move two values in parallel. Use three or four to create complex multi-loop pipelines. Each bus operates independently — turning one on or off does not affect the others.

> **Common Mistake.** Setting source and destination is not enough. You must also press TURN BUS X ON. The bus does nothing until explicitly activated. Turn it off when the transfer is complete — if you leave it on, data keeps flowing from source to destination continuously, which may overwrite values you want to keep.

#### Transfer Example: Working → ALU

1. In Bus A Config (sidebar), set Source to Working and Destination to ALU.
2. Press TURN BUS A ON. The purple Bus A strip lights up. Bits begin exiting the Working loop's R dot and traveling across the strip.
3. Wait 41 ticks. The full word arrives at the ALU loop's W dot.
4. If you have the Capture Route set, the ALU will begin capturing the word automatically as it arrives.
5. Press TURN BUS A OFF once the transfer is complete — or leave it on if more words are following.

### Bus E — External (Different from A–D)

**E** — External bus. Two-way: outbound (crimson, loop → external) and inbound (green, external → loop) channels run independently on the same strip.

Bus E is fundamentally different from A–D. It connects the machine to an external endpoint — either the Challenge Module or a network peer (future feature). The outbound channel carries data from a loop out to the endpoint; the inbound channel carries data from the endpoint into a loop. Both run simultaneously and independently.

Configure three things in the Bus E Config panel: External Endpoint — Challenge or Network; Outbound Source — which loop feeds the outbound channel; Inbound Destination — which loop receives incoming data.

When you start a Challenge, Bus E enables automatically and the inbound queue is loaded with the challenge values. You do not need to enable it manually for challenges.

### Counter Values as Data

Counter values are first-class data. Any bus can route a counter value into a loop as a word, or write a word value back into a counter. This lets you capture "how many words have I processed so far" as a number you can use in arithmetic — add it to something, compare it, store it in memory.

Use the →A, →B, →C, →D buttons on each counter strip to eject the counter's current value onto the corresponding bus. The COPY / EJECT toggle on each counter controls whether the counter resets to zero after sending (EJECT) or preserves its value (COPY).

### Buses F and G — P2P Left and Right

**F** — P2P Left. Outbound sends words from a source loop to the direct left neighbor. Inbound delivers words from the left neighbor into a destination loop.

**G** — P2P Right. Same as Bus F, for the directly connected right neighbor.

Buses F and G each have their own sidebar panel in order between Bus E and Bus H — same layout as all other buses: source selector, destination selector, on/off toggle.

> **Relay pattern.** A machine connected on both sides can relay data: words arrive on Bus F, circulate through loops, exit on Bus G. This forms a data pipeline across multiple machines with no special configuration.

### Buses H and I — Routed Net Buses

**H** — Net0. Routes words to any reachable machine by machine ID — direct neighbors or any machine further along the chain. Amber color.

**I** — Net1. Same as Bus H, independently addressable. Can point to a different machine than H, or the same one. Lime color.

Unlike F and G, Buses H and I route through the chain toward any connected machine by ID. To use: run PING NETWORK, open the Bus H (or Bus I) sidebar panel, select a peer target, set source and destination loops, turn the bus on. Words route automatically through intermediate machines without involving their loops.

> **Router pattern.** With H and I independently addressable, an operator can act as a network router: receive on H from machine A, process through a loop, forward on I to machine C. Every routing decision is the operator's. Every word is visible.

---

## Chapter 7 — The ALU: Arithmetic and Logic

The ALU performs all calculations. It operates on operands drawn from four persistent registers and maintains a live Answer that updates whenever the register contents or operation selection changes. All registers hold their values until you explicitly overwrite or clear them.

### The Four Registers

Registers A, B, C, and D each hold a single 16-bit value. To load a register:

1. Set the Capture Route selector (HEAD →) to the desired register letter.
2. Route a value into the ALU loop via a bus.
3. Wait for the word's marker bit to arrive at the ALU loop's R head. Capture begins automatically and completes after 17 ticks.

The Capture Route selector does not advance automatically unless ADVANCE mode is on. In HOLD mode, it stays on the current register after every SEND TO LOOP — useful for accumulator patterns where you're repeatedly overwriting one register with a running total.

Press SEND TO LOOP next to any register to inject that register's value back into the ALU loop. This starts a 17-tick writeback pipeline. The value then circulates in the ALU loop and can be recaptured into any register, or routed to another loop via a bus.

### Operand Selection

The Op A ← and Op B ← selectors choose which registers feed the two operand slots. You are not locked to A→Op A and B→Op B. You can compute A+C, D−B, or any combination — without moving data between registers first. This is a significant flexibility: keep a constant in one register and cycle other values through a second register to add, subtract, or compare against the constant repeatedly.

### Operations

**ADD** — Op A + Op B. Sets carry if result overflows 16 bits (exceeds 65,535).

**SUB** — Op A − Op B. Sets carry on borrow (when Op B > Op A).

**AND** — Op A AND Op B, bitwise. 1 only where both operands have 1.

**OR** — Op A OR Op B, bitwise. 1 where either operand has 1.

**XOR** — Op A XOR Op B, bitwise. 1 where operands differ.

**NOT** — Bitwise complement of Op A. Every 1 becomes 0, every 0 becomes 1. Op B unused.

**SHL** — Shift Op A left one bit (effectively ×2). Top bit goes to carry; zero enters at b0.

**SHR** — Shift Op A right one bit (effectively ÷2, integer). b0 goes to carry; zero enters at top.

**NEG** — Arithmetic negation of Op A (0 − Op A, two's complement). Useful for subtraction from a constant.

**INC** — Op A + 1.

**DEC** — Op A − 1. Carry set if Op A was 0 (underflow to 65,535).

**MOD** — Op A modulo Op B. Remainder after integer division. Sets carry if Op B is zero (division by zero — result forced to 0).

**ROR** — Rotate Op A right one bit. b0 wraps to b15 (becomes the new top bit). Carry receives the old b0. Unlike SHR, no information is lost — the bit circles back.

**ABS** — Absolute value of Op A (two's complement). If Op A's top bit is set (negative), result is the negation. Carry set if the input was negative. Overflow set if Op A is 0x8000 (the one value with no positive counterpart).

**NAND** — Not-AND of Op A and Op B, bitwise. Equivalent to NOT(AND(A,B)). Output is 0 only where both inputs are 1.

**NOR** — Not-OR of Op A and Op B, bitwise. Equivalent to NOT(OR(A,B)). Output is 1 only where both inputs are 0.

**XNOR** — Not-XOR of Op A and Op B, bitwise. Equivalent to NOT(XOR(A,B)). Output is 1 where both inputs match (both 0 or both 1).

> **Note on MUL and DIV:** These are not single operations. Multiplication is accomplished through repeated addition (or the more efficient SHL-and-add binary method). Division is accomplished through repeated subtraction. MOD (remainder) IS a single operation — it was added because modular arithmetic is fundamental to many algorithms and the two's-complement implementation is non-trivial to get right manually.

### 12-Bit Compatibility Mode

The MODE: 16-BIT toggle switches to 12-bit mode. In 12-bit mode, the top four bits (b15–b12) of both operands are masked to zero before computing, and results have zero in the top four positions. The top four bit-dots on register displays dim visually when 12-bit mode is active. Use this when interoperating with systems or data that uses 12-bit values.

### ALU Flags

Five flags update continuously alongside the Answer:

| Flag | Meaning |
|------|---------|
| ZRO | Result is exactly zero. |
| CRY | Carry out (ADD/INC), borrow (SUB/DEC), or shifted-out bit (SHL/SHR). |
| OVF | Signed overflow: result crossed the signed integer boundary. |
| SGN | Top bit of result is set — value is negative in two's complement interpretation. |
| PAR | Even parity: the number of set bits in the result is even. |

> **Philosophy.** Flags inform you, the operator. They do not trigger any automatic action. You read them and decide what to do next. This is intentional — the machine does not branch on conditions. You do.

### The Comparator

The Comparator runs continuously alongside the Answer, comparing Op A and Op B. Six flags update live: GT, LT, EQ, GTE, LTE, NEQ.

The six comparator flags are also available as a packed 16-bit word that can be written into the ALU loop via SEND TO LOOP in the Comparator section. Bit positions: GT→b5, LT→b4, EQ→b3, GTE→b2, LTE→b1, NEQ→b0. This lets you store a comparison result as data and route it wherever you need it.

---

## Chapter 8 — Memory Slots

Loop 2.1 provides 16 addressed memory slots — fixed storage locations numbered 0 through 15 that hold 17-bit words independently of loop circulation. Unlike the loops, memory slots do not circulate. A value written to slot 7 stays in slot 7 until explicitly overwritten or cleared.

### Writing to Slots

Press ENABLE WRITE TO SLOTS. While active, every complete word that passes the Memory loop's R head is captured into the currently addressed slot. The slot number is shown in the address display and set via four toggle switches (b3–b0) on the address selector row.

The toggle switches support the same drag-to-set behavior as the main input switches — click and drag across them to set a range of bits at once.

### Auto-Increment

Press TURN AUTO-INC ON to have the address pointer automatically advance to the next slot after each capture. Starting from slot 0 (or whatever address you set), successive words landing at the Memory head are stored into slots 0, 1, 2, 3… in sequence. After slot 15, the address wraps to 0.

This makes loading a dataset straightforward: set the start address, enable Write and Auto-Inc, route your values into the Memory loop, and they distribute themselves into consecutive slots.

### Reading Slots

Press SEND TO LOOP next to any slot to inject that slot's value into the Memory loop head. Enable TURN DESTRUCT ON to clear the slot after sending.

Press BATCH WRITE ALL to output all 16 slots sequentially into the Memory loop in slot order (0 through 15). Each slot is sent in turn; you do not need to press anything for each individual slot.

### Address-Read Mode

When ADDR-READ: ON is active alongside ENABLE WRITE TO SLOTS, the destination slot is decoded from the arriving word's top four bits (b15–b12), overriding the manual address selector and auto-increment.

Example: a word arrives with value 0010 000000110010. Top four bits = 0010 = 2. The word is written to slot 2. The full 16-bit value is stored intact.

This lets you encode destination addresses directly into data words before routing them to memory — useful for building lookup tables or routing values to specific slots without manually changing the address.

---

## Chapter 9 — Working Scratch Registers

Four capture-next holding registers are attached directly to the Working loop. Unlike the memory slots, they require no bus routing — values captured from or sent to the Working loop stay local to it. They are useful for holding intermediate values without the 41-tick round-trip of a bus transfer.

### Capturing

Press ENABLE CAPTURE in the Working Scratch panel. The button lights up and shows which slot is targeted next: "CAPTURE ON — next word → slot 0."

The next complete word that passes the Working loop's R head is captured into slot 0. Capture then automatically switches to slot 1. After slot 1 is filled, it returns to slot 0. You can load both slots by simply leaving capture on and letting two words circulate past the head.

A small indicator dot appears next to the "◈ Working" label in the loop header when capture is active, so you can see its state without opening the sidebar.

### Sending Back

Press →W next to a slot to inject that slot's value into the Working loop's write head. This starts a 17-tick writeback pipeline identical to the ALU's SEND TO LOOP. The value circulates in the Working loop and can be routed anywhere from there.

> **Use Case.** You've routed 5 values into Working and want to compare each one against a threshold before deciding what to do. Capture the threshold into scratch slot 0. As each value circulates past, load it into an ALU register, load scratch slot 0 into another register, and read the comparator flags. No bus crossing, no waiting for values to come back from the ALU loop — the threshold is right there.

---

## Chapter 10 — Counters and Triggers

Loop 2.1 has five counters: one for each loop (Working, ALU, Memory, Big) and one global counter that tracks the total across all loops. All start at 0.

> **Critical.** Counters are not automatic. By default, every trigger is off and no counter ever increments. You must activate triggers in the Counter Triggers panel for each counter you want to use.

### Triggers

Each loop counter can be configured to increment on one or more events:

| Trigger | Fires when |
|---------|-----------|
| Word Written | A marker bit arrives at the loop's W dot — start of a word entering the loop. |
| Word Read | The final bit of a word passes the R dot — one complete pass-through. |
| Bits Written | Any bit written that is part of a word. Fires 17× per word. |
| Bits Read | Any bit sampled that is part of a passing word. Fires 17× per word. |
| Full Cycle | The loop completes one full rotation. |
| ALU: Reg Sent | A register's SEND TO LOOP is pressed. |
| ALU: Answer Sent | The Answer's SEND TO LOOP is pressed. |
| ALU: Cmp Sent | The Comparator's SEND TO LOOP is pressed. |
| Memory: Write to Slot | A word is captured into a memory slot. |
| Memory: Read from Slot | A slot's SEND TO LOOP is pressed. |
| Big: PM Match | PM1 detects a match. |
| Big: PM Rewrite | PM1 rewrites a matched word. |
| Big: PM Eject | PM1 ejects a matched word (destructive mode). |

### The Global Counter

The global counter increments once for every increment of any loop counter. It is a running total of all counter fire events across all four loops. Use it when you want a single number that reflects total activity across the whole machine.

### Counter Controls

| Control | Function |
|---------|----------|
| →A / →B / →C / →D | Serializes the counter's current value as a 17-bit word onto the specified bus. |
| COPY / EJECT | EJECT resets the counter to zero after sending. COPY preserves it. |
| RESET | Sets the counter to zero immediately. Also releases any Op Count halt on that loop. |

> **Tip — Counting Words Processed.** Enable "Word Read" trigger on the Working counter. Route values through Working. When done, eject the counter onto Bus B to send the count to any loop as data. You can then capture it into an ALU register and use it in arithmetic — multiply by a unit value, compare against a target, store in memory.

---

## Chapter 11 — The Pattern Matcher

Two Pattern Matchers (PM1, PM2) are attached to the Big Loop. Both sit on the bottom track of the loop, positioned so PM1 is encountered first, then PM2. Every word circulating in the Big Loop passes both inspection points on every rotation.

### How Matching Works

Each PM uses two 16-bit registers:

- **Mask** — bit=1 means "check this bit position"; bit=0 means "ignore this position"
- **Pattern** — the value to compare against, for the bit positions selected by the mask

Match condition: (data AND mask) == (pattern AND mask)

A mask of all zeros disables the PM — there is nothing to check. At least one mask bit must be set for the PM to activate.

**Example — Match Even Numbers.** Mask = 0000000000000001 (check b0 only). Pattern = 0000000000000000 (b0 must be 0). Any value where b0=0 is even, so this matches all even numbers.

### On a Match

When a match occurs:

1. The MATCH flag lights and the match counter increments.
2. If REWRITE is ARMED, the matched word is modified in-place before any other action.
3. The word is loaded into the PM output bridge.
4. If EJECT: COPY — the word stays in the Big loop and continues circulating. A copy sits in the bridge.
5. If EJECT: DESTRUCTIVE — the word is zeroed out and removed from the Big loop. Only the ejected copy survives in the bridge.

Set Bus A source to PM to route matched words out of the bridge. Bus A will pick up the word from the bridge and deliver it to whatever destination you have set.

> **Bridge Note.** The PM bridge holds only one word at a time. If a second match fires before the first is consumed by Bus A, the bridge is overwritten. At high clock speeds with frequent matches, use Bus A continuously to drain the bridge.

### Match Count — Sending the Counter to a Bus

Each PM keeps a running match count — the total number of matches since the PM was enabled. The buttons labeled →A, →B, →C, and →D next to the match count display serialize that count as a 17-bit word and inject it onto the corresponding bus. Use this to treat the match count as an operand — load it into the ALU, compare it against a target value, store it in memory, or send it to another machine over a Net bus.

### PM2 — Cascade Mode

PM2 operates independently with its own mask, pattern, rewrite, and eject settings. It can be set to one of two modes:

- **Independent** (default) — PM2 inspects the full loop, including words that PM1 matched or ejected. Both PMs see everything.
- **Cascade** — PM2 only sees words that PM1 passed. If PM1 ejected a word destructively, PM2 never sees it. PM1's matches flow into PM2's inspection queue.

Cascade mode is powerful for two-stage filtering: PM1 handles a first condition (e.g., even numbers), PM2 handles a second condition on what remains (e.g., greater than 100). The result is values that satisfy both conditions in a single pass through the Big loop.

PM2 has its own output bridge and its own match counter, independent of PM1.

### Rewrite Mode

When REWRITE: ARMED, every matched word has specified bits modified before ejection or copying. Configure two additional registers:

- **Rewrite Mask** — selects which bit positions to change
- **Rewrite Value** — specifies the new values for those positions

Example: matched words have their top bit zeroed. Set Rewrite Mask = 1000000000000000 (change b15), Rewrite Value = 0000000000000000 (set b15 to 0). The word is modified in-place in the Big loop before being loaded into the bridge.

With EJECT: COPY, the rewritten value stays in the loop. This lets you transform a dataset in-place over multiple rotations without moving values out of the loop.

---

## Chapter 12 — The Threshold Gate

Two Threshold Gates (TG1 and TG2) operate on the Big Loop alongside the Pattern Matchers. Where the Pattern Matcher compares bit patterns, the Threshold Gate compares numeric magnitude — ejecting words whose value crosses a configurable threshold.

### Basic Operation

Each Threshold Gate has a numeric threshold value (0–65,535) and a comparison mode:

| Mode | Condition |
|------|-----------|
| ≥ threshold | Eject values greater than or equal to the threshold |
| ≤ threshold | Eject values less than or equal to the threshold |
| = threshold | Eject only exact matches |

Set the threshold value using the levers in the TG panel or by typing directly into the value field. Enable TG1 and words matching the condition are ejected from the Big Loop. Route TG1's output to another loop via any bus.

> **TG vs PM.** The Pattern Matcher is ideal for bitmask conditions — even/odd, top bit set, divisible by powers of two. The Threshold Gate is ideal for range conditions — greater than 1000, less than 500, between two values. Use them together to build compound conditions.

### Clamp Mode

When CLAMP: ON is enabled on a Threshold Gate, matching words are not ejected — they are rewritten in-place to the configured clamp value. This creates a ceiling or floor clamp on the data circulating in the Big Loop.

Example: TG1 with mode ≥ and threshold 1000, clamp value 1000. Any value above 1000 becomes exactly 1000. All values below 1000 are untouched. The Big Loop now contains values clipped to a ceiling of 1000.

Reverse: mode ≤, threshold 100, clamp 100. Values below 100 become 100 — a floor clamp.

Clamp mode processes words silently in-place. No eject, no bus transfer required. The modification happens in the loop as the word passes the gate position.

### TG Cascade and Pipeline

TG2 can receive TG1's ejected output directly via cascade mode. A word ejected by TG1 feeds into TG2's inspection path. This creates a two-gate pipeline: a value must pass TG1's condition before TG2 evaluates it.

Combined with the Pattern Matcher cascade, the Big Loop can run a four-stage conditional pipeline — PM1 → PM2 → TG1 → TG2 — entirely without operator routing between stages. Each stage filters or transforms the output of the previous one. Route the final TG2 output to its destination and all four stages operate in a single pass.

### Filter Order

By default, the Big Loop's filter chain processes data in PM-first order: words pass the Pattern Matchers before reaching the Threshold Gates. The filter order can be swapped to TG-first using the filter order toggle, reversing the pipeline so Threshold Gates process words before the Pattern Matchers see them. The current filter order is saved and restored with session snapshots. Swapping filter order can change which stage gets first pick of the data — useful when TG and PM conditions overlap and you want to control which filter has priority.

### Match Count — Sending the Counter to a Bus

Like the Pattern Matcher, each Threshold Gate keeps a running match count. The →A, →B, →C, and →D buttons next to the count display send the current count value onto the corresponding bus as a 17-bit word. Use this to track how many values crossed the threshold during a session, compare against a target, or pass the count to another machine.

---

## Chapter 13 — P2P Connections: Chain Left & Chain Right

Two machines can connect directly via WebRTC without any server infrastructure. Once connected, words flow between machines over Buses F and G exactly as they flow between loops internally. Each connection also includes a text chat channel.

### No Server Required

Loop 2.1 P2P connections are fully peer-to-peer. The SDP exchange (the offer/answer handshake) happens out-of-band — copy and paste the offer text through any channel (email, chat, anything). After the handshake, the connection is direct between the two browsers and requires no ongoing infrastructure.

### Setup

Open the P2P Connection section in the right sidebar. Your machine ID is shown at the top — a short random identifier that persists across sessions in this browser.

1. On the initiating machine: click CREATE OFFER under PL LEFT (Bus F). A WebRTC SDP offer appears in the text area. Copy it and send it to the other operator.
2. On the second machine: paste the offer into the remote text area and click ACCEPT. An answer is generated. Copy it and send it back.
3. On the initiating machine: paste the answer and click ACCEPT. Both machines show CONNECTED and the Bus F strip activates. The latency display shows round-trip time in milliseconds.

Repeat the process for PR RIGHT (Bus G) to connect to a machine on the other side, forming a chain.

### Routing Data Over P2P

Once connected, Buses F (Chain Left) and G (Chain Right) behave like any other bus. Each has its own sidebar panel — open Bus F or Bus G in the right sidebar to configure source and destination:

- **Outbound source** — which loop to read words from and transmit to the neighbor
- **Inbound destination** — which loop to deliver received words into

Words exit from the source loop on the sending machine and arrive in the destination loop on the receiving machine. The latency is the WebRTC round-trip time — typically under 5ms on a local network, 20–150ms over the internet.

A machine connected on both sides (Bus F left, Bus G right) can relay words from one neighbor to another. Values enter from the left, circulate through any of the four loops, and can be routed out to the right. This forms a data pipeline across multiple physical machines.

For connections to non-adjacent machines, use Buses H and I. See Chapter 6 for details.

### P2P Buffer

Incoming P2P words are queued in a buffer before entering the destination loop. The buffer count is shown in the P2P Connection panel. At high clock speeds or low latency the buffer usually drains immediately. If values are arriving faster than the destination loop can absorb them, the buffer count climbs — reduce the sender's clock speed or route the destination loop to a faster throughput path.

---

## Chapter 14 — The Challenge Network (CBX)

The Challenge Network is a coordination layer built on top of P2P connections. It allows Challenge Boxes on different machines to run multi-computer challenges together. The originating machine's Challenge Box acts as host and verifier. All inter-machine coordination happens automatically over the existing WebRTC connections — operators interact only with their local Challenge Box and their loops.

The Challenge Network panel sits below the Challenges panel in the right sidebar.

### Network Probe

Before starting a multi-computer challenge, run a network probe to discover the chain topology. Click ⬡ PING NETWORK in the Challenge Network panel. A probe travels out both connected sides, counting hops, detecting ring topology, and returning. The result shows: how many machines are to the left and right, total machine count (including this machine), and whether the network is a linear chain or a ring.

Run the probe before starting any chain challenge. The challenge system uses the topology to assign positions and determine the starter machine.

### Availability — How Invitations Work

All machines always accept challenge invitations unless they are currently running a local challenge (CHALL.active). There is no opt-in or opt-out setting. When a CHAIN_INVITE arrives:

- **Machine is idle:** invitation is auto-accepted immediately. The Challenges panel expands and shows the chain active display with your assignment.
- **Machine is busy** (running a local challenge): the invite is skipped. A skip notice goes back to the origin and the invitation is forwarded to the next machine in the chain. The challenge continues past the busy machine without any action from its operator.

> **No action required to participate.** You do not need to configure anything to be included in chain challenges. If your machine is idle when an invitation arrives, you are automatically included. If you want to sit out, start any local challenge before the invitation reaches you — your machine will skip itself automatically.

### How CBX Works — The Protocol Layer

CBX packets travel over the same WebRTC data channels that carry ordinary P2P word traffic. Every incoming P2P message is inspected before touching any loop data path. If the first element of the message carries the type identifier cbxType, the message is a CBX packet and is routed to the CBX handler invisibly. If not, it is ordinary loop data and is processed normally. The two streams share the same wire and never interfere.

CBX messages are structured JSON objects with a cbxType field that identifies their purpose. The full set of message types covers the complete lifecycle of a chain challenge:

| Message type | Direction | Purpose |
|-------------|-----------|---------|
| cbx_probe | Outward along chain | Lightweight hop-counting probe for topology discovery |
| cbx_probe_return | Back toward origin | Probe returning with hop count and ring-detection flag |
| cbx_chain_invite | Origin → neighbors | Challenge invitation |
| cbx_chain_invite_ack | Neighbor → origin | Acceptance or decline of the invitation |
| cbx_chain_assign | Origin → each machine | Role assignment: position, value, direction, par values |
| cbx_chain_assign_ack | Each machine → origin | Ready confirmation — origin waits for all before GO |
| cbx_chain_go | Origin → all | Challenge starts — synchronized across all machines |
| cbx_chain_sum_submit | Participant → origin | Local sum submission for verification |
| cbx_chain_sum_ok | Origin → participant | Submission verified — position confirmed correct |
| cbx_chain_sum_fail | Origin → all | Wrong sum — full abort with failing position identified |
| cbx_chain_complete | Origin → all | All verified — challenge succeeded with final sum |
| cbx_chain_abort | Origin → all | Challenge cancelled — all machines release resources |

The chain sum forwarding mechanism — passing the running total from one machine to the next — uses a slightly different path. Rather than JSON, this uses a two-word marker sequence directly in the raw P2P word channel: the reserved marker word 0xCB00 followed immediately by the sum value. The receiving machine's CBX layer intercepts the marker before it reaches any loop, treats the following word as the incoming sum, and stages the operator's assigned value for release. The marker word 0xCB00 never reaches any loop — it is consumed entirely by the CBX layer.

> **Why a Separate Path for Sum Forwarding.** CBX control messages (invitations, assignments, verification) travel as JSON over the data channel. But the running sum needs to arrive in a way that the operator can observe at the read head — it is real data entering the machine, not just a protocol event. The two-word marker approach lets the sum travel alongside ordinary word traffic while still being identifiable and interceptable by the CBX layer before it touches the loops.

### Addressing — Position Numbers

When a chain challenge is active, every machine has a signed position number relative to the origin. The origin is always position 0. Machines to the right are positive: +1, +2, +3. Machines to the left are negative: −1, −2, −3. In a seven-machine linear chain, positions run from −3 through +3 with the origin at center, or from 0 through +6 if the origin is at the left end.

The origin picks the starting machine automatically — the terminus furthest from the origin on whichever side is longer, or the right side terminus by default. The starter's incoming sum is defined as 0. Every ASSIGN message encodes each machine's position, the starter's identity, and which side to expect the incoming sum from, so no machine needs to know anything about the full chain beyond its immediate neighbors.

### Buses H and I — Routed Net Buses

Buses H and I are fully operator-controlled routed buses. Unlike F and G, which connect only to direct P2P neighbors, H and I can send words to any reachable machine in the connected topology. Open the Bus H or Bus I panel in the sidebar, select a peer target, set source and destination loops, and turn the bus on. See Chapter 6 for full operating instructions.

An operator with H pointed at one remote machine and I at another can act as a network router — receiving data on H, processing through loops, forwarding on I. Every routing decision is the operator's. Every word that transits this machine is visible.

### Inspecting CBX Traffic — Three Levels of Access

The Challenge Network is designed with three levels of operator engagement. Most operators never go past the first. The machine supports all three.

**Passive — The Default Experience.** The operator never touches Bus H. The Challenge Network panel shows their role, the progress display shows each machine verifying, and values arrive via the inject mechanism when released. The CBX protocol runs entirely in the background. From this operator's perspective, the challenge just works.

**Curious — Reading the Protocol.** Use the Network Monitor to watch CBX traffic in real time. Every INVITE, ASSIGN, GO, SUBMIT, SUM_OK, SUM_FAIL, ABORT, and COMPLETE message is captured as it passes through the machine, with full field display.

For a more direct experience: the running sum travels over the P2P wire as a raw 17-bit word. At the read head of the Bus F or G destination loop, you can watch that value arrive like any other data word. The challenge ID appears in every CBX message — once you have seen it in the monitor, you will recognize it in the raw stream.

**Hacker — Modifying the Protocol.** The Network Monitor staging area lets you capture any CBX packet, edit its fields, and inject the modified version back into the local handler. A modified SUBMIT packet is evaluated against the origin's known correct sum. A modified ASSIGN packet updates this machine's assigned value. Injection goes through the same handler as a real incoming packet — effects are immediate.

This is not an exploit — it is an intended capability. The machine is transparent by design. The Challenge Box exists as a convenience, not as an authority. The protocol is the authority, and the protocol is visible.

> **On Transparency.** The CBX layer could have been completely hidden — a background service the operator never sees. It was not hidden deliberately. Transparency is a design principle, not a default that gets overridden when things get complicated. The harder it is to make something visible, the more important it usually is to do so.

---

## Chapter 15 — Networking: Chain and Net

Loop 2.1 uses two distinct networking concepts. The Chain is the physical topology formed by your P2P connections — a linear sequence of machines, or a ring if the ends connect. The Net is a user-created virtual network that rides on top of the Chain, giving a group of machines a shared identity, a membership list, coordinated routing, and a unified chat system.

> **Prerequisite.** Networking requires at least one active P2P connection. Connect to your left neighbor, your right neighbor, or both using the P2P Connection panel (Chapter 13) before working with anything in this chapter. Everything in the Networking panel depends on the underlying P2P chain being established first.

### The Chain

The Chain is the physical foundation. It exists the moment you make a P2P connection — you are now in a Chain with your neighbor. Every machine you can reach by hopping left or right along P2P connections is part of your Chain. Chains can be linear (two open ends) or looped (the rightmost machine connects back to the leftmost).

Machines in the Chain can forward messages transparently for each other. A machine two hops to the right is reachable via the machine directly to your right, which relays the message without any operator intervention. This relay behavior is automatic and invisible — intermediate operators do not need to do anything, and their loops are entirely unaffected.

> **Chain vs Net.** The Chain is discovered, not created. You are in a Chain by virtue of having P2P connections. A Net is created intentionally by a hub operator who invites specific machines to join a named group.

### Scanning the Chain

The Networking section is in the right sidebar, above P2P Connection. Open it and click ⬡ SCAN CHAIN. A probe travels in both directions, collecting machine IDs, handles, and Net membership information, then returns. After a few seconds the topology display updates:

- 1 left · 1 right · 3 total — three machines in a linear chain, you in the middle
- 2 left · 2 right · 5 total — five machines, you near the center
- 1 left · 1 right · 3 total (ring) — three machines in a ring

The scan also discovers any named Nets that already exist on the Chain. Discovered Nets appear in the Available Nets subsection, where you can request to join them.

A scan runs automatically when a new P2P connection opens. Re-run it manually after the topology changes or new machines join.

Once the scan completes, the Create Net subsection shows a list of all detected machines with their handles and positions. These are your invite candidates.

### Creating a Net

Open the Create Net subsection in Networking. You will see a name field and a list of detected machines.

1. Type a name in the net name field (up to 24 characters).
2. Check the boxes next to the machines you want to invite. You do not have to invite everyone on the Chain.
3. Click ⬡ CREATE NET. Invitations are sent to each selected machine.
4. Wait for responses. Each invited machine sees an invitation panel. As they accept or decline, your status updates. Once all responses are in, the Net is live and the routing table is distributed to all members.

After creation, the Net appears in your My Nets subsection with a HUB badge. The member list shows handles, positions, and roles. As hub, you also handle any join requests that arrive later from machines not in the original invite.

> **One hub per machine.** Each machine can be the hub of at most one Net at a time. You can be a member of additional Nets simultaneously, but you can only manage one as hub.

### Joining a Net

**Accepting an invitation:** When another machine invites you, an invitation panel appears in your Networking section showing the Net name and the hub's handle. Click ACCEPT to join or DECLINE to refuse.

**Requesting to join:** If a scan discovers a Net you are not in, it appears in Available Nets with a REQUEST TO JOIN button. The hub reviews requests in their Join Requests subsection and approves or denies each one.

Once you join, the Net appears in My Nets with a MEMBER badge. The routing table is distributed by the hub, so messages can reach any member regardless of how many hops they are from you.

To leave a Net you are a member of: My Nets → LEAVE NET. If you are the hub: My Nets → DISSOLVE NET — this ends the Net for all members.

### Members and Roles

The My Nets subsection shows every Net you are involved in, each with its full member list. For each member you can see:

| Field | Meaning |
|-------|---------|
| Handle | The machine's operator handle, or its raw machine ID if no handle has been set. A ★ marks your own entry. |
| Position | The machine's signed chain position relative to you at the time it joined. Positive = right, negative = left. This is informational — routing does not depend on it. |
| Role | HUB for the network manager. MEMBER for everyone else. |

### Hub Responsibilities and Election

The hub manages membership, distributes the routing table, sends heartbeat signals, and handles join requests. These functions are automatic — the hub operator does not need to do anything manually once the Net is running.

Join requests appear in the hub's Join Requests subsection (hidden when empty). Each shows the machine's handle and position. Click APPROVE or DENY. Approved machines immediately receive the routing table.

**Hub election:** If the hub becomes unreachable — three missed heartbeats, approximately 15 seconds — remaining members elect a new hub automatically. The rule is simple: lowest machine ID wins. The winner broadcasts a claim, all machines acknowledge, and the new hub begins sending heartbeats. From a member's perspective the election is mostly invisible, with a brief routing gap of a few seconds.

If the original hub returns after an election, it rejoins as a plain member. It does not reclaim the hub role automatically.

### Multiple Networks

A single machine can be a member of more than one named Net simultaneously, but can only be the hub of one. This allows a machine at a junction in a long chain to bridge two different groups without those groups needing to know about each other.

Each Net appears as a separate entry in My Nets. Routing tables are maintained independently per Net. A message addressed to a machine in Network A does not interact with Network B's routing, even if some machines are members of both.

### Chat

The Chat section (in the sidebar below Networking) is a unified messaging panel. It shows every machine you can communicate with — direct P2P neighbors and Net members — in a single dropdown. Each machine appears once regardless of how many ways you are connected to it.

Select a machine from the dropdown to load your conversation history with it. Type a message and press SEND or hit Enter. The chat system routes messages by the best available path: direct for P2P neighbors, relayed through the Chain for Net members who are not direct neighbors. You do not need to think about which path is used.

Handles in the dropdown reflect the operator's current session handle. If a machine connects before setting a handle, its machine ID shows as a placeholder and updates automatically when the handle is set.

A machine can belong to multiple Nets simultaneously but can only be the hub of one. Each Net maintains independent membership lists and routing tables. Chat deduplicates — if a machine is reachable through two Nets, it appears once in the dropdown with the conversation history unified.

### Refresh and Reset

Nets do not persist after a page refresh. After refreshing: all P2P connections must be re-established, all Net memberships end, all chat history clears. Your machine ID persists in local storage. To reform a Net, run the P2P handshake, re-scan the Chain, then recreate or rejoin the Net.

---

## Chapter 16 — The Session Log

Loop 2.1 records computation sessions to a structured .loop file. Every operator action and machine event is captured in a dual-format line: machine-parseable code on the left of ||, human-readable description on the right. This format is both software-parseable and readable by a human looking at the raw file.

### Starting a Log

1. Enter your Operator Handle in the header field (optional but recommended).
2. Enter a Session Name if desired — labels the computation for later reference.
3. Press BEGIN SESSION LOG.
4. Everything from this point is recorded: every tick, every bus transfer, every ALU operation, every operator action.
5. Operate the machine normally.
6. When done, write any notes in the Operator Notes field, then press END SESSION LOG and download the .loop file.

### File Format

| Section | Contents |
|---------|----------|
| SPEC | Machine configuration at session start: loop sizes, word format, clock speed, operator handle, session name. |
| INIT | Full machine state snapshot at session start — all loop contents, all register values, all counter states. |
| OPS | Tick-by-tick operation log. T##### lines mark clock ticks. Operator actions (S##### lines) appear between tick lines. Both machine code and prose description on each line. |
| NOTES | Free-text operator notes written before ending the session. |
| FINAL | Complete machine state snapshot at session end, plus performance statistics. |
| FORMAT REF | Embedded format reference — the file explains its own format. |

### Session Statistics

The FINAL section includes a statistics package: operator actions, words transferred, ALU ops executed, injects, bus activations, gate toggles, PM matches, step-backs, actions per tick, and words per tick. These numbers are useful for comparing different approaches to the same computation — a more elegant solution will show fewer operator actions and fewer total ticks.

> **Design Note.** The distinction the format makes explicit — between automatic machine actions (BUS.A.XFER, ALU.EXEC) and operator decisions (marked OP.) — is not incidental. It is one of the core principles of Loop 2.1 made visible in the record. When you read a .loop file, you can see exactly where the human intervened and where the machine acted on its own.

---

## Chapter 17 — Challenges

The Challenges panel (top of the right sidebar) provides structured computational tasks. The module sends values to the machine via Bus E inbound, you perform a computation, and you send the answer back via Bus E outbound. The module catches it, checks it, and scores your run.

### Setup

Open the Bus E Config panel. Set Inbound Destination to whichever loop you want values arriving in (Working is typical). Set Outbound Source to whichever loop your answers will come from. Bus E enables automatically when you start a challenge — you don't need to turn it on manually.

### Scoring

Scores are based on efficiency relative to par — not absolute time. Par is the theoretical minimum ticks and operator actions for an optimal operator solving the exact instance you were given. A hard challenge scored at par earns the same 1000 points as an easy one scored at par.

Two scoring modes are available, selectable before a challenge starts. Switching mid-challenge is locked.

| Mode | Formula | When to use |
|------|---------|-------------|
| Efficiency (default) | ticks × 55% + ops × 45% | Pure computation quality — how close to par on ticks and actions |
| Speed | ticks × 35% + ops × 30% + wall-clock × 35% | Real-time performance — rewards operators who work fast under pressure |

```
tickEfficiency = min(1.0, parTicks / actualTicks)
opEfficiency   = min(1.0, parOps / actualOps)
efficiency     = tickEfficiency × 0.55 + opEfficiency × 0.45   [Efficiency mode]
score          = max(50, floor(efficiency × 1000))
```

The score display shows a breakdown: 742 (78%t · 91%op). Speed mode adds a time component: 742 (78%t · 91%op · 85%tm). History entries are tagged [E] or [S] to indicate which mode was used.

A ▶ Show values toggle appears after a challenge starts. Click it to reveal the actual values that were sent. This is a spoiler — use it if you're stuck or want to verify your captures.

### Add X Numbers

N values arrive via Bus E inbound. Add them all and return the sum via Bus E outbound.

Select the count (2 through 32). Values are generated to sum within 16 bits — no overflow. Route them to the ALU loop, capture successively into registers, accumulate using repeated ADD with SEND TO LOOP and recapture. When your final sum is in a register, SEND TO LOOP and route it back out through Working via Bus E.

Par formula: parTicks = 77N + 5 · parOps = 3N + 4

### Multiply Two Numbers

Two values arrive. Multiply them and return the product.

The operator controls the maximum value of A (2–64). B is calculated so A × B fits within 16 bits. Repeated addition is the canonical approach: load A into a register, add A to a running total B−1 times. The binary method (SHL + ADD) is more efficient if you know it.

Par formula (repeated addition): parTicks = 36 × (min(a,b) − 1) + 82 · parOps = 3 × min(a,b) + 5

### Transform Every Nth Value

A stream of values arrives. Apply a given operation to every Nth value, then return only the transformed values via Bus E outbound.

Choose the stride (which Nth — 2nd, 3rd, 4th, 5th, 6th, or 8th) and the total stream length. The operation is chosen randomly at start: INC, DEC, SHL (double), SHR (halve), or NOT. You do not know which operation until the challenge begins.

Let the full stream circulate through the Working loop while counting. When you reach position N, capture that value, apply the operation in the ALU, and send it back out Bus E. Continue for each Nth position. You only return the transformed values — not the full stream.

Par formula: parTicks = 41 × totalCount + 123 × transformCount · parOps = totalCount + 4 × transformCount

### Filter: Pass Back Matching Values

A stream of values arrives. Identify those matching the stated condition and return only the matching values via Bus E outbound.

Choose the stream length (8 to 32). The condition is chosen randomly at start from: even, odd, divisible by 3, divisible by 4, ≥ threshold, < threshold, top bit set, even AND ≥ 128. The stream is constructed so 25–33% of values match.

The Pattern Matcher on the Big Loop is the natural tool for this challenge: route the incoming stream into the Big loop, configure PM1 to match the stated condition with EJECT: DESTRUCTIVE, set Bus A source to PM, and matches flow directly back to Working and out Bus E. No manual inspection required for most conditions.

Par formula: parTicks = 41 × totalCount + 18 × matchCount · parOps = totalCount + matchCount

### Sort Values (Low → High)

A set of values arrives. Sort them from lowest to highest and return all values in sorted order via Bus E outbound.

Choose the count (4 to 16). Route all values into the Big Loop first. Then repeatedly scan: find the minimum, eject it via a Threshold Gate or by manual comparison through the ALU, and send it out. Each scan extracts one value in sorted order. The Big Loop's 48-word capacity holds the full working set while you extract values one at a time.

The Threshold Gate with ≤ mode and a decreasing threshold can automate much of the extraction pass: set the threshold to the current known minimum, and the TG ejects it automatically.

### Find the Maximum

A stream of values arrives. Find the single largest value and return it via Bus E outbound.

Route values to the ALU loop in pairs. Load each pair into registers A and B, compute MAX (or compare and swap), and keep the larger. Route the running maximum back into the ALU loop and compare it against the next incoming value. After all values have been compared, the value in register A (or C after final MAX) is the maximum. Send it out.

### XOR Checksum

A set of values arrives. XOR all of them together and return the single result via Bus E outbound.

Route all values to the ALU. Load the first into register A, the second into register B, XOR them. Route the result back to ALU as the new A. Continue until all values have been XORed into the accumulator. XOR is commutative and associative — order does not matter. The final result is the checksum.

### Count Matches

A stream of values arrives. Count how many match the condition revealed at start. Return the count — a single number — via Bus E outbound.

The condition is revealed when the challenge starts. Use the Pattern Matcher: configure PM1 to match the condition, enable the PM1 match counter, route the stream through the Big Loop. When all values have passed, eject the PM1 match count onto a bus and route it back out through Bus E. One value returned: the count of matches.

### Accumulate to Threshold

Values arrive continuously via Bus E. Keep a running sum. A threshold value is revealed at challenge start. Return the running sum the moment it meets or exceeds the threshold — do not wait for all values to arrive.

Route incoming values to the ALU, accumulate a running total. On each addition, compare the total against the threshold (loaded into register B). When the comparator shows GTE (≥), your total has crossed the threshold. Route the current running total out via Bus E immediately. You return exactly one value.

### Chain Sum (Network)

A multi-computer challenge requiring active P2P connections and Challenge Network availability. Each machine in the chain receives a unique assigned value. The chain collectively computes the sum of all values, with each machine adding its value to the running total and passing it onward. The originating Challenge Box verifies each submission and reports the final result.

**Prerequisites.** P2P connections must be established (Chapter 13). Run PING NETWORK in the Challenges panel to confirm chain topology before starting. All available machines in the chain will be invited automatically — busy machines are skipped and the chain continues past them.

**Origin machine flow:**

1. Select ⬡ Chain Sum (Network) and click ▶ NEW CHALLENGE. Invitations go out to all connected neighbors.
2. Wait for all participants to accept. Once accepted, each machine receives an assigned value and learns its role — starter, middle, or terminal — and which direction to expect the incoming sum from.
3. Watch the chain progress display (one cell per machine) fill green as each submission is verified. When all are green, route your own assigned value through the ALU, add it to the incoming partial sums, and route the final total out via Bus E.

**Participating machine flow:**

1. Accept the invitation in the Challenge Network panel. Your role, direction, and assigned value are shown.
2. If you are the starter: your RELEASE button is available immediately. Click it to inject your assigned value into Working. Your incoming sum is 0, so your local sum equals your assigned value. Route it to Bus E.
3. If you are not the starter: wait. Your RELEASE button is greyed out until the running sum arrives from your designated neighbor. When it arrives, your assigned value is staged and the RELEASE button activates. Click it — but not before: pressing early locks you out for 3 seconds.

Add your assigned value to the incoming running sum in the ALU. Route the result to Bus E outbound. Your Challenge Box submits it to the origin for verification and automatically forwards the updated running sum to your next neighbor.

> **Chain Failure.** Any wrong submission aborts the entire challenge immediately. The origin identifies the failing position. Every operator in the chain is accountable for their arithmetic. There is no partial credit and no recovery — only a restart.

### ★ Bridge Crossing (Operators Club)

A special challenge available to Operators Club members. Bridge Crossing is distinguished in the challenge list by a ★ prefix. It tests advanced routing and coordination skills beyond the standard challenge set.

### Custom Challenges

Operators can define and register their own local challenge types using the Custom Challenges panel at the bottom of the Challenges section. A custom challenge is a JavaScript definition object pasted into the input field and registered with the REGISTER button. Once registered, the challenge appears in the type selector alongside the built-in challenges.

Custom challenges use the same scoring, Bus E delivery, and evaluation infrastructure as built-in challenges. The definition specifies how values are generated, what the correct answer is, how par is calculated, and optionally, how the spoiler and history entry are formatted.

**Definition Schema:** `{ id, name, description, generate(params), par(result, params), params[] }`

- `generate(params)` returns `{ values, expected|expectedValues, answerCount, label }`. Called once when the challenge starts.
- `par(result, params)` returns `{ ticks, ops }`. Defines the expert score target.
- `params[]` defines configurable UI controls shown in the challenge panel (number input, select, or toggle).

Before registration, the definition is run through a validator that checks field presence, ID format and uniqueness, function types, five dry runs of generate() (with a 50ms timeout each), a par check, and params shape validation. Errors are reported with the specific check that failed.

The built-in challenges — Add, Multiply, Transform Nth, Filter, Sort, Find Max, XOR Checksum, Count Matches, Accumulate, Chain Sum, and Bridge Crossing — are themselves implemented as registered definitions with the `builtin: true` flag. They appear in the list but cannot be removed or overwritten. The VIEW button on each built-in definition populates the input field with the definition's params schema, which you can use as a starting point for a custom variant.

> **ID uniqueness.** Custom challenge IDs must be unique and cannot match built-in IDs. Use lowercase letters, digits, and underscores only. If you want to build a variant of a built-in, copy its params from VIEW, change the id, and modify the generate() logic.

---

## Appendix A — Quick Reference

### Architecture

| Constant | Value |
|----------|-------|
| Bits per Word (BPW) | 17 (1 marker + 16 data) |
| Bus Width (BUS_N) | 24 |
| Inject Channel Width (INJ_N) | 17 |
| Transfer Latency | 41 ticks (BUS_N + BPW = 24 + 17) |
| Clock Range | 1–144 Hz (recommended: 24 Hz) |

### Loop Capacities

| Loop | Words | Bits | Full rotation at 24 Hz |
|------|-------|------|----------------------|
| Working | 18 | 306 | ~12.75 sec |
| ALU | 24 | 408 | ~17 sec |
| Memory | 24 (+16 slots) | 408 | ~17 sec |
| Big | 48 | 816 | ~34 sec |

### Buses

| Bus | Type | Role | Color |
|-----|------|------|-------|
| A | Unidirectional | Internal, operator-controlled | Purple |
| B | Unidirectional | Internal, operator-controlled | Magenta-violet |
| C | Unidirectional | Internal, operator-controlled | Teal |
| D | Unidirectional | Internal, operator-controlled | Amber-gold |
| E | Dual-channel | Challenge interface | Crimson |
| F | Dual-channel | P2P Left | Electric blue |
| G | Dual-channel | P2P Right | Violet |
| H | Dual-channel | Net0 (routed network) | Amber |
| I | Dual-channel | Net1 (routed network) | Lime |

### ALU Operations (17)

ADD, SUB, AND, OR, XOR, NOT, SHL, SHR, NEG, INC, DEC, MOD, ROR, ABS, NAND, NOR, XNOR

### ALU Flags

ZRO (zero), CRY (carry), OVF (overflow), SGN (sign), PAR (parity)

### Comparator Flags

GT, LT, EQ, GTE, LTE, NEQ

### Memory

16 slots, addressed by 4-bit selector (b15–b12 in Addr-Read mode)

### Working Scratch

4 registers attached to the Working loop

### Counters

5 total: Working, ALU, Memory, Big, Global

### Pattern Matchers

PM1, PM2 (cascade mode available). Attached to the Big Loop.

### Threshold Gates

TG1, TG2 (cascade mode available). Attached to the Big Loop.

### Filter Order

PM-first (default) or TG-first (swappable via toggle)

### Challenges

11 built-in: 9 local (Add, Multiply, Transform Nth, Filter, Sort, Find Max, XOR Checksum, Count Matches, Accumulate) + 1 network (Chain Sum) + 1 Operators Club (★ Bridge Crossing)

### Skins

OG, Winamp, Sunrise

---

## Appendix B — Keyboard Guide

Loop 2.1 has a full keyboard control system. You don't have to use it — everything still works with the mouse — but once the bindings are in your fingers, operating the machine feels fundamentally different. Your eyes can stay on the loops.

The system is designed to be learned incrementally. Start with the three keys you'll use constantly:

- **Space** — Start / Stop the clock
- **E** — Send (inject current value)
- **R** — Send ALU answer to loop

Those three alone are worth learning. Add bus chords when you're ready. Add the rest whenever it feels natural.

> **Input Fields.** Keyboard bindings are automatically suppressed when any text field has focus — speed input, TG threshold, chat, notes, anything. You won't accidentally start the clock while typing a value. Press Escape at any time to leave a focused field and return keyboard control to the machine.

### The Keyboard Layout

Most bound keys live on the left side of the keyboard so your right hand can stay on the mouse. The four loop keys — S D F G — match the left-hand home row, spatially ordered to mirror the Working, ALU, Memory, and Big loops as they appear on screen.

Number keys 1–4 control internal buses (chord entry or double-tap toggle). Keys 5–9 toggle networking buses (double-tap only, no chord entry).

### Clock and Stepping

| Key | Action |
|-----|--------|
| Space | Start / Stop the clock |
| . | Step one tick (global — all running loops advance one position) |
| [ | Decrease clock speed one step |
| ] | Increase clock speed one step |

Speed steps: 1 · 2 · 3 · 4 · 6 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128 · 144 Hz. Each press of [ or ] moves one step along this ladder. The recommended operating speed for most work is 24 Hz.

> **Step Mode.** With the clock stopped, . lets you step through computation bit by bit. This is the best way to trace an unexpected value or verify that a bus is routing correctly.

### Loop Controls

The four loop keys are spatially mapped to the left-hand home row. Working is under your pinky, then ALU, Memory, Big moving toward the index finger. Shift adds gate control to the same positions.

| Key | Action | Loop |
|-----|--------|------|
| S | Pause / Resume | Working |
| D | Pause / Resume | ALU |
| F | Pause / Resume | Memory |
| G | Pause / Resume | Big |
| Shift+S | Toggle gate open / closed | Working |
| Shift+D | Toggle gate open / closed | ALU |
| Shift+F | Toggle gate open / closed | Memory |
| Shift+G | Toggle gate open / closed | Big |

> **Pause vs Gate.** Pausing a loop stops its bits from moving but leaves the gate open — values can still enter or exit. Closing the gate blocks the loop's eject point entirely so nothing leaves regardless of bus state. They're different operations and together give you fine-grained control over when values move.

### ALU Actions

| Key | Action |
|-----|--------|
| R | Send ALU answer to loop |
| Shift+R | Send comparator result to loop |
| V | Cycle ALU operation forward |
| Shift+V | Cycle ALU operation backward |
| C | Cycle capture route forward (OFF → A → B → C → D → OFF…) |
| Shift+C | Cycle capture route backward |

Operation cycle order: ADD → SUB → AND → OR → XOR → NOT → SHL → SHR → NEG → INC → DEC → MOD → ROR → ABS → NAND → NOR → XNOR — and back to ADD.

### Inject and Input

| Key | Action |
|-----|--------|
| E | Send — inject the current switch value into the Working loop |
| Shift+E | Random inject — a random value within the configured min/max range |
| Q | Clear all input switches (set to zero) |

Set your value with the bit switches, then press E to inject. Q clears the switches so you start fresh for the next value. For random-number work, configure the min/max in the RNG panel, then use Shift+E to fire values without touching the switches at all.

### Memory

| Key | Action |
|-----|--------|
| X | Toggle Write to Slots on / off |
| Shift+X | Toggle Auto-Increment on / off |
| Z | Send current slot to loop |
| Shift+Z | Batch Write All — stream all 16 slots into the Memory loop |

Z sends whichever slot address is currently selected. Shift+Z runs the full batch sequence regardless of the current address. Use X with Shift+X together to set up an auto-incrementing capture pass: enable Write to Slots, enable Auto-Inc, then start the clock and let words accumulate into consecutive slots.

### Bus Controls — Toggle

Two ways to toggle any internal bus (A–D) on or off:

- **Double-tap:** press the bus key twice rapidly (1 1, 2 2, etc.). The threshold is 300ms — it's generous, not a trick shot.
- **Shift+number:** Shift+1 through Shift+4. No timing required, always reliable.

Both methods produce identical behavior. Use whichever you prefer.

| Double-tap | Shift+key | Bus |
|-----------|-----------|-----|
| 1 1 | Shift+1 | Bus A |
| 2 2 | Shift+2 | Bus B |
| 3 3 | Shift+3 | Bus C |
| 4 4 | Shift+4 | Bus D |

### Bus Chord System

The chord system lets you configure a bus's source and destination with three keystrokes. The grammar is fixed:

`[bus key]  [source key]  [destination key]`

Press 1, 2, 3, or 4 to start a chord for that bus. The machine enters chord mode — a status display appears at the bottom of the screen showing your progress. Then type the source component, then the destination. The bus updates instantly on the third keystroke.

Examples:

- `1 W A` → Bus A: Working → ALU
- `2 A M` → Bus B: ALU → Memory
- `3 M B` → Bus C: Memory → Big
- `4 B W` → Bus D: Big → Working — four-loop pipeline in 12 keystrokes

**Component Keys (inside a chord):**

| Key | Component | Source | Dest |
|-----|-----------|--------|------|
| W | Working loop | ✓ | ✓ |
| A | ALU loop | ✓ | ✓ |
| M | Memory loop | ✓ | ✓ |
| B | Big loop | ✓ | ✓ |
| P | Pattern Matcher 1 output | ✓ | — |
| T | Threshold Gate 1 output | ✓ | — |
| K | Global Counter | ✓ | ✓ |
| F | File Save | — | ✓ |

Sources produce data; destinations receive it. PM1 and TG1 outputs are source-only — you can route from them but not to them. File Save is destination-only. If you attempt an invalid combination, the chord cancels cleanly and the status display shows why.

> **PM2 and TG2.** The chord keys P and T map to PM1 and TG1 respectively. If you need to route from PM2 or TG2, use the sidebar bus configuration panels with the mouse.

Press Escape at any point during a chord to cancel it. A chord that receives no input times out and cancels automatically after 2 seconds. While a chord is active, all flat-layer keys are suppressed — pressing Space mid-chord won't accidentally stop the clock.

### Networking Buses

Buses E through I are the networking buses. Their source/destination and peer configuration is click-only — there's no chord grammar for them. But toggling them on and off during active networked computation is covered by the keyboard.

| Double-tap | Shift+key | Bus |
|-----------|-----------|-----|
| 5 5 | Shift+5 | Bus E (External) |
| 6 6 | Shift+6 | Bus F (P2P Left) |
| 7 7 | Shift+7 | Bus G (P2P Right) |
| 8 8 | Shift+8 | Bus H (Net0) |
| 9 9 | Shift+9 | Bus I (Net1) |

Pressing 5 once does not enter chord mode — it starts the double-tap timer. If no second press arrives within 300ms, the press is discarded with no action.

### Chat

| Key | Action | When |
|-----|--------|------|
| T | Open chat — focus the chat input | No input focused |
| Enter | Send message and exit chat | Chat open via T |
| Escape | Cancel — discard text, return to machine | Chat input focused |

Enter both sends and exits when you entered chat via T. One key to send, no second key to return to machine control. The round-trip is: T → type → Enter → back operating.

If you clicked into the chat input with the mouse instead, Enter sends but leaves focus in the chat field. Use Escape to leave.

> **T in Chord Context.** T normally opens chat. But if a bus chord is active (you've pressed 1–4 and are waiting for a source key), T acts as the Threshold Gate 1 source target instead. The chord state takes priority.

### Challenges

| Key | Action | Condition |
|-----|--------|-----------|
| N | Start new challenge | No challenge currently active |
| Shift+N | Abort challenge | Challenge is active |
| H | Toggle Show Values | Challenge active or complete |
| Enter | RELEASE — inject staged value | No input focused; RELEASE button is lit |

Enter for RELEASE is context-sensitive. If the chat input or any other field is focused, Enter goes to that field as normal. It only triggers RELEASE when you're at the machine (nothing focused) and the RELEASE button is active and lit.

> **Chain Sum Keyboard Workflow.** A complete chain sum by keyboard: Space to start → wait for RELEASE to activate → Enter to release → operate the machine → T to message teammates → Enter to send and return to operating. No mouse required once the initial setup is done.

### Quick Reference Tables

**Flat Layer**

| Key | Action | Category |
|-----|--------|----------|
| Space | Start / Stop clock | Clock |
| . | Step one tick | Clock |
| [ | Decrease clock speed | Clock |
| ] | Increase clock speed | Clock |
| S | Pause / Resume Working | Loop |
| D | Pause / Resume ALU | Loop |
| F | Pause / Resume Memory | Loop |
| G | Pause / Resume Big | Loop |
| R | Send ALU answer to loop | ALU |
| V | Cycle ALU op forward | ALU |
| C | Cycle capture route forward | ALU |
| E | Send (inject current value) | Inject |
| Q | Clear input switches | Inject |
| X | Toggle Write to Slots | Memory |
| Z | Send current slot to loop | Memory |
| T | Open chat input | Chat |
| N | Start new challenge | Challenge |
| H | Toggle Show Values | Challenge |
| Enter | Challenge RELEASE (when lit) | Challenge |

**Shift Layer**

| Binding | Action | Category |
|---------|--------|----------|
| Shift+S | Toggle Working gate | Loop |
| Shift+D | Toggle ALU gate | Loop |
| Shift+F | Toggle Memory gate | Loop |
| Shift+G | Toggle Big gate | Loop |
| Shift+R | Send comparator to loop | ALU |
| Shift+V | Cycle ALU op backward | ALU |
| Shift+C | Cycle capture route backward | ALU |
| Shift+E | Random inject | Inject |
| Shift+X | Toggle Auto-Increment | Memory |
| Shift+Z | Batch Write All | Memory |
| Shift+1–4 | Toggle Bus A–D | Bus |
| Shift+5–9 | Toggle Bus E–I | Net Bus |
| Shift+N | Abort challenge | Challenge |

**Always Available**

| Key | Action |
|-----|--------|
| Escape | Cancel active chord · Blur any focused input field |

---

## Appendix C — Operator's Techniques

*30 named techniques for the manual flow computer — Volume I: Single Machine*

This is a recipe book. Each entry is a named technique — a reusable move with a clear purpose, a defined set of components, and step-by-step instructions for executing it on the machine. Techniques are the vocabulary of Loop 2.1. Knowing them by name lets you think in terms of composition rather than individual button presses.

Every recipe follows the same structure: a one-line description, the components it uses, setup requirements, steps, par estimate, and a note covering alternatives or gotchas. Par estimates assume 24 Hz and competent but not superhuman execution. They're targets, not guarantees.

Architecture constants: BPW = 17 bits per word (1 marker + 16 data). BUS_N = 24 bits. Loop capacities: Working 18 words, ALU 24 words, Memory 24 words, Big 48 words. Recommended clock: 24 Hz.

---

### I — Injection & Loading

**01 · Clean Single Inject** — Load one value into the Working loop without collision artifacts.

Components: Inject channel. Par: 17 ticks · 1 op.

1. Set the inject value. Type decimal directly — no binary conversion needed.
2. Press INJECT. The 17-bit word enters the inject channel (INJ_N = 17 slots) and shifts into the Working loop's write head over 17 ticks.
3. Wait for the INJECT LED in the control bar to go dark before injecting again.

The inject channel is exactly BPW = 17 bits long. If you inject a second value before the first clears, the second word's marker bit collides with the first word's trailing data bits. The result is a corrupted value in the loop with no error message. The LED is your only guard.

**02 · Sequential Multi-Inject** — Load N values into the Working loop in sequence with correct spacing.

Components: Inject channel. Par: 17n + gap ticks · n ops.

1. Check that the Working loop has room for all N values. Working holds 18 words max.
2. Set first value, press INJECT, wait for INJECT LED to go dark.
3. Repeat for each subsequent value. The natural gap from LED-wait provides sufficient spacing between words.

At 24 Hz, 17 ticks takes about 0.7 seconds. With practice, experienced operators can inject at one-per-second cadence without collision.

**03 · Zero-Pulse Construction** — Build a specific value bit by bit using timed zero injections and loop pause.

Components: Inject · Gate · Loop pause. Par: ~17 × (1-bits) ticks. Difficulty: Advanced · precise timing.

The inject channel fires a marker bit followed by 16 data bits. By injecting a zero-value word and pausing the Working loop at the exact moment a specific data-bit position exits the inject channel, you allow only that one bit position to land in the loop. Repeat for each 1-bit in your target value.

1. Identify the bit positions you need to set.
2. Set inject value to 0. Press INJECT.
3. Count ticks as the word shifts in. At the exact tick for the bit you want to set, PAUSE the Working loop.
4. The channel finishes draining. Resume the loop. That bit position now holds a 1.
5. Repeat for each remaining 1-bit.

Almost never used in practice — injecting the value directly is vastly faster. Exists as a technique demonstration proving you understand how the inject channel works at the bit level.

**04 · RNG Flood** — Fill a loop with random values for testing or challenge setup.

Components: Inject channel · RNG button. Par: 17n ticks · n ops.

1. Press the RNG button to load a random 16-bit value into the inject field.
2. Press INJECT. Wait for the LED.
3. Repeat until the loop is filled to the desired density.

The RNG is an LFSR — deterministic from its seed, not truly random. The output distribution is even across the 0–65535 range over a full period.

---

### II — Bus Routing

**05 · Single Value Transfer** — Move one value from one loop to another via a bus.

Components: Any Bus A–D · Gate. Par: 24 + circ ticks · 3 ops.

1. Set the bus Source to the source loop, Destination to the target loop.
2. Turn the bus on.
3. Watch the source loop canvas. When your value reaches the gate position (G dot), press OPEN GATE.
4. The word traverses the bus (BUS_N = 24 ticks) and enters the destination loop's write head. Turn the bus off when done.

A word takes exactly 24 ticks to traverse the bus from gate to write head regardless of clock rate.

**06 · Non-Destructive Read** — Copy a value to another loop while keeping it in the source.

Components: Bus · Gate · Destructive off. Par: 24 + circ ticks · 3 ops.

1. Confirm the Destructive toggle on the source loop's gate is OFF (this is the default).
2. Execute a Single Value Transfer (recipe 05). The source loop retains its value.

With Destructive ON, the gate physically removes the word from the loop. Use destructive mode when you want to move a value (not copy it), or when you're deliberately consuming data from a loop one word at a time.

**07 · Stream Routing** — Route multiple values in sequence from one loop to another.

Components: Bus A–D · Gate. Par: 41n ticks · n ops.

1. Configure and enable the bus (source → destination).
2. For each value: watch the source loop, open the gate as each word approaches the G dot.
3. After the last word, turn the bus off.

Check that the destination loop has capacity before starting. The Big loop (48 words) is the natural staging area when you need to hold a large dataset before processing.

**08 · Loop Echo** — Route a loop back into itself to refresh values at the write head position.

Components: Bus (same src & dst). Par: N/A — continuous.

Set a bus source and destination to the same loop. Values that exit via the gate travel across the bus and re-enter at the write head. The primary use case is monitoring Bus E outbound while preserving values in Working: set Bus A source = Working, dest = Working (echo), then also configure Bus E outbound from Working. Values exit the gate, go to Bus E for challenge evaluation, and simultaneously echo back into Working.

**09 · Cross-Loop Hold** — Park a value in a second loop while working in the first, then retrieve it.

Components: Two buses · Two loops. Par: 48 ticks round-trip · 6 ops. Alternative: Working Scratch (recipe 17).

1. Route value from source loop to a second loop via Bus A (one gate open).
2. The value circulates in the second loop while you work in the first.
3. When needed: configure Bus B (source = second loop, dest = first loop), open gate to retrieve.

Working Scratch registers are usually a faster and simpler alternative for temporary value storage during ALU operations. Use cross-loop hold when you need to park a full dataset or when you're working with loops that don't connect to Working Scratch.

---

### III — ALU Operations

**10 · Two-Register Computation** — Load two values into ALU registers and compute a result.

Components: ALU · Bus A · Gate. Par: ~120 ticks · 6 ops.

1. Set Bus A: source = Working, dest = ALU. Enable bus.
2. Set capture route to A. Open gate — first value crosses to ALU loop, passes R head, loads into Reg A.
3. Set capture route to B. Open gate — second value crosses, loads into Reg B.
4. Result is computed instantly. Press SEND TO LOOP to write the result into the ALU loop for further use.

The ALU is combinational — it recomputes its result the instant any register changes. There is no execute button.

**11 · Running Accumulator** — Accumulate a running total across a stream of values.

Components: ALU · Bus · Auto-Writeback. Par: 77n + 5 ticks · 3n + 4 ops.

1. Set ALU op to ADD. Load 0 into Reg A (or let the first captured value become the initial total automatically).
2. Enable AUTO-SEND: ON. The result writes back to the ALU loop whenever it changes.
3. Set capture route to A. As each successive value passes the ALU R head, it loads into Reg A.
4. The cleanest approach: set Reg A = Op A source, Reg B = running total source. Each new value goes to A; the current total is in B.

16-bit addition wraps at 65535. Check the C (carry) flag on each addition if overflow is a concern.

**12 · Auto-Writeback Counter** — Build a self-incrementing counter that runs at the clock rate.

Components: ALU · Auto-Writeback. Par: N/A — runs continuously.

1. Inject a starting value into the ALU loop (or use 0).
2. Set capture route to A. The value loads into Reg A as it passes the R head.
3. Set ALU op to INC.
4. Enable AUTO-SEND: ON. The result writes back, recaptures, increments again. The loop now counts upward at every R-head pass.

Change the op to DEC for a countdown. Change to SHL for a doubling sequence: 1, 2, 4, 8, 16… Change to ADD with a constant in Reg B for counting by any interval. The auto-writeback counter is one of the most expressive single-setup configurations on the machine.

**13 · Running Maximum** — Track the largest value in a stream using the comparator.

Components: ALU · Bus · Comparator. Par: 82n + 41 ticks · 3n + 4 ops.

1. Route values to ALU loop. Capture first value into Reg B (current maximum candidate). Set op to SUB. Set Reg A as the source for each incoming value.
2. Capture next value into Reg A. Check the GT flag on the comparator: if A > B, the new value is larger — copy A to B.
3. If GT is not lit, B remains the maximum. Capture next value into A and repeat.
4. After all values: Reg B holds the maximum. Send to loop or route out.

The comparator continuously computes all six flags (GT, LT, EQ, GTE, LTE, NEQ) against current Reg A and Reg B values.

**14 · Conditional Swap** — Replace the current maximum/minimum only when a new value beats it.

Components: ALU · Comparator flags. Par: ~60 ticks · 2 ops per value. Builds on: Running Maximum (recipe 13).

1. Hold the current champion in Reg B. Load candidate into Reg A.
2. Read the relevant flag (GT for max, LT for min, EQ for duplicate detection).
3. If flag condition met: copy A → B. If not: do nothing, B stays.

Use LT to track the minimum. Use EQ to detect duplicates. Use NEQ to route only novel values. Combining flags with register swaps produces surprisingly expressive conditional logic.

**15 · Absolute Difference** — Compute |A − B| without signed arithmetic.

Components: ALU · Comparator. Par: ~80 ticks · 5 ops.

1. Load both values into Reg A and Reg B. Set op to SUB.
2. Check the S (Sign) flag. If S is not lit: result is the absolute difference.
3. If S is lit: send the result to the loop and re-capture into Reg A, then set op to NEG. The result is now the positive absolute difference.

Loop 2.1 values are unsigned (0–65535). Subtraction that would go negative wraps via two's complement. The S flag catches this.

**16 · Binary Multiplication** — Multiply two values using repeated addition.

Components: ALU · loop · Working Scratch. Par: 36(m−1) + 82 ticks · 3m + 5 ops (m = min(a, b)).

1. Identify which operand is smaller — use it as the repeat count.
2. Load the larger value into Reg A and Reg B. Set op to ADD.
3. Send result to loop, recapture into Reg A. Repeat m−1 times total.
4. After m−1 sends, Reg A holds the product. Send to loop for use.

If your multiplier is a power of 2, use SHL instead of repeated addition. SHL doubles the value in one operation. Multiply by 8: SHL three times.

**17 · Scratch Register Hold** — Park up to four values in Working Scratch during an ALU operation.

Components: Working Scratch · Working loop. Par: 0 ticks overhead · 2 ops per slot. Capacity: 4 slots.

1. Press CAPTURE: ON in the Working Scratch panel. The next word at the Working R head is captured into slot 0. Capture auto-advances.
2. The word remains circulating in Working — capture is non-destructive.
3. To retrieve: press →W next to the slot.

Faster and fewer setup steps than cross-loop hold. Its limitation: values in scratch are copies — if the Working loop value changes, scratch doesn't update automatically.

---

### IV — Memory

**18 · Sequential Store** — Store a stream of values into consecutive memory slots using auto-increment.

Components: Memory · Bus · Auto-Inc. Par: 41n + 24 ticks · n+2 ops.

1. Set the starting address. Enable TURN AUTO-INC ON. Enable ENABLE WRITE TO SLOTS.
2. Route values from your source loop to the Memory loop via a bus. Each word that passes the Memory R head is written to the current address and the address advances.
3. Disable Write to Slots when done.

Auto-increment wraps at 16. After filling slot 15, it wraps back to slot 0.

**19 · Address-Keyed Store** — Use the top 4 bits of each arriving word to determine its destination slot.

Components: Memory · Addr-Read mode. Par: 41n ticks · n+2 ops. Prerequisite: Values pre-encoded with address.

1. Enable ADDR-READ: ON and ENABLE WRITE TO SLOTS.
2. Route pre-encoded values into the Memory loop. Each arriving word's top 4 bits (b15–b12) are decoded as a 4-bit address.

To encode: the word is (S << 12) | (V & 0x0FFF). This sacrifices the top 4 bits — maximum stored value is 4095.

**20 · Destructive Recall** — Read a memory slot, use its value, and automatically clear the slot.

Components: Memory · SEND TO LOOP. Par: 17 ticks · 2 ops.

1. Enable TURN DESTRUCT ON.
2. Press SEND TO LOOP next to the target slot. The value enters the writeback pipeline and the slot is cleared when the pipeline completes.

Useful when consuming values from memory — building a sorted output stream, or guaranteed-once semantics.

**21 · Batch Recall** — Stream all 16 memory slots into the Memory loop in slot order.

Components: Memory · Batch Write All. Par: 272 ticks · 1 op. Output: Always 16 words.

Press BATCH WRITE ALL. All 16 slots stream in order. Empty slots write a zero word to preserve position information. The stream is 16 × 17 = 272 bits. At 24 Hz, approximately 11 seconds.

Empty slots produce marker=1, data=0 words rather than being skipped. Null and zero are indistinguishable after a batch recall cycle. This is an accepted tradeoff.

**22 · Memory Snapshot Save & Load** — Persist the full 16-slot memory state to a .L21 file and restore it later.

Components: Files panel · Bus · FILE SAVE dst. Par (save): 272 ticks · 2 ops. Par (load): 272 ticks · 3 ops.

Save: Press NEW FILE → enter name → SAVE. Set any bus destination to File Save. Press BATCH WRITE ALL. All 16 words stream to the file system.

Load: Enable Write to Slots + Auto-Inc (starting at slot 0). Ensure Memory loop is running. Select the file → LOAD. The 16 words stream through the writeback pipeline into consecutive slots.

.L21 files are stored in browser localStorage. Use EXPORT .l21x to archive to a real computer file. The .l21x format is plain text and can be opened and edited in any text editor.

---

### V — Pattern Matcher

**23 · Exact Value Eject** — Eject a specific value from the Big Loop when it passes PM1.

Components: PM1 · Big Loop · Bus A. Par: circ + 1 ticks · 3 ops.

1. Set PM1 mask to 1111111111111111 (all 16 bits). Set PM1 match to the exact value you want.
2. Enable PM1. Enable EJECT: DESTRUCTIVE to remove the value, or EJECT: COPY to keep it circulating.
3. Set Bus A source to PM (PM1 bridge). The ejected value exits onto Bus A.

With COPY mode, the value continues circulating and will re-trigger on the next pass — disable PM1 after ejecting if you only want one copy.

**24 · Bit-Field Filter** — Route only values matching a bit pattern.

Components: PM1 · Big Loop · Bus source = PM. Par: 41n + 18m ticks · n+m ops (m = match count).

Common configurations: Odd values (b0=1): Mask = 0x0001, Match = 0x0001. Even values (b0=0): Mask = 0x0001, Match = 0x0000. Top bit set (≥32768): Mask = 0x8000, Match = 0x8000. Divisible by 4: Mask = 0x0003, Match = 0x0000.

1. Route your stream into the Big Loop.
2. Configure PM1 mask and match. Enable PM1 with EJECT: DESTRUCTIVE.
3. Set Bus A source to PM. Non-matching values continue circulating.

The mask controls which bits are checked. The match controls what those bits must equal. Only bits where mask=1 are compared.

**25 · Rewrite in Place** — Modify specific bits of matching values without ejecting them from the loop.

Components: PM1 rewrite mode · Big Loop. Par: n × circ ticks · 2 ops. Eject mode: COPY.

1. Configure PM1 mask and match for your condition.
2. Set the Change Mask to indicate which bits to rewrite (1 = change, 0 = leave).
3. Set the Change Value to what those bits should become.
4. Enable PM1 with EJECT: COPY. Matching words have their selected bits rewritten in place — no ejection, no routing needed.

Example — clear the top bit of all values ≥ 32768: Mask = 0x8000, Match = 0x8000, Change Mask = 0x8000, Change Value = 0x0000. One full loop revolution processes all values.

**26 · PM Cascade — Two-Stage Filter** — Use PM1 and PM2 in sequence to split a stream into three groups.

Components: PM1 + PM2 · Big Loop · Two buses. Groups: PM1 match · PM2 match · Neither.

PM1 is at bit index 359 on the Big Loop; PM2 is 17 bits downstream at index 342. Words pass PM1 first, then PM2.

1. Configure PM1 to match Group A. Enable with EJECT: DESTRUCTIVE. Set Bus A source = PM. Group A ejects here.
2. Configure PM2 to match Group B. Enable with EJECT: DESTRUCTIVE. Set Bus B source = PM2. Group B ejects here.
3. Values matching neither condition continue circulating — Group C stays in the Big Loop.

PM2 has separate bridge outputs for matched and rejected values — up to four potential output streams from a two-PM cascade.

**27 · Match Count** — Count how many values in a stream satisfy a bit condition.

Components: PM1 match counter · Big Loop · Bus. Par: 41n + 544 + 41 ticks · n+8 ops. (544t = counter eject latency.)

1. Configure PM1 for your condition. Enable PM1 and the PM1 MATCH COUNTER.
2. Route your stream through the Big Loop. Let all values pass PM1.
3. After all values have circulated: press the PM1 counter eject button. The count value enters the Big Loop as a word.
4. Route the count word to your destination.

The counter ejects into the Big Loop, and the ejected count word takes approximately 544 bits to reach the R head. At 24 Hz that's about 22 seconds.

---

### VI — Threshold Gate & Counters

**28 · Minimum Extraction** — Extract the smallest value in a loop using the Threshold Gate in ≤ mode.

Components: TG1 · Big Loop · Bus. Par: ~circ × n ticks per pass. Use case: Sort Values challenge core op.

1. Set TG1 threshold to a value larger than the expected minimum. Set TG1 mode to ≤. Enable TG1 with EJECT: DESTRUCTIVE.
2. Let the Big Loop circulate one full revolution. The first value ≤ threshold ejects.
3. To find the true minimum: start with a high threshold, extract the first matching value, lower the threshold, repeat. Extracted values come out in ascending order.

This is the foundational operation for sorting via the Threshold Gate. Each iteration extracts the current minimum. For n values, run n extractions.

**29 · Range Gate** — Pass only values within a specific range using two Threshold Gates in series.

Components: TG1 + TG2 · Big Loop. Passes through: lo ≤ value ≤ hi.

1. Set TG1 threshold = lower bound. TG1 mode < (less than). Enable TG1 EJECT: DESTRUCTIVE. Values below lo eject here.
2. Set TG2 threshold = upper bound. TG2 mode > (greater than). Enable TG2 EJECT: DESTRUCTIVE. Values above hi eject here.
3. Values that pass both gates (≥ lo and ≤ hi) continue circulating.

Bus destinations include TG1·Thresh and TG2·Thresh. Route a value from Working or ALU loop to a TG threshold destination to set it dynamically during operation.

**30 · Counter as Data** — Eject a loop counter's value into the loop as a usable word.

Components: Counter · Bus Ctr·W/A/M/B dst. Par: 17 ticks · 2 ops. Use case: Count-based routing decisions.

1. Configure a counter trigger on the desired loop (Word Written, Bit Written, or Full Cycle). Let it accumulate.
2. To read the counter value: press the counter eject button. The current count enters the loop as a 17-bit word via a 17-tick writeback pipeline.
3. Alternatively: set a bus destination to Ctr·W, Ctr·A, etc. Route a value from any loop into the counter destination — this loads the counter with that value.

The loop counters track up to 999,999 events before rolling over. The Op Count can be linked to Op Count Halt — when the count reaches its target, the machine stops automatically. This enables timed sessions and repeatable benchmarks.

---

*Loop 2.1 · Operator's Manual*
*loop2.computer · "The Operator Is the Program"*
*Designed by Shea Gunther · Code & writing by Claude AI*
