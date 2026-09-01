#!/usr/bin/env python3
"""loop21-component-factory — declare small logic components as composable data.

A *source* in the composition algebra (∅ → JSONL): you name the logic
primitives you want — a counter, a toggle, a clamp, an accumulator, a
pattern-matcher — give each a small config, and the factory emits one
fully-specified component **spec** per line of JSONL. Nothing is executed
here; the factory's job is to *declare* components as portable data that a
downstream transform, fold, or runner consumes.

    spec  =  {"component": "<kind>", "name": "<id>", "params": {...},
              "port": "transform"|"filter"|..., "spec_version": 1}

WHY IT'S A FACTORY, NOT A LIBRARY

A library hands you a function bound to the process that imported it. This
hands you a *description* of a component — kind, name, parameters, and the
composition port it fills — as a line of JSON. That description travels: you
can pipe it, store it, diff it, hash it, or feed it to any consumer that
knows the five built-in kinds. The factory is the front door to a small,
closed catalog of logic primitives, emitted as a stream.

WHY IT'S HONEST

- **A closed, named catalog.** Five component kinds ship: `counter`,
  `toggle`, `clamp`, `accumulator`, `pattern-match`. Each has a declared
  parameter schema and a declared composition port. Ask for a kind that
  isn't in the catalog and the factory refuses loudly (it never emits a
  spec it can't stand behind).

- **Deterministic by construction.** The emitted stream is a pure function
  of the requested specs. Auto-generated names use a seeded, reproducible
  counter, so `--seed 42` yields byte-identical JSONL on any machine,
  forever. Keys are sorted; there is no wall-clock, no RNG that isn't
  seeded, nothing that drifts between runs.

- **Validated at the door.** Every requested component is checked against
  its kind's parameter schema *before* a spec is emitted. A missing
  required parameter, an out-of-range value, or an unknown parameter is a
  reported error (to stderr, non-zero exit) — never a silently emitted
  spec that a downstream consumer will choke on.

- **The spec is the whole contract.** A consumer needs nothing from this
  tool but the JSONL. The `spec_version` field pins the shape so a consumer
  can reject a spec it doesn't understand rather than mis-read it.

THE HONEST EDGE

The factory *declares* components; it does not *run* them. An emitted spec
is a validated description, not a live object — turning a spec into behavior
is the consumer's job, and this tool makes no claim about whether any
downstream runner implements a kind correctly. It guarantees the spec is
well-formed and catalog-valid, not that anyone honors it.

USAGE
    # one component from a kind + inline params
    python3 loop21-component-factory.py --make counter:start=0,step=2

    # several at once, one JSONL line each
    python3 loop21-component-factory.py \
        --make counter:start=0 --make toggle:initial=false \
        --make clamp:lo=0,hi=100

    # read a batch request from a JSON file ([{kind,name,params}, ...])
    python3 loop21-component-factory.py --batch request.json

    # list the catalog (kinds, params, ports) as JSONL and exit
    python3 loop21-component-factory.py --catalog

    # a short, reproducible demonstration
    python3 loop21-component-factory.py --demo

MIT licensed. Python standard library only. Deterministic under --seed; headless.
"""
# SPDX-License-Identifier: MIT
from __future__ import annotations

import argparse
import json
import sys
from typing import Any

SPEC_VERSION = 1

# ---------------------------------------------------------------------------
# The catalog — a closed, named set of logic-component kinds.
#
# Each kind declares:
#   port    : the composition port the component fills (source/transform/
#             filter/fold/sink) — this is what a MAP tool reads.
#   params  : {name: schema} where schema is
#               {"type": "int"|"number"|"bool"|"string",
#                "required": bool,
#                "default": <value>,        # when not required
#                "min": <n>, "max": <n>}    # optional bounds (numeric)
#   summary : one line, human-facing.
# ---------------------------------------------------------------------------
CATALOG: dict[str, dict[str, Any]] = {
    "counter": {
        "port": "transform",
        "summary": "advances a running integer by a fixed step each item",
        "params": {
            "start": {"type": "int", "required": False, "default": 0},
            "step": {"type": "int", "required": False, "default": 1},
        },
    },
    "toggle": {
        "port": "transform",
        "summary": "flips a boolean on each item, starting from an initial state",
        "params": {
            "initial": {"type": "bool", "required": False, "default": False},
        },
    },
    "clamp": {
        "port": "transform",
        "summary": "constrains a numeric field to an inclusive [lo, hi] range",
        "params": {
            "lo": {"type": "number", "required": True},
            "hi": {"type": "number", "required": True},
        },
    },
    "accumulator": {
        "port": "fold",
        "summary": "reduces a stream to a single running total under an operation",
        "params": {
            "op": {
                "type": "string",
                "required": False,
                "default": "sum",
                "choices": ["sum", "product", "min", "max", "count"],
            },
            "seed": {"type": "number", "required": False, "default": 0},
        },
    },
    "pattern-match": {
        "port": "filter",
        "summary": "passes items whose field matches a fixed literal or set",
        "params": {
            "field": {"type": "string", "required": True},
            "equals": {"type": "string", "required": False, "default": None},
            "in": {"type": "string", "required": False, "default": None},
        },
    },
}


