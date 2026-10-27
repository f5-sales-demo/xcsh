# Codex WebRTC controller adaptation

Source: openai/codex at 970111f6cb62cc02fe36a82ea7d71b37a2889c97,
codex-rs/realtime-webrtc/src. Copyright OpenAI, Apache-2.0.

Protocol, process actor, bounded queues, privacy transitions, environment admission,
message reader and helper diagnostics retain the pinned implementation and unit tests.
xcsh supplies an explicit package directory and expected immutable build revision;
Codex process-global install-context/build-info discovery is replaced with these inputs.
The process ownership primitive remains the exact pinned codex-utils-pty dependency.
The wire protocol and helper resource layout remain unchanged. No provider metadata
is added to helper frames. Runtime/hash qualification remains a separate requirement.

The controller now represents observed helper exit with an explicit enum rather
than nested Option values. Serde strict unit-variant decoding retains unknown-field
rejection with a documented narrow derive lint exception. Twenty-two controller
synthetic tests and the full Ubuntu Rust check pass at the development snapshot;
this does not qualify an installed application or physical audio.
