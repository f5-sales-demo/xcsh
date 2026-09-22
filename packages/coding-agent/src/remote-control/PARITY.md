# Remote voice parity

## Supported contract

| Area | xcsh behavior |
| --- | --- |
| Architecture | One OpenAI Live implementation shared by WebRTC, existing-call sideband, and API-key WebSocket |
| Live model | `gpt-live-1-codex` |
| Phone version | Literal `"v3"`; omitted/null selects the same implementation and other values are rejected |
| Execution | The attached `AgentSession` remains the sole executor and persistence owner |
| Transcript | Latest matching-role deltas, delayed-final protection, explicit utterance boundaries, reconnect continuity, bounded one-time handoff tail |
| Handoffs | Serialized admission with concurrent turn steering; exact misalignment failure retires later handoffs for that voice attachment |
| Persona | Tool names and bounded history only; no system prompt, person data, or tool descriptions |
| Pronunciation | “X-C-shell” normally; “X-C-S-H” only for spelling or repair; written form remains `xcsh` |
| Privacy | Sanitized metadata only; no audio, transcript evidence, credentials, pairing data, or personal answers |

## Targeted Codex comparison

The voice behavior was compared with OpenAI Codex `main` at commit
`c11ed24c2a1416fcae816af9127f350817371b2f` on 2026-09-21. The relevant source is:

- `codex-rs/codex-api/src/endpoint/realtime_websocket/methods.rs` and
  `transcript_tests.rs` for V3 transcript reconciliation, utterance boundaries, reconnect state,
  handoff-tail consumption, and bounds;
- `codex-rs/core/src/realtime_conversation.rs` for serialized handoff admission and per-session
  retirement;
- `codex-rs/core/src/session/turn.rs` for retirement on exact
  `MisalignmentPolicyViolation` only;
- `codex-rs/core/tests/suite/realtime_misalignment.rs` for suppression of a late voice handoff after
  that violation.

Earlier copied JSON schemas and sanitized replay fixtures retain their own pinned provenance. They
are protocol test inputs, not alternate runtime implementations.

## Deliberate boundary

xcsh controls the sideband, attached-agent work, and context returned to Live. It does not control
the direct WebRTC playback path from OpenAI to the iPhone. Therefore a successful personal-question
trial demonstrates observed routing behavior, not a proof that premature provider audio can never
occur.

Automated tests establish reducer, lifecycle, privacy, and wire behavior. Only a fresh physical
iPhone session establishes heard pronunciation and interaction acceptance.
