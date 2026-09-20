# Codex interaction parity evidence

Reference: OpenAI Codex `d6d43270bd791c41624fd3ee25a37e80a38d374e`.
Independent upstream files, original LICENSE and NOTICE, and SHA-256 hashes are retained in this directory. The test `coding-agent/test/codex-interaction-source.test.ts` verifies those hashes and compares fixed field instructions, plan instructions, action labels and fresh-context text against the source. Codex source is Apache-2.0; see LICENSE and NOTICE here.

Baseline repositories: xcsh `1fdeb1fe5f311e79fb2c2adcf15747d39217429e`, Chrome `1cdf28cf70e71f736ac80dd8455be4fd1c81c169`, Herdr `af2b66a58d723fa319fe14688bb52b3f6a2b4e03`.

Paths below are relative to `packages/` in xcsh, unless a repository is named. This ledger is in progress. Named tests are executable evidence, not a claim that outstanding live acceptance has passed.
This phase accepts xcsh core terminal/RPC/remote behavior, Herdr, and the existing voice question/reply transport. Chrome and Office UI work, Google/provider-matrix qualification, and pronunciation/persona/speech rendering changes are out of scope.

| Requirement | Implementation | Evidence / remaining gate |
| --- | --- | --- |
| Waiting schema, descriptions, normalization | coding-agent/src/tools/request-user-input.ts | codex-interaction-source.test.ts; request-user-input-contract.test.ts |
| Plan-only waiting availability, configurable Default | session/agent-session.ts; settings-schema.ts | interactive-mode-plan-review.test.ts; request-user-input-contract.test.ts |
| Async immediate acknowledgement and atomic admission | tools/request-user-input.ts; session/user-interactions.ts | request-user-input-contract.test.ts |
| Single completion owner, local and external validation | session/user-interactions.ts | interaction-parity.test.ts; user-interactions.test.ts |
| Stable identity and exactly-once receipts | session/user-interactions.ts; chat-ui/src/interactions/transport.ts | interaction-parity.test.ts; interaction-transport.test.ts |
| Blocking status and plan-decision status | remote-control/session.ts | remote-control/session.test.ts; `waitingOnUserInput` clears atomically at resolution |
| Highlighting and notes remain local until submission | chat-ui/src/interactions/question-form.ts | interaction-form.test.ts; interaction-panel.test.tsx |
| Choices plus user_note, alternatives, skipped confirmation | chat-ui/src/interactions/question-form.ts | interaction-form.test.ts; hook-editor.test.ts |
| Navigation, interruption, fixed nonblocking timer state | modes/components/request-user-input.ts; question-form.ts | interaction-form.test.ts; hook-editor.test.ts; live terminal key/paste/wrapping qualification outstanding |
| Secret input masking | modes/components/request-user-input.ts; chat-ui/src/interactions/QuestionCard.tsx | hook-editor.test.ts; interaction-panel.test.tsx; live terminal qualification outstanding |
| Terminal pending async access | slash-commands/builtin-registry.ts (/questions) | interaction-parity.test.ts; actual terminal acceptance outstanding |
| Conversation plan parsing and exact three actions | chat-ui/src/interactions/conversation-plan.ts; session/agent-session.ts | conversation-plan.test.ts; interactive-mode-plan-review.test.ts |
| Same-context implementation resumes transcript follow | chat-ui/src/components/Transcript.tsx; interactions/InteractionPanel.tsx | Transcript.test.tsx; interaction-panel.test.tsx; live terminal qualification outstanding |
| Fresh-context cancellation restores decision | session/agent-session.ts | interactive-mode-plan-review.test.ts |
| Plan mode grants no special file-write permission | tools/plan-mode-guard.ts | tools/conversation-plan-guard.test.ts |
| Browser and Office shared forms | chat-ui/src/interactions/InteractionPanel.tsx | implementation is retained for transparent inheritance; Chrome and Office UI acceptance is excluded from this phase |
| RPC and remote completion receipts | modes/rpc/rpc-mode.ts; remote-control/interactions.ts | interaction-parity.test.ts; remote-control/interaction-host.test.ts; live remote response qualification outstanding |
| Reconnect, remote original request and owner completion | remote-control/interactions.ts | remote-control/interaction-host.test.ts; remote-control/interactions.test.ts |
| Async structured history replay | remote-control/history.ts; remote-control/session.ts | remote-control/async-question-history.test.ts |
| Explicit resolution reasons and owner loss | session/user-interactions.ts | interaction-parity.test.ts; durable session-switch qualification outstanding |
| Voice mirroring and correlated replies | remote-control/session.ts; tools/request-user-input.ts | actual voice qualification outstanding |
| Protocol 25 and negotiated Herdr interaction capability | herdr/client.ts; Herdr schema/server.rs | herdr-terminal.test.ts; cross-host compatibility qualification outstanding |
| Herdr separate records, queued vs accepted delivery | Herdr agent_interaction.rs; coding-agent/src/herdr/interactions.ts | Herdr agent_interaction tests; herdr/interaction-bridge.test.ts |
| No answers/drafts in public Herdr records | Herdr agent_interaction.rs | queued_delivery_is_private_and_only_acknowledgement_accepts; journal_payload_cannot_contain_answers_or_local_drafts |
| Concurrent answers, restart, acknowledgements and stale owner | both shared completion owners | focused tests present; adversarial multi-client qualification outstanding |
| Ubuntu default OpenAI Sol UAT | shared tools and session owner | repetitive acceptance runs use `bun dev` with the personal OpenAI Sol route; internal LiteLLM, Google authentication, and provider-matrix qualification are excluded |
| Ubuntu supported core clients | xcsh and Herdr | live terminal, RPC/remote, voice, and Herdr qualification outstanding; Chrome and Office are excluded |

Completion issues: xcsh #4115 and #4131, Herdr #103. No official release is part of this change.
