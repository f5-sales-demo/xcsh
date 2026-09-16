import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { Settings } from "../../src/config/settings";
import { startLocalHost } from "../../src/remote-control/host";
import { RemoteSession, type SessionTarget } from "../../src/remote-control/session";

const models = ["gpt-6-astra"];

test("the current session re-registers without duplicate turns, approvals, or tenant requests", async () => {
	const dir = await mkdtemp("/tmp/xcsh-four-session-lifecycle-");
	const path = `${dir}/host.sock`;
	const tenantCalls = new Map<string, number>();
	const remotes = models.map((modelId, index) => {
		const sessionId = `session-${index + 1}`;
		const messages: any[] = [
			{ role: "user", content: `history-${index + 1}`, timestamp: 1 },
			{
				role: "assistant",
				content: [{ type: "text", text: `summary-${index + 1}`, phase: "final_answer" }],
				api: "responses",
				provider: "openai-codex",
				model: modelId,
				stopReason: "stop",
				timestamp: 2,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			},
		];
		const model: any = {
			id: modelId,
			name: modelId,
			provider: "openai-codex",
			api: "responses",
			input: ["text"],
			thinking: {
				supportedLevels: [{ effort: "medium", description: "Medium" }],
				defaultLevel: "medium",
			},
		};
		const target = {
			sessionId,
			sessionName: `xcsh Remote ${modelId.split("-").at(-1)}`,
			sessionFile: null,
			model,
			messages,
			systemPrompt: "fixture",
			getActiveToolNames: () => [],
			isStreaming: false,
			activeStreamMessage: undefined,
			sessionManager: { getCwd: () => `/fixture/${sessionId}` },
			subscribe: () => () => {},
			prompt: async (text: string) => {
				tenantCalls.set(sessionId, (tenantCalls.get(sessionId) ?? 0) + 1);
				messages.push(
					{ role: "user", content: text, timestamp: 3 },
					{
						role: "assistant",
						content: [{ type: "text", text: `completed-${sessionId}`, phase: "final_answer" }],
						api: "responses",
						provider: "openai-codex",
						model: modelId,
						stopReason: "stop",
						timestamp: 4,
						usage: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 0,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						},
					},
				);
			},
			steer: async () => {},
			abort: async () => {},
			getQueuedMessages: () => [],
			thinkingLevel: "medium",
			setThinkingLevel: () => {},
			setSessionName: async () => {},
			modelRegistry: { getAvailable: () => [model] },
			sendCustomMessage: async () => {},
			setRealtimeMode: async () => {},
			settings: Settings.isolated({ "compaction.enabled": false }),
			skills: [],
			skillWarnings: [],
		} as unknown as SessionTarget;
		return new RemoteSession(target, "fixture");
	});
	const approval = (threadId: string, index: number) => ({
		id: `approval-${index}`,
		method: "item/tool/requestUserInput",
		params: {
			threadId,
			turnId: `pending-turn-${index}`,
			itemId: `pending-item-${index}`,
			isBlocking: true,
			autoResolutionMs: null,
			questions: [
				{
					id: `approval-${index}`,
					header: "Approval",
					question: "Continue?",
					isOther: false,
					isSecret: false,
					options: [{ label: "Approve", description: "Continue once." }],
				},
			],
		},
	});
	const attach = (host: Awaited<ReturnType<typeof startLocalHost>>) => {
		for (const [index, remote] of remotes.entries()) {
			const thread = remote.thread();
			host.router.registerSession(thread.id, {
				thread,
				requests: [approval(thread.id, index)],
				models: remote.models(),
				collaborationMode: "default",
				call: (identity, method, params) => remote.call(identity, method, params),
			});
		}
	};
	const initialize = (host: Awaited<ReturnType<typeof startLocalHost>>, events: any[]) => {
		host.router.notify = (_client, event) => events.push(event);
		return host.router.handle("phone", {
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "fixture", version: "1" }, capabilities: { experimentalApi: true } },
		});
	};
	let host = await startLocalHost(path, "fixture");
	try {
		attach(host);
		const firstEvents: any[] = [];
		await initialize(host, firstEvents);
		const firstList: any = await host.router.handle("phone", { id: 2, method: "thread/list", params: {} });
		const before = firstList.result.data.map((thread: any) => ({
			id: thread.id,
			name: thread.name,
			model: thread.model,
			reasoningEffort: thread.reasoningEffort,
		}));
		const accepted = new Map<string, string>();
		for (const [index, remote] of remotes.entries()) {
			const threadId = remote.thread().id;
			await host.router.handle("phone", { id: 10 + index, method: "thread/resume", params: { threadId } });
			const response: any = await host.router.handle("phone", {
				id: 20 + index,
				method: "turn/start",
				params: {
					threadId,
					clientUserMessageId: `stable-${index}`,
					input: [{ type: "text", text: `request-${index}` }],
					effort: "medium",
				},
			});
			accepted.set(threadId, response.result.turn.id);
		}
		await Bun.sleep(0);
		expect([...tenantCalls.values()]).toEqual([1]);
		expect(
			firstEvents
				.filter(event => event.id?.startsWith("approval-"))
				.map(event => event.id)
				.sort(),
		).toEqual(["approval-0"]);

		await host.close();
		host = await startLocalHost(path, "fixture");
		attach(host);
		const secondEvents: any[] = [];
		await initialize(host, secondEvents);
		const secondList: any = await host.router.handle("phone", { id: 30, method: "thread/list", params: {} });
		expect(
			secondList.result.data.map((thread: any) => ({
				id: thread.id,
				name: thread.name,
				model: thread.model,
				reasoningEffort: thread.reasoningEffort,
			})),
		).toEqual(before);
		for (const [index, remote] of remotes.entries()) {
			const threadId = remote.thread().id;
			await host.router.handle("phone", { id: 40 + index, method: "thread/resume", params: { threadId } });
			const retry: any = await host.router.handle("phone", {
				id: 50 + index,
				method: "turn/start",
				params: {
					threadId,
					clientUserMessageId: `stable-${index}`,
					input: [{ type: "text", text: `request-${index}` }],
					effort: "medium",
				},
			});
			expect(retry.result.turn.id).toBe(accepted.get(threadId));
			const history: any = await host.router.handle("phone", {
				id: 60 + index,
				method: "thread/read",
				params: { threadId, includeTurns: true },
			});
			expect(history.result.thread.turns).toHaveLength(2);
		}
		expect([...tenantCalls.values()]).toEqual([1]);
		expect(
			secondEvents
				.filter(event => event.id?.startsWith("approval-"))
				.map(event => event.id)
				.sort(),
		).toEqual(["approval-0"]);
	} finally {
		await Promise.all(remotes.map(remote => remote.close()));
		await host.close();
		await rm(dir, { recursive: true, force: true });
	}
});
