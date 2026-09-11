# Pinned protocol schemas

Unmodified OpenAI Codex JSON schemas from commit
`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a` (rust-v0.153.4):

- `codex-rs/app-server-protocol/schema/json/v1/Initialize{Params,Response}.json`
- `codex-rs/app-server-protocol/schema/json/v2/Thread{List,Read,Resume}Response.json`
- `codex-rs/app-server-protocol/schema/json/v2/ThreadLoadedListResponse.json`
- `codex-rs/app-server-protocol/schema/json/v2/Thread{Turns,Items}ListResponse.json`
- `codex-rs/app-server-protocol/schema/json/v2/ConfigReadResponse.json`
- `codex-rs/app-server-protocol/schema/json/v2/ModelListResponse.json`
- `codex-rs/app-server-protocol/schema/json/v2/PermissionProfileList{Params,Response}.json`
- `codex-rs/app-server-protocol/schema/json/v2/{SkillsList,FsReadFile}Response.json`
- `codex-rs/app-server-protocol/schema/json/v2/ThreadSettingsUpdatedNotification.json`
- `codex-rs/app-server-protocol/schema/json/v2/ThreadSetName{Params,Response}.json`
- `codex-rs/app-server-protocol/schema/json/v2/ThreadNameUpdatedNotification.json`
- `codex-rs/app-server-protocol/schema/json/v2/ThreadStartedNotification.json`
- `codex-rs/app-server-protocol/schema/json/v2/ThreadRealtime{Started,Closed,Error,TranscriptDelta,TranscriptDone}Notification.json`
- `codex-rs/app-server-protocol/schema/json/v2/ThreadRealtimeItem{Started,Completed,TranscriptDelta}Notification.json`

Copyright 2025 OpenAI. Apache-2.0; license and port notices are in
`../../../src/remote-control/`.

The four `{CommandExecution,FileChange}RequestApproval{Params,Response}.json`
fixtures reproduce the pinned schema JSON values. The repository copies have a
terminal newline; the source manifest pins the exact upstream byte hashes.

`ThreadReadResponse.json` and `ThreadResumeResponse.json` are byte-for-byte
copies of the pinned source. Their SHA-256 values are
`a76583d07f6096fee33045da2dc9caed84d858f8f2d39b37bb38528dbaf32511` and
`a553d6b1eb66111ca556e22138017ec54fd07c3257dbd2d5ad97ad7660786345`.

`ThreadStartedNotification.json` is also a byte-for-byte copy. Its SHA-256 is
`d66a9b4563471c5fe99de18cb2bd3c83e7b6aac8deb0b0579406b3b7c74d7b35`.
It validates the replacement-thread announcement after a terminal session change.

`PermissionProfileListParams.json` and `PermissionProfileListResponse.json` are
also byte-for-byte copies. Their SHA-256 values are
`576d405f6c94cbde982a9f65c9301717043683b83ca35d564247907feb16b1b4` and
`4a290b5b9d47c2fc671033e22754671161bc563027ba387e861bd935398f0def`.

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
catalog and base64 payload separately. The fixture also retains the phone's
experimental capability and 56 exact notification opt-outs without reconstructing
their redacted method names. The pinned initialize schema validates the native
request shape independently.
