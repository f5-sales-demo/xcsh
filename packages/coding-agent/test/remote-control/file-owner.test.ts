import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { type AssistantMessage, getBundledModel } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { _resetSettingsForTest, Settings } from "../../src/config/settings";
import { type Notification, RemoteSession } from "../../src/remote-control/session";
import { createAgentSession } from "../../src/sdk";
import { AuthStorage } from "../../src/session/auth-storage";

test("the shared SDK owner writes and edits once with matching streamed and restored file history", async () => {
	const cwd = await mkdtemp("/tmp/xcsh-file-owner-");
	const auth = await AuthStorage.create(":memory:");
	await Settings.init({ inMemory: true });
	const model = getBundledModel("openai", "gpt-4o-mini")!;
	auth.setRuntimeApiKey(model.provider, "fixture-key");
	const { session } = await createAgentSession({
		cwd,
		agentDir: join(cwd, "agent"),
		authStorage: auth,
		model,
		toolNames: ["write", "edit"],
		settings: Settings.isolated({ "compaction.enabled": false, "edit.mode": "replace" }),
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
		const index = calls++;
		const message: AssistantMessage = {
			role: "assistant",
			api: model.api,
			model: model.id,
			provider: model.provider,
			timestamp: Date.now(),
			stopReason: index < 2 ? "toolUse" : "stop",
			content:
				index === 0
					? [
							{
								type: "toolCall",
								id: "file-write",
								name: "write",
								arguments: { path: "fixture.txt", content: "FILE-ONE\n" },
							},
						]
					: index === 1
						? [
								{
									type: "toolCall",
									id: "file-edit",
									name: "edit",
									arguments: { edits: [{ path: "fixture.txt", old_text: "FILE-ONE", new_text: "FILE-TWO" }] },
								},
							]
						: [{ type: "text", text: "FILE-TWO", phase: "final_answer" }],
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
			stream.push({ type: "done", reason: index < 2 ? "toolUse" : "stop", message });
		});
		return stream;
	};
	const remote = new RemoteSession(session);
	const events: Notification[] = [];
	const ended = Promise.withResolvers<void>();
	remote.subscribe(event => {
		events.push(event);
		if (event.method === "turn/completed") ended.resolve();
	});
	try {
		const input = {
			threadId: session.sessionId,
			clientUserMessageId: "file-owner",
			input: [{ type: "text", text: "Write and update fixture.txt" }],
		};
		const started = await remote.call("phone", "turn/start", input);
		expect(await remote.call("phone", "turn/start", input)).toEqual(started);
		await ended.promise;
		await session.sessionManager.flush();
		expect(calls).toBe(3);
		expect(await readFile(join(cwd, "fixture.txt"), "utf8")).toBe("FILE-TWO\n");
		const history = remote.history();
		const files = history[0].items.filter(item => item.type === "fileChange");
		expect(files).toHaveLength(2);
		expect(files[0]).toMatchObject({
			status: "completed",
			changes: [{ path: join(cwd, "fixture.txt"), kind: { type: "add" }, diff: "FILE-ONE\n" }],
		});
		expect(files[1]).toMatchObject({
			status: "completed",
			changes: [
				{
					path: join(cwd, "fixture.txt"),
					kind: { type: "update", move_path: null },
					diff: "@@ -1 +1 @@\n-FILE-ONE\n+FILE-TWO\n",
				},
			],
		});
		expect(
			events
				.filter(event => event.method === "item/completed" && (event.params.item as any).type === "fileChange")
				.map(event => event.params.item),
		).toEqual(files);
		expect(
			events.filter(event => event.method === "item/started" && (event.params.item as any).type === "fileChange"),
		).toHaveLength(2);
		remote.dispose();
		const reattached = new RemoteSession(session);
		try {
			expect(reattached.history()).toEqual(history);
		} finally {
			reattached.dispose();
		}
	} finally {
		remote.dispose();
		await session.dispose();
		auth.close();
		_resetSettingsForTest();
		await rm(cwd, { recursive: true, force: true });
	}
}, 10000);
