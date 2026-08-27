#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""smoke_test.py — hermetic proof that verify.py holds the line. No network, no
state outside a tmpdir (VERIFY_REPO_ROOT points the fact store at it). Each
scenario runs verify.py as a subprocess and checks the exit code AND the verdict
text — the real CLI contract, mirroring the freshness claims:

  1  a registered fact whose inputs are UNCHANGED re-checks FRESH (exit 0)      <- the headline
  2  an input that MOVED (bytes changed) makes the fact STALE (exit 3)
  3  a required input MISSING from disk makes the fact DEAD (exit 5)
  4  an unregistered id is UNREGISTERED — a cache miss, not a false FRESH (exit 4)
  5  an assumption is SURFACED as ASSUMED, never faked FRESH (exit 6)
  6  discharge runs an assumption's path and PROMOTES it to a fact -> FRESH
  7  a retired fact is DEAD (exit 5) — do not re-check a corpse
  8  --json emits a clean machine verdict on stdout, exit code matches the human path
  9  the CEILING line is emitted on stderr on EVERY run (honest limits, out loud)
  10 fold --check is fold-twice-identical (exit 0) — the registry is a pure fold

The suite exercises the verdict branches (compare / hash / kind dispatch) so a
mutation of the core logic flips a verdict and the suite catches it — that is
what gives it teeth under the gauntlet's Layer-5 mutation harness.

Run:  python3 smoke_test.py    (expect: 10/10 passed, exit 0)
Contract: exit 0 iff every scenario passes; non-zero on any fail (so the mutation
harness reads a killed mutant as non-zero).
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
VERIFY = os.path.join(HERE, "verify.py")
# Exit-code contract (mirrors verify.py; the suite asserts against these by value,
# staying hermetic — it never imports the tool it mutates under the harness).
FRESH, STALE, DEAD, UNREGISTERED, ERROR, ASSUMED = 0, 3, 5, 4, 2, 6
PASS = 0
FAIL = 0


def ok(msg):
    global PASS
    PASS += 1
    print(f"ok  {msg}")


def bad(msg, why):
    global FAIL
    FAIL += 1
    print(f"FAIL {msg}: {why}")


def run(root, *argv):
    """Run verify.py with the fact store rooted at `root`; return (rc, out, err)."""
    env = dict(os.environ, VERIFY_REPO_ROOT=root)
    p = subprocess.run([sys.executable, VERIFY, *argv],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                       text=True, env=env, cwd=root)
    return p.returncode, p.stdout, p.stderr


def write(root, name, text):
    with open(os.path.join(root, name), "w", encoding="utf-8") as f:
        f.write(text)


def t1(d):
    write(d, "in.txt", "v1")
    run(d, "register", "--fact-id", "f1", "--claim", "X->Y", "--inputs", "in.txt")
    rc, out, _ = run(d, "verify", "--fact-id", "f1")
    if rc == 0 and "FRESH" in out:
        ok("unchanged inputs re-check FRESH (exit 0)")
    else:
        bad("fresh", f"rc={rc} out=[{out.strip()}]")


def t2(d):
    write(d, "in.txt", "v1")
    run(d, "register", "--fact-id", "f2", "--claim", "c", "--inputs", "in.txt")
    write(d, "in.txt", "v2-changed")
    rc, out, _ = run(d, "verify", "--fact-id", "f2")
    if rc == 3 and "STALE" in out:
        ok("a moved input makes the fact STALE (exit 3)")
    else:
        bad("stale", f"expected rc=3 STALE, got rc={rc} out=[{out.strip()}]")


def t3(d):
    write(d, "in.txt", "v1")
    run(d, "register", "--fact-id", "f3", "--claim", "c", "--inputs", "in.txt")
    os.remove(os.path.join(d, "in.txt"))
    rc, out, _ = run(d, "verify", "--fact-id", "f3")
    if rc == 5 and "DEAD" in out:
        ok("a missing input makes the fact DEAD (exit 5)")
    else:
        bad("dead", f"expected rc=5 DEAD, got rc={rc} out=[{out.strip()}]")


def t4(d):
    rc, out, _ = run(d, "verify", "--fact-id", "ghost")
    if rc == 4 and "UNREGISTERED" in out:
        ok("an unknown id is UNREGISTERED, never a false FRESH (exit 4)")
    else:
        bad("unregistered", f"expected rc=4, got rc={rc} out=[{out.strip()}]")


