#!/usr/bin/env python3
"""Mutation-bitten tests for the port gift.

Each test asserts a real behavior. To prove the suite is non-vacuous, run it
against a deliberately-broken port.py and confirm it goes RED (see the
`_self_mutation_note` at the bottom — the mutations are documented, not shipped).
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = os.path.join(HERE, "port.py")

sys.path.insert(0, HERE)
import port  # noqa: E402


def run(*args, input_text=None):
    """Run port.py as a subprocess; return (exit, stdout_lines)."""
    proc = subprocess.run(
        [sys.executable, PORT, *args],
        capture_output=True, text=True, input=input_text,
    )
    lines = [json.loads(l) for l in proc.stdout.splitlines() if l.strip()]
    return proc.returncode, lines


def write_manifest(entries, wrap=None):
    """Write a temp manifest; wrap=None -> bare list, else {wrap: [...]}."""
    fd, path = tempfile.mkstemp(suffix=".json")
    with os.fdopen(fd, "w") as f:
        json.dump(entries if wrap is None else {wrap: entries}, f)
    return path


class TestVocabulary(unittest.TestCase):
    def test_exactly_five_verbs(self):
        # The closed set is exactly five — no more, no fewer.
        self.assertEqual(len(port.PORT_VERBS), 5)
        self.assertEqual(set(port.PORT_VERBS),
                         {"source", "transform", "filter", "fold", "sink"})

    def test_valid_verb_gate(self):
        self.assertTrue(port.is_valid_verb("filter"))
        self.assertFalse(port.is_valid_verb("emit"))     # a plausible non-verb
        self.assertFalse(port.is_valid_verb(""))
        self.assertFalse(port.is_valid_verb(None))

    def test_verbs_command_emits_five_lines(self):
        code, lines = run("verbs")
        self.assertEqual(code, 0)
        self.assertEqual(len(lines), 5)
        self.assertEqual({l["port_verb"] for l in lines}, set(port.PORT_VERBS))


class TestRead(unittest.TestCase):
    def test_read_declared(self):
        m = write_manifest([{"slug": "a", "port_verb": "source"},
                            {"slug": "b", "port_verb": "sink"}])
        code, lines = run("read", "--manifest", m)
        self.assertEqual(code, 0)
        self.assertEqual(lines[0], {"slug": "a", "port_verb": "source",
                                    "source": "manifest", "status": "declared"})
        self.assertEqual(lines[1]["status"], "declared")

    def test_read_undeclared_is_flagged_not_guessed(self):
        # A gift with NO port_verb must come back status=undeclared, verb null —
        # never a guessed verb. This is the whole reason the gift exists.
        m = write_manifest([{"slug": "x", "verb": "survive"}])  # 'verb' is the
        code, lines = run("read", "--manifest", m)              # marketing verb
        self.assertEqual(code, 0)
        self.assertEqual(lines[0]["port_verb"], None)
        self.assertEqual(lines[0]["status"], "undeclared")

    def test_read_invalid_verb_flagged(self):
        m = write_manifest([{"slug": "x", "port_verb": "emit"}])  # not a verb
        code, lines = run("read", "--manifest", m)
        self.assertEqual(lines[0]["status"], "invalid")

    def test_read_slug_filter(self):
        m = write_manifest([{"slug": "a", "port_verb": "source"},
                            {"slug": "b", "port_verb": "sink"}])
        code, lines = run("read", "--manifest", m, "--slug", "b")
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0]["slug"], "b")

    def test_read_slug_not_found_exits_3(self):
        m = write_manifest([{"slug": "a", "port_verb": "source"}])
        code, lines = run("read", "--manifest", m, "--slug", "zzz")
        self.assertEqual(code, 3)
        self.assertEqual(lines[0]["status"], "not-found")

    def test_read_wrapped_manifest(self):
        # Real gifts-manifest.json wraps the list under 'gifts'.
        m = write_manifest([{"slug": "a", "port_verb": "fold"}], wrap="gifts")
        code, lines = run("read", "--manifest", m)
        self.assertEqual(code, 0)
        self.assertEqual(lines[0]["port_verb"], "fold")


class TestCheck(unittest.TestCase):
    def _flag_cmd(self, mapping):
        """Build a --flag-cmd that echoes a per-slug verb via a tiny py snippet."""
        table = json.dumps(mapping)
        # {slug} is substituted by port; the snippet prints the mapped verb.
        return (f"{sys.executable} -c "
                f"'import json,sys; "
                f"print(json.loads(sys.argv[1]).get(sys.argv[2],\"\"))' "
                f"'{table}' {{slug}}")

    def test_check_agree_exits_0(self):
        m = write_manifest([{"slug": "a", "port_verb": "source"}])
        code, lines = run("check", "--manifest", m,
                          "--flag-cmd", self._flag_cmd({"a": "source"}))
        self.assertEqual(code, 0)
        self.assertEqual(lines[0]["status"], "agree")

    def test_check_drift_exits_3(self):
        # Manifest says source, the tool's own flag says sink -> drift, exit 3.
        m = write_manifest([{"slug": "a", "port_verb": "source"}])
        code, lines = run("check", "--manifest", m,
                          "--flag-cmd", self._flag_cmd({"a": "sink"}))
        self.assertEqual(code, 3)
        self.assertEqual(lines[0]["status"], "drift")

    def test_check_missing_flag_exits_3(self):
        # Tool answers nothing -> missing, not silently passed.
        m = write_manifest([{"slug": "a", "port_verb": "source"}])
        code, lines = run("check", "--manifest", m,
                          "--flag-cmd", self._flag_cmd({}))  # empty -> ""
        self.assertEqual(code, 3)
        self.assertEqual(lines[0]["status"], "missing")

    def test_check_no_declarations_is_not_green(self):
        # A manifest that declared no port_verb at all must NOT read as pass.
        m = write_manifest([{"slug": "a", "verb": "survive"}])
        code, lines = run("check", "--manifest", m,
                          "--flag-cmd", self._flag_cmd({"a": "source"}))
        self.assertEqual(code, 3)
        self.assertEqual(lines[0]["status"], "no-declarations")


class TestEmit(unittest.TestCase):
    def test_emit_valid(self):
        code, lines = run("emit", "--slug", "port", "--port-verb", "source")
        self.assertEqual(code, 0)
        self.assertEqual(lines[0]["port_verb"], "source")
        self.assertEqual(lines[0]["status"], "declared")

    def test_emit_invalid_exits_3(self):
        code, lines = run("emit", "--slug", "x", "--port-verb", "nonsense")
        self.assertEqual(code, 3)
        self.assertEqual(lines[0]["status"], "invalid")


if __name__ == "__main__":
    unittest.main(verbosity=2)

# _self_mutation_note: this suite was proven non-vacuous by mutation —
#   (1) PORT_VERBS drop 'sink'            -> test_exactly_five_verbs RED
#   (2) cmd_read guess 'source' on null   -> test_read_undeclared_* RED
#   (3) cmd_check return 0 always         -> test_check_drift/missing RED
#   (4) cmd_check treat no-decl as pass   -> test_check_no_declarations RED
# each mutation reverted after confirming RED. A no-op runner cannot pass these.
