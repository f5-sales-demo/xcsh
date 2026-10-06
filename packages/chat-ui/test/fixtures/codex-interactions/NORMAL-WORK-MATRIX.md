# Normal-work question acceptance matrix

Issue: https://github.com/f5-sales-demo/xcsh/issues/4739

The live model prompts never name question tools and use automatic tool choice. Test inputs are synthetic; the Terraform scenario uses example.com and placeholders, with no tenant lookup or deployment. Source tests and live model checks are separate from installed client acceptance.

| Scenario | Required observation | Evidence |
| --- | --- | --- |
| Required sequential Terraform choices | Standard HTTP/HTTPS versus CDN, then HTTP versus automatic HTTPS; produce HCL after both submitted replies | Live OpenAI subscription GPT-6.1 Sol run; both correlated receipts accepted and both replies in model history |
| Required free-text input while idle | Ask release name, remain pending, resume from idle on Release Maple | Live model run; correlated receipt accepted |
| Fully specified control | Produce requested two sentences without questions | Live model run; no tools invoked |
| Independent work and unanswered input | Async tool returns immediately; independent work continues; silence and blank replies remain pending | normal-work-question-matrix.test.ts |
| Streaming and idle correlated replies | Retain item/question identity and deliver once | normal-work-question-matrix.test.ts; progressive-context-loading.test.ts |
| Final-poll race | Reply arriving at agent_end reaches the next model turn | agent-session-before-agent-start-attribution.test.ts; failed before guarded resume |
| Provider streaming boundary | Correlated replies defer to model boundary; ordinary live steering remains supported | agent/test/tool-discovery-continuation.test.ts; failed before boundary guard |
| Dismissal, free text and reopening | No default submission; retain local draft and pending request | user-interactions.test.ts; chat-ui/interaction-panel.test.tsx |
| Competing clients and duplicate receipts | One acceptance, identical retry succeeds, conflicting retry and stale identity fail | normal-work-question-matrix.test.ts; interaction-parity.test.ts |
| Reconnect and owner recovery | Existing request identity and owner receipts survive transport reconnect | remote-control/interaction-host.test.ts; remote-control/interactions.test.ts |
| Progressive/eager, resume, model changes and plugin refresh | Async tool available unless explicitly restricted | progressive-context-loading.test.ts |
| Plan/Default waiting availability | Waiting input retains Plan mode and configured Default opt-in | interactive-mode-plan-review.test.ts; request-user-input-contract.test.ts |
| Terminal drafts and pause | Presentation queue respects pauses and restores editor text | hook-editor.test.ts; user-interactions.test.ts |
| Readable summaries | Correlated JSON remains model-facing; display answer text | chat-ui/Transcript.test.tsx |
| macOS and Ubuntu source | Focused owner/boundary tests pass on both hosts | macOS 23 tests; Ubuntu focused and full TypeScript workspace checks |
| Chrome and VS Code | Shared sequential forms and receipts reach consumer UI | Chrome #656: 441 tests/types/build; VS Code #1639: 1371 tests/types/build plus forwarding regression tests |
| Office and RPC/remote | Shared form inheritance, existing question/reply contract | Office 436 tests; RPC/remote focused checks |
| Installed clients | Published immutable artifact and scenario repeated in terminal, Chrome, VS Code, Office, RPC/remote | Pending release and installed acceptance |

Public evidence excludes raw provider traces, answers from real users, credentials and encrypted reasoning. Private temporary synthetic traces retain timing and correlated replies for inspection.
