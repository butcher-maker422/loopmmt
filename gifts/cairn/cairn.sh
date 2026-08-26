#!/usr/bin/env bash
# cairn.sh — a self-healing, multi-store git fabric in one script.
#
# Keep the same repo on several INDEPENDENT git stores so the loss of any one
# store (a host outage, a deleted account, a revoked token, a dead disk) never
# costs you the repo. Three moves:
#
#   clone       Priority-ordered FAILOVER clone: try store 1, then 2, then 3;
#               the first reachable+authed store wins. LOUD STOP only when ALL
#               are dead. (This is the cold-boot path — how a fresh machine gets
#               the repo when you don't know which store is up.)
#
#   push        Redundant fan-out push to every enabled store, in parallel, with
#               a bounded per-store timeout. The write succeeds iff at least
#               THRESHOLD distinct INDEPENDENCE CLASSES confirm it — never a raw
#               store count. Two stores that share a class (two repos on the same
#               provider) count ONCE, because losing that provider loses both.
#               A store that fails is a "laggard": noted, never fatal, as long as
#               the class threshold is met. A laggard is behind, not wrong.
#
#   frontier    Probe every store's main head and REPORT the MAX head among ones
#               that are comparable (one is an ancestor of the other — a laggard
#               just catches up). READ-ONLY: it records discovered heads under
#               refs/cairn/heads/ and reports the frontier SHA — it moves nothing
#               (no main, no HEAD, no laggard heal). To adopt, run yourself:
#               git fetch && git merge --ff-only <frontier>. If two heads are
#               INCOMPARABLE — a real fork,
#               neither an ancestor of the other — that is a DIVERGENCE: it is
#               recorded under refs/cairn/divergence/<utc>/ and surfaced LOUD, and
#               is NEVER auto-merged. Divergence is a human decision.
#
# The whole point is expressed in the config, not the code: see `stores`
# (`stores.example` to start). Each store is tagged with a failure CLASS; the
# durability threshold is a number of DISTINCT CLASSES. Edit the config, never
# this script.
#
# Credentials never live here. Private stores authenticate through git's askpass
# (see `askpass.example.sh`): a helper that reads a token from a GITIGNORED file
# at call time and writes it ONLY to git's stdin — never to disk, a log, an
# argument, or a stored remote URL. This script contains no secret and needs to
# know none.
#
#   git-only + POSIX-ish bash. No dependencies. MIT licensed.
#
# Usage:
#   cairn.sh clone <dest>          # failover clone into <dest>
#   cairn.sh push [ref]            # fan-out push (ref default: HEAD)
#   cairn.sh frontier             # REPORT max comparable head (read-only); loud on divergence
#   cairn.sh doctor                # validate the stores config
#
# Config resolution:  $CAIRN_STORES (default: ./stores)
# Knobs (env):        CAIRN_TIMEOUT (per-store seconds, default 10)
#
# Exit codes:  0 ok · 1 loud failure (below threshold / all stores dead) ·
#              2 frontier divergence · 3 config problem
set -euo pipefail

CAIRN_STORES="${CAIRN_STORES:-stores}"
CAIRN_TIMEOUT="${CAIRN_TIMEOUT:-10}"

CEILING="note: the Cairn survives the LOSS of a store (host, account, token, disk) \
— it does NOT survive corruption YOU push yourself; a bad commit fans out to every \
mirror. It heals AVAILABILITY, not correctness. Incomparable heads are surfaced as a \
divergence, never auto-merged."

die() { echo "cairn: $*" >&2; exit 3; }

# --- config parsing (git-only; no jq) ---------------------------------------
# A store line is 5 pipe-separated fields:  name | class | priority | url | enabled
# The threshold is one line:  threshold = <N>   (default 2 if absent)
# Blank lines and lines beginning with '#' are ignored.

_threshold() {
  awk -F= '
    /^[[:space:]]*#/ {next}
    tolower($1) ~ /threshold/ { v=$2; gsub(/[^0-9]/,"",v); if (v!="") { print v; exit } }
  ' "$1"
}

