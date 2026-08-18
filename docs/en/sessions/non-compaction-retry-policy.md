---
title: Non-Compaction Auto-Retry Policy
description: Auto-retry policy for transient API failures outside the compaction path.
sidebar:
  order: 6
  label: Retry policy
---

# Non-compaction auto-retry policy

This document describes the retry policy for transient upstream API errors (such as rate limits, connection timeouts, and 5xx server errors) in `AgentSession`.

> [!NOTE]
> Context-window overflow errors are handled exclusively by the auto-compaction subsystem and are documented in [Compaction and branch summaries](../compaction/).

## Error classification

On turn completion (`agent_end`), `AgentSession.#isRetryableError()` evaluates assistant errors:

- **Retryable errors**: Overloaded servers, rate limits (HTTP 429), gateway timeouts (HTTP 502/503/504), network connection failures, or explicit retry-after headers.
- **Non-retryable errors**: Context-window overflow, authentication failures, client validation errors, or user-initiated aborts.

## Exponential backoff and retry lifecycle

When a retryable error occurs, the session coordinates recovery:

1. **Attempt verification**: Increments the internal retry counter (`#retryAttempt`). If `#retryAttempt > retry.maxRetries`, the retry sequence aborts and emits a terminal error.
2. **Backoff delay computation**: Calculates exponential backoff:
   $$\text{Delay} = \text{baseDelayMs} \times 2^{(\text{attempt} - 1)}$$
3. **Session notification**: Emits an `auto_retry_start` lifecycle event.
4. **Context cleanup**: Removes the failed assistant error message from runtime memory before retrying (the record remains in persistent disk history).
5. **Turn continuation**: Awaits the computed delay and triggers `agent.continue()`.

## Configuration settings

Configure auto-retry behavior in `config.yml` or settings:

| Setting | Default | Description |
| --- | --- | --- |
| `retry.enabled` | `true` | Enables automatic retries for transient upstream failures. |
| `retry.maxRetries` | `3` | Maximum consecutive retry attempts before failing permanently. |
| `retry.baseDelayMs` | `2000` | Initial exponential backoff delay in milliseconds. |

## Related implementation files

- `src/session/agent-session.ts`: Retry state machine, backoff scheduling, and `agent.continue()` dispatch.
- `src/config/settings-schema.ts`: Configuration schemas for retry policies.
- `src/modes/controllers/event-controller.ts`: Interactive TUI retry countdown indicators and escape cancellation.
- `src/modes/rpc/rpc-mode.ts`: RPC commands (`set_auto_retry`, `abort_retry`) and streamed lifecycle events.

