#!/usr/bin/env bash
# smoke_test.sh — the foreign-fixture ACCEPTANCE GATE for The Excavation gift
# (DP-039 s7 beat 5). Hermetic, no network: it proves the gift runs on a
# NON-loopmmt site with ZERO loopmmt.com dependencies present.
#
# The test copies ONLY the shipped gift files (excavate.py, excavate_standalone.py)
# and the fixture site into a bare temp tree — deliberately WITHOUT
# build_corpus_manifest.py / build_machine_digest.py / redact.py / disclosure_gate.py
# — so an import of any loopmmt builder would fail. If the gift produces coherent
# faces anyway, the standalone extraction is proven.
#
# Six scenarios:
#   1  driver runs on a bare stranger tree (no loopmmt builders) and exits 0
#   2  it emits all three faces (manifest, shards, reckoning)
#   3  the manifest node set == the served .html leaves (coverage honesty)
#   4  coverage typing honors the config (core-set + rules): the core, deep and
#      optional classes are all present
#   5  --check passes (manifest == local walk)
#   6  no loopmmt-private import leaked in (grep the tree: no build_machine_digest etc.)
#
# Run:  bash smoke_test.sh    (expect: 6/6 passed)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASS=0; FAIL=0
ROOT="$(mktemp -d)"; trap 'rm -rf "$ROOT"' EXIT

ok()  { echo "ok  $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL $1: $2"; FAIL=$((FAIL+1)); }

# ── build the bare stranger tree: gift files + fixture, NO loopmmt builders ──
STRANGER="$ROOT/stranger"
mkdir -p "$STRANGER"
cp "$HERE/excavate.py"            "$STRANGER/"
cp "$HERE/excavate_standalone.py" "$STRANGER/"
cp -r "$HERE/test-fixture/." "$STRANGER/"    # brings excavate.config, core-set.txt, site/

# Sanity: confirm the tree is genuinely bare (no loopmmt builder alongside).
for banned in build_corpus_manifest.py build_machine_digest.py redact.py disclosure_gate.py; do
  if [ -e "$STRANGER/$banned" ]; then
    echo "FATAL smoke setup: $banned leaked into the stranger tree" >&2
    exit 1
  fi
done

# ── 1: runs on a bare tree, exit 0 ──────────────────────────────────────────
OUT="$( cd "$STRANGER"; python3 excavate.py 2>&1 )"; RC=$?
if [ "$RC" -eq 0 ]; then
  ok "driver runs on a bare stranger tree (no loopmmt builders) and exits 0"
else
  bad "bare-tree run" "expected exit 0, got $RC; out=[$OUT]"
fi

# ── 2: all three faces emitted ──────────────────────────────────────────────
FACES="$STRANGER/corpus-out"
if [ -f "$FACES/corpus-manifest.json" ] \
   && [ -f "$FACES/corpus-shards.json" ] \
   && [ -f "$FACES/reckoning.json" ]; then
  ok "emits all three faces (manifest, shards, reckoning)"
else
  bad "three faces" "one or more faces missing under corpus-out/"
fi

# ── 3: manifest node set == served .html leaves ─────────────────────────────
SITE="$STRANGER/site"
LEAVES="$( cd "$SITE" && find . -name '*.html' | sed 's#^\./##' | sort )"
NLEAVES="$( printf '%s\n' "$LEAVES" | grep -c . )"
NNODES="$( python3 -c '
import json,sys
d=json.load(open(sys.argv[1]))
print(d["counts"]["nodes"])
' "$FACES/corpus-manifest.json" 2>/dev/null )"
if [ "$NNODES" = "$NLEAVES" ] && [ "$NLEAVES" -eq 5 ]; then
  ok "manifest node set == served .html leaves ($NNODES nodes == $NLEAVES leaves)"
else
  bad "coverage honesty" "manifest nodes=$NNODES vs served leaves=$NLEAVES (want 5)"
fi

# ── 4: coverage typing honors the config (core / deep / optional all present) ─
TYPES="$( python3 -c '
import json,sys
d=json.load(open(sys.argv[1]))
bc=d["counts"]["by_coverage"]
print(bc.get("core",0), bc.get("deep",0), bc.get("optional",0))
' "$FACES/corpus-manifest.json" 2>/dev/null )"
read -r NCORE NDEEP NOPT <<<"$TYPES"
# fixture: index.html + about.html = core (2); docs/* = deep (2); archive/2019 = optional (1)
if [ "$NCORE" = "2" ] && [ "$NDEEP" = "2" ] && [ "$NOPT" = "1" ]; then
  ok "coverage typing honors config (core=2 deep=2 optional=1 from core-set + rules)"
else
  bad "coverage typing" "got core=$NCORE deep=$NDEEP optional=$NOPT (want 2/2/1)"
fi

# ── 5: --check passes (manifest == local walk) ──────────────────────────────
CHK="$( cd "$STRANGER"; python3 excavate.py --check 2>&1 )"; RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$CHK" | grep -q "CLEAN"; then
  ok "--check passes: manifest nodes == local walk"
else
  bad "--check" "expected exit 0 + CLEAN, got rc=$RC out=[$CHK]"
fi

# ── 6: no loopmmt-private module was needed (none present, yet it ran) ───────
# Prove the run did not depend on a loopmmt builder by confirming the standalone
# builder carries no import of them (the driver only imports them in-tree).
if ! grep -Eq 'import (build_corpus_manifest|build_machine_digest|redact|disclosure_gate)' \
        "$STRANGER/excavate_standalone.py"; then
  ok "standalone builder imports no loopmmt-private module (true independence)"
else
  bad "independence" "excavate_standalone.py imports a loopmmt-private module"
fi

echo
echo "$((PASS))/$((PASS+FAIL)) passed"
[ "$FAIL" -eq 0 ]