def t5(d):
    run(d, "assume", "--fact-id", "a1", "--claim", "price current",
        "--path", "re-fetch source", "--expiry", "2026-12-01")
    rc, out, _ = run(d, "verify", "--fact-id", "a1")
    if rc == 6 and "ASSUMED" in out:
        ok("an assumption is SURFACED as ASSUMED, never faked FRESH (exit 6)")
    else:
        bad("assumed", f"expected rc=6 ASSUMED, got rc={rc} out=[{out.strip()}]")


def t6(d):
    run(d, "assume", "--fact-id", "a2", "--claim", "c",
        "--path", "run the derivation", "--expiry", "when src.txt changes")
    write(d, "src.txt", "derived")
    rc, _, _ = run(d, "discharge", "--fact-id", "a2", "--inputs", "src.txt")
    if rc != 0:
        bad("discharge", f"discharge rc={rc}")
        return
    rc2, out2, _ = run(d, "verify", "--fact-id", "a2")
    if rc2 == 0 and "FRESH" in out2:
        ok("discharge promotes an assumption to a FRESH fact")
    else:
        bad("discharge-promote", f"rc={rc2} out=[{out2.strip()}]")


def t7(d):
    write(d, "in.txt", "v1")
    run(d, "register", "--fact-id", "f7", "--claim", "c", "--inputs", "in.txt")
    run(d, "retire", "--fact-id", "f7", "--reason", "derivation retired")
    rc, out, _ = run(d, "verify", "--fact-id", "f7")
    if rc == 5 and "DEAD" in out:
        ok("a retired fact is DEAD, not re-checkable (exit 5)")
    else:
        bad("retire", f"expected rc=5 DEAD, got rc={rc} out=[{out.strip()}]")


def t8(d):
    write(d, "in.txt", "v1")
    run(d, "register", "--fact-id", "f8", "--claim", "c", "--inputs", "in.txt")
    rc, out, err = run(d, "verify", "--fact-id", "f8", "--json")
    try:
        rec = json.loads(out)
    except Exception as exc:
        bad("json", f"stdout not clean JSON: {exc}; out=[{out.strip()}]")
        return
    if rc == 0 and rec.get("verdict") == "fresh" and rec.get("code") == 0:
        ok("--json emits a clean machine verdict, exit code matches human path")
    else:
        bad("json-verdict", f"rc={rc} json={rec}")


def t9(d):
    rc, out, err = run(d, "list")
    if "CEILING:" in err and "|- != |=" in err:
        ok("the CEILING line is emitted on stderr on every run")
    else:
        bad("ceiling", f"no CEILING on stderr; err=[{err.strip()}]")


def t10(d):
    write(d, "in.txt", "v1")
    run(d, "register", "--fact-id", "f10", "--claim", "c", "--inputs", "in.txt")
    rc, out, _ = run(d, "fold", "--check")
    if rc == 0:
        ok("fold --check is fold-twice-identical (exit 0)")
    else:
        bad("fold", f"expected rc=0, got rc={rc} out=[{out.strip()}]")


# ── Hardening block (slot 04, gate 5): drive the paths the 10 headline cases
# leave un-exercised, so ast-level mutations of the core verdict logic flip an
# observable verdict and the suite catches them. The decision engine
# (decide / decision_verdict / premise_state), the --json path per record kind,
# the fold's latest-wins ordering, and the render/guard branches were the mutant
# survivors; each case below kills a cluster of them. verify.py is UNCHANGED —
# all teeth are added here (the 0fb3c694 content-hash pin holds). ──


def _reg(d, fid, val="v1", claim="c", name="in.txt"):
    """Register a fresh fact grounded on a written input file."""
    write(d, name, val)
    run(d, "register", "--fact-id", fid, "--claim", claim, "--inputs", name)


def _one_verdict(out):
    """The output must carry EXACTLY ONE verdict headline — a dropped `return` in a
    verdict branch prints its word then falls through and prints a SECOND word, same
    exit code. Counting verdict words catches that contradiction the exit code hides."""
    words = ("FRESH", "STALE", "DEAD", "ASSUMED", "UNREGISTERED", "CYCLE")
    return sum(out.count(w) for w in words) == 1


