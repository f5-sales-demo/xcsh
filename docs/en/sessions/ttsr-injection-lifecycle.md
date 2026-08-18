---
title: TTSR Injection Lifecycle
description: TTSR (tool-use, tool-result, system-reminder) injection lifecycle for context management.
sidebar:
  order: 9
  label: TTSR injection
---

# TTSR injection lifecycle

Time Traveling Stream Rules (TTSR) monitor model token streaming in real time, detecting rule violations as text deltas arrive and interrupting generation before unwanted actions execute.

## Lifecycle workflow

```text
Stream chunks ──► TTSR monitor buffer ──► Regex rule check ──► Abort stream ──► Inject reminder ──► Retry turn
```

1. **Rule registration**: At session startup, `createAgentSession()` loads active `.claude/rules` and `.xcsh/rules` defining `ttsrTrigger` regex expressions.
2. **Streaming monitoring**: As assistant tokens stream in (`message_update`), xcsh appends text and tool call deltas to an in-memory buffer and tests them against active rule triggers.
3. **Stream interruption**: When a delta matches a registered trigger:
   - Sets `#ttsrAbortPending = true`.
   - Issues an immediate `agent.abort()` to halt token streaming.
   - Emits a `ttsr_triggered` lifecycle event.
4. **Context reminder injection**:
   - Depending on `contextMode`, either discards or retains the partial assistant output.
   - Injects a synthetic user turn formatted with the rule reminder (`ttsr-interrupt.md`).
   - Invokes `agent.continue()` to retry the completion turn under the newly injected guidance.

## Related implementation files

- `src/session/agent-session.ts`: Real-time streaming interception, abort orchestration, and retry dispatch.
- `src/export/ttsr.ts`: `TtsrManager` buffer handling, regex compilation, and repeat policy tracking.
- `src/prompts/system/ttsr-interrupt.md`: Template formatting system interrupts for retry prompts.
- `src/modes/controllers/event-controller.ts`: UI notification rendering during TTSR interventions.
