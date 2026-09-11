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
- `protocol.rs`, `websocket.rs`, `client_tracker.rs`, `segment.rs`: relay headers,
  framing, sequence cursors, acknowledgements, and chunk transport. The protocol
  and segment sources are pinned directly in the reference manifest.
- `codex-rs/app-server-protocol`: initialization, thread, turn, and item wire shapes.
- `codex-rs/app-server/src/request_processors/thread_processor.rs` and
  `codex-rs/thread-store/src/local/thread_history/segment_paging.rs`: history
  page defaults, summary projections, exclusive continuation and inclusive
  reverse anchors. Native cursors additionally bind the session and filter scope.
- `codex-rs/app-server-protocol/src/protocol/v2/{item,notification}.rs`:
  tool-question, command-approval and file-approval request/answer fields, plus
  server-request resolution fields. Corresponding
  JSON schema fixtures are copied without changes from the pinned source. The
  terminal answer broker, tool-call binding and host routing are native xcsh code.
- `codex-rs/app-server/src/request_processors/thread_lifecycle.rs` and
  `app-server-protocol/src/protocol/v2/thread.rs`: pending-request retirement before
  unload and the `thread/closed` notification. Its schema fixture is unchanged.
- `codex-rs/app-server-protocol/src/protocol/item_builders.rs`: file-change
  conversion, raw add/delete contents, rename suffix and UTF-8 path ordering.
  The fixture generator executes the original converter functions with local
  type adapters; its input source is checked by SHA-256.
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
- `codex-rs/app-server/src/request_processors/{catalog_processor,fs_processor}.rs`
  and `app-server-protocol` v2 skill/file schemas: skill-root change signaling,
  per-cwd catalogs and base64 file reads. Native reads are confined to skills
  already loaded by a live terminal session.
- `codex-rs/app-server-protocol/src/protocol/v2/thread.rs` and
  `app-server/src/request_processors/thread_processor.rs`: trimmed thread-name
  mutation, empty response and global name-update notification. The three
  corresponding schema fixtures are copied unchanged from the pinned source.

- `codex-rs/app-server-protocol/src/protocol/v2/realtime.rs`: voice requests and notifications.
- `codex-rs/codex-api/src/endpoint/realtime_websocket/{methods,methods_v2,methods_frameless_bidi,protocol_common,protocol_v1,protocol_v2,protocol_frameless_bidi}.rs`:
  standalone and existing-call URLs, session updates, 500-byte context chunks,
  transcript/delegation/control events, audio input, and v2 function outputs.
- `codex-rs/codex-api/src/endpoint/realtime_call.rs`: subscription WebRTC call creation,
  backend JSON request, AVAS query parameters, answer SDP and call identities.
- `codex-rs/codex-api/src/endpoint/realtime_websocket/{methods_v1,methods_common}.rs`:
  v1 call and sideband session shapes and completed agent-message prefix. Native
  WebRTC version defaults follow `core/src/realtime_conversation.rs`.
- `codex-rs/core/src/realtime_conversation{.rs,/existing_call.rs,/sideband.rs}`:
  selected subscription sideband headers, client-owned configuration, and v3
  reconnect backoff with stable-connection reset.
- `codex-rs/core/src/realtime_conversation.rs`: standalone API-key authentication,
  v1/v2/v3 defaults, v2 user/backend prefixes, response-create serialization,
  background-agent completion/steering acknowledgements, silence handling, and
  output-audio truncation when new speech begins.
- `codex-rs/core/src/realtime_conversation.rs` and
  `core/src/context/realtime_{start_with_instructions,end_instructions}.rs`:
  optional backing mode instructions, UTF-8 estimated-token validation and
  developer-role priority. Native callback serialization protects session state.
