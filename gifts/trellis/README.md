# The Trellis

**A 2-D consistency checker that tells you *which* cell is wrong, not just
*that* something is.** Python standard library only, no dependencies,
deterministic, MIT licensed.

> Lay your objects on a grid where every cell sits in two crossing constraints —
> its row and its column. The whole holds only if every row reads valid **and**
> every column reads valid. When something doesn't fit, the Trellis localizes the
> failure to the single cell where the failing row crosses the failing column.

## The idea in one paragraph

Most consistency checks give you a yes/no: the thing holds, or it doesn't. When
it doesn't, you go hunting. The Trellis is built on an old puzzle — the double
word square, where every letter has to be valid reading across *and* reading
down at the same time — and generalizes it off letters onto any objects. You give
it a grid: rows are one classification, columns are another, and each cell
asserts that the row-item and the column-item agree at their shared coordinate.
Then constraint propagation sorts every open cell into a verdict — **FORCED**
(only one value survives), **FREE** (several still fit), **CONTRADICTORY** (none
fit). If there's an inconsistency, it doesn't just fail — it hands you the exact
crossing where the failing row meets the failing column. There is no global
placer and no global oracle: validity is global-from-local, so the localization
falls out of the structure for free.

## Install

Copy `trellis.py`. That's it. Python 3.8+, standard library only.

## Use

A spec is a JSON file: a set of rows, a set of columns, any fixed cells, and a
constraint on each row and each column.

```
python3 trellis.py solve spec.json          # solve/check a square
python3 trellis.py solve spec.json --json    # emit the raw result JSON
python3 trellis.py solve spec.json --log      # append to a proof chain
python3 trellis.py audit spec.json            # Test-by-Removal on every constraint
python3 trellis.py verify-chain --log LOG      # re-walk a proof chain; loud + located on a break
```

Solving the literal word-square seed (STAR / PAGE / OPEN / TEST across, SPOT /
TAPE / AGES / RENT down, with only the top row fixed):

```
$ python3 trellis.py solve word-square.json
Trellis: word-square-star  [HELD]
  cells: FORCED=11 FREE=1 CONTRADICTORY=0 CONSISTENT=4
  FREE   r1|c2 -> {C, G, V}
```

`FORCED` cells have exactly one value the crossing constraints allow; the one
`FREE` cell still has three letters that would each keep both its row-word and
its column-word valid. Nothing is contradictory, so the square holds — and the
single open choice is named, not hidden.

When a square *can't* hold, the failure is located, not just reported: the cell
where the unsatisfiable row crosses the unsatisfiable column is marked
`CONTRADICTORY`, so you fix the joint instead of re-reading the whole grid.

## What it is good for

Anywhere two orthogonal classifications of the same objects have to agree at
their crossings: a schema where every field has both a type and a source that
must be compatible; a schedule where every slot has both a room and a resource;
a config where every setting has both an environment and a tier. Model the two
classifications as rows and columns, and a contradiction localizes to one cell.

## The edge (the honest limit)

The Trellis tells you a square is **consistent** — every constraint is
satisfiable and the crossings agree. It does **not** tell you the square is
**the one you meant**. If you hand it the wrong constraints, it will faithfully
find them consistent with each other. Choosing constraints that capture what you
actually care about is your job; the Trellis checks that what you wrote hangs
together, not that what you wrote is right.

## License

MIT. Copy it, ship it, change it. See `LICENSE`.
