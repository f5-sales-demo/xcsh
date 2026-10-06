import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Agent } from "@f5-sales-demo/pi-agent-core";
import { type AssistantMessage, getBundledModel } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import { AgentSession } from "../src/session/agent-session";
import { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";

function assistant(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text, phase: "final_answer" }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

test("session stream with a split internal citation emits only the verified public URL", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "xcsh-public-citation-stream-"));
	const auth = await AuthStorage.create(path.join(root, "auth.db"));
	let session: AgentSession | undefined;
	try {
		auth.setRuntimeApiKey("anthropic", "test-key");
		const model = getBundledModel("anthropic", "claude-sonnet-4-5")!;
		const source = "See xcsh://documentation/community-f5-com/t/65170/index.md";
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: "Test", tools: [] },
			streamFn: () => {
				const stream = new AssistantMessageEventStream();
				queueMicrotask(() => {
					stream.push({ type: "start", partial: assistant("") });
					stream.push({ type: "text_start", contentIndex: 0, phase: "final_answer", partial: assistant("") });
					let soFar = "";
					for (const delta of ["See xc", "sh://documentation/community-f5-com/t/65170/", "index.md"]) {
						soFar += delta;
						stream.push({ type: "text_delta", contentIndex: 0, delta, partial: assistant(soFar) });
					}
					stream.push({
						type: "text_end",
						contentIndex: 0,
						phase: "final_answer",
						content: source,
						partial: assistant(source),
					});
					stream.push({ type: "done", reason: "stop", message: assistant(source) });
				});
				return stream;
			},
		});
		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated({ "compaction.enabled": false }),
			modelRegistry: new ModelRegistry(auth, path.join(root, "models.yml")),
		});
		const deltas: string[] = [];
		let completed = "";
		session.subscribe(event => {
			if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta")
				deltas.push(event.assistantMessageEvent.delta);
			if (event.type === "message_end" && event.message.role === "assistant")
				completed = event.message.content
					.filter(part => part.type === "text")
					.map(part => part.text)
					.join("");
		});
		await session.prompt("cite the source");
		expect(deltas.join("")).toBe("See https://community.f5.com/t/65170");
		expect(completed).toBe(deltas.join(""));
		expect(deltas.every(delta => !delta.includes("xcsh://"))).toBe(true);
		expect(
			session.messages.some(
				message =>
					message.role === "assistant" &&
					message.content.some(part => part.type === "text" && part.text === source),
			),
		).toBe(true);
	} finally {
		await session?.dispose();
		auth.close();
		await rm(root, { recursive: true, force: true });
	}
});
