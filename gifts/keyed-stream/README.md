# keyed-stream

**A replayable stream of bytes from a key, readable at any point.** Give it a key, a context (what the stream is for:
a world's genesis hash, a match id) and an index, and it returns block i: 32 bytes, HMAC-SHA256(key, context || i).
Any block reads without the ones before it, so a client regenerates tick 90,000 without replaying 89,999, and two
machines holding the same key read the same stream byte for byte.

```
python3 keyed-stream.py block   --key K --context C --index 3
python3 keyed-stream.py bits    --key K --context C --start 0 --count 64
python3 keyed-stream.py below   --key K --context C --index 7 --n 6
python3 keyed-stream.py shuffle --key K --context C --items a,b,c,d
python3 keyed-stream.py --selftest
```

Bits are read most significant first; a bounded number has no modulo bias; a fraction in [0, 1) is exact (53 bits over
2**53); a shuffle is Fisher-Yates from the end. Every read is a pure function of (key, context, index).

**What it does not do.** keyed-stream makes a replayable stream from a key you supply; it does not make, store or protect keys, anyone who holds the key can regenerate every block (that is the point), it is not a source of fresh secrets, and it says nothing about fairness beyond the uniformity of its own reads.

MIT License. Python 3 standard library only. No network, no clock, no randomness of its own.
