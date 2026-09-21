import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAsyncQuestionItem } from "../../../chat-ui/src/interactions/contract";
import { startSessionBridge } from "../../src/remote-control/bridge";
import { startLocalHost } from "../../src/remote-control/host";
import type { SessionTarget } from "../../src/remote-control/session";
import { UserInteractions } from "../../src/session/user-interactions";

test("a running session reconnects to the host and unregisters on bridge shutdown", async () => {
	const dir = await mkdtemp(join(tmpdir(), "xcsh-bridge-test-"));
	const path = join(dir, "host.sock");
	const host = await startLocalHost(path, "21.22.0");
	const userInteractions = new UserInteractions();
	userInteractions.setAsyncPresenter(() => new Promise(() => {}));
	const asyncAnswer = userInteractions.request({
		kind: "input",
		delivery: "async",
		title: "Phone structured UAT",
		questionId: "ask:0",
		identity: { sessionId: "fixture", threadId: "fixture", turnId: "turn", itemId: "ask", generation: 1 },
	});
	const target = {
		sessionId: "fixture",
		sessionName: "Fixture",
		model: { id: "gpt-6-astra", provider: "openai-codex" },
		modelRegistry: {
			getAvailable: () => [
				{
					id: "gpt-6-astra",
					name: "GPT-6 Astra",
					description: "Maximum capability",
					provider: "openai-codex",
					input: ["text", "image"],
					thinking: {
						supportedLevels: [{ effort: "high", description: "High" }],
						defaultLevel: "high",
					},
				},
				{
					id: "gpt-5.6-sol",
					name: "GPT-5.6 Sol",
					description: "Deep reasoning",
					provider: "openai-codex",
					input: ["text", "image"],
					thinking: {
						supportedLevels: [
							{ effort: "medium", description: "Medium" },
							{ effort: "high", description: "High" },
						],
						defaultLevel: "medium",
					},
				},
				{
					id: "gpt-5.4",
					name: "GPT-5.4",
					description: "Historical model",
					provider: "openai-codex",
					input: ["text", "image"],
				},
			],
		},
		messages: [],
		skills: [
			{
				name: "fixture",
				description: "Fixture",
				filePath: join(dir, "SKILL.md"),
				baseDir: dir,
				source: "agents:project",
				_source: { provider: "agents", providerName: "Agents", path: join(dir, "SKILL.md"), level: "project" },
			},
		],
		skillWarnings: [],
		sessionManager: { getCwd: () => dir },
		subscribe: () => () => {},
		userInteractions,
	} as unknown as SessionTarget;
	const collaborationModes: Array<"plan" | "default"> = [];
	const stop = startSessionBridge(target, path, 20, {
		getCollaborationMode: () => collaborationModes.at(-1) ?? "default",
		setCollaborationMode: async mode => {
			collaborationModes.push(mode);
		},
		setModel: async (model, thinkingLevel) => {
			(target as any).model = model;
			(target as any).thinkingLevel = thinkingLevel;
		},
	});
	try {
		const deadline = Date.now() + 1000;
		while (!host.router.sessions.has("fixture") && Date.now() < deadline) await Bun.sleep(10);
		expect(host.router.sessions.has("fixture")).toBe(true);
		expect(host.router.sessions.get("fixture")?.skills).toMatchObject([
			{ name: "fixture", path: join(dir, "SKILL.md"), scope: "repo", enabled: true },
		]);
		expect(host.router.sessions.get("fixture")?.models).toHaveLength(2);
		expect(host.router.sessions.get("fixture")?.publishedInteraction).toBe(true);
		expect(host.router.sessions.get("fixture")?.asyncInteractions).toEqual([
			{
				requestId: userInteractions.pending()[0].id,
				questionId: "ask:0",
				title: "Phone structured UAT",
				identity: {
					sessionId: "fixture",
					threadId: "fixture",
					turnId: "turn",
					itemId: "ask",
					generation: 1,
				},
			},
		]);
		expect(JSON.stringify(host.router.sessions.get("fixture")?.asyncInteractions)).not.toContain("answer");
		await host.router.handle("phone", {
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "fixture", version: "1" }, capabilities: { experimentalApi: true } },
		});
		expect(
			await host.router.handle("phone", {
				id: 2,
				method: "thread/settings/update",
				params: {
					threadId: "fixture",
					collaborationMode: { mode: "plan", settings: { model: "gpt-6-astra" } },
				},
			}),
		).toEqual({ id: 2, result: {} });
		expect(collaborationModes).toEqual(["plan"]);
		expect(
			await host.router.handle("phone", {
				id: 3,
				method: "model/list",
				params: {},
			}),
		).toMatchObject({
			id: 3,
			result: {
				data: [
					{ id: "gpt-6-astra", displayName: "GPT-6 Astra" },
					{
						id: "gpt-5.6-sol",
						displayName: "GPT-5.6 Sol",
						defaultReasoningEffort: "medium",
						supportedReasoningEfforts: [
							{ reasoningEffort: "medium", description: "Medium" },
							{ reasoningEffort: "high", description: "High" },
						],
					},
				],
			},
		});
		expect(
			await host.router.handle("phone", {
				id: 4,
				method: "thread/settings/update",
				params: {
					threadId: "fixture",
					model: "gpt-5.6-sol",
					effort: "high",
					serviceTier: null,
					multiAgentMode: "explicitRequestOnly",
				},
			}),
		).toEqual({ id: 4, result: {} });
		expect(target.model?.id).toBe("gpt-5.6-sol");
		expect(host.router.sessions.get("fixture")?.thread.model).toBe("gpt-5.6-sol");
		stop();
		await Bun.sleep(20);
		expect(host.router.sessions.has("fixture")).toBe(false);
	} finally {
		userInteractions.cancelAll();
		await asyncAnswer;
		stop();
		await host.close();
		await rm(dir, { recursive: true, force: true });
	}
});