def t11_decide_fresh(d):
    # A decision over two FRESH fact-premises folds to FRESH (exit 0), and names
    # every premise. Kills: decision_verdict FRESH-fallthrough, the premise loop,
    # cmd_verify decided-branch FRESH print, premise_state fact dispatch.
    _reg(d, "p1", name="a.txt"); _reg(d, "p2", name="b.txt")
    rc, out, _ = run(d, "decide", "--decision-id", "d1", "--claim", "A beats B",
                     "--options", "A,B", "--chose", "A", "--premises", "p1", "p2")
    if rc != 0:
        bad("decide-record", f"decide rc={rc} out=[{out.strip()}]"); return
    rc, out, _ = run(d, "verify", "--fact-id", "d1")
    if rc == 0 and "FRESH" in out and "p1" in out and "p2" in out and _one_verdict(out):
        ok("a decision over fresh premises folds FRESH, naming every premise")
    else:
        bad("decide-fresh", f"rc={rc} out=[{out.strip()}]")


def t12_decide_stale_precedence(d):
    # One premise MOVES -> the decision folds STALE (exit 3). Kills: the STALE
    # precedence branch in decision_verdict, premise_state->fact_verdict STALE,
    # the cmd_verify STALE-class naming (the `stale = [...]` comprehension).
    _reg(d, "p1", name="a.txt"); _reg(d, "p2", val="orig", name="b.txt")
    run(d, "decide", "--decision-id", "d2", "--claim", "c", "--options", "A;B",
        "--chose", "A", "--premises", "p1", "p2")
    write(d, "b.txt", "MOVED")  # p2's ground moves
    rc, out, _ = run(d, "verify", "--fact-id", "d2")
    if rc == 3 and "STALE" in out and "p2" in out:
        ok("a moved premise makes the decision STALE, naming the moved premise")
    else:
        bad("decide-stale", f"expected rc=3 STALE naming p2, got rc={rc} out=[{out.strip()}]")


def t13_decide_dead_beats_stale(d):
    # DEAD outranks STALE: p2 moved (stale) AND p3 removed (dead) -> DEAD (exit 5).
    # Kills: the DEAD-first precedence ordering in decision_verdict (drop/reorder
    # of the `for worst in (DEAD, STALE, ASSUMED)` loop flips the verdict here).
    _reg(d, "p1", name="a.txt"); _reg(d, "p2", val="o", name="b.txt")
    _reg(d, "p3", name="c.txt")
    run(d, "decide", "--decision-id", "d3", "--claim", "c", "--options", "A,B",
        "--chose", "A", "--premises", "p1", "p2", "p3")
    write(d, "b.txt", "MOVED")                       # p2 -> STALE
    os.remove(os.path.join(d, "c.txt"))              # p3 -> DEAD
    rc, out, _ = run(d, "verify", "--fact-id", "d3")
    if rc == 5 and "DEAD" in out and "p3" in out:
        ok("DEAD outranks STALE in the decision fold (precedence order has teeth)")
    else:
        bad("decide-precedence", f"expected rc=5 DEAD, got rc={rc} out=[{out.strip()}]")


def t14_decide_assumed_premise(d):
    # A decision resting on a LIVE assumption folds ASSUMED (exit 6). Kills:
    # premise_state assumed-dispatch, the ASSUMED precedence branch, the assumed
    # class-naming in cmd_verify.
    _reg(d, "p1", name="a.txt")
    run(d, "assume", "--fact-id", "asmp", "--claim", "leaned on",
        "--path", "re-fetch", "--expiry", "2027-01-01")
    run(d, "decide", "--decision-id", "d4", "--claim", "c", "--options", "A,B",
        "--chose", "A", "--premises", "p1", "asmp")
    rc, out, _ = run(d, "verify", "--fact-id", "d4")
    if rc == 6 and "ASSUMED" in out and "asmp" in out:
        ok("a decision on a live assumption folds ASSUMED, naming the assumption")
    else:
        bad("decide-assumed", f"expected rc=6 ASSUMED, got rc={rc} out=[{out.strip()}]")


