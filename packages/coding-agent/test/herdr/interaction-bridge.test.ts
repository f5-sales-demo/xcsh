import { expect, test } from "bun:test";
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
		{ execution_id: "e", pane_id: "p", producer: "xcsh", generation: 1 },
		() => {},
		undefined,
		false,
	);
	const result = owner.request({ kind: "input", title: "Where?", delivery: "async", identity });
	await bridge.flush();
	const report = calls.find(call => call.method === "agent.interaction.report")!.params;
	expect(report).not.toHaveProperty("answer");
	delivery = [{ receipt: { target: report.target, response_id: "reply", state: "queued" }, answer: "Canada" }];
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
		{ execution_id: "e", pane_id: "p", producer: "xcsh", generation: 1 },
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
	delivery = [{ receipt: { target: reportTarget, response_id: "lost", state: "queued" }, answer: "A" }];
	await bridge.flush();
	expect(await answer).toBe("A");
	expect(ackAttempts).toBe(1);
	await bridge.flush();
	expect(ackAttempts).toBe(2);
	expect(reportedAfterAck).toBe(true);
	await bridge.close();
});