test("a hidden session publishes its async item lifecycle in order", async () => {
	const dir = await mkdtemp(join(tmpdir(), "xcsh-bridge-async-test-"));
	const path = join(dir, "host.sock");
	const host = await startLocalHost(path, "21.22.0", undefined, { primarySessionId: "primary" });
	const stops: Array<() => Promise<void>> = [];
	const answers: Promise<unknown>[] = [];
	const events: any[] = [];
	const interactions = new UserInteractions();
	host.router.notify = (_client, event) => events.push(event);
	let secondaryEvent: (event: any) => void = () => {};
	const target = (id: string, userInteractions?: UserInteractions) =>
		({
			sessionId: id,
			sessionName: id,
			sessionFile: join(dir, `${id}.jsonl`),
			model: { id: "gpt-6-astra", provider: "openai-codex" },
			messages: [],
			isStreaming: false,
			sessionManager: { getCwd: () => dir },
			subscribe: (listener: (event: any) => void) => {
				if (id === "secondary") secondaryEvent = listener;
				return () => {};
			},
			prompt: async () => {},
			abort: async () => {},
			steer: async () => {},
			setSessionName: async () => true,
			userInteractions,
		}) as unknown as SessionTarget;
	try {
		stops.push(startSessionBridge(target("primary"), path, 5));
		interactions.setAsyncPresenter(() => new Promise(() => {}));
		stops.push(startSessionBridge(target("secondary", interactions), path, 5));
		const deadline = Date.now() + 1000;
		while (host.router.sessions.size < 2 && Date.now() < deadline) await Bun.sleep(10);
		expect(host.router.sessions.size).toBe(2);
		await host.router.handle("phone", {
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "phone", version: "1" }, capabilities: { experimentalApi: true } },
		});
		events.length = 0;
		secondaryEvent({ type: "agent_start" });
		const questions = [{ title: "Phone structured UAT", options: ["Alpha", "Beta"] }];
		const item = createAsyncQuestionItem("ask", questions);
		answers.push(
			...interactions.requestAsyncBatch(
				[
					{
						kind: "input",
						delivery: "async",
						title: questions[0].title,
						options: questions[0].options,
						questionId: "ask:0",
						identity: {
							sessionId: "secondary",
							threadId: "secondary",
							turnId: "secondary-turn-1",
							itemId: "ask",
							generation: 1,
						},
					},
				],
				{ requestId: "ask", questionIds: ["ask:0"], questions, item },
			),
		);
		secondaryEvent({ type: "async_user_input", item, questionIds: ["ask:0"] });
		await Bun.sleep(30);
		const lifecycle = events.filter(event =>
			["thread/started", "item/started", "item/completed"].includes(event.method),
		);
		expect(lifecycle.map(event => event.method)).toEqual(["thread/started", "item/started", "item/completed"]);
		expect(events.find(event => event.method === "item/tool/requestUserInput")).toMatchObject({
			params: {
				isBlocking: false,
				questions: [
					{ id: "ask:0", header: "Phone structured UAT", options: [{ label: "Alpha" }, { label: "Beta" }] },
				],
			},
		});
		expect(lifecycle[1].params.item).toEqual({ ...item, text: "" });
		expect(lifecycle[2].params.item).toEqual(item);
		const request = events.find(event => event.method === "item/tool/requestUserInput")!;
		expect(
			await host.router.handle("phone", {
				id: request.id,
				result: { answers: { "ask:0": { answers: ["Beta"] } } },
			}),
		).toBeNull();
		expect(await Promise.all(answers)).toEqual(["Beta"]);
		expect(
			events.filter(event => event.method === "serverRequest/resolved" && event.params.requestId === request.id),
		).toHaveLength(1);
		await host.router.handle("phone", {
			id: request.id,
			result: { answers: { "ask:0": { answers: ["Beta"] } } },
		});
		expect(
			events.filter(event => event.method === "serverRequest/resolved" && event.params.requestId === request.id),
		).toHaveLength(1);
	} finally {
		interactions.cancelAll();
		for (const stop of stops.toReversed()) await stop();
		await Promise.allSettled(answers);
		await host.close();
		await rm(dir, { recursive: true, force: true });
	}
});
