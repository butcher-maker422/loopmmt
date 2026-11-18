# SPDX-License-Identifier: MIT
"""test_keyed-stream.py — the external battery for the keyed-stream gift. Each test's name is the behaviour it holds.

    python3 -m unittest test_keyed-stream      (from this folder; KEYED_STREAM_UNDER_TEST points it at a mutant copy)
"""
import hashlib
import hmac
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.environ.get("KEYED_STREAM_UNDER_TEST") or os.path.join(HERE, "keyed-stream.py")
_spec = importlib.util.spec_from_file_location("keyed_stream", PATH)
K = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(K)


def cli(*args):
    return subprocess.run([sys.executable, PATH, *args], capture_output=True, text=True)


class Blocks(unittest.TestCase):
    def test_a_block_is_hmac_sha256_of_context_and_the_index_as_eight_bytes(self):
        for key, ctx, i in ((b"k", b"", 0), (b"Jefe", b"what do ya want for ", 7), ("s33d", "abc", 2 ** 40 + 3)):
            kb = key if isinstance(key, bytes) else key.encode()
            cb = ctx if isinstance(ctx, bytes) else ctx.encode()
            self.assertEqual(K.block(key, ctx, i), hmac.new(kb, cb + i.to_bytes(8, "big"), hashlib.sha256).digest())

    def test_rfc_4231_case_two_comes_back(self):
        self.assertEqual(K.block(b"Jefe", b"what do ya want for ", int.from_bytes(b"nothing?", "big")).hex(),
                         "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843")

    def test_text_and_its_utf8_bytes_are_the_same_key_and_context(self):
        self.assertEqual(K.block("ключ", "мир", 5), K.block("ключ".encode(), "мир".encode(), 5))

    def test_different_contexts_or_indexes_give_different_blocks(self):
        seen = {K.block("k", c, i) for c in ("a", "b", "ab") for i in range(50)}
        self.assertEqual(len(seen), 150)

    def test_the_last_index_is_readable_and_one_past_it_is_refused(self):
        self.assertEqual(len(K.block("k", "c", 2 ** 64 - 1)), 32)
        for bad in (2 ** 64, -1, 1.0, True, "3"):
            with self.assertRaises(Exception, msg=repr(bad)) as cm:     # refused by name, never a stray overflow
                K.block("k", "c", bad)
            self.assertIsInstance(cm.exception, K.StreamError, repr(bad))

    def test_an_empty_key_or_a_key_that_is_not_bytes_or_text_is_refused(self):
        for bad in (b"", "", None, 5):
            with self.assertRaises(K.StreamError, msg=repr(bad)):
                K.block(bad, "c", 0)