def t15_decide_dead_on_retired_premise(d):
    # A retired premise makes the decision DEAD (premise_state retired->DEAD).
    _reg(d, "p1", name="a.txt")
    run(d, "decide", "--decision-id", "d5", "--claim", "c", "--options", "A,B",
        "--chose", "A", "--premises", "p1")
    run(d, "retire", "--fact-id", "p1", "--reason", "premise retired")
    rc, out, _ = run(d, "verify", "--fact-id", "d5")
    if rc == 5 and "DEAD" in out:
        ok("a retired premise makes the decision DEAD")
    else:
        bad("decide-retired-premise", f"expected rc=5 DEAD, got rc={rc} out=[{out.strip()}]")


def t16_decide_guards(d):
    # Every cmd_decide validation guard returns ERROR (exit 2). Kills the guard
    # cascade (len<2, chose-not-in-options, no-premises, missing-premise,
    # self-premise) — each is a `drop If`/`compare` survivor otherwise.
    _reg(d, "p1", name="a.txt")
    checks = [
        (["decide", "--decision-id", "g1", "--claim", "c", "--options", "A",
          "--chose", "A", "--premises", "p1"], "one option"),
        (["decide", "--decision-id", "g2", "--claim", "c", "--options", "A,B",
          "--chose", "Z", "--premises", "p1"], "chose not in options"),
        (["decide", "--decision-id", "g3", "--claim", "c", "--options", "A,B",
          "--chose", "A"], "no premises"),
        (["decide", "--decision-id", "g4", "--claim", "c", "--options", "A,B",
          "--chose", "A", "--premises", "ghost"], "missing premise"),
        (["decide", "--decision-id", "g5", "--claim", "c", "--options", "A,B",
          "--chose", "A", "--premises", "g5"], "self premise"),
    ]
    for argv, why in checks:
        rc, _, _ = run(d, *argv)
        if rc != ERROR:
            bad("decide-guard", f"{why}: expected ERROR(2), got rc={rc}"); return
    ok("every decide guard rejects with ERROR (option/chose/premise cascade)")


def t17_decide_cycle(d):
    # A hand-edited self-referential decision certificate verifies as CYCLE
    # (exit 2). decide REFUSES to author one, so we craft the event directly on
    # the log to reach the verify-time cycle guard (premise_state `pid in seen`).
    _reg(d, "p1", name="a.txt")
    run(d, "decide", "--decision-id", "cyc", "--claim", "c", "--options", "A,B",
        "--chose", "A", "--premises", "p1")
    # append a decided event for `cyc` that lists itself as a premise (later seq wins)
    ev = {"kind": "decided", "fact_id": "cyc", "claim": "c", "options": ["A", "B"],
          "chose": "A", "premises": ["cyc"], "provenance_class": "internal",
          "date": "31.2359", "seq": 99}
    path = os.path.join(d, ".verify", "verified.jsonl")
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(ev, sort_keys=True) + "\n")
    rc, out, _ = run(d, "verify", "--fact-id", "cyc")
    if rc == ERROR and "CYCLE" in out and _one_verdict(out):
        ok("a self-referential decision certificate verifies as CYCLE (exit 2)")
    else:
        bad("decide-cycle", f"expected rc={ERROR} single-CYCLE, got rc={rc} out=[{out.strip()}]")


def t18_json_decided(d):
    # --json on a decided record emits the folded verdict + a per-premise state
    # breakdown, code matching the human path. Kills the _verify_json decided arm.
    _reg(d, "p1", name="a.txt"); _reg(d, "p2", val="o", name="b.txt")
    run(d, "decide", "--decision-id", "dj", "--claim", "c", "--options", "A,B",
        "--chose", "A", "--premises", "p1", "p2")
    write(d, "b.txt", "MOVED")
    rc, out, _ = run(d, "verify", "--fact-id", "dj", "--json")
    try:
        rec = json.loads(out)
    except Exception as exc:
        bad("json-decided", f"stdout not JSON: {exc}"); return
    prem = {p["id"]: p["state"] for p in rec.get("premises", [])}
    if (rc == 3 and rec.get("verdict") == "stale" and rec.get("code") == 3
            and prem.get("p2") == "stale" and prem.get("p1") == "fresh"):
        ok("--json on a decision emits the fold + per-premise breakdown")
    else:
        bad("json-decided", f"rc={rc} json={rec}")


