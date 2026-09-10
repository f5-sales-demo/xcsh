# Upstream provenance

The remote-control wire contracts are ported from OpenAI Codex, copyright OpenAI,
licensed under Apache License 2.0 (included in LICENSE).

Compatibility baseline: Codex rust-v0.153.4, commit
`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`.

Source files under `codex-rs/app-server-transport/src/transport/remote_control/`:

- `protocol.rs`: enrollment request and response fields.
- `server_api.rs`: enrollment endpoint, installation header, timeout.
- `auth.rs`: subscription bearer and selected account headers.
- `enroll.rs`: pairing and expiry contract.
- `clients.rs`: client listing, pagination, revocation, and one unauthorized-auth recovery retry.
- `websocket.rs`, `client_tracker.rs`, `segment.rs`: relay headers, framing,
  sequence cursors, acknowledgements, and chunk transport.
- `codex-rs/app-server-protocol`: initialization, thread, turn, and item wire shapes.
- `codex-rs/app-server-protocol/src/protocol/v2/{config,model,process}.rs`:
  configuration/model discovery and standalone process requests/notifications.

- `codex-rs/app-server-protocol/src/protocol/v2/realtime.rs`: voice requests and notifications.
- `codex-rs/codex-api/src/endpoint/realtime_websocket/{methods,methods_frameless_bidi,protocol_v1,protocol_frameless_bidi}.rs`:
  existing-call URLs, 500-byte context chunks, transcript and delegation events.
- `codex-rs/codex-api/src/endpoint/realtime_call.rs`: subscription WebRTC call creation,
  backend JSON request, AVAS query parameters, answer SDP and call identities.
- `codex-rs/core/src/realtime_conversation{.rs,/existing_call.rs,/sideband.rs}`:
  selected subscription sideband headers, client-owned configuration, and v3
  reconnect backoff with stable-connection reset.
- `codex-rs/core/src/realtime_history.rs`: session boundary items, separate user
  and assistant transcript segments, streamed item deltas, and closure sealing.
- `codex-rs/app-server/src/bespoke_event_handling.rs`: handoff item notification
  with request identity and the active transcript; transcript consumption follows
  `codex-api/src/endpoint/realtime_websocket/methods.rs`.
- `codex-rs/app-server-protocol/schema/json/{ClientRequest,ServerRequest,ServerNotification}.json`:
  the literal method names retained in sanitized capture metadata.

Source: https://github.com/openai/codex/tree/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/app-server-transport/src/transport/remote_control

Modifications: TypeScript/Bun implementation; xcsh identity and version; fixed
production endpoint; response size limit; no server-body diagnostics; bounded
relay retries; private xcsh-owned state and Unix socket session attachment.
