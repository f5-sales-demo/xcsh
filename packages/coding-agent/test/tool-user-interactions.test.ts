import { expect, test } from "bun:test";
import type { CustomToolContext } from "../src/extensibility/custom-tools/types";
import type { ExtensionUIContext } from "../src/extensibility/extensions/types";
import type { InteractionQuestion } from "../src/session/question-types";
import { UserInteractions } from "../src/session/user-interactions";
import { ToolContextStore } from "../src/tools/context";

test("concurrent tool dialogs retain their own call identity and administrative prompts remain unbound", async () => {
	const interactions = new UserInteractions();
	const ui = {
		questions: (questions: readonly InteractionQuestion[]) =>
			interactions.requestQuestions({ title: questions[0].question, questions }, () => new Promise(() => {})),
		select: (title: string, options: string[]) =>
			interactions.request({ kind: "select", title, options }, () => new Promise(() => {})),
		input: (title: string) => interactions.request({ kind: "input", title }, () => new Promise(() => {})),
		editor: (title: string) => interactions.request({ kind: "input", title }, () => new Promise(() => {})),
		confirm: async (title: string) =>
			(await interactions.request(
				{ kind: "select", title, options: ["Yes", "No"] },
				() => new Promise(() => {}),
			)) === "Yes",
	} as unknown as ExtensionUIContext;
	const store = new ToolContextStore(() => ({}) as CustomToolContext);
	store.setUIContext(ui, true);
	const toolCalls = [
		{ id: "ask-a", name: "ask" },
		{ id: "ask-b", name: "ask" },
	];
	const a = store.getContext({ batchId: "batch", index: 0, total: 2, toolCalls }).ui!;
	const b = store.getContext({ batchId: "batch", index: 1, total: 2, toolCalls }).ui!;
	const results = [
		a.select("Alpha", ["Yes"]),
		b.input("Beta"),
		a.editor("Alpha draft"),
		b.confirm("Beta permission", "Continue?"),
		ui.input("Administrative input"),
		a.questions!([{ id: "a", question: "Alpha group", options: [] }]),
		b.questions!([{ id: "b", question: "Beta group", options: [] }]),
		ui.questions!([{ id: "admin", question: "Administrative group", options: [] }]),
	];
	expect(interactions.pending().map(value => [value.title, value.toolCallId])).toEqual([
		["Alpha", "ask-a"],
		["Beta", "ask-b"],
		["Alpha draft", "ask-a"],
		["Beta permission", "ask-b"],
		["Administrative input", undefined],
		["Alpha group", "ask-a"],
		["Beta group", "ask-b"],
		["Administrative group", undefined],
	]);
	interactions.cancelAll();
	expect(await Promise.all(results)).toEqual([
		undefined,
		undefined,
		undefined,
		false,
		undefined,
		undefined,
		undefined,
		undefined,
	]);
});
