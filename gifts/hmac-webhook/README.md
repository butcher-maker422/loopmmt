# hmac-webhook

**Verify an HMAC-signed webhook before you trust its body — in constant time, with zero dependencies.**

A webhook sender (GitHub, Stripe, Shopify, a Loop module) signs every request body with a shared secret and puts the signature in a header, conventionally:

```
X-Signature: sha256=<hex>
```

`hmac-webhook` recomputes `HMAC-SHA256(secret, rawBody)` and checks it against the signature the sender sent. It answers **one** question — *is this body authentic and unmodified, from someone who holds the secret?* — and answers it in **constant time**, so a forger can't learn the correct signature one byte at a time from how long a rejection takes.

```
verify(rawBody, signatureHeader, secret) -> { ok, reason }
```

`ok:true` means the body is authentic. `ok:false` names **why** — never a partial match, never a maybe:

| reason | meaning |
|---|---|
| `no-signature` | the header is empty or missing |
| `bad-format` | not `<scheme>=<hex>` with an even-length hex body |
| `unsupported-scheme` | a scheme other than the one required (default `sha256`) |
| `length-mismatch` | the digest is not 64 hex chars (32 bytes) |
| `hmac-mismatch` | well-formed and right-length, but the MAC does not match — a tampered body, a wrong secret, or a forgery |

## Use it

**Receiver — verify an incoming webhook:**

```
printf '%s' '{"event":"ping"}' | node hmac-webhook.js --secret s3cr3t --signature "sha256=<hex>"
# prints "ok" and exits 0 if authentic; prints the reason and exits 1 otherwise
```

**Sender — produce the signature to send:**

```
printf '%s' '{"event":"ping"}' | node hmac-webhook.js --secret s3cr3t --sign
# -> sha256=<hex>
```

In code (Node or browser — `window.ForestGifts.hmacWebhook`):

```js
const { verify, sign } = require("./hmac-webhook.js");
const header = sign(body, secret);              // "sha256=..."
const result = verify(body, header, secret);    // { ok: true, reason: "" }
```

Options: `--scheme NAME` sets the signature label to require/emit (default `sha256`). `--help` prints usage. Body comes from a `FILE` argument or stdin.

## How it works

HMAC-SHA256 is [RFC 2104](https://www.rfc-editor.org/rfc/rfc2104) exactly, with the SHA-256 core vendored byte-for-byte from the shipped `sha256` gift (FIPS 180-4):

```
K'   = key            if len(key) <= 64,   else SHA-256(key),   then zero-padded to 64
HMAC = SHA-256( (K' XOR opad) || SHA-256( (K' XOR ipad) || message ) )
```

Everything runs on raw bytes — the message and the key are UTF-8 encoded once — so the result is byte-identical to `crypto.createHmac('sha256', secret).update(body).digest('hex')` and to `openssl dgst -sha256 -hmac`. The comparison XOR-accumulates over the full 64-char digest and looks at every character regardless of where the first difference is, so the pass/fail timing carries no information about the correct signature.

It is a pure function of `(body, header, secret)` — no clock, no randomness, no files, no network. Same three inputs, same verdict, every run.

## What this is **not**

It verifies authenticity — nothing more. It is **not** a secret store (you supply the secret; it is never persisted), **not** a replay defender (it proves *this* body is authentic, not that it is *fresh* — pair it with a timestamp or nonce check if you need that), **not** a TLS or transport check, **not** an authorization system (authentic ≠ allowed), and **not** a multi-algorithm negotiator (it verifies the one scheme you name).

## License

MIT © 2026 Shea Gunther. Zero dependencies. One file. Runs in Node or a browser.
