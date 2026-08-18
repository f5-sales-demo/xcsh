---
title: Handoff Generation Pipeline
description: Handoff generation pipeline for creating portable session summaries for team collaboration.
sidebar:
  order: 8
  label: Handoff pipeline
---

The `/handoff` command generates a structured, portable Markdown summary of the current session and transfers active context into a newly initialized session.

## Command dispatch and validation

When you run `/handoff [instructions]`, the command controller executes the following validation checks:

1. **Input interception**: Intercepts `/handoff` before standard prompt processing.
2. **Preflight message validation**: Verifies that the active branch contains at least two message entries (`type: "message"`). If fewer messages exist, xcsh displays a warning indicating that insufficient history exists for handoff.

## Generation lifecycle and state transitions

1. **Prompt creation**: Synthesizes a structured extraction prompt requesting:
   - Goal and objective statement
   - Constraints and user preferences
   - Progress and completed milestones
   - Key architectural decisions
   - Critical technical context
   - Recommended next steps
2. **Completion capture**: Listens for the `agent_end` event and extracts all text blocks from the final assistant message.
3. **Session rollover**:
   - Flushes and closes the existing session (`sessionManager.flush()`).
   - Initializes a new session (`sessionManager.newSession()`).
   - Clears pending steering, follow-up, and retry message queues.
4. **Context reinjection**: Injects the captured summary as a `custom_message` entry (`customType: "handoff"`) into the new session.
5. **UI re-rendering**: Rebuilds the chat viewport with the injected handoff context and displays confirmation in the status area.

## Related implementation files

- `src/session/agent-session.ts`: `handoff()` orchestration, abort controller management, and context replacement.
- `src/session/session-manager.ts`: Session initialization, persistence flushing, and custom message appending.
- `src/modes/controllers/command-controller.ts`: Interactive `/handoff` command execution and UI error handling.
- `src/extensibility/slash-commands.ts`: Built-in slash command definitions.
