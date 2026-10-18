import { expect, test } from "bun:test";
import { presentation } from "../src/extensibility/presentation";

test("adapter-provided completeness preserves domain warnings", () => {
	const result = { content: [{ type: "text", text: "evidence" }], details: { done: false } };
	const view = presentation
		.withPresentation(
			{ name: "fixture" },
			{
				result: () =>
					({
						completeness: "provided",
						warnings: ["Domain provisional"],
						sections: [{ kind: "code", text: "evidence" }],
					}) as any,
			},
		)
		.presentation.result(result, { expanded: false, isPartial: true }, {});
	expect(view.warnings).toEqual(["Domain provisional"]);
});
