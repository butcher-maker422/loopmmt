#!/usr/bin/env bash
# smoke_test.sh — hermetic proof that cairn.sh works. No network: every "store"
# is a local bare git repo standing in for a remote. Five scenarios, mirroring
# the durability claims:
#
#   1  failover clone skips a dead store and clones from the next live one
#   2  a distinct-class fan-out push succeeds when >= threshold classes confirm
#   3  two SAME-class stores count ONCE — below threshold => loud fail (exit 1)
#   4  frontier REPORTS the MAX head (read-only) when heads are comparable
#   5  frontier records INCOMPARABLE heads as divergence (exit 2), moves nothing
#
# Run:  bash smoke_test.sh    (expect: 5/5 passed)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAIRN="$HERE/cairn.sh"
PASS=0; FAIL=0
ROOT="$(mktemp -d)"; trap 'rm -rf "$ROOT"' EXIT

ok()   { echo "ok  $1"; PASS=$((PASS+1)); }
bad()  { echo "FAIL $1: $2"; FAIL=$((FAIL+1)); }

git_q() { git -c init.defaultBranch=main -c user.name=t -c user.email=t@t "$@"; }

mk_source() {           # $1 dest ; makes a repo on main with one commit
  git_q init -q "$1"
  ( cd "$1"; echo "base" > file.txt; git_q add file.txt; git_q commit -q -m base )
}
mk_bare() { git_q init -q --bare "$1"; }
seed()    { git_q -C "$1" push -q "$2" main:refs/heads/main; }   # $1 src $2 bare
head_of() { git_q -C "$1" rev-parse HEAD; }
bare_main(){ git_q --git-dir="$1" rev-parse refs/heads/main 2>/dev/null; }

# --- 1: failover clone ------------------------------------------------------
t1() {
  local d="$ROOT/t1"; mkdir -p "$d"
  mk_source "$d/src"
  mk_bare "$d/live.git"; seed "$d/src" "$d/live.git"
  cat > "$d/stores" <<EOF
threshold = 2
dead | cloud-A | 1 | $d/does-not-exist.git | true
live | cloud-B | 2 | $d/live.git           | true
EOF
  if CAIRN_STORES="$d/stores" bash "$CAIRN" clone "$d/clone" >/dev/null 2>&1 \
     && [ -f "$d/clone/file.txt" ] \
     && [ "$(cat "$d/clone/file.txt")" = "base" ]; then
    ok "failover clone skips dead store, clones from next"
  else
    bad "failover clone" "did not clone from the live store after the dead one"
  fi
}

# --- 2: distinct-class push succeeds ----------------------------------------
t2() {
  local d="$ROOT/t2"; mkdir -p "$d"
  mk_source "$d/src"
  mk_bare "$d/a.git"; mk_bare "$d/b.git"; mk_bare "$d/c.git"
  cat > "$d/stores" <<EOF
threshold = 2
a | cloud-A   | 1 | $d/a.git | true
b | cloud-B   | 2 | $d/b.git | true
c | self-host | 3 | $d/c.git | true
EOF
  local want; want="$(head_of "$d/src")"
  if ( cd "$d/src"; CAIRN_STORES="$d/stores" bash "$CAIRN" push HEAD ) >/dev/null 2>&1 \
     && [ "$(bare_main "$d/a.git")" = "$want" ] \
     && [ "$(bare_main "$d/b.git")" = "$want" ] \
     && [ "$(bare_main "$d/c.git")" = "$want" ]; then
    ok "distinct-class push confirmed 3 classes >= threshold 2"
  else
    bad "distinct-class push" "not all stores received main, or exit nonzero"
  fi
}

# --- 3: two same-class stores count once => below threshold => loud fail -----
t3() {
  local d="$ROOT/t3"; mkdir -p "$d"
  mk_source "$d/src"
  mk_bare "$d/a1.git"; mk_bare "$d/a2.git"
  cat > "$d/stores" <<EOF
threshold = 2
a1 | cloud-A | 1 | $d/a1.git | true
a2 | cloud-A | 2 | $d/a2.git | true
EOF
  # both pushes SUCCEED, but they share a class => 1 distinct class < 2 => exit 1
  ( cd "$d/src"; CAIRN_STORES="$d/stores" bash "$CAIRN" push HEAD ) >/dev/null 2>&1
  if [ "$?" -eq 1 ]; then
    ok "two same-class stores count once; below threshold is a loud fail"
  else
    bad "same-class threshold" "expected exit 1 (durability not met), got $?"
  fi
}

