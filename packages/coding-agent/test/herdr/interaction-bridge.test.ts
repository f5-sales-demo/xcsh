import { expect, test } from "bun:test";
import { createAsyncQuestionItem } from "../../../chat-ui/src/interactions/contract";
import { HerdrInteractionBridge } from "../../src/herdr/interactions";
import { UserInteractions } from "../../src/session/user-interactions";

test("Herdr delivery is acknowledged only after the session completion owner accepts it", async () => {
	const owner = new UserInteractions();
	const identity = { sessionId: "s", threadId: "t", turnId: "u", itemId: "i", generation: 1 };
	const calls: { method: string; params: Record<string, unknown> }[] = [];
	let delivery: unknown[] = [];
	const client = {
		ensureProtocol: async () => {},
		capabilityVersion: () => 1,
		request: async (method: string, params: Record<string, unknown>) => {
			calls.push({ method, params });
			return method.endsWith("delivery.get")
				? { type: "agent_interaction_deliveries", deliveries: delivery }
				: { type: method.endsWith("delivery.ack") ? "agent_interaction_receipt" : "agent_interaction" };
		},
	};
	const bridge = new HerdrInteractionBridge(
		client,
		owner,
		{ execution_id: "e", pane_id: "p", producer: "xcsh", generation: 1, session_id: "s" },
		() => {},
		undefined,
		false,
	);
	const result = owner.request({ kind: "input", title: "Where?", delivery: "async", identity });
	await bridge.flush();
	const report = calls.find(call => call.method === "agent.interaction.report")!.params;
	expect(report).not.toHaveProperty("answer");
	delivery = [
		{
			receipt: { target: report.target, response_id: "reply", state: "queued" },
			answer: { questionId: "i", answer: "Canada" },
		},
	];
	await bridge.flush();
	expect(await result).toBe("Canada");
	expect(calls.find(call => call.method === "agent.interaction.delivery.ack")?.params).toMatchObject({
		response_id: "reply",
		accepted: true,
	});
	await bridge.close();
});

test("lost producer acknowledgements retry before resolution reports", async () => {
	const owner = new UserInteractions();
	let delivery: unknown[] = [];
	let ackAttempts = 0;
	let acknowledged = false;
	let reportedAfterAck = false;
	let reportTarget: unknown;
	const client = {
		ensureProtocol: async () => {},
		capabilityVersion: () => 1,
		request: async (method: string, params: Record<string, unknown>) => {
			if (method.endsWith("delivery.get")) return { type: "agent_interaction_deliveries", deliveries: delivery };
			if (method.endsWith("delivery.ack")) {
				expect(params.accepted).toBe(true);
				if (++ackAttempts === 1) throw new Error("connection lost before acknowledgement");
				acknowledged = true;
				delivery = [];
				return { type: "agent_interaction_receipt" };
			}
			reportTarget = params.target;
			if (params.state === "answered") {
				expect(acknowledged).toBe(true);
				reportedAfterAck = true;
			}
			return { type: "agent_interaction" };
		},
	};
	const bridge = new HerdrInteractionBridge(
		client,
		owner,
		{ execution_id: "e", pane_id: "p", producer: "xcsh", generation: 1, session_id: "s" },
		() => {},
		undefined,
		false,
	);
	const answer = owner.request({
		kind: "input",
		title: "Q",
		delivery: "async",
		identity: { sessionId: "s", threadId: "t", turnId: "u", itemId: "i", generation: 1 },
	});
	await bridge.flush();
	delivery = [
		{
			receipt: { target: reportTarget, response_id: "lost", state: "queued" },
			answer: { questionId: "i", answer: "A" },
		},
	];
	await bridge.flush();
	expect(await answer).toBe("A");
	expect(ackAttempts).toBe(1);
	await bridge.flush();
	expect(ackAttempts).toBe(2);
	expect(reportedAfterAck).toBe(true);
	await bridge.close();
});