def t19_json_assumed_and_dead(d):
    # --json arms for assumed and retired records (each its own _verify_json branch).
    run(d, "assume", "--fact-id", "aj", "--claim", "cl", "--path", "p", "--expiry", "e")
    rc, out, _ = run(d, "verify", "--fact-id", "aj", "--json")
    rec = json.loads(out)
    if not (rc == 6 and rec.get("verdict") == "assumed" and rec.get("claim") == "cl"):
        bad("json-assumed", f"rc={rc} json={rec}"); return
    _reg(d, "rj", name="r.txt")
    run(d, "retire", "--fact-id", "rj", "--reason", "gone")
    rc2, out2, _ = run(d, "verify", "--fact-id", "rj", "--json")
    rec2 = json.loads(out2)
    if rc2 == 5 and rec2.get("verdict") == "dead" and rec2.get("reason") == "gone":
        ok("--json arms for assumed (with claim) and retired (with reason)")
    else:
        bad("json-dead", f"rc={rc2} json={rec2}")


def t20_fold_latest_wins(d):
    # Re-registering a fact and then retiring it: the fold's latest-wins ordering
    # must make the LATEST event authoritative (register->register->retire => DEAD).
    # Kills fold ordering/dedup survivors and append_event's seq increment.
    _reg(d, "ff", val="one", name="x.txt")
    _reg(d, "ff", val="two", name="x.txt")   # second register, same id
    rc, out, _ = run(d, "verify", "--fact-id", "ff")
    if not (rc == 0 and "FRESH" in out):
        bad("fold-latest", f"after re-register expected FRESH, got rc={rc}"); return
    run(d, "retire", "--fact-id", "ff", "--reason", "done")
    rc2, out2, _ = run(d, "verify", "--fact-id", "ff")
    if rc2 == 5 and "DEAD" in out2:
        ok("fold latest-wins: register->register->retire resolves to DEAD")
    else:
        bad("fold-latest", f"after retire expected DEAD, got rc={rc2} out=[{out2.strip()}]")


def t21_list_render_kinds(d):
    # `list` renders each record KIND with its distinguishing line. Kills the
    # render_registry kind-dispatch branches (retired/assumed/decided/fact).
    _reg(d, "rf", name="a.txt")
    run(d, "assume", "--fact-id", "ra", "--claim", "cl", "--path", "p", "--expiry", "ex")
    _reg(d, "rp", name="b.txt")
    run(d, "decide", "--decision-id", "rd", "--claim", "dc", "--options", "A,B",
        "--chose", "A", "--premises", "rp")
    run(d, "retire", "--fact-id", "rf", "--reason", "gonzo")
    rc, out, _ = run(d, "list")
    need = ["RETIRED (dead)", "ASSUMED (ungrounded)", "DECIDED (premise-grounded)",
            "gonzo", "chose:", "premises:"]
    missing = [n for n in need if n not in out]
    if rc == 0 and not missing:
        ok("list renders every record kind with its distinguishing detail")
    else:
        bad("list-render", f"rc={rc} missing={missing}")


def t22_discharge_guards(d):
    # discharge's error branches: not-on-file, not-an-assumption, no-inputs.
    rc, _, _ = run(d, "discharge", "--fact-id", "nope", "--inputs", "x")
    if rc != ERROR:
        bad("discharge-missing", f"expected ERROR, got {rc}"); return
    _reg(d, "realfact", name="a.txt")
    rc2, _, _ = run(d, "discharge", "--fact-id", "realfact", "--inputs", "a.txt")
    if rc2 != ERROR:  # a fact is not an open assumption
        bad("discharge-notassumed", f"expected ERROR, got {rc2}"); return
    run(d, "assume", "--fact-id", "op", "--claim", "c", "--path", "p", "--expiry", "e")
    rc3, _, _ = run(d, "discharge", "--fact-id", "op")   # no --inputs
    if rc3 == ERROR:
        ok("discharge rejects: not-on-file, not-an-assumption, and no-inputs")
    else:
        bad("discharge-noinputs", f"expected ERROR, got {rc3}")


