#!/usr/bin/env python3
"""smoke_test.py -- doppelganger's shipped smoke check. Runs the in-module
--selftest battery (15 checks) and exits non-zero on any failure, so a stranger
can prove the gift works in their tree with one command:

    python3 smoke_test.py
"""
import subprocess
import sys
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    r = subprocess.run([sys.executable, os.path.join(HERE, "doppelganger.py"), "--selftest"])
    sys.exit(r.returncode)


if __name__ == "__main__":
    main()
