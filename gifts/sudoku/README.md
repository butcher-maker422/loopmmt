# sudoku — a solver that shows its work

Most Sudoku solvers hand you the answer. This one hands you the **reasoning**.
It solves the way a person does — applying the *lowest* technique that makes
progress and recording, at every step, what it did and **why** — so the answer
is just the last line of an argument you can read and check by hand.

```
$ python3 sudoku.py --demo
...
  1. naked single: 5 is the only candidate left for r5c5 — every other digit
     is already used by one of its peers.
  2. naked single: 2 is the only candidate left for r5c2 — ...
 ...
 34. locked candidates: in box 4, 3 can only go in row 5, so 3 is eliminated
     from the rest of row 5.
 ...
solution:
5 3 4 | 6 7 8 | 9 1 2
...
```

## What makes it different

- **It certifies.** Every step carries a human sentence saying why the move is
  *forced*. The trace is a proof — replay it and you reproduce the solution.
- **It never guesses.** It only makes forced moves. Faced with a puzzle that
  needs a technique it doesn't have, it stops and says **ceiling-hit** rather
  than searching or backtracking. "I can't get further with these techniques"
  is an honest answer, and a useful one — it tells you the puzzle's difficulty.
- **It's deterministic.** The same givens always produce the byte-identical
  trace. No randomness, no I/O, no globals.

## The five techniques (applied lowest-first)

1. **naked single** — a cell with only one candidate left
2. **hidden single** — a digit that fits only one cell in a row, column, or box
3. **locked candidates** — pointing / claiming (an elimination technique)
4. **naked pair** — two cells that lock two digits to themselves
5. **x-wing** — the basic fish

The ladder is *data* (the `LADDER` list) — reorder it to change the difficulty
model, or append new techniques (wings, chains); the solve loop never changes.

## Three honest answers

- **`solved-unique`** — solved by these techniques alone; `solution` is filled in.
- **`ceiling-hit`** — consistent, but needs a technique above the ladder. This
  is a *difficulty read*, not a failure: the puzzle is "harder than x-wing."
- **`broken`** — a cell ran out of candidates; the givens contradict.

One honest edge worth knowing: `broken` fires when *reasoning* empties a cell.
A contradiction sitting between two givens that no technique ever touches reads
as `ceiling-hit`, not `broken` — the solver reasons about the puzzle, it doesn't
front-validate your input. (If you want a givens-validator, that's a different,
smaller tool.)

## Use it

Python 3, standard library only, no install.

```bash
python3 sudoku.py --demo                  # solve the classic puzzle, show every step
python3 sudoku.py "53..7....6..195...."   # ...81 chars; '.' or '0' = empty
```

As a library:

```python
from sudoku import solve, from_string, to_string

result = solve(from_string("53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79"))
result.status                 # 'solved-unique'
for step in result.trace:
    print(step.reason)        # the human explanation, step by step
to_string(result.solution)    # the filled grid as an 81-char string
result.to_dict()              # the whole thing as plain dicts (JSON-ready)
```

## Test it

```bash
python3 test_sudoku.py    # 130 checks: certifying (replay the trace),
                          # deterministic (pinned golden trace hash),
                          # three terminal states, never-guesses, + a mutation bite
```

## Where it came from

The reasoning core of a self-explaining Sudoku teaching app, stripped to stand
alone. In the original, this one trace fed everything the player saw — the
grade, the hint, the "teach me this technique" walkthrough — because every one
of those is a fold over the same recorded argument. That's the idea worth
taking: *make the solver explain itself once, and everything downstream is a
view of the explanation.*

MIT licensed. Take the folder.
