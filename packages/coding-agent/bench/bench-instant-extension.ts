/**
 * Bench-only pi extension: a deterministic "instant" LLM provider for the hermetic
 * TTFT benchmark. Registers a keyed `bench-instant` model whose stream emits a first
 * token immediately with zero network and no real credentials — so a headless worker
 * (with no real provider keys) selects it deterministically and a chat turn produces a
 * first `chat_delta` measuring only xcsh-controllable cost. Loaded via
 * XCSH_BENCH_EXTENSION → additionalExtensionPaths (see worker.ts); inert otherwise.
 */
import type { ExtensionAPI } from "@f5-sales-demo/xcsh";
import type { AssistantMessage, Context, Model } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";

function instantStream(model: Model<never>, _context: Context): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const output: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 1,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
  stream.push({ type: "start", partial: output });
  stream.push({ type: "text_start", contentIndex: 0, partial: output });
  stream.push({ type: "text_delta", contentIndex: 0, delta: "ok", partial: output });
  stream.push({ type: "text_end", contentIndex: 0, content: "ok", partial: output });
  stream.push({ type: "done", reason: "stop", message: output });
  stream.end();
  return stream;
}

export default function benchInstantExtension(pi: ExtensionAPI): void {
  pi.registerProvider("bench-instant", {
    api: "bench-instant" as Model["api"],
    apiKey: "BENCH_KEY",
    baseUrl: "http://localhost",
    streamSimple: instantStream as never,
    models: [
      {
        id: "bench-instant",
        name: "Bench Instant",
        api: "bench-instant" as Model["api"],
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
      },
    ],
  });
}
