# Pinned protocol schemas

Unmodified OpenAI Codex JSON schemas from commit
`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a` (rust-v0.153.4):

- `codex-rs/app-server-protocol/schema/json/v1/InitializeResponse.json`
- `codex-rs/app-server-protocol/schema/json/v2/ThreadListResponse.json`
- `codex-rs/app-server-protocol/schema/json/v2/ThreadLoadedListResponse.json`
- `codex-rs/app-server-protocol/schema/json/v2/Thread{Turns,Items}ListResponse.json`
- `codex-rs/app-server-protocol/schema/json/v2/ConfigReadResponse.json`
- `codex-rs/app-server-protocol/schema/json/v2/ModelListResponse.json`
- `codex-rs/app-server-protocol/schema/json/v2/{SkillsList,FsReadFile}Response.json`
- `codex-rs/app-server-protocol/schema/json/v2/ThreadSettingsUpdatedNotification.json`
- `codex-rs/app-server-protocol/schema/json/v2/ThreadSetName{Params,Response}.json`
- `codex-rs/app-server-protocol/schema/json/v2/ThreadNameUpdatedNotification.json`
- `codex-rs/app-server-protocol/schema/json/v2/ThreadRealtime{Started,Closed,Error,TranscriptDelta,TranscriptDone}Notification.json`
- `codex-rs/app-server-protocol/schema/json/v2/ThreadRealtimeItem{Started,Completed,TranscriptDelta}Notification.json`

Copyright 2025 OpenAI. Apache-2.0; license and port notices are in
`../../../src/remote-control/`.

The four `{CommandExecution,FileChange}RequestApproval{Params,Response}.json`
fixtures reproduce the pinned schema JSON values. The repository copies have a
terminal newline; the source manifest pins the exact upstream byte hashes.

The unit tests use synthetic host/account/request identifiers. Live credentials,
pairing material, and session transcripts are never fixtures.

`ThreadTimelineListResponse.json` is extracted unchanged from
`codex-rs/app-server-protocol/schema/precomputed/app-server-exports-experimental.json.zst`,
under `json_schema["v2/ThreadTimelineListResponse.json"]`, at the same pinned commit.
The standard schema directory omits this experimental response. Its turn-boundary
and promoted-item variants incorrectly retain snake_case fields despite the Rust
`serde(rename_all_fields = "camelCase")` attribute. Tests keep the fixture intact
and apply an explicit naming correction to a copy for validation.

`codex-0.153.4-timeline-wire-shapes.json` records field names observed by querying
the existing reference Alpha/Beta histories over a separate local Unix WebSocket
app-server listener. The actual binary reports `codex-cli 0.153.4`. These read-only
responses confirm camelCase boundary fields; no speech or identity values are
retained. The temporary listener ran without a remote relay and was stopped after
the queries. Promoted-item field names follow the pinned Rust serialization and
remain unverified in live reference voice because the recorded calls did not
promote response items. This fixture is not a new iPhone conversation recording.

`codex-0.153.4-phone-recall.json` is a separate observed-event fixture from two
ordinary iPhone voice conversations against the pinned reference host. It selects
the phone's relay client, preserving delivery order without counting notifications
to another subscriber twice. Speech, SDP, and some protocol literals remain
redacted; identifiers are consistently renamed. The fixture records its source
snapshot SHA-256 and scope. Replay tests substitute synthetic speech chunks and
assert notification order against the recording and payloads against the upstream
schemas. They do not claim an exact replay of private speech or complete parity.

`codex-0.153.4-phone-bootstrap.json` extracts the ordered skill-root, catalog and
skill-file read sequence from the finalized reference host capture. It retains
only counts and field names for redacted paths and catalog entries. Router tests
use its observed nonempty root count; pinned response schemas validate the native
catalog and base64 payload separately.
