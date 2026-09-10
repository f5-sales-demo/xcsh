# Upstream provenance

The enrollment wire contract is ported from OpenAI Codex, copyright OpenAI,
licensed under Apache License 2.0 (included in LICENSE).

Compatibility baseline: Codex rust-v0.153.4, commit
`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`.

Source files under `codex-rs/app-server-transport/src/transport/remote_control/`:

- `protocol.rs`: enrollment request and response fields.
- `server_api.rs`: enrollment endpoint, installation header, timeout.
- `auth.rs`: subscription bearer and selected account headers.
- `enroll.rs`: pairing and expiry contract.
- `websocket.rs`, `client_tracker.rs`, `segment.rs`: relay headers, framing,
  sequence cursors, acknowledgements, and chunk transport.
- `codex-rs/app-server-protocol`: initialization, thread, turn, and item wire shapes.

Source: https://github.com/openai/codex/tree/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/app-server-transport/src/transport/remote_control

Modifications: TypeScript/Bun implementation; XCSH identity and version; fixed
production endpoint; response size limit; no server-body diagnostics; bounded
relay retries; private XCSH-owned state and Unix socket session attachment.
