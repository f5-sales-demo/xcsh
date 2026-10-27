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
is performed. A returned provider identity is retained even when its SDP answer
is missing, malformed, oversized or interrupted. Stop reconciles a known call
through its existing sideband using the original subscription identity; it does
not create another call or override a model. Rejected takeovers retain the adapter's previous voice
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
helper; SSH and headless terminals offer companion audio. Devices opens Cancel-first microphone, speaker and channel choices. Selection
uses exact names and rejects missing or ambiguous devices. Streams remain closed
until Start. Browser microphone selection uses an exact device constraint; speaker
selection uses supported client output controls, otherwise the system output.
Physical device behavior remains unaccepted.

The browser obtains microphone permission only after activation. Office and VS Code use a
selected-session companion while retaining the parent panel connection and host tools.
Chrome also supports direct browser WebRTC. The companion serves the canonical chat UI with
typing, transcript, interaction and voice controls, HTTPS and its own application credential.
Provider credentials remain on the execution host.

A companion admits at most four authenticated control connections and eight
client identities for its selected chat. Each connection registers its own
identities; targeted frames cannot reach another connection or an unauthenticated
socket. The chat coordinator still permits one audio client. A second client can
discover the current owner before capture and explicitly take over audio. Closing
an observer retires only its adapters and preserves the active client, parent
panel, registered host tools and backend work.

Mute disables input; pause suppresses output while preserving input for resume; interrupt
suppresses current playback while backend work continues. Stop ends voice and preserves
chat/tasks. Backend cancellation uses the existing turn owner. Playback-based Speaking and
interaction announcement receipts require further synthetic calibration and physical proof.

Owned-call Stop and takeover retain muted media while graceful close and any
known-call reconciliation drain. Pending sideband setup is cancelled before a
replacement attachment; closed notification follows the complete bounded attempt.
Browser and native clients display Closing, disable input/output and keep the
connection alive until that notification. Unconfirmed closure retains ownership.
A cancelled startup cannot destroy media that is still needed for reconciliation.

While a question, approval or plan remains pending, provider delegation cannot
replace a completed caller decision. Its interaction owner must resolve the prompt
before admitting another voice task. Backend work and typed input keep their existing owners.
A pinned delegation can commit caller input before the continuous input turn ends.
The control owner receives that committed input only when it matches observed caller text,
so a Resume control resolves before task admission. Interaction answers and approvals
still require a completed caller transcript; delegation cannot authorize them.
Resolved spoken answers are retained in durable history, excluded from tail resubmission,
and their repeated provider handoffs receive one retirement response per provider identity.

## Spoken decision eligibility

The xcsh interaction gate requires one current, non-secret prompt, its completed
assistant announcement and actual playback before a completed caller answer can
resolve it. An unrelated assistant acknowledgement can finish while the caller
is answering. It preserves an already-played announcement only while the owner,
workspace, request identity and revision still match. It cannot establish playback.
Assistant answer echoes and approval suggestions remain ineligible across later
acknowledgements. Partial, stale, ambiguous and secret responses retain their
existing rejection checks; concurrent UI and speech resolve through the same owner.

These are xcsh application adaptations, outside the pinned provider schemas.
A synthesized speech-first race exposed announcement loss at the prior candidate;
its failed private capture and confirmed cleanup remain preserved. Real-owner
regressions cover the revised gate. Changed-artifact subscription qualification
and physical audio acceptance remain separate requirements.

## Native package and isolated settings

Qualification produces explicitly labeled voice-development artifacts without
embedding licensed Corporate Vertex client inputs. Ordinary release builds retain
their licensed-input gate. Backend model selection remains with AgentSession;
runtime authentication is a separate requirement.

Build Mac arm64 artifacts on the approved CI runner. Do not invoke Xcode or build native
artifacts on the managed Mac. Linux x64 artifacts require their own runtime qualification.

The runtime preparation script verifies pinned source, archives, SDK and runtime inventories.
When Linux has its ALSA runtime but lacks development metadata, it projects that
existing OS library into a cache with verified architecture, version and byte hash.
The pre-generated Rust FFI requires no privilege change or system package install.
Assembly binds the helper build identity to the application source, refuses an existing output
path, validates runtime bytes and copies hash-verified upstream notices and licenses. The
packaged-helper verification additionally checks architecture and runtime provenance,
then initializes and closes the copied helper with no inherited SDK loader paths. Its
raw capture stays private and a sanitized receipt joins the artifact. Pinned macOS plugins retain
their plugins/ directory; Linux plugins retain lib/gstreamer-1.0/. Assembly accepts
those inventories while rejecting absolute paths, traversal and duplicates. The
N-API entrypoint verifies package hashes and the same-build handshake before microphone
activation. Final qualified artifacts require a clean committed xcsh revision; a native C
reference stamp is not an application-source receipt.

Qualification checks the checkout revision and clean source both before building and
after packaged verification. The voice workflow generates canonical documentation
indices on Linux and shares those pinned bytes with both native targets. The workflow
also shares native source inputs with their pinned hashes. Parent directories
are canonicalized for macOS temporary-directory aliases; direct file symlinks
remain rejected and every supplied input still requires its exact digest. Prebuilt
verification still enforces published digests; Mac SQLite regeneration
does not replace a pin. Compiled smoke tests use separate agent, config and cache
directories outside the checkout while retaining the host's home identity.

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

## Persisted call ownership

Before call creation, xcsh durably records a creation attempt in the selected chat.
Accepted provider identity retires that attempt; explicit rejection admits no call.
A fresh voice attachment refuses replacement until an explicit Stop reconciles
remaining identities using the original subscription account hash. Reconciliation preserves
the real account header and requires provider-confirmed closure before creating another call. Unknown attempts, malformed identities, conflicting records
and unconfirmed closure retain ownership and cannot silently retry creation. Recovery
opens no microphone, creates no provider call and admits no backend task.

Discovery exposes pending call ownership before microphone activation. The shared UI
offers End previous voice and disables Start until the owner confirms release. Automatic
media cleanup and disposal carry separate intent and cannot reconcile persisted calls.
An explicit Stop restores the selected chat closure owner even after process replacement;
a fork does not inherit its parent chat call.

Closure validation accepts the supported subscription event without a session or
model echo. When a session ID is supplied, it must match the accepted provider call;
a conflicting or malformed snapshot cannot release ownership. Array envelopes and
array usage are rejected. Duplicate terminal events preserve the first confirmed
usage receipt. These xcsh checks do not extend the pinned provider schema or change
the attachment route. The canonical browser and backend share this validator.
Data-channel closure requests owner finalization once; it cannot confirm ownership
release. Clients retain muted media until the owner completes its bounded drain.
Late startup events or data-channel loss during Closing cannot reactivate capture
or discard media that the owner still needs. If the bounded drain times out, local
media is released and call ownership remains pending until explicit reconciliation.

Reconciliation keeps existing backend work,
the selected model, permissions and registered host tools with AgentSession.

Qualification resolves the helper from the actual Cargo target directory, including
relative or external CARGO_TARGET_DIR overrides. The same-build probe still rejects
an older repository helper; changing build storage cannot bypass source identity.
