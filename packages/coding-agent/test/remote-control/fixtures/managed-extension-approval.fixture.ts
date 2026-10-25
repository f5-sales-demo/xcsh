import { expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@f5-sales-demo/pi-agent-core";
import { type AssistantMessage, getBundledModel } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { Type } from "@sinclair/typebox";
import { ModelRegistry } from "../../../src/config/model-registry";
import { Settings } from "../../../src/config/settings";
import sandboxGuard from "../../../src/extensibility/extensions/bundled/sandbox-guard";
import { ExtensionRuntime, loadExtensionFromFactory } from "../../../src/extensibility/extensions/loader";
import { ExtensionRunner } from "../../../src/extensibility/extensions/runner";
import { ExtensionToolWrapper } from "../../../src/extensibility/extensions/wrapper";
import { AgentSession } from "../../../src/session/agent-session";
import { AuthStorage } from "../../../src/session/auth-storage";
import { EventBus } from "../../../src/utils/event-bus";

// Run in a child process: the SDK mock must never alter other package tests.
let createFixture: (options: any) => Promise<any>;
const sdk = await import("../../../src/sdk");
mock.module("../../../src/sdk", () => ({ ...sdk, createAgentSession: (options: any) => createFixture(options) }));
const { createManagedSessionRuntime } = await import("../../../src/remote-control/managed-sessions");

test.each(["accept", "decline", "cancel", "interrupt"])(
	"managed workspace approvals remain owned until %s",
	async decision => {
		const cwd = await mkdtemp(join(tmpdir(), "xcsh-managed-approval-"));
		const model = getBundledModel("openai", "gpt-4o-mini")!;
		const auth = await AuthStorage.create(":memory:");
		auth.setRuntimeApiKey(model.provider, "fixture-key");
		let session!: AgentSession;
		let executions = 0;
		let iteration = 0;
		let toolUIBound = false;
		createFixture = async options => {
			const settings = Settings.isolated({ "compaction.enabled": false });
			const registry = new ModelRegistry(auth);
			const runtime = new ExtensionRuntime();
			const extension = await loadExtensionFromFactory(sandboxGuard, cwd, new EventBus(), runtime);
			const runner = new ExtensionRunner([extension], runtime, cwd, options.sessionManager, registry, settings);
			const tool = new ExtensionToolWrapper(
				{
					name: "bash",
					label: "Bash",
					description: "Read-only execution probe",
					executionKind: "command",
					parameters: Type.Object({ command: Type.String() }),
					execute: async () => {
						executions++;
						const process = Bun.spawn(["/usr/bin/true"]);
						expect(await process.exited).toBe(0);
						return { content: [{ type: "text" as const, text: "Executed" }], details: {} };
					},
				},
				runner,
			);
			const agent = new Agent({
				getApiKey: () => "fixture-key",
				initialState: { model, systemPrompt: "Test", tools: [tool] },
				streamFn: () => {
					const first = ++iteration === 1;
					const message: AssistantMessage = {
						role: "assistant",
						content: first
							? [
									{
										type: "toolCall",
										id: "approval-call",
										name: "bash",
										arguments: { command: "/usr/bin/true" },
									},
								]
							: [{ type: "text", text: "Done" }],
						api: model.api,
						provider: model.provider,
						model: model.id,
						timestamp: Date.now(),
						stopReason: first ? "toolUse" : "stop",
						usage: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 0,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						},
					};
					const stream = new AssistantMessageEventStream();
					queueMicrotask(() => {
						stream.push({ type: "start", partial: { ...message, content: [] } });
						stream.push({ type: "done", reason: first ? "toolUse" : "stop", message });
					});
					return stream;
				},
			});
			session = new AgentSession({
				agent,
				toolRegistry: new Map(agent.state.tools.map(tool => [tool.name, tool])),
				sessionManager: options.sessionManager,
				settings,
				modelRegistry: registry,
				extensionRunner: runner,
			});
			return {
				session,
				setToolUIContext: () => {
					toolUIBound = true;
				},
			};
		};
		const runtime = await createManagedSessionRuntime({
			kind: "start",
			params: {
				cwd,
				ephemeral: true,
				approvalPolicy: "on-request",
				sandbox: "workspace-write",
			},
		});
		const events: any[] = [];
		const snapshots: any[] = [];
		runtime.setPublisher!(event => {
			events.push(event);
			snapshots.push({ method: event.method, requests: structuredClone(runtime.endpoint.requests) });
		});
		const task = runtime.endpoint.call("phone-turn", "turn/start", {
			threadId: session.sessionId,
			input: [{ type: "text", text: "Run the read-only probe" }],
		});
		try {
			for (let i = 0; i < 200 && !events.some(e => e.method === "item/commandExecution/requestApproval"); i++)
				await Bun.sleep(5);
			const request = events.find(e => e.method === "item/commandExecution/requestApproval");
			expect(request).toBeDefined();
			expect(toolUIBound).toBe(true);
			expect(request.params).toMatchObject({
				threadId: session.sessionId,
				command: "/usr/bin/true",
				availableDecisions: ["accept", "decline", "cancel"],
			});
			expect(executions).toBe(0);
			expect(session.userInteractions.pending()).toHaveLength(1);
			// Every worker event carries this endpoint snapshot to the host router.
			// A delayed phone answer must still find the request after later events.
			expect(runtime.endpoint.requests?.map(value => value.id)).toEqual([request.id]);
			expect(
				snapshots
					.find(value => value.method === "item/commandExecution/requestApproval")
					?.requests.map((value: any) => value.id),
			).toEqual([request.id]);
			await Bun.sleep(20);
			expect(executions).toBe(0);
			if (decision === "interrupt") await session.abort();
			else
				expect(
					await runtime.endpoint.call("phone-answer", "session/interaction/respond", {
						threadId: session.sessionId,
						requestId: request.id,
						response: { decision },
					}),
				).toEqual({ accepted: true });
			await task;
			await session.agent.waitForIdle();
			expect(executions).toBe(decision === "accept" ? 1 : 0);
			expect(session.userInteractions.pending()).toEqual([]);
			expect(snapshots.filter(value => value.method === "serverRequest/resolved").at(-1)?.requests).toEqual([]);
			expect(
				await runtime.endpoint.call("late-answer", "session/interaction/respond", {
					threadId: session.sessionId,
					requestId: request.id,
					response: { decision: "accept" },
				}),
			).toEqual({ accepted: false });
		} finally {
			session.userInteractions.cancelAll();
			await task.catch(() => {});
			await runtime.close();
			auth.close();
			await rm(cwd, { recursive: true, force: true });
		}
	},
	15000,
);
