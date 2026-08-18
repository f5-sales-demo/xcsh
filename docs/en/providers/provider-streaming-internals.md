---
title: Provider Streaming Internals
description: Provider streaming implementation with SSE parsing, token counting, and backpressure handling.
sidebar:
  order: 2
  label: Streaming internals
---

This document describes how token and tool call streams from diverse LLM providers are normalized in `@f5-sales-demo/pi-ai` and propagated through `@f5-sales-demo/pi-agent-core` to `coding-agent` session events.

## End-to-end streaming architecture

1. **Stream dispatch**: `streamSimple()` in `packages/ai/src/stream.ts` maps provider-agnostic request options and dispatches them to the selected provider driver.
2. **Provider normalization**: Provider stream drivers (`anthropic.ts`, `openai-responses.ts`, `google.ts`) translate vendor-specific Server-Sent Events (SSE) into a unified `AssistantMessageEvent` stream.
3. **Event throttling**: `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`) buffers and coalesces rapid delta events (~50ms cadence) to smooth UI rendering.
4. **Agent loop consumption**: `agentLoop` (`packages/agent/src/agent-loop.ts`) processes events, updates in-flight message state, and emits `message_update` events.
5. **Session event integration**: `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) handles user aborts, automated retries, context compaction, and tool call execution guards.

## Unified stream contract (`AssistantMessageEvent`)

All provider drivers emit events conforming to the `AssistantMessageEvent` union:

- `start`: Initiates stream processing.
- Content block lifecycle triplets:
  - Text: `text_start` → `text_delta`* → `text_end`
  - Thinking / reasoning: `thinking_start` → `thinking_delta`* → `thinking_end`
  - Tool invocation: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- Terminal events:
  - `done`: Emits termination reasons (`stop`, `length`, `toolUse`).
  - `error`: Emits failure reasons (`aborted`, `error`).

## Provider-specific normalization logic

### Anthropic (`anthropic-messages`)

- Maps `message_start` to token usage metadata.
- Maps `content_block_start` and `content_block_delta` to unified text, thinking, and tool invocation blocks.
- Accumulates streamed JSON fragments in `partialJson` and reparses arguments incrementally via `parseStreamingJson()`.

### OpenAI Responses (`openai-responses`)

- Maps `response.output_item.added` to text or reasoning blocks.
- Maps `response.reasoning_summary_text.delta` to `thinking_delta`.
- Translates `response.function_call_arguments.delta` into `toolcall_delta`.
- Normalizes tool call identifiers into `<CALL_ID>|<ITEM_ID>`.

### Google Generative AI (`google-generative-ai`)

- Parses `candidate.content.parts`, distinguishing thinking blocks via `isThinkingPart()`.
- Emits synthetic `toolcall_delta` containing serialized JSON strings for structured tool call events.

## Tool call JSON accumulation and error recovery

Incremental tool arguments are parsed via `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`):

1. Attempts standard `JSON.parse`.
2. Falls back to partial JSON parsing to evaluate incomplete streamed fragments.
3. If partial parsing fails, returns `{}` temporarily until subsequent deltas provide valid JSON structures.
4. Performs a final parse pass on `toolcall_end`.

## Cancellation and lifecycle boundaries

- **Provider HTTP request**: `options.signal` aborts the active HTTP transport connection.
- **Agent loop**: Evaluates `signal.aborted` prior to processing each streamed event.
- **Session abortion**: Calling `AgentSession.abort()` propagates cancellations to active tool subprocesses.
- **Tool execution interrupts**: Tool runners listen to `AbortSignal.any([agentSignal, steeringAbortSignal])`, allowing users to interrupt long-running tools without discarding prior turns.

## Related implementation files

- `packages/ai/src/stream.ts`: Provider stream dispatcher and option normalizer.
- `packages/ai/src/utils/event-stream.ts`: Stream queueing and delta event throttling.
- `packages/ai/src/utils/json-parse.ts`: Incremental streaming JSON parser.
- `packages/ai/src/providers/anthropic.ts`: Anthropic SSE event transformer.
- `packages/ai/src/providers/openai-responses.ts`: OpenAI Responses event transformer.
- `packages/ai/src/providers/google.ts`: Google Gemini event transformer.
- `packages/agent/src/agent-loop.ts`: Agent event processing loop.
- `packages/coding-agent/src/session/agent-session.ts`: Session lifecycle, retry policies, and persistence.