# Emit enabled stores as "name|class|priority|url", priority-ascending.
_enabled_stores() {
  awk -F'|' '
    /^[[:space:]]*#/ {next}
    NF < 5 {next}
    {
      for (i=1;i<=5;i++){ gsub(/^[ \t]+|[ \t]+$/,"",$i) }
      if ($5=="true") print $3"|"$1"|"$2"|"$4
    }
  ' "$1" | sort -t'|' -k1,1n | awk -F'|' '{print $2"|"$3"|"$1"|"$4}'
}

_require_config() { [ -f "$CAIRN_STORES" ] || die "no stores config at '$CAIRN_STORES' (set CAIRN_STORES, or copy stores.example -> stores)"; }

# --- doctor: validate the config --------------------------------------------
cmd_doctor() {
  _require_config
  local stores thr classes ncanon problems=0
  stores="$(_enabled_stores "$CAIRN_STORES")"
  [ -n "$stores" ] || die "no enabled stores in '$CAIRN_STORES'"
  thr="$(_threshold "$CAIRN_STORES")"; thr="${thr:-2}"
  # distinct enabled classes
  classes="$(printf '%s\n' "$stores" | awk -F'|' '{print $2}' | sort -u | wc -l)"
  echo "cairn doctor: $(printf '%s\n' "$stores" | grep -c .) enabled store(s), $classes distinct class(es), threshold=$thr"
  if [ "$classes" -lt "$thr" ]; then
    echo "  WARN: only $classes distinct class(es) enabled but threshold is $thr — a push cannot meet durability until you enable more independent classes." >&2
    problems=1
  fi
  # duplicate priorities
  if printf '%s\n' "$stores" | awk -F'|' '{print $3}' | sort | uniq -d | grep -q .; then
    echo "  WARN: duplicate priorities — failover order is ambiguous." >&2
    problems=1
  fi
  [ "$problems" -eq 0 ] && echo "  ok."
  echo "$CEILING"
  # GIFT-005: doctor is a validation gate, not a pretty-printer. A below-threshold
  # or duplicate-priority config makes the durability contract impossible/ambiguous
  # -> loud failure (exit 1, per the documented convention above), never exit 0.
  [ "$problems" -eq 0 ] && return 0
  return 1
}

# --- clone: priority-ordered failover ---------------------------------------
cmd_clone() {
  local dest="${1:-}"
  [ -n "$dest" ] || die "usage: cairn.sh clone <dest>"
  _require_config
  local n=0 name class prio url
  while IFS='|' read -r name class prio url; do
    [ -n "$name" ] || continue
    n=$((n+1))
    echo "cairn: trying $name ($class) ..." >&2
    if timeout "$CAIRN_TIMEOUT" git clone --quiet "$url" "$dest" 2>/dev/null; then
      echo "cairn: cloned from $name ($class)." >&2
      echo "$CEILING" >&2
      return 0
    fi
    echo "cairn: $name unreachable/auth-fail — failing over." >&2
  done <<EOF
$(_enabled_stores "$CAIRN_STORES")
EOF
  [ "$n" -gt 0 ] || die "no enabled stores in '$CAIRN_STORES'"
  echo "cairn: LOUD STOP — every store is unreachable. Nothing to clone from." >&2
  exit 1
}

# --- push: distinct-class fan-out -------------------------------------------
cmd_push() {
  local ref="${1:-HEAD}"
  _require_config
  local thr work stores name class prio url
  thr="$(_threshold "$CAIRN_STORES")"; thr="${thr:-2}"
  stores="$(_enabled_stores "$CAIRN_STORES")"
  [ -n "$stores" ] || die "no enabled stores in '$CAIRN_STORES'"
  work="$(mktemp -d)"

  # fan out, parallel, each store writes its own result file
  while IFS='|' read -r name class prio url; do
    [ -n "$name" ] || continue
    (
      if timeout "$CAIRN_TIMEOUT" git push --quiet "$url" "${ref}:refs/heads/main" >/dev/null 2>&1; then
        echo "OK|$class"
      else
        echo "FAIL|$class"
      fi
    ) >"$work/$name" &
  done <<EOF
$stores
EOF
  wait

  # aggregate by DISTINCT class
  local confirmed="" ok="" fail="" line st nc
  while IFS='|' read -r name class prio url; do
    [ -n "$name" ] || continue
    line="$(cat "$work/$name")"; st="${line%%|*}"
    if [ "$st" = "OK" ]; then
      ok="$ok $name($class)"
      case " $confirmed " in *" $class "*) : ;; *) confirmed="$confirmed $class" ;; esac
    else
      fail="$fail $name($class)"
    fi
  done <<EOF
