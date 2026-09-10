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
- `codex-rs/app-server/src/request_processors/thread_processor.rs` and
  `codex-rs/thread-store/src/local/thread_history/segment_paging.rs`: history
  page defaults, summary projections, exclusive continuation and inclusive
  reverse anchors. Native cursors additionally bind the session and filter scope.
- `codex-rs/app-server-protocol/src/protocol/v2/{item,notification}.rs`:
  tool-question request/answer and server-request resolution fields. Corresponding
  JSON schema fixtures are copied without changes from the pinned source. The
  terminal answer broker, tool-call binding and host routing are native xcsh code.
- `codex-rs/app-server/src/request_processors/thread_lifecycle.rs` and
  `app-server-protocol/src/protocol/v2/thread.rs`: pending-request retirement before
  unload and the `thread/closed` notification. Its schema fixture is unchanged.
- Ordinary history uses the pinned `v2/item.rs` user, agent and dynamic-tool
  shapes. Its selected-branch projection and `remote-history` identity/boundary
  metadata are native xcsh code; messages remain persisted by AgentSession.
- `codex-rs/app-server/src/request_processors/thread_processor.rs`, `filters.rs`,
  `thread-store/src/local/list_threads.rs` and `state/src/runtime/threads.rs`:
  discovery defaults, limits, sort/filter behavior, reverse anchors and loaded-ID
  pagination. Native discovery includes all live providers by default; source
  identity cursors tolerate departed terminals.
- `codex-rs/thread-store/src/local/thread_history/realtime.rs`: mixed timeline
  ordering, backward pagination, shared-position boundaries and opening voice
  state. Native cursors bind source-entry identities. The original experimental
  schema export has documented naming discrepancies; observed wire fields follow
  the pinned Rust serialization. See `PARITY.md`.
- `codex-rs/app-server-protocol/src/protocol/v2/{config,model,process}.rs`:
  configuration/model discovery and standalone process requests/notifications.

- `codex-rs/app-server-protocol/src/protocol/v2/realtime.rs`: voice requests and notifications.
- `codex-rs/codex-api/src/endpoint/realtime_websocket/{methods,methods_frameless_bidi,protocol_v1,protocol_frameless_bidi}.rs`:
  existing-call URLs, 500-byte context chunks, transcript and delegation events.
- `codex-rs/codex-api/src/endpoint/realtime_call.rs`: subscription WebRTC call creation,
  backend JSON request, AVAS query parameters, answer SDP and call identities.
- `codex-rs/codex-api/src/endpoint/realtime_websocket/{methods_v1,methods_common}.rs`:
  v1 call and sideband session shapes and completed agent-message prefix. Native
  WebRTC version defaults follow `core/src/realtime_conversation.rs`.
- `codex-rs/core/src/realtime_conversation{.rs,/existing_call.rs,/sideband.rs}`:
  selected subscription sideband headers, client-owned configuration, and v3
  reconnect backoff with stable-connection reset.
- `codex-rs/core/src/realtime_conversation/bem.rs` and the streamed-item reducer
  in `realtime_conversation.rs`: channel-prefix buffering, 200 ms flush pacing,
  and bounded Unicode-safe head/tail output. Native text-content updates feed this
  reducer; reasoning and tool-call content do not.
- `codex-rs/core/src/realtime_history.rs`: session boundary items, separate user
  and assistant transcript segments, streamed item deltas, and closure sealing.
- `codex-rs/core/src/realtime_context.rs` and `utils/string/src/truncate.rs`:
  the completed-output token budget, UTF-8 boundaries and truncation marker.
  Reference fixtures run the original pinned functions independently of xcsh.
- `codex-rs/app-server/src/bespoke_event_handling.rs`: handoff item notification
  with request identity and the active transcript; transcript consumption follows
  `codex-api/src/endpoint/realtime_websocket/methods.rs`.
- `codex-rs/app-server-protocol/schema/json/{ClientRequest,ServerRequest,ServerNotification}.json`:
  the literal method names retained in sanitized capture metadata.

Source: [pinned Codex remote transport](https://github.com/openai/codex/tree/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/app-server-transport/src/transport/remote_control)

Modifications: TypeScript/Bun implementation; xcsh identity and version; fixed
production endpoint; response size limit; no server-body diagnostics; bounded
relay retries; private xcsh-owned state and Unix socket session attachment.
