# Codex interaction parity evidence

Current structured-question target: OpenAI Codex `ac9b5b8380517ded445b09dd3196d8d9e2ba3c59`.
The `questionParity` manifest section freezes licensed upstream bytes and SHA-256 hashes.
Original LICENSE and NOTICE remain in this directory; source is Apache-2.0.
Earlier fixture revisions are retained as historical source evidence and do not define current acceptance.

The previous Default-mode policy extension and unconditional async exposure are superseded.
Required Default input uses a concise plain-text question; optional waiting input uses the existing
opt-in. Async questions require a supported model catalog entry and root-thread identity.
Restricted tool lists remain authoritative across discovery and mode changes.

| Contract | Implementation | Evidence |
| --- | --- | --- |
| Schemas, model overrides, catalog/root gates | tools/request-user-input.ts; question-eligibility.ts; sdk.ts; agent-session.ts | Frozen source, question parity and discovery tests |
| Blocking metadata, empty answers, timer and resolution order | user-interactions.ts; remote-control/interactions.ts; RequestUserInputComponent | Contract tests and live optional waiting trace |
| Complete identical async items without waiting synthesis | agent-session.ts; remote-control/session.ts; interaction-router.ts | App-server trace, async history tests |
| Correlated reply identities and readable summaries | chat-ui/interactions/async-answer.ts; messages.ts | Exact Unicode/literal text and installed pane evidence |
| Authenticated ownership, receipts and replay | user-interactions.ts; remote-control; Herdr interactions | Concurrent, stale, duplicate, teardown and replay suites |
| Context exclusion across restoration | messages.ts; compaction/session handling | Frozen parity and restored history tests |
| Focus, typing, navigation, skip, interruption and drafts | AsyncQuestionComponent; extension-ui-controller.ts; /questions | Hook tests and live Herdr editor observations |
| Idle browser answer output | browser/chat-handler.ts; Chrome answer-continuation.ts | Failing-first regression and immutable Chrome sidebar |
| Shared client presentation | chat-ui; normal Chrome/VS Code vendoring; Office bundle | Component suites and installed client evidence |
| Voice speech and signaling | remote-control/session.ts; NativeVoice | Live subscription-created WebRTC, natural async item and transcript/audio |

Detailed artifact identities, test counts, live traces, deferrals and remaining gates are recorded in
[the acceptance record](question-parity/ACCEPTANCE.md). Source tests, published artifacts and installed
UI acceptance are distinct evidence. Excel, Word and PowerPoint installed verification is explicitly
deferred. No closed-source UI or physical-phone equivalence is claimed.
