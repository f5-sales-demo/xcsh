# Assistant context isolation audit

Issue: [#5267](https://github.com/f5-sales-demo/xcsh/issues/5267). Audit date: 2026-11-26.

## Findings and acceptance

Four context-ownership defects were reproduced and repaired: colliding project-memory paths,
automatic session selection from colliding directories, terminal breadcrumbs pointing outside the
selected storage directory, and rules retained after workspace relocation. The published Linux
release reproduces the first two defects through captured HTTP provider requests.

The reported user's deadline incident remains unattributed. No affected transcript, installation
identity, or final request was supplied. The literal deadline was absent from the pre-change
prompt-template search and the verified release binary. Synthetic reproduction proves the ownership
defects; it does not establish which path caused that incident.

## Pinned baselines

| Layer                       | Identity                                                                   | Evidence                                                                    |
| --------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Current main at audit start | `ec792fe99dced76818f60d23f0e54404da6fc764`                                 | Fresh fetch and independent GitHub commit lookup                            |
| Latest stable release       | `v25.0.0`, source `8ac5b99624ef14da990e699fedced14a09fb6fa6`               | Release tag and downloaded provenance agree                                 |
| Published Linux binary      | SHA-256 `2aae853030d2e2dd510790291fe1ccce1a0a3756099b9d7a70e9dd3b946751a1` | Downloaded bytes match provenance and GitHub asset digest                   |
| Implementation candidate    | `cb73e550e6c8f2f40de639475a2c7a64f54339b5`                                 | Fresh detached build checkout, prescribed bootstrap, standard package build |
| Candidate binary            | SHA-256 `322dd3da7170b898cb43b858517cc30b8cc0d4dc474d94986b85e61d3872eafd` | Captured requests from the standalone built binary                          |

Raw captures, command logs, and artifacts remain in a private evidence directory outside Git. This
report contains synthetic markers and sanitized results only.

## Reproductions and changes

| Defect                               | Trigger and injection path                                                                                                | Repair and regression                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project memory collision             | `alpha-beta` and `alpha/beta` share a store. `getMemoryRoot` → `readMemorySummary` → SDK prompt rebuild → provider.       | Use SHA-256 of the resolved path under the selected agent directory. Provider capture verifies owner inclusion and unrelated-workspace exclusion.   |
| Automatic resume collision           | Shared legacy directories select another workspace’s newest file. Conversation and compaction context reach the provider. | Filter automatic selection and default listings by canonical header cwd. Reject missing ownership; retain explicit resume and fork semantics.       |
| Terminal breadcrumb storage mismatch | A reused terminal points to a session in another agent storage directory even when cwd matches.                           | Check directory and header ownership. A subprocess test seeds a foreign breadcrumb and verifies selection of the owned session.                     |
| Workspace rules retained             | A moved session retains old rule arrays and conditional streaming rules.                                                  | Reload current-workspace rules and clear prior streaming/injection state. Provider captures and conditional-rule checks verify old-rule retirement. |

History attributes the lossy memory encoding to `d0371feeef55f3127b73a1294d3b2dbd979c3a4a`. The
current relative session-directory encoding and unfiltered continuation are present in
`094a0c61e46f8864c753bbc7ce0cb391d4327eaf`; the automatic-selection path predates that change.
One-time always-apply rule injection is present in `82dfa4f26f835821f8d6bd1c03be7d437126325f`. These
are source-history attributions, not a bisected attribution of the user's incident.

Legacy memory directories are preserved without an automatic fallback read or copy: their names
cannot establish ownership. When database outputs belonging to the current cwd exist, ordinary
background consolidation regenerates the new directory once. An idempotence regression verifies
owned inputs, exclusion of another workspace's inputs, preservation of legacy files, and no second
consolidation after successful regeneration. If no owned outputs remain, the preserved legacy
summary requires ownership review before reuse.

No phrase filtering, public audit command, memory disablement, or prompt-prose migration was
introduced. An explicitly supplied `demo due in 23 hours` remains in its intended session, including
subsequent turns. A fresh session loses that conversation marker while continuing to receive its own
intentional project memory.

## Context-path coverage

| Context path                     | Source traced                                                                            | Result and verification boundary                                                                                                                                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static system policy             | `src/prompts/system/`, `src/system-prompt.ts`                                            | Markdown rendering; no reported deadline found in pre-change templates.                                                                                                                                                                                     |
| CLI and SDK overrides            | `src/main.ts`, `src/sdk.ts`                                                              | Operator-provided prompt text remains supported; synthetic explicit-deadline control passes.                                                                                                                                                                |
| Workspace and user instructions  | `src/capability/`, `src/discovery/`                                                      | Runtime cwd/home discovery; filesystem content caches use resolved paths. Existing preparation, discovery, and SDK tests cover these loaders.                                                                                                               |
| Rules                            | `src/sdk.ts`, `src/export/ttsr.ts`                                                       | Relocation defect reproduced and repaired; always-apply and conditional rules checked.                                                                                                                                                                      |
| Skills and plugins               | `src/extensibility/skills.ts`, `src/discovery/helpers.ts`                                | Prepared snapshots bind cwd; plugin summary caches bind home and project registry. No additional shared-content defect reproduced.                                                                                                                          |
| Extensions and tool descriptions | `src/extensibility/extensions/`, SDK tool metadata, `before_agent_start`                 | Explicit extension context is a supported injection path. Existing provider-boundary attribution and session-contract tests cover it; arbitrary installed extension behavior remains outside synthetic proof.                                               |
| Memory                           | `src/memories/`, `src/internal-urls/memory-protocol.ts`                                  | Full-path store identity, agent-directory isolation, owned regeneration, and voice summary routing checked.                                                                                                                                                 |
| Session restore and compaction   | `src/session/session-manager.ts`, `src/session/compaction/`                              | Owned automatic resume checked with persisted compaction context. Explicitly selected history remains intentional continuity.                                                                                                                               |
| Reused session objects           | SDK prompt rebuild and session lifecycle                                                 | Workspace move, fresh session, restored session, and terminal storage reuse exercised.                                                                                                                                                                      |
| Subagents                        | `src/task/executor.ts`                                                                   | Child sessions receive explicit parent context; prepared inputs validate cwd. No pooled conversation defect reproduced.                                                                                                                                     |
| Voice                            | `src/remote-control/voice-persona.ts`, `session-voice-history.ts`, memory summary reader | Startup context is bounded; history binds target object and session ID. Existing synthetic tests cover ownership; no phone or live voice acceptance claimed.                                                                                                |
| Retrieved context                | API/Terraform preflight, internal URLs, session message conversion                       | Current-session preflight and background-context attribution traced; no extra deadline source reproduced.                                                                                                                                                   |
| Release packaging                | `package.json` files allowlist, package and CI binary builders                           | Binary entrypoint follows static imports; root development configuration is outside the source-package allowlist. Published binary identity and actual HTTP captures verified separately. String scans alone do not prove absence of all generated content. |

Paths above are relative to `packages/coding-agent/` unless stated otherwise. Synthetic separate
agent directories model separate user stores; this audit does not replace operating-system access
controls.

## Verification results

- Prescribed `bash scripts/ci-bun-install.sh` and source-matched native preparation passed on Ubuntu
  with Bun 1.4.4.
- Focused regressions and session-manager tests: 140 passed, zero failed.
- `bun run check:ts`: passed, including package lint, prompt formatting, readability inventory, and
  TypeScript checks.
- Source-boundary inventory: regenerated after source changes; its three tests pass. The
  documentation authority ledger was regenerated after the conditional-rule source changed; the
  documentation contract and staged PII gate pass.
- Coding-agent package suite: 10,607 passed, 563 skipped, and two failures during the broad run. The
  source-inventory failure was repaired and its three tests pass. The separate extension-model CLI
  test exceeded its subprocess deadline during the broad run; both cases pass in an independent
  rerun (no test or timeout changes). PR CI is the final check for the delivered head.
- Published `v25.0.0` binary: owner memory present; unrelated workspace memory present; unrelated
  workspace history present. Separate-agent and explicit-deadline controls pass. These expected
  reproductions establish the release defects.
- Packaged candidate: all controls pass. Owned memory and intentionally resumed owner history remain
  present; unrelated workspace memory and history are absent; separate-user memory is absent; an
  explicit deadline remains present.

The provider harness uses a local synthetic OpenAI-compatible HTTP server. It records serialized
requests, exercises the actual CLI entrypoint, and keeps raw output private. It does not contact a
live model provider or repair an affected user's installation.

## Installation gate at source delivery

Source delivery and a tested candidate do not establish installation repair. Further incident
attribution requires the affected version/platform and executable hash, a sanitized transcript
around the unexpected statement, session/workspace selection, relevant instruction/plugin/memory
provenance, and a private final-provider-request capture where available. Acceptance requires a
fresh capture from the repaired installed artifact showing correct ownership. Existing user sessions
and data were not changed by this audit.

## Published MacBook acceptance

The selected published MacBook gate passed on 2026-11-27 for **v25.1.2**. The installed
Homebrew executable completed all 14 local request checks and all 14 live-model request and
response checks. Native `/move` passed eight local assertions and ten live-model assertions.
The original reported incident remains unattributed without its transcript; these results accept
the selected installation and synthetic isolation behavior.

### Publication and installation

Source [PR #5269](https://github.com/f5-sales-demo/xcsh/pull/5269) merged as
`66b8ddd7d7586efd286291da02de9a564b23db3d`, an ancestor of release commit
`6f544934cf3bf6861692848ea7d0a39fd420b5be`. Release preparation
[issue #5275](https://github.com/f5-sales-demo/xcsh/issues/5275) and
[PR #5276](https://github.com/f5-sales-demo/xcsh/pull/5276) bind that commit to
[v25.1.2](https://github.com/f5-sales-demo/xcsh/releases/tag/v25.1.2).
The tag, downloaded asset digests, Homebrew cask checksum, and installed version agree.

| File                       | SHA-256                                                            | Result                                                              |
| -------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Fresh Darwin ARM64 archive | `9b71b4bc91152557a3a5d5b7259e04d66ff56ce8f68f781ae5f07d66d4f1b511` | Matches GitHub asset digest and Homebrew cask checksum              |
| CLI                        | `eb1d74da2f1b459f4c1ec6fe1b08168039e9427347ef4fff6bb9402b962b216a` | Fresh archive, provenance, GitHub digest, and installed bytes match |
| Native addon               | `6ff97421d0cc379e1c39e76a9584a01f9dc1f4d95ecf335758f9abeaf7740075` | Fresh archive, provenance, GitHub digest, and installed bytes match |
| Provenance manifest        | `5a42dd12f314835c88dbe80b38f463eb034f28f9da250dcf07b90c936869033e` | Fresh download, archive manifest, and installed manifest match      |

All three archive payload files match the existing installation. The Homebrew symlink resolves
to its 25.1.2 CLI, which reports `xcsh/25.1.2`. CLI and native signatures verify. Executable,
native addon, and provenance hashes remain unchanged after acceptance testing. The existing
installation therefore counts without a reinstall.

The accepted [release CI](https://github.com/f5-sales-demo/xcsh/actions/runs/45934022431)
completed successfully at the pinned release commit. Every executed job passed, including
installation methods, immutable publication, and both Homebrew architecture checks.
The earlier source-PR [installation failure](https://github.com/f5-sales-demo/xcsh/actions/runs/45899668825/job/140182082884)
remains failed evidence: `Corpus download timed out`. It is preserved privately and is not the
accepted release baseline.

### Installed prompt results

| Boundary                    | Local serialized requests                                                                               | Live model responses                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Owned memory                | Owner marker present; legacy unowned marker absent                                                      | Owner code and explicit deadline returned                              |
| Colliding workspace paths   | Owner memory absent from unrelated workspace in two fresh processes                                     | All missing context fields returned `NONE`                             |
| Separate agent stores       | Owner memory absent from separate store in two fresh processes                                          | All missing context fields returned `NONE`                             |
| Explicit deadline           | Deadline remains in initial prompt and follow-up                                                        | Intended code and `demo due in 23 hours` returned                      |
| Intentional resume          | Selected conversation and deadline restored                                                             | Intended code and deadline returned                                    |
| Fresh session               | Prior conversation and deadline absent                                                                  | All missing context fields returned `NONE`                             |
| Unrelated automatic resume  | Another workspace's conversation absent                                                                 | All missing context fields returned `NONE`                             |
| Persisted compaction        | Owner summary restored; unrelated workspace and fresh session exclude it                                | Owner code, compaction code, and deadline returned only to owner       |
| Foreign terminal breadcrumb | Owned session selected; foreign session marker absent                                                   | Owned conversation code returned; foreign code absent                  |
| Native `/move`              | Old always-apply and conditional rules retired; destination rules loaded and conditional rule triggered | Current destination rule codes returned after the native reviewed move |

Live checks use the existing configured `litellm/gpt-6.1-sol` model at high reasoning through
`openai-responses`. Captured requests confirm the actual model ID, reasoning effort, and
`/openai/v1/responses` route. A local forwarding proxy records synthetic request bodies and actual
model replies without authorization headers. Local mock replies establish request construction;
the separate live checks establish observed model behavior. Unrelated prompts themselves never
contain the excluded marker.

Compaction tests seed a synthetic persisted compaction entry and restore it through the installed
executable. They verify restoration and ownership, without assessing compactor generation quality.
Native move tests drive the installed TUI, review the destination, confirm the move, verify the
updated session header, and exercise streaming conditional-rule injection. Existing conversation
continuity is preserved.

### Evidence and acceptance boundary

The [sanitized delivery receipt](context-isolation-5267-installed-receipt.json) records publication,
installation, before/after hashes, prompt results, CI links, and private capture hashes.
Raw requests, replies, terminal captures, fixture state, harness sources, and failed attempts remain
outside Git. Early harness configuration and timing failures were corrected and preserved.
A move between colliding legacy session-directory names was refused without overwrite; the accepted
rule-retirement move uses a distinct destination.

No runtime source repair or additional release was required for these accepted results.
Existing user sessions and workers were preserved, and Ubuntu's installed CLI was unchanged.
GitHub issue and documentation delivery operations ran through Ubuntu SSH.
