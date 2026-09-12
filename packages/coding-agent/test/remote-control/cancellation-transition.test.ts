import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { type AssistantMessage, getBundledModel } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { Settings } from "../../src/config/settings";
import * as executor from "../../src/exec/bash-executor";
import { type Notification, RemoteSession } from "../../src/remote-control/session";
import { createAgentSession } from "../../src/sdk";
import { AuthStorage } from "../../src/session/auth-storage";
import { SessionManager } from "../../src/session/session-manager";
import { BashTool } from "../../src/tools/bash";

test.each(["new", "fork", "resume", "timeout", "late", "dispose"])(
	"session %s waits for cancelled execution to settle in its original storage",
	async action => {
		const background = true;
		const entered = Promise.withResolvers<void>();
		const allowRegistration = Promise.withResolvers<void>();
		const originalExecute = BashTool.prototype.execute;
		const execute = spyOn(BashTool.prototype, "execute").mockImplementation(async function (
			this: BashTool,
			...args: Parameters<BashTool["execute"]>
		) {
			entered.resolve();
			if (action === "late") await allowRegistration.promise;
			return originalExecute.apply(this, args);
		});
		const release = Promise.withResolvers<void>();
		const running = Promise.withResolvers<void>();
		const mock = spyOn(executor, "executeBash").mockImplementation(async (_command, options) => {
			running.resolve();
			await release.promise;
			return {
				output: "cancelled output",
				exitCode: undefined,
				cancelled: options?.signal?.aborted ?? false,
				truncated: false,
				totalLines: 1,
				totalBytes: 16,
				outputLines: 1,
				outputBytes: 16,
			};
		});
		const cwd = await mkdtemp("/tmp/xcsh-command-stream-");
		const auth = await AuthStorage.create(":memory:");
		const model = getBundledModel("openai", "gpt-4o-mini")!;
		auth.setRuntimeApiKey(model.provider, "fixture-key");
		const { session } = await createAgentSession({
			cwd,
			agentDir: join(cwd, "agent"),
			authStorage: auth,
			model,
			toolNames: ["bash", "cancel_job"],
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
								arguments: { command: "printf first; sleep 30; printf second", async: background },
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
		const firstTurn = Promise.withResolvers<void>();
		remote.subscribe(event => {
			events.push(event);
			if (event.method === "turn/completed") firstTurn.resolve();
			if (event.method === "item/completed" && (event.params.item as any).type === "commandExecution")
				completed.resolve(event.params.item as Record<string, unknown>);
		});
		try {
			await remote.call("stream", "turn/start", {
				threadId: session.sessionId,
				input: [{ type: "text", text: "Run fixture" }],
			});
			if (action === "late") await entered.promise;
			else {
				await firstTurn.promise;
				await running.promise;
			}
			const originalId = session.sessionId;
			const originalFile = session.sessionFile!;
			let otherFile: string | undefined;
			if (action === "resume") {
				const other = SessionManager.create(cwd, join(cwd, "other"));
				other.appendMessage({ role: "user", content: "Other session", timestamp: Date.now() });
				other.appendModelChange(`${model.provider}/${model.id}`);
				await other.flush();
				otherFile = other.getSessionFile()!;
				await other.close();
			}
			let changed = false;
			const change = (
				action === "new" || action === "timeout" || action === "late"
					? session.newSession()
					: action === "fork"
						? session.fork()
						: action === "dispose"
							? session.dispose()
							: session.switchSession(otherFile!)
			).then(result => {
				changed = true;
				return result ?? true;
			});
			if (action === "late") {
				await Bun.sleep(20);
				allowRegistration.resolve();
				await running.promise;
			}
			await Bun.sleep(20);
			expect(changed).toBe(false);
			expect(session.sessionId).toBe(originalId);
			if (action === "timeout") {
				await expect(change).rejects.toThrow("Background execution is still stopping");
				expect(session.sessionId).toBe(originalId);
				release.resolve();
				expect(await session.newSession()).toBe(true);
			} else {
				release.resolve();
				expect(await change).toBe(true);
			}
			if (action === "dispose") expect(session.sessionId).toBe(originalId);
			else expect(session.sessionId).not.toBe(originalId);
			const old = await SessionManager.open(originalFile);
			try {
				expect(
					old.getBranch().filter(entry => entry.type === "custom" && entry.customType === "async-execution"),
				).toHaveLength(1);
			} finally {
				await old.close();
			}
			if (action !== "fork" && action !== "dispose")
				expect(
					session.sessionManager
						.getBranch()
						.filter(entry => entry.type === "custom" && entry.customType === "async-execution"),
				).toHaveLength(0);
			expect(calls).toBe(2);
		} finally {
			release.resolve();
			allowRegistration.resolve();
			remote.dispose();
			await session.dispose();
			auth.close();
			mock.mockRestore();
			execute.mockRestore();
			await rm(cwd, { recursive: true, force: true });
		}
	},
	10000,
);