def t23_fold_check_json_parity(d):
    # The --json exit code equals the human path across a fact's whole lifecycle,
    # and fold --check stays green with a mixed registry. Guards _verify_json's
    # fact arm (moved/missing fields) + the code==human invariant.
    _reg(d, "lc", val="v1", name="a.txt")
    rc_h, _, _ = run(d, "verify", "--fact-id", "lc")
    rc_j, out_j, _ = run(d, "verify", "--fact-id", "lc", "--json")
    if rc_h != rc_j or json.loads(out_j).get("code") != rc_h:
        bad("json-parity", f"human={rc_h} json={rc_j}"); return
    write(d, "a.txt", "moved")
    rc_h2, _, _ = run(d, "verify", "--fact-id", "lc")
    rc_j2, out_j2, _ = run(d, "verify", "--fact-id", "lc", "--json")
    moved = json.loads(out_j2).get("moved", [])
    if rc_h2 == rc_j2 == 3 and "a.txt" in moved:
        ok("--json code tracks the human path and reports the moved input")
    else:
        bad("json-parity", f"h={rc_h2} j={rc_j2} moved={moved}")


def t24_nested_decision(d):
    # premise_state's decided-branch: a decision grounded on ANOTHER decision.
    # The inner decision folds first, its state propagates outward. Kills the
    # premise_state `kind == "decided"` recursion (L369-370).
    _reg(d, "leaf", val="o", name="a.txt")
    run(d, "decide", "--decision-id", "inner", "--claim", "c", "--options", "A,B",
        "--chose", "A", "--premises", "leaf")
    run(d, "decide", "--decision-id", "outer", "--claim", "c", "--options", "A,B",
        "--chose", "A", "--premises", "inner")
    # fresh chain -> outer FRESH
    rc, out, _ = run(d, "verify", "--fact-id", "outer")
    if not (rc == 0 and "FRESH" in out):
        bad("nested-fresh", f"expected FRESH, got rc={rc} out=[{out.strip()}]"); return
    # move the leaf -> inner STALE -> outer must fold STALE through the nesting
    write(d, "a.txt", "MOVED")
    rc2, out2, _ = run(d, "verify", "--fact-id", "outer")
    if rc2 == 3 and "STALE" in out2:
        ok("a decision grounded on a decision folds the inner state outward")
    else:
        bad("nested-stale", f"expected STALE through nesting, got rc={rc2} out=[{out2.strip()}]")


def t25_bad_jsonl_raises(d):
    # read_events must RAISE on a malformed log line (not silently skip / return
    # a partial set). Kills read_events' try/except/raise (L208-214). The tool
    # surfaces the parse failure as a non-zero exit, never a false FRESH.
    _reg(d, "ok1", name="a.txt")
    path = os.path.join(d, ".verify", "verified.jsonl")
    with open(path, "a", encoding="utf-8") as fh:
        fh.write("{ this is not valid json\n")
    rc, out, err = run(d, "verify", "--fact-id", "ok1")
    # a corrupt log is a hard error (exit 2), never a silent FRESH(0)
    if rc != 0 and "FRESH" not in out:
        ok("a malformed log line is surfaced as an error, never a false FRESH")
    else:
        bad("bad-jsonl", f"corrupt log gave rc={rc} out=[{out.strip()}]")


def t26_seq_ordering_manyevents(d):
    # append_event's per-day seq increment orders same-day events for the fold.
    # Register the same id THREE times in one run (same date) with different
    # inputs; latest-wins must resolve to the LAST write's ground. If the seq
    # increment is broken (const/drop mutant), a same-day tie could resolve to
    # the wrong event and flip the verdict. Distinguishes the seq logic behaviorally.
    write(d, "one.txt", "1"); run(d, "register", "--fact-id", "s", "--claim", "c", "--inputs", "one.txt")
    write(d, "two.txt", "2"); run(d, "register", "--fact-id", "s", "--claim", "c", "--inputs", "two.txt")
    write(d, "three.txt", "3"); run(d, "register", "--fact-id", "s", "--claim", "c", "--inputs", "three.txt")
    # the live ground is three.txt; moving it must make s STALE, moving the others must NOT
    write(d, "one.txt", "X"); write(d, "two.txt", "X")
    rc, out, _ = run(d, "verify", "--fact-id", "s")
    if not (rc == 0 and "FRESH" in out):
        bad("seq-latest", f"latest event should be FRESH (moved only stale inputs), got rc={rc}"); return
    write(d, "three.txt", "MOVED")
    rc2, out2, _ = run(d, "verify", "--fact-id", "s")
    if rc2 == 3 and "STALE" in out2:
        ok("same-day seq ordering resolves latest-wins to the last write")
    else:
        bad("seq-latest", f"moving the latest input should be STALE, got rc={rc2} out=[{out2.strip()}]")


