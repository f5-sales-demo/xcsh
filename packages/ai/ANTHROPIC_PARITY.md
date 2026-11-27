# Anthropic 5.5 parity qualification

Issue [#5266](https://github.com/f5-sales-demo/xcsh/issues/5266) tracks source,
runner, release, installation, and interactive acceptance separately. The
implementation uses Anthropic SDK 1.14.0 and Bun 1.4.5. This document records
feature results observed on 2026-11-27; it does not declare full parity.

Reference revisions are `pi` commit
`123763696e9a25264981dbd5675de1bbd1f4f5da` and `oh-my-pi` commit
`eded751bee10cedac1df7ace6616b8d2cf121a8a`. The incremental JSON parser retains
its upstream attribution. Native API controls preserve provider semantics;
unsupported requests fail explicitly.

Public subscription authentication, discovery, callbacks, and inference execute
on Ubuntu. MacBook inference qualification uses the corporate gateway. The UAT
harness rejects public subscription execution on macOS and rejects inference
redirects or unexpected endpoint routes. Raw requests, response blocks, signed
history, credentials, and authentication links stay in private evidence.

## Feature matrix

“Passed” means a live request produced the required behavior. An HTTP success,
outbound field, catalog flag, mock, or skipped test alone does not qualify a
feature. Entries marked “all” cover Haiku, Sonnet, and Opus 5.5.

| Feature | Ubuntu Pro result | Corporate gateway result | Implementation and regression coverage |
| --- | --- | --- | --- |
| Current model catalog and five efforts | Passed, all | Passed, all | `current-anthropic-models.ts`, `model-thinking.ts`, `anthropic-model-discovery.test.ts` |
| Summarized/omitted thinking display | Passed, all | Passed, all | `anthropic-controls.ts`, `anthropic-current-controls.test.ts` |
| Explicit disabled thinking | Catalog support varies by model; separate live acceptance remains | Passed, all | `anthropic-current-controls.test.ts`; route metadata governs availability |
| JSON schema output | Passed, all | Passed, all | `anthropic-controls.ts`, UAT structured-output case |
| Strict automatic tool round trips | Passed, all | Passed, all | `anthropic-incremental-arguments.test.ts`, UAT tool-round-trip case |
| Forced tool choice | Haiku passed; Sonnet/Opus explicitly rejected | Sonnet/Opus unavailable | `anthropic-current-controls.test.ts`, `anthropic-fable.test.ts`; never substitute automatic selection |
| Task budgets | Passed, all | Rejected by gateway schema | `anthropic-current-controls.test.ts`, UAT task-budget case |
| Native thread continuation | Passed with withheld context, all | Withheld-context recall failed | `anthropic-threads.ts`, `anthropic-thread-continuity.test.ts`; proxy opt-in required |
| Signed server compaction and replay | Passed with withheld context, all | No positive signed summary | `anthropic-native-history.ts`, `anthropic-native-compaction.test.ts`, `anthropic-compaction-persistence.test.ts` |
| Native fetch and grounded citations | Passed, all | Passed, all | `anthropic-native-replay.test.ts`, UAT native-fetch-citation case |
| One-hour cache write/read reuse | Passed, all | Passed, all | `anthropic-native-refinements.test.ts`, UAT long-cache-reuse case |
| Midpoint system, effort, and tool redefinition | Passed, all | Inline definition rejected | `anthropic-native-refinements.test.ts`, UAT native-midpoint-settings case |
| Actual fast inference | Paid usage credits required; no positive acceptance | Standard speed returned | UAT fast-mode case rejects reduced speed |
| Native fallback handoff and served-model billing | No positive live handoff | Native object targets rejected | `anthropic-native-replay.test.ts`, `anthropic-native-refinements.test.ts`; mocks establish source behavior only |
| Signed thinking continuation | Passed, all | Separate live acceptance pending | `anthropic-controls.ts`, `anthropic-native-history.ts`; retain signatures in their original positions |
| Context edit effects | Passed with reported thinking removal and preserved recall, all | Separate live acceptance pending | `anthropic-controls.ts`; outbound fields alone are insufficient |
| Cancellation recovery | Passed with full-context thread recreation, all | Separate live acceptance pending | `anthropic-thread-continuity.test.ts`; cancellation consumes the prior anchor |
| Restart/resume and model switching | Installed interactive acceptance pending | Source terminal candidate passed; installed acceptance pending | `anthropic-session-controls.test.ts`, `model-selection-session.test.ts`; session controls omit credentials |

## Delivery gates

Runner source was delivered through
[self-hosted-runner PR #269](https://github.com/f5-sales-demo/self-hosted-runner/pull/269).
The published standard and container-build images passed tool and frozen
bootstrap qualification for recorded candidate trees. Publication does not prove
that a live runner uses those images.

Source package checks passed before the corpus refresh. The merged candidate
passes types, source-matched native readiness, shell audit, documentation checks,
and 83 focused provider, session, and corpus regressions. Final PR CI remains a
separate gate.

[docs-control PR #2733](https://github.com/f5-sales-demo/docs-control/pull/2733)
merged the scoped runner routing. The four xcsh runner scale sets now reference
the qualified immutable images, and a live standard runner reported Bun 1.4.5.
Manifest propagation and final job identity remain separate checks. Shared runner
profiles retain their existing compatibility.

Publication uses best-effort coverage for the credit-dependent fast and fallback
features. Synthetic fixtures verify their request controls, speed overrides,
handoff bookkeeping, and rejection of unhonored modes; live acceptance remains
unverified. Account and gateway capabilities still determine availability.

Release provenance, approved MacBook and Ubuntu installation paths, and installed
two-host reacceptance remain separate delivery checks. Describe the credit-dependent
features as synthetically tested rather than live-qualified.