class Bits(unittest.TestCase):
    def test_bit_p_is_bit_p_mod_256_of_block_p_div_256_most_significant_first(self):
        for p in (0, 1, 7, 8, 255, 256, 511, 10 ** 6 + 13):
            b = K.block("k", "c", p // 256)
            self.assertEqual(K.bit("k", "c", p), (b[(p % 256) // 8] >> (7 - p % 8)) & 1)

    def test_a_run_of_bits_equals_the_bits_read_one_at_a_time(self):
        for start, count in ((0, 600), (250, 20), (1000, 0)):
            self.assertEqual(K.bits("k", "c", start, count), [K.bit("k", "c", p) for p in range(start, start + count)])

    def test_random_access_reads_what_a_sequential_read_reads(self):
        run = K.bits("k", "c", 0, 2048)
        for p in (2047, 3, 1024, 0, 513):
            self.assertEqual(K.bit("k", "c", p), run[p])

    def test_a_negative_count_is_refused(self):
        with self.assertRaises(K.StreamError):
            K.bits("k", "c", 0, -1)

    def test_the_dikw_door_reads_the_same_bits(self):
        # the DIKW game's door stream_bit is the shape this gift generalises: seed as key, genesis hash as context
        door = os.path.join(HERE, "..", "..", "..", "_tools", "dikw", "door.py")
        if not os.path.exists(door):
            self.skipTest("the DIKW door is not beside this home")
        spec = importlib.util.spec_from_file_location("dikw_door", door)
        D = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(D)
        w = {"seed": "s33d", "genesis_hash": "abc123", "log": []}
        self.assertTrue(all(D.stream_bit(w, p) == K.bit("s33d", "abc123", p) for p in range(0, 4000, 3)))


class Below(unittest.TestCase):
    def test_every_value_is_in_range(self):
        for n in (1, 2, 3, 7, 10, 1000, 2 ** 63 + 1, 2 ** 64):
            for i in range(30):
                self.assertTrue(0 <= K.below("k", "c", i, n) < n)

    def test_n_of_one_is_always_zero(self):
        self.assertEqual({K.below("k", "c", i, 1) for i in range(40)}, {0})

    def test_a_small_n_is_spread_evenly(self):
        counts = Counter(K.below("k", "c", i, 6) for i in range(6000))
        self.assertEqual(set(counts), set(range(6)))
        self.assertTrue(all(850 <= v <= 1150 for v in counts.values()), counts)

    def test_a_word_in_the_rejection_zone_is_skipped_not_reduced(self):
        # n just above 2**63: the limit is n itself, so any word >= n must be rejected, never taken mod n
        n = 2 ** 63 + 1
        for i in range(200):
            words = K._words("k", "c", i)
            first = next(words)
            v = K.below("k", "c", i, n)
            if first < n:
                self.assertEqual(v, first)
            else:
                self.assertNotEqual(v, first % n) if first % n != v else None
                self.assertEqual(v, next(w for w in K._words("k", "c", i) if w < n))

    def test_the_extension_continues_past_the_block_under_a_derived_key(self):
        ws = K._words("k", "c", 4)
        got = [next(ws) for _ in range(8)]
        b = K.block("k", "c", 4)
        self.assertEqual(got[:4], [int.from_bytes(b[8 * j:8 * j + 8], "big") for j in range(4)])
        sub = hmac.new(b"k", b"keyed-stream:extend", hashlib.sha256).digest()
        e = hmac.new(sub, b"c" + (4).to_bytes(8, "big") + (1).to_bytes(8, "big"), hashlib.sha256).digest()
        self.assertEqual(got[4:], [int.from_bytes(e[8 * j:8 * j + 8], "big") for j in range(4)])

    def test_a_bad_n_is_refused(self):
        for bad in (0, -3, 2 ** 64 + 1, 2.0, True):
            with self.assertRaises(K.StreamError, msg=repr(bad)):
                K.below("k", "c", 0, bad)


class Fractions(unittest.TestCase):
    def test_a_fraction_is_the_top_53_bits_over_two_to_the_53(self):
        for i in range(20):
            num, den = K.fraction("k", "c", i)
            self.assertEqual(den, 2 ** 53)
            self.assertEqual(num, int.from_bytes(K.block("k", "c", i)[:8], "big") >> 11)
            self.assertTrue(0 <= num < den)


class Shuffles(unittest.TestCase):
    def test_a_shuffle_is_a_permutation_and_leaves_its_input_alone(self):
        items = list(range(30))
        out = K.shuffle("k", "c", items)
        self.assertEqual(sorted(out), items)
        self.assertEqual(items, list(range(30)))

    def test_a_shuffle_is_fisher_yates_from_the_end_with_below(self):
        items = list("abcdefgh")
        want = list(items)
        for j in range(len(want) - 1, 0, -1):
            s = K.below("k", "c", j, j + 1)
            want[j], want[s] = want[s], want[j]
        self.assertEqual(K.shuffle("k", "c", items), want)

    def test_every_order_of_three_turns_up(self):
        seen = Counter(tuple(K.shuffle("k", "c%d" % t, [1, 2, 3])) for t in range(1200))
        self.assertEqual(len(seen), 6)
        self.assertTrue(all(140 <= v <= 260 for v in seen.values()), seen)

    def test_short_lists_come_back_as_they_were(self):
        self.assertEqual(K.shuffle("k", "c", []), [])
        self.assertEqual(K.shuffle("k", "c", ["x"]), ["x"])


class Surface(unittest.TestCase):
    def test_the_command_line_reads_what_the_module_reads(self):
        r = cli("block", "--key", "k", "--context", "c", "--index", "3")
        self.assertEqual((r.returncode, r.stdout.strip()), (0, K.block("k", "c", 3).hex()))
        r = cli("bits", "--key", "k", "--context", "c", "--start", "5", "--count", "12")
        self.assertEqual(r.stdout.strip(), "".join(map(str, K.bits("k", "c", 5, 12))))
        r = cli("below", "--key", "6b", "--key-hex", "--context", "c", "--index", "2", "--n", "9")
        self.assertEqual(r.stdout.strip(), str(K.below(b"k", "c", 2, 9)))
        r = cli("shuffle", "--key", "k", "--context", "c", "--items", "a,b,c,d")
        self.assertEqual(r.stdout.strip(), ",".join(K.shuffle("k", "c", ["a", "b", "c", "d"])))

    def test_a_case_file_is_answered_as_canonical_json(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            json.dump({"op": "fraction", "key": "k", "context": "c", "index": 1}, fh)
        try:
            r = cli("case", fh.name)
        finally:
            os.unlink(fh.name)
        num, den = K.fraction("k", "c", 1)
        self.assertEqual(r.stdout.strip(), K.canonical({"op": "fraction", "numerator": num, "denominator": den}))

    def test_bad_input_exits_two_with_one_line_and_no_trace(self):
        for args in (("block", "--key", "k", "--index", "x"), ("block", "--context", "c", "--index", "1"),
                     ("below", "--key", "k", "--index", "1", "--n", "0"), ("nope",), ("case", "/no/such/file.json")):
            r = cli(*args)
            self.assertEqual(r.returncode, 2, args)
            self.assertNotIn("Traceback", r.stderr)

    def test_an_unknown_op_in_a_case_is_refused(self):
        with self.assertRaises(K.StreamError):
            K.answer({"op": "dice", "key": "k"})

    def test_help_prints_the_edge_and_the_edge_ships_in_the_file(self):
        r = cli("--help")
        self.assertEqual(r.returncode, 0)
        self.assertIn("THE PRINTED EDGE", r.stdout)
        with open(PATH, encoding="utf-8") as fh:
            self.assertIn(K.PRINTED_EDGE[:60], fh.read().replace("\n    ", " "))

    def test_the_selftest_passes(self):
        self.assertEqual(cli("--selftest").returncode, 0)


if __name__ == "__main__":
    unittest.main()
