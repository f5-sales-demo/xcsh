import { expect, test } from "bun:test";
import { asyncAnswerSummary, createQuestionReply } from "../../chat-ui/src/interactions/async-answer";
import { asyncQuestionId, validInputResponse } from "../../chat-ui/src/interactions/contract";
import { RemoteInteractions } from "../src/remote-control/interactions";
import { convertToLlm, createCustomMessage } from "../src/session/messages";
import { UserInteractions } from "../src/session/user-interactions";
import { asyncQuestionsSupported } from "../src/tools/question-eligibility";
import { RequestUserInputAsyncTool, RequestUserInputTool } from "../src/tools/request-user-input";

const questions = [
	{
		id: "format",
		header: "Format",
		question: "Which format?",
		options: [{ label: "Compact", description: "Brief." }],
	},
];

test("empty Codex answers resolve unchanged before continuation", async () => {
	const broker = new UserInteractions();
	const order: string[] = [];
	const remote = new RemoteInteractions(
		broker,
		() => ({ threadId: "thread", turnId: "turn", itemId: "call" }),
		event => order.push(event.method),
	);
	const result = broker
		.requestInput({ title: "Format", toolCallId: "call", inputQuestions: questions, isBlocking: false } as any)
		.then(value => {
			order.push("continuation");
			return value;
		});
	expect(validInputResponse(questions, { answers: {} })).toBe(true);
	expect(remote.pending()[0].params.isBlocking).toBe(false);
	expect(remote.respond(remote.pending()[0].id, { answers: {} })).toEqual({ accepted: true });
	expect(await result).toEqual({ answers: {} });
	expect(order).toEqual(["item/tool/requestUserInput", "serverRequest/resolved", "continuation"]);
	remote.close();
});

test("restored async presentation stays out of model context", () => {
	const message = createCustomMessage(
		"async-user-input",
		"Audience?",
		true,
		{ item: { delivery: "async" } },
		"2026-10-06T00:00:00Z",
		"agent",
	);
	expect(convertToLlm([message])).toEqual([]);
});

test("Codex question replies retain exact Unicode multiline and literal shell text", () => {
	const answer = "Montréal 東京\n$(touch never) `echo never`";
	const text = createQuestionReply(asyncQuestionId("call", 0), "Audience?", answer);
	expect(asyncAnswerSummary(text)).toBe(`Answer recorded: ${answer}`);
});

test("async exposure requires root identity and catalog support including the legacy name", () => {
	for (const name of ["request_user_input_async", "send_user_message_async"]) {
		const model = { experimentalSupportedTools: [name] } as any;
		expect(asyncQuestionsSupported(model)).toBe(true);
		expect(asyncQuestionsSupported(model, 1)).toBe(false);
	}
	expect(asyncQuestionsSupported(undefined)).toBe(false);
	expect(asyncQuestionsSupported({} as any)).toBe(false);
});

test("waiting rejects subagents and async overrides retain bundled fallback", async () => {
	await expect(new RequestUserInputTool({ taskDepth: 1 } as any).execute("call", { questions: [] })).rejects.toThrow(
		"root thread",
	);
	let parameters = "not JSON";
	const tool = new RequestUserInputAsyncTool({
		getModel: () => ({
			modelMessages: { requestUserInputAsyncDescription: "", requestUserInputAsyncParameters: parameters },
		}),
	} as any);
	expect(tool.description).toBe("");
	expect(tool.parameters.properties).toHaveProperty("questions");
	parameters = '{"type":"object","properties":{}}';
	expect(Object.keys(tool.parameters.properties)).toEqual([]);
});

test("async questions do not automatically seize the local editor", async () => {
	const broker = new UserInteractions();
	let presentations = 0;
	broker.setAsyncPresenter(async () => {
		presentations++;
		return undefined;
	});
	const result = broker.request({ kind: "input", delivery: "async", title: "Audience?" });
	await Bun.sleep(0);
	expect(presentations).toBe(0);
	expect(broker.presentAsync(broker.pending()[0].id)).toBe(true);
	await Bun.sleep(0);
	expect(presentations).toBe(1);
	broker.close();
	await result;
});
