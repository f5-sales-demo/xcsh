# iPhone V3 Live contract

This ledger freezes xcsh's iPhone voice boundary against
`openai/codex@e72da2b53805894878023d01949a25a082e0a5cb`. The official
[Realtime guide](https://developers.openai.com/api/docs/guides/realtime) defines the WebRTC and
WebSocket architecture. The pinned Codex source defines the app-server and Live wire behavior used
here.

Automated fixtures prove protocol behavior, not speaker playback. A physical-iPhone result must name
the app build and installed xcsh artifact hash and record only connection outcome, caption outcome,
heard-audio outcome, ordered event names, stage timings, and sanitized error codes. Never retain
audio, transcript text, SDP, credentials, local paths, or correlation salt.

## Contract matrix

| Boundary | Pinned source | xcsh owner and evidence | Status |
| --- | --- | --- | --- |
| `thread/realtime/listVoices` | `app-server/src/request_processors/turn_processor.rs:328-336` | `router.ts`; `voice.test.ts` router test | Matched |
| `thread/realtime/start` with WebRTC | `turn_processor.rs:278-285,1192-1270` | `session.ts`, `voice-call.ts`; WebRTC test | Matched |
| Existing-call start omits or sets `includeStartupContext: false` | `turn_processor.rs:1198-1219,1249-1253` | `voice-protocol.ts`; omitted/false tests | Fixed in #4394 |
| Existing-call client configuration remains untouched | `turn_processor.rs:1198-1225` | `voice.ts`; no-`session.update` test | Matched |
| V3 `outputModality: text` | `core/src/realtime_conversation.rs:1567-1573` | validators reject text; config tests | Non-applicable: pinned V3 is audio-only |
| `thread/realtime/appendText` and `appendSpeech` | `turn_processor.rs:298-316` | `session.ts`, `voice.ts`; append tests | Matched |
| `thread/realtime/appendAudio` | `turn_processor.rs:288-296` | `session.ts`, `voice.ts`; standalone audio tests | Matched; WebRTC audio stays on the media track |
| `thread/realtime/stop` | `turn_processor.rs:318-326` | `session.ts`, `voice.ts`; idempotence/reconnect tests | Matched |
| `thread/realtime/started`, `sdp`, `closed`, and `error` | `app-server/tests/suite/v2/realtime_conversation.rs` | `voice.ts`; startup, failure, and ordering tests | Matched |
| Item started/completed/transcript notifications | `app-server/tests/suite/v2/realtime_conversation.rs` | `voice-history.ts`, `voice-timeline.ts`; schema and replay fixtures | Matched |
| Live `session.started` and `session.updated` | `protocol_frameless_bidi.rs:15-18` | `voice-protocol.ts`, `voice-live.test.ts` | Fixed in #4394 |
| Live input/output transcript deltas and `turn.done` | `protocol_frameless_bidi.rs:20-26,48-70` | `voice-protocol.ts`, `voice.ts`; transcript/history tests | Matched |
| Live `delegation.created`, including empty input | `protocol_frameless_bidi.rs:73-94` | `voice-protocol.ts`, `voice.ts`; empty/de-duplication tests | Fixed in #4394 |
| Live `output_audio.delta` | `protocol_frameless_bidi.rs:19,38-45` | `voice-protocol.ts`, `voice.ts`; decoder test | Matched |
| Live `error` | `protocol_frameless_bidi.rs:28` | `voice.ts`; sanitized failure test | Matched |
| Outbound `session.context.append`, `delegation.context.append`, and `session.close` | `methods_frameless_bidi.rs` | `voice.ts`, `voice-handoff.ts`; output/reconnect tests | Matched |
| Unknown, malformed, duplicate, and oversized Live events | parser and transport limits above | `voice-protocol.ts`, `voice.ts`; diagnostic and bounds tests | Fixed in #4394 |
| Recorded-before-submission delegation crash | Codex routes a decoded handoff once through the backing session | two-phase journal plus stable `clientUserMessageId`; recovery test | Fixed in #4394 |
| Restored transcript/timeline and reconnect | app-server realtime integration tests | history, response-item, and recovery suites | Matched |

## Diagnostic stages

The relay trace inventory provides request/response latency for `thread/start` and
`thread/realtime/start`. Runtime records add content-free outcomes and durations for
authentication, call creation, SDP delivery, sideband attachment/retry, and the first recognized
Live event. The closure summary counts event types and these rejection reasons:
`invalidEnvelope`, `invalidPayload`, `unknownType`, `invalidJson`, and `droppedFrame`.

## Physical acceptance matrix

Run the same signed iPhone build, account, model, voice, and network against the pinned Codex
reference and the xcsh candidate. Capture new folderless, new selected-folder, existing chat,
voice-first, text-to-voice, interruption, transcript correction, reconnect, and controlled-failure
scenarios. Record the user's connection, caption, and heard-audio outcomes. These rows remain a
human-operated release gate until such a trace is attached to issue #4394; host-side replay cannot
certify media playback.
