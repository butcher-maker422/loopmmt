# derived

**Is a generated file stale against the command that makes it?**

> **The edge — what this does *not* do:** this checks **staleness** (the committed
> file vs a fresh build), not **correctness**. A green means the file matches what
> the command emits *right now* — never that the command, or its output, is right.
> It **runs your build command**, so only point it at a command you trust.

A *derived* file is one no human should hand-edit: a build command produces it
from some source, and the committed copy is only ever meant to be whatever the
command last emitted. The oldest bug in generated code is that the source moved,
nobody re-ran the build, and the committed file quietly fell behind. It still
exists on disk, so no "does the file exist?" check ever notices — it just serves
stale bytes until the next rebuild surprises someone.

The usual reassurance is a sentence in a comment:

> A generated file cannot drift; it can only be stale, and stale is one command.

True — and **not a guard**. The command is unenforced, so the sentence describes
the fix, not a mechanism, and the file goes stale while the sentence sits there
being correct. `derived` is the mechanism: it **runs the build fresh** and
**byte-compares** its output against the committed file.

## Non-mutating by contract

`derived` never edits your working tree. It runs the build command inside a
private temporary directory seeded with a copy of your inputs, and compares the
fresh output there against the committed file here. Your files are never touched
— there is no reading of a tree that proves an edit is worthless, and a checker
must not destroy one on a guess. (If a build insists on writing in place, pass
`--in-place` and it runs against a full copy of the tree in the sandbox.)

## The oracle is your command, on purpose

`derived` carries **no copy** of your source→derived mapping. You name the build
command and the file it should produce; it asks the only question that needs no
mapping — *run the command fresh, does its output match what's committed?* A
checker that re-declared the mapping would be a second source of truth for it,
which is the exact fault class being guarded.

## Usage

```sh
# The build command writes the derived file to a path you name:
python3 derived.py --build-cmd "python3 gen.py" --derived out/table.json \
                   --copy gen.py --copy data/

# The build command writes to stdout; capture and compare it:
python3 derived.py --build-cmd "python3 gen.py" --derived out/table.json --stdout \
                   --copy gen.py

# The build edits files in place: run it against a full tree copy:
python3 derived.py --build-cmd "make derived" --derived out/x --in-place

python3 derived.py --json      # machine-readable verdict
python3 derived.py --edge      # print the edge and exit
```

`--copy PATH` (repeatable) names each input the build needs in the sandbox;
`--in-place` copies the whole tree instead (ignore `--copy` then).

## Exit codes

| Code | Meaning |
|------|---------|
| `0`  | **CURRENT** — the committed file matches a fresh build, byte for byte |
| `3`  | **STALE** — it does not; the difference is named (add `--show-diff` to dump it) |
| `4`  | **BUILD-FAILED** — the build command exited non-zero; nothing can be concluded |
| `2`  | **USAGE** — bad arguments, or the derived file / a `--copy` input is missing |

Wire it into a pre-commit hook or CI: a `3` fails the check and tells you the one
command that fixes it.

## What it is

Zero dependencies. Python 3 standard library only. One file. MIT licensed.

Run the tests: `python3 test_derived.py` (11 checks, mutation-bitten — deleting a
behavior makes a test fail).

---

*A Loop MMT gift. One small tool that does one thing honestly.*
