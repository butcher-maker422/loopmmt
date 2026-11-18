#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""
keyed-stream — a replayable, random-access stream of bytes from a key.

Give it a key, a context (what the stream is for: a world's genesis hash, a match id, a recipe hash) and an index, and
it returns block i of that stream: 32 bytes, HMAC-SHA256(key, context || i), with i as eight bytes big-endian. Any
block can be read without reading the ones before it, so a client can regenerate tick 90,000 without replaying 89,999,
a verifier can check one frame in constant time, and two machines holding the same key read the same stream byte for
byte. Bits, bounded whole numbers, fractions in [0, 1) and shuffles are read off the blocks by fixed rules, each one a
pure function of (key, context, index).

WHAT IT IS (and is not)
    Deterministic and replayable on purpose: the same key, context and index give the same bytes on every machine,
    forever. The construction is HMAC-SHA256 (RFC 2104) from the Python standard library; block i is
    HMAC(key, context || u64be(i)), which is injective in (context, i) because the index is a fixed-width suffix.
    Reads that need more than one block's worth of randomness (a bounded number whose draws keep landing in the
    rejection zone) continue under a derived key, HMAC(key, "keyed-stream:extend"), so they never collide with a block
    any caller can ask for directly.

READS
    block(key, context, i)              32 bytes
    bit(key, context, p)                bit p of the stream: byte (p % 256) // 8 of block p // 256, most significant first
    bits(key, context, start, count)    a list of `count` bits from position `start`
    below(key, context, i, n)           a whole number uniform in [0, n), no modulo bias (rejection on 64-bit words)
    fraction(key, context, i)           (numerator, 2**53): an exact dyadic fraction uniform in [0, 1)
    shuffle(key, context, items)        a new list, Fisher-Yates from the end, each swap index below(..., j, j + 1)

USAGE
    keyed-stream.py block   --key K [--key-hex] --context C --index I        hex of block I
    keyed-stream.py bits    --key K [--key-hex] --context C --start S --count N    a string of 0s and 1s
    keyed-stream.py below   --key K [--key-hex] --context C --index I --n N        a whole number in [0, N)
    keyed-stream.py shuffle --key K [--key-hex] --context C --items a,b,c          the items, comma-joined
    keyed-stream.py case CASE.json       answer one JSON case ({"op": ..., the arguments}) as canonical JSON
    keyed-stream.py --selftest           the built-in battery (exit 0 all pass)
    A key or context given as text is UTF-8 encoded once; --key-hex reads the key as hex bytes. Exit 0 · 2 bad input.

THE PRINTED EDGE
    keyed-stream makes a replayable stream from a key you supply; it does not make, store or protect keys, anyone who
    holds the key can regenerate every block (that is the point), it is not a source of fresh secrets, and it says
    nothing about fairness beyond the uniformity of its own reads.

MIT License. Python 3 standard library only. No network, no clock, no randomness of its own.
"""
import hashlib
import hmac
import json
import sys

PRINTED_EDGE = ("keyed-stream makes a replayable stream from a key you supply; it does not make, store or protect keys, "
                "anyone who holds the key can regenerate every block (that is the point), it is not a source of fresh "
                "secrets, and it says nothing about fairness beyond the uniformity of its own reads.")
VERSION = "v1"
BLOCK_BITS = 256
EXTEND_LABEL = b"keyed-stream:extend"
MAX_INDEX = 2 ** 64 - 1


class StreamError(ValueError):
    pass


def _bytes(x, what):
    if isinstance(x, (bytes, bytearray)):
        return bytes(x)
    if isinstance(x, str):
        return x.encode("utf-8")
    raise StreamError(f"{what} is bytes or text")


def _index(i, what="index"):
    if not (type(i) is int and 0 <= i <= MAX_INDEX):
        raise StreamError(f"{what} is a whole number in [0, 2**64)")
    return i


def block(key, context, i):
    """Block i of the stream: HMAC-SHA256(key, context || u64be(i))."""
    k, c = _bytes(key, "key"), _bytes(context, "context")
    if not k:
        raise StreamError("the key is not empty")
    return hmac.new(k, c + _index(i).to_bytes(8, "big"), hashlib.sha256).digest()


def bit(key, context, p):
    """Bit p of the stream, most significant bit of each byte first."""
    b = block(key, context, _index(p, "position") // BLOCK_BITS)
    q = p % BLOCK_BITS
    return (b[q // 8] >> (7 - q % 8)) & 1


def bits(key, context, start, count):
    _index(start, "start")
    if not (type(count) is int and 0 <= count and start + count - 1 <= MAX_INDEX):
        raise StreamError("count is a whole number and the run stays inside the stream")
    out, cache = [], {}
    for p in range(start, start + count):
        j = p // BLOCK_BITS
        if j not in cache:
            cache = {j: block(key, context, j)}
        q = p % BLOCK_BITS
        out.append((cache[j][q // 8] >> (7 - q % 8)) & 1)
    return out


def _words(key, context, i):
    """The 64-bit words a bounded read draws from, in order: block i's four, then the extension blocks' four each."""
    b = block(key, context, i)
    for w in range(4):
        yield int.from_bytes(b[8 * w:8 * w + 8], "big")
    sub = hmac.new(_bytes(key, "key"), EXTEND_LABEL, hashlib.sha256).digest()
    k = 1
    while True:
        e = hmac.new(sub, _bytes(context, "context") + i.to_bytes(8, "big") + k.to_bytes(8, "big"),
                     hashlib.sha256).digest()
        for w in range(4):
            yield int.from_bytes(e[8 * w:8 * w + 8], "big")
        k += 1


def below(key, context, i, n):
    """A whole number uniform in [0, n): the first word under the largest multiple of n that fits in 64 bits."""
    if not (type(n) is int and 1 <= n <= 2 ** 64):
        raise StreamError("n is a whole number in [1, 2**64]")
    _index(i)
    limit = (2 ** 64 // n) * n
    for w in _words(key, context, i):
        if w < limit:
            return w % n


def fraction(key, context, i):
    """(numerator, 2**53): the top 53 bits of block i's first word, an exact fraction uniform in [0, 1)."""
    return int.from_bytes(block(key, context, i)[:8], "big") >> 11, 2 ** 53


