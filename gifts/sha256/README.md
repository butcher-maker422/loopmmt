# sha256 — a hash that matches your backend, in the browser, synchronously

A dependency-free SHA-256 (hex out) that returns the **same 64-character digest
as Node's `crypto.createHash('sha256')`** for the same string — and does it
**synchronously**, so you can hash inside a verify path without turning that
path async.

## Why this exists

The browser's built-in answer, `crypto.subtle.digest`, is **asynchronous** — it
returns a Promise. The moment you need a hash in the middle of an otherwise
synchronous check (parse a file, read an integrity field, decide
tamper / no-tamper), an async hash forces that whole call chain to become async
and ripple outward through everything that calls it.

This is a small, pure, synchronous [FIPS 180-4](https://csrc.nist.gov/pubs/fips/180-4/upd1/final)
SHA-256 that keeps the call site sync **and** returns a digest byte-identical to
your Node backend — so a browser can mirror a server-side integrity check
without a rewrite.

## The one fidelity rule

Node hashes the **UTF-8 bytes** of `String(input)`. This encodes with the same
UTF-8 byte stream, so the digest is identical — including for multibyte
characters (accented names, emoji, non-Latin scripts). It never hashes char
codes: doing so would diverge silently on multibyte input, and a tamper check
would read a **false verdict**. The test battery carries multibyte and emoji
vectors (`café`, `日本語`, `🦌`) checked against Node's own `crypto` as the
oracle — precisely to prove that rule holds.

## Use it

```sh
node sha256.js "the string to hash"       # hash an argument
echo -n "the string" | node sha256.js     # hash stdin (exact bytes, no newline added)
node sha256.js --help
```

In a browser, load `sha256.js` and call `window.ForestGifts.sha256Hex(str)`. In
Node, `require('./sha256.js').sha256Hex(str)`. It is a pure function of its
input with no dependencies, so the same code runs in both.

```js
const { sha256Hex } = require('./sha256.js');
sha256Hex('abc');
// 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
```

## Its edge (a gift that hides its edges is not a gift)

This is a **hash**, not an HMAC and not encryption. It proves that two inputs
match; it keeps no secret, and it is **not** a password-storage KDF — do not use
it to store passwords (use a purpose-built KDF like scrypt/argon2 for that). Its
job is integrity and equality-of-content, and at that it is byte-exact with your
backend. It is also a from-scratch implementation offered for portability, not a
hardened crypto library — where a vetted native library is available and
synchronicity is not a constraint, prefer it.

## Test

```sh
node test_sha256.js
```

18 vectors cross-checked against Node's `crypto` (including multibyte + emoji),
the two canonical FIPS anchors, determinism, coercion parity, and a
mutation-bite that fails loudly if the core is wrong. stdlib only, no
dependencies.

## License

MIT — use it in anything, including something you sell.