class FactoryError(Exception):
    """A requested component could not be produced (unknown kind or bad params)."""


# ---------------------------------------------------------------------------
# Parameter parsing + coercion
# ---------------------------------------------------------------------------
def _coerce(kind: str, pname: str, raw: Any, schema: dict[str, Any]) -> Any:
    """Coerce a raw parameter value to its declared type, or raise FactoryError."""
    t = schema["type"]
    try:
        if t == "int":
            val = int(raw)
        elif t == "number":
            val = float(raw)
            if val.is_integer():
                val = int(val)  # canonical: 3.0 -> 3, keeps JSONL stable
        elif t == "bool":
            if isinstance(raw, bool):
                val = raw
            else:
                s = str(raw).strip().lower()
                if s in ("true", "1", "yes", "on"):
                    val = True
                elif s in ("false", "0", "no", "off"):
                    val = False
                else:
                    raise ValueError(s)
        elif t == "string":
            val = str(raw)
        else:  # pragma: no cover - guarded by catalog authorship
            raise FactoryError(f"{kind}.{pname}: unknown schema type {t!r}")
    except (ValueError, TypeError):
        raise FactoryError(
            f"{kind}.{pname}: value {raw!r} is not a valid {t}"
        )

    if "choices" in schema and val not in schema["choices"]:
        raise FactoryError(
            f"{kind}.{pname}: {val!r} not in {schema['choices']}"
        )
    for bound, cmp_ok in (("min", lambda v, b: v >= b), ("max", lambda v, b: v <= b)):
        if bound in schema and not cmp_ok(val, schema[bound]):
            raise FactoryError(
                f"{kind}.{pname}: {val!r} violates {bound}={schema[bound]}"
            )
    return val


def build_spec(kind: str, name: str, params: dict[str, Any]) -> dict[str, Any]:
    """Validate a request against the catalog and return a component spec dict.

    Raises FactoryError on an unknown kind, an unknown param, a missing
    required param, or a value that fails coercion/bounds.
    """
    if kind not in CATALOG:
        raise FactoryError(
            f"unknown component kind {kind!r}; catalog: {', '.join(sorted(CATALOG))}"
        )
    entry = CATALOG[kind]
    schema = entry["params"]

    unknown = set(params) - set(schema)
    if unknown:
        raise FactoryError(
            f"{kind}: unknown param(s) {', '.join(sorted(unknown))}; "
            f"allowed: {', '.join(sorted(schema)) or '(none)'}"
        )

    resolved: dict[str, Any] = {}
    for pname, pschema in schema.items():
        if pname in params:
            resolved[pname] = _coerce(kind, pname, params[pname], pschema)
        elif pschema.get("required"):
            raise FactoryError(f"{kind}: missing required param {pname!r}")
        else:
            resolved[pname] = pschema.get("default")

    if kind == "pattern-match" and resolved.get("equals") is None and resolved.get("in") is None:
        raise FactoryError("pattern-match: exactly one of 'equals' or 'in' is required")
    if kind == "pattern-match" and resolved.get("equals") is not None and resolved.get("in") is not None:
        raise FactoryError("pattern-match: give only one of 'equals' or 'in', not both")

    return {
        "component": kind,
        "name": name,
        "params": resolved,
        "port": entry["port"],
        "spec_version": SPEC_VERSION,
    }


# ---------------------------------------------------------------------------
# Request parsing
# ---------------------------------------------------------------------------
def parse_make(expr: str) -> tuple[str, dict[str, Any]]:
    """Parse a --make expression 'kind:k=v,k2=v2' -> (kind, {params})."""
    if ":" in expr:
        kind, _, param_str = expr.partition(":")
    else:
        kind, param_str = expr, ""
    kind = kind.strip()
    params: dict[str, Any] = {}
    if param_str.strip():
        for pair in param_str.split(","):
            if "=" not in pair:
                raise FactoryError(f"bad param {pair!r} in {expr!r} (want k=v)")
            k, _, v = pair.partition("=")
            params[k.strip()] = v.strip()
    return kind, params


