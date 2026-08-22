#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""smoke_test for ward — proves the coerce weld and the three witness kinds.

Run: python3 smoke_test.py   (exit 0 = all pass)

The point of these tests is the WELD: there must be no path from a missing,
failing, malformed, or absent witness to a SOLID cell. If any such path existed,
the badge could lie, and the whole tool would be pointless.
"""
import os
import tempfile
import sys

import ward

_PASS = 0
_FAIL = 0


def check(name, got, want):
    global _PASS, _FAIL
    if got == want:
        _PASS += 1
        print(f"ok  {name}")
    else:
        _FAIL += 1
        print(f"XX  {name}: got {got!r}, want {want!r}")


def main():
    with tempfile.TemporaryDirectory() as d:
        with open(os.path.join(d, "here.txt"), "w") as f:
            f.write("alpha beta gamma")

        # file: witness
        r = ward.resolve([{"label": "f", "witness": "file:here.txt"}], d)
        check("file present -> solid", r[0]["state"], ward.SOLID)
        r = ward.resolve([{"label": "f", "witness": "file:gone.txt"}], d)
        check("file missing -> ring", r[0]["state"], ward.RING)

        # contains: witness
        r = ward.resolve([{"label": "c", "witness": "contains:here.txt::beta"}], d)
        check("contains hit -> solid", r[0]["state"], ward.SOLID)
        r = ward.resolve([{"label": "c", "witness": "contains:here.txt::omega"}], d)
        check("contains miss -> ring", r[0]["state"], ward.RING)
        r = ward.resolve([{"label": "c", "witness": "contains:here.txt"}], d)
        check("contains malformed -> ring", r[0]["state"], ward.RING)

        # cmd: witness
        r = ward.resolve([{"label": "x", "witness": "cmd:true"}], d)
        check("cmd pass -> solid", r[0]["state"], ward.SOLID)
        r = ward.resolve([{"label": "x", "witness": "cmd:false"}], d)
        check("cmd fail -> ring", r[0]["state"], ward.RING)

        # the weld: unknown + absent witness -> ring, never solid
        r = ward.resolve([{"label": "u", "witness": "mystery:here.txt"}], d)
        check("unknown kind -> ring", r[0]["state"], ward.RING)
        r = ward.resolve([{"label": "n", "witness": ""}], d)
        check("no witness -> ring", r[0]["state"], ward.RING)

        # exit-code contract: any ring -> main returns 1
        import json
        spec = os.path.join(d, "spec.json")
        with open(spec, "w") as f:
            json.dump([{"label": "ok", "witness": "file:here.txt"},
                       {"label": "bad", "witness": "file:gone.txt"}], f)
        rc = ward.main([spec, "--root", d, "--format", "json"])
        check("one ring -> exit 1", rc, 1)

        with open(spec, "w") as f:
            json.dump([{"label": "ok", "witness": "file:here.txt"}], f)
        rc = ward.main([spec, "--root", d, "--format", "json"])
        check("all solid -> exit 0", rc, 0)

    print(f"\n{_PASS}/{_PASS + _FAIL} green")
    return 0 if _FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
