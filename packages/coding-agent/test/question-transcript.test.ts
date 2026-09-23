import { beforeAll, describe, expect, test, vi } from "bun:test";
import { visibleWidth } from "@f5-sales-demo/pi-tui";
import {
	parseAsyncInputReply,
	QuestionTranscriptComponent,
	resolveAsyncQuestionReply,
} from "../src/modes/components/question-transcript";
import { EventController } from "../src/modes/controllers/event-controller";
import { getThemeByName, setSymbolPreset, setThemeInstance } from "../src/modes/theme/theme";
import { UiHelpers } from "../src/modes/utils/ui-helpers";

beforeAll(async () => {
	setThemeInstance((await getThemeByName("xcsh-dark"))!);
	await setSymbolPreset("unicode");
});

const item = {
	id: "transport-item",
	type: "agentMessage" as const,
	text: "Which region?\n- Montréal\n- 東京\n\nAny details?",
	phase: "final_answer" as const,
	delivery: "async" as const,
	questions: [{ title: "Which region?", options: ["Montréal", "東京"] }, { title: "Any details?" }],
};

describe("question transcript presentation", () => {
	test("renders a compact themed async announcement with a clear action and no transport ids", () => {
		const component = QuestionTranscriptComponent.pending(item);
		const lines = component.render(80);
		const plain = Bun.stripANSI(lines.join("\n"));
		expect(plain).toContain("Questions pending");
		expect(plain).toContain("Which region?");
		expect(plain).toContain("Any details?");
		expect(plain).toContain("/questions");
		expect(plain).not.toContain("transport-item");
		expect(lines.every(line => visibleWidth(line) === 80)).toBe(true);
	});

	test("correlates the exact model-facing payload into a friendly answer summary", () => {
		const raw =
			'{"type":"user_input_reply","itemId":"transport-item","questionId":"transport-item:0","answer":"Montréal"}';
		const reply = parseAsyncInputReply(raw);
		expect(reply).toEqual({
			type: "user_input_reply",
			itemId: "transport-item",
			questionId: "transport-item:0",
			answer: "Montréal",
		});
		const resolved = resolveAsyncQuestionReply(
			[
				{
					role: "custom",
					customType: "async-user-input",
					details: { item, questionIds: ["transport-item:0", "transport-item:1"] },
				},
			],
			reply!,
		);
		expect(resolved?.question.title).toBe("Which region?");
		const plain = Bun.stripANSI(QuestionTranscriptComponent.answered(resolved!).render(60).join("\n"));
		expect(plain).toContain("Answer recorded");
		expect(plain).toContain("Which region?");
		expect(plain).toContain("Montréal");
		expect(plain).not.toContain("transport-item");
		expect(plain).not.toContain("user_input_reply");
	});

	test("does not claim unrelated or stale JSON and masks a correlated secret", () => {
		expect(parseAsyncInputReply('{"type":"ordinary","answer":"x"}')).toBeUndefined();
		const reply = parseAsyncInputReply(
			'{"type":"user_input_reply","itemId":"transport-item","questionId":"missing","answer":"private-value"}',
		)!;
		expect(resolveAsyncQuestionReply([], reply)).toBeUndefined();
		const secret = {
			reply,
			question: { title: "Token?", isSecret: true },
			position: 0,
			total: 1,
		};
		const plain = Bun.stripANSI(QuestionTranscriptComponent.answered(secret).render(60).join("\n"));
		expect(plain).toContain("Answer hidden");
		expect(plain).not.toContain("private-value");
	});

	test("presents free-form notes without the model-facing transport prefix", () => {
		const resolved = {
			reply: {
				type: "user_input_reply" as const,
				itemId: "transport-item",
				questionId: "transport-item:1",
				answer: "user_note: final operator note",
			},
			question: item.questions[1],
			position: 1,
			total: 2,
		};
		const plain = Bun.stripANSI(QuestionTranscriptComponent.answered(resolved).render(60).join("\n"));
		expect(plain).toContain("final operator note");
		expect(plain).not.toContain("user_note:");
	});

	test("does not correlate a user payload with a question that appears later in replay", () => {
		const raw =
			'{"type":"user_input_reply","itemId":"transport-item","questionId":"transport-item:0","answer":"Montréal"}';
		const reply = { role: "user", content: [{ type: "text", text: raw }] };
		const custom = {
			role: "custom",
			customType: "async-user-input",
			display: true,
			details: { item, questionIds: ["transport-item:0", "transport-item:1"] },
			content: item.text,
		};
		const children: any[] = [];
		const ctx = {
			session: { messages: [reply, custom] },
			chatContainer: { children, addChild: (child: unknown) => children.push(child) },
			ui: { requestRender() {}, terminal: { columns: 80, rows: 24 } },
			editor: { addToHistory() {} },
			getUserMessageText() {
				return raw;
			},
		};
		const helpers = new UiHelpers(ctx as any);
		helpers.addMessageToChat(reply as any);
		helpers.addMessageToChat(custom as any);
		const replayed = Bun.stripANSI(children.flatMap(child => child.render(80)).join("\n"));
		expect(replayed).toContain("user_input_reply");
		expect(replayed).not.toContain("Answer recorded");
	});

	test("uses the summary for live announcements and correlated live or replayed replies", async () => {
		const custom = {
			role: "custom",
			customType: "async-user-input",
			display: true,
			details: { item, questionIds: ["transport-item:0", "transport-item:1"] },
			content: item.text,
		};
		const reply = {
			role: "user",
			content: [
				{
					type: "text",
					text: '{"type":"user_input_reply","itemId":"transport-item","questionId":"transport-item:0","answer":"Montréal"}',
				},
			],
		};
		const children: any[] = [];
		const ctx = {
			session: { messages: [custom, reply] },
			chatContainer: { children, addChild: (child: unknown) => children.push(child) },
			ui: { requestRender() {}, terminal: { columns: 80, rows: 24 } },
			editor: { addToHistory() {} },
			getUserMessageText(message: typeof reply) {
				return message.content[0].text;
			},
		};
		const helpers = new UiHelpers(ctx as any);
		helpers.addMessageToChat(custom as any);
		helpers.addMessageToChat(reply as any);
		const replayed = Bun.stripANSI(children.flatMap(child => child.render(80)).join("\n"));
		expect(replayed).toContain("Questions pending");
		expect(replayed).toContain("Answer recorded");
		expect(replayed).not.toContain("transport-item");
		expect(replayed).not.toContain("user_input_reply");

		const liveChildren: any[] = [];
		const showStatus = vi.fn();
		const addMessageToChat = vi.fn();
		const liveCtx = {
			isInitialized: true,
			statusLine: { invalidate() {} },
			updateEditorTopBorder() {},
			chatContainer: { addChild: (child: unknown) => liveChildren.push(child) },
			ui: { requestRender() {}, terminal: { columns: 80, rows: 24 } },
			showStatus,
			session: { messages: [] },
			getUserMessageText() {
				return reply.content[0].text;
			},
			addMessageToChat,
			optimisticUserMessageSignature: undefined,
			editor: { setText() {} },
			updatePendingMessagesDisplay() {},
		};
		const controller = new EventController(liveCtx as any);
		await controller.handleEvent({
			type: "async_user_input",
			item,
			questionIds: ["transport-item:0", "transport-item:1"],
		});
		await controller.handleEvent({ type: "message_start", message: reply } as any);
		expect(showStatus).not.toHaveBeenCalled();
		expect(addMessageToChat).not.toHaveBeenCalled();
		const live = Bun.stripANSI(liveChildren.flatMap(child => child.render(80)).join("\n"));
		expect(live).toContain("/questions");
		expect(live).toContain("Answer recorded");
		expect(live).not.toContain("user_input_reply");
	});
});
