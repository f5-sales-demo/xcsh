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
			useChatSession(mock, () => {
				count += 1;
			}),
		);
		await new Promise(r => setTimeout(r, 0));
	});
	expect(count).toBe(1);
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