- `codex-rs/core/src/session/turn_context.rs`, `session/turn.rs` and
  `context/world_state/{realtime.rs,mod.rs}`: turn-scoped voice activity and
  retained-fragment transition semantics, ported into `../session/realtime-context.ts`.
  Default text is copied from `codex-rs/prompts/templates/realtime/realtime_{start,end}.md`
  into `../prompts/system/remote-voice-mode-{start,end}.md`. The unchanged Rust
  realtime section snapshot is included as `codex-0.153.4-realtime-context.snap`
  in the test fixtures; its SHA-256 is
  `ee2065fecd5379cfe6585afdb68364adf0afc337e8d9552330fdc6384bf8a086`.
  Native custom-message identities retain the observed boolean state; context
  updates use xcsh's existing agent event and persistence pipeline.
- `codex-rs/core/src/realtime_conversation/bem.rs` and the streamed-item reducer
  in `realtime_conversation.rs`: channel-prefix buffering, 200 ms flush pacing,
  and bounded Unicode-safe head/tail output. Native text-content updates feed this
  reducer; reasoning and tool-call content do not.
- `codex-rs/core/src/realtime_history.rs`: session boundary items, separate user
  and assistant transcript segments, streamed item deltas, and closure sealing.
  The native reducer also ports speech continuations, turn/call association,
  promotion deduplication and effect ordering. Pinned source SHA-256:
  `b8195c1b27caa58af63b9cb66d438ba36f3c4b642324825d2164a9a1ec61e36a`.
- `codex-rs/core/src/realtime_history/presentation.rs`: inline Markdown and
  visualization directives, Rust whitespace/line semantics, code fences and
  whole-item selection. The fixture generator compiles the original text selector
  and constants after verifying source SHA-256
  `511a037bdefd287b8dfaf965943881158d8d03a26e0e75dcfb28a172b066dd61`.
- `codex-rs/core/src/realtime_context.rs` and `utils/string/src/truncate.rs`:
  the completed-output token budget, UTF-8 boundaries and truncation marker.
  Reference fixtures run the original pinned functions independently of xcsh.
- `codex-rs/core/src/realtime_conversation.rs`: completed response-item delivery,
  BEM classification before prefixing, developer item role and double output
  budgeting. The response-item fixtures compile its original `realtime_backend_item`
  function with the pinned truncator/budget loop; the generator verifies all three
  source hashes before compiling. Native completed-output reduction shares limits
  and duplicate handling across legacy handoffs and response items.
- `codex-rs/app-server/src/bespoke_event_handling.rs`: handoff item notification
  with request identity and the active transcript; transcript consumption follows
  `codex-api/src/endpoint/realtime_websocket/methods.rs`.
- `codex-rs/app-server-protocol/schema/json/{ClientRequest,ServerRequest,ServerNotification}.json`:
  the literal method names retained in sanitized capture metadata.

Source: [pinned Codex remote transport](https://github.com/openai/codex/tree/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/app-server-transport/src/transport/remote_control)

Modifications: TypeScript/Bun implementation; xcsh identity and version; fixed
production endpoint; response size limit; no server-body diagnostics; bounded
relay retries; private xcsh-owned state and Unix socket session attachment.

- `codex-rs/apply-patch/src/file_update.rs` and its pinned `similar` 2.7.0 dependency:
  the independent native-diff fixture generator uses the original headerless,
  context-radius diff construction. Runtime diff generation uses xcsh's existing
  `similar` 3.1.1 native dependency, verified against those fixtures. No Codex
  source or executable is required at runtime.

- `codex-rs/core/src/context/realtime_delegation.rs` and
  `codex-rs/context-fragments/src/fragment.rs`: marked delegation rendering, XML
  escaping, 4096-byte field budgets, UTF-8 boundaries and transcript-tail source.
  The fixture generator verifies both source hashes and executes the original
  delegation implementation and default render method with local type adapters.
  The session-ended handoff instruction comes from `core/src/realtime_conversation.rs`.

- `codex-rs/core/src/session/turn.rs` and `core/src/session/mod.rs`: completed
  backing-message mirroring and the request-for-input context instruction.
  `codex-rs/protocol/src/request_user_input.rs` supplies the core event envelope,
  field names and omitted optional fields. `core/src/realtime_conversation.rs`
  and `codex-api/src/endpoint/realtime_websocket/methods_common.rs` supply
  standalone versus active handoff routing, including the v1 final-message prefix.
