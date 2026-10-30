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
	test("accepted async receipts render before model delivery and do not duplicate boundary replies", async () => {
		const children: any[] = [];
		const ctx = {
			isInitialized: true,
			statusLine: { invalidate() {} },
			updateEditorTopBorder() {},
			chatContainer: { addChild: (child: unknown) => children.push(child) },
			ui: { requestRender() {}, terminal: { columns: 80, rows: 24 } },
		};
		const controller = new EventController(ctx as any);
		const presentation = {
			state: "recorded",
			rows: [{ id: "reply", topic: "Audience", question: "Who?", answer: "Developers" }],
		};
		const event = {
			type: "interaction",
			event: { presentation, interaction: { id: "request" }, type: "resolved", reason: "answered" },
		};
		await controller.handleEvent(event as any);
		await controller.handleEvent(event as any);
		expect(children).toHaveLength(1);
		expect(Bun.stripANSI(children[0].render(80).join("\n"))).toContain("Audience — Developers");
	});

	test("queued replies use all question titles and safe answers without raw envelopes", () => {
		const raw =
			"<send_user_message_question_reply>\n" +
			JSON.stringify([
				{ questionItemId: '["request_user_input_async","transport-item",0]', question: "Region?", answer: "東京" },
				{
					questionItemId: '["request_user_input_async","transport-item",1]',
					question: "Details?",
					answer: "line one\n  line two",
				},
			]) +
			"\n</send_user_message_question_reply>";
		const children: any[] = [];
		const helpers = new UiHelpers({
			session: { getQueuedMessages: () => ({ steering: [raw], followUp: [] }) },
			compactionQueuedMessages: [],
			pendingMessagesContainer: {
				clear: () => {
					children.length = 0;
				},
				addChild: (child: unknown) => children.push(child),
			},
			keybindings: { getDisplayString: () => "Alt+Up" },
		} as any);
		helpers.updatePendingMessagesDisplay();
		const plain = Bun.stripANSI(children.flatMap(child => child.render(32)).join("\n"));
		expect(plain).toContain("Queued for the next model");
		expect(plain).toContain("Region?");
		expect(plain).toContain("Details?");
		expect(plain).toContain("line two");
		expect(plain).not.toContain("send_user_message_question_reply");
	});

	test("a repeated interaction failure is shown once for its failure identity", async () => {
		const showError = vi.fn();
		const controller = new EventController({
			isInitialized: true,
			statusLine: { invalidate() {} },
			updateEditorTopBorder() {},
			showError,
			ui: { requestRender() {} },
		} as any);
		const event = { type: "interaction_error", itemId: "call", failureId: "failure-one", message: "Delivery failed" };
		await controller.handleEvent(event as any);
		await controller.handleEvent(event as any);
		expect(showError).toHaveBeenCalledTimes(1);
	});
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
		const raw = `<send_user_message_question_reply>\n${JSON.stringify([{ questionItemId: '["request_user_input_async","transport-item",0]', question: "Where?", answer: "Montréal" }])}\n</send_user_message_question_reply>`;
		const reply = parseAsyncInputReply(raw);
		expect(reply).toEqual({
			type: "user_input_reply",
			itemId: "transport-item",
			questionId: '["request_user_input_async","transport-item",0]',
			answer: "Montréal",
		});
		const resolved = resolveAsyncQuestionReply(
			[
				{
					role: "custom",
					customType: "async-user-input",
					details: {
						item,
						questionIds: [
							'["request_user_input_async","transport-item",0]',
							'["request_user_input_async","transport-item",1]',
						],
					},
				},
			],
			reply!,
		);
		expect(resolved?.question.title).toBe("Which region?");
		const plain = Bun.stripANSI(QuestionTranscriptComponent.answered(resolved!).render(60).join("\n"));
		expect(plain).toContain("Answers recorded");
		expect(plain).toContain("Which region?");
		expect(plain).toContain("Montréal");
		expect(plain).not.toContain("transport-item");
		expect(plain).not.toContain("user_input_reply");
	});

	test("does not claim unrelated or stale JSON and masks a correlated secret", () => {
		expect(parseAsyncInputReply('{"type":"ordinary","answer":"x"}')).toBeUndefined();
		const reply = parseAsyncInputReply(
			`<send_user_message_question_reply>\n${JSON.stringify([{ questionItemId: '["request_user_input_async","transport-item",99]', question: "Where?", answer: "private-value" }])}\n</send_user_message_question_reply>`,
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

	test("preserves a literal note-like prefix in canonical free text", () => {
		const resolved = {
			reply: {
				type: "user_input_reply" as const,
				itemId: "transport-item",
				questionId: '["request_user_input_async","transport-item",1]',
				answer: "user_note: final operator note",
			},
			question: item.questions[1],
			position: 1,
			total: 2,
		};
		const plain = Bun.stripANSI(QuestionTranscriptComponent.answered(resolved).render(60).join("\n"));
		expect(plain).toContain("final operator note");
		expect(plain).toContain("user_note:");
	});

	test("does not correlate a user payload with a question that appears later in replay", () => {
		const raw = `<send_user_message_question_reply>\n${JSON.stringify([{ questionItemId: '["request_user_input_async","transport-item",0]', question: "Where?", answer: "Montréal" }])}\n</send_user_message_question_reply>`;
		const reply = { role: "user", content: [{ type: "text", text: raw }] };
		const custom = {
			role: "custom",
			customType: "async-user-input",
			display: true,
			details: {
				item,
				questionIds: [
					'["request_user_input_async","transport-item",0]',
					'["request_user_input_async","transport-item",1]',
				],
			},
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
		expect(replayed).not.toContain("send_user_message_question_reply");
		expect(replayed).toContain("Where? — Montréal");
		expect(replayed).not.toContain("Which region? — Montréal");
	});

	test("uses the summary for live announcements and correlated live or replayed replies", async () => {
		const custom = {
			role: "custom",
			customType: "async-user-input",
			display: true,
			details: {
				item,
				questionIds: [
					'["request_user_input_async","transport-item",0]',
					'["request_user_input_async","transport-item",1]',
				],
			},
			content: item.text,
		};
		const reply = {
			role: "user",
			content: [
				{
					type: "text",
					text: `<send_user_message_question_reply>\n${JSON.stringify([{ questionItemId: '["request_user_input_async","transport-item",0]', question: "Where?", answer: "Montréal" }])}\n</send_user_message_question_reply>`,
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
		expect(replayed).toContain("Answers recorded");
		expect(replayed).not.toContain("transport-item");
		expect(replayed).not.toContain("user_input_reply");

		const liveChildren: any[] = [];
		const showStatus = vi.fn();
		const addMessageToChat = vi.fn();
		const setEditorText = vi.fn();
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
			editor: { setText: setEditorText },
			updatePendingMessagesDisplay() {},
		};
		const controller = new EventController(liveCtx as any);
		await controller.handleEvent({
			type: "async_user_input",
			item,
			questionIds: [
				'["request_user_input_async","transport-item",0]',
				'["request_user_input_async","transport-item",1]',
			],
		});
		await controller.handleEvent({ type: "message_start", message: reply } as any);
		expect(showStatus).not.toHaveBeenCalled();
		expect(addMessageToChat).not.toHaveBeenCalled();
		expect(setEditorText).not.toHaveBeenCalled();
		const live = Bun.stripANSI(liveChildren.flatMap(child => child.render(80)).join("\n"));
		expect(live).toContain("/questions");
		expect(live).toContain("Answers recorded");
		expect(live).not.toContain("user_input_reply");
	});
});

test("legacy replies retain opaque identities and resolve original questions on history restoration", () => {
	const answer = "東京\n  $(printf noop)";
	const expected = { type: "user_input_reply" as const, itemId: item.id, questionId: "legacy-question", answer };
	const parsed = parseAsyncInputReply(JSON.stringify(expected));
	expect(parsed).toEqual(expected);
	const restored = resolveAsyncQuestionReply(
		[
			{
				role: "custom",
				customType: "async-user-input",
				details: { item, questionIds: ["legacy-question", "legacy-notes"] },
			},
		] as any,
		parsed!,
	);
	expect(restored?.question.title).toBe("Which region?");
});
