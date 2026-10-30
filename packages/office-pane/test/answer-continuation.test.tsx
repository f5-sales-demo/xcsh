import { expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { MockTransport } from "../src/core";
import { useChatSession } from "../src/panel/useChatSession";

test("idle answer continuation preserves identity through activity and failure without replaying unrelated input", async () => {
	const transport = new MockTransport();
	const { result } = renderHook(() => useChatSession(transport));
	await act(async () => { await Promise.resolve(); });
	act(() => result.current.send("Original task"));
	const original = transport.sent.find(message => message.type === "chat_request")!;
	act(() => transport.emit({ type: "chat_done", id: (original as { id: string }).id }));
	let id: string | undefined;
	act(() => { id = result.current.prepareAsyncReply("question-1"); });
	expect(id).toMatch(/^c-answer-/);
	act(() => transport.emit({ type: "chat_tool_notice", id: id!, tool: "read", ok: true, detail: "read: running…" }));
	act(() => transport.emit({ type: "chat_error", id: id!, reason: "bridge-disconnected" }));
	const turn = result.current.turns.find(turn => turn.kind === "assistant" && turn.state.id === id);
	expect(turn).toMatchObject({ replyRequestId: "question-1" });
	const requests = transport.sent.filter(message => message.type === "chat_request").length;
	act(() => result.current.retry());
	expect(transport.sent.filter(message => message.type === "chat_request")).toHaveLength(requests);
});

test("concurrent answer submissions share the streaming continuation and rejection removes only empty placeholders", async () => {
	const transport = new MockTransport();
	const { result } = renderHook(() => useChatSession(transport));
	await act(async () => { await Promise.resolve(); });
	let first: string | undefined;
	let second: string | undefined;
	act(() => { first = result.current.prepareAsyncReply("one"); second = result.current.prepareAsyncReply("two"); });
	expect(second).toBe(first);
	expect(result.current.turns).toHaveLength(1);
	act(() => result.current.discardAsyncReply(first!));
	expect(result.current.turns).toHaveLength(0);
});

test("safe answer records survive history banking and update once without sending another prompt", async () => {
	const transport = new MockTransport();
	const { result } = renderHook(() => useChatSession(transport));
	await act(async () => { await Promise.resolve(); });
	act(() => result.current.send("Original task"));
	const request = transport.sent.find(message => message.type === "chat_request") as { id: string };
	act(() => transport.emit({ type: "chat_done", id: request.id }));
	const record = { id: "receipt", recap: { state: "recorded" as const, rows: [{ id: "q", topic: "Audience", question: "Who?", answer: "Developers" }] }, evidence: "safe" };
	act(() => { result.current.recordAnswer(record); result.current.recordAnswer(record); });
	const turn = result.current.turns.find(turn => turn.kind === "assistant");
	expect(turn && "answerRecaps" in turn ? turn.answerRecaps?.length : 0).toBe(1);
	expect(transport.sent.filter(message => message.type === "chat_request")).toHaveLength(1);
	act(() => result.current.newChat());
	expect(JSON.stringify(result.current.history)).toContain("Developers");
});