test("an asynchronous tool call is reported as one unchanged ordered question batch", async () => {
	const owner = new UserInteractions();
	const calls: { method: string; params: Record<string, unknown> }[] = [];
	const client = {
		ensureProtocol: async () => {},
		capabilityVersion: () => 1,
		request: async (method: string, params: Record<string, unknown>) => {
			calls.push({ method, params });
			return method.endsWith("delivery.get")
				? { type: "agent_interaction_deliveries", deliveries: [] }
				: { type: "agent_interaction" };
		},
	};
	const bridge = new HerdrInteractionBridge(
		client,
		owner,
		{ execution_id: "e", pane_id: "p", producer: "xcsh", generation: 1, session_id: "s" },
		() => {},
		"private-capability",
		false,
	);
	const identity = { sessionId: "s", threadId: "t", turnId: "u", itemId: "call", generation: 1 };
	const questions = [{ title: "Region?", options: ["Canada", "US"] }, { title: "Why?" }];
	const questionIds = ["call:0", "call:1"];
	const item = createAsyncQuestionItem("call", questions);
	owner.requestAsyncBatch(
		questions.map((question, index) => ({
			kind: "input" as const,
			delivery: "async" as const,
			questionId: questionIds[index],
			title: question.title,
			options: question.options,
			identity,
		})),
		{ requestId: "call", questionIds, questions, item },
	);
	await bridge.flush();
	const reports = calls.filter(call => call.method === "agent.interaction.report");
	expect(reports).toHaveLength(1);
	expect(reports[0].params).toMatchObject({
		target: { request_id: "call" },
		question_ids: questionIds,
		payload: item,
		native_capability: "private-capability",
	});
	owner.cancelAll();
	await bridge.close();
});

test("the bridge bounds pending plan entries and their replay reports", async () => {
	const owner = new UserInteractions();
	const calls: { method: string; params: Record<string, unknown> }[] = [];
	const errors: unknown[] = [];
	const client = {
		ensureProtocol: async () => {},
		capabilityVersion: () => 1,
		request: async (method: string, params: Record<string, unknown>) => {
			calls.push({ method, params });
			return method.endsWith("delivery.get")
				? { type: "agent_interaction_deliveries", deliveries: [] }
				: { type: "agent_interaction" };
		},
	};
	const bridge = new HerdrInteractionBridge(
		client,
		owner,
		{ execution_id: "e", pane_id: "p", producer: "xcsh", generation: 1, session_id: "s" },
		error => errors.push(error),
		"private-capability",
		false,
	);
	for (let index = 0; index < 65; index++) {
		bridge.plan(
			{
				id: `plan-${index}`,
				itemId: `item-${index}`,
				revision: index + 1,
				markdown: `Plan ${index}`,
				status: "pending",
			},
			{ sessionId: "s", threadId: "t", turnId: "u", itemId: `item-${index}`, generation: 1 },
			async () => ({ accepted: true }),
		);
	}
	await bridge.flush();
	expect(calls.filter(call => call.method === "agent.interaction.report")).toHaveLength(64);
	expect(errors).toHaveLength(1);
	await bridge.close();
});

test("logical session changes keep the authenticated Herdr producer session stable", async () => {
	const owner = new UserInteractions();
	const calls: { method: string; params: Record<string, unknown> }[] = [];
	const client = {
		ensureProtocol: async () => {},
		capabilityVersion: () => 1,
		request: async (method: string, params: Record<string, unknown>) => {
			calls.push({ method, params });
			return method.endsWith("delivery.get")
				? { type: "agent_interaction_deliveries", deliveries: [] }
				: { type: "agent_interaction" };
		},
	};
	const bridge = new HerdrInteractionBridge(
		client,
		owner,
		{ execution_id: "e", pane_id: "p", producer: "xcsh", generation: 1, session_id: "producer-session" },
		() => {},
		"private-capability",
		false,
	);
	const first = owner.requestInput({
		delivery: "waiting",
		title: "First?",
		inputQuestions: [{ id: "first", header: "First", question: "First?", isOther: true, isSecret: false }],
		identity: {
			sessionId: "logical-one",
			threadId: "thread-one",
			turnId: "turn-one",
			itemId: "item-one",
			generation: 1,
		},
	});
	await bridge.flush();
	owner.cancelAll("superseded");
	await first;
	await bridge.flush();
	const second = owner.requestInput({
		delivery: "waiting",
		title: "Second?",
		inputQuestions: [{ id: "second", header: "Second", question: "Second?", isOther: true, isSecret: false }],
		identity: {
			sessionId: "logical-two",
			threadId: "thread-two",
			turnId: "turn-two",
			itemId: "item-two",
			generation: 2,
		},
	});
	await bridge.flush();
	const reports = calls.filter(call => call.method === "agent.interaction.report").map(call => call.params);
	expect(reports.at(-1)).toMatchObject({
		target: { owner: { session_id: "producer-session" } },
		thread_id: "thread-two",
	});
	owner.cancelAll();
	await second;
	await bridge.close();
});
