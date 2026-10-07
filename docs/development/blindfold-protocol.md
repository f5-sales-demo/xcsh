# Blindfold protocol contract

This contract was recovered from vesctl 0.2.47 offline synthetic encryption and independently decrypted before implementation. The runtime uses bundled OpenSSL and native code; vesctl is not a dependency. Synthetic tests exercise recovery independently with Node crypto and big integers. Live certificate TLS acceptance verifies F5 decryption for RSA and EC inputs.

All envelope lengths are unsigned 32-bit big-endian. All integers use big-endian encoding. RSA exponent and modulus are unsigned, minimally encoded, length-prefixed byte strings. The complete public exponent is preserved.

| Field | Encoding |
| --- | --- |
| Tenant | Length-prefixed UTF-8 canonical tenant ID |
| Key version | Unsigned 32-bit big-endian |
| Policy ID | Unsigned 64-bit big-endian |
| Algorithm | One byte, value 2 |
| Public exponent | Length-prefixed unsigned big-endian bytes |
| Public modulus | Length-prefixed unsigned big-endian bytes |
| Wrapped key block | Length-prefixed RSA modulus-width bytes |
| Encrypted secret | AES-256-GCM ciphertext followed by 16-byte tag; no length prefix |

For policy ID `p` and original exponent `e`, the effective RSA exponent is `e * (2*p + 2^31 + 1)`. Arithmetic must not truncate the policy or exponent.

Construct a random block of modulus byte width minus two. Set bytes 0–3 to `de ad be ef`. Bytes 4–15 are the 12-byte GCM nonce; bytes 16–47 are the 32-byte AES key. The remaining bytes remain random. Interpret the block as an unsigned integer and compute its modular exponentiation with the effective exponent and modulus. Serialize the wrapped result at the full modulus byte width. GCM uses empty additional authenticated data. Base64-encode the entire envelope and prefix `string:///`.

The synthetic reference used a generated 2048-bit RSA key, policy 101, and a 2048-byte secret. Independently deriving the private exponent modulo the RSA group order recovered `deadbeef`, the nonce, AES key and the entire plaintext. Wrong-policy recovery and altered GCM ciphertext must fail. Production code contains no decryption endpoint.

Private input buffers, normalized key PEM and AES key block use zeroizing native allocations. OpenSSL owns parsed private-key allocations; the intermediate RSA plaintext big integer is cleared after use. The native API returns only encrypted material and public certificate metadata. Service/tool results exclude encrypted payloads; requested artifacts stay on disk.
