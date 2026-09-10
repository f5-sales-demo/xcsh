# Pinned protocol schemas

Unmodified OpenAI Codex JSON schemas from commit
`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a` (rust-v0.153.4):

- `codex-rs/app-server-protocol/schema/json/v1/InitializeResponse.json`
- `codex-rs/app-server-protocol/schema/json/v2/ThreadListResponse.json`
- `codex-rs/app-server-protocol/schema/json/v2/Thread{Turns,Items}ListResponse.json`
- `codex-rs/app-server-protocol/schema/json/v2/ConfigReadResponse.json`
- `codex-rs/app-server-protocol/schema/json/v2/ModelListResponse.json`
- `codex-rs/app-server-protocol/schema/json/v2/ThreadSettingsUpdatedNotification.json`
- `codex-rs/app-server-protocol/schema/json/v2/ThreadRealtime{Started,Closed,Error,TranscriptDelta,TranscriptDone}Notification.json`
- `codex-rs/app-server-protocol/schema/json/v2/ThreadRealtimeItem{Started,Completed,TranscriptDelta}Notification.json`

Copyright 2025 OpenAI. Apache-2.0; license and port notices are in
`../../../src/remote-control/`.

The unit tests use synthetic host/account/request identifiers. Live credentials,
pairing material, and session transcripts are never fixtures.

`codex-0.153.4-phone-recall.json` is a separate observed-event fixture from two
ordinary iPhone voice conversations against the pinned reference host. It selects
the phone's relay client, preserving delivery order without counting notifications
to another subscriber twice. Speech, SDP, and some protocol literals remain
redacted; identifiers are consistently renamed. The fixture records its source
snapshot SHA-256 and scope. Replay tests substitute synthetic speech chunks and
assert notification order against the recording and payloads against the upstream
schemas. They do not claim an exact replay of private speech or complete parity.
