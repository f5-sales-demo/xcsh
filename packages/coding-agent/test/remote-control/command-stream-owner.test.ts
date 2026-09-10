import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { type AssistantMessage, getBundledModel } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { Settings } from "../../src/config/settings";
import { type Notification, RemoteSession } from "../../src/remote-control/session";
import { createAgentSession } from "../../src/sdk";
import { AuthStorage } from "../../src/session/auth-storage";

test.each([false, true])(
	"the actual owner streams all shell output through completion: background=%s",
	async background => {
		const cwd = await mkdtemp("/tmp/xcsh-command-stream-");
		const auth = await AuthStorage.create(":memory:");
		const model = getBundledModel("openai", "gpt-4o-mini")!;
		auth.setRuntimeApiKey(model.provider, "fixture-key");
		const { session } = await createAgentSession({
			cwd,
			agentDir: join(cwd, "agent"),
			authStorage: auth,
			model,
			toolNames: ["bash"],
			settings: Settings.isolated({
				"async.enabled": true,
				"compaction.enabled": false,
				"bash.autoBackground.enabled": false,
				"bashInterceptor.enabled": false,
			}),
			disableExtensionDiscovery: true,
			skills: [],
			rules: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
		});
		let calls = 0;
		session.agent.streamFn = () => {
			const stream = new AssistantMessageEventStream();
			const first = ++calls === 1;
			const message: AssistantMessage = {
				role: "assistant",
				content: first
					? [
							{
								type: "toolCall",
								id: "shell-stream",
								name: "bash",
								arguments: { command: "printf first; sleep 0.1; printf second", async: background },
							},
						]
					: [{ type: "text", text: "Done" }],
				api: model.api,
				model: model.id,
				provider: model.provider,
				stopReason: first ? "toolUse" : "stop",
				timestamp: Date.now(),
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			};
			queueMicrotask(() => {
				stream.push({ type: "start", partial: { ...message, content: [] } });
				stream.push({ type: "done", reason: first ? "toolUse" : "stop", message });
			});
			return stream;
		};
		const remote = new RemoteSession(session);
		const events: Notification[] = [];
		const completed = Promise.withResolvers<Record<string, unknown>>();
		remote.subscribe(event => {
			events.push(event);
			if (event.method === "item/completed" && (event.params.item as any).type === "commandExecution")
				completed.resolve(event.params.item as Record<string, unknown>);
		});
		try {
			await remote.call("stream", "turn/start", {
				threadId: session.sessionId,
				input: [{ type: "text", text: "Run fixture" }],
			});
			const item = await completed.promise;
			expect(item).toMatchObject({ status: "completed", exitCode: 0, aggregatedOutput: "firstsecond" });
			const deltas = events.filter(event => event.method === "item/commandExecution/outputDelta");
			expect(deltas.map(event => event.params.delta).join("")).toBe("firstsecond");
			expect(deltas.every(event => event.params.itemId === item.id)).toBe(true);
			expect(
				events.filter(event => event.method === "item/completed" && (event.params.item as any).id === item.id),
			).toHaveLength(1);
		} finally {
			remote.dispose();
			await session.dispose();
			auth.close();
			await rm(cwd, { recursive: true, force: true });
		}
	},
	10000,
);
