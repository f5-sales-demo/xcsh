import { expect, test } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type ChatRequestMsg, MockTransport, type Transport } from "../src/core";
import { useChatSession } from "../src/panel/useChatSession";

test("send emits a chat_request with a c- id and the text", async () => {
	const mock = new MockTransport();
	const { result } = renderHook(() => useChatSession(mock));

	await act(async () => {
		result.current.send("hi");
	});

	const reqs = mock.sent.filter((m): m is ChatRequestMsg => m.type === "chat_request");
	expect(reqs).toHaveLength(1);
	const req = reqs[0];
	if (!req) throw new Error("expected chat_request in mock.sent");
	expect(req.id).toMatch(/^c-/);
	expect(req.text).toBe("hi");
});

test("onConnected fires exactly once after the transport connects", async () => {
	const mock = new MockTransport();
	let count = 0;
	await act(async () => {
		renderHook(() =>
			useChatSession(mock, {
				onConnected: () => {
					count += 1;
				},
			}),
		);
		await new Promise(r => setTimeout(r, 0));
	});
	expect(count).toBe(1);
});

test("with no provision, provisioning settles to 'ready' after connect (chat enabled)", async () => {
	const mock = new MockTransport();
	const { result } = renderHook(() => useChatSession(mock));
	await waitFor(() => {
		expect(result.current.provisioning).toBe("ready");
	});
	expect(result.current.provisionError).toBeUndefined();
});

test("provision() runs BEFORE onConnected, and only then does provisioning become 'ready'", async () => {
	const mock = new MockTransport();
	const order: string[] = [];
	let resolveProvision: () => void = () => {};
	const provision = () =>
		new Promise<void>(r => {
			order.push("provision");
			resolveProvision = r;
		});
	const { result } = renderHook(() =>
		useChatSession(mock, { provision, onConnected: () => order.push("onConnected") }),
	);

	// While provision is pending, chat is gated and host tools are NOT advertised.
	await waitFor(() => {
		expect(result.current.provisioning).toBe("configuring");
	});
	expect(order).toEqual(["provision"]);

	// Resolving the ack advances to ready and fires onConnected exactly once, after provision.
	await act(async () => {
		resolveProvision();
		await new Promise(r => setTimeout(r, 0));
	});
	await waitFor(() => {
		expect(result.current.provisioning).toBe("ready");
	});
	expect(order).toEqual(["provision", "onConnected"]);
});

test("a rejected provision surfaces provisioning='error' + provisionError and does NOT advertise host tools", async () => {
	const mock = new MockTransport();
	let advertised = false;
	const provision = () => Promise.reject(new Error("configure_error: bad token"));
	const { result } = renderHook(() =>
		useChatSession(mock, {
			provision,
			onConnected: () => {
				advertised = true;
			},
		}),
	);

	await waitFor(() => {
		expect(result.current.provisioning).toBe("error");
	});
	expect(result.current.provisionError).toMatch(/configure_error: bad token/);
	expect(advertised).toBe(false);
});

test("a reason-less chat_error surfaces status=error with raw error text (no silent state)", async () => {
	const mock = new MockTransport();
	const { result } = renderHook(() => useChatSession(mock));

	await act(async () => {
		result.current.send("hi");
	});
	const req = mock.sent.filter((m): m is ChatRequestMsg => m.type === "chat_request")[0];
	if (!req) throw new Error("expected chat_request in mock.sent");

	await act(async () => {
		mock.emit({ type: "chat_error", id: req.id, error: "Upstream exploded: 502" });
	});

	expect(result.current.status).toBe("error");
	expect(result.current.reason).toBeUndefined();
	expect(result.current.error).toBe("Upstream exploded: 502");
});

test("streaming deltas + chat_done accumulates text and sets status done", async () => {
	const mock = new MockTransport();
	const { result } = renderHook(() => useChatSession(mock));

	await act(async () => {
		result.current.send("hi");
	});

	const reqs = mock.sent.filter((m): m is ChatRequestMsg => m.type === "chat_request");
	expect(reqs).toHaveLength(1);
	const sentReq = reqs[0];
	if (!sentReq) throw new Error("expected chat_request in mock.sent");
	const { id } = sentReq;

	await act(async () => {
		mock.emit({ type: "chat_delta", id, seq: 0, delta: "Hel" });
		mock.emit({ type: "chat_delta", id, seq: 1, delta: "lo" });
		mock.emit({ type: "chat_done", id });
	});

	expect(result.current.status).toBe("done");
	const assistantTurn = result.current.turns.find(t => t.kind === "assistant");
	expect(assistantTurn).toBeDefined();
	if (assistantTurn?.kind === "assistant") {
		expect(assistantTurn.state.text).toBe("Hello");
	}
});

test("send() on a throwing (closed) transport surfaces an error turn — no perpetual spinner", async () => {
	// A transport whose connect() resolves but send() throws (state 'closed').
	const closedTransport: Transport = {
		state: "closed",
		connect: () => Promise.resolve(),
		send: () => {
			throw new Error("Cannot send in state 'closed'");
		},
		onMessage: () => () => {},
		stop: () => {},
		dispose: () => {},
	};

	const { result } = renderHook(() => useChatSession(closedTransport));

	await act(async () => {
		result.current.send("hi");
	});

	// The optimistic assistant turn is folded into a terminal error (never a
	// perpetual 'streaming' turn), reported as bridge-disconnected.
	expect(result.current.status).toBe("error");
	expect(result.current.reason).toBe("bridge-disconnected");
	const assistant = result.current.turns.find(t => t.kind === "assistant");
	expect(assistant?.kind === "assistant" && assistant.state.status).toBe("error");
});

test("connect() rejection surfaces status=error and reason=bridge-disconnected", async () => {
	// Minimal transport stub whose connect() always rejects.
	const failingTransport: Transport = {
		state: "idle",
		connect: () => Promise.reject(new Error("boom")),
		send: () => {},
		onMessage: () => () => {},
		stop: () => {},
		dispose: () => {},
	};

	const { result } = renderHook(() => useChatSession(failingTransport));

	await waitFor(() => {
		expect(result.current.status).toBe("error");
	});
	expect(result.current.reason).toBe("bridge-disconnected");
});
