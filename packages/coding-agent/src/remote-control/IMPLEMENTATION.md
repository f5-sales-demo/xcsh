# Native remote control implementation

xcsh attaches remote clients to an existing `AgentSession`. The terminal session remains the
only executor and persistence owner; the remote host projects its state through the Codex-compatible
JSON-RPC surface.

## Voice architecture

Voice uses one internal OpenAI Live implementation:

- endpoint: `/v1/live`;
- model: `gpt-live-1-codex`;
- transports: a created WebRTC call, an existing-call sideband, or an API-key WebSocket;
- phone boundary: the literal `"v3"`, retained only because the iPhone protocol requires it.

There is no older internal voice generation, model fallback, or compatibility mapping. A created
call and its sideband share one session identity. Reconnection reattaches the same call and retains
the transcript accumulator; it does not emit a second start event.

Direct WebRTC media flows between OpenAI Live and the phone. xcsh receives the sideband events but
does not relay or gate the audio track. It can require delegation before a grounded answer through
the Live prompt and handoff protocol, but it cannot claim deterministic suppression of speech that
the provider sends directly to the phone.

## Transcript reconciliation

The in-memory transcript tail follows the current Codex V3 reducer:

- deltas append to the latest entry with the same role, even when speakers are interleaved;
- input-speech-start and response-created events start new utterances for their roles;
- a final replaces accumulated text only when it extends that text;
- completed and final-only utterances establish the next boundary;
- transcript state survives sideband reconnect;
- a handoff consumes the accumulated tail once and resets both role boundaries.

The tail retains at most 128 entries and 64 KiB. Persisted handoff identities provide at-most-once
submission across attachment recreation. Transcript text and handoff results stay in the owning
session; diagnostic records contain metadata only.

## Handoff safety

Voice handoffs use the existing turn start/steer path. Admission is serialized so each request sees
the current turn state, while accepted work continues concurrently and later speech can steer it.

OpenAI Codex provider failures may carry one optional internal `providerFailureCode`. The value is
accepted only when it is at most 128 characters and contains ASCII letters, digits, `.`, `_`, or
`-`. Only exact `misalignment_policy_violation` maps to the public turn value
`misalignmentPolicyViolation`.

That exact failure retires later handoffs for the current voice attachment. Already parsed or later
handoffs remain observable but cannot start another turn. Other provider failures emit the generic
voice error and leave later handoffs admissible. Provider messages and response bodies are never
copied into phone errors.

## Voice persona

The Live prompt is rendered from `remote-voice-live.md`. The snapshot contains only sorted active
tool names and an optional bounded history tail. It excludes the terminal system prompt, person
data, and tool descriptions. Phone preferences precede the final server-owned identity and
pronunciation section.

The accepted contract remains:

- written branding: `xcsh`;
- normal speech: “X-C-shell” / “ex-see-shell”;
- explicit spelling or repair: “X-C-S-H” / “ex-see-ess-aitch”;
- personal questions: acknowledge, delegate, and wait for the attached agent's result.

The local prompt budget is 8 KiB. Capability names, phone preferences, and history have independent
bounds so untrusted input cannot displace the final identity section.

## Privacy and ownership

Credentials, audio, pairing data, raw traces, personal answers, and effective prompts are not
written to repository evidence. Runtime files use the private remote-control state directory and
the existing session manager. Tests use synthetic identifiers and text.

See `PARITY.md` for the supported behavior, `ACCEPTANCE.md` for release gates, and `NOTICE.md` for
upstream provenance.
