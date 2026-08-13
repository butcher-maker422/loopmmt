#!/usr/bin/env python3
"""Tests for grain.py — the discrimination must be real, not a no-op."""
import json
import subprocess
import sys
import tempfile
import os

import grain


def test_structured_vs_idiosyncratic():
    # A hub/template: every line reuses the same target token — a generator leak.
    structured = [f"class_{i}->glossary" for i in range(60)]
    # Idiosyncratic: distinct random-ish pairs, little reuse.
    import random
    rng = random.Random(1)
    nodes = [f"n{i}" for i in range(60)]
    idio = sorted({f"{rng.choice(nodes)}->{rng.choice(nodes)}" for _ in range(60)})
    s_struct = grain.signature(structured, null_draw=grain.relation_null_draw(structured))
    s_idio = grain.signature(idio, null_draw=grain.relation_null_draw(idio))
    # The structured set must read more compressible (lower z) than the idiosyncratic.
    assert s_struct["z_score"] < s_idio["z_score"], (s_struct, s_idio)
    assert s_struct["verdict"] == "STRUCTURED", s_struct


def test_determinism():
    toks = [f"a{i}->b{i%7}" for i in range(50)]
    a = grain.signature(toks)
    b = grain.signature(toks)
    assert a == b, "signature must fold-twice-identical (seeded)"


def test_empty_is_not_structured():
    s = grain.signature([])
    assert s["verdict"] == "IDIOSYNCRATIC", s


def test_drift_detects_homogenization():
    diverse = [f"n{i}->m{i}" for i in range(60)]           # low structure
    homogd = [f"n{i}->glossary" for i in range(60)]         # high structure (hub)
    base = grain.signature(diverse, null_draw=grain.relation_null_draw(diverse))
    now = grain.signature(homogd, null_draw=grain.relation_null_draw(homogd))
    # Homogenized corpus is MORE structured => z drops.
    assert now["z_score"] < base["z_score"]


def test_cli_json_and_honest_ceiling():
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as fh:
        fh.write("\n".join(f"class_{i}->glossary" for i in range(40)))
        path = fh.name
    try:
        out = subprocess.run(
            [sys.executable, "grain.py", path, "--relation", "--json"],
            capture_output=True, text=True, cwd=os.path.dirname(__file__) or ".",
        )
        assert out.returncode == 0, out.stderr
        data = json.loads(out.stdout)
        assert "verdict" in data and "z_score" in data
    finally:
        os.unlink(path)


if __name__ == "__main__":
    n = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
            n += 1
    print(f"\n{n}/{n} passed")
