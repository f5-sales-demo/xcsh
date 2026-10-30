import { expect, test } from "bun:test";
import { createQuestionReply } from "../../../chat-ui/src/interactions/async-answer";
import { ChatHandler } from "../../src/browser/chat-handler";
import { UserInteractions } from "../../src/session/user-interactions";

test("a reply in prompt finalization subscribes until its own boundary and preserves earlier output", async () => {
	const owner = new UserInteractions();
	const listeners = new Set<(event: any) => void>();
	const sent: any[] = [];
	let incoming: (message: any) => void = () => {};
	const session = {
		sessionId: "session",
		userInteractions: owner,
		isStreaming: true,
		conversationPlans: {},
		subscribe: (callback: any) => {
			listeners.add(callback);
			return () => listeners.delete(callback);
		},
	} as any;
	const bridge = {
		serveKind: "browser",
		clientHost: "chrome",
		send: (message: any) => sent.push(message),
		onMessage: (callback: any) => {
			incoming = callback;
		},
		onDisconnected() {},
	} as any;
	const handler = new ChatHandler(bridge, session);
	handler.attach();
	const identity = { sessionId: "session", threadId: "session", turnId: "turn", itemId: "call", generation: 0 };
	const result = owner.request({ kind: "input", delivery: "async", title: "Audience?", questionId: "q", identity });
	incoming({
		type: "interaction_respond",
		requestId: owner.pending()[0].id,
		responseId: "receipt",
		value: "Developers",
		identity,
		chatId: "c-answer",
	});
	expect(await result).toBe("Developers");
	const emit = (event: any) => {
		for (const listener of [...listeners]) listener(event);
	};
	emit({ type: "agent_end", messages: [] });
	expect(sent.some(message => message.type === "chat_done")).toBe(false);
	emit({
		type: "message_start",
		message: { role: "user", content: createQuestionReply("q", "Audience?", "Developers") },
	});
	emit({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
	emit({
		type: "message_update",
		assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "For developers" },
	});
	expect(sent.some(message => message.type === "chat_delta" && message.id === "c-answer")).toBe(true);
	handler.dispose();
	owner.close();
});

test("idle async reply opens a correlated output subscription before model continuation", async () => {
	const owner = new UserInteractions();
	const listeners = new Set<(event: any) => void>();
	let incoming: (message: any) => void = () => {};
	const sent: any[] = [];
	const session = {
		sessionId: "session",
		userInteractions: owner,
		isStreaming: false,
		conversationPlans: {},
		subscribe: (listener: any) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	} as any;
	const bridge = {
		serveKind: "browser",
		clientHost: "chrome",
		send: (message: any) => sent.push(message),
		onMessage: (callback: any) => (incoming = callback),
		onDisconnected: () => {},
	} as any;
	const handler = new ChatHandler(bridge, session);
	handler.attach();
	const identity = { sessionId: "session", threadId: "session", turnId: "turn", itemId: "call", generation: 0 };
	const result = owner.request({ kind: "input", delivery: "async", title: "Audience?", identity });
	const request = owner.pending()[0];
	incoming({
		type: "interaction_respond",
		requestId: request.id,
		responseId: "answer-1",
		identity,
		value: "End users",
		chatId: "answer-turn",
	});
	expect(await result).toBe("End users");
	for (const listener of [...listeners])
		listener({
			type: "message_update",
			assistantMessageEvent: { type: "text_start", contentIndex: 0, phase: "final_answer" },
		});
	for (const listener of [...listeners])
		listener({
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "For end users" },
		});
	expect(
		sent.some(
			message => message.type === "chat_delta" && message.id === "answer-turn" && message.delta === "For end users",
		),
	).toBe(true);
	handler.dispose();
	owner.close();
});