def _auto_name(kind: str, ordinal: int) -> str:
    """Deterministic auto-name: kind + zero-padded seeded ordinal."""
    return f"{kind}-{ordinal:04d}"


def produce(
    requests: list[dict[str, Any]],
    *,
    seed: int = 0,
) -> list[dict[str, Any]]:
    """Turn a list of {kind, name?, params} requests into validated specs.

    Auto-generated names are deterministic: they use a per-kind ordinal that
    starts from `seed` and increments in request order, so the same requests
    under the same seed yield byte-identical specs.
    """
    specs: list[dict[str, Any]] = []
    counters: dict[str, int] = {}
    for req in requests:
        kind = req["kind"]
        params = req.get("params", {})
        name = req.get("name")
        if not name:
            ordinal = counters.get(kind, seed)
            counters[kind] = ordinal + 1
            name = _auto_name(kind, ordinal)
        specs.append(build_spec(kind, name, params))
    return specs


def catalog_lines() -> list[dict[str, Any]]:
    """The catalog itself, as JSONL-emittable dicts (one per kind)."""
    out = []
    for kind in sorted(CATALOG):
        entry = CATALOG[kind]
        out.append(
            {
                "component": kind,
                "port": entry["port"],
                "summary": entry["summary"],
                "params": {
                    p: {k: v for k, v in schema.items()}
                    for p, schema in entry["params"].items()
                },
            }
        )
    return out


# ---------------------------------------------------------------------------
# Emit
# ---------------------------------------------------------------------------
def emit(objs: list[dict[str, Any]], stream=None) -> None:
    """Write objects as JSONL — one per line, keys sorted (deterministic)."""
    stream = sys.stdout if stream is None else stream
    for obj in objs:
        stream.write(json.dumps(obj, sort_keys=True, ensure_ascii=False) + "\n")


def demo(*, seed: int = 42) -> str:
    """A short reproducible demonstration — returns the JSONL block as a string."""
    reqs = [
        {"kind": "counter", "params": {"start": "0", "step": "2"}},
        {"kind": "toggle", "params": {"initial": "false"}},
        {"kind": "clamp", "params": {"lo": "0", "hi": "100"}},
        {"kind": "accumulator", "params": {"op": "sum"}},
        {"kind": "pattern-match", "params": {"field": "status", "equals": "open"}},
    ]
    specs = produce(reqs, seed=seed)
    return "\n".join(
        json.dumps(s, sort_keys=True, ensure_ascii=False) for s in specs
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="loop21-component-factory",
        description="Declare small logic components as composable JSONL specs.",
    )
    p.add_argument(
        "--make",
        action="append",
        default=[],
        metavar="KIND:k=v,...",
        help="a component to emit (repeatable)",
    )
    p.add_argument(
        "--batch",
        metavar="FILE",
        help="a JSON file: [{kind, name?, params?}, ...]",
    )
    p.add_argument("--catalog", action="store_true", help="emit the catalog as JSONL and exit")
    p.add_argument("--demo", action="store_true", help="print a short reproducible demonstration")
    p.add_argument("--seed", type=int, default=0, help="seed for deterministic auto-names")
    return p


def main(argv: list[str] | None = None) -> int:
    parser = _build_arg_parser()
    args = parser.parse_args(argv)

    if args.catalog:
        emit(catalog_lines())
        return 0

    if args.demo:
        sys.stdout.write(demo() + "\n")
        return 0

    requests: list[dict[str, Any]] = []
    try:
        if args.batch:
            with open(args.batch, encoding="utf-8") as fh:
                loaded = json.load(fh)
            if not isinstance(loaded, list):
                raise FactoryError("--batch file must be a JSON array of requests")
            for item in loaded:
                if not isinstance(item, dict) or "kind" not in item:
                    raise FactoryError("each --batch item needs a 'kind' field")
                requests.append(
                    {
                        "kind": item["kind"],
                        "name": item.get("name"),
                        "params": item.get("params", {}),
                    }
                )
        for expr in args.make:
            kind, params = parse_make(expr)
            requests.append({"kind": kind, "params": params})

        if not requests:
            parser.error("nothing to make: give --make, --batch, --catalog, or --demo")

        specs = produce(requests, seed=args.seed)
    except FactoryError as exc:
        sys.stderr.write(f"loop21-component-factory: {exc}\n")
        return 2
    except (OSError, json.JSONDecodeError) as exc:
        sys.stderr.write(f"loop21-component-factory: {exc}\n")
        return 2

    emit(specs)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
