# Codex interaction parity evidence

Reference: OpenAI Codex `392f56a611c412b9b2eb1d9d4e59a3b42bee483a`.
Independent upstream files, original LICENSE and NOTICE, and SHA-256 hashes are retained in this directory. The test `coding-agent/test/codex-interaction-source.test.ts` verifies those hashes and compares fixed field instructions, plan instructions, action labels and fresh-context text against the source. Codex source is Apache-2.0; see LICENSE and NOTICE here.

Baseline repositories: xcsh `21e37118e1d9e4770f95425eff5316751ce03155`, Chrome `a8991f76cfd4303ffcf3e050b3d398d585b9d4dc`, Herdr `3bcb35bd83293939017201bb33f9399db52d66ea`.

Paths below are relative to `packages/` in xcsh, unless a repository is named. This ledger is in progress. Named tests are executable evidence, not a claim that outstanding live acceptance has passed.

| Requirement | Implementation | Evidence / remaining gate |
| --- | --- | --- |
| Waiting schema, descriptions, normalization | coding-agent/src/tools/request-user-input.ts | codex-interaction-source.test.ts; request-user-input-contract.test.ts |
| Plan-only waiting availability, configurable Default | session/agent-session.ts; settings-schema.ts | interactive-mode-plan-review.test.ts; request-user-input-contract.test.ts |
| Async immediate acknowledgement and atomic admission | tools/request-user-input.ts; session/user-interactions.ts | request-user-input-contract.test.ts |
| Single completion owner, local and external validation | session/user-interactions.ts | interaction-parity.test.ts; user-interactions.test.ts |
| Stable identity and exactly-once receipts | session/user-interactions.ts; chat-ui/src/interactions/transport.ts | interaction-parity.test.ts; interaction-transport.test.ts |
| Highlighting and notes remain local until submission | chat-ui/src/interactions/question-form.ts | interaction-form.test.ts; interaction-panel.test.tsx |
| Choices plus user_note, alternatives, skipped confirmation | chat-ui/src/interactions/question-form.ts | interaction-form.test.ts; hook-editor.test.ts |
| Navigation, interruption, fixed nonblocking timer state | modes/components/request-user-input.ts; question-form.ts | interaction-form.test.ts; hook-editor.test.ts; live key/paste/wrapping qualification outstanding |
| Terminal pending async access | slash-commands/builtin-registry.ts (/questions) | interaction-parity.test.ts; actual terminal acceptance outstanding |
| Conversation plan parsing and exact three actions | chat-ui/src/interactions/conversation-plan.ts; session/agent-session.ts | conversation-plan.test.ts; interactive-mode-plan-review.test.ts |
| Fresh-context cancellation restores decision | session/agent-session.ts | interactive-mode-plan-review.test.ts |
| Plan mode grants no special file-write permission | tools/plan-mode-guard.ts | tools/conversation-plan-guard.test.ts |
| Browser shared question/plan forms and drafts across replay | chat-ui/src/interactions/InteractionPanel.tsx | interaction-panel.test.tsx; Chrome's 441-test suite and real xcsh WebSocket integration passed; actual Chrome/Office UI acceptance outstanding |
| RPC and browser completion receipts | modes/rpc/rpc-mode.ts; browser/chat-handler.ts | Chrome bridge transport and real xcsh WebSocket integration passed; live response submission qualification outstanding |
| Reconnect, remote original request and owner completion | remote-control/interactions.ts | remote-control/interaction-host.test.ts; remote-control/interactions.test.ts |
| Async structured history replay | remote-control/history.ts; remote-control/session.ts | remote-control/async-question-history.test.ts |
| Explicit resolution reasons and owner loss | session/user-interactions.ts | interaction-parity.test.ts; durable session-switch qualification outstanding |
| Voice mirroring and correlated replies | remote-control/session.ts; tools/request-user-input.ts | actual voice qualification outstanding |
| Protocol 25 and negotiated Herdr interaction capability | herdr/client.ts; Herdr schema/server.rs | herdr-terminal.test.ts; cross-host compatibility qualification outstanding |
| Herdr separate records, queued vs accepted delivery | Herdr agent_interaction.rs; coding-agent/src/herdr/interactions.ts | Herdr agent_interaction tests; herdr/interaction-bridge.test.ts |
| No answers/drafts in public Herdr records | Herdr agent_interaction.rs | queued_delivery_is_private_and_only_acknowledgement_accepts; journal_payload_cannot_contain_answers_or_local_drafts |
| Concurrent answers, restart, acknowledgements and stale owner | both shared completion owners | focused tests present; adversarial multi-client qualification outstanding |
| Provider neutrality | shared tools and session owner | 2026-09-20 OpenAI and Anthropic live async-tool sessions emitted a structured open event, returned immediate `{"accepted":true}`, completed with `LIVE_ASYNC_OK`, and resolved the unsubmitted question as `owner_lost`; Google Vertex attempt could not start because both configured gcloud credentials require reauthentication |
| Mac and Ubuntu supported clients | all three repositories | live terminal/Chrome/Office/voice/Herdr qualification outstanding |

Delivery issues: xcsh #4105, Chrome #635, Herdr #101. No official release is part of this change.
