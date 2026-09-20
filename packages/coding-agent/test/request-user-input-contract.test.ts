import { expect, test } from "bun:test";
import { UserInteractions } from "../src/session/user-interactions";
import { RequestUserInputAsyncTool, RequestUserInputTool } from "../src/tools/request-user-input";

function session(plan = true) {
	const owner = new UserInteractions();
	return {
		owner,
		tool: {
			getUserInteractions: () => owner,
			getPlanModeState: () => ({ enabled: plan }),
			settings: { get: () => false },
			getInteractionIdentity: (itemId: string) => ({
				sessionId: "session",
				threadId: "thread",
				turnId: "turn",
				itemId,
				generation: 1,
			}),
			publishAsyncQuestions: () => {},
		} as any,
	};
}
const input = {
	questions: [
		{
			id: "scope",
			header: "Scope",
			question: "Which scope?",
			options: [
				{ label: "Small (Recommended)", description: "Limits scope." },
				{ label: "Large", description: "Covers everything." },
			],
		},
	],
};

test("waiting tool is headless and returns the unmodified Codex answer payload", async () => {
	const { owner, tool } = session();
	const request = new RequestUserInputTool(tool).execute("call", input);
	expect(owner.pending()[0].inputQuestions?.[0].isOther).toBe(true);
	const response = { answers: { scope: { answers: ["Small (Recommended)", "user_note: Start here"] } } };
	expect(owner.respond(owner.pending()[0].id, response)).toBe(true);
	expect((await request).content).toEqual([{ type: "text", text: JSON.stringify(response) }]);
});
test("waiting tool rejects Default mode and empty options", async () => {
	await expect(new RequestUserInputTool(session(false).tool).execute("call", input)).rejects.toThrow(
		"request_user_input is unavailable in Default mode",
	);
	await expect(
		new RequestUserInputTool(session().tool).execute("call", { questions: [{ ...input.questions[0], options: [] }] }),
	).rejects.toThrow("request_user_input requires non-empty options for every question");
});
test("async tool immediately acknowledges and preserves pending attention without blocking", async () => {
	const { owner, tool } = session(false);
	const result = await new RequestUserInputAsyncTool(tool).execute("call", {
		questions: [{ title: "Which scope?", options: ["Small", "Large"] }, { title: "Any details?" }],
	});
	expect(result.content).toEqual([{ type: "text", text: '{"accepted":true}' }]);
	expect(owner.pending()).toHaveLength(2);
	expect(owner.pending().map(question => question.identity?.itemId)).toEqual(["call", "call"]);
	expect(owner.pending().map(question => question.questionId)).toEqual(["call:0", "call:1"]);
	expect(owner.waitingOnUserInput).toBe(false);
	owner.cancelAll();
});
test("async admission is atomic when pending capacity cannot hold the question set", async () => {
	const { owner, tool } = session(false);
	const existing = Array.from({ length: 31 }, () =>
		owner.request({ kind: "input", delivery: "async", title: "Existing" }),
	);
	await expect(
		new RequestUserInputAsyncTool(tool).execute("batch", { questions: [{ title: "First" }, { title: "Second" }] }),
	).rejects.toThrow("Too many pending");
	expect(owner.pending()).toHaveLength(31);
	owner.close();
	await Promise.all(existing);
});

test("async replies retain the originating item and per-question identity", async () => {
	const { owner, tool } = session(false);
	const delivered: unknown[][] = [];
	(tool as any).deliverAsyncAnswer = async (...args: unknown[]) => {
		delivered.push(args);
	};
	await new RequestUserInputAsyncTool(tool).execute("call", {
		questions: [{ title: "First?" }, { title: "Second?" }],
	});
	const [first, second] = owner.pending();
	expect(owner.respond(first.id, "one")).toBe(true);
	expect(owner.respond(second.id, "two")).toBe(true);
	await Bun.sleep(0);
	expect(delivered).toEqual([
		["call", "call:0", "one"],
		["call", "call:1", "two"],
	]);
});
