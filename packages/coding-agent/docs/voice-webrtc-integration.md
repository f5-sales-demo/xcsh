# GPT-Live WebRTC integration candidate

This branch is an implementation candidate. Synthetic source, helper and transport checks
do not establish subscription media, delegation or physical client acceptance. No baseline
installation or native pairing is replaced.

## Ownership and connection

AgentSession remains the backend execution owner. SelectedChatVoice attaches an existing
selected session through the WebSocket or stdio chat bridge; it does not create a thread or
change backend model, workspace, permissions or registered host tools. Voice and typed input
use the RemoteSession admission path and persisted selected-session records.

VoiceCoordinator grants one audio lease per selected chat. Chat identity, voice-session
identity, client identity, provider call identity and interaction revision remain distinct.
A second client requires the current lease revision for explicit takeover. Replacement waits
for provider-confirmed closure of the previous owned call. Unconfirmed closure retains the
lease and requires reconciliation. Known request rejections and failures before
request dispatch admit no provider call and release the lease after cleanup.
Transport or response uncertainty retains ownership; no automatic creation retry
is performed. Rejected takeovers retain the adapter's previous voice
reference so stop and disposal can still reach that call.

The owned subscription request explicitly selects gpt-live-1. Public API documentation uses
POST /v1/live/sessions with project-key authentication. The pinned subscription implementation
uses Codex subscription-route semantics; public examples alone do not qualify that route.
A supported response without a model echo can pass request/route/call-binding evidence.
Conflicting returned model evidence fails. No alternate model or API-key fallback is admitted
for the owned subscription path.

## Activation and controls

The terminal exposes /voice discovery and start, stop, mute, unmute, pause, resume,
interrupt, devices and companion controls. Mac and Linux terminals use the packaged native
helper; SSH and headless terminals offer companion audio. Devices discovery and selection
are not fully implemented and must not be presented as accepted.

The browser obtains microphone permission only after activation. Office and VS Code use a
selected-session companion while retaining the parent panel connection and host tools.
Chrome also supports direct browser WebRTC. The companion serves the canonical chat UI with
typing, transcript, interaction and voice controls, HTTPS and its own application credential.
Provider credentials remain on the execution host.

Mute disables input; pause suppresses output while preserving input for resume; interrupt
suppresses current playback while backend work continues. Stop ends voice and preserves
chat/tasks. Backend cancellation uses the existing turn owner. Playback-based Speaking and
interaction announcement receipts require further synthetic calibration and physical proof.

## Native package and isolated settings

Qualification produces explicitly labeled voice-development artifacts without
embedding licensed Corporate Vertex client inputs. Ordinary release builds retain
their licensed-input gate. Backend model selection remains with AgentSession;
runtime authentication is a separate requirement.

Build Mac arm64 artifacts on the approved CI runner. Do not invoke Xcode or build native
artifacts on the managed Mac. Linux x64 artifacts require their own runtime qualification.

The runtime preparation script verifies pinned source, archives, SDK and runtime inventories.
Assembly binds the helper build identity to the application source, refuses an existing output
path, validates runtime bytes and copies hash-verified upstream notices and licenses. The
packaged-helper verification additionally checks architecture and runtime provenance,
then initializes and closes the copied helper with no inherited SDK loader paths. Its
raw capture stays private and a sanitized receipt joins the artifact. The
N-API entrypoint verifies package hashes and the same-build handshake before microphone
activation. Final qualified artifacts require a clean committed xcsh revision; a native C
reference stamp is not an application-source receipt.

Isolated candidate settings are XCSH_VOICE_PACKAGE_DIR and XCSH_VOICE_PACKAGE_SHA256.
Companion TLS and endpoint settings are XCSH_VOICE_COMPANION_CERT,
XCSH_VOICE_COMPANION_KEY, XCSH_VOICE_COMPANION_BIND and
XCSH_VOICE_COMPANION_PUBLIC_HOST. Use separate state, service, socket, HTTPS endpoint and
connection credentials for candidates. Keep credentials, connection links, SDP, audio and raw
traces private.

## Verification and remaining requirements

Credential-free checks include bun run check:ts, bun run check:rs, bun run test,
bun run check:docs-quality and pre-commit/privacy checks. Packaging rejection tests run with
bun test scripts/assemble-voice-package.test.ts. The native qualification workflow additionally
runs controller/helper tests, explicit relocated-runtime and installed-client tests, builds
the application/helper and assembles a package. CI must exercise that actual entrypoint.

Vendor digests use an explicit sha256 algorithm label; self-verification also
reads historical bare digests and still rejects changed bytes. This prevents
source filenames such as tokens.ts from making a checksum look like a credential.

The original reference is openai/codex at
970111f6cb62cc02fe36a82ea7d71b37a2889c97. The crate UPSTREAM.md files record adaptations.
No updated reference has been adopted.

Remaining gates include complete device selection; stronger questions/plans and simultaneous
UI/speech integration coverage; startup, suspension and uncertain-mutation recovery;
selected-branch transcript durability; calibrated announcement playback; Mac permission/signing
behavior; green draft PR CI across all three repositories; immutable isolated installations;
subscription media/delegation/interruption experiments; and physical acceptance on Mac,
Ubuntu, Safari/iPhone Home Screen, Office, VS Code and Chrome.

Require two fresh captured iPhone calls, with the second at least twenty minutes. A failed
physical case needs a changed validated candidate before a new trial. Record tested duration
separately if engine replacement is not observed. No physical trial is currently armed.
