#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""smoke_test.py -- manifest-emit's shipped smoke check. Runs the in-module
--selftest battery and exits non-zero on any failure, so a stranger can prove
the gift works in their tree with one command:

    python3 smoke_test.py
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    r = subprocess.run([sys.executable,
                        os.path.join(HERE, "manifest_emit.py"), "--selftest"])
    sys.exit(r.returncode)


if __name__ == "__main__":
    main()
