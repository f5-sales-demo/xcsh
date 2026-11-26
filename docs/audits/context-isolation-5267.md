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

## Remaining affected-user gate

Source delivery and a tested candidate do not establish installation repair. Further incident
attribution requires the affected version/platform and executable hash, a sanitized transcript
around the unexpected statement, session/workspace selection, relevant instruction/plugin/memory
provenance, and a private final-provider-request capture where available. Acceptance requires a
fresh capture from the repaired installed artifact showing correct ownership. Existing user sessions
and data were not changed by this audit.