def shuffle(key, context, items):
    """A new list: Fisher-Yates from the end, the swap partner of position j drawn as below(key, context, j, j + 1)."""
    out = list(items)
    for j in range(len(out) - 1, 0, -1):
        s = below(key, context, j, j + 1)
        out[j], out[s] = out[s], out[j]
    return out


def answer(case):
    """One JSON case -> its canonical answer (the conformance surface)."""
    if not isinstance(case, dict):
        raise StreamError("a case is a JSON object")
    op = case.get("op")
    key = bytes.fromhex(case["key_hex"]) if "key_hex" in case else case.get("key")
    ctx = case.get("context", "")
    try:
        if op == "block":
            return {"op": op, "hex": block(key, ctx, case.get("index")).hex()}
        if op == "bits":
            return {"op": op, "bits": "".join(map(str, bits(key, ctx, case.get("start"), case.get("count"))))}
        if op == "below":
            return {"op": op, "value": below(key, ctx, case.get("index"), case.get("n"))}
        if op == "fraction":
            num, den = fraction(key, ctx, case.get("index"))
            return {"op": op, "numerator": num, "denominator": den}
        if op == "shuffle":
            items = case.get("items")
            if not isinstance(items, list):
                raise StreamError("items is a list")
            return {"op": op, "items": shuffle(key, ctx, items)}
    except (KeyError, ValueError) as e:
        if isinstance(e, StreamError):
            raise
        raise StreamError(str(e))
    raise StreamError("op is one of block, bits, below, fraction, shuffle")


def canonical(result):
    return json.dumps(result, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


SELFTEST = [
    # RFC 4231 test case 2 is HMAC-SHA256("Jefe", "what do ya want for nothing?"); block() with that key, the message
    # less its last eight bytes as the context, and those eight bytes read as the index must reproduce it.
    ("block is HMAC-SHA256 of context || u64be(index) (RFC 4231 case 2)",
     lambda: block(b"Jefe", b"what do ya want for ", int.from_bytes(b"nothing?", "big")).hex(),
     "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"),
    ("bit p reads block p // 256, most significant first",
     lambda: [bit("k", "c", p) for p in (0, 7, 8, 255, 256)] == [
         (block("k", "c", p // 256)[(p % 256) // 8] >> (7 - p % 8)) & 1 for p in (0, 7, 8, 255, 256)], True),
    ("below stays in range", lambda: all(0 <= below("k", "c", i, 7) < 7 for i in range(50)), True),
    ("shuffle is a permutation", lambda: sorted(shuffle("k", "c", list(range(20)))) == list(range(20)), True),
    ("the same inputs give the same bytes", lambda: block("k", "c", 9) == block("k", "c", 9), True),
]


def selftest():
    bad = 0
    for name, run, want in SELFTEST:
        got = run()
        ok = got == want
        print(("PASS " if ok else "FAIL ") + name + ("" if ok else f" — got {got!r}"))
        bad += not ok
    print(f"keyed-stream selftest: {len(SELFTEST) - bad}/{len(SELFTEST)}")
    return 0 if bad == 0 else 1


def _arg(a, name, default=None):
    if name in a:
        i = a.index(name)
        if i + 1 >= len(a):
            raise StreamError(f"{name} needs a value")
        return a[i + 1]
    if default is None:
        raise StreamError(f"{name} is required")
    return default


def _int(s, name):
    try:
        return int(s, 10)
    except (TypeError, ValueError):
        raise StreamError(f"{name} is a whole number")


def main(argv=None):
    a = sys.argv[1:] if argv is None else argv
    if a[:1] == ["--selftest"]:
        return selftest()
    if a[:1] in (["--help"], ["-h"]):
        print(__doc__.strip())
        return 0
    if not a or a[0] not in ("block", "bits", "below", "shuffle", "case"):
        print(__doc__.split("USAGE")[1].split("THE PRINTED EDGE")[0].strip(), file=sys.stderr)
        return 2
    try:
        if a[0] == "case":
            if len(a) != 2:
                raise StreamError("case takes one CASE.json")
            with open(a[1], encoding="utf-8") as fh:
                print(canonical(answer(json.load(fh))))
            return 0
        raw = _arg(a, "--key")
        key = bytes.fromhex(raw) if "--key-hex" in a else raw
        ctx = _arg(a, "--context", "")
        if a[0] == "block":
            print(block(key, ctx, _int(_arg(a, "--index"), "--index")).hex())
        elif a[0] == "bits":
            print("".join(map(str, bits(key, ctx, _int(_arg(a, "--start"), "--start"),
                                        _int(_arg(a, "--count"), "--count")))))
        elif a[0] == "below":
            print(below(key, ctx, _int(_arg(a, "--index"), "--index"), _int(_arg(a, "--n"), "--n")))
        else:
            print(",".join(shuffle(key, ctx, _arg(a, "--items").split(","))))
    except (OSError, ValueError, StreamError) as e:
        print(f"keyed-stream: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
