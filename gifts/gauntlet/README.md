# gauntlet

**Does your check actually catch a fault?**

> **The edge — what this does *not* do:** `gauntlet` tests whether a check
> **catches the one fault you inject**, not whether the check is correct in
> general. A HELD proves the check fired on *this one* broken input — never that
> it catches every fault. It **runs your check command**, so only point it at a
> command you trust. It **only ever copies the target** — it never modifies your
> original file.

A check — a linter, a validator, a test, a verifier — is only worth what it
catches. The quiet failure is a check that passes on input it was supposed to
reject: a green that means nothing. The way you find that out is to break the
input **on purpose**, run the check, and see whether it fires. If you damage the
file and the check still says PASS, the check has a hole.

`gauntlet` automates exactly that, safely:

1. Copy the target file into a private, disposable sandbox. **The original is
   never touched.**
2. Inject **one typed fault** into the copy — truncate its tail, flip a byte, or
   apply a find/replace regression you name.
3. Run **your** check command against the mutated copy.
4. Report the verdict:
   - **HELD** — the check *failed* on the broken input (good: it caught the fault)
   - **ESCAPED** — the check *passed* on the broken input (bad: your check has a hole)

## The verdict is inverted, on purpose

A check that **fails** on broken input is doing its job — so a non-zero exit from
your check is a gauntlet **PASS (HELD)**. A check that **passes** on broken input
has a hole — so a zero exit from your check is a gauntlet **FAIL (ESCAPED)**.

## One fault per shot, sandbox only

Never buckshot: one typed fault per run, so a HELD/ESCAPED verdict names exactly
what got through. The sandbox is deleted when the run ends — abort is just
"delete the temp dir" — and your original file is read-only to this tool by
construction (it is only ever copied, never written).

## Usage

```sh
# Truncate the tail 10% and see whether your validator catches it:
python3 gauntlet.py --target data.json --fault truncate --check "python3 validate.py {}"

# Flip one byte in the middle:
python3 gauntlet.py --target data.json --fault bitflip --check "python3 validate.py {}"

# Apply a well-formed-wrong regression (still parses, just lies):
python3 gauntlet.py --target config.yaml --fault replace \
    --from "version: 3" --to "version: 2" --check "python3 validate.py {}"
```

`{}` in `--check` is replaced with the sandbox path. If your check reads stdin,
use `--stdin` and gauntlet pipes the mutated bytes to it instead.

```sh
python3 gauntlet.py --json     # machine-readable verdict
python3 gauntlet.py --edge     # print the edge and exit
```

## Exit codes

| Code | Meaning |
|------|---------|
| `0`  | **HELD** — the check caught the fault (your check *failed* on broken input) |
| `3`  | **ESCAPED** — the check missed the fault (your check *passed* on broken input) |
| `4`  | **NO-FAULT** — the chosen fault could not be injected (nothing tested) |
| `2`  | **USAGE** — bad arguments, or the target file is missing |

Wire it into CI to keep your own checks honest: an `ESCAPED` means a linter or
validator you rely on has stopped catching something it should.

## What it is

Zero dependencies. Python 3 standard library only. One file. MIT licensed.

Run the tests: `python3 test_gauntlet.py` (12 checks, mutation-bitten — deleting a
behavior makes a test fail).

---

*A Loop MMT gift. One small tool that does one thing honestly.*
