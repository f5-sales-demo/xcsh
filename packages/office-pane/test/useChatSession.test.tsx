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

test("each chat_request carries a history_hint; newChat bumps it (engine resets history) and clears the transcript", async () => {
	const mock = new MockTransport();
	const { result } = renderHook(() => useChatSession(mock));

	await act(async () => {
		result.current.send("first");
	});
	const req1 = mock.sent.filter((m): m is ChatRequestMsg => m.type === "chat_request")[0];
	if (!req1) throw new Error("expected chat_request");
	expect(req1.history_hint).toBeTruthy();
	expect(result.current.turns.length).toBeGreaterThan(0);

	// New chat: transcript clears immediately.
	await act(async () => {
		result.current.newChat();
	});
	expect(result.current.turns).toHaveLength(0);

	// The next turn carries a DIFFERENT history_hint, so the engine resets context.
	await act(async () => {
		result.current.send("second");
	});
	const reqs = mock.sent.filter((m): m is ChatRequestMsg => m.type === "chat_request");
	const req2 = reqs[reqs.length - 1];
	if (!req2) throw new Error("expected second chat_request");
	expect(req2.history_hint).toBeTruthy();
	expect(req2.history_hint).not.toBe(req1.history_hint);
});

test("newChat aborts the in-flight turn (chat_stop) so a wedged turn can't survive the reset", async () => {
	const mock = new MockTransport();
	const { result } = renderHook(() => useChatSession(mock));

	await act(async () => {
		result.current.send("do a slow thing");
	});
	const req = mock.sent.filter((m): m is ChatRequestMsg => m.type === "chat_request")[0];
	if (!req) throw new Error("expected chat_request");
	// The turn is still streaming (no chat_done). newChat must abort it on the server.
	await act(async () => {
		result.current.newChat();
	});
	const stops = mock.sent.filter(m => m.type === "chat_stop");
	expect(stops).toHaveLength(1);
	expect((stops[0] as { id: string }).id).toBe(req.id);
	expect(result.current.turns).toHaveLength(0);
});

test("within one conversation, successive turns reuse the SAME history_hint", async () => {
	const mock = new MockTransport();
	const { result } = renderHook(() => useChatSession(mock));
	await act(async () => {
		result.current.send("a");
	});
	// settle the first turn so the second isn't queued at the engine (client-side send still emits)
	const first = mock.sent.filter((m): m is ChatRequestMsg => m.type === "chat_request")[0];
	if (!first) throw new Error("expected chat_request");
	await act(async () => {
		mock.emit({ type: "chat_done", id: first.id });
		result.current.send("b");
	});
	const reqs = mock.sent.filter((m): m is ChatRequestMsg => m.type === "chat_request");
	expect(reqs[0].history_hint).toBe(reqs[reqs.length - 1].history_hint);
});

test("chat_tool_notice folds live tool activity onto the active assistant turn", async () => {
	const mock = new MockTransport();
	const { result } = renderHook(() => useChatSession(mock));

	await act(async () => {
		result.current.send("summarize the workbook");
	});
	const id = mock.sent.filter((m): m is ChatRequestMsg => m.type === "chat_request")[0]?.id;
	if (!id) throw new Error("expected chat_request in mock.sent");

	// Tool starts → a running activity appears on the turn.
	await act(async () => {
		mock.emit({ type: "chat_tool_notice", id, tool: "get_workbook_info", ok: true, detail: "…: running…" });
	});
	let turn = result.current.turns.find(t => t.kind === "assistant");
	if (turn?.kind !== "assistant") throw new Error("no assistant turn");
	expect(turn.activities).toEqual([{ tool: "get_workbook_info", running: true, ok: true }]);

	// Tool ends → it settles; the next tool starts running.
	await act(async () => {
		mock.emit({ type: "chat_tool_notice", id, tool: "get_workbook_info", ok: true, detail: "…: done" });
		mock.emit({ type: "chat_tool_notice", id, tool: "read_range", ok: true, detail: "…: running…" });
	});
	turn = result.current.turns.find(t => t.kind === "assistant");
	if (turn?.kind !== "assistant") throw new Error("no assistant turn");
	expect(turn.activities).toEqual([
		{ tool: "get_workbook_info", running: false, ok: true },
		{ tool: "read_range", running: true, ok: true },
	]);

	// chat_done settles any still-running activity (no eternal spinner).
	await act(async () => {
		mock.emit({ type: "chat_delta", id, seq: 0, delta: "Done." });
		mock.emit({ type: "chat_done", id });
	});
	turn = result.current.turns.find(t => t.kind === "assistant");
	if (turn?.kind !== "assistant") throw new Error("no assistant turn");
	expect(turn.activities.every(a => !a.running)).toBe(true);
	expect(turn.state.text).toBe("Done.");
});

test("a failing chat_tool_notice end marks the activity not-ok", async () => {
	const mock = new MockTransport();
	const { result } = renderHook(() => useChatSession(mock));
	await act(async () => {
		result.current.send("write it");
	});
	const id = mock.sent.filter((m): m is ChatRequestMsg => m.type === "chat_request")[0]?.id;
	if (!id) throw new Error("expected chat_request in mock.sent");

	await act(async () => {
		mock.emit({ type: "chat_tool_notice", id, tool: "write_range", ok: true, detail: "…: running…" });
		mock.emit({ type: "chat_tool_notice", id, tool: "write_range", ok: false, detail: "…: failed" });
	});
	const turn = result.current.turns.find(t => t.kind === "assistant");
	if (turn?.kind !== "assistant") throw new Error("no assistant turn");
	expect(turn.activities).toEqual([{ tool: "write_range", running: false, ok: false }]);
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

test("send with images places them on the chat_request; a text-only send omits the field", async () => {
	const mock = new MockTransport();
	const { result } = renderHook(() => useChatSession(mock));

	await act(async () => {
		result.current.send("describe", { images: [{ data: "QUJD", mimeType: "image/png" }] });
	});
	await act(async () => {
		result.current.send("no images here");
	});

	const reqs = mock.sent.filter((m): m is ChatRequestMsg => m.type === "chat_request");
	expect(reqs).toHaveLength(2);
	expect(reqs[0].images).toEqual([{ data: "QUJD", mimeType: "image/png" }]);
	// A text-only turn stays a clean frame — no empty images array.
	expect(reqs[1].images).toBeUndefined();
});

test("requests list_skills on connect and exposes the skills reply", async () => {
	const mock = new MockTransport();
	const { result } = renderHook(() => useChatSession(mock));
	// Let connect → provision (none) → ready run, which sends list_skills.
	await act(async () => {
		await new Promise(r => setTimeout(r, 0));
	});
	expect(mock.sent.some(m => m.type === "list_skills")).toBe(true);
	expect(result.current.skills).toEqual([]);

	// The engine replies with its loaded skills → they surface on the hook.
	await act(async () => {
		mock.emit({ type: "skills", skills: [{ name: "competitive", description: "battlecards" }] } as never);
	});
	expect(result.current.skills).toEqual([{ name: "competitive", description: "battlecards" }]);
});
