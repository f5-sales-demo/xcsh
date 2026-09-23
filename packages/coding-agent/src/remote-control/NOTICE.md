# Upstream provenance

The remote-control wire contracts are derived from OpenAI Codex, copyright OpenAI, licensed under
Apache License 2.0. The accompanying `LICENSE` contains the license text.

## Current voice comparison

Voice completion behavior was compared with OpenAI Codex commit
`c11ed24c2a1416fcae816af9127f350817371b2f`:

- `codex-rs/codex-api/src/endpoint/realtime_websocket/methods.rs`;
- `codex-rs/codex-api/src/endpoint/realtime_websocket/transcript_tests.rs`;
- `codex-rs/core/src/realtime_conversation.rs`;
- `codex-rs/core/src/session/turn.rs`;
- `codex-rs/core/tests/suite/realtime_misalignment.rs`.

xcsh ports the transcript reconciliation, handoff admission, and exact misalignment-retirement
semantics into TypeScript. xcsh-specific limits, identity, prompt policy, privacy boundaries,
transport ownership, and `AgentSession` integration are modifications.

## Existing protocol material

The remote-control package also contains wire schemas, constants, and behavioral fixtures derived
from the pinned Codex releases identified in the fixture and reference-script READMEs. These cover:

- enrollment, selected subscription authentication, pairing, client listing, and relay framing;
- initialization, thread discovery and lifecycle, history/timeline paging, model and configuration
  discovery, process events, skills, file reads, permissions, and interactions;
- realtime request/notification shapes, history presentation, delegation rendering, bounded output,
  and mode-context transitions.

Copied schema fixtures remain unchanged. Sanitized capture fixtures preserve only protocol shape and
synthetic content. Reference generators verify their pinned source hashes before producing derived
expectations. None of these fixtures invokes Codex at runtime or introduces a second xcsh voice
implementation.

Source: <https://github.com/openai/codex>

Modifications: TypeScript/Bun implementation; xcsh identity and version; fixed production endpoint;
bounded buffers and retries; generic client-facing failures; private xcsh-owned state and Unix
socket attachment; single-Live clean-break behavior.