def _raw_append(d, ev):
    # Craft an event directly onto the log, bypassing the CLI's seq-ordered
    # writer, so file-order and (date,seq)-order can be made to DISAGREE. This
    # is the only way to distinguish latest_for's sort from a file-order read
    # (the CLI always writes in seq-order, so t26 cannot — see gate-5 triage).
    path = os.path.join(d, ".verify", "verified.jsonl")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(ev, sort_keys=True) + "\n")


def t27_latest_for_sort_kills_fileorder(d):
    # GATE-5 real gap: latest_for sorts recs by (date, seq) then takes [-1].
    # Drop the .sort() and recs[-1] returns the file-order-last event instead of
    # the true latest. Craft a log where the TRUE latest (higher seq) is written
    # FIRST and an OLDER event (lower seq) is written LAST, with DIFFERENT kinds
    # so the verdict's EXIT CODE distinguishes them. True-latest is `retired`
    # (-> DEAD, exit 2); file-order-last is `verified` (-> would verify FRESH/STALE).
    # true latest: retired, seq 5, written FIRST. (retired -> DEAD returns before
    # any input-hash check, so the older event's inputs are irrelevant.)
    _raw_append(d, {"kind": "retired", "fact_id": "x", "claim": "c",
                    "reason": "superseded", "date": "01.0000", "seq": 5})
    # older: verified, seq 1, written LAST (file-order-last). No real inputs needed:
    # if sort is intact this record is never reached; if sort is dropped, recs[-1]
    # picks THIS (wrong) record and the verdict is no longer DEAD -> the mutant dies.
    _raw_append(d, {"kind": "verified", "fact_id": "x", "claim": "c",
                    "inputs": {}, "established_at": "01.0000", "date": "01.0000", "seq": 1})
    rc, out, _ = run(d, "verify", "--fact-id", "x")
    # With sort: true latest (seq 5, retired) wins -> DEAD (exit 5).
    if rc == 5 and "DEAD" in out and _one_verdict(out):
        ok("latest_for resolves by (date,seq), not file order — true-latest retired -> DEAD")
    else:
        bad("latest-for-sort",
            f"expected DEAD(2) from the higher-seq retired event, got rc={rc} out=[{out.strip()}]")


def t28_append_event_sameday_compare(d):
    # GATE-5 real gap: append_event computes same_day by `e.get('date')==ev['date']`
    # then seq = 1 + max(same-day seqs). Flip Eq->NotEq and the new event's seq is
    # computed off the WRONG (other-day) events, so a real same-day sequence can
    # collide/mis-order. Drive it through the CLI (which uses append_event) with two
    # registers on the same date, then verify latest-wins still resolves correctly.
    write(d, "a.txt", "1"); run(d, "register", "--fact-id", "y", "--claim", "c", "--inputs", "a.txt")
    write(d, "b.txt", "2"); run(d, "register", "--fact-id", "y", "--claim", "c", "--inputs", "b.txt")
    # latest (b.txt) is live; moving a.txt (older) must NOT make y stale
    write(d, "a.txt", "MOVED")
    rc, out, _ = run(d, "verify", "--fact-id", "y")
    if not (rc == 0 and "FRESH" in out):
        bad("append-sameday", f"older same-day input moved should stay FRESH, got rc={rc} out=[{out.strip()}]"); return
    # moving the true latest (b.txt) MUST make it stale — proves seq ordered them right
    write(d, "b.txt", "MOVED")
    rc2, out2, _ = run(d, "verify", "--fact-id", "y")
    if rc2 == 3 and "STALE" in out2:
        ok("append_event same-day seq orders same-date events so latest-wins holds")
    else:
        bad("append-sameday", f"moving true-latest input should be STALE, got rc={rc2} out=[{out2.strip()}]")