# --- 4: frontier REPORTS the max comparable head (read-only) ----------------
t4() {
  local d="$ROOT/t4"; mkdir -p "$d"
  mk_source "$d/src"
  mk_bare "$d/a.git"; mk_bare "$d/b.git"
  seed "$d/src" "$d/a.git"; seed "$d/src" "$d/b.git"       # both at base
  # A moves ahead by one commit; B stays behind (a laggard)
  ( cd "$d/src"; echo more >> file.txt; git_q add file.txt; git_q commit -q -m ahead )
  seed "$d/src" "$d/a.git"
  local ahead; ahead="$(head_of "$d/src")"
  git_q clone -q "$d/b.git" "$d/recon"                     # recon starts behind
  cat > "$d/stores" <<EOF
threshold = 2
a | cloud-A | 1 | $d/a.git | true
b | cloud-B | 2 | $d/b.git | true
EOF
  # frontier is DISCOVERY-ONLY: it must REPORT the ahead head, RECORD it under
  # refs/cairn/heads/, and MOVE NOTHING. Assert by inspecting refs, never by
  # accepting printed prose as proof of adoption (the false-green this fixes).
  local before; before="$( cd "$d/recon"; git rev-parse HEAD )"
  local out rc
  out="$( cd "$d/recon"; CAIRN_STORES="$d/stores" bash "$CAIRN" frontier 2>&1 )"; rc=$?
  local reported; reported="$( printf '%s' "$out" | sed -n 's/.*frontier=\([0-9a-f]\{7,\}\).*/\1/p' | head -1 )"
  local after;  after="$(  cd "$d/recon"; git rev-parse HEAD )"
  local recorded; recorded="$( cd "$d/recon"; git rev-parse refs/cairn/heads/a 2>/dev/null )"
  if [ "$rc" -eq 0 ] && [ "$reported" = "$ahead" ] && [ "$after" = "$before" ] && [ "$recorded" = "$ahead" ]; then
    ok "frontier reports the max comparable head, records it under refs/cairn/heads/, and does NOT move local HEAD (read-only)"
  else
    bad "frontier discovery" "rc=$rc reported=$reported ahead=$ahead before=$before after=$after recorded=$recorded"
  fi
}

# --- 5: frontier records incomparable heads as divergence (moves nothing) ---
t5() {
  local d="$ROOT/t5"; mkdir -p "$d"
  mk_source "$d/base"
  mk_bare "$d/a.git"; mk_bare "$d/b.git"
  # two SIBLING commits on top of the same base => incomparable heads
  git_q clone -q "$d/base" "$d/x"
  ( cd "$d/x"; echo x >> file.txt; git_q add file.txt; git_q commit -q -m fork-x )
  seed "$d/x" "$d/a.git"
  git_q clone -q "$d/base" "$d/y"
  ( cd "$d/y"; echo y >> file.txt; git_q add file.txt; git_q commit -q -m fork-y )
  seed "$d/y" "$d/b.git"
  git_q clone -q "$d/a.git" "$d/recon"                     # recon has X
  cat > "$d/stores" <<EOF
threshold = 2
a | cloud-A | 1 | $d/a.git | true
b | cloud-B | 2 | $d/b.git | true
EOF
  ( cd "$d/recon"; CAIRN_STORES="$d/stores" bash "$CAIRN" frontier ) >/dev/null 2>&1
  local rc=$?
  local divs
  divs="$(git_q -C "$d/recon" for-each-ref --format='%(refname)' 'refs/cairn/divergence/' | wc -l)"
  if [ "$rc" -eq 2 ] && [ "$divs" -ge 2 ]; then
    ok "frontier records incomparable heads as a divergence, never merges (exit 2)"
  else
    bad "frontier divergence" "expected exit 2 with recorded divergence refs; rc=$rc divs=$divs"
  fi
}

t1; t2; t3; t4; t5
echo
echo "$((PASS))/$((PASS+FAIL)) passed"
[ "$FAIL" -eq 0 ]
