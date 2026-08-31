#!/usr/bin/env python3
"""gauntlet.py — does your check actually catch a fault?

A check (a linter, a validator, a test, a verifier) is only worth what it
catches. The quiet failure is a check that passes on input it was supposed to
reject — a green that means nothing. The way you find that out is to break the
input ON PURPOSE, run the check, and see whether it fires. If you damage the
file and the check still says PASS, the check has a hole.

gauntlet automates exactly that, safely:

  1. Copy the target file into a private, disposable sandbox. The original is
     NEVER touched.
  2. Inject ONE typed fault into the sandbox copy (truncate its tail, flip a
     byte, or apply a find/replace regression you name).
  3. Run YOUR check command against the mutated copy.
  4. Report the verdict:
       HELD    -- the check FAILED on the broken input (good: it caught the fault)
       ESCAPED -- the check PASSED on the broken input (bad: your check has a hole)

ONE FAULT PER SHOT, SANDBOX ONLY (the safety rails, kept from the tool this was
stripped from). Never buckshot: one typed fault per run, so a HELD/ESCAPED
verdict names exactly what got through. The sandbox is deleted when the run
ends -- abort is just "delete the temp dir," and the original file is read-only
to this tool by construction (it is only ever copied, never written).

THE VERDICT IS INVERTED ON PURPOSE.
A check that FAILS on broken input is doing its job -- so a non-zero exit from
your check is a gauntlet PASS (HELD). A check that PASSES on broken input has a
hole -- so a zero exit from your check is a gauntlet FAIL (ESCAPED). Read the
exit codes below with that inversion in mind.

EXITS
  0  HELD     -- the check caught the fault (your check FAILED on broken input)
  3  ESCAPED  -- the check missed the fault (your check PASSED on broken input)
  4  NO-FAULT -- the chosen fault could not be injected (e.g. --replace found no
                 match, or the file was too small to truncate); nothing tested
  2  USAGE    -- bad arguments, or the target file is missing

USAGE
  # Truncate the tail 10% and see whether your validator catches it:
  python3 gauntlet.py --target data.json --fault truncate --check "python3 validate.py {}"

  # Flip one byte in the middle:
  python3 gauntlet.py --target data.json --fault bitflip --check "python3 validate.py {}"

  # Apply a well-formed-wrong regression (the file still parses, it just lies):
  python3 gauntlet.py --target config.yaml --fault replace \\
      --from "version: 3" --to "version: 2" --check "python3 validate.py {}"

The check command runs against the mutated SANDBOX copy: `{}` in --check is
replaced with the sandbox path. If your check reads stdin instead, use
`--stdin` and gauntlet pipes the mutated bytes to it.

  python3 gauntlet.py --json     # machine-readable verdict
  python3 gauntlet.py --edge     # print the edge and exit
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile

EXIT_HELD = 0
EXIT_USAGE = 2
EXIT_ESCAPED = 3
EXIT_NO_FAULT = 4

EDGE = (
    "gauntlet tests whether a check CATCHES the ONE fault you inject, not "
    "whether the check is correct in general: a HELD proves the check fired on "
    "this one broken input, never that it catches every fault. It runs your "
    "check command, so only point it at a command you trust. It only ever "
    "copies the target -- it never modifies your original file."
)


# --- the fault catalog: each returns (mutated_bytes, note) or (None, why) -----

def _truncate(data):
    """Tail-truncate 10% (byte loss). Well-formed-wrong on top-heavy files."""
    if len(data) < 10:
        return None, "file too small to truncate meaningfully"
    cut = int(len(data) * 0.9) or (len(data) - 1)
    return data[:cut], f"tail truncated: {len(data)}B -> {cut}B"


def _bitflip(data):
    """Flip one byte in the middle. Deterministic (always the midpoint byte)."""
    if not data:
        return None, "file is empty; nothing to flip"
    i = len(data) // 2
    b = bytearray(data)
    b[i] ^= 0xFF
    return bytes(b), f"byte flipped at offset {i}: 0x{data[i]:02x} -> 0x{b[i]:02x}"


def _replace(data, frm, to):
    """A find/replace regression: the file still parses, it just lies."""
    if frm is None or to is None:
        return None, "--replace requires --from and --to"
    fb, tb = frm.encode("utf-8"), to.encode("utf-8")
    if fb not in data:
        return None, f"--from string not found in target: {frm!r}"
    return data.replace(fb, tb, 1), f"replaced {frm!r} -> {to!r} (first match)"


def inject(data, fault, frm=None, to=None):
    if fault == "truncate":
        return _truncate(data)
    if fault == "bitflip":
        return _bitflip(data)
    if fault == "replace":
        return _replace(data, frm, to)
    return None, f"unknown fault: {fault}"


def run(target, fault, check_cmd, use_stdin=False, frm=None, to=None):
    """Copy target to a sandbox, inject one fault, run the check, report verdict.

    Never touches the original target. Returns a result dict.
    """
    result = {
        "target": target, "fault": fault, "status": "held",
        "note": "", "check_exit": None, "edge": EDGE,
    }
    if not os.path.isfile(target):
        result["status"] = "usage"
        result["error"] = f"target file not found: {target}"
        return result

    with open(target, "rb") as fh:
        original = fh.read()

    mutated, note = inject(original, fault, frm, to)
    result["note"] = note
    if mutated is None:
        result["status"] = "no-fault"
        return result
    if mutated == original:
        result["status"] = "no-fault"
        result["note"] = note + " (no change to bytes)"
        return result

    sandbox = tempfile.mkdtemp(prefix="gauntlet.")
    try:
        sandbox_file = os.path.join(sandbox, os.path.basename(target))
        with open(sandbox_file, "wb") as fh:
            fh.write(mutated)

        if use_stdin:
            proc = subprocess.run(
                check_cmd, shell=True, input=mutated,
                capture_output=True, timeout=300,
            )
        else:
            cmd = check_cmd.replace("{}", sandbox_file)
            if cmd == check_cmd and "{}" not in check_cmd:
                # no placeholder given: append the path
                cmd = f"{check_cmd} {sandbox_file}"
            proc = subprocess.run(
                cmd, shell=True, capture_output=True, timeout=300,
            )

        result["check_exit"] = proc.returncode
        # INVERSION: check FAILED (non-zero) on broken input => HELD (good).
        #            check PASSED (zero)  on broken input     => ESCAPED (bad).
        result["status"] = "held" if proc.returncode != 0 else "escaped"
        return result
    finally:
        shutil.rmtree(sandbox, ignore_errors=True)


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Does your check actually catch a fault you inject?",
        epilog="EDGE: " + EDGE,
    )
    ap.add_argument("--target", help="the file to inject a fault into (copied, never modified)")
    ap.add_argument("--fault", choices=["truncate", "bitflip", "replace"],
                    help="the single typed fault to inject")
    ap.add_argument("--check", help="the check command to run; {} is replaced with the sandbox path")
    ap.add_argument("--from", dest="frm", help="(--fault replace) the string to find")
    ap.add_argument("--to", dest="to", help="(--fault replace) the string to substitute")
    ap.add_argument("--stdin", action="store_true",
                    help="pipe the mutated bytes to the check on stdin instead of a path")
    ap.add_argument("--json", action="store_true", help="machine-readable verdict")
    ap.add_argument("--edge", action="store_true", help="print the edge and exit")
    args = ap.parse_args(argv)

    if args.edge:
        print(EDGE)
        return EXIT_HELD

    if not (args.target and args.fault and args.check):
        print("USAGE ERROR — --target, --fault and --check are all required",
              file=sys.stderr)
        return EXIT_USAGE

    res = run(args.target, args.fault, args.check,
              use_stdin=args.stdin, frm=args.frm, to=args.to)
    status = res["status"]

    if args.json:
        import json
        print(json.dumps(res, indent=2, sort_keys=True))
    else:
        if status == "held":
            print(f"HELD — the check caught the {args.fault} fault "
                  f"(check exited {res['check_exit']} on broken input)")
            print(f"  fault: {res['note']}")
        elif status == "escaped":
            print(f"ESCAPED — the check MISSED the {args.fault} fault "
                  f"(check exited 0 on broken input — it has a hole)")
            print(f"  fault: {res['note']}")
        elif status == "no-fault":
            print(f"NO-FAULT — could not inject: {res['note']}")
        else:
            print(f"USAGE ERROR — {res.get('error', 'bad arguments')}", file=sys.stderr)

    return {
        "held": EXIT_HELD, "escaped": EXIT_ESCAPED,
        "no-fault": EXIT_NO_FAULT, "usage": EXIT_USAGE,
    }[status]


if __name__ == "__main__":
    sys.exit(main())
