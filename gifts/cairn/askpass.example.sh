#!/bin/sh
# askpass.example.sh — a host-aware git credential helper. COPY to askpass.sh
# and edit the host arms + field names for your stores.
#
# WHY THIS EXISTS
#   Private stores need a token. The unsafe habits are (a) baking the token into
#   the remote URL (it lands in .git/config and every `git remote -v`), and
#   (b) exporting it as an environment variable (it leaks into child processes
#   and is gone across separate shells, so the NEXT push silently fails auth).
#   This helper avoids both: git calls it at push/fetch time, it reads the token
#   from a GITIGNORED file at CALL TIME, and writes it ONLY to git's stdin.
#
# SAFE TO COMMIT — once you've replaced the placeholders with your HOSTS and
# FIELD NAMES (which are not secret). The SECRET never appears here: it lives in
# a separate file you never commit. This example is verifiably credential-free.
#
# WIRE IT (before any push/fetch):
#   cp askpass.example.sh askpass.sh   # then edit the host arms below
#   git config core.askpass "$PWD/askpass.sh"
#   git config credential.username x-access-token   # if your host wants a user
#
# THE CRED FILE
#   Put your tokens in a file your .gitignore excludes, e.g. `cairn.cred`
#   (add `cairn.cred` and `*.cred` to .gitignore). One token per line, keyed:
#       HOST_A_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxx
#       HOST_B_TOKEN=yyyyyyyyyyyyyyyyyyyyyyyy
#   Point the helper at it:  export CAIRN_CRED=/abs/path/to/cairn.cred
#
# Git passes the prompt string as $1, e.g. "Password for 'https://host-b.example':"
# and, for username prompts, a string beginning "Username". Route by host so ONE
# helper can serve MANY stores, each with its OWN scoped token (one leak reaches
# one store — the independence the class model buys). Each token is written only
# to git's stdin, never to disk, a log, or a URL.

CRED="${CAIRN_CRED:-./cairn.cred}"

# read a keyed value from the cred file, keeping only the value (no spaces/CR)
_field() {
  grep -m1 -E "^[[:space:]]*$1[[:space:]]*=" "$CRED" 2>/dev/null \
    | sed -E 's/^[^=]*=[[:space:]]*//' | tr -d '[:space:]'
}

case "$1" in
  *host-b.example*)
    # Example: a public host that wants username=account, password=token.
    case "$1" in
      Username*) printf '%s\n' "your-host-b-account" ;;   # public, not a secret
      *)         printf '%s\n' "$(_field HOST_B_TOKEN)" ;;
    esac
    ;;
  *box.example*)
    # Example: a self-hosted git server (git-over-HTTPS).
    case "$1" in
      Username*) printf '%s\n' "your-selfhost-account" ;; # public, not a secret
      *)         printf '%s\n' "$(_field SELFHOST_TOKEN)" ;;
    esac
    ;;
  *)
    # Default / your primary host. Adjust the field name to your store.
    printf '%s\n' "$(_field HOST_A_TOKEN)"
    ;;
esac
