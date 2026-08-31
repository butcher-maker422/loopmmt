#!/usr/bin/env python3
"""port — declare a composition tool's port-verb, and read it back honestly.

A composition of small JSONL tools only typechecks if each tool declares its
own PORT-VERB: the type-level shape of its stdin/stdout contract on the shared
JSON-lines interface. Five verbs, and only five:

  source     : nothing -> JSONL      (emits; no meaningful stdin)
  transform  : JSONL   -> JSONL      (record in, record out)
  filter     : JSONL   -> JSONL'     (record in, subset out — output type <= input)
  fold       : JSONL   -> JSONL_agg  (records in, an aggregate/narrower record out)
  sink       : JSONL   -> nothing    (terminal side effect, no pipeable stdout)

WHY THIS TOOL EXISTS. Before `port`, a map or a typechecker that wanted to know
a tool's port-verb had to GUESS it — from a one-line description, or from a
hand-kept list living in one program's source. A guess that a tool emits when it
actually sinks is a silent lie: the map draws an edge that cannot carry data.
`port` removes the guess. Every tool DECLARES its port-verb, in one of two honest
places, and `port` reads the declaration back:

  1. A manifest field  `port_verb`  in a JSON manifest of tool entries, OR
  2. A `--port` flag the tool answers for itself.

The load-bearing move is the CHECK (`port check`): when a tool declares its
port-verb in BOTH places, they must AGREE. A manifest that says `filter` while
the tool's own `--port` says `source` is a declaration that has drifted from the
thing it describes — and `port check` makes that drift a decidable, non-zero
exit, not a thing a human notices later. That is the whole point: a declaration
you can verify beats a description you have to trust.

port's own port-verb is `source`: it emits port declarations as JSON-lines and
takes no meaningful stdin.

No dependencies beyond the Python standard library. MIT licensed.

USAGE
  port verbs
      Print the five port-verbs and their type contracts (JSONL, one per line).

  port read   --manifest FILE [--slug SLUG]
      Read declared port_verb(s) from a manifest. With --slug, one entry;
      without, every entry that declares a port_verb. Emits JSON-lines:
      {"slug": ..., "port_verb": ..., "source": "manifest"}
      A manifest entry with no port_verb field is reported with
      port_verb=null and status="undeclared" (flagged, never guessed).

  port check  --manifest FILE --flag-cmd 'CMD {slug}'
      For every manifest entry that declares a port_verb, run the tool's own
      --port flag (via --flag-cmd, with {slug} substituted) and compare.
      Emits one JSON-line verdict per entry:
      {"slug":..., "manifest":..., "flag":..., "status":"agree|drift|missing"}
      Exit 0 iff every checked entry AGREES; exit 3 on any drift/missing.
      This is the decidable self-check — a declaration verified against itself.

  port emit   --slug SLUG --port-verb VERB
      Emit a single declaration JSON-line (for a tool that has no manifest yet).
"""
import argparse
import json
import subprocess
import sys

# The five port-verbs and their type-level contract on the shared JSONL interface.
# This dict is the ONLY definition of the vocabulary — the closed set.
PORT_VERBS = {
    "source":    "nothing -> JSONL      (emits; no meaningful stdin)",
    "transform": "JSONL   -> JSONL      (record in, record out)",
    "filter":    "JSONL   -> JSONL'     (record in, subset out; output type <= input)",
    "fold":      "JSONL   -> JSONL_agg  (records in, an aggregate/narrower record out)",
    "sink":      "JSONL   -> nothing    (terminal side effect, no pipeable stdout)",
}


def is_valid_verb(verb):
    """A port-verb is valid iff it is one of the five closed-set verbs."""
    return verb in PORT_VERBS


def load_manifest_entries(path):
    """Return the list of tool entries from a manifest.

    Accepts either a bare JSON list of entries, or a JSON object with a top-level
    key ('gifts', 'tools', or 'entries') holding the list. Raises ValueError if
    no entry list can be found — never guesses a shape.
    """
    with open(path) as f:
        data = json.load(f)
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("gifts", "tools", "entries"):
            if isinstance(data.get(key), list):
                return data[key]
    raise ValueError(
        "manifest is neither a list of entries nor an object with a "
        "'gifts'/'tools'/'entries' list"
    )


def cmd_verbs(_args):
    """Emit the five port-verbs and their contracts, one JSON-line each."""
    for verb, contract in PORT_VERBS.items():
        print(json.dumps({"port_verb": verb, "contract": contract}))
    return 0


