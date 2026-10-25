# Native iPhone integration inventory

October 25, 2026 checkpoint for [issue #5070](https://github.com/f5-sales-demo/xcsh/issues/5070),
with a separate [WebRTC continuation #5071](https://github.com/f5-sales-demo/xcsh/issues/5071).
Read [the root handoff](../HANDOFF.md) for runtime provenance, verification and resume instructions.

## Full preserved scope

The tested baseline contains 63 private commits since common ancestor
`3fc47cd286894e4a73e06fc0259ff98601b8a68f`, changing 302 files (69,259 insertions and 44,626 deletions).
Generated API/corpus files account for much of the line count. This is substantial shared backend work.

| Owner surface | Preserved work |
| --- | --- |
| Agent runtime | Payload composition, ordered dependent execution, retry/fallback, active model/reasoning and plan-card persistence |
| AI providers/auth | Subscription credential storage lifetime, Codex retry/reasoning/schema handling, Anthropic retry budget and Google stop reasons |
| Native remote integration | Host enrollment/pairing QR, session/workspace/folder/file/settings/model handling, command execution and permission fencing |
| Lifecycle | Worker preflight, resource lifetime, controller replacement/recovery, systemd teardown, diagnostics and qualification scripts |
| Voice | Caller-first startup, identity and instruction ownership, subscription attachment compatibility, history/captions/mirroring/delegation, result/list/pronunciation fidelity and bounded retries |
| Plugin/context tools | Owner-aware cache reload, runtime dependencies, managed approvals, explicit authentication, plugin install-plan separation and service execution |
| Build/docs/UI | Dependencies, compiled voice smokes, verified corpus prerequisites, citations, source-boundary evidence and generated code presentation |

The publication is reconciled with main `f1d9af37538cfd0ab61dfdaab9a2314b25d337e4`. Current upstream
corpus pins/generated assets and governance remain authoritative. The local-marketplace test retains
main's isolated fixture setup; source-boundary evidence is regenerated against the reconciled source.
The workspace command launcher probes only a fixed read-only command before choosing its namespace setup.
On AppArmor hosts with unprivileged namespaces, privileges are relinquished before Bubblewrap. Hosts
requiring privileged namespace setup retain the original launcher. The command regression verifies UID/GID,
zero effective/permitted/bounding capabilities, no new privileges and unchanged filesystem/network fences.
This compatibility repair affects publication source only; the installed NUC executable is preserved.

Bun 1.4.2 remains the declared publication/CI toolchain; original qualification used 1.4.3.

Unpublished history contains personal host paths in qualification helpers and a fixture. Exact originals
remain in named private recovery refs and checksum-verified bundles. Public recovery refs contain sanitized
source snapshots based on main; they do not expose the private ancestry. Helpers now derive user paths from
the home directory and the fixture uses a synthetic workspace. No credential was found by the original
history secret scan. Protected governance files are unchanged.

## Native baseline and separate client

The native iPhone pairing is preserved. Native phone-owned creation receives the shared policy through
`experimental_realtime_ws_backend_prompt`; consumption by the phone remains unproven. Subscription
attachment sends no rejected behavioral append or replacement. API-key attachment retains bounded,
correlated instruction delivery. Filler control and factual context are separate from behavioral policy.

Native identity failed physically. Source/installed quiet-silence and automated xcsh-owned identity success
do not accept native voice. Historical #4406/#4408 reliability criteria, phone approval/KVM install-plan
and endurance remain unfinished. Preserve workspace-write/on-request.

The WebRTC prototype adds eight files under `scripts/qualification-cleanroom/owned-phone-client`:
`USAGE.md`, `app.css`, `app.js`, `icon.png`, `index.html`, `manifest.webmanifest`, `server.py`, and
`test_server.py` in the original snapshot, now `tests/qualification_cleanroom/test_owned_phone_client.py`. Its publication branch additionally declares isolated aiohttp tests and invokes the four
mocked regressions and JavaScript browser build through the existing `test:ts` CI entrypoint.
Both PRs target main, with WebRTC dependent on the baseline. New feature development is deferred.

## WebRTC compatibility requirement

Future WebRTC development uses the open-source [openai/codex](https://github.com/openai/codex)
repository as the compatibility reference and targets exactly **`gpt-live-1`**, the voice-to-voice model.
The reference inspected for this checkpoint is
[`970111f6cb62cc02fe36a82ea7d71b37a2889c97`](https://github.com/openai/codex/tree/970111f6cb62cc02fe36a82ea7d71b37a2889c97).
This is an inspected source pin, not a passed compatibility qualification. On resumption, review upstream
changes and explicitly record any replacement pin before implementing against it.

Trace the reference through `codex-rs/realtime-webrtc/src/session.rs`,
`codex-rs/codex-api/src/endpoint/realtime_call.rs`,
`codex-rs/app-server-protocol/src/protocol/v2/realtime.rs`, and the core realtime conversation and sideband
modules and their tests. Qualify owned call creation and SDP exchange, the host ChatGPT subscription
authentication route, session event parsing, backend delegation, interruption and provider-confirmed closure
against that exact revision. Keep provider credentials on the host and preserve `workspace-write/on-request`.
Do not infer subscription-route support from generic API examples or silently substitute another model.
The preserved historical harness contains `gpt-live-1-codex`; retain that evidence and verify the requested
`gpt-live-1` model selection in the future candidate. No new compatibility claim, feature development,
runtime installation or phone acceptance is authorized during this save checkpoint.

## Original baseline file inventory

This list inventories the original tested changes, including generated files. Reconciliation and privacy
repairs are described above and in the final PR diff; this is not an assertion that every original file
diff replaces newer upstream source.

- `.github/docs-quality/legacy-fidelity.json`
- `bun.lock`
- `docs/lifecycle-worker-preflight.md`
- `docs/remote-control-empty-host-settings.md`
- `docs/remote-control-qr.md`
- `package.json`
- `packages/agent/package.json`
- `packages/agent/src/agent-loop.ts`
- `packages/agent/src/agent.ts`
- `packages/agent/src/types.ts`
- `packages/agent/test/agent-loop.test.ts`
- `packages/agent/test/compose-on-payload.test.ts`
- `packages/agent/test/forced-tool-choice-retry.test.ts`
- `packages/ai/package.json`
- `packages/ai/src/auth-storage.ts`
- `packages/ai/src/providers/anthropic.ts`
- `packages/ai/src/providers/google-shared.ts`
- `packages/ai/src/providers/openai-codex-responses.ts`
- `packages/ai/src/types.ts`
- `packages/ai/test/anthropic-retry-budget.test.ts`
- `packages/ai/test/auth-storage-close.test.ts`
- `packages/ai/test/codex-plugin-optional-schema.test.ts`
- `packages/ai/test/codex-provider-retry-budget.test.ts`
- `packages/ai/test/codex-reported-reasoning.test.ts`
- `packages/ai/test/google-raw-stop-reason.test.ts`
- `packages/ai/test/responses-explicit-nonstrict.test.ts`
- `packages/chat-ui/package.json`
- `packages/chat-ui/src/markdown/code-presentation.generated.min.js`
- `packages/coding-agent/package.json`
- `packages/coding-agent/scripts/LIFECYCLE-UAT.md`
- `packages/coding-agent/scripts/generate-build-info.ts`
- `packages/coding-agent/scripts/lifecycle-uat-controller.ts`
- `packages/coding-agent/scripts/lifecycle-worker-inspection.ts`
- `packages/coding-agent/scripts/live-routing-baseline.ts`
- `packages/coding-agent/scripts/remote-reference/baseline.ts`
- `packages/coding-agent/scripts/remote-reference/codex-0.159.2.patch`
- `packages/coding-agent/scripts/remote-reference/install.ts`
- `packages/coding-agent/scripts/remote-reference/record.ts`
- `packages/coding-agent/scripts/remote-reference/source-manifest-0.153.4.json`
- `packages/coding-agent/scripts/remote-reference/source-manifest-0.159.2.json`
- `packages/coding-agent/scripts/voice-uat-controller.ts`
- `packages/coding-agent/src/cli.ts`
- `packages/coding-agent/src/cli/plugin-cli.ts`
- `packages/coding-agent/src/commands/manager-core.ts`
- `packages/coding-agent/src/commands/remote-control.ts`
- `packages/coding-agent/src/config/model-registry.ts`
- `packages/coding-agent/src/config/settings-schema.ts`
- `packages/coding-agent/src/extensibility/extensions/loader.ts`
- `packages/coding-agent/src/extensibility/plugins/marketplace/cache.ts`
- `packages/coding-agent/src/extensibility/plugins/marketplace/manager.ts`
- `packages/coding-agent/src/extensibility/plugins/marketplace/runtime-dependencies.ts`
- `packages/coding-agent/src/extensibility/plugins/marketplace/tree-digest.ts`
- `packages/coding-agent/src/integrations/registry.ts`
- `packages/coding-agent/src/integrations/setup.ts`
- `packages/coding-agent/src/internal-urls/api-catalog-index.generated.ts`
- `packages/coding-agent/src/internal-urls/api-spec-index.generated.ts`
- `packages/coding-agent/src/internal-urls/build-info-runtime.ts`
- `packages/coding-agent/src/internal-urls/documentation-assets.generated.ts`
- `packages/coding-agent/src/internal-urls/public-citation-destinations.generated.ts`
- `packages/coding-agent/src/internal-urls/terraform-documentation-assets.generated.ts`
- `packages/coding-agent/src/internal-urls/terraform-provider-pin.generated.ts`
- `packages/coding-agent/src/internal-urls/xcsh-protocol.ts`
- `packages/coding-agent/src/person-profile/machine-profile.ts`
- `packages/coding-agent/src/person-profile/service.ts`
- `packages/coding-agent/src/prompts/internal-urls/about.md`
- `packages/coding-agent/src/prompts/internal-urls/active-model.md`
- `packages/coding-agent/src/prompts/system/plan-mode-active.md`
- `packages/coding-agent/src/prompts/system/remote-voice-capabilities.md`
- `packages/coding-agent/src/prompts/system/remote-voice-input.md`
- `packages/coding-agent/src/prompts/system/remote-voice-listening-reminder.md`
- `packages/coding-agent/src/prompts/system/remote-voice-live.md`
- `packages/coding-agent/src/prompts/system/remote-voice-mode-end.md`
- `packages/coding-agent/src/prompts/system/remote-voice-mode-start.md`
- `packages/coding-agent/src/prompts/system/remote-voice-plan-result.md`
- `packages/coding-agent/src/prompts/system/remote-voice-pronunciation.md`
- `packages/coding-agent/src/prompts/system/remote-voice-result.md`
- `packages/coding-agent/src/prompts/system/remote-voice-runtime.md`
- `packages/coding-agent/src/prompts/tools/enter-plan-mode.md`
- `packages/coding-agent/src/prompts/tools/plan-mode-persistence-result.md`
- `packages/coding-agent/src/prompts/tools/xcsh-api.md`
- `packages/coding-agent/src/prompts/tools/xcsh-context.md`
- `packages/coding-agent/src/prompts/tools/xcsh-plugin.md`
- `packages/coding-agent/src/remote-control/bridge.ts`
- `packages/coding-agent/src/remote-control/command-exec.ts`
- `packages/coding-agent/src/remote-control/config-write.ts`
- `packages/coding-agent/src/remote-control/control.ts`
- `packages/coding-agent/src/remote-control/file-search.ts`
- `packages/coding-agent/src/remote-control/folder-picker.ts`
- `packages/coding-agent/src/remote-control/history.ts`
- `packages/coding-agent/src/remote-control/host.ts`
- `packages/coding-agent/src/remote-control/lifecycle-uat-controller.ts`
- `packages/coding-agent/src/remote-control/live-routing-qualification.ts`
- `packages/coding-agent/src/remote-control/managed-extension-ui.ts`
- `packages/coding-agent/src/remote-control/managed-sessions.ts`
- `packages/coding-agent/src/remote-control/managed-worker.ts`
- `packages/coding-agent/src/remote-control/metadata.ts`
- `packages/coding-agent/src/remote-control/pairing-presentation.ts`
- `packages/coding-agent/src/remote-control/pairing.ts`
- `packages/coding-agent/src/remote-control/router.ts`
- `packages/coding-agent/src/remote-control/session-voice-history.ts`
- `packages/coding-agent/src/remote-control/session.ts`
- `packages/coding-agent/src/remote-control/startup-manager.ts`
- `packages/coding-agent/src/remote-control/supervisor.ts`
- `packages/coding-agent/src/remote-control/task-settings.ts`
- `packages/coding-agent/src/remote-control/trace.ts`
- `packages/coding-agent/src/remote-control/turn-file-diff.ts`
- `packages/coding-agent/src/remote-control/voice-audio-evidence.ts`
- `packages/coding-agent/src/remote-control/voice-call.ts`
- `packages/coding-agent/src/remote-control/voice-caption-branding.ts`
- `packages/coding-agent/src/remote-control/voice-diagnostics.ts`
- `packages/coding-agent/src/remote-control/voice-handoff.ts`
- `packages/coding-agent/src/remote-control/voice-persona.ts`
- `packages/coding-agent/src/remote-control/voice-pronunciation.ts`
- `packages/coding-agent/src/remote-control/voice-protocol.ts`
- `packages/coding-agent/src/remote-control/voice-result-fidelity.ts`
- `packages/coding-agent/src/remote-control/voice-socket-diagnostic.ts`
- `packages/coding-agent/src/remote-control/voice-socket.ts`
- `packages/coding-agent/src/remote-control/voice-standalone.ts`
- `packages/coding-agent/src/remote-control/voice-startup-policy.ts`
- `packages/coding-agent/src/remote-control/voice-tls-keylog.ts`
- `packages/coding-agent/src/remote-control/voice-uat-controller.ts`
- `packages/coding-agent/src/remote-control/voice-uat-systemd.ts`
- `packages/coding-agent/src/remote-control/voice.ts`
- `packages/coding-agent/src/remote-control/workspace-file-read.ts`
- `packages/coding-agent/src/remote-control/ws-diagnostic.d.ts`
- `packages/coding-agent/src/sandbox/containment.ts`
- `packages/coding-agent/src/sandbox/remote-permissions.ts`
- `packages/coding-agent/src/sandbox/session-fence.ts`
- `packages/coding-agent/src/sdk.ts`
- `packages/coding-agent/src/services/context-execution.ts`
- `packages/coding-agent/src/services/plugin-workflow.ts`
- `packages/coding-agent/src/services/xcsh-context.ts`
- `packages/coding-agent/src/session/active-model.ts`
- `packages/coding-agent/src/session/agent-session.ts`
- `packages/coding-agent/src/session/realtime-context.ts`
- `packages/coding-agent/src/session/voice-operation-retry.ts`
- `packages/coding-agent/src/session/voice-tool-retry.ts`
- `packages/coding-agent/src/slash-commands/builtin-registry.ts`
- `packages/coding-agent/src/terraform-smoke-checks.ts`
- `packages/coding-agent/src/tools/enter-plan-mode.ts`
- `packages/coding-agent/src/tools/find.ts`
- `packages/coding-agent/src/tools/grep.ts`
- `packages/coding-agent/src/tools/index.ts`
- `packages/coding-agent/src/tools/machine-profile.ts`
- `packages/coding-agent/src/tools/person-profile.ts`
- `packages/coding-agent/src/tools/read.ts`
- `packages/coding-agent/src/tools/xcsh-api.ts`
- `packages/coding-agent/src/tools/xcsh-context.ts`
- `packages/coding-agent/src/tools/xcsh-plugin.ts`
- `packages/coding-agent/src/utils/plugin-registration-owner.ts`
- `packages/coding-agent/src/voice-failure-smoke.ts`
- `packages/coding-agent/src/voice-policy-smoke.ts`
- `packages/coding-agent/src/voice-pronunciation-smoke.ts`
- `packages/coding-agent/src/voice-result-smoke.ts`
- `packages/coding-agent/src/voice-startup-admission-smoke.ts`
- `packages/coding-agent/src/voice-startup-smoke.ts`
- `packages/coding-agent/test/agent-session-retry-fallback.test.ts`
- `packages/coding-agent/test/agent-session-routing-rejection.test.ts`
- `packages/coding-agent/test/browser/extension-bridge.test.ts`
- `packages/coding-agent/test/bundled-codex-reasoning.test.ts`
- `packages/coding-agent/test/codex-interaction-source.test.ts`
- `packages/coding-agent/test/context-execution-snapshot.test.ts`
- `packages/coding-agent/test/enter-plan-mode.test.ts`
- `packages/coding-agent/test/evidence/source-boundary-audit-v1/audit.json`
- `packages/coding-agent/test/evidence/tui-implementation-ledger.json`
- `packages/coding-agent/test/internal-urls/plugin-discovery-guidance.test.ts`
- `packages/coding-agent/test/internal-urls/xcsh-protocol.active-model.test.ts`
- `packages/coding-agent/test/internal-urls/xcsh-protocol.test.ts`
- `packages/coding-agent/test/manager-core.test.ts`
- `packages/coding-agent/test/marketplace/plugin-dry-run.test.ts`
- `packages/coding-agent/test/marketplace/runtime-dependencies.test.ts`
- `packages/coding-agent/test/plan-mode/plan-card-persistence-prompt.test.ts`
- `packages/coding-agent/test/plugin-cache-owner-reload.test.ts`
- `packages/coding-agent/test/plugin-workflow-environment.test.ts`
- `packages/coding-agent/test/plugin-workflow-extension-environment.test.ts`
- `packages/coding-agent/test/plugin-workflow-service.test.ts`
- `packages/coding-agent/test/profile-isolation.test.ts`
- `packages/coding-agent/test/progressive-context-loading.test.ts`
- `packages/coding-agent/test/remote-control/cold-crash-outcome.test.ts`
- `packages/coding-agent/test/remote-control/command-exec.test.ts`
- `packages/coding-agent/test/remote-control/command.test.ts`
- `packages/coding-agent/test/remote-control/config-write.test.ts`
- `packages/coding-agent/test/remote-control/durable-history.test.ts`
- `packages/coding-agent/test/remote-control/file-search.test.ts`
- `packages/coding-agent/test/remote-control/fixtures/FsCreateDirectoryParams.json`
- `packages/coding-agent/test/remote-control/fixtures/FsCreateDirectoryResponse.json`
- `packages/coding-agent/test/remote-control/fixtures/FsGetMetadataParams.json`
- `packages/coding-agent/test/remote-control/fixtures/FsGetMetadataResponse.json`
- `packages/coding-agent/test/remote-control/fixtures/FsReadDirectoryParams.json`
- `packages/coding-agent/test/remote-control/fixtures/FsReadDirectoryResponse.json`
- `packages/coding-agent/test/remote-control/fixtures/README.md`
- `packages/coding-agent/test/remote-control/fixtures/managed-extension-approval.fixture.ts`
- `packages/coding-agent/test/remote-control/fixtures/startup-self-dialogue.json`
- `packages/coding-agent/test/remote-control/folder-picker.test.ts`
- `packages/coding-agent/test/remote-control/host.test.ts`
- `packages/coding-agent/test/remote-control/interaction-host.test.ts`
- `packages/coding-agent/test/remote-control/interaction-router.test.ts`
- `packages/coding-agent/test/remote-control/interaction-teardown.test.ts`
- `packages/coding-agent/test/remote-control/lifecycle-state.test.ts`
- `packages/coding-agent/test/remote-control/lifecycle-uat-controller.test.ts`
- `packages/coding-agent/test/remote-control/lifecycle-workers.test.ts`
- `packages/coding-agent/test/remote-control/lifecycle.test.ts`
- `packages/coding-agent/test/remote-control/live-routing-qualification.test.ts`
- `packages/coding-agent/test/remote-control/managed-extension-approval.test.ts`
- `packages/coding-agent/test/remote-control/managed-sessions.test.ts`
- `packages/coding-agent/test/remote-control/managed-worker-cwd.test.ts`
- `packages/coding-agent/test/remote-control/managed-worker.test.ts`
- `packages/coding-agent/test/remote-control/pairing-presentation.test.ts`
- `packages/coding-agent/test/remote-control/pairing-slash.test.ts`
- `packages/coding-agent/test/remote-control/pairing.test.ts`
- `packages/coding-agent/test/remote-control/plan-history.test.ts`
- `packages/coding-agent/test/remote-control/realtime-context.test.ts`
- `packages/coding-agent/test/remote-control/realtime-session.test.ts`
- `packages/coding-agent/test/remote-control/reference-baseline.test.ts`
- `packages/coding-agent/test/remote-control/refresh-storage-lifetime.test.ts`
- `packages/coding-agent/test/remote-control/router.test.ts`
- `packages/coding-agent/test/remote-control/session-voice-history.test.ts`
- `packages/coding-agent/test/remote-control/session.test.ts`
- `packages/coding-agent/test/remote-control/shutdown.test.ts`
- `packages/coding-agent/test/remote-control/supervisor-process.test.ts`
- `packages/coding-agent/test/remote-control/supervisor.test.ts`
- `packages/coding-agent/test/remote-control/task-settings.test.ts`
- `packages/coding-agent/test/remote-control/trace.test.ts`
- `packages/coding-agent/test/remote-control/turn-file-diff.test.ts`
- `packages/coding-agent/test/remote-control/voice-audio-evidence.test.ts`
- `packages/coding-agent/test/remote-control/voice-call.test.ts`
- `packages/coding-agent/test/remote-control/voice-caller-first-startup.test.ts`
- `packages/coding-agent/test/remote-control/voice-caption-branding.test.ts`
- `packages/coding-agent/test/remote-control/voice-caption-delivery.test.ts`
- `packages/coding-agent/test/remote-control/voice-creation-policy.test.ts`
- `packages/coding-agent/test/remote-control/voice-diagnostics.test.ts`
- `packages/coding-agent/test/remote-control/voice-existing-call-initialization.test.ts`
- `packages/coding-agent/test/remote-control/voice-existing-policy.test.ts`
- `packages/coding-agent/test/remote-control/voice-history.test.ts`
- `packages/coding-agent/test/remote-control/voice-identity.test.ts`
- `packages/coding-agent/test/remote-control/voice-input-guidance.test.ts`
- `packages/coding-agent/test/remote-control/voice-instruction-delivery.test.ts`
- `packages/coding-agent/test/remote-control/voice-instructions.test.ts`
- `packages/coding-agent/test/remote-control/voice-live.test.ts`
- `packages/coding-agent/test/remote-control/voice-mirroring.test.ts`
- `packages/coding-agent/test/remote-control/voice-persona.test.ts`
- `packages/coding-agent/test/remote-control/voice-policy-before-caller.test.ts`
- `packages/coding-agent/test/remote-control/voice-policy-smoke.test.ts`
- `packages/coding-agent/test/remote-control/voice-pronunciation.test.ts`
- `packages/coding-agent/test/remote-control/voice-recovery.test.ts`
- `packages/coding-agent/test/remote-control/voice-response-items.test.ts`
- `packages/coding-agent/test/remote-control/voice-result-fidelity.test.ts`
- `packages/coding-agent/test/remote-control/voice-socket-diagnostic.test.ts`
- `packages/coding-agent/test/remote-control/voice-socket.test.ts`
- `packages/coding-agent/test/remote-control/voice-startup-policy.test.ts`
- `packages/coding-agent/test/remote-control/voice-subscription-bootstrap.test.ts`
- `packages/coding-agent/test/remote-control/voice-tls-keylog.test.ts`
- `packages/coding-agent/test/remote-control/voice-uat-controller.test.ts`
- `packages/coding-agent/test/remote-control/voice-uat-systemd.test.ts`
- `packages/coding-agent/test/remote-control/voice.test.ts`
- `packages/coding-agent/test/remote-control/workspace-file-read.test.ts`
- `packages/coding-agent/test/sandbox-session-fence.test.ts`
- `packages/coding-agent/test/scripts/dependency-install-state.test.ts`
- `packages/coding-agent/test/scripts/release-npm-backfill.test.ts`
- `packages/coding-agent/test/scripts/self-repository-harness.test.ts`
- `packages/coding-agent/test/scripts/terraform-index-delivery.test.ts`
- `packages/coding-agent/test/scripts/voice-policy-release-smoke.test.ts`
- `packages/coding-agent/test/sdk-about-reasoning.test.ts`
- `packages/coding-agent/test/session/active-model.test.ts`
- `packages/coding-agent/test/system-prompt-preparation.test.ts`
- `packages/coding-agent/test/terraform-documentation-smoke.test.ts`
- `packages/coding-agent/test/voice-operation-retry.test.ts`
- `packages/coding-agent/test/voice-tool-retry.test.ts`
- `packages/coding-agent/test/xcsh-api-tool.test.ts`
- `packages/coding-agent/test/xcsh-context-tool.test.ts`
- `packages/coding-agent/test/xcsh-plugin-tool.test.ts`
- `packages/coding-agent/tui-readability-evidence.json`
- `packages/natives/package.json`
- `packages/office-pane/package.json`
- `packages/resource-management/package.json`
- `packages/stats/package.json`
- `packages/typescript-edit-benchmark/package.json`
- `packages/utils/package.json`
- `scripts/check-installed-dependencies.ts`
- `scripts/ci-release-build-binaries.ts`
- `scripts/qualification-cleanroom/README.md`
- `scripts/qualification-cleanroom/arm_adapter.py`
- `scripts/qualification-cleanroom/capture_finalization.py`
- `scripts/qualification-cleanroom/close_adapter.py`
- `scripts/qualification-cleanroom/host_rpc.py`
- `scripts/qualification-cleanroom/nonce_origin.py`
- `scripts/qualification-cleanroom/observer.py`
- `scripts/qualification-cleanroom/runner.py`
- `tests/qualification_cleanroom/test_capture_finalization.py`
- `tests/qualification_cleanroom/test_nonce_origin.py`
- `tests/qualification_cleanroom/test_runner.py`
- `tests/qualification_cleanroom/test_startup_evidence.py`
- `tests/qualification_cleanroom/test_voice_ab.py`
- `scripts/qualification-cleanroom/voice_ab.py`
- `scripts/qualification-cleanroom/voice_ab_capture.py`
- `scripts/qualification-cleanroom/voice_ab_live.py`
- `scripts/qualification-cleanroom/voice_ab_network.py`
- `scripts/qualification-cleanroom/voice_ab_seal.py`
- `scripts/voice-policy-smoke-output.ts`
- `tools/corpus-sources.json`
- `tools/spec-release.json`
- `tools/terraform-documentation-release.json`
