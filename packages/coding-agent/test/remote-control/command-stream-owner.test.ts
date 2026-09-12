import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { type AssistantMessage, getBundledModel } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { Settings } from "../../src/config/settings";
import { projectHistory } from "../../src/remote-control/history";
import { type Notification, RemoteSession } from "../../src/remote-control/session";
import { createAgentSession } from "../../src/sdk";
import { AuthStorage } from "../../src/session/auth-storage";
import { SessionManager } from "../../src/session/session-manager";

test.each([
	{ background: false, attached: true, exitCode: 0 },
	{ background: true, attached: true, exitCode: 0 },
	{ background: false, attached: false, exitCode: 0 },
	{ background: true, attached: false, exitCode: 0 },
	{ background: false, attached: false, exitCode: 7 },
	{ background: true, attached: false, exitCode: 7 },
])(
	"the actual owner preserves command output and history: %j",
	async ({ background, attached, exitCode }) => {
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
								arguments: {
									command: `printf first; sleep 0.1; printf second; exit ${exitCode}`,
									async: background,
								},
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
		let remote = attached ? new RemoteSession(session) : undefined;
		const events: Notification[] = [];
		const completed = Promise.withResolvers<Record<string, unknown>>();
		remote?.subscribe(event => {
			events.push(event);
			if (event.method === "item/completed" && (event.params.item as any).type === "commandExecution")
				completed.resolve(event.params.item as Record<string, unknown>);
		});
		try {
			if (remote)
				await remote.call("stream", "turn/start", {
					threadId: session.sessionId,
					input: [{ type: "text", text: "Run fixture" }],
				});
			else {
				await session.prompt("Run fixture");
				if (background) {
					const deadline = Date.now() + 3000;
					while (
						Date.now() < deadline &&
						!session.sessionManager
							.getBranch()
							.some(entry => entry.type === "custom_message" && entry.customType === "async-result")
					)
						await Bun.sleep(10);
				}
				remote = new RemoteSession(session);
			}
			const item = attached
				? await completed.promise
				: remote
						.history()
						.flatMap(turn => turn.items)
						.find(item => item.type === "commandExecution");
			expect(item).toBeDefined();
			if (!item) throw new Error("Missing command execution");
			expect(item).toMatchObject({
				status: exitCode === 0 ? "completed" : "failed",
				exitCode,
				aggregatedOutput: "firstsecond",
			});
			if (attached) {
				const deltas = events.filter(event => event.method === "item/commandExecution/outputDelta");
				expect(deltas.map(event => event.params.delta).join("")).toBe("firstsecond");
				expect(deltas.every(event => event.params.itemId === item.id)).toBe(true);
				expect(
					events.filter(event => event.method === "item/completed" && (event.params.item as any).id === item.id),
				).toHaveLength(1);
			}
			await session.dispose();
			const reopened = await SessionManager.open(session.sessionManager.getSessionFile()!);
			try {
				const stored = reopened
					.getBranch()
					.filter(entry => entry.type === "message" && entry.message.role === "toolResult");
				expect(stored.map(entry => (entry.type === "message" ? entry.toolExecution : undefined))).toEqual([
					{ kind: "command", cwd },
				]);
				const commands = projectHistory(session.sessionId, reopened.getBranch())
					.flatMap(turn => turn.items)
					.filter(item => item.type === "commandExecution");
				expect(commands).toHaveLength(1);
				expect(commands[0]).toEqual(item);
				expect(commands[0]).not.toHaveProperty("tool");
			} finally {
				await reopened.close();
			}
		} finally {
			remote?.dispose();
			await session.dispose();
			auth.close();
			await rm(cwd, { recursive: true, force: true });
		}
	},
	10000,
);
