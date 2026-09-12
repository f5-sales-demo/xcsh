import { expect, test } from "bun:test";
import { runQuestionGroup } from "../src/modes/components/question-flow";
import { initTheme } from "../src/modes/theme/theme";

test.each([false, true])("closed-choice questions omit free text (multi=%s)", async multi => {
	await initTheme(false);
	let calls = 0;
	const result = await runQuestionGroup(
		[{ id: "choice", question: "Choose", options: [{ label: "Blue" }], multi, isOther: false }],
		{
			select: async (_title, options) => {
				expect(options).not.toContain("Other (type your own)");
				return options[calls++ === 0 ? 0 : 1];
			},
			editor: async () => {
				throw new Error("Closed choices cannot open an editor");
			},
		},
	);
	expect(result).toEqual({ choice: { selectedOptions: ["Blue"] } });
});

test("an option named like the free-text action keeps its original meaning", async () => {
	await initTheme(false);
	const result = await runQuestionGroup(
		[{ id: "choice", question: "Choose", options: [{ label: "Other (type your own)" }] }],
		{
			select: async (_title, options) => {
				expect(new Set(options).size).toBe(options.length);
				return options[0];
			},
			editor: async () => {
				throw new Error("The original label must remain selectable");
			},
		},
	);
	expect(result).toEqual({ choice: { selectedOptions: ["Other (type your own)"] } });
});
