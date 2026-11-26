# Vendored uucore

This directory contains uucore 0.13.0 from the published crates.io archive.
The upstream MIT license is retained in LICENSE.

The two large lazy per-thread locale caches use boxed storage. Their initialization,
localization behavior and thread isolation are preserved. This keeps the native
addon within glibc static TLS capacity when Bun loads it after process startup.
The unmodified archive increased the addon TLS segment from 1464 to 2024 bytes
and failed a fresh-process load with `ERR_DLOPEN_FAILED`.

Source: [uucore 0.13.0](https://crates.io/crates/uucore/0.13.0)

Archive SHA-256: 90cf14b33aa0368fd2842ef436d8890219dea9be20b2594836f0bba903533cca

Repository formatting is applied with the root rustfmt configuration.
The original archive and the unchanged upstream locale test results are retained
in private qualification evidence.

Strict all-feature Clippy findings are corrected in documentation and macro
punctuation; stale lint expectations are removed. Utility behavior is preserved.
A scoped ignore exception keeps all upstream library sources visible to Git and
the native readiness fingerprint.