def cmd_read(args):
    """Read declared port_verb(s) from a manifest and emit them as JSON-lines."""
    entries = load_manifest_entries(args.manifest)
    found = False
    for entry in entries:
        slug = entry.get("slug")
        if args.slug is not None and slug != args.slug:
            continue
        verb = entry.get("port_verb")
        if verb is None:
            rec = {"slug": slug, "port_verb": None,
                   "source": "manifest", "status": "undeclared"}
        elif not is_valid_verb(verb):
            rec = {"slug": slug, "port_verb": verb,
                   "source": "manifest", "status": "invalid"}
        else:
            rec = {"slug": slug, "port_verb": verb,
                   "source": "manifest", "status": "declared"}
        print(json.dumps(rec))
        found = True
    if args.slug is not None and not found:
        print(json.dumps({"slug": args.slug, "port_verb": None,
                          "source": "manifest", "status": "not-found"}))
        return 3
    return 0


def _run_flag(flag_cmd, slug):
    """Run a tool's own --port flag and return the verb it prints, or None.

    flag_cmd is a template string with '{slug}' substituted for the entry slug.
    The tool is expected to print its port-verb as the first whitespace token
    on stdout. Any failure (non-zero exit, no output, unparseable) returns None
    — an honest 'the tool did not answer', never a guessed verb.
    """
    cmd = flag_cmd.replace("{slug}", slug)
    try:
        out = subprocess.run(cmd, shell=True, capture_output=True,
                             text=True, timeout=30)
    except Exception:
        return None
    if out.returncode != 0:
        return None
    token = out.stdout.strip().split()
    if not token:
        return None
    verb = token[0]
    return verb if is_valid_verb(verb) else None


def cmd_check(args):
    """Compare each manifest port_verb against the tool's own --port flag.

    Exit 0 iff every checked entry agrees; exit 3 on any drift or missing.
    """
    entries = load_manifest_entries(args.manifest)
    all_agree = True
    checked_any = False
    for entry in entries:
        slug = entry.get("slug")
        manifest_verb = entry.get("port_verb")
        if manifest_verb is None:
            continue  # nothing declared in the manifest -> nothing to check here
        checked_any = True
        flag_verb = _run_flag(args.flag_cmd, slug)
        if flag_verb is None:
            status = "missing"
            all_agree = False
        elif flag_verb == manifest_verb:
            status = "agree"
        else:
            status = "drift"
            all_agree = False
        print(json.dumps({"slug": slug, "manifest": manifest_verb,
                          "flag": flag_verb, "status": status}))
    if not checked_any:
        # Nothing declared a port_verb: there is nothing to verify. This is not
        # a pass (there was no check) — report it and exit 3 so a manifest that
        # forgot every declaration cannot read as green.
        print(json.dumps({"status": "no-declarations",
                          "note": "no manifest entry declared a port_verb"}))
        return 3
    return 0 if all_agree else 3


def cmd_emit(args):
    """Emit a single port declaration JSON-line for a manifest-less tool."""
    if not is_valid_verb(args.port_verb):
        print(json.dumps({"slug": args.slug, "port_verb": args.port_verb,
                          "status": "invalid",
                          "valid": list(PORT_VERBS)}))
        return 3
    print(json.dumps({"slug": args.slug, "port_verb": args.port_verb,
                      "source": "declared", "status": "declared"}))
    return 0


def build_parser():
    p = argparse.ArgumentParser(
        prog="port",
        description="Declare a composition tool's port-verb, and read it back honestly.",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("verbs", help="print the five port-verbs and contracts")
    sp.set_defaults(func=cmd_verbs)

    sp = sub.add_parser("read", help="read declared port_verb(s) from a manifest")
    sp.add_argument("--manifest", required=True)
    sp.add_argument("--slug", default=None)
    sp.set_defaults(func=cmd_read)

    sp = sub.add_parser("check", help="verify manifest port_verb against each tool's --port flag")
    sp.add_argument("--manifest", required=True)
    sp.add_argument("--flag-cmd", required=True,
                    help="command template to run a tool's --port flag; {slug} is substituted")
    sp.set_defaults(func=cmd_check)

    sp = sub.add_parser("emit", help="emit a single port declaration line")
    sp.add_argument("--slug", required=True)
    sp.add_argument("--port-verb", required=True)
    sp.set_defaults(func=cmd_emit)

    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
