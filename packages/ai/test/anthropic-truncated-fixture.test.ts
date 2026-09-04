import { describe, expect, it } from "bun:test";
import type { Tool } from "@f5-sales-demo/pi-ai/types";
import { validateToolArguments } from "@f5-sales-demo/pi-ai/utils/validation";
import { Type } from "@sinclair/typebox";
import truncatedTodoArguments from "./data/anthropic-truncated-todo-arguments.json";

describe("captured Anthropic todo arguments", () => {
	it("rejects the truncated ops string and accepts the one-bracket correction", () => {
		const tool: Tool = {
			name: "todo_write",
			description: "Write a todo list",
			parameters: Type.Object({
				_i: Type.String(),
				ops: Type.Array(
					Type.Object({
						op: Type.Literal("replace"),
						phases: Type.Array(
							Type.Object({
								name: Type.String(),
								tasks: Type.Array(
									Type.Object({
										content: Type.String(),
										details: Type.String(),
										status: Type.String(),
									}),
								),
							}),
						),
					}),
				),
			}),
		};

		expect(() =>
			validateToolArguments(tool, {
				type: "toolCall",
				id: "bad",
				name: tool.name,
				arguments: truncatedTodoArguments,
			}),
		).toThrow("ops: must be array");

		const corrected = { ...truncatedTodoArguments, ops: `${truncatedTodoArguments.ops}]` };
		const result = validateToolArguments(tool, {
			type: "toolCall",
			id: "corrected",
			name: tool.name,
			arguments: corrected,
		});
		expect(Array.isArray(result.ops)).toBe(true);
	});
});
