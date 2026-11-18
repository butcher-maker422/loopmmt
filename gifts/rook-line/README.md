# rook-line

**Which cells does a straight line pass through, if it can only step the way a rook moves?** Give it two cells on a
square grid. It gives back every cell from the first to the second that the straight line between their centres runs
through, in order, each sharing a whole side with the one before. Never a corner step: two cells that touch only at a
corner don't let water through, so a ditch drawn on the diagonal with corner steps is a row of puddles. rook-line's
ditch runs.

```
python3 rook-line.py 0 0 2 2                       # [[0,0],[0,1],[1,1],[2,1],[2,2]]
echo '{"from":[0,0],"to":[3,1]}' | python3 rook-line.py -
python3 rook-line.py --selftest
```

Draw it backwards and you get the same cells, reversed. Where the line passes exactly through a cell corner, either
cell beside it would do; those corners are dealt in turn, first to the cell that sorts first by (row, column), then to
the other, so a long diagonal hugs both sides of the ideal line instead of leaning one way. Whole numbers only: a line
a trillion cells long is as exact as a short one.

It is The Plat's line tool rasterizer (a channel, a road, a wall), and it is checked against a second method it did not
write: an exact-geometry oracle that never walks a line, only asks of each cell whether the line passes through it.

**What it does not do.** rook-line gives the cells of one straight line between two cell centres, stepping only along rows and columns; it does not draw curves, thick lines or anti-aliasing, and it does not join several lines into a path.

MIT License. Python 3 standard library only. No network, no randomness, no clock.