$stores
EOF
  nc="$(echo $confirmed | wc -w)"

  echo "cairn push: confirmed classes=$nc (need >=$thr) |$ok | laggards:${fail:- none}"
  echo "$CEILING"
  rm -rf "$work"
  if [ "$nc" -ge "$thr" ]; then
    return 0
  fi
  echo "cairn push LOUD-FAIL: only $nc distinct class(es) [$confirmed ] confirmed, threshold is $thr — durability NOT met for this push." >&2
  return 1
}

# --- frontier: REPORT max comparable head (read-only), loud on divergence ----
cmd_frontier() {
  _require_config
  git rev-parse --git-dir >/dev/null 2>&1 || die "frontier must run inside a git repo (it fetches store heads into refs/cairn/heads/)"
  local stores name class prio url sha names="" a b
  declare -A HEAD
  stores="$(_enabled_stores "$CAIRN_STORES")"
  [ -n "$stores" ] || die "no enabled stores in '$CAIRN_STORES'"

  while IFS='|' read -r name class prio url; do
    [ -n "$name" ] || continue
    sha="$(timeout "$CAIRN_TIMEOUT" git ls-remote "$url" refs/heads/main 2>/dev/null | awk '{print $1}' | head -1)"
    if [ -z "$sha" ]; then
      echo "cairn: $name ($class) — no main head or unreachable (skip)." >&2
      continue
    fi
    # fetch the objects so ancestry is decidable locally; a store that advertises
    # a head it cannot actually serve is corrupt-at-that-head — fail past it.
    if timeout "$CAIRN_TIMEOUT" git fetch --quiet "$url" refs/heads/main 2>/dev/null \
        && git cat-file -e "$sha" 2>/dev/null; then
      git update-ref "refs/cairn/heads/$name" "$sha"
      HEAD[$name]="$sha"
      names="$names $name"
    else
      echo "cairn: $name ($class) advertises $sha but cannot serve it — failing past (fixity)." >&2
    fi
  done <<EOF
$stores
EOF

  [ -n "$names" ] || die "frontier: no servable store heads found."

  # find a store whose head is a descendant-or-equal of every other head
  local best="" dominates
  for a in $names; do
    dominates=1
    for b in $names; do
      [ "$a" = "$b" ] && continue
      if ! git merge-base --is-ancestor "${HEAD[$b]}" "${HEAD[$a]}" 2>/dev/null; then
        dominates=0; break
      fi
    done
    if [ "$dominates" -eq 1 ]; then best="$a"; break; fi
  done

  if [ -n "$best" ]; then
    echo "cairn frontier: frontier=${HEAD[$best]} (from $best). READ-ONLY report — nothing was moved. To adopt: git fetch && git merge --ff-only ${HEAD[$best]}"
    echo "$CEILING"
    return 0
  fi

  # no dominator => incomparable heads => divergence. Record, never merge.
  local ts; ts="$(date -u +%Y%m%dT%H%M%SZ)"
  for a in $names; do
    git update-ref "refs/cairn/divergence/$ts/$a" "${HEAD[$a]}"
  done
  echo "cairn frontier LOUD: incomparable store heads — this is a FORK, not a lag." >&2
  echo "cairn frontier: divergence recorded at refs/cairn/divergence/$ts/* — NOT auto-merged; resolve by hand." >&2
  echo "$CEILING" >&2
  return 2
}

# --- dispatch ---------------------------------------------------------------
main() {
  local cmd="${1:-}"; shift || true
  case "$cmd" in
    clone)      cmd_clone "$@" ;;
    push)       cmd_push "$@" ;;
    frontier)   cmd_frontier "$@" ;;
    reconverge) die "reconverge was renamed to 'frontier': it reports the max comparable head but never moved main or touched other stores (the old name overpromised). Use 'cairn frontier'." ;;
    doctor)     cmd_doctor "$@" ;;
    ""|-h|--help|help)
      sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
      ;;
    *) die "unknown command '$cmd' (try: clone | push | frontier | doctor)" ;;
  esac
}

main "$@"