def t29_fold_none_factid_guard(d):
    # GATE-5 real gap: fold guards against a None fact_id. A raw log line missing
    # fact_id must not crash `list` or mis-fold. Craft such a line, then run list.
    write(d, "g.txt", "v1")
    run(d, "register", "--fact-id", "real", "--claim", "c", "--inputs", "g.txt")
    _raw_append(d, {"kind": "verified", "claim": "orphan-no-factid",
                    "date": "01.0001", "seq": 1})  # NO fact_id key
    rc, out, err = run(d, "list")
    # must not crash (exit 0/2 acceptable per contract), and the real fact must survive the fold
    if rc in (0, 2) and "real" in out:
        ok("fold survives a None/absent fact_id line without crashing or dropping real facts")
    else:
        bad("fold-none-factid", f"list should survive a factid-less line, got rc={rc} out=[{out.strip()}] err=[{err.strip()}]")


def t30_register_success_exit_zero(d):
    # GATE-5 real gap: cmd_register ends `return 0` (success). Two mutants break it and
    # BOTH pass the current suite because the headline REGISTERED still prints:
    #   (a) `const int 0->1 @L319` flips the success return to 1;
    #   (b) `drop Return @L228` drops append_event's `return ev`, so cmd_register does
    #       `ev = append_event(...)` -> ev is None -> the following ev['established_at']
    #       raises, and register exits non-zero.
    # The success EXIT CODE is a hard consumer contract (0 = the certificate was written);
    # a scripted caller that checks `verify register ... && ...` breaks silently on rc=1.
    # Assert it directly.
    write(d, "a.txt", "1")
    rc, out, _ = run(d, "register", "--fact-id", "rz", "--claim", "c", "--inputs", "a.txt")
    if rc == 0 and "REGISTERED" in out:
        ok("register exits 0 on success (the write-succeeded contract, not just the headline)")
    else:
        bad("register-exit", f"register success must exit 0, got rc={rc} out=[{out.strip()[:80]}]")


def t31_retire_success_exit_zero(d):
    # GATE-5 real gap: cmd_retire ends `return 0`. `const int 0->1 @L675` flips it to 1
    # while still printing RETIRED, so the current suite (headline-only on retire) misses it.
    # A retire that "succeeds" with rc=1 lies to `verify retire ... && verify verify ...`.
    write(d, "a.txt", "1")
    run(d, "register", "--fact-id", "rt", "--claim", "c", "--inputs", "a.txt")
    rc, out, _ = run(d, "retire", "--fact-id", "rt", "--reason", "superseded")
    if rc == 0 and "RETIRED" in out:
        ok("retire exits 0 on success (the call-it-dead contract, not just the headline)")
    else:
        bad("retire-exit", f"retire success must exit 0, got rc={rc} out=[{out.strip()[:80]}]")


def t32_append_event_returns_written_record(d):
    # GATE-5 real gap (the OTHER half of drop Return @L228): cmd_register reads fields off
    # the RECORD append_event returns (ev['established_at'] for the "certificate kept @"
    # line). If append_event returns None, that read fails. Assert the confirmation line
    # that depends on the returned record is present AND register still exits 0 — this
    # pins that append_event's return value is consumed, not just that it wrote a line.
    write(d, "a.txt", "1")
    rc, out, _ = run(d, "register", "--fact-id", "rr", "--claim", "c", "--inputs", "a.txt")
    if rc == 0 and "certificate kept @" in out:
        ok("register consumes append_event's returned record (certificate-kept confirmation prints)")
    else:
        bad("append-return", f"register must print the certificate-kept line from the returned record, got rc={rc} out=[{out.strip()[:80]}]")


HARDENING = (t11_decide_fresh, t12_decide_stale_precedence, t13_decide_dead_beats_stale,
             t14_decide_assumed_premise, t15_decide_dead_on_retired_premise, t16_decide_guards,
             t17_decide_cycle, t18_json_decided, t19_json_assumed_and_dead, t20_fold_latest_wins,
             t21_list_render_kinds, t22_discharge_guards, t23_fold_check_json_parity,
             t24_nested_decision, t25_bad_jsonl_raises, t26_seq_ordering_manyevents,
             t27_latest_for_sort_kills_fileorder, t28_append_event_sameday_compare,
             t29_fold_none_factid_guard, t30_register_success_exit_zero,
             t31_retire_success_exit_zero, t32_append_event_returns_written_record)


def main():
    for t in (t1, t2, t3, t4, t5, t6, t7, t8, t9, t10) + HARDENING:
        with tempfile.TemporaryDirectory() as d:
            t(d)
    print()
    print(f"{PASS}/{PASS + FAIL} passed")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
